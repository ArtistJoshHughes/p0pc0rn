// crafting.js - the recipes (data/recipes.json: inputs with counts -> an output, both catalog ids): what a recipe needs now and the
// craft itself, which takes exactly its inputs out of the bin (and the claw) and hands back its output. Crafting happens only in a01's
// sealed shelter (at its workbench) or parked in the dock. Tier 2 needs the Matter Loom (R14); tier 3 the Loom and a tier-2 machine;
// a station's own job (the Loom's printed fuse) needs that station; the Skiagraph Pillar needs a Roentgen Furnace; the Heliostat Rail a
// free panel slot on the bin. Data-driven: a new recipe in the JSON is crafted the same way (its function is a hook in survival.js; one
// with no hook is just an owned item). Pure logic.
export function createCrafting(recipes, catalog) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const outputOf = (r) => catalog[r.output] || null;
  /** ctx: { inv, where: 'shelter'|'dock'|null, owned: { R14: n, ... }, claw: catalogId|null, slotsFree: n, room(id) -> {ok} }
   *  -> { ok, why, missing: [{ id, need, have }] } */
  function check(id, ctx) {
    const r = byId.get(id); if (!r) return { ok: false, why: 'no such recipe', missing: [] };
    const extra = ctx.claw ? { [ctx.claw]: 1 } : {}, missing = ctx.inv.missing(r.inputs, extra), owned = ctx.owned || {};
    const why = (w) => ({ ok: false, why: w, missing });
    if (!ctx.where) return why('craft in your sealed shelter or parked in the dock');
    if (r.station && !owned[r.station]) return why(`needs the ${(byId.get(r.station) || { name: r.station }).name}`);
    if (r.tier >= 2 && !owned.R14) return why('tier ' + r.tier + ': needs the Matter Loom (R14)');
    if (r.tier >= 3 && !recipes.some((q) => q.tier === 2 && !q.station && owned[q.id])) return why('tier 3: needs the Loom and a tier-2 machine');
    if (r.id === 'R07' && !owned.R06) return why('needs a Roentgen Furnace nearby');
    if (r.effect === 'rail' && !(ctx.slotsFree > 0)) return why('all 8 panel slots on the bin are full');
    if (missing.length) return why('missing ' + missing.map((m) => `${m.need - m.have} ${(catalog[m.id] || { name: m.id }).name}`).join(', '));
    if (r.place === 'bin' && ctx.room) { const rm = ctx.room(r.output); if (!rm.ok) return why(rm.why); }
    return { ok: true, why: '', missing };
  }
  /** take the inputs (the bin first, then the claw) -> { ok, why, recipe, output, took: { id: n }, panels: [taken panels], fromClaw } */
  function craft(id, ctx) {
    const c = check(id, ctx); if (!c.ok) return Object.assign({ recipe: byId.get(id) || null }, c);
    const r = byId.get(id), took = {}, panels = []; let fromClaw = false;
    for (const [inId, n] of Object.entries(r.inputs)) {
      const inBin = Math.min(n, ctx.inv.count(inId)), rest = n - inBin;
      if (inBin) { const got = ctx.inv.take(inId, inBin, r.effect === 'altar' ? 'worst' : 'best'); if (got) panels.push(...got); }
      if (rest) { if (rest !== 1 || ctx.claw !== inId) throw new Error('crafting: inputs changed under the check'); fromClaw = true; }
      took[inId] = n;
    }
    return { ok: true, why: '', recipe: r, output: r.output, took, panels, fromClaw };
  }
  return { check, craft, recipes, byId, outputOf };
}
