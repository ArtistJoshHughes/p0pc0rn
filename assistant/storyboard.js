// storyboard.js - p0pc0rn v023: the music video's storyboard, planned from a LANDED song (Josh, Oct 13: "Sana will always need end
// capped first frame last frame for music video storyboards otherwise drift will happen ... bare bones, user rerolls, no QA from model").
// Every shot is ONE SANA clip (the engine's real length: 81 frames at 16 fps = 5 s of picture) that runs from a FIRST frame to a LAST
// frame, both painted by Klein first (end-capped FLF; never open-ended text-to-video or picture-to-video). A 'continues' shot starts on
// the previous shot's last frame (no new paint), so one action can run across 10 or 15 seconds without a jump.
// This module is pure (no queue, no DOM): shot timing, the planner's prompt, the closed-schema check of its JSON, the deterministic
// fallback storyboard, and the likeness + safety gate every frame prompt passes (likeness.scanPrompt / stripPrompt; likeness.js is
// only called, never changed). assistant/mvflf.js runs the phases.
import { scanPrompt, stripPrompt, blockTerms } from './likeness.js';
import { getSafetyTerms, termsHit, screenRequest, CAMERA_AVOID, CLIP_SIZE } from './tools.js';

/** one shot = one SANA clip: 81 frames at 16 fps. The cut keeps 80 of them (5.0 s): a 'continues' shot's first frame IS the previous
 *  shot's last frame, so the shared frame is shown once. */
// v026.3: a shot renders 81 frames and KEEPS the first 72 (4.5 s): SANA's last frames drift toward the end keyframe (a visible morph)
export const CLIP = Object.freeze({ frames: 81, keep: 72, drop: 9, fps: 16, seconds: 4.5 });
export const NUDGE_MAX = 300;
export const LIMITS = { frameWords: [6, 90], motionWords: [3, 60], nudges: 3, chunk: 12 };
const SHOT_KEYS = new Set(['n', 'join', 'first', 'last', 'motion']);
const JOINS = { cut: 'cut', continues: 'continues', continue: 'continues', cont: 'continues', continued: 'continues' };
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const clean = (s) => String(s || '').replace(/<\|?[a-z_"]+\|?>/gi, ' ').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------------------------------------ timing
/** the song's length -> its shots (v026.3: SEGMENTS): N = ceil(duration / 4.5 s) (a tail under 0.25 s is dropped); every shot renders 81
 *  frames and keeps 72 (4.5 s); the last one keeps what is left of the song and renders the 8k+1 count that covers it + the 9 frames
 *  that are dropped (at least 17 frames). {n, start, dur (the KEPT seconds), frames (rendered), keep, seconds (rendered)} */
export function shotTimes(duration, clip = CLIP) {
  const d = Math.max(1, Number(duration) || 0), keep = clip.keep || clip.frames - 1, drop = clip.drop != null ? clip.drop : 0, per = keep / clip.fps;
  const n = Math.max(1, Math.ceil(d / per - 0.05)), out = [];
  for (let i = 0; i < n; i++) {
    const start = +(i * per).toFixed(3), left = d - start, full = i < n - 1 || left >= per - 0.05;
    const k = full ? keep : Math.max(8, Math.min(keep, Math.round(Math.max(0.5, left) * clip.fps)));
    const frames = full ? clip.frames : Math.min(clip.frames, Math.max(17, 8 * Math.ceil((k + drop - 1) / 8) + 1));
    out.push({ n: i + 1, start, dur: +(k / clip.fps).toFixed(4), frames, keep: k, seconds: (frames - 1) / clip.fps });
  }
  return out;
}
export const shotCount = (duration, clip = CLIP) => shotTimes(duration, clip).length;

/** the song's sections with rough times: the marker lines in order, time split by sung lines (an instrumental marker counts as one) */
export function songSections(lyrics, duration) {
  const secs = []; let cur = null;
  for (const raw of String(lyrics || '').split('\n')) {
    const l = raw.trim(); if (!l) continue;
    const m = /^\[([a-z -]+)\]$/i.exec(l);
    if (m) { cur = { name: m[1].toLowerCase().trim(), lines: [] }; secs.push(cur); continue; }
    if (!cur) { cur = { name: 'verse', lines: [] }; secs.push(cur); }
    cur.lines.push(l.replace(/\s+/g, ' ').slice(0, 120));
  }
  if (!secs.length) secs.push({ name: 'inst', lines: [] });
  const weight = (s) => Math.max(1, s.lines.length), total = secs.reduce((a, s) => a + weight(s), 0), d = Math.max(1, Number(duration) || 30);
  let t = 0;
  return secs.map((s) => { const len = (weight(s) / total) * d, r = { name: s.name, start: +t.toFixed(2), end: +(t + len).toFixed(2), lines: s.lines }; t += len; return r; });
}
/** shots + what the song is doing at each one (its section, and the line sung near the middle of the shot) */
export function shotSlots(song, clip = CLIP) {
  const secs = songSections(song.lyrics, song.seconds);
  return shotTimes(song.seconds, clip).map((s) => {
    const mid = s.start + s.dur / 2, sec = secs.find((x) => mid >= x.start && mid < x.end) || secs[secs.length - 1];
    const k = sec.lines.length ? Math.min(sec.lines.length - 1, Math.floor(((mid - sec.start) / Math.max(0.01, sec.end - sec.start)) * sec.lines.length)) : -1;
    return Object.assign({}, s, { section: sec.name, lyric: k >= 0 ? sec.lines[k] : '' });
  });
}

// ------------------------------------------------------------------------------------------------ the gate (likeness + safety)
/** the protected things a visual prompt must not carry: looked-up records (the phone's KB) the text names, plus famous characters
 *  and brands the static lists know (the same rule as agent.likeBlocks, without a network lookup) */
export function likeBlocksFor(text, records = []) {
  const SIG = (getSafetyTerms() || {}).signatures || {}, out = [], seen = new Set();
  for (const r of records || []) {
    if (!r) continue;
    const k = (r.source && r.source.permalink) || r.key || r.title; if (seen.has(k)) continue; seen.add(k);
    let b = null; try { b = r.like && r.like.ids ? r.like : blockTerms(r, SIG); } catch (e) { b = null; }
    if (b && scanPrompt(text, [b]).hit) out.push(b);
  }
  const pseudo = (title, cls, generic) => ({ title, cls, prot: true, ids: [title, ...title.split(/\s+/).filter((w) => w.length >= 4 && /^\p{Lu}/u.test(w))], names: [], looks: SIG[title.toLowerCase()] || [], generic });
  for (const n of termsHit(text, 'characters')) if (!out.some((b) => b.ids.some((i) => i.toLowerCase() === n))) out.push(pseudo(n.replace(/\b\w/g, (c) => c.toUpperCase()), 'character', 'an original character'));
  for (const n of termsHit(text, 'brands')) out.push(Object.assign(pseudo(n, 'brand', 'an unbranded object'), { ids: [n] }));
  return out;
}
/**
 * every frame prompt, motion line and nudge passes here before it can reach an engine:
 *  - the absolute cases (sexual content with minors, intimate imagery of real people) -> {refused}
 *  - names and look combinations of protected things -> likeness.stripPrompt (an original take, never a likeness)
 *  - coffee sentences go unless the song asked for coffee (Josh's standing rule); clip-model camera words go from motion lines
 * -> {text, like: {names, looks} | null, refused: code | null}
 */
export function gate(text, { records = [], context = '', kind = 'frame' } = {}) {
  let p = clean(text);
  const hard = screenRequest(p);
  if (hard) return { text: '', like: null, refused: hard.code };
  if (!termsHit(context, 'coffee').length && termsHit(p, 'coffee').length) p = p.split(/(?<=[.!?])\s+/).filter((x) => !termsHit(x, 'coffee').length).join(' ');
  if (kind === 'motion' && CAMERA_AVOID.test(p)) p = p.split(/(?<=[.!?])\s+/).filter((x) => !CAMERA_AVOID.test(x)).join(' ') || 'The camera holds still.';
  const blocks = likeBlocksFor(`${context}\n${p}`, records);
  const scan = scanPrompt(p, blocks);
  let like = null;
  if (scan.hit) { p = stripPrompt(p, blocks, scan); like = { names: scan.names, looks: scan.looks.flatMap((l) => l.terms) }; }
  return { text: p, like, refused: null };
}
/** a reroll's prompt: the version the person is looking at + their nudge (the last few nudges are kept, oldest dropped first) */
export function nudged(base, nudges = []) {
  const n = (nudges || []).map((x) => clean(x).slice(0, NUDGE_MAX)).filter(Boolean).slice(-LIMITS.nudges);
  return n.length ? `${clean(base).replace(/[.\s]*$/, '.')} ${n.map((x) => x.charAt(0).toUpperCase() + x.slice(1).replace(/[.\s]*$/, '.')).join(' ')}` : clean(base);
}

// ------------------------------------------------------------------------------------------------ the planner (Gemma 4 E2B)
export const PLANNER_SYS = `You are the STORYBOARD planner for a music video made on a phone. The app timed the shots: one shot for every 4.5 seconds of the song. Every shot is a clip that starts on a FIRST picture and ends on a LAST picture; both pictures are painted first and the video model only moves between them.
Answer with JSON only: {"shots":[{"n":1,"join":"cut","first":"...","last":"...","motion":"..."}, ...]} with exactly one entry per shot, n = 1, 2, 3 ... in order. No other keys.
- first and last: a picture prompt, one paragraph of 20 to 50 words: subject first, then the setting, the light, the framing, ONE style, two or three colours. A recurring character keeps the same short description every time (age, hair, one clothing colour).
- last must be reachable from first in 4.5 seconds: the same place, light and style; only a small movement or the camera moving closer apart (a step, a turn, a gesture). Never a new place inside one shot.
- join: "cut" opens the shot on a new picture (a new place or framing). "continues" starts the shot where the previous shot's clip ends (the app hands its last moment over): leave "first" out. Use "continues" to carry one action across 9 seconds (two shots); never two "continues" in a row. Shot 1 is always "cut". Cut when the song's section changes.
- motion: one or two sentences: what moves between the two pictures and what the camera does, ending with "The clip ends with" and the last picture in a few words.
- Show the world of the song: places, objects, hands at work, weather, silhouettes, a character seen from a distance or from behind. No singing close-ups, no text on screen, no real people, no famous characters, no brand names or logos, no coffee cups unless the song is about coffee.
- Give the video an arc (setup, development, turn, resolution); each shot follows its section and the line sung at that moment; the last shot echoes the first.`;
const PREFIX = '{"shots":[{"n":';

/** the planner's messages for shots [from, to) of the song (a long song is planned in chunks of LIMITS.chunk shots) */
export function plannerMessages({ song, slots, direction = '', shape = 'tall', from = 0, to = slots.length, prevLast = '' }) {
  const lyr = String(song.lyrics || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40).join('\n');
  const list = slots.slice(from, to).map((s) => `${s.n}. ${clock(s.start)}-${clock(s.start + s.dur)} ${s.section}${s.lyric ? ` - "${s.lyric}"` : ''}`).join('\n');
  const u = [`Song: "${clean(song.title) || 'Untitled'}" (${clean(song.tags).slice(0, 160)}), ${Math.round(song.seconds)} seconds.`,
    direction ? `Direction from the person: ${clean(direction).slice(0, NUDGE_MAX)}` : '',
    `Shape: ${shape === 'wide' ? 'wide 16:9' : 'tall 9:16 (phone screen)'}.`,
    lyr ? `Lyrics:\n${lyr}` : 'Instrumental.',
    from > 0 && prevLast ? `Shot ${from} (already planned) ends on: ${prevLast}` : '',
    `Write shots ${slots[from].n} to ${slots[to - 1].n} (${to - from} shots):\n${list}`].filter(Boolean).join('\n');
  return [{ role: 'system', content: PLANNER_SYS }, { role: 'user', content: u }];
}
/** the forced start of the answer (the engine's `prefix`): the JSON can only begin one way */
export const plannerPrefix = (from, slots) => PREFIX + slots[from].n + ',';
/** the model's text -> the shot objects it wrote, complete rows only (a cut-off answer keeps what it finished) | null */
export function parsePlan(raw) {
  const t = clean(raw).replace(/^[^{]*/, '');
  if (!t) return null;
  try { const o = JSON.parse(t); return o && Array.isArray(o.shots) ? o.shots : null; } catch (e) { /* salvage below */ }
  const at = t.indexOf('['); if (at < 0) return null;
  const rows = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = at + 1; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { rows.push(JSON.parse(t.slice(start, i + 1))); } catch (e) { /* a broken row is skipped */ } start = -1; } if (depth < 0) break; }
    else if (ch === ']' && depth === 0) break;
  }
  return rows.length ? rows : null;
}
/**
 * THE CLOSED SCHEMA. A row is kept only as {n, join, first, last, motion}: other keys are dropped; n must be an integer in this
 * chunk's range and not repeated; join is 'cut' | 'continues' (shot 1 is always a cut); first (cuts only), last and motion are plain
 * strings of LIMITS words. A field that fails is filled from the fallback storyboard; a shot with nothing usable is the fallback's.
 * -> {rows: Map n -> {join, first, last, motion, bad: [fields]}, dropped: [reasons]}
 */
export function checkRows(rows, slots) {
  const ns = new Set(slots.map((s) => s.n)), out = new Map(), dropped = [];
  (Array.isArray(rows) ? rows : []).forEach((o, i) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) { dropped.push(`row ${i + 1}: not an object`); return; }
    const extra = Object.keys(o).filter((k) => !SHOT_KEYS.has(k)); if (extra.length) dropped.push(`row ${i + 1}: extra keys ${extra.join(',')} dropped`);
    const n = o.n == null && slots[i] ? slots[i].n : Number(o.n);
    if (!Number.isInteger(n) || !ns.has(n)) { dropped.push(`row ${i + 1}: n ${JSON.stringify(o.n)} is not a shot`); return; }
    if (out.has(n)) { dropped.push(`row ${i + 1}: shot ${n} repeated`); return; }
    const bad = [], str = (v, [lo, hi], f) => { const s = typeof v === 'string' ? clean(v) : ''; if (!s || words(s) < lo || words(s) > hi) { bad.push(f); return ''; } return s; };
    let join = JOINS[String(o.join || '').toLowerCase().trim()] || 'cut';
    if (n === slots[0].n && slots[0].n === 1) join = 'cut';
    const r = { join, first: join === 'cut' ? str(o.first, LIMITS.frameWords, 'first') : '', last: str(o.last, LIMITS.frameWords, 'last'), motion: str(o.motion, LIMITS.motionWords, 'motion'), bad };
    if (!r.last && !r.motion && !(join === 'cut' && r.first)) { dropped.push(`shot ${n}: nothing usable`); return; }
    out.set(n, r);
  });
  return { rows: out, dropped };
}

// ------------------------------------------------------------------------------------------------ the deterministic fallback
const LOOK = { intro: ['at first light', 'pale blue and soft gold'], verse: ['in warm late-afternoon sun', 'amber and teal'], 'pre-chorus': ['at dusk', 'violet and amber'],
  chorus: ['at night under glowing signs', 'magenta and deep blue'], hook: ['at night under glowing signs', 'magenta and deep blue'], bridge: ['in soft rain', 'cool grey and silver'],
  solo: ['under a single warm lamp', 'gold and black'], break: ['in still, misty air', 'grey-green and white'], inst: ['in still, misty air', 'grey-green and white'], outro: ['at sunrise', 'pale gold and blue'] };
const PLACES = ['an empty city street lined with closed shops', 'a rooftop above the city', 'a quiet train platform', 'a long road through open fields', 'a shoreline with low waves',
  'a narrow stairway between old buildings', 'a bridge over a wide river', 'a forest path between tall pines', 'a small room with one tall window', 'a hill above the town'];
// [the first picture's pose, the last picture's pose, what moves between them]
const STEPS = [['standing still', 'a few steps further along', 'takes a few slow steps forward'], ['looking out at the view', 'turned a little to the left', 'turns slowly to the left'],
  ['walking away from the camera', 'stopped with one hand raised', 'stops and lifts one hand'], ['sitting on a low wall', 'standing and looking ahead', 'stands up and looks ahead']];
function styleOf(tags) {
  const t = String(tags || '').toLowerCase();
  return /synth|neon|retro|80s|electro/.test(t) ? 'cinematic film still with neon reflections' : /folk|acoustic|country|ballad/.test(t) ? 'warm cinematic photograph'
    : /rock|punk|metal/.test(t) ? 'high-contrast cinematic film still' : /lo-?fi|chill|ambient/.test(t) ? 'soft painterly illustration' : 'cinematic film still';
}
/** a plain, safe storyboard that always works (same song -> the same storyboard): scenes of two shots (a cut, then a continue), a
 *  recurring figure seen from behind or at a distance, the place and light following the song's sections */
export function fallbackShots(song, slots, direction = '') {
  const style = styleOf(song.tags), who = 'a lone figure in a dark jacket', mood = clean(direction).split(/[.!?]/)[0].slice(0, 90);
  let h = 7; for (const ch of String(song.title || '') + String(song.tags || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = new Map();
  slots.forEach((s, i) => {
    const prev = slots[i - 1], sectionChange = !!prev && prev.section !== s.section;
    const join = i === 0 || sectionChange || i % 2 === 0 ? 'cut' : 'continues';
    const scene = Math.floor(i / 2), place = PLACES[(h + scene) % PLACES.length], [light, colours] = LOOK[s.section] || LOOK.verse, [a, b, move] = STEPS[(h + i) % STEPS.length];
    const frame = (act, size) => `${who.charAt(0).toUpperCase() + who.slice(1)}, ${act}, on ${place} ${light}, seen from behind, ${size}, ${style}, ${colours}${mood ? `, the mood of ${mood}` : ''}.`;
    out.set(s.n, { join, first: join === 'cut' ? frame(a, 'wide shot') : '', last: frame(b, join === 'cut' ? 'medium-wide shot' : 'medium shot'),
      motion: `The figure ${move} while the light holds steady; the camera moves slowly closer. The clip ends with the figure ${b} on ${place.replace(/^an? /, 'the ')}.` });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ the storyboard
/**
 * rows (model, already checked) + the fallback -> the storyboard the phases run:
 * {v, source, clip, width, height, shape, shots: [{n, start, dur, frames, section, lyric, join, first: k, last: k, motion, src}],
 *  frames: [{k, prompt, shot, end ('first' | 'last'), src}], like: [{where, names, looks}], dropped}
 * Every frame prompt and motion line went through gate(). A 'continues' shot's first frame is the previous shot's last frame index (its
 * end keyframe) in this list; v026.3: the take itself starts on the previous take's last KEPT frame (the handoff), see mvflf.js.
 */
export function buildStoryboard({ song, slots, rows = new Map(), dropped = [], direction = '', shape = 'tall', records = [] }) {
  const fb = fallbackShots(song, slots, direction), [width, height] = CLIP_SIZE[shape === 'wide' ? 'wide' : 'tall'];
  const ctx = [song.title, song.tags, song.lyrics, direction].filter(Boolean).join(' \n ');
  const frames = [], shots = [], like = [];
  let model = 0, fall = 0;
  const pass = (text, where, kind, fallbackText) => {
    let g = gate(text, { records, context: ctx, kind });
    if (g.refused || !g.text) { like.push({ where, refused: g.refused || 'EMPTY' }); g = gate(fallbackText, { records, context: ctx, kind }); }
    if (g.like) like.push(Object.assign({ where }, g.like));
    return g.text;
  };
  for (const s of slots) {
    const r = rows.get(s.n), f = fb.get(s.n), pick = (field) => (r && r[field] && !r.bad.includes(field) ? r[field] : null);
    let join = r ? r.join : f.join; if (!shots.length) join = 'cut';
    // v026.3: a beat is at most 9 s (two chained segments): a 'continues' after a 'continues' becomes a cut (its first frame from the fallback)
    if (join === 'continues' && shots.length && shots[shots.length - 1].join === 'continues') { join = 'cut'; dropped.push(`shot ${s.n}: a third chained segment became a cut (a beat is at most 9 s)`); }
    const firstTxt = join === 'cut' ? (pick('first') || f.first || fb.get(s.n).last) : null;
    const lastTxt = pick('last') || f.last, motionTxt = pick('motion') || f.motion;
    const src = r && pick('last') && pick('motion') && (join !== 'cut' || pick('first')) ? 'model' : r ? 'mixed' : 'fallback';
    if (src === 'model') model++; else fall++;
    let firstK;
    if (join === 'cut') { firstK = frames.length; frames.push({ k: firstK, prompt: pass(firstTxt, `shot ${s.n} first`, 'frame', f.first || f.last), shot: s.n, end: 'first', src }); }
    else firstK = shots[shots.length - 1].last;
    const lastK = frames.length; frames.push({ k: lastK, prompt: pass(lastTxt, `shot ${s.n} last`, 'frame', f.last), shot: s.n, end: 'last', src });
    let motion = pass(motionTxt, `shot ${s.n} motion`, 'motion', f.motion);
    if (!/the clip ends with/i.test(motion)) motion = `${motion.replace(/[.\s]*$/, '.')} The clip ends with ${frames[lastK].prompt.split(/[,.]/)[0].replace(/^./, (c) => c.toLowerCase())}.`;
    shots.push({ n: s.n, start: s.start, dur: s.dur, frames: s.frames, keep: s.keep, seconds: s.seconds, section: s.section, lyric: s.lyric, join, first: firstK, last: lastK, motion, src });
  }
  return { v: 1, source: !model ? 'fallback' : fall ? 'mixed' : 'model', clip: Object.assign({}, CLIP), width, height, shape: shape === 'wide' ? 'wide' : 'tall', shots, frames, like, dropped: dropped.slice(0, 20) };
}
/** the frames a shot repaints when its reroll says "Repaint the stills": its own last frame always, its first only when it opens on a
 *  cut (a 'continues' shot's first frame belongs to the shot before it) */
export function ownedFrames(sb, n) { const s = sb.shots.find((x) => x.n === n); return !s ? [] : s.join === 'cut' ? [s.first, s.last] : [s.last]; }
/** the shots that show frame k (a shared frame ends one shot and opens the next) */
export const shotsOfFrame = (sb, k) => sb.shots.filter((s) => s.first === k || s.last === k).map((s) => s.n);

/**
 * the whole plan step on the loaded assistant: chat(messages, {maxTokens, prefix}) -> {text}. Chunks of LIMITS.chunk shots, each
 * one forced to start as JSON; whatever is unusable is filled by the fallback. -> buildStoryboard(...) + {calls}
 */
export async function planStoryboard({ chat, song, slots, direction = '', shape = 'tall', records = [], moreRecords = null, onProgress = null, signal = null }) {
  const rows = new Map(), dropped = [], calls = [];
  for (let from = 0; from < slots.length; from += LIMITS.chunk) {
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const to = Math.min(slots.length, from + LIMITS.chunk), prevN = from ? slots[from - 1].n : 0, prev = prevN && rows.get(prevN);
    const prefix = plannerPrefix(from, slots), messages = plannerMessages({ song, slots, direction, shape, from, to, prevLast: prev ? prev.last : '' });
    let raw = '';
    try {
      const r = await chat(messages, { maxTokens: Math.min(3000, 170 * (to - from) + 200), prefix });
      raw = typeof r === 'string' ? r : (r && (r.raw != null ? r.raw : r.text)) || '';
      if (prefix && !clean(raw).startsWith('{')) raw = prefix + raw;   // an engine that did not echo the forced start
    } catch (e) { if (e && (e.name === 'AbortError' || e.code === 'ABORTED')) throw e; dropped.push(`planner call failed: ${(e && (e.code || e.message)) || e}`); }
    const got = checkRows(parsePlan(raw), slots.slice(from, to));
    for (const [n, r] of got.rows) rows.set(n, r);
    dropped.push(...got.dropped);
    calls.push({ from: from + 1, to, chars: raw.length, kept: got.rows.size });
    if (onProgress) onProgress({ phase: 'plan', frac: to / slots.length, message: `Shots ${from + 1}-${to} of ${slots.length}` });
  }
  // v023: real people the plan (or the direction) names, found by name (moreRecords -> person records), join the gate's records
  if (moreRecords) {
    try {
      const extra = await moreRecords([direction, ...[...rows.values()].flatMap((r) => [r.first, r.last, r.motion])].filter((t) => typeof t === 'string' && t));
      if (extra && extra.length) records = [...(records || []), ...extra];
    } catch (e) { if (e && (e.name === 'AbortError' || e.code === 'ABORTED')) throw e; dropped.push(`real-person check failed: ${(e && (e.code || e.message)) || e}`); }
  }
  return Object.assign(buildStoryboard({ song, slots, rows, dropped, direction, shape, records }), { calls });
}
