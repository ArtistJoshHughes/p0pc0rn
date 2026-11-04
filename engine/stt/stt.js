// Pocket STT model: NVIDIA Nemotron 3.5 ASR Streaming 0.6B (cache-aware FastConformer-RNNT + language prompt) on WebGPU, weights
// resident (the pack from tools/stt_pack.py, 640 MB).  The algorithm is the reference's, chunk for chunk (desk check: the same tokens
// as Hugging Face Transformers' streaming generate on the test lines):
//   chunk(mel)   the causal subsampling (one-frame caches), 24 conformer layers (K/V ring of 56 + C frames, 8-frame conv history),
//                the language prompt (a per-language bias) and the encoder projection -> E [C][640] on the GPU
//   decode()     greedy RNN-T over E: the joint for every remaining frame of the chunk in one pass and one read-back of the argmaxes,
//                the LSTM only after a token (blank keeps the state), at most 10 symbols a frame
// C = lookahead + 1 encoder frames (80 ms each) a chunk; the first chunk takes 1 + 8 r mel frames, every later one 8 (r + 1).
'use strict';
import { sgemv, lnorm, attn, kvput, dwconv, stem0, stemdw, stempw, rowcopy, jadd, argmax, lstmx, lstmcell } from './sk.js';

const D = 1024, NL = 24, LEFT = 56, RMAX = 70, CMAX = 14, VOC = 13088, BLANK = 13087, MAXSYM = 10;
export const STT_VERSION = 'stt-0.1';
export const LOOKAHEADS = [0, 1, 3, 6, 13];

export class SttModel {
  constructor(gpu, store) { this.g = gpu; this.s = store; this.m = store.m; this.h = null; }

  W(h, name) {
    const x = this.m.tensors[`${h.name}/${name}`]; if (!x) throw new Error('tensor missing: ' + h.name + '/' + name);
    return { buf: h.buf, off: x.offset, scales: x.scales, n: x.shape[0], k: x.shape[x.shape.length - 1], bytes: x.bytes };
  }
  off(h, name) { const x = this.m.tensors[`${h.name}/${name}`]; if (!x) throw new Error('tensor missing: ' + h.name + '/' + name); return x.offset; }

  async load(onPart) {
    if (this.h) return;
    const s = this.s, names = ['stt.front', ...Array.from({ length: NL }, (_, i) => `stt.layer.${String(i).padStart(2, '0')}`), 'stt.head'];
    const h = { layers: [] };
    for (let i = 0; i < names.length; i++) {
      const sh = await s.upload(names[i]); s.gpool = [];   // keep every shard (no reuse pool: all of them stay resident)
      if (i === 0) h.front = sh; else if (i === names.length - 1) h.head = sh; else h.layers.push(sh);
      if (onPart) onPart(i + 1, names.length);
    }
    const dec = new TextDecoder();
    this.vocab = JSON.parse(dec.decode(await s.readFile('stt.vocab')));
    this.special = new Set(this.vocab.special);
    const fb = this.m.tensors['stt.front/mel_fb'];
    this.melFb = new Float32Array(await this.g.read(h.front.buf, fb.offset, fb.bytes));
    this.h = h;
    this._alloc();
  }

  _alloc() {
    const g = this.g, B = (n, l) => g.buffer(n * 4, 'stt ' + l);
    this.b = {
      s0: B((2 + 8 * CMAX) * 128, 's0'), h1: B(4 * CMAX * 256 * 65, 'h1'), d1: B(2 * CMAX * 256 * 33, 'd1'), p1: B(2 * CMAX * 256 * 33, 'p1'),
      d2: B(CMAX * 256 * 17, 'd2'), p2: B(CMAX * 256 * 17, 'p2'), pre1: B(256 * 65, 'pre1'), pre2: B(256 * 33, 'pre2'),
      xa: B(CMAX * D, 'xa'), xb: B(CMAX * D, 'xb'), hb: B(CMAX * D, 'h'), ff: B(CMAX * 4096, 'ff'), qkv: B(CMAX * 3 * D, 'qkv'), o: B(CMAX * D, 'o'),
      pw: B(CMAX * 2 * D, 'pw'), y: B(CMAX * D, 'y'), y2: B(CMAX * D, 'y2'), u: B(CMAX * 2048, 'u'), e: B(CMAX * 640, 'e'),
      dst: B(2560, 'dstate'), gd: B(640, 'gdec'), xin: B(1280, 'xin'), gates: B(2560, 'gates'), z: B(CMAX * 640, 'z'), lg: B(CMAX * VOC, 'logits'),
      am: B(CMAX * 2, 'argmax'),
    };
    this.ring = []; this.hist = [];
    for (let i = 0; i < NL; i++) {
      this.ring.push([B((LEFT + CMAX) * D, 'k' + i), B((LEFT + CMAX) * D, 'v' + i)]);
      this.hist.push([B(8 * D, 'ha' + i), B(8 * D, 'hb' + i)]);
    }
    this.amOut = new Uint32Array(CMAX * 2);
  }

  /** start a stream: lang = prompt index (the vocab's prompts table), r = lookahead (0, 1, 3, 6 or 13) */
  reset(pid, r) {
    if (!LOOKAHEADS.includes(r)) throw new Error('lookahead must be one of ' + LOOKAHEADS.join(', '));
    this.pid = pid; this.r = r; this.C = r + 1; this.RING = LEFT + this.C; this.P = 0; this.first = true; this.par = 0;
    this.lastMel = null;
    const g = this.g, z = (b) => g.device.queue.writeBuffer(b, 0, new Float32Array(b._pf / 4));
    for (const [k, v] of this.ring) { z(k); z(v); }
    for (const [a, b] of this.hist) { z(a); z(b); }
    z(this.b.pre1); z(this.b.pre2); z(this.b.dst);
    this._decStep(BLANK);   // the decoder starts from the blank symbol
    this.sym = 0;
  }
  /** mel frames this chunk needs: 1 + 8 r for the first, 8 (r + 1) after */
  get need() { return this.first ? 1 + 8 * this.r : 8 * (this.r + 1); }

  /** one chunk of mel frames (Float32Array [need][128]) -> E [C][640] on the GPU (queued, not awaited) */
  chunk(mel) {
    const g = this.g, b = this.b, h = this.h, F = mel.length / 128, C = this.C;
    if (F !== this.need) throw new Error(`chunk needs ${this.need} mel frames, got ${F}`);
    // the stem's input: 2 zero frames before the first chunk, else the previous chunk's last mel frame
    const npre = this.first ? 2 : 1, S = new Float32Array((npre + F) * 128);
    if (!this.first) S.set(this.lastMel, 0);
    S.set(mel, npre * 128); this.lastMel = mel.slice((F - 1) * 128);
    g.device.queue.writeBuffer(b.s0, 0, S);
    const fr = h.front, T1 = (npre + F - 3 >> 1) + 1;
    stem0(g, b.s0, fr.buf, this.off(fr, 'conv_in.w'), this.off(fr, 'conv_in.b'), b.h1, T1);
    const T2 = (npre + T1 - 3 >> 1) + 1;
    stemdw(g, b.h1, b.pre1, fr.buf, this.off(fr, 'dw0.w'), this.off(fr, 'dw0.b'), b.d1, T2, 65, npre);
    rowcopy(g, b.h1, (T1 - 1) * 256 * 65, b.pre1, 0, 256 * 65);
    stempw(g, b.d1, fr.buf, this.off(fr, 'pw0.w'), this.off(fr, 'pw0.b'), b.p1, T2, 33);
    const T3 = (npre + T2 - 3 >> 1) + 1;
    if (T3 !== C) throw new Error(`stem gave ${T3} frames, expected ${C}`);
    stemdw(g, b.p1, b.pre2, fr.buf, this.off(fr, 'dw1.w'), this.off(fr, 'dw1.b'), b.d2, T3, 33, npre);
    rowcopy(g, b.p1, (T2 - 1) * 256 * 33, b.pre2, 0, 256 * 33);
    stempw(g, b.d2, fr.buf, this.off(fr, 'pw1.w'), this.off(fr, 'pw1.b'), b.p2, T3, 17);
    sgemv(g, this.W(fr, 'lin.w'), { buf: b.p2, off: 0, ld: 256 * 17 }, { buf: b.xa, off: 0, ld: D }, C, { bias: this.off(fr, 'lin.b') });
    const cached = Math.min(this.P, LEFT);
    let x = b.xa, xn = b.xb;
    const row = (buf, ld = D) => ({ buf, off: 0, ld });
    for (let i = 0; i < NL; i++) {
      const L = h.layers[i], ln = this.off(L, 'ln'), lo = (k) => ln + k * D * 4;
      lnorm(g, row(x), row(b.hb), C, L.buf, lo(0), lo(1));
      sgemv(g, this.W(L, 'ff1a'), row(b.hb), row(b.ff, 4096), C, { act: 'silu' });
      sgemv(g, this.W(L, 'ff1b'), row(b.ff, 4096), row(x), C, { add: 0.5 });
      lnorm(g, row(x), row(b.hb), C, L.buf, lo(2), lo(3));
      sgemv(g, this.W(L, 'qkv'), row(b.hb), row(b.qkv, 3 * D), C);
      const [kr, vr] = this.ring[i];
      kvput(g, b.qkv, kr, vr, C, this.P, this.RING);
      attn(g, b.qkv, kr, vr, L.buf, { C, cached, P0: this.P, ring: this.RING, rOff: this.off(L, 'R'), uvOff: this.off(L, 'buv'), rmax: RMAX, out: b.o });
      sgemv(g, this.W(L, 'o'), row(b.o), row(x), C, { add: 1 });
      lnorm(g, row(x), row(b.hb), C, L.buf, lo(4), lo(5));
      sgemv(g, this.W(L, 'pw1'), row(b.hb), row(b.pw, 2 * D), C);
      const [ha, hb] = this.hist[i];
      dwconv(g, b.pw, this.par ? hb : ha, this.par ? ha : hb, L.buf, this.off(L, 'dw'), b.y, C);
      lnorm(g, row(b.y), row(b.y2), C, L.buf, lo(10), lo(11), { act: 'silu' });
      sgemv(g, this.W(L, 'pw2'), row(b.y2), row(x), C, { add: 1 });
      lnorm(g, row(x), row(b.hb), C, L.buf, lo(6), lo(7));
      sgemv(g, this.W(L, 'ff2a'), row(b.hb), row(b.ff, 4096), C, { act: 'silu' });
      sgemv(g, this.W(L, 'ff2b'), row(b.ff, 4096), row(x), C, { add: 0.5 });
      lnorm(g, row(x), row(xn), C, L.buf, lo(8), lo(9));
      const t = x; x = xn; xn = t;
    }
    const hd = h.head;
    sgemv(g, this.W(hd, 'p1.w'), row(x), row(b.u, 2048), C, { bias: this.off(hd, 'p1.lang') + this.pid * 2048 * 4, act: 'relu' });
    sgemv(g, this.W(hd, 'ep.w'), row(b.u, 2048), row(b.e, 640), C, { bias: this.off(hd, 'ep.b') });
    this.P += C; this.first = false; this.par ^= 1;
  }

  /** the decoder after token `tok` (queued): LSTM layer 0 on [emb(tok) ; h0], layer 1 on [h0 ; h1], then decoder_projector -> g */
  _decStep(tok) {
    const g = this.g, b = this.b, hd = this.h.head;
    lstmx(g, hd.buf, this.W(hd, 'emb'), b.dst, b.xin, { tok, fromEmb: true, hOff: 0 });
    sgemv(g, this.W(hd, 'lstm0.w'), { buf: b.xin, off: 0, ld: 1280 }, { buf: b.gates, off: 0, ld: 2560 }, 1, { bias: this.off(hd, 'lstm0.b') });
    lstmcell(g, b.gates, b.dst, 0, 640);
    lstmx(g, hd.buf, this.W(hd, 'emb'), b.dst, b.xin, { fromEmb: false, xOff: 0, hOff: 1280 });
    sgemv(g, this.W(hd, 'lstm1.w'), { buf: b.xin, off: 0, ld: 1280 }, { buf: b.gates, off: 0, ld: 2560 }, 1, { bias: this.off(hd, 'lstm1.b') });
    lstmcell(g, b.gates, b.dst, 1280, 1920);
    sgemv(g, this.W(hd, 'dp.w'), { buf: b.dst, off: 1280, ld: 640 }, { buf: b.gd, off: 0, ld: 640 }, 1, { bias: this.off(hd, 'dp.b') });
  }

  /** the joint for frames [t0, C) of the current chunk with the current decoder state -> Uint32Array pairs (argmax, logit bits) */
  async _joint(t0, M) {
    const g = this.g, b = this.b, hd = this.h.head;
    jadd(g, b.e, b.gd, b.z, M, t0);
    sgemv(g, this.W(hd, 'jh.w'), { buf: b.z, off: 0, ld: 640 }, { buf: b.lg, off: 0, ld: VOC }, M, { bias: this.off(hd, 'jh.b') });
    argmax(g, b.lg, b.am, M, VOC, VOC);
    return g.readInto(b.am, 0, M * 8, this.amOut);
  }

  /** greedy RNN-T over the chunk just encoded -> [{tok, frame, logit}] (frame = absolute 80 ms frame index) */
  async decode(opts = {}) {
    const C = this.C, P0 = this.P - C, out = [], f32 = new Float32Array(this.amOut.buffer);
    let t = 0, sym = this.sym, reads = 0;
    while (t < C) {
      const r = await this._joint(t, C - t); reads++;
      let m = 0; while (m < C - t && r[2 * m] === BLANK) m++;
      if (opts.trace) for (let j = 0; j <= Math.min(m, C - t - 1); j++) opts.trace.push([P0 + t + j, r[2 * j], f32[2 * j + 1]]);
      if (m === C - t) { t = C; sym = 0; break; }
      if (m > 0) { t += m; sym = 0; }
      const tok = r[2 * m];
      out.push({ tok, frame: P0 + t, logit: f32[2 * m + 1] });
      sym++; this._decStep(tok);
      if (sym >= MAXSYM) { t++; sym = 0; }
    }
    this.sym = sym; this.reads = reads;
    return out;
  }

  /** token ids -> text (pieces joined, U+2581 -> space; language tags and <unk> dropped) and the last language tag seen */
  text(tokens) {
    const v = this.vocab; let s = '', lang = null;
    for (const t of tokens) {
      const id = typeof t === 'number' ? t : t.tok, p = v.pieces[id];
      if (this.special.has(id)) { if (/^<[a-z]{2}-[A-Z]{2}>$/.test(p)) lang = p.slice(1, -1); continue; }
      s += p;
    }
    return { text: s.split(v.space).join(' ').replace(/^ +/, ''), lang };
  }

  unload() {
    if (!this.h) return;
    const g = this.g;
    for (const k of Object.values(this.b || {})) g.free(k);
    for (const [a, b] of this.ring || []) { g.free(a); g.free(b); }
    for (const [a, b] of this.hist || []) { g.free(a); g.free(b); }
    for (const sh of [this.h.front, this.h.head, ...this.h.layers]) if (sh && sh.buf) g.free(sh.buf);
    this.h = null; this.b = null; this.ring = null; this.hist = null;
  }
}
