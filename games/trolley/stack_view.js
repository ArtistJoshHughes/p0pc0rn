// stack_view.js - the stacking arena drawn in code: the pad's frame, the vent's grille, the sweeper's painted lane and parking boxes,
// the chute hatches in the ceiling and the target post (one merged, vertex-coloured mesh), the pad's top plate and the sweeper bot (one
// mesh each, following their bodies), every warning light (one InstancedMesh: the vent's, the plate's, the four chutes' floor lamps, the
// sweeper's beacon, the target lamp) and the vent's gust (a faint additive sheet, drawn only while it blows). 4-5 draw calls, no
// textures, no models. createStackView({ THREE, scene }) -> { group, sync(arena, hud, t), dispose() }.
import * as SPEC from './stack_spec.js';

const COL = { vent: 0x00e5ff, plate: 0xffb02e, roller: 0xff2bd6, sweeper: 0x7dff6a, target: 0xff2bd6, hold: 0x7dff6a };

export function createStackView({ THREE, scene, spec = SPEC }) {
  const { PAD, VENT, SWEEPER, ROLLER, TARGET, LIGHTS, rollerDrop } = spec;
  const group = new THREE.Group(); group.name = 'stackArena'; group.visible = false; scene.add(group);

  // ---- the static parts: boxes merged into one vertex-coloured mesh (36 vertices a box)
  const pos = [], nor = [], col = [], c3 = new THREE.Color();
  function box(cx, cy, cz, sx, sy, sz, color) {
    c3.set(color); const x = sx / 2, y = sy / 2, z = sz / 2;
    const F = [[[1, 0, 0], [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]]], [[-1, 0, 0], [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]]],
      [[0, 1, 0], [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]]], [[0, -1, 0], [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]]],
      [[0, 0, 1], [[x, -y, z], [x, y, z], [-x, y, z], [-x, -y, z]]], [[0, 0, -1], [[-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z]]]];
    for (const [n, q] of F) for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(cx + q[k][0], cy + q[k][1], cz + q[k][2]); nor.push(...n); col.push(c3.r, c3.g, c3.b); }
  }
  const h = PAD.half, fr = 0.035, dark = 0x2b2622, steel = 0x6f6a63, yellow = 0xd9a21a;
  for (const s of [-1, 1]) { box(PAD.x, 0.001, PAD.z + s * (h + fr / 2), 2 * h + 2 * fr, 0.004, fr, dark); box(PAD.x + s * (h + fr / 2), 0.001, PAD.z, fr, 0.004, 2 * h, dark); }   // the pad's frame
  box(VENT.x, 0.0005, VENT.z, VENT.width + 0.03, 0.003, VENT.len + 0.03, dark);   // the vent: a dark slot with louvres
  for (let i = 0; i < 9; i++) box(VENT.x, 0.0025, VENT.z - VENT.len / 2 + (i + 0.5) * VENT.len / 9, VENT.width * 0.9, 0.002, 0.012, steel);
  const L = SWEEPER.lane, w = SWEEPER.r + 0.03;
  for (const s of [-1, 1]) box((L.x0 + L.x1) / 2, 0.0008, L.z + s * w, L.x1 - L.x0 + 2 * w, 0.0016, 0.025, yellow);   // the sweeper's lane: painted edges
  for (const x of [L.x0, L.x1]) for (let i = -2; i <= 2; i++) box(x + i * 0.06, 0.0009, L.z, 0.025, 0.0018, 2 * w, i % 2 ? dark : yellow);   // its parking boxes: hazard stripes
  for (const k of Object.keys(ROLLER.lanes)) { const d = rollerDrop(k); box(d.x, 2.585, d.z, 0.2, 0.02, 0.2, dark); box(d.x, 2.57, d.z, 0.14, 0.012, 0.14, 0x111111); }   // the chute hatches
  const px = PAD.x + h + fr + 0.03, pz = PAD.z - h - fr - 0.03;   // the target post at the pad's north-east corner: a band at the target height
  box(px, 0.22, pz, 0.018, 0.44, 0.018, steel); box(px, PAD.top + TARGET.height, pz, 0.04, 0.012, 0.04, 0xff2bd6);
  for (let i = 1; i < 4; i++) box(px, PAD.top + i * 0.1, pz, 0.03, 0.004, 0.03, dark);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const staticMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.25 });
  const statics = new THREE.Mesh(sg, staticMat); statics.receiveShadow = true; statics.name = 'stackStatics'; group.add(statics);

  // ---- the plate and the sweeper
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.45, metalness: 0.7 });
  const plateGeo = new THREE.BoxGeometry(2 * h, PAD.thick, 2 * h); plateGeo.translate(0, -PAD.thick / 2, 0);   // its origin on its top face, like the body's
  const plate = new THREE.Mesh(plateGeo, plateMat); plate.receiveShadow = true; plate.name = 'stackPlate'; group.add(plate);
  const swGeo = new THREE.CylinderGeometry(SWEEPER.r, SWEEPER.r, SWEEPER.h, 24, 1);
  { const p = swGeo.attributes.position, n = swGeo.attributes.normal, c = new Float32Array(p.count * 3), a = new THREE.Color(0x3a3d40), b = new THREE.Color(0x9aa0a4), f = new THREE.Color(0xd9a21a);
    for (let i = 0; i < p.count; i++) { const top = n.getY(i) > 0.5, front = !top && p.getX(i) > SWEEPER.r * 0.7 && p.getY(i) < 0; const k = top ? b : front ? f : a; c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
    swGeo.setAttribute('color', new THREE.BufferAttribute(c, 3)); swGeo.translate(0, SWEEPER.h / 2, 0); }   // its origin on the floor, like the body's
  const sweeper = new THREE.Mesh(swGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 })); sweeper.castShadow = true; sweeper.name = 'stackSweeper'; group.add(sweeper);

  // ---- the warning lights: one InstancedMesh (unlit, so they glow), dim when idle, blinking while a tool warns, steady while it acts
  const lanes = Object.keys(ROLLER.lanes), N = 2 + lanes.length + 2;
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N); lamps.name = 'stackLamps';
  const m4 = new THREE.Matrix4(), lc = new THREE.Color(), at = [LIGHTS.vent, LIGHTS.plate, ...lanes.map((k) => { const d = rollerDrop(k); return [d.x, 0.02, d.z]; }), null, [px, 0.47, pz]];
  for (let i = 0; i < N; i++) { const p = at[i] || [0, -5, 0]; m4.makeTranslation(p[0], p[1], p[2]); lamps.setMatrixAt(i, m4); lamps.setColorAt(i, lc.set(0x222222)); }
  lamps.frustumCulled = false; group.add(lamps);

  // ---- the gust: a faint sheet along the jet, drawn only while it blows
  const e = VENT.elev * Math.PI / 180, len = 0.7, jg = new THREE.BufferGeometry();
  { const x0 = VENT.x, z0 = VENT.z - VENT.len / 2, z1 = VENT.z + VENT.len / 2, x1 = x0 + Math.cos(e) * len, y1 = Math.sin(e) * len;
    jg.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0.01, z0, x1, y1, z0, x1, y1, z1, x0, 0.01, z0, x1, y1, z1, x0, 0.01, z1], 3));
    jg.setAttribute('color', new THREE.Float32BufferAttribute([0.6, 0.95, 1, 1, 0.6, 0.95, 1, 0, 0.6, 0.95, 1, 0, 0.6, 0.95, 1, 1, 0.6, 0.95, 1, 0, 0.6, 0.95, 1, 1], 4)); }
  const jetMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const jet = new THREE.Mesh(jg, jetMat); jet.visible = false; jet.name = 'stackGust'; group.add(jet);

  /** arena = sim.arenaState() (null: hidden), hud = game.hud(), t = seconds */
  function sync(arena, hud, t = 0) {
    group.visible = !!arena; if (!arena) return;
    plate.position.set(arena.plate.x, arena.plate.y, arena.plate.z); if (arena.plate.q) plate.quaternion.set(arena.plate.q.x, arena.plate.q.y, arena.plate.q.z, arena.plate.q.w);
    const dx = arena.sweeper.x - sweeper.position.x; if (Math.abs(dx) > 1e-4) sweeper.rotation.y = dx > 0 ? 0 : Math.PI;   // its yellow bumper leads
    sweeper.position.set(arena.sweeper.x, arena.sweeper.y, arena.sweeper.z);
    jet.visible = arena.vent.on; jetMat.opacity = 0.22 * (arena.vent.k || 0) * (0.8 + 0.2 * Math.sin(t * 23));
    const blink = Math.floor(t * 6) % 2 === 0, tools = Object.fromEntries(((hud && hud.tools) || []).map((x) => [x.name, x.state]));
    const lane = hud && (hud.warning ? hud.warning.args : hud.activeArgs), laneOn = lane && lane.from;
    const lit = (name, i, on = true) => { const st = tools[name]; const k = !on ? 0.12 : st === 'warming' ? (blink ? 1 : 0.15) : st === 'acting' ? 1 : 0.12; lamps.setColorAt(i, lc.set(COL[name]).multiplyScalar(k)); };
    lit('vent', 0); lit('plate', 1);
    lanes.forEach((k, j) => lit('roller', 2 + j, !laneOn || laneOn === k));
    m4.makeTranslation(arena.sweeper.x, arena.sweeper.y + SWEEPER.h + 0.02, arena.sweeper.z); lamps.setMatrixAt(2 + lanes.length, m4); lit('sweeper', 2 + lanes.length);
    const holding = hud && hud.hold > 0, tk = holding ? 0.5 + 0.5 * Math.sin(t * 8) : 0.35;
    lamps.setColorAt(N - 1, lc.set(holding ? COL.hold : COL.target).multiplyScalar(hud && hud.result === 'won' ? 1 : tk));
    lamps.instanceMatrix.needsUpdate = true; if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }
  function dispose() {
    scene.remove(group);
    for (const o of [statics, plate, sweeper, lamps, jet]) { o.geometry.dispose(); o.material.dispose(); }
  }
  return { group, sync, dispose };
}
