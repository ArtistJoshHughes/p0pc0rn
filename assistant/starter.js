// starter.js - p0pc0rn v022: the STARTER knowledge pack (3,214 English Wikipedia articles from the Aug-31-2026 top-pageview batch,
// built by the starter-KB builder; its address comes from config.js), downloaded once into IndexedDB ('p0pc0rn-starter') and searched by
// research.js AFTER the phone's own KB and BEFORE the network.
//   createStarterEngine({base}) -> an engine-shaped object for Settings › Models (status, download({onProgress, signal}),
//     deleteModel, requestPersistentStorage) + source() -> the research seam {name, readOnly, search(query) -> entries}.
// Only the gzip files are fetched (manifest.json + index.json.gz + 7 shards, about 2.6 MB); each is checked against the manifest's
// sha256 when it arrives, kept as a Blob, and inflated by kbstarter.js when it is searched (DecompressionStream: Safari 16.4+).
// The pack is read-only: its hits are never copied into the personal KB. A fact the builder's accuracy pass could not confirm carries
// `unverified`, and research.js renders it hedged ("Reportedly …").
import { openDB } from './idb.js';
import { load } from './kbstarter.js';
import { fetchManifest, manifestRefused } from '../engine/core/pin.js';   // v027.3: pinned manifests
import { PERSON_OK } from './research.js';

export const STARTER_DB = 'p0pc0rn-starter';
const HIT = new Set(['exact', 'exact_base', 'alias', 'all_words']);
// a few of the pack's relations are the phone's under another name; the rest of its open vocabulary stays out (closed schema)
const MAP = { director: 'directed_by', plays_for: 'affiliation', team: 'affiliation', party: 'affiliation', writer: 'author' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sha = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), (b) => b.toString(16).padStart(2, '0')).join('');

export function createStarterEngine({ base = (globalThis.P0_CONFIG && globalThis.P0_CONFIG.packs['starter-kb']) || './kb/', fetchFn = null, dbName = STARTER_DB } = {}) {
  const f = fetchFn || ((...a) => fetch(...a));
  let db = null, kb = null;
  const open = async () => (db = db || await openDB(dbName, 1, { files: { keyPath: 'path' } }));
  const manifestOf = async () => { const m = await (await open()).get('files', 'manifest.json'); return m ? JSON.parse(await m.blob.text()) : null; };
  const plan = (m) => [{ path: m.index.gzip_path, size: m.index.gzip_bytes, sha: m.index.gzip_sha256 }, ...m.shards.map((s) => ({ path: s.gzip_path, size: s.gzip_bytes, sha: s.gzip_sha256 }))];
  const eng = {
    id: 'starter-kb',
    async status() {
      const d = await open(), m = await manifestOf();
      if (!m) return { complete: false, haveBytes: 0, totalBytes: 2631059, packVersion: null };
      const files = plan(m), have = await Promise.all(files.map((x) => d.get('files', x.path)));
      const haveBytes = files.reduce((a, x, i) => a + (have[i] ? x.size : 0), 0), totalBytes = files.reduce((a, x) => a + x.size, 0);
      return { complete: have.every(Boolean), haveBytes, totalBytes, packVersion: (m.build_date || '').slice(0, 10), count: m.count };
    },
    async download({ onProgress = () => {}, signal = null } = {}) {
      const d = await open();
      let m = await manifestOf();
      if (!m) {
        const got = await fetchManifest(base, { signal, credentials: 'same-origin' }, f);   // v027.3: checked against config.js
        if (!got) throw new Error('the starter knowledge pack is not reachable (check the network)');
        if (got.bad) { manifestRefused(got, false); throw new Error(`the starter knowledge pack: ${got.bad}`); }
        const blob = new Blob([got.ab], { type: 'application/json' }); m = got.m;
        if (m.format !== 1) throw new Error('the starter knowledge pack has an unknown format');
        await d.put('files', { path: 'manifest.json', blob, size: blob.size });
      }
      const files = plan(m), total = files.reduce((a, x) => a + x.size, 0), t0 = Date.now();
      let have = 0;
      for (const x of files) if (await d.get('files', x.path)) have += x.size;
      onProgress({ haveBytes: have, totalBytes: total, bytesPerSec: 0, etaSeconds: null });
      for (const x of files) {
        if (await d.get('files', x.path)) continue;
        const r = await f(base + x.path, { signal, credentials: 'same-origin' });
        if (!r.ok) throw new Error(`the starter knowledge pack: ${x.path} -> HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        if (globalThis.crypto && crypto.subtle && x.sha && await sha(buf) !== x.sha) throw new Error(`the starter knowledge pack: ${x.path} did not match its checksum`);
        await d.put('files', { path: x.path, blob: new Blob([buf], { type: 'application/gzip' }), size: buf.byteLength });
        have += x.size;
        const s = (Date.now() - t0) / 1000, bps = s > 0 ? have / s : 0;
        onProgress({ haveBytes: have, totalBytes: total, bytesPerSec: bps, etaSeconds: bps ? Math.round((total - have) / bps) : null });
      }
      kb = null;
      await eng.extras({ signal }).catch(() => {});   // v026.4: the credits, notice and licence (checked; a missing one never fails the pack)
    },
    /** v026.4: the pack's CREDITS.md, NOTICE.md and LICENSE, each checked against the manifest's sha256 and kept with the pack. A phone
     *  that installed the pack before they existed reads the server's current manifest for their hashes (its data files must match). */
    async extras({ signal = null, only = null } = {}) {
      const d = await open();
      let m = await manifestOf();
      if (!m || !m.files || !m.files['CREDITS.md']) {
        const got = await fetchManifest(base, { signal, credentials: 'same-origin', cache: 'no-cache' }, f);   // v027.3: checked against config.js
        if (!got) throw new Error('the starter knowledge pack is not reachable (check the network)');
        if (got.bad) { manifestRefused(got, !!m); throw new Error(`the starter knowledge pack: ${got.bad}`); }
        const blob = new Blob([got.ab], { type: 'application/json' }), fresh = got.m;
        const same = m && JSON.stringify(plan(m).map((x) => x.sha)) === JSON.stringify(plan(fresh).map((x) => x.sha));
        if (!m || same) { await d.put('files', { path: 'manifest.json', blob, size: blob.size }); m = fresh; }
        else m = fresh;   // a rebuilt pack: its data is not this phone's, but its credits page still describes the same articles' sources
      }
      const out = {};
      for (const name of only || ['CREDITS.md', 'NOTICE.md', 'LICENSE']) {
        const want = m.files && m.files[name]; if (!want) continue;
        const have = await d.get('files', name);
        if (have && have.sha === want.sha256) { out[name] = have.blob; continue; }
        const r = await f(base + name, { signal, credentials: 'same-origin', cache: 'no-cache' });
        if (!r.ok) throw new Error(`the starter knowledge pack: ${name} -> HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        if (!(globalThis.crypto && crypto.subtle)) throw new Error('this browser cannot check files');
        if (await sha(buf) !== want.sha256) throw new Error(`the starter knowledge pack: ${name} did not match its checksum`);
        const blob = new Blob([buf], { type: 'text/plain;charset=utf-8' });
        await d.put('files', { path: name, blob, size: buf.byteLength, sha: want.sha256 }); out[name] = blob;
      }
      return out;
    },
    /** the credits page (Settings › About › Starter pack credits): from the phone when it has it, else fetched and checked */
    async credits({ signal = null } = {}) { const o = await eng.extras({ signal, only: ['CREDITS.md'] }); if (!o['CREDITS.md']) throw new Error('this starter pack has no credits page'); return o['CREDITS.md']; },
    async deleteModel() { kb = null; await (await open()).clear('files'); },
    async requestPersistentStorage() { try { return await navigator.storage.persist(); } catch (e) { return false; } },
    cancel() {},
    /** the research seam (null until the pack is complete) */
    async source() {
      const st = await eng.status();
      if (!st.complete) return null;
      if (!kb) {
        const d = await open();
        // kbstarter.js fetches by URL: served here from IndexedDB (gzip in, inflated by the loader)
        const idbFetch = async (url) => { const p = String(url).replace(/^idb:\/\/starter\//, ''); const rec = await d.get('files', p); return rec ? new Response(rec.blob) : new Response('missing', { status: 404 }); };
        kb = await load({ base: 'idb://starter/', fetchFn: idbFetch, gzip: true, verify: true });
      }
      return { name: 'starter', readOnly: true, count: kb.count, async search(q) { return (await kb.search(q, { limit: 3 })).filter((r) => HIT.has(r.title_match)).map(toEntry); } };
    },
  };
  return eng;
}

/** a starter hit -> the Entry shape research.js reads (kb.js header): facts in the phone's closed schema, unverified marks kept */
export function toEntry(r) {
  const c = r.citation || {}, subj = norm(r.title);
  let facts = (r.facts || []).filter((x) => !x.subject || norm(x.subject).replace(/ /g, '_') === subj.replace(/ /g, '_') || norm(x.subject) === subj)
    .map((x) => Object.assign({ relation: MAP[x.relation] || x.relation, value: x.value, kind: x.kind }, x.unverified ? { unverified: true } : {}));
  if (facts.some((x) => x.relation === 'born' || x.relation === 'died')) facts = facts.filter((x) => PERSON_OK.has(x.relation));   // a person keeps person relations
  return {
    key: 'starter:' + r.entry_key, site: 'wikipedia', wiki: null, title: r.title, topics: [norm(r.title), ...(r.aliases || []).map(norm)].filter(Boolean),
    facts, summary: (r.summary || []).map((x) => x.text).join('; ').slice(0, 300), categories: [], flags: [], others: [],
    source: { site: 'wikipedia', wiki: null, siteName: 'Wikipedia', url: c.url, permalink: c.permalink, authors: c.authors, license: c.license || 'CC BY-SA 4.0',
      licenseUrl: c.licenseUrl || c.license_url || 'https://creativecommons.org/licenses/by-sa/4.0/', revid: c.revid || c.revision, revised: c.revised, retrieved: c.retrieved },
  };
}
