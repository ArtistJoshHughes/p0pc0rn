// Google's Gemma 4 E2B MTP drafter (google/gemma-4-E2B-it-assistant @ 2d874ef7, Apache-2.0) on WebGPU (p0pc0rn 3.8).
// The drafter is a 4-layer transformer at width 256 (3 sliding + 1 full attention, 4 query heads) with NO K/V of its own: its layers
// attend to the TARGET's caches (layer 13's sliding ring, layer 14's full cache).  Each draft step at the verify point n:
//   input row Z = [state (1536) | E_target(token) * sqrt(1536) (1536)]  (state = the target's final-norm output at n - 1 for the first
//   step, the drafter's own post-projection after that; the pack's pre_projection columns are ordered to match)
//   x = pre_projection(Z) (256) -> 4 Gemma-4 layers (q only + q_norm + RoPE at the CONSTANT position n, attention over the target's
//   keys < n, sandwich norms, GeGLU 256 -> 2048 -> 256, layer_scalar) -> final norm -> post_projection (the next state)
//   + the masked head: centroid logits (2048) -> top 32 clusters -> the 4,096 tokens in them (cluster-major head rows) -> argmax.
// Weights: one shard from the drafter pack (q8 layers / projections / centroids, q4 cluster-major head, u32 token ordering, f32 norms),
// checked against the manifest's sha256 (and the manifest against its pin in config.js).
// v048 (10-21): the shard STREAMS in its 16 MiB chunks: each chunk is checked against the pinned manifest's chunk sha256 and written to
// the GPU buffer as it lands, through one reused staging array.  v047 held the whole shard in JS (81 MB) plus Safari's own copy of one
// 81 MB writeBuffer, right before the prompt read-in: about 160 MB more at the peak.
// 3.8: a sampled answer's drafts are SAMPLED from the drafter's own distribution q (lops_samp.js dheadL + dsample, the answer's
// temperature / top-p / top-k), q kept per draft for the accept test (spec.js speculative sampling).
'use strict';
import * as K from './lops.js';
import * as S from './lops_spec.js';
import * as SS from './lops_samp.js';
import { rowstats } from '../ops/misc.js';

const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');

/** fetch + check + upload the drafter pack at `url` (manifest.json + one shard, streamed chunk by chunk); ctxCap = the target's context
 *  (attention scratch).  -> a Drafter (its .load = { MB, chunks, ms } of this load) */
export async function loadDrafter(g, url, { manifestSha256 = null, ctxCap = 4096 } = {}) {
  const base = url.endsWith('/') ? url : url + '/', t0 = performance.now();
  const mr = await fetch(base + 'manifest.json', { cache: 'no-store' });
  if (!mr.ok) throw new Error('drafter manifest HTTP ' + mr.status);
  const mb = await mr.arrayBuffer();
  if (manifestSha256 && hex(await crypto.subtle.digest('SHA-256', mb)) !== manifestSha256) throw new Error('the drafter manifest does not match its pin');
  const m = JSON.parse(new TextDecoder().decode(mb));
  if (m.format !== 'pocketflux.pack' || m.format_version !== 1 || !m.model || m.model.arch !== 'gemma4-assistant') throw new Error('not a drafter pack');
  const sh = m.shards[0], CB = sh.chunk_bytes, CS = sh.chunk_sha256;
  if (!CB || !Array.isArray(CS) || CS.length !== Math.ceil(sh.bytes / CB)) throw new Error('the drafter pack has no per-chunk sha256');
  const r = await fetch(base + sh.file, { cache: 'no-store' });
  if (!r.ok || !r.body) throw new Error('drafter shard HTTP ' + r.status);
  const buf = g.buffer(sh.bytes, 'drafter'), stage = new Uint8Array(CB);
  let fill = 0, ci = 0, got = 0, rd = null;
  const put = async () => {   // one whole chunk: its sha256, then its bytes to the GPU (writeBuffer copies them: the stage is reused)
    if (ci >= CS.length) throw new Error('drafter shard: more bytes than its manifest lists');
    const view = stage.subarray(0, fill);
    if (hex(await crypto.subtle.digest('SHA-256', view)) !== CS[ci]) throw new Error('drafter shard: chunk ' + ci + ' sha256 mismatch');
    g.device.queue.writeBuffer(buf, ci * CB, stage.buffer, 0, Math.ceil(fill / 4) * 4);
    ci++; fill = 0;
  };
  try {
    rd = r.body.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      for (let off = 0; off < value.length;) {
        const n = Math.min(CB - fill, value.length - off);
        stage.set(value.subarray(off, off + n), fill); fill += n; off += n; got += n;
        if (fill === CB) await put();
      }
    }
    if (fill) await put();
    if (got !== sh.bytes || ci !== CS.length) throw new Error('drafter shard: ' + got + ' bytes, expected ' + sh.bytes);
  } catch (e) { try { if (rd) rd.cancel(); } catch (x) { /* */ } g.free(buf); throw e; }
  const d = new Drafter(g, m, buf, ctxCap);
  d.load = { MB: Math.round(sh.bytes / 1e6), chunks: ci, ms: Math.round(performance.now() - t0) };
  return d;
}

/** p0pc0rn 3.8: the drafter from its pack in the phone's storage (a WeightStore: downloaded once, every 16 MiB chunk checked
 *  against the pinned manifest's sha256 before it was kept) -> a Drafter.  ctxCap = the target's context (attention scratch). */
export async function drafterFromStore(g, store, { ctxCap = 4096 } = {}) {
  const m = store.m;
  if (!m || !m.model || m.model.arch !== 'gemma4-assistant' || !Array.isArray(m.shards) || m.shards.length !== 1) throw new Error('not a drafter pack');
  const t0 = performance.now(), h = await store.upload(m.shards[0].name);
  const d = new Drafter(g, m, h.buf, ctxCap);
  d.load = { MB: Math.round(m.shards[0].bytes / 1e6), ms: Math.round(performance.now() - t0) };
  return d;
}

export class Drafter {
  constructor(g, man, buf, ctxCap) {
    this.g = g; this.man = man; this.m = man.model; this.T = man.tensors; this.buf = buf; this.bytes = man.shards[0].bytes;
    const D = this.m.hidden, BD = this.m.backbone_hidden, NH = this.m.heads, gHd = this.m.global_head_dim, B = (n, l) => g.buffer(S.PAD(n), l);
    this.D = D; this.BD = BD; this.NH = NH;
    this.tPer = this.m.per_centroid / 64; this.nsel = this.m.top_k;
    this.s = {
      z: B(2 * BD * 4, 'dr.z'), zst: B(64, 'dr.zst'), x: B(D * 4, 'dr.x'), st: B(64, 'dr.st'), t: B(4 * D * 4, 'dr.t'),
      q: B(NH * gHd * 4, 'dr.q'), qr: B(NH * gHd * 4, 'dr.qr'), ao: B(NH * gHd * 4, 'dr.ao'), mb: B(this.m.intermediate * 4, 'dr.mb'),
      part: B((Math.ceil(ctxCap / 64) + 2) * NH * (2 + gHd) * 4, 'dr.part'), cl: B(this.m.num_centroids * 4, 'dr.cl'), sel: B(this.nsel * 4, 'dr.sel'),
      mx: B(this.nsel * this.tPer * 2 * 4, 'dr.mx'), tok: B(16, 'dr.tok'),
    };
  }
  view(n) { const x = this.T[n]; if (!x) throw new Error('drafter tensor ' + n); return { buf: this.buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }; }
  nw(n) { const x = this.T[n]; if (!x) throw new Error('drafter tensor ' + n); return { buf: this.buf, off: x.offset / 4 }; }
  release() { this.g.runner.flush(); for (const b of Object.values(this.s)) this.g.free(b); this.g.free(this.buf); this.s = {}; this.buf = null; }

  /** record one draft step (slot = 1..k) at the verify point SP[0].  c = { target (Gemma4), ids, res, sp ({buf}), nchunkFull, img, pad,
   *  samp (3.8: { q, temperature, topP, topK, seed } = a sampled draft, its q table into samp.q; null = the greedy draft) } */
  encodeStep(c, slot) {
    const g = this.g, T = c.target, s = this.s, D = this.D, BD = this.BD, eps = this.m.rms_eps;
    const et = T.resident.get('lm.embed').t('embed_tokens.weight');
    K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: s.tok }, x: { buf: s.z }, st: { buf: s.zst }, K: BD, scale: Math.fround(T.m.embed_scale), n: 1, rowOut: 1 });
    const ns = K.gemv(g, { w: this.view('pre_projection.weight'), x: { buf: s.z, rowB: 0 }, N: D, K: 2 * BD, kPer: 2048, pro: 'raw', y: { buf: s.t } });
    K.normadd(g, { D, t: { buf: s.t, n: ns, ld: D }, x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps, mode: 1 });
    for (let i = 0; i < this.m.layers; i++) this._layer(c, i);
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps, st: { buf: s.st } });
    const fn = this.nw('norm.weight');
    K.gemv(g, { w: this.view('post_projection.weight'), x: { buf: s.x, rowB: 0 }, N: BD, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: fn, y: { buf: s.z } });
    K.gemv(g, { w: this.view('centroids.weight'), x: { buf: s.x, rowB: 0 }, N: this.m.num_centroids, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: fn, y: { buf: s.cl } });
    S.topk(g, { cl: { buf: s.cl }, sel: { buf: s.sel }, n: this.m.num_centroids, k: this.nsel });
    const ord = this.T.token_ordering, sm = c.samp;
    if (sm) {   // 3.8: a sampled draft: every selected row's logit, then a token drawn from q's top K
      const n = this.nsel * this.tPer * 64, dl = s.dl || (s.dl = g.buffer(S.PAD(n * 8), 'dr.dl'));
      SS.dheadL(g, { x: { buf: s.x }, w: this.view('head.weight'), stat: { buf: s.st, off: 1 }, norm: fn, sel: { buf: s.sel }, dl: { buf: dl }, K: D, nsel: this.nsel, tPer: this.tPer });
      SS.dsample(g, { dl: { buf: dl }, ord: { buf: this.buf, off: ord.offset, bytes: ord.bytes }, ids: c.ids, tok: { buf: s.tok }, res: c.res, q: sm.q, sp: c.sp, n, slot, img: c.img, pad: c.pad,
        kTop: sm.topK, seed: sm.seed, temp: sm.temperature, topP: sm.topP });
      return;
    }
    S.dhead(g, { x: { buf: s.x }, w: this.view('head.weight'), stat: { buf: s.st, off: 1 }, norm: fn, sel: { buf: s.sel }, mx: { buf: s.mx }, K: D, nsel: this.nsel, tPer: this.tPer });
    S.dsel(g, { mx: { buf: s.mx }, ord: { buf: this.buf, off: ord.offset, bytes: ord.bytes }, ids: c.ids, tok: { buf: s.tok }, res: c.res, n: this.nsel * this.tPer, slot, img: c.img, pad: c.pad });
  }
  _layer(c, i) {
    const g = this.g, T = c.target, s = this.s, D = this.D, NH = this.NH, eps = this.m.rms_eps, kind = this.m.layer_types[i], full = kind === 'full_attention';
    const hd = full ? this.m.global_head_dim : this.m.head_dim, nq = NH * hd, P = (n) => `layers.${i}.${n}`, cache = T.kv[this.m.kv_source[kind]];
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps, st: { buf: s.st } });
    K.gemv(g, { w: this.view(P('self_attn.q_proj.weight')), x: { buf: s.x, rowB: 0 }, N: nq, K: D, pro: 'rms', stat: { buf: s.st, off: 1 }, norm: this.nw(P('input_layernorm.weight')), y: { buf: s.q } });
    S.qkropeMS(g, { s: { buf: s.q, ldm: nq }, norm: { buf: this.buf }, qw: this.nw(P('self_attn.q_norm.weight')).off, rope: { buf: T._ropeBuf(kind) }, q: { buf: s.qr }, D: hd, nq: NH,
      hasKV: false, npairs: T.m.rope[kind].pairs, M: 1, sp: c.sp, eps });
    S.attnDecMS(g, { q: { buf: s.qr }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, part: { buf: s.part }, out: { buf: s.ao }, D: hd, nh: NH, M: 1, win: T.win, full, ring: cache.ring, nkv: T.NKV || 1, kvLen: cache.len,
      qoff: 0, nchunk: full ? c.nchunkFull : Math.ceil(T.win / 64), sp: c.sp });
    K.gemv(g, { w: this.view(P('self_attn.o_proj.weight')), x: { buf: s.ao, rowB: 0 }, N: D, K: nq, pro: 'raw', y: { buf: s.t } });
    K.normadd(g, { D, t: { buf: s.t, n: 1, ld: D }, w: this.nw(P('post_attention_layernorm.weight')), x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps, scale: 1 });
    rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps, st: { buf: s.st } });
    K.gemv(g, { w: this.view(P('mlp.gate_up_proj.weight')), x: { buf: s.x, rowB: 0 }, N: this.m.intermediate, K: D, pro: 'rms', stat: { buf: s.st, off: 1 },
      norm: this.nw(P('pre_feedforward_layernorm.weight')), epi: 'geglu', y: { buf: s.mb } });
    K.gemv(g, { w: this.view(P('mlp.down_proj.weight')), x: { buf: s.mb, rowB: 0 }, N: D, K: this.m.intermediate, pro: 'raw', y: { buf: s.t } });
    K.normadd(g, { D, t: { buf: s.t, n: 1, ld: D }, w: this.nw(P('post_feedforward_layernorm.weight')), x: { buf: s.x }, st: { buf: s.st, off: 1 }, eps, scale: Math.fround(this.m.layer_scalar[i]) });
  }
}
