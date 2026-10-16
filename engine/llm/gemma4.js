// Gemma 4 E2B-it runner on WebGPU (p0pc0rn LLM module).  Pure JS + WGSL, f32 residual + f32 norm stats + f32 GEMM/GEMV accumulate,
// f16 activation / KV storage.  Weights per the pack manifest (gemma4-text arch).  Two residency modes:
//   'resident'  all layer shards uploaded once, kept on the GPU (fast decode; ~1.4 GB at q4)
//   'stream'    each layer's two shards uploaded per token from OPFS and freed (slower; fits a smaller budget)
// Per-Layer Embeddings (PLE): the 2.35 GB embed_tokens_per_layer table is NEVER uploaded; its row for each token id is read from
// storage (ple.rows) and dequantised in JS.  KV sharing: layers >= 15 reuse the post-RoPE K/V of layer 13 (sliding) / 14 (full);
// those caches are the only ones kept, and sliding caches keep just the last `sliding_window` positions (ring buffer).
'use strict';
import { gemm } from '../ops/gemm.js';
import { rowstats } from '../ops/misc.js';
import * as K from './lops.js';
import * as KP from './lops_prefill.js';

const f32 = (b) => new Float32Array(b);
const ffree = (g, ...bs) => { g.runner.flush(); for (const b of bs) if (b) g.free(b); };   // never destroy a buffer an unsubmitted dispatch uses
const PAD = (n) => Math.ceil(n / 256) * 256;

export class Gemma4 {
  constructor(gpu, store) {
    this.g = gpu; this.store = store; this.m = store.m.model; this.cfg = store.m;
    this.NL = this.m.layers; this.D = this.m.hidden; this.NH = this.m.heads;
    this.LT = this.m.layer_types; this.kvSrc = this.m.kv_source; this.win = this.m.sliding_window; this.eps = this.m.rms_eps;
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
    const names = ['lm.embed', 'lm.global'];
    for (let l = 0; l < this.NL; l++) { names.push(`lm.layer.${String(l).padStart(2, '0')}.a`, `lm.layer.${String(l).padStart(2, '0')}.m`); }
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
  allocKV(cap, chunk = 256) {
    this.freeKV();
    const kv = []; this.ctxCap = cap;
    for (let l = 0; l < this.NL; l++) {
      if (l >= 15) { kv.push(null); continue; }
      const full = this.LT[l] === 'full_attention', hd = this.hd(l), ring = (!full && cap > this.win + chunk) ? this.win + chunk : 0, len = ring || cap;
      kv.push({ full, hd, len, ring, kc: this.g.buffer(len * hd * 2, `kc${l}`), vc: this.g.buffer(len * hd * 2, `vc${l}`) });
    }
    this.kv = kv;
  }
  freeKV() { this.g.runner.flush(); if (this.kv) for (const c of this.kv) if (c) { this.g.free(c.kc); this.g.free(c.vc); } this.kv = null; }
  _cache(l) { return this.kv[this.kvSrc[l]]; }
  _row(c, pos) { return c.ring ? pos % c.ring : pos; }

  // ---------------------------------------------------------------- prefill: chunks of C tokens (positions p0 .. p0+C-1), each chunk
  //   attends to every earlier position through the KV cache; activation memory is bounded by C, not by the prompt length.
  async prefill(ids, { inputsEmbeds = null, imageSpans = [], check, onLayer, chunk } = {}) {
    const g = this.g, M = ids.length, D = this.D, NL = this.NL, NH = this.NH, C = Math.min(M, chunk || this.opts?.chunk || 256);
    this._ensureRope(this.ctxCap || M + 2048);
    this.allocKV(this.ctxCap || M + 2048, C);
    const maxHd = this.m.global_head_dim, maxInter = Math.max(...this.m.intermediate);
    const x = g.buffer(C * D * 4, 'x'), st = g.buffer(PAD(C * 2 * 4), 'st');
    const qkv = g.buffer(C * (NH * maxHd + 2 * maxHd) * 2, 'qkv'), q = g.buffer(C * NH * maxHd * 2, 'q'), ao = g.buffer(C * NH * maxHd * 2, 'ao');
    const tbuf = g.buffer(C * D * 4, 'tbuf'), mbuf = g.buffer(C * maxInter * 2, 'mbuf'), gbuf = g.buffer(C * 256 * 2, 'gbuf'), x16 = g.buffer(C * D * 2, 'x16');
    const free = [x, st, qkv, q, ao, tbuf, mbuf, gbuf, x16];
    this._dbg = { x, st, qkv, q, ao, tbuf, mbuf, gbuf, x16 };
    let ple = null, r = null;
    try {
      for (let p0 = 0; p0 < M; p0 += C) {
        const idc = ids.slice(p0, p0 + C), MC = idc.length;
        const spans = imageSpans.filter((sp) => sp.pos >= p0 && sp.pos < p0 + MC).map((sp) => Object.assign({}, sp, { pos: sp.pos - p0 }));
        await this._embedTokens(idc, x, st, inputsEmbeds, spans);
        ple = await this._ple(idc, x, MC);                                          // f32 [MC][NL*256]
        this._dbg.ple = ple; if (onLayer) await onLayer(-1, p0);
        for (let l = 0; l < NL; l++) {
          await this._layerPrefill(l, MC, p0, { x, st, qkv, q, ao, tbuf, mbuf, gbuf, ple, x16 });
          if (check) check(); if (onLayer) await onLayer(l, p0);
        }
        g.runner.flush(); g.free(ple); ple = null;
        if (p0 + C < M) await g.done();   // p0pc0rn v024: one chunk in flight at a time (each queued batch holds a uniform buffer: ~110 MB on a 3,000-token prompt)
      }
      const ML = M - Math.floor((M - 1) / C) * C;                                   // rows in the last chunk
      rowstats(g, { x: { buf: x, off: (ML - 1) * D * 4, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: st } });
      r = await this._head({ buf: x, rowB: (ML - 1) * D }, { buf: st, off: 1 });
      return r;
    } finally { g.runner.flush(); for (const b of free) g.free(b); if (ple) g.free(ple); }
  }

  async _embedTokens(ids, x, st, inputsEmbeds, imageSpans) {
    const g = this.g, D = this.D, M = ids.length, sc = Math.fround(this.m.embed_scale);
    const idb = g.upload(Uint32Array.from(ids.map((i) => (i === this.m.image_token ? this.m.pad : i))), 'ids');
    const eh = await this._shard('lm.embed'), et = eh.t('embed_tokens.weight');
    K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: idb }, x: { buf: x }, st: { buf: st }, K: D, scale: sc, n: M });
    this._rel('lm.embed', eh); ffree(g, idb);
    if (inputsEmbeds) { for (const s of imageSpans) g.runner.copy(inputsEmbeds, s.srcOff * D * 4, x, s.pos * D * 4, s.n * D * 4); }
    return null;
  }

  async _ple(ids, x, M) {
    const g = this.g, D = this.D, NL = this.NL, dp = this.m.ple_dim, NT = NL * dp;
    // token-identity part: rows of ple.rows (storage), dequant JS, * sqrt(256); image tokens use the PLE of pad (HF behaviour)
    const tokRows = await this.pleRows(ids.map((i) => (i === this.m.image_token ? this.m.pad : i)));   // Float32Array [M][NT]
    const psc = Math.fround(this.m.ple_scale); for (let i = 0; i < tokRows.length; i++) tokRows[i] = Math.fround(tokRows[i] * psc);
    const tok = g.upload(tokRows, 'ple.tok');
    // projection part: per_layer_model_projection(x) [M][NT]
    const gh = await this._shard('lm.global'), pj = gh.t('per_layer_model_projection.weight'), nw = this.nw(gh, 'per_layer_projection_norm.weight');
    const proj2 = g.buffer(M * NT * 4, 'ple.proj'), x16 = g.buffer(M * D * 2, 'ple.x16');
    KP.cast16(g, { x: { buf: x }, y: { buf: x16 }, n: M * D });
    gemm(g, { acc: 'f32', w: pj, x: { buf: x16, ld: D, mode: 'f16' }, M, N: NT, K: D, epi: 'f32', y: { buf: proj2, ld: NT } });
    const out = g.buffer(M * NT * 4, 'ple');
    K.plefin(g, { s: { buf: proj2, n: 1, ld: 0 }, norm: { buf: nw.buf, off: nw.off * 4, bytes: 1024 }, tok: { buf: tok }, out: { buf: out }, nl: NL, dp, n: M, projScale: this.m.ple_proj_scale, rowIn: 0 });
    this._rel('lm.global', gh); ffree(g, tok, proj2, x16);
    return out;
  }

  async _layerPrefill(l, M, p0, s) {
    const g = this.g, D = this.D, NH = this.NH, hd = this.hd(l), nq = NH * hd, shared = l >= 15, kind = this.LT[l], npairs = this.npairs(l);
    const an = `lm.layer.${String(l).padStart(2, '0')}.a`, mn = `lm.layer.${String(l).padStart(2, '0')}.m`;
    const ah = await this._shard(an); const P = (n) => `layers.${l}.${n}`;
    const cache = this._cache(l), kv0 = 0;   // positions are absolute; cache row = pos (full) handled by attnPre kv0=0; sliding prefill assumes M <= win
    rowstats(g, { x: { buf: s.x, ld: D }, rows: M, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    if (!shared) {
      const qkvw = ah.t(P('self_attn.qkv_proj.weight')), inw = this.nw(ah, P('input_layernorm.weight'));
      gemm(g, { acc: 'f32', w: qkvw, x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.st }, pv: { buf: ah.buf, off: inw.off }, M, N: nq + 2 * hd, K: D, epi: 'f16', y: { buf: s.qkv, ld: nq + 2 * hd } });
      const qn = this.nw(ah, P('self_attn.q_norm.weight')), kn = this.nw(ah, P('self_attn.k_norm.weight'));
      KP.qkropeP(g, { x: { buf: s.qkv, ld: nq + 2 * hd }, norm: { buf: ah.buf }, qw: qn.off, kw: kn.off, rope: { buf: this.rope[kind === 'full_attention' ? 'full' : 'sliding'] }, q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, D: hd, nq: NH, hasKV: true, p0, npairs, kv0: p0, ring: cache.ring, M });
    } else {
      const qw = ah.t(P('self_attn.q_proj.weight')), inw = this.nw(ah, P('input_layernorm.weight')), qn = this.nw(ah, P('self_attn.q_norm.weight'));
      gemm(g, { acc: 'f32', w: qw, x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.st }, pv: { buf: ah.buf, off: inw.off }, M, N: nq, K: D, epi: 'f16', y: { buf: s.qkv, ld: nq } });
            KP.qkropeP(g, { x: { buf: s.qkv, ld: nq }, norm: { buf: ah.buf }, qw: qn.off, rope: { buf: this.rope[kind === 'full_attention' ? 'full' : 'sliding'] }, q: { buf: s.q }, D: hd, nq: NH, hasKV: false, p0, npairs, kv0: p0, M });
    }
    KP.attnPre(g, { q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, out: { buf: s.ao }, D: hd, nh: NH, T: M, p0, win: kind === 'full_attention' ? 0 : this.win, kv0: 0, ring: cache.ring });
    // o_proj + residual
    const ow = ah.t(P('self_attn.o_proj.weight'));
    gemm(g, { acc: 'f32', w: ow, x: { buf: s.ao, ld: nq, mode: 'f16' }, M, N: D, K: nq, epi: 'f32', y: { buf: s.tbuf, ld: D } });
    const pan = this.nw(ah, P('post_attention_layernorm.weight'));
    K.normadd(g, { D, M, t: { buf: s.tbuf, n: 1, ld: M * D }, w: { buf: ah.buf, off: pan.off }, x: { buf: s.x }, st: { buf: s.st }, eps: this.eps, scale: 1 });
    // PLE gate (needs x before MLP? no: PLE uses hidden AFTER mlp residual). keep ah for gate/proj weights
    // MLP
    rowstats(g, { x: { buf: s.x, ld: D }, rows: M, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    const mh = await this._shard(mn);
    const inter = this.m.intermediate[l], guw = mh.t(P('mlp.gate_up_proj.weight')), pfw = this.nw(mh, P('pre_feedforward_layernorm.weight'));
    gemm(g, { acc: 'f32', w: guw, x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.st }, pv: { buf: mh.buf, off: pfw.off }, M, N: 2 * inter, K: D, wr0: 0, wr1: inter, epi: 'swiglu', act: 'gelu', y: { buf: s.mbuf, ld: inter } });
    const dw = mh.t(P('mlp.down_proj.weight'));
    gemm(g, { acc: 'f32', w: dw, x: { buf: s.mbuf, ld: inter, mode: 'f16' }, M, N: D, K: inter, epi: 'f32', y: { buf: s.tbuf, ld: D } });
    const pff = this.nw(mh, P('post_feedforward_layernorm.weight'));
    K.normadd(g, { D, M, t: { buf: s.tbuf, n: 1, ld: M * D }, w: { buf: mh.buf, off: pff.off }, x: { buf: s.x }, st: { buf: s.st }, eps: this.eps, scale: 1 });
    this._rel(mn, mh);
    // PLE residual: gate(x) -> gelu -> * ple[l] -> projection -> post_per_layer_input_norm -> + x ; *= layer_scalar
    const giw = ah.t(P('per_layer_input_gate.weight')), ppw = ah.t(P('per_layer_projection.weight')), ppn = this.nw(ah, P('post_per_layer_input_norm.weight'));
    // gate input is the f32 residual x (not normed): gemv raw per row (gemm has no f32-passthrough prologue), then gelu*ple, then projection
    const gf = g.buffer(M * 256 * 4, 'gf');
    KP.cast16(g, { x: { buf: s.x }, y: { buf: s.x16 }, n: M * D });
    gemm(g, { acc: 'f32', w: giw, x: { buf: s.x16, ld: D, mode: 'f16' }, M, N: 256, K: D, epi: 'f32', y: { buf: gf, ld: 256 } });
    KP.plegate(g, { a: { buf: gf }, ple: { buf: s.ple }, y: { buf: s.gbuf }, M, dp: 256, nl: this.NL, layer: l });
    ffree(g, gf);
    gemm(g, { acc: 'f32', w: ppw, x: { buf: s.gbuf, ld: 256, mode: 'f16' }, M, N: D, K: 256, epi: 'f32', y: { buf: s.tbuf, ld: D } });
    K.normadd(g, { D, M, t: { buf: s.tbuf, n: 1, ld: M * D }, w: { buf: ah.buf, off: ppn.off }, x: { buf: s.x }, st: { buf: s.st }, eps: this.eps, scale: Math.fround(this.m.layer_scalar[l]) });
    this._rel(an, ah);
  }

  // ---------------------------------------------------------------- one decode step at position `pos`, token id
  async decodeStep(id, pos, pleRow, scratch) {
    const g = this.g, D = this.D, NH = this.NH, s = scratch;
    const idb = g.upload(Uint32Array.of(id === this.m.image_token ? this.m.pad : id), 'id');
    const eh = await this._shard('lm.embed'), et = eh.t('embed_tokens.weight');
    K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: idb }, x: { buf: s.x }, st: { buf: s.st }, K: D, scale: Math.fround(this.m.embed_scale), n: 1 });
    this._rel('lm.embed', eh); ffree(g, idb);
    // PLE projection
    const gh = await this._shard('lm.global'), pj = gh.t('per_layer_model_projection.weight'), nwn = this.nw(gh, 'per_layer_projection_norm.weight'), NT = this.NL * 256;
    K.gemv(g, { w: pj, x: { buf: s.x, rowB: 0 }, N: NT, K: D, pro: 'raw', y: { buf: s.proj } });
    K.plefin(g, { s: { buf: s.proj, n: 1, ld: NT }, norm: { buf: nwn.buf, off: nwn.off * 4, bytes: 1024 }, tok: { buf: pleRow }, out: { buf: s.ple }, nl: this.NL, dp: 256, n: 1, projScale: this.m.ple_proj_scale });
    this._rel('lm.global', gh);
    for (let l = 0; l < this.NL; l++) await this._layerDecode(l, pos, s);
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    return this._head({ buf: s.x, rowB: 0 }, { buf: s.st, off: 1 });
  }

  async _layerDecode(l, pos, s) {
    const g = this.g, D = this.D, NH = this.NH, hd = this.hd(l), nq = NH * hd, shared = l >= 15, kind = this.LT[l], npairs = this.npairs(l);
    const an = `lm.layer.${String(l).padStart(2, '0')}.a`, mn = `lm.layer.${String(l).padStart(2, '0')}.m`, ah = await this._shard(an), P = (n) => `layers.${l}.${n}`;
    const cache = this._cache(l), row = this._row(cache, pos);
    const kStart = kind === 'full_attention' ? 0 : Math.max(0, pos - this.win + 1), kEnd = pos + 1;
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    if (!shared) {
      const qkvw = ah.t(P('self_attn.qkv_proj.weight')), inw = this.nw(ah, P('input_layernorm.weight'));
      K.gemv(g, { w: qkvw, x: { buf: s.x, rowB: 0 }, N: nq + 2 * hd, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: { buf: ah.buf, off: inw.off }, y: { buf: s.qkvp } });
      const qn = this.nw(ah, P('self_attn.q_norm.weight')), kn = this.nw(ah, P('self_attn.k_norm.weight'));
      K.qkrope(g, { s: { buf: s.qkvp, n: 1, ld: nq + 2 * hd }, norm: { buf: ah.buf }, qw: qn.off, kw: kn.off, rope: { buf: this.rope[kind === 'full_attention' ? 'full' : 'sliding'] }, q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, D: hd, nq: NH, hasKV: true, pos, npairs, kvRow: row });
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
    // MLP
    const mh = await this._shard(mn);
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: this.eps, st: { buf: s.st } });
    const inter = this.m.intermediate[l], guw = mh.t(P('mlp.gate_up_proj.weight')), pfw = this.nw(mh, P('pre_feedforward_layernorm.weight'));
    K.gemv(g, { w: guw, x: { buf: s.x, rowB: 0 }, N: inter, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: { buf: mh.buf, off: pfw.off }, epi: 'geglu', y: { buf: s.mbuf } });
    const dw = mh.t(P('mlp.down_proj.weight'));
    K.gemv(g, { w: dw, x: { buf: s.mbuf, rowB: 0 }, N: D, K: inter, kPer: 2048, pro: 'raw', y: { buf: s.tpart } });
    const splits2 = Math.ceil(inter / 2048), pff = this.nw(mh, P('post_feedforward_layernorm.weight'));
    K.normadd(g, { D, t: { buf: s.tpart, n: splits2, ld: D }, w: { buf: mh.buf, off: pff.off }, x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps: this.eps, scale: 1 });
    this._rel(mn, mh);
    // PLE
    const giw = ah.t(P('per_layer_input_gate.weight')), ppw = ah.t(P('per_layer_projection.weight')), ppn = this.nw(ah, P('post_per_layer_input_norm.weight'));
    K.gemv(g, { w: giw, x: { buf: s.x, rowB: 0 }, N: 256, K: D, pro: 'raw', y: { buf: s.gate } });
    K.gemv(g, { w: ppw, x: { buf: s.gate, rowB: 0 }, N: D, K: 256, pro: 'pleg', src: { n: 1, ld: 256 }, ev: { buf: s.ple, off: l * 256 }, y: { buf: s.tpart } });
    K.normadd(g, { D, t: { buf: s.tpart, n: 1, ld: D }, w: { buf: ah.buf, off: ppn.off }, x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps: this.eps, scale: Math.fround(this.m.layer_scalar[l]) });
    this._rel(an, ah);
  }

  _attnDecode(cache, s, hd, NH, kStart, kEnd) {   // keys [kStart, kEnd) by absolute position; the kernel maps ring rows
    K.attnDec(this.g, { q: { buf: s.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, part: { buf: s.apart }, out: { buf: s.ao }, D: hd, nh: NH, kStart, kEnd, ring: cache.ring });
  }

  async _head(xview, statview, wantLogits) {
    const g = this.g, V = this.m.vocab, D = this.D, STOFF = (V / 64) * 2;   // rstd slot past the per-tile max slots (softcap never writes it)
    const gh = await this._shard('lm.global'); const nw = this.nw(gh, 'norm.weight');
    const eh = await this._shard('lm.embed'), et = eh.t('embed_tokens.weight');
    const logits = wantLogits ? g.buffer(V * 4, 'logits') : (this._logitScratch || (this._logitScratch = g.buffer(V * 4, 'logits')));
    const mx = this._mxScratch || (this._mxScratch = g.buffer((V / 64 + 1) * 8, 'mx')), ob = this._argScratch || (this._argScratch = g.buffer(16, 'arg'));
    g.runner.copy(statview.buf, statview.off * 4, mx, STOFF * 4, 4);        // rstd(x) -> the rms prologue reads it from MX
    K.gemv(g, { w: et, x: { buf: xview.buf, rowB: xview.rowB }, N: V, K: D, pro: 'rms', stat: { buf: mx, off: STOFF }, norm: { buf: gh.buf, off: nw.off }, epi: 'softcap', cap: this.m.final_softcap, mx: { buf: mx }, y: { buf: logits } });
    K.argmax(g, { mx: { buf: mx }, out: { buf: ob }, n: V / 64 });
    this._rel('lm.global', gh); this._rel('lm.embed', eh);
    const o = new Uint32Array(await g.read(ob, 0, 8));
    const r = { argmax: o[0], maxLogit: new Float32Array(new Uint32Array([o[1]]).buffer)[0], logitsBuf: logits };
    return r;
  }
  async readLogits(buf, ids) { const out = {}; for (const id of ids) out[id] = f32(await this.g.read(buf, id * 4, 4))[0]; return out; }

  allocScratch() {
    const g = this.g, D = this.D, V = this.m.vocab, maxHd = this.m.global_head_dim, maxInter = Math.max(...this.m.intermediate), NT = this.NL * 256;
    const B = (n, l) => g.buffer(PAD(n), l);
    return {
      x: B(D * 4, 'd.x'), st: B(64, 'd.st'), proj: B(NT * 4, 'd.proj'), ple: B(NT * 4, 'd.ple'),
      qkvp: B((this.NH * maxHd + 2 * maxHd) * 4, 'd.qkv'), q: B(this.NH * maxHd * 4, 'd.q'), ao: B(this.NH * maxHd * 4, 'd.ao'),
      apart: B(Math.ceil(this.ctxCap / 64) * this.NH * (2 + maxHd) * 4, 'd.apart'), tpart: B(Math.ceil(maxInter / 2048) * D * 4, 'd.tpart'),
      mbuf: B(maxInter * 4, 'd.m'), gate: B(256 * 4, 'd.gate'), kcl: B(this.win * maxHd * 2, 'd.kcl'), vcl: B(this.win * maxHd * 2, 'd.vcl'),
    };
  }
  freeScratch(s) { this.g.runner.flush(); for (const b of Object.values(s)) this.g.free(b); }
  freeHeadScratch() { for (const k of ['_logitScratch', '_mxScratch', '_argScratch']) if (this[k]) { this.g.free(this[k]); this[k] = null; } }
}
