// wallpaper.js - p0pc0rn 3.9: the home screen's wallpaper. Josh: "user can change the image behind the icons but the image is slightly
// blurred so the icons look clean and crisp". The person picks a picture from the Library or a photo; it is scaled down once (at most
// 720 px wide: a blurred layer needs no more, and the phone's memory goes to the models), kept in this phone's IndexedDB
// ('p0pc0rn-shell', nothing leaves the phone) and shown on one layer that CSS blurs. The default: ART's wallpaper when the build has one
// (icons/ui/index.json "wallpaper"), else a gradient from the app's own colours: no image at all.
import * as store from '../store.js';

const DB = 'p0pc0rn-shell', ST = 'kv', KEY = 'wall', MAXW = 720;
const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(ST)) r.result.createObjectStore(ST); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
  });
}
async function kv(mode, fn) { const db = await idb(); try { return await new Promise((res, rej) => { const t = db.transaction(ST, mode), q = fn(t.objectStore(ST)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); } finally { db.close(); } }
const isPicture = (m) => !!m && (m.media === 'image' || !m.media);

export function createWallpaper({ toast = () => {}, sheet = null, art = null } = {}) {
  let url = null;
  const layer = $('wall-img'), wall = $('wall');
  function show(src, kind) {
    if (url && url !== src) { URL.revokeObjectURL(url); url = null; }
    if (src && src.startsWith('blob:')) url = src;
    if (layer) layer.style.backgroundImage = src ? `url("${src}")` : '';
    if (wall) wall.dataset.kind = kind;
    document.documentElement.dataset.wall = kind;   // labels: white with a shadow over a picture, the theme's text colour over the default
  }
  async function load() {
    try { const b = await kv('readonly', (s) => s.get(KEY)); if (b instanceof Blob && b.size) return show(URL.createObjectURL(b), 'photo'); } catch (e) { /* no IndexedDB: the default */ }
    if (art && /^[\w./-]+\.(webp|jpe?g|png)$/i.test(art) && !art.includes('..')) {
      const img = new Image(); img.onload = () => show(art, 'art'); img.onerror = () => show('', 'default'); img.src = art; return;
    }
    show('', 'default');
  }
  /** a picture -> the wallpaper (scaled down once, JPEG) */
  async function set(blob) {
    let bmp = null;
    try {
      bmp = await createImageBitmap(blob);
      const k = Math.min(1, MAXW / bmp.width), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.84)); c.width = c.height = 0;
      if (!out) throw new Error('no image');
      await kv('readwrite', (s) => s.put(out, KEY));
      await load(); toast('Wallpaper set');
    } catch (e) { toast("That picture couldn't be used. Try another."); }
    finally { if (bmp && bmp.close) bmp.close(); }
  }
  async function reset() { try { await kv('readwrite', (s) => s.delete(KEY)); } catch (e) { /* */ } await load(); toast('Default wallpaper'); }
  async function fromLibrary(close) {
    let list = [];
    try { list = (await store.list()).filter(isPicture).slice(0, 60); } catch (e) { list = []; }
    if (!sheet) return;
    const { sheet: sh, close: done } = sheet('sh-wall-lib', 'A picture from the Library');
    if (!list.length) { sh.append(mk('p', 'footnote dim', 'No pictures in the Library yet. Make one in Create.'), Object.assign(mk('button', 'btn', 'OK'), { type: 'button', onclick: done })); return; }
    const grid = mk('div', 'sh-wall-grid'), urls = [];
    for (const m of list) {
      if (!(m.thumb instanceof Blob)) continue;
      const u = URL.createObjectURL(m.thumb); urls.push(u);
      const b = mk('button', 'sh-wall-pick'); b.type = 'button'; b.setAttribute('aria-label', 'Use this picture: ' + String(m.prompt || '').slice(0, 60));
      const img = new Image(); img.alt = ''; img.src = u; b.append(img);
      b.onclick = async () => { done(); try { const full = await store.getBlob(m.id); await set(full || m.thumb); } catch (e) { toast("That picture couldn't be used. Try another."); } };
      grid.append(b);
    }
    const cancel = mk('button', 'btn ghost', 'Cancel'); cancel.type = 'button'; cancel.dataset.close = '';
    sh.append(grid, cancel);
    const obs = new MutationObserver(() => { if (!document.getElementById('sh-wall-lib')) { obs.disconnect(); for (const u of urls) URL.revokeObjectURL(u); } });
    obs.observe(document.body, { childList: true });
    if (close) close();
  }
  function choose() {
    if (!sheet) return;
    const { sheet: sh, close } = sheet('sh-wall', 'Wallpaper');
    sh.append(mk('p', 'footnote dim', 'Shown slightly blurred behind the icons. It stays on this phone.'));
    const row = (label, fn) => { const b = mk('button', 'li link', label); b.type = 'button'; b.onclick = fn; return b; };
    const pick = mk('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.className = 'vh'; pick.tabIndex = -1;
    pick.onchange = () => { const f = pick.files && pick.files[0]; pick.value = ''; close(); if (f) set(f); };
    const list = mk('div', 'list');
    list.append(row('A picture from the Library', () => fromLibrary(close)), row('A photo', () => pick.click()), row('The default', () => { close(); reset(); }));
    const cancel = mk('button', 'btn ghost', 'Cancel'); cancel.type = 'button'; cancel.dataset.close = '';
    sh.append(list, pick, cancel);
  }
  return { load, set, reset, choose };
}
// 3.9 shell b43e9696319a
