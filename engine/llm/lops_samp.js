// Speculative SAMPLING kernels (WGSL) for the p0pc0rn LLM module (p0pc0rn 3.8): a sampled answer (temperature / top-p / top-k) keeps
// Google's MTP drafter.  Without them a sampler meant the plain loop: no drafts, and all 262,144 logits read back and sorted on the CPU
// per token.  Measured on an iPhone 16 Pro Max at temperature 0.3, top-p 0.95, top-k 64: 2.4x the plain sampled loop, 93% of the greedy
// speed with the drafter.
//   topkRows   the K = 64 best logits of each verify row (value descending, index ascending): 2,048-logit blocks, then one merge (bitonic
//              sorts in workgroup memory, <= 19 KB).  A row's distribution is llm.js makeSampler's: p_j = exp((v_j - v_max) / T) over the
//              top K, cut where the running sum reaches top-p (the token that crosses it is kept)
//   sample1    a token from one row's distribution (the sampler's own check uses it)
//   dheadL     the drafter's head over its 32 selected clusters with every candidate's logit kept (dhead keeps only each tile's best)
//   dsample    the sampled draft: the top K of the drafter's 4,096 candidates -> q (the same rule) -> a token drawn from q; q's (token,
//              probability) pairs are kept per draft slot for the accept test
//   acceptS    after a verify pass: draft d at row i is kept with probability min(1, p_i(d) / q(d)); the first one not kept is replaced by
//              a token from the residual max(0, p_i - q); all kept -> a bonus token from the last row.  The tokens follow the target's own
//              distribution (Leviathan et al. 2023; Chen et al. 2023).  RES / SP / IDS as lops_spec.js accept writes them, + SP[2] = the
//              pass count.
// The uniforms are counter-based (a PCG hash of the seed, the position, the purpose and the pass count): nothing to keep on the GPU, and
// every pass draws fresh numbers.  At a temperature near 0 every distribution is its argmax: sample1 = argmax, acceptS = the greedy accept.
'use strict';
import { P } from '../core/gpu.js';
import { RES_ARG, RES_IDS } from './lops_spec.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
export const KS = 64, BLK = 2048;
const kOf = (k) => Math.max(1, Math.min(KS, k || KS));   // the rows keep 64: a larger top-K is cut to it (the caller checks)

const HELP = `
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn unif(seed: u32, pos: u32, purpose: u32, extra: u32) -> f32 {   // [0, 1), 24 bits
  let h = pcg(pcg(pcg(seed ^ pcg(pos)) ^ (purpose * 2654435769u)) ^ extra);
  return f32(h >> 8u) / 16777216.0;
}
fn bef(av: f32, ai: u32, bv: f32, bi: u32) -> bool { return av > bv || (av == bv && ai < bi); }`;
// a bitonic sort of sv / si [0, n) into bef order (largest value first, ties by index); 256 threads, uniform control flow
const SORT = (n) => `
  for (var k = 2u; k <= ${n}u; k = k << 1u) {
    for (var j = k >> 1u; j > 0u; j = j >> 1u) {
      for (var i = t; i < ${n}u; i = i + 256u) {
        let l = i ^ j;
        if (l > i) {
          let lb = bef(sv[l], si[l], sv[i], si[i]);
          if (((i & k) == 0u) == lb) { let tv = sv[i]; sv[i] = sv[l]; sv[l] = tv; let ti = si[i]; si[i] = si[l]; si[l] = ti; }
        }
      }
      workgroupBarrier();
    }
  }`;
// the distribution of a sorted top-K row (makeSampler's rule) -> (n kept, zz = their sum); TK = the row's array, base = its offset
const DIST = (TK) => `
fn pj(base: u32, j: u32) -> f32 { return exp((bitcast<f32>(${TK}[base + j].x) - bitcast<f32>(${TK}[base].x)) / p.temp); }
fn rowDist(base: u32) -> vec2<f32> {
  var z = 0.0; for (var j = 0u; j < p.kTop; j = j + 1u) { z = z + pj(base, j); }
  var cum = 0.0; var n = 0u; var zz = 0.0;
  for (var j = 0u; j < p.kTop; j = j + 1u) { let q = pj(base, j); cum = cum + q / z; zz = zz + q; n = j + 1u; if (cum >= p.topP) { break; } }
  return vec2<f32>(f32(n), zz);
}
fn rowPick(base: u32, u: f32) -> u32 {   // the token of the row's distribution at uniform u
  let d = rowDist(base); let n = u32(d.x); var r = u * d.y; var tok = ${TK}[base + n - 1u].y;
  for (var j = 0u; j < n; j = j + 1u) { r = r - pj(base, j); if (r <= 0.0) { tok = ${TK}[base + j].y; break; } }
  return tok;
}`;

const TOPKA = `${HELP}
struct P { V: u32, nb: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> L: array<f32>;            // [M][V]
@group(0) @binding(2) var<storage, read_write> C: array<vec2<u32>>; // [M][nb][64] (value bits, index)
var<workgroup> sv: array<f32, ${BLK}>;
var<workgroup> si: array<u32, ${BLK}>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let b = wid.x; let m = wid.y; let base = m * p.V + b * ${BLK}u;
  for (var i = t; i < ${BLK}u; i = i + 256u) { sv[i] = L[base + i]; si[i] = b * ${BLK}u + i; }
  workgroupBarrier();${SORT(BLK)}
  if (t < 64u) { C[(m * p.nb + b) * 64u + t] = vec2<u32>(bitcast<u32>(sv[t]), si[t]); }
}`;
const TOPKB = `${HELP}
struct P { nb: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> C: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> TK: array<vec2<u32>>; // [M][64]
var<workgroup> sv: array<f32, ${BLK}>;
var<workgroup> si: array<u32, ${BLK}>;
var<workgroup> kv: array<f32, 256>;
var<workgroup> ki: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let n = p.nb * 64u; let nch = (n + ${BLK - 1}u) / ${BLK}u;
  for (var c = 0u; c < nch; c = c + 1u) {
    for (var i = t; i < ${BLK}u; i = i + 256u) {
      let gi = c * ${BLK}u + i;
      if (gi < n) { let e = C[m * n + gi]; sv[i] = bitcast<f32>(e.x); si[i] = e.y; } else { sv[i] = -3.4e38; si[i] = 0xFFFFFFFFu; }
    }
    workgroupBarrier();${SORT(BLK)}
    if (t < 64u) { kv[c * 64u + t] = sv[t]; ki[c * 64u + t] = si[t]; }
    workgroupBarrier();
  }
  for (var i = t; i < 256u; i = i + 256u) { if (i < nch * 64u) { sv[i] = kv[i]; si[i] = ki[i]; } else { sv[i] = -3.4e38; si[i] = 0xFFFFFFFFu; } }
  workgroupBarrier();${SORT(256)}
  if (t < 64u) { TK[m * 64u + t] = vec2<u32>(bitcast<u32>(sv[t]), si[t]); }
}`;
/** the top 64 of each of M rows of V logits (V a multiple of 2,048, V / 2,048 * 64 <= 8,192) -> tk [M][64] (value bits, index) */
export function topkRows(g, a) {
  const nb = a.V / BLK; if (a.V % BLK || nb * 64 > 4 * BLK) throw new Error('topkRows: V ' + a.V);
  g.runner.dispatch(g.pipeline('lsampTopkA', () => TOPKA), [bw(a.logits.buf), bw(a.cand.buf)], P().u32(a.V).u32(nb).u32(0).u32(0).ab, [nb, a.M], 2e-5 * nb * a.M);
  g.runner.dispatch(g.pipeline('lsampTopkB', () => TOPKB), [bw(a.cand.buf), bw(a.tk.buf)], P().u32(nb).u32(0).u32(0).u32(0).ab, [a.M, 1], 6e-5 * a.M);
}
export const candBytes = (M, V) => M * (V / BLK) * 64 * 8;

const SAMPLE1 = `${HELP}
struct P { kTop: u32, M: u32, seed: u32, pos: u32, temp: f32, topP: f32, purpose: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> TK: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> OUT: array<u32>;     // [m * 2] = the token (an argmax buffer's slot)
${DIST('TK')}
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) t: u32) {
  if (t >= p.M) { return; }
  OUT[2u * t] = rowPick(t * 64u, unif(p.seed, p.pos + t, p.purpose, 0u));
}`;
/** sampled tokens of M rows (top-K + top-p at temperature) into out[2m] */
export function sample1(g, a) {
  g.runner.dispatch(g.pipeline('lsampOne', () => SAMPLE1), [bw(a.tk.buf), bw(a.out.buf)],
    P().u32(kOf(a.kTop)).u32(a.M || 1).u32(a.seed >>> 0).u32(a.pos).f32(a.temp).f32(a.topP || 1).u32(a.purpose || 1).u32(0).ab, [1, 1], 1e-5);
}

const DHEADL = (q8) => `
struct P { K: u32, wG: u32, statOff: u32, nOff: u32, tPer: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read> ST: array<f32>;
@group(0) @binding(4) var<storage, read> NW: array<f32>;
@group(0) @binding(5) var<storage, read> SEL: array<u32>;
@group(0) @binding(6) var<storage, read_write> DL: array<vec2<u32>>;   // [selected tiles * 64] (logit bits, head row)
var<workgroup> xs: array<f32, 512>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let wt = wid.x; let tile = SEL[wt / p.tPer] * p.tPer + (wt % p.tPer);
  let rs = ST[p.statOff];
  for (var k = li; k < p.K; k = k + 256u) { xs[k] = X[k] * rs * NW[p.nOff + k]; }
  workgroupBarrier();
  let r = li >> 2u; let w = li & 3u; let tb = tile * p.wG;
  var acc = 0.0;
  for (var g = 0u; g < p.wG; g = g + 1u) {
${q8 ? `    let rec = (tb + g) * 1056u; let s2 = unpack2x16float(W[rec + 1024u + (r >> 1u)]); let sc = select(s2.x, s2.y, (r & 1u) == 1u);
    var d = 0.0;
    for (var u = 0u; u < 4u; u = u + 1u) {
      let q = W[rec + r * 16u + w * 4u + u]; let xb = g * 64u + w * 16u + u * 4u;
      let qv = vec4<f32>((vec4<i32>(vec4<u32>(q << 24u, q << 16u, q << 8u, q))) >> vec4<u32>(24u));
      d = d + dot(qv, vec4<f32>(xs[xb], xs[xb + 1u], xs[xb + 2u], xs[xb + 3u]));
    }
    acc = acc + sc * d;` : `    let rec = (tb + g) * 320u; let q = W[rec + r * 4u + w]; let sm = unpack2x16float(W[rec + 256u + r]);
    let xb = g * 32u + w * 8u;
    let a = vec4<f32>(xs[xb], xs[xb + 1u], xs[xb + 2u], xs[xb + 3u]); let b = vec4<f32>(xs[xb + 4u], xs[xb + 5u], xs[xb + 6u], xs[xb + 7u]);
    let qa = vec4<f32>(vec4<u32>(q, q >> 4u, q >> 8u, q >> 12u) & vec4<u32>(15u)); let qb = vec4<f32>(vec4<u32>(q >> 16u, q >> 20u, q >> 24u, q >> 28u) & vec4<u32>(15u));
    acc = acc + sm.x * (dot(qa, a) + dot(qb, b)) + sm.y * (dot(a, vec4<f32>(1.0)) + dot(b, vec4<f32>(1.0)));`}
  }
  red[li] = acc; workgroupBarrier();
  if (w == 0u) { let tot = red[li] + red[li + 1u] + red[li + 2u] + red[li + 3u]; DL[wt * 64u + r] = vec2<u32>(bitcast<u32>(tot), tile * 64u + r); }
}`;
/** lops_spec.js dhead with every selected row's logit kept: dl [nsel * tPer * 64] (the same dot products, the same summation) */
export function dheadL(g, a) {
  const q8 = a.w.enc === 'q8g64s.t64';
  if (!q8 && a.w.enc !== 'q4g32a.t64') throw new Error('dheadL: encoding ' + a.w.enc);
  if (a.K > 512) throw new Error('dheadL: K > 512');
  const wG = a.K / (q8 ? 64 : 32);
  g.runner.dispatch(g.pipeline('lsampDheadL' + (q8 ? '8' : '4'), () => DHEADL(q8)),
    [bw(a.x.buf), bw(a.w.buf, a.w.off, a.w.bytes), bw(a.stat.buf), bw(a.norm.buf), bw(a.sel.buf), bw(a.dl.buf)],
    P().u32(a.K).u32(wG).u32(a.stat.off || 0).u32(a.norm.off || 0).u32(a.tPer).u32(0).u32(0).u32(0).ab, [a.nsel * a.tPer, 1], 4e-5);
}

const DSAMPLE = `${HELP}
struct P { n: u32, slot: u32, img: u32, pad: u32, kTop: u32, seed: u32, temp: f32, topP: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> DL: array<vec2<u32>>;     // [n] (logit bits, head row)
@group(0) @binding(2) var<storage, read> ORD: array<u32>;          // head row -> token id
@group(0) @binding(3) var<storage, read_write> IDS: array<u32>;
@group(0) @binding(4) var<storage, read_write> TOK: array<u32>;
@group(0) @binding(5) var<storage, read_write> RES: array<u32>;
@group(0) @binding(6) var<storage, read_write> Q: array<vec2<u32>>; // [slot][64] (token, q bits)
@group(0) @binding(7) var<storage, read> SP: array<u32>;           // [0] the next pass's position (acceptS moved it), [2] the pass count
var<workgroup> sv: array<f32, ${BLK}>;
var<workgroup> si: array<u32, ${BLK}>;
var<workgroup> kv: array<f32, 256>;
var<workgroup> ki: array<u32, 256>;
var<workgroup> TS: array<vec2<u32>, 64>;
var<workgroup> wn: u32;
var<workgroup> wz: f32;
${DIST('TS')}
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) t: u32) {
  let nch = (p.n + ${BLK - 1}u) / ${BLK}u;
  for (var c = 0u; c < nch; c = c + 1u) {
    for (var i = t; i < ${BLK}u; i = i + 256u) {
      let gi = c * ${BLK}u + i;
      if (gi < p.n) { let e = DL[gi]; sv[i] = bitcast<f32>(e.x); si[i] = e.y; } else { sv[i] = -3.4e38; si[i] = 0xFFFFFFFFu; }
    }
    workgroupBarrier();${SORT(BLK)}
    if (t < 64u) { kv[c * 64u + t] = sv[t]; ki[c * 64u + t] = si[t]; }
    workgroupBarrier();
  }
  for (var i = t; i < 256u; i = i + 256u) { if (i < nch * 64u) { sv[i] = kv[i]; si[i] = ki[i]; } else { sv[i] = -3.4e38; si[i] = 0xFFFFFFFFu; } }
  workgroupBarrier();${SORT(256)}
  if (t < 64u) { TS[t] = vec2<u32>(bitcast<u32>(sv[t]), si[t]); }
  workgroupBarrier();
  if (t == 0u) {
    let d = rowDist(0u); wn = u32(d.x); wz = d.y;
    let row = rowPick(0u, unif(p.seed, SP[0] + p.slot, 2u, SP[2]));
    let tok = ORD[row];
    IDS[p.slot] = select(tok, p.pad, tok == p.img); TOK[0] = tok; RES[${RES_IDS}u + p.slot] = tok;
  }
  workgroupBarrier();
  if (t < 64u) {
    let qb = p.slot * 64u + t;
    if (t < wn) { Q[qb] = vec2<u32>(ORD[TS[t].y], bitcast<u32>(pj(0u, t) / wz)); } else { Q[qb] = vec2<u32>(0xFFFFFFFFu, 0u); }
  }
}`;
/** the drafter's sampled draft for `slot` from its 4,096 candidate logits (dheadL): -> IDS[slot] / TOK[0] / RES ids (as dsel) + q's table */
export function dsample(g, a) {
  if (a.n > 4 * BLK) throw new Error('dsample: ' + a.n + ' candidates > ' + 4 * BLK);
  g.runner.dispatch(g.pipeline('lsampDraft', () => DSAMPLE), [bw(a.dl.buf), bw(a.ord.buf, a.ord.off, a.ord.bytes), bw(a.ids.buf), bw(a.tok.buf), bw(a.res.buf), bw(a.q.buf), bw(a.sp.buf)],
    P().u32(a.n).u32(a.slot).u32(a.img).u32(a.pad).u32(kOf(a.kTop)).u32(a.seed >>> 0).f32(a.temp).f32(a.topP || 1).ab, [1, 1], 6e-5);
}

const ACCEPTS = `${HELP}
struct P { M: u32, kTop: u32, img: u32, pad: u32, seed: u32, pad1: u32, temp: f32, topP: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> TK: array<vec2<u32>>;     // the verify rows' top 64 [M][64]
@group(0) @binding(2) var<storage, read> Q: array<vec2<u32>>;      // the drafts' q tables [slot][64]
@group(0) @binding(3) var<storage, read_write> IDS: array<u32>;
@group(0) @binding(4) var<storage, read_write> SP: array<u32>;     // [0] position, [1] m, [2] the pass count
@group(0) @binding(5) var<storage, read_write> RES: array<u32>;
${DIST('TK')}
fn qOf(slot: u32, x: u32) -> f32 { for (var j = 0u; j < 64u; j = j + 1u) { let e = Q[slot * 64u + j]; if (e.x == x) { return bitcast<f32>(e.y); } } return 0.0; }
fn pOf(base: u32, n: u32, zz: f32, x: u32) -> f32 { for (var j = 0u; j < n; j = j + 1u) { if (TK[base + j].y == x) { return pj(base, j) / zz; } } return 0.0; }
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) t: u32) {
  if (t != 0u) { return; }
  let pos = SP[0]; let npass = SP[2]; var m = 0u; var bonus = 0u; var rejected = false;
  for (var i = 0u; i + 1u < p.M; i = i + 1u) {
    let d = RES[${RES_IDS}u + i + 1u]; let base = i * 64u;
    let dist = rowDist(base); let n = u32(dist.x); let zz = dist.y;
    let pd = pOf(base, n, zz, d); let qd = qOf(i + 1u, d);
    if (unif(p.seed, pos + i, 3u, npass) * qd < pd) { m = i + 1u; continue; }   // kept with probability min(1, pd / qd)
    var W = 0.0;   // not kept: the residual max(0, p - q) over the row's kept tokens
    for (var j = 0u; j < n; j = j + 1u) { W = W + max(0.0, pj(base, j) / zz - qOf(i + 1u, TK[base + j].y)); }
    let u = unif(p.seed, pos + i, 4u, npass);
    if (W <= 0.0) { bonus = rowPick(base, u); }
    else {
      var r = u * W; bonus = TK[base + n - 1u].y;
      for (var j = 0u; j < n; j = j + 1u) { r = r - max(0.0, pj(base, j) / zz - qOf(i + 1u, TK[base + j].y)); if (r <= 0.0) { bonus = TK[base + j].y; break; } }
    }
    m = i; rejected = true; break;
  }
  if (!rejected) { m = p.M - 1u; bonus = rowPick(m * 64u, unif(p.seed, pos + m, 5u, npass)); }
  for (var i = 0u; i < m; i = i + 1u) { RES[${RES_ARG}u + 2u * i] = RES[${RES_IDS}u + i + 1u]; RES[${RES_ARG}u + 2u * i + 1u] = 0u; }
  RES[${RES_ARG}u + 2u * m] = bonus; RES[${RES_ARG}u + 2u * m + 1u] = 0u;
  RES[0] = m; RES[1] = bonus; RES[2] = pos + m + 1u; RES[3] = pos;
  SP[0] = pos + m + 1u; SP[1] = m; SP[2] = npass + 1u;
  IDS[0] = select(bonus, p.pad, bonus == p.img); RES[${RES_IDS}u] = bonus;
}`;
/** speculative sampling after a verify pass of M rows (tk = their top 64, q = the drafts' q tables): RES / SP / IDS as accept writes them */
export function acceptS(g, a) {
  g.runner.dispatch(g.pipeline('lsampAccept', () => ACCEPTS), [bw(a.tk.buf), bw(a.q.buf), bw(a.ids.buf), bw(a.sp.buf), bw(a.res.buf)],
    P().u32(a.M).u32(kOf(a.kTop)).u32(a.img).u32(a.pad).u32(a.seed >>> 0).u32(0).f32(a.temp).f32(a.topP || 1).ab, [1, 1], 2e-5);
}

/** build the speculative sampling pipelines now (q8 = the drafter's head encoding), inside a validation error scope: -> null, or why this
 *  GPU cannot run them (the caller then samples on the CPU).  An invalid pipeline would otherwise void its whole pass without a sound. */
export async function prepare(g, { q8 = true } = {}) {
  const d = g.device; let why = null, scoped = false;
  try { d.pushErrorScope('validation'); scoped = true; } catch (e) { /* no error scopes here: the loop's readback check still guards */ }
  try {
    g.pipeline('lsampTopkA', () => TOPKA); g.pipeline('lsampTopkB', () => TOPKB); g.pipeline('lsampDheadL' + (q8 ? '8' : '4'), () => DHEADL(q8));
    g.pipeline('lsampDraft', () => DSAMPLE); g.pipeline('lsampAccept', () => ACCEPTS);
  } catch (e) { why = String((e && e.message) || e); }
  if (scoped) { try { const ve = await d.popErrorScope(); if (ve && !why) why = String(ve.message || ve); } catch (e) { /* */ } }
  return why;
}
