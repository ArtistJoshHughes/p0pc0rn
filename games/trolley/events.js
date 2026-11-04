// events.js - every change to the level's world goes through here: doors, obstacles and new trash. The level's own rules (the director
// below) post commands; the physics applies them at its next step (sim.apply). A controller from outside the game could post the same
// commands later (setController); none is connected, and nothing here thinks: no AI is wired into the game.
//
// Commands (plain objects, checked before they are queued):
//   { type: 'door', id: 'dock', open: true|false }
//   { type: 'obstacle', id: 'any-name', on: true, x, z, yawDeg }   a 15 kg road barricade on the floor (on: false removes it)
//   { type: 'spawnTrash', kind: 'soda'|'tin'|'water'|'beer'|'carton'|'chips'|'diesel', x, z, yawDeg, y? }   (v4: y = dropped from the hall's ceiling chute, at most 2.3 m)
// Notices the game sends back out (on/emit): 'banked' {kind, roms}, 'spill' {x, z}, 'door' {id, open}, 'trashSpawned' {...}.
import { TRASH_KINDS } from './items_spec.js';
import { TRASH_SPAWNS, HALL_SPAWNS, DOCK_BAY } from './level_spec.js';
import { inWorld } from './world_spec.js';

// anywhere on the world's floor, 0.3 m in from its fence (the hall, its yard, the plaza and the four quadrants: world_spec.js)
const inRoom = (x, z) => inWorld(x, z, 0.3);

export function validate(cmd) {
  if (!cmd || typeof cmd !== 'object') return 'not a command';
  if (cmd.type === 'door') return cmd.id === 'dock' && typeof cmd.open === 'boolean' ? null : 'door: id "dock", open true/false';
  if (cmd.type === 'obstacle') return typeof cmd.id === 'string' && cmd.id.length <= 40 && (!cmd.on || inRoom(cmd.x, cmd.z)) ? null : 'obstacle: id, on, x, z inside the world';
  if (cmd.type === 'spawnTrash') return TRASH_KINDS[cmd.kind] && inRoom(cmd.x, cmd.z) && (cmd.y == null || (cmd.y >= 0 && cmd.y <= 2.3 && Math.abs(cmd.x) < 7.6 && Math.abs(cmd.z) < 5.6)) ? null : 'spawnTrash: a known kind at x, z inside the world (a drop from y only under the hall ceiling)';
  return 'unknown command ' + String(cmd.type).slice(0, 20);
}

export function createEvents({ seed = 7 } = {}) {
  const queue = [], subs = new Map(), log = [];
  let controller = null, rnd = seed, blocked = null;   // v5: blocked(x, z): no new trash there (a01's shelter, a salvage site)
  const random = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  function post(cmd, from = 'level') {
    const why = validate(cmd) || (cmd.type === 'spawnTrash' && blocked && blocked(cmd.x, cmd.z) ? 'spawnTrash: that spot is taken (the shelter or a site)' : null);
    log.push({ cmd, from, ok: !why, why }); if (log.length > 60) log.shift();
    if (why) return { ok: false, why };
    queue.push(Object.assign({}, cmd, { from })); return { ok: true };
  }
  const drain = () => queue.splice(0, queue.length);
  const on = (type, fn) => { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(fn); return () => subs.set(type, subs.get(type).filter((f) => f !== fn)); };
  const emit = (type, payload) => { for (const fn of subs.get(type) || []) { try { fn(payload); } catch (e) { /* a listener's fault stays its own */ } } };

  // ---- the director: Level 1's fixed rules. tick(summary, t) about twice a second; summary = { trolley: {x, z}, door: {open},
  //      looseTrash: n, inDock: bool, allowSpawns: bool, hallOnly: bool (during the tutorial new trash stays in the hall) }
  const D = { lastSpawn: 0, lastDoor: -9, every: 75, maxLoose: 3 };
  function tick(s, t) {
    if (controller) { try { for (const c of [].concat(controller(s, t) || [])) post(c, 'controller'); } catch (e) { /* ignore a bad controller */ } return; }
    // the dock's shutter: up when a01 comes within 2.4 m of it, down again when the doorway has been clear (over 3.5 m away) for 4 s
    const d = Math.hypot(s.trolley.x - DOCK_BAY.door.x, s.trolley.z - DOCK_BAY.door.z);
    if (!s.door.open && d < 2.4) { post({ type: 'door', id: 'dock', open: true }); D.lastDoor = t; }
    else if (s.door.open && !s.inDock && d > 3.5 && t - D.lastDoor > 4 && !s.hoistBusy) { post({ type: 'door', id: 'dock', open: false }); D.lastDoor = t; }
    else if (d < 3.5) D.lastDoor = t;
    // new trash: once the trolley can grab, a piece every 75 s while fewer than 3 lie loose, at a spawn point at least 2 m from it
    if (s.allowSpawns && s.looseTrash < D.maxLoose && t - D.lastSpawn > D.every) {
      const ok = (s.hallOnly ? TRASH_SPAWNS.slice(0, HALL_SPAWNS) : TRASH_SPAWNS).filter(([x, z]) => Math.hypot(x - s.trolley.x, z - s.trolley.z) > 2 && !(blocked && blocked(x, z)));
      if (ok.length) {
        const [x, z] = ok[Math.floor(random() * ok.length)], kinds = ['soda', 'tin', 'water', 'beer', 'carton', 'chips'];
        post({ type: 'spawnTrash', kind: kinds[Math.floor(random() * kinds.length)], x, z, yawDeg: Math.round(random() * 180) });
        D.lastSpawn = t;
      }
    }
  }
  return { post, drain, on, emit, tick, log, setController: (fn) => { controller = typeof fn === 'function' ? fn : null; }, director: D, setBlocked: (fn) => { blocked = typeof fn === 'function' ? fn : null; } };
}
