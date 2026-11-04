// clipprep.js - v4 Phase 4: a clip picked for Create › Video › Restyle a clip, read ONCE into the frames the phone restyles: its first
// n seconds at 16 frames a second, each frame scaled to fit the restyle's size (v4: below; before, the middle cropped), each a JPEG, all in
// one Blob (a "frames pack"). The pack is what the queue keeps and the restyle job reads (readPack -> engine videoToVideo's source), so a
// clip from the phone is decoded once, at pick time, whatever its codec, frame rate, rotation or size, and a long camera video is never
// copied whole. Frame 0 also comes as a PNG: Klein 4B restyles exactly the frame the clip starts on.
// v4 (the whole video, in parts): a window of the clip from any 16 fps frame (`start`), and prepareParts() for every part's window, one
// pack each, the clip opened once (only the samples a window needs are read: from the key frame before it).
// v4 (no hard crop): every frame is scaled to FIT the restyle's size (ui/style_v2v.js styleSize / fitOf): the whole frame, at most a small
// trim, else its edge pixels repeated into the rest (drawFit); every part of a clip the same.
//   - a p0pc0rn clip (an MP4, H.264, no rotation): WebCodecs, the clip's own samples through one VideoDecoder (ui/clipthumbs.js's way);
//     frame i is the one shown at (i + 0.25) / 16 s, so a 16 fps clip gives its own frames;
//   - anything else (an iPhone video: HEVC, a rotated track, a .mov): a hidden, muted, inline <video> on the page, played a moment, then
//     seeked to each time (Safari paints frames only of a video that has played and is on the page: clipthumbs.js viaVideo).
import { boxHead, codecOf, lengthOf, MOOV_MAX } from './clipposter_core.js';
import { STYLE_FPS, timeOf, fitOf } from './style_v2v.js';

export const PACK_TYPE = 'application/x-p0pc0rn-frames';
export const PACK_Q = 0.92;   // the frames' JPEG quality (near what the lab's MP4 sources carry)
const MAGIC = [0x50, 0x30, 0x46, 0x52];   // 'P0FR'
const bad = (m) => Object.assign(new Error(m), { code: 'BAD_VIDEO' });
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const aborted = (signal) => { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };

// ------------------------------------------------------------------------------------------------ the frames pack (pure)
/** JPEG Blobs + {width, height, fps} -> one Blob: 'P0FR', u32 LE header length, the header (JSON {v, width, height, fps, frames, sizes}), the JPEGs */
export function packFrames(jpegs, meta) {
  const head = new TextEncoder().encode(JSON.stringify({ v: 1, width: meta.width, height: meta.height, fps: meta.fps || STYLE_FPS, frames: jpegs.length, sizes: jpegs.map((b) => b.size) }));
  const pre = new Uint8Array(8); pre.set(MAGIC, 0); new DataView(pre.buffer).setUint32(4, head.length, true);
  return new Blob([pre, head, ...jpegs], { type: PACK_TYPE });
}
/** the first bytes of a pack -> {meta, offsets (where each frame starts), end} or null (not a pack) */
export function packHeader(ab) {
  const u8 = new Uint8Array(ab);
  if (u8.length < 8 || MAGIC.some((m, i) => u8[i] !== m)) return null;
  const n = new DataView(u8.buffer, u8.byteOffset, 8).getUint32(4, true);
  if (u8.length < 8 + n) return { need: 8 + n };
  let meta; try { meta = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n))); } catch (e) { return null; }
  if (!meta || meta.v !== 1 || !Array.isArray(meta.sizes) || meta.sizes.length !== meta.frames) return null;
  const offsets = []; let at = 8 + n; for (const s of meta.sizes) { offsets.push(at); at += s; }
  return { meta, offsets, end: at };
}
/** a frames pack -> {frames, width, height, fps, read(i) -> ImageBitmap, close()}: the engine's videoToVideo `source` (each frame decoded
 *  when it is asked for; the engine reads them in order, once a tile) */
export async function readPack(blob) {
  let h = packHeader(await blob.slice(0, 4096).arrayBuffer());
  if (h && h.need) h = packHeader(await blob.slice(0, h.need).arrayBuffer());
  if (!h || h.need || h.end > blob.size) throw bad('That clip could not be read.');
  const { meta, offsets } = h; let last = null;
  return { frames: meta.frames, width: meta.width, height: meta.height, fps: meta.fps,
    async read(i) {
      if (!(i >= 0 && i < meta.frames)) throw bad(`The clip has ${meta.frames} frames, not ${i + 1}.`);
      if (last) { try { last.close(); } catch (e) { /* */ } last = null; }
      last = await createImageBitmap(blob.slice(offsets[i], offsets[i] + meta.sizes[i], 'image/jpeg'));
      return last;
    },
    close() { if (last) { try { last.close(); } catch (e) { /* */ } last = null; } } };
}

/** draw a sw x sh frame into W x H as fitOf says: the part of it drawn, then (pad) its first / last row or column stretched over the rest */
export function drawFit(cx, src, sw, sh, f, W, H) {
  const s = f.src, d = f.dst;
  cx.drawImage(src, s.x, s.y, s.w, s.h, d.x, d.y, d.w, d.h);
  if (f.mode !== 'pad') return;
  if (d.y > 0) cx.drawImage(src, 0, 0, sw, 1, d.x, 0, d.w, d.y);
  if (d.y + d.h < H) cx.drawImage(src, 0, sh - 1, sw, 1, d.x, d.y + d.h, d.w, H - d.y - d.h);
  if (d.x > 0) cx.drawImage(src, 0, 0, 1, sh, 0, d.y, d.x, d.h);
  if (d.x + d.w < W) cx.drawImage(src, sw - 1, 0, 1, sh, d.x + d.w, d.y, W - d.x - d.w, d.h);
}
/** a track's tkhd (box bytes, header included) -> true when its matrix turns or flips the picture (the <video> path draws it upright) */
export function rotated(tkhd) {
  if (!tkhd || tkhd.length < 60) return false;
  const dv = new DataView(tkhd.buffer, tkhd.byteOffset, tkhd.byteLength), at = tkhd[8] === 1 ? 60 : 48;
  if (tkhd.length < at + 36) return false;
  const a = dv.getInt32(at), b = dv.getInt32(at + 4), c = dv.getInt32(at + 12), d = dv.getInt32(at + 16);
  return !(a === 0x10000 && d === 0x10000 && b === 0 && c === 0);
}
/** which output frame each decoded frame fills: frame i is the last one shown at or before timeOf(i). ts: the decoded frames' times (s,
 *  ascending) -> for each output i the index into ts */
export function pickFrames(ts, n, fps = STYLE_FPS) {
  const out = []; let k = 0;
  for (let i = 0; i < n; i++) { const t = timeOf(i, fps); while (k + 1 < ts.length && ts[k + 1] <= t + 1e-6) k++; out.push(k); }
  return out;
}

// ------------------------------------------------------------------------------------------------ reading a clip (browser)
async function readTrack(blob) {
  for (let at = 0, i = 0; i < 64 && at + 8 <= blob.size; i++) {
    const h = boxHead(new Uint8Array(await blob.slice(at, Math.min(blob.size, at + 16)).arrayBuffer()), blob.size, at);
    if (!h) return null;
    if (h.type === 'moov') {
      if (h.size > MOOV_MAX) return null;
      const { readVideoTrack } = await import('../engine/audio/mp4av.js');
      return readVideoTrack(new Uint8Array(await blob.slice(at, at + h.size).arrayBuffer()));
    }
    at += h.size;
  }
  return null;
}
/** the WebCodecs way, when it can: {track, conf} or null (not an MP4 we read, a codec it lacks, a rotated track) */
async function codecsFor(blob) {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return null;
  const track = await readTrack(blob).catch(() => null), cfg = track && codecOf(track);
  if (!cfg || !track.samples.length || rotated(track.raw && track.raw.tkhd)) return null;
  const conf = Object.assign({ codec: cfg.codec, codedWidth: track.width, codedHeight: track.height }, cfg.description ? { description: cfg.description } : {});
  try { const s = await VideoDecoder.isConfigSupported(conf); if (!s || !s.supported) return null; } catch (e) { return null; }
  return { track, conf };
}
/** a hidden, muted, inline <video> on the page with the clip, played a moment so Safari paints its frames -> {v, done()} or null */
async function videoFor(blob) {
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.disableRemotePlayback = true;
  for (const a of ['muted', 'playsinline', 'webkit-playsinline']) v.setAttribute(a, '');
  v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
  Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
  const done = () => { try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch (e) { /* */ } URL.revokeObjectURL(url); };
  const until = (evs, ms, ok = () => true) => new Promise((res) => {
    let t = 0; const fin = (r) => { clearTimeout(t); for (const e of evs) v.removeEventListener(e, on); v.removeEventListener('error', no); res(r); };
    const on = () => { if (ok()) fin(true); }, no = () => fin(false);
    for (const e of evs) v.addEventListener(e, on); v.addEventListener('error', no); t = setTimeout(() => fin(false), ms);
  });
  document.body.append(v); v.src = url;
  const p = v.play(); if (p && p.catch) p.catch(() => {});
  if (v.readyState < 2 && !(await until(['loadeddata', 'canplay', 'playing', 'timeupdate'], 8000, () => v.readyState >= 2))) { done(); return null; }
  v.pause();
  return { v, done, until };
}

/** a picked clip -> {duration (s), width, height (as shown: a rotated phone video upright), via} */
export async function probeClip(blob) {
  const c = await codecsFor(blob);
  if (c) return { duration: lengthOf(c.track, {}), width: c.track.width, height: c.track.height, via: 'webcodecs' };
  const x = await videoFor(blob);
  if (!x) throw bad('That video could not be opened on this phone.');
  try { return { duration: x.v.duration, width: x.v.videoWidth, height: x.v.videoHeight, via: 'video' }; } finally { x.done(); }
}

/** `frames` frames of the clip at 16 fps from its frame `start` (0 = its first; frame i = the one shown at timeOf(start + i)), scaled to fit
 *  width x height (fitOf) -> {pack (Blob), first (PNG Blob of the window's frame 0; null with first: false), frames, via}.
 *  onProgress(i, frames) after each frame; signal cancels. One JPEG at a time: only the canvas and the frame drawn are kept. */
export async function prepareClip(blob, { width, height, frames, start = 0, onProgress, signal, via = null, first: wantFirst = true, trimMax, _codecs, _video } = {}) {   // via 'video': the <video> way only; trimMax: desk checks
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
  const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  const toBlob = (type, q) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(bad('The clip could not be read.'))), type, q));
  const jpegs = []; let first = null;
  const at = (i) => timeOf(start + i);   // where output frame i sits in the clip
  let fit = null;   // v4: the frame scaled to fit (fitOf), worked out once for the clip's frame size
  const put = async (src, sw, sh) => {
    if (!fit || fit.sw !== sw || fit.sh !== sh) fit = { sw, sh, f: fitOf(sw, sh, width, height, trimMax) };
    drawFit(cx, src, sw, sh, fit.f, width, height);
    if (!jpegs.length && wantFirst) first = await toBlob('image/png');
    jpegs.push(await toBlob('image/jpeg', PACK_Q));
    if (onProgress) onProgress(jpegs.length, frames);
  };
  const c = _video ? null : _codecs !== undefined ? _codecs : via === 'video' ? null : await codecsFor(blob);
  if (c) {   // the clip's own samples, in decode order, from the key frame before the window; frames come out in presentation order
    const { track, conf } = c, S = track.samples, c0 = track.ctsStart || 0, tsc = track.timescale, out = [];
    let k0 = 0; for (let i = 0; i < S.length; i++) if (S[i].key && (S[i].cts - c0) / tsc <= at(0) + 1e-6) k0 = i;
    let err = null, prev = null, next = 0;
    const dec = new VideoDecoder({ output: (f) => out.push(f), error: (e) => { err = e; } });
    dec.configure(conf);
    const take = async (final) => {
      while (out.length) {
        const f = out.shift(), ts = f.timestamp / 1e6;
        while (prev && next < frames && at(next) < ts - 1e-6) { await put(prev, prev.displayWidth, prev.displayHeight); next++; }
        if (prev) prev.close(); prev = f;
      }
      if (final) while (prev && next < frames) { await put(prev, prev.displayWidth, prev.displayHeight); next++; }
    };
    try {
      for (let i = k0; i < S.length && next < frames; i++) {
        aborted(signal); if (err) throw err;
        const s = S[i], data = new Uint8Array(await blob.slice(s.off, s.off + s.size).arrayBuffer());
        dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round((s.cts - c0) * 1e6 / tsc), data }));
        await tick(); await take(false);
      }
      if (next < frames) { await dec.flush(); if (err) throw err; await take(true); }
    } catch (e) { if (e && e.name === 'AbortError') throw e; throw bad('The clip could not be decoded: ' + String(e && e.message || e).slice(0, 80)); }
    finally { for (const f of out) f.close(); if (prev) prev.close(); try { dec.close(); } catch (e) { /* closed */ } }
    if (jpegs.length < frames) throw bad(`The clip has ${jpegs.length} frames here, not ${frames}.`);
    return { pack: packFrames(jpegs, { width, height, fps: STYLE_FPS }), first, frames, via: 'webcodecs' };
  }
  const x = _video || await videoFor(blob);
  if (!x) throw bad('That video could not be opened on this phone.');
  try {
    const v = x.v, end = Math.max(0, (v.duration || 0) - 0.001);
    for (let i = 0; i < frames; i++) {
      aborted(signal);
      const t = Math.min(at(i), end);
      if (Math.abs(v.currentTime - t) > 1e-3) { const s = x.until(['seeked'], 4000); v.currentTime = t; if (!(await s)) throw bad('The video stopped answering.'); }
      await new Promise((r) => { if (typeof v.requestVideoFrameCallback === 'function') { v.requestVideoFrameCallback(() => r()); setTimeout(r, 300); } else setTimeout(r, 80); });
      if (v.readyState < 2) await sleep(60);
      await put(v, v.videoWidth, v.videoHeight);
    }
  } finally { if (!_video) x.done(); }
  return { pack: packFrames(jpegs, { width, height, fps: STYLE_FPS }), first, frames, via: 'video' };
}
/** v4: every part of a whole video (parts [{start, frames}]: ui/style_v2v.js partsOf), one frames pack each, the clip opened once.
 *  onPart(i, {pack, frames, via}) as each part is read (the caller keeps it and lets it go); onProgress(done, total) after each frame. */
export async function prepareParts(blob, { width, height, parts, onPart, onProgress, signal, via = null } = {}) {
  const total = parts.reduce((s, p) => s + p.frames, 0);
  const c = via === 'video' ? null : await codecsFor(blob), x = c ? null : await videoFor(blob);
  if (!c && !x) throw bad('That video could not be opened on this phone.');
  let done = 0;
  try {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const r = await prepareClip(blob, { width, height, frames: p.frames, start: p.start, signal, first: false, _codecs: c, _video: x, onProgress: (k) => { if (onProgress) onProgress(done + k, total); } });
      done += p.frames;
      if (onPart) await onPart(i, r);
    }
  } finally { if (x) x.done(); }
}
