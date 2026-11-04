// plot.js - Juli plots her shift with the Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B, ~16 tokens/s on the iPhone), on a loading screen
// where no 3D scene is in memory: before Level 1, and later at the open world's natural loading moments (a new day, a restart). One
// answer (about 20-30 s with its read-in), checked (plan.js validatePlan), saved in the game's own storage (plan.js PLAN_KEY), then the
// model is closed: the integrator reloads into a fresh page for the game, which reads the plan back (plan.js loadPlan) and plays it out.
// runPlot never throws: a failure is a saved record with ok false and why. It shows nothing itself beyond onStatus(text) (the status
// words are the game's; her words come only from her model: a radio teaser on the loading screen must be one of the plan's own lines,
// plan.js teaser(record.plan), shown after the plan arrives).
import { PLAN, PLAN_V, plotPrompt, parsePlan, validatePlan, savePlan } from './plan.js';

const msg = (e) => String((e && (e.code || e.message)) || e || 'failed').slice(0, 80);
const clock = () => (globalThis.performance ? performance.now() : Date.now());
const TIMEOUT = Symbol('timeout');

/** runPlot({ connect, session, onStatus, store, maxTokens, lists, timeoutMs, now }) -> the saved record
 *  { v, t, model, plan, errors, genMs, prefillMs, tokens, tokPerS, loadS, warmS, plotS, ok, why?, raw? }.
 *  connect({ onStatus }) -> { ok, why, backend, load }: the integrator's loader of the Bigger brain (juli_link.js connectJuli with
 *  model 'e4b'); backend.decide({ system, user, maxTokens, signal }) -> { text, prefillMs, genMs, tokens }; backend.close() always runs.
 *  lists: the allowed handles, tools, beats, areas (plan.js planLists). timeoutMs: the most the loading screen waits for her answer;
 *  closeMs: for the backend's close */
export async function runPlot({ connect, session = {}, onStatus = () => {}, store, maxTokens = PLAN.maxTokens, lists = {}, timeoutMs = PLAN.timeoutMs, closeMs = 16000, now = () => Date.now() } = {}) {   // (v4, Nov 3: its close confirmed: up to the engine's 15 s)
  const status = (s) => { try { onStatus(s); } catch (e) { /* the screen's fault stays its own */ } };
  const rec = { v: PLAN_V, t: 0, model: 'e4b', plan: null, errors: [], genMs: 0, prefillMs: 0, tokens: 0, tokPerS: 0, loadS: 0, ok: false };
  let backend = null;
  try {
    status('waking the Bigger brain');
    let r;
    try { r = typeof connect === 'function' ? await connect({ onStatus: status }) : { ok: false, why: 'no Bigger brain here' }; } catch (e) { r = { ok: false, why: msg(e) }; }
    backend = (r && r.backend) || null;
    const load = (r && r.load) || {};
    if (Number.isFinite(+load.s)) rec.loadS = +load.s;
    if (Number.isFinite(+load.warmS)) rec.warmS = +load.warmS;
    if (typeof load.model === 'string') rec.model = load.model;
    if (backend && typeof backend.model === 'string') rec.model = backend.model;
    if (!r || !r.ok || !backend || typeof backend.decide !== 'function') { rec.why = (r && r.why) || 'the Bigger brain is not available'; return rec; }
    status('Juli is plotting the shift');
    const P = plotPrompt(session, lists);
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const t0 = clock();
    const res = await Promise.race([
      Promise.resolve().then(() => backend.decide({ system: P.system, user: P.user, maxTokens, signal: ctl && ctl.signal })).catch((e) => ({ error: msg(e) })),
      new Promise((ok) => { timer = setTimeout(() => ok(TIMEOUT), timeoutMs); }),
    ]);
    clearTimeout(timer);
    rec.plotS = +((clock() - t0) / 1000).toFixed(1);
    if (res === TIMEOUT) { try { ctl && ctl.abort(); } catch (e) { /* */ } rec.why = `no answer in ${Math.round(timeoutMs / 1000)} s`; return rec; }
    if (!res || res.error || typeof res.text !== 'string') { rec.why = (res && res.error) || 'no answer'; return rec; }
    rec.genMs = Math.round(+res.genMs || 0); rec.prefillMs = Math.round(+res.prefillMs || 0); rec.tokens = Math.round(+res.tokens || 0);
    rec.tokPerS = rec.tokens && rec.genMs ? +(rec.tokens / (rec.genMs / 1000)).toFixed(1) : 0;
    status('checking her plan');
    const obj = parsePlan(res.text);
    if (!obj) { rec.why = 'unreadable answer'; rec.raw = res.text.slice(0, 400); return rec; }
    const v = validatePlan(obj, lists);
    rec.plan = v.plan; rec.errors = v.errors; rec.ok = v.ok;
    if (!v.ok) { rec.why = v.errors[v.errors.length - 1] || 'no valid intents'; rec.raw = res.text.slice(0, 400); }
    else if (v.errors.length) rec.raw = res.text.slice(0, 400);
    return rec;
  } catch (e) {
    rec.ok = false; rec.why = msg(e); return rec;
  } finally {
    if (backend && typeof backend.close === 'function') {
      let ct = null, res;   // a close that hangs never holds the loading screen: at most closeMs. v4 (Nov 3): the engine confirms its
      // second process's end (8acc293): the loading screen's reload waits for it, and the record says how it went
      try { res = await Promise.race([Promise.resolve().then(() => backend.close()), new Promise((ok) => { ct = setTimeout(() => ok({ closed: false, why: `no answer in ${closeMs} ms` }), closeMs); })]); }
      catch (e) { res = { closed: false, why: String((e && (e.code || e.message)) || e).slice(0, 80) }; }
      clearTimeout(ct);
      rec.close = res && res.closed ? { ok: true, ms: res.ms != null ? Math.round(res.ms) : null } : { ok: false, why: (res && (res.why || res.error)) || 'unconfirmed' };
    }
    rec.t = now();
    if (!savePlan(store, rec)) rec.unsaved = true;
    status(rec.ok ? 'her plan is ready' : `no plan (${rec.why || 'failed'})`);
  }
}
