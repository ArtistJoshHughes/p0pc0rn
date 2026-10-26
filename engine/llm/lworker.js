// 3.8 (from the phone bench v036-v040): the worker part of a split model (engine/llm/split.js), a module SHARED worker. The app's
// service worker (sw.js) serves this file as lworker_coep.js with Cross-Origin-Embedder-Policy: require-corp, so iOS 27 gives it a
// process of its own = a memory budget of its own. It owns layers [l0, l1): their weights (read from this origin's storage: the pack the
// page downloaded and checked; it never fetches weights) and their KV caches, on its own WebGPU device. The page sends hidden rows and
// per-layer inputs, the worker runs its layers and sends the rows back; it never runs while the page's GPU work runs. Its buffers are
// kept from prompt to prompt (WebKit gives destroyed GPU memory back late). It reads and writes no other storage and no agreement.
import { createGpu } from '../core/gpu.js';
import { DecodeRunner } from './drunner.js';
import { Gemma4 } from './gemma4.js';
import { specAlloc, encodeVerifyLayers } from './spec.js';
import { setKX } from './lopsx.js';   // 3.8 (bench v041)

const TAG = 'p0split', CH = 16 * 1024 * 1024, PROTO = 3;   // PROTO = split.js SPLIT_PROTO (the page refuses a worker part of another version)
const UPCAP = 64 * 1024 * 1024;   // 3.8 port (bench v047): the weights in flight while loading (core/store.js)

/** a read-only view of a pack in this origin's OPFS (the folder the page's engine downloaded into): the manifest + one GPU buffer per
 *  shard, filled in 16 MiB File.slice reads */
class OpfsPack {
  constructor(dir) { this.dir = dir; this.stats = { uploadBytes: 0, uploadMs: 0 }; }
  async _dirHandle() {
    let d = await navigator.storage.getDirectory();
    for (const part of this.dir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create: false });
    return d;
  }
  async open() {
    this.dh = await this._dirHandle();
    const mf = await (await this.dh.getFileHandle('manifest.json')).getFile();
    this.m = JSON.parse(await mf.text());
    this.shards = new Map(this.m.shards.map((s) => [s.name, s]));
    return this.m;
  }
  async upload(name) {
    const s = this.shards.get(name); if (!s) throw new Error('unknown shard ' + name);
    const g = this.gpu, t0 = performance.now(), file = await (await this.dh.getFileHandle(s.file)).getFile();
    if (file.size < s.bytes) throw new Error(`${s.file}: ${file.size} of ${s.bytes} bytes in storage`);
    const buf = g.buffer(s.bytes, 'shard ' + name);
    let next = file.slice(0, Math.min(CH, s.bytes)).arrayBuffer();
    for (let off = 0; off < s.bytes; off += CH) {
      const ab = await next, n = off + CH;
      if (n < s.bytes) next = file.slice(n, Math.min(n + CH, s.bytes)).arrayBuffer();
      g.device.queue.writeBuffer(buf, off, ab);   // shards are 256-byte multiples (FORMAT.md): every piece is a 4-byte multiple
      if ((this.inflight = (this.inflight || 0) + ab.byteLength) >= UPCAP) { this.inflight = 0; try { await g.device.queue.onSubmittedWorkDone(); } catch (e) { /* */ } }   // 3.8 port: at most ~64 MB of weights in flight
    }
    this.stats.uploadBytes += s.bytes; this.stats.uploadMs += performance.now() - t0;
    const T = this.m.tensors, h = { name, buf, bytes: s.bytes };
    h.t = (tn) => { const x = T[tn]; if (!x || x.shard !== name) throw new Error(`tensor ${tn} not in ${name}`);
      return { buf: h.buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }; };
    return h;
  }
  release(h) { if (h && h.buf) { this.gpu.free(h.buf); h.buf = null; } }
}

let W = null;   // { g, store, model, s, V, Mmax, dr, drV, n, par, parV }
// 3.8 port (bench v050): a heartbeat every second on every connected port: a call waiting while the page was in the background knows
// within seconds of the page's return whether this part still lives (iOS may end a background process)
const PORTS = new Set(); let HB = 0;
setInterval(() => { HB++; for (const p of PORTS) { try { p.postMessage({ [TAG]: 1, hb: HB }); } catch (e) { PORTS.delete(p); } } }, 1000);
const now = () => performance.now();
const lost = (g) => { if (g.lost) throw Object.assign(new Error('the worker part lost its GPU: ' + JSON.stringify(g.lostInfo)), { code: 'GPU_LOST' }); };
const segs = (c, pos, M) => { if (!c.ring) return [[pos, M]]; const r0 = pos % c.ring, n1 = Math.min(M, c.ring - r0); return n1 < M ? [[r0, n1], [0, M - n1]] : [[r0, M]]; };   // positions -> rows of a KV cache (a sliding ring may wrap)
/** 3.8: the mirror layers' K and V rows (the KV sources the page reads and this part runs) for positions pos .. pos + M - 1, every KV
 *  head, in position order, recorded as copies into out[base ..] (split.js _mirrorIn reads them in the same order) -> bytes */
function kvRows(copy, pos, M, out, base) {
  let o = base;
  for (const { c } of W.mirror) {
    const rb = c.hd * 2;
    for (const buf of [c.kc, c.vc]) for (let h = 0; h < W.model.NKV; h++) for (const [r, n] of segs(c, pos, M)) { copy(buf, (h * c.len + r) * rb, out, o, n * rb); o += n * rb; }
  }
  return o - base;
}

const ops = {
  /** load layers [l0, l1) of the pack in OPFS folder `dir` (it must be the version the page loaded: packVersion) */
  async init(m) {
    if (W) ops.free({ keep: true });
    const t0 = now();
    setKX(m.kx !== false);   // 3.8 (bench v041): the page's kernels
    let g = null, scoped = false;
    try {
      g = await createGpu({ powerPreference: 'high-performance' });
      g.rate = { mm: 0.2e12, attn: 0.08e12, mem: 20e9 };
      try { g.device.pushErrorScope('out-of-memory'); scoped = true; } catch (e) { /* */ }   // WebGPU reports a full GPU here, not as a throw
      const store = new OpfsPack(m.dir); store.gpu = g; await store.open();
      if (m.packVersion && store.m.pack_version !== m.packVersion) throw new Error(`the pack in storage is ${store.m.pack_version}, the page loaded ${m.packVersion}`);
      const model = new Gemma4(g, store);
      model.l0 = m.l0; model.l1 = m.l1; model.ends = false; model.ctxCap = m.ctxCap; model.opts = Object.assign({}, m.opts || {});
      await model.preload(null);
      model._ensureRope(m.ctxCap);
      model.allocKV(m.ctxCap, m.chunk);
      const s = model.scratch(), Mmax = m.Mmax || 8, V = specAlloc(model, Mmax), D = model.D;
      const mirror = (m.mirror || []).map((l) => ({ l, c: model.kv[l] }));   // 3.8: the page's mirror layers (their KV rows go back with each answer)
      if (mirror.some((x) => !x.c)) throw new Error('a mirror layer has no KV cache in this part: ' + JSON.stringify(m.mirror));
      const perPos = mirror.reduce((a, x) => a + 2 * model.NKV * x.c.hd * 2, 0), rowsMax = Math.max(m.chunk || 256, Mmax);
      const out = perPos ? { p: g.buffer(rowsMax * (D * 4 + perPos), 'hop.p'), d: g.buffer(D * 4 + perPos, 'hop.d'), v: g.buffer(Mmax * (D * 4 + perPos), 'hop.v') } : null;
      const dr = new DecodeRunner(g, { cap: 1024, stage: D * 4 + perPos }), drV = new DecodeRunner(g, { cap: 1600, stage: Mmax * (D * 4 + perPos) });
      await g.done();
      if (scoped) { scoped = false; const oom = await g.device.popErrorScope(); if (oom) throw Object.assign(new Error('the worker part ran out of GPU memory: ' + oom.message), { code: 'OUT_OF_MEMORY' }); }
      lost(g);
      W = { g, store, model, s, V, Mmax, dr, drV, n: 0, par: 0, parV: 0, mirror, perPos, out };
      return { ms: Math.round(now() - t0), aliveMB: Math.round(g.alive / 1e6), residentMB: Math.round(store.stats.uploadBytes / 1e6), uploadMs: Math.round(store.stats.uploadMs),
        gpu: g.describe(), coep: self.__SW_SERVED || null, isolated: !!self.crossOriginIsolated, layers: [m.l0, m.l1] };
    } catch (e) {   // nothing stays behind: the page falls back without this part
      try { if (g) { if (scoped) await g.device.popErrorScope(); g.freeAll(); g.device.destroy(); } } catch (x) { /* */ }
      W = null; throw e;
    }
  },
  /** one prompt chunk: rows x [M][D] f32 + per-layer inputs ple [M][NL*256] at positions p0 .. p0 + M - 1 -> x after layers [l0, l1) */
  async prefill(m) {
    const { g, model } = W, D = model.D, NT = model.NL * 256, R = g.runner;
    // 3.8 port (bench v045): every submitted chunk has finished (the page read the last one back): the runner's uniform ring starts
    // over, so this chunk's dispatches get the same buffers and slots as the chunk before and its bind groups come from the cache (a
    // new bind group per dispatch per chunk piled up ~5,000 a long read-in; iOS 27.0.1 gives their memory back only at garbage collection)
    try { await g.device.queue.onSubmittedWorkDone(); } catch (e) { /* */ }
    R.sync();
    if (m.first) model.allocKV(model.ctxCap, m.chunk);   // kept unless the size changed: a new prompt's positions start again at 0
    const s = model._keptPrefillBufs(m.chunk), t0 = now(), bs0 = R.batchSeconds;   // kept from prompt to prompt (gemma4.js)
    g.device.queue.writeBuffer(s.x, 0, m.x.buffer, m.x.byteOffset, m.M * D * 4);
    g.device.queue.writeBuffer(s.ple, 0, m.ple.buffer, m.ple.byteOffset, m.M * NT * 4);
    R.batchSeconds = (model.opts && model.opts.prefillBatch) || 0.4;
    try { for (let l = model.l0; l < model.l1; l++) await model._layerPrefill(l, m.M, m.p0, s); } finally { R.batchSeconds = bs0; }
    if (W.perPos) {   // 3.8: the rows and the mirror layers' KV rows for these positions, in one read
      const xb = m.M * D * 4; R.copy(s.x, 0, W.out.p, 0, xb); kvRows((a, b, c, d, e) => R.copy(a, b, c, d, e), m.p0, m.M, W.out.p, xb);
      const ab = await g.read(W.out.p, 0, xb + m.M * W.perPos);
      lost(g);
      return { x: new Float32Array(ab, 0, m.M * D), kv: new Uint8Array(ab, xb, m.M * W.perPos), ms: +(now() - t0).toFixed(2), transfer: [ab] };
    }
    const x = new Float32Array(await g.read(s.x, 0, m.M * D * 4));
    lost(g);
    return { x, ms: +(now() - t0).toFixed(2), transfer: [x.buffer] };
  },
  /** one decode token at `pos`: x [D] + ple [NL*256] -> x after layers [l0, l1) (one command buffer, cached bind groups) */
  async decode(m) {
    const { g, model, s, dr } = W, D = model.D, NT = model.NL * 256, core = g.runner, t0 = now();
    g.device.queue.writeBuffer(s.x, 0, m.x.buffer, m.x.byteOffset, D * 4);
    g.device.queue.writeBuffer(s.ple, 0, m.ple.buffer, m.ple.byteOffset, NT * 4);
    let tk; g.runner = dr;
    try {
      dr.begin(W.par); W.par ^= 1;
      for (let l = model.l0; l < model.l1; l++) {
        const ah = model.resident.get(`lm.layer.${String(l).padStart(2, '0')}.a`), mh = model.resident.get(`lm.layer.${String(l).padStart(2, '0')}.m`);
        model._attnPart(l, m.pos, s, ah); model._mlpPart(l, s, mh); model._plePart(l, s, ah);
      }
      if (W.perPos) { dr.copy(s.x, 0, W.out.d, 0, D * 4); kvRows((a, b, c, d, e) => dr.copy(a, b, c, d, e), m.pos, 1, W.out.d, D * 4); tk = dr.end(W.out.d, D * 4 + W.perPos); }
      else tk = dr.end(s.x, D * 4);
    } finally { g.runner = core; if (dr.cur) dr.cur = null; }
    const enc = now() - t0, o = await dr.submit(tk), x = new Float32Array(o.buffer, 0, D);
    lost(g); W.n++;
    return { x, kv: W.perPos ? new Uint8Array(o.buffer, D * 4, W.perPos) : null, encMs: +enc.toFixed(2), ms: +(now() - t0).toFixed(2), transfer: [o.buffer] };
  },
  /** one verify pass of M rows at positions pos .. pos + M - 1 -> the rows after layers [l0, l1) */
  async verify(m) {
    const { g, model, V, drV } = W, D = model.D, NT = model.NL * 256, core = g.runner, t0 = now();
    if (m.M > W.Mmax) throw new Error('verify: ' + m.M + ' rows > ' + W.Mmax);
    g.device.queue.writeBuffer(V.sp, 0, Uint32Array.of(m.pos, 0, 0, 0));
    g.device.queue.writeBuffer(V.x, 0, m.x.buffer, m.x.byteOffset, m.M * D * 4);
    g.device.queue.writeBuffer(V.ple, 0, m.ple.buffer, m.ple.byteOffset, m.M * NT * 4);
    let tk; g.runner = drV;
    try {
      drV.begin(W.parV); W.parV ^= 1;
      encodeVerifyLayers(model, V, m.M, Math.ceil((m.pos + m.M) / 64), model.l0, model.l1);
      if (W.perPos) { const xb = m.M * D * 4; drV.copy(V.x, 0, W.out.v, 0, xb); kvRows((a, b, c, d, e) => drV.copy(a, b, c, d, e), m.pos, m.M, W.out.v, xb); tk = drV.end(W.out.v, xb + m.M * W.perPos); }
      else tk = drV.end(V.x, m.M * D * 4);
    } finally { g.runner = core; if (drV.cur) drV.cur = null; }
    const enc = now() - t0, o = await drV.submit(tk), x = new Float32Array(o.buffer, 0, m.M * D);
    lost(g);
    return { x, kv: W.perPos ? new Uint8Array(o.buffer, m.M * D * 4, m.M * W.perPos) : null, encMs: +enc.toFixed(2), ms: +(now() - t0).toFixed(2), transfer: [o.buffer] };
  },
  async stats() { const g = W && W.g; return g ? { aliveMB: Math.round(g.alive / 1e6), peakMB: Math.round(g.peak / 1e6), lost: !!g.lost, tokens: W.n } : { none: true }; },
  /** frees everything; the page's close() ends the worker after it (keep = a new init follows) */
  free(m = {}) {
    if (W) {
      try { W.model.releaseResident(); W.model.freeKV(); } catch (e) { /* */ }
      try { W.g.freeAll(); W.g.device.destroy(); } catch (e) { /* */ }
      W = null;
    }
    if (!m.keep) setTimeout(() => { try { self.close(); } catch (e) { /* */ } }, 50);
    return { freed: true };
  },
};

self.onconnect = (e) => {
  const port = e.ports[0]; PORTS.add(port);   // 3.8 port: + heartbeats
  port.onmessage = async (ev) => {
    const d = ev.data || {}; if (d[TAG] !== 1 || !ops[d.op]) return;
    try {
      if (d.op !== 'init' && d.op !== 'free' && d.op !== 'stats' && !W) throw new Error('the worker part is not loaded');
      const r = await ops[d.op](d) || {}, tr = r.transfer || []; delete r.transfer;
      port.postMessage({ [TAG]: 1, id: d.id, ok: true, r }, tr);
    } catch (err) { port.postMessage({ [TAG]: 1, id: d.id, ok: false, error: String((err && err.message) || err).slice(0, 400), code: (err && err.code) || (W && W.g && W.g.lost ? 'GPU_LOST' : null) }); }
  };
  port.start();
  port.postMessage({ [TAG]: 1, hello: 1, proto: PROTO, coep: self.__SW_SERVED || null, isolated: !!self.crossOriginIsolated });
};
