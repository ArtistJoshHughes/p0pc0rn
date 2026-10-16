// FLUX.2 [klein] text encoder + DiT + sampler for ANY klein pack (4B or 9B; widths from manifest.model), for the p0pc0rn klein 9B probe.
// Same math as the 4B engine (models/klein_te.js, models/klein_dit.js, pipelines/klein.js; validated on the iPhone), with the
// memory rules learned this week:
//  - ONE weight arena per stage, sized to the largest shard, allocated once and reused by every layer / block / step (no buffer is
//    created or destroyed inside the loops: WebKit gives destroyed GPU memory back late). Each shard is streamed into it from OPFS in
//    16 MB chunks whose ArrayBuffers are TRANSFERRED to the storage worker and back (zero-copy), only after the GPU finished the
//    previous block (onSubmittedWorkDone), so the arena is never written while it is read.
//  - the DiT globals (365 MB at 9B) are never uploaded as one shard: each global tensor goes through the same arena, one at a time.
//  - every activation buffer is allocated once per stage; reads use the Gpu's one reusable staging buffer.
'use strict';
import { gemm } from '../ops/gemm.js';
import { rowstats, ew, layout } from '../ops/misc.js';
import { ropeDiT, ditIds, ropeTE } from '../models/klein_blocks.js';
import { toF16 } from '../core/gpu.js';
import { encodePrompt } from '../models/tokenizer.js';
import { kleinDims, teLayer, ditDouble, ditSingle } from './kblocks.js';

const f = Math.fround, neg = (n) => (-n) >>> 0, CH = 16 * 1024 * 1024;
const pool = [];
export { kleinDims };

/** stream [at, at+len) of a pack file into dst at dstOff (OPFS worker reads, transferred buffers; or HTTP Range in 'http' mode) */
export async function streamInto(g, store, file, at, len, dst, dstOff = 0) {
  const put = (ab, o, n) => { const w = Math.ceil(n / 4) * 4; g.device.queue.writeBuffer(dst, dstOff + o, ab, 0, w <= ab.byteLength ? w : n); };
  if (store.http) {
    for (let o = 0; o < len; o += CH) { const n = Math.min(CH, len - o); put(await store._range(file, at + o, n), o, n); }
    return;
  }
  const name = `${store.dir}/${file}`, take = () => pool.pop() || new ArrayBuffer(CH);
  const read = (o, n) => { const b = take(); return store.st.call('read', { name, at: at + o, len: n, buf: b }, [b]); };
  let next = read(0, Math.min(CH, len));
  for (let o = 0; o < len; o += CH) {
    const r = await next, o2 = o + CH;
    if (o2 < len) next = read(o2, Math.min(CH, len - o2));   // read-ahead (I/O only, one chunk)
    put(r.buf, o, r.len);
    if (pool.length < 3) pool.push(r.buf);
  }
}

/** a GPU buffer reused for every streamed shard / tensor of a stage */
export class Arena {
  constructor(g, bytes, label, maxTensor = 0) {
    this.g = g; this.loads = 0; this.loadMs = 0; this.loadBytes = 0;
    const cap = (g.limits && g.limits.maxBufferSize) || Infinity;
    if (bytes <= cap) { this.buf = g.buffer(bytes, label || 'arena'); this.bytes = this.buf._pf; this.parts = null; }
    else {   // v026.9: buffers stop at maxBufferSize (256 MB on many phones): the arena is several parts
      // each part may end with a gap up to the largest tensor (a tensor is never split): the parts hold the shard plus that slack each
      const per = Math.floor(cap / 256) * 256, slack = Math.min(per / 2, Math.ceil((maxTensor || per / 2) / 256) * 256 + 64 * 256); this.parts = [];
      for (let left = bytes; left > 0;) { const sz = Math.min(per, left + slack); this.parts.push(g.buffer(sz, (label || 'arena') + '.' + this.parts.length)); left -= sz - slack; }
      this.buf = this.parts[0]; this.bytes = this.parts.reduce((s, b) => s + b._pf, 0);
    }
  }
  /** v026.9: a shard into the parts, tensor by tensor (each whole in one part, 256-byte aligned) -> handle whose t() gives part + offset */
  async _shardParts(store, name, s) {
    const T = store.m.tensors, list = Object.keys(T).filter((n) => T[n].shard === name).sort((a, b) => T[a].offset - T[b].offset), at = new Map();
    let pi = 0, o = 0;
    const t0 = performance.now();
    for (const n of list) {
      const x = T[n];
      if (o + x.bytes > this.parts[pi]._pf) { pi++; o = 0; if (pi >= this.parts.length || x.bytes > this.parts[pi]._pf) throw new Error(`shard ${name}: tensor ${n} does not fit the arena parts`); }
      await streamInto(this.g, store, s.file, x.offset, x.bytes, this.parts[pi], o);
      at.set(n, [this.parts[pi], o]); o += Math.ceil(x.bytes / 256) * 256;
    }
    this.loads++; this.loadMs += performance.now() - t0; this.loadBytes += s.bytes;
    const h = { name, buf: this.parts[0] };
    h.t = (tn) => { const x = T[tn], p = at.get(tn); if (!x || !p) throw new Error(`tensor ${tn} not in ${name}`);
      return { buf: p[0], off: p[1], bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }; };
    return h;
  }
  /** a whole shard at offset 0 -> handle {name, buf, t(tensorName)} (tensor offsets = shard offsets) */
  async shard(store, name) {
    const s = store.shards.get(name);
    if (!s) throw new Error('unknown shard ' + name);
    if (this.parts) return this._shardParts(store, name, s);
    if (s.bytes > this.bytes) throw new Error(`shard ${name} (${s.bytes}) > arena (${this.bytes})`);
    const t0 = performance.now(); await streamInto(this.g, store, s.file, 0, s.bytes, this.buf, 0);
    this.loads++; this.loadMs += performance.now() - t0; this.loadBytes += s.bytes;
    const T = store.m.tensors, buf = this.buf, h = { name, buf };
    h.t = (tn) => { const x = T[tn]; if (!x || x.shard !== name) throw new Error(`tensor ${tn} not in ${name}`);
      return { buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }; };
    return h;
  }
  /** one tensor at byte offset `at` of the arena -> tensor ref */
  async tensor(store, tn, at = 0) {
    const x = store.m.tensors[tn], s = store.shards.get(x.shard);
    let buf = this.buf;
    if (this.parts) { let pi = 0; while (pi < this.parts.length && at >= this.parts[pi]._pf) { at -= this.parts[pi]._pf; pi++; } buf = this.parts[pi]; if (!buf || at + x.bytes > buf._pf) { buf = this.parts.find((b) => x.bytes <= b._pf); at = 0; } }
    else if (at + x.bytes > this.bytes) throw new Error(`tensor ${tn} does not fit the arena`);
    const t0 = performance.now(); await streamInto(this.g, store, s.file, x.offset, x.bytes, buf, at);
    this.loads++; this.loadMs += performance.now() - t0; this.loadBytes += x.bytes;
    return { buf, off: at, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] };
  }
  free() { if (this.parts) { for (const b of this.parts) this.g.free(b); this.parts = null; } else if (this.buf) this.g.free(this.buf); this.buf = null; }
}

// ------------------------------------------------------------------------------------------------------------------- sampler helpers
/** Flux2Scheduler sigmas, emulating the reference implementation's float32 torch arithmetic exactly (as models/klein_dit.js) */
export function flux2Sigmas(W, H, steps) {
  const S = Math.round((W * H) / 256);
  let mu;
  if (S > 4300) mu = 0.00016927 * S + 0.45666666;
  else {
    const m200 = 0.00016927 * S + 0.45666666, m10 = 8.73809524e-5 * S + 1.89833333, a = (m200 - m10) / 190, b = m200 - 200 * a;
    mu = a * steps + b;
  }
  const n = steps + 1, step = f(-1 / f(n - 1)), half = Math.floor(n / 2), E = f(Math.exp(mu)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i < half ? f(1 + f(step * i)) : f(0 - f(step * (n - i - 1)));
    const den = f(E + f(f(1 / t) - 1));
    out[i] = f(f(1 / den) * E);
  }
  return out;
}
export function timestepEmb(sigma) {
  const e = new Float32Array(256), t = f(1000 * f(sigma)), c = f(-Math.log(10000));
  for (let k = 0; k < 128; k++) { const fr = f(Math.exp(f(f(c * k) / 128))), a = f(t * fr); e[k] = Math.cos(a); e[128 + k] = Math.sin(a); }
  return e;
}
/** seeded standard normal noise (the app's generator, pipelines/klein.js) in the reference layout [128][h][w] -> DiT tokens [h*w][128] */
export function gaussianTokens(seed, h, w) {
  let a = (seed >>> 0) ^ 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = (seed * 2654435761) >>> 0;
  const next = () => { const t = (b << 9) >>> 0; let r = Math.imul(a, 5); r = Math.imul((r << 7) | (r >>> 25), 9) >>> 0; c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = ((d << 11) | (d >>> 21)) >>> 0; return r / 4294967296; };
  for (let i = 0; i < 16; i++) next();
  const n = 128 * h * w, z = new Float32Array(n);
  for (let i = 0; i < n; i += 2) { const u = Math.max(next(), 1e-12), v = next(), r = Math.sqrt(-2 * Math.log(u)); z[i] = r * Math.cos(2 * Math.PI * v); if (i + 1 < n) z[i + 1] = r * Math.sin(2 * Math.PI * v); }
  const t = new Float32Array(n); for (let ch = 0; ch < 128; ch++) for (let p = 0; p < h * w; p++) t[p * 128 + ch] = z[ch * h * w + p];
  return t;
}
/** FLOPs (for the ETA only) */
export function kleinFlops(dims, L, T = 512) {
  const { D, MLP, ND, NS, NH, HD, Hq, Hkv, QD, TMLP, TL } = dims;
  const blk = ND * 2 * (3 * D * D + D * D + 2 * MLP * D + MLP * D) + NS * ((3 * D + 2 * MLP) * D + (D + MLP) * D);
  return { step: 2 * L * blk + (ND + NS) * 4 * L * L * 128 * NH,
    text: 2 * T * TL * (HD * (Hq + 2 * Hkv) * 128 + QD * HD + HD * 2 * TMLP + TMLP * HD) + TL * 2 * T * T * 128 * Hq };
}

// ------------------------------------------------------------------------------------------------------------------- text encoder
/** prompt -> conditioning f16 [T][3*HD] as a Uint16Array (read back; the GPU copy is freed).  opts {tok, onLayer(l), check(), onLog(step, extra)} */
export async function encodeText(g, store, dims, prompt, opts = {}) {
  const { HD, Hq, Hkv, QD, TMLP, TL, CD } = dims;
  const tk = encodePrompt(opts.tok, prompt), T = tk.T;
  const uniq = Array.from(new Set(tk.ids)), rows = await store.readRows('model.embed_tokens.weight', uniq);
  const where = new Map(uniq.map((id, i) => [id, i])), x0 = new Float32Array(T * HD);
  for (let t = 0; t < T; t++) { const j = where.get(tk.ids[t]); x0.set(rows.subarray(j * HD, (j + 1) * HD), t * HD); }
  let maxB = 0; for (let l = 0; l < TL; l++) maxB = Math.max(maxB, store.shards.get('te.layer.' + String(l).padStart(2, '0')).bytes);
  const bufs = [], B = (n, lab) => { const b = g.buffer(n, lab); bufs.push(b); return b; };
  let arena = null;
  try {
    arena = new Arena(g, maxB, 'te.arena');
    const s = { acc: 'f32', dims, T, nvalid: tk.nvalid, x: B(T * HD * 4, 'te.x'), stats: B(T * 8, 'te.stats'), heads: B((Hq + 2 * Hkv) * T * 256, 'te.heads'),
      o: B(T * QD * 2, 'te.o'), m: B(T * TMLP * 2, 'te.m'), rope: B(T * 128 * 4, 'te.rope') };
    g.upload(x0, '', s.x); g.upload(ropeTE(T), '', s.rope);
    const cond = B(T * CD * 2, 'cond');
    const tap = (col) => layout(g, { op: 'cast2d', n: T * HD, xf: { buf: s.x }, yh: { buf: cond }, a: HD, b: HD, c: 0, d: CD, e: col });
    if (opts.onLog) opts.onLog('text: buffers ready', { arenaMB: Math.round(arena.bytes / 1e6), T, promptTokens: tk.promptTokens });
    for (let l = 0; l < TL; l++) {
      const sh = await arena.shard(store, 'te.layer.' + String(l).padStart(2, '0'));
      if (l === 9) tap(0);
      if (l === 18) tap(HD);
      teLayer(g, sh, s, l);
      if (l === TL - 1) tap(2 * HD);
      await g.done();   // the GPU finished this layer: the arena may be rewritten; the uniform ring starts over (cached bind groups)
      if (opts.check) opts.check();
      if (opts.onLayer) opts.onLayer(l);
    }
    const data = new Uint16Array(await g.read(cond, 0, T * CD * 2));
    await g.done();
    return { data, T, nvalid: tk.nvalid, promptTokens: tk.promptTokens, truncated: tk.truncated, uploadSec: arena.loadMs / 1000, uploadMB: Math.round(arena.loadBytes / 1e6) };
  } finally { g.runner.flush(); if (arena) arena.free(); for (const b of bufs) g.free(b); }
}

// ------------------------------------------------------------------------------------------------------------------- DiT
/** cond = {data: Uint16Array [T][CTX] f16, T}; sigmas Float32Array(steps+1); latent grid h x w.  Allocates the stage's buffers ONCE. */
export async function ditPrepare(g, store, dims, cond, sigmas, h, w, opts = {}) {
  // p0pc0rn v026.6: opts.refs = [{h, w, tokens: Float32Array [h*w][128]}] = FLUX.2 Klein in-context reference(s) for an edit, the 4B
  // engine's way: appended to the image stream (their own RoPE index), fixed through the steps, never in the output
  const refs = opts.refs || [], nRef = refs.reduce((s, r) => s + r.h * r.w, 0);
  const { D, MOD, CTX, ND, NS } = dims, T = cond.T, steps = sigmas.length - 1, nImg = h * w, L = T + nImg + nRef;
  const S = { T, L, nImg, nRef, h, w, steps, sigmas, dims, bufs: [], chunk: opts.chunk || 1024 };
  const B = (n, l) => { const b = g.buffer(n, l); S.bufs.push(b); return b; };
  const blocks = [];
  for (let i = 0; i < ND; i++) blocks.push('dit.double.' + i);
  for (let i = 0; i < NS; i++) blocks.push('dit.single.' + String(i).padStart(2, '0'));
  S.blocks = blocks;
  let maxB = 0; for (const n of blocks) maxB = Math.max(maxB, store.shards.get(n).bytes);
  for (const n of ['txt_in.weight', 'time_in.in_layer.weight', 'time_in.out_layer.weight', 'double_stream_modulation_img.lin.weight', 'double_stream_modulation_txt.lin.weight',
    'single_stream_modulation.lin.weight', 'final_layer.adaLN_modulation.1.weight']) maxB = Math.max(maxB, store.m.tensors[n].bytes);
  try {
    const maxT = Object.values(store.m.tensors).filter((x) => blocks.includes(x.shard)).reduce((m, x) => Math.max(m, x.bytes), 0);
    S.arena = new Arena(g, maxB, 'dit.arena', maxT); S.bufs.push(...(S.arena.parts || [S.arena.buf]));   // v026.9: every part
    S.txt0 = B(T * D * 4, 'dit.txt0'); S.mod = B(steps * MOD * 4, 'dit.mod');
    S.x = B(L * D * 4, 'dit.x'); S.stats = B(L * 8, 'dit.stats'); S.heads = B(3 * dims.NH * L * 256, 'dit.heads'); S.o = B(L * D * 2, 'dit.o');
    S.m = B(S.chunk * dims.MLP * 2, 'dit.mlp'); S.v = B(nImg * 128 * 4, 'dit.v'); S.tok = B((nImg + nRef) * 128 * 2, 'dit.tok16'); S.rope = B(L * 128 * 4, 'dit.rope');
    S.cond = B(T * CTX * 2, 'dit.cond'); S.temb = B(steps * 256 * 2, 'dit.temb'); S.h1 = B(steps * D * 2, 'dit.h1'); S.vec = B(steps * D * 2, 'dit.vec');
    const ki = store.m.tensors['img_in.weight'], kf = store.m.tensors['final_layer.linear.weight'], ka = Math.ceil(ki.bytes / 256) * 256;
    S.keep = B(ka + kf.bytes, 'dit.keep');
    g.upload(cond.data, '', S.cond);
    g.upload(ropeDiT(ditIds(T, h, w, refs), L), '', S.rope);
    if (nRef) { const rt = new Float32Array(nRef * 128); let o = 0; for (const r of refs) { rt.set(r.tokens, o); o += r.tokens.length; } g.upload(toF16(rt), '', S.tok, nImg * 256); }
    const emb = new Float32Array(steps * 256);
    for (let k = 0; k < steps; k++) emb.set(timestepEmb(sigmas[k]), k * 256);
    g.upload(toF16(emb), '', S.temb);
    const run = async (fn) => { fn(); await g.done(); };
    let wt = await S.arena.tensor(store, 'txt_in.weight');
    await run(() => gemm(g, { acc: 'f32', w: wt, x: { buf: S.cond, ld: CTX }, M: T, N: D, K: CTX, epi: 'f32', y: { buf: S.txt0 } }));
    wt = await S.arena.tensor(store, 'time_in.in_layer.weight');
    await run(() => { gemm(g, { acc: 'f32', w: wt, x: { buf: S.temb, ld: 256 }, M: steps, N: D, K: 256, epi: 'f16', y: { buf: S.h1 } }); ew(g, { op: 'silu', n: steps * D, B: { buf: S.h1 } }); });
    wt = await S.arena.tensor(store, 'time_in.out_layer.weight');
    await run(() => { gemm(g, { acc: 'f32', w: wt, x: { buf: S.h1, ld: D }, M: steps, N: D, K: D, epi: 'f16', y: { buf: S.vec } }); ew(g, { op: 'silu', n: steps * D, B: { buf: S.vec } }); });
    let n0 = 0;
    for (const [nm, N] of [['double_stream_modulation_img.lin.weight', 6 * D], ['double_stream_modulation_txt.lin.weight', 6 * D],
      ['single_stream_modulation.lin.weight', 3 * D], ['final_layer.adaLN_modulation.1.weight', 2 * D]]) {
      wt = await S.arena.tensor(store, nm);
      const o = n0; await run(() => gemm(g, { acc: 'f32', w: wt, x: { buf: S.vec, ld: D }, M: steps, N, K: D, epi: 'f32', y: { buf: S.mod, ld: MOD, n0: o } })); n0 += N;
    }
    const gs = store.shards.get('dit.global');
    await streamInto(g, store, gs.file, ki.offset, ki.bytes, S.keep, 0);
    await streamInto(g, store, gs.file, kf.offset, kf.bytes, S.keep, ka);
    S.kImg = { buf: S.keep, off: 0, bytes: ki.bytes, enc: ki.enc, shape: ki.shape, rows: ki.shape[0], cols: ki.shape[1] };
    S.kFin = { buf: S.keep, off: ka, bytes: kf.bytes, enc: kf.enc, shape: kf.shape, rows: kf.shape[0], cols: kf.shape[1] };
    await g.done();
  } catch (e) { ditFree(g, S); throw e; }
  return S;
}

/** one sampler step k on latent (GPUBuffer f32 [nImg][128], updated in place).  opts {acc, onBlock(i, n), check()} -> {uploadSec} */
export async function ditStep(g, store, S, k, latent, opts = {}) {
  const { D, MOD, ND } = S.dims, T = S.T, nb = S.blocks.length;
  const s = { acc: opts.acc || (g.tune && g.tune.acc) || 'f32', dims: S.dims, x: S.x, L: S.L, T, mod: S.mod, modImg: k * MOD, modTxt: k * MOD + 6 * D,
    modSingle: k * MOD + 12 * D, stats: S.stats, heads: S.heads, o: S.o, m: S.m, rope: S.rope, chunk: S.chunk };
  const up0 = S.arena.loadMs;
  g.runner.copy(S.txt0, 0, S.x, 0, T * D * 4);
  layout(g, { op: 'cast16', n: S.nImg * 128, xf: { buf: latent }, yh: { buf: S.tok } });
  gemm(g, { acc: 'f32', w: S.kImg, x: { buf: S.tok, ld: 128 }, M: S.nImg + (S.nRef || 0), N: D, K: 128, epi: 'f32', y: { buf: S.x, off: T * D * 4, ld: D } });   // + the reference tokens (v026.6)
  await g.done();
  for (let i = 0; i < nb; i++) {
    const sh = await S.arena.shard(store, S.blocks[i]);
    if (i < ND) ditDouble(g, sh, s, i); else ditSingle(g, sh, s, i - ND);
    await g.done();   // the GPU finished this block: the arena may be rewritten; the uniform ring starts over (cached bind groups)
    if (opts.check) opts.check();
    if (opts.onBlock) opts.onBlock(i, nb);
  }
  rowstats(g, { x: { buf: S.x, off: T * D * 4 }, rows: S.nImg, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
  gemm(g, { acc: 'f32', w: S.kFin, x: { buf: S.x, off: T * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: S.stats, off: 0 },
    pv: { buf: S.mod, off: k * MOD + 15 * D + D, stride: neg(D) }, M: S.nImg, N: 128, K: D, epi: 'f32', y: { buf: S.v, ld: 128 } });
  ew(g, { op: 'axpy', n: S.nImg * 128, A: { buf: latent }, V: { buf: S.v }, alpha: f(S.sigmas[k + 1] - S.sigmas[k]) });
  await g.done();
  return { uploadSec: (S.arena.loadMs - up0) / 1000 };
}
export function ditFree(g, S) { g.runner.flush(); for (const b of S.bufs || []) g.free(b); S.bufs = []; S.arena = null; }
