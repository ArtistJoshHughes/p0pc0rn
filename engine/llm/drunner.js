// The decode loop's own dispatch recorder (p0pc0rn v044, 10-21: round 2 of the assistant's chat speed).  LLM-local: the picture / video
// engines keep core/gpu.js's Runner exactly as it is.
//   One decode token = one command buffer, recorded while the GPU still runs the previous token and submitted the moment that token's id
//   is known (its uniforms are written right before the submit).  Every buffer a decode token binds is persistent, so each dispatch's bind
//   group is made once and reused for the rest of the answer: slot k of the uniform buffer of the token's parity + the same storage
//   bindings.  On an iPhone, ~10 ms of encoding per token was measured with every bind group rebuilt (the core Runner drops its
//   cache on every buffer free and moves its uniform ring on every token) and ~22 ms of GPU idle per token while the CPU prepared the next.
//   The ops call g.runner.dispatch / copy as always: the decode loop points g.runner at this recorder while it records a token.
'use strict';

const SLOT = 256;   // bytes of uniforms per dispatch (the ops' P() blocks are 256 B)

export class DecodeRunner {
  /** cap = most dispatches in one token (Gemma 4 E2B: ~500); timer = GPU timestamps per compute pass (measurements only) */
  constructor(g, { cap = 1024, timer = false, stage = 16 } = {}) {   // v047: stage = result bytes per item (spec passes: 128)
    const d = g.device, U = GPUBufferUsage;
    this.g = g; this.core = g.runner; this.cap = cap; this.SLOT = SLOT;
    this.ub = [0, 1].map((p) => d.createBuffer({ size: SLOT * cap, usage: U.UNIFORM | U.COPY_DST, label: 'decode-uniforms-' + p }));
    this.data = [0, 1].map(() => new ArrayBuffer(SLOT * cap));
    this.stageBytes = Math.max(16, Math.ceil(stage / 4) * 4);
    this.stage = [0, 1].map((p) => d.createBuffer({ size: this.stageBytes, usage: U.MAP_READ | U.COPY_DST, label: 'decode-argmax-' + p }));
    this.bg = new Map(); this.ids = new WeakMap(); this.nid = 0;
    this.bgNew = 0; this.bgHit = 0; this.dispatches = 0; this.submits = 0; this.cur = null;
    this.timer = null;
    if (timer && d.features.has('timestamp-query')) {
      this.timer = { busyMs: 0, tokens: 0, bad: 0, parts: [0, 0, 0, 0] };   // v047: parts = per compute pass of an item
      this.tq = [0, 1].map(() => d.createQuerySet({ type: 'timestamp', count: 8 }));
      this.tres = [0, 1].map(() => d.createBuffer({ size: 64, usage: U.QUERY_RESOLVE | U.COPY_SRC, label: 'decode-ts' }));
      this.trd = [0, 1].map(() => d.createBuffer({ size: 64, usage: U.MAP_READ | U.COPY_DST, label: 'decode-ts-read' }));
      this.tpend = [null, null];
    }
  }
  _id(o) { let i = this.ids.get(o); if (i == null) { i = ++this.nid; this.ids.set(o, i); } return i; }

  /** start recording a token; parity = token index % 2 (its uniform buffer and argmax staging buffer) */
  begin(parity) {
    if (this.cur) throw new Error('DecodeRunner: a token is already being recorded');
    this.cur = { parity, enc: this.g.device.createCommandEncoder({ label: 'decode-token' }), pass: null, n: 0, tn: 0, data: this.data[parity] };
  }
  _pass(c) {
    if (c.pass) return c.pass;
    let desc;
    if (this.timer && c.tn + 2 <= 8) { desc = { timestampWrites: { querySet: this.tq[c.parity], beginningOfPassWriteIndex: c.tn, endOfPassWriteIndex: c.tn + 1 } }; c.tn += 2; }
    c.pass = c.enc.beginComputePass(desc);
    return c.pass;
  }
  /** the core Runner's signature: pipeline, storage bindings, params (<= 256 B), workgroups (the time estimate is not needed here) */
  dispatch(pipe, bindings, params, wg) {
    const c = this.cur;
    if (!c) throw new Error('DecodeRunner: dispatch outside a token');
    if (c.n >= this.cap) throw new Error(`DecodeRunner: more than ${this.cap} dispatches in one token`);
    bindings = bindings.map((b) => this.core._fit(b));
    const slot = c.n++;
    new Uint8Array(c.data, slot * SLOT, params.byteLength).set(new Uint8Array(params));
    let key = `${pipe._key || this._id(pipe)}|${c.parity}|${slot}`;
    for (const b of bindings) key += b instanceof GPUBuffer ? `|${this._id(b)}` : `|${this._id(b.buffer)}:${b.offset || 0}:${b.size == null ? '' : b.size}`;
    let bg = this.bg.get(key);
    if (bg) this.bgHit++;
    else {
      const entries = [{ binding: 0, resource: { buffer: this.ub[c.parity], offset: slot * SLOT, size: SLOT } }];
      bindings.forEach((b, i) => entries.push({ binding: i + 1, resource: b instanceof GPUBuffer ? { buffer: b } : b }));
      bg = this.g.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }); this.bgNew++;
      this.bg.set(key, bg);
    }
    const pass = this._pass(c);
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(wg[0], wg[1] || 1, wg[2] || 1);
    this.dispatches++;
  }
  /** copy between buffers inside the token (ends the compute pass, like the core Runner) */
  copy(src, srcOff, dst, dstOff, size) {
    const c = this.cur;
    if (!c) throw new Error('DecodeRunner: copy outside a token');
    if (c.pass) { c.pass.end(); c.pass = null; }
    c.enc.copyBufferToBuffer(src, srcOff, dst, dstOff, size);
  }
  /** v047: end the current compute pass (the next dispatch starts a new one: a separate GPU timer part) */
  split() { const c = this.cur; if (c && c.pass) { c.pass.end(); c.pass = null; } }
  flush() { /* a token is submitted by submit() */ }
  sync() { /* the parities never move */ }
  forget() { this.bg.clear(); }   // only if a buffer were freed while recording (the decode path frees none)

  /** finish recording: the token's result (argmax, max logit: 8 bytes at the front of argBuf) goes to the parity's staging buffer */
  end(argBuf, bytes = 16) {
    const c = this.cur; this.cur = null;
    if (!c) throw new Error('DecodeRunner: end without begin');
    if (c.pass) { c.pass.end(); c.pass = null; }
    if (this.timer && c.tn) { c.enc.resolveQuerySet(this.tq[c.parity], 0, c.tn, this.tres[c.parity], 0); c.enc.copyBufferToBuffer(this.tres[c.parity], 0, this.trd[c.parity], 0, c.tn * 8); }
    const nb = Math.min(this.stageBytes, Math.ceil(bytes / 4) * 4);
    c.enc.copyBufferToBuffer(argBuf, 0, this.stage[c.parity], 0, nb);
    return { parity: c.parity, cmd: c.enc.finish(), n: c.n, tn: c.tn, data: c.data, bytes: nb };
  }
  /** write the token's uniforms, submit it -> a promise of Uint32Array [argmax, max-logit bits, ...] once the GPU has finished it */
  submit(tk) {
    const p = tk.parity;
    if (this.timer && this.tpend[p]) { const w = this.tpend[p]; this.tpend[p] = null; return w.then(() => this._submit(tk)); }   // its read buffer is unmapped first
    return this._submit(tk);
  }
  _submit(tk) {
    const p = tk.parity, q = this.g.device.queue;
    if (tk.n) q.writeBuffer(this.ub[p], 0, tk.data, 0, tk.n * SLOT);
    q.submit([tk.cmd]); this.submits++;
    if (this.timer && tk.tn) {
      const rd = this.trd[p], n = tk.tn, T = this.timer;
      this.tpend[p] = rd.mapAsync(GPUMapMode.READ, 0, n * 8).then(() => {
        const t = new BigUint64Array(rd.getMappedRange(0, n * 8).slice(0)); rd.unmap();
        for (let i = 0; i < n; i += 2) { if (t[i + 1] >= t[i]) { const ms = Number(t[i + 1] - t[i]) / 1e6; T.busyMs += ms; T.parts[i >> 1] += ms; } else T.bad++; }
        T.tokens++;
      }).catch(() => { T.bad++; });
    }
    const st = this.stage[p], nb = tk.bytes || 16;
    this.maps = (this.maps || 0) + 1;   // 3.8 port (bench v045): reads still pending (a kept recorder is only reused with none)
    return st.mapAsync(GPUMapMode.READ, 0, nb).then(() => { this.maps--; const o = new Uint32Array(st.getMappedRange(0, nb).slice(0)); st.unmap(); return o; }, (e) => { this.maps--; throw e; });
  }
  /** after the last token: wait for the timer reads, then free the recorder's buffers (the GPU has finished every submitted token) */
  async destroy() {
    if (this.timer) for (const w of this.tpend) if (w) { try { await w; } catch (e) { /* */ } }
    try { await this.g.device.queue.onSubmittedWorkDone(); } catch (e) { /* */ }
    for (const b of [...this.ub, ...this.stage, ...(this.tres || []), ...(this.trd || [])]) { try { b.destroy(); } catch (e) { /* */ } }
    for (const s of this.tq || []) { try { s.destroy(); } catch (e) { /* */ } }
    this.bg.clear();
  }
}
