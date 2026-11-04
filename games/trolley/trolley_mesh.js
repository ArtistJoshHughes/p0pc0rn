// trolley_mesh.js - how the trolley looks. One THREE.Group per rigid body, its origin on that body's pivot (the same frame as the
// physics body in sim.js), so a part can only ever be drawn where its body is. Two sources:
//  - the placeholder: drawn here from boxes and cylinders on the same measurements as the colliders (always ready, nothing to load);
//  - the real model: NVIDIA SimReady's equipment_trash_trolley_a01 converted to glTF (assets/trolley.glb + trolley_parts.json): each
//    node is moved into its part's group at its own reference-pose transform, and its pivot is checked against the body's.
import * as THREE from './vendor/three.module.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { U, WHEEL_R, WHEEL_HW } from './trolley_spec.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const local = (pUsd, pivotUsd) => U(...sub(pUsd, pivotUsd));   // a USD point -> the part's local frame (game axes)

function treadTex() {   // knobbly tread round the tyre: makes the tyre's spin visible
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d');
  g.fillStyle = '#17181b'; g.fillRect(0, 0, 256, 32);
  for (let x = 0; x < 256; x += 16) { g.fillStyle = '#2b2d32'; g.fillRect(x + 2, 3, 9, 11); g.fillRect(x + 7, 18, 9, 11); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
function hubTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#17181b'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#5b6068'; g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e07a1f'; g.beginPath(); g.arc(64, 64, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#20232a'; for (let k = 0; k < 5; k++) { const a = (k * Math.PI * 2) / 5; g.beginPath(); g.arc(64 + 31 * Math.cos(a), 64 + 31 * Math.sin(a), 4.5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#f2f2f2'; g.fillRect(60, 30, 8, 14);   // a mark: the turn is easy to follow
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function decalTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64); g.fillStyle = 'rgba(240,244,250,0.92)'; g.font = '800 34px -apple-system, system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText('a01', 12, 34);
  g.fillStyle = '#ffcc33'; g.fillRect(90, 26, 150, 6); g.fillStyle = 'rgba(240,244,250,0.6)'; g.font = '600 14px -apple-system, system-ui, sans-serif'; g.fillText('WASTE · AUTONOMOUS', 92, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** the placeholder: { groups: Map(name -> Group), brake: Material[], glow: { strip: Material, pool: Mesh } } */
export function buildPlaceholder(parts, glowTexture) {
  const groups = new Map();
  const mat = {
    body: new THREE.MeshStandardMaterial({ color: '#4b515b', roughness: 0.42, metalness: 0.65 }),
    dark: new THREE.MeshStandardMaterial({ color: '#23262c', roughness: 0.55, metalness: 0.4 }),
    grille: new THREE.MeshStandardMaterial({ color: '#101215', roughness: 0.7, metalness: 0.3 }),
    carbon: new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 0.3, metalness: 0.2 }),
    orange: new THREE.MeshStandardMaterial({ color: '#e07a1f', roughness: 0.45, metalness: 0.5 }),
    tyre: new THREE.MeshStandardMaterial({ map: treadTex(), roughness: 0.9 }),
    hub: new THREE.MeshStandardMaterial({ map: hubTex(), roughness: 0.6, metalness: 0.3 }),
    clamp: new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.4, metalness: 0.8 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#f0c419', roughness: 0.4, metalness: 0.2 }),
    rubberRed: new THREE.MeshStandardMaterial({ color: '#b3231f', roughness: 0.75 }),
    crate: new THREE.MeshStandardMaterial({ color: '#2f5fb3', roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }),
    crateRim: new THREE.MeshStandardMaterial({ color: '#244a8f', roughness: 0.5 }),
    liner: new THREE.MeshStandardMaterial({ color: '#c9a246', roughness: 0.95, side: THREE.DoubleSide }),
    decal: new THREE.MeshStandardMaterial({ map: decalTex(), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    brake: new THREE.MeshStandardMaterial({ color: '#3a0606', emissive: '#ff1a10', emissiveIntensity: 0.6, roughness: 0.25 }),
    cyan: new THREE.MeshStandardMaterial({ color: '#06262c', emissive: '#28e0ff', emissiveIntensity: 2.0 }),
  };
  const mk = (geo, m, p, cast = true) => { const o = new THREE.Mesh(geo, m); if (p) o.position.set(p[0], p[1], p[2]); o.castShadow = cast; o.receiveShadow = true; return o; };
  /** a box from USD min/max corners, in a part's frame */
  const boxUsd = (part, min, max, m, round = 0) => {
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], h = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const geo = round ? new RoundedBoxGeometry(h[0], h[2], h[1], 2, Math.min(round, h[0] / 2, h[1] / 2, h[2] / 2)) : new THREE.BoxGeometry(h[0], h[2], h[1]);
    return mk(geo, m, local(c, part.pivot));
  };
  for (const p of parts) {
    const g = new THREE.Group(); g.name = p.name; groups.set(p.name, g);
    if (p.role === 'chassis') {
      g.add(boxUsd(p, [-0.398, -0.20, 0.05], [0.398, 0.20, 0.33], mat.body, 0.02));
      for (const s of [-1, 1]) {
        g.add(boxUsd(p, [-0.17, s > 0 ? 0.20 : -0.424, 0.07], [0.17, s > 0 ? 0.424 : -0.20, 0.33], mat.body, 0.02));
        for (const e of [-1, 1]) g.add(boxUsd(p, [e > 0 ? 0.17 : -0.40, s > 0 ? 0.20 : -0.424, 0.19], [e > 0 ? 0.40 : -0.17, s > 0 ? 0.424 : -0.20, 0.33], mat.body, 0.02));
        // side decal and the cyan under-glow strip
        const d = mk(new THREE.PlaneGeometry(0.3, 0.075), mat.decal, U(0, s * 0.4255, 0.2), false); d.rotation.y = s > 0 ? Math.PI : 0; g.add(d);
        g.add(mk(new THREE.BoxGeometry(0.30, 0.012, 0.012), mat.cyan, U(0, s * 0.418, 0.075), false));
      }
      g.add(boxUsd(p, [-0.40, -0.426, 0.33], [0.40, 0.426, 0.362], mat.carbon, 0.008));   // deck
      for (const e of [-1, 1]) {
        g.add(boxUsd(p, [e > 0 ? 0.385 : -0.40, -0.426, 0.362], [e > 0 ? 0.40 : -0.385, 0.426, 0.38], mat.dark));   // pocket lips (as drawn)
        g.add(boxUsd(p, [e > 0 ? 0.396 : -0.401, -0.15, 0.07], [e > 0 ? 0.401 : -0.396, 0.15, 0.27], mat.grille));   // end grille
        for (const s of [-1, 1]) g.add(boxUsd(p, [e > 0 ? 0.395 : -0.405, s > 0 ? 0.08 : -0.235, 0.284], [e > 0 ? 0.405 : -0.395, s > 0 ? 0.235 : -0.08, 0.322], mat.brake));   // red lights
      }
      for (const s of [-1, 1]) g.add(boxUsd(p, [-0.385, s > 0 ? 0.405 : -0.426, 0.362], [0.385, s > 0 ? 0.426 : -0.405, 0.38], mat.dark));
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: glowTexture, color: '#28e0ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.y = 0.006; pool.renderOrder = 2; g.add(pool);
      g.userData.pool = pool;
    } else if (p.role === 'crate') {
      // a tapered recycling crate: blue walls with ribs, a rim, a gold fabric liner inside
      const z0 = 0.3608, z1 = 1.066, b = [0.36, 0.35], t = [0.424, 0.416];
      const wall = (corners) => { const geo = new THREE.BufferGeometry(); const v = corners.flatMap((c) => local(c, p.pivot)); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals(); return mk(geo, mat.crate); };
      g.add(wall([[b[0], -b[1], z0], [b[0], b[1], z0], [t[0], t[1], z1], [t[0], -t[1], z1]]), wall([[-b[0], b[1], z0], [-b[0], -b[1], z0], [-t[0], -t[1], z1], [-t[0], t[1], z1]]),
        wall([[b[0], b[1], z0], [-b[0], b[1], z0], [-t[0], t[1], z1], [t[0], t[1], z1]]), wall([[-b[0], -b[1], z0], [b[0], -b[1], z0], [t[0], -t[1], z1], [-t[0], -t[1], z1]]));
      g.add(boxUsd(p, [-b[0], -b[1], z0], [b[0], b[1], z0 + 0.03], mat.crateRim));
      for (const zz of [0.55, 0.75, 0.95]) {
        const f = (zz - z0) / (z1 - z0), wx = b[0] + (t[0] - b[0]) * f + 0.006, wy = b[1] + (t[1] - b[1]) * f + 0.006;
        g.add(boxUsd(p, [-wx, -wy, zz - 0.012], [wx, wy, zz + 0.012], mat.crateRim));
      }
      g.add(boxUsd(p, [-t[0] - 0.008, -t[1] - 0.008, z1 - 0.035], [t[0] + 0.008, t[1] + 0.008, z1], mat.crateRim, 0.01));
      g.add(boxUsd(p, [-0.33, -0.32, z0 + 0.05], [0.33, 0.32, z1 - 0.12], mat.liner));   // the liner bag, a little lower than the rim
    } else if (p.role === 'module') {
      const c = p.colliders[0], hub = mk(new THREE.CylinderGeometry(c.r, c.r, c.hw * 2, 28), mat.orange, U(...c.c)); hub.rotation.x = Math.PI / 2; g.add(hub);
      const arm = mk(new THREE.BoxGeometry(0.07, 0.08, c.hw * 1.6), mat.dark, U(0, c.c[1], -0.03)); g.add(arm);
      const king = mk(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 12), mat.clamp, [0, 0.0, 0]); g.add(king);
    } else if (p.role === 'wheel') {
      const geo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_HW * 2, 40, 1);
      const t = mk(geo, [mat.tyre, mat.hub, mat.hub], [0, 0, 0]); t.rotation.x = Math.PI / 2; g.add(t);
    } else if (p.role === 'clamp' || p.role === 'bracket') {
      const c = p.colliders[0]; g.add(mk(new THREE.BoxGeometry(c.h[0] * 2, c.h[2] * 2, c.h[1] * 2), mat.clamp, U(...c.c)));
    } else if (p.role === 'lock') {
      for (const c of p.colliders) g.add(mk(new RoundedBoxGeometry(c.h[0] * 2, c.h[2] * 2, c.h[1] * 2, 2, 0.006), mat.yellow, U(...c.c)));
      const pin = mk(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 10), mat.clamp, [0, 0, 0]); pin.rotation.x = Math.PI / 2; g.add(pin);
    } else if (p.role === 'stopper') {
      const c = p.colliders[0], m = mk(new RoundedBoxGeometry(c.h[0] * 2, c.h[2] * 2, c.h[1] * 2, 2, 0.012), mat.rubberRed, U(...c.c)); m.rotation.y = (c.rotZ * Math.PI) / 180; g.add(m);
    }
    // what the real model replaces: only these. Whatever else rides on a group (the floor glow, lights, the arm's pedestal...) stays.
    for (const c of g.children) if (c !== g.userData.pool) c.userData.placeholder = true;
  }
  return { groups, brake: [mat.brake], glow: { strip: mat.cyan, pool: groups.get('trolley_01').userData.pool }, mat };
}

// the real model's shadow: the model is 305k triangles, and drawn twice a frame (the shadow pass, ~60 draws) it was a third of a frame's
// cost. Its shadow comes from the placeholder's own boxes instead (the same measurements as the colliders), merged into one mesh for
// the chassis and one for the bin: drawn in the shadow pass only (in the main pass it writes no colour and no depth). The wheels, the
// modules and the small parts under the body cast none (the body's shadow covers theirs).
export const PROXY_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
export function shadowProxy(meshes) {
  const geos = meshes.map((m) => { m.updateMatrix(); const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, g = new THREE.BufferGeometry();
    g.setAttribute('position', src.getAttribute('position').clone()); if (src !== m.geometry) src.dispose(); g.applyMatrix4(m.matrix); return g; });
  const geo = geos.length > 1 ? mergeGeometries(geos) : geos[0]; if (geos.length > 1) for (const g of geos) g.dispose();
  const o = new THREE.Mesh(geo, PROXY_MAT); o.name = 'shadow_proxy'; o.castShadow = true; o.receiveShadow = false; o.userData.shadowProxy = true; return o;
}

/** the real model: move every node of the glTF into its part's group. partsJson.nodes (from the conversion) gives each node's pivot
 *  (glTF frame, Y up, the same as the game's) and hinge axis; each one is checked against the body: for a hinged part, how far its body
 *  origin sits from the model's hinge line (the visual turns about the body's origin, so this is the drift a turn would show); for the
 *  chassis and the crate, the distance between the two points. -> { matched, missing, pivotErrMm: {name: mm}, worstMm, glow, brake } */
export function bindModel(gltfScene, parts, groups, partsJson) {
  gltfScene.updateMatrixWorld(true);
  const byName = new Map(); gltfScene.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const info = new Map(((partsJson && partsJson.nodes) || []).map((n) => [n.name, n]));
  const AX = { z: [0, 1, 0], y: [0, 0, -1] };
  const report = { matched: [], missing: [], pivotErrMm: {}, worstMm: 0, glow: [], brake: [] };
  const found = [];
  for (const p of parts) {
    const node = byName.get(p.name);
    if (!node) { report.missing.push(p.name); continue; }
    found.push([p, node, node.matrixWorld.clone()]);
  }
  const inv = new THREE.Matrix4(), wp = new THREE.Vector3();
  for (const [p, node, world] of found) {
    node.removeFromParent();
    const o = U(...p.pivot);
    wp.setFromMatrixPosition(world);
    const n = info.get(p.name), pv = n && n.pivot ? n.pivot : [wp.x, wp.y, wp.z];
    const d = [pv[0] - o[0], pv[1] - o[1], pv[2] - o[2]];
    let err = Math.hypot(...d);
    if (p.joint) { const a = AX[p.joint.axis], t = d[0] * a[0] + d[1] * a[1] + d[2] * a[2]; err = Math.hypot(d[0] - t * a[0], d[1] - t * a[1], d[2] - t * a[2]); }
    report.pivotErrMm[p.name] = +(err * 1000).toFixed(3); report.worstMm = Math.max(report.worstMm, err * 1000);
    inv.makeTranslation(-o[0], -o[1], -o[2]);
    inv.clone().multiply(world).decompose(node.position, node.quaternion, node.scale);
    const g = groups.get(p.name);
    // drop this group's placeholder meshes, nothing else: main.js and survival_view.js hang lights, the arm's pedestal, the top view's
    // stand-in, the bin's panels on these groups before the model has loaded, and they must ride on through the swap
    const casters = p.role === 'chassis' || p.role === 'crate' ? g.children.filter((c) => c.userData.placeholder && c.isMesh && c.castShadow) : [];
    const proxy = casters.length ? shadowProxy(casters) : null;
    for (const c of [...g.children]) if (c.userData.placeholder) { g.remove(c); c.geometry && c.geometry.dispose(); }
    if (proxy) g.add(proxy);
    // the model's own child nodes are parts of their own (a wheel under its module): keep only this part's meshes here
    for (const c of [...node.children]) if (info.has(c.name) || parts.some((q) => q.name === c.name)) node.remove(c);
    g.add(node);
    node.traverse((x) => {
      if (!x.isMesh) return;
      x.castShadow = false; x.receiveShadow = p.role !== 'wheel';   // (its shadow: the proxy above)
      for (const m of Array.isArray(x.material) ? x.material : [x.material]) {
        if (m.name === 'glow_cyan' && !report.glow.includes(m)) report.glow.push(m);
        if (m.name === 'light_red' && !report.brake.includes(m)) report.brake.push(m);
      }
    });
    report.matched.push(p.name);
  }
  report.worstMm = +report.worstMm.toFixed(3);
  return report;
}
