// props_view.js - v2's drawing: the dock (guide walls, the shutter, the gantry and its hoist, the bin stand, the charger plate, the arm's
// rack), the grab arm's links, the arm kit, the trash, barrier blocks and the diesel spills. Everything that moves has one Group whose
// origin is its physics body's origin (main.js moves them with the bodies). Placeholders are drawn here on the physics' sizes; assets.js
// swaps the real models in when they are listed there.
import * as THREE from './vendor/three.module.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { DOCK_BAY, ARM_KIT } from './level_spec.js';
import { TRASH_KINDS, PICKUPS, DRESSING, BARRICADE } from './items_spec.js';
import { NODES as ARM_NODES, REF_FK, MOUNT, qrot as armRot } from './arm_spec.js';
import { boxUV } from './decor.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { PROXY_MAT } from './trolley_mesh.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const seeded = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

/** stencilled label: text on a coloured plate, worn */
function labelTex(text, bg, fg, w = 256, h = 96, seed = 3) {
  const r = seeded(seed);
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `900 ${Math.round(h * 0.46)}px -apple-system, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${40 + r() * 60 | 0},${20 + r() * 30 | 0},10,${r() * 0.35})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2); }
  });
}
/** the oil: a dark, glossy, uneven pool with a thin rainbow sheen round its rim (alpha in the texture) */
function oilTex() {
  const r = seeded(91);
  return canvasTex(512, 512, (g, w) => {
    g.clearRect(0, 0, w, w);
    const c = w / 2;
    for (let i = 0; i < 26; i++) {   // lobes make the outline uneven
      const a = r() * Math.PI * 2, d = r() * c * 0.45, x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, rad = c * (0.28 + r() * 0.3);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(4,3,2,0.97)'); gr.addColorStop(0.9, 'rgba(6,5,3,0.94)'); gr.addColorStop(1, 'rgba(6,5,3,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-atop';   // the sheen only where there is oil
    for (let i = 0; i < 7; i++) {   // a faint thin-film sheen in broad soft swirls (diesel on concrete: mostly black, a hint of colour)
      const x = c + (r() - 0.5) * c * 0.9, y = c + (r() - 0.5) * c * 0.9, rad = c * (0.3 + r() * 0.45), gr = g.createRadialGradient(x, y, rad * 0.15, x, y, rad);
      const hue = (190 + r() * 160) | 0; gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.35, `hsla(${hue},70%,45%,0.10)`); gr.addColorStop(0.6, `hsla(${(hue + 60) % 360},70%,45%,0.12)`); gr.addColorStop(0.85, `hsla(${(hue + 120) % 360},60%,40%,0.07)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    }
    g.globalCompositeOperation = 'source-over';
  });
}
function stripesTex() {   // worn yellow and black hazard stripes
  const r = seeded(29), t = canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = '#d9a91c'; g.fillRect(0, 0, w, h); g.fillStyle = '#18181a';
    for (let x = -h; x < w + h; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill(); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${90 + r() * 60 | 0},${45 + r() * 25 | 0},20,${r() * 0.5})`; g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 2); }
  });
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
}
function cardboardTex() {
  const r = seeded(17);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9b7748'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${70 + r() * 50 | 0},${50 + r() * 30 | 0},25,${r() * 0.2})`; g.fillRect(r() * w, r() * h, 2, 1); }
    g.fillStyle = 'rgba(190,170,120,0.85)'; g.fillRect(0, h * 0.44, w, h * 0.12);   // tape
    g.fillStyle = 'rgba(40,30,20,0.6)'; g.font = '800 26px -apple-system, system-ui, sans-serif'; g.fillText('THIS SIDE UP', 20, 60); g.fillText('↑↑', 190, 200);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(50,30,15,${0.15 + r() * 0.2})`; g.beginPath(); g.arc(r() * w, r() * h, 6 + r() * 20, 0, Math.PI * 2); g.fill(); }
  });
}

export function createProps(scene, assets, roomM = null) {
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.55, metalness: 0.75 }),
    rust: new THREE.MeshStandardMaterial({ color: '#6b3a1e', roughness: 0.85, metalness: 0.35 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#d9a21b', roughness: 0.5, metalness: 0.35 }),
    armPaint: new THREE.MeshStandardMaterial({ color: '#e0901c', roughness: 0.42, metalness: 0.45 }),
    armDark: new THREE.MeshStandardMaterial({ color: '#23252a', roughness: 0.5, metalness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#151618', roughness: 0.85 }),
    shutter: new THREE.MeshStandardMaterial({ color: '#5d6a66', roughness: 0.65, metalness: 0.5 }),
    hazard: new THREE.MeshStandardMaterial({ map: stripesTex(), roughness: 0.6 }),
    charger: new THREE.MeshStandardMaterial({ color: '#0c1714', emissive: '#38f3ff', emissiveIntensity: 0.8, roughness: 0.4 }),
    cable: new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6, metalness: 0.4 }),
    box: new THREE.MeshStandardMaterial({ map: cardboardTex(), roughness: 0.9 }),
    motor: new THREE.MeshStandardMaterial({ color: '#3c3a37', roughness: 0.6, metalness: 0.8 }),
    can: new THREE.MeshStandardMaterial({ color: '#b3161b', roughness: 0.42, metalness: 0.5 }),
    kit: new THREE.MeshStandardMaterial({ map: labelTex('GRAB ARM', '#3b3f45', '#f2c419', 256, 96, 9), roughness: 0.7, metalness: 0.3 }),
    kitBody: new THREE.MeshStandardMaterial({ color: '#3b3f45', roughness: 0.7, metalness: 0.3 }),
    beacon: new THREE.MeshBasicMaterial({ color: '#38f3ff', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    oil: new THREE.MeshStandardMaterial({ map: oilTex(), transparent: true, roughness: 0.03, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, envMapIntensity: 2.6 }),
    barrier: new THREE.MeshStandardMaterial({ color: '#8a8780', roughness: 0.9 }),
  };
  if (roomM && roomM.rust) { M.rust = roomM.rust; M.steel = roomM.rust; }   // the dock in the room's own rust
  const mesh = (geo, mat, x = 0, y = 0, z = 0, cast = true) => {
    if (mat && mat.userData && mat.userData.worldUV && geo.type === 'BoxGeometry') boxUV(geo);   // texture in metres, never stretched
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; return m;
  };
  const D = DOCK_BAY;

  // ---------------------------------------------------------------------------------------------- the dock (fixed parts)
  const dock = new THREE.Group(); dock.name = 'dock'; scene.add(dock);
  for (const [x, z, hx, hy, hz] of D.guides) { dock.add(mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), M.rust, x, hy, z)); dock.add(mesh(new THREE.BoxGeometry(hx * 2 + 0.01, 0.03, hz * 2), M.hazard, x, hy * 2 + 0.015, z, false)); }
  for (const [x, z] of D.posts) dock.add(mesh(new THREE.BoxGeometry(0.12, D.postH, 0.12), M.steel, x, D.postH / 2, z));
  const span = D.posts[1][0] - D.posts[0][0];
  const drum = mesh(new THREE.CylinderGeometry(0.11, 0.11, span + 0.12, 16), M.steel, D.door.x, D.postH + 0.09, D.door.z); drum.rotation.z = Math.PI / 2; dock.add(drum);
  const shutter = mesh(new THREE.BoxGeometry(D.door.hx * 2, 1, D.door.hz * 2), M.shutter, D.door.x, D.door.hy, D.door.z); dock.add(shutter);
  const shutterEdge = mesh(new THREE.BoxGeometry(D.door.hx * 2, 0.06, D.door.hz * 2 + 0.01), M.hazard, D.door.x, 0.03, D.door.z, false); dock.add(shutterEdge);
  // the stand: a wooden pallet (the model when it loads)
  { const s = D.stand, g = new THREE.Group(); g.position.set(s.x, s.hy, s.z); dock.add(g); g.add(mesh(new THREE.BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2), M.rust)); if (assets) assets.swapIn('pallet', g, [s.hx * 2, s.hy * 2, s.hz * 2]); }
  // the gantry: a post at its west end, the beam along the bay to the east wall
  { const gz = D.gantry; dock.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, gz.y, 12), M.steel, gz.post[0], gz.y / 2, gz.post[1])); const beam = mesh(new THREE.BoxGeometry(gz.x1 - gz.x0, 0.16, 0.14), M.yellow, (gz.x0 + gz.x1) / 2, gz.y + 0.08, gz.z); dock.add(beam); }
  // the charger plate on the floor where the trolley parks
  const charger = mesh(new THREE.BoxGeometry(0.7, 0.008, 0.5), M.charger, D.charger.x, 0.004, D.charger.z, false); dock.add(charger);
  // the arm's rack on the north wall west of the gantry post: the folded arm shows on it while it is stored there
  const rack = new THREE.Group(); rack.position.set(4.3, 0, -5.9); dock.add(rack);
  rack.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.16), M.steel, 0, 1.05, 0.04)); const racked = new THREE.Group(); rack.add(racked);
  racked.add(mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), M.armPaint, -0.08, 1.48, 0.06), mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), M.armPaint, 0.06, 1.43, 0.06), mesh(new THREE.BoxGeometry(0.12, 0.1, 0.24), M.armDark, 0, 1.12, 0.06));
  racked.visible = false;
  // the hoist: its carriage rides the beam, two cables down to the head
  const hoistCar = mesh(new THREE.BoxGeometry(0.3, 0.14, 0.26), M.armDark, D.stand.x, D.gantry.y - 0.04, D.gantry.z); scene.add(hoistCar);
  const cableGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 6); cableGeo.translate(0, -0.5, 0);
  const cables = [mesh(cableGeo, M.cable, 0, 0, 0, false), mesh(cableGeo, M.cable, 0, 0, 0, false)]; for (const c of cables) scene.add(c);
  const head = new THREE.Group(); head.name = 'hoistHead'; scene.add(head);
  head.add(mesh(new THREE.BoxGeometry(0.66, 0.05, 0.08), M.yellow, 0, 0, 0.29), mesh(new THREE.BoxGeometry(0.66, 0.05, 0.08), M.yellow, 0, 0, -0.29), mesh(new THREE.BoxGeometry(0.08, 0.05, 0.5), M.yellow, 0.29, 0, 0), mesh(new THREE.BoxGeometry(0.08, 0.05, 0.5), M.yellow, -0.29, 0, 0));
  for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) head.add(mesh(new THREE.BoxGeometry(0.04, 0.09, 0.04), M.armDark, x, -0.045, z));

  // ---------------------------------------------------------------------------------------------- the arm's grime (the hall's world)
  // The converted arm is clean white plastic without UVs, so the wear is procedural, in its shader: dirt in object-space noise that
  // gathers low down (dust and oil towards the floor), rust specks bleeding from the metal, lighter scuffs on the edges; the surfaces go
  // rougher where dirty. No textures. g = [dirt, rust, scuff], dust = how much a dark part greys with dust.
  function grime(mat, g, dust = 0) {
    mat.userData.grime = true;
    mat.customProgramCacheKey = () => 'grime' + g.join(',') + dust;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uG = { value: new THREE.Vector3(...g) }; sh.uniforms.uDust = { value: dust };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying float vWy;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vWy = (modelMatrix * vec4(position, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vObj; varying float vWy; uniform vec3 uG; uniform float uDust;
float gh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gh(i), gh(i + vec3(1,0,0)), f.x), mix(gh(i + vec3(0,1,0)), gh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(gh(i + vec3(0,0,1)), gh(i + vec3(1,0,1)), f.x), mix(gh(i + vec3(0,1,1)), gh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
{ float n = gn(vObj * 16.0) * 0.55 + gn(vObj * 47.0) * 0.3 + gn(vObj * 130.0) * 0.15;
  float low = clamp(1.0 - (vWy - 0.12) / 1.1, 0.0, 1.0);
  float dirt = smoothstep(0.42, 0.82, n * 0.85 + low * 0.5) * uG.x;
  float rust = smoothstep(0.74, 0.9, gn(vObj * 85.0 + 7.0) * 0.7 + n * 0.3) * uG.y;
  float scuff = smoothstep(0.8, 0.95, gn(vObj * 210.0 + 3.0)) * uG.z;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.52, 0.43, 0.33), dirt);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.17, 0.13), dirt * uDust);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.14, 0.05), rust);
  diffuseColor.rgb = mix(diffuseColor.rgb, min(vec3(1.0), diffuseColor.rgb * 1.6 + 0.06), scuff);
  roughnessFactor = clamp(roughnessFactor + 0.4 * dirt + 0.35 * rust - 0.1 * scuff, 0.04, 1.0);
  metalnessFactor = clamp(metalnessFactor - 0.6 * rust, 0.0, 1.0); }`);
    };
    mat.needsUpdate = true;
  }
  const GRIME = { arm_white_glossy: [1, 0.35, 0.55], 'plastic__scratched_white_b01': [1, 0.3, 0.6], arm_steel: [0.8, 1, 0.4], arm_chrome: [0.7, 0.9, 0.4],
    claw_black_steel: [0.5, 0.6, 1], claw_pin_steel: [0.6, 0.9, 0.5], arm_black: [0.8, 0.2, 0.3], arm_black_glossy: [0.8, 0.2, 0.3], arm_rubber_black: [1, 0, 0.2], 'plastic__red_a01': [0.8, 0.3, 0.4], 'plastic__orange_a01': [0.8, 0.3, 0.4] };
  function grimeArm(roots) {   // each material once, however many nodes share it
    const seen = new Set();
    for (const root of roots) root.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (seen.has(m) || !m.isMeshStandardMaterial) continue; seen.add(m);
      if (m.name === 'claw_black_steel') { m.color.setRGB(0.05, 0.048, 0.045); m.metalness = 0.8; m.roughness = 0.5; }   // darkened metal, worn edges
      if (m.name === 'arm_white_glossy' || m.name === 'plastic__scratched_white_b01') m.roughness = Math.max(m.roughness, 0.45);   // no longer glossy
      const g = GRIME[m.name] || [0.8, 0.3, 0.4]; grime(m, g, /black|rubber/.test(m.name) ? 0.55 : 0);
    } });
  }
  // the mount: a steel pedestal bolted into the front tool-mount channel, the arm's base sitting flush on its flange (low poly, rust)
  function pedestal() {
    const g = [], box = (sx, sy, sz, x, y, z) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x, y, z); g.push(b); };
    box(0.018, 0.185, 0.30, 0.009, 0.0375, 0);            // back plate on the channel's back wall (y 0.115-0.30 in the chassis frame)
    box(0.322, 0.055, 0.20, 0.179, -0.0275, 0);            // the riser arm under the base (bottom 11.5 cm off the floor: clear of the ramp's toe)
    const fl = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16); fl.translate(0.2484, -0.006, 0); g.push(fl);   // the flange: top flush with the base
    for (const zz of [-0.07, 0.07]) {   // two gussets from the plate along the arm
      const sh = new THREE.Shape(); sh.moveTo(0.018, 0); sh.lineTo(0.13, 0); sh.lineTo(0.018, 0.11); sh.closePath();
      const gu = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false }); gu.translate(0, 0, zz - 0.006); g.push(gu);
    }
    const geo = mergeGeometries(g.map((x) => x.toNonIndexed ? x.toNonIndexed() : x)); geo.computeVertexNormals();
    const bolts = [], bolt = (x, y, z, rx) => { const c = new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6); if (rx) c.rotateZ(Math.PI / 2); c.translate(x, y, z); bolts.push(c.toNonIndexed()); };
    for (const y of [0.0, 0.1]) for (const z of [-0.11, 0.11]) bolt(0.021, y, z, true);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; bolt(0.2484 + 0.085 * Math.cos(a), 0.003, 0.085 * Math.sin(a), false); }
    const grp = new THREE.Group(); grp.name = 'arm_pedestal';
    const m1 = new THREE.Mesh(geo, M.rust), m2 = new THREE.Mesh(mergeGeometries(bolts), M.armDark);
    for (const m of [m1, m2]) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
    return grp;
  }
  // thin neon rings on two joints (the hall's cyan and magenta): readable, not glowing all over
  function ring(bodyName, parentNode, axisLocal, color, r) {
    const q = REF_FK[parentNode].q, ax = armRot(q, axisLocal), m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0055, 6, 40), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...ax).normalize()); m.userData.keep = true; m.name = 'neon_ring'; return m;
  }

  // ---------------------------------------------------------------------------------------------- the grab arm: one Group per body
  // Each body's frame is the chassis' at the reference pose REF (sim.js); a link sits in it at REF's rotation. Placeholders from the
  // colliders at once; the real model's nodes (arm_cobot_claw.glb) replace them when it loads. The bracket rides on the chassis.
  const ARMB = { arm_base: ['arm_base'], arm_shoulder: ['arm_shoulder'], arm_elbow: ['arm_elbow'], arm_wrist_roll: ['arm_wrist_roll'], arm_wrist_pitch: ['arm_wrist_pitch', 'claw_body'], claw_jaw: ['claw_jaw'] };
  const NODE = new Map(ARM_NODES.map((n) => [n.name, n])), arm = new Map();
  const placeIn = (obj, nn, bodyName) => { const f = REF_FK[nn], b = REF_FK[bodyName]; obj.position.set(f.p[0] - b.p[0], f.p[1] - b.p[1], f.p[2] - b.p[2]); obj.quaternion.set(...f.q); };
  for (const [bn, nodes] of Object.entries(ARMB)) {
    const g = new THREE.Group(); g.name = bn; g.visible = false; scene.add(g); arm.set(bn, g);
    for (const nn of nodes) { const n = NODE.get(nn), h = new THREE.Group(); placeIn(h, nn, bn); h.add(mesh(new THREE.BoxGeometry(n.col.h[0] * 2, n.col.h[1] * 2, n.col.h[2] * 2), nn.startsWith('claw') ? M.armDark : M.armPaint, ...n.col.c)); h.userData.placeholder = true; g.add(h); }
  }
  const armMount = new THREE.Group(); armMount.name = 'arm_mount'; armMount.position.set(...MOUNT); armMount.visible = false;
  armMount.add(pedestal());
  const rings = [['arm_elbow', 'arm_shoulder', [0, 0, -1], '#00E5FF', 0.095], ['arm_wrist_pitch', 'arm_wrist_roll', [0, 1, 0], '#FF2BD6', 0.072]];
  const addRings = () => { for (const [bn, pn, ax, col, r] of rings) arm.get(bn).add(ring(bn, pn, ax, col, r)); };
  addRings();
  if (assets) assets.model('arm').then((scene0) => {
    if (!scene0) return;
    const src = scene0.clone(true), by = new Map(); src.traverse((o) => { if (o.name && !by.has(o.name)) by.set(o.name, o); });
    const all = new Set(ARM_NODES.map((n) => n.name)), take = (nn) => { const o = by.get(nn); if (!o) return null; o.removeFromParent(); for (const c of [...o.children]) if (all.has(c.name)) o.remove(c); o.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); return o; };
    const got = []; for (const nn of all) if (by.has(nn)) got.push(nn);
    if (got.length < all.size) return;   // not the expected rig: keep the placeholder
    // only the placeholder boxes go: the neon rings, and anything fitted to the arm meanwhile (survival_view.js's Tetrabrachion), stay
    const taken = [];
    for (const [bn, nodes] of Object.entries(ARMB)) {
      const g = arm.get(bn);
      // the placeholder's boxes (the colliders' sizes) stay as the link's shadow (trolley_mesh.js shadowProxy): the model casts none
      for (const c of g.children) if (c.userData.placeholder) c.traverse((x) => { if (x.isMesh) { x.material = PROXY_MAT; x.castShadow = true; x.receiveShadow = false; x.userData.shadowProxy = true; } });
      for (const nn of nodes) { const o = take(nn); placeIn(o, nn, bn); o.traverse((x) => { if (x.isMesh) x.castShadow = false; }); g.add(o); taken.push(o); }
    }
    take('arm_mount');   // the converter's bracket: replaced by the pedestal
    grimeArm(taken);
  });

  // ---------------------------------------------------------------------------------------------- trash, pickups, the kit, dressing, barriers
  function trashProxy(kind, spec = null) {   // shown until the model loads (v5: a supply passes its own spec)
    const k = spec || TRASH_KINDS[kind] || PICKUPS[kind] || DRESSING[kind], [sx, sy, sz] = k.size, g = new THREE.Group();
    const mat = kind === 'diesel' ? M.can : kind === 'battery' ? M.motor : kind === 'drum' ? M.rust : kind === 'bigbox' ? M.box : M.steel;
    if (k.shape === 'cyl' || k.shape === 'drum') g.add(mesh(new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 16), mat));
    else g.add(mesh(new THREE.BoxGeometry(sx, sy, sz), mat));
    return g;
  }
  const modelled = (key, size, spec = null, asset = key) => { const g = new THREE.Group(); g.add(trashProxy(key, spec)); scene.add(g); if (assets) assets.swapIn(asset, g, size); return g; };
  const items = new Map();
  function itemGroup(it) {
    let g = items.get(it.id); if (g) return g;
    // v5: a supply's group only carries its pose (survival_view.js draws the supplies instanced by kind, from these groups)
    if (it.spec.supply) { g = new THREE.Group(); g.userData.supply = it.spec.supply; scene.add(g); }
    else g = modelled(it.kind, TRASH_KINDS[it.kind].size);
    g.name = (it.spec.supply ? 'supply_' : 'trash_') + it.kind; items.set(it.id, g);
    return g;
  }
  function dropItem(id) { const g = items.get(id); if (g) { scene.remove(g); items.delete(id); } }
  const kit = new THREE.Group(); kit.name = 'armKit'; kit.visible = false; scene.add(kit);
  { const [sx, sy, sz] = ARM_KIT.size; kit.add(mesh(new THREE.BoxGeometry(sx, sy, sz), [M.kitBody, M.kitBody, M.kitBody, M.kitBody, M.kit, M.kit])); kit.add(mesh(new THREE.BoxGeometry(sx + 0.01, 0.04, sz + 0.01), M.hazard, 0, sy / 2 - 0.03, 0)); }
  const pickups = new Map(), dressing = new Map();
  function pickupGroup(pu) { let g = pickups.get(pu.id); if (!g) { g = modelled(pu.kind, PICKUPS[pu.kind].size); pickups.set(pu.id, g); } return g; }
  function dressingGroup(i, kind) { let g = dressing.get(i); if (!g) { g = modelled(kind, DRESSING[kind].size); dressing.set(i, g); } return g; }
  const beacon = mesh(new THREE.RingGeometry(0.5, 0.58, 40), M.beacon, 0, 0.006, 0, false); beacon.rotation.x = -Math.PI / 2; beacon.visible = false; scene.add(beacon);
  const barriers = new Map();
  function barrierGroup(id) { let g = barriers.get(id); if (!g) { g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(...BARRICADE.size), M.barrier)); scene.add(g); if (assets) assets.swapIn('barricade', g, BARRICADE.size); barriers.set(id, g); } return g; }

  // ---------------------------------------------------------------------------------------------- spills
  const spills = [];
  const oilGeo = new THREE.CircleGeometry(1, 40); oilGeo.rotateX(-Math.PI / 2);
  function syncSpills(list) {
    while (spills.length < list.length) { const m = new THREE.Mesh(oilGeo, M.oil); m.receiveShadow = true; m.renderOrder = 1; m.rotation.y = spills.length * 1.7; scene.add(m); spills.push(m); }
    for (let i = 0; i < spills.length; i++) {
      const s = list[i], m = spills[i]; if (!s) { m.visible = false; continue; }
      m.visible = true; m.position.set(s.x, s.y + 0.0025, s.z); const r = s.r * 1.12; m.scale.set(r, 1, r);   // the sheen runs a little past the sensor's edge
    }
  }

  // ---------------------------------------------------------------------------------------------- per frame
  function sync(st, v2, t) {
    const S = st.v2;
    // shutter
    const h = Math.max(0.01, D.door.hy * 2 * (1 - S.door)); shutter.scale.y = h; shutter.position.y = D.door.hy * 2 - h / 2; shutterEdge.position.y = D.door.hy * 2 - h + 0.03;
    // hoist
    const hp = v2.hoist.pos; head.position.set(hp[0], hp[1], hp[2]); head.rotation.y = v2.hoist.yaw;
    hoistCar.position.x = hp[0];
    const top = D.gantry.y - 0.1; for (const [k, c] of cables.entries()) { const off = k ? 0.12 : -0.12; c.position.set(hp[0] + off, top, hp[2]); c.scale.y = Math.max(0.05, top - hp[1] - 0.03); }
    // charger: green while charging, cyan when parked and full, dim otherwise
    const ch = S.battery.charging, pk = S.dock.parked;
    M.charger.emissive.set(ch ? '#7dff6a' : '#38f3ff'); M.charger.emissiveIntensity = ch ? 1.4 + 0.6 * Math.sin(t * 6) : pk ? 1.2 : 0.35;
    racked.visible = S.arm.state === 'rack';
    for (const [name, g] of arm) g.visible = S.arm.state === 'mounted';
    armMount.visible = S.arm.state === 'mounted';
    // the kit's beacon
    kit.visible = S.kit; beacon.visible = S.kit;
    if (S.kit && v2.kit) { const p = v2.kit.body.translation(); beacon.position.set(p.x, 0.006, p.z); const k = 1 + 0.1 * Math.sin(t * 3); beacon.scale.set(k, k, 1); M.beacon.opacity = 0.35 + 0.25 * Math.sin(t * 3); }
    // trash that is gone
    for (const id of [...items.keys()]) if (!v2.items.some((it) => it.id === id)) dropItem(id);
    for (const id of [...pickups.keys()]) if (!v2.pickups.some((p) => p.id === id)) { scene.remove(pickups.get(id)); pickups.delete(id); }
    // a spilled diesel can has lost its cap
    for (const it of v2.items) if (it.spilled && it.spec.cap && !it.capGone) { const g = items.get(it.id), cap = g && g.getObjectByName(it.spec.cap); if (cap) { cap.visible = false; it.capGone = true; } }
    for (const id of [...barriers.keys()]) if (!v2.obstacles.has(id)) { scene.remove(barriers.get(id)); barriers.delete(id); }
    syncSpills(S.spills);
  }
  return { sync, itemGroup, armGroup: (n) => arm.get(n), armMount, kit, barrierGroup, pickupGroup, dressingGroup, head, M, dock, grime };   // grime: the world's props wear it too
}
