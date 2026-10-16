// Gemma 4 E2B prefill kernels (M tokens at once) for the p0pc0rn LLM module; the big GEMMs use the shared ops/gemm.js.
//   qkropeP  rows of the fused qkv GEMM output (f16 [M][ldx]) -> per-head RMS (+ weight), RoPE at position p0 + m,
//            Q f16 token-major [M][nq][D] (for attnPre), k / v f16 cache rows kv0 + m
//   attnPre  flash attention, MQA (nh query heads share one K/V head), causal + optional sliding window, scale 1.  A workgroup owns
//            QP query positions x nh heads (R rows) and streams the key range in tiles of 16 (K, then V, through one buffer);
//            online softmax with f32 statistics, f32 accumulate, f16 out [T][nh * D]
//   cast16 / plegate  small elementwise kernels (f32 -> f16; gelu_tanh(gate) * per-layer input -> f16)
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
const dummy = (g, i) => { g._lpdummies = g._lpdummies || []; return g._lpdummies[i] || (g._lpdummies[i] = g.buffer(256, 'lpdummy' + i)); };

const QKROPEP = `
enable f16;
struct P { D: u32, nq: u32, hasKV: u32, ldx: u32, p0: u32, eps: f32, qwOff: u32, kwOff: u32, npairs: u32, ropeOff: u32, kv0: u32, ring: u32 };
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
  if (h == p.nq + 1u) {
    for (var i = t; i < D2; i = i + 256u) { VC[(kr * p.D) / 2u + i] = pack2x16float(vec2<f32>(hv[2u * i], hv[2u * i + 1u]) * rs); }
    return;
  }
  let wo = select(p.qwOff, p.kwOff, h == p.nq);
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
    if (h < p.nq) { Q[((m * p.nq + h) * p.D) / 2u + i] = v; } else { KC[(kr * p.D) / 2u + i] = v; }
  }
}`;
/** x: {buf, off, ld} f16 rows [q (nq D) | k (D) | v (D)]; M rows at positions p0 + m; kv rows kv0 + m */
export function qkropeP(g, a) {
  const M = a.M;
  g.runner.dispatch(g.pipeline('lqkropeP', () => QKROPEP),
    [bw(a.x.buf, a.x.off || 0), bw(a.norm.buf), bw(a.rope.buf), bw(a.q.buf), bw(a.kc ? a.kc.buf : dummy(g, 1)), bw(a.vc ? a.vc.buf : dummy(g, 2))],
    P().u32(a.D).u32(a.nq).u32(a.hasKV ? 1 : 0).u32(a.x.ld).u32(a.p0).f32(a.eps || 1e-6).u32(a.qw).u32(a.kw || 0).u32(a.npairs).u32(a.rope.off || 0).u32(a.kv0).u32(a.ring || 0).ab,
    [a.nq + (a.hasKV ? 2 : 0), Math.min(M, 65535), Math.ceil(M / 65535)], 2e-6 * M);
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
