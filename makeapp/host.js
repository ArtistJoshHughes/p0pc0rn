// host.js - the Apps tab: apps made in p0pc0rn from skeletons (3.8). Two kinds on the shelf: NON-AGENTIC apps (tools the person uses;
// a "live" one may also check a source on a timer and post what it finds) and AGENTIC apps (Juli works in them on her own while p0pc0rn
// is open, in their checks only, never next to an open app: tasks, a notebook, a review queue; the Skeleton Guide has the rules).
// Every app runs in a sandboxed frame (makeapp/frame.html: an opaque origin with no network of its own and no storage)
// and reaches the page only through window.p0 (postMessage). This file is that bridge: it checks the app's granted permissions,
// fetches the listed sources itself (sources.js), keeps each app's storage, posts its notices, and runs the agentic checks.
// Apps never see photos, the Library, the Cast, files or another app's data. Granting is the person's tap on the permission sheet.
import { openDB, uid } from '../assistant/idb.js';
import { createSkills, makeSkillFor, SKILL } from '../assistant/skills.js';   // H39: skills, know-how for Juli (the Skills section; the make lane's prompts)
import { aboutWith, ABOUT } from '../assistant/memory.js';   // 3.9: About me in the make and change prompts (<= 80 tokens, where it fits)
import { share, saveFile } from '../util.js';   // H39: a skill's export (the share sheet, else a download)
import { checkBundle } from './check.js';
import { SOURCES, createFetcher } from './sources.js';
import { pausedFor, pauseLine, quotaRow } from './budget.js';   // 3.9 Wallet Watch: a free tier's cap, in the host's checks and on the settings page
import { creditsOf } from '../ui/storefront_core.js';   // 3.9 Wallet Watch: a source's credit with its links (Routescan's)
import { makeApp, fillMessages } from './fill.js';
import { estTokens, promptTokens, EST_LOW } from '../assistant/fit.js';   // 3.8 (v040): the Bigger brain's context
import { EDIT, workspace, oneSlot, planPhase, workPhase, reviewPhase, finish, lookMessages } from './edit.js';   // H39: changing an app by chat
import { CHOOSE, cleanChoose, chooseMessages, parseChoice, toolChoice } from './choose.js';   // 3.9: Juli picks a move in an open app (a game)
import { skillBody, skillHead } from '../assistant/skills.js';   // 3.9: a game's how-to-play skill
import { permRows, plainOf, previewLine } from '../ui/storefront_core.js';   // 3.9 polish (A1): every app in plain words (the permission sheet, the shelf, the make preview)

const DB = 'p0pc0rn-apps';
const STORE_MAX = 1e6;                 // bytes of storage per app
const LIM = { fetchPerMin: 30, postsPerHour: 10, asksPerHour: 20, badgesPerMin: 30, locationsPerMin: 6, errorsPerMin: 10 };
const SAVE = { value: 200000, keys: 500, bytes: 2e6, wait: 400, most: 2000 };   // one save: its size; per flush: keys, bytes; the debounce and its cap (ms)
const CHECK_MS = 25000, CHECK_JULI_MS = 110000;   // one check may take this long (an agentic app's, with its questions to Juli, longer)
const SEV = new Set(['info', 'watch', 'warning']);

/** what the person agrees to for a skeleton: its permissions as one comparable string (a new version that asks for more asks again) */
export const permKey = (m) => JSON.stringify({ s: !!(m.permissions || {}).storage, o: [...((m.permissions || {}).online || [])].sort(), j: !!((m.permissions || {}).juli || []).length,
  c: !!(m.permissions || {})['chat.post'], l: (m.permissions || {}).location || 'none', t: (m.triggers || []).map((t) => t.type).sort(), k: m.category || '',
  jc: ((m.permissions || {}).juli || []).includes('choose') || undefined });   // 3.9: only a choose app has 'jc' (every other grant stays as it was)

/** may this app make this call? -> null (yes) or the reason (no). grant = the person's yes for exactly these permissions. */
export function deny(m, granted, fn, args, mode) {
  if (!granted) return 'the person has not allowed this app yet';
  const P = m.permissions || {};
  if (fn === 'fetch') { const src = args && args[0]; return (P.online || []).includes(src) && SOURCES[src] ? null : `this app may not read ${src}`; }
  if (fn === 'chat.post') return P['chat.post'] ? null : 'this app may not post to the chat';
  if (fn === 'juli.ask') return !(P.juli || []).includes('ask') ? 'this app may not ask Juli' : m.category !== 'agentic' ? 'only an agentic app has Juli in it'
    : mode !== 'check' ? 'Juli works in the app\'s checks, after it closes (the open app keeps the phone\'s memory)' : null;   // never Juli next to an open app
  if (fn === 'juli.choose') return !(P.juli || []).includes('choose') ? 'this app may not ask Juli to choose' : m.category === 'agentic' ? 'Juli chooses only in an app the person has open'
    : mode !== 'run' ? 'Juli chooses only while the person has the app open' : null;   // 3.9: a game's move, next to the open game (the game hold)
  if (fn === 'juli.models') return !(P.juli || []).includes('choose') ? 'this app may not ask Juli to choose' : mode !== 'run' ? 'Juli chooses only while the person has the app open' : null;   // 3.9 polish: which of her models can answer
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
/** 3.9 Wallet Watch: why the phone is not idle now, in plain words ('' = idle): a model in memory or about to load (modelBusy), or a job
 *  of the person's queued, running or waiting on its children (a picture, a song, a clip, any model job; Juli answering them). own = the
 *  running check's own questions to Juli (never counted against it); a job blocked on the agreement or a download waits for the person,
 *  not the phone. Q = the queue (list({includeTerminal})); modelBusy() = the app's own test */
export function phoneBusy(Q, modelBusy, own) {
  try { if (typeof modelBusy === 'function' && modelBusy()) return 'Juli or a render is using the phone'; } catch (e) { return 'Juli or a render is using the phone'; }
  let L = [];
  try { L = Q && typeof Q.list === 'function' ? Q.list({ includeTerminal: false }) || [] : []; } catch (e) { return 'the queue is busy'; }
  const j = L.find((x) => x && (x.status === 'queued' || x.status === 'running' || x.status === 'waiting') && !(own && typeof own.has === 'function' && own.has(x.id)));
  return !j ? '' : j.kind === 'chat' ? 'Juli is answering you' : 'something else is running';
}

export function askMessages(app, prompt, json, skill = '') {   // 3.9 Wallet Watch: + the app's skill (know-how, after the rule)
  const name = String(app || '').slice(0, 30);
  const sys = json ? `An app on this phone called "${name}" asks for data. Reply with ONE JSON object and nothing else, in the form its message asks for. Never give financial advice.`
    : `An app on this phone called "${name}" asks a short question. Answer in at most three sentences. Never give financial advice.`;
  return { messages: [{ role: 'system', content: sys + (skill ? '\n\n' + String(skill).slice(0, 4000) : '') }, { role: 'user', content: String(prompt || '').slice(0, 4000) }],
    opts: json ? { maxTokens: 300 } : { maxTokens: 220, temperature: 0.3 } };   // data: exact (no temperature)
}

// ------------------------------------------------------------------------------------------------ the frame
/** startFrame: one app in a sandboxed iframe. calls = {name: async (args) => value} (already permission-checked by the caller). */
/** H39: custom = the app's added part (an edit by chat; its errors come to onCustomError(message, line), never stop the app); ctl.snap({png})
 *  -> {png (a PNG data URL <= 1 MB, when asked), w, h, scene, buttons, texts} for the edit loop's test runs */
/** 3.9 platform: how far an app's frame reaches into the screen's bottom unsafe area (the home indicator), in CSS pixels, 0 = not at
 *  all. A phone gives a frame no safe-area insets of its own, so the host measures the page's and tells the Kit (frame.html p0.safe) */
export function frameSafeBottom(f) {
  try {
    const p = document.createElement('div'), st = p.style;
    st.position = 'fixed'; st.left = '0'; st.bottom = '0'; st.width = '0'; st.height = '0'; st.visibility = 'hidden'; st.pointerEvents = 'none';
    st.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    document.body.append(p); const inset = parseFloat(getComputedStyle(p).paddingBottom) || 0; p.remove();
    if (!(inset > 0) || !f || !f.isConnected) return 0;
    const r = f.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!(r.height > 1) || !(vh > 0)) return 0;
    return Math.round(Math.max(0, Math.min(inset, r.bottom - (vh - inset), r.height)));
  } catch (e) { return 0; }
}

/** 3.9 platform: how far an app's frame reaches into the screen's top unsafe area (the status bar, the Dynamic Island), in CSS pixels;
 *  0 under p0pc0rn's bar. Inside a frame, env() reports the SCREEN's insets wherever the frame sits (measured: Edge 155 with the
 *  inset override; Josh's iPhone 16 Pro Max, Oct-27: a 59 px band over every app's title), so the host tells the Kit instead */
export function frameSafeTop(f) {
  try {
    const p = document.createElement('div'), st = p.style;
    st.position = 'fixed'; st.left = '0'; st.top = '0'; st.width = '0'; st.height = '0'; st.visibility = 'hidden'; st.pointerEvents = 'none';
    st.paddingTop = 'env(safe-area-inset-top, 0px)';
    document.body.append(p); const inset = parseFloat(getComputedStyle(p).paddingTop) || 0; p.remove();
    if (!(inset > 0) || !f || !f.isConnected) return 0;
    const r = f.getBoundingClientRect();
    if (!(r.height > 1)) return 0;
    return Math.round(Math.max(0, Math.min(inset - r.top, r.height)));
  } catch (e) { return 0; }
}

export function startFrame({ parent, frameUrl = 'makeapp/frame.html', libs, bundle, slots, store, mode = 'run', name = '', onSave = () => {}, onCall, onError = () => {}, onBreach = () => {}, hidden = false, custom = '', onCustomError = () => {} }) {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('allow', '');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.title = name || 'App'; f.className = hidden ? 'app-frame hidden' : 'app-frame';
  f.src = frameUrl;
  let readyRes, bootRes, bootRej; const pend = new Map(); let seq = 0, closed = false, errs = [], cerrs = 0;
  let safeSent = 0, safeTopSent = 0;   // 3.9 platform: the insets the frame was last told (frameSafeBottom, frameSafeTop)
  const ready = new Promise((r) => { readyRes = r; }), booted = new Promise((r, j) => { bootRes = r; bootRej = j; });
  const post = (m) => { try { f.contentWindow.postMessage(m, '*'); } catch (e) { /* gone */ } };
  const onMsg = async (ev) => {
    if (closed || ev.source !== f.contentWindow) return;
    const m = ev.data || {};
    if (m.t === 'ready') { readyRes(); post({ t: 'boot', p5: mode === 'check' ? '' : libs.p5, kit: libs.kit, code: bundle.files['sketch.js'], slots, store, mode, name, custom: String(custom || '').slice(0, 4096), safe: { bottom: (safeSent = frameSafeBottom(f)), top: (safeTopSent = frameSafeTop(f)) } }); return; }
    if (m.t === 'booted') { bootRes(m); return; }
    if (m.t === 'breach') { ctl.close(); onBreach(String(m.message || '').slice(0, 200)); return; }   // the sandbox caught the app reaching out: it stops now
    if (m.t === 'error') {
      const t = Date.now(); errs = errs.filter((x) => t - x < 60e3);
      if (!m.fatal && errs.length >= LIM.errorsPerMin) return;   // a looping app's errors: the first few a minute
      errs.push(t); onError(String(m.message || 'error').slice(0, 300), !!m.fatal); if (m.fatal) bootRej(new Error(m.message)); return;
    }
    if (m.t === 'save') { onSave(String(m.k || '').slice(0, 120), m.v == null ? null : String(m.v)); return; }
    if (m.t === 'checked') { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.ok ? p.res(m.value) : p.rej(new Error(m.error || 'check failed')); } return; }
    if (m.t === 'custom-error') { if (cerrs++ < LIM.errorsPerMin) onCustomError(String(m.message || 'error').slice(0, 300), m.line == null ? null : Math.max(1, +m.line || 1)); return; }   // H39: the added part's
    if (m.t === 'snapped') { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.ok ? p.res(m) : p.rej(new Error(m.error || 'no picture')); } return; }
    if (m.t === 'call') {
      let reply;
      try { reply = { t: 'reply', id: m.id, ok: true, value: await onCall(String(m.fn), Array.isArray(m.args) ? m.args : []) }; }
      catch (e) { reply = { t: 'reply', id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 300), code: (e && e.code) || null }; }
      post(reply);
    }
  };
  addEventListener('message', onMsg);
  parent.append(f);
  const onSafe = () => { if (closed) return; const b0 = frameSafeBottom(f), t0 = frameSafeTop(f); if (b0 !== safeSent || t0 !== safeTopSent) { safeSent = b0; safeTopSent = t0; post({ t: 'safe', bottom: b0, top: t0 }); } };   // 3.9 platform: a turn of the phone, a bar added under the frame
  addEventListener('resize', onSafe);
  const safeRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => onSafe()) : null; if (safeRO) safeRO.observe(f);   // the frame's own size (e.g. the credit bar below it)
  const ctl = {
    frame: f, ready, booted,
    snap(o = {}, ms = 6000) {   // H39: the edit loop's test run reads the screen (and, for a look, a picture of it)
      const id = ++seq;
      return new Promise((res, rej) => { pend.set(id, { res, rej }); post({ t: 'snap', id, png: !!o.png }); setTimeout(() => { if (pend.delete(id)) rej(Object.assign(new Error('the app did not show its screen'), { code: 'TIMEOUT' })); }, ms); });
    },
    check(ms = CHECK_MS) {
      const id = ++seq;
      return new Promise((res, rej) => { pend.set(id, { res, rej }); post({ t: 'check', id }); setTimeout(() => { if (pend.delete(id)) rej(Object.assign(new Error('the check took too long'), { code: 'TIMEOUT' })); }, ms); });
    },
    close() { if (closed) return; closed = true; removeEventListener('message', onMsg); removeEventListener('resize', onSafe); if (safeRO) safeRO.disconnect(); for (const p of pend.values()) p.rej(new Error('closed')); pend.clear(); try { f.src = 'about:blank'; } catch (e) { /* */ } f.remove(); },
  };
  return ctl;
}

// ------------------------------------------------------------------------------------------------ the Apps tab
export function createApps(api) {
  const A = { db: null, skels: new Map(), bundled: new Set(), apps: [], grants: new Map(), libs: null, open: null, checking: false, making: null, fetcher: createFetcher(), rate: new Map(), lastErr: null, checkJobs: new Set() };
  const $ = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const btn = (label, cls, onClick) => { const b = mk('button', cls || 'btn sm', label); b.type = 'button'; b.onclick = onClick; return b; };
  // 3.9 polish (A1): what an app does on its own goes out as a 'p0:apps' event (ui/works.js keeps the activity log; the home screen's
  // pill shows a running check); the person's pauses hold every check (one app: app.youPaused; all: localStorage 'p0pc0rn:apps:pause')
  const PLAIN_SRC = { 'weather.nws': 'the weather', 'alerts.nws': 'weather alerts', 'geocode.openmeteo': 'places', 'fires.wfigs': 'wildfires', 'prices.coingecko': 'prices', 'chain.snowtrace': 'Avalanche addresses on Snowtrace' };   // 3.9 Wallet Watch: + Snowtrace
  const tell = (type, app, d) => { try { dispatchEvent(new CustomEvent('p0:apps', { detail: Object.assign({ type, appId: app.id, name: app.name, skel: app.skel, at: Date.now() }, d || {}) })); } catch (e) { /* not a page */ } };
  const pausedAll = () => { try { return localStorage.getItem('p0pc0rn:apps:pause') === 'all'; } catch (e) { return false; } };
  const UI = () => globalThis.P0STORE || null;   // the Apps screen's own parts (ui/storefront.js): the first-open intro, the icons
  const HOSTS = () => Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.host]));
  const ICONS = { cloud: '#i-sf-cloud', pin: '#i-sf-pin', flame: '#i-sf-flame', chart: '#i-sf-chart', juli: '#i-chat', game: '#i-sh-game', chat: '#i-chat', clock: '#i-sf-clock', check: '#i-check', lock: '#i-sf-lock', book: '#i-sh-skill', shield: '#i-shield' };
  // 3.9 Wallet Watch: a source with a free tier (Snowtrace) rests when the day's cap (every app together, or this app's share) is used up
  // or after a 429 (makeapp/budget.js, the fetcher's hard cap): an app that reads it is not checked then (no frame starts, nothing is
  // sent), and its card says until when. -> {code, until, line} | null
  const capOf = (skel, appId = '') => { try { for (const s of ((skel && skel.manifest.permissions) || {}).online || []) { const S = SOURCES[s]; if (S && S.budget) { const p = pausedFor(S.budget, localStorage, Date.now(), appId); if (p) return Object.assign(p, { line: pauseLine(S.budget, p) }); } } } catch (e) { /* no storage: the fetcher still caps */ } return null; };
  // 3.9 Wallet Watch (Josh, Oct-27: "Users don't need to be pinging routescan api every second ... when other jobs will require on device
  // time"): an app that reads a source marked idleOnly (Snowtrace) is checked at most every minMinutes of its interval trigger (15 at the
  // least), whatever asks for the check (p0pc0rn opening, the app just closed), and only when the phone is idle (phoneBusy): its check
  // waits for the next idle tick and never goes first. Once its check runs, a job of the person's that arrives stops its requests (BUSY:
  // nothing more is sent) and its question to Juli (cancelled: the app's own words go).
  const idleOnly = (skel) => { try { return (((skel && skel.manifest.permissions) || {}).online || []).some((s) => SOURCES[s] && SOURCES[s].idleOnly); } catch (e) { return false; } };
  const busyNow = () => phoneBusy(api.Q && api.Q(), () => !!(api.modelBusy && api.modelBusy()), A.checkJobs);
  const floorOf = (skel) => { const iv = ((skel && skel.manifest.triggers) || []).find((t) => t && t.type === 'interval'); return Math.max(15, (iv && iv.minMinutes) || 15); };
  const tooSoon = (app, skel) => Date.now() - ((app && app.lastCheck) || 0) < floorOf(skel) * 60e3;
  /** the settings page's rows for a design that reads a capped source: how often it checks (at most every N minutes, only when the phone is
   *  idle) and "Snowtrace requests today: N of 5,000" (this app's share in its sub) */
  const quotaRows = (skelId, appId = '') => {
    const s = A.skels.get(skelId), out = [];
    try {
      if (s && idleOnly(s)) out.push({ text: `Checks at most every ${floorOf(s)} minutes, only when your phone is idle`, sub: 'It waits while Juli answers you or something is being made (a picture, a song, a clip), and never goes first.', icon: '#i-sf-clock' });
      for (const id of ((s && s.manifest.permissions) || {}).online || []) { const S = SOURCES[id]; if (S && S.budget) out.push(quotaRow(S.budget, localStorage, Date.now(), appId)); }
    } catch (e) { /* none */ }
    return out;
  };
  // 3.9 Wallet Watch: a source's credit with direct links (Snowtrace: "Powered by Routescan.io APIs", routescan.io and Routescan's account
  // on X). They open the way p0pc0rn opens every outside link (a new tab: the phone's own browser sheet); p0pc0rn never fetches them
  const linkEl = (l) => { const a = mk('a', null, l.text); if (/^https:\/\//.test(String(l.href))) a.href = l.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; if (l.label) a.setAttribute('aria-label', l.label); return a; };
  const creditEl = (c, tag = 'span', cls = 'footnote ww-links') => { const s = mk(tag, cls, c.line + ': '); c.links.forEach((l, i) => { if (i) s.append(' · '); s.append(linkEl(l)); }); return s; };
  /** the running app's credit, under the app (the sandboxed app can hold no link of its own) */
  const creditBar = (skel) => { const L = creditsOf(skel && skel.manifest); if (!L.length) return null; const d = mk('div', 'app-credit'); d.id = 'app-credit'; for (const c of L) d.append(creditEl(c, 'p', 'footnote')); return d; };
  const svgIcon = (href) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', href); s.append(u); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'sf-perm-ic'); return s; };

  async function init() {
    // H39: version 2 adds the stores this update needs (skills: assistant/skills.js; memory: About me and routines); v1's stores and
    // everything in them stay as they are (idb.js creates only the stores that are missing)
    A.db = await openDB(DB, 2, { apps: { keyPath: 'id' }, kv: { keyPath: 'id' }, skels: { keyPath: 'id' }, grants: { keyPath: 'id' }, skills: { keyPath: 'name' }, memory: { keyPath: 'id' } });
    const idx = await (await fetch('makeapp/skeletons/index.json', { cache: 'no-cache' })).json();
    for (const s of idx.skeletons) {
      try { const b = await (await fetch('makeapp/skeletons/' + s.file, { cache: 'no-cache' })).json(); const e = checkBundle(b); if (e.length) { api.diag('apps: bundled skeleton failed its check', { id: s.id, n: e.length }); continue; } A.skels.set(b.manifest.id, b); A.bundled.add(b.manifest.id); }
      catch (e) { api.diag('apps: bundled skeleton missing', { id: s.id }); }
    }
    for (const r of await A.db.all('skels')) if (!A.bundled.has(r.id) && !checkBundle(r.bundle).length) A.skels.set(r.id, r.bundle);
    for (const g of await A.db.all('grants')) A.grants.set(g.id, g);
    await loadSkills();   // H39: p0pc0rn's skills (skills/) and the person's; the Skills section
    A.apps = (await A.db.all('apps')).sort((a, b) => a.createdAt - b.createdAt);
    wireEdits();   // H39: an app change's progress and its end
    render();
    setTimeout(() => tick(true), 8000);            // 'on-open': the agentic apps check once soon after p0pc0rn opens
    // memory (the phone's ~1.86 GB page cap): an open app closes when Juli or a render starts (its own question to Juli excepted)
    api.Q().on('change', (j) => { if (j.status === 'running' && A.open && api.Q().modelOf(j) && !gameMove(j)) { const n = A.open.app.name; closeApp(); api.toast(`${n} closed: Juli or a render needs the memory`); } });
    setInterval(() => tick(false), 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => tick(true), 3000); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') for (const id of [...pendingSave.keys()]) flushApp(id); });   // 3.9 polish: a game's last move is kept when the phone puts p0pc0rn away
  }
  async function libs() {
    if (A.libs) return A.libs;
    const [p5, kit] = await Promise.all(['makeapp/p5.min.js', 'makeapp/kit.js'].map(async (u) => { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); }));   // 3.9 (review): revalidated: a Kit kept from 3.8 never runs a 3.9 app
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
  /** 3.9 polish: write an app's waiting saves now (a game's last move, before Juli's job: it may load her model in a planned fresh page) */
  async function flushApp(appId) { const p = pendingSave.get(appId); if (!p) return; clearTimeout(p.t); try { await writeSaves(appId, p); } catch (e) { /* as the timer's write */ } }

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
      if (fn === 'fetch') {   // 3.9 polish: + the activity log
        limit(app.id, 'fetch', LIM.fetchPerMin, 60e3); const t0 = Date.now(), v = await A.fetcher(args[0], args[1] || {}, app.id, { gate: mode === 'check' && idleOnly(skel) ? busyNow : null });   // 3.9 Wallet Watch: a check yields to the person's jobs
        tell('step', app, { what: 'fetch', source: String(args[0]), label: PLAIN_SRC[args[0]] || 'a source', mode, cached: !(v && v.fetchedAt >= t0) }); return v;
      }
      if (fn === 'chat.post') { limit(app.id, 'post', LIM.postsPerHour, 3600e3); const n = cleanNotice(args[0]); await api.notice(app.name, n); tell('step', app, { what: 'post', title: n.title, mode }); return true; }
      if (fn === 'juli.ask') { limit(app.id, 'ask', LIM.asksPerHour, 3600e3); tell('step', app, { what: 'ask', mode }); return askJuli(app, String(args[0] || '').slice(0, 4000), { json: !!(args[1] && args[1].json), check: mode === 'check', skill: args[1] && args[1].skill, yields: mode === 'check' && idleOnly(skel) }); }   // 3.9 Wallet Watch: + the app's skill; it yields
      if (fn === 'juli.choose') { limit(app.id, 'choose', CHOOSE.perHour, 3600e3); return chooseJuli(app, skel, args[0]); }   // 3.9: a game's move
      if (fn === 'juli.models') return { juli: !!api.installed('brain'), big: !!(A.chooseBig && A.chooseBig()) };   // 3.9 polish: the Bigger brain downloaded and on
      if (fn === 'location.get') { limit(app.id, 'loc', LIM.locationsPerMin, 60e3); return deviceLocation(); }
      if (fn === 'app.badge') {
        limit(app.id, 'badge', LIM.badgesPerMin, 60e3);
        const b = Math.max(0, Math.min(99, +args[0] || 0)); if (b === (app.badge || 0)) return true;
        if (b > (app.badge || 0)) app.newsAt = Date.now();   // 3.9 home cards: news arrived (a card swiped away comes back)
        app.badge = b; await A.db.put('apps', app); render(); tell('step', app, { what: 'badge', n: b, mode }); return true;
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
    if (o.yields) { const b = busyNow(); if (b) throw Object.assign(new Error('Juli waits for an idle phone: ' + b), { code: 'BUSY' }); }   // 3.9 Wallet Watch: never first
    const j = await api.Q().add('appask', { prompt, app: app.name, json: !!o.json, skill: appSkill(o.skill) }, { title: app.name });   // 3.9 Wallet Watch: + its skill
    if (o.check) A.checkJobs.add(j.id);   // a check's question goes with the check (closed, timed out, or stopped)
    // 3.9 Wallet Watch: a job of the person's that arrives while Juli writes for a check that yields goes first: her answer for the app
    // is cancelled (the app writes its own words)
    const off = o.yields && api.Q().on ? api.Q().on('change', (x) => { if (x && x.id !== j.id && !A.checkJobs.has(x.id) && (x.status === 'queued' || x.status === 'running' || x.status === 'waiting')) api.Q().cancel(j.id).catch(() => {}); }) : null;
    let r; try { r = await waitJob(j.id); } finally { A.checkJobs.delete(j.id); if (typeof off === 'function') off(); }
    return String(r.text || '').slice(0, 1200);
  }
  // ---- 3.9: Juli as a player (makeapp/choose.js). A game (permissions.juli ["choose"], non-agentic) offers Juli its LEGAL moves on her
  // turn; she picks one in the queue job 'appchoose' on her own model, NEXT TO the open game (the one model job that does not close it),
  // and p0pc0rn checks her answer is one of the options. Her model stays loaded between moves (holdFor: the game hold, a minute after each
  // move) and leaves when the game closes. 3.9 polish: her answer is her move; when there is none the game gets by 'fallback' with why
  // and asks her again or says so ("Ask Juli again"): it never makes the move itself. The mover is Juli's own model; the Bigger brain
  // only when the game asks for it (big: the opponent the person earned and chose) and it is downloaded and on, never one model for
  // the other.
  const GAME_HOLD = 60000;
  /** a game's how-to-play skill for one move: on, for games, framed as know-how and cut to CHOOSE.skillTokens -> text, or '' */
  function gameSkill(name) {
    const k = name && A.skills ? A.skills.getSkill(name) : null;
    if (!k || !k.enabled || !(k.for || []).includes('game')) return '';
    const body = skillBody(k, CHOOSE.skillTokens);
    return body ? skillHead(k) + '\n' + body : '';
  }
  /** 3.9 Wallet Watch: the skill an app that works for you names in a question to Juli (K.ask(prompt, {skill})): on, for apps ('app'),
   *  framed as know-how and cut to CHOOSE.skillTokens -> text, or '' (a skill is never a permission: it only rides along) */
  function appSkill(name) {
    const k = name && A.skills ? A.skills.getSkill(String(name).slice(0, 40)) : null;
    if (!k || !k.enabled || !(k.for || []).includes('app')) return '';
    const body = skillBody(k, CHOOSE.skillTokens);
    return body ? skillHead(k) + '\n' + body : '';
  }
  /** the open game's choose call -> {index, option, by: 'juli' | 'fallback', why} (options a person could not choose between throw) */
  async function chooseJuli(app, skel, arg) {
    const o = cleanChoose(arg);
    const fb = (why) => ({ index: 0, option: o.options[0], by: 'fallback', why });
    if (!api.installed('brain')) return fb('Juli is not downloaded');
    const big = !!(arg && arg.big === true);   // 3.9 polish: the Bigger brain is the game's opponent (never her own model instead)
    if (big && !(A.chooseBig && A.chooseBig())) return fb('the Bigger brain is not on');
    if (!A.open || A.open.app.id !== app.id) return fb('the game is not open');
    A.chooseJobs = A.chooseJobs || new Set();
    // one move at a time PER OPEN GAME (taken before the first await). 3.9 polish: a move still waiting from a game that was closed
    // (its job is being cancelled) no longer answers the game opened again with "still choosing"
    if (A.choosing && A.choosing.fr === A.open.fr) return fb('Juli is still choosing');
    const mine = A.choosing = { fr: A.open.fr };
    let j = null;
    try {
      await flushApp(app.id);   // 3.9 polish: the game's last move is on the phone before Juli's job starts
      j = await api.Q().add('appchoose', { appId: app.id, app: app.name, about: o.about, options: o.options, hint: o.hint, skill: gameSkill(o.skill), big }, { title: app.name });
      A.chooseJobs.add(j.id);
      const r = await waitJob(j.id), i = Number.isInteger(r.index) && r.index >= 0 && r.index < o.options.length ? r.index : 0;
      const hers = r.by === 'juli' && r.index === i;   // 3.9 polish: no answer naming a choice comes back with why (the game asks again)
      return { index: i, option: o.options[i], by: hers ? 'juli' : 'fallback', why: hers ? '' : String(r.why || 'her answer named no choice'), said: r.said || null, model: r.model || null, big: !!r.big };
    } catch (e) { return fb(j ? String((e && e.code) || 'it stopped') : 'the queue is busy'); }
    finally { if (j) A.chooseJobs.delete(j.id); if (A.choosing === mine) A.choosing = null; }
  }
  /** the open game's own move job: the one model job that leaves the open app open */
  const gameMove = (j) => !!(j && j.kind === 'appchoose' && A.open && (j.params || {}).appId === A.open.app.id);
  /** the game closed: its waiting move stops and Juli's game hold lets go */
  function endGame(app) {
    if (A.chooseJobs) for (const id of A.chooseJobs) api.Q().cancel(id).catch(() => {});
    if (A.lastChoose && A.lastChoose.appId === app.id) { A.lastChoose = null; api.endHold(); }
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
    if (!skel) return api.toast('This app’s design is no longer on this phone');
    if (watches(skel) && !app.openedAt && UI() && UI().needsIntro && UI().needsIntro(skel)) return UI().intro(skel, () => openApp(app));   // 3.9 polish: its first open: what it does, what it sees, how to pause it
    if (!granted(skel)) return permSheet(skel, () => openApp(app));
    // 3.9 polish: a game closed while Juli chose its move and opened again at once: that move (cancelled when the game closed) clears
    // first, up to 4 s, instead of "Apps open when the queue is idle"
    for (let i = 0; i < 40 && api.Q() && api.Q().active && api.Q().active.job && api.Q().active.job.kind === 'appchoose'; i++) await new Promise((r) => setTimeout(r, 100));
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
    bar.append(x, mk('span', 'headline app-name', app.name), mk('span', 'footnote dim app-kind', watches(skel) ? 'Works for you' : ''));   // 3.9 polish: plain words
    const body = mk('div', 'app-body'); wrap.append(bar, body); document.body.append(wrap);
    { const cr = creditBar(skel); if (cr) wrap.append(cr); }   // 3.9 Wallet Watch: its source's credit with direct links, under the app
    document.documentElement.classList.add('app-open');
    await flushApp(app.id);   // 3.9 polish: closed and opened again at once, the app starts from its last save
    const store = await storeOf(app.id);
    const fr = startFrame({ parent: body, frameUrl: api.frameUrl || 'makeapp/frame.html', libs: L, bundle: skel, slots: app.slots, store, mode: 'run', name: app.name,
      custom: app.custom || '', onCustomError: (m) => { api.diag('apps: an added part stopped', { skel: app.skel }); notice1(app.id, `${app.name}: its added part stopped (${m.slice(0, 60)}). Change › Undo puts it back.`); },   // H39
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
    endGame(app);   // 3.9: its move stops; Juli's game hold lets go
    const w = $('app-run'); if (w) w.remove();
    document.documentElement.classList.remove('app-open');
    // an app that checks on its own and was just set up (a place, a trip) checks within a minute, not at its calm interval
    const skel = A.skels.get(app.skel);
    if (skel && watches(skel)) { app.nextCheck = Date.now() + 5000; app.soon = true; A.db.put('apps', app).catch(() => {}); setTimeout(() => tick(false), 6000); }
    render();
  }

  // ---- the checks of agentic and live apps (only while p0pc0rn is open; never while a picture, clip or song is rendering)
  function due(app, skel, onOpen) {
    if (!skel || !watches(skel) || !granted(skel) || app.paused || app.youPaused || pausedAll()) return false;   // 3.9 polish: + the person's pauses (one app, or all)
    if (capOf(skel, app.id)) return false;   // 3.9 Wallet Watch: its source's free limit (every app, or its share): no check, nothing sent
    if (idleOnly(skel) && (tooSoon(app, skel) || busyNow())) return false;   // 3.9 Wallet Watch: at most every 15 minutes, only when the phone is idle
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
    try { for (const a of list) { if (A.open || api.modelBusy() || a.youPaused || pausedAll()) break; if (idleOnly(A.skels.get(a.skel)) && busyNow()) continue; await runCheck(a); } } finally { A.checking = false; A.checkFr = null; A.checkingId = null; render(); }
  }
  async function runCheck(app) {
    const skel = A.skels.get(app.skel), T = skel.manifest.triggers || [], iv = T.find((t) => t.type === 'interval');
    let L; try { L = await libs(); } catch (e) { return; }
    await api.settle();   // 3.8 (iOS 27): a few seconds after a model leaves
    if (A.open || api.modelBusy()) return;
    if (idleOnly(skel) && busyNow()) return;   // 3.9 Wallet Watch: a job of the person's came first: the next idle tick
    const host = $('app-checks') || document.body.appendChild(Object.assign(mk('div', 'app-checks'), { id: 'app-checks' }));
    const store = await storeOf(app.id);
    let breach = false;
    const fr = startFrame({ parent: host, frameUrl: api.frameUrl || 'makeapp/frame.html', libs: L, bundle: skel, slots: app.slots, store, mode: 'check', name: app.name, hidden: true,
      custom: app.custom || '',   // H39: the added part runs in a check too (its hooks do not)
      onSave: (k, v) => save(app.id, k, v), onCall: callsFor(app, skel, 'check'), onError: () => {}, onBreach: () => { breach = true; } });
    A.checkFr = fr; A.checkingId = app.id; tell('check-start', app);   // 3.9 polish: the home screen's activity pill and the log
    let out = null, err = null;
    const ms = skel.manifest.category === 'agentic' && ((skel.manifest.permissions || {}).juli || []).includes('ask') ? CHECK_JULI_MS : CHECK_MS;
    try { await Promise.race([fr.booted, new Promise((r, j) => setTimeout(() => j(new Error('the app did not start')), 15000))]); out = await fr.check(ms); }
    catch (e) { err = String((e && e.message) || e).slice(0, 200); }
    fr.close(); dropCheckJobs(); await flushSaves();
    if (breach) { err = 'stopped: it tried to reach outside its sandbox'; out = null; app.paused = true; api.diag('apps: sandbox stopped an app', { skel: app.skel }); }   // it does not run on its own again
    if (err && (app.youPaused || pausedAll())) err = null;   // 3.9 polish: the person paused it during the check: not a failure
    const active = !!(out && out.active);
    if (err && err !== app.lastError) app.newsAt = Date.now();   // 3.9 home cards: a new problem is news too
    app.lastCheck = Date.now(); app.lastError = err; app.lastActive = active; app.soon = false;
    // 3.9 Wallet Watch: a check may say when it wants the next one ({next: minutes}), kept within its trigger's minMinutes .. calmMinutes
    const nx = !err && out && iv && Number.isFinite(+out.next) && +out.next > 0 ? Math.max(iv.minMinutes, Math.min(Math.max(iv.calmMinutes || iv.minMinutes, iv.minMinutes), Math.round(+out.next))) : 0;
    app.nextCheck = Date.now() + (nx ? nx * 60e3 : ((active || !iv ? (iv ? iv.minMinutes : 720) : (iv.calmMinutes || iv.minMinutes)) * 60e3) * (err ? 0.5 : 1));
    await A.db.put('apps', app);
    api.diag('apps: check', { skel: app.skel, ok: !err, active, posted: out && out.posted || 0 });
    tell('check-end', app, { ok: !err, found: app.badge || 0, posted: (out && out.posted) || 0, error: err || null, active });   // 3.9 polish
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
    await A.db.put('apps', app); A.apps.push(app); render(); tell('added', app, { from });   // 3.9 polish
    return app;
  }
  async function removeApp(app) {
    if (A.open && A.open.app.id === app.id) closeApp();
    await A.db.del('apps', app.id); await A.db.del('kv', app.id);
    try { if (globalThis.P0APPICON) globalThis.P0APPICON.drop(app.id); } catch (e) { /* */ }   // 3.9: its home-screen icon goes with it
    A.apps = A.apps.filter((a) => a.id !== app.id); render(); api.toast('Deleted'); tell('removed', app);   // 3.9 polish
  }
  function useAsIs(skel) {
    const go = async () => { const a = await addApp(skel, JSON.parse(JSON.stringify(skel.slots_default || {})), skel.manifest.name, 'shelf'); madeCard(a, `“${a.name}” is in My apps.`); openApp(a); };
    const ask = () => { if (!granted(skel)) permSheet(skel, go); else go(); };
    if (watches(skel) && UI() && UI().needsIntro && UI().needsIntro(skel)) return UI().intro(skel, ask);   // 3.9 polish: what it does, sees and how to pause it, before it asks
    ask();
  }
  // 3.9 polish (A1). The shelf's button: the app the person already has from a design opens (no second copy by accident: Josh saw his
  // game twice, under My apps and under Games), else Get
  const yours = (skelId) => A.apps.filter((a) => a.skel === skelId).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
  function getOrOpen(skel) { const mine = yours(skel.manifest.id); return mine ? openApp(mine) : useAsIs(skel); }
  /** 3.9 polish (A1). Josh, 10-27: "Optional, with a one-tap offer". Make and Get put a new app in My apps, never on the home screen by
   *  themselves. The card that says so offers Add to Home Screen (its letter, or an icon Juli makes: ui/appicon.js, as My apps' own
   *  button does), and the person's tap lands it as an install: a ring fills on the home screen, then its icon pops in (ui/shell.js) */
  const onHome = (app) => { try { return JSON.parse(localStorage.getItem('p0pc0rn:home:pins') || '[]').some((p) => p && p.id === 'app:' + app.id); } catch (e) { return false; } };
  function addToHome(app, b) {
    const S = globalThis.SHELL, I = globalThis.P0APPICON, o = { id: 'app:' + app.id, title: app.name, ref: app.id, open: () => openApp(app) };
    const landed = () => {
      if (b) { b.textContent = 'On the Home Screen'; b.disabled = true; const n = b.closest('.apps-status') && b.closest('.apps-status').querySelector('.sf-made-note'); if (n) n.textContent = 'It’s on your Home Screen too.'; }
      render();
    };
    if (onHome(app)) { api.toast(`${app.name} is on the Home Screen`); landed(); return; }
    const pinIt = () => {
      let ok = false; try { ok = !!(S.install ? S.install(o) : S.pin(o)); } catch (e) { ok = false; }
      api.toast(ok ? `${app.name} is on the Home Screen` : 'The Home Screen is full: remove a pinned app first');
      if (ok) landed();
      return ok;
    };
    if (I && I.offer) I.offer(app, pinIt); else pinIt();
  }
  /** the card after Make or Get, as the preview's: the tile that would land on the home screen, the line, the offer; then Add to Home
   *  Screen (the person's tap) and Open */
  function madeCard(app, text) {
    setStatus(text, 'good', { label: 'Open', fn: () => openApp(app) });
    const S = globalThis.SHELL, box = $('apps-status'); if (!box || !S || !(S.install || S.pin)) return;   // no home screen here: the line and Open
    try { if (globalThis.P0APPICON) globalThis.P0APPICON.made(app, () => openApp(app)); } catch (e) { /* the plain button below */ }   // 3.9: "Add to Home Screen", an icon optional (ui/appicon.js)
    let b = box.querySelector('#ai-add');
    if (!b) { b = btn('Add to Home Screen', 'btn sm ai-add', null); b.id = 'ai-add'; }
    b.onclick = () => addToHome(app, b);   // the person's tap: an install (the ring); its sheet still offers the icon
    b.classList.remove('ghost'); b.classList.add('cta');
    const open = btn('Open', 'btn sm ghost', () => openApp(app)); open.id = 'apps-made-open';
    const card = mk('div', 'sf-pv sf-made');
    try { const I = UI(); if (I && I.appIconEl) card.append(I.appIconEl(app, 'sf-pv-ico')); } catch (e) { /* no icon */ }
    const txt = mk('div', 'sf-pv-txt');
    txt.append(mk('p', 'headline sf-pv-line', text), mk('p', 'footnote dim sf-made-note', 'Want it on your Home Screen too? Add it with its letter, or let Juli make it an icon. You can also do it later in My apps.'));
    card.append(txt);
    const row = mk('div', 'sf-pv-row sf-made-row'); row.append(b, open);
    box.className = 'apps-status footnote sf-preview'; box.replaceChildren(card, row);
  }
  /** the person's pause of one app (its checks wait; the one that runs now stops) and of every app (Pause all) */
  async function setPaused(app, on) {
    app.youPaused = !!on; await A.db.put('apps', app).catch(() => {});
    if (on && A.checkingId === app.id) stopCheck();
    tell('paused', app, { on: !!on }); render();
  }
  function setPauseAll(on) {
    try { if (on) localStorage.setItem('p0pc0rn:apps:pause', 'all'); else localStorage.removeItem('p0pc0rn:apps:pause'); } catch (e) { /* this page only */ }
    if (on) stopCheck();
    tell('paused', { id: '*', name: 'All apps', skel: '' }, { on: !!on }); render();
    if (!on) setTimeout(() => tick(false), 1500);
  }
  /** access taken back (the app's settings page): its grant goes and its checks stop; the next open or check asks again */
  async function revoke(skelId) {
    await A.db.del('grants', skelId).catch(() => {}); A.grants.delete(skelId);
    if (A.open && A.open.app.skel === skelId) closeApp();
    if (A.checkingId && (A.apps.find((a) => a.id === A.checkingId) || {}).skel === skelId) stopCheck();
    render();
  }
  /** what the app wrote in its own log (K.agent.logs, e.g. "Checked 1 trip: 1 new to look at"), newest first: shown as text, never run */
  async function ownLog(appId, max = 8) {
    try {
      const st = await storeOf(appId), raw = st && st['p0kit:agent.v1'], v = raw ? JSON.parse(raw) : null;
      return (v && Array.isArray(v.log) ? v.log : []).slice(0, max).map((l) => ({ at: +l.at || 0, text: String(l.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160), n: +l.n || 1 }));
    } catch (e) { return []; }
  }
  /** Change's before and after: the app as it was before its last change and as it is now, each run once, unseen, on the person's data
   *  (read only: nothing saved, fetched or posted) -> { before, after } PNG Blobs; null while a model or an app holds the memory */
  async function beforeAfter(app) {
    const skel = A.skels.get(app.skel), h = (app.history || [])[0];
    if (!skel || !h || A.open || api.modelBusy()) return null;
    const shot = async (ws) => { const r = await testRun(app, skel, ws, { png: true }); return r.png ? pngBlob(r.png) : null; };
    return { before: await shot({ slots: h.slots, custom: h.custom || '', name: h.name || app.name }), after: await shot({ slots: app.slots, custom: app.custom || '', name: app.name }) };
  }

  // ---- the permission sheet (the person's own tap; never automated). 3.9 polish (A1): as a phone asks, "“Trip Watch” would like to:", one
  // plain row per thing it asks for (ui/storefront_core.js permRows; the choose line keeps the game part's words), then Allow / Don’t Allow
  function permLines(skel) {
    const L = permRows(skel.manifest, HOSTS()).map((r) => [r.text, r.sub, r.icon, r.credit]);   // 3.9 Wallet Watch: + a source's credit (its links)
    const sk = Object.keys(skel.skills || {});   // H39: know-how it brings for Juli (Skills shows each one in full)
    if (sk.length) L.push([sk.length === 1 ? 'Bring a skill for Juli' : `Bring ${sk.length} skills for Juli`, `Know-how she reads when it fits what you ask (${sk.join(', ')}). A skill has no screen, no code and no permissions.`, 'book']);
    L.push(['Never sees your photos, Library, Cast or files', 'Apps run in a locked box on this phone.', 'shield']);
    return L;
  }
  function permSheet(skel, onAllow) {
    const m = skel.manifest;
    const { sheet, close } = api.sheet('app-perm', `“${m.name}” would like to:`);
    sheet.classList.add('app-perm', 'sf-perm');
    try { const I = UI(); if (I && I.iconEl) sheet.insertBefore(I.iconEl(m, 'big'), sheet.firstChild); } catch (e) { /* no icon */ }
    const ul = mk('ul', 'perm-list sf-perm-list');
    for (const [a, b, icon, credit] of permLines(skel)) { const li = mk('li'); li.dataset.icon = icon || ''; li.append(svgIcon(ICONS[icon] || '#i-check'), mk('span', 'callout', a), mk('span', 'footnote dim', b)); if (credit) li.append(creditEl(credit)); ul.append(li); }   // 3.9 Wallet Watch: + the credit's links
    sheet.append(mk('p', 'footnote sf-perm-plain', plainOf(m)), ul);
    sheet.append(mk('p', 'footnote dim sf-perm-from', (A.bundled.has(m.id) ? 'Comes with p0pc0rn.' : 'Made by someone else: allow it only if you trust where it came from.') + (watches(skel) ? ' You can pause it, or turn this off, any time in its settings.' : ' You can turn this off any time in its settings.')));
    const ok = btn('Allow', 'btn cta', async () => { const g = { id: m.id, key: permKey(m), at: Date.now() }; await A.db.put('grants', g); A.grants.set(g.id, g); close(); onAllow && onAllow(); });
    ok.id = 'app-perm-allow';
    const no = btn('Don’t Allow', 'btn', () => close()); no.id = 'app-perm-deny';
    sheet.append(ok, no);
  }

  // ---- import a skeleton
  async function importFile(file) {
    if (!file) return;
    if (file.size > 600e3) return api.toast('That file is too big for an app design');   // 3.9 polish: plain words
    let b; try { b = JSON.parse(await file.text()); } catch (e) { return errorSheet('Not an app design file', ['The file is not JSON. An app design is one .p0skel.json file.']); }
    const e = checkBundle(b);
    if (e.length) return errorSheet('This app design can’t be used', e.slice(0, 12));
    const id = b.manifest.id;
    if (A.bundled.has(id)) return errorSheet('This app design can’t be used', [`"${id}" is the name of an app design that comes with p0pc0rn. Give it another id.`]);
    const clash = A.skills && b.skills ? A.skills.bundleClashes(id, b.skills) : [];   // H39: a skill name another skill on this phone has
    if (clash.length) return errorSheet('This app design can’t be used', clash);
    permSheet(b, async () => {
      await A.db.put('skels', { id, bundle: b, at: Date.now() }); A.skels.set(id, b);
      if (A.skills) await A.skills.setBundle(id, b.skills || {});   // H39: the skills it brings, on once the person allowed it (a new version's replace the old)
      render(); renderSkills();
      api.toast(`${b.manifest.name} is on your shelf`);
    });
  }
  function errorSheet(title, lines) {
    const { sheet } = api.sheet('app-err', title);
    const ul = mk('ul', 'perm-list'); for (const l of lines) ul.append(mk('li', 'footnote', l)); sheet.append(ul);
    sheet.append(mk('p', 'footnote dim', 'Send these lines and the guide for AI helpers (Apps › Make your own app design) to the AI that wrote the file: it explains every rule, and you get a fixed file.'));
  }

  // ---- H39: Skills, know-how for Juli (assistant/skills.js). The Skills section lists p0pc0rn's own skills and the person's, shows each
  // in full, turns one on or off, exports it and deletes the person's own. An imported .md is untrusted text: it is read and checked
  // here, shown in full, and kept only when the person turns it on. A skill never grants an app anything (permissions come only from an
  // app's own sheet), and every prompt frames it as know-how, never as a request.
  const FOR_WORDS = { make: 'making apps', change: 'changing apps', chat: 'chat', game: 'games', app: 'apps that work for you' };   // 3.9 Wallet Watch: + app
  const forLine = (k) => 'For ' + k.for.map((f) => FOR_WORDS[f] || f).join(', ');
  const skillFrom = (k) => (k.from === 'p0pc0rn' ? 'Comes with p0pc0rn' : k.from === 'import' ? 'Yours'
    : 'Comes with ' + (((A.skels.get(String(k.from).slice(7)) || {}).manifest || {}).name || 'an app'));   // 3.9 polish: plain words
  const skillLine = (k) => forLine(k) + ' · ' + skillFrom(k) + (k.enabled ? '' : ' · Off');
  async function loadSkills() {
    A.skills = createSkills({ db: A.db, fetchText: async (u) => { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); },
      skelName: (id) => (A.skels.has(id) && !A.bundled.has(id) ? A.skels.get(id).manifest.name : null) });
    try { const n = await A.skills.loadSkills(); if (n.bad || n.error) api.diag('apps: some skills could not be read', { bad: n.bad, index: !!n.error }); }
    catch (e) { api.diag('apps: skills failed to load', { message: String((e && e.message) || e).slice(0, 120) }); }
    const inp = $('apps-skill-import');
    if (inp) inp.onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importSkillFile(f).catch((x) => api.toast('Couldn’t read that file: ' + String((x && x.message) || x).slice(0, 80))); };
    renderSkills();
  }
  function renderSkills() {
    const box = $('apps-skills'); if (!box) return;
    box.replaceChildren();
    for (const k of A.skills ? A.skills.list() : []) {
      const row = mk('div', 'li app-row skill-row'); row.dataset.skill = k.name;
      const t = mk('span', 'app-txt'); t.append(mk('span', 'sw-name' + (k.enabled ? '' : ' dim'), k.name), mk('span', 'footnote dim', k.description), mk('span', 'footnote dim', skillLine(k)));
      const end = mk('span', 'li-end col');
      end.append(btn('View', 'btn sm', () => skillSheet(k.name)), btn(k.enabled ? 'Turn off' : 'Turn on', 'mini', () => toggleSkill(k.name)));
      row.append(t, end); box.append(row);
    }
    if (!box.children.length) { const r = mk('div', 'li'); r.append(mk('span', 'footnote dim', 'No skills on this phone yet.')); box.append(r); }
  }
  async function toggleSkill(name) {
    const k = A.skills && A.skills.getSkill(name); if (!k) return;
    await A.skills.setEnabled(name, !k.enabled); renderSkills();
    api.toast(k.enabled ? `${k.name} is on: Juli uses it when it fits` : `${k.name} is off`);
  }
  function skillSheet(name) {
    const k = A.skills && A.skills.getSkill(name); if (!k) return;
    const { sheet, close } = api.sheet('skill-view', k.name);
    sheet.classList.add('skill-sheet');
    sheet.append(mk('p', 'footnote dim', k.description), mk('p', 'footnote dim', skillLine(k)), mk('pre', 'doc-text', k.md));
    const on = btn(k.enabled ? 'Turn off' : 'Turn on', 'btn', async () => { close(); await toggleSkill(name); }); on.id = 'skill-toggle';
    const ex = btn('Export', 'btn', () => exportSkill(k)); ex.id = 'skill-export';
    sheet.append(on, ex);
    if (k.from === 'import') {
      const d = btn('Delete', 'btn', () => { close(); api.confirm(`Delete “${k.name}”?`, 'Juli stops using it. You can import the file again.', 'Delete', async () => { await A.skills.removeSkill(name); renderSkills(); api.toast('Deleted'); }); });
      d.id = 'skill-delete'; sheet.append(d);
    }
    const x = btn('Close', 'btn ghost', () => close()); x.id = 'skill-close'; sheet.append(x);
  }
  function exportSkill(k) {   // the .md as it is kept (p0pc0rn's own: as it comes): the share sheet (Save to Files), else a download
    const f = new File([k.md], k.name + '.md', { type: 'text/plain' });
    share(f, () => saveFile(f));   // inside the tap (the share sheet needs it)
  }
  async function importSkillFile(file) {
    if (!file || !A.skills) return;
    if (file.size > SKILL.fileBytes) return api.toast('That file is too big for a skill');
    const c = A.skills.checkImport(await file.text());
    if (c.problems.length) return errorSheet('This skill can’t be used', c.problems.slice(0, 12));
    const k = c.skill, { sheet, close } = api.sheet('skill-add', c.replaces ? `Replace your skill “${k.name}”?` : 'Add this skill?');
    sheet.classList.add('skill-sheet');
    sheet.append(mk('p', 'footnote dim', 'Read all of it before you turn it on. Juli follows a skill as know-how when it fits what you ask. It never changes p0pc0rn’s rules and gives no app any permission.'),
      mk('p', 'callout', k.name), mk('p', 'footnote dim', k.description), mk('p', 'footnote dim', forLine(k)), mk('pre', 'doc-text', k.md));
    const ok = btn('Turn on', 'btn cta', async () => {
      close();
      try { await A.skills.importSkill(k.md); } catch (e) { return errorSheet('This skill can’t be used', (e && e.problems) || [String((e && e.message) || e).slice(0, 160)]); }
      renderSkills(); api.toast(`${k.name} is on: Juli uses it when it fits`);
    });
    ok.id = 'skill-add-on';
    const no = btn('Don’t add', 'btn', () => close()); no.id = 'skill-add-no';
    sheet.append(ok, no);
  }
  /** an imported skeleton leaves the shelf (the person's tap, confirmed): its grant and its skills go with it; apps made from it stay
   *  in My apps (they open again once it is imported again) */
  async function removeSkel(id) {
    if (A.bundled.has(id) || !A.skels.has(id)) return;
    if (A.open && A.open.app.skel === id) closeApp();
    await A.db.del('skels', id); await A.db.del('grants', id); A.skels.delete(id); A.grants.delete(id);
    if (A.skills) await A.skills.removeBundle(id);
    render(); renderSkills(); api.toast('Removed');
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
      const notes = [];
      if (r.gaps && r.gaps.length) notes.push(`It can’t do: ${r.gaps.join('; ')}.`);
      if (r.defaulted && r.defaulted.length) notes.push(`Left as they come: ${r.defaulted.join(', ')}.`);
      confirmMake(skel, r.slots, name, notes);   // 3.9 polish: Juli shows what she'll make first (nothing is added yet), then Make
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
  /** 3.9 polish (A1): making an app feels like installing one. First "Here’s what I’ll make: …" (the design's icon, Juli's one line, what
   *  it does in plain words) and nothing is added; Make puts it in My apps, and its card offers Add to Home Screen (madeCard: the
   *  person's one tap, then the ring on the home screen). -> a Promise of the new app, or null (Not this) */
  function confirmMake(skel, slots, name, notes = []) {
    return new Promise((res) => {
      const yes = async () => {
        const app = await addApp(skel, slots, name, 'juli');
        madeCard(app, `Made “${app.name}”: it’s in My apps.`);
        const i = $('apps-in'); if (i) i.value = '';
        res(app);
      };
      const box = $('apps-status'); if (!box) return yes();
      box.hidden = false; box.className = 'apps-status footnote sf-preview';
      const card = mk('div', 'sf-pv');
      try { const I = UI(); if (I && I.iconEl) card.append(I.iconEl(skel.manifest, 'sf-pv-ico')); } catch (e) { /* no icon */ }
      const txt = mk('div', 'sf-pv-txt');
      txt.append(mk('p', 'sf-pv-kicker', 'Here’s what I’ll make'), mk('p', 'headline sf-pv-line', previewLine(skel.manifest, slots, name)), mk('p', 'footnote dim', plainOf(skel.manifest)));
      for (const n of notes) txt.append(mk('p', 'footnote dim', n));
      card.append(txt);
      const go = btn('Make', 'btn sm cta', () => { box.replaceChildren(); yes(); }); go.id = 'apps-preview-make';
      const no = btn('Not this', 'btn sm ghost', () => { setStatus('Nothing was made. Change the words, then tap Make it again.', ''); const i = $('apps-in'); if (i) i.focus(); res(null); }); no.id = 'apps-preview-not';
      const row = mk('div', 'sf-pv-row'); row.append(go, no);
      box.replaceChildren(card, row);
    });
  }
  /** the queue runner for 'makeapp' (app.js registers it with Juli's model). 3.8 (v040): modelId may be a function of the job (the
   *  Bigger brain makes apps when it can: app.js brainFor); a model with a small context (ctxOf(id) tokens: the Bigger brain's 2,048)
   *  makes the app only when the longest fill prompt of the job's skeletons can fit with its answer (the low estimate, before any model
   *  loads), else `small` (Juli's own model) does; an answer that would get less room than it needs is TOO_LONG on the model, and the
   *  queue gives the job to `small` then, as when the Bigger brain cannot load or runs out of memory (fallback) */
  const FILL_MIN = 600;   // tokens a fill's JSON answer needs
  const SMALL_CTX = 4096;   // H39: Juli's own model's context (engine/llm/llm_engine.js): the room a skill may take there
  function runner(modelId, { ctxOf = () => 0, small = null } = {}) {
    const fits = (id, j) => {
      const cap = ctxOf(id), P = (j && j.params) || {}; if (!cap) return true;
      return (P.skels || []).map((k) => A.skels.get(k)).filter(Boolean).every((s) => estTokens(fillMessages(s, P.text || '')) / EST_LOW + FILL_MIN <= cap);
    };
    const pick = (j) => { const id = typeof modelId === 'function' ? modelId(j) : modelId; return small && id !== small && !fits(id, j) ? small : id; };
    const fallback = small ? (j, m, e) => { if (!m || m === small) return null; api.diag('apps: the Bigger brain could not make this app, Juli does', { code: (e && e.code) || null }); return small; } : null;
    return { model: pick, fallback, needsConsent: false, async run(ctx) {
      const P = ctx.params, skels = (P.skels || []).map((id) => A.skels.get(id)).filter(Boolean);
      if (!skels.length) throw Object.assign(new Error('the app designs are not loaded yet'), { code: 'NOT_READY' });   // 3.9 polish: plain words
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
      const stages = { route: 'Choosing the kind of app…', fill: 'Filling in the app…', retry: 'Trying again…', repair: 'Fixing a few details…', critic: 'Checking the result…' };
      // H39: make-an-app's know-how (and the person's own 'for: make' skill that fits) rides along where the prompt has room for it
      // with its whole answer (the Bigger brain: rarely; Juli's own model: always); it never changes which model makes the app
      const skill = aboutWith(A.skills ? makeSkillFor(A.skills.skillsFor('make'), P.text || '', { count: (m) => promptTokens(ctx.engine, m), cap: cap || SMALL_CTX }) : null,
        typeof api.about === 'function' ? String((await api.about(ABOUT.lane)) || '') : '', { count: (m) => promptTokens(ctx.engine, m), cap: cap || SMALL_CTX });   // 3.9: + About me in the fill, where it fits
      return makeApp(llm, skels, P.text, { only: P.only, signal: ctx.signal, skill, onStage: (s) => { setStatus('Juli: ' + (stages[s] || s)); try { ctx.progress({ stage: s }); } catch (e) { /* */ } } });
    } };
  }
  function askRunner(modelId) {
    return { model: () => modelId, needsConsent: false, async run(ctx) {
      const q = askMessages(ctx.params.app, ctx.params.prompt, !!ctx.params.json, ctx.params.skill || '');   // 3.9 Wallet Watch: + the app's skill
      const r = await ctx.engine.chat(q.messages, Object.assign({}, q.opts, { signal: ctx.signal }));
      return { text: String((r && r.reply && r.reply.content) || (r && r.text) || '').slice(0, 1200) };
    } };
  }

  /** the queue runner for 'appchoose' (app.js registers it with the game's mover): the numbered options and the first answer that names
   *  one; one retry with a different, shorter prompt (no skill, no board text); no answer naming a choice = by 'fallback' with why (the
   *  game asks again or says so; it never moves for her). 3.9 polish: model = an id or a function of the job (Juli's own model; the
   *  Bigger brain when the game asked for it, big); o.isBig(id) = that model is the Bigger brain; o.big() = it is downloaded and on
   *  (juli.models); o.tool(id) = that model answers as a tool call (choose_move; app.js asks both for the number); o.fallback = the
   *  queue's other model when it can't load. A move asked of the Bigger brain is never answered by Juli's own model. The game hold
   *  keeps whichever model answered */
  function chooseRunner(model, o) {
    o = o || {}; const pick = typeof model === 'function' ? model : () => model;
    A.chooseModel = pick(null); A.chooseBig = typeof o.big === 'function' ? o.big : null;
    return { model: (j) => pick(j), needsConsent: false, fallback: o.fallback, async run(ctx) {
      const P = ctx.params || {}, options = Array.isArray(P.options) ? P.options : [], said = [];
      const id = (ctx.engine && ctx.engine.id) || pick(ctx.job), tool = !!(o.tool && o.tool(id)), isBig = !!(o.isBig && o.isBig(id));
      if (P.big && !isBig) return { index: 0, by: 'fallback', why: 'the Bigger brain is not on', said, model: id };   // asked of the Bigger brain: never her own model instead
      A.chooseModel = id;   // the game hold keeps this model
      let index = null;
      for (const short of [false, true]) {
        const q = chooseMessages({ app: P.app, about: P.about, options, hint: P.hint, skill: P.skill }, { short, tool });
        const r = await ctx.engine.chat(q.messages, Object.assign({}, q.opts, { signal: ctx.signal }));
        const t = String((r && r.text) || (r && r.reply && r.reply.content) || ''); said.push(t.slice(0, 60));
        index = tool ? toolChoice(r, options) : parseChoice(t, options); if (index != null) break;
      }
      A.lastChoose = { appId: P.appId, at: Date.now(), model: id };   // the game hold: her model stays for the next move
      return index == null ? { index: 0, by: 'fallback', why: 'her answer named no choice', said, model: id, big: isBig } : { index, by: 'juli', said, model: id, big: isBig };
    } };
  }
  /** 3.9: how long the queue keeps a model after a job (app.js takes the larger of this and Juli's own 5 s): THE GAME HOLD, a minute after
   *  a move of the game that is open; 0 otherwise */
  function holdFor(id) {
    const c = A.lastChoose;
    return id && id === A.chooseModel && A.open && c && c.appId === A.open.app.id && Date.now() - c.at < GAME_HOLD ? GAME_HOLD : 0;
  }
  /** 3.9: the shelf's Games group (#apps-games, made here just before the agentic apps) -> its list, or null */
  function gamesBox() {
    let box = $('apps-games'); if (box) return box;
    const ag = $('apps-agentic'); if (!ag || !ag.parentNode) return null;
    let at = ag;
    while (at.previousElementSibling && !(at.previousElementSibling.classList && at.previousElementSibling.classList.contains('label'))) at = at.previousElementSibling;
    at = at.previousElementSibling || ag;   // the "Agentic apps" heading
    const head = mk('p', 'label', 'Games'); head.id = 'apps-games-label';
    const sub = mk('p', 'footnote dim pad', 'Play against Juli: she picks her moves on this phone while the game is open.');
    box = mk('div', 'list'); box.id = 'apps-games';
    for (const el of [head, sub, box]) at.parentNode.insertBefore(el, at);
    return box;
  }

  // ---- changing an app by chat (makeapp/edit.js). An app record keeps its workspace: slots, custom (the added part: at most 4 KB of
  // code that runs after the skeleton's own, through the Kit's hooks K.on('start' | 'draw' | 'tap')), history (the app as it was before
  // each of its last 10 changes: Undo, Versions) and edits (how many changes). A change is ONE queue job 'appedit' {appId, text} in up to
  // three phases, each with one model in memory: the planner (the Bigger brain when it can run, else Juli; skipped for a one-slot change),
  // the worker (Juli: one tool call at a time; after every change the app runs in an unseen frame, no model) and the reviewer. Between
  // phases the job waits on nothing and goes straight back to the queue, so the next phase's model loads the queue's own way (the hold,
  // the settle, a fresh page on WebKit): at most 2 swaps (planner -> worker -> reviewer); with Juli alone, one model and no swap. Nothing
  // is kept until the last phase: then the version before goes to history and the app changes. The open app closes while models run.
  const TEST = { w: 390, h: 844, frames: 1300, boot: 15000 };   // a test run: a phone-sized unseen frame, ~1.3 s of frames once it starts
  const firstPhase = (app, skel, text) => (oneSlot(String(text || ''), { spec: skel.manifest.slots, slots: app.slots || {} }) ? 'work' : 'plan');
  /** the queue runner for 'appedit' (app.js registers it): big() = the planner's and reviewer's model (the Bigger brain when usable,
   *  else Juli's), small = Juli's (the worker; every look). ctxOf(id) = a model's context when it is small (the Bigger brain's 2,048). */
  function editRunner({ big, small, ctxOf = () => 0 }) {
    const bigOf = () => (typeof big === 'function' ? big() : big) || small;
    const model = (j) => {
      const st = j && j.state;
      if (st && st.v === 1) return st.phase === 'work' ? small : bigOf();
      const P = (j && j.params) || {}, app = A.apps.find((a) => a.id === P.appId), skel = app && A.skels.get(app.skel);
      return !skel || firstPhase(app, skel, P.text) === 'work' ? small : bigOf();
    };
    const fallback = (j, m, e) => { if (!m || m === small) return null; api.diag('apps: the Bigger brain could not do this change, Juli does', { code: (e && e.code) || null }); return small; };
    return { model, fallback, needsConsent: false, async run(ctx) {
      const P = ctx.params || {}, job = ctx.job, app = A.apps.find((a) => a.id === P.appId), skel = app && A.skels.get(app.skel);
      if (!app || !skel) return { ok: false, appId: P.appId, message: 'That app is no longer on this phone.' };
      let st = ctx.state && ctx.state.v === 1 ? ctx.state : null;
      if (!st) { const ws = workspace(skel, app, await storeOf(app.id)); st = { v: 1, phase: firstPhase(app, skel, P.text), ws0: ws, ws: null, steps: null, planned: false, calls: 0, models: [] }; }
      const here = ctx.engine && ctx.engine.id, cap = ctxOf(here);
      const want = () => { const m = st.phase === 'work' ? small : bigOf(); return job.fellBack && job.fellBack.from === m ? job.fellBack.to : m; };
      if (st.models[st.models.length - 1] !== here) st.models.push(here);
      const llm = async (messages, o = {}) => {
        const opts = { maxTokens: o.maxTokens || 160, prefix: o.prefix, signal: ctx.signal };
        if (cap && (await promptTokens(ctx.engine, messages, { prefix: o.prefix })) + opts.maxTokens + 8 > cap)
          throw Object.assign(new Error('the change is too long for the Bigger brain'), { code: 'TOO_LONG' });   // the queue gives the job to Juli
        const r = await ctx.engine.chat(messages, opts);
        return String((r && r.text) || (r && r.reply && r.reply.content) || '');
      };
      const fns = { plan: llm, step: llm, review: llm, run: (ws) => testRun(app, skel, ws), look: (ws, q) => editLook(ctx, app, skel, ws, q) };
      const show = (stage, extra) => { try { ctx.progress(Object.assign({ stage, planned: st.planned, steps: (st.steps || []).map((s) => ({ do: s.do, what: s.what, status: s.status || 'todo' })) }, extra || {})); } catch (e) { /* */ } };
      while (st.phase !== 'done') {
        if (want() !== here) { await ctx.setState(st); return { wait: 'all' }; }   // the next phase's model: straight back to the queue (no children)
        if (st.phase === 'plan') {
          show('plan');
          const p = await planPhase(fns, st.ws0, P.text, { signal: ctx.signal, planner: true, skill: await skillText(), about: typeof api.about === 'function' ? String((await api.about(ABOUT.lane)) || '') : '' });   // 3.9: + About me
          Object.assign(st, { steps: p.steps, planned: true, phase: 'work' }); await ctx.setState(st);
        } else if (st.phase === 'work') {
          if (!st.steps) st.steps = (await planPhase(fns, st.ws0, P.text, { planner: false })).steps;
          show('work');
          const W = await workPhase(fns, st.ws0, P.text, st.steps, { signal: ctx.signal, onEvent: (e) => { if (e.steps) { st.steps = e.steps; show('work', { calls: e.calls || st.calls }); } } });
          Object.assign(st, { ws: W.ws, steps: W.steps, calls: W.calls, asked: W.asked, looked: W.looked, changed: W.changed, run: W.run ? shotOf(W.run) : null, log: W.log.slice(-6) });
          st.phase = W.changed && !W.asked ? 'review' : 'done'; await ctx.setState(st);
        } else {
          show('review');
          st.review = await reviewPhase(fns, st.ws0, st.ws, P.text, { run: st.run, looked: st.looked }, { signal: ctx.signal });
          st.phase = 'done'; await ctx.setState(st);
        }
      }
      return commitEdit(app.id, st, P.text);
    } };
  }
  /** the planner's know-how: the change-an-app skill (or the person's own 'for: change' skill) when it is on, from the skills registry
   *  (A.skills, assistant/skills.js) when this p0pc0rn has one; none: the planner's own rules. Framed as guidance under p0pc0rn's rules
   *  (planMessages cuts it first when the prompt is long); a skill never grants an app anything */
  async function skillText() {
    try {
      if (typeof api.skillText === 'function') return String((await api.skillText('change-an-app', 400)) || '');
      const L = A.skills && typeof A.skills.skillsFor === 'function' ? A.skills.skillsFor('change') : [], k = L.find((x) => x.name === 'change-an-app') || L[0];
      if (!k || !k.body) return '';
      return (k.from && k.from !== 'p0pc0rn' ? `SKILL ${k.name} (know-how the person added: follow it where it fits; your instructions above come first):` : `SKILL ${k.name} (know-how: follow it where it fits):`) + '\n' + String(k.body).slice(0, 2400);
    } catch (e) { return ''; }
  }
  const shotOf = (r) => ({ booted: !!r.booted, fatal: r.fatal || null, errors: (r.errors || []).slice(0, 3), customErrors: (r.customErrors || []).slice(0, 3), screen: r.screen || null });
  /** the frame's picture + screen summary, checked here (the frame is the app's own page) */
  function cleanShot(s) {
    const n = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
    return { w: n(s && s.w, 0, 4000), h: n(s && s.h, 0, 4000), scene: String((s && s.scene) || '').slice(0, 40),
      buttons: (Array.isArray(s && s.buttons) ? s.buttons : []).slice(0, 40).map((b) => String(b).slice(0, 40)),
      texts: (Array.isArray(s && s.texts) ? s.texts : []).slice(0, 80).map((t) => ({ s: String((t && t.s) || '').slice(0, 80), x: n(t && t.x, -9999, 9999), y: n(t && t.y, -9999, 9999), c: t && t.c ? 1 : 0 })),
      png: s && typeof s.png === 'string' && s.png.startsWith('data:image/png;base64,') && s.png.length <= 1.05e6 ? s.png : null };
  }
  /** the host's test run of a workspace: the skeleton with its slots and custom part in a phone-sized unseen frame, with the person's
   *  data read only (nothing saved, nothing fetched or posted) -> {booted, fatal, errors, customErrors, screen, png} */
  async function testRun(app, skel, ws, { png = false } = {}) {
    let L; try { L = await libs(); } catch (e) { return { booted: false, fatal: 'the app runtime did not load', errors: [], customErrors: [] }; }
    const store = await storeOf(app.id);
    const box = $('app-edittest') || document.body.appendChild(Object.assign(mk('div', 'app-edittest'), { id: 'app-edittest' }));
    Object.assign(box.style, { position: 'fixed', left: '0', top: '0', width: TEST.w + 'px', height: TEST.h + 'px', opacity: '0', pointerEvents: 'none', zIndex: '-1', overflow: 'hidden' });
    const errors = [], customErrors = []; let breach = null;
    const fr = startFrame({ parent: box, frameUrl: api.frameUrl || 'makeapp/frame.html', libs: L, bundle: skel, slots: ws.slots, custom: ws.custom, store, mode: 'run', name: ws.name,
      onSave: () => {}, onCall: async (fn) => { if (fn === 'app.badge') return true; throw Object.assign(new Error('not in a test run'), { code: 'TEST_RUN' }); },
      onError: (m, fatal) => { if (errors.length < 5) errors.push(String(m).slice(0, 200)); }, onCustomError: (m, line) => { if (customErrors.length < 5) customErrors.push(String(m).slice(0, 200) + (line ? ` (line ${line})` : '')); },
      onBreach: (m) => { breach = m || 'breach'; } });
    const out = { booted: false, fatal: null, errors, customErrors, screen: null, png: null };
    try { await Promise.race([fr.booted, new Promise((r, j) => setTimeout(() => j(new Error('it did not start in 15 s')), TEST.boot))]); out.booted = true; }
    catch (e) { out.fatal = String((e && e.message) || e).slice(0, 200); }
    if (out.booted && !breach) {
      await new Promise((r) => setTimeout(r, TEST.frames));
      try { const s = cleanShot(await fr.snap({ png })); out.png = s.png; delete s.png; out.screen = s; } catch (e) { /* no summary: the errors still count */ }
    }
    if (breach) { out.booted = false; out.fatal = 'stopped: it tried to reach outside its sandbox'; }
    fr.close();
    return out;
  }
  function pngBlob(url) { const b = atob(url.slice(url.indexOf(',') + 1)), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Blob([u], { type: 'image/png' }); }
  /** look: a picture of the test run's screen, and Juli's own model answers the question about it (the Bigger brain reads no pictures) */
  async function editLook(ctx, app, skel, ws, question) {
    const r = await testRun(app, skel, ws, { png: true });
    if (!r.png) return 'Juli could not see the screen (' + (r.fatal || 'no picture') + ').';
    let bmp = null; try { bmp = await createImageBitmap(pngBlob(r.png)); } catch (e) { return 'Juli could not see the screen.'; }
    const q = lookMessages(question, bmp);
    try { const out = await ctx.engine.chat(q.messages, Object.assign({}, q.opts, { signal: ctx.signal })); return String((out && out.text) || (out && out.reply && out.reply.content) || ''); }
    finally { try { bmp.close(); } catch (e) { /* */ } }
  }
  /** the last phase: the app changes, and the version before goes to its history (nothing changed: nothing kept) -> the job's result */
  async function commitEdit(appId, st, text) {
    const app = A.apps.find((a) => a.id === appId);
    const res = finish(st.ws0, { ws: st.ws || st.ws0, steps: st.steps || [], calls: st.calls || 0, asked: st.asked, looked: st.looked || [], changed: !!st.changed, run: st.run }, { planned: st.planned }, st.review);
    const out = { ok: res.ok, appId, changes: res.changes, summary: res.summary, steps: res.steps, review: res.review, asked: res.asked, planned: res.planned, calls: res.calls, models: st.models, runText: res.runText };
    if (!app) return Object.assign(out, { ok: false, message: 'That app was deleted while Juli worked on it.' });
    if (!res.ok) return out;
    const prev = { at: Date.now(), slots: app.slots, custom: app.custom || '', name: app.name, note: String(text || '').slice(0, 80) };
    const t0 = (app.slots || {}).title || (app.slots || {}).app_name, t1 = res.ws.slots.title || res.ws.slots.app_name;
    if (t1 && t1 !== t0 && (!t0 || app.name === String(t0).slice(0, 30))) app.name = String(t1).slice(0, 30);   // the app's name follows its title
    app.slots = res.ws.slots; app.custom = res.ws.custom || '';
    app.history = [prev].concat(app.history || []).slice(0, EDIT.history); app.edits = (app.edits || 0) + 1;
    await A.db.put('apps', app); render();
    api.diag('apps: changed', { skel: app.skel, steps: res.steps.length, calls: res.calls, planned: res.planned, review: res.review ? res.review.match : null, models: st.models.length });
    return out;
  }
  async function undoEdit(app) {
    const h = (app.history || [])[0];
    if (!h) return api.toast('Nothing to undo');
    if (A.editing && A.editing.appId === app.id) return api.toast('Wait until Juli finishes this change');
    if (A.open && A.open.app.id === app.id) closeApp();
    app.slots = h.slots; app.custom = h.custom || ''; if (h.name) app.name = h.name;
    app.history = app.history.slice(1); await A.db.put('apps', app); render();
    api.toast(`Undone: “${app.name}” is as it was before`); api.diag('apps: undo', { skel: app.skel });
  }
  async function restoreVersion(app, i) {
    const h = (app.history || [])[i];
    if (!h || (A.editing && A.editing.appId === app.id)) return;
    if (A.open && A.open.app.id === app.id) closeApp();
    const cur = { at: Date.now(), slots: app.slots, custom: app.custom || '', name: app.name, note: 'going back to an earlier version' };
    app.history = [cur].concat(app.history.filter((x, k) => k !== i)).slice(0, EDIT.history);
    app.slots = h.slots; app.custom = h.custom || ''; if (h.name) app.name = h.name;
    await A.db.put('apps', app); render(); api.toast(`Back to the version from ${ago(h.at)}`);
  }
  /** a change by chat, from the sheet (or a test): queue the job, show its plan as a checklist while it runs, then what changed */
  async function change(app, text) {
    text = String(text || '').trim();
    if (text.length < 4) return api.toast('Say what should change');
    if (!api.installed('brain')) return editDone(app.id, { ok: false, message: 'Download Juli first (Settings › Models), then Juli can change apps.' });
    if (!api.consented()) { setStatus('Agree to the p0pc0rn terms first (the short lesson), then Juli can change apps.', 'warn', { label: 'Start the lesson', fn: api.openLesson }); return null; }
    if (A.editing || A.making || api.Q().list({ includeTerminal: false }).some((j) => j.kind === 'appedit')) return api.toast('Juli is already working on an app');   // (also after a reload)
    if (!A.skels.get(app.skel)) return api.toast('This app’s design is no longer on this phone');
    A.editing = { appId: app.id, jobId: null, view: { stage: 'queued', steps: [] } }; paintEdit(A.editing.view);
    try {
      const j = await api.Q().add('appedit', { appId: app.id, text: text.slice(0, 400) }, { title: text.slice(0, 60) });
      A.editing.jobId = j.id;
      const r = await waitJob(j.id);
      A.editing = null; editDone(app.id, r); return r;
    } catch (e) {
      A.editing = null;
      const code = e && e.code;
      editDone(app.id, { ok: false, message: code === 'NO_CONSENT' ? 'Agree to the p0pc0rn terms first (the short lesson).' : code === 'CANCELLED' ? 'Stopped: nothing was changed.' : 'Juli couldn’t change the app: ' + String((e && e.message) || e).slice(0, 160) });
      return null;
    }
  }
  const MARK = { todo: '○', doing: '…', done: '✓', failed: '✗', skipped: '–', asked: '?' };
  const STAGE = { queued: 'Waiting its turn in the queue…', plan: 'Juli is planning the change…', work: 'Juli is changing the app…', review: 'Checking the result…' };
  const planList = (steps) => { const ul = mk('ul', 'perm-list app-plan'); for (const s of steps || []) { const li = mk('li', 'footnote'); li.dataset.status = s.status || 'todo'; li.append(mk('span', 'callout', `${MARK[s.status] || MARK.todo} ${s.what}`)); ul.append(li); } return ul; };
  /** while a change runs: the stage, and the plan as a checklist (the sheet, when it is open) */
  function paintEdit(v) {
    v = v || {}; const line = STAGE[v.stage] || 'Juli is working on the app…';
    setStatus(line);
    const ui = A.changeUI;
    if (!ui || !ui.box.isConnected || !A.editing || ui.app.id !== A.editing.appId) return;
    ui.box.hidden = false; ui.go.disabled = true;
    const stop = btn('Stop', 'btn sm', () => { if (A.editing && A.editing.jobId) api.Q().cancel(A.editing.jobId).catch(() => {}); }); stop.id = 'app-change-stop';
    ui.box.replaceChildren(mk('p', 'footnote', line), planList(v.steps), stop);
  }
  /** a change in plain words: the slot's path as words (tiles[1].goal -> "tiles 2 › goal"), an arrow; the values as they are */
  const plainChange = (t) => String(t).replace(/^[^:]+/, (p) => p.replace(/\[(\d+)\]/g, (m, i) => ' ' + (+i + 1)).replace(/\./g, ' › ').replace(/_/g, ' ')).replace(' -> ', ' → ');
  /** after a change: what changed in plain words, Juli's check, and Open / Undo */
  function editDone(appId, r) {
    r = r || {}; const app = A.apps.find((a) => a.id === appId), failed = (r.steps || []).some((s) => s.status === 'failed');
    let text, tone = 'good';
    if (r.asked) { text = `Juli asks: ${r.asked}`; tone = 'note'; }
    else if (!r.ok) { text = r.message || (failed ? 'Juli couldn’t make that change, so nothing was changed. Try saying it another way.' : 'Nothing needed changing.'); tone = 'warn'; }
    else {
      text = `Changed “${app ? app.name : 'the app'}”: ${(r.changes || []).map((c) => plainChange(c.text)).join('; ') || r.summary}.` + (failed ? ' One part could not be done.' : '');
      if (r.review && r.review.match === false) { text += ` Juli isn’t sure it does what you asked${r.review.note ? ': ' + r.review.note : ''}.`; tone = 'note'; }
    }
    setStatus(text, tone, app && r.ok ? { label: 'Open', fn: () => openApp(app) } : null);
    const ui = A.changeUI;
    if (!ui || !ui.box.isConnected || ui.app.id !== appId) return;
    ui.box.hidden = false; ui.go.disabled = false; if (r.ok) ui.ta.value = '';
    const parts = [mk('p', 'callout app-change-result', text), planList(r.steps)];
    if (app && r.ok) {
      const o = btn('Open', 'btn sm', () => { ui.close(); openApp(app); }); o.id = 'app-change-open';
      const u = btn('Undo', 'btn sm', async () => { await undoEdit(app); ui.close(); }); u.id = 'app-change-undo2';
      const ba = btn('See before and after', 'btn sm ghost', () => { ui.close(); const I = UI(); if (I && I.beforeAfter) I.beforeAfter(app); }); ba.id = 'app-change-ba';   // 3.9 polish
      parts.push(o, u, ba);
    }
    ui.box.replaceChildren(...parts);
  }
  /** My apps › Change: the sheet (a text box, Undo, Versions); a change in progress shows its checklist here */
  function changeSheet(app) {
    if (!A.skels.get(app.skel)) return api.toast('This app’s design is no longer on this phone');
    const { sheet, close } = api.sheet('app-change', `Change “${app.name}”`);
    sheet.classList.add('app-change');
    sheet.append(mk('p', 'footnote dim', 'Say what to change. Juli changes its settings, or adds a small part on top of the app (the app’s own code stays as it is). Undo puts it back.'));
    const ta = mk('textarea'); ta.id = 'app-change-in'; ta.rows = 2; ta.placeholder = 'Rename it, change its colour, add a line with the total…'; ta.setAttribute('aria-label', 'What should change');
    const go = btn('Change it', 'btn cta', () => change(app, ta.value)); go.id = 'app-change-go';
    const box = mk('div', 'app-change-run'); box.id = 'app-change-run'; box.hidden = true;
    sheet.append(ta, go, box);
    const hist = app.history || [];
    if (hist.length) {
      sheet.append(mk('p', 'footnote dim', `Last change ${ago(hist[0].at)}: “${hist[0].note || 'a change'}”`));
      const u = btn('Undo the last change', 'btn', async () => { await undoEdit(app); close(); }); u.id = 'app-change-undo';
      const v = btn(`Versions (${hist.length})`, 'btn ghost', () => versionsSheet(app)); v.id = 'app-change-versions';
      sheet.append(u, v);
    }
    A.changeUI = { app, sheet, box, go, ta, close };
    if (A.editing && A.editing.appId === app.id) paintEdit(A.editing.view);
  }
  const versionLine = (h) => { const t = (h.slots || {}).title || (h.slots || {}).app_name || h.name || '', n = h.custom ? h.custom.split('\n').length : 0; return (t ? `Title “${String(t).slice(0, 30)}”` : 'Its first version') + (n ? ` · added part: ${n} line${n === 1 ? '' : 's'}` : ' · no added part'); };
  function versionsSheet(app) {
    const { sheet, close } = api.sheet('app-versions', `Versions of “${app.name}”`);
    sheet.append(mk('p', 'footnote dim', 'The app as it was before each of its last changes, newest first. Going back keeps the one you have now here too.'));
    const ul = mk('ul', 'perm-list');
    (app.history || []).forEach((h, i) => {
      const li = mk('li'); li.append(mk('span', 'callout', `${ago(h.at)} · before “${h.note || 'a change'}”`), mk('span', 'footnote dim', versionLine(h)));
      const b = btn('Go back to this', 'btn sm', async () => { await restoreVersion(app, i); close(); }); b.dataset.version = String(i); li.append(b); ul.append(li);
    });
    sheet.append(ul);
  }
  /** a change's progress and its end, also when no sheet waits for it (the page reloaded between phases) */
  function wireEdits() {
    const Q = api.Q();
    Q.on('progress', (j) => { if (j.kind === 'appedit' && A.editing && A.editing.jobId === j.id) { A.editing.view = j.progress || {}; paintEdit(A.editing.view); } });
    for (const n of ['done', 'failed']) Q.on(n, (j) => {
      if (j.kind !== 'appedit' || (A.editing && A.editing.jobId === j.id)) return;
      render(); editDone((j.params || {}).appId, n === 'done' ? j.result : { ok: false, message: 'Juli couldn’t change the app: ' + String((j.error && j.error.message) || 'it stopped').slice(0, 160) });
      Q.remove(j.id).catch(() => {});
    });
  }

  // ---- rendering the tab
  function render() {
    const root = $('v-apps'); if (!root || !A.db) return;
    const mine = $('apps-mine'), ag = $('apps-agentic'), na = $('apps-tools');
    mine.replaceChildren(); ag.replaceChildren(); na.replaceChildren();
    const gm = gamesBox(); if (gm) gm.replaceChildren();   // 3.9: the Games group
    $('apps-mine-none').hidden = A.apps.length > 0;
    for (const a of A.apps) {
      const skel = A.skels.get(a.skel), checks = !!skel && watches(skel);
      const row = mk('div', 'li app-row'); row.dataset.mine = a.id;   // 3.9 polish: ui/storefront.js draws its card (its icon, what needs you, its sentence)
      const t = mk('span', 'app-txt'); t.append(mk('span', 'sw-name', a.name),
        mk('span', 'footnote dim', !skel ? 'Its design is gone' : checks ? agenticLine(a, skel) : skel.manifest.name));
      const end = mk('span', 'li-end');
      const o = btn('Open', 'btn sm', () => openApp(a)); o.dataset.app = a.id; o.disabled = !skel;
      const d = btn('Delete', 'mini', () => api.confirm(`Delete “${a.name}”?`, 'Its data on this phone goes too.', 'Delete', () => removeApp(a)));
      const ch = btn('Change', 'mini', () => changeSheet(a)); ch.dataset.change = a.id; ch.disabled = !skel;   // H39: change it by chat
      end.append(o, ch, d); row.append(t, end); mine.append(row);
      if (api.homeButton && skel) { const hb = api.homeButton(a, () => openApp(a)); if (hb) end.insertBefore(hb, d); }   // 3.9 shell: "Add to Home" (ui/shell.js)
    }
    for (const s of A.skels.values()) {
      const m = s.manifest, row = mk('div', 'li app-row skel-row'); row.dataset.skel = m.id;
      const t = mk('span', 'app-txt'); t.append(mk('span', 'sw-name', m.name + (A.bundled.has(m.id) ? '' : ' · imported')), mk('span', 'footnote dim', plainOf(m)));   // 3.9 polish: what it does, when, what it sees
      const end = mk('span', 'li-end col');
      const get = btn(m.kind === 'game' ? 'Play' : yours(m.id) ? 'Open' : 'Get', 'btn sm', () => getOrOpen(s)); get.dataset.get = m.id;   // 3.9 polish: yours opens; no second copy by accident
      end.append(get, btn('Make my own', 'mini', () => { const I = UI(); if (I && I.pane) I.pane('apps'); const i = $('apps-in'); i.value = ''; i.placeholder = `Describe your ${m.name.toLowerCase()}…`; A.only = m.id; i.focus(); setStatus(`Juli will start from ${m.name}. Say what you want.`, ''); }));
      if (!A.bundled.has(m.id)) end.append(btn('Remove', 'mini', () => api.confirm(`Remove the “${m.name}” app design?`, 'Apps made from it stay in My apps but can’t open until you import it again. Skills that came with it go too.', 'Remove', () => removeSkel(m.id))));   // H39
      row.append(t, end); (m.kind === 'game' && gm ? gm : m.category === 'agentic' ? ag : na).append(row);
    }
  }
  function agenticLine(a, skel) {
    if (a.youPaused || pausedAll()) return a.youPaused ? 'Paused by you' : 'Paused: all apps are paused';   // 3.9 polish: the person's pauses first, in plain words
    { const c = capOf(skel, a.id); if (c) return c.line; }   // 3.9 Wallet Watch: "Paused until 5:00 PM to stay within Snowtrace’s free limit"
    if (!granted(skel)) return 'Not allowed yet: open it to allow';
    if (a.paused) return 'Stopped: ' + String(a.lastError || 'paused').replace(/^stopped: /, '').slice(0, 60);
    if (a.lastError) return 'The last check didn’t finish: ' + a.lastError.slice(0, 60);
    if (!a.lastCheck) return 'Works for you while p0pc0rn is open';
    // 3.9 Wallet Watch: an app that checks only when the phone is idle: never sooner than its floor; while the phone is busy it says so
    const next = idleOnly(skel) ? Math.max(a.nextCheck || 0, (a.lastCheck || 0) + floorOf(skel) * 60e3) : a.nextCheck;
    if (idleOnly(skel) && Date.now() >= next && busyNow()) return `Checked ${ago(a.lastCheck)} · waiting for your phone to be idle`;
    const mins = Math.max(0, Math.round((next - Date.now()) / 60e3));
    return `Checked ${ago(a.lastCheck)} · next in ${mins >= 60 ? Math.round(mins / 60) + ' h' : mins + ' min'}`;
  }
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };

  function wire() {
    $('apps-make').onclick = () => { const only = A.only || null; A.only = null; make($('apps-in').value, only); };
    $('apps-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('apps-make').click(); } });
    $('apps-import').onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importFile(f); };
  }
  wire();
  return { init, render, runner, askRunner, editRunner, chooseRunner, holdFor, choose: (app, o) => chooseJuli(app, A.skels.get(app.skel), o), change, undoEdit, restoreVersion, changeSheet, openApp, closeApp, make, tick, importFile, selfTest,
    // 3.9 polish (A1): what the Apps screen, an app's settings page and the activity log use (ui/storefront.js, ui/works.js)
    getOrOpen: (skelId) => { const s = A.skels.get(skelId); return s ? getOrOpen(s) : null; }, askRemove: (app) => api.confirm(`Delete “${app.name}”?`, 'Its data on this phone goes too.', 'Delete', () => removeApp(app)),
    pause: setPaused, pauseAll: setPauseAll, pausedAll, revoke, allow: (skelId, then) => { const s = A.skels.get(skelId); if (s) permSheet(s, then); }, granted: (skelId) => { const s = A.skels.get(skelId); return !!s && granted(s); },
    quota: quotaRows,   // 3.9 Wallet Watch: how often it checks and "Snowtrace requests today: N of 5,000" (ui/works.js, an app's settings page)
    statusOf: (a) => { const s = A.skels.get(a.skel); return !s ? 'Its design is gone' : watches(s) ? agenticLine(a, s) : s.manifest.name; }, ownLog, beforeAfter, hosts: HOSTS,
    confirmMake: (skelId, slots, name) => { const s = A.skels.get(skelId); return s ? confirmMake(s, slots || JSON.parse(JSON.stringify(s.slots_default || {})), String(name || s.manifest.name).slice(0, 30)) : Promise.resolve(null); },
    get state() { return A; } };
}
