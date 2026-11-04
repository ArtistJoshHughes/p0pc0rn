// sim.js - Level 1's physics: Rapier 3D (the vendored @dimforge/rapier3d-compat), no drawing. The trolley is one multibody tree with the
// chassis as its root (steering modules, tyres, clamps, latches, bumper brackets and arms are its links: reduced coordinates, so a
// 0.24 kg bracket on a 53 kg chassis cannot drift off its hinge). rapier.js gives multibody joints no motors or limits, so each hinge
// also gets a generic impulse joint that locks nothing and carries only that hinge's limit and motor (Rapier's own implicit solver: the
// hub motors' velocity control, the steering servos, the passive hinges' springs and damping). The crate (the bin) sits in the deck
// pocket, held there by a fixed joint while its clamps and latches are closed (v2); open, it is a loose body the dock's hoist can lift
// off. Fixed 1/60 s steps, 8 solver iterations, CCD on the chassis, crate and tyres.
// v2 adds the dock (its hoist and shutter), the grab arm on the front mount, the trash and the diesel can's spills, and the battery.
// v5 (the open world, survival.js) adds: more kinds of loose things (the supplies, addKinds), the arm's GRAB stats (armStats: the
// Tetrabrachion's hands and the Dioscuri Rig's speed), the arm's salvage work (armWork), roller shutters in the hall's two doorways
// (closed during the tutorial, open after it: setHallDoors) and what the bin carries weighing on the trolley (setBinLoad).
// The same module runs in the page (main.js) and in the tests; createSim(RAPIER) -> sim.
import { U, DEG, WHEEL_R, TORQUE_CAP, TORQUE_PEAK, SPEED, COLLIDE, MODE_ANGLES, G, groups, trolleyParts } from './trolley_spec.js';
import { ROOM, staticBoxes, POSTS, CABLE, RAMP, DOCK, LANDING, START, DOCK_BAY, ARM_KIT, BATTERY_PICKUPS, DRESSING_AT, DOORS as HALL_DOORS } from './level_spec.js';
import { TRASH_KINDS, SPILL, PICKUPS, DRESSING, BARRICADE } from './items_spec.js';
import { NODES as ARM_NODES, JOINTS as ARM_JOINTS, JAW, REF, REF_FK, STOW, LIFT, OVER_BIN, REACH, RATE, MOUNT, GRASP_LOCAL, ARM_MASS, solve, qrot as armRot } from './arm_spec.js';
import { battery, drawWatts, stepBattery, fraction, minutesLeft, POWER, limpLine, limpCheck, limpWhy } from './power.js';
import { FLOORS, GROUND, SLICKS, PUDDLE, OIL, worldStatics, groundAt } from './world_spec.js';

export const DT = 1 / 60;
let WHEEL_GAIN = 400;   // N·m·s/rad: the hub motors' speed loop (stiff: a speed-controlled hub motor), capped at TORQUE_CAP
export const setWheelGain = (g) => { WHEEL_GAIN = g; };
const STEER = { k: 400, kHold: 1500, c: 25, max: 40 };   // the steering servos: N·m/rad, N·m·s/rad, N·m
const YAW = { kp: 2.0, ki: 4, iMax: 2.0 };   // DRIVE's yaw-rate loop
export const SUSP = { k: 88000, c: 2400, travel: 0.015 };   // each module's vertical compliance: N/m (4 mm under 351 N), N·s/m, ± m
const AXIS = { z: [0, 1, 0], y: [0, 0, -1] };   // a USD hinge axis, in the game's frame

// ------------------------------------------------------------------------------------------------ small quaternion / vector maths
export const qmul = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
export const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const qrot = (q, v) => {   // rotate [x, y, z] by q
  const [x, y, z] = v, ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
};
export const qaxis = (axis, ang) => { const s = Math.sin(ang / 2); return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(ang / 2) }; };
export const yawOf = (q) => { const f = qrot(q, [1, 0, 0]); return Math.atan2(-f[2], f[0]); };   // heading about +y (0 = east, + = towards north)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const V = (o) => [o.x, o.y, o.z];
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const slew = (cur, target, up, down, dt) => {   // up = rate when growing away from 0 on the same side, down = otherwise
  const d = target - cur, rate = (Math.sign(target) === Math.sign(cur) || cur === 0) && Math.abs(target) > Math.abs(cur) ? up : down;
  return Math.abs(d) <= rate * dt ? target : cur + Math.sign(d) * rate * dt;
};

/** the farthest any collider reaches along unit direction n (world): for the tests' wall check (box, cylinder, round cylinder, ball, hull) */
export function reach(RAPIER, col, n) {
  const c = V(col.translation()), q = col.rotation(), s = col.shape, T = RAPIER.ShapeType;
  if (s.type === T.Cuboid || s.type === T.RoundCuboid) {
    const h = s.halfExtents, b = s.borderRadius || 0;
    return dot(c, n) + Math.abs(h.x * dot(qrot(q, [1, 0, 0]), n)) + Math.abs(h.y * dot(qrot(q, [0, 1, 0]), n)) + Math.abs(h.z * dot(qrot(q, [0, 0, 1]), n)) + b;
  }
  if (s.type === T.Cylinder || s.type === T.RoundCylinder) {
    const a = qrot(q, [0, 1, 0]), an = dot(a, n), b = s.borderRadius || 0;
    return dot(c, n) + s.halfHeight * Math.abs(an) + s.radius * Math.sqrt(Math.max(0, 1 - an * an)) + b;
  }
  if (s.type === T.Ball) return dot(c, n) + s.radius;
  if (s.type === T.ConvexPolyhedron || s.type === T.RoundConvexPolyhedron) {
    const v = s.vertices; let m = -Infinity;
    for (let i = 0; i < v.length; i += 3) m = Math.max(m, dot(add(c, qrot(q, [v[i], v[i + 1], v[i + 2]])), n));
    return m + (s.borderRadius || 0);
  }
  return dot(c, n);
}

export function createSim(RAPIER, opts = {}) {
  const R = RAPIER;
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  world.integrationParameters.normalizedAllowedLinearError = 0.0002;   // 0.2 mm (default 1 mm): a latch driven into a wall at full speed reached 5 mm into it with the default, 1.6 mm with this
  world.integrationParameters.numInternalPgsIterations = opts.pgs || 4;   // 4 PGS passes per solver iteration: the stiff tyre springs and hub-motor loops converge (no creep at rest)
  const J = world.impulseJoints.raw;
  const sim = { R, world, DT, t: 0, steps: 0, parts: [], byName: new Map(), statics: [], ramp: null, events: [], input: { x: 0, y: 0, hold: false, mode: null },
    kinds: Object.assign({}, TRASH_KINDS), armStats: { grip: 0.11, payload: 3, reach: 1, rate: 1 }, canStow: null };

  // ---------------------------------------------------------------------------------------------- the room, stairs, posts, cable cover
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  // every fixed obstacle the trolley can run into has a 3 mm contact skin: Rapier keeps colliders that far off it, which more than covers the
  // solver's give under load (measured: a latch pressed into a wall by all four motors went 1.8 mm in without it, stays 1 mm out with it)
  const staticCol = (desc, kind, friction) => {
    desc.setFriction(friction).setRestitution(0.02).setCollisionGroups(COLLIDE.world).setSolverGroups(COLLIDE.world);
    if (kind !== 'floor' && kind !== 'landing' && kind !== 'step' && kind !== 'ground') desc.setContactSkin(0.003);   // not on what the trolley stands on
    const c = world.createCollider(desc, fixed); sim.statics.push({ col: c, kind }); return c;
  };
  const FRICTION = { floor: 0.6, wall: 0.5, lintel: 0.5, landing: 0.6, step: 0.6, rail: 0.5, partition: 0.5, curb: 0.5 };   // sealed concrete, painted wood
  for (const [x, y, z, hx, hy, hz, kind] of staticBoxes()) staticCol(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z), kind, FRICTION[kind] || 0.6);
  for (const [x, z, r, h] of POSTS) staticCol(R.ColliderDesc.cylinder(h / 2, r).setTranslation(x, h / 2, z), 'post', 0.5);
  {
    const { x, z0, z1, h, bottom, top } = CABLE, b = bottom / 2, t = top / 2;
    const pts = new Float32Array([x - b, 0, z0, x + b, 0, z0, x - t, h, z0, x + t, h, z0, x - b, 0, z1, x + b, 0, z1, x - t, h, z1, x + t, h, z1]);
    staticCol(R.ColliderDesc.convexHull(pts), 'cable', 0.8);
  }

  // ---------------------------------------------------------------------------------------------- the world round the hall (world_spec.js)
  // A floor slab for each ground kind outside the hall, each with its own friction and combine rule (Rapier's own: mud is 0.3 by the
  // minimum, so a tyre on it grips half as well as on concrete), the fences, walls, blocks and set dressing as fixed colliders.
  const RULE = { avg: R.CoefficientCombineRule.Average, min: R.CoefficientCombineRule.Min, max: R.CoefficientCombineRule.Max };
  sim.grounds = [];
  for (const [kind, x0, x1, z0, z1] of FLOORS) {
    const g = GROUND[kind], c = staticCol(R.ColliderDesc.cuboid((x1 - x0) / 2, ROOM.floor / 2, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, -ROOM.floor / 2, (z0 + z1) / 2), 'ground', g.friction);
    c.setFrictionCombineRule(RULE[g.rule]); sim.grounds.push({ col: c, kind, rect: [x0, x1, z0, z1] });
  }
  const WFR = { fence: 0.5, railing: 0.5, brick: 0.6, building: 0.6, container: 0.45, fountain: 0.6, signpost: 0.5, lamp: 0.5, bench: 0.5, rubble: 0.7, wreck: 0.5, log: 0.7, stump: 0.7, drum: 0.5, tree: 0.7 };
  for (const s of worldStatics()) {
    let d;
    if (s.t === 'box') d = R.ColliderDesc.cuboid(s.hx, s.hy, s.hz).setTranslation(s.x, s.y, s.z).setRotation(qaxis([0, 1, 0], (s.yaw || 0) * DEG));
    else if (s.t === 'cyl') d = R.ColliderDesc.cylinder(s.h / 2, s.r).setTranslation(s.x, s.h / 2, s.z);
    else d = R.ColliderDesc.cylinder(s.hl, s.r).setTranslation(s.x, s.r, s.z).setRotation(qmul(qaxis([0, 1, 0], (s.yaw || 0) * DEG), qaxis([0, 0, 1], Math.PI / 2)));   // a log, lying along its yaw
    staticCol(d, 'world', WFR[s.kind] || 0.5).worldKind = s.kind;
  }

  // ---------------------------------------------------------------------------------------------- the wheeled ramp
  function buildRamp(pose) {
    if (sim.ramp) { world.removeRigidBody(sim.ramp.body); sim.ramp = null; }
    const { len, rise, width, gap, mass, lip, curb } = RAMP, hw = width / 2;
    const yaw = (pose.yawDeg || 0) * DEG, q = qaxis([0, 1, 0], Math.PI + yaw);   // local +x (toe -> high end) points west, turned by yaw
    const hi = [pose.highX, 0, pose.z], origin = add(hi, qrot(q, [-len, 0, 0]));   // the body's origin is the toe's centre, on the floor
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...origin).setRotation(q).setSoftCcdPrediction(0.03).setLinearDamping(0.05).setAngularDamping(0.2));
    const cd = (d, fr, kind) => { d.setDensity(0).setFriction(fr).setRestitution(0.02).setCollisionGroups(COLLIDE.world).setSolverGroups(COLLIDE.world); const c = world.createCollider(d, body); c.kind = kind; return c; };
    cd(R.ColliderDesc.convexHull(new Float32Array([0, gap, -hw, 0, gap, hw, len, gap, -hw, len, gap, hw, len, rise, -hw, len, rise, hw])), 0.9, 'deck');   // anti-slip tread
    const a = Math.atan2(rise - gap, len), cl = Math.hypot(len - 0.12, (rise - gap) * (len - 0.12) / len) / 2;
    for (const s of [-1, 1]) {
      const mid = [0.12 + (len - 0.12) / 2, gap + (rise - gap) * (0.12 + (len - 0.12) / 2) / len, s * (hw - 0.015)];
      const c = add(mid, [-Math.sin(a) * curb / 2, Math.cos(a) * curb / 2, 0]);
      cd(R.ColliderDesc.cuboid(cl, curb / 2, 0.015).setTranslation(...c).setRotation(qaxis([0, 0, 1], a)), 0.5, 'curb');
    }
    cd(R.ColliderDesc.cuboid(lip / 2, 0.005, hw - 0.04).setTranslation(len + lip / 2, rise - 0.005, 0), 0.8, 'lip');
    const casters = [];
    for (const [cx, cz] of [[0.22, hw - 0.1], [0.22, -hw + 0.1], [len - 0.12, hw - 0.1], [len - 0.12, -hw + 0.1]]) {
      const c = cd(R.ColliderDesc.ball(gap).setTranslation(cx, gap, cz).setFrictionCombineRule(R.CoefficientCombineRule.Min), 0.02, 'caster');
      casters.push(c);
    }
    const com = [len * 2 / 3, gap + (rise - gap) / 3, 0];
    body.setAdditionalMassProperties(mass, { x: com[0], y: com[1], z: com[2] },
      { x: mass * (rise * rise / 4 + width * width) / 12, y: mass * (len * len + width * width) / 12, z: mass * (len * len + rise * rise / 4) / 12 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    sim.ramp = { body, casters, locked: false, len, rise, width };
  }
  function lockRamp(on) {
    if (!sim.ramp || sim.ramp.locked === on) return;
    for (const c of sim.ramp.casters) { c.setFriction(on ? 1.0 : 0.02); c.setFrictionCombineRule(on ? R.CoefficientCombineRule.Max : R.CoefficientCombineRule.Min); }
    sim.ramp.locked = on; sim.events.push({ type: 'rampLock', on });
  }
  /** where the ramp is against the landing: gap (m), angle (deg), both high corners' z, docked */
  function rampState() {
    const r = sim.ramp; if (!r) return null;
    const p = V(r.body.translation()), q = r.body.rotation(), hw = r.width / 2;
    const hiC = add(p, qrot(q, [r.len, 0, 0])), cA = add(p, qrot(q, [r.len, 0, hw])), cB = add(p, qrot(q, [r.len, 0, -hw]));
    const f = qrot(q, [1, 0, 0]), ang = Math.atan2(f[2], -f[0]) / DEG;   // 0 = pointing west, square to the landing's east face
    const gap = Math.min(cA[0], cB[0]) - LANDING.x1, zs = [cA[2], cB[2]].sort((a, b) => a - b);
    const along = zs[0] >= LANDING.z0 - 0.02 && zs[1] <= LANDING.z1 + 0.02;
    const docked = gap > -0.05 && Math.max(cA[0], cB[0]) - LANDING.x1 <= DOCK.gap && Math.abs(ang) <= DOCK.angleDeg && along;
    return { gap, angle: ang, z: hiC[2], zs, docked, locked: r.locked, pos: p, q };
  }

  // ---------------------------------------------------------------------------------------------- the trolley
  const T = { parts: [], wheels: [], modules: [], passive: [], chassis: null, crate: null, crateRest: null, touch: [] };
  sim.trolley = T;
  const toLocal = (p, pivot) => U(p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]);
  function inertiaOf(part) {
    const m = part.mass, k = part.inertiaScale || 1;
    if (part.cyl) { const r = WHEEL_R, w = 0.0653, io = m * (3 * r * r + w * w) / 12; return [io, io, 0.55 * m * r * r]; }   // tyre: axle = game z
    const [sx, sy, sz] = part.size;   // USD x, y, z
    return [k * m * (sy * sy + sz * sz) / 12, k * m * (sx * sx + sy * sy) / 12, k * m * (sx * sx + sz * sz) / 12];   // game x, y(=USD z), z(=USD y)
  }
  function colliderDesc(c, pivot) {
    if (c.type === 'box') {
      const ctr = [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2], h = [(c.max[0] - c.min[0]) / 2, (c.max[1] - c.min[1]) / 2, (c.max[2] - c.min[2]) / 2];
      return R.ColliderDesc.cuboid(h[0], h[2], h[1]).setTranslation(...toLocal(ctr, pivot));
    }
    if (c.type === 'lbox') {
      const d = R.ColliderDesc.cuboid(c.h[0], c.h[2], c.h[1]).setTranslation(...U(...c.c));
      if (c.rotZ) d.setRotation(qaxis([0, 1, 0], c.rotZ * DEG));
      return d;
    }
    if (c.type === 'lcyl') {   // a cylinder along USD Y (the game's z): Rapier's cylinders run along their local y
      const rot = qaxis([1, 0, 0], Math.PI / 2), b = c.round || 0;
      const d = b ? R.ColliderDesc.roundCylinder(c.hw - b, c.r - b, b) : R.ColliderDesc.cylinder(c.hw, c.r);
      return d.setTranslation(...U(...c.c)).setRotation(rot);
    }
    throw new Error('collider type ' + c.type);
  }

  /** build the trolley at a pose: {x, y (height of the wheels' bottom), z, yawDeg (0 = east), pitchDeg (nose up), rollDeg} */
  function buildTrolley(pose = {}) {
    // v2: a bin that is off the trolley stays where it is; one in the pocket is rebuilt with the trolley and the trash in it rides along;
    // a mounted arm is mounted again
    const keepCrate = !!(T.crate && !binOnDeck()), oldCrate = keepCrate ? T.crate : null, hadArm = V2.arm.parts.length > 0;
    const riders = T.crate && !keepCrate ? V2.items.filter((it) => it.inBin && it.state !== 'grasped').map((it) => ({ it, r: relPose(T.crate.body, it.body) })) : [];
    if (hadArm) unmountArm('mounted');
    V2.binJoint = dropJoint(V2.binJoint);
    for (const p of T.parts) if (p.body && p !== oldCrate && world.getRigidBody(p.body.handle)) world.removeRigidBody(p.body);
    T.parts = []; T.wheels = []; T.modules = []; T.passive = []; sim.parts = T.parts; sim.byName.clear();
    const yaw = (pose.yawDeg || 0) * DEG, pitch = (pose.pitchDeg || 0) * DEG, roll = (pose.rollDeg || 0) * DEG;
    const q = qmul(qaxis([0, 1, 0], yaw), qmul(qaxis([0, 0, 1], pitch), qaxis([1, 0, 0], -roll)));
    const P0 = [pose.x || 0, (pose.y || 0) + 0.003 - 0.0003, pose.z || 0];   // spawned 3 mm above whatever is under it
    T.pose = { q, P0 };
    const specs = trolleyParts();
    for (const s of specs) {
      if (s.role === 'crate' && oldCrate) { T.parts.push(oldCrate); sim.byName.set(s.name, oldCrate); T.crate = oldCrate; continue; }
      const origin = add(P0, qrot(q, U(...s.pivot)));
      const d = R.RigidBodyDesc.dynamic().setTranslation(...origin).setRotation(q).setCanSleep(false);
      // CCD on the chassis, the crate and the tyres: Rapier's soft CCD (predictive contacts 3 cm ahead: more than a step's travel at top
      // speed, 2 cm). Rapier's hard CCD moves a multibody link back on its own: measured on the cable cover, the whole trolley jumped
      // 15 mm in a step and threw the crate against its lip (out of its pocket on some runs). Soft CCD has none of that.
      if (s.role === 'chassis' || s.role === 'wheel' || s.role === 'crate') d.setSoftCcdPrediction(0.03);
      const body = world.createRigidBody(d);
      const group = COLLIDE[s.collide];
      const cols = s.colliders.map((c) => {
        const cd = colliderDesc(c, s.pivot).setDensity(0).setFriction(s.friction).setRestitution(s.restitution)
          .setRestitutionCombineRule(R.CoefficientCombineRule.Min).setCollisionGroups(group).setSolverGroups(group);
        return world.createCollider(cd, body);
      });
      const com = toLocal(s.com, s.pivot), I = inertiaOf(s);
      body.setAdditionalMassProperties(s.mass, { x: com[0], y: com[1], z: com[2] }, { x: I[0], y: I[1], z: I[2] }, { x: 0, y: 0, z: 0, w: 1 }, true);
      const part = { name: s.name, role: s.role, spec: s, body, cols, parent: null, joint: null, mb: null, ij: null };
      T.parts.push(part); sim.byName.set(s.name, part);
      if (s.role === 'chassis') T.chassis = part;
      if (s.role === 'crate') T.crate = part;
      if (s.parent) {
        const parent = sim.byName.get(s.parent); part.parent = parent;
        const a1 = toLocal(s.pivot, parent.spec.pivot), axis = AXIS[s.joint.axis];
        const v = (a) => ({ x: a[0], y: a[1], z: a[2] });
        // a steering module rides a short, stiff vertical spring on its kingpin (a cylindrical joint: turn about it, slide along it):
        // the tyres' and mounts' compliance, about 4 mm under the trolley's weight. Without it a rigid four-wheeler on a flat floor
        // stands on two diagonal tyres. Every other hinge is a plain revolute joint.
        const jd = s.joint.kind === 'steer' ? R.JointData.generic(v(a1), v([0, 0, 0]), v(axis), 2 | 4 | 16 | 32) : R.JointData.revolute(v(a1), v([0, 0, 0]), v(axis));
        part.mb = world.createMultibodyJoint(jd, parent.body, body, true); part.mb.setContactsEnabled(false);
        const ij = world.createImpulseJoint(R.JointData.generic(v(a1), v([0, 0, 0]), v(axis), 0), parent.body, body, true);   // locks nothing
        ij.setContactsEnabled(false);
        part.ij = ij; part.axisLocal = axis; part.joint = s.joint;
        const h = ij.handle, AX = 3;   // RawJointAxis.AngX: the hinge
        J.jointConfigureMotorModel(h, AX, 1);   // RawMotorModel.ForceBased: N·m, N·m/rad, N·m·s/rad
        if (s.joint.limit) J.jointSetLimits(h, AX, s.joint.limit[0] * DEG, s.joint.limit[1] * DEG);
        if (s.joint.kind === 'passive') {
          J.jointConfigureMotor(h, AX, 0, 0, s.joint.spring || 0, s.joint.damping);
          J.jointSetMotorMaxForce(h, AX, 50);
          T.passive.push(part);
        } else if (s.joint.kind === 'steer') {
          J.jointConfigureMotor(h, AX, 0, 0, STEER.kHold, STEER.c); J.jointSetMotorMaxForce(h, AX, STEER.max);
          J.jointConfigureMotorModel(h, 0, 1); J.jointSetLimits(h, 0, -SUSP.travel, SUSP.travel);   // RawJointAxis.LinX: the spring
          J.jointConfigureMotor(h, 0, 0, 0, SUSP.k, SUSP.c); J.jointSetMotorMaxForce(h, 0, 6000);
          part.target = 0; part.cmd = 0; part.rate = 0; T.modules.push(part);
        } else if (s.joint.kind === 'wheel') {
          J.jointConfigureMotorVelocity(h, AX, 0, WHEEL_GAIN); J.jointSetMotorMaxForce(h, AX, sim.torqueCap || TORQUE_CAP);
          T.wheels.push(part);
        }
      }
    }
    T.touch = T.parts.flatMap((p) => p.cols);
    for (const w of T.wheels) { w.module = sim.byName.get('wheelEngine_' + w.spec.id); const m = w.module.spec; w.off0 = [w.spec.pivot[0] - m.pivot[0], w.spec.pivot[1] - m.pivot[1]]; w.axisXY = [m.pivot[0], m.pivot[1]]; }
    T.mode = 'drive'; T.want = 'drive'; T.phase = 'ready'; T.cmd = { vx: 0, vy: 0, w: 0 }; T.hold = false; T.estop = 0;
    for (const p of T.passive) { p.prevA = 0; p.prevV = 0; }
    T.crateRest = null; T.onLanding = 0; T.done = false;
    V2.latches = false;
    if (!keepCrate) {
      lockBin();
      for (const { it, r } of riders) {
        const kb = T.crate.body, kq = kb.rotation();
        it.body.setTranslation(vec(add(V(kb.translation()), qrot(kq, r.p))), true); it.body.setRotation(qmul(kq, r.q), true);
        it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); it.body.setAngvel({ x: 0, y: 0, z: 0 }, true); it.prevV = [0, 0, 0];
      }
    }
    if (hadArm) mountArm();
    if (V2.binLoad && !keepCrate) { const kg = V2.binLoad; V2.binLoad = 0; setBinLoad(kg); }
    sim.events.push({ type: 'spawn' });
  }

  // ---------------------------------------------------------------------------------------------- reading the trolley
  /** a hinge's angle (rad, the USD sign) and rate (rad/s), from the two bodies */
  function hinge(p) {
    const qp = p.parent.body.rotation(), qc = p.body.rotation(), qr = qmul(qconj(qp), qc), a = p.axisLocal;
    const ang = wrap(2 * Math.atan2(qr.x * a[0] + qr.y * a[1] + qr.z * a[2], qr.w));
    const wa = qrot(qp, a), rate = dot(sub(V(p.body.angvel()), V(p.parent.body.angvel())), wa);
    return { ang, rate };
  }
  /** the chassis' motion in its own frame: forward (USD x), left (USD y), yaw rate; and its speed */
  function motion() {
    const b = T.chassis.body, q = b.rotation(), v = V(b.linvel()), w = V(b.angvel());
    const f = qrot(q, [1, 0, 0]), l = qrot(q, [0, 0, -1]), up = qrot(q, [0, 1, 0]);
    return { fwd: dot(v, f), left: dot(v, l), yaw: dot(w, up), speed: Math.hypot(v[0], v[1], v[2]), spin: Math.hypot(w[0], w[1], w[2]) };
  }
  function crateOffset() {   // the crate's place in the chassis frame (m) and its tilt against the chassis (deg)
    const cb = T.chassis.body, kb = T.crate.body, qc = cb.rotation();
    const rel = qrot(qconj(qc), sub(V(kb.translation()), V(cb.translation()))), qr = qmul(qconj(qc), kb.rotation());
    return { pos: rel, tilt: 2 * Math.acos(Math.min(1, Math.abs(qr.w))) / DEG, up: qrot(qr, [0, 1, 0]) };
  }

  // ---------------------------------------------------------------------------------------------- the controller (one fixed step)
  function control(inp) {
    const S = SPEED;
    if (V2.op) inp = { x: 0, y: 0, hold: true, mode: null };   // the dock is working on the trolley: held still
    const limp = V2.batt.limp, ls = limp ? POWER.limpScale : 1, lo = limp ? POWER.limpOther : 1;   // limp mode: a third of the speed
    T.hold = !!inp.hold;
    if (inp.mode && MODE_ANGLES[inp.mode] && inp.mode !== T.want) { T.want = inp.mode; sim.events.push({ type: 'modeAsk', mode: inp.mode }); }
    const m = motion();
    const sx = clamp(inp.x || 0, -1, 1), sy = clamp(inp.y || 0, -1, 1);
    let vxT = 0, vyT = 0, wT = 0;
    if (T.want !== T.mode) {   // a mode change: stop, then swing the modules (only when stopped)
      if (T.phase !== 'steering') {
        T.phase = 'stopping';
        if (Math.abs(T.cmd.vx) < 1e-3 && Math.abs(T.cmd.vy) < 1e-3 && Math.abs(T.cmd.w) < 1e-3 && m.speed < 0.04 && Math.abs(m.yaw) < 0.06) {
          T.phase = 'steering'; sim.events.push({ type: 'servo', on: true, mode: T.want });
        }
      }
      if (T.phase === 'steering') {
        const tgt = MODE_ANGLES[T.want]; let done = true;
        for (const mod of T.modules) {
          mod.target = tgt[mod.spec.id];
          const d = mod.target - mod.cmd, step = Math.sign(d) * Math.min(Math.abs(d), S.steerRate / DEG * DT);
          mod.cmd += step; mod.rate = step * DEG / DT;
          const a = hinge(mod).ang / DEG;
          if (Math.abs(a - mod.target) > 1.5 || mod.cmd !== mod.target) done = false;
        }
        if (done) { T.mode = T.want; T.phase = 'ready'; sim.events.push({ type: 'servo', on: false, mode: T.mode }); sim.events.push({ type: 'mode', mode: T.mode }); }
      }
    } else if (T.mode === 'drive') {
      wT = -sx * 1.0; vxT = sy * S.drive;
      const scale = (Math.abs(vxT) + Math.abs(wT) * 0.383) / S.drive; if (scale > 1) { vxT /= scale; wT /= scale; }
      vxT *= ls * (sim.speedScale || 1); wT *= lo;   // v5: the Dynamo Heart and an overdrive raise the speed asked of the hub motors (their torque stays)
    } else if (T.mode === 'crab') vyT = -sx * S.crab * lo * (sim.speedScale || 1);
    else if (T.mode === 'spin') wT = -sx * S.spin * lo;
    if (T.hold) {   // HOLD: wheels to 0 at once; the hub motors' torque cap sets how hard it stops (about 3.6 m/s²)
      if (m.speed > 0.8 && !T.estop) { T.estop = sim.t; sim.events.push({ type: 'estop', speed: m.speed }); }
      T.cmd.vx = 0; T.cmd.vy = 0; T.cmd.w = 0;
    } else {
      T.estop = 0;
      T.cmd.vx = slew(T.cmd.vx, vxT, S.accel, S.brake, DT);
      T.cmd.vy = slew(T.cmd.vy, vyT, S.crabAccel, S.brake, DT);
      T.cmd.w = slew(T.cmd.w, wT, T.mode === 'spin' ? S.spinAccel : 2.0, 3.0, DT);
    }
    // DRIVE turns by skidding (left and right tyres at different speeds). A skidding tyre gives less turn than its speed says, so the
    // controller closes the loop on the yaw rate it measures (a gyro), within what the hub motors can give; it also holds a straight line
    let wEff = T.cmd.w;
    if (T.mode === 'drive' && T.phase === 'ready' && !T.hold) {
      const e = T.cmd.w - m.yaw;
      T.wI = Math.abs(T.cmd.w) > 0.02 ? clamp((T.wI || 0) + e * YAW.ki * DT, -YAW.iMax, YAW.iMax) : (T.wI || 0) * 0.85;   // no turn asked: let go
      wEff = T.cmd.w + YAW.kp * e + T.wI;
    } else T.wI = 0;
    if (T.phase !== 'steering') for (const mod of T.modules) mod.rate = 0;
    // the hub motors' current limit: 12 N·m to drive straight, crab or push (a gentle push); their 20 N·m peak to skid round, spin
    // or stop (HOLD)
    const cap = sim.torqueCap || (T.hold || T.phase !== 'ready' || T.mode === 'spin' || (T.mode === 'drive' && (Math.abs(T.cmd.w) > 0.05 || Math.abs(wEff) > 0.15)) ? TORQUE_PEAK : TORQUE_CAP);
    // the steering servos: a stiff position loop on the commanded angle (stiffer while it holds than while it swings)
    for (const mod of T.modules) J.jointConfigureMotor(mod.ij.handle, 3, mod.cmd * DEG, mod.rate, mod.rate ? STEER.k : STEER.kHold, STEER.c);
    // the hub motors: each tyre's rolling speed for the commanded body motion, plus the roll its module's commanded swing asks for
    // (the commanded angle and rate, never the measured ones: no loop between the tyres and the servos)
    for (const w of T.wheels) {
      const phi = w.module.cmd * DEG, rate = w.module.rate || 0, c = Math.cos(phi), s = Math.sin(phi);
      const o = [c * w.off0[0] - s * w.off0[1], s * w.off0[0] + c * w.off0[1]], ctr = [w.axisXY[0] + o[0], w.axisXY[1] + o[1]];
      const vb = [T.cmd.vx - wEff * ctr[1], T.cmd.vy + wEff * ctr[0]], vs = [-rate * o[1], rate * o[0]];
      const wm = SPEED.wheelMax * (sim.speedScale || 1) / WHEEL_R, target = clamp(((vb[0] + vs[0]) * c + (vb[1] + vs[1]) * s) / WHEEL_R, -wm, wm);
      J.jointConfigureMotorVelocity(w.ij.handle, 3, target, WHEEL_GAIN);
      if (cap !== w.cap) { J.jointSetMotorMaxForce(w.ij.handle, 3, cap); w.cap = cap; }
      w.target = target;
    }
    armControl();
  }

  // ---------------------------------------------------------------------------------------------- after a step: what the parts did
  function watch() {
    for (const p of T.passive) {
      const { ang, rate } = hinge(p), lim = p.joint.limit.map((d) => d * DEG);
      for (const L of lim) {
        const toward = Math.sign(L - p.prevA || 1) * p.prevV;
        if (Math.abs(ang - L) < 0.9 * DEG && toward > 0.35 && Math.sign(L - p.prevA || 1) * rate < 0.1) sim.events.push({ type: 'clack', part: p.name, role: p.role, speed: toward });
      }
      p.ang = ang; p.prevA = ang; p.prevV = rate;
    }
    // the crate: a thump when it slides in its pocket and comes to rest against it (only while it is on the deck)
    const co = crateOffset();
    if (!T.crateRest && sim.t > 1.0) T.crateRest = co.pos;
    if (T.crateRest && binOnDeck()) {
      const d = Math.hypot(co.pos[0] - T.crateRest[0], co.pos[2] - T.crateRest[2]), v = T.crateV || 0;
      const dv = (d - (T.crateD || 0)) / DT;
      if (Math.abs(dv) > 0.03) T.crateMoving = Math.max(T.crateMoving || 0, Math.abs(dv));
      else if (T.crateMoving) { sim.events.push({ type: 'thump', speed: T.crateMoving, shift: d }); T.crateMoving = 0; }
      T.crateD = d; T.crateV = v;
    }
    // the ramp
    const rs = rampState();
    if (rs && rs.docked && !rs.locked) lockRamp(true);
    // the objective: resting on the landing, all four tyres on it, under 0.05 m/s for 1 s
    const on = onLanding(), m = motion();
    if (on && m.speed < 0.05 && m.spin < 0.1) { T.onLanding += DT; if (T.onLanding >= 1.0 && !T.done) { T.done = true; sim.events.push({ type: 'objective' }); } }
    else T.onLanding = 0;
    watch2();
  }
  /** every tyre over the landing and its centre at the landing's height */
  function onLanding() {
    const L = LANDING;
    return T.wheels.every((w) => { const p = V(w.body.translation()); return p[0] > L.x0 && p[0] < L.x1 && p[2] > L.z0 && p[2] < L.z1 && Math.abs(p[1] - (L.top + WHEEL_R)) < 0.03; });
  }

  // ============================================================================================== v2: dock, bin lock, arm, trash, spills, battery
  // Everything here is real bodies and joints: the bin is held by a fixed joint (the clamps and latches closed) or by nothing (open); the
  // dock's hoist is a kinematic head that grips the bin's rim with a fixed joint; the arm is five more hinges on the trolley's multibody
  // with servo motors; a grasp is a fixed joint between the claw's palm and the item; a spill is a sensor on the floor that changes the
  // tyres' own friction while they touch it.
  const V2 = {
    bin: 'locked', binJoint: null, op: null, opName: null, msg: '', hoist: null, door: null, kit: null, items: [], spills: [], obstacles: new Map(), pickups: [], dressing: [],
    arm: { state: opts.arm || 'map', parts: [], byName: new Map(), seq: null, grasp: null, cmd: null, cmdV: null, fingers: false, note: '' },
    batt: battery(opts.tier || 0, opts.charge == null ? 1 : opts.charge), dock: { inBay: false, parked: false, parkedT: 0 }, nextId: 1, crateHome: [0, 0.3605, 0],
    slicks: [], ground: { mud: 0, puddle: 0 },
  };
  sim.v2 = V2;
  // the map's slicks (world_spec.js): cadmium puddles and the yard's old oil, sensor discs like a spill's that never go away
  for (const [kind, x, z, r] of SLICKS) {
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const col = world.createCollider(R.ColliderDesc.cylinder(SPILL.depth / 2, r).setTranslation(x, SPILL.depth / 2 - 0.01, z).setSensor(true)
      .setCollisionGroups(groups(G.WORLD, G.WHEEL)).setSolverGroups(0), body);
    V2.slicks.push({ kind, x, z, r, col });
  }
  const vec = (a) => ({ x: a[0], y: a[1], z: a[2] });
  const relPose = (b1, b2) => { const q1 = b1.rotation(); return { p: qrot(qconj(q1), sub(V(b2.translation()), V(b1.translation()))), q: qmul(qconj(q1), b2.rotation()) }; };
  /** a fixed joint that holds b2 where it is now, relative to b1 (contacts between the two off unless asked) */
  function holdJoint(b1, b2, contacts = false) {
    const r = relPose(b1, b2);
    const j = world.createImpulseJoint(R.JointData.fixed(vec(r.p), r.q, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), b1, b2, true);
    j.setContactsEnabled(contacts); return j;
  }
  function dropJoint(j) { if (j) { try { world.removeImpulseJoint(j, true); } catch (e) { /* gone with its body */ } } return null; }
  const upTilt = (q) => Math.acos(clamp(1 - 2 * (q.x * q.x + q.z * q.z), -1, 1)) / DEG;   // degrees between a body's up and the world's

  // ---- the dock's fixed parts: guide walls, the shutter's posts and header, the bin stand, the gantry's post
  const DB = DOCK_BAY;
  for (const [x, z, hx, hy, hz] of DB.guides) staticCol(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, hy, z), 'guide', 0.5);
  for (const [x, z] of DB.posts) staticCol(R.ColliderDesc.cuboid(0.06, DB.postH / 2, 0.06).setTranslation(x, DB.postH / 2, z), 'post', 0.5);
  staticCol(R.ColliderDesc.cuboid((DB.posts[1][0] - DB.posts[0][0]) / 2 + 0.06, 0.09, 0.1).setTranslation(DB.door.x, DB.postH + 0.09, DB.door.z), 'header', 0.5);
  staticCol(R.ColliderDesc.cuboid(DB.stand.hx, DB.stand.hy, DB.stand.hz).setTranslation(DB.stand.x, DB.stand.hy, DB.stand.z), 'stand', 0.6);
  staticCol(R.ColliderDesc.cylinder(DB.gantry.y / 2, 0.08).setTranslation(DB.gantry.post[0], DB.gantry.y / 2, DB.gantry.post[1]), 'post', 0.5);
  // the shutter: a fixed slab whose height follows the roller (open = rolled up into the header)
  {
    const d = DB.door, body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const col = world.createCollider(R.ColliderDesc.cuboid(d.hx, d.hy, d.hz).setTranslation(d.x, d.hy, d.z).setFriction(0.4).setCollisionGroups(COLLIDE.world).setSolverGroups(COLLIDE.world).setContactSkin(0.003), body);
    V2.door = { body, col, open: 0, target: 0, height: d.hy * 2 };
  }
  // v5: the hall's two doorways get roller shutters like the dock's: fixed slabs in the wall's thickness whose height follows the roller
  // (open = rolled up under the lintel). Open unless the game closes them (main.js: shut for the tutorial, open after it).
  V2.hallDoors = [];
  for (const d of HALL_DOORS) {
    const body = world.createRigidBody(R.RigidBodyDesc.fixed()), hx = d.wall === 'S' ? (d.a1 - d.a0) / 2 : 0.025, hz = d.wall === 'S' ? 0.025 : (d.a1 - d.a0) / 2;
    const x = d.wall === 'S' ? (d.a0 + d.a1) / 2 : ROOM.hx + ROOM.wall / 2, z = d.wall === 'S' ? ROOM.hz + ROOM.wall / 2 : (d.a0 + d.a1) / 2;
    const col = world.createCollider(R.ColliderDesc.cuboid(hx, 0.005, hz).setTranslation(x, d.h - 0.005, z).setFriction(0.4).setCollisionGroups(COLLIDE.world).setSolverGroups(COLLIDE.world).setContactSkin(0.003), body);
    V2.hallDoors.push({ wall: d.wall, body, col, x, z, hx, hz, h: d.h, open: 1, target: 1 });
  }
  function hallDoorStep() {
    for (const D of V2.hallDoors) {
      if (D.open === D.target) continue;
      const st = 0.9 * DT / D.h; D.open = D.target > D.open ? Math.min(D.target, D.open + st) : Math.max(D.target, D.open - st);
      const hgt = Math.max(0.01, D.h * (1 - D.open)); D.col.setHalfExtents({ x: D.hx, y: hgt / 2, z: D.hz }); D.col.setTranslation({ x: D.x, y: D.h - hgt / 2, z: D.z });
      if (D.open === D.target) sim.events.push({ type: 'door', id: 'hall-' + D.wall, open: D.target === 1 });
    }
  }
  /** the hall's shutters: open (true) or shut; now = at once (no rolling) */
  function setHallDoors(open, now = false) { for (const D of V2.hallDoors) { D.target = open ? 1 : 0; if (now) { D.open = open ? 0.999 : 0.001; } } hallDoorStep(); if (now) for (const D of V2.hallDoors) D.open = D.target; }
  function doorStep() {
    hallDoorStep();
    const D = V2.door, d = DB.door; if (D.open === D.target) return;
    const s = d.speed * DT / (d.hy * 2); D.open = D.target > D.open ? Math.min(D.target, D.open + s) : Math.max(D.target, D.open - s);
    const h = Math.max(0.01, d.hy * 2 * (1 - D.open)); D.height = h;
    D.col.setHalfExtents({ x: d.hx, y: h / 2, z: d.hz }); D.col.setTranslation({ x: d.x, y: d.hy * 2 - h / 2, z: d.z });
    if (D.open === D.target) sim.events.push({ type: 'door', id: 'dock', open: D.target === 1 });
  }
  // the hoist's head: a kinematic body that hangs from the gantry; it touches nothing itself, it only holds the bin by a joint
  {
    const park = [DB.stand.x, 2.0, DB.stand.z];
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...park));
    world.createCollider(R.ColliderDesc.cuboid(0.3, 0.03, 0.3).setCollisionGroups(COLLIDE.none).setSolverGroups(COLLIDE.none), body);
    V2.hoist = { body, pos: park.slice(), yaw: 0, park, grip: null };
  }
  // the set dressing: rusty drums and a big box, real bodies the trolley can shove
  V2.dressing = [];
  for (const [kind, x, z, yawDeg] of DRESSING_AT) {
    const k = DRESSING[kind], [sx, sy, sz] = k.size;
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, sy / 2 + 0.003, z).setRotation(qaxis([0, 1, 0], (yawDeg || 0) * DEG)).setSoftCcdPrediction(0.02).setAngularDamping(0.2));
    const d = k.shape === 'drum' ? R.ColliderDesc.roundCylinder(sy / 2 - 0.015, k.radius - 0.015, 0.015) : R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
    world.createCollider(d.setMass(k.mass).setFriction(k.friction).setRestitution(0.05).setCollisionGroups(COLLIDE.trash).setSolverGroups(COLLIDE.trash), body);
    V2.dressing.push({ kind, body });
  }
  function headTo(tp, tyaw, speed) {   // move the head towards tp (m/s) and turn it towards tyaw; true when there
    const h = V2.hoist, d = sub(tp, h.pos), L = Math.hypot(d[0], d[1], d[2]), s = speed * DT;
    h.pos = L <= s ? tp.slice() : add(h.pos, [d[0] * s / L, d[1] * s / L, d[2] * s / L]);
    let at = L <= s;
    if (tyaw != null) { const dy = wrap(tyaw - h.yaw), ys = 0.9 * DT; h.yaw = Math.abs(dy) <= ys ? tyaw : h.yaw + Math.sign(dy) * ys; at = at && Math.abs(dy) <= ys; }
    h.body.setNextKinematicTranslation(vec(h.pos)); h.body.setNextKinematicRotation(qaxis([0, 1, 0], h.yaw));
    return at;
  }

  // ---- the bin: locked (fixed joint, clamps and latches closed), loose in its pocket, on the hoist, or on the stand
  /** clamps and latches: open = their servos turn them to the far end of their range, closed = back to v1's passive springs */
  function setLatches(open) {
    for (const p of T.passive) {
      if (p.role !== 'clamp' && p.role !== 'lock') continue;
      const [lo, hi] = p.joint.limit, h = p.ij.handle;
      if (open) { const far = Math.abs(hi) >= Math.abs(lo) ? hi - 3 : lo + 3; J.jointConfigureMotor(h, 3, far * DEG, 0, 30, 1.5); J.jointSetMotorMaxForce(h, 3, 12); }
      else { J.jointConfigureMotor(h, 3, 0, 0, p.joint.spring || 0, p.joint.damping); J.jointSetMotorMaxForce(h, 3, 50); }
    }
    V2.latches = open;
  }
  function lockBin() { V2.binJoint = dropJoint(V2.binJoint); V2.binJoint = holdJoint(T.chassis.body, T.crate.body); V2.bin = 'locked'; }
  function unlockBin() { V2.binJoint = dropJoint(V2.binJoint); if (V2.bin === 'locked') V2.bin = 'loose'; }
  const binOnDeck = () => V2.bin === 'locked' || V2.bin === 'loose';
  /** where the bin sits in its pocket (world): position and yaw, from the chassis' pose */
  function pocketPose() { const cb = T.chassis.body, q = cb.rotation(); return { p: add(V(cb.translation()), qrot(q, V2.crateHome)), yaw: yawOf(q) }; }
  const GRIP_Y = 0.74;   // the head's centre above the bin's origin when it holds the rim

  // ---- dock operations: a list of stages run one a step. Each: { to: () => [x, y, z], yaw: () => rad, speed } | { run: () => void } | { wait: s }
  function runOp() {
    const op = V2.op; if (!op) return;
    const st = op.stages[op.i];
    if (!st) { V2.op = null; sim.events.push({ type: 'dockOp', name: op.name, done: true }); V2.msg = op.doneMsg || ''; return; }
    if (st.run) { const r = st.run(); op.i++; op.t = 0; if (r === false) { V2.op = null; sim.events.push({ type: 'dockOp', name: op.name, done: false }); } return; }
    if (st.wait != null) { op.t += DT; if (op.t >= st.wait) { op.i++; op.t = 0; } return; }
    if (!st.tp || st.live) st.tp = st.to();
    const yaw = st.yaw ? st.yaw() : null;
    if (headTo(st.tp, yaw, st.speed || 0.5)) { op.i++; op.t = 0; }
  }
  const yawNear = (target, cur) => { const a = wrap(target - cur), b = wrap(target + Math.PI - cur); return Math.abs(a) <= Math.abs(b) ? cur + a : cur + b; };
  function opDetach() {
    let gripP = null, yaw0 = 0;
    return [
      { run: () => { setLatches(true); V2.msg = 'Clamps and latches opening'; } }, { wait: 0.7 },
      { run: () => { unlockBin(); const c = T.crate.body; gripP = add(V(c.translation()), [0, GRIP_Y, 0]); yaw0 = yawOf(c.rotation()); V2.msg = 'Hoist coming down'; } },
      { to: () => add(gripP, [0, 0.35, 0]), yaw: () => yawNear(yaw0, V2.hoist.yaw), speed: 0.8 },
      { to: () => gripP, speed: 0.3 },
      { run: () => { V2.hoist.grip = holdJoint(V2.hoist.body, T.crate.body); V2.bin = 'hoist'; V2.msg = 'Lifting the bin'; } },
      { to: () => add(gripP, [0, 0.32, 0]), speed: 0.25 },
      { to: () => [DB.stand.x, gripP[1] + 0.32, DB.stand.z], yaw: () => yawNear(Math.PI / 2, V2.hoist.yaw), speed: 0.45 },
      { to: () => [DB.stand.x, DB.stand.hy * 2 + 0.004 + GRIP_Y, DB.stand.z], speed: 0.22 },
      { run: () => { V2.hoist.grip = dropJoint(V2.hoist.grip); V2.bin = 'stand'; setLatches(false); V2.msg = 'Bin on the stand'; } }, { wait: 0.3 },
      { to: () => V2.hoist.park, speed: 0.8 },
    ];
  }
  function opAttach() {
    let carryY = 0;
    return [
      { run: () => { V2.msg = 'Hoist fetching the bin'; } },
      { to: () => add(V(T.crate.body.translation()), [0, GRIP_Y + 0.35, 0]), yaw: () => yawNear(yawOf(T.crate.body.rotation()), V2.hoist.yaw), speed: 0.8 },
      { to: () => add(V(T.crate.body.translation()), [0, GRIP_Y, 0]), speed: 0.3 },
      { run: () => { V2.hoist.grip = holdJoint(V2.hoist.body, T.crate.body); V2.bin = 'hoist'; setLatches(true); carryY = pocketPose().p[1] + 0.32 + GRIP_Y; V2.msg = 'Carrying the bin over'; } },
      { to: () => [V2.hoist.pos[0], carryY, V2.hoist.pos[2]], speed: 0.25 },
      { to: () => { const pp = pocketPose().p; return [pp[0], carryY, pp[2]]; }, yaw: () => yawNear(pocketPose().yaw, V2.hoist.yaw), speed: 0.45, live: true },
      { to: () => add(pocketPose().p, [0, GRIP_Y + 0.004, 0]), yaw: () => yawNear(pocketPose().yaw, V2.hoist.yaw), speed: 0.2, live: true },
      { run: () => { V2.hoist.grip = dropJoint(V2.hoist.grip); V2.bin = 'loose'; V2.msg = 'Settling'; } }, { wait: 0.5 },
      { run: () => { setLatches(false); lockBin(); V2.msg = 'Bin locked on'; } },
      { to: () => [V2.hoist.pos[0], 2.0, V2.hoist.pos[2]], speed: 0.6 },
      { to: () => V2.hoist.park, speed: 0.8 },
    ];
  }

  // ---- the grab arm (slot 2): the real arm's rig as five more hinges plus the jaw on the trolley's multibody, each with its servo on a
  //      generic impulse joint. Its bodies are built in the reference pose REF with the chassis' rotation (multibody coordinates start at
  //      zero there); each link's colliders and drawing sit in its body at REF's rotation. Its colliders stay off until it has folded to
  //      the stow, so it can be fitted anywhere without striking what is near.
  const ARMB = [{ name: 'arm_base', nodes: ['arm_base'] }, { name: 'arm_shoulder', nodes: ['arm_shoulder'] }, { name: 'arm_elbow', nodes: ['arm_elbow'] },
    { name: 'arm_wrist_roll', nodes: ['arm_wrist_roll'] }, { name: 'arm_wrist_pitch', nodes: ['arm_wrist_pitch', 'claw_body'] }, { name: 'claw_jaw', nodes: ['claw_jaw'] }];
  const NODE = new Map(ARM_NODES.map((n) => [n.name, n])), PARENT_BODY = { claw_jaw: 'arm_wrist_pitch' };
  const toQ = (q) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
  function setArmSolid(on) {
    const A = V2.arm; A.solid = on; const g = on ? COLLIDE.arm : COLLIDE.none;
    for (const p of A.parts) for (const c of p.cols) { c.setCollisionGroups(g); c.setSolverGroups(g); }
    if (A.mountCol) { A.mountCol.setCollisionGroups(g); A.mountCol.setSolverGroups(g); }
  }
  function mountArm() {
    if (V2.arm.parts.length) return;
    const ch = T.chassis.body, q = ch.rotation(), P0 = V(ch.translation());
    const A = V2.arm; A.byName.clear();
    // the welded bracket: a collider on the chassis itself
    const mn = NODE.get('arm_mount'), mc = add(MOUNT, mn.col.c);
    A.mountCol = world.createCollider(R.ColliderDesc.cuboid(...mn.col.h).setTranslation(...mc).setDensity(0).setFriction(0.5).setRestitution(0.02).setCollisionGroups(COLLIDE.none).setSolverGroups(COLLIDE.none), ch);
    for (const b of ARMB) {
      const F = REF_FK[b.name], head = NODE.get(b.name);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...add(P0, qrot(q, F.p))).setRotation(q).setCanSleep(false).setSoftCcdPrediction(0.02));
      const cols = [];
      let mass = 0, com = [0, 0, 0], ext = [0, 0, 0];
      for (const nn of b.nodes) {
        const n = NODE.get(nn), f = REF_FK[nn], off = sub(f.p, F.p), qq = [f.q[0], f.q[1], f.q[2], f.q[3]];
        const c = add(off, armRot(qq, n.col.c));
        cols.push(world.createCollider(R.ColliderDesc.cuboid(...n.col.h).setTranslation(...c).setRotation(toQ(qq)).setDensity(0).setFriction(nn === 'claw_jaw' || nn === 'claw_body' ? 1.0 : 0.5).setRestitution(0.02)
          .setCollisionGroups(COLLIDE.none).setSolverGroups(COLLIDE.none), body));
        com = add(com, c.map((v) => v * n.mass)); mass += n.mass; ext = ext.map((v, i) => Math.max(v, n.col.h[i] * 2));
      }
      com = com.map((v) => v / mass);
      body.setAdditionalMassProperties(mass, vec(com), { x: mass * (ext[1] ** 2 + ext[2] ** 2) / 12, y: mass * (ext[0] ** 2 + ext[2] ** 2) / 12, z: mass * (ext[0] ** 2 + ext[1] ** 2) / 12 }, { x: 0, y: 0, z: 0, w: 1 }, true);
      const pname = PARENT_BODY[b.name] || head.parent, parent = pname === 'arm_mount' ? { body: ch, at: [0, 0, 0] } : A.byName.get(pname);
      const pivotRel = pname === 'arm_mount' ? F.p : sub(F.p, REF_FK[pname].p);
      const pq = REF_FK[head.parent].q, ax = armRot([pq[0], pq[1], pq[2], pq[3]], head.axis);   // the hinge axis, at REF, in the chassis frame
      const mb = world.createMultibodyJoint(R.JointData.revolute(vec(pivotRel), { x: 0, y: 0, z: 0 }, vec(ax)), parent.body, body, true); mb.setContactsEnabled(false);
      const ij = world.createImpulseJoint(R.JointData.generic(vec(pivotRel), { x: 0, y: 0, z: 0 }, vec(ax), 0), parent.body, body, true); ij.setContactsEnabled(false);
      const h = ij.handle, [k, cdamp, max] = head.servo, iRef = ARM_JOINTS.indexOf(b.name), ref = iRef >= 0 ? REF[iRef] : 0;
      J.jointConfigureMotorModel(h, 3, 1); J.jointSetLimits(h, 3, (head.limit[0] - ref) * DEG, (head.limit[1] - ref) * DEG);
      J.jointConfigureMotor(h, 3, 0, 0, k, cdamp); J.jointSetMotorMaxForce(h, 3, max);
      const part = { name: b.name, role: 'arm', link: b.name, spec: { mass, joint: { k, c: cdamp, max } }, body, cols, parent: parent.body === ch ? T.chassis : parent, mb, ij, axisLocal: ax, ref };
      A.parts.push(part); A.byName.set(b.name, part);
    }
    A.joints = ARM_JOINTS.map((n) => A.byName.get(n)); A.jaw = A.byName.get('claw_jaw'); A.palm = A.byName.get('arm_wrist_pitch');
    A.cmd = STOW.slice(); A.cmdV = [0, 0, 0, 0, 0]; A.jawCmd = JAW.closed; A.seq = null; A.state = 'mounted'; A.solid = false; A.mountT = 0;
    T.touch = T.parts.flatMap((p) => p.cols).concat(A.parts.flatMap((p) => p.cols));
    sim.events.push({ type: 'arm', state: 'mounted' });
  }
  function unmountArm(to = 'rack') {
    const A = V2.arm; releaseGrasp();
    for (const p of [...A.parts].reverse()) if (world.getRigidBody(p.body.handle)) world.removeRigidBody(p.body);
    if (A.mountCol) { try { world.removeCollider(A.mountCol, true); } catch (e) { /* gone with the chassis */ } A.mountCol = null; }
    A.parts = []; A.byName.clear(); A.joints = []; A.jaw = null; A.palm = null; A.seq = null; A.state = to;
    T.touch = T.parts.flatMap((p) => p.cols);
    sim.events.push({ type: 'arm', state: to });
  }
  function releaseGrasp() {
    const A = V2.arm; if (!A.grasp) return;
    const it = A.grasp.item; A.grasp.joint = dropJoint(A.grasp.joint); it.state = 'floor'; it.held = false; A.grasp = null;
    it.dropT = sim.t;   // it falls out of the open ring: clear of the arm's colliders for 0.8 s (everything else still meets it)
  }
  /** the arm's joint angles now (deg, absolute, JOINTS order) */
  const armQ = () => V2.arm.joints.map((p) => hinge(p).ang / DEG + p.ref);
  /** v5: does the claw fit it? the trash by its ring flag; a supply by its grip (what the claw closes round) and mass against the arm's stats */
  const fits = (it) => (it.spec.supply ? (it.spec.grip <= sim.armStats.grip + 1e-6 && it.spec.mass <= sim.armStats.payload + 1e-6) : !!it.spec.ringable);
  /** the trash the claw can take: in front within reach, low, small enough for the ring; nearest first (v6: `skip(it)` leaves some alone) */
  function reachable(skip = null) {
    const ch = T.chassis.body, q = ch.rotation(), P0 = V(ch.translation()), out = [];
    for (const it of V2.items) {
      if (it.state !== 'floor' || it.inBin || !fits(it) || (skip && skip(it))) continue;
      const p = qrot(qconj(q), sub(V(it.body.translation()), P0)), dx = p[0] - REACH.yawAxisX, dz = p[2];
      const d = Math.hypot(dx, dz), bearing = Math.abs(Math.atan2(dz, dx)) / DEG;
      let top = -Infinity, bot = Infinity; for (const c of it.cols) { top = Math.max(top, sim.reach(c, [0, 1, 0])); bot = Math.min(bot, -sim.reach(c, [0, -1, 0])); }
      const topL = top - P0[1];
      if (d >= REACH.min && d <= REACH.max * (sim.armStats.reach || 1) && bearing <= REACH.bearing && topL <= REACH.top && topL > -0.05) out.push({ it, p, d, top: topL, bot: bot - P0[1] });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  /** GRAB: plan the whole reach - grip - lift - drop (or set back down) sequence */
  /** where the claw sets a carried item down: on the floor ahead of the trolley (chassis frame) */
  function setDownPlan() {
    const it = V2.arm.grasp.item, y = Math.max(0.05, Math.min(0.16, it.spec.size[1] / 2 + 0.01));
    for (const [x, z] of [[1.05, 0], [1.15, 0.25], [1.15, -0.25], [0.95, 0.35], [0.95, -0.35]]) {
      const at = solve([x, y, z]), raise = at && solve([x, y + 0.42, z], at);
      if (at && raise) return { at, raise };
    }
    return null;
  }
  // v6 (the stacking game, stack.js): grab({ keep, high, skip }): keep = the claw keeps the item even with the bin on (to place it);
  // high = ring it high up (the closed jaw reaches JAW_BELOW past the ring's centre: so its tip stays over the item's bottom and a
  // placed item can go down onto another); skip(it) = leave that one alone (the stack's own items)
  function grab(opts = {}) {
    const A = V2.arm;
    if (A.state !== 'mounted') return { ok: false, why: 'no arm on the front mount' };
    if (A.seq) return { ok: false, why: 'the arm is busy' };
    if (!A.solid) return { ok: false, why: 'the arm is still folding' };
    if (V2.batt.limp) return { ok: false, why: limpWhy(V2.batt) };
    if (V2.op) return { ok: false, why: 'the dock is working' };
    if (A.grasp) {   // carrying something: into the bin if it is on, else down on the floor ahead
      const it = A.grasp.item;
      if (binOnDeck()) A.seq = { stages: [{ pose: LIFT }, { pose: OVER_BIN }, { wait: 0.2 }, { run: () => releaseGrasp() }, { jaw: JAW.open, wait: 0.35 }, { pose: STOW, jaw: JAW.closed }], i: 0, t: 0, item: it, toBin: true };
      else {
        const pl = setDownPlan(); if (!pl) return { ok: false, why: 'no room to set it down' };
        A.seq = { stages: [{ pose: pl.raise }, { pose: pl.at, slow: true }, { run: () => releaseGrasp() }, { jaw: JAW.open, wait: 0.3 }, { pose: pl.raise }, { pose: STOW, jaw: JAW.closed }], i: 0, t: 0, item: it, toBin: false };
      }
      sim.events.push({ type: 'grab', kind: it.kind, carried: true });
      return { ok: true, kind: it.kind, toBin: binOnDeck(), from: 'carry' };
    }
    const cand = reachable(opts.skip); if (!cand.length) { A.note = 'nothing in reach'; return { ok: false, why: 'nothing in reach' }; }
    let pick = null;
    for (const c of cand) {   // the nearest one the IK can reach
      const yc = opts.high ? Math.max(c.p[1], Math.min(c.bot + JAW_BELOW + 0.005, c.top - 0.01)) : c.p[1];
      const y = Math.max(0.05, Math.min(opts.high ? 0.2 : 0.16, yc)), at = solve([c.p[0], y, c.p[2]]), pre = at && solve([c.p[0], y + 0.16, c.p[2]], at), raise = at && solve([c.p[0], y + 0.42, c.p[2]], pre);
      if (at && pre && raise) { pick = { it: c.it, at, pre, raise }; break; }
    }
    if (!pick) return { ok: false, why: 'out of reach' };
    const { it, at, pre, raise } = pick, toBin = binOnDeck() && !opts.keep;
    if (toBin && sim.canStow) { const room = sim.canStow(it); if (room && !room.ok) return { ok: false, why: room.why || 'the bin is full' }; }
    for (const c of it.cols) { c.setCollisionGroups(COLLIDE.held); c.setSolverGroups(COLLIDE.held); }   // the ring closes round it: no arm contact with it
    const S = [{ pose: pre, jaw: JAW.open }, { pose: at }, { jaw: JAW.closed, wait: 0.35 }, { run: () => tryGrasp(it) }, { pose: raise }];
    if (toBin) S.push({ pose: LIFT }, { pose: OVER_BIN }, { wait: 0.2 }, { run: () => releaseGrasp() }, { jaw: JAW.open, wait: 0.35 }, { pose: STOW, jaw: JAW.closed });
    else S.push({ pose: LIFT });   // no bin on: the claw keeps it and carries it (GRAB again sets it down, or drops it in the bin once it is back)
    A.seq = { stages: S, i: 0, t: 0, from: null, item: it, toBin, keep: !toBin };
    A.note = toBin ? 'reaching' : opts.keep ? 'reaching (keeping it to place)' : 'reaching (no bin: carrying it)';
    sim.events.push({ type: 'grab', kind: it.kind, keep: !!opts.keep });
    return { ok: true, kind: it.kind, toBin, keep: !!opts.keep };
  }

  // ---- v6, stacking (stack.js): PLACE sets the item in the claw down on top of something, gently
  const JAW_BELOW = (() => { const j = NODE.get('claw_jaw').col; return j.c[0] + j.h[0] - GRASP_LOCAL[0]; })();   // 7.8 cm: the closed jaw's tip past the ring's centre
  /** the ring's centre now (world) */
  function graspPoint() { const palm = V2.arm.palm.body, pq = palm.rotation(); return add(V(palm.translation()), qrot(pq, add(sub(REF_FK.claw_body.p, REF_FK.arm_wrist_pitch.p), armRot(REF_FK.claw_body.q, GRASP_LOCAL)))); }
  /** the lowest point of some colliders along the chassis' up, as a height in the chassis frame */
  function lowIn(cols) { const ch = T.chassis.body, up = qrot(ch.rotation(), [0, 1, 0]), dn = up.map((v) => -v); let m = Infinity; for (const c of cols) m = Math.min(m, -sim.reach(c, dn)); return m - dot(V(ch.translation()), up); }
  /** where the claw's item really is against where it should end: the move (chassis frame) that puts its centre over (x, z) and its
   *  bottom `clear` over `top` (clear: `gap`, or more if the closed jaw reaches below the item, so its tip stays 6 mm up) */
  function placeMeasure(it, at, gap) {
    const ch = T.chassis.body, q = ch.rotation(), P0 = V(ch.translation()), L = (w) => qrot(qconj(q), sub(w, P0));
    const c = L(V(it.body.translation())), bot = lowIn(it.cols), jaw = lowIn(V2.arm.jaw.cols.concat(V2.arm.palm.cols)), S = L([at.x, at.top, at.z]);
    const clear = Math.max(gap, bot - jaw + 0.006);
    return { d: [S[0] - c[0], S[1] + clear - bot, S[2] - c[2]], clear };
  }
  /** can the claw set its item down at `at` = { x, z, top } (world)? -> { over: the ring's centre over it (chassis frame), overQ } or null */
  function placePlan(at, gap = 0.004) {
    const A = V2.arm; if (A.state !== 'mounted' || !A.grasp) return null;
    const ch = T.chassis.body, q = ch.rotation(), S = qrot(qconj(q), sub([at.x, at.top, at.z], V(ch.translation())));
    const below = A.grasp.below != null ? A.grasp.below : A.grasp.item.spec.size[1] / 2, y = S[1] + below + Math.max(gap, JAW_BELOW - below + 0.006);
    const over = [S[0], y + 0.12, S[2]], overQ = solve(over), down = overQ && solve([S[0], y, S[2]], overQ), up = down && solve([S[0], y + 0.15, S[2]], down);
    return overQ && down && up ? { over, overQ } : null;
  }
  /** PLACE: the item in the claw set down at `at` = { x, z, top } (world: the point it goes on and that surface's height). The claw takes
   *  it over the spot 12 cm up; a measured correction (where the item really hangs in the ring, and the servos' sag) moves it over (x, z)
   *  and lowers it slowly till it is a few mm over the surface; a second one trims what is left; it lets go, opens, rises straight up
   *  and folds back to the stow. Its events: 'place' (start), 'placed' (let go), 'placeDone' { ok, why }. -> { ok, why } */
  function place(at, { gap = 0.004, tag = null } = {}) {
    const A = V2.arm;
    if (A.state !== 'mounted') return { ok: false, why: 'no arm on the front mount' };
    if (A.seq) return { ok: false, why: 'the arm is busy' };
    if (!A.grasp) return { ok: false, why: 'the claw holds nothing' };
    if (V2.batt.limp) return { ok: false, why: limpWhy(V2.batt) };
    if (V2.op) return { ok: false, why: 'the dock is working' };
    const plan = placePlan(at, gap); if (!plan) return { ok: false, why: 'out of reach' };
    const it = A.grasp.item, seq = { stages: null, i: 0, t: 0, from: null, item: it, toBin: false, keep: true, place: { at, gap, tag, phase: 'over', failed: null } };
    let cmd = plan.over;   // the ring's centre as commanded (chassis frame)
    const fail = (why) => { seq.place.failed = why; seq.stages.splice(seq.i + 1, seq.stages.length, { pose: LIFT }); };   // keep it in the claw
    const correct = (fine) => () => {
      if (!A.grasp) return fail('lost it');
      const m = placeMeasure(it, at, gap); if (fine && Math.hypot(...m.d) < 0.002) return;   // close enough: the next pose stays empty
      const next = add(cmd, m.d), qq = solve(next, A.cmd.slice()); if (!qq) return fail('out of reach');
      cmd = next; seq.stages[seq.i + 1].pose = qq; seq.place.phase = 'down';
    };
    seq.stages = [{ pose: plan.overQ }, { wait: 0.35 }, { run: correct(false) }, { pose: null, slow: true }, { wait: 0.3 }, { run: correct(true) }, { pose: null, slow: true }, { wait: 0.25 },
      { run: () => { seq.place.phase = 'release'; releaseGrasp(); sim.events.push({ type: 'placed', id: it.id, kind: it.kind, tag }); } }, { jaw: JAW.open, wait: 0.3 },
      { run: () => { seq.stages[seq.i + 1].pose = solve(add(cmd, [0, 0.15, 0]), A.cmd.slice()); seq.place.phase = 'up'; } }, { pose: null }, { pose: STOW, jaw: JAW.closed }];
    A.seq = seq; A.note = 'placing';
    sim.events.push({ type: 'place', id: it.id, kind: it.kind, tag });
    return { ok: true, kind: it.kind, from: 'place' };
  }
  /** is it in the ring? then a fixed joint holds it to the claw */
  function tryGrasp(it) {
    const A = V2.arm, palm = A.palm.body, gp = graspPoint();
    const c = V(it.body.translation()), d = Math.hypot(c[0] - gp[0], c[2] - gp[2]), dy = Math.abs(c[1] - gp[1]);
    const tolY = it.spec.supply ? Math.max(it.spec.size[1] / 2 + 0.03, 0.07) : it.spec.size[1] / 2 + 0.03;   // v5: a flat supply is pinched by the jaw's tips at floor level
    if (!(d < 0.065 && dy < tolY)) { A.note = 'missed'; for (const col of it.cols) { col.setCollisionGroups(COLLIDE.trash); col.setSolverGroups(COLLIDE.trash); } sim.events.push({ type: 'grasp', ok: false, kind: it.kind, d }); A.seq.stages = [{ jaw: JAW.open, wait: 0.3 }, { pose: STOW, jaw: JAW.closed }]; A.seq.i = -1; A.seq.keep = false; return; }
    A.grasp = { item: it, joint: holdJoint(palm, it.body), below: gp[1] - lowIn(it.cols) - V(T.chassis.body.translation())[1] }; it.state = 'grasped'; it.held = true; it.wasGrasped = true;   // v6: below = the ring's centre over the item's bottom (for PLACE)
    for (const col of it.cols) { col.setCollisionGroups(COLLIDE.held); col.setSolverGroups(COLLIDE.held); }
    A.note = 'got it'; sim.events.push({ type: 'grasp', ok: true, kind: it.kind });
  }
  const smooth = (u) => u * u * (3 - 2 * u);
  /** one step of the arm: the sequence's targets, gravity compensation, the servos */
  function armControl() {
    const A = V2.arm; if (A.state !== 'mounted' || !A.parts.length) return;
    const seq = A.seq;
    if (seq) {
      const st = seq.stages[seq.i];
      if (st && seq.t === 0) {   // a stage starts
        if (st.jaw != null) A.jawCmd = st.jaw;
        if (st.pose) { seq.from = A.cmd.slice(); const dq = Math.max(...[0, 1, 2, 4].map((k) => Math.abs(st.pose[k] - seq.from[k]))) * DEG; seq.dur = Math.max(0.35, dq / (RATE * (sim.armStats.rate || 1)) * (st.slow ? 1.6 : 1)) + 0.1; }
      }
      if (st && st.run && seq.t === 0) { st.run(); seq.i++; seq.t = 0; }
      else if (st) {
        seq.t += DT;
        if (st.pose) {
          const u = Math.min(1, seq.t / seq.dur), s = smooth(u), ds = 6 * u * (1 - u) / seq.dur;
          for (let k = 0; k < 5; k++) { A.cmd[k] = seq.from[k] + (st.pose[k] - seq.from[k]) * s; A.cmdV[k] = (st.pose[k] - seq.from[k]) * ds; }
          if (u >= 1) { seq.i++; seq.t = 0; A.cmdV = [0, 0, 0, 0, 0]; }
        } else if (seq.t >= (st.wait || 0)) { seq.i++; seq.t = 0; }
      }
      if (seq.i >= seq.stages.length) { A.seq = null; A.cmdV = [0, 0, 0, 0, 0]; if (A.grasp && !seq.keep) releaseGrasp(); A.note = A.grasp ? 'carrying' : '';
        if (seq.work) sim.events.push({ type: 'workDone', tag: seq.work, ok: !seq.failed });
        else if (seq.place) sim.events.push({ type: 'placeDone', id: seq.item.id, kind: seq.item.kind, ok: !seq.place.failed, why: seq.place.failed, tag: seq.place.tag, carrying: !!A.grasp });
        else sim.events.push({ type: 'grabDone', kind: seq.item.kind, carrying: !!A.grasp }); }
    }
    // gravity compensation: each servo's target moves by the torque gravity puts on everything outboard of it (and the held item)
    const g = [0, -9.81, 0];
    for (let k = 0; k < A.joints.length; k++) {
      const jp = A.joints[k], s = jp.spec.joint;
      let tg = 0;
      if (k > 0) {
        const piv = V(jp.body.translation()), axis = qrot(jp.parent.body.rotation(), jp.axisLocal);
        const torq = (c, m) => { const r = sub(c, piv); return m * dot([r[1] * g[2] - r[2] * g[1], r[2] * g[0] - r[0] * g[2], r[0] * g[1] - r[1] * g[0]], axis); };
        for (let i = k; i < A.parts.length; i++) tg += torq(V(A.parts[i].body.worldCom()), A.parts[i].spec.mass);
        if (A.grasp) tg += torq(V(A.grasp.item.body.worldCom()), A.grasp.item.spec.mass);
      }
      const target = (A.cmd[k] - jp.ref) * DEG - tg / s.k;
      J.jointConfigureMotor(jp.ij.handle, 3, target, (A.cmdV[k] || 0) * DEG, s.k, s.c);
      jp.cmdRad = target; jp.cmdVel = (A.cmdV[k] || 0) * DEG;
    }
    { const s = A.jaw.spec.joint, t = A.jawCmd * DEG; J.jointConfigureMotor(A.jaw.ij.handle, 3, t, 0, s.k, s.c); A.jaw.cmdRad = t; A.jaw.cmdVel = 0; }
    // folded to the stow after being fitted: its colliders come on
    if (!A.solid) { A.mountT += DT; const q = armQ(); if (A.mountT > 0.4 && q.every((v, k) => Math.abs(v - STOW[k]) < 4)) setArmSolid(true); }
  }
  /** the arm servos' torque and speed now (for the battery) */
  function armLoads() {
    const A = V2.arm; if (!A.parts.length) return [];
    return A.parts.filter((p) => p.cmdRad != null).map((p) => { const h = hinge(p), s = p.spec.joint; return { tau: clamp(s.k * (p.cmdRad - h.ang) + s.c * (p.cmdVel - h.rate), -s.max, s.max), omega: h.rate }; });
  }

  /** v5: the arm's salvage work on something beside a01: it turns to it, reaches out low and works its jaw for `seconds` (real servo
   *  motion: the battery pays for it), then folds back. `at` = the target's point in the world; tag comes back on 'workDone' */
  function armWork(at, seconds, tag) {
    const A = V2.arm;
    if (A.state !== 'mounted') return { ok: false, why: 'no arm on the front mount' };
    if (A.seq) return { ok: false, why: 'the arm is busy' };
    if (!A.solid) return { ok: false, why: 'the arm is still folding' };
    if (A.grasp) return { ok: false, why: 'the claw is holding something' };
    if (V2.batt.limp) return { ok: false, why: limpWhy(V2.batt) };
    if (V2.op) return { ok: false, why: 'the dock is working' };
    const ch = T.chassis.body, q = ch.rotation(), P0 = V(ch.translation()), p = qrot(qconj(q), sub(at, P0));
    const bearing = Math.atan2(p[2], p[0] - REACH.yawAxisX), d = Math.max(REACH.min + 0.1, Math.min(0.72, Math.hypot(p[0] - REACH.yawAxisX, p[2])));
    if (Math.abs(bearing) / DEG > REACH.bearing) return { ok: false, why: 'turn to face it' };
    let pose = null, lift = null;
    for (const k of [1, 0.85, 0.7]) { const tx = REACH.yawAxisX + Math.cos(bearing) * d * k, tz = Math.sin(bearing) * d * k; pose = solve([tx, 0.3, tz]); lift = pose && solve([tx, 0.5, tz], pose); if (pose && lift) break; }
    if (!pose || !lift) return { ok: false, why: 'out of reach' };
    const S = [{ pose: lift, jaw: JAW.open }, { pose }];
    for (let t = 0; t < seconds; t += 0.7) S.push({ jaw: JAW.closed, wait: 0.35 }, { jaw: JAW.open, wait: 0.35 });
    S.push({ pose: lift, jaw: JAW.closed }, { pose: STOW });
    A.seq = { stages: S, i: 0, t: 0, from: null, item: { kind: null }, toBin: false, work: tag }; A.note = 'working';
    sim.events.push({ type: 'work', tag }); return { ok: true };
  }
  /** v5: what the bin carries weighs on the trolley: the crate's mass is its own plus the load (kg) */
  function setBinLoad(kg) {
    kg = Math.max(0, Math.min(150, kg || 0)); if (Math.abs(kg - (V2.binLoad || 0)) < 1e-3 || !T.crate) { V2.binLoad = kg; return; }
    V2.binLoad = kg; const s = T.crate.spec, m = s.mass + kg, k = m / s.mass, com = toLocal(s.com, s.pivot), I = inertiaOf(s);
    T.crate.body.setAdditionalMassProperties(m, { x: com[0], y: com[1] - 0.05 * kg / m, z: com[2] }, { x: I[0] * k, y: I[1] * k, z: I[2] * k }, { x: 0, y: 0, z: 0, w: 1 }, true);
  }

  // ---- trash, the arm kit and barriers (spawned through events: sim.apply)
  function spawnItem(kind, x, z, yawDeg = 0, y = 0) {
    const k = sim.kinds[kind]; if (!k) return null;
    const [sx, sy, sz] = k.size, q = qaxis([0, 1, 0], yawDeg * DEG);
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y + sy / 2 + 0.003, z).setRotation(q).setSoftCcdPrediction(0.02).setLinearDamping(0.05).setAngularDamping(0.15));
    let d;
    if (k.shape === 'cyl') d = R.ColliderDesc.roundCylinder(sy / 2 - 0.01, sx / 2 - 0.01, 0.01);
    else if (k.shape === 'round') d = R.ColliderDesc.roundCuboid(sx / 2 - k.round, sy / 2 - k.round, sz / 2 - k.round, k.round);
    else d = R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
    d.setMass(k.mass).setFriction(k.friction).setRestitution(k.restitution).setCollisionGroups(COLLIDE.trash).setSolverGroups(COLLIDE.trash);
    const col = world.createCollider(d, body);
    const it = { id: V2.nextId++, kind, spec: k, body, cols: [col], state: 'floor', inBin: false, binT: 0, banked: false, spilled: false, prevV: [0, 0, 0], held: false };
    V2.items.push(it); sim.events.push({ type: 'trashSpawned', id: it.id, kind, x, z });
    return it;
  }
  function removeItem(it) { if (V2.arm.grasp && V2.arm.grasp.item === it) releaseGrasp(); if (world.getRigidBody(it.body.handle)) world.removeRigidBody(it.body); V2.items = V2.items.filter((o) => o !== it); sim.events.push({ type: 'trashRemoved', id: it.id }); }
  function placeKit(pose = ARM_KIT) {
    if (V2.kit) { world.removeRigidBody(V2.kit.body); V2.kit = null; }
    const [sx, sy, sz] = ARM_KIT.size;
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pose.x, sy / 2 + 0.003, pose.z).setRotation(qaxis([0, 1, 0], (pose.yawDeg || 0) * DEG)).setSoftCcdPrediction(0.02));
    const col = world.createCollider(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setMass(ARM_KIT.mass).setFriction(0.6).setRestitution(0.02).setCollisionGroups(COLLIDE.trash).setSolverGroups(COLLIDE.trash), body);
    const sensor = world.createCollider(R.ColliderDesc.cuboid(sx / 2 + 0.03, sy / 2 + 0.03, sz / 2 + 0.03).setSensor(true).setCollisionGroups(COLLIDE.trash).setSolverGroups(0), body);
    V2.kit = { body, col, sensor };
    if (V2.arm.state === 'map' || V2.arm.state === 'carried') V2.arm.state = 'map';
  }
  /** the spare batteries: touched by the trolley's body, each tops the pack up */
  function placePickups(list = BATTERY_PICKUPS) {
    for (const p of V2.pickups) if (world.getRigidBody(p.body.handle)) world.removeRigidBody(p.body);
    V2.pickups = [];
    for (const [x, z] of list) {
      const k = PICKUPS.battery, [sx, sy, sz] = k.size;
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, sy / 2 + 0.003, z).setSoftCcdPrediction(0.02));
      const col = world.createCollider(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setMass(k.mass).setFriction(0.6).setRestitution(0.02).setCollisionGroups(COLLIDE.trash).setSolverGroups(COLLIDE.trash), body);
      const sensor = world.createCollider(R.ColliderDesc.cuboid(sx / 2 + 0.03, sy / 2 + 0.03, sz / 2 + 0.03).setSensor(true).setCollisionGroups(COLLIDE.trash).setSolverGroups(0), body);
      V2.pickups.push({ id: V2.nextId++, kind: 'battery', body, col, sensor });
    }
    sim.events.push({ type: 'pickups', n: V2.pickups.length });
  }
  function apply(cmd) {
    if (!cmd) return false;
    if (cmd.type === 'door') { V2.door.target = cmd.open ? 1 : 0; return true; }
    if (cmd.type === 'spawnTrash') {   // v4: y = a drop from the hall's ceiling chute (Juli's chute_drop): a real fall, its CCD hard while it falls
      const it = spawnItem(cmd.kind, cmd.x, cmd.z, cmd.yawDeg || 0, Math.max(0, Math.min(2.3, +cmd.y || 0)));
      if (it && cmd.y > 0.2) { it.body.enableCcd(true); it.chuteT = sim.t; if (cmd.spin) it.body.setAngvel({ x: cmd.spin[0], y: cmd.spin[1], z: cmd.spin[2] }, true); }
      if (it) dropPose(it, cmd);   // v6: lying on its side, thrown out of a chute's angled mouth (the stacking game's roller)
      return !!it;
    }
    if (cmd.type === 'obstacle') {
      const old = V2.obstacles.get(cmd.id); if (old) { world.removeRigidBody(old.body); V2.obstacles.delete(cmd.id); sim.events.push({ type: 'obstacle', id: cmd.id, on: false }); }
      if (!cmd.on) return true;
      const [bx, by, bz] = BARRICADE.size, body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(cmd.x, by / 2 + 0.003, cmd.z).setRotation(qaxis([0, 1, 0], (cmd.yawDeg || 0) * DEG)).setSoftCcdPrediction(0.02));
      world.createCollider(R.ColliderDesc.cuboid(bx / 2, by / 2, bz / 2).setMass(BARRICADE.mass).setFriction(0.7).setCollisionGroups(COLLIDE.trash).setSolverGroups(COLLIDE.trash), body);
      V2.obstacles.set(cmd.id, { id: cmd.id, body }); sim.events.push({ type: 'obstacle', id: cmd.id, on: true }); return true;
    }
    return false;
  }

  /** v6: a spawned item lying on its side (`lie`: its own axis level, across its heading) and thrown (`vel`: at most 1.5 m/s level, never up) */
  function dropPose(it, cmd) {
    const f = (v) => (Number.isFinite(+v) ? +v : 0);
    if (cmd.lie) it.body.setRotation(qmul(qaxis([0, 1, 0], f(cmd.yawDeg) * DEG), qaxis([1, 0, 0], Math.PI / 2)), true);
    if (Array.isArray(cmd.vel)) { const vx = f(cmd.vel[0]), vz = f(cmd.vel[2]), h = Math.hypot(vx, vz), k = h > 1.5 ? 1.5 / h : 1; it.body.setLinvel({ x: vx * k, y: Math.min(0, f(cmd.vel[1])), z: vz * k }, true); }
  }

  // ============================================================================================== v6: the stacking arena (stack_spec.js)
  // Built only while the stacking game runs (stack.js builds and removes it). The pad's top plate: a kinematic body set flush in the
  // floor (1 mm proud); its rattle is its own kinematic motion, so what stands on it is shaken through real contacts, and it never moves
  // with a tyre on it. The floor vent: an air jet; while it gusts, every dynamic body in it gets the jet's force (the dynamic pressure on
  // its cross-section, capped on each body and all told at the jet's momentum flux). The sweeper bot: a dynamic disc driven along its lane
  // by a capped traction force; it stops for a01 and for walls (it pushes neither). Physics only: stack.js decides when (Juli's calls, checked).
  const AR = { on: false, spec: null, plate: null, sw: null, gust: null, rattle: null, pushed: [], jet: { k: 0, total: 0, bodies: 0, trolley: 0 }, look: null };
  sim.arena = AR;
  function buildArena(spec) {
    removeArena(); AR.spec = spec; const { PAD, SWEEPER: W } = spec, L = W.lane;
    // the plate: its origin on its top face's centre; its edge a shallow bevel that runs on below the floor's face (no step anywhere at
    // floor level: a can or the sweeper rolls on)
    const plate = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(PAD.x, PAD.top, PAD.z)), a = PAD.half, b = PAD.half + PAD.chamfer, hull = [];
    for (const [y, s] of [[0, a], [-PAD.bevel, b], [-PAD.thick, b]]) for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) hull.push(u * s, y, v * s);
    // its group: the crate's (the trash, the tyres, the chassis, the arm and a held item meet it as they meet the world), so that the
    // sweeper's casters, which meet only the world, roll on the floor under its 1 mm instead of snagging on its edge
    const PG = groups(G.CRATE, 0xffff);
    const col = world.createCollider(R.ColliderDesc.convexHull(new Float32Array(hull)).setFriction(PAD.friction).setRestitution(0.05).setCollisionGroups(PG).setSolverGroups(PG), plate);
    AR.plate = { body: plate, col, rest: [PAD.x, PAD.top, PAD.z] };
    // the sweeper: three low-friction caster balls on the floor (its wheels roll) under a plastic shell `clear` up (what it nudges things
    // with; high enough that it never even nears the plate: Rapier's predicted contacts 2 cm out snagged a lower shell on the plate's bevel)
    const sb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(L.x0, 0.003, L.z).lockRotations().setCanSleep(false));   // no CCD: 5 mm a step
    const sd = (d, fr, m, g) => world.createCollider(d.setMass(m).setFriction(fr).setRestitution(0.1).setCollisionGroups(g).setSolverGroups(g), sb);
    const cb = W.clear / 2, onFloor = groups(G.TRASH, G.WORLD), shell = groups(G.TRASH, G.WORLD | G.CHASSIS | G.WHEEL | G.TRASH | G.ARM);
    const base = [0, 1, 2].map((k) => sd(R.ColliderDesc.ball(cb).setTranslation(0.08 * Math.cos(k * 2.0944), cb, 0.08 * Math.sin(k * 2.0944)).setFrictionCombineRule(R.CoefficientCombineRule.Min), W.friction, W.mass * 0.05, onFloor));
    const sc = sd(R.ColliderDesc.roundCylinder((W.h - W.clear) / 2 - 0.01, W.r - 0.01, 0.01).setTranslation(0, W.clear + (W.h - W.clear) / 2, 0), W.shell, W.mass * 0.85, shell);
    AR.sw = { body: sb, col: sc, base, at: L.x0, run: null, vcmd: 0, waitT: 0, blocked: false };
    AR.look = new R.Cuboid(W.look / 2, 0.08, W.r * 0.9); AR.gust = null; AR.rattle = null; AR.on = true;
    sim.events.push({ type: 'arena', on: true });
  }
  function removeArena() {
    if (!AR.on) return;
    for (const b of AR.pushed) if (world.getRigidBody(b.handle)) b.resetForces(true);
    for (const x of [AR.plate, AR.sw]) if (x && world.getRigidBody(x.body.handle)) world.removeRigidBody(x.body);
    Object.assign(AR, { on: false, plate: null, sw: null, gust: null, rattle: null, pushed: [] });
    sim.events.push({ type: 'arena', on: false });
  }
  /** start one of the arena's machines: 'vent' (a gust), 'plate' (a rattle along args.dir = [x, z]), 'sweeper' (a pass to its lane's
   *  other end), 'stop' (everything stops) -> { ok, why } */
  function arenaAct(tool, args = {}) {
    if (!AR.on) return { ok: false, why: 'no arena' };
    if (tool === 'stop') { if (AR.gust) { AR.gust = null; sim.events.push({ type: 'vent', on: false }); } if (AR.rattle) endRattle(); if (AR.sw.run) AR.sw.run = null; return { ok: true }; }
    if (AR.gust || AR.rattle || AR.sw.run) return { ok: false, why: 'one at a time' };
    if (tool === 'vent') { AR.gust = { t0: sim.t }; sim.events.push({ type: 'vent', on: true }); return { ok: true }; }
    if (tool === 'plate') {
      if (trolleyOnPlate()) return { ok: false, why: 'a01 is on the plate' };
      const d = Array.isArray(args.dir) ? args.dir : [], dx = +d[0] || 0, dz = +d[1] || 0, n = Math.hypot(dx, dz);
      AR.rattle = { t0: sim.t, dir: n > 1e-6 ? [dx / n, dz / n] : [1, 0] }; wakePad(); sim.events.push({ type: 'rattle', on: true }); return { ok: true };
    }
    if (tool === 'sweeper') {
      const W = AR.sw, L = AR.spec.SWEEPER.lane, to = W.at === L.x0 ? L.x1 : L.x0;
      W.run = { from: W.at, to, back: false }; W.vcmd = 0; W.waitT = 0; sim.events.push({ type: 'sweeper', phase: 'go', to }); return { ok: true };
    }
    return { ok: false, why: 'unknown' };
  }
  /** is a tyre on the pad's plate? (the plate never rattles under a01) */
  function trolleyOnPlate() {
    if (!AR.on) return false; const P = AR.spec.PAD, m = 0.05;
    return T.wheels.some((w) => { const p = w.body.translation(); return Math.abs(p.x - P.x) < P.half + m && Math.abs(p.z - P.z) < P.half + m && p.y < WHEEL_R + 0.03; });
  }
  function wakePad() { const P = AR.spec.PAD; for (const it of V2.items) { const p = it.body.translation(); if (Math.abs(p.x - P.x) < P.half + 0.1 && Math.abs(p.z - P.z) < P.half + 0.1) it.body.wakeUp(); } }
  function endRattle() { AR.rattle = null; AR.plate.body.setNextKinematicTranslation(vec(AR.plate.rest)); AR.plate.body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 }); sim.events.push({ type: 'rattle', on: false }); }
  /** the jet's speed at a world point: a plane jet from the slot (its core, then 1/sqrt(s)), a Gaussian across it, fading past the slot's ends */
  function jetSpeed(p, Vt, d, u0) {
    const r = [p[0] - Vt.x, p[1], p[2] - Vt.z], s = dot(r, d); if (s <= 0.005 || s > Vt.reach) return 0;
    const n = Math.hypot(r[0] - s * d[0], r[1] - s * d[1]), lz = Math.max(0, Math.abs(r[2]) - Vt.len / 2), b = Vt.b0 + Vt.spread * s;
    return u0 * (s < Vt.core ? 1 : Math.sqrt(Vt.core / s)) * Math.exp(-((n / b) ** 2) - ((lz / b) ** 2));
  }
  /** a collider's cross-section against the unit direction d (m²): a cylinder's or a box's shadow on a plane square to d */
  function areaAgainst(col, d) {
    const s = col.shape, ST = R.ShapeType, q = col.rotation(), b = s.borderRadius || 0;
    if (s.type === ST.Cylinder || s.type === ST.RoundCylinder) { const r = s.radius + b, h = s.halfHeight + b, a = Math.min(1, Math.abs(dot(qrot(q, [0, 1, 0]), d))); return 4 * r * h * Math.sqrt(1 - a * a) + Math.PI * r * r * a; }
    if (s.type === ST.Cuboid || s.type === ST.RoundCuboid) { const e = s.halfExtents, x = e.x + b, y = e.y + b, z = e.z + b; return 4 * (y * z * Math.abs(dot(qrot(q, [1, 0, 0]), d)) + x * z * Math.abs(dot(qrot(q, [0, 1, 0]), d)) + x * y * Math.abs(dot(qrot(q, [0, 0, 1]), d))); }
    return 0;
  }
  /** one step of a gust: each dynamic body in the jet gets 1/2 rho u^2 Cd A along it (at most bodyCap; all of them together at most the
   *  jet's momentum flux rho u0^2 x the slot's area) */
  function gustStep() {
    const Vt = AR.spec.VENT, t = sim.t + DT - AR.gust.t0, dur = Vt.rampS * 2 + Vt.holdS;
    if (t >= dur) { AR.gust = null; sim.events.push({ type: 'vent', on: false }); return; }
    const k = Math.max(0, Math.min(1, t / Vt.rampS, (dur - t) / Vt.rampS)), e = Vt.elev * DEG, d = [Math.cos(e), Math.sin(e), 0], u0 = Vt.speed * k, half = 0.5 * Vt.rho;
    const list = [];
    for (const it of V2.items) if (it.state !== 'grasped') list.push({ body: it.body, at: [V(it.body.translation())], A: it.cols.reduce((a, c) => a + areaAgainst(c, d), 0), cd: it.spec.shape === 'cyl' ? Vt.cd.cyl : Vt.cd.box });
    list.push({ body: AR.sw.body, at: [V(AR.sw.body.translation())], A: areaAgainst(AR.sw.col, d), cd: Vt.cd.cyl, sweeper: true });
    list.push({ body: T.chassis.body, at: T.chassis.cols.map((c) => V(c.translation())), A: 0.3, cd: Vt.cd.box, trolley: true });   // the trolley: its fastest-blown part, its ~0.3 m² front
    let total = 0;
    for (const b of list) { let u = 0; for (const p of b.at) u = Math.max(u, jetSpeed(p, Vt, d, u0)); b.F = u > 0.05 ? Math.min(Vt.bodyCap, half * u * u * b.cd * b.A) : 0; total += b.F; }
    const flux = Vt.rho * u0 * u0 * Vt.len * Vt.width, scale = total > flux ? flux / total : 1;
    AR.jet = { k, total: Math.min(total, flux), bodies: 0, trolley: 0 };
    for (const b of list) {
      if (!b.F) continue; const F = b.F * scale;
      b.body.addForce({ x: d[0] * F, y: d[1] * F, z: d[2] * F }, true); if (!b.sweeper) AR.pushed.push(b.body);
      AR.jet.bodies++; if (b.trolley) AR.jet.trolley = F;
    }
  }
  function rattleStep() {
    const P = AR.spec.PLATE, r = AR.rattle, t = sim.t + DT - r.t0, rest = AR.plate.rest;
    if (t >= P.seconds || trolleyOnPlate()) { endRattle(); return; }
    // a loose plate rattling on its frame: it shakes along dir, lifts, and rocks about the level axis across dir (its edges go up and down)
    const env = Math.max(0, Math.min(1, t / P.ramp, (P.seconds - t) / P.ramp)), w = 2 * Math.PI * P.hz, s = P.amp * Math.sin(w * t) * env, up = P.ampV * (1 - Math.cos(w * t)) * env;
    AR.plate.body.setNextKinematicTranslation({ x: rest[0] + r.dir[0] * s, y: rest[1] + up, z: rest[2] + r.dir[1] * s });
    AR.plate.body.setNextKinematicRotation(qaxis([r.dir[1], 0, -r.dir[0]], (P.rock || 0) * DEG * Math.cos(w * t) * env)); wakePad();
  }
  /** the sweeper's bumper sensor: anything of a01's, the item in its claw, or a fixed thing within `look` ahead of it */
  function aheadBlocked(p, dir) {
    const S = AR.spec.SWEEPER, held = V2.arm.grasp ? V2.arm.grasp.item.body.handle : -1, TROLLEY = G.CHASSIS | G.WHEEL | G.CLAMP | G.CRATE | G.ARM | G.OTHER;
    let hit = false;
    world.intersectionsWithShape({ x: p.x + dir * (S.r + S.look / 2), y: 0.11, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, AR.look, (o) => {
      const g = o.collisionGroups() >>> 16, b = o.parent();
      if ((b && b.handle === AR.sw.body.handle) || o.isSensor()) return true;
      if ((g & TROLLEY) || (b && b.handle === held) || (b && b.isFixed() && (g & G.WORLD))) { hit = true; return false; }
      return true;
    });
    return hit;
  }
  /** the sweeper's wheels: a force towards its commanded speed along the lane (and back onto the lane's line; parked, its brakes), never
   *  more than its traction. It stops for what its bumper sensor sees and, after giveUp s, goes back where it came from. */
  function sweeperStep() {
    const W = AR.sw, S = AR.spec.SWEEPER, L = S.lane, b = W.body;
    if (!finite(b)) { b.setTranslation({ x: W.at, y: 0.003, z: L.z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); W.run = null; sim.faults.push({ t: sim.t, what: 'sweeper' }); }
    const p = b.translation(), v = b.linvel(); let vx = null;
    if (W.run) {
      const dir = Math.sign(W.run.to - W.run.from) || 1, was = W.blocked;
      W.blocked = aheadBlocked(p, dir);
      if (W.blocked) { if (!was) sim.events.push({ type: 'sweeper', phase: 'blocked' }); W.waitT += DT; if (W.waitT >= S.giveUp && !W.run.back) { W.run = { from: W.run.to, to: W.run.from, back: true }; W.waitT = 0; W.blocked = false; sim.events.push({ type: 'sweeper', phase: 'back' }); } }
      else W.waitT = 0;
      const d2 = Math.sign(W.run.to - W.run.from) || 1, rem = (W.run.to - p.x) * d2, vmax = W.blocked ? 0 : Math.min(S.speed, Math.sqrt(2 * S.accel * Math.max(0, rem - 0.005)));
      W.vcmd = W.vcmd < vmax ? Math.min(vmax, W.vcmd + S.accel * DT) : Math.max(vmax, W.vcmd - 2 * S.accel * DT);
      vx = d2 * W.vcmd;
      if (rem <= 0.012 && Math.abs(v.x) < 0.03) { W.at = W.run.to; W.run = null; W.vcmd = 0; vx = null; sim.events.push({ type: 'sweeper', phase: 'parked', at: W.at }); }
    } else W.blocked = false;
    const m = S.mass;
    let fx = vx == null ? m * (4 * (W.at - p.x) - 2.5 * v.x) : m * (vx - v.x) / 0.15 + Math.sign(vx) * S.friction * m * 9.81, fz = m * (4 * (L.z - p.z) - 2.5 * v.z);   // (+ its wheels' rolling drag)
    const f = Math.hypot(fx, fz); if (f > S.force) { fx *= S.force / f; fz *= S.force / f; }
    b.resetForces(false); b.addForce({ x: fx, y: 0, z: fz }, true);
  }
  /** each step before the physics: last step's jet forces off, the sweeper's wheels, the gust, the rattle */
  function arenaPre() {
    for (const b of AR.pushed) if (world.getRigidBody(b.handle)) b.resetForces(false);
    AR.pushed = []; AR.jet = { k: 0, total: 0, bodies: 0, trolley: 0 };
    sweeperStep();
    if (AR.gust) gustStep();
    if (AR.rattle) rattleStep();
  }
  function arenaState() {
    if (!AR.on) return null;
    const pl = AR.plate.body.translation(), W = AR.sw, sw = W.body.translation(), sv = W.body.linvel();
    return { plate: { x: pl.x, y: pl.y, z: pl.z, q: AR.plate.body.rotation(), rattling: !!AR.rattle }, vent: { on: !!AR.gust, k: AR.jet.k, force: AR.jet.total, trolley: AR.jet.trolley, bodies: AR.jet.bodies },
      sweeper: { x: sw.x, y: sw.y, z: sw.z, speed: Math.hypot(sv.x, sv.z), moving: !!W.run, blocked: W.blocked, at: W.at, back: !!(W.run && W.run.back) }, trolleyOnPlate: trolleyOnPlate() };
  }

  // ---- spills: a sensor disc on the floor; a tyre touching it gets oil's friction (Rapier's own friction, combined by the minimum)
  function spill(x, y, z) {
    const r = SPILL.start, body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const col = world.createCollider(R.ColliderDesc.cylinder(SPILL.depth / 2, r).setTranslation(x, y + SPILL.depth / 2 - 0.01, z).setSensor(true)
      .setCollisionGroups(groups(G.WORLD, G.WHEEL)).setSolverGroups(0), body);
    const s = { x, y, z, r, t0: sim.t, body, col }; V2.spills.push(s);
    sim.events.push({ type: 'spill', x, y, z }); return s;
  }
  function tyreFriction() {
    for (const w of T.wheels) {
      const c = w.cols[0], p = w.body.translation(); let oil = false, pud = false;
      for (const s of V2.spills) if (world.intersectionPair(s.col, c)) { oil = true; break; }
      if (!oil) for (const s of V2.slicks) {   // the map's puddles and oil (only those near this tyre are asked)
        if (Math.abs(p.x - s.x) > s.r + 0.15 || Math.abs(p.z - s.z) > s.r + 0.15 || !world.intersectionPair(s.col, c)) continue;
        if (s.kind === 'oil') { oil = true; break; } pud = true;
      }
      pud = pud && !oil;
      if (oil !== !!w.oil || pud !== !!w.puddle) {
        w.oil = oil; w.puddle = pud;
        c.setFriction(oil ? Math.min(SPILL.friction, OIL.friction) : pud ? PUDDLE.friction : w.spec.friction);
        c.setFrictionCombineRule(oil || pud ? R.CoefficientCombineRule.Min : R.CoefficientCombineRule.Average);
      }
    }
  }
  // mud and puddles: while a tyre rolls in them, a drag force on it opposite its motion (Rapier integrates it with everything else):
  // rolling resistance (crr x its share of the weight, eased in below 5 cm/s so it never pushes a resting tyre about) plus a churn
  // term proportional to its speed. With mud's lower friction the hub motors' 12 N·m spin the tyres before they reach 1.2 m/s.
  const SHARE = 143.274 * 9.81 / 4;   // N: a tyre's share of the weight
  function groundForces() {
    const B = V2.ground; B.mud = 0; B.puddle = 0;
    for (const w of T.wheels) {
      const b = w.body, p = b.translation(); b.resetForces(false);
      w.onGround = p.y < WHEEL_R + 0.03; w.ground = w.onGround ? groundAt(p.x, p.z) : null;
      const mud = w.ground === 'mud', pud = w.onGround && !!w.puddle;
      if (mud) B.mud++; if (pud) B.puddle++;
      if (!mud && !pud) continue;
      const v = b.linvel(), vh = Math.hypot(v.x, v.z); if (vh < 1e-5) continue;
      const crr = (mud ? GROUND.mud.crr : 0) + (pud ? PUDDLE.crr : 0), churn = (mud ? GROUND.mud.churn : 0) + (pud ? PUDDLE.churn : 0);
      const k = (crr * SHARE * Math.min(1, vh / 0.05) + churn * vh) / vh;
      b.addForce({ x: -v.x * k, y: 0, z: -v.z * k }, true);
    }
  }

  // ---- every step after the physics: the dock, the kit, the items, the spills, the battery
  function watch2() {
    const ch = T.chassis.body, cq = ch.rotation(), P0 = V(ch.translation()), m = motion();
    // the dock
    const pk = DB.park, yaw = yawOf(cq) / DEG, D = V2.dock;
    D.inBay = P0[0] > DB.x0 && P0[0] < DB.x1 && P0[2] > DB.z0 && P0[2] < DB.z1;
    const aligned = D.inBay && Math.abs(P0[0] - pk.x) <= pk.dx && Math.abs(P0[2] - pk.z) <= pk.dz && Math.abs(wrap((yaw - pk.yawDeg) * DEG)) / DEG <= pk.yawTol && upTilt(cq) < 4;
    const still = m.speed < 0.05 && m.spin < 0.1;
    D.parkedT = aligned && (still || V2.op) ? D.parkedT + DT : 0;
    const parked = D.parkedT >= 0.5;
    if (parked !== D.parked) { D.parked = parked; sim.events.push({ type: 'docked', on: parked }); }
    D.aligned = aligned;
    // spare batteries: touched by the trolley's body -> into the pack
    for (const pu of [...V2.pickups]) {
      let touched = false; world.intersectionPairsWith(pu.sensor, (other) => { const b = other.parent(); if (b && b.handle === ch.handle) touched = true; });
      if (touched) { world.removeRigidBody(pu.body); V2.pickups = V2.pickups.filter((x) => x !== pu); V2.batt.e = Math.min(V2.batt.cap, V2.batt.e + PICKUPS.battery.charge * V2.batt.cap); limpCheck(V2.batt); sim.events.push({ type: 'pickup', kind: 'battery', id: pu.id }); }
    }
    // the arm kit: touched by the trolley's body -> carried
    if (V2.kit) {
      let touched = false;
      world.intersectionPairsWith(V2.kit.sensor, (other) => { const b = other.parent(); if (b && b.handle === ch.handle) touched = true; });
      if (touched) { world.removeRigidBody(V2.kit.body); V2.kit = null; V2.arm.state = 'carried'; sim.events.push({ type: 'kit', state: 'carried' }); }
    }
    // the items: in the bin (centre inside its walls, at rest in it for 0.6 s -> banked once), the diesel can's spill
    const kb = T.crate.body, kq = kb.rotation(), kp = V(kb.translation()), kv = V(kb.linvel());
    for (const it of V2.items) {
      const b = it.body, p = V(b.translation()), v = V(b.linvel()), l = qrot(qconj(kq), sub(p, kp));
      it.inBin = Math.abs(l[0]) < 0.375 && Math.abs(l[2]) < 0.365 && l[1] > 0.06 && l[1] < 0.76;   // its centre inside the bin's walls
      if (it.state === 'grasped') { it.binT = 0; }
      else {
        const rel = Math.hypot(v[0] - kv[0], v[1] - kv[1], v[2] - kv[2]);
        it.binT = it.inBin && rel < 0.15 ? it.binT + DT : 0;
        it.state = it.inBin && it.binT > 0.6 ? 'bin' : it.inBin ? it.state : 'floor';
        if (it.state === 'bin' && !it.banked) {
          it.banked = true; const roms = it.spec.hazard && it.spilled ? it.spec.romsSpilled : it.spec.roms;
          sim.events.push({ type: 'banked', id: it.id, kind: it.kind, roms, safe: !it.spilled });
        }
        if (it.spec.hazard === 'diesel' && !it.spilled && !it.inBin && it.dropT == null) {
          const tilt = upTilt(b.rotation()), kick = Math.hypot(v[0] - it.prevV[0], v[1] - it.prevV[1], v[2] - it.prevV[2]);
          const resting = Math.hypot(v[0], v[1], v[2]) < 0.35;   // knocked over = lying tipped (a can falling sideways through the air is not)
          if ((tilt > SPILL.tiltDeg && resting) || kick > SPILL.kick) { it.spilled = true; spill(p[0], Math.max(0, p[1] - it.spec.size[1] / 2 - 0.01), p[2]); it.spillWhy = tilt > SPILL.tiltDeg ? 'tipped' : 'hit'; }
        }
      }
      if (it.dropT != null && sim.t - it.dropT > 0.8) { it.dropT = null; for (const c of it.cols) { c.setCollisionGroups(COLLIDE.trash); c.setSolverGroups(COLLIDE.trash); } }
      it.prevV = v;
    }
    // spills grow to full size over a couple of seconds, then stay
    for (const s of V2.spills) { const r = Math.min(SPILL.radius, SPILL.start + (SPILL.radius - SPILL.start) * (sim.t - s.t0) / SPILL.grow); if (r !== s.r) { s.r = r; s.col.setRadius(r); } }
    // the battery: the hub motors' torque (their speed loop, capped), the servos, the arm; charging when parked in the dock
    const B = V2.batt, wheels = T.wheels.map((w) => { const h = hinge(w); return { tau: clamp(WHEEL_GAIN * ((w.target || 0) - h.rate), -(w.cap || TORQUE_CAP), w.cap || TORQUE_CAP), omega: h.rate }; });
    const mass = 143.274 - (binOnDeck() ? 0 : 39.819) + (binOnDeck() ? V2.binLoad || 0 : 0) + (V2.arm.parts.length ? ARM_MASS : 0);
    let watts = drawWatts({ wheels, speed: m.speed, mass, steering: T.phase === 'steering' ? 4 : 0, arm: armLoads(), mud: V2.ground.mud / 4, puddle: V2.ground.puddle / 4 });
    if (sim.regen) { let brake = 0; for (const w of wheels) brake += Math.max(0, -w.tau * w.omega); watts = Math.max(0, watts - sim.regen * brake); }   // v5: the Dynamo Heart's regenerative braking
    const wasLimp = B.limp; stepBattery(B, watts, DT, D.parked);
    if (B.limp !== wasLimp) sim.events.push({ type: 'limp', on: B.limp });
  }

  // ---------------------------------------------------------------------------------------------- the API
  function step(inp) {
    if (inp) sim.input = inp;
    control(sim.input);
    runOp(); doorStep(); tyreFriction(); groundForces();
    if (AR.on) arenaPre();   // v6: the stacking arena (the sweeper's wheels, the vent's gust, the plate's rattle)
    if (sim.diag) sim.prevSnap = snapshot();
    // rapier.js 0.21: the multibody's colliders move without being marked as moved, so the narrow phase kept the crate's contacts with
    // the deck from when it last settled (measured: the same 8 mm manifold for 300 steps while the deck pitched over the cable cover).
    // Re-setting each trolley collider's offset marks it, and its contacts are computed afresh every step.
    for (const c of T.touch) c.setTranslationWrtParent(c.translationWrtParent());
    world.step();
    sim.t += DT; sim.steps++;
    if (guard()) return;
    watch();
  }
  // a safety net: a body whose state is no longer finite (a solver blow-up) is never kept. Broken trash is removed; a broken trolley
  // (or arm) is rebuilt where it last stood whole. Each one is reported as a 'fault' event (the tests count them).
  const finite = (b) => { const t = b.translation(), v = b.linvel(), w = b.angvel(); return Number.isFinite(t.x + t.y + t.z + v.x + v.y + v.z + w.x + w.y + w.z); };
  sim.faults = [];
  /** what the trolley was doing (kept every step, cheap): handed out with a fault, to say where a blow-up came from */
  function snapshot() {
    const ch = T.chassis.body, p = V(ch.translation()), v = V(ch.linvel());
    const near = V2.items.filter((it) => { const q = it.body.translation(); return Math.hypot(q.x - p[0], q.z - p[2]) < 1.6; }).map((it) => { const q = it.body.translation(); return [it.kind, it.state, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)]; });
    const touching = [];
    for (const w of T.wheels.slice(0, 2)) world.contactPairsWith(w.cols[0], (o) => { const b = o.parent(); const it = b && V2.items.find((x) => x.body.handle === b.handle); touching.push(w.name + '>' + (it ? it.kind : b && b.isFixed() ? 'fixed' : b && b.handle === T.crate.body.handle ? 'crate' : 'body')); });
    return { t: +sim.t.toFixed(2), pos: p.map((x) => +x.toFixed(3)), v: +Math.hypot(...v).toFixed(2), cmd: Object.assign({}, T.cmd), hold: T.hold, mode: T.mode, phase: T.phase, arm: V2.arm.state, solid: V2.arm.solid, seq: !!V2.arm.seq, bin: V2.bin, op: V2.op && V2.op.name, near, touching };
  }
  function guard() {
    if (sim.steps % 30 === 0 && finite(T.chassis.body)) { const p = V(T.chassis.body.translation()); if (Math.abs(p[1]) < 3) T.lastGood = { x: p[0], z: p[2], y: Math.max(0, p[1] - 0.003), yawDeg: yawOf(T.chassis.body.rotation()) / DEG }; }
    let hit = false;
    for (const it of [...V2.items]) if (!finite(it.body)) { sim.faults.push({ t: sim.t, what: 'item ' + it.kind }); sim.events.push({ type: 'fault', what: 'item ' + it.kind }); removeItem(it); hit = true; }
    const bad = T.parts.concat(V2.arm.parts).filter((p) => !finite(p.body)).map((p) => p.name);
    if (bad.length) {
      sim.faults.push({ t: sim.t, what: bad.slice(0, 4).join(','), before: sim.prevSnap || null }); sim.events.push({ type: 'fault', what: bad.slice(0, 4).join(',') });
      if (V2.op) { V2.hoist.grip = dropJoint(V2.hoist.grip); V2.op = null; }
      if (V2.arm.seq) { V2.arm.seq = null; releaseGrasp(); }
      if (!finite(T.crate.body)) V2.bin = 'locked';   // its body goes with the trolley's
      buildTrolley(T.lastGood || { x: START.x, z: START.z, yawDeg: START.yawDeg }); return true;
    }
    return hit;
  }
  function state() {
    const m = motion(), ch = T.chassis.body, p = V(ch.translation());
    return {
      t: sim.t, mode: T.mode, want: T.want, phase: T.phase, hold: T.hold, cmd: Object.assign({}, T.cmd), motion: m,
      pos: p, yaw: yawOf(ch.rotation()), q: ch.rotation(), onLanding: onLanding(), restOnLanding: T.onLanding, done: T.done,
      modules: T.modules.map((x) => ({ name: x.name, ang: hinge(x).ang / DEG, cmd: x.cmd })),
      wheels: T.wheels.map((w) => ({ name: w.name, rate: hinge(w).rate, target: w.target, pos: V(w.body.translation()), ground: w.ground || null, puddle: !!w.puddle, onGround: !!w.onGround })),
      passive: T.passive.map((x) => ({ name: x.name, role: x.role, ang: hinge(x).ang / DEG, limit: x.joint.limit })),
      crate: crateOffset(), ramp: rampState(), v2: v2State(),
    };
  }
  function v2State() {
    const A = V2.arm, B = V2.batt;
    return {
      bin: V2.bin, op: V2.op ? V2.op.name : null, msg: V2.msg, latches: !!V2.latches,
      arm: { state: A.state, busy: !!A.seq, note: A.note, holding: A.grasp ? A.grasp.item.kind : null, carrying: !!(A.grasp && !A.seq), q: A.parts.length ? armQ() : null },
      battery: { frac: fraction(B), limp: B.limp, limpAt: B.limpAt || 0, charging: B.charging && B.e < B.cap, watts: B.watts, avg: B.avg, tier: B.tier, minutes: minutesLeft(B) },
      dock: { inBay: V2.dock.inBay, parked: V2.dock.parked, aligned: !!V2.dock.aligned }, door: V2.door.open,
      items: V2.items.map((it) => ({ id: it.id, kind: it.kind, state: it.state, inBin: it.inBin, banked: it.banked, spilled: it.spilled })),
      spills: V2.spills.map((s) => ({ x: s.x, y: s.y, z: s.z, r: s.r })), kit: !!V2.kit, pickups: V2.pickups.length, tyresInOil: T.wheels.filter((w) => w.oil).length,
      ground: { under: groundAt(V(T.chassis.body.translation())[0], V(T.chassis.body.translation())[2]), mud: V2.ground.mud, puddle: V2.ground.puddle },
    };
  }
  /** what the dock's slot menu offers now; changes are allowed only while parked in the dock */
  function slots() {
    const parked = V2.dock.parked, busy = !!V2.op || !!V2.arm.seq;
    return {
      parked, busy, op: V2.op ? V2.op.name : null, msg: V2.msg,
      top: { item: 'bin', state: V2.bin, action: binOnDeck() ? 'detachBin' : V2.bin === 'stand' ? 'attachBin' : null },
      front: { item: 'arm', state: V2.arm.state, action: V2.arm.state === 'mounted' ? 'unmountArm' : (V2.arm.state === 'carried' || V2.arm.state === 'rack') ? 'mountArm' : null },
    };
  }
  /** a slot change (only in the dock, parked, nothing else running) */
  function dockOp(name) {
    if (!V2.dock.parked) return { ok: false, why: 'park in the dock first' };
    if (V2.op) return { ok: false, why: 'the dock is busy' };
    if (V2.arm.seq) return { ok: false, why: 'the arm is busy' };
    if (name === 'detachBin') {
      if (!binOnDeck()) return { ok: false, why: 'no bin on the trolley' };
      V2.op = { name, stages: opDetach(), i: 0, t: 0, doneMsg: 'Bin on the stand' }; return { ok: true };
    }
    if (name === 'attachBin') {
      if (V2.bin !== 'stand') return { ok: false, why: 'the bin is not off the trolley' };
      const c = V(T.crate.body.translation());
      if (upTilt(T.crate.body.rotation()) > 12) return { ok: false, why: 'the bin is not upright' };
      if (c[0] < DB.gantry.x0 + 0.2 || c[0] > DB.gantry.x1 - 0.3 || c[2] < DB.z0 + 0.3 || c[2] > DB.z1 - 0.1) return { ok: false, why: "the bin is out of the hoist's reach" };
      V2.op = { name, stages: opAttach(), i: 0, t: 0, doneMsg: 'Bin locked on' }; return { ok: true };
    }
    if (name === 'mountArm') {
      if (V2.arm.state !== 'carried' && V2.arm.state !== 'rack') return { ok: false, why: V2.arm.state === 'mounted' ? 'the arm is already mounted' : 'no arm to mount: pick up the arm kit first' };
      mountArm(); V2.msg = 'Grab arm mounted'; return { ok: true };
    }
    if (name === 'unmountArm') {
      if (V2.arm.state !== 'mounted') return { ok: false, why: 'no arm on the mount' };
      unmountArm('rack'); V2.msg = 'Grab arm on the rack'; return { ok: true };
    }
    return { ok: false, why: 'unknown slot action' };
  }
  /** the battery tier changed (bought at the dock): the same charge fraction of a bigger pack */
  function setTier(i) { const f = fraction(V2.batt), limp = V2.batt.limp; Object.assign(V2.batt, battery(i, f)); V2.batt.limp = limp; }
  function setCharge(f) { const B = V2.batt, L = limpLine(B); B.e = B.cap * clamp(f, 0, 1); B.limp = B.e <= 0 || B.e < L.at || (B.limp && B.e < L.exit); }
  /** a fresh run: no trash, no spills, the kit back on the map (main.js lays it out again), the bin locked on, no arm, shutter down */
  function newRun() {
    if (V2.op) { V2.hoist.grip = dropJoint(V2.hoist.grip); V2.op = null; }
    removeArena();   // v6: no stacking arena in a fresh run
    unmountArm('map'); for (const it of [...V2.items]) removeItem(it);
    for (const sp of V2.spills) world.removeRigidBody(sp.body); V2.spills = [];
    for (const o of V2.obstacles.values()) world.removeRigidBody(o.body); V2.obstacles.clear();
    if (V2.kit) { world.removeRigidBody(V2.kit.body); V2.kit = null; }
    for (const pu of V2.pickups) if (world.getRigidBody(pu.body.handle)) world.removeRigidBody(pu.body); V2.pickups = [];
    if (!binOnDeck()) { V2.bin = 'locked'; if (T.crate && world.getRigidBody(T.crate.body.handle)) world.removeRigidBody(T.crate.body); T.crate = null; }
    V2.hoist.pos = V2.hoist.park.slice(); V2.hoist.yaw = 0; V2.hoist.body.setTranslation(vec(V2.hoist.park), true); V2.hoist.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    V2.door.target = 0; V2.door.open = 0.0001; doorStep(); V2.door.open = 0;
    for (const w of T.wheels) if (w.oil || w.puddle) { w.oil = false; w.puddle = false; w.cols[0].setFriction(w.spec.friction); w.cols[0].setFrictionCombineRule(R.CoefficientCombineRule.Average); }
    V2.msg = ''; V2.batt.e = V2.batt.cap; V2.batt.limp = false; V2.batt.avg = 0;
    sim.events.push({ type: 'kit', state: 'cleared' });
  }
  function bodies() { const out = []; for (const p of T.parts) out.push({ name: p.name, pos: p.body.translation(), q: p.body.rotation() }); if (sim.ramp) out.push({ name: 'ramp', pos: sim.ramp.body.translation(), q: sim.ramp.body.rotation() }); return out; }
  function reset(pose) { if (V2.op) return false; if (V2.arm.seq) { V2.arm.seq = null; releaseGrasp(); } buildTrolley(pose || { x: START.x, z: START.z, yawDeg: START.yawDeg }); return true; }
  function takeEvents() { const e = sim.events; sim.events = []; return e; }

  Object.assign(sim, { step, state, bodies, reset, buildTrolley, buildRamp, rampState, lockRamp, hinge, motion, crateOffset, onLanding, takeEvents,
    reach: (col, n) => reach(R, col, n), room: ROOM,
    // v2
    grab, dockOp, slots, apply, spawnItem, removeItem, placeKit, placePickups, mountArm, unmountArm, setTier, setCharge, newRun, spill, reachable, lockBin, unlockBin, setLatches, armQ, pocketPose,
    // v5
    armWork, setBinLoad, setHallDoors, addKinds: (m) => Object.assign(sim.kinds, m), fits, binOnDeck, staticCol,
    // v6: the stacking game (stack.js)
    place, placePlan, graspPoint, buildArena, removeArena, arenaAct, arenaState, trolleyOnPlate });
  buildRamp(opts.ramp || RAMP.start);
  buildTrolley(opts.pose || { x: START.x, z: START.z, yawDeg: START.yawDeg });
  return sim;
}
