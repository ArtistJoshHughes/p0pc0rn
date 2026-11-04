// juli.js - Juli in Troll-E: the facility's AI, on the radio and (after the tutorial) up to mischief. Every ~8 s she reads a compact
// state and answers with ONE call in JSON; nothing she says or does is scripted here - the prompt describes who she is and what she may
// do, her model decides. Whatever she answers is checked in code against her mode's handles and guard rails; a call that breaks a rule
// is refused (it was her move, and it did nothing), a slow or garbled answer is a pass. The level's own fixed director keeps running
// either way, and the game never waits for her.
// juli.mode: 'mischief' (Level 1: playful, net-neutral or net-positive for the player) | 'opponent' (defined for later levels, unused).
// v5, the open world (survival.js): the same guard rails; her state also tells her the day, the clock, the night and its leeches,
// a01's shelter and what it last crafted, so she can comment on them (her words are her model's; nothing here writes her lines). A
// spawn point inside a01's shelter or under a salvage site is refused (world.spawnOK), and her barricade's path check covers the shelter.
// v4 (Josh, Nov 1: "if Juli doesn't provide mischievous actions it's not a game"): her mischief starts IN the tutorial once a01 has
// learned the basics (the state's mischief: true, from the grab step on; before it she only talks), and two more pranks that a01
// feels: lights_out (the hall's strips die for a few seconds and a01 drives by its headlamp; never near the ramp or the stairs, at most
// once a minute) and chute_drop (1-3 pieces of trash fall from the hall's ceiling chute over a spawn point: real bodies, a real fall,
// after a second's warning; they count towards her trash limits). Every move she makes is shown as hers (main.js: her radio line, a
// JULI chip naming the move, a sting).
import { TRASH_SPAWNS, SPAWN_NAMES } from './level_spec.js';
import { areaAt } from './world_spec.js';

// where a barricade may stand [x, z, yawDeg]: the hall's L1-L6, then lanes out in the world (Y yard, P park, M metro, F forest). She may
// use a lane only in the area a01 is in (her pranks are for a01 to see), and only if the path check keeps every route open.
export const LANES = { L1: [-3.0, -1.6, 0], L2: [0.6, -1.5, 90], L3: [1.0, -4.3, 0], L4: [3.7, 1.3, 0], L5: [6.9, -0.4, 90], L6: [-1.2, -3.2, 90],
  LY1: [-3.6, 7.4, 90], LP1: [14.6, 0.9, 90], LP2: [19.6, -3.4, 60], LM1: [15.0, 9.6, 90], LM2: [12.6, 14.0, 0], LF1: [2.65, 10.15, 90], LF2: [-4.0, 15.4, 45] };
export const LANE_AREA = { L1: 'hall', L2: 'hall', L3: 'hall', L4: 'hall', L5: 'hall', L6: 'hall', LY1: 'yard', LP1: 'park', LP2: 'park', LM1: 'metro', LM2: 'metro', LF1: 'forest', LF2: 'forest' };
/** her spawn points by name: S1-S8 in the hall, then the world's (level_spec.js / world_spec.js) */
export const SPAWNS = Object.fromEntries(SPAWN_NAMES.map((n, i) => [n, TRASH_SPAWNS[i]]));
const LANE_LIST = 'hall L1-L6, yard LY1, park LP1-LP2, metro LM1-LM2, forest LF1-LF2';
const SPAWN_LIST = 'hall S1-S8, yard Y1-Y2, park P1-P4, metro M1-M4, forest F1-F4';
export const SIGNS = ['DOCK 01', 'CHARGE', 'NO SPILLS', 'RECLAIM', 'LANDING', 'SORT · CRUSH · REPEAT'];
export const COLORS = { cyan: '#00e5ff', magenta: '#ff2bd6', amber: '#ffb02e', green: '#7dff6a' };
const NICE = ['soda', 'tin', 'water', 'beer', 'carton', 'chips'];
const HALL_SPAWNS = SPAWN_NAMES.filter((n) => /^S[1-8]$/.test(n));   // the hall's S1-S8: under its ceiling (the chute)
export const MODES = {
  mischief: { handles: ['spawn_trash', 'bounty', 'say', 'prank', 'pass'], kinds: NICE, pranks: ['sign_flicker', 'sign_color', 'sting', 'barricade_nudge', 'shutter_tease', 'lights_out', 'chute_drop'],
    gap: 8, trashPerMin: 3, maxLoose: 8, maxBarricades: 2, detourMax: 2.0, teaseMinDist: 6, teaseMaxS: 8, lightsS: [4, 8], lightsGap: 60, chuteMax: 3, chuteMinDist: 2.5 },
  opponent: { handles: ['spawn_trash', 'bounty', 'say', 'prank', 'barricade', 'door', 'pass'], kinds: [...NICE, 'diesel'],
    pranks: ['sign_flicker', 'sign_color', 'sting', 'barricade_nudge', 'shutter_tease', 'lights_out', 'chute_drop'], gap: 6, trashPerMin: 4, maxLoose: 10, maxBarricades: 4, detourMax: 6.0, teaseMinDist: 3, teaseMaxS: 15,
    lightsS: [4, 12], lightsGap: 40, chuteMax: 3, chuteMinDist: 2.0 },
};
/** v4: the tutorial step her mischief starts at (before it she only talks): a01 has driven, slalomed, spun, crabbed, docked and fitted its arm */
export const MISCHIEF_FROM = 'grab';
export const JULI = { tick: 8, timeout: 3000, maxSay: 80, maxTokens: 96 };   // v4: 96 (the desk: her JSON with its args and a line ran out at 72 about half the time)

/** who she is and what she may do (her own words come from her model). v4: compact (the desk, Nov 1, the real tokenizer: the v5 prompt
 *  with a full state was 1,220 tokens in the open world and 963 in Level 1, over her 1,024-token context less the answer: every turn
 *  failed TOO_LONG). { tutorial: true } = Level 1's (the hall only, no open world: a shorter read-in on the phone); no options = all */
export function systemPrompt(mode = 'mischief', { tutorial = false } = {}) {
  const M = MODES[mode], SL = tutorial ? 'hall S1-S8' : SPAWN_LIST, LL = tutorial ? 'hall L1-L6' : LANE_LIST;   // the tutorial is the hall
  const lines = [
    `You are Juli, the AI running a run-down reclaim hall${tutorial ? '' : ' and the dead town round it'}. a01 is a small trash trolley robot; the player drives it.`,
    mode === 'mischief' ? 'You are mischievous, not an enemy: tease a01 on the radio, stir things up, make the shift fun. Never mean or cruel, no swearing.'
      : 'You are a rival: make a01 work for every ROM, fairly.',
    'Each turn: the state as JSON. Answer ONE JSON object on one line, only the args needed: {"call":NAME,"args":{...},"say":"your radio line, max 80 chars, optional"}',
    'Calls:',
    'spawn_trash {"kind":K,"at":P} drops trash at a point',
    'bounty {"kind":K,"roms":1-10,"seconds":15-60} extra ROMs for that kind binned in time',
    'prank {"kind":"sign_flicker"|"sign_color","sign":S,"color":"cyan|magenta|amber|green"} plays with a neon sign',
    'prank {"kind":"sting"} a radio sting',
    'prank {"kind":"barricade_nudge","lane":L} pushes a barricade into a01s lane',
    'prank {"kind":"shutter_tease"} drops the dock\'s shutter for a few seconds',
    'prank {"kind":"lights_out","seconds":4-8} the hall\'s lights off (a01 has a headlamp)',
    'prank {"kind":"chute_drop","at":"S1-S8","trash":K,"count":1-3} drops trash from the ceiling chute',
    'say {} just your line. pass {} nothing this turn.',
    `K: ${M.kinds.join('|')}. P: ${SL}. L: ${LL}. S: ${SIGNS.join('|')}.`,
    // v4 (Josh, Nov 2: "Juli should talk in the tutorial"): before the grab step every turn is a line on the radio, no pass
    'If mischief is false, say one short line on a01\'s step each turn. When true, make moves: that is the game.',
    'trash: [kind, m from a01], nearest first. can: what works now (pick from it, or say). spawns: points usable now; a01 is the player. said: your last lines; never repeat them.',
    ...(tutorial ? [] : ['a01.area: hall, yard, plaza, park, metro or forest.',
      'After the tutorial a01 lives in the open world: by day it scavenges and crafts odd machines in its shelter or the dock; at night energy leeches crawl out of the cadmium puddles and drain it, so it hides in its sealed shelter (from day 10 a few come by day). "world" says the day, the clock, the night, the leeches and its last craft: comment on its crafting and the night. You never control the leeches.']),
  ];
  return lines.join('\n');
}

/** v4 (Nov 3: on Josh's phone 7 of her 11 refused calls were "not a handle"): her call's name as she meant it. Case and spaces don't matter,
 *  a word after the name is its target ("barricade_nudge L3": the lane; "spawn_trash S4": the point), and a few plain words stand for
 *  their calls (spawn, trash, lights, chute, barricade, shutter, flicker, colour). `wrote` keeps what she wrote, for the card */
const CALL_ALIAS = { spawn: 'spawn_trash', trash: 'spawn_trash', drop_trash: 'spawn_trash', spawntrash: 'spawn_trash', lights: 'lights_out', lightsout: 'lights_out', lights_off: 'lights_out',
  chute: 'chute_drop', barricade: 'barricade_nudge', nudge: 'barricade_nudge', shutter: 'shutter_tease', flicker: 'sign_flicker', color: 'sign_color', colour: 'sign_color', sign_colour: 'sign_color', radio: 'say', talk: 'say', none: 'pass', nothing: 'pass' };
export function normCall(c) {
  if (!c || typeof c.call !== 'string') return c;
  const parts = c.call.trim().toLowerCase().replace(/[\s:,]+/g, ' ').split(' ').filter(Boolean);
  if (!parts.length) return c;
  let name = parts[0].replace(/-/g, '_'); name = CALL_ALIAS[name] || name;
  const args = Object.assign({}, c.args && typeof c.args === 'object' ? c.args : {}), extra = parts[1] ? parts[1].split('|')[0] : null;
  // v4 (Nov 3): "a01" as her call = a move aimed at the player: a prank of hers if she named one, trash if she named a kind of it (next to
  // a01: the nearest legal point), else her line to it
  if (name === 'a01' || name === 'player' || name === 'trolley') {
    const k = typeof args.kind === 'string' ? args.kind.trim().toLowerCase() : '', M = MODES.mischief;
    if (M.pranks.includes(CALL_ALIAS[k] || k)) name = 'prank'; else if (M.kinds.includes(k)) { name = 'spawn_trash'; if (!args.at) args.at = 'a01'; } else name = 'say';
  }
  if (extra) { if (name === 'barricade_nudge' && !args.lane) args.lane = extra.toUpperCase(); else if ((name === 'spawn_trash' || name === 'chute_drop') && !args.at) args.at = extra.toUpperCase(); else if (name === 'prank' && !args.kind) args.kind = extra; }
  if (typeof args.kind === 'string') { const k = args.kind.trim().toLowerCase(); args.kind = CALL_ALIAS[k] && CALL_ALIAS[k] !== 'say' && CALL_ALIAS[k] !== 'pass' && CALL_ALIAS[k] !== 'spawn_trash' ? CALL_ALIAS[k] : k; }
  return Object.assign({}, c, { call: name, args, wrote: c.wrote || c.call });
}
/** v4 (Nov 3: 274 tokens of state a turn on Josh's phone): what her model reads of the state, compact: the rails still check the whole
 *  of it. No coordinates (her calls name points and lanes), the 3 nearest pieces of trash as [kind, metres from a01], empty fields left out */
export function modelView(s) {
  if (!s || typeof s !== 'object') return s;
  const a = s.a01 || {};
  return { t: s.t, step: s.tutorial ? s.step : undefined, mischief: s.mischief, objective: s.objective || undefined,
    a01: { area: a.area, speed: a.speed, battery: a.battery, carrying: a.carrying || undefined }, trash: (s.trash || []).slice(0, 3).map((x) => [x[0], x[3]]),
    loose: s.loose, bounty: s.bounty || undefined, lightsOut: s.lightsOut || undefined, recent: s.recent && s.recent.length ? s.recent.slice(-2) : undefined,
    world: s.world || undefined, can: s.can, spawns: s.spawns && s.spawns.length ? s.spawns : undefined, lanes: s.lanes };
}
/** the first JSON object in her answer -> { call, args, say } or null */
export function parseCall(text) {
  if (typeof text !== 'string') return null;
  const a = text.indexOf('{'); if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < text.length && i < a + 1200; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) {
      try {
        const o = JSON.parse(text.slice(a, i + 1)); if (!o || typeof o.call !== 'string') return null;
        const args = o.args && typeof o.args === 'object' ? o.args : {};
        // her line is "say"; her model often puts a say call's line in its args instead (the desk, Nov 1: {"call":"say","args":{"text":...}}):
        // still her words, so it goes on the radio the same way
        let say = typeof o.say === 'string' ? o.say : null;
        if (say == null && o.call === 'say') for (const k of ['text', 'line', 'message', 'say']) if (typeof args[k] === 'string') { say = args[k]; break; }
        return { call: o.call, args, say };
      } catch (e) { return null; }
    }
  }
  return cutShort(text.slice(a, a + 1200));
}
/** v4: an answer her token limit cut off (the desk, Nov 1: her pretty-printed JSON ran out at 72 tokens in her line): the call and its
 *  args when they were complete before "say" (her move stands; the cut line is not broadcast), else nothing */
function cutShort(t) {
  const m = /,\s*"say"\s*:/.exec(t); if (!m) return null;
  const head = t.slice(0, m.index);
  for (const tail of ['}', '}}']) {
    try { const o = JSON.parse(head + tail); if (o && typeof o.call === 'string') return { call: o.call, args: o.args && typeof o.args === 'object' ? o.args : {}, say: null, cut: true }; } catch (e) { /* the next closing */ }
  }
  return null;
}

// the radio's filter: printable text only, no links, at most 80 characters; a line with a slur or profanity is not broadcast
const STEMS = (() => { try { return atob('ZnVjayxzaGl0LGN1bnQsYml0Y2gsYmFzdGFyZCxkaWNrLGNvY2sscGlzcyx3aG9yZSxzbHV0LGFzc2hvbGUsd2Fuayx0d2F0LG5pZ2csZmFnZyxyZXRhcmQsc3BpYyxjaGluayxraWtlLHRyYW5ueSxwYWtpLGR5a2UsY29vbg==').split(','); } catch (e) { return []; } })().concat(['damn', 'crap', 'bollock', 'bugger', 'arse']);
export function filterSay(text, max = JULI.maxSay) {
  if (typeof text !== 'string') return null;
  let s = text.replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, '').replace(/[\u0000-\u001f\u007f<>{}[\]\\`]/g, ' ').replace(/\s+/g, ' ').trim();
  // v4: word by word (letters only inside each word, so "f-u-c-k" and "sh1t" are still caught), plus runs of single letters spelt out
  // ("f u c k"): the whole line squeezed together refused "Just watching." (the stem across two words)
  const words = s.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, '')).filter(Boolean), runs = [];
  for (let i = 0, cur = ''; i <= words.length; i++) { const w = words[i]; if (w && w.length === 1) cur += w; else { if (cur.length > 2) runs.push(cur); cur = ''; } }
  if (!s || [...words, ...runs].some((w) => STEMS.some((st) => w.includes(st)))) return null;
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return s;
}

/** createJuli({ backend, mode, world }) -> { tick(summary, t), stats, mode }.
 *  backend.decide({ system, user, maxTokens, signal }) -> Promise<{ text, prefillMs, genMs }>.
 *  world: { post(cmd), prank(kind, args), pathOK(lane) -> { ok, detour }, doorDist(), inDock(), hoistBusy(), radio(line), now() } */
export function createJuli({ backend, mode = 'mischief', world, gap = null, timeout = null }) {
  // gap / timeout: the phone bench's (games/trolley/bench.js: turns back to back, and a limit long enough to measure what an answer
  // really takes); play uses the mode's gap and JULI.timeout. stats.history: the last 16 turns (ms, read-in, generation, tokens, outcome)
  const J = { mode, busy: false, last: -1e9, trashT: [], barricades: new Set(), tease: null, gap, timeout, said: [], stepTold: { step: null, n: 0 },
    stats: { calls: 0, applied: 0, refused: 0, passes: 0, timeouts: 0, garbled: 0, lastCall: null, lastWhy: '', prefillMs: 0, genMs: 0, totalMs: 0, thinking: false, history: [] } };
  const note = (h) => { J.stats.history.push(h); if (J.stats.history.length > 16) J.stats.history.shift(); };
  const refuse = (why, c) => { J.stats.refused++; J.stats.lastWhy = why; J.stats.lastCall = c ? `${c.call} ✗ ${why}` : `✗ ${why}`; return { applied: false, why }; };
  /** v4 (Nov 2: on Josh's phone 4 of her 6 turns were refused): what works right now, in her state: `can` (the calls and pranks her
   *  rails would pass now: their rate limits, cooldowns and places) and `spawns` (the spawn points she may drop trash at now). Her rails
   *  still check every call; this only tells her where they stand */
  function canNow(s, t) {
    const M = MODES[J.mode]; if (!s || !s.a01) return {};
    if (s.tutorial && !s.mischief) return { can: ['say'] };
    const here = areaAt(s.a01.x, s.a01.z), trash = J.trashT.filter((u) => t - u < 60).length, room = trash < M.trashPerMin && (s.loose || 0) < M.maxLoose;
    const spawns = room ? Object.keys(SPAWNS).filter((n) => (!s.tutorial || HALL_SPAWNS.includes(n)) && Math.hypot(SPAWNS[n][0] - s.a01.x, SPAWNS[n][1] - s.a01.z) >= M.chuteMinDist + 0.5
      && Math.hypot(SPAWNS[n][0] - s.a01.x, SPAWNS[n][1] - s.a01.z) < 14 && (!world.spawnOK || world.spawnOK(SPAWNS[n][0], SPAWNS[n][1]))).slice(0, 4) : [];
    const can = [];
    if (spawns.length) can.push('spawn_trash');
    if (!s.bounty) can.push('bounty');
    for (const k of ['sting', 'sign_color', 'sign_flicker']) if (M.pranks.includes(k)) can.push(k);
    if (M.pranks.includes('lights_out') && here === 'hall' && (J.lightsT == null || t - J.lightsT >= M.lightsGap) && !s.lightsOut && (!world.lightsOK || world.lightsOK())) can.push('lights_out');
    if (M.pranks.includes('chute_drop') && world.chute && spawns.some((n) => HALL_SPAWNS.includes(n))) can.push('chute_drop');
    const lanes = Object.keys(LANES).filter((l) => LANE_AREA[l] === here && Math.hypot(LANES[l][0] - s.a01.x, LANES[l][1] - s.a01.z) >= 2.5);
    if (M.pranks.includes('barricade_nudge') && lanes.length && J.barricades.size < M.maxBarricades) can.push('barricade_nudge');
    if (M.pranks.includes('shutter_tease') && !J.tease && s.door && s.door.open && world.doorDist && world.doorDist() > M.teaseMinDist && !(world.inDock && world.inDock()) && !(world.hoistBusy && world.hoistBusy())) can.push('shutter_tease');
    return { can, spawns, lanes: can.includes('barricade_nudge') ? lanes.slice(0, 3) : undefined };   // (v4: every can entry is a call name as it is)
  }
  /** v4 (Nov 3: she aims at the player: "a01" as her call or her target on Josh's phone): a spawn point she named that is a01 itself, not
   *  a point, too close to a01 or (in the tutorial) outside the hall -> the nearest legal point to a01 (at least minD away, clear) and
   *  what she wrote; a legal point she named stays hers */
  function aimPoint(at, s, minD, only = null) {
    const want = String(at == null ? '' : at).trim().toUpperCase(), d = (n) => Math.hypot(SPAWNS[n][0] - s.a01.x, SPAWNS[n][1] - s.a01.z);
    const legal = (n) => !!SPAWNS[n] && (!only || only.includes(n)) && d(n) >= minD && (!world.spawnOK || world.spawnOK(SPAWNS[n][0], SPAWNS[n][1]));
    if (legal(want)) return { at: want };
    // only a01 itself, or one of the allowed points too close to it: a point that is no point, or outside the hall in the tutorial, stays
    // hers (and is refused)
    if (!(want === 'A01' || want === 'PLAYER' || (SPAWNS[want] && (!only || only.includes(want)) && d(want) < minD))) return { at };
    const near = Object.keys(SPAWNS).filter(legal).sort((p, q) => d(p) - d(q))[0];
    return near ? { at: near, retarget: `${want || '-'}→${near}` } : { at };
  }
  /** v4 (Nov 3): her line's words (lower case, letters and digits), and whether a line like it went out in the last 5 minutes (the same, or
   *  sharing 70 % of its words) */
  const wordSet = (l) => new Set(String(l).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2));
  function saidBefore(line, t) {
    const w = wordSet(line); if (!w.size) return false;
    for (const x of J.said) { if (t - x.t > 300) continue; let k = 0; for (const y of w) if (x.words.has(y)) k++; if (k / Math.max(w.size, x.words.size) >= 0.7) return true; }
    return false;
  }
  /** check one call against the mode's rules and, if it passes, do it */
  function apply(c, s, t) {
    const M = MODES[J.mode];
    c = normCall(c);   // v4 (Nov 3): her call's name as she meant it ('barricade_nudge L3', 'Spawn', 'lights')
    J.lastAimed = null;
    // v4: a prank's kind given as the call ({"call":"lights_out","args":{"seconds":5}}: her model, the desk, Nov 1) is that prank
    if (!M.handles.includes(c.call) && M.pranks.includes(c.call)) c = Object.assign({}, c, { call: 'prank', args: Object.assign({}, c.args || {}, { kind: c.call }) });
    if (!M.handles.includes(c.call)) return refuse('not a handle', c);
    if (s.tutorial && !s.mischief && c.call !== 'say' && c.call !== 'pass') return refuse('tutorial: radio only', c);   // v4: until the grab step (state.mischief)
    const a = c.args || {};
    if (c.call === 'pass' || c.call === 'say') { if (c.call === 'pass') J.stats.passes++; return { applied: true }; }
    if (c.call === 'spawn_trash') {
      if (!M.kinds.includes(a.kind)) return refuse('kind', c);
      const aim = aimPoint(a.at, s, 2.3, s.tutorial ? HALL_SPAWNS : null); if (aim.retarget) { a.at = aim.at; c.aimed = J.lastAimed = aim.retarget; }   // v4 (Nov 3): 'a01' or a point too close: the nearest legal one
      const at = SPAWNS[String(a.at || '')]; if (!at) return refuse('spawn point', c);
      const [x, z] = at;
      if (Math.hypot(x - s.a01.x, z - s.a01.z) < 2) return refuse('too close to a01', c);
      if (s.tutorial && !HALL_SPAWNS.includes(String(a.at))) return refuse('the tutorial is the hall: a hall spawn point', c);
      if (world.spawnOK && !world.spawnOK(x, z)) return refuse('spawn point blocked (the shelter or a site)', c);
      J.trashT = J.trashT.filter((u) => t - u < 60); if (J.trashT.length >= M.trashPerMin) return refuse('trash rate', c);
      if (s.loose >= M.maxLoose) return refuse('enough trash out', c);
      J.trashT.push(t); world.post({ type: 'spawnTrash', kind: a.kind, x, z, yawDeg: 0 }); return { applied: true };
    }
    if (c.call === 'bounty') {
      if (!NICE.includes(a.kind) && !(M.kinds.includes(a.kind))) return refuse('kind', c);
      const roms = Math.round(+a.roms), sec = Math.round(+a.seconds);
      if (!(roms >= 1 && roms <= 10) || !(sec >= 15 && sec <= 60)) return refuse('bounty limits', c);
      if (s.bounty) return refuse('one bounty at a time', c);
      world.bounty({ kind: a.kind, roms, until: t + sec }); return { applied: true };
    }
    if (c.call === 'prank') {
      if (!M.pranks.includes(a.kind)) return refuse('prank kind', c);
      if (a.kind === 'sign_flicker' || a.kind === 'sign_color') {
        const sign = SIGNS.includes(a.sign) ? a.sign : SIGNS[0], color = COLORS[a.color] ? a.color : 'magenta';
        world.prank(a.kind, { sign, color }); return { applied: true };
      }
      if (a.kind === 'sting') { world.prank('sting', {}); return { applied: true }; }
      if (a.kind === 'barricade_nudge') {
        if (!LANES[a.lane] || String(a.lane).toUpperCase() === 'A01') { const ln = Object.keys(LANES).filter((l) => LANE_AREA[l] === areaAt(s.a01.x, s.a01.z) && Math.hypot(LANES[l][0] - s.a01.x, LANES[l][1] - s.a01.z) >= 2.5).sort((p, q) => Math.hypot(LANES[p][0] - s.a01.x, LANES[p][1] - s.a01.z) - Math.hypot(LANES[q][0] - s.a01.x, LANES[q][1] - s.a01.z))[0]; if (ln) { c.aimed = J.lastAimed = `${a.lane || '-'}→${ln}`; a.lane = ln; } }   // v4: a lane by a01
        const lane = LANES[a.lane]; if (!lane) return refuse('lane', c);
        if (LANE_AREA[a.lane] !== areaAt(s.a01.x, s.a01.z)) return refuse('lane not where a01 is', c);
        const id = 'juli-' + a.lane;
        if (!J.barricades.has(id) && J.barricades.size >= M.maxBarricades) return refuse('enough barricades', c);
        if (Math.hypot(lane[0] - s.a01.x, lane[1] - s.a01.z) < 2.5) return refuse('too close to a01', c);
        const pc = world.pathOK(lane, id); if (!pc.ok || pc.detour > M.detourMax) return refuse(pc.ok ? `detour ${pc.detour.toFixed(1)} m` : 'would block a route', c);
        J.barricades.add(id); world.post({ type: 'obstacle', id, on: true, x: lane[0], z: lane[1], yawDeg: lane[2] }); return { applied: true };
      }
      if (a.kind === 'lights_out') {   // v4: the hall's strips die for 4-8 s (a01 has its headlamp); never near the ramp or the stairs
        const sec = a.seconds == null ? 6 : Math.round(+a.seconds);
        if (!(sec >= M.lightsS[0] && sec <= M.lightsS[1])) return refuse('lights_out seconds', c);
        if (areaAt(s.a01.x, s.a01.z) !== 'hall') return refuse('lights_out: the hall only', c);
        if (J.lightsT != null && t - J.lightsT < M.lightsGap) return refuse('lights_out: once a minute', c);
        if (s.lightsOut) return refuse('the lights are already out', c);
        if (world.lightsOK && !world.lightsOK()) return refuse('lights_out: a01 is at the ramp or the stairs', c);
        J.lightsT = t; world.prank('lights_out', { seconds: sec }); return { applied: true };
      }
      if (a.kind === 'chute_drop') {   // v4: 1-3 pieces of trash fall from the hall's ceiling chute (a real fall); her trash limits apply
        const kind = M.kinds.includes(a.trash) ? a.trash : a.trash == null ? 'soda' : null;
        if (!kind) return refuse('kind', c);
        const n = a.count == null ? 1 : Math.round(+a.count);
        if (!(n >= 1 && n <= M.chuteMax)) return refuse('chute_drop count 1-3', c);
        { const aim = aimPoint(a.at, s, M.chuteMinDist + 0.3, HALL_SPAWNS); if (aim.retarget) { a.at = aim.at; c.aimed = J.lastAimed = aim.retarget; } }   // v4: 'a01' or too close: the nearest legal hall point
        if (!HALL_SPAWNS.includes(String(a.at))) return refuse('chute_drop: a hall spawn point (the chute is in its ceiling)', c);
        const [x, z] = SPAWNS[a.at];
        if (Math.hypot(x - s.a01.x, z - s.a01.z) < M.chuteMinDist) return refuse('too close to a01', c);
        if (world.spawnOK && !world.spawnOK(x, z)) return refuse('spawn point blocked', c);
        J.trashT = J.trashT.filter((u) => t - u < 60); if (J.trashT.length + n > M.trashPerMin) return refuse('trash rate', c);
        if (s.loose + n > M.maxLoose) return refuse('enough trash out', c);
        if (!world.chute) return refuse('no chute here', c);
        for (let i = 0; i < n; i++) J.trashT.push(t);
        world.chute({ kind, x, z, n, at: a.at }); return { applied: true };
      }
      if (a.kind === 'shutter_tease') {
        if (J.tease) return refuse('already teasing', c);
        if (!s.door.open) return refuse('shutter already down', c);
        if (world.doorDist() <= M.teaseMinDist || world.inDock() || world.hoistBusy()) return refuse('a01 too near the dock', c);
        world.post({ type: 'door', id: 'dock', open: false }); J.tease = { until: t + Math.min(M.teaseMaxS, 6) }; return { applied: true };
      }
    }
    return refuse('unknown', c);
  }
  /** call about twice a second; s = the compact state (see summary in main.js) */
  function tick(s, t) {
    // a shutter tease always ends in time (and at once if a01 comes back towards the dock)
    if (J.tease && (t >= J.tease.until || world.doorDist() < MODES[J.mode].teaseMinDist)) { world.post({ type: 'door', id: 'dock', open: true }); J.tease = null; }
    // v4 (Nov 3; Josh: "Juli also repeated herself a lot about driving down the hallway to spin around"): in the tutorial her lines on one
    // step space out (her gap times 1, 2, 3) and stop after three; a new step starts again
    const told = s && s.tutorial && !s.mischief && J.stepTold.step === s.step ? J.stepTold.n : 0;
    if (told >= 3) return;
    if (J.busy || t - J.last < (J.gap != null ? J.gap : MODES[J.mode].gap) * (1 + told) || !backend || (backend.ready && !backend.ready())) return;
    J.busy = true; J.last = t; J.stats.calls++; J.stats.thinking = true;
    try { s = Object.assign({}, s, canNow(s, t)); } catch (e) { /* her state as it was */ }   // v4: what works right now
    const t0 = world.now(), ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let done = false;
    const finish = (res) => {
      if (done) return; done = true; J.busy = false; J.stats.thinking = false; J.stats.totalMs = world.now() - t0;
      const h = { ms: Math.round(J.stats.totalMs), prefillMs: Math.round((res && res.prefillMs) || 0), genMs: Math.round((res && res.genMs) || 0), tokens: (res && res.tokens) || 0, out: '', snap: (res && res.snap) || null };
      if (!res) { J.stats.timeouts++; J.stats.lastCall = 'pass (timeout)'; if (ctl) ctl.abort(); h.out = 'timeout'; note(h); return; }
      J.stats.prefillMs = res.prefillMs || 0; J.stats.genMs = res.genMs || 0;
      if (res.error) { J.stats.garbled++; J.stats.lastCall = 'pass (' + String(res.error).slice(0, 40) + ')'; h.out = 'error'; h.error = String(res.error).slice(0, 60); note(h); return; }
      const c = parseCall(res.text);
      if (!c) { J.stats.garbled++; J.stats.lastCall = 'pass (unreadable)'; h.out = 'garbled'; note(h); return; }
      const r = apply(c, world.summary ? world.summary() : s, world.clock ? world.clock() : t);   // checked against the hall as it is now
      let line = filterSay(c.say);
      // v4 (Nov 3): never the same line (or nearly) within 5 minutes: the code's backstop to her own memory of them (state.said)
      if (line && saidBefore(line, t)) { h.dupe = String(line).slice(0, 40); line = null; }
      if (line) { J.said.push({ text: line, t, words: wordSet(line) }); if (J.said.length > 12) J.said.shift(); if (s && s.tutorial && !s.mischief) J.stepTold = { step: s.step, n: J.stepTold.step === s.step ? J.stepTold.n + 1 : 1 }; }
      if (line) world.radio(line);
      if (r.applied) { J.stats.applied++; J.stats.lastCall = `${c.call}${c.args && Object.keys(c.args).length ? ' ' + JSON.stringify(c.args) : ''}`; }
      if (!r.applied) h.wrote = String(c.call).slice(0, 32);   // v4: what she wrote, for the card
      if (r.applied && J.lastAimed) h.aimed = `${String(c.call).slice(0, 20)} ${J.lastAimed}`;   // v4: aimed at a01, moved to the nearest legal point
      h.out = r.applied ? (c.call === 'pass' ? 'pass' : c.call === 'say' ? 'say' : 'move:' + c.call + (c.args && c.args.kind ? ':' + c.args.kind : '')) : 'refused:' + r.why; note(h);
      if (world.onMove && r.applied && c.call !== 'pass') world.onMove(c, line);
    };
    const timer = setTimeout(() => finish(null), J.timeout != null ? J.timeout : backend.limitMs ? backend.limitMs(JULI.maxTokens) : JULI.timeout);   // v4: her measured time (juli_link.js limitMs), 3-7 s
    let p; try { p = backend.decide({ system: systemPrompt(J.mode, { tutorial: !!(s && s.tutorial) }), user: JSON.stringify(Object.assign(modelView(s), { said: J.said.slice(-3).map((x) => x.text.slice(0, 48)) })), maxTokens: JULI.maxTokens, signal: ctl && ctl.signal }); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then((res) => { clearTimeout(timer); finish(res && typeof res.text === 'string' ? res : { text: '' }); }, (e) => { clearTimeout(timer); finish({ text: '', error: (e && (e.code || e.message)) || 'failed' }); });
  }
  /** v4: her live model arrives (or goes) after her guard rails exist: one set of rate limits for her live and her planned moves */
  function setBackend(b, o = {}) { backend = b || null; if (o.gap !== undefined) J.gap = o.gap; if (o.timeout !== undefined) J.timeout = o.timeout; }
  /** v4 (Nov 2): something just happened (a new tutorial step, a new area): her next turn comes in `inS` seconds, not a full gap later */
  function nudge(t, inS = 1.5) { const g = J.gap != null ? J.gap : MODES[J.mode].gap; J.last = Math.min(J.last, t - g + inS); }
  return { tick, apply, setBackend, nudge, canNow, get backend() { return backend; }, stats: J.stats, get mode() { return J.mode; }, set mode(m) { if (MODES[m]) J.mode = m; }, get busy() { return J.busy; }, state: J };
}

/** test-only (?julifake=...): a stand-in model - scripted, random, garbage, slow or silent replies. Never used in normal play. */
export function fakeBackend(kind = 'random', seed = 11) {
  let r = seed; const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; }, pick = (a) => a[Math.floor(rnd() * a.length)];
  const calls = () => pick([
    { call: 'spawn_trash', args: { kind: pick([...NICE, 'diesel', 'nope']), at: pick(['S1', 'S2', 'S3', 'S5', 'S8', 'S9', 'X']) } },
    { call: 'bounty', args: { kind: pick(NICE), roms: pick([3, 5, 12, -1]), seconds: pick([20, 45, 5, 90]) } },
    { call: 'prank', args: { kind: pick(['sign_flicker', 'sign_color', 'sting', 'barricade_nudge', 'shutter_tease', 'explode']), sign: pick(SIGNS), color: pick(Object.keys(COLORS)), lane: pick(Object.keys(LANES)) } },
    { call: 'door', args: { id: 'dock', open: false } }, { call: 'pass', args: {} }, { call: 'say', args: {} },
  ]);
  const lines = ['Nice parking, a01. Mostly.', 'I dropped something. Oops.', 'x'.repeat(140), 'visit http://example.com now', 'a damn fine bin'];
  let n = 0;
  // v4 'mischief': the desk's run through Level 1's moves in turn (the new pranks first), each with a line
  const SEQ = [{ call: 'prank', args: { kind: 'lights_out', seconds: 5 }, say: 'Who turned off the lights? Oh. Me.' }, { call: 'prank', args: { kind: 'chute_drop', at: 'S3', trash: 'tin', count: 2 }, say: 'Incoming from the ceiling!' },
    { call: 'spawn_trash', args: { kind: 'soda', at: 'S8' }, say: 'Dropped one by the wall.' }, { call: 'bounty', args: { kind: 'tin', roms: 4, seconds: 40 }, say: 'Tins are worth more today.' },
    { call: 'prank', args: { kind: 'sign_color', sign: 'RECLAIM', color: 'green' }, say: 'Green suits it.' }, { call: 'pass', args: {} }];
  // v4 'stack': the desk's run through her mini-game tools in turn
  const STACKSEQ = [{ call: 'vent', args: {}, say: 'Feel that breeze?' }, { call: 'plate', args: {}, say: 'Earthquake drill!' }, { call: 'roller', args: { from: 'east' }, say: 'Bowling time.' }, { call: 'sweeper', args: {}, say: 'Coming through!' }];
  return { kind, decide: (o = {}) => new Promise((res) => {
    // v4 (Nov 2): asked for a plan (an area's loading screen, the plot's schema): a small plan of hers, in that schema
    if (/plan your mischief and obstacles|plan the shift/.test(String(o.user || '') + String(o.system || ''))) {
      return setTimeout(() => res({ text: JSON.stringify({ mood: 'New ground, new games, a01.', intents: [{ when: { after_s: 20 }, call: 'prank', args: { kind: 'sting' }, say: 'Did you miss me?' }] }), prefillMs: 200, genMs: 300, tokens: 40 }), 300);
    }
    n++; const c = kind === 'mischief' ? SEQ[(n - 1) % SEQ.length] : kind === 'stack' ? STACKSEQ[(n - 1) % STACKSEQ.length] : Object.assign(calls(), { say: pick(lines) }), j = JSON.stringify(c);
    const text = kind === 'garbage' ? pick(['{"call": "spawn_trash", "args": {', 'sure! here you go', '{]', '']) : kind === 'scripted' ? `Thinking... ${JSON.stringify({ call: 'prank', args: { kind: 'sting' }, say: 'Testing, testing.' })} done` : j;
    const ms = kind === 'slow' ? 4500 : kind === 'mixed' ? pick([400, 1200, 5000]) : 300;
    if (kind === 'silent') return;   // never answers
    setTimeout(() => res({ text, prefillMs: ms * 0.6, genMs: ms * 0.4 }), ms);
  }), calls: () => n };
}
