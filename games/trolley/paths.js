// paths.js - can a01 still get everywhere it needs to? A 10 cm grid over the whole world's floor (world_spec.js: the hall, its yard,
// the plaza and the four quadrants), every obstacle grown by the trolley's half-width (0.5 m), and Dijkstra (8 neighbours) from a01 to
// each objective. Used before Juli may nudge a barricade: every objective must stay reachable and no path may grow by more than the
// mode's detour limit. Pure maths (the tests run it in Node); a typed-array heap keeps a check over the 81k cells to a few ms.
import { staticBoxes, POSTS, DOCK_BAY } from './level_spec.js';
import { WORLD, worldFootprints } from './world_spec.js';

const CELL = 0.1, NX = Math.round((WORLD.x1 - WORLD.x0) / CELL), NZ = Math.round((WORLD.z1 - WORLD.z0) / CELL), R = 0.5;
const ix = (x) => Math.floor((x - WORLD.x0) / CELL), iz = (z) => Math.floor((z - WORLD.z0) / CELL);
export const GRID = { CELL, NX, NZ, R };
/** footprints: { x, z, hx, hz, yaw (rad) } boxes: the hall's fixed obstacles and the world's */
export function fixedFootprints(doorOpen = true) {
  const F = [];
  for (const [x, y, z, hx, hy, hz, kind] of staticBoxes()) if (kind !== 'floor' && kind !== 'step' && kind !== 'landing' && kind !== 'lintel') F.push({ x, z, hx, hz, yaw: 0 });
  F.push({ x: -7.5, z: -4.4, hx: 0.5, hz: 1.7, yaw: 0 });   // the stairs and the landing: off the floor route (reached by the ramp)
  for (const [x, z, r] of POSTS) F.push({ x, z, hx: r, hz: r, yaw: 0 });
  const D = DOCK_BAY;
  for (const [x, z, hx, , hz] of D.guides) F.push({ x, z, hx, hz, yaw: 0 });
  for (const [x, z] of D.posts) F.push({ x, z, hx: 0.06, hz: 0.06, yaw: 0 });
  F.push({ x: D.stand.x, z: D.stand.z, hx: D.stand.hx, hz: D.stand.hz, yaw: 0 }, { x: D.gantry.post[0], z: D.gantry.post[1], hx: 0.08, hz: 0.08, yaw: 0 });
  if (!doorOpen) F.push({ x: D.door.x, z: D.door.z, hx: D.door.hx, hz: 0.03, yaw: 0 });
  F.push(...worldFootprints());
  return F;
}
let FIXED = null;   // the last footprints' grid (one pathCheck stamps its list once and its extra on a copy)
function stamp(g, foot) {
  for (const f of foot) {
    const c = Math.cos(f.yaw || 0), s = Math.sin(f.yaw || 0), ex = Math.abs(f.hx * c) + Math.abs(f.hz * s) + R, ez = Math.abs(f.hx * s) + Math.abs(f.hz * c) + R;
    for (let i = Math.max(0, ix(f.x - ex)); i <= Math.min(NX - 1, ix(f.x + ex)); i++) for (let k = Math.max(0, iz(f.z - ez)); k <= Math.min(NZ - 1, iz(f.z + ez)); k++) {
      const px = (i + 0.5) * CELL + WORLD.x0 - f.x, pz = (k + 0.5) * CELL + WORLD.z0 - f.z, lx = px * c - pz * s, lz = px * s + pz * c;   // into the box's frame
      const dx = Math.max(0, Math.abs(lx) - f.hx), dz = Math.max(0, Math.abs(lz) - f.hz);
      if (dx * dx + dz * dz <= R * R) g[k * NX + i] = 1;
    }
  }
}
function grid(foot) {
  // the world's boundary, grown; then every footprint
  const g = new Uint8Array(NX * NZ), m = Math.ceil(R / CELL);
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) if (i < m || k < m || i >= NX - m || k >= NZ - m) g[k * NX + i] = 1;
  stamp(g, foot);
  return g;
}
/** the grid for `footprints` (the fixed ones, possibly with movable ones after them) plus `extra` */
function gridFor(footprints, extra = []) {
  if (!FIXED || FIXED.arr !== footprints || FIXED.n !== footprints.length) FIXED = { arr: footprints, n: footprints.length, g: grid(footprints) };
  if (!extra.length) return FIXED.g;
  const g = FIXED.g.slice(); stamp(g, extra); return g;
}
function dijkstra(g, from) {
  const N = NX * NZ, dist = new Float64Array(N).fill(Infinity);
  let hk = new Float64Array(4096), hn = new Int32Array(4096), size = 0;
  const push = (d, n) => {
    if (size === hk.length) { const k2 = new Float64Array(size * 2), n2 = new Int32Array(size * 2); k2.set(hk); n2.set(hn); hk = k2; hn = n2; }
    let i = size++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= d) break; hk[i] = hk[p]; hn[i] = hn[p]; i = p; } hk[i] = d; hn[i] = n;
  };
  const s = iz(from.z) * NX + ix(from.x); if (s < 0 || s >= N) return dist;
  dist[s] = 0; push(0, s);
  const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (size) {
    const d = hk[0], n = hn[0]; size--;
    if (size) {   // sift the last one down from the top
      const lk = hk[size], ln = hn[size]; let i = 0;
      for (;;) { const l = 2 * i + 1; if (l >= size) break; const r = l + 1, c = r < size && hk[r] < hk[l] ? r : l; if (hk[c] >= lk) break; hk[i] = hk[c]; hn[i] = hn[c]; i = c; }
      hk[i] = lk; hn[i] = ln;
    }
    if (d > dist[n]) continue;
    const i = n % NX, k = (n / NX) | 0;
    for (const [di, dk, w] of D8) {
      const a = i + di, b = k + dk; if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
      const m = b * NX + a; if (g[m] && m !== s) continue;
      const nd = d + w * CELL; if (nd < dist[m]) { dist[m] = nd; push(nd, m); }
    }
  }
  return dist;
}
/** the nearest free cell's distance to a point (an objective may sit against an obstacle: take the best cell within 0.8 m) */
function at(dist, g, p) { let best = Infinity; for (let i = ix(p.x - 0.8); i <= ix(p.x + 0.8); i++) for (let k = iz(p.z - 0.8); k <= iz(p.z + 0.8); k++) { if (i < 0 || k < 0 || i >= NX || k >= NZ) continue; const m = k * NX + i; if (!g[m] && dist[m] < best) best = dist[m]; } return best; }
/** would adding `extra` footprints keep every objective reachable from a01? -> { ok, detour (m, the worst), lost: [names] } */
export function pathCheck({ from, objectives, footprints, extra }) {
  const g0 = gridFor(footprints), g1 = gridFor(footprints, extra);
  const d0 = dijkstra(g0, from), d1 = dijkstra(g1, from);
  let detour = 0; const lost = [];
  for (const o of objectives) {
    const a = at(d0, g0, o), b = at(d1, g1, o);
    if (!Number.isFinite(a)) continue;   // already out of reach without it: not this barricade's doing
    if (!Number.isFinite(b)) { lost.push(o.name); continue; }
    detour = Math.max(detour, b - a);
  }
  return { ok: lost.length === 0, detour, lost };
}
/** the route length from a01 to each point (Infinity where none): the tests' cross-quadrant checks */
export function routeLengths({ from, points, footprints }) { const g = gridFor(footprints), d = dijkstra(g, from); return points.map((p) => at(d, g, p)); }
/** is a point's cell free for the trolley's centre (outside every grown footprint)? */
export function freeAt(footprints, x, z) { const g = gridFor(footprints), i = ix(x), k = iz(z); return i >= 0 && k >= 0 && i < NX && k < NZ && !g[k * NX + i]; }
export const BARRICADE_FOOT = { hx: 0.156, hz: 0.668 };
