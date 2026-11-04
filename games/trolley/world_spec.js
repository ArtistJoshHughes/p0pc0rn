// world_spec.js - the tutorial's world round the hall: four quadrants and a plaza where they meet. Pure data and maths (the physics,
// the drawing, Juli's path checks and the events module all read this). The game's frame: metres, y up, x east, z south.
//
//   z -6.2 +--------------------------+-------------------+
//          |  INDUSTRIAL DOCK          |       PARK        |
//          |  the hall (x -8..8,       |  dead grass,      |
//          |  z -6..6, level_spec.js)  |  cracked paths,   |
//          |  + its yard (concrete,    |  a dry fountain   |
//          |  rail tracks, oil)        |                   |
//   z  8.6 +------------------- PLAZA -+-------------------+
//          |  DEAD FOREST              |       METRO       |
//          |  mud, dead trees,         |  asphalt, ruined  |
//          |  cadmium puddles          |  blocks, rubble   |
//   z 19.0 +--------------------------+-------------------+
//        x -8.2                     x 10.6               x 24.0
//
// Sizes: the world is 32.2 x 25.2 m inside its fence (811 m², 4.2x the hall's 192 m²); the quadrants are 13.4-18.8 m a side (the
// dock 18.8 x 14.8 with the hall, the park 13.4 x 14.8, the forest 18.8 x 10.4, the metro 13.4 x 10.4): 11-16 s straight across at
// a01's 1.2 m/s, 25-40 s with the turns, the mud and the obstacles. The plaza (4.8 m square) is where the four corners meet.
// No imports: level_spec.js reads the world's spawn points from here.

export const HALL_OUT = { x0: -8.2, x1: 8.2, z0: -6.2, z1: 6.2 };   // the hall's outer faces (level_spec.js: 16 x 12 m inside, 0.2 m walls)
export const WORLD = { x0: -8.2, x1: 24.0, z0: -6.2, z1: 19.0, fenceH: 2.2 };
export const CROSS = { x: 10.6, z: 8.6 };   // the four quadrants' common corner (the plaza's centre)
export const PLAZA = { x0: 8.2, x1: 13.0, z0: 6.2, z1: 11.0, x: 10.6, z: 8.6 };
/** the quadrants: id, names, extent, colour (the HUD, the top view's overlay), where its label and its compass bearing point */
export const QUADS = [
  { id: 'dock', name: 'INDUSTRIAL DOCK', short: 'DOCK', x0: -8.2, x1: 10.6, z0: -6.2, z1: 8.6, color: '#38f3ff', at: [0.0, 0.2] },
  { id: 'park', name: 'PARK', short: 'PARK', x0: 10.6, x1: 24.0, z0: -6.2, z1: 8.6, color: '#7dff6a', at: [17.6, 0.8] },
  { id: 'forest', name: 'DEAD FOREST', short: 'FOREST', x0: -8.2, x1: 10.6, z0: 8.6, z1: 19.0, color: '#ffd21f', at: [0.6, 14.0] },
  { id: 'metro', name: 'METRO', short: 'METRO', x0: 10.6, x1: 24.0, z0: 8.6, z1: 19.0, color: '#ff3ea5', at: [17.6, 13.4] },
];
const inR = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
export const inWorld = (x, z, m = 0) => Number.isFinite(x) && Number.isFinite(z) && x > WORLD.x0 + m && x < WORLD.x1 - m && z > WORLD.z0 + m && z < WORLD.z1 - m;
export const inHall = (x, z) => x > HALL_OUT.x0 && x < HALL_OUT.x1 && z > HALL_OUT.z0 && z < HALL_OUT.z1;
/** which quadrant a point is in ('dock' | 'park' | 'forest' | 'metro'), or null outside the world */
export function quadAt(x, z) { if (!inWorld(x, z)) return null; return x < CROSS.x ? (z < CROSS.z ? 'dock' : 'forest') : (z < CROSS.z ? 'park' : 'metro'); }
/** a finer place name: 'hall' | 'yard' | 'plaza' | 'park' | 'forest' | 'metro' (null outside) */
export function areaAt(x, z) {
  if (!inWorld(x, z)) return null;
  if (inHall(x, z)) return 'hall';
  if (inR(PLAZA, x, z)) return 'plaza';
  const q = quadAt(x, z); return q === 'dock' ? 'yard' : q;
}
export const AREA_NAMES = { hall: 'DOCK · HALL', yard: 'DOCK · YARD', plaza: 'PLAZA', park: 'PARK', forest: 'DEAD FOREST', metro: 'METRO' };

// ---------------------------------------------------------------------------------------------------- the ground
// Each kind is its own static floor collider with Rapier friction (rubber on it: the tyres are 0.6). 'min' / 'max' / 'avg' is the
// collider's friction combine rule (Rapier takes the higher-priority rule of the two touching colliders). Mud is real physics:
// lower traction (Rapier's own friction, 0.3), and while a tyre rolls in it a drag force on that tyre opposite its motion
// (rolling resistance crr x its share of the weight, plus a churn term c x its speed: top speed drops by about a third); the battery's
// rolling-resistance term goes up too (power.js: crrMud).
export const GROUND = {
  concrete: { friction: 0.6, rule: 'avg' },                                   // the hall and the yard: sealed concrete
  pavers: { friction: 0.55, rule: 'min' },                                    // the plaza: worn concrete pavers
  grass: { friction: 0.45, rule: 'min' },                                     // the park: dead grass on hard dry soil
  asphalt: { friction: 0.64, rule: 'avg' },                                   // the metro: old asphalt (0.62 with the tyres; 'avg' so a puddle's or oil's 'min' still wins)
  mud: { friction: 0.3, rule: 'min', crr: 0.08, churn: 92 },                   // the forest: crr N/N, churn N·s/m per tyre
};
/** the floor slabs outside the hall (the hall's own is level_spec's 'floor' box, concrete): [kind, x0, x1, z0, z1]; they tile the
 *  world exactly, no overlaps */
export const FLOORS = [
  ['concrete', 8.2, 10.6, -6.2, 6.2], ['concrete', -8.2, 8.2, 6.2, 8.6],           // the yard east and south of the hall
  ['pavers', 8.2, 13.0, 6.2, 11.0],                                                // the plaza
  ['grass', 10.6, 24.0, -6.2, 6.2], ['grass', 13.0, 24.0, 6.2, 8.6],               // the park
  ['mud', -8.2, 8.2, 8.6, 19.0], ['mud', 8.2, 10.6, 11.0, 19.0],                   // the forest
  ['asphalt', 10.6, 13.0, 11.0, 19.0], ['asphalt', 13.0, 24.0, 8.6, 19.0],         // the metro
];
/** the ground kind under a point ('concrete' in the hall), or null outside the world */
export function groundAt(x, z) {
  if (!inWorld(x, z, -0.01)) return null;
  if (inHall(x, z)) return 'concrete';
  for (const [k, x0, x1, z0, z1] of FLOORS) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return k;
  return null;
}

// ---------------------------------------------------------------------------------------------------- slicks: puddles and the yard's oil
// Cadmium-yellow toxic water (mostly in the forest, two in the metro) and one old oil patch in the yard: sensor discs on the floor, the
// same mechanism as the diesel spill (sim.js). A tyre in a puddle gets its friction (Rapier's, combined by the minimum), a drag force
// (the water) and the battery pays a little (power.js: puddleW, the sludge in the hub seals). They are the map's, not the run's: they
// never go away.
export const PUDDLE = { friction: 0.26, crr: 0.02, churn: 30 };   // per tyre in it: N/N, N·s/m (on top of the mud's: a01 crosses at about half speed)
export const OIL = { friction: 0.08 };
export const SLICKS = [
  // [kind, x, z, radius]
  ['puddle', 2.7, 11.1, 0.85], ['puddle', -1.1, 13.7, 1.0], ['puddle', 6.6, 13.3, 0.7], ['puddle', -4.7, 15.9, 0.8], ['puddle', 8.5, 15.4, 0.6],
  ['puddle', -4.4, 10.1, 0.65], ['puddle', 8.0, 12.1, 0.5],
  ['puddle', 16.0, 15.9, 0.7], ['puddle', 21.6, 10.3, 0.6],
  ['oil', -1.6, 7.35, 0.55],
];

// ---------------------------------------------------------------------------------------------------- what stands in the world
// Every static collider outside the hall (the drawing and the path checks read the same list):
//   { t: 'box', x, y, z, hx, hy, hz, yaw (deg), kind }   { t: 'cyl', x, z, r, h, kind } (upright)   { t: 'log', x, z, r, hl, yaw, kind } (lying)
const box = (kind, x, z, hx, hz, h, yaw = 0, y0 = 0) => ({ t: 'box', kind, x, y: y0 + h / 2, z, hx, hy: h / 2, hz, yaw });
const cyl = (kind, x, z, r, h) => ({ t: 'cyl', kind, x, z, r, h });
/** a straight boundary from (x0, z0) to (x1, z1) (axis-aligned), thickness th, height h, with gaps [[a, b], ...] along it */
function run(kind, x0, z0, x1, z1, th, h, gaps = []) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const out = [], cuts = [...gaps].sort((p, q) => p[0] - q[0]); let s = a0;
  for (const [g0, g1] of cuts.concat([[a1, a1]])) {
    if (g0 - s > 0.05) { const m = (s + g0) / 2, hl = (g0 - s) / 2; out.push(alongX ? box(kind, m, z0, hl, th / 2, h) : box(kind, x0, m, th / 2, hl, h)); }
    s = Math.max(s, g1);
  }
  return out;
}
// the gaps that join the quadrants (and the hall's doors, level_spec.js: south x 1.9-3.5, east z 0.2-1.8)
export const GATES = {
  park: [-0.3, 2.3],          // the yard into the park (x 10.6), in line with the hall's east door
  forest: [1.6, 3.8],         // the yard into the forest (z 8.6), in line with the hall's south door
  forestW: [-4.6, -3.0],      // a breach in the forest wall further west
  parkMetro: [18.6, 20.8],    // the park into the metro (z 8.6)
  forestMetro: [14.4, 16.6],  // the forest into the metro (x 10.6)
};
export const BUILDINGS = [   // the metro's blocks: [x0, x1, z0, z1, height, style]  (style: 0 concrete, 1 brick)
  [14.4, 17.6, 12.2, 14.8, 7.2, 0], [20.0, 24.0, 11.8, 14.2, 11.0, 1], [15.8, 18.4, 17.0, 19.0, 9.0, 1], [20.6, 24.0, 16.4, 19.0, 13.0, 0],
];
export const CONTAINERS = [  // shipping containers at the yard's west end: [x, z, hx, hz, height, yaw, colour index] (the second stands on the first)
  [-6.65, 7.35, 1.45, 1.05, 2.4, 0, 1], [-6.65, 7.35, 1.45, 1.05, 2.4, 0, 2],
];
export const FOUNTAIN = { x: 17.6, z: 0.8, r: 1.5, h: 0.55 };
export const PARK_PATHS = { ring: [2.05, 3.15], strips: [[[10.6, 1.0], [14.6, 0.85]], [[13.0, 6.2], [15.95, 2.75]], [[18.3, 3.3], [19.7, 8.6]]], width: 1.2 };   // visual: cracked concrete
export const LAMPS = [[10.35, -0.45], [6.4, 8.25], [12.75, 6.45], [8.45, 10.75], [12.75, 10.75], [13.4, 2.6], [21.6, -0.4], [15.6, 6.1], [14.25, 12.05], [17.95, 15.15], [17.8, 11.6]];
export const RUBBLE = [   // concrete and brick rubble piles: [x, z, hx, hz, h, yaw]
  [16.8, 11.85, 0.75, 0.32, 0.45, 8], [14.0, 16.3, 0.5, 0.35, 0.38, 20], [12.15, 12.6, 0.38, 0.3, 0.32, 35],
];
// ---- the set dressing (NVIDIA SimReady, CC BY 4.0, modified: assets/world/, credits in README.md): each kind's collider box from its
// converter's parts.json (half extents at yaw 0; the model's origin is its bottom centre), whether it has a collider at all, and the
// game's grime shader for the props that keep NVIDIA's own textures ([dirt, rust, scuff]). All static.
export const PROP_KINDS = {
  rack: { glb: 'dock_pallet_rack', h: [2.0, 1.505, 1.033] }, ibc: { glb: 'dock_ibc_tank', h: [0.524, 0.601, 0.628] },
  crate: { glb: 'dock_crate', h: [0.501, 0.508, 0.504], grime: [0.6, 0, 0.3] }, palletJack: { glb: 'dock_pallet_jack', h: [0.34, 0.6, 0.801] },
  forklift: { glb: 'dock_forklift_stacker', h: [0.411, 0.979, 0.943] }, edgeRail: { glb: 'dock_edge_rail', h: [1.581, 0.571, 0.074] },
  hopper: { glb: 'dock_hopper', h: [1.04, 0.648, 0.88], grime: [0.8, 0.8, 0.4] },
  benchSofa: { glb: 'park_bench_sofa', h: [0.512, 0.4245, 1.092] }, armchair: { glb: 'park_armchair', h: [0.354, 0.364, 0.356] },
  coffeeKiosk: { glb: 'park_coffee_kiosk', h: [0.394, 0.915, 0.4055] }, waterCooler: { glb: 'park_water_cooler', h: [0.3035, 1.048, 0.268] },
  parkBin: { glb: 'park_bin_domed', h: [0.236, 0.532, 0.236], cyl: true }, floodlight: { glb: 'park_floodlight', h: [0.281, 0.619, 0.341] },
  carFrame: { glb: 'metro_car_frame', h: [2.465, 0.66, 0.92] }, jersey: { glb: 'metro_jersey_barrier', h: [0.914, 1.018, 0.236] },
  vending: { glb: 'metro_vending_machine', h: [0.463, 0.924, 0.378] }, infoKiosk: { glb: 'metro_info_kiosk', h: [0.203, 0.804, 0.393], grime: [0.7, 0.3, 0.3] },
  cabinet: { glb: 'metro_utility_cabinet', h: [0.76, 2.538, 0.261] }, siren: { glb: 'metro_siren_pole', h: [0.189, 1.8625, 0.368], grime: [0.8, 0.6, 0.3] },
  wheelieBin: { glb: 'metro_wheelie_bin', h: [0.418, 0.587, 0.438] }, hvac: { glb: 'metro_hvac_duct', h: [0.5, 0.305, 0.55] },
  wheelbarrow: { glb: 'forest_wheelbarrow', h: [0.324, 0.361, 0.858], grime: [0.8, 0.9, 0.3] }, pipes: { glb: 'forest_pipe_bundle', h: [0.493, 0.2545, 3.51] },
  board: { glb: 'forest_board_rotten', h: [0.288, 0.0103, 0.116], grime: [1, 0.2, 0.2], noCollider: true },
};
/** where they stand: [kind, x, z, yawDeg, y0 (stacked or sunk)] - kept off every route, gate, spawn point, lane and puddle */
export const PROPS = [
  // the dock yard: a rack, a tote and crates fill the dead-end nook north of the east door; a pallet jack by the hall; a stacker parked
  // on the track; the old dock-edge rail along the south wall; a hopper dumped over the park's railing
  ['rack', 9.43, -4.1, 90], ['ibc', 10.0, -1.45, 0], ['crate', 8.85, -1.55, 6], ['crate', 8.85, -1.55, 12, 1.017], ['palletJack', 8.6, 4.6, 0],
  ['forklift', 6.4, 6.66, 90], ['edgeRail', -2.0, 6.32, 0], ['hopper', 11.75, -5.25, 0],
  // the park: visitor sofas round the dry fountain, dumped armchairs, the coffee kiosk still glowing, a cooler, bins, flood-light towers
  ['benchSofa', 20.9, 3.2, 144], ['benchSofa', 14.3, -1.6, -36], ['benchSofa', 20.9, -1.6, -144], ['armchair', 21.6, 4.6, 200], ['armchair', 12.3, 2.9, 30],
  ['coffeeKiosk', 20.0, -5.55, 0], ['waterCooler', 13.8, 7.6, 180], ['parkBin', 14.0, 2.4, 0], ['parkBin', 21.1, 0.6, 0], ['parkBin', 18.2, -3.4, 0],
  ['floodlight', 22.8, 5.6, 210], ['floodlight', 12.0, -2.0, 40],
  // the metro: a stripped car shell in the west street's dead end, jersey barriers, a vending machine, an info kiosk, a utility
  // cabinet, siren poles, wheelie bins, a fallen duct in the alley
  ['carFrame', 13.3, 18.05, 0], ['jersey', 21.9, 11.5, 0], ['jersey', 23.0, 15.3, 90], ['vending', 18.0, 14.3, 90], ['infoKiosk', 16.6, 9.06, 90],
  ['cabinet', 19.73, 12.6, 90], ['siren', 20.95, 9.05, 0], ['siren', 12.2, 16.6, 0], ['wheelieBin', 15.3, 11.6, 20], ['wheelieBin', 22.0, 15.85, 0],
  ['wheelieBin', 11.2, 14.0, 0], ['hvac', 19.5, 18.2, 20],
  // the forest: an abandoned wheelbarrow, a half-sunk pipe bundle along the fence, rotten boards on the tracks
  ['wheelbarrow', -6.4, 13.6, 30], ['pipes', -1.5, 18.35, 90, -0.12], ['board', 0.8, 12.4, 30], ['board', 4.4, 13.1, 70], ['board', -3.4, 12.0, 10], ['board', 6.8, 14.4, 120],
];
/** the dead-tree kit's pieces (assets/world/dead_tree_kit.glb, by node) for the tree variants (the game's own branch kit, world_view.js, until it loads) */
export const TREE_NODES = { 0: 'tree_dead_tall', 1: 'tree_dead_fork', 2: 'tree_dead_snag', 3: 'tree_dead_snag', 4: 'tree_dead_fork', 5: 'tree_dead_tall' };
export const SIGNPOST = { x: CROSS.x, z: CROSS.z, r: 0.07, h: 2.7 };
export const LOGS = [[-7.3, 16.6, 0.17, 1.2, 75], [5.0, 18.35, 0.15, 1.1, -8], [-7.5, 12.6, 0.16, 0.9, 80]];   // fallen trunks: [x, z, r, half length, yawDeg]
export const STUMPS = [[5.4, 10.85, 0.22], [-2.2, 11.2, 0.2], [9.7, 17.9, 0.24]];
export const DRUMS_STATIC = [[-7.4, 14.2, 20], [-6.8, 10.9, 0], [2.6, 18.5, 60]];   // half sunk in the mud: [x, z, yawDeg] (r 0.32)

// the dead trees: a seeded scatter over the forest and a few big ones in the park, kept off the corridors a01 drives along, the
// puddles, the spawn points and the walls. [x, z, variant (0-3 forest, 4-5 park), scale, yawDeg, trunk radius]
export const FOREST_CORRIDORS = [   // polylines the trees keep 1.3 m from (the routes through the forest)
  [[2.7, 8.6], [2.6, 11.2], [-1.0, 13.6], [-4.6, 15.8], [-6.0, 17.8]], [[2.6, 11.2], [6.4, 13.2], [8.4, 15.4], [10.8, 15.5]],
  [[-3.8, 8.6], [-4.8, 11.0], [-1.0, 13.6]], [[9.4, 11.0], [6.4, 13.2]],
  [[-7.4, 9.7], [8.0, 9.7], [9.4, 11.0]],   // the old track along the wall: ruts, a straight run in the mud
];
const segD = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
export const corridorDist = (x, z, lines = FOREST_CORRIDORS) => { let d = Infinity; for (const L of lines) for (let i = 1; i < L.length; i++) d = Math.min(d, segD([x, z], L[i - 1], L[i])); return d; };
function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------------------------------------------- Juli and the director: spawn points
// The hall's S1-S8 are level_spec's TRASH_SPAWNS; these are the world's, named by where they are (Y yard, P park, M metro, F forest)
export const WORLD_SPAWNS = {
  Y1: [4.2, 7.6], Y2: [9.6, 3.6],
  P1: [13.4, -3.6], P2: [21.6, -3.8], P3: [21.4, 6.0], P4: [14.8, 4.0],
  M1: [16.6, 10.6], M2: [23.0, 9.7], M3: [11.8, 15.2], M4: [18.8, 15.6],
  F1: [-4.9, 11.6], F2: [-2.8, 14.7], F3: [4.6, 12.2], F4: [-5.7, 17.45],
};

function scatterTrees() {
  const r = mulberry(4242), out = [], pts = Object.values(WORLD_SPAWNS);
  const clearOf = (x, z, rad) => {
    if (corridorDist(x, z) < 1.05 + rad) return false;
    for (const [k, px, pz, pr] of SLICKS) if (k === 'puddle' && Math.hypot(x - px, z - pz) < pr + 0.7) return false;
    for (const [px, pz] of pts) if (Math.hypot(x - px, z - pz) < 1.4) return false;
    for (const [lx, lz, lr, hl, ly] of LOGS) { const c = Math.cos(ly * Math.PI / 180) * hl, s = -Math.sin(ly * Math.PI / 180) * hl; if (segD([x, z], [lx - c, lz - s], [lx + c, lz + s]) < lr + rad + 0.45) return false; }
    for (const [sx, sz] of STUMPS.concat(DRUMS_STATIC)) if (Math.hypot(x - sx, z - sz) < 0.85) return false;
    for (const [k, px, pz, py] of PROPS) { if (PROP_KINDS[k].noCollider) continue; const H = PROP_KINDS[k].h, c = Math.cos(py * Math.PI / 180), s2 = Math.sin(py * Math.PI / 180), dx = x - px, dz = z - pz;
      if (Math.abs(dx * c - dz * s2) < H[0] + rad + 0.35 && Math.abs(dx * s2 + dz * c) < H[2] + rad + 0.35) return false; }
    for (const t of out) if (Math.hypot(x - t[0], z - t[1]) < 1.05) return false;
    return true;
  };
  for (const [oz, ox, small] of [[9.45, -7.5, 0], [10.0, -6.9, 1], [9.75, -7.2, 1]]) for (let gz = oz; gz < 18.75; gz += 1.15) for (let gx = ox; gx < 10.3; gx += 1.2) {   // offset passes: the later ones fill the gaps with thinner snags
    const x = gx + (r() - 0.5) * 0.8, z = gz + (r() - 0.5) * 0.7, sc = small ? 0.62 + r() * 0.25 : 0.8 + r() * 0.45, rad = 0.11 + 0.08 * sc, v = Math.floor(r() * 4), yaw = Math.round(r() * 360);
    if (x < -7.7 || x > 10.2 || z < 9.25 || z > 18.65 || (x > 8.0 && z < 11.6) || (x > 9.9 && z > 14.0 && z < 17.0)) continue;   // the walls, the plaza, the metro gap
    if (clearOf(x, z, rad)) out.push([+x.toFixed(2), +z.toFixed(2), v, +sc.toFixed(2), yaw, +rad.toFixed(3)]);
  }
  // the park's few big dead trees, placed by hand off its paths
  for (const [x, z, v, sc, yaw] of [[13.2, -4.9, 4, 1.25, 30], [22.6, -5.0, 5, 1.15, 200], [23.0, 2.2, 4, 1.3, 120], [12.4, 4.4, 5, 1.1, 300], [16.6, 7.4, 4, 1.05, 75], [15.6, -3.3, 5, 0.95, 160], [22.9, 7.6, 5, 0.9, 10]])
    out.push([x, z, v, sc, yaw, +(0.13 + 0.09 * sc).toFixed(3)]);
  return out;
}
export const TREES = scatterTrees();

/** every static collider outside the hall */
export function worldStatics() {
  const S = [], W = WORLD, H = W.fenceH;
  // the outer boundary: chain-link fence (the hall's own north and west walls close the rest)
  S.push(...run('fence', 8.2, W.z0 - 0.05, W.x1 + 0.1, W.z0 - 0.05, 0.1, H));
  S.push(...run('fence', W.x1 + 0.05, W.z0 - 0.1, W.x1 + 0.05, W.z1 + 0.1, 0.1, H));
  S.push(...run('fence', W.x0 - 0.1, W.z1 + 0.05, W.x1 + 0.1, W.z1 + 0.05, 0.1, H));
  S.push(...run('fence', W.x0 - 0.05, HALL_OUT.z1, W.x0 - 0.05, W.z1 + 0.1, 0.1, H));
  // the quadrants' borders: iron railings round the park, ruined brick walls round the forest; the plaza's sides stay open
  S.push(...run('railing', CROSS.x, W.z0, CROSS.x, PLAZA.z0, 0.08, 1.15, [GATES.park]));
  S.push(...run('railing', PLAZA.x1, CROSS.z, W.x1, CROSS.z, 0.08, 1.15, [GATES.parkMetro]));
  S.push(...run('brick', W.x0, CROSS.z, PLAZA.x0, CROSS.z, 0.26, 1.05, [GATES.forest, GATES.forestW]));
  S.push(...run('brick', CROSS.x, PLAZA.z1, CROSS.x, W.z1, 0.26, 1.3, [GATES.forestMetro]));
  for (const [x0, x1, z0, z1, h, style] of BUILDINGS) S.push(Object.assign(box('building', (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, h), { style }));
  CONTAINERS.forEach(([x, z, hx, hz, h, yaw], i) => S.push(box('container', x, z, hx, hz, h, yaw, i === 1 ? CONTAINERS[0][4] : 0)));
  S.push(cyl('fountain', FOUNTAIN.x, FOUNTAIN.z, FOUNTAIN.r, FOUNTAIN.h));
  S.push(cyl('signpost', SIGNPOST.x, SIGNPOST.z, SIGNPOST.r, SIGNPOST.h));
  for (const [x, z] of LAMPS) S.push(cyl('lamp', x, z, 0.075, 3.4));
  for (const [x, z, hx, hz, h, yaw] of RUBBLE) S.push(box('rubble', x, z, hx, hz, h, yaw));
  for (const [k, x, z, yaw, y0 = 0] of PROPS) { const K = PROP_KINDS[k], [hx, hy, hz] = K.h; if (K.noCollider) continue; S.push(K.cyl ? cyl(k, x, z, hx, hy * 2) : box(k, x, z, hx, hz, hy * 2, yaw, Math.max(0, y0))); }
  for (const [x, z, r, hl, yaw] of LOGS) S.push({ t: 'log', kind: 'log', x, z, r, hl, yaw });
  for (const [x, z, r] of STUMPS) S.push(cyl('stump', x, z, r, 0.42));
  for (const [x, z] of DRUMS_STATIC) S.push(cyl('drum', x, z, 0.32, 0.62));
  for (const [x, z, , , , rad] of TREES) S.push(cyl('tree', x, z, rad, 2.2));
  return S;
}
/** 2D footprints of the world's statics for the path checks: { x, z, hx, hz, yaw (rad) } */
export function worldFootprints() {
  return worldStatics().map((s) => s.t === 'box' ? { x: s.x, z: s.z, hx: s.hx, hz: s.hz, yaw: (s.yaw || 0) * Math.PI / 180 }
    : s.t === 'log' ? { x: s.x, z: s.z, hx: s.hl + s.r, hz: s.r, yaw: (s.yaw || 0) * Math.PI / 180 } : { x: s.x, z: s.z, hx: s.r, hz: s.r, yaw: 0 });
}
/** what the chase camera must not pass through outside the hall (2D boxes): the hall itself, the blocks, the containers */
export const CAMERA_BLOCKERS = [HALL_OUT, ...BUILDINGS.map(([x0, x1, z0, z1]) => ({ x0, x1, z0, z1 })), ...CONTAINERS.slice(0, 1).map(([x, z, hx, hz]) => ({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz }))];
/** points every route check keeps reachable (Juli's barricades): one in each quadrant and the plaza */
export const WORLD_OBJECTIVES = [{ name: 'plaza', x: 11.7, z: 7.3 }, { name: 'park', x: 17.6, z: -2.6 }, { name: 'metro', x: 19.0, z: 10.2 }, { name: 'forest', x: -2.8, z: 14.7 }, { name: 'yard', x: 4.2, z: 7.6 }];
