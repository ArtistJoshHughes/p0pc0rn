// Pocket Voice kernels (Qwen3-TTS talker / code predictor decode loop + codec helpers).  New file; the engine core stays 0.3.4.
//   gemv     y = W x for M = 1..2 rows (q8g64s.t64 / q4g32a.t64 / f16), optional RMSNorm prologue, epilogues store | add | swiglu
//   rmsrow   y = x * rsqrt(mean(x^2) + eps) * w   (f32 or f16 out)
//   qkrope   per-head q/k RMSNorm + RoPE (rotate-half, table) + K/V append to an f16 cache [Hkv][Lmax][D]
//   attn     causal (optionally sliding-window) GQA attention of M queries against the cache, online softmax, f32
//   sampler  ONE workgroup: repetition penalty, suppress range, EOS mask, temperature, exact top-k (radix select on order-preserving
//            keys = HF's "keep >= k-th largest"), Gumbel-max with a counter-based RNG, or greedy / forced; writes the code and
//            gathers the code's embedding row (set / add into the next input, + the trailing text row)
//   rowgather OUT[dst] += sum of embedding rows named by (table, id) lists (prefill codec rows)
// Metal rule (engine lesson): no shared vec4 slot is ever written lane-by-lane by different threads; f32 accumulation everywhere.
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
const dummy = (g, i) => { g._vdum = g._vdum || []; return g._vdum[i] || (g._vdum[i] = g.buffer(256, 'vdummy' + i)); };
export const KMAX = 3072;

// ------------------------------------------------------------------------------------------------------------------- GEMV
function gemvCode(c) {
  // RPW rows per workgroup (4 threads per row, NT = 4 * RPW threads); q8 records are read two at a time (independent loads in flight)
  const M = c.M, RPW = c.RPW, NT = 4 * RPW, HALF = RPW / 2, XS = Math.max(M * KMAX, NT * M), xh = !!c.xh;   // v026.9: xh = x cached as fp16, reductions in rd (f32)
  const XR = (i) => (xh ? `f32(xs[${i}])` : `xs[${i}]`), RD = xh ? 'rd' : 'xs';
  const L = ['enable f16;'];
  L.push(`struct P { K: u32, G: u32, rowOff: u32, wr1: u32, N: u32, xOff: u32, ldx: u32, yOff: u32, ldy: u32, nOff: u32, eps: f32, ldw: u32, bOff: u32, wg0: u32 };`);
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> X: array<f32>;');
  L.push(`@group(0) @binding(2) var<storage, read> W: array<${c.w === 'q4' ? 'u32' : 'vec4<u32>'}>;`);
  L.push('@group(0) @binding(3) var<storage, read_write> Y: array<f32>;');
  let b = 4;
  if (c.norm) L.push(`@group(0) @binding(${b++}) var<storage, read> NW: array<f32>;`);
  if (c.bias) L.push(`@group(0) @binding(${b++}) var<storage, read> BV: array<f32>;`);
  L.push(`var<workgroup> xs: array<${xh ? 'f16' : 'f32'}, ${XS}>;`);
  if (xh) L.push(`var<workgroup> rd: array<f32, ${NT * M}>;`);
  L.push('var<workgroup> rs: array<f32, 4>;');
  L.push(`fn d4(w: u32, x0: f32, x1: f32, x2: f32, x3: f32) -> f32 {   // 4 signed bytes . 4 floats
  return f32((i32(w << 24u)) >> 24u) * x0 + f32((i32(w << 16u)) >> 24u) * x1 + f32((i32(w << 8u)) >> 24u) * x2 + f32(i32(w) >> 24u) * x3; }`);
  // q8 codes are in [-127, 127] (symmetric scale max|v| / 127), so unpack4x8snorm (= max(q / 127, -1)) is exact up to f32 rounding:
  // 4 bytes -> vec4 in one instruction, then a vec4 dot; the caller multiplies by 127 * scale
  L.push(`fn x4(b: u32) -> vec4<f32> { return vec4<f32>(${XR('b')}, ${XR('b + 1u')}, ${XR('b + 2u')}, ${XR('b + 3u')}); }`);
  L.push(`fn dot16(cw: vec4<u32>, xb: u32) -> f32 { return dot(unpack4x8snorm(cw.x), x4(xb)) + dot(unpack4x8snorm(cw.y), x4(xb + 4u))
    + dot(unpack4x8snorm(cw.z), x4(xb + 8u)) + dot(unpack4x8snorm(cw.w), x4(xb + 12u)); }`);
  L.push(`@compute @workgroup_size(${NT})`);
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {');
  L.push('  let wg = wid.x + p.wg0; let r = t >> 2u; let q = t & 3u; let K = p.K;');
  if (c.norm) {
    for (let m = 0; m < M; m++) {
      L.push(`  { var s = 0.0; for (var k = t; k < K; k = k + ${NT}u) { let v = X[p.xOff + ${m}u * p.ldx + k]; s = s + v * v; } ${RD}[t] = s; }`);
      L.push('  workgroupBarrier();');
      L.push(`  for (var s = ${NT / 2}u; s > 0u; s = s >> 1u) { if (t < s) { ${RD}[t] = ${RD}[t] + ${RD}[t + s]; } workgroupBarrier(); }`);
      L.push(`  if (t == 0u) { rs[${m}] = inverseSqrt(${RD}[0] / f32(K) + p.eps); }`);
      L.push('  workgroupBarrier();');
    }
    L.push(`  for (var m = 0u; m < ${M}u; m = m + 1u) { for (var k = t; k < K; k = k + ${NT}u) { xs[m * K + k] = ${xh ? 'f16(' : '('}X[p.xOff + m * p.ldx + k] * rs[m] * NW[p.nOff + k]); } }`);
  } else {
    L.push(`  for (var m = 0u; m < ${M}u; m = m + 1u) { for (var k = t; k < K; k = k + ${NT}u) { xs[m * K + k] = ${xh ? 'f16(' : '('}X[p.xOff + m * p.ldx + k]); } }`);
  }
  L.push('  workgroupBarrier();');
  if (c.epi === 'swiglu') L.push(`  let o0 = wg * ${HALF}u; let R = select(p.wr1 + o0 + r - ${HALF}u, p.rowOff + o0 + r, r < ${HALF}u);`);
  else L.push(`  let R = p.rowOff + wg * ${RPW}u + r;`);
  for (let m = 0; m < M; m++) L.push(`  var a${m} = 0.0;`);
  if (c.w === 'q8') {
    L.push('  let tile = R >> 6u; let rr = R & 63u; let sh = (rr >> 1u) & 3u; let hi = (rr & 1u) == 1u;');
    L.push('  var g = 0u;');
    L.push('  for (; g + 1u < p.G; g = g + 2u) {');
    L.push('    let rec0 = (tile * p.G + g) * 264u; let rec1 = rec0 + 264u;');
    L.push('    let cw0 = W[rec0 + rr * 4u + q]; let cw1 = W[rec1 + rr * 4u + q]; let sv0 = W[rec0 + 256u + (rr >> 3u)]; let sv1 = W[rec1 + 256u + (rr >> 3u)];');
    L.push('    let s0 = unpack2x16float(sv0[sh]); let s1 = unpack2x16float(sv1[sh]); let sc0 = 127.0 * select(s0.x, s0.y, hi); let sc1 = 127.0 * select(s1.x, s1.y, hi);');
    L.push('    let k0 = g * 64u + q * 16u;');
    for (let m = 0; m < M; m++) L.push(`    a${m} = a${m} + sc0 * dot16(cw0, ${m}u * K + k0) + sc1 * dot16(cw1, ${m}u * K + k0 + 64u);`);
    L.push('  }');
    L.push('  if (g < p.G) {');
    L.push('    let rec = (tile * p.G + g) * 264u; let cw = W[rec + rr * 4u + q]; let sv = W[rec + 256u + (rr >> 3u)]; let s2 = unpack2x16float(sv[sh]); let sc = 127.0 * select(s2.x, s2.y, hi);');
    for (let m = 0; m < M; m++) L.push(`    a${m} = a${m} + sc * dot16(cw, ${m}u * K + g * 64u + q * 16u);`);
    L.push('  }');
  } else if (c.w === 'q4') {
    L.push('  let tile = R >> 6u; let rr = R & 63u;');
    L.push('  for (var g = 0u; g < p.G; g = g + 1u) {');
    L.push('    let rec = (tile * p.G + g) * 320u; let cw = W[rec + rr * 4u + q]; let sm = unpack2x16float(W[rec + 256u + rr]);');
    L.push('    let k0 = g * 32u + q * 8u;');
    for (let m = 0; m < M; m++) {
      L.push(`    { let xb = ${m}u * K + k0; var s = 0.0; var xsum = 0.0;
      for (var i = 0u; i < 8u; i = i + 1u) { let xv = ${XR('xb + i')}; s = s + f32((cw >> (4u * i)) & 15u) * xv; xsum = xsum + xv; }
      a${m} = a${m} + sm.x * s + sm.y * xsum; }`);
    }
    L.push('  }');
  } else {   // f16 row-major [rows][ldw]
    L.push('  for (var c8 = q; c8 * 8u < K; c8 = c8 + 4u) {');
    L.push('    let cw = W[(R * p.ldw + c8 * 8u) / 8u]; let h0 = unpack2x16float(cw.x); let h1 = unpack2x16float(cw.y); let h2 = unpack2x16float(cw.z); let h3 = unpack2x16float(cw.w);');
    for (let m = 0; m < M; m++) {
      L.push(`    { let xb = ${m}u * K + c8 * 8u; a${m} = a${m} + h0.x * ${XR('xb')} + h0.y * ${XR('xb + 1u')} + h1.x * ${XR('xb + 2u')} + h1.y * ${XR('xb + 3u')}
        + h2.x * ${XR('xb + 4u')} + h2.y * ${XR('xb + 5u')} + h3.x * ${XR('xb + 6u')} + h3.y * ${XR('xb + 7u')}; }`);
    }
    L.push('  }');
  }
  L.push('  workgroupBarrier();');
  for (let m = 0; m < M; m++) L.push(`  ${RD}[${m}u * ${NT}u + t] = a${m};`);
  L.push('  workgroupBarrier();');
  if (c.epi === 'swiglu') {
    L.push(`  if (q == 0u && r < ${HALF}u && o0 + r < p.N) {`);
    for (let m = 0; m < M; m++) {
      L.push(`    { let b0 = ${m}u * ${NT}u; let gt = ${RD}[b0 + r * 4u] + ${RD}[b0 + r * 4u + 1u] + ${RD}[b0 + r * 4u + 2u] + ${RD}[b0 + r * 4u + 3u];
      let up = ${RD}[b0 + (r + ${HALF}u) * 4u] + ${RD}[b0 + (r + ${HALF}u) * 4u + 1u] + ${RD}[b0 + (r + ${HALF}u) * 4u + 2u] + ${RD}[b0 + (r + ${HALF}u) * 4u + 3u];
      Y[p.yOff + ${m}u * p.ldy + o0 + r] = gt / (1.0 + exp(-gt)) * up; }`);
    }
    L.push('  }');
  } else {
    L.push(`  let n = wg * ${RPW}u + r;`);
    L.push('  if (q == 0u && n < p.N) {');
    for (let m = 0; m < M; m++) {
      L.push(`    { let b0 = ${m}u * ${NT}u; var v = ${RD}[b0 + r * 4u] + ${RD}[b0 + r * 4u + 1u] + ${RD}[b0 + r * 4u + 2u] + ${RD}[b0 + r * 4u + 3u];`);
      if (c.bias) L.push('      v = v + BV[p.bOff + n];');
      if (c.epi === 'add') L.push(`      Y[p.yOff + ${m}u * p.ldy + n] = Y[p.yOff + ${m}u * p.ldy + n] + v; }`);
      else L.push(`      Y[p.yOff + ${m}u * p.ldy + n] = v; }`);
    }
    L.push('  }');
  }
  L.push('}');
  return L.join('\n');
}

/**
 * a = { w: {buf, off, enc, rows, cols, ld (f16 only)}, x: {buf, off(floats), ld(floats)}, M (1|2), N (outputs), K,
 *       rowOff (first weight row), wr1 (swiglu: first 'up' row), epi: 'store'|'add'|'swiglu', y: {buf, off(floats), ld(floats)},
 *       norm: {buf, off(floats), eps} | null, bias: {buf, off(floats)} | null }
 */
export function gemv(g, a) {
  const enc = a.w.enc, w = enc === 'q8g64s.t64' ? 'q8' : enc === 'q4g32a.t64' ? 'q4' : enc === 'f16' ? 'f16' : null;
  if (!w) throw new Error('gemv: unsupported encoding ' + enc);
  const M = a.M || 1, epi = a.epi || 'store';
  if (M < 1 || M > 2) throw new Error('gemv: M must be 1 or 2');
  if (a.K > KMAX) throw new Error('gemv: K > ' + KMAX);
  if (w === 'q8' && a.K % 64) throw new Error('gemv: q8 K % 64');
  if (w === 'q4' && a.K % 32) throw new Error('gemv: q4 K % 32');
  if (w === 'f16' && a.K % 8) throw new Error('gemv: f16 K % 8');
  const RPW = a.rpw || g.gemvRows || 32;
  const xh = 4 * Math.max(M * KMAX, 4 * RPW * M) + 16 > ((g.limits && g.limits.maxComputeWorkgroupStorageSize) || 16384);   // v026.9: 16 KB devices
  const c = { w, M, epi, norm: !!a.norm, bias: !!a.bias, RPW, xh };
  const key = ['vgemv', w, M, epi, c.norm ? 'n' : '', c.bias ? 'b' : '', RPW, xh ? 'xh' : ''].join('.');
  const pipe = g.pipeline(key, () => gemvCode(c));
  const Kst = a.w.cols, G = w === 'q8' ? Kst / 64 : w === 'q4' ? Kst / 32 : 0;
  const nwg = epi === 'swiglu' ? Math.ceil(a.N / (RPW / 2)) : Math.ceil(a.N / RPW);
  const binds = [bw(a.x.buf), { buffer: a.w.buf, offset: a.w.off || 0, size: Math.floor(a.w.bytes / 16) * 16 }, bw(a.y.buf)];
  if (c.norm) binds.push(bw(a.norm.buf));
  if (c.bias) binds.push(bw(a.bias.buf));
  for (let w0 = 0; w0 < nwg; w0 += 65535) {
    const n = Math.min(65535, nwg - w0);
    const pr = P().u32(a.K).u32(G).u32(a.rowOff || 0).u32(a.wr1 || 0).u32(a.N).u32(a.x.off || 0).u32(a.x.ld || a.K).u32(a.y.off || 0).u32(a.y.ld || a.N)
      .u32(a.norm ? a.norm.off || 0 : 0).f32(a.norm ? a.norm.eps : 1e-6).u32(a.w.ld || Kst).u32(a.bias ? a.bias.off || 0 : 0).u32(w0);
    g.runner.dispatch(pipe, binds, pr.ab, [n, 1], (a.w.bytes) / (g.rate.mem || 20e9));
  }
}

// ------------------------------------------------------------------------------------------------------------------- rmsrow
const RMSROW = (o16) => `
enable f16;
struct P { K: u32, xOff: u32, ldx: u32, yOff: u32, ldy: u32, wOff: u32, eps: f32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> NW: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<${o16 ? 'f16' : 'f32'}>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let xb = p.xOff + m * p.ldx; let yb = p.yOff + m * p.ldy;
  var s = 0.0; for (var k = t; k < p.K; k = k + 256u) { let v = X[xb + k]; s = s + v * v; }
  red[t] = s; workgroupBarrier();
  for (var h = 128u; h > 0u; h = h >> 1u) { if (t < h) { red[t] = red[t] + red[t + h]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.K) + p.eps);
  for (var k = t; k < p.K; k = k + 256u) { Y[yb + k] = ${o16 ? 'f16' : 'f32'}(X[xb + k] * rs * NW[p.wOff + k]); }
}`;
/** a = {x:{buf, off, ld}, M, K, w:{buf, off}, eps, y:{buf, off, ld}, f16} (offsets in elements) */
export function rmsrow(g, a) {
  const pipe = g.pipeline('vrmsrow' + (a.f16 ? '16' : '32'), () => RMSROW(!!a.f16));
  const pr = P().u32(a.K).u32(a.x.off || 0).u32(a.x.ld || a.K).u32(a.y.off || 0).u32(a.y.ld || a.K).u32(a.w.off || 0).f32(a.eps).u32(0);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.w.buf), bw(a.y.buf)], pr.ab, [a.M, 1], a.M * a.K * 8 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------------------------------------------------------- qkrope
const QKROPE = `
enable f16;
struct P { Hq: u32, Hkv: u32, D: u32, ldq: u32, qkvOff: u32, qoOff: u32, ldqo: u32, Lmax: u32, pos0: u32, nq: u32, nk: u32, hasNorm: u32,
  eps: f32, rope: u32, half: u32, sinOff: u32, kcOff: u32, vcOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> QKV: array<f32>;
@group(0) @binding(2) var<storage, read_write> QO: array<f32>;
@group(0) @binding(3) var<storage, read_write> KC: array<f16>;
@group(0) @binding(4) var<storage, read_write> VC: array<f16>;
@group(0) @binding(5) var<storage, read> NW: array<f32>;
@group(0) @binding(6) var<storage, read> RT: array<f32>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let h = wid.x; let m = wid.y; let pos = p.pos0 + m; let half = p.half; let D = p.D;
  let row = p.qkvOff + m * p.ldq;
  if (h >= p.Hq + p.Hkv) {   // v head: copy into the cache
    let vh = h - p.Hq - p.Hkv; let src = row + (p.Hq + p.Hkv) * D + vh * D;
    for (var d = t; d < D; d = d + 64u) { VC[p.vcOff + (vh * p.Lmax + pos) * D + d] = f16(QKV[src + d]); }
    return;
  }
  let isq = h < p.Hq; let src = row + h * D;
  var x0 = 0.0; var x1 = 0.0;
  if (t < half) { x0 = QKV[src + t]; x1 = QKV[src + t + half]; }
  if (p.hasNorm == 1u) {
    red[t] = x0 * x0 + x1 * x1; workgroupBarrier();
    for (var s = 32u; s > 0u; s = s >> 1u) { if (t < s) { red[t] = red[t] + red[t + s]; } workgroupBarrier(); }
    let rs = inverseSqrt(red[0] / f32(D) + p.eps);
    let wo = select(p.nk, p.nq, isq);
    if (t < half) { x0 = x0 * rs * NW[wo + t]; x1 = x1 * rs * NW[wo + t + half]; }
  }
  if (t < half) {
    var o0 = x0; var o1 = x1;
    if (p.rope == 1u) { let c = RT[pos * half + t]; let s = RT[p.sinOff + pos * half + t]; o0 = x0 * c - x1 * s; o1 = x1 * c + x0 * s; }
    if (isq) { let qo = p.qoOff + m * p.ldqo + h * D; QO[qo + t] = o0; QO[qo + t + half] = o1; }
    else { let kh = h - p.Hq; let kb = p.kcOff + (kh * p.Lmax + pos) * D; KC[kb + t] = f16(o0); KC[kb + t + half] = f16(o1); }
  }
}`;
/** a = {qkv:{buf, off, ld}, M, Hq, Hkv, D, pos0, q:{buf, off, ld}, kc:{buf, off(halves)}, vc:{buf, off}, Lmax,
 *       norm: {buf, q (float off), k (float off), eps} | null, rope: {buf, sinOff(floats)} | null } */
export function qkrope(g, a) {
  const pipe = g.pipeline('vqkrope', () => QKROPE);
  if (a.D > 128) throw new Error('qkrope: D > 128');
  const nb = a.norm ? a.norm.buf : dummy(g, 0), rb = a.rope ? a.rope.buf : dummy(g, 1);
  const pr = P().u32(a.Hq).u32(a.Hkv).u32(a.D).u32(a.qkv.ld).u32(a.qkv.off || 0).u32(a.q.off || 0).u32(a.q.ld || a.Hq * a.D).u32(a.Lmax).u32(a.pos0)
    .u32(a.norm ? a.norm.q : 0).u32(a.norm ? a.norm.k : 0).u32(a.norm ? 1 : 0).f32(a.norm ? a.norm.eps : 1e-6).u32(a.rope ? 1 : 0).u32(a.D / 2)
    .u32(a.rope ? a.rope.sinOff : 0).u32(a.kc.off || 0).u32(a.vc.off || 0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(a.qkv.buf), bw(a.q.buf), bw(a.kc.buf), bw(a.vc.buf), bw(nb), bw(rb)], pr.ab, [a.Hq + 2 * a.Hkv, a.M], a.M * (a.Hq + 2 * a.Hkv) * a.D * 8 / (g.rate.mem || 20e9));
}

/** RoPE table for positions [0, L): [L][half] cos then [L][half] sin, f32 like torch (inv_freq f32, freqs = f32(p * inv), cos/sin of that) */
export function ropeTable(L, D, theta) {
  const half = D / 2, out = new Float32Array(2 * L * half), inv = new Float32Array(half);
  for (let i = 0; i < half; i++) inv[i] = Math.fround(1 / Math.fround(Math.pow(theta, Math.fround((2 * i) / D))));
  for (let p = 0; p < L; p++) for (let i = 0; i < half; i++) { const f = Math.fround(p * inv[i]); out[p * half + i] = Math.cos(f); out[L * half + p * half + i] = Math.sin(f); }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------- attention
const ATTN = (o16) => `
enable f16;
struct P { Hq: u32, Hkv: u32, D: u32, pos0: u32, window: u32, Lmax: u32, qOff: u32, ldq: u32, oOff: u32, ldo: u32, kcOff: u32, vcOff: u32, scale: f32, m0: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<f32>;
@group(0) @binding(2) var<storage, read> KC: array<vec4<f16>>;
@group(0) @binding(3) var<storage, read> VC: array<vec4<f16>>;
@group(0) @binding(4) var<storage, read_write> O: array<${o16 ? 'f16' : 'f32'}>;
var<workgroup> qs: array<vec4<f32>, 32>;
var<workgroup> ps: array<f32, 128>;
var<workgroup> red: array<f32, 128>;
var<workgroup> pacc: array<vec4<f32>, 128>;
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let h = wid.x; let m = wid.y + p.m0; let D = p.D; let D4 = D / 4u; let KG = 128u / D4; let P0 = p.pos0 + m;
  let kvh = h / (p.Hq / p.Hkv);
  var lo = 0u; if (p.window > 0u && P0 + 1u > p.window) { lo = P0 + 1u - p.window; }
  if (t < D4) { let qb = p.qOff + m * p.ldq + h * D + t * 4u; qs[t] = vec4<f32>(Q[qb], Q[qb + 1u], Q[qb + 2u], Q[qb + 3u]); }
  workgroupBarrier();
  let kb = (p.kcOff + kvh * p.Lmax * D) / 4u; let vb = (p.vcOff + kvh * p.Lmax * D) / 4u;
  let d4 = t % D4; let kg = t / D4;
  var mrun = -3.0e38; var lrun = 0.0; var acc = vec4<f32>(0.0);
  for (var c0 = lo; c0 <= P0; c0 = c0 + 128u) {
    let j = c0 + t; var s = -3.0e38;
    if (j <= P0) { var d0 = 0.0; let kr = kb + j * D4; for (var d = 0u; d < D4; d = d + 1u) { d0 = d0 + dot(qs[d], vec4<f32>(KC[kr + d])); } s = d0 * p.scale; }
    red[t] = s; workgroupBarrier();
    for (var st = 64u; st > 0u; st = st >> 1u) { if (t < st) { red[t] = max(red[t], red[t + st]); } workgroupBarrier(); }
    let mc = red[0]; workgroupBarrier();
    let mnew = max(mrun, mc); let e = select(0.0, exp(s - mnew), j <= P0);
    ps[t] = e; red[t] = e; workgroupBarrier();
    for (var st = 64u; st > 0u; st = st >> 1u) { if (t < st) { red[t] = red[t] + red[t + st]; } workgroupBarrier(); }
    let corr = exp(mrun - mnew); lrun = lrun * corr + red[0]; mrun = mnew;
    acc = acc * corr;
    let n = min(128u, P0 + 1u - c0);
    for (var i = kg; i < n; i = i + KG) { acc = acc + ps[i] * vec4<f32>(VC[vb + (c0 + i) * D4 + d4]); }
    workgroupBarrier();
  }
  pacc[t] = acc; workgroupBarrier();
  if (t < D4) {
    var o = vec4<f32>(0.0); for (var g = 0u; g < KG; g = g + 1u) { o = o + pacc[g * D4 + t]; }
    o = o / lrun; let ob = p.oOff + m * p.ldo + h * D + t * 4u;
    O[ob] = ${o16 ? 'f16' : 'f32'}(o.x); O[ob + 1u] = ${o16 ? 'f16' : 'f32'}(o.y); O[ob + 2u] = ${o16 ? 'f16' : 'f32'}(o.z); O[ob + 3u] = ${o16 ? 'f16' : 'f32'}(o.w);
  }
}`;
/** a = {q:{buf, off, ld}, M, Hq, Hkv, D, pos0, window(0 = none), Lmax, kc:{buf, off}, vc:{buf, off}, o:{buf, off, ld}, f16out, scale} */
export function attn(g, a) {
  const pipe = g.pipeline('vattn' + (a.f16out ? '16' : '32'), () => ATTN(!!a.f16out));
  const scale = a.scale != null ? a.scale : 1 / Math.sqrt(a.D);
  for (let m0 = 0; m0 < a.M; m0 += 65535) {
    const n = Math.min(65535, a.M - m0);
    const pr = P().u32(a.Hq).u32(a.Hkv).u32(a.D).u32(a.pos0).u32(a.window || 0).u32(a.Lmax).u32(a.q.off || 0).u32(a.q.ld || a.Hq * a.D)
      .u32(a.o.off || 0).u32(a.o.ld || a.Hq * a.D).u32(a.kc.off || 0).u32(a.vc.off || 0).f32(scale).u32(m0).u32(0).u32(0);
    const L = a.pos0 + a.M;
    g.runner.dispatch(pipe, [bw(a.q.buf), bw(a.kc.buf), bw(a.vc.buf), bw(a.o.buf)], pr.ab, [a.Hq, n], (4 * n * a.Hq * L * a.D) / (g.rate.attn || 0.05e12));
  }
}

// ------------------------------------------------------------------------------------------------------------------- sampler
const SAMPLER = `
enable f16;
struct P { V: u32, lOff: u32, mode: u32, invT: f32, topk: u32, pen: f32, useSeen: u32, supLo: u32, supHi: u32, eos: u32, maskEos: u32,
  seedLo: u32, seedHi: u32, ctr: u32, codeIdx: u32, embOff: u32, emode: u32, dstOff: u32, sumOff: u32, tRow: u32, seenOff: u32, logOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> LG: array<f32>;
@group(0) @binding(2) var<storage, read_write> CODES: array<u32>;
@group(0) @binding(3) var<storage, read_write> SEEN: array<u32>;
@group(0) @binding(4) var<storage, read> EMB: array<vec4<f16>>;
@group(0) @binding(5) var<storage, read_write> ST: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> TT: array<vec4<f32>>;
const NPT = 12u;
var<workgroup> hist: array<atomic<u32>, 256>;
var<workgroup> bv: array<f32, 256>;
var<workgroup> bi: array<u32, 256>;
var<workgroup> sel: array<u32, 2>;
fn okey(v: f32) -> u32 { let b = bitcast<u32>(v); return select(b | 0x80000000u, ~b, (b & 0x80000000u) != 0u); }
fn hmix(x0: u32) -> u32 { var x = x0; x = x ^ (x >> 16u); x = x * 0x7feb352du; x = x ^ (x >> 15u); x = x * 0x846ca68bu; x = x ^ (x >> 16u); return x; }
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) t: u32) {
  var v: array<f32, 12>;
  for (var j = 0u; j < NPT; j = j + 1u) {
    let i = t + j * 256u; var x = -3.4e38;
    if (i < p.V) {
      x = LG[p.lOff + i];
      if (p.useSeen == 1u && ((SEEN[p.seenOff + (i >> 5u)] >> (i & 31u)) & 1u) == 1u) { x = select(x / p.pen, x * p.pen, x < 0.0); }
      if (i >= p.supLo && i < p.supHi && i != p.eos) { x = -3.4e38; }
      if (p.maskEos == 1u && i == p.eos) { x = -3.4e38; }
      if (p.mode == 1u && x > -3.0e38) { x = x * p.invT; }
    }
    v[j] = x;
  }
  var code = 0u;
  if (p.mode == 2u) {
    code = CODES[p.codeIdx];
    workgroupBarrier();
    if (t == 0u && p.useSeen == 1u) { SEEN[p.seenOff + (code >> 5u)] = SEEN[p.seenOff + (code >> 5u)] | (1u << (code & 31u)); }
  } else {
    var thr = 0u;
    if (p.mode == 1u) {
      // exact k-th largest key: 4 radix passes (8 bits each, MSB first)
      var prefix = 0u; var msk = 0u; var kk = p.topk;
      for (var ps = 0u; ps < 4u; ps = ps + 1u) {
        let sh = 24u - 8u * ps;
        atomicStore(&hist[t], 0u); workgroupBarrier();
        for (var j = 0u; j < NPT; j = j + 1u) { let i = t + j * 256u; if (i < p.V) { let k = okey(v[j]); if ((k & msk) == prefix) { atomicAdd(&hist[(k >> sh) & 255u], 1u); } } }
        workgroupBarrier();
        if (t == 0u) { var cum = 0u; var b = 255i; var found = 0u;
          for (; b >= 0i; b = b - 1i) { let c = atomicLoad(&hist[u32(b)]); if (cum + c >= kk) { found = u32(b); break; } cum = cum + c; }
          if (b < 0i) { found = 0u; }
          sel[0] = found; sel[1] = kk - cum; }
        workgroupBarrier();
        prefix = prefix | (sel[0] << sh); msk = msk | (255u << sh); kk = sel[1];
        workgroupBarrier();
      }
      thr = prefix;
    }
    // argmax of (value + Gumbel noise) over the kept set (mode 1) or of the value (mode 0); ties -> the lowest index
    var best = -3.4e38; var bidx = 0xffffffffu;
    for (var j = 0u; j < NPT; j = j + 1u) {
      let i = t + j * 256u;
      if (i < p.V) {
        var s = v[j];
        if (p.mode == 1u) {
          if (okey(v[j]) < thr || v[j] <= -3.0e38) { s = -3.4e38; }
          else { let h = hmix(hmix(hmix(i ^ p.seedLo) ^ p.ctr) ^ p.seedHi); let u = (f32(h >> 8u) + 0.5) / 16777216.0; s = v[j] - log(-log(u)); }
        }
        if (s > best || (s == best && i < bidx)) { best = s; bidx = i; }
      }
    }
    bv[t] = best; bi[t] = bidx; workgroupBarrier();
    for (var st = 128u; st > 0u; st = st >> 1u) {
      if (t < st) { let o = t + st; if (bv[o] > bv[t] || (bv[o] == bv[t] && bi[o] < bi[t])) { bv[t] = bv[o]; bi[t] = bi[o]; } }
      workgroupBarrier();
    }
    code = bi[0];
    if (t == 0u) { CODES[p.codeIdx] = code; if (p.useSeen == 1u) { SEEN[p.seenOff + (code >> 5u)] = SEEN[p.seenOff + (code >> 5u)] | (1u << (code & 31u)); } }
  }
  // the code's embedding row (1024 = 256 x vec4): dst row (set), running sum (set / add), + trailing text row
  let row = vec4<f32>(EMB[p.embOff / 4u + code * 256u + t]);
  if ((p.emode & 1u) != 0u) { ST[p.dstOff / 4u + t] = row; }
  if ((p.emode & 2u) != 0u) { ST[p.sumOff / 4u + t] = row; }
  if ((p.emode & 4u) != 0u) { ST[p.sumOff / 4u + t] = ST[p.sumOff / 4u + t] + row; }
  if ((p.emode & 8u) != 0u) { ST[p.sumOff / 4u + t] = ST[p.sumOff / 4u + t] + TT[p.tRow * 256u + t]; }
}`;
/**
 * a = { logits:{buf, off(floats)}, V, mode: 'greedy'|'sample'|'forced', temperature, topk, penalty (1 = none), seen:{buf, off(u32)} | null,
 *       suppress: [lo, hi) | null, eos (or -1), maskEos, seed: [lo, hi] u32, ctr, codes:{buf}, codeIdx,
 *       emb:{buf, off(halves)}, state:{buf}, dstOff (floats) | -1, sum: 'set'|'add'|null, sumOff, textRow (index into tt) | -1, tt:{buf} }
 */
export function sampler(g, a) {
  const pipe = g.pipeline('vsampler', () => SAMPLER);
  if (a.V > 3072) throw new Error('sampler: V > 3072');
  const mode = a.mode === 'greedy' ? 0 : a.mode === 'sample' ? 1 : 2;
  let em = 0; if (a.dstOff != null && a.dstOff >= 0) em |= 1; if (a.sum === 'set') em |= 2; if (a.sum === 'add') em |= 4; if (a.textRow != null && a.textRow >= 0) em |= 8;
  const sup = a.suppress || [0, 0];
  const pr = P().u32(a.V).u32(a.logits.off || 0).u32(mode).f32(1 / (a.temperature || 1)).u32(a.topk || 50).f32(a.penalty || 1).u32(a.seen ? 1 : 0)
    .u32(sup[0]).u32(sup[1]).u32(a.eos != null && a.eos >= 0 ? a.eos : 0xffffffff).u32(a.maskEos ? 1 : 0).u32(a.seed[0] >>> 0).u32(a.seed[1] >>> 0).u32(a.ctr >>> 0)
    .u32(a.codeIdx).u32(a.emb.off || 0).u32(em).u32(Math.max(0, a.dstOff || 0)).u32(a.sumOff || 0).u32(Math.max(0, a.textRow != null ? a.textRow : 0))
    .u32(a.seen ? a.seen.off || 0 : 0).u32(0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(a.logits.buf), bw(a.codes.buf), bw(a.seen ? a.seen.buf : dummy(g, 2)), bw(a.emb.buf), bw(a.state.buf), bw(a.tt ? a.tt.buf : dummy(g, 3))], pr.ab, [1, 1], 2e-5);
}

// ------------------------------------------------------------------------------------------------------------------- rowgather
const ROWGATHER = `
enable f16;
struct P { n: u32, oOff: u32, t1Off: u32, t1Rows: u32, mode: u32, t0Off: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> SPEC: array<u32>;   // [n][17]: dst row, id for table 0, ids for tables 1..15 (0xffffffff = none)
@group(0) @binding(2) var<storage, read> E0: array<vec4<f16>>;
@group(0) @binding(3) var<storage, read> E1: array<vec4<f16>>;
@group(0) @binding(4) var<storage, read_write> OUT: array<vec4<f32>>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let r = wid.x; let s = r * 17u; let dst = SPEC[s];
  var acc = vec4<f32>(0.0);
  let c0 = SPEC[s + 1u]; if (c0 != 0xffffffffu) { acc = acc + vec4<f32>(E0[p.t0Off / 4u + c0 * 256u + t]); }
  for (var q = 1u; q < 16u; q = q + 1u) { let c = SPEC[s + 1u + q]; if (c != 0xffffffffu) { acc = acc + vec4<f32>(E1[p.t1Off / 4u + ((q - 1u) * p.t1Rows + c) * 256u + t]); } }
  let o = p.oOff / 4u + dst * 256u + t;
  if (p.mode == 1u) { OUT[o] = OUT[o] + acc; } else { OUT[o] = acc; }
}`;
/** a = {e0:{buf, off(halves)}, e1:{buf, off(halves), rows}, out:{buf, off(floats)}, add}; specBuf u32 [n][17] */
export function rowgather(g, a, specBuf, n) {
  const pipe = g.pipeline('vrowgather', () => ROWGATHER);
  const pr = P().u32(n).u32(a.out.off || 0).u32(a.e1.off || 0).u32(a.e1.rows || 2048).u32(a.add ? 1 : 0).u32(a.e0.off || 0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(specBuf), bw(a.e0.buf), bw(a.e1.buf), bw(a.out.buf)], pr.ab, [n, 1], n * 16 * 2048 / (g.rate.mem || 20e9));
}
