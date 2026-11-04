// lopsd.js - p0pc0rn v4 (autotune Phase 2): decode attention with more workgroups, as a TUNABLE CANDIDATE (off unless this device's
// tune turned it on: setAD). The engine's attnDec (lops.js) runs one workgroup per 64-key chunk for all 8 query heads at once, so a
// sliding layer (the last 512 keys) is 8 workgroups: on a big GPU that is latency, not bandwidth (a laptop GPU bench, Oct-31:
// ~113 us a sliding layer for 0.5 MB of K/V, 35% of an E2B token). 'attnDecH' = flash-decoding by heads: one workgroup per (key chunk,
// query head), CK keys per chunk; it writes the SAME partials (per chunk: [nh] m | [nh] l | [nh][D] acc) that lops.js's combine reads,
// so the combine is unchanged. With CK 64 every value is computed in the same order as attnDec (the same chunks, each key's dot product
// in one thread over d ascending, max / sum / P.V over k ascending), so it matches it (bit for bit where the compiler contracts alike);
// smaller chunks change only how the combine groups the keys (float rounding).
'use strict';
import { P } from '../core/gpu.js';

const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });

/** the kernel for CK keys per chunk and WG threads; params as lops.js ATTDEC (D, nh, kStart, kEnd, nchunk, ring, nkv, kvLen) */
export function attnDecHCode(CK, WG) {
  if (![16, 32, 64].includes(CK) || ![64, 128, 256].includes(WG)) throw new Error('attnDecH: CK ' + CK + ' WG ' + WG);
  return `
enable f16;
struct P { D: u32, nh: u32, kStart: u32, kEnd: u32, nchunk: u32, ring: u32, nkv: u32, kvLen: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> Q: array<f32>;       // [nh][D]
@group(0) @binding(2) var<storage, read> KC: array<vec4<f16>>; // [nkv][S][D]
@group(0) @binding(3) var<storage, read> VC: array<vec2<f16>>; // [nkv][S][D]
@group(0) @binding(4) var<storage, read_write> PT: array<f32>; // per chunk: [nh] m | [nh] l | [nh][D] acc
var<workgroup> sc: array<f32, ${CK}>;
var<workgroup> mh: array<f32, 1>;
fn krow(j: u32) -> u32 { return select(j, j % p.ring, p.ring > 0u); }
@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let c = wid.x; let hh = wid.y; let j0 = p.kStart + c * ${CK}u; let nk = min(${CK}u, p.kEnd - j0);
  let D4 = p.D / 4u; let kvh = hh / (p.nh / p.nkv); let qb = hh * p.D;
  for (var j = t; j < ${CK}u; j = j + ${WG}u) {
    var s = -3.0e38;
    if (j < nk) {
      s = 0.0; let kb = (kvh * p.kvLen + krow(j0 + j)) * D4;
      for (var d = 0u; d < D4; d = d + 1u) { let kv = vec4<f32>(KC[kb + d]); s = s + dot(kv, vec4<f32>(Q[qb + 4u * d], Q[qb + 4u * d + 1u], Q[qb + 4u * d + 2u], Q[qb + 4u * d + 3u])); }
    }
    sc[j] = s;
  }
  workgroupBarrier();
  if (t == 0u) { var m = -3.0e38; for (var k = 0u; k < nk; k = k + 1u) { m = max(m, sc[k]); } mh[0] = m; }
  workgroupBarrier();
  let m = mh[0];
  for (var i = t; i < ${CK}u; i = i + ${WG}u) { sc[i] = select(0.0, exp(sc[i] - m), i < nk); }
  workgroupBarrier();
  let pb = c * (p.nh * (2u + p.D));
  if (t == 0u) { var l = 0.0; for (var k = 0u; k < nk; k = k + 1u) { l = l + sc[k]; } PT[pb + hh] = m; PT[pb + p.nh + hh] = l; }
  let D2 = p.D / 2u;
  for (var dp = t; dp < D2; dp = dp + ${WG}u) {
    var acc = vec2<f32>(0.0);
    for (var k = 0u; k < nk; k = k + 1u) { let v = vec2<f32>(VC[(kvh * p.kvLen + krow(j0 + k)) * D2 + dp]); acc = acc + sc[k] * v; }
    let o = pb + 2u * p.nh + hh * p.D + 2u * dp; PT[o] = acc.x; PT[o + 1u] = acc.y;
  }
}`;
}

/** the candidates the tuner times (name -> {CK, WG}); 'h64' computes in attnDec's order */
export const AD_CANDS = { h64: { CK: 64, WG: 256 }, h64n: { CK: 64, WG: 128 }, h32: { CK: 32, WG: 128 }, h16: { CK: 16, WG: 64 } };
/** this device's choice (null = the engine's attnDec, as shipped) */
const AD = { cfg: null };
export function setAD(cfg) { AD.cfg = cfg && AD_CANDS[cfg.name] ? Object.assign({ name: cfg.name }, AD_CANDS[cfg.name]) : null; }
export function adNow() { return AD.cfg ? { name: AD.cfg.name } : null; }
/** the smallest key chunk any decode attention here may use (the partials scratch is sized for it: gemma4.js scratch) */
export function adMinCK() { return AD.cfg ? Math.min(64, AD.cfg.CK) : 64; }
/** the per-head options for this call, or null (the engine's attnDec). A context too long for one combine at CK keys (> 256 chunks)
 *  goes up to 64-key chunks, then to the engine's kernel (which has the same limit) */
export function adPick(a, cfg = AD.cfg) {
  if (!cfg) return null;
  const keys = a.kEnd - a.kStart;
  if (Math.ceil(keys / cfg.CK) <= 256) return cfg;
  if (cfg.CK < 64 && Math.ceil(keys / 64) <= 256) return { name: cfg.name + '>64', CK: 64, WG: cfg.WG };
  return null;
}
/** dispatch the per-head kernel (partials only; the caller runs lops.js's combine over the returned chunk count) -> nchunk */
export function attnDecH(g, a, o) {
  const nchunk = Math.ceil((a.kEnd - a.kStart) / o.CK);
  const pipe = g.pipeline(`lattdecH.${o.CK}.${o.WG}`, () => attnDecHCode(o.CK, o.WG));
  g.runner.dispatch(pipe, [bw(a.q.buf), bw(a.kc.buf), bw(a.vc.buf), bw(a.part.buf)],
    P().u32(a.D).u32(a.nh).u32(a.kStart).u32(a.kEnd).u32(nchunk).u32(a.ring || 0).u32(a.nkv || 1).u32(a.kvLen || 0).ab, [nchunk, a.nh], 3e-5 * nchunk);
  return nchunk;
}
