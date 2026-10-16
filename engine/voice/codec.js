// Pocket Voice: the Qwen3-TTS 12 Hz codec (pack shards cenc, cdec.*) on WebGPU.  Channel-last [T][C] tensors, f32 residual streams,
// f16 GEMM inputs, f32 accumulation.  spec: the p0pc0rn Qwen3-TTS 0.6B spec, 1.3 / 1.6.
//   CodecDecoder.decode(codes Int32Array [T*16], {from})  -> Float32Array samples of frames [from, T) at 24 kHz
//       official chunked_decode (300-frame chunks, 25 frames of left context); the conv stack runs in time tiles with a 24-frame (50 Hz)
//       halo (its receptive field is ~19.5 frames, so tiles are exact) and only over the requested region (+ halo).
//   CodecEncoder.encode(Float32Array 24 kHz)              -> Int32Array [T*16] reference codes
'use strict';
import { rowstats } from '../ops/misc.js';
import { vgemm } from './vgemm.js';
import { rmsrow, qkrope, attn, ropeTable } from './vops.js';
import { ew, dwconv, cbsum, padrows, vqsearch } from './vk.js';
import { f2h } from '../core/gpu.js';

const HOP = 1920, Q = 16;

class Net {
  constructor(gpu, store) { this.g = gpu; this.s = store; this.m = store.m; this.tmp = []; }
  buf(bytes, label) { const b = this.g.buffer(bytes, label); this.tmp.push(b); return b; }
  freeTmp() { this.g.runner.flush(); for (const b of this.tmp) this.g.free(b); this.tmp = []; }
  W(h, name) {
    const x = this.m.tensors[`${h.name}/${name}`]; if (!x) throw new Error('tensor missing: ' + h.name + '/' + name);
    const src = x.src || {};
    return { buf: h.buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1],
      n: src.n != null ? src.n : x.shape[0], k: src.k != null ? src.k : x.shape[x.shape.length - 1], src, ld: x.shape[x.shape.length - 1] };
  }
  F(h, name) { const x = this.m.tensors[`${h.name}/${name}`]; if (!x) throw new Error('tensor missing: ' + h.name + '/' + name); return x.offset / 4; }
  /** y = act(x W^T + b): x f16 [M, ld] */
  lin(w, x, M, y, o = {}) {
    return vgemm(this.g, Object.assign({ w, x: { buf: x.buf, off: x.off || 0, ld: x.ld, k0: x.k0 || 0 }, M, N: o.N || w.n, K: w.cols, y, epi: o.epi || 'f32', act: o.act,
      bv: o.bias != null ? { buf: o.bias.buf, off: o.bias.off } : undefined }, o.extra || {}));
  }
  /** causal / padded 1-D conv over channel-last f16 X [Tin, Ci] (Ci % 4 == 0): out row t reads x[t + tap*dil - pad] */
  conv(w, x, Tin, Tout, y, o = {}) {
    const ci = w.src.cin, ks = w.src.ks || 2, dil = o.dil || 1;
    return vgemm(this.g, Object.assign({ w, x: { buf: x.buf, off: x.off || 0 }, M: Tout, N: o.N || w.n, K: w.cols, y, epi: o.epi || 'f32', act: o.act,
      bv: o.bias != null ? { buf: o.bias.buf, off: o.bias.off } : undefined,
      conv: { kind: 'conv', Tin, Tout, Ci: o.ci || ci, dil, pad: o.pad != null ? o.pad : dil * (ks - 1), Kreal: o.kreal || ks * ci, xRB: o.xRB, xR0: o.xR0 } }, o.extra || {}));
  }
  tconv(w, x, Tin, y, o = {}) {   // ConvTranspose (k = 2u): rows q = 0..Tin-1 -> output rows q*u .. q*u+u-1 (right trim of the official code)
    return vgemm(this.g, Object.assign({ w, x: { buf: x.buf, off: x.off || 0 }, M: Tin, N: w.n, K: w.cols, y, epi: o.epi || 'f32',
      bv: o.bias != null ? { buf: o.bias.buf, off: o.bias.off } : undefined,
      conv: { kind: 'tconv', Tin, Tout: Tin, Ci: w.src.cin, Kreal: 2 * w.src.cin } }, o.extra || {}));
  }
}

// =================================================================================================== decoder
export class CodecDecoder extends Net {
  constructor(gpu, store, opts = {}) { super(gpu, store); this.tileFrames = opts.tileFrames || 200; this.halo = 24; this.cfg = this.m.model.codec.dec; }
  async load() {
    const s = this.s;
    this.hPre = await s.upload('cdec.pre'); this.hUp = await s.upload('cdec.up');
    this.hBlk = []; for (let b = 0; b < 4; b++) this.hBlk.push(await s.upload('cdec.blk' + b));
    this.hPost = await s.upload('cdec.post');
    if (!this.rope) { this.ropeTab = ropeTable(512, 64, this.cfg.rope_theta || 10000); }
    this.rope = this.g.upload(this.ropeTab, 'cdec.rope');
    return this;
  }
  unload() { for (const h of [this.hPre, this.hUp, ...(this.hBlk || []), this.hPost]) if (h) this.s.release(h); this.hBlk = []; this.hPre = this.hUp = this.hPost = null; if (this.rope) { this.g.free(this.rope); this.rope = null; } this.freeTmp(); }

  /** quantizer -> pre_conv -> transformer -> 2x (tconv + ConvNeXt) for codes [c0, c1) of a chunk: returns f16 [4*(c1-c0), 1024] buffer */
  front(codesBuf, c0, c1, dbg) {
    const g = this.g, T = c1 - c0, hp = this.hPre, hu = this.hUp, D = 1024, H = 512;
    const qx = this.buf(T * 512 * 2 + 256, 'cd.qx');
    cbsum(g, { codes: { buf: codesBuf, off: c0 * Q }, T, D: 256, nq: Q, cb: { buf: hp.buf, off: this.W(hp, 'q.cb').off / 2 }, y: { buf: qx } });
    const qo = this.buf(T * 512 * 4 + 256, 'cd.qo'), qo16 = this.buf(T * 512 * 2 + 256, 'cd.qo16');
    this.lin(this.W(hp, 'q.out_first'), { buf: qx, ld: 512, k0: 0 }, T, { buf: qo, ld: 512 }, { epi: 'f32' });
    this.lin(this.W(hp, 'q.out_rest'), { buf: qx, ld: 512, k0: 256 }, T, { buf: qo, ld: 512 }, { epi: 'add' });
    if (dbg) dbg.quant = qo;
    ew(g, { op: 'copy', x: { buf: qo }, y: { buf: qo16 }, n: T * 512, C: 512, f16: true });
    const pc = this.buf(T * D * 2 + 256, 'cd.pc');
    this.conv(this.W(hp, 'pre_conv'), { buf: qo16 }, T, T, { buf: pc, ld: D }, { epi: 'f16', bias: { buf: hp.buf, off: this.F(hp, 'pre_conv.b') } });
    // transformer (d 512, 16 heads x 64, RoPE 1e4, window 72, RMSNorm 1e-5, layer scale)
    const h = this.buf(T * H * 4 + 256, 'cd.h'), h16 = this.buf(T * H * 2 + 256, 'cd.h16'), qkv = this.buf(T * 3 * 1024 * 4 + 256, 'cd.qkv');
    const qb = this.buf(T * 1024 * 4 + 256, 'cd.q'), ob = this.buf(T * 1024 * 2 + 256, 'cd.o'), mlp = this.buf(T * 1024 * 2 + 256, 'cd.mlp');
    const Lmax = Math.max(T, 16), kc = this.buf(16 * Lmax * 64 * 2 + 256, 'cd.kc'), vc = this.buf(16 * Lmax * 64 * 2 + 256, 'cd.vc');
    this.lin(this.W(hp, 'tr.in'), { buf: pc, ld: D }, T, { buf: h, ld: H }, { epi: 'f32', bias: { buf: hp.buf, off: this.F(hp, 'tr.in.b') } });
    const eps = this.cfg.rms_norm_eps || 1e-5;
    for (let i = 0; i < this.cfg.num_hidden_layers; i++) {
      rmsrow(g, { x: { buf: h }, M: T, K: H, w: { buf: hp.buf, off: this.F(hp, `t${i}.ln1`) }, eps, y: { buf: h16 }, f16: true });
      this.lin(this.W(hp, `t${i}.qkv`), { buf: h16, ld: H }, T, { buf: qkv, ld: 3072 }, { epi: 'f32' });
      qkrope(g, { qkv: { buf: qkv, off: 0, ld: 3072 }, M: T, Hq: 16, Hkv: 16, D: 64, pos0: 0, q: { buf: qb, off: 0, ld: 1024 }, kc: { buf: kc }, vc: { buf: vc }, Lmax,
        norm: null, rope: { buf: this.rope, sinOff: 512 * 32 } });
      attn(g, { q: { buf: qb, off: 0, ld: 1024 }, M: T, Hq: 16, Hkv: 16, D: 64, pos0: 0, window: this.cfg.sliding_window || 72, Lmax, kc: { buf: kc }, vc: { buf: vc }, o: { buf: ob, off: 0, ld: 1024 }, f16out: true });
      this.lin(this.W(hp, `t${i}.o`), { buf: ob, ld: 1024 }, T, { buf: h, ld: H }, { epi: 'add', extra: { gate: { buf: hp.buf, off: this.F(hp, `t${i}.ls1`), mode: 'col' } } });
      rmsrow(g, { x: { buf: h }, M: T, K: H, w: { buf: hp.buf, off: this.F(hp, `t${i}.ln2`) }, eps, y: { buf: h16 }, f16: true });
      this.lin(this.W(hp, `t${i}.gu`), { buf: h16, ld: H }, T, { buf: mlp, ld: 1024 }, { epi: 'swiglu', N: 2048, extra: { wr0: 0, wr1: 1024 } });
      this.lin(this.W(hp, `t${i}.down`), { buf: mlp, ld: 1024 }, T, { buf: h, ld: H }, { epi: 'add', extra: { gate: { buf: hp.buf, off: this.F(hp, `t${i}.ls2`), mode: 'col' } } });
    }
    rmsrow(g, { x: { buf: h }, M: T, K: H, w: { buf: hp.buf, off: this.F(hp, 'tr.norm') }, eps, y: { buf: h16 }, f16: true });
    const tr = this.buf(T * D * 2 + 256, 'cd.tr16'), trf = dbg ? this.buf(T * D * 4 + 256, 'cd.trf') : null;
    this.lin(this.W(hp, 'tr.out'), { buf: h16, ld: H }, T, { buf: tr, ld: D }, { epi: 'f16', bias: { buf: hp.buf, off: this.F(hp, 'tr.out.b') } });
    if (dbg) { this.lin(this.W(hp, 'tr.out'), { buf: h16, ld: H }, T, { buf: trf, ld: D }, { epi: 'f32', bias: { buf: hp.buf, off: this.F(hp, 'tr.out.b') } }); dbg.transformer = trf; }
    // 2 x upsample: tconv (k = s = 2, no overlap: one GEMM, rows (r, co)) + ConvNeXt (dw k7 causal, LN 1e-6, 1024->4096 GELU ->1024, gamma, +x)
    let x16 = tr, Tc = T;
    for (let i = 0; i < 2; i++) {
      const T2 = Tc * 2, xu = this.buf(T2 * D * 4 + 256, 'cd.up' + i), dw = this.buf(T2 * D * 4 + 256, 'cd.dw' + i), st = this.buf(T2 * 8 + 256, 'cd.st' + i);
      const hid = this.buf(T2 * 4096 * 2 + 256, 'cd.hid' + i);
      const wt = this.W(hu, `u${i}.tconv`);
      vgemm(g, { w: wt, x: { buf: x16, off: 0, ld: D }, M: Tc, N: wt.n, K: wt.cols, y: { buf: xu, ld: 2 * D }, epi: 'f32', bv: { buf: hu.buf, off: this.F(hu, `u${i}.tconv.b`) } });
      dwconv(g, { x: { buf: xu }, y: { buf: dw }, T: T2, C: D, K: 7, w: { buf: hu.buf, off: this.F(hu, `u${i}.dw`) }, b: { off: this.F(hu, `u${i}.dw.b`) } });
      rowstats(g, { x: { buf: dw, ld: D }, rows: T2, cols: D, mode: 'ln', eps: 1e-6, st: { buf: st, off: 0 } });
      vgemm(g, { w: this.W(hu, `u${i}.pw1`), x: { buf: dw, ld: D, mode: 'lnmod' }, M: T2, N: 4096, K: D, y: { buf: hid, ld: 4096 }, epi: 'f16', act: 'gelu',
        bv: { buf: hu.buf, off: this.F(hu, `u${i}.pw1.b`) }, stats: { buf: st, off: 0 }, pv: { buf: hu.buf, s: this.F(hu, `u${i}.ln.g1`), b: this.F(hu, `u${i}.ln.b`), ld: 0, div: 1 } });
      vgemm(g, { w: this.W(hu, `u${i}.pw2`), x: { buf: hid, ld: 4096 }, M: T2, N: D, K: 4096, y: { buf: xu, ld: D }, epi: 'add', bv: { buf: hu.buf, off: this.F(hu, `u${i}.pw2.b`) },
        gate: { buf: hu.buf, off: this.F(hu, `u${i}.gamma`), mode: 'col' } });
      if (dbg) dbg['up' + i] = xu;
      const n16 = this.buf(T2 * D * 2 + 256, 'cd.u16' + i);
      ew(g, { op: 'copy', x: { buf: xu }, y: { buf: n16 }, n: T2 * D, C: D, f16: true });
      x16 = n16; Tc = T2;
    }
    return { x16, T50: Tc };
  }

  /** the conv stack on 50 Hz rows [r0, r1) of x16 (f16 [T50][1024]) -> Float32Array samples (r1 - r0) * 480 (zero left padding at r0) */
  async back(x16, r0, r1, dbgOut) {
    const g = this.g, n = r1 - r0, D = 1024;
    const tmp = [], B = (bytes, l) => { const b = g.buffer(bytes, l); tmp.push(b); return b; };
    const drop = (...bs) => { g.runner.flush(); for (const b of bs) { g.free(b); tmp.splice(tmp.indexOf(b), 1); } };
    const pf = this.prof, tick = async (k) => { if (!pf) return; await g.done(); const n = performance.now(); pf[k] = (pf[k] || 0) + n - (pf._t || n); pf._t = n; };
    if (pf) { await g.done(); pf._t = performance.now(); }
    try {
      let C = 1536, T = n;
      let x = B(T * C * 4 + 256, 'cb.x0');
      const hu = this.hUp;
      this.conv(this.W(hu, 'conv_in'), { buf: x16, off: r0 * D * 2 }, n, n, { buf: x, ld: C }, { epi: 'f32', bias: { buf: hu.buf, off: this.F(hu, 'conv_in.b') } });
      await tick('conv_in');
      if (dbgOut) dbgOut.d0 = await g.read(x, 0, T * C * 4);
      const ups = this.cfg.upsample_rates;
      for (let b = 0; b < 4; b++) {
        const h = this.hBlk[b], u = ups[b], Co = C / 2, Tn = T * u;
        const s16 = B(T * C * 2 + 256, 'cb.s16');
        ew(g, { op: 'snake', x: { buf: x }, y: { buf: s16 }, n: T * C, C, ab: { buf: h.buf, a: this.F(h, 'snake.a'), b: this.F(h, 'snake.b') }, f16: true });
        await tick('snake' + b);
        const y = B(Tn * Co * 4 + 256, 'cb.y');
        this.tconv(this.W(h, 'tconv'), { buf: s16 }, T, { buf: y, ld: u * Co }, { epi: 'f32', bias: { buf: h.buf, off: this.F(h, 'tconv.b') } });
        await tick('tconv' + b);
        drop(x, s16);
        x = y; C = Co; T = Tn;
        const a16 = B(T * C * 2 + 256, 'cb.a16'), c1 = B(T * C * 4 + 256, 'cb.c1');
        for (let r = 0; r < 3; r++) {
          const dil = [1, 3, 9][r];
          ew(g, { op: 'snake', x: { buf: x }, y: { buf: a16 }, n: T * C, C, ab: { buf: h.buf, a: this.F(h, `r${r}.s1.a`), b: this.F(h, `r${r}.s1.b`) }, f16: true });
          await tick('snake' + b);
          this.conv(this.W(h, `r${r}.c1`), { buf: a16 }, T, T, { buf: c1, ld: C }, { epi: 'f32', dil, pad: 6 * dil, bias: { buf: h.buf, off: this.F(h, `r${r}.c1.b`) } });
          await tick('c1_' + b);
          ew(g, { op: 'snake', x: { buf: c1 }, y: { buf: a16 }, n: T * C, C, ab: { buf: h.buf, a: this.F(h, `r${r}.s2.a`), b: this.F(h, `r${r}.s2.b`) }, f16: true });
          await tick('snake' + b);
          this.lin(this.W(h, `r${r}.c2`), { buf: a16, ld: C }, T, { buf: x, ld: C }, { epi: 'add', bias: { buf: h.buf, off: this.F(h, `r${r}.c2.b`) } });
          await tick('c2_' + b);
        }
        drop(a16, c1);
        if (dbgOut) dbgOut['d' + (b + 1)] = await g.read(x, 0, T * C * 4);
      }
      const hp = this.hPost, s16 = B(T * C * 2 + 256, 'cb.ps16'), o4 = B(T * 4 * 4 + 256, 'cb.o4');
      ew(g, { op: 'snake', x: { buf: x }, y: { buf: s16 }, n: T * C, C, ab: { buf: hp.buf, a: this.F(hp, 'snake.a'), b: this.F(hp, 'snake.b') }, f16: true });
      this.conv(this.W(hp, 'conv_out'), { buf: s16 }, T, T, { buf: o4, ld: 4 }, { epi: 'f32', N: 4, bias: { buf: hp.buf, off: this.F(hp, 'conv_out.b') } });
      await tick('post');
      const o4f = new Float32Array(await g.read(o4, 0, T * 16)), out = new Float32Array(T);
      await tick('readback');
      for (let i = 0; i < T; i++) out[i] = Math.max(-1, Math.min(1, o4f[i * 4]));
      return out;
    } finally { g.runner.flush(); for (const b of tmp) g.free(b); }
  }

  /** codes Int32Array [T*16] (frames x quantizers); returns samples of frames [from, T) (24 kHz) */
  async decode(codes, { from = 0, check, onTile, dbg } = {}) {
    const g = this.g, T = codes.length / Q, out = new Float32Array((T - from) * HOP);
    const cbuf = g.buffer(codes.length * 4 + 256, 'cd.codes'); g.device.queue.writeBuffer(cbuf, 0, new Uint32Array(codes.buffer, codes.byteOffset, codes.length));
    const CH = 300, CTX = 25;
    try {
      for (let start = 0; start < T; start = Math.min(start + CH, T)) {
        const end = Math.min(start + CH, T), ctx = start - CTX > 0 ? CTX : start, c0 = start - ctx;
        const need0 = Math.max(start, from);          // this chunk gives frames [start, end); we need [max(start, from), end)
        if (need0 >= end) continue;
        const fr = this.front(cbuf, c0, end, dbg);
        const R0 = 4 * (need0 - c0), R1 = 4 * (end - c0);          // 50 Hz rows of this chunk: frame f -> rows 4 (f - c0) .. +3
        for (let r = R0; r < R1; r += this.tileFrames) {
          const re = Math.min(R1, r + this.tileFrames), rs = Math.max(0, r - this.halo);
          const smp = await this.back(fr.x16, rs, re, dbg && r === R0 ? (dbg.back = {}) : null);
          out.set(smp.subarray((r - rs) * 480), c0 * HOP + r * 480 - from * HOP);
          await g.done();   // probes v002: the GPU is idle between parts; the runner's uniform ring starts over (bind groups reused)
          if (onTile) onTile(re - R0, R1 - R0, g.stats ? g.stats() : null);
          if (check) check();
        }
        if (!dbg) this.freeTmp();
      }
    } finally { g.runner.flush(); g.free(cbuf); }
    return out;
  }
}

// =================================================================================================== encoder (Mimi)
export class CodecEncoder extends Net {
  constructor(gpu, store) { super(gpu, store); this.cfg = this.m.model.codec.enc; }
  async load() { this.h = await this.s.upload('cenc'); this.rope = this.g.upload(ropeTable(512, 64, this.cfg.rope_theta || 10000), 'cenc.rope'); return this; }
  unload() { if (this.h) this.s.release(this.h); this.h = null; if (this.rope) { this.g.free(this.rope); this.rope = null; } this.freeTmp(); }

  /** wav: Float32Array 24 kHz mono -> Int32Array [T*16], T = ceil(N / 1920).  All f32 (activations, GEMM tiles, weights when the
   *  pack has cenc=f32): the deeper RVQ codes flip on small input changes (the f16 path matched only 72 % of them). */
  async encode(wav, { dbg } = {}) {
    const g = this.g, h = this.h, N = wav.length, P32 = this.W(h, 'l0').enc === 'f32';
    const ES = P32 ? 4 : 2, H16 = !P32;
    const mm = (o) => vgemm(g, Object.assign({ p32: P32 }, o));
    const lin = (w, x, M, y, o = {}) => mm(Object.assign({ w, x: { buf: x.buf, off: x.off || 0, ld: x.ld, k0: x.k0 || 0 }, M, N: o.N || w.n, K: w.cols, y, epi: o.epi || 'f32', act: o.act,
      bv: o.bias != null ? { buf: o.bias.buf, off: o.bias.off } : undefined }, o.extra || {}));
    const conv = (w, x, Tin, Tout, y, o = {}) => { const ci = w.src.cin, ks = w.src.ks || 2, dil = o.dil || 1;
      return mm(Object.assign({ w, x: { buf: x.buf, off: x.off || 0 }, M: Tout, N: o.N || w.n, K: w.cols, y, epi: o.epi || 'f32', act: o.act,
        bv: o.bias != null ? { buf: o.bias.buf, off: o.bias.off } : undefined,
        conv: { kind: 'conv', Tin, Tout, Ci: o.ci || ci, dil, pad: o.pad != null ? o.pad : dil * (ks - 1), Kreal: o.kreal || ks * ci } }, o.extra || {})); };
    const keep = (name, b, bytes) => { if (!dbg) return; const c = this.buf(bytes + 256, 'dbg'); g.runner.copy(b, 0, c, 0, bytes); dbg[name] = c; };
    const drop = (...bs) => { g.runner.flush(); for (const b of bs) { const i = this.tmp.indexOf(b); if (i >= 0) { this.tmp.splice(i, 1); g.free(b); } } };   // free as soon as consumed (phone peak)
    // SEANet: conv 1->64 k7 (input channels padded to 4), [res, ELU, strided conv] x4, ELU, conv k3 1024->512
    let T = N, C = 4;
    const xin = P32 ? new Float32Array(N * 4) : new Uint16Array(N * 4);
    for (let i = 0; i < N; i++) xin[i * 4] = P32 ? wav[i] : f2h(wav[i]);
    const x0 = this.buf(N * 4 * ES + 256, 'ce.in'); g.device.queue.writeBuffer(x0, 0, xin);
    let x = this.buf(N * 64 * 4 + 256, 'ce.x');
    conv(this.W(h, 'l0'), { buf: x0 }, T, T, { buf: x, ld: 64 }, { ci: 4, kreal: 28, pad: 6, bias: { buf: h.buf, off: this.F(h, 'l0.b') } });
    drop(x0); C = 64;
    const ratios = this.cfg.upsampling_ratios.slice().reverse();
    let li = 1;
    for (const s of ratios) {
      // resblock: x + conv1x1(ELU(conv k3 (ELU(x))))   (dim -> dim/2 -> dim)
      const e = this.buf(T * C * ES + 256, 'ce.e'), r1 = this.buf(T * (C / 2) * 4 + 256, 'ce.r1'), r2 = this.buf(T * (C / 2) * ES + 256, 'ce.r2');
      ew(g, { op: 'elu', x: { buf: x }, y: { buf: e }, n: T * C, C, f16: H16 });
      conv(this.W(h, `l${li}.r1`), { buf: e }, T, T, { buf: r1, ld: C / 2 }, { pad: 2, bias: { buf: h.buf, off: this.F(h, `l${li}.r1.b`) } });
      ew(g, { op: 'elu', x: { buf: r1 }, y: { buf: r2 }, n: T * C / 2, C: C / 2, f16: H16 });
      lin(this.W(h, `l${li}.r2`), { buf: r2, ld: C / 2 }, T, { buf: x, ld: C }, { epi: 'add', bias: { buf: h.buf, off: this.F(h, `l${li}.r2.b`) } });
      drop(e, r1, r2); keep('l' + li, x, T * C * 4);
      li += 2;
      // ELU + strided conv k = 2s: rows of s frames, 2 taps, zero left pad of one row, zero right pad to a whole row
      const Tout = Math.ceil(T / s), xs = this.buf(Tout * s * C * ES + 256, 'ce.xs');
      if (Tout * s > T) g.device.queue.writeBuffer(xs, T * C * ES, new Uint8Array((Tout * s - T) * C * ES));
      ew(g, { op: 'elu', x: { buf: x }, y: { buf: xs }, n: T * C, C, f16: H16 });
      drop(x);
      const y = this.buf(Tout * 2 * C * 4 + 256, 'ce.y');
      conv(this.W(h, `l${li}`), { buf: xs }, Tout, Tout, { buf: y, ld: 2 * C }, { ci: s * C, kreal: 2 * s * C, pad: 1, dil: 1, bias: { buf: h.buf, off: this.F(h, `l${li}.b`) } });
      drop(xs); T = Tout; C *= 2; x = y;
      keep('l' + li, x, T * C * 4);
      li += 1;
    }
    li += 1;
    const e = this.buf(T * C * ES + 256, 'ce.eb'), hid = this.buf(T * 512 * 4 + 256, 'ce.h');
    ew(g, { op: 'elu', x: { buf: x }, y: { buf: e }, n: T * C, C, f16: H16 });
    conv(this.W(h, `l${li}`), { buf: e }, T, T, { buf: hid, ld: 512 }, { pad: 2, bias: { buf: h.buf, off: this.F(h, `l${li}.b`) } });
    drop(e, x); keep('seanet', hid, T * 512 * 4);
    // transformer: 8 layers d 512, 8 heads x 64, LayerNorm 1e-5 (affine), GELU MLP 2048, layer scale, full causal attention, RoPE 1e4
    const st = this.buf(T * 8 + 256, 'ce.st'), qkv = this.buf(T * 1536 * 4 + 256, 'ce.qkv'), qb = this.buf(T * 512 * 4 + 256, 'ce.q'), ob = this.buf(T * 512 * ES + 256, 'ce.o');
    const mlp = this.buf(T * 2048 * ES + 256, 'ce.mlp'), Lmax = Math.max(T, 16), kc = this.buf(8 * Lmax * 64 * 2 + 256, 'ce.kc'), vc = this.buf(8 * Lmax * 64 * 2 + 256, 'ce.vc');
    const eps = this.cfg.norm_eps || 1e-5;
    for (let i = 0; i < this.cfg.num_hidden_layers; i++) {
      const pv1 = { buf: h.buf, s: this.F(h, `t${i}.input_layernorm.g1`), b: this.F(h, `t${i}.input_layernorm.b`), ld: 0, div: 1 };
      rowstats(g, { x: { buf: hid, ld: 512 }, rows: T, cols: 512, mode: 'ln', eps, st: { buf: st, off: 0 } });
      mm({ w: this.W(h, `t${i}.qkv`), x: { buf: hid, ld: 512, mode: 'lnmod' }, M: T, N: 1536, K: 512, y: { buf: qkv, ld: 1536 }, epi: 'f32', stats: { buf: st, off: 0 }, pv: pv1 });
      qkrope(g, { qkv: { buf: qkv, off: 0, ld: 1536 }, M: T, Hq: 8, Hkv: 8, D: 64, pos0: 0, q: { buf: qb, off: 0, ld: 512 }, kc: { buf: kc }, vc: { buf: vc }, Lmax, norm: null, rope: { buf: this.rope, sinOff: 512 * 32 } });
      attn(g, { q: { buf: qb, off: 0, ld: 512 }, M: T, Hq: 8, Hkv: 8, D: 64, pos0: 0, window: 0, Lmax, kc: { buf: kc }, vc: { buf: vc }, o: { buf: ob, off: 0, ld: 512 }, f16out: H16 });
      lin(this.W(h, `t${i}.o`), { buf: ob, ld: 512 }, T, { buf: hid, ld: 512 }, { epi: 'add', extra: { gate: { buf: h.buf, off: this.F(h, `t${i}.ls1`), mode: 'col' } } });
      const pv2 = { buf: h.buf, s: this.F(h, `t${i}.post_attention_layernorm.g1`), b: this.F(h, `t${i}.post_attention_layernorm.b`), ld: 0, div: 1 };
      rowstats(g, { x: { buf: hid, ld: 512 }, rows: T, cols: 512, mode: 'ln', eps, st: { buf: st, off: 0 } });
      mm({ w: this.W(h, `t${i}.fc1`), x: { buf: hid, ld: 512, mode: 'lnmod' }, M: T, N: 2048, K: 512, y: { buf: mlp, ld: 2048 }, epi: H16 ? 'f16' : 'f32', act: 'gelu', stats: { buf: st, off: 0 }, pv: pv2 });
      lin(this.W(h, `t${i}.fc2`), { buf: mlp, ld: 2048 }, T, { buf: hid, ld: 512 }, { epi: 'add', extra: { gate: { buf: h.buf, off: this.F(h, `t${i}.ls2`), mode: 'col' } } });
    }
    drop(st, qkv, qb, ob, mlp, kc, vc); keep('transformer', hid, T * 512 * 4);
    // downsample: conv k4 s2, replicate pad (left 2 frames = one row of 2; right: replicate the last frame to a whole row)
    const T2 = Math.ceil(T / 2), dp = this.buf((T2 + 1) * 2 * 512 * ES + 256, 'ce.dp'), hd = this.buf(T2 * 512 * 4 + 256, 'ce.hd');
    padrows(g, { x: { buf: hid, ld: 512 }, Tin: T, C: 512, padL: 2, Tout: (T2 + 1) * 2, mode: 'replicate', y: { buf: dp }, f16: H16 });
    conv(this.W(h, 'down'), { buf: dp }, T2 + 1, T2, { buf: hd, ld: 512 }, { ci: 1024, kreal: 2048, pad: 0 });
    drop(dp, hid); keep('downsample', hd, T2 * 512 * 4);
    // split RVQ: semantic (1) and acoustic (15) quantizers on their own 1x1 projections of the same input
    const ps = this.buf(T2 * 256 * 4 + 256, 'ce.ps'), pa = this.buf(T2 * 256 * 4 + 256, 'ce.pa'), codes = this.buf(T2 * Q * 4 + 256, 'ce.codes');
    let hx = hd;
    if (H16) { hx = this.buf(T2 * 512 * 2 + 256, 'ce.h16'); ew(g, { op: 'copy', x: { buf: hd }, y: { buf: hx }, n: T2 * 512, C: 512, f16: true }); }
    lin(this.W(h, 'q.sem_in'), { buf: hx, ld: 512 }, T2, { buf: ps, ld: 256 }, { epi: 'f32' });
    lin(this.W(h, 'q.aco_in'), { buf: hx, ld: 512 }, T2, { buf: pa, ld: 256 }, { epi: 'f32' });
    const cb = this.F(h, 'q.cb'), c2 = this.F(h, 'q.cb2');
    vqsearch(g, { x: { buf: ps, ld: 256 }, T: T2, D: 256, nq: 1, cb: { buf: h.buf, off: cb, c2Off: c2 }, codes: { buf: codes }, cstride: Q, q0: 0 });
    vqsearch(g, { x: { buf: pa, ld: 256 }, T: T2, D: 256, nq: 15, cb: { buf: h.buf, off: cb + 2048 * 256, c2Off: c2 + 2048 }, codes: { buf: codes }, cstride: Q, q0: 1 });
    const all = new Int32Array(await g.read(codes, 0, T2 * Q * 4));
    const out = all.slice(0, Math.ceil(N / HOP) * Q);
    if (!dbg) this.freeTmp();
    return out;
  }
}
