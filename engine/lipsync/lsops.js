// p0pc0rn lip-sync module: small kernels the MuseTalk UNet / whisper / face paths need that the core does not have.
//  gnStats   exact GroupNorm(32) statistics per FRAME for any C % 32 == 0 (core gnPartial needs C a power of two <= 512, one image):
//            pass 1 = per (frame, group, pixel chunk) Welford partials merged in shared memory (Chan), pass 2 = merge chunks ->
//            per-frame per-channel a = gamma * rstd, b = beta - mean * a  (layout [frame][a(C) | b(C)] f32)
//  rowStats  LayerNorm row statistics of an f32 [M, C] residual -> (mean, rstd) per row (two-pass in registers + shared reduce)
//  concat    channel concatenation of two HWC f16 tensors (UNet skip connections)
//  misc      f32 <-> f16 casts, row gather / scatter, RGB f32 -> RGBA8 (MuseTalk rounding), add vectors
// All shared-memory stores are whole scalars / vec4s written by ONE thread (Metal RMW rule of the core).
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 16) * 16 || 16 });
const dummies = new WeakMap();
function dummy(g, i) { let d = dummies.get(g); if (!d) { d = [0, 1, 2, 3, 4, 5].map((k) => g.buffer(256, 'ls.dummy' + k)); dummies.set(g, d); } return d[i]; }

// ------------------------------------------------------------------ GroupNorm statistics (per frame, any C % 32 == 0)
const GNP = `
enable f16;
struct P { HW: u32, C: u32, chunk: u32, J: u32, xOff: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f16>;
@group(0) @binding(2) var<storage, read_write> PT: array<vec4<f32>>;   // [(f*32+g)*J + j] = (n, mean, M2, 0)
var<workgroup> sn: array<f32, 256>;
var<workgroup> sm: array<f32, 256>;
var<workgroup> s2: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let j = wid.x; let g = wid.y; let f = wid.z; let cpg = p.C / 32u;
  let px0 = j * p.chunk; let px1 = min(p.HW, px0 + p.chunk); let n = (px1 - px0) * cpg;
  var cn = 0.0; var mean = 0.0; var m2 = 0.0;
  for (var e = t; e < n; e = e + 256u) {
    let px = px0 + e / cpg; let ch = g * cpg + e % cpg;
    let v = f32(X[p.xOff + (f * p.HW + px) * p.C + ch]);
    cn = cn + 1.0; let d = v - mean; mean = mean + d / cn; m2 = m2 + d * (v - mean);
  }
  sn[t] = cn; sm[t] = mean; s2[t] = m2;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (t < s) {
      let na = sn[t]; let nb = sn[t + s]; let nn = na + nb;
      if (nb > 0.0) { let d = sm[t + s] - sm[t]; sm[t] = sm[t] + d * (nb / nn); s2[t] = s2[t] + s2[t + s] + d * d * (na * nb / nn); sn[t] = nn; }
    }
    workgroupBarrier();
  }
  if (t == 0u) { PT[(f * 32u + g) * p.J + j] = vec4<f32>(sn[0], sm[0], s2[0], 0.0); }
}`;
const GNF = `
struct P { C: u32, J: u32, eps: f32, gOff: u32, bOff: u32, oOff: u32, B: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> PT: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> GB: array<f32>;
@group(0) @binding(3) var<storage, read_write> AB: array<f32>;
@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) g: u32) {
  let f = wid.x; var n = 0.0; var mean = 0.0; var m2 = 0.0;
  for (var j = 0u; j < p.J; j = j + 1u) {
    let q = PT[(f * 32u + g) * p.J + j];
    if (q.x > 0.0) { let nn = n + q.x; let d = q.y - mean; mean = mean + d * (q.x / nn); m2 = m2 + q.z + d * d * (n * q.x / nn); n = nn; }
  }
  let rs = inverseSqrt(m2 / max(n, 1.0) + p.eps); let cpg = p.C / 32u; let o = p.oOff + f * 2u * p.C;
  for (var c = g * cpg; c < (g + 1u) * cpg; c = c + 1u) { let a = GB[p.gOff + c] * rs; AB[o + c] = a; AB[o + p.C + c] = GB[p.bOff + c] - mean * a; }
}`;
export const gnPartBytesB = (B, HW, chunk = 2048) => B * 32 * Math.ceil(HW / chunk) * 16;
/** x {buf, off(bytes)} HWC f16 [B][HW][C]; gb {buf, gOff, bOff} (floats: gamma, beta f32); ab {buf, off(floats)} -> [B][2C] f32; part scratch >= gnPartBytesB */
export function gnStats(g, a) {
  const chunk = a.chunk || 2048, J = Math.ceil(a.HW / chunk);
  if (a.C % 32) throw new Error('gnStats: C % 32');
  if (a.x.off % 2) throw new Error('gnStats: x offset');
  g.runner.dispatch(g.pipeline('ls.gnp', () => GNP), [bw(a.x.buf), bw(a.part)], P().u32(a.HW).u32(a.C).u32(chunk).u32(J).u32((a.x.off || 0) / 2).ab,
    [J, 32, a.B], a.B * a.HW * a.C * 4 / g.rate.mem);
  g.runner.dispatch(g.pipeline('ls.gnf', () => GNF), [bw(a.part), bw(a.gb.buf), bw(a.ab.buf)],
    P().u32(a.C).u32(J).f32(a.eps).u32(a.gb.gOff).u32(a.gb.bOff).u32(a.ab.off || 0).u32(a.B).ab, [a.B, 1, 1], 1e-4);
}

// ------------------------------------------------------------------ LayerNorm row statistics of an f32 matrix
const RST = `
struct P { M: u32, C: u32, ld: u32, xOff: u32, eps: f32, oOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> ST: array<f32>;
var<workgroup> rd: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let row = wid.x + wid.y * 65535u; if (row >= p.M) { return; }
  let b = p.xOff + row * p.ld;
  var s = 0.0; for (var c = t; c < p.C; c = c + 64u) { s = s + X[b + c]; }
  rd[t] = s; workgroupBarrier();
  for (var k = 32u; k > 0u; k = k >> 1u) { if (t < k) { rd[t] = rd[t] + rd[t + k]; } workgroupBarrier(); }
  let mean = rd[0] / f32(p.C); workgroupBarrier();
  var q = 0.0; for (var c = t; c < p.C; c = c + 64u) { let d = X[b + c] - mean; q = q + d * d; }
  rd[t] = q; workgroupBarrier();
  for (var k = 32u; k > 0u; k = k >> 1u) { if (t < k) { rd[t] = rd[t] + rd[t + k]; } workgroupBarrier(); }
  if (t == 0u) { ST[p.oOff + row * 2u] = mean; ST[p.oOff + row * 2u + 1u] = inverseSqrt(rd[0] / f32(p.C) + p.eps); }
}`;
/** x {buf, off(floats)} f32 [M][ld]; out {buf, off(floats)} -> [M][2] (mean, rstd) */
export function rowStats(g, a) {
  const wx = Math.min(a.M, 65535), wy = Math.ceil(a.M / 65535);
  g.runner.dispatch(g.pipeline('ls.rst', () => RST), [bw(a.x.buf), bw(a.out.buf)],
    P().u32(a.M).u32(a.C).u32(a.ld || a.C).u32(a.x.off || 0).f32(a.eps).u32(a.out.off || 0).ab, [wx, wy], a.M * a.C * 8 / g.rate.mem);
}

// ------------------------------------------------------------------ element-wise / layout
const EW = `
enable f16;
struct P { op: u32, n: u32, a: u32, b: u32, c: u32, d: u32, e: u32, f: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> XF: array<f32>;
@group(0) @binding(2) var<storage, read> XH: array<vec4<f16>>;
@group(0) @binding(3) var<storage, read> XH2: array<vec4<f16>>;
@group(0) @binding(4) var<storage, read_write> YF: array<f32>;
@group(0) @binding(5) var<storage, read_write> YH: array<vec4<f16>>;
@group(0) @binding(6) var<storage, read_write> YU: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) {
    switch p.op {
      case 0u: {   // concat (vec4 units): rows m, a = C1/4, b = C2/4 -> YH[m*(a+b) + q]
        let w = p.a + p.b; let m = i / w; let q = i % w;
        if (q < p.a) { YH[i] = XH[m * p.a + q]; } else { YH[i] = XH2[m * p.b + q - p.a]; } }
      case 1u: {   // f32 -> f16 (vec4 units): YH[c/4 + i] = XF[a + 4i ..]
        let s = p.a + i * 4u; YH[p.c / 4u + i] = vec4<f16>(vec4<f32>(XF[s], XF[s + 1u], XF[s + 2u], XF[s + 3u])); }
      case 2u: {   // rows gather f32: YF[(r)*b + c] = XF[(src row)*d + e + c], src row = a + r*f? (use c = row stride in, d = row stride out)
        let cols = p.a; let r = i / cols; let col = i % cols; YF[p.e + r * p.d + col] = XF[p.b + r * p.c + col]; }
      case 3u: {   // RGB f32 [pix][4] (decoder out, x in [-1,1]) -> RGBA8, MuseTalk rule round(255 * clamp(x/2 + 0.5, 0, 1)) (ties to even)
        let r = u32(round(255.0 * clamp(XF[i * 4u] * 0.5 + 0.5, 0.0, 1.0)));
        let g = u32(round(255.0 * clamp(XF[i * 4u + 1u] * 0.5 + 0.5, 0.0, 1.0)));
        let b = u32(round(255.0 * clamp(XF[i * 4u + 2u] * 0.5 + 0.5, 0.0, 1.0)));
        YU[i] = r | (g << 8u) | (b << 16u) | (255u << 24u); }
      case 4u: {   // f16 -> f32 (vec4 units)
        let v = vec4<f32>(XH[p.a / 4u + i]); let o = p.c + i * 4u; YF[o] = v.x; YF[o + 1u] = v.y; YF[o + 2u] = v.z; YF[o + 3u] = v.w; }
      default: {}
    }
  }
}`;
const EWOPS = { concat: 0, f32to16: 1, gather32: 2, rgba8: 3, f16to32: 4 };
/** a = {op, n, xf, xh, xh2, yf, yh, yu: {buf, off}, a..e: u32, f: f32} */
export function ew(g, a) {
  const b = (t, i) => (t ? bw(t.buf, t.off || 0, t.size) : bw(dummy(g, i)));
  g.runner.dispatch(g.pipeline('ls.ew', () => EW), [b(a.xf, 0), b(a.xh, 1), b(a.xh2, 2), b(a.yf, 3), b(a.yh, 4), b(a.yu, 5)],
    P().u32(EWOPS[a.op]).u32(a.n).u32(a.a || 0).u32(a.b || 0).u32(a.c || 0).u32(a.d || 0).u32(a.e || 0).f32(a.f || 0).ab,
    [Math.min(Math.ceil(a.n / 256), 8192), 1], a.n * 16 / g.rate.mem);
}
/** channel concat of HWC f16 [M][C1] and [M][C2] -> [M][C1 + C2] (C1, C2 % 4 == 0) */
export function concat(g, a) { ew(g, { op: 'concat', n: a.M * (a.C1 + a.C2) / 4, xh: { buf: a.x1 }, xh2: { buf: a.x2 }, yh: { buf: a.y }, a: a.C1 / 4, b: a.C2 / 4 }); }
/** f32 [n] (n % 4 == 0) at xOff floats -> f16 at yOff halves */
export function f32to16(g, x, y, n, xOff = 0, yOff = 0) { ew(g, { op: 'f32to16', n: n / 4, xf: { buf: x }, yh: { buf: y }, a: xOff, c: yOff }); }
export function f16to32(g, x, y, n, xOff = 0, yOff = 0) { ew(g, { op: 'f16to32', n: n / 4, xh: { buf: x }, yf: { buf: y }, a: xOff, c: yOff }); }
export function rgba8(g, x, y, pix) { ew(g, { op: 'rgba8', n: pix, xf: { buf: x }, yu: { buf: y } }); }
