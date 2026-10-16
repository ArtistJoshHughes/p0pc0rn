// tools.js - the assistant's tools: their declarations (rendered into Gemma 4's system turn by gemma4.renderPrompt), a CLOSED
// validator for every call (types, enums with synonyms, lengths; repairs are noted, anything else is an error the model is told about),
// the mapping from a valid call to a queue job, ACE-Step lyric normalisation, and the deterministic safety screen (safety_terms.json).
import { neutralise } from './gemma4.js';

// animate (image -> clip) and between (first still -> last still): the engine side is being probed; the model id is ONE value here
// (SANA-Video 2.0's base release does text-image-to-video; the 4-step preview is text-only) - change it when the probe settles.
export const MODEL = { picture: 'flux2-klein-4b', edit: 'flux2-klein-4b', clip: 'sanavideo2-5b', animate: 'sanavideo2-5b', between: 'sanavideo2-5b', foley: 'mmaudio-small-44k', song: 'acestep15-turbo', chat: 'gemma4-e2b' };
export const PIC_SIZE = { wide: [1280, 720], tall: [720, 1280], square: [768, 768] };
export const CLIP_SIZE = { wide: [832, 480], tall: [480, 832] };
export const FRAMES = { 1: 17, 2: 33, 3: 49, 4: 65, 5: 81 };                 // 8k + 1 frames at 16 fps
export const MINUTES = { picture: 3, edit: 4, clip: 6, animate: 6, between: 7, foley: 2, song: 2 };   // phone estimates (iPhone 16 Pro Max; animate/between unmeasured)

const S = (description, extra = {}) => Object.assign({ type: 'string', description }, extra);
/** declarations in the shape renderPrompt() takes ({type:'function', function:{name, description, parameters}}) */
export const DECLS = {
  make_picture: { description: 'Make one new picture from words (about 3 minutes). Use for any request to draw, paint or picture something.', parameters: { type: 'object', properties: {
    prompt: S('One paragraph of 30 to 90 words: subject first, then setting, light, framing, one style, two or three colours.'),
    shape: S('wide (default), tall (phone screens) or square', { enum: ['wide', 'tall', 'square'] }),
    quality: S('best (default, 4 steps) or fast (3 steps, softer)', { enum: ['best', 'fast'] }) }, required: ['prompt'] } },
  edit_picture: { description: "Change an existing picture: the last result, or the person's own photo.", parameters: { type: 'object', properties: {
    prompt: S('The change as an instruction plus what must stay the same.'),
    source: S('last_result (default) or my_photo', { enum: ['last_result', 'my_photo'] }),
    keep: S('loose follows the words (default, faster); close copies the photo more exactly', { enum: ['loose', 'close'] }),
    shape: S('wide, tall or square; default = the shape of the source', { enum: ['wide', 'tall', 'square'] }) }, required: ['prompt'] } },
  make_clip: { description: 'Make one silent video clip from words, 1 to 5 seconds (about 6 minutes).', parameters: { type: 'object', properties: {
    prompt: S('One paragraph of 50 to 110 words: scene, subject, ONE action, ONE camera behaviour, and a last sentence starting "The clip ends with".'),
    seconds: { type: 'integer', description: '1 to 5 (default 5)' },
    shape: S('wide (default) or tall', { enum: ['wide', 'tall'] }) }, required: ['prompt'] } },
  animate_picture: { description: 'Bring a picture to life: a short clip that starts from the picture (about 6 minutes).', parameters: { type: 'object', properties: {
    prompt: S('What MOVES and what the camera does; the picture already shows the scene. One paragraph, ending with a sentence starting "The clip ends with".'),
    source: S('last_result (default) or my_photo', { enum: ['last_result', 'my_photo'] }),
    seconds: { type: 'integer', description: '1 to 5 (default 5)' },
    shape: S('wide or tall; default = the shape of the picture', { enum: ['wide', 'tall'] }) }, required: ['prompt'] } },
  clip_between: { description: 'A clip that starts on one picture and ends on another (about 7 minutes).', parameters: { type: 'object', properties: {
    prompt: S('The change between the two pictures: what moves, in which order, the camera path; end with "The clip ends with" matching the end picture.'),
    start: S('the START picture: earlier_picture (default), latest_picture or my_photo', { enum: ['earlier_picture', 'latest_picture', 'my_photo'] }),
    end: S('the END picture: latest_picture (default), earlier_picture or my_photo', { enum: ['latest_picture', 'earlier_picture', 'my_photo'] }),
    seconds: { type: 'integer', description: '1 to 5 (default 5)' } }, required: ['prompt'] } },
  add_sound: { description: 'Add matching sound effects to the last clip (personal, non-commercial use only).', parameters: { type: 'object', properties: {
    prompt: S('Optional: 2 to 6 short sound phrases, e.g. "waves on rocks, gulls". No music, no speech.'),
    clip: S('last_clip', { enum: ['last_clip'] }) }, required: [] } },
  make_song: { description: 'Make a song with vocals (or instrumental), 10 to 60 seconds.', parameters: { type: 'object', properties: {
    title: S('Short song title'),
    tags: S('Style tags: genre, mood, instruments, voice. No artist names.'),
    bpm: { type: 'integer', description: 'Tempo for the style (ballad 70-85, pop 100-120, dance 120-128).' },
    key: S('Optional key, e.g. "A minor".'),
    time_signature: S('Optional: 4/4, 3/4, 6/8 or 2/4', { enum: ['4/4', '3/4', '6/8', '2/4'] }),
    lyrics: S('Optional lyrics, [verse] [chorus] markers on their own lines. Leave empty and they are written for you.'),
    seconds: { type: 'integer', description: 'The length asked for, 10 to 60 (default 60)' } }, required: ['tags', 'bpm'] } },   // v026.8: shorter docs
  make_music_video: { description: 'Make a music video: a new song (or the last song), shots, clips and the cut. Takes about an hour.', parameters: { type: 'object', properties: {
    idea: S('The concept in one or two sentences: story, world, mood.'),
    title: S('Song title'),
    tags: S('Song style tags.'),
    bpm: { type: 'integer', description: 'Song tempo.' },
    lyrics: S('Optional song lyrics; leave empty to have them written.'),
    seconds: { type: 'integer', description: '30 (default) or 60' },
    shape: S('tall (default, vertical) or wide', { enum: ['tall', 'wide'] }),
    song: S('new (default) or last_song', { enum: ['new', 'last_song'] }) }, required: ['idea'] } },
  research: { description: 'Look up facts on Wikipedia, or a fan wiki for films, games, comics and shows, before drawing or describing a real or fictional subject.', parameters: { type: 'object', properties: {
    topic: S('The exact name, e.g. "Hells Canyon".'),
    kind: S('real or popculture', { enum: ['real', 'popculture'] }),
    franchise: S('For popculture: the franchise, e.g. "zelda".') }, required: ['topic', 'kind'] } },
  look_at_result: { description: 'Give your verdict on the result you were shown.', parameters: { type: 'object', properties: {
    verdict: S('accept, or reroll for a real problem', { enum: ['accept', 'reroll'] }),
    issue: S('the main problem, or none', { enum: ['none', 'wrong_subject', 'anatomy', 'garbled_text', 'framing', 'style', 'motion', 'morphing', 'other'] }),
    fix_prompt: S('For reroll: the whole new prompt that fixes the cause.') }, required: ['verdict', 'issue'] } },
  ask_user: { description: 'Ask the person one short question when the request is unclear.', parameters: { type: 'object', properties: {
    question: S('One short question.'),
    options: { type: 'array', items: { type: 'string' }, description: 'Up to 4 short choices.' } }, required: ['question'] } },
  // internal tools (music-video planning), never offered in the main loop
  plan_shots: { description: 'Write the clip prompt for every shot slot.', parameters: { type: 'object', properties: {
    shots: { type: 'array', description: 'One entry per slot, in order.', items: { type: 'object', properties: { n: { type: 'integer', description: 'slot number' }, prompt: S('the clip prompt for this slot'),
      still: S('Optional, only when the shot must match others (a recurring character, the same room): a picture prompt for its first frame; the clip then starts from that picture and the prompt describes only the motion.') }, required: ['n', 'prompt'] } } }, required: ['shots'] } },
  review_shots: { description: 'List the shots that must be made again (empty list = all good).', parameters: { type: 'object', properties: {
    rerolls: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, issue: S('the problem', { enum: ['wrong_subject', 'anatomy', 'morphing', 'repeats_neighbour', 'other'] }), fix_prompt: S('the whole new clip prompt') }, required: ['n', 'issue', 'fix_prompt'] } } }, required: ['rerolls'] } },
  // p0pc0rn v021: the grounded song's subject (agent.js groundSong), sorted by the model in a focused, forced call
  // v022: the likeness second check and its one generic regeneration (forced calls, never offered to the planner)
  recognisable: { description: 'Say whether the prompt would let someone recognise the subject.', parameters: { type: 'object', properties: {
    answer: S('yes or no', { enum: ['yes', 'no'] }) }, required: ['answer'] } },
  original_prompt: { description: 'The prompt rewritten as an original scene.', parameters: { type: 'object', properties: {
    prompt: S('One or two sentences: an archetype, a role, an era, a setting, a mood, materials and a palette. No names, emblems, logos, signature outfits or colour combinations.') }, required: ['prompt'] } },
  song_subject: { description: 'Say what the song is about, so its facts can be looked up.', parameters: { type: 'object', properties: {
    kind: S('real (a real person, place, event, ship, building, object or work), popculture (a character, game, film, show, comic or franchise), personal (the person\'s own life, family, friends or pets) or abstract (a feeling, a season, a mood, an idea, or an everyday scene or thing such as the last train home or a rainy night)', { enum: ['real', 'popculture', 'personal', 'abstract'] }),
    topic: S('For real or popculture: the exact name to look up, as an encyclopedia title, e.g. "SS Edmund Fitzgerald", "Golden Gate Bridge", "Hylian Shield". Empty otherwise.'),
    franchise: S('For popculture: the franchise or fan wiki name, e.g. "zelda", "star wars".') }, required: ['kind'] } },
  write_song: { description: 'Write the song: title, style, tempo and lyrics.', parameters: { type: 'object', properties: {
    title: S('Short title'), tags: S('6 to 12 style tags (no tempo, no artist names)'),
    bpm: { type: 'integer', description: 'Tempo chosen for the style (ballad 70-85, pop 100-120, house 120-128, drum and bass 170).' },
    key: S('Optional key, e.g. "A minor", "E major".'),
    time_signature: S('Optional: 4/4 (default), 3/4, 6/8 or 2/4', { enum: ['4/4', '3/4', '6/8', '2/4'] }),
    lyrics: S('Lyrics with plain section markers: verse, chorus, short verse, chorus; at most (seconds - 6) x bpm / 480 sung lines') }, required: ['title', 'tags', 'bpm', 'lyrics'] } },
};
export const MAIN_TOOLS = ['make_picture', 'edit_picture', 'make_clip', 'animate_picture', 'clip_between', 'add_sound', 'make_song', 'make_music_video', 'research', 'ask_user'];
export const RENDER_TOOLS = new Set(['make_picture', 'edit_picture', 'make_clip', 'animate_picture', 'clip_between', 'add_sound', 'make_song', 'make_music_video']);
export const CLIP_KINDS = new Set(['clip', 'animate', 'between']);
export const decls = (names) => names.map((n) => ({ type: 'function', function: Object.assign({ name: n }, DECLS[n]) }));

// ------------------------------------------------------------------------------------------------ validation (closed)
const SYN = {
  shape: { landscape: 'wide', horizontal: 'wide', '16:9': 'wide', widescreen: 'wide', cinematic: 'wide', portrait: 'tall', vertical: 'tall', '9:16': 'tall', story: 'tall', reel: 'tall', phone: 'tall', '1:1': 'square', 'square format': 'square' },
  quality: { high: 'best', hq: 'best', max: 'best', normal: 'best', quick: 'fast', draft: 'fast', low: 'fast' },
  source: { last: 'last_result', result: 'last_result', previous: 'last_result', last_picture: 'last_result', photo: 'my_photo', upload: 'my_photo', user_photo: 'my_photo', my_picture: 'my_photo' },
  keep: { exact: 'close', faithful: 'close', strict: 'close', free: 'loose', creative: 'loose' },
  time_signature: { '4': '4/4', 'common time': '4/4', '4-4': '4/4', '3': '3/4', waltz: '3/4', '3-4': '3/4', '6-8': '6/8', '2-4': '2/4' },
  kind: { pop: 'popculture', 'pop culture': 'popculture', 'pop-culture': 'popculture', fiction: 'popculture', fictional: 'popculture', franchise: 'popculture', game: 'popculture', film: 'popculture', movie: 'popculture', encyclopedia: 'real', fact: 'real', place: 'real', person: 'real' },
  verdict: { ok: 'accept', good: 'accept', yes: 'accept', keep: 'accept', retry: 'reroll', redo: 'reroll', again: 'reroll', reject: 'reroll', no: 'reroll' },
  song: { last: 'last_song', previous: 'last_song', existing: 'last_song' },
  start: { earlier: 'earlier_picture', previous: 'earlier_picture', previous_result: 'earlier_picture', first: 'earlier_picture', older: 'earlier_picture', latest: 'latest_picture', newest: 'latest_picture', last_result: 'latest_picture', photo: 'my_photo', upload: 'my_photo' },
  end: { latest: 'latest_picture', newest: 'latest_picture', last_result: 'latest_picture', last: 'latest_picture', earlier: 'earlier_picture', previous: 'earlier_picture', previous_result: 'earlier_picture', photo: 'my_photo', upload: 'my_photo' },
  clip: { last: 'last_clip', latest: 'last_clip', previous: 'last_clip' },
};
const LEN = { prompt: [8, 900], fix_prompt: [8, 900], idea: [4, 600], tags: [3, 300], lyrics: [0, 2500], title: [1, 80], topic: [2, 80], franchise: [0, 40], question: [3, 240] };
const cleanStr = (v) => neutralise(String(v)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
function clip(s, max) { if (s.length <= max) return s; const cut = s.slice(0, max); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' ')); return (i > max * 0.6 ? cut.slice(0, i + 1) : cut).trim(); }

/** -> {ok, args (normalised), errors: [string], repairs: [string]}. opts.seconds: make_song's length as the person asked for it
 *  (songSecondsFrom on their message); it wins over the model's value */
export function validate(name, args, opts = {}) {
  const d = DECLS[name];
  if (!d) return { ok: false, args: {}, errors: [`unknown tool "${name}". Use one of: ${MAIN_TOOLS.join(', ')}`], repairs: [] };
  const P = d.parameters.properties, out = {}, errors = [], repairs = [];
  args = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if ((name === 'make_song' || name === 'write_song' || name === 'make_music_video') && P.bpm) {
    args = Object.assign({}, args);
    if (args.bpm === undefined || args.bpm === null || args.bpm === '') {
      const fromTags = bpmFromTags(args.tags);
      if (fromTags) { args.bpm = fromTags; repairs.push(`bpm read from the tags: ${fromTags}`); }
      else if (name !== 'make_music_video') { args.bpm = SONG_DEFAULTS.bpm; repairs.push(`bpm missing -> ${SONG_DEFAULTS.bpm} (the planner's default)`); }
    }
  }
  for (const k of Object.keys(args)) if (!P[k]) repairs.push(`dropped unknown argument "${k}"`);
  for (const [k, spec] of Object.entries(P)) {
    let v = args[k];
    if (v === undefined || v === null || v === '') { if (d.parameters.required.includes(k)) errors.push(`"${k}" is required`); continue; }
    if (spec.type === 'string') {
      if (typeof v !== 'string') { v = Array.isArray(v) ? v.join(', ') : String(v); repairs.push(`${k} made text`); }
      v = cleanStr(v);
      if (spec.enum) {
        const low = v.toLowerCase().replace(/\s+/g, ' ').trim(), syn = (SYN[k] || {})[low];
        const hit = spec.enum.find((e) => e === low) || syn || spec.enum.find((e) => low.replace(/[ -]/g, '_') === e);
        if (!hit) { errors.push(`"${k}" must be one of ${spec.enum.join(', ')} (got "${v.slice(0, 30)}")`); continue; }
        if (hit !== v) repairs.push(`${k} "${v.slice(0, 20)}" -> ${hit}`);
        v = hit;
      } else if (LEN[k]) {
        const [mn, mx] = LEN[k];
        if (v.length < mn) { errors.push(`"${k}" is too short`); continue; }
        if (v.length > mx) { v = clip(v, mx); repairs.push(`${k} shortened to ${mx} characters`); }
      }
    } else if (spec.type === 'integer' || spec.type === 'number') {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(n)) { errors.push(`"${k}" must be a number`); continue; }
      if (typeof v !== 'number') repairs.push(`${k} read as ${n}`);
      v = spec.type === 'integer' ? Math.round(n) : n;
    } else if (spec.type === 'array') {
      if (!Array.isArray(v)) { if (typeof v === 'string') { v = v.split(/\s*[,;|]\s*/).filter(Boolean); repairs.push(`${k} split into a list`); } else { errors.push(`"${k}" must be a list`); continue; } }
      if (spec.items && spec.items.type === 'object') {
        const ip = spec.items.properties, list = [];
        for (const it of v) {
          if (!it || typeof it !== 'object') continue;
          const o = {};
          for (const [ik, is] of Object.entries(ip)) {
            let x = it[ik];
            if (x === undefined || x === null) continue;
            if (is.type === 'integer') { x = Math.round(Number(x)); if (!Number.isFinite(x)) continue; }
            else { x = cleanStr(x); if (is.enum) { const low = x.toLowerCase(); x = is.enum.find((e) => e === low) || is.enum.find((e) => low.replace(/[ -]/g, '_') === e) || null; if (!x) continue; } else x = clip(x, 900); }
            o[ik] = x;
          }
          if ((spec.items.required || []).every((r) => o[r] !== undefined && o[r] !== '')) list.push(o);
        }
        v = list;
      } else v = v.map((x) => clip(cleanStr(x), 60)).filter(Boolean);
    }
    out[k] = v;
  }
  // per-tool rules and defaults
  if (name === 'make_picture') { out.shape = out.shape || 'wide'; out.quality = out.quality || 'best'; }
  if (name === 'edit_picture') { out.source = out.source || 'last_result'; out.keep = out.keep || 'loose'; }
  if (name === 'make_clip' || name === 'animate_picture' || name === 'clip_between') {
    const s = out.seconds === undefined ? 5 : out.seconds; out.seconds = Math.min(5, Math.max(1, s)); if (s !== out.seconds) repairs.push(`seconds ${s} -> ${out.seconds}`);
    if (name === 'make_clip') out.shape = out.shape || 'wide';
    if (name === 'animate_picture') out.source = out.source || 'last_result';
    if (name === 'clip_between') { out.start = out.start || 'earlier_picture'; out.end = out.end || 'latest_picture'; if (out.start === out.end) errors.push('"start" and "end" must be two different pictures'); }
  }
  if (name === 'make_song' || name === 'make_music_video') {
    const def = name === 'make_song' ? SONG_SECONDS.def : 30, s = out.seconds === undefined ? def : out.seconds;
    if (name === 'make_song' && opts && opts.seconds) {   // v032: the length the person asked for, 10-60 s (Josh: a 10 s song for the music-video test)
      out.seconds = clampSongSeconds(opts.seconds); if (out.seconds !== s && args.seconds !== undefined) repairs.push(`seconds ${s} -> ${out.seconds} (the length asked for)`);
    } else { out.seconds = s <= 45 ? 30 : 60; if (out.seconds !== s && args.seconds !== undefined) repairs.push(`seconds ${s} -> ${out.seconds}`); }   // no length asked for: as before
    if (name === 'make_music_video') { out.shape = out.shape || 'tall'; out.song = out.song || 'new'; }
  }
  if (name === 'add_sound') out.clip = 'last_clip';
  if (out.bpm !== undefined) { const b = Math.min(220, Math.max(40, out.bpm)); if (b !== out.bpm) repairs.push(`bpm ${out.bpm} -> ${b}`); out.bpm = b; }
  if (out.key !== undefined) { const k = normKey(out.key); if (!k) { repairs.push(`key "${String(out.key).slice(0, 12)}" dropped`); delete out.key; } else out.key = k; }
  if (out.tags && out.bpm !== undefined) { const t = stripBpm(out.tags); if (t !== out.tags) { out.tags = t; repairs.push('tempo moved out of the tags into bpm'); } }
  if (name === 'make_song' && !out.lyrics && out.tags && !/instrumental/i.test(out.tags)) repairs.push('needs lyrics');   // agent.js writes them in a focused write_song step
  if (name === 'look_at_result') {
    if (out.verdict === 'reroll' && !out.fix_prompt) errors.push('"fix_prompt" is required for reroll');
    if (out.verdict === 'accept') delete out.fix_prompt;
  }
  if (name === 'ask_user' && out.options) out.options = out.options.slice(0, 4);
  return { ok: errors.length === 0, args: out, errors, repairs };
}

// ------------------------------------------------------------------------------------------------ calls -> jobs
/** a valid render call -> {kind, params, minutes, model}. ctx: {last: {picture, clip, song}, photo: {blobKey, attested, shape}} */
export function toJob(name, a, ctx = {}) {
  const last = ctx.last || {};
  if (name === 'make_picture') { const [w, h] = PIC_SIZE[a.shape]; return { kind: 'picture', model: MODEL.picture, minutes: MINUTES.picture, params: { prompt: a.prompt, width: w, height: h, steps: a.quality === 'fast' ? 3 : 4 } }; }
  if (name === 'edit_picture') {
    const src = a.source === 'my_photo' ? ctx.photo : last.picture;
    if (!src || !src.blobKey) return { error: a.source === 'my_photo' ? 'There is no photo from the person yet: ask them to add one with the photo button.' : 'There is no picture to edit yet.' };
    if (a.source === 'my_photo' && !src.attested) return { error: "The person has not ticked the rights box for their photo yet: ask them to tick it, then try again." };
    const shape = a.shape || src.shape || 'wide', [w, h] = PIC_SIZE[shape];
    return { kind: 'edit', model: MODEL.edit, minutes: MINUTES.edit, params: { prompt: a.prompt, inputKey: src.blobKey, attested: true, reference: a.keep === 'close' ? 'full' : 'half', width: w, height: h, steps: 4 } };
  }
  if (name === 'make_clip') { const [w, h] = CLIP_SIZE[a.shape]; return { kind: 'clip', model: MODEL.clip, minutes: Math.max(2, Math.round(MINUTES.clip * a.seconds / 5)), params: { prompt: a.prompt, width: w, height: h, frames: FRAMES[a.seconds] } }; }
  if (name === 'animate_picture') {
    const src = a.source === 'my_photo' ? ctx.photo : last.picture;
    if (!src || !src.blobKey) return { error: a.source === 'my_photo' ? 'There is no photo from the person yet: ask them to add one with the photo button.' : 'There is no picture to animate yet: make one first.' };
    if (a.source === 'my_photo' && !src.attested) return { error: 'The person has not ticked the rights box for their photo yet: ask them to tick it, then try again.' };
    const shape = a.shape || (src.shape === 'tall' ? 'tall' : 'wide'), [w, h] = CLIP_SIZE[shape];
    return { kind: 'animate', model: MODEL.animate, minutes: Math.max(2, Math.round(MINUTES.animate * a.seconds / 5)), params: { prompt: a.prompt, imageKey: src.blobKey, attested: true, width: w, height: h, seconds: a.seconds, frames: FRAMES[a.seconds] } };
  }
  if (name === 'clip_between') {
    const pick = (k) => (k === 'my_photo' ? ctx.photo : k === 'earlier_picture' ? last.picture_prev : last.picture);
    const f = pick(a.start), l = pick(a.end);
    if (!f || !f.blobKey || !l || !l.blobKey) {
      const have = [last.picture && 'a latest picture', last.picture_prev && 'an earlier picture', ctx.photo && 'a photo'].filter(Boolean);
      return { error: `clip_between needs two pictures; the person has ${have.length ? have.join(' and ') : 'none'}. Make the missing picture first.` };
    }
    if ((a.start === 'my_photo' || a.end === 'my_photo') && !(ctx.photo && ctx.photo.attested)) return { error: 'The person has not ticked the rights box for their photo yet: ask them to tick it, then try again.' };
    const shape = (l.shape || f.shape) === 'tall' ? 'tall' : 'wide', [w, h] = CLIP_SIZE[shape];
    return { kind: 'between', model: MODEL.between, minutes: Math.max(2, Math.round(MINUTES.between * a.seconds / 5)), params: { prompt: a.prompt, firstKey: f.blobKey, lastKey: l.blobKey, attested: true, width: w, height: h, seconds: a.seconds, frames: FRAMES[a.seconds] } };
  }
  if (name === 'add_sound') {
    if (!last.clip || !last.clip.blobKey) return { error: 'There is no clip yet: make a clip first.' };
    return { kind: 'foley', model: MODEL.foley, minutes: MINUTES.foley, params: { prompt: a.prompt || '', negativePrompt: 'music, speech', videoKey: last.clip.blobKey, seconds: last.clip.seconds || 5 } };
  }
  if (name === 'make_song') {
    const bpm = a.bpm || SONG_DEFAULTS.bpm, L = normalizeLyrics(a.lyrics || '', a.tags, { seconds: a.seconds, bpm });
    return { kind: 'song', model: MODEL.song, minutes: MINUTES.song, params: songParams(a, L, bpm) };
  }
  if (name === 'make_music_video') {
    const p = { idea: a.idea, title: a.title || '', seconds: a.seconds, shape: a.shape };
    if (a.song === 'last_song') { if (!last.song || !last.song.blobKey) return { error: 'There is no song yet: make a new one (song: new).' }; p.songKey = last.song.blobKey; p.songSeconds = last.song.seconds; p.lyrics = last.song.lyrics || ''; p.tags = last.song.tags || ''; }
    else if (a.tags) {
      const bpm = a.bpm || bpmFromTags(a.tags) || SONG_DEFAULTS.bpm, L = normalizeLyrics(a.lyrics || '', a.tags, { seconds: a.seconds, bpm });
      Object.assign(p, { tags: L.tags, lyrics: L.lyrics, bpm }, a.key ? { key: a.key } : {}, a.time_signature ? { timeSignature: a.time_signature } : {});
    } else if (a.bpm) p.bpm = a.bpm;
    const shots = planSlots(a.seconds).length;
    return { kind: 'musicvideo', model: null, minutes: shots * MINUTES.clip + MINUTES.song + 4, params: p };
  }
  return { error: 'not a render tool' };
}

// ------------------------------------------------------------------------------------------------ ACE-Step lyrics hand-off
// The renderer has a FIXED marker vocabulary: hinted markers ("[chorus - powerful]") made a music model drop lyrics in testing
// (26 -> 43 of 46 lines after normalising). Normalise at the hand-off; hints move into the tags; the song ends on a chorus.
export const SECTIONS = ['intro', 'verse', 'pre-chorus', 'chorus', 'hook', 'bridge', 'solo', 'break', 'inst', 'outro'];
const SECTION_SYN = { refrain: 'chorus', 'post-chorus': 'chorus', prechorus: 'pre-chorus', 'pre chorus': 'pre-chorus', instrumental: 'inst', interlude: 'break', 'instrumental break': 'break', coda: 'outro', ending: 'outro', end: 'outro', drop: 'break', rap: 'verse', spoken: 'verse' };
// Music probe v002 (Oct 12 2026, the ACE 5 Hz LM 0.6B lyrics planner on: lines heard 21 -> 35 of 40): a song holds at most
// (seconds - 6) x BPM / 480 sung lines (section tags excluded); missing tempo / key / metre become 120 BPM, C major, 4/4;
// back-to-back identical choruses scored worse (verse, chorus, short verse, chorus works better).
export const SONG_DEFAULTS = { bpm: 120, key: 'C major', timeSignature: '4/4' };
// v032 (Josh, Oct 14: "Can I do the music video test on a 10sec song?"): a song request may say its length. Code reads it from the
// person's words (songSecondsFrom; not left to the model) and clamps it to 10-60 s. With no length asked for nothing changes: 60 s by
// default, and a length the model picks by itself still snaps to 30 or 60. A 10 s song holds 2 sung lines (lyricBudget).
export const SONG_SECONDS = { min: 10, max: 60, def: 60 };
export const clampSongSeconds = (s) => Math.min(SONG_SECONDS.max, Math.max(SONG_SECONDS.min, Math.round(Number(s) || SONG_SECONDS.def)));
const ONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const byLen = (a) => a.slice().sort((x, y) => y.length - x.length).join('|');
const NUM_WORD = `(?:(?:${byLen(Object.keys(TENS))})(?:[- ](?:${byLen(ONES.slice(0, 9))}))?|${byLen(ONES)})`;
const wordNum = (w) => { const [t, o] = String(w).toLowerCase().split(/[- ]/); return TENS[t] != null ? TENS[t] + (o ? ONES.indexOf(o) + 1 : 0) : ONES.indexOf(t) + 1; };
const NOT_A_CLIP = String.raw`(?!\s*(?:long\s+)?(?:clips?|videos?|movies?|films?|animations?|gifs?|shots?)\b)`;   // "a 5 second clip ..." is not the song's length
const SONG_NOUN = String.raw`(?:long|song|songs|track|tune|ballad|jingle|anthem|lullaby|shanty|hymn|rap|version|one|piece|bit)\b`;
// [pattern, (match) -> seconds]; the earliest match in the text wins
const LEN_RULES = [
  [String.raw`\bhalf[- ](?:a[- ])?minute\b`, () => 30],
  [String.raw`\b(\d{1,2}(?:\.\d+)?|an?|one|two|three)[- ]?(?:minutes?|mins?)\b(\s+and\s+a\s+half)?`, (m) => (/^\d/.test(m[1]) ? Number(m[1]) : /^(?:an?|one)$/i.test(m[1]) ? 1 : wordNum(m[1])) * 60 + (m[2] ? 30 : 0)],
  [String.raw`\b(\d{1,3}(?:\.\d+)?)\s*[- –]?\s*(?:seconds?|secs?)\b` + NOT_A_CLIP, (m) => Number(m[1])],
  [String.raw`\b(\d{1,3}(?:\.\d+)?)\s+s\b(?!['’])` + NOT_A_CLIP, (m) => Number(m[1])],                                   // "10 s", as the app writes it
  [String.raw`(?:^|[^\w'’.])(\d{1,2})s\b` + NOT_A_CLIP, (m) => (Number(m[1]) >= 20 && Number(m[1]) % 10 === 0 ? null : Number(m[1]))],   // "15s"; never "80s" (a decade)
  [String.raw`\b(${NUM_WORD})[- ]seconds\b` + NOT_A_CLIP, (m) => wordNum(m[1])],
  [String.raw`\b(${NUM_WORD})[- ]second(?=[- ]${SONG_NOUN})`, (m) => wordNum(m[1])],                                       // "a ten-second song" (not "the thirty-second president")
];
/** the song length the person's message asks for, in seconds, clamped to 10-60; null when it names none.
 *  "a 10 second song" / "10sec" / "15s" / "twenty seconds" -> 10 / 10 / 15 / 20; "half a minute" -> 30; "about a minute" -> 60 */
export function songSecondsFrom(text) {
  const t = String(text || '');
  let best = null;
  for (const [src, val] of LEN_RULES) {
    const re = new RegExp(src, 'gi');
    for (let m; (m = re.exec(t));) {
      const v = val(m);
      if (v != null && Number.isFinite(v) && v > 0 && (!best || m.index < best.i)) best = { i: m.index, v };
      if (best && m.index >= best.i) break;
    }
  }
  return best ? clampSongSeconds(best.v) : null;
}
/** a regular-expression source for a stated length (agent.songAbout strips it from the song's subject) */
export const SONG_LENGTH_SRC = String.raw`(?:half[- ](?:a[- ])?minute|(?:\d{1,2}(?:\.\d+)?|an?|one|two|three)[- ]?(?:minutes?|mins?)|\d{1,3}(?:\.\d+)?\s*[- –]?\s*(?:seconds?|secs?)|\d{1,3}(?:\.\d+)?\s+s|(?![2-9]0s)\d{1,2}s|(?:${NUM_WORD})[- ]seconds?)\b`;
export const lyricBudget = (seconds, bpm = SONG_DEFAULTS.bpm) => Math.max(2, Math.floor(((Number(seconds) || 30) - 6) * (Number(bpm) || SONG_DEFAULTS.bpm) / 480));
export const sungLines = (lyrics) => String(lyrics || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[[^\]]*\]$/.test(l)).length;
export function bpmFromTags(tags) { const m = /\b(\d{2,3})\s*bpm\b/i.exec(String(tags || '')); const n = m ? Number(m[1]) : null; return n && n >= 40 && n <= 220 ? n : null; }
export const stripBpm = (tags) => String(tags || '').replace(/(^|,)\s*(?:tempo\s*)?\d{2,3}\s*bpm\s*(?=,|$)/gi, '$1').replace(/,\s*,/g, ',').replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
export function normKey(k) {
  const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭|sharp|flat)?\s*(major|minor|maj|min|m)?\s*$/.exec(String(k || ''));
  if (!m) return null;
  const note = m[1].toUpperCase() + (m[2] ? (/#|♯|sharp/i.test(m[2]) ? '#' : 'b') : '');
  return `${note} ${m[3] && /^(minor|min|m)$/.test(m[3]) ? 'minor' : 'major'}`;
}
/** the song job's params (the engine gets bpm always, key / time signature only when chosen, the lyrics planner on by default) */
export function songParams(a, L, bpm) {
  return Object.assign({ title: a.title || '', tags: L.tags, lyrics: L.lyrics, seconds: a.seconds, bpm, lm: a.lm !== false, notes: L.notes },
    a.key ? { key: a.key } : {}, a.time_signature ? { timeSignature: a.time_signature } : {});
}
/** null, or the message that asks the model for a shorter version (sent once; after that the hand-off trims) */
export function lyricsTooLong(lyrics, seconds, bpm) {
  const n = sungLines(lyrics), max = lyricBudget(seconds, bpm);
  return n > max ? `the lyrics have ${n} sung lines; a ${seconds}-second song at ${bpm} BPM holds at most ${max} (section tags do not count). Write a shorter version: ${max <= 3 ? `one short [verse] and one short [chorus], ${max} short lines in all` : 'verse, chorus, short verse, chorus'}` : null;
}
const SUNG = (b) => b.lines.length;
/**
 * lyrics -> {lyrics, tags, notes, lines, maxLines}: markers normalised to ACE's vocabulary (hints -> tags), stage directions dropped,
 * back-to-back identical choruses merged, the song ends on a chorus, and (with {seconds, bpm}) trimmed to the line budget.
 */
export function normalizeLyrics(lyrics, tags = '', { seconds = null, bpm = null } = {}) {
  const notes = [], hints = [];
  const out = [];
  for (const raw of String(lyrics || '').split('\n')) {
    const line = raw.trim();
    // "[Chorus - powerful]", and the bare "Verse 1:" / "Chorus:" lines small models also write
    const m = /^\[([^\]]{1,60})\]$/.exec(line) || /^((?:verse|chorus|bridge|intro|outro|hook|pre-?chorus|refrain|interlude)(?:\s*\d+)?(?:\s*[-–(][^:]{0,24})?)\s*:$/i.exec(line)
      || /^((?:verse|chorus|bridge|intro|outro|hook|pre-?chorus|refrain|interlude)(?:\s*\d+)?)$/i.exec(line);
    if (m) {
      const inner = m[1].toLowerCase().trim();
      const [head, ...rest] = inner.split(/\s*[-–—:,(|]\s*/);
      let base = head.replace(/\s*\d+$/, '').trim();
      base = SECTIONS.includes(base) ? base : SECTION_SYN[base] || (SECTIONS.find((s) => base.startsWith(s)) || 'verse');
      const hint = rest.join(' ').replace(/[)\]]/g, '').trim();
      if (hint && !/^\d+$/.test(hint)) hints.push(hint);
      if (`[${base}]` !== line) notes.push(`marker "${line}" -> [${base}]`);
      out.push(`[${base}]`);
    } else if (/^\([^)]{0,40}\)$/.test(line)) notes.push(`stage direction "${line}" dropped (it would be sung)`);
    else if (line) out.push(line);
    else if (out.length && out[out.length - 1] !== '') out.push('');
  }
  // blocks: [{marker, lines}] (lines before the first marker have marker null)
  let blocks = [];
  for (const l of out) {
    if (/^\[[a-z-]+\]$/.test(l)) blocks.push({ marker: l.slice(1, -1), lines: [] });
    else if (l) { if (!blocks.length) blocks.push({ marker: null, lines: [] }); blocks[blocks.length - 1].lines.push(l); }
  }
  blocks = blocks.filter((b) => b.lines.length || b.marker === 'inst' || b.marker === 'break' || b.marker === 'solo' || b.marker === 'intro');
  const isCh = (b) => b && (b.marker === 'chorus' || b.marker === 'hook');
  const same = (a, b) => a.lines.join('\n').toLowerCase() === b.lines.join('\n').toLowerCase();
  const dedupe = () => { for (let i = blocks.length - 1; i > 0; i--) if (isCh(blocks[i]) && isCh(blocks[i - 1]) && same(blocks[i], blocks[i - 1])) { blocks.splice(i, 1); notes.push('two identical choruses back to back -> one'); } };
  dedupe();
  // end on a chorus: a trailing lone verse tends to go unsung
  const lastBlock = blocks[blocks.length - 1], firstChorus = blocks.find(isCh);
  if (lastBlock && lastBlock.marker && !['chorus', 'hook', 'outro'].includes(lastBlock.marker) && firstChorus) { blocks.push({ marker: firstChorus.marker, lines: firstChorus.lines.slice() }); notes.push('ended on a verse -> the chorus repeated at the end'); }
  for (const b of blocks) b.orig = b.lines.slice();   // what the trim may grow back to
  // the line budget (music probe v002): trim bridges / pre-choruses, then later verses, then extra choruses, then every chorus evenly
  let maxLines = null;
  if (seconds) {
    maxLines = lyricBudget(seconds, bpm || SONG_DEFAULTS.bpm);
    const total = () => blocks.reduce((s, b) => s + SUNG(b), 0), before = total();
    const verses = () => blocks.filter((b) => b.marker === 'verse' || b.marker === null);
    for (let guard = 0; total() > maxLines && guard < 200; guard++) {
      const side = [...blocks].reverse().find((b) => (b.marker === 'bridge' || b.marker === 'pre-chorus' || b.marker === 'outro') && SUNG(b));
      if (side) { side.lines.pop(); continue; }
      const longV = [...verses()].reverse().find((b) => SUNG(b) > 2);
      if (longV) { longV.lines.pop(); continue; }
      const shortV = [...verses()].reverse().find((b) => SUNG(b) > 1);   // one-line trims first: verses down to one line, the later ("short") verse first
      if (shortV) { shortV.lines.pop(); continue; }
      const ch = blocks.filter(isCh);
      if (ch.length > 2) {   // ... chorus, verse, chorus(final) -> drop the chorus + verse pair before the final chorus
        const i = blocks.indexOf(ch[ch.length - 1]);
        if (i >= 2 && !isCh(blocks[i - 1]) && isCh(blocks[i - 2])) blocks.splice(i - 2, 2); else blocks.splice(blocks.indexOf(ch[ch.length - 2]), 1);
        continue;
      }
      if (ch.length && SUNG(ch[0]) > 2) { for (const c of ch) c.lines.pop(); continue; }   // choruses down to two lines, every copy alike
      const vs = verses();
      if (vs.length > 1) { blocks.splice(blocks.indexOf(vs[vs.length - 1]), 1); continue; }
      if (ch.length && SUNG(ch[0]) > 1) { for (const c of ch) c.lines.pop(); continue; }
      break;
    }
    blocks = blocks.filter((b) => b.lines.length || b.marker === 'inst' || b.marker === 'break' || b.marker === 'solo');
    dedupe();
    // grow back into any room the last cut or merge left: verse lines first (in song order), then a line on every chorus copy at once
    const grow = () => {
      for (const b of blocks) if (!isCh(b) && b.orig && b.lines.length < b.orig.length) { b.lines.push(b.orig[b.lines.length]); return true; }
      const chs = blocks.filter(isCh);
      if (chs.length && chs.every((c) => c.orig && c.lines.length < c.orig.length) && total() + chs.length <= maxLines) { for (const c of chs) c.lines.push(c.orig[c.lines.length]); return true; }
      return false;
    };
    while (total() < maxLines && grow()) { /* restored one step */ }
    if (total() < before) notes.push(`trimmed ${before - total()} line(s) to fit ${maxLines} sung lines (${seconds} s at ${bpm || SONG_DEFAULTS.bpm} BPM)`);
  }
  let text = blocks.map((b) => (b.marker ? `[${b.marker}]\n` : '') + b.lines.join('\n')).join('\n\n').trim();
  let t = String(tags || '').trim();
  const uniq = [...new Set(hints.map((h) => h.replace(/\s+/g, ' ')))].slice(0, 4);
  if (uniq.length) { t = (t ? t + ', ' : '') + 'vocal delivery: ' + uniq.join(', '); notes.push('section hints moved into the tags'); }
  if (!text && !/instrumental/i.test(t)) { t = (t ? t + ', ' : '') + 'instrumental'; notes.push('no lyrics -> instrumental'); }
  return { lyrics: text, tags: stripBpm(t), notes, lines: sungLines(text), maxLines };
}

// ------------------------------------------------------------------------------------------------ music-video shot slots (code times the shots)
/** integer shot lengths (2..5 s, the clip model's range) summing to the song length: fast cuts in the first 15 s (the hook), then 5 s */
export function planSlots(seconds, sections = null) {
  const total = Math.max(10, Math.round(seconds)), durs = [];
  let t = 0;
  for (const d of [3, 2, 3, 2, 3, 2]) { if (t + d > Math.min(15, total)) break; durs.push(d); t += d; }   // the hook: fast cuts
  while (t < total) {
    const left = total - t, d = left >= 7 ? 5 : left <= 5 ? left : Math.ceil(left / 2);   // 6 s left -> 3 + 3, never a 1 s tail
    durs.push(d); t += d;
  }
  // a last sliver under 2 s joins the shot before it (split evenly when the pair would pass 5 s)
  if (durs.length > 1 && durs[durs.length - 1] < 2) { const s = durs.pop() + durs.pop(); if (s <= 5) durs.push(s); else durs.push(Math.ceil(s / 2), Math.floor(s / 2)); }
  let start = 0;
  return durs.map((dur, i) => {
    const slot = { n: i + 1, start, dur, hook: start < 15, frames: FRAMES[dur], section: sectionAt(start, total, sections) };
    start += dur; return slot;
  });
}
function sectionAt(t, total, sections) {
  if (Array.isArray(sections) && sections.length && sections[0].start !== undefined) {
    let s = sections[0].name; for (const x of sections) if (x.start <= t + 0.5) s = x.name; return s;
  }
  if (Array.isArray(sections) && sections.length) return sections[Math.min(sections.length - 1, Math.floor((t / total) * sections.length))];
  return t < 15 ? 'hook' : 'verse';
}
/** the song's section names in order (for slot labels when the music engine gives no section times) */
export const lyricSections = (lyrics) => (String(lyrics || '').match(/^\[([a-z-]+)\]$/gm) || []).map((m) => m.slice(1, -1));

// ------------------------------------------------------------------------------------------------ safety screen (deterministic)
let TERMS = null;
export function setSafetyTerms(t) { TERMS = t; }
export function getSafetyTerms() { return TERMS; }
const has = (text, list) => { const t = ' ' + String(text || '').toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ') + ' '; return (list || []).filter((w) => t.includes(' ' + w.toLowerCase() + ' ')); };
export const termsHit = (text, list) => has(text, TERMS ? TERMS[list] : []);
/**
 * the person's message, before any model runs -> null or {code, reply}. Only the absolute cases: sexual content with minors, and
 * intimate imagery of a known or real person / deepfakes. Everything else is the model's call with the safety cookbook.
 */
export function screenRequest(text) {
  if (!TERMS) return null;
  const sex = has(text, TERMS.sexual), minor = has(text, TERMS.minor), known = has(text, TERMS.known_person), fake = has(text, TERMS.deepfake);
  if (sex.length && minor.length) return { code: 'MINOR_SEXUAL', reply: "I can't help with that. p0pc0rn never makes sexual content involving minors." };
  if (fake.length || (sex.length && known.length)) return { code: 'NCII', reply: "I can't make intimate or sexual images of a real person, or swap someone's face onto another body. Publishing images like that is a federal crime in the U.S., and p0pc0rn doesn't make them. Settings > Rights & Copyright explains why." };
  return null;
}
/**
 * a render call's text, before it is queued -> null or {action: 'refuse' | 'rewrite', code, reason, terms}. 'refuse' = the model must
 * tell the person and offer an original; 'rewrite' = the model must drop the named brands and call again.
 * realPeople: names the research lane confirmed are biographies (agent.js checks the proper names first).
 */
export function screenRender(name, args, { realPeople = [], userText = '', transform = false } = {}) {
  if (!TERMS) return null;
  const text = [args.prompt, args.idea, args.tags, args.lyrics, args.title, args.fix_prompt].filter(Boolean).join(' \n ');
  const r = screenRequest(text); if (r) return { action: 'refuse', code: r.code, reason: r.reply, terms: [] };
  const chars = transform ? [] : has(text, TERMS.characters);   // v022: a visual job goes through the likeness gate (an original take) instead
  if (chars.length) return { action: 'refuse', code: 'CHARACTER', terms: chars, reason: `"${chars[0]}" is a famous character owned by a company` };
  if (realPeople.length) return { action: 'refuse', code: 'LIKENESS', terms: realPeople, reason: `"${realPeople[0]}" is a real person, and making their likeness needs their consent` };
  const voice = (name === 'make_song' || name === 'make_music_video') ? has(text, TERMS.voice_clone) : [];
  if (voice.length) return { action: 'rewrite', code: 'VOICE', terms: voice, reason: 'songs may not imitate a named singer or band: describe the vocal style (male vocal, breathy, powerful) without a name' };
  if (name === 'make_clip' || name === 'animate_picture' || name === 'clip_between' || name === 'plan') {
    const cam = CAMERA_AVOID.exec(String(args.prompt || ''));
    if (cam) return { action: 'rewrite', code: 'CAMERA', terms: [cam[0]], reason: `"${cam[0]}" is camera wording the clip model gets wrong (rig words get painted in, orbits become a spinning subject): say what the frame does in plain words, e.g. "the camera slowly moves closer", "the camera pans left", "the camera follows the subject"` };
  }
  const brands = transform ? [] : has(text, TERMS.brands);
  if (brands.length) return { action: 'rewrite', code: 'BRAND', terms: brands, reason: `remove the brand name${brands.length > 1 ? 's' : ''} ${brands.map((b) => `"${b}"`).join(', ')}: describe the thing without a logo or brand` };
  const coffee = has(text, TERMS.coffee), asked = has(userText, TERMS.coffee);
  if (coffee.length && !asked.length) return { action: 'rewrite', code: 'COFFEE', terms: coffee, reason: 'the person did not ask for coffee: leave out coffee, cups, mugs and cafes' };
  return null;
}
/** clip-cookbook camera wording to avoid (rig and trade words, orbits, zoom-outs) */
export const CAMERA_AVOID = /\b(dolly(?:ing)?|dollies|truck(?:s|ing)? (?:left|right)|jib|crane (?:shot|down)|cranes down|orbit(?:s|ing)?|circles? (?:around )?(?:the )?\w+|circling|arcs? (?:left|right|around)|zooms? out|pulls? back from|dolly zoom|bullet time)\b/i;
/** capitalised multi-word names in a prompt (candidates for the real-person check) */
export function properNames(text) {
  const out = new Set(), re = /\b(\p{Lu}[\p{Ll}'’.-]+(?:\s+(?:de|van|von|da|di|del|la|le|bin|al)?\s*\p{Lu}[\p{Ll}'’.-]+){1,3})\b/gu;
  let m; const skip = /^(The|A|An|In|On|At|Of|And|With|From|Under|Over|Photograph|Wide|Close|Medium|Soft|Golden|Blue|Red|Green|Black|White|North|South|East|West|New|Old|Saint|St|Mount|Lake|River|Cape|Port)\b/;
  while ((m = re.exec(String(text || ''))) !== null) { const n = m[1].replace(/\s+/g, ' ').trim(); if (!skip.test(n) && n.split(' ').length >= 2) out.add(n); }
  return [...out].slice(0, 4);
}
