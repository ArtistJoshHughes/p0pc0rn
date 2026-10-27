// p0pc0rn LLM engine entry: createEngine({model:'gemma4-e2b'}) with the same download / progress / cancel / error / events conventions
// as the image + video engine (docs/ENGINE_API.md), plus chat() and unload().  Standalone (keeps the shared engine.js byte-identical);
// reuses core/gpu.js + core/store.js + llm/llm.js.  The LLM is loaded only for a chat job and unloaded after (Josh's one-model queue).
// 0.2 (p0pc0rn 3.8): the decode loop records each token while the GPU runs the one before, the prompt read-in runs its attention as
// GEMMs and reads the next chunk ahead, and an optional add-on, Google's Gemma 4 E2B MTP drafter (its own small pack and OPFS folder:
// drafterStatus / downloadDrafter / deleteDrafter), makes greedy answers faster when it is on the phone. The answers' words are the
// same with and without it: every token is still the assistant's own choice (engine/llm/spec.js). Sampled answers (temperature /
// topP / topK up to 64) use it too: speculative sampling keeps their distribution (engine/llm/lops_samp.js); if this GPU cannot run
// it, the answer carries samplingError and is sampled the plain way.
'use strict';
import { createGpu } from '../core/gpu.js';
import { WeightStore } from '../core/store.js';
import { LLMPipeline } from './llm.js';
import { ensureServiceWorker, connectWorker, hiddenSince, splitFailure } from './split.js';   // 3.8 port: + what an ended second process means
import { GemmaTokenizer } from './tokenizer.js';
import { renderChat } from './chat_template.js';
import { setKX } from './lopsx.js';   // 3.8 (bench v041)
import { dropAB } from './gemma4.js';   // 3.9 (E4B room)
/** 3.9 (E4B room): a weight store's idle upload staging, given back at once (not left for the garbage collector) */
const dropStaging = (st) => { if (st && Array.isArray(st.pool)) { for (const b of st.pool) dropAB(b); st.pool.length = 0; } };

export const LLM_VERSION = '0.2';
// 3.8: split = the layer a split load starts the page's part at (engine/llm/split.js: layers [0, split) run in a second process on
// iOS 27); vision: picture questions; ctxCap / chunk: the context and the read-in's chunk the model loads with unless the app says.
// 'bolt-e4b' = NVIDIA Nemotron 3.5 Bolt E4B (a Gemma 4 E4B post-train, OpenMDW-1.1; text only), with Google's Gemma 4 E4B MTP drafter.
export const LLM_MODELS = {
  'gemma4-e2b': { arch: 'gemma4-text', kind: 'chat', dir: 'pocketllm/pack', running: 'pocketllm:running', wipe: ['pocketllm/pack'], drafterDir: 'pocketllm/drafter', split: 13, vision: true },
  'bolt-e4b': { arch: 'gemma4-text', kind: 'chat', dir: 'pocketllm/e4b', running: 'pocketllm:running', wipe: ['pocketllm/e4b'], drafterDir: 'pocketllm/e4b_drafter', split: 24, vision: false, ctxCap: 2048, chunk: 128,
    spec: { specK: 2 } },   // its drafter: k 2 fixed (the iPhone's best for E4B: bench v036-v038); 3.9 (E4B room): split 24 (3.8: 23): layers 22 and 23's KV mirrored (split.js)
};
// 3.8 (v040 speed round): the Bigger brain's verify passes may take PROMPT LOOKUP drafts (split.js specLoop: the answer's last 4..3 tokens
// seen earlier in the prompt or the answer -> the tokens that followed them are the next pass's drafts; the target checks every one; the
// phone bench v038: +16% on JSON copying). Juli's own drafter already copies (no gain there).
LLM_MODELS['bolt-e4b'].spec = Object.assign({}, LLM_MODELS['bolt-e4b'].spec, { pld: null });   // 3.8 port: prompt lookup OFF (night bench 10-24/25: never faster, slower on json and mid; the same words)
const err = (code, m) => { const e = new Error(m); e.code = code; return e; };
// 3.8: the split's files: the service worker at the app's root (sw.js) and the worker part it serves with COEP require-corp
const SW_URL = new URL('../../sw.js', import.meta.url), SW_SCOPE = new URL('../../', import.meta.url), WORKER_URL = new URL('./lworker_coep.js', import.meta.url);
let SPLIT_OK = null;
/** 3.8: can this page split a model (iOS 27's second process)? the service worker up, then a worker part that it served -> { ok, why,
 *  coep, isolated } (once per page) */
export function splitAvailable() {
  if (!SPLIT_OK) SPLIT_OK = (async () => {
    const sw = await ensureServiceWorker(SW_URL, SW_SCOPE); if (!sw.ok) return { ok: false, why: sw.why };
    const wk = await connectWorker(WORKER_URL, 'p0split-check-' + Date.now().toString(36), { timeoutMs: 15000 }), h = wk.hello || {}; wk.close();
    return h.coep === 'require-corp' ? { ok: true, why: '', coep: h.coep, isolated: !!h.isolated } : { ok: false, why: 'the worker part did not come from the service worker', coep: h.coep || null };
  })().catch((e) => ({ ok: false, why: String((e && e.message) || e).slice(0, 200) }));
  return SPLIT_OK;
}
const abortErr = () => { const e = new Error('cancelled'); e.name = 'AbortError'; e.code = 'ABORTED'; return e; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
if (LS('p0pc0rn:test:kx') === '0') setKX(false);   // 3.8 (bench v041): test switch = the engine's own kernels everywhere
// 3.9 (E4B room): ONE tokenizer per page for identical tokenizer files (Juli's pack and the Bigger brain's ship the same Gemma 4
// vocabulary, the same sha256): the router's countTokens and every load share it, instead of one per engine plus one per loaded model
// (~14 MB of JS memory each on an iPhone page: its 9.5 MB file and a 4 MB merge table)
const TOKRS = new Map();   // '<tokenizer sha256>|<meta sha256>' -> Promise<GemmaTokenizer>

export async function createEngine(opts = {}) { const e = new LLMEngine(opts); await e._init(); return e; }

class LLMEngine {
  constructor(opts) {
    // drafterUrl / drafterDir: the drafter add-on's pack and OPFS folder (none = no add-on); drafter: false turns the add-on off
    // 3.8: split: true = layers [0, LLM_MODELS[model].split) in a second process when the service worker serves it (iOS 27), else
    // SPLIT_FAILED (nothing loaded: the app chooses what next); 'required' = SPLIT_UNAVAILABLE instead (a model that needs it)
    this.opts = Object.assign({ model: 'gemma4-e2b', packUrl: './pack/', source: 'opfs', powerPreference: undefined, drafter: true, split: false }, opts);
    this.reg = LLM_MODELS[this.opts.model]; if (!this.reg) throw err('UNSUPPORTED', 'unknown model ' + this.opts.model);
    this.listeners = new Map(); this.job = null; this.state = 'idle'; this.gpu = null; this.pipe = null; this._loaded = false;
  }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  emit(n, d) { (this.listeners.get(n) || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } }); }
  _setState(s) { this.state = s; this.emit('state', { state: s }); }

  async _init() {
    const c = { supported: false, reason: '', gpu: '', subgroups: false, maxBufferMB: 0, storageQuotaGB: 0, persisted: false };
    try {
      if (!navigator.gpu) c.reason = 'needs iOS 26 Safari (or another browser) with WebGPU';
      else {
        const ad = await navigator.gpu.requestAdapter(this.opts.powerPreference ? { powerPreference: this.opts.powerPreference } : undefined);
        if (!ad) c.reason = 'no WebGPU adapter';
        else {
          const i = ad.info || {}; c.gpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' '); c.subgroups = ad.features.has('subgroups');
          c.maxBufferMB = Math.round(ad.limits.maxBufferSize / 1048576);
          if (!ad.features.has('shader-f16')) c.reason = 'this GPU has no 16-bit float shaders';
          else if (ad.limits.maxBufferSize < 256 * 1048576) c.reason = 'GPU buffers are too small';
          else c.supported = true;
        }
      }
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); c.storageQuotaGB = +((e.quota || 0) / 1e9).toFixed(1); }
      if (navigator.storage && navigator.storage.persisted) c.persisted = await navigator.storage.persisted();
    } catch (e) { c.reason = String(e && e.message || e); }
    this.caps = c;
    this.store = new WeightStore(null, { base: this.opts.packUrl, dir: this.opts.dir || this.reg.dir, source: this.opts.source });   // dir: one OPFS folder per pack variant
    // 3.8: the drafter add-on: its own pack + OPFS folder, on the same storage worker (one worker, one set of file handles)
    this.dstore = this.opts.drafterUrl && this.opts.drafter !== false
      ? new WeightStore(null, { base: this.opts.drafterUrl, dir: this.opts.drafterDir || this.reg.drafterDir, source: this.opts.source, storage: this.store.st }) : null;
  }
  capabilities() { return Object.assign({}, this.caps); }
  async requestPersistentStorage() { try { const p = await navigator.storage.persist(); this.caps.persisted = p; return p; } catch (e) { return false; } }
  models() { return [{ id: this.opts.model, kind: this.reg.kind, installed: this._loaded }]; }
  /** 3.8: Juli goes on in one process from now on in this engine (no second process here): no faster replies (iOS 27 has no room for
   *  both) and the one-process model settings (opts.oneProcessOpts: WebKit's 128-token read-in) */
  _oneProcess(why) {
    this.opts.split = false; this.opts.drafter = false;
    if (this.opts.oneProcessOpts) this.opts.modelOpts = Object.assign({}, this.opts.modelOpts || {}, this.opts.oneProcessOpts);
    this.emit('split', { off: true, why });
  }
  /** 3.8: a prompt's length in tokens without loading the model or the GPU (the pack's own tokenizer; the router fits the Bigger
   *  brain's 2,048-token prompts with it). A picture counts as its placeholder only. */
  async countTokens(messages, { tools, prefix, thinking } = {}) {
    if (!this._tokr) this._tokr = this._sharedTok().catch((e) => { this._tokr = null; throw e; });   // 3.9 (E4B room): the page's one tokenizer
    const tok = await this._tokr;
    return tok.encode(renderChat(messages, { tools, enableThinking: !!thinking, addGenerationPrompt: true }) + (prefix || '')).length;
  }
  /** 3.9 (E4B room): this pack's tokenizer, shared by every engine on the page whose pack has the same tokenizer files (their sha256 in
   *  the manifest); a pack that lists none gets its own */
  async _sharedTok() {
    await this._open(); if (!this.store.http) await this.store.st.start();
    const sha = (n) => { const s = (this.store.m.shards || []).find((x) => x.name === n); return (s && s.sha256) || ''; };
    const key = sha('tokenizer.tokenizer') && sha('tokenizer.tokenizer_meta') ? sha('tokenizer.tokenizer') + '|' + sha('tokenizer.tokenizer_meta') : null;
    if (key && TOKRS.has(key)) return TOKRS.get(key);
    const p = (async () => {
      const b = await this.store.readFile('tokenizer.tokenizer'), mm = await this.store.readFile('tokenizer.tokenizer_meta');
      return new GemmaTokenizer(b, JSON.parse(new TextDecoder().decode(mm)));
    })();
    if (key) { TOKRS.set(key, p); p.catch(() => { if (TOKRS.get(key) === p) TOKRS.delete(key); }); }
    return p;
  }
  async _open() { if (!this.store.m) await this.store.open(); return this.store; }
  async status() { await this._open(); const s = this.store.status(); return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.store.m.pack_version }; }

  async download(o = {}) { return this._download(() => this._open(), () => this.status(), o); }
  /** one pack's download (the assistant's or the drafter's): one at a time per engine, progress throttled to 4 a second */
  async _download(open, status, { onProgress, signal, parallel } = {}) {
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      const st = await open(); let last = 0;
      await st.download({ signal, parallel, onProgress: (p) => { const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard }); } });
      return await status();
    } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; } finally { this._setState('idle'); }
  }
  async deleteModel() {
    await this._open(); if (!this.store.http) { await this.store.st.start(); await this.store.st.call('remove', { name: this.store.dir }); }   // only this pack variant's folder
    this.store.state = { pack_version: this.store.m.pack_version, done: {} }; this._loaded = false;
  }

  // ---- 3.8: the drafter add-on (ENGINE_API.md section 9). It is used by load() when it is on the phone; nothing else changes.
  /** true when this engine has a drafter add-on (an address in config.js, and not turned off) */
  hasDrafter() { return !!this.dstore; }
  async _dopen() { if (!this.dstore) throw err('UNSUPPORTED', 'This assistant has no drafter.'); if (!this.dstore.m) await this.dstore.open(); return this.dstore; }
  async drafterStatus() { const d = await this._dopen(), s = d.status(); return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: d.m.pack_version }; }
  async downloadDrafter(o = {}) { return this._download(() => this._dopen(), () => this.drafterStatus(), o); }
  async deleteDrafter() {
    const d = await this._dopen();
    if (this.pipe && this.pipe.model && this.pipe.model.releaseDrafter) this.pipe.model.releaseDrafter();
    if (!d.http) { await d.st.start(); await d.st.call('remove', { name: d.dir }); }   // only the drafter's folder
    d.state = { pack_version: d.m.pack_version, done: {} };
  }

  async _gpu() {
    if (this.gpu && !this.gpu.lost) return this.gpu;
    this.gpu = await createGpu({ powerPreference: this.opts.powerPreference || 'high-performance', onLost: () => this.emit('gpu-lost', {}) });
    this.gpu.rate = { mm: 0.2e12, attn: 0.08e12, mem: 20e9 };
    return this.gpu;
  }
  /** load the brain (resident by default). onProgress fires during the weight upload. */
  async load({ mode = 'resident', ctxCap, onProgress } = {}) {
    if (this.pipe) { try { this.unload(); } catch (e) { /* */ } }   // 3.8: never two loads' memory at once
    // 3.8: right after an unload, wait until opts.reloadSettleMs have passed (WebKit gives destroyed GPU memory back late)
    const wait = (this.opts.reloadSettleMs || 0) - (performance.now() - (this._unloadedAt == null ? -1e12 : this._unloadedAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await this._open(); if (!this.store.status().complete) throw err('NOT_DOWNLOADED', 'Download the model first.');
    if (!this.store.http) await this.store.st.start();
    const g = await this._gpu(); this.store.gpu = g;
    // 3.8 (iOS 27): the split (engine/llm/split.js). The context and the read-in's chunk: the registry's unless the caller says
    const reg = this.reg, cap = ctxCap || reg.ctxCap || 4096, chunk = (this.opts.modelOpts && this.opts.modelOpts.chunk) || reg.chunk || 256;
    let split = null;
    if (this.opts.split && reg.split > 0) {
      const why = this.store.http ? "the split reads the pack from this device's storage" : (await ensureServiceWorker(SW_URL, SW_SCOPE)).why;
      if (!why) split = { at: this.opts.splitAt || reg.split, chunk, workerUrl: WORKER_URL };   // splitAt: tests
      else if (this.opts.split === 'required' || !this.opts.splitFallback) throw err(this.opts.split === 'required' ? 'SPLIT_UNAVAILABLE' : 'SPLIT_FAILED', `no second process here: ${why}`);
      else this._oneProcess(`no second process here: ${why}`);   // Juli: one process, no faster replies
    }
    this.pipe = new LLMPipeline({ gpu: g, store: this.store, emit: (n, d) => this.emit(n, d) });
    try { this.pipe.tok = await this._sharedTok(); } catch (e) { /* the pipeline reads its own */ }   // 3.9 (E4B room): the page's one tokenizer
    let r;
    try { r = await this.pipe.load({ mode, ctxCap: cap, onProgress, split }); }
    catch (e) {
      if (e && e.code === 'SPLIT_FAILED') {   // nothing stays loaded; the app chooses (Juli: one process without faster replies)
        try { this.pipe.unload(); } catch (x) { /* */ } this.pipe = null;
        if (this.opts.split === 'required') throw err('SPLIT_UNAVAILABLE', e.message);
        if (this.opts.splitFallback) {   // Juli: one process WITHOUT faster replies (iOS 27 has no room for both), from now on in this engine
          this._oneProcess(e.message);
          return this.load({ mode, ctxCap, onProgress });
        }
      }
      throw e;
    }
    // 3.8: the drafter rides along with fully resident weights when it is on the phone (the lighter, part-streamed load decodes step by
    // step and does not use it). Anything that goes wrong here only means plain decoding: same words, no error.
    r.drafter = false;
    const m = this.pipe.model;
    const mo = Object.assign(reg.chunk ? { chunk: reg.chunk } : {}, split ? { prefillInFlight: 1, prefillRingSync: true } : {}, this.opts.modelOpts || {});   // 3.8 port (bench v045): a split read-in reuses its bind groups   // 3.8: the registry's, then the app's model settings
    if (Object.keys(mo).length) m.opts = Object.assign({}, m.opts, mo);   // (WebKit: the read-in's chunk)
    if (this.dstore && this.opts.drafter !== false && !(m.streamedMlp && m.streamedMlp.length)) {   // 3.8: the app can turn it off after creation (opts.drafter)
      try {
        const d = await this._dopen();
        if (d.status().complete) {
          d.gpu = g; await m.loadDrafterFrom(d);
          m.opts = Object.assign({}, m.opts, reg.spec || { specAdaptive: true });   // engine/llm/spec.js: k chosen per pass from the measured costs (E4B: k 2)
          r.drafter = true; r.drafterMB = Math.round(m.drafter.bytes / 1e6);
        }
      } catch (e) {
        try { m.releaseDrafter(); } catch (x) { /* nothing was loaded */ }
        r.drafterError = String((e && e.message) || e).slice(0, 200); this.emit('drafter', { error: r.drafterError });
      }
    }
    // 3.9 (E4B room): the upload staging goes once the weights are in (the store keeps up to three 16 MiB ArrayBuffers per pack for the
    // next upload: 67 MB the Bigger brain's page held for nothing while it answered, counted by iOS against the page), given back at once
    dropStaging(this.store); dropStaging(this.dstore);
    if (this.pipe.split) { const i = this.pipe.split.info || {}; r.split = { at: this.pipe.model.l0, mirror: this.pipe.model.mirrorKV(), pageMB: Math.round(g.alive / 1e6), workerMB: i.aliveMB, coep: i.coep, isolated: !!i.isolated, workerS: +((i.ms || 0) / 1000).toFixed(2) }; }
    this._loaded = true; return Object.assign(r, { gpu: g.describe() });
  }
  unload() { dropStaging(this.store); dropStaging(this.dstore);   // 3.9 (E4B room): + after a load that failed
    if (this.pipe) { this._unloadedAt = performance.now(); if (this.pipe.model && this.pipe.model.releaseDrafter) this.pipe.model.releaseDrafter(); this.pipe.unload(); } this.pipe = null; this._loaded = false; }

  /** chat(messages, {tools, images, maxTokens, temperature, topK, topP, seed, thinking, onToken, signal}) */
  async chat(messages, o = {}) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms before using the assistant.');
    if (this.job) throw err('BUSY', 'The assistant is already answering.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run the engine.');
    if (o.images && o.images.length && this.reg.vision === false) throw err('NO_VISION', 'This model does not read pictures.');   // 3.8: Bolt E4B is text only
    if (!this._loaded) await this.load();
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working'); LS(this.reg.running, JSON.stringify({ t: Date.now() }));
    const t0 = performance.now();   // 3.8 port: was the page in the background during this answer?
    try {
      const r = await this.pipe.chat(messages, Object.assign({}, o, { signal: ctl.signal }));
      this._splitGone = 0; this._splitFails = 0;
      if (r && r.samplingError) this.emit('drafter', { error: r.samplingError });   // 3.8: as a drafter that could not load: the answer went on sampled the plain way
      return r;
    } catch (e) {
      if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
      // 3.8: the worker part is gone (or failed), or this page's GPU: unload everything (no worker left behind); the next job loads again
      const wasSplit = !!(this.pipe && this.pipe.split), lostHere = !!(this.gpu && this.gpu.lost);
      if (lostHere || (wasSplit && e && /^(SPLIT_GONE|SPLIT_WORKER|GPU_LOST)$/.test(e.code || ''))) {
        try { this.unload(); } catch (x) { /* */ }
        if (lostHere) this.gpu = null;
        // 3.8 port: the first failure = one fresh worker part (SPLIT_RETRY); a second in a row = no second process this session (Juli goes
        // on in one process without faster replies; the Bigger brain stops and the app sends its work to Juli). Whether the page was in
        // the background only goes to the log: iOS may end a background process, but stalls happen in front too
        let code = 'SPLIT_GONE';
        if (wasSplit && !lostHere) {
          const f = splitFailure({ fails: this._splitFails || 0, oneProcessOk: !!this.opts.splitFallback });
          code = f.code; this._splitFails = (this._splitFails || 0) + 1;
          this.emit('split-failed', { code, background: hiddenSince(t0), raw: String((e && e.message) || e).slice(0, 200) });
          if (f.oneProcess) this._oneProcess('its second process ended');
          if (f.down) this.emit('split', { off: true, down: true, why: 'its second process ended' });   // the app stops the Bigger brain for this page (E4B_DOWN)
        }
        const gpu = lostHere || e.code === 'GPU_LOST';
        throw err(gpu ? 'GPU_LOST' : code, gpu ? 'The GPU was reset. Try again.' : 'Part of the assistant stopped (its second process ended). Try again.');
      }
      const m = String(e && e.message || e) + ' ' + String(this.gpu && this.gpu.lastError || '');
      if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Not enough memory on this device for the assistant.');
      throw e;
    } finally { this.job = null; LS(this.reg.running, null); this._setState('idle'); }
  }
  cancel() { if (this.job) this.job.abort(); }
}
