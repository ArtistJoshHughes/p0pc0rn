// save.js - the open world's save game (not a save state: nothing of the physics is kept, the world is rebuilt from it). One
// localStorage key, a versioned schema; every read and write is wrapped (a private window or blocked storage just means nothing is
// remembered and the game runs on). It holds the day and the time, the bin's manifest (and the claimed shelter pieces), the panels on
// the bin, what a01 has crafted and fitted, the shelter (its concept, site and the pieces built), the world (the salvage sites stripped
// and when, the loose supplies, the leech husks) and the battery. Death clears it (survival.js). Pure logic.
export const SAVE_KEY = 'p0pc0rn:trolley:save';
export const SAVE_V = 1;

const memoryStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const safeStore = (s) => s || (() => { try { return globalThis.localStorage || memoryStore(); } catch (e) { return memoryStore(); } })();
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

/** a save, cleaned: unknown fields dropped, every number finite (or its default) -> the save, or null if it is not one */
export function clean(o) {
  if (!o || typeof o !== 'object' || o.kind !== 'trolley-survival' || o.v !== SAVE_V) return null;
  const sh = o.shelter && typeof o.shelter === 'object' ? o.shelter : null;
  return {
    v: SAVE_V, kind: 'trolley-survival', saved: typeof o.saved === 'string' ? o.saved.slice(0, 40) : '', seed: Math.floor(num(o.seed, 1)) || 1,
    time: Math.max(0, num(o.time)), tutorialDone: !!o.tutorialDone, deaths: Math.max(0, Math.floor(num(o.deaths))),
    inv: obj(o.inv), mounted: arr(o.mounted).slice(0, 10).map((p) => (p && typeof p === 'object' ? p : null)),
    owned: obj(o.owned), charges: obj(o.charges),
    shelter: sh && typeof sh.concept === 'string' && sh.site && [sh.site.x, sh.site.z, sh.site.yaw].every(Number.isFinite)
      ? { concept: sh.concept, site: { x: sh.site.x, z: sh.site.z, yaw: sh.site.yaw }, built: arr(sh.built).filter((k) => typeof k === 'string' && /^\d+:\d+$/.test(k)).slice(0, 80) } : null,
    stations: arr(o.stations).filter((s) => typeof s === 'string').slice(0, 40),
    world: { stripped: obj(o.world && o.world.stripped), loose: arr(o.world && o.world.loose).filter((l) => Array.isArray(l) && typeof l[0] === 'string' && Number.isFinite(l[1]) && Number.isFinite(l[2])).slice(0, 80),
      husks: arr(o.world && o.world.husks).filter((h) => Array.isArray(h) && Number.isFinite(h[0]) && Number.isFinite(h[1])).slice(0, 20),
      buried: arr(o.world && o.world.buried).filter((h) => Array.isArray(h) && typeof h[0] === 'string').slice(0, 30), restocked: Math.floor(num(o.world && o.world.restocked)) },
    battery: Math.max(0, Math.min(1, num(o.battery, 1))), at: o.at === 'dock' ? 'dock' : 'shelter',
  };
}

export function createSaves(store) {
  const S = safeStore(store);
  /** the save, or null (none, unreadable or another schema) */
  function load() { try { const raw = S.getItem(SAVE_KEY); return raw ? clean(JSON.parse(raw)) : null; } catch (e) { return null; } }
  function save(o) { const c = clean(Object.assign({}, o, { v: SAVE_V, kind: 'trolley-survival', saved: new Date().toISOString() })); if (!c) return false; try { S.setItem(SAVE_KEY, JSON.stringify(c)); return true; } catch (e) { return false; } }
  function clear() { try { if (S.removeItem) S.removeItem(SAVE_KEY); else S.setItem(SAVE_KEY, ''); return true; } catch (e) { return false; } }
  const has = () => !!load();
  return { load, save, clear, has, KEY: SAVE_KEY };
}
