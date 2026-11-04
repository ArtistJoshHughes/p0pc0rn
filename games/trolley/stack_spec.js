// stack_spec.js - the stacking mini game (early in Level 1: a01 stacks trash on a weigh pad, Juli tries to topple it): the arena in the
// hall's south-west quarter, the target, the hold, the reward, and Juli's four physical tools (their warnings, cooldowns and force caps).
// Pure data and small maths: sim.js builds the bodies from it (buildArena), stack.js runs the rules, stack_view.js draws it.
//
// Where: the clearest floor in the hall once the tutorial is past its first beats (measured: every arena part stays 0.7 m or more
// from every tutorial route and waypoint, Juli's lanes L1-L6, her spawn points S1-S8, the trash, the kit, the dressing, the zones and
// the fixed obstacles; START at (-5.9, 4.6) is 1.7 m from the sweeper's lane). a01 works from the pad's north side.
//
//        N (-z)                     the pad: a weigh plate set flush in the floor (1 mm proud): a01 drives over it, a can rolls onto it
//    stock    a01    stock          the vent: a louvred slot in the floor along the pad's west edge, blowing east and up across the pad
//        [vent|PAD]  <- roller      the roller: a can out of a ceiling chute, rolling in from the east, south-east, south-west or west
//    ==sweeper lane==               the sweeper: a small sweeper bot whose lane runs over the pad's south half and on past its edges
//
// Tuned by measurement: one call against a neat 3-stack of cans (as a01 places them: within 2 mm), its foot anywhere in the pad's middle
// 16-20 cm, tins and sodas mixed: the gust toppled 5 in 10 (the test: 4 in 8), the rattle 4 in 10 (2 in 8), the roller none in 12 (it
// shoves the stack's foot 1-2 cm); the sweeper bulldozes a stack built on the pad's south side off the pad (2 in 10; 3 in 8) and passes
// one on its north side. Against a wobbly stack (cans 8 mm off) the gust took 6 in 10, the rattle 5, the roller 1. So Juli's best
// chance is a well-timed gust or rattle, and a01's best answer a neat stack on the pad's north half.
// Frames: the game's (metres, y up, x east, z south).

const D = Math.PI / 180;
// the plate (a steel plate set in the floor, `thick` m): its top `top` over the floor; its edge bevelled out by `chamfer` over the top
// `bevel` m (it crosses the floor's face 12 mm out), so a can, a tyre or a caster rolls on and off
export const PAD = { x: -5.3, z: 2.6, half: 0.22, top: 0.001, thick: 0.025, bevel: 0.005, chamfer: 0.06, friction: 0.6 };

/** what a01 must do: a stack of `levels` items standing `height` m over the plate, held for `holdS` seconds, inside `timeLimit` s */
export const TARGET = { levels: 3, height: 0.25, holdS: 5, timeLimit: 180 };
export const REWARD = { win: 15 };   // ROMs

/** the floor vent: a louvred slot (len along z, width along x) at the pad's west edge, blowing east and `elev` degrees up. Its gust is
 *  an air jet: the force on a body is the dynamic pressure 1/2 rho u^2 on its cross-section against the jet (times its drag coefficient)
 *  along the jet, at the speed the jet has where the body is (a plane jet: its core `core` m long, then slowing as 1/sqrt(s); a
 *  Gaussian profile `b0` + `spread` x s thick across it). Capped twice: at `bodyCap` N on any one body, and all together at the jet's own
 *  momentum flux (rho u0^2 x the slot's area: what the air carries), so a 143 kg trolley in it feels at most `bodyCap`. A 12.5 m/s
 *  gust (94 Pa) puts about 0.6 N on a can in the jet's core: a lone can stays put, a 3-stack of them may go over. */
export const VENT = {
  x: PAD.x - PAD.half - 0.045, z: PAD.z, len: 0.44, width: 0.07, elev: 35, speed: 12.5, rho: 1.2, core: 0.3, b0: 0.04, spread: 0.12, reach: 1.2,
  cd: { cyl: 1.1, box: 1.05 }, bodyCap: 1.0, rampS: 0.25, holdS: 0.8,
};
export const ventDir = () => [Math.cos(VENT.elev * D), Math.sin(VENT.elev * D), 0];
export const ventFlux = () => VENT.rho * VENT.speed * VENT.speed * VENT.len * VENT.width;   // N: the most the jet can push with, all told

/** the pad's top plate (a kinematic body) rattles like a loose plate on its frame: it shakes `amp` m along a level direction, lifts up
 *  to 2 x `ampV` m, and rocks `rock` degrees about the level axis across the shake (its edges go up and down 7.7 mm, a stack's foot
 *  near the middle 3 mm or less), `hz` times a second, for `seconds` (eased in and out over `ramp` s). Never with a tyre on it. */
export const PLATE = { amp: 0.003, ampV: 0.0015, rock: 2, hz: 14, seconds: 0.8, ramp: 0.1 };

/** the roller: a can lying on its side leaves a ceiling chute's angled mouth `y` m up at `speed` m/s (and the spin of a can rolling at
 *  that speed), the mouth turned towards the stack's foot (or the pad's centre); it falls (hard CCD) for 0.68 s, lands `land` m out and
 *  rolls in. Each lane: the unit direction from the pad's centre to its chute (the chute is as far out as the fall carries the can).
 *  The chute stays shut if a01 is under the fall (`clearFall` m) or low on the roll's line (`clearRoll` m). sim.js caps a throw at 1.5 m/s. */
export const ROLLER = { kinds: ['tin', 'soda'], kind: 'tin', y: 2.3, speed: 1.5, land: 0.45, clearFall: 0.45, clearRoll: 0.35,
  lanes: { east: [1, 0], southeast: [Math.SQRT1_2, Math.SQRT1_2], southwest: [-Math.SQRT1_2, Math.SQRT1_2], west: [-1, 0] } };
/** a lane's chute (x, z), the unit direction it throws (towards the pad's centre) and where its can lands */
export const rollerDrop = (lane) => {
  const d = ROLLER.lanes[lane]; if (!d) return null;
  const fly = ROLLER.speed * Math.sqrt(2 * ROLLER.y / 9.81), r = ROLLER.land + fly;
  return { x: PAD.x + d[0] * r, z: PAD.z + d[1] * r, dir: [-d[0], -d[1]], land: [PAD.x + d[0] * ROLLER.land, PAD.z + d[1] * ROLLER.land] };
};

/** the sweeper bot: a 26 cm disc, 9 cm tall, 3.2 kg, on a lane (z) over the pad's south half (its body reaches 1 cm past the pad's
 *  centre line and 3 cm past its south edge), between two parking spots (x0, x1) clear of the plate. A dynamic body: three low-friction
 *  casters (its wheels roll) under a plastic shell `clear` m up (friction `shell`: what it nudges things with); it drives with a force
 *  (its wheels' traction, capped at `force` N) towards `speed` m/s along the lane, upright. It looks `look` m ahead and stops for a01
 *  and for walls (it never pushes the trolley: its 12 N could not anyway), and after `giveUp` s of waiting it goes back. */
export const SWEEPER = { r: 0.13, h: 0.09, clear: 0.028, mass: 3.2, speed: 0.3, accel: 0.6, force: 12, friction: 0.02, shell: 0.4, look: 0.2, giveUp: 2.5,
  lane: { z: PAD.z + 0.12, x0: PAD.x - 0.85, x1: PAD.x + 0.85 } };

/** Juli's tools: how long each warns (a light and a sound, before anything moves), how long it then cools down, and how long it acts */
export const TOOLS = {
  vent: { warn: 2.0, cooldown: 12, acts: VENT.rampS * 2 + VENT.holdS },
  plate: { warn: 1.6, cooldown: 10, acts: PLATE.seconds },
  roller: { warn: 1.8, cooldown: 12, acts: 3.0 },
  sweeper: { warn: 2.0, cooldown: 16, acts: 9.0 },
};
export const TOOL_NAMES = Object.keys(TOOLS);
export const RULES = {
  gap: 3,          // s after one tool ends before the next may warn (one at a time)
  placeGrace: 1.0, // s after a01 lets go of a placed item: still a01's moment (no tool may fire)
  zone: 2.4,       // m: a01 within this of the pad's centre is "at the pad" (GRAB keeps an item in the claw for stacking)
  settleV: 0.05, settleW: 0.6,   // m/s, rad/s: a stack that moves less than this is standing still
};
export const STACK_JULI = { tick: 7, timeout: 3000, maxTokens: 72, maxSay: 80 };

/** where a01 stands to place (on the pad's north side, facing south); the tutorial's waypoint and the tests' start */
export const APPROACH = { x: PAD.x, z: PAD.z - 1.12, yawDeg: -90 };
/** the stock laid out when the game starts: [kind, x, z, yawDeg] (cans either side of a01's way in) */
export const STOCK = [
  ['tin', PAD.x - 0.95, PAD.z - 0.45, 0], ['soda', PAD.x - 1.2, PAD.z - 0.8, 30], ['tin', PAD.x - 0.9, PAD.z - 1.15, 60],
  ['soda', PAD.x + 0.95, PAD.z - 0.45, 0], ['tin', PAD.x + 1.2, PAD.z - 0.8, 30], ['soda', PAD.x + 0.9, PAD.z - 1.15, 60],
];
/** each tool's warning light (the view draws them; the sweeper's rides on its body): world points */
export const LIGHTS = {
  vent: [VENT.x, 0.02, VENT.z + VENT.len / 2 + 0.05], plate: [PAD.x + PAD.half + 0.04, 0.02, PAD.z - PAD.half - 0.04],
  roller: Object.fromEntries(Object.keys(ROLLER.lanes).map((k) => { const r = rollerDrop(k); return [k, [r.x, 2.45, r.z]]; })),
};

/** the arena's footprints for paths.js (boxes: x, z, hx, hz, yaw): the pad, the vent and the sweeper's whole lane with its parking spots
 *  (the bot may be anywhere on it). All three are flush or low; counted as walls here to be safe. */
export function arenaFootprints() {
  const L = SWEEPER.lane;
  return [{ x: PAD.x, z: PAD.z, hx: PAD.half, hz: PAD.half, yaw: 0 }, { x: VENT.x, z: VENT.z, hx: VENT.width / 2, hz: VENT.len / 2, yaw: 0 },
    { x: (L.x0 + L.x1) / 2, z: L.z, hx: (L.x1 - L.x0) / 2 + SWEEPER.r, hz: SWEEPER.r, yaw: 0 }];
}
/** is a point on the pad's plate (its centre within the plate, plus `m`)? */
export const onPad = (x, z, m = 0) => Math.abs(x - PAD.x) <= PAD.half + m && Math.abs(z - PAD.z) <= PAD.half + m;
