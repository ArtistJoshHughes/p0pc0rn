// p0pc0rn engine entry for the lip-sync model: PF.createEngine({model: 'musetalk-1.5'}) -> the same conventions as engine 0.3.4
// (capabilities / status / download / deleteModel / load / cancel / on / off / errors with codes / the p0pc0rn agreement check) plus
// lipSync({video, audio, attest, signal, onProgress}) and unload().  Documented in ENGINE_API_LIPSYNC.md.  Core files are not modified.
'use strict';
import { LipSync, LIPSYNC_VERSION, RUN_KEY } from './lipsync.js';

export { LIPSYNC_VERSION };
export const MODEL_ID = 'musetalk-1.5';
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent', RUNNING = 'pocketlipsync:running';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
const abortErr = () => { const e = new Error('cancelled'); e.name = 'AbortError'; e.code = 'ABORTED'; return e; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };

export async function createEngine(opts = {}) { const e = new LipSyncEngine(opts); await e._init(); return e; }

class LipSyncEngine {
  constructor(opts) {
    this.opts = Object.assign({ model: MODEL_ID, packUrl: './pack/', source: 'opfs', dir: 'engine/musetalk-1.5/pack' }, opts);
    if (this.opts.model !== MODEL_ID) throw err('UNSUPPORTED', 'unknown model ' + this.opts.model);
    this.listeners = new Map(); this.job = null; this.state = 'idle'; this.lastRun = null;
    this.ls = new LipSync({ packUrl: this.opts.packUrl, dir: this.opts.dir, source: this.opts.source, unetBatch: this.opts.unetBatch || 0 });
    this.ls.recycle = this.opts.recycle !== false;   // probes v002
  }
  emit(n, d) { (this.listeners.get(n) || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } }); }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  _setState(s) { this.state = s; this.emit('state', { state: s }); }
  async _init() {
    const c = { supported: false, reason: '', gpu: '', subgroups: false, maxBufferMB: 0, storageQuotaGB: 0, persisted: false, webcodecs: typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined' };
    try {
      if (!navigator.gpu) c.reason = 'needs iOS 26 Safari (or another browser) with WebGPU';
      else {
        const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!ad) c.reason = 'no WebGPU adapter';
        else {
          const i = ad.info || {}; c.gpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' '); c.subgroups = ad.features.has('subgroups');
          c.maxBufferMB = Math.round(ad.limits.maxBufferSize / 1048576);
          if (!ad.features.has('shader-f16')) c.reason = 'this GPU has no 16-bit float shaders (shader-f16)';
          else if (ad.limits.maxComputeWorkgroupStorageSize < 16384) c.reason = 'GPU workgroup memory is too small';   // v026.9: the attention fits 16 KB (lattn picks its block)
          else c.supported = true;
        }
      }
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); c.storageQuotaGB = +((e.quota || 0) / 1e9).toFixed(1); }
      if (navigator.storage && navigator.storage.persisted) c.persisted = await navigator.storage.persisted();
      if (c.supported && this.opts.source !== 'http' && !(navigator.storage && navigator.storage.getDirectory)) { c.supported = false; c.reason = 'this browser has no private file storage (OPFS)'; }
      if (c.supported && !c.webcodecs) { c.supported = false; c.reason = 'this browser has no WebCodecs (VideoEncoder / VideoDecoder)'; }
    } catch (e) { c.reason = String(e && e.message || e); }
    this.caps = c;
    const run = LS(RUNNING);
    if (run) { LS(RUNNING, null); try { this.lastRun = JSON.parse(run); } catch (e) { this.lastRun = {}; }
      setTimeout(() => this.emit('warning', { code: 'KILLED_LAST_RUN', message: 'The last lip-sync was interrupted (the phone ran out of memory or got hot). Start it again: it resumes where it stopped.', lastRun: this.lastRun }), 0); }
  }
  capabilities() { return Object.assign({}, this.caps); }
  async requestPersistentStorage() { try { const p = await navigator.storage.persist(); this.caps.persisted = p; return p; } catch (e) { return false; } }
  async status() { await this.ls.open(); const s = this.ls.store.status(); return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.ls.store.m.pack_version }; }
  async download({ onProgress, signal, parallel } = {}) {
    if (this.job) throw err('BUSY', 'A lip-sync is running.');
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      await this.ls.open(); let last = 0;
      const r = await this.ls.download({ signal, parallel, onProgress: (p) => { const n = performance.now(); if (n - last < 250 && p.have < p.total) return; last = n;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard }); } });
      return Object.assign(await this.status(), { complete: r.complete });
    } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; } finally { this._setState('idle'); }
  }
  async deleteModel() { if (this.job) throw err('BUSY', 'A lip-sync is running.'); await this.ls.open(); await this.ls.remove(); LS(RUN_KEY, null); }
  models() { return [{ id: MODEL_ID, kind: 'lipsync' }]; }
  async load() { if (this.job) throw err('BUSY', 'Busy.'); await this._load(); return { gpu: this.ls.gpu.describe(), calib: this.ls.gpu.calib }; }
  async _load() {
    await this.ls.open();
    if (!this.ls.store.status().complete) throw err('NOT_DOWNLOADED', 'Download the lip-sync model first.');
    if (this.ls.store.m.model.arch !== 'musetalk-1.5') throw err('UNSUPPORTED', 'pack is ' + this.ls.store.m.model.arch);
    await this.ls.load();
  }
  unload() { if (this.job) throw err('BUSY', 'A lip-sync is running.'); this.ls.unload(); }
  cancel() { if (this.job) this.job.abort(); }
  /** probes v002: forget an interrupted run and its checkpoints */
  async discardRun() { if (this.job) throw err('BUSY', 'A lip-sync is running.'); await this.ls.open(); await this.ls.discardRun(); }
  get gpu() { return this.ls.gpu || null; }
  /** {video: Blob (mp4/mov H.264), audio: Blob (wav/m4a/mp3...), attest: true, signal, onProgress, audioWindow, resume}
   *  -> {mp4Blob, url, mux ('aac'|'opus'|'video-only'), frames, width, height, fps, seconds, timings, peakMB, perFrameSec, boxes, ...} */
  async lipSync(o = {}) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson in the app) before making anything.');
    if (o.attest !== true) throw err('NO_CONSENT', 'Confirm you have the rights to this face and this voice (the per-upload checkbox).');
    if (this.job) throw err('BUSY', 'A lip-sync is already running.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run the engine.');
    if (!o.video) throw err('BAD_VIDEO', 'Pick a clip first.');
    if (!o.audio) throw err('BAD_AUDIO', 'Pick a speech file first.');
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working');
    const t0 = performance.now();
    try {
      LS(RUNNING, JSON.stringify({ t: Date.now() }));
      if (o.onProgress) o.onProgress({ phase: 'load', frac: 0, message: 'Preparing' });
      await this._load();
      const prog = (p) => { this.emit('progress', p); if (o.onProgress) try { o.onProgress(p); } catch (e) { /* */ } };
      let r;
      try { r = await this.ls.render(Object.assign({}, o, { signal: ctl.signal, onProgress: prog })); }
      catch (e) {
        if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
        if (this.ls.gpu && this.ls.gpu.lost) { this.ls.gpu = null; throw err('GPU_LOST', 'The GPU was reset. Start again: it resumes where it stopped.'); }
        if (e && e.code) throw e;
        const m = String(e && e.message || e);
        if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Too big for this device; try a shorter clip.');
        throw e;
      }
      const mp4Blob = r.mp4 ? new Blob([r.mp4], { type: 'video/mp4' }) : null;
      return Object.assign({ mp4Blob, url: mp4Blob ? URL.createObjectURL(mp4Blob) : null, seconds: (performance.now() - t0) / 1000, gpu: this.ls.gpu.describe(), calib: this.ls.gpu.calib, version: LIPSYNC_VERSION }, r, { mp4: undefined, speechPcm: undefined, speech: r.speech });
    } catch (e) {
      try { if (this.ls.gpu && !this.ls.gpu.lost) { this.ls.store.drainPool(); this.ls.gpu.drainPool(); } } catch (e2) { /* */ }
      throw e;
    } finally { this.job = null; LS(RUNNING, null); this._setState('idle'); }
  }
}
