// p0voice_gpu.js - the WebGPU backend, in the p0pc0rn kernel style: pure JS + WGSL, every buffer made once at load (activations sized
// for the longest clause / window; nothing is created or destroyed per clause or chunk), a pipeline cache, a ring of uniform
// buffers (one 256-byte slot per dispatch) with cached bind groups, dispatches batched into few command buffers, int8 / fp16
// weights dequantised inside the GEMM, f32 maths everywhere (no shader-f16 needed).
// Same interface as p0voice_wasm_backend.js (p0voice.js drives it); every method returns a promise or nothing.
'use strict';
import { LIN, VEC, linWeights, vecF32 } from './p0v_pack.js';

const NMEL = 100, HOP = 256, NFFT = 1024, NBIN = 513, DE = 192, DD = 256, DV = 384, DC = 256;
const DEC_DIL = [1, 2, 4, 1, 2, 4, 1, 1];
const U = () => globalThis.GPUBufferUsage;
const fr = Math.fround;

// ------------------------------------------------------------------------------------------------ core: buffers, pipelines, runner
class Core {
  constructor(device) {
    this.d = device; this.q = device.queue;
    this.pipes = new Map(); this.bgs = new Map(); this.ids = new WeakMap(); this.nid = 0;
    this.ubs = []; this.cur = null; this.bytes = 0; this.bufs = []; this.rb = null;
    this.SLOT = 256; this.CAP = 1024; this.dispatches = 0; this.submits = 0; this.bgNew = 0; this.error = null;
    this.onErr = (e) => { this.error = (e.error && e.error.message) || String(e.error); };   // taken off in destroy(): a device that is kept (shared) would keep every Core
    if (device.addEventListener) device.addEventListener('uncapturederror', this.onErr);
  }
  id(o) { let i = this.ids.get(o); if (i == null) { i = ++this.nid; this.ids.set(o, i); } return i; }
  buffer(bytes, label) {
    const b = this.d.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: U().STORAGE | U().COPY_SRC | U().COPY_DST, label });
    this.bufs.push(b); this.bytes += b.size; return b;
  }
  /** CPU -> GPU; the open batch goes first (it may still read the old contents) */
  write(buf, off, arr) {
    this.flush();
    const n = arr.byteLength & ~3;
    if (n) this.q.writeBuffer(buf, off, arr.buffer, arr.byteOffset, n);
  }
  pipeline(key, codeFn) {
    let p = this.pipes.get(key);
    if (p) return p;
    const mod = this.d.createShaderModule({ code: codeFn(), label: key });
    p = this.d.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' }, label: key });
    p._key = key; p._mod = mod; this.pipes.set(key, p);
    return p;
  }
  async check() {   // WGSL compile errors with line numbers
    const errs = [];
    for (const p of this.pipes.values()) { const ci = await p._mod.getCompilationInfo(); for (const m of ci.messages) if (m.type === 'error') errs.push(`${p._key} ${m.lineNum}:${m.linePos} ${m.message}`); }
    if (errs.length) throw new Error('WGSL: ' + errs.join(' | '));
  }
  _ub() {
    for (const u of this.ubs) if (!u._busy) return u;
    const u = this.d.createBuffer({ size: this.SLOT * this.CAP, usage: U().UNIFORM | U().COPY_DST, label: 'p0v-uniforms' });
    u._cpu = new ArrayBuffer(this.SLOT * this.CAP); this.ubs.push(u);
    return u;
  }
  dispatch(pipe, bufs, params, x, y = 1) {
    if (!this.cur) { const ub = this._ub(); this.cur = { enc: this.d.createCommandEncoder(), pass: null, ub, data: new Uint8Array(ub._cpu), n: 0 }; }
    const c = this.cur;
    if (!c.pass) c.pass = c.enc.beginComputePass();
    const slot = c.n++;
    c.data.set(new Uint8Array(params), slot * this.SLOT);
    let key = pipe._key + '|' + this.id(c.ub) + '|' + slot;
    for (const b of bufs) key += '|' + this.id(b);
    let bg = this.bgs.get(key);
    if (!bg) {
      const entries = [{ binding: 0, resource: { buffer: c.ub, offset: slot * this.SLOT, size: this.SLOT } }];
      bufs.forEach((b, i) => entries.push({ binding: i + 1, resource: { buffer: b } }));
      bg = this.d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }); this.bgNew++;
      if (this.bgs.size >= 16384) this.bgs.clear();
      this.bgs.set(key, bg);
    }
    c.pass.setPipeline(pipe); c.pass.setBindGroup(0, bg); c.pass.dispatchWorkgroups(x, y);
    this.dispatches++;
    if (c.n >= this.CAP) this.flush();
  }
  flush() {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    if (c.pass) c.pass.end();
    this.q.writeBuffer(c.ub, 0, c.data.buffer, 0, c.n * this.SLOT);
    this.q.submit([c.enc.finish()]); this.submits++;
    c.ub._busy = true;
    this.q.onSubmittedWorkDone().then(() => { c.ub._busy = false; });
  }
  /** GPU -> CPU through one reused staging buffer -> ArrayBuffer */
  async read(buf, off, bytes) {
    this.flush();
    const n = Math.ceil(bytes / 4) * 4;
    if (!this.rb || this.rb.size < n) {
      if (this.rb) this.rb.destroy();
      let s = 1 << 16; while (s < n) s *= 2;
      this.rb = this.d.createBuffer({ size: s, usage: U().MAP_READ | U().COPY_DST, label: 'p0v-readback' });
    }
    const enc = this.d.createCommandEncoder();
    enc.copyBufferToBuffer(buf, off, this.rb, 0, n);
    this.q.submit([enc.finish()]);
    await this.rb.mapAsync(GPUMapMode.READ, 0, n);
    const out = this.rb.getMappedRange(0, n).slice(0, bytes);
    this.rb.unmap();
    if (this.error) throw new Error('WebGPU: ' + this.error);
    return out;
  }
  destroy() {
    this.flush();
    for (const b of this.bufs) b.destroy();
    for (const u of this.ubs) u.destroy();
    if (this.rb) this.rb.destroy();
    this.bufs = []; this.ubs = []; this.rb = null; this.bgs.clear(); this.pipes.clear(); this.bytes = 0;
    if (this.d.removeEventListener) this.d.removeEventListener('uncapturederror', this.onErr);
  }
}
/** uniform params: all scalars, 4 bytes each (no std140 padding inside) */
function P() {
  const ab = new ArrayBuffer(256), u = new Uint32Array(ab), f = new Float32Array(ab); let i = 0;
  const o = { u(v) { u[i++] = v >>> 0; return o; }, f(v) { f[i++] = v; return o; }, get ab() { return ab.slice(0, Math.max(16, Math.ceil(i / 4) * 16)); } };
  return o;
}

// ------------------------------------------------------------------------------------------------ WGSL
const GELU = `fn gelu(v: f32) -> f32 {   // exact GELU, erf by Abramowitz & Stegun 7.1.26
  let z = abs(v) * 0.7071067811865476; let t = 1.0 / (1.0 + 0.3275911 * z);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-z * z);
  return 0.5 * v * (1.0 + select(-y, y, v >= 0.0)); }`;

/** Y[m, n] (op)= act(sum_k X[xOff + m*ldx + k] * W[n, k] * scale[n] + bias[n]); tile 64 x 64, k step 16, 256 threads of 4 x 4.
 *  X rows may overlap (a conv over a zero-padded [pad + T + pad][Cin] buffer: ldx = Cin, K = k * Cin); ldx = 0 repeats one row. */
function gemmCode(w, epi, act) {
  const L = [];
  L.push('struct P { M: u32, N: u32, K: u32, ldx: u32, xOff: u32, ldy: u32, yOff: u32, wOff: u32, sOff: u32, bOff: u32, gOff: u32, alpha: f32 };');
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> X: array<f32>;');
  L.push('@group(0) @binding(2) var<storage, read> W: array<u32>;');
  L.push('@group(0) @binding(3) var<storage, read_write> Y: array<f32>;');
  L.push('@group(0) @binding(4) var<storage, read> VB: array<f32>;');
  if (epi === 'resg') L.push('@group(0) @binding(5) var<storage, read> G: array<f32>;');
  L.push('var<workgroup> xs: array<vec4<f32>, 256>;   // [k 16][m/4 16]');
  L.push('var<workgroup> ws: array<vec4<f32>, 256>;   // [k 16][n/4 16]');
  if (act === 'gelu') L.push(GELU);
  L.push('@compute @workgroup_size(256)');
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push('  let m0 = wid.y * 64u; let n0 = wid.x * 64u; let tx = li % 16u; let ty = li / 16u;');
  L.push('  var a0 = vec4<f32>(0.0); var a1 = vec4<f32>(0.0); var a2 = vec4<f32>(0.0); var a3 = vec4<f32>(0.0);');
  L.push('  for (var k0 = 0u; k0 < p.K; k0 = k0 + 16u) {');
  L.push('    { let k = li % 16u; let mq = li / 16u; let kk = k0 + k; var v = vec4<f32>(0.0);');
  L.push('      if (kk < p.K) { for (var i = 0u; i < 4u; i = i + 1u) { let m = m0 + mq * 4u + i; if (m < p.M) { v[i] = X[p.xOff + m * p.ldx + kk]; } } }');
  L.push('      xs[k * 16u + mq] = v; }');
  if (w === 'f16') {
    L.push('    if (li < 128u) { let kp = li % 8u; let nq = li / 8u; let kk = k0 + kp * 2u; var lo = vec4<f32>(0.0); var hi = vec4<f32>(0.0);');
    L.push('      if (kk < p.K) { for (var i = 0u; i < 4u; i = i + 1u) { let n = n0 + nq * 4u + i; if (n < p.N) { let h = unpack2x16float(W[p.wOff + (n * p.K + kk) / 2u]); lo[i] = h.x; hi[i] = h.y; } } }');
    L.push('      ws[(kp * 2u) * 16u + nq] = lo; ws[(kp * 2u + 1u) * 16u + nq] = hi; }');
  } else {
    L.push('    if (li < 64u) { let kq = li % 4u; let nq = li / 4u; let kk = k0 + kq * 4u;');
    L.push('      var c0 = vec4<f32>(0.0); var c1 = vec4<f32>(0.0); var c2 = vec4<f32>(0.0); var c3 = vec4<f32>(0.0);');
    L.push('      if (kk < p.K) { for (var i = 0u; i < 4u; i = i + 1u) { let n = n0 + nq * 4u + i; if (n < p.N) { let q = W[p.wOff + (n * p.K + kk) / 4u];');
    L.push('        c0[i] = f32(i32(q << 24u) >> 24u); c1[i] = f32(i32(q << 16u) >> 24u); c2[i] = f32(i32(q << 8u) >> 24u); c3[i] = f32(i32(q) >> 24u); } } }');
    L.push('      ws[(kq * 4u) * 16u + nq] = c0; ws[(kq * 4u + 1u) * 16u + nq] = c1; ws[(kq * 4u + 2u) * 16u + nq] = c2; ws[(kq * 4u + 3u) * 16u + nq] = c3; }');
  }
  L.push('    workgroupBarrier();');
  L.push('    for (var k = 0u; k < 16u; k = k + 1u) { let a = xs[k * 16u + ty]; let b = ws[k * 16u + tx];');
  L.push('      a0 = fma(vec4<f32>(a.x), b, a0); a1 = fma(vec4<f32>(a.y), b, a1); a2 = fma(vec4<f32>(a.z), b, a2); a3 = fma(vec4<f32>(a.w), b, a3); }');
  L.push('    workgroupBarrier();');
  L.push('  }');
  const actf = { none: (v) => v, gelu: (v) => `gelu(${v})`, relu: (v) => `max(${v}, 0.0)`, silu: (v) => `(${v} / (1.0 + exp(-${v})))` }[act];
  for (let i = 0; i < 4; i++) {
    L.push(`  { let m = m0 + ty * 4u + ${i}u; if (m < p.M) { for (var j = 0u; j < 4u; j = j + 1u) { let n = n0 + tx * 4u + j; if (n < p.N) {`);
    L.push(`    let u = a${i}[j]${w === 'i8' ? ' * VB[p.sOff + n]' : ''} + VB[p.bOff + n]; let v = ${actf('u')}; let yi = p.yOff + m * p.ldy + n;`);
    L.push({ store: '    Y[yi] = v;', res: '    Y[yi] = Y[yi] + v;', resg: '    Y[yi] = Y[yi] + v * G[p.gOff + n];', axpy: '    Y[yi] = Y[yi] + p.alpha * v;' }[epi]);
    L.push('  } } } }');
  }
  L.push('}');
  return L.join('\n');
}

/** one row per workgroup: [depthwise conv k7 (dilated) ->] LayerNorm [-> affine] [-> AdaLN: * (1 + sc) + sh]; C <= 384 */
function lnCode(dw, aff, mod) {
  return `struct P { C: u32, xOff: u32, ldx: u32, yOff: u32, ldy: u32, dil: u32, tOff: u32, dbOff: u32, wOff: u32, bOff: u32, mOff: u32, r0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<storage, read> VB: array<f32>;
${mod ? '@group(0) @binding(4) var<storage, read> MD: array<f32>;' : ''}
var<workgroup> red: array<f32, 128>;
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let t = wid.x + p.r0; let C = p.C;
  var v: array<f32, 3>;
  for (var j = 0u; j < 3u; j = j + 1u) {
    let c = li + j * 128u; var x = 0.0;
    if (c < C) {
      ${dw ? `x = VB[p.dbOff + c];
      for (var k = 0u; k < 7u; k = k + 1u) { let r = i32(t) + (i32(k) - 3) * i32(p.dil); x = x + X[u32(i32(p.xOff) + r * i32(p.ldx)) + c] * VB[p.tOff + k * C + c]; }`
    : 'x = X[p.xOff + t * p.ldx + c];'}
    }
    v[j] = x;
  }
  red[li] = v[0] + v[1] + v[2]; workgroupBarrier();
  for (var s = 64u; s > 0u; s = s >> 1u) { if (li < s) { red[li] = red[li] + red[li + s]; } workgroupBarrier(); }
  let mean = red[0] / f32(C); workgroupBarrier();
  var q = 0.0;
  for (var j = 0u; j < 3u; j = j + 1u) { if (li + j * 128u < C) { let d = v[j] - mean; q = q + d * d; } }
  red[li] = q; workgroupBarrier();
  for (var s = 64u; s > 0u; s = s >> 1u) { if (li < s) { red[li] = red[li] + red[li + s]; } workgroupBarrier(); }
  let rs = 1.0 / sqrt(red[0] / f32(C) + 1e-5);
  for (var j = 0u; j < 3u; j = j + 1u) {
    let c = li + j * 128u;
    if (c < C) {
      var o = (v[j] - mean) * rs;
      ${aff ? 'o = o * VB[p.wOff + c] + VB[p.bOff + c];' : ''}
      ${mod ? 'o = o * (1.0 + MD[p.mOff + c]) + MD[p.mOff + C + c];' : ''}
      Y[p.yOff + t * p.ldy + c] = o;
    }
  }
}`;
}

const K = {};
K.rope = `struct P { T: u32, cOff: u32, sOff: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> Q: array<f32>;
@group(0) @binding(2) var<storage, read> VB: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let idx = g.x; if (idx >= p.T * 192u) { return; }
  let i = idx % 48u; let ph = (idx / 48u) % 4u; let t = idx / 192u;
  let o = t * 576u + (ph / 2u) * 192u + (ph % 2u) * 96u + 2u * i;
  let c = VB[p.cOff + t * 48u + i]; let s = VB[p.sOff + t * 48u + i]; let x1 = Q[o]; let x2 = Q[o + 1u];
  Q[o] = x1 * c - x2 * s; Q[o + 1u] = x1 * s + x2 * c;
}`;
K.attn = `struct P { T: u32, scale: f32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
var<workgroup> qs: array<f32, 96>;
var<workgroup> sc: array<f32, 512>;
var<workgroup> red: array<f32, 128>;
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let i = wid.x; let h = wid.y; let T = p.T;
  if (li < 96u) { qs[li] = Q[i * 576u + h * 96u + li]; }
  workgroupBarrier();
  var mx = -3.0e38;
  for (var j = li; j < T; j = j + 128u) {
    var d = 0.0; let kb = j * 576u + 192u + h * 96u;
    for (var k = 0u; k < 96u; k = k + 1u) { d = d + qs[k] * Q[kb + k]; }
    d = d * p.scale; sc[j] = d; mx = max(mx, d);
  }
  red[li] = mx; workgroupBarrier();
  for (var s = 64u; s > 0u; s = s >> 1u) { if (li < s) { red[li] = max(red[li], red[li + s]); } workgroupBarrier(); }
  let m = red[0]; workgroupBarrier();
  var sum = 0.0;
  for (var j = li; j < T; j = j + 128u) { let e = exp(sc[j] - m); sc[j] = e; sum = sum + e; }
  red[li] = sum; workgroupBarrier();
  for (var s = 64u; s > 0u; s = s >> 1u) { if (li < s) { red[li] = red[li] + red[li + s]; } workgroupBarrier(); }
  let tot = red[0];
  if (li < 96u) {
    var o = 0.0;
    for (var j = 0u; j < T; j = j + 1u) { o = o + sc[j] * Q[j * 576u + 384u + h * 96u + li]; }
    O[i * 192u + h * 96u + li] = o / tot;
  }
}`;
K.embed = `struct P { T: u32, eOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> IDS: array<u32>;
@group(0) @binding(2) var<storage, read> VB: array<f32>;
@group(0) @binding(3) var<storage, read> CV: array<f32>;
@group(0) @binding(4) var<storage, read_write> X: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= p.T * 192u) { return; }
  let t = i / 192u; let c = i % 192u; let id = min(IDS[t], 95u);
  X[i] = VB[p.eOff + id * 192u + c] + CV[c];
}`;
K.rowadd = `struct P { R: u32, C: u32, aOff: u32, bOff: u32, yOff: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= p.R * p.C) { return; }
  Y[p.yOff + i] = A[p.aOff + i] + B[p.bOff + i % p.C];
}`;
K.zero = `struct P { off: u32, n: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) { if (g.x < p.n) { Y[p.off + g.x] = 0.0; } }`;
K.copyrows = `struct P { R: u32, C: u32, xOff: u32, ldx: u32, yOff: u32, ldy: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= p.R * p.C) { return; }
  let r = i / p.C; let c = i % p.C;
  Y[p.yOff + r * p.ldy + c] = X[p.xOff + r * p.ldx + c];
}`;
K.regulate = `struct P { F: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> MU: array<f32>;
@group(0) @binding(2) var<storage, read> IDX: array<u32>;
@group(0) @binding(3) var<storage, read_write> MY: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= p.F * 100u) { return; }
  MY[i] = MU[IDX[i / 100u] * 100u + i % 100u];
}`;
K.winit = `struct P { n: u32, w0: u32, temp: f32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> NZ: array<f32>;
@group(0) @binding(2) var<storage, read> MY: array<f32>;
@group(0) @binding(3) var<storage, read_write> XM: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= (p.n + 6u) * 200u) { return; }
  let r = i32(i / 200u) - 3; let c = i % 200u; var v = 0.0;
  if (r >= 0 && r < i32(p.n)) { let f = p.w0 + u32(r); if (c < 100u) { v = p.temp * NZ[f * 100u + c]; } else { v = MY[f * 100u + c - 100u]; } }
  XM[i] = v;
}`;
K.compose = `struct P { c0: u32, c1: u32, w0: u32, xe: u32, mOff: u32, sOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> XM: array<f32>;
@group(0) @binding(2) var<storage, read> VB: array<f32>;
@group(0) @binding(3) var<storage, read_write> MEL: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= (p.c1 - p.c0) * 100u) { return; }
  let f = p.c0 + i / 100u; let c = i % 100u;
  let x = XM[(3u + f - p.w0) * 200u + c] * VB[p.sOff + c] + VB[p.mOff + c];
  let mi = f * 100u + c;
  if (f < p.xe) { let w = (f32(f - p.c0) + 0.5) / f32(p.xe - p.c0); MEL[mi] = (1.0 - w) * MEL[mi] + w * x; } else { MEL[mi] = x; }
}`;
// one frame per workgroup: log-mag | phase -> X[k] (k 0..512) -> 512-point complex inverse FFT (Z = Xe + i Xo) -> * window -> ring slot
K.ifft = `struct P { row0: u32, g0: u32, R: u32, dbg: u32, winOff: u32, twOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> SP: array<f32>;
@group(0) @binding(2) var<storage, read> VB: array<f32>;
@group(0) @binding(3) var<storage, read_write> FR: array<f32>;
@group(0) @binding(4) var<storage, read_write> DBG: array<f32>;
// sin, cos of x (Cody-Waite reduction by pi/2 in three parts + Cephes polynomials): GPU built-ins may be off by ~2^-11 absolute
fn sincos(x: f32) -> vec2<f32> {
  let j = round(x * 0.63661977236758134);
  var r = x - j * 1.5703125; r = r - j * 4.837512969970703125e-4; r = r - j * 7.54978995489188216e-8;
  let r2 = r * r;
  let sr = r + r * r2 * ((-1.9515295891e-4 * r2 + 8.3321608736e-3) * r2 - 1.6666654611e-1);
  let cr = 1.0 - 0.5 * r2 + r2 * r2 * ((2.443315711809948e-5 * r2 - 1.388731625493765e-3) * r2 + 4.166664568298827e-2);
  let q = i32(j) & 3;
  var sv = sr; var cv = cr;
  if ((q & 1) == 1) { sv = cr; cv = sr; }
  if ((q & 2) == 2) { sv = -sv; }
  if (((q + 1) & 2) == 2) { cv = -cv; }
  return vec2<f32>(sv, cv);
}
var<workgroup> xr: array<f32, 513>;
var<workgroup> xi: array<f32, 513>;
var<workgroup> re: array<f32, 512>;
var<workgroup> im: array<f32, 512>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let row = p.row0 + wid.x; let g = p.g0 + wid.x; let sb = row * 1026u;
  for (var k = li; k < 513u; k = k + 256u) {
    let lm = SP[sb + k]; let ph = SP[sb + 513u + k];
    let mg = exp(min(lm, 4.605170185988092));
    let sc = sincos(ph);
    xr[k] = mg * sc.y; xi[k] = select(mg * sc.x, 0.0, k == 0u || k == 512u);
    if (p.dbg == 1u) { DBG[g * 1026u + k] = mg; DBG[g * 1026u + 513u + k] = ph; }
  }
  workgroupBarrier();
  for (var k = li; k < 512u; k = k + 256u) {
    let ar = xr[k]; let ai = xi[k]; let br = xr[512u - k]; let bi = -xi[512u - k];
    let er = 0.5 * (ar + br); let ei = 0.5 * (ai + bi); let dr = 0.5 * (ar - br); let di = 0.5 * (ai - bi);
    let tc = VB[p.twOff + 2u * k]; let ts = VB[p.twOff + 2u * k + 1u];
    let orr = dr * tc - di * ts; let oi = dr * ts + di * tc;
    let j = reverseBits(k) >> 23u;
    re[j] = er - oi; im[j] = ei + orr;
  }
  workgroupBarrier();
  for (var L = 2u; L <= 512u; L = L * 2u) {
    let h = L / 2u; let b = li; let k = b % h; let a = (b / h) * L + k; let c = a + h;
    let ti = k * (1024u / L); let wr = VB[p.twOff + 2u * ti]; let wi = VB[p.twOff + 2u * ti + 1u];
    let xr2 = re[c] * wr - im[c] * wi; let xi2 = re[c] * wi + im[c] * wr;
    let ar = re[a]; let ai = im[a];
    workgroupBarrier();
    re[c] = ar - xr2; im[c] = ai - xi2; re[a] = ar + xr2; im[a] = ai + xi2;
    workgroupBarrier();
  }
  let fb = (g % p.R) * 1024u;
  for (var m = li; m < 512u; m = m + 256u) {
    FR[fb + 2u * m] = re[m] * (1.0 / 512.0) * VB[p.winOff + 2u * m];
    FR[fb + 2u * m + 1u] = im[m] * (1.0 / 512.0) * VB[p.winOff + 2u * m + 1u];
  }
}`;
K.ola = `struct P { nf: u32, s0: u32, n: u32, R: u32, winOff: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> FR: array<f32>;
@group(0) @binding(2) var<storage, read> VB: array<f32>;
@group(0) @binding(3) var<storage, read_write> OUT: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= p.n) { return; }
  let pp = i32(p.s0 + i + 512u);
  var tl = pp - 1023; if (tl <= 0) { tl = 0; } else { tl = (tl + 255) / 256; }
  let th = min(pp / 256, i32(p.nf) - 1);
  var acc = 0.0; var env = 0.0;
  for (var t = tl; t <= th; t = t + 1) {
    let o = u32(pp - t * 256); let w = VB[p.winOff + o];
    acc = acc + FR[(u32(t) % p.R) * 1024u + o]; env = env + w * w;
  }
  OUT[i] = acc / max(env, 1e-8);
}`;

// ------------------------------------------------------------------------------------------------ backend
/** pack: parsePack(); opts: {device | powerPreference, maxT = 512, maxF = 2048, maxW = 1024} */
export async function createGpuBackend(pack, opts = {}) {
  const t0 = performance.now();
  let device = opts.device, adapterInfo = opts.adapterInfo || null;
  if (!device) {
    if (!globalThis.navigator || !navigator.gpu) throw new Error('WebGPU is not available');
    const ad = await navigator.gpu.requestAdapter({ powerPreference: opts.powerPreference || 'high-performance' });
    if (!ad) throw new Error('no WebGPU adapter');
    adapterInfo = ad.info || null;
    if (opts.acceptAdapter && !opts.acceptAdapter(adapterInfo || {})) throw new Error('WebGPU adapter refused: ' + JSON.stringify(adapterInfo));
    const L = ad.limits;
    device = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize } });
  }
  const tDevice = performance.now();
  const core = new Core(device);
  const maxT = opts.maxT || 512, maxF = opts.maxF || 2048, maxW = Math.min(opts.maxW || 1024, maxF), R = maxW + 8;
  if (maxT > 512) throw new Error('the GPU attention kernel holds at most 512 phonemes');
  // ---- weights: GEMM weights in one u32 buffer, every small f32 vector (+ biases, scales, tables) in one f32 buffer
  const lin = [], vec = [];
  let wWords = 0;
  const lws = LIN.map((name) => { const w = linWeights(pack, name); const words = w.dt === 'i8' ? (w.N * w.K) / 4 : (w.N * w.K) / 2; if ((w.N * w.K) % 4) throw new Error('odd GEMM size ' + name); w.wOff = wWords; wWords += Math.ceil(words); return w; });
  const vparts = []; let vlen = 0;
  const addV = (a) => { const off = vlen; vparts.push(a); vlen += a.length + ((4 - (a.length % 4)) % 4); return off; };
  const W32 = new Uint32Array(wWords);
  for (const w of lws) {
    const src = w.dt === 'i8' ? new Uint32Array(w.data.buffer, w.data.byteOffset, w.data.length / 4) : new Uint32Array(w.data.buffer, w.data.byteOffset, w.data.length / 2);
    W32.set(src, w.wOff);
    lin.push({ name: w.name, N: w.N, K: w.K, dt: w.dt, wOff: w.wOff, sOff: w.scale ? addV(w.scale) : 0, bOff: addV(w.bias) });
  }
  VEC.forEach((name) => vec.push(addV(vecF32(pack, name))));
  // tables: periodic Hann window, twiddles e^{+2 pi i j / 1024} (j < 512), RoPE cos / sin [maxT][48] like torch (f32)
  const win = new Float32Array(NFFT), tw = new Float32Array(1024);
  for (let n = 0; n < NFFT; n++) win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / NFFT);
  for (let j = 0; j < 512; j++) { tw[2 * j] = Math.cos((2 * Math.PI * j) / NFFT); tw[2 * j + 1] = Math.sin((2 * Math.PI * j) / NFFT); }
  const rc = new Float32Array(maxT * 48), rs = new Float32Array(maxT * 48);
  for (let i = 0; i < 48; i++) {
    const inv = fr(1 / fr(Math.pow(10000, fr((2 * i) / 96))));
    for (let t = 0; t < maxT; t++) { const a = fr(t * inv); rc[t * 48 + i] = Math.cos(a); rs[t * 48 + i] = Math.sin(a); }
  }
  const T_WIN = addV(win), T_TW = addV(tw), T_RC = addV(rc), T_RS = addV(rs);
  const VBA = new Float32Array(vlen); { let o = 0; for (const a of vparts) { VBA.set(a, o); o += a.length + ((4 - (a.length % 4)) % 4); } }
  // the pack and the vectors are not kept: closures above made them context variables, so every method of the backend held the pack's
  // bytes (19 MB) for the voice's life (desk, Nov 3: 31 MB of ArrayBuffers on the page with the voice loaded)
  pack = null; vparts.length = 0;
  const B = {};
  const mk = (name, floats) => { B[name] = core.buffer(floats * 4, 'p0v-' + name); };
  mk('W', wWords); mk('VB', vlen);
  core.write(B.W, 0, W32); core.write(B.VB, 0, VBA);
  // ---- activations (sized once)
  mk('IDS', maxT); mk('COND', DC); mk('CVE', DC); mk('CVD', DC);
  mk('EX', maxT * DE); mk('EA', maxT * DE); mk('EO', maxT * DE); mk('QKV', maxT * 3 * DE); mk('EAP', (maxT + 2) * DE); mk('EHID', maxT * 768);
  mk('HOUT', maxT * DE); mk('MU', maxT * NMEL); mk('DP0', (maxT + 2) * DE); mk('DP1', (maxT + 2) * 256); mk('DQ', maxT * 256); mk('DQ2', maxT * 256); mk('LOGD', maxT);
  mk('TEMB', 16 * DC); mk('UU', 16 * DC); mk('CC', 16 * DC); mk('ADA', 8 * 16 * 3 * DD);
  mk('IDX', maxF); mk('NOISE', maxF * NMEL); mk('MUY', maxF * NMEL); mk('MEL', maxF * NMEL);
  mk('XM', (maxW + 6) * 2 * NMEL); mk('H0', (maxW + 24) * DD); mk('HN', maxW * DV); mk('HID', maxW * 1152);
  mk('VI', (maxW + 6) * NMEL); mk('X0', (maxW + 6) * DV); mk('SP', maxW * 1026); mk('FR', R * NFFT); mk('OUT', maxF * HOP); mk('DUMMY', 4);
  // ---- kernels
  const run = (key, code, bufs, pr, x, y = 1) => core.dispatch(core.pipeline(key, typeof code === 'function' ? code : () => code), bufs, pr.ab, x, y);
  const wg = (n, s = 64) => Math.ceil(n / s);
  function gemm(li, X, xOff, ldx, M, Y, yOff, ldy, epi = 'store', act = 'none', o = {}) {
    const L = lin[li];
    const key = `gemm.${L.dt}.${epi}.${act}`;
    const pp = core.pipeline(key, () => gemmCode(L.dt, epi, act));
    const pr = P().u(M).u(L.N).u(L.K).u(ldx).u(xOff).u(ldy).u(yOff).u(L.wOff).u(L.sOff).u(L.bOff).u(o.gOff || 0).f(o.alpha || 0);
    const bufs = [X, B.W, Y, B.VB]; if (epi === 'resg') bufs.push(o.G);
    core.dispatch(pp, bufs, pr.ab, wg(L.N), wg(M));
  }
  function ln(X, xOff, ldx, n, C, Y, yOff, ldy, o = {}) {   // o: {dw: {tOff, dbOff, dil}, w, b, mod: {buf, off}, r0}
    const dw = !!o.dw, aff = o.w != null, mod = !!o.mod;
    const pr = P().u(C).u(xOff).u(ldx).u(yOff).u(ldy).u(dw ? o.dw.dil : 1).u(dw ? o.dw.tOff : 0).u(dw ? o.dw.dbOff : 0).u(aff ? o.w : 0).u(aff ? o.b : 0).u(mod ? o.mod.off : 0).u(o.r0 || 0);
    const bufs = [X, Y, B.VB]; if (mod) bufs.push(o.mod.buf);
    run(`ln.${+dw}${+aff}${+mod}`, () => lnCode(dw, aff, mod), bufs, pr, n);
  }
  const zero = (buf, off, n) => { if (n > 0) run('zero', K.zero, [buf], P().u(off).u(n), wg(n)); };
  const copyrows = (X, xOff, ldx, Rr, C, Y, yOff, ldy) => run('copyrows', K.copyrows, [X, Y], P().u(Rr).u(C).u(xOff).u(ldx).u(yOff).u(ldy), wg(Rr * C));

  let T = 0, Tm = 0, nSteps = 0, dbg = null, idxHost = new Uint32Array(maxF);
  const DT = new Float32Array(16);
  const be = {
    name: 'webgpu', maxT, maxF, maxW, weightBytes: wWords * 4, adapter: adapterInfo, core,
    timings: { device_ms: Math.round(tDevice - t0), weights_ms: Math.round(performance.now() - tDevice) },   // pipelines compile on first use
    memoryBytes: () => core.bytes,
    async encode(ids, cond) {
      T = ids.length;
      if (T > maxT) throw new Error(`too many phonemes in one clause (${T} > ${maxT})`);
      core.write(B.IDS, 0, Uint32Array.from(ids)); core.write(B.COND, 0, cond);
      gemm(0, B.COND, 0, DC, 1, B.CVE, 0, DE);
      run('embed', K.embed, [B.IDS, B.VB, B.CVE, B.EX], P().u(T).u(vec[0]), wg(T * DE));
      zero(B.EAP, 0, DE); zero(B.EAP, (T + 1) * DE, DE);
      for (let l = 0; l < 6; l++) {
        ln(B.EX, 0, DE, T, DE, B.EA, 0, DE, { w: vec[1 + 4 * l], b: vec[2 + 4 * l] });
        gemm(1 + 4 * l, B.EA, 0, DE, T, B.QKV, 0, 3 * DE);
        run('rope', K.rope, [B.QKV, B.VB], P().u(T).u(T_RC).u(T_RS).u(0), wg(T * 192));
        run('attn', K.attn, [B.QKV, B.EO], P().u(T).f(1 / Math.sqrt(96)), T, 2);
        gemm(2 + 4 * l, B.EO, 0, DE, T, B.EX, 0, DE, 'res');
        ln(B.EX, 0, DE, T, DE, B.EAP, DE, DE, { w: vec[3 + 4 * l], b: vec[4 + 4 * l] });
        gemm(3 + 4 * l, B.EAP, 0, DE, T, B.EHID, 0, 768, 'store', 'gelu');
        gemm(4 + 4 * l, B.EHID, 0, 768, T, B.EX, 0, DE, 'res');
      }
      ln(B.EX, 0, DE, T, DE, B.HOUT, 0, DE, { w: vec[25], b: vec[26] });
      gemm(25, B.HOUT, 0, DE, T, B.MU, 0, NMEL);
      gemm(26, B.COND, 0, DC, 1, B.CVD, 0, DE);
      zero(B.DP0, 0, DE); zero(B.DP0, (T + 1) * DE, DE);
      run('rowadd', K.rowadd, [B.HOUT, B.CVD, B.DP0], P().u(T).u(DE).u(0).u(0).u(DE), wg(T * DE));
      gemm(27, B.DP0, 0, DE, T, B.DQ, 0, 256, 'store', 'relu');
      zero(B.DP1, 0, 256); zero(B.DP1, (T + 1) * 256, 256);
      ln(B.DQ, 0, 256, T, 256, B.DP1, 256, 256, { w: vec[27], b: vec[28] });
      gemm(28, B.DP1, 0, 256, T, B.DQ, 0, 256, 'store', 'relu');
      ln(B.DQ, 0, 256, T, 256, B.DP1, 256, 256, { w: vec[29], b: vec[30] });
      gemm(29, B.DP1, 0, 256, T, B.DQ, 0, 256, 'store', 'relu');
      ln(B.DQ, 0, 256, T, 256, B.DQ2, 0, 256, { w: vec[31], b: vec[32] });
      gemm(30, B.DQ2, 0, 256, T, B.LOGD, 0, 1);
      return new Float32Array(await core.read(B.LOGD, 0, T * 4));
    },
    async encoderOut() { return { h: new Float32Array(await core.read(B.HOUT, 0, T * DE * 4)), mu: new Float32Array(await core.read(B.MU, 0, T * NMEL * 4)) }; },
    async prepare(dur, noise, steps) {
      if (steps < 1 || steps > 16) throw new Error('bad step count ' + steps);
      let f = 0;
      for (let t = 0; t < T; t++) for (let r = 0; r < dur[t] && f < maxF; r++) idxHost[f++] = t;
      Tm = f; nSteps = steps;
      core.write(B.IDX, 0, idxHost.subarray(0, Tm)); core.write(B.NOISE, 0, noise.subarray(0, Tm * NMEL));
      run('regulate', K.regulate, [B.MU, B.IDX, B.MUY], P().u(Tm), wg(Tm * NMEL));
      // decoder conditioning per step: cc = t_mlp(t_embed(t)) + c_dec(c); ada per block, laid out [block][step][768]
      const n = steps + 1, st = fr(1 / steps), half = n >> 1, ts = new Float32Array(n);
      for (let i = 0; i < n; i++) ts[i] = i < half ? fr(i * st) : fr(1 - fr((n - 1 - i) * st));
      const te = new Float32Array(steps * DC);
      for (let s = 0; s < steps; s++) {
        DT[s] = fr(ts[s + 1] - ts[s]);
        const ta = fr(ts[s] * 1000);
        for (let i = 0; i < DC / 2; i++) { const fq = fr(Math.exp(fr(fr(fr(-9.210340371976184) * i) / (DC / 2)))), a = fr(ta * fq); te[s * DC + i] = Math.sin(a); te[s * DC + DC / 2 + i] = Math.cos(a); }
      }
      core.write(B.TEMB, 0, te);
      gemm(31, B.TEMB, 0, DC, steps, B.UU, 0, DC, 'store', 'silu');
      gemm(33, B.COND, 0, 0, steps, B.CC, 0, DC);                      // c_dec(c) in every step row (ldx 0)
      gemm(32, B.UU, 0, DC, steps, B.CC, 0, DC, 'res');
      for (let b = 0; b < 8; b++) gemm(37 + 3 * b, B.CC, 0, DC, steps, B.ADA, b * steps * 3 * DD, 3 * DD);
      return Tm;
    },
    async muY() { return new Float32Array(await core.read(B.MUY, 0, Tm * NMEL * 4)); },
    setMuY(a) { core.write(B.MUY, 0, a); },
    setMel(f0, a) { core.write(B.MEL, f0 * NMEL * 4, a); },
    decode(w0, w1, temp) {
      const n = w1 - w0;
      if (n < 1 || n > maxW) throw new Error(`decode window ${w0}..${w1} too large`);
      run('winit', K.winit, [B.NOISE, B.MUY, B.XM], P().u(n).u(w0).f(temp), wg((n + 6) * 200));
      zero(B.H0, 0, 12 * DD); zero(B.H0, (12 + n) * DD, 12 * DD);
      const h0 = 12 * DD;
      for (let s = 0; s < nSteps; s++) {
        gemm(34, B.XM, 0, 2 * NMEL, n, B.H0, h0, DD);
        for (let b = 0; b < 8; b++) {
          const ada = (b * nSteps + s) * 3 * DD;
          ln(B.H0, h0, DD, n, DD, B.HN, 0, DD, { dw: { dil: DEC_DIL[b], tOff: vec[33 + 2 * b], dbOff: vec[34 + 2 * b] }, mod: { buf: B.ADA, off: ada } });
          gemm(35 + 3 * b, B.HN, 0, DD, n, B.HID, 0, 768, 'store', 'gelu');
          gemm(36 + 3 * b, B.HID, 0, 768, n, B.H0, h0, DD, 'resg', 'none', { G: B.ADA, gOff: ada + 2 * DD });
        }
        ln(B.H0, h0, DD, n, DD, B.HN, 0, DD, { w: vec[49], b: vec[50] });
        gemm(59, B.HN, 0, DD, n, B.XM, 3 * 2 * NMEL, 2 * NMEL, 'axpy', 'none', { alpha: DT[s] });
        if (dbg && dbg.xs && n <= dbg.frames) copyrows(B.XM, 3 * 2 * NMEL, 2 * NMEL, n, NMEL, dbg.xs, s * n * NMEL, NMEL);
      }
    },
    compose(c0, c1, w0, xe) { if (c1 > c0) run('compose', K.compose, [B.XM, B.VB, B.MEL], P().u(c0).u(c1).u(w0).u(xe).u(vec[51]).u(vec[52]), wg((c1 - c0) * NMEL)); },
    vocode(v0, v1, o0, o1) {
      const n = v1 - v0;
      if (n < 1 || n > maxW || o0 < v0 || o1 > v1) throw new Error('vocode window too large');
      zero(B.VI, 0, 3 * NMEL); zero(B.VI, (3 + n) * NMEL, 3 * NMEL);
      copyrows(B.MEL, v0 * NMEL, NMEL, n, NMEL, B.VI, 3 * NMEL, NMEL);
      zero(B.X0, 0, 3 * DV); zero(B.X0, (3 + n) * DV, 3 * DV);
      const a = o0 - v0, z = o1 - v0, x0 = 3 * DV;
      const lo = Math.max(0, a - 24), hi = Math.min(n, z + 24);
      gemm(60, B.VI, lo * NMEL, NMEL, hi - lo, B.HN, lo * DV, DV);
      ln(B.HN, 0, DV, hi - lo, DV, B.X0, x0, DV, { w: vec[53], b: vec[54], r0: lo });
      for (let b = 0; b < 8; b++) {
        const l = Math.max(0, a - 3 * (7 - b)), u = Math.min(n, z + 3 * (7 - b));
        ln(B.X0, x0, DV, u - l, DV, B.HN, 0, DV, { dw: { dil: 1, tOff: vec[55 + 5 * b], dbOff: vec[56 + 5 * b] }, w: vec[57 + 5 * b], b: vec[58 + 5 * b], r0: l });
        gemm(61 + 2 * b, B.HN, l * DV, DV, u - l, B.HID, 0, 1152, 'store', 'gelu');
        gemm(62 + 2 * b, B.HID, 0, 1152, u - l, B.X0, x0 + l * DV, DV, 'resg', 'none', { G: B.VB, gOff: vec[59 + 5 * b] });
      }
      ln(B.X0, x0, DV, z - a, DV, B.HN, 0, DV, { w: vec[95], b: vec[96], r0: a });
      gemm(77, B.HN, a * DV, DV, z - a, B.SP, 0, 1026);
      run('ifft', K.ifft, [B.SP, B.VB, B.FR, dbg && dbg.spec ? dbg.spec : B.DUMMY], P().u(0).u(o0).u(R).u(dbg && dbg.spec ? 1 : 0).u(T_WIN).u(T_TW), z - a);
    },
    async emit(nf, s0, s1) {
      const n = s1 - s0;
      if (n <= 0) return new Float32Array(0);
      run('ola', K.ola, [B.FR, B.VB, B.OUT], P().u(nf).u(s0).u(n).u(R).u(T_WIN), wg(n));
      return new Float32Array(await core.read(B.OUT, 0, n * 4));
    },
    async mel(f0, f1) { return new Float32Array(await core.read(B.MEL, f0 * NMEL * 4, (f1 - f0) * NMEL * 4)); },
    debug(on, steps = 4, frames = 0) {
      if (dbg) { core.flush(); dbg.xs.destroy(); dbg.spec.destroy(); dbg = null; }
      if (!on) return;
      dbg = { frames, steps, xs: device.createBuffer({ size: Math.max(16, steps * frames * NMEL * 4), usage: U().STORAGE | U().COPY_SRC }),
        spec: device.createBuffer({ size: Math.max(16, frames * 1026 * 4), usage: U().STORAGE | U().COPY_SRC }) };
    },
    async debugOut() {
      if (!dbg) return null;
      const xs = new Float32Array(await core.read(dbg.xs, 0, dbg.steps * dbg.frames * NMEL * 4));
      const sp = new Float32Array(await core.read(dbg.spec, 0, dbg.frames * 1026 * 4));
      const mag = new Float32Array(dbg.frames * NBIN), phase = new Float32Array(dbg.frames * NBIN);
      for (let f = 0; f < dbg.frames; f++) { mag.set(sp.subarray(f * 1026, f * 1026 + NBIN), f * NBIN); phase.set(sp.subarray(f * 1026 + NBIN, f * 1026 + 1026), f * NBIN); }
      return { xs, mag, phase };
    },
    check: () => core.check(),
    stats: () => ({ dispatches: core.dispatches, submits: core.submits, bindGroups: core.bgNew, pipelines: core.pipes.size, mb: +(core.bytes / 1e6).toFixed(1) }),
    unload() { be.debug(false); core.destroy(); if (!opts.device && device.destroy) device.destroy(); },
    HOP,
  };
  return be;
}
