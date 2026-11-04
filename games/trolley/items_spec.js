// items_spec.js - the loose things in Level 1: the trash the grab arm picks up, the pickups and the set dressing. Pure data: each kind's
// size (metres, the model's own bounding box: x, y up, z), mass, friction, its collider and what it is worth in ROMs once it rests in
// the bin. The models are NVIDIA SimReady props (CC BY 4.0, assets/props/, credits in README.md); their colliders follow the converter's
// suggestions, the masses are game masses (part full, not the USD's empty shells). The physics (sim.js) and the drawing (props_view.js)
// both read this. The arm's ring claw closes to 0.11 m inside, so the trash is the size of a can or a bottle.

/** trash: shape 'box' | 'round' (a box with rounded edges) | 'cyl' (upright cylinder: size x = diameter) */
export const TRASH_KINDS = {
  soda: { name: 'Soda can', glb: 'trash_soda_can', size: [0.067, 0.092, 0.067], shape: 'cyl', mass: 0.18, friction: 0.5, restitution: 0.08, roms: 3, ringable: true },
  tin: { name: 'Food tin', glb: 'trash_tin_can', size: [0.080, 0.114, 0.080], shape: 'cyl', mass: 0.3, friction: 0.5, restitution: 0.06, roms: 3, ringable: true },
  water: { name: 'Water bottle', glb: 'trash_water_bottle', size: [0.068, 0.245, 0.068], shape: 'cyl', mass: 0.25, friction: 0.5, restitution: 0.1, roms: 3, ringable: true },
  beer: { name: 'Glass bottle', glb: 'trash_beer_bottle', size: [0.060, 0.222, 0.060], shape: 'cyl', mass: 0.45, friction: 0.4, restitution: 0.1, roms: 4, ringable: true },
  carton: { name: 'Juice carton', glb: 'trash_juice_carton', size: [0.041, 0.105, 0.064], shape: 'box', mass: 0.12, friction: 0.6, restitution: 0.05, roms: 2, ringable: true },
  chips: { name: 'Crisp packet', glb: 'trash_chips_bag', size: [0.169, 0.081, 0.118], shape: 'round', round: 0.02, mass: 0.1, friction: 0.7, restitution: 0.02, roms: 2, ringable: true },
  // a 1 L tin of diesel (1.1 kg full). Delivered safely (into the bin, never spilled) it is worth 25 ROMs; once it has spilled, 5
  diesel: { name: 'Diesel can', glb: 'diesel_can', size: [0.066, 0.209, 0.108], shape: 'round', round: 0.005, mass: 1.1, friction: 0.5, restitution: 0.03, roms: 25, romsSpilled: 5, hazard: 'diesel', ringable: true, cap: 'diesel_cap' },
};
export const TRASH_ORDER = ['soda', 'tin', 'water', 'beer', 'carton', 'chips', 'diesel'];

// the diesel can: knocked over (lying tilted past 60°) or hit hard (its speed jumps 0.9 m/s in one 1/60 s step: about 5.5 g) anywhere but inside
// the bin, it spills (its cap comes off). The patch grows to `radius` over `grow` seconds and stays for the rest of the run. Oil on
// sealed concrete: the tyres' friction there is `friction` (rubber on clean concrete is 0.6).
export const SPILL = { tiltDeg: 60, kick: 0.9, radius: 0.85, start: 0.18, grow: 2.5, friction: 0.08, depth: 0.025 };

// pickups: a spare car battery (12 V, 14 kg) - touch it with the trolley's body and it tops the pack up by `charge` (a fraction)
export const PICKUPS = { battery: { name: 'Spare battery', glb: 'battery', size: [0.19, 0.192, 0.26], mass: 14, charge: 0.35 } };
// set dressing that moves when pushed: rusty steel drums (part full) and a big cardboard box
export const DRESSING = {
  drum: { glb: 'drum_rusty', size: [0.642, 0.868, 0.657], shape: 'drum', radius: 0.321, mass: 40, friction: 0.5 },
  bigbox: { glb: 'trash_cardboard_box', size: [0.514, 0.522, 0.508], shape: 'box', mass: 2.3, friction: 0.6 },
};
// the events module's barrier block: a plastic road barricade (15 kg)
export const BARRICADE = { glb: 'barricade', size: [0.312, 0.83, 1.335], mass: 15 };

export const ROMS = { name: 'ROM', plural: 'ROMs' };
