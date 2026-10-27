// bench_features.js - p0pc0rn 3.9: the Full benchmark's feature checks (Settings › Benchmark › Full; ui/bench_core.js plans and sums
// them up). Each one proves one feature the way a person uses it, with test data only (named "Benchmark test ..."), and removes what it
// made: a test conversation, a test app, a pin; the person's own conversations, apps, home screen, wallpaper, About me, routines and
// playlists are never written (About me: an in-memory stand-in for the one check; Music: its own player with generated tones). A test
// app's permissions are granted in memory for its check, the way 3.8's Apps step tests every app (never the Allow button, never saved).
// Showing Juli's screen marks the open conversation read and showing Create clears its count: the checks that show them put the
// person's counts back. A check that runs a model job saves the job's id first (ctx.save), so a planned fresh page (how the app
// switches models on a phone) carries on with it; the job leaves the queue after. Every check is on its own: one that throws or times
// out is a fail with its reason, and the run goes on.
// 3.9 (Josh's phone, Oct-26): a check's saved state carries it over EVERY planned fresh page (bench.js keeps it on each new page; a
// change of an app can switch models twice); the home screen's keys go back byte for byte, also after the page ended in a check; the
// run's own jobs a stopped run left in the queue go (dropTestJobs), never the person's.
import { pass, fail, notRun, c4Positions, c4Judge, TEST_NAME, isTestName } from './bench_core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
async function until(fn, ms = 5000, step = 100) {
  const t0 = performance.now();
  for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (performance.now() - t0 > ms) return null; await sleep(step); }
}
const visible = (el) => { if (!el || el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const rect = (el) => el.getBoundingClientRect();

// ------------------------------------------------------------------------------------------------ test data (never the person's)
/** a raw IndexedDB delete that never creates a database that is not there (an upgrade means it did not exist: abort it) */
function idbDel(name, store, key) {
  return new Promise((res) => {
    let r; try { r = indexedDB.open(name); } catch (e) { res(false); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* */ } };
    r.onerror = () => res(false); r.onblocked = () => res(false);
    r.onsuccess = () => {
      const db = r.result;
      try { if (!db.objectStoreNames.contains(store)) { db.close(); res(false); return; } const t = db.transaction(store, 'readwrite'); t.objectStore(store).delete(key); t.oncomplete = () => { db.close(); res(true); }; t.onerror = () => { db.close(); res(false); }; }
      catch (e) { db.close(); res(false); }
    };
  });
}
/** every record of a store as {key: JSON} (for the before / after check), {} when the database or store is not there */
export function idbAll(name, store) {
  return new Promise((res) => {
    let r; try { r = indexedDB.open(name); } catch (e) { res({}); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* */ } };
    r.onerror = () => res({}); r.onblocked = () => res({});
    r.onsuccess = () => {
      const db = r.result;
      try {
        if (!db.objectStoreNames.contains(store)) { db.close(); res({}); return; }
        const t = db.transaction(store, 'readonly'), os = t.objectStore(store), out = {};
        const q = os.openCursor();
        q.onsuccess = () => { const c = q.result; if (!c) return; let v; try { v = c.value instanceof Blob ? `blob:${c.value.size}` : JSON.stringify(c.value, (k, x) => (x instanceof Blob ? `blob:${x.size}` : x)); } catch (e) { v = '?'; } out[String(c.key)] = v; c.continue(); };
        t.oncomplete = () => { db.close(); res(out); }; t.onerror = () => { db.close(); res({}); };
      } catch (e) { db.close(); res({}); }
    };
  });
}
/** one record of a store as stored (Blobs kept), null when it, its store or its database is not there */
function idbGet(name, store, key) {
  return new Promise((res) => {
    let r; try { r = indexedDB.open(name); } catch (e) { res(null); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* */ } };
    r.onerror = () => res(null); r.onblocked = () => res(null);
    r.onsuccess = () => {
      const db = r.result;
      try { if (!db.objectStoreNames.contains(store)) { db.close(); res(null); return; } const q = db.transaction(store, 'readonly').objectStore(store).get(key); q.onsuccess = () => { db.close(); res(q.result || null); }; q.onerror = () => { db.close(); res(null); }; }
      catch (e) { db.close(); res(null); }
    };
  });
}
/** a store's keys (sorted strings), [] when the database or store is not there */
function idbKeys(name, store) {
  return new Promise((res) => {
    let r; try { r = indexedDB.open(name); } catch (e) { res([]); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* */ } };
    r.onerror = () => res([]); r.onblocked = () => res([]);
    r.onsuccess = () => {
      const db = r.result;
      try { if (!db.objectStoreNames.contains(store)) { db.close(); res([]); return; } const q = db.transaction(store, 'readonly').objectStore(store).getAllKeys(); q.onsuccess = () => { db.close(); res(q.result.map(String).sort()); }; q.onerror = () => { db.close(); res([]); }; }
      catch (e) { db.close(); res([]); }
    };
  });
}
/** the Apps tab, once it has started (a run carried over a fresh page starts with the page) -> its host, or null after 20 s */
async function appsReady(ctx) {
  return until(() => { const APPS = ctx.api.apps && ctx.api.apps(), A = APPS && APPS.state; return A && A.db && A.skels && A.skels.size ? APPS : null; }, 20000, 200);
}
/** a test app on the Apps tab's own list (so a change, a pin or a game works as it does for the person's), removed by dropApp */
async function testApp(ctx, skelId, label) {
  const APPS = await appsReady(ctx), A = APPS && APPS.state;
  if (!A) throw new Error('the Apps tab has not started');
  const skel = A.skels.get(skelId); if (!skel) throw new Error(`the ${skelId} skeleton is not on this phone`);
  const app = { id: 'app-bench-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), skel: skelId, name: `${TEST_NAME} ${label}`.slice(0, 30),
    slots: JSON.parse(JSON.stringify(skel.slots_default || {})), from: 'bench', createdAt: Date.now(), nextCheck: 0, lastCheck: 0 };
  ctx.fx.add({ k: 'app', id: app.id });
  await A.db.put('apps', app); A.apps.push(app); APPS.render();
  return app;
}
/** the home screen's keys (ui/shell.js: the pinned apps and the icons' order), raw: what the person's phone has, byte for byte */
const HOME_KEYS = ['p0pc0rn:home:pins', 'p0pc0rn:home:order'];
const homeRaw = () => HOME_KEYS.map((k) => { try { return localStorage.getItem(k); } catch (e) { return null; } });
/** the keys back as they were (a key that was not there goes again) and the home screen drawn from them */
function homeBack(raw) {
  if (!Array.isArray(raw)) return;
  HOME_KEYS.forEach((k, i) => { try { if (raw[i] == null) localStorage.removeItem(k); else localStorage.setItem(k, raw[i]); } catch (e) { /* */ } });
  try { if (globalThis.SHELL) SHELL.refresh(); } catch (e) { /* */ }
}
/** is a made app on the home screen? (the shell's own list, as it keeps it on this phone) */
const pinnedNow = (id) => { try { return (JSON.parse(localStorage.getItem(HOME_KEYS[0]) || 'null') || []).some((p) => p && p.id === id); } catch (e) { return false; } };
export async function dropApp(api, id) {
  const APPS = api.apps(), A = APPS && APPS.state; if (!A) return;
  let was = false; try { if (A.open && A.open.app && A.open.app.id === id) { APPS.closeApp(); was = true; } } catch (e) { /* */ }
  // 3.9: its pin only when it has one (the shell writes its whole list at every unpin: "no pins" became "[]" on Josh's phone), and its
  // home icon either way (an unpin takes it with the pin)
  try { if (globalThis.SHELL && pinnedNow('app:' + id)) SHELL.unpin('app:' + id); else if (globalThis.P0APPICON && typeof P0APPICON.drop === 'function') await P0APPICON.drop(id); } catch (e) { /* */ }
  if (was) await sleep(600);   // what the app saved last lands first (the host writes an app's saves 400 ms after them)
  if (A.db) { await A.db.del('apps', id).catch(() => {}); await A.db.del('kv', id).catch(() => {}); }
  A.apps = (A.apps || []).filter((a) => a.id !== id); try { APPS.render(); } catch (e) { /* */ }
}
/** a test app's permissions for its check, in memory only (as the Apps step tests every app): never the Allow button, never saved
 *  -> undo(), which puts back what the person had */
async function grantFor(ctx, skel) {
  const A = ctx.api.apps().state, id = skel.manifest.id, had = A.grants.get(id), { permKey } = await import('../makeapp/host.js'), key = permKey(skel.manifest);
  if (!(A.bundled && A.bundled.has(id))) return () => {};   // 3.9 (review): only a design that comes with p0pc0rn; one the person imported they allow themselves
  if (!(had && had.key === key)) A.grants.set(id, { id, key, at: Date.now() });
  return () => { if (had === undefined) A.grants.delete(id); else A.grants.set(id, had); };
}
/** a test app opened the person's way (its own screen) -> {open, booted, why}; its permissions are in memory until the undos run */
async function openTest(ctx, app, undos) {
  const APPS = ctx.api.apps(), A = APPS.state, skel = A.skels.get(app.skel);
  if (!skel) return { open: null, why: 'its skeleton is not on this phone' };
  if (!(A.bundled && A.bundled.has(app.skel))) return { open: null, why: 'not a design that comes with p0pc0rn (the benchmark never allows one the person imported)' };   // 3.9 (review)
  undos.push(await grantFor(ctx, skel));
  await APPS.openApp(app);
  const open = await until(() => (A.open && A.open.app && A.open.app.id === app.id ? A.open : null), 30000);
  if (!open) return { open: null, why: 'Juli or a render was still using the memory' };
  const booted = await Promise.race([open.fr.booted.then(() => true, () => false), sleep(20000).then(() => false)]);
  return { open, booted, why: booted ? '' : 'it did not start' };
}
/** the Chats list's unread counts ({id: n}, from its own store) */
export async function unreadMap() {
  const out = {};
  for (const [k, v] of Object.entries(await idbAll('p0pc0rn-chats', 'threads'))) { if (k.startsWith('_')) continue; try { out[k] = Number(JSON.parse(v).unread) || 0; } catch (e) { /* */ } }
  return out;
}
/** showing Juli's screen marks the open conversation read: the person's counts from before go back (only ever up to what they were) */
async function keepUnread(api, before) {
  const now = await unreadMap(), back = Object.keys(before).filter((k) => k in now && now[k] < before[k]);
  for (const k of back) {
    await new Promise((res) => {
      let r; try { r = indexedDB.open('p0pc0rn-chats'); } catch (e) { res(); return; }
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* */ } };
      r.onerror = () => res(); r.onblocked = () => res();
      r.onsuccess = () => {
        const db = r.result;
        try {
          const t = db.transaction('threads', 'readwrite'), os = t.objectStore('threads'), g = os.get(k);
          g.onsuccess = () => { const m = g.result; if (m && (m.unread || 0) < before[k]) { m.unread = before[k]; os.put(m); } };
          t.oncomplete = () => { db.close(); res(); }; t.onerror = () => { db.close(); res(); };
        } catch (e) { db.close(); res(); }
      };
    });
  }
  if (back.length) await repaintUnread(api);
  return back.length;
}
/** showing Juli's screen with no open conversation makes one (an empty "New chat"): the empty ones the checks' showing made go, and the
 *  open conversation is the person's again */
async function convNow() { let cur = null; try { cur = localStorage.getItem('pf.app.chatSession'); } catch (e) { /* */ } return { ids: new Set(Object.keys(await idbAll('p0pc0rn-assistant', 'sessions'))), cur }; }
async function keepConversations(api, before) {
  for (const [id, v] of Object.entries(await idbAll('p0pc0rn-assistant', 'sessions'))) {
    if (before.ids.has(id)) continue;
    let s = null; try { s = JSON.parse(v); } catch (e) { continue; }
    if (s && !(s.messages || []).length) await dropSession(api, id);
  }
  try { if (before.cur == null) localStorage.removeItem('pf.app.chatSession'); else localStorage.setItem('pf.app.chatSession', before.cur); } catch (e) { /* */ }
}
/** showing Create or the Library clears Create's count of new results: the person's count goes back the shell's own way (note) */
const unseenNow = () => { try { return (JSON.parse(localStorage.getItem('p0pc0rn:shell:unseen') || 'null') || {}).create || 0; } catch (e) { return 0; } };
function keepUnseen(n) { const sh = SH(); if (!sh || typeof sh.note !== 'function') return; for (let i = unseenNow(); i < Math.min(n, 999); i++) sh.note('create'); }
/** a test conversation (Juli's own session store; the 3.9 Chats list indexes it), removed by dropSession */
async function testSession(ctx) {
  const AG = ctx.api.AG(); if (!AG) throw new Error('Juli is not ready');
  const s = await AG.newSession(); ctx.fx.add({ k: 'session', id: s.id });
  return s.id;
}
export async function dropSession(api, sid) {
  const CH = api.CH(), AG = api.AG(), Q = api.Q(), ended = (j) => ['done', 'failed', 'cancelled'].includes(j.status);
  if (Q) {   // its jobs: one still waiting (something Juli set out to make, a job blocked for the agreement) stops, then all leave the queue
    const live = Q.list().filter((j) => j.session === sid && !ended(j));
    for (const j of live) await Q.cancel(j.id).catch(() => {});
    if (live.length) await until(() => live.every((j) => { const x = Q.get(j.id); return !x || ended(x); }), 5000);
    for (const j of Q.list()) if (j.session === sid && j.root === j.id) await Q.remove(j.id).catch(() => {});
  }
  if (AG && AG.db) await AG.db.del('sessions', sid).catch(() => {});
  // the 3.9 Chats list removes its own line for a conversation that is gone when asked to open it (its own store, so its own state stays
  // right); the session is gone first, so the open conversation does not change
  try { if (CH && typeof CH.openThread === 'function') await CH.openThread(sid); } catch (e) { /* below */ }
  await idbDel('p0pc0rn-chats', 'threads', sid);
  await repaintUnread(api);
}
/** Juli's unread count from the Chats list's own store (what its next repaint will show), on her badge and the Chats button now */
export async function unreadNow() {
  const all = await idbAll('p0pc0rn-chats', 'threads');
  let n = 0; for (const [k, v] of Object.entries(all)) { if (k.startsWith('_')) continue; try { n += Number(JSON.parse(v).unread) || 0; } catch (e) { /* */ } }
  return n;
}
async function repaintUnread(api) {
  try {
    const n = await unreadNow(), b = document.getElementById('as-chats-n');
    if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); }
    if (globalThis.SHELL && typeof SHELL.badge === 'function') SHELL.badge('assistant', n);
  } catch (e) { /* the badge repaints with Juli's next message */ }
}
/** remove what a check (or a stopped run) left: [{k, id}] -> the ones that could not go; and the run's finished jobs the queue still
 *  keeps (a test job's title starts with TEST_NAME). 3.9: the home screen's keys ({k: 'home', v}) go back last, after the test apps
 *  (an unpin writes the shell's list) */
export async function sweep(api, list) {
  const left = [], L = Array.isArray(list) ? list : [];
  for (const x of L.filter((y) => y && y.k !== 'home')) {
    try { if (x.k === 'app') await dropApp(api, x.id); else if (x.k === 'session') await dropSession(api, x.id); else if (x.k === 'job') await api.Q().remove(x.id); } catch (e) { left.push(x); }
  }
  for (const x of L.filter((y) => y && y.k === 'home')) { try { homeBack(x.v); } catch (e) { left.push(x); } }
  try { const Q = api.Q(); for (const j of Q.list()) if (benchJob(j) && ['done', 'failed', 'cancelled'].includes(j.status)) await Q.remove(j.id).catch(() => {}); } catch (e) { /* the next start */ }
  return left;
}
/** the run's own jobs (a test job's title starts with TEST_NAME; a speed test is a 'bench' job) */
const benchJob = (j) => !!j && j.root === j.id && (isTestName(j.title) || j.kind === 'bench');
/** the run's test jobs still in the queue (finished, not removed): should be none */
export function testJobs(api) { try { return api.Q().list().filter(benchJob).map((j) => j.kind); } catch (e) { return []; } }
/** 3.9: the run's own jobs still in the queue (the one the page ended in, which the queue put back for the app's safe open; one a check
 *  gave up on) stop and go; never a job of the person's. sessions = the run's test conversations (their jobs are the run's too); only(j):
 *  just these -> the kinds that went */
export async function dropTestJobs(api, only = null, sessions = []) {
  let Q = null; try { Q = api.Q(); } catch (e) { Q = null; } if (!Q) return [];
  const S = new Set(sessions || []), ended = (j) => ['done', 'failed', 'cancelled'].includes(j.status);
  const mine = Q.list().filter((j) => (benchJob(j) || (j.root === j.id && j.session && S.has(j.session))) && (!only || only(j)));
  for (const j of mine) if (!ended(j)) await Q.cancel(j.id).catch(() => {});
  if (mine.some((j) => !ended(Q.get(j.id) || { status: 'done' }))) await until(() => mine.every((j) => { const x = Q.get(j.id); return !x || ended(x); }), 8000);
  const out = [];
  for (const j of mine) if (await Q.remove(j.id).catch(() => false)) out.push(j.kind);
  return out;
}
/** a queue job to its end -> its result, or take(job) (what it made, read before it leaves: its files go with it); a planned fresh
 *  page keeps it in the queue: the next page waits for the same id; the job leaves the queue after (as 3.8's speed tests do) */
function waitJob(Q, id, ms, take = null) {
  const now = Q.get ? Q.get(id) : null, forget = () => setTimeout(() => Q.remove(id).catch(() => {}), 1500);   // after a cancel lands
  const got = (j) => Promise.resolve(take ? take(j) : j.result || {}).finally(forget);
  if (now && now.status === 'done') return got(now);
  if (now && (now.status === 'failed' || now.status === 'cancelled')) { forget(); return Promise.reject(Object.assign(new Error((now.error && now.error.message) || now.status), { code: now.error && now.error.code })); }
  if (now && now.status === 'blocked') {   // it was blocked before this page listened (a planned fresh page runs it first): it would wait for ever
    Q.cancel(id).catch(() => {}); forget();
    return Promise.reject(Object.assign(new Error((now.error && now.error.message) || 'blocked'), { code: now.error && now.error.code }));
  }
  if (Q.get && !now) return Promise.reject(new Error('the job is gone'));
  return new Promise((res, rej) => {
    const off = [], end = (fn, v) => { clearTimeout(tm); for (const o of off) o(); if (fn !== res) forget(); fn(v); };
    const tm = setTimeout(() => { Q.cancel(id).catch(() => {}); end(rej, new Error(`no result in ${Math.round(ms / 1000)} s`)); }, ms);
    off.push(Q.on('done', (j) => { if (j.id === id) end(res, got(j)); }));
    off.push(Q.on('failed', (j) => { if (j.id === id) end(rej, Object.assign(new Error((j.error && j.error.message) || 'failed'), { code: j.error && j.error.code })); }));
    off.push(Q.on('cancelled', (j) => { if (j.id === id) end(rej, new Error('stopped')); }));
    for (const n of ['blocked', 'needs-consent', 'needs-download']) off.push(Q.on(n, (j) => { if (j.id === id) { Q.cancel(id).catch(() => {}); end(rej, new Error((j.error && j.error.message) || n)); } }));
    if (Q.pump) Q.pump();
  });
}
/** Juli's answer to one message in a test conversation (the person's own way: agent.ask -> the 'chat' job) -> {text, session, job} */
async function askJuli(ctx, sid, text, opts = {}, ms = 240000) {
  const AG = ctx.api.AG(), Q = ctx.api.Q();
  let jobId = ctx.state && ctx.state.job;
  if (!jobId) { const j = await AG.ask(sid, text, opts); jobId = j.id; ctx.save({ sid, job: jobId }); }
  await waitJob(Q, jobId, ms);
  const s = await AG.session(sid), msgs = (s && s.messages) || [];
  const mine = msgs.filter((m) => m.role === 'user').pop(), ans = msgs.filter((m) => m.role === 'assistant' && m.text && (!mine || m.at >= mine.at)).pop();
  return { text: ans ? String(ans.text) : '', kind: ans && ans.kind, session: s, mine };
}
/** the helper process's heartbeat while a model is loaded (iOS 27's split): {split, agoMs} or null */
function beatOf(api, k) {
  try { const b = api.splitBeat && api.splitBeat(k); if (!b) return null; return { split: !!b.split, agoMs: b.lastHb ? Math.round(b.now - b.lastHb) : null }; } catch (e) { return null; }
}
const keepBeat = (ctx) => { const b = beatOf(ctx.api, 'brain'); if (b && b.split && b.agoMs != null && (!ctx.shared.beat || ctx.shared.beat.agoMs == null || b.agoMs < ctx.shared.beat.agoMs)) ctx.shared.beat = b; else if (b && !ctx.shared.beat) ctx.shared.beat = b; };

// ------------------------------------------------------------------------------------------------ the checks
const SH = () => globalThis.SHELL;
const homeBtn = (id) => document.querySelector(`#home-grid .sh-app[data-id="${id}"]`);
const dockBtn = (id) => document.querySelector(`#dock .dock-btn[data-id="${id}"]`);
const label = (b) => ((b && b.querySelector('.sh-label')) || {}).textContent || '';
async function goHome() { const sh = SH(); if (!sh) return false; sh.home(); return !!(await until(() => document.documentElement.hasAttribute('data-sh-home') && visible($('home-grid')), 3000)); }
/** a test tone: WAV, 8 kHz mono, soft (the element is muted anyway) */
function toneUrl(sec, hz) {
  const rate = 8000, n = Math.round(sec * rate), b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 1200), true);
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
}

export const CHECKS = {
  async 'shell.home'() {
    if (!SH() || !SH().ready) return fail('the home screen did not start');
    if (!(await goHome())) return fail('the home screen did not show');
    const want = { library: 'Library', apps: 'Apps', browser: 'Browser', games: 'Games', skills: 'Skills', connection: 'Connection' };
    const bad = Object.entries(want).filter(([id, t]) => { const b = homeBtn(id); return !b || !visible(b) || label(b) !== t; }).map(([id]) => id);
    const clipped = [...document.querySelectorAll('#home-grid .sh-app .sh-label')].filter((l) => l.scrollWidth > l.clientWidth + 1 && !l.closest('.sh-app').dataset.id.startsWith('app:')).map((l) => l.textContent);
    if (bad.length) return fail('missing or misnamed: ' + bad.join(', '));
    if (clipped.length) return fail('names cut off: ' + clipped.join(', '));
    return pass(`${document.querySelectorAll('#home-grid .sh-app').length} icons, each named`);
  },
  async 'shell.dock'() {
    if (!(await goHome())) return fail('the home screen did not show');
    const got = [...document.querySelectorAll('#dock .dock-btn')].map((b) => `${b.dataset.id}=${label(b)}`).join(', ');
    const want = 'assistant=Juli, create=Create, music=Music, settings=Settings';
    return got === want ? pass('Juli, Create, Music, Settings') : fail('the dock holds: ' + (got || 'nothing'));
  },
  async 'shell.pill'(ctx) {
    if (!(await goHome())) return fail('the home screen did not show');
    const p = $('brand-pill'), d = $('dock');
    if (!visible(p)) return fail('the pill is not showing');
    if (!/p0pc0rn/.test(p.textContent || '')) return fail('the pill does not say p0pc0rn');
    const pr = rect(p), dr = rect(d), mid = innerWidth / 2;
    if (pr.bottom > dr.top + 2) return fail(`not above the dock (${Math.round(pr.bottom)} vs ${Math.round(dr.top)})`);
    if (Math.abs((pr.left + pr.right) / 2 - mid) > 6) return fail('not centred');
    const u0 = await unreadMap(), c0 = await convNow();
    p.click();
    const ok = await until(() => ctx.api.tab() === 'assistant' && visible($('v-assistant')), 4000);
    await goHome(); await sleep(600); await keepConversations(ctx.api, c0); await keepUnread(ctx.api, u0);
    return ok ? pass('above the dock, centred; a tap opens Juli') : fail('a tap did not open Juli');
  },
  async 'shell.screens'(ctx) {
    const sh = SH(), ids = ['assistant', 'create', 'music', 'settings', 'library', 'apps', 'browser', 'games', 'skills', 'cast'], bad = [];
    const u0 = await unreadMap(), n0 = unseenNow(), c0 = await convNow();
    for (const id of ids) {
      sh.open(id, { from: homeBtn(id) || dockBtn(id) || null });
      const want = { assistant: 'v-assistant', create: 'v-create', music: 'v-music', settings: 'v-settings', library: 'v-library', apps: 'v-apps', browser: 'v-browser', games: 'v-apps', skills: 'v-skills', cast: 'v-cast' }[id];
      const shown = await until(() => visible($(want)) && !document.documentElement.hasAttribute('data-sh-home'), 3000);
      if (!shown) bad.push(id);
      if (!(await goHome())) { bad.push(id + ' (did not go back)'); }
    }
    await sleep(600); await keepConversations(ctx.api, c0); await keepUnread(ctx.api, u0); keepUnseen(n0);
    return bad.length ? fail('did not open: ' + bad.join(', ')) : pass(`${ids.length} screens`);
  },
  async 'shell.badge'() {
    if (!(await goHome())) return fail('the home screen did not show');
    const b = homeBtn('library'); if (!b) return fail('no Library icon');
    SH().badge('library', 7); await sleep(150);
    const el = b.querySelector('.sh-badge'), tile = b.querySelector('.sh-tile');
    const shown = el && el.textContent === '7' && visible(el), er = el && rect(el), tr = tile && rect(tile);
    const topLeft = er && tr && (er.left + er.right) / 2 < (tr.left + tr.right) / 2 && (er.top + er.bottom) / 2 < (tr.top + tr.bottom) / 2;
    SH().badge('library', 0); await sleep(150);
    const cleared = !el || el.textContent === '';
    SH().refresh();
    if (!shown) return fail('the number did not show');
    if (!topLeft) return fail('not at the top left of the icon');
    return cleared ? pass('7 at the top left, then cleared') : fail('it did not clear');
  },
  async 'shell.wall'() {
    const w = $('wall'), i = $('wall-img'); if (!w || !i) return fail('no wallpaper layer');
    const cs = getComputedStyle(i), cw = getComputedStyle(w);
    const pic = (cs.backgroundImage && cs.backgroundImage !== 'none') || (cw.backgroundImage && cw.backgroundImage !== 'none');
    const blur = /blur\(/.test(cs.filter || '') || /blur\(/.test(cw.filter || '') || /blur\(/.test(cs.backdropFilter || '');
    return pic && blur ? pass('an image, blurred') : fail(!pic ? 'no image or colours behind the icons' : 'not blurred');
  },
  async 'shell.conn'() {
    if (!(await goHome())) return fail('the home screen did not show');
    const b = homeBtn('connection'); if (!b) return fail('no Connection icon');
    if (!b.classList.contains('grayed')) return fail('Connection is not grayed');
    b.click();
    const sheet = await until(() => { const s = document.querySelector('#sh-connection .sheet'); return s && visible(s) ? s : null; }, 3000);
    if (!sheet) return fail('a tap showed nothing');
    const words = [...sheet.querySelectorAll('p')].map((p) => p.textContent.trim()).filter((t) => t && t !== 'Connection');
    const okBtn = [...sheet.querySelectorAll('button')].find((x) => /^OK$/.test(x.textContent.trim()));
    if (okBtn) okBtn.click(); else { const c = document.querySelector('#sh-connection [data-close]'); if (c) c.click(); }
    await until(() => !document.getElementById('sh-connection'), 2000);
    return words.length === 1 && words[0] === 'Coming soon' ? pass('grayed; “Coming soon” and nothing more') : fail('it says: ' + words.join(' | ').slice(0, 120));
  },
  async 'shell.edit'() {
    if (!(await goHome())) return fail('the home screen did not show');
    const b = homeBtn('library') || document.querySelector('#home-grid .sh-app'); if (!b) return fail('no icon to press');
    const r = rect(b), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y };
    b.dispatchEvent(new PointerEvent('pointerdown', o));
    const on = await until(() => SH().editing, 1500, 50);
    b.dispatchEvent(new PointerEvent('pointerup', o));
    await sleep(200);
    const done = $('home-done'); if (done && !done.hidden) done.click();
    const off = await until(() => !SH().editing, 1500, 50);
    return on && off ? pass('a long press turned it on; Done turned it off') : fail(!on ? 'a long press did not turn it on' : 'Done did not turn it off');
  },
  async 'shell.pin'(ctx) {
    if (!(await goHome())) return fail('the home screen did not show');
    const before = homeRaw(); ctx.fx.add({ k: 'home', id: 'keys', v: before });   // 3.9: the keys as they were, also for a page that ends in here
    const app = await testApp(ctx, 'daily-counter', 'pin');
    try {
      const id = 'app:' + app.id;
      if (!SH().pin({ id, title: app.name, ref: app.id })) return fail('it could not be added (the home screen is full?)');
      const shown = await until(() => { const b = homeBtn(id); return b && visible(b) && label(b) === app.name; }, 3000);
      SH().unpin(id);
      const gone = await until(() => !homeBtn(id), 3000);
      return shown && gone ? pass('added with its name, then taken off') : fail(!shown ? 'it did not show on the home screen' : 'it did not go');
    } finally {
      await dropApp(ctx.api, app.id); ctx.fx.drop({ k: 'app', id: app.id });
      homeBack(before); ctx.fx.drop({ k: 'home', id: 'keys' });   // the raw values: a key that was not there goes again (not "[]")
    }
  },
  async 'skills.load'(ctx) {
    const APPS = await appsReady(ctx), R = APPS && APPS.state.skills; if (!R) return fail('the skills did not load');
    const have = new Set(R.list().map((k) => k.name)), want = ['make-an-app', 'change-an-app', 'play-four-in-a-row', 'make-a-game', 'watch-a-wallet'], miss = want.filter((n) => !have.has(n));
    return miss.length ? fail('missing: ' + miss.join(', ')) : pass(want.join(', '));
  },
  async 'skills.words'(ctx) {
    const { pickSkill } = await import('../assistant/skills.js');
    const APPS = await appsReady(ctx), R = APPS && APPS.state.skills; if (!R) return fail('the skills did not load');
    const got = pickSkill('please make an app that counts the steps I walk each day', R.skillsFor('make'), 'make');
    return got === 'make-an-app' ? pass('make-an-app for an app request') : fail('picked ' + (got || 'none'));
  },
  async 'skills.named'(ctx) {
    const { pickSkill } = await import('../assistant/skills.js');
    const APPS = await appsReady(ctx), R = APPS && APPS.state.skills; if (!R) return fail('the skills did not load');
    const got = pickSkill('please use my change-an-app skill for this', R.skillsFor('change'), 'change');
    return got === 'change-an-app' ? pass('“use my change-an-app skill”') : fail('picked ' + (got || 'none'));
  },
  async 'chat.actions'() {
    const { actionsFor } = await import('./chatactions.js');
    const pic = actionsFor({ kind: 'picture' }, { picOK: true }), song = actionsFor({ kind: 'song' }, {}), clip = actionsFor({ kind: 'clip' }, {});
    const ok = ['again', 'edit', 'animate'].every((a) => pic.includes(a)) && ['again', 'animate'].every((a) => song.includes(a)) && clip.includes('again');
    return ok ? pass('picture: make again, edit, animate; song: make again, animate; clip: make again') : fail(`picture ${pic}, song ${song}, clip ${clip}`);
  },
  async 'music.player'(ctx) {
    const M = await import('./music_core.js');
    const audio = ctx.shared.audio || new Audio(); audio.muted = true;
    const urls = { t1: toneUrl(2.5, 440), t2: toneUrl(2.5, 660) }, songs = { t1: { id: 't1', media: 'audio', title: `${TEST_NAME} tone 1`, duration: 2.5 }, t2: { id: 't2', media: 'audio', title: `${TEST_NAME} tone 2`, duration: 2.5 } };
    const handlers = {}, ms = { metadata: null, playbackState: 'none', setActionHandler: (a, f) => { handlers[a] = f; }, setPositionState: () => {} };
    class MediaMetadata { constructor(o) { Object.assign(this, o); } }
    const P = M.createPlayer({ audio, load: (id) => ({ src: urls[id] }), release: () => {}, ms, MediaMetadata, song: (id) => songs[id] || null });
    try {
      P.playList(['t1', 't2'], 0, { label: TEST_NAME });
      const playing = await until(() => audio.currentTime > 0.2 && !audio.paused, 6000);
      if (!playing) return ctx.shared.audio ? fail('the test tone did not play') : notRun('the phone allows sound only after a tap: start the run again from its Start button');
      const meta = ms.metadata && ms.metadata.title === songs.t1.title, acts = ['play', 'pause', 'nexttrack'].every((a) => typeof handlers[a] === 'function');
      P.next();
      const second = await until(() => P.state().id === 't2' && audio.currentTime > 0.1, 6000);
      P.seek(1.0); await sleep(250);
      const seeked = Math.abs(audio.currentTime - 1.0) < 0.6;
      P.pause(); await sleep(150);
      const paused = audio.paused && !P.state().playing;
      const bad = [!meta && 'no lock-screen title', !acts && 'no lock-screen buttons', !second && 'next did not play the second tone', !seeked && 'seek did not move', !paused && 'pause did not pause'].filter(Boolean);
      return bad.length ? fail(bad.join('; ')) : pass('played, next, seek, pause; title and buttons set for the lock screen');
    } finally {
      try { P.destroy(); } catch (e) { /* */ }
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* */ }
      for (const u of Object.values(urls)) URL.revokeObjectURL(u);
    }
  },
  async 'music.lock'() { return notRun('needs the screen locked: Settings › Benchmark › Music check'); },
  async 'memory.beat'(ctx) {
    const M = await import('../assistant/memory.js'), now = Date.now();
    const r = { id: 'bench', text: `${TEST_NAME} routine`, when: 'every:1', last: now - 2 * 3600e3, at: now - 3 * 3600e3 };
    const st = M.freshState(), first = M.pickDue([r], now, st);
    const st2 = M.ran(st, r, now), again = M.pickDue([Object.assign({}, r, { last: now })], now + 1000, st2);
    const { memoryGates } = await import('./memory_ui.js');
    const busy = memoryGates({ readOnly: () => false, AG: () => ({}), CH: () => ({}), installed: () => true, consented: () => true, appOpen: () => false, modelBusy: () => true }, { doc: { visibilityState: 'visible' } })();
    const MEM = ctx.api.MEM();
    const bad = [!first && 'a due routine was not picked', again && 'it would run twice', busy.ok && 'it would run while Juli is busy', !(MEM && MEM.hb) && 'no heartbeat in the app'].filter(Boolean);
    return bad.length ? fail(bad.join('; ')) : pass('due once, not twice, held while busy; the heartbeat is running');
  },
  async 'chat.reply'(ctx) {
    const CH = ctx.api.CH(), chats = !!(CH && typeof CH.unread === 'function');
    const u0 = chats ? await unreadNow() : 0;
    const sid = (ctx.state && ctx.state.sid) || await testSession(ctx);
    let u1 = null;
    try {
      const a = await askJuli(ctx, sid, 'Say hello in five words.');
      keepBeat(ctx);
      if (chats) {   // the answer landed in a conversation that is not on screen: Juli's unread count goes up by one (her badge)
        u1 = await until(() => (CH.unread() >= u0 + 1 ? CH.unread() : null), 4000);
        const dock = document.querySelector('#dock .dock-btn[data-id="assistant"] .sh-badge');
        ctx.shared.unread = { before: u0, during: u1, badge: dock ? dock.textContent : null };
      }
      return a.text.trim().length >= 2 ? pass(`“${a.text.trim().slice(0, 40)}”`) : fail('no answer in the conversation');
    } finally {
      await dropSession(ctx.api, sid); ctx.fx.drop({ k: 'session', id: sid });
      if (chats && ctx.shared.unread) ctx.shared.unread.after = await unreadNow();
    }
  },
  async 'chat.unread'(ctx) {
    const u = ctx.shared.unread;
    if (!u) return notRun('the conversation check did not get that far');
    if (u.during == null) return fail(`the count stayed at ${u.before}`);
    if (globalThis.SHELL && u.badge !== String(u.during)) return fail(`the badge said “${u.badge}”, the count ${u.during}`);
    return u.after === u.before ? pass(`${u.before} → ${u.during} on the badge → ${u.after} after the test chat went`) : fail(`after the test chat went: ${u.after} (before: ${u.before})`);
  },
  async 'memory.about'(ctx) {
    const AG = ctx.api.AG(), M = await import('../assistant/memory.js');
    if (!AG || !AG.hooks) return fail('Juli is not ready');
    const prev = AG.hooks.about, resumed = !!(ctx.state && ctx.state.job); let asked = 0;
    AG.hooks.about = (budget) => { asked++; return M.aboutBlock('My name is Robin. I like short answers.', budget); };   // test text for this one check: the person's About me is not read or written
    const sid = (ctx.state && ctx.state.sid) || await testSession(ctx);
    try {
      const a = await askJuli(ctx, sid, 'What is my name? Reply with my name only.');
      keepBeat(ctx);
      if (!asked && !resumed) return fail('About me was not asked for');   // 3.9: a turn carried over a planned fresh page may have asked on the page before
      return /\bRobin\b/i.test(a.text) ? pass('Juli used it (“' + a.text.trim().slice(0, 30) + '”)') : fail('Juli did not use it: “' + a.text.trim().slice(0, 60) + '”');
    } finally { AG.hooks.about = prev; await dropSession(ctx.api, sid); ctx.fx.drop({ k: 'session', id: sid }); }
  },
  async 'memory.routine'(ctx) {
    const sid = (ctx.state && ctx.state.sid) || await testSession(ctx);
    try {
      const a = await askJuli(ctx, sid, 'Say good evening in five words.', { kind: 'routine' });
      keepBeat(ctx);
      if (!a.mine || a.mine.kind !== 'routine') return fail('the message was not kept as a routine');
      return a.text.trim().length >= 2 ? pass(`“${a.text.trim().slice(0, 40)}”`) : fail('no answer');
    } finally { await dropSession(ctx.api, sid); ctx.fx.drop({ k: 'session', id: sid }); }
  },
  async 'chat.writing'(ctx) {   // 3.9: a piece of writing with no Bigger brain for it: Juli writes it herself, in words (nothing made instead)
    const AG = ctx.api.AG(), Q = ctx.api.Q(), text = 'Write a short poem about the sea, four lines.';
    if (!AG || !AG.hooks) return fail('Juli is not ready');
    const { RENDER_KINDS } = await import('../assistant/queue.js');
    const prev = AG.hooks.brainModel; AG.hooks.brainModel = () => null;   // for this one check, in memory: the Bigger brain is not asked (Settings › Juli is not touched)
    const before = new Set(Q.list().map((j) => j.id));
    const sid = (ctx.state && ctx.state.sid) || await testSession(ctx);
    try {
      const route = AG.route({ params: { text } });
      if (route.kind !== 'writing' || route.brain) return fail(`not seen as writing for Juli (${route.kind}${route.brain ? ', Bigger brain' : ''})`);
      const a = await askJuli(ctx, sid, text);
      keepBeat(ctx);
      const made = Q.list().filter((j) => !before.has(j.id) && RENDER_KINDS.has(j.kind)).map((j) => j.kind);
      if (made.length) return fail('she made something instead: ' + made.join(', '));
      const lines = a.text.split('\n').filter((l) => l.trim()).length;
      return lines >= 2 ? pass(`${lines} lines in her reply`) : fail('no poem: “' + a.text.slice(0, 60) + '”');
    } finally { AG.hooks.brainModel = prev; await dropSession(ctx.api, sid); ctx.fx.drop({ k: 'session', id: sid }); }
  },
  async 'games.c4'(ctx) {
    const R = await import('./bench_c4.js'), APPS = await appsReady(ctx), A = APPS && APPS.state;
    if (!A) return fail('the Apps tab has not started');
    // 3.9: a planned fresh page (the app switching models) closes the game: the same test app opens again and Juli plays the positions
    // again; a move the queue kept from the page that went leaves first (its game is gone)
    let app = ctx.state && ctx.state.appId ? (A.apps || []).find((a) => a.id === ctx.state.appId) || null : null;
    if (app) await dropTestJobs(ctx.api, (j) => j.kind === 'appchoose' && (j.params || {}).appId === app.id);
    else { app = await testApp(ctx, 'connect-four', 'game'); ctx.save({ appId: app.id }); }
    const undos = [];
    try {
      const o = await openTest(ctx, app, undos);
      if (!o.open) return fail('the game did not open: ' + o.why);
      if (!o.booted) return fail('the game did not start');
      const out = [], t0 = performance.now();
      for (const pos of c4Positions(R)) {
        const r = await APPS.choose(app, { about: R.boardText(pos.board), options: R.optionsFor(pos.board), hint: R.hintFor(pos.board, 2), skill: 'play-four-in-a-row' });
        const col = R.legalCols(pos.board)[r.index];
        const j = r.by === 'juli' ? c4Judge(R, pos, col) : { ok: false, why: 'Juli did not answer (' + (r.why || 'fallback') + ')' };
        out.push(Object.assign({ name: pos.name }, j));
        keepBeat(ctx);
      }
      const still = !!(A.open && A.open.app && A.open.app.id === app.id), mem = ctx.api.mem ? ctx.api.mem() : null;
      const bad = out.filter((x) => !x.ok), secs = ((performance.now() - t0) / 1000).toFixed(1);
      const memTxt = mem && mem.gpuMB != null ? `; page graphics memory ${mem.gpuMB} MB with Juli and the game open` : '';
      if (!still) return fail('the game closed while Juli moved' + memTxt);
      return bad.length ? fail(bad.map((x) => `${x.name}: ${x.why}`).join('; ') + memTxt) : pass(`won, blocked, legal (${secs} s for 3 moves${memTxt})`);
    } finally { await dropApp(ctx.api, app.id); ctx.fx.drop({ k: 'app', id: app.id }); undos.forEach((u) => u()); }
  },
  async 'split.beat'(ctx) {
    const b = ctx.shared.beat || beatOf(ctx.api, 'brain');
    if (!b) return notRun('Juli was not loaded when it looked');
    if (!b.split) return notRun('Juli ran in one process this time');
    return b.agoMs != null && b.agoMs < 5000 ? pass(`a beat ${Math.max(0, b.agoMs)} ms before`) : fail(b.agoMs == null ? 'no beat seen' : `the last beat was ${Math.round(b.agoMs / 1000)} s before`);
  },
  async 'big.writing'(ctx) {
    const AG = ctx.api.AG(), text = 'Write a short poem about the sea, four lines.';
    const route = AG.route({ params: { text } });
    if (!route.brain) return fail('Juli kept it (the Bigger brain was not chosen for writing)');
    const sid = (ctx.state && ctx.state.sid) || await testSession(ctx);
    try {
      const a = await askJuli(ctx, sid, text, {}, 420000);
      const s = await AG.session(sid), by = s && s.brainLast;
      if (!by) return fail('the Bigger brain did not write it');
      const lines = a.text.split('\n').filter((l) => l.trim()).length;
      return lines >= 2 ? pass(`${lines} lines`) : fail('no poem: “' + a.text.slice(0, 60) + '”');
    } finally { await dropSession(ctx.api, sid); ctx.fx.drop({ k: 'session', id: sid }); }
  },
  async 'apps.make'(ctx) {
    const APPS = await appsReady(ctx), A = APPS && APPS.state, Q = ctx.api.Q();
    if (!A) return fail('the Apps tab has not started');
    let id = ctx.state && ctx.state.job;
    if (!id) {
      const j = await Q.add('makeapp', { text: 'an app that counts the glasses of water I drink each day, with a goal of 8', only: null, skels: [...A.bundled] }, { title: `${TEST_NAME}: make an app` });
      id = j.id; ctx.save({ job: id });
    }
    let r; try { r = await waitJob(Q, id, 480000); } finally { const st = $('apps-status'); if (st && /^Juli: /.test(st.textContent || '')) st.hidden = true; }
    if (!r || !r.ok) return fail((r && r.message) || 'no app');
    const skel = A.skels.get(r.skel); if (!skel) return fail('an unknown skeleton: ' + r.skel);
    if (!A.bundled.has(r.skel)) return fail('a design that does not come with p0pc0rn: ' + r.skel);   // 3.9 (review): the test only offers those
    const app = await testApp(ctx, r.skel, 'made'), undos = [];
    try {
      app.slots = r.slots; await A.db.put('apps', app);
      const o = await openTest(ctx, app, undos);
      if (!o.open) return fail('the made app did not open: ' + o.why);
      return o.booted ? pass(`a ${skel.manifest.name} (${Object.keys(r.slots || {}).length} slots), it starts`) : fail('the made app did not start');
    } finally { await dropApp(ctx.api, app.id); ctx.fx.drop({ k: 'app', id: app.id }); undos.forEach((u) => u()); }
  },
  async 'apps.change'(ctx) {
    const APPS = await appsReady(ctx), A = APPS && APPS.state, Q = ctx.api.Q();
    if (!A) return fail('the Apps tab has not started');
    let appId = ctx.state && ctx.state.appId, id = ctx.state && ctx.state.job;
    if (!appId) { const app = await testApp(ctx, 'daily-counter', 'app'); appId = app.id; ctx.save({ appId }); }   // 3.9: kept before the job, which can switch models twice (Josh's phone)
    const peak = { gpu: 0, js: 0 }, undos = [], tick = setInterval(() => { const m = ctx.api.mem ? ctx.api.mem() : null; if (m) { peak.gpu = Math.max(peak.gpu, m.gpuMB || 0); peak.js = Math.max(peak.js, m.jsMB || 0); } }, 1000);
    try {
      if (!id) { const j = await Q.add('appedit', { appId, text: 'Change the title to Steps' }, { title: `${TEST_NAME}: change an app` }); id = j.id; ctx.save({ job: id, appId }); }
      const r = await waitJob(Q, id, 900000);
      const app = (A.apps || []).find((a) => a.id === appId) || await A.db.get('apps', appId);
      if (!r || !r.ok) return fail((r && (r.message || r.asked)) || 'nothing was changed');
      if (!app || !app.slots || app.slots.title !== 'Steps') return fail('the title is “' + (app && app.slots ? app.slots.title : '?') + '”');
      const memTxt = peak.gpu ? `; page graphics memory up to ${peak.gpu} MB${peak.js ? `, scripts ${peak.js} MB` : ''} while Juli tried it out` : '';
      const o = await openTest(ctx, app, undos);
      if (!o.open) return fail('changed, but it did not open: ' + o.why + memTxt);
      return o.booted ? pass('the title is “Steps” and it starts' + memTxt) : fail('changed, but it did not start' + memTxt);
    } finally { clearInterval(tick); await dropApp(ctx.api, appId); ctx.fx.drop({ k: 'app', id: appId }); undos.forEach((u) => u()); const st = $('apps-status'); if (st) st.hidden = true; }
  },
  async 'apps.icon'(ctx) {   // 3.9 (part 12): "Make an icon", as Add to Home Screen does it, for the bench's own test app
    const ICON = globalThis.P0APPICON;
    if (!ICON || typeof ICON.put !== 'function') return notRun('Make an icon is not in this build');
    const M = await import('./appicon.js'), C = await import('./appicon_core.js');
    const APPS = await appsReady(ctx), A = APPS && APPS.state, Q = ctx.api.Q();
    if (!A) return fail('the Apps tab has not started');
    const st = Object.assign({}, ctx.state || {});
    const keep = () => ctx.save(Object.assign({}, st, { job: st.shot || st.plan }));   // a planned fresh page carries the check on with its job
    let app = st.appId ? (A.apps.find((a) => a.id === st.appId) || await A.db.get('apps', st.appId).catch(() => null)) : null;
    if (!app) { st.keys0 = homeRaw(); ctx.fx.add({ k: 'home', id: 'keys', v: st.keys0 }); app = await testApp(ctx, 'daily-counter', 'icon'); st.appId = app.id; keep(); }   // 3.9: + for a page that ends in here
    const why = (e) => String((e && e.message) || e || 'stopped').slice(0, 120);
    try {
      // 1. the idea: Juli's (one tiny JSON on her own model), or the skeleton's own when she can't give one
      if (!st.idea) {
        if (!st.plan) { const sk = A.skels.get(app.skel); const j = await Q.add('appiconplan', { name: app.name, skelName: sk ? sk.manifest.name : '', about: sk ? sk.manifest.description : '' }, { title: `${TEST_NAME}: icon idea` }); st.plan = j.id; keep(); }
        let idea = ''; try { idea = String(((await waitJob(Q, st.plan, 180000)) || {}).idea || ''); } catch (e) { idea = ''; }
        st.by = idea ? 'juli' : 'fallback'; st.idea = idea || C.fallbackIdea({ skel: app.skel }); keep();
      }
      // 2. ONE shot of the picture model (FLUX.2 [klein] 4B, 512 x 512) through the queue, kept out of the Library
      if (!st.shot) { const j = await Q.add('appicon', { prompt: C.iconPrompt(st.idea), seed: 4242 }, { title: `${TEST_NAME}: app icon` }); st.shot = j.id; keep(); }
      let pic = null;
      try { pic = await waitJob(Q, st.shot, 600000, async (j) => { const k = j.result && j.result.image && j.result.image.blobKey; return k ? Q.getBlob(k) : null; }); }
      catch (e) { return fail('the picture: ' + why(e)); }
      if (!(pic instanceof Blob) || !pic.size) return fail('the picture: it came back empty');
      // 3. the home screen's two sizes (180 + 120 px PNGs) in the icons' store, for the test app
      await ICON.put(app.id, await M.toIcons(pic), st.idea);
      const rec = await idbGet('p0pc0rn-icons', 'icons', app.id);
      const side = async (b, n) => { if (!(b instanceof Blob) || b.type !== 'image/png') return false; try { const bm = await createImageBitmap(b); const ok = bm.width === n && bm.height === n; bm.close(); return ok; } catch (e) { return false; } };
      if (!rec || !(await side(rec.png180, 180)) || !(await side(rec.png120, 120))) return fail('the icon sizes: ' + (rec ? 'not a 180 and a 120 px PNG' : 'nothing kept'));
      // 4. on its pin, the home screen's tile shows it (a blob: picture, as the system icons)
      if (!SH().pin({ id: 'app:' + app.id, title: app.name, ref: app.id })) return fail('the home tile: the home screen is full');
      await goHome();
      const shown = await until(() => { const b = homeBtn('app:' + app.id), im = b && b.querySelector('.sh-tile img'); return im && /^blob:/.test(im.currentSrc || im.src) && im.complete && im.naturalWidth > 0; }, 5000);
      if (!shown) return fail('the home tile: it did not show the icon');
      // 5. the test app deleted (its pin with it): no icon record, no tile
      await dropApp(ctx.api, app.id); ctx.fx.drop({ k: 'app', id: app.id });
      const gone = await until(async () => !homeBtn('app:' + app.id) && !(await idbGet('p0pc0rn-icons', 'icons', app.id)), 5000);
      if (!gone) return fail('deleting the app: ' + (homeBtn('app:' + app.id) ? 'its tile stayed' : 'its icon stayed'));
      return pass(`${st.by === 'juli' ? 'Juli’s idea' : 'the skeleton’s own idea'} “${st.idea}”, one 512² picture, 180 + 120 px PNGs, on its home tile, gone with the app`);
    } finally {
      await dropApp(ctx.api, app.id); ctx.fx.drop({ k: 'app', id: app.id });
      try { await ICON.drop(app.id); } catch (e) { /* */ }
      homeBack(st.keys0); ctx.fx.drop({ k: 'home', id: 'keys' });   // 3.9: only the keys it kept (a state without them leaves the person's alone)
    }
  },
};

/** the person's data, for the before / after check: {name: string} (never sent anywhere; kept on this phone with the results) */
export async function snapshot(api) {
  const out = {}, ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  for (const k of ['p0pc0rn:home:pins', 'p0pc0rn:home:order', 'p0pc0rn:music', 'pf.app.chatSession', 'p0pc0rn:shell:unseen']) out['ls ' + k] = String(ls(k));
  const apps = await idbAll('p0pc0rn-apps', 'apps'), mem = await idbAll('p0pc0rn-apps', 'memory'), skills = await idbAll('p0pc0rn-apps', 'skills');
  out['apps'] = Object.keys(apps).sort().join(',');
  for (const k of ['about', 'routines']) out['memory ' + k] = String(mem[k] || '');
  out['skills'] = Object.entries(skills).map(([k, v]) => k + ':' + v.length).sort().join(',');
  out['app permissions'] = Object.entries(await idbAll('p0pc0rn-apps', 'grants')).map(([k, v]) => k + ':' + v.length).sort().join(',');   // the person's Allow taps (the bench saves none)
  out['conversations'] = Object.keys(await idbAll('p0pc0rn-assistant', 'sessions')).sort().join(',');
  out['chats'] = Object.keys(await idbAll('p0pc0rn-chats', 'threads')).filter((k) => !k.startsWith('_')).sort().join(',');
  out['chats unread'] = JSON.stringify(await unreadMap());   // compared as "never lower" (bench_core.js snapDiff): the person's own apps may post meanwhile
  const wall = await idbAll('p0pc0rn-shell', 'kv'); out['wallpaper'] = String(wall.wall || '');
  out['library'] = digest(await idbKeys('pocketflux-app', 'meta'));   // the person's pictures, clips and songs (the run keeps none)
  out['app icons'] = Object.entries(await idbAll('p0pc0rn-icons', 'icons')).map(([k, v]) => k + ':' + v).sort().join('|');   // 3.9 Make an icon: the made apps' home icons (sizes)
  return out;
}
/** a list as "N · hash" (FNV-1a), short enough to keep with the run however big the Library is */
function digest(list) {
  let h = 0x811c9dc5; for (const ch of list.join('\n')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${list.length} · ${h.toString(16)}`;
}
