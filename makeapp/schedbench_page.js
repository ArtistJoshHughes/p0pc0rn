// schedbench_page.js - p0pc0rn v4: the scheduler bench in a browser (schedbench.html?bench=scheduler&autostart=1). The mix of
// makeapp/schedbench.js (12 apps for 3 virtual hours, the person chatting, one render) under the v4 scheduler and 3.9's tick, with the
// REAL models: Juli (Gemma 4 E2B with her drafter, as the app loads her) and the Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B with its
// drafter). Josh (Nov 1): "no real APIs so it can work as fast as the tok/s allow. Wall clock means nothing so long as we can bench".
//   - Every source is a fixture (the requests are counted against budget.js's real caps on a VIRTUAL clock; nothing is fetched).
//   - Only real model work takes real time: each load and each answer is timed and that time is added to the virtual clock.
//   - The Bigger brain's question is the real name-reference job (makeapp/reference.js runRef) on fixture Wikipedia / Fandom facts.
//   - ONE model on the GPU at a time, as the app's queue (EngineHost) holds them: before a model loads, every other one is unloaded and
//     its memory given a moment to come back (a desktop run of a4e003e kept Juli in while the Bigger brain loaded on an 8 GB card, and
//     the page hung). The runner unloads a model when its hold runs out, not only when another loads.
//   - Never a hang: each load has a time limit (loadTimeoutS, 300) and each answer one (askTimeoutS, 240); a lost GPU ('gpu-lost') ends
//     the run at once; a failed call is recorded and the run goes on with the model dropped, two in a row end it; and a watchdog ends
//     the run when nothing moved for stallS (600) seconds. An ended run keeps what it measured: SB.result with `aborted`, its failures
//     and a partial card.
//   - Nothing is stored and nothing is agreed: the models are read from the packs (read-only, ?pack=), no p0pc0rn agreement, no
//     licence screen, no queue consent (the queue is not used: the bench calls the engines' pipelines itself, as the desk suites do), no
//     engine check patched.
// Results: window.__schedBench = {state: idle | running | done | error | stalled, done, partial (with its card), result, log}.
// Query: pack (bench-only: where the packs are served, default /pack/), engine=fake (no model: a check of the page itself), fail=
// lost@N | hang@N | error@N | freeze@N (fake only: at the N-th answer the GPU is lost, an answer never returns, one call fails, or the
// page's thread blocks), policy=both|sched|naive, seed, loadTimeoutS, askTimeoutS, stallS, autostart=1.
import { runMix, card, cardOne, fakeEngine, MIX } from './schedbench.js';
import { runRef } from './reference.js';

const Q = new URLSearchParams(location.search);
const PACK = (Q.get('pack') || '/pack/').replace(/\/?$/, '/');   // bench-only override; the app never reads it
const FAKE = Q.get('engine') === 'fake', SEED = +Q.get('seed') || 7, POLICY = Q.get('policy') || 'both';
const LIMIT = { loadS: +Q.get('loadTimeoutS') || 300, askS: +Q.get('askTimeoutS') || 240, stallS: +Q.get('stallS') || 600, settleMs: 1500 };
const FAIL = /^(lost|hang|error|freeze)@(\d+)$/.exec(Q.get('fail') || '');
const SB = window.__schedBench = { state: 'idle', done: false, partial: null, result: null, log: [] };
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M = { LLM: null, eng: {}, live: null, tokens: { e2b: 0, big: 0 }, ms: { e2b: 0, big: 0 }, loadMs: { e2b: [], big: [] }, n: 0, lost: '', abort: '', inRow: 0, lastMove: Date.now(), failures: [] };
const moved = () => { M.lastMove = Date.now(); };
const say = (m) => { const l = `${new Date().toISOString().slice(11, 19)} ${m}`; SB.log.push(l); console.log('schedbench: ' + m); moved(); const el = $('sb-log'); if (el) el.textContent = SB.log.slice(-14).join('\n'); };
// the models as app.js loads them (brainOpts / brain4Opts): on a desktop browser one process, the Bigger brain's read-in in 128-token
// chunks with its drafter; WebKit: 64-token chunks (a4e003e used the WebKit set-up everywhere). Read-only over http from PACK. Bench
// overrides for a device where the Bigger brain stops (tools/e4bprobe.html finds which): bigChunk=64|128, bigDrafter=0, big=0 (the
// mix without the Bigger brain: its jobs wait, as on a phone where it can't run)
const WEBKIT = (() => { const u = navigator.userAgent || ''; return /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) || (/Safari\//.test(u) && !/Chrome\/|Chromium|Edg\/|Android/.test(u)); })();
const BIG = { on: Q.get('big') !== '0', chunk: +Q.get('bigChunk') || (WEBKIT ? 64 : 128), drafter: Q.get('bigDrafter') !== '0' };
const CFG = { e2b: { model: 'gemma4-e2b', packUrl: PACK + 'bal/', dir: 'pocketllm/pack_bal', source: 'http', drafterUrl: PACK + 'drafter/', drafterDir: 'pocketllm/drafter_q4h' },
  big: { model: 'bolt-e4b', packUrl: PACK + 'e4b/', dir: 'pocketllm/e4b', source: 'http', drafterUrl: PACK + 'e4b_drafter/', drafterDir: 'pocketllm/e4b_drafter', drafter: BIG.drafter, split: false, modelOpts: { chunk: BIG.chunk } } };
// the Speed tune (autotune): on branch v4-kernels, not merged into this tree
const TUNE = { inTree: false, note: 'The Speed tune (the kernel autotune) is on branch v4-kernels and not merged into this tree: this run is without it.' };
// fixture questions (the apps' own kind of words) and the fixture lane for the Bigger brain's name references
const ASK = { 'wallet-watch': 'Wallet 0x1f…a2: 3 token transfers in (120 USDC, 40 USDC, 2.1 AVAX), 1 out (55 USDC) since the last check. Say what changed in two plain sentences.',
  'token-watch': 'Facts: LUMA on Avalanche launched 38 minutes ago, up 312 % since launch; liquidity $18,400; 412 buys and 230 sells in the last hour. Write two plain sentences.',
  'trip-watch': 'Trip to Moab, Saturday: sunny, 66 F, wind 20 to 30 mph with gusts to 40 mph in the afternoon. One sentence on what changed.' };
const askOf = (id) => ASK[id] || `The app ${id} found 2 new items since its last check. Say it in one plain sentence.`;
const NAMES = ['Shrek Coin', 'Luma Fox', 'Yoda Inu', 'Pebble', 'Mario Kart Cat', 'Kiwi Cart'];
const LANE = { lookup: async (topic, o) => {
  const t = String(topic).toLowerCase(), wiki = o.kind === 'popculture';
  if (/shrek/.test(t)) return { status: 'hit', title: wiki ? 'Shrek' : 'Shrek (character)', facts: wiki ? [{ relation: 'appears_in', value: 'Shrek 2' }] : [{ relation: 'franchise', value: 'Shrek' }, { relation: 'species', value: 'ogre' }], source: { site: wiki ? 'shrek.fandom.com' : 'en.wikipedia.org', siteName: wiki ? 'Shrek Wiki' : 'Wikipedia', permalink: wiki ? 'https://shrek.fandom.com/wiki/Shrek' : 'https://en.wikipedia.org/wiki/Shrek_(character)', license: 'CC BY-SA 4.0' } };
  if (/yoda/.test(t)) return { status: 'hit', title: 'Yoda', facts: [{ relation: 'franchise', value: 'Star Wars' }, { relation: 'species', value: 'unknown' }], source: { site: 'en.wikipedia.org', siteName: 'Wikipedia', permalink: 'https://en.wikipedia.org/wiki/Yoda', license: 'CC BY-SA 4.0' } };
  if (/luma/.test(t)) return { status: 'hit', title: 'Luma (character)', facts: [{ relation: 'franchise', value: 'Super Mario' }, { relation: 'first_appearance', value: 'Super Mario Galaxy' }], source: { site: 'en.wikipedia.org', siteName: 'Wikipedia', permalink: 'https://en.wikipedia.org/wiki/Luma', license: 'CC BY-SA 4.0' } };
  return { status: 'miss', topic };
} };

// ---- never a hang: every engine call has a time limit and ends at once when the GPU is lost
const abortErr = (why) => Object.assign(new Error(why), { code: 'ABORT' });
let lostReject = null;
const LOST = new Promise((_, rej) => { lostReject = rej; }); LOST.catch(() => {});
function gpuLost(who) { if (M.lost) return; M.lost = `the GPU was lost (${who})`; say(M.lost); lostReject(abortErr(M.lost)); }
function limited(p, s, what) {
  let tm = null;
  const timer = new Promise((_, rej) => { tm = setTimeout(() => rej(abortErr(`${what} did not finish in ${s} s: the GPU looks stuck`)), s * 1000); });
  return Promise.race([p, timer, LOST]).finally(() => clearTimeout(tm));
}
/** one engine call: its limit; a failure is recorded, the models are dropped (the next load starts clean) and the run goes on; two in a
 *  row, a lost GPU, a call past its limit or the watchdog end it (ABORT) */
async function step(what, model, fn, s) {
  if (M.abort) throw abortErr(M.abort);
  try { const v = await limited(Promise.resolve().then(fn), s, what); M.inRow = 0; moved(); return v; }
  catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    M.failures.push({ what, model, code: String((e && e.code) || ''), error: msg, at: new Date().toISOString() });
    if ((e && e.code === 'ABORT') || M.lost) { M.abort = M.abort || msg; say(`${what}: ${msg} -> the run ends here`); throw abortErr(M.abort); }
    M.inRow++; say(`${what} failed (${msg}); the models are dropped and the run goes on`);
    await dropAll();
    if (M.inRow >= 2) { M.abort = `two engine failures in a row (last: ${msg})`; throw abortErr(M.abort); }
    throw Object.assign(e instanceof Error ? e : new Error(msg), { code: (e && e.code) || 'FAILED' });
  }
}
async function dropAll() { for (const k of ['e2b', 'big']) { try { if (M.inner) await M.inner.unload(k); } catch (e) { /* gone */ } } M.live = null; await sleep(LIMIT.settleMs); }   // every model off the GPU

/** inner engines: the real one (the packs, the GPU) or the fake one (fixed times, the one-model rule, an injected failure) */
async function innerReal() {
  if (!M.LLM) M.LLM = await import('../engine/llm/llm_engine.js');
  return {
    async load(model) {
      if (!M.eng[model]) { M.eng[model] = await M.LLM.createEngine(CFG[model]); M.eng[model].on('gpu-lost', () => gpuLost(model === 'big' ? 'the Bigger brain' : 'Juli')); }
      const ld = await M.eng[model].load(model === 'big' ? { mode: 'resident' } : undefined);
      say(`${model === 'big' ? 'Bigger brain' : 'Juli'} in: ${ld && ld.residentMB != null ? ld.residentMB + ' MB resident' : 'resident'}${ld && ld.drafter ? ', with its drafter' : ''}`);
    },
    async unload(model) { if (M.eng[model] && M.eng[model]._loaded) await M.eng[model].unload(); },
    async chat(model, messages, o) { const r = await M.eng[model].pipe.chat(messages, Object.assign({ maxTokens: o.maxTokens || 96 }, o.prefix ? { prefix: o.prefix } : {})); return { text: String(r.text || ''), tokens: r.tokens || 0 }; },
  };
}
function innerFake() {
  const f = fakeEngine(), resident = f.resident; let n = 0;
  const inject = async () => {
    n++; if (!FAIL || n !== +FAIL[2]) return;
    say(`(fake) injected at answer ${n}: ${FAIL[1]}`);
    if (FAIL[1] === 'error') throw Object.assign(new Error('(fake) the engine failed once'), { code: 'FAKE_ERROR' });
    if (FAIL[1] === 'lost') { setTimeout(() => gpuLost('fake'), 50); return new Promise(() => {}); }   // the device goes, the call never returns
    if (FAIL[1] === 'hang') return new Promise(() => {});   // the call never returns, nothing else happens
    if (FAIL[1] === 'freeze') { const t0 = Date.now(); while (Date.now() - t0 < 15 * 60e3) { /* the page's thread is blocked: only the driver can see it */ } }
  };
  return { async load(model) { await f.load(model); }, async unload(model) { await f.unload(model); }, async chat(model) { await inject(); if (!resident.has(model)) throw new Error(model + ' is not loaded'); return { text: 'ok', tokens: 0 }; } };   // no tokens: a fake run reports no speed
}
/** the engine the runner sees: ONE model on the GPU at a time (every other one leaves first), times in ms, the limits above */
function engineOf(inner) {
  M.inner = inner;
  const ms0 = () => performance.now();
  const chat = (model, messages, o = {}) => step(`an answer from ${model === 'big' ? 'the Bigger brain' : 'Juli'}`, model, async () => {
    const t0 = ms0(), r = await inner.chat(model, messages, o), ms = ms0() - t0;
    M.tokens[model] += r.tokens || 0; M.ms[model] += ms; return { text: r.text, ms };
  }, LIMIT.askS);
  return {
    async load(model) {
      if (model === 'flux') return 0;   // the person's render: its time is the mix's (no picture model is loaded here)
      return step(`loading ${model === 'big' ? 'the Bigger brain' : 'Juli'}`, model, async () => {
        const t0 = ms0();
        for (const k of FAKE ? ['e2b', 'big'] : Object.keys(M.eng)) if (k !== model && (M.live === k || (M.eng[k] && M.eng[k]._loaded))) { await inner.unload(k); M.live = null; say(`${k === 'big' ? 'Bigger brain' : 'Juli'} out first (one model on the GPU at a time)`); await sleep(LIMIT.settleMs); }
        await inner.load(model); M.live = model;
        const ms = ms0() - t0; if (M.loadMs[model]) M.loadMs[model].push(Math.round(ms));
        say(`${model === 'big' ? 'Bigger brain' : 'Juli'} loaded in ${(ms / 1000).toFixed(1)} s`); return ms;
      }, LIMIT.loadS);
    },
    async unload(model) {
      if (model === 'flux') return 0;
      return step(`unloading ${model}`, model, async () => { const t0 = ms0(); await inner.unload(model); if (M.live === model) M.live = null; return ms0() - t0; }, 60);
    },
    async ask(model, appId) {
      M.n++;
      if (model === 'big') {   // the real name-reference job: the fixture lane's facts, the Bigger brain's closed-schema answer
        const t0 = ms0(), name = NAMES[M.n % NAMES.length];
        const r = await runRef({ name, symbol: name.split(' ')[0].toUpperCase() }, { research: LANE, chat: async (messages, o) => (await chat('big', messages, o)).text });
        say(`Bigger brain · ${appId}: "${name}" -> ${r.status}${r.line ? ': ' + r.line : ''}`); return ms0() - t0;
      }
      const r = await chat('e2b', [{ role: 'system', content: `An app on this phone called "${appId}" asks a short question. Answer in at most three sentences. Never give financial advice.` }, { role: 'user', content: askOf(appId) }], { maxTokens: 96 });
      if (M.n % 5 === 0) say(`${M.n} answers so far (Juli ${M.ms.e2b ? (M.tokens.e2b / (M.ms.e2b / 1000)).toFixed(1) : '-'} tokens/s)`);
      return r.ms;
    },
    async chat() { return (await chat('e2b', [{ role: 'user', content: 'Give me one idea for a short walk this evening.' }], { maxTokens: 96 })).ms; },
  };
}

// ---- the run, its end (done, or ended early with what it measured), and the watchdog
const OUT = { seed: SEED, engine: FAKE ? 'fake' : 'real', fail: FAIL ? FAIL[0] : null, pack: FAKE ? null : PACK, models: { e2b: CFG.e2b, big: BIG.on ? CFG.big : 'off (big=0)' }, tune: TUNE, limits: LIMIT, ua: navigator.userAgent };
function finish(state, why) {
  if (SB.done) return;
  const out = Object.assign({}, OUT, { endedAt: new Date().toISOString(), failures: M.failures.slice(), loadMs: M.loadMs,
    tokPerS: { e2b: M.ms.e2b ? +(M.tokens.e2b / (M.ms.e2b / 1000)).toFixed(1) : null, big: M.ms.big ? +(M.tokens.big / (M.ms.big / 1000)).toFixed(1) : null, withTune: null, note: TUNE.note } });
  if (why) out.aborted = why;
  if (!out.sched && !out.naive && SB.partial) out.partial = SB.partial;
  const title = `Scheduler bench (${FAKE ? 'fake model' : 'real models'}${state !== 'done' ? ', ENDED EARLY' : ''}): ${MIX.apps.length} apps, ${MIX.hours} virtual hours, seed ${SEED}`;
  out.card = OUT.sched && OUT.naive ? card(OUT.sched, OUT.naive, title) : (OUT.sched || OUT.naive) ? cardOne(OUT.sched || OUT.naive, title) : SB.partial ? cardOne(SB.partial, title) : `## ${title}\n\nNothing measured yet.\n`;
  if (why) out.card += `\n**Ended early:** ${why}\n`;
  if (M.failures.length) out.card += `\nEngine failures: ${M.failures.map((f) => `${f.what} (${f.code || 'error'}: ${f.error})`).join('; ')}\n`;
  if (out.tokPerS.e2b || out.tokPerS.big) out.card += `\nReal answers: Juli ${out.tokPerS.e2b ?? '-'} tokens/s, the Bigger brain ${out.tokPerS.big ?? '-'} tokens/s (without the Speed tune: not in this tree).\n`;
  Object.assign(out, { sched: OUT.sched || null, naive: OUT.naive || null });
  SB.result = out; SB.state = state; SB.done = true;
  const c = $('sb-card'); if (c) c.textContent = out.card;
  say(state === 'done' ? 'done' : `ended early (${state}): ${why}`);
  try { dropAll(); } catch (e) { /* */ }
}
setInterval(() => {   // the watchdog: nothing moved for stallS seconds = the run ends with what it has (a blocked thread: the driver's guard)
  if (SB.state !== 'running') return;
  const idle = (Date.now() - M.lastMove) / 1000;
  if (idle > LIMIT.stallS) { const why = `nothing moved for ${Math.round(idle)} s (last: ${SB.log[SB.log.length - 1] || '-'})`; M.abort = why; finish('stalled', why); }
}, 5000);

// v4: the packs' server must honour HTTP Range requests (tools/serve.py does; Python's SimpleHTTPRequestHandler does not, and the engine
// then refuses every row read: NO_RANGE). Checked once before any model loads, so a wrong server says so at once
async function rangeOk(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-15' }, cache: 'no-store' });
    try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) { /* */ }
    return r.status === 206 ? '' : `the pack server answered ${r.status} to a byte range (it must honour HTTP Range requests: serve the packs with the tree's tools/serve.py --root <folder>)`;
  } catch (e) { return 'the pack server did not answer: ' + String((e && e.message) || e).slice(0, 120); }
}
async function run() {
  if (SB.state === 'running') return;
  SB.state = 'running'; SB.done = false; moved();
  say(`${MIX.apps.length} apps, ${MIX.hours} virtual hours, seed ${SEED}, ${FAKE ? 'a fake model (a check of the page)' + (FAIL ? ', failure ' + FAIL[0] : '') : 'the real models from ' + PACK}; one model on the GPU at a time; the Bigger brain ${BIG.on ? `with read-in chunk ${BIG.chunk}${BIG.drafter ? ' and its drafter' : ', no drafter'}` : 'off (its jobs wait)'}`);
  say(TUNE.note);
  if (!FAKE) { const no = await rangeOk(PACK + 'bal/manifest.json'); if (no) { finish('error', no); return; } say('the pack server honours byte ranges'); }
  let E;
  try { E = engineOf(FAKE ? innerFake() : await innerReal()); }
  catch (e) { finish('error', 'the engine did not start: ' + String((e && e.message) || e).slice(0, 200)); return; }
  try {
    for (const policy of POLICY === 'both' ? ['sched', 'naive'] : [POLICY]) {
      if (SB.done) return;
      say(`policy ${policy}: starting`); const p0 = performance.now();
      const r = await runMix({ policy, seed: SEED, engine: E, bigUsable: BIG.on, onStep: (s, f) => { SB.partial = Object.assign({ progress: Math.round(f * 100) }, s, { card: cardOne(s, `Partial (${policy}, ${Math.round(f * 100)} %)`) }); say(`policy ${policy}: ${Math.round(f * 100)} % of the virtual hours, ${s.checks} checks, ${s.asks.e2b + s.asks.big} answers`); } });
      if (SB.done) return;   // the watchdog ended it meanwhile
      r.realS = Math.round((performance.now() - p0) / 1000); OUT[policy] = r;
      if (r.aborted) { finish('error', r.aborted); return; }
      say(`policy ${policy}: done in ${r.realS} s real (${Math.round(r.virtualMs / 60e3)} virtual minutes, ${r.failures.length} engine failures)`);
      await dropAll();   // the next policy starts with no model on the GPU
    }
    finish('done');
  } catch (e) { finish('error', String((e && e.message) || e).slice(0, 300)); }
}
$('sb-go').addEventListener('click', run);
$('sb-what').textContent = `${MIX.apps.length} apps for ${MIX.hours} virtual hours, the person chatting about every ${MIX.chatEveryMin} minutes and one render; the v4 scheduler and 3.9's tick on the same mix. Sources are fixtures; only real model work takes real time; one model on the GPU at a time. Nothing is stored or agreed.`;
if (Q.get('bench') === 'scheduler' && Q.get('autostart') === '1') run();
