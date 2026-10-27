// clipthumbs.js - p0pc0rn 3.9: every clip in the Library shows a frame of itself and a play button. Josh, 10-26: "clip card not showing
// thumbnail with play button". Why the cards were dark: the poster was taken from a detached <video> that had to fire 'loadeddata' first
// (util.js posterOf); Safari on the iPhone caps a video's preload at metadata and paints no frame of one that has not played, so it timed
// out and every clip kept the dark card drawn in its place. Now:
//   - the frame comes from WebCodecs: only the clip's sample table and the samples from a keyframe to the frame are read from the Blob
//     (never the whole file), one VideoDecoder, closed at once; a hidden, muted, inline <video> is the fallback (a codec WebCodecs lacks);
//   - the frame at 0.1 s, or at 25% of the clip when the opening is very dark; a JPEG at most 432 px wide, as a picture's thumbnail;
//   - a new clip gets it when it is saved (clipPoster, from app.js saveToLibrary), unless a model job is loading, running or held then: it
//     gets the old card and the Library makes the poster at its first quiet moment;
//   - a clip saved before (the old dark card, a blank frame) gets it the first time the Library shows its tile: one at a time, only while
//     the Library is on screen, the viewer closed, the page visible and no model job running or held (the queue's own state);
//   - it is stored in the item's own record (meta.thumb, the Library's small JPEG Blob, + meta.poster = 1): made once, reused after;
//     a clip whose frame can't be made keeps its card, tried at most twice (meta.posterFail);
//   - a tile whose stored picture is missing or broken (a song's cover, a picture's thumbnail) shows its kind, and the picture is made
//     again from the item itself (a song's cover the app's own way);
//   - every clip tile gets a centred play button; the length pill stays.
'use strict';
import * as store from '../store.js';
import { makeThumb } from '../util.js';
import { POSTER_Q, POSTER_V, MAX_TRIES, AT, LATE, MOOV_MAX, OLD_CARD, posterSize, boxHead, codecOf, frameAt, lengthOf, luma, isBlank, isDark,
  isOldCard, needsPoster, modelBusy, quiet, verdict, isClip, isSong } from './clipposter_core.js';

let A = null;   // the app's side (createClipThumbs)
export const stats = { made: 0, webcodecs: 0, video: 0, failed: 0, marked: 0, remade: 0, atSave: 0, deferred: 0, checked: 0, decodes: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bound = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(what + ' took too long'); })]);

// ------------------------------------------------------------------------------------------------ one frame of a clip
/** the clip's video track from its moov box alone (the sample offsets are the file's own) -> track, or null (not an MP4) */
async function readTrack(blob) {
  const size = blob.size;
  for (let at = 0, i = 0; i < 64 && at + 8 <= size; i++) {
    const h = boxHead(new Uint8Array(await blob.slice(at, Math.min(size, at + 16)).arrayBuffer()), size, at);
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
/** the samples from..to of the track, read from the Blob (one read when they lie together, else one each) */
async function samplesOf(blob, S, from, to) {
  let lo = Infinity, hi = 0;
  for (let i = from; i <= to; i++) { lo = Math.min(lo, S[i].off); hi = Math.max(hi, S[i].off + S[i].size); }
  if (hi - lo <= (8 << 20)) {
    const buf = new Uint8Array(await blob.slice(lo, hi).arrayBuffer());
    return S.slice(from, to + 1).map((s) => buf.subarray(s.off - lo, s.off - lo + s.size));
  }
  const out = [];
  for (let i = from; i <= to; i++) out.push(new Uint8Array(await blob.slice(S[i].off, S[i].off + S[i].size).arrayBuffer()));
  return out;
}
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true });
const lumaOf = (c) => luma(ctxOf(c).getImageData(0, 0, c.width, c.height).data, c.width, c.height, 3);
const jpeg = (c) => bound(new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('no JPEG'))), 'image/jpeg', POSTER_Q)), 4000, 'the JPEG');
const free = (...cs) => { for (const c of cs) if (c) c.width = c.height = 0; };

/** the frames at 0.1 s (and at 25% when that one is very dark), each drawn by draw(t) into a canvas -> the better one as a JPEG, or null */
async function shoot(len, draw) {
  const first = await draw(Math.min(AT, len / 2));
  if (!first) return null;
  let pick = first, a = lumaOf(first), second = null;
  if (isDark(a) && len > 0.4) {
    second = await draw(len * LATE).catch(() => null);
    const b = second && lumaOf(second);
    if (b && b.mean > a.mean) { pick = second; a = b; }
  }
  try { return isBlank(a) ? null : await jpeg(pick); }   // nothing in it: a frame that was never painted (the next way, or the card)
  finally { free(first, second); }
}

/** WebCodecs: the clip's own samples through one VideoDecoder -> JPEG Blob, or null (no decoder, not an MP4, a codec it lacks) */
async function viaCodecs(blob, meta) {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return null;
  const track = await readTrack(blob).catch(() => null), cfg = track && codecOf(track);
  if (!cfg || !track.samples.length) return null;
  const conf = Object.assign({ codec: cfg.codec, codedWidth: track.width, codedHeight: track.height, optimizeForLatency: true }, cfg.description ? { description: cfg.description } : {});
  try { const s = await bound(VideoDecoder.isConfigSupported(conf), 3000, 'the decoder check'); if (!s || !s.supported) return null; } catch (e) { return null; }
  const [tw, th] = posterSize(track.width, track.height), S = track.samples, c0 = track.ctsStart || 0;
  let best = null, bestD = Infinity, want = 0, err = null;
  const dec = new VideoDecoder({ output: (f) => { const d = Math.abs(f.timestamp - want); if (d < bestD) { if (best) best.close(); best = f; bestD = d; } else f.close(); }, error: (e) => { err = e; } });
  try {
    dec.configure(conf);
    return await shoot(lengthOf(track, meta), async (t) => {
      const r = frameAt(track, t); if (!r) return null;
      want = r.us; bestD = Infinity; if (best) { best.close(); best = null; }
      const data = await samplesOf(blob, S, r.from, r.to);
      for (let i = r.from; i <= r.to; i++) dec.decode(new EncodedVideoChunk({ type: S[i].key ? 'key' : 'delta', timestamp: Math.round((S[i].cts - c0) * 1e6 / track.timescale), data: data[i - r.from] }));
      const fl = dec.flush(); fl.catch(() => {});
      await bound(fl, 6000, 'the decode');
      stats.decodes++;
      if (err) throw err;
      if (!best) return null;
      const c = canvasOf(tw, th); ctxOf(c).drawImage(best, 0, 0, tw, th); best.close(); best = null;
      return c;
    });
  } finally { if (best) best.close(); try { dec.close(); } catch (e) { /* closed */ } }
}

/** the fallback: a hidden, muted, inline <video> on the page (a 2 px box: Safari loads and paints frames only of a video that plays and
 *  is on the page), played a moment, then seeked -> JPEG Blob, or null; the element and its blob: URL go at once */
async function viaVideo(blob, meta) {
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.disableRemotePlayback = true;
  for (const a of ['muted', 'playsinline', 'webkit-playsinline']) v.setAttribute(a, '');
  v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
  Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
  /** true once one of evs fires with ok() true (ok() already true: at once); false on an error or after ms */
  const until = (evs, ms, ok = () => true) => new Promise((res) => {
    let t = 0;
    const fin = (r) => { clearTimeout(t); for (const e of evs) v.removeEventListener(e, on); v.removeEventListener('error', no); res(r); };
    const on = () => { if (ok()) fin(true); }, no = () => fin(false);
    for (const e of evs) v.addEventListener(e, on);
    v.addEventListener('error', no); t = setTimeout(() => fin(false), ms);
  });
  try {
    document.body.append(v); v.src = url;
    const p = v.play(); if (p && p.catch) p.catch(() => {});
    if (v.readyState < 2 && !(await until(['loadeddata', 'canplay', 'playing', 'timeupdate'], 6000, () => v.readyState >= 2))) return null;
    v.pause(); stats.decodes++;
    const [tw, th] = posterSize(v.videoWidth || meta.width, v.videoHeight || meta.height);
    return await shoot(v.duration > 0 && isFinite(v.duration) ? v.duration : lengthOf(null, meta), async (t) => {
      if (Math.abs(v.currentTime - t) > 0.01) { const s = until(['seeked'], 3000); v.currentTime = t; await s; }
      await new Promise((r) => { if (typeof v.requestVideoFrameCallback === 'function') { v.requestVideoFrameCallback(() => r()); setTimeout(r, 400); } else setTimeout(r, 120); });
      if (v.readyState < 2) return null;
      const c = canvasOf(tw, th); ctxOf(c).drawImage(v, 0, 0, tw, th); return c;
    });
  } finally { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); URL.revokeObjectURL(url); }
}

/** a clip Blob -> {blob: JPEG, via} or null; one at a time (the decoder and the element are freed before it returns) */
let chain = Promise.resolve();
function capture(blob, meta) {
  const run = async () => {
    let jpg = await viaCodecs(blob, meta).catch(() => null), via = 'webcodecs';
    if (!jpg) { jpg = await viaVideo(blob, meta).catch(() => null); via = 'video'; }
    return jpg ? { blob: jpg, via } : null;
  };
  const p = chain.then(run, run); chain = p.catch(() => null); return p;
}

/** the old card (util.js posterOf's own): the clip's shape, a dark diagonal gradient; the Library swaps it for the frame when it can */
function oldCard(w, h) {
  const [tw, th] = posterSize(w, h), c = canvasOf(tw, th), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, tw, th);
  const css = (rgb) => `rgb(${rgb.join(',')})`;
  g.addColorStop(0, css(OLD_CARD[0])); g.addColorStop(1, css(OLD_CARD[1])); x.fillStyle = g; x.fillRect(0, 0, tw, th);
  return jpeg(c).finally(() => free(c));
}

/** app.js saveToLibrary: a new clip's thumbnail. The frame now when no model job is loading, running or held (res.poster is then set),
 *  else the old card (the Library makes the poster at its first quiet moment). The save waits SAVE_WAIT at most: the clip itself is only in
 *  memory until it is stored (a slower frame is dropped and made again by the Library; the decodes stay one at a time) */
const SAVE_WAIT = 4000;
export async function clipPoster(res) {
  if (res && res.blob && !(A && A.busy())) {
    const p = await Promise.race([capture(res.blob, res).catch(() => null), sleep(SAVE_WAIT).then(() => null)]);
    if (p) { res.poster = POSTER_V; stats.atSave++; stats[p.via]++; return p.blob; }
  }
  stats.deferred++;
  return oldCard(res && res.width, res && res.height);
}

// ------------------------------------------------------------------------------------------------ the Library
let G = null;   // the Library on screen: its grid and app.js's id -> blob: URL map (app.js frees those when the Library is left)
const todo = [], queued = new Set(), tried = new Set();   // tried: failed in this visit of the page (no second try until it opens again)
const seen = new WeakMap();   // a stored thumbnail Blob -> what it needs ('ok' | 'clip' | 'remake' | 'mark'), each looked at once
let px = null, running = false, timer = 0, wait = 0;

const el = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; e.setAttribute('aria-hidden', 'true'); if (html) e.innerHTML = html; return e; };
const playMark = () => el('span', 'ct-play', '<svg><use href="#i-play"/></svg>');

/** a loaded thumbnail, 24 x 24, for a look at it */
function pixels(img) {
  try {
    if (!px) px = canvasOf(24, 24);
    const x = ctxOf(px); x.clearRect(0, 0, 24, 24); x.drawImage(img, 0, 0, 24, 24);
    return x.getImageData(0, 0, 24, 24).data;
  } catch (e) { return null; }
}
function look(m, img) {
  if (!(m.thumb instanceof Blob)) return;
  let v = seen.get(m.thumb);
  if (!v) {
    if (isClip(m) && m.poster >= POSTER_V) v = 'ok';
    else { const d = pixels(img); v = d ? verdict(m, luma(d, 24, 24, 1), isClip(m) && isOldCard(d, 24, 24, img.naturalWidth, img.naturalHeight)) : 'ok'; stats.checked++; }
    seen.set(m.thumb, v);
  }
  if (v === 'mark') { seen.set(m.thumb, 'ok'); stats.marked++; keep(m, { poster: POSTER_V }, true); }   // already a real frame (made on a desktop)
  else if (v === 'clip' && needsPoster(m)) want(m);
  else if (v === 'remake') want(m);
}
/** a tile with no picture (none stored, or it does not load): its kind instead of an empty box, and the picture made again */
function noArt(t, m) {
  t.classList.add('ct-noart');
  if (!t.style.aspectRatio) t.style.aspectRatio = '1 / 1';   // an old item without a stored size took its shape from the picture
  if (!isClip(m) && !t.querySelector('.ct-mark')) t.append(el('span', 'ct-mark', `<svg><use href="#${isSong(m) ? 'i-note' : 'i-sparkle'}"/></svg>`));
  if (!isClip(m) || (Number(m.posterFail) || 0) < MAX_TRIES) want(m);
  pump();
}
function want(m) { if (queued.has(m.id) || tried.has(m.id)) return; queued.add(m.id); todo.push(m.id); }

/** app.js renderLibrary, after the tiles: the play buttons, a look at each tile's picture as it loads, and the posters still to make (the
 *  play buttons need nothing else; the posters wait for createClipThumbs, which app.js makes at its start, before any screen shows) */
export function clipLibrary(grid, lib, thumbs) { library(grid, lib, thumbs); }
function library(grid, lib, thumbs) {
  G = { grid, thumbs };
  const byId = new Map(lib.map((m) => [m.id, m]));
  for (const t of grid.querySelectorAll('.tile[data-id]')) {
    const m = byId.get(t.dataset.id);
    if (!m || t.dataset.ct) continue;
    t.dataset.ct = '1';
    if (isClip(m)) t.append(playMark());
    const img = t.querySelector('img');
    if (!img || !img.getAttribute('src')) { noArt(t, m); continue; }
    img.addEventListener('error', () => noArt(t, m), { once: true });
    if (img.complete && img.naturalWidth) look(m, img);
    else img.addEventListener('load', () => { look(m, img); pump(); }, { once: true });
  }
  pump();
}

/** the next item, when the page may decode; a short wait (1, 2, 4, 8 s) while a model job runs; stops when the Library is left */
async function pump() {
  if (running || !A) return;
  running = true;
  try {
    while (todo.length) {
      if (!A.visible()) { todo.length = 0; queued.clear(); return; }
      if (!quiet({ q: A.Q(), hidden: document.hidden, viewer: A.viewerOpen() })) { later(); return; }
      const id = todo.shift(); queued.delete(id);
      const m = A.lib().find((x) => x.id === id);
      if (m) await make(m).catch((e) => { tried.add(id); A.diag('clip poster: failed', { id, message: String((e && e.message) || e).slice(0, 160) }); });
    }
    wait = 0;
  } finally { running = false; }
}
function later() { if (timer) return; wait = Math.min(8000, wait ? wait * 2 : 1000); timer = setTimeout(() => { timer = 0; pump(); }, wait); }

/** one item's picture: a clip's poster; a song's cover or a picture's thumbnail made again from the item itself */
async function make(m) {
  const blob = await store.getBlob(m.id).catch(() => null);
  if (!blob) { tried.add(m.id); return; }
  if (isClip(m)) {
    const p = await capture(blob, m);
    if (p) { stats.made++; stats[p.via]++; seen.set(p.blob, 'ok'); await keep(m, { thumb: p.blob, poster: POSTER_V, posterFail: 0 }); }
    else { stats.failed++; tried.add(m.id); await keep(m, { posterFail: (Number(m.posterFail) || 0) + 1 }, true); A.diag('clip poster: no frame', { id: m.id }); }
    return;
  }
  const th = isSong(m) ? (A.songCover ? await A.songCover(Object.assign({}, m, { blob })) : null) : await makeThumb(blob);
  tried.add(m.id);   // once a visit: a picture that is black itself stays black
  if (th) { stats.remade++; seen.set(th, 'ok'); await keep(m, { thumb: th }); }
}
/** the item's record: the Library's own object (S.lib: the next render and the viewer's Undo carry it) and the stored one, then its tile */
async function keep(m, fields, noShow) {
  Object.assign(m, fields);
  await store.patchMeta(m.id, fields).catch(() => false);
  if (!noShow && fields.thumb) show(m);
}
function show(m) {
  if (!G || !G.grid.isConnected || !A.visible()) return;
  const t = [...G.grid.querySelectorAll('.tile[data-id]')].find((x) => x.dataset.id === m.id);
  if (!t || !(m.thumb instanceof Blob)) return;
  const old = G.thumbs.get(m.id), u = URL.createObjectURL(m.thumb);
  G.thumbs.set(m.id, u); if (old) URL.revokeObjectURL(old);
  let img = t.querySelector('img');
  if (!img) { img = document.createElement('img'); img.alt = ''; t.append(img); }
  img.decoding = 'async'; img.src = u;
  t.classList.remove('ct-noart'); const mk = t.querySelector('.ct-mark'); if (mk) mk.remove();
}

/** app.js init: api = {Q: () => the queue, lib: () => the Library's items, visible: () => the Library is the screen, viewerOpen,
 *  songCover(res) -> the app's song cover Blob, diag} */
export function createClipThumbs(api) {
  A = { Q: api.Q || (() => null), lib: api.lib || (() => []), visible: api.visible || (() => false), viewerOpen: api.viewerOpen || (() => false),
    songCover: api.songCover || null, diag: api.diag || (() => {}),
    busy() { return modelBusy(this.Q()); } };
  const me = { library, poster: clipPoster, stats, version: POSTER_V };
  try { globalThis.P0CLIPT = me; } catch (e) { /* */ }
  pump();   // tiles the Library showed before (their posters waited for this)
  return me;
}
