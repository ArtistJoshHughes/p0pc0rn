// Face detection + 478-point landmarks with the MediaPipe models (Apache-2.0) on the engine's WGSL interpreter (tfl.js), replacing
// MuseTalk's S3FD (unclear licence) + DWPose (57 M params on a whole-frame squash).  MediaPipe's own rules are mirrored:
//  - BlazeFace short-range: 128x128 letterbox, [-1, 1], 896 SSD anchors (4 layers, strides 8/16/16/16, fixed size), sigmoid score with
//    clipping 100, box / 6 keypoints decoded with scale 128, weighted NMS 0.3; best face kept.
//  - Face Landmarker ROI: detection box, rotation from the eye keypoints (0 -> 1) to 0 deg, x1.5, square on the long side; refined once
//    from the first landmarks (all 478 points, rotation from points 33 -> 263, x1.5 square) like MediaPipe's tracking path.
//  - landmark model: 256x256 crop in [0, 1] (bilinear, clamp-to-edge), 478 x (x, y, z) in crop pixels -> image pixels.
// Then MuseTalk's crop box: the DWPose quantities (x-min, x-max, y-max of the 68 face points, y of point 29) are mapped from mesh points
// with constants measured on calibration clips (lipsync/calib.json via the pack manifest, tools/ls_calib.py).
'use strict';
import { TflGraph, warp } from './tfl.js';

let ANCH = null;
function anchors() {   // SsdAnchorsCalculator, face_detection_short_range options
  if (ANCH) return ANCH;
  const strides = [8, 16, 16, 16], out = [];
  let l = 0;
  while (l < strides.length) {
    let n = 0; const s = strides[l];
    while (l < strides.length && strides[l] === s) { n += 2; l++; }   // aspect 1.0 + interpolated scale -> 2 anchors per layer
    const fm = Math.ceil(128 / s);
    for (let y = 0; y < fm; y++) for (let x = 0; x < fm; x++) for (let k = 0; k < n; k++) out.push([(x + 0.5) / fm, (y + 0.5) / fm]);
  }
  return (ANCH = out);
}
const sig = (x) => 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, x))));
function iou(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-12);
}
/** raw regressors [896*16] + scores [896] (one image, 128 letterbox) -> best detection {box [x0,y0,x1,y1], kp [[x,y]x6], score} in 128-space, or null */
export function decodeBlaze(reg, sc, minScore = 0.5) {
  const A = anchors(), cand = [];
  for (let i = 0; i < 896; i++) {
    const s = sig(sc[i]); if (s < minScore) continue;
    const r = reg.subarray(i * 16, i * 16 + 16), ax = A[i][0], ay = A[i][1];
    const cx = r[0] / 128 + ax, cy = r[1] / 128 + ay, w = r[2] / 128, h = r[3] / 128;
    const kp = []; for (let k = 0; k < 6; k++) kp.push([r[4 + 2 * k] / 128 + ax, r[5 + 2 * k] / 128 + ay]);
    cand.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], kp, score: s });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => b.score - a.score);
  // weighted NMS (MediaPipe NonMaxSuppressionCalculator, WEIGHTED, overlap 0.3): blend the top cluster
  const top = cand[0], cl = cand.filter((c) => iou(c.box, top.box) > 0.3);
  let ws = 0; const box = [0, 0, 0, 0], kp = top.kp.map(() => [0, 0]);
  for (const c of cl) { ws += c.score; for (let j = 0; j < 4; j++) box[j] += c.box[j] * c.score; c.kp.forEach((p, k) => { kp[k][0] += p[0] * c.score; kp[k][1] += p[1] * c.score; }); }
  return { box: box.map((v) => v / ws), kp: kp.map(([x, y]) => [x / ws, y / ws]), score: top.score, n: cl.length };
}
/** rotated square ROI {cx, cy, size, rot} (pixels) -> affine taking 256-crop pixel centres to source pixels */
export function roiAffine(roi, S = 256) {
  const c = Math.cos(roi.rot), s = Math.sin(roi.rot), k = roi.size / S;
  // source = centre + R * ((o - S/2) * k)
  return [c * k, -s * k, roi.cx - (c * S / 2 - s * S / 2) * k, s * k, c * k, roi.cy - (s * S / 2 + c * S / 2) * k];
}
const normAng = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
/** detection (image pixels) -> ROI: rotation from kp0 (right eye) to kp1 (left eye), box x1.5 square-long */
export function roiFromDet(d) {
  const [x0, y0, x1, y1] = d.box, rot = normAng(0 - Math.atan2(-(d.kp[1][1] - d.kp[0][1]), d.kp[1][0] - d.kp[0][0]));
  const w = x1 - x0, h = y1 - y0;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(w, h) * 1.5, rot };
}
/** landmarks [478][3] image pixels -> ROI (MediaPipe face_landmarks_to_roi: bbox of all points in the rotated frame, rotation 33 -> 263, x1.5 square) */
export function roiFromLm(lm) {
  const rot = normAng(0 - Math.atan2(-(lm[263 * 3 + 1] - lm[33 * 3 + 1]), lm[263 * 3] - lm[33 * 3]));
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let i = 0; i < 478; i++) { const x = lm[i * 3], y = lm[i * 3 + 1]; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
  // MediaPipe computes the axis-aligned bbox in the image, centre from it, size from the rotated extent; for small rotations the
  // axis-aligned box is what DetectionsToRects uses (rotation applied afterwards)
  const w = mxx - mnx, h = mxy - mny;
  return { cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, size: Math.max(w, h) * 1.5, rot };
}

/** MuseTalk crop box from 478 landmarks: the DWPose quantities from mesh points (calibrated constants), v1.5 rules, clamped */
export function museBox(lm, W, H, cal) {
  const X = (i) => lm[i * 3], Y = (i) => lm[i * 3 + 1];
  const pick = (ids, f, red) => ids.reduce((m, i) => red(m, f(i)), red === Math.min ? Infinity : -Infinity);
  const fw = X(454) - X(234), fh = Y(152) - Y(10);
  let xmin = pick(cal.jaw, X, Math.min) + cal.dxmin * fw, xmax = pick(cal.jaw, X, Math.max) + cal.dxmax * fw;
  let ymax = pick(cal.jaw, Y, Math.max) + cal.dymax * fh;
  const y29 = Y(cal.n29[0]) + cal.n29[2] * (Y(cal.n29[1]) - Y(cal.n29[0])) + cal.dy29 * fh;
  // MuseTalk: landmarks cast to int32 (truncation), y1 = max(0, y29 - (ymax - y29)), v1.5: y2 += 10 (clamped)
  const ix = (v) => Math.trunc(v);
  const x1 = ix(xmin), x2 = ix(xmax), y2i = ix(ymax), y29i = ix(y29);
  const y1 = Math.max(0, y29i - (y2i - y29i));
  return { box: [Math.max(0, x1), y1, Math.min(W, x2), Math.min(H, y2i + 10)], raw: [xmin, y1, xmax, ymax], y29 };
}

export class FaceTracker {
  /** store shards 'face.blazeface' / 'face.facemesh' + graph files */
  constructor(gpu, store) { this.g = gpu; this.s = store; }
  async load() {
    const dec = new TextDecoder();
    this.gB = JSON.parse(dec.decode(await this.s.readFile('graph.blazeface')));
    this.gM = JSON.parse(dec.decode(await this.s.readFile('graph.facemesh')));
    this.shB = await this.s.upload('face.blazeface'); this.shM = await this.s.upload('face.facemesh');
    const v = (sh, n, d) => { const t = sh.t(n); return { buf: t.buf, off: t.off / d }; };
    this.blaze = new TflGraph(this.g, this.gB, v(this.shB, 'blazeface.w16', 2), v(this.shB, 'blazeface.w32', 4));
    this.mesh = new TflGraph(this.g, this.gM, v(this.shM, 'facemesh.w16', 2), v(this.shM, 'facemesh.w32', 4));
  }
  unload() { this.s.release(this.shB); this.s.release(this.shM); this.shB = this.shM = null; }
  /** frames: [{rgba: Uint8Array, W, H}] (a batch) -> [{det, roi, lm (Float32Array 478*3 image px), presence}] */
  async process(frames, opts = {}) {
    const g = this.g, N = frames.length, W = frames[0].W, H = frames[0].H;
    const ims = frames.map((f) => g.upload(new Uint32Array(f.rgba.buffer, f.rgba.byteOffset, W * H), 'face.im'));
    try {
      // 1) BlazeFace on a 128 letterbox of each frame
      const s = Math.max(W, H) / 128, ox = (128 - W / s) / 2, oy = (128 - H / s) / 2;
      const inB = g.buffer(N * 128 * 128 * 3 * 4, 'face.in128');
      ims.forEach((im, i) => warp(g, im, W, H, inB, i, 128, [s, 0, -ox * s, 0, s, -oy * s], -1, 1, 1));
      const ob = this.blaze.run(inB, N); g.runner.flush(); g.free(inB);
      const [rT, sT] = this.gB.outputs;
      const reg = new Float32Array(await g.read(ob.get(rT), 0, N * 896 * 16 * 4)), sc = new Float32Array(await g.read(ob.get(sT), 0, N * 896 * 4));
      for (const b of ob.values()) g.free(b);
      const res = [];
      for (let i = 0; i < N; i++) {
        const d = decodeBlaze(reg.subarray(i * 896 * 16, (i + 1) * 896 * 16), sc.subarray(i * 896, (i + 1) * 896));
        if (!d) { res.push({ det: null }); continue; }
        const toImg = ([x, y]) => [(x * 128 - ox) * s, (y * 128 - oy) * s];
        const box = [...toImg([d.box[0], d.box[1]]), ...toImg([d.box[2], d.box[3]])];
        res.push({ det: { box, kp: d.kp.map(toImg), score: d.score } });
      }
      // 2) landmarks from the detection ROI, 3) refined once from the landmark ROI (MediaPipe tracking rule)
      const passes = opts.passes || 2;
      for (let pass = 0; pass < passes; pass++) {
        const idx = res.map((r, i) => (r.det ? i : -1)).filter((i) => i >= 0); if (!idx.length) break;
        const inM = g.buffer(idx.length * 256 * 256 * 3 * 4, 'face.in256');
        idx.forEach((fi, k) => { const r = res[fi]; r.roi = pass === 0 ? roiFromDet(r.det) : roiFromLm(r.lm); warp(g, ims[fi], W, H, inM, k, 256, roiAffine(r.roi), 0, 1, 0); });
        const om = this.mesh.run(inM, idx.length); g.runner.flush(); g.free(inM);
        const [lT, fT, pT] = this.gM.outputs;
        const lm = new Float32Array(await g.read(om.get(lT), 0, idx.length * 1434 * 4)), fl = new Float32Array(await g.read(om.get(fT), 0, idx.length * 4));
        for (const b of om.values()) g.free(b);
        idx.forEach((fi, k) => {
          const r = res[fi], A = roiAffine(r.roi), L = new Float32Array(1434), zs = r.roi.size / 256;
          for (let j = 0; j < 478; j++) { const u = lm[k * 1434 + j * 3], v = lm[k * 1434 + j * 3 + 1];
            L[j * 3] = A[0] * u + A[1] * v + A[2]; L[j * 3 + 1] = A[3] * u + A[4] * v + A[5]; L[j * 3 + 2] = lm[k * 1434 + j * 3 + 2] * zs; }
          r.lm = L; r.presence = 1 / (1 + Math.exp(-fl[k])); r.raw256 = opts.keepRaw ? lm.slice(k * 1434, (k + 1) * 1434) : undefined;
        });
        if (opts.check) opts.check();
      }
      return res;
    } finally { g.runner.flush(); ims.forEach((b) => g.free(b)); }
  }
}
