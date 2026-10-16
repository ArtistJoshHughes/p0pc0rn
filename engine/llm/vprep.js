// PIL / torchvision-antialias bicubic resize (a = -0.5, fixed point), copied from the audio probe's audio/prep.js resizeAA (verified there
// to match torchvision within 0.003 LSB mean).  The Gemma 4 image processor resizes with torchvision bicubic + antialias on uint8.
'use strict';
const PREC = 22;
function bicubic(x) { const a = -0.5; x = Math.abs(x); if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1; if (x < 2) return (((x - 5) * x + 8) * x - 4) * a; return 0; }
function coeffs(inSize, outSize, i0 = 0, i1 = inSize) {
  const scale = (i1 - i0) / outSize, fs = Math.max(scale, 1.0), support = 2 * fs;
  const ksize = Math.ceil(support) * 2 + 1, bounds = new Int32Array(outSize * 2), kk = new Int32Array(outSize * ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = i0 + (xx + 0.5) * scale, ss = 1.0 / fs;
    let xmin = Math.trunc(center - support + 0.5); if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5); if (xmax > inSize) xmax = inSize; xmax -= xmin;
    const k = new Float64Array(ksize); let ww = 0;
    for (let x = 0; x < xmax; x++) { const w = bicubic((x + xmin - center + 0.5) * ss); k[x] = w; ww += w; }
    for (let x = 0; x < xmax; x++) { const v = ww !== 0 ? k[x] / ww : k[x]; kk[xx * ksize + x] = Math.trunc(v * (1 << PREC) + (v < 0 ? -0.5 : 0.5)); }
    bounds[xx * 2] = xmin; bounds[xx * 2 + 1] = xmax;
  }
  return { ksize, bounds, kk };
}
const clip8 = (v) => { const x = v >> PREC; return x < 0 ? 0 : x > 255 ? 255 : x; };
/** src RGBA (or RGB with ch=3) uint8 [h][w][ch] -> planar uint8 [3][H][W]; horizontal pass first, then vertical (PIL order) */
export function resizeAA(src, w, h, W, H, ch = 4) {
  const hc = coeffs(w, W), vc = coeffs(h, H), tmp = new Uint8Array(h * W * 3), out = new Uint8Array(3 * H * W), half = 1 << (PREC - 1);
  if (W === w) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) tmp[(y * W + x) * 3 + c] = src[(y * w + x) * ch + c]; }
  else for (let y = 0; y < h; y++) for (let xx = 0; xx < W; xx++) {
    const xmin = hc.bounds[xx * 2], xmax = hc.bounds[xx * 2 + 1], kb = xx * hc.ksize;
    for (let c = 0; c < 3; c++) { let s = half; for (let x = 0; x < xmax; x++) s += src[(y * w + xmin + x) * ch + c] * hc.kk[kb + x]; tmp[(y * W + xx) * 3 + c] = clip8(s); }
  }
  for (let yy = 0; yy < H; yy++) {
    const ymin = vc.bounds[yy * 2], ymax = vc.bounds[yy * 2 + 1], kb = yy * vc.ksize;
    for (let xx = 0; xx < W; xx++) for (let c = 0; c < 3; c++) {
      let s = half; for (let y = 0; y < ymax; y++) s += tmp[((ymin + y) * W + xx) * 3 + c] * vc.kk[kb + y];
      out[(c * H + yy) * W + xx] = H === h ? tmp[(yy * W + xx) * 3 + c] : clip8(s);
    }
  }
  return out;
}
