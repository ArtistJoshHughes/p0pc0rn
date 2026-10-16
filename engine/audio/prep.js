// Pocket Audio CPU-side preparation: MMAudio's frame selection (av_utils.read_frames), torchvision's antialiased bicubic resize for uint8
// (PIL ImagingResample: separable, horizontal then vertical, 22-bit fixed-point coefficients, uint8 between passes), the CLIP and
// Synchformer im2col (f16), and torch's CPU randn (mt19937 + normal_fill_16) so a seed reproduces the reference noise.
'use strict';
import { f2h } from '../core/gpu.js';

// ------------------------------------------------------------------ frame selection (float64 accumulation exactly like the Python loop)
/** times: frame timestamps (s, ascending); returns {clip: [src index], sync: [src index], duration} for MMAudio's 8 / 25 fps, max dur */
export function selectFrames(times, maxDur = 8.0) {
  const fps = [8.0, 25.0], next = [0.0, 0.0], dt = fps.map((f) => 1 / f), out = [[], []];
  for (let i = 0; i < times.length; i++) {
    const t = times[i]; if (t > maxDur) break;
    for (let k = 0; k < 2; k++) while (t >= next[k]) { out[k].push(i); next[k] += dt[k]; }
  }
  let dur = maxDur;
  if (out[0].length / 8.0 < dur) dur = out[0].length / 8.0;
  if (out[1].length / 25.0 < dur) dur = out[1].length / 25.0;
  const clip = out[0].slice(0, Math.floor(8.0 * dur)), sync = out[1].slice(0, Math.floor(25.0 * dur));
  return { clip, sync, duration: dur };
}
export function seqLens(dur) {   // MMAudio SequenceConfig (44.1 kHz)
  const latent = Math.ceil(dur * 44100 / 512 / 2), clip = Math.floor(dur * 8), nf = dur * 25, segs = Math.floor((nf - 16) / 8) + 1;
  return { latent, clip, segs, sync: segs * 8, mel: 2 * latent, samples: 2 * latent * 512 };
}

// ------------------------------------------------------------------ PIL-style antialiased bicubic resize (uint8, RGB planar out)
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
/** MMAudio clip transform: Resize((384, 384)) (squash).  sync transform: Resize(224) on the short side + CenterCrop(224) */
export function clipFrame(rgba, w, h, ch = 4) { return resizeAA(rgba, w, h, 384, 384, ch); }
export function syncFrame(rgba, w, h, ch = 4) {
  let W, H; if (w <= h) { W = 224; H = Math.floor(224 * h / w); } else { H = 224; W = Math.floor(224 * w / h); }
  const r = resizeAA(rgba, w, h, W, H, ch), top = Math.round((H - 224) / 2), left = Math.round((W - 224) / 2), o = new Uint8Array(3 * 224 * 224);
  for (let c = 0; c < 3; c++) for (let y = 0; y < 224; y++) o.set(r.subarray((c * H + top + y) * W + left, (c * H + top + y) * W + left + 224), (c * 224 + y) * 224);
  return o;
}

// ------------------------------------------------------------------ im2col (f16), with the network input normalisation folded in
const F16 = (() => { const t = new Uint16Array(256 * 3 * 2); return t; })();
export function clipIm2col(u8) {   // [3][384][384] uint8 -> [729][608] f16 (c, ky, kx), K 588 padded to 608; pixels >= 378 unused (stride-14 conv)
  const mean = [0.48145466, 0.4578275, 0.40821073], std = [0.26862954, 0.26130258, 0.27577711];
  const lut = []; for (let c = 0; c < 3; c++) { const l = new Uint16Array(256); for (let v = 0; v < 256; v++) l[v] = f2h((v / 255 - mean[c]) / std[c]); lut.push(l); }
  const o = new Uint16Array(729 * 608);
  for (let py = 0; py < 27; py++) for (let px = 0; px < 27; px++) {
    const r = (py * 27 + px) * 608;
    for (let c = 0; c < 3; c++) for (let ky = 0; ky < 14; ky++) {
      const sb = (c * 384 + py * 14 + ky) * 384 + px * 14, ob = r + c * 196 + ky * 14, l = lut[c];
      for (let kx = 0; kx < 14; kx++) o[ob + kx] = l[u8[sb + kx]];
    }
  }
  return o;
}
export function syncIm2col(frames, s) {   // frames: [N] uint8 [3][224][224]; segment s = frames 8s .. 8s+15 -> [1568][1536] f16 (c, kt, ky, kx)
  const lut = new Uint16Array(256); for (let v = 0; v < 256; v++) lut[v] = f2h((v / 255 - 0.5) / 0.5);
  const o = new Uint16Array(1568 * 1536);
  for (let tt = 0; tt < 8; tt++) for (let ty = 0; ty < 14; ty++) for (let tx = 0; tx < 14; tx++) {
    const r = (tt * 196 + ty * 14 + tx) * 1536;
    for (let kt = 0; kt < 2; kt++) {
      const f = frames[s * 8 + tt * 2 + kt];
      for (let c = 0; c < 3; c++) for (let ky = 0; ky < 16; ky++) {
        const sb = (c * 224 + ty * 16 + ky) * 224 + tx * 16, ob = r + c * 512 + kt * 256 + ky * 16;
        for (let kx = 0; kx < 16; kx++) o[ob + kx] = lut[f[sb + kx]];
      }
    }
  }
  return o;
}

// ------------------------------------------------------------------ torch.randn on a CPU generator (mt19937, normal_fill_16 for n >= 16)
class MT19937 {
  constructor(seed) { this.mt = new Uint32Array(624); this.i = 624; this.mt[0] = seed >>> 0; for (let i = 1; i < 624; i++) { const p = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30); this.mt[i] = (Math.imul(1812433253, p) + i) >>> 0; } }
  next() {
    const mt = this.mt;
    if (this.i >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.i = 0;
    }
    let y = mt[this.i++]; y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18; return y >>> 0;
  }
}
export function torchRandn(n, seed) {
  const f = Math.fround, g = new MT19937(seed), d = new Float32Array(n);
  const uni = () => f((g.next() & 0xffffff) * (1 / 16777216));
  const fill16 = (o) => { for (let j = 0; j < 8; j++) { const u1 = f(1 - d[o + j]), u2 = d[o + j + 8]; const r = f(Math.sqrt(f(-2 * f(Math.log(u1))))), th = f(f(2 * Math.PI) * u2);
    d[o + j] = f(r * f(Math.cos(th))); d[o + j + 8] = f(r * f(Math.sin(th))); } };
  if (n < 16) throw new Error('torchRandn: n < 16 uses the scalar path (not needed here)');
  for (let i = 0; i < n; i++) d[i] = uni();
  for (let i = 0; i + 16 <= n; i += 16) fill16(i);
  if (n % 16) { for (let i = n - 16; i < n; i++) d[i] = uni(); fill16(n - 16); }
  return d;
}
