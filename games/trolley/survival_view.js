// survival_view.js - the open world drawn (v5): the hall's roller shutters, the salvage sites, the shelter piece by piece (its gates fold
// and swing with their colliders), the crafted machines in it, the energy leeches (instanced, slithering, cadmium eyes), the solar panels
// on the bin (each one's age on its face), the Tetrabrachion and the Dioscuri Rig on a01 (display only), the Small Vigils, the night (the
// sun, the sky, the fog, a01's headlamp) and the collect bubble's turntable. Models are NVIDIA SimReady (CC BY 4.0, modified:
// assets/survival/, assets/craft/), loaded the first time they are needed near a01, their textures drawn down to 512 px; many of a kind
// are one InstancedMesh per material. A fixed pool of lights is made at the start (adding lights later recompiles every shader): two
// point lights and a01's headlamp, three more lights in every fragment's loop, all of them at 0 until the open world needs them.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { dropImage } from './assets.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { daylight, clockAt, LEECH } from './survival_rules.js';
import { SLICKS } from './world_spec.js';
import { ROOM } from './level_spec.js';

const DEG = Math.PI / 180;
const lerp = (a, b, k) => a + (b - a) * k;

export function createSurvivalView({ scene, renderer, view, assets, world, sim, crateGroup, armGroup, chassisG, cat, itemGroup = null }) {
  const root = new THREE.Group(); root.name = 'survival'; scene.add(root);
  const M = {
    shutter: new THREE.MeshStandardMaterial({ color: '#5d6a66', roughness: 0.65, metalness: 0.5 }),
    ghost: new THREE.MeshBasicMaterial({ color: '#38f3ff', transparent: true, opacity: 0.35, depthWrite: false, wireframe: true }),
    outline: new THREE.LineBasicMaterial({ color: '#38f3ff', transparent: true, opacity: 0.7 }),
    proxy: new THREE.MeshStandardMaterial({ color: '#6b5546', roughness: 0.8, metalness: 0.3 }),
    leech: new THREE.MeshStandardMaterial({ color: '#1a1422', roughness: 0.3, metalness: 0.6 }),
    eye: new THREE.MeshStandardMaterial({ color: '#2a2000', emissive: '#FFD21F', emissiveIntensity: 2.5, roughness: 0.3 }),
    ring: new THREE.MeshBasicMaterial({ color: '#38f3ff', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    uv: new THREE.MeshBasicMaterial({ color: '#00E5FF', transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
  };
  /** after an InstancedMesh's instances change: its bounds from them, so the renderer skips it when it is off screen */
  const bound = (m) => { if (!m.count) return; m.boundingSphere = null; m.computeBoundingSphere(); m.frustumCulled = true; };
  // ---- models: through assets.js (one cache, textures drawn down) under their catalog ids
  const key = (id) => 'sv:' + id;
  for (const [id, e] of Object.entries(cat)) if (e.glb) assets.register(key(id), e.glb);
  assets.register('sv:leech', 'assets/survival/energy_leech.glb'); assets.register('sv:panel', 'assets/survival/solar_panel.glb');
  const model = (id) => assets.model(key(id));

  // ---------------------------------------------------------------------------------------------- the pool of lights (made once)
  const pool = [0, 1].map(() => { const l = new THREE.PointLight('#00E5FF', 0, 4, 2); l.castShadow = false; scene.add(l); return l; });   // in the scene itself: always counted, so no shader ever recompiles
  const head = new THREE.SpotLight('#dff6ff', 0, 14, 0.62, 0.45, 1.6); head.castShadow = false; head.position.set(0.45, 0.62, 0); head.target.position.set(4, -0.6, 0); chassisG.add(head, head.target);

  // ---------------------------------------------------------------------------------------------- the hall's shutters
  const shutters = (sim.v2.hallDoors || []).map((D) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(D.hx * 2, 1, D.hz * 2 + 0.01), M.shutter); g.castShadow = true; g.receiveShadow = true; scene.add(g); return { D, g };
  });
  function syncShutters() { for (const { D, g } of shutters) { const h = Math.max(0.01, D.h * (1 - D.open)); g.scale.y = h; g.position.set(D.x, D.h - h / 2, D.z); g.visible = h > 0.02; } }

  // ---------------------------------------------------------------------------------------------- instanced groups (a model, many poses)
  /** a set of instances of one catalog item: placeholders (its collider box) until the model loads; set(poses) */
  function instSet(id, cap, { y = 0, shadow = false } = {}) {
    const e = cat[id], col = (e && e.game && e.game.collider) || { c: [0, 0.3, 0], h: [0.3, 0.3, 0.3] };
    const geo = new THREE.BoxGeometry(col.h[0] * 2, col.h[1] * 2, col.h[2] * 2); geo.translate(col.c[0], col.c[1], col.c[2]);
    const im = new THREE.InstancedMesh(geo, M.proxy, cap); im.count = 0; im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false; root.add(im);
    const S = { id, meshes: [im], poses: [], loaded: false, loading: false, y };
    S.load = () => { if (S.loading) return; S.loading = true; assets.swapInstanced(key(id), im, null, { native: true }).then((out) => { if (out) { S.meshes = out; for (const m of out) { m.castShadow = shadow; m.frustumCulled = false; } S.loaded = true; S.apply(); } }); };
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    S.apply = () => { const n = S.poses.length; S.poses.forEach((ps, i) => { p.set(ps.x, (ps.y || 0) + y, ps.z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ps.yaw); mt.compose(p, q, one); S.meshes[0].setMatrixAt(i, mt); });
      for (const m of S.meshes) { m.count = n; m.visible = n > 0; bound(m); } S.meshes[0].instanceMatrix.needsUpdate = true; };
    S.set = (poses) => { S.poses = poses.slice(0, cap); S.apply(); };
    return S;
  }

  // ---------------------------------------------------------------------------------------------- the loose supplies, instanced by kind
  const supplySets = new Map(), SCAP = 32;
  function supplySet(kind) {
    const k = sim.kinds[kind], geo = new THREE.BoxGeometry(...k.size), im = new THREE.InstancedMesh(geo, M.proxy, SCAP); im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true; root.add(im);
    const st = { meshes: [im], n: 0 };
    assets.swapInstanced(key(k.supply), im, k.size).then((out) => { if (out) { st.meshes = out; for (const m of out) { m.castShadow = false; m.frustumCulled = false; m.count = st.n; m.visible = st.n > 0; bound(m); } } });
    st.set = (gs) => { const n = Math.min(SCAP, gs.length); st.n = n; for (let i = 0; i < n; i++) { const g = gs[i]; mt.compose(g.position, g.quaternion, one); st.meshes[0].setMatrixAt(i, mt); }
      for (const m of st.meshes) { m.count = n; m.visible = n > 0; bound(m); } st.meshes[0].instanceMatrix.needsUpdate = true; };
    return st;
  }
  const mt = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);

  // ---------------------------------------------------------------------------------------------- salvage sites
  const siteSets = new Map();
  let sitesBuilt = false;
  function buildSiteSets(sites) {
    const by = new Map(); for (const s of sites) if (s.kind === 'spot' || s.kind === 'husk') { if (!by.has(s.item)) by.set(s.item, []); by.get(s.item).push(s); }
    for (const [id, list] of by) if (!siteSets.has(id) && id !== 'leech_husk') siteSets.set(id, Object.assign(instSet(id, list.length), { sites: list }));
    sitesBuilt = true;
  }
  // a ring on the ground round every salvage within 14 m (bright on the one in the arm's reach)
  const ringGeo = new THREE.RingGeometry(0.92, 1.0, 40); ringGeo.rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, M.ring, 64); rings.count = 0; rings.frustumCulled = false; rings.renderOrder = 2; root.add(rings);
  const ringMat = new THREE.Matrix4();

  // ---------------------------------------------------------------------------------------------- the shelter
  const sh = { key: null, sets: new Map(), doors: new Map(), ghost: null, outline: null, singles: new Map() };
  const SHADOW = new Set(['wire_wall', 'pallet_rack', 'guard_panel', 'dock_charger', 'roof_pallet']);   // only the big silhouettes cast shadows (the frame's budget)
  function clearShelter() {
    for (const S of sh.sets.values()) for (const m of S.meshes) { root.remove(m); }
    for (const d of sh.doors.values()) root.remove(d.g);
    for (const g of sh.singles.values()) root.remove(g);
    if (sh.outline) root.remove(sh.outline); if (sh.ghost) root.remove(sh.ghost);
    sh.sets.clear(); sh.doors.clear(); sh.singles.clear(); sh.outline = null; sh.ghost = null; sh.key = null; sh.bk = null;
  }
  function syncShelter(surv, t) {
    const S = surv.shelter;
    if (!S) { if (sh.key) clearShelter(); return; }
    const k = `${S.concept}@${S.site.x},${S.site.z},${S.site.yaw}`;
    if (sh.key !== k) { clearShelter(); sh.key = k;
      const L = surv.layoutOf(), counts = new Map(); for (const p of L) if (!p.door && !p.found) counts.set(p.item, (counts.get(p.item) || 0) + 1);
      for (const [id, n] of counts) { const st = instSet(id, n, { shadow: SHADOW.has(id) }); sh.sets.set(id, st); st.load(); }
      // the outline of the site on the ground
      const b = surv.shelters.bounds(S.concept, S.site, 0), c = Math.cos(b.yaw), s = Math.sin(b.yaw), pts = [];
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]) pts.push(new THREE.Vector3(b.x + u * b.hx * c + v * b.hz * s, 0.02, b.z - u * b.hx * s + v * b.hz * c));
      sh.outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.outline); root.add(sh.outline);
      sh.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.ghost); root.add(sh.ghost);
    }
    // the poses and the next piece only when the build changes (not every frame)
    const bk = S.built.size + ':' + Object.values(surv.inv.claims).join(',') + ':' + Object.keys(surv.S.owned).length;
    if (sh.bk !== bk) { sh.bk = bk; sh.L = surv.layoutOf(); sh.pr = surv.shelters.progress(S.concept, S.built, (id) => surv.inv.count(id), surv.S.owned); sh.dirty = true; }
    const L = sh.L, poses = new Map();
    if (sh.dirty) for (const p of L) {
      if (!S.built.has(p.key)) continue;
      if (p.found) {   // the warehouse modules: one each, sunk
        if (!sh.singles.has(p.key)) { const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw; root.add(g); sh.singles.set(p.key, g); model(p.item).then((m) => { if (m) { const o = m.clone(true); o.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); g.add(o); } }); }
        continue;
      }
      if (p.door) {
        if (!sh.doors.has(p.key)) { const g = new THREE.Group(); root.add(g); const d = { g, p, nodes: null }; sh.doors.set(p.key, d);
          model(p.item).then((m) => { if (!m) return; const o = m.clone(true); o.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); g.add(o); d.nodes = { lat: o.getObjectByName('gate_lattice'), post: o.getObjectByName('gate_post_b') }; }); }
        continue;
      }
      if (!poses.has(p.item)) poses.set(p.item, []); poses.get(p.item).push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw });
    }
    if (sh.dirty) { for (const [id, st] of sh.sets) st.set(poses.get(id) || []); sh.dirty = false; }
    // the gates: the accordion's lattice scaled on its x, its far post following (extras.door); the dock gate swings about its end
    const open = S.gate ? S.gate.open : 0;
    for (const d of sh.doors.values()) {
      const p = d.p;
      if (p.item === 'accordion_gate') {
        d.g.position.set(p.x, 0, p.z); d.g.rotation.y = p.yaw;
        if (d.nodes && d.nodes.lat) { const sc = 0.89 - (0.89 - 0.12) * open; d.nodes.lat.scale.x = sc; if (d.nodes.post) d.nodes.post.position.x = d.nodes.lat.position.x + 2.93 * sc; }
      } else { const Lh = 1.58, hx = p.x - Lh * Math.cos(p.yaw), hz = p.z + Lh * Math.sin(p.yaw), phi = p.yaw - open * Math.PI / 2; d.g.position.set(hx + Lh * Math.cos(phi), 0, hz - Lh * Math.sin(phi)); d.g.rotation.y = phi; }
    }
    // the next piece's ghost, pulsing
    const pr = sh.pr, nx = pr.next || (pr.blocked && pr.blocked.piece);
    if (sh.ghost) { const P = nx && L.find((q) => q.key === nx.key); sh.ghost.visible = !!(P && P.cols.length);
      if (sh.ghost.visible) { const c = P.cols[0]; sh.ghost.position.set(c.c[0], c.c[1], c.c[2]); sh.ghost.scale.set(c.h[0] * 2, c.h[1] * 2, c.h[2] * 2); sh.ghost.rotation.y = c.yaw; M.ghost.opacity = 0.25 + 0.2 * Math.sin(t * 4); } }
    if (sh.outline) sh.outline.visible = !pr.sealed;
  }

  // ---------------------------------------------------------------------------------------------- the crafted machines in the shelter
  const stations = new Map();
  /** a static model as one mesh per material (a station has a dozen or two parts, a handful of materials): its draws, cut */
  function mergeByMaterial(o) {
    o.updateMatrixWorld(true); const inv = o.matrixWorld.clone().invert(), sets = new Map(), out = new THREE.Group(), mm = new THREE.Matrix4();
    o.traverse((x) => { if (!x.isMesh || x.isInstancedMesh || x.isSkinnedMesh || Array.isArray(x.material) || Object.keys(x.geometry.morphAttributes).length) return;
      const k = x.material.uuid + (x.geometry.index ? 'I' : 'n') + Object.keys(x.geometry.attributes).sort().join(); if (!sets.has(k)) sets.set(k, []); sets.get(k).push(x); });
    let n = 0;
    for (const list of sets.values()) {
      const geos = list.map((x) => { const g = x.geometry.clone(); g.clearGroups(); g.applyMatrix4(mm.multiplyMatrices(inv, x.matrixWorld)); return g; });
      const geo = geos.length > 1 ? mergeGeometries(geos) : geos[0]; if (geos.length > 1) for (const g of geos) g.dispose();
      if (!geo) return o;   // (not mergeable: drawn as it is)
      const m = new THREE.Mesh(geo, list[0].material); m.castShadow = false; m.receiveShadow = true; m.userData.ownGeo = true; out.add(m); n += list.length;
    }
    return n ? out : o;
  }
  const dropStation = (g) => { root.remove(g); g.traverse((x) => { if (x.userData.ownGeo) x.geometry.dispose(); }); };
  function syncStations(surv) {
    for (const [id, g] of stations) if (!surv.placed.some((p) => p.id === id)) { dropStation(g); stations.delete(id); }
    for (const p of surv.placed) {
      if (stations.has(p.id)) continue;
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = p.yaw; root.add(g); stations.set(p.id, g);
      const out = surv.crafting.byId.get(p.id).output; model(out).then((m) => { if (m && stations.get(p.id) === g) { const o = m.clone(true); o.traverse((x) => { if (x.isMesh) { x.castShadow = false; x.receiveShadow = true; } }); const mo = mergeByMaterial(o); mo.scale.setScalar(playScale(out)); g.add(mo); } });
    }
  }

  // ---------------------------------------------------------------------------------------------- the leeches (and their husks)
  const LMAX = 10, HMAX = 24;
  const lv = { loaded: false, tmpl: null, meshes: [], husk: [], placeholder: null };
  { // placeholder until the model loads: a dark capsule and two yellow eyes
    const body = new THREE.CapsuleGeometry(LEECH.radius, LEECH.half * 2, 4, 8); body.rotateZ(Math.PI / 2); body.translate(-0.3, 0.07, 0);
    const pb = new THREE.InstancedMesh(body, M.leech, LMAX), pe = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6).translate(0.2, 0.11, 0), M.eye, LMAX);
    for (const m of [pb, pe]) { m.count = 0; m.frustumCulled = false; root.add(m); }
    lv.placeholder = [pb, pe];
  }
  // the night's readability: no extra light (the dark stays dark), but a faint cold rim on the leeches' bodies, a wet sheen where they
  // turn away from the eye (a Fresnel term in their own emissive, strongest at night: survival_rules.js LEECH.rim), so their shapes
  // read against the ground; the cadmium eyes stay the brightest thing on them
  const rimU = { k: { value: 0 }, c: { value: new THREE.Color(LEECH.rim.color) } };
  function addRim(mat) {
    mat.customProgramCacheKey = () => 'leechRim';
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.rimK = rimU.k; sh.uniforms.rimC = rimU.c;
      sh.fragmentShader = 'uniform float rimK;\nuniform vec3 rimC;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n{ float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += rimC * (rimK * rimF * rimF * rimF); }');
    };
    return mat;
  }
  addRim(M.leech);
  let leechWanted = false;
  function loadLeech() {
    if (leechWanted) return; leechWanted = true;
    assets.model('sv:leech').then((scn) => {
      if (!scn) return;
      const t = scn.clone(true); t.updateMatrixWorld(true);
      const nodes = {}; t.traverse((o) => { if (o.name) nodes[o.name] = o; });
      const mk = (cap, dead) => { const out = []; t.traverse((o) => { if (!o.isMesh) return; let mat = o.material; if (dead) { mat = mat.clone(); if (mat.emissive) { mat.emissive.set('#000000'); mat.emissiveIntensity = 0; } mat.color && mat.color.multiplyScalar(0.55); }
        else if (/eye/i.test(o.name) || /eye/i.test(o.parent && o.parent.name)) { mat = mat.clone(); mat.emissive && mat.emissive.set('#FFD21F'); lv.eyeMat = mat; }
        else if (mat.isMeshStandardMaterial) mat = addRim(mat.clone());
        const im = new THREE.InstancedMesh(o.geometry, mat, cap); im.count = 0; im.frustumCulled = false; root.add(im); out.push({ im, src: o }); }); return out; };
      lv.meshes = mk(LMAX, false); lv.husk = mk(HMAX, true); lv.tmpl = t; lv.nodes = nodes; lv.loaded = true;
      for (const m of lv.placeholder) m.visible = false;
    });
  }
  const rootM = new THREE.Matrix4(), tq = new THREE.Quaternion(), tp = new THREE.Vector3(), ts = new THREE.Vector3(1, 1, 1);
  function poseLeech(L, t, alpha) {   // the slither on the template's nodes, then each mesh's world matrix under the leech's root
    const N = lv.nodes;
    for (let i = 0; i < 6; i++) { const s = N['seg_' + i]; if (s) s.rotation.y = L.state === 'latched' ? 0.15 * Math.sin(9 * t - 0.9 * i) : 0.35 * Math.sin(6 * t - 0.9 * i + L.eye); }
    if (N.head) N.head.rotation.z = L.state === 'latched' ? -0.35 : 0.05 * Math.sin(t * 3);
    const jaw = L.state === 'latched' ? 0.5 * (0.5 + 0.5 * Math.sin(t * 10)) : 0.15;
    if (N.jaw_l) N.jaw_l.rotation.y = jaw; if (N.jaw_r) N.jaw_r.rotation.y = -jaw;
    const x = L.px + (L.x - L.px) * alpha, z = L.pz + (L.z - L.pz) * alpha, y = (L.state === 'latched' ? 0.12 : 0) - (L.alpha || 0) * 0.2;
    tq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, L.yaw);
    lv.tmpl.position.set(x, y, z); lv.tmpl.quaternion.copy(tq); lv.tmpl.updateMatrixWorld(true);   // every mesh's matrixWorld: its pose under this leech's root
  }
  function syncLeeches(surv, t, alpha) {
    const Ls = surv.leeches, H = surv.husks;
    if ((Ls.length || H.length) && !leechWanted) loadLeech();
    if (!lv.loaded) {
      const [pb, pe] = lv.placeholder; pb.count = Math.min(LMAX, Ls.length); pe.count = pb.count; pb.visible = pe.visible = pb.count > 0;
      Ls.slice(0, LMAX).forEach((L, i) => { tp.set(L.px + (L.x - L.px) * alpha, L.state === 'latched' ? 0.12 : 0, L.pz + (L.z - L.pz) * alpha); tq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, L.yaw); rootM.compose(tp, tq, ts); pb.setMatrixAt(i, rootM); pe.setMatrixAt(i, rootM); });
      pb.instanceMatrix.needsUpdate = true; pe.instanceMatrix.needsUpdate = true; bound(pb); bound(pe); return;
    }
    const n = Math.min(LMAX, Ls.length);
    Ls.slice(0, LMAX).forEach((L, i) => { poseLeech(L, t, alpha); for (const { im, src } of lv.meshes) im.setMatrixAt(i, src.matrixWorld); });
    for (const { im } of lv.meshes) { im.count = n; im.visible = n > 0; im.instanceMatrix.needsUpdate = true; bound(im); }
    const m = Math.min(HMAX, H.length);
    H.slice(0, HMAX).forEach((h, i) => { poseLeech({ px: h.x, x: h.x, pz: h.z, z: h.z, yaw: (h.yawDeg || 0) * DEG, state: 'dead', eye: 0, alpha: 0 }, 0, 1); for (const { im, src } of lv.husk) im.setMatrixAt(i, src.matrixWorld); });
    for (const { im } of lv.husk) { im.count = m; im.visible = m > 0; im.instanceMatrix.needsUpdate = true; bound(im); }
    if (lv.eyeMat) lv.eyeMat.emissiveIntensity = 2.5 + 1.5 * Math.sin(t * 6 * Math.PI);
  }

  // ---------------------------------------------------------------------------------------------- the panels on the bin, the arms on a01
  // (instanced on the crate: one InstancedMesh per part of the panel's model, and the cell face one per age tier: about 6 draw calls
  // for 8 panels)
  const tierMats = {}, tl = new THREE.TextureLoader();
  const tierTex = (tier) => { if (!tierMats[tier]) { const tx = tl.load(`assets/survival/tex/solar_cells_${tier}.jpg`); tx.colorSpace = THREE.SRGBColorSpace; tx.flipY = false; tierMats[tier] = tx; } return tierMats[tier]; };
  // slot i on side floor(i / 2): 0 front (+x), 1 right (+z), 2 back, 3 left; the crate's walls are at x +-0.415, z +-0.405, 0.08-0.71 m up
  const SIDE = [[0.43, 0, Math.PI / 2], [0, 0.42, 0], [-0.43, 0, -Math.PI / 2], [0, -0.42, Math.PI]];
  const slotM = [];
  for (let i = 0; i < 8; i++) {
    const o = new THREE.Object3D(), [sx, sz, ry] = SIDE[Math.floor(i / 2)], off = (i % 2 ? 1 : -1) * 0.19;
    o.position.set(sx + (sx ? 0 : off), 0.38, sz + (sz ? 0 : off)); o.rotation.set(-0.32, ry, 0, 'YXZ'); o.updateMatrix(); slotM.push(o.matrix.clone());
  }
  const panelSlots = slotM;
  const pv = { parts: null, faces: null, key: '' };
  let panelWanted = false;
  function syncPanels(surv) {
    const ms = surv.mounted, key = ms.map((p) => (p ? p.tier : '-')).join(',');
    if (!ms.some(Boolean)) { if (pv.parts) for (const m of pv.parts.concat(Object.values(pv.faces))) m.visible = false; pv.key = key; return; }
    if (!panelWanted) { panelWanted = true; assets.model('sv:panel').then((m) => {
      if (!m) return; const o = m.clone(true); o.updateMatrixWorld(true); const parts = [], faces = {};
      o.traverse((x) => { if (!x.isMesh) return; const isFace = x.name === 'solar_face' || (x.parent && x.parent.name === 'solar_face');
        if (isFace) for (const tier of ['new', 'aged', 'ruined']) { const mat = x.material.clone(); mat.map = tierTex(tier); const im = new THREE.InstancedMesh(x.geometry, mat, 8); im.userData.local = x.matrixWorld.clone(); faces[tier] = im; }
        else { const im = new THREE.InstancedMesh(x.geometry, x.material, 8); im.userData.local = x.matrixWorld.clone(); parts.push(im); } });
      for (const im of parts.concat(Object.values(faces))) { im.count = 0; im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; crateGroup.add(im); }
      pv.parts = parts; pv.faces = faces; pv.key = ''; }); }
    if (!pv.parts || pv.key === key) return; pv.key = key;
    const mm = new THREE.Matrix4(), counts = { new: 0, aged: 0, ruined: 0 }; let n = 0;
    ms.forEach((p, i) => { if (!p) return; for (const im of pv.parts) im.setMatrixAt(n, mm.multiplyMatrices(slotM[i], im.userData.local)); const f = pv.faces[p.tier]; if (f) f.setMatrixAt(counts[p.tier]++, mm.multiplyMatrices(slotM[i], f.userData.local)); n++; });
    for (const im of pv.parts) { im.count = n; im.visible = n > 0; im.instanceMatrix.needsUpdate = true; bound(im); }
    for (const [tier, f] of Object.entries(pv.faces)) { f.count = counts[tier]; f.visible = counts[tier] > 0; f.instanceMatrix.needsUpdate = true; bound(f); }
  }
  const fitted = { tetra: null, dioscuri: null };
  function syncFitted(surv) {
    const own = surv.S.owned;
    if (own.R01 && !fitted.tetra) { fitted.tetra = new THREE.Group(); fitted.tetra.name = 'tetrabrachion'; const base = armGroup('arm_base'); if (base) base.add(fitted.tetra);
      model('r01_tetrabrachion').then((m) => { if (!m) return; const o = m.clone(true); o.scale.setScalar(playScale('r01_tetrabrachion')); o.traverse((x) => { if (x.isMesh) { x.castShadow = true; } }); fitted.tetra.add(o); }); }
    if (own.R03 && !fitted.dioscuri) { fitted.dioscuri = new THREE.Group(); fitted.dioscuri.position.set(-0.55, 0.62, 0); fitted.dioscuri.rotation.y = Math.PI; crateGroup.add(fitted.dioscuri);
      model('r03_dioscuri_rig').then((m) => { if (!m) return; const o = m.clone(true); o.scale.setScalar(playScale('r03_dioscuri_rig')); fitted.dioscuri.add(o); }); }
    // the Tetrabrachion's mesh stands in for the arm (display only: the arm's own links still do the work, unseen)
    if (fitted.tetra) for (const n of ['arm_base', 'arm_shoulder', 'arm_elbow', 'arm_wrist_roll', 'arm_wrist_pitch', 'claw_jaw']) { const g = armGroup(n); if (!g) continue; for (const c of g.children) if (c !== fitted.tetra) c.visible = !own.R01; }
    if (!own.R01 && fitted.tetra) { fitted.tetra.removeFromParent(); fitted.tetra = null; }
    if (!own.R03 && fitted.dioscuri) { fitted.dioscuri.removeFromParent(); fitted.dioscuri = null; }
  }

  // ---------------------------------------------------------------------------------------------- vigils (UV)
  const vigils = [];
  const uvDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), M.uv); uvDisc.visible = false; root.add(uvDisc);
  function syncVigils(surv) {
    while (vigils.length < surv.vigils.length) { const g = new THREE.Group(); root.add(g); vigils.push(g); model('r24_small_vigil').then((m) => { if (m) g.add(m.clone(true)); }); }
    vigils.forEach((g, i) => { const v = surv.vigils[i]; g.visible = !!v; if (v) g.position.set(v.x, 0, v.z); });
  }

  // ---------------------------------------------------------------------------------------------- the day and the night
  const hemi = scene.children.find((o) => o.isHemisphereLight), key0 = { hemi: hemi ? hemi.intensity : 0.55, key: view.key.intensity, env: scene.environmentIntensity };
  // the hall's tired fluorescent strips (view.js) run on the town's failing power: they sag to a third at night
  const coves = scene.children.filter((o) => o.isPointLight && o.color.getHexString() === 'dbe9e0'), cove0 = coves.map((l) => l.intensity);
  const BG = { day: new THREE.Color('#0d0b0a'), night: new THREE.Color('#040509') }, FOGC = { day: new THREE.Color('#241a14'), night: new THREE.Color('#06070c') };
  const KEYC = { day: new THREE.Color('#ffe0bd'), night: new THREE.Color('#7f95c8') }, HEMIC = { day: new THREE.Color('#c3cfdf'), night: new THREE.Color('#33405e') };
  const sky = world && world.root.getObjectByName('sky'), skyline = world && world.root.getObjectByName('skyline');
  let lastK = -1;
  function setLight(k) {   // k: 1 day .. 0 night
    if (Math.abs(k - lastK) < 0.004) return; lastK = k;
    if (hemi) { hemi.intensity = lerp(0.1, key0.hemi, k); hemi.color.copy(HEMIC.night).lerp(HEMIC.day, k); }
    view.key.intensity = lerp(0.18, key0.key, k); view.key.color.copy(KEYC.night).lerp(KEYC.day, k);
    scene.environmentIntensity = lerp(0.07, key0.env, k);
    if (scene.background && scene.background.isColor) scene.background.copy(BG.night).lerp(BG.day, k);
    if (scene.fog) scene.fog.color.copy(FOGC.night).lerp(FOGC.day, k);
    if (sky) sky.material.color.setScalar(lerp(0.14, 1, k));
    if (skyline) skyline.material.color.setScalar(lerp(0.25, 1, k));
    coves.forEach((l, i) => { l.intensity = cove0[i] * lerp(0.32, 1, k); });
    renderer.toneMappingExposure = lerp(1.25, 1.1, k);
  }

  // ---------------------------------------------------------------------------------------------- per frame
  const tmpV = new THREE.Vector3();
  function update(surv, t, dt, camera, alpha = 1) {
    syncShutters();
    if (!surv || !surv.active) { setLight(1); head.intensity = 0; for (const l of pool) l.intensity = 0; rings.count = 0; root.visible = false; return; }
    root.visible = true;
    const c = clockAt(surv.S.time), k = daylight(c.phase); setLight(k);
    if (!sitesBuilt) buildSiteSets(surv.sites);
    // sites: the ones still there, models loaded when a01 is near; rings round the salvage in reach
    const a = surv.a01(), tgt = surv.salvageTarget(); let rn = 0;
    // (drawn only within 11 m of the camera, and not from the top view: the frame's budget)
    const cp = camera.position, high = cp.y > 12;
    for (const st of siteSets.values()) {
      const vis = st.sites.filter((s) => s.fixed), near = vis.some((s) => Math.hypot(s.x - a.x, s.z - a.z) < 18);
      if (near && !st.loaded) st.load();
      st.set(high ? [] : vis.filter((s) => Math.hypot(s.x - cp.x, s.z - cp.z) < 11).map((s) => ({ x: s.x, z: s.z, yaw: s.yawDeg * DEG })));
    }
    // the loose supplies: one InstancedMesh per material for each kind, posed from their groups (main.js moves those with the bodies,
    // between steps); small, so no shadows, and drawn within 12 m
    if (itemGroup) {
      const byKind = new Map();
      for (const it of sim.v2.items) { if (!it.spec.supply) continue; const g = itemGroup(it); if (high || Math.hypot(g.position.x - cp.x, g.position.z - cp.z) > 12) continue; if (!byKind.has(it.kind)) byKind.set(it.kind, []); byKind.get(it.kind).push(g); }
      for (const [kind, st] of supplySets) if (!byKind.has(kind)) st.set([]);
      for (const [kind, gs] of byKind) { let st = supplySets.get(kind); if (!st) { st = supplySet(kind); supplySets.set(kind, st); } st.set(gs); }
    }
    for (const s of surv.sites.concat(surv.husks)) {
      if (rn >= 64 || s.stripped != null || (s.kind === 'spot' && !s.fixed)) continue;
      const d = Math.hypot(s.x - a.x, s.z - a.z); if (d > 14) continue;
      const b = surv.siteBox(s), r = Math.max(0.5, Math.hypot(b.hx, b.hz) + 0.25), on = s === tgt;
      tmpV.set(b.x, 0.015 + rn * 0.0003, b.z); ringMat.makeScale(r * (on ? 1 + 0.05 * Math.sin(t * 6) : 1), 1, r * (on ? 1 + 0.05 * Math.sin(t * 6) : 1)).setPosition(tmpV); rings.setMatrixAt(rn++, ringMat);
    }
    rings.count = high ? 0 : rn; rings.instanceMatrix.needsUpdate = true; bound(rings); M.ring.opacity = 0.35 + (tgt ? 0.25 : 0) + 0.1 * Math.sin(t * 3);
    syncShelter(surv, t); syncStations(surv); syncLeeches(surv, t, alpha); syncPanels(surv); syncFitted(surv); syncVigils(surv);
    // the top view is a map: the shelter shows, the small things do not (the frame's budget)
    for (const g of stations.values()) g.visible = !high;
    for (const { im } of lv.meshes.concat(lv.husk)) if (high) im.visible = false;
    for (const m of lv.placeholder) if (high) m.visible = false;
    // lights (two from the pool, the nearest first): the vigils' UV, the shelter's work light, the Lumen Vigil, the inspection lamp on the bin
    const night = 1 - k; head.intensity = night > 0.3 ? 10 * night : 0;
    rimU.k.value = LEECH.rim.day + (LEECH.rim.night - LEECH.rim.day) * night;
    let li = 0; const use = (x, y, z, col, I, dist) => { if (li >= pool.length) return; const l = pool[li++]; l.position.set(x, y, z); l.color.set(col); l.intensity = I; l.distance = dist; };
    for (const v of surv.vigils) use(v.x, 0.5, v.z, '#00E5FF', 3.2, 4.5);
    const S = surv.shelter;
    if (S && surv.sealed()) { const g = surv.shelters.geometry(S.concept, S.site); use(g.interior.x, 1.5, g.interior.z, '#FFE6B0', night > 0.3 ? 4.5 * night : 0.6, 6.5);
      if (surv.S.owned.R04 && surv.S.charges.lumen > 0 && night > 0.3) use(g.interior.x, 1.0, g.interior.z, '#00E5FF', 2.5, 9); }
    if (night > 0.3 && surv.inv.count('inspection_lamp') > 0) use(a.x, 1.05, a.z, '#FFE6B0', 2.2 * night, 3.2);
    for (let i = li; i < pool.length; i++) pool[i].intensity = 0;
    const v0 = surv.vigils[0]; uvDisc.visible = !!v0; if (v0) { uvDisc.position.set(v0.x, 0.03, v0.z); uvDisc.scale.setScalar(LEECH.uvSmall); }
  }

  // ---------------------------------------------------------------------------------------------- the collect bubble's turntable
  const tt = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, 1, 0.01, 200), obj: null, spec: null, t: 0, url: null, loading: null };
  tt.scene.background = new THREE.Color('#0b0809');
  tt.scene.add(new THREE.HemisphereLight('#ffffff', '#3a2a22', 1.1));
  { const k = new THREE.DirectionalLight('#ffe8d0', 2.2); k.position.set(3, 5, 4); tt.scene.add(k); const r = new THREE.DirectionalLight('#38f3ff', 1.1); r.position.set(-4, 2, -3); tt.scene.add(r); }
  tt.scene.environment = scene.environment;
  const disposeObj = (o) => { o.traverse((x) => { if (!x.isMesh) return; x.geometry.dispose(); for (const m of Array.isArray(x.material) ? x.material : [x.material]) { for (const kk of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[kk]) { dropImage(m[kk].image); m[kk].dispose(); } m.dispose(); } }); };   // (v4: its pictures freed at once)
  /** the scale an item is drawn at in play (catalog game.scale: a model shown smaller than its source asset; the size the bubble gives) */
  const playScale = (id) => (cat[id] && cat[id].game && cat[id].game.scale) || 1;
  /** show an item on the turntable (its own model, at full detail and at its size in play; disposed when closed) */
  function bubbleOpen(id) {
    bubbleClose();
    const e = cat[id]; tt.spec = (e && e.turntable) || { center: [0, 0.2, 0], radius_m: 0.4, camera_fov_deg: 30, camera_distance_m: 1.8, start_yaw_deg: 35, spin_deg_per_s: 40, tilt_deg: 18 }; tt.t = 0;
    if (!e || !e.glb) return Promise.resolve(false);
    const url = e.glb; tt.url = url;
    const p = new GLTFLoader().loadAsync(url).then((g) => { if (tt.url !== url) { disposeObj(g.scene); return false; } if (assets && assets.shrink) assets.shrink(g.scene); const node = (e.node && g.scene.getObjectByName(e.node)) || g.scene; tt.obj = new THREE.Group(); tt.obj.add(node === g.scene ? g.scene : node); tt.obj.scale.setScalar(playScale(id)); tt.scene.add(tt.obj); tt.root = g.scene; return true; }).catch(() => false);
    tt.loading = p; return p;
  }
  function bubbleClose() { if (tt.obj) { tt.scene.remove(tt.obj); disposeObj(tt.root || tt.obj); } tt.obj = null; tt.root = null; tt.url = null; }
  function bubbleRender(dt, w, h) {
    const s = tt.spec || { center: [0, 0, 0], camera_fov_deg: 30, camera_distance_m: 2, start_yaw_deg: 35, spin_deg_per_s: 40, tilt_deg: 18 }; tt.t += dt;
    // the item fills the window between the bubble's title and its card: its bounding sphere framed by the narrower of the two fields
    // of view, the picture shifted up a little (the card covers the lower part)
    tt.cam.fov = s.camera_fov_deg * (w < h ? 1.25 : 1); tt.cam.aspect = w / h; tt.cam.setViewOffset(w, h, 0, h * (w < h ? 0.1 : 0.04), w, h); tt.cam.updateProjectionMatrix();
    const vf = tt.cam.fov * DEG / 2, hf = Math.atan(Math.tan(vf) * tt.cam.aspect), r = s.radius_m || 0.3;
    const yaw = (s.start_yaw_deg + s.spin_deg_per_s * tt.t) * DEG, tilt = s.tilt_deg * DEG, d = Math.max(s.camera_distance_m || 0, r / Math.sin(Math.min(vf, hf) * 0.82)), c = s.center;
    tt.cam.position.set(c[0] + Math.cos(yaw) * Math.cos(tilt) * d, c[1] + Math.sin(tilt) * d, c[2] + Math.sin(yaw) * Math.cos(tilt) * d); tt.cam.lookAt(c[0], c[1], c[2]);
    renderer.render(tt.scene, tt.cam);
  }
  function stats() { let tris = 0; root.traverse((o) => { if (o.isMesh && o.visible && o.geometry && o.geometry.index) tris += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1); }); return { siteSets: siteSets.size, sitesLoaded: [...siteSets.values()].filter((s) => s.loaded).length, shelterSets: sh.sets.size, shelterLoaded: sh.sets.size > 0 && [...sh.sets.values()].every((x) => x.loaded) && [...sh.doors.values()].every((d) => d.g.children.length > 0), stations: stations.size, leechModel: lv.loaded, tris: Math.round(tris) }; }
  function reset() { for (const st of supplySets.values()) st.set([]); clearShelter(); for (const g of stations.values()) dropStation(g); stations.clear(); for (const g of vigils) root.remove(g); vigils.length = 0; for (const st of siteSets.values()) for (const m of st.meshes) root.remove(m); siteSets.clear(); sitesBuilt = false; }
  return { root, update, bubbleOpen, bubbleClose, bubbleRender, get bubbleLoading() { return tt.loading; }, get bubbleReady() { return !!tt.obj; }, stats, reset, setLight, pool, head, panelSlots, fitted, rimK: () => rimU.k.value };
}
