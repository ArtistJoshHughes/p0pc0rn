// trolley_spec.js - the equipment trash trolley a01 as rigid bodies: every part's mass, pivot, hinge axis, limits and colliders, from the
// assessment of NVIDIA's SimReady asset (equipment_trash_trolley_a01, CC BY 4.0). Pure data and maths: no three.js, no Rapier.
// The asset is Z up with X forward (USD); the game is Y up (three.js, Rapier). U(x, y, z) turns a USD point into the game's frame:
// x stays forward, USD up (z) becomes y, USD left (+y) becomes -z. A turn about USD +Z is the same turn about the game's +Y, and a turn
// about USD +Y is a turn about the game's -Z. Every figure below is in metres, kilograms and degrees, in USD terms, as measured.

export const U = (x, y, z) => [x, z, -y];
export const DEG = Math.PI / 180;

export const WHEEL_R = 0.0935;          // tyre radius (18.7 cm across)
export const WHEEL_HW = 0.03265;        // half the tyre width (6.5 cm)
export const TORQUE_CAP = 12;           // N·m per hub motor: driving straight, crabbing, pushing
export const TORQUE_PEAK = 20;          // N·m per hub motor: skid turns, SPIN, HOLD (12 cannot skid 143 kg round on rubber: measured)
export const SPEED = { drive: 1.2, crab: 0.6, spin: 60 * DEG, accel: 0.8, brake: 1.5, crabAccel: 0.5, spinAccel: 120 * DEG, steerRate: 150 * DEG, wheelMax: 1.6 };

// collision groups: membership in the high 16 bits, filter in the low 16 (Rapier's InteractionGroups)
// v2: TRASH (the loose trash and the arm kit) meets the world, the trolley's body, tyres, the bin, the arm and other trash; ARM (the grab
// arm on the front mount) meets the world, the bin and the trash only (never the trolley it is mounted on)
export const G = { WORLD: 1, CHASSIS: 2, WHEEL: 4, CLAMP: 8, CRATE: 16, OTHER: 32, TRASH: 64, ARM: 128 };
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const COLLIDE = {
  world: groups(G.WORLD, 0xffff),
  chassis: groups(G.CHASSIS, G.WORLD | G.CRATE | G.TRASH),
  wheel: groups(G.WHEEL, G.WORLD | G.CRATE | G.TRASH),
  clamp: groups(G.CLAMP, G.WORLD | G.CRATE),
  crate: groups(G.CRATE, G.WORLD | G.CHASSIS | G.WHEEL | G.CLAMP | G.TRASH | G.ARM),
  other: groups(G.OTHER, G.WORLD),
  trash: groups(G.TRASH, G.WORLD | G.CHASSIS | G.WHEEL | G.CRATE | G.TRASH | G.ARM),
  arm: groups(G.ARM, G.WORLD | G.CRATE | G.TRASH),
  held: groups(G.TRASH, G.WORLD | G.CHASSIS | G.WHEEL | G.CRATE | G.TRASH),   // an item in the claw: not against the arm that holds it
  none: groups(G.OTHER, 0),
};

/** a box given by its USD min / max corners (in the trolley's frame, reference pose) */
const box = (min, max, extra = {}) => Object.assign({ type: 'box', min, max }, extra);
/** a box given by its centre and half extents relative to a pivot (USD), turned `rotZ` degrees about USD Z */
const lbox = (c, h, rotZ = 0) => ({ type: 'lbox', c, h, rotZ });

// ---------------------------------------------------------------------------------------------------- the chassis (root of the tree)
// 7 cuboids (the spine, two side skirts between the wheels, four corner pods over the wheel wells) + the deck's 4 lips that make the
// crate's pocket (8 mm clear of the crate's base all round). Belly 4.6 cm off the ground. The red light lenses (headlightGlass_01, a
// fixed joint, 0.25 kg) are merged into it.
const CHASSIS = {
  name: 'trolley_01', role: 'chassis', mass: 52.767 + 0.25, pivot: [0, 0, 0], com: [0.0, 0.0, 0.215], size: [0.80, 0.85, 0.33],
  collide: 'chassis', friction: 0.35, restitution: 0.05,
  colliders: [
    box([-0.395, -0.20, 0.046], [0.395, 0.20, 0.36]),            // spine (end grilles included)
    box([-0.17, 0.20, 0.07], [0.17, 0.424, 0.36]),               // side skirt, left
    box([-0.17, -0.424, 0.07], [0.17, -0.20, 0.36]),             // side skirt, right
    box([0.17, 0.20, 0.19], [0.40, 0.424, 0.36]),                // corner pod over the front-left wheel well
    box([0.17, -0.424, 0.19], [0.40, -0.20, 0.36]),
    box([-0.40, 0.20, 0.19], [-0.17, 0.424, 0.36]),
    box([-0.40, -0.424, 0.19], [-0.17, -0.20, 0.36]),
    box([0.330, -0.424, 0.36], [0.40, 0.424, 0.43]),             // the crate pocket's lips (7 cm deep): front, rear, left, right
    box([-0.40, -0.424, 0.36], [-0.330, 0.424, 0.43]),
    box([-0.330, 0.330, 0.36], [0.330, 0.424, 0.43]),
    box([-0.330, -0.424, 0.36], [0.330, -0.330, 0.43]),
  ],
};

// ---------------------------------------------------------------------------------------------------- the crate (loose, no joint)
// 39.8 kg recycling crate sitting in the deck pocket: 4 feet, a base that sits 4 cm deep inside the lips, 4 walls above them. Friction 0.35
// against the deck: it shifts when the trolley brakes harder than about 3.4 m/s².
const CRATE = {
  name: 'trashbox_01', role: 'crate', mass: 39.819, pivot: [0, 0, 0.3605], com: [0, 0, 0.72], size: [0.83, 0.81, 0.70], inertiaScale: 0.85,
  collide: 'crate', friction: 0.35, restitution: 0.05,
  colliders: [
    box([0.10, 0.12, 0.3608], [0.26, 0.30, 0.39]), box([0.10, -0.30, 0.3608], [0.26, -0.12, 0.39]),
    box([-0.26, 0.12, 0.3608], [-0.10, 0.30, 0.39]), box([-0.26, -0.30, 0.3608], [-0.10, -0.12, 0.39]),
    box([-0.322, -0.322, 0.39], [0.322, 0.322, 0.44]),           // base (inside the lips: 4 cm deep)
    box([0.385, -0.405, 0.44], [0.415, 0.405, 1.066]),          // walls
    box([-0.415, -0.405, 0.44], [-0.385, 0.405, 1.066]),
    box([-0.385, 0.375, 0.44], [0.385, 0.405, 1.066]),
    box([-0.385, -0.405, 0.44], [0.385, -0.375, 1.066]),
  ],
};

// ---------------------------------------------------------------------------------------------------- steering modules + wheels
// The hub-motor modules turn about the vertical through their pivot (0 -> 90 one way, each), the tyre spins about its axle (USD Y).
// The tyre's centre sits 6.8 cm outboard of the steering axis, so a module that turns rolls its tyre along (the controller lets it).
const MOD = [
  { id: '01', pivot: [0.3117, -0.3115, 0.1605], lim: [0, 90], wheel: [0.3117, -0.37975, 0.0938], span: [-0.0656, 0.0577], mass: 5.6 },
  { id: '02', pivot: [0.3117, 0.3168, 0.1605], lim: [-90, 0], wheel: [0.3117, 0.38535, 0.0938], span: [-0.0578, 0.0655], mass: 5.591 },
  { id: '03', pivot: [-0.3091, -0.3115, 0.1605], lim: [-90, 0], wheel: [-0.3091, -0.37985, 0.0938], span: [-0.0655, 0.0577], mass: 5.588 },
  { id: '04', pivot: [-0.3091, 0.3168, 0.1605], lim: [0, 90], wheel: [-0.3091, 0.38515, 0.0938], span: [-0.0578, 0.0655], mass: 5.591 },
];
// the three modes' module angles (USD degrees about +Z): DRIVE straight; CRAB at 90 (sideways); SPIN at 45 (each tyre on the circle)
export const MODE_ANGLES = {
  drive: { '01': 0, '02': 0, '03': 0, '04': 0 },
  crab: { '01': 90, '02': -90, '03': -90, '04': 90 },
  spin: { '01': 45, '02': -45, '03': -45, '04': 45 },
};

// ---------------------------------------------------------------------------------------------------- passive parts (hinges, no motor)
// free = the measured free range (the authored end, or the last clear 1° step before the part meets the body: the same numbers as the
// converted model's trolley_parts.json); the joint limit is that range minus 2°
// at each end that stops against something (the rest end, 0, stays where the part rests). Damping on every passive hinge; a light
// return spring (3 N·m/rad) on the latches (locks) and the clamps.
const CLAMP_AABB = {   // local AABB relative to the pivot (USD), from the assessment
  leftClamp_01: [[-0.0729, -0.0101, -0.0098], [0.0101, 0.0197, 0.0098]], leftClamp_02: [[-0.0729, -0.0101, -0.0098], [0.0101, 0.0197, 0.0098]],
  leftClamp_03: [[-0.0101, -0.0101, -0.0098], [0.073, 0.0197, 0.0098]], leftClamp_04: [[-0.0101, -0.0101, -0.0098], [0.073, 0.0197, 0.0098]],
  rightClamp_01: [[-0.0729, -0.0197, -0.0098], [0.0101, 0.0101, 0.0098]], rightClamp_02: [[-0.0729, -0.0197, -0.0098], [0.0101, 0.0101, 0.0098]],
  rightClamp_03: [[-0.0101, -0.0198, -0.0098], [0.073, 0.01, 0.0098]], rightClamp_04: [[-0.0101, -0.0197, -0.0098], [0.073, 0.0101, 0.0098]],
};
const CLAMPS = [
  ['leftClamp_01', [0.3562, -0.3377, 0.3774], [0, 54], 0.322], ['leftClamp_02', [0.3562, 0.2798, 0.3774], [0, 54], 0.287],
  ['leftClamp_03', [-0.3563, -0.3377, 0.3774], [-54, 0], 0.287], ['leftClamp_04', [-0.3563, 0.2798, 0.3774], [-54, 0], 0.287],
  ['rightClamp_01', [0.3562, -0.2801, 0.3774], [-54, 0], 0.287], ['rightClamp_02', [0.3562, 0.3376, 0.3774], [-54, 0], 0.287],
  ['rightClamp_03', [-0.3563, -0.28, 0.3774], [0, 54], 0.287], ['rightClamp_04', [-0.3563, 0.3376, 0.3774], [0, 54], 0.287],
];
const LOCKS = [   // yellow latch levers on the end faces, hinged about USD Y; they droop under gravity against the spring
  ['lock_01', [0.3824, -0.309, 0.3529], [-5.7, 110], 1], ['lock_02', [0.3824, 0.309, 0.3529], [-5.7, 94], 1],
  ['lock_03', [-0.3824, -0.309, 0.3529], [-86, 5.7], -1], ['lock_04', [-0.3824, 0.309, 0.3529], [-86, 5.7], -1],
];
const BRACKETS = [   // corner bumper brackets (link 1), hinged about USD Z on the chassis
  ['stopperJoint_01', [0.3599, -0.3562, 0.2269], [-90, 0], 1], ['stopperJoint_02', [0.3599, 0.3614, 0.2269], [0, 95], 1],
  ['stopperJoint_03', [-0.3578, -0.3562, 0.2269], [0, 99], -1], ['stopperJoint_04', [-0.3578, 0.3615, 0.2269], [-95, 0], -1],
];
const STOPPERS = [   // the rubber bumper arms (link 2), hinged about USD Z on their bracket; their box is the measured oriented box
  ['stopper_01', 'stopperJoint_01', [0.3998, -0.3543, 0.2269], [-45, 142], [-0.0121, -0.0458, 0], 54.4, 0.257],
  ['stopper_02', 'stopperJoint_02', [0.3997, 0.3596, 0.2269], [-111, 49], [-0.0122, 0.046, 0], 125.6, 0.259],
  ['stopper_03', 'stopperJoint_03', [-0.3976, -0.3543, 0.2269], [-111, 44], [0.0121, -0.0456, 0], 125.6, 0.254],
  ['stopper_04', 'stopperJoint_04', [-0.3976, 0.3596, 0.2269], [-49, 110], [0.012, 0.0456, 0], 54.4, 0.255],
];
const MARGIN = 2;
/** the joint limit from a free range: 2° in from each end, except an end at 0 (the part rests there, against its stop) */
export const limitOf = ([a, b]) => [a === 0 ? 0 : a + MARGIN, b === 0 ? 0 : b - MARGIN];

const aabbBox = ([lo, hi]) => lbox([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2]);

/** every body of the trolley, parent before child; joint = the hinge to the parent */
export function trolleyParts() {
  const P = [Object.assign({ parent: null, joint: null }, CHASSIS), Object.assign({ parent: null, joint: null }, CRATE)];
  for (const m of MOD) {
    const hub = [m.wheel[0] - m.pivot[0], (m.span[0] + m.span[1]) / 2, m.wheel[2] - m.pivot[2]];
    P.push({ name: 'wheelEngine_' + m.id, role: 'module', mass: m.mass, pivot: m.pivot, com: [m.pivot[0], m.pivot[1] + hub[1], m.pivot[2] - 0.055], size: [0.135, 0.123, 0.135],
      collide: 'other', friction: 0.5, restitution: 0.05, parent: 'trolley_01', id: m.id,
      joint: { axis: 'z', free: m.lim, limit: m.lim, kind: 'steer' },
      colliders: [{ type: 'lcyl', c: hub, r: 0.0675, hw: (m.span[1] - m.span[0]) / 2, axis: 'y' }, lbox([0, hub[1], -0.016], [0.035, (m.span[1] - m.span[0]) / 2 - 0.01, 0.016])] });
    P.push({ name: 'wheel_' + m.id, role: 'wheel', mass: 5.287, pivot: m.wheel, com: m.wheel, cyl: true, collide: 'wheel', friction: 0.6, restitution: 0.05,   // rubber on sealed concrete, low bounce, all four (the asset's wheel_04 material bug is not copied)
      parent: 'wheelEngine_' + m.id, id: m.id, joint: { axis: 'y', free: null, limit: null, kind: 'wheel' },
      colliders: [{ type: 'lcyl', c: [0, 0, 0], r: WHEEL_R, hw: WHEEL_HW, axis: 'y', round: 0.012 }] });
  }
  for (const [name, pivot, free, mass] of CLAMPS) {
    const b = aabbBox(CLAMP_AABB[name]);
    P.push({ name, role: 'clamp', mass, pivot, com: [pivot[0] + b.c[0], pivot[1] + b.c[1], pivot[2] + b.c[2]], size: [b.h[0] * 2, b.h[1] * 2, b.h[2] * 2],
      collide: 'clamp', friction: 0.4, restitution: 0.1, parent: 'trolley_01', joint: { axis: 'z', free, limit: limitOf(free), kind: 'passive', spring: 3, damping: 0.05 },
      colliders: [b] });
  }
  for (const [name, pivot, free, s] of LOCKS) {
    P.push({ name, role: 'lock', mass: 0.649, pivot, com: [pivot[0] + s * 0.0347, pivot[1], pivot[2] - 0.0124], size: [0.11, 0.049, 0.044],
      collide: 'other', friction: 0.4, restitution: 0.1, parent: 'trolley_01', joint: { axis: 'y', free, limit: limitOf(free), kind: 'passive', spring: 3, damping: 0.05 },
      colliders: [lbox([s * 0.044, 0, 0.0028], [0.0558, 0.0244, 0.0088]), lbox([s * 0.0143, 0, -0.019], [0.0258, 0.02, 0.013])] });
  }
  for (const [name, pivot, free, s] of BRACKETS) {
    P.push({ name, role: 'bracket', mass: 0.241, pivot, com: [pivot[0] + s * 0.027, pivot[1], pivot[2]], size: [0.06, 0.025, 0.03],
      collide: 'other', friction: 0.4, restitution: 0.1, parent: 'trolley_01', joint: { axis: 'z', free, limit: limitOf(free), kind: 'passive', spring: 0, damping: 0.03 },
      colliders: [lbox([s * 0.0177, 0.0009, 0], [0.0302, 0.0125, 0.0149])] });
  }
  for (const [name, parent, pivot, free, c, rot, mass] of STOPPERS) {
    P.push({ name, role: 'stopper', mass, pivot, com: [pivot[0] + c[0] * 0.1, pivot[1] + c[1], pivot[2]], size: [0.107, 0.052, 0.055],
      collide: 'other', friction: 0.8, restitution: 0.2, parent, joint: { axis: 'z', free, limit: limitOf(free), kind: 'passive', spring: 0, damping: 0.03 },
      colliders: [lbox(c, [0.0535, 0.0259, 0.0275], rot)] });
  }
  return P;
}

/** the trolley's overall figures, for the README and the tests */
export const FIGURES = { mass: 143.274, size: [0.965, 0.903, 1.066], bellyClear: 0.046, wheelbase: 0.6208, track: 0.765 };
