// k9b_engine.js - p0pc0rn v026.6: FLUX.2 [klein] 9B ("Better pictures") as an app engine, from the Klein 9B probe (v001).
// Josh, Oct 14: "Wire 9B as a higher quality option. It worked." (probe on his iPhone: 512² in 131 s, peaks 182 / 400 / 371 MB).
//  - the probe's generalised Klein code (klein.js, kblocks.js, vae.js; core / ops / models shared with the app's other engines);
//  - the same pack and OPFS folder as the probe (pocketflux/k9b/pack), so a 9B the probe already downloaded is found as installed;
//  - the run in STAGES, each on its own GPU device that is destroyed after it: text (Qwen3-8B, cached per prompt) -> encode (an edit's
//    reference, the 4B engine's VAE encoder) -> denoise (4 steps, the latent saved after every step) -> decode. Before every stage after
//    the first, beforeStage(stage) lets the app open a fresh page (WebKit); the queue re-runs the job and the run resumes from its
//    checkpoints (the same job key: prompt, size, seed, steps, reference);
//  - textToImage and imageToImage (v026.6: the reference tokens appended to the image stream, like the 4B engine's edit).
// The model is under Black Forest Labs' FLUX Non-Commercial License v2.1; the app shows it once at download (app.js).
import { createGpu, toF16 } from '../core/gpu.js';
import { WeightStore } from '../core/store.js';
import { fetchManifest, manifestRefused } from '../core/pin.js';   // v027.3: pinned manifests
import { gemm } from '../ops/gemm.js';
import { attention } from '../ops/attention.js';
import { buildTokenizer } from '../models/tokenizer.js';
import { kleinDims, encodeText, ditPrepare, ditStep, ditFree, flux2Sigmas, gaussianTokens, kleinFlops } from './klein.js';
import { Flux2VAE, vaeDecodeFlops, vaeEncodeFlops } from './vae.js';

export const ENGINE_VERSION = 'k9b 1.0 (p0pc0rn v026.6)';
export const MODEL_ID = 'flux2-klein-9b';
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
const K = { calib: 'p0pc0rn:k9b:calib', cond: 'p0pc0rn:k9b:cond', job: 'p0pc0rn:k9b:job', running: 'pocketk9b:running' };
const DIR = 'pocketflux/k9b/pack', RUN = 'pocketflux/k9b/run', COND = 'pocketflux/k9b/cond', MAX_PIX = 1280 * 720;
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; };
const err = (code, message) => Object.assign(new Error(message), { code });
const abortErr = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
const shaHex = async (x) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof x === 'string' ? new TextEncoder().encode(x) : x)), (b) => b.toString(16).padStart(2, '0')).join('');

/** the probe's store: never overwrites the stored manifest with a server error (signed out / offline) */
class SafeStore extends WeightStore {
  async open() {
    if (this.http) return super.open();
    await this.st.start();
    let m = null;
    // v027.3: used and kept only when it matches config.js (its exact bytes are kept); offline or refused: the stored copy
    const got = await fetchManifest(this.base), j = got && got.m;
    if (j && j.format === 'pocketflux.pack' && j.format_version === 1 && j.shards && j.tensors) m = j;
    const path = `${this.dir}/manifest.json`;
    if (m) { const ab = got.ab; await this.st.call('write', { name: path, at: 0, buf: ab, truncate: 0 }, [ab]); await this.st.call('close', { name: path }); }
    else {
      const sz = (await this.st.call('size', { name: path })).size;
      if (got && got.bad) manifestRefused(got, sz > 0);
      if (sz <= 0) throw (got && got.bad ? err('BAD_MANIFEST', got.bad) : err('NOT_REACHABLE', 'the model list is not reachable (check the network)'));
      const r = await this.st.call('read', { name: path, at: 0, len: sz }); await this.st.call('close', { name: path });
      m = JSON.parse(new TextDecoder().decode(new Uint8Array(r.buf, 0, sz)));
      this.offline = true;
    }
    if (m.format !== 'pocketflux.pack' || m.format_version !== 1) throw err('BAD_PACK', 'unsupported pack format');
    this.m = m; this.shards = new Map(m.shards.map((x) => [x.name, x])); this.state = await this._loadState();
    return m;
  }
}

/** GEMM / attention throughput, measured once per phone (the probe's calibrate): every dispatch is sized under the ~0.2 s watchdog */
async function calibrate(g) {
  g.rate = { mm: 0.08e12, attn: 0.03e12, mem: 10e9 };
  const Mm = 1024, N = 3072, Kk = 3072, recs = (N / 64) * (Kk / 32), u = new Uint32Array(recs * 320);
  let s = 12345; for (let i = 0; i < u.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; u[i] = s >>> 0; }
  for (let r = 0; r < recs; r++) for (let j = 0; j < 64; j++) u[r * 320 + 256 + j] = 0x2000 | ((0xA800 | (j & 0x3f)) << 16);
  const h16 = (n) => { const h = new Uint16Array(n); for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; h[i] = (s & 0x83ff) | 0x3400; } return h; };
  const W = g.upload(u), X = g.upload(h16(Mm * Kk)), Y = g.buffer(Mm * N * 2), L = 1024, H = 8;
  const Qb = g.upload(h16(H * L * 128)), O = g.buffer(L * H * 256);
  const time = async (fn, reps) => { fn(); await g.done(); const ts = performance.now(); for (let i = 0; i < reps; i++) fn(); await g.done(); return (performance.now() - ts) / 1000 / reps; };
  try {
    const mm = (acc) => time(() => gemm(g, { w: { buf: W, off: 0, bytes: W._pf, enc: 'q4g32a.t64', rows: N, cols: Kk }, x: { buf: X }, M: Mm, N, K: Kk, epi: 'f16', y: { buf: Y }, acc }), 2);
    const t32 = await mm('f32'); g.rate.mm32 = Math.max(0.03e12, 0.8 * (2 * Mm * N * Kk) / t32);
    const t16 = await mm('f16'); g.rate.mm16 = Math.max(0.03e12, 0.8 * (2 * Mm * N * Kk) / t16);
    g.rate.mm = Math.min(g.rate.mm32, g.rate.mm16);
    const ta = await time(() => attention(g, { q: { buf: Qb }, k: { buf: Qb }, v: { buf: Qb }, o: { buf: O }, Lq: L, Lk: L, Hq: H, Hkv: H, mode: 0 }), 2);
    g.rate.attn = Math.max(0.015e12, 0.8 * (4 * L * L * 128 * H) / ta);
    g.calib = { gemmF32Gflops: Math.round(2 * Mm * N * Kk / t32 / 1e9), gemmF16Gflops: Math.round(2 * Mm * N * Kk / t16 / 1e9), attnGflops: Math.round(4 * L * L * 128 * H / ta / 1e9) };
  } finally { [W, X, Y, Qb, O].forEach((b) => g.free(b)); }
  return g.calib;
}
/** the 4B engine's picture prep: centre-cropped to the reference's aspect, drawn at its size */
async function prepareImage(image, w, h) {
  let bmp;
  try { bmp = image instanceof ImageBitmap ? image : await createImageBitmap(image); } catch (e) { throw err('BAD_IMAGE', 'Could not read that picture.'); }
  const ar = w / h, sw = Math.min(bmp.width, bmp.height * ar), sh = sw / ar, sx = (bmp.width - sw) / 2, sy = (bmp.height - sh) / 2;
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  return { data: x.getImageData(0, 0, w, h).data, width: w, height: h };
}
/** the 4B engine's reference size: 'full' = the output size, 'half' = half the output area (multiples of 16) */
export function referenceSize(w, h, mode) {
  if (mode === 'full') return [w, h];
  const s = Math.SQRT1_2; return [Math.max(256, Math.round(w * s / 16) * 16), Math.max(256, Math.round(h * s / 16) * 16)];
}

export async function createK9bEngine(opts = {}) { const e = new K9bEngine(opts); await e._init(); return e; }

class K9bEngine {
  constructor(opts) {
    this.opts = Object.assign({ model: MODEL_ID, packUrl: (globalThis.P0_CONFIG && globalThis.P0_CONFIG.packs[MODEL_ID]) || './pack/k9b/', source: 'opfs', dir: DIR, acc: 'f16' }, opts);
    this.listeners = new Map(); this.job = null; this.state = 'idle'; this.gpu = null; this._installed = false; this.tok = null;
  }
  get id() { return MODEL_ID; }
  emit(name, data) { (this.listeners.get(name) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  _setState(s) { this.state = s; this.emit('state', { state: s }); }
  async _init() {
    this.store = new SafeStore(null, { base: new URL(this.opts.packUrl, location.href).href, dir: this.opts.dir, source: this.opts.source });
    if (LS(K.running)) { LS(K.running, null); setTimeout(() => this.emit('warning', { code: 'KILLED_LAST_RUN', message: 'The last 9B picture was interrupted. Try again: it picks up where it stopped.' }), 0); }
  }
  async requestPersistentStorage() { try { return await navigator.storage.persist(); } catch (e) { return false; } }
  async _open() { if (!this.store.m) await this.store.open(); return this.store; }
  async status() { await this._open(); const s = this.store.status(); this._installed = s.complete; return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.store.m.pack_version }; }
  models() { return [{ id: MODEL_ID, kind: 'image', installed: this._installed }]; }
  async download({ onProgress, signal, parallel = 4 } = {}) {
    if (this.job) throw err('BUSY', 'A picture is being made.');
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      await this._open();
      let last = 0;
      const r = await this.store.download({ signal, parallel, onProgress: (p) => {
        const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard });
      } });
      this._installed = r.complete;
      return await this.status();
    } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; } finally { this._setState('idle'); }
  }
  async deleteModel() {
    if (this.job) throw err('BUSY', 'A picture is being made.');
    await this._open(); this.unload();
    if (!this.store.http) { await this.store.st.start(); await this.store.st.call('remove', { name: 'pocketflux/k9b' }); }
    this.store.state = { pack_version: this.store.m.pack_version, done: {} }; this._installed = false; LS(K.cond, null); LS(K.job, null);
  }
  cancel() { if (this.job) this.job.abort(); }
  unload() { if (this.job) return false; this._drop(); return true; }
  async _gpu() {
    if (this.gpu && !this.gpu.lost) return this.gpu;
    const g = await createGpu({ powerPreference: 'high-performance', onLost: () => this.emit('gpu-lost', {}) });
    const c = LS(K.calib);
    if (c && c.rate) { g.rate = c.rate; g.calib = c.calib; } else { await calibrate(g); LS(K.calib, { rate: g.rate, calib: g.calib, gpu: g.describe(), t: Date.now() }); }
    g.tune = this.opts.tune ? JSON.parse(JSON.stringify(this.opts.tune)) : { acc: this.opts.acc || 'f16', vaeAcc: 'f32', attn: { BQ: 64, sg: g.subgroups && g.sgMin >= 8, pv16: true } };   // opts.tune: a parity test runs with the 4B engine's own
    this.store.gpu = g; this.gpu = g; return g;
  }
  _drop() {
    const g = this.gpu; this.gpu = null; if (!g) return;
    try { if (this.store.drainPool) this.store.drainPool(); g.freeAll(); g.device.destroy(); } catch (e) { /* */ }
  }
  async _fread(name) {
    const st = this.store.st; await st.start(); const sz = (await st.call('size', { name })).size; if (sz <= 0) return null;
    const r = await st.call('read', { name, at: 0, len: sz }); await st.call('close', { name }); return r.buf.byteLength === sz ? r.buf : r.buf.slice(0, sz);
  }
  async _fwrite(name, data) {
    const ab = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), st = this.store.st;
    await st.start(); await st.call('write', { name, at: 0, buf: ab, truncate: 0 }, [ab]); await st.call('flush', { name }); await st.call('close', { name });
  }
  /** seconds per stage at this size, from the phone's calibration (the probe's model); null before the first run */
  estimate(W, H, steps = 4, edit = false) {
    const c = LS(K.calib); if (!c || !c.rate || !this.store.m) return null;
    const r = c.rate, d = kleinDims(this.store.m.model), nRef = edit ? (W / 16) * (H / 16) : 0, L = 512 + (W / 16) * (H / 16) + nRef, fl = kleinFlops(d, L);
    const att = (d.ND + d.NS) * 4 * L * L * 128 * d.NH, lin = fl.step - att, up = (c.uploadGBs || 1.0) * 1e9, sh = this.store.m.shards;
    const ditBytes = sh.filter((x) => x.kind === 'dit_double' || x.kind === 'dit_single').reduce((a, x) => a + x.bytes, 0);
    const teBytes = sh.filter((x) => x.kind === 'te_layer').reduce((a, x) => a + x.bytes, 0);
    const step = lin / (r.mm16 || r.mm) + att / r.attn + ditBytes / up;
    return { text: fl.text / r.mm32 + teBytes / up, encode: edit ? vaeEncodeFlops(H, W) / (r.mm32 * 0.85) : 0, step, decode: vaeDecodeFlops(H, W) / (r.mm32 * 0.85) };
  }

  textToImage(o = {}) { return this._run('t2i', o); }
  imageToImage(o = {}) { return this._run('i2i', o); }
  async _run(kind, o) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson in the app) before making anything.');
    if (this.job) throw err('BUSY', 'A picture is already being made.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    const prompt = String(o.prompt || '').trim(); if (!prompt) throw err('EMPTY_PROMPT', 'Type what you want to see.');
    const W = o.width || 1280, H = o.height || 720, steps = o.steps || 4, seed = o.seed != null ? o.seed >>> 0 : Math.floor(Math.random() * 2 ** 31);
    if (!Number.isInteger(W) || !Number.isInteger(H) || W % 16 || H % 16 || W < 256 || H < 256 || W * H > MAX_PIX) throw err('BAD_SIZE', 'Width and height must be multiples of 16, at most 1280x720 pixels.');
    await this._open();
    const st0 = this.store.status(); if (!st0.complete) throw err('NOT_DOWNLOADED', 'Download Klein 9B first (Settings › Models).');
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working');
    const t0 = performance.now(), timings = {};
    const prog = (p) => { this.emit('progress', p); if (o.onProgress) try { o.onProgress(p); } catch (e) { /* */ } };
    const check = () => { if (ctl.signal.aborted) throw abortErr(); if (this.gpu && this.gpu.lost) throw err('GPU_LOST', 'The GPU was reset.'); };
    const stage = async (name) => { this._drop(); LS(K.running, { stage: name, t: Date.now() }); if (o.beforeStage) await o.beforeStage(name); check(); };
    try {
      const dims = kleinDims(this.store.m.model), h = H / 16, w = W / 16, pv = this.store.m.pack_version;
      let image = null, imageHash = '', ref = null;
      if (kind === 'i2i') {
        if (!o.image) throw err('BAD_IMAGE', 'Pick a picture first.');
        const [rw, rh] = referenceSize(W, H, o.reference || 'half');
        image = await prepareImage(o.image, rw, rh); imageHash = await shaHex(image.data.buffer.slice(0)); ref = { h: rh / 16, w: rw / 16 };
      }
      const key = (await shaHex([pv, prompt, W, H, seed, steps, imageHash, o.reference || ''].join('\n'))).slice(0, 32);
      let job = LS(K.job); if (!job || job.key !== key) { job = { key, step: 0 }; LS(K.job, job); }
      const est = this.estimate(W, H, steps, kind === 'i2i') || { text: 30, encode: 10, step: 40, decode: 15 };
      const total = est.text + est.encode + steps * est.step + est.decode;
      let doneS = 0;
      const emit = (phase, frac, extra = {}, message = '') => prog(Object.assign({ phase, frac: Math.min(1, frac), steps, step: 0, etaSeconds: Math.max(0, Math.round(total - doneS)), message, model: MODEL_ID }, extra));
      // ---- text (Qwen3-8B), cached per prompt (the probe's format, the last 4 prompts)
      const ckey = (await shaHex(pv + '\n' + prompt)), cpath = `${COND}/k9b-${ckey.slice(0, 24)}.bin`, idx = LS(K.cond) || {}, list = idx.k9b || [];
      let cab = list.includes(ckey) ? await this._fread(cpath) : null;
      if (!cab) {
        emit('text', 0, {}, 'Reading the prompt'); LS(K.running, { stage: 'text', t: Date.now() });
        const g = await this._gpu(), ts = performance.now(), dec = new TextDecoder(), rd = async (f) => dec.decode(await this.store.readFile(f));
        if (!this.tok) this.tok = buildTokenizer(JSON.parse(await rd('tokenizer.vocab')), await rd('tokenizer.merges'), JSON.parse(await rd('tokenizer.tokenizer_config')));
        const r = await encodeText(g, this.store, dims, prompt, { tok: this.tok, check, onLayer: (l) => emit('text', (l + 1) / dims.TL * est.text / total, {}, 'Reading the prompt') });
        const ab = new Uint8Array(8 + r.data.byteLength); new Uint32Array(ab.buffer, 0, 2).set([r.T, r.nvalid]); ab.set(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength), 8);
        await this._fwrite(cpath, ab); cab = ab.buffer;
        idx.k9b = list.filter((k) => k !== ckey).concat(ckey).slice(-4); LS(K.cond, idx);
        timings.text = (performance.now() - ts) / 1000;
      } else timings.text = 0;
      doneS += est.text;
      const T = new Uint32Array(cab, 0, 2)[0], cond = { T, data: new Uint16Array(cab, 8) };
      // ---- encode: the reference picture -> its latent tokens (an edit), kept for this job
      let refTokens = null;
      if (ref) {
        const rp = `${RUN}/ref.bin`;
        if (job.ref) { const rb = await this._fread(rp); if (rb && rb.byteLength === ref.h * ref.w * 512) refTokens = new Float32Array(rb); }
        if (!refTokens) {
          await stage('encode'); emit('encode', doneS / total, {}, 'Reading your picture');
          const g = await this._gpu(), ts = performance.now(), f = new Float32Array(image.width * image.height * 3);
          for (let i = 0, j = 0; i < image.width * image.height; i++) { f[j++] = image.data[4 * i] / 255 * 2 - 1; f[j++] = image.data[4 * i + 1] / 255 * 2 - 1; f[j++] = image.data[4 * i + 2] / 255 * 2 - 1; }
          const ib = g.upload(toF16(f), 'vae.img'), vae = new Flux2VAE(g, {}), se = await this.store.upload('vae.enc'), bn = await this.store.uploadPart('vae.dec', ['bn.running_mean', 'bn.running_var']);
          try { refTokens = await vae.encode(se, bn, ib, image.height, image.width, { check }); }
          finally { this.store.release(se); g.runner.flush(); g.free(bn.buf); g.free(ib); }
          await this._fwrite(rp, refTokens.slice()); job.ref = true; LS(K.job, job);
          timings.encode = (performance.now() - ts) / 1000;
        }
        doneS += est.encode;
      }
      // ---- denoise: 4 steps, the latent saved after every step (a fresh page or a page death resumes at the next step)
      const lp = `${RUN}/latent.bin`, ts = performance.now(), stepSecs = [];
      let init = null, k0 = 0;
      if (job.step > 0) { const lab = await this._fread(lp); if (lab && lab.byteLength === h * w * 512) { init = new Float32Array(lab); k0 = job.step; } }
      const resumed = k0;
      if (k0 < steps) {
        await stage('denoise'); emit('denoise', doneS / total, { step: k0 }, 'Preparing');
        const g = await this._gpu(), sig = flux2Sigmas(W, H, steps);
        const S = await ditPrepare(g, this.store, dims, cond, sig, h, w, { refs: ref ? [{ h: ref.h, w: ref.w, tokens: refTokens }] : [] });
        let lat = null;
        try {
          lat = g.buffer(h * w * 512, 'latent'); g.upload(init || gaussianTokens(seed, h, w), '', lat);
          const read = new Float32Array(h * w * 128);
          for (let k = k0; k < steps; k++) {
            const tk = performance.now(); emit('denoise', (doneS + (k - k0) * est.step) / total, { step: k }, `Step ${k + 1} of ${steps}`);
            await ditStep(g, this.store, S, k, lat, { acc: g.tune.acc, check, onBlock: (i, n) => emit('denoise', (doneS + (k - k0 + (i + 1) / n) * est.step) / total, { step: k }, `Step ${k + 1} of ${steps}`) });
            await g.readInto(lat, 0, h * w * 512, read);
            await this._fwrite(lp, read.slice()); job.step = k + 1; LS(K.job, job);
            stepSecs.push(+((performance.now() - tk) / 1000).toFixed(1));
            const c = LS(K.calib); if (c && S.arena && S.arena.loadMs > 200) { c.uploadGBs = +(S.arena.loadBytes / 1e9 / (S.arena.loadMs / 1000)).toFixed(2); LS(K.calib, c); }
          }
        } finally { if (lat) g.free(lat); ditFree(g, S); }
        timings.denoise = (performance.now() - ts) / 1000; timings.steps = stepSecs;
      }
      doneS += steps * est.step;
      // ---- decode
      await stage('decode'); emit('decode', doneS / total, {}, 'Making the pixels');
      const lab = await this._fread(lp); if (!lab || lab.byteLength !== h * w * 512) throw err('LOST_CHECKPOINT', 'the saved picture state is missing; try again');
      const g = await this._gpu(), td = performance.now(), lat = g.upload(new Float32Array(lab), 'latent'), vae = new Flux2VAE(g, {});
      let out; const sd = await this.store.upload('vae.dec');
      try { out = await vae.decode(sd, lat, h, w, { check, onBlock: (i) => emit('decode', (doneS + (i + 1) / 16 * est.decode) / total, {}, 'Making the pixels') }); }
      finally { this.store.release(sd); if (this.store.drainPool) this.store.drainPool(); g.free(lat); }
      timings.decode = (performance.now() - td) / 1000;
      const c = new OffscreenCanvas(out.width, out.height); c.getContext('2d').putImageData(new ImageData(out.rgba, out.width, out.height), 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      LS(K.job, null);
      prog({ phase: 'done', frac: 1, steps, step: steps, etaSeconds: 0, message: 'Done', model: MODEL_ID });
      return { blob, url: URL.createObjectURL(blob), width: W, height: H, seed, steps, prompt, seconds: (performance.now() - t0) / 1000, timings, resumedFromStep: resumed, model: MODEL_ID,
        textCached: !timings.text, gpu: g.describe(), calib: g.calib };
    } catch (e) {
      if (e && e.name === 'AbortError') LS(K.job, null);
      if (this.gpu && this.gpu.lost) throw err('GPU_LOST', 'The GPU was reset. Try again: it picks up where it stopped.');
      const m = String((e && e.message) || e);
      if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Too big for this device; try a smaller size.');
      throw e;
    } finally { this._drop(); this.job = null; LS(K.running, null); this._setState('idle'); }
  }
}
