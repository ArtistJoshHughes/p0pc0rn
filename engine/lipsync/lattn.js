// p0pc0rn lip-sync attention: a parametrised copy of audio/aattn.js attnD (itself the core BQ64 no-subgroup flash kernel: scores fp32 in
// registers, P fp16 in a shared tile, row max / sum through a small shared reduce, Metal-safe whole-vec4 shared stores), extended with
//  - SEPARATE strides for Q, K, V and O (cross-attention reads Q from the image tokens and K/V from 50 audio tokens per frame),
//  - BQ 32 (64 threads) for wide heads: d 160 (UNet 8x8 / 4x4 levels) fits 23 KB of workgroup memory.
// Element (inst = b*H + h, row r, d) of X lives at X.off + b*X.bS + h*X.hS + r*X.ld + d (halves).  D = padded head dim (multiple of 32),
// Dr = real head dim (<= D; the pad lanes read 0 and are never stored).
'use strict';
import { P } from '../core/gpu.js';

const bw = (b) => ({ buffer: b, offset: 0, size: Math.floor(b._pf / 16) * 16 });

export function lattnCode(D, BQ, split = false) {   // v026.9 split: K half the head dim at a time, V 16 keys at a time (16 KB devices)
  const NT = BQ * 2, TQ = BQ / 4, Q4 = BQ / 4, DV4 = D / 4, DPL = DV4 / 8, KH = split ? 2 : 1, DH4 = DV4 / KH, DH = D / KH, VK = split ? 16 : 32;
  if (DV4 % 8) throw new Error('lattn: D must be a multiple of 32');
  const L = [];
  L.push('enable f16;');
  L.push(`struct P { Lq: u32, Lk: u32, H: u32, scale: f32, qOff: u32, kOff: u32, vOff: u32, oOff: u32, qld: u32, kld: u32, vld: u32, old: u32,
  qhS: u32, khS: u32, vhS: u32, ohS: u32, qbS: u32, kbS: u32, vbS: u32, obS: u32, Dr: u32, qt0: u32, h0: u32, p0: u32 };`);
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> Qb: array<vec4<f16>>;');
  L.push('@group(0) @binding(2) var<storage, read> Kb: array<vec4<f16>>;');
  L.push('@group(0) @binding(3) var<storage, read> Vb: array<vec4<f16>>;');
  L.push('@group(0) @binding(4) var<storage, read_write> Ob: array<vec4<f16>>;');
  L.push(`var<workgroup> qT: array<vec4<f16>, ${D * Q4}>;`);
  L.push(`var<workgroup> kT: array<vec4<f16>, ${D * 8 / KH}>;`);
  L.push(`var<workgroup> pS: array<f16, ${32 * BQ}>;`);
  L.push(`var<workgroup> rS: array<f32, ${BQ * 8}>;`);
  L.push(`@compute @workgroup_size(${NT})`);
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push(`  let hi = wid.y + p.h0; let b = hi / p.H; let h = hi % p.H; let q0 = (wid.x + p.qt0) * ${BQ}u;`);
  L.push('  let qb = p.qOff + b * p.qbS + h * p.qhS; let kb = p.kOff + b * p.kbS + h * p.khS; let vb0 = p.vOff + b * p.vbS + h * p.vhS;');
  L.push('  let ty = li / 8u; let tx = li % 8u; let DR4 = p.Dr / 4u; let lq = p.Lq - 1u; let lk = p.Lk - 1u;');
  L.push(`  for (var t = li; t < ${Q4 * DV4}u; t = t + ${NT}u) { let qq4 = t / ${DV4}u; let d4 = t % ${DV4}u; let qa = q0 + qq4 * 4u;`);
  L.push('    var a = vec4<f16>(0.0); var bb = a; var c = a; var e = a;');
  L.push('    if (d4 < DR4) { a = Qb[(qb + min(qa, lq) * p.qld) / 4u + d4]; bb = Qb[(qb + min(qa + 1u, lq) * p.qld) / 4u + d4]; c = Qb[(qb + min(qa + 2u, lq) * p.qld) / 4u + d4]; e = Qb[(qb + min(qa + 3u, lq) * p.qld) / 4u + d4]; }');
  L.push(`    let o = d4 * 4u * ${Q4}u + qq4;`);
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`    qT[o + ${j * Q4}u] = vec4<f16>(a.${cc}, bb.${cc}, c.${cc}, e.${cc});`));
  L.push('  }');
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < DPL; cI++) L.push(`  var o${r}${cI} = vec4<f32>(0.0);`);
  for (let r = 0; r < 4; r++) L.push(`  var m${r} = -1.0e30; var l${r} = 0.0;`);
  L.push('  for (var k0 = 0u; k0 < p.Lk; k0 = k0 + 32u) {');
  for (let r = 0; r < 4; r++) L.push(`    var s${r} = vec4<f32>(0.0);`);
  L.push(`    for (var hf = 0u; hf < ${KH}u; hf = hf + 1u) {`);
  L.push('    workgroupBarrier();');
  L.push(`    for (var t = li; t < ${8 * DH4}u; t = t + ${NT}u) { let kk4 = t / ${DH4}u; let dl4 = t % ${DH4}u; let d4 = hf * ${DH4}u + dl4; let ka = k0 + kk4 * 4u;`);
  L.push('      var a = vec4<f16>(0.0); var bb = a; var c = a; var e = a;');
  L.push('      if (d4 < DR4) { a = Kb[(kb + min(ka, lk) * p.kld) / 4u + d4]; bb = Kb[(kb + min(ka + 1u, lk) * p.kld) / 4u + d4]; c = Kb[(kb + min(ka + 2u, lk) * p.kld) / 4u + d4]; e = Kb[(kb + min(ka + 3u, lk) * p.kld) / 4u + d4]; }');
  L.push('      let o = dl4 * 32u + kk4;');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`      kT[o + ${j * 8}u] = vec4<f16>(a.${cc}, bb.${cc}, c.${cc}, e.${cc});`));
  L.push('    }');
  L.push('    workgroupBarrier();');
  L.push(`    for (var dl = 0u; dl < ${DH}u; dl = dl + 1u) { let d = hf * ${DH}u + dl; let qv = vec4<f32>(qT[d * ${Q4}u + ty]); let kv = vec4<f32>(kT[dl * 8u + tx]);`);
  for (let r = 0; r < 4; r++) L.push(`      s${r} = fma(vec4<f32>(qv[${r}]), kv, s${r});`);
  L.push('    }');
  L.push('    }');
  L.push('    let kj = k0 + tx * 4u + vec4<u32>(0u, 1u, 2u, 3u);');
  for (let r = 0; r < 4; r++) L.push(`    s${r} = select(vec4<f32>(-1.0e30), s${r} * p.scale, kj < vec4<u32>(p.Lk));`);
  for (let r = 0; r < 4; r++) L.push(`    var mx${r} = max(max(s${r}.x, s${r}.y), max(s${r}.z, s${r}.w));`);
  for (let r = 0; r < 4; r++) L.push(`    rS[(ty * 4u + ${r}u) * 8u + tx] = mx${r};`);
  L.push('    workgroupBarrier();');
  for (let r = 0; r < 4; r++) L.push(`    for (var i = 0u; i < 8u; i = i + 1u) { mx${r} = max(mx${r}, rS[(ty * 4u + ${r}u) * 8u + i]); }`);
  L.push('    workgroupBarrier();');
  for (let r = 0; r < 4; r++) {
    L.push(`    let mn${r} = max(m${r}, mx${r}); let pe${r} = select(exp2(s${r} - vec4<f32>(mn${r})), vec4<f32>(0.0), s${r} <= vec4<f32>(-1.0e29));`);
    L.push(`    var sm${r} = pe${r}.x + pe${r}.y + pe${r}.z + pe${r}.w;`);
  }
  for (let r = 0; r < 4; r++) L.push(`    rS[(ty * 4u + ${r}u) * 8u + tx] = sm${r};`);
  L.push('    workgroupBarrier();');
  for (let r = 0; r < 4; r++) L.push(`    sm${r} = 0.0; for (var i = 0u; i < 8u; i = i + 1u) { sm${r} = sm${r} + rS[(ty * 4u + ${r}u) * 8u + i]; }`);
  for (let r = 0; r < 4; r++) {
    L.push(`    { let al = exp2(m${r} - mn${r}); l${r} = l${r} * al + sm${r}; m${r} = mn${r};`);
    for (let cI = 0; cI < DPL; cI++) L.push(`      o${r}${cI} = o${r}${cI} * al;`);
    for (let j = 0; j < 4; j++) L.push(`      pS[(tx * 4u + ${j}u) * ${BQ}u + ty * 4u + ${r}u] = f16(pe${r}[${j}]);`);
    L.push('    }');
  }
  L.push(`    for (var hk = 0u; hk < ${32 / VK}u; hk = hk + 1u) {`);
  L.push('    workgroupBarrier();');
  L.push(`    for (var t = li; t < ${VK * DV4}u; t = t + ${NT}u) { let key = hk * ${VK}u + t / ${DV4}u; let d4 = t % ${DV4}u;`);
  L.push('      kT[t] = select(vec4<f16>(0.0), Vb[(vb0 + min(k0 + key, lk) * p.vld) / 4u + d4], d4 < DR4); }');
  L.push('    workgroupBarrier();');
  L.push(`    for (var jl = 0u; jl < ${VK}u; jl = jl + 1u) { let j = hk * ${VK}u + jl;`);
  L.push(`      let pb = j * ${BQ}u + ty * 4u; let pv = vec4<f32>(f32(pS[pb]), f32(pS[pb + 1u]), f32(pS[pb + 2u]), f32(pS[pb + 3u]));`);
  L.push(`      let vb = jl * ${DV4}u + tx * ${DPL}u;`);
  for (let cI = 0; cI < DPL; cI++) L.push(`      let v${cI} = vec4<f32>(kT[vb + ${cI}u]);`);
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < DPL; cI++) L.push(`      o${r}${cI} = fma(vec4<f32>(pv[${r}]), v${cI}, o${r}${cI});`);
  L.push('    }');
  L.push('    }');
  L.push('  }');
  for (let r = 0; r < 4; r++) {
    L.push(`  { let qi = q0 + ty * 4u + ${r}u; let inv = 1.0 / l${r};`);
    L.push(`    if (qi < p.Lq) { let ob = (p.oOff + b * p.obS + h * p.ohS + qi * p.old) / 4u + tx * ${DPL}u;`);
    for (let cI = 0; cI < DPL; cI++) L.push(`      if (tx * ${DPL}u + ${cI}u < DR4) { Ob[ob + ${cI}u] = vec4<f16>(o${r}${cI} * inv); }`);
    L.push('    } }');
  }
  L.push('}');
  void TQ;
  return L.join('\n');
}

/** a = {Dr, B, H, Lq, Lk, scale, q/k/v/o: {buf, off, ld, hS, bS} (halves)}; D and BQ chosen from Dr (40 -> 64/64, 64 -> 64/64, 80 -> 96/64, 160 -> 160/32) */
/** workgroup bytes of lattnCode(D, BQ, split): qT + kT + pS + rS */
export function lattnBytes(D, BQ, split) { return 2 * D * BQ + (split ? 32 : 64) * D + 96 * BQ; }

export function lattn(gpu, a) {
  const D = a.D || (a.Dr <= 64 ? 64 : a.Dr <= 96 ? 96 : Math.ceil(a.Dr / 32) * 32), wgMax = (gpu.limits && gpu.limits.maxComputeWorkgroupStorageSize) || 16384;
  let BQ = a.BQ || (D > 96 ? 32 : 64);
  while (BQ > 16 && lattnBytes(D, BQ, false) > wgMax) BQ /= 2;   // v026.9: fewer queries per workgroup on 16 KB devices
  const split = lattnBytes(D, BQ, false) > wgMax;   // v026.9: head 160 at 16 queries is still 16.9 KB -> the split tile (11.8 KB)
  if (a.Dr % 4) throw new Error('lattn: Dr % 4');
  const pipe = gpu.pipeline(`ls.attn.${D}.${BQ}` + (split ? '.s' : ''), () => lattnCode(D, BQ, split));
  const insts = a.B * a.H, qt = Math.ceil(a.Lq / BQ);
  const fWG = 4 * BQ * Math.ceil(a.Lk / 32) * 32 * D, cap = gpu.cap('attn');
  let qPer = qt, hPer = Math.max(1, Math.floor(cap / (fWG * qt)));
  if (fWG * qt > cap) { hPer = 1; qPer = Math.max(1, Math.floor(cap / fWG)); }
  hPer = Math.min(hPer, 65535); qPer = Math.min(qPer, 65535);
  const scale = a.scale * Math.LOG2E, q = a.q, k = a.k, v = a.v, o = a.o;
  const binds = [bw(q.buf), bw(k.buf), bw(v.buf), bw(o.buf)];
  for (let h0 = 0; h0 < insts; h0 += hPer) for (let q0 = 0; q0 < qt; q0 += qPer) {
    const nh = Math.min(hPer, insts - h0), nq = Math.min(qPer, qt - q0);
    const pr = P().u32(a.Lq).u32(a.Lk).u32(a.H).f32(scale).u32(q.off || 0).u32(k.off || 0).u32(v.off || 0).u32(o.off || 0)
      .u32(q.ld).u32(k.ld).u32(v.ld).u32(o.ld).u32(q.hS).u32(k.hS).u32(v.hS).u32(o.hS).u32(q.bS).u32(k.bS).u32(v.bS).u32(o.bS)
      .u32(a.Dr).u32(q0).u32(h0).u32(0);
    gpu.runner.dispatch(pipe, binds, pr.ab, [nq, nh], (fWG * nq * nh) / gpu.rate.attn);
  }
  return 4 * a.Lq * a.Lk * a.Dr * insts;
}
