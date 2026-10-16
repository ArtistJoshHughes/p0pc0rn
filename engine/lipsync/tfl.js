// A tiny TFLite-graph interpreter on WebGPU for the two MediaPipe face models (Apache-2.0): BlazeFace short-range and the Face Landmarker
// mesh.  The graph comes from tools/tfl_convert.py (official ai-edge-litert schema; DEQUANTIZE folded): ops CONV_2D, DEPTHWISE_CONV_2D,
// PRELU, RELU, ADD, MAX_POOL_2D, PAD, CONCATENATION, RESHAPE, LOGISTIC, NHWC, fp16 weights, f32 activations, a batch of N images.
// Direct kernels (one output element per thread): the models are 30-40 MFLOP per image, so simplicity beats tiling here.
'use strict';
import { P } from '../core/gpu.js';

const bw = (b) => ({ buffer: b, offset: 0, size: Math.floor(b._pf / 16) * 16 });
const K = {};
K.conv = `
enable f16;
struct P { N: u32, Hi: u32, Wi: u32, Ci: u32, Ho: u32, Wo: u32, Co: u32, kh: u32, kw: u32, sh: u32, sw: u32, pt: u32, pl: u32, wOff: u32, bOff: u32, dw: u32, act: u32, i0: u32, n: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<f16>;
@group(0) @binding(3) var<storage, read> F: array<f32>;
@group(0) @binding(4) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = p.i0 + gid.x + gid.y * 65535u * 64u; if (idx >= p.n) { return; }
  let co = idx % p.Co; var r = idx / p.Co; let ox = r % p.Wo; r = r / p.Wo; let oy = r % p.Ho; let nb = r / p.Ho;
  var s = F[p.bOff + co];
  for (var ky = 0u; ky < p.kh; ky = ky + 1u) {
    let iy = i32(oy * p.sh + ky) - i32(p.pt); if (iy < 0 || iy >= i32(p.Hi)) { continue; }
    for (var kx = 0u; kx < p.kw; kx = kx + 1u) {
      let ix = i32(ox * p.sw + kx) - i32(p.pl); if (ix < 0 || ix >= i32(p.Wi)) { continue; }
      let xb = ((nb * p.Hi + u32(iy)) * p.Wi + u32(ix)) * p.Ci;
      if (p.dw == 1u) { s = s + X[xb + co] * f32(W[p.wOff + (ky * p.kw + kx) * p.Co + co]); }
      else { let wb = p.wOff + ((co * p.kh + ky) * p.kw + kx) * p.Ci; for (var c = 0u; c < p.Ci; c = c + 1u) { s = s + X[xb + c] * f32(W[wb + c]); } }
    }
  }
  if (p.act == 1u) { s = max(s, 0.0); }
  Y[idx] = s;
}`;
K.ew = `
struct P { op: u32, n: u32, C: u32, aOff: u32, p0: u32, p1: u32, p2: u32, p3: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B: array<f32>;
@group(0) @binding(3) var<storage, read> F: array<f32>;
@group(0) @binding(4) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) {
    let x = A[i];
    switch p.op {
      case 0u: { Y[i] = max(x, 0.0); }                                                // RELU
      case 1u: { Y[i] = select(F[p.aOff + i % p.C] * x, x, x >= 0.0); }               // PRELU (alpha per channel)
      case 2u: { Y[i] = x + B[i]; }                                                   // ADD
      case 3u: { Y[i] = max(x + B[i], 0.0); }                                         // ADD + RELU
      case 4u: { Y[i] = 1.0 / (1.0 + exp(-x)); }                                      // LOGISTIC
      default: {}
    }
  }
}`;
K.pool = `
struct P { N: u32, Hi: u32, Wi: u32, C: u32, Ho: u32, Wo: u32, fh: u32, fw: u32, sh: u32, sw: u32, pt: u32, pl: u32, n: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var idx = gid.x; idx < p.n; idx = idx + nw.x * 256u) {
    let c = idx % p.C; var r = idx / p.C; let ox = r % p.Wo; r = r / p.Wo; let oy = r % p.Ho; let nb = r / p.Ho;
    var m = -3.4e38;
    for (var ky = 0u; ky < p.fh; ky = ky + 1u) { let iy = i32(oy * p.sh + ky) - i32(p.pt); if (iy < 0 || iy >= i32(p.Hi)) { continue; }
      for (var kx = 0u; kx < p.fw; kx = kx + 1u) { let ix = i32(ox * p.sw + kx) - i32(p.pl); if (ix < 0 || ix >= i32(p.Wi)) { continue; }
        m = max(m, X[((nb * p.Hi + u32(iy)) * p.Wi + u32(ix)) * p.C + c]); } }
    Y[idx] = m;
  }
}`;
K.pad = `
struct P { N: u32, Hi: u32, Wi: u32, Ci: u32, Ho: u32, Wo: u32, Co: u32, t: u32, l: u32, c0: u32, n: u32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var idx = gid.x; idx < p.n; idx = idx + nw.x * 256u) {
    let c = idx % p.Co; var r = idx / p.Co; let x = r % p.Wo; r = r / p.Wo; let y = r % p.Ho; let nb = r / p.Ho;
    let iy = i32(y) - i32(p.t); let ix = i32(x) - i32(p.l); let ic = i32(c) - i32(p.c0);
    var v = 0.0;
    if (iy >= 0 && iy < i32(p.Hi) && ix >= 0 && ix < i32(p.Wi) && ic >= 0 && ic < i32(p.Ci)) { v = X[((nb * p.Hi + u32(iy)) * p.Wi + u32(ix)) * p.Ci + u32(ic)]; }
    Y[idx] = v;
  }
}`;
K.cat = `
struct P { n: u32, inner: u32, outer: u32, ldo: u32, o0: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) { let o = i / p.inner; let j = i % p.inner; Y[o * p.ldo + p.o0 + j] = X[i]; }
}`;
// image -> NHWC f32 tensor through an affine map (output pixel centre -> source position), bilinear, clamp-to-edge or constant outside
K.warp = `
struct P { W: u32, H: u32, So: u32, n: u32, a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, lo: f32, hi: f32, mode: u32, img: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> IM: array<u32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
fn px(x: i32, y: i32) -> vec3<f32> {
  if (p.mode == 1u && (x < 0 || y < 0 || x >= i32(p.W) || y >= i32(p.H))) { return vec3<f32>(0.0); }
  let v = IM[u32(clamp(y, 0, i32(p.H) - 1)) * p.W + u32(clamp(x, 0, i32(p.W) - 1))];
  return vec3<f32>(f32(v & 255u), f32((v >> 8u) & 255u), f32((v >> 16u) & 255u)) / 255.0;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + gid.y * 65535u * 64u; if (i >= p.n) { return; }
  let ox = f32(i % p.So) + 0.5; let oy = f32(i / p.So) + 0.5;
  let sx = p.a * ox + p.b * oy + p.c - 0.5; let sy = p.d * ox + p.e * oy + p.f - 0.5;
  let x0 = i32(floor(sx)); let y0 = i32(floor(sy)); let fx = sx - floor(sx); let fy = sy - floor(sy);
  let v = mix(mix(px(x0, y0), px(x0 + 1, y0), fx), mix(px(x0, y0 + 1), px(x0 + 1, y0 + 1), fx), fy);
  let o = (p.img * p.So * p.So + i) * 3u; let r = v * (p.hi - p.lo) + p.lo;
  Y[o] = r.x; Y[o + 1u] = r.y; Y[o + 2u] = r.z;
}`;

export class TflGraph {
  /** graph: parsed JSON; w16 / w32: {buf, off(elements)} GPU views of the shard tensors */
  constructor(gpu, graph, w16, w32) {
    this.g = gpu; this.G = graph; this.w16 = w16; this.w32 = w32;
    this.last = new Map(); graph.ops.forEach((o, i) => o.in.forEach((t) => this.last.set(t, i)));
    for (const o of graph.outputs) this.last.set(o, Infinity);
  }
  numel(t) { return this.G.tensors[t].shape.slice(1).reduce((a, b) => a * b, 1); }
  shape(t) { return this.G.tensors[t].shape; }
  /** run on input buffer (f32 NHWC [N][...]) -> Map(outputTensorId -> GPUBuffer) (caller frees) */
  run(input, N) {
    const g = this.g, live = new Map(), alias = new Map();
    live.set(this.G.inputs[0], input);
    const get = (t) => live.get(alias.get(t) ?? t);
    const pipe = (k) => g.pipeline('tfl.' + k, () => K[k]);
    const disp = (k, binds, pr, n, wgs = 256) => g.runner.dispatch(pipe(k), binds, pr, wgs === 64 ? [Math.min(Math.ceil(n / 64), 65535), Math.ceil(Math.ceil(n / 64) / 65535)] : [Math.min(Math.ceil(n / 256), 4096), 1], n * 1e-10);
    const dummy = this._d || (this._d = g.buffer(256, 'tfl.dummy'));
    this.G.ops.forEach((o, i) => {
      const outT = o.out[0], osh = this.shape(outT), n = N * this.numel(outT);
      if (o.op === 'RESHAPE') { alias.set(outT, alias.get(o.in[0]) ?? o.in[0]); }
      else {
        const y = g.buffer(n * 4, 'tfl.t' + outT); live.set(outT, y);
        const x = get(o.in[0]), ish = this.shape(o.in[0]);
        if (o.op === 'CONV_2D' || o.op === 'DEPTHWISE_CONV_2D') {
          const dw = o.op === 'DEPTHWISE_CONV_2D', ws = o.w.k.shape, kh = ws[1], kw = ws[2], { sh, sw } = o.opts;
          const [Hi, Wi, Ci] = ish.slice(1), [Ho, Wo, Co] = osh.slice(1);
          let pt = 0, pl = 0;
          if (o.opts.pad === 'SAME') { pt = Math.floor(Math.max((Ho - 1) * sh + kh - Hi, 0) / 2); pl = Math.floor(Math.max((Wo - 1) * sw + kw - Wi, 0) / 2); }
          const act = o.opts.act === 'RELU' ? 1 : 0;
          if (o.opts.act !== 'NONE' && o.opts.act !== 'RELU') throw new Error('tfl: act ' + o.opts.act);
          const per = 2 * kh * kw * (dw ? 1 : Ci), chunk = Math.max(4096, Math.floor(g.rate.mm * 0.02 * g.opts.maxDispatchSeconds / per / 64) * 64);
          for (let i0 = 0; i0 < n; i0 += chunk) {
            const m = Math.min(chunk, n - i0);
            disp('conv', [bw(x), bw(this.w16.buf), bw(this.w32.buf), bw(y)],
              P().u32(N).u32(Hi).u32(Wi).u32(Ci).u32(Ho).u32(Wo).u32(Co).u32(kh).u32(kw).u32(sh).u32(sw).u32(pt).u32(pl)
                .u32(this.w16.off + o.w.k.off).u32(this.w32.off + (o.w.b ? o.w.b.off : 0)).u32(dw ? 1 : 0).u32(act).u32(i0).u32(i0 + m).ab, m, 64);
          }
        } else if (o.op === 'PRELU') {
          disp('ew', [bw(x), bw(dummy), bw(this.w32.buf), bw(y)], P().u32(1).u32(n).u32(ish[3]).u32(this.w32.off + o.w.alpha.off).ab, n);
        } else if (o.op === 'RELU' || o.op === 'LOGISTIC') {
          disp('ew', [bw(x), bw(dummy), bw(dummy), bw(y)], P().u32(o.op === 'RELU' ? 0 : 4).u32(n).u32(1).u32(0).ab, n);
        } else if (o.op === 'ADD') {
          const b = get(o.in[1]); if (this.numel(o.in[1]) !== this.numel(o.in[0])) throw new Error('tfl: broadcast ADD');
          disp('ew', [bw(x), bw(b), bw(dummy), bw(y)], P().u32(o.opts.act === 'RELU' ? 3 : 2).u32(n).u32(1).u32(0).ab, n);
        } else if (o.op === 'MAX_POOL_2D') {
          const [Hi, Wi, C] = ish.slice(1), [Ho, Wo] = osh.slice(1), { fh, fw, sh, sw } = o.opts;
          let pt = 0, pl = 0; if (o.opts.pad === 'SAME') { pt = Math.floor(Math.max((Ho - 1) * sh + fh - Hi, 0) / 2); pl = Math.floor(Math.max((Wo - 1) * sw + fw - Wi, 0) / 2); }
          disp('pool', [bw(x), bw(y)], P().u32(N).u32(Hi).u32(Wi).u32(C).u32(Ho).u32(Wo).u32(fh).u32(fw).u32(sh).u32(sw).u32(pt).u32(pl).u32(n).ab, n);
        } else if (o.op === 'PAD') {
          const pd = o.opts.pads; if (pd[0][0] || pd[0][1]) throw new Error('tfl: batch pad');
          disp('pad', [bw(x), bw(y)], P().u32(N).u32(ish[1]).u32(ish[2]).u32(ish[3]).u32(osh[1]).u32(osh[2]).u32(osh[3]).u32(pd[1][0]).u32(pd[2][0]).u32(pd[3][0]).u32(n).ab, n);
        } else if (o.op === 'CONCATENATION') {
          let ax = o.opts.axis; if (ax < 0) ax += osh.length;
          const inner = (s) => s.slice(ax).reduce((a, b) => a * b, 1), ldo = inner(osh);
          let o0 = 0;
          for (const t of o.in) {
            const s = this.shape(t), inn = inner(s), tot = N * this.numel(t);
            disp('cat', [bw(get(t)), bw(y)], P().u32(tot).u32(inn).u32(tot / inn).u32(ldo).u32(o0).ab, tot); o0 += inn;
          }
        } else throw new Error('tfl: op ' + o.op);
      }
      for (const t of o.in) {   // free tensors after their last use (never the graph input / outputs)
        const real = alias.get(t) ?? t;
        if (this.last.get(t) === i && real !== this.G.inputs[0] && ![...alias.entries()].some(([k, v]) => v === real && (this.last.get(k) ?? -1) > i)) {
          const b = live.get(real); if (b && b !== input) { if (!g.recycling) g.runner.flush(); g.free(b); live.delete(real); }   // v002: a recycled buffer is not destroyed: no flush (was one per op)
        }
      }
    });
    const res = new Map();
    for (const t of this.G.outputs) res.set(t, get(t));
    g.runner.flush(); for (const [t, b] of live) if (![...res.values()].includes(b) && b !== input) g.free(b);
    return res;
  }
}

/** frames RGBA8 (u32 per pixel) GPU buffer -> NHWC f32 tensor slot `img` of size So x So: affine (a b c; d e f) maps output pixel centre
 *  (x+0.5, y+0.5) to source coordinates (pixel centres at +0.5); lo/hi value range; mode 0 clamp-to-edge, 1 zero outside (letterbox) */
export function warp(g, im, W, H, y, img, So, A, lo, hi, mode) {
  const n = So * So;
  g.runner.dispatch(g.pipeline('tfl.warp', () => K.warp), [bw(im), bw(y)],
    P().u32(W).u32(H).u32(So).u32(n).f32(A[0]).f32(A[1]).f32(A[2]).f32(A[3]).f32(A[4]).f32(A[5]).f32(lo).f32(hi).u32(mode).u32(img).ab,
    [Math.min(Math.ceil(n / 64), 65535), Math.ceil(Math.ceil(n / 64) / 65535)], n * 1e-9);
}
