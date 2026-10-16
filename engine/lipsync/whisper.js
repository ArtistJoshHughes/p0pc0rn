// MuseTalk's audio path: speech -> 16 kHz -> Whisper log-mel (HF WhisperFeatureExtractor, torch branch) -> whisper-tiny ENCODER with all
// hidden states -> per-video-frame windows of 10 rows x 5 layers (MuseTalk AudioProcessor.get_whisper_chunk) + PositionalEncoding.
// CPU (JS, float64): resampling, STFT / mel / log.  GPU (WGSL): the encoder (2 convs + 4 pre-LN layers, 1500 tokens).
'use strict';
import { lgemm } from './lgemm.js';
import { lattn } from './lattn.js';
import { rowStats } from './lsops.js';
import { f2h } from '../core/gpu.js';

// ------------------------------------------------------------------ resampling (windowed sinc, Kaiser beta 9, 64 zero crossings)
function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-12 * s) break; } return s; }
/** x Float32Array at sr -> Float32Array at the target rate (anti-aliased; identity when equal).  The windowed-sinc kernel is tabulated
 *  (1024 points per input sample, linear interpolation between table points): 78 dB SNR vs librosa soxr_hq on the test speech. */
export function resampleTo16k(x, sr, target = 16000) {
  if (sr === target) return Float32Array.from(x);
  const ratio = target / sr, n = Math.floor(x.length * ratio), out = new Float32Array(n);
  const cut = Math.min(1, ratio) * 0.97, Z = 64, beta = 9, i0b = besselI0(beta), half = Math.ceil(Z / cut), R = 1024;
  const tab = new Float64Array((half + 1) * R + 2);
  for (let i = 0; i < tab.length; i++) {
    const t = i / R, d = t * cut, r = t / (half + 1);
    tab[i] = r >= 1 ? 0 : (d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)) * (besselI0(beta * Math.sqrt(1 - r * r)) / i0b) * cut;
  }
  const k = (t) => { const a = Math.abs(t) * R, i = Math.floor(a), f = a - i; return i + 1 < tab.length ? tab[i] + (tab[i + 1] - tab[i]) * f : 0; };
  for (let i = 0; i < n; i++) {
    const t = i / ratio, c = Math.floor(t); let s = 0;
    const j0 = Math.max(0, c - half + 1), j1 = Math.min(x.length - 1, c + half);
    for (let j = j0; j <= j1; j++) s += x[j] * k(t - j);
    out[i] = s;
  }
  return out;
}

// ------------------------------------------------------------------ log-mel (transformers 4.39.2 _torch_extract_fbank_features)
let DFT = null;
function dftTables() {
  if (DFT) return DFT;
  const N = 400, cos = new Float64Array(201 * N), sin = new Float64Array(201 * N), win = new Float64Array(N);
  for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N);      // torch.hann_window(400), periodic
  for (let k = 0; k <= 200; k++) for (let n = 0; n < N; n++) { const a = 2 * Math.PI * k * n / N; cos[k * N + n] = Math.cos(a) * win[n]; sin[k * N + n] = Math.sin(a) * win[n]; }
  return (DFT = { cos, sin });
}
/** wav16k Float32Array -> {mel: Float32Array [80][3000], frames (3000), active (frames that saw audio)}; melFilters Float32Array [201][80] */
export function logMel(wav, melFilters) {
  const NS = 480000, N = 400, HOP = 160, T = 3000;
  const x = new Float64Array(NS); x.set(wav.subarray(0, Math.min(NS, wav.length)));
  const len = Math.min(NS, wav.length);
  const { cos, sin } = dftTables();
  const mel = new Float64Array(80 * T);
  const active = Math.min(T, Math.ceil((len + N / 2) / HOP) + 1);
  const fr = new Float64Array(N), pw = new Float64Array(201);
  const at = (i) => { if (i < 0) i = -i; if (i >= NS) i = 2 * (NS - 1) - i; return x[i]; };   // reflect padding (center=True)
  let mx = -Infinity;
  for (let t = 0; t < T; t++) {
    if (t >= active) { for (let m = 0; m < 80; m++) mel[m * T + t] = -10; continue; }
    const s0 = t * HOP - N / 2;
    for (let n = 0; n < N; n++) fr[n] = at(s0 + n);
    for (let k = 0; k <= 200; k++) { let re = 0, im = 0; const b = k * N; for (let n = 0; n < N; n++) { re += fr[n] * cos[b + n]; im -= fr[n] * sin[b + n]; } pw[k] = re * re + im * im; }
    for (let m = 0; m < 80; m++) { let s = 0; for (let k = 0; k <= 200; k++) s += melFilters[k * 80 + m] * pw[k]; mel[m * T + t] = Math.log10(Math.max(s, 1e-10)); }
  }
  for (let i = 0; i < mel.length; i++) if (mel[i] > mx) mx = mel[i];
  const out = new Float32Array(80 * T);
  for (let i = 0; i < mel.length; i++) out[i] = (Math.max(mel[i], mx - 8) + 4) / 4;
  return { mel: out, active };
}

// ------------------------------------------------------------------ whisper-tiny encoder on the GPU
export class WhisperEnc {
  constructor(gpu, store) { this.g = gpu; this.s = store; }
  /** mel [80][3000] f32 -> Float32Array [5][1500][384] (hidden states: embed, L1, L2, L3, LN(L4)) */
  async encode(mel, opts = {}) {
    const g = this.g, T = 3000, L = 1500, C = 384, H = 6, Dh = 64;
    const sh = await this.s.upload('audio');
    const bufs = [];
    const B = (bytes, label) => { const b = g.buffer(bytes, label); bufs.push(b); return b; };
    const v = (n) => { const t = sh.t(n); return { buf: t.buf, off: t.off / 4 }; };
    try {
      const x16 = new Uint16Array(T * 80);   // time-major [3000][80]
      for (let t = 0; t < T; t++) for (let m = 0; m < 80; m++) x16[t * 80 + m] = f2h(mel[m * T + t]);
      const xin = g.upload(x16, 'wh.mel'); bufs.push(xin);
      const h1 = B(T * C * 2, 'wh.c1');
      lgemm(g, { w: sh.t('encoder.conv1.weight'), x: { buf: xin }, M: T, N: C, K: sh.t('encoder.conv1.weight').cols, epi: 'f16', act: 'gelu', bv: v('encoder.conv1.bias'),
        y: { buf: h1, ld: C }, conv: { Hi: 1, Wi: T, Ci: 80, Ho: 1, Wo: T, stride: 1, padT: 0, padL: 1, kh: 1, kw: 3, Kreal: 240 } });
      const res = B(L * C * 4, 'wh.res');   // residual f32, pre-filled with the positions
      const pos = sh.t('encoder.embed_positions.weight');
      g.runner.copy(pos.buf, pos.off, res, 0, L * C * 4);
      lgemm(g, { w: sh.t('encoder.conv2.weight'), x: { buf: h1 }, M: L, N: C, K: 3 * C, epi: 'add', act: 'gelu', bv: v('encoder.conv2.bias'),
        y: { buf: res, ld: C }, conv: { Hi: 1, Wi: T, Ci: C, Ho: 1, Wo: L, stride: 2, padT: 0, padL: 1, kh: 1, kw: 3, Kreal: 3 * C } });
      const states = B(5 * L * C * 4, 'wh.states'), st = B(L * 8, 'wh.st'), qkv = B(L * 3 * C * 2, 'wh.qkv'), o = B(L * C * 2, 'wh.o'), f1 = B(L * 4 * C * 2, 'wh.f1');
      const keep = (i) => g.runner.copy(res, 0, states, i * L * C * 4, L * C * 4);
      const ln = (name) => { rowStats(g, { x: { buf: res }, M: L, C, eps: 1e-5, out: { buf: st } }); const w = sh.t(name + '.weight'), b = sh.t(name + '.bias'); return { buf: w.buf, g: w.off / 4, b: b.off / 4 }; };
      for (let l = 0; l < 4; l++) {
        keep(l);
        const p = `encoder.layers.${l}`;
        lgemm(g, { w: sh.t(p + '.self_attn.qkv.weight'), x: { buf: res, mode: 'ln', ld: C }, stats: { buf: st }, ln: ln(p + '.self_attn_layer_norm'), M: L, N: 3 * C, K: C,
          epi: 'f16', bv: v(p + '.self_attn.qkv.bias'), y: { buf: qkv, ld: 3 * C } });
        lattn(g, { Dr: Dh, B: 1, H, Lq: L, Lk: L, scale: 1 / 8, q: { buf: qkv, off: 0, ld: 3 * C, hS: Dh, bS: 0 }, k: { buf: qkv, off: C, ld: 3 * C, hS: Dh, bS: 0 },
          v: { buf: qkv, off: 2 * C, ld: 3 * C, hS: Dh, bS: 0 }, o: { buf: o, off: 0, ld: C, hS: Dh, bS: 0 } });
        lgemm(g, { w: sh.t(p + '.self_attn.out_proj.weight'), x: { buf: o }, M: L, N: C, K: C, epi: 'add', bv: v(p + '.self_attn.out_proj.bias'), y: { buf: res, ld: C } });
        lgemm(g, { w: sh.t(p + '.fc1.weight'), x: { buf: res, mode: 'ln', ld: C }, stats: { buf: st }, ln: ln(p + '.final_layer_norm'), M: L, N: 4 * C, K: C,
          epi: 'f16', act: 'gelu', bv: v(p + '.fc1.bias'), y: { buf: f1, ld: 4 * C } });
        lgemm(g, { w: sh.t(p + '.fc2.weight'), x: { buf: f1 }, M: L, N: C, K: 4 * C, epi: 'add', bv: v(p + '.fc2.bias'), y: { buf: res, ld: C } });
        await g.done(); if (opts.check) opts.check();
      }
      // final LayerNorm -> state 4: an identity GEMM would cost a matmul; instead apply LN with a tiny f32 pass on the CPU after readback
      rowStats(g, { x: { buf: res }, M: L, C, eps: 1e-5, out: { buf: st } });
      keep(4);
      const all = new Float32Array(await g.read(states, 0, 5 * L * C * 4)), stats = new Float32Array(await g.read(st, 0, L * 8));
      const lw = await this.cpu(sh, 'encoder.layer_norm.weight'), lb = await this.cpu(sh, 'encoder.layer_norm.bias');
      const base = 4 * L * C;
      for (let r = 0; r < L; r++) { const mu = stats[2 * r], rs = stats[2 * r + 1]; for (let c = 0; c < C; c++) all[base + r * C + c] = (all[base + r * C + c] - mu) * rs * lw[c] + lb[c]; }
      return all;
    } finally { g.runner.flush(); for (const b of bufs) g.free(b); this.s.release(sh); }
  }
  async cpu(sh, name) { const t = sh.t(name); return new Float32Array(await this.g.read(t.buf, t.off, t.bytes)); }
}

/** MuseTalk get_whisper_chunk + PositionalEncoding: states [5][1500][384] -> Float32Array [T][50][384]; T = floor(len/16000*fps).
 *  mode 'official' = the repo's window (left pad 2*ceil(50/fps) rows); 'centered' = window centred on the frame (probe option) */
export function audioPrompts(states, nSamples, fps, mode = 'official') {
  const L = 1500, C = 384, mult = 50 / fps, T = Math.floor((nSamples / 16000) * fps), actual = Math.floor((nSamples / 16000) * 50);
  const pn = Math.ceil(mult), left = pn * 2;
  const out = new Float32Array(T * 50 * C);
  const pe = new Float32Array(50 * C);
  for (let pos = 0; pos < 50; pos++) for (let i = 0; i < C; i += 2) { const dv = Math.exp(i * (-Math.log(10000) / C)); pe[pos * C + i] = Math.sin(pos * dv); pe[pos * C + i + 1] = Math.cos(pos * dv); }
  for (let f = 0; f < T; f++) {
    let a0 = Math.floor(f * mult);
    if (mode === 'centered') a0 = Math.round(f * mult + mult / 2 - 5) + left;
    for (let t = 0; t < 10; t++) {
      const row = a0 + t - left;   // row in the unpadded feature sequence; outside [0, actual) = zero padding
      for (let l = 0; l < 5; l++) {
        const o = ((f * 50) + t * 5 + l) * C;
        if (row >= 0 && row < actual) { const s = (l * L + row) * C; for (let c = 0; c < C; c++) out[o + c] = states[s + c] + pe[(t * 5 + l) * C + c]; }
        else for (let c = 0; c < C; c++) out[o + c] = pe[(t * 5 + l) * C + c];
      }
    }
  }
  return { prompts: out, T };
}
