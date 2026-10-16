// FLUX.2 [klein] 4B building blocks on the Pocket Flux ops (SPEC.md sections 2.4 and 3.3), one streamed shard each.
// Residual streams are fp32; every matmul input is produced by a fused prologue (RMSNorm or LayerNorm+adaLN) in fp16;
// QK-RMSNorm + RoPE are fused into the qkv GEMM epilogue; gates + residual adds are fused into the output GEMMs (fp32).
// s.acc = GEMM accumulate mode for the block ('f32' | 'f16'; undefined = gpu.tune.acc).  The text encoder always uses 'f32'
// (f16 partial sums break its massive-activation rows: M7 audit).  Scratch buffers are owned by the caller (pipelines/*), sized by the memory plan in docs/ARCHITECTURE.md.
'use strict';
import { gemm } from '../ops/gemm.js';
import { attention } from '../ops/attention.js';
import { rowstats } from '../ops/misc.js';

const D = 3072, NH = 24, MLP = 9216, QK_EPS = 1.1920928955078125e-7;   // the reference implementation's fp32 RMSNorm eps (finfo(f32).eps)
const neg = (n) => (-n) >>> 0;                                            // u32 wrap for "shift = scale - 3072"

/** DiT RoPE table [L][64][cos, sin] from position ids [L][4] (axis a owns pairs 16a..16a+15, theta 2000), float64 angles */
export function ropeDiT(ids, L) {
  const out = new Float32Array(L * 128);
  for (let t = 0; t < L; t++) for (let p = 0; p < 64; p++) {
    const a = p >> 4, d = p & 15, ang = ids[t * 4 + a] * Math.pow(2000, -d / 16);
    out[t * 128 + 2 * p] = Math.cos(ang); out[t * 128 + 2 * p + 1] = Math.sin(ang);
  }
  return out;
}
/** position ids for [txt T | img h x w | refs...] (SPEC 3.2) */
export function ditIds(T, h, w, refs = []) {
  const n = T + h * w + refs.reduce((s, r) => s + r.h * r.w, 0), ids = new Float32Array(n * 4);
  let o = 0;
  for (let t = 0; t < T; t++, o++) ids[o * 4 + 3] = t;
  const grid = (hh, ww, idx) => { for (let i = 0; i < hh; i++) for (let j = 0; j < ww; j++, o++) { ids[o * 4] = idx; ids[o * 4 + 1] = i; ids[o * 4 + 2] = j; } };
  grid(h, w, 0); refs.forEach((r, k) => grid(r.h, r.w, 10 * (k + 1)));
  return ids;
}
/** Qwen RoPE table [T][64][cos, sin] (rotate_half layout, theta 1e6) */
export function ropeTE(T) {
  const out = new Float32Array(T * 128);
  for (let t = 0; t < T; t++) for (let d = 0; d < 64; d++) {
    const ang = t * Math.pow(1e6, -2 * d / 128);
    out[t * 128 + 2 * d] = Math.cos(ang); out[t * 128 + 2 * d + 1] = Math.sin(ang);
  }
  return out;
}

/** Qwen3 layer.  s = {x (f32 [T][2560]), T, nvalid, stats, heads (f16 [48][T][128]), o (f16 [T][4096]), m (f16 [T][9728]), rope} */
export function teLayer(g, sh, s, l) {
  const p = `model.layers.${l}.`, T = s.T, HD = 2560;
  const t = (n) => sh.t(p + n);
  const ln1 = t('input_layernorm.weight'), qkv = t('self_attn.qkv_proj.weight'), qn = t('self_attn.q_norm.weight');
  const o = t('self_attn.o_proj.weight'), ln2 = t('post_attention_layernorm.weight'), gu = t('mlp.gate_up_proj.weight'), dn = t('mlp.down_proj.weight');
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: qkv, x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: ln1.off / 4 }, M: T, N: 6144, K: HD,
    epi: 'heads', y: { buf: s.heads }, ev: { buf: sh.buf, off: qn.off / 4 },
    heads: { Ltot: T, Hq: 32, Hkv: 8, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: s.rope } } });
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: 32 * T * 256 }, v: { buf: s.heads, off: 40 * T * 256 },
    o: { buf: s.o, ld: 4096 }, Lq: T, Lk: T, Hq: 32, Hkv: 8, mode: 1, nvalid: s.nvalid });
  gemm(g, { acc: s.acc, w: o, x: { buf: s.o, ld: 4096 }, M: T, N: HD, K: 4096, epi: 'resadd', y: { buf: s.x, ld: HD } });
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: gu, x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: ln2.off / 4 }, M: T, N: 19456, K: HD,
    wr0: 0, wr1: 9728, epi: 'swiglu', y: { buf: s.m, ld: 9728 } });
  gemm(g, { acc: s.acc, w: dn, x: { buf: s.m, ld: 9728 }, M: T, N: HD, K: 9728, epi: 'resadd', y: { buf: s.x, ld: HD } });
}

/** modulation offsets (floats) inside s.mod: img [shift1, scale1, gate1, shift2, scale2, gate2], txt likewise, single [shift, scale, gate] */
function mlpChunks(g, sh, s, wName, w2Name, row0, rows, scaleOff, gateOff, swiglu) {
  for (let c0 = 0; c0 < rows; c0 += s.chunk) {
    const n = Math.min(s.chunk, rows - c0), r = row0 + c0;
    gemm(g, Object.assign({ acc: s.acc, w: sh.t(wName), x: { buf: s.x, off: r * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: s.stats, off: r },
      pv: { buf: s.mod, off: scaleOff, stride: neg(3072) }, M: n, K: D, epi: 'swiglu', y: { buf: s.m, ld: MLP } }, swiglu));
    gemm(g, Object.assign({ acc: s.acc, w: sh.t(w2Name), x: { buf: s.m, ld: MLP }, M: n, N: D, K: MLP, epi: 'resadd', y: { buf: s.x, off: r * D * 4, ld: D },
      ev: { buf: s.mod, off: gateOff } }, swiglu.w2 || {}));
  }
}

/** double block b.  s = {x f32 [L][3072] (txt rows 0..T-1 then img(+ref) rows), L, T, mod (f32), modImg, modTxt (float offsets),
 *  stats, heads (f16 [72][L][128]), o (f16 [L][3072]), m (f16 [chunk][9216]), rope (f32 [L][128]), chunk} */
export function ditDouble(g, sh, s, b) {
  const p = `double_blocks.${b}.`, L = s.L, T = s.T, nI = L - T;
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    gemm(g, { acc: s.acc, w: sh.t(p + `${st}_attn.qkv.weight`), x: { buf: s.x, off: row0 * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: s.stats, off: row0 },
      pv: { buf: s.mod, off: mo + 3072, stride: neg(3072) }, M: rows, N: 3 * D, K: D, epi: 'heads', y: { buf: s.heads },
      ev: { buf: sh.buf, off: sh.t(p + `${st}_attn.norm.query_norm.scale`).off / 4 },
      heads: { Ltot: L, Hq: NH, Hkv: NH, rowOff: row0, eps: QK_EPS, ropeMode: 'inter', rope: { buf: s.rope } } });
  }
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: NH * L * 256 }, v: { buf: s.heads, off: 2 * NH * L * 256 },
    o: { buf: s.o, ld: D }, Lq: L, Lk: L, Hq: NH, Hkv: NH, mode: 0 });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    gemm(g, { acc: s.acc, w: sh.t(p + `${st}_attn.proj.weight`), x: { buf: s.o, off: row0 * D * 2, ld: D }, M: rows, N: D, K: D, epi: 'resadd',
      y: { buf: s.x, off: row0 * D * 4, ld: D }, ev: { buf: s.mod, off: mo + 6144 } });
  }
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    mlpChunks(g, sh, s, p + `${st}_mlp.0.weight`, p + `${st}_mlp.2.weight`, row0, rows, mo + 12288, mo + 15360, { N: 2 * MLP, wr0: 0, wr1: MLP });
  }
}

/** single block b (x = [txt | img | ref] rows), modulation at s.modSingle */
export function ditSingle(g, sh, s, b) {
  const p = `single_blocks.${b}.`, L = s.L, mo = s.modSingle;
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: sh.t(p + 'linear1.weight'), x: { buf: s.x, ld: D, mode: 'lnmod' }, stats: { buf: s.stats }, pv: { buf: s.mod, off: mo + 3072, stride: neg(3072) },
    M: L, N: 3 * D, K: D, epi: 'heads', y: { buf: s.heads }, ev: { buf: sh.buf, off: sh.t(p + 'norm.query_norm.scale').off / 4 },
    heads: { Ltot: L, Hq: NH, Hkv: NH, rowOff: 0, eps: QK_EPS, ropeMode: 'inter', rope: { buf: s.rope } } });
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: NH * L * 256 }, v: { buf: s.heads, off: 2 * NH * L * 256 },
    o: { buf: s.o, ld: D }, Lq: L, Lk: L, Hq: NH, Hkv: NH, mode: 0 });
  // parallel block: the MLP half must read LN(x) of the block INPUT, so it runs before the attention half touches x
  // (each MLP chunk reads its rows through the fused LN prologue, then adds into the same rows only)
  if (s.parts !== 'attn') mlpChunks(g, sh, s, p + 'linear1.weight', p + 'linear2.weight', 0, L, mo + 3072, mo + 6144, { N: 2 * MLP, wr0: 3 * D, wr1: 3 * D + MLP, w2: { wk0: D } });
  if (s.parts !== 'mlp') gemm(g, { acc: s.acc, w: sh.t(p + 'linear2.weight'), x: { buf: s.o, ld: D }, wk0: 0, M: L, N: D, K: D, epi: 'resadd', y: { buf: s.x, ld: D }, ev: { buf: s.mod, off: mo + 6144 } });
}
