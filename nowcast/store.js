// nowcast/store.js - the last few nowcasts, on this phone only (IndexedDB 'p0pc0rn-nowcast'), so the view and Juli's card can show a run
// again after a reload. A run is a few MB (the ensemble's mean and chances); the 3 newest are kept.
import { openDB } from '../assistant/idb.js';

const KEEP = 3;
let dbP = null;
const db = () => dbP || (dbP = openDB('p0pc0rn-nowcast', 1, { runs: { keyPath: 'id' } }));
const mem = new Map();
export async function saveRun(r) {
  mem.set(r.id, r); while (mem.size > 2) mem.delete(mem.keys().next().value);
  try {
    const d = await db(); await d.put('runs', r);
    const all = (await d.all('runs')).sort((a, b) => b.made - a.made);
    for (const x of all.slice(KEEP)) await d.del('runs', x.id);
  } catch (e) { /* storage full or private: this page keeps it */ }
}
export async function getRun(id) {
  if (mem.has(id)) return mem.get(id);
  try { const r = await (await db()).get('runs', id); if (r) mem.set(id, r); return r || null; } catch (e) { return null; }
}
/** the newest run that covers a point and is still current (its radar at most maxAgeMin old) */
export async function recentRun(lat, lon, { maxAgeMin = 25, now = Date.now(), covers } = {}) {
  let all = [...mem.values()];
  try { all = all.concat(await (await db()).all('runs')); } catch (e) { /* */ }
  all.sort((a, b) => b.made - a.made);
  return all.find((r) => now - r.t0 <= maxAgeMin * 60e3 && (!covers || covers(r, lat, lon))) || null;
}
