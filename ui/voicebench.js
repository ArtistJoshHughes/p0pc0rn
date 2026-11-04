// voicebench.js - v4: Settings › Benchmark › Voice in, the page that runs it (ui/voicebench_plan.js plans it and writes the card). Each
// step runs in a fresh page; its result is saved before the next one; a page the phone ends is recorded where it ended and the run goes on.
// The recogniser and Juli's model are read from this phone's storage (the app downloaded them); the test speech is ui/voicebench/ (Qwen3-TTS
// speech in the voice of CMU Flite's cmu_us_slt). It reads the agreement (never writes it) and writes only its own key (p0pc0rn:voicein:bench).
import { BENCH_KEY, STEPS, PACED, LOOKAHEAD, EOU_MS, TAIL_S, LOOP_LINES, LOOP_TOKENS, REAL_TURNS, newRun, resume, begin, finish, passStats, cardText } from './voicebench_plan.js';
import { connectJuli, engineOpts, splitHere, WEBKIT } from '../games/trolley/juli_link.js';
import { createVoiceOut, wordsSoFar, splitMood, MOODS } from './voiceout.js';
import { voiceSystem, lookupPlannerMessages, loadCookbooks, VOICE_NAMES } from '../assistant/agent.js';
import { quickMath } from '../assistant/quickmath.js';
import { weatherAsk, resolvePlace, weatherNote, createWeather } from '../assistant/weather.js';   // v4: a weather turn reads the real forecast (api.weather.gov)
import { loadGeo } from '../assistant/places.js';
import { ANSWER_NOTE_OWN, safetyAsk, safetyNote } from '../assistant/answers.js';
import { consent } from '../rights.js';
import { takeBench } from './benchnonce.js';   // 4.0 (review): only the app's own bench button starts a run

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search), HOME = new URL('../index.html', location.href).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ls = { get: () => { try { return JSON.parse(localStorage.getItem(BENCH_KEY) || 'null'); } catch (e) { return null; } }, set: (v) => { try { localStorage.setItem(BENCH_KEY, JSON.stringify(v)); } catch (e) { /* full */ } } };
const STT_ID = 'nemotron35-asr-0.6b';
let st = null, wake = null;
const say = (t) => { $('vb-banner').textContent = t; };
const save = () => ls.set(st);
const stage = (s) => { if (st && st.cur) { st.cur.stage = s; st.cur.at = Date.now(); save(); } const k = st ? st.steps.indexOf(st.cur && st.cur.id) : -1; say(`${k + 1} of ${st ? st.steps.length : '?'} · ${st && st.cur ? STEPS[st.cur.id].name : ''} · ${s}`); };
const keepAwake = async () => { try { if (navigator.wakeLock && (!wake || wake.released)) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* a tap asks again */ } };
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
addEventListener('pointerdown', keepAwake, { passive: true });

// every GPU buffer this page makes, counted (Juli's page part and the recogniser): its graphics memory as used, not an estimate
const GPUM = { live: 0, peak: 0 };
(function meter() {
  try {
    const D = globalThis.GPUDevice && GPUDevice.prototype; if (!D || D.__vbMeter) return; D.__vbMeter = true;
    const cb = D.createBuffer;
    D.createBuffer = function (desc) {
      const b = cb.call(this, desc), size = Number(desc && desc.size) || 0; let alive = true; GPUM.live += size; if (GPUM.live > GPUM.peak) GPUM.peak = GPUM.live;
      const d = b.destroy; b.destroy = function () { if (alive) { alive = false; GPUM.live -= size; } return d.call(this); }; return b;
    };
  } catch (e) { /* optional */ }
})();
const jsMB = () => { const pm = performance && performance.memory; return pm ? Math.round(pm.usedJSHeapSize / 1e6) : null; };

function readWav(ab) {
  const dv = new DataView(ab); let p = 12, data = null, ch = 1;
  while (p + 8 <= ab.byteLength) {
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3)), n = dv.getUint32(p + 4, true);
    if (id === 'fmt ') ch = dv.getUint16(p + 10, true);
    if (id === 'data') data = [p + 8, n];
    p += 8 + n + (n & 1);
  }
  const [o, n] = data, out = new Float32Array(n / 2 / ch);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(o + i * 2 * ch, true) / 32768;
  return out;
}
const median = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const tokps = (a) => (a && a.genMs > 0 ? +(a.tokens / (a.genMs / 1000)).toFixed(1) : null);
const deviceLine = () => { const u = navigator.userAgent || ''; const m = /iPhone OS (\d+)_(\d+)/.exec(u) || /Version\/(\d+)\.(\d+)/.exec(u); return `${/iPhone/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android' : 'desktop'}${m ? ` ${m[1]}.${m[2]}` : ''}`; };

async function lines() {
  const doc = await (await fetch('voicebench/lines.json', { cache: 'no-cache' })).json();
  for (const l of doc.lines) l.x = readWav(await (await fetch('voicebench/' + l.file)).arrayBuffer());
  return doc.lines;
}
/** every line as fast as the recogniser goes (pushed at once, in 20 ms pieces) */
async function fastPass(eng, L) {
  const out = [];
  for (const l of L) {
    const s = eng.stream({ lang: l.lang, lookahead: LOOKAHEAD });
    for (let i = 0; i < l.x.length; i += 320) s.push(l.x.subarray(i, Math.min(l.x.length, i + 320)));
    const r = await s.finish();
    out.push({ id: l.id, lang: l.lang, ref: l.text, text: r.text, audioS: r.stats.audioS, encMs: r.stats.encMs, decMs: r.stats.decMs, chunks: r.stats.chunks });
  }
  return out;
}
/** a line at the speed it is spoken (20 ms pieces on the clock), then silence: when the first word shows, when the end is noticed */
async function pacedLine(eng, l) {
  const tail = new Float32Array(Math.round(TAIL_S * 16000)), x = new Float32Array(l.x.length + tail.length); x.set(l.x);
  let ended = null;
  const s = eng.stream({ lang: l.lang, lookahead: LOOKAHEAD, eouMs: EOU_MS, onEnd: (e) => { if (!ended) ended = e.reason; } });
  const t0 = performance.now();
  for (let i = 0, k = 0; i < x.length; i += 320, k++) {
    const due = t0 + k * 20 - performance.now(); if (due > 0) await sleep(due);
    s.push(x.subarray(i, Math.min(x.length, i + 320)));
  }
  const r = await s.finish();
  return { id: l.id, text: r.text, firstWordMs: r.stats.firstWordMs, endMs: ended === 'silence' ? r.stats.endMs : null, ended };
}

async function runStep(id) {
  const S = STEPS[id];
  if (!consent()) return { notRun: 'agree to the p0pc0rn terms first (the short lesson)' };
  const P = globalThis.P0_CONFIG && P0_CONFIG.packs && P0_CONFIG.packs[STT_ID];
  if (!P) return { notRun: 'this build has no voice input pack' };
  if (S.juli && id === 'helper' && !splitHere()) return { notRun: WEBKIT ? 'needs Safari on iOS 27 (its second process)' : 'one process in this browser: the same as the chat layout' };
  const { createSttEngine } = await import('../engine/stt/stt_engine.js');
  stage('opening the recogniser');
  const eng = await createSttEngine({ packUrl: P });
  if (!eng.capabilities().supported) return { notRun: eng.capabilities().reason || 'this GPU cannot run it' };
  if (!(await eng.status()).complete) return { notRun: 'voice input is not downloaded (Settings › Models › Voice input)' };
  const L = await lines(), res = {};
  if (S.layout) { try { return await layoutStep(eng, L, S.layout); } finally { try { eng.unload(); } catch (e) { /* */ } } }
  let c = null;
  try {
    if (S.juli) {
      stage('loading Juli');
      c = await connectJuli({ model: 'e2b', splitAt: S.juli.at, ctxCap: 2048 });
      if (!c.ok) return { notRun: 'Juli: ' + c.why };
      res.juli = { at: c.load.at, loadS: c.load.s, pageMB: c.load.pageMB, helperMB: c.load.helperMB, drafter: c.load.drafter };
      stage('Juli answering');
      res.juli.tokPerS1 = tokps(await c.backend.decide({ system: 'Answer with a JSON object {"answer": "..."} in one short sentence.', user: 'What is the capital of Australia?', maxTokens: 40 }));
    }
    stage('loading the recogniser');
    const t0 = performance.now(), ld = await eng.load();
    res.load = { s: +((performance.now() - t0) / 1000).toFixed(2), gpuMB: ld.gpuMB, pageGpuMB: Math.round(GPUM.live / 1e6), jsMB: jsMB() };
    stage(`${L.length} lines as fast as it goes`);
    const f = await fastPass(eng, L);
    res.fast = passStats(f); res.misses = f.filter((x) => x.text.trim() && passStats([x]).exact === 0).map((x) => ({ id: x.id, text: x.text.slice(0, 90) }));
    res.lines = f.map((x) => ({ id: x.id, text: x.text }));
    stage('lines in real time');
    const p = []; for (const l of L.filter((x) => PACED.includes(x.id))) p.push(await pacedLine(eng, l));
    res.paced = { n: p.length, firstWordMs: median(p.map((x) => x.firstWordMs)), endMs: median(p.map((x) => x.endMs)), each: p.map((x) => [x.id, x.firstWordMs, x.endMs, x.ended]) };
    res.load.pagePeakMB = Math.round(GPUM.peak / 1e6);
    if (c) {
      stage('Juli answering beside the recogniser');
      try { res.juli.tokPerS2 = tokps(await c.backend.decide({ system: 'Answer with a JSON object {"answer": "..."} in one short sentence.', user: 'Name a fruit that is yellow.', maxTokens: 40 })); }
      catch (e) { res.juli.err2 = String((e && (e.code || e.message)) || e).slice(0, 60); }
      const a = await c.backend.alive(); if (a && !a.one) res.juli.helperAliveMB = a.mb;
    }
    return res;
  } finally {
    try { eng.unload(); } catch (e) { /* */ }
    try { if (c && c.backend) c.backend.close(); } catch (e) { /* */ }
  }
}

/** the chat's cookbooks (the voice-mode prompt carries their always-on safety notes) */
async function cookbooks() {
  const index = await (await fetch('../assistant/cookbooks/index.json', { cache: 'no-cache' })).json(), files = {};
  for (const f of new Set(index.sections.map((s) => s.file))) files[f] = await (await fetch('../assistant/cookbooks/' + f, { cache: 'no-cache' })).text();
  return loadCookbooks({ index, files });
}
// ---- the voice loop in one layout (Josh, Nov 2): Juli + the recogniser (page or its own process) + her voice, all loaded; five turns
const WX = createWeather();   // the weather turns' forecasts (each point kept 30 min, as in the chat)
const VOICE_SYS = 'You are Juli, the assistant in p0pc0rn, answering out loud. Start your reply with a mood tag in square brackets and a colon, '
  + `one or two of: ${MOODS.join(', ')} (for example "[calm and cheerful]:"). Then answer in one or two short sentences that sound natural `
  + 'spoken. No lists, no emoji, no markdown. ' + VOICE_NAMES;   // v4: + names in lower case (agent.js)
const isGone = (e) => /SPLIT_|GPU_LOST|STT_WORKER/.test(String((e && (e.code || e.message)) || e));
async function layoutStep(eng, L, cfg) {
  const split = splitHere();
  if (WEBKIT && !split) return { notRun: 'needs Safari on iOS 27 (its second process)' };
  const { createEngine } = await import('../engine/llm/llm_engine.js');
  const llm = await createEngine(engineOpts({ model: 'e2b', splitAt: cfg.at, split }));
  if (!(await llm.status()).complete) return { notRun: 'Juli is not downloaded (get her in p0pc0rn)' };
  const out = { turns: [], ended: [], voice: null, order: [] };
  let rec = null, vo = null;
  const helperNow = async () => { try { const sp = llm.pipe && llm.pipe.split; if (!sp) return 0; const x = await sp.stats(); return x && !x.none ? x.aliveMB : null; } catch (e) { return null; } };
  const loadJuli = async () => {
    stage(`loading Juli (layers 0-${cfg.at - 1} in the helper)`);
    const t0 = performance.now(), J = await llm.load({ mode: 'resident', ctxCap: 2048 });
    out.juli = { loadS: +((performance.now() - t0) / 1000).toFixed(1), at: J.split ? J.split.at : null, pageMB: J.split ? J.split.pageMB : J.residentMB, helperMB: J.split ? J.split.workerMB : 0, drafter: !!J.drafter };
    stage('Juli answering'); const a = await llm.chat([{ role: 'system', content: VOICE_SYS }, { role: 'user', content: 'Say hello in one sentence.' }], { maxTokens: 24, temperature: 0 });
    out.juli.tokPerS1 = a.tokPerS != null ? +(+a.tokPerS).toFixed(1) : null; out.order.push('Juli');
  };
  const loadRec = async () => {
    stage(`loading the recogniser (${cfg.stt === 'worker' ? 'its own process' : 'the page'})`);
    const t0 = performance.now();
    const ld = await eng.load(); rec = { stream: (o) => eng.stream(o), close: () => eng.unload(), stats: null };
    out.stt = { where: 'page', loadS: +((performance.now() - t0) / 1000).toFixed(2), gpuMB: ld.gpuMB };
    out.order.push('the recogniser');
  };
  try {
    try { if (cfg.order === 'before') { await loadRec(); await loadJuli(); } else { await loadJuli(); await loadRec(); } }
    catch (e) { if (isGone(e)) { out.ended.push(String(e.code || e.message).slice(0, 90)); return { loop: out }; } throw e; }
    stage('loading her voice'); vo = createVoiceOut({ wait: true }); await vo.load(); out.voice = vo.name; out.voiceWhy = vo.why || null; out.voiceT = vo.timings;   // v4: her own voice (its pack downloads first if it is missing), Flite if it cannot run
    out.mem = { pageGpuMB: Math.round(GPUM.live / 1e6), helperMB: await helperNow(), sttHelperMB: rec.stats ? (await rec.stats().catch(() => null) || {}).gpuMB : null, voiceMB: vo.memoryBytes() ? Math.round(vo.memoryBytes() / 1e6) : null, jsMB: jsMB() };
    const cb = await cookbooks();
    const turns = [...LOOP_LINES.map((id) => ({ id, real: null })), { id: 'warm', warm: true }, ...REAL_TURNS];
    out.recovered = [];
    for (const { id, real, typed, warm } of turns) {
      if (warm) {   // v4: the voice prompt's and the planner's fixed starts read in (app.js warmVoice) while a line is spoken: the recogniser beside it
        stage('the warm-up while a line is spoken');
        try {
          const l = L.find((x) => x.id === 'v05'), x = new Float32Array(l.x.length + Math.round(TAIL_S * 16000)); x.set(l.x); let eou = null;
          await llm.pipe.dropPrefix();
          const s = rec.stream({ lang: l.lang, lookahead: LOOKAHEAD, eouMs: EOU_MS, onEnd: (e) => { if (!eou && e.reason !== 'error') eou = { at: performance.now() }; } }), tf = performance.now(), got = [];
          const wq = (async () => { for (const m of [[{ role: 'system', content: voiceSystem(cb, { research: true, note: ANSWER_NOTE_OWN }) }, { role: 'user', content: '.' }], lookupPlannerMessages('.')]) { const a = await llm.chat(m, { keepPrefix: true, prefixOnly: true, maxTokens: 1 }); got.push(a.snapshot ? a.snapshot.readIn : null); } return performance.now() - tf; })();
          for (let i = 0, k = 0; i < x.length && !eou; i += 320, k++) { const due = tf + k * 20 - performance.now(); if (due > 0) await sleep(due); s.push(x.subarray(i, Math.min(x.length, i + 320))); }
          for (let w = 0; !eou && w < 150; w++) await sleep(20);
          const ss = s.stats(), micEnd = s.st.wallLastVoice || tf; s.cancel();
          out.warm = { rtf: ss.rtf, eouMs: eou ? Math.round(eou.at - micEnd) : null, ms: Math.round(await wq), readIn: got };
        } catch (e) { out.warm = { error: String((e && (e.code || e.message)) || e).slice(0, 80) }; if (isGone(e)) { out.ended.push(out.warm.error); break; } }
        continue;
      }
      const l = L.find((x) => x.id === id); if (!l && !typed) continue;
      stage(`turn ${out.turns.length + 1} of ${turns.length}: ${id}${real ? ' (the chat’s own prompt)' : ''}`);
      const t = { id, real }; out.turns.push(t);
      try {
        let micEnd;
        if (typed) { t.heard = typed; t.typed = true; micEnd = performance.now(); }   // a typed message (no speech: the US weather turn)
        else {
        const tail = new Float32Array(Math.round(TAIL_S * 16000)), x = new Float32Array(l.x.length + tail.length); x.set(l.x);
        let eou = null, serr = null;
        const s = rec.stream({ lang: l.lang, lookahead: LOOKAHEAD, eouMs: EOU_MS, onEnd: (e) => { if (e.reason === 'error') serr = e.error; else if (!eou) eou = { at: performance.now(), text: e.text }; } });
        const tf = performance.now();
        for (let i = 0, k = 0; i < x.length && !eou && !serr; i += 320, k++) { const due = tf + k * 20 - performance.now(); if (due > 0) await sleep(due); s.push(x.subarray(i, Math.min(x.length, i + 320))); }
        for (let w = 0; !eou && !serr && w < 100; w++) await sleep(20);
        if (serr) throw serr;
        const st = s.stats(); s.cancel();
        micEnd = s.st.wallLastVoice || tf;
        t.heard = eou ? eou.text : s.text; t.eouMs = eou ? Math.round(eou.at - micEnd) : null; t.sttRtf = st.rtf;
        if (!t.heard.trim()) { t.error = 'heard nothing'; continue; }
        }
        let acc = '', spoken = 0, wordAt = null, audioAt = null, ttsMs = 0, audioS = 0, chain = Promise.resolve();
        const say = (text) => { chain = chain.then(async () => { const a = performance.now(), r = await vo.speak(text), d = performance.now() - a; ttsMs += d; audioS += r.pcm.length / r.sampleRate; if (audioAt == null && r.pcm.length) { audioAt = performance.now(); t.voice = r.voice; t.voiceMs = Math.round(d); } }).catch(() => {}); };   // v4: which voice played her first sentence, and how long it took to make
        // the chat's own voice-mode prompt for the last three (agent.js voiceSystem; a lookup question first reads the lookup planner's prompt,
        // as the chat does; the lookup itself, a web request, is left out)
        const qm = quickMath(t.heard);   // a number or unit question is worked out in code, as the chat does (agent.js)
        let sys = VOICE_SYS + (qm ? '\n\n' + qm.note : ''), maxTokens = LOOP_TOKENS; t.promptTokens = [];
        if (t.real) {
          let wxNote = '';
          if (t.real === 'weather') {   // as agent.js weatherFor: the place on the phone, the forecast from the US National Weather Service, her note
            const ask = weatherAsk(t.heard), res = ask ? resolvePlace(ask, await loadGeo()) : { kind: 'none' }, w0 = performance.now();
            if (res.kind === 'ok') { try { res.fc = await WX.forecast(res.lat, res.lon, { hourly: ask.when === 'now' }); if (res.fc.outside) Object.assign(res, { kind: 'outside', name: res.label, us: [] }); } catch (e) { Object.assign(res, { kind: 'error' }); } }
            t.wx = { kind: res.kind, place: res.label || res.name || null, source: res.fc && res.fc.source ? res.fc.source : null, ms: res.fc ? Math.round(performance.now() - w0) : null, periods: res.fc && res.fc.periods ? res.fc.periods.length : 0 };
            wxNote = weatherNote(ask, res, { voice: true });
          }
          if (t.real === 'lookup') { const pl = await llm.chat(lookupPlannerMessages(t.heard), { maxTokens: 160, temperature: 0, keepPrefix: true }); t.promptTokens.push(pl.promptTokens); t.planSnap = pl.snapshot || null; }   // as agent.js planTopics on a spoken turn
          sys = voiceSystem(cb, { research: true, note: [wxNote || (safetyAsk(t.heard) ? safetyNote(t.heard) : ANSWER_NOTE_OWN), qm ? qm.note : ''].filter(Boolean).join('\n\n') }); maxTokens = 200;
        }
        const r = await llm.chat([{ role: 'system', content: sys }, { role: 'user', content: t.heard }], { maxTokens, temperature: 0, keepPrefix: t.real ? true : undefined,   // as agent.js on a spoken turn (the prefix snapshot)
          onToken: (piece) => {
            acc += piece; const w = wordsSoFar(acc); if (w == null) return;
            if (wordAt == null && /\p{L}/u.test(w)) wordAt = performance.now();
            const m = /^(.*?[.!?])(\s|$)/s.exec(w.slice(spoken));
            if (m && audioAt == null) { say(m[1]); spoken += m[1].length; }
          } });
        const all = splitMood(acc); t.moods = all.moods; t.reply = all.text;
        if (all.text.slice(spoken).trim()) say(all.text.slice(spoken));
        await chain;
        t.wordMs = wordAt ? Math.round(wordAt - micEnd) : null; t.audioMs = audioAt ? Math.round(audioAt - micEnd) : null;
        t.promptTokens.push(r.promptTokens); t.snap = r.snapshot || null; t.tokPerS = r.tokPerS != null ? +(+r.tokPerS).toFixed(1) : null; t.ttsX = ttsMs > 0 ? +(audioS / (ttsMs / 1000)).toFixed(1) : null;
      } catch (e) {
        t.error = String((e && (e.code || e.message)) || e).slice(0, 80);
        // v4 (Josh's phone, Nov 2: the 0-28 helper ended once): as the app does after its second process ends (app.js juliSplitFailed): a
        // fresh engine with the same layout, once; the card shows it and how long it took, and the loop goes on
        if (/^SPLIT_/.test(String(e && e.code)) && !out.recovered.length) {
          stage('a fresh engine for Juli (her second process ended)'); const r0 = performance.now(), rec0 = { at: id, code: e.code, ok: false };
          try { try { llm.unload(); } catch (x) { /* */ } await llm.load({ mode: 'resident', ctxCap: 2048 }); rec0.ok = true; } catch (x) { rec0.error = String((x && (x.code || x.message)) || x).slice(0, 80); }
          rec0.ms = Math.round(performance.now() - r0); out.recovered.push(rec0);
          if (rec0.ok) continue;
          out.ended.push(rec0.error || t.error); break;
        }
        if (isGone(e)) { out.ended.push(t.error); break; }
      }
    }
    const h = await helperNow(); out.mem.helperAfterMB = h; if (split && h == null && !out.ended.some((x) => /SPLIT/.test(x))) out.ended.push('Juli’s second process');
    out.mem.pagePeakMB = Math.round(GPUM.peak / 1e6);
    const med = (k) => median(out.turns.filter((x) => !x.real).map((x) => x[k]));
    out.med = { eouMs: med('eouMs'), wordMs: med('wordMs'), audioMs: med('audioMs'), tokPerS: med('tokPerS'), sttRtf: med('sttRtf'), ttsX: med('ttsX'), voiceMs: med('voiceMs') };
    return { loop: out };
  } finally { try { if (rec) rec.close(); } catch (e) { /* */ } try { llm.unload(); } catch (e) { /* */ } try { if (vo) vo.unload(); } catch (e) { /* */ } }
}

function card() {
  $('vb-card').textContent = cardText(st); $('vb-card').hidden = false; $('vb-copy').hidden = false;
  say(st.done ? 'Done.' : 'Stopped.');
  $('vb-copy').onclick = async () => { try { await navigator.clipboard.writeText(cardText(st)); $('vb-copy').textContent = 'Copied'; } catch (e) { $('vb-copy').textContent = 'Select the text to copy it'; } };
  if (/[?&]test(?:&|$)/.test(location.search) || Q.has('test')) globalThis.__voiceBench = { st, text: cardText(st) };
}
async function main() {
  $('vb-back').onclick = () => { try { location.replace(HOME); } catch (e) { location.href = HOME; } };
  keepAwake();
  const n = Q.get('n') || '', old = ls.get();
  if (Q.get('bench') === 'start' && takeBench(n, { test: Q.has('test') }) && (!old || old.nonce !== n || old.done)) { st = newRun({ nonce: n, app: 'v4', device: deviceLine() }); save(); }
  else st = Q.get('bench') === 'start' ? null : old;   // 4.0 (review): a start without the button's nonce runs nothing
  try { history.replaceState(null, '', location.pathname + '?bench=1' + (Q.has('test') ? '&test' : '')); } catch (e) { /* a reload carries on, never starts again */ }
  const r = resume(st);
  if (r.act === 'none') { st = null; return say('No run in progress: start one in Settings › Benchmark.'); }
  st = r.st; save();
  if (r.act === 'show') return card();
  if (r.settle) for (let s = r.settle; s > 0; s--) { say(`The page ended in “${STEPS[r.crashed].name}”: recorded. Letting the phone’s memory settle ${s} s…`); await sleep(1000); }
  const id = st.steps[st.i]; st = begin(st, id); save();
  let res;
  try { res = await runStep(id); } catch (e) { res = { error: String((e && (e.code ? e.code + ': ' : '') + (e.message || e)) || e).slice(0, 140) }; }
  st = finish(st, id, res); save();
  if (st.done) return card();
  say('Next step in a fresh page…'); setTimeout(() => location.reload(), 300);
}
main();
