// Gemma 4 E2B-it runner on WebGPU (p0pc0rn LLM module).  Pure JS + WGSL, f32 residual + f32 norm stats + f32 GEMM/GEMV accumulate,
// f16 activation / KV storage.  Weights per the pack manifest (gemma4-text arch).  Two residency modes:
//   'resident'  all layer shards uploaded once, kept on the GPU (fast decode; ~1.4 GB at q4)
//   'stream'    each layer's two shards uploaded per token from OPFS and freed (slower; fits a smaller budget)
// Per-Layer Embeddings (PLE): the 2.35 GB embed_tokens_per_layer table is NEVER uploaded; its row for each token id is read from
// storage (ple.rows) and dequantised in JS.  KV sharing: layers >= 15 reuse the post-RoPE K/V of layer 13 (sliding) / 14 (full);
// those caches are the only ones kept, and sliding caches keep just the last `sliding_window` positions (ring buffer).
// v044 (10-21, chat speed round 2): decode reads the token id and PLE row from persistent buffers (no per-token upload + free, so bind
// groups stay cached) and decodeLoop() records each token while the GPU runs the one before it (drunner.js), resident weights only.
// v046 (10-21, prompt read-in round 3): prefill attention as GEMMs by key blocks (lops_prefill.js attnPreGemm) + load-ahead (the next
// chunk's PLE rows read while this chunk runs, buffers once per prefill, two chunks in flight); this.opts switches both (see prefill).
// v047 (10-21): speculative greedy decode with Google's Gemma 4 E2B MTP drafter (spec.js, drafter.js, lops_spec.js); off unless
// this.opts.specK / specAdaptive is set and loadDrafter() ran (see _specConf); everything else is v046.
// v048 (10-21): specAdaptive = the cost-aware k (spec.js); the drafter streams in 16 MiB chunks (drafter.js); the load-ahead read-in
// writes each chunk's PLE token rows straight into its output buffer and combines them in place (K.plefinIP: 9.2 MB less, bit-identical).
// v049 (10-21): the prompt read-in's weight GEMMs accumulate in fp16 partial sums (this._pAcc; this.opts.prefillAcc16 = false = v048).
// 3.8: a sampled answer (o.samp) keeps the drafter: speculative sampling (spec.js, lops_samp.js), see _specSampled.
// 3.8 (v036, iOS 27): the KV cache, the read-in's buffers and the decode scratch stay on the model from answer to answer (allocKV,
// _keptPrefillBufs, scratch): nothing is freed and made again per answer (WebKit gives destroyed GPU memory back late; on Josh's
// iPhone with iOS 27 that pile ended the page in a long read-in right after an answer), and the runner's bind groups stay cached.
// 3.8 (from the phone bench v036): kv_heads > 1 (NVIDIA Bolt E4B: 2 KV heads, hidden 2560, KV sharing from the manifest's kv_source) and
// a RANGE of layers [l0, l1) (a split model: the worker part has no embedding or head, `ends = false`; engine/llm/split.js). The full range
// with kv_heads 1 runs the arithmetic it ran before.
'use strict';
import { gemm } from '../ops/gemm.js';
import { rowstats } from '../ops/misc.js';
import * as K from './lops.js';
import * as KP from './lops_prefill.js';
import { DecodeRunner } from './drunner.js';
import { GpuError } from '../core/gpu.js';
import { specLoop, sampReady } from './spec.js';
import { KS as SAMP_KMAX } from './lops_samp.js';
import { loadDrafter, drafterFromStore } from './drafter.js';

const f32 = (b) => new Float32Array(b);
const ffree = (g, ...bs) => { g.runner.flush(); for (const b of bs) if (b) g.free(b); };   // never destroy a buffer an unsubmitted dispatch uses
const PAD = (n) => Math.ceil(n / 256) * 256;
/** 3.9 (E4B room): give an ArrayBuffer's memory back at once, once its bytes went to the GPU (queue.writeBuffer copies them when it is
 *  called): transfer(0) detaches it, where waiting for the garbage collector let the read-in's per-chunk rows and replies pile up beside a
 *  loaded model (iOS counts them against the page). Nothing where the browser has no ArrayBuffer.prototype.transfer. */
export const dropAB = (b) => { try { if (b && b.byteLength && typeof b.transfer === 'function') b.transfer(0); } catch (e) { /* not ours to drop */ } };

export class Gemma4 {
  constructor(gpu, store) {
    this.g = gpu; this.store = store; this.m = store.m.model; this.cfg = store.m;
    this.NL = this.m.layers; this.D = this.m.hidden; this.NH = this.m.heads;
    this.LT = this.m.layer_types; this.kvSrc = this.m.kv_source; this.win = this.m.sliding_window; this.eps = this.m.rms_eps;
    this.NKV = this.m.kv_heads || 1; this.l0 = 0; this.l1 = this.NL; this.ends = true;   // 3.8: KV heads; the layers this part runs; embedding + head here?
    this.resident = new Map(); this.mode = 'resident'; this.kv = null; this.ctxCap = 0;
    this.rope = {}; this._ropeN = 0;
  }
  /** PLE token rows (dequantised f32 [n][NT]); the http source fetches in batches (one Range request per row in the shared store) */
  async pleRows(ids) {
    const st = this.store, NT = this.NL * this.m.ple_dim;
    if (!st.http || ids.length <= 8) return st.readRows('embed_tokens_per_layer.weight', ids);
    const out = new Float32Array(ids.length * NT);
    for (let i = 0; i < ids.length; i += 8) {
      for (let attempt = 0; ; attempt++) {
        try { out.set(await st.readRows('embed_tokens_per_layer.weight', ids.slice(i, i + 8)), i * NT); break; }
        catch (e) { if (attempt >= 4) throw e; await new Promise((r) => setTimeout(r, 200 * (attempt + 1))); }
      }
    }
    return out;
  }
  hd(l) { return this.LT[l] === 'full_attention' ? this.m.global_head_dim : this.m.head_dim; }
  npairs(l) { return this.m.rope[this.LT[l]].pairs; }
  _ropeBuf(kind) { return this.rope[kind === 'full_attention' ? 'full' : 'sliding']; }
  _ensureRope(n) {
    if (n <= this._ropeN) return;
    const N = Math.max(n, 256);
    this.g.runner.flush(); for (const b of Object.values(this.rope)) this.g.free(b);
    this.rope = { sliding: this.g.upload(K.ropeTable(N, 'sliding'), 'rope.s'), full: this.g.upload(K.ropeTable(N, 'full'), 'rope.f') };
    this._ropeN = N;
  }

  // ---- weights: a resident map {shardName -> handle}, or stream per call
  async preload(onProgress, { streamMlp = [] } = {}) {
    const skip = new Set(streamMlp.map((l) => `lm.layer.${String(l).padStart(2, '0')}.m`));
    const names = this.ends === false ? [] : ['lm.embed', 'lm.global'];   // 3.8: a worker part loads its layers only
    for (let l = this.l0; l < this.l1; l++) { names.push(`lm.layer.${String(l).padStart(2, '0')}.a`, `lm.layer.${String(l).padStart(2, '0')}.m`); }
    if (this.m.vision) { names.push('vis.embed'); for (let l = 0; l < this.m.vision.layers; l++) names.push(`vis.layer.${String(l).padStart(2, '0')}`); }
    let done = 0;
    for (const n of names) {
      if (n.startsWith('vis.') || skip.has(n)) continue;   // vision tower + chosen MLP shards stay streamed
      this.resident.set(n, await this.store.upload(n));
      if (onProgress) onProgress({ frac: ++done / names.length, part: n });
    }
    this.mode = skip.size ? `part-streamed (${skip.size} MLP shards)` : 'resident'; this.streamedMlp = [...skip];
  }
  releaseResident() { for (const h of this.resident.values()) this.store.release(h); this.resident.clear(); }
  async _shard(name) { return this.resident.get(name) || await this.store.upload(name); }
  _rel(name, h) { if (!this.resident.has(name)) { this.g.runner.flush(); this.store.release(h); } }
  t(h, n) { return h.t(n); }
  nw(h, n) { const x = h.t(n); return { buf: x.buf, off: x.off / 4 }; }   // f32 norm weight -> float offset

  // ---- KV cache for a context of up to `cap` positions.  Full-attention layers: linear (row = position).  Sliding layers: a ring of
  //      win + chunk rows (row = position % ring) - enough for a prefill chunk plus its 512-key window, and for decode.
  //      Only layers 0-14 own a cache (15-34 reuse 13 / 14).
  //      3.8: kept from prompt to prompt while the size is the same; the rings are sized for the largest chunk (this.opts.chunk, 256),
  //      so every prompt length shares one shape.  The attention reads keys by position (below the query's), so rows an earlier
  //      answer left are never read.
  allocKV(cap, chunk = 256) {
    const ch = Math.max(chunk, (this.opts && this.opts.chunk) || 256);
    if (this.kv && this.ctxCap === cap && this._kvChunk === ch) return;
    this.freeKV();
    const kv = []; this.ctxCap = cap; this._kvChunk = ch;
    for (let l = 0; l < this.NL; l++) {
      if (this.kvSrc[l] !== l || ((l < this.l0 || l >= this.l1) && !this.mirrorKV().includes(l))) { kv.push(null); continue; }   // 3.8: shared layers + the other part's layers (but a mirror)
      const full = this.LT[l] === 'full_attention', hd = this.hd(l), ring = (!full && cap > this.win + ch) ? this.win + ch : 0, len = ring || cap;
      kv.push({ full, hd, len, ring, kc: this.g.buffer(len * this.NKV * hd * 2, `kc${l}`), vc: this.g.buffer(len * this.NKV * hd * 2, `vc${l}`) });   // [kvh][len][hd] f16
    }
    this.kv = kv;
  }
  freeKV() { this.g.runner.flush(); if (this.kv) for (const c of this.kv) if (c) { this.g.free(c.kc); this.g.free(c.vc); } this.kv = null; }
  _cache(l) { return this.kv[this.kvSrc[l]]; }
  /** 3.8: the KV sources this part's layers read but another part runs (NVIDIA Bolt E4B split at 24 since 3.9: layers 22 and 23): their keys and values
   *  come back with each hop into these MIRROR caches (engine/llm/split.js); none in one process or in a worker part */
  mirrorKV() { const s = new Set(); for (let l = this.l0; l < this.l1; l++) if (this.kvSrc[l] < this.l0) s.add(this.kvSrc[l]); return [...s].sort((a, b) => a - b); }
  _row(c, pos) { return c.ring ? pos % c.ring : pos; }

  // ---------------------------------------------------------------- prefill: chunks of C tokens (positions p0 .. p0+C-1), each chunk
  //   attends to every earlier position through the KV cache; activation memory is bounded by C, not by the prompt length.
  //   v046 (10-21, the prompt read-in, round 3): two changes, each switchable through this.opts (each was measured on an iPhone on its own):
  //   - prefillAhead (default on): the next chunk's PLE rows are read from storage while this chunk runs on the GPU; the per-chunk and
  //     per-layer buffers are made once per prefill (no flush + free per layer, so the bind groups stay cached); two chunks may be in
  //     flight (the CPU waits for the chunk before the last one, not for the last one).  false = v045's loop (_prefillSeq).
  //   - prefillAttn 'gemm' (default): the attention by key blocks as GEMMs (lops_prefill.js attnPreGemm); 'flash' = v045's attnPre.
  //   attnBlock = keys per block (default 1024); attnTile = the attention GEMMs' {BM, BN} (default 64x64: the iPhone ran every GEMM shape
  //   1-4% faster at 64x64 than at the engine's 64x128 in the v022 probe; the tile never changes a result, each output sums in the same
  //   order); prefillBatch = the core runner's batch size during the load-ahead loop (estimated seconds, default 0.4 instead of 0.08: the
  //   v022 probe saw a ~1.7 ms GPU gap after each of v045's 825 submits on the 2,614 prompt).  Both changes off = v045.
  async prefill(ids, op = {}) {
    return (this.opts || {}).prefillAhead === false ? this._prefillSeq(ids, op) : this._prefillAhead(ids, op);
  }
  /** v046: the prefill's buffers, made once per prefill (C = rows per chunk, M = the prompt length) */
  _prefillBufs(C, M) {
    const g = this.g, D = this.D, NH = this.NH, o = this.opts || {}, maxHd = this.m.global_head_dim, maxInter = Math.max(...this.m.intermediate);
    const s = { x: g.buffer(C * D * 4, 'x'), st: g.buffer(PAD(C * 2 * 4), 'st'), qkv: g.buffer(C * (NH * maxHd + 2 * this.NKV * maxHd) * 2, 'qkv'), q: g.buffer(C * NH * maxHd * 2, 'q'),
      ao: g.buffer(C * NH * maxHd * 2, 'ao'), tbuf: g.buffer(C * D * 4, 'tbuf'), mbuf: g.buffer(C * maxInter * 2, 'mbuf'), gbuf: g.buffer(C * 256 * 2, 'gbuf'), x16: g.buffer(C * D * 2, 'x16'),
      ple: null, at: null, gf: null, idb: null };
    s.free = [s.x, s.st, s.qkv, s.q, s.ao, s.tbuf, s.mbuf, s.gbuf, s.x16];
    if ((o.prefillAttn || 'gemm') === 'gemm') {
      const blk = o.attnBlock || 1024;
      s.at = KP.attnScratch(g, { rows: C * NH, D: maxHd, keys: Math.min(blk, Math.ceil(M / 64) * 64), multi: M > blk, tile: o.attnTile || { BM: 64, BN: 64 }, nkv: this.NKV });
      s.free.push(...s.at.bufs);
    }
    return s;
  }
  /** 3.8: the load-ahead read-in's buffers, kept on the model from prompt to prompt: sized once for the largest chunk (this.opts.chunk,
   *  256) and the longest attention block, so no prompt frees or makes them.  The sizes are capacities: each chunk uses the rows it
   *  has, and the attention's key blocks come out as with a scratch sized for the prompt (one block up to attnBlock keys, then blocks of
   *  attnBlock): the same numbers.  ~54 MB on Gemma 4 E2B, freed with the model. */
  _keptPrefillBufs(C) {
    const o = this.opts || {}, rows = Math.max(C, o.chunk || 256), gemmAttn = (o.prefillAttn || 'gemm') === 'gemm', k = this._pb;
    const shape = `${o.attnBlock || 1024}|${JSON.stringify(o.attnTile || null)}`;   // the attention scratch's block and tile
    if (k && k.rows >= rows && k.gemmAttn === gemmAttn && k.shape === shape) return k;
    if (k) { this.g.runner.flush(); for (const b of k.free) this.g.free(b); this._pb = null; }
    const g = this.g, NT = this.NL * this.m.ple_dim, blk = o.attnBlock || 1024;
    const s = this._prefillBufs(rows, blk + 1);   // a prompt past attnBlock: the longest block's scratch, with the multi-block buffers
    const front = this.ends !== false;   // 3.9 (E4B room): a worker part gets its rows and per-layer inputs from the page: no PLE projection, no ids
    Object.assign(s, { rows, gemmAttn, shape, proj2: front ? g.buffer(rows * NT * 4, 'ple.proj') : null, ple: g.buffer(rows * NT * 4, 'ple'), idb: front ? g.buffer(PAD(rows * 4), 'ids') : null, gf: g.buffer(rows * 256 * 4, 'gf') });
    s.free.push(s.proj2, s.ple, s.idb, s.gf);
    return (this._pb = s);
  }
  /** v045's loop: one chunk in flight, the PLE / ids / gate buffers made per chunk or layer (the attention follows this.opts) */
  async _prefillSeq(ids, { inputsEmbeds = null, imageSpans = [], check, onLayer, chunk } = {}) {
    const g = this.g, M = ids.length, D = this.D, NL = this.NL, C = Math.min(M, chunk || this.opts?.chunk || 256);
    this._ensureRope(this.ctxCap || M + 2048);
    this.allocKV(this.ctxCap || M + 2048, C);
    const s = this._prefillBufs(C, M);
    this._dbg = s;
    let ple = null, r = null;
    try {
      for (let p0 = 0; p0 < M; p0 += C) {
        const idc = ids.slice(p0, p0 + C), MC = idc.length;
        const spans = imageSpans.filter((sp) => sp.pos >= p0 && sp.pos < p0 + MC).map((sp) => Object.assign({}, sp, { pos: sp.pos - p0 }));
        await this._embedTokens(idc, s.x, s.st, inputsEmbeds, spans);
        ple = await this._ple(idc, s.x, MC);                                        // f32 [MC][NL*256]
        s.ple = ple; if (onLayer) await onLayer(-1, p0);
        for (let l = this.l0; l < this.l1; l++) {
          await this._layerPrefill(l, MC, p0, s);
          if (check) check(); if (onLayer) await onLayer(l, p0);
        }
        g.runner.flush(); g.free(ple); ple = null; s.ple = null;
        if (p0 + C < M) await g.done();   // p0pc0rn v024: one chunk in flight at a time (each queued batch holds a uniform buffer: ~110 MB on a 3,000-token prompt)
      }
      const ML = M - Math.floor((M - 1) / C) * C;                                   // rows in the last chunk
      rowstats(g, { x: { buf: s.x, off: (ML - 1) * D * 4, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
      r = await this._head({ buf: s.x, rowB: (ML - 1) * D }, { buf: s.st, off: 1 });
      return r;
    } finally { g.runner.flush(); for (const b of s.free) g.free(b); if (ple) g.free(ple); }
  }
  /** v046: the load-ahead loop (see prefill) */
  async _prefillAhead(ids, { inputsEmbeds = null, imageSpans = [], check, onLayer, chunk } = {}) {
    const g = this.g, M = ids.length, D = this.D, NL = this.NL, C = Math.min(M, chunk || this.opts?.chunk || 256), NT = NL * this.m.ple_dim;
    this._ensureRope(this.ctxCap || M + 2048);
    this.allocKV(this.ctxCap || M + 2048, C);
    const s = this._keptPrefillBufs(C);   // 3.8: kept on the model (no free + make per prompt)
    const pre = { proj2: s.proj2, out: s.ple, x16: s.x16 };   // v048: no token-rows buffer (plefinIP)
    this._dbg = s;
    const psc = Math.fround(this.m.ple_scale), img = this.m.image_token, pad = this.m.pad, R = g.runner, bs0 = R.batchSeconds;
    R.batchSeconds = (this.opts || {}).prefillBatch || 0.4;   // fewer, larger submits while the prompt is read in (restored below)
    const rowsOf = (p0) => this.pleRows(ids.slice(p0, p0 + C).map((i) => (i === img ? pad : i)))   // image tokens use the PLE of pad (HF)
      .then((t) => { for (let i = 0; i < t.length; i++) t[i] = Math.fround(t[i] * psc); return t; });
    let next = rowsOf(0), prev = null;
    // 3.8 test switches (off unless this.opts sets them; the phone bench's fit test): one chunk in flight, and with it the runner's
    // uniform ring restarted per chunk, so each chunk reuses the bind groups of the chunk before it
    const one = (this.opts || {}).prefillInFlight === 1, ringSync = one && !!(this.opts || {}).prefillRingSync;
    try {
      for (let p0 = 0; p0 < M; p0 += C) {
        const idc = ids.slice(p0, p0 + C), MC = idc.length;
        const spans = imageSpans.filter((sp) => sp.pos >= p0 && sp.pos < p0 + MC).map((sp) => Object.assign({}, sp, { pos: sp.pos - p0 }));
        const rows = await next; next = p0 + C < M ? rowsOf(p0 + C) : null;   // the next chunk's rows are read while this chunk runs
        await this._embedTokens(idc, s.x, s.st, inputsEmbeds, spans, s.idb);
        await this._ple(idc, s.x, MC, Object.assign({ rows }, pre));
        dropAB(rows.buffer);   // 3.9 (E4B room): its bytes are on the GPU now
        if (onLayer) await onLayer(-1, p0);
        for (let l = this.l0; l < this.l1; l++) {
          await this._layerPrefill(l, MC, p0, s);
          if (check) check(); if (onLayer) await onLayer(l, p0);
        }
        g.runner.flush();
        const done = g.device.queue.onSubmittedWorkDone();
        if (one) { await this._chunkWait(done); if (ringSync) R.sync(); continue; }   // 3.8 test switches (above)
        if (prev) await this._chunkWait(prev);   // at most two chunks in flight (the queued batches' uniform buffers stay bounded)
        prev = done;
      }
      const ML = M - Math.floor((M - 1) / C) * C;                                   // rows in the last chunk
      rowstats(g, { x: { buf: s.x, off: (ML - 1) * D * 4, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
      return await this._head({ buf: s.x, rowB: (ML - 1) * D }, { buf: s.st, off: 1 });
    } finally {
      if (next) next.catch(() => {});
      R.batchSeconds = bs0; g.runner.flush();   // 3.8: the buffers stay for the next prompt
    }
  }
  /** v046: wait for an earlier chunk's GPU work (a method, so a test can time it) */
  async _chunkWait(p) {
    await p;
    if (this.g.lost) throw new GpuError('GPU device lost: ' + JSON.stringify(this.g.lostInfo));
  }

  async _embedTokens(ids, x, st, inputsEmbeds, imageSpans, idbKeep = null) {
    const g = this.g, D = this.D, M = ids.length, sc = Math.fround(this.m.embed_scale);
    const iv = Uint32Array.from(ids.map((i) => (i === this.m.image_token ? this.m.pad : i)));
    let idb = idbKeep;
    if (idb) g.device.queue.writeBuffer(idb, 0, iv); else idb = g.upload(iv, 'ids');   // v046: a buffer kept for the whole prefill when given
    const eh = await this._shard('lm.embed'), et = eh.t('embed_tokens.weight');
    K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: idb }, x: { buf: x }, st: { buf: st }, K: D, scale: sc, n: M });
    this._rel('lm.embed', eh); if (!idbKeep) ffree(g, idb);
    if (inputsEmbeds) { for (const s of imageSpans) g.runner.copy(inputsEmbeds, s.srcOff * D * 4, x, s.pos * D * 4, s.n * D * 4); }
    return null;
  }

  /** v049: the GEMM accumulate mode of the prompt read-in's WEIGHT GEMMs: fp16 partial sums folded into fp32 every 32 k (the engine's
   *  acc 'f16'; the phone's round-4 probe: x1.14-1.17 at these shapes); this.opts.prefillAcc16 === false = v048's fp32 (bit-identical).
   *  Decode (lgemv), the drafter and its verify pass (gemvM) and the attention GEMMs (lops_prefill.js) are untouched. */
  get _pAcc() { return (this.opts || {}).prefillAcc16 === false ? 'f32' : 'f16'; }

  /** pre (v046 load-ahead): { rows (the chunk's scaled PLE rows, read ahead), proj2, out, x16 } = buffers kept for the whole prefill;
   *  v048: the rows are written straight into `out` and combined in place (plefinIP): no separate token-rows buffer */
  async _ple(ids, x, M, pre = null) {
    const g = this.g, D = this.D, NL = this.NL, dp = this.m.ple_dim, NT = NL * dp;
    let tok;
    if (pre) { g.device.queue.writeBuffer(pre.out, 0, pre.rows.buffer, pre.rows.byteOffset, M * NT * 4); tok = null; }   // v048: into the output, combined in place
    else {
      // token-identity part: rows of ple.rows (storage), dequant JS, * sqrt(256); image tokens use the PLE of pad (HF behaviour)
      const tokRows = await this.pleRows(ids.map((i) => (i === this.m.image_token ? this.m.pad : i)));   // Float32Array [M][NT]
      const psc = Math.fround(this.m.ple_scale); for (let i = 0; i < tokRows.length; i++) tokRows[i] = Math.fround(tokRows[i] * psc);
      tok = g.upload(tokRows, 'ple.tok');
    }
    // projection part: per_layer_model_projection(x) [M][NT]
    const gh = await this._shard('lm.global'), pj = gh.t('per_layer_model_projection.weight'), nw = this.nw(gh, 'per_layer_projection_norm.weight');
    const proj2 = pre ? pre.proj2 : g.buffer(M * NT * 4, 'ple.proj'), x16 = pre ? pre.x16 : g.buffer(M * D * 2, 'ple.x16');
    KP.cast16(g, { x: { buf: x }, y: { buf: x16 }, n: M * D });
    gemm(g, { acc: this._pAcc, w: pj, x: { buf: x16, ld: D, mode: 'f16' }, M, N: NT, K: D, epi: 'f32', y: { buf: proj2, ld: NT } });
    const out = pre ? pre.out : g.buffer(M * NT * 4, 'ple');
    if (pre) K.plefinIP(g, { s: { buf: proj2, n: 1, ld: 0 }, norm: { buf: nw.buf, off: nw.off * 4, bytes: 1024 }, out: { buf: out }, nl: NL, dp, n: M, projScale: this.m.ple_proj_scale, rowIn: 0 });
    else K.plefin(g, { s: { buf: proj2, n: 1, ld: 0 }, norm: { buf: nw.buf, off: nw.off * 4, bytes: 1024 }, tok: { buf: tok }, out: { buf: out }, nl: NL, dp, n: M, projScale: this.m.ple_proj_scale, rowIn: 0 });
    this._rel('lm.global', gh); if (!pre) ffree(g, tok, proj2, x16);
    return out;
  }

  async _layerPrefill(l, M, p0, s) {
    const g = this.g, D = this.D, NH = this.NH, hd = this.hd(l), nq = NH * hd, shared = this.kvSrc[l] !== l, kind = this.LT[l], npairs = this.npairs(l), NKV = this.NKV;
    const an = `lm.layer.${String(l).padStart(2, '0')}.a`, mn = `lm.layer.${String(l).padStart(2, '0')}.m`;
    const ah = await this._shard(an); const P = (n) => `layers.${l}.${n}`;
    const cache = this._cache(l), kv0 = 0;   // positions are absolute; cache row = pos (full) handled by attnPre kv0=0; sliding prefill assumes M <= win
    rowstats(g, { x: { buf: s.x, ld: D }, rows: M, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    if (!shared) {
      const qkvw = ah.t(P('self_attn.qkv_proj.weight')), inw = this.nw(ah, P('input_layernorm.weight'));
      gemm(g, { acc: this._pAcc, w: qkvw, x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.st }, pv: { buf: ah.buf, off: inw.off }, M, N: nq + 2 * NKV * hd, K: D, epi: 'f16', y: { buf: s.qkv, ld: nq + 2 * NKV * hd } });
      const qn = this.nw(ah, P('self_attn.q_norm.weight')), kn = this.nw(ah, P('self_attn.k_norm.weight'));
      KP.qkropeP(g, { x: { buf: s.qkv, ld: nq + 2 * NKV * hd }, norm: { buf: ah.buf }, qw: qn.off, kw: kn.off, rope: { buf: this.rope[kind === 'full_attention' ? 'full' : 'sliding'] }, q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, D: hd, nq: NH, hasKV: true, p0, npairs, kv0: p0, ring: cache.ring, M, nkv: NKV, kvLen: cache.len });
    } else {
      const qw = ah.t(P('self_attn.q_proj.weight')), inw = this.nw(ah, P('input_layernorm.weight')), qn = this.nw(ah, P('self_attn.q_norm.weight'));
      gemm(g, { acc: this._pAcc, w: qw, x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.st }, pv: { buf: ah.buf, off: inw.off }, M, N: nq, K: D, epi: 'f16', y: { buf: s.qkv, ld: nq } });
            KP.qkropeP(g, { x: { buf: s.qkv, ld: nq }, norm: { buf: ah.buf }, qw: qn.off, rope: { buf: this.rope[kind === 'full_attention' ? 'full' : 'sliding'] }, q: { buf: s.q }, D: hd, nq: NH, hasKV: false, p0, npairs, kv0: p0, M, nkv: NKV, kvLen: cache.len });
    }
    const aa = { q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, out: { buf: s.ao }, D: hd, nh: NH, T: M, p0, win: kind === 'full_attention' ? 0 : this.win, kv0: 0, ring: cache.ring, nkv: NKV };
    if (s.at) KP.attnPreGemm(g, Object.assign(aa, { len: cache.len }), s.at); else KP.attnPre(g, aa);   // v046: attention as GEMMs (this.opts.prefillAttn)
    // o_proj + residual
    const ow = ah.t(P('self_attn.o_proj.weight'));
    gemm(g, { acc: this._pAcc, w: ow, x: { buf: s.ao, ld: nq, mode: 'f16' }, M, N: D, K: nq, epi: 'f32', y: { buf: s.tbuf, ld: D } });
    const pan = this.nw(ah, P('post_attention_layernorm.weight'));
    K.normadd(g, { D, M, t: { buf: s.tbuf, n: 1, ld: M * D }, w: { buf: ah.buf, off: pan.off }, x: { buf: s.x }, st: { buf: s.st }, eps: this.eps, scale: 1 });
    // PLE gate (needs x before MLP? no: PLE uses hidden AFTER mlp residual). keep ah for gate/proj weights
    // MLP
    rowstats(g, { x: { buf: s.x, ld: D }, rows: M, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    const mh = await this._shard(mn);
    const inter = this.m.intermediate[l], guw = mh.t(P('mlp.gate_up_proj.weight')), pfw = this.nw(mh, P('pre_feedforward_layernorm.weight'));
    gemm(g, { acc: this._pAcc, w: guw, x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.st }, pv: { buf: mh.buf, off: pfw.off }, M, N: 2 * inter, K: D, wr0: 0, wr1: inter, epi: 'swiglu', act: 'gelu', y: { buf: s.mbuf, ld: inter } });
    const dw = mh.t(P('mlp.down_proj.weight'));
    gemm(g, { acc: this._pAcc, w: dw, x: { buf: s.mbuf, ld: inter, mode: 'f16' }, M, N: D, K: inter, epi: 'f32', y: { buf: s.tbuf, ld: D } });
    const pff = this.nw(mh, P('post_feedforward_layernorm.weight'));
    K.normadd(g, { D, M, t: { buf: s.tbuf, n: 1, ld: M * D }, w: { buf: mh.buf, off: pff.off }, x: { buf: s.x }, st: { buf: s.st }, eps: this.eps, scale: 1 });
    this._rel(mn, mh);
    // PLE residual: gate(x) -> gelu -> * ple[l] -> projection -> post_per_layer_input_norm -> + x ; *= layer_scalar
    const giw = ah.t(P('per_layer_input_gate.weight')), ppw = ah.t(P('per_layer_projection.weight')), ppn = this.nw(ah, P('post_per_layer_input_norm.weight'));
    // gate input is the f32 residual x (not normed): gemv raw per row (gemm has no f32-passthrough prologue), then gelu*ple, then projection
    const gf = s.gf || g.buffer(M * 256 * 4, 'gf');   // v046: one per prefill when the loop keeps it
    KP.cast16(g, { x: { buf: s.x }, y: { buf: s.x16 }, n: M * D });
    gemm(g, { acc: this._pAcc, w: giw, x: { buf: s.x16, ld: D, mode: 'f16' }, M, N: 256, K: D, epi: 'f32', y: { buf: gf, ld: 256 } });
    KP.plegate(g, { a: { buf: gf }, ple: { buf: s.ple }, y: { buf: s.gbuf }, M, dp: 256, nl: this.NL, layer: l });
    if (!s.gf) ffree(g, gf);
    gemm(g, { acc: this._pAcc, w: ppw, x: { buf: s.gbuf, ld: 256, mode: 'f16' }, M, N: D, K: 256, epi: 'f32', y: { buf: s.tbuf, ld: D } });
    K.normadd(g, { D, M, t: { buf: s.tbuf, n: 1, ld: M * D }, w: { buf: ah.buf, off: ppn.off }, x: { buf: s.x }, st: { buf: s.st }, eps: this.eps, scale: Math.fround(this.m.layer_scalar[l]) });
    this._rel(an, ah);
  }

  // ---------------------------------------------------------------- one decode step at position `pos`, token id
  //   v044: the token id and the PLE row go into the scratch's PERSISTENT buffers (s.idb / s.pler): nothing is uploaded and freed per
  //   token any more, so the bind-group caches survive.  pleRow = the token's scaled PLE row (Float32Array), or (older callers) a GPU
  //   buffer holding it.  The step-by-step path: part-streamed weights fetch their MLP shards here.
  async decodeStep(id, pos, pleRow, scratch) {
    const g = this.g, D = this.D, s = scratch;
    g.device.queue.writeBuffer(s.idb, 0, Uint32Array.of(id === this.m.image_token ? this.m.pad : id));
    let tokRow = pleRow;
    if (!(pleRow instanceof GPUBuffer)) { g.device.queue.writeBuffer(s.pler, 0, pleRow.buffer, pleRow.byteOffset, pleRow.byteLength); tokRow = s.pler; }
    const eh = await this._shard('lm.embed'), et = eh.t('embed_tokens.weight');
    K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: s.idb }, x: { buf: s.x }, st: { buf: s.st }, K: D, scale: Math.fround(this.m.embed_scale), n: 1 });
    this._rel('lm.embed', eh);
    // PLE projection
    const gh = await this._shard('lm.global');
    this._pleProj(s, gh, tokRow);
    this._rel('lm.global', gh);
    for (let l = this.l0; l < this.l1; l++) await this._layerDecode(l, pos, s);
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    return this._head({ buf: s.x, rowB: 0 }, { buf: s.st, off: 1 });
  }
  _pleProj(s, gh, tokRow) {
    const g = this.g, D = this.D, pj = gh.t('per_layer_model_projection.weight'), nwn = this.nw(gh, 'per_layer_projection_norm.weight'), NT = this.NL * 256;
    K.gemv(g, { w: pj, x: { buf: s.x, rowB: 0 }, N: NT, K: D, pro: 'raw', y: { buf: s.proj } });
    K.plefin(g, { s: { buf: s.proj, n: 1, ld: NT }, norm: { buf: nwn.buf, off: nwn.off * 4, bytes: 1024 }, tok: { buf: tokRow }, out: { buf: s.ple }, nl: this.NL, dp: 256, n: 1, projScale: this.m.ple_proj_scale });
  }

  async _layerDecode(l, pos, s) {
    const an = `lm.layer.${String(l).padStart(2, '0')}.a`, mn = `lm.layer.${String(l).padStart(2, '0')}.m`, ah = await this._shard(an);
    this._attnPart(l, pos, s, ah);
    const mh = await this._shard(mn);
    this._mlpPart(l, s, mh);
    this._rel(mn, mh);
    this._plePart(l, s, ah);
    this._rel(an, ah);
  }
  // v044: a decode layer's dispatches in three synchronous parts (the same sequence as before), so the overlapped loop can record a
  // whole token in one go from the resident weights
  _attnPart(l, pos, s, ah) {
    const g = this.g, D = this.D, NH = this.NH, hd = this.hd(l), nq = NH * hd, shared = this.kvSrc[l] !== l, kind = this.LT[l], npairs = this.npairs(l), P = (n) => `layers.${l}.${n}`, NKV = this.NKV;
    const cache = this._cache(l), row = this._row(cache, pos);
    const kStart = kind === 'full_attention' ? 0 : Math.max(0, pos - this.win + 1), kEnd = pos + 1;
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    if (!shared) {
      const qkvw = ah.t(P('self_attn.qkv_proj.weight')), inw = this.nw(ah, P('input_layernorm.weight'));
      K.gemv(g, { w: qkvw, x: { buf: s.x, rowB: 0 }, N: nq + 2 * NKV * hd, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: { buf: ah.buf, off: inw.off }, y: { buf: s.qkvp } });
      const qn = this.nw(ah, P('self_attn.q_norm.weight')), kn = this.nw(ah, P('self_attn.k_norm.weight'));
      K.qkrope(g, { s: { buf: s.qkvp, n: 1, ld: nq + 2 * NKV * hd }, norm: { buf: ah.buf }, qw: qn.off, kw: kn.off, rope: { buf: this.rope[kind === 'full_attention' ? 'full' : 'sliding'] }, q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, D: hd, nq: NH, hasKV: true, pos, npairs, kvRow: row, nkv: NKV, kvLen: cache.len });
    } else {
      const qw = ah.t(P('self_attn.q_proj.weight')), inw = this.nw(ah, P('input_layernorm.weight')), qn = this.nw(ah, P('self_attn.q_norm.weight'));
      K.gemv(g, { w: qw, x: { buf: s.x, rowB: 0 }, N: nq, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: { buf: ah.buf, off: inw.off }, y: { buf: s.qkvp } });
      K.qkrope(g, { s: { buf: s.qkvp, n: 1, ld: nq }, norm: { buf: ah.buf }, qw: qn.off, rope: { buf: this.rope[kind === 'full_attention' ? 'full' : 'sliding'] }, q: { buf: s.q }, D: hd, nq: NH, hasKV: false, pos, npairs, kvRow: 0 });
    }
    // decode attention over the cache rows holding [kStart, kEnd). For a sliding ring the window is contiguous only if kEnd-kStart<=len.
    this._attnDecode(cache, s, hd, NH, kStart, kEnd);
    const ow = ah.t(P('self_attn.o_proj.weight'));
    K.gemv(g, { w: ow, x: { buf: s.ao, rowB: 0 }, N: D, K: nq, kPer: 2048, pro: 'raw', y: { buf: s.tpart } });
    const splits = Math.ceil(nq / 2048), pan = this.nw(ah, P('post_attention_layernorm.weight'));
    K.normadd(g, { D, t: { buf: s.tpart, n: splits, ld: D }, w: { buf: ah.buf, off: pan.off }, x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps: this.eps, scale: 1 });
  }
  _mlpPart(l, s, mh) {
    const g = this.g, D = this.D, P = (n) => `layers.${l}.${n}`;
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    const inter = this.m.intermediate[l], guw = mh.t(P('mlp.gate_up_proj.weight')), pfw = this.nw(mh, P('pre_feedforward_layernorm.weight'));
    K.gemv(g, { w: guw, x: { buf: s.x, rowB: 0 }, N: inter, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: { buf: mh.buf, off: pfw.off }, epi: 'geglu', y: { buf: s.mbuf } });
    const dw = mh.t(P('mlp.down_proj.weight'));
    K.gemv(g, { w: dw, x: { buf: s.mbuf, rowB: 0 }, N: D, K: inter, kPer: 2048, pro: 'raw', y: { buf: s.tpart } });
    const splits2 = Math.ceil(inter / 2048), pff = this.nw(mh, P('post_feedforward_layernorm.weight'));
    K.normadd(g, { D, t: { buf: s.tpart, n: splits2, ld: D }, w: { buf: mh.buf, off: pff.off }, x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps: this.eps, scale: 1 });
  }
  _plePart(l, s, ah) {
    const g = this.g, D = this.D, P = (n) => `layers.${l}.${n}`;
    const giw = ah.t(P('per_layer_input_gate.weight')), ppw = ah.t(P('per_layer_projection.weight')), ppn = this.nw(ah, P('post_per_layer_input_norm.weight'));
    K.gemv(g, { w: giw, x: { buf: s.x, rowB: 0 }, N: 256, K: D, pro: 'raw', y: { buf: s.gate } });
    K.gemv(g, { w: ppw, x: { buf: s.gate, rowB: 0 }, N: D, K: 256, pro: 'pleg', src: { n: 1, ld: 256 }, ev: { buf: s.ple, off: l * 256 }, y: { buf: s.tpart } });
    K.normadd(g, { D, t: { buf: s.tpart, n: 1, ld: D }, w: { buf: ah.buf, off: ppn.off }, x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps: this.eps, scale: Math.fround(this.m.layer_scalar[l]) });
  }

  _attnDecode(cache, s, hd, NH, kStart, kEnd) {   // keys [kStart, kEnd) by absolute position; the kernel maps ring rows
    K.attnDec(this.g, { q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, part: { buf: s.apart }, out: { buf: s.ao }, D: hd, nh: NH, kStart, kEnd, ring: cache.ring, nkv: this.NKV, kvLen: cache.len });
  }

  _logits() { return this._logitScratch || (this._logitScratch = this.g.buffer(this.m.vocab * 4, 'logits')); }
  /** the head's dispatches (softcapped logits -> per-tile maxima -> argmax into _argScratch); -> the argmax buffer */
  _headWith(xview, statview, gh, eh, logits) {
    const g = this.g, V = this.m.vocab, D = this.D, STOFF = (V / 64) * 2;   // rstd slot past the per-tile max slots (softcap never writes it)
    const nw = this.nw(gh, 'norm.weight'), et = eh.t('embed_tokens.weight');
    const mx = this._mxScratch || (this._mxScratch = g.buffer((V / 64 + 1) * 8, 'mx')), ob = this._argScratch || (this._argScratch = g.buffer(16, 'arg'));
    g.runner.copy(statview.buf, statview.off * 4, mx, STOFF * 4, 4);        // rstd(x) -> the rms prologue reads it from MX
    K.gemv(g, { w: et, x: { buf: xview.buf, rowB: xview.rowB }, N: V, K: D, pro: 'rms', stat: { buf: mx, off: STOFF }, norm: { buf: gh.buf, off: nw.off }, epi: 'softcap', cap: this.m.final_softcap, mx: { buf: mx }, y: { buf: logits } });
    K.argmax(g, { mx: { buf: mx }, out: { buf: ob }, n: V / 64 });
    return ob;
  }
  async _head(xview, statview, wantLogits) {
    const g = this.g, V = this.m.vocab;
    const gh = await this._shard('lm.global'), eh = await this._shard('lm.embed');
    const logits = wantLogits ? g.buffer(V * 4, 'logits') : this._logits();
    const ob = this._headWith(xview, statview, gh, eh, logits);
    this._rel('lm.global', gh); this._rel('lm.embed', eh);
    const o = new Uint32Array(await g.read(ob, 0, 8));
    const r = { argmax: o[0], maxLogit: new Float32Array(new Uint32Array([o[1]]).buffer)[0], logitsBuf: logits };
    return r;
  }

  // ---------------------------------------------------------------- v044: the overlapped decode loop (round 2 of the chat speed)
  /** record one whole decode token at `pos` from the RESIDENT weights into g.runner (the DecodeRunner while the loop records): the token
   *  id and PLE row are read from s.idb / s.pler, which the loop writes just before the submit; -> the argmax buffer */
  encodeStep(pos, s) {
    const g = this.g, D = this.D, R = (n) => { const h = this.resident.get(n); if (!h) throw new Error('encodeStep needs resident weights: ' + n); return h; };
    const eh = R('lm.embed'), gh = R('lm.global'), et = eh.t('embed_tokens.weight');
    K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: s.idb }, x: { buf: s.x }, st: { buf: s.st }, K: D, scale: Math.fround(this.m.embed_scale), n: 1 });
    this._pleProj(s, gh, s.pler);
    for (let l = this.l0; l < this.l1; l++) {
      const ah = R(`lm.layer.${String(l).padStart(2, '0')}.a`), mh = R(`lm.layer.${String(l).padStart(2, '0')}.m`);
      this._attnPart(l, pos, s, ah); this._mlpPart(l, s, mh); this._plePart(l, s, ah);
    }
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    return this._headWith({ buf: s.x, rowB: 0 }, { buf: s.st, off: 1 }, gh, eh, this._logits());
  }
  /** decode up to o.steps tokens after o.first (at positions o.pos0, o.pos0 + 1, ...).  Each token is recorded while the GPU still runs
   *  the one before it, then submitted as soon as that token's id is known, so the GPU no longer waits for the CPU between tokens.
   *  v045: the next token is submitted BEFORE this token's callbacks (onToken, check) run, so the caller's per-token work (the chat's
   *  text, the UI) overlaps the GPU too.  onToken therefore runs while the next token is on the GPU: it may read r.argmax / r.maxLogit,
   *  not r.logitsBuf (pick runs before the next submit and may read it).
   *  o: { first, pos0, steps, pleRow(id) -> Float32Array (scaled), eos(id) -> bool, pick(r, i) -> next id (default greedy r.argmax;
   *  the sampler reads r.logitsBuf), samp (3.8: pick's settings { temperature, topP, topK, seed }: with the drafter, speculative
   *  sampling instead of pick), onToken(id, r, i), check(), stats (an object the loop fills; stats.gpuTimer = GPU busy too) }
   *  -> { ids, stopped: 'eos' | 'length' }.  Part-streamed weights take the step-by-step path (decodeStep). */
  async decodeLoop(s, o) {
    if (this.streamedMlp && this.streamedMlp.length) return this._decodeLoopSeq(s, o);
    const sp = this._specConf(o);
    if (sp && sp.samp) return this._specSampled(s, o, sp);   // 3.8: a sampled answer with the drafter
    if (sp) return specLoop(this, s, o, sp);   // v047: the drafter + one verify pass per k + 1 tokens
    const g = this.g, core = g.runner, st = o.stats || null, eos = o.eos || (() => false), now = () => performance.now();
    const dr = new DecodeRunner(g, { timer: !!(st && st.gpuTimer) }), T = { enc: 0, ple: 0, write: 0, wait: 0, cb: 0 };
    const rec = (pos, parity) => {
      const a = now(); g.runner = dr;
      try { dr.begin(parity); const ob = this.encodeStep(pos, s); return dr.end(ob); }
      finally { g.runner = core; if (dr.cur) dr.cur = null; T.enc += now() - a; }
    };
    const ids = []; let stopped = 'length', pend = null, tk = null; const t0 = now();
    const feed = async (id, i) => {   // token i's input: write the id + its PLE row, then submit token i (recorded earlier)
      if (!tk) tk = rec(o.pos0 + i, i & 1);   // the first token (later ones were recorded while the GPU ran the token before)
      let a = now(); const row = await o.pleRow(id); T.ple += now() - a;
      a = now();
      g.device.queue.writeBuffer(s.idb, 0, Uint32Array.of(id === this.m.image_token ? this.m.pad : id));
      g.device.queue.writeBuffer(s.pler, 0, row.buffer, row.byteOffset, row.byteLength);
      T.write += now() - a;
      pend = dr.submit(tk); tk = null;
    };
    core.flush();   // nothing of the core runner's may still wait behind a decode token
    try {
      if (o.steps > 0) {
        if (o.check) o.check();
        if (eos(o.first)) stopped = 'eos';
        else {
          await feed(o.first, 0);
          if (o.steps > 1) tk = rec(o.pos0 + 1, 1);   // token 1, recorded while token 0 runs
          for (let i = 0; i < o.steps; i++) {
            let a = now(); const o32 = await pend; pend = null; T.wait += now() - a;
            const r = { argmax: o32[0], maxLogit: new Float32Array(new Uint32Array([o32[1]]).buffer)[0], logitsBuf: this._logits() };
            const nxt = o.pick ? await o.pick(r, i) : r.argmax;
            ids.push(nxt);
            const more = i + 1 < o.steps, end = eos(nxt);
            if (more && !end) await feed(nxt, i + 1);   // the GPU starts token i + 1 before this token's callbacks run
            a = now();
            if (o.onToken) o.onToken(nxt, r, i);
            if (more && o.check) o.check();
            T.cb += now() - a;
            if (more && end) { stopped = 'eos'; break; }
            if (i + 2 < o.steps) tk = rec(o.pos0 + i + 2, i & 1);   // token i + 2, recorded while token i + 1 runs
          }
        }
      }
    } finally {
      if (pend) { try { await pend; } catch (e) { /* */ } }   // never leave a staging buffer mapping
      await dr.destroy();
      if (st) {
        const n = Math.max(1, ids.length), r2 = (v) => +(+v).toFixed(2);
        Object.assign(st, { loop: 'overlapped', tokens: ids.length, wallMs: Math.round(now() - t0), encodeMs: r2(T.enc / n), pleMs: r2(T.ple / n), writeMs: r2(T.write / n),
          waitMs: r2(T.wait / n), callbackMs: r2(T.cb / n), dispatches: r2(dr.dispatches / n), submits: r2(dr.submits / n), bindGroupsNew: dr.bgNew, bindGroupsCached: dr.bgHit,
          gpuBusyMs: dr.timer && dr.timer.tokens ? r2(dr.timer.busyMs / dr.timer.tokens) : null });
      }
    }
    return { ids, stopped };
  }
  /** v047: Google's MTP drafter (drafter.js), loaded once next to the resident weights; url = the drafter pack (manifest.json) */
  async loadDrafter(url, op = {}) {
    if (!this.drafter) this.drafter = await loadDrafter(this.g, url, Object.assign({ ctxCap: this.ctxCap || 4096 }, op));
    return { MB: Math.round(this.drafter.bytes / 1e6), layers: this.drafter.m.layers, hidden: this.drafter.m.hidden };
  }
  /** p0pc0rn 3.8: the drafter from its downloaded pack (llm_engine.js: a WeightStore of its own on the same storage worker) */
  async loadDrafterFrom(store, op = {}) {
    if (!this.drafter) this.drafter = await drafterFromStore(this.g, store, Object.assign({ ctxCap: this.ctxCap || 4096 }, op));
    return { MB: Math.round(this.drafter.bytes / 1e6), layers: this.drafter.m.layers, hidden: this.drafter.m.hidden };
  }
  releaseDrafter() { if (this.drafter) { this.drafter.release(); this.drafter = null; } }
  /** v047: speculative decode when a drafter is loaded, the decode is greedy (no sampler) and this.opts asks for it.
   *  3.8: also a sampled decode whose settings speculative sampling takes exactly (o.samp: a temperature and a top-K of 1..64, the rows'
   *  top 64 on the GPU), unless it could not run on this GPU before (this._sampOff); any other sampler = the plain loop */
  _specConf(o) {
    const op = this.opts || {}, sm = o.samp || null;
    if (!this.drafter || !((op.specK | 0) > 0 || op.specAdaptive || op.specKTest)) return null;
    if (o.pick && !(sm && sm.temperature > 0 && sm.topK >= 1 && sm.topK <= SAMP_KMAX && !this._sampOff)) return null;
    const adaptive = !!op.specAdaptive;   // v048: adaptive = the cost-aware k unless specPolicy says 'simple' (v047's rule)
    return { k: (op.specK | 0) > 0 ? op.specK | 0 : 2, adaptive, kmax: op.specKmax || 4, policy: adaptive ? (op.specPolicy || 'cost') : 'fixed',
      ktest: Array.isArray(op.specKTest) && op.specKTest.length ? op.specKTest : null, samp: o.pick ? sm : null, rowCache: o.pick ? 256 : 0 };
  }
  /** 3.8: speculative sampling (spec.js).  If this GPU can't run it (its kernels don't build, or a pass reads back nonsense), the answer
   *  goes on from its last good token with the plain sampled loop (o.pick), and later answers on this load take the plain loop at once.
   *  -> decodeLoop's { ids, stopped } (+ samplingError: why, when it fell back) */
  async _specSampled(s, o, sp) {
    let why = await sampReady(this), done = [];
    if (!why) {
      try { return await specLoop(this, s, o, sp); }
      catch (e) { if (!e || !e.sampIds) throw e; why = String(e.message); done = e.sampIds; }   // anything else (a cancel, a lost GPU) goes up as before
    }
    this._sampOff = why;
    const n = done.length, on = o.onToken;
    const r = await this.decodeLoop(s, Object.assign({}, o, { first: n ? done[n - 1] : o.first, pos0: o.pos0 + n, steps: o.steps - n, samp: null,
      onToken: on ? (id, x, i) => on(id, x, i + n) : null }));
    if (o.stats) Object.assign(o.stats, { samplingError: why, sampledBeforeFallback: n });
    return { ids: done.concat(r.ids), stopped: r.stopped, samplingError: why };
  }
  /** the step-by-step loop (part-streamed weights): same contract as decodeLoop */
  async _decodeLoopSeq(s, o) {
    const eos = o.eos || (() => false), ids = []; let last = o.first, stopped = 'length';
    for (let i = 0; i < o.steps; i++) {
      if (o.check) o.check();
      if (eos(last)) { stopped = 'eos'; break; }
      const row = await o.pleRow(last);
      const r = await this.decodeStep(last, o.pos0 + i, row, s);
      const nxt = o.pick ? await o.pick(r, i) : r.argmax;
      ids.push(nxt); last = nxt;
      if (o.onToken) o.onToken(nxt, r, i);
    }
    if (o.stats) Object.assign(o.stats, { loop: 'step-by-step', tokens: ids.length });
    return { ids, stopped };
  }
  async readLogits(buf, ids) { const out = {}; for (const id of ids) out[id] = f32(await this.g.read(buf, id * 4, 4))[0]; return out; }

  allocScratch() {
    const g = this.g, D = this.D, V = this.m.vocab, maxHd = this.m.global_head_dim, maxInter = Math.max(...this.m.intermediate), NT = this.NL * 256;
    const B = (n, l) => g.buffer(PAD(n), l);
    return {
      x: B(D * 4, 'd.x'), st: B(64, 'd.st'), proj: B(NT * 4, 'd.proj'), ple: B(NT * 4, 'd.ple'),
      qkvp: B((this.NH * maxHd + 2 * this.NKV * maxHd) * 4, 'd.qkv'), q: B(this.NH * maxHd * 4, 'd.q'), ao: B(this.NH * maxHd * 4, 'd.ao'),
      apart: B(Math.ceil(this.ctxCap / 64) * this.NH * (2 + maxHd) * 4, 'd.apart'), tpart: B(Math.ceil(maxInter / 2048) * D * 4, 'd.tpart'),
      mbuf: B(maxInter * 4, 'd.m'), gate: B(256 * 4, 'd.gate'),   // 3.9 (E4B room): - two unused window buffers (0.5 MB each)
      idb: B(16, 'd.id'), pler: B(NT * 4, 'd.pleRow'),   // v044: the token id + its PLE row, written per token (never freed per token)
    };
  }
  freeScratch(s) { this.g.runner.flush(); for (const b of Object.values(s)) this.g.free(b); }
  /** 3.8: the decode scratch, kept on the model from answer to answer (made once per load, freed with the model) */
  scratch() {
    if (this._scr && this._scrCap !== this.ctxCap) { this.freeScratch(this._scr); this._scr = null; }   // its attention partials follow ctxCap
    if (!this._scr) { this._scr = this.allocScratch(); this._scrCap = this.ctxCap; }
    return this._scr;
  }
  freeHeadScratch() { for (const k of ['_logitScratch', '_mxScratch', '_argScratch']) if (this[k]) { this.g.free(this[k]); this[k] = null; } }
}
