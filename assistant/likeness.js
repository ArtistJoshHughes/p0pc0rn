// likeness.js - p0pc0rn v022. Josh (Oct 13): "the research lane for grounding on facts can not make likeness of copyrighted things or
// peoples likeness ... it should be 'like this person' or 'like this thing' to ensure transformative from grounding."
// Text and visuals are split. Grounded facts may go into chat answers and lyrics, names included. A VISUAL job planned from them
// carries only an archetype, a role, an era, a setting, a mood, materials and a palette, never an identity. This module is the
// CODE gate (the planner only ever sees data):
//   - entityClass(record): what a looked-up page is about. People, characters and creatures, brands, products and works are
//     protected and never a likeness. Places, landmarks, natural features, events and historic objects (a historic ship) may be
//     named settings, with no logos or brand marks.
//   - blockTerms(record): the record's own names (title, title words, the other entries that matched, name-valued facts, proper
//     names in its text) and its appearance facts (colours, materials, forms, emblems, named items).
//   - scanPrompt(): names in a visual prompt (one is enough), plus any TWO appearance terms of one protected entity (a cheerful
//     plumber in a red cap and overalls IS Mario).
//   - stripPrompt(): the code fallback. Names become the entity's generic descriptor, appearance terms are dropped, brand words go.
import { properNames, termsHit } from './tools.js';

const CAT = (cats) => (cats || []).map((c) => String(c || '').replace(/^Category:/i, '')).join(' | ');
const PROTECTED_CATS = /\b(people|births|deaths|living|singers|musicians|actors|actresses|rappers|footballers|players|politicians|characters?|creatures|monsters|pok[eé]mon|mascots|companies|brands|corporations|products|software|video games|games|films|television|series|episodes|albums|songs|singles|novels|books|comics|manga|anime|paintings|artworks|sculptures|logos|franchises|fictional|toys|vehicles models|automobiles|consoles|smartphones)\b/i;
const ALLOWED_CATS = /\b(bridges|buildings|landmarks|towers|dams|canals|canyons|gorges|mountains|volcanoes|rivers|lakes|seas|oceans|islands|beaches|forests|deserts|valleys|waterfalls|parks|national parks|cities|towns|villages|communes|populated places|regions|countries|states|streets|squares|monuments|castles|cathedrals|churches|temples|ruins|archaeological|battles|wars|disasters|incidents|shipwrecks|ships|steamships|locomotives|aircraft|historic|museums|stadiums|venues|species|animals|birds|mammals|fish|insects|plants|trees|flowers|fungi|minerals|rocks|weather|storms|earthquakes|eclipses)\b/i;
const PLACE_RELS = new Set(['located_in', 'capital_of', 'population', 'area', 'elevation', 'depth']);

/** a looked-up record -> 'person' | 'character' | 'brand' | 'work' | 'place' | 'event' | 'object' | 'nature' | 'thing' */
export function entityClass(rec) {
  if (!rec) return 'thing';
  const cats = CAT(rec.categories), rels = new Set((rec.facts || []).map((f) => f.relation));
  if (rec.isPerson || rels.has('born') || rels.has('died') && !ALLOWED_CATS.test(cats)) return 'person';
  if (rec.isCharacter || (rec.source && rec.source.site === 'fandom') || ['species', 'homeworld', 'weapon', 'first_appearance', 'franchise'].some((r) => rels.has(r))) return 'character';
  if (/\b(companies|brands|corporations|products|software|consoles|smartphones|logos|mascots)\b/i.test(cats) || ['developed_by', 'publisher', 'headquarters'].some((r) => rels.has(r))) return 'brand';
  if (/\b(films|television|series|albums|songs|singles|novels|books|comics|paintings|artworks|sculptures|video games|games)\b/i.test(cats) || ['directed_by', 'author', 'released', 'genre'].some((r) => rels.has(r))) return 'work';
  if (/\b(battles|wars|disasters|incidents|earthquakes|storms|eclipses)\b/i.test(cats)) return 'event';
  if (/\b(shipwrecks|ships|steamships|locomotives|aircraft|historic|archaeological)\b/i.test(cats)) return 'object';
  if (/\b(species|animals|birds|mammals|fish|insects|plants|trees|flowers|fungi|minerals|rocks)\b/i.test(cats)) return 'nature';
  if (ALLOWED_CATS.test(cats) || [...PLACE_RELS].some((r) => rels.has(r))) return 'place';
  return PROTECTED_CATS.test(cats) ? 'work' : 'thing';
}
export const PROTECTED = new Set(['person', 'character', 'brand', 'work']);
export const isProtected = (rec) => PROTECTED.has(entityClass(rec));

const LOOK_RELS = new Set(['color', 'material', 'form', 'style', 'weapon', 'setting']);
const NAME_RELS = new Set(['franchise', 'appears_in', 'first_appearance', 'creator', 'affiliation', 'homeworld', 'weapon', 'developed_by', 'publisher', 'designed_by', 'author', 'directed_by', 'founded_by', 'part_of']);
const STOP = new Set(['the', 'and', 'of', 'in', 'on', 'at', 'a', 'an', 'for', 'with', 'from', 'by', 'to', 'its', 'his', 'her', 'their', 'this', 'that', 'it', 'is', 'was', 'he', 'she', 'they', 'but', 'as', 'also', 'after', 'before', 'during', 'when', 'while', 'since', 'one', 'two', 'first', 'new', 'north', 'south', 'east', 'west', 'american', 'british', 'english', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const lc = (s) => String(s || '').toLowerCase();
/** capitalised words in a text that are not sentence starts */
function capitalised(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?<![.!?]\s)(?<!^)\b(\p{Lu}[\p{L}'’-]{2,}(?:\s+\p{Lu}[\p{L}'’-]{2,})*)/gu)) out.add(m[1]);
  return [...out].filter((w) => !STOP.has(lc(w)));
}
const ALIAS = /\b(?:born|n[ée]e|also known as|known professionally as|better known as|stage name|nicknamed)\s+["“]?(\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){0,3})/gu;
const DESIGN = /\b(emblem|logo|crest|symbol|insignia|sword|shield|armou?r|costume|outfit|uniform|cap|hat|tunic|cape|mask|helmet|mark|badge|wand|blade)s?\b/i;
/** {title, cls, prot, ids (the identity: -> the generic descriptor), names (other names: dropped), looks (appearance terms), generic}.
 *  A protected record: its title and title words, aliases, the entries that also matched, name-valued facts, and the capitalised
 *  words of any sentence about its design (the Triforce on a shield). An allowed record (a place, an event, a historic object) keeps
 *  its own name; only the people who made it are blocked (the real-person check covers anyone else named in a prompt). */
export function blockTerms(rec, signatures = {}) {
  const cls = entityClass(rec), prot = PROTECTED.has(cls), ids = new Set(), names = new Set(), looks = new Set();
  const title = String(rec.title || '').replace(/\s*\(.*?\)\s*$/, '').trim();
  const text = [rec.lead, rec.summary, ...(rec.facts || []).map((f) => f.quote)].filter(Boolean).join(' ');
  if (prot) {
    if (title) ids.add(title);
    for (const w of title.split(/\s+/)) if (w.length >= 4 && !STOP.has(lc(w)) && /^\p{Lu}/u.test(w)) ids.add(w);
    for (const m of text.matchAll(ALIAS)) if (!STOP.has(lc(m[1].trim()))) ids.add(m[1].trim());
    for (const o of rec.others || []) names.add(String(o).replace(/\s*\(.*?\)\s*$/, ''));
    // fiction: every name in its record (the other characters, places and items of its world: "Link carries it"); others: the
    // names in a sentence about the design (the Triforce on a shield)
    for (const sent of text.split(/(?<=[.!?])\s+/)) {
      if (cls !== 'character' && !DESIGN.test(sent)) continue;
      for (const c of capitalised(cls === 'character' ? ' ' + sent.replace(/^\s*\p{Lu}/u, (x) => x) : sent)) if (!ids.has(c)) names.add(c);
      if (cls === 'character') { const m = /^\s*(\p{Lu}[\p{L}'’-]{2,})/u.exec(sent); if (m && !STOP.has(lc(m[1]))) names.add(m[1]); }
    }
    for (const f of rec.facts || []) {
      if (NAME_RELS.has(f.relation) && /[a-z]{3,}/i.test(f.value)) names.add(String(f.value).replace(/_/g, ' '));
      if (LOOK_RELS.has(f.relation)) looks.add(String(f.value).replace(/_/g, ' '));
    }
  } else {
    for (const f of rec.facts || []) if (['designed_by', 'founded_by', 'author', 'creator'].includes(f.relation) && /[a-z]{3,}/i.test(f.value)) names.add(String(f.value).replace(/_/g, ' '));
  }
  for (const [k, terms] of Object.entries(signatures)) if ([title, ...ids, ...names].some((n) => lc(n) === k || lc(n).includes(k + ' ') || lc(n).endsWith(' ' + k))) for (const t of terms) looks.add(t);
  const keep = (x) => x.length >= 3 && !(prot ? false : lc(title).includes(lc(x)));
  return { title: rec.title, cls, prot, shingles: shingles(text), ids: [...ids].filter(keep), names: [...names].filter(keep).filter((n) => !ids.has(n)), looks: [...looks].filter((n) => n.length >= 3), generic: genericFor(rec, cls) };
}
/** 6-word windows of the source text as 32-bit hashes (never the text itself): a lyric line copying the source is caught even when
 *  only the phone's KB entry is at hand */
export function shingles(text) {
  const w = (' ' + String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ').trim().split(' '), out = new Set();
  for (let i = 0; i + 6 <= w.length; i++) out.add(fnv(w.slice(i, i + 6).join(' ')));
  return [...out].slice(0, 400);
}
export function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
/** the generic descriptor a name becomes: an archetype, never an identity */
export function genericFor(rec, cls = entityClass(rec)) {
  const f = (r) => ((rec && rec.facts) || []).find((x) => x.relation === r);
  const occ = f('occupation') || f('field');
  if (cls === 'person') return occ && /^[a-z][a-z -]{2,30}$/.test(occ.value) && !/player$/.test(occ.value) ? `a ${occ.value.replace(/ and .*$/, '')}` : 'a person';
  if (cls === 'character') { const noun = /\b(shield|sword|ship|castle|robot|helmet|armou?r|bow|staff|ring|crown|wand|vehicle|car|spaceship|starship|tower|city|kingdom|planet|creature|dragon)$/i.exec(String((rec && rec.title) || '').replace(/\s*\(.*?\)\s*$/, '')); return noun ? `an original ${noun[1].toLowerCase()}` : 'an original character'; }
  if (cls === 'brand') return 'an unbranded object';
  if (cls === 'work') return 'an original scene';
  return 'it';
}
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (t) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(t).replace(/\s+/g, '[\\s-]+')}(?![\\p{L}\\p{N}])`, 'giu');
/** a one-word Name matches only as a Name ("Shield" the title word, not "a wooden shield"); longer names in any case */
const nameRe = (n) => (/\s/.test(n) || !/^\p{Lu}/u.test(n) ? wordRe(n) : new RegExp(wordRe(n).source, 'gu'));
/** names and look combinations in a prompt -> {names: [...], looks: [{entity, terms}], hit} */
export function scanPrompt(prompt, blocks, extra = {}) {
  const p = String(prompt || ''), names = new Set(), looks = [];
  for (const b of blocks) {
    for (const n of [...b.ids, ...b.names]) if (nameRe(n).test(p)) names.add(n);
    const lh = b.looks.filter((t) => wordRe(t).test(p));
    const lm = lh.filter((t) => !lh.some((u) => u !== t && u.includes(t)));   // "red" inside "red cap" counts once
    if (lm.length >= 2 && b.prot) looks.push({ entity: b.title, terms: lm.sort((x, y) => y.length - x.length) });
  }
  for (const n of extra.names || []) if (nameRe(n).test(p)) names.add(n);
  return { names: [...names], looks, hit: names.size > 0 || looks.length > 0 };
}
/** the code fallback: an identity -> the generic descriptor; other names and a flagged look combination -> cut with their phrase
 *  ("in a red cap", "and blue overalls", "held by Link", "the Triforce emblem") */
const FUNC = new Set(['in', 'with', 'wearing', 'and', 'has', 'having', 'by', 'of', 'from', 'on', 'at', 'to', 'a', 'an', 'the', 'his', 'her', 'its', 'their', 'holding', 'carrying', 'like']);
const ART = new Set(['a', 'an', 'the', 'his', 'her', 'its', 'their']);
const LINK = new Set(['in', 'with', 'wearing', 'and', 'has', 'having', 'by', 'of', 'from', 'holding', 'carrying', 'like']);
const PART = new Set(['held', 'carried', 'worn', 'used', 'wielded', 'owned', 'made', 'created', 'designed', 'drawn', 'played', 'voiced']);
const DESIGNW = new Set(['emblem', 'emblems', 'logo', 'logos', 'crest', 'symbol', 'insignia', 'mark', 'badge']);
const bare = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '').replace(/['’]s$/, '');
function cut(p, term, replacement = '') {
  const cs = !/\s/.test(term) && /^\p{Lu}/u.test(term);   // a one-word Name is cut only where it is written as a Name
  const want = (cs ? String(term) : String(term).toLowerCase()).split(/[\s-]+/).filter(Boolean);
  const norm1 = (t) => (cs ? String(t || '').replace(/[^\p{L}\p{N}'’-]/gu, '').replace(/['’]s$/, '') : bare(t));
  for (let guard = 0; guard < 8; guard++) {
    const toks = p.split(/\s+/).filter(Boolean);
    let i = -1;
    for (let k = 0; k + want.length <= toks.length && i < 0; k++) {
      const seg = toks.slice(k, k + want.length).map(norm1).join(' ').split(/[\s-]+/).join(' ');
      if (seg === want.join(' ')) i = k;
    }
    if (i < 0) return p;
    let a = i, b = i + want.length;
    if (b < toks.length && DESIGNW.has(bare(toks[b])) && !/[,.;:!?]$/.test(toks[b - 1])) b++;
    const tail = (toks[b - 1].match(/[,.;:!?]+$/) || [''])[0];
    // a one-word term before another word is an adjective ("a blue shield"): only the word goes
    const adjOnly = want.length === 1 && b < toks.length && !/[,.;:!?]$/.test(toks[b - 1]) && /^\p{L}/u.test(toks[b] || '');
    if (!replacement && !adjOnly) {
      let adj = 0;
      while (a > 0 && adj < 2 && !FUNC.has(bare(toks[a - 1])) && !/[,.;:!?]$/.test(toks[a - 1]) && !/^\p{Lu}/u.test(toks[a - 1])) { a--; adj++; }
      if (a > 0 && ART.has(bare(toks[a - 1]))) a--;
      if (a > 0 && LINK.has(bare(toks[a - 1]))) { a--; if (a > 0 && PART.has(bare(toks[a - 1]))) a--; }
    } else if (replacement && a > 0 && ART.has(bare(toks[a - 1]))) a--;
    const head = toks.slice(0, a), rest = toks.slice(b);
    if (replacement) head.push(replacement + tail);
    else if (tail && head.length && !/[,.;:!?]$/.test(head[head.length - 1])) head[head.length - 1] += tail;
    p = [...head, ...rest].join(' ');
  }
  return p;
}
export function stripPrompt(prompt, blocks, scan, extra = {}) {
  let p = String(prompt || '');
  const gens = [];   // generics go in as placeholders, so a later, shorter name ("Shield") never re-matches "an original shield"
  for (const n of [...scan.names].sort((a, b) => b.length - a.length)) {
    const b = blocks.find((x) => x.ids.some((id) => n === id || n.includes(id))), g = b ? b.generic : (extra.generic && extra.generic[n]) || '';
    if (g) { gens.push(g); p = cut(p, n, `qqgen${gens.length - 1}qq`); } else p = cut(p, n);
  }
  // one identity said twice in a row ("an original shield, an original shield") is said once
  p = p.replace(/qqgen(\d+)qq/g, (m, k) => gens[Number(k)]).replace(/\b(an? original \w+|an? [\w-]+)([,.]?)\s+\1\b/gi, '$1$2');
  for (const l of scan.looks) for (const t of l.terms) p = cut(p, t);
  p = p.replace(/^\s*[,.;:]\s*/, '').replace(/\s+([,.;:])/g, '$1').replace(/([,;:])\s*([,.;:])/g, '$2').replace(/\s{2,}/g, ' ').trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : p;
}
/** user-text and prompt names the static lists know (famous characters, brands) */
export function knownNames(text, TERMS) { return TERMS ? [...termsHit(text, 'characters'), ...termsHit(text, 'brands')] : []; }
