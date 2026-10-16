// store.js - the Library in IndexedDB 'pocketflux-app' (the name never changes: Josh's saved pictures live there).
//   meta   {id, createdAt, media ('image' | 'video'; missing = an image saved by v012 or older), kind, prompt, seed, width, height,
//           seconds, steps?, reference?, frames?, fps?, thumb (small JPEG Blob: the picture, or a clip's poster frame)}
//   blobs  {id, blob}   full PNG or MP4, read only when the viewer opens it
//   inputs {id, blob}   the photo of the edit being made, so a killed job can be resumed
//          {id: 'video', items: [{from, libId, blob, thumb}]}  (v018) the pictures of the picture clip being made: a killed clip can be
//          retried, and a resumed one still knows its source thumbnails. No schema change (same 'inputs' store).
//   v018 clip meta adds  vmode ('t2v' | 'i2v' | 'flf'; missing = 't2v') and sources [{from: 'library' | 'phone', libId, thumb}].
//   v019 adds  media 'audio' (a song: title, tags, lyrics, bpm, key?, timeSignature?, duration, lm, codec; thumb = its cover; blob = .m4a AAC,
//           or .wav where the browser can't encode AAC), clip vmode 'mv' (a music video: an MP4 WITH the song; duration) and by: 'assistant'.
// Schema v2 (p0pc0rn v013) upgrades v1 IN PLACE: it only adds the 'createdAt' and 'media' indexes to meta; no record is rewritten.
// Never stores object URLs (they die with the page). Every write resolves on tx.oncomplete and rejects on error/abort.
// If IndexedDB cannot open (private mode, blocked), it falls back to memory and `available` turns false.
const NAME = 'pocketflux-app', VERSION = 2;
let db = null, mem = null, opening = null;
export let available = true;
export let blocked = false;   // an older p0pc0rn tab kept the v1 database open, so the upgrade could not run

export function open() {
  if (db || mem) return Promise.resolve();
  if (!opening) opening = connect().finally(() => { opening = null; });
  return opening;
}
async function connect() {
  try {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VERSION);
      let t = 0;
      r.onupgradeneeded = (ev) => {
        const d = r.result, old = ev.oldVersion;
        if (old < 1) for (const s of ['meta', 'blobs', 'inputs']) d.createObjectStore(s, { keyPath: 'id' });
        const meta = r.transaction.objectStore('meta');
        for (const ix of ['createdAt', 'media']) if (!meta.indexNames.contains(ix)) meta.createIndex(ix, ix);
      };
      r.onsuccess = () => { clearTimeout(t); res(r.result); };
      r.onerror = () => { clearTimeout(t); rej(r.error); };
      // another tab still holds v1: wait a little for it to let go (v013+ tabs close on versionchange), then give up
      r.onblocked = () => { blocked = true; t = setTimeout(() => rej(new Error('IndexedDB blocked by another tab')), 6000); };
    });
    blocked = false;
    db.onversionchange = () => { db.close(); db = null; };   // a newer p0pc0rn wants to upgrade: never block it
  } catch (e) {
    available = false; mem = { meta: new Map(), blobs: new Map(), inputs: new Map() };
  }
}

// Run fn(tx, box) in one transaction; resolve with box.v once the transaction has committed.
function run(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode), box = {};
    t.oncomplete = () => res(box.v);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new DOMException('Transaction aborted', 'AbortError'));
    fn(t, box);
  });
}
const newest = (a, b) => b.createdAt - a.createdAt;

/** all metadata (with thumbs), newest first */
export async function list() {
  await open();
  if (mem) return [...mem.meta.values()].sort(newest);
  return run(['meta'], 'readonly', (t, box) => { const r = t.objectStore('meta').getAll(); r.onsuccess = () => { box.v = r.result.sort(newest); }; });
}
/** the full-size Blob of one picture or clip (or the stored edit input when store = 'inputs') */
export async function getBlob(id, store = 'blobs') {
  await open();
  if (mem) return (mem[store].get(id) || {}).blob || null;
  return run([store], 'readonly', (t, box) => { const r = t.objectStore(store).get(id); r.onsuccess = () => { box.v = r.result ? r.result.blob : null; }; });
}
export async function add(meta, blob) {
  await open();
  if (mem) { mem.meta.set(meta.id, meta); mem.blobs.set(meta.id, { id: meta.id, blob }); return; }
  return run(['meta', 'blobs'], 'readwrite', (t) => { t.objectStore('meta').put(meta); t.objectStore('blobs').put({ id: meta.id, blob }); });
}
/** removes meta + blob in one transaction */
export async function remove(id) {
  await open();
  if (mem) { mem.meta.delete(id); mem.blobs.delete(id); return; }
  return run(['meta', 'blobs'], 'readwrite', (t) => { t.objectStore('meta').delete(id); t.objectStore('blobs').delete(id); });
}
/** the last edit's input photo (one slot) */
export async function putInput(blob) {
  await open();
  if (mem) { mem.inputs.set('last', { id: 'last', blob }); return; }
  return run(['inputs'], 'readwrite', (t) => { t.objectStore('inputs').put({ id: 'last', blob }); });
}
export async function clearInput() {
  await open();
  if (mem) { mem.inputs.delete('last'); return; }
  return run(['inputs'], 'readwrite', (t) => { t.objectStore('inputs').delete('last'); });
}
/** bytes the Library holds (full files + thumbnails), for the Settings storage inspector. Blob sizes only, no reads. */
export async function usage() {
  const meta = await list();
  let bytes = 0;
  for (const m of meta) bytes += (m.thumb && m.thumb.size) || 0;
  if (mem) for (const v of mem.blobs.values()) bytes += (v.blob && v.blob.size) || 0;
  else bytes += await run(['blobs'], 'readonly', (t, box) => {
    box.v = 0; const r = t.objectStore('blobs').openCursor();
    r.onsuccess = () => { const c = r.result; if (!c) return; box.v += (c.value.blob && c.value.blob.size) || 0; c.continue(); };
  });
  return { bytes, pictures: meta.filter((m) => m.media !== 'video' && m.media !== 'audio').length, clips: meta.filter((m) => m.media === 'video').length, songs: meta.filter((m) => m.media === 'audio').length };
}

/** (v018) the source pictures of the picture clip being made (one slot, replaced by every new picture clip) */
export async function putVideoInputs(items) {
  await open();
  const rec = { id: 'video', items };
  if (mem) { mem.inputs.set('video', rec); return; }
  return run(['inputs'], 'readwrite', (t) => { t.objectStore('inputs').put(rec); });
}
export async function getVideoInputs() {
  await open();
  if (mem) return (mem.inputs.get('video') || {}).items || null;
  return run(['inputs'], 'readonly', (t, box) => { const r = t.objectStore('inputs').get('video'); r.onsuccess = () => { box.v = r.result ? r.result.items : null; }; });
}
export async function clearVideoInputs() {
  await open();
  if (mem) { mem.inputs.delete('video'); return; }
  return run(['inputs'], 'readwrite', (t) => { t.objectStore('inputs').delete('video'); });
}
