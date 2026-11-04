// shelter.js - a01's shelter: the three concepts of data/shelters.json (the Cage Hive, the Rack Fort, the warehouse-corner bunker), each
// a list of pieces with their slots in the site's own frame. A site is where a01 chooses: its centre (x, z) and the way its gate faces
// (yaw, the game's convention: 0 = east, + = towards north). Here: every piece's collider in the world, the site's check (inside the
// world, clear of every fixed thing, nothing inside it), the build order, when the shelter is sealed (every needed piece built), and
// what is inside it. Pure maths: the physics (survival.js), the drawing and the tests read it.
//
// The site's frame: u forward (out through the gate), v to its right. A slot { u, v, yaw (deg), y } puts the piece's own +x along u
// turned by yaw (three.js's rotation about +y), its origin (bottom centre) at height y.
const DEG = Math.PI / 180;

export function createShelters(kits, catalog) {
  const K = kits.kits;
  /** the site frame -> world */
  const frame = (site) => { const c = Math.cos(site.yaw), s = Math.sin(site.yaw); return { c, s, w: (u, v) => [site.x + u * c + v * s, site.z - u * s + v * c], inv: (x, z) => { const dx = x - site.x, dz = z - site.z; return [dx * c - dz * s, dx * s + dz * c]; } }; };
  const rot = (a, b, phi) => [a * Math.cos(phi) + b * Math.sin(phi), -a * Math.sin(phi) + b * Math.cos(phi)];   // local (x, z) turned by phi about +y
  /** every slot of a concept at a site: [{ key, g (piece index), k (slot index), item, x, z, y, yaw (rad), need, forge, interior, door, found, light, cols: [{ c: [x, y, z], h: [hx, hy, hz], yaw }] }] */
  function layout(concept, site) {
    const kit = K[concept]; if (!kit) return [];
    const F = frame(site), out = [];
    kit.pieces.forEach((p, g) => p.slots.forEach((sl, k) => {
      const [x, z] = F.w(sl.u, sl.v), phi = site.yaw + (sl.yaw || 0) * DEG, y = sl.y || 0, e = catalog[p.item], cols = [];
      const boxes = p.walls ? p.walls : e && e.game && e.game.collider ? [e.game.collider] : [];
      for (const b of boxes) { const [ox, oz] = rot(b.c[0], b.c[2], phi); cols.push({ c: [x + ox, y + b.c[1], z + oz], h: b.h.slice(), yaw: phi }); }
      out.push({ key: `${g}:${k}`, g, k, item: p.item, x, z, y, yaw: phi, need: !!p.need, forge: !!p.forge, interior: !!p.interior, door: !!sl.door, mirror: !!sl.mirror, found: !!p.found, light: p.light || null, cols, slot: sl });
    }));
    return out;
  }
  /** the 2D boxes that stand on the floor ({ x, z, hx, hz, yaw }: paths.js's footprints); roofs and lights up high are left out */
  function footprints(concept, site, built = null) {
    const F = [];
    for (const p of layout(concept, site)) { if (built && !built.has(p.key)) continue; for (const c of p.cols) if (c.c[1] - c.h[1] < 1.2) F.push({ x: c.c[0], z: c.c[2], hx: c.h[0], hz: c.h[2], yaw: c.yaw }); }
    return F;
  }
  /** the interior as a 2D box, its gate (the opening's centre, its width, the way out) and the charger's pad (a01's parking pose) */
  function geometry(concept, site) {
    const kit = K[concept], F = frame(site), I = kit.interior, G = kit.gate, P = kit.pad;
    const [ix, iz] = F.w((I.u0 + I.u1) / 2, (I.v0 + I.v1) / 2), [gx, gz] = F.w(G.u, G.v), [px, pz] = F.w(P.u, P.v);
    const out = G.axis === 'v' ? [Math.sin(site.yaw) * Math.sign(G.v), Math.cos(site.yaw) * Math.sign(G.v)] : [Math.cos(site.yaw) * Math.sign(G.u), -Math.sin(site.yaw) * Math.sign(G.u)];
    return { interior: { x: ix, z: iz, hx: (I.u1 - I.u0) / 2, hz: (I.v1 - I.v0) / 2, yaw: site.yaw }, gate: { x: gx, z: gz, w: G.w, out },
      pad: { x: px, z: pz, yaw: site.yaw + P.yaw * DEG }, approach: { x: gx + out[0] * 1.6, z: gz + out[1] * 1.6 } };
  }
  /** is (x, z) inside the shelter's interior (shrunk by m)? */
  function inside(concept, site, x, z, m = 0) {
    const I = K[concept].interior, [u, v] = frame(site).inv(x, z);
    return u > I.u0 + m && u < I.u1 - m && v > I.v0 + m && v < I.v1 - m;
  }
  /** the whole site as one box (its needed pieces and interior, grown by m; an optional piece is checked when it is built) */
  function bounds(concept, site, m = 0, all = false) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const F = frame(site), kit = K[concept];
    for (const p of layout(concept, site)) for (const c of p.cols) {
      if (c.c[1] - c.h[1] > 1.2 || (!p.need && !all)) continue;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [ox, oz] = rot(sx * c.h[0], sz * c.h[2], c.yaw), [u, v] = F.inv(c.c[0] + ox, c.c[2] + oz); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    }
    u0 = Math.min(u0, kit.interior.u0); u1 = Math.max(u1, kit.interior.u1); v0 = Math.min(v0, kit.interior.v0); v1 = Math.max(v1, kit.interior.v1);
    const [x, z] = F.w((u0 + u1) / 2, (v0 + v1) / 2);
    return { x, z, hx: (u1 - u0) / 2 + m, hz: (v1 - v0) / 2 + m, yaw: site.yaw };
  }
  /** can the shelter stand here? fixed: the world's fixed footprints (paths.js), keep: boxes to keep clear (salvage sites, the dock's
   *  approach, the doorways...), inWorld(x, z, m) -> { ok, why } */
  function check(concept, site, { fixed = [], keep = [], inWorld = () => true } = {}) {
    if (!K[concept]) return { ok: false, why: 'no such shelter' };
    if (![site.x, site.z, site.yaw].every(Number.isFinite)) return { ok: false, why: 'no site' };
    const b = bounds(concept, site, 0.03);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [ox, oz] = rot(sx * b.hx, sz * b.hz, b.yaw); if (!inWorld(b.x + ox, b.z + oz, 0.1)) return { ok: false, why: 'it would stand outside the fence' }; }
    for (const f of fixed) if (hit(b, f, 0)) return { ok: false, why: 'something fixed stands in the way', what: f };
    for (const f of keep) if (hit(b, f, 0)) return { ok: false, why: f.why || 'too close to something a01 needs', what: f };
    return { ok: true, why: '' };
  }
  /** the build: the next slot to build (in the kit's order; an optional piece a01 has none of is skipped), what it needs, sealed */
  function progress(concept, built, have = () => 0, owned = {}) {
    const L = layout(concept, { x: 0, z: 0, yaw: 0 }), need = L.filter((p) => p.need), done = need.filter((p) => built.has(p.key)).length;
    let next = null, blocked = null;
    for (const p of L) {
      if (built.has(p.key)) continue;
      const used = L.filter((q) => q.item === p.item && built.has(q.key)).length;   // the same item may go in several slots
      const ok = p.found || have(p.item) > 0, forge = !p.forge || !!owned.R15;
      if (ok && forge) { next = p; break; }
      if (p.need && !blocked) blocked = { piece: p, why: !forge ? 'needs the Arc Forge (R15)' : `needs a ${(catalog[p.item] || { name: p.item }).name}`, used };
    }
    return { next, blocked, done, of: need.length, sealed: done === need.length, built: built.size, total: L.length };
  }
  return { layout, footprints, geometry, inside, bounds, check, progress, kits: K, concepts: Object.keys(K), frame };
}
/** do two yawed 2D boxes overlap (grown by m)? (separating axes) */
export function hit(a, b, m = 0) {
  const ax = [[Math.cos(a.yaw || 0), -Math.sin(a.yaw || 0)], [Math.sin(a.yaw || 0), Math.cos(a.yaw || 0)]], bx = [[Math.cos(b.yaw || 0), -Math.sin(b.yaw || 0)], [Math.sin(b.yaw || 0), Math.cos(b.yaw || 0)]];
  const d = [b.x - a.x, b.z - a.z];
  for (const n of [...ax, ...bx]) {
    const ra = Math.abs(a.hx * (ax[0][0] * n[0] + ax[0][1] * n[1])) + Math.abs(a.hz * (ax[1][0] * n[0] + ax[1][1] * n[1]));
    const rb = Math.abs(b.hx * (bx[0][0] * n[0] + bx[0][1] * n[1])) + Math.abs(b.hz * (bx[1][0] * n[0] + bx[1][1] * n[1]));
    if (Math.abs(d[0] * n[0] + d[1] * n[1]) > ra + rb + m) return false;
  }
  return true;
}
