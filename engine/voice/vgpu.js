// Pocket Flux engine core: device, buffer accounting, pipeline cache, batched dispatch runner.
// Pure JS (ES module), no dependencies, no wasm.  See docs/ARCHITECTURE.md section 2.
'use strict';

const U = () => GPUBufferUsage;
export const MB = 1e6;

/** v026.9: workgroup bytes a WGSL module declares (arrays of scalars / vectors; unknown element types count 4 bytes) */
function wgBytesOf(code) {
  const SZ = { f16: 2, f32: 4, i32: 4, u32: 4, 'vec2<f16>': 4, 'vec4<f16>': 8, 'vec2<f32>': 8, 'vec2<u32>': 8, 'vec4<f32>': 16, 'vec4<u32>': 16, 'vec3<f32>': 16, 'atomic<u32>': 4, 'atomic<i32>': 4 };
  const re = /var<workgroup>\s+\w+\s*:\s*(array<\s*([a-z0-9<>]+)\s*,\s*(\d+)\s*>|[a-z0-9<>]+)\s*;/g; let m, n = 0;
  while ((m = re.exec(code))) n += m[2] ? (SZ[m[2]] || 4) * Number(m[3]) : (SZ[m[1]] || 4);
  return n;
}
export class GpuError extends Error {}

/** Create the GPU context.  opts: {powerPreference, wantSubgroups=true, wantF16=true, maxDispatchSeconds=0.2, onLost(info)} */
export async function createGpu(opts = {}) {
  if (!globalThis.navigator || !navigator.gpu) throw new GpuError('WebGPU is not available (navigator.gpu missing)');
  const g = new Gpu(opts);
  await g.init();
  return g;
}

export class Gpu {
  constructor(opts) {
    this.opts = Object.assign({ powerPreference: 'high-performance', wantSubgroups: true, wantF16: true, maxDispatchSeconds: 0.2 }, opts);
    this.alive = 0; this.peak = 0; this.bufs = new Set();
    // p0pc0rn probes v002 (Oct 14): a recycling pool. With recycling on, free() keeps the buffer (still counted in `alive`) and buffer()
    // hands it out again: a step / tile / part that allocates the same sizes as the one before creates and destroys NOTHING (WebKit gives
    // destroyed GPU memory back late: per-step create / destroy churn killed the page ~50 s after big unloads). drainPool() destroys them
    // at the end of a stage. Exact size first, else the smallest free buffer up to 2x the size (the last, shorter part).
    this.freeBy = new Map(); this.pooled = 0; this.pooledN = 0; this.recycling = false; this.creates = 0; this.destroys = 0; this.reuses = 0;
    this.pipes = new Map();
    this.lostInfo = null;
    // FLOP/s assumed for dispatch sizing until calibrate() measures it (conservative = the slow desktop iGPU)
    this.rate = { mm: 0.2e12, attn: 0.08e12, mem: 20e9 };
  }

  async init() {
    const ad = await navigator.gpu.requestAdapter({ powerPreference: this.opts.powerPreference });
    if (!ad) throw new GpuError('no WebGPU adapter');
    this.adapter = ad;
    const info = ad.info || {};
    this.info = { vendor: info.vendor || '', architecture: info.architecture || '', device: info.device || '', description: info.description || '' };
    const feats = [];
    this.f16 = ad.features.has('shader-f16');
    if (!this.f16) throw new GpuError('shader-f16 is required (all target devices have it)');
    feats.push('shader-f16');
    this.subgroups = !!(this.opts.wantSubgroups && ad.features.has('subgroups'));
    if (this.subgroups) feats.push('subgroups');
    if (ad.features.has('timestamp-query') && this.opts.timestamps) feats.push('timestamp-query');
    const L = ad.limits;
    const want = {
      maxBufferSize: L.maxBufferSize,
      maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupSizeX: L.maxComputeWorkgroupSizeX,
      maxStorageBuffersPerShaderStage: L.maxStorageBuffersPerShaderStage,
    };
    this.device = await ad.requestDevice({ requiredFeatures: feats, requiredLimits: want });
    this.limits = this.device.limits;
    // subgroup size range (Chrome exposes adapter.info.subgroupMinSize / MaxSize); kernels that rely on lane groups of 16 check this
    this.sgMin = info.subgroupMinSize || 0; this.sgMax = info.subgroupMaxSize || 0;
    this.sgOK16 = this.subgroups && this.sgMin >= 16;
    this.device.lost.then((li) => {
      this.lostInfo = { reason: li && li.reason, message: li && li.message, t: Date.now() };
      if (this.opts.onLost) try { this.opts.onLost(this.lostInfo); } catch (e) { /* ignore */ }
    });
    this.device.addEventListener('uncapturederror', (ev) => {
      this.lastError = (ev.error && ev.error.message) || String(ev.error);
      if (this.opts.onError) this.opts.onError(this.lastError); else console.error('[gpu] ' + this.lastError);
    });
    this.runner = new Runner(this);
    // probes v002: a recycled buffer freed while the batch now open was being recorded may still be read by a dispatch of that batch;
    // a CPU write to it (upload / writeBuffer) first submits the batch. GPU writes need nothing (dispatches are ordered).
    const q = this.device.queue, wb = q.writeBuffer.bind(q), self = this;
    q.writeBuffer = function (buf, ...rest) { const R = self.runner; if (buf && buf._fb != null && R && R.cur && buf._fb === R.submits) R.flush(); return wb(buf, ...rest); };
  }

  get lost() { return !!this.lostInfo; }
  describe() {
    return Object.assign({}, this.info, { f16: this.f16, subgroups: this.subgroups, sgMin: this.sgMin, sgMax: this.sgMax,
      maxBufferMB: Math.round(this.limits.maxBufferSize / 1048576), maxBindMB: Math.round(this.limits.maxStorageBufferBindingSize / 1048576),
      wgMem: this.limits.maxComputeWorkgroupStorageSize, wgInv: this.limits.maxComputeInvocationsPerWorkgroup });
  }

  // ------------------------------------------------------------------ buffers (every live byte is counted; iOS kills the page ~1.5 GB)
  buffer(size, label = '', usage = 0) {
    size = Math.max(16, Math.ceil(size / 16) * 16);
    if (size > this.limits.maxBufferSize) throw new GpuError(`buffer ${label} ${size} B exceeds maxBufferSize`);
    if (this.recycling && !usage) {
      const r = this._take(size);
      if (r) {   // (a CPU write to it waits for the batch that may still read its old contents: see the queue.writeBuffer guard in init)
        this.bufs.add(r); this.pooled -= r._pf; this.pooledN--; this.reuses++;
        return r;
      }
    }
    const b = this.device.createBuffer({ size, label, usage: usage || (U().STORAGE | U().COPY_DST | U().COPY_SRC) });
    b._pf = size; b._rc = !usage; this.bufs.add(b); this.alive += size; this.creates++;
    if (this.alive > this.peak) this.peak = this.alive;
    return b;
  }
  _take(size) {
    const ex = this.freeBy.get(size);
    if (ex && ex.length) return ex.pop();
    let best = 0;
    for (const [k, l] of this.freeBy) if (l.length && k > size && k <= 2 * size && (!best || k < best)) best = k;
    return best ? this.freeBy.get(best).pop() : null;
  }
  free(b) {
    if (!b || !this.bufs.has(b)) return;
    this.bufs.delete(b);
    if (this.recycling && b._rc) {   // kept for the next step (bind groups that use it stay valid: it is not destroyed)
      let l = this.freeBy.get(b._pf); if (!l) this.freeBy.set(b._pf, (l = []));
      l.push(b); this.pooled += b._pf; this.pooledN++; b._fb = this.runner && this.runner.cur ? this.runner.submits : -1;
      return;
    }
    this.alive -= b._pf;
    if (this.runner) this.runner.forget();   // p0pc0rn v024.2: no cached bind group may outlive a buffer it binds
    b.destroy(); this.destroys++;
  }
  /** probes v002: recycle freed buffers (on) / stop and destroy the pool (off) */
  recycle(on) { this.recycling = !!on; if (!on) this.drainPool(); }
  /** probes v002: destroy every pooled buffer (end of a stage) -> bytes destroyed */
  drainPool() {
    let n = 0;
    for (const l of this.freeBy.values()) for (const b of l) { this.alive -= b._pf; n += b._pf; try { b.destroy(); } catch (e) { /* */ } this.destroys++; }
    this.freeBy.clear(); this.pooled = 0; this.pooledN = 0;
    if (n && this.runner) this.runner.forget();
    return n;
  }
  freeAll() { const r = this.recycling; this.recycling = false; for (const b of Array.from(this.bufs)) this.free(b); this.drainPool(); this.recycling = r; }
  /** probes v002: counters for the per-step log */
  stats() {
    const r = this.runner || {};
    return { aliveMB: Math.round(this.alive / 1e6), peakMB: Math.round(this.peak / 1e6), pooledMB: Math.round(this.pooled / 1e6), bufs: this.bufs.size + this.pooledN,
      creates: this.creates, destroys: this.destroys, reuses: this.reuses, bindGroups: r.bgNew || 0, bgHits: r.bgHit || 0, ubs: r.ubs || 0, tempUbs: r.temps || 0, readbacks: this.readbacks || 0 };
  }
  resetPeak() { this.peak = this.alive; }
  /** upload a TypedArray / ArrayBuffer into a NEW buffer (or into dst at dstOff) */
  upload(data, label = '', dst = null, dstOff = 0) {
    const ab = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const b = dst || this.buffer(ab.byteLength, label);
    const n = ab.byteLength - (ab.byteLength % 4);
    if (n) this.device.queue.writeBuffer(b, dstOff, ab.buffer, ab.byteOffset, n);
    if (n < ab.byteLength) { const t = new Uint8Array(4); t.set(ab.subarray(n)); this.device.queue.writeBuffer(b, dstOff + n, t); }
    return b;
  }
  /** read back [off, off+size) of a buffer as an ArrayBuffer (flushes the runner first) */
  async read(buf, off = 0, size = null) {
    size = size == null ? buf._pf - off : size;
    return this._readback(buf, off, size, (m) => m.slice(0, size));
  }
  /** p0pc0rn v024.2: read back into the caller's TypedArray (no new ArrayBuffer per read); -> dst */
  async readInto(buf, off, size, dst) {
    return this._readback(buf, off, size, (m) => { new Uint8Array(dst.buffer, dst.byteOffset, size).set(new Uint8Array(m, 0, size)); return dst; });
  }
  /** p0pc0rn v024.2: ONE reusable MAP_READ staging buffer (grows to the largest read up to 16 MB; bigger reads get their own), mapped,
   *  copied out and unmapped every time. WebKit gives destroyed buffers back late: a new staging buffer per read (256 KB per planner
   *  token, ~2 MB per decoder part) piled up. Reads are serialised (one mapping at a time). */
  _readback(buf, off, size, take) {
    this.runner.flush();
    const n = Math.ceil(size / 4) * 4;
    const go = async () => {
      let rb = null, own = false;
      if (n <= 16e6) {
        if (!this._rb || this._rb.size < n) {
          if (this._rb) this._rb.destroy();
          let s = 1 << 20; while (s < n) s *= 2;
          this._rb = this.device.createBuffer({ size: s, usage: U().MAP_READ | U().COPY_DST, label: 'readback' }); this.readbacks = (this.readbacks || 0) + 1;
        }
        rb = this._rb;
      } else { rb = this.device.createBuffer({ size: n, usage: U().MAP_READ | U().COPY_DST }); own = true; }
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(buf, off, rb, 0, n);
      this.device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ, 0, n);
      try { return take(rb.getMappedRange(0, n)); } finally { rb.unmap(); if (own) rb.destroy(); }
    };
    const p = (this._rq || Promise.resolve()).then(go, go);
    this._rq = p.catch(() => {});
    return p;
  }
  async done() {
    this.runner.flush();
    if (this.lost) throw new GpuError('GPU device lost: ' + JSON.stringify(this.lostInfo));
    await this.device.queue.onSubmittedWorkDone();
    this.runner.sync();   // v024.2: the uniform ring starts over (the same work -> the same bind groups)
    if (this.lost) throw new GpuError('GPU device lost: ' + JSON.stringify(this.lostInfo));
  }

  // ------------------------------------------------------------------ pipelines
  pipeline(key, codeFn) {
    let p = this.pipes.get(key);
    if (p) return p;
    const code = codeFn();
    const wl = this.limits && this.limits.maxComputeWorkgroupStorageSize, wb = wl ? wgBytesOf(code) : 0;   // v026.9: fail loudly, never draw garbage
    if (wl && wb > wl) throw new Error(`This GPU allows ${wl} bytes of workgroup memory; the kernel ${key} needs ${wb}`);
    const mod = this.device.createShaderModule({ code, label: key });
    p = this.device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' }, label: key });
    p._key = key; p._code = code; p._mod = mod;
    this.pipes.set(key, p);
    return p;
  }
  async checkPipeline(p) {   // surface WGSL compile errors with line numbers (tests call this)
    const ci = await p._mod.getCompilationInfo();
    const errs = ci.messages.filter((m) => m.type === 'error');
    if (errs.length) throw new GpuError(`WGSL ${p._key}: ` + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | '));
  }

  /** seconds a dispatch of `flops` FLOPs of kind may take -> max FLOPs per dispatch (~0.2 s, the OS GPU watchdog guard) */
  cap(kind = 'mm') { return this.rate[kind] * this.opts.maxDispatchSeconds; }
}

/** Batches dispatches into command buffers.  Uniform params of a batch live in one uniform buffer written right before submit.
 *  A batch is submitted when its estimated GPU time reaches `batchSeconds` (keeps the GPU fed without long stalls) or it is full. */
export class Runner {
  constructor(gpu) {
    this.g = gpu; this.SLOT = 256; this.CAP = 512; this.batchSeconds = 0.08;
    this.pool = []; this.cur = null; this.submits = 0; this.dispatches = 0;
    // p0pc0rn v024.2: bind groups cached by (pipeline, uniform buffer, slot, bindings); bounded; dropped whenever a buffer is freed
    this.bg = new Map(); this.bgNew = 0; this.bgHit = 0; this.ids = new WeakMap(); this.nid = 0; this.ubs = 0; this.ri = 0;
  }
  _id(o) { let i = this.ids.get(o); if (i == null) { i = ++this.nid; this.ids.set(o, i); } return i; }
  forget() { if (this.bg.size) this.bg.clear(); }
  /** p0pc0rn v024.2: the uniform buffers are a fixed ring (up to 64, never destroyed while the device lives), taken in order from the
   *  start after every full sync (Gpu.done / a read): the same work after a sync uses the same buffers and slots, so its bind groups
   *  come from the cache. A ring buffer still in flight is skipped (never written while the GPU reads it). Each keeps its own CPU copy. */
  _ub() {
    const d = this.g.device, R = this.pool, K = 64;
    for (let k = 0; k < Math.max(1, R.length); k++) {
      const i = (this.ri + k) % K;
      if (i >= R.length) break;
      if (!R[i]._busy) { this.ri = (i + 1) % K; return R[i]; }
    }
    const ub = d.createBuffer({ size: this.SLOT * this.CAP, usage: U().UNIFORM | U().COPY_DST, label: 'uniform-batch' }); ub._data = new ArrayBuffer(this.SLOT * this.CAP); this.ubs++;
    if (R.length < K) { R.push(ub); this.ri = R.length % K; } else { ub._temp = true; this.temps = (this.temps || 0) + 1; }   // all 64 in flight: a temporary one (destroyed when done)
    return ub;
  }
  sync() { this.ri = 0; }   // everything submitted has finished
  _begin() {
    const d = this.g.device, ub = this._ub();
    this.cur = { enc: d.createCommandEncoder(), pass: null, ub, data: ub._data, n: 0, sec: 0 };
  }
  /** pipeline, list of storage bindings ({buffer, offset, size} | GPUBuffer), params (ArrayBuffer <= 256 B), workgroups [x,y,z], est seconds */
  /** v026.9: a storage binding never larger than maxStorageBufferBindingSize (an open-ended arena view is cut to it) */
  _fit(b) {
    const lim = this.g.limits && this.g.limits.maxStorageBufferBindingSize; if (!lim) return b;
    const buf = b instanceof GPUBuffer ? b : b.buffer, off = b instanceof GPUBuffer ? 0 : (b.offset || 0);
    const size = b instanceof GPUBuffer || b.size == null ? buf.size - off : b.size;
    if (size <= lim) return b;
    this.cuts = (this.cuts || 0) + 1; if (!this.cutLabels) this.cutLabels = new Set(); if (this.cutLabels.size < 32) this.cutLabels.add(String(buf.label || '?'));
    try { const G = globalThis.__pfBindCuts || (globalThis.__pfBindCuts = {}); const k = String(buf.label || '?') + ' ' + Math.round(size / 1048576) + ' MB'; G[k] = (G[k] || 0) + 1; } catch (e) { /* */ }
    return { buffer: buf, offset: off, size: Math.floor(lim / 256) * 256 };
  }
  dispatch(pipe, bindings, params, wg, sec = 0) {
    bindings = bindings.map((b) => this._fit(b));   // v026.9
    if (!this.cur) this._begin();
    const c = this.cur;
    if (!c.pass) c.pass = c.enc.beginComputePass();
    const slot = c.n++;
    new Uint8Array(c.data, slot * this.SLOT, params.byteLength).set(new Uint8Array(params));
    let key = `${pipe._key || this._id(pipe)}|${this._id(c.ub)}|${slot}`;
    for (const b of bindings) key += b instanceof GPUBuffer ? `|${this._id(b)}` : `|${this._id(b.buffer)}:${b.offset || 0}:${b.size == null ? '' : b.size}`;
    let bg = this.bg.get(key);
    if (bg) this.bgHit++;
    else {
      const entries = [{ binding: 0, resource: { buffer: c.ub, offset: slot * this.SLOT, size: this.SLOT } }];
      bindings.forEach((b, i) => entries.push({ binding: i + 1, resource: b instanceof GPUBuffer ? { buffer: b } : b }));
      bg = this.g.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }); this.bgNew++;
      if (this.bg.size >= 8192) { let k = 0; for (const x of this.bg.keys()) { this.bg.delete(x); if (++k >= 2048) break; } }
      this.bg.set(key, bg);
    }
    c.pass.setPipeline(pipe); c.pass.setBindGroup(0, bg);
    c.pass.dispatchWorkgroups(wg[0], wg[1] || 1, wg[2] || 1);
    c.sec += sec; this.dispatches++;
    if (c.n >= this.CAP || c.sec >= this.batchSeconds) this.flush();
  }
  /** copy between buffers inside the current batch (ends the compute pass) */
  copy(src, srcOff, dst, dstOff, size) {
    if (!this.cur) this._begin();
    const c = this.cur;
    if (c.pass) { c.pass.end(); c.pass = null; }
    c.enc.copyBufferToBuffer(src, srcOff, dst, dstOff, size);
  }
  flush() {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    if (c.pass) c.pass.end();
    const q = this.g.device.queue;
    if (c.n) q.writeBuffer(c.ub, 0, c.data, 0, c.n * this.SLOT);
    q.submit([c.enc.finish()]);
    this.submits++;
    c.ub._busy = true;
    q.onSubmittedWorkDone().then(() => { c.ub._busy = false; if (c.ub._temp) { this.forget(); c.ub.destroy(); this.ubs--; } });   // v024.2: the ring keeps them
  }
}

/** Uniform params helper: P().u32(a).f32(b)... .ab  (all fields 4 B, std140-free because every struct member is a scalar) */
export function P() {
  const ab = new ArrayBuffer(256), u = new Uint32Array(ab), f = new Float32Array(ab);
  let i = 0;
  const o = { u32(v) { u[i++] = v >>> 0; return o; }, i32(v) { u[i++] = v | 0; return o; }, f32(v) { f[i++] = v; return o; },
    get ab() { return ab.slice(0, Math.max(16, Math.ceil(i / 4) * 16)); }, get n() { return i; } };
  return o;
}

/** binding helper: a tensor view {buffer, offset, size} with 4-byte multiple size */
export function view(buffer, offset = 0, size = null) {
  size = size == null ? buffer._pf - offset : size;
  return { buffer, offset, size: Math.ceil(size / 4) * 4 };
}

// ------------------------------------------------------------------ fp16 helpers (CPU side)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function f2h(v) {
  _f[0] = v; const x = _u[0];
  const sign = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff; let m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  const ne = e - 112;
  if (ne >= 0x1f) return sign | 0x7c00;
  if (ne <= 0) {
    if (ne < -10) return sign;
    m |= 0x800000; const sh = 14 - ne; let hm = m >>> sh; const rem = m & ((1 << sh) - 1), half = 1 << (sh - 1);
    if (rem > half || (rem === half && (hm & 1))) hm++;
    return sign | hm;
  }
  let r = sign | (ne << 10) | (m >>> 13); const rem2 = m & 0x1fff;
  if (rem2 > 0x1000 || (rem2 === 0x1000 && (r & 1))) r++;
  return r;
}
export function h2f(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}
export function toF16(f32arr) { const o = new Uint16Array(f32arr.length); for (let i = 0; i < f32arr.length; i++) o[i] = f2h(f32arr[i]); return o; }
export function fromF16(u16) { const o = new Float32Array(u16.length); for (let i = 0; i < u16.length; i++) o[i] = h2f(u16[i]); return o; }
