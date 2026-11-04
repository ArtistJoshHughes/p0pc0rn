// tutorial.js - Level 1's beats: one short hint each, where to go next (the waypoint ring), where a reset puts the trolley, and what
// finishes the beat (read from the physics, never assumed). The level itself ends only on the objective: the trolley at rest on the
// landing at the top of the stairs, all four tyres on it, under 0.05 m/s for 1 s (sim.js) - whatever beat the tutorial is on.
// v2 adds: pick up the grab arm kit, dock, mount the arm (slot 2), grab trash into the bin, and the diesel can's danger.
import { ZONES, CABLE, LANDING, START, RAMP, ARM_KIT, DOCK_BAY, TRASH } from './level_spec.js';

const DEG = Math.PI / 180;
const inRect = (p, r) => p[0] >= r.x0 && p[0] <= r.x1 && p[2] >= r.z0 && p[2] <= r.z1;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const armIn = (s) => s.v2 && (s.v2.arm.state === 'carried' || s.v2.arm.state === 'mounted' || s.v2.arm.state === 'rack');
const banked = (s, kind) => !!(s.v2 && s.v2.items.some((i) => i.banked && (kind ? i.kind === kind : i.kind !== 'diesel')));
const diesel = (s) => s.v2 && s.v2.items.find((i) => i.kind === 'diesel');
const trashAt = (kind) => { const t = TRASH.find((x) => x[0] === kind); return t ? { x: t[1], z: t[2] } : null; };
const PK = DOCK_BAY.park;

export const BEATS = [
  { id: 'boot', hint: 'a01 is booting. Its steering modules run a quick self-test.', spawn: { x: START.x, z: START.z, yawDeg: 0 }, wp: () => null },
  { id: 'line', hint: 'Push the stick up to drive to the yellow line.', spawn: { x: START.x, z: START.z, yawDeg: 0 }, wp: () => ({ x: ZONES.line.x + 0.4, z: 4.6 }),
    check: (s) => s.pos[0] > ZONES.line.x + 0.35 },
  { id: 'slalom', hint: 'Weave through the posts: left of the first, right of the second, left of the third. Push the stick sideways to turn.',
    spawn: { x: ZONES.line.x + 0.5, z: 4.6, yawDeg: 0 }, wp: (s, k) => { const g = ZONES.gates[Math.min(k.gate || 0, 2)]; return { x: (g.x0 + g.x1) / 2, z: (g.z0 + g.z1) / 2 }; },
    check: (s, k) => { const g = ZONES.gates[k.gate || 0]; if (g && inRect(s.pos, g)) k.gate = (k.gate || 0) + 1; return (k.gate || 0) >= ZONES.gates.length; } },
  { id: 'deadend', hint: 'Into the dead end. There is no room to turn: tap SPIN, then turn round with the stick.', spawn: { x: 3.0, z: 5.2, yawDeg: 0 },
    wp: (s) => (inRect(s.pos, ZONES.deadEnd) ? null : { x: 6.8, z: 5.2 }),
    check: (s, k) => {
      if (!inRect(s.pos, ZONES.deadEnd)) { k.last = null; return false; }
      if (s.mode === 'spin' && k.last != null) k.turned = (k.turned || 0) + Math.abs(wrap(s.yaw - k.last));
      k.last = s.yaw; return (k.turned || 0) >= 150 * DEG;
    } },
  { id: 'bay', hint: 'Tap DRIVE and stop beside the bay. Then tap CRAB and slide in sideways.', spawn: { x: 4.2, z: 2.3, yawDeg: 0 },
    wp: (s) => { const b = ZONES.bayStand; return Math.hypot(s.pos[0] - b.x, s.pos[2] - b.z) > 0.7 && s.pos[2] < 3.0 ? { x: b.x, z: b.z } : { x: 6.1, z: 3.6 }; },
    check: (s) => { const y = Math.abs(wrap(s.yaw)) / DEG; return inRect(s.pos, ZONES.bay) && (y < 15 || y > 165) && s.motion.speed < 0.05; } },
  { id: 'armkit', hint: 'A grab arm kit lies north of the bay, under the blue ring. Drive into it: a01 picks it up and carries it.', spawn: { x: 6.1, z: 2.4, yawDeg: 90 },
    wp: () => ({ x: ARM_KIT.x, z: ARM_KIT.z }), skip: (s) => armIn(s), check: (s) => armIn(s) },
  { id: 'dock', hint: 'Take it to the dock in the north-east corner. Its shutter opens as you come; drive in nose first and stop on the charger.',
    spawn: { x: PK.x, z: -2.4, yawDeg: 90 }, wp: () => ({ x: PK.x, z: PK.z }), skip: (s) => !!(s.v2 && s.v2.arm.state === 'mounted'), check: (s) => !!(s.v2 && s.v2.dock.parked) },
  { id: 'mount', hint: 'Parked: the dock opens its slots. Slot 2 is the front tool mount: tap Mount. (Slot 1 lifts the bin off, if you want it off.)',
    spawn: { x: PK.x, z: PK.z, yawDeg: 90 }, wp: () => null, check: (s) => !!(s.v2 && s.v2.arm.state === 'mounted') },
  { id: 'grab', hint: 'Back out and turn to the soda can. Stop with it half a metre to a metre ahead of you and tap GRAB.',
    spawn: { x: 5.3, z: -3.0, yawDeg: 180 }, wp: () => trashAt('soda'), skip: (s) => banked(s), check: (s) => banked(s) },
  { id: 'diesel', hint: 'The red diesel can: knocked over, or dropped outside the bin, it leaves a slick patch for the rest of the run. GRAB it gently into the bin.',
    spawn: { x: 4.6, z: -3.15, yawDeg: 155 }, wp: (s) => { const d = diesel(s); return d && !d.banked && !d.spilled ? trashAt('diesel') : null; },
    check: (s, k, ev, t) => { const d = diesel(s); if (!d) return true; if (d.spilled) { if (k.spillT == null) k.spillT = t; return t - k.spillT > 4; } return d.banked; } },
  { id: 'cable', hint: 'Drive west over the cable cover.', spawn: { x: 4.2, z: -1.9, yawDeg: 180 }, wp: () => ({ x: CABLE.x - 1.0, z: -0.6 }),
    enter: (s, k) => { k.east = s.pos[0] > CABLE.x + 0.4; },
    check: (s, k) => { if (s.pos[0] > CABLE.x + 0.4) k.east = true; return !!k.east && s.pos[0] < ZONES.cableDone.xMax; } },
  { id: 'estop', hint: 'Emergency stop: get up to speed, then press HOLD. Watch the latches swing.', spawn: { x: 1.6, z: 2.3, yawDeg: 180 }, wp: () => ({ x: -0.5, z: 2.1 }),
    check: (s, k, ev) => { if (ev.some((e) => e.type === 'estop')) k.stopped = true; return !!k.stopped && s.motion.speed < 0.05; } },
  { id: 'push', hint: 'Push the ramp: drive into its long side near the tall end, and shove it north to the wall.', spawn: { x: -5.2, z: -0.9, yawDeg: 90 },
    wp: (s) => (s.ramp ? { x: s.ramp.pos[0] - RAMP.len * (2 / 3), z: Math.min(s.ramp.z + 1.0, 5) } : null),
    skip: (s) => !!(s.ramp && s.ramp.locked), check: (s) => !!s.ramp && (s.ramp.locked || s.ramp.z < -4.6) },
  { id: 'lineup', hint: 'Square it to the landing (CRAB helps you line up). Its casters lock when it fits: the light turns green.', spawn: { x: -5.2, z: -2.6, yawDeg: 90 },
    wp: (s) => (s.ramp ? { x: LANDING.x1 + 0.4, z: s.ramp.z } : null), skip: (s) => !!(s.ramp && s.ramp.locked), check: (s) => !!(s.ramp && s.ramp.locked) },
  { id: 'climb', hint: 'Drive up the ramp and stop on the landing, all four wheels on it.', spawn: null, wp: () => ({ x: (LANDING.x0 + LANDING.x1) / 2, y: LANDING.top, z: (LANDING.z0 + LANDING.z1) / 2 }),
    check: (s) => s.done },
];
export const beatIndex = (id) => BEATS.findIndex((b) => b.id === id);
// what the compass calls each step's objective, and the steps that need the bin on the trolley
const NAMES = { line: 'YELLOW LINE', slalom: 'NEXT GATE', deadend: 'DEAD END', bay: 'CRAB BAY', armkit: 'ARM KIT', dock: 'DOCK 01', mount: 'DOCK 01',
  grab: 'SODA CAN', diesel: 'DIESEL CAN', cable: 'CABLE COVER', estop: 'STOP ZONE', push: 'RAMP', lineup: 'LANDING', climb: 'LANDING' };
for (const b of BEATS) b.name = NAMES[b.id] || null;
for (const id of ['grab', 'diesel']) BEATS[beatIndex(id)].needsBin = true;
export const BIN_OFF_HINT = 'Your bin is off. Back into Dock 01 and attach it (slot 1). Anything the claw holds stays in it till then.';
const binOff = (s) => !!(s && s.v2 && s.v2.bin !== 'locked' && s.v2.bin !== 'loose');

export function createTutorial({ onBeat = () => {}, onDone = () => {} } = {}) {
  const T = { i: 0, k: {}, t0: 0, done: false, finished: null };
  function beat() { return BEATS[T.i]; }
  function go(i, s) {
    T.i = Math.min(i, BEATS.length - 1); T.k = {}; T.t0 = null;
    const b = beat(); if (b.enter && s) b.enter(s, T.k);
    onBeat(b, T.i);
  }
  /** call after every physics frame: s = sim.state(), ev = the frame's events, t = seconds since boot */
  function update(s, ev, t) {
    if (T.done) return;
    if (s.done || ev.some((e) => e.type === 'objective')) { T.done = true; T.finished = t; if (beat().id !== 'climb') go(BEATS.length - 1, s); onDone(t); return; }
    const b = beat();
    if (T.t0 == null) T.t0 = t;   // this beat's first frame
    if (b.id === 'boot') { if (t - T.t0 > 2.6 && s.mode === 'drive' && s.want === 'drive' && s.phase === 'ready') go(1, s); return; }
    if (b.needsBin && binOff(s)) { T.k.waitedBin = true; return; }   // paused, never a dead end: the hint sends a01 back to the dock
    if (b.skip && b.skip(s)) { go(T.i + 1, s); return; }
    if (b.check && b.check(s, T.k, ev, t)) go(T.i + 1, s);
  }
  /** the step's hint now (it changes while a step that needs the bin waits for it) */
  function hint(s) { const b = beat(); return b.needsBin && binOff(s) ? BIN_OFF_HINT : b.hint; }
  /** the step's objective for the compass: { name, x, z, y } or null (the dock while a step waits for the bin) */
  function objective(s) {
    if (T.done) return null;
    const b = beat();
    if (b.needsBin && binOff(s)) return { name: 'DOCK 01', x: PK.x, z: PK.z, y: 0 };
    const w = b.wp(s, T.k); return w ? { name: b.name, x: w.x, z: w.z, y: w.y || 0 } : null;
  }
  /** where a reset puts the trolley: the beat's start (for the climb: square in front of the ramp's toe) */
  function spawnFor(s) {
    const b = beat();
    if (b.spawn) return b.spawn;
    const r = s && s.ramp; if (!r) return BEATS[beatIndex('lineup')].spawn;
    const toeX = LANDING.x1 + RAMP.len + 1.0;
    return { x: toeX, z: r.z, yawDeg: 180 };
  }
  return { update, go, spawnFor, hint, objective, get beat() { return beat(); }, get index() { return T.i; }, get count() { return BEATS.length; }, get done() { return T.done; },
    waypoint: (s) => (T.done ? null : beat().wp(s, T.k)), state: T };
}
