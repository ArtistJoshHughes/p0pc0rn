// runners.js - what each queue job does, through the engine API (ENGINE_API.md; the new engines in INTEGRATION.md):
//   picture / edit -> 'flux2-klein-4b'     textToImage / imageToImage
//   clip           -> 'sanavideo2-5b'      textToVideo
//   animate        -> MODEL.animate        imageToVideo({image, prompt, seconds, size, seed})        (engine side being probed)
//   between        -> MODEL.between        framesToVideo({first, last, prompt, seconds, size, seed}) (engine side being probed)
//   foley          -> 'mmaudio-small-44k'  videoToAudio
//   song           -> 'acestep15-turbo'    textToMusic
//   chat           -> 'gemma4-e2b'         chat (agent.js)
//   musicvideo     -> no model: a coordinator (song -> shot plan -> stills for the shots that need them -> clips (text, or the still
//                     animated) -> one review -> optional foley -> assemble)
//   assemble       -> no model: mp4.js (CPU + WebCodecs audio)
//   mvflf          -> no model: v023's music video from a landed song, end-capped first/last frame only (assistant/mvflf.js): plan
//                     (mvplan, 'gemma4-e2b') -> every keyframe (picture) -> the storyboard -> every shot (between) -> the cut (assemble);
//                     mvreq = the person's Animate / reroll request (no model: finishing it wakes the coordinator)
// Every engine call gets the job's fixed seed and its AbortSignal; progress goes to ctx.progress. A resumed job calls the engine with
// the SAME arguments, which is how the engines' own checkpoints resume (Klein per step, SANA-Video per step / decode-only).
import { MODEL, planSlots, lyricSections, normalizeLyrics, FRAMES, CLIP_SIZE, SONG_DEFAULTS } from './tools.js';
import { assemble as assembleMp4 } from './mp4.js';
import { mvRunners } from './mvflf.js';   // v023
import { checkSong } from './audiocheck.js';   // v024.1: never DONE with a file the phone cannot play

// v026.3 (Josh: "Should it get the same 0.5-second trim?" "Yes"): SANA's last frames drift toward the end picture (it morphs), so a
// first/last-frame clip keeps its first frames only: 81 rendered -> frames 0..71 kept (4.5 s at 16 fps). The end picture guides the
// motion and is never shown. Create's 'Between two pictures', the Library's 'Make a clip' / 'Clip to another picture' and the chat's
// clip_between all trim here; a music-video take (params.mv) keeps its whole render: the cut trims it to the shot and a chained shot
// starts on its frame keep-1 (the handoff). Plain i2v and t2v clips are unchanged (no end picture, no morph).
export const FLF_DROP = 9;
export const flfKeep = (frames) => Math.max(8, (frames || 81) - FLF_DROP);
/** the first `keep` frames of an MP4: a remux (no re-encode), so the kept frames are the engine's own bytes */
export async function keepHead(blob, keep, fps = 16) {
  const r = await assembleMp4({ clips: [blob], durations: [(keep + 0.5) / fps] });
  return { blob: r.blob, frames: r.edl && r.edl[0] ? r.edl[0].frames : keep };
}

const drop = (r) => { try { if (r && r.url) URL.revokeObjectURL(r.url); } catch (e) { /* */ } };
// v026.6: a picture or an edit with params.quality '9b' runs on FLUX.2 [klein] 9B ("Better pictures"); everything else stays on the 4B
export const K9B = 'flux2-klein-9b';
const picModel = (j) => (j && j.params && j.params.quality === '9b' ? K9B : null);

export function createRunners({ agent = null, isInstalled = () => true, foleyDefault = false, assemble = assembleMp4, likeSources = null, realPeople = null } = {}) {
  const cfg = { agent, isInstalled, foleyDefault, likeSources, realPeople };
  const R = {
    picture: { model: (j) => picModel(j) || MODEL.picture, async run(ctx) {
      const p = ctx.params;
      const r = await ctx.engine.textToImage({ prompt: p.prompt, width: p.width, height: p.height, seed: p.seed, steps: p.steps || 4, onProgress: ctx.progress, signal: ctx.signal });
      drop(r);
      return Object.assign({ image: r.blob, width: r.width, height: r.height, seed: r.seed, steps: r.steps, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0 }, r.model ? { model: r.model } : {});
    } },
    edit: { model: (j) => picModel(j) || MODEL.edit, async run(ctx) {
      const p = ctx.params;
      if (!p.attested) throw Object.assign(new Error('the photo has no rights attestation'), { code: 'NOT_ATTESTED' });
      const image = await ctx.getBlob(p.inputKey);
      if (!image) throw Object.assign(new Error('the photo to edit is gone'), { code: 'BAD_IMAGE' });
      const r = await ctx.engine.imageToImage({ image, prompt: p.prompt, width: p.width, height: p.height, reference: p.reference || 'half', seed: p.seed, steps: p.steps || 4, onProgress: ctx.progress, signal: ctx.signal });
      drop(r);
      return Object.assign({ image: r.blob, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0 }, r.model ? { model: r.model } : {});
    } },
    clip: { model: () => MODEL.clip, async run(ctx) {
      const p = ctx.params;
      const r = await ctx.engine.textToVideo({ prompt: p.prompt, width: p.width, height: p.height, frames: p.frames, seed: p.seed, onProgress: ctx.progress, signal: ctx.signal });
      drop(r);
      if (!r.blob) throw Object.assign(new Error('the clip came back empty'), { code: 'EMPTY_CLIP' });
      return { video: r.blob, frames: r.frames, fps: r.fps, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0 };
    } },
    animate: { model: () => MODEL.animate, async run(ctx) {
      const p = ctx.params;
      if (!p.attested) throw Object.assign(new Error('the picture has no rights attestation'), { code: 'NOT_ATTESTED' });
      const image = await ctx.getBlob(p.imageKey);
      if (!image) throw Object.assign(new Error('the picture to animate is gone'), { code: 'BAD_IMAGE' });
      const r = await ctx.engine.imageToVideo({ image, prompt: p.prompt, seconds: p.seconds, size: { width: p.width, height: p.height }, seed: p.seed, onProgress: ctx.progress, signal: ctx.signal });
      drop(r);
      if (!r.blob) throw Object.assign(new Error('the clip came back empty'), { code: 'EMPTY_CLIP' });
      return { video: r.blob, frames: r.frames, fps: r.fps, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0 };
    } },
    between: { model: () => MODEL.between, async run(ctx) {
      const p = ctx.params;
      if (!p.attested) throw Object.assign(new Error('the pictures have no rights attestation'), { code: 'NOT_ATTESTED' });
      const first = await ctx.getBlob(p.firstKey), last = await ctx.getBlob(p.lastKey);
      if (!first || !last) throw Object.assign(new Error('a picture of the pair is gone'), { code: 'BAD_IMAGE' });
      // v026.3 (the music video): render p.frames, keep the first p.keep (the cut drops the rest: SANA's last frames morph toward the end
      // keyframe); the last KEPT frame comes back as a PNG (the handoff a 'continues' shot starts on, pixel for pixel)
      const r = await ctx.engine.framesToVideo({ first, last, prompt: p.prompt, seconds: p.seconds, frames: p.frames, size: { width: p.width, height: p.height }, seed: p.seed, onProgress: ctx.progress, signal: ctx.signal, _keepFrames: !!p.keep });
      drop(r);
      if (!r.blob) throw Object.assign(new Error('the clip came back empty'), { code: 'EMPTY_CLIP' });
      let handoff = null;
      if (p.keep && r._r && r._r.readFrame) {
        const k = Math.min(p.keep, r.frames) - 1, rgba = await r._r.readFrame(k);
        const cv = new OffscreenCanvas(r.width, r.height); cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, r.width * r.height * 4), r.width, r.height), 0, 0);
        handoff = await cv.convertToBlob({ type: 'image/png' });
      }
      // v026.3: a standalone first/last-frame clip is saved trimmed (frames 0..keep-1); its length everywhere is the kept frames
      let video = r.blob, frames = r.frames, fileFrames = null;
      if (!p.mv) { frames = flfKeep(r.frames); const t = await keepHead(r.blob, frames, r.fps || 16); video = t.blob; fileFrames = t.frames; }
      return Object.assign({ video, frames, rendered: r.frames, keep: p.keep || frames, fps: r.fps, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0 },
        fileFrames != null ? { fileFrames } : {}, handoff ? { handoff } : {});
    } },
    foley: { model: () => MODEL.foley, async run(ctx) {
      const p = ctx.params, video = await ctx.getBlob(p.videoKey);
      if (!video) throw Object.assign(new Error('the clip is gone'), { code: 'BAD_VIDEO' });
      const r = await ctx.engine.videoToAudio({ video, prompt: p.prompt || '', negativePrompt: p.negativePrompt || '', seconds: p.seconds, seed: p.seed, onProgress: ctx.progress, signal: ctx.signal });
      drop(r);
      return Object.assign({ audio: r.audio || r.blob, seconds: r.seconds, sampleRate: r.sampleRate }, r.mp4 ? { video: r.mp4 } : {});
    } },
    song: { model: () => MODEL.song, async run(ctx) {
      // the one hand-off point: markers, structure and the line budget are always applied here (music probe v002)
      const p = ctx.params, bpm = p.bpm || SONG_DEFAULTS.bpm, L = normalizeLyrics(p.lyrics || '', p.tags || '', { seconds: p.seconds || 60, bpm });
      const r = await ctx.engine.textToMusic(Object.assign({ tags: L.tags, lyrics: L.lyrics, seconds: p.seconds || 60, bpm, lm: p.lm !== false, seed: p.seed, onProgress: ctx.progress, signal: ctx.signal },
        p.key ? { key: p.key } : {}, p.timeSignature ? { timeSignature: p.timeSignature } : {}));
      drop(r);
      const audio = r.audio || r.blob, chk = await checkSong(audio, p.seconds || 60);
      if (!chk.ok) throw Object.assign(new Error(`the song file is not playable: ${chk.why}`), { code: 'BAD_AUDIO', info: chk.info || null });
      return { audio, seconds: r.seconds || p.seconds, sampleRate: r.sampleRate, sections: r.sections || null, lyrics: L.lyrics, tags: L.tags, bpm };
    } },
    assemble: { model: () => null, async run(ctx) {
      const p = ctx.params, clips = [];
      for (const k of p.clipKeys) { const b = await ctx.getBlob(k); if (!b) throw Object.assign(new Error('a clip of the cut is missing'), { code: 'MISSING_CLIP' }); clips.push(b); }
      const song = p.songKey ? await ctx.getBlob(p.songKey) : null, foley = [];
      for (const f of p.foley || []) { const b = await ctx.getBlob(f.key); if (b) foley.push({ blob: b, at: f.at }); }
      const r = await assemble({ clips, durations: p.durations, song, foley, onProgress: ctx.progress, signal: ctx.signal });
      return { video: r.blob, seconds: r.seconds, audioCodec: r.audioCodec, edl: r.edl };
    } },
    musicvideo: { model: () => null, run: (ctx) => musicVideo(ctx, cfg) },
  };
  Object.assign(R, mvRunners(cfg));   // v023: mvflf (the coordinator), mvplan (the storyboard on the assistant), mvreq (the person's requests)
  // the agent needs the queue and the queue needs the runners: attach the agent once both exist (not a job kind: non-enumerable)
  Object.defineProperty(R, 'attach', { enumerable: false, value: (a) => { cfg.agent = a; R.chat = a.runner(); return R; } });
  if (agent) R.attach(agent);
  return R;
}

/**
 * The music-video coordinator: a state machine over CHILD jobs, re-run (woken) by the queue whenever its children are finished.
 * Its stage is saved before each wait, and children are added with enqueueOnce(tag), so a page kill never duplicates work.
 * params: {idea, title, tags, lyrics, seconds (30|60), shape ('tall'|'wide'), songKey?, songSeconds?, foley?: bool}
 */
export async function musicVideo(ctx, { agent, isInstalled, foleyDefault }) {
  const P = ctx.params, st = Object.assign({ stage: 'start' }, ctx.state || {});
  const kids = () => ctx.children(), byTag = (t) => kids().find((c) => c.tag === t && c.status !== 'cancelled');
  const failed = (c) => c && (c.status === 'failed');
  const brain = !!agent && await isInstalled(MODEL.chat);
  const set = async (patch) => { Object.assign(st, patch); await ctx.setState(st); };
  const [w, h] = CLIP_SIZE[P.shape === 'wide' ? 'wide' : 'tall'];

  if (st.stage === 'start') {
    if (P.songKey) { await set({ stage: 'plan', song: { key: P.songKey, seconds: P.songSeconds || P.seconds, lyrics: P.lyrics || '', tags: P.tags || '', title: P.title || '' } }); }
    else if (P.tags && (P.lyrics || /instrumental/i.test(P.tags) || !brain)) { await set({ stage: 'song', words: { title: P.title || '', tags: P.tags, lyrics: P.lyrics || '', bpm: P.bpm, key: P.key, timeSignature: P.timeSignature } }); }
    else if (brain) { await ctx.enqueueOnce('words', 'chat', { purpose: 'songwrite', idea: P.idea, seconds: P.seconds, tags: P.tags || '', bpm: P.bpm || null }, { title: 'song words' }); await set({ stage: 'words' }); return { wait: 'all' }; }
    else await set({ stage: 'song', words: { title: P.title || '', tags: 'pop, upbeat, instrumental', lyrics: '', bpm: P.bpm || 110 } });
  }
  if (st.stage === 'words') {
    const c = byTag('words');
    const r = c && c.status === 'done' ? c.result : { title: P.title || '', tags: 'pop, upbeat, instrumental', lyrics: '', bpm: P.bpm || 110 };
    await set({ stage: 'song', words: { title: r.title, tags: r.tags, lyrics: r.lyrics, bpm: r.bpm, key: r.key, timeSignature: r.timeSignature } });
  }
  if (st.stage === 'song') {
    const c = byTag('song');
    if (!c) {
      const w = st.words;
      await ctx.enqueueOnce('song', 'song', Object.assign({ title: w.title, tags: w.tags, lyrics: w.lyrics, seconds: P.seconds, bpm: w.bpm || SONG_DEFAULTS.bpm, lm: true },
        w.key ? { key: w.key } : {}, w.timeSignature ? { timeSignature: w.timeSignature } : {}), { title: 'song' });
      return { wait: 'all' };
    }
    if (failed(c)) throw Object.assign(new Error('the song failed: ' + ((c.error && c.error.message) || '')), { code: (c.error && c.error.code) || 'SONG_FAILED' });
    if (c.status !== 'done') return { wait: 'all' };
    await set({ stage: 'plan', song: { key: c.result.audio.blobKey, seconds: c.result.seconds || P.seconds, lyrics: c.result.lyrics || st.words.lyrics, tags: c.result.tags || st.words.tags, title: st.words.title, sections: c.result.sections || null } });
  }
  if (st.stage === 'plan') {
    const slots = planSlots(st.song.seconds, st.song.sections || lyricSections(st.song.lyrics));
    const c = byTag('plan');
    // stills (a Klein picture as the first frame, then animated) are offered only when both models are on the phone
    const stills = (await isInstalled(MODEL.picture)) && (await isInstalled(MODEL.animate)) ? Math.ceil(slots.length / 2) : 0;
    if (brain && !c) { await set({ slots }); await ctx.enqueueOnce('plan', 'chat', { purpose: 'shotplan', idea: P.idea, title: st.song.title, tags: st.song.tags, lyrics: st.song.lyrics, shape: P.shape, slots, maxStills: stills, avoid: P.avoid || null }, { title: 'shot plan' }); return { wait: 'all' }; }
    if (c && !['done', 'failed', 'cancelled'].includes(c.status)) return { wait: 'all' };
    const shots = c && c.status === 'done' ? c.result.shots : slots.map((s) => ({ n: s.n, prompt: `${P.idea}. A moment from the ${s.section} of the song, a wide view, soft natural light. The camera holds still. The clip ends with the scene calm, framed wide.` }));
    for (const sh of shots) if (!stills) delete sh.still;
    await set({ stage: 'stills', slots, shots });
  }
  if (st.stage === 'stills') {
    // all the stills first: one model swap for the whole batch (Klein), at the clip's own size so the first frame matches exactly
    let waiting = false;
    for (const sh of st.shots.filter((x) => x.still)) {
      const c = await ctx.enqueueOnce('still' + sh.n, 'picture', { prompt: sh.still, width: w, height: h, steps: 4, shot: sh.n }, { title: `still ${sh.n}` });
      if (!['done', 'failed', 'cancelled'].includes(c.status)) waiting = true;
    }
    if (waiting) return { wait: 'all' };
    await set({ stage: 'clips' });
  }
  // a shot whose still finished is animated from it; a shot without one (or whose still failed) is made from words
  const stillOf = (n) => { const c = byTag('still' + n); return c && c.status === 'done' && c.result && c.result.image ? c.result.image.blobKey : null; };
  const shotJob = (s, prompt) => {
    const key = stillOf(s.n);
    return key ? ['animate', { prompt, imageKey: key, attested: true, width: w, height: h, seconds: s.dur, frames: FRAMES[s.dur], shot: s.n }]
      : ['clip', { prompt, width: w, height: h, frames: FRAMES[s.dur], shot: s.n }];
  };
  if (st.stage === 'clips') {
    let waiting = false;
    for (const s of st.slots) {
      const sh = st.shots.find((x) => x.n === s.n), [kind, params] = shotJob(s, sh.prompt);
      const c = await ctx.enqueueOnce('clip' + s.n, kind, params, { title: `shot ${s.n}` });
      if (!['done', 'failed', 'cancelled'].includes(c.status)) waiting = true;
    }
    if (waiting) return { wait: 'all' };
    const bad = st.slots.filter((s) => failed(byTag('clip' + s.n)));
    if (bad.length) throw Object.assign(new Error(`shot ${bad[0].n} failed: ${(byTag('clip' + bad[0].n).error || {}).message || ''}`), { code: (byTag('clip' + bad[0].n).error || {}).code || 'CLIP_FAILED' });
    await set({ stage: brain ? 'review' : 'sound' });
  }
  if (st.stage === 'review') {
    const c = byTag('review');
    if (!c) {
      const shots = st.slots.map((s) => ({ n: s.n, prompt: st.shots.find((x) => x.n === s.n).prompt, videoKey: byTag('clip' + s.n).result.video.blobKey }));
      await ctx.enqueueOnce('review', 'chat', { purpose: 'mvreview', shots }, { title: 'review shots' }); return { wait: 'all' };
    }
    if (!['done', 'failed', 'cancelled'].includes(c.status)) return { wait: 'all' };
    const rr = c.status === 'done' ? c.result.rerolls || [] : [];
    for (const r of rr) { const s = st.slots.find((x) => x.n === r.n); const sh = st.shots.find((x) => x.n === r.n); sh.prompt = r.fix_prompt;
      const [kind, params] = shotJob(s, r.fix_prompt);
      await ctx.enqueueOnce('clip' + s.n + 'r', kind, params, { title: `shot ${s.n} again` }); }
    await set({ stage: 'rerolls', rerolled: rr.map((r) => r.n) });
    if (rr.length) return { wait: 'all' };
  }
  if (st.stage === 'rerolls') {
    if (kids().some((c) => !['done', 'failed', 'cancelled'].includes(c.status))) return { wait: 'all' };
    await set({ stage: 'sound' });
  }
  const finalClip = (s) => { const r = byTag('clip' + s.n + 'r'); return r && r.status === 'done' ? r : byTag('clip' + s.n); };   // a failed reroll keeps the first take
  if (st.stage === 'sound') {
    if ((P.foley != null ? P.foley : foleyDefault) && await isInstalled(MODEL.foley)) {
      let waiting = false;
      for (const s of st.slots) { const c = await ctx.enqueueOnce('foley' + s.n, 'foley', { prompt: '', negativePrompt: 'music, speech', videoKey: finalClip(s).result.video.blobKey, seconds: s.dur }, { title: `sound ${s.n}` }); if (!['done', 'failed', 'cancelled'].includes(c.status)) waiting = true; }
      if (waiting) return { wait: 'all' };
    }
    await set({ stage: 'cut' });
  }
  if (st.stage === 'cut') {
    const c = byTag('cut');
    if (!c) {
      const foley = st.slots.map((s) => { const f = byTag('foley' + s.n); return f && f.status === 'done' ? { key: f.result.audio.blobKey, at: s.start } : null; }).filter(Boolean);
      await ctx.enqueueOnce('cut', 'assemble', { clipKeys: st.slots.map((s) => finalClip(s).result.video.blobKey), durations: st.slots.map((s) => s.dur), songKey: st.song.key, foley }, { title: 'cut' });
      return { wait: 'all' };
    }
    if (c.status !== 'done') throw Object.assign(new Error('the cut failed: ' + ((c.error && c.error.message) || c.status)), { code: (c.error && c.error.code) || 'CUT_FAILED' });
    await set({ stage: 'done' });
    return { videoKey: c.result.video.blobKey, songKey: st.song.key, seconds: c.result.seconds, shots: st.slots.length, edl: c.result.edl, audioCodec: c.result.audioCodec,
      plan: st.slots.map((s) => ({ n: s.n, start: s.start, seconds: s.dur, section: s.section, prompt: st.shots.find((x) => x.n === s.n).prompt, mode: stillOf(s.n) ? 'still' : 'text',
        still: st.shots.find((x) => x.n === s.n).still || null, rerolled: (st.rerolled || []).includes(s.n) })) };
  }
  return { wait: 'all' };
}
