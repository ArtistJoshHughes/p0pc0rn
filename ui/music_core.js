// music_core.js - 3.9 Music: everything the player decides, without the DOM (node-tested). The play queue (next / previous / shuffle /
// repeat), the playlists kept on this phone (one localStorage key, versioned), the Music badge (songs made since Music first looked,
// not played yet), the lock screen (Media Session) and the player that drives ONE audio element for the whole page: iOS lets play()
// start sound only inside a tap the first time, so the first tap plays a silent clip at once and the element stays allowed after
// that, also for the next song when the screen is locked.
'use strict';

export const KEY = 'p0pc0rn:music';   // {v: 1, base, playlists: [{id, name, songs: [song ids], at, upd}], played: {songId: when}}
export const LIMITS = { playlists: 100, songs: 500, name: 40, played: 2000 };
export const ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward', 'stop'];
export const ICONS = [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon-192.png', sizes: '192x192', type: 'image/png' }];
const REPEATS = ['off', 'all', 'one'];
const RESTART_AFTER = 3;   // previous restarts a song played longer than this (seconds), else goes back one
const SKIP = 10;           // the lock screen's seek step when it gives none (seconds)
const MAX_ERRORS = 3;      // songs in a row that won't play before the player stops and says so

// ---------------------------------------------------------------------------------------------------------------- the queue
/** a queue over song ids, starting at ids[start]: {base (list order), order (play order), pos, shuffle, repeat, gone} */
export function makeQueue(ids, start = 0, { repeat = 'off' } = {}) {
  const list = Array.isArray(ids) ? ids : [], first = list[start | 0];
  const base = list.filter((x, i) => typeof x === 'string' && list.indexOf(x) === i);
  const pos = Math.max(0, base.indexOf(first));
  return { base, order: base.slice(), pos, shuffle: false, repeat: REPEATS.includes(repeat) ? repeat : 'off', gone: false };
}
export const current = (q) => (q && q.order.length ? q.order[q.pos] : null);
export const cycleRepeat = (q) => ({ ...q, repeat: REPEATS[(REPEATS.indexOf(q.repeat) + 1) % REPEATS.length] });

/** the current song left the Library while it played: take it out now (the next one moves into its place) */
function dropCurrent(q) {
  const cur = current(q), order = q.order.filter((x) => x !== cur), base = q.base.filter((x) => x !== cur);
  return { ...q, order, base, gone: false };
}
/** -> {q, play, restart}: auto = the song ended by itself (repeat one replays it); a tap on next always moves on */
export function next(q, { auto = false } = {}) {
  if (q.gone) {
    const d = dropCurrent(q), n = d.order.length;
    if (!n) return { q: { ...d, pos: 0 }, play: false };
    if (q.pos < n) return { q: { ...d, pos: q.pos }, play: true };
    if (q.repeat === 'all') return { q: { ...d, pos: 0 }, play: true };
    return { q: { ...d, pos: auto ? n - 1 : 0 }, play: false };
  }
  const n = q.order.length;
  if (!n) return { q, play: false };
  if (auto && q.repeat === 'one') return { q, play: true, restart: true };
  if (q.pos + 1 < n) return { q: { ...q, pos: q.pos + 1 }, play: true };
  if (q.repeat === 'all') return n === 1 ? { q, play: true, restart: true } : { q: { ...q, pos: 0 }, play: true };
  return auto ? { q, play: false } : { q: { ...q, pos: 0 }, play: false };   // the end: stop (a tap on next shows the first song)
}
/** -> {q, restart}: past 3 s the song starts over, else the one before (wrapping only with repeat all) */
export function prev(q, elapsed = 0) {
  if (q.gone) { const d = dropCurrent(q); return { q: { ...d, pos: Math.max(0, Math.min(q.pos - 1, d.order.length - 1)) }, restart: false }; }
  if (!q.order.length || elapsed > RESTART_AFTER) return { q, restart: true };
  if (q.pos > 0) return { q: { ...q, pos: q.pos - 1 }, restart: false };
  if (q.repeat === 'all' && q.order.length > 1) return { q: { ...q, pos: q.order.length - 1 }, restart: false };
  return { q, restart: true };
}
/** shuffle on: the current song first, the rest in a random order (rng injectable); off: list order again, at the same song */
export function setShuffle(q, on, rng = Math.random) {
  const cur = current(q);
  if (!on) { const order = q.base.slice(); return { ...q, order, pos: Math.max(0, order.indexOf(cur)), shuffle: false }; }
  const rest = q.base.filter((x) => x !== cur);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return { ...q, order: cur == null ? rest : [cur, ...rest], pos: 0, shuffle: true };
}
/** songs deleted from the Library leave the queue; the one playing stays until it ends (its audio is already loaded) */
export function removeIds(q, gone) {
  const cur = current(q), keep = (x) => !gone.has(x) || x === cur;
  const order = q.order.filter(keep), base = q.base.filter(keep);
  return { ...q, order, base, pos: cur == null ? 0 : Math.max(0, order.indexOf(cur)), gone: q.gone || (cur != null && gone.has(cur)) };
}

// ---------------------------------------------------------------------------------------------------------------- songs + badge
export const isAudio = (m) => !!m && m.media === 'audio';
/** every song (and voice line) of the Library, in the Library's order (newest first) */
export const songsOf = (lib) => (Array.isArray(lib) ? lib.filter(isAudio) : []);
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…');
/** a song's name for lists and the lock screen: its title, else the start of its prompt; a Cast voice line says so */
export function songTitle(m) {
  if (!m) return 'Song';
  const t = String(m.title || '').replace(/\s+/g, ' ').trim();
  if (t) return cut(t, 60);
  const p = String(m.prompt || '').replace(/\s+/g, ' ').trim();
  if (m.kind === 'say') return p ? 'Voice: ' + cut(p, 40) : 'Voice';
  return p ? cut(p, 40) : 'Song';
}
export const freshState = (now) => ({ v: 1, base: now, playlists: [], played: {} });
/** the Music badge: songs made after Music first looked at the Library and not played in Music yet */
export function newCount(st, songs) {
  let n = 0;
  for (const s of songs) if ((s.createdAt || 0) > st.base && !st.played[s.id]) n++;
  return n;
}
export function markPlayed(st, id, now) {
  if (st.played[id]) return st;
  let played = { ...st.played, [id]: now };
  const keys = Object.keys(played);
  if (keys.length > LIMITS.played) played = Object.fromEntries(Object.entries(played).sort((a, b) => b[1] - a[1]).slice(0, LIMITS.played));
  return { ...st, played };
}

// ---------------------------------------------------------------------------------------------------------------- playlists
const tidy = (name) => String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, LIMITS.name).trim() || 'New playlist';
const edit = (st, id, fn) => ({ ...st, playlists: st.playlists.map((p) => (p.id === id ? fn(p) : p)) });
/** -> {state, id, why}: why 'full' at 100 playlists */
export function createPlaylist(st, name, now, id) {
  if (st.playlists.length >= LIMITS.playlists) return { state: st, why: 'full' };
  const p = { id, name: tidy(name), songs: [], at: now, upd: now };
  return { state: { ...st, playlists: [...st.playlists, p] }, id };
}
export const renamePlaylist = (st, id, name, now) => edit(st, id, (p) => ({ ...p, name: tidy(name), upd: now }));
export const deletePlaylist = (st, id) => ({ ...st, playlists: st.playlists.filter((p) => p.id !== id) });
/** -> {state, added, why}: why 'missing' | 'already' (a playlist holds a song once) | 'full' (500 songs) */
export function addSong(st, pid, songId, now) {
  const p = st.playlists.find((x) => x.id === pid);
  if (!p) return { state: st, added: false, why: 'missing' };
  if (p.songs.includes(songId)) return { state: st, added: false, why: 'already' };
  if (p.songs.length >= LIMITS.songs) return { state: st, added: false, why: 'full' };
  return { state: edit(st, pid, (x) => ({ ...x, songs: [...x.songs, songId], upd: now })), added: true };
}
export const removeSong = (st, pid, songId) => edit(st, pid, (p) => ({ ...p, songs: p.songs.filter((s) => s !== songId) }));
/** moves the song at `from` to `to` (clamped to the list) */
export function moveSong(st, pid, from, to) {
  return edit(st, pid, (p) => {
    const songs = p.songs.slice(), n = songs.length;
    if (from < 0 || from >= n) return p;
    const [s] = songs.splice(from, 1);
    songs.splice(Math.max(0, Math.min(n - 1, to)), 0, s);
    return { ...p, songs };
  });
}
/** songs gone from the Library leave every playlist and the played list */
export function prune(st, existing) {
  const played = {};
  for (const [k, v] of Object.entries(st.played)) if (existing.has(k)) played[k] = v;
  return { ...st, played, playlists: st.playlists.map((p) => ({ ...p, songs: p.songs.filter((s) => existing.has(s)) })) };
}

// ---------------------------------------------------------------------------------------------------------------- storage (versioned)
const num = (v, d) => (Number.isFinite(v) ? v : d);
function clean(o, now) {
  const playlists = (Array.isArray(o.playlists) ? o.playlists : [])
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string').slice(0, LIMITS.playlists)
    .map((p) => {
      const songs = (Array.isArray(p.songs) ? p.songs : []).filter((s, i, a) => typeof s === 'string' && a.indexOf(s) === i).slice(0, LIMITS.songs);
      return { id: p.id, name: tidy(p.name), songs, at: num(p.at, now), upd: num(p.upd, num(p.at, now)) };
    });
  const played = {};
  for (const [k, v] of Object.entries(o.played && typeof o.played === 'object' ? o.played : {})) if (Number.isFinite(v)) played[k] = v;
  return { v: 1, base: num(o.base, now), playlists, played };
}
/** the saved state, cleaned; nothing saved yet (or broken) = a fresh one whose badge starts now. A version this code doesn't know
 *  (a newer p0pc0rn wrote it) is kept aside once under KEY + '.v<n>' and never overwritten blindly */
export function loadState(storage, now) {
  let raw = null;
  try { raw = storage.getItem(KEY); } catch (e) { return freshState(now); }
  if (raw == null) return freshState(now);
  let o = null;
  try { o = JSON.parse(raw); } catch (e) { return freshState(now); }
  if (!o || typeof o !== 'object') return freshState(now);
  if (o.v !== 1) {
    try { if (Number.isFinite(o.v) && storage.getItem(KEY + '.v' + o.v) == null) storage.setItem(KEY + '.v' + o.v, raw); } catch (e) { /* full */ }
    return freshState(now);
  }
  return clean(o, now);
}
/** -> false when the phone's storage is full (nothing thrown) */
export function saveState(storage, st) {
  try { storage.setItem(KEY, JSON.stringify(st)); return true; } catch (e) { return false; }
}

// ---------------------------------------------------------------------------------------------------------------- the lock screen
/** wires every action this browser supports (an unsupported one throws on setActionHandler: skipped) -> the wired names */
export function wireMediaSession(ms, handlers) {
  const wired = [];
  if (!ms || typeof ms.setActionHandler !== 'function') return wired;
  for (const a of ACTIONS) {
    const fn = handlers[a];
    if (!fn) continue;
    try { ms.setActionHandler(a, (d) => fn(d || {})); wired.push(a); } catch (e) { /* this browser has no such action */ }
  }
  return wired;
}
/** MediaMetadata init: the song's own cover (its Library thumb, 432 x 432) or the app icon */
export function metadataFor(song, { album = '', artwork = '' } = {}) {
  return { title: songTitle(song), artist: 'p0pc0rn', album: album || 'Songs',
    artwork: artwork ? [{ src: artwork, sizes: '432x432', type: 'image/jpeg' }] : ICONS.map((x) => ({ ...x })) };
}
/** setPositionState's argument, or null when there is no length yet (Safari throws on NaN or position > duration) */
export function positionState(duration, position, rate = 1) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const p = Math.min(duration, Math.max(0, Number.isFinite(position) ? position : 0));
  return { duration, position: p, playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1 };
}

// ---------------------------------------------------------------------------------------------------------------- the player
/** createPlayer({audio, load, release, ms, MediaMetadata, song, onPlayed, onChange, silentSrc, rng, now})
 *  audio: the ONE audio element; load(id) -> {src, art} object URLs or null (the song is gone); release(url) frees one; ms:
 *  navigator.mediaSession (or null); song(id) -> its Library meta; onPlayed(id) once per song start; onChange(state) after every change.
 *  -> {playList(ids, start, {label, shuffle}), play, pause, toggle, next, prev, seek, setShuffle, cycleRepeat, removed, state, destroy} */
export function createPlayer({ audio, load, release = () => {}, ms = null, MediaMetadata = null, song = () => null, onPlayed = () => {},
  onChange = () => {}, silentSrc = '', rng = Math.random, now = Date.now }) {
  let q = makeQueue([], 0), label = '', unlocked = false, playing = false, loading = false, cur = null, errors = 0, error = '', blocked = false;
  let switching = false, token = 0, posAt = 0, lastStarted = null;
  const silent = () => !!silentSrc && audio.src === silentSrc;
  const dur = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : ((song(current(q)) || {}).duration || 0));
  const state = () => ({ id: current(q), playing, loading, position: audio.currentTime || 0, duration: dur(), shuffle: q.shuffle, repeat: q.repeat,
    label, queue: q.order.slice(), error, blocked });
  const changed = () => { try { onChange(state()); } catch (e) { /* the screen's problem, not the player's */ } };
  const setPB = (s) => { if (ms) try { ms.playbackState = s; } catch (e) { /* */ } };
  const setPos = () => {
    if (!ms || typeof ms.setPositionState !== 'function') return;
    const p = positionState(audio.duration, audio.currentTime, audio.playbackRate || 1);
    if (p) try { ms.setPositionState(p); } catch (e) { /* */ }
  };
  const setMeta = (id, art) => {
    if (!ms || !MediaMetadata) return;
    try { ms.metadata = new MediaMetadata(metadataFor(song(id), { album: label, artwork: art })); } catch (e) { /* */ }
  };
  const free = (c) => { if (!c) return; release(c.src); if (c.art) release(c.art); };
  // the first tap of the page: a silent clip plays inside the tap, so iOS lets this element play the song once it has loaded
  const unlock = () => {
    if (unlocked || !silentSrc) return;
    unlocked = true;
    try {
      switching = true; audio.src = silentSrc; switching = false;
      const p = audio.play();
      if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotAllowedError') unlocked = false; });
    } catch (e) { switching = false; unlocked = false; }
  };
  const stop = () => { playing = false; loading = false; setPB('paused'); changed(); };

  async function resume() {
    try {
      const p = audio.play();
      if (p && p.then) await p;
      playing = true; blocked = false; error = '';
      setPB('playing'); setPos();
      const id = current(q);
      if (id && lastStarted !== id) { lastStarted = id; onPlayed(id); }
    } catch (e) {
      playing = false; setPB('paused');
      if (e && e.name === 'NotAllowedError') blocked = true;   // no tap yet in this page (iOS): the UI says "tap play"
    }
    changed();
  }
  /** loads the queue's current song (restart = the same song from 0, no reload) and plays it, unless autoplay is false */
  async function startTrack(restart, autoplay = true) {
    const id = current(q), my = ++token;
    if (id == null) return stop();
    if (restart && cur && cur.id === id) { audio.currentTime = 0; lastStarted = null; return autoplay ? resume() : stop(); }
    loading = true; changed();
    let got = null;
    try { got = await load(id); } catch (e) { got = null; }
    if (my !== token) { free(got); return; }   // a newer tap won
    loading = false;
    if (!got) return failed();
    const old = cur;
    cur = { id, src: got.src, art: got.art || '' };
    switching = true; try { audio.src = got.src; } finally { switching = false; }
    free(old);
    setMeta(id, cur.art);
    return autoplay ? resume() : stop();
  }
  function failed() {
    errors++;
    if (errors >= MAX_ERRORS) { error = "Couldn't play these songs"; return stop(); }
    const r = next({ ...q, repeat: q.repeat === 'one' ? 'all' : q.repeat }, { auto: true });   // a song that won't play never repeats
    q = { ...r.q, repeat: q.repeat };
    if (!r.play) return stop();
    return startTrack(false);
  }
  function ended() {
    errors = 0;   // it played to the end
    const r = next(q, { auto: true });
    q = r.q;
    if (!r.play) return stop();
    return startTrack(!!r.restart);
  }

  audio.addEventListener('play', () => { if (silent() || playing) return; playing = true; setPB('playing'); changed(); });
  // a call, a route change, the system. Not the pause a browser fires when a song reaches its end (just before 'ended'): the lock
  // screen must not flip to paused between two songs (with the screen locked, iOS could take that as the end of the music)
  audio.addEventListener('pause', () => { if (switching || silent() || !playing || audio.ended) return; playing = false; setPB('paused'); changed(); });
  audio.addEventListener('ended', () => { if (silent()) return; ended(); });
  audio.addEventListener('error', () => { if (silent() || !cur) return; failed(); });
  audio.addEventListener('loadedmetadata', () => { if (silent()) return; setPos(); changed(); });
  audio.addEventListener('timeupdate', () => {
    if (silent()) return;
    if ((audio.currentTime || 0) > 2) errors = 0;
    const t = now(); if (t - posAt > 5000) { posAt = t; setPos(); }
    changed();
  });

  const api = {
    /** a tap on a song or on Play / Shuffle: call it straight from the tap handler (the unlock must happen inside the tap) */
    playList(ids, start = 0, o = {}) {
      unlock();
      label = String(o.label || '');
      q = makeQueue(ids, start, { repeat: q.repeat });
      if (o.shuffle) q = setShuffle(q, true, rng);
      errors = 0; error = ''; blocked = false;
      return startTrack(false);
    },
    play() { unlock(); if (cur && cur.id === current(q) && !silent()) return resume(); return startTrack(false); },
    pause() { try { audio.pause(); } catch (e) { /* */ } playing = false; setPB('paused'); changed(); },
    toggle() { return playing ? api.pause() : api.play(); },
    next() {
      const r = next(q, { auto: false });
      q = r.q;
      if (r.play) return startTrack(!!r.restart);
      api.pause(); return startTrack(false, false);   // the end: the first song, loaded and stopped
    },
    prev() { const r = prev(q, audio.currentTime || 0); q = r.q; return startTrack(!!r.restart); },
    seek(t) {
      if (!Number.isFinite(t)) return;
      const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
      audio.currentTime = Math.max(0, Math.min(d, t)); setPos(); changed();
    },
    setShuffle(on) { q = setShuffle(q, !!on, rng); changed(); },
    cycleRepeat() { q = cycleRepeat(q); changed(); },
    removed(ids) { q = removeIds(q, new Set(ids)); changed(); },
    state,
    current: () => cur && cur.id,
    destroy() { try { audio.pause(); } catch (e) { /* */ } free(cur); cur = null; },
  };
  wireMediaSession(ms, {
    play: () => api.play(), pause: () => api.pause(), stop: () => api.pause(),
    nexttrack: () => api.next(), previoustrack: () => api.prev(),
    seekto: (d) => api.seek(d.seekTime),
    seekforward: (d) => api.seek((audio.currentTime || 0) + (d.seekOffset || SKIP)),
    seekbackward: (d) => api.seek((audio.currentTime || 0) - (d.seekOffset || SKIP)),
  });
  return api;
}
