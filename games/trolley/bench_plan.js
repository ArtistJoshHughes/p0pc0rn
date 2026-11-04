// bench_plan.js - the Troll-E + Juli phone bench, the pure part (bench.js runs it in the game's page; ui/bench_trolley.js starts it from
// Settings › Benchmark and shows its card). Josh (Nov 1): "Write a phone bench to get some data I think"; "one button click option so
// that it runs the whole bench". One run, every step in a fresh page of its own (a planned reload between steps: the only sure way to
// get a page's GPU memory back on iOS 27), each step's result saved before the next begins. A page the phone ends is DATA: the next page
// records where it ended (afterCrash, with the step's last stage) and the run goes on. At most 15 minutes. No DOM, no storage: node-tested.
// v4 (Josh's iPhone, Nov 1: three page ends in a row, then Safari stopped reopening the page and the card had nothing to show): the steps
// most likely to end the page (the Bigger brain live) run LAST; a step that ends the page is tried once more later in the run (before
// those), and a step that ends it twice is recorded as such and skipped; one Bigger brain live step that ends the page skips the other;
// on WebKit a step that loads the scene or a model first lets the page before's GPU memory come back (8 s, as the app waits); the time
// the run spends waiting on Safari or in the app is not the run's own; an unfinished run's card shows every step measured so far and
// where and why it stopped, and the run can be continued from its next step.
export const BENCH_KEY = 'p0pc0rn:trolley:bench', BENCH_V = 1;
export const RUN_CAP_S = 14 * 60;   // the run's own time: past this the steps left are "not run (time)"; the card lands within 15 minutes
export const SETTLE_S = 20;         // after a page the phone ended: 20 s for its memory to come back before the next step (not a cool-down)
export const FRESH_S = 8;           // on WebKit, before a step that loads the scene or a model: the page before's GPU memory (the app's, or the
                                    // step before's) comes back late; the app waits the same 8 s after an unload (app.js SETTLE_MS)
export const GAP_S = 45;            // a page that opens later than this after the last word of the page before: the time in between (Safari's
                                    // "A problem repeatedly occurred", a trip to p0pc0rn) is not the run's own
/** every step: name (the card's words), scene (the game's 3D scene loaded), juli ({ model, at }: her model live beside the game, its
 *  first `at` layers in the second process), needs (what the phone must have), eta (s) */
export const STEPS = {
  info: { name: 'This phone', scene: false, eta: 4 },
  game: { name: 'The game alone', scene: true, eta: 45 },
  // v4 (Nov 3): the game's layout again with her prompt kept in her helper (the engine's prefix snapshot): off and on side by side
  'e2b-21s': { name: 'Game + Juli · layers 0-20 with her prompt kept (the snapshot on)', scene: true, juli: { model: 'e2b', at: 21, snap: true }, needs: ['e2b', 'split'], eta: 44 },
  'e2b-35': { name: 'Game + Juli · all 35 layers in the helper', scene: true, juli: { model: 'e2b', at: 35 }, needs: ['e2b', 'split'], eta: 44 },
  'e2b-29': { name: 'Game + Juli · layers 0-28 in the helper', scene: true, juli: { model: 'e2b', at: 29 }, needs: ['e2b', 'split'], eta: 44 },
  'e2b-21': { name: 'Game + Juli · layers 0-20 in the helper (the game’s layout)', scene: true, juli: { model: 'e2b', at: 21 }, needs: ['e2b', 'split'], eta: 44 },
  'e2b-13': { name: 'Game + Juli · today’s split (layers 0-12 in the helper)', scene: true, juli: { model: 'e2b', at: 13 }, needs: ['e2b', 'split'], eta: 44 },
  // v4 (Josh: "one mini game like stacking physical trash against Juli"): the stack game with her live on the best layout, a01 placing
  stack: { name: 'The stack game · a01 stacks 3 cans while Juli’s tools (live, the game’s layout) try to topple them', scene: true, juli: { model: 'e2b', at: 'game' }, needs: ['e2b', 'split'], eta: 75 },
  // v4 (Nov 3; Josh: "Just crashed as soon as the store opened for me to buy a battery upgrade"): a01 drives onto the dock's charger and
  // the store opens by itself, with Juli live on the game's layout; the page's and her helper's memory each second after it opens
  store: { name: 'The dock’s store opening (a01 parked on the charger) with Juli live (the game’s layout)', scene: true, juli: { model: 'e2b', at: 'game' }, needs: ['e2b', 'split'], eta: 40 },
  // v4 (Josh: the Bigger brain "Like inside a loading screen"): it plots her shift with no scene loaded, then a fresh page plays it out
  plot: { name: 'The Bigger brain plots her shift in the loading screen (no scene)', scene: false, needs: ['e4b', 'split'], eta: 50 },
  'plot-play': { name: 'Level 1 with her plan (the reload, the game, her planned moves)', scene: true, needs: ['e4b', 'split', 'plan'], eta: 55 },
  headroom: { name: 'Headroom · the game’s layout, then page ballast in 64 MB steps until something ends', scene: true, juli: { model: 'e2b', at: 'game' }, needs: ['e2b', 'split'], eta: 80 },
  voice: { name: 'Juli’s voice · 12 of her lines synthesised (CMU Flite, cmu_us_slt, in its Worker)', scene: false, eta: 8 },
};
/** v4 (Nov 3, Josh: "Big brain brains before it loads on all. In V1 of troll-e"): the Bigger brain only plans her shift in the loading
 *  screen; it never plays live beside the game, so the bench no longer loads it there. A run saved before keeps its lines: these names
 *  are its card's (its steps not run yet are not run now) */
export const RETIRED = {
  'e4b-24': { name: 'Game + the Bigger brain live · its usual split (helper layers 0-23)' },
  'e4b-25': { name: 'Game + the Bigger brain live · most in the helper (layers 0-24)' },
};
/** a step's own words, a retired one's too */
export const stepName = (id) => (STEPS[id] || RETIRED[id] || { name: id }).name;
// v4 (Nov 2): the game's own layout (0-20) first of her layouts: its numbers are the ones the game lives by. v4 (Nov 3): headroom LAST
// (it ends something on purpose; on Josh's phone its page end was the one Safari did not reopen), the voice (no GPU) before it
// (v4, Nov 3: the snapshot's step BEFORE the plain one: on Josh's phone the second of the two ran slower, and a phone warms as it runs)
export const ORDER = ['info', 'game', 'e2b-21s', 'e2b-21', 'e2b-35', 'e2b-29', 'e2b-13', 'stack', 'store', 'plot', 'plot-play', 'voice', 'headroom'];
/** v4 (Nov 3): the Bigger brain first (a one-off order from Settings): its plot on a fresh page before any of Juli's steps, to learn whether
 *  it loads at all on the phone; the rest as usual */
export const ORDER_E4B_FIRST = ['info', 'plot', 'plot-play', ...ORDER.filter((id) => !['info', 'plot', 'plot-play'].includes(id))];
/** v4 (Nov 3): does a layout fit beside the game? main.js's page budget: the ceiling less WebKit's share, her page share on that layout
 *  (juli_link.js GAME_PAGE_MB), the margin and the game's own measured memory (its 'game' step; Safari's JS heap guessed) */
export const FIT = { ceilingMB: 1856, webkitMB: 192, marginMB: 150, heapGuessMB: 100, pageMB: { 35: 315, 29: 584, 21: 932, 13: 1265 } };
export function fitsBeside(at, res = {}) {
  const g = res.game && !res.game.afterCrash && res.game.mem, share = FIT.pageMB[at];
  if (!g || !share) return { ok: true };
  // (the JS heap always as main.js's guess: Chrome's own reading counts garbage not yet collected; Safari gives none)
  const game = g.totalMB - (g.heapMB || 0) + FIT.heapGuessMB, need = game + share + FIT.webkitMB + FIT.marginMB;
  return { ok: need <= FIT.ceilingMB, game, share, need };
}
// v4 (Nov 3: Josh's phone, iOS 27.0.1: "THE PAGE ENDED (at loading the Bigger brain 80%, 21 s in; the helper before: plot's ? MB, closed
// 3 s before; its close confirmed in 157 ms)"): a closed model's GPU memory comes back late on WebKit even when its second process's end
// is confirmed, a reload is the same process, and the Bigger brain's is the biggest (3.8's lesson: never a big model again right after
// one). After its helper closed (the plot or its live steps), or after a page the phone ended, a step that loads a model starts
// BIG_SETTLE_S after it at the earliest. That wait is the phone's, not the run's own: it is not counted in its 14 minutes
export const BIG_SETTLE_S = 60;
/** v4 (Nov 3: Josh's phone, twice: right after a page end, headroom's helper ended at her second turn even after a 59 s wait, on the
 *  layout that lived in every step before): headroom measures the room a healthy page has; right after the page before it ended, it is
 *  not run (the run says why) -> why, or null */
export function afterEndSkip(id, st) {
  if (id !== 'headroom' || !st || !st.pageEndAt) return null;
  return 'the page before it ended: right after a page end the phone’s memory is not a fair reading of the room (her helper ended at her second turn there on Josh’s phone, twice)';
}
/** the step that closed this helper ran the Bigger brain */
export const bigClose = (h) => !!h && (h.step === 'plot' || /^e4b-/.test(String(h.step)));
export const GONE_SETTLE_S = 40, GONE_SETTLE_E4B_S = 60;   // (the Bigger brain's load is the biggest: 60 s)   // v4 (Nov 3): after a step whose helper ended: its GPU memory comes back late (the plot failed at once after one)
const WHY = { e2b: 'Juli is not downloaded (Settings › Models)', e4b: 'Bigger brain not downloaded', split: 'no second process on this phone (needs iOS 27 Safari)', plan: 'no plan from the step before' };
/** a step that needs another's result: tried again after it (her plan needs the plot) */
const AFTER = { 'plot-play': 'plot' };
/** turns per Juli step and the time they may take (s); the bench's limit per answer (ms) and the game's (JULI.timeout) */
export const TURNS = { n: 6, capS: { e2b: 35, e4b: 45 }, timeoutMs: { e2b: 15000, e4b: 30000 }, gameMs: 3000 };   // (v4: 6 turns since Nov 3, shorter caps: the run with the stack game, the store, the plot and the voice stays inside 15 minutes)
export const BALLAST = { stepMB: 64, maxMB: 2560, pauseMs: 1200 };

/** a step whose page end gets one more try later in the run: not headroom (its page end is its reading), not the Bigger brain live (one
 *  page end there skips the other) */
export const retryable = (id) => !!STEPS[id] && id !== 'headroom';
/** the steps that always run last, in this order: the Bigger brain live, then headroom (v4, Nov 3) */
const lastOne = (id) => id === 'headroom';
/** a step that loads the scene or a model: on WebKit it lets the page before's GPU memory come back first. Not her plan in play: it
 *  times the game's own loading-screen path (the plot, the reload, the game) as the game runs it */
export const needsFresh = (id) => !!STEPS[id] && id !== 'plot-play' && (!!STEPS[id].scene || !!STEPS[id].juli || id === 'plot');
const queue = (st) => (Array.isArray(st.q) ? st.q : st.steps);
const clone = (o) => JSON.parse(JSON.stringify(o));

/** a new run's state. steps: the card's order (each step once); q: the run's order (a step tried again appears twice); i: the next in q */
export function newRun({ nonce = '', now = Date.now(), app = '', device = '', order = ORDER } = {}) {
  const o = Array.isArray(order) && order.length ? order.filter((id) => STEPS[id]) : ORDER;
  return { v: BENCH_V, nonce: String(nonce), startedAt: now, lastAt: now, pausedMs: 0, i: 0, steps: o.slice(), q: o.slice(), cur: null, res: {}, env: null, crashes: 0, done: false, app, device };
}
/** what this page does with the run it finds -> { act: 'none' | 'show' (done: the card) | 'step', st (updated), crashed (a step's id
 *  the page before ended in), settle (s to wait first) }. `cur` is the step a page began: planned = the page before handed over on
 *  purpose (a reload between steps); not planned = the phone ended that page (afterCrash). cont: Continue from the app (Settings ›
 *  Benchmark): the steps left are put in this version's order (a run from an older version gets its new steps too) */
export function resume(st, now = Date.now(), { cont = false } = {}) {
  if (!st || st.v !== BENCH_V) return { act: 'none', st: null };
  if (st.done) return { act: 'show', st };
  const s = clone(st); let crashed = null, settle = 0;
  if (!Array.isArray(s.q)) s.q = s.steps.slice();   // a run from before the queue (v4's first bench): its run order was its card's
  // v4 (Nov 2: Josh's runs stalled on step 6): a handover opened twice = the page before ended as it opened, before its step began;
  // that is the step's page end (never the same step again and again until Safari gives up)
  if (s.cur && s.cur.planned && (+s.cur.opened || 0) >= 2) Object.assign(s.cur, { planned: false, stage: 'its page opening (before the step began)' });
  // the time since the page before last wrote: past GAP_S it was Safari's crash screen or the app, not the run
  const last = Math.max(+s.lastAt || 0, (s.cur && +s.cur.at) || 0, (s.cur && +s.cur.t0) || 0);
  if (last && now - last > GAP_S * 1000) s.pausedMs = (+s.pausedMs || 0) + (now - last - GAP_S * 1000);
  if (s.cur && !s.cur.planned) {
    const id = s.cur.id, k = Number.isInteger(s.cur.k) ? s.cur.k : s.q.indexOf(id), prev = s.res[id] || {};
    const endT = s.cur.at || now, end = { stage: s.cur.stage || 'start', at: s.cur.at || null, s: s.cur.t0 ? Math.max(0, Math.round((endT - s.cur.t0) / 1000)) : null };
    if (s.cur.note) end.note = s.cur.note;
    const n = (+prev.ends || 0) + 1;
    s.res[id] = Object.assign({}, prev, { afterCrash: end, ends: n });
    delete s.res[id].queued;
    s.crashes = (+s.crashes || 0) + 1; s.i = Math.max(s.i, k + 1); crashed = id; settle = SETTLE_S; s.pageEndAt = endT;   // (v4: the next model step waits BIG_SETTLE_S after it)
    if (n === 1 && retryable(id)) {   // one more try later: before the Bigger brain live; a step that needs this one's result goes after it
      const pend = s.q.slice(s.i), deps = pend.filter((x) => AFTER[x] === id), rest = pend.filter((x) => !deps.includes(x));
      const at = rest.findIndex(lastOne); rest.splice(at < 0 ? rest.length : at, 0, id, ...deps);
      s.q = s.q.slice(0, s.i).concat(rest); s.res[id].queued = true;
    }
  }
  s.cur = null;
  // v4 (Nov 3): the last Continue's page ended before its step began (nothing of it was saved): that step's page end, never offered again
  if (s.contTried && s.contTried.opened && !s.contTried.begun && s.q[s.i] === s.contTried.id) {
    const id = s.contTried.id, prev = s.res[id] || {};
    s.res[id] = Object.assign({}, prev, { afterCrash: { stage: 'its page opening (after Continue)', at: s.contTried.at || null, s: 0 }, ends: (+prev.ends || 0) + 1 }); delete s.res[id].queued;
    s.crashes = (+s.crashes || 0) + 1; s.i += 1; crashed = crashed || id; settle = SETTLE_S;
  }
  if (cont) {
    const done = s.q.slice(0, s.i), pend = s.q.slice(s.i);
    // (a step that already ended the page in this run is not offered again: Josh's Continue looped on headroom)
    for (const id of pend) if (s.res[id] && s.res[id].queued) { delete s.res[id].queued; s.res[id].noRetry = 'continued without it'; }
    const left = [...new Set(ORDER.filter((id) => !s.res[id] && !done.includes(id) && !pend.includes(id)).concat(pend.filter((id) => !s.res[id])))];
    const fresh = left.filter((id) => !(s.res[id] && s.res[id].queued)), again = left.filter((id) => s.res[id] && s.res[id].queued);
    // the steps not run yet in this version's order, then the second tries, then the Bigger brain live (always last)
    s.q = done.concat(ORDER.filter((id) => fresh.includes(id) && !lastOne(id)), fresh.filter((id) => !ORDER.includes(id)), again, ORDER.filter((id) => fresh.includes(id) && lastOne(id)));
    for (const id of s.q) if (!s.steps.includes(id)) s.steps.push(id);
    s.continued = (+s.continued || 0) + 1;
  }
  if ((now - s.startedAt - (+s.pausedMs || 0)) / 1000 > RUN_CAP_S) {
    for (const id of s.q.slice(s.i)) {
      const r = s.res[id];
      if (!r) s.res[id] = { notRun: 'time (the bench stops at 14 minutes)' };
      else if (r.queued) { delete r.queued; r.noRetry = 'time'; }
    }
    s.i = s.q.length;
  }
  s.lastAt = now;
  if (s.i >= s.q.length) { s.done = true; s.endedAt = now; return { act: 'show', st: s, crashed }; }
  return { act: 'step', st: s, crashed, settle };
}
/** the step a page is about to run: marked so that the page after knows if this one ended in it (k: its place in the run's order). A
 *  step's second try keeps its first page end (firstEnd) */
export function begin(st, id, now = Date.now()) {
  const s = Object.assign({}, st, { cur: { id, k: st.i, t0: now, at: now, stage: 'start', planned: false }, lastAt: now });
  const r = st.res[id];
  if (r && r.afterCrash) s.res = Object.assign({}, st.res, { [id]: { firstEnd: r.afterCrash, ends: r.ends || 1 } });
  return s;
}
/** a step finished: its result kept, the next one handed to a fresh page (planned) */
export function finish(st, id, result, now = Date.now()) {
  const q = queue(st), k = st.cur && st.cur.id === id && Number.isInteger(st.cur.k) ? st.cur.k : q.indexOf(id);
  const s = Object.assign({}, st, { res: Object.assign({}, st.res, { [id]: Object.assign({}, st.res[id] || {}, result, { s: st.cur && st.cur.t0 ? Math.round((now - st.cur.t0) / 1000) : (result && result.s) || null }) }) });
  s.i = Math.max(st.i, k + 1); s.lastAt = now;
  s.cur = s.i < q.length ? { id: q[s.i], k: s.i, planned: true, t0: now, at: now } : null;
  if (s.i >= q.length) { s.done = true; s.endedAt = now; s.cur = null; }
  return s;
}
/** why a step cannot run on this phone (null = it can), from the info step's env { e2b, e4b, split } and the results so far */
export function skipWhy(id, env, res = {}) {
  const S = STEPS[id]; if (!S) return RETIRED[id] ? 'not in this version: the Bigger brain only plans her shift (Troll-E v1)' : 'not in this version';
  if (S.needs && env) for (const n of S.needs) if (n === 'plan' ? !(res.plot && res.plot.ok) : !env[n]) return WHY[n] || n;
  if (S.juli && S.juli.model === 'e2b' && typeof S.juli.at === 'number') {   // v4 (Nov 3): a layout that can't fit beside the game is not tried
    const f = fitsBeside(S.juli.at, res);
    if (!f.ok) return `doesn't fit beside the game (the game ${f.game} + her page share ${f.share} + WebKit ${FIT.webkitMB} + ${FIT.marginMB} margin = ${f.need} MB, over the page's ${FIT.ceilingMB})`;
  }
  if (id === 'plot' || id === 'plot-play') {   // v4 (Nov 3): two times its helper would not start: not loaded again (that ended the page)
    const fails = []; for (const k of ['plot']) { const r = res[k]; if (!r) continue; for (const w of [r.firstWhy, r.why, r.error]) if (w && /SPLIT_RETRY|SPLIT_UNAVAILABLE|init, 30 s|stopped answering/.test(String(w))) fails.push(String(w)); }
    if (fails.length >= 2 && !(res[id] && (res[id].ok || res[id].juli))) return `the Bigger brain's helper wouldn't start (${fails.length} times: ${fails[fails.length - 1].slice(0, 90)})`;
  }
  return null;
}
const livedJuli = (r) => !!(r && !r.afterCrash && !r.notRun && !r.error && r.juli && r.juli.helperAlive && r.juli.t && r.juli.t.turns > 0);
/** the E2B step with the most layers in the helper whose page and helper both lived */
export function bestLayout(res = {}) {
  for (const id of ['e2b-35', 'e2b-29', 'e2b-21', 'e2b-13']) if (livedJuli(res[id])) return STEPS[id].juli.at;
  return null;
}
/** v4 (Nov 2): the game's own layout (juli_link.js GAME_SPLIT.e2b: layers 0-20 in the helper) for the stack and headroom steps, if its
 *  step lived; else the best that did */
export const GAME_LAYOUT = 21;
export function gameLayout(res = {}) { return livedJuli(res['e2b-' + GAME_LAYOUT]) ? GAME_LAYOUT : bestLayout(res); }
/** the layout a step runs: a number, 'game' or 'best' */
export const layoutOf = (id, res = {}) => { const a = STEPS[id] && STEPS[id].juli && STEPS[id].juli.at; return a === 'game' ? gameLayout(res) : a === 'best' ? bestLayout(res) : a || null; };
/** where an unfinished run stopped -> { k, of, id, name, why } (null for a finished one) */
export function whereStopped(st) {
  if (!st || st.done) return null;
  const q = queue(st), c = st.cur, name = stepName;
  if (c && c.id) {
    const k = (Number.isInteger(c.k) ? c.k : q.indexOf(c.id)) + 1, s = c.at && c.t0 ? Math.max(0, Math.round((c.at - c.t0) / 1000)) : null;
    return { k, of: q.length, id: c.id, name: name(c.id), why: c.planned ? `step ${k} of ${q.length} (“${name(c.id)}”) was next, and its page never opened`
      : `the page ended in step ${k} of ${q.length} (“${name(c.id)}”) at ${c.stage || 'its start'}${s != null ? `, ${s} s in` : ''}, and the bench’s page did not open again` };
  }
  const id = q[st.i];
  return { k: st.i + 1, of: q.length, id, name: name(id), why: `it stopped between steps (step ${st.i + 1} of ${q.length}, “${name(id)}”, next)` };
}
/** Continue from the app: the step it goes on with -> { k, of, id, name } (null: nothing left, the card only) */
export function continueAt(st, now = Date.now()) {
  const r = resume(st, now, { cont: true });
  if (r.act !== 'step') return null;
  const q = r.st.q, id = q[r.st.i];
  return { k: r.st.i + 1, of: q.length, id, name: stepName(id) };
}
// ------------------------------------------------------------------------------------------------ numbers
export function stats(a) {
  const v = (a || []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))];
  return { n: v.length, med: q(0.5), p90: q(0.9), max: v[v.length - 1], min: v[0] };
}
/** frame times (ms) -> { fps, low1 } (the 1 % low: the frame time at the 99th percentile, as fps) */
export function fpsOf(ft) {
  const a = (ft || []).filter((x) => x > 0); if (a.length < 5) return null;
  const mean = a.reduce((s, x) => s + x, 0) / a.length, b = a.slice().sort((x, y) => y - x);
  return { fps: Math.round(1000 / mean), low1: Math.round(1000 / b[Math.floor(b.length * 0.01)]), frames: a.length };
}
/** a Juli step's turns (juli.js stats.history) -> the card's numbers */
export function turnsOf(hist = [], gameMs = TURNS.gameMs) {
  const H = hist.filter((h) => h && h.ms != null), answered = H.filter((h) => h.out !== 'timeout' && h.out !== 'error');
  const tps = answered.filter((h) => h.tokens > 1 && h.genMs > 0).map((h) => +((h.tokens - 1) / (h.genMs / 1000)).toFixed(1));
  const count = (f) => H.filter(f).length;
  return { turns: H.length, decide: stats(answered.map((h) => h.ms)), underGame: answered.filter((h) => h.ms <= gameMs).length, tokPerS: stats(tps), prefill: stats(answered.map((h) => h.prefillMs)),
    tokens: stats(answered.map((h) => h.tokens)), moves: count((h) => /^move:/.test(h.out)), refused: count((h) => /^refused/.test(h.out)), passes: count((h) => h.out === 'pass' || h.out === 'say'),
    aimed: H.filter((h) => h.aimed).map((h) => h.aimed).slice(0, 3), aimedN: count((h) => !!h.aimed),   // v4: her moves aimed at a01 (moved to the nearest legal point)
    garbled: count((h) => h.out === 'garbled'), timeouts: count((h) => h.out === 'timeout'), errors: H.filter((h) => h.out === 'error').map((h) => h.error).slice(0, 3),
    // v4 (Nov 3): her prompt's kept start (the prefix snapshot): hits, partial hits, misses, and the tokens read in per turn
    prefix: (() => { const S = answered.filter((h) => h.snap); return S.length ? { hit: S.filter((h) => h.snap.hit && !h.snap.partial).length, partial: S.filter((h) => h.snap.partial).length, miss: S.filter((h) => !h.snap.hit && !h.snap.partial).length, readIn: stats(S.map((h) => h.snap.readIn).filter((x) => x != null)) } : null; })(),
    // v4: why her rails refused (the top 3), each with what she wrote (Nov 3: up to 3 different calls)
    why: Object.entries(H.filter((h) => /^refused:/.test(h.out)).reduce((m, h) => { const w = h.out.slice(8), e = m[w] || (m[w] = [0, []]); e[0]++; if (h.wrote && !e[1].includes(h.wrote) && e[1].length < 3) e[1].push(h.wrote); return m; }, {}))
      .map(([w, [n, wrote]]) => [w, n, wrote]).sort((a, b) => b[1] - a[1]).slice(0, 3) };
}
// ------------------------------------------------------------------------------------------------ the card
const s1 = (v) => (v == null ? '?' : (+v).toFixed(1));
const memText = (m) => (m ? `game memory ${m.totalMB} MB (GPU ${m.gpuMB}, images ${m.imagesMB + m.canvasMB}, wasm ${m.wasmMB}${m.heapMB != null ? ', js ' + m.heapMB : ''})` : 'game memory n/a');
const fpsText = (f) => (f ? `${f.fps} fps (1 % low ${f.low1})` : 'fps n/a');
const whereText = (e) => (e && e.stage ? `at ${e.stage}${e.s != null ? `, ${e.s} s in` : ''}${e.note ? `; ${e.note}` : ''}` : '');
/** a page end in words: once, or twice (the step's second try ended it too), and whether it is tried again */
function endText(r) {
  const c = r.afterCrash, w = whereText(c);
  const head = (r.ends || 1) >= 2 && r.firstEnd ? `THE PAGE ENDED (twice: ${w}; the first time ${whereText(r.firstEnd)})` : `THE PAGE ENDED${w ? ` (${w})` : ''}`;
  return head + (r.queued ? ' · tried again later in the run' : r.noRetry ? ` · not tried again (${r.noRetry})` : '');
}
const livedText = (r) => (r.firstEnd ? `page lived on its second try (the first time the page ended ${whereText(r.firstEnd)})` : 'page lived');
/** one step's line(s); done = the run finished (a step never reached is "not run", else "not reached yet") */
export function stepLines(id, r, { done = true } = {}) {
  const S = STEPS[id] || RETIRED[id] || { name: id }, L = [];
  if (!r) return [`${S.name}: ${done ? 'not run' : 'not reached'}`];
  if (r.notRun) return [`${S.name}: ${r.firstEnd ? `the page ended ${whereText(r.firstEnd)}; not tried again: ` : /^doesn't fit|^the Bigger brain's helper wouldn't start/.test(r.notRun) ? 'skipped: ' : 'not run: '}${r.notRun}`];
  if (id === 'info') {
    if (r.afterCrash) return [`This phone: ${endText(r)}`];
    const e = r.env || {};
    return [`This phone: ${e.lowmem ? 'phone memory path' : 'desktop path'} · second process ${e.split ? 'yes' : 'no'}${e.splitWhy ? ' (' + e.splitWhy + ')' : ''} · Juli ${e.e2b ? 'downloaded' : 'not downloaded'}${e.e2bDrafter ? ' + faster replies' : ''} · Bigger brain ${e.e4b ? 'downloaded' : 'not downloaded'}${e.e4bDrafter ? ' + its faster replies' : ''}`];
  }
  const head = `${S.name}:`, scene = r.sceneS != null ? ` · the scene in ${s1(r.sceneS)} s` : '';
  if (id === 'game') {
    L.push(`${head} ${r.afterCrash ? endText(r) : livedText(r)}${scene} · ${fpsText(r.fps)} · ${memText(r.mem)}${r.calls ? ` · ${r.calls} draws, ${Math.round(r.tris / 1000)}k triangles` : ''}`);
    return L;
  }
  const j = r.juli || {}, t = j.t || {};
  const where = j.at ? `page ${j.pageMB != null ? j.pageMB : '?'} MB + helper ${j.helperMB != null ? j.helperMB : '?'} MB` : '';
  const helpersText = (hs) => (hs && hs.length ? `helpers this page knew: ${hs.map((h) => `${h.state} ${h.ageS} s`).join(', ')}` : 'no other helper this page knew');
  if (r.error && !r.afterCrash) return [`${head} did not run: ${r.error}${where ? ' · ' + where : ''}${r.helpersAtFail ? ' · ' + helpersText(r.helpersAtFail) : ''}`];
  if (id === 'voice') {
    if (r.afterCrash) return [`${head} ${endText(r)}`];
    if (r.error) return [`${head} did not run: ${r.error}`];
    return [`${head} ${r.engine || '?'} (${r.mode || '?'}) · ${r.lines} lines = ${s1(r.audioS)} s of speech in ${Math.round(r.synthMs)} ms (${r.msPerSpeechS} ms per second of speech, ${r.realtimeX}× real time; the longest line ${Math.round(r.maxLineMs)} ms, the longest block on the page ${Math.round(r.maxBlockMs)} ms) · its PCM ${s1((r.pcmBytes || 0) / 1048576)} MB${r.heapGrowthMB != null ? `, JS heap +${r.heapGrowthMB} MB` : ''}${r.loadMs != null ? ` · loaded in ${Math.round(r.loadMs)} ms` : ''}`];
  }
  if (id === 'plot') {
    if (r.afterCrash) return [`${head} ${endText(r)}`];
    const ph = r.prevHelper ? `(the helper before: ${r.prevHelper.step}'s, ${r.prevHelper.mb || '?'} MB, closed ${r.prevHelper.agoS} s before${r.prevHelper.endedFirst ? `, it had ended: ${r.prevHelper.endedFirst}` : ''}) ` : '';
    return [`${head} ${ph}${r.goneWaitS ? `(after a ${r.goneWaitS} s wait: the helper before had ended) ` : ''}${r.bigWaitS ? `(after a ${r.bigWaitS} s wait for ${r.bigWhy || 'the memory before'} to come back) ` : ''}${r.retried ? `tried twice (the first: ${r.firstWhy}) · ` : ''}${r.firstEnd ? livedText(r) + ' · ' : ''}${r.ok ? 'a plan' : 'NO PLAN (' + (r.why || 'failed') + (Array.isArray(r.reasons) && r.reasons.length ? ': ' + r.reasons.join('; ') : '') + ')'} · loaded in ${s1(r.loadS)} s (+ ${s1(r.warmS)} s warm-up) · plotted in ${s1(r.plotS)} s (read-in ${s1((r.prefillMs || 0) / 1000)} s, ${r.tokens} tokens at ${s1(r.tokPerS)} tokens/s) · ${r.intents || 0} intents${r.cleaned ? `, ${r.cleaned} cleaned by the schema` : ''}, the schema ${r.ok ? 'passed' : 'failed'}${r.mood ? ' · her mood line kept' : ''}${r.close ? ` · its close ${r.close.ok ? `confirmed in ${r.close.ms} ms` : r.close.why}` : ''}`];
  }
  if (id === 'plot-play') {
    if (r.afterCrash) return [`${head} ${endText(r)}`];
    const p = r.plan || {};
    return [`${head} ${livedText(r)}${scene} · the loading screen ${s1(r.screenS)} s in all (her plot ${s1(r.plotS)} s, then the unload, the reload and the game's start ${s1(r.reloadS)} s) · her plan in play: ${p.fired || 0} of ${p.of || 0} moves fired, ${p.expired || 0} refused for good${p.pending ? `, ${p.pending} still pending` : ''}${p.waiting ? `, ${p.waiting} triggers not reached` : ''} · ${fpsText(r.fps)}${r.mem ? ' · ' + memText(r.mem) : ''}`];
  }
  const parts = [];
  parts.push((r.afterCrash ? endText(r) : livedText(r)) + scene);
  if (r.goneWaitS) parts.push(`after a ${r.goneWaitS} s wait (the helper before had ended)`);
  if (r.bigWaitS) parts.push(`after a ${r.bigWaitS} s wait for ${r.bigWhy || 'the memory before'} to come back`);
  // v4 (Nov 3): the second processes' confirmed ends (8acc293): her load's wait for earlier ones, the ones this page knew, her own close
  if (j.before) parts.push(j.before.timeout ? 'her load: an earlier helper never confirmed its end (15 s)' : j.before.waited ? `her load waited ${j.before.ms} ms for ${j.before.waited} helper(s) to close` : 'her load waited for no helper');
  if (j.helpers) parts.push(helpersText(j.helpers));
  if (j.close) parts.push(j.close.ok ? `her helper's close confirmed in ${j.close.ms} ms` : `her helper's close: ${j.close.why}`);
  if (j.snap) parts.push(j.snap.on ? 'her prompt kept in her helper (the snapshot on)' : j.snap.why === 'off' ? 'the snapshot off' : `the snapshot skipped (${j.snap.why})`);
  if (j.helperAlive != null && !r.afterCrash) parts.push(j.helperAlive ? 'helper alive' : 'HELPER ENDED' + (j.helperWhy ? ` (${j.helperWhy}${r.goneStage ? ', at ' + r.goneStage : ''})` : ''));
  if (id === 'stack' && (j.helperAtStackMB || r.memAtStack)) parts.push(`as the stack game began: helper ${j.helperAtStackMB != null ? j.helperAtStackMB : '?'} MB, ${memText(r.memAtStack)}`);
  if (where) parts.push(where + (j.drafter ? ', drafter on' : ', no drafter'));
  if (j.loadS != null) parts.push(`loaded in ${s1(j.loadS)} s (+ ${s1(j.warmS)} s warm-up)`);
  if (t.tokPerS) parts.push(`${s1(t.tokPerS.med)} tokens/s`);
  if (t.decide) parts.push(`decide ${s1(t.decide.med / 1000)} s median, ${s1(t.decide.p90 / 1000)} s p90, max ${s1(t.decide.max / 1000)} s (${t.underGame} of ${t.turns} within 3 s; the game gives her 3-9 s, measured)`);
  if (t.prefill) parts.push(`read-in ${s1(t.prefill.med / 1000)} s`);
  if (t.prefix) parts.push(`her kept prompt: ${t.prefix.hit} hit, ${t.prefix.partial} partial, ${t.prefix.miss} miss${t.prefix.readIn ? `, ${t.prefix.readIn.med} tokens read in (median)` : ''}${j.warm ? ` (kept at load: ${j.warm.P} tokens in ${s1(j.warm.ms / 1000)} s)` : ''}`);
  if (t.turns != null) parts.push(`${t.turns} turns: ${t.moves} move${t.moves === 1 ? '' : 's'}${t.aimedN ? ` (${t.aimedN} aimed at a01: ${t.aimed.join(', ')})` : ''}, ${t.refused} refused${t.why && t.why.length ? ` (${t.why.map(([w, n, wrote]) => `${w} ×${n}${wrote && wrote.length ? `: she wrote ${wrote.map((x) => `"${x}"`).join(', ')}` : ''}`).join('; ')})` : ''}, ${t.passes} pass${t.passes === 1 ? '' : 'es'}${t.garbled ? `, ${t.garbled} unreadable` : ''}${t.timeouts ? `, ${t.timeouts} over the bench's limit` : ''}${t.errors && t.errors.length ? ` (errors: ${t.errors.join('; ')})` : ''}`);
  if (r.fpsIdle || r.fpsThink) parts.push(`game ${fpsText(r.fpsIdle)} idle, ${fpsText(r.fpsThink)} while she thinks`);
  if (r.mem) parts.push(memText(r.mem));
  if (id === 'stack' && r.stack) {
    const k = r.stack;
    parts.push(`the stack: ${k.placed} of 3 placed${k.missed ? ' (' + k.missed + ')' : ''}, ${k.levels} high (${s1(k.height)} m), ${k.result === 'won' ? 'HELD 5 s: won' : k.result ? k.result + (k.why ? ' (' + k.why + ')' : '') : 'still on'} · her tools: ${k.tools || 0} started, ${k.refused || 0} refused, ${k.toppled || 0} toppled it`);
    if (k.turnLog && k.turnLog.length) parts.push(`her stack turns (time / limit · read-in tokens, kept, s · tokens/s · out): ${k.turnLog.map((x) => `${s1(x.ms / 1000)}/${x.lim ? s1(x.lim / 1000) : '?'} s · ${x.rin != null ? x.rin : '?'}${x.kept != null ? ` (${x.kept} read)` : ''}, ${x.pre != null ? x.pre : '?'} s · ${x.tps != null ? x.tps : '?'} · ${x.out}`).join(' | ')}`);
    if (k.climb && k.climb.length) parts.push(`the climb (s: page MB, helper MB, its last heartbeat): ${k.climb.map((c) => `${c.s}: ${c.page}, ${c.helper}${c.hb != null ? `, ${(c.hb / 1000).toFixed(1)} s` : ''}`).join(' | ')}`);
  }
  if (id === 'store' && r.store) {
    const k = r.store;
    parts.push(`the store: ${k.opened ? `opened (parked ${s1((k.parkedAtMs || 0) / 1000)} s in)` : 'did NOT open'} · page ${k.before} → peak ${k.peak} → ${k.after} MB with it open${k.climb && k.climb.length ? ` (s: page, helper: ${k.climb.map((c) => `${c.s}: ${c.page}, ${c.helper}`).join(' | ')})` : ''} · her turns held while it is open`);
  }
  if (id === 'headroom' && r.ballast) {
    const b = r.ballast, tot = (r.mem ? r.mem.totalMB : 0) + (j.pageMB || 0) + (b.mb || 0);
    parts.push(b.ended === 'helper' ? `the HELPER ended first at page ballast +${b.atMB} MB (page counted ${tot} MB, helper ${j.helperMB} MB)`
      : r.afterCrash ? `the PAGE ended first at page ballast +${b.mb} MB (page counted ${tot} MB: game + Juli's page share + ballast; helper ${j.helperMB} MB)`
        : b.ended === 'cap' ? `nothing ended up to +${b.mb} MB of ballast (page counted ${tot} MB)` : `ballast +${b.mb} MB (${b.ended || 'stopped'})`);
  }
  L.push(`${head} ${parts.join(' · ')}`);
  return L;
}
/** the whole card (Copy puts it on the clipboard) and its one diagnostics line. An unfinished run: where and why it stopped first, then
 *  every step it measured (the page it ended in recorded as the next page would), the steps not reached yet */
export function cardText(st, now = Date.now()) {
  if (!st) return '';
  const w = whereStopped(st), v = st.done ? st : ((resume(st, now).st) || st);
  const L = [`p0pc0rn · Troll-E + Juli bench · ${st.app || ''}`.trim(), st.device || '', new Date(st.startedAt).toLocaleString()];
  if (st.saveFails) L.push(`(this phone's storage was full: ${st.saveFails} of the bench's saves were pruned to fit)`);
  if (w) L.push(`UNFINISHED · ${w.why}${st.lastAt ? ` · its last word at ${new Date(st.lastAt).toLocaleTimeString()}` : ''}`);
  for (const id of v.steps) L.push(...stepLines(id, v.res[id], { done: !w }));
  // v4 (Nov 3): the card's words
  L.push('Words: "over the bench\'s limit" = no answer within the bench\'s wait (Juli 15 s); "unreadable" = her answer was not one JSON call; "refused" = her rails turned the move down (why, and what she wrote); her calls: spawn_trash, bounty, prank, say, pass (a prank\'s kind may stand as the call).');
  L.push(diagLine(v, w));
  return L.filter((x) => x !== '').join('\n');
}
/** one step's code for the diagnostics line: ok, ok2 (lived on its second try), X<stage> (the page ended), XX<stage> (twice), n (not
 *  run), E (an error), H (the helper ended), - (not reached) */
export function stepCode(r) {
  if (!r) return '-';
  if (r.notRun) return r.firstEnd ? 'Xn' : 'n';
  if (r.afterCrash) return ((r.ends || 1) >= 2 ? 'XX' : 'X') + (r.afterCrash.stage || '').slice(0, 12).replace(/\s+/g, '_');
  if (r.error) return 'E';
  if (r.juli && r.juli.helperAlive === false) return 'H';
  return r.firstEnd ? 'ok2' : 'ok';
}
export function diagLine(st, w = null) {
  const e = (st.res.info && st.res.info.env) || {}, mins = st.endedAt ? ((st.endedAt - st.startedAt - (+st.pausedMs || 0)) / 60000).toFixed(1) : '?';
  return `diag: tb${BENCH_V} ${st.steps.map((id) => id + '=' + stepCode(st.res[id])).join(' ')} crashes=${st.crashes || 0} min=${mins}${w ? ` stop=${w.id}@${w.k}` : ''}${st.continued ? ` cont=${st.continued}` : ''} lowmem=${e.lowmem ? 1 : 0} split=${e.split ? 1 : 0} ua=${String(e.ua || '').replace(/[^A-Za-z0-9._/() -]/g, '').slice(0, 90)}`;
}
/** the plan's words for the start sheet: each step a line, its time, and the total */
export function planLines() {
  return ORDER.map((id) => `${STEPS[id].name} · ~${STEPS[id].eta < 90 ? STEPS[id].eta + ' s' : Math.round(STEPS[id].eta / 60) + ' min'}`);
}
/** the run's time: the steps, and on WebKit the settle before each step that loads the scene or a model */
export const ETA_S = ORDER.reduce((s, id) => s + STEPS[id].eta, 0) + ORDER.filter(needsFresh).length * FRESH_S;
