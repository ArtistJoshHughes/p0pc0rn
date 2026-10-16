// Pocket Voice engine: Qwen3-TTS-12Hz-0.6B-Base voice cloning ("make <character> say <line>") on WebGPU, pure JS + WGSL.
// Same conventions as engine.js 0.3.4 (download / status / progress / cancel / events / errors / the p0pc0rn agreement); the API is
// documented in voice/VOICE_API.md.  createVoiceEngine({model: 'qwen3-tts-0.6b', packUrl, source}) -> engine with speak().
// probes v002 (Oct 14): the core is p0pc0rn v028's (zero-copy loader, one readback buffer, uniform ring, bind-group cache) + a recycling
// pool; speak() runs as three stages (learnVoice -> talk -> decodeLine) that a page can split with a fresh page between them.
'use strict';
import { createGpu } from './vgpu.js';   // p0pc0rn Cast (v029+): the voice probe v002 core (recycling pool, writeBuffer guard, stats); the app's other engines keep core/gpu.js
import { WeightStore } from '../core/store.js';
import { QwenTTS, VOICE_VERSION } from './qtts.js';
import { vgemm } from './vgemm.js';
import { attn } from './vops.js';
import { toMono24k, wav16 } from './m4a.js';
import { audioCaps, encodePcm, muxM4a } from '../media/m4a.js';

export const ENGINE_VERSION = '0.3.4+' + VOICE_VERSION;
export const MODELS = { 'qwen3-tts-0.6b': { arch: 'qwen3-tts', kind: 'voice', dir: 'engine/qwen3-tts-0.6b/pack', voices: 'engine/qwen3-tts-0.6b/voices', running: 'pocketvoice:running' } };
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
const abortErr = () => { const e = new Error('cancelled'); e.name = 'AbortError'; e.code = 'ABORTED'; return e; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };
const hex = (ab) => Array.from(new Uint8Array(ab), (b) => b.toString(16).padStart(2, '0')).join('');
export const REF_MIN_S = 2.5, REF_MAX_S = 12, TEXT_MAX = 500;

/** dispatch sizing (every dispatch < ~0.2 s, the OS watchdog guard): q8 GEMM + head-dim-128 attention rates of THIS GPU */
const CALIB_KEY = 'pocketvoice:calib';
/** probes v002: the calibration of THIS GPU is kept (a fresh page between stages must not re-run it: 20 MB made and destroyed) */
function calibCached(g) {
  try { const c = JSON.parse(localStorage.getItem(CALIB_KEY) || 'null'), id = JSON.stringify(g.info);
    if (c && c.id === id && c.v === VOICE_VERSION) { g.rate = c.rate; g.calib = Object.assign({ cached: true }, c.calib); return true; } } catch (e) { /* */ }
  return false;
}
function calibSave(g) { try { localStorage.setItem(CALIB_KEY, JSON.stringify({ id: JSON.stringify(g.info), v: VOICE_VERSION, rate: g.rate, calib: g.calib })); } catch (e) { /* */ } }
export async function calibrateVoice(g) {
  g.rate = { mm: 0.08e12, mm32: 0.08e12, attn: 0.03e12, mem: 15e9 };
  const M = 512, N = 4096, K = 1024, recs = (N / 64) * (K / 64), u = new Uint32Array(recs * 1056);
  let s = 12345; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
  for (let i = 0; i < u.length; i++) u[i] = rnd() & 0x3f3f3f3f;
  for (let r = 0; r < recs; r++) for (let j = 0; j < 32; j++) u[r * 1056 + 1024 + j] = 0x20002000;
  const h16 = (n) => { const h = new Uint16Array(n); for (let i = 0; i < n; i++) h[i] = (rnd() & 0x83ff) | 0x3400; return h; };
  const W = g.upload(u), X = g.upload(h16(M * K)), Y = g.buffer(M * N * 4), L = 256, Q = g.upload(new Float32Array(L * 2048).fill(0.01)), KC = g.upload(h16(8 * L * 128)), O = g.buffer(L * 2048 * 4);
  const time = async (fn, reps) => { fn(); await g.done(); const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(); await g.done(); return (performance.now() - t0) / 1000 / reps; };
  try {
    const tm = await time(() => vgemm(g, { w: { buf: W, off: 0, bytes: W._pf, enc: 'q8g64s.t64', rows: N, cols: K }, x: { buf: X }, M, N, K, epi: 'f32', y: { buf: Y } }), 2);
    g.rate.mm = g.rate.mm32 = Math.max(0.03e12, 0.8 * (2 * M * N * K) / tm);
    const ta = await time(() => attn(g, { q: { buf: Q, ld: 2048 }, M: L, Hq: 16, Hkv: 8, D: 128, pos0: 0, window: 0, Lmax: L, kc: { buf: KC }, vc: { buf: KC }, o: { buf: O, ld: 2048 } }), 2);
    g.rate.attn = Math.max(0.01e12, 0.8 * (2 * L * L * 128 * 16) / ta);
    g.calib = { gemmQ8Gflops: Math.round(2 * M * N * K / tm / 1e9), attnGflops: Math.round(2 * L * L * 128 * 16 / ta / 1e9) };
  } finally { [W, X, Y, Q, KC, O].forEach((b) => g.free(b)); }
  return g.calib;
}

export async function createVoiceEngine(opts = {}) { const e = new VoiceEngine(opts); await e._init(); return e; }

class VoiceEngine {
  constructor(opts) {
    this.opts = Object.assign({ model: 'qwen3-tts-0.6b', packUrl: './pack/', source: 'opfs', powerPreference: undefined }, opts);
    this.reg = MODELS[this.opts.model];
    if (!this.reg) throw err('UNSUPPORTED', 'unknown model ' + this.opts.model);
    if (!this.opts.dir) this.opts.dir = this.reg.dir;
    this.listeners = new Map(); this.job = null; this.state = 'idle'; this.gpu = null; this.tts = null; this._installed = false; this.voices = new Map(); this.lastRun = null;
  }
  emit(name, data) { (this.listeners.get(name) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
  _setState(s) { this.state = s; this.emit('state', { state: s }); }
  async _init() {
    const c = { supported: false, reason: '', gpu: '', subgroups: false, maxBufferMB: 0, storageQuotaGB: 0, persisted: false, aac: false };
    try {
      if (!navigator.gpu) c.reason = 'needs iOS 26 Safari (or another browser) with WebGPU';
      else {
        const ad = await navigator.gpu.requestAdapter(this.opts.powerPreference ? { powerPreference: this.opts.powerPreference } : undefined);
        if (!ad) c.reason = 'no WebGPU adapter';
        else {
          const i = ad.info || {}; c.gpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' '); c.subgroups = ad.features.has('subgroups');
          c.maxBufferMB = Math.round(ad.limits.maxBufferSize / 1048576);
          if (!ad.features.has('shader-f16')) c.reason = 'this GPU has no 16-bit float shaders (shader-f16)';
          else if (ad.limits.maxBufferSize < 256 * 1048576) c.reason = 'GPU buffers are too small';
          else c.supported = true;
        }
      }
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); c.storageQuotaGB = +((e.quota || 0) / 1e9).toFixed(1); }
      if (navigator.storage && navigator.storage.persisted) c.persisted = await navigator.storage.persisted();
      if (c.supported && this.opts.source !== 'http' && !(navigator.storage && navigator.storage.getDirectory)) { c.supported = false; c.reason = 'this browser has no private file storage (OPFS)'; }
      c.aac = !!(await audioCaps(1)).aac;
    } catch (e) { c.reason = String(e && e.message || e); }
    this.caps = c;
    this.store = new WeightStore(null, { base: this.opts.packUrl, dir: this.opts.dir, source: this.opts.source });
    const run = LS(this.reg.running);
    if (run) {
      LS(this.reg.running, null);
      try { this.lastRun = JSON.parse(run); } catch (e) { this.lastRun = {}; }
      setTimeout(() => this.emit('warning', { code: 'KILLED_LAST_RUN', message: 'The last line was interrupted (the phone ran out of memory or got hot). Try again.', lastRun: this.lastRun }), 0);
    }
  }
  capabilities() { return Object.assign({}, this.caps); }
  async requestPersistentStorage() { try { const p = await navigator.storage.persist(); this.caps.persisted = p; return p; } catch (e) { return false; } }
  async _open() { if (!this.store.m) await this.store.open(); return this.store; }
  async status() { await this._open(); const s = this.store.status(); this._installed = s.complete; return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.store.m.pack_version }; }
  async download({ onProgress, signal, parallel } = {}) {
    if (this.job) throw err('BUSY', 'A line is being spoken.');
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      await this._open();
      const st0 = this.store.status();
      try { const e = await navigator.storage.estimate(); if (e.quota && e.quota - e.usage < st0.total - st0.have) this.emit('warning', { code: 'LOW_STORAGE', message: 'There may not be enough free storage for the model.' }); } catch (e) { /* */ }
      let last = 0;
      const r = await this.store.download({ signal, parallel, onProgress: (p) => {
        const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard });
      } });
      this._installed = r.complete;
      return Object.assign(await this.status(), { downloadedBytes: this.store.stats.downloadBytes, seconds: this.store.stats.downloadSec });
    } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; } finally { this._setState('idle'); }
  }
  async deleteModel() {
    if (this.job) throw err('BUSY', 'A line is being spoken.');
    await this._open(); this.unload();
    if (!this.store.http) { await this.store.st.start(); await this.store.st.call('remove', { name: 'engine/qwen3-tts-0.6b' }); }
    this.store.state = { pack_version: this.store.m.pack_version, done: {} }; this._installed = false; this.voices.clear();
  }
  models() { return [{ id: this.opts.model, kind: 'voice', installed: this._installed }]; }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  cancel() { if (this.job) this.job.abort(); }
  /** create the GPU device + calibrate now (optional): {gpu, calib} */
  async load() { if (this.job) throw err('BUSY', 'Busy.'); await this._load(); return { gpu: this.gpu.describe(), calib: this.gpu.calib, version: ENGINE_VERSION }; }
  /** free every GPU buffer and the device (the model stays downloaded) */
  unload() { if (this.job) return false; if (this.tts) this.tts.unloadTalker(); if (this.store && this.store.drainPool && this.gpu) this.store.drainPool(); if (this.gpu) { try { this.gpu.freeAll(); this.gpu.device.destroy(); } catch (e) { /* */ } } this.gpu = null; this.tts = null; return true; }
  async _load() {
    await this._open();
    if (!this.store.status().complete) throw err('NOT_DOWNLOADED', 'Download the voice model first.');
    this._installed = true;
    if (!this.gpu || this.gpu.lost) {
      const old = this.gpu;
      this.gpu = await createGpu({ powerPreference: this.opts.powerPreference || 'high-performance', wantSubgroups: false, onLost: () => this.emit('gpu-lost', {}) });
      this.gpu.recycle(this.opts.recycle !== false);   // probes v002: no per-step / per-tile create + destroy
      if (old && old.calib) { this.gpu.rate = old.rate; this.gpu.calib = old.calib; } else if (!calibCached(this.gpu)) { await calibrateVoice(this.gpu); calibSave(this.gpu); }
      this.store.gpu = this.gpu;
      if (this.tts) this.tts.bind(this.gpu);
    }
    if (!this.store.http) await this.store.st.start();
    if (!this.tts) {
      if ((this.store.m.model && this.store.m.model.arch) !== this.reg.arch) throw err('UNSUPPORTED', 'this pack is not the Qwen3-TTS voice model');
      this.tts = new QwenTTS(this.gpu, this.store);
    }
    return this.tts;
  }
  /** probes v002: a learned voice by its key (memory, then OPFS) or null */
  async _voiceByKey(key) {
    if (this.voices.has(key)) return { v: this.voices.get(key), cached: 'memory', key };
    const st = this.store.http ? null : this.store.st, path = `${this.reg.voices}/${key}.bin`;
    if (!st) return null;
    try { await st.start(); const sz = (await st.call('size', { name: path })).size; if (sz > 8) { const r = await st.call('read', { name: path, at: 0, len: sz }); const u = new Uint32Array(r.buf.slice(0, sz)); const T = u[0];
      const v = { codes: new Int32Array(u.buffer.slice(4, 4 + T * 64)), xvec: new Float32Array(u.buffer.slice(4 + T * 64, 4 + T * 64 + 4096)) }; this.voices.set(key, v); return { v, cached: 'storage', key }; } } catch (e) { /* not cached */ }
    return null;
  }
  /** p0pc0rn Cast: is this learned voice on the phone (memory or OPFS)? */
  async hasVoice(key) { try { await this._open(); return !!(await this._voiceByKey(key)); } catch (e) { return false; } }
  /** p0pc0rn Cast: forget a learned voice (a cast member deleted): memory + its OPFS file */
  async forgetVoice(key) {
    this.voices.delete(key);
    try { await this._open(); if (!this.store.http) { await this.store.st.start(); await this.store.st.call('remove', { name: `${this.reg.voices}/${key}.bin` }); } } catch (e) { return false; }
    return true;
  }
  /** the cached voice of a reference: memory, then OPFS, else the two encoders (once per reference) */
  async _voice(wav, refText, check, onProgress) {
    const key = hex(await crypto.subtle.digest('SHA-256', new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength))).slice(0, 32);
    if (this.voices.has(key)) return { v: this.voices.get(key), cached: 'memory', key };
    const st = this.store.http ? null : this.store.st, path = `${this.reg.voices}/${key}.bin`;
    if (st) {
      try { const sz = (await st.call('size', { name: path })).size; if (sz > 8) { const r = await st.call('read', { name: path, at: 0, len: sz }); const u = new Uint32Array(r.buf.slice(0, sz)); const T = u[0];
        const v = { codes: new Int32Array(u.buffer.slice(4, 4 + T * 64)), xvec: new Float32Array(u.buffer.slice(4 + T * 64, 4 + T * 64 + 4096)) }; this.voices.set(key, v); return { v, cached: 'storage', key }; } } catch (e) { /* not cached */ }
    }
    if (onProgress) onProgress({ phase: 'voice', frac: 0.1, message: 'Learning the voice' });
    const v = await this.tts.voice(wav, { check });
    this.voices.set(key, { codes: v.codes, xvec: v.xvec });
    if (st) {
      try { const T = v.codes.length / 16, ab = new ArrayBuffer(4 + T * 64 + 4096); new Uint32Array(ab, 0, 1)[0] = T; new Int32Array(ab, 4, T * 16).set(v.codes); new Float32Array(ab, 4 + T * 64, 1024).set(v.xvec);
        await st.call('write', { name: path, at: 0, buf: ab, truncate: 0 }, [ab]); await st.call('flush', { name: path }); } catch (e) { /* cache is optional */ }
    }
    return { v: this.voices.get(key), cached: false, key, timings: v.timings };
  }
  /** probes v002: common guards + job bookkeeping for one stage */
  async _stage(name, o, fn) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson in the app) before making anything.');
    if (this.job) throw err('BUSY', 'A line is already being spoken.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run the engine.');
    if (o.refAttested !== true) throw err('NO_CONSENT', "Tick the box: the voice is yours, or you have the speaker's permission.");
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working');
    const t0 = performance.now(), prog = (p) => { this.emit('progress', p); if (o.onProgress) try { o.onProgress(p); } catch (e) { /* */ } };
    try {
      LS(this.reg.running, JSON.stringify({ phase: name, t: Date.now() }));
      await this._load();
      const check = () => { if (ctl.signal.aborted) throw abortErr(); if (this.gpu.lost) throw err('GPU_LOST', 'The GPU was reset.'); };
      this.gpu.resetPeak();
      let r;
      try { r = await fn(check, prog); }
      catch (e) {
        this._endStage();
        if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
        if (this.gpu && this.gpu.lost) { this.gpu = null; this.tts = null; throw err('GPU_LOST', 'The GPU was reset. Try again.'); }
        if (e && e.code) throw e;
        const m = String(e && e.message || e) + ' ' + String(this.gpu && this.gpu.lastError || '');
        if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Too big for this device; try a shorter line.');
        throw e;
      }
      const peak = this.gpu.peak;
      const freed = this._endStage();
      return Object.assign(r, { stage: name, seconds: (performance.now() - t0) / 1000, peakMB: Math.round(peak / 1e6), freedMB: Math.round(freed / 1e6),
        gpuStats: this.gpu.stats(), gpu: this.gpu.describe(), calib: this.gpu.calib, version: ENGINE_VERSION });
    } finally { this.job = null; LS(this.reg.running, null); this._setState('idle'); }
  }
  /** probes v002: the end of a stage destroys its pooled buffers + the store's kept shard (the next stage allocates other sizes) -> bytes */
  _endStage() {
    let n = 0;
    try { if (this.gpu && this.store && this.store.drainPool) this.store.drainPool(); if (this.gpu && this.gpu.device) { this.gpu.runner.flush(); n = this.gpu.drainPool(); } } catch (e) { /* */ }
    return n;
  }
  /** stage 1: learn the voice of a reference (3-10 s + consent) -> {key, cached, refSeconds, refRate, timings: {voice, voiceCodec, voiceSpeaker}} */
  async learnVoice(o = {}) {
    if (!o.refAudio) throw err('BAD_AUDIO', 'Record or pick the voice first.');
    return this._stage('voice', o, async (check, prog) => {
      prog({ phase: 'load', frac: 0, message: 'Preparing the recording' });
      const ref = await toMono24k(o.refAudio);
      if (ref.seconds < REF_MIN_S || ref.seconds > REF_MAX_S) throw err('BAD_AUDIO', `The voice recording should be 3 to 10 seconds long (this one is ${ref.seconds.toFixed(1)} s).`);
      const tv = performance.now();
      const voice = await this._voice(ref.samples, null, check, prog);
      const sec = (performance.now() - tv) / 1000;
      prog({ phase: 'voice', frac: 1, message: voice.cached ? 'Voice already learned' : 'Voice learned' });
      return { key: voice.key, cached: voice.cached, refSeconds: +ref.seconds.toFixed(2), refRate: ref.srcRate,
        timings: Object.assign({ voice: sec }, voice.timings ? { voiceCodec: voice.timings.codec, voiceSpeaker: voice.timings.speaker } : {}) };
    });
  }
  /** stage 2: the line's codes in a learned voice. o = {text, voiceKey, refText, refAttested, seed, language, keepLoaded, signal, onProgress}
   *  -> {codes Int32Array, frames, eos, ran, seed, text, timings: {prompt, load, prefill, frames, framesPerSec}} */
  async talk(o = {}) {
    const text = String(o.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw err('EMPTY_TEXT', 'Type the line to say.');
    if (text.length > TEXT_MAX) throw err('BAD_TEXT', `Keep a line under ${TEXT_MAX} characters (about 30 seconds of speech).`);
    const refText = String(o.refText || '').replace(/\s+/g, ' ').trim();
    if (!refText) throw err('BAD_REF_TEXT', 'Type exactly what is said in the voice recording.');
    const seed = o.seed != null ? o.seed >>> 0 : Math.floor(Math.random() * 2 ** 31);
    return this._stage('speak', o, async (check, prog) => {
      const voice = await this._voiceByKey(o.voiceKey || '');
      if (!voice) throw err('VOICE_MISSING', 'The learned voice is not on this phone any more: learn it again.');
      const r = await this.tts.talk(text, refText, voice.v, { seed, check, language: o.language || 'english', keepTalker: !!o.keepLoaded, onProgress: (p) => {
        const f = p.phase === 'load' ? 0.1 * p.frac : 0.1 + 0.9 * p.frac;
        prog(Object.assign({}, p, { frac: f, message: p.phase === 'speak' ? `Speaking: ${(p.seconds || 0).toFixed(1)} s` : 'Loading the voice model' })); } });
      return { codes: r.codes, frames: r.frames, eos: r.eos, ran: r.ran, seed, text, timings: r.timings };
    });
  }
  /** stage 3: the waveform of a line's codes -> {samples Float32Array (24 kHz), duration, wav Blob, timings: {decode}} */
  async decodeLine(o = {}) {
    if (!o.codes || !o.codes.length) throw err('BAD_CODES', 'Nothing to decode.');
    return this._stage('decode', o, async (check, prog) => {
      const voice = await this._voiceByKey(o.voiceKey || '');
      if (!voice) throw err('VOICE_MISSING', 'The learned voice is not on this phone any more: learn it again.');
      const r = await this.tts.render(voice.v.codes, o.codes, { check, onProgress: (p) => prog(Object.assign({}, p, { message: 'Making the audio' })) });
      const blob = new Blob([wav16(r.wav, 24000)], { type: 'audio/wav' });
      return { samples: r.wav, sampleRate: 24000, duration: r.wav.length / 24000, wav: blob, timings: r.timings };
    });
  }
  /**
   * speak({text, refAudio, refText, refAttested, seed, signal, onProgress, language, beforeStage}) -> {wav (Blob audio/wav), url, samples, sampleRate,
   *   duration, seconds, seed, frames, eos, timings, peakMB, voiceCached}: the three stages in a row. beforeStage(stage, info) (async) runs
   *   before 'speak' and 'decode' (a page may reload there and continue with talk() / decodeLine()).
   */
  async speak(o = {}) {
    const t0 = performance.now();
    const a = await this.learnVoice(o);
    if (o.beforeStage) await o.beforeStage('speak', { voice: a });
    const b = await this.talk(Object.assign({}, o, { voiceKey: a.key }));
    if (o.beforeStage) await o.beforeStage('decode', { voice: a, talk: b });
    const c = await this.decodeLine(Object.assign({}, o, { voiceKey: a.key, codes: b.codes }));
    return { wav: c.wav, url: URL.createObjectURL(c.wav), samples: c.samples, sampleRate: 24000, duration: c.duration, seconds: (performance.now() - t0) / 1000,
      seed: b.seed, frames: b.frames, eos: b.eos, text: b.text, voiceCached: a.cached, voiceKey: a.key, timings: Object.assign({}, a.timings, b.timings, c.timings),
      peakMB: Math.max(a.peakMB, b.peakMB, c.peakMB), refSeconds: a.refSeconds, refRate: a.refRate, gpu: c.gpu, calib: c.calib, version: ENGINE_VERSION };
  }
  /** AAC .m4a of a result's samples (WebCodecs), or null when this browser has no AAC encoder */
  async toM4A(samples, sampleRate = 24000) { const r = await this.toM4AFull(samples, sampleRate); return r ? r.blob : null; }
  /** probes v002: AAC-LC mono .m4a (the ASC built from the rate + channels, never the encoder's description; real buffer size + bitrates)
   *  -> {blob, diag} or null (no encoder) */
  async toM4AFull(samples, sampleRate = 24000) {
    const caps = await audioCaps(1);
    if (!caps.aac) return null;
    let y = samples;
    if (sampleRate !== 48000) {
      const n = Math.ceil(samples.length * 48000 / sampleRate), oc = new OfflineAudioContext(1, n, 48000), b = oc.createBuffer(1, samples.length, sampleRate);
      b.copyToChannel(samples, 0); const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start(); y = (await oc.startRendering()).getChannelData(0);
    }
    const enc = await encodePcm([y], { aac: true, opus: false }, 48000);
    return { blob: new Blob([muxM4a(enc)], { type: 'audio/mp4' }), diag: enc.diag, seconds: y.length / 48000 };
  }
}
