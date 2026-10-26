// fill.js - how Juli makes an app from a request: pick a skeleton (router), fill its slots (JSON), check them against the skeleton's
// slot rules, ONE repair round for whatever is missing or wrong, then a critic that reads a plain summary of the result. Juli never
// writes code: the skeleton holds it. Live numbers (weather, prices) never come from Juli: those apps fetch them. Whatever the request
// asks for that the skeleton can't do is said out loud (gaps), not faked.
//   const r = await makeApp(llm, skels, 'a chore list for the kids with points');   // llm(messages, opts) -> text
import { ICONS, validateSlots, slotsIn } from './check.js';

export function parseJSON(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw Object.assign(new Error('no JSON object in the answer'), { code: 'NO_JSON' });
  return JSON.parse(t.slice(a, b + 1));
}

function specText(spec) {
  const line = (k, f, ind) => {
    if (typeof f === 'string') return `${ind}${k}: text (max ${f.split(':')[1]} chars)`;
    let d = `${ind}${k}: ${f.type === 'bool' ? 'true or false' : f.type}`;
    if (f.type === 'string') d += ` (max ${f.max} chars)`;
    if ((f.type === 'int' || f.type === 'number') && f.min != null) d += f.max != null ? ` (${f.min} to ${f.max})` : ` (at least ${f.min})`;
    if (f.type === 'array') d += ` of ${f.min}-${f.max}`;
    if (f.type === 'enum') d += ` one of ${f.enum.map((x) => JSON.stringify(x)).join(', ')}`;
    if (f.type === 'icon') d += ' (an icon name from the list)';
    if (f.type === 'color') d += ' (#rrggbb)';
    if (f.type === 'ref') d += ` (one of the ${f.ref.split('.')[0]} names)`;
    if (f.required === false) d += ', optional';
    if (f.desc) d += ` - ${f.desc}`;
    if (f.item && typeof f.item === 'object') d += '\n' + Object.entries(f.item).map(([k2, f2]) => line(k2, f2, ind + '  ')).join('\n');
    else if (typeof f.item === 'string') d += ` (each text, max ${f.item.split(':')[1]} chars)`;
    return d;
  };
  return Object.entries(spec).map(([k, f]) => line(k, f, '- ')).join('\n');
}

export const routerMessages = (req, skels) => [{ role: 'system', content: 'You choose which app skeleton best fits a request. The skeletons:\n' +
  skels.map((s) => `- ${s.manifest.id}: ${s.manifest.description}`).join('\n') +
  '\n- none: nothing above fits.\nReply with JSON only, like {"skeleton": "' + skels[0].manifest.id + '"}.' }, { role: 'user', content: String(req).slice(0, 600) }];

export const fillMessages = (s, req) => [{ role: 'system', content:
  `You fill in the slots of the "${s.manifest.name}" app skeleton so the app matches what the person asked for. ${s.manifest.description}\n\nSLOTS:\n${specText(s.manifest.slots)}\n` +
  `- _gaps: a list of short phrases: things the person asked for that this app cannot do (empty list if none)\n\n` +
  `Icon names: ${ICONS.join(', ')}.\n\nNotes: ${s.notes_for_juli || ''}\n\nRules: reply with ONE JSON object and nothing else (no code fences, no comments). ` +
  'Fill EVERY slot that is not optional. Use specific content for the request; never copy the example’s content. Stay within every limit. ' +
  'Never invent live facts (weather, prices, news, places the person did not name). No advice to buy, sell or hold anything.' }, { role: 'user', content: String(req).slice(0, 600) }];

export const repairMessages = (s, req, cur, problems, names) => [{ role: 'system', content:
  `You fix the slots of a "${s.manifest.name}" app. Only these slots need fixing: ${names.join(', ')}.\n\nTHEIR RULES:\n` +
  specText(Object.fromEntries(names.filter((n) => s.manifest.slots[n]).map((n) => [n, s.manifest.slots[n]]))) +
  `\n\nIcon names: ${ICONS.join(', ')}.\nProblems found: ${problems.slice(0, 12).join('; ')}.\nReply with ONE JSON object holding only those slots, nothing else.` },
{ role: 'user', content: `REQUEST: ${String(req).slice(0, 600)}\n\nTHE OTHER SLOTS (keep in mind, do not repeat): ${JSON.stringify(omit(cur, names)).slice(0, 1500)}` }];

export const criticMessages = (s, req, summary) => [{ role: 'system', content: `You review an app made from the "${s.manifest.name}" skeleton. ${s.manifest.description} ` +
  'Judge only whether what the app shows fits the request. Reply with JSON only: {"match": true or false, "problem": "one short sentence, or empty"}.' },
{ role: 'user', content: `REQUEST: ${String(req).slice(0, 600)}\n\nTHE APP SHOWS:\n${summary}` }];

const omit = (o, ks) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !ks.includes(k)));

/** a plain-words summary of what the filled app will show (the critic reads this, not raw JSON) */
export function summarize(s, slots) {
  const out = [`An app called "${slots.title || slots.app_name || s.manifest.name}" (${s.manifest.name}).`];
  for (const [k, v] of Object.entries(slots)) {
    if (k === 'accent' || k === 'title' || k === 'app_name' || v == null) continue;
    if (Array.isArray(v)) {
      const names = v.slice(0, 12).map((x) => (typeof x === 'string' ? x : x && (x.title || x.name || x.label || x.front || x.sym) || '')).filter(Boolean);
      out.push(`${k}: ${v.length} (${names.join('; ').slice(0, 400)})`);
      if (v.length && v[0] && Array.isArray(v[0].cards)) out.push('cards: ' + v.flatMap((d) => d.cards.slice(0, 6).map((c) => `${c.front} = ${c.back}`)).join('; ').slice(0, 500));
    } else if (typeof v === 'object') out.push(`${k}: ${JSON.stringify(v).slice(0, 160)}`);
    else out.push(`${k}: ${String(v).slice(0, 160)}`);
  }
  return out.join('\n');
}

const ICON_LIKE = { cup: 'drop', coffee: 'drop', tea: 'drop', water: 'drop', bottle: 'drop', glass: 'drop', bed: 'moon', sleep: 'moon', night: 'moon', scale: 'chart', weight: 'chart',
  bike: 'trend', bicycle: 'trend', run: 'trend', running: 'trend', walk: 'trend', steps: 'trend', fitness: 'flame', workout: 'flame', calories: 'flame', fire: 'flame', money: 'dollar',
  budget: 'dollar', cash: 'dollar', food: 'cart', shopping: 'cart', grocery: 'cart', plant: 'leaf', garden: 'leaf', flower: 'leaf', tree: 'leaf', baby: 'heart', health: 'heart',
  pressure: 'heart', medicine: 'shield', pill: 'shield', book: 'book', read: 'book', reading: 'book', study: 'book', school: 'book', note: 'edit', pen: 'edit', write: 'edit',
  task: 'check', todo: 'check', checklist: 'check', clean: 'sparkle', home: 'home', house: 'home', car: 'pin', travel: 'pin', trip: 'pin', map: 'compass', time: 'clock',
  alarm: 'bell', reminder: 'bell', weather: 'cloud', snow: 'cloud', storm: 'rain', temperature: 'sun', photo: 'camera', picture: 'image', game: 'dice', pet: 'paw', dog: 'paw', cat: 'paw' };
/** the small, safe fixes a 2B model's JSON often needs, before any slot counts as wrong: text over its limit is cut at a word, numbers
 *  given as text become numbers and are clamped, an enum matches without case, a colour gets its '#', a list keeps its first max items */
export function tidy(spec, obj) {
  const cut = (s, n) => { const t = s.slice(0, n), i = t.lastIndexOf(' '); return (i > n * 0.6 ? t.slice(0, i) : t).trim(); };
  const num = (v) => (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? +v : v);
  const fix = (f, v) => {
    if (v == null) return v;
    if (typeof f === 'string') { const n = +f.split(':')[1]; return typeof v === 'string' && v.length > n ? cut(v, n) : v; }
    switch (f.type) {
      case 'string': return typeof v === 'number' ? String(v) : typeof v === 'string' && v.length > f.max ? cut(v, f.max) : v;
      case 'int': { const x = num(v); return typeof x === 'number' && Number.isFinite(x) ? Math.min(f.max, Math.max(f.min, Math.round(x))) : v; }
      case 'number': { const x = num(v); if (typeof x !== 'number' || !Number.isFinite(x)) return v; return f.min != null && x < f.min ? f.min : f.max != null && x > f.max ? f.max : x; }
      case 'enum': { if (f.enum.includes(v)) return v; const m = f.enum.find((e) => String(e).toLowerCase() === String(v).trim().toLowerCase()); return m === undefined ? v : m; }
      case 'color': return typeof v === 'string' && /^[0-9a-fA-F]{6}$/.test(v.trim()) ? '#' + v.trim() : v;
      case 'bool': return v === 'true' ? true : v === 'false' ? false : v;
      case 'icon': { if (ICONS.includes(v)) return v; const w = String(v).toLowerCase().replace(/[^a-z]/g, ''); return ICON_LIKE[w] || (ICONS.includes(w) ? w : 'star'); }   // an unknown icon never sinks a whole slot
      case 'object': if (v && typeof v === 'object' && !Array.isArray(v)) { const o = Object.assign({}, v); for (const [k, g] of Object.entries(f.item || {})) o[k] = fix(g, o[k]); return o; } return v;
      case 'array':
        if (!Array.isArray(v)) return v;
        return v.slice(0, f.max).map((x) => (typeof f.item === 'string' ? fix(f.item, x)
          : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, f.item[k] ? fix(f.item[k], y) : y])) : x));
      default: return v;
    }
  };
  return Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, spec[k] ? fix(spec[k], v) : v]));
}

/** fill + validate + one repair + defaults for anything still wrong. -> {slots, gaps, problems (after repair), repaired, defaulted} */
export async function fillSlots(llm, s, req, { onStage = () => {}, signal } = {}) {
  onStage('fill');
  let raw = await llm(fillMessages(s, req), { maxTokens: 900, temperature: 0.2, signal }), obj;
  try { obj = parseJSON(raw); } catch (e) { obj = null; }
  if (!obj) { onStage('retry'); raw = await llm(fillMessages(s, req), { maxTokens: 900, temperature: 0.5, signal }); obj = parseJSON(raw); }
  const gaps = (Array.isArray(obj._gaps) ? obj._gaps : []).map((g) => String(g).slice(0, 80)).filter(Boolean).slice(0, 4);
  let slots = omit(obj, ['_gaps']);
  for (const k of Object.keys(slots)) if (!s.manifest.slots[k]) delete slots[k];   // unknown slots are dropped, never passed to the app
  slots = tidy(s.manifest.slots, slots);
  let problems = validateSlots(s.manifest.slots, slots), repaired = false;
  if (problems.length) {
    onStage('repair');
    const names = slotsIn(problems).filter((n) => s.manifest.slots[n]);
    try {
      const fix = parseJSON(await llm(repairMessages(s, req, slots, problems, names), { maxTokens: 700, temperature: 0.2, signal }));
      for (const n of names) if (fix[n] !== undefined) slots[n] = fix[n];
      slots = tidy(s.manifest.slots, slots);
      repaired = true;
    } catch (e) { /* the defaults below */ }
    problems = validateSlots(s.manifest.slots, slots);
  }
  // still wrong after the repair: that slot goes back to the skeleton's (neutral) default, never to sample data inside the code
  const defaulted = [];
  for (const n of slotsIn(problems)) if (s.manifest.slots[n]) {
    if (s.slots_default && s.slots_default[n] !== undefined) slots[n] = JSON.parse(JSON.stringify(s.slots_default[n])); else delete slots[n];
    defaulted.push(n);
  }
  problems = validateSlots(s.manifest.slots, slots);
  return { slots, gaps, problems, repaired, defaulted };
}

/** the whole make: router -> fill -> critic. llm(messages, opts) -> text. skels = checked bundles. */
export async function makeApp(llm, skels, req, { onStage = () => {}, signal, critic = true, only = null } = {}) {
  let s = only ? skels.find((x) => x.manifest.id === only) : null, routed = null;
  if (!s) {
    onStage('route');
    try { routed = parseJSON(await llm(routerMessages(req, skels), { maxTokens: 40, temperature: 0, signal })).skeleton; } catch (e) { routed = null; }
    s = skels.find((x) => x.manifest.id === routed) || null;
    if (!s) return { ok: false, routed, reason: 'none', message: "None of the app skeletons on this phone fits that request. The shelf shows what each one does; you can also import a new skeleton." };
  }
  const f = await fillSlots(llm, s, req, { onStage, signal });
  if (f.problems.length) return { ok: false, skel: s.manifest.id, reason: 'slots', problems: f.problems, message: `Juli couldn't fill the ${s.manifest.name} skeleton correctly.` };
  let review = null;
  if (critic) {
    onStage('critic');
    try { const c = parseJSON(await llm(criticMessages(s, req, summarize(s, f.slots)), { maxTokens: 80, temperature: 0, signal })); review = { match: c.match !== false, problem: String(c.problem || '').slice(0, 200) }; }
    catch (e) { review = null; }
  }
  // a slot that had to go back to its starting value AND a critic that says the app doesn't fit: the app would show the skeleton's
  // own content (Spanish cards for "photography terms"), so nothing is made and the person hears why
  if (f.defaulted.length && review && !review.match)
    return { ok: false, skel: s.manifest.id, reason: 'critic', defaulted: f.defaulted, review, message: `Juli couldn’t fill the ${s.manifest.name} skeleton well for that (${review.problem || 'it did not fit'}). Try saying it a little differently.` };
  return { ok: true, skel: s.manifest.id, slots: f.slots, gaps: f.gaps, repaired: f.repaired, defaulted: f.defaulted, review };
}
