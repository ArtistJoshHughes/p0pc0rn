// kbstarter.js - p0pc0rn's STARTER knowledge base: a read-only, offline pack of 3,214 English Wikipedia entries (the Aug-31-2026
// top-pageview batch from a TOON knowledge base), searched on the phone BEFORE the assistant goes to Wikipedia. Plain JS, no WASM, no
// third-party code. Works in browsers (Safari 16.4+, Chromium, Firefox) and in Node 18+ (pass `fetchFn`).
//
//   import { load, search } from './kbstarter.js';
//   const kb = await load({ base: 'kb/starter/' });          // manifest.json + index.json(.gz); shards are fetched lazily on a hit
//   const hits = await kb.search('Lionel Messi', { limit: 3 });
//   // or the module-level default instance: await search('Lionel Messi', { limit: 3 })  (loads from this module's folder)
//
// RESULT SHAPE (the KB seam; the personal KB returns the same keys):
//   { entry_key, title, facts, summary, citation, score,
//     source: 'starter', pageid, aliases, facts_toon, summary_toon, edges, title_match, matched }
//   facts    : [{subject, relation, value, kind, unverified?}]    (typed facts; `unverified` = not confirmed by the accuracy pass)
//   summary  : [{aspect, text, unverified_parts?}]                (aspect-keyed condensation; unverified_parts = parts not confirmed)
//   citation : {site:'wikipedia', siteName:'Wikipedia', title, url, permalink, revision, revid, revised, retrieved, authors,
//               license:'CC BY-SA 4.0', license_url, licenseUrl, derivative_license, changes, missing?}
//              revision = the oldid the condensation was made from; revised = that revision's timestamp; retrieved = when it was
//              fetched; authors = the page-history link; `missing` lists any field the KB did not hold (an explicit gap).
//              The keys site/siteName/permalink/authors/license/licenseUrl/revid/retrieved match research.js's `source` object, so
//              citationFooter() can render a starter hit like a live Wikipedia hit.
//   edges    : [{to_key, to_topic, relation, grounded}]           (links to OTHER starter entries only)
//   score    : BM25F over title+aliases (x2.5) and summary text, plus exact-title bonuses; higher is better, not normalised.
//   title_match: 'exact' | 'exact_base' (title minus its '(disambiguator)') | 'alias' | 'all_words' (every content word is in the title
//              or an alias) | 'partial' | 'none' (summary-only match). Treat exact / exact_base / alias / all_words as a KB hit; for
//              'partial' / 'none' the assistant should still go to Wikipedia.
//   matched  : the query words that matched ('mesi->messi' for a near-miss correction).
//
// PROPER-NAME RULE (research.js parity): a query that reads as a proper name (2-5 capitalised words, or 2-5 words that are all title
// words) must match on ALL its words when it has 2 (both), all but one when it has 3-5, anywhere in the entry's title, aliases or
// summary. 'Taylor Messi' returns nothing rather than half-matches. Near-misses ('Lionel Mesi', 'Taylor Swfit') are corrected
// against the title vocabulary (same first letter, edit distance 1, or 2 for words of 8+ letters) and count as matched.

export const FORMAT = 1;

// ------------------------------------------------------------------------------------------------ text normalisation (shared with the builder)
const FOLD = { 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ı': 'i', 'ħ': 'h', 'ŋ': 'n', 'ſ': 's' };
const FOLD_RE = /[øłđðþßæœıħŋſ]/g;
/** lower-case, strip diacritics (NFKD + drop combining marks), fold the letters NFKD leaves alone, drop apostrophes */
export function fold(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(FOLD_RE, (c) => FOLD[c]).replace(/['’‘`´]/g, '');
}
/** light English stemmer: plural -s / -es / -ies only (identical at build time and query time) */
export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ss|us|is|os)$/.test(w)) return w;
  if (/(sses|xes|ches|shes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}
/** words (folded, un-stemmed) */
export function words(s) { return fold(s).match(/[\p{L}\p{N}]+/gu) || []; }
/** index terms (folded + stemmed) */
export function terms(s) { return words(s).map(stem); }

export const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it '
  + 'its me my no not of on or our she so such than that the their them then there these they this those to too was we were what when where which '
  + 'while who whom why will with would you your also after before over under about between during s').split(' '));
const NAME_GLUE = new Set(['the', 'of', 'de', 'van', 'von', 'da', 'di', 'del', 'la', 'le', 'and', 'bin', 'al', 'du', 'des', 'der', 'den', 'y']);
const NAME_RE = /^(?:\p{Lu}[\p{L}\p{N}_'’.\-]*)(?:\s+(?:of|the|de|van|von|da|di|del|la|le|and|\p{Lu}[\p{L}\p{N}_'’.\-]*)){1,4}$/u;
const LEAD = /^\s*(?:(?:who|what|where|when|which)\s+(?:is|was|are|were)\s+|tell\s+me\s+(?:about\s+)?|(?:search|look\s*up|find)\s+(?:for\s+)?|information\s+(?:on|about)\s+)/i;

/** the query as a topic: leading question words and trailing punctuation dropped */
export function topicOf(q) { return String(q || '').replace(LEAD, '').replace(/[?!.]+\s*$/, '').trim(); }

// ------------------------------------------------------------------------------------------------ postings codec (shared with the builder)
// one string per term: comma-separated base-36 items "Δdoc" or "Δdoc.tf" (tf only when > 1), doc ids ascending.
export function encodePostings(list) {
  let prev = 0; const out = [];
  for (const [d, tf] of list) { out.push((d - prev).toString(36) + (tf > 1 ? '.' + tf.toString(36) : '')); prev = d; }
  return out.join(',');
}
export function decodePostings(s) {
  const docs = [], tfs = []; let d = 0;
  if (!s) return { docs, tfs };
  for (const it of s.split(',')) {
    const dot = it.indexOf('.');
    d += parseInt(dot < 0 ? it : it.slice(0, dot), 36);
    docs.push(d); tfs.push(dot < 0 ? 1 : parseInt(it.slice(dot + 1), 36));
  }
  return { docs, tfs };
}

// ------------------------------------------------------------------------------------------------ edit distance (optimal string alignment, bounded)
export function osa(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let p2 = new Array(lb + 1).fill(0), p = new Array(lb + 1), c = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) p[j] = j;
  for (let i = 1; i <= la; i++) {
    c[0] = i; let rmin = i;
    for (let j = 1; j <= lb; j++) {
      let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      c[j] = v; if (v < rmin) rmin = v;
    }
    if (rmin > max) return max + 1;
    const t = p2; p2 = p; p = c; c = t;
  }
  return p[lb];
}

// ------------------------------------------------------------------------------------------------ the index (pure; no I/O)
const K1 = 1.2, B_T = 0.5, B_B = 0.75, W_T = 2.5, W_B = 1.0, W_FUZZY = 0.75;

export class StarterIndex {
  /** idx = the parsed index.json */
  constructor(idx) {
    if (!idx || idx.format !== FORMAT) throw new Error('kbstarter: unsupported index format');
    this.idx = idx; this.N = idx.docs.keys.length;
    this.cache = new Map();
    this.byFirst = new Map();                                    // title vocabulary, bucketed by first letter, for near-miss correction
    for (const t of Object.keys(idx.T)) { if (t.length < 4 || /\d/.test(t)) continue; const k = t[0]; if (!this.byFirst.has(k)) this.byFirst.set(k, []); this.byFirst.get(k).push(t); }
    this.keyToDoc = new Map(idx.docs.keys.map((k, i) => [k, i]));
  }
  post(field, term) {
    const ck = field + term;
    let v = this.cache.get(ck);
    if (!v) { v = decodePostings(this.idx[field][term]); if (this.cache.size > 4000) this.cache.clear(); this.cache.set(ck, v); }
    return v;
  }
  has(term) { return Object.prototype.hasOwnProperty.call(this.idx.T, term) || Object.prototype.hasOwnProperty.call(this.idx.B, term); }
  inTitles(term) { return Object.prototype.hasOwnProperty.call(this.idx.T, term); }
  /** near-miss corrections of an unknown word, from the title vocabulary */
  near(term) {
    if (term.length < 4 || /\d/.test(term)) return [];
    const max = term.length >= 8 ? 2 : 1;
    let best = max + 1, out = [];
    for (const t of this.byFirst.get(term[0]) || []) {
      if (Math.abs(t.length - term.length) > max) continue;
      const d = osa(term, t, max);
      if (d < best) { best = d; out = [t]; } else if (d === best && d <= max) out.push(t);
    }
    return best <= max ? out.slice(0, 4) : [];
  }
  /** the query's slots: one per word (variants = the stem, a near-miss correction, or a joined compound like 'di caprio' -> dicaprio) */
  slots(q) {
    const ws = words(q), sl = [];
    for (let i = 0; i < ws.length; i++) {
      const a = stem(ws[i]);
      if (i + 1 < ws.length) {                                   // 'di caprio' / 'mc donalds' -> one title word
        const j = stem(ws[i] + ws[i + 1]);
        if (!this.has(a) || !this.has(stem(ws[i + 1])) || NAME_GLUE.has(ws[i])) {
          if (this.inTitles(j)) { sl.push({ word: ws[i] + ' ' + ws[i + 1], vars: [[j, 1]], stop: false }); i++; continue; }
        }
      }
      const stop = STOP.has(ws[i]);
      if (this.has(a)) { sl.push({ word: ws[i], vars: [[a, 1]], stop }); continue; }
      const nm = stop ? [] : this.near(a);
      sl.push({ word: ws[i], vars: nm.map((t) => [t, W_FUZZY]), stop, fuzzy: nm.length > 0, unknown: nm.length === 0 });
    }
    return sl;
  }
  /** is the query a proper name? -> its significant slots, else null */
  nameSlots(raw, sl) {
    const content = sl.filter((s) => !NAME_GLUE.has(s.word));
    if (content.length < 2 || content.length > 5) return null;
    if (NAME_RE.test(raw)) return content;
    if (content.every((s) => s.vars.some(([t]) => this.inTitles(t)))) return content;   // 'lionel messi' typed in lower case
    return null;
  }
  /** -> [{doc, entry_key, title, score, matched}] (sync; no entry bodies) */
  rank(query, { limit = 5 } = {}) {
    const raw = topicOf(query);
    const sl = this.slots(raw);
    if (!sl.length) return [];
    const { idx } = this, N = this.N, lenT = idx.docs.lenT, lenB = idx.docs.lenB;
    const acc = new Map(), hit = new Map(), hitT = new Map();   // doc -> score, doc -> Set(slot index) any field / title field
    sl.forEach((s, si) => {
      for (const [t, w] of s.vars) {
        for (const [field, W, bb, lens, avg] of [['T', W_T, B_T, lenT, idx.avgT], ['B', W_B, B_B, lenB, idx.avgB]]) {
          if (!Object.prototype.hasOwnProperty.call(idx[field], t)) continue;
          const { docs, tfs } = this.post(field, t);
          const idf = Math.log(1 + (N - docs.length + 0.5) / (docs.length + 0.5));
          const sw = s.stop ? 0.15 : 1;
          for (let k = 0; k < docs.length; k++) {
            const d = docs[k], tf = tfs[k];
            const tn = (tf * (K1 + 1)) / (tf + K1 * (1 - bb + bb * lens[d] / avg));
            acc.set(d, (acc.get(d) || 0) + w * sw * W * idf * tn);
            if (!hit.has(d)) hit.set(d, new Set());
            hit.get(d).add(si);
            if (field === 'T') { if (!hitT.has(d)) hitT.set(d, new Set()); hitT.get(d).add(si); }
          }
        }
      }
    });
    const names = this.nameSlots(raw, sl);
    const need = names ? (names.length <= 2 ? names.length : names.length - 1) : 0;
    const nameIdx = names ? names.map((s) => sl.indexOf(s)) : [];
    const content = sl.map((s, i) => (s.stop ? -1 : i)).filter((i) => i >= 0);
    const qn = words(raw).join(' ');
    const out = [];
    for (const [d, sc0] of acc) {
      const h = hit.get(d);
      if (names && nameIdx.filter((i) => h.has(i)).length < need) continue;   // the proper-name rule
      const cov = content.length ? content.filter((i) => h.has(i)).length / content.length : 1;
      let sc = sc0 * (0.4 + 0.6 * cov * cov);
      const titleN = idx.docs.norm[d], ht = hitT.get(d) || new Set();
      let tm = 'none';
      if (titleN === qn) { sc += 25; tm = 'exact'; }
      else if (idx.docs.base[d] === qn) { sc += 18; tm = 'exact_base'; }
      else if ((idx.docs.alias[d] || []).includes(qn)) { sc += 15; tm = 'alias'; }
      else if (content.length && content.every((i) => ht.has(i))) tm = 'all_words';
      else if (ht.size) tm = 'partial';
      out.push({ doc: d, entry_key: idx.docs.keys[d], title: idx.docs.titles[d], score: Math.round(sc * 1000) / 1000, title_match: tm,
        matched: sl.filter((_, i) => h.has(i)).map((s) => (s.fuzzy ? s.word + '->' + s.vars.map((v) => v[0]).join('/') : s.word)) });
    }
    out.sort((a, b) => b.score - a.score || a.doc - b.doc);
    return out.slice(0, Math.max(0, limit));
  }
}

// ------------------------------------------------------------------------------------------------ entries (shard lines -> the seam shape)
export function expandEntry(e, header) {
  const def = header.citation_defaults || {};
  const subj = e.subject;
  const cit = { ...def, ...e.citation };
  cit.revid = cit.revision; cit.licenseUrl = cit.license_url;
  const qa = e.qa || {}, uf = new Set(qa.unverified_facts || []), ur = {};
  for (const [ri, frag] of qa.unverified_fragments || []) (ur[ri] = ur[ri] || []).push(frag);
  return {
    entry_key: e.entry_key, title: e.title,
    // `unverified: true` = the accuracy pass could not confirm this fact against the cited revision (kept, not deleted)
    facts: (e.facts || []).map((r, i) => Object.assign({ subject: r.length > 3 ? r[3] : subj, relation: r[0], value: r[1], kind: r[2] }, uf.has(i) ? { unverified: true } : {})),
    summary: (e.summary || []).map((r, i) => Object.assign({ aspect: r[0], text: r[1] }, ur[i] ? { unverified_parts: ur[i] } : {})),
    citation: cit, score: 0,
    source: 'starter', pageid: e.pageid, subject: e.subject, norm_title: e.norm_title, aliases: e.aliases || [],
    facts_toon: e.facts_toon || '', summary_toon: e.summary_toon || '',
    edges: (e.edges || []).map((r) => ({ to_key: r[0], to_topic: r[1], relation: r[2], grounded: r[3] })),
  };
}

// ------------------------------------------------------------------------------------------------ loader
async function readText(fetchFn, url, { gz = false, sha256 = null } = {}) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`kbstarter: ${url} -> HTTP ${r.status}`);
  let bytes;
  if (gz) bytes = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  else bytes = new Uint8Array(await r.arrayBuffer());
  if (sha256 && globalThis.crypto && globalThis.crypto.subtle) {
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
    if (h !== sha256) throw new Error(`kbstarter: sha256 mismatch for ${url}`);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * load({base, fetchFn, gzip, verify}) -> kb
 *   base    : folder URL of the pack (default: this module's folder)
 *   fetchFn : fetch-compatible function (default globalThis.fetch; Node tests pass one that reads files)
 *   gzip    : fetch the .gz files and inflate with DecompressionStream when available (default true)
 *   verify  : check each file's sha256 from manifest.json with WebCrypto when available (default true)
 * kb = { count, manifest, index, search(query, {limit}) -> Promise<[result]>, rank(query, {limit}) -> [{entry_key,title,score}],
 *        get(entry_key) -> Promise<result|null>, loadAll() -> Promise<void>, stats() }
 */
export async function load({ base = null, fetchFn = null, gzip = true, verify = true } = {}) {
  const f = fetchFn || globalThis.fetch.bind(globalThis);
  const root = base ? String(base).replace(/\/?$/, '/') : new URL('./', import.meta.url).href;
  const useGz = gzip && typeof DecompressionStream !== 'undefined';
  const t0 = (globalThis.performance || Date).now();
  const manifest = JSON.parse(await readText(f, root + 'manifest.json'));
  if (manifest.format !== FORMAT) throw new Error('kbstarter: unsupported pack format');
  const file = (m) => (useGz && m.gzip_path ? [root + m.gzip_path, true] : [root + m.path, false]);
  const [iu, igz] = file(manifest.index);
  const index = new StarterIndex(JSON.parse(await readText(f, iu, { gz: igz, sha256: verify ? manifest.index.sha256 : null })));
  const loadMs = (globalThis.performance || Date).now() - t0;
  const shards = new Map();                                       // shard number -> Promise<{header, lines}>
  const shard = (n) => {
    if (!shards.has(n)) {
      const m = manifest.shards[n], [u, gz] = file(m);
      shards.set(n, readText(f, u, { gz, sha256: verify ? m.sha256 : null }).then((txt) => {
        const lines = txt.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
        return { header: JSON.parse(lines[0]), lines };
      }).catch((e) => { shards.delete(n); throw e; }));
    }
    return shards.get(n);
  };
  const entry = async (d) => {
    const s = await shard(index.idx.docs.shard[d]);
    const e = JSON.parse(s.lines[index.idx.docs.line[d]]);
    if (e.entry_key !== index.idx.docs.keys[d]) throw new Error('kbstarter: index and shard disagree at ' + e.entry_key);
    return expandEntry(e, s.header);
  };
  const kb = {
    count: index.N, manifest, index,
    rank: (q, o = {}) => index.rank(q, o),
    async search(q, { limit = 5 } = {}) {
      const ranked = index.rank(q, { limit });
      return Promise.all(ranked.map(async (r) => Object.assign(await entry(r.doc), { score: r.score, title_match: r.title_match, matched: r.matched })));
    },
    async get(key) { const d = index.keyToDoc.get(key); return d === undefined ? null : entry(d); },
    async loadAll() { await Promise.all(manifest.shards.map((_, n) => shard(n))); },
    stats: () => ({ count: index.N, terms: Object.keys(index.idx.T).length + Object.keys(index.idx.B).length, shardsLoaded: shards.size, indexLoadMs: Math.round(loadMs) }),
  };
  return kb;
}

let _default = null;
/** module-level search against the pack next to this module (loaded on first use) */
export async function search(query, opts = {}) {
  if (!_default) _default = load().catch((e) => { _default = null; throw e; });
  return (await _default).search(query, opts);
}
