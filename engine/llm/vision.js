// Gemma 4 vision tower on WebGPU (p0pc0rn LLM module): image -> soft tokens for the LLM.  Loaded only for image questions.
// Streamed weights, f32 residual, f16 activations, f32 accumulate.  Clipped linears clamp only when the checkpoint's bounds are finite
// (they are +-inf in this checkpoint -> no-op).  Output: f32 [n][1536] soft tokens.  Reuses the audio attnD (head_dim 64, full attention).
'use strict';
import { gemm } from '../ops/gemm.js';
import { rowstats, ew } from '../ops/misc.js';
import { attnD } from '../audio/aattn.js';
import { normadd } from './lops.js';
import { rmsrow32 } from '../ops/video2.js';
import * as V from './vops.js';
import { h2f, f2h } from '../core/gpu.js';
import { resizeAA } from './vprep.js';

const PAD = (n) => Math.ceil(n / 256) * 256;

export class VisionTower {
  constructor(gpu, store) { this.g = gpu; this.store = store; this.vc = store.m.model.vision; this.resident = new Map(); }
  release() { for (const h of this.resident.values()) this.store.release(h); this.resident.clear(); }
  async _shard(n) { return this.resident.get(n) || await this.store.upload(n); }
  _rel(n, h) { if (!this.resident.has(n)) { this.g.runner.flush(); this.store.release(h); } }
  nw(h, n) { const x = h.t(n); return { buf: h.buf, off: x.off / 4 }; }

  _size(h, w) {
    const vc = this.vc, ps = vc.patch, pk = vc.pool, maxP = vc.soft_tokens * pk * pk, side = pk * ps;
    const f = Math.sqrt(maxP * ps * ps / (h * w));
    let th = Math.floor(f * h / side) * side, tw = Math.floor(f * w / side) * side;
    const maxSide = Math.floor(maxP / (pk * pk)) * side;
    if (th === 0) { th = side; tw = Math.min(Math.floor(w / h) * side, maxSide); }
    else if (tw === 0) { tw = side; th = Math.min(Math.floor(h / w) * side, maxSide); }
    return [th, tw];
  }
  async preprocess(image) {
    const ps = this.vc.patch, bmp = image instanceof ImageBitmap ? image : await createImageBitmap(image);
    const [H, W] = this._size(bmp.height, bmp.width), nph = H / ps, npw = W / ps, np = nph * npw;
    // decode at the native size (exact pixels), then the torchvision-style antialiased bicubic resize in JS (canvas scaling differs)
    const w0 = bmp.width, h0 = bmp.height;
    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w0, h0) : Object.assign(document.createElement('canvas'), { width: w0, height: h0 });
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); const src = cx.getImageData(0, 0, w0, h0).data;
    const rs = resizeAA(src, w0, h0, W, H, 4);   // planar uint8 [3][H][W]
    const pixel = new Float32Array(np * 3 * ps * ps), pos = new Int32Array(np * 2);
    for (let py = 0; py < nph; py++) for (let px = 0; px < npw; px++) {
      const pi = py * npw + px, pb = pi * 768; pos[pi * 2] = px; pos[pi * 2 + 1] = py;
      for (let ky = 0; ky < ps; ky++) for (let kx = 0; kx < ps; kx++) {
        const y = py * ps + ky, x = px * ps + kx, o = pb + (ky * ps + kx) * 3;
        for (let cc = 0; cc < 3; cc++) pixel[o + cc] = rs[(cc * H + y) * W + x] / 255;
      }
    }
    return { pixel, pos, np, nph, npw };
  }

  /** encode an image (or pre = {pixel, pos, np} for parity) -> {buf f32 [n][D], n} */
  async encode(image, { check, pre, probe } = {}) {
    const g = this.g, vc = this.vc, C = vc.hidden, ps = vc.patch, D = this.store.m.model.hidden;
    const pp = pre || await this.preprocess(image), { np, pos } = pp;
    const outLen = Math.floor(np / (vc.pool * vc.pool)), k = Math.round(Math.sqrt(np / outLen));
    let maxx = 0; for (let i = 0; i < np; i++) maxx = Math.max(maxx, pos[i * 2]); const maxxDivK = Math.floor((maxx + 1) / k);
    const inh = new Uint16Array(pp.pixel.length); for (let i = 0; i < inh.length; i++) inh[i] = f2h(2 * (pp.pixel[i] - 0.5));
    const inbuf = g.upload(inh, 'vis.in');
    const ve = await this._shard('vis.embed'), ip = ve.t("vis.patch_embedder.input_proj.weight");
    const x = g.buffer(np * C * 4, 'vis.x');
    gemm(g, { acc: 'f32', w: ip, x: { buf: inbuf, ld: 3 * ps * ps, mode: 'f16' }, M: np, N: C, K: 3 * ps * ps, epi: 'f32', y: { buf: x, ld: C } });
    g.runner.flush(); g.free(inbuf);
    const pe = ve.t("vis.patch_embedder.position_embedding_table"), tbl = new Uint16Array(await g.read(ve.buf, pe.off, pe.bytes)), posemb = new Float32Array(np * C);
    for (let i = 0; i < np; i++) { const xr = pos[i * 2] * C, yr = (vc.pos_size + pos[i * 2 + 1]) * C; for (let cc = 0; cc < C; cc++) posemb[i * C + cc] = h2f(tbl[xr + cc]) + h2f(tbl[yr + cc]); }
    const peb = g.upload(posemb, 'vis.pos'); ew(g, { op: 'axpy', n: np * C, A: { buf: x }, V: { buf: peb }, alpha: 1 }); g.runner.flush(); g.free(peb);   // x += position embedding
    if (probe) await probe('patch', x);
    const rope = g.upload(V.visionRope(Array.from({ length: np }, (_, i) => [pos[i * 2], pos[i * 2 + 1]]), vc.rope_theta), 'vis.rope');
    const st = g.buffer(PAD(np * 2 * 4));
    const qkv = g.buffer(np * 3 * C * 2), q = g.buffer(np * C * 2), kk = g.buffer(np * C * 2), vv = g.buffer(np * C * 2), ao = g.buffer(np * C * 2), t = g.buffer(np * C * 4), ga = g.buffer(np * vc.inter * 2), ub = g.buffer(np * vc.inter * 2), mm = g.buffer(np * vc.inter * 2);
    const free = [x, rope, st, qkv, q, kk, vv, ao, t, ga, ub, mm];
    try {
      for (let l = 0; l < vc.layers; l++) { await this._layer(l, np, { x, rope, st, qkv, q, k: kk, v: vv, ao, t, ga, ub, mm }); if (check) check(); if (probe) await probe('layer' + l, x); }
      const xf16 = g.buffer(np * C * 2); ew(g, { op: 'cast32to16', n: np * C, A: { buf: x }, B: { buf: xf16 } });
      const posb = g.upload(pos, 'vis.posi'), pooled = g.buffer(outLen * C * 4);
      V.vpool(g, { x: { buf: xf16 }, pos: { buf: posb }, o: { buf: pooled }, outLen, k, C, maxxDivK, scale: Math.fround(Math.sqrt(C)), np });
      if (probe) await probe('pooled', pooled);
      g.runner.flush(); g.free(xf16); g.free(posb);
      const pst = g.buffer(PAD(outLen * 2 * 4)); rowstats(g, { x: { buf: pooled, ld: C }, rows: outLen, cols: C, mode: 'rms', eps: vc.rms_eps, st: { buf: pst } });
      const ones = g.upload(new Float32Array(C).fill(1), 'ones'), soft = g.buffer(outLen * D * 4), ep = ve.t("vis.embed_vision.embedding_projection.weight");
      gemm(g, { acc: 'f32', w: ep, x: { buf: pooled, ld: C, mode: 'rms' }, stats: { buf: pst }, pv: { buf: ones, off: 0 }, M: outLen, N: D, K: C, epi: 'f32', y: { buf: soft, ld: D } });
      g.runner.flush(); g.free(pooled); g.free(pst); g.free(ones); this._rel('vis.embed', ve); await g.done();
      return { buf: soft, n: outLen, np };
    } finally { g.runner.flush(); for (const b of free) g.free(b); this.freeScratch(); }
  }

  // Gemma4ClippableLinear: clamp(input, in_min, in_max) -> linear -> clamp(output, out_min, out_max); bounds from the manifest
  _lin(l, name, sub, h, np, src, K, N, dst, opts = {}) {
    const g = this.g, key = `vis.layers.${l}.${sub}.${name}`, cb = (this.vc.clip || {})[key] || [-Infinity, Infinity, -Infinity, Infinity];
    const w = h.t(`vis.layers.${l}.${sub}.${name}.weight`);
    V.vclampRows(g, { x: { buf: src.buf, ld: src.ld }, y: { buf: this._ci, ld: K }, M: np, c0: src.c0 || 0, n: K, lo: cb[0], hi: cb[1] });
    const f32 = !!opts.f32, tmp = f32 ? this._co32 : this._co16;
    gemm(g, { acc: 'f32', w: w, x: { buf: this._ci, ld: K, mode: 'f16' }, M: np, N, K, epi: f32 ? 'f32' : 'f16', y: { buf: tmp, ld: N } });
    V.vclampRows(g, { x: { buf: tmp, ld: N }, y: { buf: dst.buf, ld: dst.ld, c0: dst.c0 || 0 }, M: np, c0: 0, n: N, lo: cb[2], hi: cb[3], f32 });
  }

  async _layer(l, np, s) {
    const g = this.g, vc = this.vc, C = vc.hidden, I = vc.inter, hd = vc.head_dim, nH = vc.heads;
    const sn = `vis.layer.${String(l).padStart(2, '0')}`, h = await this._shard(sn), nw = (n) => this.nw(h, `vis.layers.${l}.${n}`);
    if (!this._ci) { this._ci = g.buffer(np * I * 2, 'vis.ci'); this._co16 = g.buffer(np * I * 2, 'vis.co16'); this._co32 = g.buffer(np * C * 4, 'vis.co32'); this._xn = g.buffer(np * C * 2, 'vis.xn'); }
    // attention
    rmsrow32(g, { M: np, D: C, eps: vc.rms_eps, x: { buf: s.x }, w: nw('input_layernorm.weight'), out: { buf: this._xn, ld: C } });
    this._lin(l, 'q_proj', 'self_attn', h, np, { buf: this._xn, ld: C }, C, C, { buf: s.qkv, ld: 3 * C, c0: 0 });
    this._lin(l, 'k_proj', 'self_attn', h, np, { buf: this._xn, ld: C }, C, C, { buf: s.qkv, ld: 3 * C, c0: C });
    this._lin(l, 'v_proj', 'self_attn', h, np, { buf: this._xn, ld: C }, C, C, { buf: s.qkv, ld: 3 * C, c0: 2 * C });
    V.vqkrope(g, { x: { buf: s.qkv, ld: 3 * C }, norm: { buf: h.buf }, qn: nw('self_attn.q_norm.weight').off, kn: nw('self_attn.k_norm.weight').off, rope: { buf: s.rope }, q: { buf: s.q }, k: { buf: s.k }, v: { buf: s.v }, np, eps: vc.rms_eps });
    attnD(g, { q: { buf: s.q }, k: { buf: s.k }, v: { buf: s.v }, o: { buf: s.ao, ld: C, rows: np }, B: 1, H: nH, D: hd, Lq: np, Lk: np, ld: C, hS: hd, bS: 0, Dr: hd, scale: 1.0 });
    this._lin(l, 'o_proj', 'self_attn', h, np, { buf: s.ao, ld: C }, C, C, { buf: s.t, ld: C }, { f32: true });
    normadd(g, { D: C, M: np, t: { buf: s.t, n: 1, ld: np * C }, w: nw('post_attention_layernorm.weight'), x: { buf: s.x }, st: { buf: s.st }, eps: vc.rms_eps, scale: 1 });
    // MLP (gelu_tanh(gate) * up -> down)
    rmsrow32(g, { M: np, D: C, eps: vc.rms_eps, x: { buf: s.x }, w: nw('pre_feedforward_layernorm.weight'), out: { buf: this._xn, ld: C } });
    this._lin(l, 'gate_proj', 'mlp', h, np, { buf: this._xn, ld: C }, C, I, { buf: s.ga, ld: I });
    this._lin(l, 'up_proj', 'mlp', h, np, { buf: this._xn, ld: C }, C, I, { buf: s.ub, ld: I });
    V.geluMul(g, { a: { buf: s.ga }, b: { buf: s.ub }, y: { buf: s.mm }, n: np * I });
    this._lin(l, 'down_proj', 'mlp', h, np, { buf: s.mm, ld: I }, I, C, { buf: s.t, ld: C }, { f32: true });
    normadd(g, { D: C, M: np, t: { buf: s.t, n: 1, ld: np * C }, w: nw('post_feedforward_layernorm.weight'), x: { buf: s.x }, st: { buf: s.st }, eps: vc.rms_eps, scale: 1 });
    this._rel(sn, h);
  }
  freeScratch() { this.g.runner.flush(); for (const k of ['_ci', '_co16', '_co32', '_xn']) if (this[k]) { this.g.free(this[k]); this[k] = null; } }
}
