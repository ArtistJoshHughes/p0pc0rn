// juli_link.js - the game's line to Juli's model, run by p0pc0rn's own engine (engine/llm/llm_engine.js). Her weights are the ones
// already downloaded in the app (OPFS: Juli's pocketllm/pack_bal and her drafter; the Bigger brain's pocketllm/e4b and its drafter); the
// game downloads nothing (its CSP reaches no other host). The game only READS the agreement made in the app's rights lesson: without it,
// Juli stays offline. connectJuli() -> { ok, why, backend, split, load }; backend.decide({ system, user, maxTokens, signal }) ->
// { text, prefillMs, genMs, tokens }. Any failure leaves the game exactly as it is without her ("Juli offline").
// v4 (Josh, Nov 1: "Juli sits in [the second process], the game in [the page]"): on iOS 27 Safari the game asks for its OWN layout, not
// the app's: as much of her model as fits in the app's second process (the shared worker sw.js serves with COEP), the page keeping only
// the embedding, the head and her drafter (GAME_SPLIT below; the app's own Juli keeps layers 0-12 there, unchanged). A WebKit page
// without that second process has no room for her beside the game: she stays offline there (no one-process fallback beside the game).
// Elsewhere (a desktop browser) one process, as before. The phone bench (bench.js) picks other split points through `splitAt`.
import { consent } from '../../rights.js';

const lsJSON = (k) => { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
const UA = (globalThis.navigator && navigator.userAgent) || '';
export const WEBKIT = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && globalThis.navigator && navigator.maxTouchPoints > 1) || (/Safari\//.test(UA) && !/Chrome\/|Chromium|Edg\/|Android/.test(UA));
const SAFARI = (() => { const m = /Version\/(\d+)/.exec(UA); return m ? +m[1] : 0; })();
/** the models the game can run her on: E2B (Juli's own) and the Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B), with their layer counts */
export const MODELS = {
  e2b: { id: 'gemma4-e2b', pack: 'gemma4-e2b', drafterPack: 'gemma4-e2b-drafter', cfg: 'assistantPack', dcfg: 'drafterPack', dir: 'pocketllm/pack_bal', ddir: 'pocketllm/drafter_q4h', layers: 35, appSplit: 13, kvOwn: [13, 14], name: 'Juli' },
  e4b: { id: 'bolt-e4b', pack: 'bolt-e4b', drafterPack: 'bolt-e4b-drafter', cfg: 'e4bPack', dcfg: 'e4bDrafterPack', dir: 'pocketllm/e4b', ddir: 'pocketllm/e4b_drafter', layers: 42, appSplit: 24, kvOwn: [22, 23], name: 'the Bigger brain' },
};
/** the game's layout on iOS 27: layers [0, GAME_SPLIT) in the second process. E2B: layers 0-20, the balanced one (v4, Nov 2: the
 *  layout that lived beside the game). E4B: its own split (its page share is the big one) */
export const GAME_SPLIT = { e2b: 21, e4b: 24 };
/** her page share per layout (MB, with the drafter) and her one retry's layout
 *  after her second process ended (main.js takes it only where the page has room for its share; else the same layout, a fresh engine) */
export const GAME_PAGE_MB = { e2b: { 35: 315, 29: 584, 21: 932, 13: 1265 } };
export const REVIVE_AT = { e2b: 13, e4b: null };
/** v4 (Nov 3): her prompt kept in her helper (the engine's prefix snapshot) ONLY behind this switch until the phone proves it: Josh's
 *  run with it on (0ae6463) lost the 0-20 and 0-28 helpers at load (SPLIT_UNAVAILABLE) and all 35's at her turns; the run before, with it
 *  off, kept all three. The game: off unless 'p0pc0rn:trolley:snapshot' is '1'; the bench runs the game's layout both ways */
export const SNAPSHOT_KEY = 'p0pc0rn:trolley:snapshot';
export const snapshotOn = () => lsJSON(SNAPSHOT_KEY) === 1;
/** her helper with its kept prompts stays under this (MB): above it the snapshot is skipped */
export const SNAP_HELPER_MAX_MB = 1150, SNAP_EXTRA_MB = 64;
/** can this page run a split (iOS 27 Safari with service workers and shared workers)? the app's own switch off for 3 days counts */
export function splitHere() {
  const off = lsJSON('pf.app.splitOff');
  return WEBKIT && SAFARI >= 27 && globalThis.navigator && 'serviceWorker' in navigator && typeof SharedWorker === 'function' && !(off && Date.now() - (+off.t || 0) < 3 * 864e5);
}
/** the engine's options for one model and layout (pure: the desk builds the same ones). drafter: null = on if the app's faster replies
 *  are on (pf.app.fasterOff not recorded with the split); split: whether this page splits */
export function engineOpts({ model = 'e2b', splitAt = null, drafter = null, split = splitHere(), webkit = WEBKIT, cfg = (globalThis.P0_CONFIG || {}) } = {}) {
  const M = MODELS[model] || MODELS.e2b, packs = cfg.packs || {}, at = Math.max(1, Math.min(M.layers, splitAt || GAME_SPLIT[model] || M.appSplit));
  const fo = lsJSON('pf.app.fasterOff'), dOn = drafter == null ? !(fo && (fo.split || !split)) : !!drafter;
  const o = { model: M.id, dir: (cfg[M.cfg] && cfg[M.cfg].dir) || M.dir, packUrl: packs[M.pack] || './pack/', source: 'opfs',
    drafter: dOn, drafterUrl: dOn ? packs[M.drafterPack] || null : null, drafterDir: (cfg[M.dcfg] && cfg[M.dcfg].dir) || M.ddir,
    split: split ? 'required' : false, splitFallback: false, reloadSettleMs: webkit ? 8000 : 0,
    modelOpts: model === 'e4b' ? { chunk: webkit ? 64 : 128 } : webkit && !split ? { chunk: 128 } : null };
  if (split) { o.splitAt = at; if (dOn) o.splitMirror = M.kvOwn.filter((l) => l < at); }   // the drafter's KV sources, mirrored when no page layer reads them
  return o;
}
/** v4: an engine let go of completely before a fresh one takes its place: its model unloaded, its storage worker's file handles closed
 *  and the worker ended (a fresh engine's sync access handles on the same pack files are refused while they are open: the desk, Nov 1),
 *  its GPU device destroyed */
export async function releaseEngine(e) {
  if (!e) return;
  try { e.cancel && e.cancel(); } catch (x) { /* */ }
  // (v4, Nov 3: its second process's end confirmed by the engine, 8acc293, before the next one starts: at most 16 s)
  try { await Promise.race([Promise.resolve(e.unload && e.unload()).catch(() => {}), new Promise((r) => setTimeout(r, 16000))]); } catch (x) { /* */ }
  try {
    const st = e.store && e.store.st;
    if (st && st.w) { await Promise.race([st.call('closeAll').catch(() => {}), new Promise((r) => setTimeout(r, 3000))]); try { st.w.terminate(); } catch (x) { /* */ } st.w = null; }
  } catch (x) { /* */ }
  try { if (e.gpu && e.gpu.device) e.gpu.device.destroy(); } catch (x) { /* */ }
}
/** what an engine error means for the game: the second process (or the GPU) is gone -> Juli goes offline, the game goes on */
export const helperGone = (e) => /^(SPLIT_GONE|SPLIT_RETRY|SPLIT_WORKER|GPU_LOST|SPLIT_FAILED|SPLIT_UNAVAILABLE)$/.test(String((e && e.code) || ''));

/** connectJuli({ onStatus, model, splitAt, drafter, ctxCap, onGone }) -> { ok, why, backend, split, load }. onGone(code): her second
 *  process (or GPU) ended mid-game: she is offline from then on unless backend.revive() brings her back (main.js: once, later, if the
 *  game's memory allows). WebKit without a second process: offline (her whole model beside the game ended the page, Nov 1) */
export async function connectJuli({ onStatus = () => {}, model = 'e2b', splitAt = null, drafter = null, ctxCap = model === 'e4b' ? 2048 : 1536, onGone = () => {}, snapshot = false, onProgress = null } = {}) {   // v4: 1,536 (her open-world prompt and state are ~1,000 tokens)
  let eng = null;
  try {
    if (!consent()) return { ok: false, why: 'agree in p0pc0rn first' };
    if (!globalThis.navigator || !navigator.gpu) return { ok: false, why: 'no WebGPU here' };
    const split = splitHere();
    if (WEBKIT && !split) return { ok: false, why: SAFARI && SAFARI < 27 ? 'needs iOS 27 (its second process)' : 'no second process here (the game has no room for her beside it)' };
    const { createEngine } = await import('../../engine/llm/llm_engine.js');
    const opts = engineOpts({ model, splitAt, drafter, split });
    eng = await createEngine(opts);
    if (!eng.capabilities().supported) return { ok: false, why: 'this GPU cannot run her' };
    if (!(await eng.status()).complete) return { ok: false, why: model === 'e4b' ? 'the Bigger brain is not downloaded (get it in p0pc0rn)' : 'not downloaded (get Juli in p0pc0rn)' };
    onStatus('loading');
    const mode = model === 'e2b' && lsJSON('pf.app.brainMode') === 'lean' && !split ? 'lean' : 'resident';
    const t0 = performance.now(); const L = await eng.load({ mode, ctxCap, onProgress: onProgress || undefined });   // (v4, Nov 3: its progress, so a page that ends in the load says how far it got)
    // v4 (Nov 3): how long this load waited for earlier second processes to close, and the ones this page knows of
    const sp = eng.pipe && eng.pipe.split, before = sp && sp.info ? sp.info.before || null : null, helpers = eng.splitHelpers ? eng.splitHelpers() : null;
    const load = { before, helpers, s: +((performance.now() - t0) / 1000).toFixed(1), at: L.split ? L.split.at : null, pageMB: L.split ? L.split.pageMB : L.residentMB, helperMB: L.split ? L.split.workerMB : 0, drafter: !!L.drafter, drafterError: L.drafterError || null, model };
    onStatus('warming up');
    // her one retry gets a FRESH engine (its own GPU device and buffers: nothing kept from the one whose second process ended; the desk,
    // Nov 1: a reload into the same engine after its worker part was gone decoded from a stale position)
    const remake = async (old, o = {}) => { await releaseEngine(old); const e2 = await createEngine(o.splitAt ? engineOpts({ model, splitAt: o.splitAt, drafter, split }) : opts); const L2 = await e2.load({ mode, ctxCap }); return { eng: e2, L: L2 }; };   // (v4: o.splitAt: her retry's own layout)
    const backend = makeBackend(eng, { model, load, mode, ctxCap, onGone, remake, snapshot });
    const t1 = performance.now();
    await backend.ping();   // the first read-in builds the pipelines (slow once)
    load.warmS = +((performance.now() - t1) / 1000).toFixed(1);
    addEventListener('pagehide', backend.close);
    return { ok: true, backend, split: !!(L && L.split), load };
  } catch (e) {
    try { eng && eng.unload(); } catch (x) { /* */ }
    // v4 (Nov 3): the code AND its message ("SPLIT_UNAVAILABLE: no second process here: …"): the card says why, never the code alone
    return { ok: false, why: (e && e.code ? `${e.code}: ${String(e.message || '').slice(0, 200)}` : String((e && e.message) || e).slice(0, 220)), code: (e && e.code) || null };
  }
}

/** her backend over a loaded engine (the desk builds the same one over the engine's pipeline): decide() for her turns; her second
 *  process watched by its heartbeat (lworker.js beats every second: none for 4 s while this page is in front = it ended), and any
 *  engine error that says it ended: then she is offline (ready() false, the engine unloaded, onGone(code) once) and the game goes on.
 *  revive(): ONCE per page, her model loaded again (a fresh second process); a second failure leaves her offline for good */
export function makeBackend(eng, { model = 'e2b', load = {}, mode = 'resident', ctxCap = 1024, onGone = () => {}, now = () => performance.now(), beatMs = 4000, remake = null, snapshot = false } = {}) {
  let peak = 0, dead = null, revived = 0, visSince = now(), watch = null, cur = null, last = null, inflight = 0, lastTick = now();
  const chat = (msgs, o) => { inflight++; cur = Promise.resolve(eng.chat ? eng.chat(msgs, o) : eng.pipe.chat(msgs, o)); cur.then(() => { inflight--; }, () => { inflight--; }); return cur; };
  // v4 (Nov 3): her prompt's fixed start (the system turn) is read in once and kept in her helper (the engine's prefix snapshot,
  // eed8c76): her turns read in only her state, which comes last. page: false = nothing kept on the page; the helper ~15 MB a 1,000-token start
  // (3: Level 1's prompt, the open world's, the stack game's). helperCapMB is the helper's WHOLE GPU memory with its kept starts (the
  // engine's cap; 64 alone kept nothing): her helper's own size + SNAP_EXTRA_MB
  const KEEP = { page: false, helperCapMB: Math.round((+load.helperMB || 0) + SNAP_EXTRA_MB), max: 3 };
  // the switch, and her helper's own size: with the cap it must stay under SNAP_HELPER_MAX_MB, else no snapshot
  const snapWhy = !snapshot ? 'off' : (+load.helperMB || 0) + SNAP_EXTRA_MB > SNAP_HELPER_MAX_MB ? `her helper ${load.helperMB} MB + ${SNAP_EXTRA_MB} would pass ${SNAP_HELPER_MAX_MB}` : null;
  const keepOpt = () => (snapWhy ? {} : { keepPrefix: KEEP });
  const run = async (system, user, maxTokens, signal) => {
    const r = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], Object.assign({ maxTokens, prefix: '{', signal, decodeStats: {} }, keepOpt()));
    peak = Math.max(peak, r.peakMB || 0);
    const c = String((r.reply && r.reply.content) || r.text || '').trimStart();
    const sn = r.snapshot || null;
    const o = { text: c.startsWith('{') ? c : '{' + c, prefillMs: ((r.timings && r.timings.prefill) || 0) * 1000, genMs: ((r.timings && r.timings.decode) || 0) * 1000, tokens: r.tokens || 0, promptTokens: r.promptTokens || 0,
      snap: sn ? { hit: !!sn.hit, partial: !!sn.partial, P: sn.P || 0, readIn: sn.readIn != null ? sn.readIn : null, why: sn.why || null } : null };
    if (maxTokens > 8) last = o;   // a real turn (not the warm-up ping): her speeds for limitMs()
    return o;
  };
  const die = (code) => {
    if (dead) return; dead = { code: code || 'SPLIT_GONE', at: Date.now() };
    try { eng.cancel && eng.cancel(); } catch (e) { /* */ }
    const unload = () => { try { if (dead) eng.unload(); } catch (e) { /* */ } };
    if (cur) cur.then(unload, unload); else unload();   // after the answer in flight has stopped (never under it)
    try { onGone(dead.code); } catch (e) { /* */ }
  };
  const wk = () => (eng.pipe && eng.pipe.split && eng.pipe.split.wk) || null;
  const beat = () => {
    // v4 (Nov 3): a page that itself stalled (its own timer late by 2.5 s: a long frame, the physics) has not read the heartbeats queued
    // for it yet: no verdict this round (her helper 'ended' in the stack game on Josh's phone; a stalled page could look like that)
    const lag = now() - lastTick; lastTick = now(); if (lag > 2500) { visSince = now(); return; }
    if (dead || (typeof document !== 'undefined' && document.hidden)) { visSince = now(); return; }
    const w = wk(); if (!w) return;
    if (w.gone || w.closed) return die('SPLIT_GONE');
    if (w.lastHb != null && now() - visSince > 2000 && now() - w.lastHb > beatMs) die('SPLIT_GONE');   // no heartbeat while in front
  };
  const arm = () => { if (!watch && typeof setInterval === 'function') { watch = setInterval(beat, 1000); if (watch && watch.unref) watch.unref(); } };
  arm();
  const B = {
    model, load,
    /** false while her second process is gone (the game skips her turns; nothing waits) */
    ready: () => !dead,
    decide: async ({ system, user, maxTokens = 72, signal }) => {
      if (dead) throw Object.assign(new Error('Juli is offline'), { code: 'OFFLINE' });
      // v4 (Nov 2): one answer at a time: a turn the game stopped waiting for still runs in the engine; the next waits for it (two at
      // once broke the speculative decode on the desk)
      if (cur) { await cur.catch(() => {}); if (dead) throw Object.assign(new Error('Juli is offline'), { code: 'OFFLINE' }); }
      if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' });
      try { return await run(system, user, maxTokens, signal); }
      catch (e) { if (helperGone(e)) die(e.code); throw e; }
    },
    ping: () => run('Answer with a JSON object.', '{"ping":1}', 6),
    /** v4 (Nov 3): her prompt's fixed start read in and kept ahead of her first turn (no answer) -> its snapshot, or null */
    snapshot: () => (snapWhy ? { on: false, why: snapWhy } : { on: true }),
    warm: async (system) => { if (dead || !system || snapWhy) return null; try { const r = await chat([{ role: 'system', content: system }, { role: 'user', content: '{}' }], { maxTokens: 1, keepPrefix: KEEP, prefixOnly: true }); return (r && r.snapshot) || { why: 'no snapshot in the answer' }; } catch (e) { return { error: `${e.code || ''} ${String(e.message || e).slice(0, 160)}`.trim() }; } },
    /** v4: an answer in the engine now; how long since her helper's last heartbeat (ms; null: no helper) */
    busy: () => inflight > 0, hbAge: () => { const w = wk(); return w && w.lastHb != null ? Math.round(now() - w.lastHb) : null; },
    /** her second process's memory now (MB), null once it ended; one process: { mb: 0, one: true } */
    alive: async () => {   // (v4, Nov 2: at most 3 s: a helper that does not answer is not alive, and nothing waits on it)
      if (dead) return null; const sp = eng.pipe && eng.pipe.split; if (!sp) return { mb: 0, one: true };
      try { const s = await Promise.race([sp.stats(), new Promise((r) => setTimeout(() => r(null), 3000))]); return s && !s.none ? { mb: s.aliveMB, peakMB: s.peakMB } : null; } catch (e) { return null; }
    },
    gone: () => dead,
    /** v4: how long the game gives her answer: what her last turn's read-in took plus 72 tokens at her last turn's speed, with a
     *  quarter to spare, 3-7 s (before any turn: 7 s). She never blocks the game either way; her answer is checked against the hall as
     *  it is when it arrives */
    // v4 (Nov 2: on Josh's phone at 0-20 her answers took 6.6 s median, 7.7 s p90: most of it the read-in): her window is her own read-in
    // and an answer half again as long as her last (not the token cap), at most 9 s (her turns come 8 s apart: a slow one costs a turn)
    limitMs: (maxTokens = 72) => { if (!last || !last.genMs || last.tokens < 2) return 9000; const per = last.genMs / Math.max(1, last.tokens - 1), n = Math.min(maxTokens, Math.max(24, Math.round(last.tokens * 1.5))); return Math.round(Math.max(3000, Math.min(9000, 1.25 * (last.prefillMs + n * per) + 300))); },
    /** ONCE: a fresh second process and her model again (the engine's own load) -> true when she is back */
    revive: async (o = {}) => {   // o.splitAt: the retry's layout (main.js: REVIVE_AT where the page has room)
      if (!dead || revived >= 1) return false; revived++;
      try {
        const t2 = now(); let L;
        if (remake) { const r = await remake(eng, o); eng = r.eng; L = r.L; }
        else L = await eng.load({ mode, ctxCap });
        load.reloadS = +((now() - t2) / 1000).toFixed(1); if (L && L.split) { load.pageMB = L.split.pageMB; load.helperMB = L.split.workerMB; load.at = L.split.at; } dead = null; await B.ping(); return true; }
      catch (e) { dead = { code: (e && e.code) || 'LOAD', why: String((e && e.message) || e).slice(0, 160), at: Date.now() }; try { eng.unload(); } catch (x) { /* */ } return false; }
    },
    get revives() { return revived; },
    memory: () => `${load.at ? `page ${load.pageMB} + helper ${load.helperMB} MB (layers 0-${load.at - 1} there)` : 'one process'}${load.drafter ? ' · drafter' : ''}${dead ? ' · OFFLINE (' + dead.code + ')' : ''} · peak ${Math.round(peak)} MB`,
    // v4 (Nov 3): -> the engine's confirmed close of her second process ({ closed, ms } from 8acc293; { closed: false, why } if it
    // timed out or there was none)
    close: () => { if (watch) clearInterval(watch); watch = null; try { eng.cancel && eng.cancel(); } catch (e) { /* */ } let p = null; try { p = eng.unload(); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then((r) => r || { closed: false, why: 'no second process' }, (e) => ({ closed: false, why: e && e.code === 'SPLIT_CLOSE_TIMEOUT' ? 'unconfirmed after 15 s' : String((e && (e.code || e.message)) || e).slice(0, 80) })); },
    _beat: beat,
  };
  return B;
}
