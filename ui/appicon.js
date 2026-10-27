// appicon.js - p0pc0rn 3.9: "Make an icon", optional inside "Add to Home Screen" for a made app (My apps' Add to Home, and the button
// that follows "Made …"). Josh, 10-26: "App to homescreen including openclaw like workflows needs a skeleton for flux.2 4b to make the app
// icon. One shot and reroll with prompt once it lands. Generating the app icon is optional within the "add to Home Screen" option when
// making the application". The workflow (ui/appicon_core.js): Juli picks the icon's idea (her own model, one tiny JSON), the icon skeleton
// gives it the system icons' look for FLUX.2 [klein] 4B, one shot through the app's queue (a normal picture job: the agreement, the
// picture model downloaded, one model at a time); the sheet shows it: Use this / Try again (the person's own words) / Keep the letter.
// The icon stays on this phone: IndexedDB 'p0pc0rn-icons' (the 180 and 120 px PNGs), shown on the home screen through blob: URLs,
// removed with the pin and with the app. It never goes to the Library.
'use strict';
import { SHOT, SIZES, IDEA_MAX, PLAN_MAX_TOKENS, PLAN_PREFIX, planMessages, parsePlan, createIconStore, createFlow, frameBox, clearCorners } from './appicon_core.js';
import { designArt } from './storefront_core.js';   // 3.9 Wallet Watch: a design's own icon

/** the queue runner for 'appiconplan' (app.js registers it with Juli's own model): her idea for the icon, one short greedy answer */
export function iconPlanRunner(modelId) {
  return { model: () => modelId, async run(ctx) {
    const r = await ctx.engine.chat(planMessages(ctx.params || {}), { maxTokens: PLAN_MAX_TOKENS, prefix: PLAN_PREFIX, signal: ctx.signal });
    return { idea: parsePlan(r && r.text) };
  } };
}
/** the queue runner for 'appicon': ONE shot of the picture model (FLUX.2 [klein] 4B, never the 9B: an icon is a quick small picture),
 *  through the app's own picture runner (its engine, progress and signal), at the engine's small square */
export function iconRenderRunner(modelId, picture) {
  return { model: () => modelId, async run(ctx) {
    const p = ctx.params || {};
    const r = await picture.run(Object.assign({}, ctx, { params: { prompt: String(p.prompt || '').slice(0, 1200), width: SHOT.width, height: SHOT.height, steps: SHOT.steps, seed: p.seed } }));
    return { image: r.image, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds };
  } };
}

/** the two jobs through the app's queue (Q() = the queue): the picture comes back as a Blob and the job leaves the queue (an icon is not
 *  a Library picture); cancel() stops the job that is running or waiting */
export function queueJobs(Q) {
  const live = new Set();
  function wait(q, id, take) {
    return new Promise((res, rej) => {
      const off = [];
      const detach = () => { for (const o of off) o(); off.length = 0; live.delete(id); };
      const leave = () => { Promise.resolve(q.remove(id)).catch(() => {}); };
      const err = (code, message) => Object.assign(new Error(message || code || 'stopped'), { code: code || 'FAILED' });
      off.push(q.on('done', (j) => { if (j.id !== id) return; detach(); Promise.resolve().then(() => (take ? take(j) : j.result || {})).then((v) => { leave(); res(v); }, (e) => { leave(); rej(e); }); }));
      off.push(q.on('failed', (j) => { if (j.id === id) { detach(); leave(); rej(err(j.error && j.error.code, j.error && j.error.message)); } }));
      off.push(q.on('cancelled', (j) => { if (j.id === id) { detach(); leave(); rej(err('CANCELLED', 'cancelled')); } }));
      for (const n of ['blocked', 'needs-consent', 'needs-download']) off.push(q.on(n, (j) => {
        if (j.id !== id) return;
        detach();   // first: the cancel below must not answer for the real reason
        rej(err(n === 'needs-consent' ? 'NO_CONSENT' : n === 'needs-download' ? 'NOT_DOWNLOADED' : (j.error && j.error.code) || 'BLOCKED', (j.error && j.error.message) || n));
        Promise.resolve(q.cancel(id)).catch(() => {}).then(leave);
      }));
      if (q.pump) q.pump();
    });
  }
  return {
    async plan(app, info = {}) {
      const q = Q(); if (!q) throw Object.assign(new Error('the queue is not ready'), { code: 'BUSY' });
      const j = await q.add('appiconplan', { name: app.name, skelName: info.name || '', about: info.about || '' }, { title: app.name });
      live.add(j.id);
      const r = await wait(q, j.id);
      return (r && r.idea) || '';
    },
    async render(o) {
      const q = Q(); if (!q) throw Object.assign(new Error('the queue is not ready'), { code: 'BUSY' });
      const j = await q.add('appicon', { prompt: o.prompt, seed: o.seed }, { title: 'App icon' });
      live.add(j.id);
      return wait(q, j.id, async (done) => {
        const key = done.result && done.result.image && done.result.image.blobKey;
        const b = key ? await q.getBlob(key) : null;   // read before the job (and its files) leaves the queue
        if (!b) throw Object.assign(new Error('the picture came back empty'), { code: 'EMPTY' });
        return b;
      });
    },
    cancel() { const q = Q(); if (q) for (const id of live) Promise.resolve(q.cancel(id)).catch(() => {}); },
  };
}

/** the icons' store: IndexedDB 'p0pc0rn-icons' (its own database: the Apps tab's keeps its version) */
function idbIcons() {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('p0pc0rn-icons', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('icons')) r.result.createObjectStore('icons', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); };
  }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('icons', mode), s = t.objectStore('icons'), q = fn(s); t.oncomplete = () => res(q && 'result' in q ? q.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { get: (id) => tx('readonly', (s) => s.get(id)), put: (r) => tx('readwrite', (s) => s.put(r)), del: (id) => tx('readwrite', (s) => s.delete(id)), all: () => tx('readonly', (s) => s.getAll()) };
}

const canvas = (w, h) => { if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const pngOf = (c) => (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((r) => c.toBlob(r, 'image/png')));
/** the picture -> the home screen's two icon sizes (PNG, no metadata: a canvas writes none): the square inside the light page FLUX may
 *  draw around its own tile, the light corners outside that tile see-through (the home screen rounds the corners itself) */
export async function toIcons(blob) {
  const bmp = await createImageBitmap(blob), out = {};
  try {
    const w = bmp.width, h = bmp.height, work = canvas(w, h), g = work.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const q = frameBox(g.getImageData(0, 0, w, h).data, w, h);
    const sq = g.getImageData(q.sx, q.sy, q.s, q.s); clearCorners(sq.data, q.s, q.s);
    const crop = canvas(q.s, q.s); crop.getContext('2d').putImageData(sq, 0, 0);
    for (const s of SIZES) {
      const c = canvas(s, s), cg = c.getContext('2d'); cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = 'high';
      cg.drawImage(crop, 0, 0, q.s, q.s, 0, 0, s, s);
      out['png' + s] = await pngOf(c);
    }
  } finally { try { bmp.close(); } catch (e) { /* */ } }
  return out;
}

/** api: { Q, toast(t, o), sheet(id, title) -> {wrap, sheet, close}, el(tag, cls, text), btn(label, cls), consented(), installed(key),
 *  skelOf(app) -> {name, about}, pin(app, openFn) -> bool, shell() -> SHELL, diag(step, data) }; api.jobs replaces the queue jobs */
const ownArt = (app) => { try { return designArt(app && app.skel); } catch (e) { return null; } };   // 3.9 Wallet Watch: a design's own icon
export function createAppIcon(api) {
  const store = createIconStore(api.db || idbIcons());
  const jobs = api.jobs || queueJobs(api.Q);
  const urls = new Map();   // app id -> { u180, u120 }
  const diag = (s, d) => { try { if (api.diag) api.diag(s, d); } catch (e) { /* */ } };
  const revoke = (id) => { const u = urls.get(id); if (u) { URL.revokeObjectURL(u.u180); URL.revokeObjectURL(u.u120); urls.delete(id); } };
  const setUrls = (r) => { revoke(r.id); urls.set(r.id, { u180: URL.createObjectURL(r.png180), u120: URL.createObjectURL(r.png120) }); };
  function refreshHome() {
    const g = document.getElementById('home-grid'); if (g) delete g.dataset.keys;   // the shell redraws a tile only when its keys change
    try { const S = api.shell && api.shell(); if (S && S.refresh) S.refresh(); } catch (e) { /* */ }
  }
  async function init() {
    try { for (const r of await store.all()) if (r && r.id && r.png180 && r.png120) setUrls(r); }
    catch (e) { diag('app icons: could not read them', { message: String((e && e.message) || e).slice(0, 160) }); }
    refreshHome();
  }
  const url = (appId) => urls.get(String(appId)) || null;
  /** the home tile's picture for a made app (null = none): the 120 / 180 px icons through blob: URLs, as the system icons */
  function img(appId) {
    const u = url(appId); if (!u) return null;
    const i = new Image(); i.alt = ''; i.decoding = 'async'; i.draggable = false;
    i.srcset = `${u.u120} 120w, ${u.u180} 180w`; i.sizes = '62px'; i.src = u.u180;
    return i;
  }
  async function put(appId, icons, idea) { const r = await store.put(String(appId), Object.assign({ idea, at: Date.now() }, icons)); setUrls(r); refreshHome(); return true; }
  async function drop(appId) {
    if (!appId) return; const id = String(appId);
    const had = urls.has(id); revoke(id);
    try { await store.remove(id); } catch (e) { /* */ }
    if (had) refreshHome();
  }

  let open = null;   // the one sheet that is open
  /** "Add to Home Screen" for a made app: the letter, or an icon Juli makes (optional). doPin() pins it and says so; true = pinned */
  function offer(app, doPin) {
    if (!app || !app.id || typeof doPin !== 'function') return;
    if (open) open.close();
    const el = api.el, S = { app };
    const { sheet, close: closeSheet } = api.sheet('appicon-sheet', `Add “${app.name}” to the Home Screen`);
    const body = el('div', 'ai-body');
    const art = ownArt(app);
    const lead = el('p', 'footnote', art ? 'Use its own icon, or let Juli make another with the picture model: one small picture. If it isn’t right, change the words and try again.' : 'Use its letter, or let Juli make an icon with the picture model: one small picture. If it isn’t right, change the words and try again.');
    const fig = el('div', 'ai-fig'), img = new Image(); img.alt = ''; img.className = 'ai-img'; img.hidden = true;
    const letter = el('span', 'ai-letter', String(app.name || '?').trim().charAt(0).toUpperCase() || '?');
    if (art) { const ai = new Image(); ai.alt = ''; ai.src = art.src; letter.replaceChildren(ai); letter.classList.add('art'); }   // 3.9 Wallet Watch
    fig.append(letter, img);
    const status = el('p', 'ai-status footnote'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const lab = el('label', 'ai-label footnote', 'What the icon shows'); lab.htmlFor = 'ai-idea';
    const idea = document.createElement('textarea'); idea.id = 'ai-idea'; idea.rows = 2; idea.maxLength = IDEA_MAX; idea.className = 'ai-idea';
    idea.setAttribute('autocapitalize', 'off'); idea.setAttribute('enterkeyhint', 'go'); idea.placeholder = 'a tent under a sun';
    const ideaBox = el('div', 'ai-ideabox'); ideaBox.append(lab, idea); ideaBox.hidden = true;
    const row = el('div', 'ai-row');
    body.append(lead, fig, status, ideaBox, row);
    sheet.append(body);
    let shown = null;   // the preview's object URL
    const show = (b) => { if (shown) URL.revokeObjectURL(shown); shown = b ? URL.createObjectURL(b) : null; img.src = shown || ''; img.hidden = !shown; letter.hidden = !!shown; };
    const buttons = (list) => { row.replaceChildren(...list.map(([label, cls, fn, id]) => { const b = api.btn(label, cls); if (id) b.id = id; b.onclick = fn; return b; })); };
    const cuts = new WeakMap();   // a shot -> its icons, cut once: the preview shows the 180 px one, exactly what lands on the home screen
    const cutOf = (b) => { if (!cuts.has(b)) cuts.set(b, toIcons(b)); return cuts.get(b); };
    const pinNow = () => { let ok = false; try { ok = !!doPin(); } catch (e) { ok = false; } return ok; };
    const flow = createFlow({
      plan: async (a) => {
        if (!api.installed('brain') || !api.consented()) return '';   // no Juli on this phone (or not agreed yet): the app's own picture
        return jobs.plan(a, api.skelOf ? api.skelOf(a) || {} : {});
      },
      render: async (o) => {
        if (!api.consented()) throw Object.assign(new Error('no agreement'), { code: 'NO_CONSENT' });
        if (!api.installed('image')) throw Object.assign(new Error('no picture model'), { code: 'NOT_DOWNLOADED' });
        return jobs.render(o);
      },
      toIcons: cutOf,
      save: async (icons, words) => {
        await put(app.id, icons, words);
        if (!pinNow()) { await drop(app.id); throw Object.assign(new Error('The Home Screen is full: remove a pinned app first'), { code: 'FULL' }); }
      },
      onState: paint,
    });
    S.flow = flow;
    function paint(st) {
      fig.classList.toggle('busy', st.step === 'planning' || st.step === 'rendering' || st.step === 'saving');
      if (st.step === 'idle') {   // the start, and after Stop
        status.textContent = st.tries ? 'Stopped.' : ''; ideaBox.hidden = true; show(null);
        buttons([['Make an icon', 'btn sm', start, 'ai-make'], [art ? 'Use its icon' : 'Use its letter', 'btn sm ghost', letterOnly, 'ai-letter-btn']]);
        return;
      }
      if (st.step === 'planning') { status.textContent = 'Juli is picking a picture for the icon…'; ideaBox.hidden = true; buttons([['Stop', 'btn sm ghost', stop, 'ai-stop']]); return; }
      if (st.step === 'rendering') { status.textContent = 'Making the icon with the picture model…'; idea.disabled = true; buttons([['Stop', 'btn sm ghost', stop, 'ai-stop']]); return; }
      if (st.step === 'saving') { status.textContent = 'Saving the icon…'; row.replaceChildren(); return; }
      if (st.step === 'preview' || st.step === 'error') {
        if (st.step === 'preview') { const b = st.image; cutOf(b).then((ic) => { if (flow.state.image === b && flow.state.step === 'preview') show(ic.png180); }, () => show(b)); }
        ideaBox.hidden = false; idea.disabled = false;
        if (document.activeElement !== idea) idea.value = st.idea || '';
        status.textContent = st.step === 'error' ? st.error
          : st.note ? st.note
            : st.ideaBy === 'fallback' ? 'This one uses the app’s own picture. Change the words and try again if you like.'
              : 'Use it, or change the words and try again.';
        const list = [];
        if (st.step === 'preview') list.push(['Use this', 'btn sm', use, 'ai-use']);
        list.push(['Try again', 'btn sm ghost', again, 'ai-again'], [art ? 'Keep its icon' : 'Keep the letter', 'btn sm ghost', letterOnly, 'ai-keep']);
        buttons(list);
      }
    }
    async function start() { lead.hidden = true; try { await flow.start(app); } catch (e) { diag('app icon: stopped', { message: String((e && e.message) || e).slice(0, 160) }); } }
    async function again() { await flow.retry(idea.value); }
    async function use() {
      try { await flow.use(); api.toast(`${app.name} is on the Home Screen with its new icon`); done(); }
      catch (e) { status.textContent = (e && e.message) || 'Couldn’t save the icon'; paint(Object.assign({}, flow.state, { step: 'error', error: status.textContent })); }
    }
    function letterOnly() { flow.keepLetter(); jobs.cancel(); if (pinNow()) done(); else status.textContent = 'The Home Screen is full: remove a pinned app first'; }
    function stop() { jobs.cancel(); flow.cancel(); lead.hidden = false; paint(flow.state); }
    function done() { open = null; show(null); closeSheet(); }
    idea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!idea.disabled) again(); } });
    // the sheet closed some other way (its scrim): what is still running stops, nothing is kept
    const watch = new MutationObserver(() => { if (!sheet.isConnected) { watch.disconnect(); if (open === S) { open = null; jobs.cancel(); flow.cancel(); show(null); } } });
    watch.observe(document.body, { childList: true, subtree: true });
    S.close = () => { jobs.cancel(); flow.cancel(); done(); };
    open = S;
    paint(flow.state);
    setTimeout(() => { const b = document.getElementById('ai-make'); if (b) b.focus(); }, 60);
  }
  /** right after Juli made an app: "Add to Home Screen" next to the result (Open stays first) */
  function made(app, openFn) {
    const sh = api.shell && api.shell(); if (!sh || !sh.pin || !app) return;
    const box = document.getElementById('apps-status'); if (!box || box.hidden || box.querySelector('.ai-add')) return;
    const b = api.btn('Add to Home Screen', 'btn sm ghost ai-add'); b.id = 'ai-add';
    b.onclick = () => offer(app, () => api.pin(app, openFn));
    box.append(b);
  }
  return { init, url, img, put, drop, offer, made, get open() { return open; } };
}
