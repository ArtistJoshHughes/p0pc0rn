// kcheck.js - p0pc0rn v026.9: the Device check's GPU maths test. Each kernel class the models use runs once on small random data
// (fixed seed) and is compared with a CPU reference (cosine similarity and the worst absolute error), then a few larger runs give a
// rough speed. The kernels are the engines' own, chosen the way the engines choose them for this device (its limits), so a pass here
// means the same code path works on this phone. runAll(onStep) is an async generator of {name, variant, ok, cos, maxErr, speed, error}.
import { createGpu, toF16, fromF16, h2f, f2h } from './core/gpu.js';
import { gemm } from './ops/gemm.js';
import { attention, attnBytes } from './ops/attention.js';

// ---- helpers
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function randn(n, seed, scale = 1) { const r = rng(seed), o = new Float32Array(n); for (let i = 0; i < n; i += 2) { const u = Math.max(1e-9, r()), v = r(), m = Math.sqrt(-2 * Math.log(u)) * scale; o[i] = m * Math.cos(2 * Math.PI * v); if (i + 1 < n) o[i + 1] = m * Math.sin(2 * Math.PI * v); } return o; }
const rf16 = (x) => h2f(f2h(x));   // round to fp16
const roundF16 = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = rf16(a[i]); return o; };
const rhe = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
export function compare(got, want) {
  let dot = 0, ga = 0, wa = 0, me = 0;
  for (let i = 0; i < want.length; i++) { const g = got[i], w = want[i]; dot += g * w; ga += g * g; wa += w * w; const e = Math.abs(g - w); if (!(e <= me)) me = Number.isFinite(e) ? Math.max(me, e) : Infinity; }
  const cos = dot / Math.sqrt(Math.max(1e-30, ga * wa));
  return { cos: Number.isFinite(cos) ? cos : 0, maxErr: me };
}
// ---- the pack encodings (docs/FORMAT.md 5.1 / 5.2), quantised on the CPU; returns the bytes and the dequantised weights
export function packQ4(W, N, K) {
  const NT = N / 64, G = K / 32, out = new Uint8Array(NT * G * 1280), dv = new DataView(out.buffer), deq = new Float32Array(N * K);
  for (let t = 0; t < NT; t++) for (let g = 0; g < G; g++) {
    const rec = (t * G + g) * 1280;
    for (let r = 0; r < 64; r++) {
      const n = t * 64 + r, base = n * K + g * 32; let mnv = Infinity, mxv = -Infinity;
      for (let i = 0; i < 32; i++) { const v = W[base + i]; if (v < mnv) mnv = v; if (v > mxv) mxv = v; }
      const mn = rf16(mnv); let s = rf16((mxv - mn) / 15); if (s === 0) s = 1;
      for (let j = 0; j < 16; j++) {
        const q0 = Math.min(15, Math.max(0, rhe((W[base + 2 * j] - mn) / s))), q1 = Math.min(15, Math.max(0, rhe((W[base + 2 * j + 1] - mn) / s)));
        out[rec + r * 16 + j] = q0 | (q1 << 4); deq[base + 2 * j] = q0 * s + mn; deq[base + 2 * j + 1] = q1 * s + mn;
      }
      dv.setUint32(rec + 1024 + r * 4, f2h(s) | (f2h(mn) << 16), true);
    }
  }
  return { bytes: out, deq };
}
export function packQ8(W, N, K) {
  const NT = N / 64, G = K / 64, out = new Uint8Array(NT * G * 4224), dv = new DataView(out.buffer), deq = new Float32Array(N * K);
  for (let t = 0; t < NT; t++) for (let g = 0; g < G; g++) {
    const rec = (t * G + g) * 4224;
    for (let r = 0; r < 64; r++) {
      const n = t * 64 + r, base = n * K + g * 64; let am = 0;
      for (let i = 0; i < 64; i++) am = Math.max(am, Math.abs(W[base + i]));
      let s = rf16(am / 127); if (s === 0) s = 1;
      for (let i = 0; i < 64; i++) { const q = Math.min(127, Math.max(-128, rhe(W[base + i] / s))); out[rec + r * 64 + i] = q & 255; deq[base + i] = q * s; }
      dv.setUint16(rec + 4096 + r * 2, f2h(s), true);
    }
  }
  return { bytes: out, deq };
}
function cpuGemm(X, W, M, N, K) { const Y = new Float32Array(M * N); for (let m = 0; m < M; m++) for (let n = 0; n < N; n++) { let a = 0; const xo = m * K, wo = n * K; for (let k = 0; k < K; k++) a += X[xo + k] * W[wo + k]; Y[m * N + n] = a; } return Y; }
function cpuAttn(Q, Kt, V, H, L, D) {   // Q/K/V [H][L][D] -> O [L][H*D]
  const O = new Float32Array(L * H * D), sc = 1 / Math.sqrt(D), s = new Float32Array(L);
  for (let h = 0; h < H; h++) for (let i = 0; i < L; i++) {
    let mx = -Infinity;
    for (let j = 0; j < L; j++) { let a = 0; for (let d = 0; d < D; d++) a += Q[(h * L + i) * D + d] * Kt[(h * L + j) * D + d]; s[j] = a * sc; if (s[j] > mx) mx = s[j]; }
    let sum = 0; for (let j = 0; j < L; j++) { s[j] = Math.exp(s[j] - mx); sum += s[j]; }
    for (let d = 0; d < D; d++) { let a = 0; for (let j = 0; j < L; j++) a += s[j] * V[(h * L + j) * D + d]; O[i * H * D + h * D + d] = a / sum; }
  }
  return O;
}
async function timeIt(gpu, fn, reps = 4) { fn(); await gpu.done(); const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(); await gpu.done(); return (performance.now() - t0) / reps / 1000; }

// ---- the tests
async function* coreTests(gpu) {
  const wgMax = gpu.limits.maxComputeWorkgroupStorageSize;
  for (const enc of ['f16', 'q4g32a.t64', 'q8g64s.t64']) {
    const name = 'Matrix multiply (' + (enc === 'f16' ? 'fp16 weights' : enc.startsWith('q4') ? '4-bit weights' : '8-bit weights') + ')';
    try {
      const M = 32, N = 128, K = 256;
      const X = roundF16(randn(M * K, 7)), W0 = randn(N * K, 11, 0.05);
      let wb, Wd;
      if (enc === 'f16') { Wd = roundF16(W0); wb = gpu.upload(toF16(Wd), 'kc.w'); }
      else { const p = enc.startsWith('q4') ? packQ4(W0, N, K) : packQ8(W0, N, K); Wd = p.deq; wb = gpu.upload(p.bytes, 'kc.w'); }
      const xb = gpu.upload(toF16(X), 'kc.x'), yb = gpu.buffer(M * N * 2, 'kc.y');
      const w = { enc, buf: wb, off: 0, bytes: wb._pf, rows: N, cols: K };
      gemm(gpu, { w, x: { buf: xb }, y: { buf: yb }, M, N, K });
      const got = fromF16(new Uint16Array(await gpu.read(yb, 0, M * N * 2)));
      const c = compare(got, cpuGemm(X, Wd, M, N, K));
      [wb, xb, yb].forEach((b) => gpu.free(b));
      // speed: a larger one
      const M2 = 256, N2 = 1024, K2 = 1024, X2 = gpu.buffer(M2 * K2 * 2, 'kc.x2'), Y2 = gpu.buffer(M2 * N2 * 2, 'kc.y2');
      const W2 = enc === 'f16' ? gpu.buffer(N2 * K2 * 2, 'kc.w2') : gpu.upload((enc.startsWith('q4') ? packQ4 : packQ8)(randn(N2 * K2, 3, 0.05), N2, K2).bytes, 'kc.w2');
      const sec = await timeIt(gpu, () => gemm(gpu, { w: { enc, buf: W2, off: 0, bytes: W2._pf, rows: N2, cols: K2 }, x: { buf: X2 }, y: { buf: Y2 }, M: M2, N: N2, K: K2 }));
      [X2, Y2, W2].forEach((b) => gpu.free(b));
      yield { name, variant: `tile 64x128 · ${Math.round(wgMax / 1024)} KB workgroup memory`, ok: c.cos > 0.9995, cos: c.cos, maxErr: c.maxErr, speed: (2 * M2 * N2 * K2 / sec / 1e9).toFixed(0) + ' GFLOP/s' };
    } catch (e) { yield { name, error: String(e.message || e) }; }
  }
  {
    const name = 'Attention (head size 128)';
    try {
      const H = 2, L = 96, D = 128;
      const Q = roundF16(randn(H * L * D, 21, 0.5)), Kt = roundF16(randn(H * L * D, 22, 0.5)), V = roundF16(randn(H * L * D, 23));
      const qb = gpu.upload(toF16(Q)), kb = gpu.upload(toF16(Kt)), vb = gpu.upload(toF16(V)), ob = gpu.buffer(L * H * D * 2);
      attention(gpu, { q: { buf: qb }, k: { buf: kb }, v: { buf: vb }, o: { buf: ob, ld: H * D }, Lq: L, Lk: L, Hq: H, Hkv: H });
      const got = fromF16(new Uint16Array(await gpu.read(ob, 0, L * H * D * 2)));
      const c = compare(got, cpuAttn(Q, Kt, V, H, L, D));
      [qb, kb, vb, ob].forEach((b) => gpu.free(b));
      const L2 = 1024, H2 = 4, q2 = gpu.buffer(H2 * L2 * D * 2), k2 = gpu.buffer(H2 * L2 * D * 2), v2 = gpu.buffer(H2 * L2 * D * 2), o2 = gpu.buffer(L2 * H2 * D * 2);
      const sec = await timeIt(gpu, () => attention(gpu, { q: { buf: q2 }, k: { buf: k2 }, v: { buf: v2 }, o: { buf: o2, ld: H2 * D }, Lq: L2, Lk: L2, Hq: H2, Hkv: H2 }));
      [q2, k2, v2, o2].forEach((b) => gpu.free(b));
      const cfg = gpu.tune?.attn || { BQ: gpu.subgroups && gpu.sgMin >= 8 ? 64 : 32, sg: gpu.subgroups && gpu.sgMin >= 8 };
      const v = attnBytes(cfg) > wgMax ? '16 queries per tile (16 KB variant)' : cfg.BQ + ' queries per tile' + (cfg.sg ? ', subgroups' : '');
      yield { name, variant: v, ok: c.cos > 0.9995, cos: c.cos, maxErr: c.maxErr, speed: (4 * L2 * L2 * D * H2 / sec / 1e9).toFixed(0) + ' GFLOP/s' };
    } catch (e) { yield { name, error: String(e.message || e) }; }
  }
}

/** every test, as an async generator; onStep(text) reports progress */
export async function* runAll(onStep = () => {}) {
  let gpu;
  try { onStep('starting the graphics chip'); gpu = await createGpu({ powerPreference: 'high-performance', wantSubgroups: true }); }
  catch (e) { yield { name: 'Graphics chip', error: String(e.message || e) }; return; }
  try {
    for (const extra of EXTRA) {
      onStep(extra.label);
      try { for await (const r of extra.run(gpu)) yield r; } catch (e) { yield { name: extra.label, error: String(e.message || e) }; }
    }
  } finally { try { gpu.freeAll(); gpu.device.destroy(); } catch (e) { /* */ } }
}
// ---- the assistant's 4-bit matrix-vector product (llm/lops.js) and the songs' attention (music/mattn.js), as the engines pick them here
async function* songAssistTests(gpu) {
  {
    const name = 'Assistant matrix-vector (4-bit)';
    try {
      const { gemv } = await import('./llm/lops.js');
      const N = 256, K = 1536, x = randn(K, 31), W0 = randn(N * K, 32, 0.05), p = packQ4(W0, N, K);
      const wb = gpu.upload(p.bytes), xb = gpu.upload(x), yb = gpu.buffer(N * 4);
      gemv(gpu, { w: { buf: wb, off: 0, enc: 'q4g32a.t64', rows: N, cols: K }, x: { buf: xb }, N, K, pro: 'raw', epi: 'store', y: { buf: yb } });
      const got = new Float32Array(await gpu.read(yb, 0, N * 4)), want = new Float32Array(N);
      for (let n = 0; n < N; n++) { let a = 0; for (let k = 0; k < K; k++) a += p.deq[n * K + k] * x[k]; want[n] = a; }
      const c = compare(got, want); [wb, xb, yb].forEach((b) => gpu.free(b));
      yield { name, variant: 'K chunks of 2048', ok: c.cos > 0.9999, cos: c.cos, maxErr: c.maxErr };
    } catch (e) { yield { name, error: String(e.message || e) }; }
  }
  {
    const name = 'Songs attention';
    try {
      const { mattention } = await import('./music/mattn.js');
      const H = 2, L = 80, D = 128;
      const Q = roundF16(randn(H * L * D, 41, 0.5)), Kt = roundF16(randn(H * L * D, 42, 0.5)), V = roundF16(randn(H * L * D, 43));
      const qb = gpu.upload(toF16(Q)), kb = gpu.upload(toF16(Kt)), vb = gpu.upload(toF16(V)), ob = gpu.buffer(L * H * D * 2);
      mattention(gpu, { q: { buf: qb }, k: { buf: kb }, v: { buf: vb }, o: { buf: ob, ld: H * D }, Lq: L, Lk: L, Hq: H, Hkv: H });
      const got = fromF16(new Uint16Array(await gpu.read(ob, 0, L * H * D * 2))), c = compare(got, cpuAttn(Q, Kt, V, H, L, D));
      [qb, kb, vb, ob].forEach((b) => gpu.free(b));
      yield { name, variant: gpu.limits.maxComputeWorkgroupStorageSize < 28672 ? '16 queries per tile (16 KB variant)' : 'default tile', ok: c.cos > 0.9995, cos: c.cos, maxErr: c.maxErr };
    } catch (e) { yield { name, error: String(e.message || e) }; }
  }
}
// ---- lip-sync's widest attention (lipsync/lattn.js, head 160: the UNet's 8x8 / 4x4 levels), as the engine picks it here
async function* lipsyncTests(gpu) {
  const name = 'Lip-sync attention (head 160)';
  try {
    const { lattn, lattnBytes } = await import('./lipsync/lattn.js');
    const H = 2, L = 64, D = 160, wgMax = gpu.limits.maxComputeWorkgroupStorageSize;
    const Q = roundF16(randn(H * L * D, 51, 0.5)), Kt = roundF16(randn(H * L * D, 52, 0.5)), V = roundF16(randn(H * L * D, 53));
    const qb = gpu.upload(toF16(Q)), kb = gpu.upload(toF16(Kt)), vb = gpu.upload(toF16(V)), ob = gpu.buffer(L * H * D * 2);
    const io = (buf) => ({ buf, off: 0, ld: D, hS: L * D, bS: H * L * D });
    lattn(gpu, { Dr: D, B: 1, H, Lq: L, Lk: L, scale: 1 / Math.sqrt(D), q: io(qb), k: io(kb), v: io(vb), o: { buf: ob, off: 0, ld: H * D, hS: D, bS: L * H * D } });
    const got = fromF16(new Uint16Array(await gpu.read(ob, 0, L * H * D * 2))), c = compare(got, cpuAttn(Q, Kt, V, H, L, D));
    [qb, kb, vb, ob].forEach((b) => gpu.free(b));
    let BQ = 32; while (BQ > 16 && lattnBytes(D, BQ, false) > wgMax) BQ /= 2;
    const variant = BQ + ' queries per tile' + (lattnBytes(D, BQ, false) > wgMax ? ', split tile (16 KB variant)' : '');
    yield { name, variant, ok: c.cos > 0.9995, cos: c.cos, maxErr: c.maxErr };
  } catch (e) { yield { name, error: String(e.message || e) }; }
}
// ---- v028: the phone-tuned flash attention (ops/attention.js attnF) that the picture / clip / 9B engines use on 32 KB devices
async function* attnFTests(gpu) {
  const { attnF, attnFFits, ATTNF_P, ATTNF_V } = await import('./ops/attention.js');
  for (const [D, F, name] of [[128, ATTNF_P, 'Attention, phone-tuned (head size 128)'], [256, ATTNF_V, 'Attention, phone-tuned (head size 256)']]) {
    try {
      const cfg = Object.assign({ D, flavour: D === 128 ? 'p' : 'v' }, F);
      if (!attnFFits(gpu, cfg)) { yield { name, variant: 'not used here (needs 32 KB of workgroup memory; the engines keep the older kernel)', ok: true }; continue; }
      const H = 2, L = 96;
      const Q = roundF16(randn(H * L * D, 61, 0.5)), Kt = roundF16(randn(H * L * D, 62, 0.5)), V = roundF16(randn(H * L * D, 63));
      const qb = gpu.upload(toF16(Q)), kb = gpu.upload(toF16(Kt)), vb = gpu.upload(toF16(V)), ob = gpu.buffer(L * H * D * 2);
      attnF(gpu, { q: { buf: qb }, k: { buf: kb }, v: { buf: vb }, o: { buf: ob, ld: H * D }, Lq: L, Lk: L, Hq: H, Hkv: H, mode: 0 }, cfg);
      const got = fromF16(new Uint16Array(await gpu.read(ob, 0, L * H * D * 2)));
      const c = compare(got, cpuAttn(Q, Kt, V, H, L, D));
      [qb, kb, vb, ob].forEach((b) => gpu.free(b));
      const L2 = 1024, H2 = 4, q2 = gpu.buffer(H2 * L2 * D * 2), k2 = gpu.buffer(H2 * L2 * D * 2), v2 = gpu.buffer(H2 * L2 * D * 2), o2 = gpu.buffer(L2 * H2 * D * 2);
      const sec = await timeIt(gpu, () => attnF(gpu, { q: { buf: q2 }, k: { buf: k2 }, v: { buf: v2 }, o: { buf: o2, ld: H2 * D }, Lq: L2, Lk: L2, Hq: H2, Hkv: H2, mode: 0 }, cfg));
      [q2, k2, v2, o2].forEach((b) => gpu.free(b));
      yield { name, variant: `${cfg.BQ} queries x ${cfg.BK} keys per tile, fp16 partial sums`, ok: c.cos > 0.9995, cos: c.cos, maxErr: c.maxErr, speed: (4 * L2 * L2 * D * H2 / sec / 1e9).toFixed(0) + ' GFLOP/s' };
    } catch (e) { yield { name, error: String(e.message || e) }; }
  }
}
// more kernel families register here (each engine family's own GEMV / attention / conv / face path)
export const EXTRA = [{ label: 'pictures and clips: matrix multiply, attention', run: coreTests }, { label: 'pictures and clips: the phone-tuned attention', run: attnFTests },
  { label: 'the assistant and songs', run: songAssistTests }, { label: 'lip-sync', run: lipsyncTests }];
