// talk.js - p0pc0rn "Make them talk" (EXPERIMENTAL; Josh, Oct 14: "Lipsync probe landed a higher quality lipsync. Let's ship that but note
// it's experimental in the app"). MuseTalk 1.5 (the lip-sync probe v002 engine: v2 blend, f16 VAE, recycling pool) redraws the mouth of
// a clip to a spoken line, through the ONE queue:
//   'lipsync' - a render (consent-gated): {videoKey, audioKey, attested, blend} -> a checked MP4 (H.264 + the line's sound)
//   'talk'    - the coordinator (no model): the line (a Cast 'say' job, or one given), the clip (one given: a Library clip; or made from the
//               Cast member's photo: Klein paints a steady front-facing head-and-shoulders still from it, SANA animates it), then 'lipsync'.
// Only Cast members speak (their own consented voice); a clip's face is the Cast member's own photo, or a clip the person ticked as theirs
// or permitted (the app's upload attestation). Every child is its own queue job: one model on the GPU at a time, fresh pages between.
'use strict';
import { refForShape, refPrompt } from './cast.js';
import { checkMp4, playableVideo } from './avcheck.js';

export const LIPSYNC_MODEL = 'musetalk-1.5';
const err = (code, m) => Object.assign(new Error(m), { code });
const TALK_STILL = 'a head-and-shoulders portrait facing the camera straight on, eyes to the lens, neutral relaxed expression, lips closed, '
  + 'soft even light, a plain softly blurred indoor background, sharp focus on the face';
const TALK_MOTION = 'The person talks calmly to the camera: small natural head movement, a blink, the mouth mostly closed. The camera holds still.';

/** the queue's 'lipsync' runner (the app's adapter: lipSync({video, audio, attest, blend, onProgress, signal}) with fresh pages inside) */
export function lipsyncRunner() {
  return { model: () => LIPSYNC_MODEL, async run(ctx) {
    const P = ctx.params;
    if (!P.attested) throw err('NOT_ATTESTED', 'The clip has no consent: only a Cast member or a clip you ticked as yours or permitted.');
    const [video, audio] = await Promise.all([ctx.getBlob(P.videoKey), ctx.getBlob(P.audioKey)]);
    if (!video) throw err('BAD_VIDEO', 'The clip is gone.');
    if (!audio) throw err('BAD_AUDIO', 'The spoken line is gone.');
    // wall-clock seconds per stage, kept in the job's state: the engine's own timings restart after a planned fresh page (a resumed run
    // reports ~0 for the stages it read back from its checkpoint), so Diagnostics would lose the stages before the reload
    const st = Object.assign({}, ctx.state || {}), wall = st.wall = Object.assign({}, st.wall || {});
    let ph = null, tp = performance.now(), ts = tp;
    const tick = (next) => { const t = performance.now(); if (ph) wall[ph] = +((wall[ph] || 0) + (t - tp) / 1000).toFixed(2); tp = t;
      if (next !== ph || t - ts > 3000) { ph = next; ts = t; Promise.resolve(ctx.setState(st)).catch(() => {}); } };
    const r = await ctx.engine.lipSync({ video, audio, attest: true, blend: P.blend === 'plain' ? 'plain' : 'v2', resume: true, signal: ctx.signal,
      onProgress: (p) => { if (p.phase !== 'stage') { tick(p.phase); ctx.progress({ phase: p.phase, frac: p.frac || 0, message: p.message || p.phase, frame: p.frame, frames: p.frames }); } } });
    tick(null);
    try { if (r.url) URL.revokeObjectURL(r.url); } catch (e) { /* */ }
    if (!r.mp4Blob) throw err('NO_VIDEO', `The lip-sync made no video (${r.muxErr || 'unknown'}).`);
    // no lip-sync is done with a file this phone cannot play: the H.264 track + the sound track, then the browser's own player
    const c = checkMp4(new Uint8Array(await r.mp4Blob.arrayBuffer()), { frames: r.frames, seconds: r.frames / r.fps, audio: r.mux !== 'video-only' });
    if (!c.ok) throw err('BAD_FILE', `The video was made, but its file is broken: ${c.problems.join('; ')}`);
    const pv = await playableVideo(r.mp4Blob);
    if (!pv.ok && !pv.timeout) throw err('BAD_FILE', `The video was made, but this phone could not play it (${pv.error || 'no duration'}).`);
    const q = r.quality || null;
    return { video: r.mp4Blob, frames: r.frames, fps: r.fps, width: r.width, height: r.height, seconds: r.seconds, mux: r.mux, peakMB: r.peakMB, timings: r.timings, stageSec: wall,
      totalSec: +Object.values(wall).reduce((a, b) => a + b, 0).toFixed(1),
      quality: q ? { frame: q.frame, sharp: q.sharp, sharpPlain: q.sharpPlain, sharpMedian: q.sharpMedian, faceW: q.faceW, faceH: q.faceH, stretch: q.stretch } : null };
  } };
}

/** the 'talk' coordinator. params = {personId, name, line?, audioKey?, sayJobId?, clipKey?, clipFrom: 'library' | 'photo', attested, blend,
 *  shape ('tall' | 'wide'), session?}. cast = createCast(); say = (sid, msg) posts to the chat; sizes = {tall: [w, h], wide: [w, h]} */
export function talkRunner({ cast, say = null, sizes, frames = 81 }) {
  return { model: () => null, async run(ctx) {
    const P = ctx.params, st = Object.assign({ stage: 'audio' }, ctx.state || {}), save = () => ctx.setState(st);
    const kid = (id) => ctx.queue.get(id), doneOf = (id) => { const c = kid(id); return c && c.status === 'done' ? c : null; };
    const failed = (id, what) => { const c = kid(id); if (!c) throw err('LOST', `The ${what} job is gone.`); if (c.status === 'cancelled') throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); if (c.status === 'failed') throw err((c.error && c.error.code) || 'CHILD_FAILED', `The ${what} didn't finish: ${(c.error && c.error.message) || ''}`); };
    const [w, h] = sizes[P.shape === 'wide' ? 'wide' : 'tall'];
    // 1. the spoken line
    if (!st.audioKey) {
      if (P.audioKey) st.audioKey = P.audioKey;
      else if (P.sayJobId) { const c = kid(P.sayJobId); if (!c || !c.result || !c.result.audio) throw err('BAD_AUDIO', 'That line is gone: say it again.'); st.audioKey = c.result.audio.blobKey; }
      else if (!st.sayJob) { const c = await ctx.enqueueOnce('say', 'say', { personId: P.personId, name: P.name, line: P.line }, { title: `${P.name} says` }); st.sayJob = c.id; await save(); return { wait: 'all' }; }
      else { const c = doneOf(st.sayJob); if (!c) { failed(st.sayJob, 'spoken line'); return { wait: 'all' }; } st.audioKey = c.result.audio.blobKey; }
      await save();
    }
    // 2. the clip: given (a Library clip, attested), or made from the Cast member's photo (Klein still -> SANA image-to-video)
    if (!st.clipKey) {
      if (P.clipKey) st.clipKey = P.clipKey;
      else {
        if (!st.stillJob) {
          const person = await cast.get(P.personId), ph = person && person.photos[0];
          if (!ph) throw err('NO_PHOTO', `${P.name} has no photo in your Cast: add one, or pick a clip from the Library.`);
          const ref = await refForShape(await cast.getBlob(ph.key), w, h), inputKey = await ctx.putBlob(ref, { role: 'cast-ref' });
          const c = await ctx.enqueueOnce('still', 'edit', { prompt: refPrompt(TALK_STILL, [P.name]), inputKey, attested: true, reference: 'full', width: w, height: h, steps: 4, cast: { id: P.personId, name: P.name } }, { title: `${P.name} · still` });
          st.stillJob = c.id; await save(); return { wait: 'all' };
        }
        if (!st.clipJob) {
          const c = doneOf(st.stillJob); if (!c) { failed(st.stillJob, 'still'); return { wait: 'all' }; }
          const a = await ctx.enqueueOnce('clip', 'animate', { prompt: TALK_MOTION, imageKey: c.result.image.blobKey, attested: true, width: w, height: h, seconds: (frames - 1) / 16, frames }, { title: `${P.name} · clip` });
          st.clipJob = a.id; await save(); return { wait: 'all' };
        }
        const c = doneOf(st.clipJob); if (!c) { failed(st.clipJob, 'clip'); return { wait: 'all' }; }
        st.clipKey = c.result.video.blobKey;
      }
      await save();
    }
    // 3. the lip-sync
    if (!st.lipJob) {
      const c = await ctx.enqueueOnce('lipsync', 'lipsync', { videoKey: st.clipKey, audioKey: st.audioKey, attested: !!P.attested || !P.clipKey, blend: P.blend || 'v2', name: P.name, line: P.line || '', session: P.session || null }, { title: `${P.name} talks` });
      st.lipJob = c.id; await save(); return { wait: 'all' };
    }
    const c = doneOf(st.lipJob); if (!c) { failed(st.lipJob, 'lip-sync'); return { wait: 'all' }; }
    if (say && ctx.job.session && !st.told) {
      st.told = true; await save();
      await say(ctx.job.session, { text: `Here's ${P.name} saying it. Lip-sync is experimental.`, kind: 'result', jobId: c.id, media: { kind: 'lipsync', blobKey: c.result.video.blobKey } });
    }
    return { video: { blobKey: c.result.video.blobKey }, lipJob: c.id };
  } };
}
