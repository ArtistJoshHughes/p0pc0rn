// clipposter_core.js - p0pc0rn 3.9: the Library's clip posters, the parts without a page (node-testable). Josh, 10-26: "clip card not
// showing thumbnail with play button". ui/clipthumbs.js is the page side: it decodes a frame of the clip with WebCodecs (a hidden muted
// <video> as the fallback) and stores it as the clip's thumbnail. Here: the poster's size, the MP4's top-level boxes, the video track's
// codec for a VideoDecoder, which samples to decode for a time, how bright a frame is, whether a stored thumbnail is the old dark card or a
// blank frame, and which Library items still need a picture.
'use strict';

export const POSTER_W = 432;      // px wide at most: the Library's picture thumbnails' own rule (util.js makeThumb), crisp in a 3x tile
export const POSTER_Q = 0.82;     // JPEG quality (the Library's other thumbnails use 0.82 too)
export const POSTER_V = 1;        // meta.poster: this thumbnail is a real frame of the clip (made once, reused)
export const MAX_TRIES = 2;       // meta.posterFail: after this many failed tries a clip keeps its card (with the play button)
export const AT = 0.1;            // s: the poster's time
export const DARK = 28;           // mean luma (0-255) under which an opening counts as very dark: then the frame at 25% of the clip
export const LATE = 0.25;         // ... of its length
export const MAX_RUN = 240;       // most samples decoded for one frame (from its keyframe); past that the keyframe itself is the poster
export const MOOV_MAX = 8 << 20;  // a moov box bigger than this is not one of ours (a clip's is a few KB)
// the dark card util.js posterOf drew when it could not get a frame (3.8 and the first 3.9 builds): a diagonal gradient between these
export const OLD_CARD = [[0x2a, 0x25, 0x40], [0x12, 0x12, 0x16]];

export const isClip = (m) => !!m && m.media === 'video';
export const isSong = (m) => !!m && m.media === 'audio';

/** the poster's [width, height]: the clip's shape, at most POSTER_W wide (never larger than the clip), as a picture's thumbnail */
export function posterSize(w, h, maxW = POSTER_W) {
  w = Number(w) > 0 ? Number(w) : 832; h = Number(h) > 0 ? Number(h) : 480;
  const s = Math.min(1, maxW / w);
  return [Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s))];
}

/** one ISO BMFF box header from the bytes at a box's start (16 are enough) -> {type, size, hdr} (size 0 = to the end), or null */
export function boxHead(u8, fileSize, at) {
  if (!u8 || u8.length < 8) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let size = dv.getUint32(0), hdr = 8;
  const type = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
  if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
  if (size === 1) { if (u8.length < 16) return null; size = Number(dv.getBigUint64(8)); hdr = 16; }
  else if (size === 0) size = fileSize - at;
  if (size < hdr || at + size > fileSize) return null;
  return { type, size, hdr };
}

const str4 = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
const hex = (v) => v.toString(16).padStart(2, '0');
const dd = (v) => String(v).padStart(2, '0');

/** a video track (engine/audio/mp4av.js readVideoTrack) -> the VideoDecoder config's {codec, description?}: H.264 (avc1 / avc3 + avcC,
 *  every clip p0pc0rn makes) and VP9 (vp09 + vpcC, the encoder's fallback on some Android builds); anything else -> null (the <video> way) */
export function codecOf(track) {
  const s = track && track.raw && track.raw.stsd;
  if (!s || s.length < 16 + 8 + 78) return null;
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength), e = 16;   // stsd: header 8 + version/flags 4 + entry count 4
  const end = Math.min(s.length, e + dv.getUint32(e)), type = str4(s, e + 4);
  for (let p = e + 8 + 78; p + 8 <= end;) {   // the visual sample entry's own fields are 78 bytes; its child boxes follow
    const sz = dv.getUint32(p), t = str4(s, p + 4);
    if (sz < 8 || p + sz > end) break;
    const body = s.subarray(p + 8, p + sz);
    if ((type === 'avc1' || type === 'avc3') && t === 'avcC' && body.length >= 7) return { codec: `${type}.${hex(body[1])}${hex(body[2])}${hex(body[3])}`, description: body.slice() };
    if (type === 'vp09' && t === 'vpcC' && body.length >= 8) return { codec: `vp09.${dd(body[4])}.${dd(body[5])}.${dd(body[6] >> 4)}` };
    p += sz;
  }
  return null;
}

/** which samples to decode for the frame shown at t seconds: the first frame shown at or after t (the last one when t is past the end);
 *  the decode starts at the keyframe before it in decode order -> {from, to, us} (sample indices, the frame's timestamp in microseconds) */
export function frameAt(track, t) {
  const S = track && track.samples, ts = track && track.timescale, c0 = (track && track.ctsStart) || 0;
  if (!S || !S.length || !(ts > 0)) return null;
  const at = (i) => (S[i].cts - c0) / ts;
  let ti = -1;
  for (let i = 0; i < S.length; i++) if (at(i) >= t - 1e-6 && (ti < 0 || at(i) < at(ti))) ti = i;
  if (ti < 0) for (let i = 0; i < S.length; i++) if (ti < 0 || at(i) > at(ti)) ti = i;
  let k = ti; while (k > 0 && !S[k].key) k--;
  if (ti - k > MAX_RUN) ti = k;
  return { from: k, to: ti, us: Math.round((S[ti].cts - c0) * 1e6 / ts) };
}

/** a clip's length in seconds from its track (the media's own times, else the stored meta) */
export function lengthOf(track, meta) {
  const d = track && track.durationSec;
  if (d > 0) return d;
  const f = meta && Number(meta.frames), fps = meta && Number(meta.fps);
  return f > 0 && fps > 0 ? f / fps : (meta && Number(meta.duration)) || 0;
}

/** RGBA pixels -> {mean, std} of the luma (0-255), every `step`-th pixel each way */
export function luma(d, w, h, step = 2) {
  let n = 0, s = 0, s2 = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4, l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    s += l; s2 += l * l; n++;
  }
  const mean = n ? s / n : 0;
  return { mean, std: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0 };
}
/** a frame with nothing in it (black, or a canvas a video never painted) */
export const isBlank = (st) => !!st && st.mean < 12 && st.std < 3;
/** the opening is very dark: look at 25% of the clip too */
export const isDark = (st) => !!st && st.mean < DARK;

/** RGBA pixels of a stored thumbnail drawn at w x h (any size; ow x oh = the thumbnail's own size) -> it is the old dark card */
export function isOldCard(d, w, h, ow = w, oh = h) {
  const [a, b] = OLD_CARD, L = ow * ow + oh * oh;
  let err = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = ((x + 0.5) / w) * ow, v = ((y + 0.5) / h) * oh, t = Math.min(1, Math.max(0, (u * ow + v * oh) / L)), i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) { err += Math.abs(d[i + c] - (a[c] + (b[c] - a[c]) * t)); n++; }
  }
  return n > 0 && err / n < 8;
}

/** a Library clip that still needs its poster (the flag is set when one is stored; failures stop after MAX_TRIES) */
export const needsPoster = (m) => isClip(m) && !(m.poster >= POSTER_V) && (Number(m.posterFail) || 0) < MAX_TRIES;

/** a model is loading, running or held in the queue (assistant/queue.js: active.engine, modelOf, holding); a running job without a model
 *  (Juli's "here it is" turn, a music video's assembly) is not one; unsure = busy */
export function modelBusy(q) {
  if (!q) return false;
  if (q.holding) return true;
  const a = q.active;
  if (!a) return false;
  if (a.engine) return true;
  try { return typeof q.modelOf === 'function' ? !!q.modelOf(a.job) : true; } catch (e) { return true; }
}
/** the page may decode now: no model loading, running or held, the page on screen, the viewer closed (it plays a clip itself) */
export function quiet({ q = null, hidden = false, viewer = false } = {}) {
  return !hidden && !viewer && !modelBusy(q);
}

/** what an item's tile needs, from a look at its stored thumbnail (st = its luma; oldCard = it is the old dark card) -> 'ok' | 'clip'
 *  (make the clip's poster) | 'mark' (a clip's real frame without the flag: set the flag only) | 'remake' (a blank song cover or picture) */
export function verdict(m, st, oldCard) {
  if (isClip(m)) return m.poster >= POSTER_V ? 'ok' : oldCard || isBlank(st) ? 'clip' : 'mark';   // 'mark': a real frame already: set the flag only
  return isBlank(st) ? 'remake' : 'ok';
}
