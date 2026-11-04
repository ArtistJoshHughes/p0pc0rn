// p0v_pack.js - the .p0v weight pack (train/export_pack.py): parse, read tensors, and lay the weights out for the runtimes.
//   "P0V1" | u32 header bytes | header JSON {version, config, tensors: [{name, dtype, shape, offset, nbytes}]} | 64-byte aligned data.
//   dtype f16 | f32 | i8; an i8 weight W [out, ...] has "<name>.scale" (f32 [out]): W[o, ...] = W_i8[o, ...] * scale[o].
// Both backends see the same weight list (LIN: every GEMM, VEC: every small f32 vector), in the order p0voice.c's slot macros use.
'use strict';

const range = (n) => Array.from({ length: n }, (_, i) => i);
/** GEMM weights: Linear [out, in] or Conv1d [out, in, k] (re-ordered to [out][k][in], so K' = k * in runs tap-major) */
export const LIN = [
  'am.c_enc',
  ...range(6).flatMap((i) => [`am.enc.${i}.att.qkv`, `am.enc.${i}.att.o`, `am.enc.${i}.c1`, `am.enc.${i}.c2`]),
  'am.mu', 'am.c_dur', 'am.dur.c1', 'am.dur.c2', 'am.dur.c3', 'am.dur.out',
  'am.t_mlp.0', 'am.t_mlp.2', 'am.c_dec', 'am.dec_in',
  ...range(8).flatMap((i) => [`am.dec.${i}.pw1`, `am.dec.${i}.pw2`, `am.dec.${i}.ada`]),
  'am.dec_out', 'voc.embed',
  ...range(8).flatMap((i) => [`voc.blocks.${i}.pw1`, `voc.blocks.${i}.pw2`]),
  'voc.head',
];
/** f32 vectors; ".dw.weight" ([C, 1, 7]) is re-ordered to taps-major [7][C] */
export const VEC = [
  'am.emb.weight',
  ...range(6).flatMap((i) => [`am.enc.${i}.ln1.weight`, `am.enc.${i}.ln1.bias`, `am.enc.${i}.ln2.weight`, `am.enc.${i}.ln2.bias`]),
  'am.enc_ln.weight', 'am.enc_ln.bias',
  'am.dur.l1.weight', 'am.dur.l1.bias', 'am.dur.l2.weight', 'am.dur.l2.bias', 'am.dur.l3.weight', 'am.dur.l3.bias',
  ...range(8).flatMap((i) => [`am.dec.${i}.dw.weight`, `am.dec.${i}.dw.bias`]),
  'am.dec_ln.weight', 'am.dec_ln.bias', 'am.mel_mean', 'am.mel_std', 'voc.ln0.weight', 'voc.ln0.bias',
  ...range(8).flatMap((i) => [`voc.blocks.${i}.dw.weight`, `voc.blocks.${i}.dw.bias`, `voc.blocks.${i}.ln.weight`, `voc.blocks.${i}.ln.bias`, `voc.blocks.${i}.gamma`]),
  'voc.ln1.weight', 'voc.ln1.bias',
];
if (LIN.length !== 78 || VEC.length !== 97) throw new Error('p0v_pack: slot lists out of step with p0voice.c');

/** bytes (ArrayBuffer | TypedArray) -> { config, tensors: {name: {dtype, shape, offset (absolute), nbytes}}, u8, bytes } */
export function parsePack(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  if (u8.length < 8 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'P0V1') throw new Error('not a p0voice pack (P0V1)');
  const hlen = u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24);
  const hdr = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
  const base = 8 + hlen, tensors = {};
  for (const t of hdr.tensors) {
    if (base + t.offset + t.nbytes > u8.length) throw new Error('pack truncated at ' + t.name);
    tensors[t.name] = { dtype: t.dtype, shape: t.shape, offset: base + t.offset, nbytes: t.nbytes };
  }
  return { version: hdr.version, config: hdr.config, tensors, u8, bytes: u8.length };
}

// ------------------------------------------------------------------------------------------------ fp16 helpers
const H2F = (() => {   // fp16 -> f32 table (65536 entries, exact)
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = (h & 0x8000) ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
    t[h] = e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return t;
})();
export const h2f = (h) => H2F[h];

function raw(pack, name) {
  const t = pack.tensors[name];
  if (!t) throw new Error('pack has no tensor ' + name);
  const n = t.shape.reduce((a, b) => a * b, 1);
  const off = t.offset, u8 = pack.u8;
  // copy to an aligned buffer (the pack offsets are 64-byte aligned, but a sliced view may not be)
  const b = u8.buffer.slice(u8.byteOffset + off, u8.byteOffset + off + t.nbytes);
  const data = t.dtype === 'f16' ? new Uint16Array(b) : t.dtype === 'f32' ? new Float32Array(b) : new Int8Array(b);
  return { t, n, data };
}
/** a tensor as f32 (fp16 widened, int8 dequantised) */
export function tensorF32(pack, name) {
  const { t, n, data } = raw(pack, name);
  if (t.dtype === 'f32') return data;
  const o = new Float32Array(n);
  if (t.dtype === 'f16') { for (let i = 0; i < n; i++) o[i] = H2F[data[i]]; return o; }
  const s = tensorF32(pack, name + '.scale'), per = n / t.shape[0];
  for (let i = 0; i < n; i++) o[i] = data[i] * s[(i / per) | 0];
  return o;
}
export const hasTensor = (pack, name) => !!pack.tensors[name];

/** a GEMM weight, row-major [N][K'] in its stored dtype (conv re-ordered tap-major), + f32 scale (int8 only) and f32 bias */
export function linWeights(pack, prefix) {
  const { t, data } = raw(pack, prefix + '.weight');
  const N = t.shape[0], Cin = t.shape[1], k = t.shape.length === 3 ? t.shape[2] : 1, K = Cin * k;
  let w = data;
  if (k > 1) {   // [N][Cin][k] -> [N][k][Cin]
    w = new data.constructor(N * K);
    for (let n = 0; n < N; n++) for (let i = 0; i < Cin; i++) for (let j = 0; j < k; j++) w[n * K + j * Cin + i] = data[n * K + i * k + j];
  }
  const dt = t.dtype === 'i8' ? 'i8' : t.dtype === 'f16' ? 'f16' : 'f32';
  if (dt === 'f32') throw new Error('f32 GEMM weights are not supported (' + prefix + ')');
  const scale = dt === 'i8' ? tensorF32(pack, prefix + '.weight.scale') : null;
  const bias = hasTensor(pack, prefix + '.bias') ? tensorF32(pack, prefix + '.bias') : new Float32Array(N);
  return { name: prefix, N, K, k, Cin, dt, data: w, scale, bias };
}
/** a VEC entry as f32 (depthwise taps re-ordered to [7][C]) */
export function vecF32(pack, name) {
  const v = tensorF32(pack, name);
  if (!name.endsWith('.dw.weight')) return v;
  const t = pack.tensors[name], C = t.shape[0], k = t.shape[2], o = new Float32Array(C * k);
  for (let c = 0; c < C; c++) for (let j = 0; j < k; j++) o[j * C + c] = v[c * k + j];
  return o;
}
