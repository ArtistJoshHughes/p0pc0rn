// stack.js - the stacking mini game: a01 stacks real trash on the weigh pad to a target height and holds it there; Juli tries to topple
// it with four physical tools (the floor vent's gust, the plate's rattle, a can rolled out of a ceiling chute, the sweeper bot). The
// rules over the physics' state: the stack's height and wobble, the hold timer, win / lose / toppled, a01's PLACE (GRAB keeps an item at
// the pad, GRAB again over the pad sets it on the stack), and the guard rails every one of her calls must pass (live from her model, or
// planned ahead on the loading screen: the same check). Nothing here plays her part: a refused or garbled answer is her pass; her words
// come from her model. Runs in Node (the tests) and in the page; the physics is sim.js's (buildArena, arenaAct, place), the data
// stack_spec.js's, the drawing stack_view.js's.
import * as SPEC from './stack_spec.js';
import { PAD, TARGET, REWARD, ROLLER, SWEEPER, TOOLS, TOOL_NAMES, RULES, STACK_JULI, STOCK, LIGHTS, rollerDrop, onPad } from './stack_spec.js';
import { parseCall, filterSay } from './juli.js';

const r2 = (v) => Math.round(v * 100) / 100, r1 = (v) => Math.round(v * 10) / 10;
const V = (o) => [o.x, o.y, o.z];
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };

/** her system prompt for the mini game (short: Gemma E2B, a 1024-token context) */
export function stackPrompt() {
  return [
    'You are Juli, the AI of a run-down reclaim hall. Mini game: a01, a small trash trolley robot (the player), stacks cans on the weigh pad. It wins if a stack '
      + `of ${TARGET.levels} stands ${TARGET.height} m tall for ${TARGET.holdS} s. You try to stop it: a fair, friendly rival, never cruel.`,
    'Each turn you get the pad\'s state as JSON. Answer with ONE JSON object and nothing else: {"call": NAME, "args": {...}, "say": "radio line"}. "say" is optional, at most 80 characters, your own words.',
    'Calls (each warns a01 first, then cools down; one at a time; never while a01 is placing):',
    '- vent {}: a gust from the floor vent beside the pad.',
    '- plate {}: the pad\'s plate rattles for a moment.',
    '- roller {"from": east|southeast|southwest|west}: a can rolls out of the ceiling chute towards the pad ("from" optional).',
    '- sweeper {}: the sweeper bot drives past the pad\'s edge.',
    '- say {}: just the radio line.   - pass {}: do nothing.',
    'A tool that is not "ready" is refused. When "result" is set the game is over: only say (how it went) or pass.',
  ].join('\n');
}

/** a planned call's trigger ("start", "after 20", "stack reaches 3", "height 0.2", "held 2", "toppled", "carrying") against game.facts() */
export function matchTrigger(trigger, f) {
  const s = String(trigger || '').trim().toLowerCase(), n = parseFloat((s.match(/-?\d+(\.\d+)?/) || [])[0]);
  if (!f || f.phase !== 'on') return false;
  if (s === 'start') return true;
  if (/^after\b/.test(s) || /^\d+(\.\d+)?\s*s$/.test(s)) return Number.isFinite(n) && f.t >= n;
  if (/^stack (reaches|at|is)\b/.test(s)) return Number.isFinite(n) && f.levels >= n;
  if (/^height\b/.test(s)) return Number.isFinite(n) && f.height >= n;
  if (/^held\b/.test(s)) return Number.isFinite(n) && f.hold >= n;
  if (/^topple/.test(s)) return f.toppled >= 1;
  if (s === 'carrying') return !!f.carrying;
  return false;
}

/** createStackGame({ sim, post, now, emit, seed }) - sim: sim.js's; post: events.post (the stock and the roller go through the game's
 *  event queue); now(): game seconds (default: the physics' clock); emit(event): optional, each event as it happens (also takeEvents()) */
export function createStackGame({ sim, post, now = null, emit = null, seed = 5 }) {
  const clock = now || (() => sim.t);
  let rnd = seed; const random = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const G = { phase: 'idle', t0: 0, endT: 0, result: null, hold: 0, lastT: 0, toppled: 0, levelsSeen: 0, settledLevels: 0, wobble: 0, active: null, gapUntil: 0,
    placingT: -1e9, tools: Object.fromEntries(TOOL_NAMES.map((n) => [n, { state: 'ready', until: 0, args: null, source: null, firedT: 0 }])), last: null, events: [], stack: null, best: 0 };
  const ev = (e) => { e.t = r2(clock() - G.t0); G.events.push(e); if (G.events.length > 200) G.events.shift(); if (emit) { try { emit(e); } catch (x) { /* the listener's own */ } } };

  // ------------------------------------------------------------------------------------------ the stack, measured from the bodies
  const lowOf = (it) => Math.min(...it.cols.map((c) => -sim.reach(c, [0, -1, 0]))), topOf = (it) => Math.max(...it.cols.map((c) => sim.reach(c, [0, 1, 0])));
  const radiusOf = (it) => Math.max(it.spec.size[0], it.spec.size[2]) / 2;
  /** the items on the plate, and the tallest supported chain: level 1 stands on the plate, level k+1 on a level-k item (its bottom on that
   *  one's top, their centres overlapping) */
  function measure() {
    const on = [];
    for (const it of sim.v2.items) {
      if (it.state === 'grasped' || it.inBin) continue;
      const p = it.body.translation(); if (!onPad(p.x, p.z, 0.02)) continue;
      const lo = lowOf(it); if (lo < PAD.top - 0.03 || lo > 1.2) continue;
      on.push({ it, p: [p.x, p.z], lo, hi: topOf(it), r: radiusOf(it), v: Math.hypot(...V(it.body.linvel())), w: Math.hypot(...V(it.body.angvel())), level: 0 });
    }
    on.sort((a, b) => a.lo - b.lo);
    for (const a of on) {
      if (a.lo <= PAD.top + 0.015) { a.level = 1; continue; }
      for (const b of on) if (b !== a && b.level && Math.abs(a.lo - b.hi) < 0.02 && Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 0.75 * (a.r + b.r)) a.level = Math.max(a.level, b.level + 1);
    }
    const st = on.filter((a) => a.level);
    let levels = 0, height = 0, top = null;
    for (const a of st) { levels = Math.max(levels, a.level); if (a.hi - PAD.top > height) { height = a.hi - PAD.top; top = a; } }
    const moving = st.reduce((m, a) => Math.max(m, a.v / 0.1, a.w / 2), 0);
    const settled = st.every((a) => a.v < RULES.settleV && a.w < RULES.settleW);
    return { levels, height, items: on.length, stacked: st.length, ids: st.map((a) => a.it.id), top: top ? { x: top.p[0], z: top.p[1], top: top.hi, id: top.it.id } : null, moving, settled };
  }
  const inStack = (it) => !!(G.stack && G.stack.ids.includes(it.id));
  /** the stack's foot (its level-1 item under the top), or the pad's centre */
  function baseOf() {
    const S = G.stack || measure(); if (!S.top) return [PAD.x, PAD.z];
    let best = null, bd = Infinity;
    for (const it of sim.v2.items) { if (!S.ids.includes(it.id)) continue; const p = it.body.translation(), lo = lowOf(it); if (lo <= PAD.top + 0.015) { const d = Math.hypot(p.x - S.top.x, p.z - S.top.z); if (d < bd) { bd = d; best = [p.x, p.z]; } } }
    return best || [S.top.x, S.top.z];
  }

  // ------------------------------------------------------------------------------------------ a01: GRAB at the pad keeps the item, GRAB over the pad places it
  const chassisPos = () => V(sim.trolley.chassis.body.translation());
  const atPad = () => { const p = chassisPos(); return Math.hypot(p[0] - PAD.x, p[2] - PAD.z) <= RULES.zone; };
  const carrying = () => { const A = sim.v2.arm; return !!(A.grasp && !A.seq); };
  const placingNow = () => { const s = sim.v2.arm.seq; return !!(s && s.place && s.place.phase !== 'up'); };
  const placing = () => placingNow() || clock() - G.placingT < RULES.placeGrace;
  /** where the claw would set its item: on top of the stack, or (an empty pad) at the pad's point nearest the claw's sweet spot 1.12 m
   *  ahead of a01, kept inside the plate */
  function placeSpot() {
    const S = G.stack || measure();
    if (S.top) return { x: S.top.x, z: S.top.z, top: S.top.top };
    const ch = sim.trolley.chassis.body, p = V(ch.translation()), q = ch.rotation(), f = [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)];   // the chassis' forward (x, z)
    const it = sim.v2.arm.grasp ? sim.v2.arm.grasp.item : null, m = PAD.half - (it ? radiusOf(it) : 0.04) - 0.03;
    const cl = (v, c) => Math.max(c - m, Math.min(c + m, v));
    return { x: cl(p[0] + f[0] * 1.12, PAD.x), z: cl(p[2] + f[1] * 1.12, PAD.z), top: PAD.top };
  }
  /** can a01 place what its claw holds? -> { ok, why, at } */
  function canPlace() {
    if (G.phase !== 'on') return { ok: false, why: 'no game on' };
    if (!carrying()) return { ok: false, why: sim.v2.arm.seq ? 'the arm is busy' : 'the claw holds nothing' };
    if (!atPad()) return { ok: false, why: 'not at the pad' };
    const at = placeSpot(), plan = sim.placePlan(at);
    return plan ? { ok: true, at } : { ok: false, why: 'out of reach: stop with the pad a metre ahead', at };
  }
  /** the GRAB button while the game runs: PLACE over the pad, GRAB-and-keep at the pad (never the stack's own items), else the usual GRAB */
  function grab() {
    if (G.phase !== 'on') return sim.grab();
    if (carrying() && atPad()) {
      const c = canPlace(); if (!c.ok) return { ok: false, why: c.why };
      const r = sim.place(c.at, { tag: 'stack' }); if (r.ok) { G.placingT = clock(); cancelWarming('a01 is placing'); ev({ type: 'stackPlace', kind: r.kind }); }
      return r;
    }
    if (!sim.v2.arm.grasp && atPad()) return sim.grab({ keep: true, high: true, skip: inStack });
    return sim.grab();
  }
  /** what the GRAB button should read now */
  function grabLabel() { if (G.phase === 'on' && carrying() && atPad()) return 'PLACE'; return sim.v2.arm.grasp && !sim.v2.arm.seq ? 'DROP' : 'GRAB'; }

  // ------------------------------------------------------------------------------------------ her tools: the guard rails, the warning, the act, the cooldown
  const toolOf = (c) => (c && typeof c.call === 'string' ? c.call.trim().toLowerCase() : '');
  /** a01's colliders' centres (x, z), only those reaching below `under` m (the sweeper cares about what is at its height) */
  function trolleyPoints(under = Infinity) {
    const pts = [];
    for (const p of sim.trolley.parts.concat(sim.v2.arm.parts)) for (const c of p.cols) { if (under < Infinity && -sim.reach(c, [0, -1, 0]) > under) continue; const t = c.translation(); pts.push([t.x, t.z]); }
    return pts;
  }
  /** a chute's throw: from its mouth towards the stack's foot; where the can lands (the fall carries it ROLLER.speed x 0.68 s) */
  function rollerAim(lane) {
    const d = rollerDrop(lane), foot = baseOf(), ux = foot[0] - d.x, uz = foot[1] - d.z, un = Math.hypot(ux, uz) || 1, dir = [ux / un, uz / un];
    const fly = ROLLER.speed * Math.sqrt(2 * ROLLER.y / 9.81);
    return { from: [d.x, d.z], dir, foot, land: [d.x + dir[0] * fly, d.z + dir[1] * fly] };
  }
  /** the roller's lane for her args: hers if it is one, the lane farthest from a01 if she named none */
  function rollerLane(args) {
    const from = args && typeof args.from === 'string' ? args.from.trim().toLowerCase().replace(/[\s_-]/g, '') : '';
    if (from) return ROLLER.lanes[from] ? from : null;
    const p = chassisPos(); let best = null, bd = -1;
    for (const k of Object.keys(ROLLER.lanes)) { const d = rollerDrop(k), dd = Math.hypot(d.x - p[0], d.z - p[2]); if (dd > bd) { bd = dd; best = k; } }
    return best;
  }
  /** the guard rails: may this call happen now? (the same check for her live answers and for planned ones) -> { ok, why, tool, args } */
  function check(c) {
    const name = toolOf(c), args = c && c.args && typeof c.args === 'object' ? c.args : {};
    if (name === 'pass' || name === 'say') return { ok: true, tool: name, args };
    if (!TOOLS[name]) return { ok: false, why: 'not a tool', tool: name };
    if (G.phase !== 'on') return { ok: false, why: 'the game is over', tool: name };
    const t = clock(), T = G.tools[name];
    if (placing()) return { ok: false, why: 'a01 is placing', tool: name };
    if (G.active) return { ok: false, why: `one at a time (${G.active} is ${G.tools[G.active].state})`, tool: name };
    if (t < G.gapUntil) return { ok: false, why: 'too soon after the last one', tool: name };
    if (T.state !== 'ready') return { ok: false, why: `${name} is cooling down`, tool: name };
    if (!sim.arena.on) return { ok: false, why: 'no arena', tool: name };
    const A = sim.arenaState();
    if (name === 'plate' && A.trolleyOnPlate) return { ok: false, why: 'a01 is on the plate', tool: name };
    if (name === 'sweeper') {
      if (A.sweeper.moving) return { ok: false, why: 'the sweeper is out', tool: name };
      const L = SWEEPER.lane, near = trolleyPoints(0.25).some(([x, z]) => x > L.x0 - SWEEPER.r - 0.3 && x < L.x1 + SWEEPER.r + 0.3 && Math.abs(z - L.z) < SWEEPER.r + 0.45);
      if (near) return { ok: false, why: "a01 is in the sweeper's lane", tool: name };
    }
    if (name === 'roller') {
      const lane = rollerLane(args); if (!lane) return { ok: false, why: 'roller: from east, southeast, southwest or west', tool: name };
      const kind = args.kind == null ? ROLLER.kind : String(args.kind).toLowerCase();
      if (!ROLLER.kinds.includes(kind)) return { ok: false, why: 'roller: a tin or a soda can', tool: name };
      const A = rollerAim(lane);
      if (trolleyPoints().some((p) => segDist(p, A.from, A.land) < ROLLER.clearFall) || trolleyPoints(0.15).some((p) => segDist(p, A.land, A.foot) < ROLLER.clearRoll)) return { ok: false, why: 'a01 is in the way of that chute', tool: name };
      return { ok: true, tool: name, args: { from: lane, kind } };
    }
    return { ok: true, tool: name, args: {} };
  }
  /** her call (live, or `source: 'plan'` from the loading screen's plan): checked, then started (its warning first). -> { applied, why } */
  function applyCall(c, { source = 'live' } = {}) {
    const k = check(c);
    if (!k.ok) { ev({ type: 'stackRefused', call: k.tool || toolOf(c), why: k.why, source }); return { applied: false, why: k.why }; }
    if (k.tool === 'pass' || k.tool === 'say') return { applied: true, tool: k.tool };
    const T = G.tools[k.tool], spec = TOOLS[k.tool], t = clock();
    Object.assign(T, { state: 'warming', until: t + spec.warn, args: k.args, source }); G.active = k.tool;
    ev({ type: 'stackTool', tool: k.tool, phase: 'warn', args: k.args, source, warn: spec.warn, cue: 'warn', light: lightOf(k.tool, k.args) });
    return { applied: true, tool: k.tool };
  }
  const lightOf = (tool, args) => (tool === 'roller' ? LIGHTS.roller[(args && args.from) || 'east'] : tool === 'sweeper' ? null : LIGHTS[tool]);
  function cancelWarming(why) {
    const n = G.active; if (!n || G.tools[n].state !== 'warming') return;
    Object.assign(G.tools[n], { state: 'cooling', until: clock() + TOOLS[n].cooldown }); G.active = null; G.gapUntil = clock() + RULES.gap;
    ev({ type: 'stackTool', tool: n, phase: 'cancelled', why });
  }
  /** the tool's real act: through the physics (sim.arenaAct) or, for the roller, a can through the game's event queue */
  function fire(name) {
    const T = G.tools[name];
    if (name === 'roller') {   // the chute's mouth turns towards the stack's foot (or the pad's centre); the can rolls along it
      const A = rollerAim(T.args.from), kind = T.args.kind, r = sim.kinds[kind].size[0] / 2, s = ROLLER.speed, w = s / r, dir = A.dir, ax = [dir[1], 0, -dir[0]];
      const yawDeg = Math.atan2(ax[0], ax[2]) * 180 / Math.PI;
      const res = post({ type: 'spawnTrash', kind, x: A.from[0], z: A.from[1], y: ROLLER.y, yawDeg, lie: true, vel: [dir[0] * s, 0, dir[1] * s], spin: [ax[0] * w, 0, ax[2] * w] });
      if (res && res.ok === false) return { ok: false, why: res.why };
      return { ok: true };
    }
    if (name === 'plate') { const a = random() * Math.PI; return sim.arenaAct('plate', { dir: [Math.cos(a), Math.sin(a)] }); }
    return sim.arenaAct(name);
  }
  /** is the tool's act over? (the gust and the rattle end by themselves, the sweeper when it has parked, the roller when it has settled) */
  function actDone(name, T, t) {
    const A = sim.arenaState(); if (!A) return true;
    if (name === 'vent') return !A.vent.on;
    if (name === 'plate') return !A.plate.rattling;
    if (name === 'sweeper') return !A.sweeper.moving || t - T.firedT > TOOLS.sweeper.acts + 6;
    return t - T.firedT > TOOLS.roller.acts;
  }

  // ------------------------------------------------------------------------------------------ the game
  function start({ stock = true } = {}) {
    if (G.phase === 'on') return { ok: false, why: 'already on' };
    sim.buildArena(SPEC);
    Object.assign(G, { phase: 'on', t0: clock(), endT: 0, result: null, hold: 0, lastT: clock(), toppled: 0, levelsSeen: 0, settledLevels: 0, wobble: 0, active: null, gapUntil: clock() + RULES.gap, placingT: -1e9, last: null, best: 0 });
    for (const n of TOOL_NAMES) Object.assign(G.tools[n], { state: 'ready', until: 0, args: null, source: null, firedT: 0 });
    if (stock) for (const [kind, x, z, yawDeg] of STOCK) post({ type: 'spawnTrash', kind, x, z, yawDeg });
    ev({ type: 'stackStart', target: TARGET.levels, height: TARGET.height, holdS: TARGET.holdS, timeLimit: TARGET.timeLimit });
    return { ok: true };
  }
  function finish(result, why) {
    if (G.phase !== 'on') return;
    G.phase = result; G.result = result; G.endT = clock();
    if (G.active) { const n = G.active; G.tools[n].state = 'cooling'; G.active = null; ev({ type: 'stackTool', tool: n, phase: 'cancelled', why: 'the game is over' }); }
    sim.arenaAct('stop');
    const S = G.stack || { levels: 0, height: 0 };
    if (result === 'won') ev({ type: 'stackWon', roms: REWARD.win, levels: S.levels, height: r2(S.height), seconds: r1(G.endT - G.t0), toppled: G.toppled });
    else ev({ type: 'stackLost', why, levels: S.levels, best: G.best, toppled: G.toppled });
  }
  /** after each physics step (or each frame): the tools' timers, the stack, the hold, win / lose / toppled */
  function update() {
    if (G.phase !== 'on') return;
    const t = clock(), dt = Math.max(0, Math.min(0.25, t - G.lastT)); G.lastT = t;
    if (placingNow()) { G.placingT = t; cancelWarming('a01 is placing'); }
    // the tools
    const n = G.active;
    if (n) {
      const T = G.tools[n];
      if (T.state === 'warming' && t >= T.until) {
        const r = fire(n);
        if (r.ok) { Object.assign(T, { state: 'acting', firedT: t }); T.before = G.stack ? G.stack.levels : 0; ev({ type: 'stackTool', tool: n, phase: 'fire', args: T.args, source: T.source, cue: n }); }
        else { Object.assign(T, { state: 'cooling', until: t + TOOLS[n].cooldown }); G.active = null; G.gapUntil = t + RULES.gap; ev({ type: 'stackTool', tool: n, phase: 'failed', why: r.why }); }
      } else if (T.state === 'acting' && actDone(n, T, t)) {
        const S = measure(), effect = S.levels < T.before ? `toppled ${T.before}->${S.levels}` : S.moving > 0.3 ? 'wobbling' : 'no effect';
        Object.assign(T, { state: 'cooling', until: t + TOOLS[n].cooldown }); G.active = null; G.gapUntil = t + RULES.gap;
        G.last = { tool: n, effect, t }; ev({ type: 'stackTool', tool: n, phase: 'end', effect });
      }
    }
    for (const k of TOOL_NAMES) { const T = G.tools[k]; if (T.state === 'cooling' && t >= T.until) T.state = 'ready'; }
    // the stack
    const S = measure(); G.stack = S; G.best = Math.max(G.best, S.levels);
    G.wobble += (Math.min(1, S.moving) - G.wobble) * Math.min(1, dt / 0.3);
    if (S.settled && !placingNow()) {
      if (S.levels < G.settledLevels && G.settledLevels >= 2) {
        G.toppled++; const by = G.active || (G.last && t - G.last.t < 4 ? G.last.tool : null);
        ev({ type: 'stackToppled', from: G.settledLevels, to: S.levels, by });
      }
      G.settledLevels = S.levels;
    }
    const tall = S.levels >= TARGET.levels && S.height >= TARGET.height - 1e-3 && !placingNow() && !(sim.v2.arm.grasp && inStack(sim.v2.arm.grasp.item));
    G.hold = tall ? G.hold + dt : 0;
    if (G.hold >= TARGET.holdS) finish('won');
    else if (t - G.t0 >= TARGET.timeLimit) finish('lost', 'time');
  }

  // ------------------------------------------------------------------------------------------ what she reads, what the HUD shows
  function toolWord(k) { const T = G.tools[k], t = clock(); return T.state === 'cooling' ? `cooling ${Math.max(1, Math.ceil(T.until - t))}s` : T.state; }
  /** her compact state for a turn (JSON-able, about 100 tokens) */
  function summary() {
    const S = G.stack || measure(), t = clock(), A = sim.v2.arm;
    return { t: Math.round(t - G.t0), left: Math.max(0, Math.round(TARGET.timeLimit - (t - G.t0))),
      stack: { levels: S.levels, of: TARGET.levels, height: r2(S.height), goal: TARGET.height, wobble: r1(G.wobble), items: S.items },
      hold: r1(G.hold), needHold: TARGET.holdS, placing: placing(), a01: { carrying: A.grasp ? A.grasp.item.kind : null, atPad: atPad() },
      tools: Object.fromEntries(TOOL_NAMES.map((k) => [k, toolWord(k)])), toppled: G.toppled, last: G.last ? `${G.last.tool}: ${G.last.effect}` : null, result: G.result };
  }
  /** for a plan's triggers (matchTrigger) */
  function facts() { const S = G.stack || measure(); return { phase: G.phase, t: clock() - G.t0, levels: S.levels, height: S.height, hold: G.hold, placing: placing(), carrying: carrying(), toppled: G.toppled }; }
  /** the HUD: the stack against the target, the hold, the time left, each tool, the warning on now */
  function hud() {
    const S = G.stack || { levels: 0, height: 0, items: 0 }, t = clock(), n = G.active, T = n && G.tools[n];
    return { on: G.phase === 'on', phase: G.phase, result: G.result, levels: S.levels, target: TARGET.levels, height: r2(S.height), goal: TARGET.height, hold: r1(G.hold), holdS: TARGET.holdS,
      timeLeft: G.phase === 'on' ? Math.max(0, TARGET.timeLimit - (t - G.t0)) : 0, wobble: r1(G.wobble), label: grabLabel(), canPlace: G.phase === 'on' && carrying() && atPad() ? canPlace().ok : false,
      tools: TOOL_NAMES.map((k) => ({ name: k, state: G.tools[k].state, left: G.tools[k].state === 'cooling' || G.tools[k].state === 'warming' ? Math.max(0, G.tools[k].until - t) : 0 })),
      warning: T && T.state === 'warming' ? { tool: n, left: Math.max(0, T.until - t), args: T.args, light: lightOf(n, T.args) } : null, acting: T && T.state === 'acting' ? n : null, activeArgs: T ? T.args : null };
  }
  function takeEvents() { const e = G.events; G.events = []; return e; }
  /** end the game now (a01 left, a new run): lost 'quit'; remove(): the arena's bodies go too (the trash stays) */
  function stop(why = 'quit') { finish('lost', why); }
  function remove() { if (G.phase === 'on') finish('lost', 'removed'); sim.removeArena(); }

  return { start, update, grab, grabLabel, canPlace, placeSpot, check, applyCall, summary, facts, hud, prompt: stackPrompt, takeEvents, stop, remove, measure,
    get phase() { return G.phase; }, get result() { return G.result; }, get active() { return G.active; }, atPad, placing, state: G };
}

/** her turns in the mini game: every `gap` s (never while she is still thinking) she reads stackSummary and answers with one call, which
 *  game.applyCall checks; unreadable, slow (over `timeout` ms) or silent answers are passes. After the game is over she gets one more turn
 *  (her words on how it went), then the loop stops by itself. backend.decide({ system, user, maxTokens, signal }) -> { text } (juli.js's).
 *  radio(line): her filtered radio line; now(): ms (for the timeout); tick(t): call with game seconds, about twice a second. */
export function createStackTurns({ backend, game, radio = () => {}, gap = STACK_JULI.tick, timeout = STACK_JULI.timeout, now = () => Date.now() }) {
  const J = { busy: false, last: -1e9, done: false, stats: { calls: 0, applied: 0, refused: 0, passes: 0, timeouts: 0, garbled: 0, lastCall: null, lastWhy: '', history: [] } };
  function tick(t) {
    if (J.done || J.busy || t - J.last < gap || !backend || (backend.ready && !backend.ready())) return;
    if (game.phase === 'idle') return;
    const over = game.phase !== 'on';
    J.busy = true; J.last = t; J.stats.calls++;
    const t0 = now(), ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; let fin = false;
    const finish = (res) => {
      if (fin) return; fin = true; J.busy = false; if (over) J.done = true;
      const h = { ms: Math.round(now() - t0), out: '', limit: lim };
      // v4 (Nov 3): each turn's read-in and decode (the phone's card: all six stack turns over their limit with the helper alive)
      if (res) Object.assign(h, { prefillMs: Math.round(res.prefillMs || 0), genMs: Math.round(res.genMs || 0), tokens: res.tokens || 0, promptTokens: res.promptTokens || 0, readIn: res.snap && res.snap.readIn != null ? res.snap.readIn : null });
      if (!res) { J.stats.timeouts++; J.stats.lastCall = 'pass (timeout)'; if (ctl) ctl.abort(); h.out = 'timeout'; return note(h); }
      const c = parseCall(res.text);
      if (!c) { J.stats.garbled++; J.stats.lastCall = 'pass (unreadable)'; h.out = 'garbled'; return note(h); }
      const r = over && c.call !== 'say' && c.call !== 'pass' ? { applied: false, why: 'the game is over' } : game.applyCall(c, { source: 'live' });
      const line = filterSay(c.say, STACK_JULI.maxSay); if (line) radio(line);
      if (r.applied) { J.stats.applied++; if (c.call === 'pass') J.stats.passes++; J.stats.lastCall = c.call; } else { J.stats.refused++; J.stats.lastWhy = r.why; J.stats.lastCall = `${c.call} ✗ ${r.why}`; }
      h.out = r.applied ? c.call : 'refused:' + r.why; note(h);
    };
    const note = (h) => { J.stats.history.push(h); if (J.stats.history.length > 16) J.stats.history.shift(); };
    // v4 (Nov 3): her measured window (her read-in and her answers' length: 3-9 s), as her mischief turns; the fixed 3 s refused every
    // stack turn on the phone (her answers took ~7 s)
    const lim = backend.limitMs ? backend.limitMs(STACK_JULI.maxTokens) : timeout;
    const timer = setTimeout(() => finish(null), lim);
    let p; try { p = backend.decide({ system: stackPrompt(), user: JSON.stringify(game.summary()), maxTokens: STACK_JULI.maxTokens, signal: ctl && ctl.signal }); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then((res) => { clearTimeout(timer); finish(res && typeof res.text === 'string' ? res : { text: '' }); }, () => { clearTimeout(timer); finish({ text: '' }); });
  }
  return { tick, stats: J.stats, get busy() { return J.busy; }, get done() { return J.done; }, state: J };
}

/** her state for a turn (the same as game.summary()) */
export const stackSummary = (game) => game.summary();
