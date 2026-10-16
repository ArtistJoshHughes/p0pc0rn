// CPU (plain JS) image steps of MuseTalk's crop / paste-back, written to match the official library calls:
//  cv2.resize INTER_LANCZOS4 (8-tap, coefficients fixed point x2048, clamp-to-edge taps, (sum + 2^21) >> 22)   crop -> 256x256
//  cv2.resize INTER_LINEAR   (2-tap fixed point, edge clamp)                                                     256 -> box size
//  PIL Image.paste(im, box, mask 'L')  out = DIV255(out * (255 - m) + in * m)                                    blend
//  cv2.GaussianBlur(mask, (k, k), 0)   sigma = 0.3 ((k - 1) / 2 - 1) + 0.8, BORDER_REFLECT_101, rounded
// plus the blend MASK built from the MediaPipe mesh (replacement for BiSeNet 'jaw' parsing, same post-rules: downward cone dilation,
// cheek erosion outside a +-90 px band at the 512 parsing scale, nose excluded, lips added, lower half of the expanded box only).
'use strict';

// ------------------------------------------------------------------ cv2.resize (8U, C channels interleaved)
function lanczosCoeffs(x) {
  const s45 = 0.70710678118654752440084436210485, cs = [[1, 0], [-s45, -s45], [0, 1], [s45, -s45], [-1, 0], [s45, s45], [0, -1], [-s45, s45]];
  const f = Math.fround, c = new Float32Array(8);
  let sum = 0; const y0 = -(x + 3) * Math.PI * 0.25, s0 = Math.sin(y0), c0 = Math.cos(y0);
  for (let i = 0; i < 8; i++) {
    const y0_ = f(x + 3 - i);
    if (Math.abs(y0_) >= 1e-6) { const y = -y0_ * Math.PI * 0.25; c[i] = f((cs[i][0] * s0 + cs[i][1] * c0) / (y * y)); } else c[i] = 1e30;
    sum = f(sum + c[i]);
  }
  sum = f(1 / sum); for (let i = 0; i < 8; i++) c[i] = f(c[i] * sum);
  return c;
}
const sat16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));   // saturate_cast<short> (cvRound: half away from zero -> Math.round differs only at exact .5)
function tables(sIn, sOut, kind) {
  const scale = sIn / sOut, ks = kind === 'lanczos' ? 8 : 2, ofs = new Int32Array(sOut), al = new Int16Array(sOut * ks);
  for (let d = 0; d < sOut; d++) {
    let fx = Math.fround((d + 0.5) * scale - 0.5), sx = Math.floor(fx); fx = Math.fround(fx - sx);
    if (kind === 'linear') { if (sx < 0) { fx = 0; sx = 0; } if (sx >= sIn - 1) { fx = 0; sx = sIn - 1; } }
    ofs[d] = sx;
    const c = kind === 'lanczos' ? lanczosCoeffs(fx) : [Math.fround(1 - fx), fx];
    for (let k = 0; k < ks; k++) al[d * ks + k] = sat16(c[k] * 2048);
  }
  return { ofs, al, ks };
}
/** src Uint8 [h][w][C] -> dst Uint8 [H][W][C]; kind 'lanczos' | 'linear' (cv2 fixed-point paths) */
export function cvResize(src, w, h, W, H, C, kind) {
  const tx = tables(w, W, kind), ty = tables(h, H, kind), ks = tx.ks, k2 = ks / 2;
  const rows = new Map();
  const hrow = (y) => {   // horizontal pass of source row y -> Int32 [W*C]
    let r = rows.get(y); if (r) return r;
    r = new Int32Array(W * C);
    for (let d = 0; d < W; d++) {
      const sx = tx.ofs[d];
      for (let c = 0; c < C; c++) {
        let s = 0;
        for (let k = 0; k < ks; k++) { let xx = sx + k - k2 + 1; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; s += src[(y * w + xx) * C + c] * tx.al[d * ks + k]; }
        r[d * C + c] = s;
      }
    }
    rows.set(y, r); return r;
  };
  const out = new Uint8Array(W * H * C);
  for (let d = 0; d < H; d++) {
    const sy = ty.ofs[d], rr = [];
    for (let k = 0; k < ks; k++) { let yy = sy + k - k2 + 1; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; rr.push(hrow(yy)); }
    for (let i = 0; i < W * C; i++) {
      let s = 0; for (let k = 0; k < ks; k++) s += rr[k][i] * ty.al[d * ks + k];
      const v = Math.floor((s + (1 << 21)) / (1 << 22));
      out[d * W * C + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    if (rows.size > 16) for (const k of [...rows.keys()]) if (k < sy - k2) rows.delete(k);
  }
  return out;
}

// ------------------------------------------------------------------ crop of a frame (RGBA) -> RGB, LANCZOS4 to 256
export function cropTo256(rgba, W, H, box) {
  const [x1, y1, x2, y2] = box, w = x2 - x1, h = y2 - y1, c = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y1 + y) * W + x1 + x) * 4, d = (y * w + x) * 3; c[d] = rgba[s]; c[d + 1] = rgba[s + 1]; c[d + 2] = rgba[s + 2]; }
  return cvResize(c, w, h, 256, 256, 3, 'lanczos');
}

// ------------------------------------------------------------------ Gaussian blur (uint8, reflect-101)
export function gaussianBlur(m, w, h, k) {
  const sigma = 0.3 * ((k - 1) * 0.5 - 1) + 0.8, r = (k - 1) / 2, ker = new Float64Array(k);
  let s = 0; for (let i = 0; i < k; i++) { const x = i - r; ker[i] = Math.exp(-(x * x) / (2 * sigma * sigma)); s += ker[i]; }
  for (let i = 0; i < k; i++) ker[i] /= s;
  const ref = (i, n) => { if (n === 1) return 0; while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * n - 2 - i; } return i; };
  const tmp = new Float64Array(w * h), out = new Uint8Array(w * h);
  // v002: the reflected indices precomputed per axis (same sums in the same order: bit-identical, several times faster)
  const ix = new Int32Array(w * k), iy = new Int32Array(h * k);
  for (let x = 0; x < w; x++) for (let i = 0; i < k; i++) ix[x * k + i] = ref(x + i - r, w);
  for (let y = 0; y < h; y++) for (let i = 0; i < k; i++) iy[y * k + i] = ref(y + i - r, h) * w;
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let a = 0; const b = x * k; for (let i = 0; i < k; i++) a += ker[i] * m[row + ix[b + i]]; tmp[row + x] = a; } }
  for (let y = 0; y < h; y++) { const b = y * k; for (let x = 0; x < w; x++) { let a = 0; for (let i = 0; i < k; i++) a += ker[i] * tmp[iy[b + i] + x]; out[y * w + x] = Math.max(0, Math.min(255, Math.round(a))); } }
  return out;
}

// ------------------------------------------------------------------ MuseTalk get_crop_box + get_image (paste-back)
export function cropBox(box, expand = 1.5) {
  const [x, y, x1, y1] = box, xc = Math.floor((x + x1) / 2), yc = Math.floor((y + y1) / 2), w = x1 - x, h = y1 - y;
  const s = Math.trunc(Math.floor(Math.max(w, h) / 2) * expand);
  return { cb: [xc - s, yc - s, xc + s, yc + s], s };
}
/** frame RGBA (in place copy returned), gen RGB [256*256*3] decoded crop, box [x1,y1,x2,y2] (v1.5 y2 incl. margin), mask8 Uint8 [2s][2s]
 *  (the final blurred blend mask in crop-box coordinates) -> new RGBA frame */
export function pasteBack(frame, W, H, gen, box, cb, mask8) {
  const [x, y, x1, y1] = box, bw = x1 - x, bh = y1 - y;
  const res = cvResize(gen, 256, 256, bw, bh, 3, 'linear');
  const out = new Uint8Array(frame);
  const S = cb[2] - cb[0];
  for (let yy = Math.max(0, cb[1]); yy < Math.min(H, cb[3]); yy++) for (let xx = Math.max(0, cb[0]); xx < Math.min(W, cb[2]); xx++) {
    const m = mask8[(yy - cb[1]) * S + (xx - cb[0])]; if (!m) continue;
    const inBox = xx >= x && xx < x1 && yy >= y && yy < y1, o = (yy * W + xx) * 4;
    for (let c = 0; c < 3; c++) {
      const fg = inBox ? res[((yy - y) * bw + (xx - x)) * 3 + c] : frame[o + c];
      const t = frame[o + c] * (255 - m) + fg * m + 128; out[o + c] = ((t >> 8) + t) >> 8;
    }
  }
  return out;
}

// ------------------------------------------------------------------ blend mask from the 478-point mesh ('jaw' rules of FaceParsing)
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const NOSE = [168, 193, 245, 188, 174, 236, 198, 209, 49, 64, 98, 97, 2, 326, 327, 294, 279, 429, 420, 456, 399, 412, 465, 417];
const LEYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], REYE = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
function fillPoly(m, S, pts, val) {   // even-odd scanline fill, pixel centres
  const n = pts.length;
  for (let y = 0; y < S; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < n; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n]; if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) * (bx - ax) / (by - ay)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(S - 1, Math.floor(xs[k + 1] - 0.5)); for (let x = a; x <= b; x++) m[y * S + x] = val; }
  }
}
function morph(m, S, ker, kw, kh, dilate) {
  const out = new Uint8Array(S * S), cx = kw >> 1, cy = kh >> 1;
  const offs = []; for (let j = 0; j < kh; j++) for (let i = 0; i < kw; i++) if (ker[j * kw + i]) offs.push([i - cx, j - cy]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = dilate ? 0 : 255;
    for (const [dx, dy] of offs) {
      const xx = dilate ? x - dx : x + dx, yy = dilate ? y - dy : y + dy;   // cv2.dilate uses the reflected kernel anchor convention
      const s = (xx < 0 || yy < 0 || xx >= S || yy >= S) ? (dilate ? 0 : 255) : m[yy * S + xx];
      if (dilate ? s > v : s < v) v = s;
    }
    out[y * S + x] = v;
  }
  return out;
}
/** v002: the same morphology for BINARY masks (0 / 255) in O(rows of the kernel x pixels): each kernel row is one horizontal run, so a
 *  sliding count over the image row replaces the per-offset loop (the cone dilation was ~370 offsets x 512^2 per frame). Exact. */
function runsOf(ker, kw, kh) { const r = []; for (let j = 0; j < kh; j++) { let a = -1, b = -1; for (let i = 0; i < kw; i++) if (ker[j * kw + i]) { if (a < 0) a = i; b = i; } if (a >= 0) r.push([j - (kh >> 1), a - (kw >> 1), b - (kw >> 1)]); } return r; }
function morphBin(m, S, ker, kw, kh, dilate) {
  const runs = runsOf(ker, kw, kh), out = new Uint8Array(S * S).fill(dilate ? 0 : 255), cnt = new Int32Array(S + 1);
  for (const [dy, a, b] of runs) for (let y = 0; y < S; y++) {
    const r = dilate ? y - dy : y + dy; if (r < 0 || r >= S) continue;
    cnt[0] = 0; for (let x = 0; x < S; x++) cnt[x + 1] = cnt[x] + ((dilate ? m[r * S + x] > 0 : m[r * S + x] < 255) ? 1 : 0);
    for (let x = 0; x < S; x++) {
      const lo = Math.max(0, dilate ? x - b : x + a), hi = Math.min(S - 1, dilate ? x - a : x + b);
      if (lo <= hi && cnt[hi + 1] - cnt[lo] > 0) out[y * S + x] = dilate ? 255 : 0;
    }
  }
  return out;
}
export const _morphTest = { morph: (...a) => morph(...a), morphBin, kernels: () => kernels() };
let KER = null;
function kernels() {
  if (KER) return KER;
  const cone = 21, tail = 12, T = cone + tail, k = new Uint8Array(T * T), cx = T >> 1;
  for (let r = 0; r < cone; r++) { if (r < (cone >> 1)) continue; const w = 2 * (r - (cone >> 1)) + 1, s = cx - (w >> 1), e = cx + (w >> 1) + 1; for (let x = s; x < e; x++) k[r * T + x] = 1; }
  let bwid = 0; for (let x = 0; x < T; x++) bwid += k[(cone - 1) * T + x];
  for (let r = cone; r < T; r++) { const s = Math.max(0, cx - (bwid >> 1)), e = Math.min(T, cx + (bwid >> 1) + 1); for (let x = s; x < e; x++) k[r * T + x] = 1; }
  // cv2.getStructuringElement(MORPH_ELLIPSE, (35, 3))
  const ew = 35, eh = 3, el = new Uint8Array(ew * eh), r = eh >> 1, c = ew >> 1, inv = r > 0 ? 1 / (r * r) : 0;
  for (let i = 0; i < eh; i++) { const dy = i - r; let j1 = 0, j2 = 0; if (Math.abs(dy) <= r) { const dx = Math.round(c * Math.sqrt((r * r - dy * dy) * inv)); j1 = Math.max(c - dx, 0); j2 = Math.min(c + dx + 1, ew); } for (let j = j1; j < j2; j++) el[i * ew + j] = 1; }
  return (KER = { cone: k, T, ell: el, ew, eh });
}
/** mesh mask in crop-box coordinates: lm (Float32Array 478*3 image px), cb crop box, box face box -> Uint8 [2s][2s] blurred mask (0..255) */
export function meshMask(lm, cb, box, cheek = 90) {
  const S = cb[2] - cb[0], P = 512, sc = P / S, K = kernels();
  const pt = (i) => [(lm[i * 3] - cb[0]) * sc, (lm[i * 3 + 1] - cb[1]) * sc];
  const skin = new Uint8Array(P * P);
  fillPoly(skin, P, OVAL.map(pt), 255);
  for (const poly of [NOSE, LEYE, REYE]) fillPoly(skin, P, poly.map(pt), 0);
  fillPoly(skin, P, LIPS.map(pt), 0);
  const dil = morphBin(skin, P, K.cone, K.T, K.T, true);   // v002: exact binary fast path (was morph(): same result)
  let ero = morphBin(dil, P, K.ell, K.ew, K.eh, false); ero = morphBin(ero, P, K.ell, K.ew, K.eh, false);
  const nose = new Uint8Array(P * P); fillPoly(nose, P, NOSE.map(pt), 1);
  const lips = new Uint8Array(P * P); fillPoly(lips, P, LIPS.map(pt), 1);
  const c = P >> 1, m512 = new Uint8Array(P * P);
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const i = y * P + x, inCheek = x < c - cheek || x >= c + cheek;   // cheek_mask = 255 outside the central band
    const fr = inCheek ? ero[i] : dil[i];
    if ((fr === 255 && !nose[i]) || lips[i]) m512[i] = 255;
  }
  // back to the crop-box size (bilinear), restricted to the face box, lower half only, blurred
  const m = new Uint8Array(S * S), bx0 = box[0] - cb[0], by0 = box[1] - cb[1], bx1 = box[2] - cb[0], by1 = box[3] - cb[1], top = Math.floor(S * 0.5);
  for (let y = Math.max(top, by0); y < Math.min(S, by1); y++) for (let x = Math.max(0, bx0); x < Math.min(S, bx1); x++) {
    const fx = (x + 0.5) * P / S - 0.5, fy = (y + 0.5) * P / S - 0.5, x0 = Math.max(0, Math.min(P - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(P - 1, Math.floor(fy)));
    const x1 = Math.min(P - 1, x0 + 1), y1 = Math.min(P - 1, y0 + 1), ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0));
    const v = (m512[y0 * P + x0] * (1 - ax) + m512[y0 * P + x1] * ax) * (1 - ay) + (m512[y1 * P + x0] * (1 - ax) + m512[y1 * P + x1] * ax) * ay;
    m[y * S + x] = Math.round(v);
  }
  const k = Math.floor(0.05 * S / 2) * 2 + 1;
  return gaussianBlur(m, S, S, k);
}
/** reference-mask path (parity tests): the golden mask (crop-box sized, already blurred) is used as is */
export const MESH_IDS = { OVAL, LIPS, NOSE, LEYE, REYE };

// ------------------------------------------------------------------ v002 (Josh, Oct 14: "works kinda but very low quality"): a better paste-back
// MuseTalk draws the mouth at 256x256 and the face box (~356x530 on Josh's test) stretches it 1.4x / 2.1x, which blurs it, and its colour can
// step at the seam. pasteBackV2 keeps v001's mask (the lower face only; the upper face stays the original pixels) and adds, inside the face box:
//   1. Lanczos-4 instead of bilinear for the 256 -> box stretch (sharper);
//   2. colour match: the mean colour difference in the feathered seam band is removed from the drawn region (per frame, clamped);
//   3. detail transfer: the original's fine detail (skin, beard; what the stretch lost) is added back where the face does not move - not
//      on the lips / mouth (an ellipse around the mesh's lips, feathered, larger downward for the jaw);
//   4. grain: inside the mouth, noise up to the original's grain level (a seeded generator: no flicker of a fixed pattern).
// Pure JS on the face box only (~0.2 Mpx): ~10-30 ms per frame.
function boxBlur(src, w, h, C, r) {   // two passes of a separable box blur ~ Gaussian sigma ~ r; Float32 [h][w][C]
  if (r < 1) return Float32Array.from(src);
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const pass = (s, d, horiz) => {
    const n = horiz ? w : h, m = horiz ? h : w, k = 2 * r + 1;
    for (let o = 0; o < m; o++) for (let c = 0; c < C; c++) {
      const at = (i) => { const j = i < 0 ? 0 : i >= n ? n - 1 : i; return horiz ? (o * w + j) * C + c : (j * w + o) * C + c; };
      let acc = 0; for (let i = -r; i <= r; i++) acc += s[at(i)];
      for (let i = 0; i < n; i++) { d[at(i)] = acc / k; acc += s[at(i + r + 1)] - s[at(i - r)]; }
    }
  };
  for (let it = 0; it < 2; it++) { pass(a, b, true); pass(b, a, false); }
  return a;
}
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const gauss = (r) => { const u = Math.max(1e-7, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
/** mouth weight (1 on the lips / mouth opening, feathered to 0) over the face box, from the mesh's lips; Float32 [bh][bw].
 *  k = {sx, st, sb, mx, mt, mb, f}: the ellipse's scale of the lips' half-size + margins (fractions of the box) and the feather */
export function mouthWeight(lm, box, k = {}) {
  const K = Object.assign({ sx: 1.35, st: 1.4, sb: 1.4, mx: 0.03, mt: 0.03, mb: 0.09, f: 0.45 }, k);
  const [x, y, x1, y1] = box, bw = x1 - x, bh = y1 - y, wt = new Float32Array(bw * bh);
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, cx = 0, cy = 0;
  for (const i of LIPS) { const px = lm[i * 3], py = lm[i * 3 + 1]; mnx = Math.min(mnx, px); mxx = Math.max(mxx, px); mny = Math.min(mny, py); mxy = Math.max(mxy, py); cx += px; cy += py; }
  cx /= LIPS.length; cy /= LIPS.length;
  const rx = 0.5 * (mxx - mnx) * K.sx + K.mx * bw, rt = (cy - mny) * K.st + K.mt * bh, rb = (mxy - cy) * K.sb + K.mb * bh;
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
    const dx = (x + xx + 0.5 - cx) / rx, dy = (y + yy + 0.5 - cy) / (y + yy + 0.5 < cy ? rt : rb), d = Math.sqrt(dx * dx + dy * dy);
    wt[yy * bw + xx] = d <= 1 ? 1 : d >= 1 + K.f ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (d - 1) / K.f);
  }
  return wt;
}
const CORE = { sx: 1.12, st: 1.2, sb: 1.25, mx: 0.012, mt: 0.008, mb: 0.02, f: 0.35 };   // the lips themselves (+ the opening)
/** v002 paste-back -> {out RGBA frame, stats {shift [r,g,b], grain, sharp (drawn / original fine detail on the lips), keep (mean detail kept)}} */
export function pasteBackV2(frame, W, H, gen, box, cb, mask8, lm, seed = 1, opts = {}) {
  const [x, y, x1, y1] = box, bw = x1 - x, bh = y1 - y, S = cb[2] - cb[0];
  const res = cvResize(gen, 256, 256, bw, bh, 3, 'lanczos');
  const n = bw * bh, orig = new Float32Array(n * 3), drawn = new Float32Array(n * 3), m = new Float32Array(n);
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
    const i = yy * bw + xx, gx = x + xx, gy = y + yy, o = (gy * W + gx) * 4;
    const inF = gx >= 0 && gy >= 0 && gx < W && gy < H, mx = gx - cb[0], my = gy - cb[1];
    m[i] = inF && mx >= 0 && my >= 0 && mx < S && my < S ? mask8[my * S + mx] / 255 : 0;
    for (let c = 0; c < 3; c++) { orig[i * 3 + c] = inF ? frame[o + c] : 0; drawn[i * 3 + c] = res[i * 3 + c]; }
  }
  // 2. colour: the mean difference in the seam band (0.25 < mask < 0.9), removed from the drawn pixels
  const sh = [0, 0, 0]; let nb = 0;
  for (let i = 0; i < n; i++) if (m[i] > 0.25 && m[i] < 0.9) { for (let c = 0; c < 3; c++) sh[c] += orig[i * 3 + c] - drawn[i * 3 + c]; nb++; }
  for (let c = 0; c < 3; c++) sh[c] = nb ? Math.max(-18, Math.min(18, sh[c] / nb)) : 0;
  if (opts.colour !== false) for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) drawn[i * 3 + c] += sh[c];
  // 3. detail: the original's fine detail (orig - blur, at the scale the stretch lost) goes back wherever the drawn face still has the
  //    original's shape (their blurred images agree: cheeks, beard, chin; a dropped jaw does not), never on the lips themselves; the lips
  //    get a mild unsharp mask of their own detail instead
  const core = mouthWeight(lm, box, CORE), r = Math.max(1, Math.round(Math.max(bw, bh) / 256)), R2 = 3 * r;
  const ob = boxBlur(orig, bw, bh, 3, r), db = boxBlur(drawn, bw, bh, 3, r), obB = boxBlur(orig, bw, bh, 3, R2), dbB = boxBlur(drawn, bw, bh, 3, R2);
  let eo = 0, ed = 0, ne = 0, so = 0, nso = 0, kept = 0, nk = 0;
  for (let i = 0; i < n; i++) {
    let diff = 0; for (let c = 0; c < 3; c++) diff += Math.abs(dbB[i * 3 + c] - obB[i * 3 + c]); diff /= 3;
    const same = Math.max(0, Math.min(1, 1 - (diff - 10) / 25));   // 1 up to 10 levels apart, 0 from 35 (moved: an open mouth, a dropped jaw)
    const keep = opts.detail === false ? 0 : 0.95 * (1 - core[i]) * same, lf = opts.detail === false ? 0 : 0.6 * (1 - core[i]) * same;
    if (m[i] > 0.5) { kept += keep; nk++; }
    for (let c = 0; c < 3; c++) {
      const ho = orig[i * 3 + c] - ob[i * 3 + c], hd = drawn[i * 3 + c] - db[i * 3 + c];
      // + the original's detail, + part of its local tone where the shape agrees (MuseTalk lightens a beard), + a mild unsharp on the lips
      drawn[i * 3 + c] += keep * ho + lf * (obB[i * 3 + c] - dbB[i * 3 + c]) + (opts.sharpen === false ? 0 : 0.6 * core[i] * hd);
      if (c === 1 && m[i] > 0.5 && core[i] > 0.5) { eo += ho * ho; ed += hd * hd * 2.56; ne++; }
      if (c === 1 && m[i] > 0.5 && core[i] < 0.05 && keep > 0.5) { so += ho * ho; nso++; }
    }
  }
  // 4. grain on the lips: up to the original's fine-detail level next to them (RMS), capped (it is grain, not texture)
  const sO = nso ? Math.sqrt(so / nso) : 0, sD = ne ? Math.sqrt(ed / ne) : 0, grain = opts.grain === false ? 0 : Math.min(2.5, 0.35 * Math.sqrt(Math.max(0, sO * sO - sD * sD)));
  if (grain > 0.3) { const Rn = rng(seed); for (let i = 0; i < n; i++) if (core[i] > 0 && m[i] > 0) { const g = grain * core[i] * gauss(Rn); for (let c = 0; c < 3; c++) drawn[i * 3 + c] += g; } }
  // composite (PIL paste rounding, as v001)
  const out = new Uint8Array(frame);
  for (let i = 0; i < n; i++) {
    if (!m[i]) continue;
    const gx = x + (i % bw), gy = y + ((i / bw) | 0); if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
    const o = (gy * W + gx) * 4, mm = Math.round(m[i] * 255);
    for (let c = 0; c < 3; c++) { const fg = Math.max(0, Math.min(255, Math.round(drawn[i * 3 + c]))), t = frame[o + c] * (255 - mm) + fg * mm + 128; out[o + c] = ((t >> 8) + t) >> 8; }
  }
  return { out, stats: { shift: sh.map((v) => +v.toFixed(1)), grain: +grain.toFixed(2), sharp: eo > 0 ? +Math.sqrt(ed / eo).toFixed(3) : null, keep: nk ? +(kept / nk).toFixed(2) : 0, r } };
}
/** fine-detail energy ratio of the composited mouth area vs the original (1 = as detailed) for any blend output; luma-ish (green) */
export function mouthSharpness(frame, outF, W, box, lm) {
  const [x, y, x1, y1] = box, bw = x1 - x, bh = y1 - y, mw = mouthWeight(lm, box);
  const H = Math.floor(frame.length / 4 / W);
  const g = (img) => { const a = new Float32Array(bw * bh); for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) { const gx = x + xx, gy = y + yy; a[yy * bw + xx] = gx >= 0 && gy >= 0 && gx < W && gy < H ? img[(gy * W + gx) * 4 + 1] : 0; } return a; };
  const a = g(frame), b = g(outF), r = Math.max(1, Math.round(Math.max(bw, bh) / 256)), ab = boxBlur(a, bw, bh, 1, r), bb = boxBlur(b, bw, bh, 1, r);
  let ea = 0, eb = 0; for (let i = 0; i < bw * bh; i++) if (mw[i] > 0.5) { ea += (a[i] - ab[i]) ** 2; eb += (b[i] - bb[i]) ** 2; }
  return ea > 0 ? Math.sqrt(eb / ea) : null;
}
