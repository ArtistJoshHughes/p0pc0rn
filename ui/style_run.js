// style_run.js - v4 Phase 4: the queue's 'restyle' job (Create › Video › Restyle a clip, step 4): the picked clip's frames pack and the
// styled first frame (both in the queue's own store, so a page kill keeps them) -> engine videoToVideo -> the new clip. The app adds the
// looks LoRA (videoAdapter: one LoRA a job) and the LTX-2 licence wait (ltxGate) around it, as for every video job. A resumed job calls
// the engine with the SAME arguments (the source's hash is its queue key), which is how the engine's checkpoint picks it up again: the
// source latent, the pinned frame and the last finished stage are on the phone (engine runV2V).
// v4 (Nov 2): the clip's own sound (soundKey: a WAV kept at pick time, ui/clipsound.js) goes under the new clip, cut to its length;
// and 'restylelong', the whole video in parts: a coordinator (no model) that queues one 'restyle' job a part, each part starting on the
// last frame of the part before (keepLast: that frame as the engine made it, a PNG), then joins them and puts the sound under the whole.
import { readPack } from './clipprep.js';
import { STYLE_START, STYLE_FOLLOW, STYLE_FPS, partSeed, followOf } from './style_v2v.js';

const fail = (code, m) => Object.assign(new Error(m), { code });
/** the engine counts a restyle's stages as its schedule's (stage k of 5 from stage 2 for Closely, of 4 from stage 1 for Loosely; its
 *  progress says which: startStep); the app's progress shows the ones that run: 1 of 3. p.step = stages done (ui/stage.js) */
export function stagesOf(q, k0 = STYLE_START) {
  if (!q || q.phase !== 'denoise' || !q.steps) return q;
  if (q.startStep != null) k0 = q.startStep;
  const n = q.steps - k0, d = Math.max(0, Math.min(n, (q.step || 0) - 1 - k0));
  return Object.assign({}, q, { step: d, steps: n, message: /Step \d+ of \d+/.test(q.message || '') ? `Step ${d + 1} of ${n}` : q.message });
}
const drop = (r) => { try { if (r && r.url) URL.revokeObjectURL(r.url); } catch (e) { /* */ } };
/** the clip's last frame as the engine made it (its frames kept: _keepFrames), a PNG; without them (an engine that keeps none) the MP4's own
 *  last frame */
async function lastFrame(r) {
  if (r._r && typeof r._r.readFrame === 'function' && typeof OffscreenCanvas !== 'undefined') {
    const rgba = await r._r.readFrame(r.frames - 1), cv = new OffscreenCanvas(r.width, r.height);
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, r.width * r.height * 4), r.width, r.height), 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  }
  const { prepareClip } = await import('./clipprep.js');
  return (await prepareClip(r.blob, { width: r.width, height: r.height, frames: 1, start: r.frames - 1 })).first;
}
/** the kept sound under a clip -> {video, sound ('aac' | 'opus' | 'none' | 'failed'), soundWhy} (a sound that cannot be added leaves the clip silent) */
async function withSound(video, wav, frames, wanted) {
  if (!wanted) return { video, sound: 'none', soundWhy: null };
  if (!wav) return { video, sound: 'failed', soundWhy: 'the kept sound is gone' };
  try {
    const { muxSound } = await import('./clipsound.js');
    const m = await muxSound(video, wav, frames, STYLE_FPS);
    return m.blob ? { video: m.blob, sound: m.codec, soundWhy: null } : { video, sound: 'failed', soundWhy: m.why };
  } catch (e) { return { video, sound: 'failed', soundWhy: String((e && e.message) || e).slice(0, 160) }; }
}

/** a job's schedule for the engine: its `follow` ('close' | 'loose'); a job queued before Nov 3 has its own startStep instead (stage 1,
 *  the model's own stages), so it runs, and resumes, as it was queued */
export const scheduleOf = (p) => (p.follow || p.startStep == null ? { follow: followOf(p.follow) } : { startStep: p.startStep });
/** -> the queue runner {model, run(ctx)}; ctx: {params: {sourceKey, firstKey, prompt, width, height, frames, seed, attested, follow,
 *  lowswap, look, soundKey?, keepLast?}, engine (the video model's adapter), getBlob, progress, signal}. keepLast: a part of a whole video
 *  that another part starts on (its last frame comes back as `last`); soundKey: the clip's own sound, cut to the new clip's length */
export function restyleRunner({ model }) {
  return { model: () => model, async run(ctx) {
    const p = ctx.params;
    if (!p.attested) throw fail('NOT_ATTESTED', 'the clip has no rights attestation');
    const pack = await ctx.getBlob(p.sourceKey), first = await ctx.getBlob(p.firstKey);
    if (!pack) throw fail('BAD_VIDEO', 'the clip to restyle is gone');
    if (!first) throw fail('BAD_IMAGE', 'the restyled first frame is gone');
    const src = await readPack(pack);
    if (src.frames < p.frames) { src.close(); throw fail('BAD_VIDEO', `the clip has ${src.frames} frames, not ${p.frames}`); }
    src.hash = `pack:${p.sourceKey}:${pack.size}`;   // stable across a reload: the engine's checkpoint key
    const sch = scheduleOf(p), k0 = sch.follow ? STYLE_FOLLOW[sch.follow].k0 : sch.startStep;
    try {
      const r = await ctx.engine.videoToVideo(Object.assign({ source: src, first, prompt: p.prompt, size: { width: p.width, height: p.height }, frames: p.frames, seed: p.seed,
        lowswap: p.lowswap || null, onProgress: (q) => { if (ctx.progress) ctx.progress(stagesOf(q, k0)); }, signal: ctx.signal }, sch, p.keepLast ? { _keepFrames: true } : {}));
      drop(r);
      if (!r || !r.blob) throw fail('EMPTY_CLIP', 'the clip came back empty');
      const last = p.keepLast ? await lastFrame(r) : null;
      if (p.keepLast && !last) throw fail('EMPTY_CLIP', 'the clip\'s last frame could not be kept');
      const s = await withSound(r.blob, p.soundKey ? await ctx.getBlob(p.soundKey) : null, r.frames, !!p.soundKey);
      return Object.assign({ video: s.video, frames: r.frames, fps: r.fps, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0,
        look: p.look || null, follow: sch.follow || null, peakMB: r.peakMB != null ? Math.round(r.peakMB) : null, lora: r.lora && r.lora.applied ? { id: r.lora.id || null, pack: r.lora.packVersion || null } : null,
        sound: s.sound, soundWhy: s.soundWhy }, last ? { last } : {}, p.part ? { part: p.part } : {});
    } finally { src.close(); }
  } };
}

// ------------------------------------------------------------------------------------------------ the whole video, in parts
/** part i's own 'restyle' job: its window's frames, its first frame (Klein's for part 1, the part before's last frame after that), its seed */
export function partParams(P, i, firstKey) {
  const n = P.parts.length, part = P.parts[i];
  return { sourceKey: P.packKeys[i], firstKey, prompt: P.prompt, width: P.width, height: P.height, frames: part.frames, seed: partSeed(P.seed, i), attested: !!P.attested,
    ...scheduleOf(P), lowswap: P.lowswap || null, look: P.look || null, keepLast: i < n - 1, part: { i, n } };
}
/** the tag of part i's try t (a part that failed gets a new try when the person carries on) */
export const partTag = (i, t) => `p${i + 1}.${t}`;
/** -> the 'restylelong' runner (a coordinator: no model). ctx.params: {packKeys (one frames pack a part), firstKey (Klein's checked frame),
 *  soundKey?, parts: [{frames}], prompt, width, height, seed, attested, follow, lowswap, look}. ctx.state: {next, tries, done, failed}.
 *  It queues part `next` and waits; woken when it ends: done -> the next part (its first frame = this part's last), failed or stopped ->
 *  PART_FAILED (state.failed says which part and why; a retry of this job queues a new try of THAT part: the parts before are kept).
 *  After the last part: the parts joined (each shared frame once), the clip's own sound under the whole, cut to its length. */
export function restyleLongRunner() {
  return { model: () => null, async run(ctx) {
    const P = ctx.params, n = (P.parts || []).length;
    if (!P.attested) throw fail('NOT_ATTESTED', 'the clip has no rights attestation');
    if (!n || !Array.isArray(P.packKeys) || P.packKeys.length !== n) throw fail('BAD_VIDEO', 'the parts of the video are missing');
    const st = Object.assign({ next: 0, tries: {}, done: [], failed: null }, ctx.state || {});
    const say = (i, frac, message, phase = 'load') => { if (ctx.progress) ctx.progress({ phase, part: { i, n }, frac, message }); };
    while (st.next < n) {
      const i = st.next, t = st.tries[i] || 1, tag = partTag(i, t), kid = ctx.children().find((c) => c.tag === tag);
      if (!kid) {
        const firstKey = i === 0 ? P.firstKey : st.done[i - 1] && st.done[i - 1].lastKey;
        if (!firstKey) throw fail('BAD_IMAGE', `part ${i} left no last frame to start part ${i + 1} on`);
        st.failed = null; await ctx.setState(st);
        await ctx.enqueueOnce(tag, 'restyle', partParams(P, i, firstKey), { title: `Part ${i + 1} of ${n} · ${String(P.description || P.prompt || '').slice(0, 48)}` });
        say(i, i / n, `Part ${i + 1} of ${n}`);
        return { wait: 'all' };
      }
      if (kid.status === 'done') {
        const r = kid.result || {};
        if (!(r.video && r.video.blobKey) || (i < n - 1 && !(r.last && r.last.blobKey))) throw fail('EMPTY_CLIP', `part ${i + 1} came back without its clip`);
        st.done[i] = { videoKey: r.video.blobKey, lastKey: r.last ? r.last.blobKey : null, frames: r.frames, seconds: r.seconds || 0, resumedFromStep: r.resumedFromStep || 0 };
        st.next = i + 1; await ctx.setState(st); continue;
      }
      if (kid.status === 'failed' || kid.status === 'cancelled') {
        const code = kid.status === 'cancelled' ? 'CANCELLED' : (kid.error && kid.error.code) || 'ERROR';
        st.tries[i] = t + 1; st.failed = { part: i, code, message: String((kid.error && kid.error.message) || '').slice(0, 200) }; await ctx.setState(st);
        throw fail('PART_FAILED', `part ${i + 1} of ${n} did not finish (${code})`);
      }
      return { wait: 'all' };   // it waits its turn or runs (a blocked part waits for the agreement or a download)
    }
    // every part is done: one clip (no re-encode), then the sound
    say(n - 1, 0.995, 'Joining the parts', 'join');
    const blobs = [];
    for (const d of st.done) { const b = await ctx.getBlob(d.videoKey); if (!b) throw fail('BAD_VIDEO', 'a finished part is gone'); blobs.push(b); }
    const { joinParts } = await import('./clipsound.js');
    const j = await joinParts(blobs);
    if (P.soundKey) say(n - 1, 0.998, 'Adding the sound', 'join');
    const s = await withSound(j.blob, P.soundKey ? await ctx.getBlob(P.soundKey) : null, j.frames, !!P.soundKey);
    return { video: s.video, frames: j.frames, fps: STYLE_FPS, width: P.width, height: P.height, seed: P.seed, seconds: st.done.reduce((a, d) => a + (d.seconds || 0), 0),
      parts: n, partTimes: st.done.map((d) => ({ frames: d.frames, seconds: d.seconds, resumedFromStep: d.resumedFromStep })), resumedFromStep: 0, look: P.look || null, sound: s.sound, soundWhy: s.soundWhy };
  } };
}
