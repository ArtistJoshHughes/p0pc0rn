// FLUX.2 [klein] building blocks for ANY klein size (4B: D 3072 / 24 heads / MLP 9216 / Qwen3-4B hidden 2560; 9B: D 4096 / 32 heads /
// MLP 12288 / Qwen3-8B hidden 4096). Same math, kernels and fusions as models/klein_blocks.js (the 4B engine, validated on the iPhone);
// the only change is that every width comes from the pack's manifest (`dims`) instead of constants. p0pc0rn klein 9B probe, Oct 14.
'use strict';
import { gemm } from '../ops/gemm.js';
import { attention } from '../ops/attention.js';
import { rowstats } from '../ops/misc.js';

const QK_EPS = 1.1920928955078125e-7;   // the reference implementation's fp32 RMSNorm eps (finfo(f32).eps)
const neg = (n) => (-n) >>> 0;           // u32 wrap for "shift = scale - D"

/** dims from manifest.model: {te: {hidden, heads, kv_heads, mlp}, dit: {hidden, heads, mlp, double, single, ctx_dim}} */
export function kleinDims(model) {
  const te = model.te, dt = model.dit, D = dt.hidden;
  return { HD: te.hidden, Hq: te.heads, Hkv: te.kv_heads, QD: te.heads * 128, TMLP: te.mlp, TL: te.layers_used || 27, CD: 3 * te.hidden,
    D, NH: dt.heads, MLP: dt.mlp, ND: dt.double, NS: dt.single, CTX: dt.ctx_dim, MOD: 17 * D };
}

/** Qwen3 layer.  s = {x (f32 [T][HD]), T, nvalid, stats, heads (f16 [Hq+2Hkv][T][128]), o (f16 [T][QD]), m (f16 [T][TMLP]), rope, dims} */
export function teLayer(g, sh, s, l) {
  const p = `model.layers.${l}.`, T = s.T, { HD, Hq, Hkv, QD, TMLP } = s.dims;
  const t = (n) => sh.t(p + n);
  const ln1 = t('input_layernorm.weight'), qkv = t('self_attn.qkv_proj.weight'), qn = t('self_attn.q_norm.weight');
  const o = t('self_attn.o_proj.weight'), ln2 = t('post_attention_layernorm.weight'), gu = t('mlp.gate_up_proj.weight'), dn = t('mlp.down_proj.weight');
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: qkv, x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: ln1.buf, off: ln1.off / 4 }, M: T, N: (Hq + 2 * Hkv) * 128, K: HD,
    epi: 'heads', y: { buf: s.heads }, ev: { buf: qn.buf, off: qn.off / 4 },   // v026.9: each vector's own buffer (arena parts)
    heads: { Ltot: T, Hq, Hkv, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: s.rope } } });
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: Hq * T * 256 }, v: { buf: s.heads, off: (Hq + Hkv) * T * 256 },
    o: { buf: s.o, ld: QD }, Lq: T, Lk: T, Hq, Hkv, mode: 1, nvalid: s.nvalid });
  gemm(g, { acc: s.acc, w: o, x: { buf: s.o, ld: QD }, M: T, N: HD, K: QD, epi: 'resadd', y: { buf: s.x, ld: HD } });
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: gu, x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: ln2.buf, off: ln2.off / 4 }, M: T, N: 2 * TMLP, K: HD,
    wr0: 0, wr1: TMLP, epi: 'swiglu', y: { buf: s.m, ld: TMLP } });
  gemm(g, { acc: s.acc, w: dn, x: { buf: s.m, ld: TMLP }, M: T, N: HD, K: TMLP, epi: 'resadd', y: { buf: s.x, ld: HD } });
}

function mlpChunks(g, sh, s, wName, w2Name, row0, rows, scaleOff, gateOff, swiglu) {
  const { D, MLP } = s.dims;
  for (let c0 = 0; c0 < rows; c0 += s.chunk) {
    const n = Math.min(s.chunk, rows - c0), r = row0 + c0;
    gemm(g, Object.assign({ acc: s.acc, w: sh.t(wName), x: { buf: s.x, off: r * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: s.stats, off: r },
      pv: { buf: s.mod, off: scaleOff, stride: neg(D) }, M: n, K: D, epi: 'swiglu', y: { buf: s.m, ld: MLP } }, swiglu));
    gemm(g, Object.assign({ acc: s.acc, w: sh.t(w2Name), x: { buf: s.m, ld: MLP }, M: n, N: D, K: MLP, epi: 'resadd', y: { buf: s.x, off: r * D * 4, ld: D },
      ev: { buf: s.mod, off: gateOff } }, swiglu.w2 || {}));
  }
}

/** double block b.  s = {x f32 [L][D] (txt rows 0..T-1, then image rows), L, T, mod (f32), modImg, modTxt (float offsets), stats,
 *  heads (f16 [3NH][L][128]), o (f16 [L][D]), m (f16 [chunk][MLP]), rope, chunk, dims}.  mod per stream = [shift1, scale1, gate1, shift2, scale2, gate2] */
export function ditDouble(g, sh, s, b) {
  const p = `double_blocks.${b}.`, L = s.L, T = s.T, nI = L - T, { D, NH, MLP } = s.dims;
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    gemm(g, { acc: s.acc, w: sh.t(p + `${st}_attn.qkv.weight`), x: { buf: s.x, off: row0 * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: s.stats, off: row0 },
      pv: { buf: s.mod, off: mo + D, stride: neg(D) }, M: rows, N: 3 * D, K: D, epi: 'heads', y: { buf: s.heads },
      ev: { buf: sh.t(p + `${st}_attn.norm.query_norm.scale`).buf, off: sh.t(p + `${st}_attn.norm.query_norm.scale`).off / 4 },
      heads: { Ltot: L, Hq: NH, Hkv: NH, rowOff: row0, eps: QK_EPS, ropeMode: 'inter', rope: { buf: s.rope } } });
  }
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: NH * L * 256 }, v: { buf: s.heads, off: 2 * NH * L * 256 },
    o: { buf: s.o, ld: D }, Lq: L, Lk: L, Hq: NH, Hkv: NH, mode: 0 });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    gemm(g, { acc: s.acc, w: sh.t(p + `${st}_attn.proj.weight`), x: { buf: s.o, off: row0 * D * 2, ld: D }, M: rows, N: D, K: D, epi: 'resadd',
      y: { buf: s.x, off: row0 * D * 4, ld: D }, ev: { buf: s.mod, off: mo + 2 * D } });
  }
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    mlpChunks(g, sh, s, p + `${st}_mlp.0.weight`, p + `${st}_mlp.2.weight`, row0, rows, mo + 4 * D, mo + 5 * D, { N: 2 * MLP, wr0: 0, wr1: MLP });
  }
}

/** single block b (x = [txt | img] rows), modulation [shift, scale, gate] at s.modSingle */
export function ditSingle(g, sh, s, b) {
  const p = `single_blocks.${b}.`, L = s.L, mo = s.modSingle, { D, NH, MLP } = s.dims;
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: sh.t(p + 'linear1.weight'), x: { buf: s.x, ld: D, mode: 'lnmod' }, stats: { buf: s.stats }, pv: { buf: s.mod, off: mo + D, stride: neg(D) },
    M: L, N: 3 * D, K: D, epi: 'heads', y: { buf: s.heads }, ev: { buf: sh.t(p + 'norm.query_norm.scale').buf, off: sh.t(p + 'norm.query_norm.scale').off / 4 },
    heads: { Ltot: L, Hq: NH, Hkv: NH, rowOff: 0, eps: QK_EPS, ropeMode: 'inter', rope: { buf: s.rope } } });
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: NH * L * 256 }, v: { buf: s.heads, off: 2 * NH * L * 256 },
    o: { buf: s.o, ld: D }, Lq: L, Lk: L, Hq: NH, Hkv: NH, mode: 0 });
  // parallel block: the MLP half reads LN(x) of the block INPUT (stats above), so it runs before the attention half adds into x
  mlpChunks(g, sh, s, p + 'linear1.weight', p + 'linear2.weight', 0, L, mo + D, mo + 2 * D, { N: 2 * MLP, wr0: 3 * D, wr1: 3 * D + MLP, w2: { wk0: D } });
  gemm(g, { acc: s.acc, w: sh.t(p + 'linear2.weight'), x: { buf: s.o, ld: D }, wk0: 0, M: L, N: D, K: D, epi: 'resadd', y: { buf: s.x, ld: D }, ev: { buf: s.mod, off: mo + 2 * D } });
}
