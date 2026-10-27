// Speculative greedy decode with Google's Gemma 4 E2B MTP drafter (p0pc0rn 3.8).  The target's output does not change:
// every token comes from the target's own argmax.  Per PASS (one command buffer, one readback):
//   1. VERIFY: the target runs M = k + 1 tokens [the last emitted token, its k drafts] at positions pos .. pos + k in ONE pass over its
//      weights (lops_spec.js gemvM & co. = the decode ops with M accumulators; on a desktop GPU bit-identical to M single steps), writing
//      their K/V and giving the argmax of every row;
//   2. ACCEPT (GPU): m = how many drafts the target agrees with; the target's tokens of rows 0..m are this pass's output (m + 1 tokens:
//      the accepted drafts + the 'bonus' token of row m); the next position pos + m + 1 stays on the GPU (SP), so the next pass can be
//      RECORDED before the CPU knows m (its attention grids are sized for the longest window it can have);
//   3. DRAFT (GPU): the drafter makes the next pass's k drafts from the target's final-norm output at row m + the bonus token.
// The CPU, per pass: read back (m, the tokens, the next pass's ids) -> read the next pass's PLE rows (one storage call) -> submit the
// pass recorded while this one ran -> the callbacks (onToken) of this pass's tokens -> record the pass after next.  Rejected rows' K/V
// are simply overwritten by the next pass (the sliding ring holds 768 rows >= 512 + 8).  A sampled answer: SPECULATIVE SAMPLING, below.
// opts (model.opts): specK = drafts per pass (1..7), specAdaptive (k += 1 after a pass that kept all drafts, -= 1 after one that kept
// none; starts at specK or 2), specKmax (default 4).
// v048 (10-21): specAdaptive now means the COST-AWARE k (specPolicy 'cost', the default; 'simple' = v047's +1 / -1 rule): before each
// pass is recorded, k = argmax over 0..kmax of E[tokens] / cost.  E[tokens](k) = 1 + sum_{j<=k} prod_{i<=j} a_i, a_i = the running
// acceptance of draft i given drafts 1..i-1 were kept (learnt only from drafts the target checked, step 1/2, 1/3, 1/4 then 1/5 per
// answer so a new kind of text is picked up within a few passes; kept on the model across
// answers, pulled half-way back to the prior at each answer's start; a deeper position seen little in this answer leans on the one
// before it); cost(k) = s * G1(pos) * r(k + 1, pos) + o(k + 1) + k * d with
// G1 = one token's GPU time and r = a verify pass's cost relative to it, both measured on an iPhone 16 Pro Max (at short
// and 2,614-token positions, interpolated by position), o = a pass's CPU part (readback + its PLE rows), d = one draft step, s = a
// running correction from the measured pass times (heat, another phone).  k = 0 is a plain step; after 4 plain passes in a row one pass
// drafts a token so the estimate can recover.  specKTest = a list of k values used in turn (tests).  The output never depends on
// k: every token is the target's own argmax.
// 3.8, SPECULATIVE SAMPLING (conf.samp = { temperature, topP, topK 1..64, seed }: llm.js makeSampler's settings): the same passes, with
// the drafts SAMPLED from the drafter's own distribution q (drafter.js), the verify rows' top 64 kept on the GPU, and lops_samp.js
// acceptS in place of accept: a draft is kept with probability min(1, p / q), the first one not kept is replaced by a token from
// max(0, p - q), so every token follows the target's own sampling distribution (the first one is the prefill's argmax, as in the
// plain loop).  The words depend on the seed AND on k (the random numbers are keyed by position and pass), so with the cost-aware k
// the same seed can give other words, from the same distribution.  The rows of the last 256 tokens' per-layer inputs are kept
// (conf.rowCache).  A pass that reads back nonsense (a GPU that could not run the kernels) ends the loop with err.sampIds = the tokens
// so far, for the plain sampled loop to go on from (gemma4.js).
'use strict';
import * as K from './lops.js';
import * as S from './lops_spec.js';
import * as SS from './lops_samp.js';
import { rowstats } from '../ops/misc.js';
import { DecodeRunner } from './drunner.js';

// the iPhone 16 Pro Max's verify cost r(M) (M = rows = k + 1) relative to one token, at a short (39) and a long (2,614) position, and
// one token's GPU time (GPU-bound replays); o = 2 ms + 0.85 ms per row of PLE reads, d = 1 ms per draft step
const COST = { pos: [40, 2614], short: [1, 1, 1.14, 1.3, 1.48, 1.7, 2.1, 2.4, 2.7], long: [1, 1, 1.18, 1.45, 1.74, 1.98, 2.36, 2.65, 2.95],   // v024's pass times trimmed M >= 3
  g1: [39.4, 45.3], o0: 2.0, oRow: 0.85, d: 1.0 };
const PRIOR = [0, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6];
export function polCost(M, pos) {
  const t = Math.max(0, Math.min(1.5, (pos - COST.pos[0]) / (COST.pos[1] - COST.pos[0]))), Mi = Math.min(M, 8), lerp = (a, b) => a + (b - a) * t;
  return { gpu: lerp(COST.g1[0], COST.g1[1]) * lerp(COST.short[Mi], COST.long[Mi]), cpu: COST.o0 + COST.oRow * M };
}
/** the k (0..kmax) with the most expected tokens per ms for a pass at `pos` */
export function polChoose(P, pos, kmax) {
  let best = 0, bestRate = -1, e = 1, prod = 1, prev = 0;
  for (let k = 0; k <= kmax; k++) {
    // a deeper draft position seen little in this answer leans on the one before it (text the drafter guesses well tends to stay that
    // way: a tool call's 3rd and 4th drafts are tried as soon as its 1st and 2nd keep landing, instead of waiting on a fixed prior)
    if (k > 0) { const n = Math.min(8, (P.cnt && P.cnt[k]) || 0), ak = k === 1 ? P.a[1] : (n * P.a[k] + 2 * prev) / (n + 2); prev = ak; prod *= ak; e += prod; }
    const c = polCost(k + 1, pos), rate = e / (P.s * c.gpu + c.cpu + k * COST.d);
    if (rate > bestRate) { bestRate = rate; best = k; }
  }
  if (best === 0 && kmax > 0) { if (++P.plain >= 4) { P.plain = 0; best = 1; } } else P.plain = 0;
  return best;
}
/** a pass of M rows checked M - 1 drafts and the target kept m of them */
export function polLearn(P, M, m) {
  for (let j = 1; j <= Math.min(m + 1, M - 1); j++) { const al = Math.max(0.2, 1 / ((P.cnt[j] || 0) + 2)); P.cnt[j] = (P.cnt[j] || 0) + 1; P.a[j] = (1 - al) * P.a[j] + al * (j <= m ? 1 : 0); }
}
/** a pass of M rows (that also drafted kd tokens) took `ms` from the readback before it to its own: -> the running correction s */
export function polTime(P, M, kd, pos, ms) {
  const c = polCost(M, pos), gpu = ms - c.cpu - kd * COST.d;
  if (c.gpu > 0 && gpu > 0) P.s = 0.8 * P.s + 0.2 * Math.max(0.5, Math.min(3, gpu / c.gpu));
}
export function polOf(model) {
  const P = model._specPol || (model._specPol = { a: PRIOR.slice(), s: 1, plain: 0 });
  for (let j = 1; j < PRIOR.length; j++) P.a[j] = 0.5 * P.a[j] + 0.5 * PRIOR[j];   // a new answer: half-way back to the prior
  P.plain = 0; P.cnt = new Array(PRIOR.length).fill(0);   // ... and quick steps again
  return P;
}

export function specAlloc(model, Mmax, lend = null, { head = true } = {}) {   // 3.9 (E4B room): head false = a worker part (it never runs the head)
  const g = model.g, D = model.D, NT = model.NL * 256, V = model.m.vocab, maxHd = model.m.global_head_dim, NH = model.NH, maxInter = Math.max(...model.m.intermediate);
  const B = (n, l) => g.buffer(S.PAD(n), l);
  const L = (name, n, l) => { const b = lend && lend[name]; return b && b._pf >= S.PAD(n) ? b : B(n, l); };   // 3.8: a kept read-in buffer lent to the loop
  return {
    Mmax, idb: B(16 * 4, 'v.id'), pler: B(Mmax * NT * 4, 'v.pler'), x: B(Mmax * D * 4, 'v.x'), est: B(Mmax * 4, 'v.est'), st: B(Mmax * 2 * 4, 'v.st'),
    nst: B(Mmax * 4, 'v.nst'), proj: B(Mmax * NT * 4, 'v.proj'), ple: B(Mmax * NT * 4, 'v.ple'), qkv: B(Mmax * (NH * maxHd + 2 * (model.NKV || 1) * maxHd) * 4, 'v.qkv'),
    q: B(Mmax * NH * maxHd * 4, 'v.q'), ao: B(Mmax * NH * maxHd * 4, 'v.ao'), apart: L('apart', (Math.ceil(model.ctxCap / 64) + 2) * Mmax * NH * (2 + maxHd) * 4, 'v.apart'),
    tpart: B(Math.ceil(maxInter / 2048) * Mmax * D * 4, 'v.tpart'), mbuf: B(Mmax * maxInter * 4, 'v.m'), gate: B(Mmax * 256 * 4, 'v.gate'),
    logits: head ? L('logits', Mmax * V * 4, 'v.logits') : null, mx: head ? B(Mmax * (V / 64) * 2 * 4, 'v.mx') : null, arg: head ? B(Mmax * 2 * 4, 'v.arg') : null, sp: B(64, 'v.sp'), res: B(S.RES_WORDS * 4, 'v.res'),
  };
}

/** 3.8: the loop's buffers, kept on the model from answer to answer (made again only for more rows, another context size or another
 *  set of read-in buffers): no free and make per answer (WebKit gives destroyed GPU memory back late; on Josh's iPhone with iOS 27
 *  that pile ended the page).  Each answer writes V.sp and V.idb before its first pass; every other buffer is written before it is
 *  read.  The logits and the attention partials are the kept read-in's attention scores and PLE projection (gemma4.js
 *  _keptPrefillBufs), lent: the read-in has finished when the first pass is recorded, and the last pass has finished before the next
 *  read-in starts (llm.js awaits both), so they never hold two things at once; ~10 MB less kept memory. */
export function specKept(model, Mmax) {
  const k = model._specV, pb = model._pb || null;
  if (k && k.Mmax >= Mmax && k.cap === model.ctxCap && k.pb === pb) return k;
  if (k) { model.g.runner.flush(); for (const [n, b] of Object.entries(k)) if (b && typeof b === 'object' && b.destroy && !k.lent.has(n)) model.g.free(b); }
  const lend = pb && pb.at ? { logits: pb.at.S, apart: pb.proj2 } : null, V = specAlloc(model, Mmax, lend);
  return (model._specV = Object.assign(V, { cap: model.ctxCap, pb, lent: new Set(Object.keys(lend || {}).filter((n) => V[n] === lend[n])) }));
}

/** record the target's verify pass of M rows at positions SP[0] .. SP[0] + M - 1 (ids in V.idb, scaled PLE rows in V.pler) -> V.arg.
 *  nchunkFull = the full layers' attention chunks for the longest window this pass can have. */
/* 3.8 (from the phone bench v036): in three parts so a split model (engine/llm/split.js) can run the middle one in another process: the
 * front (embedding + per-layer inputs -> V.x, V.ple), the layers [l0, l1), the head (final norm + logits + argmax). One process = the
 * three in a row: the same dispatches as before with kv_heads 1. */
export function encodeVerifyFront(model, V, M) {
  const g = model.g, D = model.D, NL = model.NL, NT = NL * 256;
  const R = (n) => { const h = model.resident.get(n); if (!h) throw new Error('speculative decode needs resident weights: ' + n); return h; };
  const eh = R('lm.embed'), gh = R('lm.global'), et = eh.t('embed_tokens.weight');
  K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: V.idb }, x: { buf: V.x }, st: { buf: V.est }, K: D, scale: Math.fround(model.m.embed_scale), n: M });
  const pj = gh.t('per_layer_model_projection.weight'), nwn = model.nw(gh, 'per_layer_projection_norm.weight');
  S.gemvM(g, { w: pj, x: { buf: V.x, ldx: D }, M, N: NT, K: D, pro: 'raw', y: { buf: V.proj, ldy: M * NT, ldm: NT } });
  K.plefin(g, { s: { buf: V.proj, n: 1, ld: NT }, norm: { buf: nwn.buf, off: nwn.off * 4, bytes: 1024 }, tok: { buf: V.pler }, out: { buf: V.ple }, nl: NL, dp: 256, n: M, projScale: model.m.ple_proj_scale });
}
export function encodeVerifyLayers(model, V, M, nchunkFull, l0 = model.l0 || 0, l1 = model.l1 == null ? model.NL : model.l1) {
  const g = model.g, D = model.D, NL = model.NL, NH = model.NH, NT = NL * 256, NKV = model.NKV || 1;
  const R = (n) => { const h = model.resident.get(n); if (!h) throw new Error('speculative decode needs resident weights: ' + n); return h; };
  const rs = () => rowstats(g, { x: { buf: V.x, ld: D }, rows: M, cols: D, mode: 'rms', eps: model.eps, st: { buf: V.st } });
  for (let l = l0; l < l1; l++) {
    const ah = R(`lm.layer.${String(l).padStart(2, '0')}.a`), mh = R(`lm.layer.${String(l).padStart(2, '0')}.m`), Pn = (n) => `layers.${l}.${n}`;
    const hd = model.hd(l), nq = NH * hd, shared = model.kvSrc[l] !== l, kind = model.LT[l], npairs = model.npairs(l), cache = model._cache(l), full = kind === 'full_attention';
    rs();
    const inw = model.nw(ah, Pn('input_layernorm.weight'));
    if (!shared) {
      const qkvw = ah.t(Pn('self_attn.qkv_proj.weight')), qn = model.nw(ah, Pn('self_attn.q_norm.weight')), kn = model.nw(ah, Pn('self_attn.k_norm.weight'));
      S.gemvM(g, { w: qkvw, x: { buf: V.x, ldx: D }, M, N: nq + 2 * NKV * hd, K: D, pro: 'rms', stat: { buf: V.st, off: 1, ld: 2 }, norm: { buf: ah.buf, off: inw.off }, y: { buf: V.qkv, ldm: nq + 2 * NKV * hd } });
      S.qkropeMS(g, { s: { buf: V.qkv, ldm: nq + 2 * NKV * hd }, norm: { buf: ah.buf }, qw: qn.off, kw: kn.off, rope: { buf: model._ropeBuf(kind) }, q: { buf: V.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc },
        D: hd, nq: NH, hasKV: true, npairs, ring: cache.ring, M, sp: { buf: V.sp }, eps: model.eps, nkv: NKV, kvLen: cache.len });
    } else {
      const qw = ah.t(Pn('self_attn.q_proj.weight')), qn = model.nw(ah, Pn('self_attn.q_norm.weight'));
      S.gemvM(g, { w: qw, x: { buf: V.x, ldx: D }, M, N: nq, K: D, pro: 'rms', stat: { buf: V.st, off: 1, ld: 2 }, norm: { buf: ah.buf, off: inw.off }, y: { buf: V.qkv, ldm: nq } });
      S.qkropeMS(g, { s: { buf: V.qkv, ldm: nq }, norm: { buf: ah.buf }, qw: qn.off, rope: { buf: model._ropeBuf(kind) }, q: { buf: V.q }, D: hd, nq: NH, hasKV: false, npairs, ring: cache.ring, M,
        sp: { buf: V.sp }, eps: model.eps });
    }
    S.attnDecMS(g, { q: { buf: V.q }, kc: { buf: cache.kc }, vc: { buf: cache.vc }, part: { buf: V.apart }, out: { buf: V.ao }, D: hd, nh: NH, M, win: model.win, full, ring: cache.ring,
      qoff: 1, nchunk: full ? nchunkFull : Math.ceil(model.win / 64), sp: { buf: V.sp }, nkv: NKV, kvLen: cache.len });
    const ow = ah.t(Pn('self_attn.o_proj.weight'));
    S.gemvM(g, { w: ow, x: { buf: V.ao, ldx: nq }, M, N: D, K: nq, kPer: 2048, pro: 'raw', y: { buf: V.tpart, ldy: M * D, ldm: D } });
    const pan = model.nw(ah, Pn('post_attention_layernorm.weight'));
    K.normadd(g, { D, M, t: { buf: V.tpart, n: Math.ceil(nq / 2048), ld: M * D }, w: { buf: ah.buf, off: pan.off }, x: { buf: V.x }, st: { buf: V.nst }, eps: model.eps, scale: 1 });
    rs();
    const inter = model.m.intermediate[l], guw = mh.t(Pn('mlp.gate_up_proj.weight')), pfw = model.nw(mh, Pn('pre_feedforward_layernorm.weight'));
    S.gemvM(g, { w: guw, x: { buf: V.x, ldx: D }, M, N: inter, K: D, pro: 'rms', stat: { buf: V.st, off: 1, ld: 2 }, norm: { buf: mh.buf, off: pfw.off }, epi: 'geglu', y: { buf: V.mbuf, ldm: inter } });
    const dw = mh.t(Pn('mlp.down_proj.weight'));
    S.gemvM(g, { w: dw, x: { buf: V.mbuf, ldx: inter }, M, N: D, K: inter, kPer: 2048, pro: 'raw', y: { buf: V.tpart, ldy: M * D, ldm: D } });
    const pff = model.nw(mh, Pn('post_feedforward_layernorm.weight'));
    K.normadd(g, { D, M, t: { buf: V.tpart, n: Math.ceil(inter / 2048), ld: M * D }, w: { buf: mh.buf, off: pff.off }, x: { buf: V.x }, st: { buf: V.nst }, eps: model.eps, scale: 1 });
    const giw = ah.t(Pn('per_layer_input_gate.weight')), ppw = ah.t(Pn('per_layer_projection.weight')), ppn = model.nw(ah, Pn('post_per_layer_input_norm.weight'));
    S.gemvM(g, { w: giw, x: { buf: V.x, ldx: D }, M, N: 256, K: D, pro: 'raw', y: { buf: V.gate, ldy: M * 256, ldm: 256 } });
    S.gemvM(g, { w: ppw, x: { buf: V.gate, ldx: 256 }, M, N: D, K: 256, pro: 'pleg', src: { n: 1, ld: M * 256 }, ev: { buf: V.ple, off: l * 256, ld: NT }, y: { buf: V.tpart, ldy: M * D, ldm: D } });
    K.normadd(g, { D, M, t: { buf: V.tpart, n: 1, ld: M * D }, w: { buf: ah.buf, off: ppn.off }, x: { buf: V.x }, st: { buf: V.nst }, eps: model.eps, scale: Math.fround(model.m.layer_scalar[l]) });
  }
}
export function encodeVerifyHead(model, V, M) {
  const g = model.g, D = model.D, VOC = model.m.vocab;
  const eh = model.resident.get('lm.embed'), gh = model.resident.get('lm.global'), et = eh.t('embed_tokens.weight');
  rowstats(g, { x: { buf: V.x, ld: D }, rows: M, cols: D, mode: 'rms', eps: model.eps, st: { buf: V.st } });
  const nw = model.nw(gh, 'norm.weight');
  S.gemvM(g, { w: et, x: { buf: V.x, ldx: D }, M, N: VOC, K: D, pro: 'rms', stat: { buf: V.st, off: 1, ld: 2 }, norm: { buf: gh.buf, off: nw.off }, epi: 'softcap', cap: model.m.final_softcap, mx: { buf: V.mx }, y: { buf: V.logits, ldm: VOC } });
  S.argmaxM(g, { mx: { buf: V.mx }, out: { buf: V.arg }, n: VOC / 64, M });
  return V.arg;
}
export function encodeVerify(model, V, M, nchunkFull) {
  encodeVerifyFront(model, V, M);
  encodeVerifyLayers(model, V, M, nchunkFull, model.l0 || 0, model.l1 == null ? model.NL : model.l1);
  return encodeVerifyHead(model, V, M);
}

/** 3.8: speculative sampling's kernels on this GPU (built once per drafter head encoding) -> null, or why they can't run here */
export async function sampReady(model) {
  const g = model.g, q8 = model.drafter.view('head.weight').enc === 'q8g64s.t64', c = g._sampReady || (g._sampReady = {});
  if (!(q8 in c)) c[q8] = await SS.prepare(g, { q8 });
  return c[q8];
}

/** the speculative loop: same contract as Gemma4.decodeLoop ({ids, stopped}); conf = { k, adaptive, kmax, samp, rowCache } */
export async function specLoop(model, s, o, conf) {
  const g = model.g, core = g.runner, st = o.stats || null, eos = o.eos || (() => false), now = () => performance.now(), dft = model.drafter;
  const kmax = Math.max(1, Math.min(7, conf.kmax || 4)), img = model.m.image_token, pad = model.m.pad, psc = Math.fround(model.m.ple_scale), NT = model.NL * 256, cap = model.ctxCap;
  const V = specKept(model, kmax + 1), dr = new DecodeRunner(g, { cap: 1600, timer: !!(st && st.gpuTimer), stage: S.RES_WORDS * 4 });
  const T = { enc: 0, ple: 0, write: 0, wait: 0, cb: 0, passes: 0, rows: 0, m: new Array(kmax + 1).fill(0), k: new Array(kmax + 1).fill(0), kh: new Array(kmax + 1).fill(0), tPrev: null, rowHits: 0, rowMiss: 0 };
  const nw = model.nw(model.resident.get('lm.global'), 'norm.weight'), VOC = model.m.vocab;
  // 3.8: a sampled answer: the verify rows' top 64 (cand -> tk) and each draft's q table (qt: V.q holds the verify's queries)
  let samp = null;
  if (conf.samp) {
    const B = (n, l) => g.buffer(S.PAD(n), l), sm = conf.samp;
    if (!V.cand) Object.assign(V, { cand: B(SS.candBytes(V.Mmax, VOC), 'v.cand'), tk: B(V.Mmax * SS.KS * 8, 'v.tk'), qt: B(8 * SS.KS * 8, 'v.qt') });   // 3.8: kept with V
    samp = { q: { buf: V.qt }, temperature: sm.temperature, topP: sm.topP || 1, topK: sm.topK, seed: sm.seed >>> 0 };
  }
  const ctxD = { target: model, ids: { buf: V.idb }, res: { buf: V.res }, sp: { buf: V.sp }, nchunkFull: 0, img, pad, samp };
  let kPol = Math.max(1, Math.min(kmax, conf.k || 2));
  // v048: the k policy: 'cost' (the expected tokens per ms, see the header), 'simple' (v047's +1 / -1), 'fixed' (specK), or a test list
  const pol = conf.policy || (conf.adaptive ? 'simple' : 'fixed'), P = pol === 'cost' ? polOf(model) : null, KT = conf.ktest || null; let kti = 0;
  const kWant = (pos) => (KT ? Math.max(0, Math.min(kmax, KT[kti++ % KT.length] | 0)) : P ? polChoose(P, pos, kmax) : kPol);
  const kChoice = (posHiNext, Mnext) => Math.max(0, Math.min(kWant(posHiNext), kmax, cap - 2 - (posHiNext + Mnext)));   // never draft past the KV cache
  /** record one pass: M rows verified at a position <= posHi, then kNext drafts for the pass after it */
  const rec = (M, kNext, posHi, parity) => {
    const a = now(); g.runner = dr;
    try {
      dr.begin(parity);
      const nch = Math.ceil((posHi + M) / 64);
      encodeVerify(model, V, M, nch);
      if (samp) {   // 3.8: speculative sampling: keep, or replace from the residual (lops_samp.js)
        SS.topkRows(g, { logits: { buf: V.logits }, M, V: VOC, cand: { buf: V.cand }, tk: { buf: V.tk } });
        SS.acceptS(g, { tk: { buf: V.tk }, q: samp.q, ids: { buf: V.idb }, sp: { buf: V.sp }, res: { buf: V.res }, M, kTop: samp.topK, img, pad, seed: samp.seed, temp: samp.temperature, topP: samp.topP });
      } else S.accept(g, { arg: { buf: V.arg }, ids: { buf: V.idb }, sp: { buf: V.sp }, res: { buf: V.res }, M, img, pad });
      if (kNext > 0) {
        S.dprep(g, { x: { buf: V.x }, st: { buf: V.st }, norm: nw, sp: { buf: V.sp }, res: { buf: V.res }, z: { buf: dft.s.z }, tok: { buf: dft.s.tok }, D: model.D });
        dr.split();   // the drafts in their own compute pass (GPU timer: verify vs draft)
        ctxD.nchunkFull = nch;   // the drafter's position <= posHi + M; its keys are below it
        for (let j = 1; j <= kNext; j++) dft.encodeStep(ctxD, j);
      }
      return dr.end(V.res, S.RES_WORDS * 4);
    } finally { g.runner = core; if (dr.cur) dr.cur = null; T.enc += now() - a; }
  };
  const readPlain = async (ids) => {
    const a = now(); const r = await model.pleRows(ids); for (let j = 0; j < r.length; j++) r[j] = Math.fround(r[j] * psc); T.ple += now() - a;
    const b = now(); g.device.queue.writeBuffer(V.pler, 0, r.buffer, r.byteOffset, ids.length * NT * 4); T.write += now() - b;
  };
  // 3.8 (conf.rowCache = how many): the scaled rows of recent tokens, kept on the model (a pass's ids are mostly tokens seen just before)
  const CAP = conf.rowCache | 0, cache = CAP ? (model._rowCache || (model._rowCache = new Map())) : null;
  const readCached = async (rid) => {
    const a = now(), buf = new Float32Array(rid.length * NT), miss = [];
    rid.forEach((id, i) => { const r = cache.get(id); if (r) { buf.set(r, i * NT); cache.delete(id); cache.set(id, r); T.rowHits++; } else miss.push(i); });
    if (miss.length) {
      const rr = await model.pleRows(miss.map((i) => rid[i]));
      miss.forEach((i, j) => {
        const row = rr.subarray(j * NT, (j + 1) * NT); for (let q = 0; q < NT; q++) row[q] = Math.fround(row[q] * psc);
        buf.set(row, i * NT); cache.set(rid[i], row.slice()); if (cache.size > CAP) cache.delete(cache.keys().next().value);
      });
      T.rowMiss += miss.length;
    }
    T.ple += now() - a;
    const b = now(); g.device.queue.writeBuffer(V.pler, 0, buf.buffer, buf.byteOffset, rid.length * NT * 4); T.write += now() - b;
  };
  const readRows = cache ? readCached : readPlain;
  const ids = []; let stopped = 'length', pend = null; const t0 = now();
  core.flush();   // nothing of the core runner's may still wait behind a pass
  try {
    if (o.steps <= 0) return { ids, stopped };
    if (o.check) o.check();
    if (eos(o.first)) return { ids, stopped: 'eos' };
    // pass 0 = the first token alone (M = 1: no drafts yet), its end drafts for pass 1
    g.device.queue.writeBuffer(V.sp, 0, Uint32Array.of(o.pos0, 0, 0, 0));
    g.device.queue.writeBuffer(V.idb, 0, Uint32Array.of(o.first === img ? pad : o.first));
    let cur = { M: 1, k: kChoice(o.pos0 + 1, 1), pos: o.pos0, parity: 0 };
    let tk = rec(cur.M, cur.k, cur.pos, 0);
    await readRows([o.first]);
    pend = dr.submit(tk);
    // pass 1, recorded while pass 0 runs: its position is exactly pos0 + 1 (pass 0 has no drafts to accept)
    let nxt = { M: cur.k + 1, pos: o.pos0 + 1, parity: 1 }; nxt.k = kChoice(nxt.pos + nxt.M, nxt.M);
    let ntk = rec(nxt.M, nxt.k, nxt.pos, 1);
    for (;;) {
      let a = now(); const R32 = await pend; pend = null; const tr = now(); T.wait += tr - a; T.passes++; T.rows += cur.M; T.kh[cur.M - 1]++;
      if (P && T.tPrev != null) polTime(P, cur.M, cur.k, cur.pos, tr - T.tPrev);   // v048: this pass's measured time (readback to readback)
      T.tPrev = tr;
      const m = R32[0], posNext = R32[2], nids = [];
      for (let j = 0; j < nxt.M; j++) nids.push(R32[S.RES_IDS + j]);   // the next pass's ids: the bonus + its drafts
      if (samp && !sane(R32, cur, m, posNext, nids, VOC)) throw sampFail(`pass ${T.passes}: position ${R32[3]} (expected ${cur.pos}), ${m} of ${cur.M - 1} kept`, ids);
      if (st && st.trace) st.trace.push({ pos: R32[3], M: cur.M, m, next: nids.slice() });   // tests: drafts vs a CPU reference
      if (cur.M > 1) { T.k[cur.M - 1]++; T.m[m]++; if (P) polLearn(P, cur.M, m); }
      if (pol === 'simple' && cur.M > 1) { if (m === cur.M - 1) kPol = Math.min(kmax, kPol + 1); else if (m === 0) kPol = Math.max(1, kPol - 1); }
      // this pass's tokens: the target's argmax (sampled: its kept drafts + the replacement or bonus) at rows 0..m
      const got = []; let stop = false;
      for (let i = 0; i <= m; i++) {
        const id = R32[S.RES_ARG + 2 * i], at = ids.length; ids.push(id); got.push([id, R32[S.RES_ARG + 2 * i + 1], at]);
        if (at + 1 >= o.steps) { stopped = 'length'; stop = true; break; }
        if (eos(id)) { stopped = 'eos'; stop = true; break; }
      }
      if (!stop) {
        if (posNext > nxt.pos) throw new Error('speculative decode: position ' + posNext + ' past its bound ' + nxt.pos);
        nxt.pos = posNext;
        await readRows(nids);   // the next pass's PLE rows (its ids are already on the GPU)
        pend = dr.submit(ntk); ntk = null;
      }
      a = now();
      if (o.onToken) for (const [id, bits, at] of got) o.onToken(id, { argmax: id, maxLogit: new Float32Array(new Uint32Array([bits]).buffer)[0], logitsBuf: null }, at);
      if (!stop && o.check) o.check();
      T.cb += now() - a;
      if (stop) break;
      // record the pass after next while the GPU runs the next one
      cur = nxt;
      nxt = { M: cur.k + 1, pos: cur.pos + cur.M, parity: cur.parity ^ 1 };   // pos = an upper bound until the next readback
      nxt.k = kChoice(nxt.pos + nxt.M, nxt.M);
      ntk = rec(nxt.M, nxt.k, nxt.pos, nxt.parity);
    }
  } finally {
    if (pend) { try { await pend; } catch (e) { /* */ } }   // never leave a staging buffer mapping
    await dr.destroy();
    g.runner.flush();   // 3.8: V stays on the model (specKept)
    if (st) {
      const n = Math.max(1, ids.length), r2 = (v) => +(+v).toFixed(2), np = Math.max(1, T.passes);
      Object.assign(st, { loop: 'spec', tokens: ids.length, passes: T.passes, tokPerPass: r2(ids.length / np), rowsPerPass: r2(T.rows / np), wallMs: Math.round(now() - t0),
        msPerToken: r2((now() - t0) / n), msPerPass: r2((now() - t0) / np), encodeMs: r2(T.enc / np), pleMs: r2(T.ple / np), writeMs: r2(T.write / np), waitMs: r2(T.wait / np),
        callbackMs: r2(T.cb / np), accepted: T.m.slice(), drafted: T.k.slice(), kFinal: kPol, adaptive: !!conf.adaptive, kFixed: conf.adaptive || KT ? null : conf.k, kmax,
        policy: KT ? 'test' : pol, kHist: T.kh.slice(), acceptEst: P ? P.a.slice(1, kmax + 1).map(r2) : null, acceptN: P ? P.cnt.slice(1, kmax + 1) : null, costScale: P ? r2(P.s) : null,
        dispatches: r2(dr.dispatches / np), submits: dr.submits, bindGroupsNew: dr.bgNew, bindGroupsCached: dr.bgHit,
        gpuBusyMs: dr.timer && dr.timer.tokens ? r2(dr.timer.busyMs / dr.timer.tokens) : null,
        gpuVerifyMs: dr.timer && dr.timer.tokens ? r2(dr.timer.parts[0] / dr.timer.tokens) : null, gpuDraftMs: dr.timer && dr.timer.tokens ? r2(dr.timer.parts[1] / dr.timer.tokens) : null,
        drafterMB: Math.round(dft.bytes / 1e6), trace: st.trace || undefined });
      if (samp) Object.assign(st, { loop: 'spec-sample', samp: { temperature: samp.temperature, topP: samp.topP, topK: samp.topK, seed: samp.seed }, rowHits: T.rowHits, rowMiss: T.rowMiss });
    }
  }
  return { ids, stopped };
}

/** 3.8: a sampled pass's readback is what acceptS writes: this pass's position, m < M, the next position, token ids in the vocabulary
 *  (a pass whose command buffer did not run leaves zeros, or an older pass's result, in its staging buffer) */
function sane(R32, cur, m, posNext, nids, VOC) {
  if (R32[3] !== cur.pos || !(m < cur.M) || posNext !== cur.pos + m + 1) return false;
  for (let i = 0; i <= m; i++) if (!(R32[S.RES_ARG + 2 * i] < VOC)) return false;
  return nids.every((t) => t < VOC);
}
/** 3.8: speculative sampling cannot go on: err.sampIds = the tokens decided so far (the plain sampled loop goes on after them) */
function sampFail(why, ids) { const e = new Error('speculative sampling: ' + why); e.sampIds = ids.slice(); return e; }
