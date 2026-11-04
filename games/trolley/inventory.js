// inventory.js - what a01 carries: the bin's manifest (counts by catalog id, each solar panel its own instance with its age and
// quality), what the bin can still take (kilograms and litres: BIN), the shelter pieces a01 has claimed (built at the site, never in the
// bin) and which kinds it has ever collected (the first one of a kind gets the collect bubble). The claw's item is the physics' (sim.js);
// survival.js counts it in when crafting. Pure logic: the tests run it in Node.
import { BIN } from './survival_rules.js';

export function createInventory(catalog, cap = BIN) {
  const I = { counts: {}, panels: [], claims: {}, seen: new Set() };
  const item = (id) => catalog[id] || null;
  const carry = (id) => { const e = item(id); return (e && e.game && e.game.carry) || [0, 0]; };
  const isPiece = (id) => !!(item(id) && item(id).game && item(id).game.piece);   // a rack is a piece too: claimed (1.2 t), and the recipes that need one use the claim
  /** what the bin holds now: { kg, litres } */
  function load() { let kg = 0, l = 0; for (const [id, n] of Object.entries(I.counts)) { const [a, b] = carry(id); kg += a * n; l += b * n; } return { kg: +kg.toFixed(2), litres: +l.toFixed(2) }; }
  /** can the bin take n more of id? -> { ok, why } */
  function room(id, n = 1) {
    if (!item(id)) return { ok: false, why: 'unknown item' };
    if (isPiece(id)) return { ok: true };
    const L0 = load(), [a, b] = carry(id);
    if (L0.kg + a * n > cap.kg + 1e-9) return { ok: false, why: `the bin would weigh over ${cap.kg} kg` };
    if (L0.litres + b * n > cap.litres + 1e-9) return { ok: false, why: 'the bin is full' };
    return { ok: true };
  }
  /** into the bin (or the claims, for a shelter piece); panels: the instances of solar panels added -> { ok, why, first } */
  function add(id, n = 1, { panels = null, force = false } = {}) {
    if (!(n > 0)) return { ok: false, why: 'nothing to add' };
    if (!force) { const r = room(id, n); if (!r.ok) return r; }
    const first = !I.seen.has(id); I.seen.add(id);
    if (isPiece(id)) I.claims[id] = (I.claims[id] || 0) + n;
    else {
      I.counts[id] = (I.counts[id] || 0) + n;
      if (id === 'solar_panel') { const ps = panels || []; for (let k = 0; k < n; k++) I.panels.push(ps[k] || { tier: 'aged', eff: 0.55, q: 0.8, dust: 0 }); }
    }
    return { ok: true, first };
  }
  const count = (id) => (isPiece(id) ? I.claims[id] || 0 : I.counts[id] || 0);
  /** out of the bin (or the claims): solar panels the best first ('best') or the worst first ('worst') -> the taken panels, or null */
  function take(id, n = 1, pick = 'best') {
    if (count(id) < n) return null;
    if (isPiece(id)) { I.claims[id] -= n; if (!I.claims[id]) delete I.claims[id]; return []; }
    I.counts[id] -= n; if (!I.counts[id]) delete I.counts[id];
    if (id !== 'solar_panel') return [];
    const score = (p) => p.eff * p.q * (1 - 0.5 * (p.dust || 0));
    I.panels.sort((a, b) => (pick === 'best' ? score(b) - score(a) : score(a) - score(b)));
    return I.panels.splice(0, n);
  }
  /** what is missing for these inputs ({ id: n }), with `extra` counted in (the claw's item) -> [{ id, need, have }] */
  function missing(inputs, extra = {}) {
    const out = [];
    for (const [id, n] of Object.entries(inputs)) { const have = count(id) + (extra[id] || 0); if (have < n) out.push({ id, need: n, have }); }
    return out;
  }
  const serialize = () => ({ counts: Object.assign({}, I.counts), panels: I.panels.map((p) => Object.assign({}, p)), claims: Object.assign({}, I.claims), seen: [...I.seen] });
  function restore(o) {
    I.counts = {}; I.panels = []; I.claims = {}; I.seen = new Set();
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o.counts || {})) if (item(k) && Number.isInteger(v) && v > 0) I.counts[k] = v;
    for (const [k, v] of Object.entries(o.claims || {})) if (item(k) && Number.isInteger(v) && v > 0) I.claims[k] = v;
    for (const p of Array.isArray(o.panels) ? o.panels : []) if (p && ['new', 'aged', 'ruined'].includes(p.tier) && Number.isFinite(p.eff) && Number.isFinite(p.q)) I.panels.push({ tier: p.tier, eff: p.eff, q: p.q, dust: Number.isFinite(p.dust) ? p.dust : 0 });
    if (I.counts.solar_panel !== I.panels.length) { if (I.panels.length) I.counts.solar_panel = I.panels.length; else delete I.counts.solar_panel; }
    for (const s of Array.isArray(o.seen) ? o.seen : []) if (item(s)) I.seen.add(s);
  }
  const clear = () => restore(null);
  return { add, take, count, room, load, missing, serialize, restore, clear, isPiece, carry, get counts() { return Object.assign({}, I.counts); }, get claims() { return Object.assign({}, I.claims); },
    get panels() { return I.panels; }, get seen() { return I.seen; }, cap };
}
