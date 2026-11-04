// progress.js - what a01 keeps between runs: its ROMs (the robots' currency: one ROM, two ROMs), the battery tier it has bought, and
// the best time up the stairs. Kept in localStorage under one key; every read and write is wrapped (a private window or blocked
// storage just means nothing is remembered). Pure logic plus a storage adapter, so the tests run it in Node.
import { TIERS } from './power.js';

export const KEY = 'p0pc0rn:trolley:progress';
export const romWord = (n) => (n === 1 ? 'ROM' : 'ROMs');

const memoryStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const safeStore = (s) => s || (() => { try { return globalThis.localStorage || memoryStore(); } catch (e) { return memoryStore(); } })();

export function createProgress(store) {
  const S = safeStore(store);
  const P = { v: 1, roms: 0, tier: 0, best: null, earned: 0, banked: 0 };
  try {
    const raw = S.getItem(KEY), o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') {
      if (Number.isFinite(o.roms) && o.roms >= 0) P.roms = Math.floor(o.roms);
      if (Number.isInteger(o.tier) && o.tier >= 0 && o.tier < TIERS.length) P.tier = o.tier;
      if (Number.isFinite(o.best) && o.best > 0) P.best = o.best;
      if (Number.isFinite(o.earned) && o.earned >= 0) P.earned = Math.floor(o.earned);
      if (Number.isFinite(o.banked) && o.banked >= 0) P.banked = Math.floor(o.banked);
    }
  } catch (e) { /* unreadable: start fresh */ }
  function save() { try { S.setItem(KEY, JSON.stringify(P)); return true; } catch (e) { return false; } }
  /** trash came to rest in the bin: add its ROMs */
  function earn(n, why = 'trash') { n = Math.max(0, Math.floor(n)); P.roms += n; P.earned += n; if (why === 'trash') P.banked++; save(); return P.roms; }
  /** the next battery tier: { ok, why, tier } */
  function nextTier() { return P.tier + 1 < TIERS.length ? TIERS[P.tier + 1] : null; }
  function buyTier(i) {
    if (i !== P.tier + 1 || !TIERS[i]) return { ok: false, why: i <= P.tier ? 'owned' : 'buy the tier before it first' };
    if (P.roms < TIERS[i].cost) return { ok: false, why: `needs ${TIERS[i].cost} ${romWord(TIERS[i].cost)}` };
    P.roms -= TIERS[i].cost; P.tier = i; save(); return { ok: true, tier: i };
  }
  function finish(seconds) { if (Number.isFinite(seconds) && seconds > 0 && (P.best == null || seconds < P.best)) { P.best = seconds; save(); return true; } return false; }
  return { get roms() { return P.roms; }, get tier() { return P.tier; }, get best() { return P.best; }, get data() { return Object.assign({}, P); }, earn, buyTier, nextTier, finish, save };
}
