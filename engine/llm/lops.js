// Gemma 4 E2B decode / prefill kernels (WGSL) for the p0pc0rn LLM module.  Own file: the shared engine ops stay byte-identical.
// Rules carried over from the Klein/SANA work: f32 residual + f32 norm statistics; f32 accumulate in every text-model GEMV/GEMM;
// never write single lanes of a shared vector from different threads (Metal RMW clobber); every dispatch sized well under ~0.2 s.
//
//   gemv     y = x W^T for ONE token, weights q4g32a.t64 | q8g64s.t64 dequantised in-kernel, f32 math.  A workgroup = one 64-row tile x
//            one k-range (split-K: partial sums [split][N], summed by the consumer).  Prologues: rms (x * rstd * w; rstd from the
//            producer's stat slot) | raw | sum (sum of the producer's split partials) | pleg (gelu_tanh(sum partials) * ple[layer]).
//            Epilogues: store | geglu (row pairs gate n / up n+I in one workgroup) | softcap (30 tanh(y/30) + per-tile max/argmax).
//   normadd  x = (x + rms(sum_s t_s) * w) * scale; then the rstd of the new x -> stat slot (one workgroup; D = 1536)
//   qkrope   q / k / v of one token: sum split partials, per-head RMS (q, k weighted; v unweighted), rotate-half RoPE from tables,
//            q -> Q [8][D] f32, k / v -> the layer's f16 KV cache row at pos
//   attnDec  split-K decode attention, 8 query heads x 1 KV head (MQA), D = 256 | 512, causal + optional sliding window, scale 1
//   attnComb combine the chunk partials -> O [8 * D] f32
//   embed    x = E[id] * sqrt(1536) gathered from the q4g32a.t64 lm_head tiles (+ stat); plefin: the per-layer-input vector
//   argmax   final reduction of the per-tile maxima
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
const dummy = (g, i) => { g._ldummies = g._ldummies || []; return g._ldummies[i] || (g._ldummies[i] = g.buffer(256, 'ldummy' + i)); };
const GELU = (v) => `(${v} * 0.5 * (1.0 + tanh(clamp(0.7978845608028654 * (${v} + 0.044715 * ${v} * ${v} * ${v}), -15.0, 15.0))))`;
export const KCH = 2048;   // max k per gemv workgroup (x chunk in workgroup memory: 8 KB)

// ================================================================================================================ GEMV
function gemvCode(c) {
  const q4 = c.w === 'q4', L = [];
  L.push(`struct P { N: u32, K: u32, wG: u32, kPer: u32, nsplit: u32, ldy: u32, wOff: u32, nOff: u32, statOff: u32, rowB: u32, evOff: u32, cap: f32, ldp: u32, nsrc: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@group(0) @binding(4) var<storage, read> NW: array<f32>;
@group(0) @binding(5) var<storage, read> EV: array<f32>;
@group(0) @binding(6) var<storage, read_write> MX: array<f32>;
var<workgroup> xs: array<f32, ${KCH}>;
var<workgroup> red: array<f32, 256>;
var<workgroup> mxv: array<f32, 64>;
var<workgroup> mxi: array<u32, 64>;`);
  L.push(`@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (p.pad2 == 0xFFFFFFFFu) { Y[0] = X[0] + NW[0] + EV[0] + MX[0] + f32(W[0]) + f32(p.pad1); }   // keeps every binding in the 'auto' layout
  let tile = wid.x; let split = wid.y;
  let k0 = split * p.kPer; let k1 = min(p.K, k0 + p.kPer);`);
  // ---- prologue: x chunk -> xs
  if (c.pro === 'rms') L.push(`  let rs = MX[p.statOff];`);
  L.push(`  for (var k = k0 + li; k < k1; k = k + 256u) {`);
  if (c.pro === 'raw') L.push(`    xs[k - k0] = X[p.rowB + k];`);
  else if (c.pro === 'rms') L.push(`    xs[k - k0] = X[p.rowB + k] * rs * NW[p.nOff + k];`);
  else if (c.pro === 'sum') L.push(`    var s = 0.0; for (var j = 0u; j < p.nsrc; j = j + 1u) { s = s + X[j * p.ldp + k]; } xs[k - k0] = s;`);
  else if (c.pro === 'pleg') L.push(`    var s = 0.0; for (var j = 0u; j < p.nsrc; j = j + 1u) { s = s + X[j * p.ldp + k]; } xs[k - k0] = ${GELU('s')} * EV[p.evOff + k];`);
  L.push(`  }
  workgroupBarrier();`);
  // ---- dot products: thread -> row r of the tile, quarter w of each record
  const pair = c.epi === 'geglu';
  L.push(`  let r = li >> 2u; let w = li & 3u; let g0 = k0 / ${q4 ? 32 : 64}u; let g1 = (k1 + ${q4 ? 31 : 63}u) / ${q4 ? 32 : 64}u;`);
  const tiles = pair ? ['tile', 'tile + p.N / 64u'] : ['tile'];
  tiles.forEach((tt, ti) => {
    L.push(`  var acc${ti} = 0.0;`);
    L.push(`  { let tb = (${tt}) * p.wG;`);
    L.push(`    for (var g = g0; g < g1; g = g + 1u) {`);
    if (q4) {
      L.push(`      let rec = p.wOff + (tb + g) * 320u; let q = W[rec + r * 4u + w]; let sm = unpack2x16float(W[rec + 256u + r]);
      let xb = g * 32u - k0 + w * 8u;
      let a = vec4<f32>(xs[xb], xs[xb + 1u], xs[xb + 2u], xs[xb + 3u]); let b = vec4<f32>(xs[xb + 4u], xs[xb + 5u], xs[xb + 6u], xs[xb + 7u]);
      let qa = vec4<f32>(vec4<u32>(q, q >> 4u, q >> 8u, q >> 12u) & vec4<u32>(15u)); let qb = vec4<f32>(vec4<u32>(q >> 16u, q >> 20u, q >> 24u, q >> 28u) & vec4<u32>(15u));
      acc${ti} = acc${ti} + sm.x * (dot(qa, a) + dot(qb, b)) + sm.y * (dot(a, vec4<f32>(1.0)) + dot(b, vec4<f32>(1.0)));`);
    } else {
      L.push(`      let rec = p.wOff + (tb + g) * 1056u; let s2 = unpack2x16float(W[rec + 1024u + (r >> 1u)]); let sc = select(s2.x, s2.y, (r & 1u) == 1u);
      var d = 0.0;
      for (var u = 0u; u < 4u; u = u + 1u) {
        let q = W[rec + r * 16u + w * 4u + u]; let xb = g * 64u - k0 + w * 16u + u * 4u;
        let qv = vec4<f32>((vec4<i32>(vec4<u32>(q << 24u, q << 16u, q << 8u, q))) >> vec4<u32>(24u));
        d = d + dot(qv, vec4<f32>(xs[xb], xs[xb + 1u], xs[xb + 2u], xs[xb + 3u]));
      }
      acc${ti} = acc${ti} + sc * d;`);
    }
    L.push(`    }
  }`);
  });
  // ---- reduce the 4 quarter-lanes of each row (shared memory, scalar slots only)
  L.push(`  red[li] = acc0; workgroupBarrier();
  var tot0 = 0.0; if (w == 0u) { tot0 = red[li] + red[li + 1u] + red[li + 2u] + red[li + 3u]; }
  workgroupBarrier();`);
  if (pair) L.push(`  red[li] = acc1; workgroupBarrier();
  var tot1 = 0.0; if (w == 0u) { tot1 = red[li] + red[li + 1u] + red[li + 2u] + red[li + 3u]; }
  workgroupBarrier();`);
  const n = '(tile + p.pad1) * 64u + r';   // v026.9: p.pad1 = the first tile of this window (0 unless the weights are windowed)
  if (c.epi === 'store') L.push(`  if (w == 0u) { Y[split * p.ldy + ${n}] = tot0; }`);
  else if (pair) L.push(`  if (w == 0u) { Y[${n}] = ${GELU('tot0')} * tot1; }`);
  else if (c.epi === 'softcap') {
    L.push(`  if (w == 0u) { let v = p.cap * tanh(clamp(tot0 / p.cap, -15.0, 15.0)); Y[${n}] = v; mxv[r] = v; mxi[r] = r; }
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (li < s) { let a = mxv[li]; let b = mxv[li + s]; if (b > a || (b == a && mxi[li + s] < mxi[li])) { mxv[li] = b; mxi[li] = mxi[li + s]; } }
    workgroupBarrier();
  }
  if (li == 0u) { MX[(tile + p.pad1) * 2u] = mxv[0]; MX[(tile + p.pad1) * 2u + 1u] = bitcast<f32>((tile + p.pad1) * 64u + mxi[0]); }`);
  }
  L.push('}');
  return L.join('\n');
}

/** a = {w: {buf, off(bytes), enc, rows (N), cols (K)}, x: {buf, rowB?}, N, K, pro: 'rms'|'raw'|'sum'|'pleg', epi: 'store'|'geglu'|'softcap',
 *       y: {buf}, ldy, kPer, stat: {buf, off(floats)} (rms) | src: {n, ld} (sum/pleg partials), norm: {buf, off(floats)}, ev: {buf, off}, mx: {buf} }
 *  geglu: N = the gate rows (the up rows follow at N .. 2N); returns the number of splits written */
export function gemv(g, a) {
  const enc = a.w.enc, w = enc === 'q4g32a.t64' ? 'q4' : enc === 'q8g64s.t64' ? 'q8' : null;
  if (!w) throw new Error('gemv: encoding ' + enc);
  const cfg = { w, pro: a.pro || 'raw', epi: a.epi || 'store' };
  const pipe = g.pipeline(`lgemv.${cfg.w}.${cfg.pro}.${cfg.epi}`, () => gemvCode(cfg));
  const K = a.K, N = a.N, G = w === 'q4' ? 32 : 64;
  const kPer = Math.min(KCH, a.kPer || K); if (kPer % G) throw new Error('gemv: kPer must be a multiple of ' + G);
  const nsplit = Math.ceil(K / kPer); if (cfg.epi !== 'store' && nsplit > 1) throw new Error('gemv: ' + cfg.epi + ' needs one split');
  if (N % 64) throw new Error('gemv: N % 64');
  const wG = a.w.cols / G, woff = (a.w.off || 0);
  if (woff % 4) throw new Error('gemv: weight offset');
  const mx = a.epi === 'softcap' ? a.mx.buf : a.stat ? a.stat.buf : dummy(g, 3);
  const tileB = wG * (w === 'q4' ? 1280 : 4224), NT = N / 64, lim = (g.limits && g.limits.maxStorageBufferBindingSize) || Infinity;
  const pr = (wo, t0) => P().u32(N).u32(K).u32(wG).u32(kPer).u32(nsplit).u32(a.ldy || N).u32(wo / 4).u32(a.norm ? a.norm.off || 0 : 0)
    .u32(a.stat ? a.stat.off || 0 : 0).u32(a.x.rowB || 0).u32(a.ev ? a.ev.off || 0 : 0).f32(a.cap || 30).u32(a.src ? a.src.ld : 0).u32(a.src ? a.src.n : 0).u32(t0).u32(0);
  const rest = [bw(a.y.buf), bw(a.norm ? a.norm.buf : dummy(g, 0)), bw(a.ev ? a.ev.buf : dummy(g, 1)), bw(mx)];
  if (NT * tileB + woff % 256 <= lim || cfg.epi === 'geglu') {
    g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.w.buf), ...rest], pr(woff, 0).ab, [NT, nsplit], (N * K * (w === 'q4' ? 0.625 : 1.03)) / g.rate.mem + 2e-5);
    return nsplit;
  }
  // v026.9: weights larger than one binding: windows of whole tiles, each bound from a 256-byte aligned offset
  let per = Math.max(1, Math.floor((lim - 256) / tileB)); while (per > 1 && (per * tileB) % 256) per--;
  for (let t0 = 0; t0 < NT; t0 += per) {
    const nt = Math.min(per, NT - t0), start = woff + t0 * tileB, base = Math.floor(start / 256) * 256, wv = { buffer: a.w.buf, offset: base, size: Math.ceil((start - base + nt * tileB) / 4) * 4 };
    g.runner.dispatch(pipe, [bw(a.x.buf), wv, ...rest], pr(start - base, t0).ab, [nt, nsplit], (nt * 64 * K * (w === 'q4' ? 0.625 : 1.03)) / g.rate.mem + 2e-5);
  }
  return nsplit;
}

// ================================================================================================================ normadd (+ stat)
const NORMADD = `
struct P { D: u32, nsrc: u32, ldp: u32, eps: f32, wOff: u32, scale: f32, statOff: u32, mode: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> T: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<f32>;
@group(0) @binding(3) var<storage, read_write> X: array<f32>;
@group(0) @binding(4) var<storage, read_write> ST: array<f32>;
var<workgroup> red: array<f32, 256>;
var<workgroup> tv: array<f32, 2048>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let xb = m * p.D;
  var s = 0.0;
  for (var i = t; i < p.D; i = i + 256u) { var v = 0.0; for (var j = 0u; j < p.nsrc; j = j + 1u) { v = v + T[j * p.ldp + xb + i]; } tv[i] = v; s = s + v * v; }
  red[t] = s; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.D) + p.eps);
  workgroupBarrier();
  var s2 = 0.0;
  for (var i = t; i < p.D; i = i + 256u) {
    var x = X[xb + i];
    if (p.mode == 0u) { x = (x + tv[i] * rs * W[p.wOff + i]) * p.scale; } else { x = tv[i]; }
    X[xb + i] = x; s2 = s2 + x * x;
  }
  red[t] = s2; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  if (t == 0u) { ST[p.statOff + m] = inverseSqrt(red[0] / f32(p.D) + p.eps); }
}`;
/** per row m < M: x_m = (x_m + rms(sum_j t_j,m) * w) * scale (mode 0) or x_m = sum_j t_j,m (mode 1); ST[statOff + m] = rstd(x_m).
 *  t: {buf, n (splits), ld (floats between splits)} rows of D */
export function normadd(g, a) {
  g.runner.dispatch(g.pipeline('lnormadd', () => NORMADD), [bw(a.t.buf), bw(a.w ? a.w.buf : dummy(g, 0)), bw(a.x.buf), bw(a.st.buf)],
    P().u32(a.D).u32(a.t.n || 1).u32(a.t.ld || a.D * (a.M || 1)).f32(a.eps || 1e-6).u32(a.w ? a.w.off || 0 : 0).f32(a.scale == null ? 1 : a.scale).u32(a.st.off || 0).u32(a.mode || 0).ab,
    [a.M || 1, 1], 2e-5 * (a.M || 1));
}

// ================================================================================================================ qkrope (decode)
const QKROPE = `
enable f16;
struct P { D: u32, nq: u32, hasKV: u32, nsrc: u32, ldp: u32, pos: u32, eps: f32, qwOff: u32, kwOff: u32, npairs: u32, ropeOff: u32, kvRow: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<f32>;      // split partials [nsrc][ldp]: q (nq * D) | k (D) | v (D)
@group(0) @binding(2) var<storage, read> NW: array<f32>;
@group(0) @binding(3) var<storage, read> RP: array<f32>;     // [pos][npairs][cos, sin]
@group(0) @binding(4) var<storage, read_write> Q: array<f32>;
@group(0) @binding(5) var<storage, read_write> KC: array<u32>; // f16 pairs [S][D]
@group(0) @binding(6) var<storage, read_write> VC: array<u32>;
var<workgroup> red: array<f32, 256>;
var<workgroup> hv: array<f32, 512>;
fn src(i: u32) -> f32 { var v = 0.0; for (var j = 0u; j < p.nsrc; j = j + 1u) { v = v + S[j * p.ldp + i]; } return v; }
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let h = wid.x;                      // 0..nq-1 = q heads, nq = k, nq + 1 = v
  if (h >= p.nq && p.hasKV == 0u) { return; }
  let base = h * p.D;
  var s = 0.0;
  for (var i = t; i < p.D; i = i + 256u) { let v = src(base + i); hv[i] = v; s = s + v * v; }
  red[t] = s; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.D) + p.eps);
  let half = p.D / 2u;
  if (h == p.nq + 1u) {                // v: unweighted RMS, no rope
    for (var i = t; i < half; i = i + 256u) { VC[(p.kvRow * p.D) / 2u + i] = pack2x16float(vec2<f32>(hv[2u * i], hv[2u * i + 1u]) * rs); }
    return;
  }
  let wo = select(p.qwOff, p.kwOff, h == p.nq);
  for (var d = t; d < half; d = d + 256u) {
    let a = hv[d] * rs * NW[wo + d]; let b = hv[d + half] * rs * NW[wo + d + half];
    var c = 1.0; var sn = 0.0;
    if (d < p.npairs) { let rb = p.ropeOff + (p.pos * p.npairs + d) * 2u; c = RP[rb]; sn = RP[rb + 1u]; }
    let lo = a * c - b * sn; let hi = b * c + a * sn;
    if (h < p.nq) { Q[base + d] = lo; Q[base + d + half] = hi; }
    else { hv[d] = lo; hv[d + half] = hi; }
  }
  if (h == p.nq) {
    workgroupBarrier();
    for (var i = t; i < half; i = i + 256u) { KC[(p.kvRow * p.D) / 2u + i] = pack2x16float(vec2<f32>(hv[2u * i], hv[2u * i + 1u])); }
  }
}`;
/** s: {buf, n, ld} partials of [q | k | v]; q -> Q f32 [nq][D]; k, v -> f16 cache rows kvRow (when hasKV) */
export function qkrope(g, a) {
  g.runner.dispatch(g.pipeline('lqkrope', () => QKROPE),
    [bw(a.s.buf), bw(a.norm.buf), bw(a.rope.buf), bw(a.q.buf), bw(a.kc ? a.kc.buf : dummy(g, 1)), bw(a.vc ? a.vc.buf : dummy(g, 2))],
    P().u32(a.D).u32(a.nq).u32(a.hasKV ? 1 : 0).u32(a.s.n || 1).u32(a.s.ld).u32(a.pos).f32(a.eps || 1e-6).u32(a.qw).u32(a.kw || 0)
      .u32(a.npairs).u32(a.rope.off || 0).u32(a.kvRow).ab,
    [a.nq + (a.hasKV ? 2 : 0), 1], 2e-5);
}

// ================================================================================================================ decode attention (MQA, split-K)
export const ATT_CK = 64;
const ATTDEC = `
enable f16;
struct P { D: u32, nh: u32, kStart: u32, kEnd: u32, nchunk: u32, ring: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<f32>;       // [nh][D]
@group(0) @binding(2) var<storage, read> KC: array<vec4<f16>>; // [S][D]
@group(0) @binding(3) var<storage, read> VC: array<vec2<f16>>; // [S][D]
@group(0) @binding(4) var<storage, read_write> PT: array<f32>; // per chunk: [nh] m | [nh] l | [nh][D] acc
var<workgroup> sc: array<f32, 512>;     // [nh][64]
var<workgroup> mh: array<f32, 8>;
fn krow(j: u32) -> u32 { return select(j, j % p.ring, p.ring > 0u); }   // sliding caches: ring of p.ring rows
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let c = wid.x; let j0 = p.kStart + c * 64u; let nk = min(64u, p.kEnd - j0);
  // scores: thread -> key j = t % 64, heads (t / 64) + 4 m
  let j = t & 63u; let hg = t >> 6u; let D4 = p.D / 4u;
  for (var hh = hg; hh < p.nh; hh = hh + 4u) {
    var s = -3.0e38;
    if (j < nk) {
      s = 0.0; let kb = krow(j0 + j) * D4; let qb = hh * p.D;
      for (var d = 0u; d < D4; d = d + 1u) { let kv = vec4<f32>(KC[kb + d]); s = s + dot(kv, vec4<f32>(Q[qb + 4u * d], Q[qb + 4u * d + 1u], Q[qb + 4u * d + 2u], Q[qb + 4u * d + 3u])); }
    }
    sc[hh * 64u + j] = s;
  }
  workgroupBarrier();
  if (t < p.nh) {
    var m = -3.0e38; for (var k = 0u; k < nk; k = k + 1u) { m = max(m, sc[t * 64u + k]); }
    mh[t] = m;
  }
  workgroupBarrier();
  for (var i = t; i < p.nh * 64u; i = i + 256u) { let hh = i >> 6u; let k = i & 63u; sc[i] = select(0.0, exp(sc[i] - mh[hh]), k < nk); }
  workgroupBarrier();
  let pb = c * (p.nh * (2u + p.D));
  if (t < p.nh) { var l = 0.0; for (var k = 0u; k < nk; k = k + 1u) { l = l + sc[t * 64u + k]; } PT[pb + t] = mh[t]; PT[pb + p.nh + t] = l; }
  // P.V: thread -> dims 2 t', all heads
  let D2 = p.D / 2u;
  for (var dp = t; dp < D2; dp = dp + 256u) {
    var acc: array<vec2<f32>, 8>;
    for (var hh = 0u; hh < 8u; hh = hh + 1u) { acc[hh] = vec2<f32>(0.0); }
    for (var k = 0u; k < nk; k = k + 1u) {
      let v = vec2<f32>(VC[krow(j0 + k) * D2 + dp]);
      for (var hh = 0u; hh < p.nh; hh = hh + 1u) { acc[hh] = acc[hh] + sc[hh * 64u + k] * v; }
    }
    for (var hh = 0u; hh < p.nh; hh = hh + 1u) { let o = pb + 2u * p.nh + hh * p.D + 2u * dp; PT[o] = acc[hh].x; PT[o + 1u] = acc[hh].y; }
  }
}`;
const ATTCOMB = `
struct P { D: u32, nh: u32, nchunk: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> PT: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;  // [nh][D]
var<workgroup> wts: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let h = wid.x; let st = p.nh * (2u + p.D);
  if (t == 0u) {
    var M = -3.0e38; for (var c = 0u; c < p.nchunk; c = c + 1u) { M = max(M, PT[c * st + h]); }
    var L = 0.0; for (var c = 0u; c < p.nchunk; c = c + 1u) { let e = exp(PT[c * st + h] - M); wts[c] = e; L = L + e * PT[c * st + p.nh + h]; }
    for (var c = 0u; c < p.nchunk; c = c + 1u) { wts[c] = wts[c] / L; }
  }
  workgroupBarrier();
  for (var d = t; d < p.D; d = d + 256u) {
    var o = 0.0; for (var c = 0u; c < p.nchunk; c = c + 1u) { o = o + wts[c] * PT[c * st + 2u * p.nh + h * p.D + d]; }
    O[h * p.D + d] = o;
  }
}`;
/** q: Q f32 [nh][D]; kc/vc: f16 cache [S][D]; keys [kStart, kEnd); part: scratch (>= nchunk * nh * (2 + D) floats); out: O f32 [nh][D] */
export function attnDec(g, a) {
  const nchunk = Math.ceil((a.kEnd - a.kStart) / ATT_CK);
  if (nchunk > 256) throw new Error('attnDec: context too long for one combine (' + nchunk + ' chunks)');
  g.runner.dispatch(g.pipeline('lattdec', () => ATTDEC), [bw(a.q.buf), bw(a.kc.buf), bw(a.vc.buf), bw(a.part.buf)],
    P().u32(a.D).u32(a.nh).u32(a.kStart).u32(a.kEnd).u32(nchunk).u32(a.ring || 0).u32(0).u32(0).ab, [nchunk, 1], 3e-5 * nchunk);
  g.runner.dispatch(g.pipeline('lattcomb', () => ATTCOMB), [bw(a.part.buf), bw(a.out.buf)],
    P().u32(a.D).u32(a.nh).u32(nchunk).u32(0).ab, [a.nh, 1], 2e-5);
}

// ================================================================================================================ embedding gather (decode/prefill)
const EMBED = (q8) => `
struct P { K: u32, wG: u32, scale: f32, eps: f32, statOff: u32, rowOut: u32, nrow: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> W: array<u32>;     // q4g32a.t64 [V][K]
@group(0) @binding(2) var<storage, read> IDS: array<u32>;
@group(0) @binding(3) var<storage, read_write> X: array<f32>;
@group(0) @binding(4) var<storage, read_write> ST: array<f32>;
@group(0) @binding(5) var<storage, read> W2: array<u32>;    // v026.9: the tiles from p.pad on (a table larger than one binding)
var<workgroup> red: array<f32, 256>;
fn wd(i: u32, hi: bool) -> u32 { if (hi) { return W2[i]; } return W[i]; }
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let id = IDS[m]; let hi = (id >> 6u) >= p.pad; let tile = select(id >> 6u, (id >> 6u) - p.pad, hi); let r = id & 63u;
  var s = 0.0;
  for (var k = t; k < p.K; k = k + 256u) {
${q8 ? `    let gi = k >> 6u; let rec = (tile * p.wG + gi) * 1056u; let kk = k & 63u;
    let qb = (wd(rec + r * 16u + (kk >> 2u), hi) >> (8u * (kk & 3u))) & 255u; let qs = f32(i32(qb << 24u) >> 24u);
    let s2 = unpack2x16float(wd(rec + 1024u + (r >> 1u), hi)); let sc = select(s2.x, s2.y, (r & 1u) == 1u);
    let v = qs * sc * p.scale;` : `    let gi = k >> 5u; let rec = (tile * p.wG + gi) * 320u; let kk = k & 31u;
    let q = (wd(rec + r * 4u + (kk >> 3u), hi) >> (4u * (kk & 7u))) & 15u; let sm = unpack2x16float(wd(rec + 256u + r, hi));
    let v = (f32(q) * sm.x + sm.y) * p.scale;`}
    X[(p.rowOut + m) * p.K + k] = v; s = s + v * v;
  }
  red[t] = s; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  if (t == 0u) { ST[p.statOff + m] = inverseSqrt(red[0] / f32(p.K) + p.eps); }
}`;
/** x[rowOut + m] = dequant(E[ids[m]]) * scale (E in q4g32a.t64 lm_head tiles); st[statOff + m] = rstd */
export function embed(g, a) {
  const q8 = a.w.enc === 'q8g64s.t64';
  if (!q8 && a.w.enc && a.w.enc !== 'q4g32a.t64') throw new Error('embed: encoding ' + a.w.enc);
  // v026.9: a table larger than one binding (the assistant's 240 MB embedding on a 128 MB device) is bound as two halves (tile aligned)
  const wG = a.K / (q8 ? 64 : 32), tileB = wG * (q8 ? 4224 : 1280), lim = (g.limits && g.limits.maxStorageBufferBindingSize) || Infinity, off0 = a.w.off || 0;
  let w1 = bw(a.w.buf, off0, a.w.bytes), w2 = bw(dummy(g, 4)), split = 0xFFFFFFFF;
  if (a.w.bytes > lim) {
    const NT = Math.ceil(a.w.bytes / tileB); let h = Math.ceil(NT / 2); while (h < NT && ((off0 + h * tileB) % 256)) h++;
    if (h * tileB > lim || (NT - h) * tileB > lim) throw new Error('embed: table too large for two bindings');
    w1 = bw(a.w.buf, off0, h * tileB); w2 = bw(a.w.buf, off0 + h * tileB, a.w.bytes - h * tileB); split = h;
  }
  g.runner.dispatch(g.pipeline('lembed2' + (q8 ? '8' : '4'), () => EMBED(q8)), [w1, bw(a.ids.buf), bw(a.x.buf), bw(a.st.buf), w2],
    P().u32(a.K).u32(wG).f32(a.scale).f32(a.eps || 1e-6).u32(a.st.off || 0).u32(a.rowOut || 0).u32(a.n).u32(split).ab, [a.n, 1], 2e-5 * a.n);
}

// ================================================================================================================ per-layer inputs (PLE)
const PLEFIN = `
struct P { nl: u32, dp: u32, nsrc: u32, ldp: u32, projScale: f32, eps: f32, inScale: f32, rowIn: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<f32>;       // projection partials [nsrc][ldp] (= nl * dp), row-major per token: rowIn * ldp
@group(0) @binding(2) var<storage, read> NW: array<f32>;      // per_layer_projection_norm [dp]
@group(0) @binding(3) var<storage, read> TOK: array<f32>;     // token-identity part, already x sqrt(dp): [rows][nl * dp]
@group(0) @binding(4) var<storage, read_write> O: array<f32>; // [rows][nl * dp]
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let l = wid.x; let m = wid.y; let b = l * p.dp;
  var v = 0.0;
  if (t < p.dp) { for (var j = 0u; j < p.nsrc; j = j + 1u) { v = v + S[j * p.ldp + (p.rowIn + m) * p.nl * p.dp + b + t]; } v = v * p.projScale; }
  red[t] = v * v; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.dp) + p.eps);
  if (t < p.dp) { let o = m * p.nl * p.dp + b + t; O[o] = (v * rs * NW[t] + TOK[o]) * p.inScale; }
}`;
/** ple[m][l][:] = (rms(proj[m][l] * projScale) * w + tok[m][l]) * 2^-0.5;  rows = n tokens */
export function plefin(g, a) {
  g.runner.dispatch(g.pipeline('lplefin', () => PLEFIN), [bw(a.s.buf), bw(a.norm.buf, a.norm.off || 0, a.norm.bytes || null), bw(a.tok.buf), bw(a.out.buf)],
    P().u32(a.nl).u32(a.dp).u32(a.s.n || 1).u32(a.s.ld).f32(a.projScale).f32(a.eps || 1e-6).f32(Math.SQRT1_2).u32(a.rowIn || 0).ab, [a.nl, a.n || 1], 2e-5);
}

// ================================================================================================================ argmax over per-tile maxima
const ARGMAX = `
struct P { n: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> MX: array<f32>;      // [n] (max, bitcast index)
@group(0) @binding(2) var<storage, read_write> OUT: array<u32>; // [0] = index, [1] = bits of max
var<workgroup> rv: array<f32, 256>;
var<workgroup> ri: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) t: u32) {
  var bv = -3.4e38; var bi = 0xffffffffu;
  for (var i = t; i < p.n; i = i + 256u) { let v = MX[2u * i]; let id = bitcast<u32>(MX[2u * i + 1u]); if (v > bv || (v == bv && id < bi)) { bv = v; bi = id; } }
  rv[t] = bv; ri[t] = bi; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (t < s) { let v = rv[t + s]; let id = ri[t + s]; if (v > rv[t] || (v == rv[t] && id < ri[t])) { rv[t] = v; ri[t] = id; } }
    workgroupBarrier();
  }
  if (t == 0u) { OUT[0] = ri[0]; OUT[1] = bitcast<u32>(rv[0]); }
}`;
export function argmax(g, a) {
  g.runner.dispatch(g.pipeline('largmax', () => ARGMAX), [bw(a.mx.buf), bw(a.out.buf)], P().u32(a.n).u32(0).u32(0).u32(0).ab, [1, 1], 2e-5);
}

// ================================================================================================================ RoPE tables (JS)
/** Gemma 4 rotate-half RoPE: angle = f32(f32(inv_freq) * pos), cos/sin rounded to f32 (torch f32 matmul + cos/sin).
 *  sliding: dim 256, theta 1e4 -> 128 pairs;  full ('proportional', head 512, partial 0.25, theta 1e6): inv_freq_k = 1 / theta^(2k / 512)
 *  for k < 64, 0 beyond (identity) -> 64 pairs stored.  Layout [pos][pairs][cos, sin]. */
export function ropeTable(L, kind) {
  const f = Math.fround, np = kind === 'full' ? 64 : 128, dim = kind === 'full' ? 512 : 256, theta = kind === 'full' ? 1e6 : 1e4;
  const inv = Array.from({ length: np }, (_, k) => f(1 / f(Math.pow(theta, f(f(2 * k) / dim)))));
  const out = new Float32Array(L * np * 2);
  for (let t = 0; t < L; t++) for (let k = 0; k < np; k++) { const a = f(f(t) * inv[k]); out[(t * np + k) * 2] = Math.cos(a); out[(t * np + k) * 2 + 1] = Math.sin(a); }
  return out;
}
