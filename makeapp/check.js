// check.js - the checks every skeleton bundle (<id>.p0skel.json) passes before p0pc0rn keeps it: the bundled ones at start-up and an
// imported one before its permission sheet. The same rules as the Skeleton Guide. A failed check names every problem in plain words.
// The sandbox enforces the important ones anyway (no network of its own, no storage, no reaching the page): these checks make a bad bundle fail
// early and clearly instead of half-working.
import { SOURCE_IDS } from './sources.js';
import { clashProblems } from './p5names.js';   // 3.9 platform: a top-level name p5 takes in global mode (p5 starts after the app's script)
import { bundleSkillProblems } from '../assistant/skills.js';   // H39: a skeleton may bring up to 3 skills (know-how for Juli)

export const ICONS = ['plus', 'minus', 'close', 'check', 'chevronRight', 'chevronLeft', 'chevronUp', 'chevronDown', 'back', 'arrowRight', 'arrowUp',
  'arrowDown', 'menu', 'more', 'search', 'heart', 'play', 'pause', 'stop', 'undo', 'redo', 'backspace', 'refresh', 'share', 'trash', 'edit', 'home',
  'chart', 'trend', 'list', 'grid', 'user', 'bell', 'clock', 'calendar', 'timer', 'flame', 'bolt', 'drop', 'sun', 'moon', 'cloud', 'rain', 'lock',
  'info', 'alert', 'trophy', 'coin', 'star', 'sound', 'mute', 'camera', 'pin', 'bookmark', 'filter', 'sparkle', 'music', 'mic', 'image', 'globe',
  'send', 'chat', 'dice', 'cart', 'target', 'leaf', 'book', 'paw', 'dollar', 'eye', 'settings', 'shield', 'gift', 'key', 'swords', 'ghost',
  'skipBack', 'skipForward', 'shuffle', 'repeat', 'copy', 'download', 'upload', 'flag', 'tag', 'checkCircle', 'plusCircle', 'xCircle', 'thumbUp',
  'sliders', 'arrowLeft', 'compass', 'skull'];
export const LIMITS = { bundle: 400e3, code: 160e3, notes: 1500, slots: 40, name: 30, description: 300, goal: 140 };
const TYPES = new Set(['string', 'int', 'number', 'bool', 'enum', 'icon', 'color', 'ref', 'object', 'array']);
const BANNED = [[/(?<![.\w$])fetch\s*\(|\b(?:window|self|globalThis)\s*\.\s*fetch\b/, 'fetch() (use p0.fetch(source, params))'], [/XMLHttpRequest|WebSocket|EventSource|sendBeacon|WebTransport|\b(?:webkit)?RTC(?:PeerConnection|DataChannel|SessionDescription|IceCandidate|Rtp\w*|DtlsTransport|IceTransport|SctpTransport|Certificate)\b/, 'a network API'],
  [/\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(|\bimportScripts\b/, 'dynamic code'], [/https?:\/\//, 'a web address'],
  [/document\.cookie|localStorage|sessionStorage|indexedDB|caches\./, 'browser storage (use K.load / K.save)'],
  [/\bparent\s*\.|\btop\s*\.|window\.opener|postMessage/, 'reaching outside the app'], [/<script/i, 'a script tag'],
  [/<(?:iframe|frame|object|embed|link|meta|base)\b|createElement\s*\(\s*['"`](?:iframe|frame|object|embed|link|meta|base)\b/i, 'a frame, link or meta tag'],
  [/attachShadow|document\s*\.\s*write|DOMParser|parseHTMLUnsafe|setHTMLUnsafe|XSLTProcessor/, 'HTML tricks the sandbox blocks']];

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');

/** checkBundle(b) -> [] when the bundle is good, else a list of problems */
export function checkBundle(b) {
  const e = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['not a skeleton file (a JSON object)'];
  if (b.p0skel !== 1) e.push('p0skel must be 1');
  for (const k of Object.keys(b)) if (!['p0skel', 'manifest', 'slots_default', 'notes_for_juli', 'files', 'skills'].includes(k)) e.push(`unknown field "${k}"`);
  const m = b.manifest;
  if (!m || typeof m !== 'object') return e.concat('missing manifest');
  for (const k of ['id', 'name', 'description', 'category', 'version', 'runtime', 'entry', 'permissions', 'triggers', 'slots']) if (m[k] == null) e.push('manifest missing ' + k);
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(m.id || '')) e.push('id must be 3-40 characters: a-z, 0-9 and -');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > LIMITS.name) e.push(`name: 1-${LIMITS.name} characters`);
  if (typeof m.description !== 'string' || m.description.length > LIMITS.description) e.push(`description: at most ${LIMITS.description} characters`);
  if (!/^\d+\.\d+(\.\d+)?$/.test(m.version || '')) e.push('version like 1.0');
  if (m.runtime !== 'p5-kit@1') e.push('runtime must be p5-kit@1');
  if (m.entry !== 'sketch.js') e.push('entry must be sketch.js');
  if (m.recipe && m.recipe.length) e.push('recipes are not supported in this version: an agentic app does its work in K.agent tasks');
  const P = m.permissions || {};
  for (const k of Object.keys(P)) if (!['storage', 'online', 'juli', 'chat.post', 'location'].includes(k)) e.push(`unknown permission "${k}"`);
  if (P.online != null && !Array.isArray(P.online)) e.push('permissions.online must be a list of sources');
  for (const s of P.online || []) if (!SOURCE_IDS.includes(s)) e.push(`unknown online source "${s}" (this version has: ${SOURCE_IDS.join(', ')})`);
  // 3.9: "choose" = Juli picks one of the app's options while the person has it open (a game's move); "ask" = an agentic app's checks
  if (P.juli != null && !(Array.isArray(P.juli) && P.juli.every((x) => x === 'ask' || x === 'choose') && new Set(P.juli).size === P.juli.length))
    e.push('permissions.juli: a list with "ask" (the checks of an agentic app) and/or "choose" (Juli picks while the app is open, as in a game), each once');
  if (P.location != null && !['none', 'place', 'device'].includes(P.location)) e.push('permissions.location must be none, place or device');
  const T = Array.isArray(m.triggers) ? m.triggers : [];
  if (!T.length) e.push('triggers: at least one');
  for (const t of T) {
    if (!t || !['manual', 'on-open', 'interval'].includes(t.type)) e.push('unknown trigger ' + JSON.stringify(t));
    else if (t.type === 'interval') {
      if (!(Number.isInteger(t.minMinutes) && t.minMinutes >= 15 && t.minMinutes <= 1440)) e.push('interval minMinutes must be 15-1440');
      if (t.calmMinutes != null && !(Number.isInteger(t.calmMinutes) && t.calmMinutes >= 15 && t.calmMinutes <= 1440)) e.push('interval calmMinutes must be 15-1440');
    }
  }
  const types = new Set(T.map((t) => t && t.type));
  if (!['agentic', 'non-agentic'].includes(m.category)) e.push('category must be agentic or non-agentic');
  if (m.goal != null && (typeof m.goal !== 'string' || !m.goal.trim() || m.goal.length > LIMITS.goal)) e.push(`goal: one sentence, at most ${LIMITS.goal} characters`);
  if (m.plain != null && (typeof m.plain !== 'string' || !m.plain.trim() || m.plain.length > 320)) e.push('plain: what the app does, when and what it looks at, in plain words, at most 320 characters');   // 3.9 polish (A1): the cards' sentence
  if (m.category !== 'agentic' && (P.juli || []).includes('ask')) e.push('only an agentic app has Juli in it (she works in its checks): drop "ask" from permissions.juli or make it agentic');
  if (m.category === 'agentic' && (P.juli || []).includes('choose')) e.push('Juli chooses ("choose") only in an app the person has open; an agentic app has her in its checks: drop "choose" or make it non-agentic');
  if (m.kind != null && m.kind !== 'game') e.push('kind: "game" or leave it out');   // 3.9: a game is listed under Games on the shelf
  if (m.category === 'agentic') {   // agentic = Juli works in it on her own (the Skeleton Guide: "Two kinds of app")
    if (!types.has('on-open') && !types.has('interval')) e.push('an agentic app needs an on-open or interval trigger (its idle tasks run on them)');
    if (!(P.juli || []).includes('ask')) e.push('an agentic app has Juli in it: permissions.juli ["ask"] (an app that only checks a source is non-agentic)');
    if (m.goal == null) e.push('an agentic app states its goal: manifest.goal, one sentence');
  }
  // slots
  const S = m.slots;
  if (!S || typeof S !== 'object' || Array.isArray(S) || !Object.keys(S).length) e.push('slots: at least one');
  else {
    if (Object.keys(S).length > LIMITS.slots) e.push(`at most ${LIMITS.slots} slots`);
    for (const [k, f] of Object.entries(S)) specProblems(f, k, e);
    if (b.slots_default == null) e.push('missing slots_default (a complete set of starting values)');
    else for (const x of validateSlots(S, b.slots_default)) e.push('slots_default: ' + x);
  }
  if (b.notes_for_juli != null && (typeof b.notes_for_juli !== 'string' || b.notes_for_juli.length > LIMITS.notes)) e.push(`notes_for_juli: text, at most ${LIMITS.notes} characters`);
  const F = b.files || {};
  for (const k of Object.keys(F)) if (k !== 'sketch.js') e.push(`files: only sketch.js (found "${k}")`);
  const code = typeof F['sketch.js'] === 'string' ? F['sketch.js'] : '';
  if (!code) e.push('files.sketch.js is missing');
  if (code.length > LIMITS.code) e.push(`sketch.js is over ${LIMITS.code / 1e3} KB`);
  const bare = stripComments(code);
  for (const [rx, why] of BANNED) if (rx.test(bare)) e.push('sketch.js uses ' + why);
  if (code) for (const x of clashProblems(code)) e.push(x);   // 3.9 platform: a function / var p5 replaces when it starts (a save() that never saves), or a name the Kit needs
  if (code && !/window\.SLOTS/.test(code)) e.push('sketch.js never reads window.SLOTS');
  if (code && (types.has('on-open') || types.has('interval')) && !/p0\.onCheck\s*\(|K\.agent\s*\(/.test(bare)) e.push('an app that checks on its own registers its check: K.agent({...}) or p0.onCheck(fn)');
  if (m.category === 'agentic' && code && !/K\.notebook\s*\(/.test(bare)) e.push('an agentic app keeps what it learns in a K.notebook(...)');
  if (b.skills != null) for (const x of bundleSkillProblems(b.skills)) e.push('skills: ' + x);   // H39: {name: md}, <= 3, each a good skill
  if (JSON.stringify(b).length > LIMITS.bundle) e.push(`the file is over ${LIMITS.bundle / 1e3} KB`);
  return e;
}

function specProblems(f, p, e) {
  if (typeof f === 'string') { if (!/^string:\d+$/.test(f)) e.push(`slot ${p}: bad short form "${f}" (use "string:40")`); return; }
  if (!f || typeof f !== 'object' || !TYPES.has(f.type)) { e.push(`slot ${p}: unknown type`); return; }
  if (f.type === 'enum' && !(Array.isArray(f.enum) && f.enum.length)) e.push(`slot ${p}: enum needs a list`);
  if (f.type === 'string' && !(f.max > 0)) e.push(`slot ${p}: a string needs max`);
  if ((f.type === 'int' || f.type === 'array') && !(Number.isFinite(f.min) && Number.isFinite(f.max) && f.min <= f.max)) e.push(`slot ${p}: needs min and max`);
  if (f.type === 'ref' && !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(f.ref || '')) e.push(`slot ${p}: ref like "lists.name"`);
  if (f.type === 'object' || (f.type === 'array' && typeof f.item === 'object')) {
    if (!f.item || typeof f.item !== 'object') e.push(`slot ${p}: needs item fields`);
    else for (const [k, g] of Object.entries(f.item)) specProblems(g, p + '.' + k, e);
  }
  if (f.type === 'array' && typeof f.item === 'string') specProblems(f.item, p + '[]', e);
  if (f.type === 'array' && f.item == null) e.push(`slot ${p}: needs item`);
}

/** validateSlots(spec, values) -> problems (missing required slots, wrong types, limits). Used for slots_default and for Juli's fill. */
export function validateSlots(spec, obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['not an object'];
  const chk = (f, v, p, root) => {
    if (v === undefined || v === null) { if (typeof f === 'string' || f.required !== false) errs.push(p + ' missing'); return; }
    if (typeof f === 'string') { const n = +f.split(':')[1]; if (typeof v !== 'string') errs.push(p + ' is not text'); else if (v.length > n) errs.push(`${p} too long (${v.length} > ${n})`); return; }
    switch (f.type) {
      case 'string': if (typeof v !== 'string') errs.push(p + ' is not text'); else if (v.length > f.max) errs.push(`${p} too long (${v.length} > ${f.max})`); break;
      case 'color': if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) errs.push(p + ' is not a #rrggbb colour'); break;
      case 'int': if (!Number.isInteger(v)) errs.push(p + ' is not a whole number'); else if (v < f.min || v > f.max) errs.push(`${p} out of range (${f.min}-${f.max})`); break;
      case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(p + ' is not a number'); else if ((f.min != null && v < f.min) || (f.max != null && v > f.max)) errs.push(`${p} out of range`); break;
      case 'bool': if (typeof v !== 'boolean') errs.push(p + ' is not true/false'); break;
      case 'enum': if (!f.enum.includes(v)) errs.push(`${p} must be one of ${f.enum.map((x) => JSON.stringify(x)).join(', ')}`); break;
      case 'icon': if (!ICONS.includes(v)) errs.push(`${p}: unknown icon ${JSON.stringify(v)}`); break;
      case 'ref': { const [arr, key] = f.ref.split('.'); if (!(root[arr] || []).some((x) => x && x[key] === v)) errs.push(`${p} must be one of the ${arr} names`); break; }
      case 'object': if (typeof v !== 'object' || Array.isArray(v)) { errs.push(p + ' is not an object'); break; } for (const [k, g] of Object.entries(f.item || {})) chk(g, v[k], p + '.' + k, root); break;
      case 'array':
        if (!Array.isArray(v)) { errs.push(p + ' is not a list'); break; }
        if (v.length < f.min || v.length > f.max) errs.push(`${p} has ${v.length} items (want ${f.min}-${f.max})`);
        v.slice(0, 60).forEach((x, i) => {
          if (typeof f.item === 'string') chk(f.item, x, `${p}[${i}]`, root);
          else if (!x || typeof x !== 'object' || Array.isArray(x)) errs.push(`${p}[${i}] is not an object`);
          else for (const [k, g] of Object.entries(f.item)) chk(g, x[k], `${p}[${i}].${k}`, root);
        });
        break;
      default: errs.push(p + ': unknown slot type');
    }
  };
  for (const [k, f] of Object.entries(spec)) chk(f, obj[k], k, obj);
  return errs;
}

/** the top-level slot names a problem list mentions (for the repair round) */
export function slotsIn(problems) { return [...new Set(problems.map((x) => String(x).split(/[.[ :]/)[0]).filter(Boolean))]; }
/** codeProblems(code) -> the BANNED rules a piece of app code breaks, in words ('uses a web address'): an app's added part (the edit
 *  loop, makeapp/edit.js) is checked with the skeleton's own rules, without running it */
export function codeProblems(code) { const bare = stripComments(String(code || '')); return BANNED.filter(([rx]) => rx.test(bare)).map(([, why]) => 'uses ' + why); }
