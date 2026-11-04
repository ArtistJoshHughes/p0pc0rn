// scheduler.js - p0pc0rn v4: ONE scheduler for everything apps do (Josh, Nov 1: "if multiple apps are calling APIs ... Juli can schedule
// all jobs", with priority settings). It decides which due app check runs next and how their questions to Juli are batched; the host
// (makeapp/host.js tick) runs them, the queue (assistant/queue.js) runs the model jobs, budget.js caps every source. Pure: no DOM, the
// clock and the storage are passed in (node tests, the scheduler bench).
//   - The person comes first: their chat and renders always go before app work (the queue's own rule); app work never starts while a
//     model they asked for is loading or running; a tick runs app checks for at most SCHED.tickBudgetMs, then yields; a check's question
//     to Juli is cancelled when the person's job arrives (the host).
//   - Priority: due checks run by the app's priority (High / Normal / Low, Settings › Apps), then by how overdue they are. A Low app
//     still runs once it is SCHED.starveFactor x its interval late (starving: it goes first). An app that is watching closely (Token
//     Watch) or that said it is active gets a half-step bump, never above a High app.
//   - Juli in batches: the checks that ask Juli run back to back on ONE model load (the queue holds the model between them), grouped by
//     model (Juli E2B, the Bigger brain) so models never ping-pong between apps; a check that would load a model alone waits up to
//     SCHED.batchWindowMs for others of the same model that are about to be due (never a High or starving one).
//   - The Bigger brain for an app only when that app's own switch is on (Token Watch's "Name references"); when it is not downloaded or
//     its second process cannot start, that job waits and says why (it is never run on Juli's own model instead).
//   - A log of what ran, what waited and why, model loads and swaps, calls per source (Diagnostics; the bench reads it).

export const PRIO = Object.freeze({ high: 3, normal: 2, low: 1 });
export const PRIO_LEVELS = Object.freeze(['high', 'normal', 'low']);
export const SCHED = Object.freeze({ tickBudgetMs: 25000, starveFactor: 3, batchWindowMs: 60000, boost: 0.5, batchHoldMs: 20000, logMax: 400 });
export const PRIO_KEY = 'p0pc0rn:apps:priority';

const readJSON = (store, k) => { try { const s = store && store.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
const idOk = (id) => /^[\w-]{1,80}$/.test(String(id || ''));

/** the person's priorities: {appId: 'high' | 'low'} (Normal is the default and is not stored) */
export function readPriorities(store) {
  const o = readJSON(store, PRIO_KEY), out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 200)) if (idOk(k) && (v === 'high' || v === 'low')) out[k] = v;
  return out;
}
export const priorityOf = (prios, appId) => ((prios || {})[appId] === 'high' ? 'high' : (prios || {})[appId] === 'low' ? 'low' : 'normal');
/** set one app's priority -> the new map (kept in storage; 'normal' removes the entry) */
export function setPriority(store, appId, level) {
  const p = readPriorities(store);
  if (!idOk(appId)) return p;
  if (level === 'high' || level === 'low') p[appId] = level; else delete p[appId];
  try { store && store.setItem(PRIO_KEY, JSON.stringify(p)); } catch (e) { /* this page only */ }
  return p;
}

/** an app's Juli work: which model its check's questions need. manifest.permissions.juli: 'ask' (Juli's own model, E2B), plus 'big' (it may
 *  ask the Bigger brain for work its own switch turns on). bigOn = the app's switch; big = {downloaded, usable, why} -> {model: 'e2b' |
 *  'big' | null, wait: '' | why} (a big job that cannot run waits with why; it is never answered by E2B) */
export function modelPlan(manifest, { bigOn = false, big = {} } = {}) {
  const J = ((manifest && manifest.permissions) || {}).juli || [];
  if (!J.includes('ask')) return { model: null, wait: '' };
  if (!J.includes('big') || !bigOn) return { model: 'e2b', wait: '' };
  if (!big.downloaded) return { model: 'big', wait: 'the Bigger brain is not downloaded yet' };
  if (!big.usable) return { model: 'big', wait: `the Bigger brain can't run now${big.why ? ' (' + big.why + ')' : ''}` };
  return { model: 'big', wait: '' };
}

/** one due check as the scheduler sees it: {id, due (ms), everyMs (its interval), lastRun (ms, 0 = never), priority, boost, model,
 *  needsJuli} -> the same with {tier, overdue, starving} */
export function scoreOf(it, now) {
  const every = Math.max(60e3, +it.everyMs || 15 * 60e3), overdue = Math.max(0, now - (+it.due || 0));
  const since = it.lastRun ? now - it.lastRun : overdue + every;
  const starving = since >= SCHED.starveFactor * every;
  const base = PRIO[it.priority] || PRIO.normal;
  const tier = starving ? PRIO.high + 1 : base + (it.boost && base < PRIO.high ? SCHED.boost : 0);
  return Object.assign({}, it, { tier, overdue, starving });
}
/** the due checks in the order they should start: starving first, then by tier (priority + a bump, never above High), then the most
 *  overdue; ties by id (stable) */
export function rankDue(items, now) {
  return (items || []).map((it) => scoreOf(it, now)).sort((a, b) => b.tier - a.tier || b.overdue - a.overdue || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** fewest model swaps without breaking priority: within one tier the checks on the model already loaded (or the one before) go first,
 *  then those needing no model, then the other model; a lower tier never jumps a higher one. -> {order, swaps, loads} (loads counts the
 *  models this order loads, starting from `loaded`) */
export function batchByModel(ranked, loaded = null) {
  const tiers = [], order = [];
  for (const it of ranked || []) { const t = tiers.find((x) => x.tier === it.tier); if (t) t.items.push(it); else tiers.push({ tier: it.tier, items: [it] }); }
  let cur = loaded;
  for (const t of tiers.sort((a, b) => b.tier - a.tier)) {
    const pool = t.items.slice();
    while (pool.length) {
      const same = pool.filter((x) => x.model && x.model === cur), none = pool.filter((x) => !x.model);
      let next = same[0] || (cur ? none[0] : null) || pool.find((x) => x.model) || none[0];
      if (!next) next = pool[0];
      pool.splice(pool.indexOf(next), 1); order.push(next);
      if (next.model) cur = next.model;
    }
  }
  let swaps = 0, loads = 0, m = loaded;
  for (const it of order) if (it.model && it.model !== m) { loads++; if (m) swaps++; m = it.model; }
  return { order, swaps, loads };
}
/** "never load Juli for one app while more questions for the same model are about to be due": ms the head of the order should wait (0 =
 *  go now). Never for a High or starving check, nor when its model is already loaded, nor twice for the same check (waited) */
export function batchWait(head, upcoming, now, loaded = null, waited = false) {
  if (!head || !head.model || head.model === loaded || head.starving || head.priority === 'high' || waited) return 0;
  const soon = (upcoming || []).filter((x) => x && x.id !== head.id && x.model === head.model && x.due > now && x.due - now <= SCHED.batchWindowMs);
  return soon.length ? Math.max(...soon.map((x) => x.due)) - now : 0;
}

/** the scheduler's log: what ran, what waited and why, model loads and swaps, calls per source (a ring of SCHED.logMax) */
export function createSchedLog(max = SCHED.logMax, now = () => Date.now()) {
  const L = [];
  const counts = { ran: 0, waited: 0, loads: 0, swaps: 0, unloads: 0, yields: 0, calls: {}, refused: {}, why: {} };
  function push(e) {
    const x = Object.assign({ t: now() }, e);
    L.push(x); if (L.length > max) L.shift();
    if (x.ev === 'ran') counts.ran++;
    if (x.ev === 'wait') { counts.waited++; const w = String(x.why || '').split(':')[0].slice(0, 40); counts.why[w] = (counts.why[w] || 0) + 1; }
    if (x.ev === 'load') { counts.loads++; if (x.swap) counts.swaps++; }
    if (x.ev === 'unload') counts.unloads++;
    if (x.ev === 'yield') counts.yields++;
    if (x.ev === 'call' && x.source) counts.calls[x.source] = (counts.calls[x.source] || 0) + 1;
    if (x.ev === 'refused' && x.source) counts.refused[x.source] = (counts.refused[x.source] || 0) + 1;
    return x;
  }
  return { push, list: () => L.slice(), counts: () => JSON.parse(JSON.stringify(counts)), clear() { L.length = 0; } };
}
/** the log as plain lines for Diagnostics: "14:03 ran Token Watch (normal, Juli E2B)" ... */
export function logLines(list, timeFn = (t) => new Date(t).toISOString().slice(11, 16)) {
  return (list || []).map((e) => `${timeFn(e.t)} ${e.ev}${e.app ? ' ' + e.app : ''}${e.model ? ' (' + e.model + ')' : ''}${e.source ? ' ' + e.source : ''}${e.why ? ': ' + e.why : ''}${e.ms ? ` ${Math.round(e.ms)} ms` : ''}`);
}
