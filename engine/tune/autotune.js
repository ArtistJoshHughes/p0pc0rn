// autotune.js - p0pc0rn v4: tune this device's chat decode kernels (the pop-up, Settings › Benchmark › Speed). On its own GPU device,
// with synthetic weights in the packs' encodings (nothing is downloaded or sent): the 4-bit matrix-vector products at Juli's (and, where
// it runs, the Bigger brain's) real shapes, and the decode attention, each candidate checked against the engine's own kernel first
// (NaN-filled output, so a kernel that did not run cannot pass), then timed: the GPU warmed first (a laptop GPU idles at a low clock),
// a ring of weight copies so each call reads from memory, GPU timestamps where they are trustworthy (not on Safari), medians of rounds
// in turn. A candidate is kept only if it is 3% or more faster than what ships, and again on a second timing (the re-check).
// runTune(o) -> the result for tunecore's cache (picks for lopsx.setPicks, the decode attention for lopsd.setAD, estimates for the card).
import { createGpu, h2f } from '../core/gpu.js';
import * as K from '../llm/lops.js';
import { gemvV5, PICK, KERNEL_VERSION } from '../llm/lopsx.js';
import { AD_CANDS } from '../llm/lopsd.js';
import { gemm } from '../ops/gemm.js';
import { SHAPES, MODELS, ATTN, SCHEMA, GAIN, tagOf, optsOf, candidatesFor, choose, picksFrom, tuneKey, familyEntry, platform } from './tunecore.js';

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toPrecision(4));
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const NAN = 0x7FC00000;
const F16 = new Float32Array(65536); for (let i = 0; i < 65536; i++) F16[i] = h2f(i);
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function randn(n, seed, sc = 1) { const r = rng(seed), o = new Float32Array(n); for (let i = 0; i < n; i += 2) { const u = Math.max(1e-9, r()), v = r(), m = Math.sqrt(-2 * Math.log(u)) * sc; o[i] = m * Math.cos(2 * Math.PI * v); if (i + 1 < n) o[i + 1] = m * Math.sin(2 * Math.PI * v); } return o; }
const GELU = (v) => v * 0.5 * (1 + Math.tanh(Math.max(-15, Math.min(15, 0.7978845608028654 * (v + 0.044715 * v * v * v)))));
const abortErr = () => Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' });

// ------------------------------------------------------------------------------------------------ replaying the engine's dispatches
function recorder(g) {
  return function record(fn) {
    const real = g.runner, items = [];
    g.runner = { dispatch: (pipe, b, params, wg) => items.push({ pipe, binds: b.map((x) => real._fit(x)), params: new Uint8Array(params.slice(0)), wg: [wg[0], wg[1] || 1, wg[2] || 1] }),
      flush() {}, forget() { real.forget(); }, sync() {}, copy() { throw new Error('copy inside a recorded op'); } };
    try { fn(); } finally { g.runner = real; }
    return items;
  };
}
function plan(g, items) {
  const d = g.device, SL = 256, ub = d.createBuffer({ size: Math.max(256, SL * items.length), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Uint8Array(SL * items.length); items.forEach((it, i) => data.set(it.params, i * SL)); d.queue.writeBuffer(ub, 0, data);
  const bgs = items.map((it, i) => d.createBindGroup({ layout: it.pipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ub, offset: i * SL, size: SL } }, ...it.binds.map((x, j) => ({ binding: j + 1, resource: x instanceof GPUBuffer ? { buffer: x } : x }))] }));
  return { items, bgs, ub };
}
const freePlan = (p) => { try { p.ub.destroy(); } catch (e) { /* */ } };

class Timer {
  constructor(g, useTs) {
    this.g = g; const d = g.device;
    this.ts = useTs && d.features.has('timestamp-query') ? { qs: d.createQuerySet({ type: 'timestamp', count: 2 }), res: d.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
      rd: d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) } : null;
  }
  /** replay plans reps times in one compute pass -> ms (GPU time when the timestamps are sane, else wall clock) */
  async chain(plans, reps) {
    const d = this.g.device, enc = d.createCommandEncoder(), ts = this.ts;
    const pass = enc.beginComputePass(ts ? { timestampWrites: { querySet: ts.qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    for (let r = 0; r < reps; r++) for (const p of plans) for (let i = 0; i < p.items.length; i++) { const it = p.items[i]; pass.setPipeline(it.pipe); pass.setBindGroup(0, p.bgs[i]); pass.dispatchWorkgroups(it.wg[0], it.wg[1], it.wg[2]); }
    pass.end();
    if (ts) { enc.resolveQuerySet(ts.qs, 0, 2, ts.res, 0); enc.copyBufferToBuffer(ts.res, 0, ts.rd, 0, 16); }
    const cb = enc.finish(), t0 = performance.now(); d.queue.submit([cb]); await d.queue.onSubmittedWorkDone(); const wall = performance.now() - t0;
    if (!ts) return wall;
    await ts.rd.mapAsync(GPUMapMode.READ); const v = new BigUint64Array(ts.rd.getMappedRange().slice(0)); ts.rd.unmap();
    const gpu = Number(v[1] - v[0]) / 1e6;
    return gpu > 0 && gpu <= wall * 1.05 + 0.05 ? gpu : wall;
  }
  async warm(plans, reps, ms) { const t0 = performance.now(); let n = 0; while (performance.now() - t0 < ms || n < 2) { await this.chain(plans, reps); n++; } }
  destroy() { if (this.ts) { try { this.ts.qs.destroy(); this.ts.res.destroy(); this.ts.rd.destroy(); } catch (e) { /* */ } } }
}
async function scoped(g, fn) {
  const d = g.device; d.pushErrorScope('validation'); d.pushErrorScope('internal'); d.pushErrorScope('out-of-memory');
  let thrown = null; try { fn(); } catch (e) { thrown = String(e.message || e); }
  const e3 = await d.popErrorScope(), e2 = await d.popErrorScope(), e1 = await d.popErrorScope();
  const e = e1 || e2 || e3; return thrown || (e ? String(e.message).slice(0, 300) : null);
}

// ------------------------------------------------------------------------------------------------ synthetic weights (filled on the GPU)
const FILL = `struct P { n: u32, seed: u32, rec: u32, q8: u32, base: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> W: array<u32>;
fn h(x: u32) -> u32 { let v = x * 747796405u + 2891336453u; let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let j = gid.x + gid.y * nw.x * 256u;
  if (j >= p.n) { return; }
  let i = p.base + j; let r = i % p.rec; let hv = h(i ^ p.seed); let f = f32(hv & 0xFFFFu) / 65535.0;
  if (p.q8 == 0u) {
    if (r < 256u) { W[j] = hv; } else { let s = 0.006 + 0.004 * f; W[j] = pack2x16float(vec2<f32>(s, -7.5 * s)); }
  } else {
    if (r < 1024u) { W[j] = hv; } else { let f2 = f32(hv >> 16u) / 65535.0; W[j] = pack2x16float(vec2<f32>(0.0008 + 0.0004 * f, 0.0008 + 0.0004 * f2)); }
  }
}`;
async function fill(g, buf, off0, bytes, q8, seed) {
  const d = g.device; if (!g._tuneFill) g._tuneFill = d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code: FILL }), entryPoint: 'main' } });
  const pipe = g._tuneFill, lim = Math.min(g.limits.maxStorageBufferBindingSize, 128 * 1048576), win = Math.floor(lim / 4096) * 4096;
  for (let off = 0; off < bytes; off += win) {
    const sz = Math.min(win, bytes - off), n = sz / 4, wgs = Math.ceil(n / 256), x = Math.min(65535, wgs), y = Math.ceil(wgs / x);
    const ub = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ub, 0, new Uint32Array([n, seed >>> 0, q8 ? 1056 : 320, q8 ? 1 : 0, off / 4, 0, 0, 0]));
    const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: buf, offset: off0 + off, size: sz } }] });
    const enc = d.createCommandEncoder(), ps = enc.beginComputePass(); ps.setPipeline(pipe); ps.setBindGroup(0, bg); ps.dispatchWorkgroups(x, y); ps.end();
    d.queue.submit([enc.finish()]); await d.queue.onSubmittedWorkDone(); ub.destroy();
  }
}

// ------------------------------------------------------------------------------------------------ one GEMV shape
async function tuneShape(ctx, sh, tags) {
  const { g, T, record, budget } = ctx, q8 = sh.w === 'q8', recB = q8 ? 4224 : 1280, wG = sh.K / (q8 ? 64 : 32), tileB = wG * recB;
  const rows = (n) => (sh.epi === 'geglu' ? 2 * n : n);
  let N = sh.N; while ((rows(N) / 64) * tileB > ctx.maxShapeBytes && N > 4096) N = Math.ceil(N / 2 / 64) * 64;   // a huge head: a slice of its rows
  const slice = sh.N / N, NT = N / 64, bytes = (rows(N) / 64) * tileB, copyB = Math.ceil(bytes / 256) * 256;
  const cap = Math.min(ctx.ringBytes, g.limits.maxStorageBufferBindingSize);
  const R = Math.max(1, Math.min(32, Math.ceil(cap / bytes), Math.floor(cap / copyB)));
  const bufs = [], out = { key: sh.key, model: sh.model, w: sh.w, ms: {}, rejected: {}, slice: slice > 1 ? slice : undefined };
  const ring = g.buffer(copyB * R, 'tune.w'); bufs.push(ring);
  try {
    for (let c = 0; c < R; c++) await fill(g, ring, c * copyB, bytes, q8, (0x9E3779B9 ^ (sh.N * 31 + sh.K) ^ (c * 0x85EBCA6B)) >>> 0);
    const nsplit = sh.kPer ? Math.ceil(sh.K / sh.kPer) : 1, yN = sh.epi === 'store' ? nsplit * N : N;
    const x = randn(sh.K, 7 + sh.K), nw = new Float32Array(sh.K), ev = randn(sh.K, 11 + sh.K, 0.5);
    for (let i = 0; i < sh.K; i++) nw[i] = 0.9 + 0.2 * ((i * 2654435761) % 1000) / 1000;
    let ss = 0; for (let i = 0; i < sh.K; i++) ss += x[i] * x[i];
    const rstd = Math.fround(1 / Math.sqrt(ss / sh.K + 1e-6));
    const xb = g.upload(x), nwb = g.upload(nw), evb = g.upload(ev), yb = g.buffer(yN * 4), mxb = g.buffer((NT * 2 + 4) * 4), stb = g.upload(new Float32Array([0, rstd, 0, 0]));
    bufs.push(xb, nwb, evb, yb, mxb, stb);
    if (sh.epi === 'softcap') { const t = new Float32Array(NT * 2 + 4); t[NT * 2] = rstd; g.device.queue.writeBuffer(mxb, 0, t); }
    const args = (copy) => {
      const a = { w: { buf: ring, off: copy * copyB, enc: q8 ? 'q8g64s.t64' : 'q4g32a.t64', rows: rows(N), cols: sh.K }, x: { buf: xb, rowB: 0 }, N, K: sh.K, pro: sh.pro, epi: sh.epi, y: { buf: yb } };
      if (sh.kPer) a.kPer = sh.kPer;
      if (sh.pro === 'rms') { a.norm = { buf: nwb, off: 0 }; a.stat = sh.epi === 'softcap' ? { buf: mxb, off: NT * 2 } : { buf: stb, off: 1 }; }
      if (sh.pro === 'pleg') { a.src = { n: 1, ld: sh.K }; a.ev = { buf: evb, off: 0 }; }
      if (sh.epi === 'softcap') { a.mx = { buf: mxb }; a.cap = 30; }
      return a;
    };
    const call = (tag, a) => (tag === 'engine' ? K.gemv(g, Object.assign(a, { kx: false })) : gemvV5(g, a, optsOf(tag)));
    const readOut = async () => {
      const y = new Float32Array(await g.read(yb, 0, yN * 4)); let tot = y;
      if (sh.epi === 'store' && nsplit > 1) { tot = new Float64Array(N); for (let s = 0; s < nsplit; s++) for (let n = 0; n < N; n++) tot[n] += y[s * N + n]; }
      return { tot, mx: sh.epi === 'softcap' ? new Uint32Array(await g.read(mxb, 0, NT * 8)) : null };
    };
    const poison = () => { g.device.queue.writeBuffer(yb, 0, new Uint32Array(yN).fill(NAN)); if (sh.epi === 'softcap') g.device.queue.writeBuffer(mxb, 0, new Uint32Array(NT * 2).fill(NAN)); };
    let ref = null; const live = [];
    for (const tag of tags) {
      if (ctx.signal && ctx.signal.aborted) throw abortErr();
      let p0 = null; const err = await scoped(g, () => { p0 = plan(g, record(() => call(tag, args(0)))); });
      if (err) { out.rejected[tag] = err; continue; }
      poison(); await T.chain([p0], 1); const o = await readOut();
      if (!ref) {
        ref = o; const c = await cpuCheck(g, sh, ring, NT, tileB, q8, x, nw, ev, rstd, o.tot);
        out.cpuRel = r3(c);
        if (!(c <= 2e-5)) { out.rejected[tag] = 'differs from the CPU reference'; out.failed = true; freePlan(p0); break; }
      } else {
        const why = compare(sh, o, ref); if (why) { out.rejected[tag] = why; freePlan(p0); continue; }
      }
      const plans = [p0]; for (let k = 1; k < R; k++) plans.push(plan(g, record(() => call(tag, args(k)))));
      live.push({ tag, plans });
    }
    if (!live.length || out.failed) return out;
    const one = (await T.chain(live[0].plans, 1)) || 0.01;
    const reps = Math.max(1, Math.min(Math.floor(2000 / (R * live[0].plans[0].items.length)), Math.ceil(ctx.chainMs / Math.max(0.02, one))));
    await T.warm(live[0].plans, reps, ctx.warmMs);
    const times = new Map(live.map((c) => [c.tag, []]));
    for (let r = 0; r < ctx.rounds; r++) for (const c of (r % 2 ? [...live].reverse() : live)) { if (budget()) break; await T.chain(c.plans, reps); times.get(c.tag).push((await T.chain(c.plans, reps)) / (reps * R)); }
    for (const [t, v] of times) if (v.length) out.ms[t] = median(v) * slice;
    out.reps = reps; out.ring = R;
    out.plans = live;   // kept for the re-check (freed by the caller)
    return out;
  } finally {
    out.free = () => { for (const c of out.plans || []) c.plans.forEach(freePlan); for (const b of bufs) g.free(b); };
    if (!out.plans) out.free();
  }
}
/** the engine kernel's rows vs a CPU dot product on one tile -> relative L2 error */
async function cpuCheck(g, sh, ring, NT, tileB, q8, x, nw, ev, rstd, tot) {
  const t = Math.floor(NT / 2), xp = new Float64Array(sh.K);
  for (let k = 0; k < sh.K; k++) xp[k] = sh.pro === 'raw' ? x[k] : sh.pro === 'rms' ? x[k] * rstd * nw[k] : GELU(x[k]) * ev[k];
  const dots = async (tile) => {
    const u = new Uint32Array(await g.read(ring, tile * tileB, tileB)), o = new Float64Array(64), wG = sh.K / (q8 ? 64 : 32);
    for (let gi = 0; gi < wG; gi++) {
      const rec = gi * (q8 ? 1056 : 320);
      for (let r = 0; r < 64; r++) {
        let a = 0;
        if (!q8) { const sm = u[rec + 256 + r], s = F16[sm & 0xffff], mn = F16[sm >>> 16]; for (let w = 0; w < 4; w++) { const q = u[rec + r * 4 + w]; for (let i = 0; i < 8; i++) a += (((q >>> (4 * i)) & 15) * s + mn) * xp[gi * 32 + w * 8 + i]; } }
        else { const sw = u[rec + 1024 + (r >> 1)], s = F16[(r & 1) ? sw >>> 16 : sw & 0xffff]; for (let w = 0; w < 16; w++) { const q = u[rec + r * 16 + w]; for (let e = 0; e < 4; e++) { const b = (q >>> (8 * e)) & 255; a += (b > 127 ? b - 256 : b) * s * xp[gi * 64 + w * 4 + e]; } } }
        o[r] += a;
      }
    }
    return o;
  };
  const a = await dots(t), up = sh.epi === 'geglu' ? await dots(t + NT) : null;
  let d2 = 0, n2 = 0;
  for (let r = 0; r < 64; r++) { const want = sh.epi === 'geglu' ? GELU(a[r]) * up[r] : sh.epi === 'softcap' ? 30 * Math.tanh(Math.max(-15, Math.min(15, a[r] / 30))) : a[r]; const e = tot[t * 64 + r] - want; d2 += e * e; n2 += want * want; }
  return Math.sqrt(d2 / Math.max(n2, 1e-30));
}
/** a candidate's output vs the engine kernel's: '' when it matches (relative L2 <= 1e-5, worst <= 1e-4 of the largest; the head's
 *  per-tile argmax equal unless two values tie) */
function compare(sh, o, ref) {
  let d2 = 0, n2 = 0, mxe = 0, mxr = 0;
  for (let i = 0; i < ref.tot.length; i++) { const e = o.tot[i] - ref.tot[i]; d2 += e * e; n2 += ref.tot[i] * ref.tot[i]; mxe = Math.max(mxe, Math.abs(e)); mxr = Math.max(mxr, Math.abs(ref.tot[i])); }
  const rel = Math.sqrt(d2 / Math.max(n2, 1e-30));
  if (!Number.isFinite(rel) || !Number.isFinite(mxe)) return 'did not run (its output stayed empty)';
  if (rel > 1e-5 || mxe > 1e-4 * mxr) return 'gave different numbers';
  if (sh.epi === 'softcap') for (let t = 0; t < ref.mx.length / 2; t++) { const a = ref.mx[2 * t + 1], b = o.mx[2 * t + 1]; if (a !== b && !(a < ref.tot.length && b < ref.tot.length && Math.abs(ref.tot[a] - ref.tot[b]) <= 1e-5)) return 'picked a different word'; }
  return '';
}

// ------------------------------------------------------------------------------------------------ decode attention
async function tuneAttn(ctx, model, kind, D, keys) {
  const { g, T, record } = ctx, M = MODELS[model], nh = 8, nkv = M.nkv, ring = kind === 'sliding' ? 512 : 0, kvLen = kind === 'sliding' ? 512 : Math.max(keys, 512);
  const kStart = 0, kEnd = keys, minCK = 16, out = { model, kind, D, keys, ms: {}, rejected: {} };
  const kvB = nkv * kvLen * D * 2, R = Math.max(1, Math.min(8, Math.ceil(Math.min(ctx.ringBytes, 48 * 1048576) / (2 * kvB))));
  const bufs = [];
  try {
    const r = rng(100 + D + nkv), kv = new Uint16Array(nkv * kvLen * D);
    for (let i = 0; i < kv.length; i++) { const v = (r() * 4294967296) >>> 0; kv[i] = ((v & 1) << 15) | ((10 + ((v >>> 1) % 4)) << 10) | ((v >>> 4) & 1023); }
    const qb = g.upload(randn(nh * D, 5 + D, 0.1)), part = g.buffer(Math.ceil(keys / minCK) * nh * (2 + D) * 4), ob = g.buffer(nh * D * 4); bufs.push(qb, part, ob);
    const kcs = [], vcs = []; for (let c = 0; c < R; c++) { kcs.push(g.upload(kv)); vcs.push(g.upload(kv)); } bufs.push(...kcs, ...vcs);
    const call = (cand, c) => K.attnDec(g, { q: { buf: qb }, kc: { buf: kcs[c] }, vc: { buf: vcs[c] }, part: { buf: part }, out: { buf: ob }, D, nh, kStart, kEnd, ring, nkv, kvLen,
      ad: cand === 'engine' ? null : Object.assign({ name: cand }, AD_CANDS[cand]) });
    let ref = null; const live = [];
    for (const cand of ['engine', ...Object.keys(AD_CANDS)]) {
      let ps = []; const err = await scoped(g, () => { for (let c = 0; c < R; c++) ps.push(plan(g, record(() => call(cand, c)))); });
      if (err) { out.rejected[cand] = err; continue; }
      g.device.queue.writeBuffer(ob, 0, new Uint32Array(nh * D).fill(NAN)); await T.chain([ps[0]], 1);
      const o = new Float32Array(await g.read(ob, 0, nh * D * 4));
      if (!ref) ref = o;
      else { let d2 = 0, n2 = 0; for (let i = 0; i < o.length; i++) { const e = o[i] - ref[i]; d2 += e * e; n2 += ref[i] * ref[i]; } const rel = Math.sqrt(d2 / Math.max(n2, 1e-30)); if (!(rel <= 1e-5)) { out.rejected[cand] = 'gave different numbers'; ps.forEach(freePlan); continue; } }
      live.push({ cand, ps });
    }
    if (!live.length) return out;
    const one = (await T.chain(live[0].ps, 1)) || 0.01, reps = Math.max(1, Math.min(Math.floor(2000 / (R * 2)), Math.ceil(ctx.chainMs / Math.max(0.02, one))));
    await T.warm(live[0].ps, reps, ctx.warmMs / 2);
    const times = new Map(live.map((c) => [c.cand, []]));
    for (let k = 0; k < ctx.rounds; k++) for (const c of (k % 2 ? [...live].reverse() : live)) { await T.chain(c.ps, reps); times.get(c.cand).push((await T.chain(c.ps, reps)) / (reps * R)); }
    for (const [c, v] of times) if (v.length) out.ms[c] = median(v);
    live.forEach((c) => c.ps.forEach(freePlan));
    return out;
  } finally { for (const b of bufs) g.free(b); }
}

// ------------------------------------------------------------------------------------------------ the run
/** o = { onStep(text, frac), signal, models: ['e2b'] | ['e2b', 'e4b'], budgetMs, app (the app's version), webkit } -> result */
export async function runTune(o = {}) {
  const t0 = performance.now(), budgetMs = o.budgetMs || 85000, step = (t, f) => { try { o.onStep && o.onStep(t, f); } catch (e) { /* */ } };
  const ua = (globalThis.navigator && navigator.userAgent) || '', plat = platform(ua), webkit = o.webkit != null ? o.webkit : plat.browser.startsWith('Safari');
  step('Starting the graphics chip', 0);
  const g = await createGpu({ powerPreference: 'high-performance', needF16: false, wantSubgroups: true, timestamps: !webkit });
  const info = g.info, limits = g.limits, features = [...(g.adapter || g.device).features], wgsl = navigator.gpu.wgslLanguageFeatures ? [...navigator.gpu.wgslLanguageFeatures] : [];
  const key = tuneKey({ info, limits, features, wgsl, ua, app: o.app || '', kernels: KERNEL_VERSION });
  const res = { schema: SCHEMA, key, at: Date.now(), f16: g.f16, wgMemKB: limits.maxComputeWorkgroupStorageSize / 1024, os: plat.os, info: { vendor: info.vendor, architecture: info.architecture, description: info.description || '' },   // v4: + description (the card says which chip ran)
    picks: null, ad: null, est: {}, shapes: [], attn: [], partial: false, ms: 0 };
  const T = new Timer(g, !webkit), record = recorder(g);
  const ctx = { g, T, record, signal: o.signal, warmMs: o.warmMs || 300, chainMs: 8, rounds: 3, ringBytes: (webkit ? 24 : 48) * 1048576, maxShapeBytes: (webkit ? 32 : 96) * 1048576,
    budget: () => performance.now() - t0 > budgetMs };
  const kept = [];
  try {
    if (!g.f16) { res.ms = Math.round(performance.now() - t0); return res; }   // the card says plainly that nothing runs here
    // a laptop or server GPU idles at a low clock: 1.5 s of copies first (the Oct-31 bench measured 10x slow shapes without it)
    { const a = g.buffer(32 * 1048576), b = g.buffer(32 * 1048576), tw = performance.now();
      while (performance.now() - tw < 1500) { const e = g.device.createCommandEncoder(); for (let i = 0; i < 8; i++) e.copyBufferToBuffer(a, 0, b, 0, 32 * 1048576); g.device.queue.submit([e.finish()]); await g.device.queue.onSubmittedWorkDone(); }
      g.free(a); g.free(b); }
    const fam = familyEntry(info), shipped = (key2) => (PICK[key2] ? tagOf(PICK[key2]) : 'engine');
    const models = o.models || ['e2b'], list = SHAPES.filter((s) => models.includes(s.model));
    const choices = {};
    let i = 0;
    for (const sh of list) {
      if (o.signal && o.signal.aborted) throw abortErr();
      if (ctx.budget()) { res.partial = true; break; }
      step(sh.model === 'e2b' ? 'Chat with Juli' : 'Bigger brain', 0.05 + 0.75 * (i++ / list.length));
      const tags = candidatesFor(sh, PICK[sh.key], fam && fam.picks);
      const r = await tuneShape(ctx, sh, tags);
      if (r.plans) kept.push(r);
      const ch = choose(r.ms, shipped(sh.key));
      if (sh.w === 'q4' && !r.failed) choices[sh.key] = ch.tag;
      res.shapes.push({ key: sh.key, model: sh.model, w: sh.w, count: sh.count, ms: Object.fromEntries(Object.entries(r.ms).map(([t, v]) => [t, r3(v)])), shipped: shipped(sh.key), pick: ch.tag, gain: r3(ch.gain),
        rejected: Object.keys(r.rejected).length ? r.rejected : undefined, failed: r.failed || undefined, slice: r.slice });
    }
    // the re-check: a switched shape is timed again against what ships; it stays only if it is still >= 3% faster
    step('Checking the results again', 0.82);
    for (const r of kept) {
      const sh = res.shapes.find((s) => s.key === r.key && s.model === r.model);
      if (!sh || sh.pick === sh.shipped || ctx.budget()) continue;
      const a = r.plans.find((c) => c.tag === sh.pick), b = r.plans.find((c) => c.tag === sh.shipped);
      if (!a || !b) continue;
      const ta = [], tb = [];
      for (let k = 0; k < 2; k++) { await T.chain(b.plans, r.reps); tb.push(await T.chain(b.plans, r.reps)); await T.chain(a.plans, r.reps); ta.push(await T.chain(a.plans, r.reps)); }
      const gain = median(tb) / median(ta); sh.recheck = r3(gain);
      if (!(gain >= GAIN)) { sh.pick = sh.shipped; sh.gain = 1; choices[sh.key] = sh.shipped; }
    }
    for (const r of kept) r.free();
    kept.length = 0;
    res.picks = picksFrom(choices, shipped);
    // decode attention (the Phase 2 candidates: one workgroup per key chunk AND query head)
    const ad = {};
    for (const m of models) for (const [kind, D, keys] of ATTN) {
      if (ctx.budget()) { res.partial = true; break; }
      step('The attention of a chat', 0.86);
      const a = await tuneAttn(ctx, m, kind, D, keys);
      res.attn.push({ model: m, kind, D, keys, ms: Object.fromEntries(Object.entries(a.ms).map(([t, v]) => [t, r3(v)])), rejected: Object.keys(a.rejected).length ? a.rejected : undefined });
      for (const [c, v] of Object.entries(a.ms)) if (c !== 'engine') { const lay = kind === 'sliding' ? MODELS[m].layers - MODELS[m].full : MODELS[m].full; ad[c] = (ad[c] || 0) + (v - (a.ms.engine || v)) * lay; }
    }
    // one choice for every layer: the candidate that saves the most time over a whole token (and >= 3% of the attention's time)
    const base = res.attn.reduce((s, a) => s + (a.ms.engine || 0) * (a.kind === 'sliding' ? MODELS[a.model].layers - MODELS[a.model].full : MODELS[a.model].full), 0);
    const best = Object.entries(ad).sort((x, y) => x[1] - y[1])[0];
    if (best && base > 0 && -best[1] / base >= GAIN - 1 && res.attn.every((a) => a.ms[best[0]] != null)) res.ad = { name: best[0] };
    // estimates for the card (GPU time per token at a short context; small kernels as one norm-kernel time per kernel)
    for (const m of models) {
      const rows = res.shapes.filter((s) => s.model === m); if (!rows.length || res.partial) continue;
      const tok = (useBest) => rows.reduce((s, r) => s + r.count * ((useBest ? r.ms[r.pick] : r.ms[r.shipped]) || r.ms.engine || 0), 0);
      const att = (useBest) => res.attn.filter((a) => a.model === m).reduce((s, a) => s + (((useBest && res.ad ? a.ms[res.ad.name] : null) || a.ms.engine || 0) * (a.kind === 'sliding' ? MODELS[m].layers - MODELS[m].full : MODELS[m].full)), 0);
      const extra = MODELS[m].layers * 6 * 0.006;   // ~6 small kernels a layer at ~6 us (a laptop GPU bench); an estimate only
      const before = tok(false) + att(false) + extra, after = tok(true) + att(true) + extra;
      res.est[m] = { tokSBefore: r3(1000 / before), tokSAfter: r3(1000 / after), gain: r3(before / after) };
    }
    // pictures and clips: one GEMM's rate, scaled from the iPhone 16 Pro Max's measured times (an estimate for the card's words only)
    if (!ctx.budget()) {
      step('Pictures', 0.95);
      try { res.gemmTflops = r3(await gemmRate(g, T)); if (res.gemmTflops) { res.picSec = Math.max(30, Math.round(115 * 1.1 / res.gemmTflops)); res.clipSec = Math.max(60, Math.round(205 * 1.1 / res.gemmTflops)); } }
      catch (e) { /* the card leaves pictures out */ }
    }
    step('Done', 1);
    return res;
  } finally {
    for (const r of kept) try { r.free(); } catch (e) { /* */ }
    T.destroy(); res.ms = Math.round(performance.now() - t0);
    try { g.freeAll(); g.device.destroy(); } catch (e) { /* */ }
  }
}
/** TFLOP/s of the engine's 4-bit GEMM (fp16 partial sums, as the picture engine runs it) on a 512 x 3072 x 3072 product */
async function gemmRate(g, T) {
  const M = 512, N = 3072, Kd = 3072, recs = (N / 64) * (Kd / 32), W = g.buffer(recs * 1280), X = g.buffer(M * Kd * 2), Y = g.buffer(M * N * 2);
  try {
    await fill(g, W, 0, recs * 1280, false, 77);
    g.device.queue.writeBuffer(X, 0, new Uint16Array(M * Kd).fill(0x2c00));
    g.rate = { mm: 0.5e12, mm16: 0.5e12, mm32: 0.5e12, attn: 0.2e12, mem: 20e9 };
    const items = recorder(g)(() => gemm(g, { w: { buf: W, off: 0, bytes: W._pf, enc: 'q4g32a.t64', rows: N, cols: Kd }, x: { buf: X }, M, N, K: Kd, epi: 'f16', y: { buf: Y }, acc: 'f16' }));
    const p = plan(g, items); await T.chain([p], 1); await T.chain([p], 2);
    const ts = []; for (let k = 0; k < 3; k++) ts.push(await T.chain([p], 2) / 2);
    freePlan(p);
    return (2 * M * N * Kd) / (median(ts) / 1000) / 1e12;
  } finally { [W, X, Y].forEach((b) => g.free(b)); }
}
