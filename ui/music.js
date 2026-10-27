// music.js - 3.9 Music: the songs (and voice lines) of the Library, playlists, a now-playing bar and a full player, with the lock
// screen's controls and the song's cover (Media Session). ui/music_core.js decides (queue, playlists, the player); this file draws the
// screen and wires the ONE audio element the page keeps for the whole visit. With the phone-OS shell (ui/shell.js) Music is the dock's
// screen (SHELL.register); without it Music opens over the app from a Music button at the top of the Library.
// Nothing leaves the phone: songs play from the Library's own files, playlists live in this phone's storage (music_core.js KEY).
import * as core from './music_core.js';
import { $, clock } from '../util.js';

const SVGNS = 'http://www.w3.org/2000/svg';
// icons the app's sprite lacks, drawn the sprite's way (24 x 24, strokes)
const PATHS = {
  next: ['M6 6.5v11l8-5.5-8-5.5Z', 'M17.5 6v12'],
  prev: ['M18 6.5v11l-8-5.5 8-5.5Z', 'M6.5 6v12'],
  shuffle: ['M4 7h3c2.4 0 3.8 1.3 4.8 3.3l1.4 3c1 2 2.4 3.7 4.8 3.7H20', 'M17.5 14.5 20 17l-2.5 2.5', 'M4 17h3c1.5 0 2.6-.6 3.5-1.6',
    'M14 8.3c.9-.8 1.9-1.3 3.4-1.3H20', 'M17.5 4.5 20 7l-2.5 2.5'],
  repeat: ['M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H19', 'M16.5 4 19 6.5 16.5 9', 'M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H5', 'M7.5 20 5 17.5 7.5 15'],
  repeat1: ['M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H19', 'M16.5 4 19 6.5 16.5 9', 'M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H5', 'M7.5 20 5 17.5 7.5 15',
    'M11 10.3l1.4-.8v5'],
  grip: ['M6 9h12', 'M6 12h12', 'M6 15h12'],
  down: ['m6 9.5 6 6 6-6'],
};
function ic(name, cls = 'ic') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.setAttribute('viewBox', '0 0 24 24');
  if (PATHS[name]) for (const d of PATHS[name]) { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); s.append(p); }
  else { const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', '#i-' + name); s.append(u); }
  return s;
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, label, icon, text) {
  const b = el('button', cls); b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  if (icon) b.append(ic(icon));
  if (text) b.append(el('span', '', text));
  return b;
}
/** 0.1 s of silence (8 kHz mono WAV): what the page's first tap plays, so iOS lets the one audio element play songs from then on */
function silentWav() {
  const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return new Blob([b], { type: 'audio/wav' });
}
const newId = () => 'pl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const REPEAT_LABEL = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this song' };

/** createMusic(api) -> {screen, open, close, badge, libChanged, pause, player}
 *  api: {lib() -> the Library's metas, getBlob(id) -> Blob, toast(text, o), sheet(id, title) -> {sheet, close},
 *        confirm(title, text, ok, fn), diag(step, data)} */
export function createMusic(api) {
  const view = $('v-music');
  if (!view) throw new Error('no Music screen in this page');
  const store = (() => { try { const s = window.localStorage; s.getItem(core.KEY); return s; } catch (e) { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; } })();
  let st = core.loadState(store, Date.now());
  core.saveState(store, st);   // Music's first look: songs made from now on count as new on its badge
  let tab = 'songs', listId = null, shown = false, overlaid = false, fullOpen = false, seeking = false, lastUi = '';
  const known = new Set(), arts = new Map();
  const save = () => { if (!core.saveState(store, st) && api.toast) api.toast('This phone’s storage is full: playlists could not be saved'); };
  const songs = () => core.songsOf(api.lib());
  const tests = new Map();   // the phone check's tones (never in the Library): id -> {meta, blob}
  const byId = (id) => (tests.has(id) ? tests.get(id).meta : songs().find((m) => m.id === id) || null);

  // ---- the one audio element, kept for the whole visit
  const audio = document.createElement('audio');
  audio.id = 'mu-audio'; audio.preload = 'auto'; audio.hidden = true; audio.setAttribute('playsinline', '');
  document.body.append(audio);
  const silence = URL.createObjectURL(silentWav());
  const player = core.createPlayer({
    audio, silentSrc: silence, ms: navigator.mediaSession || null, MediaMetadata: typeof MediaMetadata === 'function' ? MediaMetadata : null,
    song: byId,
    async load(id) {
      const blob = tests.has(id) ? tests.get(id).blob : await api.getBlob(id);
      if (!blob) return null;
      const m = byId(id);
      return { src: URL.createObjectURL(blob), art: m && m.thumb instanceof Blob ? URL.createObjectURL(m.thumb) : '' };
    },
    release: (u) => { try { URL.revokeObjectURL(u); } catch (e) { /* */ } },
    onPlayed(id) { if (tests.has(id)) return; st = core.markPlayed(st, id, Date.now()); save(); badgeNow(); },
    onChange: (s) => update(s),
  });
  let appPausing = false;   // the next 'pause' is p0pc0rn's own (the phone check counts the others: a call, a voice assistant, headphones out)
  const pauseByApp = () => { appPausing = true; player.pause(); };
  const toggle = () => (player.state().playing ? pauseByApp() : player.play());
  // one sound at a time: Music pauses for any other sound of the app (a song or a music video in the viewer) and pauses those for it
  document.addEventListener('play', (e) => {
    const m = e.target;
    if (m === audio) { if (audio.src !== silence) for (const o of document.querySelectorAll('audio, video')) if (o !== audio && !o.paused && !o.muted) o.pause(); return; }
    if (m instanceof HTMLMediaElement && !m.muted && player.state().playing) pauseByApp();
  }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(player.state()); });

  // ---- badge
  const count = () => core.newCount(st, songs());
  function badgeNow() {
    const n = count();
    try { if (globalThis.SHELL && globalThis.SHELL.badge) globalThis.SHELL.badge('music', n); } catch (e) { /* */ }
    const b = $('mu-entry'); if (b) { if (n) b.dataset.badge = String(n); else delete b.dataset.badge; }
  }

  // ---- covers: one object URL per song shown, freed when Music closes
  function artUrl(m) {
    if (!m || !(m.thumb instanceof Blob)) return '';
    let u = arts.get(m.id);
    if (!u) { u = URL.createObjectURL(m.thumb); arts.set(m.id, u); }
    return u;
  }
  function freeArts() { for (const u of arts.values()) { try { URL.revokeObjectURL(u); } catch (e) { /* */ } } arts.clear(); }
  const sub = (m) => [clock(m.duration || m.seconds || 0), m.kind === 'say' ? 'Voice' : '', m.bpm ? m.bpm + ' BPM' : ''].filter(Boolean).join(' · ');

  // ---- lists
  function songRow(m, onPlay, extra = {}) {
    const row = el('div', 'mu-row'); row.dataset.id = m.id; row.setAttribute('role', 'listitem');
    const hit = el('button', 'mu-hit'); hit.type = 'button'; hit.setAttribute('aria-label', 'Play ' + core.songTitle(m));
    const img = el('img', 'mu-art'); img.alt = ''; img.decoding = 'async'; const u = artUrl(m); if (u) img.src = u;
    const txt = el('span', 'mu-txt'); txt.append(el('span', 'mu-name', core.songTitle(m)), el('span', 'mu-sub', sub(m)));
    const eq = el('span', 'mu-eq'); eq.setAttribute('aria-hidden', 'true'); eq.append(el('i'), el('i'), el('i'));
    hit.append(img, txt, eq); hit.addEventListener('click', onPlay);
    row.append(hit);
    if (extra.grip) row.append(extra.grip);
    if (extra.menu) { const more = btn('mu-more', 'More for ' + core.songTitle(m), 'more'); more.addEventListener('click', extra.menu); row.append(more); }
    return row;
  }
  function empty(text) { const d = el('div', 'mu-empty'); d.append(ic('note'), el('p', 'body dim', text)); return d; }
  function renderSongs() {
    const pane = $('mu-songs'); pane.hidden = false; pane.textContent = '';
    if (ck) pane.append(checkCard());
    const list = songs(), ids = list.map((m) => m.id);
    if (!list.length) { pane.append(empty('Songs you make show here. Ask Juli for a song, or make one on Create.')); return; }
    const top = el('div', 'mu-actions');
    const play = btn('btn sm', null, 'play', 'Play'); play.id = 'mu-play-all';
    play.addEventListener('click', () => player.playList(ids, 0, { label: 'Songs' }));
    const shuf = btn('btn sm', null, 'shuffle', 'Shuffle'); shuf.id = 'mu-shuffle-all';
    shuf.addEventListener('click', () => player.playList(ids, Math.floor(Math.random() * ids.length), { label: 'Songs', shuffle: true }));
    top.append(play, shuf);
    const rows = el('div', 'mu-rows'); rows.setAttribute('role', 'list');
    list.forEach((m, i) => rows.append(songRow(m, () => player.playList(ids, i, { label: 'Songs' }), { menu: () => songMenu(m, null) })));
    pane.append(top, rows);
  }
  function renderLists() {
    const pane = $('mu-lists'); pane.hidden = false; pane.textContent = '';
    const make = el('div', 'mu-new');
    const input = el('input', 'mu-input'); input.id = 'mu-new-name'; input.type = 'text'; input.maxLength = core.LIMITS.name;
    input.placeholder = 'New playlist'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'New playlist name'); input.enterKeyHint = 'done';
    const go = btn('btn sm', null, null, 'Create'); go.id = 'mu-new-go';
    const create = () => { const p = newPlaylist(input.value); if (p) { input.value = ''; listId = p; render(); } };
    go.addEventListener('click', create);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    make.append(input, go); pane.append(make);
    if (!st.playlists.length) { pane.append(empty('No playlists yet. Name one above, then add songs from a song’s ••• menu.')); return; }
    const box = el('div', 'list mu-pls');
    for (const p of st.playlists) {
      const n = p.songs.filter((id) => byId(id)).length;
      const b = el('button', 'li mu-pl-row'); b.type = 'button'; b.dataset.pl = p.id;
      b.append(el('span', 'mu-pl-name', p.name), el('span', 'dim', n === 1 ? '1 song' : n + ' songs'));
      b.addEventListener('click', () => { listId = p.id; render(); });
      box.append(b);
    }
    pane.append(box);
  }
  function renderList() {
    const p = st.playlists.find((x) => x.id === listId);
    if (!p) { listId = null; return render(); }
    const pane = $('mu-list'); pane.hidden = false; pane.textContent = '';
    const head = el('div', 'mu-pl-head');
    const back = btn('mini mu-back', 'Back to playlists', null, 'Playlists'); back.id = 'mu-back';
    back.prepend(ic('chevron', 'ic mu-flip'));
    back.addEventListener('click', () => { listId = null; render(); });
    const name = el('h3', 'mu-pl-title', p.name); name.id = 'mu-pl-title';
    const tools = el('span', 'li-end');
    const ren = btn('mini', null, null, 'Rename'); ren.id = 'mu-pl-rename'; ren.addEventListener('click', () => renameSheet(p));
    const del = btn('mini mu-danger', null, null, 'Delete'); del.id = 'mu-pl-delete';
    del.addEventListener('click', () => api.confirm('Delete this playlist?', `“${p.name}” goes; its songs stay in your Library.`, 'Delete playlist', () => {
      st = core.deletePlaylist(st, p.id); save(); listId = null; render();
    }));
    tools.append(ren, del); head.append(back, name, tools); pane.append(head);
    const metas = p.songs.map(byId).filter(Boolean), ids = metas.map((m) => m.id);
    const top = el('div', 'mu-actions');
    const play = btn('btn sm', null, 'play', 'Play'); play.id = 'mu-pl-play'; play.disabled = !ids.length;
    play.addEventListener('click', () => player.playList(ids, 0, { label: p.name }));
    const shuf = btn('btn sm', null, 'shuffle', 'Shuffle'); shuf.id = 'mu-pl-shuffle'; shuf.disabled = !ids.length;
    shuf.addEventListener('click', () => player.playList(ids, Math.floor(Math.random() * ids.length), { label: p.name, shuffle: true }));
    const add = btn('btn sm', null, 'note', 'Add songs'); add.id = 'mu-pl-add'; add.addEventListener('click', () => addSongsSheet(p));
    top.append(play, shuf, add); pane.append(top);
    if (!metas.length) { pane.append(empty('This playlist is empty. Add songs to it.')); return; }
    const rows = el('div', 'mu-rows'); rows.setAttribute('role', 'list');
    metas.forEach((m, i) => {
      const grip = el('span', 'mu-grip'); grip.append(ic('grip')); grip.setAttribute('aria-hidden', 'true');
      const row = songRow(m, () => player.playList(ids, i, { label: p.name }), { grip, menu: () => songMenu(m, p) });
      dragToReorder(grip, row, rows, p);
      rows.append(row);
    });
    pane.append(rows);
  }
  /** a long list reorders by dragging a row's grip (touch or mouse); the ••• menu also has Move up / Move down */
  function dragToReorder(grip, row, rows, p) {
    let start = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
      const all = [...rows.children];
      start = { y: e.clientY, from: all.indexOf(row), h: row.getBoundingClientRect().height || 56 };
      row.classList.add('drag');
    });
    grip.addEventListener('pointermove', (e) => { if (start) row.style.transform = `translateY(${e.clientY - start.y}px)`; });
    const end = (e) => {
      if (!start) return;
      const to = start.from + Math.round((e.clientY - start.y) / start.h), from = start.from;
      start = null; row.classList.remove('drag'); row.style.transform = '';
      if (to !== from) { const ids = p.songs.filter((id) => byId(id)); const real = p.songs.indexOf(ids[from]), dest = p.songs.indexOf(ids[Math.max(0, Math.min(ids.length - 1, to))]);
        st = core.moveSong(st, p.id, real, dest); save(); render(); }
    };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }

  // ---- sheets: a song's menu, the playlist picker, renaming, adding songs
  function sheetBtn(text, fn, cls = 'btn sm') { const b = btn(cls, null, null, text); b.addEventListener('click', fn); return b; }
  function newPlaylist(name) {
    const r = core.createPlaylist(st, name, Date.now(), newId());
    if (r.why === 'full') { api.toast(`You have ${core.LIMITS.playlists} playlists: delete one first`); return null; }
    st = r.state; save(); return r.id;
  }
  function songMenu(m, p) {
    const { sheet, close } = api.sheet('mu-menu', core.songTitle(m));
    sheet.append(sheetBtn('Add to a playlist…', () => { close(); pickPlaylist(m); }));
    if (p) {
      const i = p.songs.indexOf(m.id);
      const mv = (to) => { st = core.moveSong(st, p.id, i, to); save(); close(); render(); };
      if (i > 0) sheet.append(sheetBtn('Move up', () => mv(i - 1)));
      if (i < p.songs.length - 1) sheet.append(sheetBtn('Move down', () => mv(i + 1)));
      sheet.append(sheetBtn('Remove from this playlist', () => { st = core.removeSong(st, p.id, m.id); save(); close(); render(); }, 'btn sm mu-danger'));
    }
    sheet.append(sheetBtn('Cancel', close, 'btn ghost'));
  }
  function pickPlaylist(m) {
    const { sheet, close } = api.sheet('mu-pick', 'Add to a playlist');
    const added = (pid, name) => {
      const r = core.addSong(st, pid, m.id, Date.now());
      if (r.added) { st = r.state; save(); api.toast(`Added to “${name}”`); }
      else api.toast(r.why === 'already' ? `Already in “${name}”` : r.why === 'full' ? `“${name}” is full (${core.LIMITS.songs} songs)` : 'That playlist is gone');
      close(); render();
    };
    for (const p of st.playlists) { const b = sheetBtn(p.name, () => added(p.id, p.name)); b.dataset.pl = p.id; sheet.append(b); }
    const row = el('div', 'mu-new');
    const input = el('input', 'mu-input'); input.id = 'mu-pick-name'; input.type = 'text'; input.maxLength = core.LIMITS.name; input.placeholder = 'New playlist';
    input.setAttribute('aria-label', 'New playlist name'); input.autocomplete = 'off';
    const go = sheetBtn('Create and add', () => { const id = newPlaylist(input.value); if (id) added(id, st.playlists.find((x) => x.id === id).name); });
    go.id = 'mu-pick-go';
    row.append(input, go); sheet.append(row, sheetBtn('Cancel', close, 'btn ghost'));
  }
  function renameSheet(p) {
    const { sheet, close } = api.sheet('mu-rename', 'Rename the playlist');
    const input = el('input', 'mu-input'); input.id = 'mu-rename-name'; input.type = 'text'; input.maxLength = core.LIMITS.name; input.value = p.name;
    input.setAttribute('aria-label', 'Playlist name'); input.autocomplete = 'off';
    const done = () => { st = core.renamePlaylist(st, p.id, input.value, Date.now()); save(); close(); render(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
    const ok = sheetBtn('Save', done); ok.id = 'mu-rename-go';
    sheet.append(input, ok, sheetBtn('Cancel', close, 'btn ghost'));
  }
  function addSongsSheet(p) {
    const { sheet, close } = api.sheet('mu-add', `Add to “${p.name}”`);
    const box = el('div', 'list mu-add-list');
    for (const m of songs()) {
      const on = () => (st.playlists.find((x) => x.id === p.id) || p).songs.includes(m.id);
      const b = el('button', 'li mu-add-row'); b.type = 'button'; b.dataset.id = m.id;
      const mark = el('span', 'mu-mark'); const name = el('span', 'mu-pl-name', core.songTitle(m));
      const paint = () => { mark.textContent = ''; if (on()) mark.append(ic('check')); b.setAttribute('aria-pressed', String(on())); };
      b.append(name, mark); paint();
      b.addEventListener('click', () => {
        if (on()) st = core.removeSong(st, p.id, m.id);
        else { const r = core.addSong(st, p.id, m.id, Date.now()); if (!r.added) return api.toast(r.why === 'full' ? `“${p.name}” is full` : 'That playlist is gone'); st = r.state; }
        save(); paint();
      });
      box.append(b);
    }
    if (!box.children.length) box.append(el('p', 'li dim', 'No songs in your Library yet.'));
    sheet.append(box, sheetBtn('Done', () => { close(); render(); }));
  }

  // ---- the now-playing bar and the full player (built once)
  const bar = $('mu-bar'), full = $('mu-full');
  const barArt = el('img', 'mu-art'); barArt.alt = '';
  const barName = el('span', 'mu-name'), barSub = el('span', 'mu-sub');
  const barTxt = el('span', 'mu-txt'); barTxt.append(barName, barSub);
  const barOpen = el('button', 'mu-bar-open'); barOpen.type = 'button'; barOpen.id = 'mu-bar-open'; barOpen.setAttribute('aria-label', 'Open the player');
  barOpen.append(barArt, barTxt); barOpen.addEventListener('click', () => openFull());
  const barPlay = btn('mu-ctl-btn', 'Play', 'play'); barPlay.id = 'mu-bar-play'; barPlay.addEventListener('click', toggle);
  const barNext = btn('mu-ctl-btn', 'Next song', 'next'); barNext.id = 'mu-bar-next'; barNext.addEventListener('click', () => player.next());
  bar.append(barOpen, barPlay, barNext);

  const fClose = btn('mu-down', 'Close the player', 'down'); fClose.id = 'mu-full-close'; fClose.addEventListener('click', () => closeFull());
  const fArt = el('img', 'mu-full-art'); fArt.alt = ''; fArt.id = 'mu-full-art';
  const fName = el('p', 'mu-full-name'); fName.id = 'mu-full-name';
  const fSub = el('p', 'mu-full-sub'); fSub.id = 'mu-full-sub';
  const seek = el('input', 'mu-seek'); seek.id = 'mu-seek'; seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.step = '1'; seek.value = '0';
  seek.setAttribute('aria-label', 'Position in the song');
  const t0 = el('span', '', '0:00'), t1 = el('span', '', '0:00'); t0.id = 'mu-t0'; t1.id = 'mu-t1';
  const times = el('div', 'mu-times'); times.append(t0, t1);
  const fShuf = btn('mu-ctl-btn mu-tog', 'Shuffle', 'shuffle'); fShuf.id = 'mu-shuf';
  const fPrev = btn('mu-ctl-btn', 'Previous song', 'prev'); fPrev.id = 'mu-prev';
  const fPlay = btn('mu-ctl-btn mu-big', 'Play', 'play'); fPlay.id = 'mu-play';
  const fNext = btn('mu-ctl-btn', 'Next song', 'next'); fNext.id = 'mu-next';
  const fRep = btn('mu-ctl-btn mu-tog', REPEAT_LABEL.off, 'repeat'); fRep.id = 'mu-rep';
  const ctl = el('div', 'mu-ctls'); ctl.append(fShuf, fPrev, fPlay, fNext, fRep);
  const msg = el('p', 'mu-msg footnote'); msg.id = 'mu-msg'; msg.hidden = true;
  const inner = el('div', 'mu-full-in'); inner.append(fClose, fArt, fName, fSub, seek, times, ctl, msg);
  full.append(inner);
  fShuf.addEventListener('click', () => player.setShuffle(!player.state().shuffle));
  fPrev.addEventListener('click', () => player.prev());
  fPlay.addEventListener('click', toggle);
  fNext.addEventListener('click', () => player.next());
  fRep.addEventListener('click', () => player.cycleRepeat());
  seek.addEventListener('input', () => { seeking = true; const s = player.state(); t0.textContent = clock((+seek.value / 1000) * (s.duration || 0)); });
  seek.addEventListener('change', () => { const s = player.state(); player.seek((+seek.value / 1000) * (s.duration || 0)); seeking = false; });
  // swipe the player down to close it, by the cover or the chevron (touch-action: none there, so the page does not take it as a scroll)
  let drag = null;
  fArt.draggable = false;
  inner.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.mu-full-art, .mu-down')) return;
    drag = { y: e.clientY };
    try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
  });
  inner.addEventListener('pointermove', (e) => { if (drag) { const dy = Math.max(0, e.clientY - drag.y); inner.style.transform = dy ? `translateY(${dy}px)` : ''; } });
  const dragEnd = (e) => { if (!drag) return; const dy = e.clientY - drag.y; drag = null; inner.style.transform = ''; if (dy > 90) closeFull(); };
  inner.addEventListener('pointerup', dragEnd); inner.addEventListener('pointercancel', dragEnd);

  function openFull() { if (!player.state().id) return; fullOpen = true; full.hidden = false; full.classList.add('in'); update(player.state()); fClose.focus({ preventScroll: true }); }
  function closeFull() { if (!fullOpen) return; fullOpen = false; full.classList.remove('in'); full.hidden = true; }

  /** after every player change (timeupdate included: cheap, and only while Music shows) */
  function update(s) {
    if (!shown && !fullOpen) return;
    const m = s.id ? byId(s.id) : null;
    const key = [s.id, s.playing, s.loading, s.shuffle, s.repeat, s.error, s.blocked].join('|');
    if (key !== lastUi) {
      lastUi = key;
      for (const r of view.querySelectorAll('.mu-row')) { const on = r.dataset.id === s.id; r.classList.toggle('on', on); r.classList.toggle('playing', on && s.playing); }
      bar.hidden = !s.id || !m;
      const name = m ? core.songTitle(m) : '', art = m ? artUrl(m) : '';
      barName.textContent = name; barSub.textContent = s.label || 'Songs';
      if (art) barArt.src = art; else barArt.removeAttribute('src');
      for (const [b, big] of [[barPlay, false], [fPlay, true]]) {
        b.textContent = ''; b.append(ic(s.playing ? 'pause' : 'play')); b.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
        b.classList.toggle('mu-big', big);
      }
      fName.textContent = name; fSub.textContent = s.label || 'Songs';
      if (art) fArt.src = art; else fArt.removeAttribute('src');
      fShuf.setAttribute('aria-pressed', String(!!s.shuffle));
      fRep.textContent = ''; fRep.append(ic(s.repeat === 'one' ? 'repeat1' : 'repeat'));
      fRep.setAttribute('aria-pressed', String(s.repeat !== 'off')); fRep.setAttribute('aria-label', REPEAT_LABEL[s.repeat] || REPEAT_LABEL.off); fRep.dataset.mode = s.repeat;
      const text = s.error || (s.blocked ? 'Tap play to start the music.' : s.loading ? 'Loading…' : '');
      msg.hidden = !text; msg.textContent = text;
    }
    if (fullOpen && !seeking) {
      const d = s.duration || 0;
      seek.value = d ? String(Math.round((s.position / d) * 1000)) : '0';
      t0.textContent = clock(s.position); t1.textContent = clock(d);
    }
  }

  // ---- the one-button phone check: what only a phone proves (the screen locked, the next song starting by itself, the lock screen's
  // buttons, a call or headphones pausing it). Three generated tones (never in the Library) whose titles say what to do, a log, and a
  // results card with Copy. Opens with #music-check in the address, or MUSIC.check() from a test button.
  const CHECK = [
    { id: 'check-1', title: 'Check 1 of 3 · lock your phone now', sec: 30, hz: 392 },
    { id: 'check-2', title: 'Check 2 of 3 · this one started by itself', sec: 30, hz: 494 },
    { id: 'check-3', title: 'Check 3 of 3 · try the lock screen buttons', sec: 45, hz: 587 },
  ];
  let ck = null, card = null, ckT = 0;
  /** a soft beeping tone (WAV, 22 kHz mono): one beep a second, so a locked phone can be heard playing */
  function toneWav(sec, hz) {
    const rate = 22050, n = Math.round(sec * rate), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const ph = (i % rate) / rate, env = ph < 0.25 ? Math.sin(Math.PI * ph / 0.25) : 0; v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 7000 * env), true); }
    return new Blob([b], { type: 'audio/wav' });
  }
  const ckLog = (e) => {
    if (!ck || !ck.started) return;
    ck.log.push({ t: Math.round((performance.now() - ck.t0) / 100) / 10, e, hidden: document.hidden });
    if (ck.log.length > 400) ck.log.shift();
    clearTimeout(ckT); ckT = setTimeout(paintCheck, 250);
  };
  let lastT = 0;
  audio.addEventListener('play', () => { if (audio.src !== silence) ckLog('play: ' + ((byId(player.state().id) || {}).title || '')); });
  audio.addEventListener('pause', () => {
    if (audio.src === silence || audio.ended) { appPausing = false; return; }
    const mine = appPausing; appPausing = false;
    if (!ck || !ck.started) return;
    ckLog(mine ? 'pause (by p0pc0rn)' : 'pause (by the phone: a call, a voice assistant, headphones out…)');
    if (!mine) ck.interruptions++;
  });
  audio.addEventListener('ended', () => { if (audio.src !== silence) ckLog('ended'); });
  audio.addEventListener('error', () => ckLog('error: the song would not play'));
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    if (ck && ck.started && document.hidden && !audio.paused && t > lastT && t - lastT < 5) ck.hiddenPlay += t - lastT;
    lastT = t;
  });
  document.addEventListener('visibilitychange', () => ckLog(document.hidden ? 'screen locked (or p0pc0rn hidden)' : 'back in p0pc0rn'));
  function wireLogged() {   // the lock screen's buttons, logged, then the player's usual answer
    const act = (name, fn) => (d) => { if (ck) { ck.actions.add(name); ckLog('lock screen: ' + name); } fn(d); };
    core.wireMediaSession(navigator.mediaSession || null, {
      play: act('play', () => player.play()), pause: act('pause', () => pauseByApp()), stop: act('stop', () => pauseByApp()),
      nexttrack: act('next', () => player.next()), previoustrack: act('previous', () => player.prev()),
      seekto: act('seek', (d) => player.seek(d.seekTime)),
      seekforward: act('seek forward', (d) => player.seek((audio.currentTime || 0) + (d.seekOffset || 10))),
      seekbackward: act('seek back', (d) => player.seek((audio.currentTime || 0) - (d.seekOffset || 10))),
    });
  }
  function startCheck() {   // inside the tap: the tones are made, then the first plays at once
    for (const s of CHECK) if (!tests.has(s.id)) tests.set(s.id, { meta: { id: s.id, media: 'audio', title: s.title, duration: s.sec, createdAt: 0 }, blob: toneWav(s.sec, s.hz) });
    Object.assign(ck, { started: true, done: false, t0: performance.now(), log: [], hiddenPlay: 0, actions: new Set(), interruptions: 0 });
    wireLogged();
    player.playList(CHECK.map((s) => s.id), 0, { label: 'p0pc0rn phone check' });
    paintCheck();
  }
  function checkText() {
    const ev = ck.log, ua = navigator.userAgent;
    const auto = ev.some((x, i) => x.e === 'ended' && x.hidden && ev.slice(i + 1, i + 5).some((y) => y.hidden && y.e.startsWith('play: Check')));
    const home = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } })();
    return [
      `p0pc0rn Music check · ${new Date().toLocaleString()}`,
      `${/iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : 'other'} · ${home ? 'Home Screen app' : 'in the browser'}`,
      `Played with the screen locked: ${Math.round(ck.hiddenPlay)} s (${ck.hiddenPlay >= 20 ? 'yes' : 'no: it stopped when the screen locked'})`,
      `The next song started by itself while locked: ${auto ? 'yes' : 'no'}`,
      `Lock screen buttons that reached p0pc0rn: ${[...ck.actions].join(', ') || 'none'}`,
      `Paused by the phone (a call, a voice assistant, headphones out): ${ck.interruptions}`,
      'Look and note: did the lock screen show the check\'s title, "p0pc0rn" and a cover?',
      'Events:', ...ev.map((x) => `  ${x.t.toFixed(1)} s${x.hidden ? ' [locked]' : ''}  ${x.e}`),
    ].join('\n');
  }
  function checkCard() {
    if (!card) { card = el('div', 'mu-check'); card.id = 'mu-check'; }
    card.textContent = '';
    card.append(el('p', 'mu-check-title', 'Phone check: songs with the screen locked'));
    if (!ck.started) {
      card.append(el('p', 'footnote', 'Three test tones play. Lock the phone during the first and wait: the second should start by itself. '
        + 'During the third, use the lock screen buttons (previous, next, pause, play) and look at what it shows. Then come back here.'));
      const go = btn('btn sm', null, 'play', 'Start the check'); go.id = 'mu-check-start'; go.addEventListener('click', startCheck); card.append(go);
      return card;
    }
    card.append(el('p', 'footnote', `${ck.log.length} events · ${Math.round(ck.hiddenPlay)} s played with the screen locked`));
    const row = el('div', 'mu-actions');
    const res = btn('btn sm', null, null, 'Results'); res.id = 'mu-check-results'; res.addEventListener('click', () => { ck.done = true; paintCheck(); });
    const again = btn('btn sm', null, null, 'Start again'); again.id = 'mu-check-again'; again.addEventListener('click', startCheck);
    row.append(res, again); card.append(row);
    if (ck.done) {
      const out = el('pre', 'mu-check-out', checkText()); out.id = 'mu-check-out';
      const copy = btn('btn sm', null, 'copy', 'Copy the results'); copy.id = 'mu-check-copy';
      copy.addEventListener('click', () => { const t = checkText(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error('no clipboard'))).then(() => api.toast('Copied'), () => api.toast('Couldn’t copy: select the text')); });
      card.append(out, copy);
    }
    return card;
  }
  function paintCheck() { if (ck && shown && !listId && tab === 'songs') { const p = $('mu-songs'), c2 = checkCard(); if (!p.contains(c2)) p.prepend(c2); } }
  function check() { ck = ck || { started: false }; tab = 'songs'; listId = null; open(); render(); }

  // ---- showing the screen
  function render() {
    if (!shown) return;
    for (const b of view.querySelectorAll('[data-mu-tab]')) b.setAttribute('aria-selected', String(b.dataset.muTab === (listId ? 'lists' : tab)));
    for (const id of ['mu-songs', 'mu-lists', 'mu-list']) $(id).hidden = true;
    if (listId) renderList(); else if (tab === 'lists') renderLists(); else renderSongs();
    lastUi = ''; update(player.state());
  }
  for (const b of view.querySelectorAll('[data-mu-tab]')) b.addEventListener('click', () => { tab = b.dataset.muTab; listId = null; render(); });
  function remember() { for (const m of songs()) known.add(m.id); }
  const screen = {
    id: 'music', title: 'Music', icon: '#i-note', view: 'v-music', dock: true, home: false, order: 3,   // the sprite's note until ART's icon lands
    badge: () => count(),
    onOpen() { shown = true; remember(); render(); },
    onClose() { shown = false; closeFull(); freeArts(); },   // the lock screen keeps its own cover (the player's)
  };
  function overlay(on) {
    overlaid = on; view.classList.toggle('mu-overlay', on); view.hidden = !on; $('mu-close').hidden = !on;
    document.documentElement.classList.toggle('mu-open', on);
    if (on) { screen.onOpen(); view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); } else screen.onClose();
  }
  function open() {
    const S = globalThis.SHELL;
    if (S && typeof S.open === 'function' && registered) return S.open('music');
    overlay(true);
  }
  function close() {
    if (overlaid) return overlay(false);
    const S = globalThis.SHELL; if (S && typeof S.home === 'function') S.home();
  }
  $('mu-close').addEventListener('click', close);
  // without the shell: a Music button at the top of the Library (with the badge)
  function entry() {
    if ($('mu-entry')) return;
    const lib = $('v-library'); if (!lib) return;
    const row = el('div', 'mu-entry-row'); row.id = 'mu-entry-row';
    const b = btn('btn sm mu-entry', 'Open Music', 'note', 'Music'); b.id = 'mu-entry'; b.addEventListener('click', open);
    row.append(b); lib.prepend(row);
  }
  let registered = false;
  const register = () => {
    try {
      const S = globalThis.SHELL;
      if (!S || typeof S.register !== 'function') return false;
      S.register(screen); registered = true;
      const r = $('mu-entry-row'); if (r) r.remove();
      if (overlaid) overlay(false);
      badgeNow(); return true;
    } catch (e) { if (api.diag) api.diag('music: shell register failed', { message: String((e && e.message) || e).slice(0, 160) }); return false; }
  };
  if (!register()) { entry(); addEventListener('p0:shell-ready', register, { once: true }); }
  remember(); badgeNow();

  /** the Library changed (a song saved, deleted, the first load): new songs join, deleted ones leave the queue and the playlists */
  function libChanged() {
    const now = new Set(songs().map((m) => m.id));
    const gone = [...known].filter((id) => !now.has(id));
    for (const id of now) known.add(id);
    if (gone.length) {
      for (const id of gone) known.delete(id);
      player.removed(gone);
      const goneSet = new Set(gone), keep = new Set([...st.playlists.flatMap((p) => p.songs), ...Object.keys(st.played)].filter((id) => !goneSet.has(id)));
      st = core.prune(st, keep); save();
    }
    badgeNow();
    if (shown) render();
  }
  if (/^#music-check\b/.test(location.hash)) setTimeout(check, 0);   // the phone check, opened by its address
  return { screen, open, close, badge: count, libChanged, pause: pauseByApp, check, player, register };
}
