// 3.8 (from the phone bench v036, 10-23): lops_spec.js + kv_heads > 1 (qkropeMS / attnDecMS over head-major caches) + a gemvM without kPer = one split
// (the kernel steps through K in workgroup-sized pieces): hidden 2560. kv_heads 1 and K <= 2048 = v052's dispatches.
// Speculative decoding kernels (WGSL) for the p0pc0rn LLM module (p0pc0rn 3.8: Google's Gemma 4 E2B MTP drafter).
// Own file: lops.js (the single-token decode ops) stays byte-identical.  These M-token kernels were measured on an iPhone.
//
//   gemvM     y[m] = x[m] W^T for M rows at once, each weight record read ONCE (the engine gemv's thread layout and summation order,
//             the q4 min term with the engine gemv's own inline expression: bit-identical to lgemv on a desktop GPU, rounding-level on the
//             iPhone, v020).  Prologues raw | rms | pleg; epilogues store | geglu | softcap (+ per-row per-tile max/argmax).
//   qkropeMS  qkrope for M rows at positions SP[0] + m (the position lives on the GPU: a pass can be recorded before the CPU knows
//             how many drafts the pass before it accepted); k / v rows -> the f16 cache (ring for sliding layers)
//   attnDecMS M causal queries at SP[0] + m (+ attnCombM).  qoff 1: the verify pass, query m sees keys [start, pos_m] (its own K/V was
//             written first); qoff 0: the drafter, keys [start, pos) (the drafter writes no K/V; it reads the target's).  Each query's
//             chunks start at its own window start (= the single-token attnDec's chunks); a grid sized for the longest window leaves
//             empty chunks (max -3e38, sum 0) that the combine weighs exactly 0.
//   argmaxM   per-row argmax over the per-tile maxima
//   accept    m = leading drafts the target agrees with, bonus = the target's token at row m, SP[0] += m + 1, SP[1] = m, ids[0] = bonus
//   dprep     the drafter's first input: h = x[m] * rstd * w_final (the target's final-norm output at the last accepted row) -> Z[0..D)
//   topk      the drafter's 32 best clusters of 2,048 (one workgroup)
//   dhead     the drafter's head over the 32 selected clusters only (cluster-major rows: a cluster = 2 tiles of 64): per-tile max/argmax
//   dsel      the draft token: argmax over the selected rows -> token_ordering -> ids[slot], tok[0] (the next draft step's embedding)
'use strict';
import { P } from '../core/gpu.js';
import { kxPick, gemvMV5 } from './lopsx.js';   // 3.8 (bench v041): the phone's kernel picks

const PAD = (n) => Math.ceil(n / 256) * 256;
const KCH = 2048;
const GELU = (v) => `(${v} * 0.5 * (1.0 + tanh(clamp(0.7978845608028654 * (${v} + 0.044715 * ${v} * ${v} * ${v}), -15.0, 15.0))))`;
const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
const dummy = (g, i) => { g._spdummies = g._spdummies || []; return g._spdummies[i] || (g._spdummies[i] = g.buffer(256, 'spdummy' + i)); };
/** x rows staged per sub-chunk: M * XCH floats <= 4096 (16 KB of workgroup memory), a multiple of 64 (whole q4 / q8 groups) */
const xchOf = (M) => (M <= 1 ? KCH : Math.min(KCH, Math.floor(4096 / M / 64) * 64));
// v037 (10-24): gemvM variants for the iOS 27 phone (32 KB of workgroup memory): sum8 = the q4 min term's x sums made once per group of 8
// when x is staged (the same expression as before, so the same values; each record no longer repeats it per thread), xsMax = floats of
// x staged per sub-chunk (v036: 4096 = 16 KB; 6144 = 'wide'); the staging also leaves room for the reductions under the device limit.
const GV = { sum8: false, xsMax: 4096 };
export function gemvMVariant(v) { if (v) Object.assign(GV, v); return Object.assign({}, GV); }
const xchOfV = (M, softcap) => {
  if (!GV.sum8 && GV.xsMax === 4096) return xchOf(M);   // v036 exactly
  const cap = GV.xsMax > 4096 ? 2560 : KCH, room = (8192 - 256 * M - (softcap ? 128 * M : 0)) / (1 + (GV.sum8 ? 0.125 : 0));
  return M <= 1 ? KCH : Math.max(64, Math.min(cap, Math.floor(Math.min(GV.xsMax, room) / M / 64) * 64));
};

// ================================================================================================================ gemvM
function gemvMCode(c) {
  const q4 = c.w === 'q4', M = c.M, X4 = c.xch / 4, pair = c.epi === 'geglu', rows = Array.from({ length: M }, (_, m) => m);
  const L = [];
  L.push(`struct P { N: u32, K: u32, wG: u32, kPer: u32, ldy: u32, ldm: u32, ldx: u32, wOff: u32, nOff: u32, statOff: u32, statLd: u32, rowB: u32,
  evOff: u32, evLd: u32, cap: f32, nsrc: u32, ldp: u32, t0: u32, ntile: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@group(0) @binding(4) var<storage, read> NW: array<f32>;
@group(0) @binding(5) var<storage, read> EV: array<f32>;
@group(0) @binding(6) var<storage, read> ST: array<f32>;
@group(0) @binding(7) var<storage, read_write> MX: array<f32>;
var<workgroup> xs: array<vec4<f32>, ${M * X4}>;${c.sum8 && q4 ? `\nvar<workgroup> xsum: array<f32, ${M * c.xch / 8}>;` : ''}
var<workgroup> red: array<f32, ${256 * M}>;
${c.epi === 'softcap' ? `var<workgroup> mxv: array<f32, ${64 * M}>;\nvar<workgroup> mxi: array<u32, ${64 * M}>;` : ''}
fn pro(m: u32, k: u32) -> f32 {`);
  if (c.pro === 'raw') L.push(`  return X[m * p.ldx + p.rowB + k];`);
  else if (c.pro === 'rms') L.push(`  return X[m * p.ldx + p.rowB + k] * ST[p.statOff + m * p.statLd] * NW[p.nOff + k];`);
  else if (c.pro === 'pleg') L.push(`  var s = 0.0; for (var j = 0u; j < p.nsrc; j = j + 1u) { s = s + X[j * p.ldp + m * p.ldx + k]; } return ${GELU('s')} * EV[p.evOff + m * p.evLd + k];`);
  else throw new Error('gemvM: prologue ' + c.pro);
  L.push(`}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (p.pad == 0xFFFFFFFFu) { Y[0] = X[0] + NW[0] + EV[0] + ST[0] + MX[0] + f32(W[0]); }   // keeps every binding in the 'auto' layout
  let tile = wid.x; let split = wid.y;
  let k0 = split * p.kPer; let k1 = min(p.K, k0 + p.kPer);
  let r = li >> 2u; let w = li & 3u;
  let tb = tile * p.wG;${pair ? ` let tb2 = (tile + p.N / 64u) * p.wG;` : ''}
${rows.map((m) => `  var a0_${m} = 0.0;${pair ? ` var a1_${m} = 0.0;` : ''}`).join('\n')}
  for (var kk0 = k0; kk0 < k1; kk0 = kk0 + ${c.xch}u) {
    let kk1 = min(k1, kk0 + ${c.xch}u);
    workgroupBarrier();
    for (var i = li; i < ${M * X4}u; i = i + 256u) {
      let m = i / ${X4}u; let k = kk0 + (i % ${X4}u) * 4u;
      var v = vec4<f32>(0.0);
      if (k < kk1) { v = vec4<f32>(pro(m, k), pro(m, k + 1u), pro(m, k + 2u), pro(m, k + 3u)); }
      xs[i] = v;
    }
    workgroupBarrier();${c.sum8 && q4 ? `
    for (var i = li; i < ${M * c.xch / 8}u; i = i + 256u) { xsum[i] = dot(xs[2u * i], vec4<f32>(1.0)) + dot(xs[2u * i + 1u], vec4<f32>(1.0)); }
    workgroupBarrier();` : ''}`);
  if (q4) {
    const body = (acc, tbv) => `      {
        let rec = p.wOff + (${tbv} + g) * 320u; let q = W[rec + r * 4u + w]; let sm = unpack2x16float(W[rec + 256u + r]);
        let qa = vec4<f32>(vec4<u32>(q, q >> 4u, q >> 8u, q >> 12u) & vec4<u32>(15u)); let qb = vec4<f32>(vec4<u32>(q >> 16u, q >> 20u, q >> 24u, q >> 28u) & vec4<u32>(15u));
${rows.map((m) => c.sum8 ? `        { let a = xs[${m * X4}u + xv]; let b = xs[${m * X4}u + xv + 1u]; ${acc}_${m} = ${acc}_${m} + sm.x * (dot(qa, a) + dot(qb, b)) + sm.y * xsum[${m * c.xch / 8}u + xv / 2u]; }`
  : `        { let a = xs[${m * X4}u + xv]; let b = xs[${m * X4}u + xv + 1u]; ${acc}_${m} = ${acc}_${m} + sm.x * (dot(qa, a) + dot(qb, b)) + sm.y * (dot(a, vec4<f32>(1.0)) + dot(b, vec4<f32>(1.0))); }`).join('\n')}
      }`;
    L.push(`    let g0 = kk0 / 32u; let g1 = (kk1 + 31u) / 32u;
    for (var g = g0; g < g1; g = g + 1u) {
      let xv = (g * 32u - kk0) / 4u + w * 2u;
${body('a0', 'tb')}${pair ? '\n' + body('a1', 'tb2') : ''}
    }`);
  } else {
    const body = (acc, tbv) => `      {
        let rec = p.wOff + (${tbv} + g) * 1056u; let s2 = unpack2x16float(W[rec + 1024u + (r >> 1u)]); let sc = select(s2.x, s2.y, (r & 1u) == 1u);
        let wq = rec + r * 16u + w * 4u; let q0 = W[wq]; let q1 = W[wq + 1u]; let q2 = W[wq + 2u]; let q3 = W[wq + 3u];
        let v0 = vec4<f32>((vec4<i32>(vec4<u32>(q0 << 24u, q0 << 16u, q0 << 8u, q0))) >> vec4<u32>(24u));
        let v1 = vec4<f32>((vec4<i32>(vec4<u32>(q1 << 24u, q1 << 16u, q1 << 8u, q1))) >> vec4<u32>(24u));
        let v2 = vec4<f32>((vec4<i32>(vec4<u32>(q2 << 24u, q2 << 16u, q2 << 8u, q2))) >> vec4<u32>(24u));
        let v3 = vec4<f32>((vec4<i32>(vec4<u32>(q3 << 24u, q3 << 16u, q3 << 8u, q3))) >> vec4<u32>(24u));
${rows.map((m) => `        { var d = 0.0; d = d + dot(v0, xs[${m * X4}u + xv]); d = d + dot(v1, xs[${m * X4}u + xv + 1u]); d = d + dot(v2, xs[${m * X4}u + xv + 2u]); d = d + dot(v3, xs[${m * X4}u + xv + 3u]); ${acc}_${m} = ${acc}_${m} + sc * d; }`).join('\n')}
      }`;
    L.push(`    let g0 = kk0 / 64u; let g1 = (kk1 + 63u) / 64u;
    for (var g = g0; g < g1; g = g + 1u) {
      let xv = (g * 64u - kk0) / 4u + w * 4u;
${body('a0', 'tb')}${pair ? '\n' + body('a1', 'tb2') : ''}
    }`);
  }
  L.push(`  }
  workgroupBarrier();
${rows.map((m) => `  red[${m * 256}u + li] = a0_${m};`).join('\n')}
  workgroupBarrier();
${rows.map((m) => `  var t0_${m} = 0.0;`).join('\n')}
  if (w == 0u) {
${rows.map((m) => `    t0_${m} = red[${m * 256}u + li] + red[${m * 256}u + li + 1u] + red[${m * 256}u + li + 2u] + red[${m * 256}u + li + 3u];`).join('\n')}
  }
  workgroupBarrier();`);
  if (pair) L.push(`${rows.map((m) => `  red[${m * 256}u + li] = a1_${m};`).join('\n')}
  workgroupBarrier();
${rows.map((m) => `  var t1_${m} = 0.0;`).join('\n')}
  if (w == 0u) {
${rows.map((m) => `    t1_${m} = red[${m * 256}u + li] + red[${m * 256}u + li + 1u] + red[${m * 256}u + li + 2u] + red[${m * 256}u + li + 3u];`).join('\n')}
  }
  workgroupBarrier();`);
  L.push(`  let n = (tile + p.t0) * 64u + r;`);
  if (c.epi === 'store') L.push(`  if (w == 0u) {
${rows.map((m) => `    Y[split * p.ldy + ${m}u * p.ldm + n] = t0_${m};`).join('\n')}
  }`);
  else if (pair) L.push(`  if (w == 0u) {
${rows.map((m) => `    Y[${m}u * p.ldm + n] = ${GELU(`t0_${m}`)} * t1_${m};`).join('\n')}
  }`);
  else if (c.epi === 'softcap') {
    L.push(`  if (w == 0u) {
${rows.map((m) => `    { let v = p.cap * tanh(clamp(t0_${m} / p.cap, -15.0, 15.0)); Y[${m}u * p.ldm + n] = v; mxv[${m * 64}u + r] = v; mxi[${m * 64}u + r] = r; }`).join('\n')}
  }
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (li < s) {
      for (var m = 0u; m < ${M}u; m = m + 1u) {
        let a = mxv[m * 64u + li]; let b = mxv[m * 64u + li + s];
        if (b > a || (b == a && mxi[m * 64u + li + s] < mxi[m * 64u + li])) { mxv[m * 64u + li] = b; mxi[m * 64u + li] = mxi[m * 64u + li + s]; }
      }
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    for (var m = 0u; m < ${M}u; m = m + 1u) { let o = (m * p.ntile + tile + p.t0) * 2u; MX[o] = mxv[m * 64u]; MX[o + 1u] = bitcast<f32>((tile + p.t0) * 64u + mxi[m * 64u]); }
  }`);
  } else throw new Error('gemvM: epilogue ' + c.epi);
  L.push('}');
  return L.join('\n');
}

/** a = { w: {buf, off, enc, rows, cols}, x: {buf, ldx, rowB}, M, N, K, kPer, pro: raw|rms|pleg, epi: store|geglu|softcap,
 *        y: {buf, ldy (floats between splits), ldm (floats between rows)}, stat: {buf, off, ld} (rms: rstd of row m at off + m * ld),
 *        norm: {buf, off}, src: {n, ld} (pleg: split partials), ev: {buf, off, ld} (pleg), mx: {buf} (softcap: [M][N/64][2]), cap }
 *  -> the number of splits written (store: Y[split * ldy + m * ldm + n]) */
export function gemvM(g, a) {
  { const o = kxPick(a); if (o) return gemvMV5(g, a, o); }   // 3.8 (bench v041): this shape's pick (lopsx.js)
  const enc = a.w.enc, w = enc === 'q4g32a.t64' ? 'q4' : enc === 'q8g64s.t64' ? 'q8' : null;
  if (!w) throw new Error('gemvM: encoding ' + enc);
  const M = a.M, xch = xchOfV(M, a.epi === 'softcap'), cfg = { w, pro: a.pro || 'raw', epi: a.epi || 'store', M, xch, sum8: GV.sum8 && w === 'q4' };
  const pipe = g.pipeline(`lgemvM.${w}.${cfg.pro}.${cfg.epi}.${M}.${xch}${cfg.sum8 ? '.s8' : ''}`, () => gemvMCode(cfg));
  const K = a.K, N = a.N, G = w === 'q4' ? 32 : 64;
  const kPer = a.kPer ? Math.min(KCH, a.kPer) : K; if (kPer % G) throw new Error('gemvM: kPer must be a multiple of ' + G);   // v036: no kPer = one split
  const nsplit = Math.ceil(K / kPer); if (cfg.epi !== 'store' && nsplit > 1) throw new Error('gemvM: ' + cfg.epi + ' needs one split');
  if (N % 64) throw new Error('gemvM: N % 64');
  const wG = a.w.cols / G, woff = a.w.off || 0; if (woff % 4) throw new Error('gemvM: weight offset');
  const tileB = wG * (w === 'q4' ? 1280 : 4224), NT = N / 64, lim = (g.limits && g.limits.maxStorageBufferBindingSize) || Infinity;
  const ldm = a.y.ldm || N, ldy = a.y.ldy || M * ldm;
  const pr = (wo, t0) => P().u32(N).u32(K).u32(wG).u32(kPer).u32(ldy).u32(ldm).u32(a.x.ldx || K).u32(wo / 4).u32(a.norm ? a.norm.off || 0 : 0)
    .u32(a.stat ? a.stat.off || 0 : 0).u32(a.stat ? a.stat.ld || 2 : 0).u32(a.x.rowB || 0).u32(a.ev ? a.ev.off || 0 : 0).u32(a.ev ? a.ev.ld || 0 : 0)
    .f32(a.cap || 30).u32(a.src ? a.src.n : 1).u32(a.src ? a.src.ld : 0).u32(t0).u32(NT).u32(0);
  const rest = [bw(a.y.buf), bw(a.norm ? a.norm.buf : dummy(g, 0)), bw(a.ev ? a.ev.buf : dummy(g, 1)), bw(a.stat ? a.stat.buf : dummy(g, 2)), bw(a.mx ? a.mx.buf : dummy(g, 3))];
  const sec = (M * N * K * (w === 'q4' ? 0.625 : 1.03)) / (g.rate.mem * 4) + 2e-5;
  if (NT * tileB + woff % 256 <= lim || cfg.epi === 'geglu') {
    g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.w.buf), ...rest], pr(woff, 0).ab, [NT, nsplit], sec);
    return nsplit;
  }
  let per = Math.max(1, Math.floor((lim - 256) / tileB)); while (per > 1 && (per * tileB) % 256) per--;
  for (let t0 = 0; t0 < NT; t0 += per) {
    const nt = Math.min(per, NT - t0), start = woff + t0 * tileB, base = Math.floor(start / 256) * 256, wv = { buffer: a.w.buf, offset: base, size: Math.ceil((start - base + nt * tileB) / 4) * 4 };
    g.runner.dispatch(pipe, [bw(a.x.buf), wv, ...rest], pr(start - base, t0).ab, [nt, nsplit], sec * nt / NT);
  }
  return nsplit;
}

// ================================================================================================================ qkropeMS (GPU position)
const QKROPEMS = `
enable f16;
struct P { D: u32, nq: u32, hasKV: u32, ldm: u32, nkv: u32, eps: f32, qwOff: u32, kwOff: u32, npairs: u32, ropeOff: u32, ring: u32, kvLen: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<f32>;       // rows [M][ldm]: q (nq * D) | k (D) | v (D)
@group(0) @binding(2) var<storage, read> NW: array<f32>;
@group(0) @binding(3) var<storage, read> RP: array<f32>;      // [pos][npairs][cos, sin]
@group(0) @binding(4) var<storage, read_write> Q: array<f32>; // [M][nq * D]
@group(0) @binding(5) var<storage, read_write> KC: array<u32>;
@group(0) @binding(6) var<storage, read_write> VC: array<u32>;
@group(0) @binding(7) var<storage, read> SP: array<u32>;      // [0] = the position of row 0
var<workgroup> red: array<f32, 256>;
var<workgroup> hv: array<f32, 512>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let h = wid.x; let m = wid.y;
  if (h >= p.nq && p.hasKV == 0u) { return; }
  let pos = SP[0] + m; let kvRow = select(pos, pos % p.ring, p.ring > 0u);
  let sb = m * p.ldm; let base = h * p.D; let qb = m * p.nq * p.D;
  var s = 0.0;
  for (var i = t; i < p.D; i = i + 256u) { let v = 0.0 + S[sb + base + i]; hv[i] = v; s = s + v * v; }
  red[t] = s; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.D) + p.eps);
  let half = p.D / 2u;
  let isV = h >= p.nq + p.nkv; let kvh = select(h - p.nq, h - p.nq - p.nkv, isV);   // v036: k heads, then the v heads
  let cb = ((kvh * p.kvLen + kvRow) * p.D) / 2u;                                       // head-major cache [kvh][kvLen][D]
  if (isV) {
    for (var i = t; i < half; i = i + 256u) { VC[cb + i] = pack2x16float(vec2<f32>(hv[2u * i], hv[2u * i + 1u]) * rs); }
    return;
  }
  let wo = select(p.qwOff, p.kwOff, h >= p.nq);
  for (var d = t; d < half; d = d + 256u) {
    let a = hv[d] * rs * NW[wo + d]; let b = hv[d + half] * rs * NW[wo + d + half];
    var c = 1.0; var sn = 0.0;
    if (d < p.npairs) { let rb = p.ropeOff + (pos * p.npairs + d) * 2u; c = RP[rb]; sn = RP[rb + 1u]; }
    let lo = a * c - b * sn; let hi = b * c + a * sn;
    if (h < p.nq) { Q[qb + base + d] = lo; Q[qb + base + d + half] = hi; }
    else { hv[d] = lo; hv[d + half] = hi; }
  }
  if (h >= p.nq) {
    workgroupBarrier();
    for (var i = t; i < half; i = i + 256u) { KC[cb + i] = pack2x16float(vec2<f32>(hv[2u * i], hv[2u * i + 1u])); }
  }
}`;
/** M rows at positions SP[0] + m: q -> Q f32 [M][nq][D]; k, v -> f16 cache rows (hasKV) */
export function qkropeMS(g, a) {
  g.runner.dispatch(g.pipeline('lqkropeMSX', () => QKROPEMS),
    [bw(a.s.buf), bw(a.norm.buf), bw(a.rope.buf), bw(a.q.buf), bw(a.kc ? a.kc.buf : dummy(g, 4)), bw(a.vc ? a.vc.buf : dummy(g, 5)), bw(a.sp.buf)],
    P().u32(a.D).u32(a.nq).u32(a.hasKV ? 1 : 0).u32(a.s.ldm).u32(a.nkv || 1).f32(a.eps || 1e-6).u32(a.qw).u32(a.kw || 0).u32(a.npairs).u32(a.rope.off || 0).u32(a.ring || 0).u32(a.kvLen || 0).ab,
    [a.nq + (a.hasKV ? 2 * (a.nkv || 1) : 0), a.M], 2e-5 * a.M);
}

// ================================================================================================================ attnDecMS / attnCombM
const ATTDECMS = `
enable f16;
struct P { D: u32, nh: u32, ring: u32, win: u32, full: u32, M: u32, qoff: u32, nkv: u32, kvLen: u32, pad1: u32, pad2: u32, pad3: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<f32>;        // [M][nh][D]
@group(0) @binding(2) var<storage, read> KC: array<vec4<f16>>; // [S][D]
@group(0) @binding(3) var<storage, read> VC: array<vec2<f16>>; // [S][D]
@group(0) @binding(4) var<storage, read_write> PT: array<f32>; // [chunk][M]: [nh] m | [nh] l | [nh][D] acc
@group(0) @binding(5) var<storage, read> SP: array<u32>;
var<workgroup> sc: array<f32, 512>;
var<workgroup> mh: array<f32, 8>;
fn krow(j: u32) -> u32 { return select(j, j % p.ring, p.ring > 0u); }
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let c = wid.y;
  let ke = SP[0] + m + p.qoff;                    // keys [ks, ke)
  var ks = 0u; if (p.full == 0u && ke > p.win) { ks = ke - p.win; }
  let j0 = ks + c * 64u; var nk = 0u; if (j0 < ke) { nk = min(64u, ke - j0); }
  let j = t & 63u; let hg = t >> 6u; let D4 = p.D / 4u; let qm = m * p.nh * p.D;
  for (var hh = hg; hh < p.nh; hh = hh + 4u) {
    var s = -3.0e38; let jj = j0 + j;
    if (j < nk) {
      s = 0.0; let kb = ((hh / (p.nh / p.nkv)) * p.kvLen + krow(jj)) * D4; let qb = qm + hh * p.D;   // v036: the KV head of query head hh
      for (var d = 0u; d < D4; d = d + 1u) { let kv = vec4<f32>(KC[kb + d]); s = s + dot(kv, vec4<f32>(Q[qb + 4u * d], Q[qb + 4u * d + 1u], Q[qb + 4u * d + 2u], Q[qb + 4u * d + 3u])); }
    }
    sc[hh * 64u + j] = s;
  }
  workgroupBarrier();
  if (t < p.nh) { var mx = -3.0e38; for (var k = 0u; k < nk; k = k + 1u) { mx = max(mx, sc[t * 64u + k]); } mh[t] = mx; }
  workgroupBarrier();
  for (var i = t; i < p.nh * 64u; i = i + 256u) { let hh = i >> 6u; let k = i & 63u; sc[i] = select(0.0, exp(sc[i] - mh[hh]), k < nk); }
  workgroupBarrier();
  let pb = (c * p.M + m) * (p.nh * (2u + p.D));
  if (t < p.nh) { var l = 0.0; for (var k = 0u; k < nk; k = k + 1u) { l = l + sc[t * 64u + k]; } PT[pb + t] = mh[t]; PT[pb + p.nh + t] = l; }
  let D2 = p.D / 2u;
  for (var dp = t; dp < D2; dp = dp + 256u) {
    var acc: array<vec2<f32>, 8>;
    for (var hh = 0u; hh < 8u; hh = hh + 1u) { acc[hh] = vec2<f32>(0.0); }
    let hpg = p.nh / p.nkv;
    for (var k = 0u; k < nk; k = k + 1u) {
      for (var gq = 0u; gq < p.nkv; gq = gq + 1u) {   // v036: each KV head's V row serves its own hpg query heads (nkv 1 = v052's order)
        let v = vec2<f32>(VC[(gq * p.kvLen + krow(j0 + k)) * D2 + dp]);
        for (var hh = gq * hpg; hh < (gq + 1u) * hpg; hh = hh + 1u) { acc[hh] = acc[hh] + sc[hh * 64u + k] * v; }
      }
    }
    for (var hh = 0u; hh < p.nh; hh = hh + 1u) { let o = pb + 2u * p.nh + hh * p.D + 2u * dp; PT[o] = acc[hh].x; PT[o + 1u] = acc[hh].y; }
  }
}`;
const ATTCOMBM = `
struct P { D: u32, nh: u32, nchunk: u32, M: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> PT: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;  // [M][nh][D]
var<workgroup> wts: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let h = wid.x; let m = wid.y; let st = p.nh * (2u + p.D);
  if (t == 0u) {
    var Mx = -3.0e38; for (var c = 0u; c < p.nchunk; c = c + 1u) { Mx = max(Mx, PT[(c * p.M + m) * st + h]); }
    var L = 0.0; for (var c = 0u; c < p.nchunk; c = c + 1u) { let b = (c * p.M + m) * st; let e = exp(PT[b + h] - Mx); wts[c] = e; L = L + e * PT[b + p.nh + h]; }
    for (var c = 0u; c < p.nchunk; c = c + 1u) { wts[c] = wts[c] / L; }
  }
  workgroupBarrier();
  for (var d = t; d < p.D; d = d + 256u) {
    var o = 0.0; for (var c = 0u; c < p.nchunk; c = c + 1u) { o = o + wts[c] * PT[(c * p.M + m) * st + 2u * p.nh + h * p.D + d]; }
    O[(m * p.nh + h) * p.D + d] = o;
  }
}`;
/** M queries at positions SP[0] + m.  qoff 1 (verify): query m sees keys [start, pos_m]; qoff 0 (drafter): keys [start, pos).  start =
 *  0 (full) or end - win (sliding).  nchunk = the grid's chunk count, sized for the longest window this pass can have (CPU bound). */
export function attnDecMS(g, a) {
  const nchunk = a.nchunk;
  if (nchunk > 256) throw new Error('attnDecMS: context too long for one combine');
  g.runner.dispatch(g.pipeline('lattdecMSX', () => ATTDECMS), [bw(a.q.buf), bw(a.kc.buf), bw(a.vc.buf), bw(a.part.buf), bw(a.sp.buf)],
    P().u32(a.D).u32(a.nh).u32(a.ring || 0).u32(a.win).u32(a.full ? 1 : 0).u32(a.M).u32(a.qoff).u32(a.nkv || 1).u32(a.kvLen || 0).ab, [a.M, nchunk], 3e-5 * nchunk * a.M);
  g.runner.dispatch(g.pipeline('lattcombM', () => ATTCOMBM), [bw(a.part.buf), bw(a.out.buf)], P().u32(a.D).u32(a.nh).u32(nchunk).u32(a.M).ab, [a.nh, a.M], 2e-5 * a.M);
}

// ================================================================================================================ argmaxM
const ARGMAXM = `
struct P { n: u32, M: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> MX: array<f32>;        // [M][n] (max, bitcast index)
@group(0) @binding(2) var<storage, read_write> OUT: array<u32>; // [M][2]
var<workgroup> rv: array<f32, 256>;
var<workgroup> ri: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let b = m * p.n;
  var bv = -3.4e38; var bi = 0xffffffffu;
  for (var i = t; i < p.n; i = i + 256u) { let v = MX[2u * (b + i)]; let id = bitcast<u32>(MX[2u * (b + i) + 1u]); if (v > bv || (v == bv && id < bi)) { bv = v; bi = id; } }
  rv[t] = bv; ri[t] = bi; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (t < s) { let v = rv[t + s]; let id = ri[t + s]; if (v > rv[t] || (v == rv[t] && id < ri[t])) { rv[t] = v; ri[t] = id; } }
    workgroupBarrier();
  }
  if (t == 0u) { OUT[2u * m] = ri[0]; OUT[2u * m + 1u] = bitcast<u32>(rv[0]); }
}`;
export function argmaxM(g, a) {
  g.runner.dispatch(g.pipeline('largmaxM', () => ARGMAXM), [bw(a.mx.buf), bw(a.out.buf)], P().u32(a.n).u32(a.M).u32(0).u32(0).ab, [a.M, 1], 2e-5);
}

// ================================================================================================================ accept / dprep
// RES (u32): [0] m, [1] bonus, [2] next position, [3] this pass's position, [4 + 2i] / [5 + 2i] = row i's (argmax, max-logit bits) for
// i < M, [RIDS + j] = the next pass's ids (bonus, drafts) as the CPU sees them (raw ids: the PLE rows are read for these)
export const RES_ARG = 4, RES_IDS = 24, RES_WORDS = 32;   // M <= 10, ids <= 8
const ACCEPT = `
struct P { M: u32, img: u32, pad: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> ARG: array<u32>;         // [M][2]
@group(0) @binding(2) var<storage, read_write> IDS: array<u32>;   // [0] = this pass's token, [1..M) = its drafts; -> [0] = the bonus
@group(0) @binding(3) var<storage, read_write> SP: array<u32>;    // [0] position, [1] m
@group(0) @binding(4) var<storage, read_write> RES: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) t: u32) {
  if (t != 0u) { return; }
  let k = p.M - 1u; var m = 0u;
  loop { if (m >= k) { break; } if (ARG[2u * m] != RES[${RES_IDS}u + m + 1u]) { break; } m = m + 1u; }
  let bonus = ARG[2u * m]; let pos = SP[0];
  RES[0] = m; RES[1] = bonus; RES[2] = pos + m + 1u; RES[3] = pos;
  for (var i = 0u; i < p.M; i = i + 1u) { RES[${RES_ARG}u + 2u * i] = ARG[2u * i]; RES[${RES_ARG}u + 2u * i + 1u] = ARG[2u * i + 1u]; }
  SP[0] = pos + m + 1u; SP[1] = m;
  IDS[0] = select(bonus, p.pad, bonus == p.img); RES[${RES_IDS}u] = bonus;
}`;
/** after the verify pass of M rows: compares the drafts (RES's id slots, the raw ids) with the target's argmaxes */
export function accept(g, a) {
  g.runner.dispatch(g.pipeline('lspecaccept', () => ACCEPT), [bw(a.arg.buf), bw(a.ids.buf), bw(a.sp.buf), bw(a.res.buf)],
    P().u32(a.M).u32(a.img).u32(a.pad).u32(0).ab, [1, 1], 1e-5);
}
const DPREP = `
struct P { D: u32, nwOff: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;        // the verify rows [M][D] after the last layer
@group(0) @binding(2) var<storage, read> ST: array<f32>;       // their row stats [M][mean, rstd]
@group(0) @binding(3) var<storage, read> NW: array<f32>;       // the target's final norm weight (at nwOff)
@group(0) @binding(4) var<storage, read> SP: array<u32>;       // [1] = m
@group(0) @binding(5) var<storage, read> RES: array<u32>;      // [RES_IDS] = the bonus (raw id)
@group(0) @binding(6) var<storage, read_write> Z: array<f32>;  // the drafter's input row: [state (D) | embedding (D)]
@group(0) @binding(7) var<storage, read_write> TOK: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) t: u32) {
  let m = SP[1]; let rs = ST[2u * m + 1u];
  for (var k = t; k < p.D; k = k + 256u) { Z[k] = X[m * p.D + k] * rs * NW[p.nwOff + k]; }
  if (t == 0u) { TOK[0] = RES[${RES_IDS}u]; }
}`;
export function dprep(g, a) {
  g.runner.dispatch(g.pipeline('lspecdprep', () => DPREP), [bw(a.x.buf), bw(a.st.buf), bw(a.norm.buf), bw(a.sp.buf), bw(a.res.buf), bw(a.z.buf), bw(a.tok.buf)],
    P().u32(a.D).u32(a.norm.off || 0).u32(0).u32(0).ab, [1, 1], 1e-5);
}

// ================================================================================================================ the drafter's head
const TOPK = `
struct P { n: u32, k: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> CL: array<f32>;
@group(0) @binding(2) var<storage, read_write> SEL: array<u32>;
var<workgroup> v: array<f32, 2048>;
var<workgroup> rv: array<f32, 256>;
var<workgroup> ri: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) t: u32) {
  for (var i = t; i < p.n; i = i + 256u) { v[i] = CL[i]; }
  workgroupBarrier();
  for (var r = 0u; r < p.k; r = r + 1u) {
    var bv = -3.4e38; var bi = 0xffffffffu;
    for (var i = t; i < p.n; i = i + 256u) { let x = v[i]; if (x > bv || (x == bv && i < bi)) { bv = x; bi = i; } }
    rv[t] = bv; ri[t] = bi; workgroupBarrier();
    for (var s = 128u; s > 0u; s = s >> 1u) {
      if (t < s) { let x = rv[t + s]; let id = ri[t + s]; if (x > rv[t] || (x == rv[t] && id < ri[t])) { rv[t] = x; ri[t] = id; } }
      workgroupBarrier();
    }
    if (t == 0u) { let w = min(ri[0], p.n - 1u); SEL[r] = w; v[w] = -3.4e38; }
    workgroupBarrier();
  }
}`;
/** the k best of n centroid logits (one workgroup; n <= 2048) -> SEL[k] (cluster ids, best first) */
export function topk(g, a) {
  if (a.n > 2048) throw new Error('topk: n > 2048');
  g.runner.dispatch(g.pipeline('lspectopk', () => TOPK), [bw(a.cl.buf), bw(a.sel.buf)], P().u32(a.n).u32(a.k).u32(0).u32(0).ab, [1, 1], 2e-5);
}
const DHEAD = (q8) => `
struct P { K: u32, wG: u32, statOff: u32, nOff: u32, tPer: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;       // the head, cluster-major rows (tile records)
@group(0) @binding(3) var<storage, read> ST: array<f32>;
@group(0) @binding(4) var<storage, read> NW: array<f32>;
@group(0) @binding(5) var<storage, read> SEL: array<u32>;
@group(0) @binding(6) var<storage, read_write> MX: array<f32>; // [selected tiles][max, bitcast row]
var<workgroup> xs: array<f32, 512>;
var<workgroup> red: array<f32, 256>;
var<workgroup> mxv: array<f32, 64>;
var<workgroup> mxi: array<u32, 64>;
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
  var tot = 0.0; if (w == 0u) { tot = red[li] + red[li + 1u] + red[li + 2u] + red[li + 3u]; }
  workgroupBarrier();
  if (w == 0u) { mxv[r] = tot; mxi[r] = tile * 64u + r; }
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (li < s) { let a2 = mxv[li]; let b2 = mxv[li + s]; if (b2 > a2 || (b2 == a2 && mxi[li + s] < mxi[li])) { mxv[li] = b2; mxi[li] = mxi[li + s]; } }
    workgroupBarrier();
  }
  if (li == 0u) { MX[wt * 2u] = mxv[0]; MX[wt * 2u + 1u] = bitcast<f32>(mxi[0]); }
}`;
/** dot products of the drafter's normed hidden with the selected clusters' rows only; tPer = tiles per cluster (128 rows = 2) */
export function dhead(g, a) {
  const q8 = a.w.enc === 'q8g64s.t64';
  if (!q8 && a.w.enc !== 'q4g32a.t64') throw new Error('dhead: encoding ' + a.w.enc);
  if (a.K > 512) throw new Error('dhead: K > 512');
  const wG = a.K / (q8 ? 64 : 32);
  g.runner.dispatch(g.pipeline('lspecdhead' + (q8 ? '8' : '4'), () => DHEAD(q8)),
    [bw(a.x.buf), bw(a.w.buf, a.w.off, a.w.bytes), bw(a.stat.buf), bw(a.norm.buf), bw(a.sel.buf), bw(a.mx.buf)],
    P().u32(a.K).u32(wG).u32(a.stat.off || 0).u32(a.norm.off || 0).u32(a.tPer).u32(0).u32(0).u32(0).ab, [a.nsel * a.tPer, 1], 4e-5);
}
const DSEL = `
struct P { n: u32, slot: u32, img: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> MX: array<f32>;       // [n][max, bitcast row]
@group(0) @binding(2) var<storage, read> ORD: array<u32>;      // row -> token id
@group(0) @binding(3) var<storage, read_write> IDS: array<u32>;
@group(0) @binding(4) var<storage, read_write> TOK: array<u32>;
@group(0) @binding(5) var<storage, read_write> RES: array<u32>;
var<workgroup> rv: array<f32, 64>;
var<workgroup> ri: array<u32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) t: u32) {
  var bv = -3.4e38; var bi = 0xffffffffu;
  for (var i = t; i < p.n; i = i + 64u) { let v = MX[2u * i]; let id = bitcast<u32>(MX[2u * i + 1u]); if (v > bv || (v == bv && id < bi)) { bv = v; bi = id; } }
  rv[t] = bv; ri[t] = bi; workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (t < s) { let v = rv[t + s]; let id = ri[t + s]; if (v > rv[t] || (v == rv[t] && id < ri[t])) { rv[t] = v; ri[t] = id; } }
    workgroupBarrier();
  }
  if (t == 0u) {
    let tok = ORD[ri[0]];
    IDS[p.slot] = select(tok, p.pad, tok == p.img); TOK[0] = tok; RES[${RES_IDS}u + p.slot] = tok;
  }
}`;
/** the draft token of step `slot`: -> IDS[slot] (the next verify pass's input), TOK[0] (the next draft step's embedding), RES */
export function dsel(g, a) {
  g.runner.dispatch(g.pipeline('lspecdsel', () => DSEL), [bw(a.mx.buf), bw(a.ord.buf, a.ord.off, a.ord.bytes), bw(a.ids.buf), bw(a.tok.buf), bw(a.res.buf)],
    P().u32(a.n).u32(a.slot).u32(a.img).u32(a.pad).ab, [1, 1], 1e-5);
}

export { PAD, xchOf };
