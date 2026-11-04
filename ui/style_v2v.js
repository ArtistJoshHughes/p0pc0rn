// style_v2v.js - v4 Phase 4: Create › Video › Restyle a clip (Josh: "V2V Style is looking good", it ships in v4). Pure parts, no DOM
// (node-tested): the 20 looks, the size and length a clip gets, the prompts, the phone estimates and the two jobs the flow queues.
//   1. the person picks a clip (a finished clip from the Library, or a video from the phone) and a look;
//   2. Klein 4B restyles the clip's first frame with the look's edit words (an 'edit' job at the clip's size);
//   3. they check that picture: Use this, or Try again (one at a time);
//   4. SANA-Video 2.0 re-renders the clip from it with the looks LoRA (c20): a 'restyle' job (engine videoToVideo): the source re-noised,
//      the styled frame pinned at latent slot 0, no low-pass swap; "Follow the motion" picks the schedule (STYLE_FOLLOW);
//   5. the new clip lands in the Library beside its source (the source stays as it was).
// The look words are the lab's own (sv/sty_cycle.py WORDS = sv/v2v2.py WORDS = the model card's eval/looks.json sana_prompt_prefix) and
// so are the edit words (klein/klein_style_edits.py EDITS = looks.json klein_edit_instruction): the phone's results match the tests. The
// prompt is "<look words> <what is in the clip and what happens>"; the person (or the source clip's own prompt) writes only the second
// part. The thumbnails (ui/looks/<id>.jpg) are frames of the published example clips' styled rows (the lab's own test characters).

export const STYLE_FPS = 16;
/** the longest clip the phone restyles, in seconds (16 n + 1 frames); its first seconds when the clip is longer. 5 s = 81 frames, the
 *  model's own training length and the longest picture clip; on the desk at 832 x 480 it used 574 MB reading the clip, 618 MB in its
 *  stages and 596 MB decoding (the engine's own count, as a 5 s picture clip) */
export const STYLE_CAP_S = 5;
/** v4 (Nov 3): "Follow the motion" = the engine's `follow`. Closely (the default): from stage 2 (sigma 0.857) with one stage added at 0.76
 *  (0.857 -> 0.76 -> 0.666 -> 0): the clip keeps the source's moves (from stage 1 the source is only ~5 % of the start, and quick arms and
 *  hands froze). Loosely: stage 1 (0.947), the model's own stages 1-3, the look c20 was trained at: the strongest look, looser motion.
 *  Both are 3 transformer calls, so they take the same time. k0: the stage the engine starts at (its progress counts from it) */
export const STYLE_FOLLOW = Object.freeze({
  close: Object.freeze({ id: 'close', name: 'Closely', k0: 2, help: 'Keeps the moves of your clip. The look is a little lighter.' }),
  loose: Object.freeze({ id: 'loose', name: 'Loosely', k0: 1, help: 'The strongest look. Quick moves, like hands, can come out stiff.' }) });
export const STYLE_FOLLOW_DEFAULT = 'close';
/** a setting from anywhere (a draft, a Library item) -> 'close' | 'loose' */
export const followOf = (f) => (STYLE_FOLLOW[f] ? f : STYLE_FOLLOW_DEFAULT);
/** the setting a restyle runs with: the person's own pick (a draft's, a Library item's), else its look's (LOOK_FOLLOW) */
export const followFor = (look, pick) => (STYLE_FOLLOW[pick] ? pick : lookFollow(look));
export const STYLE_START = STYLE_FOLLOW.close.k0;   // the default's stage (Nov 3; stage 1 before)
export const STYLE_LOWSWAP = null;  // the c20 tests used none (the lab's lowswap builds the training pairs' photo twins only)
export const STYLE_SIZES = Object.freeze({ wide: Object.freeze([832, 480]), tall: Object.freeze([480, 832]) });   // c20's training sizes
export const PREP_SECONDS_PER_FRAME = 0.12;   // reading the picked clip into frames on the phone (an estimate)

const L = (id, name, words, edit, beta = false) => Object.freeze({ id, name, words, edit, beta });
/** the 20 looks: the steadier ones first, then the ones marked beta (the model card's less reliable looks) */
export const LOOKS = Object.freeze([
  L('illus', 'Storybook illustration', 'A hand-drawn storybook illustration with clean ink outlines and soft gouache washes on paper. ',
    'Turn this picture into a hand-drawn storybook illustration: clean ink outlines, soft gouache and watercolor washes, visible paper grain, clearly illustrated and not a photograph. Keep the exact same composition, pose, framing, subject and colours.'),
  L('poster', 'Game poster', 'A bold painted crime-thriller game-cover illustration with thick black outlines and flat saturated cel-shaded colours. ',
    'Turn this picture into a bold painted crime-thriller video game cover illustration: thick black ink outlines, flat saturated cel-shaded colours, hard graphic shadows, a warm sunset palette, a painted comic-poster look, clearly illustrated and not a photograph. Keep the exact same composition, pose, framing and subject. No text, no letters, no logos.'),
  L('anime', 'Anime', 'A hand-drawn anime cel animation scene with clean line art and flat cel shading. ',
    'Turn this picture into a hand-drawn Japanese anime cel animation frame: clean line art, flat cel shading with soft gradients, a painted anime background. Keep the exact same composition, pose, framing and colours.'),
  L('pixel', 'Pixel art', '16-bit pixel art with a limited colour palette and crisp square pixels. ',
    'Turn this picture into 16-bit pixel art: a limited colour palette, crisp square pixels, dithered shading, a retro video game look. Keep the exact same composition, pose and framing.'),
  L('stainedglass', 'Stained glass', 'A glowing stained glass window scene with bold black lead lines and jewel-toned glass. ',
    'Turn this picture into a stained glass window: bold black lead lines and jewel-toned translucent glass panes glowing with light. Keep the exact same composition, pose and framing.'),
  L('oil', 'Oil paint', 'A thick impasto oil painting with heavy visible brush strokes. ',
    'Turn this picture into a thick impasto oil painting: heavy visible brush strokes and palette-knife texture, rich paint. Keep the exact same composition, pose, framing and colours.'),
  L('charcoal', 'Charcoal', 'A black and grey charcoal sketch on textured paper with smudged shading. ',
    'Turn this picture into a charcoal and graphite sketch on textured paper: black and grey only, smudged shading, loose expressive lines. Keep the exact same composition, pose and framing.'),
  L('psychedelic', 'Psychedelic', 'A vivid psychedelic poster painting with swirling neon colours and flowing liquid patterns. ',
    'Turn this picture into a vivid psychedelic poster painting: swirling neon colours, flowing liquid patterns and rainbow gradients, 1960s concert-poster art, clearly painted and not a photograph. Keep the exact same composition, pose, framing and subject. No text, no letters, no logos.'),
  L('synthwave', 'Synthwave', 'A 1980s synthwave retro-futurist scene with glowing magenta and cyan neon light. ',
    'Turn this picture into 1980s synthwave retro-futurist art: glowing magenta and cyan neon light, a purple sunset sky, chrome highlights, clearly stylised and not a photograph. Keep the exact same composition, pose, framing and subject. No text, no letters, no logos.'),
  L('ukiyoe', 'Ukiyo-e', 'A Japanese ukiyo-e woodblock print with flat colour areas, bold outlines and wood grain. ',
    'Turn this picture into a Japanese ukiyo-e woodblock print: flat colour areas, bold outlines, wood grain texture, a traditional Edo-period print look. Keep the exact same composition, pose and framing. No text, no letters, no seals.'),
  L('lowpoly', 'Low poly', 'A low-poly 3D render, everything built from flat-shaded faceted triangles. ',
    'Turn this picture into a low-poly 3D render: everything built from flat-shaded faceted triangles and simple geometric shapes, clean soft lighting. Keep the exact same composition, pose, framing and colours.'),
  L('cartoon3d', '3D cartoon', 'A soft 3D animated cartoon scene with rounded shapes and smooth stylised surfaces. ',
    'Turn this picture into a soft 3D animated cartoon film render: rounded friendly shapes, smooth stylised surfaces, warm studio lighting, clearly a CG cartoon and not a photograph. Keep the exact same composition, pose, framing and colours.'),
  L('wax', 'Wax', 'Everything is sculpted from glossy translucent wax with a soft warm inner glow. ',
    'Turn this picture into a wax sculpture scene: everything sculpted from glossy translucent wax with a soft warm inner glow and slightly softened edges. Keep the exact same composition, pose, framing and colours.'),
  L('clay', 'Clay', 'A stop-motion claymation scene, everything made of smooth modelling clay. ',
    'Turn this picture into a stop-motion claymation scene: everything made of smooth modelling clay with visible fingerprints. Keep the exact same composition, pose, framing and colours.', true),
  L('marble', 'Marble', 'A carved white marble sculpture scene, everything polished veined stone. ',
    'Turn this picture into a carved marble sculpture: every person, animal and object carved from polished white veined marble, soft museum lighting. Keep the exact same composition, pose and framing.', true),
  L('origami', 'Origami', 'An origami paper-craft scene, everything folded from crisp coloured paper. ',
    'Turn this picture into an origami paper-craft scene: every person, animal and object folded from crisp coloured paper with sharp creases and paper texture. Keep the exact same composition, pose, framing and colours.', true),
  L('graffiti', 'Graffiti', 'A spray-painted street-art mural come to life, bold spray-paint strokes and drips. ',
    'Turn this picture into a vivid spray-painted street-art mural on a concrete wall: bold spray-paint strokes, drips and outlines, clearly painted and not a photograph. Keep the exact same composition, pose, framing and subject. No text, no letters, no tags, no logos.', true),
  L('blueprint', 'Blueprint', 'A technical blueprint drawing with white construction lines on deep blue paper. ',
    'Turn this picture into a technical blueprint drawing: crisp white construction lines and outlines on a deep blue paper background, clearly a drawing and not a photograph. Keep the exact same composition, pose and framing. No text, no letters, no numbers.', true),
  L('plush', 'Plush', 'A soft plush toy world with fuzzy fabric, stitched seams and embroidered faces. ',
    'Turn this picture into a world of soft plush toys: fuzzy fabric fur, stitched seams, embroidered faces and rounded stuffed shapes, everything soft. Keep the exact same composition, pose, framing and colours.', true),
  L('puppet', 'Puppet', 'A handmade puppet show with felt puppets, button eyes and visible stitching on a miniature set. ',
    'Turn this picture into a handmade puppet show: every person and animal is a felt puppet with button or glass eyes and visible stitching, on a miniature handmade set. Keep the exact same composition, pose, framing and colours.', true),
]);
export const lookOf = (id) => LOOKS.find((l) => l.id === id) || null;
/** v4 (Nov 3): "Follow the motion" by look - the looks that start Loosely; every other look starts Closely. From stage 2 these three lost
 *  their look on the 200 held-out restyles (CLIP style-hold: puppet 3 of 10 against 9 from stage 1, blueprint 6 against 10, origami 6 against
 *  7); the other 17 kept it within a clip or two and followed the motion better. The person can still pick either. */
export const LOOK_FOLLOW = Object.freeze({ puppet: 'loose', blueprint: 'loose', origami: 'loose' });
export const lookFollow = (id) => LOOK_FOLLOW[id] || STYLE_FOLLOW_DEFAULT;
export const lookThumb = (id) => `ui/looks/${id}.jpg`;

/** the clip's size before v4's fit (c20's wide or tall training size by the clip's shape, the middle cropped): the Video benchmark's fixed size */
export function styleShape(w, h) {
  const id = Number(w) >= Number(h) ? 'wide' : 'tall', [width, height] = STYLE_SIZES[id];
  return { id, width, height };
}

// ------------------------------------------------------------------------------------------------ v4: the size, by the clip's own shape
// Nov 2: "The V2V should not crop hard like this. It should down scale to fit within the known working limits of the model's best
// resolution." A clip is scaled to FIT the one of SANA-Video 2.0's own 480p sizes nearest its shape (its multi-scale training buckets around
// 832 x 480: sana diffusion/data/datasets/utils.py ASPECT_RATIO_VIDEO_480_MS_DIV32, [h, w] there): the whole frame, never a hard centre
// crop. A shape a little off the size is trimmed (at most STYLE_TRIM_MAX of one side, half each end); further off, the whole frame goes in
// and the rest is filled by repeating its edge pixels. Never larger than the clip itself, never more latent tokens a frame than 832 x 480
// (where the clip read, the stages and the decode were measured on the phone; the engine also needs an even count): past either, the next
// smaller size of the same shape. Every part of a whole video, its frames pack and Klein's first frame use the one size.
export const SANA_480 = Object.freeze([[896, 448], [832, 480], [768, 512], [704, 544], [640, 640], [608, 672], [544, 704], [512, 768], [480, 832], [448, 896]]
  .map(([w, h]) => Object.freeze({ w, h })));
/** the sizes the restyle picks from (all of SANA's: the looks LoRA was checked at 1:1, 4:3 and 9:16 on the desk, see ENGINE_API.md) */
export const STYLE_BUCKETS = SANA_480;
export const STYLE_MAX_TOKENS = (832 / 32) * (480 / 32);   // 390 latent tokens a frame
export const STYLE_TRIM_MAX = 0.025;   // the most of one side trimmed: 16:9 / 9:16 onto 832 x 480 / 480 x 832 lose 1.25 % at each end
const sizeOk = (w, h) => w % 32 === 0 && h % 32 === 0 && w >= 256 && h >= 256 && ((w / 32) * (h / 32)) % 2 === 0;   // the engine's own rules
const shapeGap = (w1, h1, w2, h2) => Math.abs(Math.log((w1 / h1) / (w2 / h2)));
/** the bucket nearest a clip's shape */
export function nearestBucket(sw, sh, buckets = STYLE_BUCKETS) {
  let best = null; for (const b of buckets) if (!best || shapeGap(sw, sh, b.w, b.h) < shapeGap(sw, sh, best.w, best.h) - 1e-12) best = b;
  return best;
}
/** the sizes a bucket may run at, largest first: the engine's rules, the shape within 4 % of the bucket's, no bigger than the bucket, at
 *  most maxTokens latent tokens a frame */
export function sizesFor(b, maxTokens = STYLE_MAX_TOKENS) {
  const out = [];
  for (let w = 256; w <= b.w; w += 32) for (let h = 256; h <= b.h; h += 32) if (sizeOk(w, h) && (w / 32) * (h / 32) <= maxTokens && shapeGap(w, h, b.w, b.h) <= 0.04) out.push({ w, h });
  return out.sort((x, y) => (y.w * y.h - x.w * x.h) || (shapeGap(x.w, x.h, b.w, b.h) - shapeGap(y.w, y.h, b.w, b.h)));
}
/** how a sw x sh frame goes into W x H -> {mode: 'whole' | 'trim' | 'pad', side ('top and bottom' | 'left and right' | null), frac (the share
 *  of that side trimmed or filled, both ends together), scale (< 1: smaller than the clip), src {x, y, w, h} (the part of the frame drawn),
 *  dst {x, y, w, h} (where it lands; the rest: its edge pixels repeated)} */
export function fitOf(sw, sh, W, H, trimMax = STYLE_TRIM_MAX) {
  const a = sw / sh, A = W / H, full = { x: 0, y: 0, w: sw, h: sh }, all = { x: 0, y: 0, w: W, h: H };
  if (shapeGap(sw, sh, W, H) < 2e-3) return { mode: 'whole', side: null, frac: 0, scale: W / sw, src: full, dst: all };
  const trim = a > A ? 1 - A / a : 1 - a / A;   // the share of the source's wider (or taller) side a cover fit removes
  if (trim <= trimMax + 1e-9) { const r = coverRect(sw, sh, W, H); return { mode: 'trim', side: a > A ? 'left and right' : 'top and bottom', frac: trim, scale: W / r.w, src: r, dst: all }; }
  const s = Math.min(W / sw, H / sh), dw = Math.min(W, Math.round(sw * s)), dh = Math.min(H, Math.round(sh * s)), dx = Math.floor((W - dw) / 2), dy = Math.floor((H - dh) / 2);
  return { mode: 'pad', side: a > A ? 'top and bottom' : 'left and right', frac: a > A ? 1 - dh / H : 1 - dw / W, scale: s, src: full, dst: { x: dx, y: dy, w: dw, h: dh } };
}
/** a clip of sw x sh -> {id (its bucket), width, height, fit (fitOf, src / dst left out: what the clip slot says)}: the bucket nearest its
 *  shape, at the largest of its sizes that does not make the clip bigger (the smallest when even that does: a clip under 256 px a side);
 *  when that size would fill more than PAD_MAX of a side, a size of the bucket with no fill and at least 70 % of its pixels instead */
export const PAD_MAX = 0.05;
export function styleSize(sw, sh, { buckets = STYLE_BUCKETS, maxTokens = STYLE_MAX_TOKENS, trimMax = STYLE_TRIM_MAX } = {}) {
  sw = Number(sw) > 0 ? Number(sw) : 832; sh = Number(sh) > 0 ? Number(sh) : 480;
  const b = nearestBucket(sw, sh, buckets), sizes = sizesFor(b, maxTokens), fits = sizes.filter((z) => fitOf(sw, sh, z.w, z.h, trimMax).scale <= 1 + 1e-9);
  let pick = fits[0] || sizes[sizes.length - 1];
  const f0 = fitOf(sw, sh, pick.w, pick.h, trimMax);
  if (f0.mode === 'pad' && f0.frac > PAD_MAX) { const alt = fits.find((z) => fitOf(sw, sh, z.w, z.h, trimMax).mode !== 'pad' && z.w * z.h >= 0.7 * pick.w * pick.h); if (alt) pick = alt; }
  const f = fitOf(sw, sh, pick.w, pick.h, trimMax);
  return { id: `${b.w}x${b.h}`, width: pick.w, height: pick.h, fit: { mode: f.mode, side: f.side, frac: +f.frac.toFixed(4) } };
}
/** the clip slot's words for a fit: "the whole frame", "the whole frame, trimmed 1.3 % top and bottom", "the whole frame, its edges
 *  extended 1.5 % left and right" (each end) */
export function fitText(fit) {
  if (!fit || fit.mode === 'whole' || !(fit.frac > 0)) return 'the whole frame';
  const p = Math.max(0.1, Math.round((fit.frac / 2) * 1000) / 10);
  return fit.mode === 'trim' ? `the whole frame, trimmed ${p} % ${fit.side}` : `the whole frame, its edges extended ${p} % ${fit.side}`;
}
/** whole seconds the phone restyles from a clip of `duration` s: its first n s, 1..STYLE_CAP_S (0 = shorter than a second) */
export function maxLen(duration, cap = STYLE_CAP_S) {
  const d = Number(duration);
  return Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(cap, Math.floor(d + 1e-3))) : 0;
}
export const framesOf = (len) => STYLE_FPS * len + 1;
/** the length a restyle uses: the one picked, at most what the clip has */
export const lenFor = (picked, max) => Math.max(1, Math.min(Number(picked) || max, max));
/** where frame i of the 16 fps clip sits in the source (s): inside its 1/16 s, so a 16 fps source gives its own frame i */
export const timeOf = (i, fps = STYLE_FPS) => (i + 0.25) / fps;
/** the source rectangle a cover crop of an sw x sh frame into W x H takes (the middle, the same as the engine's prepareStill) */
export function coverRect(sw, sh, W, H) {
  const a = W / H, w = Math.min(sw, sh * a), h = w / a;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

/** "<look words><what happens>" (the lab's prompts: the look sentence, then the description; a full stop is added when missing) */
export function stylePrompt(look, description) {
  let d = String(description || '').replace(/\s+/g, ' ').trim();
  if (d && !/[.!?…"”')]$/.test(d)) d += '.';
  return ((look ? look.words : '') + d).trim();
}

/** the phone's time for a restyle (s) before the app has measured its own (app.js learn()): the desk iGPU's measured times (832 x 480:
 *  2 s 474 s, 5 s 1006 s: reading the clip 475 s, 3 stages 87 s each, the decode 235 s) over its ~1.9x slower graphics than an iPhone
 *  16 Pro Max's - about 4.2 min for 2 s, 8.9 min for 5 s */
export function styleSeconds(width, height, frames) {
  const px = (width * height) / (832 * 480);
  return Math.round((58 + 5.85 * frames) * (0.2 + 0.8 * px));
}

/** what is still missing before Make, in order -> {why, focus} or null. s: {clip (meta or null), preparing, attest, look, prompt} */
export function styleMissing(s) {
  if (!s.clip) return { why: 'Pick a clip first.', focus: 'clip' };
  if (s.preparing) return { why: 'The clip is still being read. One moment.', focus: 'clip' };
  if (!(s.clip.maxLen >= 1)) return { why: 'That clip is shorter than a second. Pick a longer one.', focus: 'clip' };
  if (s.clip.from === 'phone' && !s.attest) return { why: 'Tick the box about your video first.', focus: 'attest' };
  if (!lookOf(s.look)) return { why: 'Pick a look first.', focus: 'looks' };
  if (!String(s.prompt || '').trim()) return { why: 'Say what happens in the clip first.', focus: 'prompt' };
  return null;
}

/** step 2: Klein 4B restyles the clip's first frame (Create's 'edit' job at the clip's size; its picture is reviewed, not saved) */
export function editParams({ look, clip, seed, attested }) {
  const L0 = lookOf(look);
  return { media: 'image', kind: 'i2i', prompt: L0.edit, width: clip.width, height: clip.height, steps: 4, seed, reference: 'half', attested: !!attested,
    sty: { role: 'first', look: L0.id } };
}
/** step 4: the restyle itself ('restyle' queue job -> engine videoToVideo with the looks LoRA). sound: the clip's own sound is kept beside
 *  its frames (ui/clipsound.js): the new clip carries it, cut to its own length. follow: the person's own pick ('close' | 'loose'), or
 *  none for the look's own (-> follow = the setting it runs with, followBy 'you' | 'look') */
export function clipParams({ look, clip, len, seed, prompt, attested, sound = false, follow }) {
  const L0 = lookOf(look), n = lenFor(len, clip.maxLen);
  return { media: 'video', kind: 'v2v', prompt: stylePrompt(L0, prompt), description: String(prompt || '').trim(), width: clip.width, height: clip.height,
    frames: framesOf(n), seed, attested: !!attested, follow: followFor(L0.id, follow), followBy: STYLE_FOLLOW[follow] ? 'you' : 'look', lowswap: STYLE_LOWSWAP, look: L0.id, sound: !!sound,
    sources: [{ from: clip.from, libId: clip.libId || null }], sty: { role: 'clip', look: L0.id } };
}

// ------------------------------------------------------------------------------------------------ v4: the whole video, in parts
// The notes (Nov 2): "The clip also has to be hard clipped to 5 sec. Optional to the user is multi-clip but a notice that it takes a while and
// that requires the last frame to first frame path. And then no stylized first image has to be made but we also label it experimental for
// clips over 5 sec". A longer video is restyled as its first 5 s (STYLE_CAP_S, as before) unless the person turns on "Restyle the whole
// video" (Experimental): up to STYLE_LONG_CAP_S, in parts of 5 s, each its own queued job (ui/style_run.js restyleLongRunner). Part 1 is
// the restyle as before (Klein's first frame, checked); part k + 1 needs no new first frame: part k's LAST frame is pinned at its latent
// slot 0, as Klein's is in part 1. Part k + 1's window starts on the frame part k's ends on, so the join keeps that frame once.
/** the longest video restyled whole: 20 s = 4 parts (about 36 min on a recent phone, ~9 min a part; an older phone takes much longer:
 *  Nov 2, "Let's limit it to 20 sec for now"). Past that the phone sits hot for an hour or more, more can stop on the way, and every
 *  handed-on last frame lets the look drift a little further from the first frame checked */
export const STYLE_LONG_CAP_S = 20;
export const JOIN_SECONDS = 15;   // joining the parts and putting the sound under them (no model; a few seconds)
/** the parts a video of `duration` s is restyled in when the person restyles the whole video: its whole seconds up to the cap, 5 s a part
 *  (the last one shorter, at least 1 s) -> [{i, start (its first frame, 16 fps), from (s), seconds, frames}]; [] for 5 s or less (one part
 *  is the restyle as before) */
export function partsOf(duration, cap = STYLE_LONG_CAP_S) {
  const total = maxLen(duration, cap), out = [];
  if (total <= STYLE_CAP_S) return out;
  for (let s = 0; s < total; s += STYLE_CAP_S) { const n = Math.min(STYLE_CAP_S, total - s); out.push({ i: out.length, start: STYLE_FPS * s, from: s, seconds: n, frames: framesOf(n) }); }
  return out;
}
/** the joined clip's frames: the parts' frames, each shared frame once (16 n + 1 for n s) */
export const joinedFrames = (parts) => parts.reduce((s, p) => s + p.frames, 0) - Math.max(0, parts.length - 1);
/** seconds of video the parts cover */
export const partsSeconds = (parts) => parts.reduce((s, p) => s + p.seconds, 0);
/** each part's own seed (one fixed seed for the whole video, a different noise in every part) */
export const partSeed = (seed, i) => (Number(seed) + 7919 * i) % 2147483648;
/** the phone's time for every part (est(frames) -> s: a restyle's estimate, the app's own once it has measured one) and the join */
export const wholeSeconds = (parts, est) => Math.round(parts.reduce((s, p) => s + est(p.frames), 0) + (parts.length ? JOIN_SECONDS : 0));
const mins = (s) => `about ${Math.max(1, Math.round(s / 60))} min`;
/** what the switch says: {name, note, line ("Restyle the whole video · Experimental · about 36 min for 20 s")}. duration: the clip's own
 *  length (one longer than the cap: "Restyle its first 20 s") */
export function wholeText(parts, eta, duration) {
  const secs = partsSeconds(parts), all = maxLen(duration, Infinity) <= secs, name = all ? 'Restyle the whole video' : `Restyle its first ${secs} s`;
  return { name, line: `${name} · Experimental · ${mins(eta)} for ${secs} s`,
    note: `${cap1(mins(eta))} for ${secs} s: ${parts.length} parts of up to ${STYLE_CAP_S} s, one after another. Only the first frame is checked; each part starts on the last frame of the part before.` };
}
/** the notice before it starts: {title, text, ok}. perPart: one 5 s part's time (s) */
export function wholeNotice(parts, eta, perPart) {
  const secs = partsSeconds(parts);
  return { title: 'This takes a while', ok: `Start · ${mins(eta)}`,
    text: `${cap1(mins(perPart))} for each ${STYLE_CAP_S} s part, ${parts.length} parts: ${mins(eta)} for ${secs} s. Experimental: the look can drift a little from part to part. `
      + 'Each part is its own job; keep p0pc0rn open, with the phone on charge. If a part stops, the parts already made are kept and it carries on from that part.' };
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** step 4 for the whole video: one 'restylelong' job (its parts: 'restyle' jobs it queues one after another) */
export function longParams({ look, clip, parts, seed, prompt, attested, sound = false, follow }) {
  const L0 = lookOf(look);
  return { media: 'video', kind: 'v2v', long: true, parts: parts.map((p) => ({ start: p.start, frames: p.frames, seconds: p.seconds })),
    prompt: stylePrompt(L0, prompt), description: String(prompt || '').trim(), width: clip.width, height: clip.height, frames: joinedFrames(parts), seed, attested: !!attested,
    follow: followFor(L0.id, follow), followBy: STYLE_FOLLOW[follow] ? 'you' : 'look', lowswap: STYLE_LOWSWAP, look: L0.id, sound: !!sound, sources: [{ from: clip.from, libId: clip.libId || null }], sty: { role: 'clip', look: L0.id, long: true } };
}
