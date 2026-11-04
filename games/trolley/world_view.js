// world_view.js - the world round the hall drawn with three.js (world_spec.js is the data; world_decor.js the textures): each area's
// ground, the fence, railings and broken walls, the metro's blocks, the yard's containers and rail tracks, the plaza's signpost and
// painted compass rose, the park's dry fountain, paths and benches, dead trees from a small procedural branch kit, lamp posts, rubble,
// the cadmium puddles, a01's mud tracks, a smoggy sky with a ruined skyline, the top view's map overlay, and the set dressing: NVIDIA
// SimReady props (world_spec.js PROPS) and the dead-tree kit (assets/world/).
// Cheap on purpose: repeats are InstancedMesh (trees, lamps, props, puddles, tracks, drums), the rest is merged per material; each
// area's small things sit in a 'near' group drawn only while the camera is within NEAR_D of it (its ground, walls and blocks always
// are), and its models load the first time that happens; the top view draws everything, the props as plain boxes in one draw call.
import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { boxUV, rng } from './decor.js';
import { WORLD, PLAZA, CROSS, QUADS, FLOORS, SLICKS, TREES, worldStatics, BUILDINGS, CONTAINERS, FOUNTAIN, PARK_PATHS, LAMPS, RUBBLE, SIGNPOST, LOGS, STUMPS, DRUMS_STATIC, HALL_OUT, PROPS, PROP_KINDS, TREE_NODES, areaAt } from './world_spec.js';
import * as D from './world_decor.js';
import { createTrackSampler, TRACKS } from './tracks.js';

const DEG = Math.PI / 180;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
/** non-indexed, position / normal / uv only (and a vertex colour if asked): merge-ready */
function prep(geo, color = null) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (color) { const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); }
  return g;
}
const merge = (list) => mergeGeometries(list.filter(Boolean));
/** a box at (x, y, z) turned yaw (deg), UVs in metres (world offset), merge-ready */
function boxAt(w, h, d, x, y, z, yaw = 0, color = null) {
  const g = new THREE.BoxGeometry(w, h, d); if (yaw) g.rotateY(yaw * DEG); boxUV(g, [x, y, z]); g.translate(x, y, z); return prep(g, color);
}
/** a cylinder from a to b (radii ra at a, rb at b) */
function cylAB(a, b, ra, rb, radial = 6, color = null, open = true) {
  const dir = new THREE.Vector3().subVectors(b, a), L = dir.length(), g = new THREE.CylinderGeometry(rb, ra, L, radial, 1, open);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * L / 1.5);
  g.translate(0, L / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.normalize())); g.translate(a.x, a.y, a.z);
  return prep(g, color);
}
/** flat quads on the ground: rects [x0, x1, z0, z1] at height y, uv(x, z) */
function groundGeo(rects, y, uv) {
  const pos = [], nrm = [], uvs = [];
  for (const [x0, x1, z0, z1] of rects) for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) { pos.push(x, y, z); nrm.push(0, 1, 0); uvs.push(...uv(x, z)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); return g;
}
/** a flat strip on the ground from a to b, width w, at height y; uv: u along (m), v across (0..1) */
function stripGeo(a, b, w, y, color = null) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), nx = -dz / L * w / 2, nz = dx / L * w / 2;
  const P = [[a[0] + nx, a[1] + nz, 0, 0], [a[0] - nx, a[1] - nz, 0, 1], [b[0] - nx, b[1] - nz, L, 1], [b[0] + nx, b[1] + nz, L, 0]];
  const pos = [], uv = [], nrm = []; for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(P[k][0], y, P[k][1]); uv.push(P[k][2], P[k][3]); nrm.push(0, 1, 0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return prep(g, color);
}
/** a vertical plane along a footprint box's long axis (a fence or railing face), height h; uv in metres */
function faceAlong(s, h) {
  const alongX = s.hx > s.hz, L = (alongX ? s.hx : s.hz) * 2, g = new THREE.PlaneGeometry(L, h);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * h);
  if (!alongX) g.rotateY(Math.PI / 2); g.translate(s.x, h / 2, s.z); return prep(g);
}
const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

// ------------------------------------------------------------------------------------------------ dead trees: a small branch kit
const TREE_KIT = [   // trunk height, base radius, lean, levels, children per branch, spread (rad), shrink, broken top
  { h: 3.4, r: 0.16, lean: 0.06, levels: 3, kids: 2, spread: 0.6, shrink: 0.66, snag: true },
  { h: 2.7, r: 0.19, lean: 0.12, levels: 3, kids: 3, spread: 0.8, shrink: 0.6 },
  { h: 3.1, r: 0.15, lean: 0.28, levels: 3, kids: 2, spread: 0.62, shrink: 0.68 },
  { h: 3.9, r: 0.12, lean: 0.04, levels: 2, kids: 3, spread: 0.45, shrink: 0.6, snag: true },
  { h: 3.2, r: 0.23, lean: 0.05, levels: 3, kids: 3, spread: 0.85, shrink: 0.64 },   // the park's: big and spreading
  { h: 4.8, r: 0.19, lean: 0.03, levels: 3, kids: 2, spread: 0.38, shrink: 0.68 },   // the park's: tall and narrow
];
function treeGeometry(variant) {
  const P = TREE_KIT[variant], r = rng(900 + variant * 17), parts = [], up = V3(0, 1, 0);
  const perp = (d) => { const a = Math.abs(d.y) < 0.9 ? up : V3(1, 0, 0); return new THREE.Vector3().crossVectors(d, a).normalize(); };
  function branch(a, dir, len, r0, depth) {
    const radial = depth === 0 ? 7 : depth === 1 ? 6 : depth === 2 ? 5 : 4;
    const bend = perp(dir).applyAxisAngle(dir, r() * Math.PI * 2).multiplyScalar(0.18 * len * (depth ? 1 : P.lean * 4 + 0.2));
    const mid = a.clone().addScaledVector(dir, len * 0.5).add(bend), d2 = dir.clone().addScaledVector(bend, 0.6 / len).normalize();
    const b = mid.clone().addScaledVector(d2, len * 0.5), rm = r0 * 0.82, rb = Math.max(0.006, r0 * P.shrink);
    parts.push(cylAB(depth ? a : a.clone().setY(a.y - 0.08), mid, depth ? r0 : r0 * 1.35, rm, radial), cylAB(mid, b, rm, rb, radial));
    if (depth >= P.levels) return;
    const n = P.kids + (r() < 0.35 ? 1 : 0) - (depth === 0 && P.snag ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const from = k === 0 && depth === 0 && P.snag ? mid : r() < 0.3 ? mid.clone().lerp(b, 0.5) : b;
      const ax = perp(d2).applyAxisAngle(d2, (k / n) * Math.PI * 2 + r() * 1.2);
      const cd = d2.clone().applyAxisAngle(ax, P.spread * (0.6 + r() * 0.7)); cd.y = Math.max(cd.y, depth > 1 ? -0.25 : 0.1); cd.normalize();
      branch(from, cd, len * (0.5 + r() * 0.22), rb * (0.95 - k * 0.08), depth + 1);
    }
  }
  const lean = V3(P.lean * (r() - 0.5) * 2, 1, P.lean * (r() - 0.5) * 2).normalize();
  branch(V3(0, 0, 0), lean, P.snag ? P.h * 0.75 : P.h * 0.62, P.r, 0);
  return merge(parts);
}

export function createWorld(scene, { M, assets, glow, grime = null, quality = 'high' }) {
  const root = new THREE.Group(); root.name = 'world'; scene.add(root);
  const S = { nearD: quality === 'low' ? 10 : 13, propD: quality === 'low' ? 10 : 12, k: 0, shadows: true };
  const mesh = (geo, mat, { cast = false, receive = true, parent = root, order = 0 } = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; m.renderOrder = order; parent.add(m); return m; };
  const inst = (geo, mat, n, { cast = false, receive = true, parent = root } = {}) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const place = (im, i, x, y, z, yaw = 0, s = 1, sy = s, sz = s) => { q.setFromAxisAngle(V3(0, 1, 0), yaw); m4.compose(ps.set(x, y, z), q, sc.set(s, sy, sz)); im.setMatrixAt(i, m4); };

  // ---- the areas: each a group that is always drawn and a 'near' group of its small things (distance-culled)
  const AREAS = {
    yard: { x0: HALL_OUT.x0, x1: CROSS.x, z0: WORLD.z0, z1: CROSS.z }, plaza: PLAZA, park: { x0: CROSS.x, x1: WORLD.x1, z0: WORLD.z0, z1: CROSS.z },
    forest: { x0: WORLD.x0, x1: CROSS.x, z0: CROSS.z, z1: WORLD.z1 }, metro: { x0: CROSS.x, x1: WORLD.x1, z0: CROSS.z, z1: WORLD.z1 },
  };
  const G = {};
  for (const [id, rect] of Object.entries(AREAS)) { const far = new THREE.Group(), near = new THREE.Group(), props = new THREE.Group(); far.name = id; near.name = id + '_near'; props.name = id + '_props'; near.add(props); root.add(far, near); G[id] = { rect, far, near, props, pending: [], loaded: false, loaders: [], swaps: [], gen: 0 }; }
  const areaOf = (x, z) => { const a = areaAt(x, z); return !a || a === 'hall' ? 'yard' : a; };
  /** run once, the first time an area is near the camera: its models load then (v4: again after it was unloaded) */
  const later = (area, fn) => { if (!assets) return; G[area].loaders.push(fn); if (G[area].loaded) fn(); else G[area].pending.push(fn); };
  /** v4 (Nov 2, the area loading screens): an InstancedMesh's placeholder swapped for its model, undone when the area unloads (the
   *  placeholder kept, the model's meshes freed, the model let go once no loaded area uses it) */
  const undoSwap = (sw, area) => {
    for (const m of sw.out || []) { if (m === sw.im) continue; if (m.parent) m.parent.remove(m); m.geometry.dispose(); const i = S.trees ? S.trees.indexOf(m) : -1; if (i >= 0) S.trees.splice(i, 1); }
    if (sw.im.geometry !== sw.geo) { sw.im.geometry.dispose(); sw.im.geometry = sw.geo; sw.im.material = sw.mat; sw.im.boundingSphere = null; if (sw.im.frustumCulled) sw.im.computeBoundingSphere(); }
    sw.out = null; if (assets.release) assets.release(sw.key, area);
  };
  const swapLater = (area, key, im, size, opts, post = null) => later(area, () => {
    const a = G[area], gen = a.gen, sw = { im, geo: im.geometry, mat: im.material, key, out: null };
    return assets.swapInstanced(key, im, size, Object.assign({}, opts, { owner: area })).then((ms) => {
      if (!ms) return null; sw.out = ms; a.swaps.push(sw);
      if (a.gen !== gen || !a.loaded) { a.swaps.splice(a.swaps.indexOf(sw), 1); undoSwap(sw, area); return null; }   // unloaded while it loaded
      if (post) post(ms); return ms;
    });
  });

  // ---- materials (the hall's rust, grime and concrete where they fit: shared textures)
  const T = {
    mud: D.mudMaterial(), grass: D.grassMaterial(), asphalt: D.asphaltMaterial(), pavers: D.paversMaterial(), facade0: D.facadeMaterial(0), facade1: D.facadeMaterial(1),
    roof: D.roofMaterial(), chain: D.chainLinkMaterial(), railing: D.railingMaterial(), brick: D.brickMaterial(), bark: D.barkMaterial(), puddle: D.puddleMaterial(),
    track: D.trackMaterial(), rut: D.rutMaterial(), container: D.containerMaterial(), paint: D.paintMarkMaterial(), stain: D.stainMaterial(),
  };
  // the scene's lighting environment is a bright white room (view.js): outdoors, at a low angle, wet surfaces mirrored it (a puddle seen
  // through a door was a white disc). three takes scene.environmentIntensity for every material that has no envMap of its own, so these
  // get the same map as their own, with their own (low) intensity
  const env = scene.environment;
  for (const [m, k] of [[T.puddle, 0.06], [T.mud, 0.2], [T.rut, 0.2], [T.track, 0.2], [T.stain, 0.25]]) if (env) { m.envMap = env; m.envMapIntensity = k; }
  const rust = M.rust, concrete = M.partition;
  const concreteV = concrete.clone(); concreteV.vertexColors = true;
  const steel = new THREE.MeshStandardMaterial({ color: '#7b766e', roughness: 0.38, metalness: 0.9 });
  const sleeper = new THREE.MeshStandardMaterial({ color: '#4a4037', roughness: 0.95 });
  const sludge = new THREE.MeshStandardMaterial({ color: '#1c160f', roughness: 0.3, metalness: 0.1 });

  // ---- the ground: one mesh per kind (the yard's concrete is the hall's own floor material, laid on the hall's UVs so it runs on)
  const byKind = {};
  for (const [kind, x0, x1, z0, z1] of FLOORS) (byKind[kind] ||= []).push([x0, x1, z0, z1]);
  const metreUV = (x, z) => [x, -z], hallUV = (x, z) => [(x + 8) / 16, (6 - z) / 12];
  const GROUND_AT = { concrete: ['yard', M.floor, hallUV], pavers: ['plaza', T.pavers, metreUV], grass: ['park', T.grass, metreUV], mud: ['forest', T.mud, metreUV], asphalt: ['metro', T.asphalt, metreUV] };
  for (const [kind, rects] of Object.entries(byKind)) { const [area, mat, uv] = GROUND_AT[kind]; mesh(groundGeo(rects, 0, uv), mat, { parent: G[area].far }).name = 'ground_' + kind; }

  // ---- the boundaries: chain-link round the world, iron railings round the park, broken brick walls round the forest
  const statics = worldStatics(), chain = [], posts = [], rails = [], railPosts = [], bricks = [], rb = rng(1201);
  for (const s of statics) {
    if (s.kind === 'fence' || s.kind === 'railing') {
      const h = s.hy * 2, alongX = s.hx > s.hz, L = (alongX ? s.hx : s.hz) * 2, n = Math.max(1, Math.round(L / (s.kind === 'fence' ? 2.5 : 2.4)));
      (s.kind === 'fence' ? chain : rails).push(faceAlong(s, s.kind === 'fence' ? h - 0.05 : h));
      for (let k = 0; k <= n; k++) {
        const t = k / n - 0.5, x = s.x + (alongX ? t * L : 0), z = s.z + (alongX ? 0 : t * L);
        if (s.kind === 'fence') posts.push(cylAB(V3(x, 0, z), V3(x, h + 0.04, z), 0.038, 0.034, 6));
        else railPosts.push(boxAt(0.06, h + 0.06, 0.06, x, (h + 0.06) / 2, z));
      }
      if (s.kind === 'fence') posts.push(cylAB(V3(s.x - (alongX ? L / 2 : 0), h - 0.04, s.z - (alongX ? 0 : L / 2)), V3(s.x + (alongX ? L / 2 : 0), h - 0.04, s.z + (alongX ? 0 : L / 2)), 0.022, 0.022, 5));
    }
    if (s.kind === 'brick') {   // broken into chunks of uneven height, a few knocked down to stumps
      const alongX = s.hx > s.hz, L = (alongX ? s.hx : s.hz) * 2, th = (alongX ? s.hz : s.hx) * 2, H = s.hy * 2; let a = -L / 2;
      while (a < L / 2 - 0.01) {
        const w = Math.min(L / 2 - a, 0.5 + rb() * 0.8), h = H * (rb() < 0.15 ? 0.62 : 0.78 + rb() * 0.22), c = a + w / 2;
        bricks.push(boxAt(alongX ? w : th, h, alongX ? th : w, s.x + (alongX ? c : 0), h / 2, s.z + (alongX ? 0 : c)));
        a += w;
      }
    }
  }
  mesh(merge(chain), T.chain).name = 'fence';
  mesh(merge(posts), rust).name = 'fence_posts';
  mesh(merge(rails), T.railing).name = 'railings';
  mesh(merge(railPosts), rust).name = 'railing_posts';
  mesh(merge(bricks), T.brick, { cast: true }).name = 'brick_walls';

  // ---- the metro's blocks: facades (concrete, brick), tar roofs with their clutter, two neon signs (one light)
  {
    const sides = [[], []], roofs = [];
    for (const [x0, x1, z0, z1, h, style] of BUILDINGS) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, g = new THREE.BoxGeometry(x1 - x0, h, z1 - z0); boxUV(g, [cx, h / 2, cz]); g.translate(cx, h / 2, cz);
      const ng = prep(g), pos = ng.attributes.position, nr = ng.attributes.normal, keepS = [], keepR = [];
      for (let t = 0; t < pos.count; t += 3) (nr.getY(t) > 0.5 ? keepR : nr.getY(t) < -0.5 ? null : keepS)?.push(t);
      const pick = (idx) => { const out = new THREE.BufferGeometry(); for (const name of ['position', 'normal', 'uv']) { const src = ng.attributes[name], it = src.itemSize, a = new Float32Array(idx.length * 3 * it); idx.forEach((t, j) => { for (let v = 0; v < 3; v++) for (let c = 0; c < it; c++) a[(j * 3 + v) * it + c] = src.array[(t + v) * it + c]; }); out.setAttribute(name, new THREE.Float32BufferAttribute(a, it)); } return out; };
      sides[style].push(pick(keepS)); roofs.push(pick(keepR));
      // a parapet and the roof's clutter: a stair house, a tank on legs, a broken corner
      const r = rng(1300 + Math.round(cx * 7));
      roofs.push(boxAt(1.3, 1.2, 1.1, x0 + 0.9 + r() * (x1 - x0 - 2), h + 0.6, z0 + 0.8 + r() * (z1 - z0 - 1.8)));
      if (r() < 0.6) roofs.push(boxAt(0.9, 0.9, 0.9, x1 - 0.8, h + 1.05, z1 - 0.8), boxAt(0.08, 0.6, 0.08, x1 - 1.15, h + 0.3, z1 - 1.15), boxAt(0.08, 0.6, 0.08, x1 - 0.45, h + 0.3, z1 - 0.45));
      for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {   // the parapet, broken in places
        const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.4);
        for (let k = 0; k < n; k++) { if (r() < 0.2) continue; const t = (k + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, w = L / n, ph = 0.35 + r() * 0.25; sides[style].push(boxAt(az === bz ? w : 0.22, ph, az === bz ? 0.22 : w, x, h + ph / 2, z)); }
      }
    }
    mesh(merge(sides[0]), T.facade0, { cast: true, parent: G.metro.far }).name = 'blocks_concrete';
    mesh(merge(sides[1]), T.facade1, { cast: true, parent: G.metro.far }).name = 'blocks_brick';
    mesh(merge(roofs), T.roof, { cast: true, parent: G.metro.far }).name = 'roofs';
  }
  const signs = [];
  const neonSign = (text, color, at, rotY, w, h, parent, dead = null) => {
    const mat = new THREE.MeshBasicMaterial({ map: D.neonTexture(text, color, { dead }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); p.position.set(...at); p.rotation.y = rotY; p.renderOrder = 3; parent.add(p);
    const tray = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w * 0.76, h * 0.6, 0.04)), rust); tray.position.set(at[0] - Math.sin(rotY) * 0.03, at[1], at[2] - Math.cos(rotY) * 0.03); tray.rotation.y = rotY; parent.add(tray);
    signs.push({ mat, seed: text.length * 13 + at[0] }); return mat;
  };
  neonSign('METRO', '#ff3ea5', [BUILDINGS[0][0] - 0.05, 2.9, 13.5], -Math.PI / 2, 2.6, 0.65, G.metro.far);
  neonSign('HOTEL', '#38f3ff', [BUILDINGS[3][0] - 0.05, 6.4, 17.7], -Math.PI / 2, 2.4, 0.6, G.metro.far, 1);
  const metroLight = new THREE.PointLight('#ff4aa8', 3.2, 7, 2); metroLight.position.set(BUILDINGS[0][0] - 0.6, 2.6, 13.5); G.metro.far.add(metroLight);

  // ---- the yard: containers (instanced: a model can be swapped in), rail tracks, oil stains
  {
    const geo = prep(new THREE.BoxGeometry(2.9, 2.4, 2.15)); boxUV(geo); geo.translate(0, 1.2, 0);
    const tints = ['#8a3a22', '#2f5d5a', '#3d5270'], im = inst(geo, T.container, CONTAINERS.length, { cast: true, parent: G.yard.far }); im.name = 'containers';
    CONTAINERS.forEach(([x, z, hx, hz, , yaw, ci], i) => { const along = hx > hz; place(im, i, x, i === 1 ? CONTAINERS[0][4] : 0, z, (yaw + (along ? 0 : 90)) * DEG, 1, 1, (along ? hz : hx) * 2 / 2.15); im.setColorAt(i, new THREE.Color(tints[ci % 3])); });
    im.instanceMatrix.needsUpdate = true; if (assets) assets.swapInstanced('container', im, [2.9, 2.4, 2.15], { lift: 1.2 });
    const sl = [], rl = [];
    const track = (ax, az, bx, bz) => {   // two rails 1.435 m apart on sleepers every 0.62 m, flush with the concrete
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, yaw = Math.atan2(-uz, ux) / DEG;
      for (let s = 0.3; s < L; s += 0.7) sl.push(boxAt(0.16, 0.005, 2.1, ax + ux * s, 0.0025, az + uz * s, yaw));
      for (const o of [-0.7175, 0.7175]) rl.push(boxAt(L, 0.012, 0.07, (ax + bx) / 2 - uz * o, 0.006, (az + bz) / 2 + ux * o, yaw));
    };
    track(-5.0, 7.4, PLAZA.x0, 7.4); track(9.4, -0.6, 9.4, PLAZA.z0);
    mesh(merge(sl), sleeper, { parent: G.yard.far }).name = 'sleepers'; mesh(merge(rl), steel, { parent: G.yard.far }).name = 'rails';
    const st = [];
    for (const [x, z, r] of [[9.7, 2.9, 0.7], [4.4, 7.0, 0.5], [-3.6, 7.85, 0.6], [9.1, -2.2, 0.45], [6.9, 7.9, 0.4]]) st.push(groundGeo([[x - r, x + r, z - r, z + r]], 0.002, (px, pz) => [(px - x + r) / (2 * r), (z + r - pz) / (2 * r)]));
    for (const [k, x, z, r] of SLICKS) if (k === 'oil') for (let n = 0; n < 2; n++) st.push(groundGeo([[x - r * 1.15, x + r * 1.15, z - r * 1.15, z + r * 1.15]], 0.0025 + n * 0.0005, (px, pz) => [(px - x + r * 1.15) / (2.3 * r), (z + r * 1.15 - pz) / (2.3 * r)]));
    mesh(merge(st.map((g) => prep(g))), T.stain, { parent: G.yard.far, order: 1 }).name = 'oil_stains';
  }

  // ---- the plaza: its painted compass rose and the signpost at the crossing
  {
    const rose = D.roseTexture(QUADS.map((qd) => ({ text: qd.short, color: qd.color, a: Math.atan2(qd.at[1] - CROSS.z, qd.at[0] - CROSS.x) })));
    const m = mesh(groundGeo([[CROSS.x - 2.3, CROSS.x + 2.3, CROSS.z - 2.3, CROSS.z + 2.3]], 0.002, (x, z) => [(x - CROSS.x + 2.3) / 4.6, (CROSS.z + 2.3 - z) / 4.6]), new THREE.MeshStandardMaterial({ map: rose, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), { parent: G.plaza.far, order: 1 }); m.name = 'rose';
    mesh(cylAB(V3(SIGNPOST.x, 0, SIGNPOST.z), V3(SIGNPOST.x, SIGNPOST.h, SIGNPOST.z), SIGNPOST.r, SIGNPOST.r * 0.8, 8, null, false), rust, { cast: true, parent: G.plaza.far }).name = 'signpost';
    QUADS.forEach((qd, i) => {   // an arrow-shaped board per quadrant, readable from both sides, pointing at it
      const map = D.boardTexture(qd.short, qd.color), mat = new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.2 });
      const sh = new THREE.Shape(); sh.moveTo(0, -0.11); sh.lineTo(0.8, -0.11); sh.lineTo(0.95, 0); sh.lineTo(0.8, 0.11); sh.lineTo(0, 0.11); sh.closePath();
      const mk = (back) => { const g = new THREE.ShapeGeometry(sh), uv = g.attributes.uv, p = g.attributes.position; for (let k = 0; k < uv.count; k++) { const u = p.getX(k) / 0.95, v = (p.getY(k) + 0.11) / 0.22; uv.setXY(k, back ? 1 - u : u, v); } if (back) { g.scale(1, 1, -1); g.translate(0, 0, -0.012); } else g.translate(0, 0, 0.012); return g; };
      const board = new THREE.Group(), a = Math.atan2(-(qd.at[1] - CROSS.z), qd.at[0] - CROSS.x);
      board.add(new THREE.Mesh(mk(false), mat), new THREE.Mesh(mk(true), mat)); board.position.set(SIGNPOST.x, 1.75 + i * 0.24, SIGNPOST.z); board.rotation.y = a; G.plaza.far.add(board);
    });
  }

  // ---- lamp posts (instanced: poles, heads, a light pool on the ground each; a few dead or flickering)
  {
    const pole = merge([cylAB(V3(0, 0, 0), V3(0, 3.35, 0), 0.06, 0.045, 7), boxAt(0.7, 0.05, 0.05, 0.33, 3.32, 0), boxAt(0.12, 0.25, 0.12, 0, 0.12, 0), boxAt(0.38, 0.08, 0.2, 0.62, 3.3, 0)]);   // with its housing
    const head = prep(new THREE.BoxGeometry(0.3, 0.012, 0.14)); head.translate(0.62, 3.254, 0);   // the lens under it
    const pool = groundGeo([[-1.4, 1.4, -1.4, 1.4]], 0.006, (x, z) => [(x + 1.4) / 2.8, (1.4 - z) / 2.8]);
    const n = LAMPS.length, poles = inst(pole, rust, n, { cast: true }), heads = inst(head, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), n);
    const pools = inst(pool, new THREE.MeshBasicMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }), n, { receive: false });
    pools.renderOrder = 2; poles.name = 'lamps'; heads.name = 'lamp_heads';
    const lr = rng(1401);
    LAMPS.forEach(([x, z], i) => {
      const yaw = Math.atan2(-(CROSS.z - z), CROSS.x - x) + (lr() - 0.5) * 0.6, dead = i % 5 === 3, cold = i % 3 === 1;
      place(poles, i, x, 0, z, yaw); place(heads, i, x, 0, z, yaw); place(pools, i, x + Math.cos(yaw) * 0.62, 0, z - Math.sin(yaw) * 0.62, 0);
      const c = new THREE.Color(dead ? '#1a1410' : cold ? '#bfe6ff' : '#ffb35a'); heads.setColorAt(i, dead ? c : c.clone().multiplyScalar(1.15)); pools.setColorAt(i, dead ? new THREE.Color('#000000') : c.clone().multiplyScalar(cold ? 0.35 : 0.55));
    });
    for (const im of [poles, heads, pools]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    if (assets) assets.swapInstanced('lamp', poles, [0.8, 3.4, 0.2], { lift: 1.7 });
    S.lamps = { heads, pools };
  }

  // ---- the park: the dry fountain with its rusted robot, cracked paths, benches
  {
    const F = FOUNTAIN, conc = [], metal = [];
    conc.push(cylAB(V3(F.x, 0, F.z), V3(F.x, F.h, F.z), F.r, F.r, 28), prep(new THREE.RingGeometry(F.r - 0.18, F.r, 28, 1).rotateX(-Math.PI / 2).translate(F.x, F.h, F.z)));
    const inner = new THREE.CylinderGeometry(F.r - 0.18, F.r - 0.18, F.h - 0.2, 28, 1, true); inner.scale(-1, 1, 1); inner.translate(F.x, 0.2 + (F.h - 0.2) / 2, F.z);
    const innerP = prep(inner), nn = innerP.attributes.normal; for (let k = 0; k < nn.count; k++) nn.setXYZ(k, -nn.getX(k), -nn.getY(k), -nn.getZ(k)); conc.push(innerP);   // facing in
    conc.push(boxAt(0.55, 0.9, 0.55, F.x, 0.45, F.z));
    metal.push(boxAt(0.42, 0.55, 0.3, F.x, 1.18, F.z), boxAt(0.26, 0.22, 0.24, F.x, 1.6, F.z + 0.02), boxAt(0.14, 0.42, 0.12, F.x - 0.29, 1.12, F.z, 12), boxAt(0.14, 0.42, 0.12, F.x + 0.31, 1.3, F.z, -40));
    metal.push(cylAB(V3(F.x - 0.1, 0.9, F.z), V3(F.x - 0.12, 0.96, F.z), 0.07, 0.07, 6), cylAB(V3(F.x + 0.1, 0.9, F.z), V3(F.x + 0.12, 0.96, F.z), 0.07, 0.07, 6));
    const fc = merge(conc); boxUV(fc); mesh(fc, T.pavers, { cast: true, parent: G.park.far }).name = 'fountain';   // stone blocks (UVs in metres)
    mesh(merge(metal), rust, { cast: true, parent: G.park.far }).name = 'fountain_robot';
    mesh(new THREE.CircleGeometry(F.r - 0.17, 28).rotateX(-Math.PI / 2).translate(F.x, 0.2, F.z), sludge, { parent: G.park.far }).name = 'fountain_sludge';
    const pp = [], PP = PARK_PATHS;
    const ring = new THREE.RingGeometry(PP.ring[0], PP.ring[1], 40, 1).rotateX(-Math.PI / 2).translate(F.x, 0.003, F.z), uv = ring.attributes.uv, pz = ring.attributes.position;
    for (let k = 0; k < uv.count; k++) { const [u, v] = [(pz.getX(k) + 8) / 16, (6 - pz.getZ(k)) / 12]; uv.setXY(k, u, v); }
    pp.push(prep(ring));
    for (const [a, b] of PP.strips) { const g = stripGeo(a, b, PP.width, 0.0025), u2 = g.attributes.uv, p2 = g.attributes.position; for (let k = 0; k < u2.count; k++) u2.setXY(k, (p2.getX(k) + 8) / 16, (6 - p2.getZ(k)) / 12); pp.push(g); }
    mesh(merge(pp), M.floor, { parent: G.park.far, order: 1 }).name = 'park_paths';
  }

  // ---- the metro: rubble, burnt-out wrecks, road paint
  {
    const ch = [], rr = rng(1501);
    for (const [x, z, hx, hz, h, yaw] of RUBBLE) {
      const c = Math.cos(yaw * DEG), s = Math.sin(yaw * DEG), n = 7 + (rr() * 5 | 0);
      for (let k = 0; k < n; k++) {
        const lx = (rr() - 0.5) * hx * 1.7, lz = (rr() - 0.5) * hz * 1.7, sz = 0.12 + rr() * 0.3, wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
        const g = new THREE.BoxGeometry(sz * (1 + rr()), sz * (0.5 + rr() * 0.8), sz * (0.8 + rr() * 0.6)); g.rotateX(rr() * 0.8); g.rotateY(rr() * 3); g.rotateZ(rr() * 0.8);
        const yy = Math.min(h - sz * 0.3, sz * 0.3 + rr() * h * 0.6); boxUV(g, [wx, yy, wz]); g.translate(wx, yy, wz); ch.push(prep(g, rr() < 0.3 ? '#a0614a' : '#cfcac2'));
      }
      ch.push(cylAB(V3(x, 0.1, z), V3(x + (rr() - 0.5) * 0.6, h + 0.25, z + (rr() - 0.5) * 0.4), 0.008, 0.008, 4, '#3a2a20'));   // rebar
    }
    mesh(merge(ch), concreteV, { parent: G.metro.near }).name = 'rubble';
    const pm = [], W = '#e8e2d4', Y = '#d9a722';
    for (let k = 0; k < 6; k++) pm.push(stripGeo([13.3, 9.0 + k * 0.44], [14.1, 9.0 + k * 0.44], 0.24, 0.003, W));   // the crosswalk from the plaza into the avenue
    for (let k = 0; k < 5; k++) pm.push(stripGeo([17.8 + k * 0.48, 11.95], [17.8 + k * 0.48, 12.75], 0.24, 0.003, W));   // across the cross street
    for (let k = 0; k < 6; k++) pm.push(stripGeo([10.9 + k * 0.47, 11.3], [10.9 + k * 0.47, 12.1], 0.24, 0.003, W));    // across the west street
    for (let x = 14.6; x < 23.6; x += 1.6) pm.push(stripGeo([x, 10.2], [x + 0.8, 10.2], 0.1, 0.003, Y));                // the avenue's centre line
    for (let z = 12.6; z < 18.6; z += 1.6) pm.push(stripGeo([12.0, z], [12.0, z + 0.8], 0.1, 0.003, Y));               // the west street's
    pm.push(stripGeo([20.5, 14.4], [20.5, 16.2], 0.3, 0.003, W));
    mesh(merge(pm), T.paint, { parent: G.metro.far, order: 1 }).name = 'road_paint';
  }

  // ---- the dead trees (instanced per variant, in the forest and the park), logs, stumps, the half-sunk drums, the forest track's ruts
  {
    const geos = TREE_KIT.map((_, v) => treeGeometry(v)), counts = new Map();
    for (const t of TREES) counts.set(t[2], (counts.get(t[2]) || 0) + 1);
    const trees = new Map();
    for (const [v, n] of counts) { const im = inst(geos[v], T.bark, n, { cast: false, parent: v >= 4 ? G.park.near : G.forest.near }); im.name = 'trees_' + v; im.userData.n = 0; trees.set(v, im); }   // no shadows: 30-odd trees would double their triangles
    for (const [x, z, v, s, yaw] of TREES) { const im = trees.get(v); place(im, im.userData.n++, x, -0.02, z, yaw * DEG, s); }
    for (const [v, im] of trees) {
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      if (TREE_NODES[v]) swapLater(v >= 4 ? 'park' : 'forest', 'treeKit', im, null, { native: true, node: TREE_NODES[v], scale: v === 3 ? 0.7 : 0.85 }, (ms) => { S.trees.push(...ms.slice(1)); for (const m of ms) deadBark(m.material); });
    }
    S.trees = [...trees.values()];
    const wood = [];
    for (const [x, z, r, hl, yaw] of LOGS) { const c = Math.cos(yaw * DEG) * hl, s = -Math.sin(yaw * DEG) * hl; wood.push(cylAB(V3(x - c, r, z - s), V3(x + c, r * 0.95, z + s), r, r * 0.9, 7, null, false)); }
    for (const [x, z, r] of STUMPS) wood.push(cylAB(V3(x, -0.05, z), V3(x, 0.42, z), r * 1.25, r * 0.95, 7, null, false));
    mesh(merge(wood), T.bark, { cast: true, parent: G.forest.near }).name = 'logs';
    const drumGeo = prep(new THREE.CylinderGeometry(0.32, 0.32, 0.87, 16)); drumGeo.translate(0, 0.435, 0);
    const di = inst(drumGeo, rust, DRUMS_STATIC.length, { cast: true, parent: G.forest.near }); di.name = 'drums_sunk';
    DRUMS_STATIC.forEach(([x, z, yaw], i) => { q.setFromEuler(new THREE.Euler(0.12 * (i % 2 ? 1 : -1), yaw * DEG, 0.18)); m4.compose(ps.set(x, -0.25, z), q, sc.set(1, 1, 1)); di.setMatrixAt(i, m4); });
    di.instanceMatrix.needsUpdate = true; di.computeBoundingSphere();
    swapLater('forest', 'drum', di, [0.642, 0.868, 0.657], { lift: 0.434 });
    const ruts = stripGeo([-7.4, 9.7], [8.0, 9.7], 0.95, 0.0015); const ur = ruts.attributes.uv; for (let k = 0; k < ur.count; k++) ur.setXY(k, ur.getY(k), ur.getX(k));   // the grooves run along
    mesh(ruts, T.rut, { parent: G.forest.far, order: 1 }).name = 'ruts';
  }

  // ---- the set dressing (world_spec.js PROPS): per kind and area an InstancedMesh, a box on its collider until the model loads (the
  //      first time the camera comes near the area), the game's grime shader on the props that keep NVIDIA's own textures; in the top
  //      view the models are hidden and every prop is a flat footprint in its quadrant's colour, all in one InstancedMesh (the models
  //      carry up to ten materials each)
  const CASTS = new Set(['rack', 'pipes']);   // the big silhouettes only: every material is a shadow draw call
  const propMat = new THREE.MeshStandardMaterial({ color: '#7a6c60', roughness: 0.8, metalness: 0.3 }), byKA = new Map(), QC = Object.fromEntries(QUADS.map((qd) => [qd.id, qd.color])), propGroups = [];
  // the kit's bark is bleached pale: darken it to the hall's grit, with dirt climbing the trunks from the mud (the grime shader)
  const barked = new Set(), deadBark = (m) => { if (!m || barked.has(m)) return; barked.add(m); m.color.multiplyScalar(0.36); m.roughness = Math.max(m.roughness, 0.9); if (grime) grime(m, [1, 0.15, 0.1], 0.4); };
  const proxies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.2 }), PROPS.length);
  proxies.name = 'prop_boxes'; proxies.visible = false; root.add(proxies);
  PROPS.forEach(([k, x, z, yaw, y0 = 0], i) => {
    const [hx, hy, hz] = PROP_KINDS[k].h, key = k + '|' + areaOf(x, z); if (!byKA.has(key)) byKA.set(key, []); byKA.get(key).push([x, z, yaw, y0]);
    place(proxies, i, x, 0.02, z, yaw * DEG, hx * 2, 0.06, hz * 2);   // a flat footprint: a map symbol
    proxies.setColorAt(i, new THREE.Color(QC[x < CROSS.x ? (z < CROSS.z ? 'dock' : 'forest') : z < CROSS.z ? 'park' : 'metro']).lerp(new THREE.Color('#1a1512'), 0.25));
  });
  proxies.instanceMatrix.needsUpdate = true; proxies.computeBoundingSphere();
  const SKIP_GRIME = /screen|glass|lamp|trans|led|neon/i;
  for (const [key, list] of byKA) {
    const [k, a] = key.split('|'), K = PROP_KINDS[k], [hx, hy, hz] = K.h;
    const grp = new THREE.Group(); grp.name = 'props_' + k; G[a].props.add(grp);   // the placeholder and every mesh its model brings: culled together by distance
    let cx = 0, cz = 0; for (const [x, z] of list) { cx += x / list.length; cz += z / list.length; } let rr = 0; for (const [x, z] of list) rr = Math.max(rr, Math.hypot(x - cx, z - cz));
    propGroups.push({ grp, x: cx, z: cz, r: rr + Math.max(hx, hz, hy) });
    const im = inst(new THREE.BoxGeometry(hx * 2, Math.max(0.02, hy * 2), hz * 2).translate(0, hy, 0), propMat, list.length, { cast: CASTS.has(k), parent: grp }); im.name = 'prop_' + k;
    list.forEach(([x, z, yaw, y0], i) => place(im, i, x, y0, z, yaw * DEG)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    swapLater(a, k, im, null, { native: true }, (ms) => {
      if (!K.grime || !grime) return;
      const seen = new Set(); for (const m of ms) if (!seen.has(m.material) && m.material.isMeshStandardMaterial && !SKIP_GRIME.test(m.material.name || '')) { seen.add(m.material); grime(m.material, K.grime); }
    });
  }

  // ---- the cadmium puddles (one InstancedMesh: forest and metro) and a01's mud tracks (a ring buffer)
  const pud = SLICKS.filter((s) => s[0] === 'puddle'), pg = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const puddles = inst(pg, T.puddle, pud.length, { receive: true }); puddles.name = 'puddles'; puddles.renderOrder = 2;
  pud.forEach(([, x, z, r], i) => place(puddles, i, x, 0.0045, z, i * 1.9, r * 1.08)); puddles.instanceMatrix.needsUpdate = true; puddles.computeBoundingSphere();
  const trackGeo = new THREE.PlaneGeometry(1, 0.075).rotateX(-Math.PI / 2);
  const tracks = new THREE.InstancedMesh(trackGeo, T.track, TRACKS.cap); tracks.name = 'mud_tracks'; tracks.count = 0; tracks.frustumCulled = false; tracks.receiveShadow = true; tracks.renderOrder = 1; G.forest.near.add(tracks);
  const sampler = createTrackSampler();
  function addTracks(wheels) {
    const marks = sampler.update(wheels); if (!marks.length) return 0;
    let lo = Infinity, hi = -1;
    for (const m of marks) { place(tracks, m.slot, m.x, 0.0032 + (m.slot % 7) * 0.00005, m.z, m.yaw, m.len * 1.15, 1, 1); lo = Math.min(lo, m.slot); hi = Math.max(hi, m.slot); }
    tracks.count = sampler.count;
    const a = tracks.instanceMatrix; if (a.addUpdateRange && hi - lo < TRACKS.cap / 2) { a.clearUpdateRanges(); a.addUpdateRange(lo * 16, (hi - lo + 1) * 16); } a.needsUpdate = true;
    return marks.length;
  }
  function resetTracks() { sampler.reset(); tracks.count = 0; }

  // ---- the wasteland past the fence (dark ground into the fog: no void at the world's edge)
  mesh(groundGeo([[-100, 100, -100, 100]], -0.02, (x, z) => [x / 4, -z / 4]), new THREE.MeshStandardMaterial({ color: '#15110e', roughness: 1, metalness: 0 }), { receive: false }).name = 'wasteland';

  // ---- the sky: a smoggy dome and the ruined skyline, both following the camera (never in the fog)
  const skyGeo = new THREE.SphereGeometry(90, 24, 12), sp = skyGeo.attributes.position, cols = new Float32Array(sp.count * 3);
  const zen = new THREE.Color('#090b10'), mid = new THREE.Color('#1d1718'), hor = new THREE.Color('#3e2a1d'), tmp = new THREE.Color();
  for (let i = 0; i < sp.count; i++) { const y = sp.getY(i) / 90; if (y > 0.18) tmp.lerpColors(mid, zen, Math.min(1, (y - 0.18) / 0.6)); else tmp.lerpColors(hor, mid, Math.max(0, y) / 0.18); cols.set([tmp.r, tmp.g, tmp.b], i * 3); }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.renderOrder = -2; sky.name = 'sky'; root.add(sky);
  const skyline = new THREE.Mesh(new THREE.CylinderGeometry(78, 78, 26, 48, 1, true), new THREE.MeshBasicMaterial({ map: D.skylineTexture(), transparent: true, alphaTest: 0.4, side: THREE.BackSide, fog: false, depthWrite: false, color: '#ffffff' }));
  skyline.renderOrder = -1; skyline.name = 'skyline'; root.add(skyline);

  // ---- the top view's map: a tint over each quadrant, its border, a big label (all drawn only in the top view)
  const overlay = new THREE.Group(); overlay.name = 'map_overlay'; overlay.visible = false; root.add(overlay);
  const tints = [], labels = [], border = [];
  for (const qd of QUADS) {
    const m = new THREE.Mesh(groundGeo([[qd.x0 + 0.15, qd.x1 - 0.15, qd.z0 + 0.15, qd.z1 - 0.15]], 0.05, () => [0, 0]), new THREE.MeshBasicMaterial({ color: qd.color, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    m.renderOrder = 8; overlay.add(m); tints.push(m);
    for (const [a, b] of [[[qd.x0, qd.z0], [qd.x1, qd.z0]], [[qd.x1, qd.z0], [qd.x1, qd.z1]], [[qd.x1, qd.z1], [qd.x0, qd.z1]], [[qd.x0, qd.z1], [qd.x0, qd.z0]]]) border.push(stripGeo(a, b, 0.22, 0.07, qd.color));
  }
  const bm = new THREE.Mesh(merge(border), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false })); bm.renderOrder = 9; overlay.add(bm);
  for (const [text, at, hgt, color] of [...QUADS.map((qd) => [qd.name, qd.at, qd.id === 'dock' ? 1.9 : 2.3, qd.color]), ['PLAZA', [CROSS.x, CROSS.z], 1.0, '#ffffff']]) {
    const L = D.labelTexture(text), w = hgt * 1024 / 160, mat = new THREE.MeshBasicMaterial({ map: L.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, color });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), mat); p.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.add(p); g.position.set(at[0], 0.12, at[1]);   // on the ground, drawn over everything
    g.renderOrder = 10; p.renderOrder = 10; overlay.add(g); labels.push(g);
  }

  // ------------------------------------------------------------------------------------------------ per frame
  /** cam: the camera; k: the top-view blend (0 chase .. 1 top); az: the camera's azimuth (main.js cam.a); t: seconds */
  function update(cam, k, az, t) {
    S.k = k; const cx = cam.position.x, cz = cam.position.z;
    sky.position.copy(cam.position); skyline.position.set(cx, 9, cz);
    // the load gate (main.js): before play and through the tutorial's shut hall no area loads its models (the boot stays light on a
    // phone), and an area not yet loaded is not drawn up close (its placeholder boxes would show over the hall's walls)
    const may = !S.gate || S.gate();
    for (const [id, a] of Object.entries(G)) {
      const near = k > 0.55 || rectDist(a.rect, cx, cz) < S.nearD, ok = !S.zones || S.zones(id);   // v4: the area loading screens: only the zone's areas
      a.near.visible = near && (S.zones ? ok || k > 0.55 : may || a.loaded || k > 0.55); a.props.visible = k <= 0.8;
      if (near && may && ok && k <= 0.55 && !a.loaded) loadArea(id);   // its models load now
    }
    proxies.visible = k > 0.8;
    for (const pg of propGroups) pg.grp.visible = Math.hypot(pg.x - cx, pg.z - cz) - pg.r < S.propD;   // each kind's props, by distance
    const show = k > 0.3; overlay.visible = show;
    if (show) {
      const o = Math.min(1, (k - 0.3) / 0.5);
      for (const m of tints) m.material.opacity = 0.17 * o; bm.material.opacity = 0.7 * o;
      for (const g of labels) { g.rotation.y = az - Math.PI / 2; g.children[0].material.opacity = 0.92 * o; }
    }
    T.puddle.emissiveIntensity = 0.48 + 0.12 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 5.3);
    T.puddle.map.offset.set(0.02 * Math.sin(t * 0.3), 0.02 * Math.cos(t * 0.23));
    for (const s of signs) { const f = Math.sin(t * 7.1 + s.seed) > 0.985 ? 0.15 : 0.92 + 0.08 * Math.sin(t * 31 + s.seed); s.mat.color.setScalar(f); }
    metroLight.intensity = 3.2 * signs[0].mat.color.r;
  }
  /** 'high' | 'low' (the frame-time ladder): a shorter reach for the small things and the props */
  function setQuality(level) { S.nearD = level === 'low' ? 9 : quality === 'low' ? 10 : 13; S.propD = level === 'low' ? 9 : quality === 'low' ? 10 : 12; }
  function stats() {
    const near = Object.fromEntries(Object.entries(G).map(([id, a]) => [id, a.near.visible])), loaded = Object.fromEntries(Object.entries(G).map(([id, a]) => [id, a.loaded]));
    return { near, loaded, overlay: overlay.visible, proxies: proxies.visible, tracks: tracks.count, tracksTotal: sampler.total, cap: TRACKS.cap, trees: TREES.length, puddles: pud.length, lamps: LAMPS.length, props: PROPS.length };
  }
  /** load every area's models now (the tests, the video) */
  function loadAll() { for (const a of Object.values(G)) if (!a.loaded) { a.loaded = true; for (const fn of a.pending.splice(0)) fn(); } }
  /** gate(): may the areas near the camera load their models now; onLoad(area): one starts loading */
  function setLoadGate(gate, onLoad = null) { S.gate = gate; S.onLoad = onLoad; }
  /** v4 (Nov 2, Josh: "a loading screen between areas so that memory use is lower"): zones(id) -> may this area load (null: all may) */
  function setZones(zones) { S.zones = typeof zones === 'function' ? zones : null; }
  /** an area's models load now (its loaders, again after an unload) -> false if it was loaded */
  function loadArea(id, { serial = false } = {}) {
    const a = G[id]; if (!a || a.loaded || !assets) return serial ? Promise.resolve(false) : false;
    a.loaded = true; if (S.onLoad) S.onLoad(id);
    const fns = a.pending.splice(0);
    if (!serial) { for (const fn of fns) fn(); return true; }
    // v4 (Nov 3): one model at a time (the zone loading screen): a whole zone's decoded pictures at once were a peak at the change
    return (async () => { for (const fn of fns) { if (!a.loaded) break; try { await fn(); } catch (e) { /* a model that fails keeps its placeholder */ } } return true; })();
  }
  /** an area's models let go: its placeholders back, its meshes freed, each model freed once no loaded area uses it -> false if it wasn't loaded */
  function unloadArea(id) {
    const a = G[id]; if (!a || !a.loaded) return false;
    a.gen++; a.loaded = false;
    for (const sw of a.swaps.splice(0)) undoSwap(sw, id);
    a.pending = a.loaders.slice(); a.near.visible = false;
    return true;
  }
  return { root, update, addTracks, resetTracks, setQuality, stats, loadAll, setLoadGate, setZones, loadArea, unloadArea, areas: G, overlay, proxies, tracks, sampler, materials: T, metroLight };
}
