// kshipped.js - p0pc0rn v4 (Phase 0): the Device check's test of the assistant kernels THIS device runs. Every shape in PICK (the
// iPhone's picks, or this device's tune over them) goes through the same call the engine makes (lops.js gemv -> kxPick -> gemvV5 with
// those options, after the guards: 'direct' needs 9 storage buffers per shader stage, 'u8' needs packed_4x8_integer_dot_product), at
// its real K and split (so the same pipeline), on 128 rows of random weights, against a CPU reference; then the 8-bit paths at their
// real K, and the decode attention as this device runs it. helpers = kcheck.js's {packQ4, packQ8, compare, randn}.
import { PICK, kxPick, gemvV5, DIRECT_NEEDS, u8ok } from '../llm/lopsx.js';
import { gemv, attnDec } from '../llm/lops.js';
import { adNow } from '../llm/lopsd.js';
import { AD_CANDS } from '../llm/lopsd.js';
import { toF16, fromF16 } from '../core/gpu.js';

const GELU = (v) => v * 0.5 * (1 + Math.tanh(Math.max(-15, Math.min(15, 0.7978845608028654 * (v + 0.044715 * v * v * v)))));
/** the 8-bit paths Juli's pack decodes with (attention, the per-layer-input gate and projection, MLP layers 4/6/12/13) */
const Q8 = [['rms', 'store', 1536, 0], ['raw', 'store', 2048, 2048], ['raw', 'store', 4096, 2048], ['rms', 'geglu', 1536, 0], ['raw', 'store', 6144, 2048], ['raw', 'store', 1536, 0], ['pleg', 'store', 256, 0]];
const kPerOf = (pro, epi, K) => (pro === 'raw' && epi === 'store' && K >= 2048 && K !== 2560 ? 2048 : 0);   // o and down run split (gemma4.js)

async function one(gpu, h, enc, pro, epi, K, kPer, run) {
  const N = 128, rows = epi === 'geglu' ? 2 * N : N, W0 = h.randn(rows * K, 33 + K, 0.05), p = enc === 'q8' ? h.packQ8(W0, rows, K) : h.packQ4(W0, rows, K);
  const x = h.randn(K, 34 + K), nw = new Float32Array(K).map((_, i) => 0.9 + 0.2 * ((i * 7919) % 100) / 100), ev = h.randn(K, 35 + K, 0.5);
  let ss = 0; for (let i = 0; i < K; i++) ss += x[i] * x[i];
  const rstd = Math.fround(1 / Math.sqrt(ss / K + 1e-6)), NT = N / 64, nsplit = kPer ? Math.ceil(K / kPer) : 1, yN = epi === 'store' ? nsplit * N : N;
  const bufs = [gpu.upload(p.bytes), gpu.upload(x), gpu.upload(nw), gpu.upload(ev), gpu.buffer(yN * 4), gpu.upload(new Float32Array(NT * 2 + 4).fill(0).map((v, i) => (i === NT * 2 ? rstd : v))), gpu.upload(new Float32Array([0, rstd, 0, 0]))];
  const [wb, xb, nwb, evb, yb, mxb, stb] = bufs;
  try {
    const a = { w: { buf: wb, off: 0, enc: enc === 'q8' ? 'q8g64s.t64' : 'q4g32a.t64', rows, cols: K }, x: { buf: xb, rowB: 0 }, N, K, pro, epi, y: { buf: yb } };
    if (kPer) a.kPer = kPer;
    if (pro === 'rms') { a.norm = { buf: nwb, off: 0 }; a.stat = epi === 'softcap' ? { buf: mxb, off: NT * 2 } : { buf: stb, off: 1 }; }
    if (pro === 'pleg') { a.src = { n: 1, ld: K }; a.ev = { buf: evb, off: 0 }; }
    if (epi === 'softcap') { a.mx = { buf: mxb }; a.cap = 30; }
    run(a);
    const y = new Float32Array(await gpu.read(yb, 0, yN * 4)), got = new Float32Array(N);
    for (let n = 0; n < N; n++) { let t = 0; for (let s = 0; s < nsplit; s++) t += y[s * N + n]; got[n] = t; }
    const xp = new Float64Array(K); for (let k = 0; k < K; k++) xp[k] = pro === 'raw' ? x[k] : pro === 'rms' ? x[k] * rstd * nw[k] : GELU(x[k]) * ev[k];
    const dot = (r) => { let s = 0; for (let k = 0; k < K; k++) s += p.deq[r * K + k] * xp[k]; return s; };
    const want = new Float32Array(N);
    for (let n = 0; n < N; n++) want[n] = epi === 'geglu' ? GELU(dot(n)) * dot(n + N) : epi === 'softcap' ? 30 * Math.tanh(Math.max(-15, Math.min(15, dot(n) / 30))) : dot(n);
    const c = h.compare(got, want);
    let argOk = true;
    if (epi === 'softcap') {   // each 64-row tile's best row (the head's argmax), as the engine reads it
      const mx = new Uint32Array(await gpu.read(mxb, 0, NT * 8));
      for (let t = 0; t < NT; t++) { let b = t * 64; for (let r = t * 64; r < t * 64 + 64; r++) if (want[r] > want[b]) b = r; if (mx[2 * t + 1] !== b && Math.abs(want[mx[2 * t + 1]] - want[b]) > 1e-5) argOk = false; }
    }
    return { cos: c.cos, maxErr: c.maxErr, ok: c.cos > 0.99999 && argOk };
  } finally { bufs.forEach((b) => gpu.free(b)); }
}

export async function* shippedTests(gpu, h) {
  const sb = (gpu.limits && gpu.limits.maxStorageBuffersPerShaderStage) || 8, p4 = u8ok();
  for (const key of Object.keys(PICK)) {
    const [pro, epi, nk] = key.split('.'), [N, K] = nk.split('x').map(Number), kPer = kPerOf(pro, epi, K);
    const name = `Assistant matrix-vector, ${key} (as shipped${N >= 262144 ? ': the head' : ''})`;
    try {
      const o = kxPick({ w: { enc: 'q4g32a.t64', off: 0 }, pro, epi, N, K });   // what the engine takes for this shape on this device
      const notes = [];
      if (o && o.mode === 'direct' && sb < DIRECT_NEEDS.gemv) notes.push(`direct runs staged here (${sb} storage buffers per stage)`);
      if (o && o.deq === 'u8' && !p4) notes.push('u8 runs as shift here (no packed_4x8_integer_dot_product)');
      const variant = (o ? `v5 ND ${o.ND || 4} L ${o.L || 8} ${o.mode || 'stage'} ${o.deq || 'shift'}` : "the engine's own kernel") + (notes.length ? ' · ' + notes.join(' · ') : '');
      const r = await one(gpu, h, 'q4', pro, epi, K, kPer, (a) => (o ? gemvV5(gpu, a, o) : gemv(gpu, Object.assign(a, { kx: false }))));
      yield { name, variant, ok: r.ok, cos: r.cos, maxErr: r.maxErr };
    } catch (e) { yield { name, error: String(e.message || e) }; }
  }
  for (const [pro, epi, K, kPer] of Q8) {
    const name = `Assistant matrix-vector, 8-bit ${pro}.${epi} K ${K}`;
    try { const r = await one(gpu, h, 'q8', pro, epi, K, kPer, (a) => gemv(gpu, a)); yield { name, variant: "the engine's own kernel", ok: r.ok, cos: r.cos, maxErr: r.maxErr }; }
    catch (e) { yield { name, error: String(e.message || e) }; }
  }
  // decode attention: 512 keys of a 256-wide sliding layer and 1,024 of a 512-wide full one, as this device runs it (and the engine's)
  const ad = adNow();
  for (const [D, keys, ring] of [[256, 512, 512], [512, 1024, 0]]) for (const which of ad ? ['engine', ad.name] : ['engine']) {
    const name = `Assistant attention, head ${D}, ${keys} keys` + (which === 'engine' ? '' : ' (tuned)');
    try {
      const nh = 8, nkv = 1, kvLen = ring || keys, q = h.randn(nh * D, 70 + D, 0.1), kf = h.randn(kvLen * D, 71 + D, 0.5), vf = h.randn(kvLen * D, 72 + D);
      const k16 = toF16(kf), v16 = toF16(vf), kq = fromF16(k16), vq = fromF16(v16);
      const bufs = [gpu.upload(q), gpu.upload(k16), gpu.upload(v16), gpu.buffer(Math.ceil(keys / 16) * nh * (2 + D) * 4), gpu.buffer(nh * D * 4)];
      try {
        attnDec(gpu, { q: { buf: bufs[0] }, kc: { buf: bufs[1] }, vc: { buf: bufs[2] }, part: { buf: bufs[3] }, out: { buf: bufs[4] }, D, nh, kStart: 0, kEnd: keys, ring, nkv, kvLen,
          ad: which === 'engine' ? null : Object.assign({ name: which }, AD_CANDS[which]) });
        const got = new Float32Array(await gpu.read(bufs[4], 0, nh * D * 4)), want = new Float32Array(nh * D);
        for (let hh = 0; hh < nh; hh++) {
          const s = new Float64Array(keys); let m = -Infinity;
          for (let j = 0; j < keys; j++) { let a = 0; for (let d = 0; d < D; d++) a += q[hh * D + d] * kq[j * D + d]; s[j] = a; if (a > m) m = a; }
          let l = 0; for (let j = 0; j < keys; j++) { s[j] = Math.exp(s[j] - m); l += s[j]; }
          for (let d = 0; d < D; d++) { let a = 0; for (let j = 0; j < keys; j++) a += s[j] * vq[j * D + d]; want[hh * D + d] = a / l; }
        }
        const c = h.compare(got, want);
        yield { name, variant: which === 'engine' ? "64 keys a workgroup, all heads (the engine's)" : `by heads, ${AD_CANDS[which].CK} keys a workgroup`, ok: c.cos > 0.99999, cos: c.cos, maxErr: c.maxErr };
      } finally { bufs.forEach((b) => gpu.free(b)); }
    } catch (e) { yield { name, error: String(e.message || e) }; }
  }
}
