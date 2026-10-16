// Pocket Voice small kernels for the codec / speaker networks (channel-last [rows][C] tensors, f32 unless noted).
//   snake    y = x + sin^2(e^a x) / (e^b + 1e-9) per channel (range-reduced sin), f32 -> f16 | f32
//   act      elementwise ELU / ReLU / copy, f32 -> f16 | f32   (also the f32 -> f16 cast)
//   dwconv   depthwise causal conv (k taps, zero left pad), f32, + bias
//   cbsum    RVQ decode gather: out f16 [T][2*D] = [cb0[c0] | sum_{q>=1} cb_q[c_q]]
//   rowsplat / padrows   row copies with replicate / reflect / zero padding (for strided / reflect convs)
//   colstats per-channel mean / std over rows (ASP, SE), weighted softmax pooling (ASP)
//   vqsearch argmin_e (|e|^2 - 2 x.e) over a 2048 x 256 codebook per row, residual update (RVQ encode)
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
const grid = (n) => (n <= 65535 ? [n, 1] : [65535, Math.ceil(n / 65535)]);

// ------------------------------------------------------------------ snake (+ act / cast)
const EW = (o16) => `
enable f16;
struct P { n: u32, C: u32, xOff: u32, yOff: u32, aOff: u32, bOff: u32, op: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> AB: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<${o16 ? 'f16' : 'f32'}>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.x + gid.y * nw.x * 256u; if (i >= p.n) { return; }
  var x = X[p.xOff + i]; let c = i % p.C;
  if (p.op == 0u) {   // snake beta (torch: alpha = exp(alpha), beta = exp(beta); x + 1/(beta + 1e-9) * sin(x * alpha)^2)
    let al = exp(AB[p.aOff + c]); let be = exp(AB[p.bOff + c]);
    let z = x * al; let r = z - 6.283185307179586 * round(z * 0.15915494309189535); let s = sin(r);
    x = x + s * s / (be + 1e-9);
  } else if (p.op == 1u) { x = select(exp(x) - 1.0, x, x > 0.0); }      // ELU
  else if (p.op == 2u) { x = max(x, 0.0); }                              // ReLU
  else if (p.op == 4u) { x = clamp(x, -1.0, 1.0); }
  Y[p.yOff + i] = ${o16 ? 'f16' : 'f32'}(x);
}`;
const OPS = { snake: 0, elu: 1, relu: 2, copy: 3, clamp: 4 };
/** a = {op, x:{buf, off}, y:{buf, off}, n, C, ab:{buf, a, b} (snake: float offsets of alpha / beta), f16} */
export function ew(g, a) {
  const pipe = g.pipeline('vk.ew' + (a.f16 ? '16' : '32'), () => EW(!!a.f16));
  const ab = a.ab ? a.ab.buf : a.x.buf, nwg = Math.ceil(a.n / 256);
  const pr = P().u32(a.n).u32(a.C || 1).u32(a.x.off || 0).u32(a.y.off || 0).u32(a.ab ? a.ab.a : 0).u32(a.ab ? a.ab.b : 0).u32(OPS[a.op]).u32(0);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(ab), bw(a.y.buf)], pr.ab, grid(nwg), a.n * 8 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------ depthwise causal conv
const DW = `
struct P { T: u32, C: u32, K: u32, xOff: u32, yOff: u32, wOff: u32, bOff: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.x + gid.y * nw.x * 256u; if (i >= p.T * p.C) { return; }
  let t = i / p.C; let c = i % p.C; var acc = W[p.bOff + c];
  for (var j = 0u; j < p.K; j = j + 1u) { let ti = i32(t) + i32(j) - i32(p.K - 1u); if (ti >= 0) { acc = acc + W[p.wOff + c * p.K + j] * X[p.xOff + u32(ti) * p.C + c]; } }
  Y[p.yOff + i] = acc;
}`;
/** a = {x:{buf, off}, y:{buf, off}, T, C, K, w:{buf, off(floats)}, b:{off(floats)} (same buffer as w)} */
export function dwconv(g, a) {
  const pipe = g.pipeline('vk.dw', () => DW);
  const pr = P().u32(a.T).u32(a.C).u32(a.K).u32(a.x.off || 0).u32(a.y.off || 0).u32(a.w.off).u32(a.b.off).u32(0);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.w.buf), bw(a.y.buf)], pr.ab, grid(Math.ceil(a.T * a.C / 256)), a.T * a.C * a.K * 2 / (g.rate.mm || 0.1e12));
}

// ------------------------------------------------------------------ RVQ decode gather
const CBSUM = `
enable f16;
struct P { T: u32, D: u32, cbOff: u32, nq: u32, codeOff: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> CODES: array<u32>;
@group(0) @binding(2) var<storage, read> CB: array<f16>;
@group(0) @binding(3) var<storage, read_write> Y: array<f16>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) d: u32) {
  let t = wid.x; if (d >= p.D) { return; }
  let c0 = CODES[p.codeOff + t * p.nq];
  Y[t * 2u * p.D + d] = CB[p.cbOff + c0 * p.D + d];
  var s = 0.0;
  for (var q = 1u; q < p.nq; q = q + 1u) { let c = CODES[p.codeOff + t * p.nq + q]; s = s + f32(CB[p.cbOff + (q * 2048u + c) * p.D + d]); }
  Y[t * 2u * p.D + p.D + d] = f16(s);
}`;
/** a = {codes:{buf, off(u32)}, T, D (256), nq (16), cb:{buf, off(halves)}, y:{buf}} */
export function cbsum(g, a) {
  const pipe = g.pipeline('vk.cbsum', () => CBSUM);
  const pr = P().u32(a.T).u32(a.D).u32(a.cb.off || 0).u32(a.nq).u32(a.codes.off || 0).u32(0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(a.codes.buf), bw(a.cb.buf), bw(a.y.buf)], pr.ab, [a.T, 1], a.T * a.nq * a.D * 2 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------ row copy with padding (zero / replicate / reflect), f32 or f16 out
const PAD = (o16, i16) => `
enable f16;
struct P { Tin: u32, C: u32, padL: u32, Tout: u32, mode: u32, xOff: u32, yOff: u32, ldx: u32, c0: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<${i16 ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<storage, read_write> Y: array<${o16 ? 'f16' : 'f32'}>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.x + gid.y * nw.x * 256u; if (i >= p.Tout * p.C) { return; }
  let t = i32(i / p.C) - i32(p.padL); let c = i % p.C; let n = i32(p.Tin);
  var src = t; var ok = true;
  if (t < 0 || t >= n) {
    if (p.mode == 0u) { ok = false; }
    else if (p.mode == 1u) { src = clamp(t, 0, n - 1); }                         // replicate
    else { src = select(t, -t, t < 0); src = select(src, 2 * (n - 1) - src, src >= n); }   // reflect (no edge repeat)
  }
  var v = 0.0; if (ok) { v = f32(X[p.xOff + u32(src) * p.ldx + p.c0 + c]); }
  Y[p.yOff + i] = ${o16 ? 'f16' : 'f32'}(v);
}`;
/** a = {x:{buf, off, ld, c0}, Tin, C, padL, Tout, mode:'zero'|'replicate'|'reflect', y:{buf, off}, f16 (out), i16 (in)} */
export function padrows(g, a) {
  const pipe = g.pipeline('vk.pad' + (a.f16 ? 'h' : 'f') + (a.i16 ? 'h' : 'f'), () => PAD(!!a.f16, !!a.i16));
  const mode = { zero: 0, replicate: 1, reflect: 2 }[a.mode || 'zero'];
  const pr = P().u32(a.Tin).u32(a.C).u32(a.padL).u32(a.Tout).u32(mode).u32(a.x.off || 0).u32(a.y.off || 0).u32(a.x.ld || a.C).u32(a.x.c0 || 0).u32(0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.y.buf)], pr.ab, grid(Math.ceil(a.Tout * a.C / 256)), a.Tout * a.C * 8 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------ column statistics: mean / std over rows (optionally weighted by W[t][c])
const COLSTAT = `
struct P { T: u32, C: u32, xOff: u32, ldx: u32, wOff: u32, useW: u32, oOff: u32, eps: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> WT: array<f32>;
@group(0) @binding(3) var<storage, read_write> O: array<f32>;
var<workgroup> r1: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let c = wid.x; let invT = 1.0 / f32(p.T);
  var s = 0.0; for (var i = t; i < p.T; i = i + 256u) { let w = select(invT, WT[p.wOff + i * p.C + c], p.useW == 1u); s = s + w * X[p.xOff + i * p.ldx + c]; }
  r1[t] = s; workgroupBarrier();
  for (var h = 128u; h > 0u; h = h >> 1u) { if (t < h) { r1[t] = r1[t] + r1[t + h]; } workgroupBarrier(); }
  let mean = r1[0]; workgroupBarrier();
  var q = 0.0; for (var i = t; i < p.T; i = i + 256u) { let w = select(invT, WT[p.wOff + i * p.C + c], p.useW == 1u); let d = X[p.xOff + i * p.ldx + c] - mean; q = q + w * d * d; }
  r1[t] = q; workgroupBarrier();
  for (var h = 128u; h > 0u; h = h >> 1u) { if (t < h) { r1[t] = r1[t] + r1[t + h]; } workgroupBarrier(); }
  if (t == 0u) { O[p.oOff + c] = mean; O[p.oOff + p.C + c] = sqrt(max(r1[0], p.eps)); }
}`;
/** mean[C], std[C] -> o (2C floats at off) ; w: optional weights [T][C] (ASP attention), else 1/T */
export function colstats(g, a) {
  const pipe = g.pipeline('vk.colstat', () => COLSTAT);
  const pr = P().u32(a.T).u32(a.C).u32(a.x.off || 0).u32(a.x.ld || a.C).u32(a.w ? a.w.off || 0 : 0).u32(a.w ? 1 : 0).u32(a.o.off || 0).f32(a.eps != null ? a.eps : 1e-12);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.w ? a.w.buf : a.x.buf), bw(a.o.buf)], pr.ab, [a.C, 1], a.T * a.C * 8 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------ softmax over rows (time) per column, in place
const COLSOFT = `
struct P { T: u32, C: u32, off: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> X: array<f32>;
var<workgroup> r1: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let c = wid.x;
  var m = -3.4e38; for (var i = t; i < p.T; i = i + 256u) { m = max(m, X[p.off + i * p.C + c]); }
  r1[t] = m; workgroupBarrier();
  for (var h = 128u; h > 0u; h = h >> 1u) { if (t < h) { r1[t] = max(r1[t], r1[t + h]); } workgroupBarrier(); }
  m = r1[0]; workgroupBarrier();
  var s = 0.0; for (var i = t; i < p.T; i = i + 256u) { s = s + exp(X[p.off + i * p.C + c] - m); }
  r1[t] = s; workgroupBarrier();
  for (var h = 128u; h > 0u; h = h >> 1u) { if (t < h) { r1[t] = r1[t] + r1[t + h]; } workgroupBarrier(); }
  let inv = 1.0 / r1[0];
  for (var i = t; i < p.T; i = i + 256u) { X[p.off + i * p.C + c] = exp(X[p.off + i * p.C + c] - m) * inv; }
}`;
export function colsoftmax(g, a) {
  const pipe = g.pipeline('vk.colsoft', () => COLSOFT);
  g.runner.dispatch(pipe, [bw(a.x.buf)], P().u32(a.T).u32(a.C).u32(a.x.off || 0).u32(0).ab, [a.C, 1], a.T * a.C * 12 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------ broadcast rows: Y[t] = cat(X[t], V) (ASP input [x | mean | std]), f16 out
const CATB = (o32) => `
enable f16;
struct P { T: u32, C: u32, V: u32, xOff: u32, vOff: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> VV: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<${o32 ? 'f32' : 'f16'}>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let W = p.C + p.V; let i = gid.x + gid.y * nw.x * 256u; if (i >= p.T * W) { return; }
  let t = i / W; let c = i % W;
  Y[i] = ${o32 ? 'f32' : 'f16'}(select(VV[p.vOff + c - p.C], X[p.xOff + t * p.C + c], c < p.C));
}`;
export function catbcast(g, a) {
  const pipe = g.pipeline('vk.catb' + (a.f32 ? '32' : '16'), () => CATB(!!a.f32));
  const pr = P().u32(a.T).u32(a.C).u32(a.V).u32(a.x.off || 0).u32(a.v.off || 0).u32(0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.v.buf), bw(a.y.buf)], pr.ab, grid(Math.ceil(a.T * (a.C + a.V) / 256)), a.T * (a.C + a.V) * 6 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------ squeeze-excitation: s = sigmoid(W2 relu(W1 m + b1) + b2); y = x * s + r  (one WG per 64 channels)
const SE = `
enable f16;
struct P { T: u32, C: u32, H: u32, mOff: u32, w1: u32, b1: u32, w2: u32, b2: u32, xOff: u32, rOff: u32, yOff: u32, ldr: u32, ldy: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> MS: array<f32>;
@group(0) @binding(3) var<storage, read> WH: array<f16>;
@group(0) @binding(4) var<storage, read> WF: array<f32>;
@group(0) @binding(5) var<storage, read> R: array<f32>;
@group(0) @binding(6) var<storage, read_write> Y: array<f32>;
var<workgroup> hid: array<f32, 128>;
var<workgroup> sc: array<f32, 512>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  if (t < p.H) { var a = WF[p.b1 + t]; for (var c = 0u; c < p.C; c = c + 1u) { a = a + f32(WH[p.w1 + t * p.C + c]) * MS[p.mOff + c]; } hid[t] = max(a, 0.0); }
  workgroupBarrier();
  for (var c = t; c < p.C; c = c + 256u) { var a = WF[p.b2 + c]; for (var h = 0u; h < p.H; h = h + 1u) { a = a + f32(WH[p.w2 + c * p.H + h]) * hid[h]; } sc[c] = 1.0 / (1.0 + exp(-a)); }
  workgroupBarrier();
  let rows = (p.T + 63u) / 64u; let r0 = wid.x * rows;
  for (var r = r0; r < min(p.T, r0 + rows); r = r + 1u) { for (var c = t; c < p.C; c = c + 256u) { Y[p.yOff + r * p.ldy + c] = X[p.xOff + r * p.C + c] * sc[c] + R[p.rOff + r * p.ldr + c]; } }
}`;
/** a = {T, C, H, mean:{buf, off}, w:{buf, w1, w2 (halves)}, b:{buf, b1, b2 (floats)}, x:{buf, off} (ld C), r:{buf, off, ld}, y:{buf, off, ld}} */
export function sescale(g, a) {
  const pipe = g.pipeline('vk.se', () => SE);
  const pr = P().u32(a.T).u32(a.C).u32(a.H).u32(a.mean.off || 0).u32(a.w.w1).u32(a.b.b1).u32(a.w.w2).u32(a.b.b2).u32(a.x.off || 0).u32(a.r.off || 0).u32(a.y.off || 0).u32(a.r.ld || a.C).u32(a.y.ld || a.C).u32(0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.mean.buf), bw(a.w.buf), bw(a.b.buf), bw(a.r.buf), bw(a.y.buf)], pr.ab, [64, 1], a.T * a.C * 12 / (g.rate.mem || 20e9));
}

// ------------------------------------------------------------------ RVQ encode: per row, nq codebooks in sequence on the residual
const VQ = `
struct P { T: u32, D: u32, nq: u32, xOff: u32, ldx: u32, cbOff: u32, c2Off: u32, codeOff: u32, cstride: u32, q0: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> CB: array<f32>;
@group(0) @binding(3) var<storage, read_write> CODES: array<u32>;
var<workgroup> r: array<f32, 256>;
var<workgroup> bv: array<f32, 256>;
var<workgroup> bi: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let row = wid.x;
  if (t < p.D) { r[t] = X[p.xOff + row * p.ldx + t]; }
  workgroupBarrier();
  for (var q = 0u; q < p.nq; q = q + 1u) {
    let cbq = p.cbOff + q * 2048u * p.D;
    var best = 3.4e38; var bix = 0u;
    for (var e = t; e < 2048u; e = e + 256u) {
      var dot = 0.0; let eb = cbq + e * p.D;
      for (var d = 0u; d < p.D; d = d + 1u) { dot = dot + r[d] * CB[eb + d]; }
      let s = CB[p.c2Off + q * 2048u + e] - 2.0 * dot;
      if (s < best) { best = s; bix = e; }
    }
    bv[t] = best; bi[t] = bix; workgroupBarrier();
    for (var st = 128u; st > 0u; st = st >> 1u) {
      if (t < st) { let o = t + st; if (bv[o] < bv[t] || (bv[o] == bv[t] && bi[o] < bi[t])) { bv[t] = bv[o]; bi[t] = bi[o]; } }
      workgroupBarrier();
    }
    let code = bi[0];
    if (t == 0u) { CODES[p.codeOff + row * p.cstride + p.q0 + q] = code; }
    workgroupBarrier();
    if (t < p.D) { r[t] = r[t] - CB[cbq + code * p.D + t]; }
    workgroupBarrier();
  }
}`;
/** a = {x:{buf, off, ld}, T, D (<= 256), nq, cb:{buf, off(floats), c2Off(floats)}, codes:{buf, off}, cstride (16), q0} */
export function vqsearch(g, a) {
  const pipe = g.pipeline('vk.vq', () => VQ);
  const pr = P().u32(a.T).u32(a.D).u32(a.nq).u32(a.x.off || 0).u32(a.x.ld || a.D).u32(a.cb.off).u32(a.cb.c2Off).u32(a.codes.off || 0).u32(a.cstride).u32(a.q0 || 0).u32(0).u32(0);
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(a.cb.buf), bw(a.codes.buf)], pr.ab, [a.T, 1], a.T * a.nq * 2048 * a.D * 2 / (g.rate.mm || 0.1e12));
}
