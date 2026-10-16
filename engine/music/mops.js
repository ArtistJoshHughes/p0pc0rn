// Music probe small kernels (ACE-Step 1.5 turbo): RMSNorm apply -> f16, 2-D casts, Oobleck Snake (plain, logscale params
// pre-exponentiated in the pack), and the turbo sampler step (Euler + DCW 'double' Haar correction, ACE's default).
// Engine rules kept: f32 statistics and residual streams; no shared-memory vectors here at all.
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 16) * 16 || 16 });
const wg2 = (n) => [Math.min(n, 65535), Math.ceil(n / 65535)];

// ------------------------------------------------------------------ y16[yOff + r*ldy + c] = x[xOff + r*ldx + c] * ST[(stOff + r)*2 + 1] * W[wOff + c]
const RMSAPPLY = `
enable f16;
struct P { rows: u32, C: u32, ldx: u32, ldy: u32, xOff: u32, yOff: u32, wOff: u32, stOff: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> ST: array<f32>;
@group(0) @binding(3) var<storage, read> W: array<f32>;
@group(0) @binding(4) var<storage, read_write> Y: array<f16>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let e = gid.x + gid.y * nw.x * 256u; if (e >= p.rows * p.C) { return; }
  let r = e / p.C; let c = e % p.C;
  Y[p.yOff + r * p.ldy + c] = f16(X[p.xOff + r * p.ldx + c] * ST[(p.stOff + r) * 2u + 1u] * W[p.wOff + c]);
}`;
/** a = {x:{buf, off(floats), ld}, stats:{buf, off(rows)}, w:{buf, off(floats)}, y:{buf, off(halves), ld}, rows, C} */
export function rmsapply16(g, a) {
  const n = a.rows * a.C;
  g.runner.dispatch(g.pipeline('m.rmsapply', () => RMSAPPLY), [bw(a.x.buf), bw(a.stats.buf), bw(a.w.buf), bw(a.y.buf)],
    P().u32(a.rows).u32(a.C).u32(a.x.ld || a.C).u32(a.y.ld || a.C).u32(a.x.off || 0).u32(a.y.off || 0).u32(a.w.off || 0).u32(a.stats.off || 0).ab, wg2(Math.ceil(n / 256)), n * 10 / g.rate.mem);
}

// ------------------------------------------------------------------ 2-D cast f32 -> f16 (or f16 -> f16 copy):  Y[yOff + r*ldy + c] = X[xOff + r*ldx + c]
const CAST = (src16) => `
enable f16;
struct P { rows: u32, C: u32, ldx: u32, ldy: u32, xOff: u32, yOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<${src16 ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<storage, read_write> Y: array<f16>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let e = gid.x + gid.y * nw.x * 256u; if (e >= p.rows * p.C) { return; }
  let r = e / p.C; let c = e % p.C;
  Y[p.yOff + r * p.ldy + c] = f16(X[p.xOff + r * p.ldx + c]);
}`;
/** a = {x:{buf, off(elements), ld}, y:{buf, off(halves), ld}, rows, C, src16} */
export function cast16(g, a) {
  const n = a.rows * a.C;
  g.runner.dispatch(g.pipeline('m.cast' + (a.src16 ? 16 : 32), () => CAST(!!a.src16)), [bw(a.x.buf), bw(a.y.buf)],
    P().u32(a.rows).u32(a.C).u32(a.x.ld || a.C).u32(a.y.ld || a.C).u32(a.x.off || 0).u32(a.y.off || 0).u32(0).u32(0).ab, wg2(Math.ceil(n / 256)), n * 6 / g.rate.mem);
}

// ------------------------------------------------------------------ Oobleck Snake1d (logscale): y = x + invb[c] * sin(a[c] * x)^2, a = exp(alpha), invb = 1/(exp(beta)+1e-9)
// X f32 or f16 [rows, C] channel-last -> Y f16 (may alias X when X is f16)
const SNAKE = (src16) => `
enable f16;
struct P { n: u32, C: u32, aOff: u32, bOff: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, ${src16 ? 'read_write' : 'read'}> X: array<${src16 ? 'vec4<f16>' : 'vec4<f32>'}>;
@group(0) @binding(2) var<storage, read> PR: array<f32>;
${src16 ? '' : '@group(0) @binding(3) var<storage, read_write> Y: array<vec4<f16>>;'}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let e = gid.x + gid.y * nw.x * 256u; if (e * 4u >= p.n) { return; }
  let c = (e * 4u) % p.C;
  let x = vec4<f32>(X[e]);
  let a = vec4<f32>(PR[p.aOff + c], PR[p.aOff + c + 1u], PR[p.aOff + c + 2u], PR[p.aOff + c + 3u]);
  let b = vec4<f32>(PR[p.bOff + c], PR[p.bOff + c + 1u], PR[p.bOff + c + 2u], PR[p.bOff + c + 3u]);
  let s = sin(a * x);
  ${src16 ? 'X' : 'Y'}[e] = vec4<f16>(x + b * s * s);
}`;
/** a = {x:{buf}, y:{buf} (omit for in-place f16), prm:{buf}, aOff, bOff (floats), rows, C (% 4 == 0), src16} */
export function snake(g, a) {
  const n = a.rows * a.C, src16 = !!a.src16;
  if (a.C % 4) throw new Error('snake: C % 4');
  const binds = [bw(a.x.buf), bw(a.prm.buf)]; if (!src16) binds.push(bw(a.y.buf));
  g.runner.dispatch(g.pipeline('m.snake' + (src16 ? 16 : 32), () => SNAKE(src16)), binds, P().u32(n).u32(a.C).u32(a.aOff).u32(a.bOff).ab,
    wg2(Math.ceil(n / 1024)), n * (src16 ? 4 : 6) / g.rate.mem + n * 40 / g.rate.mm);
}

// ------------------------------------------------------------------ turbo sampler step (generate_audio, infer_method 'ode', sampler 'euler', DCW double/haar)
// X f32 [T][64] (x_t), V f32 [T][64] (v_t, the proj_out output rows), last == 1: X = x - v * t (x0; DCW is an identity there because
// denoised == x0).  Otherwise xn = x - v * dt, den = x - v * t, Haar pairs (2i, 2i+1) along T (zero padded when T is odd):
//   lo = (a0 + a1) / sqrt2, hi = (a0 - a1) / sqrt2 for a = xn and for den;  lo' = lo_x + kl (lo_x - lo_y);  hi' = hi_x + kh (hi_x - hi_y)
//   xn0 = (lo' + hi') / sqrt2, xn1 = (lo' - hi') / sqrt2   with kl = 0.05 t, kh = 0.02 (1 - t)   (dcw_correction.py, dcw_primitives.py)
// and the next DiT input S16[r][128 + c] = f16(x) (the staging rows [ctx 128 | x 64]).
const STEP = `
enable f16;
struct P { T: u32, last: u32, t: f32, dt: f32, kl: f32, kh: f32, ldS: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> X: array<f32>;
@group(0) @binding(2) var<storage, read> V: array<f32>;
@group(0) @binding(3) var<storage, read_write> S: array<f16>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let e = gid.x; let np = (p.T + 1u) / 2u; if (e >= np * 64u) { return; }
  let i = e / 64u; let c = e % 64u; let r0 = 2u * i; let r1 = r0 + 1u; let has1 = r1 < p.T;
  let x0 = X[r0 * 64u + c]; let v0 = V[r0 * 64u + c];
  var x1 = 0.0; var v1 = 0.0; if (has1) { x1 = X[r1 * 64u + c]; v1 = V[r1 * 64u + c]; }
  var o0: f32; var o1: f32;
  if (p.last == 1u) { o0 = x0 - v0 * p.t; o1 = x1 - v1 * p.t; }
  else {
    let n0 = x0 - v0 * p.dt; var n1 = 0.0; if (has1) { n1 = x1 - v1 * p.dt; }
    let d0 = x0 - v0 * p.t; var d1 = 0.0; if (has1) { d1 = x1 - v1 * p.t; }
    let s = 0.70710678118654752;
    let xl = (n0 + n1) * s; let xh = (n0 - n1) * s; let yl = (d0 + d1) * s; let yh = (d0 - d1) * s;
    let l2 = xl + p.kl * (xl - yl); let h2 = xh + p.kh * (xh - yh);
    o0 = (l2 + h2) * s; o1 = (l2 - h2) * s;
  }
  X[r0 * 64u + c] = o0; S[r0 * p.ldS + 128u + c] = f16(o0);
  if (has1) { X[r1 * 64u + c] = o1; S[r1 * p.ldS + 128u + c] = f16(o1); }
}`;
/** a = {x:{buf}, v:{buf}, s:{buf}, T, last, t, dt, kl, kh, ldS = 192} */
export function aceStep(g, a) {
  const n = Math.ceil(a.T / 2) * 64;
  g.runner.dispatch(g.pipeline('m.aceStep', () => STEP), [bw(a.x.buf), bw(a.v.buf), bw(a.s.buf)],
    P().u32(a.T).u32(a.last ? 1 : 0).f32(a.t).f32(a.dt || 0).f32(a.kl || 0).f32(a.kh || 0).u32(a.ldS || 192).u32(0).ab, [Math.ceil(n / 64), 1], n * 24 / g.rate.mem);
}
