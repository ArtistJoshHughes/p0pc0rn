// bench.js - Settings › Benchmark (3.8): how fast THIS phone runs p0pc0rn. Quick (~3 min, ~4 with the Bigger brain): Juli's chat speed, a long prompt read-in and
// the apps (each one starts; Trip Watch checks a test trip with Juli). Full (~13-16 min): + one picture, one short clip and one song, for
// the models that are downloaded. The jobs go through the app's own
// queue (one model at a time, the screen stays on), each with its time shown first. The results card stays on the phone: Copy puts the
// text on the clipboard to share it; nothing is sent anywhere. The picture and clip times also teach Create's time estimates.
// 3.8 v040: + the Bigger brain (NVIDIA Bolt E4B, where it runs: iOS 27's second process, or a desktop browser) in Quick: its chat
// speed and a ~1,100-token read-in (it reads up to 2,048 tokens); Full: + a long answer from each model. Each model's load line says
// how it loaded (split = its first layers in a second process, with each side's memory) and one line says why the Bigger brain was
// not run on this phone.
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

export function createBench(api) {
  const $ = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const B = { running: null, results: api.ls.get('pf.app.bench', null) };
  // the page reloaded during a run: a PLANNED fresh page (how the app switches models on a phone) carries on with the same run;
  // any other reload (the phone ran short of memory) is said on the card, at the test it happened in
  const cut = api.ls.get('pf.app.benchRun', null);
  if (cut && cut.res && cut.tests) {
    if (cut.job && api.planned && api.planned(cut.job)) setTimeout(() => run(cut.tests, cut.full, cut), 0);
    else { const k = cut.tests[cut.i]; if (k) cut.res.tests[k] = { error: 'the page reloaded during this test (the phone may have run short of memory)' }; B.results = cut.res; api.ls.set('pf.app.bench', cut.res); api.ls.set('pf.app.benchRun', null); }
  }
  const fmt = (s) => (s >= 90 ? `about ${Math.round(s / 60)} min` : `about ${Math.max(10, Math.round(s / 10) * 10)} s`);

  // 3.8 v040: why the Bigger brain's tests can't run on this phone now (null = they can): where it runs (the app's E4B_HERE: iOS 27's
  // second process, or a desktop browser), then whether it is downloaded (its drafter is not required: the card says when it is off)
  const e4bWhyNot = () => {
    if (!api.MODELS.brain4) return 'not in this version';
    let here = false; try { here = !!(api.e4bHere && api.e4bHere()); } catch (e) { here = false; }
    if (!here) { let w = null; try { w = api.e4bWhy ? api.e4bWhy() : null; } catch (e) { w = null; } return w || uaWhy(); }
    return api.done('brain4') ? null : 'not downloaded (Settings › Models)';
  };
  function plan(full) {
    const out = [], skipped = [], why = {};
    for (const [k, T] of Object.entries(TESTS)) {
      if (!full && !T.quick) continue;
      if (T.e4b) {   // 3.8 v040: the Bigger brain's tests, or ONE line saying why they were not run
        const w = e4bWhyNot();
        if (w) { if (!why.e4b) { why.e4b = w; skipped.push(`Bigger brain: ${w}`); } continue; }
      } else if (!api.done(T.model)) { skipped.push(`${T.name}: ${api.MODELS[T.model].name} is not downloaded`); continue; }
      if (k === 'clip' && !api.ltxOk()) { skipped.push(`${T.name}: make one clip first (it shows the video licence)`); continue; }
      out.push(k);
    }
    return { tests: out, skipped, why };
  }
  function start(full) {
    if (B.running) return api.toast('The benchmark is already running');
    if (!api.consented()) return api.toast('Agree to the p0pc0rn terms first (the short lesson)');
    const { tests, skipped, why } = plan(full);
    if (!tests.length) return api.toast(full ? 'Download a model first (Settings › Models)' : 'Download Juli first (Settings › Models)');
    const total = tests.reduce((s, k) => s + TESTS[k].eta, 0);
    const { sheet, close } = api.sheet('bench-sheet', full ? 'Full benchmark' : 'Quick benchmark');
    sheet.append(mk('p', 'footnote dim', `About ${Math.max(1, Math.round(total / 60))} min. Keep p0pc0rn open and the phone plugged in; the screen stays on. Results stay on this phone.`));
    const ul = mk('ul', 'perm-list');
    for (const k of tests) { const li = mk('li'); li.append(mk('span', 'callout', TESTS[k].name), mk('span', 'footnote dim', fmt(TESTS[k].eta))); ul.append(li); }
    for (const s of skipped) ul.append(mk('li', 'footnote dim', 'Skipped · ' + s));
    sheet.append(ul);
    const go = mk('button', 'btn cta', 'Start'); go.type = 'button'; go.id = 'bench-go';
    go.onclick = () => { api.wake.on(); close(); run(tests, full, null, why); };   // the wake lock is asked for inside the tap (iOS)
    const no = mk('button', 'btn', 'Not now'); no.type = 'button'; no.onclick = close;
    sheet.append(go, no);
  }
  async function run(tests, full, from, why) {   // from = a run a planned fresh page interrupted: carry on with its job, then the rest
    const Q = api.Q(), res = from ? from.res : { when: new Date().toISOString(), full, app: api.version, device: api.device(), tests: {}, skip: why || {} };   // 3.8 v040: + why a group was not run
    if (!from) {
      const lastEnd = Math.max(0, ...Q.list().filter((j) => j.kind !== 'bench' && j.endedAt).map((j) => j.endedAt));   // a job that just ended leaves the phone warm
      res.workedAgoS = lastEnd ? Math.round((Date.now() - lastEnd) / 1000) : null;
    }
    B.running = { tests, i: from ? from.i : 0 }; render();
    for (let i = from ? from.i : 0; i < tests.length; i++) {
      const k = tests[i];
      B.running.i = i; B.running.at = Date.now(); render();
      api.ls.set('pf.app.benchRun', { res, tests, i, full });
      try {
        if (TESTS[k].e4b && res.e4bFailed) { res.tests[k] = { error: 'not run: the Bigger brain failed in the test before' }; continue; }   // 3.8 v040: once is enough (a big load that fails can end the page)
        if (TESTS[k].idle) { res.tests[k] = await appsCheck(Q); continue; }   // the Apps check: between jobs, when no model is in memory
        let id = from && i === from.i ? from.job : null;   // the job a fresh page carried over
        if (!id) id = (await Q.add('bench', { test: k }, { title: TESTS[k].name })).id;
        api.ls.set('pf.app.benchRun', { res, tests, i, full, job: id });
        res.tests[k] = await wait(Q, id);
        if (k === 'picture') api.learn(PIC, res.tests[k].seconds);
        if (k === 'clip') api.learn(CLIP, res.tests[k].seconds);
      } catch (e) { res.tests[k] = { error: String((e && e.message) || e).slice(0, 160) }; if (TESTS[k].e4b) res.e4bFailed = true; if (e && e.code === 'CANCELLED') break; }
    }
    const c = res.tests.chat || {}, can = c.canaryTokPerS, key = `pf.app.benchCanary.${c.mode || 'resident'}.${c.drafter ? 'faster' : 'plain'}`, best = api.ls.get(key, null);   // the best in the same mode
    res.heat = { canary: can || null, best: best || null, newBest: !!(can && best && can > best), warm: (res.workedAgoS != null && res.workedAgoS < 180) || !!(can && best && can < 0.9 * best) };
    if (can && (!best || can > best)) api.ls.set(key, can);
    B.running = null; B.results = res; api.ls.set('pf.app.bench', res); api.ls.set('pf.app.benchRun', null); render();
    api.toast('Benchmark finished');
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
    for (const [k, v] of Object.entries(r.tests)) {
      if (order.indexOf(k) > e4bAt) sayE4b();
      const n = TESTS[k] ? TESTS[k].name : k;
      if (v.error) L.push(`${n}: did not finish (${v.error})`);
      else if (k === 'chat' || k === 'e4bchat') { L.push(`${n}: ${v.tokPerS} tokens/s (${v.tokens} tokens${dr(k, v)})`); loaded(k === 'chat' ? 'Juli' : 'Bigger brain', v.load); }
      else if (k === 'longanswer' || k === 'e4blong') L.push(`${n}: ${v.tokPerS} tokens/s (${v.tokens} tokens${dr(k, v)})`);
      else if (k === 'e4breadin') L.push(`${n}: ${v.promptTokens} tokens in ${v.prefillS} s (${Math.round(v.promptTokens / v.prefillS)} tokens/s)`);
      else if (k === 'readin') L.push(`${n}: ${v.promptTokens} tokens in ${v.prefillS} s (${Math.round(v.promptTokens / v.prefillS)} tokens/s)`);
      else if (k === 'apps') {
        const tr = v.trip;
        L.push(`${n}: ${v.started}/${v.of} apps open${v.problems && v.problems.length ? ' (' + v.problems.join('; ') + ')' : ''}` + (!tr ? '' : tr.ok
          ? ` · Trip Watch's check (test data): Juli read a test note (${tr.note || 'nothing'}), the test trip checked (${tr.flags} to look at)${tr.brief ? ", Juli's line kept" : tr.leftOut ? ", Juli's line left out (a number not in the forecast)" : ''}${tr.asks.length ? `, Juli ${tr.asks.join(' + ')} s` : ''}, ${tr.seconds} s in all`
          : ` · Trip Watch's check did not finish: ${tr.said}`));
      }
      else L.push(`${n}: ${v.seconds} s`);
    }
    sayE4b();
    return L.join('\n');
  }
  function render() {
    const box = $('s-bench-out'); if (!box) return;
    $('s-bench-quick').disabled = $('s-bench-full').disabled = !!B.running;
    box.replaceChildren();
    if (B.running) { const T = TESTS[B.running.tests[B.running.i]]; box.append(mk('p', 'callout', `Running ${B.running.i + 1} of ${B.running.tests.length}: ${T.name} (${fmt(T.eta)})`)); box.hidden = false; return; }
    if (!B.results) { box.hidden = true; return; }
    box.hidden = false;
    box.append(mk('pre', 'mono footnote bench-text', text(B.results)));
    const c = mk('button', 'btn sm', 'Copy'); c.type = 'button'; c.id = 's-bench-copy';
    c.onclick = async () => { try { await navigator.clipboard.writeText(text(B.results)); api.toast('Copied'); } catch (e) { api.toast('Couldn’t copy: select the text instead'); } };
    box.append(c);
  }
  $('s-bench-quick').onclick = () => start(false);
  $('s-bench-full').onclick = () => start(true);
  render();
  return { render, text, plan, get state() { return B; } };
}
