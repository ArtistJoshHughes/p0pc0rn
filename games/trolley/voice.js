// voice.js - Juli's voice in Troll-E (v6): her radio lines spoken as well as shown. The voice is CMU Flite with its cmu_us_slt voice in
// WebAssembly (vendor/flite/, named in voice_pick.js); until it lands, voice_standin.js (the same API: a quiet murmur as long as the
// line would be). The caller always shows her subtitle; this only adds the sound:
// - one line at a time, never overlapping (the next starts after the last one's squelch); a newer line of higher priority (a warning)
//   cuts a lower one; a line still waiting after maxAge (4 s) is dropped, she never talks about the past; at most 4 wait.
// - synthesis is off the frame: in a module Worker when voice_pick.js allows it, else on the main thread in its own task, sentence by
//   sentence; never while the caller's hold() says a model is loading (the voice's own load is only started from a line, not on boot).
// - playback through the game's audio (audio.js playPCM): the radio chain (350 Hz-3.2 kHz, a light bit-crush, a compressor, a squelch
//   at each end) or clean (radio off); on the game's master, so the mute covers her. With the voice switch off, the game muted, or no
//   AudioContext yet (before the first tap) it does nothing at all, and a line in the air stops when any of those changes.
// - measure(lines): synthesis ms per second of speech, the total for the lines, the PCM bytes, the heap growth (performance.memory).
import * as STANDIN from './voice_standin.js';
import { VOICE_MODULE, VOICE_IN_WORKER } from './voice_pick.js';
import { RADIO } from './audio.js';

/** the start card's "Juli's voice" switch (kept per device): '0' = off, anything else or nothing = on */
export const VOICE_KEY = 'p0pc0rn:trolley:voice';
export const VOICE = { maxAge: 4000, maxQueue: 4, maxChars: 160, holdRetryMs: 200, watchMs: 250, chunkOver: 40, workerInitMs: 30000, lead: 0.03 };
export const PRIORITY = { low: 0, normal: 1, high: 2 };
/** how a few of the game's words are said (the subtitle keeps them as written) */
export const SAY_AS = [[/\ba01\b/gi, 'A oh one'], [/\bROMs\b/g, 'roms'], [/\bROM\b/g, 'rom']];
/** measure()'s default text: twelve radio-length lines for the bench (never played in the game; her real lines are her model's) */
export const BENCH_LINES = [
  'Morning, a01. The hall is a mess and it is all yours.',
  'Nice parking. Mostly.',
  'I dropped something by the dock. Oops.',
  'Bounty on tins for the next thirty seconds. Go on.',
  'That sign was flickering before I touched it. Probably.',
  'Battery at forty percent. I would head home soon.',
  'Night is coming, and the leeches are already awake.',
  'You crafted a what? Fine. It is very shiny.',
  'Mind the diesel. It never comes out of the floor.',
  'The shutter is down for a moment. Just a moment.',
  'Three cans left in the yard. I counted twice.',
  'Good work today. Do not let it go to your wheels.',
];

const perf = () => (globalThis.performance && performance.now ? performance.now() : Date.now());
const msg = (e) => String((e && (e.message || e)) || 'failed').slice(0, 160);
const nextTask = () => new Promise((r) => setTimeout(r, 0));
const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
const OUTCOME_KEY = { played: 'played', cut: 'cut', stale: 'stale', off: 'off', muted: 'muted', 'no-audio': 'noAudio', suspended: 'noAudio', interrupted: 'interrupted', dropped: 'dropped', cancelled: 'cancelled', failed: 'failed', empty: 'empty' };

// typographic quotes, dashes and dots (by code point) -> what the voice reads
const PLAIN = new Map([[0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2013, ', '], [0x2014, ', '], [0xb7, ', '], [0x2022, ', ']]);
/** her line as the voice should read it: plain ASCII, the game's words said right, at most maxChars; '' = nothing to say */
export function speechText(text, max = VOICE.maxChars) {
  if (typeof text !== 'string') return '';
  let s = [...text.normalize('NFKD').replace(/\p{M}/gu, '')].map((ch) => { const r = PLAIN.get(ch.codePointAt(0)); return r === undefined ? ch : r; }).join('');
  for (const [re, w] of SAY_AS) s = s.replace(re, w);
  s = s.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.!?;:])/g, '$1').replace(/([,;:])(?:[,;:] ?)+/g, '$1').trim();
  if (!/[a-z0-9]/i.test(s)) return '';
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') : s;
}
/** a line in sentences (pieces under 8 characters ride with a neighbour): the main thread synthesises one per task */
export function splitSentences(text) {
  const out = [];
  for (const p of (String(text || '').match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || []).map((x) => x.trim()).filter(Boolean)) {
    if (out.length && (p.length < 8 || out[out.length - 1].length < 8)) out[out.length - 1] += ' ' + p; else out.push(p);
  }
  return out;
}
/** whatever a voice module's speak() returned -> { pcm: Float32Array it does not share, rate } */
function toPCM(r, rate) {
  const a = r && typeof r === 'object' && !ArrayBuffer.isView(r) && !Array.isArray(r) ? (r.pcm || r.samples) : r;
  const hz = (r && +r.sampleRate) || rate || 16000;
  if (a instanceof Int16Array) { const f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = a[i] / 32768; return { pcm: f, rate: hz }; }
  if (a instanceof Float32Array) return { pcm: a.byteLength === a.buffer.byteLength ? a : a.slice(), rate: hz };   // a view into a WASM heap is copied
  if (Array.isArray(a)) return { pcm: Float32Array.from(a), rate: hz };
  return { pcm: new Float32Array(0), rate: hz };
}
function concat(list) {
  if (list.length === 1) return list[0];
  const out = new Float32Array(list.reduce((n, a) => n + a.length, 0)); let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}

// an engine: { name, rate, mode: 'main' | 'worker', speak(text) -> Promise<{ pcm, rate, ms, blockMs, mem }>, close() }
async function mainEngine(mod) {
  if (!mod || typeof mod.speak !== 'function') throw new Error('the voice module has no speak()');
  if (typeof mod.load === 'function') await mod.load();
  const info = mod.info || {}, rate = +info.sampleRate || 16000;
  return { name: String(info.name || 'voice'), rate, mode: 'main', close() {},
    async speak(text) {
      const t0 = perf(), p = mod.speak(text), blockMs = perf() - t0, v = await p, ms = perf() - t0;   // blockMs: the part that held the thread
      return { ...toPCM(v, rate), ms, blockMs, mem: typeof mod.memoryBytes === 'function' ? safe(() => mod.memoryBytes(), null) : null };
    } };
}
function workerEngine(url) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./voice_worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(Object.assign(new Error(msg(e)), { stage: 'worker' })); return; }
    const pend = new Map(); let seq = 0, ready = false, to = 0;
    const eng = { name: 'voice', rate: 16000, mode: 'worker', broken: '',
      speak: (text) => new Promise((res, rej) => { if (eng.broken) { rej(new Error(eng.broken)); return; } const id = ++seq; pend.set(id, { res, rej, t0: perf() }); w.postMessage({ op: 'speak', id, text }); }),
      close: () => { try { w.terminate(); } catch (e) { /* gone */ } } };
    const fail = (why, stage) => {
      clearTimeout(to); eng.broken = why; eng.close();
      for (const p of pend.values()) p.rej(new Error(why)); pend.clear();
      if (!ready) reject(Object.assign(new Error(why), { stage }));
    };
    to = setTimeout(() => fail('the voice worker did not start in time', 'worker'), VOICE.workerInitMs);
    w.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.op === 'ready') { ready = true; clearTimeout(to); const info = m.info || {}; eng.name = String(info.name || 'voice'); eng.rate = +info.sampleRate || 16000; resolve(eng); }
      else if (m.op === 'error') fail(m.why || 'the voice module failed', 'module');
      else if (m.op === 'pcm') {
        const p = pend.get(m.id); if (!p) return; pend.delete(m.id);
        if (m.error) p.rej(new Error(m.error));
        else p.res({ pcm: m.pcm instanceof Float32Array ? m.pcm : new Float32Array(0), rate: +m.rate || eng.rate, ms: +m.ms || 0, wallMs: perf() - p.t0, blockMs: 0, mem: m.mem == null ? null : m.mem });
      }
    };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); fail(msg(e && e.message) || 'the voice worker failed', 'worker'); };
    w.postMessage({ op: 'init', url });
  });
}

/** createVoice({ audio, enabled, radio, hold, now, synth, pick, worker, onLoad, maxAge }) -> { say, cancel, load, measure, dispose, stats, busy, speaking, queued, current }
 *  audio: the game's createAudio() (its context, playPCM, squelch, muted); enabled(): the voice switch; radio(): the radio filter on/off;
 *  hold(): true while a model loads (no synthesis then); now(): ms, for the lines' ages; synth: a voice module object (tests);
 *  pick: a module path overriding voice_pick.js; worker: force (true) or forbid (false) the Worker; onLoad('start' | 'end'). */
export function createVoice({ audio = null, enabled = () => true, radio = () => true, hold = () => false, now = perf, synth = null, pick, worker, onLoad = null, maxAge = VOICE.maxAge } = {}) {
  const stats = { engine: null, mode: null, why: '', loading: false, loadMs: 0, said: 0, played: 0, cut: 0, stale: 0, off: 0, muted: 0, noAudio: 0, interrupted: 0,
    dropped: 0, cancelled: 0, failed: 0, empty: 0, synthMs: 0, synthMsTotal: 0, audioS: 0, maxBlockMs: 0, last: '' };
  const Q = []; let cur = null, seq = 0, holdT = null, tail = 0, E = null, EP = null;
  const ctxOf = () => (audio && audio.context) || null;
  const level = (p) => (typeof p === 'number' && Number.isFinite(p) ? p : Object.prototype.hasOwnProperty.call(PRIORITY, p) ? PRIORITY[p] : PRIORITY.normal);
  const tellLoad = (s) => { if (onLoad) safe(() => onLoad(s)); };

  /** the voice module, loaded once (the first line, or the caller's load()): the Worker, else the main thread, else the stand-in */
  function load() {
    if (EP) return EP;
    stats.loading = true; tellLoad('start');
    const t0 = perf();
    EP = (async () => {
      let eng = null, moduleBad = false; const why = [];
      const tryIt = async (label, f) => { try { return await f(); } catch (e) { why.push(`${label}: ${msg(e)}`); if (e && e.stage === 'module') moduleBad = true; return null; } };
      const spec = pick !== undefined ? pick : VOICE_MODULE, canWorker = typeof Worker === 'function';
      if (synth) eng = await tryIt('voice', () => mainEngine(synth));
      else if (spec) {
        const url = new URL(spec, import.meta.url).href;
        if (canWorker && (worker !== undefined ? !!worker : VOICE_IN_WORKER)) eng = await tryIt('worker', () => workerEngine(url));
        if (!eng && !moduleBad) eng = await tryIt('voice', async () => mainEngine(await import(url)));
      }
      if (!eng && worker === true && canWorker) eng = await tryIt('worker', () => workerEngine(new URL('./voice_standin.js', import.meta.url).href));
      if (!eng) eng = await mainEngine(STANDIN);
      E = eng;
      Object.assign(stats, { engine: eng.name, mode: eng.mode, why: why.join('; ').slice(0, 300), loading: false, loadMs: Math.round(perf() - t0) });
      tellLoad('end');
      return eng;
    })();
    return EP;
  }
  async function synthText(eng, text, isDone = () => false) {
    const parts = eng.mode === 'main' && text.length > VOICE.chunkOver ? splitSentences(text) : [text];
    const pcs = []; let ms = 0, blockMs = 0, rate = eng.rate, mem = null;
    for (const p of parts) {
      if (eng.mode === 'main') await nextTask();   // each piece in a task of its own, never inside the caller's frame
      if (isDone()) return null;
      const r = await eng.speak(p);
      ms += r.ms; blockMs = Math.max(blockMs, r.blockMs); rate = r.rate || rate; if (r.mem != null) mem = r.mem; pcs.push(r.pcm);
    }
    return { pcm: concat(pcs), rate, ms, blockMs, mem };
  }

  /** why a line cannot sound now ('' = it can) */
  function blocked() {
    if (!safe(enabled, true)) return 'off';
    if (audio && audio.muted) return 'muted';
    const c = ctxOf(); if (!c || typeof audio.playPCM !== 'function') return 'no-audio';
    if (c.state !== 'running') return 'suspended';   // the page hidden, or a phone call: she does not keep it for later
    return '';
  }
  function settle(line, outcome) {
    if (line.done) return;
    line.done = true; line.outcome = outcome;
    if (line.timer) clearTimeout(line.timer); if (line.watch) clearInterval(line.watch);
    stats.last = outcome; if (OUTCOME_KEY[outcome]) stats[OUTCOME_KEY[outcome]]++;
    line.resolve(outcome);
  }
  function finish(line, outcome) {
    if (line.done) return;
    if (line.h && outcome !== 'played') silence(line, outcome === 'cut');
    settle(line, outcome);
    if (cur === line) cur = null;
    pump();
  }
  function silence(line, unkey) {   // a line stopped short: a quick fade, its squelches stopped; cut by a newer line: the radio's short close
    const c = ctxOf(), n = c ? c.currentTime : 0;
    line.h.stop(0.03);
    if (line.sqOpen) line.sqOpen.stop();
    if (line.sqClose) line.sqClose.stop();
    tail = n + 0.04;
    if (unkey && line.radio && audio.squelch) { const q = audio.squelch('close', { at: n + 0.02, dur: RADIO.cut }); if (q) tail = q.end; }
  }
  function pump() {
    if (cur) return;
    while (Q.length) {
      const line = Q[0];
      if (now() - line.t0 > line.maxAge) { Q.shift(); settle(line, 'stale'); continue; }
      const no = blocked(); if (no) { Q.shift(); settle(line, no); continue; }
      if (safe(hold, false)) { armHold(); return; }
      Q.shift(); begin(line); return;
    }
  }
  function armHold() { if (!holdT) holdT = setTimeout(() => { holdT = null; pump(); }, VOICE.holdRetryMs); }
  function begin(line) {
    cur = line; line.state = 'synth';
    load().then((eng) => {
      if (line.done) return null;
      if (safe(hold, false)) { cur = null; line.state = 'queued'; Q.unshift(line); armHold(); return null; }   // a model load began while hers did
      return synthText(eng, line.words, () => line.done);
    }).then((r) => {
      if (line.done || line.state !== 'synth') return;
      if (!r || !r.pcm.length) { finish(line, 'failed'); return; }
      stats.synthMs = Math.round(r.ms * 10) / 10; stats.synthMsTotal += r.ms; stats.maxBlockMs = Math.max(stats.maxBlockMs, r.blockMs);
      if (now() - line.t0 > line.maxAge) { finish(line, 'stale'); return; }
      const no = blocked(); if (no) { finish(line, no); return; }
      play(line, r);
    }).catch((e) => { if (!line.done) { stats.why = msg(e); finish(line, 'failed'); } });
  }
  function play(line, r) {
    const c = ctxOf(), onRadio = !!safe(radio, true) && typeof audio.squelch === 'function';
    let t = Math.max(c.currentTime + VOICE.lead, tail);
    line.state = 'playing'; line.radio = onRadio;
    if (onRadio) { line.sqOpen = audio.squelch('open', { at: t }); if (line.sqOpen) t = line.sqOpen.end - 0.02; }
    const h = audio.playPCM(r.pcm, r.rate, { radio: onRadio, at: t, onended: () => finish(line, 'played') });
    if (!h) { if (line.sqOpen) line.sqOpen.stop(); finish(line, 'failed'); return; }
    line.h = h; tail = h.end;
    if (onRadio) { line.sqClose = audio.squelch('close', { at: h.end }); if (line.sqClose) tail = line.sqClose.end; }
    stats.audioS += h.duration;
    // onended can go missing (a context stalled mid-line): a timer closes the line, and waits on while the audio clock still moves (it
    // can run behind the wall clock); a watch stops the line if the switch, the mute or the context change
    const arm = (seen) => { line.timer = setTimeout(() => {
      const n = c.currentTime;
      if (n + 0.05 >= h.end) finish(line, 'played'); else if (c.state === 'running' && n > seen) arm(n); else finish(line, 'interrupted');
    }, Math.max(0, h.end - c.currentTime) * 1000 + 800); };
    arm(c.currentTime);
    line.watch = setInterval(() => { const no = blocked(); if (no) finish(line, no === 'suspended' || no === 'no-audio' ? 'interrupted' : no); }, VOICE.watchMs);
  }

  /** say one line. priority: 'low' | 'normal' (her radio) | 'high' (a warning) or a number; maxAge: ms it may wait.
   *  -> Promise of what became of it: 'played' | 'cut' | 'stale' | 'dropped' | 'off' | 'muted' | 'no-audio' | 'suspended' | 'interrupted' | 'cancelled' | 'failed' | 'empty' */
  function say(text, { priority = 'normal', maxAge: age = maxAge } = {}) {
    stats.said++;
    return new Promise((resolve) => {
      const line = { id: ++seq, text: String(text == null ? '' : text), words: speechText(text), pr: level(priority), t0: now(), maxAge: age, resolve, done: false, state: 'queued' };
      if (!line.words) { settle(line, 'empty'); return; }
      const no = blocked(); if (no) { settle(line, no); return; }
      let i = Q.findIndex((q) => q.pr < line.pr); if (i < 0) i = Q.length;
      Q.splice(i, 0, line);
      while (Q.length > VOICE.maxQueue) {   // the oldest of the lowest priority goes
        let k = 0; for (let j = 1; j < Q.length; j++) if (Q[j].pr < Q[k].pr || (Q[j].pr === Q[k].pr && Q[j].t0 < Q[k].t0)) k = j;
        settle(Q.splice(k, 1)[0], 'dropped');
      }
      if (cur && !line.done && line.pr > cur.pr) finish(cur, 'cut'); else pump();
    });
  }
  /** stop her now and forget what was waiting (pagehide, the mute, the voice switch off) */
  function cancel() {
    if (holdT) { clearTimeout(holdT); holdT = null; }
    for (const l of Q.splice(0)) settle(l, 'cancelled');
    if (cur) finish(cur, 'cancelled');
  }
  function dispose() { cancel(); if (E) E.close(); E = null; EP = null; }

  /** the phone bench: synthesise `lines` (default BENCH_LINES, twelve) one after another, nothing played */
  async function measure(lines = BENCH_LINES) {
    const L = (Array.isArray(lines) && lines.length ? lines : BENCH_LINES).map((s) => speechText(s)).filter(Boolean);
    const heap = () => safe(() => (globalThis.performance && performance.memory ? performance.memory.usedJSHeapSize : null), null);
    const h0 = heap(), eng = await load(), keep = [], perLine = [];
    let synthMs = 0, wallMs = 0, maxLineMs = 0, maxBlockMs = 0, samples = 0, chars = 0, rate = eng.rate, mem = null;
    for (const s of L) {
      await nextTask();
      const w0 = perf(), r = await synthText(eng, s), w = perf() - w0;
      wallMs += w; synthMs += r.ms; maxLineMs = Math.max(maxLineMs, r.ms); maxBlockMs = Math.max(maxBlockMs, r.blockMs);
      samples += r.pcm.length; chars += s.length; rate = r.rate || rate; if (r.mem != null) mem = r.mem; keep.push(r.pcm);
      perLine.push({ chars: s.length, audioS: Math.round(r.pcm.length / rate * 1000) / 1000, ms: Math.round(r.ms * 100) / 100 });
    }
    const h1 = heap(), audioS = samples / rate, r1 = (v) => Math.round(v * 10) / 10, held = keep.length; keep.length = 0;
    return { engine: eng.name, mode: eng.mode, lines: L.length, chars, sampleRate: rate, audioS: Math.round(audioS * 1000) / 1000,
      synthMs: Math.round(synthMs * 100) / 100, wallMs: r1(wallMs), msPerSpeechS: audioS > 0 ? Math.round(synthMs / audioS * 100) / 100 : null,
      realtimeX: synthMs > 0 ? Math.round(audioS * 1000 / synthMs) : null, maxLineMs: Math.round(maxLineMs * 100) / 100, maxBlockMs: Math.round(maxBlockMs * 100) / 100,
      pcmBytes: samples * 4, held, loadMs: stats.loadMs, heapBefore: h0, heapAfter: h1, heapGrowthMB: h0 != null && h1 != null ? Math.round((h1 - h0) / 104857.6) / 10 : null,
      engineBytes: mem, perLine };
  }

  return { say, cancel, load, measure, dispose, stats,
    get busy() { return !!cur || Q.length > 0; }, get speaking() { return !!cur && cur.state === 'playing'; }, get queued() { return Q.length; }, get current() { return cur ? cur.text : null; } };
}
