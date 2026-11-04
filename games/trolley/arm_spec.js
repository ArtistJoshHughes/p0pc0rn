// arm_spec.js - the grab arm on the trolley's front tool mount (slot 2): NVIDIA SimReady's robotic_system_arm_b01 (its arm links) with
// the serviceTool_pliers_oilFilter_a01 jaw as a ring claw, converted for the game at 1.2x (assets/props/arm_cobot_claw.glb, CC BY 4.0;
// its rig, limits and poses come with it in arm_cobot_claw_parts.json, collision-swept against the trolley). Pure data and maths here.
//
// Frames: the chassis frame (game axes: x forward, y up, z to the right; the trolley's origin on the floor under its centre). The arm's
// root (its welded bracket) sits at MOUNT, on the back wall of the light-grey recessed tread-plate channel on the chassis front between
// the front wheels; the bracket carries the base 25 cm forward, clear of the bin. Every node's origin is on its joint pivot and its rest
// rotation is identity, so a pose is just each joint's angle about its axis (in the parent's frame, right-hand rule).
// Joints: base yaw, shoulder and elbow pitch, a wrist roll held at -90° (so the wrist's pitch joint pitches), wrist pitch, and the jaw
// (-50° open, 0° closed: a ring 0.11 m across inside). The grasp point is the ring's centre; the tool axis is the claw body's +x.

const D = Math.PI / 180;
export const MOUNT = [0.2916, 0.17, 0];
export const GRASP_LOCAL = [0.108, 0, -0.0042];   // in claw_body's frame
export const RING = 0.11;                        // the closed ring's inside: what fits it

/** the rig: name, parent, translation in the parent at rest, joint axis (parent frame), limits (deg), game mass (kg), collider (node frame),
 *  servo (k N·m/rad, c N·m·s/rad, max N·m). claw_body is welded to arm_wrist_pitch (one body); arm_mount is welded to the chassis. */
export const NODES = [
  { name: 'arm_mount', parent: null, t: [0, 0, 0], fixed: true, mass: 4.0, col: { c: [0.1732, 0.033, 0], h: [0.1732, 0.085, 0.15] } },
  { name: 'arm_base', parent: 'arm_mount', t: [0.2484, 0, 0], axis: [0, 1, 0], limit: [-100, 100], mass: 2.5, col: { c: [0.0042, 0.1184, 0.0118], h: [0.0817, 0.1191, 0.0901] }, servo: [2600, 160, 160] },
  { name: 'arm_shoulder', parent: 'arm_base', t: [0.0173, 0.1689, -0.0876], axis: [0, 0, -1], limit: [-10, 60], mass: 3.0, col: { c: [0.0233, 0.2563, 0.0817], h: [0.093, 0.325, 0.0881] }, servo: [9000, 520, 420] },
  { name: 'arm_elbow', parent: 'arm_shoulder', t: [0.0577, 0.523, 0.0643], axis: [0, 0, -1], limit: [-110, 70], mass: 2.5, col: { c: [0.171, 0.0294, 0.0129], h: [0.2292, 0.0875, 0.0705] }, servo: [6000, 320, 260] },
  { name: 'arm_wrist_roll', parent: 'arm_elbow', t: [0.402, 0.0581, 0.0245], axis: [1, 0, 0], limit: [-180, 180], mass: 0.8, col: { c: [0.0793, 0, 0], h: [0.0811, 0.0464, 0.0469] }, servo: [1500, 60, 90] },
  { name: 'arm_wrist_pitch', parent: 'arm_wrist_roll', t: [0.1196, 0.0281, 0], axis: [0, 1, 0], limit: [-150, 150], mass: 1.2, col: { c: [0.0919, -0.0285, 0.0001], h: [0.1218, 0.0415, 0.0403] }, servo: [1400, 55, 90] },
  { name: 'claw_body', parent: 'arm_wrist_pitch', t: [0.3393, -0.0284, 0.0005], fixed: true, mass: 0.4, col: { c: [-0.0006, 0, -0.0241], h: [0.12, 0.0091, 0.0518] } },
  { name: 'claw_jaw', parent: 'claw_body', t: [0, 0, 0], axis: [0, 1, 0], limit: [-50, 0], mass: 0.35, col: { c: [0.0621, 0, 0.021], h: [0.1235, 0.0059, 0.0466] }, servo: [140, 3, 12] },
];
export const JOINTS = ['arm_base', 'arm_shoulder', 'arm_elbow', 'arm_wrist_roll', 'arm_wrist_pitch'];   // the pose vector's order (deg)
export const JAW = { open: -50, closed: 0 };
export const ARM_MASS = NODES.filter((n) => n.name !== 'arm_mount').reduce((a, n) => a + n.mass, 0);

// the asset's named poses (deg, in JOINTS order), checked against the trolley and the bin by the converter
export const POSES = {
  stow: [0, -6.4, 16.4, -90, 130.5], reach_near: [0, -3.4, 49.7, -90, 43.7], reach_far: [0, 25.0, 11.2, -90, 53.8],
  lift: [0, 22.9, -77.3, -90, -114.4], over_bin: [0, -6.1, -77.3, -90, -106.5],
};
// the pose the bodies are built in: the stow with the wrist pitch at mid-range, so every joint's working range stays well inside ±180°
// relative to it (the wrist pitch runs from -114° to +131°). The arm's colliders stay off until its servos have folded it to the stow.
export const REF = [0, -6.4, 16.4, -90, 8];

// ------------------------------------------------------------------------------------------------ maths (quaternions as [x, y, z, w])
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qax = (ax, deg) => { const s = Math.sin(deg * D / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(deg * D / 2)]; };
export const qrot = (q, v) => { const u = [q[0], q[1], q[2]], w = q[3], d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [0, 1, 2].map((i) => 2 * d * u[i] + (w * w - uu) * v[i] + 2 * w * cr[i]); };
const byName = new Map(NODES.map((n) => [n.name, n]));

/** forward kinematics: pose (deg, JOINTS order) and jaw (deg) -> { name: { p: pivot (chassis frame), q: rotation } } */
export function fk(pose, jaw = 0) {
  const out = {}, ang = Object.fromEntries(JOINTS.map((n, i) => [n, pose[i]])); ang.claw_jaw = jaw;
  for (const n of NODES) {
    const par = n.parent ? out[n.parent] : { p: MOUNT, q: [0, 0, 0, 1] };
    const p = par.p.map((v, i) => v + qrot(par.q, n.t)[i]);
    const q = n.axis ? qmul(par.q, qax(n.axis, ang[n.name] || 0)) : par.q;
    out[n.name] = { p, q };
  }
  return out;
}
/** the grasp point (the ring's centre) and the tool axis (chassis frame) */
export function grasp(pose) { const f = fk(pose).claw_body; return { p: f.p.map((v, i) => v + qrot(f.q, GRASP_LOCAL)[i]), axis: qrot(f.q, [1, 0, 0]) }; }

/** inverse kinematics (damped least squares, numeric): the ring's centre at chassis point `target` with the tool axis straight down;
 *  yaw, shoulder, elbow and wrist pitch move (the roll stays at -90°). -> pose (deg) or null if it cannot get within 1.5 cm */
export function solve(target, seed = null) {
  const lim = JOINTS.map((n) => byName.get(n).limit);
  const yaw0 = Math.atan2(-target[2], target[0] - (MOUNT[0] + 0.2484)) / D;
  let q = (seed || (Math.hypot(target[0] - 0.79, target[2]) > 0.6 ? POSES.reach_far : POSES.reach_near)).slice(); q[0] = yaw0;
  const err = (x) => { const g = grasp(x); return [g.p[0] - target[0], g.p[1] - target[1], g.p[2] - target[2], 0.25 * g.axis[0], 0.25 * (g.axis[1] + 1), 0.25 * g.axis[2]]; };
  const free = [0, 1, 2, 4];
  for (let it = 0; it < 60; it++) {
    const e = err(q), n2 = e.reduce((a, v) => a + v * v, 0); if (n2 < 1e-8) break;
    const Jc = free.map((k) => { const x = q.slice(); x[k] += 0.05; const e2 = err(x); return e2.map((v, i) => (v - e[i]) / 0.05); });   // columns, per degree
    // (J^T J + l I) dq = -J^T e
    const A = free.map((_, a) => free.map((__, b) => Jc[a].reduce((s, v, i) => s + v * Jc[b][i], 0) + (a === b ? 1e-4 : 0)));
    const g = free.map((_, a) => -Jc[a].reduce((s, v, i) => s + v * e[i], 0));
    const dq = solve4(A, g);
    free.forEach((k, a) => { q[k] = Math.max(lim[k][0], Math.min(lim[k][1], q[k] + Math.max(-15, Math.min(15, dq[a])))); });
  }
  const g = grasp(q), miss = Math.hypot(g.p[0] - target[0], g.p[1] - target[1], g.p[2] - target[2]);
  return miss < 0.015 && g.axis[1] < -0.9 ? q : null;
}
function solve4(A, b) {   // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

export const REF_FK = fk(REF, 0);
export const STOW = POSES.stow, LIFT = POSES.lift, OVER_BIN = POSES.over_bin;
// what GRAB looks for: trash whose centre is 0.30-0.88 m from the base's yaw axis, within 95° either side, low on the floor, and small
// enough for the ring
export const REACH = { min: 0.30, max: 0.88, bearing: 95, top: 0.36, yawAxisX: MOUNT[0] + 0.2484 };
export const RATE = 1.5;   // rad/s: the joints' planned speed
