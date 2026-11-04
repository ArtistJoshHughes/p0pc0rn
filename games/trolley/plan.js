// plan.js - Juli's plan for a shift. The Bigger brain (too big to sit beside the 3D scene) runs on a loading screen, where no scene is
// in memory, reads a compact session and writes her plan in a closed JSON schema: her mood for the shift (one short line, in her own
// voice: the loading screen may show it) and up to 6 mischief intents, each a trigger the game can check + the SAME call (handle and
// arguments) she makes live (juli.js) + an optional radio line. The game fires each intent once, when its trigger comes true, checked
// by the live guard rails at that moment (juli.js apply): a refused intent stays pending, is retried every 2 s, and is dropped 30 s
// after its trigger first came true. Her words come from her model only: nothing here writes a line (the prompt's example carries
// placeholders, and a copied placeholder is dropped); every line goes through the radio's filter (juli.js filterSay).
// The plan lives in the game's own storage under PLAN_KEY and nowhere else. Pure (no DOM): v39/tests/trolley/trolley_plan.test.mjs.
//
//   { "mood": "<one line>", "intents": [ { "when": { "binned": 3 }, "call": "bounty", "args": { "kind": "tin", "roms": 4, "seconds": 40 }, "say": "<a line>" } ] }
//
// Triggers (one per intent): step (a tutorial beat id, while a01 is on it), area (a01 is in it), after_s (seconds since the plan began),
// binned (items binned this run reach n), event (one of EVENTS happened this tick; 'crafted:x' counts as 'crafted'), stack (the mini
// game's stack reaches n), day (the day reaches n).
import { MODES, SIGNS, COLORS, filterSay } from './juli.js';
import { BEATS } from './tutorial.js';
import { AREA_NAMES } from './world_spec.js';

export const PLAN_KEY = 'p0pc0rn:trolley:plan';
export const PLAN_V = 1;
/** maxIntents and line lengths; freshMs: a saved plan older than this is stale; retryS / windowS: a refused intent is retried every
 *  retryS for windowS after its trigger first came true; gapS: at least this long between two planned moves; maxTokens / timeoutMs: the
 *  plot's answer (about 20 s at ~16 tokens/s) and the most the loading screen waits for it */
export const PLAN = { maxIntents: 6, maxSay: 80, maxMood: 80, freshMs: 30 * 60e3, retryS: 2, windowS: 30, gapS: 4, maxTokens: 320, timeoutMs: 90e3, logN: 24 };
export const TRIGGERS = ['step', 'area', 'after_s', 'binned', 'event', 'stack', 'day'];
export const RANGES = { after_s: [20, 900], binned: [1, 20], stack: [1, 6], day: [1, 60] };
export const EVENTS = ['spill', 'docked', 'banked', 'estop', 'night', 'dawn', 'crafted'];
/** the mini game's handle and its tools (a parameter: lists.tools / lists.toolHandle) */
export const TOOLS = ['vent', 'plate', 'roller', 'sweeper'];
// juli.js's spawn points and lanes, as her live prompt names them (the test checks every name against juli.js SPAWNS / LANES)
export const SPAWN_LIST = 'hall S1-S8, yard Y1-Y2, park P1-P4, metro M1-M4, forest F1-F4';
export const LANE_LIST = 'hall L1-L6, yard LY1, park LP1-LP2, metro LM1-LM2, forest LF1-LF2';
// the prompt's example placeholders: a plan that copies one has not written its own line, and that line is dropped
const PLACEHOLDERS = ['one line', 'a line', 'your line', 'one short line'];
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const isPlaceholder = (s) => PLACEHOLDERS.some((p) => norm(p) === norm(s));

/** the allowed lists: the defaults are juli.js's mischief mode, the tutorial's beats, the world's areas, plus the stack game; pass any of
 *  { handles, pranks, kinds, tools, toolHandle, beats, areas, events, triggers, describe: { handle: 'args text' } } to change them */
export function planLists(o = {}) {
  const M = MODES.mischief, arr = (v, d) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : d);
  const toolHandle = typeof o.toolHandle === 'string' ? o.toolHandle : 'stack';
  return {
    handles: arr(o.handles, [...M.handles, toolHandle]), pranks: arr(o.pranks, M.pranks.slice()), kinds: arr(o.kinds, M.kinds.slice()),
    tools: arr(o.tools, TOOLS.slice()), toolHandle, beats: arr(o.beats, BEATS.map((b) => b.id)), areas: arr(o.areas, Object.keys(AREA_NAMES)),
    events: arr(o.events, EVENTS.slice()), triggers: arr(o.triggers, TRIGGERS.slice()).filter((k) => TRIGGERS.includes(k)),
    describe: o.describe && typeof o.describe === 'object' ? o.describe : {},
  };
}

const clip = (v, n = 16) => String(v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
/** a line of hers, cleaned: the radio's filter, at most max characters -> { line, note } (line null: dropped, note says why) */
function cleanLine(v, max, what) {
  if (v == null || v === '') return { line: null, note: null };
  if (typeof v !== 'string') return { line: null, note: `${what} is not text` };
  if (isPlaceholder(v)) return { line: null, note: `${what} copies the example` };
  const f = filterSay(v, max);
  if (!f) return { line: null, note: v.trim() ? `${what} filtered` : null };
  const clipped = f.endsWith('…') && !v.trim().endsWith('…');
  return { line: f, note: clipped ? `${what} clipped to ${max}` : null };
}
/** a trigger, cleaned -> { when, note } or { why } */
function cleanWhen(w, L) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return { why: 'no trigger' };
  const keys = Object.keys(w), k = keys.find((x) => L.triggers.includes(x));
  if (!k) return { why: `unknown trigger ${clip(keys[0] || '{}')}` };
  const note = keys.length > 1 ? `one trigger only: kept ${k}` : null, v = w[k];
  if (k === 'step' || k === 'area' || k === 'event') {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '', name = k === 'event' ? s.split(':')[0] : s;
    const list = k === 'step' ? L.beats : k === 'area' ? L.areas : L.events;
    return list.includes(name) ? { when: { [k]: name }, note } : { why: `${k} "${clip(v)}" unknown` };
  }
  const n = typeof v === 'string' && v.trim() !== '' ? +v : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { why: `${k} is not a number` };
  const [lo, hi] = RANGES[k], r = Math.round(n), c = Math.max(lo, Math.min(hi, r));
  return { when: { [k]: c }, note: c !== r ? `${k} ${r} -> ${c} (${lo}-${hi})` : note };
}
/** a call's arguments, cleaned: flat, at most 6, short strings and finite numbers only */
function cleanArgs(a) {
  if (a == null) return { args: {} };
  if (typeof a !== 'object' || Array.isArray(a)) return { args: {}, note: 'args dropped' };
  const out = {}; let dropped = 0;
  for (const [k, v] of Object.entries(a)) {
    if (Object.keys(out).length >= 6 || !/^[A-Za-z_]{1,16}$/.test(k)) { dropped++; continue; }
    if (typeof v === 'string') out[k] = v.trim().slice(0, 32);
    else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v;
    else dropped++;
  }
  return { args: out, note: dropped ? `${dropped} arg(s) dropped` : null };
}
/** one intent, cleaned -> { intent, notes } or { why } */
function cleanIntent(it, L) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) return { why: 'not an object' };
  const notes = [], w = cleanWhen(it.when, L);
  if (w.why) return { why: w.why };
  if (w.note) notes.push(w.note);
  let call = typeof it.call === 'string' ? it.call.trim() : '';
  if (!call) return { why: 'no call' };
  if (!L.handles.includes(call)) return { why: `"${clip(call)}" is not a handle` };
  // v4 (Nov 3): a say (or a pass) whose line went into its args (the desk: {"call":"say","args":{"":"Time to roll!"}}): the line taken from there
  let sayV = it.say;
  if ((sayV == null || sayV === '') && (call === 'say' || call === 'pass') && it.args && typeof it.args === 'object' && !Array.isArray(it.args)) {
    const strs = Object.entries(it.args).filter(([, v]) => typeof v === 'string' && v.trim());
    const pick = strs.find(([k]) => /^(say|line|text|msg|message|)$/i.test(k)) || (strs.length === 1 ? strs[0] : null);
    if (pick) { sayV = pick[1]; notes.push('say line from its args'); }
  }
  const A = cleanArgs(call === 'say' || call === 'pass' ? null : it.args), args = A.args; if (A.note) notes.push(A.note);
  const S = cleanLine(sayV, PLAN.maxSay, 'say'); if (S.note) notes.push(S.note);
  if (call === 'pass') { if (!S.line) return { why: 'pass does nothing' }; call = 'say'; notes.push('pass -> say'); }
  if (call === 'say' && !S.line) return { why: S.note || 'say without a line' };
  if (call === 'prank' && !L.pranks.includes(args.kind)) return { why: `prank kind "${clip(args.kind)}"` };
  if ((call === 'spawn_trash' || call === 'bounty') && !L.kinds.includes(args.kind)) return { why: `${call} kind "${clip(args.kind)}"` };
  if (call === L.toolHandle) {
    if (args.tool == null && L.tools.includes(args.kind)) { args.tool = args.kind; delete args.kind; notes.push('kind -> tool'); }
    if (!L.tools.includes(args.tool)) return { why: `${call} tool "${clip(args.tool)}"` };
  }
  const intent = { when: w.when, call, args };
  if (S.line) intent.say = S.line;
  return { intent, notes };
}

/** validatePlan(obj, lists) -> { ok, plan: { mood, intents }, errors }: unknown fields dropped, lines filtered and clipped, invalid
 *  intents removed (each with its reason in errors), at most PLAN.maxIntents kept. ok = at least one intent survived */
export function validatePlan(obj, lists = {}) {
  const L = planLists(lists), errors = [], plan = { mood: '', intents: [] };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, plan, errors: ['not a plan'] };
  const m = cleanLine(obj.mood, PLAN.maxMood, 'mood'); if (m.line) plan.mood = m.line; if (m.note) errors.push(m.note);
  if (!Array.isArray(obj.intents) || !obj.intents.length) { errors.push('no intents'); return { ok: false, plan, errors }; }
  let valid = 0;
  const per = [];
  obj.intents.slice(0, 16).forEach((it, i) => {
    const r = cleanIntent(it, L);
    if (r.why) { per.push(`intent ${i + 1}: ${r.why}`); return; }
    valid++;
    if (plan.intents.length >= PLAN.maxIntents) return;
    for (const n of r.notes) per.push(`intent ${i + 1}: ${n}`);
    plan.intents.push(r.intent);
  });
  if (valid > PLAN.maxIntents || obj.intents.length > 16) errors.push(`too many intents: kept ${PLAN.maxIntents} of ${obj.intents.length > 16 ? obj.intents.length : valid}`);
  errors.push(...per);
  if (!plan.intents.length) errors.push('no valid intents');
  return { ok: plan.intents.length > 0, plan, errors: errors.slice(0, 16).map((e) => clip(e, 90)) };
}

// ---- reading her answer
/** the balanced JSON value starting at text[a] ('{'): { end } when it closes, else { cut, open } = the last point after a complete
 *  value and the brackets still open there (to close a truncated answer) */
function scan(text, a, limit) {
  const st = []; let inStr = false, esc = false, cut = -1, open = null;
  for (let i = a; i < limit; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') st.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') { if (st.pop() !== ch) return { end: -1, cut, open }; if (!st.length) return { end: i + 1 }; cut = i + 1; open = st.slice(); }
  }
  return { end: -1, cut, open };
}
/** JSON.parse, forgiving trailing commas (outside strings) */
function loose(s) {
  try { return JSON.parse(s); } catch (e) { /* try without trailing commas */ }
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { out += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    if (ch === ',') { let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++; if (s[j] === '}' || s[j] === ']') continue; }
    out += ch;
  }
  try { return JSON.parse(out); } catch (e) { return undefined; }
}
const planLike = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && ('intents' in o || 'mood' in o);
const unwrap = (o) => (planLike(o) ? o : o && typeof o === 'object' && planLike(o.plan) ? o.plan : null);

/** parsePlan(text) -> the plan object in the model's answer, or null. The first JSON object that reads as a plan; tolerates text round
 *  it, code fences, a doubled '{' (the engine's prefix), trailing commas, and an answer cut off by its token limit (closed after the
 *  last complete value: the intents written in full survive) */
export function parsePlan(text) {
  if (typeof text !== 'string' || !text) return null;
  const src = text.length > 12000 ? text.slice(0, 12000) : text, L = src.length;
  const starts = []; for (let i = src.indexOf('{'); i >= 0 && starts.length < 64; i = src.indexOf('{', i + 1)) starts.push(i);
  let first = null;
  for (const a of starts) {
    const r = scan(src, a, L); if (r.end < 0) continue;
    const o = loose(src.slice(a, r.end)), p = unwrap(o);
    if (p) return p;
    if (first == null && o && typeof o === 'object' && !Array.isArray(o)) first = o;
  }
  for (const a of starts) {   // cut off: close it after its last complete value
    const r = scan(src, a, L); if (r.end >= 0 || r.cut < 0) continue;
    const p = unwrap(loose(src.slice(a, r.cut) + r.open.reverse().join('')));
    if (p) return p;
  }
  return first;
}

// ---- the prompt
const HANDLE_TEXT = (L) => ({
  say: 'say {}: the line goes in "say"',   // (v4, Nov 3: "say {}: the line only" was read as no line at all)
  spawn_trash: `spawn_trash {"kind":${L.kinds.join('|')},"at":${SPAWN_LIST}}`,
  bounty: 'bounty {"kind","roms":1-10,"seconds":15-60}: extra ROMs if binned in time',
  prank: `prank {"kind":${L.pranks.join('|')},"sign":${SIGNS.join('|')},"color":${Object.keys(COLORS).join('|')},"lane":in a01's area: ${LANE_LIST}}`,
  [L.toolHandle]: `${L.toolHandle} {"tool":${L.tools.join('|')}}: her tool in the stack mini game`,
});
const TRIGGER_TEXT = (L) => ({
  step: `{"step":${L.beats.join('|')}}`, area: `{"area":${L.areas.join('|')}}`, after_s: '{"after_s":20-900}',
  binned: '{"binned":1-20}', event: `{"event":${L.events.join('|')}}`, stack: '{"stack":1-6}', day: '{"day":1-60}',
});
/** the session, compacted for the prompt: no empty values, short strings, short lists, at most maxChars of JSON (the last keys go first) */
export function compactSession(session, maxChars = 300) {
  const c = (v, d) => {
    if (v == null || v === '') return undefined;
    if (typeof v === 'string') return v.slice(0, 60);
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined;
    if (typeof v === 'boolean') return v;
    if (d > 2 || typeof v !== 'object') return undefined;
    if (Array.isArray(v)) { const a = v.slice(0, 8).map((x) => c(x, d + 1)).filter((x) => x !== undefined); return a.length ? a : undefined; }
    const o = {}; for (const [k, x] of Object.entries(v).slice(0, 24)) { const y = c(x, d + 1); if (y !== undefined) o[k] = y; }
    return Object.keys(o).length ? o : undefined;
  };
  const o = c(session && typeof session === 'object' && !Array.isArray(session) ? session : {}, 0) || {};
  let s = JSON.stringify(o);
  for (const k of Object.keys(o).reverse()) { if (s.length <= maxChars) break; delete o[k]; s = JSON.stringify(o); }
  return s;
}
/** plotPrompt(session, lists) -> { system, user }: who Juli is, the schema with one tiny example (placeholders for her words), the
 *  handles with their arguments, the triggers; the user part = the compact session JSON (at most 300 characters). About 370 + 75 tokens at most (test: under 450) */
export function plotPrompt(session = {}, lists = {}) {
  const L = planLists(lists), H = HANDLE_TEXT(L), T = TRIGGER_TEXT(L);
  const tut = !(session && session.tutorial === false), trig = L.triggers.filter((k) => tut || k !== 'step');   // no tutorial: no steps
  const calls = L.handles.filter((h) => h !== 'pass').map((h) => '- ' + (typeof L.describe[h] === 'string' ? `${h} ${L.describe[h]}` : H[h] || `${h} {}`));
  const system = [
    'You are Juli, the AI of a run-down reclaim hall and the dead town round it; a01 is the trash trolley robot the player drives.',
    'Mischievous, not an enemy: tease a01 on the radio, stir things up, make it fun. Never mean, no swearing.',
    `The game is loading: plan the shift. Answer with ONE JSON object only: {"mood": short radio line in your voice, "intents": up to ${PLAN.maxIntents} {"when": TRIGGER, "call": NAME, "args": {...}, "say": radio line, max ${PLAN.maxSay} chars}}.`,
    `TRIGGER (each fires once): ${trig.map((k) => T[k]).join(' | ')}.`,
    'Calls:', ...calls,
    ...(tut ? ['Before the grab step only say works.'] : []),
    // v4 (Nov 3: on Josh's phone the Bigger brain wrote {"call":"say","args":{}} with no line in the tutorial: its plan had no intents)
    tut ? 'Example: {"mood":"<one line>","intents":[{"when":{"step":"line"},"call":"say","args":{},"say":"<a line>"}]}'
      : 'Example: {"mood":"<one line>","intents":[{"when":{"area":"yard"},"call":"prank","args":{"kind":"sting"},"say":"<a line>"}]}',
  ].join('\n');
  return { system, user: compactSession(session) };
}
/** a rough token count (4 characters a token) */
export const estimateTokens = (s) => Math.ceil(String(s || '').length / 4);
/** the plan's own line for the loading screen's radio teaser: her mood (never repeated in play), else her first planned line; null if
 *  she wrote none (nothing here makes one up) */
export function teaser(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const m = typeof plan.mood === 'string' ? filterSay(plan.mood) : null; if (m) return m;
  for (const it of Array.isArray(plan.intents) ? plan.intents : []) { const s = it && typeof it.say === 'string' ? filterSay(it.say) : null; if (s) return s; }
  return null;
}

// ---- playing it out
/** does this trigger hold now? s = the runner's tick state, el = seconds since the plan began */
function holds(when, s, el) {
  const k = Object.keys(when || {})[0], v = when && when[k], n = (x) => (Number.isFinite(+x) ? +x : 0);
  if (k === 'step') return s.step === v;
  if (k === 'area') return s.area === v;
  if (k === 'after_s') return el >= v;
  if (k === 'binned') return n(s.binned) >= v;
  if (k === 'stack') return n(s.stack) >= v;
  if (k === 'day') return n(s.day) >= v;
  if (k === 'event') return Array.isArray(s.events) && s.events.some((e) => e === v || String(e).startsWith(v + ':'));
  return false;
}
/** createPlanRunner({ plan, apply, now, onFire, gapS, retryS, windowS }) -> { tick(state) -> [fired], stats, intents, done }.
 *  apply(call, state) -> { applied, why }: the live guard rails (juli.js apply, with the hall as it is now). tick(state) about twice a
 *  second, state = { t (seconds of play; else now()), step, area, binned, stack, day, events: [event names since the last tick] }.
 *  Each intent fires at most once, one move per gapS at most; a refused one is retried every retryS for windowS after its trigger first
 *  came true, then dropped (expired). onFire(call, line, intent): the move was made; line = her filtered radio line or null */
export function createPlanRunner({ plan, apply, now = () => (globalThis.performance ? performance.now() : Date.now()) / 1000, onFire = null,
  gapS = PLAN.gapS, retryS = PLAN.retryS, windowS = PLAN.windowS } = {}) {
  const src = plan && Array.isArray(plan.intents) ? plan.intents.slice(0, PLAN.maxIntents) : [];
  const I = src.map((intent, i) => ({ i, intent, state: 'waiting', firstT: null, nextT: 0, tries: 0, why: '' }));
  const stats = { fired: 0, refused: 0, pending: 0, expired: 0, waiting: I.length, log: [] };
  let t0 = null, lastFire = -Infinity;
  const log = (t, x, out) => { stats.log.push({ t: Math.round(t * 10) / 10, i: x.i, call: x.intent.call, out }); if (stats.log.length > PLAN.logN) stats.log.shift(); };
  const count = () => { stats.pending = I.filter((x) => x.state === 'pending').length; stats.waiting = I.filter((x) => x.state === 'waiting').length; };
  function tick(state = {}) {
    const s = state && typeof state === 'object' ? state : {}, t = Number.isFinite(s.t) ? s.t : now(), out = [];
    if (t0 == null) t0 = t;
    for (const x of I) if (x.state === 'waiting' && holds(x.intent.when, s, t - t0)) { x.state = 'pending'; x.firstT = t; x.nextT = t; log(t, x, 'triggered'); }
    for (const x of I) if (x.state === 'pending' && t - x.firstT > windowS) { x.state = 'expired'; stats.expired++; log(t, x, 'expired: ' + (x.why || 'refused')); }
    if (t - lastFire >= gapS) {
      for (const x of I) {
        if (x.state !== 'pending' || x.nextT > t) continue;
        const it = x.intent, call = { call: it.call, args: Object.assign({}, it.args), say: it.say || null };
        let r; try { r = apply ? apply(call, s) : { applied: false, why: 'no guard rails' }; } catch (e) { r = { applied: false, why: 'error' }; }
        x.tries++;
        if (r && r.applied) {
          x.state = 'fired'; stats.fired++; lastFire = t;
          const line = it.say ? filterSay(it.say) : null;
          log(t, x, 'fired'); out.push({ i: x.i, call, line });
          if (onFire) { try { onFire(call, line, it); } catch (e) { /* the game's fault stays its own */ } }
          break;
        }
        x.why = String((r && r.why) || 'refused').slice(0, 60); x.nextT = t + retryS; stats.refused++; log(t, x, 'refused: ' + x.why);
      }
    }
    count();
    return out;
  }
  return { tick, stats, intents: I, get done() { return I.every((x) => x.state === 'fired' || x.state === 'expired'); } };
}

// ---- the game's storage: PLAN_KEY only (never the agreement or anything else); every access wrapped
const storeOf = (s) => { if (s) return s; try { return globalThis.localStorage || null; } catch (e) { return null; } };
const readRec = (S) => { try { const raw = S.getItem(PLAN_KEY); if (!raw) return null; const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; } };
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const plainObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
/** a plan as stored: its shape only (the handles are judged by validatePlan with the game's lists when it is loaded) */
function storedPlan(p) {
  const P = plainObj(p), intents = [];
  for (const it of P && Array.isArray(P.intents) ? P.intents.slice(0, PLAN.maxIntents) : []) {
    if (!plainObj(it) || !plainObj(it.when) || typeof it.call !== 'string') continue;
    const o = { when: Object.assign({}, it.when), call: it.call.slice(0, 24), args: Object.assign({}, plainObj(it.args) || {}) };
    if (typeof it.say === 'string' && it.say) o.say = it.say.slice(0, PLAN.maxSay);
    intents.push(o);
  }
  return { mood: P && typeof P.mood === 'string' ? P.mood.slice(0, PLAN.maxMood) : '', intents };
}
/** a record as stored: known fields only */
function cleanRecord(r) {
  const plan = storedPlan(r && r.plan), errs = Array.isArray(r && r.errors) ? r.errors.filter((e) => typeof e === 'string').slice(0, 16).map((e) => clip(e, 90)) : [];
  const o = { v: PLAN_V, t: num(r && r.t) || Date.now(), model: clip((r && r.model) || '', 24), plan, errors: errs, ok: !!(r && r.ok) && plan.intents.length > 0,
    genMs: Math.round(num(r && r.genMs)), prefillMs: Math.round(num(r && r.prefillMs)), tokens: Math.round(num(r && r.tokens)), tokPerS: num(r && r.tokPerS), loadS: num(r && r.loadS) };
  for (const k of ['warmS', 'plotS']) if (r && Number.isFinite(r[k])) o[k] = r[k];
  if (r && typeof r.why === 'string' && r.why) o.why = clip(r.why, 80);
  if (r && typeof r.raw === 'string' && r.raw) o.raw = r.raw.slice(0, 400);
  if (r && r.consumed) o.consumed = num(r.consumed) || 1;
  return o;
}
/** savePlan(store, record) -> true when written (its own key only) */
export function savePlan(store, record) {
  const S = storeOf(store); if (!S || !record || typeof record !== 'object') return false;
  try { S.setItem(PLAN_KEY, JSON.stringify(cleanRecord(record))); return true; } catch (e) { return false; }
}
/** loadPlan(store, now, lists) -> the saved record if it is fresh (written within PLAN.freshMs, not consumed, a plan with intents), its
 *  plan checked again with the game's lists (planLists); else null */
export function loadPlan(store, now = Date.now(), lists = {}) {
  const S = storeOf(store); if (!S) return null;
  const r = readRec(S); if (!r || r.v !== PLAN_V || r.consumed || !r.ok) return null;
  const t = num(r.t); if (!t || now - t > PLAN.freshMs || t - now > 60e3) return null;
  const c = cleanRecord(r), v = validatePlan(c.plan, lists);
  return c.ok && v.ok ? Object.assign(c, { plan: v.plan }) : null;
}
/** the last record whatever its state (for the probe: why there is no plan), or null */
export function lastPlan(store) { const S = storeOf(store); const r = S && readRec(S); return r && r.v === PLAN_V ? cleanRecord(r) : null; }
/** consumePlan(store, now) -> true when the saved plan is marked used (a reload never plays it again) */
export function consumePlan(store, now = Date.now()) {
  const S = storeOf(store); if (!S) return false;
  const r = readRec(S); if (!r) return false;
  try { S.setItem(PLAN_KEY, JSON.stringify(Object.assign(cleanRecord(r), { consumed: now || 1 }))); return true; } catch (e) { return false; }
}
