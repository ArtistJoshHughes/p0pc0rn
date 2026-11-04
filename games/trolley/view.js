// view.js - Level 1 drawn with three.js: a run-down reclaim hall (stained concrete, rusted corrugated walls, a flaking steel staircase
// with diamond-plate treads, rusty pipes high on the walls, neon signs that buzz and flicker), the wheeled ramp, the posts, bay, cable
// cover and floor markings, the waypoint ring. Everything is built here in code from level_spec.js (no image files: the textures are
// drawn on canvases, decor.js). The trolley itself is trolley_mesh.js.
import * as THREE from './vendor/three.module.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { ROOM, STAIRS, LANDING, RAIL, POSTS, CABLE, RAMP, ZONES, START, DOORS, staticBoxes } from './level_spec.js';
import { wallMaterial, floorMaterial, treadMaterial, paintMaterial, rustMaterial, barrierMaterial, postMaterial, wearCanvas, roomGrime, boxUV, buildNeon, buildPipes } from './decor.js';

// ------------------------------------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, { repeat = null, srgb = true, aniso = 4 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const rnd = (() => { let s = 1234567; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();   // seeded: the same room every time

function hazardTex(rep = 4) {   // worn safety stripes: chipped and sooty, worn through to grey primer in places
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#d9ab2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1d22';
    for (let x = -h; x < w + h; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill(); }
    wearCanvas(g, w, h, { seed: 83 + rep, chips: 160, soot: 0.5, scale: 0.6 });
    g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#5a4f45'; g.fillRect(0, 0, w, h); g.restore();
  }, { repeat: [rep, 1] });
}
function glowTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

/** the floor's painted markings: one transparent overlay for the whole room (start box, the drive line, the gates, the dead end,
 *  the bay, the stop zone, where the ramp docks), 48 px a metre */
function markingsTex() {
  const PX = 48, W = ROOM.hx * 2 * PX, H = ROOM.hz * 2 * PX;
  const X = (x) => (x + ROOM.hx) * PX, Z = (z) => (z + ROOM.hz) * PX;
  return canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H); g.lineCap = 'butt';
    const rect = (x0, z0, x1, z1, col, lw = 0.06, dash = null) => { g.save(); g.strokeStyle = col; g.lineWidth = lw * PX; if (dash) g.setLineDash(dash.map((d) => d * PX)); g.strokeRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX); g.restore(); };
    const text = (s, x, z, size, col, rot = 0) => { g.save(); g.translate(X(x), Z(z)); g.rotate(rot); g.fillStyle = col; g.font = `800 ${size * PX}px -apple-system, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, 0, 0); g.restore(); };
    // the start box
    rect(START.x - 0.75, START.z - 0.7, START.x + 0.75, START.z + 0.7, 'rgba(235,240,245,0.85)', 0.05);
    text('a01', START.x - 0.95, START.z, 0.32, 'rgba(235,240,245,0.75)', Math.PI / 2);
    // the drive line
    g.fillStyle = 'rgba(255,205,40,0.95)'; g.fillRect(X(ZONES.line.x) - 0.06 * PX, Z(ZONES.line.z0), 0.12 * PX, (ZONES.line.z1 - ZONES.line.z0) * PX);
    // slalom chevrons at each gate
    for (const gt of ZONES.gates) { const cx = (gt.x0 + gt.x1) / 2, cz = (gt.z0 + gt.z1) / 2; g.save(); g.translate(X(cx), Z(cz)); g.strokeStyle = 'rgba(120,230,255,0.75)'; g.lineWidth = 0.07 * PX;
      for (const o of [-0.25, 0.05]) { g.beginPath(); g.moveTo((o - 0.12) * PX, -0.22 * PX); g.lineTo((o + 0.08) * PX, 0); g.lineTo((o - 0.12) * PX, 0.22 * PX); g.stroke(); } g.restore(); }
    // the dead end: hatched
    g.save(); g.beginPath(); g.rect(X(ZONES.deadEnd.x0), Z(ZONES.deadEnd.z0), (ZONES.deadEnd.x1 - ZONES.deadEnd.x0) * PX, (ZONES.deadEnd.z1 - ZONES.deadEnd.z0) * PX); g.clip();
    g.strokeStyle = 'rgba(255,205,40,0.35)'; g.lineWidth = 0.08 * PX; for (let x = ZONES.deadEnd.x0 - 2; x < ZONES.deadEnd.x1 + 2; x += 0.5) { g.beginPath(); g.moveTo(X(x), Z(ZONES.deadEnd.z1)); g.lineTo(X(x + 1.5), Z(ZONES.deadEnd.z0)); g.stroke(); } g.restore();
    text('SPIN', 6.9, 5.2, 0.42, 'rgba(255,215,80,0.85)', Math.PI / 2);
    // the crab bay
    rect(5.32, 3.12, 6.88, 4.16, 'rgba(240,245,250,0.9)', 0.07);
    text('BAY', 6.1, 3.65, 0.36, 'rgba(240,245,250,0.7)', Math.PI / 2);
    // the emergency stop zone: red and white
    const S = ZONES.stop; g.save(); g.beginPath(); g.rect(X(S.x0), Z(S.z0), (S.x1 - S.x0) * PX, (S.z1 - S.z0) * PX); g.clip();
    for (let x = S.x0 - 4; x < S.x1 + 4; x += 0.6) { g.fillStyle = 'rgba(214,48,48,0.55)'; g.beginPath(); g.moveTo(X(x), Z(S.z1)); g.lineTo(X(x + 0.3), Z(S.z1)); g.lineTo(X(x + 0.3 + 3), Z(S.z0)); g.lineTo(X(x + 3), Z(S.z0)); g.fill(); }
    g.restore(); rect(S.x0, S.z0, S.x1, S.z1, 'rgba(235,60,60,0.9)', 0.06);
    g.save(); g.fillStyle = 'rgba(20,22,28,0.8)'; g.fillRect(X(-0.45), Z(1.3), 0.7 * PX, 1.6 * PX); g.restore();
    text('STOP', -0.1, 2.1, 0.5, 'rgba(255,255,255,0.95)', -Math.PI / 2);
    // where the ramp docks: a dashed outline against the landing
    rect(LANDING.x1, -5.6, LANDING.x1 + RAMP.len, -4.4, 'rgba(120,230,255,0.55)', 0.05, [0.25, 0.18]);
    // the landing's caution edge at the top of the stairs is on the steps themselves (drawn as nosing strips)
    roomGrime(g, W, H, PX, X, Z, ROOM);   // worn paint, soot along the walls, oil, old skid marks: the room's own, so it never repeats
  }, { aniso: 8 });
}

// ------------------------------------------------------------------------------------------------ the scene
export function createView(canvas, { quality = 'high', shadowSize = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d0b0a');
  scene.fog = new THREE.Fog('#241a14', 14, 38);   // smog the colour of the sky's horizon (world_view.js); main.js pushes it out in the top view
  const FOG = { near: 14, far: 38 };
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 140);   // the top view frames the whole world from about 45 m up

  // lights: a dim sky / rust-brown ground fill, one warm key that casts the shadows, tired fluorescent cove strips, and the neon
  // signs' own four lights (decor.js)
  scene.add(new THREE.HemisphereLight('#c3cfdf', '#3d2a1f', 0.55));
  const key = new THREE.DirectionalLight('#ffe0bd', 1.8);
  key.position.set(-3, 9, 4); key.target.position.set(0, 0, 0);
  key.castShadow = true;
  const sm = shadowSize || (quality === 'low' ? 1024 : 2048);   // (v4: main.js gives a phone 1024)
  key.shadow.mapSize.set(sm, sm);
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 70 });   // follows the action (shadowFocus)
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02; key.shadow.radius = 2;
  scene.add(key, key.target);

  // materials: the gritty ones (decor.js) carry their textures in metres (worldUV: box faces get UVs in metres, see boxUV)
  const W_ = (m) => { m.userData.worldUV = true; return m; };
  const tread = W_(treadMaterial()), rust = W_(rustMaterial()), paint = W_(paintMaterial());
  const M = {
    floor: floorMaterial(),
    wall: W_(wallMaterial()),
    base: W_(rustMaterial({ tint: '#7a6a62' })),
    cove: new THREE.MeshStandardMaterial({ color: '#0b0d10', emissive: '#cfeadb', emissiveIntensity: 1.15 }),
    white: paint, wood: tread, plate: tread, rail: rust, steel: rust, rust,
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex(4), roughness: 0.75 }),
    hazardS: new THREE.MeshStandardMaterial({ map: hazardTex(1), roughness: 0.75 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#c99a22', roughness: 0.65 }),
    post: postMaterial(), postCap: new THREE.MeshStandardMaterial({ color: '#3a2a12', emissive: '#ffb02e', emissiveIntensity: 1.4 }),
    black: new THREE.MeshStandardMaterial({ color: '#17140f', roughness: 0.85 }),
    partition: W_(barrierMaterial()),
  };
  const box = (w, h, d, mat, x, y, z, { cast = true, receive = true, round = 0 } = {}) => {
    const geo = round ? new RoundedBoxGeometry(w, h, d, 2, round) : new THREE.BoxGeometry(w, h, d);
    if (mat.userData.worldUV) boxUV(geo, [x, y, z]);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive; m.userData.mergeable = true; scene.add(m); return m;
  };

  // ---- floor, walls, cove strips
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.hx * 2, ROOM.hz * 2), M.floor);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const marks = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.hx * 2, ROOM.hz * 2), new THREE.MeshStandardMaterial({ map: markingsTex(), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
  marks.rotation.x = -Math.PI / 2; marks.position.y = 0.001; marks.receiveShadow = true; marks.userData.floorMarks = true; scene.add(marks);
  for (const [x, y, z, hx, hy, hz, kind] of staticBoxes()) {
    if (kind !== 'wall' && kind !== 'lintel') continue;
    const w = box(hx * 2, hy * 2, hz * 2, M.wall, x, y, z, { cast: kind === 'lintel' });
    w.material = M.wall;
  }
  // skirting (split at the doors) and cove light strips along the four inner faces
  const { hx, hz, height } = ROOM;
  for (const [x, z, len, rot, side] of [[0, -hz + 0.02, hx * 2, 0, 'N'], [0, hz - 0.02, hx * 2, 0, 'S'], [-hx + 0.02, 0, hz * 2, Math.PI / 2, 'W'], [hx - 0.02, 0, hz * 2, Math.PI / 2, 'E']]) {
    const along = rot ? 'z' : 'x', c0 = along === 'x' ? x : z, cuts = DOORS.filter((d) => d.wall === side).sort((a, b) => a.a0 - b.a0);
    let a = c0 - len / 2;
    for (const [u0, u1] of cuts.map((d) => [d.a0, d.a1]).concat([[c0 + len / 2, c0 + len / 2]])) {
      if (u0 - a > 0.02) { const m = (a + u0) / 2, sk = box(u0 - a, 0.12, 0.04, M.base, along === 'x' ? m : x, 0.06, along === 'x' ? z : m, { cast: false }); sk.rotation.y = rot; }
      a = u1;
    }
    const cv = box(len, 0.05, 0.03, M.cove, x, height - 0.25, z, { cast: false, receive: false }); cv.rotation.y = rot;
  }
  // the doors out to the yard: a steel frame on each jamb, a hazard-striped header, a striped threshold plate over the wall's footprint
  for (const d of DOORS) {
    const isS = d.wall === 'S', wc = isS ? hz + ROOM.wall / 2 : hx + ROOM.wall / 2, w = d.a1 - d.a0, mid = (d.a0 + d.a1) / 2;
    const at = (u, sx, sy, sz, y, mat) => box(isS ? sx : sz, sy, isS ? sz : sx, mat, isS ? u : wc, y, isS ? wc : u, { cast: false });
    for (const u of [d.a0 - 0.05, d.a1 + 0.05]) at(u, 0.1, d.h, ROOM.wall + 0.06, d.h / 2, M.rust);
    at(mid, w + 0.2, 0.1, ROOM.wall + 0.06, d.h + 0.05, M.hazard);
    at(mid, w, 0.006, ROOM.wall, 0.003, M.hazardS);
  }
  // soft fill from the cove strips (no shadows: cheap)
  for (const [x, z] of [[-4, 0], [4, 0]]) { const p = new THREE.PointLight('#dbe9e0', 5.2, 12, 1.6); p.position.set(x, height - 0.4, z); scene.add(p); }
  // rusty pipes high on the walls (one mesh) and the neon signs with their four lights
  buildPipes(scene, rust);
  const backing = rust.clone(); backing.color.set('#6b5a52');   // the signs' trays: the same rust, darker, so the tubes stand out
  const neon = buildNeon(scene, backing);

  // ---- the staircase and landing (white risers and fascias, light-wood treads with nosings, a white stringer, a wooden handrail)
  const L = LANDING, S = STAIRS;
  box(L.x1 - L.x0, L.top - 0.03, L.z1 - L.z0, M.white, (L.x0 + L.x1) / 2, (L.top - 0.03) / 2, (L.z0 + L.z1) / 2);
  box(L.x1 - L.x0 + 0.02, 0.03, L.z1 - L.z0 + 0.02, M.wood, (L.x0 + L.x1) / 2, L.top - 0.015, (L.z0 + L.z1) / 2 + 0.01);
  const sw = S.x1 - S.x0, sx = (S.x0 + S.x1) / 2;
  for (let k = 1; k < S.steps; k++) {
    const zFront = L.z1 + (S.steps - k) * S.tread, top = k * S.rise;
    box(sw - 0.02, S.rise - 0.03, 0.02, M.white, sx - 0.01, top - S.rise / 2 - 0.015, zFront - 0.01);                 // riser
    box(sw - 0.04, top - 0.03, S.tread, M.white, sx - 0.02, (top - 0.03) / 2, zFront - S.tread / 2, { cast: false });  // the block under it
    box(sw, 0.03, S.tread + 0.025, M.wood, sx, top - 0.015, zFront - S.tread / 2 + 0.0125);                            // tread with a 2.5 cm nosing
    box(sw - 0.06, 0.002, 0.05, M.hazardS, sx, top + 0.001, zFront, { cast: false });                                   // its worn caution edge
  }
  box(sw - 0.02, S.rise - 0.03, 0.02, M.white, sx - 0.01, L.top - S.rise / 2 - 0.015, L.z1 - 0.01);   // the top riser, under the landing's edge
  // the open (east) side: a white stringer following the pitch, balusters and a handrail
  const run = (S.steps - 1) * S.tread, pitch = Math.atan2(S.rise * (S.steps - 1), run);
  const str = box(Math.hypot(run, S.rise * (S.steps - 1)) + 0.25, 0.22, 0.04, M.white, S.x1 - 0.02, (S.rise * (S.steps - 1)) / 2 + 0.06, L.z1 + run / 2);
  str.rotation.y = Math.PI / 2; str.rotation.z = 0; str.rotation.x = 0; str.rotateZ(pitch);
  const hrLen = Math.hypot(run + 0.3, (S.rise * S.steps)), hr = box(hrLen, 0.05, 0.06, M.rail, S.x1 - 0.03, 0.9 + (S.rise * S.steps) / 2, L.z1 + run / 2 + 0.1);
  hr.rotation.y = Math.PI / 2; hr.rotateZ(Math.atan2(S.rise * S.steps, run + 0.3));
  for (let k = 0; k < S.steps - 1; k++) for (const f of [0.25, 0.75]) {
    const z = L.z1 + run - (k + f) * S.tread, top = (k + 1) * S.rise;
    const yTop = 0.9 + (S.rise * S.steps) * ((L.z1 + run + 0.25 - z) / (run + 0.3));
    box(0.025, yTop - top, 0.025, M.white, S.x1 - 0.03, top + (yTop - top) / 2, z, { cast: false });
  }
  box(0.07, 1.25, 0.07, M.white, S.x1 - 0.03, 0.625, L.z1 + run + 0.14);   // newel post
  // the landing's guard rail (east of the stairs): top rail, bottom rail, balusters
  const ry = L.top, rcx = (RAIL.x0 + RAIL.x1) / 2, rlen = RAIL.x1 - RAIL.x0;
  box(rlen + 0.06, 0.05, 0.07, M.rail, rcx, ry + RAIL.height, RAIL.z + 0.02);
  box(rlen, 0.04, 0.04, M.white, rcx, ry + 0.06, RAIL.z + 0.02, { cast: false });
  for (let x = RAIL.x0 + 0.06; x < RAIL.x1 - 0.02; x += 0.11) box(0.025, RAIL.height - 0.06, 0.025, M.white, x, ry + 0.06 + (RAIL.height - 0.06) / 2, RAIL.z + 0.02, { cast: false });
  box(0.07, RAIL.height + 0.08, 0.07, M.white, RAIL.x1 - 0.035, ry + (RAIL.height + 0.08) / 2, RAIL.z + 0.02);
  // a caution strip along the landing's open east edge (where the ramp docks)
  box(0.05, 0.004, L.z1 - L.z0, M.hazardS, L.x1 - 0.03, L.top + 0.002, (L.z0 + L.z1) / 2, { cast: false });

  // ---- props: posts, the partition, the bay's curbs, the cable cover
  for (const [x, z, r, h] of POSTS) {
    const g = new THREE.CylinderGeometry(r, r, h, 24);
    const m = new THREE.Mesh(g, M.post); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; m.userData.mergeable = true; scene.add(m);
    for (const y of [0.25, 0.55]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.1, 24), M.black); b.position.set(x, y, z); b.userData.mergeable = true; scene.add(b); }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, 0.04, 24), M.postCap); cap.position.set(x, h + 0.02, z); cap.userData.mergeable = true; scene.add(cap);
  }
  for (const [x, y, z, bx, by, bz, kind] of staticBoxes()) {
    if (kind === 'partition') { box(bx * 2, by * 2, bz * 2, M.partition, x, y, z, { round: 0.02 }); box(bx * 2, 0.03, 0.02, M.cove, x, by * 2 - 0.08, z - bz - 0.005, { cast: false }); }
    if (kind === 'curb') box(bx * 2, by * 2, bz * 2, M.hazardS, x, y, z, { round: 0.015 });
  }
  {
    const { x, z0, z1, h, bottom, top } = CABLE, sh = new THREE.Shape();
    sh.moveTo(-bottom / 2, 0); sh.lineTo(bottom / 2, 0); sh.lineTo(top / 2, h); sh.lineTo(-top / 2, h); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false });
    const m = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: 0.8 }), M.yellow]);
    m.position.set(x, 0.0005, z0); m.castShadow = m.receiveShadow = true; scene.add(m);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(top * 0.6, 0.002, z1 - z0 - 0.02), M.yellow); stripe.position.set(x, h + 0.001, (z0 + z1) / 2); scene.add(stripe);
  }

  // ---- the ramp (follows its rigid body)
  const ramp = new THREE.Group(); scene.add(ramp);
  {
    const { len, rise, width, gap, lip } = RAMP, hw = width / 2, a = Math.atan2(rise - gap, len), sl = Math.hypot(len, rise - gap);
    const deck = new THREE.Mesh(boxUV(new THREE.BoxGeometry(sl, 0.012, width - 0.04)), M.plate); deck.castShadow = deck.receiveShadow = true;
    deck.position.set(len / 2, gap + (rise - gap) / 2 - 0.006, 0); deck.rotation.z = a; ramp.add(deck);
    const side = new THREE.Shape(); side.moveTo(0, gap); side.lineTo(len, gap); side.lineTo(len, rise - 0.012); side.closePath();
    for (const s of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(side, { depth: 0.02, bevelEnabled: false }); const m = new THREE.Mesh(g, M.steel); m.position.z = s > 0 ? hw - 0.02 : -hw; m.castShadow = m.receiveShadow = true; ramp.add(m);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(sl - 0.12, 0.04, 0.03), M.hazard); curb.position.set(len / 2 + 0.06, gap + (rise - gap) / 2 + 0.02, s * (hw - 0.015)); curb.rotation.z = a; curb.castShadow = true; ramp.add(curb);
    }
    const back = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.02, rise - gap, width)), M.steel); back.position.set(len - 0.01, gap + (rise - gap) / 2, 0); back.castShadow = true; ramp.add(back);
    for (let k = 1; k <= 3; k++) { const x = (len * k) / 4, h = gap + ((rise - gap) * x) / len - 0.02; const rib = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.03, h - gap, width - 0.06)), M.steel); rib.position.set(x, gap + (h - gap) / 2, 0); ramp.add(rib); }
    const lipM = new THREE.Mesh(new THREE.BoxGeometry(lip, 0.01, width - 0.08), M.hazard); lipM.position.set(len + lip / 2, rise - 0.005, 0); lipM.castShadow = true; ramp.add(lipM);
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, width - 0.04), M.hazard); toe.position.set(0.1, gap + 0.2 * Math.tan(a) / 2 + 0.002, 0); toe.rotation.z = a; ramp.add(toe);
    for (const [cx, cz] of [[0.22, hw - 0.1], [0.22, -hw + 0.1], [len - 0.12, hw - 0.1], [len - 0.12, -hw + 0.1]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(gap, 12, 8), M.black); b.position.set(cx, gap, cz); ramp.add(b); }
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ffb020', emissiveIntensity: 2.2 }));
    led.position.set(len + 0.005, rise - 0.08, 0); ramp.add(led); ramp.userData.led = led;
  }

  // ---- the waypoint: a ring on the floor and a faint beam
  const way = new THREE.Group(); scene.add(way);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#7fe6ff', transparent: true, opacity: 0.85, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 48), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; way.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#7fe6ff', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 0.8; way.add(beam);
  way.visible = false;

  // ------------------------------------------------------------------------------------------------ per frame
  const glow = glowTex();
  function setRamp(pos, q, locked) {
    ramp.position.set(pos.x, pos.y, pos.z); ramp.quaternion.set(q.x, q.y, q.z, q.w);
    const led = ramp.userData.led; led.material.emissive.set(locked ? '#38ff7a' : '#ffb020');
  }
  function setWaypoint(p, t) {
    if (!p) { way.visible = false; return; }
    way.visible = true; way.position.set(p.x, p.y || 0, p.z);
    const s = 1 + 0.08 * Math.sin(t * 4); ring.scale.set(s, s, 1); ringMat.opacity = 0.6 + 0.3 * Math.sin(t * 4);
  }
  /** once a frame: the neon's flicker and its lights (t in seconds, any clock) */
  function tick(t, dt) { neon.tick(t); void dt; }
  // the key light's shadow box follows the action: centred on (x, z), `half` metres each way, snapped to its own texel grid (in the
  // light's axes) so the shadows do not crawl as it moves
  const KEYDIR = new THREE.Vector3(-3, 9, 4).normalize(), RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), KEYDIR).normalize(), UPL = new THREE.Vector3().crossVectors(KEYDIR, RIGHT), fp = new THREE.Vector3();
  function shadowFocus(x, z, half) {
    const sc = key.shadow.camera;
    if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }
    const texel = (2 * half) / key.shadow.mapSize.x; fp.set(x, 0, z);
    const a = Math.round(fp.dot(RIGHT) / texel) * texel, b = Math.round(fp.dot(UPL) / texel) * texel, c = fp.dot(KEYDIR);
    fp.copy(RIGHT).multiplyScalar(a).addScaledVector(UPL, b).addScaledVector(KEYDIR, c);
    key.target.position.copy(fp); key.position.copy(fp).addScaledVector(KEYDIR, 30); key.target.updateMatrixWorld();
  }
  shadowFocus(0, 0, 11);

  // the hall's static boxes and posts (the staircase alone is some 60 of them): merged into one mesh per material and shadow setting,
  // so a frame draws each material once (the same geometry, in place; nothing here moves)
  {
    const sets = new Map();
    for (const o of [...scene.children]) {
      if (!o.isMesh || !o.userData.mergeable || Array.isArray(o.material)) continue;
      const k = o.material.uuid + (o.castShadow ? 'C' : 'c') + (o.receiveShadow ? 'R' : 'r') + (o.geometry.index ? 'I' : 'n') + Object.keys(o.geometry.attributes).sort().join();
      if (!sets.has(k)) sets.set(k, []); sets.get(k).push(o);
    }
    for (const list of sets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((o) => { o.updateMatrix(); const g = o.geometry.clone(); g.clearGroups(); g.applyMatrix4(o.matrix); return g; });
      const geo = mergeGeometries(geos); for (const g of geos) g.dispose(); if (!geo) continue;
      const m = new THREE.Mesh(geo, list[0].material); m.name = 'hall_static'; m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow; scene.add(m);
      for (const o of list) { scene.remove(o); o.geometry.dispose(); }
    }
  }
  function resize(w, h, pr) {
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = w < h ? 62 : 50; camera.updateProjectionMatrix();
  }
  return { renderer, scene, camera, key, M, glow, ramp, setRamp, setWaypoint, resize, render: () => renderer.render(scene, camera),
    tick, neon: neon.signs, setNeonQuality: neon.setQuality, shadowFocus, FOG };
}
