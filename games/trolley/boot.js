// boot.js - Troll-E's first module (index.html loads only this). Josh, Nov 1: "Troll-E needs a landing screen start, load saved game and
// settings". The landing screen comes first with nothing of the game in memory (landing.js is DOM and one picture: no three.js, no Rapier,
// no trolley, no world, no Juli). Once the person has chosen: Juli plots her shift in the loading screen (the Bigger brain, with no scene
// beside it: plot.js), then a fresh page (iOS 27 gives a page's GPU memory back late: a reload is the sure way), then the game itself
// (main.js, imported only now). ?bench goes straight to the game (the phone bench skips the landing); the desk (?test without
// &landing) loads the game first and shows the landing over it once it is ready, as the old start card was.
import { createLanding, readSettings } from './landing.js';
import { createSaves } from './save.js';
import { createProgress } from './progress.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search), TEST = Q.has('test'), BENCH = Q.has('bench');
const HOME = new URL('../../', location.href).href;
const UA = (globalThis.navigator && navigator.userAgent) || '';
const LOWMEM = Q.has('lowmem') || /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1) || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4);
const GO_KEY = 'p0pc0rn:trolley:go';   // sessionStorage: the choice carried over the reload after her plotting (2 minutes at most)
const BENCH_KEY = 'p0pc0rn:trolley:bench';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leave = () => { try { location.replace(HOME); } catch (e) { location.href = HOME; } };
const lsJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

/** where the Bigger brain can plan her shift in the loading screen (plotOK: downloaded, the agreement made, a second process on iOS,
 *  and on a phone a Troll-E bench that saw its plot work). v4 (Nov 3, Josh: "Big brain brains before it loads on all. In V1 of
 *  troll-e"): it never plays live beside the game, on any device: she plays on her own model */
export async function brainEnv() {
  const env = { lowmem: LOWMEM, plotOK: false, plotWhy: '' };
  try {
    const { consent } = await import('../../rights.js');
    if (!consent()) { env.plotWhy = 'Agree to the p0pc0rn terms first (its short lesson)'; return env; }
    if (!navigator.gpu) { env.plotWhy = 'No WebGPU in this browser'; return env; }
    const JL = await import('./juli_link.js');
    if (JL.WEBKIT && !JL.splitHere()) { env.plotWhy = 'Needs iOS 27’s second process'; return env; }
    const { createEngine } = await import('../../engine/llm/llm_engine.js');
    const e = await createEngine(JL.engineOpts({ model: 'e4b', drafter: false, split: false }));
    let have = false; try { have = !!(await e.status()).complete; } catch (x) { have = false; }
    if (!have) { env.plotWhy = 'Get the Bigger brain in p0pc0rn (Settings › Models)'; return env; }
    // v4 (Nov 3): on a phone the Bigger brain plots her shift only once a Troll-E bench has seen its plot work there (every helper start
    // of it failed on Josh's phone, and a load of it ended the page)
    const bb = lsJSON(BENCH_KEY), plotProven = !!(bb && bb.res && bb.res.plot && bb.res.plot.ok);
    env.plotOK = !LOWMEM || plotProven; if (!env.plotOK) env.plotWhy = 'The Troll-E bench has not seen the Bigger brain plot on this phone yet';
  } catch (e) { env.plotWhy = 'Not available here'; }
  return env;
}

async function boot() {
  // the phone bench: it picks up its run and runs the steps with no scene here, before any of the game's code loads (v4, Nov 1: the
  // plot, the voice and this phone's step never import three.js, Rapier or the game); main.js only for a step that needs the scene
  if (BENCH) {
    $('start').hidden = true;
    const { createBench } = await import('./bench.js');
    const bench = createBench({ HOME, Q, TEST, lowmem: LOWMEM });
    if ((await bench.before()) !== 'scene') return;
    return (await import('./main.js')).start({ bench });
  }
  const saves = createSaves(), progress = createProgress();
  const hooks = { onSetting: null };
  const landing = createLanding({ saves, progress, env: { lowmem: LOWMEM }, onSetting: (k, v, s) => { if (hooks.onSetting) hooks.onSetting(k, v, s); } });
  const envP = brainEnv().then((env) => { landing.setEnv(env); return env; }).catch(() => ({ lowmem: LOWMEM }));
  if (TEST && !Q.has('landing')) return (await import('./main.js')).start({ landing, hooks, saves, progress, envP, mode: 'after' });
  // straight after her plotting's reload: the choice it carried (the landing is only the loading screen now)
  let go = null; try { go = JSON.parse(sessionStorage.getItem(GO_KEY) || 'null'); sessionStorage.removeItem(GO_KEY); } catch (e) { go = null; }
  let action = go && Date.now() - (+go.t || 0) < 120000 && ['start', 'load', 'skip'].includes(go.action) ? go.action : null;
  if (!action) {
    try { const { createCrumbs } = await import('./boot_crumbs.js'); const c = createCrumbs(); if (c.line) landing.setCrumb(c.line); } catch (e) { /* */ }
    // v4 (Nov 3): the play trail of a page that ended mid-game: one line into the app's Diagnostics, and on the landing
    try { const { reportTrail } = await import('./trail.js'); const line = reportTrail({ minAgeMs: 0 }); if (line) landing.setCrumb(line); } catch (e) { /* */ }
    landing.show();
    action = await landing.choose();
    if (action === 'leave') return leave();
    if ((action === 'start' || action === 'skip') && saves.has()) saves.clear();   // the landing asked first: a new game replaces the save
    const env = await Promise.race([envP, sleep(4000).then(() => ({ lowmem: LOWMEM }))]);
    const S = readSettings(env);
    if (S.plot && S.juli && !(await freshPlan())) {
      const rec = await plotShift(landing, action, saves, progress);
      if (rec && (rec.ok || rec.loadS)) {   // her model was in this page: a fresh page for the game
        try { sessionStorage.setItem(GO_KEY, JSON.stringify({ action, t: Date.now() })); } catch (e) { /* the landing again, then */ }
        location.reload(); return;
      }
    }
  }
  landing.setLoading('Loading the physics…');
  return (await import('./main.js')).start({ landing, hooks, saves, progress, envP, action, mode: 'first' });
}
async function freshPlan() { try { const P = await import('./plan.js'); return !!P.loadPlan(localStorage, Date.now(), P.planLists()); } catch (e) { return false; } }
/** the loading screen's plotting: the Bigger brain reads where a01 is in the game and writes her plan (plot.js); her mood line (her own
 *  words, from her plan) shows once it is there */
async function plotShift(landing, action, saves, progress) {
  try {
    const [P, PL, JL] = await Promise.all([import('./plan.js'), import('./plot.js'), import('./juli_link.js')]);
    const sv = action === 'load' ? saves.load() : null, last = P.lastPlan(localStorage);
    const session = { at: action === 'load' ? 'a new day' : action === 'skip' ? 'into the open world' : 'before level 1', tutorial: action === 'start', step: action === 'start' ? 'boot' : null,
      area: 'hall', day: sv ? Math.floor(sv.time / 600) + 1 : 1, roms: progress.roms, best: progress.best, deaths: sv ? sv.deaths : 0, prev: last && last.plan ? { mood: last.plan.mood } : null };
    landing.setLoading('Juli is plotting her shift…', { sub: 'the Bigger brain is waking up' });
    let CR = null; try { const { createCrumbs } = await import('./boot_crumbs.js'); CR = createCrumbs(); CR.stage('landing'); CR.begin('juli:plot'); } catch (e) { CR = null; }   // a page that ends while she plots says so next time
    const rec = await PL.runPlot({ connect: (o) => JL.connectJuli(Object.assign({ model: 'e4b', ctxCap: 1024, drafter: true }, o)), session, store: localStorage, lists: P.planLists(),
      onStatus: (w) => landing.setLoading('Juli is plotting her shift…', { sub: w }) });
    if (CR) { CR.end('juli:plot'); CR.clear(); }
    const line = rec.ok ? P.teaser(rec.plan) : null;
    landing.setLoading(rec.ok ? 'Her plan is ready' : 'She will improvise', { sub: line ? `JULI · ${line}` : rec.ok ? '' : String(rec.why || '') });
    await sleep(line ? 2600 : 900);
    return rec;
  } catch (e) { return null; }
}
boot().catch((e) => { try { $('start').hidden = true; $('fail').hidden = false; $('fail-line').textContent = 'The game could not start. (' + String((e && e.message) || e).slice(0, 140) + ')'; } catch (x) { /* */ } });
