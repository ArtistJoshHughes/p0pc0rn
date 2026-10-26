// host.js - the Apps tab: apps made in p0pc0rn from skeletons (3.8). Two kinds on the shelf: NON-AGENTIC apps (tools the person uses;
// a "live" one may also check a source on a timer and post what it finds) and AGENTIC apps (Juli works in them on her own while p0pc0rn
// is open, in their checks only, never next to an open app: tasks, a notebook, a review queue; the Skeleton Guide has the rules).
// Every app runs in a sandboxed frame (makeapp/frame.html: an opaque origin with no network of its own and no storage)
// and reaches the page only through window.p0 (postMessage). This file is that bridge: it checks the app's granted permissions,
// fetches the listed sources itself (sources.js), keeps each app's storage, posts its notices, and runs the agentic checks.
// Apps never see photos, the Library, the Cast, files or another app's data. Granting is the person's tap on the permission sheet.
import { openDB, uid } from '../assistant/idb.js';
import { checkBundle } from './check.js';
import { SOURCES, createFetcher } from './sources.js';
import { makeApp, fillMessages } from './fill.js';
import { estTokens, promptTokens, EST_LOW } from '../assistant/fit.js';   // 3.8 (v040): the Bigger brain's context

const DB = 'p0pc0rn-apps';
const STORE_MAX = 1e6;                 // bytes of storage per app
const LIM = { fetchPerMin: 30, postsPerHour: 10, asksPerHour: 20, badgesPerMin: 30, locationsPerMin: 6, errorsPerMin: 10 };
const SAVE = { value: 200000, keys: 500, bytes: 2e6, wait: 400, most: 2000 };   // one save: its size; per flush: keys, bytes; the debounce and its cap (ms)
const CHECK_MS = 25000, CHECK_JULI_MS = 110000;   // one check may take this long (an agentic app's, with its questions to Juli, longer)
const SEV = new Set(['info', 'watch', 'warning']);

/** what the person agrees to for a skeleton: its permissions as one comparable string (a new version that asks for more asks again) */
export const permKey = (m) => JSON.stringify({ s: !!(m.permissions || {}).storage, o: [...((m.permissions || {}).online || [])].sort(), j: !!((m.permissions || {}).juli || []).length,
  c: !!(m.permissions || {})['chat.post'], l: (m.permissions || {}).location || 'none', t: (m.triggers || []).map((t) => t.type).sort(), k: m.category || '' });

/** may this app make this call? -> null (yes) or the reason (no). grant = the person's yes for exactly these permissions. */
export function deny(m, granted, fn, args, mode) {
  if (!granted) return 'the person has not allowed this app yet';
  const P = m.permissions || {};
  if (fn === 'fetch') { const src = args && args[0]; return (P.online || []).includes(src) && SOURCES[src] ? null : `this app may not read ${src}`; }
  if (fn === 'chat.post') return P['chat.post'] ? null : 'this app may not post to the chat';
  if (fn === 'juli.ask') return !(P.juli || []).includes('ask') ? 'this app may not ask Juli' : m.category !== 'agentic' ? 'only an agentic app has Juli in it'
    : mode !== 'check' ? 'Juli works in the app\'s checks, after it closes (the open app keeps the phone\'s memory)' : null;   // never Juli next to an open app
  if (fn === 'location.get') return P.location === 'device' ? null : 'this app may not read the phone’s location';
  if (fn === 'app.badge') return null;
  return 'unknown call ' + fn;
}

/** a notice an app posts: only these fields, plain text, trimmed (the chat renders it; it is never an instruction to Juli) */
export function cleanNotice(n) {
  const t = (v, k) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, k);
  const sev = SEV.has(n && n.severity) ? n.severity : 'info';
  return { title: t(n && n.title, 80) || 'Notice', severity: sev, text: t(n && n.text, 500) };
}

/** what Juli is asked for an app (its queue job 'appask', and the benchmark's Apps check): the app's own words under a short rule */
export function askMessages(app, prompt, json) {
  const name = String(app || '').slice(0, 30);
  const sys = json ? `An app on this phone called "${name}" asks for data. Reply with ONE JSON object and nothing else, in the form its message asks for. Never give financial advice.`
    : `An app on this phone called "${name}" asks a short question. Answer in at most three sentences. Never give financial advice.`;
  return { messages: [{ role: 'system', content: sys }, { role: 'user', content: String(prompt || '').slice(0, 4000) }],
    opts: json ? { maxTokens: 300 } : { maxTokens: 220, temperature: 0.3 } };   // data: exact (no temperature)
}

// ------------------------------------------------------------------------------------------------ the frame
/** startFrame: one app in a sandboxed iframe. calls = {name: async (args) => value} (already permission-checked by the caller). */
export function startFrame({ parent, frameUrl = 'makeapp/frame.html', libs, bundle, slots, store, mode = 'run', name = '', onSave = () => {}, onCall, onError = () => {}, onBreach = () => {}, hidden = false }) {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('allow', '');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.title = name || 'App'; f.className = hidden ? 'app-frame hidden' : 'app-frame';
  f.src = frameUrl;
  let readyRes, bootRes, bootRej; const pend = new Map(); let seq = 0, closed = false, errs = [];
  const ready = new Promise((r) => { readyRes = r; }), booted = new Promise((r, j) => { bootRes = r; bootRej = j; });
  const post = (m) => { try { f.contentWindow.postMessage(m, '*'); } catch (e) { /* gone */ } };
  const onMsg = async (ev) => {
    if (closed || ev.source !== f.contentWindow) return;
    const m = ev.data || {};
    if (m.t === 'ready') { readyRes(); post({ t: 'boot', p5: mode === 'check' ? '' : libs.p5, kit: libs.kit, code: bundle.files['sketch.js'], slots, store, mode, name }); return; }
    if (m.t === 'booted') { bootRes(m); return; }
    if (m.t === 'breach') { ctl.close(); onBreach(String(m.message || '').slice(0, 200)); return; }   // the sandbox caught the app reaching out: it stops now
    if (m.t === 'error') {
      const t = Date.now(); errs = errs.filter((x) => t - x < 60e3);
      if (!m.fatal && errs.length >= LIM.errorsPerMin) return;   // a looping app's errors: the first few a minute
      errs.push(t); onError(String(m.message || 'error').slice(0, 300), !!m.fatal); if (m.fatal) bootRej(new Error(m.message)); return;
    }
    if (m.t === 'save') { onSave(String(m.k || '').slice(0, 120), m.v == null ? null : String(m.v)); return; }
    if (m.t === 'checked') { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.ok ? p.res(m.value) : p.rej(new Error(m.error || 'check failed')); } return; }
    if (m.t === 'call') {
      let reply;
      try { reply = { t: 'reply', id: m.id, ok: true, value: await onCall(String(m.fn), Array.isArray(m.args) ? m.args : []) }; }
      catch (e) { reply = { t: 'reply', id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 300), code: (e && e.code) || null }; }
      post(reply);
    }
  };
  addEventListener('message', onMsg);
  parent.append(f);
  const ctl = {
    frame: f, ready, booted,
    check(ms = CHECK_MS) {
      const id = ++seq;
      return new Promise((res, rej) => { pend.set(id, { res, rej }); post({ t: 'check', id }); setTimeout(() => { if (pend.delete(id)) rej(Object.assign(new Error('the check took too long'), { code: 'TIMEOUT' })); }, ms); });
    },
    close() { if (closed) return; closed = true; removeEventListener('message', onMsg); for (const p of pend.values()) p.rej(new Error('closed')); pend.clear(); try { f.src = 'about:blank'; } catch (e) { /* */ } f.remove(); },
  };
  return ctl;
}

// ------------------------------------------------------------------------------------------------ the Apps tab
export function createApps(api) {
  const A = { db: null, skels: new Map(), bundled: new Set(), apps: [], grants: new Map(), libs: null, open: null, checking: false, making: null, fetcher: createFetcher(), rate: new Map(), lastErr: null, checkJobs: new Set() };
  const $ = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const btn = (label, cls, onClick) => { const b = mk('button', cls || 'btn sm', label); b.type = 'button'; b.onclick = onClick; return b; };

  async function init() {
    A.db = await openDB(DB, 1, { apps: { keyPath: 'id' }, kv: { keyPath: 'id' }, skels: { keyPath: 'id' }, grants: { keyPath: 'id' } });
    const idx = await (await fetch('makeapp/skeletons/index.json', { cache: 'no-cache' })).json();
    for (const s of idx.skeletons) {
      try { const b = await (await fetch('makeapp/skeletons/' + s.file, { cache: 'no-cache' })).json(); const e = checkBundle(b); if (e.length) { api.diag('apps: bundled skeleton failed its check', { id: s.id, n: e.length }); continue; } A.skels.set(b.manifest.id, b); A.bundled.add(b.manifest.id); }
      catch (e) { api.diag('apps: bundled skeleton missing', { id: s.id }); }
    }
    for (const r of await A.db.all('skels')) if (!A.bundled.has(r.id) && !checkBundle(r.bundle).length) A.skels.set(r.id, r.bundle);
    for (const g of await A.db.all('grants')) A.grants.set(g.id, g);
    A.apps = (await A.db.all('apps')).sort((a, b) => a.createdAt - b.createdAt);
    render();
    setTimeout(() => tick(true), 8000);            // 'on-open': the agentic apps check once soon after p0pc0rn opens
    // memory (the phone's ~1.86 GB page cap): an open app closes when Juli or a render starts (its own question to Juli excepted)
    api.Q().on('change', (j) => { if (j.status === 'running' && A.open && api.Q().modelOf(j)) { const n = A.open.app.name; closeApp(); api.toast(`${n} closed: Juli or a render needs the memory`); } });
    setInterval(() => tick(false), 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => tick(true), 3000); });
  }
  async function libs() {
    if (A.libs) return A.libs;
    const [p5, kit] = await Promise.all(['makeapp/p5.min.js', 'makeapp/kit.js'].map(async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); }));
    return (A.libs = { p5, kit });
  }
  const granted = (skel) => { const g = A.grants.get(skel.manifest.id); return !!g && g.key === permKey(skel.manifest); };
  const watches = (skel) => (skel.manifest.triggers || []).some((t) => t.type === 'on-open' || t.type === 'interval');   // agentic and live apps check on their own

  // ---- storage per app (all of it in IndexedDB on this phone)
  async function storeOf(appId) { return ((await A.db.get('kv', appId)) || { id: appId, data: {} }).data; }
  // the frame's own limits can be skipped by an app that posts to the page itself, so the page keeps its own: the last value per key,
  // a cap on what waits, and a write at most SAVE.most ms after the first change (an app that never stops saving can't grow it)
  const pendingSave = new Map();
  function save(appId, k, v) {
    if (v != null && v.length > SAVE.value) return;
    let p = pendingSave.get(appId);
    if (!p) { p = { ops: new Map(), bytes: 0, t: null, first: Date.now(), over: false }; pendingSave.set(appId, p); }
    if (p.over) return;
    const was = p.ops.get(k); p.bytes += (v == null ? 0 : k.length + v.length) - (was == null ? 0 : k.length + was.length); p.ops.set(k, v);
    if (p.ops.size > SAVE.keys || p.bytes > SAVE.bytes) { p.over = true; p.ops.clear(); }
    clearTimeout(p.t);
    p.t = setTimeout(() => writeSaves(appId, p), Date.now() - p.first >= SAVE.most ? 0 : SAVE.wait);
  }
  async function writeSaves(appId, p) {
    if (pendingSave.get(appId) === p) pendingSave.delete(appId);
    if (p.over) return notice1(appId, 'An app tried to save too much at once: its last changes were not saved');
    const rec = (await A.db.get('kv', appId)) || { id: appId, data: {} };
    for (const [kk, vv] of p.ops) { if (vv == null) delete rec.data[kk]; else rec.data[kk] = vv; }
    const size = Object.entries(rec.data).reduce((s, [a, b]) => s + a.length + b.length, 0);
    if (size > STORE_MAX) return notice1(appId, 'An app tried to keep more than 1 MB: the last change was not saved');
    await A.db.put('kv', rec);
  }
  const told = new Map();
  function notice1(appId, text) { const t = Date.now(); if (t - (told.get(appId) || 0) < 60e3) return; told.set(appId, t); api.toast(text); }   // one a minute per app
  function flushSaves() { return new Promise((r) => setTimeout(r, SAVE.wait + 50)); }

  // ---- the bridge (permission checked here, every call)
  function limit(appId, what, max, ms) {
    const k = appId + ' ' + what, t = Date.now(), l = (A.rate.get(k) || []).filter((x) => t - x < ms);
    if (l.length >= max) throw Object.assign(new Error('this app is asking too often; try again later'), { code: 'RATE_LIMIT' });
    l.push(t); A.rate.set(k, l);
  }
  function callsFor(app, skel, mode = 'run') {
    const m = skel.manifest;
    return async (fn, args) => {
      const why = deny(m, granted(skel), fn, args, mode);
      if (why) throw Object.assign(new Error(why), { code: 'NOT_ALLOWED' });
      if (fn === 'fetch') { limit(app.id, 'fetch', LIM.fetchPerMin, 60e3); return A.fetcher(args[0], args[1] || {}, app.id); }
      if (fn === 'chat.post') { limit(app.id, 'post', LIM.postsPerHour, 3600e3); await api.notice(app.name, cleanNotice(args[0])); return true; }
      if (fn === 'juli.ask') { limit(app.id, 'ask', LIM.asksPerHour, 3600e3); return askJuli(app, String(args[0] || '').slice(0, 4000), { json: !!(args[1] && args[1].json), check: mode === 'check' }); }
      if (fn === 'location.get') { limit(app.id, 'loc', LIM.locationsPerMin, 60e3); return deviceLocation(); }
      if (fn === 'app.badge') {
        limit(app.id, 'badge', LIM.badgesPerMin, 60e3);
        const b = Math.max(0, Math.min(99, +args[0] || 0)); if (b === (app.badge || 0)) return true;
        app.badge = b; await A.db.put('apps', app); render(); return true;
      }
      throw new Error('unknown call');
    };
  }
  function deviceLocation() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition((p) => res({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }), () => res(null), { maximumAge: 600000, timeout: 15000 });
    });
  }
  async function askJuli(app, prompt, o = {}) {
    if (!api.installed('brain')) throw Object.assign(new Error('Juli is not downloaded'), { code: 'NOT_DOWNLOADED' });
    const j = await api.Q().add('appask', { prompt, app: app.name, json: !!o.json }, { title: app.name });
    if (o.check) A.checkJobs.add(j.id);   // a check's question goes with the check (closed, timed out, or stopped)
    let r; try { r = await waitJob(j.id); } finally { A.checkJobs.delete(j.id); }
    return String(r.text || '').slice(0, 1200);
  }
  function waitJob(id) {
    return new Promise((res, rej) => {
      const Q = api.Q(), off = [];
      // the job leaves the queue once it has answered (the Apps tab shows the outcome, not the queue)
      const end = (fn, v) => { for (const o of off) o(); fn(v); Q.remove(id).catch(() => {}); };
      const stop = (j) => { for (const o of off) o(); Q.cancel(j.id).catch(() => {}).then(() => Q.remove(j.id)).catch(() => {});
        rej(Object.assign(new Error((j.error && j.error.message) || 'blocked'), { code: (j.error && j.error.code) || 'BLOCKED' })); };
      off.push(Q.on('done', (j) => { if (j.id === id) end(res, j.result || {}); }));
      off.push(Q.on('failed', (j) => { if (j.id === id) end(rej, Object.assign(new Error((j.error && j.error.message) || 'failed'), { code: j.error && j.error.code })); }));
      off.push(Q.on('cancelled', (j) => { if (j.id === id) end(rej, Object.assign(new Error('cancelled'), { code: 'CANCELLED' })); }));
      for (const n of ['blocked', 'needs-consent', 'needs-download']) off.push(Q.on(n, (j) => { if (j.id === id) stop(j); }));
      if (Q.pump) Q.pump();
    });
  }

  // ---- running an app (full screen)
  async function openApp(app) {
    const skel = A.skels.get(app.skel);
    if (!skel) return api.toast('This app’s skeleton is no longer on this phone');
    if (!granted(skel)) return permSheet(skel, () => openApp(app));
    if (api.modelBusy()) {   // 3.8: Juli only held for a follow-up job lets go (the app needs the memory); anything else is a real job
      const Q = api.Q();
      if (!(Q && Q.holding && !Q.active)) return api.toast('Apps open when the queue is idle: Juli or a render is using the memory');
      api.endHold(); for (let i = 0; i < 60 && api.modelBusy(); i++) await new Promise((r) => setTimeout(r, 100));
      if (api.modelBusy()) return api.toast('Apps open when the queue is idle: Juli or a render is using the memory');
    }
    const note = setTimeout(() => api.toast('Opening in a moment: making room after Juli'), 700);
    await api.settle(); clearTimeout(note);   // 3.8 (iOS 27): a few seconds after a model leaves before an app takes memory
    if (api.modelBusy()) return api.toast('Apps open when the queue is idle: Juli or a render is using the memory');
    stopCheck();                                   // ONE app frame at a time
    let L; try { L = await libs(); } catch (e) { return api.toast('Couldn’t load the app runtime. Check Wi-Fi, then try again.'); }
    closeApp();
    const wrap = mk('div', 'app-run'); wrap.id = 'app-run'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', app.name);
    const bar = mk('div', 'app-bar');
    const x = btn('Close', 'mini app-close', closeApp); x.setAttribute('aria-label', 'Close ' + app.name);
    bar.append(x, mk('span', 'headline app-name', app.name), mk('span', 'footnote dim app-kind', skel.manifest.category === 'agentic' ? 'Agentic' : ''));
    const body = mk('div', 'app-body'); wrap.append(bar, body); document.body.append(wrap);
    document.documentElement.classList.add('app-open');
    const store = await storeOf(app.id);
    const fr = startFrame({ parent: body, frameUrl: api.frameUrl || 'makeapp/frame.html', libs: L, bundle: skel, slots: app.slots, store, mode: 'run', name: app.name,
      onSave: (k, v) => save(app.id, k, v), onCall: callsFor(app, skel), onError: (m, fatal) => { api.diag('apps: app error', { skel: app.skel, fatal }); if (fatal) api.toast('The app stopped: ' + m.slice(0, 80)); },
      onBreach: () => { api.diag('apps: sandbox stopped an app', { skel: app.skel }); if (A.open && A.open.fr === fr) closeApp(); api.toast(`${app.name} was stopped: it tried to reach outside its sandbox`); } });
    A.open = { app, fr };
    // the sandbox page never answered (offline before it was cached, or a server that refuses it): say so instead of a blank screen
    Promise.race([fr.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 12000))]).then((okReady) => {
      if (!okReady && A.open && A.open.fr === fr) { closeApp(); api.toast('The app couldn’t start. Check Wi-Fi, then open it again.'); api.diag('apps: sandbox page did not answer', { skel: app.skel }); }
    });
    app.openedAt = Date.now(); A.db.put('apps', app).catch(() => {});
    api.diag('apps: open', { skel: app.skel });
  }
  function stopCheck() { if (A.checkFr) { try { A.checkFr.close(); } catch (e) { /* */ } A.checkFr = null; } dropCheckJobs(); }
  function dropCheckJobs() { for (const id of A.checkJobs) api.Q().cancel(id).catch(() => {}); A.checkJobs.clear(); }   // Juli never answers next to an open app
  function closeApp() {
    if (!A.open) return;
    const { app } = A.open;
    A.open.fr.close(); A.open = null;
    const w = $('app-run'); if (w) w.remove();
    document.documentElement.classList.remove('app-open');
    // an app that checks on its own and was just set up (a place, a trip) checks within a minute, not at its calm interval
    const skel = A.skels.get(app.skel);
    if (skel && watches(skel)) { app.nextCheck = Date.now() + 5000; app.soon = true; A.db.put('apps', app).catch(() => {}); setTimeout(() => tick(false), 6000); }
    render();
  }

  // ---- the checks of agentic and live apps (only while p0pc0rn is open; never while a picture, clip or song is rendering)
  function due(app, skel, onOpen) {
    if (!skel || !watches(skel) || !granted(skel) || app.paused) return false;
    if (app.soon && Date.now() >= (app.nextCheck || 0)) return true;   // the check right after the person closed it
    const T = skel.manifest.triggers || [];
    if (onOpen && T.some((t) => t.type === 'on-open') && Date.now() - (app.lastCheck || 0) > 10 * 60e3) return true;
    return T.some((t) => t.type === 'interval') && Date.now() >= (app.nextCheck || 0);
  }
  async function tick(onOpen) {
    if (A.checking || A.open || !A.db || document.visibilityState === 'hidden' || api.modelBusy()) return;   // one frame at a time, never next to a model
    const list = A.apps.filter((a) => due(a, A.skels.get(a.skel), onOpen) && !(A.open && A.open.app.id === a.id));
    if (!list.length) return;
    A.checking = true;
    try { for (const a of list) { if (A.open || api.modelBusy()) break; await runCheck(a); } } finally { A.checking = false; A.checkFr = null; render(); }
  }
  async function runCheck(app) {
    const skel = A.skels.get(app.skel), T = skel.manifest.triggers || [], iv = T.find((t) => t.type === 'interval');
    let L; try { L = await libs(); } catch (e) { return; }
    await api.settle();   // 3.8 (iOS 27): a few seconds after a model leaves
    if (A.open || api.modelBusy()) return;
    const host = $('app-checks') || document.body.appendChild(Object.assign(mk('div', 'app-checks'), { id: 'app-checks' }));
    const store = await storeOf(app.id);
    let breach = false;
    const fr = startFrame({ parent: host, frameUrl: api.frameUrl || 'makeapp/frame.html', libs: L, bundle: skel, slots: app.slots, store, mode: 'check', name: app.name, hidden: true,
      onSave: (k, v) => save(app.id, k, v), onCall: callsFor(app, skel, 'check'), onError: () => {}, onBreach: () => { breach = true; } });
    A.checkFr = fr;
    let out = null, err = null;
    const ms = skel.manifest.category === 'agentic' && ((skel.manifest.permissions || {}).juli || []).includes('ask') ? CHECK_JULI_MS : CHECK_MS;
    try { await Promise.race([fr.booted, new Promise((r, j) => setTimeout(() => j(new Error('the app did not start')), 15000))]); out = await fr.check(ms); }
    catch (e) { err = String((e && e.message) || e).slice(0, 200); }
    fr.close(); dropCheckJobs(); await flushSaves();
    if (breach) { err = 'stopped: it tried to reach outside its sandbox'; out = null; app.paused = true; api.diag('apps: sandbox stopped an app', { skel: app.skel }); }   // it does not run on its own again
    const active = !!(out && out.active);
    app.lastCheck = Date.now(); app.lastError = err; app.lastActive = active; app.soon = false;
    app.nextCheck = Date.now() + ((active || !iv ? (iv ? iv.minMinutes : 720) : (iv.calmMinutes || iv.minMinutes)) * 60e3) * (err ? 0.5 : 1);
    await A.db.put('apps', app);
    api.diag('apps: check', { skel: app.skel, ok: !err, active, posted: out && out.posted || 0 });
  }

  // ---- the benchmark's Apps check (Settings › Benchmark), run while the queue is idle (no model in memory). Every app that comes with
  // p0pc0rn opens, one at a time, OFFLINE (its offline state); then Trip Watch's check runs with Juli, as right after a person closes
  // it, on TEST data (a fixed test town and a made-up forecast, nothing fetched): Juli reads a test note and sums up the test trip,
  // loading through the queue like any app question. A test run the person started: permissions for this run only, nothing kept,
  // nothing posted, nothing sent anywhere.
  const TEST_TOWN = { name: 'Moab', region: 'Utah', country: 'United States', cc: 'US', lat: 38.57, lon: -109.55 };
  function testForecast() {   // 14 day / night periods from today (made up for the test): two days out it is windy, the rest is calm
    const out = [], dn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (let i = 0; i < 14; i++) {
      const k = i >> 1, day = i % 2 === 0, d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + k);
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), windy = k === 2 && day;
      out.push({ name: k === 0 ? (day ? 'Today' : 'Tonight') : dn[d.getDay()] + (day ? '' : ' Night'), start: ymd + (day ? 'T06:00:00-06:00' : 'T18:00:00-06:00'), day, temp: day ? 66 : 41, unit: 'F',
        wind: windy ? '20 to 30 mph' : '5 to 10 mph', short: day ? 'Sunny' : 'Clear', pop: 0, detail: windy ? 'Sunny and windy, with gusts as high as 40 mph.' : 'Fair.' });
    }
    return out;
  }
  async function selfTest() {
    if (A.open) closeApp();
    stopCheck(); for (let i = 0; i < 300 && A.checking; i++) await new Promise((ok) => setTimeout(ok, 100));   // a check of the person's own apps finishes first
    const L = await libs(), out = { started: 0, of: 0, problems: [], trip: null };
    const box = document.body.appendChild(Object.assign(mk('div', 'app-selftest'), { id: 'app-selftest' }));
    const later = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const frame = (skel, store, mode, data) => {
      const saves = {}, errs = [], log = { fetches: 0, asks: [], posts: 0 };
      const onCall = async (fn, args) => {
        const why = deny(skel.manifest, true, fn, args, mode); if (why) throw Object.assign(new Error(why), { code: 'NOT_ALLOWED' });
        if (fn === 'fetch') { log.fetches++; if (data && data[args[0]]) return Object.assign({ source: 'test data', fetchedAt: Date.now() }, data[args[0]]()); throw Object.assign(new Error('offline in the benchmark'), { code: 'OFFLINE' }); }
        if (fn === 'juli.ask') { const t0 = performance.now(), a = await askJuli({ name: skel.manifest.name }, String(args[0] || '').slice(0, 4000), { json: !!(args[1] && args[1].json), check: true }); log.asks.push(+((performance.now() - t0) / 1000).toFixed(1)); return a; }
        if (fn === 'chat.post') { log.posts++; return true; }   // counted, not posted
        return fn === 'app.badge' ? true : null;
      };
      const fr = startFrame({ parent: box, frameUrl: api.frameUrl || 'makeapp/frame.html', libs: L, bundle: skel, slots: skel.slots_default, store, mode, name: skel.manifest.name, hidden: mode === 'check',
        onSave: (k, v) => { if (v == null) delete saves[k]; else saves[k] = v; }, onCall, onError: (m) => errs.push(String(m).slice(0, 120)), onBreach: (m) => errs.push('stopped: ' + String(m).slice(0, 100)) });
      const started = Promise.race([fr.booted, new Promise((r, j) => setTimeout(() => j(new Error('did not start')), 15000))]);
      return { fr, saves, errs, log, started };
    };
    A.checking = true;   // the person's own agentic checks wait meanwhile
    try {
      for (const id of A.bundled) {   // 1. every app that comes with p0pc0rn opens (its starting slots), alone in memory, offline
        const skel = A.skels.get(id); if (!skel) continue; out.of++;
        await api.settle();   // 3.8 (iOS 27): the first app waits until a few seconds after Juli left
        const r = frame(skel, {}, 'run', null);
        try { await r.started; await new Promise((ok) => setTimeout(ok, 1200)); } catch (e) { r.errs.push(String((e && e.message) || e).slice(0, 120)); }
        r.fr.close(); await new Promise((ok) => setTimeout(ok, 300));
        if (r.errs.length) out.problems.push(`${skel.manifest.name}: ${r.errs[0]}`); else out.started++;
      }
      const tw = A.bundled.has('trip-watch') ? A.skels.get('trip-watch') : null;
      if (tw) {   // 2. Trip Watch's check, as after the person closes it: Juli reads a test note, then sums up the test trip's (made-up) forecast
        const t0 = performance.now(), at = Date.now();
        const trip = { id: 'selftest', shelf: 'confirmed', kind: 'trip', title: 'Test trip', text: '', data: { place: TEST_TOWN, start: later(2), end: later(3), what: 'hike' }, evidence: [], review: false, at, upd: at };
        const note = { id: 'selftestnote', shelf: 'suspected', kind: 'note', title: 'Camping at Moab this Friday to Sunday', text: '', data: { note: 'Camping at Moab this Friday to Sunday' }, evidence: [], review: false, at, upd: at };
        const data = { 'weather.nws': () => ({ place: 'Moab, UT', periods: testForecast() }), 'alerts.nws': () => ({ alerts: [] }), 'geocode.openmeteo': () => ({ results: [TEST_TOWN] }) };
        await api.settle();
        const r = frame(tw, { 'p0kit:nb.trips': JSON.stringify({ v: 1, e: [trip, note] }) }, 'check', data);
        let value = null;
        try { await r.started; A.checkFr = r.fr; value = await r.fr.check(CHECK_JULI_MS); } catch (e) { r.errs.push(String((e && e.message) || e).slice(0, 120)); }
        r.fr.close(); A.checkFr = null; dropCheckJobs();
        const nb = r.saves['p0kit:nb.trips'] ? JSON.parse(r.saves['p0kit:nb.trips']).e : [], logs = r.saves['p0kit:agent.v1'] ? JSON.parse(r.saves['p0kit:agent.v1']).log : [];
        const sug = nb.find((e) => e.kind === 'trip?'), checked = logs.find((l) => /^Checked \d/.test(l.text));
        out.trip = { ok: !!value && !!checked && !r.errs.length, seconds: +((performance.now() - t0) / 1000).toFixed(1), asks: r.log.asks, posts: r.log.posts,
          flags: nb.filter((e) => e.kind === 'flag').length, brief: nb.some((e) => e.kind === 'brief'), leftOut: logs.some((l) => /^Left out/.test(l.text)),
          note: sug ? `${sug.text}, ${((sug.data || {}).places || [])[0] ? ((sug.data.places[0].name || '') + ', ' + (sug.data.places[0].region || '')) : ''}` : (nb.find((e) => e.kind === 'note!') || {}).text || null,
          said: r.errs[0] || (checked ? checked.text : (logs[0] || {}).text || 'no answer') };
      }
    } finally { A.checking = false; box.remove(); }
    return out;
  }

  // ---- adding apps
  async function addApp(skel, slots, name, from) {
    const app = { id: uid('app'), skel: skel.manifest.id, name: String(name || skel.manifest.name).slice(0, 30), slots, from, createdAt: Date.now(), nextCheck: 0, lastCheck: 0 };
    await A.db.put('apps', app); A.apps.push(app); render();
    return app;
  }
  async function removeApp(app) {
    if (A.open && A.open.app.id === app.id) closeApp();
    await A.db.del('apps', app.id); await A.db.del('kv', app.id);
    A.apps = A.apps.filter((a) => a.id !== app.id); render(); api.toast('Deleted');
  }
  function useAsIs(skel) {
    const go = async () => { const a = await addApp(skel, JSON.parse(JSON.stringify(skel.slots_default || {})), skel.manifest.name, 'shelf'); openApp(a); };
    if (!granted(skel)) permSheet(skel, go); else go();
  }

  // ---- the permission sheet (the person's own tap; never automated)
  function permLines(skel) {
    const m = skel.manifest, P = m.permissions || {}, L = [];
    if (P.storage) L.push(['Keeps its own data on this phone', 'The app has no internet of its own: what it saves stays here.']);
    for (const s of P.online || []) L.push(['Reads ' + SOURCES[s].label, `Asks ${SOURCES[s].host} directly from this phone. It sends only what the app asks for, such as a town's rounded position; no account, no name.`]);
    if ((P.juli || []).length) L.push(['Juli works in it on her own', 'In its checks while p0pc0rn is open (one comes right after you close it), it asks Juli, on this phone, to read, re-check and sum up for it.']);
    if (P['chat.post']) L.push(['Posts notices in Juli’s chat', 'Short labelled notices, at most ' + LIM.postsPerHour + ' an hour.']);
    if (P.location === 'place') L.push(['Uses a place you type in', 'Never your phone’s location.']);
    if (P.location === 'device') L.push(['Can ask for this phone’s location', 'Rounded to about 1 km; your phone asks you first.']);
    if ((m.triggers || []).some((t) => t.type === 'on-open' || t.type === 'interval')) {
      const iv = (m.triggers || []).find((t) => t.type === 'interval');
      L.push([m.category === 'agentic' ? 'Works on its own while p0pc0rn is open' : 'Checks on its own while p0pc0rn is open', (iv ? `Checks every ${fmtMin(iv.minMinutes)}${iv.calmMinutes ? ` (every ${fmtMin(iv.calmMinutes)} when calm)` : ''}` : 'Checks when p0pc0rn opens') + '. It never runs while p0pc0rn is closed, and never while something is rendering.']);
    }
    if (m.category === 'agentic') L.push(['Keeps a notebook on this phone', (m.goal ? `Its goal: ${String(m.goal).slice(0, 140)}. ` : '') + 'It brings what it finds to you to confirm.']);
    L.push(['Never sees your photos, Library, Cast or files', 'Apps run in a locked sandbox.']);
    return L;
  }
  const fmtMin = (n) => (n >= 120 && n % 60 === 0 ? n / 60 + ' hours' : n + ' minutes');
  function permSheet(skel, onAllow) {
    const { sheet, close } = api.sheet('app-perm', 'Allow ' + skel.manifest.name + '?');
    sheet.classList.add('app-perm');
    sheet.append(mk('p', 'footnote dim', (A.bundled.has(skel.manifest.id) ? 'Comes with p0pc0rn. ' : 'Imported skeleton: allow it only if you trust where it came from. ') + skel.manifest.description));
    const ul = mk('ul', 'perm-list');
    for (const [a, b] of permLines(skel)) { const li = mk('li'); li.append(mk('span', 'callout', a), mk('span', 'footnote dim', b)); ul.append(li); }
    sheet.append(ul);
    const ok = btn('Allow', 'btn cta', async () => { const g = { id: skel.manifest.id, key: permKey(skel.manifest), at: Date.now() }; await A.db.put('grants', g); A.grants.set(g.id, g); close(); onAllow && onAllow(); });
    ok.id = 'app-perm-allow';
    const no = btn('Don’t allow', 'btn', () => close()); no.id = 'app-perm-deny';
    sheet.append(ok, no);
  }

  // ---- import a skeleton
  async function importFile(file) {
    if (!file) return;
    if (file.size > 600e3) return api.toast('That file is too big for a skeleton');
    let b; try { b = JSON.parse(await file.text()); } catch (e) { return errorSheet('Not a skeleton file', ['The file is not JSON. A skeleton is one .p0skel.json file.']); }
    const e = checkBundle(b);
    if (e.length) return errorSheet('This skeleton can’t be used', e.slice(0, 12));
    const id = b.manifest.id;
    if (A.bundled.has(id)) return errorSheet('This skeleton can’t be used', [`"${id}" is the name of a skeleton that comes with p0pc0rn. Give it another id.`]);
    permSheet(b, async () => {
      await A.db.put('skels', { id, bundle: b, at: Date.now() }); A.skels.set(id, b); render();
      api.toast(`${b.manifest.name} is on your shelf`);
    });
  }
  function errorSheet(title, lines) {
    const { sheet } = api.sheet('app-err', title);
    const ul = mk('ul', 'perm-list'); for (const l of lines) ul.append(mk('li', 'footnote', l)); sheet.append(ul);
    sheet.append(mk('p', 'footnote dim', 'The Skeleton Guide (on the Apps tab) explains every rule. Send the AI the guide and the problems above to get a fixed file.'));
  }

  // ---- making an app with Juli
  async function make(text, only) {
    text = String(text || '').trim();
    if (text.length < 4) return api.toast('Say what the app should do');
    if (!api.installed('brain')) { setStatus('Download Juli first (Settings › Models), then Juli can make apps.', 'warn'); return; }
    if (!api.consented()) { setStatus('Agree to the p0pc0rn terms first (the short lesson), then Juli can make apps.', 'warn', { label: 'Start the lesson', fn: api.openLesson }); return; }
    if (A.making) return;
    const skels = [...A.skels.values()];
    setStatus('Juli is reading your request…');
    try {
      const j = await api.Q().add('makeapp', { text: text.slice(0, 600), only: only || null, skels: skels.map((s) => s.manifest.id) }, { title: text.slice(0, 60) });
      A.making = j.id;
      const r = await waitJob(j.id);
      A.making = null;
      if (!r.ok) { setStatus(r.message || 'Juli couldn’t make that app.', 'warn'); return; }
      const skel = A.skels.get(r.skel), name = String(r.slots.title || r.slots.app_name || skel.manifest.name).slice(0, 30);
      const app = await addApp(skel, r.slots, name, 'juli');
      const notes = [];
      if (r.gaps && r.gaps.length) notes.push(`This ${skel.manifest.name} skeleton can’t do: ${r.gaps.join('; ')}.`);
      if (r.defaulted && r.defaulted.length) notes.push(`Left as the skeleton’s starting values: ${r.defaulted.join(', ')}.`);
      setStatus(`Made “${app.name}” from the ${skel.manifest.name} skeleton.` + (notes.length ? ' ' + notes.join(' ') : ''), notes.length ? 'note' : 'good', { label: 'Open', fn: () => openApp(app) });
      $('apps-in').value = '';
    } catch (e) {
      A.making = null;
      const code = e && e.code;
      setStatus(code === 'NO_CONSENT' ? 'Agree to the p0pc0rn terms first (the short lesson).' : code === 'CANCELLED' ? 'Stopped.' : 'Juli couldn’t make that app: ' + String((e && e.message) || e).slice(0, 160), 'warn');
    }
  }
  function setStatus(text, tone = '', act = null) {
    const box = $('apps-status'); if (!box) return;
    box.hidden = !text; box.className = 'apps-status footnote' + (tone ? ' ' + tone : ''); box.replaceChildren(mk('span', null, text));
    if (act) box.append(btn(act.label, 'btn sm', act.fn));
  }
  /** the queue runner for 'makeapp' (app.js registers it with Juli's model). 3.8 (v040): modelId may be a function of the job (the
   *  Bigger brain makes apps when it can: app.js brainFor); a model with a small context (ctxOf(id) tokens: the Bigger brain's 2,048)
   *  makes the app only when the longest fill prompt of the job's skeletons can fit with its answer (the low estimate, before any model
   *  loads), else `small` (Juli's own model) does; an answer that would get less room than it needs is TOO_LONG on the model, and the
   *  queue gives the job to `small` then, as when the Bigger brain cannot load or runs out of memory (fallback) */
  const FILL_MIN = 600;   // tokens a fill's JSON answer needs
  function runner(modelId, { ctxOf = () => 0, small = null } = {}) {
    const fits = (id, j) => {
      const cap = ctxOf(id), P = (j && j.params) || {}; if (!cap) return true;
      return (P.skels || []).map((k) => A.skels.get(k)).filter(Boolean).every((s) => estTokens(fillMessages(s, P.text || '')) / EST_LOW + FILL_MIN <= cap);
    };
    const pick = (j) => { const id = typeof modelId === 'function' ? modelId(j) : modelId; return small && id !== small && !fits(id, j) ? small : id; };
    const fallback = small ? (j, m, e) => { if (!m || m === small) return null; api.diag('apps: the Bigger brain could not make this app, Juli does', { code: (e && e.code) || null }); return small; } : null;
    return { model: pick, fallback, needsConsent: false, async run(ctx) {
      const P = ctx.params, skels = (P.skels || []).map((id) => A.skels.get(id)).filter(Boolean);
      if (!skels.length) throw Object.assign(new Error('the app skeletons are not loaded yet'), { code: 'NOT_READY' });
      const cap = ctxOf(ctx.engine && ctx.engine.id);   // 3.8 (v040): on the Bigger brain each answer fits its context
      const llm = async (messages, o) => {
        const opts = Object.assign({}, o, { signal: ctx.signal });
        if (cap) {
          const want = opts.maxTokens || 256, room = cap - (await promptTokens(ctx.engine, messages)) - 8;
          if (room < Math.min(want, FILL_MIN)) throw Object.assign(new Error('the app request is too long for the Bigger brain'), { code: 'TOO_LONG' });   // the queue gives it to Juli
          opts.maxTokens = Math.min(want, room);
        }
        const r = await ctx.engine.chat(messages, opts); return (r && r.reply && r.reply.content) || (r && r.text) || '';
      };
      const stages = { route: 'Choosing a skeleton…', fill: 'Filling in the app…', retry: 'Trying again…', repair: 'Fixing a few details…', critic: 'Checking the result…' };
      return makeApp(llm, skels, P.text, { only: P.only, signal: ctx.signal, onStage: (s) => { setStatus('Juli: ' + (stages[s] || s)); try { ctx.progress({ stage: s }); } catch (e) { /* */ } } });
    } };
  }
  function askRunner(modelId) {
    return { model: () => modelId, needsConsent: false, async run(ctx) {
      const q = askMessages(ctx.params.app, ctx.params.prompt, !!ctx.params.json);
      const r = await ctx.engine.chat(q.messages, Object.assign({}, q.opts, { signal: ctx.signal }));
      return { text: String((r && r.reply && r.reply.content) || (r && r.text) || '').slice(0, 1200) };
    } };
  }

  // ---- rendering the tab
  function render() {
    const root = $('v-apps'); if (!root || !A.db) return;
    const mine = $('apps-mine'), ag = $('apps-agentic'), na = $('apps-tools');
    mine.replaceChildren(); ag.replaceChildren(); na.replaceChildren();
    $('apps-mine-none').hidden = A.apps.length > 0;
    for (const a of A.apps) {
      const skel = A.skels.get(a.skel), checks = !!skel && watches(skel);
      const row = mk('div', 'li app-row');
      const t = mk('span', 'app-txt'); t.append(mk('span', 'sw-name', a.name + (a.badge ? ` · ${a.badge}` : '')),
        mk('span', 'footnote dim', !skel ? 'Its skeleton is gone' : checks ? agenticLine(a, skel) : skel.manifest.name));
      const end = mk('span', 'li-end');
      const o = btn('Open', 'btn sm', () => openApp(a)); o.dataset.app = a.id; o.disabled = !skel;
      const d = btn('Delete', 'mini', () => api.confirm(`Delete “${a.name}”?`, 'Its data on this phone goes too.', 'Delete', () => removeApp(a)));
      end.append(o, d); row.append(t, end); mine.append(row);
    }
    for (const s of A.skels.values()) {
      const m = s.manifest, row = mk('div', 'li app-row skel-row'); row.dataset.skel = m.id;
      const t = mk('span', 'app-txt'); t.append(mk('span', 'sw-name', m.name + (A.bundled.has(m.id) ? '' : ' · imported')), mk('span', 'footnote dim', m.description));
      const end = mk('span', 'li-end col');
      end.append(btn('Use', 'btn sm', () => useAsIs(s)), btn('Make one', 'mini', () => { const i = $('apps-in'); i.value = ''; i.placeholder = `Describe your ${m.name.toLowerCase()}…`; A.only = m.id; i.focus(); setStatus(`Juli will use the ${m.name} skeleton. Describe what you want.`, ''); }));
      row.append(t, end); (m.category === 'agentic' ? ag : na).append(row);
    }
  }
  function agenticLine(a, skel) {
    if (!granted(skel)) return 'Not allowed yet: open it to allow';
    if (a.paused) return 'Stopped: ' + String(a.lastError || 'paused').replace(/^stopped: /, '').slice(0, 60);
    if (a.lastError) return 'Last check failed: ' + a.lastError.slice(0, 60);
    if (!a.lastCheck) return (skel.manifest.category === 'agentic' ? 'Agentic · works' : 'Checks') + ' while p0pc0rn is open';
    const mins = Math.max(0, Math.round((a.nextCheck - Date.now()) / 60e3));
    return `Checked ${ago(a.lastCheck)} · next in ${mins >= 60 ? Math.round(mins / 60) + ' h' : mins + ' min'}`;
  }
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };

  function wire() {
    $('apps-make').onclick = () => { const only = A.only || null; A.only = null; make($('apps-in').value, only); };
    $('apps-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('apps-make').click(); } });
    $('apps-import').onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importFile(f); };
  }
  wire();
  return { init, render, runner, askRunner, openApp, closeApp, make, tick, importFile, selfTest, get state() { return A; } };
}
