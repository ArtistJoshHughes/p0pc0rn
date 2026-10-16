// p0pc0rn lip-sync pipeline (MuseTalk 1.5): clip + speech -> the clip with the mouth re-animated to the speech, H.264 + AAC/Opus MP4.
//   frames (WebCodecs VideoDecoder, <video> fallback) -> audio (16 kHz, log-mel, whisper-tiny encoder, per-frame windows)
//   -> faces (MediaPipe BlazeFace + 478-point mesh, WGSL) -> crop boxes (MuseTalk v1.5 rules) -> 256x256 crops (cv2 Lanczos4 port)
//   -> SD-VAE encode (masked + reference) -> UNet (chunks of B frames, one pass, t = 0) -> SD-VAE decode -> paste back with the mesh
//   mask (MuseTalk 'jaw' rules) -> WebCodecs H.264 -> mux with the speech (AAC / Opus)
// Phone safety: one phase at a time, every phase frees its GPU buffers; frames live in OPFS, never all in JS; checkpoints after the
// audio prompts, the faces, every encoded frame batch, every UNet chunk and every decoded frame (a kill resumes where it stopped).
'use strict';
import { createGpu } from './lgpu.js';   // p0pc0rn Cast: the probe v002 core (recycling pool, writeBuffer guard, stats)
import { WeightStore } from './lstore.js';   // p0pc0rn Cast: + slab uploads (the UNet's weights through one buffer)
import { readVideoTrack, remuxWithAudio, wavPcm16 } from '../audio/mp4av.js';
import { audioCaps, encodePcm } from '../media/m4a.js';
import { encodeMp4 } from './media.js';
import { h2f, f2h } from '../core/gpu.js';
import { lgemm } from './lgemm.js';
import { lattn } from './lattn.js';
import { MuseUNet, unetFlopsPerFrame } from './unet.js';
import { SDVae, encodeLatent, vaeInput, vaeEncFlops, vaeDecFlops } from './sdvae.js';
import { WhisperEnc, resampleTo16k, logMel, audioPrompts } from './whisper.js';
import { FaceTracker, museBox } from './face.js';
import { cropTo256, cropBox, meshMask, pasteBack, pasteBackV2, mouthSharpness } from './blend.js';

export const LIPSYNC_VERSION = 'lipsync-0.2';
// probes v002 (Oct 14): p0pc0rn v028's core (zero-copy loader, one readback buffer, uniform ring, bind-group cache) + a recycling pool (no
// GPU buffer is created or destroyed per frame / chunk / part after the first), the UNet's weights streamed through ONE slab (was: a new
// buffer per block per chunk, ~0.9 GB created + destroyed per chunk), each phase's buffers destroyed at its end, beforeStage(stage) between
// phases (a page may reload there: everything is checkpointed), the frames not re-decoded on a resume, the AAC track Safari-safe.
// v002: the VAE accumulates in f16 (a desktop test GPU, 24 frames: decoder 5.4x faster than f32, the drawn mouths 64 dB from f32's; encoder 5.7x
// faster, latents within 0.11 % (rel L2), the final mouths 60-61 dB from the all-f32 path, max 2-6 levels of 255)
export const VAE_DEC_ACC = 'f16', VAE_ENC_ACC = 'f16';
const fnv = (arr) => { const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0; return h.toString(16).padStart(8, '0'); };
const CALIB_KEY = 'pocketlipsync:calib';
function calibCached(g) {
  try { const c = JSON.parse(localStorage.getItem(CALIB_KEY) || 'null'), id = JSON.stringify(g.info);
    if (c && c.id === id && c.v === LIPSYNC_VERSION) { g.rate = c.rate; g.calib = Object.assign({ cached: true }, c.calib); return true; } } catch (e) { /* */ }
  return false;
}
function calibSave(g) { try { localStorage.setItem(CALIB_KEY, JSON.stringify({ id: JSON.stringify(g.info), v: LIPSYNC_VERSION, rate: g.rate, calib: g.calib })); } catch (e) { /* */ } }
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };
export const RUN_KEY = 'pocketlipsync:run', LIVE_KEY = 'pocketlipsync:live', CACHE_KEY = 'pocketlipsync:clipcache';
const hex = (ab) => Array.from(new Uint8Array(ab), (b) => b.toString(16).padStart(2, '0')).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

/** time a q8 lgemm (f32 / f16 accumulate) and the d=64 attention; sets gpu.rate for ~0.2 s dispatches */
export async function calibrateLs(g) {
  g.rate = { mm: 0.08e12, mm32: 0.08e12, mm16: 0.08e12, attn: 0.03e12, mem: 10e9 };
  const M = 1024, N = 1280, K = 1280, recs = (N / 64) * (K / 64), u = new Uint32Array(recs * 1056);
  let s = 12345; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
  for (let i = 0; i < u.length; i++) u[i] = rnd() & 0x3f3f3f3f;
  for (let r = 0; r < recs; r++) for (let j = 0; j < 32; j++) u[r * 1056 + 1024 + j] = 0x20002000;
  const h16 = (n) => { const h = new Uint16Array(n); for (let i = 0; i < n; i++) h[i] = (rnd() & 0x83ff) | 0x3400; return h; };
  const W = g.upload(u), X = g.upload(h16(M * K)), Y = g.buffer(M * N * 2), L = 1024, Q = g.upload(h16(L * 960)), O = g.buffer(L * 320 * 2);
  const time = async (fn, reps) => { fn(); await g.done(); const t0 = now(); for (let i = 0; i < reps; i++) fn(); await g.done(); return (now() - t0) / 1000 / reps; };
  try {
    const mm = (acc) => time(() => lgemm(g, { w: { buf: W, off: 0, bytes: W._pf, enc: 'q8g64s.t64', rows: N, cols: K }, x: { buf: X }, M, N, K, epi: 'f16', y: { buf: Y }, acc }), 3);
    const t32 = await mm('f32'); g.rate.mm32 = Math.max(0.03e12, 0.8 * (2 * M * N * K) / t32);
    const t16 = await mm('f16'); g.rate.mm16 = Math.max(0.03e12, 0.8 * (2 * M * N * K) / t16);
    g.rate.mm = Math.min(g.rate.mm32, g.rate.mm16);
    const ta = await time(() => lattn(g, { Dr: 40, B: 1, H: 8, Lq: L, Lk: L, scale: 0.158, q: { buf: Q, off: 0, ld: 960, hS: 40, bS: 0 }, k: { buf: Q, off: 320, ld: 960, hS: 40, bS: 0 },
      v: { buf: Q, off: 640, ld: 960, hS: 40, bS: 0 }, o: { buf: O, off: 0, ld: 320, hS: 40, bS: 0 } }), 2);
    g.rate.attn = Math.max(0.015e12, 0.8 * (4 * L * L * 64 * 8) / ta);
    g.calib = { gemmF32Gflops: Math.round(2 * M * N * K / t32 / 1e9), gemmF16Gflops: Math.round(2 * M * N * K / t16 / 1e9), attnGflops: Math.round(4 * L * L * 40 * 8 / ta / 1e9) };
  } finally { [W, X, Y, Q, O].forEach((b) => g.free(b)); }
  return g.calib;
}

// ------------------------------------------------------------------ inputs
function avcCodec(stsd) {   // 'avc1.PPCCLL' from the avcC record inside the copied stsd box
  for (let i = 0; i + 8 < stsd.length; i++) if (stsd[i] === 0x61 && stsd[i + 1] === 0x76 && stsd[i + 2] === 0x63 && stsd[i + 3] === 0x43) {
    const sz = (stsd[i - 4] << 24 | stsd[i - 3] << 16 | stsd[i - 2] << 8 | stsd[i - 1]) >>> 0, body = stsd.subarray(i + 4, i - 4 + sz);
    const h = (v) => v.toString(16).padStart(2, '0'); return { codec: `avc1.${h(body[1])}${h(body[2])}${h(body[3])}`, description: body.slice() };
  }
  return null;
}
/** video Blob -> {n, W, H, fps, track, put(i, rgba) stored by the caller} ; frames delivered in presentation order to onFrame(i, rgba) */
export async function decodeVideo(blob, { onFrame, onProgress, check, maxFrames = 1000 } = {}) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let track = null; try { track = readVideoTrack(u8); } catch (e) { track = null; }
  const durs = track ? track.samples.map((s, i, a) => (i + 1 < a.length ? a[i + 1].dts - s.dts : null)).filter((d) => d) : [];
  const fps = track && durs.length ? track.timescale / durs.sort((a, b) => a - b)[durs.length >> 1] : 25;
  const cfg = track && /avc1|avc3/.test(track.codec) ? avcCodec(track.raw.stsd) : null;
  if (cfg && typeof VideoDecoder !== 'undefined') {
    try {
      const W = track.width, H = track.height, cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const us = (cts) => Math.round((cts - track.ctsStart) * 1e6 / track.timescale);   // the chunk timestamp (us) of a sample
      const order = track.samples.map((s, i) => ({ i, t: us(s.cts) })).sort((a, b) => a.t - b.t), rank = new Map(order.map((o, k) => [o.t, k]));
      let got = 0, err = null; const pending = [];
      const dec = new VideoDecoder({ output: (vf) => { pending.push(vf); }, error: (e) => { err = e; } });
      dec.configure({ codec: cfg.codec, description: cfg.description, codedWidth: W, codedHeight: H, optimizeForLatency: false });
      const n = Math.min(track.samples.length, maxFrames);
      const drain = async () => {
        while (pending.length) {
          const vf = pending.shift(), k = rank.has(vf.timestamp) ? rank.get(vf.timestamp) : got;
          cx.drawImage(vf, 0, 0, W, H); vf.close();
          const rgba = new Uint8Array(cx.getImageData(0, 0, W, H).data.buffer);
          if (k < n) await onFrame(k, rgba);
          got++; if (onProgress) onProgress(got / n); if (check) check();
        }
      };
      for (let i = 0; i < track.samples.length; i++) {
        const s = track.samples[i];
        dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: us(s.cts), data: u8.subarray(s.off, s.off + s.size) }));
        if (err) throw err;
        while (dec.decodeQueueSize > 8) await sleep(2);
        await drain();
      }
      await dec.flush(); await drain(); dec.close();
      if (err) throw err;
      if (got < Math.min(track.samples.length, maxFrames)) throw new Error(`decoder returned ${got} of ${track.samples.length} frames`);
      return { n: Math.min(got, n), W, H, fps, track, via: 'VideoDecoder ' + cfg.codec };
    } catch (e) { console.warn('VideoDecoder path failed, falling back to <video>', e); }
  }
  // fallback: <video> seeks (the foley probe's method)
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.src = url;
  v.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0.01;pointer-events:none'; document.body.appendChild(v);
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('this browser cannot decode that video')); setTimeout(() => rej(new Error('the video did not load (10 s)')), 10000); });
    try { await Promise.race([v.play(), sleep(3000)]); } catch (e) { /* */ } v.pause();
    const W = v.videoWidth, H = v.videoHeight, times = track ? track.times : Array.from({ length: Math.floor(v.duration * fps) }, (_, i) => i / fps);
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H }), cx = cv.getContext('2d', { willReadFrequently: true });
    const n = Math.min(times.length, maxFrames), rvfc = typeof v.requestVideoFrameCallback === 'function';
    for (let i = 0; i < n; i++) {
      const t1 = i + 1 < times.length ? times[i + 1] : times[i] + 1 / fps, t = (times[i] + t1) / 2;
      await new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; v.onseeked = () => { if (rvfc) { v.requestVideoFrameCallback(() => fin()); setTimeout(fin, 120); } else setTimeout(fin, 30); }; v.currentTime = t; setTimeout(fin, 3000); });
      cx.drawImage(v, 0, 0, W, H); await onFrame(i, new Uint8Array(cx.getImageData(0, 0, W, H).data.buffer));
      if (onProgress) onProgress((i + 1) / n); if (check) check();
    }
    return { n, W, H, fps, track, via: '<video> seek' };
  } finally { v.remove(); URL.revokeObjectURL(url); }
}
/** speech Blob -> {pcm Float32Array mono, sr}: WAV parsed exactly (PCM 8/16/24/32, float 32); anything else via decodeAudioData @48 kHz */
export async function decodeSpeech(blob) {
  const ab = await blob.arrayBuffer(), dv = new DataView(ab);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (ab.byteLength > 44 && tag(0) === 'RIFF' && tag(8) === 'WAVE') {
    let p = 12, fmt = null, data = null;
    while (p + 8 <= ab.byteLength) { const id = tag(p), sz = dv.getUint32(p + 4, true); if (id === 'fmt ') fmt = p + 8; if (id === 'data') { data = [p + 8, Math.min(sz, ab.byteLength - p - 8)]; break; } p += 8 + sz + (sz & 1); }
    if (fmt != null && data) {
      let codec = dv.getUint16(fmt, true); const ch = dv.getUint16(fmt + 2, true), sr = dv.getUint32(fmt + 4, true), bits = dv.getUint16(fmt + 14, true);
      if (codec === 0xfffe) codec = dv.getUint16(fmt + 24, true);
      const bps = bits / 8, n = Math.floor(data[1] / (bps * ch)), pcm = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) {
          const o = data[0] + (i * ch + c) * bps; let v;
          if (codec === 3 && bits === 32) v = dv.getFloat32(o, true);
          else if (bits === 16) v = dv.getInt16(o, true) / 32768;
          else if (bits === 24) { let x = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
          else if (bits === 32) v = dv.getInt32(o, true) / 2147483648;
          else v = (dv.getUint8(o) - 128) / 128;
          s += v;
        }
        pcm[i] = s / ch;
      }
      return { pcm, sr, via: `wav ${bits}-bit ${ch}ch` };
    }
  }
  const AC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const buf = await new AC(1, 1, 48000).decodeAudioData(ab.slice(0));
  const pcm = new Float32Array(buf.length); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) pcm[i] += d[i] / buf.numberOfChannels; }
  return { pcm, sr: buf.sampleRate, via: 'decodeAudioData' };
}

// ------------------------------------------------------------------ the pipeline
export class LipSync {
  constructor({ packUrl, dir = 'engine/musetalk-1.5/pack', source = 'opfs', gpuOpts = {}, unetBatch = 0 } = {}) {
    this.packUrl = packUrl; this.dir = dir; this.source = source; this.gpuOpts = gpuOpts; this.unetBatch = unetBatch;
    this.runDir = dir.replace(/\/pack$/, '') + '/run';
  }
  async open() { if (!this.store) { this.store = new WeightStore(null, { base: this.packUrl, dir: this.dir, source: this.source }); await this.store.open(); } return this.store.status(); }
  download(o) { return this.store.download(o); }
  async remove() { await this.store.remove(); if (!this.store.http) { try { await this.store.st.call('remove', { name: this.runDir }); } catch (e) { /* */ } } LS(CACHE_KEY, null); }
  async load() {
    if (this.gpu && !this.gpu.lost) return { gpu: this.gpu.describe(), calib: this.gpu.calib };
    this.gpu = await createGpu(Object.assign({ powerPreference: 'high-performance', wantSubgroups: false }, this.gpuOpts));
    this.gpu.recycle(this.recycle !== false);
    this.store.gpu = this.gpu;
    if (!this.store.http) await this.store.st.start();
    if (!calibCached(this.gpu)) { await calibrateLs(this.gpu); calibSave(this.gpu); }
    return { gpu: this.gpu.describe(), calib: this.gpu.calib };
  }
  unload() { if (this.gpu) { try { this.store.drainPool(); } catch (e) { /* */ } this.gpu.freeAll(); try { this.gpu.device.destroy(); } catch (e) { /* */ } this.gpu = null; } }
  // OPFS run files (checkpoints + frames)
  async _w(name, data, at = 0, truncate) {
    if (this.store.http) { (this._mem || (this._mem = new Map())).set(name + '@' + at, data.slice()); return; }
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await this.store.st.call('write', Object.assign({ name: `${this.runDir}/${name}`, at, buf: ab }, truncate != null ? { truncate } : {}), [ab]);
  }
  async _r(name, at, len) {
    if (this.store.http) { const d = this._mem && this._mem.get(name + '@' + at); return d ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : null; }
    const sz = (await this.store.st.call('size', { name: `${this.runDir}/${name}` })).size; if (sz < at + len) return null;
    const r = await this.store.st.call('read', { name: `${this.runDir}/${name}`, at, len }); return r.buf.byteLength === len ? r.buf : r.buf.slice(0, len);
  }
  async _size(name) { if (this.store.http) return -1; try { return (await this.store.st.call('size', { name: `${this.runDir}/${name}` })).size; } catch (e) { return -1; } }
  /** probes v002: forget an interrupted run (its checkpoints) */
  async discardRun() {
    LS(RUN_KEY, null); LS(LIVE_KEY, null);
    if (this.store && !this.store.http) for (const n of ['frames.rgba', 'out.rgba', 'pred.f32', 'prompts.f32', 'faces.f32', 'lat.f32']) {
      try { await this.store.st.call('write', { name: `${this.runDir}/${n}`, at: 0, buf: new ArrayBuffer(0), truncate: 0 }); await this._flush(n); } catch (e) { /* */ } }
  }
  async _flush(name) { if (!this.store.http) await this.store.st.call('flush', { name: `${this.runDir}/${name}` }); }

  /** video, audio: Blob/File; opts: {audioWindow 'official'|'centered', boxes (override per source frame), masks (override per output frame:
   *  Uint8 crop-box masks), frameOverride (async i -> RGBA), keep (test hooks), check, onProgress, resume=true, unetBatch} */
  async render(o) {
    const g = this.gpu, store = this.store, P = (x) => { if (o.onProgress) try { o.onProgress(x); } catch (e) { /* */ } }, T = {}, t00 = now();
    const check = () => { if (o.signal && o.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' }); if (g.lost) throw Object.assign(new Error('GPU device lost'), { code: 'GPU_LOST' }); if (o.check) o.check(); };
    const keep = o.keep || {};
    let lap = now(); const done = (k) => { const n = now(); T[k] = +((n - lap) / 1000).toFixed(2); lap = n; };
    g.recycle(o.recycle !== false && this.recycle !== false);
    g.resetPeak(); let peak = 0; const pk = () => { peak = Math.max(peak, g.peak); };
    const peaks = {}, destroyed = {}, sums = {}; let quality = null;
    const S = () => g.stats();
    // probes v002: the end of a phase destroys its buffers (pool + the store's kept shard); then the page may reload before the next
    const boundary = async (prev, next) => {
      pk(); peaks[prev] = Math.max(peaks[prev] || 0, Math.round(g.peak / 1e6));
      let n = 0; try { store.drainPool(); g.runner.flush(); await g.done(); n = g.drainPool(); } catch (e) { /* */ }
      destroyed[prev] = Math.round(n / 1e6); g.resetPeak();
      P({ phase: 'stage', stage: next, prev, destroyedMB: destroyed[prev], peakMB: peaks[prev], stats: S() });
      if (o.beforeStage) await o.beforeStage(next, { prev, peakMB: peaks[prev] });
    };
    // run key: hashes of both inputs + options + pack version (a kill resumes the same job only)
    const hpart = async (b) => { const h = new Uint8Array(await b.slice(0, 1 << 20).arrayBuffer()), t = new Uint8Array(await b.slice(Math.max(0, b.size - (1 << 20))).arrayBuffer());
      return hex(await crypto.subtle.digest('SHA-256', new Uint8Array([...h.subarray(0, 65536), ...t.subarray(Math.max(0, t.length - 65536))]))).slice(0, 16) + ':' + b.size; };
    const vkey = `${await hpart(o.video)}|${store.m.pack_version}|${o.boxes ? 'B' : ''}`;
    const key = `${vkey}|${await hpart(o.audio)}|${o.audioWindow || 'official'}|${o.masks ? 'M' : ''}`;
    // per-CLIP cache (the last clip only): faces + VAE latents do not depend on the speech, so a new line on the same clip skips them
    let cache = null; try { cache = JSON.parse(LS(CACHE_KEY) || 'null'); } catch (e) { cache = null; }
    const useCache = !store.http && !o.frameOverride && !o.crops && cache && cache.vkey === vkey;
    let run = null; try { run = JSON.parse(LS(RUN_KEY) || 'null'); } catch (e) { run = null; }
    if (o.resume === false || !run || run.key !== key || store.http) run = { key, done: [], enc: 0, unet: 0, dec: 0 };
    const save = () => LS(RUN_KEY, JSON.stringify(run)), mark = (ph) => { if (!run.done.includes(ph)) run.done.push(ph); save(); };
    const live = (s) => LS(LIVE_KEY, s);

    // ---- 1. frames -> OPFS (always re-decoded: cheap, deterministic)
    live('frames'); P({ phase: 'frames', frac: 0, message: 'Reading the video' });
    let vid = null;
    if (run.vid && run.done.includes('frames') && !o.frameOverride) { const sz = await this._size('frames.rgba'); if (sz >= run.vid.n * run.vid.W * run.vid.H * 4) vid = Object.assign({ resumed: true }, run.vid); }
    if (!vid) {
      vid = await decodeVideo(o.video, { check, onProgress: (f) => P({ phase: 'frames', frac: f }), onFrame: async (i, rgba) => {
        await this._w('frames.rgba', rgba, i * rgba.length, i === 0 ? rgba.length : undefined);
      } });
      await this._flush('frames.rgba');
      run.vid = { n: vid.n, W: vid.W, H: vid.H, fps: vid.fps, via: vid.via }; mark('frames');
    }
    const W = vid.W, H = vid.H, Nv = vid.n, fps = o.fps || vid.fps, FB = W * H * 4;
    const frame = async (i) => (o.frameOverride ? o.frameOverride(i) : new Uint8Array(await this._r('frames.rgba', i * FB, FB)));
    done('frames');

    // ---- 2. audio -> per-frame prompts [T][50][384]
    live('audio'); P({ phase: 'audio', frac: 0, message: 'Listening to the speech' });
    const sp = await decodeSpeech(o.audio);
    const wav16 = o.wav16 || resampleTo16k(sp.pcm, sp.sr);
    let prompts = null, Tn = Math.floor((wav16.length / 16000) * fps);
    if (run.done.includes('audio')) { const b = await this._r('prompts.f32', 0, Tn * 50 * 384 * 4); if (b) prompts = new Float32Array(b); }
    if (!prompts) {
      const melT = await store.upload('audio'); const mf = new Float32Array(await g.read(melT.buf, melT.t('audio.mel_filters').off, 201 * 80 * 4)); store.release(melT);
      const { mel } = logMel(wav16, mf); if (keep.mel) keep.mel(mel);
      const states = await new WhisperEnc(g, store).encode(mel, { check }); if (keep.states) keep.states(states);
      const r = audioPrompts(states, wav16.length, fps, o.audioWindow || 'official'); prompts = r.prompts; Tn = r.T;
      pk(); await this._w('prompts.f32', prompts, 0, prompts.byteLength); await this._flush('prompts.f32'); mark('audio');
    }
    if (keep.prompts) keep.prompts(prompts);
    done('audio');
    await boundary('audio', 'faces');
    if (Tn < 1) throw Object.assign(new Error('the speech is too short'), { code: 'BAD_AUDIO' });
    // frame index of output frame i (MuseTalk: frames + reversed frames, cycled)
    const src = (i) => { const c = i % (2 * Nv); return c < Nv ? c : 2 * Nv - 1 - c; };
    const used = Math.min(Nv, Tn <= Nv ? Tn : Nv);   // source frames that are ever used

    // ---- 3. faces -> boxes (+ landmarks for the masks)
    live('faces'); P({ phase: 'faces', frac: 0, message: 'Finding the face' });
    const FL = 478 * 3;
    const readFaces = async (name, n) => { const b = await this._r(name, 0, n * (FL + 1) * 4); if (!b) return null; const a = new Float32Array(b), out = [];
      for (let i = 0; i < n; i++) out.push({ lm: a.subarray(i * (FL + 1), i * (FL + 1) + FL), borrowed: a[i * (FL + 1) + FL] > 0 }); return out; };
    const writeFaces = async (name, fs) => { const a = new Float32Array(fs.length * (FL + 1)); fs.forEach((f, i) => { a.set(f.lm, i * (FL + 1)); a[i * (FL + 1) + FL] = f.borrowed ? 1 : 0; });
      await this._w(name, a, 0, a.byteLength); await this._flush(name); };
    let faces = null, fromCache = false;
    if (run.done.includes('faces')) faces = await readFaces('faces.f32', used);
    if (!faces && useCache && cache.faces >= used) { faces = await readFaces('cache_faces.f32', used); fromCache = !!faces; }
    if (!faces) {
      faces = [];
      const ft = new FaceTracker(g, store); await ft.load();
      try {
        const BS = 8;
        for (let f0 = 0; f0 < used; f0 += BS) {
          const batch = []; for (let f = f0; f < Math.min(used, f0 + BS); f++) batch.push({ rgba: await frame(f), W, H });
          const r = await ft.process(batch, { check, keepRaw: !!keep.faceRaw });
          r.forEach((x, k) => faces.push(x.lm ? { lm: x.lm, presence: x.presence, score: x.det.score } : null));
          if (keep.faceRaw) keep.faceRaw(f0, r);
          P({ phase: 'faces', frac: Math.min(1, (f0 + BS) / used), frame: Math.min(used, f0 + BS), frames: used, stats: S() }); pk();
        }
      } finally { ft.unload(); }
      if (!faces.some((f) => f)) throw Object.assign(new Error('no face found in the clip'), { code: 'NO_FACE' });
      for (let i = 0; i < faces.length; i++) if (!faces[i]) {   // a frame without a face reuses the nearest frame that has one
        let d = 1; while (!faces[i - d] && !faces[i + d]) d++; faces[i] = { ...(faces[i - d] || faces[i + d]), borrowed: true };
      }
      await writeFaces('faces.f32', faces); mark('faces');
      if (!store.http && !o.frameOverride) { await writeFaces('cache_faces.f32', faces); cache = { vkey, faces: used, enc: 0 }; LS(CACHE_KEY, JSON.stringify(cache)); }
    } else if (!run.done.includes('faces')) { await writeFaces('faces.f32', faces); mark('faces'); }
    const cal = store.m.model.calib;
    const boxes = o.boxes || faces.map((f) => museBox(f.lm, W, H, cal).box);
    if (keep.boxes) keep.boxes(boxes, faces);
    done('faces');
    await boundary('faces', 'encode');

    // ---- 4. crops + VAE encode (masked + reference) per used source frame
    live('encode'); P({ phase: 'encode', frac: 0, message: 'Reading the face' });
    const LAT = 32 * 32 * 8;
    const lat = new Float32Array(used * LAT);
    if (run.enc > 0) { const b = await this._r('lat.f32', 0, run.enc * LAT * 4); if (b) lat.set(new Float32Array(b)); else run.enc = 0; }
    if (run.enc < used && useCache && cache.enc > run.enc) {   // the same clip was encoded by an earlier render
      const n = Math.min(cache.enc, used), b = await this._r('cache_lat.f32', 0, n * LAT * 4);
      if (b) { lat.set(new Float32Array(b)); run.enc = n; await this._w('lat.f32', lat.subarray(0, n * LAT), 0); await this._flush('lat.f32'); save(); }
    }
    if (run.enc < used) {
      const vae = new SDVae(g, { acc: o.vaeEncAcc || o.vaeAcc || VAE_ENC_ACC }), sh = await store.upload('vae.enc');
      try {
        const qw = new Float32Array(await g.read(sh.buf, sh.t('quant_conv.weight').off, 64 * 4)), qb = new Float32Array(await g.read(sh.buf, sh.t('quant_conv.bias').off, 8 * 4));
        for (let f = run.enc; f < used; f++) {
          const crop = o.crops ? o.crops(f) : cropTo256(await frame(f), W, H, boxes[f]);
          if (keep.crop) keep.crop(f, crop);
          for (let half = 1; half >= 0; half--) {   // masked first, then the reference (MuseTalk order: cat [masked | ref])
            const h8 = await vae.encodeRaw(sh, vaeInput(crop, half === 1), 256, 256, { check });
            const z = encodeLatent(h8, qw, qb, h2f);
            for (let p = 0; p < 1024; p++) for (let c = 0; c < 4; c++) lat[f * LAT + p * 8 + (half ? 0 : 4) + c] = z[p * 4 + c];
          }
          pk(); run.enc = f + 1;
          if ((f + 1) % 4 === 0 || f + 1 === used) { await this._w('lat.f32', lat.subarray(0, (f + 1) * LAT), 0); await this._flush('lat.f32'); save();
            if (cache && cache.vkey === vkey && !o.frameOverride && !o.crops) { await this._w('cache_lat.f32', lat.subarray(0, (f + 1) * LAT), 0); await this._flush('cache_lat.f32'); cache.enc = f + 1; LS(CACHE_KEY, JSON.stringify(cache)); } }
          P({ phase: 'encode', frac: (f + 1) / used, frame: f + 1, frames: used, alive: g.alive, peak: g.peak, stats: S() });
        }
      } finally { store.release(sh); }
    }
    if (keep.latents) keep.latents(lat);
    sums.lat = fnv(lat);
    done('encode');
    await boundary('encode', 'unet');

    // ---- 5. UNet in chunks of B frames
    live('unet'); P({ phase: 'unet', frac: 0, message: 'Moving the lips' });
    const OUT = 32 * 32 * 4, pred = new Float32Array(Tn * OUT);
    if (run.unet > 0) { const b = await this._r('pred.f32', 0, run.unet * OUT * 4); if (b) pred.set(new Float32Array(b)); else run.unet = 0; }
    const apple = /apple/i.test((g.info && g.info.vendor) || '');
    const B = o.unetBatch || this.unetBatch || (apple ? 12 : 16);
    // probes v002: every UNet block's weights stream through ONE slab (the largest block), created once for the phase
    const slab = run.unet < Tn ? g.buffer(store.maxShardBytes('unet.'), 'unet.slab') : null;
    const unet = new MuseUNet(g, store, { slab });
    for (let c0 = run.unet; c0 < Tn; c0 += B) {
      const nb = Math.min(B, Tn - c0);
      const l16 = new Uint16Array(nb * LAT), a16 = new Uint16Array(nb * 50 * 384);
      for (let k = 0; k < nb; k++) {
        const sf = src(c0 + k);
        for (let i = 0; i < LAT; i++) l16[k * LAT + i] = f2h(lat[sf * LAT + i]);
        for (let i = 0; i < 50 * 384; i++) a16[k * 50 * 384 + i] = f2h(prompts[(c0 + k) * 50 * 384 + i]);
      }
      const lb = g.upload(l16, 'unet.lat'), ab = g.upload(a16, 'unet.audio');
      let outB;
      try {
        outB = await unet.run(lb, ab, nb, { check, keep: c0 === 0 ? keep.unet : null, onStage: (i, n) => P({ phase: 'unet', frac: (c0 + nb * i / n) / Tn, alive: g.alive, peak: g.peak }) });
        pred.set(new Float32Array(await g.read(outB, 0, nb * OUT * 4)), c0 * OUT);
      } finally { g.runner.flush(); g.free(lb); g.free(ab); if (outB) g.free(outB); }
      pk(); run.unet = c0 + nb; await this._w('pred.f32', pred.subarray(0, run.unet * OUT), 0); await this._flush('pred.f32'); save();
      await g.done();
      P({ phase: 'unet', frac: run.unet / Tn, chunk: Math.ceil(run.unet / B), chunks: Math.ceil(Tn / B), frame: run.unet, frames: Tn, alive: g.alive, peak: g.peak, stats: S() });
    }
    if (slab) g.free(slab);
    if (keep.pred) keep.pred(pred);
    sums.pred = fnv(pred);
    done('unet');
    await boundary('unet', 'decode');

    // ---- 6. decode + paste back -> output frames in OPFS
    live('decode'); P({ phase: 'decode', frac: 0, message: 'Drawing the mouth' });
    {
      const vae = new SDVae(g, { acc: o.vaeDecAcc || o.vaeAcc || VAE_DEC_ACC }), sh = await store.upload('vae.dec');
      let osum = run.osum || 0, worst = null, tVae = 0, tPaste = 0;
      const blendV2 = o.blend !== 'plain', sharps = [];
      try {
        const pqW = new Float32Array(await g.read(sh.buf, sh.t('post_quant_conv.weight').off, 16 * 4)), pqB = new Float32Array(await g.read(sh.buf, sh.t('post_quant_conv.bias').off, 4 * 4));
        for (let i = run.dec; i < Tn; i++) {
          const tv = now();
          const rgba256 = await vae.decode(sh, pred.subarray(i * OUT, (i + 1) * OUT), 32, 32, { check, pqW, pqB });
          tVae += now() - tv; const tp = now();
          const gen = new Uint8Array(256 * 256 * 3); for (let p = 0; p < 65536; p++) { gen[p * 3] = rgba256[p * 4]; gen[p * 3 + 1] = rgba256[p * 4 + 1]; gen[p * 3 + 2] = rgba256[p * 4 + 2]; }
          if (keep.dec) keep.dec(i, gen);
          const sf = src(i), box = boxes[sf], { cb } = cropBox(box, 1.5);
          const mask = o.masks ? o.masks(i) : meshMask(faces[sf].lm, cb, box, (store.m.model.musetalk.cheek || [90])[0]);
          const fr = await frame(sf);
          // v002: the better paste-back (colour match, the original's detail outside the mouth, grain), and the mouth's sharpness vs the
          // original on every frame; the least sharp frame is the quality report's
          let outF, qst = null;
          if (blendV2) { const q = pasteBackV2(fr, W, H, gen, box, cb, mask, faces[sf].lm, i + 1); outF = q.out; qst = q.stats; }
          else outF = pasteBack(fr, W, H, gen, box, cb, mask);
          const sharp = mouthSharpness(fr, outF, W, box, faces[sf].lm);
          if (sharp != null) { sharps.push(sharp); if (!worst || sharp < worst.sharp) worst = { i, sf, sharp, stats: qst, gen: gen.slice() }; }
          tPaste += now() - tp;
          if (keep.out) keep.out(i, outF, mask);
          for (let q = 0; q < outF.length; q += 61) osum = (osum + outF[q] * ((q & 1023) + 1)) % 4294967291;
          await this._w('out.rgba', outF, i * FB, i === 0 ? FB * Tn : undefined);
          pk(); run.dec = i + 1; run.osum = osum; if ((i + 1) % 4 === 0) { await this._flush('out.rgba'); save(); }
          P({ phase: 'decode', frac: (i + 1) / Tn, frame: i + 1, frames: Tn, alive: g.alive, peak: g.peak, stats: S() });
        }
        await this._flush('out.rgba'); save();
        sums.out = (run.osum || 0).toString(16);
        T.decodeVae = +(tVae / 1000).toFixed(2); T.decodePaste = +(tPaste / 1000).toFixed(2);
        if (worst) {   // the quality report: the least sharp frame's mouth area, the original | v001's blend | v002's blend
          const fr = await frame(worst.sf), box = boxes[worst.sf], { cb } = cropBox(box, 1.5);
          const mask = o.masks ? o.masks(worst.i) : meshMask(faces[worst.sf].lm, cb, box, (store.m.model.musetalk.cheek || [90])[0]);
          const plain = pasteBack(fr, W, H, worst.gen, box, cb, mask);
          const fixed = blendV2 ? pasteBackV2(fr, W, H, worst.gen, box, cb, mask, faces[worst.sf].lm, worst.i + 1).out : plain;
          const [bx, by, bx1, by1] = box, fh = by1 - by, cy0 = Math.max(0, Math.round(by + 0.36 * fh)), cy1 = Math.min(H, by1 + Math.round(0.04 * fh)), cx0 = Math.max(0, bx), cx1 = Math.min(W, bx1);
          const crop = (img) => { const cw = cx1 - cx0, ch = cy1 - cy0, a = new Uint8ClampedArray(cw * ch * 4); for (let yy = 0; yy < ch; yy++) a.set(img.subarray(((cy0 + yy) * W + cx0) * 4, ((cy0 + yy) * W + cx1) * 4), yy * cw * 4); return a; };
          const sorted = sharps.slice().sort((a, b) => a - b);
          quality = { frame: worst.i, frames: Tn, sourceFrame: worst.sf, blend: blendV2 ? 'v2' : 'plain', sharp: +worst.sharp.toFixed(3), sharpPlain: +mouthSharpness(fr, plain, W, box, faces[worst.sf].lm).toFixed(3),
            sharpMedian: +sorted[sorted.length >> 1].toFixed(3), stats: worst.stats, box, faceW: bx1 - bx, faceH: fh, stretch: [+((bx1 - bx) / 256).toFixed(2), +(fh / 256).toFixed(2)],
            w: cx1 - cx0, h: cy1 - cy0, orig: crop(fr), plain: crop(plain), fixed: crop(fixed) };
          // checkpointed with the run: a fresh page before the mux must not lose it
          const qb = new Uint8Array(quality.orig.length * 3); qb.set(quality.orig, 0); qb.set(quality.plain, quality.orig.length); qb.set(quality.fixed, 2 * quality.orig.length);
          await this._w('quality.bin', qb, 0, qb.byteLength); await this._flush('quality.bin');
          run.quality = Object.assign({}, quality, { orig: undefined, plain: undefined, fixed: undefined }); save();
        }
      } finally { store.release(sh); }
    }
    done('decode');
    if (!quality && run.quality) {   // drawn on an earlier page
      const n = run.quality.w * run.quality.h * 4, b = await this._r('quality.bin', 0, 3 * n);
      if (b) { const u = new Uint8ClampedArray(b); quality = Object.assign({}, run.quality, { orig: u.slice(0, n), plain: u.slice(n, 2 * n), fixed: u.slice(2 * n, 3 * n) }); }
    }
    await boundary('decode', 'mux');

    // ---- 7. H.264 + speech -> MP4
    live('mux'); P({ phase: 'mux', frac: 0, message: 'Saving the video' });
    let mp4 = null, mux = 'none', muxErr = null, codec = null, muxDiag = null;
    const Wv = W & ~1, Hv = H & ~1;
    try {
      const e = await encodeMp4(async (i) => { const f = new Uint8Array(await this._r('out.rgba', i * FB, FB)); if (Wv === W && Hv === H) return f;
        const c = new Uint8Array(Wv * Hv * 4); for (let y = 0; y < Hv; y++) c.set(f.subarray(y * W * 4, y * W * 4 + Wv * 4), y * Wv * 4); return c; }, Tn, Hv, Wv, fps, (f) => P({ phase: 'mux', frac: 0.8 * (f + 1) / Tn }));
      codec = e.codec; mp4 = e.mp4;
      const caps = await audioCaps(1);
      // the speech track = the input speech (MuseTalk muxes the original audio file), resampled to 48 kHz for the encoder;
      // v002: AAC-LC with the ASC built from the rate + channels (never the encoder's description), real buffer size + bitrates
      const a48 = sp.sr === 48000 ? sp.pcm : resampleTo16k(sp.pcm, sp.sr, 48000);
      if (caps.aac || caps.opus) { try { const enc = await encodePcm([a48], caps, 48000); mp4 = remuxWithAudio(readVideoTrack(mp4), enc); mux = enc.codec; muxDiag = enc.diag; } catch (err2) { muxErr = String(err2.message || err2); } }
      else mux = 'video-only';
    } catch (err) { muxErr = String(err.message || err); }
    done('mux');
    pk(); peaks.mux = Math.round(g.peak / 1e6);
    LS(RUN_KEY, null); live(null);
    if (!store.http) for (const n of ['frames.rgba', 'out.rgba', 'pred.f32', 'prompts.f32', 'quality.bin']) {   // free ~2 x 130 MB of OPFS (the clip cache stays)
      try { await this.store.st.call('write', { name: `${this.runDir}/${n}`, at: 0, buf: new ArrayBuffer(0), truncate: 0 }); await this._flush(n); } catch (e) { /* */ } }
    const flops = used * 2 * vaeEncFlops + Tn * (unetFlopsPerFrame + vaeDecFlops);
    return { mp4, mux, muxErr, codec, frames: Tn, sourceFrames: Nv, width: W, height: H, fps, timings: T, totalSec: +((now() - t00) / 1000).toFixed(2), peakMB: Math.round(peak / 1e6),
      perFrameSec: +(((now() - t00) / 1000) / Tn).toFixed(3), tflop: +(flops / 1e12).toFixed(1), boxes, decodeVia: vid.via, speech: { sr: sp.sr, via: sp.via, seconds: +(sp.pcm.length / sp.sr).toFixed(2) },
      unetBatch: B, resumed: run.done.slice(), framesResumed: !!vid.resumed, peaks, destroyed, sums, muxDiag, gpuStats: g.stats(), quality, facesBorrowed: faces.filter((f) => f && f.borrowed).length, clipCache: fromCache, speechPcm: sp,
      faces: keep.faces ? faces : undefined };
  }
}
