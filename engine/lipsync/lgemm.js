// p0pc0rn lip-sync GEMM: a FORK of ops/gemm.js / audio/agemm.js (same 64x128 tiles, same in-kernel q4/q8/f16 dequant, same Metal-safe
// whole-vec4 shared stores) with what the MuseTalk UNet + whisper need.  ops/gemm.js and audio/agemm.js stay byte-identical.
//   Y[m, n] = sum_k X'[m, k] * W[n, k]
// Prologues (x):  'f16'   X fp16 [M, ldx]            'f32'  X fp32 [M, ldx] (cast to f16 tiles)
//                 'ln'    X fp32 [M, ldx]; X' = (x - mean[m]) * rstd[m] * G[k] + Bt[k]   (LayerNorm with affine; stats from rowStats)
//                 'conv'  2-D implicit-GEMM conv over a BATCH of HWC f16 frames [F][Hi][Wi][Ci] (Ci % 4 == 0):
//                         row m = (f, oy, ox); k = (ky, kx, ci) with taps kh x kw; stride s; zero padding per frame; nearest-2x
//                         input (up2); k >= Kreal reads 0 (padded weights); optional fused GroupNorm apply per FRAME
//                         (coefficients [f][a(C) | b(C)] f32) followed by SiLU (gnAct 'silu') or nothing ('none');
//                         zero padding is applied AFTER the transform (torch semantics)
// Epilogues:       v = acc (+ bias[n]) -> act (none | silu | gelu (erf))
//                 'f16'   Y16 = v, or Y16 += v with res (in place residual)      'f32'  Y32 = v
//                 'add'   Y32 += v (fp32 residual)
//                 'geglu' weight rows [hidden | gate]: rows interleaved in the tile from wR0 (gate) / wR1 (hidden);
//                         Y16 = (h + bh) * GELU(g + bg)   (diffusers GEGLU: hidden, gate = proj(x).chunk(2); hidden * gelu(gate))
'use strict';
import { P } from '../core/gpu.js';

export const LG_TILE = { BM: 64, BN: 128 };
const ACTS = {
  none: (v) => v,
  silu: (v) => `(${v} / (vec4<f32>(1.0) + exp(-${v})))`,
  gelu: (v) => `gelu4(${v})`,
};

function keyOf(c) {
  return ['lgemm', c.w, c.x, c.epi, c.BM, c.BN, c.act || 'none', c.bias ? 'b' : '', c.res ? 'r' : '', c.gn || '', c.up2 ? 'up' : '', c.acc === 'f16' ? 'h' : ''].join('.');
}

export function lgemmCode(c) {
  const BM = c.BM, BN = c.BN, TM = 8, TN = 8, TX = BN / TN, TY = BM / TM, NT = TX * TY;
  if (NT > 256 || BM % 32 || BN % 64) throw new Error('bad tile ' + BM + 'x' + BN);
  const xf32 = c.x === 'ln' || c.x === 'f32';
  const B = [];
  const bind = (name, decl) => { B.push(name); return `@group(0) @binding(${B.length}) var<storage, ${decl}`; };
  const L = [];
  L.push('enable f16;');
  L.push(`struct P { M: u32, N: u32, K: u32, ldx: u32, kx0: u32, wR0: u32, wR1: u32, wG: u32, wk0: u32, ldy: u32, ny0: u32, mt0: u32, nt0: u32,
  statOff: u32, lnG: u32, lnB: u32, Hi: u32, Wi: u32, Ci: u32, Ho: u32, Wo: u32, stride: u32, padT: u32, padL: u32, kh: u32, kw: u32, Kreal: u32,
  gnOff: u32, gnC: u32, bvOff: u32, bvUp: u32, Nw: u32, xOff: u32, p0: u32 };`);
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push(bind('X', `read> X: array<${xf32 ? 'vec4<f32>' : 'vec4<f16>'}>;`));
  L.push(bind('W', 'read> W: array<u32>;'));
  const yT = c.epi === 'f32' || c.epi === 'add' ? 'vec4<f32>' : 'vec4<f16>';
  L.push(bind('Y', `read_write> Y: array<${yT}>;`));
  if (c.x === 'ln') { L.push(bind('ST', 'read> ST: array<f32>;')); L.push(bind('PV', 'read> PV: array<vec4<f32>>;')); }
  if (c.x === 'conv' && c.gn) L.push(bind('PV', 'read> PV: array<vec4<f32>>;'));
  if (c.bias) L.push(bind('BV', 'read> BV: array<f32>;'));
  L.push(`var<workgroup> xs: array<vec4<f16>, ${32 * BM / 4}>;`);
  L.push(`var<workgroup> ws: array<vec4<f16>, ${32 * BN / 4}>;`);
  if (c.act === 'gelu' || c.epi === 'geglu') {   // exact GELU via erf (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7)
    L.push(`fn gelu4(v: vec4<f32>) -> vec4<f32> {
  let z = abs(v) * 0.7071067811865476; let t = vec4<f32>(1.0) / (vec4<f32>(1.0) + 0.3275911 * z);
  let y = vec4<f32>(1.0) - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-z * z);
  return 0.5 * v * (vec4<f32>(1.0) + sign(v) * y);
}`);
  }
  L.push(`fn xload(row: u32, k0: u32, kq: u32) -> vec4<f16> {`);
  if (c.x === 'f16') {
    L.push(`  return X[(p.xOff + row * p.ldx + p.kx0 + k0) / 4u + kq];`);
  } else if (c.x === 'f32') {
    L.push(`  return vec4<f16>(X[(p.xOff + row * p.ldx + p.kx0 + k0) / 4u + kq]);`);
  } else if (c.x === 'ln') {
    L.push(`  let xv = X[(p.xOff + row * p.ldx + p.kx0 + k0) / 4u + kq]; let sr = (p.statOff + row) * 2u; let kk = (p.kx0 + k0) / 4u + kq;`);
    L.push(`  return vec4<f16>((xv - vec4<f32>(ST[sr])) * ST[sr + 1u] * PV[p.lnG / 4u + kk] + PV[p.lnB / 4u + kk]);`);
  } else if (c.x === 'conv') {
    L.push(`  let kk = k0 + kq * 4u; if (kk >= p.Kreal) { return vec4<f16>(0.0); }`);
    L.push(`  let HWo = p.Ho * p.Wo; let f = row / HWo; let r = row % HWo; let oy = r / p.Wo; let ox = r % p.Wo;`);
    L.push(`  let tap = kk / p.Ci; let ci = kk % p.Ci; let ky = tap / p.kw; let kx = tap % p.kw;`);
    L.push(`  let iy = i32(oy * p.stride + ky) - i32(p.padT); let ix = i32(ox * p.stride + kx) - i32(p.padL);`);
    const HH = c.up2 ? 'i32(p.Hi * 2u)' : 'i32(p.Hi)', WW = c.up2 ? 'i32(p.Wi * 2u)' : 'i32(p.Wi)';
    L.push(`  if (iy < 0 || ix < 0 || iy >= ${HH} || ix >= ${WW}) { return vec4<f16>(0.0); }`);
    L.push(`  let sy = u32(iy)${c.up2 ? ' >> 1u' : ''}; let sx = u32(ix)${c.up2 ? ' >> 1u' : ''};`);
    L.push(`  let xv = X[(p.xOff + ((f * p.Hi + sy) * p.Wi + sx) * p.Ci + ci) / 4u];`);
    if (c.gn) {
      L.push(`  let cq = ci / 4u; let gb = (p.gnOff + f * 2u * p.gnC) / 4u; let z = vec4<f32>(xv) * PV[gb + cq] + PV[gb + p.gnC / 4u + cq];`);
      L.push(c.gn === 'silu' ? '  return vec4<f16>(z / (vec4<f32>(1.0) + exp(-z)));' : '  return vec4<f16>(z);');
    } else L.push('  return xv;');
  } else throw new Error('lgemm: x mode ' + c.x);
  L.push('}');
  L.push(`fn wrow(nb: u32, cc: u32) -> u32 {`);
  if (c.epi === 'geglu') L.push(`  let o = (nb + cc) >> 1u; return select(p.wR1, p.wR0, (cc & 1u) == 0u) + o;`);
  else L.push(`  return min(p.wR0 + nb + cc, p.Nw - 1u);`);
  L.push('}');
  L.push(`@compute @workgroup_size(${NT})`);
  L.push(`fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {`);
  L.push(`  let mB = (wid.y + p.mt0) * ${BM}u; let nB = (wid.x + p.nt0) * ${BN}u;`);
  L.push(`  let tx = li % ${TX}u; let ty = li / ${TX}u;`);
  for (let r = 0; r < TM; r++) for (let j = 0; j < 2; j++) L.push(`  var a${r}_${j} = vec4<f32>(0.0);`);
  L.push(`  for (var k0 = 0u; k0 < p.K; k0 = k0 + 32u) {`);
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
  if (c.acc === 'f16') {
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
  if (c.epi === 'geglu') {
    if (c.bias) L.push(`  let ob = (nB >> 1u) + tx * 4u; let gB = vec4<f32>(BV[p.bvOff + ob], BV[p.bvOff + ob + 1u], BV[p.bvOff + ob + 2u], BV[p.bvOff + ob + 3u]); let uB = vec4<f32>(BV[p.bvUp + ob], BV[p.bvUp + ob + 1u], BV[p.bvUp + ob + 2u], BV[p.bvUp + ob + 3u]);`);
    else L.push('  let gB = vec4<f32>(0.0); let uB = gB;');
    rows((r) => `let gt = vec4<f32>(a${r}_0.x, a${r}_0.z, a${r}_1.x, a${r}_1.z) + gB; let hd = vec4<f32>(a${r}_0.y, a${r}_0.w, a${r}_1.y, a${r}_1.w) + uB;
      if ((nB >> 1u) + tx * 4u < p.N / 2u) { Y[(m * p.ldy + p.ny0 + (nB >> 1u) + tx * 4u) / 4u] = vec4<f16>(hd * gelu4(gt)); }`);
  } else {
    if (c.bias) L.push(`  let vb0 = min(p.bvOff + ${col}, p.bvOff + p.N - 1u); let vb1 = min(p.bvOff + ${col} + 4u, p.bvOff + p.N - 1u); let c0 = vec4<f32>(BV[vb0], BV[min(vb0 + 1u, p.bvOff + p.N - 1u)], BV[min(vb0 + 2u, p.bvOff + p.N - 1u)], BV[min(vb0 + 3u, p.bvOff + p.N - 1u)]); let c1 = vec4<f32>(BV[vb1], BV[min(vb1 + 1u, p.bvOff + p.N - 1u)], BV[min(vb1 + 2u, p.bvOff + p.N - 1u)], BV[min(vb1 + 3u, p.bvOff + p.N - 1u)]);`);
    else L.push('  let c0 = vec4<f32>(0.0); let c1 = c0;');
    rows((r) => {
      const e0 = `(m * p.ldy + p.ny0 + ${col}) / 4u`;
      const st = (i, v) => c.epi === 'add' ? `Y[${i}] = Y[${i}] + ${v};` : c.epi === 'f32' ? `Y[${i}] = ${v};` : c.res ? `Y[${i}] = vec4<f16>(vec4<f32>(Y[${i}]) + ${v});` : `Y[${i}] = vec4<f16>(${v});`;
      return `let b = ${e0}; let v0 = ${act(`(a${r}_0 + c0)`)}; let v1 = ${act(`(a${r}_1 + c1)`)};
      if (${col} < p.N) { ${st('b', 'v0')} }
      if (${col} + 4u < p.N) { ${st('b + 1u', 'v1')} }`;
    });
  }
  L.push('}');
  return { code: L.join('\n'), bindings: B };
}

/**
 * a = { w: {buf, off, enc, rows (Nw), cols (stored K), bytes}, x: {buf, off(elements; must be a multiple of 4), ld, k0, mode:'f16'|'f32'|'ln'},
 *       M, N, K, wr0, wr1, wk0, epi: 'f16'|'f32'|'add'|'geglu', act, res, y: {buf, off (bytes, 256-aligned) , ld, n0},
 *       bv: {buf, off (floats), up (floats, geglu hidden-bias start)}, stats: {buf, off(rows)}, ln: {buf, g(floats), b(floats)},
 *       conv: {Hi, Wi, Ci, Ho, Wo, stride, padT, padL, kh, kw, Kreal, up2, gn: {buf, off(floats), C, act:'silu'|'none'}}, acc, tile }
 * N must be a multiple of 4 (output stored as vec4); for 'geglu' N = 2 * output width.
 */
export function lgemm(gpu, a) {
  const enc = a.w.enc;
  const w = enc === 'q4g32a.t64' ? 'q4' : enc === 'q8g64s.t64' ? 'q8' : enc === 'f16' ? 'f16' : null;
  if (!w) throw new Error('lgemm: unsupported weight encoding ' + enc);
  const cv = a.conv || null;
  const tile = a.tile || (a.N <= 64 && a.epi !== 'geglu' ? { BM: 64, BN: 64 } : LG_TILE);
  const cfg = { w, x: cv ? 'conv' : (a.x.mode || 'f16'), epi: a.epi || 'f16', BM: tile.BM, BN: tile.BN, act: a.act || 'none', bias: !!a.bv,
    res: !!a.res, gn: cv && cv.gn ? (cv.gn.act || 'silu') : '', up2: !!(cv && cv.up2), acc: a.acc || (gpu.lsAcc) || 'f32' };
  const key = keyOf(cfg);
  const meta = gpu._lgemmMeta || (gpu._lgemmMeta = new Map());
  const pipe = gpu.pipeline(key, () => { const g = lgemmCode(cfg); meta.set(key, g.bindings); return g.code; });
  const bnames = meta.get(key);
  const M = a.M, N = a.N, K = a.K;
  if (K % 32) throw new Error('lgemm: K must be a multiple of 32 (pad the weights)');
  if (N % 4) throw new Error('lgemm: N must be a multiple of 4');
  const Ktot = a.w.cols, wG = w === 'q4' ? Ktot / 32 : w === 'q8' ? Ktot / 64 : (a.w.ld || Ktot);
  const ntiles = Math.ceil(N / cfg.BN), mtiles = Math.ceil(M / cfg.BM);
  const flopsTile = 2 * cfg.BM * cfg.BN * K;
  const rmm = (cfg.acc === 'f16' ? gpu.rate.mm16 : gpu.rate.mm32) || gpu.rate.mm, cap = rmm * gpu.opts.maxDispatchSeconds;
  let nPer = ntiles, mPer = Math.max(1, Math.floor(cap / (flopsTile * ntiles)));
  if (flopsTile * ntiles > cap) { mPer = 1; nPer = Math.max(1, Math.floor(cap / flopsTile)); }
  mPer = Math.min(mPer, 65535);
  const full = (b) => ({ buffer: b, offset: 0, size: Math.floor(b._pf / 16) * 16 });
  const views = {
    X: full(a.x.buf), W: { buffer: a.w.buf, offset: a.w.off || 0, size: Math.floor((a.w.bytes + 15) / 16) * 16 },
    Y: { buffer: a.y.buf, offset: a.y.off || 0, size: Math.floor((a.y.buf._pf - (a.y.off || 0)) / 16) * 16 },
    ST: a.stats && full(a.stats.buf), PV: (a.ln && full(a.ln.buf)) || (cv && cv.gn && full(cv.gn.buf)), BV: a.bv && full(a.bv.buf),
  };
  if (views.W.offset + views.W.size > a.w.buf._pf) views.W.size = Math.floor((a.w.buf._pf - views.W.offset) / 16) * 16;
  const binds = bnames.map((n) => { if (!views[n]) throw new Error('lgemm: missing binding ' + n + ' for ' + key); return views[n]; });
  const c = cv || {}, ln = a.ln || {}, gn = (cv && cv.gn) || {};
  if ((a.x.off || 0) % 4) throw new Error('lgemm: x offset must be a multiple of 4 elements');
  for (let m0 = 0; m0 < mtiles; m0 += mPer) {
    for (let n0 = 0; n0 < ntiles; n0 += nPer) {
      const mt = Math.min(mPer, mtiles - m0), nt = Math.min(nPer, ntiles - n0);
      const pr = P().u32(M).u32(N).u32(K).u32(a.x.ld || K).u32(a.x.k0 || 0).u32(a.wr0 || 0).u32(a.wr1 || 0).u32(wG).u32(a.wk0 || 0)
        .u32(a.y.ld || N).u32(a.y.n0 || 0).u32(m0).u32(n0)
        .u32(a.stats ? a.stats.off || 0 : 0).u32(ln.g || 0).u32(ln.b || 0)
        .u32(c.Hi || 0).u32(c.Wi || 0).u32(c.Ci || 4).u32(c.Ho || 1).u32(c.Wo || 1).u32(c.stride || 1).u32(c.padT || 0).u32(c.padL || 0)
        .u32(c.kh || 1).u32(c.kw || 1).u32(c.Kreal || K).u32(gn.off || 0).u32(gn.C || 0)
        .u32(a.bv ? a.bv.off || 0 : 0).u32(a.bv ? a.bv.up || 0 : 0).u32(a.w.rows).u32(a.x.off || 0).u32(0);
      gpu.runner.dispatch(pipe, binds, pr.ab, [nt, mt], (flopsTile * mt * nt) / rmm);
    }
  }
  return 2 * M * N * K;
}
