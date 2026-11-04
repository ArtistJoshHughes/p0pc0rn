// Pocket STT kernels (speech to text: NVIDIA Nemotron 3.5 ASR Streaming on WebGPU).  New file; the engine core stays as it is.
// Every activation is f32 (a chunk is 1-14 frames: the work is reading the weights once, not arithmetic), weights q8g64r
// (int8 codes [N][K] row-major + one fp16 scale per 64 inputs), dequantised inside the kernel, f32 accumulation everywhere.
//   sgemv     Y[m, n] = act(sum_k X[m, k] W[n, k] + b[n])  for M <= 8 rows (store) or Y += alpha * (...) (add); 32 rows a workgroup,
//             8 lanes a row, 128 inputs a step; one weight read serves every row (the skinny-GEMM shape of a streaming chunk)
//   lnorm     LayerNorm of rows (eps 1e-5, two-pass mean / variance like torch), optional SiLU after
//   attn      one (head, query) a workgroup: rel-position attention over the K/V ring (56 cached frames + the chunk), the table R[d]
//   kvput     the chunk's K and V rows into the ring (slot = frame % ring)
//   dwconv    GLU of pointwise_conv1's output, the 9-tap causal depthwise conv with an 8-frame history (ping-pong), the new history
//   stem0 / stemdw / stempw   the causal 2-D subsampling (conv_in 3x3 s2 + ReLU, depthwise 3x3 s2, pointwise 1x1 + ReLU), [t][c][f]
//   rowcopy   f32 rows from one place to another (the stem's one-frame caches)
//   jadd      Z[m, n] = relu(E[t0 + m, n] + g[n]) (the joint's input for the remaining frames of a chunk)
//   argmax    per row: the largest logit and its index (first index on ties, like torch.argmax)
//   lstmx / lstmcell   the decoder's [x ; h] input (x = a q8 embedding row or the layer below) and the LSTM cell update
// Metal rule (engine lesson): no shared vec4 slot is ever written lane-by-lane by different threads.
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });
const NONE = 0xffffffff;
export const SK = { NONE };

// ------------------------------------------------------------------------------------------------------------------- sgemv
function sgemvCode(MT) {
  return `
struct P { M: u32, N: u32, K: u32, ldx: u32, xOff: u32, wOff: u32, sOff: u32, ldy: u32, yOff: u32, bOff: u32, alpha: f32, act: u32, mode: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
var<workgroup> xs: array<vec4<f32>, ${MT * 32}>;
var<workgroup> red: array<f32, ${256 * MT}>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let r = li >> 3u; let l = li & 7u; let n = wg.x * 32u + r; let nr = min(n, p.N - 1u);
  var acc: array<f32, ${MT}>;
  for (var m = 0u; m < ${MT}u; m++) { acc[m] = 0.0; }
  let K4 = p.K >> 2u; let G = p.K >> 6u;
  for (var k0 = 0u; k0 < p.K; k0 += 128u) {
    for (var i = li; i < ${MT * 32}u; i += 256u) {
      let m = i >> 5u; let c = i & 31u;
      var v = vec4<f32>(0.0);
      if (m < p.M) { let b = p.xOff + m * p.ldx + k0 + c * 4u; v = vec4<f32>(X[b], X[b + 1u], X[b + 2u], X[b + 3u]); }
      xs[i] = v;
    }
    workgroupBarrier();
    let kk = k0 + l * 16u;
    let wb = p.wOff + nr * K4 + (kk >> 2u);
    let si = nr * G + (kk >> 6u);
    let s2 = unpack2x16float(W[p.sOff + (si >> 1u)]);
    let sc = 127.0 * select(s2.x, s2.y, (si & 1u) == 1u);
    let q0 = unpack4x8snorm(W[wb]) * sc; let q1 = unpack4x8snorm(W[wb + 1u]) * sc;
    let q2 = unpack4x8snorm(W[wb + 2u]) * sc; let q3 = unpack4x8snorm(W[wb + 3u]) * sc;
    for (var m = 0u; m < ${MT}u; m++) {
      let xb = m * 32u + l * 4u;
      acc[m] += dot(q0, xs[xb]) + dot(q1, xs[xb + 1u]) + dot(q2, xs[xb + 2u]) + dot(q3, xs[xb + 3u]);
    }
    workgroupBarrier();
  }
  for (var m = 0u; m < ${MT}u; m++) { red[li * ${MT}u + m] = acc[m]; }
  workgroupBarrier();
  if (li < ${32 * MT}u) {
    let rr = li / ${MT}u; let m = li % ${MT}u; let nn = wg.x * 32u + rr;
    if (nn < p.N && m < p.M) {
      var v = 0.0;
      for (var j = 0u; j < 8u; j++) { v += red[(rr * 8u + j) * ${MT}u + m]; }
      if (p.bOff != 0xffffffffu) { v += bitcast<f32>(W[p.bOff + nn]); }
      if (p.act == 1u) { v = max(v, 0.0); } else if (p.act == 2u) { v = v / (1.0 + exp(-v)); }
      let yi = p.yOff + m * p.ldy + nn;
      if (p.mode == 1u) { Y[yi] = Y[yi] + p.alpha * v; } else { Y[yi] = v; }
    }
  }
}`;
}
/** Y[m, :] (=|+=) act(X[m, :] W^T + b) for m < M (any M: done 8 rows at a time).  w: {buf, off (bytes), scales (bytes), n, k};
 *  x / y: {buf, off (floats), ld}; o: {bias: byte offset in w.buf | null, act: 0 | 'relu' | 'silu', add: alpha | undefined} */
export function sgemv(g, w, x, y, M, o = {}) {
  const act = o.act === 'relu' ? 1 : o.act === 'silu' ? 2 : 0;
  for (let m0 = 0; m0 < M; m0 += 8) {
    const m = Math.min(8, M - m0), MT = m <= 1 ? 1 : m <= 2 ? 2 : m <= 4 ? 4 : 8;
    const pipe = g.pipeline('stt.sgemv.' + MT, () => sgemvCode(MT));
    const pr = P().u32(m).u32(w.n).u32(w.k).u32(x.ld).u32(x.off + m0 * x.ld).u32(w.off / 4).u32(w.scales / 4).u32(y.ld).u32(y.off + m0 * y.ld)
      .u32(o.bias == null ? NONE : o.bias / 4).f32(o.add == null ? 1 : o.add).u32(act).u32(o.add == null ? 0 : 1).u32(0).u32(0).u32(0);
    g.runner.dispatch(pipe, [bw(x.buf), bw(w.buf), bw(y.buf)], pr.ab, [Math.ceil(w.n / 32)], m * w.n * w.k * 2 / g.rate.mm);
  }
}

// ------------------------------------------------------------------------------------------------------------------- lnorm
const LN = `
struct P { D: u32, xOff: u32, yOff: u32, ld: u32, gOff: u32, bOff: u32, act: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
var<workgroup> red: array<f32, 256>;
fn wsum(li: u32, v: f32) -> f32 {
  red[li] = v; workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) { if (li < s) { red[li] += red[li + s]; } workgroupBarrier(); }
  let t = red[0]; workgroupBarrier(); return t;
}
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let xo = p.xOff + wg.x * p.ld; let yo = p.yOff + wg.x * p.ld;
  var s = 0.0;
  for (var i = li; i < p.D; i += 256u) { s += X[xo + i]; }
  let mean = wsum(li, s) / f32(p.D);
  var q = 0.0;
  for (var i = li; i < p.D; i += 256u) { let d = X[xo + i] - mean; q += d * d; }
  let rstd = inverseSqrt(wsum(li, q) / f32(p.D) + 1e-5);
  for (var i = li; i < p.D; i += 256u) {
    var v = (X[xo + i] - mean) * rstd * bitcast<f32>(W[p.gOff + i]) + bitcast<f32>(W[p.bOff + i]);
    if (p.act == 2u) { v = v / (1.0 + exp(-v)); }
    Y[yo + i] = v;
  }
}`;
/** rows [0, R) of x (ld floats apart) -> y; gamma / beta: byte offsets in wbuf */
export function lnorm(g, x, y, R, wbuf, gOff, bOff, o = {}) {
  const pipe = g.pipeline('stt.lnorm', () => LN);
  const D = o.D || 1024, ld = o.ld || D;
  g.runner.dispatch(pipe, [bw(x.buf), bw(wbuf), bw(y.buf)], P().u32(D).u32(x.off).u32(y.off).u32(ld).u32(gOff / 4).u32(bOff / 4).u32(o.act === 'silu' ? 2 : 0).u32(0).ab, [R]);
}

// ------------------------------------------------------------------------------------------------------------------- attention
// Q from the qkv rows [C][3072] (q = cols 0..1023), K / V in rings [RING][1024]; key j (0 .. Lk-1) is frame P0 - cached + j, query i is
// frame P0 + i; score = ((q + bu) . k + (q + bv) . R[Rmax - 1 - (cached + i - j)]) / sqrt(128); R fp16 [2 Rmax - 1][1024].
const ATTN = `
struct P { C: u32, cached: u32, P0: u32, ring: u32, rOff: u32, uvOff: u32, rmax: u32, scale: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<f32>;
@group(0) @binding(2) var<storage, read> Kr: array<f32>;
@group(0) @binding(3) var<storage, read> Vr: array<f32>;
@group(0) @binding(4) var<storage, read> W: array<u32>;
@group(0) @binding(5) var<storage, read_write> O: array<f32>;
var<workgroup> qa: array<f32, 128>;
var<workgroup> qb: array<f32, 128>;
var<workgroup> pr: array<f32, 128>;
var<workgroup> red: array<f32, 128>;
@compute @workgroup_size(128)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let h = wg.x; let i = wg.y; let c = h * 128u + li;
  let q = Q[i * 3072u + c];
  qa[li] = q + bitcast<f32>(W[p.uvOff + c]); qb[li] = q + bitcast<f32>(W[p.uvOff + 1024u + c]);
  workgroupBarrier();
  let Lk = p.cached + p.C;
  var s = -3.0e38;
  if (li < Lk) {
    let slot = (p.P0 - p.cached + li) % p.ring;
    let kb = slot * 1024u + h * 128u;
    let d = i32(p.cached + i) - i32(li);
    let rr = u32(i32(p.rmax) - 1 - d);
    let rb = p.rOff + (rr * 1024u + h * 128u) / 2u;
    var a = 0.0; var b = 0.0;
    for (var e = 0u; e < 128u; e += 2u) {
      a += qa[e] * Kr[kb + e] + qa[e + 1u] * Kr[kb + e + 1u];
      let rv = unpack2x16float(W[rb + e / 2u]);
      b += qb[e] * rv.x + qb[e + 1u] * rv.y;
    }
    s = (a + b) * p.scale;
  }
  red[li] = s; workgroupBarrier();
  for (var k = 64u; k > 0u; k >>= 1u) { if (li < k) { red[li] = max(red[li], red[li + k]); } workgroupBarrier(); }
  let mx = red[0]; workgroupBarrier();
  var e = 0.0;
  if (li < Lk) { e = exp(s - mx); }
  pr[li] = e; red[li] = e; workgroupBarrier();
  for (var k = 64u; k > 0u; k >>= 1u) { if (li < k) { red[li] += red[li + k]; } workgroupBarrier(); }
  let inv = 1.0 / red[0];
  var o = 0.0;
  for (var j = 0u; j < Lk; j++) {
    let slot = (p.P0 - p.cached + j) % p.ring;
    o += pr[j] * Vr[slot * 1024u + c];
  }
  O[i * 1024u + c] = o * inv;
}`;
export function attn(g, qkv, kr, vr, wbuf, o) {
  const pipe = g.pipeline('stt.attn', () => ATTN);
  const pr = P().u32(o.C).u32(o.cached).u32(o.P0).u32(o.ring).u32(o.rOff / 4).u32(o.uvOff / 4).u32(o.rmax).f32(1 / Math.sqrt(128));
  g.runner.dispatch(pipe, [bw(qkv), bw(kr), bw(vr), bw(wbuf), bw(o.out)], pr.ab, [8, o.C]);
}

const KVPUT = `
struct P { C: u32, P0: u32, ring: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<f32>;
@group(0) @binding(2) var<storage, read_write> Kr: array<f32>;
@group(0) @binding(3) var<storage, read_write> Vr: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x; if (n >= p.C * 1024u) { return; }
  let i = n / 1024u; let c = n % 1024u; let slot = (p.P0 + i) % p.ring;
  Kr[slot * 1024u + c] = Q[i * 3072u + 1024u + c];
  Vr[slot * 1024u + c] = Q[i * 3072u + 2048u + c];
}`;
export function kvput(g, qkv, kr, vr, C, P0, ring) {
  const pipe = g.pipeline('stt.kvput', () => KVPUT);
  g.runner.dispatch(pipe, [bw(qkv), bw(kr), bw(vr)], P().u32(C).u32(P0).u32(ring).u32(0).ab, [Math.ceil(C * 1024 / 256)]);
}

// ------------------------------------------------------------------------------------------------------------------- depthwise conv
// PW [C][2048] (pointwise_conv1 output: a | gate), Hin / Hout [8][1024] (the GLU output of the 8 frames before the chunk);
// y[t][c] = sum_k w[k][c] * u(t + k - 8), u(s) = s < 0 ? Hin[8 + s][c] : a[s][c] * sigmoid(gate[s][c]); Hout = the last 8 of [Hin ; u]
const DWC = `
struct P { C: u32, wOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> PW: array<f32>;
@group(0) @binding(2) var<storage, read> Hin: array<f32>;
@group(0) @binding(3) var<storage, read> W: array<u32>;
@group(0) @binding(4) var<storage, read_write> Y: array<f32>;
@group(0) @binding(5) var<storage, read_write> Hout: array<f32>;
fn u(s: i32, c: u32) -> f32 {
  if (s < 0) { return Hin[u32(8 + s) * 1024u + c]; }
  let a = PW[u32(s) * 2048u + c]; let gt = PW[u32(s) * 2048u + 1024u + c];
  return a / (1.0 + exp(-gt));
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x; if (n >= (p.C + 8u) * 1024u) { return; }
  let t = n / 1024u; let c = n % 1024u;
  if (t < p.C) {
    var v = 0.0;
    for (var k = 0u; k < 9u; k++) { v += bitcast<f32>(W[p.wOff + k * 1024u + c]) * u(i32(t + k) - 8, c); }
    Y[t * 1024u + c] = v;
  } else {
    let j = t - p.C;                          // Hout row j = element C + j of [Hin ; u] counted from Hin's start
    Hout[j * 1024u + c] = u(i32(p.C + j) - 8, c);
  }
}`;
export function dwconv(g, pw, hin, hout, wbuf, wOff, y, C) {
  const pipe = g.pipeline('stt.dwconv', () => DWC);
  g.runner.dispatch(pipe, [bw(pw), bw(hin), bw(wbuf), bw(y), bw(hout)], P().u32(C).u32(wOff / 4).u32(0).u32(0).ab, [Math.ceil((C + 8) * 1024 / 256)]);
}

// ------------------------------------------------------------------------------------------------------------------- stem
// layouts: the mel chunk S0 [Tin][128] (rows already preceded by the cached / zero frames), stage outputs [t][256][F]
const STEM0 = `
struct P { To: u32, wOff: u32, bOff: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x; if (n >= p.To * 256u * 65u) { return; }
  let t = n / (256u * 65u); let r = n % (256u * 65u); let c = r / 65u; let f = r % 65u;
  var v = bitcast<f32>(W[p.bOff + c]);
  for (var kt = 0u; kt < 3u; kt++) {
    for (var kf = 0u; kf < 3u; kf++) {
      let fi = i32(2u * f + kf) - 2;
      if (fi >= 0 && fi < 128) { v += bitcast<f32>(W[p.wOff + c * 9u + kt * 3u + kf]) * S[(2u * t + kt) * 128u + u32(fi)]; }
    }
  }
  Y[n] = max(v, 0.0);
}`;
const STEMDW = `
struct P { To: u32, Fi: u32, Fo: u32, wOff: u32, bOff: u32, npre: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> Pre: array<f32>;
@group(0) @binding(3) var<storage, read> W: array<u32>;
@group(0) @binding(4) var<storage, read_write> Y: array<f32>;
fn xin(ti: u32, c: u32, fi: i32) -> f32 {
  if (fi < 0 || fi >= i32(p.Fi)) { return 0.0; }
  if (ti < p.npre) { return select(0.0, Pre[c * p.Fi + u32(fi)], p.npre == 1u); }
  return X[((ti - p.npre) * 256u + c) * p.Fi + u32(fi)];
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x; if (n >= p.To * 256u * p.Fo) { return; }
  let t = n / (256u * p.Fo); let r = n % (256u * p.Fo); let c = r / p.Fo; let f = r % p.Fo;
  var v = bitcast<f32>(W[p.bOff + c]);
  for (var kt = 0u; kt < 3u; kt++) {
    for (var kf = 0u; kf < 3u; kf++) { v += bitcast<f32>(W[p.wOff + (kt * 3u + kf) * 256u + c]) * xin(2u * t + kt, c, i32(2u * f + kf) - 2); }
  }
  Y[n] = v;
}`;
const STEMPW = `
struct P { T: u32, F: u32, wOff: u32, bOff: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x; if (n >= p.T * 256u * p.F) { return; }
  let t = n / (256u * p.F); let r = n % (256u * p.F); let o = r / p.F; let f = r % p.F;
  var v = bitcast<f32>(W[p.bOff + o]);
  for (var ci = 0u; ci < 256u; ci++) { v += bitcast<f32>(W[p.wOff + o * 256u + ci]) * X[(t * 256u + ci) * p.F + f]; }
  Y[n] = max(v, 0.0);
}`;
export function stem0(g, s, wbuf, wOff, bOff, y, To) {
  g.runner.dispatch(g.pipeline('stt.stem0', () => STEM0), [bw(s), bw(wbuf), bw(y)], P().u32(To).u32(wOff / 4).u32(bOff / 4).u32(0).ab, [Math.ceil(To * 256 * 65 / 256)]);
}
export function stemdw(g, x, pre, wbuf, wOff, bOff, y, To, Fi, npre) {
  const Fo = (Fi + 3 - 3) / 2 + 1 | 0;
  g.runner.dispatch(g.pipeline('stt.stemdw', () => STEMDW), [bw(x), bw(pre), bw(wbuf), bw(y)],
    P().u32(To).u32(Fi).u32(Fo).u32(wOff / 4).u32(bOff / 4).u32(npre).u32(0).u32(0).ab, [Math.ceil(To * 256 * Fo / 256)]);
  return Fo;
}
export function stempw(g, x, wbuf, wOff, bOff, y, T, F) {
  g.runner.dispatch(g.pipeline('stt.stempw', () => STEMPW), [bw(x), bw(wbuf), bw(y)], P().u32(T).u32(F).u32(wOff / 4).u32(bOff / 4).ab, [Math.ceil(T * 256 * F / 256)]);
}

const ROWCOPY = `
struct P { n: u32, sOff: u32, dOff: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<f32>;
@group(0) @binding(2) var<storage, read_write> Dst: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) { let i = gid.x; if (i < p.n) { Dst[p.dOff + i] = S[p.sOff + i]; } }`;
export function rowcopy(g, src, sOff, dst, dOff, n) {
  g.runner.dispatch(g.pipeline('stt.rowcopy', () => ROWCOPY), [bw(src), bw(dst)], P().u32(n).u32(sOff).u32(dOff).u32(0).ab, [Math.ceil(n / 256)]);
}

// ------------------------------------------------------------------------------------------------------------------- decoder / joint
const JADD = `
struct P { M: u32, t0: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> E: array<f32>;
@group(0) @binding(2) var<storage, read> Gd: array<f32>;
@group(0) @binding(3) var<storage, read_write> Z: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= p.M * 640u) { return; }
  let m = i / 640u; let n = i % 640u;
  Z[i] = max(E[(p.t0 + m) * 640u + n] + Gd[n], 0.0);
}`;
export function jadd(g, e, gd, z, M, t0) {
  g.runner.dispatch(g.pipeline('stt.jadd', () => JADD), [bw(e), bw(gd), bw(z)], P().u32(M).u32(t0).u32(0).u32(0).ab, [Math.ceil(M * 640 / 256)]);
}

const ARGMAX = `
struct P { N: u32, ld: u32, outOff: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> L: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<u32>;
var<workgroup> bv: array<f32, 256>;
var<workgroup> bi: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let base = wg.x * p.ld;
  var v = -3.4e38; var ix = 0u;
  for (var n = li; n < p.N; n += 256u) { let x = L[base + n]; if (x > v) { v = x; ix = n; } }
  bv[li] = v; bi[li] = ix; workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { let ov = bv[li + s]; let oi = bi[li + s]; if (ov > bv[li] || (ov == bv[li] && oi < bi[li])) { bv[li] = ov; bi[li] = oi; } }
    workgroupBarrier();
  }
  if (li == 0u) { O[p.outOff + wg.x * 2u] = bi[0]; O[p.outOff + wg.x * 2u + 1u] = bitcast<u32>(bv[0]); }
}`;
export function argmax(g, logits, out, M, N, ld, outOff = 0) {
  g.runner.dispatch(g.pipeline('stt.argmax', () => ARGMAX), [bw(logits), bw(out)], P().u32(N).u32(ld).u32(outOff).u32(0).ab, [M]);
}

// x = [ emb row (q8g64r, dequantised) | the layer below's h ] and the layer's own h -> X [1280]
const LSTMX = `
struct P { tok: u32, fromEmb: u32, eOff: u32, esOff: u32, xOff: u32, hOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> W: array<u32>;
@group(0) @binding(2) var<storage, read> S: array<f32>;
@group(0) @binding(3) var<storage, read_write> X: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= 1280u) { return; }
  if (i < 640u) {
    if (p.fromEmb == 1u) {
      let code = W[p.eOff + p.tok * 160u + i / 4u];
      let q = unpack4x8snorm(code)[i % 4u];
      let si = p.tok * 10u + i / 64u;
      let s2 = unpack2x16float(W[p.esOff + si / 2u]);
      X[i] = q * 127.0 * select(s2.x, s2.y, (si & 1u) == 1u);
    } else { X[i] = S[p.xOff + i]; }
  } else { X[i] = S[p.hOff + i - 640u]; }
}`;
export function lstmx(g, wbuf, emb, state, x, o) {
  g.runner.dispatch(g.pipeline('stt.lstmx', () => LSTMX), [bw(wbuf), bw(state), bw(x)],
    P().u32(o.tok >>> 0).u32(o.fromEmb ? 1 : 0).u32(emb.off / 4).u32(emb.scales / 4).u32(o.xOff | 0).u32(o.hOff).u32(0).u32(0).ab, [5]);
}
// gates [2560] (i | f | g | o, bias added) -> c' = f c + i g, h' = o tanh(c'); state holds h at hOff, c at cOff
const LSTMC = `
struct P { hOff: u32, cOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Gt: array<f32>;
@group(0) @binding(2) var<storage, read_write> S: array<f32>;
fn sg(x: f32) -> f32 { return 1.0 / (1.0 + exp(-x)); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let j = gid.x; if (j >= 640u) { return; }
  let ig = sg(Gt[j]); let fg = sg(Gt[640u + j]); let gg = tanh(clamp(Gt[1280u + j], -20.0, 20.0)); let og = sg(Gt[1920u + j]);
  let c = fg * S[p.cOff + j] + ig * gg;
  S[p.cOff + j] = c; S[p.hOff + j] = og * tanh(clamp(c, -20.0, 20.0));
}`;
export function lstmcell(g, gates, state, hOff, cOff) {
  g.runner.dispatch(g.pipeline('stt.lstmcell', () => LSTMC), [bw(gates), bw(state)], P().u32(hOff).u32(cOff).u32(0).u32(0).ab, [3]);
}
