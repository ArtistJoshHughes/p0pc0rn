// blaze.js - p0pc0rn Cast: find the face in a photo on this phone (MediaPipe BlazeFace short-range, Apache-2.0, on the engine's WGSL
// graph runner tfl.js - the same weights and decoding as the lip-sync probe v002, engine/lipsync/face.js), then the Cast crop
// ("hair to below the chin, a little either side" so Klein takes the likeness and nothing else;
// Josh: "Face crops miss the bottom of my chin?" -> the bottom at y + 1.38 h). No face found -> the photo unchanged.
// The weights (207 KB) and the graph (21 KB) ship in this folder; a small GPU device lives only for one detection.
'use strict';
import { createGpu } from '../core/gpu.js';
import { TflGraph, warp } from './tfl.js';

const W16_OFF = 0, W32_BYTE = 198656;   // blazeface.w16 (f16, elements) / blazeface.w32 (f32, byte offset) in blazeface.pfw (the lip-sync pack's manifest)
let ANCH = null;
function anchors() {   // SsdAnchorsCalculator, face_detection_short_range options
  if (ANCH) return ANCH;
  const strides = [8, 16, 16, 16], out = [];
  let l = 0;
  while (l < strides.length) {
    let n = 0; const s = strides[l];
    while (l < strides.length && strides[l] === s) { n += 2; l++; }
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
/** raw regressors [896*16] + scores [896] (128 letterbox) -> the best face {box [x0,y0,x1,y1], score} in 0..1 of the letterbox, or null */
export function decodeBlaze(reg, sc, minScore = 0.5) {
  const A = anchors(), cand = [];
  for (let i = 0; i < 896; i++) {
    const s = sig(sc[i]); if (s < minScore) continue;
    const r = reg.subarray(i * 16, i * 16 + 16), ax = A[i][0], ay = A[i][1];
    const cx = r[0] / 128 + ax, cy = r[1] / 128 + ay, w = r[2] / 128, h = r[3] / 128;
    cand.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], score: s });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => b.score - a.score);
  const top = cand[0], cl = cand.filter((c) => iou(c.box, top.box) > 0.3);   // weighted NMS (MediaPipe WEIGHTED, overlap 0.3)
  let ws = 0; const box = [0, 0, 0, 0];
  for (const c of cl) { ws += c.score; for (let j = 0; j < 4; j++) box[j] += c.box[j] * c.score; }
  return { box: box.map((v) => v / ws), score: top.score };
}
/** the Cast crop of a face box (image px) -> [x0, y0, x1, y1] clamped: 25 % of the width either side, 30 % of the height above (hair),
 *  38 % below (the chin) */
export function castCrop(box, W, H) {
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0, m = w * 0.25;
  return [Math.max(0, Math.round(x0 - m)), Math.max(0, Math.round(y0 - h * 0.30)), Math.min(W, Math.round(x1 + m)), Math.min(H, Math.round(y1 + h * 0.38))];
}
let PACK = null;
async function pack(base) {
  if (PACK) return PACK;
  const [w, g] = await Promise.all([fetch(new URL('blazeface.pfw', base)).then((r) => { if (!r.ok) throw new Error('blazeface.pfw ' + r.status); return r.arrayBuffer(); }),
    fetch(new URL('blazeface.graph.json', base)).then((r) => { if (!r.ok) throw new Error('blazeface.graph.json ' + r.status); return r.json(); })]);
  return (PACK = { w, g });
}
/** an image (ImageBitmap / canvas / img) -> {box (image px) or null, score, W, H}. Its own small GPU device, destroyed afterwards. */
export async function findFace(img, { base = new URL('./', import.meta.url) } = {}) {
  const W = img.width, H = img.height, P = await pack(base);
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, W, H);
  const rgba = new Uint32Array(cx.getImageData(0, 0, W, H).data.buffer);
  const g = await createGpu({ wantSubgroups: false, needF16: false });   // v026.9: fp32 kernels only
  try {
    const wb = g.upload(new Uint8Array(P.w), 'blazeface');
    const net = new TflGraph(g, P.g, { buf: wb, off: W16_OFF }, { buf: wb, off: W32_BYTE / 4 });
    const im = g.upload(rgba, 'face.im'), inB = g.buffer(128 * 128 * 3 * 4, 'face.in128');
    const s = Math.max(W, H) / 128, ox = (128 - W / s) / 2, oy = (128 - H / s) / 2;
    warp(g, im, W, H, inB, 0, 128, [s, 0, -ox * s, 0, s, -oy * s], -1, 1, 1);
    const ob = net.run(inB, 1); g.runner.flush();
    const [rT, sT] = P.g.outputs;
    const reg = new Float32Array(await g.read(ob.get(rT), 0, 896 * 16 * 4)), sc = new Float32Array(await g.read(ob.get(sT), 0, 896 * 4));
    const d = decodeBlaze(reg, sc);
    if (!d) return { box: null, score: 0, W, H };
    const toImg = (x, y) => [(x * 128 - ox) * s, (y * 128 - oy) * s], a = toImg(d.box[0], d.box[1]), b = toImg(d.box[2], d.box[3]);
    return { box: [Math.max(0, a[0]), Math.max(0, a[1]), Math.min(W, b[0]), Math.min(H, b[1])], score: d.score, W, H };
  } finally { try { g.freeAll(); g.device.destroy(); } catch (e) { /* */ } }
}
