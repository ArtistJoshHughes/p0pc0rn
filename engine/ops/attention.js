// Flash attention, head_dim 128, fp16 tiles in workgroup memory, fp32 scores / online-softmax statistics / accumulators.
// The L x L score matrix never leaves the workgroup.  Q [Hq][Lq][128] f16, K/V [Hkv][Lk][128] f16 (head-major, as written by
// the GEMM 'heads' epilogue), O [Lq][ldo] f16 token-major at column h*128 (the input layout of the projection GEMM).
// mask: 0 = none (FLUX DiT), 1 = causal + valid length (Qwen TE: key j visible to query i iff j <= min(i, nvalid-1)),
//       2 = valid length only (cross-attention to padded text keys).
// GQA: query head h reads kv head h / (Hq/Hkv).
// Variants: {BQ:32} (row-owner softmax, portable); {BQ:64} (scores stay in registers, row max/sum via a 2 KB shared reduce,
// P stored fp16; no subgroups needed - Safari has none); {sg:true} uses subgroupShuffleXor for the row reduce instead;
// pv16 = fp16 P*V partial sums per 32-key tile; s16 = fp16 QK partials per 32-dim chunk (scores/softmax stats stay fp32).
// RULE: never store a single component of a shared vec4 (Metal read-modify-writes the vector and races); transpose in registers.
'use strict';
import { P } from '../core/gpu.js';

export function attnCode(c) {
  const BQ = c.BQ, NT = (BQ / 4) * 8, Q4 = BQ / 4, sg = !!c.sg;
  const kvShared = BQ === 64 || !!c.kvs;   // v026.9: kvs = V reuses the K tile (the 16 KB variant)
  const reg = sg || BQ === 64;   // BQ64 keeps scores in registers (P stored f16): subgroup shuffles, or a small shared reduce
  const pT = BQ === 64 ? 'f16' : 'f32';
  const L = [];
  L.push('enable f16;'); if (sg) L.push('enable subgroups;');
  L.push('struct P { Lq: u32, Lk: u32, ldo: u32, Hq: u32, Hkv: u32, scale: f32, mode: u32, nvalid: u32, qt0: u32, h0: u32, p0: u32, p1: u32 };');
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> Qb: array<vec4<f16>>;');
  L.push('@group(0) @binding(2) var<storage, read> Kb: array<vec4<f16>>;');
  L.push('@group(0) @binding(3) var<storage, read> Vb: array<vec4<f16>>;');
  L.push('@group(0) @binding(4) var<storage, read_write> Ob: array<vec4<f16>>;');
  L.push(`var<workgroup> qT: array<vec4<f16>, ${128 * Q4}>;`);          // [d][q/4]
  L.push(`var<workgroup> kT: array<vec4<f16>, 1024>;`);                   // [d][key/4]  (32 keys)
  if (!kvShared) L.push(`var<workgroup> vS: array<vec4<f16>, 1024>;`);    // [key][d/4]
  L.push(`var<workgroup> pS: array<${pT}, ${32 * BQ}>;`);                  // [key][q]
  if (!reg) L.push(`var<workgroup> mS: array<f32, ${BQ}>; var<workgroup> lS: array<f32, ${BQ}>; var<workgroup> aS: array<f32, ${BQ}>;`);
  if (reg && !sg) L.push(`var<workgroup> rS: array<f32, ${BQ * 8}>;`);
  const VS = kvShared ? 'kT' : 'vS';
  L.push(`@compute @workgroup_size(${NT})`);
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push(`  let h = wid.y + p.h0; let hk = h / (p.Hq / p.Hkv); let q0 = (wid.x + p.qt0) * ${BQ}u;`);
  L.push('  let qb = h * p.Lq * 32u; let kb = hk * p.Lk * 32u;');
  L.push('  let ty = li / 8u; let tx = li % 8u;');
  // Q tile, transposed through registers (4 queries x 4 dims per task) with WHOLE vec4 stores: a single-component store
  // into a shared vec4 is a read-modify-write of the vector on Metal and races with the neighbouring lanes.
  L.push(`  for (var t = li; t < ${BQ * 8}u; t = t + ${NT}u) { let qq4 = t / 32u; let d4 = t % 32u; let qa = q0 + qq4 * 4u; let lq = p.Lq - 1u;`);
  L.push('    let a = Qb[qb + min(qa, lq) * 32u + d4]; let b = Qb[qb + min(qa + 1u, lq) * 32u + d4]; let c = Qb[qb + min(qa + 2u, lq) * 32u + d4]; let e = Qb[qb + min(qa + 3u, lq) * 32u + d4];');
  L.push(`    let o = d4 * 4u * ${Q4}u + qq4;`);
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`    qT[o + ${j * Q4}u] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('  }');
  L.push(`  var kEnd = p.Lk; if (p.mode == 1u) { kEnd = min(p.Lk, min(q0 + ${BQ - 1}u, p.nvalid - 1u) + 1u); } if (p.mode == 2u) { kEnd = min(p.Lk, p.nvalid); }`);
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`  var o${r}${cI} = vec4<f32>(0.0);`);
  if (reg) for (let r = 0; r < 4; r++) L.push(`  var m${r} = -1.0e30; var l${r} = 0.0;`);
  else L.push(`  if (li < ${BQ}u) { mS[li] = -1.0e30; lS[li] = 0.0; }`);
  L.push('  for (var k0 = 0u; k0 < kEnd; k0 = k0 + 32u) {');
  L.push('    workgroupBarrier();');
  L.push(`    for (var t = li; t < 256u; t = t + ${NT}u) { let kk4 = t / 32u; let d4 = t % 32u; let ka = k0 + kk4 * 4u; let lk = p.Lk - 1u;`);
  L.push('      let a = Kb[kb + min(ka, lk) * 32u + d4]; let b = Kb[kb + min(ka + 1u, lk) * 32u + d4]; let c = Kb[kb + min(ka + 2u, lk) * 32u + d4]; let e = Kb[kb + min(ka + 3u, lk) * 32u + d4];');
  L.push('      let o = d4 * 32u + kk4;');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`      kT[o + ${j * 8}u] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('    }');
  if (!kvShared) L.push(`    for (var t = li; t < 1024u; t = t + ${NT}u) { vS[t] = Vb[kb + min(k0 + t / 32u, p.Lk - 1u) * 32u + t % 32u]; }`);
  L.push('    workgroupBarrier();');
  // scores for rows ty*4..+3, keys tx*4..+3
  for (let r = 0; r < 4; r++) L.push(`    var s${r} = vec4<f32>(0.0);`);
  if (c.s16) {   // fp16 partial dot products over 32-dim chunks, flushed to fp32 (scores and softmax stats stay fp32)
    L.push('    for (var dc = 0u; dc < 128u; dc = dc + 32u) {');
    for (let r = 0; r < 4; r++) L.push(`      var h${r} = vec4<f16>(0.0);`);
    L.push(`      for (var d = dc; d < dc + 32u; d = d + 1u) { let qv = qT[d * ${Q4}u + ty]; let kv = kT[d * 8u + tx];`);
    for (let r = 0; r < 4; r++) L.push(`        h${r} = fma(vec4<f16>(qv[${r}]), kv, h${r});`);
    L.push('      }');
    for (let r = 0; r < 4; r++) L.push(`      s${r} = s${r} + vec4<f32>(h${r});`);
    L.push('    }');
  } else {
  L.push(`    for (var d = 0u; d < 128u; d = d + 1u) { let qv = vec4<f32>(qT[d * ${Q4}u + ty]); let kv = vec4<f32>(kT[d * 8u + tx]);`);
  for (let r = 0; r < 4; r++) L.push(`      s${r} = fma(vec4<f32>(qv[${r}]), kv, s${r});`);
  L.push('    }');
  }
  L.push('    let kj = k0 + tx * 4u + vec4<u32>(0u, 1u, 2u, 3u);');
  for (let r = 0; r < 4; r++) {
    L.push(`    { let qi = q0 + ty * 4u + ${r}u; var ok = kj < vec4<u32>(p.Lk);`);
    L.push(`      if (p.mode == 1u) { ok = ok & (kj <= vec4<u32>(min(qi, p.nvalid - 1u))); } if (p.mode == 2u) { ok = ok & (kj < vec4<u32>(p.nvalid)); }`);
    L.push(`      s${r} = select(vec4<f32>(-1.0e30), s${r} * p.scale, ok); }`);
  }
  if (reg) {   // m, l in registers; row max / sum over the 8 lanes of a row block via subgroup shuffles, or a 2 KB shared array
    const red = (v, op) => sg
      ? [1, 2, 4].map((k) => `${v} = ${op}(${v}, subgroupShuffleXor(${v}, ${k}u));`).join(' ')
      : null;
    for (let r = 0; r < 4; r++) L.push(`    var mx${r} = max(max(s${r}.x, s${r}.y), max(s${r}.z, s${r}.w));`);
    if (sg) for (let r = 0; r < 4; r++) L.push('    ' + red(`mx${r}`, 'max'));
    else {
      for (let r = 0; r < 4; r++) L.push(`    rS[(ty * 4u + ${r}u) * 8u + tx] = mx${r};`);
      L.push('    workgroupBarrier();');
      for (let r = 0; r < 4; r++) L.push(`    for (var i = 0u; i < 8u; i = i + 1u) { mx${r} = max(mx${r}, rS[(ty * 4u + ${r}u) * 8u + i]); }`);
      L.push('    workgroupBarrier();');
    }
    for (let r = 0; r < 4; r++) {
      L.push(`    let mn${r} = max(m${r}, mx${r}); let pe${r} = select(exp2(s${r} - vec4<f32>(mn${r})), vec4<f32>(0.0), s${r} <= vec4<f32>(-1.0e29));`);
      L.push(`    var sm${r} = pe${r}.x + pe${r}.y + pe${r}.z + pe${r}.w;`);
    }
    if (sg) for (let r = 0; r < 4; r++) L.push(`    sm${r} = sm${r} + subgroupShuffleXor(sm${r}, 1u); sm${r} = sm${r} + subgroupShuffleXor(sm${r}, 2u); sm${r} = sm${r} + subgroupShuffleXor(sm${r}, 4u);`);
    else {
      for (let r = 0; r < 4; r++) L.push(`    rS[(ty * 4u + ${r}u) * 8u + tx] = sm${r};`);
      L.push('    workgroupBarrier();');
      for (let r = 0; r < 4; r++) L.push(`    sm${r} = 0.0; for (var i = 0u; i < 8u; i = i + 1u) { sm${r} = sm${r} + rS[(ty * 4u + ${r}u) * 8u + i]; }`);
    }
    for (let r = 0; r < 4; r++) {
      L.push(`    { let al = exp2(m${r} - mn${r}); l${r} = l${r} * al + sm${r}; m${r} = mn${r};`);
      for (let cI = 0; cI < 4; cI++) L.push(`      o${r}${cI} = o${r}${cI} * al;`);
      for (let j = 0; j < 4; j++) L.push(`      pS[(tx * 4u + ${j}u) * ${BQ}u + ty * 4u + ${r}u] = ${pT}(pe${r}[${j}]);`);
      L.push('    }');
    }
    if (kvShared) {
      L.push('    workgroupBarrier();');
      L.push(`    for (var t = li; t < 1024u; t = t + ${NT}u) { kT[t] = Vb[kb + min(k0 + t / 32u, p.Lk - 1u) * 32u + t % 32u]; }`);
    }
    L.push('    workgroupBarrier();');
  } else {
    for (let r = 0; r < 4; r++) for (let j = 0; j < 4; j++) L.push(`    pS[(tx * 4u + ${j}u) * ${BQ}u + ty * 4u + ${r}u] = s${r}[${j}];`);
    L.push('    workgroupBarrier();');
    L.push(`    if (li < ${BQ}u) { let mo = mS[li]; var mx = mo;`);
    L.push(`      for (var j = 0u; j < 32u; j = j + 1u) { mx = max(mx, pS[j * ${BQ}u + li]); }`);
    L.push('      var sm = 0.0;');
    L.push(`      for (var j = 0u; j < 32u; j = j + 1u) { let s = pS[j * ${BQ}u + li]; let e = select(exp2(s - mx), 0.0, s <= -1.0e29); pS[j * ${BQ}u + li] = e; sm = sm + e; }`);
    L.push('      let al = exp2(mo - mx); aS[li] = al; lS[li] = lS[li] * al + sm; mS[li] = mx; }');
    L.push('    workgroupBarrier();');
    for (let r = 0; r < 4; r++) { L.push(`    { let al = aS[ty * 4u + ${r}u];`); for (let cI = 0; cI < 4; cI++) L.push(`      o${r}${cI} = o${r}${cI} * al;`); L.push('    }'); }
    if (kvShared) {   // v026.9: every lane finished reading K (the scores) before the first barrier: V goes into the same tile
      L.push(`    for (var t = li; t < 1024u; t = t + ${NT}u) { kT[t] = Vb[kb + min(k0 + t / 32u, p.Lk - 1u) * 32u + t % 32u]; }`);
      L.push('    workgroupBarrier();');
    }
  }
  // O += P V   (rows ty*4..+3, dims tx*16..+15)
  if (c.pv16) {   // fp16 partial sums over one 32-key tile (P in [0,1]), flushed into the fp32 accumulators per tile
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`    var h${r}${cI} = vec4<f16>(0.0);`);
    L.push('    for (var j = 0u; j < 32u; j = j + 1u) {');
    L.push(`      let pb = j * ${BQ}u + ty * 4u; let pv = vec4<f16>(f16(pS[pb]), f16(pS[pb + 1u]), f16(pS[pb + 2u]), f16(pS[pb + 3u]));`);
    L.push(`      let vb = j * 32u + tx * 4u;`);
    for (let cI = 0; cI < 4; cI++) L.push(`      let v${cI} = ${VS}[vb + ${cI}u];`);
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`      h${r}${cI} = fma(vec4<f16>(pv[${r}]), v${cI}, h${r}${cI});`);
    L.push('    }');
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`    o${r}${cI} = o${r}${cI} + vec4<f32>(h${r}${cI});`);
  } else {
  L.push('    for (var j = 0u; j < 32u; j = j + 1u) {');
  L.push(`      let pb = j * ${BQ}u + ty * 4u; let pv = vec4<f32>(f32(pS[pb]), f32(pS[pb + 1u]), f32(pS[pb + 2u]), f32(pS[pb + 3u]));`);
  L.push(`      let vb = j * 32u + tx * 4u;`);
  for (let cI = 0; cI < 4; cI++) L.push(`      let v${cI} = vec4<f32>(${VS}[vb + ${cI}u]);`);
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`      o${r}${cI} = fma(vec4<f32>(pv[${r}]), v${cI}, o${r}${cI});`);
  L.push('    }');
  }
  L.push('  }');
  if (!reg) L.push('  workgroupBarrier();');
  for (let r = 0; r < 4; r++) {
    L.push(`  { let qi = q0 + ty * 4u + ${r}u; let inv = 1.0 / ${reg ? `l${r}` : `lS[ty * 4u + ${r}u]`};`);
    L.push(`    if (qi < p.Lq) { let ob = (qi * p.ldo + h * 128u) / 4u + tx * 4u;`);
    for (let cI = 0; cI < 4; cI++) L.push(`      Ob[ob + ${cI}u] = vec4<f16>(o${r}${cI} * inv);`);
    L.push('    } }');
  }
  L.push('}');
  return L.join('\n');
}

/** a = {q:{buf,off}, k:{buf,off}, v:{buf,off}, o:{buf,off,ld}, Lq, Lk, Hq, Hkv, mode=0, nvalid, cfg:{BQ, sg}} */
/** v026.9: the workgroup memory (bytes) a variant declares */
export function attnBytes(c) {
  const BQ = c.BQ, kvs = BQ === 64 || !!c.kvs, reg = !!c.sg || BQ === 64;
  return 128 * (BQ / 4) * 8 + 1024 * 8 + (kvs ? 0 : 1024 * 8) + 32 * BQ * (BQ === 64 ? 2 : 4) + (reg ? 0 : 3 * BQ * 4) + (reg && !c.sg ? BQ * 8 * 4 : 0);
}
export function attention(gpu, a) {
  let cfg = a.cfg || gpu.tune?.attn || { BQ: gpu.subgroups && gpu.sgMin >= 8 ? 64 : 32, sg: gpu.subgroups && gpu.sgMin >= 8 };
  const wgMax = (gpu.limits && gpu.limits.maxComputeWorkgroupStorageSize) || 16384;
  if (attnBytes(cfg) > wgMax) cfg = { BQ: 16, kvs: true };   // v026.9: Android-like 16 KB of workgroup memory (14.2 KB)
  const key = `attn.${cfg.BQ}.${cfg.sg ? 'sg' : ''}.${cfg.pv16 ? 'pv16' : ''}.${cfg.s16 ? 's16' : ''}${cfg.kvs ? '.kvs' : ''}`;
  const pipe = gpu.pipeline(key, () => attnCode(cfg));
  const Hq = a.Hq, Hkv = a.Hkv || a.Hq, Lq = a.Lq, Lk = a.Lk || a.Lq, ldo = a.o.ld || Hq * 128;
  const qt = Math.ceil(Lq / cfg.BQ);
  const fWG = 4 * cfg.BQ * Lk * 128, cap = gpu.cap('attn');
  let qPer = qt, hPer = Math.max(1, Math.floor(cap / (fWG * qt)));
  if (fWG * qt > cap) { hPer = 1; qPer = Math.max(1, Math.floor(cap / fWG)); }
  const scale = (a.scale != null ? a.scale : 1 / Math.sqrt(128)) * Math.LOG2E;
  const vw = (t, n) => ({ buffer: t.buf, offset: t.off || 0, size: t.size || n });
  const qs = Hq * Lq * 256, ks = Hkv * Lk * 256;
  const binds = [vw(a.q, qs), vw(a.k, ks), vw(a.v, ks), { buffer: a.o.buf, offset: a.o.off || 0, size: a.o.size || Math.ceil(Lq * ldo * 2 / 16) * 16 }];
  for (let h0 = 0; h0 < Hq; h0 += hPer) {
    for (let q0 = 0; q0 < qt; q0 += qPer) {
      const nh = Math.min(hPer, Hq - h0), nq = Math.min(qPer, qt - q0);
      const pr = P().u32(Lq).u32(Lk).u32(ldo).u32(Hq).u32(Hkv).f32(scale).u32(a.mode || 0).u32(a.nvalid || Lk).u32(q0).u32(h0).u32(0).u32(0);
      gpu.runner.dispatch(pipe, binds, pr.ab, [nq, nh], (fWG * nq * nh) / gpu.rate.attn);
    }
  }
  return 4 * Lq * Lk * 128 * Hq;
}
