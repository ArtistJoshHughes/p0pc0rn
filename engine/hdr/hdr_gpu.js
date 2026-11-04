// hdr_gpu.js - p0pc0rn v4 "Make HDR" on the GPU (WebGPU): one decoded SDR frame -> the look -> HLG -> BT.2020 NCL Y'CbCr 4:2:0, limited
// range, 8-bit with the still blue-noise dither, written straight out as I420 planes (a VideoFrame is built from the bytes with no CPU
// pass). Two compute entry points: `luma` (one invocation = 4 Y samples = one u32) and `chroma` (4 Cb + 4 Cr samples, each the mean of its
// 2x2 block). Pixels are read with textureLoad (exact, no filtering), so any even size works. The maths is hdr_core.js's, in f32.
// Also the before / after preview for the Make HDR sheet: an extended-range canvas (rgba16float, toneMapping 'extended') where 1.0 =
// SDR white = 203 nits, the original on the left of the divider and the look on the right.

const COMMON = /* wgsl */`
struct P {
  w: u32, h: u32, dither: u32, ditherAmp: f32,
  lW: f32, lg: f32, lk: f32, lp: f32,
  lsat: f32, peak: f32, yWords: u32, cWords: u32,
  cbOff: u32, crOff: u32, mode: u32, split: f32,
  cw: f32, ch: f32, p3: u32, pad: u32,
};
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var src: texture_2d<f32>;

// row-major 3x3 written as mat3x3f(row0, row1, row2); v * M == M . v
const M709to2020 = mat3x3f(vec3f(0.627404, 0.329283, 0.043313), vec3f(0.069097, 0.919540, 0.011362), vec3f(0.016391, 0.088013, 0.895595));
const M2020to709 = mat3x3f(vec3f(1.660490, -0.587641, -0.072850), vec3f(-0.124550, 1.132900, -0.008349), vec3f(-0.018150, -0.100579, 1.118730));
const M2020toP3 = mat3x3f(vec3f(1.343578, -0.282180, -0.061399), vec3f(-0.065297, 1.075788, -0.010490), vec3f(0.002822, -0.019598, 1.016777));
const M709toP3 = mat3x3f(vec3f(0.822462, 0.177538, 0.0), vec3f(0.033194, 0.966806, 0.0), vec3f(0.017083, 0.072397, 0.910520));
const K2020 = vec3f(0.2627, 0.6780, 0.0593);
const K709 = vec3f(0.2126, 0.7152, 0.0722);

fn powp(x: vec3f, e: f32) -> vec3f { return pow(max(x, vec3f(1e-10)), vec3f(e)); }
// the look's luminance curve (nits): Yg = Y^g; ramp = ((Yg - k) / (1 - k))_+^p; N = W Yg (1 + (P / W - 1) ramp)
fn lookN(Yin: f32) -> f32 {
  let Y = max(Yin, 1e-6);
  let Yg = pow(Y, p.lg);
  let t = max((Yg - p.lk) / (1.0 - p.lk), 0.0);
  var ramp = 0.0;
  if (t > 0.0) { ramp = pow(t, p.lp); }
  return p.lW * Yg * (1.0 + (p.peak / p.lW - 1.0) * ramp);
}
// SDR code values -> linear BT.2020 nits through the look (rgb = l N / Y, chroma x sat around the new luminance)
fn curve(c: vec3f) -> vec3f {
  let l = max(powp(c, 2.4) * M709to2020, vec3f(0.0));
  let Y = max(dot(l, K2020), 1e-6);
  let rgb = l * (lookN(Y) / Y);
  let Yo = dot(rgb, K2020);
  return max(vec3f(Yo) + (rgb - vec3f(Yo)) * p.lsat, vec3f(0.0));
}
`;

const WGSL_FRAME = COMMON + /* wgsl */`
@group(0) @binding(2) var<storage, read_write> outw: array<u32>;
@group(0) @binding(3) var<storage, read> bn: array<f32>;

fn hlgFromNits(n: vec3f) -> vec3f {
  let fd = clamp(n / 1000.0, vec3f(0.0), vec3f(1.0));
  let yd = max(dot(fd, K2020), 1e-6);
  let e = clamp(fd * pow(yd, -0.2 / 1.2), vec3f(0.0), vec3f(1.0));
  let a = 0.17883277; let b = 0.28466892; let cc = 0.55991073;
  let lo = sqrt(3.0 * e);
  let hi = a * log(max(12.0 * e - vec3f(b), vec3f(1e-6))) + vec3f(cc);
  return select(hi, lo, e <= vec3f(1.0 / 12.0));
}
fn ycc(x: u32, y: u32) -> vec3f {
  let c = textureLoad(src, vec2i(i32(x), i32(y)), 0).rgb;
  let s = hlgFromNits(curve(c));
  let Y = dot(s, K2020);
  return vec3f(Y, (s.b - Y) / 1.8814, (s.r - Y) / 1.4746);
}
// the still dither in code values (TPDF, peak p.ditherAmp) for plane salt (0 = Y, 1 = Cb, 2 = Cr) at (x, y)
fn dith(x: u32, y: u32, salt: u32) -> f32 {
  if (p.dither == 0u) { return 0.0; }
  let ox = (salt * 23u) % 64u; let oy = (salt * 41u) % 64u;
  let u = bn[((y + oy) % 64u) * 64u + ((x + ox) % 64u)];
  var t: f32;
  if (u < 0.5) { t = sqrt(2.0 * u) - 1.0; } else { t = 1.0 - sqrt(2.0 - 2.0 * u); }
  return t * p.ditherAmp;
}
fn q8y(v: f32, n: f32) -> u32 { return u32(clamp(round(16.0 + 219.0 * v + n), 16.0, 235.0)); }
fn q8c(v: f32, n: f32) -> u32 { return u32(clamp(round(128.0 + 224.0 * v + n), 16.0, 240.0)); }

@compute @workgroup_size(64)
fn luma(@builtin(global_invocation_id) gid: vec3u) {
  let word = gid.x + gid.y * 4194240u;   // 65535 x 64 per row of workgroups
  if (word >= p.yWords) { return; }
  var v = 0u;
  for (var b = 0u; b < 4u; b++) {
    let i = word * 4u + b; let x = i % p.w; let y = i / p.w;
    v = v | (q8y(ycc(x, y).x, dith(x, y, 0u)) << (8u * b));
  }
  outw[word] = v;
}
@compute @workgroup_size(64)
fn chroma(@builtin(global_invocation_id) gid: vec3u) {
  let word = gid.x + gid.y * 4194240u;
  if (word >= p.cWords) { return; }
  let cw = p.w / 2u; let n = cw * (p.h / 2u);
  var vb = 0u; var vr = 0u;
  for (var b = 0u; b < 4u; b++) {
    let ci = word * 4u + b;
    if (ci >= n) { break; }
    let cx = ci % cw; let cy = ci / cw; let x = cx * 2u; let y = cy * 2u;
    let s = (ycc(x, y) + ycc(x + 1u, y) + ycc(x, y + 1u) + ycc(x + 1u, y + 1u)) * 0.25;
    vb = vb | (q8c(s.y, dith(cx, cy, 1u)) << (8u * b));
    vr = vr | (q8c(s.z, dith(cx, cy, 2u)) << (8u * b));
  }
  outw[p.cbOff / 4u + word] = vb;
  outw[p.crOff / 4u + word] = vr;
}
`;

const WGSL_PREVIEW = COMMON + /* wgsl */`
@group(0) @binding(2) var samp: sampler;
fn encExt(v: vec3f) -> vec3f {
  let a = abs(v);
  let hi = 1.055 * powp(a, 1.0 / 2.4) - vec3f(0.055);
  return sign(v) * select(hi, a * 12.92, a <= vec3f(0.0031308));
}
fn srgbLin(c: vec3f) -> vec3f { return select(powp((c + vec3f(0.055)) / 1.055, 2.4), c / 12.92, c <= vec3f(0.04045)); }
fn out2020(rel: vec3f) -> vec3f { if (p.p3 == 1u) { return encExt(rel * M2020toP3); } return encExt(rel * M2020to709); }
fn out709(rel: vec3f) -> vec3f { if (p.p3 == 1u) { return encExt(rel * M709toP3); } return encExt(rel); }
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(xy[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  if (abs(pos.x - p.split) < 1.0) { return vec4f(out709(vec3f(0.55)), 1.0); }
  let c = textureSampleLevel(src, samp, pos.xy / vec2f(p.cw, p.ch), 0.0).rgb;
  let before = pos.x < p.split;
  if (p.mode == 1u) {   // a picture: sRGB; the HDR side is what its gain map shows at full headroom
    let sdr = srgbLin(c);
    if (before) { return vec4f(out709(sdr), 1.0); }
    let Ys = dot(sdr, K709);
    let Yv = dot(powp(c, 2.4), K709);
    let o = 1.0 / 64.0;
    let hdr = lookN(Yv) / 203.0;
    return vec4f(out709(max((sdr + vec3f(o)) * ((hdr + o) / (Ys + o)) - vec3f(o), vec3f(0.0))), 1.0);
  }
  if (before) { return vec4f(out2020(max(powp(c, 2.4) * M709to2020, vec3f(0.0))), 1.0); }
  return vec4f(out2020(curve(c) / 203.0), 1.0);
}
`;

const PSIZE = 80;
function writeParams(o) {
  const ab = new ArrayBuffer(PSIZE), dv = new DataView(ab), L = o.look;
  const u = (i, v) => dv.setUint32(i * 4, v >>> 0, true), f = (i, v) => dv.setFloat32(i * 4, v, true);
  u(0, o.w || 0); u(1, o.h || 0); u(2, o.dither ? 1 : 0); f(3, o.ditherAmp == null ? 1 : o.ditherAmp);
  f(4, L.W); f(5, L.g); f(6, L.k); f(7, L.p);
  f(8, L.sat); f(9, o.peak || 1000); u(10, o.yWords || 0); u(11, o.cWords || 0);
  u(12, o.cbOff || 0); u(13, o.crOff || 0); u(14, o.mode || 0); f(15, o.split || 0);
  f(16, o.cw || 0); f(17, o.ch || 0); u(18, o.p3 ? 1 : 0); u(19, 0);
  return ab;
}
const groups = (n) => { const g = Math.ceil(n / 64); return g <= 65535 ? [g, 1] : [65535, Math.ceil(g / 65535)]; };

let SHARED = null;
/** the page's one small GPU device for Make HDR (kept between jobs; a lost device is made again on the next call) */
export async function hdrDevice() {
  if (SHARED && !SHARED.lost) return SHARED.device;
  if (typeof navigator === 'undefined' || !navigator.gpu) throw Object.assign(new Error('this browser has no WebGPU'), { code: 'UNSUPPORTED' });
  let adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw Object.assign(new Error('no GPU adapter'), { code: 'UNSUPPORTED' });
  const device = await adapter.requestDevice();
  const rec = { device, lost: false };
  device.lost.then(() => { rec.lost = true; });
  SHARED = rec;
  return device;
}

/** one size's frame pass: upload(source) a frame, run(look) -> the I420 bytes (valid until the next run or destroy) */
export class FramePass {
  constructor(device, { w, h, bn }) {
    if (w % 2 || h % 2) throw Object.assign(new Error('the size must be even'), { code: 'BAD_SIZE' });
    Object.assign(this, { device, w, h });
    const cn = (w / 2) * (h / 2);
    this.yWords = (w * h) / 4; this.cWords = Math.ceil(cn / 4); this.cbOff = w * h; this.crOff = this.cbOff + this.cWords * 4;
    this.bytes = this.crOff + this.cWords * 4; this.tight = cn % 4 === 0;
    this.tex = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    this.bn = device.createBuffer({ size: 64 * 64 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.bn, 0, bn);
    this.params = device.createBuffer({ size: PSIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.out = device.createBuffer({ size: this.bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.read = [0, 1].map(() => device.createBuffer({ size: this.bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
    this.slot = 0; this.mapped = null; this.uploadPath = null; this.canvas = null;
  }
  async init() {
    const d = this.device, m = d.createShaderModule({ code: WGSL_FRAME });
    d.pushErrorScope('validation');
    this.pl = await d.createComputePipelineAsync({ layout: 'auto', compute: { module: m, entryPoint: 'luma' } });
    this.pc = await d.createComputePipelineAsync({ layout: 'auto', compute: { module: m, entryPoint: 'chroma' } });
    const e = await d.popErrorScope(); if (e) throw Object.assign(new Error('HDR shader: ' + e.message), { code: 'GPU' });
    const entries = [{ binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: { buffer: this.out } }, { binding: 3, resource: { buffer: this.bn } }];
    this.bl = d.createBindGroup({ layout: this.pl.getBindGroupLayout(0), entries });
    this.bc = d.createBindGroup({ layout: this.pc.getBindGroupLayout(0), entries });
    return this;
  }
  setLook(look, { dither = true } = {}) {
    this.device.queue.writeBuffer(this.params, 0, writeParams({ w: this.w, h: this.h, dither, look, yWords: this.yWords, cWords: this.cWords, cbOff: this.cbOff, crOff: this.crOff }));
  }
  /** a VideoFrame / ImageBitmap / canvas / <video> -> the texture (the first frame finds a path that works: WebGPU's own copy, an
   *  ImageBitmap, or a 2D canvas; a path that throws or gives a blank frame is passed over, and a truly black first frame keeps the first
   *  path that did not throw) */
  async upload(source) {
    const d = this.device, w = this.w, h = this.h;
    // a frame whose display size is not the pass's (a clip with non-square pixels) is scaled to it, never cropped
    const sw = source.displayWidth || source.videoWidth || source.width, sh = source.displayHeight || source.videoHeight || source.height;
    if (sw && sh && (sw !== w || sh !== h)) {
      const b = await createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      try { d.queue.copyExternalImageToTexture({ source: b }, { texture: this.tex }, { width: w, height: h }); } finally { b.close(); }
      this.scaled = (this.scaled || 0) + 1; return;
    }
    const go = async (path) => {
      if (path === 'copy') d.queue.copyExternalImageToTexture({ source }, { texture: this.tex }, { width: w, height: h });
      else if (path === 'bitmap') { const b = await createImageBitmap(source); try { d.queue.copyExternalImageToTexture({ source: b }, { texture: this.tex }, { width: w, height: h }); } finally { b.close(); } }
      else {
        if (!this.canvas) { this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }); this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }); }
        this.ctx.drawImage(source, 0, 0, w, h);
        d.queue.writeTexture({ texture: this.tex }, this.ctx.getImageData(0, 0, w, h).data, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
      }
    };
    if (this.uploadPath) return go(this.uploadPath);
    let firstOk = null; const tried = [];
    for (const path of ['copy', 'bitmap', 'canvas']) {
      d.pushErrorScope('validation');
      let e = null; try { await go(path); } catch (x) { e = x; }
      const v = await d.popErrorScope();
      if (e || v) { tried.push(`${path}: ${e ? e.message : v.message}`); continue; }
      if (!firstOk) firstOk = path;
      if (await this.notBlank()) { this.uploadPath = path; return; }
      tried.push(`${path}: blank`);
    }
    if (firstOk) { this.uploadPath = firstOk; return go(firstOk); }
    throw Object.assign(new Error('the frame could not reach the GPU: ' + tried.join(' | ')), { code: 'GPU' });
  }
  async notBlank() {
    const d = this.device, bpr = Math.ceil((this.w * 4) / 256) * 256, buf = d.createBuffer({ size: bpr * this.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const enc = d.createCommandEncoder(); enc.copyTextureToBuffer({ texture: this.tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: this.h }, [this.w, this.h, 1]);
      d.queue.submit([enc.finish()]); await buf.mapAsync(GPUMapMode.READ);
      const u8 = new Uint8Array(buf.getMappedRange()); let s = 0;
      for (let y = 0; y < this.h; y += 8) for (let x = 0; x < this.w; x += 8) { const o = y * bpr + x * 4; s += u8[o] + u8[o + 1] + u8[o + 2]; }
      buf.unmap(); return s > 0;
    } finally { buf.destroy(); }
  }
  /** convert the uploaded frame -> Uint8Array I420 (w*h + 2 * (w/2)*(h/2) bytes); the view stays valid until the next run */
  async run() {
    const d = this.device;
    if (this.mapped) { this.mapped.unmap(); this.mapped = null; }
    const rb = this.read[this.slot]; this.slot ^= 1;
    const enc = d.createCommandEncoder(), cp = enc.beginComputePass();
    cp.setPipeline(this.pl); cp.setBindGroup(0, this.bl); cp.dispatchWorkgroups(...groups(this.yWords));
    cp.setPipeline(this.pc); cp.setBindGroup(0, this.bc); cp.dispatchWorkgroups(...groups(this.cWords));
    cp.end(); enc.copyBufferToBuffer(this.out, 0, rb, 0, this.bytes);
    d.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    this.mapped = rb;
    const all = new Uint8Array(rb.getMappedRange());
    if (this.tight) return all.subarray(0, (this.w * this.h * 3) / 2);
    const cn = (this.w / 2) * (this.h / 2), out = new Uint8Array(this.w * this.h + 2 * cn);   // an odd chroma plane: packed tight on the CPU
    out.set(all.subarray(0, this.w * this.h)); out.set(all.subarray(this.cbOff, this.cbOff + cn), this.w * this.h); out.set(all.subarray(this.crOff, this.crOff + cn), this.w * this.h + cn);
    return out;
  }
  destroy() {
    if (this.mapped) { try { this.mapped.unmap(); } catch (e) { /* */ } this.mapped = null; }
    for (const b of [this.tex, this.bn, this.params, this.out, ...this.read]) { try { b.destroy(); } catch (e) { /* */ } }
  }
}

/** the extended-range canvas: the first configuration that sticks -> {format, colorSpace, extended (true / false / 'unknown')} | null */
export function configureHdrCanvas(device, ctx) {
  const pref = navigator.gpu.getPreferredCanvasFormat();
  for (const t of [{ format: 'rgba16float', colorSpace: 'display-p3', toneMapping: { mode: 'extended' } }, { format: 'rgba16float', colorSpace: 'srgb', toneMapping: { mode: 'extended' } }, { format: pref }]) {
    try {
      ctx.configure({ device, alphaMode: 'opaque', ...t });
      const g = ctx.getConfiguration ? ctx.getConfiguration() : null;
      const extended = g ? !!(g.toneMapping && (g.toneMapping.mode || g.toneMapping) === 'extended') : t.toneMapping ? 'unknown' : false;
      return { format: t.format, colorSpace: t.colorSpace || 'srgb', extended };
    } catch (e) { /* the next one */ }
  }
  return null;
}

/** the sheet's before / after: a source (ImageBitmap) drawn on a configured canvas context; draw({look, split (px), mode}) re-renders */
export class Preview {
  constructor(device, ctx, cfg, source) {
    Object.assign(this, { device, ctx, cfg });
    this.tex = device.createTexture({ size: [source.width, source.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source }, { texture: this.tex }, { width: source.width, height: source.height });
    this.samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.ub = device.createBuffer({ size: PSIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  async init() {
    const d = this.device, m = d.createShaderModule({ code: WGSL_PREVIEW });
    d.pushErrorScope('validation');
    this.pipe = await d.createRenderPipelineAsync({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: this.cfg.format }] }, primitive: { topology: 'triangle-list' } });
    const e = await d.popErrorScope(); if (e) throw Object.assign(new Error('HDR preview: ' + e.message), { code: 'GPU' });
    this.bg = d.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.ub } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: this.samp }] });
    return this;
  }
  draw({ look, split, mode = 0, cw, ch }) {
    const d = this.device;
    d.queue.writeBuffer(this.ub, 0, writeParams({ look, split, mode, cw, ch, p3: this.cfg.colorSpace === 'display-p3' }));
    const enc = d.createCommandEncoder();
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    rp.setPipeline(this.pipe); rp.setBindGroup(0, this.bg); rp.draw(3); rp.end();
    d.queue.submit([enc.finish()]);
  }
  destroy() { for (const b of [this.tex, this.ub]) { try { b.destroy(); } catch (e) { /* */ } } try { this.ctx.unconfigure(); } catch (e) { /* */ } }
}
export { WGSL_FRAME, WGSL_PREVIEW };
