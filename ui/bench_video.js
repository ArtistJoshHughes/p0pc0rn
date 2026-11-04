// bench_video.js - v4: Settings › Benchmark › Video (a check that the video model works on
// the phone with the slightly higher workload, the LoRA included). Pure parts
// (no DOM; node-tested): the plan, each test's engine call, its pass / fail rule and numbers, and the card's lines. ui/bench.js runs the
// tests as 'bench' jobs through the app's queue, like the Full benchmark's clip (a planned fresh page per clip on a phone carries on).
//   Quick (about 14 minutes; the limit is 15): picture to video WITH the video LoRA, first + last frame WITH it, the same
//   picture to video WITHOUT it (its steps only: the LoRA's cost per step; the decode is the same), and (v4 Phase 3) style video to video:
//   the bundled clip's first frame restyled by Klein 4B on the phone, then the clip re-rendered from stage 1 with the looks LoRA (c20).
//   832 x 480, 2 s (33 frames), one fixed seed, the bundled test pictures and clip (ui/bench_video/: an original character, Sorrel the
//   clay fox, made with FLUX.2 [klein] 4B and SANA-Video 2.0 for p0pc0rn; not a real person).
// Each test reports pass / fail, seconds a step, the decode, the whole clip, the peak graphics memory the engine measured for it and whether
// the LoRA was applied. The clips are thrown away; the card stays on the phone (Copy shares it); nothing is sent anywhere.

export const VIDEO_SIZE = Object.freeze({ width: 832, height: 480, frames: 33 });
export const VIDEO_SEED = 20261101;
export const VIDEO_PICS = Object.freeze({ first: 'ui/bench_video/fox-first.jpg', last: 'ui/bench_video/fox-last.jpg', clip: 'ui/bench_video/fox-move.mp4' });
const LOOK = 'Sorrel, a clay fox gardener with a straw hat and blue overalls, in a garden bed, stop-motion claymation.';
export const VIDEO_PROMPTS = Object.freeze({
  i2v: `${LOOK} Sorrel bends down to touch a leaf, then straightens up slowly. Its tail wags gently once. The camera holds still.`,
  flf: `${LOOK} Sorrel bends down to touch a leaf, then straightens up and rests its paws on its knees. The camera holds still.`,
  // v4 Phase 3: the look (the lab's 'illus': the Klein edit's words, and the words in front of the clip's prompt)
  edit: 'Turn this picture into a hand-drawn storybook illustration: clean ink outlines, soft gouache and watercolor washes, visible paper grain, clearly illustrated and not a photograph. Keep the exact same composition, pose, framing, subject and colours.',
  v2v: `A hand-drawn storybook illustration with clean ink outlines and soft gouache washes on paper. ${LOOK} Sorrel bends down to touch a leaf, then straightens up slowly. Its tail wags gently once. The camera holds still.`,
});
// lora: 'pic' = the video LoRA (f3: picture clips), 'style' = the looks LoRA (c20: style video to video), false = none; model: the queue's
export const VTESTS = Object.freeze({
  vi2vl: { name: 'Video · picture to video, LoRA on', mode: 'i2v', lora: 'pic', model: 'video', eta: 190 },
  vflfl: { name: 'Video · first + last frame, LoRA on', mode: 'flf', lora: 'pic', model: 'video', eta: 200 },
  vi2v: { name: 'Video · picture to video, LoRA off (steps only)', mode: 'i2v', lora: false, stepsOnly: true, model: 'video', eta: 110 },
  vv2vedit: { name: 'Video · style: frame 0 restyled (Klein 4B)', mode: 'edit', lora: false, model: 'image', eta: 80 },
  vv2vl: { name: 'Video · style video to video, looks LoRA on', mode: 'v2v', lora: 'style', model: 'video', eta: 250 },
});
// v4 (Josh's iPhone, Nov 2: the page ended in Klein's 2nd step when the restyle of frame 0 came 4th, after ~13 min of clips, the steps
// ~40 % slower by then): the picture model goes FIRST, on a cool phone, and the run switches models once (picture -> video) instead of
// twice; its picture waits in the queue's store for the last step (a result's blob goes with the job that names it: vv2vl's firstKey)
export const VQUICK = Object.freeze(['vv2vedit', 'vi2vl', 'vflfl', 'vi2v', 'vv2vl']);
export const VFULL = VQUICK;   // one Video run (Phase 3 filled the slot Full kept)
export const isVideoTest = (k) => Object.prototype.hasOwnProperty.call(VTESTS, k);

/** what this phone has -> the tests to run and the ones skipped with why. env {video, reader, ltx, lora, loraHere, image, venc, vencHere,
 *  style, styleHere}: the video model, the picture reader, the video licence accepted, the video LoRA downloaded / in this build, the picture
 *  model, the clip reader downloaded / in this build, the looks LoRA downloaded / in this build */
export function videoPlan(full, env = {}) {
  const tests = [], skipped = [];
  const base = !env.video ? 'the video model is not downloaded (Settings › Models)' : !env.reader ? 'the picture reader is not downloaded (Settings › Models)'
    : !env.ltx ? 'make one clip first (it shows the video licence)' : null;
  const style = !env.vencHere ? 'no clip reader in this build' : !env.venc ? 'the clip reader is not downloaded (Settings › Models)'
    : !env.styleHere ? 'no looks LoRA in this build' : !env.style ? 'the looks LoRA is not downloaded (Settings › Models)'
    : !env.image ? 'the picture model is not downloaded (Settings › Models)' : null;
  for (const k of full ? VFULL : VQUICK) {
    const T = VTESTS[k];
    if (T.later) { skipped.push({ k, why: T.later }); continue; }
    if (base) { skipped.push({ k, why: base }); continue; }
    if (T.lora === 'pic' && !env.loraHere) { skipped.push({ k, why: 'no video LoRA in this build' }); continue; }
    if (T.lora === 'pic' && !env.lora) { skipped.push({ k, why: 'the video LoRA is not downloaded (Settings › Models)' }); continue; }
    if ((T.mode === 'edit' || T.mode === 'v2v') && style) { skipped.push({ k, why: style }); continue; }
    tests.push(k);
  }
  return { tests, skipped, eta: tests.reduce((s, k) => s + VTESTS[k].eta, 0) };
}

/** the engine call of test k ({method, opts}); pictures = {first, last, styled} Blobs, clip = the source's frames ({frames, read}); ids =
 *  {pic, style} the LoRAs' ids (a string = the picture clips' id, as before) */
export function videoCall(k, pictures, ids, clip) {
  const T = VTESTS[k], L = typeof ids === 'string' ? { pic: ids } : (ids || {});
  if (!T || T.later) throw new Error('not in this build: ' + (T ? T.later : k));
  if (T.mode === 'edit') return { method: 'imageToImage', opts: { image: pictures.first, prompt: VIDEO_PROMPTS.edit, width: VIDEO_SIZE.width, height: VIDEO_SIZE.height, steps: 4, seed: VIDEO_SEED } };
  const o = { prompt: VIDEO_PROMPTS[T.mode], size: { width: VIDEO_SIZE.width, height: VIDEO_SIZE.height }, frames: VIDEO_SIZE.frames, seed: VIDEO_SEED,
    lora: T.lora ? { id: L[T.lora], scale: 1 } : null };
  if (T.stepsOnly) o._noDecode = true;
  if (T.mode === 'v2v') return { method: 'videoToVideo', opts: Object.assign(o, { first: pictures.styled, source: clip, follow: 'close' }) };
  return T.mode === 'flf' ? { method: 'framesToVideo', opts: Object.assign(o, { first: pictures.first, last: pictures.last }) }
    : { method: 'imageToVideo', opts: Object.assign(o, { image: pictures.first }) };
}

const r1 = (x) => (x == null || !Number.isFinite(+x) ? null : Math.round(+x * 10) / 10);
/** an engine result (imageToVideo / framesToVideo) -> the test's numbers + pass / fail */
export function videoNumbers(k, r, wallS) {
  const T = VTESTS[k], t = (r && r.timings) || {}, steps = Array.isArray(t.steps) ? t.steps.map(Number).filter(Number.isFinite) : [];
  const L = r && r.lora;
  const out = { test: k, mode: T.mode, frames: r && r.frames, width: r && r.width, height: r && r.height,
    sPerStep: steps.length ? r1(steps.reduce((a, b) => a + b, 0) / steps.length) : null, steps: steps.map(r1), decodeS: r1(t.decode), totalS: r1(r && r.seconds), wallS: r1(wallS),
    clipS: t.clip != null ? r1(t.clip) : undefined,
    peakMB: r && r.peakMB != null ? Math.round(r.peakMB) : null, denoisePeakMB: r && r.denoisePeakMB != null ? Math.round(r.denoisePeakMB) : null,
    lora: L && L.applied ? { applied: true, scale: L.scale, rank: L.rank, pack: L.packVersion || null } : { applied: false }, resumedFromStep: (r && r.resumedFromStep) || 0 };
  const why = [];
  if (T.mode === 'edit') {   // the styled first frame: a picture of the clip's size
    const ok = !!(r && r.blob && r.blob.size > 0 && r.width === VIDEO_SIZE.width && r.height === VIDEO_SIZE.height);
    return { test: k, mode: 'edit', ok, why: ok ? undefined : 'no picture of the clip size came back', totalS: r1(r && r.seconds), wallS: r1(wallS), peakMB: r && r.peakMB != null ? Math.round(r.peakMB) : null, steps: [], lora: { applied: false } };
  }
  if (T.stepsOnly) out.stepsOnly = true;
  if (!T.stepsOnly && (!r || !r.blob || !(r.blob.size > 0))) why.push('no clip came back');
  if (!T.stepsOnly && r && r.frames !== VIDEO_SIZE.frames) why.push(`${r.frames} frames, not ${VIDEO_SIZE.frames}`);
  if (T.lora && !out.lora.applied) why.push('the LoRA was not applied');
  if (!T.lora && out.lora.applied) why.push('the LoRA was applied');
  const want = T.mode === 'v2v' ? 3 : 4;   // style video to video: 3 stages (Closely: from stage 2 with a stage added; Loosely: from stage 1)
  if (steps.length !== want && !out.resumedFromStep) why.push(`${steps.length} steps, not ${want}`);
  out.ok = !why.length; if (why.length) out.why = why.join('; ');
  return out;
}

const clock = (s) => (s == null ? '–' : s >= 90 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
/** v4: the step's last heartbeat (ui/bench.js keeps it in localStorage while an engine call runs) -> words for the card when the page
 *  ended in that step: how far it got, its memory, and how long nothing was heard before this page opened. beat: {test, message, frac,
 *  aliveMB, peakMB, startedAt, at}; now: this page's open time */
export function beatWords(beat, now = Date.now()) {
  if (!beat || !beat.at || !beat.startedAt) return '';
  const ran = Math.round((beat.at - beat.startedAt) / 1000), quiet = Math.round((now - beat.at) / 1000);
  const mem = beat.aliveMB != null ? ` · the engine had ${Math.round(beat.aliveMB)} MB${beat.peakMB != null ? `, ${Math.round(beat.peakMB)} MB at most` : ''}` : '';
  return `last heard ${ran} s into it, at “${String(beat.message || beat.phase || 'the start').slice(0, 40)}”${mem}; nothing more for ${quiet} s before the app opened again`;
}

/** the card's lines for a Video run (res.tests: {k: numbers | {error}}; plan.skipped) */
export function videoLines(res) {
  const L = [], tests = res.tests || {};
  for (const k of VFULL) {
    const T = VTESTS[k], v = tests[k], sk = (res.vskip || []).find((x) => x.k === k);
    if (!v) { if (sk && (res.full || !T.full)) L.push(`${T.name}: not run (${sk.why})`); continue; }
    if (v.error) { L.push(`${T.name}: fail (${v.error})`); continue; }
    if (v.mode === 'edit') { L.push(`${T.name}: ${v.ok ? 'pass' : 'fail (' + v.why + ')'} · total ${clock(v.totalS)}${v.peakMB != null ? ` · peak ${v.peakMB} MB` : ''}`); continue; }
    const lora = v.lora && v.lora.applied ? `LoRA applied (scale ${v.lora.scale}, rank ${v.lora.rank})` : 'no LoRA';
    L.push(`${T.name}: ${v.ok ? 'pass' : 'fail (' + v.why + ')'} · ${v.sPerStep != null ? v.sPerStep + ' s a step' : '– s a step'}${v.clipS != null ? ` · reading the clip ${clock(v.clipS)}` : ''}${v.stepsOnly ? ' · no decode (steps only)' : ` · decode ${clock(v.decodeS)}`} · total ${clock(v.totalS)}`
      + `${v.peakMB != null ? ` · peak ${v.peakMB} MB` : ''} · ${lora}${v.resumedFromStep ? ` · carried on from step ${v.resumedFromStep}` : ''}`);
  }
  const on = tests.vi2vl, off = tests.vi2v;
  if (on && off && !on.error && !off.error && on.sPerStep && off.sPerStep) {
    // the middle step time (a first step that waited on something else does not count) and the peak DURING THE STEPS (the LoRA-off clip
    // has no decode, so the whole-clip peaks are not alike)
    const mid = (v) => { const s = (v.steps || []).slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : v.sPerStep; };
    const d = mid(on) - mid(off), pct = (100 * d) / mid(off), dp = on.denoisePeakMB != null && off.denoisePeakMB != null ? on.denoisePeakMB - off.denoisePeakMB : null;
    L.push(`The LoRA's cost: ${d >= 0 ? '+' : ''}${(Math.round(d * 10) / 10).toFixed(1)} s a step (${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %)`
      + (dp != null ? `, peak during the steps ${dp >= 0 ? '+' : ''}${dp} MB` : ''));
  }
  const ran = VFULL.filter((k) => tests[k]), ok = ran.filter((k) => tests[k] && !tests[k].error && tests[k].ok).length;
  if (ran.length) L.push(`Video: ${ok} pass, ${ran.length - ok} fail`);
  return L;
}
