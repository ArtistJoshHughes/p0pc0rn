// schedbench.js - p0pc0rn v4: the scheduler bench's MIX and its runner (Josh, Nov 1: "Need to bench the scheduler today"; "auto tune bench
// plus no real APIs so it can work as fast as the tok/s allow. Wall clock means nothing so long as we can bench"). Pure: no DOM, no
// network. One runner for both benches:
//   - tools/schedsim.mjs (node): a fake model with fixed load and answer times;
//   - schedbench.html (a browser, the real Juli and the real Bigger brain through the engine): engine.ask() runs real inference and the
//     time it really took is added to the VIRTUAL clock; nothing else takes real time (sources are fixtures, waits are virtual).
// The mix: 12 apps for 3 hours (Wallet Watch, Token Watch watching closely with its Bigger brain name references, Trip Watch, six
// person-made apps on CoinGecko, DEX Screener and the National Weather Service, three of them Low, one more on the Bigger brain), the person chatting
// about every 10 minutes and one picture render. Two policies on the same mix: 'sched' (makeapp/scheduler.js: priority, starvation,
// batches by model, the batch hold, a refused request waits for its window) and 'naive' (3.9's tick: install order, a check stops the
// tick when Juli is still held from the one before, a refused request is simply lost).
// Each source's requests go through budget.js's real caps (createBudget, on the virtual clock), so a refused request is counted the way
// the phone refuses it.
import { SCHED, rankDue, batchByModel, batchWait } from './scheduler.js';
import { createBudget, SNOWTRACE_CAP, DEXSCREENER_CAP, GECKOTERMINAL_CAP, GOPLUS_CAP, NWS_CAP, COINGECKO_CAP, WFIGS_CAP } from './budget.js';

export const CAPS = { snowtrace: SNOWTRACE_CAP, dexscreener: DEXSCREENER_CAP, geckoterminal: GECKOTERMINAL_CAP, goplus: GOPLUS_CAP, nws: NWS_CAP, coingecko: COINGECKO_CAP, wfigs: WFIGS_CAP,
  wikipedia: { key: 'wikipedia', name: 'Wikipedia', perSec: 1, perMin: 10, perHour: 120, perDay: 1000, perApp: 0 }, fandom: { key: 'fandom', name: 'Fandom', perSec: 1, perMin: 10, perHour: 120, perDay: 1000, perApp: 0 } };
/** the 12 apps: every (minutes), priority, requests per check by source, Juli's questions per check (e2b) and how often there is news
 *  (p), the Bigger brain's (big) questions and lookups when its own switch is on, boost = it says it is active (watching closely) */
export const MIX = {
  hours: 3, chatEveryMin: 10, chatJitterMin: 3, render: { atMin: 47, ms: 95e3, model: 'flux' },
  apps: [
    { id: 'wallet-watch', name: 'Wallet Watch', every: 15, priority: 'normal', idleOnly: true, req: { snowtrace: 16 }, asks: 1, p: 0.35 },
    { id: 'token-watch', name: 'Token Watch (watching closely)', every: 15, priority: 'normal', boost: true, req: { dexscreener: 8, geckoterminal: 1, goplus: 1 }, asks: 2, p: 0.45,
      big: { asks: 1, p: 0.5, lookups: { wikipedia: 1, fandom: 1 } } },
    { id: 'trip-watch', name: 'Trip Watch', every: 90, priority: 'normal', req: { nws: 3 }, asks: 1, p: 0.6 },
    { id: 'coin-board', name: 'Coin Board (yours)', every: 15, priority: 'normal', req: { coingecko: 1 }, asks: 1, p: 0.4 },
    { id: 'coin-alarm', name: 'Coin Alarm (yours)', every: 20, priority: 'high', req: { coingecko: 1 }, asks: 0, p: 0 },
    { id: 'dex-hot', name: 'Dex Hot (yours)', every: 15, priority: 'normal', req: { dexscreener: 3 }, asks: 1, p: 0.5 },
    { id: 'pair-lore', name: 'Pair Lore (yours)', every: 30, priority: 'normal', req: { dexscreener: 2 }, asks: 1, p: 0.3, big: { asks: 1, p: 0.6, lookups: { wikipedia: 1 } } },
    { id: 'garden-rain', name: 'Garden Rain (yours)', every: 30, priority: 'normal', req: { nws: 1 }, asks: 1, p: 0.5 },
    { id: 'run-weather', name: 'Run Weather (yours)', every: 60, priority: 'low', req: { nws: 1 }, asks: 1, p: 0.5 },
    { id: 'weather-alerts', name: 'Weather Alerts', every: 90, priority: 'low', req: { nws: 1 }, asks: 0, p: 0 },
    { id: 'wildfire-watch', name: 'Wildfire Watch', every: 90, priority: 'low', req: { wfigs: 1 }, asks: 0, p: 0 },
    { id: 'market-mood', name: 'Market Mood (yours)', every: 30, priority: 'normal', req: { coingecko: 1 }, asks: 1, p: 0.5 },
  ],
};
/** the fake model (node): load and answer times; the browser bench passes the real engine */
export const FAKE = { loadMs: { e2b: 6500, big: 15000, flux: 9000 }, askMs: { e2b: 3400, big: 8200 }, chatMs: 7000, unloadMs: 600, settleMs: 2500, reqMs: 260 };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pct = (l, p) => { if (!l.length) return 0; const s = l.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

/** run the mix -> the result. o = {policy: 'sched' | 'naive', mix, seed, t0, engine: {load(model) -> ms, ask(model, kind) -> ms (async,
 *  the real one runs inference), unload(model) -> ms}, onStep(state) (the browser bench's partial result), bigOn (the Bigger brain's
 *  switch in its apps; default true), bigUsable}.
 *  Models as the app's queue holds them (EngineHost): ONE on the GPU at a time. A model leaves when its hold runs out (engine.unload is
 *  called then, not only when another loads), and the other one loads only after it left. An engine call that fails is recorded
 *  (failures) and the mix goes on without that answer; one that throws code ABORT (the GPU was lost, a call never returned, failures in
 *  a row) ends the mix: the result so far comes back with `aborted` (never a hang) */
export async function runMix(o = {}) {
  const mix = o.mix || MIX, policy = o.policy === 'naive' ? 'naive' : 'sched', R = rng(o.seed || 7), t0 = o.t0 || Date.UTC(2026, 10, 1, 15, 0, 0);
  const E = o.engine || fakeEngine(), end = t0 + mix.hours * 3600e3, bigOn = o.bigOn !== false, bigUsable = o.bigUsable !== false;
  let t = t0, loaded = null, holdUntil = 0;
  const clock = () => t;
  const budgets = {}; for (const [k, C] of Object.entries(CAPS)) budgets[k] = createBudget(C, { store: null, now: clock });
  const apps = mix.apps.map((a, i) => Object.assign({}, a, { order: i, next: t0 + 8000 + i * 1000, last: 0, runs: 0, gaps: [], late: [] }));
  // the person: a chat about every 10 minutes (jittered), one render
  const person = [];
  for (let m = 4; m < mix.hours * 60; m += mix.chatEveryMin) person.push({ kind: 'chat', at: t0 + (m + (R() - 0.5) * 2 * mix.chatJitterMin) * 60e3 });
  if (mix.render) person.push({ kind: 'render', at: t0 + mix.render.atMin * 60e3 });
  person.sort((a, b) => a.at - b.at);
  const S = { loads: { e2b: 0, big: 0, flux: 0 }, swaps: 0, asks: { e2b: 0, big: 0 }, cancelled: 0, chatWait: [], renderWait: [], calls: {}, refused: {}, lost: 0, deferred: 0, bigWaits: 0, waits: 0, checks: 0, inferMs: 0, loadMs: 0, appLoads: { e2b: 0, big: 0 }, failures: [] };
  let aborted = null;
  /** an engine call that failed: kept in the result (once), with the virtual minute */
  function fail(phase, model, e) {
    if (e && e.recorded) return; if (e && typeof e === 'object') e.recorded = true;
    S.failures.push({ phase, model, code: String((e && e.code) || ''), error: String((e && e.message) || e).slice(0, 200), atMin: Math.round((t - t0) / 60e3) });
  }
  for (const k of Object.keys(CAPS)) { S.calls[k] = []; S.refused[k] = 0; }
  const nextPerson = () => person.find((x) => !x.done);
  // ---- the model, as the app's queue: ONE on the GPU at a time; it stays for its hold, then it leaves (the engine unloads it)
  async function release() { const m = loaded; loaded = null; if (m && m !== 'flux') { try { t += await E.unload(m); } catch (e) { fail('unload', m, e); if (e && e.code === 'ABORT') throw e; } } }
  async function expireHold() { if (loaded && loaded !== 'flux' && t >= holdUntil) await release(); }   // the hold ran out: the model left
  async function use(model, who = 'app') {
    await expireHold();
    if (loaded === model) return;
    const t1 = t;
    if (loaded) { await release(); S.swaps++; t += FAKE.settleMs; }   // a swap: one model leaves, its memory comes back, then the other loads
    try { t += await E.load(model); } catch (e) { loaded = null; fail('load', model, e); throw e; }
    S.loads[model] = (S.loads[model] || 0) + 1; loaded = model; S.loadMs += t - t1; if (who === 'app') S.appLoads[model] = (S.appLoads[model] || 0) + 1;
  }
  /** one question; the person's job that arrives while it runs cancels it (every check's question in v4; 3.9: only an idle-only app's) */
  async function ask(model, a) {
    const p = nextPerson(); if (p && p.at <= t) await servePerson();
    const s0 = t; let ms;
    try { await use(model); ms = await E.ask(model, a.id); }
    catch (e) { fail('ask', model, e); loaded = null; if (e && e.code === 'ABORT') throw e; return false; }   // the engine dropped its model: no answer, the mix goes on
    t += ms; S.inferMs += ms;
    const q = nextPerson();
    if (q && q.at > s0 && q.at < t && (policy === 'sched' || a.idleOnly)) { t = q.at; S.cancelled++; await servePerson(); return false; }
    S.asks[model]++; return true;
  }
  // ---- the person's jobs first: whatever arrived by now runs now (a check's question to Juli was cancelled for it)
  async function servePerson() {
    let p = nextPerson();
    while (p && p.at <= t) {
      p.done = true;
      try {
        if (p.kind === 'chat') { S.chatWait.push(Math.max(0, t - p.at)); await use('e2b', 'person'); t += E.chat ? await E.chat() : FAKE.chatMs; holdUntil = t + 5000; }
        else { S.renderWait.push(Math.max(0, t - p.at)); await use(mix.render.model, 'person'); t += mix.render.ms; loaded = null; t += FAKE.settleMs; }
      } catch (e) { fail(p.kind, p.kind === 'chat' ? 'e2b' : mix.render.model, e); loaded = null; if (e && e.code === 'ABORT') throw e; }
      p = nextPerson();
    }
  }
  // ---- one request through its source's cap (paced like the fetcher: it waits at most 1.5 s for the next token)
  function request(src, appId) {
    const B = budgets[src]; let r = B.take(appId);
    if (!r.ok && r.code === 'RATE_LIMIT' && r.waitMs <= 1500) { t += r.waitMs; r = B.take(appId); }
    if (!r.ok) { S.refused[src]++; return r; }
    S.calls[src].push(t); t += FAKE.reqMs; return r;
  }
  // ---- one check: its requests, then its questions (e2b; the Bigger brain's when its switch is on), each yielding to the person
  async function check(a, batchNext) {
    const start = t; S.checks++;
    a.late.push(Math.max(0, start - a.due)); if (a.last) a.gaps.push(start - a.last); a.last = start; a.runs++;
    let refused = null;
    for (const [src, n] of Object.entries(a.req || {})) for (let i = 0; i < n && !refused; i++) { await servePerson(); const r = request(src, a.id); if (!r.ok) refused = r; }   // the person's chat runs beside the check's requests (the queue)
    const news = R() < (a.p || 0) && !refused;
    if (news) for (let i = 0; i < (a.asks || 0); i++) if (!(await ask('e2b', a))) break;
    if (a.big && bigOn && R() < a.big.p && !refused) {
      if (!bigUsable) S.bigWaits++;   // its second process can't start: the job waits and says why (never E2B)
      else { for (const [src, n] of Object.entries(a.big.lookups || {})) for (let i = 0; i < n; i++) request(src, a.id); await ask('big', a); }
    }
    if (loaded === 'e2b' || loaded === 'big') holdUntil = t + (policy === 'sched' && batchNext === loaded ? SCHED.batchHoldMs : 5000);
    // the next check: its interval; a refused request (sched): again when the window opens, not sooner than a minute (naive: lost)
    a.next = t + a.every * 60e3;
    if (refused) { if (policy === 'sched' && refused.until) { a.next = Math.min(a.next, Math.max(refused.until + 1000, t + 60e3)); S.deferred++; } else S.lost++; }
    return t - start;
  }
  // ---- the ticks (every minute, as the host's), until the 3 hours are over
  let tickAt = t0 + 8000, lastStep = 0;
  try { while (tickAt < end) {
    for (let p = nextPerson(); p && p.at < tickAt; p = nextPerson()) { if (t < p.at) t = p.at; await servePerson(); }   // idle: the person's job runs when it arrives
    if (t < tickAt) t = tickAt;
    await servePerson(); await expireHold();
    const busy = loaded === 'flux';
    const due = apps.filter((a) => a.next <= t);
    if (!busy && due.length) {
      for (const a of due) if (a.due == null || a.due < a.next - 1) a.due = a.next;
      let order;
      if (policy === 'naive') order = due.slice().sort((x, y) => x.order - y.order).map((a) => ({ app: a, model: a.asks ? 'e2b' : null }));
      else {
        const item = (a) => ({ id: a.id, app: a, due: a.next, everyMs: a.every * 60e3, lastRun: a.last, priority: a.priority, boost: !!a.boost, model: a.big && bigOn ? 'big' : a.asks ? 'e2b' : null });
        const b = batchByModel(rankDue(due.map(item), t), loaded === 'e2b' || loaded === 'big' ? loaded : null);
        order = b.order;
        const head = order[0];
        if (head && head.model) {
          const soon = apps.filter((a) => !due.includes(a)).map(item);
          const w = batchWait(head, soon, t, loaded, head.app.waitedAt && t - head.app.waitedAt < 3 * SCHED.batchWindowMs);
          if (w > 0) { head.app.waitedAt = t; S.waits++; order = order.filter((x) => x.model !== head.model); }
        }
      }
      const tickStart = t;
      for (let i = 0; i < order.length; i++) {
        const x = order[i], a = x.app;
        if (policy === 'sched' && t - tickStart > SCHED.tickBudgetMs) break;
        const p = nextPerson(); if (p && p.at <= t) break;   // the person's job came first: the rest go next tick
        if (policy === 'naive' && i > 0 && loaded && t < holdUntil) break;   // 3.9: Juli is still held: "busy", the tick stops
        const nextModel = policy === 'sched' && order[i + 1] ? order[i + 1].model : null;
        await check(a, nextModel);
      }
    }
    tickAt += 60e3;
    if (o.onStep && tickAt - lastStep >= 5 * 60e3) { lastStep = tickAt; try { o.onStep(summarise(), (tickAt - t0) / (end - t0)); } catch (e) { /* */ } }
  }
  if (loaded && loaded !== 'flux') await release();   // the end: no model left on the GPU for the next policy
  } catch (e) {   // ABORT (or a bug): what was measured so far, never a hang
    aborted = String((e && e.message) || e).slice(0, 300); fail('mix', loaded || '', e);
    try { if (loaded && loaded !== 'flux') await release(); } catch (x) { /* the engine is gone */ }
  }
  function summarise() {
    const late = [].concat(...apps.map((a) => a.late)).map((x) => x / 1000);
    const byPrio = (p) => [].concat(...apps.filter((a) => a.priority === p).map((a) => a.late)).map((x) => x / 1000);
    const starve = apps.filter((a) => a.priority === 'low').map((a) => ({ app: a.name, every: a.every, maxGapMin: Math.round(Math.max(0, ...a.gaps) / 60e3), runs: a.runs, starved: Math.max(0, ...a.gaps) > 3 * a.every * 60e3 }));
    const peak = {};
    for (const [k, l] of Object.entries(S.calls)) { let m = 0; for (let i = 0, j = 0; i < l.length; i++) { while (l[i] - l[j] >= 60e3) j++; m = Math.max(m, i - j + 1); } peak[k] = { peakPerMin: m, capPerMin: CAPS[k].perMin, total: l.length, refused: S.refused[k] }; }
    const s = (l) => ({ p50: Math.round(pct(l, 0.5)), p95: Math.round(pct(l, 0.95)), max: Math.round(Math.max(0, ...l)) });
    return { policy, hours: mix.hours, checks: S.checks, lateness: s(late), latenessHigh: s(byPrio('high')), latenessNormal: s(byPrio('normal')), latenessLow: s(byPrio('low')),
      starvation: starve, loads: S.loads, appLoads: S.appLoads, swaps: S.swaps, asks: S.asks, cancelledForPerson: S.cancelled, batchWaits: S.waits,
      chatWaitS: s(S.chatWait.map((x) => x / 1000)), renderWaitS: s(S.renderWait.map((x) => x / 1000)), peak, refusedLost: S.lost, refusedDeferred: S.deferred,
      bigWaits: S.bigWaits, inferMs: Math.round(S.inferMs), loadS: Math.round(S.loadMs / 1000), virtualMs: t - t0, failures: S.failures.slice(), aborted };
  }
  return summarise();
}

/** the fake model: fixed times, and the GPU's one rule: a model loaded while another is still in throws (as an 8 GB card runs out) */
export function fakeEngine(f = FAKE) {
  const resident = new Set();
  return { resident,
    load: async (m) => { if (m !== 'flux' && [...resident].some((x) => x !== m)) throw Object.assign(new Error(`two models on the GPU at once (${[...resident].join(', ')} still in, ${m} loading)`), { code: 'OOM' }); if (m !== 'flux') resident.add(m); return f.loadMs[m] || 5000; },
    ask: async (m) => { if (!resident.has(m)) throw Object.assign(new Error(`${m} asked while not loaded`), { code: 'NOT_LOADED' }); return f.askMs[m] || 4000; },
    unload: async (m) => { resident.delete(m); return f.unloadMs; },
    chat: async () => { if (!resident.has('e2b')) throw Object.assign(new Error('chat while Juli is not loaded'), { code: 'NOT_LOADED' }); return f.chatMs; } };
}

const failLine = (x) => (x && (x.failures || []).length ? `${x.failures.length}${x.aborted ? ' (ended: ' + x.aborted + ')' : ''}` : x && x.aborted ? 'ended: ' + x.aborted : '0');
/** a card for what one policy measured (a partial run, or a run that ended early) */
export function cardOne(a, title = 'Scheduler bench (partial)') {
  const r = (x) => `${x.p50} / ${x.p95} / ${x.max}`;
  return `## ${title}\n\n| ${a.policy === 'naive' ? 'naive (3.9 tick)' : 'scheduler (v4)'} | |\n|---|---|\n` + [['Virtual minutes', Math.round(a.virtualMs / 60e3)], ['Checks run', a.checks], ['Lateness, all (s) p50 / p95 / max', r(a.lateness)],
    ['Juli loads for apps (E2B)', a.appLoads.e2b], ['Bigger brain loads (apps)', a.appLoads.big], ['Model swaps', a.swaps], ['Questions answered (E2B / big)', `${a.asks.e2b} / ${a.asks.big}`],
    ['Chat wait (s) p50 / p95 / max', r(a.chatWaitS)], ['Engine failures', failLine(a)]].map((x) => `| ${x[0]} | ${x[1]} |`).join('\n') + '\n';
}
/** the results card (markdown), both policies side by side */
export function card(a, b, title = 'Scheduler bench') {
  const r = (x) => `${x.p50} / ${x.p95} / ${x.max}`;
  const rows = [['Checks run', a.checks, b.checks], ['Lateness, all (s) p50 / p95 / max', r(a.lateness), r(b.lateness)], ['  High', r(a.latenessHigh), r(b.latenessHigh)],
    ['  Normal', r(a.latenessNormal), r(b.latenessNormal)], ['  Low', r(a.latenessLow), r(b.latenessLow)],
    ['Low apps starved (gap > 3x interval)', a.starvation.filter((x) => x.starved).length, b.starvation.filter((x) => x.starved).length],
    ['Longest Low gap (min)', Math.max(...a.starvation.map((x) => x.maxGapMin)), Math.max(...b.starvation.map((x) => x.maxGapMin))],
    ['Juli loads for apps (E2B)', a.appLoads.e2b, b.appLoads.e2b], ['Bigger brain loads (apps)', a.appLoads.big, b.appLoads.big], ['All Juli loads (with your chats)', a.loads.e2b, b.loads.e2b], ['Model swaps', a.swaps, b.swaps], ['Time loading models (s)', a.loadS, b.loadS],
    ['Questions answered (E2B / big)', `${a.asks.e2b} / ${a.asks.big}`, `${b.asks.e2b} / ${b.asks.big}`], ['Batch waits', a.batchWaits, b.batchWaits],
    ['Chat wait (s) p50 / p95 / max', r(a.chatWaitS), r(b.chatWaitS)], ['Render wait (s)', r(a.renderWaitS), r(b.renderWaitS)],
    ['Refused requests: deferred / lost', `${a.refusedDeferred} / ${a.refusedLost}`, `${b.refusedDeferred} / ${b.refusedLost}`], ['Engine failures', failLine(a), failLine(b)]];
  const head = `## ${title}\n\n| | scheduler (v4) | naive (3.9 tick) |\n|---|---|---|\n` + rows.map((x) => `| ${x[0]} | ${x[1]} | ${x[2]} |`).join('\n');
  const peak = '\n\n| Source | peak calls / min (scheduler) | naive | p0pc0rn cap / min | refused (sched / naive) |\n|---|---|---|---|---|\n' +
    Object.keys(a.peak).filter((k) => a.peak[k].total || b.peak[k].total).map((k) => `| ${CAPS[k].name} | ${a.peak[k].peakPerMin} | ${b.peak[k].peakPerMin} | ${CAPS[k].perMin} | ${a.peak[k].refused} / ${b.peak[k].refused} |`).join('\n');
  return head + peak + '\n';
}
