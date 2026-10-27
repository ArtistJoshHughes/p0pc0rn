// bench.js - Settings › Benchmark (3.8): how fast THIS phone runs p0pc0rn. Quick (~3 min, ~4 with the Bigger brain): Juli's chat speed, a long prompt read-in and
// the apps (each one starts; Trip Watch checks a test trip with Juli). Full (~13-16 min): + one picture, one short clip and one song, for
// the models that are downloaded. The jobs go through the app's own
// queue (one model at a time, the screen stays on), each with its time shown first. The results card stays on the phone: Copy puts the
// text on the clipboard to share it; nothing is sent anywhere. The picture and clip times also teach Create's time estimates.
// 3.8 v040: + the Bigger brain (NVIDIA Bolt E4B, where it runs: iOS 27's second process, or a desktop browser) in Quick: its chat
// speed and a ~1,100-token read-in (it reads up to 2,048 tokens); Full: + a long answer from each model. Each model's load line says
// how it loaded (split = its first layers in a second process, with each side's memory) and one line says why the Bigger brain was
// not run on this phone.
// 3.9 (Josh, Oct-26: "we also need the full bench test in the popcorn app under settings. Including everything up to this point so as
// to ensure all features get a pass fail"): Full keeps every speed test above as it was (the numbers compare run to run) and adds a pass
// / fail check of every feature (ui/bench_core.js plans them, ui/bench_features.js runs them): the home screen, the chat, skills, Music,
// routines, games, making and changing an app, the Bigger brain's writing, the two processes. They use test data only and remove it; the
// card ends with "Features: N pass, M fail" and one line a check, and a last line says whether the person's own data is as it was.
// Music check (its own button): the lock-screen part of Music, which needs the person to lock the phone (ui/music.js).
// 3.9 (Josh's first phone Full runs, Oct-26): a planned fresh page (the app switching models) carries the check on with its saved state
// on every page it takes; a page the PHONE ended fails its check and the run goes on (bench_core.js afterReload); the card has one line
// a check, says when a second process stopped (Two processes · stayed up for the whole run) and marks the speed lines measured in one
// process after it; the run's own jobs a stopped run left in the queue go before the data check.
import { FEATURES, featurePlan, runOrder, etaOf, isFeature, featureOf, featureLines, derive, snapDiff, fxAdd, fxDrop, summary, fail, notRun, nameOf,
  cardOrder, splitScan, afterReload } from './bench_core.js';

export const TESTS = {
  chat: { name: 'Juli · chat speed', model: 'brain', eta: 40, quick: true },
  readin: { name: 'Juli · long prompt read-in', model: 'brain', eta: 40, quick: true },
  longanswer: { name: 'Juli · long answer', model: 'brain', eta: 30 },   // 3.8 v040: Full only (a story of up to 512 tokens)
  apps: { name: 'Apps · each one opens, Trip Watch checks with Juli (test data)', model: 'brain', eta: 90, quick: true, idle: true },   // idle: between jobs, no model held
  // 3.8 v040: the Bigger brain (MODELS.brain4), after the apps: Juli's tests and the apps' checks first = one switch of models
  e4bchat: { name: 'Bigger brain · chat speed', model: 'brain4', eta: 45, quick: true, e4b: true },
  e4breadin: { name: 'Bigger brain · prompt read-in', model: 'brain4', eta: 25, quick: true, e4b: true },
  e4blong: { name: 'Bigger brain · long answer', model: 'brain4', eta: 45, e4b: true },
  picture: { name: 'Picture · 768 × 768, 4 steps', model: 'image', eta: 180 },
  clip: { name: 'Clip · 2 s, 832 × 480', model: 'video', eta: 300 },
  song: { name: 'Song · 30 s instrumental', model: 'music', eta: 120 },
};
const PIC = { media: 'image', kind: 't2i', width: 768, height: 768, steps: 4 };
const CLIP = { media: 'video', kind: 't2v', width: 832, height: 480, frames: 33 };

/** the queue runner for 'bench' jobs: one test per job, numbers only (the picture, clip and song are thrown away) */
let PROMPTS = null;   // ui/bench_prompts.json: fixed prompts, so one run compares with the next
const prompts = async () => PROMPTS || (PROMPTS = Object.fromEntries((await (await fetch('ui/bench_prompts.json')).json()).prompts.map((p) => [p.name, p])));
// 3.8 v040: the language-model tests, one shape for both models: the prompts each one asks (a chat speed first gives a short warm
// answer: Juli's is the heat reading) and how the model loaded (the answer's load: mode and faster replies; v040: + seconds, MB,
// split = { at, pageMB, workerMB, coep } when its first layers ran in a second process, or splitError)
const LLM = { chat: ['warm', 'chat'], readin: ['long'], longanswer: ['longanswer'], e4bchat: ['warm', 'chat'], e4breadin: ['mid'], e4blong: ['longanswer'] };
const loadOf = (ld) => { const s = ld.split; return { seconds: ld.seconds != null ? ld.seconds : null, residentMB: ld.residentMB != null ? ld.residentMB : null,
  split: s ? { at: s.at, pageMB: s.pageMB, workerMB: s.workerMB, coep: s.coep || null } : null, splitError: ld.splitError ? String(ld.splitError).slice(0, 120) : null }; };
async function llmTest(ctx, t, t0) {
  const P = await prompts(), ask = (p) => ctx.engine.chat(p.messages, { maxTokens: p.maxTokens, temperature: 0, signal: ctx.signal });
  const [wp, mp] = LLM[t].length > 1 ? LLM[t] : [null, LLM[t][0]];
  // the heat reading: a short first answer (its speed is compared with this phone's best one; it is not counted in the results)
  const w = wp ? await ask(P[wp]) : null;
  const r = await ask(P[mp]);
  const u = r.usage || {}, ld = r.load || {};
  return { test: t, canaryTokPerS: t === 'chat' && w ? w.tokPerS : null, warmTokPerS: w && t !== 'chat' ? w.tokPerS : undefined, tokPerS: r.tokPerS,
    tokens: r.tokens != null ? r.tokens : u.completionTokens, promptTokens: r.promptTokens != null ? r.promptTokens : u.promptTokens,
    mode: ld.mode || null, drafter: ld.drafter == null ? null : !!ld.drafter, load: loadOf(ld), prefillS: r.timings && r.timings.prefill,
    firstTokenS: r.timings && r.timings.firstToken, peakMB: r.peakMB, wallS: +((performance.now() - t0) / 1000).toFixed(1) };
}
/** 3.8 v040: why the Bigger brain does not run in this browser, from its user agent (on an iPhone, Safari's version = the iOS version) */
function uaWhy(ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '') {
  if (/Android/i.test(ua)) return 'not on Android yet';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1), v = /Version\/(\d+)/.exec(ua);
  if (ios && v && +v[1] < 27) return `needs iOS 27 (this phone has iOS ${v[1]})`;
  if (!ios && v && +v[1] < 27 && /Safari\//.test(ua) && !/Chrome\/|Chromium|Edg\//.test(ua)) return 'needs Safari 27';
  return 'not available in this browser';   // the app's E4B_WHY says more when it knows (e.g. no second process here)
}
export function benchRunner({ MODELS, RUN }) {
  return {
    model: (j) => { const T = TESTS[j.params.test], M = T && MODELS[T.model]; return (M || MODELS.brain).id; }, needsConsent: false,   // 3.8 v040: an unknown test fails in run()
    async run(ctx) {
      const t = ctx.params.test, t0 = performance.now(), sub = (params) => Object.assign({}, ctx, { params });
      if (t === 'chat' || t === 'readin') {
        return llmTest(ctx, t, t0);   // 3.8 v040: one shape for every language-model test (LLM, above)
      }
      if (LLM[t]) return llmTest(ctx, t, t0);   // 3.8 v040: Juli's long answer and the Bigger brain's tests
      if (!['picture', 'clip', 'song'].includes(t)) throw new Error('unknown benchmark test ' + t);   // never a render for a test this version does not have
      const seed = 1234567;
      const r = t === 'picture' ? await RUN.picture.run(sub({ prompt: 'a red bicycle leaning on a white wall by the sea, morning light, photo', width: PIC.width, height: PIC.height, steps: PIC.steps, seed }))
        : t === 'clip' ? await RUN.clip.run(sub({ prompt: 'gentle waves rolling onto a sandy beach at sunrise, slow camera pan', width: CLIP.width, height: CLIP.height, frames: CLIP.frames, seed }))
          : await RUN.song.run(sub({ tags: 'calm instrumental piano, soft, 90 bpm', lyrics: '[Instrumental]', seconds: 30, bpm: 90, lm: false, seed }));
      return { test: t, seconds: +(r.seconds || (performance.now() - t0) / 1000).toFixed(1), wallS: +((performance.now() - t0) / 1000).toFixed(1) };
    },
  };
}

/** 3.9: a silent WAV (0.2 s) for the Start tap: playing it inside the tap lets the Music check's test tones play later without one */
function silentUrl() {
  const n = 1600, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
}
const FX_KEY = 'pf.app.benchFx';   // 3.9: test data a run made and has not removed yet ([{k, id}]): a later page removes it
const DIAG_KEY = 'p0pc0rn:diag';   // 3.9: the app's diagnostics (app.js diag(): its last 200 steps, kept over a page's end), read for the second processes
const LIVE_MS = 30 * 60e3;   // 3.9: a run whose step began longer ago than this was left (the app was closed): a reload does not carry it on
const SAFE = typeof location !== 'undefined' && /[?&]safe=1(?:&|$)/.test(location.search || '');   // the app opened in safe mode: a stopped run stays stopped
const sessionsOf = (fx) => (Array.isArray(fx) ? fx : []).filter((x) => x && x.k === 'session').map((x) => x.id);   // 3.9: the run's test conversations still to remove
/** 3.9: a run that goes on after the page ended: the app's safe open keeps the queue paused until the person chooses on its card (Try
 *  again / Discard), and meanwhile the queue runs only the jobs added from now on (the run's own; what the person's apps ask, as in any
 *  run), never one that waited at the page's end (the person's wait for that choice) -> off(); it lets go by itself once the queue resumes */
export function heldLane(Q) {
  const t0 = Date.now(), own = (j) => (j.createdAt || 0) >= t0 && (Q.rootOf(j).createdAt || 0) >= t0;
  Q.next = function next() { if (!this.paused) { delete this.next; return this.next(); } return this.runOrder().find(own) || null; };
  return () => { if (Object.prototype.hasOwnProperty.call(Q, 'next')) delete Q.next; };
}

export function createBench(api) {
  const $ = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const B = { running: null, results: api.ls.get('pf.app.bench', null), shared: {}, F: null };
  const featuresMod = async () => B.F || (B.F = await import('./bench_features.js'));   // 3.9: loaded when a Full run starts (Quick never needs it)
  const fmt = (s) => (s >= 90 ? `about ${Math.round(s / 60)} min` : `about ${Math.max(10, Math.round(s / 10) * 10)} s`);
  const nameOfStep = (k) => (isFeature(k) ? (FEATURES[featureOf(k)] || { name: k }).name : TESTS[k].name);
  const etaOfStep = (k) => (isFeature(k) ? (FEATURES[featureOf(k)] || { eta: 5 }).eta : TESTS[k].eta);
  /** 3.9: how this page opened (app.js: the app's own planned fresh page, or where the page before ended), null in a build without it */
  function pageOpen() { try { return api.pageOpen ? api.pageOpen() : null; } catch (e) { return null; } }
  /** 3.9: the diagnostics' new second-process events since the run's last look, with the step they came in (res.split) */
  function noteSplit(res, k) { try { res.split = splitScan(api.ls.get(DIAG_KEY, []) || [], res.split || {}, k ? nameOfStep(k) : ''); } catch (e) { /* the card goes without them */ } }
  /** 3.9: where the page ended (the app's own record: the job step it was in, or the planned fresh page it ended in) and a model then in
   *  one process (its second process had ended), for the line of the step it ended in */
  function endedAt(po, res) {
    const off = (res.split && res.split.off) || {}, w = [];
    if (po && po.diedAtFresh) w.push(`it ended as it reloaded to switch models (${String(po.diedAtFresh).slice(0, 30)})`);
    else if (po && po.died) w.push(`at “${String(po.died).slice(0, 48)}”`);
    if (off.brain) w.push('Juli in one process (her second process had ended)');
    else if (off.brain4) w.push('the Bigger brain’s second process had ended');
    return w.length ? '; ' + w.join('; ') : '';
  }
  // the page reloaded during a run: a PLANNED fresh page (how the app switches models on a phone) carries on with the same run;
  // any other reload (the phone ran short of memory) is said on the card, at the test it happened in, and the run stops there (the
  // app's safe open asks the person before anything runs again). 3.9: in a Full run every check after it gets its line (not run), and
  // once the test data is removed (below) the person's data is still compared with the start of the run.
  // 3.9 (Josh's phone, Oct-26 21:47: a change of an app switched models twice and the second planned page was taken for a crash):
  // PLANNED = this page was opened by the app's own fresh page (its marker, stamped as the old page left: app.js PLANNED_IN), whatever
  // job it was for; the step carries on with its saved state. Anything else (no marker, or one the old page never stamped: it ended as it
  // reloaded) is the phone ending the page: its step fails with where it ended, and a Full run then GOES ON with the next step (one run
  // gives every feature a pass or fail) unless that was the run's second such reload or the same step's again (bench_core.js afterReload),
  // the run was left long ago, or the app opened in safe mode: then it stops there as before. The app's safe open stays as it is: the job
  // the page ended in is the run's own (it goes), and while the person's jobs wait for their choice on its card the queue runs only the
  // run's new ones (heldLane)
  const cut = api.ls.get('pf.app.benchRun', null), po = pageOpen(), had = !!(cut && cut.res && cut.tests);
  const live = had && !(cut.at && Date.now() - cut.at > LIVE_MS), carry = live && (po ? !!po.planned : !!(cut.job && api.planned && api.planned(cut.job)));
  let after = null, onward = null;
  if (carry) setTimeout(() => run(cut.tests, cut.full, cut.next != null ? Object.assign({}, cut, { i: cut.next, job: null, fstate: null, held: true }) : cut), 0);   // (next: a run about to go on after the page ended)
  else if (had) {
    const res = cut.res, k = cut.tests[cut.i], full = !!res.features;
    if (k) noteSplit(res, k);   // 3.9: what the page that ended said about the second processes
    const plan = full && k && live && !SAFE ? afterReload(res.reloads || [], cut.i) : { stop: true, why: '' };
    const why = `the page reloaded during this ${k && isFeature(k) ? 'check' : 'test'} (the phone may have run short of memory${endedAt(po, res)})`
      + (full && k ? (plan.stop ? (plan.why ? `; the run stopped here: ${plan.why}` : '') : '; the run went on') : '');
    if (k && isFeature(k)) { res.features = res.features || {}; res.features[featureOf(k)] = fail(why); }   // 3.9
    else if (k) res.tests[k] = { error: why.slice(0, 200) };
    if (k && full) res.reloads = (res.reloads || []).concat({ i: cut.i, k, t: Date.now() });
    if (!plan.stop) {   // 3.9: still at this step until the next begins (a page that ends again first counts here: the same step twice)
      const next = k === 'f:final' ? cut.i : cut.i + 1;   // the data check runs again
      api.ls.set('pf.app.benchRun', { res, tests: cut.tests, i: cut.i, full: cut.full, at: Date.now(), next });
      onward = { res, tests: cut.tests, i: next, full: cut.full, k, held: true };
    } else {
      if (k && full) {
        for (const x of cut.tests.slice(cut.i + 1)) if (isFeature(x) && featureOf(x) !== 'final') res.features[featureOf(x)] = notRun(`the run stopped at “${nameOfStep(k)}”: the page reloaded`);
        after = { res, snap0: res.snap0 || null, k };
      }
      delete res.snap0; B.results = res; api.ls.set('pf.app.bench', res); api.ls.set('pf.app.benchRun', null);
    }
  }
  if (!carry) {   // 3.9: test data a stopped run left (a test chat, a test app, the home screen's keys): removed now; then a stopped Full
    // run's last lines, or the run going on (after the app's own start: the queue's recovery, its safe open)
    const left = api.ls.get(FX_KEY, null);
    if ((Array.isArray(left) && left.length) || after || onward) setTimeout(async () => {
      try {
        // 3.9: first the run's own jobs the queue still holds (the one the page ended in: the queue put it back), then its test data
        const F = await featuresMod(), fx = api.ls.get(FX_KEY, null) || [], r = (after || onward || {}).res, k = (after || onward || {}).k;
        const gone = await F.dropTestJobs(api, null, sessionsOf(fx));
        api.ls.set(FX_KEY, await F.sweep(api, fx));
        if (r) {
          // what the app's own safe start turned off on this phone after the page ended (said where it happened)
          const now = Date.now(), recent = (x) => !!(x && now - (+x.t || 0) < 5 * 60e3), said = [];
          if (recent(api.ls.get('pf.app.brain4Off', null))) said.push('the app turned the Bigger brain off on this phone (Settings › Juli turns it back on)');
          if (recent(api.ls.get('pf.app.fasterOff', null))) said.push('the app turned faster replies off on this phone');
          if (said.length && isFeature(k) && r.features[featureOf(k)]) r.features[featureOf(k)].why += '; ' + said.join('; ');
          else if (said.length && r.tests[k]) r.tests[k].error += '; ' + said.join('; ');
          r.cleaned = (r.cleaned || []).concat(gone);   // said on the card by the data check
        }
        if (after) { r.features.final = await finalStep(r, () => null, after.snap0); B.results = r; api.ls.set('pf.app.bench', r); render(); }
        else if (onward) run(onward.tests, onward.full, onward);
      } catch (e) { /* the next start tries again */ }
    }, 6000);
  }

  // 3.8 v040: why the Bigger brain's tests can't run on this phone now (null = they can): where it runs (the app's E4B_HERE: iOS 27's
  // second process, or a desktop browser), then whether it is downloaded (its drafter is not required: the card says when it is off)
  const e4bWhyNot = () => {
    if (!api.MODELS.brain4) return 'not in this version';
    let here = false; try { here = !!(api.e4bHere && api.e4bHere()); } catch (e) { here = false; }
    if (!here) { let w = null; try { w = api.e4bWhy ? api.e4bWhy() : null; } catch (e) { w = null; } return w || uaWhy(); }
    return api.done('brain4') ? null : 'not downloaded (Settings › Models)';
  };
  /** 3.9: what this phone has, for the feature checks (bench_core.js featurePlan) */
  function featureEnv() {
    const APPS = api.apps && api.apps(), A = APPS && APPS.state, AG = api.AG ? api.AG() : null, CH = api.CH ? api.CH() : null;
    let big = false; try { big = !!(AG && AG.bigModel && AG.bigModel()) && !e4bWhyNot(); } catch (e) { big = false; }
    const started = !!(A && A.db && A.skels && A.skels.size);   // the Apps tab may still be starting: its checks wait for it
    return { shell: !!(globalThis.SHELL && SHELL.ready), apps: !!A, skills: !!A && (!started || !!A.skills), chat: !!(CH && typeof CH.openThread === 'function'),
      music: !!(api.MUSIC && api.MUSIC()), memory: !!(api.MEM && api.MEM() && api.MEM().hb), brain: !!api.done('brain'), brain4: big,
      games: !!A && (!started || !!A.skels.get('connect-four')), edit: !!(APPS && typeof APPS.change === 'function'), split: !!(api.splitHere && api.splitHere()),
      icon: !!(globalThis.P0APPICON && typeof globalThis.P0APPICON.put === 'function') };   // 3.9 part 12: Make an icon
  }
  const MEDIA = { picture: 'media.picture', clip: 'media.clip', song: 'media.song' };   // 3.9: the card's line for each (bench_core.js DERIVED)
  function plan(full) {
    const out = [], skipped = [], why = {}, mskip = [];
    for (const [k, T] of Object.entries(TESTS)) {
      if (!full && !T.quick) continue;
      if (T.e4b) {   // 3.8 v040: the Bigger brain's tests, or ONE line saying why they were not run
        const w = e4bWhyNot();
        if (w) { if (!why.e4b) { why.e4b = w; skipped.push(`Bigger brain: ${w}`); } continue; }
      } else if (!api.done(T.model)) { skipped.push(`${T.name}: ${api.MODELS[T.model].name} is not downloaded`); if (MEDIA[k]) mskip.push({ id: MEDIA[k], why: `${api.MODELS[T.model].name} is not downloaded` }); continue; }
      if (k === 'clip' && !api.ltxOk()) { skipped.push(`${T.name}: make one clip first (it shows the video licence)`); mskip.push({ id: MEDIA.clip, why: 'make one clip first (it shows the video licence)' }); continue; }
      out.push(k);
    }
    if (!full) return { tests: out, skipped, why };
    // 3.9: Full = the speed tests above + every feature check this phone can run, in their places (bench_core.js runOrder); the ones it
    // cannot run are on the card too, as not run with their reason (so every feature has a line)
    const env = featureEnv(); env.picture = out.includes('picture');
    const fp = featurePlan(env);
    return { tests: runOrder(out, fp.groups), skipped, why, env, fskip: fp.skipped, notHere: fp.skipped.concat(mskip) };
  }
  function start(full) {
    if (B.running) return api.toast('The benchmark is already running');
    if (!api.consented()) return api.toast('Agree to the p0pc0rn terms first (the short lesson)');
    const { tests, skipped, why, env, fskip, notHere } = plan(full);
    if (!tests.length) return api.toast(full ? 'Download a model first (Settings › Models)' : 'Download Juli first (Settings › Models)');
    const total = full ? etaOf(tests, Object.fromEntries(Object.entries(TESTS).map(([k, T]) => [k, T.eta]))) : tests.reduce((s, k) => s + TESTS[k].eta, 0);
    const { sheet, close } = api.sheet('bench-sheet', full ? 'Full benchmark' : 'Quick benchmark');
    sheet.append(mk('p', 'footnote dim', `About ${Math.max(1, Math.round(total / 60))} min. Keep p0pc0rn open and the phone plugged in; the screen stays on. Results stay on this phone.`));
    const ul = mk('ul', 'perm-list');
    let feats = 0;
    for (const k of tests) { if (isFeature(k)) { feats++; continue; } const li = mk('li'); li.append(mk('span', 'callout', TESTS[k].name), mk('span', 'footnote dim', fmt(TESTS[k].eta))); ul.append(li); }
    if (feats) { const li = mk('li'); li.append(mk('span', 'callout', `Every feature: ${feats} pass / fail checks with test data, removed after`), mk('span', 'footnote dim', fmt(tests.filter(isFeature).reduce((s, k) => s + etaOfStep(k), 0)))); ul.append(li); }   // 3.9
    for (const s of skipped) ul.append(mk('li', 'footnote dim', 'Skipped · ' + s));
    for (const s of fskip || []) ul.append(mk('li', 'footnote dim', `Not checked · ${nameOf(s.id)}: ${s.why}`));   // 3.9
    sheet.append(ul);
    const go = mk('button', 'btn cta', 'Start'); go.type = 'button'; go.id = 'bench-go';
    go.onclick = () => {
      api.wake.on();   // the wake lock is asked for inside the tap (iOS)
      if (full) { try { const a = new Audio(); a.muted = true; a.src = silentUrl(); a.play().catch(() => {}); B.shared.audio = a; } catch (e) { /* the Music check says so */ } }   // 3.9: sound needs a tap on a phone
      close(); run(tests, full, null, why, env, notHere);
    };
    const no = mk('button', 'btn', 'Not now'); no.type = 'button'; no.onclick = close;
    sheet.append(go, no);
  }
  async function run(tests, full, from, why, env0, notHere) {   // from = a run a planned fresh page interrupted: carry on with its job, then the rest
    const Q = api.Q(), res = from ? from.res : { when: new Date().toISOString(), full, app: api.version, device: api.device(), tests: {}, skip: why || {} };   // 3.8 v040: + why a group was not run
    if (!from) {
      const lastEnd = Math.max(0, ...Q.list().filter((j) => j.kind !== 'bench' && j.endedAt).map((j) => j.endedAt));   // a job that just ended leaves the phone warm
      res.workedAgoS = lastEnd ? Math.round((Date.now() - lastEnd) / 1000) : null;
      res.split = splitScan(api.ls.get(DIAG_KEY, []) || [], {}, '');   // 3.9: the second processes' events count from here
    }
    const held = from && from.held && Q.paused ? heldLane(Q) : null;   // 3.9: going on after the page ended, beside the app's safe open
    const hasFeatures = tests.some(isFeature);
    const MEM = api.MEM ? api.MEM() : null;
    if (hasFeatures) {   // 3.9: the person's routines wait during the run (the page's own start brings them back after a reload)
      try { if (MEM && MEM.hb) MEM.hb.stop(); } catch (e) { /* */ }
      res.features = res.features || {}; res.env = res.env || env0 || featureEnv();
      if (!from) for (const s of notHere || []) res.features[s.id] = notRun(s.why);   // the checks this phone cannot run: on the card with why
      if (!res.snap0 && (!from || from.i === 0)) { try { const F = await featuresMod(); res.snap0 = await F.snapshot(api); } catch (e) { res.snap0 = null; } }   // before anything ran
    }
    B.running = { tests, i: from ? from.i : 0 }; render();
    for (let i = from ? from.i : 0; i < tests.length; i++) {
      const k = tests[i], here = !!(from && i === from.i);
      B.running.i = i; B.running.at = Date.now(); render();
      // 3.9: the step a planned fresh page carried over keeps its job and saved state on THIS page's record too: the next planned page
      // carries it on again (a change of an app can switch models twice: Josh's phone, Oct-26)
      api.ls.set('pf.app.benchRun', Object.assign({ res, tests, i, full, at: Date.now() }, here && (from.job || from.fstate) ? { job: from.job || null, fstate: from.fstate || null } : {}));
      if (isFeature(k)) {   // 3.9: a feature check (bench_features.js), on its own: its own time, its own pass or fail
        const id = featureOf(k), carried = here ? from.fstate || null : null;
        res.features[id] = await feature(id, res, carried, (st) => api.ls.set('pf.app.benchRun', { res, tests, i, full, at: Date.now(), job: st && st.job, fstate: st }));
        noteSplit(res, k);
        continue;
      }
      try {
        const off = TESTS[k].e4b ? (res.e4bFailed ? 'the Bigger brain failed in the test before' : e4bWhyNot()) : null;   // 3.9: + the app turned it off since (the page ended)
        if (off) { res.tests[k] = { error: 'not run: ' + off }; continue; }   // 3.8 v040: once is enough (a big load that fails can end the page)
        if (TESTS[k].idle) { res.tests[k] = await appsCheck(Q); continue; }   // the Apps check: between jobs, when no model is in memory
        let id = here ? from.job : null;   // the job a fresh page carried over
        if (!id) id = (await Q.add('bench', { test: k }, { title: TESTS[k].name })).id;
        api.ls.set('pf.app.benchRun', { res, tests, i, full, at: Date.now(), job: id });
        res.tests[k] = await wait(Q, id);
        if (k === 'picture') api.learn(PIC, res.tests[k].seconds);
        if (k === 'clip') api.learn(CLIP, res.tests[k].seconds);
      } catch (e) { res.tests[k] = { error: String((e && e.message) || e).slice(0, 160) }; if (TESTS[k].e4b) res.e4bFailed = true; if (e && e.code === 'CANCELLED') break; }
      finally {
        noteSplit(res, k);
        if (LLM[k] && res.tests[k] && !res.tests[k].error && res.split && res.split.off[TESTS[k].model]) res.tests[k].oneProcess = true;   // 3.9: measured after its second process ended
      }
    }
    const c = res.tests.chat || {}, can = c.canaryTokPerS, key = `pf.app.benchCanary.${c.mode || 'resident'}.${c.drafter ? 'faster' : 'plain'}`, best = api.ls.get(key, null);   // the best in the same mode
    res.heat = { canary: can || null, best: best || null, newBest: !!(can && best && can > best), warm: (res.workedAgoS != null && res.workedAgoS < 180) || !!(can && best && can < 0.9 * best) };
    if (can && (!best || can > best)) api.ls.set(key, can);
    if (hasFeatures) { delete res.snap0; try { if (MEM && MEM.hb) MEM.hb.start(); } catch (e) { /* */ } try { if (globalThis.SHELL) SHELL.open('settings'); } catch (e) { /* */ } }
    if (held) held();   // 3.9: the queue is the person's again (their jobs wait for their choice on the safe open's card)
    if (res.split) delete res.split.cursor;
    B.running = null; B.results = res; api.ls.set('pf.app.bench', res); api.ls.set('pf.app.benchRun', null); render();
    api.toast('Benchmark finished');
  }
  /** 3.9: one feature check -> its result with its time; carried = its saved state after a planned fresh page; save(state) keeps it */
  async function feature(id, res, carried, save) {
    const t0 = performance.now(), secs = () => +((performance.now() - t0) / 1000).toFixed(1);
    try {
      if (id === 'final') return await finalStep(res, secs);
      const F = await featuresMod(), fn = F.CHECKS[id];
      if (!fn) return notRun('not in this build', { s: 0 });
      const big = (FEATURES[id] && FEATURES[id].needs.includes('brain4')) ? e4bWhyNot() : null;   // 3.9: the app turned it off since (the page ended with it loaded)
      if (big) return notRun('the Bigger brain: ' + big, { s: 0 });
      for (let n = 0; n < 150 && (api.Q().active || api.Q().pumping) && !carried; n++) await new Promise((r) => setTimeout(r, 100));   // the job before leaves first
      const ctx = { api, env: res.env || {}, shared: B.shared, state: carried, save: (st) => save(st),
        fx: { add: (x) => api.ls.set(FX_KEY, fxAdd(api.ls.get(FX_KEY, []), x)), drop: (x) => api.ls.set(FX_KEY, fxDrop(api.ls.get(FX_KEY, []), x)) } };
      const r = await fn(ctx);
      return Object.assign({}, r || fail('no result'), { s: secs() });
    } catch (e) { return fail(String((e && e.message) || e).slice(0, 160), { s: secs() }); }
  }
  /** 3.9: the last step: the lines that come from the speed tests' own results, what a check left behind, the person's data before / after */
  async function finalStep(res, secs, snap0 = res.snap0) {   // snap0: the start of the run (a stopped run passes its own)
    noteSplit(res, 'f:final'); Object.assign(res.features, derive(res.tests, res.env || {}, res.split || null));   // 3.9: + the second processes over the run
    const F = await featuresMod(), fx = api.ls.get(FX_KEY, []) || [];
    // 3.9: the run's own jobs the queue still holds (the one a page ended in, which the queue put back; one a check gave up on) stop and
    // go before the data check, never one of the person's; the card says so
    const gone = (res.cleaned || []).concat(await F.dropTestJobs(api, null, sessionsOf(fx))); delete res.cleaned;
    const left = await F.sweep(api, fx); api.ls.set(FX_KEY, left);
    const jobs = F.testJobs(api), extra = (left.length ? `; ${left.length} test items could not be removed` : '') + (jobs.length ? `; test jobs left in the queue: ${jobs.join(', ')}` : '');
    const tidy = gone.length ? ` (removed ${gone.length === 1 ? 'a test job' : gone.length + ' test jobs'} the queue still held: ${[...new Set(gone)].join(', ')})` : '';
    if (snap0) {
      const now = await F.snapshot(api), diff = snapDiff(snap0, now);
      res.features['data.same'] = diff.length ? fail('changed: ' + diff.join(', ') + extra + tidy)
        : extra ? fail(extra.slice(2) + tidy) : { ok: true, why: 'nothing the checks made is left' + tidy };
    } else res.features['data.same'] = notRun('no snapshot at the start of the run');
    const s = summary(Object.fromEntries(Object.entries(res.features).filter(([k]) => k !== 'final')));
    return { ok: s.fail === 0, why: `${s.pass} pass, ${s.fail} fail`, s: secs() };
  }
  async function appsCheck(Q) {
    const t0 = performance.now();
    for (let i = 0; i < 150 && (Q.active || Q.pumping); i++) await new Promise((r) => setTimeout(r, 100));   // the last job's model leaves first
    const A = api.apps && api.apps(); if (!A || !A.selfTest) throw new Error('the Apps tab is not ready');
    return Object.assign({ test: 'apps' }, await A.selfTest(), { wallS: +((performance.now() - t0) / 1000).toFixed(1) });
  }
  function wait(Q, id) {
    const now = Q.get ? Q.get(id) : null;   // a job carried over a fresh page may have finished already
    if (now && now.status === 'done') { Q.remove(id).catch(() => {}); return Promise.resolve(now.result || {}); }
    if (now && (now.status === 'failed' || now.status === 'cancelled')) { Q.remove(id).catch(() => {}); return Promise.reject(Object.assign(new Error((now.error && now.error.message) || now.status), { code: now.status === 'cancelled' ? 'CANCELLED' : now.error && now.error.code })); }
    if (Q.get && !now) return Promise.reject(new Error('the test job is gone'));
    return new Promise((res, rej) => {
      const off = [], end = (fn, v) => { for (const o of off) o(); Q.remove(id).catch(() => {}); fn(v); };
      off.push(Q.on('done', (j) => { if (j.id === id) end(res, j.result || {}); }));
      off.push(Q.on('failed', (j) => { if (j.id === id) end(rej, Object.assign(new Error((j.error && j.error.message) || 'failed'), { code: j.error && j.error.code })); }));
      off.push(Q.on('cancelled', (j) => { if (j.id === id) end(rej, Object.assign(new Error('stopped'), { code: 'CANCELLED' })); }));
      for (const n of ['blocked', 'needs-consent', 'needs-download']) off.push(Q.on(n, (j) => { if (j.id === id) { Q.cancel(id).catch(() => {}); end(rej, new Error((j.error && j.error.message) || 'blocked')); } }));
      if (Q.pump) Q.pump();
    });
  }
  function text(r) {
    const L = [`p0pc0rn benchmark · ${r.full ? 'Full' : 'Quick'} · ${r.app}`, r.device, new Date(r.when).toLocaleString()];
    if (r.heat) L.push(r.heat.warm ? `Heat: phone warm${r.workedAgoS != null && r.workedAgoS < 180 ? ' (it was working ' + Math.max(1, Math.round(r.workedAgoS / 60)) + ' min ago)' : ''}${r.heat.canary && r.heat.best ? ` · first answer ${r.heat.canary} tokens/s, this phone's best ${r.heat.best}` : ''}: numbers may read low`
      : `Heat: cool${r.heat.canary ? ` · first answer ${r.heat.canary} tokens/s` + (r.heat.newBest ? ` (this phone's best so far; before ${r.heat.best})` : r.heat.best ? `, this phone's best ${r.heat.best}` : ' (the first run on this phone sets its baseline)') : ''}`);
    // 3.8 v040: the Bigger brain's "not run" line sits where its tests would be; each model's load line follows its chat speed
    const order = Object.keys(TESTS), e4bAt = order.findIndex((x) => TESTS[x].e4b);
    let e4bSaid = !(r.skip && r.skip.e4b);
    const sayE4b = () => { if (!e4bSaid) { e4bSaid = true; L.push(`Bigger brain: ${r.skip.e4b}`); } };
    const dr = (k, v) => (TESTS[k] && TESTS[k].model === 'brain4'
      ? (v.mode === 'lean' ? ', lighter mode: slower' : v.drafter === false ? ', its drafter off' : v.drafter ? ', its drafter on' : '')
      : (v.mode === 'lean' ? ', Juli in lighter mode: slower, Settings › Juli › Full for the real speed' : v.drafter === false ? ', faster replies off' : v.drafter ? ', faster replies on' : ''));
    const loaded = (who, l) => {   // split = the model's first layers in a second process (iOS 27), with each side's memory on the graphics chip
      if (!l || (l.seconds == null && l.residentMB == null && !l.split && !l.splitError)) return;
      const t = l.seconds != null ? ` in ${l.seconds} s` : '', s = l.split;
      L.push(s ? `${who} · loaded${t}: split, layers 0-${s.at - 1} in a second process (page ${s.pageMB} MB + second process ${s.workerMB} MB${s.coep ? ', COEP ' + s.coep : ''})`
        : `${who} · loaded${t}: one process${l.residentMB != null ? ` (${l.residentMB} MB)` : ''}${l.splitError ? ` · no split: ${l.splitError}` : ''}`);
    };
    const one = (v) => (v.oneProcess ? ' (one process: the second process ended)' : '');   // 3.9: measured after its second process ended
    for (const [k, v] of Object.entries(r.tests)) {
      if (order.indexOf(k) > e4bAt) sayE4b();
      const n = TESTS[k] ? TESTS[k].name : k;
      if (v.error) L.push(`${n}: did not finish (${v.error})`);
      else if (k === 'chat' || k === 'e4bchat') { L.push(`${n}: ${v.tokPerS} tokens/s (${v.tokens} tokens${dr(k, v)})${one(v)}`); loaded(k === 'chat' ? 'Juli' : 'Bigger brain', v.load); }
      else if (k === 'longanswer' || k === 'e4blong') L.push(`${n}: ${v.tokPerS} tokens/s (${v.tokens} tokens${dr(k, v)})${one(v)}`);
      else if (k === 'e4breadin') L.push(`${n}: ${v.promptTokens} tokens in ${v.prefillS} s (${Math.round(v.promptTokens / v.prefillS)} tokens/s)${one(v)}`);
      else if (k === 'readin') L.push(`${n}: ${v.promptTokens} tokens in ${v.prefillS} s (${Math.round(v.promptTokens / v.prefillS)} tokens/s)${one(v)}`);
      else if (k === 'apps') {
        const tr = v.trip;
        L.push(`${n}: ${v.started}/${v.of} apps open${v.problems && v.problems.length ? ' (' + v.problems.join('; ') + ')' : ''}` + (!tr ? '' : tr.ok
          ? ` · Trip Watch's check (test data): Juli read a test note (${tr.note || 'nothing'}), the test trip checked (${tr.flags} to look at)${tr.brief ? ", Juli's line kept" : tr.leftOut ? ", Juli's line left out (a number not in the forecast)" : ''}${tr.asks.length ? `, Juli ${tr.asks.join(' + ')} s` : ''}, ${tr.seconds} s in all`
          : ` · Trip Watch's check did not finish: ${tr.said}`));
      }
      else L.push(`${n}: ${v.seconds} s`);
    }
    sayE4b();
    if (r.features && Object.keys(r.features).length) {   // 3.9: every feature's pass or fail (the order they ran in; fails first): one line a check
      const f = Object.assign({}, r.features); delete f.final;
      L.push('', ...featureLines(f, cardOrder()));
    }
    return L.join('\n');
  }
  function render() {
    const box = $('s-bench-out'); if (!box) return;
    $('s-bench-quick').disabled = $('s-bench-full').disabled = !!B.running;
    box.replaceChildren();
    if (B.running) { const k = B.running.tests[B.running.i]; box.append(mk('p', 'callout', `Running ${B.running.i + 1} of ${B.running.tests.length}: ${nameOfStep(k)} (${fmt(etaOfStep(k))})`)); box.hidden = false; return; }
    if (!B.results) { box.hidden = true; return; }
    box.hidden = false;
    box.append(mk('pre', 'mono footnote bench-text', text(B.results)));
    const c = mk('button', 'btn sm', 'Copy'); c.type = 'button'; c.id = 's-bench-copy';
    c.onclick = async () => { try { await navigator.clipboard.writeText(text(B.results)); api.toast('Copied'); } catch (e) { api.toast('Couldn’t copy: select the text instead'); } };
    box.append(c);
  }
  $('s-bench-quick').onclick = () => start(false);
  $('s-bench-full').onclick = () => start(true);
  const mc = $('s-bench-music');   // 3.9: Music's lock-screen check (ui/music.js), the part of Music a phone must show with its screen locked
  if (mc) mc.onclick = () => { const M = api.MUSIC ? api.MUSIC() : null; if (!M || !M.check) return api.toast('Music is not in this version'); if (B.running) return api.toast('The benchmark is running'); try { if (globalThis.SHELL) SHELL.open('music'); } catch (e) { /* */ } M.check(); };
  render();
  return { render, text, plan, get state() { return B; } };
}
