// edit.js - how Juli changes an app a person already made (the edit loop), sized for micro models. A made app is a skeleton, its
// slot values and an optional CUSTOM part: a little code (at most 4 KB) that runs after the skeleton's own code in its own scope and
// draws through the Kit's hooks (K.on('start' | 'draw' | 'tap')). Juli never edits the skeleton's code. A change has three phases,
// each one model in memory (makeapp/host.js runs them as one queue job):
//   PLANNER  the Bigger brain when it can run, else Juli: the request -> 1-4 steps {do: set | edit | look, what, why}. Skipped when a
//            cheap rule says the request is one slot change.
//   WORKER   Juli (Gemma 4 E2B): ONE tool call per model call, as one JSON object with a forced start. After every set / edit the host
//            runs the app itself (no model) and the next prompt hears its errors and what its screen shows. At most 8 calls a request
//            and 2 fix tries a step; a step that still fails is put back as it was, so a broken change is never kept.
//   REVIEWER the Bigger brain or Juli: does the change do what was asked? {"match", "note"}
// Every call is greedy (app.js brainChat), so a retry always changes the prompt: the problem, the last answer, a narrower start.
// The host owns every fact it can compute (the slot rules, what changed, the app's errors, the text on its screen) and checks
// everything a model returns. Pure (no DOM, no engine): node imports it for the tests, as fill.js.
//   const r = await editApp({ plan, step, review, run, look }, ws, 'make the title Chores');   // plan/step/review(messages, opts) -> text
import { validateSlots, codeProblems } from './check.js';
import { tidy } from './fill.js';
import { estTokens } from '../assistant/fit.js';

/** the budgets (tokens are the fit.js estimate, which errs long) */
export const EDIT = { calls: 8, fixes: 2, steps: 4, shows: 2, custom: 4096, history: 10, seconds: 300,
  plan: { prompt: 1400, out: 200 }, step: { prompt: 2800, out: 160, edit: 400 }, review: { prompt: 1200, out: 80 }, look: { out: 120 } };
export const TOOLS = ['show', 'set', 'edit', 'run', 'look', 'ask', 'done'];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const cut = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s; };
const oneLine = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 'ABORTED');
const STOP = new Set('a an the to of in on at for and or with by it its is are be my me i you your this that make change set please can could would should want like so as from into up down all each one new some any them they their there here'.split(' '));
/** colour words a small model writes instead of #rrggbb (the host turns them into the colour) */
export const COLORS = { red: '#e5372c', orange: '#ff8a00', yellow: '#ffcc00', gold: '#d4a017', green: '#2e9e4f', lime: '#7ac943', mint: '#3cc8a0', teal: '#14a3a3',
  cyan: '#22b8d9', blue: '#2f6bff', navy: '#1f3a8a', indigo: '#4f46e5', purple: '#8e44ad', violet: '#7c4dff', pink: '#ff5fa2', magenta: '#d633a8', brown: '#8d5a3b',
  black: '#111111', white: '#ffffff', grey: '#8e8e93', gray: '#8e8e93', silver: '#b8bcc4', coral: '#ff6f61', maroon: '#800000', olive: '#808000', beige: '#e8dcc4' };

// ------------------------------------------------------------------------------------------------ the workspace
/** the top-level declarations of a sketch (the names the custom part can read), each with its first line */
export function sketchFacts(code, max = 60) {
  const out = [];
  for (const raw of String(code || '').split('\n')) {
    const m = /^(?:async\s+)?(const|let|var|function)\s+([A-Za-z_$][\w$]*)/.exec(raw);
    if (!m) continue;
    out.push({ name: m[2], kind: m[1], line: cut(raw.replace(/\s+\/\/.*$/, '').trim(), 110) });
    if (out.length >= max) break;
  }
  return out;
}
/** what the app keeps (its K.load keys and a short sample of each), for a custom part that shows a total of saved numbers */
export function dataFacts(store, max = 4) {
  const out = [];
  for (const [k, v] of Object.entries(store || {}).sort()) {
    if (!/^p0kit:/.test(k) || /^p0kit:(agent\.v1|nb\.|custom\.)/.test(k)) continue;
    out.push({ key: k.slice(6), sample: cut(String(v), 160) });
    if (out.length >= max) break;
  }
  return out;
}
/** ws: what the edit loop works on. JSON only (it sits in the queue job's saved state). bundle = the skeleton, app = the app record. */
export function workspace(bundle, app, store) {
  const m = bundle.manifest, code = (bundle.files || {})['sketch.js'] || '';
  return { name: String((app && app.name) || m.name).slice(0, 30), skel: { id: m.id, name: m.name, description: cut(m.description, 300) },
    spec: clone(m.slots), slots: clone((app && app.slots) || bundle.slots_default || {}), custom: String((app && app.custom) || ''),
    facts: sketchFacts(code), data: dataFacts(store), tabBar: /K\.tabBar\s*\(/.test(code) };
}

// ------------------------------------------------------------------------------------------------ slot paths and rules
/** 'tiles[1].goal' -> ['tiles', 1, 'goal'] (null when it is not a path) */
export function parsePath(p) {
  const s = String(p == null ? '' : p).trim().replace(/^(?:window\.)?SLOTS\./, '');
  if (!/^[A-Za-z_]\w*(?:\[\d+\]|\.[A-Za-z_]\w*)*$/.test(s)) return null;
  const out = []; s.replace(/\[(\d+)\]|[A-Za-z_]\w*/g, (m, i) => { out.push(i != null ? +i : m); return m; });
  return out;
}
const pathText = (path) => path.map((k, i) => (typeof k === 'number' ? `[${k}]` : i ? '.' + k : k)).join('');
/** the rule for the part of a slot a path names (an array's item; an object's field) */
export function specAt(spec, path) {
  let f = spec && spec[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (!f) return null;
    const k = path[i];
    if (typeof k === 'number') { if (typeof f !== 'object' || f.type !== 'array') return null; f = typeof f.item === 'string' ? f.item : { type: 'object', item: f.item, required: true }; }
    else { if (typeof f !== 'object' || f.type !== 'object' || !f.item) return null; f = f.item[k]; }
  }
  return f || null;
}
const getAt = (o, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), o);
function setAt(root, path, v) {
  let o = root;
  for (let i = 0; i < path.length - 1; i++) { if (o == null || typeof o !== 'object' || o[path[i]] == null) return false; o = o[path[i]]; }
  const k = path[path.length - 1];
  if (o == null || typeof o !== 'object') return false;
  if (Array.isArray(o) ? typeof k !== 'number' || k > o.length : typeof k === 'number') return false;
  o[k] = v; return true;
}
const kindOf = (f) => (typeof f === 'string' ? 'string' : (f && f.type) || '');
/** a rule in a few words, for a prompt: "text, max 22", "whole number 1-100", "list of 0-12 {title: text, max 60, ...}" */
export function ruleText(f, deep = true) {
  if (typeof f === 'string') return `text, max ${f.split(':')[1]}`;
  if (!f) return '?';
  const fields = (it) => '{' + Object.entries(it || {}).map(([k, g]) => k + (g && g.required === false ? '?' : '') + ': ' + ruleText(g, false)).join('; ') + '}';
  switch (f.type) {
    case 'string': return `text, max ${f.max}`;
    case 'int': return `whole number ${f.min}-${f.max}`;
    case 'number': return f.min != null && f.max != null ? `number ${f.min}-${f.max}` : f.min != null ? `number from ${f.min}` : 'number';
    case 'bool': return 'true or false';
    case 'enum': return 'one of ' + f.enum.map((x) => JSON.stringify(x)).join(', ');
    case 'icon': return 'an icon name';
    case 'color': return 'a colour #rrggbb';
    case 'ref': return `one of the ${f.ref.split('.')[0]} ${f.ref.split('.')[1]}s`;
    case 'object': return deep ? fields(f.item) : 'an object';
    case 'array': return `list of ${f.min}-${f.max} ` + (typeof f.item === 'string' ? `texts (max ${f.item.split(':')[1]})` : deep ? fields(f.item) : 'items');
    default: return f.type;
  }
}
/** a value in a few characters: lists show their items with their numbers (#0 ...), a nested list its size and its path; a list too
 *  long for n: all its numbers and names, and in full the items `focus` (the step's words) names */
export function valueText(v, n = 220, path = '', focus = '') {
  if (v === undefined || v === null) return '(none)';
  if (!Array.isArray(v)) return cut(JSON.stringify(v), n);
  if (!v.length) return '[] (empty)';
  if (v.every((x) => typeof x !== 'object' || x === null)) return `${v.length} item${v.length === 1 ? '' : 's'}: ` + cut(JSON.stringify(v), n);   // texts: as JSON (a model copies the form it reads)
  const item = (x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return `#${i} ${JSON.stringify(x)}`;
    const parts = Object.entries(x).map(([k, y]) => (Array.isArray(y) ? `${k}: ${y.length} items (${path}[${i}].${k})` : `${k}: ${JSON.stringify(y)}`));
    return `#${i} {${parts.join(', ')}}`;
  };
  let s = `${v.length} item${v.length === 1 ? '' : 's'}: `, k = 0;
  for (; k < v.length; k++) { const t = item(v[k], k); if (s.length + t.length > n && k) break; s += (k ? ' ' : '') + t; }
  if (k >= v.length) return cut(s, n + 80);
  // a long list: every item's number and name (so "remove XRP" finds #4), then in full the ones the step names
  const nameOf = (x) => (x && typeof x === 'object' ? Object.values(x).find((y) => typeof y === 'string') : x);
  const W = ' ' + words(focus).join(' ') + ' ', named = v.map((x, i) => [x, i]).filter(([x]) => { const nm = words(nameOf(x)).join(' '); return nm && W.includes(' ' + nm + ' '); });
  return cut(`${v.length} items: ` + v.map((x, i) => `#${i} ${cut(nameOf(x) || '?', 24)}`).join(' · ') + (named.length ? '; in full: ' + named.slice(0, 2).map(([x, i]) => item(x, i)).join(' ') : ''), n + 260);
}
const singular = (k) => String(k).toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
const SYN = { title: ['title', 'rename', 'call', 'called', 'name', 'heading', 'header'], app_name: ['title', 'rename', 'call', 'called', 'name', 'heading', 'header'],
  accent: ['colour', 'color', 'accent', 'theme', 'tint'], goal: ['goal', 'target'], step: ['step', 'tap', 'per'], unit: ['unit', 'units'],
  session_size: ['session', 'sessions', 'per'], profile_name: ['profile', 'household'], suggestions: ['suggestion', 'suggestions', 'quick'],
  cheers: ['cheer', 'cheers', 'encouragement', 'encouragements'], done_text: ['done', 'reached', 'finished'], note: ['note', 'subtitle', 'under'],
  post_level: ['post', 'alerts', 'level'], alert_level: ['alerts', 'level'], radius_mi: ['radius', 'miles', 'far', 'within'], place_hint: ['town', 'city', 'place'],
  wind_mph: ['wind', 'gust', 'gusts', 'mph'], rain_pct: ['rain', 'snow', 'chance'], hot_f: ['hot', 'heat', 'high'], cold_f: ['cold', 'freeze', 'freezing', 'low'],
  trip_word: ['word', 'call'], currency: ['currency', 'symbol', 'dollar', 'euro'], hero_label: ['label', 'big'], live_stats: ['live', 'tiles'] };
const ADD_RX = /^\s*(?:please\s+)?(?:add|put|include|insert|append|remove|delete|drop|take\s+out|get\s+rid\s+of)\b/i;
const COLOUR_ASK = new RegExp('\\b(?:make|turn|set|change|use|go)\\b(?:\\s+\\S+){0,3}?\\s+(?:' + Object.keys(COLORS).join('|') + ')\\b', 'i');   // "make it red", "turn the app green"
/** which slots a piece of text is about -> [{slot, score}], best first (cheap word overlap, no model) */
export function resolveSlots(text, ws) {
  const T = words(text), set = new Set(T), joined = ' ' + T.join(' ') + ' ', spec = (ws && ws.spec) || {}, out = [];
  const has = (w) => set.has(w) || set.has(w + 's') || set.has(singular(w));
  const says = (v) => typeof v === 'string' && v.length > 2 && joined.includes(' ' + words(v).join(' ') + ' ');
  const adding = ADD_RX.test(text), titled = /\b(title|rename|renamed|(?:call|name) (?:it|the app|this app)|tab)\b/i.test(text);   // a rename: of a title, a tab, or a list item
  const colourAsk = /\b(?:the|its|app'?s|main|theme)\s+colou?r\b|\bcolou?r\s+(?:to|of|it)\b|\b(?:accent|recolou?r|paint|tint)\b/i.test(text) || COLOUR_ASK.test(text);   // not "cards about colours"
  // the lists the request points into: by their noun ("the deck"), by an item's own words ("the Shop list"), by a list inside an item ("a card")
  const L = {};
  for (const [k, f] of Object.entries(spec)) {
    if (kindOf(f) !== 'array') continue;
    const items = Array.isArray(ws.slots && ws.slots[k]) ? ws.slots[k] : [];
    const itemWords = (x) => (typeof x === 'string' ? [x] : Object.entries(x || {}).filter(([k2]) => !(typeof f.item === 'object' && kindOf(f.item[k2]) === 'ref')).map(([, y]) => y));   // not the names it points to
    L[k] = { noun: has(singular(k)) || set.has(k), hit: items.some((x) => itemWords(x).some(says)),
      inner: typeof f.item === 'object' && Object.entries(f.item).some(([k2, g]) => kindOf(g) === 'array' && (has(singular(k2)) || set.has(k2))),
      named: typeof f.item === 'object' && ['name', 'label', 'title'].some((n) => f.item[n]), own: !!(spec[k + '_title'] || spec[singular(k) + '_title']) };
  }
  const listSaid = Object.values(L).some((x) => x.noun || x.hit || x.inner);
  for (const [k, f] of Object.entries(spec)) {
    const nt = k.toLowerCase().split('_').filter(Boolean), t = kindOf(f), l = L[k];
    let s = joined.includes(' ' + nt.join(' ') + ' ') ? 2 + nt.length : nt.filter(has).length * 1.1;
    s += (SYN[k] || []).filter((w) => set.has(w)).length * 1.4;
    if (titled && (k === 'title' || k === 'app_name') && !listSaid) s += 2;   // "call it Tea" is the app's big name
    if (titled && nt.length > 1 && (nt.includes('title') || nt.includes('name')) && nt.some((w) => w !== 'title' && w !== 'name' && has(w))) s += 3;   // "the habits tab"
    if (l) {
      if (l.noun && !nt.some(has)) s += 1.5;   // (its name already counted)
      if (l.hit) s += 2.5;
      if (l.inner) s += 2.5;   // "add a card": the decks
      if (titled && (l.noun || l.hit) && l.named && !l.own) s += 2.5;   // "rename the deck"
      else if (titled && !l.noun && !l.hit) s -= 2;
      if (adding) s += 0.4;
      // an item named in a list that another list's items point to ("add eggs to the Shop list"): the adding is to that other list (the tasks)
      if (adding && typeof f.item === 'object') for (const g of Object.values(f.item)) if (kindOf(g) === 'ref' && L[g.ref.split('.')[0]] && L[g.ref.split('.')[0]].hit) s += 3.5;
      if (adding && l.hit && Object.entries(L).some(([k3]) => k3 !== k && typeof spec[k3].item === 'object' && Object.values(spec[k3].item).some((g) => kindOf(g) === 'ref' && g.ref.split('.')[0] === k))) s -= 1.5;
    }
    if (t === 'color' && colourAsk) s += k === 'accent' ? 3 : 1;   // "make it red": the app's colour ("rojo means red" is a card's words)
    if (t === 'enum') s += f.enum.filter((e) => set.has(String(e).toLowerCase())).length * 1.5;
    if ((t === 'int' || t === 'number') && /\d/.test(text)) s += 0.3;
    if (typeof f === 'object' && f.desc) s += Math.min(1.8, words(f.desc).filter((w) => w.length > 3 && !STOP.has(w) && set.has(w)).length * 0.6);
    if (says(ws.slots ? ws.slots[k] : undefined)) s += 1.5;   // the slot's own words named in the request
    if (s > 0) out.push({ slot: k, score: +s.toFixed(2) });
  }
  return out.sort((a, b) => b.score - a.score);
}
// words that ask for something drawn (the custom part): STRONG ones always, the others unless the request names the slot itself
const CUSTOM_STRONG = /\b(lines?|footer|banner|totals?|sum|average|how many|number of|counts? of|clock|draw)\b/i;
const CUSTOMISH = /\b(lines?|footer|banner|totals?|sum|average|how many|number of|counts? of|display|draw|buttons?|labels?|texts?|show(?:s|ing)?|clock|date|time|message)\b/i;
const MULTI = /[,;]|\b(and|also|plus|then|as well)\b/i;
const named = (slot, text) => new RegExp('\\b' + slot.split('_').join('[ _]') + '\\b', 'i').test(String(text || ''));
/** the cheap rule: is this request ONE slot change? -> that slot's name, or a deck's cards path (the planner is skipped), or null */
export function oneSlot(request, ws) {
  const t = String(request || ''), c = resolveSlots(t, ws);
  if (!c.length || CUSTOM_STRONG.test(t)) return null;
  const top = c[0], f = ws.spec[top.slot], list = kindOf(f) === 'array';
  if (CUSTOMISH.test(t) && !named(top.slot, t)) return null;
  if (MULTI.test(t) && !(list && ADD_RX.test(t))) return null;
  if (top.score < 2.5 || (c[1] && c[1].score * 1.4 > top.score)) return null;
  if (list && typeof f.item === 'object' && Object.values(f.item).some((g) => kindOf(g) === 'array')) {   // decks of cards: one deck's cards, else the planner
    const p = pathFor(ws, top.slot, t);
    return p !== top.slot ? p : null;
  }
  return top.score >= 3 ? top.slot : null;
}
/** the slot a step's own words name surely (a clear best match), or null */
function sureSlot(ws, text) {
  const c = resolveSlots(text, ws);
  return c[0] && c[0].score >= 2.5 && (!c[1] || c[1].score * 1.5 <= c[0].score) ? c[0].slot : null;
}
/** for a list step: the path the step most likely means (a deck's cards when there is one deck) */
function pathFor(ws, slot, text) {
  const f = ws.spec[slot], v = ws.slots[slot], W = new Set(words(text));
  if (kindOf(f) !== 'array' || typeof f.item !== 'object' || !Array.isArray(v) || v.length !== 1) return slot;
  const inner = Object.entries(f.item).find(([k, g]) => kindOf(g) === 'array' && (W.has(singular(k)) || W.has(k)));
  return inner ? `${slot}[0].${inner[0]}` : slot;
}

// ------------------------------------------------------------------------------------------------ tolerant parsing
function endOf(t, a) {   // the index of the '}' that closes the object opened at a (strings and escapes respected), or -1
  let depth = 0, str = false, esc = false;
  for (let i = a; i < t.length; i++) {
    const c = t[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { depth--; if (!depth) return i; }
  }
  return -1;
}
function repair(s) {   // raw newlines and tabs inside strings, smart quotes, trailing commas: what a 2B model's JSON often has
  let out = '', str = false, esc = false;
  for (const c of s.replace(/[“”]/g, '"')) {
    if (str) { if (esc) { esc = false; out += c; continue; } if (c === '\\') { esc = true; out += c; continue; } if (c === '"') str = false;
      out += c === '\n' ? '\\n' : c === '\r' ? '' : c === '\t' ? '\\t' : c; continue; }
    if (c === '"') str = true; out += c;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}
/** the first JSON object in a model's answer (code fences, text around it, the small slips repaired) */
export function parseObj(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```[\s\S]*$/, '').trim();
  const a = t.indexOf('{');
  if (a < 0) throw Object.assign(new Error('no JSON object in the answer'), { code: 'NO_JSON' });
  const b = endOf(t, a), s = b > 0 ? t.slice(a, b + 1) : t.slice(a);
  try { return JSON.parse(s); } catch (e) { /* the repairs */ }
  return JSON.parse(repair(s));
}
const unq = (s) => s.replace(/\\(["\\/nrt]|u[0-9a-fA-F]{4})/g, (m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '' : c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));
function editFallback(text) {   // an edit whose code has unescaped quotes: find is the first field, replace the last (to the final quote)
  const t = String(text || '');
  if (!/"tool"\s*:\s*"edit"/.test(t)) return null;
  const f = /"find"\s*:\s*"([\s\S]*?)"\s*,\s*"replace"\s*:\s*"/.exec(t);
  if (!f) return null;
  const rest = t.slice(f.index + f[0].length), end = rest.lastIndexOf('"');
  return end < 0 ? null : { tool: 'edit', find: unq(f[1]), replace: unq(rest.slice(0, end)) };
}
const TOOL_ALIAS = { set_slot: 'set', setslot: 'set', change: 'set', update: 'set', slot: 'set', code: 'edit', custom: 'edit', write: 'edit', view: 'show', read: 'show',
  test: 'run', check: 'look', see: 'look', question: 'ask', finish: 'done', stop: 'done' };
/** one tool call from a model's answer -> {tool, ...} (the fields named as the schema names them) or null */
export function parseTool(text) {
  let o = null;
  try { o = parseObj(text); } catch (e) { o = editFallback(text); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  let name = String(o.tool || o.name || o.action || '').toLowerCase().trim();
  name = TOOL_ALIAS[name] || name;
  if (!TOOLS.includes(name)) return null;
  const s = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
  if (name === 'set') {
    const t = { tool: 'set', slot: s(o.slot != null ? o.slot : o.path != null ? o.path : o.key != null ? o.key : o.field).trim() };
    if (o.add !== undefined) t.add = o.add; else if (o.remove !== undefined) t.remove = o.remove;
    else if (o.value !== undefined) t.value = o.value; else if (o.to !== undefined) t.value = o.to; else if (o.values !== undefined) t.value = o.values;
    return t;
  }
  if (name === 'edit') {   // a missing replace stays missing (undefined): it is not "remove the find text"
    const rep = o.replace != null ? o.replace : o.new != null ? o.new : o.code != null ? o.code : o.text;
    return { tool: 'edit', find: s(o.find != null ? o.find : o.old != null ? o.old : o.search), replace: rep == null ? undefined : s(rep) };
  }
  if (name === 'show') return { tool: 'show', what: ['slots', 'custom', 'screen'].includes(o.what) ? o.what : 'slots' };
  if (name === 'look' || name === 'ask') return { tool: name, question: cut(oneLine(o.question != null ? o.question : o.q != null ? o.q : o.text), 300) };
  if (name === 'done') return { tool: 'done', summary: cut(oneLine(o.summary != null ? o.summary : o.note), 200) };
  return { tool: 'run' };
}
const DO_ALIAS = { change: 'set', update: 'set', slot: 'set', setting: 'set', code: 'edit', custom: 'edit', draw: 'edit', add: 'edit', write: 'edit', check: 'look', see: 'look', view: 'look' };
/** the planner's answer -> 1-4 steps {do, what, why} (a step it can't use is dropped; nothing usable -> one step made by rule) */
export function parsePlan(text, ws, request) {
  let o = null; try { o = parseObj(text); } catch (e) { o = null; }
  const raw = o && Array.isArray(o.steps) ? o.steps : [];
  const steps = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    let d = String(x.do || x.tool || x.type || '').toLowerCase().trim(); d = DO_ALIAS[d] || d;
    const what = cut(oneLine(x.what || x.change || x.slot || ''), 160);
    if (!['set', 'edit', 'look'].includes(d) || !what || steps.some((y) => y.do === d && y.what === what)) continue;
    // a step that starts with a real slot ("decks[0].name to Spanish 1") is a set on it, whatever the planner called it
    const m = /^\s*([A-Za-z_]\w*(?:\[\d+\]|\.[A-Za-z_]\w*)*)\s+(?:to|=|:)\s+/.exec(what), p = m && parsePath(m[1]);
    const slot = d !== 'look' && p && ws && ws.spec && ws.spec[p[0]] && specAt(ws.spec, p) ? m[1] : null;
    if (slot) d = 'set';
    // an "edit" with nothing to draw in it that clearly names a slot ("remove XRP from the watchlist": an item of the list) is a set
    else if (d === 'edit' && ws && !CUSTOMISH.test(what + ' ' + request) && (resolveSlots(what + ' ' + request, ws)[0] || { score: 0 }).score >= 2.5) d = 'set';
    steps.push(Object.assign({ do: d, what, why: cut(oneLine(x.why || ''), 120) }, slot ? { slot } : {}));
    if (steps.length >= EDIT.steps) break;
  }
  if (!steps.some((x) => x.do !== 'look')) steps.unshift(ruleStep(request, ws));   // a plan that changes nothing: the request as one step
  // every part of the request is in the plan: a clause no step mentions ("... and make the steps tile add 500") becomes a step by rule
  const said = new Set(words(steps.map((x) => x.what + ' ' + x.why).join(' ')).map(singular)), parts = clauses(request);
  for (const cl of parts.length > 1 ? parts : []) {   // (a one-part request: the plan is for it)
    const w = words(cl).filter((x) => x.length > 2 && !STOP.has(x));
    if (w.length >= 2 && w.filter((x) => said.has(singular(x))).length < w.length / 2 && steps.length < EDIT.steps) { const st = ruleStep(cl, ws); steps.push(st); words(st.what).forEach((x) => said.add(singular(x))); }
  }
  return steps.slice(0, EDIT.steps);
}
/** a request's parts: split at "and" / "then" / ";" / "," before a verb (a list of names, "Laundry, Dishes and Trash", stays whole) */
export function clauses(request) {
  return String(request || '').split(/\s*(?:[;.]|,?\s+(?:and then|then|and also|also|and|plus)\s+|,\s*)(?=(?:please\s+)?(?:make|set|change|add|remove|rename|call|use|show|put|turn|count|flag|watch|only|give|draw|move|delete|take|let|keep|switch)\b)/i)
    .map((s) => s.trim()).filter(Boolean);
}
/** the step a request makes without a planner: one slot (the cheap rule) or an addition to the custom part */
export function ruleStep(request, ws) {
  const slot = oneSlot(request, ws);
  if (slot) return { do: 'set', what: cut(oneLine(request), 160), why: 'one setting', slot };
  const c = resolveSlots(request, ws);
  return CUSTOM_STRONG.test(request) || (CUSTOMISH.test(request) && !(c[0] && c[0].score >= 3)) ? { do: 'edit', what: cut(oneLine(request), 160), why: 'no setting does this' } : { do: 'set', what: cut(oneLine(request), 160), why: '' };
}
/** the reviewer's answer -> {match, note} or null */
export function parseReview(text) {
  let o = null; try { o = parseObj(text); } catch (e) { const m = /"?match"?\s*:\s*(true|false)/i.exec(String(text || '')); o = m ? { match: m[1].toLowerCase() === 'true' } : null; }
  if (!o || typeof o.match !== 'boolean') { if (o && (o.match === 'true' || o.match === 'false')) o.match = o.match === 'true'; else return null; }
  return { match: o.match, note: cut(oneLine(o.note || o.problem || ''), 200) };
}

// ------------------------------------------------------------------------------------------------ applying a tool (pure)
/** the custom part's own rules (on top of the skeleton rules in check.js): it only draws on the app's screen */
export function customProblems(code) {
  const c = String(code || ''), out = codeProblems(c).map((x) => 'the custom part ' + x);
  const bare = c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');
  if (/\bp0\s*\.\s*(?:fetch|juli|chat|location|onCheck)\b/.test(bare)) out.push('the custom part may not use p0 (it only draws on the screen)');
  if (/\bK\s*\.\s*(?:agent|ask|notebook)\s*\(/.test(bare)) out.push('the custom part may not use K.agent, K.ask or K.notebook');
  if (/\bK\s*\.\s*save\s*\(\s*(?!['"`]custom\.)/.test(bare)) out.push("the custom part saves only under its own keys: K.save('custom.name', value)");
  if (/\bSLOTS\b(?:\s*\.\s*\w+|\s*\[[^\]]*\])+\s*=(?!=)/.test(bare)) out.push('the custom part only reads SLOTS: a slot is changed with {"tool":"set", ...}');
  if (/\bfunction\s+(?:setup|draw|preload)\s*\(|(?:^|[^.\w$])(?:window\.)?(?:setup|draw)\s*=[^=]/.test(bare)) out.push("use K.on('draw', () => { ... }) instead of a draw() function");
  if (/\b(?:createCanvas|resizeCanvas|noLoop|noCanvas)\s*\(|\bdocument\s*\./.test(bare)) out.push('the custom part draws on the app\'s own canvas (no createCanvas, noLoop or document)');
  if (c.trim() && !/\bK\s*\.\s*on\s*\(/.test(bare)) out.push("the custom part does its work in K.on('draw', () => { ... }) (or K.on('start' / 'tap'))");
  return out;
}
const NEUTRAL = { int: (f) => Math.max(f.min, Math.min(f.max, 0)), number: (f) => Math.max(f.min == null ? 0 : f.min, Math.min(f.max == null ? 0 : f.max, 0)), bool: () => false,
  enum: (f) => f.enum[0], icon: () => 'star', color: (f, ws) => (ws && /^#[0-9a-fA-F]{6}$/.test(String((ws.slots || {}).accent || '')) ? ws.slots.accent : '#8e8e93'),
  ref: (f, ws) => { const [a, k] = f.ref.split('.'); const l = ((ws && ws.slots) || {})[a]; return Array.isArray(l) && l[0] ? l[0][k] : undefined; } };
/** a new list item with the small model's slips fixed: colour words, a field it left out (numbers, choices, refs: a neutral value;
 *  a missing text stays missing, so the check says so) */
function fixItem(f, x, ws) {
  if (typeof f === 'string') {   // a text written as an object ({"text": "Laundry"}, {"index": 0, "name": "Laundry"}): its one text
    if (x && typeof x === 'object' && !Array.isArray(x)) { const t = Object.values(x).filter((y) => typeof y === 'string'); if (t.length === 1) return t[0]; }
    return x;
  }
  if (!f) return x;
  if (f.type === 'color' && typeof x === 'string' && COLORS[x.trim().toLowerCase()]) return COLORS[x.trim().toLowerCase()];
  if (f.type !== 'object' || !x || typeof x !== 'object' || Array.isArray(x)) return x;
  const o = Object.assign({}, x);
  for (const [k, g] of Object.entries(f.item || {})) {
    if (o[k] === undefined && typeof g === 'object' && g.required !== false && NEUTRAL[g.type]) { const v = NEUTRAL[g.type](g, ws); if (v !== undefined) o[k] = v; }
    else if (o[k] !== undefined) o[k] = fixItem(g, o[k], ws);
  }
  return o;
}
function refsTo(spec, target) {   // every [slot, field] whose rule is a ref to target ('lists.name')
  const out = [];
  for (const [k, f] of Object.entries(spec || {})) {
    if (kindOf(f) === 'ref' && f.ref === target) out.push([k, null]);
    if (kindOf(f) === 'array' && typeof f.item === 'object') for (const [k2, g] of Object.entries(f.item)) if (kindOf(g) === 'ref' && g.ref === target) out.push([k, k2]);
  }
  return out;
}
/** a renamed list item (lists[0].name "Inbox" -> "Home") takes along every slot that named it (the tasks of that list) */
function followRenames(spec, path, before, after) {
  if (typeof path[1] !== 'number' || path.length > 3) return;
  const i0 = getAt(before, path.slice(0, 2)), i1 = getAt(after, path.slice(0, 2));
  if (!i0 || !i1 || typeof i0 !== 'object' || typeof i1 !== 'object') return;
  for (const k2 of Object.keys(i0)) {
    const a = i0[k2], b = i1[k2];
    if (typeof a !== 'string' || typeof b !== 'string' || a === b) continue;
    for (const [k, f2] of refsTo(spec, `${path[0]}.${k2}`)) { if (!f2) { if (after[k] === a) after[k] = b; } else for (const x of after[k] || []) if (x && x[f2] === a) x[f2] = b; }
  }
}
/** a list along the path that is now longer than its rule allows (tidy would cut it silently) -> a problem, or null */
function overMax(spec, slots, path) {
  for (let n = 1; n <= path.length; n++) {
    const f = specAt(spec, path.slice(0, n)), v = getAt(slots, path.slice(0, n));
    if (kindOf(f) === 'array' && Array.isArray(v) && v.length > f.max) return `${pathText(path.slice(0, n))} can have at most ${f.max} items (it would have ${v.length}): to replace them, give the whole new list as "value": [...]; else remove some first`;
  }
  return null;
}
const lines = (s) => (s ? String(s).split('\n').length : 0);
/** a remove that took out an item the request does not name, while it names another item of that list -> the problem, or null */
export function wrongRemove(ws0, ws1, slot, text) {
  const path = parsePath(slot); if (!path) return null;
  const a = getAt(ws0.slots, path), b = getAt(ws1.slots, path);
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const nm = (x) => words(x && typeof x === 'object' ? Object.values(x).find((y) => typeof y === 'string') : x).join(' ');
  const W = ' ' + words(text).join(' ') + ' ', B = b.map((x) => JSON.stringify(x));
  const gone = a.filter((x) => !B.includes(JSON.stringify(x))), named = a.map((x, i) => [nm(x), i]).filter(([n]) => n && W.includes(' ' + n + ' '));
  if (!named.length || !gone.length || gone.some((x) => named.some(([n]) => n === nm(x)))) return null;
  return `that takes out “${cut(nm(gone[0]), 30)}”, but the request names “${cut(named[0][0], 30)}” (#${named[0][1]}): remove [${named.map(([, i]) => i).join(', ')}]`;
}
/** custom code with line numbers (for a prompt) */
export function numbered(code, max = 1600) { return cut(String(code || '').split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n'), max); }
/** slotsText(ws, names, n, focus) -> the slots as prompt lines: "- name (rule): desc | now: value" */
export function slotsText(ws, names, n = 220, focus = '') {
  return (names || Object.keys(ws.spec || {})).filter((k) => ws.spec[k]).map((k) => {
    const f = ws.spec[k], d = typeof f === 'object' && f.desc ? ': ' + cut(f.desc, 70) : '';
    return `- ${k} (${ruleText(f)})${d} | now: ${valueText(ws.slots[k], n, k, focus)}`;
  }).join('\n');
}
/** applyTool(ws, tool) -> {ws, observation, changed, problem?, done?, needs?}: set and edit change a COPY of the workspace after the
 *  host's checks; show reads it; run / look / ask need the host (needs); done ends the step */
export function applyTool(ws, tool) {
  const keep = (observation, extra) => Object.assign({ ws, observation, changed: false }, extra || {});
  const bad = (problem) => keep('not used: ' + problem, { problem });
  if (!tool || !TOOLS.includes(tool.tool)) return bad('that is not one of the tools');
  if (tool.tool === 'show') {
    if (tool.what === 'screen') return keep(null, { needs: 'run' });
    if (tool.what === 'custom') return keep(ws.custom ? 'THE CUSTOM PART:\n' + numbered(ws.custom) : 'The custom part is empty.');
    return keep('SLOTS:\n' + slotsText(ws));
  }
  if (tool.tool === 'done') return keep('done', { done: true });
  if (tool.tool === 'run' || tool.tool === 'look' || tool.tool === 'ask') return keep(null, { needs: tool.tool });
  if (tool.tool === 'set') {
    const path = parsePath(tool.slot);
    if (!path) return bad(`"${cut(tool.slot, 40)}" is not a slot name`);
    if (!ws.spec[path[0]]) return bad(`there is no slot "${path[0]}" (the slots are: ${Object.keys(ws.spec).join(', ')})`);
    const f = specAt(ws.spec, path);
    if (!f) return bad(`"${pathText(path)}" is not a part of the ${path[0]} slot`);
    const slots = clone(ws.slots), before = getAt(ws.slots, path);
    if (tool.add !== undefined || tool.remove !== undefined) {
      if (kindOf(f) !== 'array') return bad(`${pathText(path)} is not a list (set its "value" instead)`);
      const list = Array.isArray(before) ? clone(before) : [];
      const nameOf = (x) => words(typeof x === 'string' ? x : Object.values(x || {}).find((y) => typeof y === 'string') || '').join(' ');
      if (tool.add !== undefined) for (const x0 of Array.isArray(tool.add) ? tool.add : [tool.add]) {
        const x = fixItem(typeof f.item === 'string' ? f.item : { type: 'object', item: f.item }, x0, ws), i = nameOf(x) ? list.findIndex((y) => nameOf(y) === nameOf(x)) : -1;
        if (i >= 0) {   // one that is there already ("add a Steps tile" with a Steps tile): its own part is what changes
          const k = x && typeof x === 'object' && list[i] && typeof list[i] === 'object' ? Object.keys(x).find((y) => !same(x[y], list[i][y])) : null;
          return bad(`${pathText(path)} already has “${cut(nameOf(x), 30)}” (#${i})` + (k ? `: to change it, set ${pathText(path)}[${i}].${k}` : ''));
        }
        list.push(x);
      }
      else {
        const rm = (Array.isArray(tool.remove) ? tool.remove : [tool.remove]).map((r) => (typeof r === 'number' ? r : /^\d+$/.test(String(r)) ? +r
          : list.findIndex((x) => words(typeof x === 'string' ? x : Object.values(x || {}).find((y) => typeof y === 'string') || '').join(' ') === words(r).join(' '))));
        if (rm.some((i) => !(i >= 0 && i < list.length))) return bad(`remove takes item numbers from 0 to ${list.length - 1} (or an item's exact name)`);
        for (const i of [...new Set(rm)].sort((a, b) => b - a)) list.splice(i, 1);
      }
      if (path.length === 1) slots[path[0]] = list; else if (!setAt(slots, path, list)) return bad(`${pathText(path)} is not in the app`);
    } else {
      if (tool.value === undefined) return bad('a set needs a "value" (or "add" / "remove" for a list)');
      let v = fixItem(f, tool.value, ws);
      if (kindOf(f) === 'array' && Array.isArray(v)) v = v.map((x) => fixItem(typeof f.item === 'string' ? f.item : { type: 'object', item: f.item }, x, ws));
      if (path.length > 1) v = tidy({ x: f }, { x: v }).x;
      if (path.length === 1) slots[path[0]] = v; else if (!setAt(slots, path, v)) return bad(`${pathText(path)} is not in the app (a list has items 0 to ${Math.max(0, (getAt(ws.slots, path.slice(0, -1)) || []).length - 1)})`);
      followRenames(ws.spec, path, ws.slots, slots);
    }
    const om = overMax(ws.spec, slots, path);
    if (om) return bad(om);
    slots[path[0]] = tidy({ [path[0]]: ws.spec[path[0]] }, { [path[0]]: slots[path[0]] })[path[0]];
    const was = new Set(validateSlots(ws.spec, ws.slots)), now = validateSlots(ws.spec, slots).filter((x) => !was.has(x));
    if (now.length) return bad(now.slice(0, 4).join('; '));
    const after = getAt(slots, path);
    if (same(slots, ws.slots)) return keep(`${pathText(path)} already is ${cut(JSON.stringify(after), 80)}: nothing changed`, { same: true });
    return { ws: Object.assign({}, ws, { slots }), changed: true, observation: `set ${pathText(path)}: ${cut(JSON.stringify(before === undefined ? null : before), 70)} -> ${cut(JSON.stringify(after), 90)}` };
  }
  // edit: the custom part (find "" adds to its end)
  if (tool.replace === undefined) return bad('an edit needs "replace": the new text ("replace": "" takes the find text out)');
  const cur = String(ws.custom || ''), find = String(tool.find || ''), rep = String(tool.replace || '').replace(/\r\n?/g, '\n');
  let next;
  if (!find.trim()) { if (!rep.trim()) return bad('the replace text is empty'); next = cur.trim() ? cur.replace(/\s*$/, '') + '\n' + rep.trim() : rep.trim(); }
  else {
    const n = cur.split(find).length - 1;
    if (n > 1) return bad(`the find text is in the custom part ${n} times: give a longer piece`);
    if (n === 1) next = cur.replace(find, () => rep);
    else {   // the same text with other spacing
      const esc = find.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), m = esc ? cur.match(new RegExp(esc, 'g')) : null;
      if (!m || m.length !== 1) return bad(cur ? 'the find text is not in the custom part (copy it exactly, or use "" to add new code at the end)' : 'the custom part is empty: use "find": "" to add code');
      next = cur.replace(new RegExp(esc), () => rep);
    }
  }
  next = next.replace(/\n{3,}/g, '\n\n');
  if (next.length > EDIT.custom) return bad(`the custom part would be ${next.length} characters (at most ${EDIT.custom}): keep it shorter`);
  const pr = customProblems(next);
  if (pr.length) return bad(pr.slice(0, 3).join('; '));
  if (next === cur) return keep('the custom part already says that: nothing changed', { same: true });
  return { ws: Object.assign({}, ws, { custom: next }), changed: true, observation: `custom part: ${lines(cur)} -> ${lines(next)} lines` };
}

// ------------------------------------------------------------------------------------------------ what the host saw
/** the host's test run -> plain words (the next prompt's LAST RESULT). run = {booted, fatal, errors, customErrors, screen: {w, h, scene,
 *  buttons, texts: [{s, x, y, c}]}} (texts the custom part drew have c: 1) */
export function runText(run, n = 520) {
  if (!run) return 'The app was not run.';
  if (!run.booted) return 'The app did not start: ' + cut(run.fatal || (run.errors || [])[0] || 'no answer', 200);
  const out = [];
  if ((run.customErrors || []).length) out.push('The custom part failed: ' + cut(run.customErrors[0], 200) + '.');
  if ((run.errors || []).length) out.push('The app had an error: ' + cut(run.errors[0], 200) + '.');
  if (!out.length) out.push('The app runs with no errors.');
  const sc = run.screen || {}, H = sc.h || 844, W = sc.w || 390, T = sc.texts || [];
  const where = (t) => (t.y < 0 || t.y > H || t.x < 0 || t.x > W ? 'OFF the screen' : t.y < H / 3 ? 'at the top' : t.y > H * 2 / 3 ? 'at the bottom' : 'in the middle');
  const mine = T.filter((t) => t.c);
  if (mine.length) out.push('The custom part draws: ' + mine.slice(0, 4).map((t) => `"${cut(t.s, 50)}" ${where(t)}`).join(', ') + '.');
  const other = [...new Set(T.filter((t) => !t.c).map((t) => oneLine(t.s)).filter(Boolean))];
  if (other.length) out.push(`The screen${sc.scene ? ` "${sc.scene}"` : ''} shows: ` + cut(other.slice(0, 14).map((s) => cut(s, 30)).join(' · '), 260) + '.');
  return cut(out.join(' '), n);
}
/** the run's problems the change caused (an error the app already had before the change does not count) */
export function runProblems(run, base) {
  if (!run) return ['the app was not run'];
  if (!run.booted) return ['the app did not start: ' + cut(run.fatal || (run.errors || [])[0] || 'no answer', 160)];
  const had = new Set(((base && base.errors) || []).concat((base && base.customErrors) || []));
  return [...(run.customErrors || []).filter((e) => !had.has(e)).map((e) => 'the custom part failed: ' + e), ...(run.errors || []).filter((e) => !had.has(e)).map((e) => 'the app had an error: ' + e)]
    .filter((e, i, a) => a.indexOf(e) === i).slice(0, 2).map((e) => cut(e, 220));
}
/** one value's change in plain words, into out: a list's added / removed items by their names; an item changed in place: its own
 *  fields ("decks[0].cards: 6 -> 7 items (added “rojo”)", "tiles[1].goal: 8 -> 10"), a few levels deep */
function diffInto(out, what, p, a, b, depth) {
  if (same(a, b)) return;
  const name = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? Object.values(x).find((y) => typeof y === 'string') || '' : String(x));
  if (Array.isArray(a) && Array.isArray(b)) {
    const A = a.map((x) => JSON.stringify(x)), B = b.map((x) => JSON.stringify(x));
    if (a.length === b.length && depth < 3 && a.every((x, i) => x && b[i] && typeof x === 'object' && typeof b[i] === 'object')) {   // changed in place
      const n = out.length; a.forEach((x, i) => diffInto(out, what, `${p}[${i}]`, x, b[i], depth + 1)); if (out.length > n) return;
    }
    const added = b.filter((x, i) => !A.includes(B[i])).map(name), gone = a.filter((x, i) => !B.includes(A[i])).map(name), bits = [];
    if (added.length) bits.push('added ' + added.slice(0, 6).map((x) => `“${cut(x, 30)}”`).join(', '));
    if (gone.length) bits.push('removed ' + gone.slice(0, 6).map((x) => `“${cut(x, 30)}”`).join(', '));
    out.push({ what, text: `${p}: ${a.length} -> ${b.length} items` + (bits.length ? ' (' + bits.join('; ') + ')' : ' (changed)') });
  } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) && depth < 3) {
    for (const k of Object.keys(Object.assign({}, a, b))) diffInto(out, what, `${p}.${k}`, a[k], b[k], depth + 1);
  } else out.push({ what, text: `${p}: ${cut(JSON.stringify(a === undefined ? null : a), 60)} -> ${cut(JSON.stringify(b === undefined ? null : b), 80)}` });
}
/** changesOf(ws0, ws1) -> [{what, text}]: what changed, in plain words (the result card, the reviewer) */
export function changesOf(ws0, ws1) {
  const out = [];
  for (const k of Object.keys(Object.assign({}, ws0.spec, ws1.spec))) diffInto(out, k, k, (ws0.slots || {})[k], (ws1.slots || {})[k], 0);
  if (String(ws0.custom || '') !== String(ws1.custom || '')) {
    const n0 = lines(ws0.custom), n1 = lines(ws1.custom);
    out.push({ what: 'custom', text: !n1 ? 'the added part was taken out' : !n0 ? `added part: ${n1} line${n1 === 1 ? '' : 's'} of code` : `added part: ${n0} -> ${n1} lines` });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the prompts
const FIT = (messages, o) => estTokens(messages, o);
/** shrink(parts, build, budget): drop or cut the parts marked trim (last first) until the prompt fits */
function fitParts(parts, build, budget, prefix) {
  let msgs = build(parts);
  for (let pass = 0; pass < 24 && FIT(msgs, { prefix }) > budget; pass++) {
    const i = parts.map((p, k) => (p.trim && p.text ? k : -1)).filter((k) => k >= 0).pop();
    if (i == null) break;
    const p = parts[i]; p.text = p.text.length > 240 ? cut(p.text, Math.floor(p.text.length * 0.55)) : ''; msgs = build(parts);
  }
  return msgs;
}
const PLAN_SYS = (ws) => `You plan a change to an app on a phone. The app "${ws.name}" is a ${ws.skel.name} app: ${ws.skel.description}\n` +
  'It has SLOTS (its settings, below) and a CUSTOM part: a little code that draws extra things on top of the app.\n' +
  'Plan the fewest steps (1 to 4), in order. Each step is one of:\n' +
  '- set: change one slot (say which slot and the new value)\n' +
  '- edit: add or change the custom part, only for what no slot can do (a new line of text, a total, a footer)\n' +
  '- look: check the app\'s screen for something the slots can\'t tell\n' +
  'Reply with ONE JSON object and nothing else, like {"steps":[{"do":"set","what":"title to Chores","why":"the person renamed it"}]}. ' +
  'Never invent live facts (prices, weather). No advice to buy, sell or hold anything.';
/** the planner's prompt (<= 1400 tokens: the slots shown shorter until it fits) -> {messages, opts: {maxTokens, prefix}} */
export function planMessages(ws, request, { skill = '', about = '' } = {}) {   // 3.9: about = About me's framed block (<= 80 tokens)
  const prefix = '{"steps":[{"do":"';
  const parts = [{ text: 'SLOTS:\n' + slotsText(ws, null, 160), trim: true },
    { text: ws.custom ? `CUSTOM PART (${lines(ws.custom)} lines):\n` + numbered(ws.custom, 500) : 'CUSTOM PART: empty', trim: true },
    { text: about ? cut(about, 600) : '', trim: true },   // 3.9: About me: trimmed after the guidance, before the custom part and the slots
    { text: skill ? 'GUIDANCE (p0pc0rn\'s own rules come first):\n' + cut(skill, 1600) : '', trim: true }];
  const build = (P) => [{ role: 'system', content: PLAN_SYS(ws) + '\n\n' + P.map((p) => p.text).filter(Boolean).join('\n\n') }, { role: 'user', content: 'REQUEST: ' + cut(oneLine(request), 400) }];
  return { messages: fitParts(parts, build, EDIT.plan.prompt, prefix), opts: { maxTokens: EDIT.plan.out, prefix } };   // the guidance goes first, the slots last
}
const STEP_SYS = 'You change an app on a phone, one small step at a time. Answer with ONE JSON object, a tool call, and nothing else.\nTOOLS:\n' +
  '{"tool":"set","slot":"title","value":"Chores"}  set a slot (or a part of one: "tiles[1].goal")\n' +
  '{"tool":"set","slot":"tasks","add":[{...}]}  add items to a list slot ("remove":[0] takes items out by number)\n' +
  '{"tool":"edit","find":"","replace":"code"}  add code to the custom part ("find": the exact old text, to change it)\n' +
  '{"tool":"look","question":"..."}  look at the app\'s screen\n{"tool":"ask","question":"..."}  ask the person, only when the request is unclear\n' +
  '{"tool":"done","summary":"..."}  this step needs nothing more\n' +
  'Use the slot rules exactly. Never invent live facts (prices, weather). No advice to buy, sell or hold anything.';
const EDIT_GUIDE = (ws) => 'THE CUSTOM PART: JavaScript that runs after the app\'s own code, in its own scope. The app\'s code stays as it is.\n' +
  "- K.on('draw', () => { ... })  runs every frame after the app draws: draw text or shapes on top\n" +
  "- K.on('start', () => { ... })  once, when the app starts; K.on('tap', (p) => { ... })  p = {x, y}: a tap the app did not use\n" +
  "- K.text(str, x, y, role, color, {align: 'left' | 'center' | 'right'})  roles: title headline body subhead footnote caption\n" +
  '- K.rect(x, y, w, h, {fill, r}), K.circle(x, y, r, {fill}), K.button(id, x, y, w, h, label) -> true when tapped, K.toast(text)\n' +
  '- K.W, K.H: the screen size; K.safe.bottom: the bottom inset; colours K.C.text, K.C.text2, K.C.accent, K.C.surface, K.C.good, K.C.bad\n' +
  '- SLOTS.<name>: the slot values; the app\'s own names (below) can be read\n' +
  `- a free spot for one short line: x = K.W / 2 with {align: 'center'}, y = ${ws.tabBar ? 'K.H - K.tabBar.height() - 14 (above the tab bar)' : 'K.H - K.safe.bottom - 22 (the bottom)'}\n` +
  "Rules: single quotes in the code (it sits inside a JSON string); no network, no p0, no HTML; storage only K.save('custom.name', value); at most 30 lines.\n" +
  `Example: {"tool":"edit","find":"","replace":"K.on('draw', () => { K.text('Made by me', K.W / 2, ${ws.tabBar ? 'K.H - K.tabBar.height() - 14' : 'K.H - K.safe.bottom - 22'}, 'footnote', K.C.text2, { align: 'center' }); });"}`;
/** the names of the app's own code that a step may need, best first (word overlap with the step) */
function factsFor(ws, text, max = 10) {
  const W = new Set(words(text).filter((w) => !STOP.has(w)));
  const score = (f) => { const ws2 = words(f.name.replace(/([a-z])([A-Z])/g, '$1 $2') + ' ' + f.line); return ws2.filter((w) => W.has(w) || W.has(singular(w))).length + (f.kind === 'let' ? 1 : 0) + (/\bSL\.|SLOTS/.test(f.line) ? 0.6 : 0); };
  return (ws.facts || []).map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.f.line);
}
/** what a step works on -> {names (the slots the worker sees), path (the slot or part it is forced to, or null), prefix (the forced start
 *  of its answer)}. The forced start loosens over the fix tries: the first try is the planned tool on the step's own slot (the cheap
 *  rule's, or one its words name surely) with its mode (value / add / remove); a fix try keeps the tool and the slot; the last try
 *  starts only {"tool":" with the best few slots shown, so Juli may ask, look or say it is done instead. */
export function stepTarget(ws, step, request, tries = 0) {
  if (step.do === 'edit') return { names: [], path: null, prefix: tries >= 2 ? '{"tool":"' : ws.custom ? '{"tool":"edit","find":"' : '{"tool":"edit","find":"","replace":"' };
  const all = Object.keys(ws.spec || {}), own = step.slot && ws.spec[String(step.slot).split(/[.[]/)[0]] ? String(step.slot) : null;
  const slot = tries >= 2 ? null : own || sureSlot(ws, step.what) || (resolveSlots(step.what, ws).length ? null : sureSlot(ws, request));
  if (!slot) {
    const pick = [];
    for (const c of resolveSlots(step.what, ws).concat(resolveSlots(request, ws))) if (!pick.includes(c.slot)) pick.push(c.slot);
    return { names: all.length <= 4 ? all : (pick.length ? pick : all).slice(0, 3), path: null, prefix: tries >= 2 ? '{"tool":"' : '{"tool":"set","slot":"' };
  }
  const top = slot.split(/[.[]/)[0], path = slot.includes('[') || slot.includes('.') ? slot : pathFor(ws, slot, step.what + ' ' + request), f = specAt(ws.spec, parsePath(path) || [top]);
  const P = `{"tool":"set","slot":"${path}`, said = step.what + ' ' + request;
  // a list: a list of texts "changed to" new ones is given whole; add / remove when the step says so; else its path stays open, for an
  // item or a field ("[1].goal","value":10)
  // (add / remove: an imperative at the step's start, or "a new / another ..."; "make the steps tile add 500" is a field's value)
  const prefix = kindOf(f) !== 'array' ? P + '","value":' : typeof f.item === 'string' && /\b(change|set|replace|swap|make|turn|switch)\b[^.]*\bto\b/i.test(said) ? P + '","value":['
    : !tries && (/^\s*(?:please\s+)?(?:add|put|include|insert|append)\b/i.test(step.what) || /\b(?:another|a new|one more)\s+\w+/i.test(step.what)) ? P + '","add":['
    : !tries && /^\s*(?:please\s+)?(?:remove|delete|drop|take\s+out|get\s+rid\s+of)\b|\bwithout\b/i.test(step.what) ? P + '","remove":[' : P;
  return { names: [top], path, prefix };
}
/** the colours a text names, as the host's own fact ("green = #2e9e4f"): a small model copies a hex it is given */
export function colourFacts(text) { return [...new Set(words(text).filter((w) => COLORS[w]))].slice(0, 4).map((w) => `${w} = ${COLORS[w]}`).join(', '); }
const hasColour = (ws, names) => names.some((k) => { const f = ws.spec[k]; return kindOf(f) === 'color' || (f && typeof f.item === 'object' && Object.values(f.item).some((g) => kindOf(g) === 'color')); });
/** the worker's prompt for one step (<= 2800 tokens) -> {messages, opts: {maxTokens, prefix}}. c = {index, total, done, last,
 *  problem, prev, tries}: what the earlier steps did, the last run, and on a fix try the problem and the answer that had it */
export function stepMessages(ws, request, step, c = {}) {
  const edit = step.do === 'edit', tg = stepTarget(ws, step, request, c.tries || 0), prefix = tg.prefix, names = tg.names;
  const sub = tg.path && tg.path !== names[0] ? parsePath(tg.path) : null;   // a part of a slot (a deck's cards): its own rule and value
  const cf = (edit || hasColour(ws, names)) ? colourFacts(step.what + ' ' + request) : '';
  // the app's facts first, the request and the step LAST (right before the answer: a small greedy model copies what it read last, so
  // the slots' values say "now:" and come before what the person asked for). Cut when long: the saved data first, the slots last.
  const parts = [
    { text: edit ? '' : 'SLOTS:\n' + slotsText(ws, names, sub ? 300 : 700, step.what + ' ' + request) + (sub ? `\n- ${tg.path} (${ruleText(specAt(ws.spec, sub))}) | now: ${valueText(getAt(ws.slots, sub), 600, tg.path, step.what + ' ' + request)}` : ''), trim: !edit },
    { text: edit ? (ws.custom ? `THE CUSTOM PART NOW (${lines(ws.custom)} lines):\n` + numbered(ws.custom, 1800) : 'THE CUSTOM PART NOW: empty') : '', trim: true },
    { text: edit ? 'SLOT VALUES: ' + cut(Object.keys(ws.spec).map((k) => `SLOTS.${k} = ${valueText(ws.slots[k], 90, k)}`).join('; '), 700) : '', trim: true },
    { text: edit && factsFor(ws, step.what + ' ' + request).length ? "THE APP'S OWN NAMES (read only):\n" + factsFor(ws, step.what + ' ' + request).join('\n') : '', trim: true },
    { text: edit && (ws.data || []).length ? 'SAVED DATA (read with K.load(key, fallback)): ' + ws.data.map((d) => `'${d.key}' = ${d.sample}`).join('; ') : '', trim: true },
    { text: cf ? 'COLOURS (#rrggbb): ' + cf : '' },
    { text: (c.done || []).length ? 'DONE SO FAR: ' + c.done.map((d) => cut(d, 120)).join('; ') : '' },
    { text: c.last ? 'LAST RESULT: ' + cut(c.last, 520) : '' },
    { text: c.problem ? `YOUR LAST ANSWER: ${cut(c.prev || '', 300)}\nPROBLEM: ${cut(c.problem, 300)}\nFix that in a new answer${c.tries >= 2 ? ' (last try: keep it simple)' : ''}.` : '' },
    { text: `REQUEST: ${cut(oneLine(request), 400)}\nSTEP ${(c.index || 0) + 1} of ${c.total || 1}: ${step.do} - ${step.what}${step.why ? ` (${step.why})` : ''}\n` +
      (edit ? 'Answer with the one tool call that does this step.' : 'Answer with the one tool call that makes this change: the NEW value the request asks for.') },
  ];
  const sys = STEP_SYS + (edit ? '\n\n' + EDIT_GUIDE(ws) : '');
  const build = (P) => [{ role: 'system', content: sys }, { role: 'user', content: P.map((p) => p.text).filter(Boolean).join('\n\n') }];
  const messages = fitParts(parts, build, EDIT.step.prompt, prefix);
  return { messages, opts: { maxTokens: edit ? EDIT.step.edit : EDIT.step.out, prefix }, path: tg.path };
}
const REVIEW_SYS = 'You check a change to an app on a phone. Read the request, what changed and what the app shows now. Reply with ONE JSON object and nothing else: ' +
  '{"match": true or false, "note": "one short sentence"}. WHAT CHANGED is p0pc0rn\'s own record of the change: it is true. The screen text is only the first ' +
  'screen (other tabs, sheets and lists further down are not in it). match is true when what changed does what the person asked; false when it changed ' +
  'something else, too little, or the app has an error.';
/** the reviewer's prompt (<= 1200 tokens) -> {messages, opts} */
export function reviewMessages(ws0, ws1, request, info = {}) {
  const ch = changesOf(ws0, ws1), prefix = '{"match":';
  const parts = [{ text: 'REQUEST: ' + cut(oneLine(request), 400) },
    { text: 'WHAT CHANGED:\n' + (ch.length ? ch.map((x) => '- ' + x.text).join('\n') : '- nothing') },
    { text: ws1.custom && ws1.custom !== ws0.custom ? 'THE ADDED CODE:\n' + cut(ws1.custom, 700) : '', trim: true },
    { text: 'THE APP NOW: ' + runText(info.run, 600), trim: true },
    { text: (info.looked || []).length ? 'JULI LOOKED AT THE SCREEN: ' + info.looked.map((l) => `${cut(l.q, 80)} -> ${cut(l.a, 160)}`).join('; ') : '', trim: true }];
  const build = (P) => [{ role: 'system', content: REVIEW_SYS }, { role: 'user', content: P.map((p) => p.text).filter(Boolean).join('\n\n') }];
  return { messages: fitParts(parts, build, EDIT.review.prompt, prefix), opts: { maxTokens: EDIT.review.out, prefix } };
}
const LOOK_SYS = 'You look at a screenshot of an app on a phone and answer the question about it in one or two short sentences. Say only what you can see.';
/** the look prompt (Juli's own model: the picture first, then the question); image = what the engine reads (an ImageBitmap) */
export function lookMessages(question, image) {
  return { messages: [{ role: 'system', content: LOOK_SYS }, { role: 'user', content: [{ type: 'image', image }, { type: 'text', text: cut(oneLine(question), 300) || 'What does the screen show?' }] }],
    opts: { maxTokens: EDIT.look.out } };
}

// ------------------------------------------------------------------------------------------------ the loop
const withPrefix = (text, prefix) => { const t = String(text == null ? '' : text); return !prefix || t.trimStart().startsWith(prefix) ? t : prefix + t; };
const cutOff = (text) => { const t = String(text || '').trim(); return t.startsWith('{') && endOf(t, 0) < 0; };
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const abortIf = (signal) => { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' }); };

/** phase 1: the plan -> {steps, planned}. opts.planner: true = always ask the planner, false = never (the cheap rule decides otherwise) */
export async function planPhase(fns, ws, request, opts = {}) {
  const quick = opts.planner === false || (opts.planner !== true && !!oneSlot(request, ws));
  if (quick || !fns.plan) return { steps: [ruleStep(request, ws)], planned: false };
  abortIf(opts.signal);
  const q = planMessages(ws, request, opts);
  const text = withPrefix(await fns.plan(q.messages, q.opts), q.opts.prefix);
  return { steps: parsePlan(text, ws, request), planned: true, raw: cut(text, 600) };
}
/** phase 2: the steps, one tool call per model call -> {ws, steps (with status: done | failed | skipped | asked), calls, log, asked,
 *  run (the last test run, of the final workspace), looked, changed}. fns.step(messages, opts) -> text; fns.run(ws) -> the host's test
 *  run; fns.look(ws, question) -> text; fns.ask(question) -> the person's answer or '' (optional: the queue job has none, so a
 *  question ends the change and the person answers with their next request) */
export async function workPhase(fns, ws0, request, steps, opts = {}) {
  const maxCalls = opts.calls || EDIT.calls, maxFix = opts.fixes == null ? EDIT.fixes : opts.fixes, onEvent = opts.onEvent || (() => {});
  const deadline = nowMs() + (opts.seconds || EDIT.seconds) * 1000;
  let ws = clone(ws0), calls = 0, asked = null, lastRun = null, lastKey = null, base = null, last = opts.last || '';
  const out = steps.slice(0, EDIT.steps).map((s) => Object.assign({}, s, { status: 'todo', note: '' })), log = [], looked = [], done = [];
  const key = (w) => JSON.stringify([w.slots, w.custom]);
  const run = async (w) => { abortIf(opts.signal); const r = await fns.run(w); lastRun = r; lastKey = key(w); return r; };
  const baseline = async () => { if (!base) { base = await fns.run(ws0); if (!lastRun) { lastRun = base; lastKey = key(ws0); } } return base; };
  const look = async (w, q) => { abortIf(opts.signal); const a = fns.look ? cut(oneLine(await fns.look(w, q)), 300) : 'Juli could not look here.'; looked.push({ q, a }); return a; };
  for (let i = 0; i < out.length && !asked; i++) {
    const s = out[i];
    s.status = 'doing'; onEvent({ type: 'step', i, steps: out });
    if (s.do === 'look') { const a = await look(ws, s.what); s.status = 'done'; s.note = a; last = 'Juli looked: ' + a; onEvent({ type: 'step', i, steps: out }); continue; }
    const start = ws;
    let tries = 0, shows = 0, problem = null, prev = null, nudged = false, copied = false;
    for (;;) {
      if (calls >= maxCalls || nowMs() > deadline) { s.status = 'failed'; s.note = calls >= maxCalls ? 'out of tool calls' : 'out of time'; break; }
      abortIf(opts.signal);
      const q = stepMessages(ws, request, s, { index: i, total: out.length, done, last, problem, prev, tries });
      const text = withPrefix(await fns.step(q.messages, q.opts), q.opts.prefix); calls++;
      const tool = parseTool(text);
      log.push({ step: i, tool: tool ? tool.tool : null, text: cut(text, 500) }); onEvent({ type: 'call', i, calls, tool: tool && tool.tool });
      const fix = (p) => { problem = p; prev = cut(text, 300); return ++tries > maxFix; };
      if (!tool) { if (fix(cutOff(text) ? 'your answer is not complete JSON (a quote or a bracket is missing): write the whole tool call again, plain JSON' : 'that was not one JSON tool call like the ones above')) { s.status = 'failed'; s.note = problem; break; } continue; }
      if (tool.tool === 'ask') {   // an answer from fns.ask (a caller that can ask the person now) goes on; else the loop ends with the question
        const q2 = tool.question || 'What should change?', ans = fns.ask ? oneLine(await fns.ask(q2)) : '';
        if (ans) { last = `You asked "${cut(q2, 120)}". The person says: ${cut(ans, 300)}`; problem = null; continue; }
        asked = q2; s.status = 'asked'; s.note = asked; break;
      }
      if (tool.tool === 'done') {
        if (!nudged && tries < maxFix) { nudged = true; if (fix('nothing has changed yet: make the change this step asks for')) { s.status = 'skipped'; break; } continue; }
        s.status = 'skipped'; s.note = tool.summary || 'nothing to change'; break;
      }
      if (tool.tool === 'show' || tool.tool === 'run') {
        last = tool.tool === 'run' || tool.what === 'screen' ? runText(await run(ws)) : applyTool(ws, tool).observation;
        problem = ++shows > EDIT.shows ? 'no more looking: make the change now' : null; prev = problem ? cut(text, 200) : null; continue;
      }
      if (tool.tool === 'look') { last = 'Juli looked: ' + await look(ws, tool.question || s.what); problem = ++shows > EDIT.shows ? 'no more looking: make the change now' : null; continue; }
      const r = applyTool(ws, tool);
      if (r.problem) { if (fix(r.problem)) { s.status = 'failed'; s.note = r.problem; break; } continue; }
      const wrong = tool.tool === 'set' && tool.remove !== undefined && r.changed ? wrongRemove(ws, r.ws, tool.slot, request + ' ' + s.what) : null;
      if (wrong) { if (fix(wrong)) { s.status = 'failed'; s.note = wrong; break; } continue; }
      if (!r.changed) {   // the value it already has: a small model often copies the one in its prompt. Once: ask for the new one
        if (!copied && tries < maxFix) { copied = true; if (fix(r.observation + '. That is its value NOW: the request asks for a change, so give the NEW value')) { s.status = 'skipped'; s.note = r.observation; break; } continue; }
        s.status = 'skipped'; s.note = r.observation; break;
      }
      const rr = await run(r.ws), bad = runProblems(rr, rr.booted && !(rr.errors || []).length && !(rr.customErrors || []).length ? null : await baseline());
      if (bad.length) { ws = start; if (fix(bad.join('; ') + ' (the change was put back)')) { s.status = 'failed'; s.note = bad[0]; break; } last = runText(rr); continue; }
      ws = r.ws; s.status = 'done'; s.note = r.observation; last = r.observation + '. ' + runText(rr); done.push(`step ${i + 1}: ${r.observation}`); break;
    }
    if (s.status !== 'done') ws = start;   // a step that did not work is put back as it was
    onEvent({ type: 'step', i, steps: out });
  }
  const changed = !same([ws.slots, ws.custom], [ws0.slots, ws0.custom]);
  if (changed && lastKey !== key(ws)) await run(ws);   // the result card shows the app as it is kept
  return { ws, steps: out, calls, log, asked, run: lastRun, looked, changed };
}
/** phase 3: the review -> {match, note} or null (no answer it could read) */
export async function reviewPhase(fns, ws0, ws1, request, info = {}, opts = {}) {
  if (!fns.review) return null;
  abortIf(opts.signal);
  const q = reviewMessages(ws0, ws1, request, info);
  return parseReview(withPrefix(await fns.review(q.messages, q.opts), q.opts.prefix));
}
/** the result the host keeps and shows */
export function finish(ws0, W, P, R) {
  const changes = changesOf(ws0, W.ws);
  return { ok: !!W.changed, ws: W.ws, changes, summary: changes.map((c) => c.text).join('; '), steps: W.steps.map((s) => ({ do: s.do, what: s.what, status: s.status, note: cut(s.note, 160) })),
    planned: !!(P && P.planned), calls: W.calls, review: R || null, asked: W.asked || null, looked: W.looked || [], runText: W.run ? runText(W.run) : '',
    failed: W.steps.filter((s) => s.status === 'failed').length };
}
/** the whole change in one go (the tests; the host runs the three phases as queue phases) -> finish(...) */
export async function editApp(fns, ws, request, opts = {}) {
  const P = await planPhase(fns, ws, request, opts);
  if (opts.onEvent) opts.onEvent({ type: 'plan', steps: P.steps, planned: P.planned });
  const W = await workPhase(fns, ws, request, P.steps, opts);
  const R = W.changed && !W.asked ? await reviewPhase(fns, ws, W.ws, request, W, opts) : null;
  return Object.assign(finish(ws, W, P, R), { plan: P, log: W.log });
}
export { isAbort };
