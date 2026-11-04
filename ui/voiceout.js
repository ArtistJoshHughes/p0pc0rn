// ui/voiceout.js - v4: the voice Juli answers with in voice mode, behind ONE small interface (load, speak, memoryBytes, unload).
// Her voice is p0pc0rn's own speech engine (Nov 3, Josh: "Juli sounds good. Maybe better than tts."): p0voice v3 (engine/p0voice/),
// speaker 0 = Juli, on the phone's GPU (WebGPU), 4 steps, her pace from the pack, the reply's mood tag as her style. Its pack (25 MB:
// the model, the lexicon, the letters-to-sounds model; P0_CONFIG.packs['p0voice-juli'], pinned like every pack) downloads by itself the
// first time voice mode speaks and is kept in OPFS (engine/p0voice-juli/pack; Settings › Models has its row: its size, Download, Delete,
// through createVoicePackEngine). CMU Flite's cmu_us_slt (games/trolley/voice/, the voice
// Troll-E's Juli keeps) is only the fallback, chosen by itself: no WebGPU, this build has no pack, her pack is still downloading (she
// switches to her own voice as soon as it is on the phone, at the next sentence), or her voice did not load. Both load only when voice
// mode asks and are let go when it ends; the GPUDevice her voice made stays (3.8: destroying a device after every unload ended with "The
// GPU was reset" after a dozen loads), its buffers go.
//   const v = createVoiceOut(); await v.load(); const { pcm, sampleRate, moods, text, voice } = await v.speak('[calm and cheerful]: Hello!'); v.unload();
// The mood tag (voice mode only): her reply starts with "[w1 and w2]:", every w from MOODS; it is never spoken or shown (splitMood). The
// talker gets her sentences without it, so wordsSoFar (app.js calls it on the whole reply as it streams) keeps the reply's moods here
// for her voice; setMood(null) at the start of a reply. Flite ignores the mood (neutral).
export const MOODS = ['neutral', 'calm', 'excited', 'teasing', 'smug', 'warning', 'sad', 'whisper', 'cheerful'];
export const P0VOICE_ID = 'p0voice-juli', P0VOICE_DIR = 'engine/p0voice-juli/pack';

/** "[calm and excited]: Morning!" -> { moods: ['calm', 'excited'], text: 'Morning!' }; no tag -> { moods: [], text } */
/** v4 (Josh's phone, Nov 2: "i do not have access…", "the capital of Australia is canberra."): a spoken turn's written answer with its
 *  sentence starts and a lone "i" in capitals (a backstop: the voice note asks for normal capitals; names it cannot know) */
export function fixCaps(s) {
  return String(s || '').replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bi(?=$|[\s,.!?;:]|'(?:m|ve|ll|d|s)\b|’(?:m|ve|ll|d|s)\b)/g, 'I');
}
/** a ZIP code said digit by digit ("ZIP 10001" -> "ZIP 1 0 0 0 1"), not as a number */
export const sayZip = (s) => String(s || '').replace(/\b(ZIP(?: code)?\s+)(\d{5})\b/gi, (m, a, z) => a + z.split('').join(' '));
export function splitMood(s) {
  const t = String(s || ''), m = /^\s*\[([^\]]{1,40})\]\s*:?\s*/.exec(t);
  if (!m) return { moods: [], text: t.trim() };
  const moods = m[1].toLowerCase().split(/\s*(?:\band\b|,|\+|&)\s*/).map((w) => w.trim()).filter((w) => MOODS.includes(w));
  return { moods, text: t.slice(m[0].length).trim() };
}
let MOOD = [];   // the moods of the reply being written (its tag, as wordsSoFar last saw it)
/** a reply still streaming in: the tag is complete (or there is none) -> the words so far; else null (the tag is still arriving) */
export function wordsSoFar(s) {
  const t = String(s || '').replace(/^\s+/, '');
  if (t.startsWith('[') && !/^\[[^\]]{0,40}\]/.test(t) && t.length <= 42) return null;
  const r = splitMood(t); MOOD = r.moods; return r.text;
}
/** a new reply (null: no mood until its tag arrives) or the moods to speak with */
export function setMood(moods) { MOOD = Array.isArray(moods) ? moods.filter((w) => MOODS.includes(w)) : []; }
export const currentMood = () => MOOD.slice();

const here = (f) => new URL(f, import.meta.url).href;
const fail = (code, message, extra) => Object.assign(new Error(message), { code }, extra || {});
let DEV = null, DL = null;
/** her voice's own GPUDevice, made once and kept (a lost device is made again) */
function voiceDevice() {
  if (!DEV) {
    const p = DEV = (async () => {
      const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!ad) throw fail('NO_WEBGPU', 'no WebGPU adapter');
      const d = await ad.requestDevice();
      d.lost.then(() => { if (DEV === p) DEV = null; });
      return d;
    })();
    p.catch(() => { if (DEV === p) DEV = null; });
  }
  return DEV;
}
/** her pack's download: one for the page's life, whether voice mode or Settings › Models started it (it goes on after voice mode ends;
 *  a page that closes picks it up where it stopped). o: {onProgress, signal} (Pause in Settings stops it for both) */
function fetchPack(store, o = {}) {
  if (!DL) {
    const d = DL = { on: new Set(), ctl: new AbortController(), p: null };
    d.p = store.download({ parallel: 2, signal: d.ctl.signal, onProgress: (x) => { for (const f of d.on) { try { f(x); } catch (e) { /* a row */ } } } })
      .finally(() => { if (DL === d) DL = null; remember(store); });
  }
  const d = DL;
  if (o.signal) { if (o.signal.aborted) d.ctl.abort(); else o.signal.addEventListener('abort', () => d.ctl.abort(), { once: true }); }
  if (!o.onProgress) return d.p;
  d.on.add(o.onProgress); return d.p.finally(() => d.on.delete(o.onProgress));
}
const packUrl = () => { const C = globalThis.P0_CONFIG; return (C && C.packs && C.packs[P0VOICE_ID]) || null; };
const LSK = 'p0pc0rn:voicepack';
/** her pack's status, kept for Settings › Models (no store is opened at boot to know it); emit: the app hears 'p0pc0rn:voicepack' */
function remember(s, emit = true) {
  let v = null;
  try { const r = s.status(); v = { complete: r.complete, haveBytes: r.have, totalBytes: r.total, packVersion: s.m.pack_version }; } catch (e) { return null; }
  try { localStorage.setItem(LSK, JSON.stringify(v)); } catch (e) { /* private browsing */ }
  if (emit) { try { globalThis.dispatchEvent(new CustomEvent('p0pc0rn:voicepack', { detail: v })); } catch (e) { /* no window */ } }
  return v;
}
let STORE = null;
/** ONE store for her pack for the page's life, opened once (its manifest checked against config.js): OPFS sync access handles are
 *  exclusive, so a second store's worker could not open the files the first one still held (desk: the pack "downloaded" again and
 *  failed with NoModificationAllowedError) */
function packStore(url) {
  if (!STORE || STORE.url !== url) {
    const S = { url, s: null, p: null };
    S.p = (async () => {
      const { WeightStore } = await import('../engine/core/store.js');
      const s = new WeightStore(null, { base: url, dir: P0VOICE_DIR });
      await s.open(); S.s = s; remember(s); return s;
    })();
    STORE = S; S.p.catch(() => { if (STORE === S) STORE = null; });   // offline before the first download: tried again next time
  }
  return STORE.p;
}
/** Settings › Models' row for her voice (app.js E.jvoice; null when this build has no pack): the same store and the same download as
 *  voice mode's own. Its status comes from what voice mode last saw (kept in localStorage); a phone that never saw it learns it once in
 *  the background. Delete frees the folder; voice mode downloads it again the next time she speaks */
export function createVoicePackEngine() {
  const url = packUrl(); if (!url) return null;
  const live = () => (STORE && STORE.url === url ? STORE.s : null);
  const known = () => { try { return JSON.parse(localStorage.getItem(LSK) || 'null'); } catch (e) { return null; } };
  return {
    state: 'idle', job: null, on() {}, off() {}, cancel() {}, unload() { return true; },
    async status() {
      const s = live(); if (s) return remember(s, false);
      const k = known(); if (k) return Object.assign({}, k, { cached: true });
      packStore(url).catch(() => {});   // learnt once in the background (the app hears it)
      return { complete: false, haveBytes: 0, totalBytes: 0, unknown: true };
    },
    async download({ onProgress, signal } = {}) {
      const s = await packStore(url);
      if (!s.status().complete) await fetchPack(s, { signal, onProgress: onProgress && ((p) => onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec,
        etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard })) });
      return remember(s, false);
    },
    async deleteModel() {
      if (DL) throw fail('BUSY', 'Her voice is downloading.');
      const s = await packStore(url); await s.remove(); remember(s, false); STORE = null;   // opened again (its manifest kept again) next time
    },
    requestPersistentStorage() { try { return navigator.storage.persist(); } catch (e) { return Promise.resolve(false); } },
  };
}

const BACKENDS = {
  /** p0voice (Juli v3) on WebGPU. o.wait: download her pack first if it is not on the phone (the bench); else that is a DOWNLOADING error
   *  carrying the download (e.dl), and Flite speaks meanwhile */
  p0voice: async (o = {}) => {
    const url = packUrl(); if (!url) throw fail('NO_PACK', 'this build has no pack for her voice');
    if (!(globalThis.navigator && navigator.gpu)) throw fail('NO_WEBGPU', 'no WebGPU');
    const t0 = performance.now();
    const device = await voiceDevice();   // first: no GPU here = no download
    const store = await packStore(url);   // the manifest is checked against config.js (engine/core/pin.js) before it is used
    if (!store.status().complete) {
      const dl = fetchPack(store);
      if (!o.wait) throw fail('DOWNLOADING', 'her voice is downloading', { dl });
      await dl; if (!store.status().complete) throw fail('NOT_DOWNLOADED', 'her voice did not download');
    }
    const t1 = performance.now();
    const [pack, lexicon, g2p] = await Promise.all(['p0voice.model', 'p0voice.lexicon', 'p0voice.g2p'].map((n) => store.readFile(n)));
    const t2 = performance.now();
    const { createP0Voice } = await import('../engine/p0voice/p0voice.js');
    // maxT 256 phonemes a clause (p0voice cuts a clause at 200 / pace = 179 for Juli), decode windows of 512 frames (a longer sentence is
    // decoded in windows with 40-frame margins): 37.5 MB of GPU memory on the desk, the defaults (512, 1024) 50.5 MB
    const cfg = { pack, lexicon, g2p, prefer: 'webgpu', gpu: { device }, maxT: 256, maxW: 512 }, v = createP0Voice(cfg);
    await v.load();
    cfg.pack = cfg.g2p = null;   // the voice keeps its config: without this the pack's 19 MB and the G2P's bytes stayed on the page (it never loads again: a new voice does)
    const jsBytes = lexicon.byteLength + 2 * g2p.byteLength;   // kept on the page: the lexicon as it is, the G2P's 16-bit weights as 32-bit
    const t3 = performance.now();
    await v.speak('Hi.', { seed: 1 });   // every kernel compiled now, not on her first sentence
    const t4 = performance.now(), R = (x) => Math.round(x);
    const timings = { ms: R(t4 - t0), openMs: R(t1 - t0), opfsMs: R(t2 - t1), loadMs: R(t3 - t2), warmMs: R(t4 - t3), load: v.loadTimings || null, pack: store.m.pack_version };
    return {
      kind: 'p0voice', name: 'p0voice Juli v3 (WebGPU)', timings,
      speak: async (text, moods) => { const r = await v.speak(text, { style: moods && moods.length ? moods : 'neutral', steps: 4 }); return { pcm: r.pcm, sampleRate: r.sampleRate, ms: r.ms }; },
      memoryBytes: () => v.memoryBytes() + jsBytes,
      end: () => { try { v.unload(); } catch (e) { /* the device was lost */ } },
    };
  },
  /** Flite in a module Worker (its WebAssembly never runs on the page; the page's CSP stays as it is) */
  flite: () => new Promise((resolve, reject) => {
    let w; try { w = new Worker(here('../games/trolley/voice_worker.js'), { type: 'module' }); } catch (e) { reject(e); return; }
    let id = 0, mem = 0; const pend = new Map(), t0 = performance.now(), t = setTimeout(() => { try { w.terminate(); } catch (e) { /* */ } reject(new Error('the voice did not start')); }, 30000);
    w.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.op === 'ready') { clearTimeout(t); resolve({ kind: 'flite', name: 'Flite cmu_us_slt', timings: { ms: Math.round(performance.now() - t0) }, speak, memoryBytes: () => mem, end: () => { try { w.terminate(); } catch (e) { /* */ } for (const p of pend.values()) p.rej(new Error('the voice was let go')); pend.clear(); } }); }
      else if (m.op === 'error') { clearTimeout(t); try { w.terminate(); } catch (e) { /* */ } reject(new Error(m.why || 'the voice did not load')); }
      else if (m.op === 'pcm') { const p = pend.get(m.id); if (!p) return; pend.delete(m.id); if (m.mem) mem = m.mem; m.error ? p.rej(new Error(m.error)) : p.res({ pcm: m.pcm, sampleRate: m.rate, ms: m.ms }); }
    };
    w.onerror = (e) => { clearTimeout(t); reject(new Error('the voice worker failed: ' + ((e && e.message) || 'error'))); };
    const speak = (text) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); w.postMessage({ op: 'speak', id: i, text }); });
    w.postMessage({ op: 'init', url: here('../games/trolley/voice/flite_voice.js') });
  }),
};
const whyOf = (e) => (e && e.code) || String((e && e.message) || e).slice(0, 100);

/** backend: 'auto' (her own voice, Flite as the fallback), 'p0voice' or 'flite' (only that one); wait: download her pack before the
 *  first load if it is missing (the bench); diag(message, data): one row per fallback.
 *  -> { name, kind, why, loaded, timings, load(), speak(text) -> Promise<{ pcm Float32Array, sampleRate, moods, text, ms, voice }>,
 *       memoryBytes(), unload() } */
export function createVoiceOut({ backend = 'auto', wait = false, diag = () => {} } = {}) {
  let b = null, pending = null, up = null, gen = 0, why = '';
  const retire = (x) => { if (!x) return; if (x.busy) x.retired = true; else x.end(); };
  /** her pack finished downloading while Flite speaks: her voice loads beside it and takes over at the next sentence */
  const upgrade = () => {
    if (!b && pending) { pending.then(() => upgrade(), () => {}); return; }   // Flite was still starting
    if (up || !b || b.kind !== 'flite') return;
    const g = gen;
    up = BACKENDS.p0voice({}).then((x) => {
      up = null;
      if (g !== gen || !b) { x.end(); return; }   // voice mode ended meanwhile
      const old = b; b = x; why = ''; retire(old); diag('voice: her own voice now', { ms: x.timings.ms });
    }, (e) => { up = null; why = whyOf(e); diag('voice: her own voice did not load', { why }); });
  };
  async function open() {
    if (backend !== 'auto') return BACKENDS[backend]({ wait });
    try { return await BACKENDS.p0voice({ wait }); }
    catch (e) {
      why = whyOf(e);
      if (e && e.dl) e.dl.then(() => upgrade(), (x) => diag('voice: her voice did not download', { why: whyOf(x) }));
      if (why !== 'NO_PACK') diag('voice: Flite for now', { why });
      return BACKENDS.flite();
    }
  }
  return {
    get name() { return b ? b.name : backend; },
    get kind() { return b ? b.kind : null; },
    /** why Flite speaks instead of her own voice ('' when she does): NO_PACK, NO_WEBGPU, DOWNLOADING, or the load error */
    get why() { return why; },
    get loaded() { return !!b; },
    get timings() { return b ? b.timings : null; },
    async load() {
      if (b) return true;
      if (!pending) { const g = gen; pending = open().then((x) => { pending = null; if (g !== gen) { x.end(); throw fail('UNLOADED', 'voice mode ended'); } b = x; return true; }, (e) => { pending = null; throw e; }); }
      return pending;
    },
    async speak(text) {
      if (!b) await this.load();
      const { moods: tagged, text: words } = splitMood(text), moods = tagged.length ? tagged : MOOD.slice(), cur = b;
      cur.busy = (cur.busy || 0) + 1;
      try {
        const r = words ? await cur.speak(words, moods) : { pcm: new Float32Array(0), sampleRate: 24000, ms: 0 };
        return { pcm: r.pcm, sampleRate: r.sampleRate, moods, text: words, ms: r.ms, voice: cur.name };
      } finally { cur.busy--; if (cur.retired && !cur.busy) cur.end(); }
    },
    memoryBytes() { return b && b.memoryBytes ? b.memoryBytes() : 0; },
    unload() { gen++; if (b) { retire(b); b = null; } },
  };
}
