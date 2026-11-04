// bench.js - the Troll-E + Juli phone bench, run by the game's own page (?bench): the real scene, a01 driven round Level 1's hall by a
// pilot with the camera moving (so the draws and textures are play's), and Juli's real model from the app's storage through the real
// split (juli_link.js), at several split points. Each step runs in a fresh page; its result is saved before the next page; a page the
// phone ends is recorded where it ended and the run goes on (bench_plan.js decides). What it measures, per step: the game's FPS and 1 %
// low, its own counted memory (mem_account.js), whether the page and the helper lived, Juli's load time, tokens/s, the time each of ~10
// real mischief turns took to decide (her real prompt, her real state, her moves checked by the real guard rails) and the game's FPS while
// she thinks; then page ballast in 64 MB steps beside the best layout until the page or the helper ends. It never writes or reads anything
// but its own key (p0pc0rn:trolley:bench), the game's own and a row a step in the app's Diagnostics (p0pc0rn:diag); never the agreement.
// Josh starts it from Settings › Benchmark (or continues an unfinished run there). v4 (Nov 1): boot.js runs before() first, so the steps
// with no scene (this phone, the plot, the voice) never load the game's code; main.js is imported only for a step that needs the scene.
import { BENCH_KEY, BENCH_V, ORDER_E4B_FIRST, STEPS, stepName, TURNS, BALLAST, FRESH_S, GONE_SETTLE_S, GONE_SETTLE_E4B_S, BIG_SETTLE_S, bigClose, afterEndSkip, newRun, resume, begin, finish, skipWhy, bestLayout, layoutOf, needsFresh, whereStopped, stepCode, diagLine, fpsOf, turnsOf, cardText } from './bench_plan.js';
import { connectJuli, engineOpts, splitHere, MODELS, WEBKIT } from './juli_link.js';
import { takeBench } from '../../ui/benchnonce.js';   // 4.0 (review): only the app's own bench button starts a run
import { fakeBackend, systemPrompt } from './juli.js';
import { runPlot } from './plot.js';
import { planLists, PLAN_KEY } from './plan.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// v4 (Nov 3): a save that fails (the origin's storage full) is retried after pruning: the bench's own Diagnostics rows, then the run's long logs
const ls = { get: () => { try { return JSON.parse(localStorage.getItem(BENCH_KEY) || 'null'); } catch (e) { return null; } },
  set: (v) => {
    const put = () => { localStorage.setItem(BENCH_KEY, JSON.stringify(v)); return true; };
    try { return put(); } catch (e) { /* full: prune */ }
    try { const rows = JSON.parse(localStorage.getItem('p0pc0rn:diag') || '[]'); localStorage.setItem('p0pc0rn:diag', JSON.stringify((Array.isArray(rows) ? rows : []).filter((r) => !/^bench: Troll-E/.test(String(r && r.step))).slice(-60))); } catch (e) { /* */ }
    try { if (v) v.saveFails = (+v.saveFails || 0) + 1; return put(); } catch (e) { /* still full */ }
    try { for (const r of Object.values((v && v.res) || {})) { if (r && r.stack) { delete r.stack.climb; delete r.stack.turnLog; } if (r && r.plan) delete r.plan.log; } return put(); } catch (e) { return false; }
  } };
const DIAG_KEY = 'p0pc0rn:diag';   // the app's Diagnostics (Settings › About), the rows app.js diag() writes: at most 200, the oldest dropped
/** v4: a row in the app's Diagnostics (a step done, a page that ended, the run's last line), so a run that stops still says how far it got */
function diagRow(step, data = {}) {
  try {
    const d = new Date(), t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
    const rows = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]');
    localStorage.setItem(DIAG_KEY, JSON.stringify((Array.isArray(rows) ? rows : []).concat(Object.assign({ t, step }, data)).slice(-200)));
  } catch (e) { /* diagnostics are best effort */ }
}

/** createBench({ HOME, Q (URLSearchParams), TEST, lowmem }) -> { before() -> 'scene' | 'stop', withScene(api) }  */
export function createBench({ HOME, Q, TEST = false, lowmem = false }) {
  let st = null, wake = null, sceneT0 = null, leave = null, goneWaitS = 0, bigWaitS = 0, bigWhy = null;
  const fake = TEST ? Q.get('julifake') : null;   // the desk: a stand-in model (no real one on a CPU desk)
  // v4: before a step that loads the scene or a model, the page before's GPU memory comes back (WebKit gives it back late); the desk
  // can ask for it with &fresh=<s>
  const fresh = TEST ? Math.max(0, +(Q.get('fresh') || 0)) : WEBKIT ? FRESH_S : 0;
  // v4 (Nov 2): no step waits forever: past this it is recorded as stuck (where) and the run goes on
  const STEP_CAP_S = TEST ? 600 : 240;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // the banner over the game: which step, what it is doing (and where it ended last time)
  const banner = el('div', 'bench-banner'); banner.setAttribute('aria-live', 'polite');
  const say = (t) => { banner.textContent = t; };
  const save = () => { if (st) st.lastAt = Date.now(); ls.set(st); };
  const name = stepName;
  /** the step's stage, kept as it goes: a page that ends says where */
  const stage = (s) => {
    if (st && st.cur) { st.cur.stage = s; st.cur.at = Date.now(); save(); }
    const q = st ? st.q || st.steps : [], k = st && st.cur ? (Number.isInteger(st.cur.k) ? st.cur.k : q.indexOf(st.cur.id)) : -1;
    say(`BENCH · ${k + 1} of ${q.length || '?'} · ${st && st.cur ? name(st.cur.id) : ''} · ${s}`);
  };
  /** v4 (Nov 3): a model's load in tenths, in the step's stage (a page that ends in the load says how far it got) */
  const progress = (who) => { let last = -1; return (p) => { const k = Math.floor(((p && p.frac) || 0) * 10); if (k !== last) { last = k; stage(`loading ${who} ${k * 10}%`); } }; };
  const stepRow = (id) => { const r = st.res[id] || {}; diagRow('bench: Troll-E + Juli · step', { id, out: stepCode(r), s: r.s != null ? r.s : null }); };
  const doneRow = () => diagRow('bench: Troll-E + Juli · finished', { line: diagLine(st) });
  const keepAwake = async () => { try { if (navigator.wakeLock && (!wake || wake.released)) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* the banner asks for a tap */ } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
  addEventListener('pointerdown', keepAwake, { passive: true });
  // a fresh page for the next step (planned); the game's crash breadcrumb goes first (a planned reload is not a page that stopped)
  const next = () => { save(); try { if (leave) leave(); } catch (e) { /* */ } setTimeout(() => location.reload(), 150); };
  function card() {
    for (const id of ['start', 'hud', 'done', 'fail']) { const e = document.getElementById(id); if (e) e.hidden = true; }
    const sh = el('div', 'sheet bench-sheet'), c = el('div', 'card');
    c.append(el('p', 'kicker', 'Settings › Benchmark'), el('h1', '', 'Troll-E + Juli bench'));
    const pre = el('pre', 'bench-text', cardText(st)); c.append(pre);
    const copy = el('button', 'cta', 'Copy'); copy.type = 'button';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(cardText(st)); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Select the text to copy it'; } };
    const back = el('button', 'ghost', 'Back to p0pc0rn'); back.type = 'button'; back.onclick = () => { try { location.replace(HOME); } catch (e) { location.href = HOME; } };
    c.append(copy, back); sh.append(c); document.body.append(sh); banner.remove();
    if (TEST) globalThis.__trolleyBench = { st, text: cardText(st) };
  }
  /** before the scene: start or pick up the run, the steps that need no scene, the settle after a page that ended */
  async function before() {
    document.body.append(banner); keepAwake();
    const n = Q.get('n') || '', old = ls.get(), mode = Q.get('bench'), now = Date.now();
    let cont = false;
    const armed = (mode === 'start' || mode === 'continue') && takeBench(n, { test: TEST });   // 4.0 (review): the bench button's one-time nonce
    if (old && !old.done && old.cur && old.cur.planned) { old.cur.opened = (+old.cur.opened || 0) + 1; ls.set(old); }   // v4: a handover opened (twice = its page ended as it opened)
    if (armed && mode === 'start' && (!old || old.nonce !== n || old.done)) {
      // v4: a new run over an unfinished one: the old one's line goes into Diagnostics first (it is not lost unread)
      if (old && !old.done && old.v === BENCH_V) { const v = resume(old, now).st || old; diagRow('bench: Troll-E + Juli · an unfinished run replaced by a new one', { line: diagLine(v, whereStopped(old)) }); }
      st = newRun({ nonce: n, app: Q.get('v') || 'v4', device: deviceLine(), order: Q.get('order') === 'e4b' ? ORDER_E4B_FIRST : undefined });   // (v4: &order=e4b: the Bigger brain first)
      save();
    } else if (armed && mode === 'continue' && old && !old.done && old.nonce === n) { st = old; cont = true; }   // v4: Continue (Settings › Benchmark)
    else st = mode === 'start' || mode === 'continue' ? null : old;   // 4.0 (review): a start or continue without the button's nonce runs nothing
    // a reload carries on, never starts again (Safari's Reload after "A problem repeatedly occurred" too)
    try { history.replaceState(null, '', location.pathname + '?bench=1' + (TEST ? '&test' + (fake ? '&julifake=' + fake : '') + (lowmem ? '&lowmem' : '') + (fresh ? '&fresh=' + fresh : '') : '')); } catch (e) { /* */ }
    const r = resume(st, Date.now(), { cont });
    if (cont && r.st && r.st.contTried) Object.assign(r.st.contTried, { opened: true, at: Date.now() });   // v4: this Continue's page opened (a page that ends before its step begins is that step's end)
    if (r.act === 'none') { st = null; say('BENCH · no run in progress (start one in Settings › Benchmark)'); return 'stop'; }
    st = r.st; save();
    if (r.crashed) { const c = st.res[r.crashed] || {}, e = c.afterCrash || {}; diagRow('bench: Troll-E + Juli · the page ended', { id: r.crashed, stage: e.stage || null, s: e.s != null ? e.s : null, ends: c.ends || 1, again: !!c.queued }); }
    if (cont) diagRow('bench: Troll-E + Juli · continued', { from: st.q[st.i] || null, k: st.i + 1 });
    if (r.act === 'show') { doneRow(); card(); return 'stop'; }
    let settle = r.settle || 0;
    for (;;) {
      const id = st.q[st.i];
      const why = skipWhy(id, st.env, st.res) || afterEndSkip(id, st) || (STEPS[id] && STEPS[id].juli && typeof STEPS[id].juli.at === 'string' && !layoutOf(id, st.res) ? 'no layout kept both processes alive' : null);
      if (why) { st = finish(begin(st, id), id, { notRun: why }); stepRow(id); if (st.done) { save(); doneRow(); card(); return 'stop'; } continue; }
      st = begin(st, id); if (st.contTried) st.contTried.begun = true; save();   // from here a page that ends is this step's (its settle too: a page that ends there never loops)
      // (v4, Nov 2: the stack game and the plot get twice the settle: on Josh's phone her helper ended in the stack step and was gone for
      // the plot, each after a page that held a helper; both now start from a page that has let go of everything)
      // v4 (Nov 3): a step whose helper ended before this one: a model step waits for its GPU memory to come back (the plot failed at once
      // after the stack step's helper ended on Josh's phone)
      const needModel = !!(STEPS[id].juli || id === 'plot'), goneAgo = st.goneAt ? (Date.now() - st.goneAt) / 1000 : null;
      // (v4, Nov 3: ~10 s instead when the helper before confirmed its end: its memory is back)
      const confirmed = !!(st.lastHelper && st.lastHelper.close && st.lastHelper.close.ok);
      goneWaitS = needModel && goneAgo != null && goneAgo < 180 ? Math.max(0, Math.round((confirmed ? 10 : (id === 'plot' ? GONE_SETTLE_E4B_S : GONE_SETTLE_S)) - goneAgo)) : 0;
      if (TEST) goneWaitS = Math.min(goneWaitS, 1);
      if (needModel) st.goneAt = null;
      // v4 (Nov 3): after the Bigger brain's helper closed, or a page the phone ended: a model step starts BIG_SETTLE_S after it at the
      // earliest (on Josh's phone the Bigger brain live ended the page at 80 % of its load, 3 s after its plot's helper had closed)
      const bigs = [bigClose(st.lastHelper) ? [st.lastHelper.closedAt, `the Bigger brain's memory (${st.lastHelper.step}'s helper closed)`] : null, st.pageEndAt ? [st.pageEndAt, 'the memory of the page that ended'] : null]
        .filter((x) => x && x[0]).sort((a, b) => b[0] - a[0]);
      bigWaitS = needModel && bigs.length ? Math.max(0, Math.round(BIG_SETTLE_S - (Date.now() - bigs[0][0]) / 1000)) : 0; bigWhy = bigWaitS ? bigs[0][1] : null;
      if (TEST) bigWaitS = Math.min(bigWaitS, 1);
      if (needModel) st.pageEndAt = null;
      if (st.cur) {   // (a page that ends says so: the wait, and the helper that went before it)
        const lh = needModel && st.lastHelper ? `the helper before: ${st.lastHelper.step}'s ${st.lastHelper.mb || '?'} MB, closed ${Math.round((Date.now() - st.lastHelper.closedAt) / 1000)} s before${st.lastHelper.endedFirst ? ` (it had ended: ${st.lastHelper.endedFirst})` : ''}` : null;
        const cw = st.lastHelper && st.lastHelper.close ? (st.lastHelper.close.ok ? `its close confirmed in ${st.lastHelper.close.ms} ms` : `its close ${st.lastHelper.close.why}`) : null;
        st.cur.note = [bigWaitS ? `after a ${bigWaitS} s wait for ${bigWhy} to come back` : null, goneWaitS ? `after a ${goneWaitS} s wait (${confirmed ? 'short: the close was confirmed' : 'the full wait'}): the helper before had ended` : null, lh, needModel ? cw : null].filter(Boolean).join('; ') || null;
      }
      const own = Math.max(settle, needsFresh(id) ? fresh * (id === 'stack' || id === 'plot' ? 2 : 1) : 0, goneWaitS), wait = Math.max(own, bigWaitS);
      if (wait > own) st.pausedMs = (+st.pausedMs || 0) + (wait - own) * 1000;   // (the phone's wait, not the run's own time)
      for (let s = wait; s > 0; s--) {
        stage(settle ? `the page ended in “${name(r.crashed)}”: recorded · letting the phone’s memory settle ${s} s` : `letting the page before’s GPU memory come back (settle ${s} s)`);
        await sleep(1000);
      }
      settle = 0;
      if (STEPS[id].scene) { stage('loading the game'); sceneT0 = performance.now(); return 'scene'; }
      stage('reading');
      const work = id === 'info' ? info() : id === 'plot' ? plot() : id === 'voice' ? voiceStep() : Promise.resolve({ error: 'unknown step' });
      const res = await Promise.race([work, sleep(STEP_CAP_S * 1000).then(() => ({ error: `stuck at “${(st.cur && st.cur.stage) || '?'}” for over ${STEP_CAP_S} s` }))]);
      if (goneWaitS && res && typeof res === 'object') res.goneWaitS = goneWaitS;
      if (bigWaitS && res && typeof res === 'object') Object.assign(res, { bigWaitS, bigWhy });
      st = finish(st, id, res); stepRow(id);
      if (st.done) { save(); doneRow(); card(); return 'stop'; }
      next(); return 'stop';
    }
  }
  function deviceLine() { const ua = navigator.userAgent || ''; const m = /\(([^)]+)\)/.exec(ua); return (m ? m[1] : ua).slice(0, 80) + ` · ${screen.width}x${screen.height}@${globalThis.devicePixelRatio || 1}`; }
  /** the phone: the memory path, the second process, which models are downloaded */
  async function info() {
    const env = { ua: navigator.userAgent, lowmem, split: false, splitWhy: '', e2b: false, e4b: false, e2bDrafter: false, e4bDrafter: false, gpu: !!navigator.gpu };
    if (fake) { Object.assign(env, { split: true, e2b: true, e4b: fake !== 'noe4b', e2bDrafter: true }); st.env = env; return { env }; }
    try {
      if (splitHere()) { const L = await import('../../engine/llm/llm_engine.js'); const s = await L.splitAvailable(); env.split = !!s.ok; env.splitWhy = s.ok ? '' : String(s.why || '').slice(0, 60); }
      else env.splitWhy = 'not iOS 27 Safari';
    } catch (e) { env.splitWhy = String(e && e.message || e).slice(0, 60); }
    if (navigator.gpu) {
      const { createEngine } = await import('../../engine/llm/llm_engine.js');
      for (const k of ['e2b', 'e4b']) {
        try {
          const e = await createEngine(engineOpts({ model: k, drafter: true, split: false }));
          env[k] = !!(await e.status()).complete;
          if (env[k] && e.hasDrafter()) { try { env[k + 'Drafter'] = !!(await e.drafterStatus()).complete; } catch (x) { /* none */ } }
        } catch (x) { env[k] = false; }
      }
    }
    st.env = env; return { env };
  }

  /** v4: the Bigger brain plots her shift with no scene in this page (plot.js: the game's own loading-screen path), then the next page
   *  plays it out ('plot-play'); the reload in between gets its GPU memory back */
  async function plot() {
    const t0 = Date.now();
    const connect = fake ? async () => fakePlotConn() : (o) => connectJuli(Object.assign({ model: 'e4b', ctxCap: 1024, drafter: true, onProgress: progress('the Bigger brain') }, o));
    const go = () => runPlot({ connect, session: { at: 'before level 1', tutorial: true, step: 'boot', area: 'hall', roms: 0, deaths: 0, bench: true }, onStatus: (w) => stage(w), store: localStorage, lists: planLists() });
    let rec = await go(), firstWhy = null;
    // v4 (Nov 3: on Josh's phone her plot failed at once, SPLIT_RETRY, right after a helper had ended): one more try after 20 s
    if (!rec.ok && /SPLIT|GPU_LOST|second process|worker/i.test(String(rec.why || ''))) {
      firstWhy = String(rec.why || '').slice(0, 60);
      for (let s = TEST ? 1 : 20; s > 0; s--) { stage(`her helper was not ready (${firstWhy}): once more in ${s} s`); await sleep(1000); }
      rec = await go();
    }
    st.plotEnd = Date.now();
    const ph = st.lastHelper ? Object.assign({}, st.lastHelper, { agoS: Math.round((Date.now() - st.lastHelper.closedAt) / 1000) }) : null;
    if (rec && !fake) st.lastHelper = { step: 'plot', at: 24, mb: null, closedAt: Date.now(), endedFirst: null, close: rec.close || null };   // v4: the Bigger brain's close, for the step after
    return { prevHelper: ph, close: rec.close || null, retried: firstWhy != null, firstWhy, ok: !!rec.ok, why: rec.why || '', loadS: rec.loadS, warmS: rec.warmS, plotS: rec.plotS, prefillMs: rec.prefillMs, genMs: rec.genMs, tokens: rec.tokens, tokPerS: rec.tokPerS,
      intents: rec.plan && rec.plan.intents ? rec.plan.intents.length : 0, cleaned: (rec.errors || []).length, mood: !!(rec.plan && rec.plan.mood),
      // (v4, Nov 3: why the schema refused her plan, on the card)
      reasons: rec.ok ? undefined : (rec.errors || []).filter((e) => e !== 'no valid intents').slice(0, 2), screenS: +((Date.now() - t0) / 1000).toFixed(1), raw: rec.ok ? undefined : String(rec.raw || '').slice(0, 160) };
  }
  /** v4: her voice's cost on this phone: 12 of her kind of lines through voice.js's own measure (synthesis only, nothing plays) */
  async function voiceStep() {
    try { const { createVoice } = await import('./voice.js'); const v = createVoice({ audio: null }); const m = await v.measure(); try { v.dispose && v.dispose(); } catch (e) { /* */ } delete m.perLine; return m; }
    catch (e) { return { error: String((e && e.message) || e).slice(0, 100) }; }
  }
  function fakePlotConn() {
    const plan = { mood: 'A new shift, a01. Let us see what you have learnt.', intents: [{ when: { step: 'grab' }, call: 'spawn_trash', args: { kind: 'tin', at: 'S8' }, say: 'A tin for you.' },
      { when: { after_s: 20 }, call: 'prank', args: { kind: 'sting' }, say: 'Ta-da!' }, { when: { step: 'cable' }, call: 'prank', args: { kind: 'lights_out', seconds: 5 }, say: 'Lights!' }, { when: { binned: 9 }, call: 'say', args: {}, say: 'Nine!' }] };
    return { ok: true, load: { s: 0.5, warmS: 0.2, model: 'e4b' }, backend: { model: 'e4b', decide: async () => ({ text: JSON.stringify(plan), prefillMs: 300, genMs: 1200, tokens: 120 }), close: () => {} } };
  }

  /** the scene's steps: api = main.js's bench hooks */
  async function withScene(api) {
    const id = st.cur.id, S = STEPS[id], r = { };
    if (sceneT0 != null) r.sceneS = +((performance.now() - sceneT0) / 1000).toFixed(1);   // v4: the game's code and scene, after the settle
    leave = api.clearCrumbs || null;
    const ft = { all: [], idle: [], think: [] };
    api.onFrame((ms, thinking) => { ft.all.push(ms); (thinking ? ft.think : ft.idle).push(ms); if (ft.all.length > 20000) ft.all.shift(); });
    const memPeak = () => { const s = api.mem.snapshot(id); return api.mem.peak || s; };
    let memT = setInterval(() => api.mem.snapshot(id), 1000);
    wrapR = r; wrapId = id;
    dog = setTimeout(() => {   // v4 (Nov 2): a step stuck past STEP_CAP_S is recorded where it stuck, and the run goes on
      r.error = r.error || `stuck at “${(st.cur && st.cur.stage) || '?'}” for over ${STEP_CAP_S} s`;
      try { api.juliStop(); } catch (e) { /* */ } try { clearInterval(memT); api.setPilot(null); } catch (e) { /* */ }
      wrap();
    }, STEP_CAP_S * 1000);
    try {
      stage('play'); api.boot(); api.benchPlay(); pilot(api);
      await sleep(1500); ft.all.length = ft.idle.length = ft.think.length = 0;   // the first frames after Play (the shaders) are not play
      if (id === 'plot-play') {   // her plan, played out: the steps of Level 1 from the grab on, a few seconds each, as a player meets them
        r.reloadS = st.plotEnd ? +((Date.now() - st.plotEnd) / 1000).toFixed(1) : null;
        r.plotS = st.res.plot ? st.res.plot.plotS : null; r.screenS = r.reloadS != null && st.res.plot ? +((st.res.plot.screenS || 0) + r.reloadS).toFixed(1) : null;
        const P = api.planStart();
        stage('her plan in play'); const t0 = performance.now(), beats = ['grab', 'diesel', 'cable', 'estop', 'push', 'lineup', 'climb'];
        for (let k = 0; performance.now() - t0 < (TEST ? 30000 : 42000); k++) { api.beat(beats[Math.min(beats.length - 1, Math.floor(k / 12))]); await sleep(500); if (P && P.done) break; }
        const ps = api.planStats();
        r.plan = ps ? { fired: ps.fired, of: ps.of, expired: ps.expired, pending: ps.pending, waiting: ps.waiting, log: (ps.log || []).slice(-8).map((l) => `${l.i}:${l.out}`) } : { of: 0 };
        r.fps = fpsOf(ft.all); r.mem = memPeak();
      } else if (id === 'game') {
        stage('driving'); await sleep(TEST ? 6000 : 25000);
        const inf = api.info(); Object.assign(r, { fps: fpsOf(ft.all), mem: memPeak(), calls: inf.calls, tris: inf.triangles });
      } else {
        const J = S.juli, at = layoutOf(id, st.res);
        stage(`loading ${J.model === 'e4b' ? 'the Bigger brain' : 'Juli'} (layers 0-${at - 1} in the helper)`);
        const c = fake ? fakeConn(J.model, at) : await connectJuli({ model: J.model, splitAt: at, drafter: true, snapshot: !!J.snap, onProgress: progress(J.model === 'e4b' ? 'the Bigger brain' : 'Juli'), onStatus: (w) => stage(w), onGone: (code) => { r.gone = code; r.goneStage = (st.cur && st.cur.stage) || null; } });
        if (!c.ok) { r.error = c.why || 'did not load'; r.helpersAtFail = c.helpers || null; r.juli = { model: J.model, at }; }
        else {
          const L = c.load || {};
          r.juli = { model: J.model, at: L.at || at, pageMB: L.pageMB, helperMB: L.helperMB, drafter: !!L.drafter, loadS: L.s, warmS: L.warmS, snap: c.backend.snapshot ? c.backend.snapshot() : null,
            before: L.before || null, helpers: L.helpers || null };   // (v4: how long its load waited for earlier helpers, and the helpers this page knows)
          // v4 (Nov 3): her prompt's fixed start kept in her helper ahead of her turns (the engine's prefix snapshot), as the game does
          if (c.backend.warm) { stage('reading in her prompt (kept)'); const w0 = performance.now(); const sn = await c.backend.warm(systemPrompt('mischief', { tutorial: true })); r.juli.warm = sn ? { P: sn.P || 0, ms: Math.round(performance.now() - w0), kept: sn.kept != null ? sn.kept : null, why: sn.why || null } : null; }
          st.res[id] = Object.assign({}, st.res[id] || {}, JSON.parse(JSON.stringify(r)));   // kept now: a page that ends in her turns still says how she loaded
          // v4 (Nov 2): the stack step goes straight to the stack game (no turns of her mischief first: the stack game's own are measured)
          const turnsFirst = id !== 'stack' && id !== 'store';   // (the store step: her turns run while a01 drives in and the store opens)
          if (turnsFirst) {
            stage('her turns');
            const j = api.juliWith(c.backend, { gap: 0.3, timeout: TURNS.timeoutMs[J.model] });
            const t0 = performance.now(), cap = (TEST ? 40 : TURNS.capS[J.model]) * 1000;
            while (j.stats.history.length < TURNS.n && performance.now() - t0 < cap && !r.gone) { await sleep(250); if (j.stats.history.length) stage(`her turns · ${j.stats.history.length} of ${TURNS.n}`); }
            while (j.busy && performance.now() - t0 < cap + TURNS.timeoutMs[J.model]) await sleep(200);
            r.juli.t = turnsOf(j.stats.history);
          }
          r.fpsIdle = fpsOf(ft.idle); r.fpsThink = fpsOf(ft.think); r.fps = fpsOf(ft.all);
          const a = await c.backend.alive();
          r.juli.helperAlive = !r.gone && !!a; if (!r.juli.helperAlive) r.juli.helperWhy = r.gone || 'it stopped answering';
          if (a && a.mb) r.juli.helperNowMB = a.mb;
          r.mem = memPeak();
          if (id === 'store' && r.juli.helperAlive) { r.store = await storeStep(api, c.backend, r); const a3 = await c.backend.alive(); r.juli.helperAlive = !r.gone && !!a3; if (!r.juli.helperAlive) r.juli.helperWhy = r.gone || 'it stopped answering'; r.mem = memPeak(); }
          if (id === 'stack' && r.juli.helperAlive) {
            api.juliStop(); r.juli.helperAtStackMB = a && a.mb ? a.mb : null; r.memAtStack = api.mem.snapshot(id);   // (where it stood as the stack game began)
            r.stack = await stackGame(api, c.backend, r);
            const a2 = await c.backend.alive(); r.juli.helperAlive = !r.gone && !!a2; if (!r.juli.helperAlive) { r.juli.helperWhy = r.gone || 'it stopped answering'; r.stack.helperEndedAt = r.goneStage || 'the stack game'; }
            r.mem = memPeak();
          }
          if (id === 'headroom' && r.juli.helperAlive) { api.juliStop(); r.ballast = await ballast(api, c.backend, r); }
          else api.juliStop();
          // v4 (Nov 2): her helper told to free its memory, and a moment for it, before the next page loads its own (the page before's
          // helper lingering beside the next one's is the likely end of Josh's runs at step 6, the first Juli page after another)
          // v4 (Nov 3): her second process's end CONFIRMED by the engine (8acc293) before the next page loads its own: the result on the card
          stage('freeing her helper (waiting for it to confirm)'); const tc = performance.now();
          let cl = null; try { cl = await Promise.race([c.backend.close(), sleep(16500).then(() => ({ closed: false, why: 'no answer in 16 s' }))]); } catch (e) { cl = { closed: false, why: String((e && (e.code || e.message)) || e).slice(0, 80) }; }
          r.juli.close = cl && cl.closed ? { ok: true, ms: cl.ms != null ? Math.round(cl.ms) : Math.round(performance.now() - tc) } : { ok: false, why: (cl && cl.why) || 'unconfirmed' };
          st.lastHelper = { step: id, at: L.at || at, mb: L.helperMB || null, closedAt: Date.now(), endedFirst: r.gone || null, close: r.juli.close };   // the next model step says which helper went before it
          await sleep(TEST ? 300 : r.juli.close.ok ? 500 : 1500);
        }
      }
    } catch (e) { r.error = String((e && e.message) || e).slice(0, 120); }
    finally { clearInterval(memT); api.setPilot(null); }
    wrap();
  }
  /** a scene step's end (once: its own end, or the watchdog's) */
  let wrapped = false, wrapR = null, wrapId = null, dog = null;
  function wrap() {
    if (wrapped) return; wrapped = true; if (dog) clearTimeout(dog);
    if (goneWaitS) wrapR.goneWaitS = goneWaitS;
    if (bigWaitS && wrapR) Object.assign(wrapR, { bigWaitS, bigWhy });
    // v4: the next model step waits for its memory: after a helper that ended, or a second process that failed to start (Nov 3: the plot
    // ended the page after a step whose split had failed at load)
    if (wrapR && wrapR.juli && (wrapR.juli.helperAlive === false || /SPLIT_|GPU_LOST/.test(String(wrapR.error || '')))) st.goneAt = Date.now();
    st = finish(st, wrapId, wrapR); stepRow(wrapId);
    if (st.done) { save(); doneRow(); card(); return; }
    stage('next step'); next();
  }
  /** headroom: GPU buffers on this page, 64 MB at a time (written, so they are real), the helper asked after each; every step saved
   *  first (if the page ends, the next page knows how far it got) */
  async function ballast(api, backend, r) {
    const out = { mb: 0, ended: null, atMB: null };
    let dev = null; try { const ad = navigator.gpu && await navigator.gpu.requestAdapter(); dev = ad && await ad.requestDevice(); } catch (e) { /* */ }
    if (fake) dev = fakeDevice();   // the desk (no GPU there): JS memory stands in, and the stand-in helper ends at +256 MB
    if (!dev) { out.ended = 'no GPU for the ballast'; return out; }
    const bufs = [], zero = new Uint8Array(16 * 1048576);
    try {
      while (out.mb < BALLAST.maxMB) {
        st.res[st.cur.id] = Object.assign({}, st.res[st.cur.id] || {}, r, { ballast: Object.assign({}, out, { mb: out.mb + BALLAST.stepMB }) }); stage(`ballast +${out.mb + BALLAST.stepMB} MB`);
        const b = dev.createBuffer({ size: BALLAST.stepMB * 1048576, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
        for (let o = 0; o < BALLAST.stepMB * 1048576; o += zero.byteLength) dev.queue.writeBuffer(b, o, zero);
        await dev.queue.onSubmittedWorkDone(); bufs.push(b); out.mb += BALLAST.stepMB;
        await sleep(BALLAST.pauseMs);
        const a = await Promise.race([backend.alive(), sleep(3000).then(() => null)]);
        if (!a || backend.gone()) { out.ended = 'helper'; out.atMB = out.mb; break; }
        r.juli.helperNowMB = a.mb;
      }
      if (!out.ended) out.ended = 'cap';
    } finally { for (const b of bufs) { try { b.destroy(); } catch (e) { /* */ } } try { dev.destroy(); } catch (e) { /* */ } }
    return out;
  }
  /** v4 (Nov 3; Josh: "Just crashed as soon as the store opened"): her mischief turns running, a01 drives onto the dock's charger, the store
   *  opens by itself (her turns then wait, as in the game); the page's counted memory and her helper's each second for 15 s after */
  async function storeStep(api, backend, r) {
    const j = api.juliWith(backend, { gap: 0.3, timeout: TURNS.timeoutMs.e2b }), R = api.storeRig(), id0 = st.cur ? st.cur.id : 'store';
    const mem = () => { const m = api.mem.snapshot(id0); return m ? m.totalMB : null; };
    R.place(); stage('the store: a01 drives into the dock'); const before = mem(), t0 = performance.now(); let parkedAt = null;
    api.setPilot((s0) => R.input(s0));
    while (performance.now() - t0 < (TEST ? 90000 : 40000)) { await sleep(400); if (parkedAt == null && R.parked()) parkedAt = Math.round(performance.now() - t0); if (R.open()) break; }
    api.setPilot(null); const opened = R.open(); stage(opened ? 'the store: open' : 'the store: did not open');
    const climb = [];
    for (let k = 1; k <= 15; k++) {
      await sleep(1000);
      const a = backend.busy && backend.busy() ? undefined : await Promise.race([backend.alive(), sleep(900).then(() => undefined)]);
      climb.push({ s: k, page: mem(), helper: a === undefined ? 'busy' : a ? a.mb : 'gone' }); stage(`the store: open ${k} s`);
    }
    r.juli.t = turnsOf(j.stats.history); api.juliStop(); R.close();
    return { parkedAtMs: parkedAt, opened, before, peak: Math.max(before || 0, ...climb.map((c) => c.page || 0)), after: mem(), climb: climb.filter((x, i) => i % 3 === 0 || i === climb.length - 1) };
  }
  /** v4: the stack game with her live: a01 at the pad (the pilot off), three cans placed by its arm (GRAB keeps one at the pad, GRAB again
   *  places it, as a player would), then the hold; her stack turns (her own prompt) try to stop it with her tools */
  async function stackGame(api, backend, r) {
    const id0 = st.cur ? st.cur.id : 'stack';
    api.setPilot(null); const S = api.stackRig(); stage('the stack game: its loading screen'); await S.start(backend); stage('the stack game');
    // v4 (Nov 3): the climb: the page's counted memory and her helper's every second (her helper asked only between her answers; its
    // last heartbeat's age always), so a card whose helper ended shows what rose before it did
    const climb = [], c0 = performance.now();
    const climbT = setInterval(async () => {
      try {
        const m = api.mem.snapshot(id0), busy = backend.busy && backend.busy();
        const a = busy ? undefined : await Promise.race([backend.alive(), sleep(900).then(() => undefined)]);
        climb.push({ s: Math.round((performance.now() - c0) / 1000), page: m ? m.totalMB : null, img: m ? m.imagesMB + m.canvasMB : null, helper: a === undefined ? 'busy' : a ? a.mb : 'gone', hb: backend.hbAge ? backend.hbAge() : null });
        if (climb.length > 90) climb.shift();
      } catch (e) { /* the log is best effort */ }
    }, 1000);
    const until = async (f, ms) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await sleep(150); return f(); };
    const ARM_MS = TEST ? 60000 : 20000;   // a GRAB's sequence is ~9 s of game time (the CPU desk runs slower than real time)
    await until(() => !S.armBusy(), ARM_MS); await sleep(TEST ? 3000 : 1500);   // the arm folds to its stow, a01 settles at the pad
    let placed = 0, why = null;
    for (let k = 0; k < 3 && S.phase() === 'on'; k++) {
      S.spawnFor(k); await sleep(TEST ? 1500 : 700);
      const g = S.grab() || {}; if (!g.ok) { why = why || 'grab: ' + (g.why || '?'); continue; } await until(() => !S.armBusy(), ARM_MS); await sleep(500);
      const p = S.grab() || {}; if (!p.ok) { why = why || 'place: ' + (p.why || '?'); continue; } await until(() => !S.armBusy(), ARM_MS); await sleep(900);
      placed++; stage(`the stack game · ${placed} placed`);
    }
    await until(() => S.phase() !== 'on', 25000);
    clearInterval(climbT);
    const h = S.hud(), ts = S.turns(), ev = S.events();
    r.juli.t = turnsOf((ts && ts.history) || []);
    return { placed, missed: why, levels: h.levels, height: h.height, result: S.phase() === 'on' ? null : h.result, why: (ev.find((e) => e.type === 'stackLost') || {}).why || null,
      tools: ev.filter((e) => e.type === 'stackTool' && e.phase === 'fire').length, refused: ev.filter((e) => e.type === 'stackRefused').length, toppled: ev.filter((e) => e.type === 'stackToppled').length,
      climb: climb.filter((x, i) => i % 5 === 0 || i >= climb.length - 4),
      turnLog: ((ts && ts.history) || []).slice(-8).map((h) => ({ ms: h.ms, lim: h.limit || null, out: h.out, rin: h.promptTokens || null, kept: h.readIn, pre: h.prefillMs != null ? +(h.prefillMs / 1000).toFixed(1) : null, tps: h.tokens > 1 && h.genMs > 0 ? +((h.tokens - 1) / (h.genMs / 1000)).toFixed(1) : null })) };
  }
  /** the pilot: a01 drives a loop round the hall's open floor (DRIVE, skid turns), backs off when it is stuck, and the camera swings
   *  round it slowly with a look from the top view now and then: the draws of real play */
  function pilot(api) {
    const route = [[-4.0, 2.2], [-0.9, 2.5], [2.0, 1.2], [3.6, -1.8], [1.0, -2.9], [-1.8, -1.0], [-4.6, 0.6]];
    let k = 0, stuckT = 0, backT = 0, lastMove = 0;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    api.setPilot((s, t) => {
      const cam = api.cam; cam.a += 0.004; cam.user = t; const ph = t % 24; cam.goal = ph > 20 ? 1 : 0;
      if (backT > t) return { x: 0.3, y: -0.8, hold: false, mode: 'drive' };
      const [tx, tz] = route[k], dx = tx - s.pos[0], dz = tz - s.pos[2], dd = Math.hypot(dx, dz);
      if (dd < 0.5) { k = (k + 1) % route.length; return { x: 0, y: 0.4, hold: false, mode: 'drive' }; }
      if (s.motion.speed > 0.08) lastMove = t;
      if (t - lastMove > 2.0) { lastMove = t; backT = t + 1.1; k = (k + 1) % route.length; stuckT++; }
      const e = wrap(Math.atan2(-dz, dx) - s.yaw);
      return Math.abs(e) > 0.5 ? { x: -Math.sign(e), y: 0, hold: false, mode: 'drive' } : { x: Math.max(-1, Math.min(1, -2.2 * e)), y: Math.min(1, 0.35 + dd), hold: false, mode: 'drive' };
    });
  }
  function fakeDevice() {
    const held = [];
    return { createBuffer: ({ size }) => { const ab = new ArrayBuffer(size); held.push(ab); return { destroy: () => { held.length = 0; } }; }, queue: { writeBuffer: () => {}, onSubmittedWorkDone: async () => {} }, destroy: () => { held.length = 0; }, held };
  }
  /** the desk's stand-in for a connection (?test&julifake): her model is the fake one, the layout's numbers made up */
  function fakeConn(model, at) {
    const b = fakeBackend(fake === 'noe4b' ? 'random' : fake), M = MODELS[model];
    let gone = null;
    return { ok: true, load: { s: 0.4, warmS: 0.2, at, pageMB: 100 + (M.layers - at) * 30, helperMB: at * 38, drafter: true },
      backend: { decide: (o) => b.decide(o).then((x) => Object.assign({ tokens: Math.max(2, Math.round(x.text.length / 4)) }, x)), ready: () => !gone, alive: async () => { if (st && st.cur && st.res[st.cur.id] && st.res[st.cur.id].ballast && st.res[st.cur.id].ballast.mb > 256) gone = 'SPLIT_GONE'; return gone ? null : { mb: at * 38 }; },
        gone: () => gone, close: () => {}, memory: () => 'fake' } };
  }
  return { before, withScene, get state() { return st; } };
}
