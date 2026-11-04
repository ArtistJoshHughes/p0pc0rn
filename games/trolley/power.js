// power.js - a01's battery: what each part draws, how big the pack is at each tier, the dock's charger, and limp mode. Pure data and
// maths (the physics in sim.js calls draw() once a step with what the motors are doing).
//
// What draws power (watts):
//  - the electronics and sensors, always: IDLE;
//  - each hub motor: its mechanical power |torque x speed| over its efficiency, plus its copper loss k·torque² (a direct-drive hub motor
//    holding 20 N·m at a standstill still burns about 48 W), plus the tyres' rolling resistance (Crr x weight x speed: the physics has
//    no rolling resistance, the battery does; mud raises it: crrMud x the share of tyres in mud);
//  - the steering servos while they swing;
//  - the grab arm's five servos the same way as the hub motors (geared joints: a much smaller copper term);
//  - a tyre in a cadmium puddle: puddleW (the sludge in its hub seals).
// (The physics' own mud and puddle drag, sim.js, already costs the hub motors more torque; these are the losses it does not model.)
// Skid-steering is costly (four tyres scrubbing at 20 N·m: about 570 W while DRIVE turns), so ordinary play (driving, turning, pausing,
// a crab; 0.38 m/s on average) draws about 270 W. A full Mk I pack (125 Wh) lasts about 27 minutes of it (measured in the tests). The
// dock's charger fills an empty Mk I pack in 30 s.
//
// LIMP MODE: a third of the speed (DRIVE 0.4 m/s, CRAB and SPIN at 40 %), the arm parked. Where it starts is the battery's limp line:
//  - in the tutorial (the default): at 0 %. The trolley never soft-locks there: the last of the pack is a protected reserve that only the
//    hub motors may use, enough to crawl back to the dock. It ends once the dock has charged the pack back to 5 %;
//  - in the open world (survival.js sets b.limpAt and b.limpExit from survival_rules.js BATTERY): under 10 %, on real charge (the
//    crawl drains the pack: at 0 % a01 dies). It ends at 12 % (a margin, so that the sun on the panels does not flick it on and off).

export const TIERS = [
  { id: 'mk1', name: 'Mk I cells', capacity: 450000, cost: 0 },          // joules (125 Wh)
  { id: 'mk2', name: 'Mk II cells', capacity: 450000 * 1.5, cost: 40 },  // +50 %
  { id: 'mk3', name: 'Mk III cells', capacity: 450000 * 2.2, cost: 100 }, // +120 %
];
export const POWER = {
  idle: 18,                 // W: computers, lidar, lights
  hubEff: 0.85, hubCopper: 0.12, crr: 0.02, crrMud: 0.09, puddleW: 160,
  steer: 16,                // W per module while it swings
  armEff: 0.8, armCopper: 0.0016,
  charger: 450000 / 30,     // W: an empty Mk I pack in 30 s
  limpScale: 0.33, limpOther: 0.4, limpExit: 0.05,
  maxW: 2500,               // W: the pack's fuse. Four hub motors at their torque cap and the arm draw under 2 kW; a solver blow-up
                            // (its bodies' speeds running away for a step) must not empty the pack (in the open world 0 % is death)
};

/** a battery at tier i: { tier, cap (J), e (J), limp } */
export function battery(tier = 0, frac = 1) {
  const T = TIERS[Math.max(0, Math.min(TIERS.length - 1, tier | 0))];
  return { tier: TIERS.indexOf(T), cap: T.capacity, e: T.capacity * Math.max(0, Math.min(1, frac)), limp: false, watts: 0, avg: 0, charging: false };
}

/** the hub motors', the servos' and the arm's draw for one step. wheels: [{ tau, omega }], speed: the chassis' speed (m/s), mass (kg),
 *  steering: modules swinging, arm: [{ tau, omega }], mud / puddle: the share of tyres in mud / in a puddle (0-1) -> watts */
export function drawWatts({ wheels = [], speed = 0, mass = 143, steering = 0, arm = [], mud = 0, puddle = 0 }) {
  const P = POWER;
  let w = P.idle + (P.crr + P.crrMud * mud) * mass * 9.81 * Math.abs(speed) + P.steer * steering + P.puddleW * 4 * puddle;
  for (const m of wheels) w += Math.abs(m.tau * m.omega) / P.hubEff + P.hubCopper * m.tau * m.tau;
  for (const j of arm) w += Math.abs(j.tau * j.omega) / P.armEff + P.armCopper * j.tau * j.tau;
  return w;
}

/** advance the battery by dt: drain `watts`, or charge from the dock (charging = true). Limp starts at empty and ends at limpExit. */
export function stepBattery(b, watts, dt, charging = false) {
  watts = Number.isFinite(watts) ? Math.min(Math.max(0, watts), POWER.maxW) : 0;
  b.watts = watts; b.charging = !!charging;
  b.avg += (watts - b.avg) * Math.min(1, dt / 4);
  if (charging) b.e = Math.min(b.cap, b.e + Math.max(0, POWER.charger - watts) * dt);   // the charger also carries what a01 draws meanwhile
  else b.e = Math.max(0, b.e - watts * dt);
  return limpCheck(b);
}
/** the battery's limp line (J): limp starts at or under `at` (0 % unless b.limpAt says otherwise) and ends at `exit` */
export function limpLine(b) { const at = (b.limpAt || 0) * b.cap; return { at, exit: Math.max(b.limpExit || POWER.limpExit, b.limpAt || 0) * b.cap }; }
export function limpCheck(b) {
  const L = limpLine(b);
  if (!b.limp && (b.e <= 0 || b.e < L.at)) b.limp = true;
  else if (b.limp && b.e > 0 && b.e >= L.exit) b.limp = false;
  return b;
}
/** why the arm will not move in limp mode */
export const limpWhy = (b) => (b.limpAt ? `battery under ${Math.round(b.limpAt * 100)} %: the arm stays parked` : 'battery empty: the arm stays parked');
export const fraction = (b) => (b.cap > 0 ? b.e / b.cap : 0);
/** minutes left at the recent average draw */
export const minutesLeft = (b) => (b.avg > 1 ? b.e / b.avg / 60 : Infinity);
