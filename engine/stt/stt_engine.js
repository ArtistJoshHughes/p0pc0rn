// Pocket STT engine: speech to text on the phone with NVIDIA Nemotron 3.5 ASR Streaming 0.6B (OpenMDW-1.1), pure JS + WGSL.
// Same conventions as the other engines (download / status / progress / errors / the p0pc0rn agreement).  The audio never leaves the
// page and is never stored: samples go from push() through the mel front end to the GPU and are dropped.
//   const e = await createSttEngine({ packUrl: P0_CONFIG.packs['nemotron35-asr-0.6b'] });
//   await e.download({ onProgress }); await e.load();
//   const s = e.stream({ lang: 'en-US' | 'auto', lookahead: 3, onText({ text, lang }), onEnd({ text, reason }) });
//   s.push(float32 samples at 16 kHz) ... ; const { text } = await s.finish();      // or s.cancel()
// End of speech: the model has no end-of-utterance token (it writes a sentence's full stop only once the next sentence starts), so
// the stream ends a turn on silence: no new word for `eouMs` of processed audio AND no voice in the audio for `eouMs`.
'use strict';
import { createGpu } from '../core/gpu.js';
import { WeightStore } from '../core/store.js';
import { SttModel, STT_VERSION } from './stt.js';
import { SttStream } from './stt_stream.js';

export const ENGINE_VERSION = '0.3.4+' + STT_VERSION;
export const MODELS = { 'nemotron35-asr-0.6b': { arch: 'nemotron-asr-streaming-rnnt', kind: 'stt', dir: 'engine/nemotron35-asr-0.6b/pack', running: 'pocketstt:running' } };
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };

export async function createSttEngine(opts = {}) { const e = new SttEngine(opts); await e._init(); return e; }

class SttEngine {
  constructor(opts) {
    this.opts = Object.assign({ model: 'nemotron35-asr-0.6b', packUrl: './pack/', source: 'opfs', powerPreference: undefined }, opts);
    this.reg = MODELS[this.opts.model];
    if (!this.reg) throw err('UNSUPPORTED', 'unknown model ' + this.opts.model);
    if (!this.opts.dir) this.opts.dir = this.reg.dir;
    this.listeners = new Map(); this.state = 'idle'; this.gpu = null; this.model = null; this.active = null; this._installed = false;
  }
  emit(name, data) { (this.listeners.get(name) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  async _init() {
    const c = { supported: false, reason: '', gpu: '', maxBufferMB: 0, storageQuotaGB: 0, persisted: false };
    try {
      if (!navigator.gpu) c.reason = 'needs iOS 26 Safari (or another browser) with WebGPU';
      else {
        const ad = await navigator.gpu.requestAdapter({ powerPreference: this.opts.powerPreference || 'high-performance' });   // v4: the adapter its device asks for (a laptop's card where the browser honours it)
        if (!ad) c.reason = 'no WebGPU adapter';
        else {
          const i = ad.info || {}; c.gpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' ');
          c.maxBufferMB = Math.round(ad.limits.maxBufferSize / 1048576);
          if (!ad.features.has('shader-f16')) c.reason = 'this GPU has no 16-bit float shaders (shader-f16)';
          else if (ad.limits.maxBufferSize < 64 * 1048576) c.reason = 'GPU buffers are too small';
          else c.supported = true;
        }
      }
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); c.storageQuotaGB = +((e.quota || 0) / 1e9).toFixed(1); }
      if (navigator.storage && navigator.storage.persisted) c.persisted = await navigator.storage.persisted();
      if (c.supported && this.opts.source !== 'http' && !(navigator.storage && navigator.storage.getDirectory)) { c.supported = false; c.reason = 'this browser has no private file storage (OPFS)'; }
    } catch (e) { c.reason = String(e && e.message || e); }
    this.caps = c;
    this.store = new WeightStore(null, { base: this.opts.packUrl, dir: this.opts.dir, source: this.opts.source });
    const run = LS(this.reg.running);
    if (run) { LS(this.reg.running, null); setTimeout(() => this.emit('warning', { code: 'KILLED_LAST_RUN', message: 'Voice input stopped last time (the phone ran out of memory or got hot).' }), 0); }
  }
  capabilities() { return Object.assign({}, this.caps); }
  async _open() { if (!this.store.m) await this.store.open(); return this.store; }
  async status() { await this._open(); const s = this.store.status(); this._installed = s.complete; return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.store.m.pack_version }; }
  async download({ onProgress, signal, parallel } = {}) {
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this.state = 'downloading';
    try {
      await this._open();
      let last = 0;
      const r = await this.store.download({ signal, parallel, onProgress: (p) => {
        const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard });
      } });
      this._installed = r.complete;
      return await this.status();
    } catch (e) { if (e && e.name === 'AbortError') throw Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' }); throw e; } finally { this.state = 'idle'; }
  }
  async deleteModel() {
    if (this.active) throw err('BUSY', 'Voice input is listening.');
    await this._open(); this.unload();
    if (!this.store.http) { await this.store.st.start(); await this.store.st.call('remove', { name: this.opts.dir }); }
    this.store.state = { pack_version: this.store.m.pack_version, done: {} }; this._installed = false;
  }
  models() { return [{ id: this.opts.model, kind: 'stt', installed: this._installed }]; }
  get loaded() { return !!(this.model && this.model.h); }
  /** the GPU device + every weight (about 640 MB of GPU memory) -> {seconds, gpuMB, version} */
  async load(o = {}) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson in the app) first.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run voice input.');
    if (this.loaded) return { seconds: 0, gpuMB: Math.round(this.gpu.alive / 1e6), version: ENGINE_VERSION };
    const t0 = performance.now();
    await this._open();
    if (!this.store.status().complete) throw err('NOT_DOWNLOADED', 'Download voice input first (Settings › Models).');
    if ((this.store.m.model && this.store.m.model.arch) !== this.reg.arch) throw err('UNSUPPORTED', 'this pack is not the speech-to-text model');
    LS(this.reg.running, JSON.stringify({ phase: 'load', t: Date.now() }));
    try {
      if (!this.gpu || this.gpu.lost) {
        this.gpu = o.gpu || await createGpu({ powerPreference: this.opts.powerPreference || 'high-performance', wantSubgroups: false, onLost: () => this.emit('gpu-lost', {}) });
        this.store.gpu = this.gpu;
      }
      if (!this.store.http) await this.store.st.start();
      this.model = new SttModel(this.gpu, this.store);
      await this.model.load(o.onPart);
      // compile every kernel now (a short silent stream), so the first word is not slowed by pipeline creation
      this.model.reset(0, 3);
      this.model.chunk(new Float32Array(this.model.need * 128).fill(-16.6)); await this.model.decode();
      await this.gpu.done();
    } finally { LS(this.reg.running, null); }
    this.loadSeconds = (performance.now() - t0) / 1000;
    return { seconds: this.loadSeconds, gpuMB: Math.round(this.gpu.alive / 1e6), version: ENGINE_VERSION };
  }
  /** free every GPU buffer (the model stays downloaded). The device STAYS, as Juli's engine keeps hers (3.8: destroying a device after
   *  every unload ended with "The GPU was reset" after a dozen loads); its compiled kernels make the next load faster */
  unload() {
    if (this.active) { try { this.active.cancel(); } catch (e) { /* */ } }
    if (this.model) this.model.unload();
    if (this.gpu) { try { this.gpu.freeAll(); } catch (e) { /* */ } }
    this.model = null; return true;
  }
  /** language strings the model takes ('auto' + locales) -> prompt index */
  promptOf(lang) {
    const t = this.model && this.model.vocab && this.model.vocab.prompts; if (!t) return 101;
    if (lang && t[lang] != null) return t[lang];
    const short = String(lang || '').split('-')[0]; return t[short] != null ? t[short] : t.auto;
  }
  /** one stream at a time. o: {lang ('auto' or a locale), lookahead (0|1|3|6|13, default 3), eouMs (900), maxSeconds (60),
   *  onText({text, lang, tokens}), onEnd({text, lang, reason}), profile} */
  stream(o = {}) {
    if (!this.loaded) throw err('NOT_LOADED', 'Load voice input first.');
    if (this.active) throw err('BUSY', 'Voice input is already listening.');
    const s = new SttStream({ model: this.model, gpu: this.gpu, prompt: this.promptOf(o.lang || 'auto'), onClose: (x) => { if (this.active === x) this.active = null; } }, o);
    this.active = s; return s;
  }
}
