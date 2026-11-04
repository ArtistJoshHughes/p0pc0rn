// level_spec.js - Level 1, the trolley's tutorial room: every solid thing in it (the physics and the drawing both read this), the
// wheeled ramp, and the zones the tutorial watches. Pure data and maths. The game's frame: metres, y up, x east, z south; the trolley
// starts facing east (+x). The room is 16 x 12 m inside, with 0.2 m walls and a 0.2 m floor slab.

import { WORLD_SPAWNS } from './world_spec.js';

export const ROOM = { hx: 8, hz: 6, wall: 0.2, height: 2.6, floor: 0.2 };

// the staircase, in the north-west corner: 4 risers of 17.5 cm and 28 cm treads up to a 0.7 m landing (1.8 x 1.9 m) against the
// west and north walls; the stairs come down southwards along the west wall; a rail guards the landing's open south edge; its east
// face is where the ramp docks
export const STAIRS = { rise: 0.175, tread: 0.28, steps: 4, width: 1.0, x0: -8, x1: -7.0 };
export const LANDING = { x0: -8, x1: -6.2, z0: -6, z1: -4.1, top: 0.7 };
export const RAIL = { x0: -7.0, x1: -6.6, z: -4.1, height: 0.9, thick: 0.05 };   // stops 40 cm short of the east edge: the ramp's lip slides past it

// the hall's two doorways out to its yard and the world round it (world_spec.js): one in the south wall, one in the east wall, 2 m
// high under a lintel. Both are kept off every approach the desk's wall checks drive (the east wall at z -4.3..-0.8, the west wall,
// the north wall) and off the tutorial's route: the south door sits between the third slalom post and the dead end's corridor, the
// east door between the arm kit's crate and the drum by the crab bay.
export const DOORS = [{ wall: 'S', a0: 1.9, a1: 3.5, h: 2.0 }, { wall: 'E', a0: 0.2, a1: 1.8, h: 2.0 }];

// static boxes: [cx, cy, cz, hx, hy, hz, kind]; kinds pick a material in the drawing ('lintel': the wall over a door)
export function staticBoxes() {
  const { hx, hz, wall, height, floor } = ROOM, B = [];
  B.push([0, -floor / 2, 0, hx + wall, floor / 2, hz + wall, 'floor']);
  // a wall from a0 to a1 along its length, split round its doors (a lintel over each)
  const wallRun = (side, a0, a1) => {
    const doors = DOORS.filter((d) => d.wall === side).sort((p, q) => p.a0 - q.a0), put = (u0, u1, y0, y1, kind) => {
      const c = (u0 + u1) / 2, h = (u1 - u0) / 2, cy = (y0 + y1) / 2, hy = (y1 - y0) / 2;
      if (side === 'E') B.push([hx + wall / 2, cy, c, wall / 2, hy, h, kind]); else if (side === 'W') B.push([-hx - wall / 2, cy, c, wall / 2, hy, h, kind]);
      else B.push([c, cy, side === 'S' ? hz + wall / 2 : -hz - wall / 2, h, hy, wall / 2, kind]);
    };
    let s = a0;
    for (const d of doors) { put(s, d.a0, 0, height, 'wall'); put(d.a0, d.a1, d.h, height, 'lintel'); s = d.a1; }
    put(s, a1, 0, height, 'wall');
  };
  wallRun('E', -hz - wall, hz + wall); wallRun('W', -hz - wall, hz + wall); wallRun('S', -hx, hx); wallRun('N', -hx, hx);
  // the landing
  const L = LANDING;
  B.push([(L.x0 + L.x1) / 2, L.top / 2, (L.z0 + L.z1) / 2, (L.x1 - L.x0) / 2, L.top / 2, (L.z1 - L.z0) / 2, 'landing']);
  // the steps: step k (1..3) is a block from the landing's south face out to its nosing, k risers high
  const S = STAIRS;
  for (let k = 1; k < S.steps; k++) {
    const depth = (S.steps - k) * S.tread, top = k * S.rise;
    B.push([(S.x0 + S.x1) / 2, top / 2, L.z1 + depth / 2, (S.x1 - S.x0) / 2, top / 2, depth / 2, 'step']);
  }
  // the rail along the landing's open south edge (east of the stairs): one solid guard for the physics (the drawing adds balusters)
  B.push([(RAIL.x0 + RAIL.x1) / 2, L.top + RAIL.height / 2, RAIL.z + RAIL.thick / 2, (RAIL.x1 - RAIL.x0) / 2, RAIL.height / 2, RAIL.thick / 2, 'rail']);
  // the dead end: a partition wall that makes a 1.6 m wide corridor along the south wall at the east end (a01 needs 1.32 m to spin)
  B.push([5.8, 0.5, 4.3, 2.2, 0.5, 0.1, 'partition']);
  // the crab bay north of the partition: two short side walls
  B.push([5.25, 0.2, 3.6, 0.05, 0.2, 0.5, 'curb']);
  B.push([6.95, 0.2, 3.6, 0.05, 0.2, 0.5, 'curb']);
  return B;
}

// slalom posts (bollards): [x, z, radius, height]
export const POSTS = [[-2.9, 4.6, 0.12, 0.9], [-0.6, 4.6, 0.12, 0.9], [1.7, 4.6, 0.12, 0.9]];

// the 3 cm cable cover, running north-south: a ramped strip (trapezoid section 0.50 wide at the floor, 0.12 at the top: 9° ramps)
export const CABLE = { x: 2.5, z0: -2.2, z1: 3.4, h: 0.03, bottom: 0.50, top: 0.12 };

// the wheeled ramp: a 15° wedge (2.612 m long for 0.71 m) on four casters, 1.2 m wide, with low side curbs and a lip plate at its high
// end that overhangs the landing when it is docked. Local frame: x from the toe (0) to the high end (len), y up, z across.
export const RAMP = {
  len: 0.7 / Math.tan(15 * Math.PI / 180), rise: 0.712, width: 1.2, gap: 0.015, mass: 45, lip: 0.30, curb: 0.04,
  // where it starts: high end 10 cm short of the landing's east face, 3 m south of where it docks, turned 4°
  start: { highX: -6.1, z: -2.9, yawDeg: 4 },
};
// the ramp is docked (its casters lock) when its high end is within 25 cm of the landing's face (its 30 cm lip plate then lies over
// the landing), square to it within 6° and wholly along it (both high corners inside the landing's north-south span)
export const DOCK = { gap: 0.25, angleDeg: 6 };

// where the tutorial's beats happen
export const START = { x: -5.9, z: 4.6, yawDeg: 0 };
export const ZONES = {
  line: { x: -4.5, z0: 3.4, z1: 6 },
  gates: [ { x0: -3.15, x1: -2.65, z0: 3.0, z1: 4.45, side: 'north' }, { x0: -0.85, x1: -0.35, z0: 4.75, z1: 6.0, side: 'south' }, { x0: 1.45, x1: 1.95, z0: 3.0, z1: 4.45, side: 'north' } ],
  deadEnd: { x0: 5.4, x1: 8, z0: 4.4, z1: 6 },
  bay: { x0: 5.6, x1: 6.6, z0: 3.3, z1: 4.05 },
  bayStand: { x: 6.1, z: 2.3 },
  cableDone: { xMax: 2.0 },
  stop: { x0: -1.8, x1: 0.8, z0: 0.6, z1: 3.6 },
};

// ---------------------------------------------------------------------------------------------------- v2: the dock, the arm, the trash
// THE DOCK (north-east corner): a 1.3 m bay against the north wall, entered nose first from the south. Parked in it (chassis centre in
// `park`, facing north within `yawDeg`, under 0.05 m/s) the trolley may change its parts (the slot menu) and charges. A gantry over the
// bay carries a hoist that lifts the bin off the deck pocket onto the stand east of the bay and back. A roller shutter closes the bay.
export const DOCK_BAY = {
  x0: 4.95, x1: 6.25, z0: -6.0, z1: -4.0,
  // parked here the stowed arm (1.13 m ahead of the trolley's centre) clears the north wall by 12 cm and the tail clears the shutter
  park: { x: 5.6, z: -4.75, dx: 0.3, dz: 0.35, yawDeg: 90, yawTol: 20 },   // forgiving: the hoist lines itself up with the trolley
  guides: [[4.85, -5.075, 0.05, 0.175, 0.975], [6.35, -5.075, 0.05, 0.175, 0.975]],   // [x, z, hx, hy, hz]: low guide walls either side
  door: { x: 5.6, z: -4.02, hx: 0.68, hy: 0.72, hz: 0.025, lift: 1.55, speed: 0.7 },  // the shutter: a slab that rolls up into its header
  posts: [[4.85, -4.02], [6.35, -4.02]], postH: 1.62,
  stand: { x: 7.2, z: -4.75, hx: 0.597, hy: 0.0606, hz: 0.4523 },                    // the bin's stand: a wooden pallet (12 cm)
  gantry: { y: 2.35, z: -4.75, x0: 4.6, x1: 7.98, post: [4.62, -4.75] },
  charger: { x: 5.6, z: -4.75 },
};
// THE ARM KIT: the grab arm folded in a 0.62 x 0.40 x 0.30 m crate (12 kg), north of the crab bay. Touch it with the trolley to carry it.
export const ARM_KIT = { x: 6.1, z: 0.9, yawDeg: 0, size: [0.62, 0.40, 0.30], mass: 12 };
// THE TRASH: [kind, x, z, yawDeg]. Kinds are in items_spec.js. The diesel can stands upright; knocked over or dropped outside the bin it
// leaves a slick patch on the floor for the rest of the run.
export const TRASH = [
  ['soda', 3.9, -3.0, 0], ['beer', 4.1, -2.1, 60], ['tin', 4.6, -1.2, 0], ['water', 6.6, -2.4, 90], ['carton', 3.3, -0.4, 30], ['diesel', 3.4, -4.4, 90],
];
// where the trash director (and Juli) may drop a new piece later (clear floor, away from the route's tight spots): the hall's S1-S8,
// then the world's (world_spec.js: Y yard, P park, M metro, F forest). SPAWN_NAMES[i] names TRASH_SPAWNS[i].
export const HALL_SPAWNS = 8;
export const TRASH_SPAWNS = [[3.6, -2.2], [4.6, -3.6], [6.6, -1.4], [3.2, -1.1], [7.0, -3.4], [-2.5, -2.4], [0.4, -3.6], [-4.0, 0.6], ...Object.values(WORLD_SPAWNS)];
export const SPAWN_NAMES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', ...Object.keys(WORLD_SPAWNS)];
// a spare battery to pick up (it tops the pack up), and the set dressing (pushable): [kind, x, z, yawDeg]
export const BATTERY_PICKUPS = [[-3.4, -3.3]];
export const DRESSING_AT = [['drum', -7.5, 5.5, 0], ['drum', 7.5, 2.15, 40], ['bigbox', -7.4, 2.85, 12]];
