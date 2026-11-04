// survival.js - the open world after the tutorial (v5): no win, only the next night. It runs next to the physics (sim.js) in the page
// and in the tests: the day and the night, the supplies and the salvage, the bin's manifest, crafting and what each crafted thing does,
// the shelter built piece by piece, the solar panels on the bin, the energy leeches, the shelter's charger, death and the save game.
//
// Everything here is real bodies: a loose supply is a dynamic body (sim.spawnItem) the claw grabs into the bin, where it is stowed in
// the manifest once it rests there (its body goes: the bin's contents are counted, and they weigh on the trolley: sim.setBinLoad); a
// salvage site is a fixed body a01 strips in place with the arm (sim.armWork: real servo work; the parts go into the bin); a shelter
// piece is a fixed body placed by the arm at its slot; a leech is a kinematic body moved by Rapier's character controller (it slides
// along walls and never passes through them; it meets only the world's fixed things).
//
// step(input) = this module's pre-step (the leeches' moves, the gates) + sim.step + its after-step (the clock, the stowing, the power,
// the leeches' latching and draining, the shelter, death, the autosave). Its own events (take()) tell the page what happened.
import { clockAt, DAY, sunYaw, SOLAR, LEECH, BIN, ARM, SHELTER_CHARGE, AUTOSAVE, BATTERY, rollPanel, solarWatts, ageDay, restoreTier, panelFactor } from './survival_rules.js';
import { createInventory } from './inventory.js';
import { createCrafting } from './crafting.js';
import { createShelters, hit } from './shelter.js';
import { createSaves } from './save.js';
import { COLLIDE, G, groups } from './trolley_spec.js';
import { DOCK_BAY, START, ROOM, DOORS, RAMP, TRASH_SPAWNS } from './level_spec.js';
import { SLICKS, inWorld, inHall, areaAt, quadAt, WORLD_OBJECTIVES, PROPS, PROP_KINDS, DRUMS_STATIC } from './world_spec.js';
import { fixedFootprints, pathCheck } from './paths.js';
import { limpLine, limpCheck } from './power.js';

const DEG = Math.PI / 180;
export const TRASH_ID = { soda: 'soda_can', tin: 'tin_can', water: 'water_bottle', beer: 'beer_bottle', carton: 'juice_carton', chips: 'chips_bag', diesel: 'diesel_can' };
const G_LEECH = 256, LEECH_GROUPS = groups(G_LEECH, G.WORLD);
const mulberry = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const qy = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const QUAD_AREAS = { dock: ['hall', 'yard'], park: ['park'], metro: ['metro'], forest: ['forest'] };

export function createSurvival({ sim, data, store = null, seed = 1 }) {
  const R = sim.R, world = sim.world, V2 = sim.v2, cat = data.catalog.items;
  const inv = createInventory(cat, BIN), crafting = createCrafting(data.recipes.recipes, cat), shelters = createShelters(data.shelters, cat), saves = createSaves(store);
  const S = { active: false, time: DAY.start * DAY.length, seed, rnd: mulberry(seed), owned: {}, stations: [], mounted: new Array(SOLAR.slots).fill(null), charges: {}, shelter: null,
    sites: [], leeches: [], vigils: [], husks: [], buried: [], events: [], dead: false, timeScale: 1, waiting: false, stats: {}, lastSave: -1e9, overdrive: 0, cooled: 0,
    deaths: 0, lastCraft: null, collarNight: -1, revealUntil: 0, nightOf: 0, dayOf: 0, daySpawned: 0, armed: false, warned: -1, padT: 0, startedAt: 0, restocked: 0 };
  const ev = (e) => { S.events.push(e); };

  // ---------------------------------------------------------------------------------------------- the supplies' kinds (sim.addKinds)
  const SUPPLY = {};
  for (const [id, e] of Object.entries(cat)) {
    const g = e.game || {}; if (!g.grab || g.trash) continue;
    SUPPLY[id] = { name: e.name, glb: id, size: g.size, shape: g.shape || 'box', mass: g.mass, friction: 0.6, restitution: 0.05, roms: 0, ringable: g.grab === 'stock', grip: g.grip, supply: id, grab: g.grab };
  }
  sim.addKinds(SUPPLY);
  const idOfKind = (kind) => TRASH_ID[kind] || (SUPPLY[kind] ? kind : null);
  const kindOfId = (id) => Object.keys(TRASH_ID).find((k) => TRASH_ID[k] === id) || (SUPPLY[id] ? id : null);
  // the claw's item (it counts as carried) and whether the bin may take what the claw is about to drop in
  sim.canStow = (it) => { if (!S.active) return { ok: true }; const id = idOfKind(it.kind); return id ? inv.room(id, 1) : { ok: true }; };

  // ---------------------------------------------------------------------------------------------- fixed bodies this module adds
  function addFixed(cols, tag) {   // cols: [{ c: [x, y, z], h: [hx, hy, hz], yaw }] -> { body, cols }
    const body = world.createRigidBody(R.RigidBodyDesc.fixed()), out = [];
    for (const c of cols) out.push(world.createCollider(R.ColliderDesc.cuboid(Math.max(0.005, c.h[0]), Math.max(0.005, c.h[1]), Math.max(0.005, c.h[2])).setTranslation(c.c[0], c.c[1], c.c[2]).setRotation(qy(c.yaw || 0))
      .setFriction(0.5).setRestitution(0.02).setCollisionGroups(COLLIDE.world).setSolverGroups(COLLIDE.world).setContactSkin(0.003), body));
    return { body, cols: out, tag };
  }
  const drop = (o) => { if (o && o.body && world.getRigidBody(o.body.handle)) world.removeRigidBody(o.body); };
  /** what dynamic bodies stand inside these boxes (never place a fixed thing over a body: the solver would throw it out) */
  function blockers(cols) {
    const out = [];
    for (const c of cols) {
      const shape = new R.Cuboid(c.h[0] + 0.02, c.h[1] + 0.02, c.h[2] + 0.02);
      world.intersectionsWithShape({ x: c.c[0], y: c.c[1], z: c.c[2] }, qy(c.yaw || 0), shape, (o) => { const b = o.parent(); if (b && (b.isDynamic() || b.isKinematic()) && !S.leeches.some((l) => l.body === b)) out.push(b); return true; });
    }
    return out;
  }
  const whoIs = (b) => { if (sim.parts.some((p) => p.body === b) || V2.arm.parts.some((p) => p.body === b)) return 'a01'; const it = V2.items.find((i) => i.body === b); return it ? (it.spec.name || it.kind).toLowerCase() : 'something'; };

  // ---------------------------------------------------------------------------------------------- salvage sites
  const siteCol = (s) => {   // a site's collider in the world (its item's own box, turned by the site's yaw)
    if (s.kind === 'prop' || s.kind === 'drum' || s.noCollider) return [];
    const e = cat[s.item], col = s.item === 'leech_husk' ? { c: [-0.3, 0.07, 0], h: [0.65, 0.07, 0.12] } : e && e.game.collider; if (!col) return [];
    const phi = s.yawDeg * DEG, ox = col.c[0] * Math.cos(phi) + col.c[2] * Math.sin(phi), oz = -col.c[0] * Math.sin(phi) + col.c[2] * Math.cos(phi);
    return [{ c: [s.x + ox, col.c[1], s.z + oz], h: col.h.slice(), yaw: phi }];
  };
  function buildSites(stripped = {}) {
    for (const s of S.sites) drop(s.fixed);
    S.sites = [];
    for (const s of data.sites.sites) S.sites.push(Object.assign({ kind: 'spot' }, s));
    for (const s of data.sites.props) S.sites.push(Object.assign({ kind: s.drum != null ? 'drum' : 'prop' }, s));
    for (const s of S.sites) { s.stripped = Number.isFinite(stripped[s.id]) ? stripped[s.id] : null; s.fixed = null; if (s.stripped == null) placeSite(s); }
  }
  function placeSite(s) {
    const cols = siteCol(s); if (!cols.length) { s.fixed = null; return true; }
    if (blockers(cols).length) return false;   // something lies there now: it comes back later
    if (S.shelter && shelterBoxes().some((b) => hit(b, { x: cols[0].c[0], z: cols[0].c[2], hx: cols[0].h[0], hz: cols[0].h[2], yaw: cols[0].yaw }, 0.2))) return false;
    s.fixed = addFixed(cols, 'site'); return true;
  }
  const siteAvailable = (s) => s.stripped == null && (s.kind !== 'spot' || s.fixed || s.noCollider);
  /** the salvage within the arm's reach: in front of a01, its nearest point within 1.25 m of the arm's base */
  function salvageTarget(only = null) {
    if (!S.active) return null;
    const ch = sim.trolley.chassis.body, p = ch.translation(), yaw = a01().yaw;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), bx = p.x + fx * 0.54, bz = p.z + fz * 0.54;
    let best = null;
    for (const s of only ? [only] : S.sites.concat(S.husks)) {
      if (!siteAvailable(s)) continue;
      const box = siteBox(s), dx = Math.max(0, Math.abs((bx - box.x) * Math.cos(box.yaw) - (bz - box.z) * Math.sin(box.yaw)) - box.hx), dz = Math.max(0, Math.abs((bx - box.x) * Math.sin(box.yaw) + (bz - box.z) * Math.cos(box.yaw)) - box.hz);
      const d = Math.hypot(dx, dz), along = (box.x - p.x) * fx + (box.z - p.z) * fz;
      if (d < 1.25 && along > -0.2 && (!best || d < best.d)) best = { s, d };
    }
    return best ? best.s : null;
  }
  function siteBox(s) {
    if (s.kind === 'prop') { const [k, x, z, yaw] = PROPS[s.prop], h = PROP_KINDS[k].h; return { x, z, hx: h[0], hz: h[2], yaw: yaw * DEG }; }
    if (s.kind === 'drum') { const [x, z] = DRUMS_STATIC[s.drum]; return { x, z, hx: 0.32, hz: 0.32, yaw: 0 }; }
    const c = siteCol(s)[0]; return c ? { x: c.c[0], z: c.c[2], hx: c.h[0], hz: c.h[2], yaw: c.yaw } : { x: s.x, z: s.z, hx: 0.4, hz: 0.6, yaw: s.yawDeg * DEG };
  }
  /** SALVAGE: the arm strips the site in front of a01 -> { ok, why, site } */
  function salvage(only = null) {
    if (!S.active) return { ok: false, why: 'salvage comes after the tutorial' };
    const s = salvageTarget(only); if (!s) return { ok: false, why: 'nothing to salvage in reach' };
    const piece = inv.isPiece(s.item);
    if (!piece && !sim.binOnDeck()) return { ok: false, why: 'the bin is off: the parts go into the bin' };
    const room = piece ? { ok: true } : inv.room(s.item, s.yield || 1); if (!room.ok) return { ok: false, why: room.why };
    const b = siteBox(s), size = (cat[s.item] && cat[s.item].game.carry ? cat[s.item].game.carry[0] : 10);
    const r = sim.armWork([b.x, 0.3, b.z], Math.min(6, 2 + size / 8 + (s.yield || 1) * 0.25), 'salvage:' + s.id);
    if (!r.ok) return r;
    S.working = { kind: 'salvage', site: s }; return { ok: true, site: s };
  }
  function finishSalvage(s) {
    const n = s.yield || 1, panels = s.item === 'solar_panel' ? Array.from({ length: n }, () => rollPanel(S.rnd)) : null;
    const r = inv.add(s.item, n, { panels, force: true }); s.stripped = clock().day;
    if (s.fixed) { drop(s.fixed); s.fixed = null; }
    if (s.kind === 'husk') S.husks = S.husks.filter((h) => h !== s);
    ev({ type: 'collect', id: s.item, n, first: r.first, how: 'salvage', site: s.id });
    for (const [b, k] of Object.entries(s.bonus || {})) { const room = inv.room(b, k); if (room.ok) { const rb = inv.add(b, k); ev({ type: 'collect', id: b, n: k, first: rb.first, how: 'salvage', site: s.id }); } }
    refreshLoad(); ev({ type: 'salvaged', id: s.item, site: s.id });
  }

  // ---------------------------------------------------------------------------------------------- loose supplies
  const RARITY = { common: 6, uncommon: 3, rare: 1 };
  function supplyPool(area) {   // what may lie loose in this area (by the catalog's quadrants), weighted
    const q = area === 'hall' || area === 'yard' ? 'dock' : area, out = [];
    for (const [id, e] of Object.entries(cat)) {
      const g = e.game || {}; if (!g.grab) continue;
      if (!(e.found || []).some((f) => f === q)) continue;
      let w = RARITY[e.rarity] || 1; if (id === 'diesel_can') w *= 2.5; if (g.grab === 'r01') w *= 0.5;
      out.push([kindOfId(id), w]);
    }
    return out;
  }
  const pick = (pool) => { let t = pool.reduce((a, p) => a + p[1], 0) * S.rnd(); for (const [k, w] of pool) { t -= w; if (t <= 0) return k; } return pool.length ? pool[pool.length - 1][0] : null; };
  const looseCount = () => V2.items.filter((i) => i.state === 'floor' && !i.banked).length;
  function spawnSupply(kind, x, z, yawDeg = 0) {
    if (!sim.kinds[kind] || !inWorld(x, z, 0.3) || blockedAt(x, z)) return null;
    const k = sim.kinds[kind], cols = [{ c: [x, k.size[1] / 2 + 0.003, z], h: [k.size[0] / 2, k.size[1] / 2, k.size[2] / 2], yaw: yawDeg * DEG }];
    if (blockers(cols).length) return null;
    return sim.spawnItem(kind, x, z, yawDeg);
  }
  /** fill the world back up to `target` loose things (at dawn and at the start), never within 3 m of a01 */
  function scatter(target = 22) {
    const a = a01(); let n = looseCount(), tries = 0;
    const pts = data.sites.spawns.slice();
    while (n < target && tries++ < 200) {
      const [x, z, area] = pts[Math.floor(S.rnd() * pts.length)]; if (Math.hypot(x - a.x, z - a.z) < 3) continue;
      if (V2.items.some((it) => { const t = it.body.translation(); return Math.hypot(t.x - x, t.z - z) < 0.8; })) continue;
      const kind = pick(supplyPool(area)); if (!kind) continue;
      if (spawnSupply(kind, x + (S.rnd() - 0.5) * 0.3, z + (S.rnd() - 0.5) * 0.3, Math.round(S.rnd() * 180))) n++;
    }
  }
  /** a point a new thing must not appear on: inside the shelter, under a site */
  function blockedAt(x, z) {
    const p = { x, z, hx: 0.15, hz: 0.15, yaw: 0 };
    if (S.shelter && (shelterBoxes().some((b) => hit(b, p, 0.25)) || shelters.inside(S.shelter.concept, S.shelter.site, x, z, -0.3))) return true;
    for (const s of S.sites) if (s.fixed && hit(siteBox(s), p, 0.25)) return true;
    for (const v of S.vigils) if (Math.hypot(v.x - x, v.z - z) < 0.5) return true;
    return false;
  }
  /** buried supplies (forest mud): revealed by the Echo Psalter (10 m round a01) or a Skiagraph Pillar pulse (15 m) */
  function reveal(radius) {
    const a = a01(); let n = 0;
    S.buried = S.buried.filter(([kind, x, z]) => { if (Math.hypot(x - a.x, z - a.z) > radius) return true; const it = spawnSupply(kind, x, z, Math.round(S.rnd() * 180)); if (it) { n++; ev({ type: 'revealed', kind, x, z }); return false; } return true; });
    return n;
  }

  // ---------------------------------------------------------------------------------------------- the shelter
  function shelterBoxes() { return S.shelter ? shelters.footprints(S.shelter.concept, S.shelter.site) : []; }
  const sealed = () => !!(S.shelter && shelters.progress(S.shelter.concept, S.shelter.built).sealed);
  /** the things a shelter must keep clear of: the fixed world, the salvage sites, the dock and its approach, the doorways, the ramp */
  function keepOut() {
    const K = [{ x: DOCK_BAY.park.x, z: -3.6, hx: 1.3, hz: 2.6, yaw: 0, why: 'it would block the dock' }, { x: 2.7, z: 6.1, hx: 1.2, hz: 1.4, yaw: 0, why: 'it would block the south door' },
      { x: 8.1, z: 1.0, hx: 1.4, hz: 1.2, yaw: 0, why: 'it would block the east door' }, { x: -7.1, z: -4.6, hx: 1.2, hz: 1.6, yaw: 0, why: 'it would block the stairs' }];
    for (const s of S.sites) if (s.fixed) K.push(Object.assign(siteBox(s), { why: 'a salvage site is in the way' }));
    if (sim.ramp) { const t = sim.ramp.body.translation(), q = sim.ramp.body.rotation(), yaw = 2 * Math.atan2(q.y, q.w), c = Math.cos(yaw), sn = Math.sin(yaw), h = sim.ramp.len / 2;
      K.push({ x: t.x + c * h, z: t.z - sn * h, hx: h + 0.3, hz: sim.ramp.width / 2 + 0.3, yaw, why: 'the ramp is in the way' }); }
    for (const d of V2.dressing) { const t = d.body.translation(); K.push({ x: t.x, z: t.z, hx: 0.5, hz: 0.5, yaw: 0, why: 'a drum is in the way' }); }
    return K;
  }
  /** where a shelter of this concept would stand with a01 at its middle, its gate the way a01 faces (snapped to 90 deg) */
  function siteHere(concept) { const a = a01(), yaw = Math.round(a.yaw / (Math.PI / 2)) * (Math.PI / 2); const off = (shelters.kits[concept].pad || { u: 0, v: 0 }); void off; return { x: +a.x.toFixed(2), z: +a.z.toFixed(2), yaw: wrap(yaw) }; }
  /** can it stand there? the fit, then every quadrant, the dock and both doors still reachable from its gate */
  function checkSite(concept, site) {
    const c = shelters.check(concept, site, { fixed: fixedFootprints(true), keep: keepOut(), inWorld });
    if (!c.ok) return c;
    const g = shelters.geometry(concept, site), objs = WORLD_OBJECTIVES.concat([{ name: 'dock', x: DOCK_BAY.park.x, z: -3.4 }, { name: 'south door', x: 2.7, z: 5.2 }, { name: 'east door', x: 7.2, z: 1.0 }]);
    const pc = pathCheck({ from: g.approach, objectives: objs, footprints: fixedFootprints(true), extra: shelters.footprints(concept, site) });
    if (!pc.ok) return { ok: false, why: `it would cut off the ${pc.lost[0]}` };
    return { ok: true, why: '' };
  }
  /** suggest sites for a concept: a scan of the floor (0.5 m, four headings), the valid ones nearest a01 first */
  function suggest(concept, max = 3) {
    const a = a01(), out = [], fixed = fixedFootprints(true), keep = keepOut();
    const pts = []; for (let x = -7.5; x < 23.5; x += 0.5) for (let z = -5.5; z < 18.5; z += 0.5) if (!inHall(x, z)) pts.push([x, z]);
    for (let x = -7.8; x < 7.9; x += 0.2) for (let z = -5.8; z < 5.9; z += 0.2) pts.push([x, z]);   // finer in the hall, where the room is
    for (const [x, z] of pts) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const site = { x, z, yaw }; if (!shelters.check(concept, site, { fixed, keep, inWorld }).ok) continue;
      out.push({ site, d: Math.hypot(x - a.x, z - a.z) });
    }
    out.sort((p, q) => p.d - q.d);
    const res = []; for (const o of out) { if (res.length >= max) break; if (res.some((r) => Math.hypot(r.site.x - o.site.x, r.site.z - o.site.z) < 1.5)) continue; if (checkSite(concept, o.site).ok) res.push(o); }
    return res;
  }
  /** mark the shelter's site where a01 stands -> { ok, why } */
  function markSite(concept, site = null) {
    if (!S.active) return { ok: false, why: 'the shelter comes after the tutorial' };
    if (S.shelter && S.shelter.built.size) return { ok: false, why: 'a01 has a shelter already' };
    if (!shelters.kits[concept]) return { ok: false, why: 'no such shelter' };
    site = site || siteHere(concept);
    const c = checkSite(concept, site); if (!c.ok) return c;
    if (S.shelter) clearShelter();
    S.shelter = { concept, site, built: new Set(), bodies: new Map(), doors: new Map(), gate: { open: 0, target: 0 } };
    ev({ type: 'site', concept, site }); return { ok: true };
  }
  function clearShelter() { if (!S.shelter) return; for (const b of S.shelter.bodies.values()) drop(b); for (const d of S.shelter.doors.values()) drop(d.fixed); for (const st of S.placed || []) drop(st.fixed); S.placed = []; S.shelter = null; }
  /** BUILD: the next piece -> { ok, why, piece } (the arm places it: done on 'workDone') */
  function buildNext() {
    if (!S.shelter) return { ok: false, why: 'mark a site first' };
    const pr = shelters.progress(S.shelter.concept, S.shelter.built, (id) => inv.count(id), S.owned);
    if (!pr.next) return { ok: false, why: pr.blocked ? pr.blocked.why : 'every piece is built' };
    const p = layoutOf().find((q) => q.key === pr.next.key), a = a01();
    if (Math.hypot(p.x - a.x, p.z - a.z) > 6) return { ok: false, why: 'drive closer to the site' };
    const cols = pieceCols(p, 0), who = blockers(cols);
    if (who.length) return { ok: false, why: `${whoIs(who[0])} is in the way of the ${(cat[p.item] || { name: p.item }).name}` };
    if (V2.arm.state !== 'mounted') return { ok: false, why: 'fit the grab arm: it places the pieces' };
    // the arm works towards the piece's spot (a roof tile or anything right over a01: it reaches up ahead of it)
    const near = Math.hypot(p.x - a.x, p.z - a.z) < 1.0 || p.y > 2, tp = near ? [a.x + Math.cos(a.yaw) * 1.2, 0.3, a.z - Math.sin(a.yaw) * 1.2] : [p.x, 0.3, p.z];
    const r = sim.armWork(tp, 1.4, 'build:' + p.key);
    if (!r.ok) return r.why === 'turn to face it' ? { ok: false, why: `turn to face the ${(cat[p.item] || { name: p.item }).name}'s spot`, piece: p } : r;
    S.working = { kind: 'build', piece: p }; return { ok: true, piece: p, arm: true };
  }
  const layoutOf = () => (S.shelter ? shelters.layout(S.shelter.concept, S.shelter.site) : []);
  /** a piece's colliders; a door's as it stands at `open` (0 shut .. 1 open) */
  function pieceCols(p, open = 0) {
    if (!p.door) return p.cols;
    const e = cat[p.item];
    if (e.game.door) {   // the accordion: the fixed post, the lattice (scaled on its x), the moving post at its end
      const span = 2.93 * (0.89 - (0.89 - 0.12) * open), phi = p.yaw, c = Math.cos(phi), s = Math.sin(phi), at = (lx) => [p.x + lx * c, p.z - lx * s];
      const [mx, mz] = at(0.07 + span / 2), [ex, ez] = at(0.07 + span + 0.05);
      return [{ c: [p.x, 0.83, p.z], h: [0.07, 0.83, 0.24], yaw: phi }, { c: [mx, 0.75, mz], h: [span / 2, 0.6, 0.05], yaw: phi }, { c: [ex, 0.83, ez], h: [0.07, 0.83, 0.24], yaw: phi }];
    }
    // the dock gate: swings out about its left end
    const L = 1.58, hinge = [p.x - L * Math.cos(p.yaw), p.z + L * Math.sin(p.yaw)], phi = p.yaw - open * Math.PI / 2;
    return [{ c: [hinge[0] + L * Math.cos(phi), 0.57, hinge[1] - L * Math.sin(phi)], h: [L, 0.57, 0.07], yaw: phi }];
  }
  function placePiece(p) {
    if (!S.shelter || S.shelter.built.has(p.key)) return false;
    if (!p.found && inv.take(p.item, 1) == null) return false;
    if (p.door) { const fixed = addFixed(pieceCols(p, S.shelter.gate.open), 'door'); S.shelter.doors.set(p.key, { fixed, piece: p }); }
    else if (p.cols.length) S.shelter.bodies.set(p.key, addFixed(p.cols, 'piece'));
    S.shelter.built.add(p.key); refreshLoad();
    const pr = shelters.progress(S.shelter.concept, S.shelter.built, (id) => inv.count(id), S.owned);
    ev({ type: 'built', key: p.key, item: p.item, done: pr.done, of: pr.of, sealed: pr.sealed });
    if (pr.sealed && !S.shelter.sealedOnce) { S.shelter.sealedOnce = true; ev({ type: 'sealed', concept: S.shelter.concept }); placeStations(); autosave('sealed'); }
    return true;
  }
  function restoreShelter(sh) {
    clearShelter(); if (!sh || !shelters.kits[sh.concept]) return;
    S.shelter = { concept: sh.concept, site: sh.site, built: new Set(), bodies: new Map(), doors: new Map(), gate: { open: 0, target: 0 }, sealedOnce: false };
    const L = layoutOf();
    for (const key of sh.built) { const p = L.find((q) => q.key === key); if (!p) continue; if (p.door) S.shelter.doors.set(key, { fixed: addFixed(pieceCols(p, 0), 'door'), piece: p }); else if (p.cols.length) S.shelter.bodies.set(key, addFixed(p.cols, 'piece')); S.shelter.built.add(key); }
    S.shelter.sealedOnce = sealed();
  }
  /** the gates follow a01: open while it is within 2.6 m of the opening, shut otherwise (their colliders move with them) */
  function gateStep(dt) {
    if (!S.shelter || !S.shelter.doors.size) return;
    const g = shelters.geometry(S.shelter.concept, S.shelter.site).gate, a = a01(), G2 = S.shelter.gate;
    G2.target = Math.hypot(a.x - g.x, a.z - g.z) < 2.6 ? 1 : 0;
    if (G2.open === G2.target) return;
    G2.open = G2.target > G2.open ? Math.min(1, G2.open + dt * 1.1) : Math.max(0, G2.open - dt * 0.9);
    for (const d of S.shelter.doors.values()) { const cols = pieceCols(d.piece, G2.open); d.fixed.cols.forEach((c, i) => { const b = cols[i]; c.setHalfExtents({ x: b.h[0], y: b.h[1], z: b.h[2] }); c.setTranslation({ x: b.c[0], y: b.c[1], z: b.c[2] }); c.setRotation(qy(b.yaw)); }); }
  }
  /** a01 is inside its sealed shelter (safe from leeches) */
  const inShelter = () => { if (!sealed()) return false; const a = a01(); return shelters.inside(S.shelter.concept, S.shelter.site, a.x, a.z, 0.15); };
  /** parked on the shelter's charging pad */
  function onPad() {
    if (!sealed()) return false;
    const g = shelters.geometry(S.shelter.concept, S.shelter.site).pad, a = a01(), m = sim.motion();
    return Math.hypot(a.x - g.x, a.z - g.z) < SHELTER_CHARGE.padR && Math.abs(wrap(a.yaw - g.yaw)) < SHELTER_CHARGE.padYawDeg * DEG && m.speed < 0.08;
  }
  // the crafted machines that stand in the shelter: the kit's station slots in the order they were made (each checked clear)
  S.placed = [];
  function placeStations() {
    if (!S.shelter || !sealed()) return;
    const kit = shelters.kits[S.shelter.concept], F = shelters.frame(S.shelter.site);
    for (const id of S.stations) {
      if (S.placed.some((p) => p.id === id)) continue;
      const r = crafting.byId.get(id), e = cat[r.output], col = e && e.game.collider; if (!col) continue;
      for (let k = 0; k < kit.stations.length; k++) {
        if (S.placed.some((p) => p.slot === k)) continue;
        const sl = kit.stations[k], [x, z] = F.w(sl.u, sl.v), phi = S.shelter.site.yaw + sl.yaw * DEG;
        const ox = col.c[0] * Math.cos(phi) + col.c[2] * Math.sin(phi), oz = -col.c[0] * Math.sin(phi) + col.c[2] * Math.cos(phi);
        const cols = [{ c: [x + ox, col.c[1], z + oz], h: col.h.slice(), yaw: phi }];
        const box = { x: x + ox, z: z + oz, hx: col.h[0], hz: col.h[2], yaw: phi };
        if (!inWorld(box.x, box.z, Math.max(box.hx, box.hz))) continue;
        if (fixedFootprints(true).some((f) => hit(f, box, 0.05)) || shelterBoxes().some((f) => hit(f, box, 0.02)) || S.placed.some((p) => hit(p.box, box, 0.05))) continue;
        if (keepOut().some((f) => hit(f, box, 0))) continue;
        if (blockers(cols).length) continue;
        S.placed.push({ id, slot: k, x, z, yaw: phi, box, fixed: addFixed(cols, 'station') }); ev({ type: 'station', id }); break;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- crafting and what each thing does
  const where = () => { if (!S.active) return null; if (inShelter() && sim.binOnDeck()) return 'shelter'; if (V2.dock.parked) return 'dock'; return null; };
  const clawId = () => { const g = V2.arm.grasp; return g && !V2.arm.seq ? idOfKind(g.item.kind) : null; };
  const ctx = () => ({ inv, where: where(), owned: S.owned, claw: clawId(), slotsFree: S.mounted.filter((p) => !p).length, room: (id) => inv.room(id, 1) });
  const canCraft = (id) => crafting.check(id, ctx());
  function craft(id) {
    const c = ctx(), r = crafting.craft(id, c);
    if (!r.ok) return r;
    if (r.fromClaw && V2.arm.grasp) sim.removeItem(V2.arm.grasp.item);
    const rec = r.recipe, out = rec.output, first = !inv.seen.has(out);
    if (rec.place === 'mount') { const i = S.mounted.findIndex((p) => !p); S.mounted[i] = r.panels.shift() || rollPanel(S.rnd, 'aged'); inv.seen.add(out); }
    else if (rec.place === 'bin') inv.add(out, 1, { force: true });
    else { S.owned[rec.id] = (S.owned[rec.id] || 0) + 1; inv.seen.add(out); if (rec.place === 'station' && !S.stations.includes(rec.id)) { S.stations.push(rec.id); placeStations(); } }
    // charges a craft gives
    if (rec.effect === 'lumen') S.charges.lumen = (S.charges.lumen || 0) + 3;
    if (rec.effect === 'somnus') S.charges.somnus = (S.charges.somnus || 0) + 1;
    if (rec.effect === 'syringe') S.charges.syringe = (S.charges.syringe || 0) + 1;
    applyEffects(); refreshLoad();
    S.lastCraft = rec.name; ev({ type: 'crafted', id: rec.id, name: rec.name, output: out, first, where: c.where, took: r.took });
    return { ok: true, recipe: rec, output: out, first, took: r.took };
  }
  /** the crafted things' standing effects on a01 */
  function applyEffects() {
    const st = Object.assign({}, ARM.stock);
    if (S.owned.R01) Object.assign(st, ARM.tetra);
    if (S.owned.R03) st.rate = ARM.dioscuriRate;
    sim.armStats = st;
    sim.speedScale = (S.owned.R20 ? 1.25 : 1) * (S.overdrive > 0 ? 2 : 1) * (S.cooled > 0 ? 1.15 : 1);
    sim.regen = S.owned.R20 ? 0.3 : 0;
  }
  /** use something from the bin, or a machine's once-a-day job -> { ok, why } */
  function use(id) {
    if (id === 'r24_small_vigil') {
      if (!inv.count(id)) return { ok: false, why: 'no Small Vigil in the bin' };
      const a = a01(), x = a.x - Math.cos(a.yaw) * 0.85, z = a.z + Math.sin(a.yaw) * 0.85, cols = [{ c: [x, 0.22, z], h: [0.08, 0.22, 0.08], yaw: 0 }];
      if (!inWorld(x, z, 0.3) || blockers(cols).length || fixedFootprints(true).some((f) => hit(f, { x, z, hx: 0.1, hz: 0.1, yaw: 0 }, 0.05))) return { ok: false, why: 'no room behind a01 to set it down' };
      inv.take(id, 1); S.vigils.push({ x, z, until: nightEnd(), fixed: addFixed(cols, 'vigil') }); refreshLoad(); ev({ type: 'vigil', x, z }); return { ok: true };
    }
    if (id === 'r22_contrast_syringe') { if (!(S.charges.syringe > 0)) return { ok: false, why: 'no dose left' }; S.charges.syringe--; S.overdrive = 60; applyEffects(); ev({ type: 'overdrive' }); return { ok: true }; }
    if (id === 'coolant') {
      if (!inv.count('coolant')) return { ok: false, why: 'no coolant in the bin' };
      inv.take('coolant', 1); for (const p of S.mounted) if (p) p.dust = 0;
      const aged = S.mounted.filter((p) => p && p.tier !== 'new').sort((a, b) => panelFactor(b) - panelFactor(a))[0]; if (aged) { aged.tier = 'aged'; restoreTier(aged); }
      S.cooled = 60; applyEffects(); refreshLoad(); ev({ type: 'coolant' }); return { ok: true };
    }
    if (id === 'pulse') {
      if (!S.owned.R07) return { ok: false, why: 'needs the Skiagraph Pillar' };
      if (S.charges.pulseDay === clock().day) return { ok: false, why: 'the pillar is charging: once a day' };
      S.charges.pulseDay = clock().day; S.revealUntil = S.time + 20; const n = reveal(15); ev({ type: 'pulse', n }); return { ok: true, n };
    }
    return { ok: false, why: 'nothing to use' };
  }
  const nightEnd = () => { const L = DAY.length, d = Math.floor(S.time / L); return (d + 1) * L + 1; };

  // ---------------------------------------------------------------------------------------------- the leeches
  let kcc = null;
  function controller() {
    if (kcc) return kcc;
    kcc = world.createCharacterController(0.01); kcc.setSlideEnabled(true); kcc.setApplyImpulsesToDynamicBodies(false); kcc.enableAutostep(0.06, 0.08, false); kcc.setMaxSlopeClimbAngle(30 * DEG);
    return kcc;
  }
  function spawnLeech() {
    // from a puddle, the forest's first; on clear floor at its edge, far enough from a01
    const a = a01(), pud = SLICKS.filter(([k]) => k === 'puddle'), forest = pud.filter(([, x, z]) => quadAt(x, z) === 'forest');
    const pool = S.leeches.length < 4 && forest.length ? forest : pud;
    for (let t = 0; t < 12; t++) {
      const [, px, pz, r] = pool[Math.floor(S.rnd() * pool.length)], ang = S.rnd() * Math.PI * 2, x = px + Math.cos(ang) * r * 0.6, z = pz + Math.sin(ang) * r * 0.6;
      if (Math.hypot(x - a.x, z - a.z) < 5 || blockedAt(x, z)) continue;
      const shape = new R.Capsule(LEECH.half, LEECH.radius + 0.01); let clear = true;
      world.intersectionsWithShape({ x, y: LEECH.y, z }, { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) }, shape, (o) => { const b = o.parent(); if (b && b.isFixed() && !o.isSensor()) clear = false; return clear; });
      if (!clear) continue;
      const yaw = Math.atan2(-(a.z - z), a.x - x);
      const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, LEECH.y, z).setRotation(qy(yaw)));
      const col = world.createCollider(R.ColliderDesc.capsule(LEECH.half, LEECH.radius).setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) }).setCollisionGroups(LEECH_GROUPS).setSolverGroups(LEECH_GROUPS), body);
      const L = { id: ++S.leechId, body, col, x, z, yaw, px: x, pz: z, pyaw: yaw, speed: LEECH.speed[0] + (LEECH.speed[1] - LEECH.speed[0]) * S.rnd(), state: 'crawl', side: 0, t: 0, stuck: 0, detour: 0, detourDir: 1, latchT: 0, home: [px, pz], alpha: 0, eye: S.rnd() * 6 };
      S.leeches.push(L); ev({ type: 'leech', id: L.id, x, z }); return L;
    }
    return null;
  }
  /** v4 (Nov 2, Josh: "if being chased by leeches then leeches spawn in random locations within the new area loading to"): the leeches
   *  chasing a01 (crawling within chaseM of it) are put down at random clear points of `rect` (the area a01 enters): never in or round
   *  the shelter, never where they may not go, never within minD of a01, never inside a fixed thing; `avoid(x, z)` = more places to
   *  keep out of (main.js: the hall). A leech with no clear point stays where it was. -> the ones moved: [{ id, x, z, d (m from a01) }] */
  function relocateLeeches(rect, { chaseM = 12, minD = 5, avoid = null, ids = null } = {}) {   // ids: exactly these (the ones chasing when the screen came up)
    const a = a01(), moved = [];
    const shape = new R.Capsule(LEECH.half, LEECH.radius + 0.01), rot = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) };
    for (const L of S.leeches) {
      if (ids ? !ids.includes(L.id) : L.state !== 'crawl' || Math.hypot(L.x - a.x, L.z - a.z) > chaseM) continue;
      for (let t = 0; t < 30; t++) {
        const x = rect.x0 + 0.8 + S.rnd() * Math.max(0, rect.x1 - rect.x0 - 1.6), z = rect.z0 + 0.8 + S.rnd() * Math.max(0, rect.z1 - rect.z0 - 1.6);
        if (Math.hypot(x - a.x, z - a.z) < minD || blockedAt(x, z) || forbidden(x, z) || (avoid && avoid(x, z))) continue;
        let clear = true;
        world.intersectionsWithShape({ x, y: LEECH.y, z }, rot, shape, (o) => { const b = o.parent(); if (b && b.isFixed() && !o.isSensor()) clear = false; return clear; });
        if (!clear) continue;
        const yaw = Math.atan2(-(a.z - z), a.x - x);
        L.body.setTranslation({ x, y: LEECH.y, z }, true); L.body.setRotation(qy(yaw), true);
        Object.assign(L, { x, z, px: x, pz: z, yaw, pyaw: yaw, stuck: 0, detour: 0 });
        moved.push({ id: L.id, x, z, d: Math.hypot(x - a.x, z - a.z) }); ev({ type: 'leechMoved', id: L.id, x, z }); break;
      }
    }
    return moved;
  }
  function removeLeech(L, why = 'melt', husk = false) {
    if (husk) { const s = { id: 'h' + L.id, kind: 'husk', item: 'leech_husk', x: L.x, z: L.z, yawDeg: Math.round(L.yaw / DEG), yield: 1, restock: 0, stripped: null };
      const cols = siteCol(s); if (cols.length && !blockers(cols).length && !fixedFootprints(true).some((f) => hit(f, { x: cols[0].c[0], z: cols[0].c[2], hx: cols[0].h[0], hz: cols[0].h[2], yaw: cols[0].yaw }, 0))) { s.fixed = addFixed(cols, 'husk'); S.husks.push(s); } }
    if (world.getRigidBody(L.body.handle)) world.removeRigidBody(L.body);
    S.leeches = S.leeches.filter((x) => x !== L); ev({ type: 'leechGone', id: L.id, why, husk });
  }
  /** the leeches' UV and sleep: where they may not go (the vigils, the Lumen Vigil round the shelter, the sealed shelter) */
  function forbidden(x, z) {
    for (const v of S.vigils) if (Math.hypot(x - v.x, z - v.z) < LEECH.uvSmall) return { x: v.x, z: v.z, r: LEECH.uvSmall, uv: true };
    if (S.shelter && sealed()) {
      const g = shelters.geometry(S.shelter.concept, S.shelter.site);
      if (S.owned.R04 && S.charges.lumen > 0 && Math.hypot(x - g.interior.x, z - g.interior.z) < LEECH.uvLumen) return { x: g.interior.x, z: g.interior.z, r: LEECH.uvLumen, uv: true };
      if (shelters.inside(S.shelter.concept, S.shelter.site, x, z, -0.45)) return { x: g.interior.x, z: g.interior.z, r: Math.hypot(g.interior.hx, g.interior.hz) + 0.5, shelter: true };
    }
    return null;
  }
  function leechPre(dt) {
    if (!S.leeches.length) return;
    const a = a01(), K = controller(), safe = inShelter(), flags = R.QueryFilterFlags.EXCLUDE_SENSORS | R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC;
    const dormant = S.owned.R11 && S.charges.somnusNight === clock().day && S.shelter ? shelters.geometry(S.shelter.concept, S.shelter.site).gate : null;
    for (const L of S.leeches) {
      L.px = L.x; L.pz = L.z; L.pyaw = L.yaw; L.t += dt;
      if (L.state === 'latched') {   // riding on a01's side
        const ang = a.yaw + L.side * Math.PI / 2 + Math.PI / 2, off = 0.62;
        L.x = a.x + Math.cos(ang) * off; L.z = a.z - Math.sin(ang) * off; L.yaw = ang + Math.PI;
        L.body.setNextKinematicTranslation({ x: L.x, y: 0.18, z: L.z }); L.body.setNextKinematicRotation(qy(L.yaw)); continue;
      }
      if (L.state === 'melt') { L.alpha += dt / 2; continue; }
      // a leech the shelter was sealed round (the last wall set at night with it inside) slips out through the gate
      if (S.shelter && sealed() && shelters.inside(S.shelter.concept, S.shelter.site, L.x, L.z, -0.1)) {
        const ap = shelters.geometry(S.shelter.concept, S.shelter.site).approach; L.x = L.px = ap.x + (S.rnd() - 0.5); L.z = L.pz = ap.z + (S.rnd() - 0.5);
        L.body.setTranslation({ x: L.x, y: LEECH.y, z: L.z }, true); continue;
      }
      if (dormant && Math.hypot(L.x - dormant.x, L.z - dormant.z) < LEECH.somnus) { L.state = 'dormant'; continue; }
      // where to: a01 if it is out and near; else back towards its puddle
      let tx = L.home[0], tz = L.home[1], sp = L.speed * 0.5;
      const da = Math.hypot(a.x - L.x, a.z - L.z);
      if (!safe && da < LEECH.aggro) { tx = a.x; tz = a.z; sp = L.speed; }
      else if (safe && da < 7) { tx = a.x; tz = a.z; sp = L.speed * 0.6; }   // they come and press on the mesh
      let dx = tx - L.x, dz = tz - L.z, d = Math.hypot(dx, dz); if (d < 0.05) continue;
      dx /= d; dz /= d;
      if (L.detour > 0) { L.detour -= dt; const s = L.detourDir; const ndx = -dz * s, ndz = dx * s; dx = ndx * 0.85 + dx * 0.15; dz = ndz * 0.85 + dz * 0.15; }
      const f = forbidden(L.x + dx * 0.6, L.z + dz * 0.6);
      if (f) { const ox = L.x - f.x, oz = L.z - f.z, od = Math.hypot(ox, oz) || 1; if (f.uv && Math.hypot(L.x - f.x, L.z - f.z) < f.r) { dx = ox / od; dz = oz / od; } else { const s = (dx * -oz + dz * ox) > 0 ? 1 : -1; dx = -oz / od * s; dz = ox / od * s; } }
      const want = { x: dx * sp * dt, y: 0, z: dz * sp * dt };
      K.computeColliderMovement(L.col, want, flags, LEECH_GROUPS);
      const m = K.computedMovement(), moved = Math.hypot(m.x, m.z);
      const nx = L.x + m.x, nz = L.z + m.z, f2 = forbidden(nx, nz);
      if (f2 && f2.shelter) { /* never into the sealed shelter */ } else { L.x = nx; L.z = nz; }
      if (moved < 0.35 * sp * dt) { L.stuck += dt; if (L.stuck > 0.7) { L.stuck = 0; L.detour = 1.2 + S.rnd(); L.detourDir = S.rnd() < 0.5 ? -1 : 1; } } else L.stuck = Math.max(0, L.stuck - dt);
      const hy = Math.atan2(-dz, dx); L.yaw += wrap(hy - L.yaw) * Math.min(1, dt * 4);
      L.body.setNextKinematicTranslation({ x: L.x, y: LEECH.y, z: L.z }); L.body.setNextKinematicRotation(qy(L.yaw));
    }
  }
  function leechAfter(dt, c) {
    const a = a01(), safe = inShelter(), B = V2.batt;
    // night: they come out of the puddles over the first part of the night
    if (c.night) {
      if (S.nightOf !== c.day) { S.nightOf = c.day; S.spawned = 0; S.collarNight = -1; ev({ type: 'night', day: c.day }); if (S.owned.R11 && S.charges.somnus > 0) { S.charges.somnus--; S.charges.somnusNight = c.day; } }
      const want = LEECH.perNight(c.day), into = (c.phase - DAY.dusk) * DAY.length, due = Math.min(want, Math.ceil(want * Math.min(1, into / LEECH.spawnWindow + 0.01)));
      if (S.spawned < due && S.leeches.length < want) { if (spawnLeech()) S.spawned++; else S.spawned += 0.25; }
    } else if (LEECH.perDay(c.day) > 0) {
      // from day 10, a few by day too (LEECH.perDay): out over the first minutes of the morning; they stay out until dusk and on
      const want = LEECH.perDay(c.day);
      if (S.dayOf !== c.day) { S.dayOf = c.day; S.daySpawned = 0; ev({ type: 'dayLeeches', day: c.day, n: want }); }
      const due = Math.min(want, Math.ceil(want * Math.min(1, (c.phase * DAY.length) / LEECH.daySpawnWindow + 0.01))), out = S.leeches.filter((L) => L.day && L.state !== 'melt').length;
      if (S.daySpawned < due && out < want) { const L = spawnLeech(); if (L) { L.day = true; S.daySpawned++; } else S.daySpawned += 0.25; }
    }
    // latch, drain, let go
    let latched = 0;
    for (const L of [...S.leeches]) {
      if (L.state === 'melt') { if (L.alpha >= 1) removeLeech(L, 'dawn'); continue; }
      if (!c.night && !L.day) { L.state = 'melt'; L.alpha = 0; continue; }   // the night's go back into the puddles at dawn
      if (L.state === 'latched') {
        const uv = forbidden(a.x, a.z);
        if (safe || (uv && uv.uv)) { L.state = 'crawl'; L.col.setCollisionGroups(LEECH_GROUPS); L.detour = 2; L.detourDir = 1; const g = S.shelter ? shelters.geometry(S.shelter.concept, S.shelter.site) : null;
          if (safe && g) { L.x = g.approach.x + (S.rnd() - 0.5); L.z = g.approach.z + (S.rnd() - 0.5); L.body.setTranslation({ x: L.x, y: LEECH.y, z: L.z }, true); }
          ev({ type: 'detach', id: L.id, why: safe ? 'shelter' : 'uv' }); continue; }
        L.latchT += dt;
        if (S.owned.R08 && L.latchT >= LEECH.lance) { removeLeech(L, 'lance', true); ev({ type: 'zapped', by: 'Coherent Lance' }); continue; }
        latched++; continue;
      }
      if (L.state === 'dormant') continue;
      const d = Math.hypot(a.x - L.x, a.z - L.z);
      if (!safe && d < LEECH.latch && !(forbidden(a.x, a.z) || {}).uv) {
        if (S.owned.R21 && S.collarNight !== c.day) { S.collarNight = c.day; removeLeech(L, 'collar', true); ev({ type: 'zapped', by: 'Leech Collar' }); continue; }
        const used = S.leeches.filter((x) => x.state === 'latched').map((x) => x.side); let side = 0; while (used.includes(side) && side < 3) side++;
        L.state = 'latched'; L.side = side; L.latchT = 0; L.col.setCollisionGroups(groups(G_LEECH, 0)); latched++; ev({ type: 'latched', id: L.id, n: latched });
      }
    }
    S.latched = latched;
    // the drain: 1.5 % of the pack a second for each
    if (latched) B.e = Math.max(0, B.e - LEECH.drain * B.cap * latched * dt);
    // the Warmth Eye: 30 s warning (a leech within 15 m of a01 or the shelter)
    if (S.owned.R23 && c.night && S.warned !== c.day) {
      const g = S.shelter ? shelters.geometry(S.shelter.concept, S.shelter.site).interior : null;
      if (S.leeches.some((L) => L.state === 'crawl' && (Math.hypot(L.x - a.x, L.z - a.z) < 15 || (g && Math.hypot(L.x - g.x, L.z - g.z) < 15)))) { S.warned = c.day; ev({ type: 'warn' }); }
    }
  }
  /** death: the pack at 0 %, from any cause (the motors, the arm, the cold, a puddle, the leeches). The Lazarus Clamps, if a01 carries
   *  them, bring it back once. (Armed once the pack has had any charge in the open world: a01 brought out of the tutorial flat is in
   *  limp mode, on the tutorial's reserve, until it has charged.) */
  function deathCheck(c) {
    const B = V2.batt;
    if (B.e > 0) { S.armed = true; return; }
    if (!S.armed || S.dead) return;
    if (inv.count('r13_lazarus_clamps') > 0) { inv.take('r13_lazarus_clamps', 1); B.e = 0.25 * B.cap; limpCheck(B); for (const L of S.leeches.filter((x) => x.state === 'latched')) removeLeech(L, 'lazarus', true); refreshLoad(); ev({ type: 'revived' }); return; }
    S.dead = true; ev({ type: 'death', day: c.day, cause: S.latched ? 'leeches' : 'flat' });
  }

  // ---------------------------------------------------------------------------------------------- the clock, power, dawn
  const clock = () => clockAt(S.time);
  function dawn(day) {
    // the salvage comes back, new supplies lie about, the panels age, the machines' daily jobs
    for (const s of S.sites) if (s.stripped != null && day - s.stripped >= (s.restock || 3)) { if (s.kind !== 'spot' || placeSite(s)) { s.stripped = null; S.restocked++; } }
    scatter();
    const corroded = !(S.lastNightSafe && S.owned.R12);   // the Iron Breath keeps the night's corrosion off (a01 inside the shelter with it)
    for (const p of S.mounted) ageDay(p, S.rnd, corroded);
    if (S.owned.R18) { const p = S.mounted.filter((q) => q && q.tier !== 'new').sort((x, y) => panelFactor(y) - panelFactor(x))[0]; if (p) { restoreTier(p); ev({ type: 'altar' }); } }
    if (S.owned.R10 && inv.room('coolant', 1).ok) inv.add('coolant', 1);
    if (S.owned.R05) { const pool = ['storage_shelf', 'coolant_tank', 'bedding', 'scaffold', 'tool_cabinet', 'led_hexgrid', 'roof_slab', 'strip_light', 'copper_cable', 'light_bulb', 'fuse', 'battery_9v'];
      const id = pool[Math.floor(S.rnd() * pool.length)]; if (inv.room(id, 1).ok) { const r = inv.add(id, 1); ev({ type: 'collect', id, n: 1, first: r.first, how: 'courier' }); } }
    if (S.owned.R04 && S.charges.lumen > 0 && S.nightOf === day - 1) S.charges.lumen--;
    S.vigils = S.vigils.filter((v) => { if (S.time >= v.until) { drop(v.fixed); return false; } return true; });
    // a few supplies buried in the forest's mud (the Echo Psalter and the Skiagraph Pillar find them)
    while (S.buried.length < 6) { const [x, z] = data.sites.buried[Math.floor(S.rnd() * data.sites.buried.length)]; const k = pick(supplyPool('forest')); if (!k) break; S.buried.push([k, x, z]); }
    refreshLoad(); ev({ type: 'dawn', day });
    if (inShelter()) autosave('dawn');
  }
  function power(dt, c) {
    const B = V2.batt, a = a01();
    if (sim.binOnDeck()) { const w = solarWatts(S.mounted, c.phase, a.yaw); S.solarW = w; if (w > 0) B.e = Math.min(B.cap, B.e + w * dt); } else S.solarW = 0;
    if (c.night) { const k = S.owned.R19 && inShelter() ? LEECH.salamander : 1; B.e = Math.max(0, B.e - LEECH.nightColdW * k * dt); }
    if (S.overdrive > 0) B.e = Math.max(0, B.e - (B.watts || 0) * dt);   // double drain: the motors' own draw again
    S.charging = false;
    if (onPad()) {
      S.padT += dt; const w = S.owned.R16 ? SHELTER_CHARGE.leyW : SHELTER_CHARGE.trickleW;
      if (B.e < B.cap) { B.e = Math.min(B.cap, B.e + w * dt); B.charging = true; S.charging = true; }
      if (B.limp && B.e >= limpLine(B).exit) { B.limp = false; ev({ type: 'limpOff' }); }
      // the Roentgen Furnace: at night it burns a diesel can for 10 % of the pack (one every 6 s while it is under 90 %)
      if (c.night && S.owned.R06 && B.e < 0.9 * B.cap && inv.count('diesel_can') > 0) { S.furnaceT = (S.furnaceT || 0) + dt; if (S.furnaceT > 6) { S.furnaceT = 0; inv.take('diesel_can', 1); B.e = Math.min(B.cap, B.e + 0.1 * B.cap); refreshLoad(); ev({ type: 'furnace' }); } }
      if (S.padT > 1 && S.time - S.lastSave > AUTOSAVE.every) autosave('pad');
    } else S.padT = 0;
  }
  function refreshLoad() { sim.setBinLoad(inv.load().kg); }

  // ---------------------------------------------------------------------------------------------- the step
  function a01() { const ch = sim.trolley.chassis.body, t = ch.translation(), q = ch.rotation(); const f = [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)]; return { x: t.x, z: t.z, y: t.y, yaw: Math.atan2(-f[1], f[0]) }; }
  function step(inp) {
    if (!S.active) { sim.step(inp); return sim.takeEvents(); }
    const dt = sim.DT;
    leechPre(dt); gateStep(dt);
    sim.step(inp);
    const evs = sim.takeEvents();
    after(evs, dt);
    return evs.concat(sim.takeEvents());
  }
  function after(evs, dt) {
    const c0 = clock();
    S.time += dt * S.timeScale;
    const c = clock();
    if (c.day !== c0.day) { S.lastNightSafe = inShelter(); dawn(c.day); }
    if (S.waiting && (!c.night || !inShelter())) { S.waiting = false; S.timeScale = 1; ev({ type: 'wait', on: false }); }
    if (S.overdrive > 0) { S.overdrive = Math.max(0, S.overdrive - dt); if (!S.overdrive) applyEffects(); }
    if (S.cooled > 0) { S.cooled = Math.max(0, S.cooled - dt); if (!S.cooled) applyEffects(); }
    // stow: a supply or trash that came to rest in the bin goes into its manifest (its body goes); the arm's work ends
    for (const e of evs) {
      if (e.type === 'banked') {
        const it = V2.items.find((i) => i.id === e.id), id = idOfKind(e.kind);
        if (it && id) { const r = inv.add(id, 1); if (r.ok) { sim.removeItem(it); ev({ type: 'collect', id, n: 1, first: r.first, how: 'grab' }); refreshLoad(); } }
      } else if (e.type === 'workDone') {
        const w = S.working; S.working = null;
        if (w && w.kind === 'salvage' && e.tag === 'salvage:' + w.site.id) finishSalvage(w.site);
        else if (w && w.kind === 'build' && e.tag === 'build:' + w.piece.key) placePiece(w.piece);
      } else if (e.type === 'grabDone' && S.owned.R01 && !e.carrying) {   // the Tetrabrachion: up to 4 in a press
        S.chain = (S.chain || 1) + 1; if (S.chain <= ARM.tetra.perPress && sim.reachable().length) sim.grab(); else S.chain = 1;
      }
    }
    if (S.owned.R09) reveal(10);
    power(dt, c);
    leechAfter(dt, c);
    deathCheck(c);
    S.stats = { solarW: S.solarW || 0, latched: S.latched || 0 };
  }

  // ---------------------------------------------------------------------------------------------- start, stop, save, load
  function start({ save = null, place = true } = {}) {
    stop(); S.active = true; S.dead = false; S.events = []; S.leechId = 0;
    sim.setHallDoors(true);
    const sv = save || null;
    S.seed = sv ? sv.seed : (seed || 1); S.rnd = mulberry(S.seed + 17 * ((sv && sv.deaths) || 0));
    S.time = sv ? sv.time : DAY.start * DAY.length; S.deaths = sv ? sv.deaths : S.deaths;
    inv.restore(sv ? sv.inv : null);
    S.mounted = new Array(SOLAR.slots).fill(null); if (sv) sv.mounted.forEach((p, i) => { if (i < SOLAR.slots && p && ['new', 'aged', 'ruined'].includes(p.tier)) S.mounted[i] = { tier: p.tier, eff: +p.eff || 0.5, q: +p.q || 0.8, dust: +p.dust || 0 }; });
    S.owned = {}; if (sv) for (const [k, v] of Object.entries(sv.owned)) if (crafting.byId.has(k) && Number.isInteger(v) && v > 0) S.owned[k] = v;
    S.charges = sv ? Object.fromEntries(Object.entries(sv.charges).filter(([, v]) => Number.isFinite(v))) : {};
    S.stations = sv ? sv.stations.filter((id) => crafting.byId.has(id)) : [];
    buildSites(sv ? sv.world.stripped : {});
    S.buried = sv ? sv.world.buried.filter((b) => sim.kinds[b[0]]) : [];
    if (sv && sv.shelter) restoreShelter(sv.shelter);
    if (S.shelter && sealed()) placeStations();
    for (const [x, z] of sv ? sv.world.husks : []) { const s = { id: 'h' + (++S.leechId), kind: 'husk', item: 'leech_husk', x, z, yawDeg: 0, yield: 1, restock: 0, stripped: null }; if (placeSite(s)) S.husks.push(s); }
    applyEffects();
    if (place) {
      if (sv && S.shelter && sealed()) { const g = shelters.geometry(S.shelter.concept, S.shelter.site).pad; sim.reset({ x: g.x, z: g.z, yawDeg: g.yaw / DEG }); }
      else if (sv) sim.reset({ x: DOCK_BAY.park.x, z: DOCK_BAY.park.z, yawDeg: DOCK_BAY.park.yawDeg });
    }
    if (sv) V2.batt.e = V2.batt.cap * sv.battery;
    // the open world's battery: limp under 10 %, death at 0 % (survival_rules.js BATTERY)
    V2.batt.limpAt = BATTERY.limpBelow; V2.batt.limpExit = BATTERY.limpExit; limpCheck(V2.batt); S.armed = V2.batt.e > 0;
    if (sv) for (const [kind, x, z] of sv.world.loose) spawnSupply(kind, x, z, 0);
    else scatter();
    if (!S.buried.length) dawnBuried();
    refreshLoad(); S.lastSave = S.time; S.startedAt = S.time; S.nightOf = clock().night ? clock().day : 0;
    ev({ type: 'start', fromSave: !!sv });
  }
  function dawnBuried() { for (let i = 0; i < 6; i++) { const [x, z] = data.sites.buried[i % data.sites.buried.length]; const k = pick(supplyPool('forest')); if (k) S.buried.push([k, x, z]); } }
  function stop() {
    for (const L of [...S.leeches]) if (world.getRigidBody(L.body.handle)) world.removeRigidBody(L.body);
    S.leeches = [];
    for (const s of S.sites) drop(s.fixed); S.sites = [];
    for (const h of S.husks) drop(h.fixed); S.husks = [];
    for (const v of S.vigils) drop(v.fixed); S.vigils = [];
    clearShelter();
    for (const it of [...V2.items]) if (it.spec.supply) sim.removeItem(it);
    S.active = false; S.waiting = false; S.timeScale = 1; S.overdrive = 0; S.cooled = 0; S.working = null;
    V2.batt.limpAt = 0; V2.batt.limpExit = 0; limpCheck(V2.batt); S.armed = false;   // back to the tutorial's rule
    sim.armStats = Object.assign({}, ARM.stock); sim.speedScale = 1; sim.regen = 0; sim.setBinLoad(0);
  }
  function serialize() {
    const loose = [];
    for (const it of V2.items) if (it.state === 'floor' && !it.banked && !it.held) { const t = it.body.translation(); if (inWorld(t.x, t.z, 0.3)) loose.push([it.kind, +t.x.toFixed(2), +t.z.toFixed(2)]); }
    const stripped = {}; for (const s of S.sites) if (s.stripped != null) stripped[s.id] = s.stripped;
    return { seed: S.seed, time: +S.time.toFixed(2), tutorialDone: true, deaths: S.deaths, inv: inv.serialize(), mounted: S.mounted.map((p) => (p ? Object.assign({}, p) : null)), owned: Object.assign({}, S.owned), charges: Object.assign({}, S.charges),
      shelter: S.shelter ? { concept: S.shelter.concept, site: Object.assign({}, S.shelter.site), built: [...S.shelter.built] } : null, stations: S.stations.slice(),
      world: { stripped, loose, husks: S.husks.map((h) => [+h.x.toFixed(2), +h.z.toFixed(2)]), buried: S.buried.map((b) => b.slice()), restocked: S.restocked }, battery: V2.batt.cap ? V2.batt.e / V2.batt.cap : 1, at: inShelter() ? 'shelter' : 'dock' };
  }
  function autosave(why = 'manual') { if (!S.active || S.dead) return false; const ok = saves.save(serialize()); S.lastSave = S.time; ev({ type: 'saved', why, ok }); return ok; }
  /** at the shelter at night: the clock runs 24x until dawn (a01 sits it out; the physics is the same) */
  function waitForDawn() { if (!inShelter()) return { ok: false, why: 'only inside the sealed shelter' }; if (!clock().night) return { ok: false, why: 'it is day' }; S.waiting = true; S.timeScale = 24; ev({ type: 'wait', on: true }); return { ok: true }; }
  /** death: the save goes (death restarts from the beginning) */
  function die() { S.dead = true; saves.clear(); S.deaths++; }

  /** the fixed things this module added, as paths.js footprints (Juli's path checks): the shelter's pieces, the salvage sites, the vigils */
  function footprints() {
    const F = shelterBoxes();
    for (const s of S.sites.concat(S.husks)) if (s.fixed) F.push(siteBox(s));
    for (const p of S.placed) F.push(p.box);
    for (const v of S.vigils) F.push({ x: v.x, z: v.z, hx: 0.1, hz: 0.1, yaw: 0 });
    return F;
  }
  /** may a barricade stand at this lane ([x, z, yawDeg], 0.31 x 1.34 m)? not on the shelter, inside it or on a site */
  function laneClear(lane) {
    const b = { x: lane[0], z: lane[1], hx: 0.16, hz: 0.67, yaw: (lane[2] || 0) * DEG };
    if (S.shelter && (shelters.inside(S.shelter.concept, S.shelter.site, b.x, b.z, -0.8) || shelterBoxes().some((f) => hit(f, b, 0.3)))) return false;
    return !footprints().some((f) => hit(f, b, 0.2));
  }
  /** what Juli is told about the open world (and the HUD shows) */
  function summary() {
    const c = clock(), sh = S.shelter, pr = sh ? shelters.progress(sh.concept, sh.built, (id) => inv.count(id), S.owned) : null, a = a01();
    return { day: c.day, clock: c.label, night: c.night, toDusk: Math.round(c.toDusk / 10) * 10, leeches: S.leeches.length, near: S.leeches.filter((L) => Math.hypot(L.x - a.x, L.z - a.z) < 10).length, latched: S.latched || 0,
      shelter: sh ? { name: shelters.kits[sh.concept].name, built: pr.done, of: pr.of, sealed: pr.sealed } : null, inside: inShelter(), lastCraft: S.lastCraft, crafted: Object.keys(S.owned).length, panels: S.mounted.filter(Boolean).length };
  }
  function state() {
    const c = clock(), sh = S.shelter, pr = sh ? shelters.progress(sh.concept, sh.built, (id) => inv.count(id), S.owned) : null, a = S.active ? a01() : null;
    return {
      active: S.active, dead: S.dead, day: c.day, clock: c.label, night: c.night, phase: +c.phase.toFixed(4), sun: +c.sun.toFixed(3), toDusk: Math.round(c.toDusk), toDawn: Math.round(c.toDawn), waiting: S.waiting,
      leeches: S.leeches.length, latched: S.latched || 0, near: a ? S.leeches.filter((L) => Math.hypot(L.x - a.x, L.z - a.z) < 10).length : 0,
      solarW: Math.round(S.solarW || 0), panels: S.mounted.filter(Boolean).length, charging: !!S.charging, where: where(), inside: S.active && inShelter(),
      shelter: sh ? { concept: sh.concept, name: shelters.kits[sh.concept].name, done: pr.done, of: pr.of, sealed: pr.sealed, next: pr.next ? pr.next.item : null, blocked: pr.blocked ? pr.blocked.why : null } : null,
      bin: inv.load(), salvage: S.active && salvageTarget() ? salvageTarget().item : null, lastCraft: S.lastCraft, overdrive: Math.ceil(S.overdrive), owned: Object.keys(S.owned),
    };
  }
  return {
    S, inv, crafting, shelters, saves, cat, start, stop, step, after, salvage, salvageTarget, finishSalvage, craft, canCraft, where, use, markSite, siteHere, checkSite, suggest, buildNext, placePiece,
    layoutOf, pieceCols, inShelter, onPad, sealed, state, serialize, autosave, waitForDawn, die, applyEffects, spawnLeech, relocateLeeches, removeLeech, scatter, spawnSupply, reveal, clock, a01, idOfKind, kindOfId,
    footprints, laneClear, summary, siteBox,
    take: () => S.events.splice(0, S.events.length), get active() { return S.active; }, get leeches() { return S.leeches; }, get sites() { return S.sites; }, get shelter() { return S.shelter; },
    get placed() { return S.placed; }, get mounted() { return S.mounted; }, get vigils() { return S.vigils; }, get husks() { return S.husks; }, blockedAt, keepOut, SUPPLY,
  };
}
