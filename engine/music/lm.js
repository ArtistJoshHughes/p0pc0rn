// ACE-Step 5 Hz LM 0.6B ("lyrics planner") on WebGPU, music-0.2.  Spec: ACESTEP15_TURBO_SPEC.md section 14.
// The official codes phase (llm_inference._generate_with_cfg_custom with the constrained decoder): two sequences (cond = caption +
// lyrics + metas CoT, uncond = "NO USER INPUT"), CFG 2 on the 64,000 audio codes + EOS only, EOS blocked until 5 codes per second
// were sampled and then forced, top-p 0.9 on the CFG logits, temperature 0.85, multinomial.  The codes -> FSQ (6-D, levels
// 8,8,8,5,5,5) -> project_out -> detokenizer (2 layers over 5 patches per code) -> 25 Hz "LM hints" [T][64] that replace the
// silence latent in the DiT context.
// GPU plan: all 28 LM layers RESIDENT (decode reads every weight once per token), K/V caches per layer and sequence, prefill with the
// tiled GEMM, decode with a q8 GEMV (8 rows per workgroup, both sequences per weight read), sampling in JS on the 64,001 CFG logits.
'use strict';
import { gemm } from '../ops/gemm.js';
import { rowstats } from '../ops/misc.js';
import { ropeTE } from '../models/klein_blocks.js';
import { P, toF16 } from '../core/gpu.js';
import { mattention } from './mattn.js';

export const CODE0 = 151669, NCODES = 64000, LM_EOS = 151645, HEAD_ROWS = 64064, LM_INSTRUCTION = 'Generate audio semantic tokens based on the given conditions:';
const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 16) * 16 || 16 });
const tt = (sh, n) => { try { return sh.t(sh.name + '/' + n); } catch (e) { return sh.t(n); } };
const pad2 = (i) => String(i).padStart(2, '0');

/** the official codes-phase prompts (build_formatted_prompt_with_cot + the Qwen chat template), metas as the sorted-key YAML CoT */
export function lmPrompts({ tags, lyrics, bpm, keyscale, timesignature, seconds }) {
  const items = { bpm, duration: Math.trunc(seconds), keyscale, timesignature };
  const yaml = Object.keys(items).sort().filter((k) => items[k] != null && String(items[k]).trim() !== '').map((k) => {
    let v = String(items[k]).trim(); if (k === 'timesignature' && v.endsWith('/4')) v = v.split('/')[0];
    return `${k}: ${v}`; }).join('\n');
  const sys = `<|im_start|>system\n# Instruction\n${LM_INSTRUCTION}\n\n<|im_end|>\n`;
  const cond = `${sys}<|im_start|>user\n# Caption\n${tags}\n\n# Lyric\n${lyrics}\n<|im_end|>\n<|im_start|>assistant\n<think>\n${yaml}\n</think>\n\n`;
  const uncond = `${sys}<|im_start|>user\nNO USER INPUT<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  return { cond, uncond };
}

// ------------------------------------------------------------------ q8 GEMV: Y[m][n] (= or +=) sum_k X'[m][k] W[wr0 + n][k], M <= 2, 8 rows per workgroup
// X' modes: 'f32' | 'f16' plain; 'rms' = RMSNorm(X) * w with the row statistics computed in the workgroup (no rowstats pass);
// 'swiglu' = silu(X[m][k]) * X[m][K + k] (the gate|up GEMV output feeds the down projection directly).
// Weight q8g64s.t64 records (FORMAT.md): codes [64 rows][64] int8, then 64 f16 scales.
const GEMV = (mode, add, KMAX, wf16, RPW, xh = false) => `   // v026.9: xh = x kept as fp16 in workgroup memory (16 KB devices)
enable f16;
struct P { M: u32, N: u32, K: u32, ldx: u32, wG: u32, nwOff: u32, eps: f32, ldy: u32, wr0: u32, yOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<${mode === 'f16' ? 'vec4<f16>' : 'vec4<f32>'}>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
${mode === 'rms' ? '@group(0) @binding(4) var<storage, read> NW: array<vec4<f32>>;' : ''}
var<workgroup> xs: array<${xh ? 'vec4<f16>' : 'vec4<f32>'}, ${2 * KMAX / 4}>;
var<workgroup> red: array<f32, 512>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let K4 = p.K / 4u;
  var q0 = 0.0; var q1 = 0.0;
  for (var i = li; i < p.M * K4; i = i + 256u) {
    let m = i / K4; let k4 = i % K4;
    ${mode === 'swiglu' ? 'let gg = X[(m * p.ldx) / 4u + k4]; let uu = X[(m * p.ldx) / 4u + K4 + k4]; let v = gg / (vec4<f32>(1.0) + exp(-gg)) * uu;'
                         : 'let v = vec4<f32>(X[(m * p.ldx) / 4u + k4]);'}
    xs[i] = ${xh ? 'vec4<f16>(v)' : 'v'};
    ${mode === 'rms' ? 'if (m == 0u) { q0 = q0 + dot(v, v); } else { q1 = q1 + dot(v, v); }' : ''}
  }
  ${mode === 'rms' ? `red[li] = q0; red[256u + li] = q1; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (li < s) { red[li] = red[li] + red[li + s]; red[256u + li] = red[256u + li] + red[256u + li + s]; } workgroupBarrier(); }
  let r0 = inverseSqrt(red[0] / f32(p.K) + p.eps); let r1 = inverseSqrt(red[256] / f32(p.K) + p.eps);
  workgroupBarrier();
  for (var i = li; i < p.M * K4; i = i + 256u) { let m = i / K4; xs[i] = ${xh ? 'vec4<f16>(' : '('}vec4<f32>(xs[i]) * select(r0, r1, m == 1u) * NW[p.nwOff / 4u + i % K4]); }` : ''}
  workgroupBarrier();
  let lane = li & 31u;
  // ${RPW} x 8 rows per workgroup (8 warps of 32 lanes, one row each per pass): the x prologue is paid once per ${RPW * 8} rows
  for (var jr = 0u; jr < ${RPW}u; jr = jr + 1u) {
  let n = (wid.x * ${RPW}u + jr) * 8u + (li >> 5u);
  var a0 = 0.0; var a1 = 0.0;
  if (n < p.N) {
    let r = p.wr0 + n;
    ${wf16 ? `for (var k4 = lane; k4 < K4; k4 = k4 + 32u) {
      let base = r * (p.wG * 32u) + k4 * 2u; let lo = unpack2x16float(W[base]); let hi = unpack2x16float(W[base + 1u]);
      let cv = vec4<f32>(lo.x, lo.y, hi.x, hi.y);
      a0 = a0 + dot(cv, vec4<f32>(xs[k4]));
      if (p.M > 1u) { a1 = a1 + dot(cv, vec4<f32>(xs[K4 + k4])); }
    }` : `let tile = r >> 6u; let rr = r & 63u;
    for (var g = lane >> 4u; g < p.wG; g = g + 2u) {
      let rec = (tile * p.wG + g) * 1056u;
      let q = W[rec + rr * 16u + (lane & 15u)];
      let s2 = unpack2x16float(W[rec + 1024u + (rr >> 1u)]); let sc = select(s2.x, s2.y, (rr & 1u) == 1u);
      let cv = vec4<f32>((vec4<i32>(vec4<u32>(q) << vec4<u32>(24u, 16u, 8u, 0u))) >> vec4<u32>(24u)) * sc;
      let k4 = g * 16u + (lane & 15u);
      a0 = a0 + dot(cv, vec4<f32>(xs[k4]));
      if (p.M > 1u) { a1 = a1 + dot(cv, vec4<f32>(xs[K4 + k4])); }
    }`}
  }
  red[li] = a0; red[256u + li] = a1;
  workgroupBarrier();
  if (lane == 0u && n < p.N) {
    var s0 = 0.0; var s1 = 0.0;
    for (var j = 0u; j < 32u; j = j + 1u) { s0 = s0 + red[li + j]; s1 = s1 + red[256u + li + j]; }
    ${add ? 'Y[p.yOff + n] = Y[p.yOff + n] + s0; if (p.M > 1u) { Y[p.yOff + p.ldy + n] = Y[p.yOff + p.ldy + n] + s1; }'
          : 'Y[p.yOff + n] = s0; if (p.M > 1u) { Y[p.yOff + p.ldy + n] = s1; }'}
  }
  workgroupBarrier();
  }
}`;
// v026.9: the same GEMV with x cached ONE K CHUNK at a time (KC elements, fp32): for devices whose workgroup memory cannot hold the
// whole x (16 KB). Bit-identical to GEMV: each lane walks the same k sequence in the same order; rows accumulate in registers.
const GEMVC = (mode, add, KC, wf16, RPW) => `
enable f16;
struct P { M: u32, N: u32, K: u32, ldx: u32, wG: u32, nwOff: u32, eps: f32, ldy: u32, wr0: u32, yOff: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<${mode === 'f16' ? 'vec4<f16>' : 'vec4<f32>'}>;
@group(0) @binding(2) var<storage, read> W: array<u32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
${mode === 'rms' ? '@group(0) @binding(4) var<storage, read> NW: array<vec4<f32>>;' : ''}
var<workgroup> xs: array<vec4<f32>, ${2 * KC / 4}>;
var<workgroup> red: array<f32, 512>;
fn xv(m: u32, k4: u32) -> vec4<f32> {
  ${mode === 'swiglu' ? 'let K4 = p.K / 4u; let gg = X[(m * p.ldx) / 4u + k4]; let uu = X[(m * p.ldx) / 4u + K4 + k4]; return gg / (vec4<f32>(1.0) + exp(-gg)) * uu;'
                       : 'return vec4<f32>(X[(m * p.ldx) / 4u + k4]);'}
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let K4 = p.K / 4u; let KC4 = ${KC / 4}u;
  ${mode === 'rms' ? `var q0 = 0.0; var q1 = 0.0;
  for (var i = li; i < p.M * K4; i = i + 256u) { let m = i / K4; let k4 = i % K4; let v = xv(m, k4); if (m == 0u) { q0 = q0 + dot(v, v); } else { q1 = q1 + dot(v, v); } }
  red[li] = q0; red[256u + li] = q1; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (li < s) { red[li] = red[li] + red[li + s]; red[256u + li] = red[256u + li] + red[256u + li + s]; } workgroupBarrier(); }
  let r0 = inverseSqrt(red[0] / f32(p.K) + p.eps); let r1 = inverseSqrt(red[256] / f32(p.K) + p.eps);` : ''}
  let lane = li & 31u;
  var A0: array<f32, ${RPW}>; var A1: array<f32, ${RPW}>;
  for (var j = 0u; j < ${RPW}u; j = j + 1u) { A0[j] = 0.0; A1[j] = 0.0; }
  for (var c4 = 0u; c4 < K4; c4 = c4 + KC4) {
    let n4 = min(KC4, K4 - c4);
    workgroupBarrier();
    for (var i = li; i < p.M * n4; i = i + 256u) {
      let m = i / n4; let k4 = c4 + i % n4; var v = xv(m, k4);
      ${mode === 'rms' ? 'v = v * select(r0, r1, m == 1u) * NW[p.nwOff / 4u + k4];' : ''}
      xs[m * KC4 + (k4 - c4)] = v;
    }
    workgroupBarrier();
    for (var jr = 0u; jr < ${RPW}u; jr = jr + 1u) {
      let n = (wid.x * ${RPW}u + jr) * 8u + (li >> 5u);
      if (n < p.N) {
        let r = p.wr0 + n; var a0 = A0[jr]; var a1 = A1[jr];
        ${wf16 ? `for (var k4 = c4 + lane; k4 < c4 + n4; k4 = k4 + 32u) {
          let base = r * (p.wG * 32u) + k4 * 2u; let lo = unpack2x16float(W[base]); let hi = unpack2x16float(W[base + 1u]);
          let cv = vec4<f32>(lo.x, lo.y, hi.x, hi.y);
          a0 = a0 + dot(cv, xs[k4 - c4]);
          if (p.M > 1u) { a1 = a1 + dot(cv, xs[KC4 + k4 - c4]); }
        }` : `let tile = r >> 6u; let rr = r & 63u; let gs = c4 / 16u;
        for (var g = gs + (lane >> 4u); g < gs + n4 / 16u; g = g + 2u) {
          let rec = (tile * p.wG + g) * 1056u;
          let q = W[rec + rr * 16u + (lane & 15u)];
          let s2 = unpack2x16float(W[rec + 1024u + (rr >> 1u)]); let sc = select(s2.x, s2.y, (rr & 1u) == 1u);
          let cv = vec4<f32>((vec4<i32>(vec4<u32>(q) << vec4<u32>(24u, 16u, 8u, 0u))) >> vec4<u32>(24u)) * sc;
          let k4 = g * 16u + (lane & 15u);
          a0 = a0 + dot(cv, xs[k4 - c4]);
          if (p.M > 1u) { a1 = a1 + dot(cv, xs[KC4 + k4 - c4]); }
        }`}
        A0[jr] = a0; A1[jr] = a1;
      }
    }
  }
  for (var jr = 0u; jr < ${RPW}u; jr = jr + 1u) {
    let n = (wid.x * ${RPW}u + jr) * 8u + (li >> 5u);
    red[li] = A0[jr]; red[256u + li] = A1[jr];
    workgroupBarrier();
    if (lane == 0u && n < p.N) {
      var s0 = 0.0; var s1 = 0.0;
      for (var j = 0u; j < 32u; j = j + 1u) { s0 = s0 + red[li + j]; s1 = s1 + red[256u + li + j]; }
      ${add ? 'Y[p.yOff + n] = Y[p.yOff + n] + s0; if (p.M > 1u) { Y[p.yOff + p.ldy + n] = Y[p.yOff + p.ldy + n] + s1; }'
            : 'Y[p.yOff + n] = s0; if (p.M > 1u) { Y[p.yOff + p.ldy + n] = s1; }'}
    }
    workgroupBarrier();
  }
}`;
/** a = {w (q8 tensor), x:{buf, ld, mode: 'f32'|'f16'|'rms'|'swiglu'}, M, N, K, y:{buf, ld, off(floats)}, add, nw:{buf, off(floats)} (rms), wr0} */
export function gemv(g, a) {
  const wf16 = a.w.enc === 'f16';
  if (!wf16 && a.w.enc !== 'q8g64s.t64') throw new Error('gemv: q8 or f16 weights, got ' + a.w.enc);
  if (a.K > 3072 || a.K % 64 || a.M > 2) throw new Error('gemv: K <= 3072 (multiple of 64), M <= 2');
  // shared x sized to THIS K (a fixed 3072 slot = 26 KB of workgroup memory capped the occupancy of the K = 1024 / 2048 GEMVs)
  // rows per warp: enough workgroups to fill the GPU (>= ~128) while amortising the x prologue (g.tune.gemvRpw forces a value; 1 = the old kernel)
  const rpwT = g.tune && g.tune.gemvRpw, RPW = rpwT ? rpwT : Math.max(1, Math.min(8, Math.floor(a.N / 1024)));
  const KMAX = Math.ceil(a.K / 1024) * 1024, mode = a.x.mode || 'f32', add = !!a.add;
  const wgMax = (g.limits && g.limits.maxComputeWorkgroupStorageSize) || 16384;
  // v026.9: on a device whose workgroup memory cannot hold the whole x (16 KB), x is cached one chunk at a time (exact, see GEMVC)
  const KC = 2 * KMAX * 4 + 2048 > wgMax ? Math.max(128, Math.floor((wgMax - 2048) / 8 / 128) * 128) : 0;
  const key = `m.gemv.${mode}.${add ? 'add' : 'st'}.${wf16 ? 'w16' : 'q8'}.${KMAX}.r${RPW}${KC ? '.kc' + KC : ''}`;
  const pipe = g.pipeline(key, () => (KC ? GEMVC(mode, add, KC, wf16, RPW) : GEMV(mode, add, KMAX, wf16, RPW)));
  const binds = [bw(a.x.buf), { buffer: a.w.buf, offset: a.w.off, size: a.w.bytes }, bw(a.y.buf)];
  if (mode === 'rms') binds.push(bw(a.nw.buf));
  const RW = 8 * RPW, wgs = Math.ceil(a.N / RW), per = 65535;
  for (let n0 = 0; n0 < wgs; n0 += per) {
    const nw = Math.min(per, wgs - n0);
    const pr = P().u32(a.M).u32(a.N - n0 * RW).u32(a.K).u32(a.x.ld || a.K).u32(a.w.cols / 64).u32(mode === 'rms' ? a.nw.off : 0).f32(1e-6)
      .u32(a.y.ld || a.N).u32((a.wr0 || 0) + n0 * RW).u32((a.y.off || 0) + n0 * RW).u32(0).u32(0);
    g.runner.dispatch(pipe, binds, pr.ab, [nw, 1], nw * RW * a.K * 1.05 / g.rate.mem + 2e-5);
  }
}

// ------------------------------------------------------------------ decode helpers
// QKV [M][4096] f32 (q 16x128 | k 8x128 | v 8x128) -> q: RMSNorm(128)*qn, RoPE(pos_m) -> Q f16 [M][16][128];
// k: RMSNorm*kn, RoPE -> cache_m [k head][pos_m][128]; v -> cache_m [8 + head][pos_m][128].  rotate_half pairs (d, d+64), RP[pos][64][cos, sin].
const QKVPOST = `
enable f16;
struct P { pos0: u32, pos1: u32, cap0: u32, cap1: u32, nwOff: u32, eps: f32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> QKV: array<f32>;
@group(0) @binding(2) var<storage, read> NW: array<f32>;
@group(0) @binding(3) var<storage, read> RP: array<f32>;
@group(0) @binding(4) var<storage, read_write> Q: array<f16>;
@group(0) @binding(5) var<storage, read_write> C0: array<f16>;
@group(0) @binding(6) var<storage, read_write> C1: array<f16>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) d: u32) {
  let slot = wid.x; let m = wid.y; let pos = select(p.pos0, p.pos1, m == 1u); let cap = select(p.cap0, p.cap1, m == 1u);
  let base = m * 4096u + slot * 128u;
  var x0 = QKV[base + d]; var x1 = QKV[base + d + 64u];
  if (slot < 24u) {
    red[d] = x0 * x0 + x1 * x1; workgroupBarrier();
    for (var s = 32u; s > 0u; s = s >> 1u) { if (d < s) { red[d] = red[d] + red[d + s]; } workgroupBarrier(); }
    let inv = inverseSqrt(red[0] / 128.0 + p.eps);
    let wo = p.nwOff + select(128u, 0u, slot < 16u);
    let y0 = x0 * inv * NW[wo + d]; let y1 = x1 * inv * NW[wo + d + 64u];
    let cs = RP[pos * 128u + 2u * d]; let sn = RP[pos * 128u + 2u * d + 1u];
    x0 = y0 * cs - y1 * sn; x1 = y1 * cs + y0 * sn;
  }
  if (slot < 16u) { let o = (m * 16u + slot) * 128u; Q[o + d] = f16(x0); Q[o + d + 64u] = f16(x1); return; }
  let h = slot - 16u; let o = (h * cap + pos) * 128u;
  if (m == 0u) { C0[o + d] = f16(x0); C0[o + d + 64u] = f16(x1); } else { C1[o + d] = f16(x0); C1[o + d + 64u] = f16(x1); }
}`;
const SMALL = `
enable f16;
struct P { op: u32, n: u32, a: f32, b: u32, c: u32, d: u32, e: u32, f: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> A: array<f32>;
@group(0) @binding(2) var<storage, read_write> B: array<f32>;
@group(0) @binding(3) var<storage, read> W: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.x + gid.y * nw.x * 256u; if (i >= p.n) { return; }
  switch (p.op) {
    case 0u: { let m = i / p.b; let j = i % p.b; let g = A[m * 2u * p.b + j]; let u = A[m * 2u * p.b + p.b + j]; B[i] = g / (1.0 + exp(-g)) * u; }   // swiglu [M][2b] -> [M][b]
    case 1u: { let m = i / 1024u; let k = i % 1024u; let r = p.b; let rec = ((r >> 6u) * 16u + k / 64u) * 1056u; let rr = r & 63u;        // gather q8 row r -> A[m][k]
               let q = W[rec + rr * 16u + (k % 64u) / 4u]; let s2 = unpack2x16float(W[rec + 1024u + (rr >> 1u)]); let sc = select(s2.x, s2.y, (rr & 1u) == 1u);
               let sh = 24u - 8u * (k % 4u); A[i] = f32(i32(q << sh) >> 24u) * sc; }
    case 2u: { B[i] = A[p.c + i] + p.a * (A[i] - A[p.c + i]); }                                                                             // CFG: uncond + s (cond - uncond)
    case 3u: { let r = i / 1024u; let k = i % 1024u; B[i] = A[(p.b + r) * 1024u + k]; }                                                    // copy row (last prompt row)
    case 4u: { let k = i % 1024u; let v = unpack2x16float(W[(p.b * 1024u + k) / 2u]); A[i] = select(v.x, v.y, (k & 1u) == 1u); }        // gather f16 row r -> A[m][k]
    default: {}
  }
}`;
function small(g, op, n, A, B, W, a = 0, b = 0, c = 0) {
  const dm = g._mdummy || (g._mdummy = g.buffer(256, 'm.dummy'));
  g.runner.dispatch(g.pipeline('m.lmsmall', () => SMALL), [bw(A || dm), bw(B || dm), W ? (W.buffer ? W : bw(W)) : bw(dm)], P().u32(op).u32(n).f32(a).u32(b).u32(c).u32(0).u32(0).u32(0).ab,
    [Math.min(Math.ceil(n / 256), 65535), Math.ceil(Math.ceil(n / 256) / 65535)], n * 12 / g.rate.mem);
}

// ------------------------------------------------------------------ sampling (JS), the official order: CFG on the valid set -> EOS rule -> top-p (on T=1) -> softmax(l / temp) -> draw
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** cfg: Float32Array(64001) (index 64000 = EOS); returns {tok: 0..63999 code | 64000 EOS, kept, pTop}.  Exact top-p of the official order
 *  (sort descending, keep i while the mass BEFORE i <= top_p): the mass is binned in log space first, so only the tokens of the bins above
 *  the boundary (plus the boundary bin) are sorted. */
const NB = 2048, BW = 48 / NB;
export function sampleCode(cfg, { count, target, topP = 0.9, temp = 0.85, rng }) {
  if (count >= target) return { tok: 64000, kept: 1 };
  let mx = -Infinity; for (let i = 0; i < 64000; i++) if (cfg[i] > mx) mx = cfg[i];       // EOS blocked (-inf) while count < target
  const e = new Float64Array(64000), bin = new Int32Array(64000), mass = new Float64Array(NB + 1); let Z = 0;
  for (let i = 0; i < 64000; i++) { const d = mx - cfg[i]; const v = Math.exp(-d); e[i] = v; Z += v; const b = d < 48 ? Math.floor(d / BW) : NB; bin[i] = b; mass[b] += v; }
  let cum = 0, bb = 0; for (; bb < NB; bb++) { if (cum + mass[bb] > topP * Z) break; cum += mass[bb]; }
  const cand = []; for (let i = 0; i < 64000; i++) if (bin[i] <= bb) cand.push(i);
  cand.sort((x, y) => cfg[y] - cfg[x] || x - y);
  let c2 = 0, k = 0; for (; k < cand.length; k++) { if (c2 > topP * Z) break; c2 += e[cand[k]]; }
  const kept = cand.slice(0, Math.max(1, k));
  let m2 = -Infinity; for (const i of kept) m2 = Math.max(m2, cfg[i] / temp);
  let s = 0; const w = new Float64Array(kept.length); for (let j = 0; j < kept.length; j++) { w[j] = Math.exp(cfg[kept[j]] / temp - m2); s += w[j]; }
  let u = rng() * s, j = 0; for (; j < w.length - 1; j++) { u -= w[j]; if (u <= 0) break; }
  return { tok: kept[j], kept: kept.length, pTop: w[0] / s };
}

export class AceLM {
  constructor(g, lmStore, mainStore) { this.g = g; this.st = lmStore; this.main = mainStore; this.sh = null; }
  async load(onShard) {
    if (this.sh) return; this.sh = [];
    for (let l = 0; l < 28; l++) { this.sh.push(await this.st.upload('lm.layer.' + pad2(l))); if (onShard) onShard(l); }
    this.head = await this.st.upload('lm.head');
  }
  unload() { this.g.runner.flush(); if (this.sh) for (const s of this.sh) this.st.release(s); if (this.head) this.st.release(this.head); this.sh = null; this.head = null; }
  get weightBytes() { return (this.sh || []).reduce((s, x) => s + x.bytes, 0) + (this.head ? this.head.bytes : 0); }

  /** prompt ids (cond, uncond) -> codes Int32Array(target).  opts {seed, seconds, cfg 2, topP .9, temp .85, check, onToken(k, n), forced (Int32Array of
   *  token-or-code ids to teacher-force), keepLogits(k, cond64001, uncond64001, cfg64001)} */
  async generate(idsC, idsU, opts = {}) {
    const g = this.g, target = Math.round(opts.seconds * 5), cfgS = opts.cfg || 2.0, steps = target + 1;
    const capC = idsC.length + steps + 1, capU = idsU.length + steps + 1, cap = Math.max(capC, capU);
    const rope = g.upload(ropeTE(cap), 'lm.rope');
    const caches = [], S = { x: g.buffer(2 * 1024 * 4, 'lm.x'), st: g.buffer(16, 'lm.st'), qkv: g.buffer(2 * 4096 * 4, 'lm.qkv'), q: g.buffer(2 * 16 * 256, 'lm.q'),
      o: g.buffer(2 * 2048 * 2, 'lm.o'), gu: g.buffer(2 * 6144 * 4, 'lm.gu'), sw: g.buffer(2 * 3072 * 4, 'lm.sw'), lg: g.buffer(2 * HEAD_ROWS * 4, 'lm.lg'), cfg: g.buffer(HEAD_ROWS * 4, 'lm.cfg') };
    for (let l = 0; l < 28; l++) caches.push([g.buffer(16 * capC * 256, 'lm.kv' + l + 'c'), g.buffer(16 * capU * 256, 'lm.kv' + l + 'u')]);
    const rng = mulberry32(opts.seed >>> 0 ^ 0x5eed5eed), codes = new Int32Array(target), info = { kept: [], prefill: 0, decode: 0, read: 0, sample: 0, record: 0 };
    try {
      // ---- prefill each sequence with the tiled GEMM; K/V land in the caches; the last row of each -> S.x[s]
      const t0 = performance.now();
      for (const [s, ids, capS] of [[0, idsC, capC], [1, idsU, capU]]) await this._prefill(ids, s, capS, caches, rope, S);
      info.prefill = (performance.now() - t0) / 1000;
      const t1 = performance.now(); let count = 0;
      for (let k = 0; k < steps; k++) {
        const tr = performance.now();
        if (k > 0) this._decodeLayers(caches, rope, S, idsC.length + k - 1, idsU.length + k - 1, capC, capU);
        // head: final RMSNorm on both rows -> GEMV over the 64,064-row code table -> CFG
        gemv(g, { w: tt(this.head, 'codes'), x: { buf: S.x, ld: 1024, mode: 'rms' }, nw: { buf: this.head.buf, off: tt(this.head, 'norm').off / 4 }, M: 2, N: HEAD_ROWS, K: 1024, y: { buf: S.lg, ld: HEAD_ROWS } });
        small(g, 2, 64001, S.lg, S.cfg, null, cfgS, 0, HEAD_ROWS);
        info.record += performance.now() - tr;
        let tq = performance.now(); info.record += 0;
        const cfg = new Float32Array(await g.read(S.cfg, 0, 64001 * 4)); info.read += performance.now() - tq;
        if (opts.keepLogits) { const both = new Float32Array(await g.read(S.lg)); opts.keepLogits(k, both.subarray(0, 64001), both.subarray(HEAD_ROWS, HEAD_ROWS + 64001), cfg); }
        let tok;
        if (opts.forced) tok = opts.forced[k];
        else { tq = performance.now(); const r = sampleCode(cfg, { count, target, topP: opts.topP || 0.9, temp: opts.temp || 0.85, rng }); tok = r.tok; info.sample += performance.now() - tq; if (k < 400) info.kept.push(r.kept); }
        if (tok === 64000 || tok === LM_EOS) break;
        codes[count++] = tok;
        const w = tt(this.head, 'codes');    // next input = the sampled code's embedding (tied head row) for both sequences
        small(g, w.enc === 'f16' ? 4 : 1, 2 * 1024, S.x, null, { buffer: w.buf, offset: w.off, size: w.bytes }, 0, tok, 0);
        if (opts.onToken) opts.onToken(count, target);
        if (opts.check && (k & 7) === 7) opts.check();
      }
      info.decode = (performance.now() - t1) / 1000; info.count = count;
      return { codes: codes.subarray(0, count), info };
    } finally {
      g.runner.flush(); for (const [a, b] of caches) { g.free(a); g.free(b); } for (const k in S) g.free(S[k]); g.free(rope);
    }
  }
  async _prefill(ids, s, capS, caches, rope, S) {
    const g = this.g, L = ids.length;
    const rows = await this.st.readRows('lm.embed_rows', Array.from(new Set(ids)));
    const uniq = Array.from(new Set(ids)), where = new Map(uniq.map((id, i) => [id, i])), x0 = new Float32Array(L * 1024);
    for (let t = 0; t < L; t++) x0.set(rows.subarray(where.get(ids[t]) * 1024, (where.get(ids[t]) + 1) * 1024), t * 1024);
    const X = g.upload(x0, 'lm.px'), st = g.buffer(L * 8, 'lm.pst'), q = g.buffer(16 * L * 256, 'lm.pq'), o = g.buffer(L * 2048 * 2, 'lm.po'), m = g.buffer(L * 3072 * 2, 'lm.pm');
    try {
      for (let l = 0; l < 28; l++) {
        const sh = this.sh[l], kv = caches[l][s], qkn = tt(sh, 'qk_norm').off / 4;
        rowstats(g, { x: { buf: X }, rows: L, cols: 1024, mode: 'rms', eps: 1e-6, st: { buf: st } });
        const pv = { buf: sh.buf, off: tt(sh, 'ln1').off / 4 };
        gemm(g, { acc: 'f32', w: tt(sh, 'qkv'), x: { buf: X, ld: 1024, mode: 'rms' }, stats: { buf: st }, pv, M: L, N: 2048, K: 1024, wr0: 0, epi: 'heads', y: { buf: q },
          ev: { buf: sh.buf, off: qkn }, heads: { Ltot: L, Hq: 16, Hkv: 0, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: rope } } });
        gemm(g, { acc: 'f32', w: tt(sh, 'qkv'), x: { buf: X, ld: 1024, mode: 'rms' }, stats: { buf: st }, pv, M: L, N: 2048, K: 1024, wr0: 2048, epi: 'heads', y: { buf: kv },
          ev: { buf: sh.buf, off: qkn }, heads: { Ltot: capS, Hq: 0, Hkv: 8, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: rope } } });
        mattention(g, { q: { buf: q, off: 0 }, k: { buf: kv, off: 0 }, v: { buf: kv, off: 8 * capS * 256 }, kvStride: capS, o: { buf: o, ld: 2048 },
          Lq: L, Lk: L, Hq: 16, Hkv: 8, mode: 1, nvalid: L, cfg: g.tune && g.tune.attn });
        gemm(g, { acc: 'f32', w: tt(sh, 'o'), x: { buf: o, ld: 2048 }, M: L, N: 1024, K: 2048, epi: 'resadd', y: { buf: X, ld: 1024 } });
        rowstats(g, { x: { buf: X }, rows: L, cols: 1024, mode: 'rms', eps: 1e-6, st: { buf: st } });
        gemm(g, { acc: 'f32', w: tt(sh, 'gate_up'), x: { buf: X, ld: 1024, mode: 'rms' }, stats: { buf: st }, pv: { buf: sh.buf, off: tt(sh, 'ln2').off / 4 }, M: L, N: 6144, K: 1024,
          wr0: 0, wr1: 3072, epi: 'swiglu', y: { buf: m, ld: 3072 } });
        gemm(g, { acc: 'f32', w: tt(sh, 'down'), x: { buf: m, ld: 3072 }, M: L, N: 1024, K: 3072, epi: 'resadd', y: { buf: X, ld: 1024 } });
        if ((l & 3) === 3) { g.runner.flush(); await g.device.queue.onSubmittedWorkDone(); }
      }
      g.runner.flush(); await g.done();
      const r = new Float32Array(await g.read(X, (L - 1) * 4096, 4096)); g.upload(r, 'lm.xlast', S.x, s * 4096);   // last prompt row -> S.x[s]
    } finally { g.runner.flush(); [X, st, q, o, m].forEach((b) => g.free(b)); }
  }
  _decodeLayers(caches, rope, S, posC, posU, capC, capU) {
    const g = this.g;
    for (let l = 0; l < 28; l++) {
      const sh = this.sh[l], [kc, ku] = caches[l];
      gemv(g, { w: tt(sh, 'qkv'), x: { buf: S.x, ld: 1024, mode: 'rms' }, nw: { buf: sh.buf, off: tt(sh, 'ln1').off / 4 }, M: 2, N: 4096, K: 1024, y: { buf: S.qkv, ld: 4096 } });
      g.runner.dispatch(g.pipeline('m.qkvpost', () => QKVPOST), [bw(S.qkv), bw(sh.buf), bw(rope), bw(S.q), bw(kc), bw(ku)],
        P().u32(posC).u32(posU).u32(capC).u32(capU).u32(tt(sh, 'qk_norm').off / 4).f32(1e-6).u32(0).u32(0).ab, [32, 2], 2e-5);
      for (const [s, kv, pos, capS] of [[0, kc, posC, capC], [1, ku, posU, capU]])
        mattention(g, { q: { buf: S.q, off: s * 16 * 256 }, k: { buf: kv, off: 0 }, v: { buf: kv, off: 8 * capS * 256 }, kvStride: capS, o: { buf: S.o, off: s * 4096, ld: 2048 },
          Lq: 1, Lk: pos + 1, Hq: 16, Hkv: 8, mode: 0, nvalid: pos + 1, cfg: g.tune && g.tune.attn });
      gemv(g, { w: tt(sh, 'o'), x: { buf: S.o, ld: 2048, mode: 'f16' }, M: 2, N: 1024, K: 2048, y: { buf: S.x, ld: 1024 }, add: true });
      gemv(g, { w: tt(sh, 'gate_up'), x: { buf: S.x, ld: 1024, mode: 'rms' }, nw: { buf: sh.buf, off: tt(sh, 'ln2').off / 4 }, M: 2, N: 6144, K: 1024, y: { buf: S.gu, ld: 6144 } });
      gemv(g, { w: tt(sh, 'down'), x: { buf: S.gu, ld: 6144, mode: 'swiglu' }, M: 2, N: 1024, K: 3072, y: { buf: S.x, ld: 1024 }, add: true });
    }
  }
}

// ------------------------------------------------------------------ FSQ + detokenizer: codes [Tc] -> LM hints [Tc*5][64] (25 Hz)
// FSQ (vector_quantize_pytorch, preserve_symmetry): level_d = (c / basis_d) % L_d, v_d = level_d * 2 / (L_d - 1) - 1; quantized = project_out(v)
// detokenizer: embed (Linear+b) -> x + special[p] for p = 0..4 -> 2 bidirectional layers over each group of 5 (RoPE positions 0..4) -> RMSNorm -> proj_out
const LEV = [8, 8, 8, 5, 5, 5], BASIS = [1, 8, 64, 512, 2560, 12800];
const DET = `
enable f16;
struct P { op: u32, R: u32, scale: f32, spOff: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> A: array<f32>;
@group(0) @binding(2) var<storage, read_write> B: array<f32>;
@group(0) @binding(3) var<storage, read> S: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.x + gid.y * nw.x * 256u; if (i >= p.R * 2048u) { return; }
  let r = i / 2048u; let c = i % 2048u;
  B[i] = A[(r / 5u) * 2048u + c] + S[p.spOff + (r % 5u) * 2048u + c];       // expand x5 + special tokens
}`;
const BLK5 = `
enable f16;
struct P { R: u32, scale: f32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> H: array<f16>;
@group(0) @binding(2) var<storage, read_write> O: array<f16>;
var<workgroup> red: array<f32, 640>;
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) d: u32) {
  let r = wid.x; let h = wid.y; let hk = h / 2u; let b0 = (r / 5u) * 5u;
  let q = f32(H[(h * p.R + r) * 128u + d]);
  for (var j = 0u; j < 5u; j = j + 1u) { red[j * 128u + d] = q * f32(H[((16u + hk) * p.R + b0 + j) * 128u + d]); }
  workgroupBarrier();
  for (var s = 64u; s > 0u; s = s >> 1u) { if (d < s) { for (var j = 0u; j < 5u; j = j + 1u) { red[j * 128u + d] = red[j * 128u + d] + red[j * 128u + d + s]; } } workgroupBarrier(); }
  var sc: array<f32, 5>; var mx = -1e30;
  for (var j = 0u; j < 5u; j = j + 1u) { sc[j] = red[j * 128u] * p.scale; mx = max(mx, sc[j]); }
  var z = 0.0; var o = 0.0;
  for (var j = 0u; j < 5u; j = j + 1u) { let e = exp(sc[j] - mx); z = z + e; o = o + e * f32(H[((24u + hk) * p.R + b0 + j) * 128u + d]); }
  O[r * 2048u + h * 128u + d] = f16(o / z);
}`;
export class AceDetok {
  constructor(g, lmStore) { this.g = g; this.st = lmStore; }
  /** codes Int32Array(Tc) -> Float32Array hints [Tc*5][64].  opts {keepQuantized(Float32Array)} */
  async run(codes, opts = {}) {
    const g = this.g, st = this.st, Tc = codes.length, R = Tc * 5;
    const cs = await st.upload('detok.const');
    const f32 = async (n) => { const x = st.m.tensors['detok.const/' + n], s = st.shards.get(x.shard);
      const ab = st.http ? await st._range(s.file, x.offset, x.bytes) : (await st.st.call('read', { name: `${st.dir}/${s.file}`, at: x.offset, len: x.bytes })).buf; return new Float32Array(ab.slice(0, x.bytes)); };
    const W = await f32('fsq.W'), b = await f32('fsq.b'), qz = new Float32Array(Tc * 2048);
    for (let t = 0; t < Tc; t++) {
      const v = LEV.map((L, k) => (Math.floor(codes[t] / BASIS[k]) % L) * (2 / (L - 1)) - 1);
      for (let n = 0; n < 2048; n++) { let a = b[n]; for (let k = 0; k < 6; k++) a += W[n * 6 + k] * v[k]; qz[t * 2048 + n] = a; }
    }
    if (opts.keepQuantized) opts.keepQuantized(qz);
    const rope5 = new Float32Array(R * 128), r5 = ropeTE(5); for (let r = 0; r < R; r++) rope5.set(r5.subarray((r % 5) * 128, (r % 5) * 128 + 128), r * 128);
    const q16 = g.upload(toF16(qz), 'dt.q'), XE = g.buffer(Tc * 2048 * 4, 'dt.xe'), X = g.buffer(R * 2048 * 4, 'dt.x'), stb = g.buffer(R * 8, 'dt.st'),
      heads = g.buffer(32 * R * 256, 'dt.h'), o = g.buffer(R * 2048 * 2, 'dt.o'), m = g.buffer(R * 6144 * 2, 'dt.m'), rp = g.upload(rope5, 'dt.rope'), out = g.buffer(R * 64 * 4, 'dt.out');
    const sh = [];
    try {
      gemm(g, { acc: 'f32', w: tt(cs, 'embed'), x: { buf: q16, ld: 2048 }, M: Tc, N: 2048, K: 2048, epi: 'resadd', store: true, bv: { buf: cs.buf, off: tt(cs, 'embed.bias').off / 4 }, y: { buf: XE, ld: 2048 } });
      g.runner.dispatch(g.pipeline('m.det', () => DET), [bw(XE), bw(X), bw(cs.buf)], P().u32(0).u32(R).f32(0).u32(tt(cs, 'special').off / 4).ab,
        [Math.min(Math.ceil(R * 2048 / 256), 65535), Math.ceil(Math.ceil(R * 2048 / 256) / 65535)], R * 2048 * 12 / g.rate.mem);
      for (let l = 0; l < 2; l++) {
        const L = await st.upload('detok.layer.' + l); sh.push(L);
        rowstats(g, { x: { buf: X }, rows: R, cols: 2048, mode: 'rms', eps: 1e-6, st: { buf: stb } });
        gemm(g, { acc: 'f32', w: tt(L, 'qkv'), x: { buf: X, ld: 2048, mode: 'rms' }, stats: { buf: stb }, pv: { buf: L.buf, off: tt(L, 'ln1').off / 4 }, M: R, N: 4096, K: 2048,
          epi: 'heads', y: { buf: heads }, ev: { buf: L.buf, off: tt(L, 'qk_norm').off / 4 }, heads: { Ltot: R, Hq: 16, Hkv: 8, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: rp } } });
        g.runner.dispatch(g.pipeline('m.blk5', () => BLK5), [bw(heads), bw(o)], P().u32(R).f32(1 / Math.sqrt(128)).u32(0).u32(0).ab, [R, 16], R * 16 * 128 * 20 / g.rate.mem);
        gemm(g, { acc: 'f32', w: tt(L, 'o'), x: { buf: o, ld: 2048 }, M: R, N: 2048, K: 2048, epi: 'resadd', y: { buf: X, ld: 2048 } });
        rowstats(g, { x: { buf: X }, rows: R, cols: 2048, mode: 'rms', eps: 1e-6, st: { buf: stb } });
        gemm(g, { acc: 'f32', w: tt(L, 'gate_up'), x: { buf: X, ld: 2048, mode: 'rms' }, stats: { buf: stb }, pv: { buf: L.buf, off: tt(L, 'ln2').off / 4 }, M: R, N: 12288, K: 2048,
          wr0: 0, wr1: 6144, epi: 'swiglu', y: { buf: m, ld: 6144 } });
        gemm(g, { acc: 'f32', w: tt(L, 'down'), x: { buf: m, ld: 6144 }, M: R, N: 2048, K: 6144, epi: 'resadd', y: { buf: X, ld: 2048 } });
        g.runner.flush(); await g.done();
      }
      rowstats(g, { x: { buf: X }, rows: R, cols: 2048, mode: 'rms', eps: 1e-6, st: { buf: stb } });
      gemm(g, { acc: 'f32', w: tt(cs, 'proj_out'), x: { buf: X, ld: 2048, mode: 'rms' }, stats: { buf: stb }, pv: { buf: cs.buf, off: tt(cs, 'norm').off / 4 }, M: R, N: 64, K: 2048,
        epi: 'resadd', store: true, bv: { buf: cs.buf, off: tt(cs, 'proj_out.bias').off / 4 }, y: { buf: out, ld: 64 } });
      const h = new Float32Array(await g.read(out));
      return h;
    } finally { g.runner.flush(); for (const L of sh) st.release(L); st.release(cs); [q16, XE, X, stb, heads, o, m, rp, out].forEach((x) => g.free(x)); }
  }
}
