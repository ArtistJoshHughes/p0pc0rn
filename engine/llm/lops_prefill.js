// 3.8 (from the phone bench v036, 10-23): lops_prefill.js + kv_heads > 1 (qkropeP writes Q group-major and K / V head-major; attnPreGemm per KV head).
// kv_heads 1 = v052's dispatches.
// Gemma 4 E2B prefill kernels (M tokens at once) for the p0pc0rn LLM module; the big GEMMs use the shared ops/gemm.js.
//   qkropeP  rows of the fused qkv GEMM output (f16 [M][ldx]) -> per-head RMS (+ weight), RoPE at position p0 + m,
//            Q f16 token-major [M][nq][D] (for attnPre), k / v f16 cache rows kv0 + m
//   attnPre  flash attention, MQA (nh query heads share one K/V head), causal + optional sliding window, scale 1.  A workgroup owns
//            QP query positions x nh heads (R rows) and streams the key range in tiles of 16 (K, then V, through one buffer);
//            online softmax with f32 statistics, f32 accumulate, f16 out [T][nh * D]
//   attnPreGemm  v046: the same attention as GEMMs by key blocks (end of file)
//   cast16 / plegate  small elementwise kernels (f32 -> f16; gelu_tanh(gate) * per-layer input -> f16)
'use strict';
import { P } from '../core/gpu.js';
import { gemm } from '../ops/gemm.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
const dummy = (g, i) => { g._lpdummies = g._lpdummies || []; return g._lpdummies[i] || (g._lpdummies[i] = g.buffer(256, 'lpdummy' + i)); };

const QKROPEP = `
enable f16;
struct P { D: u32, nq: u32, hasKV: u32, ldx: u32, p0: u32, eps: f32, qwOff: u32, kwOff: u32, npairs: u32, ropeOff: u32, kv0: u32, ring: u32, nkv: u32, kvLen: u32, M: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<u32>;
@group(0) @binding(2) var<storage, read> NW: array<f32>;
@group(0) @binding(3) var<storage, read> RP: array<f32>;
@group(0) @binding(4) var<storage, read_write> Q: array<u32>;
@group(0) @binding(5) var<storage, read_write> KC: array<u32>;
@group(0) @binding(6) var<storage, read_write> VC: array<u32>;
var<workgroup> red: array<f32, 256>;
var<workgroup> hv: array<f32, 512>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  if (p.ring == 0xFFFFFFFFu) { Q[0] = X[0] + u32(NW[0] + RP[0]); KC[0] = 0u; VC[0] = 0u; }
  let h = wid.x; let m = wid.y + wid.z * 65535u;
  if (h >= p.nq && p.hasKV == 0u) { return; }
  let D2 = p.D / 2u; let xb = (m * p.ldx + h * p.D) / 2u;
  var s = 0.0;
  for (var i = t; i < D2; i = i + 256u) { let v = unpack2x16float(X[xb + i]); hv[2u * i] = v.x; hv[2u * i + 1u] = v.y; s = s + dot(v, v); }
  red[t] = s; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.D) + p.eps);
  let pos = p.p0 + m; let half = p.D / 2u; let kr = select(p.kv0 + m, (p.kv0 + m) % p.ring, p.ring > 0u);
  let isV = h >= p.nq + p.nkv; let kvh = select(h - p.nq, h - p.nq - p.nkv, isV);   // v036: k heads, then the v heads
  let cb = ((kvh * p.kvLen + kr) * p.D) / 2u;                                         // head-major cache [kvh][kvLen][D]
  if (isV) {
    for (var i = t; i < D2; i = i + 256u) { VC[cb + i] = pack2x16float(vec2<f32>(hv[2u * i], hv[2u * i + 1u]) * rs); }
    return;
  }
  let wo = select(p.qwOff, p.kwOff, h >= p.nq);
  var lo = array<f32, 2>(0.0, 0.0); var hi = array<f32, 2>(0.0, 0.0); var n = 0u;
  for (var d = t; d < half; d = d + 256u) {
    let a = hv[d] * rs * NW[wo + d]; let b = hv[d + half] * rs * NW[wo + d + half];
    var c = 1.0; var sn = 0.0;
    if (d < p.npairs) { let rb = p.ropeOff + (pos * p.npairs + d) * 2u; c = RP[rb]; sn = RP[rb + 1u]; }
    lo[n] = a * c - b * sn; hi[n] = b * c + a * sn; n = n + 1u;
  }
  workgroupBarrier();
  n = 0u;
  for (var d = t; d < half; d = d + 256u) { hv[d] = lo[n]; hv[d + half] = hi[n]; n = n + 1u; }
  workgroupBarrier();
  for (var i = t; i < D2; i = i + 256u) {
    let v = pack2x16float(vec2<f32>(hv[2u * i], hv[2u * i + 1u]));
    if (h < p.nq) { let hpg = p.nq / p.nkv; Q[((((h / hpg) * p.M + m) * hpg + h % hpg) * p.D) / 2u + i] = v; } else { KC[cb + i] = v; }   // v036: Q group-major [kvh][M][hpg][D]
  }
}`;
/** x: {buf, off, ld} f16 rows [q (nq D) | k (D) | v (D)]; M rows at positions p0 + m; kv rows kv0 + m */
export function qkropeP(g, a) {
  const M = a.M;
  g.runner.dispatch(g.pipeline('lqkropePX', () => QKROPEP),
    [bw(a.x.buf, a.x.off || 0), bw(a.norm.buf), bw(a.rope.buf), bw(a.q.buf), bw(a.kc ? a.kc.buf : dummy(g, 1)), bw(a.vc ? a.vc.buf : dummy(g, 2))],
    P().u32(a.D).u32(a.nq).u32(a.hasKV ? 1 : 0).u32(a.x.ld).u32(a.p0).f32(a.eps || 1e-6).u32(a.qw).u32(a.kw || 0).u32(a.npairs).u32(a.rope.off || 0).u32(a.kv0).u32(a.ring || 0)
      .u32(a.nkv || 1).u32(a.kvLen || 0).u32(M).u32(0).ab,
    [a.nq + (a.hasKV ? 2 * (a.nkv || 1) : 0), Math.min(M, 65535), Math.ceil(M / 65535)], 2e-6 * M);
}

/** v026.9: the workgroup memory of a (D, QP, nh, BK) prefill-attention variant */
export const attnPreBytes = (D, QP, nh, BK) => { const R = QP * nh, D2 = D / 2; return R * D2 * 4 + BK * D2 * 4 + R * BK * 4 + 3 * R * 4; };
function attnPreCode(D, QP, nh, BK = 16) {
  const R = QP * nh, TPR = 256 / R, NDT = D / TPR, D2 = D / 2;
  if (256 % R || D % TPR || NDT % 2) throw new Error('attnPre config');
  return `
enable f16;
struct P { T: u32, p0: u32, win: u32, kv0: u32, ring: u32, pad1: u32, pad2: u32, pad3: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<u32>;
@group(0) @binding(2) var<storage, read> KC: array<u32>;
@group(0) @binding(3) var<storage, read> VC: array<u32>;
@group(0) @binding(4) var<storage, read_write> O: array<u32>;
var<workgroup> qs: array<u32, ${R * D2}>;
var<workgroup> ks: array<u32, ${BK * D2}>;
var<workgroup> sc: array<f32, ${R * BK}>;
var<workgroup> mr: array<f32, ${R}>;
var<workgroup> lr: array<f32, ${R}>;
var<workgroup> ar: array<f32, ${R}>;
fn krow(j: u32) -> u32 { return select(j - p.kv0, j % p.ring, p.ring > 0u); }
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let i0 = wid.x * ${QP}u; let nqp = min(${QP}u, p.T - i0);
  let posLast = p.p0 + i0 + nqp - 1u; let posFirst = p.p0 + i0;
  var kLo = 0u; if (p.win > 0u && posFirst + 1u > p.win) { kLo = posFirst + 1u - p.win; }
  for (var i = t; i < ${R * D2}u; i = i + 256u) { var v = 0u; if (i / ${D2}u / ${nh}u < nqp) { v = Q[(i0 * ${nh}u) * ${D2}u + i]; } qs[i] = v; }
  if (t < ${R}u) { mr[t] = -1.0e30; lr[t] = 0.0; }
  let r = t / ${TPR}u; let d0 = (t % ${TPR}u) * ${NDT}u;
  var acc: array<f32, ${NDT}>;
  for (var u = 0u; u < ${NDT}u; u = u + 1u) { acc[u] = 0.0; }
  workgroupBarrier();
  for (var j0 = kLo; j0 <= posLast; j0 = j0 + ${BK}u) {
    for (var i = t; i < ${BK * D2}u; i = i + 256u) { let j = j0 + i / ${D2}u; var v = 0u; if (j <= posLast) { v = KC[krow(j) * ${D2}u + i % ${D2}u]; } ks[i] = v; }
    workgroupBarrier();
    for (var e = t; e < ${R * BK}u; e = e + 256u) {
      let rr = e / ${BK}u; let jj = e % ${BK}u; let key = j0 + jj; let pos = p.p0 + i0 + rr / ${nh}u;
      var lo = 0u; if (p.win > 0u && pos + 1u > p.win) { lo = pos + 1u - p.win; }
      var s = -3.0e38;
      if (rr / ${nh}u < nqp && key <= pos && key >= lo) {
        s = 0.0; let qb = rr * ${D2}u; let kb = jj * ${D2}u;
        for (var d = 0u; d < ${D2}u; d = d + 1u) { s = s + dot(unpack2x16float(qs[qb + d]), unpack2x16float(ks[kb + d])); }
      }
      sc[e] = s;
    }
    workgroupBarrier();
    if (t < ${R}u) {
      var mx = mr[t]; for (var jj = 0u; jj < ${BK}u; jj = jj + 1u) { mx = max(mx, sc[t * ${BK}u + jj]); }
      let al = exp(mr[t] - mx); var l = lr[t] * al;
      for (var jj = 0u; jj < ${BK}u; jj = jj + 1u) { let e = exp(sc[t * ${BK}u + jj] - mx); sc[t * ${BK}u + jj] = e; l = l + e; }
      mr[t] = mx; lr[t] = l; ar[t] = al;
    }
    workgroupBarrier();
    for (var i = t; i < ${BK * D2}u; i = i + 256u) { let j = j0 + i / ${D2}u; var v = 0u; if (j <= posLast) { v = VC[krow(j) * ${D2}u + i % ${D2}u]; } ks[i] = v; }
    workgroupBarrier();
    let al = ar[r];
    for (var u = 0u; u < ${NDT}u; u = u + 1u) { acc[u] = acc[u] * al; }
    for (var jj = 0u; jj < ${BK}u; jj = jj + 1u) {
      let pj = sc[r * ${BK}u + jj];
      for (var u = 0u; u < ${NDT / 2}u; u = u + 1u) { let v = unpack2x16float(ks[jj * ${D2}u + d0 / 2u + u]); acc[2u * u] = acc[2u * u] + pj * v.x; acc[2u * u + 1u] = acc[2u * u + 1u] + pj * v.y; }
    }
    workgroupBarrier();
  }
  if (r / ${nh}u < nqp) {
    let inv = 1.0 / lr[r]; let ob = ((i0 + r / ${nh}u) * ${nh}u + r % ${nh}u) * ${D2}u + d0 / 2u;
    for (var u = 0u; u < ${NDT / 2}u; u = u + 1u) { O[ob + u] = pack2x16float(vec2<f32>(acc[2u * u], acc[2u * u + 1u]) * inv); }
  }
}`;
}
/** q: Q f16 [T][nh][D]; kc / vc: f16 cache, row (pos - kv0) holds position pos; queries at p0 .. p0+T-1; win 0 = causal; out f16 [T][nh D] */
export function attnPre(g, a) {
  if ((a.nkv || 1) > 1) throw new Error('attnPre: kv_heads > 1 needs the GEMM attention (attnPreGemm)');   // v036
  const nh = a.nh || 8, wgMax = (g.limits && g.limits.maxComputeWorkgroupStorageSize) || 16384;
  let QP = a.QP || (a.D >= 512 ? 1 : 4), BK = 16;
  // v026.9: the default block is 24-26 KB of workgroup memory; on a 16 KB device fewer keys per tile, then fewer queries per block
  while (attnPreBytes(a.D, QP, nh, BK) > wgMax && (BK > 4 || QP > 1)) { if (BK > 8) BK = 8; else if (QP > 1) QP = QP / 2; else BK = BK / 2; }
  const nwg = Math.ceil(a.T / QP);
  const pipe = g.pipeline(`lattpre.${a.D}.${QP}.${nh}.${BK}`, () => attnPreCode(a.D, QP, nh, BK));
  const keys = a.win ? Math.min(a.win + QP, a.p0 + a.T) : a.p0 + a.T, flopsWg = 4 * QP * nh * keys * a.D;
  const per = Math.max(1, Math.floor(g.rate.attn * 0.12 / flopsWg));
  for (let w0 = 0; w0 < nwg; w0 += per) {
    const n = Math.min(per, nwg - w0), t0 = w0 * QP, T = Math.min(a.T - t0, n * QP);
    g.runner.dispatch(pipe, [bw(a.q.buf, (a.q.off || 0) + t0 * nh * a.D * 2), bw(a.kc.buf), bw(a.vc.buf), bw(a.out.buf, (a.out.off || 0) + t0 * nh * a.D * 2)],
      P().u32(T).u32(a.p0 + t0).u32(a.win || 0).u32(a.kv0 || 0).u32(a.ring || 0).u32(0).u32(0).u32(0).ab, [n, 1], (n * flopsWg) / g.rate.attn);
  }
}

const PEW = `
enable f16;
struct P { op: u32, n: u32, a: u32, b: u32, c: u32, d: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<u32>;
fn gelu(x: f32) -> f32 { return x * 0.5 * (1.0 + tanh(clamp(0.7978845608028654 * (x + 0.044715 * x * x * x), -15.0, 15.0))); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  if (p.pad1 == 0xFFFFFFFFu) { Y[0] = u32(A[0] + B[0]); }
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) {
    let j = 2u * i;
    if (p.op == 0u) { Y[i] = pack2x16float(vec2<f32>(A[p.a + j], A[p.a + j + 1u])); }
    else { let m = j / p.c; let k = j % p.c; let bb = m * p.b + p.d + k; Y[i] = pack2x16float(vec2<f32>(gelu(A[j]) * B[bb], gelu(A[j + 1u]) * B[bb + 1u])); }
  }
}`;
/** y f16 = x f32 (n values, x offset in floats) */
export function cast16(g, a) {
  const n = a.n / 2;
  g.runner.dispatch(g.pipeline('lpew', () => PEW), [bw(a.x.buf), bw(dummy(g, 4)), bw(a.y.buf, a.y.off || 0)], P().u32(0).u32(n).u32(a.x.off || 0).u32(0).u32(0).u32(0).u32(0).u32(0).ab,
    [Math.min(4096, Math.ceil(n / 256)), 1], 2e-5 + n * 12 / g.rate.mem);
}
/** y16[m][k] = gelu_tanh(a[m][k]) * ple[m][layer][k]  (M rows of dp) */
export function plegate(g, a) {
  const n = a.M * a.dp / 2;
  g.runner.dispatch(g.pipeline('lpew', () => PEW), [bw(a.a.buf), bw(a.ple.buf), bw(a.y.buf)], P().u32(1).u32(n).u32(0).u32(a.nl * a.dp).u32(a.dp).u32(a.layer * a.dp).u32(0).u32(0).ab,
    [Math.min(4096, Math.ceil(n / 256)), 1], 2e-5 + n * 16 / g.rate.mem);
}

// ================================================================================================================ v046 (10-21): prefill
// attention as GEMMs.  On an iPhone 16 Pro Max attnPre measured 95-132 GFLOP/s (4-6% of the GPU's 2.2 TFLOP/s)
// while the engine's GEMM runs at ~1.1 TFLOP/s.  attnPreGemm = the same attention as attnPre (MQA: the nh query heads share one K/V
// head; causal + optional sliding window; scale 1; f16 Q / K / V; f32 scores, softmax statistics and accumulation; f16 out
// [T][nh * D]), by blocks of keys:
//   S = Q K^T     ops/gemm.js with f16 "weights" = the K cache rows: all T x nh query rows of the chunk at once, so every K tile in
//                 workgroup memory serves every head and every position (a sliding ring that wraps = two GEMMs into one S)
//   P             the masked softmax of S (lattsm): max and sum in f32, the weights stored f16 (and the row sum is the sum of the stored
//                 weights)
//   O = P V       ops/gemm.js again (f32 accumulate), V transposed per block into [D][keys] (lattvt)
//   blocks        the online rescale O = O * exp(m_old - m_new) + P V (lattos), out = O / l (lattof).  One block (every sliding layer,
//                 full layers up to the block size): P is normalised in the softmax and the PV GEMM writes the f16 output directly.
const ATTSM = `
struct P { M: u32, nh: u32, p0: u32, win: u32, kb0: u32, nv: u32, ld: u32, mode: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<f32>;
@group(0) @binding(2) var<storage, read_write> PW: array<u32>;
@group(0) @binding(3) var<storage, read_write> ST: array<f32>;
var<workgroup> red: array<f32, 256>;
fn live(c: u32, pos: u32, lo: u32) -> bool { let k = p.kb0 + c; return c < p.nv && k <= pos && k >= lo; }
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let gi = li / 64u; let t = li % 64u; let gb = gi * 64u;
  let row0 = (wid.x + wid.y * 65535u) * 4u + gi;
  let ok = row0 < p.M; let row = min(row0, p.M - 1u);
  let pos = p.p0 + row / p.nh;
  var lo = 0u; if (p.win > 0u && pos + 1u > p.win) { lo = pos + 1u - p.win; }
  let base = row * p.ld;
  var mx = -1.0e30;
  for (var c = t; c < p.nv; c = c + 64u) { if (live(c, pos, lo)) { mx = max(mx, S[base + c]); } }
  red[li] = mx; workgroupBarrier();
  for (var h = 32u; h > 0u; h = h >> 1u) { if (t < h) { red[li] = max(red[li], red[li + h]); } workgroupBarrier(); }
  let mb = red[gb]; workgroupBarrier();
  var mo = -1.0e30; var lold = 0.0;
  if (p.mode == 2u) { mo = ST[row]; lold = ST[p.M + row]; }
  let mn = max(mo, mb);
  var sc = 1.0;
  if (p.mode == 0u) {
    var s0 = 0.0;
    for (var c = t; c < p.nv; c = c + 64u) { if (live(c, pos, lo)) { s0 = s0 + exp(S[base + c] - mn); } }
    red[li] = s0; workgroupBarrier();
    for (var h = 32u; h > 0u; h = h >> 1u) { if (t < h) { red[li] = red[li] + red[li + h]; } workgroupBarrier(); }
    sc = 1.0 / red[gb]; workgroupBarrier();
  }
  var su = 0.0;
  for (var c2 = t; c2 < p.ld / 2u; c2 = c2 + 64u) {
    let c = 2u * c2; var e = vec2<f32>(0.0);
    if (live(c, pos, lo)) { e.x = exp(S[base + c] - mn) * sc; }
    if (live(c + 1u, pos, lo)) { e.y = exp(S[base + c + 1u] - mn) * sc; }
    let h2 = pack2x16float(e);
    if (ok) { PW[base / 2u + c2] = h2; }
    let r2 = unpack2x16float(h2); su = su + r2.x + r2.y;
  }
  if (p.mode != 0u) {
    red[li] = su; workgroupBarrier();
    for (var h = 32u; h > 0u; h = h >> 1u) { if (t < h) { red[li] = red[li] + red[li + h]; } workgroupBarrier(); }
    if (t == 0u && ok) { let al = exp(mo - mn); ST[row] = mn; ST[p.M + row] = lold * al + red[gb]; ST[2u * p.M + row] = al; }
  }
}`;
const VTRANS = `
struct P { D: u32, ld: u32, kb0: u32, nv: u32, ring: u32, kv0: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> VC: array<u32>;
@group(0) @binding(2) var<storage, read_write> VT: array<u32>;
var<workgroup> tl: array<f32, 4160>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let c0 = wid.x * 64u; let d0 = wid.y * 64u;
  for (var i = li; i < 2048u; i = i + 256u) {
    let kc = i / 32u; let dq = i % 32u; let c = c0 + kc;
    var v = vec2<f32>(0.0);
    if (c < p.nv) { let k = p.kb0 + c; let r = select(k - p.kv0, k % p.ring, p.ring > 0u); v = unpack2x16float(VC[(r * p.D + d0) / 2u + dq]); }
    tl[kc * 65u + 2u * dq] = v.x; tl[kc * 65u + 2u * dq + 1u] = v.y;
  }
  workgroupBarrier();
  for (var i = li; i < 2048u; i = i + 256u) {
    let dd = i / 32u; let cq = i % 32u;
    VT[((d0 + dd) * p.ld + c0) / 2u + cq] = pack2x16float(vec2<f32>(tl[(2u * cq) * 65u + dd], tl[(2u * cq + 1u) * 65u + dd]));
  }
}`;
const OSCALE = `
struct P { M: u32, D4: u32, n: u32, pad0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> ST: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<vec4<f32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) { O[i] = O[i] * ST[2u * p.M + i / p.D4]; }
}`;
const OFIN = `
struct P { M: u32, D4: u32, n: u32, pad0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> ST: array<f32>;
@group(0) @binding(2) var<storage, read> O: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> Y: array<vec2<u32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) { let v = O[i] / ST[p.M + i / p.D4]; Y[i] = vec2<u32>(pack2x16float(v.xy), pack2x16float(v.zw)); }
}`;
const ceil64 = (n) => Math.ceil(n / 64) * 64;
/** v046: the scratch of attnPreGemm for up to `rows` query rows (chunk x nh), heads up to D, `keys` keys per block (rounded up to 64);
 *  multi = a call may need several key blocks (then O + the row statistics too); tile = the attention GEMMs' {BM, BN} (null = engine's) */
export function attnScratch(g, { rows, D, keys, multi, tile = null, nkv = 1 }) {
  const NKB = ceil64(keys), sc = { NKB, rows, D, tile, S: g.buffer(rows * NKB * 4, 'at.S'), P: g.buffer(rows * NKB * 2, 'at.P'), Vt: g.buffer(D * NKB * 2, 'at.Vt'),
    O: multi ? g.buffer(rows * D * 4, 'at.O') : null, ST: multi ? g.buffer(Math.ceil((3 * rows * 4) / 256) * 256, 'at.ST') : null,
    Og: nkv > 1 ? g.buffer(rows * D * 2, 'at.Og') : null };   // v036: the group-major output before its reorder
  sc.bufs = [sc.S, sc.P, sc.Vt, sc.O, sc.ST, sc.Og].filter(Boolean);
  return sc;
}
/** the key blocks of one call: keys [kS, p0 + T) (a sliding window starts at a multiple of 64 inside the ring), or null if a ring wrap
 *  would put the second half of S at a column the GEMM cannot store at (not a multiple of 4; never with the engine's chunks) */
export function attnBlocks(a, NKB) {
  const kE = a.p0 + a.T, ring = a.ring || 0;
  let kS = 0;
  if (a.win) { kS = Math.max(0, a.p0 + 1 - a.win); kS -= kS % 64; }
  if (ring) kS = Math.max(kS, kE - ring);   // a ring keeps the last `ring` positions only
  const out = [];
  for (let kb0 = kS; kb0 < kE; kb0 += NKB) {
    const nv = Math.min(NKB, kE - kb0), r0 = ring ? kb0 % ring : kb0 - (a.kv0 || 0), n1 = ring ? Math.min(nv, ring - r0) : nv;
    if (n1 < nv && n1 % 4) return null;
    out.push({ kb0, nv, ld: ceil64(nv), r0, n1 });
  }
  return out;
}
/** v046: attnPre's contract (+ a.len = the K/V cache rows) by key blocks of sc.NKB keys; returns 'gemm' (or 'attnPre' if it fell back).
 *  v036: a.nkv > 1 = grouped KV: Q comes group-major from qkropeP ([kvh][T][hpg][D]) and the caches are head-major ([kvh][len][D]), so
 *  each KV head's query rows and keys are plain matrices: the same GEMMs per KV head, then one reorder into the token-major output.
 *  a.nkv 1 = v046's dispatches exactly. */
const REORD = `
struct P { T: u32, hpg: u32, nkv: u32, D2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<u32>;       // [nkv][T][hpg][D / 2] f16 pairs
@group(0) @binding(2) var<storage, read_write> O: array<u32>; // [T][nkv * hpg][D / 2]
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let n = p.T * p.hpg * p.nkv * p.D2;
  for (var i = gid.x; i < n; i = i + nw.x * 256u) {
    let d = i % p.D2; let r = i / p.D2; let ih = r % p.hpg; let r2 = r / p.hpg; let m = r2 % p.T; let gq = r2 / p.T;
    O[((m * p.nkv + gq) * p.hpg + ih) * p.D2 + d] = S[i];
  }
}`;
export function attnPreGemm(g, a, sc) {
  const nh = a.nh || 8, nkv = a.nkv || 1, hpg = nh / nkv, D = a.D, M = a.T * hpg, bl = attnBlocks(a, sc.NKB);
  if (!bl || M > sc.rows || D > sc.D || (bl.length > 1 && !sc.O) || (nkv > 1 && !sc.Og)) { attnPre(g, a); return 'attnPre'; }
  const nb = bl.length, tile = sc.tile || undefined, rm = g.rate.mem;
  for (let gq = 0; gq < nkv; gq++) {
    const kvOff = gq * a.len * D * 2, qOff = (a.q.off || 0) + gq * M * D * 2;
    const ob = nkv > 1 ? sc.Og : a.out.buf, oOff = nkv > 1 ? gq * M * D * 2 : (a.out.off || 0);
    const kw = { buf: a.kc.buf, off: kvOff, bytes: a.len * D * 2, enc: 'f16', rows: a.len, cols: D };
    for (let b = 0; b < nb; b++) {
      const { kb0, nv, ld, r0, n1 } = bl[b], mode = nb === 1 ? 0 : b === 0 ? 1 : 2;
      const sgemm = (wr0, N, n0) => gemm(g, { acc: 'f32', tile, w: kw, wr0, x: { buf: a.q.buf, off: qOff, ld: D, mode: 'f16' }, M, N, K: D, epi: 'f32', y: { buf: sc.S, ld, n0 } });
      sgemm(r0, n1, 0);
      if (n1 < nv) sgemm(0, nv - n1, n1);
      const nwg = Math.ceil(M / 4);
      g.runner.dispatch(g.pipeline('lattsm', () => ATTSM), [bw(sc.S), bw(sc.P), bw(sc.ST || dummy(g, 5))],
        P().u32(M).u32(hpg).u32(a.p0).u32(a.win || 0).u32(kb0).u32(nv).u32(ld).u32(mode).ab, [Math.min(nwg, 65535), Math.ceil(nwg / 65535)], 2e-5 + (M * ld * 6) / rm);
      g.runner.dispatch(g.pipeline('lattvt', () => VTRANS), [bw(a.vc.buf, kvOff, a.len * D * 2), bw(sc.Vt)],
        P().u32(D).u32(ld).u32(kb0).u32(nv).u32(a.ring || 0).u32(a.kv0 || 0).u32(0).u32(0).ab, [ld / 64, D / 64], 2e-5 + (D * ld * 4) / rm);
      const vw = { buf: sc.Vt, off: 0, bytes: D * ld * 2, enc: 'f16', rows: D, cols: ld };
      if (mode === 0) { gemm(g, { acc: 'f32', tile, w: vw, x: { buf: sc.P, ld, mode: 'f16' }, M, N: D, K: ld, epi: 'f16', y: { buf: ob, off: oOff, ld: D } }); continue; }
      if (b > 0) g.runner.dispatch(g.pipeline('lattos', () => OSCALE), [bw(sc.ST), bw(sc.O)], P().u32(M).u32(D / 4).u32((M * D) / 4).u32(0).ab,
        [Math.min(4096, Math.ceil((M * D) / 1024)), 1], 2e-5 + (M * D * 8) / rm);
      gemm(g, { acc: 'f32', tile, w: vw, x: { buf: sc.P, ld, mode: 'f16' }, M, N: D, K: ld, epi: b === 0 ? 'f32' : 'resadd', y: { buf: sc.O, ld: D } });
    }
    if (nb > 1) g.runner.dispatch(g.pipeline('lattof', () => OFIN), [bw(sc.ST), bw(sc.O), bw(ob, oOff)], P().u32(M).u32(D / 4).u32((M * D) / 4).u32(0).ab,
      [Math.min(4096, Math.ceil((M * D) / 1024)), 1], 2e-5 + (M * D * 6) / rm);
  }
  if (nkv > 1) {
    const n = a.T * nh * D / 2;
    g.runner.dispatch(g.pipeline('lattreord', () => REORD), [bw(sc.Og), bw(a.out.buf, a.out.off || 0)], P().u32(a.T).u32(hpg).u32(nkv).u32(D / 2).ab,
      [Math.min(4096, Math.ceil(n / 256)), 1], 2e-5 + (n * 8) / rm);
  }
  return 'gemm';
}
