// p0pc0rn music engine (probe module 'music-0.2': + the optional 5 Hz LM lyrics planner, lm.js): ACE-Step 1.5 turbo text-to-music on WebGPU, pure JS + WGSL, no server.
//   createEngine({ model: 'acestep15-turbo', packUrl }) -> eng.textToMusic({ tags, lyrics, seconds, seed, signal, onProgress }) -> song
// Same conventions as the picture / video engine (ENGINE_API.md): download / status / deleteModel, cancel + AbortError, error codes,
// events ('progress', 'state', 'warning', 'gpu-lost'), KILLED_LAST_RUN, NO_CONSENT (the p0pc0rn terms record).  Shared engine files are
// used read-only; this module only adds files under engine/music/.
// Pipeline (no 5 Hz LM: the turbo DiT is run text2music directly, as the official code does with thinking=False):
//   tags -> SFT prompt -> Qwen3-Embedding (28 layers) -> text_projector | lyrics -> token rows -> lyric encoder (8 layers)
//   -> [lyrics | timbre const | text] -> condition_embedder -> cross K/V x 24 -> 8 turbo steps (shift 3, Euler + DCW) -> Oobleck VAE
//   (time tiles) -> peak-normalised to -1 dBFS (as the official pipeline) -> AAC .m4a (WebCodecs) or WAV.
// Phone safety: one phase at a time, every buffer of a phase freed and the queue drained before the next; the latent is checkpointed in
// OPFS after every step and every decoded tile, so a page kill resumes (same request) without paying the finished work again.
'use strict';
import { createGpu } from '../core/gpu.js';
import { WeightStore } from '../core/store.js';
import { gemm } from '../ops/gemm.js';
import { torchRandn } from '../audio/prep.js';
import { AceText, AceLyric, AceDiT, AceVae, formatPrompt, formatLyrics, ditStepFlops, vaeFlopsPerFrame, vaeTileBytes, VAE_HALO, MUSIC_VERSION } from './ace.js';
import { aceStep, cast16 } from './mops.js';
import { mattention } from './mattn.js';
import { audioCaps, encodeStereo, muxM4a, wavStereo16 } from './m4a.js';
import { AceLM, AceDetok, lmPrompts, LM_INSTRUCTION } from './lm.js';

export { MUSIC_VERSION };
export const MUSIC_MODELS = { 'acestep15-turbo': { arch: 'acestep15-turbo', kind: 'music', dir: 'engine/acestep15-turbo/pack', run: 'engine/acestep15-turbo/run', running: 'p0pc0rn-music:running', ckpt: 'p0pc0rn-music:ckpt' } };
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
const abortErr = () => { const e = new Error('cancelled'); e.name = 'AbortError'; e.code = 'ABORTED'; return e; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };
const hex = (ab) => Array.from(new Uint8Array(ab), (b) => b.toString(16).padStart(2, '0')).join('');
const fr = Math.fround;
export const SECONDS = { min: 10, max: 120 };

/** q8 GEMM (f32 / f16 accumulate) + BQ64 attention throughput -> gpu.rate (keeps every dispatch near 0.2 s) */
export async function calibrateMusic(g) {
  g.rate = { mm: 0.08e12, mm32: 0.08e12, mm16: 0.08e12, attn: 0.03e12, mem: 10e9 };
  const M = 768, N = 2048, K = 2048, recs = (N / 64) * (K / 64), u = new Uint32Array(recs * 1056);
  let s = 12345; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
  for (let i = 0; i < u.length; i++) u[i] = rnd() & 0x3f3f3f3f;
  for (let r = 0; r < recs; r++) for (let j = 0; j < 32; j++) u[r * 1056 + 1024 + j] = 0x20002000;
  const h16 = (n) => { const h = new Uint16Array(n); for (let i = 0; i < n; i++) h[i] = (rnd() & 0x83ff) | 0x3400; return h; };
  const W = g.upload(u), X = g.upload(h16(M * K)), Y = g.buffer(M * N * 2), L = 768, H = 16, Q = g.upload(h16(H * L * 128)), O = g.buffer(L * H * 256);
  const time = async (fn, reps) => { fn(); await g.done(); const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(); await g.done(); return (performance.now() - t0) / 1000 / reps; };
  try {
    const mm = (acc) => time(() => gemm(g, { w: { buf: W, off: 0, bytes: W._pf, enc: 'q8g64s.t64', rows: N, cols: K }, x: { buf: X }, M, N, K, epi: 'f16', y: { buf: Y }, acc }), 3);
    const t32 = await mm('f32'); g.rate.mm32 = Math.max(0.03e12, 0.8 * (2 * M * N * K) / t32);
    const t16 = await mm('f16'); g.rate.mm16 = Math.max(0.03e12, 0.8 * (2 * M * N * K) / t16);
    g.rate.mm = Math.min(g.rate.mm32, g.rate.mm16);
    const ta = await time(() => mattention(g, { q: { buf: Q }, k: { buf: Q }, v: { buf: Q }, o: { buf: O, ld: H * 128 }, Lq: L, Lk: L, Hq: H, Hkv: H, mode: 0, cfg: g.tune && g.tune.attn }), 2);
    g.rate.attn = Math.max(0.015e12, 0.8 * (4 * L * L * 128 * H) / ta);
    g.calib = { gemmF32Gflops: Math.round(2 * M * N * K / t32 / 1e9), gemmF16Gflops: Math.round(2 * M * N * K / t16 / 1e9), attnGflops: Math.round(4 * L * L * 128 * H / ta / 1e9) };
  } finally { [W, X, Y, Q, O].forEach((b) => g.free(b)); }
  return g.calib;
}

export async function createEngine(opts = {}) { const e = new MusicEngine(opts); await e._init(); return e; }

export class MusicEngine {
  constructor(opts) {
    this.opts = Object.assign({ model: 'acestep15-turbo', packUrl: './pack/', source: 'opfs', powerPreference: undefined }, opts);
    this.reg = MUSIC_MODELS[this.opts.model];
    if (!this.reg) throw err('UNSUPPORTED', 'unknown model ' + this.opts.model);
    this.listeners = new Map(); this.job = null; this.state = 'idle'; this.gpu = null; this._installed = false; this.lastRun = null;
  }
  emit(name, data) { (this.listeners.get(name) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
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
          c.maxBufferMB = Math.round(ad.limits.maxBufferSize / 1048576); this.apple = /apple/i.test(c.gpu);
          if (!ad.features.has('shader-f16')) c.reason = 'this GPU has no 16-bit float shaders (shader-f16)';
          else if (ad.limits.maxBufferSize < 256 * 1048576) c.reason = 'GPU buffers are too small';
          else c.supported = true;
        }
      }
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); c.storageQuotaGB = +((e.quota || 0) / 1e9).toFixed(1); }
      if (navigator.storage && navigator.storage.persisted) c.persisted = await navigator.storage.persisted();
      if (c.supported && this.opts.source !== 'http' && !(navigator.storage && navigator.storage.getDirectory)) { c.supported = false; c.reason = 'this browser has no private file storage (OPFS)'; }
      if (c.supported && this.opts.source !== 'http' && c.storageQuotaGB && c.storageQuotaGB < 3.5) { c.supported = false; c.reason = 'not enough storage (needs about 3.5 GB free)'; }
    } catch (e) { c.reason = String(e && e.message || e); }
    this.caps = c;
    this.store = new WeightStore(null, { base: this.opts.packUrl, dir: this.reg.dir, source: this.opts.source });
    // the optional lyrics planner (5 Hz LM 0.6B + detokenizer): its own manifest at <pack>/lm/ and its own storage folder
    this.lmStore = new WeightStore(null, { base: this.opts.lmPackUrl || (this.opts.packUrl.replace(/\/?$/, '/') + 'lm/'), dir: 'engine/acestep15-turbo/lm', source: this.opts.source });
    const run = LS(this.reg.running);
    if (run) {
      LS(this.reg.running, null);
      try { this.lastRun = JSON.parse(run); } catch (e) { this.lastRun = {}; }
      setTimeout(() => this.emit('warning', { code: 'KILLED_LAST_RUN', message: 'The last song was interrupted (the phone ran out of memory or got hot). Try again: finished steps are kept.', lastRun: this.lastRun }), 0);
    }
  }
  capabilities() { return Object.assign({}, this.caps); }
  async requestPersistentStorage() { try { const p = await navigator.storage.persist(); this.caps.persisted = p; return p; } catch (e) { return false; } }
  async _open() { if (!this.store.m) await this.store.open(); return this.store; }
  async status() { await this._open(); const s = this.store.status(); this._installed = s.complete; return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.store.m.pack_version }; }
  async download({ onProgress, signal, parallel } = {}) {
    if (this.job) throw err('BUSY', 'A song is being made.');
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      await this._open();
      const st0 = this.store.status();
      try { const e = await navigator.storage.estimate(); if (e.quota && e.quota - e.usage < st0.total - st0.have) this.emit('warning', { code: 'LOW_STORAGE', message: 'There may not be enough free storage for the music model.' }); } catch (e) { /* */ }
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
    if (this.job) throw err('BUSY', 'A song is being made.');
    await this._open();
    if (!this.store.http) { await this.store.st.start(); await this.store.st.call('remove', { name: 'engine/acestep15-turbo' }); }
    this.store.state = { pack_version: this.store.m.pack_version, done: {} }; this._installed = false; LS(this.reg.ckpt, null);
  }
  models() { return [{ id: this.opts.model, kind: 'music', installed: this._installed }, { id: 'acestep15-lm06', kind: 'music-planner', installed: !!this._lmInstalled }]; }
  /** the optional lyrics planner pack: {complete, haveBytes, totalBytes, packVersion} (complete false + totalBytes 0 when the server has none) */
  async lmStatus() {
    try { if (!this.lmStore.m) await this.lmStore.open(); } catch (e) { return { complete: false, haveBytes: 0, totalBytes: 0, error: String(e.message || e) }; }
    const s = this.lmStore.status(); this._lmInstalled = s.complete; return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.lmStore.m.pack_version };
  }
  async downloadLM({ onProgress, signal, parallel } = {}) {
    if (this.job) throw err('BUSY', 'A song is being made.');
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      if (!this.lmStore.m) await this.lmStore.open();
      let last = 0;
      const r = await this.lmStore.download({ signal, parallel, onProgress: (p) => {
        const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard });
      } });
      this._lmInstalled = r.complete;
      return Object.assign(await this.lmStatus(), { downloadedBytes: this.lmStore.stats.downloadBytes, seconds: this.lmStore.stats.downloadSec });
    } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; } finally { this._setState('idle'); }
  }
  async deleteLM() {
    if (this.job) throw err('BUSY', 'A song is being made.');
    if (!this.lmStore.m) await this.lmStore.open();
    if (!this.lmStore.http) { await this.lmStore.st.start(); await this.lmStore.st.call('remove', { name: 'engine/acestep15-turbo/lm' }); }
    this.lmStore.state = { pack_version: this.lmStore.m.pack_version, done: {} }; this._lmInstalled = false;
  }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  cancel() { if (this.job) this.job.abort(); }
  /** the unfinished song of the last run ({tags, seconds, seed, step, tiles}) or null; textToMusic with the same request resumes it */
  musicCheckpoint() { try { return JSON.parse(LS(this.reg.ckpt) || 'null'); } catch (e) { return null; } }
  /** test tools: {acc: DiT accumulate 'f16'|'f32', vaeAcc, lyrAcc, decodeBudgetMB, tileFrames} */
  tune(o = {}) { Object.assign(this.opts, o); if (this.gpu) this.gpu.tune = Object.assign(this.gpu.tune || {}, o.acc ? { acc: o.acc } : {}); return Object.assign({}, this.opts); }
  async load() { if (this.job) throw err('BUSY', 'Busy.'); await this._load(); return { gpu: this.gpu.describe(), calib: this.gpu.calib, tune: this.gpu.tune }; }
  async _load() {
    await this._open();
    if (!this.store.status().complete) throw err('NOT_DOWNLOADED', 'Download the music model first.');
    this._installed = true;
    const arch = this.store.m.model && this.store.m.model.arch;
    if (arch !== this.reg.arch) throw err('UNSUPPORTED', `pack is ${arch}, this engine needs ${this.reg.arch}`);
    if (!this.gpu || this.gpu.lost) {
      this.gpu = await createGpu({ powerPreference: this.opts.powerPreference || 'high-performance', wantSubgroups: false, onLost: () => this.emit('gpu-lost', {}) });
      this.gpu.tune = { acc: this.opts.acc || (this.apple ? 'f16' : 'f32'), attn: { BQ: 64, sg: false, pv16: true } };
      await calibrateMusic(this.gpu);
      this.store.gpu = this.gpu;
    }
    if (!this.store.http) await this.store.st.start();
    return this.gpu;
  }
  async _ck(name, data) {
    if (this.store.http) { this._mem = this._mem || {}; this._mem[name] = data.slice(); return; }
    const st = this.store.st, p = `${this.reg.run}/${name}`, ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await st.call('write', { name: p, at: 0, buf: ab, truncate: 0 }, [ab]); await st.call('flush', { name: p });
  }
  async _ckAt(name, data, at) {
    if (this.store.http) { this._mem = this._mem || {}; const o = this._mem[name] || new Float32Array(0); const need = at / 4 + data.length; let b = o; if (o.length < need) { b = new Float32Array(need); b.set(o); } b.set(data, at / 4); this._mem[name] = b; return; }
    const st = this.store.st, p = `${this.reg.run}/${name}`, ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await st.call('write', { name: p, at, buf: ab }, [ab]); await st.call('flush', { name: p });
  }
  /** p0pc0rn v024.2: bytes [at, at + bytes) of a checkpoint file -> Float32Array, or null if it is shorter */
  async _rdAt(name, at, bytes) {
    if (this.store.http) { const m = this._mem && this._mem[name]; return m && m.length * 4 >= at + bytes ? m.slice(at / 4, (at + bytes) / 4) : null; }
    const st = this.store.st, p = `${this.reg.run}/${name}`, sz = (await st.call('size', { name: p })).size;
    if (sz < at + bytes) return null;
    const rr = await st.call('read', { name: p, at, len: bytes }); return new Float32Array(rr.buf.slice(0, bytes));
  }
  async _rd(name, bytes) {
    if (this.store.http) { const m = this._mem && this._mem[name]; return m && m.length * 4 >= bytes ? m.slice(0, bytes / 4) : null; }
    const st = this.store.st, p = `${this.reg.run}/${name}`, sz = (await st.call('size', { name: p })).size;
    if (sz < bytes) return null;
    const r = await st.call('read', { name: p, at: 0, len: bytes }); return new Float32Array(r.buf.slice(0, bytes));
  }

  /** {tags, lyrics, seconds (10..120, default 30), seed, bpm, keyscale, timesignature, language ('en'), shift (3), signal, onProgress, resume (true),
   *   lm (the lyrics planner: default = on when downloaded; with it on, missing bpm / key / time signature default to 120 / C major / 4 because
   *   the planner's own meta pass is not run),
   *   format ('m4a' | 'wav')} -> {blob, url, wavBlob, mime, codec, seconds, sampleRate, channels, seed, timings, peakMB, resumedFromStep, ...} */
  async textToMusic(o = {}) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson in the app) before making anything.');
    if (this.job) throw err('BUSY', 'A song is already being made.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run the engine.');
    const tags = String(o.tags || '').trim(), lyrics = String(o.lyrics == null ? '' : o.lyrics).trim() || '[Instrumental]';
    if (!tags) throw err('EMPTY_PROMPT', 'Describe the music (style, instruments, voice).');
    const seconds = o.seconds == null ? 30 : +o.seconds;
    if (!(seconds >= SECONDS.min && seconds <= SECONDS.max)) throw err('BAD_SIZE', `Length must be ${SECONDS.min}..${SECONDS.max} seconds.`);
    const seed = o.seed != null ? o.seed >>> 0 : Math.floor(Math.random() * 2 ** 31), shift = o.shift || 3;
    let lm = o.lm;
    if (lm == null) lm = (await this.lmStatus()).complete;                 // default: on when the planner is installed
    else if (lm && !(await this.lmStatus()).complete) throw err('NOT_DOWNLOADED', 'Download the lyrics planner first (or switch it off).');
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working');
    const t0 = performance.now(), prog = (p) => { this.emit('progress', p); if (o.onProgress) try { o.onProgress(p); } catch (e) { /* */ } };
    try {
      LS(this.reg.running, JSON.stringify({ phase: 'load', seconds, t: Date.now() }));
      prog({ phase: 'load', frac: 0, step: 0, steps: 8, etaSeconds: null, message: 'Preparing' });
      const g = await this._load();
      const check = () => { if (ctl.signal.aborted) throw abortErr(); if (g.lost) throw err('GPU_LOST', 'The GPU was reset.'); };
      try {
        return await this._run({ tags, lyrics, seconds, seed, shift, lm: !!lm, bpm: o.bpm || (lm ? 120 : undefined), keyscale: o.keyscale || (lm ? 'C major' : undefined), timesignature: o.timesignature || (lm ? '4' : undefined), language: o.language || 'en',
          format: o.format || 'm4a', resume: o.resume !== false, check, prog, t0, test: o._test || null, beforeStage: typeof o.beforeStage === 'function' ? o.beforeStage : null });
      } catch (e) {
        if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
        if (g.lost) { this.gpu = null; throw err('GPU_LOST', 'The GPU was reset. Try again: finished steps are kept.'); }
        if (e && e.code) throw e;
        const m = String(e && e.message || e) + ' ' + String(g.lastError || '');
        if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Too big for this device; try a shorter song.');
        throw e;
      }
    } finally { this.job = null; LS(this.reg.running, null); this._setState('idle'); }
  }

  async _run(r) {
    const g = this.gpu, st = this.store, T = Math.round(r.seconds * 25), steps = 8, live = (phase, extra) => LS(this.reg.running, JSON.stringify(Object.assign({ phase, seconds: r.seconds, t: Date.now() }, extra || {})));
    const sched = (this.store.m.model.dit.schedules[String(r.shift)] || this.store.m.model.dit.schedules['3']).map(fr);
    const key = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([r.tags, r.lyrics, r.seconds, r.seed, r.shift, r.bpm, r.keyscale, r.timesignature, r.language, st.m.pack_version, r.lm ? this.lmStore.m.pack_version : 0])))).slice(0, 32);
    let ck = null; try { ck = JSON.parse(LS(this.reg.ckpt) || 'null'); } catch (e) { ck = null; }
    if (!r.resume || !ck || ck.key !== key) ck = { key, tags: r.tags.slice(0, 80), seconds: r.seconds, seed: r.seed, step: 0, tiles: 0, peak: 0 };
    const saveCk = () => LS(this.reg.ckpt, JSON.stringify(ck));
    const T_ = {}, steps_t = []; let lap = performance.now(); const done = (k) => { const n = performance.now(); T_[k] = +((n - lap) / 1000).toFixed(2); lap = n; };
    g.resetPeak(); let peak = 0; const pk = () => { peak = Math.max(peak, g.peak); };
    const flopsStep = ditStepFlops(T, 400), rate = g.tune.acc === 'f16' ? g.rate.mm16 : g.rate.mm32;
    const eta = (k) => Math.round((steps - k) * flopsStep / (rate / 0.8) + T * vaeFlopsPerFrame / (g.rate.mm16 / 0.8));
    const resumedFromStep = ck.step, test = r.test || {};
    let x = null;
    if (ck.step >= steps) x = await this._rd('x.f32', T * 64 * 4);
    if (!x) { if (ck.step >= steps) ck.step = 0; }
    const dit = new AceDiT(g, st); await dit.loadConst();
    // ---- the lyrics planner (5 Hz LM): codes -> 25 Hz hints, checkpointed (a kill after it never pays it again)
    let hints = null;
    if (r.lm) {
      if (ck.lm) hints = await this._rd('hints.f32', T * 64 * 4);
      if (!hints) {
        if (!this.lmStore.http) await this.lmStore.st.start();
        this.lmStore.gpu = g; live('plan');
        r.prog({ phase: 'plan', frac: 0.01, step: 0, steps, etaSeconds: null, message: 'Planning the song: loading' });
        const te0 = new AceText(g, st), tok = await te0.tokenizer(), P_ = lmPrompts({ tags: r.tags, lyrics: r.lyrics, bpm: r.bpm, keyscale: r.keyscale, timesignature: r.timesignature, seconds: r.seconds });
        const idsC = Array.from(tok.encode(P_.cond, { add_special_tokens: false }).ids), idsU = Array.from(tok.encode(P_.uncond, { add_special_tokens: false }).ids);
        const lmn = new AceLM(g, this.lmStore, st); let res;
        try {
          await lmn.load(); pk();
          const tl = performance.now();
          res = await lmn.generate(idsC, idsU, { seconds: r.seconds, seed: r.seed, check: r.check, forced: test.lmForced, keepLogits: test.keepLmLogits,
            onToken: (n, N) => { if ((n & 15) === 0 || n === N) r.prog({ phase: 'plan', frac: 0.01 + 0.2 * n / N, step: 0, steps, etaSeconds: Math.round((N - n) * (performance.now() - tl) / 1000 / Math.max(1, n)), message: `Planning the song: ${n} of ${N}` }); } });
          pk();
        } finally { lmn.unload(); await g.done(); }
        const kept = res.info.kept.slice().sort((a, b) => a - b);
        this.lastPlan = { codes: res.codes.length, promptTokens: [idsC.length, idsU.length], prefill: +res.info.prefill.toFixed(2), decode: +res.info.decode.toFixed(2), keptMedian: kept.length ? kept[kept.length >> 1] : null };
        if (test.keepCodes) test.keepCodes(res.codes, idsC, idsU);
        done('plan');
        r.prog({ phase: 'plan', frac: 0.22, step: 0, steps, etaSeconds: null, message: 'Planning the song: shaping' });
        const hh = await new AceDetok(g, this.lmStore).run(res.codes, { keepQuantized: test.keepQuantized });
        hints = hh.subarray(0, Math.min(hh.length, T * 64)); pk(); done('hints');
        if (test.keepHints) test.keepHints(hints);
        await this._ck('hints.f32', hints); ck.lm = true; saveCk();
      } else done('plan');
    }
    // p0pc0rn v024.2: a planned fresh page here on WebKit (the app decides): the plan is in the checkpoint, the planner's 0.7 GB is not
    if (r.beforeStage && ck.step < steps) await r.beforeStage('denoise');
    if (ck.step < steps) {
      // ---- conditioning (always recomputed on resume: a few seconds)
      live('text'); r.prog({ phase: 'text', frac: 0.01, step: 0, steps, etaSeconds: eta(ck.step), message: 'Reading the style' });
      const te = new AceText(g, st);
      const tp = await te.ids(formatPrompt({ tags: r.tags, bpm: r.bpm, keyscale: r.keyscale, timesignature: r.timesignature, seconds: r.seconds, instruction: r.lm ? LM_INSTRUCTION : undefined }), 256);
      const ly = await te.ids(formatLyrics(r.lyrics, r.language), 2048);
      const Lt = tp.ids.length, Ll = ly.ids.length, Lenc = Ll + 1 + Lt;
      const Ein = g.buffer(Lenc * 2048 * 2, 'dit.Ein');
      try {
        await te.encode(tp.ids, { buf: Ein, off: (Ll + 1) * 2048 * 2 }, { check: r.check, keepX: test.keepTE });
        pk(); done('text');
        live('lyrics'); r.prog({ phase: 'lyrics', frac: 0.03, step: 0, steps, etaSeconds: eta(ck.step), message: 'Reading the lyrics' });
        await new AceLyric(g, st).encode(await te.rows(ly.ids), Ll, { buf: Ein, off: 0 }, { check: r.check, acc: this.opts.lyrAcc || 'f32', keepX: test.keepLyr });
        pk(); done('lyrics');
      } catch (e) { g.free(Ein); throw e; }
      if (test.keepEin) test.keepEin(new Uint16Array(await g.read(Ein)));
      live('cond'); r.prog({ phase: 'cond', frac: 0.05, step: 0, steps, etaSeconds: eta(ck.step), message: 'Preparing the band' });
      await dit.prepare(Ein, Ll, Lenc, { check: r.check, keepE: test.keepE });
      pk(); done('cond');
      this.lastTokens = { text: Lt, lyrics: Ll, truncated: tp.truncated || ly.truncated };
      // ---- denoise
      try {
        dit.alloc(T, hints);
        x = null;
        if (ck.step > 0) x = await this._rd('x.f32', T * 64 * 4);
        if (!x) { ck.step = 0; x = test.noise || torchRandn(T * 64, r.seed); }
        dit.setX(x);
        for (let k = ck.step; k < steps; k++) {
          live('denoise', { step: k });
          r.prog({ phase: 'denoise', frac: 0.06 + 0.7 * k / steps, step: k, steps, etaSeconds: eta(k), message: `Step ${k + 1} of ${steps}` });
          const ts = performance.now();
          await dit.forward(sched[k], { check: r.check, acc: g.tune.acc, taps: test.taps && k === 0 ? test.taps : null });
          const last = k === steps - 1, t = sched[k], tn = last ? 0 : sched[k + 1];
          if (test.keepV) test.keepV(k, new Float32Array(await g.read(dit.s.v, 0, T * 64 * 4)));
          aceStep(g, { x: { buf: dit.s.xt }, v: { buf: dit.s.v }, s: { buf: dit.s.S16 }, T, last, t, dt: fr(t - tn), kl: fr(0.05 * t), kh: fr(0.02 * (1 - t)) });
          g.runner.flush();
          x = new Float32Array(await g.read(dit.s.xt, 0, T * 64 * 4));
          await this._ck('x.f32', x); ck.step = k + 1; saveCk();
          if (test.keepX) test.keepX(k, x);
          steps_t.push(+((performance.now() - ts) / 1000).toFixed(2)); pk(); r.check();
        }
      } finally { dit.freeState(); dit.freeKV(); st.drainPool(); await g.done(); }   // p0pc0rn v024.1: the kept DiT layer buffer goes before the decode
      done('denoise');
    } else done('denoise');
    // p0pc0rn v024.2: a planned fresh page here on WebKit (the app decides): the planner's and the DiT's destroyed GPU memory is given
    // back late there, and the page died part-way through the decode. The denoised latent is in the checkpoint, so the next page starts here.
    if (r.beforeStage) await r.beforeStage('decode');
    // ---- decode: Oobleck VAE in time tiles (halo 12 latent frames each side = exact), waveform parts checkpointed in OPFS
    live('decode'); g.resetPeak(); st.drainPool();
    r.prog({ phase: 'decode', frac: 0.78, step: steps, steps, etaSeconds: null, message: 'Sound: loading the decoder' });   // p0pc0rn v024.1: a sub-step for the diagnostics
    const vae = new AceVae(g, st); await vae.load();
    const budget = (this.opts.decodeBudgetMB || (this.apple ? 450 : 1200)) * 1e6, wB = vae.weightBytes;
    let core = this.opts.tileFrames || 256; while (core > 16 && wB + vaeTileBytes(core + 2 * VAE_HALO) + T * 128 > budget) core = Math.floor(core / 2);
    if (ck.tiles > 0 && ck.core && ck.core !== core) { ck.tiles = 0; ck.peak = 0; }   // v024.2: a different part size than the checkpoint's parts: decode again
    const tiles = Math.ceil(T / core), N = T * 1920;
    // v024.2: the whole song's L / R, filled part by part (no per-part arrays); the parts decoded before a reload come from the checkpoint
    const L = new Float32Array(N), R = new Float32Array(N);
    for (let i = 0; i < Math.min(ck.tiles, tiles); i++) {
      const c0 = i * core, c1 = Math.min(T, c0 + core), n = (c1 - c0) * 1920;
      const pr = await this._rdAt('wave.f32', c0 * 1920 * 2 * 4, n * 2 * 4);
      if (!pr) { ck.tiles = i; break; }
      L.set(pr.subarray(0, n), c0 * 1920); R.set(pr.subarray(n, 2 * n), c0 * 1920);
    }
    if (ck.tiles < tiles) {
      const zb = g.buffer(T * 64 * 2, 'vae.z'), raw = new Float32Array(core * 1920 * 4);   // one readback array for every part
      try {
        const xb = g.upload(x, 'vae.x32'); cast16(g, { x: { buf: xb }, y: { buf: zb }, rows: T, C: 64 }); g.runner.flush(); await g.done(); g.free(xb);
        vae.arena(Math.min(T, core + 2 * VAE_HALO));   // v024.2: the decoder's working set, once, before part 1
        for (let i = ck.tiles; i < tiles; i++) {
          // v024.2: the live buffer count / bytes and the bind groups made so far, in every part: they must stay flat from part 1 to part n
          r.prog({ phase: 'decode', frac: 0.78 + 0.18 * i / tiles, step: steps, steps, etaSeconds: Math.round((tiles - i) * core * vaeFlopsPerFrame / (g.rate.mm16 / 0.8)), message: `Sound: part ${i + 1} of ${tiles}`,
            gpuBufs: g.bufs.size, gpuMB: Math.round(g.alive / 1e6), bindGroups: g.runner.bgNew, readbacks: g.readbacks || 0 });
          const c0 = i * core, c1 = Math.min(T, c0 + core), s0 = Math.max(0, c0 - VAE_HALO), s1 = Math.min(T, c1 + VAE_HALO), n = (c1 - c0) * 1920;
          const W = vae.decodeTile(zb, s0, s1 - s0, this.opts.vaeAcc || g.tune.acc);   // the arena's buffer: read, never freed
          g.runner.flush(); pk();
          await g.readInto(W, (c0 - s0) * 1920 * 16, n * 16, raw);
          let pmax = 0;
          for (let j = 0, o = c0 * 1920; j < n; j++) { const a = raw[j * 4], b = raw[j * 4 + 1]; L[o + j] = a; R[o + j] = b; pmax = Math.max(pmax, Math.abs(a), Math.abs(b)); }
          await this._ckAt('wave.f32', L.subarray(c0 * 1920, c1 * 1920), c0 * 1920 * 2 * 4);   // the checkpoint keeps its layout: [L part][R part]
          await this._ckAt('wave.f32', R.subarray(c0 * 1920, c1 * 1920), c0 * 1920 * 2 * 4 + n * 4);
          ck.tiles = i + 1; ck.peak = Math.max(ck.peak, pmax); ck.core = core; saveCk();
          await g.done();   // v024.2: the part's GPU work is finished before the next part starts
          r.check();
        }
      } finally { g.free(zb); vae.unload(); st.drainPool(); await g.done(); }
    } else vae.unload();
    done('decode');
    // ---- assemble -> peak-normalise to -1 dBFS (the official decode + normalize_audio) -> m4a / wav
    live('encode'); r.prog({ phase: 'encode', frac: 0.97, step: steps, steps, etaSeconds: 2, message: 'Saving the song' });
    { const gain = ck.peak > 1e-6 ? Math.pow(10, -1 / 20) / ck.peak : 1; for (let i = 0; i < N; i++) { L[i] *= gain; R[i] *= gain; } }
    let blob = null, codec = 'wav', encErr = null, wavBlob = null, aacDiag = null;   // v026.1: what the encoder handed back (diagnostics)
    const caps = await audioCaps();
    if (r.format !== 'wav' && (caps.aac || caps.opus)) {
      r.prog({ phase: 'encode', frac: 0.975, step: steps, steps, etaSeconds: 2, message: 'Saving: encoding the sound' });
      try { let enc = await encodeStereo(L, R, caps); if (enc) { r.prog({ phase: 'encode', frac: 0.985, step: steps, steps, etaSeconds: 1, message: 'Saving: packing the file' }); blob = new Blob([muxM4a(enc)], { type: 'audio/mp4' }); codec = enc.codec; aacDiag = enc.diag || null; enc = null; } } catch (e) { encErr = String(e && e.message || e); }
    }
    // p0pc0rn v024.1: the WAV copy only when there is no AAC / Opus file (it was always built, the size of the song again, then dropped)
    if (!blob) { r.prog({ phase: 'encode', frac: 0.985, step: steps, steps, etaSeconds: 1, message: 'Saving: writing a WAV file' }); wavBlob = new Blob([wavStereo16(L, R)], { type: 'audio/wav' }); blob = wavBlob; }
    done('encode');
    LS(this.reg.ckpt, null);
    const seconds = (performance.now() - r.t0) / 1000;
    return { blob, url: URL.createObjectURL(blob), wavBlob, mime: blob.type, codec, encErr, aacDiag, caps, seconds, durationSec: N / 48000, sampleRate: 48000, channels: 2, seed: r.seed,
      tags: r.tags, lyrics: r.lyrics, lm: r.lm, plan: r.lm ? this.lastPlan || null : null, timings: Object.assign({ steps: steps_t }, T_), peakMB: Math.round(peak / 1e6), resumedFromStep, tokens: this.lastTokens,
      tile: { core, tiles, halo: VAE_HALO }, gpu: g.describe(), calib: g.calib, tune: Object.assign({}, g.tune, { vaeAcc: this.opts.vaeAcc || g.tune.acc, lyrAcc: this.opts.lyrAcc || 'f32' }),
      _L: test.keepWave ? L : undefined, _R: test.keepWave ? R : undefined };
  }
}
