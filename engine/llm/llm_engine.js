// p0pc0rn LLM engine entry: createEngine({model:'gemma4-e2b'}) with the same download / progress / cancel / error / events conventions
// as the image + video engine (docs/ENGINE_API.md), plus chat() and unload().  Standalone (keeps the shared engine.js byte-identical);
// reuses core/gpu.js + core/store.js + llm/llm.js.  The LLM is loaded only for a chat job and unloaded after (Josh's one-model queue).
'use strict';
import { createGpu } from '../core/gpu.js';
import { WeightStore } from '../core/store.js';
import { LLMPipeline } from './llm.js';

export const LLM_VERSION = '0.1';
export const LLM_MODELS = {
  'gemma4-e2b': { arch: 'gemma4-text', kind: 'chat', dir: 'pocketllm/pack', running: 'pocketllm:running', wipe: ['pocketllm/pack'] },
};
const err = (code, m) => { const e = new Error(m); e.code = code; return e; };
const abortErr = () => { const e = new Error('cancelled'); e.name = 'AbortError'; e.code = 'ABORTED'; return e; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };

export async function createEngine(opts = {}) { const e = new LLMEngine(opts); await e._init(); return e; }

class LLMEngine {
  constructor(opts) {
    this.opts = Object.assign({ model: 'gemma4-e2b', packUrl: './pack/', source: 'opfs', powerPreference: undefined }, opts);
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
  }
  capabilities() { return Object.assign({}, this.caps); }
  async requestPersistentStorage() { try { const p = await navigator.storage.persist(); this.caps.persisted = p; return p; } catch (e) { return false; } }
  models() { return [{ id: this.opts.model, kind: this.reg.kind, installed: this._loaded }]; }
  async _open() { if (!this.store.m) await this.store.open(); return this.store; }
  async status() { await this._open(); const s = this.store.status(); return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.store.m.pack_version }; }

  async download({ onProgress, signal, parallel } = {}) {
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      await this._open(); let last = 0;
      await this.store.download({ signal, parallel, onProgress: (p) => { const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard }); } });
      return await this.status();
    } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; } finally { this._setState('idle'); }
  }
  async deleteModel() {
    await this._open(); if (!this.store.http) { await this.store.st.start(); await this.store.st.call('remove', { name: this.store.dir }); }   // only this pack variant's folder
    this.store.state = { pack_version: this.store.m.pack_version, done: {} }; this._loaded = false;
  }

  async _gpu() {
    if (this.gpu && !this.gpu.lost) return this.gpu;
    this.gpu = await createGpu({ powerPreference: this.opts.powerPreference || 'high-performance', onLost: () => this.emit('gpu-lost', {}) });
    this.gpu.rate = { mm: 0.2e12, attn: 0.08e12, mem: 20e9 };
    return this.gpu;
  }
  /** load the brain (resident by default). onProgress fires during the weight upload. */
  async load({ mode = 'resident', ctxCap = 4096, onProgress } = {}) {
    await this._open(); if (!this.store.status().complete) throw err('NOT_DOWNLOADED', 'Download the model first.');
    if (!this.store.http) await this.store.st.start();
    const g = await this._gpu(); this.store.gpu = g;
    this.pipe = new LLMPipeline({ gpu: g, store: this.store, emit: (n, d) => this.emit(n, d) });
    const r = await this.pipe.load({ mode, ctxCap, onProgress });
    this._loaded = true; return Object.assign(r, { gpu: g.describe() });
  }
  unload() { if (this.pipe) this.pipe.unload(); this.pipe = null; this._loaded = false; }

  /** chat(messages, {tools, images, maxTokens, temperature, topK, topP, seed, thinking, onToken, signal}) */
  async chat(messages, o = {}) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms before using the assistant.');
    if (this.job) throw err('BUSY', 'The assistant is already answering.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run the engine.');
    if (!this._loaded) await this.load();
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working'); LS(this.reg.running, JSON.stringify({ t: Date.now() }));
    try {
      const r = await this.pipe.chat(messages, Object.assign({}, o, { signal: ctl.signal }));
      return r;
    } catch (e) {
      if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
      if (this.gpu && this.gpu.lost) { this.gpu = null; this._loaded = false; throw err('GPU_LOST', 'The GPU was reset. Try again.'); }
      const m = String(e && e.message || e) + ' ' + String(this.gpu && this.gpu.lastError || '');
      if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Not enough memory on this device for the assistant.');
      throw e;
    } finally { this.job = null; LS(this.reg.running, null); this._setState('idle'); }
  }
  cancel() { if (this.job) this.job.abort(); }
}
