// Gemma 4 vision tower kernels (p0pc0rn LLM module, image questions only).  f32 residual, f16 activations, f32 accumulate.
//   vqkrope  qkv f16 [np][2304] (q|k|v, 12 heads x 64) -> per-head RMSNorm (q,k weighted; v no scale) + multidim 2-D RoPE (theta 100,
//            x-dim pairs (e, e+16) in channels 0..31, y-dim pairs in 32..63) -> Q/K/V f16 token-major [np][12][64] for attnD
//   vpool    exact average-pool patches by a k x k grid, x sqrt(hidden) (f32, like transformers 5.14), -> f32 [out][C]
//   vclamp   elementwise clamp of an f16 activation to [lo, hi] (clipped linears, only when the checkpoint's bounds are finite)
//   visionRope  the 2-D rope table (JS)
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });

// one workgroup per (patch, head); 192 threads = 3 parts (q/k/v) x 64 dims
const VQKROPE = `
enable f16;
struct P { np: u32, eps: f32, qnOff: u32, knOff: u32, ldx: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<u32>;
@group(0) @binding(2) var<storage, read> NW: array<f32>;
@group(0) @binding(3) var<storage, read> RP: array<f32>;     // [np][64] = cos_x[16], sin_x[16], cos_y[16], sin_y[16]
@group(0) @binding(4) var<storage, read_write> Q: array<u32>;
@group(0) @binding(5) var<storage, read_write> KO: array<u32>;
@group(0) @binding(6) var<storage, read_write> VO: array<u32>;
var<workgroup> nv: array<f32, 192>;   // normed (and for q/k weighted) value per (part, dim)
var<workgroup> rr: array<f32, 3>;
@compute @workgroup_size(192)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let ph = wid.x; let pt = ph / 12u; let h = ph % 12u; if (pt >= p.np) { return; }
  let part = t / 64u; let d = t % 64u;
  let xb = (pt * p.ldx + part * 768u + h * 64u) / 2u;
  let v2 = unpack2x16float(X[xb + d / 2u]); let val = select(v2.x, v2.y, (d & 1u) == 1u);
  nv[part * 64u + d] = val; workgroupBarrier();
  if (d == 0u) { var ss = 0.0; for (var i = 0u; i < 64u; i = i + 1u) { ss = ss + nv[part * 64u + i] * nv[part * 64u + i]; } rr[part] = inverseSqrt(ss / 64.0 + p.eps); }
  workgroupBarrier();
  var a = nv[part * 64u + d] * rr[part];
  if (part < 2u) { a = a * NW[select(p.qnOff, p.knOff, part == 1u) + d]; }
  nv[part * 64u + d] = a; workgroupBarrier();
  // rope on q, k only (part < 2)
  var out = a;
  if (part < 2u) {
    let half = d / 32u; let dh = d % 32u; let e = dh % 16u; let partner = select(d + 16u, d - 16u, dh >= 16u);
    let pv = nv[part * 64u + partner];
    let rb = pt * 64u + half * 32u + e; let c = RP[rb]; let sn = RP[rb + 16u];   // table [np][axis][cos x16 | sin x16]
    if (dh < 16u) { out = a * c - pv * sn; } else { out = a * c + pv * sn; }
    nv[part * 64u + d] = out;
  }
  workgroupBarrier();
  if ((d & 1u) == 0u) {
    let o = pack2x16float(vec2<f32>(nv[part * 64u + d], nv[part * 64u + d + 1u]));
    let idx = (ph * 64u + d) / 2u;
    if (part == 0u) { Q[idx] = o; } else if (part == 1u) { KO[idx] = o; } else { VO[idx] = o; }
  }
}`;
/** x: qkv f16 [np][ldx] (q|k|v at 0/768/1536); norm: {buf} q_norm[64] at qn, k_norm[64] at kn (float offsets); rope [np][64];
 *  q/k/v out f16 [np*12][64] token-major (head-contiguous) for attnD (ld 768, hS 64, Dr 64) */
export function vqkrope(g, a) {
  g.runner.dispatch(g.pipeline('vqkrope', () => VQKROPE), [bw(a.x.buf, a.x.off || 0), bw(a.norm.buf), bw(a.rope.buf), bw(a.q.buf), bw(a.k.buf), bw(a.v.buf)],
    P().u32(a.np).f32(a.eps || 1e-6).u32(a.qn).u32(a.kn).u32(a.x.ld).u32(0).u32(0).u32(0).ab, [a.np * 12, 1], a.np * 3e-6);
}

const VPOOL = `
enable f16;
struct P { outLen: u32, k: u32, C: u32, cols: u32, maxxDivK: u32, scale: f32, np: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<u32>;
@group(0) @binding(2) var<storage, read> POS: array<i32>;    // [np][2] grid (x, y); -1 = padding
@group(0) @binding(3) var<storage, read_write> O: array<f32>;   // f32 [outLen][C]
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let oi = wid.x; let C2 = p.C / 2u; let k2 = f32(p.k * p.k);
  for (var c = t; c < C2; c = c + 256u) {
    var acc = vec2<f32>(0.0);
    for (var j = 0u; j < p.np; j = j + 1u) {
      let px = POS[j * 2u]; if (px < 0) { continue; }
      let py = POS[j * 2u + 1u];
      if ((u32(px) / p.k) + p.maxxDivK * (u32(py) / p.k) == oi) { acc = acc + vec2<f32>(unpack2x16float(X[j * C2 + c])); }
    }
    let v = acc / k2 * p.scale; O[oi * p.C + 2u * c] = v.x; O[oi * p.C + 2u * c + 1u] = v.y;
  }
}`;
export function vpool(g, a) {
  g.runner.dispatch(g.pipeline('vpool', () => VPOOL), [bw(a.x.buf), bw(a.pos.buf), bw(a.o.buf)],
    P().u32(a.outLen).u32(a.k).u32(a.C).u32(a.C).u32(a.maxxDivK).f32(a.scale).u32(a.np).u32(0).ab, [a.outLen, 1], a.outLen * a.np * a.C * 2 / g.rate.mem);
}

const VCLAMP = `
enable f16;
struct P { n: u32, lo: f32, hi: f32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> X: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) { let v = unpack2x16float(X[i]); X[i] = pack2x16float(clamp(v, vec2<f32>(p.lo), vec2<f32>(p.hi))); }
}`;
export function vclamp(g, a) {
  const n = a.n / 2;
  g.runner.dispatch(g.pipeline('vclamp', () => VCLAMP), [bw(a.x.buf, a.x.off || 0)], P().u32(n).f32(a.lo).f32(a.hi).u32(0).ab, [Math.min(4096, Math.ceil(n / 256)), 1], n * 6 / g.rate.mem);
}

/** 2-D rope table [np][64] = cos_x[16], sin_x[16], cos_y[16], sin_y[16]; inv_freq[d]=1/theta^(2d/32); angle=inv_freq*max(pos,0) */
export function visionRope(pos, theta) {
  const f = Math.fround, inv = Array.from({ length: 16 }, (_, d) => f(1 / f(Math.pow(theta, f((2 * d) / 32)))));
  const out = new Float32Array(pos.length * 64);
  for (let i = 0; i < pos.length; i++) {
    const [px, py] = pos[i], o = i * 64;
    for (let d = 0; d < 16; d++) { const ax = f(f(Math.max(px, 0)) * inv[d]); out[o + d] = Math.cos(ax); out[o + 16 + d] = Math.sin(ax);
      const ay = f(f(Math.max(py, 0)) * inv[d]); out[o + 32 + d] = Math.cos(ay); out[o + 48 + d] = Math.sin(ay); }
  }
  return out;
}

const GELUMUL = `
enable f16;
struct P { n: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> A: array<u32>;
@group(0) @binding(2) var<storage, read> B: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<u32>;
fn gelu(x: f32) -> f32 { return x * 0.5 * (1.0 + tanh(clamp(0.7978845608028654 * (x + 0.044715 * x * x * x), -15.0, 15.0))); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) { let a = unpack2x16float(A[i]); let b = unpack2x16float(B[i]); Y[i] = pack2x16float(vec2<f32>(gelu(a.x) * b.x, gelu(a.y) * b.y)); }
}`;
/** y16 = gelu_tanh(a16) * b16 (n values, n even) */
export function geluMul(g, a) {
  const n = a.n / 2;
  g.runner.dispatch(g.pipeline('vgelumul', () => GELUMUL), [bw(a.a.buf), bw(a.b.buf), bw(a.y.buf)], P().u32(n).u32(0).u32(0).u32(0).ab, [Math.min(4096, Math.ceil(n / 256)), 1], n * 16 / g.rate.mem);
}

// clamp a column block [c0, c0+n) of M rows (row stride ld), in place or src -> dst; f16 (pairs; c0, n, ld even) or f32
const VCLAMPROWS = (f32) => `
enable f16;
struct P { M: u32, ld: u32, c0: u32, n: u32, lo: f32, hi: f32, ldd: u32, dc0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<${f32 ? 'f32' : 'u32'}>;
@group(0) @binding(2) var<storage, read_write> Y: array<${f32 ? 'f32' : 'u32'}>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let w = ${f32 ? 'p.n' : 'p.n / 2u'}; let tot = p.M * w;
  for (var i = gid.x; i < tot; i = i + nw.x * 256u) {
    let m = i / w; let c = i % w;
    ${f32 ? 'let si = m * p.ld + p.c0 + c; let di = m * p.ldd + p.dc0 + c; Y[di] = clamp(S[si], p.lo, p.hi);'
          : 'let si = (m * p.ld + p.c0) / 2u + c; let di = (m * p.ldd + p.dc0) / 2u + c; Y[di] = pack2x16float(clamp(unpack2x16float(S[si]), vec2<f32>(p.lo), vec2<f32>(p.hi)));'}
  }
}`;
/** clamp copy: rows of x {buf, ld} columns [c0, c0+n) -> y {buf, ld, c0} columns [y.c0, y.c0+n) (x and y must be different buffers); f32 flag.
 *  Infinite bounds still copy (clamp to +-3e38). */
export function vclampRows(g, a) {
  const f32 = !!a.f32, y = a.y, w = f32 ? a.n : a.n / 2, tot = a.M * w;
  if (!y || y.buf === a.x.buf) throw new Error('vclampRows: needs a separate destination buffer');
  const pipe = g.pipeline('vclamprows' + (f32 ? '32' : '16'), () => VCLAMPROWS(f32));
  g.runner.dispatch(pipe, [bw(a.x.buf), bw(y.buf)], P().u32(a.M).u32(a.x.ld).u32(a.c0 || 0).u32(a.n).f32(Math.max(a.lo, -3.0e38)).f32(Math.min(a.hi, 3.0e38)).u32(y.ld || a.x.ld).u32(y.c0 || 0).ab,
    [Math.min(4096, Math.ceil(tot / 256)), 1], tot * 8 / g.rate.mem);
}
