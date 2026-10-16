// Pocket Audio GEMM: a FORK of ops/gemm.js (same tiles, same in-kernel dequant, same Metal-safe whole-vec4 shared stores) with the
// prologues / epilogues the audio networks need.  ops/gemm.js stays byte-identical.   Y[m, n] = sum_k X'[m, k] * W[n, k]
//
// Prologues (x):  'f16'    X fp16 [M, ldx]
//                 'lnmod'  X fp32 [M, ldx]; X' = (x - mean[m]) * rstd[m] * (1 + S[mr, k]) + B[mr, k], mr = (m / pvDiv) * pvLd
//                          (pvLd = 0: one row for all = LayerNorm affine with S = gamma - 1, B = beta; pvDiv = 1: per-token adaLN)
//                 'conv'   1-D implicit-GEMM conv over channel-last fp16 X [B * Tin, Ci] (Ci % 4 == 0), row m = (b, t), k = (tap, ci):
//                          x[b, t + tap*dil - pad, ci] (zero outside, zero for k >= Kreal); up2 = nearest-x2 input (VAE upsample)
//                 'tconv'  ConvTranspose1d(k = 2u, stride u, pad u/2) as ONE GEMM: row q = 0..Tin, k = (s, ci): x[q - s, ci];
//                          weight rows (r, co) = W[ci, co, r + u*s]; output row q starts at element (q*u - u/2)*Cout -> yNeg / yLim
// Epilogues:       v = acc (+ bias[n]) -> act (none | quickgelu | gelu (erf) | silu | selu)
//                 'f16' | 'f32'  store at m*ldy + ny0 + n - yNeg (whole vec4s; skipped outside [0, yLim) when yLim > 0)
//                 'add'   fp32 Y = ya * Y + vb * gate * v; gate none | 'col' EV[gOff + n] | 'row' EV[gOff + (m / gDiv) * gLd + n]
//                 'swiglu' weight rows [gate | up] (interleaved in the tile), Y16 = silu(gate + bg) * (up + bu)
'use strict';
import { P } from '../core/gpu.js';

export const AG_TILE = { BM: 64, BN: 128 };
const ACTS = {
  none: (v) => v,
  quickgelu: (v) => `(${v} / (vec4<f32>(1.0) + exp(-1.702 * ${v})))`,
  silu: (v) => `(${v} / (vec4<f32>(1.0) + exp(-${v})))`,
  selu: (v) => `select(1.6732632423543772 * (exp(min(${v}, vec4<f32>(0.0))) - vec4<f32>(1.0)), ${v}, ${v} > vec4<f32>(0.0)) * 1.0507009873554805`,
  gelu: (v) => `gelu4(${v})`,
  mpsilu: (v) => `(${v} / (vec4<f32>(1.0) + exp(-${v})) / 0.596)`,
};

function keyOf(c) {
  return ['agemm', c.w, c.x, c.epi, c.BM, c.BN, c.act || 'none', c.bias ? 'b' : '', c.gate || '', c.up2 ? 'up' : '', c.acc === 'f16' ? 'h' : ''].join('.');
}

export function agemmCode(c) {
  const BM = c.BM, BN = c.BN, TM = 8, TN = 8, TX = BN / TN, TY = BM / TM, NT = TX * TY;
  if (NT > 256 || BM % 32 || BN % 64) throw new Error('bad tile ' + BM + 'x' + BN);
  const xf32 = c.x === 'lnmod';
  const B = [];
  const bind = (name, decl) => { B.push(name); return `@group(0) @binding(${B.length}) var<storage, ${decl}`; };
  const L = [];
  L.push('enable f16;');
  L.push(`struct P { M: u32, N: u32, K: u32, ldx: u32, kx0: u32, wR0: u32, wR1: u32, wG: u32, wk0: u32, ldy: u32, ny0: u32, mt0: u32, nt0: u32,
  statOff: u32, pvS: u32, pvB: u32, pvLd: u32, pvDiv: u32, Tin: u32, Tout: u32, Ci: u32, dil: u32, pad: u32, Kreal: u32,
  bvOff: u32, bvUp: u32, gOff: u32, gLd: u32, gDiv: u32, ya: f32, vb: f32, yNeg: u32, yLim: u32, Nw: u32, xRB: u32, xR0: u32 };`);
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push(bind('X', `read> X: array<${xf32 ? 'vec4<f32>' : 'vec4<f16>'}>;`));
  L.push(bind('W', 'read> W: array<u32>;'));
  const yT = c.epi === 'f32' || c.epi === 'add' ? 'vec4<f32>' : 'vec4<f16>';
  L.push(bind('Y', `read_write> Y: array<${yT}>;`));
  if (xf32) { L.push(bind('ST', 'read> ST: array<f32>;')); L.push(bind('PV', 'read> PV: array<vec4<f32>>;')); }
  if (c.gate) L.push(bind('EV', 'read> EV: array<f32>;'));
  if (c.bias) L.push(bind('BV', 'read> BV: array<f32>;'));
  L.push(`var<workgroup> xs: array<vec4<f16>, ${32 * BM / 4}>;`);
  L.push(`var<workgroup> ws: array<vec4<f16>, ${32 * BN / 4}>;`);
  if (c.act === 'gelu') {   // exact GELU via erf (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7)
    L.push(`fn gelu4(v: vec4<f32>) -> vec4<f32> {
  let z = abs(v) * 0.7071067811865476; let t = vec4<f32>(1.0) / (vec4<f32>(1.0) + 0.3275911 * z);
  let y = vec4<f32>(1.0) - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-z * z);
  return 0.5 * v * (vec4<f32>(1.0) + sign(v) * y);
}`);
  }
  L.push(`fn xload(row: u32, k0: u32, kq: u32) -> vec4<f16> {`);
  if (c.x === 'f16') {
    L.push(`  return X[(row * p.ldx + p.kx0 + k0) / 4u + kq];`);
  } else if (xf32) {
    L.push(`  let xv = X[(row * p.ldx + p.kx0 + k0) / 4u + kq]; let sr = (p.statOff + row) * 2u; let kk = (p.kx0 + k0) / 4u + kq;`);
    L.push(`  let mr = (row / p.pvDiv) * p.pvLd / 4u;`);
    L.push(`  return vec4<f16>((xv - vec4<f32>(ST[sr])) * ST[sr + 1u] * (vec4<f32>(1.0) + PV[p.pvS / 4u + mr + kk]) + PV[p.pvB / 4u + mr + kk]);`);
  } else if (c.x === 'conv') {
    L.push(`  let kk = k0 + kq * 4u; if (kk >= p.Kreal) { return vec4<f16>(0.0); }`);
    L.push(`  let b = row / p.Tout; let t = row % p.Tout; let tap = kk / p.Ci; let ci = kk % p.Ci;`);
    L.push(`  let ti = i32(t) + i32(tap * p.dil) - i32(p.pad);`);
    if (c.up2) L.push(`  if (ti < 0 || ti >= i32(p.Tin * 2u)) { return vec4<f16>(0.0); } let src = u32(ti) >> 1u;`);
    else L.push(`  if (ti < 0 || ti >= i32(p.Tin)) { return vec4<f16>(0.0); } let src = u32(ti);`);
    L.push(`  return X[((b * p.xRB + p.xR0 + src) * p.Ci + ci) / 4u];`);
  } else if (c.x === 'tconv') {
    L.push(`  let kk = k0 + kq * 4u; if (kk >= p.Kreal) { return vec4<f16>(0.0); }`);
    L.push(`  let s = kk / p.Ci; let ci = kk % p.Ci; let src = i32(row) - i32(s);`);
    L.push(`  if (src < 0 || src >= i32(p.Tin)) { return vec4<f16>(0.0); }`);
    L.push(`  return X[(u32(src) * p.Ci + ci) / 4u];`);
  } else throw new Error('agemm: x mode ' + c.x);
  L.push('}');
  L.push(`fn wrow(nb: u32, cc: u32) -> u32 {`);
  if (c.epi === 'swiglu') L.push(`  let o = (nb + cc) >> 1u; return select(p.wR1, p.wR0, (cc & 1u) == 0u) + o;`);
  else L.push(`  return min(p.wR0 + nb + cc, p.Nw - 1u);`);
  L.push('}');
  L.push(`@compute @workgroup_size(${NT})`);
  L.push(`fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {`);
  L.push(`  let mB = (wid.y + p.mt0) * ${BM}u; let nB = (wid.x + p.nt0) * ${BN}u;`);
  L.push(`  let tx = li % ${TX}u; let ty = li / ${TX}u;`);
  for (let r = 0; r < TM; r++) for (let j = 0; j < 2; j++) L.push(`  var a${r}_${j} = vec4<f32>(0.0);`);
  L.push(`  for (var k0 = 0u; k0 < p.K; k0 = k0 + 32u) {`);
  // X tile -> xs[k][m/4], transposed through registers, WHOLE vec4 stores only (Metal RMW race rule)
  L.push(`    for (var t = li; t < ${BM * 2}u; t = t + ${NT}u) {`);
  L.push(`      let mq = t >> 3u; let kq = t & 7u; let r0 = mB + mq * 4u; let lm = p.M - 1u;`);
  L.push(`      let v0 = xload(min(r0, lm), k0, kq); let v1 = xload(min(r0 + 1u, lm), k0, kq); let v2 = xload(min(r0 + 2u, lm), k0, kq); let v3 = xload(min(r0 + 3u, lm), k0, kq);`);
  L.push(`      let xo = kq * 4u * ${BM / 4}u + mq;`);
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`      xs[xo + ${j * BM / 4}u] = vec4<f16>(v0.${cc}, v1.${cc}, v2.${cc}, v3.${cc});`));
  L.push('    }');
  if (c.w === 'q4') {
    L.push(`    let gi = (p.wk0 + k0) / 32u;`);
    L.push(`    for (var t = li; t < ${BN}u; t = t + ${NT}u) {`);
    L.push(`      let cq = t % ${BN / 4}u; let w = t / ${BN / 4}u;`);
    L.push(`      var q: vec4<u32>; var sc: vec4<f32>; var mn: vec4<f32>;`);
    L.push(`      for (var j = 0u; j < 4u; j = j + 1u) { let r = wrow(nB, cq * 4u + j); let rec = ((r >> 6u) * p.wG + gi) * 320u; let rr = r & 63u;`);
    L.push(`        q[j] = W[rec + rr * 4u + w]; let sm = unpack2x16float(W[rec + 256u + rr]); sc[j] = sm.x; mn[j] = sm.y; }`);
    L.push(`      for (var i = 0u; i < 8u; i = i + 1u) {`);
    L.push(`        let cv = vec4<f32>((q >> vec4<u32>(4u * i)) & vec4<u32>(15u));`);
    L.push(`        ws[(w * 8u + i) * ${BN / 4}u + cq] = vec4<f16>(cv * sc + mn); }`);
    L.push('    }');
  } else if (c.w === 'q8') {
    L.push(`    let gi = (p.wk0 + k0) / 64u; let hf = ((p.wk0 + k0) / 32u) & 1u;`);
    L.push(`    for (var t = li; t < ${BN * 2}u; t = t + ${NT}u) {`);
    L.push(`      let cq = t % ${BN / 4}u; let w = t / ${BN / 4}u;`);
    L.push(`      var q: vec4<u32>; var sc: vec4<f32>;`);
    L.push(`      for (var j = 0u; j < 4u; j = j + 1u) { let r = wrow(nB, cq * 4u + j); let rec = ((r >> 6u) * p.wG + gi) * 1056u; let rr = r & 63u;`);
    L.push(`        q[j] = W[rec + rr * 16u + hf * 8u + w]; let s2 = unpack2x16float(W[rec + 1024u + (rr >> 1u)]); sc[j] = select(s2.x, s2.y, (rr & 1u) == 1u); }`);
    L.push(`      for (var i = 0u; i < 4u; i = i + 1u) {`);
    L.push(`        let cv = vec4<f32>((vec4<i32>(q << vec4<u32>(24u - 8u * i))) >> vec4<u32>(24u));`);
    L.push(`        ws[(w * 4u + i) * ${BN / 4}u + cq] = vec4<f16>(cv * sc); }`);
    L.push('    }');
  } else {
    L.push(`    for (var t = li; t < ${BN * 4}u; t = t + ${NT}u) {`);
    L.push(`      let cq = t % ${BN / 4}u; let w = t / ${BN / 4}u;`);
    L.push(`      var lo: vec4<f16>; var hi: vec4<f16>;`);
    L.push(`      for (var j = 0u; j < 4u; j = j + 1u) { let r = wrow(nB, cq * 4u + j); let h2 = bitcast<vec2<f16>>(W[(r * p.wG + p.wk0 + k0) / 2u + w]); lo[j] = h2.x; hi[j] = h2.y; }`);
    L.push(`      ws[(w * 2u) * ${BN / 4}u + cq] = lo; ws[(w * 2u + 1u) * ${BN / 4}u + cq] = hi;`);
    L.push('    }');
  }
  L.push('    workgroupBarrier();');
  if (c.acc === 'f16') for (let r = 0; r < TM; r++) for (let j = 0; j < 2; j++) L.push(`    var h${r}_${j} = vec4<f16>(0.0);`);
  L.push(`    for (var k = 0u; k < 32u; k = k + 1u) {`);
  L.push(`      let xb = k * ${BM / 4}u + ty * 2u; let kb = k * ${BN / 4}u;`);
  if (c.acc === 'f16') {   // fp16 partial sums over one 32-k tile, flushed into the fp32 accumulators (engine 'f16 accumulate' mode)
    L.push(`      let x0 = xs[xb]; let x1 = xs[xb + 1u]; let u0 = ws[kb + tx * 2u]; let u1 = ws[kb + tx * 2u + 1u];`);
    for (let r = 0; r < TM; r++) { const xv = `x${r >> 2}[${r & 3}]`; L.push(`      h${r}_0 = fma(vec4<f16>(${xv}), u0, h${r}_0); h${r}_1 = fma(vec4<f16>(${xv}), u1, h${r}_1);`); }
  } else {
    L.push(`      let x0 = vec4<f32>(xs[xb]); let x1 = vec4<f32>(xs[xb + 1u]); let u0 = vec4<f32>(ws[kb + tx * 2u]); let u1 = vec4<f32>(ws[kb + tx * 2u + 1u]);`);
    for (let r = 0; r < TM; r++) { const xv = `x${r >> 2}[${r & 3}]`; L.push(`      a${r}_0 = fma(vec4<f32>(${xv}), u0, a${r}_0); a${r}_1 = fma(vec4<f32>(${xv}), u1, a${r}_1);`); }
  }
  L.push('    }');
  if (c.acc === 'f16') for (let r = 0; r < TM; r++) for (let j = 0; j < 2; j++) L.push(`    a${r}_${j} = a${r}_${j} + vec4<f32>(h${r}_${j});`);
  L.push('    workgroupBarrier();');
  L.push('  }');
  // ---- epilogues
  const rows = (fn) => { for (let r = 0; r < TM; r++) L.push(`  { let m = mB + ty * 8u + ${r}u; if (m < p.M) { ${fn(r)} } }`); };
  const col = `nB + tx * 8u`;
  const act = ACTS[c.act || 'none'];
  if (c.epi === 'swiglu') {
    if (c.bias) L.push(`  let ob = p.bvOff + (nB >> 1u) + tx * 4u; let gB = vec4<f32>(BV[ob], BV[ob + 1u], BV[ob + 2u], BV[ob + 3u]); let uB = vec4<f32>(BV[ob + p.bvUp], BV[ob + p.bvUp + 1u], BV[ob + p.bvUp + 2u], BV[ob + p.bvUp + 3u]);`);
    else L.push('  let gB = vec4<f32>(0.0); let uB = gB;');
    rows((r) => `let g = vec4<f32>(a${r}_0.x, a${r}_0.z, a${r}_1.x, a${r}_1.z) + gB; let u = vec4<f32>(a${r}_0.y, a${r}_0.w, a${r}_1.y, a${r}_1.w) + uB;
      if ((nB >> 1u) + tx * 4u < p.N / 2u) { Y[(m * p.ldy + p.ny0 + (nB >> 1u) + tx * 4u) / 4u] = vec4<f16>(g / (vec4<f32>(1.0) + exp(-g)) * u); }`);
  } else {
    if (c.bias) L.push(`  let vb0 = p.bvOff + ${col}; let c0 = vec4<f32>(BV[vb0], BV[vb0 + 1u], BV[vb0 + 2u], BV[vb0 + 3u]); let c1 = vec4<f32>(BV[vb0 + 4u], BV[vb0 + 5u], BV[vb0 + 6u], BV[vb0 + 7u]);`);
    else L.push('  let c0 = vec4<f32>(0.0); let c1 = c0;');
    if (c.gate === 'col') L.push(`  let gb = p.gOff + ${col}; let g0 = vec4<f32>(EV[gb], EV[gb + 1u], EV[gb + 2u], EV[gb + 3u]); let g1 = vec4<f32>(EV[gb + 4u], EV[gb + 5u], EV[gb + 6u], EV[gb + 7u]);`);
    const gateRow = c.gate === 'row';
    const T = c.epi === 'f16' ? 'vec4<f16>' : 'vec4<f32>';
    rows((r) => {
      let s = `let e = i32(m * p.ldy + p.ny0 + ${col}) - i32(p.yNeg); let lim = select(0x7fffffff, i32(p.yLim), p.yLim > 0u);
      let v0 = ${act(`(a${r}_0 + c0)`)}; let v1 = ${act(`(a${r}_1 + c1)`)};`;
      if (gateRow) s += ` let gb = p.gOff + (m / p.gDiv) * p.gLd + ${col}; let g0 = vec4<f32>(EV[gb], EV[gb + 1u], EV[gb + 2u], EV[gb + 3u]); let g1 = vec4<f32>(EV[gb + 4u], EV[gb + 5u], EV[gb + 6u], EV[gb + 7u]);`;
      if (!c.gate) s += ' let g0 = vec4<f32>(1.0); let g1 = g0;';
      const st = (i, v, g) => c.epi === 'add' ? `Y[${i}] = p.ya * Y[${i}] + p.vb * ${g} * ${v};` : `Y[${i}] = ${T}(${v});`;
      s += `
      if (${col} < p.N && e >= 0 && e + 4 <= lim) { let b = u32(e) / 4u; ${st('b', 'v0', 'g0')} }
      if (${col} + 4u < p.N && e + 4 >= 0 && e + 8 <= lim) { let b = u32(e + 4) / 4u; ${st('b', 'v1', 'g1')} }`;
      return s;
    });
  }
  L.push('}');
  return { code: L.join('\n'), bindings: B };
}

/**
 * a = { w: {buf, off, enc, rows (Nw), cols (stored K), bytes}, x: {buf, off, ld, k0, mode:'f16'|'lnmod'}, M, N, K, wr0, wr1, wk0,
 *       epi: 'f16'|'f32'|'add'|'swiglu', act, y: {buf, off, ld, n0}, bv: {buf, off, up}, gate: {buf, off, ld, div, mode:'col'|'row'},
 *       ya=1, vb=1, yNeg=0, yLim=0, stats: {buf, off(rows)}, pv: {buf, s(floats), b(floats), ld(floats), div},
 *       conv: {kind:'conv'|'tconv', Tin, Tout, Ci, dil, pad, Kreal, up2, xRB (rows per batch item in X, default Tin), xR0}, tile }
 */
export function agemm(gpu, a) {
  const enc = a.w.enc;
  const w = enc === 'q4g32a.t64' ? 'q4' : enc === 'q8g64s.t64' ? 'q8' : enc === 'f16' ? 'f16' : null;
  if (!w) throw new Error('agemm: unsupported weight encoding ' + enc);
  const cv = a.conv || null;
  const tile = a.tile || (a.N <= 64 && a.epi !== 'swiglu' ? { BM: 64, BN: 64 } : AG_TILE);
  const cfg = { w, x: cv ? cv.kind : (a.x.mode || 'f16'), epi: a.epi || 'f16', BM: tile.BM, BN: tile.BN, act: a.act || 'none', bias: !!a.bv,
    gate: a.gate ? a.gate.mode : '', up2: !!(cv && cv.up2), acc: a.acc || (gpu.audioAcc && gpu.audioAcc[a.net || '']) || 'f32' };
  const key = keyOf(cfg);
  const meta = gpu._agemmMeta || (gpu._agemmMeta = new Map());
  const pipe = gpu.pipeline(key, () => { const g = agemmCode(cfg); meta.set(key, g.bindings); return g.code; });
  const bnames = meta.get(key);
  const M = a.M, N = a.N, K = a.K;
  if (K % 32) throw new Error('agemm: K must be a multiple of 32 (pad the weights)');
  const Ktot = a.w.cols, wG = w === 'q4' ? Ktot / 32 : w === 'q8' ? Ktot / 64 : (a.w.ld || Ktot);
  const ntiles = Math.ceil(N / cfg.BN), mtiles = Math.ceil(M / cfg.BM);
  const flopsTile = 2 * cfg.BM * cfg.BN * K;
  const rmm = (cfg.acc === 'f16' ? gpu.rate.mm16 : gpu.rate.mm32) || gpu.rate.mm, cap = rmm * gpu.opts.maxDispatchSeconds;
  let nPer = ntiles, mPer = Math.max(1, Math.floor(cap / (flopsTile * ntiles)));
  if (flopsTile * ntiles > cap) { mPer = 1; nPer = Math.max(1, Math.floor(cap / flopsTile)); }
  const sz = (t) => (t.size != null ? t.size : t.buf._pf - (t.off || 0));
  const views = {
    X: { buffer: a.x.buf, offset: a.x.off || 0, size: sz(a.x) }, W: { buffer: a.w.buf, offset: a.w.off || 0, size: a.w.bytes },
    Y: { buffer: a.y.buf, offset: a.y.off || 0, size: sz(a.y) },
    ST: a.stats && { buffer: a.stats.buf, offset: 0, size: a.stats.buf._pf }, PV: a.pv && { buffer: a.pv.buf, offset: 0, size: a.pv.buf._pf },
    EV: a.gate && { buffer: a.gate.buf, offset: 0, size: a.gate.buf._pf }, BV: a.bv && { buffer: a.bv.buf, offset: 0, size: a.bv.buf._pf },
  };
  for (const k in views) if (views[k]) views[k].size = Math.floor(views[k].size / 16) * 16 || 16;
  const binds = bnames.map((n) => { if (!views[n]) throw new Error('agemm: missing binding ' + n + ' for ' + key); return views[n]; });
  const c = cv || {}, pv = a.pv || {}, gt = a.gate || {};
  for (let m0 = 0; m0 < mtiles; m0 += mPer) {
    for (let n0 = 0; n0 < ntiles; n0 += nPer) {
      const mt = Math.min(mPer, mtiles - m0), nt = Math.min(nPer, ntiles - n0);
      const pr = P().u32(M).u32(N).u32(K).u32(a.x.ld || K).u32(a.x.k0 || 0).u32(a.wr0 || 0).u32(a.wr1 || 0).u32(wG).u32(a.wk0 || 0)
        .u32(a.y.ld || N).u32(a.y.n0 || 0).u32(m0).u32(n0)
        .u32(a.stats ? a.stats.off || 0 : 0).u32(pv.s || 0).u32(pv.b || 0).u32(pv.ld || 0).u32(pv.div || 1)
        .u32(c.Tin || 0).u32(c.Tout || 1).u32(c.Ci || 4).u32(c.dil || 1).u32(c.pad || 0).u32(c.Kreal || K)
        .u32(a.bv ? a.bv.off || 0 : 0).u32(a.bv ? a.bv.up || 0 : 0).u32(gt.off || 0).u32(gt.ld || 0).u32(gt.div || 1)
        .f32(a.ya != null ? a.ya : 1).f32(a.vb != null ? a.vb : 1).u32(a.yNeg || 0).u32(a.yLim || 0).u32(a.w.rows)
        .u32(c.xRB != null ? c.xRB : (c.Tin || 0)).u32(c.xR0 || 0);
      gpu.runner.dispatch(pipe, binds, pr.ab, [nt, mt], (flopsTile * mt * nt) / rmm);
    }
  }
  return 2 * M * N * K;
}
