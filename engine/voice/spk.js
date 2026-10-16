// Pocket Voice: Qwen3-TTS speaker encoder (ECAPA-TDNN, Qwen3TTSSpeakerEncoder) on WebGPU + its 128-mel log spectrogram in JS.
// All activations f32 (GEMM tiles f32, weights f16 from the pack), channel-last [T][C]; every conv is "same" with REFLECT padding.
'use strict';
import { vgemm } from './vgemm.js';
import { padrows, colstats, colsoftmax, catbcast, sescale } from './vk.js';
import { P } from '../core/gpu.js';

/** log-mel exactly as modeling_qwen3_tts.mel_spectrogram (n_fft 1024, hop 256, Hann (periodic) 1024, reflect pad 384, |X| = sqrt(re^2 +
 *  im^2 + 1e-9), Slaney mel 128 (0-12 kHz, from the pack), log(clamp(x, 1e-5))) -> Float32Array [T][128] */
export function logMel(wav, fb) {
  const N = 1024, H = 256, pad = 384, n = wav.length, L = n + 2 * pad, T = Math.floor((L - N) / H) + 1, NB = 513;
  const x = new Float64Array(L);
  for (let i = 0; i < L; i++) { let j = i - pad; if (j < 0) j = -j; if (j >= n) j = 2 * (n - 1) - j; x[i] = wav[j]; }
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(NB), out = new Float32Array(T * 128);
  const rev = new Uint32Array(N); for (let i = 0, j = 0; i < N; i++) { rev[i] = j; let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; }
  const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) { cosT[k] = Math.cos(-2 * Math.PI * k / N); sinT[k] = Math.sin(-2 * Math.PI * k / N); }
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < N; i++) { re[rev[i]] = x[t * H + i] * win[i]; im[rev[i]] = 0; }
    for (let len = 2; len <= N; len <<= 1) {
      const step = N / len;
      for (let i = 0; i < N; i += len) for (let j = 0; j < len / 2; j++) {
        const wr = cosT[j * step], wi = sinT[j * step], a = i + j, b = a + len / 2;
        const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
      }
    }
    for (let k = 0; k < NB; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k] + 1e-9);
    for (let m = 0; m < 128; m++) { let s = 0; const o = m * NB; for (let k = 0; k < NB; k++) s += fb[o + k] * mag[k]; out[t * 128 + m] = Math.log(Math.max(s, 1e-5)); }
  }
  return { mel: out, T };
}

const ADDC = `
struct P { n: u32, C: u32, aOff: u32, lda: u32, bOff: u32, ldb: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.x + gid.y * nw.x * 256u; if (i >= p.n * p.C) { return; }
  let t = i / p.C; let c = i % p.C;
  Y[i] = A[p.aOff + t * p.lda + c] + A[p.bOff + t * p.ldb + c];
}`;
const bw = (b) => ({ buffer: b, offset: 0, size: Math.floor(b._pf / 4) * 4 });

export class SpeakerEncoder {
  constructor(gpu, store) { this.g = gpu; this.s = store; this.m = store.m; this.tmp = []; }
  W(name) {
    const x = this.m.tensors[`spk/${name}`]; if (!x) throw new Error('tensor missing: spk/' + name);
    const src = x.src || {};
    return { buf: this.h.buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1], n: src.n != null ? src.n : x.shape[0], src, ld: x.shape[x.shape.length - 1] };
  }
  F(name) { return this.m.tensors[`spk/${name}`].offset / 4; }
  async load() {
    this.h = await this.s.upload('spk');
    const x = this.m.tensors['spk/melfb'];
    if (!this.fb) { const ab = this.s.http ? await this.s._range(this.s.shards.get('spk').file, x.offset, x.bytes) : (await this.s.st.call('read', { name: `${this.s.dir}/${this.s.shards.get('spk').file}`, at: x.offset, len: x.bytes })).buf; this.fb = new Float32Array(ab.slice(0, x.bytes)); }
    return this;
  }
  unload() { this.g.runner.flush(); if (this.h) this.s.release(this.h); this.h = null; for (const b of this.tmp) this.g.free(b); this.tmp = []; }
  buf(n, l) { const b = this.g.buffer(n, l); this.tmp.push(b); return b; }
  /** Conv1d "same" + reflect on x [T][ldx] (columns c0 .. c0+cin) -> y (ld, n0), act */
  conv(name, x, T, y, o = {}) {
    const g = this.g, w = this.W(name), cin = w.src.cin, ks = w.src.ks, dil = o.dil || 1;
    const tot = dil * (ks - 1), padL = Math.floor(tot / 2);
    let xin = x.buf, xoff = 0;
    if (ks > 1 || x.c0 || x.ld !== cin) {
      xin = this.buf((T + tot) * cin * 4 + 256, 'spk.pad');
      padrows(g, { x: { buf: x.buf, ld: x.ld, c0: x.c0 || 0 }, Tin: T, C: cin, padL, Tout: T + tot, mode: 'reflect', y: { buf: xin } });
    }
    vgemm(g, { p32: true, w, x: { buf: xin, off: xoff }, M: T, N: w.n, K: w.cols, y: { buf: y.buf, ld: y.ld, n0: y.n0 || 0 }, epi: o.epi || 'f32', act: o.act,
      bv: { buf: this.h.buf, off: this.F(name + '.b') }, conv: { kind: 'conv', Tin: T + tot, Tout: T, Ci: cin, dil, pad: 0, Kreal: ks * cin } });
  }
  /** wav 24 kHz -> x-vector Float32Array [1024] */
  async embed(wav, { dbg } = {}) {
    const g = this.g, { mel, T } = logMel(wav, this.fb);
    const C = 512, C3 = 3 * C, xm = this.buf(T * 128 * 4 + 256, 'spk.mel'); g.device.queue.writeBuffer(xm, 0, mel);
    const b0 = this.buf(T * C * 4 + 256, 'spk.b0'), cat = this.buf(T * C3 * 4 + 256, 'spk.cat');
    const ms = this.buf(2 * C3 * 4 + 256, 'spk.ms'), sum = this.buf(T * 64 * 4 + 256, 'spk.sum'), x1 = this.buf(T * C * 4 + 256, 'spk.x1'), x2 = this.buf(T * C * 4 + 256, 'spk.x2'), x2r = this.buf(T * C * 4 + 256, 'spk.x2r');
    const addc = g.pipeline('vk.addc', () => ADDC);
    this.conv('b0', { buf: xm, ld: 128 }, T, { buf: b0, ld: C }, { act: 'relu' });
    if (dbg) dbg.block0 = b0;
    let x = { buf: b0, ld: C, c0: 0 };
    for (let b = 1; b <= 3; b++) {
      const dil = b + 1;
      this.conv(`b${b}.tdnn1`, x, T, { buf: x1, ld: C }, { act: 'relu' });
      for (let i = 1; i < 8; i++) {   // Res2Net, in place: chunk i <- TDNN(chunk_i + y_{i-1}); y_{i-1} is already in chunk i-1
        if (i === 1) this.conv(`b${b}.res0`, { buf: x1, ld: C, c0: 64 }, T, { buf: x1, ld: C, n0: 64 }, { dil, act: 'relu' });
        else {
          g.runner.dispatch(addc, [bw(x1), bw(sum)], P().u32(T).u32(64).u32(64 * i).u32(C).u32(64 * (i - 1)).u32(C).u32(0).u32(0).ab, [Math.ceil(T * 64 / 256), 1], 1e-5);
          this.conv(`b${b}.res${i - 1}`, { buf: sum, ld: 64 }, T, { buf: x1, ld: C, n0: 64 * i }, { dil, act: 'relu' });
        }
      }
      this.conv(`b${b}.tdnn2`, { buf: x1, ld: C }, T, { buf: x2, ld: C }, { act: 'relu' });
      colstats(g, { x: { buf: x2 }, T, C, o: { buf: ms } });
      // SE scale + residual, written into the MFA concat buffer [T][1536] at slot b-1 (the residual is copied out first: no aliasing)
      let res = x;
      if (x.buf === cat) { padrows(g, { x: { buf: cat, ld: C3, c0: x.c0 }, Tin: T, C, padL: 0, Tout: T, mode: 'zero', y: { buf: x2r } }); res = { buf: x2r, ld: C, c0: 0 }; }
      sescale(g, { T, C, H: 128, mean: { buf: ms, off: 0 }, w: { buf: this.h.buf, w1: this.W(`b${b}.se1`).off / 2, w2: this.W(`b${b}.se2`).off / 2 },
        b: { buf: this.h.buf, b1: this.F(`b${b}.se1.b`), b2: this.F(`b${b}.se2.b`) }, x: { buf: x2 }, r: { buf: res.buf, off: res.c0, ld: res.ld }, y: { buf: cat, off: C * (b - 1), ld: C3 } });
      x = { buf: cat, ld: C3, c0: C * (b - 1) };
    }
    if (dbg) dbg.cat = cat;
    // MFA (1x1 1536 -> 1536 + ReLU), attentive statistics pooling, fc
    const mfa = this.buf(T * C3 * 4 + 256, 'spk.mfa');
    this.conv('mfa', { buf: cat, ld: C3 }, T, { buf: mfa, ld: C3 }, { act: 'relu' });
    if (dbg) dbg.mfa = mfa;
    colstats(g, { x: { buf: mfa }, T, C: C3, o: { buf: ms } });          // mean | std (eps 1e-12)
    const ai = this.buf(T * 3 * C3 * 4 + 256, 'spk.ai'), ah = this.buf(T * 128 * 4 + 256, 'spk.ah'), aw = this.buf(T * C3 * 4 + 256, 'spk.aw');
    catbcast(g, { T, C: C3, V: 2 * C3, x: { buf: mfa }, v: { buf: ms }, y: { buf: ai }, f32: true });
    this.conv('asp.tdnn', { buf: ai, ld: 3 * C3 }, T, { buf: ah, ld: 128 }, { act: 'relutanh' });
    this.conv('asp.conv', { buf: ah, ld: 128 }, T, { buf: aw, ld: C3 }, {});
    colsoftmax(g, { x: { buf: aw }, T, C: C3 });
    const pooled = this.buf(2 * C3 * 4 + 256, 'spk.pool');
    colstats(g, { x: { buf: mfa }, T, C: C3, w: { buf: aw }, o: { buf: pooled } });
    const xv = this.buf(1024 * 4 + 256, 'spk.xv');
    vgemm(g, { p32: true, w: this.W('fc'), x: { buf: pooled, ld: 2 * C3 }, M: 1, N: 1024, K: this.W('fc').cols, y: { buf: xv, ld: 1024 }, epi: 'f32', bv: { buf: this.h.buf, off: this.F('fc.b') } });
    if (dbg) dbg.pooled = pooled;
    const out = new Float32Array(await g.read(xv, 0, 4096));
    if (!dbg) { g.runner.flush(); for (const bb of this.tmp) g.free(bb); this.tmp = []; }
    return out;
  }
}
