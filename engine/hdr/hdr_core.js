// hdr_core.js - p0pc0rn v4 "Make HDR": the pure parts (no DOM, no GPU; node-tested). Josh (Nov 1): "Make the hdr button with both
// profiles as options"; "video and images will use it".
//
// The looks are p0pc0rn's OWN curve family (one formula, five numbers each), never ITU-R BT.2446 Method A's formulas:
//   l   = BT.2020 linear light of the SDR code value c (BT.709 primaries, BT.1886 gamma 2.4; SDR white = 1)
//   Y   = dot(l, K2020);  Yg = Y^g;  ramp = ((Yg - k) / (1 - k))_+^p
//   N   = W * Yg * (1 + (P / W - 1) * ramp)            nits; SDR white lands on P = 1000 nits
//   rgb = l * N / Y;  Yo = dot(rgb, K2020);  rgb = max(Yo + (rgb - Yo) * sat, 0)
//   -> HLG (ITU-R BT.2100, 1000-nit reference display, system gamma 1.2) -> BT.2020 non-constant-luminance Y'CbCr, limited range.
// Vivid = "R250" (the default; fitted to Josh's reference HDR clip, Oct 31: "R250 is the call"); Bright = "W550" (Oct 30: "The W550+dither
// looks good"). HLG only: it is royalty-free (BBC / NHK; ITU-R BT.2100, ARIB STD-B67). No PQ / HDR10.
// 8-bit output (Safari cannot build 10-bit VideoFrames) gets a still blue-noise dither of +-1 code value (triangular) before the rounding.

export const PEAK_NITS = 1000;
export const SDR_WHITE_NITS = 203;   // HLG reference white (ITU-R BT.2408): SDR white in a picture's gain map
export const LOOKS = Object.freeze({
  vivid: Object.freeze({ id: 'vivid', name: 'Vivid', curve: 'R250', W: 249.379, g: 1.0511, k: 0.0179, p: 2.1014, sat: 1.0774,
    line: 'Bright highlights and richer colour; the rest stays as it was.' }),
  bright: Object.freeze({ id: 'bright', name: 'Bright', curve: 'W550', W: 550, g: 1.0432, k: 0.019, p: 1.5654, sat: 1.0363,
    line: 'Lifts the whole picture brighter, with gentle colour.' }),
});
export const DEFAULT_LOOK = 'vivid';
export const lookOf = (id) => LOOKS[id] || LOOKS[DEFAULT_LOOK];
/** HLG, BT.2020, BT.2020 NCL, limited range: ISO/IEC 23091-2 code points (MP4 colr nclx, HEVC VUI) and the WebCodecs names */
export const HLG_CICP = Object.freeze({ primaries: 9, transfer: 18, matrix: 9, fullRange: false });
export const HLG_COLOR_SPACE = Object.freeze({ primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false });
export const DITHER_AMP = 1;   // code values (peak of the triangular dither)

// row-major 3x3, applied as M . v
export const M709to2020 = [[0.627404, 0.329283, 0.043313], [0.069097, 0.919540, 0.011362], [0.016391, 0.088013, 0.895595]];
export const K2020 = [0.2627, 0.6780, 0.0593];
const mul = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** SDR R'G'B' code values (0..1, BT.709, BT.1886) -> linear BT.2020 light (SDR white = 1), clamped at 0 */
export function lin2020(c) {
  const l = mul(M709to2020, c.map((x) => Math.pow(Math.max(x, 1e-10), 2.4)));
  return l.map((x) => Math.max(x, 0));
}
/** a luminance (relative, SDR white = 1) -> nits through the look (sat leaves luminance unchanged) */
export function lookNits(Y, look) {
  const q = typeof look === 'string' ? lookOf(look) : look;
  const y = Math.max(Y, 1e-6), Yg = Math.pow(y, q.g), t = Math.max((Yg - q.k) / (1 - q.k), 0), ramp = t > 0 ? Math.pow(t, q.p) : 0;
  return q.W * Yg * (1 + (PEAK_NITS / q.W - 1) * ramp);
}
/** SDR code values -> linear BT.2020 display light in nits through the look (the shader's curve, in double precision) */
export function curveNits(c, look) {
  const q = typeof look === 'string' ? lookOf(look) : look;
  const l = lin2020(c), Y = Math.max(dot(l, K2020), 1e-6), N = lookNits(Y, q);
  const rgb = l.map((x) => x * (N / Y)), Yo = dot(rgb, K2020);
  return rgb.map((x) => Math.max(Yo + (x - Yo) * q.sat, 0));
}
/** linear BT.2020 nits -> HLG R'G'B' (ITU-R BT.2100 inverse EOTF for a 1000-nit display, system gamma 1.2) */
export function hlgFromNits(n) {
  const fd = n.map((x) => Math.min(Math.max(x / PEAK_NITS, 0), 1)), yd = Math.max(dot(fd, K2020), 1e-6), s = Math.pow(yd, -0.2 / 1.2);
  const a = 0.17883277, b = 0.28466892, cc = 0.55991073;
  return fd.map((x) => { const e = Math.min(Math.max(x * s, 0), 1); return e <= 1 / 12 ? Math.sqrt(3 * e) : a * Math.log(Math.max(12 * e - b, 1e-6)) + cc; });
}
/** HLG R'G'B' -> BT.2020 NCL [Y', Cb, Cr] (Y' 0..1, Cb / Cr -0.5..0.5) */
export function ycc2020(s) { const Y = dot(s, K2020); return [Y, (s[2] - Y) / 1.8814, (s[0] - Y) / 1.4746]; }
export const q8y = (v, n = 0) => Math.min(235, Math.max(16, Math.round(16 + 219 * v + n)));
export const q8c = (v, n = 0) => Math.min(240, Math.max(16, Math.round(128 + 224 * v + n)));

/** a blue-noise rank u in (0, 1) -> triangular (TPDF) noise in [-1, 1] (the shader's mapping) */
export function tpdf(u) { return u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 - 2 * u); }
/** the dither (code values) for plane `salt` (0 = Y, 1 = Cb, 2 = Cr) at (x, y): the still pattern, each plane offset into the tile */
export function ditherAt(bn, x, y, salt, amp = DITHER_AMP, N = 64) {
  const ox = (salt * 23) % N, oy = (salt * 41) % N;
  return tpdf(bn[((y + oy) % N) * N + ((x + ox) % N)]) * amp;
}

function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let BN = null;
/** a 64x64 tileable blue-noise threshold map (Ulichney's void-and-cluster, toroidal Gaussian sigma 1.5, seeded): every rank once, so the
 *  histogram is exactly flat and the noise has almost no low-frequency energy. Float32Array N*N of (rank + 0.5) / N^2. Made once a page. */
export function blueNoise(N = 64, sigma = 1.5, seed = 7) {
  if (N === 64 && sigma === 1.5 && seed === 7 && BN) return BN;
  const n = N * N, K = new Float32Array(n);
  for (let dy = 0; dy < N; dy++) for (let dx = 0; dx < N; dx++) { const ax = Math.min(dx, N - dx), ay = Math.min(dy, N - dy); K[dy * N + dx] = Math.exp(-(ax * ax + ay * ay) / (2 * sigma * sigma)); }
  const E = new Float32Array(n), B = new Uint8Array(n);
  const splat = (E, i, s) => { const iy = (i / N) | 0, ix = i % N; for (let y = 0; y < N; y++) { const ky = ((y - iy + N) % N) * N, row = y * N; for (let x = 0; x < N; x++) E[row + x] += s * K[ky + ((x - ix + N) % N)]; } };
  const tightest = (E, B) => { let best = -1, v = -Infinity; for (let i = 0; i < n; i++) if (B[i] && E[i] > v) { v = E[i]; best = i; } return best; };
  const largestVoid = (E, B) => { let best = -1, v = Infinity; for (let i = 0; i < n; i++) if (!B[i] && E[i] < v) { v = E[i]; best = i; } return best; };
  const r = rng(seed), ones = Math.max(1, Math.floor(n * 0.1));
  for (let k = 0; k < ones;) { const i = Math.floor(r() * n); if (!B[i]) { B[i] = 1; splat(E, i, 1); k++; } }
  for (let guard = 0; guard < 4 * n; guard++) {
    const c = tightest(E, B); B[c] = 0; splat(E, c, -1);
    const v = largestVoid(E, B);
    if (v === c) { B[c] = 1; splat(E, c, 1); break; }
    B[v] = 1; splat(E, v, 1);
  }
  const rank = new Int32Array(n).fill(-1);
  { const B1 = B.slice(), E1 = E.slice(); for (let k = ones - 1; k >= 0; k--) { const c = tightest(E1, B1); rank[c] = k; B1[c] = 0; splat(E1, c, -1); } }
  for (let k = ones; k < n; k++) { const v = largestVoid(E, B); rank[v] = k; B[v] = 1; splat(E, v, 1); }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rank[i] + 0.5) / n;
  if (N === 64 && sigma === 1.5 && seed === 7) BN = out;
  return out;
}

/** CPU reference of one frame (the GPU kernel's maths, for tests and the desk check): RGBA bytes (w x h) -> I420 bytes with the look and
 *  the still dither (bn = blueNoise(), or null for none). w and h even. */
export function frameToI420(rgba, w, h, look, bn = null) {
  const q = typeof look === 'string' ? lookOf(look) : look, out = new Uint8Array((w * h * 3) / 2), cw = w / 2;
  const sig = (x, y) => { const o = (y * w + x) * 4; return ycc2020(hlgFromNits(curveNits([rgba[o] / 255, rgba[o + 1] / 255, rgba[o + 2] / 255], q))); };
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    let cb = 0, cr = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const v = sig(x + dx, y + dy); out[(y + dy) * w + x + dx] = q8y(v[0], bn ? ditherAt(bn, x + dx, y + dy, 0) : 0); cb += v[1]; cr += v[2];
    }
    const cx = x / 2, cy = y / 2, co = cy * cw + cx;
    out[w * h + co] = q8c(cb / 4, bn ? ditherAt(bn, cx, cy, 1) : 0);
    out[w * h + (w * h) / 4 + co] = q8c(cr / 4, bn ? ditherAt(bn, cx, cy, 2) : 0);
  }
  return out;
}
/** a bitrate for an 8-bit HLG clip: the probe's 8 Mb/s at 832 x 480 x 16 fps (the dither costs ~1 % in size), by pixels and frame rate */
export function hdrBitrate(w, h, fps = 16) {
  return Math.round(Math.min(16e6, Math.max(3e6, 8e6 * ((w * h) / (832 * 480)) * (fps / 16))));
}
/** the HEVC Main level for a size: 3.1 up to 983,040 luma samples, 4 up to 2,228,224, else 5 (level_idc x 30) */
export const hevcLevel = (w, h) => (w * h <= 983040 ? 93 : w * h <= 2228224 ? 120 : 150);
