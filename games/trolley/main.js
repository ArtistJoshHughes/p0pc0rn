// main.js - Troll-E, Level 1: boots Rapier and three.js, builds the room and the trolley, runs the fixed-step physics (1/60 s,
// an accumulator, at most 3 steps a frame) and draws between steps, follows the trolley with a camera that blends between the chase
// view and a top view (pinch), and runs the tutorial. v2: the dock and its slot menu, the grab arm, the trash and ROMs, the battery,
// the diesel spills; every world change (doors, obstacles, new trash) goes through events.js.
// v5: after the tutorial the hall's shutters roll up onto the open world (survival.js: supplies, salvage, crafting, a shelter, the day
// and the night, the energy leeches, the save game; survival_view.js draws it, survival_ui.js is its screens).
// ?test adds window.__trolley for the desk tests (the same page, nothing else changes).
// v4 (Nov 1): ?bench runs the Troll-E + Juli phone bench in this page (bench.js; started from Settings › Benchmark), and the game counts
// its own page memory (mem_account.js: imported first, so it sees three.js make its context) where it is read: the bench, the desk, the probe.
import { MEM, memLine } from './mem_account.js';
import * as RAPIER from './vendor/rapier.mjs';
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { createSim, DT } from './sim.js';
import { createView } from './view.js';
import { createProps } from './props_view.js';
import { createAssets, shrinkTextures, dropCpuCopies } from './assets.js';
import { createCrumbs } from './boot_crumbs.js';
import { createTrail } from './trail.js';
import { createWorld } from './world_view.js';
import { WORLD, QUADS, CAMERA_BLOCKERS, WORLD_OBJECTIVES, HALL_OUT, areaAt, AREA_NAMES, quadAt } from './world_spec.js';
import { buildPlaceholder, bindModel } from './trolley_mesh.js';
import { createControls } from './controls.js';
import { createAudio } from './audio.js';
import { createTutorial, BEATS, beatIndex } from './tutorial.js';
import { createEvents } from './events.js';
import { createProgress, romWord } from './progress.js';
import { trolleyParts, WHEEL_R } from './trolley_spec.js';
import { ROOM, RAMP, TRASH, DOCK_BAY, START } from './level_spec.js';
import { TRASH_KINDS } from './items_spec.js';
import { TIERS } from './power.js';
import { createJuli, fakeBackend, COLORS, MISCHIEF_FROM, systemPrompt } from './juli.js';
import { connectJuli, GAME_SPLIT, GAME_PAGE_MB, REVIVE_AT, snapshotOn } from './juli_link.js';
import { loadPlan, consumePlan, createPlanRunner, planLists, plotPrompt, parsePlan, validatePlan, lastPlan } from './plan.js';
import { pathCheck, fixedFootprints, BARRICADE_FOOT } from './paths.js';
import { createSurvival } from './survival.js';
import { BATTERY } from './survival_rules.js';
import { createSurvivalView } from './survival_view.js';
import { createSurvivalUI } from './survival_ui.js';
import { createSaves } from './save.js';
import { hit } from './shelter.js';
import { createPause } from './landing.js';
import { createObjectiveChip, createComms } from './hud_ui.js';
import { createVoice } from './voice.js';
import { createStackGame, createStackTurns } from './stack.js';
import { createStackView } from './stack_view.js';
import { TARGET as STACK_TARGET, PAD as STACK_PAD, APPROACH as STACK_APPROACH, arenaFootprints } from './stack_spec.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search), TEST = Q.has('test');
// v4 (Nov 3): ?test&phonelike draws as a phone does (quality high, the pixel ratio up to 2): the desk's measure of the phone's page
const DESK_LOW = TEST && !Q.has('phonelike');
const HOME = new URL('../../', location.href).href;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (u) => u * u * (3 - 2 * u);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
const leave = () => { try { location.replace(HOME); } catch (e) { location.href = HOME; } };
const BENCH = Q.has('bench');
// (v4, Nov 3: on every phone too: its play trail records the page's memory, trail.js)
if (BENCH || TEST || Q.has('lowmem') || lsGet('p0pc0rn:trolley:probe') === '1' || /iPhone|iPad|iPod/.test((globalThis.navigator && navigator.userAgent) || '') || (/Macintosh/.test((globalThis.navigator && navigator.userAgent) || '') && navigator.maxTouchPoints > 1)) MEM.install();   // the game's own page memory, counted (the probe's "game" line)
// a phone's memory (iPhone and iPad Safari, or a device that says it has 4 GB or less; ?lowmem on the desk): every model's textures at
// most 1024 px (mipmaps kept). The trolley's own maps are 3072 x 2048: 104 MB of GPU memory at full size, 19 MB at 1024 px
const UA = (globalThis.navigator && navigator.userAgent) || '';
const LOWMEM = Q.has('lowmem') || /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1) || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4);
const TEX_MAX = LOWMEM ? 1024 : Infinity;
// v4: the game's page budget on a phone: its own counted memory (mem_account.js) beside Juli's page share on the game's layout, under
// the page's ceiling less WebKit's own share and a margin. Safari tells the page nothing of its JS heap: a fixed guess stands in for it.
// Juli's one retry after her second process ended waits until the game is under it.
const PAGE = { ceilingMB: 1856, webkitMB: 192, juliMB: 932, marginMB: 150, heapGuessMB: 100 };
const GAME_BUDGET_MB = PAGE.ceilingMB - PAGE.webkitMB - PAGE.juliMB - PAGE.marginMB;
const gameMB = (s) => (s ? s.totalMB + (s.heapMB == null ? PAGE.heapGuessMB : 0) : null);
// the crash breadcrumbs (boot_crumbs.js): where the boot is, kept in localStorage as it goes; play time for its 10 s of stable play
let playT = 0;
const CR = createCrumbs({ clock: () => playT });
// v4 (Nov 3; Josh: "Crash troll-e when I went into the dock to recharge", and nothing reached the app's Diagnostics): the play trail
const TR = createTrail();
CR.stage('start');

// no pinch zoom, no double-tap zoom, no page scroll (iOS ignores user-scalable=no)
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.sheet')) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault());
for (const id of ['back', 'leave', 'home', 'fail-home', 'dead-home']) $(id).addEventListener('click', leave);

function fail(msg, e) {
  $('start').hidden = true; $('hud').hidden = true; $('slots').hidden = true; $('fail').hidden = false;
  $('fail-line').textContent = msg + (e && e.message ? ` (${String(e.message).slice(0, 140)})` : '');
  if (TEST) (globalThis.__trolleyErrors ||= []).push(String((e && e.stack) || e || msg));
}

// the camera: the chase view (v1's: behind the trolley, 3.2 m out, pitched 0.5 rad) and the top view (the whole world framed, 78° down,
// over its centre: about 45 m out on a phone held upright); `top` blends them (0 = chase, 1 = top), eased towards `goal`, which a pinch
// moves. Between the two the camera slides from a01 to the world's centre and its distance grows geometrically (a smooth zoom).
const CAM = { chasePitch: 0.5, chaseDist: 3.2, topPitch: 1.36, topDist: 46 };
const WC = { x: (WORLD.x0 + WORLD.x1) / 2, z: (WORLD.z0 + WORLD.z1) / 2 };

/** v4: boot.js starts the game once the landing screen has its choice (opts.mode 'first': the choice made before anything loaded,
 *  run as soon as the scene is ready) or, on the desk, shows the landing over the ready scene ('after', as the old start card); the
 *  bench starts it with no landing */
export function start(opts = {}) { return main(opts).catch((e) => fail('The game could not start.', e)); }
async function main(opts = {}) {
  const t0 = performance.now();
  const LANDING = opts.landing || null, ACTION = opts.action || null;
  const say = (t) => { if (LANDING && opts.mode === 'first') LANDING.setLoading(t); else { const l = $('load'); if (l) l.textContent = t; } };   // the loading words
  // v4: the phone bench: it picks up its run, runs the steps that need no scene (and the settle after a page the phone ended), and hands
  // back here only for a step that needs the game's scene (bench.js; boot.js runs it first and hands it over)
  let bench = opts.bench || null;
  if (BENCH && !bench) {
    try { const m = await import('./bench.js'); bench = m.createBench({ HOME, Q, TEST, lowmem: LOWMEM }); $('start').hidden = true; if ((await bench.before()) !== 'scene') return; }
    catch (e) { return fail('The bench could not start.', e); }
  }
  // the last page stopped while loading something (a phone kills a page for memory without a word): one line on the start card, and
  // a row in the app's Diagnostics
  if (CR.line) { $('crumb').textContent = CR.line; $('crumb').hidden = false; CR.report({ lowmem: LOWMEM }); }
  say('Loading the physics…');
  CR.stage('rapier');
  await RAPIER.init();
  const progress = createProgress();
  // v5: the open world's data (data/*.json: the catalog, the recipes, the shelter kits, the salvage sites); the game runs the tutorial without it
  const WD = { error: null };
  CR.begin('data');
  const dataReady = Promise.all(['catalog', 'recipes', 'shelters', 'sites'].map((f) => fetch(`data/${f}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`data/${f}.json: ${r.status}`); return r.json(); })))
    .then(([catalog, recipes, shelters, sites]) => ({ catalog, recipes, shelters, sites })).catch((e) => { WD.error = String((e && e.message) || e); return null; }).finally(() => CR.end('data'));
  const saves = createSaves();
  // the start card's switches (kept per device): Juli on/off, her radio on/off, the probe overlay. Juli defaults OFF on a phone-class
  // device (Josh's iPhone, Nov 1: "Troll-E crashed at first movement" = the moment her model started beside the game); on by choice
  const juliSaved = lsGet('p0pc0rn:trolley:juli');
  // v4: Juli is ON by default again on a phone too (her model now sits in the app's second process, the game in the page: juli_link.js
  // GAME_SPLIT); a saved '0' still wins. v4 (Nov 3, Josh: "Big brain brains before it loads on all. In V1 of troll-e"): she plays live
  // on her own model (E2B) on every device; the Bigger brain only plans her shift in the loading screen (plot.js), then lets go.
  // The radio switch is the radio sound on her voice; her lines always show as subtitles (no switch hides them).
  const SET = { juli: juliSaved !== '0', radio: lsGet('p0pc0rn:trolley:radio') !== '0', probe: lsGet('p0pc0rn:trolley:probe') === '1',
    voice: lsGet('p0pc0rn:trolley:voice') !== '0' };
  if (bench) { SET.juli = false; SET.probe = true; }   // the bench starts her itself, layout by layout (nothing saved)
  // v4: the switches live on the landing screen (landing.js writes their keys); a change there reaches the game here
  if (opts.hooks) opts.hooks.onSetting = (k, v) => {
    if (k === 'sound') { audio && audio.setMuted(!v); if (!v) voice.cancel(); return; }
    if ((k === 'voice' || k === 'juli') && !v) voice.cancel();
    if (k in SET && k !== 'brain') SET[k] = v;
    if (k === 'probe' && $('probe')) $('probe').hidden = !(v && G.booted);
  };
  const sim = createSim(RAPIER, { tier: progress.tier });
  const events = createEvents();
  let quality = DESK_LOW ? 'low' : 'high';
  let view;
  CR.stage('tex:hall');
  // (v4, Nov 3: on a phone the sun's shadow map is 1024 px: 8 MB, 32 MB at 2048)
  try { view = createView($('view'), { quality, shadowSize: LOWMEM ? 1024 : null }); } catch (e) { return fail('This browser could not start its 3D drawing (WebGL).', e); }
  const { scene, camera, renderer } = view;
  // v4 (Nov 2, memory first): the models' textures let go of their CPU copies once on the GPU (assets.js releaseOnUpload); a lost WebGL
  // context could not get them back, so the game saves (in the open world) and opens a fresh page then
  const assets = createAssets(THREE, GLTFLoader, mergeGeometries, { texMax: TEX_MAX, itemMax: LOWMEM ? 256 : Infinity, onBegin: (k) => CR.begin('gltf:' + k), onEnd: (k) => CR.end('gltf:' + k), dropCopies: !Q.has('keepcopies') });
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    try { e.preventDefault(); } catch (x) { /* */ }
    try { if (W.s && W.s.active) W.s.autosave('context'); } catch (x) { /* */ }
    CR.clear(); setTimeout(() => { try { location.reload(); } catch (x) { /* */ } }, 300);
  }, { once: true });
  const props = createProps(scene, assets, view.M);
  const world = createWorld(scene, { M: view.M, assets, glow: view.glow, grime: props.grime, quality });   // the four quadrants and the plaza round the hall
  // the hall's insides (stairs, ramp, dock, signs, pipes...) are hidden by its 2.6 m walls from outside: not drawn while the camera is
  // outside the hall and over 7 m from its walls (its walls and floor always are; the lights stay, so no shader changes)
  const hallInside = new THREE.Group(); hallInside.name = 'hall_inside';
  { const keep = new Set(['arm_base', 'arm_shoulder', 'arm_elbow', 'arm_wrist_roll', 'arm_wrist_pitch', 'claw_jaw'].map((n) => props.armGroup(n)));
    for (const o of [...scene.children]) if (!o.isLight && o !== view.key.target && o !== world.root && !keep.has(o) && !(o.material && (o.material === view.M.wall || o.material === view.M.floor)) && !o.userData.floorMarks) hallInside.add(o);
    scene.add(hallInside); }

  // ---- v4: the stack mini game (stack.js; Josh: "one mini game like stacking physical trash against Juli trying to prevent it. Early
  //      on"): right after the tutorial's grab step, a01 stacks cans on the weigh pad by the start while Juli's physical tools (a vent, a
  //      rattling plate, a can rolled from a chute, a sweeper bot) try to topple them, each with a warning first; her moves are her model's
  const stack = createStackGame({ sim, post: (c) => events.post(c, 'stack') });
  const stackView = createStackView({ THREE, scene });
  const STK = { on: false };   // the arena stands (from the start until it is taken away, a few seconds after the game ends)
  // ---- the trolley's drawing: the placeholder at once, the real model when it has loaded
  const parts = trolleyParts();
  const ph = buildPlaceholder(parts, view.glow);
  for (const g of ph.groups.values()) scene.add(g);
  const chassisG = ph.groups.get('trolley_01');
  const under = new THREE.PointLight('#28e0ff', 0.6, 1.1, 2); under.position.set(0, 0.04, 0); chassisG.add(under);
  chassisG.add(props.armMount);   // the arm's welded bracket rides on the chassis   // the LEDs' light on the floor (one light, cheap)
  // the top view's stand-in for a01 (the model is 305k triangles and, seen from 45 m, a dozen pixels): its box, its cyan glow, an arrow
  const proxy = new THREE.Group(); proxy.name = 'a01_proxy'; proxy.visible = false; chassisG.add(proxy);
  { const body = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.62, 0.9), new THREE.MeshStandardMaterial({ color: '#5b6069', roughness: 0.5, metalness: 0.5 })); body.position.y = 0.36;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.93), new THREE.MeshBasicMaterial({ color: '#28e0ff', toneMapped: false })); top.position.y = 0.69;
    const sh = new THREE.Shape(); sh.moveTo(0.42, 0); sh.lineTo(-0.3, 0.3); sh.lineTo(-0.12, 0); sh.lineTo(-0.3, -0.3); sh.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff3ea5', toneMapped: false })); arrow.position.y = 0.72;
    proxy.add(body, top, arrow); }
  let lodTop = false;
  /** the top view draws the stand-in instead of the model (lights, the floor glow and the arm's bracket are left alone) */
  function topLOD(on) {
    if (on === lodTop) return; lodTop = on; proxy.visible = on;
    for (const g of ph.groups.values()) for (const c of g.children) if (c !== proxy && !c.isLight && c !== g.userData.pool && c !== props.armMount) c.visible = !on;
  }
  const glowMats = [ph.mat.cyan], brakeMats = [...ph.brake];
  const M = { source: 'placeholder', report: null, error: null };
  const modelReady = (async () => {
    try {
      const pj = await (await fetch('assets/trolley_parts.json', { cache: 'no-cache' })).json();
      const loader = new GLTFLoader();
      CR.begin('gltf:trolley');
      const gltf = await loader.loadAsync('assets/trolley.glb', (ev) => { if (ev.total) say(`Loading the trolley… ${Math.round((ev.loaded / ev.total) * 100)}%`); }).finally(() => CR.end('gltf:trolley'));
      M.shrunk = shrinkTextures(gltf.scene, TEX_MAX);   // on a phone: its maps at 1024 px before they are ever drawn
      const rep = bindModel(gltf.scene, parts, ph.groups, pj);
      if (rep.missing.length > 2) throw new Error('the model is missing ' + rep.missing.join(', '));
      glowMats.length = 0; glowMats.push(...rep.glow); brakeMats.length = 0; brakeMats.push(...rep.brake);
      M.source = 'glb'; M.report = rep;
    } catch (e) { M.error = String((e && e.message) || e); }
  })();

  // ---- links between bodies and drawings (rebuilt when bodies come or go), with the last two steps kept to draw in between
  let links = [];
  const mk = (body, g) => { const l = { body, g, a: new Float64Array(7), b: new Float64Array(7) }; read(body, l.b); l.a.set(l.b); return l; };
  function relink() {
    const L = [], V2 = sim.v2;
    for (const p of sim.parts) L.push(mk(p.body, ph.groups.get(p.name)));
    for (const p of V2.arm.parts) L.push(mk(p.body, props.armGroup(p.name)));
    for (const it of V2.items) L.push(mk(it.body, props.itemGroup(it)));
    if (V2.kit) L.push(mk(V2.kit.body, props.kit));
    for (const pu of V2.pickups) L.push(mk(pu.body, props.pickupGroup(pu)));
    V2.dressing.forEach((d, i) => L.push(mk(d.body, props.dressingGroup(i, d.kind))));
    for (const o of V2.obstacles.values()) L.push(mk(o.body, props.barrierGroup(o.id)));
    links = L;
  }
  function read(body, out) { const t = body.translation(), q = body.rotation(); out[0] = t.x; out[1] = t.y; out[2] = t.z; out[3] = q.x; out[4] = q.y; out[5] = q.z; out[6] = q.w; }
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function draw(alpha) {
    for (const l of links) {
      const a = l.a, b = l.b;
      l.g.position.set(a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha);
      qa.set(a[3], a[4], a[5], a[6]); qb.set(b[3], b[4], b[5], b[6]); l.g.quaternion.copy(qa.slerp(qb, alpha));
    }
    const r = sim.ramp; if (r) { const t = r.body.translation(), q = r.body.rotation(); view.setRamp(t, q, r.locked); }
    if (G.state) props.sync(G.state, sim.v2, G.t);
  }

  // ---- input, sound, tutorial, toasts
  const audio = createAudio();
  // v4: Juli's voice (voice.js: CMU Flite's slt voice once it is in vendor/flite/, a stand-in until then), through the radio chain; never
  // while a model loads; her lines always show as subtitles whatever the voice does
  const voice = createVoice({ audio, enabled: () => SET.voice && SET.juli, radio: () => SET.radio, hold: () => assets.busy() > 0 || CR.inflight().length > 0,
    onLoad: (s) => (s === 'start' ? CR.begin('voice:load') : CR.end('voice:load')) });
  addEventListener('pagehide', () => voice.cancel());
  if (lsGet('p0pc0rn:trolley:muted') === '1') { audio.setMuted(true); $('mute').setAttribute('aria-pressed', 'true'); $('mute').setAttribute('aria-label', 'Sound on'); }
  $('mute').addEventListener('click', () => { const m = !audio.muted; audio.setMuted(m); if (m) voice.cancel(); $('mute').setAttribute('aria-pressed', String(m)); $('mute').setAttribute('aria-label', m ? 'Sound on' : 'Sound off'); lsSet('p0pc0rn:trolley:muted', m ? '1' : '0'); });
  const cam = { a: 0, pitch: CAM.chasePitch, dist: CAM.chaseDist, top: 0, goal: 0, user: -10, recentre: 0, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), snap: true };
  const G = { t: 0, booted: false, acc: 0, last: 0, steps: 0, frames: 0, paused: false, finished: null, hudT: 0, dirT: 0, events: [], clackT: new Map(), boot: 0, runRoms: 0, dockedShown: false, warned: {} };
  const controls = createControls({
    stickZone: $('stick-zone'), stickBase: $('stick-base'), stickKnob: $('stick-knob'), lookZone: $('look'),
    modeButtons: [...document.querySelectorAll('.mode')], holdButton: $('hold'), grabButton: $('grab'), dockButton: $('dock-btn'),
    onOrbit: (dx, dy) => { cam.a -= dx * 0.008; cam.pitch = clamp(cam.pitch + dy * 0.005, 0.12, 1.25); cam.user = G.t; cam.recentre = 0; },
    onPinch: (d) => { cam.goal = clamp(cam.goal + d, 0, 1); cam.user = G.t; },
    onDoubleTap: () => { cam.goal = 0; cam.pitch = CAM.chasePitch; cam.user = -10; cam.recentre = 1.2; },
    onView: () => { cam.goal = cam.goal > 0.5 ? 0 : 1; },
    onGrab: () => grab(), onDock: () => requestStore(),
    onAny: () => { audio.start(); if (G.booted) G.input = true; },   // (the first real input after Play lets Juli's model load)
  });
  let toastT = 0;
  function toast(text, kind = '', ms = 2400) {
    const el = $('toast'); el.textContent = text; el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
  }
  const tutorial = createTutorial({
    onBeat: (b, i) => { if (JL.juli && JL.juli.nudge && G.booted && !bench) JL.juli.nudge(G.t);   // v4 (Nov 2): a new step: her word on it soon
      if (b.id === 'diesel' && G.booted && !G.stackOffered && !bench) startStack();$('hint').textContent = b.hint; $('step').textContent = `${i + 1} / ${BEATS.length}`; const h = $('hint-box'); h.classList.add('flash'); setTimeout(() => h.classList.remove('flash'), 600); },
    onDone: (t) => { G.finished = t; progress.finish(t); setTimeout(showDone, 1400); },
  });
  // ---- v5: the open world
  const W = { s: null, view: null, ui: null };
  dataReady.then((data) => {
    if (!data) return;
    try {
      W.s = createSurvival({ sim, data, seed: 1 + Math.floor(Math.random() * 1e6) });
      W.view = createSurvivalView({ scene, renderer, view, assets, world, sim, crateGroup: ph.groups.get('trashbox_01'), armGroup: (n) => props.armGroup(n), chassisG, cat: data.catalog.items, itemGroup: (it) => props.itemGroup(it) });
      W.ui = createSurvivalUI({ $, survival: W.s, sim, sview: W.view, toast, audio, onPause: (on) => { G.bubble = on; } });
      events.setBlocked((x, z) => !!(W.s && W.s.active && W.s.blockedAt(x, z)));
    } catch (e) { WD.error = String((e && e.message) || e); W.s = null; if (TEST) (globalThis.__trolleyErrors ||= []).push(String(e && e.stack)); }
  });
  const inWorld = () => !!(W.s && W.s.active);
  /** into the open world: the hall's shutters roll up and survival starts (save: a saved game to load) */
  function startWorld({ save = null } = {}) {
    if (!W.s) { toast('The open world could not load: ' + (WD.error || 'no data'), 'bad', 4000); return false; }
    $('done').hidden = true; $('dead').hidden = true; closeSlots(); W.ui.close();
    CR.stage('world:open');   // (the quadrants' models load from here: the world's load gate opens with the hall)
    tutorial.state.done = true; G.finished = null; sim.setHallDoors(true); W.view.reset(); W.s.start({ save }); relink(); cam.snap = true;
    $('step').textContent = 'DAY ' + W.s.state().day; G.worldHint = ''; hud(sim.state()); return true;
  }
  /** a new game straight into the open world: a fresh hall (the arm fitted, the ramp docked at the landing), the tutorial skipped */
  function skipTutorial() {
    if (!W.s) return false;
    if (W.s.active) W.s.stop();
    $('start').hidden = true; $('hud').hidden = false; $('dead').hidden = true; G.booted = true; G.boot = G.t;
    sim.newRun(); world.resetTracks(); sim.buildRamp({ highX: -6.17, z: -5.0, yawDeg: 0 }); sim.reset({ x: START.x, z: START.z, yawDeg: START.yawDeg });
    sim.v2.arm.state = 'carried'; sim.mountArm(); relink(); layoutRun();
    tutorial.go(BEATS.length - 1, sim.state()); controls.set({ mode: 'drive' });
    queueJuli();
    $('probe').hidden = !SET.probe; audio.start(); startWorld(); controls.rest(); return true;
  }
  /** the saved game, from the start card */
  function continueGame() {
    const sv = saves.load(); if (!sv || !W.s) return false;
    $('start').hidden = true; $('hud').hidden = false; G.booted = true; G.boot = G.t;
    sim.newRun(); world.resetTracks(); sim.buildRamp({ highX: -6.17, z: -5.0, yawDeg: 0 });
    sim.v2.arm.state = 'carried'; sim.mountArm(); relink(); tutorial.go(BEATS.length - 1, sim.state());
    queueJuli();
    $('probe').hidden = !SET.probe; audio.start(); startWorld({ save: sv }); controls.rest(); return true;
  }
  /** death: a01's pack at 0 % out in the open world (the leeches, or anything else). The save goes; it starts again from the beginning
   *  (the tutorial, or skipping it); the ROMs and the battery's tier stay */
  function onDeath(e) {
    W.s.die(); W.ui.close(); closeSlots();
    $('dead-line').textContent = e.cause === 'leeches' ? `The leeches drank the last of the battery on day ${e.day}.` : `The battery ran flat out in the open on day ${e.day}.`;
    $('dead').hidden = false; audio.splash();
  }
  function restartTutorial() {
    if (W.s && W.s.active) W.s.stop();
    $('dead').hidden = true; sim.newRun(); world.resetTracks(); sim.buildRamp(RAMP.start); sim.reset(); relink(); layoutRun(); cam.snap = true; cam.goal = cam.top = 0;
    sim.setHallDoors(false, true); G.finished = null; G.t = 0; G.boot = 0; controls.set({ mode: 'drive' }); tutorial.state.done = false; tutorial.go(0, sim.state()); hud(sim.state());
  }
  $('world-go').addEventListener('click', () => startWorld());
  $('dead-skip').addEventListener('click', () => skipTutorial());
  $('dead-tut').addEventListener('click', () => restartTutorial());
  if (!LANDING) { $('skip').addEventListener('click', () => skipTutorial()); $('continue').addEventListener('click', () => continueGame()); }   // (v4: the landing's choice, below)
  function showDone() {
    const s = Math.round(G.finished || 0), mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
    $('done-line').textContent = `Resting on the landing, all four wheels on it, after ${mm}:${ss}.`;
    $('done-roms').textContent = `This run: ${G.runRoms} ${romWord(G.runRoms)} from the trash. You have ${progress.roms} ${romWord(progress.roms)}.`;
    closeSlots(); $('world-go').hidden = !W.s; $('done').hidden = false;
  }
  /** the level's things for a new run, laid out through the events module (trash) and the sim (the arm kit) */
  function layoutRun() {
    G.binned = 0; G.stackOffered = false; stopStack();
    for (const [kind, x, z, yawDeg] of TRASH) events.post({ type: 'spawnTrash', kind, x, z, yawDeg });
    if (sim.v2.arm.state === 'map') sim.placeKit();
    sim.placePickups();
    G.runRoms = 0; G.warned = {}; relink();
  }
  $('again').addEventListener('click', () => {
    $('done').hidden = true; sim.newRun(); world.resetTracks(); sim.buildRamp(RAMP.start); sim.reset(); relink(); layoutRun(); cam.snap = true; cam.goal = cam.top = 0;
    sim.setHallDoors(false, true); G.finished = null; G.t = 0; G.boot = 0; controls.set({ mode: 'drive' }); tutorial.state.done = false; tutorial.go(0, sim.state());
  });
  $('reset').addEventListener('click', () => {
    if (inWorld()) {
      const S = W.s.shelter, g = S && W.s.sealed() ? W.s.shelters.geometry(S.concept, S.site).pad : null, pk = DOCK_BAY.park;
      if (sim.reset(g ? { x: g.x, z: g.z, yawDeg: g.yaw * 180 / Math.PI } : { x: pk.x, z: pk.z, yawDeg: pk.yawDeg }) === false) { toast('The dock is working on a01: wait for it.'); return; }
      relink(); cam.snap = true; controls.set({ mode: 'drive' }); return;
    }
    const rs = sim.rampState();
    if (rs && Math.abs(qUpY(rs.q)) < 0.8) {   // the ramp fell over: it goes back to its start, and so does the tutorial (to the push)
      sim.buildRamp(RAMP.start);
      if (tutorial.index > beatIndex('push') && !tutorial.done) tutorial.go(beatIndex('push'), sim.state());
    }
    if (sim.reset(tutorial.spawnFor(sim.state())) === false) { toast('The dock is working on a01: wait for it.'); return; }
    relink(); cam.snap = true; controls.set({ mode: 'drive' });
  });
  const qUpY = (q) => 1 - 2 * (q.x * q.x + q.z * q.z);

  // ---- the arm and the dock
  function grab() {
    if (!G.booted) return;
    if (inWorld() && !sim.v2.arm.grasp && !sim.reachable().length && W.s.salvageTarget()) {   // v5: SALVAGE what is in the arm's reach
      const sv = W.s.salvage(); toast(sv.ok ? `Salvaging the ${W.s.cat[sv.site.item].name}…` : `Can't salvage: ${sv.why}.`, sv.ok ? '' : 'bad', 2200); return;
    }
    const r = stack.phase === 'on' ? stack.grab() : sim.grab();   // v4: at the pad GRAB keeps a can, GRAB over the pad places it
    if (r.ok && r.from === 'place') { toast('Placing it on the stack', '', 1400); return; }
    if (r.ok && r.keep) { toast('Holding it for the stack: GRAB over the pad places it.', '', 2200); return; }
    if (!r.ok) toast(r.why === 'nothing in reach' ? "Nothing in reach: stop with the trash 0.4 to 0.9 m in front of the trolley's nose." : `Can't grab: ${r.why}.`);
    else if (!TRASH_KINDS[r.kind]) toast(r.from === 'carry' ? `Setting it down` : `Grabbing the ${sim.kinds[r.kind].name.toLowerCase()}`, '', 1600);
    else toast(r.from === 'carry' ? (r.toBin ? `Into the bin with the ${TRASH_KINDS[r.kind].name.toLowerCase()}` : `Setting the ${TRASH_KINDS[r.kind].name.toLowerCase()} down`) : r.toBin ? `Grabbing the ${TRASH_KINDS[r.kind].name.toLowerCase()}` : `No bin on: the claw will carry the ${TRASH_KINDS[r.kind].name.toLowerCase()}`, '', 1800);
  }
  const SLOT1 = { locked: 'Bin, locked on', loose: 'Bin, unlocked in the pocket', hoist: 'Bin on the hoist', stand: 'Bin on the stand' };
  const SLOT2 = { map: 'Empty. The arm kit is out on the floor', carried: 'Grab arm kit, aboard', mounted: 'Grab arm, mounted', rack: 'Empty. The grab arm is on the rack' };
  const ACT = { detachBin: 'Detach', attachBin: 'Attach', mountArm: 'Mount', unmountArm: 'Unmount' };
  // v4 (Nov 3: the phone ended twice as the dock's store opened; the second time its play trail said her helper was busy:
  // her turn was running). The store now opens only once her turn has finished (no new one starts once a01 is on the charger; 12 s at
  // most), and it is a plain opaque panel: while it is open the 3D canvas and the HUD are gone (display: none, no layer left for the
  // compositor) and the scene is not drawn at all (the physics still steps: the charger charges). Each step of the opening is in the trail.
  const herTurnRunning = () => !!((JL.juli && JL.juli.busy) || (JL.backend && JL.backend.busy && JL.backend.busy()));
  function requestStore() {
    if (!G.booted || !sim.v2.dock.parked) return openSlots();
    if (!$('slots').hidden || G.storeWait) return true;
    JL.storeHold = true;   // no new turn from here
    if (!herTurnRunning()) return openSlots();
    const t0 = performance.now(); G.storeWait = { t0 };
    trail('store', 'the store: parked on the charger, waiting for her turn to finish');
    toast('Dock 01 is waking up…', '', 1800);
    const wait = () => {
      if (!G.storeWait || G.storeWait.t0 !== t0) return;   // closed, or a01 left, in the meantime
      if (!sim.v2.dock.parked) { G.storeWait = null; if ($('slots').hidden) JL.storeHold = false; trail('store', 'the store: a01 left the charger before it opened'); return; }
      const ms = performance.now() - t0;
      if (herTurnRunning() && ms < 12000) { setTimeout(wait, 150); return; }
      G.storeWait = null; if (herTurnRunning()) trail('store', `the store: her turn still running after ${Math.round(ms / 1000)} s, opening anyway`);
      openSlots();
    };
    setTimeout(wait, 150);
    return true;
  }
  function openSlots() {
    if (!G.booted || !sim.v2.dock.parked) { if (G.booted) toast('Slots change only in the dock: park on its charger.'); return false; }
    if (!$('slots').hidden) return true;
    G.storeWait = null; JL.storeHold = true;
    trail('store', `the store 1/4: opening, building the panel (her turn ${herTurnRunning() ? 'running' : 'done'})`);
    renderSlots();
    trail('store', 'the store 2/4: panel built');
    controls.set({ x: 0, y: 0, hold: false });
    G.storeStop = true; G.storeStopMarked = false;   // the frame loop stops drawing (render() and frame() check it)
    $('slots').hidden = false; document.body.classList.add('sheet-open', 'store-open');
    requestAnimationFrame(() => requestAnimationFrame(() => { if (G.storeStop) trail('store', 'the store 4/4: open, its first paint done (parked on the charger)'); }));
    return true;
  }
  function closeSlots() {
    if (G.storeWait) { G.storeWait = null; if ($('slots').hidden) JL.storeHold = false; }
    if ($('slots').hidden) return;
    $('slots').hidden = true; document.body.classList.remove('sheet-open', 'store-open');
    G.storeStop = false; JL.storeHold = false; controls.set({ x: 0, y: 0, hold: false }); controls.rest();
    trail('store', 'the store closed, the 3D drawing back');
  }
  $('slots-close').addEventListener('click', closeSlots);
  for (const [id, key] of [['slot1-btn', 'top'], ['slot2-btn', 'front']]) $(id).addEventListener('click', () => {
    const a = sim.slots()[key].action; if (!a) return;
    const r = sim.dockOp(a); if (!r.ok) toast(`Can't: ${r.why}.`); else audio.clack(1);
    renderSlots();
  });
  function renderSlots() {
    const sl = sim.slots(), s = sim.state(), b = s.v2.battery;
    $('slot1-v').textContent = SLOT1[sl.top.state] || sl.top.state;
    $('slot2-v').textContent = SLOT2[sl.front.state] || sl.front.state;
    for (const [id, slot] of [['slot1-btn', sl.top], ['slot2-btn', sl.front]]) {
      const el = $(id); el.textContent = slot.action ? ACT[slot.action] : '—'; el.disabled = !slot.action || sl.busy || !sl.parked;
      el.classList.toggle('go', slot.action === 'mountArm' || slot.action === 'attachBin');
    }
    $('slot-msg').textContent = sl.busy ? (sl.msg || 'Working…') : !sl.parked ? 'Not parked: drive back onto the charger.' : b.charging ? `Parked · charging` : 'Parked · battery full';
    $('dock-batt-line').textContent = `${Math.round(b.frac * 100)} %${b.charging ? ' · charging' : ''} · ${TIERS[b.tier].name}`;
    $('dock-batt-fill').style.width = (b.frac * 100).toFixed(1) + '%';
    const T = $('tiers'), key = [progress.tier, progress.roms, sl.parked].join('/');
    if (T.dataset.key === key) return;   // rebuilt only when it changes (a rebuild under a finger would lose the tap)
    T.dataset.key = key; T.textContent = '';
    TIERS.forEach((tier, i) => {
      const card = document.createElement('div'); card.className = 'tier' + (i <= progress.tier ? ' own' : '');
      const n = document.createElement('div'); n.className = 'tier-n'; n.textContent = tier.name.replace(' cells', '');
      const c = document.createElement('div'); c.className = 'tier-c'; c.textContent = i === 0 ? 'stock pack' : `+${Math.round((tier.capacity / TIERS[0].capacity - 1) * 100)} % run time`;
      card.append(n, c);
      if (i <= progress.tier) { const o = document.createElement('div'); o.className = 'owned'; o.textContent = i === progress.tier ? 'Fitted' : 'Owned'; card.append(o); }
      else {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = `${tier.cost} ${romWord(tier.cost)}`; btn.disabled = i !== progress.tier + 1 || progress.roms < tier.cost || !sl.parked;
        btn.setAttribute('aria-label', `Buy ${tier.name} for ${tier.cost} ${romWord(tier.cost)}`);
        btn.addEventListener('click', () => buyTier(i)); card.append(btn);
      }
      T.append(card);
    });
  }
  function buyTier(i) {
    if (!sim.v2.dock.parked) { toast('Battery upgrades are fitted in the dock.'); return false; }
    const r = progress.buyTier(i);
    if (!r.ok) { toast(`Can't buy it: ${r.why}.`); return false; }
    sim.setTier(i); audio.chime(25); toast(`${TIERS[i].name} fitted.`, 'good'); renderSlots(); hud(sim.state()); return true;
  }

  // ---- the objective: the tutorial's step (live positions for the kit and the trash), then the nearest trash, or the dock when the
  //      battery runs low. The compass strip shows the view's heading and the objective's bearing; a beacon floats over it in the room;
  //      an arrow at the screen's edge points to it when it is out of view.
  const PXD = 2.2, wrap180 = (d) => ((d + 540) % 360) - 180;
  { const tape = $('compass-tape'), L = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -180; d <= 540; d += 15) {
      const n = ((d % 360) + 360) % 360;
      if (L[n] != null) { const b = document.createElement('b'); b.textContent = L[n]; b.className = (n % 90 === 0 ? 'cdir' : '') + (n === 0 ? ' north' : ''); b.style.left = (d * PXD) + 'px'; tape.append(b); }
      else { const t = document.createElement('span'); if (n % 45 === 0) t.className = 'mid'; t.style.left = (d * PXD) + 'px'; tape.append(t); }
    } }
  // the quadrants on the compass: a label at each one's bearing from a01 (not the one a01 is in); the zone chip names where a01 is
  const QMARKS = QUADS.map((qd) => { const el = document.createElement('span'); el.className = 'compass-q q-' + qd.id; el.textContent = qd.short; el.hidden = true; $('compass').append(el); return { qd, el }; });
  const beacon = new THREE.Group(); scene.add(beacon); beacon.visible = false;
  { const m = new THREE.MeshBasicMaterial({ color: '#ff3ea5', transparent: true, opacity: 0.92, depthTest: false }), c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 4), m);
    c.rotation.x = Math.PI; c.renderOrder = 5; beacon.add(c);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 24), new THREE.MeshBasicMaterial({ color: '#ff3ea5', transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.2; halo.renderOrder = 5; beacon.add(halo); }
  const kindName = (k) => (TRASH_KINDS[k] ? TRASH_KINDS[k].name.toUpperCase() : sim.kinds[k] ? sim.kinds[k].name.toUpperCase() : 'TRASH');
  function objectiveNow(s) {
    if (!G.booted) return null;
    const v2 = sim.v2, P = { x: s.pos[0], z: s.pos[2] }, loose = (it) => it.state === 'floor' && !it.banked && !it.inBin && it.spec.ringable && !it.held;
    const nearest = (f) => { let best = null, bd = Infinity; for (const it of v2.items) { if (!f(it)) continue; const q = it.body.translation(), d = Math.hypot(q.x - P.x, q.z - P.z); if (d < bd) { bd = d; best = { name: kindName(it.kind), x: q.x, z: q.z, y: q.y } } } return best; };
    const dock = { name: 'DOCK 01', x: DOCK_BAY.park.x, z: DOCK_BAY.park.z, y: 0 };
    if (stack.phase === 'on') return { name: 'THE PAD', x: STACK_PAD.x, z: STACK_PAD.z, y: 0 };   // v4: the stack game's pad
    if (!tutorial.done) {
      const o = tutorial.objective(s); if (!o) return null;
      const id = tutorial.beat.id;
      if (o.name === 'DOCK 01' || id === 'dock' || id === 'mount') return dock;
      if (id === 'armkit' && v2.kit) { const q = v2.kit.body.translation(); return { name: 'ARM KIT', x: q.x, z: q.z, y: q.y }; }
      if (id === 'grab') return nearest((it) => loose(it) && it.kind === 'soda') || nearest((it) => loose(it) && it.kind !== 'diesel') || o;
      if (id === 'diesel') return nearest((it) => it.kind === 'diesel' && loose(it) && !it.spilled) || o;
      return o;
    }
    if (inWorld()) return worldObjective(s, P, nearest, dock);
    if (s.v2.battery.frac < 0.25 || s.v2.battery.limp) return dock;
    if (s.v2.arm.carrying && s.v2.bin !== 'locked') return dock;
    return nearest(loose);
  }
  /** v5: the open world's objective: the shelter at night (or the dock if a01 has none), a site the player asked to find, the next
   *  shelter piece's spot, else the nearest thing the claw can take or the nearest salvage */
  function worldObjective(s, P, nearest, dock) {
    const st = W.s.state(), S = W.s.shelter, g = S ? W.s.shelters.geometry(S.concept, S.site) : null;
    if (st.night || st.toDusk < 40) { if (st.inside) return null; return S && st.shelter.sealed ? { name: 'SHELTER', x: g.approach.x, z: g.approach.z, y: 0 } : dock; }
    if (s.v2.battery.frac < 0.2) return S && st.shelter.sealed ? { name: 'SHELTER', x: g.pad.x, z: g.pad.z, y: 0 } : dock;
    const goal = W.ui.goal; if (goal && !S) { if (Math.hypot(goal.x - P.x, goal.z - P.z) > 0.6) return { name: goal.name + ' SITE', x: goal.x, z: goal.z, y: 0 }; }
    if (S && !st.shelter.sealed) { const pr = W.s.shelters.progress(S.concept, S.built, (id) => W.s.inv.count(id), W.s.S.owned); if (pr.next) { const p = W.s.layoutOf().find((q) => q.key === pr.next.key); return { name: W.s.cat[p.item].name.toUpperCase(), x: p.x, z: p.z, y: 0 }; } }
    const it = nearest((x) => x.state === 'floor' && !x.banked && !x.held && sim.fits(x));
    if (it) { it.name = it.name === 'TRASH' ? 'SUPPLY' : it.name; return it; }
    let best = null, bd = Infinity; for (const site of W.s.sites) { if (site.stripped != null || (site.kind === 'spot' && !site.fixed)) continue; const d = Math.hypot(site.x - P.x, site.z - P.z); if (d < bd) { bd = d; best = site; } }
    return best ? { name: W.s.cat[best.item].name.toUpperCase(), x: best.x, z: best.z, y: 0 } : null;
  }
  function compassFrame() {
    const view = (90 - cam.a * 180 / Math.PI + 720) % 360;
    $('compass-tape').style.transform = `translateX(${(-view * PXD).toFixed(1)}px)`;
    const o = G.obj, mark = $('compass-mark'), ch = chassisG.position, halfW = $('compass').clientWidth / 2 - 24, here = quadAt(ch.x, ch.z);
    for (const { qd, el } of QMARKS) {
      const b = (Math.atan2(qd.at[0] - ch.x, -(qd.at[1] - ch.z)) * 180 / Math.PI + 360) % 360, qx = wrap180(b - view) * PXD;
      const show = qd.id !== here && Math.abs(qx) < halfW; el.hidden = !show; if (show) el.style.left = `calc(50% + ${qx.toFixed(1)}px)`;
    }
    if (!o) { mark.hidden = true; beacon.visible = false; $('offscreen').hidden = true; return; }
    const brg = (Math.atan2(o.x - ch.x, -(o.z - ch.z)) * 180 / Math.PI + 360) % 360, half = $('compass').clientWidth / 2 - 16;
    let x = wrap180(brg - view) * PXD; const edge = Math.abs(x) > half; x = Math.max(-half, Math.min(half, x));
    mark.hidden = false; mark.classList.toggle('edge', edge); mark.style.left = `calc(50% + ${x.toFixed(1)}px)`;
    // the beacon, bobbing over it (higher and bigger in the top view)
    const k = smooth(cam.top), big = 1 + k * ((cam.curDist || CAM.chaseDist) / 9.2 * 2.6 - 1), lift = (o.y || 0) + 0.75 + 0.9 * k * big + 0.08 * Math.sin(G.t * 3);
    beacon.visible = true; beacon.position.set(o.x, lift, o.z); beacon.rotation.y = G.t * 1.5; beacon.scale.setScalar(big);   // as big on screen in the top view as it was at 9 m
    // the edge arrow when it is out of view
    const v = beacon.position.clone().project(camera), W = innerWidth, H = innerHeight, behind = v.z > 1;
    let nx = behind ? -v.x : v.x, ny = behind ? -v.y : v.y;
    const inView = !behind && Math.abs(nx) < 0.95 && Math.abs(ny) < 0.95, el = $('offscreen');
    if (inView) { el.hidden = true; return; }
    const cx = W / 2, cy = H / 2, dx = nx * W / 2, dy = -ny * H / 2, a = Math.atan2(dy, dx);
    const top = 140, bottom = H - 200, left = 30, right = W - 30;
    const sx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity, sy = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity, f = Math.min(sx, sy);
    el.hidden = false; el.style.transform = `translate(${(cx + dx * f).toFixed(0)}px, ${(cy + dy * f).toFixed(0)}px) rotate(${(a * 180 / Math.PI + 90).toFixed(0)}deg)`;
  }

  // ---- Juli (juli.js): she reads a compact state twice a minute or so and makes one call; the game never waits for her
  const JL = { juli: null, status: 'off', why: '', bounty: null, radioT: 0, signFx: new Map(), mem: '', chutes: [], lights: null, moveT: -1e9, voice };
  const signOf = (name) => (view.neon || []).find((n) => n.name === name);
  const juliWorld = {
    post: (cmd) => events.post(cmd, 'juli'), now: () => performance.now(), clock: () => G.t, summary: () => juliSummary(G.state || sim.state()),
    bounty: (b) => { JL.bounty = b; toast(`Bounty: ${TRASH_KINDS[b.kind].name} +${b.roms} ${romWord(b.roms)}`, 'rom', 2400); },
    prank: (kind, a) => {
      if (kind === 'sting') { audio.sting && audio.sting(); return; }
      if (kind === 'lights_out') { JL.lights = { t0: G.t, until: G.t + a.seconds, saved: null }; audio.thump(0.6); return; }   // v4 (juliLights)
      const sg = signOf(a.sign); if (!sg) return;
      if (!sg.orig) sg.orig = { color: sg.mat && sg.mat.color ? sg.mat.color.clone() : null, light: sg.light ? sg.light.color.clone() : null };
      JL.signFx.set(sg.name, { kind, color: COLORS[a.color], until: G.t + (kind === 'sign_color' ? 20 : 4), sg });
    },
    pathOK: (lane, id) => {
      if (inWorld() && !W.s.laneClear(lane)) return { ok: false, detour: Infinity, lost: ['the shelter'] };   // v5: never on a01's shelter or a site
      const s = G.state || sim.state(), v2 = sim.v2, foot = fixedFootprints(s.v2.door > 0.5);
      if (inWorld()) foot.push(...W.s.footprints());
      if (STK.on) foot.push(...arenaFootprints());   // v4: the stack game's pad, vent and sweeper lane while they stand
      for (const D of v2.hallDoors) if (D.open < 0.5) foot.push({ x: D.x, z: D.z, hx: D.hx, hz: D.hz, yaw: 0 });   // the hall's shutters while they are down
      for (const o of v2.obstacles.values()) if (o.id !== id) { const t = o.body.translation(), q = o.body.rotation(); foot.push({ x: t.x, z: t.z, hx: BARRICADE_FOOT.hx, hz: BARRICADE_FOOT.hz, yaw: 2 * Math.atan2(q.y, q.w) }); }
      if (sim.ramp) { const r = sim.ramp, t = r.body.translation(), q = r.body.rotation(), yaw = 2 * Math.atan2(q.y, q.w), c = Math.cos(yaw), sn = Math.sin(yaw), half = r.len / 2;
        foot.push({ x: t.x + c * half, z: t.z - sn * half, hx: half, hz: r.width / 2, yaw }); }
      const objectives = [{ name: 'dock', x: DOCK_BAY.park.x, z: DOCK_BAY.park.z }, { name: 'ramp', x: -4.6, z: -5.0 }, ...WORLD_OBJECTIVES];
      for (const it of v2.items) if (it.state === 'floor' && !it.banked) { const t = it.body.translation(); objectives.push({ name: it.kind, x: t.x, z: t.z }); }
      return pathCheck({ from: { x: s.pos[0], z: s.pos[2] }, objectives, footprints: foot, extra: [{ x: lane[0], z: lane[1], hx: BARRICADE_FOOT.hx, hz: BARRICADE_FOOT.hz, yaw: lane[2] * Math.PI / 180 }] });
    },
    doorDist: () => { const p = chassisG.position; return Math.hypot(p.x - DOCK_BAY.door.x, p.z - DOCK_BAY.door.z); },
    spawnOK: (x, z) => !(inWorld() && W.s.blockedAt(x, z)),
    inDock: () => !!(G.state && G.state.v2.dock.inBay), hoistBusy: () => !!sim.v2.op,
    // her line on the radio: ALWAYS shown as a subtitle (Josh: "Subtitles have to be on, no option to turn them off"); the radio switch
    // is the radio sound on her voice, her voice switch whether she is heard (voice.js, when it is in)
    radio: (line) => { JL.lastLine = line; if (!G.booted) return; $('radio-txt').textContent = line; $('radio').hidden = false; JL.radioT = G.t; if (JL.voice && SET.voice) JL.voice.say(line); },
    // v4: lights_out never where the dark could tip a01 off the ramp or the stairs: not in the ramp's steps of the tutorial, not near the
    // ramp, not by the stairs and the landing, not with a01 off the floor
    lightsOK: () => {
      const s = G.state || sim.state(), p = s.pos;
      if (!tutorial.done && ['push', 'lineup', 'climb'].includes(tutorial.beat.id)) return false;
      if (p[1] > 0.2) return false;
      if (p[0] < -4.6 && p[2] < -2.2) return false;   // the stairs, the landing and the ramp's dock
      if (sim.ramp) { const r = sim.ramp, t = r.body.translation(), q = r.body.rotation(), yaw = 2 * Math.atan2(q.y, q.w), half = r.len / 2;
        if (Math.hypot(t.x + Math.cos(yaw) * half - p[0], t.z - Math.sin(yaw) * half - p[2]) < half + 1.6) return false; }
      return true;
    },
    // v4: chute_drop: the hatch in the hall's ceiling lights up (a second's warning), then each piece falls (juliChutes)
    chute: (c) => { JL.chutes.push(Object.assign({ t0: G.t, dropAt: G.t + 1.0, done: 0 }, c)); audio.clack(0.7); },
    onMove: (c) => juliMove(c),
  };
  $('radio').addEventListener('click', () => { $('radio').hidden = true; });
  function juliSummary(s) {
    const r1 = (v) => Math.round(v * 10) / 10, P = s.pos, v2 = sim.v2, near = [];
    // v4: compact (her 1,024-token context: the prompt and this state must leave room for her answer): the 5 nearest as [kind, x, z, d]
    for (const it of v2.items) if (it.state === 'floor' && !it.banked) { const t = it.body.translation(); near.push([it.kind, r1(t.x), r1(t.z), r1(Math.hypot(t.x - P[0], t.z - P[2]))]); }
    near.sort((a, b) => a[3] - b[3]);
    return { t: Math.round(G.t), tutorial: !tutorial.done, mischief: tutorial.done || tutorial.index >= beatIndex(MISCHIEF_FROM), step: tutorial.beat.id, lightsOut: !!JL.lights, objective: G.obj ? { name: G.obj.name, d: r1(Math.hypot(G.obj.x - P[0], G.obj.z - P[2])) } : null,
      a01: { x: r1(P[0]), z: r1(P[2]), area: areaAt(P[0], P[2]), speed: r1(s.motion.speed), battery: Math.round(s.v2.battery.frac * 100), limp: s.v2.battery.limp, arm: s.v2.arm.state, bin: s.v2.bin, carrying: s.v2.arm.holding },
      trash: near.slice(0, 5), loose: near.length, door: { open: s.v2.door > 0.5 }, bounty: JL.bounty && G.t < JL.bounty.until ? { kind: JL.bounty.kind, roms: JL.bounty.roms } : null,
      roms: progress.roms, barricades: [...v2.obstacles.keys()], spills: s.v2.spills.length, recent: (JL.recent || []).slice(-3), world: inWorld() ? W.s.summary() : null };
  }
  // Juli's model (E2B, hundreds of MB, half of it in the app's second process) never loads with the game: Play queues her, and she
  // starts at the first real input or after JULI_IDLE_S seconds of play, and only once no model is loading (the world's wait for her
  // in turn: world_view.js's load gate)
  const JULI_IDLE_S = 8;
  /** v4: her guard rails, one set for her live AND her planned moves (one rate limit): made at Play, her live model joins them later */
  function rails() { return JL.juli || (JL.juli = createJuli({ backend: null, mode: 'mischief', world: juliWorld })); }
  /** v4: the plan the Bigger brain wrote for this shift in the loading screen (plan.js, plot.js): read once, its moves fired when their
   *  triggers come true, each one through the same guard rails at that moment (a refused one waits and tries again for 30 s) */
  function startPlan(force = false) {
    if (JL.plan || (!SET.juli && !force)) return;
    let rec = null; try { rec = loadPlan(localStorage, Date.now(), planLists()); } catch (e) { rec = null; }
    if (!rec || !rec.plan) return;
    try { consumePlan(localStorage); } catch (e) { /* */ }
    rails(); JL.planRec = rec; JL.planEv = [];
    JL.plan = createPlanRunner({ plan: rec.plan, now: () => G.t, apply: (c) => (c.call === 'stack' ? stack.applyCall({ call: c.args && c.args.tool, args: c.args || {}, say: c.say }, { source: 'plan' }) : rails().apply(c, juliSummary(G.state || sim.state()), G.t)),
      onFire: (c, line) => { if (line) juliWorld.radio(line); if (c.call !== 'say' && c.call !== 'pass' && c.call !== 'stack') juliMove(c); } });
  }
  function planTick(s) {
    if (!JL.plan && !JL.areaPlan) return;
    const ev = (JL.planEv || []).splice(0), st = { t: G.t, step: tutorial.done ? null : tutorial.beat.id, area: areaAt(s.pos[0], s.pos[2]), binned: G.binned || 0, stack: JL.stackH || 0, day: W.s && W.s.active ? W.s.state().day : 1, events: ev };
    if (JL.plan) JL.plan.tick(st);
    if (JL.areaPlan) JL.areaPlan.tick(Object.assign({}, st, { events: ev.slice() }));
  }

  // ---- v4 (Josh, Nov 2): "there can be a loading screen between areas so that memory use is lower but if being chased by leeches then
  // leeches spawn in random locations within the new area loading to"; "Juli should do the work during those loading screens". In the
  // open world only one zone's models are loaded: the dock (the hall, its yard and the plaza), the park, the dead forest or the metro.
  // Crossing into another zone (0.8 m past its edge) holds the game behind a loading screen: the zone left lets go of its models, the
  // zone entered loads its own, the leeches chasing a01 come down at random clear points of the new zone, and Juli (her live model,
  // E2B) writes her plan for the zone in the same closed schema, fired through the same rails.
  const zsleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // v4 (Nov 3): the play trail's entry (trail.js): where a01 is, what loads, the page's memory, her helper's, Juli's state, the last event
  JL.last = 'started';
  function trail(ev, last = null) {
    if (last) JL.last = last;
    try {
      const st0 = G.state || sim.state(), b = JL.backend, ms = MEM.installed ? MEM.snapshot() : null;
      // (v4, Nov 3: what the page's memory is made of: textures, the screen's drawing buffer, 2D canvases, decoded pictures, buffers)
      TR.mark(ev, { zone: Z.on ? Z.cur : tutorial.done ? null : 'hall (Level 1)', area: areaAt(st0.pos[0], st0.pos[2]), loading: CR.inflight(), pageMB: ms ? gameMB(ms) : null,
        mem: ms ? { tex: ms.texMB, draw: ms.drawMB, cnv: ms.canvasMB, img: ms.imagesMB, buf: ms.bufMB + ms.rbMB } : null,
        helperMB: JL.helperMB != null ? JL.helperMB : null, helper: !b ? 'none' : b.gone && b.gone() ? 'gone' : b.busy && b.busy() ? 'busy' : 'alive', hb: b && b.hbAge ? b.hbAge() : null,
        juli: JL.status, model: JL.model || null, last: JL.last, day: inWorld() ? W.s.state().day : null });
    } catch (e) { /* the trail is best effort */ }
  }
  const memNow = () => (MEM.installed ? gameMB(MEM.snapshot()) : null);
  const ZONE_OF = { hall: 'dock', yard: 'dock', plaza: 'dock', park: 'park', forest: 'forest', metro: 'metro' };
  const ZONE_AREAS = { dock: ['yard', 'plaza'], park: ['park'], forest: ['forest'], metro: ['metro'] };   // world_view's areas a zone loads
  const ZONE_Q = Object.fromEntries(QUADS.map((q) => [q.id, q])), ZONE_NAME = { dock: 'THE DOCK', park: 'THE PARK', forest: 'THE DEAD FOREST', metro: 'THE METRO' };
  const Z = { on: false, cur: 'dock', busy: false, pend: null, since: 0, shifts: 0, log: [] };
  // the screen styles itself through the CSSOM (the game's CSP allows no inline <style>)
  const zoneEl = (() => {
    const d = document.createElement('div'); d.id = 'zone-load'; d.setAttribute('aria-live', 'polite');
    Object.assign(d.style, { position: 'fixed', inset: '0', zIndex: '60', display: 'none', placeItems: 'center', padding: '16px', textAlign: 'center', color: '#e8f6ff',
      background: 'radial-gradient(circle at 50% 42%, rgba(46,18,56,.94), rgba(7,5,11,.98))', font: '600 15px/1.35 system-ui, sans-serif' });
    const box = document.createElement('div'), mk = (tag, cls, st) => { const e = document.createElement(tag); e.className = cls; Object.assign(e.style, st); box.append(e); return e; };
    mk('p', 'zl-kick', { margin: '0', fontSize: '11px', letterSpacing: '.32em', opacity: '.7' }).textContent = 'ENTERING';
    const name = mk('h2', 'zl-name', { margin: '.25em 0 .3em', fontSize: '30px', letterSpacing: '.06em', textShadow: '0 0 18px currentColor' });
    const sub = mk('p', 'zl-sub', { margin: '0', opacity: '.75', fontSize: '13px' });
    const juli = mk('p', 'zl-juli', { margin: '1.1em auto 0', maxWidth: '30ch', color: '#ff3ea5', textShadow: '0 0 10px rgba(255,62,165,.6)', display: 'none' });
    d.append(box); document.body.append(d);
    return { el: d, name, sub, juli, show: (on) => { d.style.display = on ? 'grid' : 'none'; }, get up() { return d.style.display !== 'none'; },
      line: (t) => { juli.textContent = t || ''; juli.style.display = t ? 'block' : 'none'; }, get hasLine() { return juli.style.display !== 'none'; } };
  })();
  const zoneOf = (x, z) => ZONE_OF[areaAt(x, z)] || null;
  /** the zone a01 is in, with a 0.8 m band at every edge (no screen flickering along a border) -> the zone, or null on a border */
  function zoneHere(P) {
    const z = zoneOf(P[0], P[2]); if (!z) return null;
    for (const [dx, dz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) { const o = zoneOf(P[0] + dx, P[2] + dz); if (o && o !== z) return null; }
    return z;
  }
  function zoneTick(s) {
    if (!inWorld() || bench) { if (Z.on) { Z.on = false; world.setZones(null); } return; }
    if (!Z.on) {   // the open world begins (or a saved day): only the zone a01 is in
      Z.on = true; Z.cur = zoneOf(s.pos[0], s.pos[2]) || 'dock';
      world.setZones((id) => ZONE_AREAS[Z.cur].includes(id));
      for (const id of Object.keys(world.areas)) if (!ZONE_AREAS[Z.cur].includes(id)) world.unloadArea(id);
      return;
    }
    if (Z.busy) return;
    const z = zoneHere(s.pos);
    if (!z || z === Z.cur) { Z.pend = null; return; }
    if (Z.pend !== z) { Z.pend = z; Z.since = G.t; return; }
    if (G.t - Z.since >= 0.3) shiftZone(z);
  }
  async function shiftZone(to) {
    const from = Z.cur, t0 = performance.now(), a = W.s.a01();
    const chaseIds = W.s.leeches.filter((L) => L.state === 'crawl' && Math.hypot(L.x - a.x, L.z - a.z) <= 12).map((L) => L.id), chasing = chaseIds.length;
    Z.busy = true; G.zoneHold = true; Z.pend = null; Z.shifts++;
    const q = ZONE_Q[to === 'dock' ? 'dock' : to];
    zoneEl.name.textContent = ZONE_NAME[to]; zoneEl.name.style.color = q ? q.color : '#38f3ff';
    zoneEl.sub.textContent = JL.backend ? 'Loading… Juli is plotting it' : 'Loading…';
    zoneEl.line(''); zoneEl.show(true); CR.stage('zone:' + to);
    const pageBefore = memNow(); let pageMid = null, pagePeak = 0; trail('zone', `entering ${to} from ${from}`);
    try {
      Z.cur = to;
      for (const id of Object.keys(world.areas)) if (!ZONE_AREAS[to].includes(id)) world.unloadArea(id);   // every other zone lets go first (never two zones' models at once)
      await zsleep(60); pageMid = memNow();
      const plan = juliAreaPlan(to, (line) => { if (zoneEl.up) zoneEl.line('JULI · ' + line); });
      await zsleep(30);
      // (v4, Nov 3: one model at a time: the decoded pictures of a whole zone loading at once were a peak right at the change)
      const loads = Promise.all(ZONE_AREAS[to].map((id) => world.loadArea(id, { serial: true })));
      for (let w = 0; w < 120 && (assets.busy() > 0 || !loads.done); w++) { const m = memNow(); if (m != null) pagePeak = Math.max(pagePeak, m); if (await Promise.race([loads.then(() => true), zsleep(100).then(() => false)]) && assets.busy() === 0) break; }   // its models (at most 12 s; a slow one finishes behind the game)
      let moved = [];
      if (chasing && q) moved = W.s.relocateLeeches({ x0: Math.max(q.x0, WORLD.x0), x1: Math.min(q.x1, WORLD.x1), z0: Math.max(q.z0, WORLD.z0), z1: Math.min(q.z1, WORLD.z1) }, { ids: chaseIds, avoid: (x, z) => areaAt(x, z) === 'hall' || zoneOf(x, z) !== to });
      const left = 900 - (performance.now() - t0); if (left > 0) await zsleep(left);   // the screen long enough to read
      if (zoneEl.hasLine) await zsleep(1400);   // her line, a moment to read it
      const pageAfter = memNow();
      Z.log.push({ from, to, ms: Math.round(performance.now() - t0), chasing, moved: moved.length, minD: moved.length ? +Math.min(...moved.map((m) => m.d)).toFixed(2) : null, pageBefore, pageMid, pagePeak: pagePeak || null, pageAfter }); if (Z.log.length > 12) Z.log.shift();
      trail('zone', `entered ${to} in ${Math.round(performance.now() - t0)} ms (page ${pageBefore} → ${pageMid} → peak ${pagePeak || '?'} → ${pageAfter} MB)`);
    } finally {
      zoneEl.show(false); G.zoneHold = false; G.last = 0; Z.busy = false; CR.stage('play');
      if (JL.juli && JL.juli.nudge) JL.juli.nudge(G.t, 2);
      toast(ZONE_NAME[to], '', 1600);
    }
  }
  /** her plan for the zone a01 enters: her live model (the one in the game), the plot's closed schema, the zone's spawn points and lanes,
   *  at most 3 intents; her live turns wait while she writes it. onLine(mood) = her line, for the loading screen. Never blocks the game */
  async function juliAreaPlan(zone, onLine) {
    const b = JL.backend; if (!b || (b.ready && !b.ready()) || JL.areaBusy) return null;
    JL.areaBusy = true; JL.holdTurns = true;
    try {
      const st = W.s.state(), lists = planLists({ triggers: ['after_s', 'binned', 'event'], areas: ZONE_AREAS[zone] });
      const session = { at: `a01 is entering ${ZONE_NAME[zone].toLowerCase()}: plan your mischief and obstacles there (at most 3)`, tutorial: false, area: ZONE_AREAS[zone][0], day: st.day, night: st.night, roms: progress.roms };
      const P = plotPrompt(session, lists);
      const r = await Promise.race([b.decide({ system: P.system, user: P.user, maxTokens: 200 }), zsleep(30000).then(() => null)]).catch(() => null);
      const pp = r && parsePlan(r.text), v = pp && validatePlan(pp, lists);
      if (!v || !v.ok) { Z.log.push({ plan: zone, ok: false, why: v ? (v.errors || []).slice(0, 2).join('; ') : 'no answer' }); return null; }
      v.plan.intents = v.plan.intents.slice(0, 3);
      if (v.plan.mood) { onLine(v.plan.mood); juliWorld.radio(v.plan.mood); }
      rails(); if (!JL.planEv) JL.planEv = [];
      JL.areaPlan = createPlanRunner({ plan: v.plan, now: () => G.t, apply: (c) => rails().apply(c, juliSummary(G.state || sim.state()), G.t),
        onFire: (c, line) => { if (line) juliWorld.radio(line); if (c.call !== 'say' && c.call !== 'pass') juliMove(c); } });
      Z.log.push({ plan: zone, ok: true, intents: v.plan.intents.length, mood: v.plan.mood || '' });
      return v.plan;
    } catch (e) { return null; }
    finally { JL.areaBusy = false; JL.holdTurns = false; }
  }
  function queueJuli() {
    startPlan();
    if (JL.backend || JL.status === 'starting' || JL.status === 'waiting') return;
    if (!SET.juli && !(TEST && Q.get('julifake'))) { JL.status = 'off'; return; }
    JL.status = 'waiting'; JL.notBefore = G.t + JULI_IDLE_S;
  }
  // v4 (Nov 3: Josh's phone bench: the Bigger brain live ended the page at 80 % of its load, 3 s after its plot's helper had closed): a
  // closed model's GPU memory comes back late on WebKit and the reload is the same process. On a phone, Juli's first load waits until
  // PLOT_SETTLE_MS after the loading screen's plot closed the Bigger brain (its record's time is written after the close)
  const PLOT_SETTLE_MS = 60000;
  const plotClosedAt = (() => { try { const r = lastPlan(localStorage); return r && r.t && Date.now() - r.t < PLOT_SETTLE_MS && r.t <= Date.now() ? r.t : null; } catch (e) { return null; } })();
  function juliMaybe() {
    if (JL.status !== 'waiting' || !G.booted || !(G.input || G.t >= JL.notBefore) || assets.busy() > 0 || CR.inflight().length || JL.storeHold) return;   // (v4: never as the store opens)
    if (LOWMEM && (!TEST || Q.has('plotsettle')) && plotClosedAt && Date.now() - plotClosedAt < PLOT_SETTLE_MS) { if (!JL.plotWaitMarked) { JL.plotWaitMarked = true; trail('load', `Juli: waiting for the Bigger brain's memory (its plot closed ${Math.round((Date.now() - plotClosedAt) / 1000)} s ago)`); } return; }
    JL.status = 'starting'; JL.startedAt = G.t; CR.begin('juli:load');
    Promise.resolve(startJuli()).catch(() => { JL.status = 'offline'; }).finally(() => CR.end('juli:load'));
  }
  async function startJuli() {
    const fake = TEST && Q.get('julifake');
    if (!SET.juli && !fake) { JL.status = 'off'; return; }
    let backend = null;
    if (fake) backend = fakeBackend(fake);
    else {
      const model = 'e2b';   // (v4, Troll-E v1: always her own model live; the Bigger brain only plots, in the loading screen)
      try {
        trail('load', `Juli loading (${model}, layers 0-${GAME_SPLIT[model] - 1} in the helper)`);
        const r = await connectJuli({ model, splitAt: GAME_SPLIT[model], snapshot: snapshotOn(), onStatus: (w) => { JL.why = w; }, onGone: (code) => juliGone(code) });   // (v4, Nov 3: her kept prompt behind its switch)
        trail('load', r.ok ? `Juli online (page ${r.load.pageMB} + helper ${r.load.helperMB} MB)` : `Juli offline: ${String(r.why || '').slice(0, 60)}`);
        if (r.ok) { backend = r.backend; JL.model = model; JL.why = r.split ? `two processes · layers 0-${r.load.at - 1} in the helper` : ''; } else JL.why = r.why || 'unavailable';
      } catch (e) { JL.why = String((e && e.message) || e).slice(0, 80); }
    }
    if (!backend) { JL.status = 'offline'; return; }
    JL.backend = backend; rails().setBackend(backend, {}); JL.status = 'online';
    // v4 (Nov 3): her prompt's fixed start read in now and kept in her helper (the engine's prefix snapshot): her turns read in only her state
    if (backend.warm) backend.warm(systemPrompt(JL.juli ? JL.juli.mode : 'mischief', { tutorial: !tutorial.done })).then((sn) => { JL.warm = sn; }, () => {});
  }
  /** v4: her second process ended (iOS ends it first when the page grows) or her GPU went: she is offline, the game goes on, nothing waits */
  function juliGone(code) {
    JL.status = 'offline'; JL.why = 'her second process ended (' + code + ')'; JL.goneAt = G.t; JL.gones = (JL.gones || 0) + 1; trail('gone', `her helper ended: ${code}`);
    if (G.booted) toast('Juli went quiet: her part of the phone’s memory was taken back. The game goes on.', '', 3600);
  }
  /** v4: ONE retry, a minute later, only while nothing loads and the game is inside its page budget; a second end leaves her offline */
  const REVIVE_S = 60;
  function juliRevive() {
    if (JL.goneAt == null || JL.reviveTried || !JL.backend || !JL.backend.revive || G.t - JL.goneAt < REVIVE_S || document.hidden || JL.storeHold) return;
    if (assets.busy() > 0 || CR.inflight().length) return;
    const m = MEM.installed ? gameMB(MEM.snapshot()) : null; if (m != null && m > GAME_BUDGET_MB) return;
    // v4 (Nov 2): her ladder: her retry on fewer layers in the helper (0-12) where the page has room for its share; else the same layout
    // on a fresh engine; a second end leaves her offline (the toast said so)
    const mdl = JL.backend.model || 'e2b', at2 = REVIVE_AT[mdl], share = at2 && GAME_PAGE_MB[mdl] ? GAME_PAGE_MB[mdl][at2] : null;
    const fits = share != null && m != null && m + share + PAGE.webkitMB + PAGE.marginMB <= PAGE.ceilingMB;
    trail('load', 'Juli: trying once more'); JL.reviveTried = true; JL.status = 'starting'; JL.why = fits ? `trying once more (layers 0-${at2 - 1} in the helper)` : 'trying once more'; CR.begin('juli:load');
    JL.backend.revive(fits ? { splitAt: at2 } : {}).then((ok) => { JL.status = ok ? 'online' : 'offline'; JL.why = ok ? 'back after her second process ended' : 'offline for this session'; if (ok) JL.goneAt = null; })
      .catch(() => { JL.status = 'offline'; JL.why = 'offline for this session'; }).finally(() => CR.end('juli:load'));
  }
  /** v4: the stack game: it starts as the grab step is done (once a run), Juli's challenge on the HUD; while it is on her turns are the
   *  mini game's (its own short prompt: stack.js) and her tools warn before they act; a win pays ROMs */
  /** v4 (Nov 3; Josh's loading-screen idea): the stack arena is its own area behind a loading screen: every world area lets go of its
   *  models first, then the arena (on Josh's phone her helper ended in the stack game). The desk skips the screen's wait */
  async function stackScreen() {
    const show = !TEST;
    zoneEl.name.textContent = 'JULI’S CHALLENGE'; zoneEl.name.style.color = '#ff3ea5'; zoneEl.sub.textContent = 'Setting up the stack…'; zoneEl.line('');
    if (show) { zoneEl.show(true); G.zoneHold = true; }
    trail('screen', 'the stack game’s loading screen');
    try {
      for (const id of Object.keys(world.areas)) world.unloadArea(id);
      for (let w = 0; w < 40 && assets.busy() > 0; w++) await zsleep(100);
      if (show) await zsleep(900);
    } finally { if (show) { zoneEl.show(false); G.zoneHold = false; G.last = 0; } }
  }
  function startStack() {
    G.stackOffered = true;
    stackScreen().then(() => startStackNow(), () => startStackNow());
  }
  function startStackNow() {
    const r = stack.start({ stock: true }); if (!r.ok) return; STK.on = true;
    if (JL.juli && JL.juli.state.tease) { events.post({ type: 'door', id: 'dock', open: true }, 'juli'); JL.juli.state.tease = null; }   // no shutter tease left over
    toast(`Juli's challenge: stack ${STACK_TARGET.levels} cans ${STACK_TARGET.height} m high on the pad by the start, and hold them ${STACK_TARGET.holdS} s.`, 'rom', 5200);
    relink();
  }
  /** the arena goes (the game over and her last word said, or a new run): her mischief turns come back */
  function stopStack() { if (!STK.on && stack.phase !== 'on') return; try { stack.remove(); } catch (e) { /* gone already */ } STK.on = false; JL.stackTurns = null; JL.stackEnded = null; relink(); }
  function stackTick() {
    const h = stack.hud(); JL.stackH = h.levels || 0;
    if (JL.backend && !JL.stackTurns) JL.stackTurns = createStackTurns({ backend: JL.backend, game: stack, radio: (l) => juliWorld.radio(l) });
    if (JL.stackTurns && !JL.stackTurns.done) JL.stackTurns.tick(G.t);
    for (const e of stack.takeEvents()) {
      (JL.stackLog ||= []).push(e); if (JL.stackLog.length > 200) JL.stackLog.shift();
      if (e.type === 'stackTool' && e.phase === 'warn') { juliMove({ call: 'stack', args: { kind: 'stack_' + e.tool } }); audio.clack(0.9); }
      else if (e.type === 'stackTool' && e.phase === 'fire') audio.thump(0.5);
      else if (e.type === 'stackToppled') toast('Toppled! Stack them again.', 'bad', 2400);
      else if (e.type === 'stackWon') { progress.earn(e.roms); G.runRoms += e.roms; audio.chime(e.roms); toast(`Stack held ${STACK_TARGET.holdS} s: +${e.roms} ${romWord(e.roms)}. Now the diesel can.`, 'rom', 4200); (JL.planEv ||= []).push('stack:won'); }
      else if (e.type === 'stackLost') toast(e.why === 'time' ? 'Time is up on Juli\'s challenge. On with the tutorial.' : 'Juli\'s challenge is over. On with the tutorial.', '', 3600);
    }
    if (stack.phase !== 'on' && (!JL.stackTurns || JL.stackTurns.done || !JL.backend) && !JL.stackEnded) { JL.stackEnded = G.t; }
    if (JL.stackEnded && G.t - JL.stackEnded > 8) stopStack();   // the arena goes; the tutorial goes on
  }
  function stackHud() {
    let el = $('stack-chip'); if (!el) { el = document.createElement('span'); el.id = 'stack-chip'; el.className = 'chip bounty stack-chip'; $('status').append(el); }
    if (!STK.on) { el.hidden = true; return; }
    const h = stack.hud(); el.hidden = false;
    // v4 (Nov 3, Josh: "a small inline counter"): the levels, the hold while it counts, the time left only in its last 30 s (her tools are named in the message area)
    el.textContent = h.on ? `STACK ${h.levels}/${h.target}${h.hold > 0 ? ` · HOLD ${h.hold.toFixed(1)} s` : h.timeLeft <= 30 ? ` · ${Math.ceil(h.timeLeft)} s` : ''}`
      : h.result === 'won' ? 'STACK HELD' : 'STACK OVER';
  }
  /** v4: her move, shown as hers: a chip naming it (her radio line is her own, on the radio) and a sting */
  const MOVE_NAMES = { stack_vent: 'THE VENT, IN A MOMENT', stack_plate: 'THE PLATE, IN A MOMENT', stack_roller: 'A CAN FROM THE CHUTE, IN A MOMENT', stack_sweeper: 'THE SWEEPER, IN A MOMENT', spawn_trash: 'NEW TRASH', bounty: 'BOUNTY', sign_flicker: 'SIGN FLICKER', sign_color: 'SIGN COLOUR', sting: 'STING', barricade_nudge: 'BARRICADE IN THE LANE', shutter_tease: 'DOCK SHUTTER DOWN', lights_out: 'LIGHTS OUT', chute_drop: 'TRASH FROM THE CHUTE' };
  const moveChip = (() => { const e = document.createElement('span'); e.id = 'juli-move'; e.className = 'chip bounty juli-move'; e.hidden = true; $('status').append(e); return e; })();
  // v4 (HUD): the objective shows once as it changes, then folds into the compass chip (a tap opens it); Juli's move chip sits over her radio line
  const navChip = createObjectiveChip({ root: $('nav'), now: () => G.t * 1000 });   // (the game's clock: a new objective settles in play time)
  createComms({ root: $('comms'), radio: $('radio'), move: moveChip, toast: $('toast'), speaking: () => voice.speaking });   // v4 (Nov 3): the one message area (hud_ui.js); her subtitle stays while she is still saying it
  function juliMove(c) {
    const a = c.args || {}, k = c.call === 'prank' || c.call === 'stack' ? a.kind : c.call;
    if (!MOVE_NAMES[k]) return;
    moveChip.textContent = 'JULI · ' + MOVE_NAMES[k] + (k === 'chute_drop' ? ` ×${a.count || 1}` : k === 'lights_out' ? ` ${a.seconds || 6} s` : k === 'spawn_trash' ? ` · ${String(a.at || '')}` : '');
    moveChip.hidden = false; JL.moveT = G.t; (JL.moves ||= []).push({ t: Math.round(G.t), k });
    if (k !== 'sting' && !/^stack_/.test(k)) audio.sting && audio.sting();
  }
  /** v4: the chute's warning (its hatch glows in the ceiling for a second), then the pieces fall one after another; never onto a01 */
  const hatch = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff3ea5', transparent: true, opacity: 0.9, toneMapped: false }));
  hatch.visible = false; scene.add(hatch);
  function juliChutes() {
    let show = null;
    for (const c of JL.chutes) {
      if (c.done >= c.n || G.t - c.t0 > 8) continue;
      show = c;
      if (G.t < c.dropAt) continue;
      const P = G.state ? G.state.pos : [0, 0, 0];
      if (Math.hypot(P[0] - c.x, P[2] - c.z) < 1.5) { c.dropAt = G.t + 0.4; continue; }   // a01 rolled under it: the next piece waits
      const j = c.done, ox = [0, 0.14, -0.12][j % 3], oz = [0, -0.1, 0.13][j % 3];
      events.post({ type: 'spawnTrash', kind: c.kind, x: c.x + ox, z: c.z + oz, y: 2.05, yawDeg: Math.round(Math.random() * 180), spin: [Math.random() * 4 - 2, Math.random() * 2 - 1, Math.random() * 4 - 2] }, 'juli');
      c.done++; c.dropAt = G.t + 0.35; audio.clack(0.5);
    }
    JL.chutes = JL.chutes.filter((c) => c.done < c.n && G.t - c.t0 <= 8);
    hatch.visible = !!show; if (show) { hatch.position.set(show.x, ROOM.height - 0.02, show.z); hatch.material.opacity = G.t < show.dropAt ? 0.55 + 0.4 * Math.sin(G.t * 22) : 0.9; }
  }
  /** v4: lights_out: the hall's strips flicker and die (the neon stays lit), a01's headlamp comes on, then they flicker back */
  let LR = null;
  function juliLights() {
    const L = JL.lights; if (!L) return;
    if (!LR) LR = { hemi: scene.children.find((o) => o.isHemisphereLight), coves: scene.children.filter((o) => o.isPointLight && o.color.getHexString() === 'dbe9e0'), key: view.key };
    if (!L.saved) L.saved = { hemi: LR.hemi ? LR.hemi.intensity : 0, key: LR.key.intensity, coves: LR.coves.map((l) => l.intensity), env: scene.environmentIntensity };
    const S = L.saved, d = G.t - L.t0, back = G.t > L.until;
    if (G.t > L.until + 0.7) { if (LR.hemi) LR.hemi.intensity = S.hemi; LR.key.intensity = S.key; LR.coves.forEach((l, i) => { l.intensity = S.coves[i]; }); scene.environmentIntensity = S.env; if (W.view && W.view.head) W.view.head.intensity = 0; JL.lights = null; return; }
    const f = back ? (Math.random() < 0.6 ? 1 : 0.2) : d < 0.5 ? (Math.random() < 0.5 ? 0.2 : 1) : 0.08;
    if (LR.hemi) LR.hemi.intensity = S.hemi * Math.max(0.14, f); LR.key.intensity = S.key * Math.max(0.1, f); LR.coves.forEach((l, i) => { l.intensity = S.coves[i] * f; });
    scene.environmentIntensity = S.env * Math.max(0.12, f);
    if (W.view && W.view.head) W.view.head.intensity = f < 0.5 ? 9 : 0;
  }
  // the probe: frame times (current and 1 % low), Juli's latency, her last call, memory, frames while she thinks
  const PR = { ft: [], thinkFt: [], idleFt: [], t: 0 };
  function probeFrame(ms) {
    PR.ft.push(ms); if (PR.ft.length > 600) PR.ft.shift();
    (JL.juli && JL.juli.stats.thinking ? PR.thinkFt : PR.idleFt).push(ms); if (PR.thinkFt.length > 300) PR.thinkFt.shift(); if (PR.idleFt.length > 300) PR.idleFt.shift();
    if (G.onFrame) G.onFrame(ms, !!(JL.juli && JL.juli.stats.thinking));   // v4: the bench's frame times
    probeRender();
  }
  function probeRender() {
    if (!SET.probe || Math.abs(G.t - PR.t) < 0.25) return; PR.t = G.t;
    const fps = (a) => (a.length ? 1000 / (a.reduce((x, y) => x + y, 0) / a.length) : 0), low = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => y - x); return 1000 / b[Math.floor(b.length * 0.01)]; };
    const st = JL.juli ? JL.juli.stats : null, mem = JL.backend && JL.backend.memory ? JL.backend.memory() : null;
    $('probe').textContent = [`FPS ${fps(PR.ft.slice(-60)).toFixed(0)}  1% low ${low(PR.ft).toFixed(0)}${Qy.half || Qy.juliHalf ? '  (30 fps)' : ''}`,
      `Juli ${JL.status}${JL.why ? ' · ' + JL.why : ''}`,
      st ? `read ${st.prefillMs.toFixed(0)} ms · gen ${st.genMs.toFixed(0)} ms · all ${st.totalMs.toFixed(0)} ms` : '',
      st ? `calls ${st.calls} ok ${st.applied} ✗${st.refused} pass ${st.passes} slow ${st.timeouts} junk ${st.garbled}` : '',
      st ? `last: ${(st.lastCall || '—').slice(0, 60)}` : '', mem ? `mem: ${mem}` : 'mem: n/a', MEM.installed ? memLine(MEM.snapshot()) + ` / ${GAME_BUDGET_MB} budget` : '',
      JL.plan ? `plan: ${JL.plan.stats.fired} fired · ${JL.plan.stats.waiting + JL.plan.stats.pending} to come · ${JL.plan.stats.expired} refused` : '',
      `thinking ${fps(PR.thinkFt).toFixed(0)} fps · idle ${fps(PR.idleFt).toFixed(0)} fps`].filter(Boolean).join('\n');
  }
  function juliFrame() {
    for (const [name, fx] of JL.signFx) {
      const sg = fx.sg;
      if (G.t > fx.until) { if (sg.orig && sg.orig.color && sg.mat) sg.mat.color.copy(sg.orig.color); if (sg.orig && sg.orig.light && sg.light) sg.light.color.copy(sg.orig.light); JL.signFx.delete(name); continue; }
      if (fx.kind === 'sign_color' && sg.mat && sg.mat.color) { sg.mat.color.set(fx.color); if (sg.light) sg.light.color.set(fx.color); }
      if (fx.kind === 'sign_flicker' && sg.light) sg.light.intensity *= Math.random() < 0.5 ? 0.05 : 1.4;
      if (fx.kind === 'sign_flicker' && sg.mat && sg.mat.color && sg.orig && sg.orig.color) sg.mat.color.copy(sg.orig.color).multiplyScalar(Math.random() < 0.45 ? 0.08 : 1);
    }
    if (!$('radio').hidden && G.t - JL.radioT > 6 && !voice.speaking) $('radio').hidden = true;   // (v4: not while she is still saying it)
    if (!moveChip.hidden && G.t - JL.moveT > 4) moveChip.hidden = true;
  }

  // ---- sizing and quality: draw at up to 2x, down to 1x if frames run long, then cheaper neon, then every other frame (30 fps)
  const Qy = { pr: Math.min(globalThis.devicePixelRatio || 1, 2), min: 1, ema: 16.7, slowFor: 0, fastFor: 0, half: false, odd: false, neonLow: false };
  if (DESK_LOW) Qy.pr = 1;
  function resize() { view.resize(innerWidth, innerHeight, Qy.pr); controls.rest(); }
  addEventListener('resize', resize); resize();
  function adapt(frameMs, dt) {
    Qy.ema += (frameMs - Qy.ema) * 0.05;
    if (Qy.ema > 19) { Qy.slowFor += dt; Qy.fastFor = 0; } else if (Qy.ema < 13) { Qy.fastFor += dt; Qy.slowFor = 0; } else { Qy.slowFor = 0; Qy.fastFor = 0; }
    if (Qy.slowFor > 2) {
      Qy.slowFor = 0;
      if (Qy.pr > Qy.min + 0.01) { Qy.pr = Math.max(Qy.min, Qy.pr * 0.85); resize(); }
      else if (view.key.shadow.mapSize.x > 1024) { view.key.shadow.mapSize.set(1024, 1024); view.key.shadow.map && view.key.shadow.map.dispose(); view.key.shadow.map = null; }
      else if (!Qy.neonLow && view.setNeonQuality) { Qy.neonLow = true; view.setNeonQuality('low'); }
      else if (!Qy.worldLow) { Qy.worldLow = true; world.setQuality('low'); }   // the world's small things and props drawn nearer only
      else Qy.half = true;
    }
    if (Qy.fastFor > 6 && !TEST) { Qy.fastFor = 0; if (Qy.half) Qy.half = false; else if (Qy.pr < Math.min(globalThis.devicePixelRatio || 1, 2) - 0.01) { Qy.pr = Math.min(Math.min(globalThis.devicePixelRatio || 1, 2), Qy.pr / 0.85); resize(); } }
  }

  // ---- one physics step (the world changes queued in events.js first), its events, the tutorial
  const STRUCT = new Set(['spawn', 'arm', 'kit', 'trashSpawned', 'trashRemoved', 'obstacle', 'pickups', 'pickup', 'fault']);   // bodies came or went
  const trackIn = [0, 1, 2, 3].map((id) => ({ id, x: 0, z: 0, mud: false, onGround: false }));
  function step(inp) {
    for (const cmd of events.drain()) sim.apply(cmd);
    for (const l of links) l.a.set(l.b);
    let ev;
    if (inWorld()) ev = W.s.step(inp);   // its pre-step (the leeches, the gates), the physics, its after-step (stowing, power, leeches, death)
    else { sim.step(inp); ev = sim.takeEvents(); }
    if (STK.on) stack.update();   // v4: the stack game's rules (its height, the hold, her tools' warnings and acts)
    // a01's tyres in the mud leave prints, sampled by the distance each rolls (tracks.js), every step
    const TW = sim.trolley.wheels;
    for (let i = 0; i < TW.length && i < 4; i++) { const w = TW[i], p = w.body.translation(), r = trackIn[i]; r.x = p.x; r.z = p.z; r.mud = w.ground === 'mud' && !w.puddle; r.onGround = !!w.onGround; }
    world.addTracks(trackIn);
    if (ev.some((e) => STRUCT.has(e.type))) relink();   // never read a body that has just been removed (Rapier would panic)
    else for (const l of links) read(l.body, l.b);
    G.events.push(...ev);
    G.steps++;
    return ev;
  }
  function inputNow() {
    if (!G.booted) return { x: 0, y: 0, hold: false, mode: null };
    if (G.pilot) return G.pilot(G.state || sim.state(), G.t);   // v4: the bench's pilot drives
    const o = controls.out;
    if (tutorial.beat.id === 'boot') {   // the self-test: the modules swing out to SPIN and back
      const tb = G.t - G.boot; controls.set({ mode: null }); return { x: 0, y: 0, hold: false, mode: tb < 1.0 ? 'spin' : 'drive' };
    }
    if (!$('slots').hidden) return { x: 0, y: 0, hold: true, mode: null };   // the slot menu is open: parked
    return { x: o.x, y: o.y, hold: o.hold, mode: o.mode };
  }

  // ---- the frame
  const tmpF = new THREE.Vector3();
  function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = G.last ? Math.min(0.1, (now - G.last) / 1000) : 1 / 60; G.last = now;
    if (G.paused || G.zoneHold || document.hidden) return;   // (v4: the area loading screen holds the game)
    if (G.bubble) { render(1, dtReal); return; }   // v5: the collect bubble pauses the game
    const w0 = performance.now();
    G.acc += dtReal; let n = 0;
    while (G.acc >= DT && n < 3) { step(inputNow()); G.acc -= DT; n++; G.t += DT; }
    if (n === 3 && G.acc > DT) G.acc = 0;   // a long stall: drop the backlog rather than run slow-motion catch-up
    if (n) afterSteps();
    if (G.storeStop) { storeStopped(); return; }   // (v4: the store open: the physics steps, nothing is drawn, the quality left as it is)
    Qy.juliHalf = !!(JL.juli && JL.juli.stats.thinking && Qy.ema > 20);   // Juli generating and frames running long: 30 fps until she is done
    if ((Qy.half || Qy.juliHalf) && (Qy.odd = !Qy.odd)) return;
    render(clamp(G.acc / DT, 0, 1), dtReal); probeFrame(dtReal * 1000);
    G.frames++;
    adapt(performance.now() - w0 + (dtReal * 1000 > 20 ? dtReal * 1000 - 16.7 : 0), dtReal);
  }
  /** v4 (Nov 3): the store open: nothing is drawn (its first skipped frame goes in the play trail) */
  function storeStopped() { if (!G.storeStopMarked) { G.storeStopMarked = true; trail('store', 'the store 3/4: the 3D drawing stopped'); } }
  function render(alpha, dt) {
    if (G.storeStop) { storeStopped(); return; }
    if (W.ui && W.ui.bubble) { W.view.bubbleRender(dt, innerWidth, innerHeight); return; }   // the collect bubble: its turntable, the game paused behind it
    draw(alpha); follow(dt); lights(); view.tick && view.tick(G.t, dt); juliFrame(); compassFrame();
    if (W.view) W.view.update(W.s, G.t, dt, camera, alpha);
    juliLights();   // v4: after the open world's light pass (it leaves the hall's lights alone in the tutorial)
    stackView.sync(STK.on ? sim.arenaState() : null, STK.on ? stack.hud() : null, G.t);
    view.setWaypoint(G.obj && !(cam.top > 0.5) ? G.obj : null, G.t);
    worldFrame(cam.top > 0.5 ? null : chassisG.position);
    renderer.render(scene, camera);
  }
  /** the world's per-frame part: its culling and overlay (from the camera), the shadow box (on a01, or the whole world from above),
   *  the fog (pushed out in the top view), the top view's stand-in for a01 */
  function worldFrame(focus, half = 11) {
    const k = smooth(cam.top);
    world.update(camera, k, cam.a, G.t);
    if (focus) view.shadowFocus(focus.x, focus.z, half); else view.shadowFocus(WC.x, WC.z, 21);
    scene.fog.near = view.FOG.near + 90 * k; scene.fog.far = view.FOG.far + 110 * k;
    topLOD(k > 0.8);
    const cp = camera.position, out = Math.hypot(Math.max(HALL_OUT.x0 - cp.x, 0, cp.x - HALL_OUT.x1), Math.max(HALL_OUT.z0 - cp.z, 0, cp.z - HALL_OUT.z1));
    hallInside.visible = k > 0.5 || out < 7;
    // the top view is a map: its shadows are drawn once on the way in and then kept (no shadow pass a frame)
    const sm = renderer.shadowMap, frozen = k > 0.8;
    if (frozen && sm.autoUpdate) { sm.autoUpdate = false; sm.needsUpdate = true; } else if (!frozen && !sm.autoUpdate) sm.autoUpdate = true;
  }
  function afterSteps() {
    const s = sim.state(); G.state = s;
    playT = G.t; juliMaybe(); juliRevive(); juliChutes(); CR.tick(G.booted);
    const ev = G.events; G.events = [];
    if (G.booted) tutorial.update(s, ev, G.t);
    if (inWorld()) {
      const sev = W.s.take(); W.ui.onEvents(sev);
      for (const e of sev) {
        if (['crafted', 'night', 'dawn', 'latched', 'built', 'sealed', 'salvaged'].includes(e.type)) { (JL.recent ||= []).push(e.type === 'crafted' ? 'crafted:' + e.name : e.type); if (JL.recent.length > 8) JL.recent.shift(); }
        if (JL.planEv && ['crafted', 'night', 'dawn'].includes(e.type)) JL.planEv.push(e.type);
        if (e.type === 'death') onDeath(e);
      }
    }
    for (const e of ev) {
      if (e.type === 'clack') { const k = G.clackT.get(e.part) || 0; if (G.t - k > 0.15) { G.clackT.set(e.part, G.t); audio.clack(Math.min(2, e.speed / 2)); } }
      else if (e.type === 'thump') { if (e.shift > 0.003 && G.t - (G.thumpT || 0) > 0.4) { G.thumpT = G.t; audio.thump(Math.min(1, e.speed * 3)); } }
      else if (e.type === 'rampLock') { audio.clack(1.2); setTimeout(() => audio.clack(1), 90); }
      else if (e.type === 'banked' && !TRASH_KINDS[e.kind]) events.emit('banked', e);   // v5: a supply in the bin (no ROMs: survival.js stows it)
      else if (e.type === 'banked') {
        progress.earn(e.roms); G.runRoms += e.roms; audio.chime(e.roms); events.emit('banked', e);
        if (JL.bounty && G.t < JL.bounty.until && JL.bounty.kind === e.kind) { progress.earn(JL.bounty.roms); G.runRoms += JL.bounty.roms; toast(`Bounty paid: +${JL.bounty.roms} ${romWord(JL.bounty.roms)}`, 'rom'); JL.bounty = null; }
        toast(`+${e.roms} ${romWord(e.roms)} · ${TRASH_KINDS[e.kind].name}${e.kind === 'diesel' && e.safe ? ', delivered safely' : ''}`, 'rom');
        const r = $('roms'); r.classList.remove('bump'); void r.offsetWidth; r.classList.add('bump');
      } else if (e.type === 'spill') { audio.splash(); events.emit('spill', e); toast('Diesel spilled! That patch of floor stays slick for the rest of the run.', 'bad', 4200); }
      else if (e.type === 'kit') { if (e.state === 'carried') { audio.clack(1.4); toast('Arm kit aboard. Take it to the dock to fit it.', 'good'); } }
      else if (e.type === 'pickup') { audio.chime(5); toast('Spare battery: +35 % charge.', 'good'); }
      else if (e.type === 'grasp') { audio.clack(e.ok ? 1.2 : 0.6); if (!e.ok) toast('Missed it. Line up and try again.'); }
      else if (e.type === 'grabDone' && e.carrying) toast(`Holding the ${(TRASH_KINDS[e.kind] || sim.kinds[e.kind] || { name: 'thing' }).name.toLowerCase()}. Bin off: attach it at Dock 01, then DROP drops it in (or DROP sets it down).`, '', 4200);
      else if (e.type === 'docked') { if (e.on && !G.dockedShown && G.booted) { G.dockedShown = true; audio.clack(1); requestStore(); } if (!e.on) { G.dockedShown = false; if (!sim.v2.op) closeSlots(); } }
      else if (e.type === 'limp') {
        const ow = !!(W.s && W.s.active), pc = (f) => Math.round(f * 100);
        toast(e.on ? (ow ? `Under ${pc(BATTERY.limpBelow)} %: limp mode. Crawl to the dock or the shelter's pad: at 0 % a01 is gone.` : 'Battery empty: limp mode. Crawl back to the dock to charge.')
          : (ow ? `${pc(BATTERY.limpExit)} %: full power again.` : 'Charged enough: full power again.'), e.on ? 'bad' : 'good', 4200);
      }
      else if (e.type === 'dockOp') { if (!$('slots').hidden) renderSlots(); if (sim.v2.msg) toast(sim.v2.msg, e.done ? 'good' : 'bad'); }
      else if (e.type === 'door') { audio.thump(0.4); events.emit('door', e); }
      else if (e.type === 'trashSpawned') events.emit('trashSpawned', e);
      if (['banked', 'spill', 'docked', 'grabDone', 'pickup', 'limp'].includes(e.type)) { (JL.recent ||= []).push(e.type); if (JL.recent.length > 8) JL.recent.shift(); }
      if (JL.planEv && ['banked', 'spill', 'estop'].includes(e.type)) JL.planEv.push(e.type); if (JL.planEv && e.type === 'docked' && e.on) JL.planEv.push('docked');
      if (e.type === 'banked') G.binned = (G.binned || 0) + 1;
      else if (e.type === 'fault') { if (TEST) console.warn('physics fault', e.what); }
    }
    // battery warnings, once each per run
    const f = s.v2.battery.frac;
    if (G.booted && !s.v2.battery.charging) for (const lim of [0.2, 0.1]) if (f < lim && !G.warned[lim]) { G.warned[lim] = true; toast(`Battery at ${Math.round(lim * 100)} %. The dock charges it.`, 'bad', 3200); }
    if (f > 0.3) G.warned = {};
    let spd = 0, load = 0; for (const w of s.wheels) { spd += Math.abs(w.rate) * WHEEL_R; load += Math.min(1, Math.abs((w.target || 0) - w.rate) * 0.04); }
    audio.update({ speed: spd / 4, load: load / 4, servo: s.phase === 'steering' ? 1 : 0, arm: s.v2.arm.busy ? 1 : 0, hoist: s.v2.op ? 1 : 0 });
    // the level's director (doors, new trash) about twice a second
    if (G.booted && G.t - G.dirT > 0.5) {
      G.dirT = G.t;
      events.tick({ trolley: { x: s.pos[0], z: s.pos[2] }, door: { open: s.v2.door > 0.5 }, inDock: s.v2.dock.inBay, hoistBusy: !!s.v2.op,
        looseTrash: s.v2.items.filter((i) => i.state === 'floor' && !i.banked && TRASH_KINDS[i.kind]).length, allowSpawns: tutorial.done || tutorial.index >= beatIndex('cable'), hallOnly: !tutorial.done }, G.t);
      if (STK.on) stackTick(); else if (JL.juli && !JL.holdTurns && !JL.storeHold) JL.juli.tick(juliSummary(s), G.t);
      trail('tick');   // (v4: the play trail, every 4 s at most)
      // v4 (Nov 3): on a phone, the CPU copies of textures now on the GPU go (assets.js dropCpuCopies), every 3 s
      if (LOWMEM && G.t - (G.dropT || -99) > 3) { G.dropT = G.t; try { const mb = dropCpuCopies(scene, renderer); if (mb > 0) G.droppedMB = Math.round(((G.droppedMB || 0) + mb) * 10) / 10; } catch (e) { /* the memory's, best effort */ } }
      if (JL.backend && JL.backend.alive && !(JL.backend.busy && JL.backend.busy()) && G.t - (JL.hmT || -99) > 10) { JL.hmT = G.t; JL.backend.alive().then((a) => { JL.helperMB = a ? a.mb : null; }, () => {}); }
      { const hs = JL.juli && JL.juli.stats.history, h = hs && hs[hs.length - 1]; if (h && h !== JL.trailH) { JL.trailH = h; trail('turn', `her turn: ${h.out} in ${h.ms} ms`); } }
      planTick(s); zoneTick(s);
    }
    if (G.t - G.hudT > 0.1) { G.hudT = G.t; hud(s); if (!$('slots').hidden) renderSlots(); }
  }
  function hud(s) {
    const chip = $('mode-chip');
    chip.textContent = s.want !== s.mode ? `${s.mode.toUpperCase()} → ${s.want.toUpperCase()}` : s.mode.toUpperCase();
    chip.classList.toggle('switching', s.want !== s.mode);
    $('speed').textContent = `${s.motion.speed.toFixed(2)} m/s`;
    for (const b of document.querySelectorAll('.mode')) { b.setAttribute('aria-checked', String(b.dataset.mode === s.want)); b.classList.toggle('pending', b.dataset.mode === s.want && s.want !== s.mode); }
    const v = s.v2, b = v.battery, pct = Math.round(b.frac * 100), el = $('batt');
    $('batt-fill').style.width = (24 * clamp(b.frac, 0, 1)).toFixed(1) + 'px';
    $('batt-pct').textContent = `${pct}%`;
    // the open world's line: under 10 % limp (a tick on the gauge), at 3 % the last warning, at 0 % death. Not in the tutorial: limp is just limp there
    const ow = !!(W.s && W.s.active), crit = ow && b.frac <= BATTERY.critical && !b.charging;
    el.classList.toggle('world', ow); el.classList.toggle('crit', crit); el.style.setProperty('--fill', (100 * clamp(b.frac, 0, 1)).toFixed(1) + '%');
    document.body.classList.toggle('batt-crit', crit);
    if (crit && !G.critWarned) { G.critWarned = true; toast(`Battery ${pct} %: charge now. At 0 % a01 is gone.`, 'bad', 4200); } else if (!crit && b.frac > BATTERY.critical + 0.02) G.critWarned = false;
    const lt = !ow ? 'LIMP · crawl to the dock' : crit ? `${pct} % · CHARGE NOW OR DIE` : `LIMP · UNDER ${Math.round(BATTERY.limpBelow * 100)} % · CHARGE`;
    if ($('limp').textContent !== lt) $('limp').textContent = lt; $('limp').classList.toggle('crit', crit);
    $('batt-sub').textContent = crit ? 'DYING' : b.limp ? 'LIMP' : b.charging ? 'CHARGING' : Number.isFinite(b.minutes) && b.avg > 40 && G.booted ? `${Math.min(99, Math.max(0, Math.round(b.minutes)))}${b.minutes > 99 ? '+' : ''} MIN` : TIERS[b.tier].name.replace(' cells', '');
    el.classList.toggle('mid', !b.limp && b.frac < 0.4 && b.frac >= 0.15); el.classList.toggle('low', !b.limp && b.frac < 0.15); el.classList.toggle('limp', b.limp); el.classList.toggle('chg', b.charging);
    el.setAttribute('aria-valuenow', String(pct));
    $('rom-n').textContent = String(progress.roms); $('rom-w').textContent = romWord(progress.roms); $('roms').setAttribute('aria-label', `${progress.roms} ${romWord(progress.roms)}`);
    $('cargo').hidden = v.arm.state !== 'carried'; $('limp').hidden = !b.limp;
    const area = areaAt(s.pos[0], s.pos[2]) || 'hall', zc = $('zone-chip');
    if (zc.dataset.area !== area) { zc.dataset.area = area; zc.textContent = AREA_NAMES[area]; zc.className = 'chip zone q-' + (quadAt(s.pos[0], s.pos[2]) || 'dock') + (area === 'plaza' ? ' plaza' : ''); }
    $('juli-chip').hidden = !(G.booted && JL.status === 'offline'); probeRender();
    const bt = JL.bounty && G.t < JL.bounty.until ? JL.bounty : null; if (JL.bounty && !bt) JL.bounty = null;
    $('bounty').hidden = !bt; if (bt) $('bounty').textContent = `BOUNTY · ${TRASH_KINDS[bt.kind].name.toUpperCase()} +${bt.roms} · ${Math.ceil(bt.until - G.t)} s`;
    const mounted = v.arm.state === 'mounted', gb = $('grab');
    gb.classList.toggle('off', !mounted || !G.booted);
    gb.classList.toggle('busy', v.arm.busy);
    $('dock-btn').classList.toggle('off', !(v.dock.parked && $('slots').hidden && G.booted));
    const salv = inWorld() && !v.arm.carrying && !sim.reachable().length && W.s.salvageTarget();
    gb.classList.toggle('ready', mounted && !v.arm.busy && !b.limp && (v.arm.carrying || sim.reachable().length > 0 || !!salv));
    gb.querySelector('span').textContent = stack.phase === 'on' ? stack.grabLabel() : v.arm.carrying ? 'DROP' : salv ? 'SALVAGE' : 'GRAB';
    stackHud();
    if (W.ui) W.ui.hud();
    if (inWorld()) {   // the open world's hint: what the day or the night asks of a01
      const st = W.s.state(), sh = st.shelter;
      const h = st.night ? (st.inside ? `Night ${st.day}: safe inside. Charge on the pad, craft, or wait for dawn (BIN).` : `Night ${st.day}: leeches are out. Get inside your sealed shelter${sh && sh.sealed ? '' : ' (no shelter: the dock charger holds off one or two)'}.`)
        : !sh ? `Day ${st.day}, ${st.clock}. Scavenge (GRAB, SALVAGE the ringed things) and BUILD a shelter before 20:00.`
        // v4 (Josh, Nov 2: the first shelter easier, a clearer hint): what the next piece is, and the one thing to do for it
        : !sh.sealed ? `Shelter ${sh.done}/${sh.of}. ${sh.next ? `Next: the ${((W.s.cat && W.s.cat[sh.next]) || { name: sh.next }).name}. Tap BUILD: the arm sets it in the glowing outline.` : `It ${sh.blocked || 'needs its pieces'}: SALVAGE one where it lies (the ringed ones), then BUILD.`} Night at 20:00.`
        : `Day ${st.day}, ${st.clock}. Craft in your shelter or the dock; mount panels; night at 20:00.`;
      if ($('hint').textContent !== h) $('hint').textContent = h;
      $('step').textContent = 'DAY ' + st.day;
    }
    // the step's hint (it changes while a step waits for the bin) and the objective
    if (G.booted) { const h = tutorial.done ? null : tutorial.hint(s); if (h && $('hint').textContent !== h) { $('hint').textContent = h; const hb = $('hint-box'); hb.classList.add('flash'); setTimeout(() => hb.classList.remove('flash'), 600); } }
    G.obj = objectiveNow(s);
    const ob = $('objective'); ob.hidden = !G.obj;
    if (G.obj) $('objective-txt').textContent = `${G.obj.name} · ${Math.hypot(G.obj.x - s.pos[0], G.obj.z - s.pos[2]).toFixed(1)} m`;
    navChip.update(G.obj ? G.obj.name : null, G.obj ? Math.hypot(G.obj.x - s.pos[0], G.obj.z - s.pos[2]) : null);
  }
  // the brake lights (red, brighter while it stops or holds) and the cyan status glow (pulses while booting or switching modes)
  function lights() {
    const s = G.state; if (!s) return;
    const braking = s.hold || (s.motion.speed > 0.05 && Math.hypot(s.cmd.vx, s.cmd.vy) + 0.02 < Math.abs(s.motion.fwd) + Math.abs(s.motion.left));
    for (const m of brakeMats) m.emissiveIntensity = braking ? 2.0 : 0.6;   // above about 2 the red washes to pink without bloom (the converter's note)
    let g = 2.0;
    if (!G.booted) g = 0.15; else if (tutorial.beat.id === 'boot') g = 0.4 + 1.6 * Math.min(1, (G.t - G.boot) / 2.2) * (0.6 + 0.4 * Math.sin(G.t * 12));
    else if (s.v2.battery.limp) g = 0.5 + 0.4 * Math.sin(G.t * 4);
    else if (s.want !== s.mode) g = 1.1 + 0.9 * Math.sin(G.t * 18);
    else if (G.finished) g = 2.0 + 1.5 * Math.sin(G.t * 6);
    for (const m of glowMats) m.emissiveIntensity = g;
    under.intensity = 0.35 * g; const pool = chassisG.userData.pool; if (pool) pool.material.opacity = 0.28 * g;
  }
  /** how far out the top view must be to frame the whole world at this azimuth and pitch (the portrait or landscape screen) */
  function topFit(a, pitch) {
    const c = Math.cos(a), s = Math.sin(a), Wx = WORLD.x1 - WORLD.x0, Wz = WORLD.z1 - WORLD.z0;
    const across = Math.abs(Wx * s) + Math.abs(Wz * c), along = Math.abs(Wx * c) + Math.abs(Wz * s);   // the world's extent across and along the view
    const vf = camera.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
    return Math.max((across / 2) / Math.tan(hf), (along * Math.sin(pitch) / 2) / Math.tan(vf)) * 1.08 + 2;
  }
  /** how far the camera may back off from the target along (dx, dz) before it meets a wall: inside the hall its walls, outside the
   *  world's fence and the boxes the camera must not enter (the hall, the blocks, the containers) */
  function camRoom(tx, tz, dx, dz) {
    const m = 0.3; let room = Infinity;
    const inside = (x0, x1, z0, z1) => { if (dx > 1e-6) room = Math.min(room, (x1 - m - tx) / dx); else if (dx < -1e-6) room = Math.min(room, (x0 + m - tx) / dx); if (dz > 1e-6) room = Math.min(room, (z1 - m - tz) / dz); else if (dz < -1e-6) room = Math.min(room, (z0 + m - tz) / dz); };
    if (Math.abs(tx) < ROOM.hx && Math.abs(tz) < ROOM.hz) { inside(-ROOM.hx, ROOM.hx, -ROOM.hz, ROOM.hz); return room; }
    inside(WORLD.x0, WORLD.x1, WORLD.z0, WORLD.z1);
    for (const b of CAMERA_BLOCKERS) {   // the ray's entry into each box, grown by the margin
      let t0 = 0, t1 = Infinity;
      for (const [p, d, lo, hi] of [[tx, dx, b.x0 - m, b.x1 + m], [tz, dz, b.z0 - m, b.z1 + m]]) {
        if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = Infinity; break; } continue; }
        let a = (lo - p) / d, c = (hi - p) / d; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      }
      if (t0 <= t1 && t0 > 0) room = Math.min(room, t0);
    }
    return room;
  }
  // the camera: behind the trolley (chase) or over the whole world (top), blended; a drag swings it round; near the floor it keeps
  // inside the hall's walls, or outside them, inside the world's fence and out of the blocks
  function follow(dt) {
    const ch = chassisG; tmpF.set(1, 0, 0).applyQuaternion(ch.quaternion); const h = Math.atan2(-tmpF.z, tmpF.x);
    const s = G.state, moving = s && s.mode === 'drive' && s.motion.fwd > 0.15;
    cam.top += (cam.goal - cam.top) * Math.min(1, dt * 9); if (Math.abs(cam.goal - cam.top) < 1e-3) cam.top = cam.goal;
    const k = smooth(cam.top);
    let d = h - cam.a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    if (cam.snap) cam.a = h;
    else if (cam.recentre > 0) { cam.recentre -= dt; cam.a += d * Math.min(1, dt * 5); }
    else if (moving && G.t - cam.user > 2.5 && k < 0.5) cam.a += d * Math.min(1, dt * (1.6 - 0.8 * k));
    const pitch = cam.pitch + (CAM.topPitch - cam.pitch) * k, far = topFit(cam.a, CAM.topPitch), dist = cam.dist * Math.pow(far / cam.dist, k);
    const kt = k * k;   // the target leaves a01 for the world's centre late in the zoom, so a01 stays in view on the way out
    cam.tgt.set(ch.position.x + (WC.x - ch.position.x) * kt, ch.position.y + 0.5 - 0.5 * k, ch.position.z + (WC.z - ch.position.z) * kt);
    cam.curDist = dist;
    // near a wall the camera comes in no closer than the wall allows and climbs instead, so it keeps the same distance from the trolley
    const dx = -Math.cos(cam.a), dz = Math.sin(cam.a);
    const room = k < 0.6 ? camRoom(cam.tgt.x, cam.tgt.z, dx, dz) : Infinity;
    let dh = dist * Math.cos(pitch), up = dist * Math.sin(pitch);
    if (dh > room) { dh = Math.max(0.3, room); up = Math.max(up, Math.sqrt(Math.max(0, dist * dist - dh * dh))); }
    const cap = ROOM.height + 0.6 + (far * Math.sin(CAM.topPitch) + 1 - ROOM.height - 0.6) * k;
    const want = new THREE.Vector3(cam.tgt.x + dx * dh, Math.min(cam.tgt.y + up, cap), cam.tgt.z + dz * dh);
    if (cam.snap) { cam.pos.copy(want); cam.snap = false; } else cam.pos.lerp(want, Math.min(1, dt * 8));
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
  }

  // ---- start
  document.addEventListener('visibilitychange', () => { if (document.hidden) { voice.cancel(); audio.suspend(); } else { audio.resume(); G.last = 0; } });
  addEventListener('pagehide', () => audio.suspend());
  tutorial.go(0, sim.state());
  // the world's quadrants load their models only once the hall is open (or a01 or the camera is out of it), after Play, and not
  // while Juli's model is loading
  const hallOpen = () => sim.v2.hallDoors.some((d) => d.open > 0.5) || areaAt(chassisG.position.x, chassisG.position.z) !== 'hall';
  world.setLoadGate(() => G.booted && hallOpen() && JL.status !== 'starting', (area) => CR.stage('world:' + area));
  addEventListener('pagehide', () => { CR.clear(); TR.close('left'); });   // a clean leave: no breadcrumb, the play trail closed
  G.state = sim.state(); render(1, 1 / 60); CR.stage('first-frame');
  if (TEST) G.firstFrameMem = { heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
  requestAnimationFrame(frame);
  await Promise.race([modelReady, new Promise((r) => setTimeout(r, TEST ? 60000 : 25000))]);
  say(M.source === 'glb' ? 'Ready.' : 'Ready (simple trolley: the detailed model did not load).');
  await Promise.race([dataReady, new Promise((r) => setTimeout(r, 8000))]);   // v5: the open world's data (local, small) before the start card's buttons
  if (!LANDING) { const sv = saves.load(); if (sv && W.s) { $('continue').hidden = false; $('continue').textContent = `Continue · day ${Math.floor(sv.time / 600) + 1}`; $('start-kicker').textContent = 'The open world · saved at the shelter'; }
    $('skip').hidden = !(W.s && (sv || progress.best != null)); }
  CR.stage('ready');
  const boot = () => {
    audio.start(); if (LANDING) LANDING.hide(); $('start').hidden = true; $('hud').hidden = false; G.booted = true; G.boot = G.t;
    sim.setHallDoors(false, true);   // v5: the tutorial is the hall: its shutters stay down until step 15 is done
    if (!sim.v2.items.length && !sim.v2.kit && sim.v2.arm.state === 'map') layoutRun();
    $('probe').hidden = !SET.probe; queueJuli(); CR.stage('play');
    tutorial.go(0, sim.state()); controls.rest(); hud(sim.state());
  };
  // v4: the landing's choice: made before the scene loaded (run it now), or on the desk the landing over the ready scene
  const runChoice = (a) => { if (a === 'start') boot(); else if (a === 'load') { if (!continueGame()) boot(); } else if (a === 'skip') { if (!skipTutorial()) boot(); } else if (a === 'leave') leave(); };
  if (LANDING && !bench) {
    if (ACTION) { LANDING.hide(); runChoice(ACTION); }   // (hide() lets the title art go)
    else { LANDING.show(); LANDING.choose().then((a) => { if ((a === 'start' || a === 'skip') && saves.load()) saves.clear(); if (a !== 'leave') LANDING.hide(); runChoice(a); }); }
  } else if (!bench) { $('boot').addEventListener('click', boot); $('boot').disabled = false; }
  // v4: the pause sheet: Resume, Save and quit to the landing screen (the open world saves where a01 is; the tutorial just quits: its
  // progress, the ROMs and the battery's tier, is kept as it goes), Back to p0pc0rn
  const pause = createPause({
    onOpen: () => { if (!G.booted || G.bubble) return false; G.paused = true; return { canSave: inWorld(), line: inWorld() ? `Day ${W.s.state().day}: a01 wakes on its pad (or at the dock) when you load.` : 'The tutorial starts again from its first step; your ROMs stay.' }; },
    onResume: () => { G.paused = false; G.last = 0; },
    onSaveQuit: () => { if (inWorld()) { try { W.s.autosave('quit'); } catch (e) { /* */ } } CR.clear(); try { location.replace(location.pathname); } catch (e) { location.reload(); } return true; },
    onLeave: () => leave(),
  });
  JL.pause = pause;
  // v4: the phone bench's hooks (bench.js): Play, the pilot, Juli on a given layout, the frame times, the counted memory
  if (bench) bench.withScene({
    boot, mem: MEM, cam, G, clearCrumbs: () => CR.clear(),
    benchPlay: () => { sim.v2.arm.state = 'carried'; sim.mountArm(); relink(); tutorial.go(beatIndex(MISCHIEF_FROM), sim.state()); $('probe').hidden = false; },   // Level 1 at the step her mischief starts at (the arm fitted); the probe on screen
    setPilot: (f) => { G.pilot = f; }, onFrame: (f) => { G.onFrame = f; },
    juliWith: (backend, tuning) => { JL.backend = backend; JL.juli = createJuli(Object.assign({ backend, mode: 'mischief', world: juliWorld }, tuning || {})); JL.status = 'online'; JL.why = 'bench'; return JL.juli; },
    juliStop: () => { JL.juli = null; JL.backend = null; JL.status = 'off'; },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    voice, planStart: () => { startPlan(true); return JL.plan || null; }, planStats: () => (JL.plan ? Object.assign({ of: JL.plan.intents.length }, JL.plan.stats) : null),
    beat: (id) => { const i = beatIndex(id); if (i >= 0 && tutorial.index !== i) tutorial.go(i, sim.state()); },
    // v4 (Nov 3): the dock's store for the bench: a01 put at the dock's approach, driven onto the charger (the store opens by itself)
    storeRig: () => ({
      place: () => { closeSlots(); G.dockedShown = false; sim.reset({ x: 5.6, z: -2.6, yawDeg: 90 }); relink(); cam.snap = true; },
      input: (s0) => ({ x: 0, y: s0.pos[2] > -4.58 ? 0.45 : 0, hold: s0.pos[2] <= -4.58, mode: 'drive' }),
      parked: () => !!sim.v2.dock.parked, open: () => !$('slots').hidden, close: () => closeSlots(),
    }),
    // v4: the stack game for the bench: a01 at the pad's approach with its arm, the game on with her live turns, a can put in its reach
    stackRig: () => {
      JL.stackLog = [];
      return {
        start: async (backend) => { await stackScreen(); stopStack(); if (sim.v2.arm.state !== 'mounted') sim.v2.arm.state = 'carried'; sim.reset({ x: STACK_APPROACH.x, z: STACK_APPROACH.z, yawDeg: STACK_APPROACH.yawDeg }); if (sim.v2.arm.state !== 'mounted') sim.mountArm(); relink(); cam.snap = true;
          G.stackOffered = true; stack.start({ stock: false }); STK.on = true; JL.stackTurns = backend ? createStackTurns({ backend, game: stack, radio: (l) => juliWorld.radio(l) }) : null; relink(); },
        spawnFor: (k) => { const s = sim.state(), side = k % 2 ? -0.38 : 0.38; sim.spawnItem(['tin', 'soda', 'tin'][k % 3], s.pos[0] - side, s.pos[2] + 0.95, 0); relink(); },
        grab: () => { const r = stack.grab(); relink(); return r; }, armBusy: () => !!sim.v2.arm.seq, phase: () => stack.phase, hud: () => stack.hud(),
        turns: () => (JL.stackTurns ? JL.stackTurns.stats : null), events: () => (JL.stackLog || []).slice(),
      };
    },
  });

  if (TEST) {
    globalThis.__trolley = {
      RAPIER, THREE, sim, view, props, tutorial, controls, model: M, G, Qy, ready: true, loadMs: performance.now() - t0, parts, events, progress, cam, CAM,
      boot, pause: (on = true) => { G.paused = on; }, juli: JL, juliSummary, layoutRun, openSlots, closeSlots, buyTier, grab, relink, objective: () => G.obj,
      slotsOpen: () => !$('slots').hidden, toastText: () => $('toast').textContent,
      /** n fixed steps with this input, no drawing (fast); -> the last state */
      run: (n, inp = {}) => { for (let i = 0; i < n; i++) { step(Object.assign({ x: 0, y: 0, hold: false, mode: null }, inp)); G.t += DT; } afterSteps(); return sim.state(); },
      place: (pose) => { sim.reset(pose); relink(); cam.snap = true; afterSteps(); return sim.state(); },
      placeRamp: (pose) => { sim.buildRamp(pose); return sim.rampState(); },
      frame: (opts = {}) => { if (opts.cam) Object.assign(cam, opts.cam); render(1, 1 / 60); return true; },
      setPr: (pr) => { Qy.pr = pr; resize(); },
      /** draw one frame from a fixed camera (positions in metres), HUD untouched */
      look: (p, t, opt = {}) => { draw(1); lights(); view.tick && view.tick(G.t, 1 / 60); compassFrame(); view.setWaypoint(G.booted ? tutorial.waypoint(G.state || sim.state()) : null, G.t); camera.position.set(p[0], p[1], p[2]); camera.lookAt(t[0], t[1], t[2]);
        if (W.view) W.view.update(W.s, G.t, 1 / 60, camera, 1);
        worldFrame(opt.top ? null : { x: t[0], z: t[2] }, opt.half || Math.min(21, Math.max(11, Math.hypot(p[0] - t[0], p[2] - t[2]) * 1.2))); renderer.render(scene, camera); return true; },
      world, worldStats: () => world.stats(), assetsStatus: () => assets.status, zone: () => ({ area: areaAt(chassisG.position.x, chassisG.position.z), chip: $('zone-chip').textContent, marks: QMARKS.filter((q) => !q.el.hidden).map((q) => q.qd.id) }), topLOD: () => lodTop, topFit,
      zones: () => ({ on: Z.on, cur: Z.cur, busy: Z.busy, shifts: Z.shifts, log: Z.log.slice(), screen: zoneEl.up, areaPlan: JL.areaPlan ? Object.assign({ of: JL.areaPlan.intents ? JL.areaPlan.intents.length : null }, JL.areaPlan.stats) : null }),
      crumbs: CR, lowmem: LOWMEM, texMax: TEX_MAX, mem: () => (MEM.installed ? MEM.snapshot() : null), stack, stackOn: () => STK.on, stackView,
      juliWith: (backend, tuning) => { JL.backend = backend; JL.juli = createJuli(Object.assign({ backend, mode: 'mischief', world: juliWorld }, tuning || {})); JL.status = 'online'; return JL.juli; },
      juliStop: () => { JL.juli = null; JL.backend = null; JL.status = 'off'; }, assetsBusy: () => assets.busy(), juliQueue: () => ({ status: JL.status, notBefore: JL.notBefore, startedAt: JL.startedAt, input: !!G.input, t: G.t }),
      W, survival: () => W.s, pathsFixed: () => fixedFootprints(true), hit, sview: () => W.view, sui: () => W.ui, startWorld, skipTutorial, continueGame, restartTutorial, saves, dataReady, dataError: () => WD.error,
      gl: () => { const g = renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); },
      info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }),
      /** where a frame's draw calls and triangles go: one frame drawn as T.frame() draws it, every draw (the shadow pass's too) counted by
       *  its object's path below the scene, `depth` levels deep -> { 'hall_inside/...': [calls, triangles] } (the top 16) */
      drawBreakdown: (depth = 1, n = 16) => { const out = {}, orig = renderer.renderBufferDirect;
        renderer.renderBufferDirect = function (camR, sc, geo, mat, obj, grp) {
          const path = []; for (let o = obj; o && o.parent; o = o.parent) path.unshift(o.name || o.type); const k = path.slice(0, depth).join('/') || obj.type;
          const idx = geo.index ? geo.index.count : (geo.attributes.position ? geo.attributes.position.count : 0), cnt = Math.min(idx, grp ? grp.count : geo.drawRange.count);
          const tri = (obj.isMesh ? cnt / 3 : 0) * (obj.isInstancedMesh ? obj.count : 1), e = out[k] || (out[k] = [0, 0]); e[0]++; e[1] += Math.round(tri);
          return orig.apply(this, arguments); };
        try { render(1, 1 / 60); } finally { renderer.renderBufferDirect = orig; }
        return Object.fromEntries(Object.entries(out).sort((x, y) => y[1][0] - x[1][0]).slice(0, n)); },
    };
  }
}

