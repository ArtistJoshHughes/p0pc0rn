// kb.js - p0pc0rn v021: the phone's own knowledge base, which grows with use (Josh, Oct 13: "Yes it grows with use").
// Every successful lookup (a chat answer or a song's grounding) keeps its AIRLOCKED result here for good (IndexedDB 'p0pc0rn-kb', not the
// 14-day cache): the typed facts and their rendered lines, a short summary when there is one, and the citation (title, url, the permalink
// to the exact revision, the revision id, `revised` = that revision's time, `retrieved` = when this phone fetched it, the authors link,
// the licence). Never page text. research.js checks it FIRST (with the same name / model / relevance / biography guards), so a second ask
// needs no network and no reader call. Private to this phone; nothing here is ever uploaded.
//
// THE SOURCE SEAM (a read-only "starter KB" pack, a separate download, plugs in later as a second local source, checked after this one
// and before the network): any object with   name: string, readOnly: true, search(query: string) -> Promise<Entry[]>   where Entry is
// the shape kept here: {key, v (2 = v022: every fact quote-anchored), site: 'wikipedia' | 'fandom', wiki, title, topics: [normalised keys],
// facts: [{relation, value, kind, quote (v022: the reader's words from the page, checked in code), unverified? (starter pack only)}],
// like (v022: the likeness gate's derived names / looks / class and hashed 6-word shingles of the lead, never page text)
// (validated by the lane again on use), lines: [rendered fact lines], summary (<= 300 chars, scrubbed), categories, flags, others,
// isPerson, isCharacter, source: {site, wiki, siteName, url, permalink, authors, license, licenseUrl, revid, revised, retrieved}}.
// search() may be generous; the lane keeps only entries that kbMatch() the query AND pass the name / model / relevance / biography
// guards. Pass it as createResearch({ starter }) (the personal KB is created by createResearch itself; kb: null turns it off).
import { openDB } from './idb.js';

export const KB_DB = 'p0pc0rn-kb';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const bare = (s) => norm(s).replace(/^the /, '');
/** may this entry answer `query`? a topic asked before, the same title, or the title inside the query ("Eiffel" in "Eiffel
 *  Tower": the name guard then refuses it). The lane (research.js) applies the same rule and its guards to every source, starter included. */
export function kbMatch(query, e) {
  const q = norm(query), t = bare(e && e.title);
  if (!q || !t) return 0;
  return (e.topics || []).includes(q) ? 3 : t === bare(q) ? 2 : (' ' + bare(q) + ' ').includes(' ' + t + ' ') ? 1 : 0;
}

/** v022.1: a hit's quote facts as KB rows {subject, quote, source (the revision link), revision, retrieved} */
export function quoteRows(rec) {
  const s = (rec && rec.source) || {};
  return ((rec && rec.facts) || []).filter((f) => f && f.relation === 'quote').map((f) => ({ subject: rec.title, quote: String(f.value), source: s.permalink || s.url || '', revision: s.revid || null, retrieved: s.retrieved || null }));
}
/** the same rows in TOON, the notation the starter pack uses: quotes[n]{subject,quote,source,revision,retrieved} */
export function toonQuotes(rows) {
  const cell = (x) => { const v = x == null ? '' : String(x); return /[",\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return `quotes[${rows.length}]{subject,quote,source,revision,retrieved}:` + rows.map((r) => '\n  ' + [r.subject, r.quote, r.source, r.revision, r.retrieved].map(cell).join(',')).join('');
}

export async function createKB({ dbName = KB_DB, now = () => Date.now() } = {}) {
  const db = await openDB(dbName, 1, { entries: { keyPath: 'key' } });
  const keyOf = (site, wiki, title) => `${site}:${wiki || ''}:${norm(title)}`;
  return {
    name: 'personal', readOnly: false, persistent: db.persistent !== false,
    /** entries that may answer `query`, best first (the lane's guards then decide) */
    async search(query) {
      const out = [];
      for (const e of await db.all('entries')) { const score = kbMatch(query, e); if (score) out.push({ e, score }); }
      return out.sort((a, b) => b.score - a.score || (b.e.keptAt || 0) - (a.e.keptAt || 0)).map((x) => x.e);
    },
    /** a live hit -> kept for good (merging the topic key into an entry already kept for the same page) */
    async put(rec, topic) {
      if (!rec || rec.status !== 'hit' || !rec.source) return null;
      const key = keyOf(rec.source.site, rec.source.wiki, rec.title), prev = await db.get('entries', key);
      const e = { key, site: rec.source.site, wiki: rec.source.wiki || null, title: rec.title,
        topics: [...new Set([...((prev && prev.topics) || []), norm(topic), norm(rec.title)].filter(Boolean))].slice(0, 12),
        facts: rec.facts || [], lines: rec.lines || [], summary: rec.summary || '', categories: (rec.categories || []).slice(0, 30), flags: rec.flags || [],
        others: rec.others || [], like: rec.like || null, isPerson: !!rec.isPerson, isCharacter: !!rec.isCharacter, source: Object.assign({}, rec.source),
        quotes: quoteRows(rec), toon: toonQuotes(quoteRows(rec)),
        v: 3, keptAt: (prev && prev.keptAt) || now(), savedAt: now(), checkedAt: now(), stale: false, hits: (prev && prev.hits) || 0 };
      await db.put('entries', e); return e;
    },
    async get(key) { return db.get('entries', key); },
    async touch(key, patch) { const e = await db.get('entries', key); if (e) await db.put('entries', Object.assign(e, patch)); return e; },
    async count() { return (await db.all('entries')).length; },
    async all() { return db.all('entries'); },
    async clear() { await db.clear('entries'); },
    /** the injection escape hatch: drop what was saved since `cut` (ms) */
    async purgeSince(cut) { let n = 0; for (const e of await db.all('entries')) if ((e.savedAt || 0) >= cut) { await db.del('entries', e.key); n++; } return n; },
  };
}
