// Pocket Audio attention kernels.
//  attnD   flash attention for head_dim 64 / 80 (padded to 96): a parametrised copy of ops/attention.js BQ64 no-subgroup path
//          (scores fp32 in registers, P fp16 in a 2 KB shared tile, row max/sum through a small shared reduce; Metal-safe whole-vec4
//          shared stores).  Q/K/V are read with strides, so CLIP / Synchformer read the token-major qkv GEMM output directly:
//          element (inst = b*H + h, row r, d) at off + b*bS + h*hS + r*ld + d  (halves).  O token-major: (b*oRows + r)*ldo + h*Dr + d.
//  divattn Synchformer divided space-time attention (MotionFormer DividedAttention, q pre-scaled), one query per thread.
//  attn1   single-head attention with d = 2048 (VAE mid block), one query per workgroup.
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 16) * 16 || 16 });

export function attnDCode(D, BQ = 64) {   // v026.9: BQ 32 / 16 on 16 KB devices
  const NT = BQ * 2, Q4 = BQ / 4, DV4 = D / 4, DPL = DV4 / 8;
  if (DV4 % 8) throw new Error('attnD: D must be a multiple of 32');
  const L = [];
  L.push('enable f16;');
  L.push(`struct P { Lq: u32, Lk: u32, H: u32, scale: f32, qOff: u32, kOff: u32, vOff: u32, ld: u32, hS: u32, bS: u32, Dr: u32, ldo: u32, oRows: u32, qt0: u32, h0: u32, p0: u32 };`);
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> Qb: array<vec4<f16>>;');
  L.push('@group(0) @binding(2) var<storage, read> Kb: array<vec4<f16>>;');
  L.push('@group(0) @binding(3) var<storage, read> Vb: array<vec4<f16>>;');
  L.push('@group(0) @binding(4) var<storage, read_write> Ob: array<vec4<f16>>;');
  L.push(`var<workgroup> qT: array<vec4<f16>, ${D * Q4}>;`);      // [d][q/4]
  L.push(`var<workgroup> kT: array<vec4<f16>, ${D * 8}>;`);       // [d][key/4]  (32 keys); reused as V [key][d/4]
  L.push(`var<workgroup> pS: array<f16, ${32 * BQ}>;`);           // [key][q]
  L.push(`var<workgroup> rS: array<f32, ${BQ * 8}>;`);
  L.push(`fn ld4(base: u32, d4: u32, row: u32, lim: u32) -> u32 { return (base + min(row, lim) * p.ld) / 4u + d4; }`);
  L.push(`@compute @workgroup_size(${NT})`);
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push(`  let hi = wid.y + p.h0; let b = hi / p.H; let h = hi % p.H; let q0 = (wid.x + p.qt0) * ${BQ}u;`);
  L.push('  let ib = b * p.bS + h * p.hS; let qb = p.qOff + ib; let kb = p.kOff + ib; let vb0 = p.vOff + ib;');
  L.push('  let ty = li / 8u; let tx = li % 8u; let DR4 = p.Dr / 4u;');
  L.push(`  for (var t = li; t < ${Q4 * DV4}u; t = t + ${NT}u) { let qq4 = t / ${DV4}u; let d4 = t % ${DV4}u; let qa = q0 + qq4 * 4u; let lq = p.Lq - 1u;`);
  L.push('    var a = vec4<f16>(0.0); var bb = a; var c = a; var e = a;');
  L.push('    if (d4 < DR4) { a = Qb[ld4(qb, d4, qa, lq)]; bb = Qb[ld4(qb, d4, qa + 1u, lq)]; c = Qb[ld4(qb, d4, qa + 2u, lq)]; e = Qb[ld4(qb, d4, qa + 3u, lq)]; }');
  L.push(`    let o = d4 * 4u * ${Q4}u + qq4;`);
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`    qT[o + ${j * Q4}u] = vec4<f16>(a.${cc}, bb.${cc}, c.${cc}, e.${cc});`));
  L.push('  }');
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < DPL; cI++) L.push(`  var o${r}${cI} = vec4<f32>(0.0);`);
  for (let r = 0; r < 4; r++) L.push(`  var m${r} = -1.0e30; var l${r} = 0.0;`);
  L.push('  for (var k0 = 0u; k0 < p.Lk; k0 = k0 + 32u) {');
  L.push('    workgroupBarrier();');
  L.push(`    for (var t = li; t < ${8 * DV4}u; t = t + ${NT}u) { let kk4 = t / ${DV4}u; let d4 = t % ${DV4}u; let ka = k0 + kk4 * 4u; let lk = p.Lk - 1u;`);
  L.push('      var a = vec4<f16>(0.0); var bb = a; var c = a; var e = a;');
  L.push('      if (d4 < DR4) { a = Kb[ld4(kb, d4, ka, lk)]; bb = Kb[ld4(kb, d4, ka + 1u, lk)]; c = Kb[ld4(kb, d4, ka + 2u, lk)]; e = Kb[ld4(kb, d4, ka + 3u, lk)]; }');
  L.push('      let o = d4 * 32u + kk4;');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`      kT[o + ${j * 8}u] = vec4<f16>(a.${cc}, bb.${cc}, c.${cc}, e.${cc});`));
  L.push('    }');
  L.push('    workgroupBarrier();');
  for (let r = 0; r < 4; r++) L.push(`    var s${r} = vec4<f32>(0.0);`);
  L.push(`    for (var d = 0u; d < ${D}u; d = d + 1u) { let qv = vec4<f32>(qT[d * ${Q4}u + ty]); let kv = vec4<f32>(kT[d * 8u + tx]);`);
  for (let r = 0; r < 4; r++) L.push(`      s${r} = fma(vec4<f32>(qv[${r}]), kv, s${r});`);
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
  L.push('    workgroupBarrier();');
  // V tile [key][d/4] into kT (whole vec4 copies)
  L.push(`    for (var t = li; t < ${32 * DV4}u; t = t + ${NT}u) { let key = t / ${DV4}u; let d4 = t % ${DV4}u;`);
  L.push('      kT[t] = select(vec4<f16>(0.0), Vb[ld4(vb0, d4, k0 + key, p.Lk - 1u)], d4 < DR4); }');
  L.push('    workgroupBarrier();');
  L.push('    for (var j = 0u; j < 32u; j = j + 1u) {');
  L.push(`      let pb = j * ${BQ}u + ty * 4u; let pv = vec4<f32>(f32(pS[pb]), f32(pS[pb + 1u]), f32(pS[pb + 2u]), f32(pS[pb + 3u]));`);
  L.push(`      let vb = j * ${DV4}u + tx * ${DPL}u;`);
  for (let cI = 0; cI < DPL; cI++) L.push(`      let v${cI} = vec4<f32>(kT[vb + ${cI}u]);`);
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < DPL; cI++) L.push(`      o${r}${cI} = fma(vec4<f32>(pv[${r}]), v${cI}, o${r}${cI});`);
  L.push('    }');
  L.push('  }');
  for (let r = 0; r < 4; r++) {
    L.push(`  { let qi = q0 + ty * 4u + ${r}u; let inv = 1.0 / l${r};`);
    L.push(`    if (qi < p.Lq) { let ob = ((b * p.oRows + qi) * p.ldo + h * p.Dr) / 4u + tx * ${DPL}u;`);
    for (let cI = 0; cI < DPL; cI++) L.push(`      if (tx * ${DPL}u + ${cI}u < DR4) { Ob[ob + ${cI}u] = vec4<f16>(o${r}${cI} * inv); }`);
    L.push('    } }');
  }
  L.push('}');
  return L.join('\n');
}

/** a = {D (64|96), Dr (real head dim), q/k/v: {buf, off (halves)}, ld (halves per row), hS, bS (halves), H, B, Lq, Lk, scale,
 *       o: {buf, ld (halves), rows (oRows)} } */
export function attnD(gpu, a) {
  let BQ = 64; const wgMax = (gpu.limits && gpu.limits.maxComputeWorkgroupStorageSize) || 16384;
  while (BQ > 16 && 2 * a.D * BQ + 64 * a.D + 96 * BQ > wgMax) BQ /= 2;   // v026.9: fewer queries per workgroup on 16 KB devices
  const pipe = gpu.pipeline('a.attnD' + a.D + (BQ !== 64 ? '.q' + BQ : ''), () => attnDCode(a.D, BQ));
  const insts = a.B * a.H, qt = Math.ceil(a.Lq / BQ);
  const fWG = 4 * BQ * a.Lk * a.D, cap = gpu.cap('attn');
  let qPer = qt, hPer = Math.max(1, Math.floor(cap / (fWG * qt)));
  if (fWG * qt > cap) { hPer = 1; qPer = Math.max(1, Math.floor(cap / fWG)); }
  hPer = Math.min(hPer, 65535);
  const scale = a.scale * Math.LOG2E;
  const binds = [bw(a.q.buf), bw(a.k.buf), bw(a.v.buf), bw(a.o.buf)];
  for (let h0 = 0; h0 < insts; h0 += hPer) for (let q0 = 0; q0 < qt; q0 += qPer) {
    const nh = Math.min(hPer, insts - h0), nq = Math.min(qPer, qt - q0);
    const pr = P().u32(a.Lq).u32(a.Lk).u32(a.H).f32(scale).u32(a.q.off || 0).u32(a.k.off || 0).u32(a.v.off || 0).u32(a.ld).u32(a.hS).u32(a.bS)
      .u32(a.Dr).u32(a.o.ld).u32(a.o.rows).u32(q0).u32(h0).u32(0);
    gpu.runner.dispatch(pipe, binds, pr.ab, [nq, nh], (fWG * nq * nh) / gpu.rate.attn);
  }
  return 4 * a.Lq * a.Lk * a.Dr * insts;
}

// ------------------------------------------------------------------ Synchformer divided attention
// qkv f16 [S*1569, 2304] (q | k | v, heads 12 x 64), token j>0 = 1 + t*196 + n.  mode 0 = time ({cls} + (t', n)), 1 = space ({cls} + (t, n'))
// the cls query (token 0) attends to all 1569 keys in both modes.  q is scaled by 1/8 (DividedAttention scales q before the split).
const DIVATTN = `
enable f16;
struct P { S: u32, mode: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> QKV: array<vec4<f16>>;
@group(0) @binding(2) var<storage, read_write> O: array<vec4<f16>>;
fn keyTok(qt: u32, j: u32, mode: u32) -> u32 {
  if (qt == 0u || j == 0u) { return j; }
  let t = (qt - 1u) / 196u; let n = (qt - 1u) % 196u;
  if (mode == 0u) { return 1u + (j - 1u) * 196u + n; }
  return 1u + t * 196u + (j - 1u);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let e = gid.x + gid.y * nw.x * 64u; if (e >= p.S * 1569u * 12u) { return; }
  let h = e % 12u; let st = e / 12u; let s = st / 1569u; let qt = st % 1569u;
  let row0 = s * 1569u;
  var q: array<vec4<f32>, 16>;
  for (var i = 0u; i < 16u; i = i + 1u) { q[i] = vec4<f32>(QKV[(row0 + qt) * 576u + h * 16u + i]) * 0.125; }
  var nk = 1569u; if (qt > 0u) { nk = select(197u, 9u, p.mode == 0u); }
  var m = -1.0e30; var l = 0.0; var acc: array<vec4<f32>, 16>;
  for (var i = 0u; i < 16u; i = i + 1u) { acc[i] = vec4<f32>(0.0); }
  for (var j = 0u; j < nk; j = j + 1u) {
    let kr = (row0 + keyTok(qt, j, p.mode)) * 576u;
    var sc = 0.0;
    for (var i = 0u; i < 16u; i = i + 1u) { sc = sc + dot(q[i], vec4<f32>(QKV[kr + 192u + h * 16u + i])); }
    let mn = max(m, sc); let al = exp(m - mn); let pe = exp(sc - mn);
    l = l * al + pe; m = mn;
    for (var i = 0u; i < 16u; i = i + 1u) { acc[i] = acc[i] * al + pe * vec4<f32>(QKV[kr + 384u + h * 16u + i]); }
  }
  let inv = 1.0 / l;
  for (var i = 0u; i < 16u; i = i + 1u) { O[(row0 + qt) * 192u + h * 16u + i] = vec4<f16>(acc[i] * inv); }
}`;
export function divattn(gpu, a) {
  const pipe = gpu.pipeline('a.divattn', () => DIVATTN), n = a.S * 1569 * 12, wgs = Math.ceil(n / 64);
  gpu.runner.dispatch(pipe, [bw(a.qkv.buf), bw(a.o.buf)], P().u32(a.S).u32(a.mode).u32(0).u32(0).ab, [Math.min(wgs, 65535), Math.ceil(wgs / 65535)],
    a.S * (8 * 196 * (a.mode ? 197 : 9) + 1569) * 12 * 64 * 4 / (gpu.rate.attn * 0.25));
}

// ------------------------------------------------------------------ single head, d = C (VAE mid attention), L <= 1024
const ATTN1 = `
enable f16;
struct P { L: u32, C: u32, scale: f32, p0: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<vec4<f16>>;
@group(0) @binding(2) var<storage, read> K: array<vec4<f16>>;
@group(0) @binding(3) var<storage, read> V: array<vec4<f16>>;
@group(0) @binding(4) var<storage, read_write> O: array<vec4<f16>>;
var<workgroup> sc: array<f32, 1024>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let qi = wid.x; let C4 = p.C / 4u;
  for (var j = t; j < p.L; j = j + 256u) {
    var s = 0.0; for (var i = 0u; i < C4; i = i + 1u) { s = s + dot(vec4<f32>(Q[qi * C4 + i]), vec4<f32>(K[j * C4 + i])); }
    sc[j] = s * p.scale;
  }
  workgroupBarrier();
  var mx = -1.0e30; for (var j = t; j < p.L; j = j + 256u) { mx = max(mx, sc[j]); }
  red[t] = mx; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (t < s) { red[t] = max(red[t], red[t + s]); } workgroupBarrier(); }
  mx = red[0]; workgroupBarrier();
  var z = 0.0; for (var j = t; j < p.L; j = j + 256u) { let e = exp(sc[j] - mx); sc[j] = e; z = z + e; }
  red[t] = z; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (t < s) { red[t] = red[t] + red[t + s]; } workgroupBarrier(); }
  let inv = 1.0 / red[0];
  for (var i = t; i < C4; i = i + 256u) {
    var o = vec4<f32>(0.0); for (var j = 0u; j < p.L; j = j + 1u) { o = o + sc[j] * vec4<f32>(V[j * C4 + i]); }
    O[qi * C4 + i] = vec4<f16>(o * inv);
  }
}`;
export function attn1(gpu, a) {
  if (a.L > 1024) throw new Error('attn1: L > 1024');
  const pipe = gpu.pipeline('a.attn1', () => ATTN1);
  gpu.runner.dispatch(pipe, [bw(a.q.buf), bw(a.k.buf), bw(a.v.buf), bw(a.o.buf)], P().u32(a.L).u32(a.C).f32(a.scale).u32(0).ab, [a.L, 1], 4 * a.L * a.L * a.C / (gpu.rate.attn * 0.25));
}
