// mvflf.js - p0pc0rn v023: the music video from a landed song, END-CAPPED first/last-frame (FLF) only (Josh, Oct 13). The phases,
// one model on the GPU at a time (the queue's EngineHost loads and unloads between them):
//   (a) plan     - Gemma 4 E2B writes the storyboard (storyboard.js checks it in code; the fallback storyboard when it can't)
//   (a) frames   - Klein paints EVERY keyframe (first + last of each shot; a 'continues' shot reuses the shot before's last frame)
//   (b) board    - the storyboard strip is shown; by default the job waits there for the person (frame rerolls + nudge), then Animate
//   (c) shots    - SANA clip_between (framesToVideo) animates every shot between its two frames, in order
//   (d) cut      - mp4.js joins the shots and muxes the song (AAC where the browser encodes it)
// No model QA, no contact-sheet review: the person is the QA. Rerolls (a frame before animating; a shot after, with a nudge and an
// optional "Repaint the stills") queue at the TAIL of the job; the video is cut again when they land and every cut stays in the Library.
// Durable: the coordinator ('mvflf') is a queue job whose stage is saved before every wait, and every frame / shot / cut is its own
// child job in IndexedDB 'p0pc0rn-queue'. A page kill puts the running child back in the queue with the same seed (the engines resume
// their checkpoints) and the coordinator carries on from its saved stage; children are added once per tag, never twice.
// After the job is done, a reroll makes a new version of the job (an "edit"): it copies the frames and takes it keeps.
import { MODEL } from './tools.js';
import { CLIP, NUDGE_MAX, shotSlots, shotCount, buildStoryboard, planStoryboard, gate, nudged, ownedFrames, shotsOfFrame } from './storyboard.js';
import { refPrompt } from '../cast/cast.js';   // v026.5: a Cast lead's name -> "the person in the reference photo" for Klein

export const MV_KINDS = new Set(['mvflf', 'mvplan', 'mvreq']);
const WAIT = { wait: 'any' };   // woken whenever ANY child finishes (a frame, a shot, a reroll request)
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const term = (j) => TERMINAL.has(j.status);
const err = (code, m) => Object.assign(new Error(m), { code });
const mvOf = (j) => (j && j.params && j.params.mv) || {};

/** phone timings (iPhone 16 Pro Max): Klein 1280x720 = 180 s (measured), scaled by pixels; FLF 495.9 s for a 5 s clip (measured on the
 *  probe, Oct 12); the planner ~8 s per shot at 15 tok/s; the cut a few seconds. The job's own finished children replace these. */
export const TIMES = {
  frame: (w, h) => 180 * (0.25 + 0.75 * (w * h) / 921600),
  shot: (frames = 81) => 496 * (0.15 + 0.85 * frames / 81),
  plan: (n) => 10 + 8 * n,
  cut: (n) => 15 + n,
  swaps: 30,
};
/** before anything runs (the Animate sheet): shots, frames (a storyboard has between N + 1 and 2N; about 1.5N) and seconds */
export function estimate(duration, { shape = 'tall', brain = true } = {}) {
  const n = shotCount(duration), frames = Math.ceil(n * 1.5), [w, h] = shape === 'wide' ? [832, 480] : [480, 832];
  const seconds = (brain ? TIMES.plan(n) : 0) + frames * TIMES.frame(w, h) + n * TIMES.shot(81) + TIMES.cut(n) + TIMES.swaps;
  return { shots: n, frames, seconds: Math.round(seconds) };
}

// ------------------------------------------------------------------------------------------------ reading a job's board
const isFrameJob = (c) => !!c && (c.kind === 'picture' || c.kind === 'edit') && mvOf(c).frame != null;   // v026.3: a frame is painted (text) or edited (from its reference)
const framesOfK = (kids, k) => kids.filter((c) => isFrameJob(c) && mvOf(c).frame === k).sort((a, b) => mvOf(a).v - mvOf(b).v);
const takesOfN = (kids, n) => kids.filter((c) => c.kind === 'between' && mvOf(c).shot === n).sort((a, b) => mvOf(a).t - mvOf(b).t);
const cutsOf = (kids) => kids.filter((c) => c.kind === 'assemble' && mvOf(c).cut).sort((a, b) => mvOf(a).cut - mvOf(b).cut);
/** the frame the person sees for keyframe k: the newest painted version (a child job), else the version an edit copied (base) */
function frameCur(job, kids, k) {
  const done = framesOfK(kids, k).filter((c) => c.status === 'done' && c.result && c.result.image);
  const c = done[done.length - 1];
  if (c) return { key: c.result.image.blobKey, v: mvOf(c).v, prompt: c.params.prompt, nudges: mvOf(c).nudges || [], jobId: c.id, ref: mvOf(c).ref || null };
  const b = ((job.params.base || {}).frames || []).find((x) => x.k === k);
  return b ? { key: b.imageKey, v: b.v, prompt: b.prompt, nudges: b.nudges || [], base: true, ref: b.ref || null } : null;
}
function takeCur(job, kids, n) {
  const done = takesOfN(kids, n).filter((c) => c.status === 'done' && c.result && c.result.video);
  const c = done[done.length - 1];
  if (c) return { key: c.result.video.blobKey, t: mvOf(c).t, prompt: c.params.prompt, nudges: mvOf(c).nudges || [], fv: mvOf(c).fv, lv: mvOf(c).lv, jobId: c.id,
    handoff: c.result.handoff ? c.result.handoff.blobKey : null, fh: mvOf(c).fh || null };   // v026.3: its last kept frame; the handoff it started on
  const b = ((job.params.base || {}).takes || []).find((x) => x.n === n);
  return b ? { key: b.videoKey, t: b.t, prompt: b.prompt, nudges: b.nudges || [], fv: b.fv, lv: b.lv, base: true, handoff: b.handoffKey || null, fh: b.fh || null } : null;
}
const nextV = (job, kids, k) => Math.max(0, ...framesOfK(kids, k).map((c) => mvOf(c).v), ...((job.params.base || {}).frames || []).filter((x) => x.k === k).map((x) => x.v)) + 1;
const nextT = (job, kids, n) => Math.max(0, ...takesOfN(kids, n).map((c) => mvOf(c).t), ...((job.params.base || {}).takes || []).filter((x) => x.n === n).map((x) => x.t)) + 1;

/** everything the strip needs: frames (current version, pending repaint, versions), shots (current take, pending, stale), cuts */
export function boardOf(job, kids) {
  const st = job.state || {}, sb = st.sb || null;
  const out = { id: job.id, title: job.params.title || '', status: job.status, stage: st.stage || 'start', hold: !!job.params.hold, go: !!st.go, stuck: st.stuck || null,
    edit: !!job.params.editOf, sb, frames: [], shots: [], cuts: [] };
  if (!sb) return out;
  out.frames = sb.frames.map((f) => {
    const jobs = framesOfK(kids, f.k), cur = frameCur(job, kids, f.k), pend = jobs.find((c) => !term(c)) || null;
    return { k: f.k, prompt: cur ? cur.prompt : f.prompt, base: f.prompt, cur, pending: pend ? { id: pend.id, status: pend.status, v: mvOf(pend).v } : null,
      versions: Math.max(jobs.length, cur ? cur.v : 0), failed: !cur && !pend && jobs.some((c) => c.status === 'failed'), shots: shotsOfFrame(sb, f.k), end: f.end, shot: f.shot,
      chained: chainedLast(sb, f.k) };   // v026.3: painted from the previous clip's last kept frame, after that clip is filmed
  });
  out.shots = sb.shots.map((s) => {
    const jobs = takesOfN(kids, s.n), cur = takeCur(job, kids, s.n), pend = jobs.find((c) => !term(c)) || null;
    const fa = out.frames[s.first].cur, la = out.frames[s.last].cur;
    const prev = s.join === 'continues' ? takeCur(job, kids, s.n - 1) : null, hk = prev ? prev.handoff : null;   // v026.3: the chained start
    return Object.assign({}, s, { cur, pending: pend ? { id: pend.id, status: pend.status, t: mvOf(pend).t } : null, takes: Math.max(jobs.length, cur ? cur.t : 0),
      failed: !cur && !pend && jobs.some((c) => c.status === 'failed'), handoff: hk,
      stale: !!cur && (hk ? cur.fh !== hk || (!!la && cur.lv !== la.v) : !!fa && !!la && (cur.fv !== fa.v || cur.lv !== la.v)) });   // a frame / the previous clip changed since
  });
  out.cuts = cutsOf(kids).map((c) => ({ c: mvOf(c).cut, id: c.id, status: c.status, key: c.status === 'done' && c.result && c.result.video ? c.result.video.blobKey : null }));
  const ready = (x) => !!x.cur && !x.pending;
  out.canRerollFrames = !term(job) && ['plan', 'frames', 'board'].includes(out.stage);
  out.canAnimate = !term(job) && out.stage === 'board' && out.frames.every((f) => f.chained || ready(f));   // v026.3: chained last frames come after their clip
  out.animated = out.shots.filter((s) => s.cur).length;
  out.painted = out.frames.filter((f) => f.cur).length;
  return out;
}

/** the whole job's progress and time left (the board, the chat card, the queue sheet): {text, frac, etaSeconds, waitingForYou} */
export function progressOf(job, kids, now = Date.now()) {
  const P = job.params, st = job.state || {}, b = boardOf(job, kids), [w, h] = [P.width || 480, P.height || 832];
  const n = b.sb ? b.sb.shots.length : shotCount(P.seconds || 30);
  const med = (xs, d) => { const a = xs.filter((x) => x > 0).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : d; };
  const took = (c) => (c.endedAt && c.startedAt ? (c.endedAt - c.startedAt) / 1000 : 0);
  const tF = med(kids.filter((c) => isFrameJob(c) && c.status === 'done').map(took), TIMES.frame(w, h));
  const tS = med(kids.filter((c) => c.kind === 'between' && c.status === 'done').map(took), TIMES.shot(81));
  const nF = b.sb ? b.frames.length : Math.ceil(n * 1.5);
  const fLeft = b.sb ? b.frames.filter((f) => !f.cur).length + b.frames.filter((f) => f.cur && f.pending).length : nF;
  const sLeft = b.sb ? b.shots.filter((s) => !s.cur).length + b.shots.filter((s) => s.cur && s.pending).length : n;
  const lastCut = b.cuts[b.cuts.length - 1], cutLeft = job.status === 'done' ? 0 : 1;
  const planLeft = !b.sb && P.brain !== false ? TIMES.plan(n) : 0;
  const run = kids.find((c) => c.status === 'running');
  let left = planLeft + fLeft * tF + sLeft * tS + cutLeft * TIMES.cut(n);
  if (run) {
    const unit = isFrameJob(run) ? tF : run.kind === 'between' ? tS : run.kind === 'mvplan' ? TIMES.plan(n) : run.kind === 'assemble' ? TIMES.cut(n) : 0;
    const pr = run.progress || {}, f = Math.max(0, Math.min(1, pr.frac || 0));
    left -= Math.min(unit, unit * f);
  }
  const all = (b.sb ? 0 : TIMES.plan(n)) + nF * tF + n * tS + TIMES.cut(n), doneT = Math.max(0, all - left);
  const holding = b.stage === 'board' && !b.go && b.canAnimate;
  const stuck = st.stuck;
  let text;
  const cutsDone = b.cuts.filter((c) => c.status === 'done').length;
  if (job.status === 'done') text = `Done · ${cutsDone > 1 ? `${cutsDone} cuts` : 'the cut'} in the Library`;
  else if (job.status === 'cancelled') text = 'Stopped';
  else if (job.status === 'failed') text = "Didn't finish";
  else if (stuck) text = stuck.what === 'frame' ? `Waiting for you: frame ${stuck.k + 1} didn't paint. Reroll it.` : `Waiting for you: shot ${stuck.n} didn't film. Reroll it.`;
  else if (holding) text = `Waiting for you: check the ${b.frames.length} frames, then Animate`;
  else if (!b.sb) text = 'Writing the storyboard';
  else if (b.stage === 'frames' || b.stage === 'board') text = `Painting frame ${Math.min(b.frames.length, b.painted + 1)} of ${b.frames.length}`;
  else if (b.stage === 'shots') text = `Filming shot ${Math.min(n, b.animated + (run && run.kind === 'between' ? 1 : 0) || 1)} of ${n}`;
  else if (b.stage === 'cut') text = sLeft || fLeft ? `Rerolls: ${sLeft} shot${sLeft === 1 ? '' : 's'} to film` : lastCut && lastCut.status === 'done' ? 'Cutting it again' : 'Cutting the video';
  else text = 'Getting ready';
  if (run && isFrameJob(run) && (b.stage === 'shots' || b.stage === 'cut')) text = 'Repainting a frame';
  return { text, frac: job.status === 'done' ? 1 : Math.max(0, Math.min(0.999, doneT / Math.max(1, all))), etaSeconds: holding || stuck || term(job) ? null : Math.max(0, Math.round(left)), waitingForYou: !!(holding || stuck), shots: n, frames: nF };
}

// ------------------------------------------------------------------------------------------------ the runners (queue job kinds)
/** cfg: {isInstalled(modelId), likeSources() -> KB records (the likeness gate's protected things), realPeople(texts, signal) -> person
 *  records for the names the plan wrote (research.isRealPerson), agent} */
export function mvRunners(cfg) {
  return {
    mvflf: { model: () => null, needsConsent: false, run: (ctx) => coordinator(ctx, cfg) },
    mvplan: { model: () => MODEL.chat, needsConsent: false, async run(ctx) {
      const P = ctx.params, records = await records_(cfg);
      const sb = await planStoryboard({ chat: (m, o) => ctx.engine.chat(m, Object.assign({ signal: ctx.signal }, o)), song: P.song, slots: P.slots, direction: P.direction, shape: P.shape, records,
        moreRecords: cfg.realPeople ? (texts) => cfg.realPeople(texts, ctx.signal) : null, onProgress: ctx.progress, signal: ctx.signal });
      return { storyboard: sb };
    } },
    mvreq: { model: () => null, needsConsent: false, run: async (ctx) => ({ ok: true, type: ctx.params.type }) },   // a person's request: finishing it wakes the coordinator
  };
}
async function records_(cfg) { try { return (cfg.likeSources && await cfg.likeSources()) || []; } catch (e) { return []; } }

async function coordinator(ctx, cfg) {
  const P = ctx.params, job = ctx.job, st = Object.assign({ stage: 'start', seen: [], tries: {} }, ctx.state || {});
  const save = async (patch = {}) => { Object.assign(st, patch); await ctx.setState(st); };
  const kids = () => ctx.children();
  const byTag = (t) => kids().find((c) => c.tag === t && c.status !== 'cancelled');
  const song = { title: P.title || '', tags: P.tags || '', lyrics: P.lyrics || '', seconds: P.seconds };
  const [w, h] = [P.width, P.height];

  if (st.stage === 'start') {
    if (!P.songKey) throw err('NO_SONG', 'the song is missing');
    if (P.editOf) {   // a new version of a finished video: its storyboard + the frames and takes it keeps came in params.base
      // the reroll first (idempotent tags: a kill before the stage is saved just finds them again), then the stage
      for (const [i, op] of (P.ops || []).entries()) await applyShotReroll(ctx.enqueueOnce, job, kids(), P.sb, op, await records_(cfg), `e${i}`);
      await save({ stage: 'shots', sb: P.sb, go: true });
    } else {
      const slots = shotSlots(song);
      if (P.brain !== false && cfg.isInstalled && await cfg.isInstalled(MODEL.chat)) {
        await ctx.enqueueOnce('plan', 'mvplan', { song, slots, direction: dirOf(P), shape: P.shape }, { title: 'storyboard' });
        await save({ stage: 'plan', slots });
        return WAIT;
      }
      await save({ stage: 'frames', slots, sb: buildStoryboard({ song, slots, direction: dirOf(P), shape: P.shape, records: await records_(cfg) }) });
    }
  }
  if (st.stage === 'plan') {
    const c = byTag('plan');
    if (c && !term(c)) return WAIT;
    const sb = c && c.status === 'done' && c.result && c.result.storyboard && c.result.storyboard.shots && c.result.storyboard.shots.length === st.slots.length ? c.result.storyboard
      : Object.assign(buildStoryboard({ song, slots: st.slots, direction: dirOf(P), shape: P.shape, records: await records_(cfg) }), { planFailed: c ? (c.error && c.error.code) || c.status : 'none' });
    await save({ stage: 'frames', sb });
  }
  await handleRequests(ctx, cfg, job, st, save);

  if (st.stage === 'frames' || st.stage === 'board') {
    let waiting = false, stuck = null;
    if (!st.sb.lead) await save({ sb: Object.assign({}, st.sb, { lead: leadOf(st.sb, P) }, P.lead ? { castLead: { id: P.lead.id, name: P.lead.name } } : {}) });   // v026.3: the one lead / setting line, fixed (v026.5: a Cast lead's name)
    for (const f of st.sb.frames) {
      if (chainedLast(st.sb, f.k)) continue;   // v026.3: painted from the previous clip's last kept frame, in the shots stage
      const jobs = framesOfK(kids(), f.k);
      if (jobs.some((c) => !term(c))) { waiting = true; continue; }
      // v026.3: a frame waits for its reference (the opening frame for a cut's first frame, its shot's first frame for a last frame)
      const dk = depOf(st.sb, f.k), dep = dk == null ? null : frameCur(job, kids(), dk);
      if (dk != null && (!dep || framesOfK(kids(), dk).some((c) => !term(c)))) { waiting = true; continue; }
      const cur = frameCur(job, kids(), f.k);
      if (!jobs.length && !cur) { await enqueueFrame(ctx.enqueueOnce, job, kids(), st.sb, f.k, 1, f.prompt, [], `f${f.k}v1`, `frame ${f.k + 1}`); waiting = true; continue; }
      if (cur && stale(st.sb, f.k, cur, dep)) {   // its first frame was repainted: this last frame is edited again from the new one
        const v = nextV(job, kids(), f.k);
        await enqueueFrame(ctx.enqueueOnce, job, kids(), st.sb, f.k, v, cur.prompt, cur.nudges, `f${f.k}v${v}`, `frame ${f.k + 1} (follows its first frame)`, true); waiting = true; continue;
      }
      if (!cur) {   // every version failed: one automatic retry (same words, a new seed), then the person decides
        if (jobs.length < 2) { const last = jobs[jobs.length - 1], v = nextV(job, kids(), f.k); await enqueueFrame(ctx.enqueueOnce, job, kids(), st.sb, f.k, v, last.params.prompt, mvOf(last).nudges, `f${f.k}v${v}`, `frame ${f.k + 1} again`, true); waiting = true; }
        else stuck = stuck || { what: 'frame', k: f.k, error: (jobs[jobs.length - 1].error || {}).code || 'FAILED' };
      }
    }
    if (JSON.stringify(st.stuck || null) !== JSON.stringify(stuck)) await save({ stuck });
    if (waiting || stuck) return WAIT;
    if (st.stage === 'frames') await save({ stage: 'board' });
    if (P.hold && !st.go) return WAIT;   // (b) the storyboard strip waits for the person: frame rerolls, then Animate
    await save({ stage: 'shots' });
  }
  if (st.stage === 'shots' || st.stage === 'cut') {
    let waiting = false, stuck = null;
    if (kids().some((c) => isFrameJob(c) && !term(c))) waiting = true;   // a repaint in flight: its shot's take follows it
    for (const s of st.sb.shots) {
      const jobs = takesOfN(kids(), s.n), cur = takeCur(job, kids(), s.n);
      if (jobs.some((c) => !term(c))) { waiting = true; continue; }
      if (s.join === 'continues' && s.n > 1) {   // v026.3: a CHAINED segment: after the previous take, from its last kept frame
        const ps = st.sb.shots.find((x) => x.n === s.n - 1), prev = takeCur(job, kids(), ps.n);
        if (!prev || takesOfN(kids(), ps.n).some((c) => !term(c))) { waiting = true; continue; }
        if (prev.handoff) {
          const lk = s.last, lc = frameCur(job, kids(), lk);
          if (framesOfK(kids(), lk).some((c) => !term(c))) { waiting = true; continue; }
          if (!lc || !lc.ref || lc.ref.handoff !== prev.handoff) {   // its last keyframe: a Klein edit of the handoff (again when the previous clip changed)
            const v = nextV(job, kids(), lk), base = lc ? lc.prompt : framePrompt(st.sb, lk, st.sb.frames[lk].prompt);
            await enqueueFrame(ctx.enqueueOnce, job, kids(), st.sb, lk, v, base, lc ? lc.nudges : [], `f${lk}v${v}`, `frame ${lk + 1} (from the previous clip)`, true, { key: prev.handoff, shot: ps.n, t: prev.t });
            waiting = true; continue;
          }
          if (!cur || cur.fh !== prev.handoff || cur.lv !== lc.v) {   // the take: from the handoff to that keyframe (again when either changed)
            const t = nextT(job, kids(), s.n), last = jobs[jobs.length - 1];
            const tries = jobs.filter((c) => mvOf(c).fh === prev.handoff && mvOf(c).lv === lc.v && c.status !== 'done').length;
            if (tries >= 2) { stuck = stuck || { what: 'shot', n: s.n, error: (last && last.error || {}).code || 'FAILED' }; continue; }
            await enqueueTake(ctx.enqueueOnce, job, kids(), st.sb, s, t, cur ? cur.prompt : last ? last.params.prompt : s.motion, cur ? cur.nudges : last ? mvOf(last).nudges : [], `s${s.n}t${t}`, t > 1);
            waiting = true; continue;
          }
          continue;
        }
      }
      if (!jobs.length && !cur) { await enqueueTake(ctx.enqueueOnce, job, kids(), st.sb, s, 1, s.motion, [], `s${s.n}t1`); waiting = true; continue; }
      if (!cur) {
        if (jobs.length < 2) { const last = jobs[jobs.length - 1], t = nextT(job, kids(), s.n); await enqueueTake(ctx.enqueueOnce, job, kids(), st.sb, s, t, last.params.prompt, mvOf(last).nudges, `s${s.n}t${t}`, true); waiting = true; }
        else stuck = stuck || { what: 'shot', n: s.n, error: (jobs[jobs.length - 1].error || {}).code || 'FAILED' };
      }
    }
    if (kids().some((c) => c.kind === 'mvreq' && !term(c))) waiting = true;   // a reroll asked for: it is at the tail, the cut waits for it
    if (JSON.stringify(st.stuck || null) !== JSON.stringify(stuck)) await save({ stuck });
    if (waiting || stuck) return WAIT;
    if (st.stage === 'shots') await save({ stage: 'cut' });
  }
  if (st.stage === 'cut') {
    const takes = st.sb.shots.map((s) => takeCur(job, kids(), s.n)), sig = takes.map((t) => `${t.t}:${t.key}`).join(',');
    const cuts = cutsOf(kids()), last = cuts[cuts.length - 1];
    if (last && last.params.sig === sig) {
      if (!term(last)) return WAIT;
      if (last.status === 'done') {
        await save({ stage: 'done' });
        return { videoKey: last.result.video.blobKey, cutId: last.id, version: mvOf(last).cut, seconds: last.result.seconds, audioCodec: last.result.audioCodec || null, shots: st.sb.shots.length, frames: st.sb.frames.length, source: st.sb.source };
      }
      if ((st.tries.cut || 0) >= 1) throw err((last.error && last.error.code) || 'CUT_FAILED', 'the cut failed: ' + ((last.error && last.error.message) || last.status));
      st.tries.cut = (st.tries.cut || 0) + 1;
    }
    const c = (cuts.length ? mvOf(cuts[cuts.length - 1]).cut : 0) + 1;
    await save();
    await ctx.enqueueOnce(`cut${c}`, 'assemble', { clipKeys: takes.map((t) => t.key), durations: st.sb.shots.map((s) => s.dur), songKey: P.songKey, sig, width: w, height: h, title: P.title || '', mv: { cut: c } }, { title: `cut ${c}` });
    return WAIT;
  }
  return WAIT;
}
const frameParams0 = (k, v, prompt, nudges, w, h) => ({ prompt, width: w, height: h, steps: 4, mv: { frame: k, v, nudges: nudges || [] } });
let FQ = null;   // v026.6: the job's frame quality ('9b' = "Better frames (9B), slower"), set by enqueueFrame for its frameParams calls
const frameParams = (k, v, prompt, nudges, w, h) => Object.assign(frameParams0(k, v, prompt, nudges, w, h), FQ ? { quality: FQ } : {});
// ---- v026.3: continuity. The opening frame is painted from text; every other frame is a Klein EDIT of its reference:
//   a shot's last frame <- that shot's first frame (the same person, place, wardrobe and light, to the end state);
//   a cut shot's first frame <- the opening frame (the same lead and world across cuts).
/** the frame a frame is edited from (null = the opening frame, painted from text) */
/** v026.3: frame k is the last keyframe of a 'continues' shot: a Klein edit of the previous take's last KEPT frame (the handoff) */
export function chainedLast(sb, k) { return sb.shots.some((x) => x.join === 'continues' && x.last === k && x.n > 1); }
export function depOf(sb, k) {
  const f = sb.frames[k]; if (!f || k === 0) return null;
  if (f.end === 'last') { const s = sb.shots.find((x) => x.last === k); return s && s.first !== k ? s.first : null; }
  return 0;
}
/** a last frame whose first frame was repainted after it (its reference version is no longer the current one): edited again */
function stale(sb, k, cur, dep) { const f = sb.frames[k]; return !!(f && f.end === 'last' && dep && cur && cur.ref && cur.ref.k === depOf(sb, k) && cur.ref.v !== dep.v); }
/** the one lead / setting line code puts into every frame after the opening one: the opening prompt's subject and place */
export function leadLine(sb) {
  // the subject and the place, without the framing, the pose or the style (those change from frame to frame)
  const p = String((sb.frames[0] && sb.frames[0].prompt) || '').replace(/\s+/g, ' ').trim();
  const first = (p.split(/(?<=[.!?])\s/)[0] || p).replace(/[.!?,;:\s]+$/, '');
  const STOP = /\b(seen from|from behind|from above|from below|close-?up|wide|medium|shot|angle|framing|cinematic|film|photo|still|style|lens|bokeh|depth of field|lighting)\b/i;
  const keep = [];
  for (const c of first.split(/\s*,\s*/)) {
    if (STOP.test(c)) { if (!keep.length) { const cut = c.replace(/^(a |an )?(close-?up|wide shot|medium shot|wide|medium)( shot)?( of)?\s*/i, ''); if (cut && !STOP.test(cut)) keep.push(cut); } break; }
    keep.push(c); if (keep.length >= 3) break;
  }
  return keep.join(', ').split(' ').slice(0, 24).join(' ').replace(/[.,;:\s]+$/, '');
}
/** v026.5: the lead line with a Cast lead: their name first (the opening frame shows them), then the opening prompt's place */
export function leadOf(sb, P) {
  const base = leadLine(sb), lead = P && P.lead;
  if (!lead || !lead.name) return base;
  const names = (lead.names || [lead.name]).filter(Boolean);
  const rest = base.replace(new RegExp(`^(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b[,\\s]*`, 'i'), '');
  return `${lead.name}, the same person as in the reference${rest ? `, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}` : ''}`;
}
/** v026.5: the direction the planner reads: a Cast lead it does not name yet is named ("The lead is <name>.") */
export function dirOf(P) {
  const d = String((P && P.direction) || '').trim(), lead = P && P.lead;
  if (!lead || !lead.name || new RegExp(`\\b${lead.name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(d)) return d;
  return `${d ? d.replace(/[.!?\s]*$/, '.') + ' ' : ''}The lead is ${lead.name}.`.slice(0, NUDGE_MAX + 40);
}
/** the prompt a frame is painted / edited with: its storyboard line (+ nudges) and, after the opening frame, the fixed lead line */
export const framePrompt = (sb, k, text) => (k === 0 || !sb.lead ? text : `${text.replace(/[.\s]*$/, '.')} Keep the same lead and world as the reference: ${sb.lead}.`);
/** one frame version: a picture (the opening frame) or an edit of its reference's CURRENT image (attested: the app's own frame) */
async function enqueueFrame(add, job, kids, sb, k, v, prompt, nudges, tag, title, retry, handoff) {
  const P = job.params, dk = depOf(sb, k), text = retry ? prompt : framePrompt(sb, k, prompt);
  FQ = P.quality === '9b' ? '9b' : null;   // v026.6: every keyframe of a "Better frames" video is painted / edited by the 9B
  if (handoff) {   // v026.3: a chained last keyframe: an edit of the previous take's last kept frame
    return add(tag, 'edit', Object.assign(frameParams(k, v, text, nudges, P.width, P.height), { inputKey: handoff.key, attested: true, reference: 'half',
      mv: { frame: k, v, nudges: nudges || [], ref: { handoff: handoff.key, shot: handoff.shot, t: handoff.t } } }), { title });
  }
  if (dk == null && P.lead && P.lead.key) {   // v026.5: a Cast lead: the opening frame is a Klein edit of their photo (full reference)
    return add(tag, 'edit', Object.assign(frameParams(k, v, refPrompt(text, P.lead.names || [P.lead.name]), nudges, P.width, P.height), { inputKey: P.lead.key, attested: true, reference: 'full',
      cast: { id: P.lead.id, name: P.lead.name }, mv: { frame: k, v, nudges: nudges || [], ref: { cast: P.lead.id } } }), { title });
  }
  if (dk == null) return add(tag, 'picture', frameParams(k, v, text, nudges, P.width, P.height), { title });
  const ref = frameCur(job, kids, dk);
  if (!ref) throw err('NO_FRAMES', `frame ${k + 1} needs frame ${dk + 1} first`);
  return add(tag, 'edit', Object.assign(frameParams(k, v, text, nudges, P.width, P.height), { inputKey: ref.key, attested: true, reference: 'half',
    mv: { frame: k, v, nudges: nudges || [], ref: { k: dk, v: ref.v } } }), { title });
}
/** a shot's take: SANA between its two CURRENT frames (the end caps), the motion line (+ nudges) as the prompt */
async function enqueueTake(add, job, kids, sb, s, t, prompt, nudges, tag, again) {
  // v026.3: a chained ('continues') shot starts on the previous take's last KEPT frame, not on a keyframe
  const prev = s.join === 'continues' && s.n > 1 ? takeCur(job, kids, s.n - 1) : null, hk = prev && prev.handoff;
  const a = hk ? null : frameCur(job, kids, s.first), b = frameCur(job, kids, s.last);
  if ((!a && !hk) || !b) throw err('NO_FRAMES', `shot ${s.n} has no frames to run between`);
  return add(tag, 'between', { prompt, firstKey: hk || a.key, lastKey: b.key, attested: true, width: job.params.width, height: job.params.height, seconds: s.seconds, frames: s.frames,
    keep: s.keep || null, mv: { shot: s.n, t, nudges: nudges || [], fv: a ? a.v : null, lv: b.v, fh: hk || null } }, { title: `shot ${s.n}${again || t > 1 ? ' again' : ''}` });
}
/** the person's requests (mvreq children), in order, once each: 'go' (Animate after the storyboard) and 'shot' (a shot reroll) */
async function handleRequests(ctx, cfg, job, st, save) {
  const reqs = ctx.children().filter((c) => c.kind === 'mvreq' && term(c) && !st.seen.includes(c.tag));
  if (!reqs.length) return;
  for (const r of reqs) {
    st.seen.push(r.tag);
    if (r.status !== 'done') continue;
    const q = r.params || {};
    if (q.type === 'go') st.go = true;
    if (q.type === 'shot' && st.sb) {
      const s = st.sb.shots.find((x) => x.n === q.n); if (!s) continue;
      // v026.3: a stale last frame (its first frame was just repainted) is edited from the new first frame BEFORE the take: repaint it,
      // then ask again for the take (a follow-up request queued after the repaint)
      const lk = s.last, dk = depOf(st.sb, lk), dep = dk == null || chainedLast(st.sb, lk) ? null : frameCur(job, ctx.children(), dk), lc = frameCur(job, ctx.children(), lk);
      if (lc && dep && stale(st.sb, lk, lc, dep)) {
        const v = nextV(job, ctx.children(), lk);
        // "Repaint the stills": the nudge goes into the last frame too (as it did when both were painted from text); else as it was
        const nud = q.repaint ? [...(lc.nudges || []), q.nudge].filter(Boolean).slice(-3) : (lc.nudges || []);
        const g = gate(nudged(st.sb.frames[lk].prompt, nud), { records: await records_(cfg), context: [job.params.title, job.params.tags, job.params.lyrics, job.params.direction].join(' \n ') });
        await enqueueFrame(ctx.enqueueOnce, job, ctx.children(), st.sb, lk, v, g.text || st.sb.frames[lk].prompt, nud, `f${lk}v${v}`, `frame ${lk + 1} (follows its first frame)`);
        await ctx.enqueueOnce(`${r.tag}f`, 'mvreq', { type: 'shot', n: q.n, nudge: q.nudge || '', repaint: false }, { title: `shot ${q.n} reroll` });
        continue;
      }
      // the storyboard's motion line + the nudges of the take the person was looking at + this one (the last 3 are kept)
      const cur = takeCur(job, ctx.children(), s.n), nud = [...((cur && cur.nudges) || []), q.nudge].filter(Boolean).slice(-3);
      const g = gate(nudged(s.motion, nud), { records: await records_(cfg), context: [job.params.title, job.params.tags, job.params.lyrics, job.params.direction].join(' \n '), kind: 'motion' });
      const t = nextT(job, ctx.children(), s.n);
      await enqueueTake(ctx.enqueueOnce, job, ctx.children(), st.sb, s, t, g.text || s.motion, nud, `s${s.n}t${t}`, true);   // (a chained shot starts on the current handoff)
    }
  }
  await save();
}
/** a shot reroll: with "Repaint the stills" its own frames get a new version first (the nudge goes into them too), then a request at
 *  the tail asks the coordinator for the new take (it is made between the frames that are current when the request runs) */
async function applyShotReroll(add, job, kids, sb, { n, nudge = '', repaint = false }, records, tagBase) {
  const ctx2 = [job.params.title, job.params.tags, job.params.lyrics, job.params.direction].join(' \n ');
  const own = repaint ? ownedFrames(sb, n) : [];
  for (const k of own) {
    if (own.includes(depOf(sb, k))) continue;   // v026.3: a last frame whose first frame is repainted too follows it (handleRequests)
    if (chainedLast(sb, k)) {   // v026.3: a chained last keyframe: an edit of the previous take's handoff, with the nudge
      const pt = takeCur(job, kids, n - 1); if (!pt || !pt.handoff) continue;
      const cur = frameCur(job, kids, k), nud = [...((cur && cur.nudges) || []), nudge].filter(Boolean).slice(-3), g = gate(nudged(sb.frames[k].prompt, nud), { records, context: ctx2 });
      if (g.refused) throw err(g.refused, 'that nudge cannot be used');
      const v = nextV(job, kids, k);
      await enqueueFrame(add, job, kids, sb, k, v, g.text || sb.frames[k].prompt, nud, `f${k}v${v}`, `frame ${k + 1} again`, false, { key: pt.handoff, shot: n - 1, t: pt.t });
      continue;
    }
    const cur = frameCur(job, kids, k), nud = [...((cur && cur.nudges) || []), nudge].filter(Boolean).slice(-3), g = gate(nudged(sb.frames[k].prompt, nud), { records, context: ctx2 });
    if (g.refused) throw err(g.refused, 'that nudge cannot be used');
    const v = nextV(job, kids, k);
    await enqueueFrame(add, job, kids, sb, k, v, g.text || sb.frames[k].prompt, nud, `f${k}v${v}`, `frame ${k + 1} again`);
  }
  return add(`${tagBase}`, 'mvreq', { type: 'shot', n, nudge: String(nudge || '').slice(0, NUDGE_MAX), repaint: !!repaint }, { title: `shot ${n} reroll` });
}

// ------------------------------------------------------------------------------------------------ the person's actions (the UI calls these)
const checkNudge = (nudge, records, job) => {
  const t = String(nudge || '').trim().slice(0, NUDGE_MAX);
  if (!t) return { text: '' };
  const g = gate(t, { records, context: [job.params.title, job.params.tags, job.params.lyrics].join(' \n ') });
  if (g.refused) throw err(g.refused, "That nudge can't be used: p0pc0rn doesn't make that.");
  return { text: t };
};
/** Animate from a landed song: the song is copied into the queue's store (the job owns it), then one 'mvflf' job is added */
export async function startMusicVideo(Q, s, { shape = 'tall', direction = '', hold = true, session = null, brain = true, lead = null, frames9b = false } = {}) {
  if (!s || !s.blob) throw err('NO_SONG', 'the song is missing');
  const songKey = await Q.putBlob(s.blob, { kind: 'mv-song' }), [width, height] = shape === 'wide' ? [832, 480] : [480, 832];
  const est = estimate(s.seconds, { shape, brain });
  return Q.add('mvflf', { songKey, songId: s.songId || null, title: s.title || '', tags: s.tags || '', lyrics: s.lyrics || '', bpm: s.bpm || null, seconds: s.seconds, shape: shape === 'wide' ? 'wide' : 'tall',
    width, height, direction: String(direction || '').trim().slice(0, NUDGE_MAX), hold: !!hold, brain: !!brain, estimate: est,
    lead: lead && lead.key ? { id: lead.id, name: lead.name, names: lead.names || [lead.name], key: lead.key } : null, quality: frames9b ? '9b' : null }, { title: `Music video · ${s.title || 'your song'}`, session });   // v026.5: + a Cast lead; v026.6: + 9B frames
}
/** Animate (after checking the storyboard) */
export async function requestGo(Q, mvId) {
  const j = Q.get(mvId); if (!j || term(j)) throw err('NOT_RUNNING', 'this music video is not running');
  const n = Q.children(mvId).filter((c) => c.kind === 'mvreq').length + 1;
  return Q.add('mvreq', { type: 'go' }, { parent: mvId, tag: `r${n}`, title: 'animate' });
}
/** reroll ONE storyboard frame before animating (+ an optional nudge): a new version at the tail; the strip shows it when it lands */
export async function requestFrameReroll(Q, mvId, k, { nudge = '', records = [] } = {}) {
  const j = Q.get(mvId), kids = Q.children(mvId), b = j && boardOf(j, kids);
  if (!b || !b.sb || !b.canRerollFrames) throw err('TOO_LATE', 'Frames are rerolled before the shots are animated. Reroll the shot instead (Repaint the stills).');
  const f = b.sb.frames[k]; if (!f) throw err('NO_FRAME', 'no such frame');
  const cur = frameCur(j, kids, k), extra = checkNudge(nudge, records, j).text;
  const nud = [...((cur && cur.nudges) || []), extra].filter(Boolean).slice(-3);
  const g = gate(nudged(f.prompt, nud), { records, context: [j.params.title, j.params.tags, j.params.lyrics, j.params.direction].join(' \n ') });
  const v = nextV(j, kids, k);
  // v026.3: a frame with a reference (a last frame: its first frame; a cut's first frame: the opening frame) is edited from the reference's
  // CURRENT image; rerolling a first frame repaints its last frame automatically once it lands (the coordinator sees it is stale)
  return enqueueFrame((tag, kind, params, o) => Q.add(kind, params, Object.assign({ parent: mvId, tag }, o)), j, kids, b.sb, k, v, g.text || f.prompt, nud, `f${k}v${v}`, `frame ${k + 1} again`);
}
/**
 * reroll ONE shot after it was animated (+ nudge; repaint = new first/last frames first). While the job runs the reroll is added at its
 * tail and the video is cut again when it lands. A finished job gets a NEW version (an edit) that keeps every other frame and take;
 * earlier cuts stay in the Library. -> {job, edit: bool, shares: [shot numbers whose join may now jump]}
 */
export async function requestShotReroll(Q, mvId, n, { nudge = '', repaint = false, records = [] } = {}) {
  let j = Q.get(mvId); if (!j) throw err('NO_JOB', 'this music video is gone');
  const live = [...Q.jobs.values()].find((x) => x.kind === 'mvflf' && x.params.editOf === mvId && !term(x));
  if (j.status === 'done' && live) j = live;   // a version of it is already being made: the reroll joins that one
  const kids = Q.children(j.id), b = boardOf(j, kids);
  if (!b.sb) throw err('NO_BOARD', 'the storyboard is not ready');
  const s = b.shots.find((x) => x.n === n); if (!s) throw err('NO_SHOT', 'no such shot');
  if (!s.cur && !s.failed) throw err('NOT_YET', `Shot ${n} is not animated yet.`);   // a shot that didn't film twice waits for this reroll
  const extra = checkNudge(nudge, records, j).text;
  const shares = repaint ? b.sb.shots.filter((x) => x.n !== n && ownedFrames(b.sb, n).some((k) => x.first === k || x.last === k)).map((x) => x.n) : [];
  if (j.status === 'cancelled' || j.status === 'failed') throw err('NOT_RUNNING', 'this music video stopped: make it again from the song');
  if (j.status !== 'done') {
    const nReq = kids.filter((c) => c.kind === 'mvreq').length + 1;
    await applyShotReroll((tag, kind, params, opts) => Q.add(kind, params, Object.assign({}, opts, { parent: j.id, tag })), j, kids, b.sb, { n, nudge: extra, repaint }, records, `r${nReq}`);
    return { job: j, edit: false, shares };
  }
  return { job: await createEdit(Q, j, kids, b, { n, nudge: extra, repaint }), edit: true, shares };
}
/** a finished video -> a new 'mvflf' job that copies the song, the storyboard and the current frames + takes (their blobs are copied,
 *  so removing the old job never takes them away), then makes the reroll and cuts again */
async function createEdit(Q, j, kids, b, op) {
  const copy = async (key) => { const blob = await Q.getBlob(key); if (!blob) throw err('MISSING', 'a part of the video is gone'); return Q.putBlob(blob, { kind: 'mv-copy' }); };
  const frames = [], takes = [], hand = new Map();   // v026.3: the handoffs are copied once and every reference to one follows the copy
  const handCopy = async (key) => { if (!key) return null; if (!hand.has(key)) hand.set(key, await copy(key)); return hand.get(key); };
  for (const s of b.shots) if (s.cur && s.cur.handoff) await handCopy(s.cur.handoff);
  for (const f of b.frames) if (f.cur) frames.push({ k: f.k, imageKey: await copy(f.cur.key), v: f.cur.v, prompt: f.cur.prompt, nudges: f.cur.nudges || [],
    ref: f.cur.ref ? Object.assign({}, f.cur.ref, f.cur.ref.handoff ? { handoff: await handCopy(f.cur.ref.handoff) } : {}) : null });
  for (const s of b.shots) if (s.cur) takes.push({ n: s.n, videoKey: await copy(s.cur.key), t: s.cur.t, prompt: s.cur.prompt, nudges: s.cur.nudges || [], fv: s.cur.fv, lv: s.cur.lv,
    handoffKey: await handCopy(s.cur.handoff), fh: await handCopy(s.cur.fh) });
  const P = Object.assign({}, j.params, { songKey: await copy(j.params.songKey), editOf: j.id, version: (j.params.version || 1) + 1, sb: b.sb, base: { frames, takes }, ops: [op], hold: false });
  delete P.estimate;
  return Q.add('mvflf', P, { title: `Music video · ${j.params.title || 'your song'} (edit)`, session: j.session });
}
/** the music-video job a queue job belongs to (itself, or its parent), or null */
export function mvRoot(Q, j) {
  if (!j) return null;
  if (j.kind === 'mvflf') return j;
  const p = j.parent && Q.get(j.parent);
  return p && p.kind === 'mvflf' ? p : null;
}
