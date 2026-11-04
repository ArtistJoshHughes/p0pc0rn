// p0voice.js - p0pc0rn's own text-to-speech, stage 1 (text + mood tag -> 24 kHz speech). ES module; runs on a page, in a Worker
// and in node. Our own code: front end (frontend.mjs), OT-CFM acoustic model + Vocos-style vocoder (train/models.py maths), on
// WebGPU (p0voice_gpu.js) or WASM SIMD (p0voice_wasm.mjs, our C), chosen at load.
//
//   import { createP0Voice } from './p0voice.js';
//   const v = createP0Voice({ pack: 'p0voice.p0v', lexicon: 'p0voice_lexicon.bin', prefer: 'auto' });
//   await v.load();                                   // v.backend: 'webgpu' | 'wasm'
//   const { pcm, sampleRate } = await v.speak('[calm and excited]: Morning, a01!');
//   await v.speakStream(text, { steps: 2 }, (pcm, info) => play(pcm));   // first chunk ~32 frames (0.34 s of speech)
//
// opts: { speaker = 0, style = 'neutral' | name | [names] | weights, steps = 4, pace = 1, temp = 0.667, seed, noise (tests) }.
// A reply may start with a mood tag "[calm and excited]:" (parseTag): its known words set the style (the mean of their rows of the
// style table; cond = speaker row + style vector), the tag is never spoken. An explicit opts.style wins over the tag.
//
// Per clause (one sentence; an over-long one is cut at , ; : then at word gaps): the encoder and the durations run once, then the
// conv-only vector-field decoder and the vocoder run over the clause (speak) or in chunks (speakStream: 32 frames first, then ~128,
// 40-frame margins each side, 8-frame mel cross-fade; the inverse STFT carries its overlap across chunks exactly).
//
// In p0pc0rn (v4): Juli's voice in voice mode (ui/voiceout.js), WebGPU only: it asks for prefer 'webgpu' and its own GPUDevice, and the
// pack (p0voice.p0v, the lexicon, g2p.p0v) comes from OPFS through engine/core/store.js (tools/p0voice_pack.py makes it). The WASM
// backend (p0voice_wasm_backend.js, our C) is not in the app: without WebGPU she speaks with Flite.
'use strict';
import { Frontend, SYM_ID, PUNCT } from './frontend.mjs';
import { parsePack, tensorF32 } from './p0v_pack.js';
import { CompactLex } from './p0v_lexicon.js';

export const SAMPLE_RATE = 24000;
const HOP = 256, NMEL = 100, N_FFT = 1024;
export const TAG_RE = /^\s*\[([^\]]{1,40})\]\s*:?\s*/;
export const DEFAULT_STYLES = ['neutral', 'calm', 'excited', 'teasing', 'smug', 'warning', 'sad', 'whisper', 'cheerful'];
/** streaming: first chunk, later chunks, decoder margins, mel cross-fade (frames); the vocoder's exact receptive field is 27 */
export const CHUNK = { first: 32, next: 128, margin: 40, xfade: 8, vocMargin: 27, minTail: 16 };
/** a 1-function module using f32x4.relaxed_madd: valid = the relaxed-SIMD build (fused multiply-add) can run here */
const RELAXED_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 8, 1, 96, 3, 123, 123, 123, 1, 123, 3, 2, 1, 0, 10, 13, 1, 11, 0, 32, 0, 32, 1, 32, 2, 253, 133, 2, 11]);
export function hasRelaxedSimd() { try { return typeof WebAssembly !== 'undefined' && WebAssembly.validate(RELAXED_PROBE); } catch (e) { return false; } }
const perf = () => (globalThis.performance && performance.now ? performance.now() : Date.now());
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined' && typeof importScripts === 'undefined';

// ------------------------------------------------------------------------------------------------ mood tag
/** "[calm and excited]: Hi" -> { text: 'Hi', tag: 'calm and excited', words: ['calm', 'excited'] } (words: the known ones) */
export function parseTag(text, styles = DEFAULT_STYLES) {
  const s = String(text == null ? '' : text), m = TAG_RE.exec(s);
  if (!m) return { text: s, tag: null, words: [] };
  const known = new Set(styles.filter((w) => !/^spare/.test(w)));
  const words = [];
  for (const w of m[1].toLowerCase().split(/(?:\s+and\s+|[,+&]|\s+)/)) { const t = w.trim(); if (t && t !== 'and' && known.has(t) && !words.includes(t)) words.push(t); }
  return { text: s.slice(m[0].length), tag: m[1], words };
}

// ------------------------------------------------------------------------------------------------ noise
/** xoshiro128** seeded by splitmix32; normal() by Box-Muller */
export class Rng {
  constructor(seed = 1) {
    let x = seed >>> 0; const sm = () => { x = (x + 0x9e3779b9) >>> 0; let z = x; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0; z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0; return (z ^ (z >>> 16)) >>> 0; };
    this.s = new Uint32Array([sm(), sm(), sm(), sm()]); this.spare = null;
  }
  u32() {
    const s = this.s, r = Math.imul(((Math.imul(s[1], 5) << 7) | (Math.imul(s[1], 5) >>> 25)), 9) >>> 0, t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = (s[3] << 11) | (s[3] >>> 21);
    return r;
  }
  uniform() { return (this.u32() + 0.5) / 4294967296; }
  normal() {
    if (this.spare != null) { const z = this.spare; this.spare = null; return z; }
    const r = Math.sqrt(-2 * Math.log(this.uniform())), a = 2 * Math.PI * this.uniform();
    this.spare = r * Math.sin(a); return r * Math.cos(a);
  }
  fill(n) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = this.normal(); return o; }
}

/** frames per symbol: max(1, round_half_even(max(expm1(logd), 0) * pace)) (torch.round is half-to-even) */
export function durations(logd, pace = 1) {
  const d = new Int32Array(logd.length), p = Math.fround(pace);
  for (let i = 0; i < logd.length; i++) {
    let x = Math.fround(Math.expm1(logd[i])); if (!(x > 0)) x = 0;
    x = Math.fround(x * p);
    let r = Math.floor(x); const f = x - r;
    if (f > 0.5 || (f === 0.5 && (r & 1))) r++;
    d[i] = Math.max(1, r);
  }
  return d;
}

/** chunk plan over [0, frames): [{a, b}] (one chunk when c is null) */
export function chunkPlan(frames, c) {
  if (!c) return [{ a: 0, b: frames }];
  const out = [];
  for (let a = 0, k = 0; a < frames; k++) {
    let b = Math.min(frames, a + (k === 0 ? c.first : c.next));
    if (frames - b < c.minTail) b = frames;
    out.push({ a, b }); a = b;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ files
async function bytesOf(src, base) {
  if (src == null) throw new Error('missing file');
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  const u = String(src);
  if (isNode && !/^(https?|data|blob):/i.test(u)) {
    const fs = await import('node:fs/promises'), { fileURLToPath } = await import('node:url');
    let p = u;
    if (/^file:/i.test(u)) p = fileURLToPath(u);
    else if (!/^([a-z]:[\\/]|[\\/])/i.test(u)) p = fileURLToPath(new URL(u, base));
    return new Uint8Array(await fs.readFile(p));
  }
  const r = await fetch(new URL(u, base).href);
  if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ------------------------------------------------------------------------------------------------ the voice
/**
 * createP0Voice({ pack, lexicon, prefer = 'auto' | 'webgpu' | 'wasm', g2p, wasm, maxT, maxF, chunk, gpu })
 *   pack / lexicon / wasm: URL, path (node) or bytes; defaults sit beside this module (p0voice.p0v, p0voice_lexicon.bin, p0voice_wasm.wasm).
 *   lexicon may also be CMUdict-format text. g2p: the learned G2P for words not in the lexicon, either a function word -> phones[] | null
 *   or its pack (g2p.p0v: URL, path or bytes; run in plain JS by p0v_g2p.js).
 *   gpu: { device } to share an existing GPUDevice, { powerPreference } otherwise.
 */
export function createP0Voice(cfg = {}) {
  const base = cfg.base || import.meta.url;
  const chunkCfg = Object.assign({}, CHUNK, cfg.chunk || {});
  let lastFrames = 0, pack = null, be = null, fe = null, styles = DEFAULT_STYLES, spkT = null, styT = null, nSty = 16, dc = 256, loading = null, queue = Promise.resolve();
  const voice = {
    info: { name: 'p0voice', sampleRate: SAMPLE_RATE },
    backend: null, fallback: null, config: null,
    speaker: 0,
    async load() {
      if (be) return true;
      if (!loading) loading = (async () => {
        const T = voice.loadTimings = {}; let tt = perf();
        const lap = (k) => { const n = perf(); T[k] = Math.round(n - tt); tt = n; };   // stage timings (probe v002: where load time goes)
        const [pk, lx] = await Promise.all([bytesOf(cfg.pack || 'p0voice.p0v', base),
          cfg.lexicon === false ? null : typeof cfg.lexicon === 'string' && /\s/.test(cfg.lexicon) ? cfg.lexicon : bytesOf(cfg.lexicon || 'p0voice_lexicon.bin', base)]);
        lap('files_ms');
        pack = parsePack(pk);
        const C = pack.config; voice.config = C;
        styles = C.styles || DEFAULT_STYLES; nSty = C.n_style || styles.length; dc = C.cond_dim || 256;
        spkT = tensorF32(pack, 'am.spk.weight'); styT = tensorF32(pack, 'am.style.weight');
        lap('parse_ms');
        let g2p = typeof cfg.g2p === 'function' ? cfg.g2p : null;
        if (cfg.g2p && !g2p) { const { loadG2P } = await import('./p0v_g2p.js'); g2p = await loadG2P(await bytesOf(cfg.g2p, base)); }   // a G2P pack (g2p.p0v)
        lap('g2p_ms');
        fe = new Frontend('', { g2p });
        if (lx == null) { /* no lexicon: G2P only */ } else if (typeof lx === 'string') fe.addLexicon(lx); else fe.lex = new CompactLex(lx);
        lap('lexicon_ms');
        const want = cfg.prefer || 'auto';
        const maxT = cfg.maxT || 512, maxF = cfg.maxF || 2048, maxW = cfg.maxW || 1024;   // a clause longer than maxW frames decodes in 1024-frame windows
        if ((want === 'webgpu' || want === 'auto') && !isNode && globalThis.navigator && navigator.gpu) {
          try {
            const { createGpuBackend } = await import('./p0voice_gpu.js');
            be = await createGpuBackend(pack, Object.assign({ maxT, maxF, maxW }, cfg.gpu || {}));
          } catch (e) {
            if (want === 'webgpu') throw e;
            voice.fallback = String((e && e.message) || e);
          }
        } else if (want === 'webgpu') throw new Error('WebGPU is not available here');
        if (!be) {
          const { createWasmBackend } = await import('./p0voice_wasm_backend.js');
          const relaxed = !cfg.wasm && cfg.relaxed !== false && hasRelaxedSimd();
          const wasmBinary = (await bytesOf(cfg.wasm || (relaxed ? 'p0voice_wasm_relaxed.wasm' : 'p0voice_wasm.wasm'), base)).slice().buffer;
          voice.wasmBuild = cfg.wasm ? 'given' : relaxed ? 'relaxed-simd' : 'simd128';
          be = await createWasmBackend(pack, { wasmBinary, maxT, maxF, maxW });
        }
        voice.backend = be.name;
        lap('backend_ms'); if (be.timings) T.backend = be.timings;
        // the pack's bytes are not needed once the backend holds the weights
        pack = { config: pack.config, tensors: {}, u8: null };
        return true;
      })().catch((e) => { loading = null; throw e; });
      return loading;
    },
    parseTag: (text) => parseTag(text, styles),
    setVoice(speaker) { voice.speaker = speaker | 0; },
    /** a word list for the lexicon (CMUdict format; later entries override) */
    addLexicon(text) { if (!fe) throw new Error('load() first'); fe.addLexicon(text, true); },
    /** style option / tag words -> weights over the style table (Float32Array [n_style]) */
    styleWeights(style, tagWords) {
      const w = new Float32Array(nSty), idx = (n) => styles.indexOf(String(n).toLowerCase());
      const names = (list) => { const ks = list.map(idx).filter((i) => i >= 0); if (!ks.length) ks.push(0); for (const k of ks) w[k] += 1 / ks.length; return w; };
      if (style == null) return names(tagWords && tagWords.length ? tagWords : ['neutral']);
      if (typeof style === 'string') return names(parseTag(`[${style}]`, styles).words.length ? parseTag(`[${style}]`, styles).words : [style]);
      if (Array.isArray(style) && style.every((s) => typeof s === 'string')) return names(style);
      if (ArrayBuffer.isView(style) || Array.isArray(style)) { for (let i = 0; i < nSty && i < style.length; i++) w[i] = +style[i] || 0; return w; }
      if (typeof style === 'object') { for (const [k, v] of Object.entries(style)) { const i = idx(k); if (i >= 0) w[i] = +v || 0; } return w; }
      return names(['neutral']);
    },
    /** cond = speaker row + sum_k weight_k * style row_k (f32) */
    cond(speaker, weights) {
      const c = new Float32Array(dc), s = Math.max(0, Math.min((spkT.length / dc) - 1, speaker | 0));
      for (let i = 0; i < dc; i++) { let v = spkT[s * dc + i]; for (let k = 0; k < nSty; k++) if (weights[k]) v = Math.fround(v + Math.fround(weights[k] * styT[k * dc + i])); c[i] = v; }
      return c;
    },
    /** text -> clauses of phoneme ids (+ the front end's report) */
    clauses(text, maxPhon = 400) {
      const r = fe.toIds(text), ids = Array.from(r.ids), out = [];
      const SENT = new Set(['.', '!', '?', '…'].map(SYM)), SP = SYM(' ');
      let st = 0;
      for (let i = 0; i < ids.length; i++) if (SENT.has(ids[i]) && ids[i + 1] === SP) { out.push(ids.slice(st, i + 2)); st = i + 1; i++; }
      if (st < ids.length - 1) out.push(ids.slice(st));
      // an over-long clause: cut after , ; : - (then at word gaps)
      const SOFT = new Set([',', ';', ':', '-'].map(SYM)), cut = [];
      for (const c of out) {
        if (c.length <= maxPhon) { cut.push(c); continue; }
        let s0 = 0;
        while (c.length - s0 > maxPhon) {
          let k = -1;
          for (let i = s0 + Math.floor(maxPhon / 2); i < s0 + maxPhon - 1; i++) if (SOFT.has(c[i]) && c[i + 1] === SP) k = i + 1;
          if (k < 0) for (let i = s0 + maxPhon - 2; i > s0 + 1; i--) if (c[i] === SP) { k = i; break; }
          if (k < 0) k = s0 + maxPhon - 1;
          cut.push(c.slice(s0, k + 1)); s0 = k;
        }
        cut.push(c.slice(s0));
      }
      const NONPH = new Set(['<pad>', ' ', ...PUNCT].map(SYM));   // a clause with no phoneme at all (only the final '.' the front end adds) is silent
      return { clauses: cut.filter((c) => c.some((x) => !NONPH.has(x))).map((c) => Int32Array.from(c)), oov: r.oov, norm: r.norm, words: r.words };
    },
    /** one clause of phoneme ids -> PCM; onChunk(pcm, info) streams it in chunks. o: resolved options (see speak) */
    async synthIds(ids, o = {}, onChunk = null, dbg = null) {
      if (!be) await voice.load();
      const steps = o.steps || 4, temp = o.temp != null ? o.temp : 0.667, pace = o.pace || 1;
      const cond = o.cond || voice.cond(o.speaker != null ? o.speaker : voice.speaker, o.weights || voice.styleWeights(o.style, null));
      const t0 = perf();
      const logd = await be.encode(ids, cond);
      const dur = o.dur || durations(logd, pace);
      let frames = 0; for (let i = 0; i < dur.length; i++) frames += dur[i];
      frames = Math.min(frames, be.maxF);
      const noise = o.noise || (o.rng || new Rng(o.seed != null ? o.seed : (Math.random() * 4294967296) >>> 0)).fill(frames * NMEL);
      if (dbg) { dbg.logd = logd; dbg.dur = dur; dbg.cond = cond; }
      await be.prepare(dur, noise, steps);
      const cc = o.chunk ? Object.assign({}, chunkCfg, o.chunk) : chunkCfg;
      const c = onChunk ? chunkPlan(frames, cc) : null;
      // a clause longer than the decode window: windows of maxW with their margins and a short last chunk inside it (1024-frame chunks
      // made 1104-frame windows: "decode window too large" for any clause over 1024 frames, ~11 s)
      const big = be.maxW - 2 * cc.margin - cc.minTail;
      const plan = c || chunkPlan(frames, frames > be.maxW ? Object.assign({}, cc, { first: big, next: big }) : null);
      const ML = c ? cc.margin : (plan.length > 1 ? cc.margin : 0), XF = cc.xfade, VR = cc.vocMargin;
      const parts = []; let done = 0, first = 0;
      for (let k = 0; k < plan.length; k++) {
        const { a, b } = plan[k];
        const w0 = Math.max(0, a - ML), w1 = Math.min(frames, b + ML);
        await be.decode(w0, w1, temp);
        await be.compose(a, w1, w0, k > 0 ? Math.min(a + XF, b) : a);
        await be.vocode(Math.max(0, a - VR), Math.min(frames, b + VR), a, b);
        const s1 = b >= frames ? frames * HOP : b * HOP - N_FFT / 2;
        const pcm = s1 > done ? await be.emit(frames, done, s1) : new Float32Array(0);
        done = Math.max(done, s1);
        if (!first) first = perf() - t0;
        if (onChunk) await onChunk(pcm, { chunk: k, chunks: plan.length, frames: [a, b], final: k === plan.length - 1 });
        else parts.push(pcm);
      }
      lastFrames = frames;
      return { pcm: onChunk ? null : concat(parts), frames, ms: perf() - t0, firstMs: first, chunks: plan.length };
    },
    /** text -> { pcm: Float32Array, sampleRate: 24000, seconds, ms, clauses, oov } */
    speak(text, opts = {}) { return run(() => say(text, opts, null)); },
    /** text -> chunks via onChunk(pcm, info); resolves { sampleRate, samples, seconds, ms, firstChunkMs, chunks, pcm (collect !== false) } */
    speakStream(text, opts = {}, onChunk = () => {}) { return run(() => say(text, opts, onChunk)); },
    memoryBytes() { return be && be.memoryBytes ? be.memoryBytes() : 0; },
    /** tests: the last clause's mel [frames][100] as composed (chunked or full) */
    lastMel() { return be.mel(0, lastFrames); },
    unload() { if (be && be.unload) be.unload(); be = null; loading = null; fe = null; voice.backend = null; },
  };
  Object.defineProperty(voice, '__be', { get: () => be, enumerable: false });   // tests / profiling only
  const run = (f) => { const p = queue.then(f, f); queue = p.catch(() => {}); return p; };
  async function say(text, opts, onChunk) {
    if (!be) await voice.load();
    const t0 = perf();
    const tag = parseTag(text, styles);
    const weights = voice.styleWeights(opts.style, tag.words);
    const spk = opts.speaker != null ? opts.speaker : voice.speaker;
    const cond = voice.cond(spk, weights);
    // a voice's default pace comes with the pack (config.speaker_pace, measured against its teacher); opts.pace overrides it
    const sp = voice.config && voice.config.speaker_pace, pace = opts.pace != null ? opts.pace : ((sp && sp[spk]) || 1);
    const { clauses, oov } = voice.clauses(tag.text, Math.min(Math.floor(200 / Math.max(1, pace)), be.maxT));   // ~13 s of speech at most
    const rng = opts.rng || new Rng(opts.seed != null ? opts.seed : (Math.random() * 4294967296) >>> 0);
    const parts = [], collect = !onChunk || opts.collect !== false;
    let samples = 0, firstChunkMs = 0, chunks = 0;
    for (let i = 0; i < clauses.length; i++) {
      const o = { steps: opts.steps, temp: opts.temp, pace, cond, rng, noise: Array.isArray(opts.noise) ? opts.noise[i] : (i === 0 ? opts.noise : null), dur: opts.dur, chunk: opts.chunk };
      const r = await voice.synthIds(clauses[i], o, onChunk ? async (pcm, info) => {
        if (!firstChunkMs) firstChunkMs = perf() - t0;
        samples += pcm.length; chunks++;
        if (collect) parts.push(pcm);
        await onChunk(pcm, Object.assign(info, { clause: i, clauses: clauses.length }));
      } : null);
      if (!onChunk) { parts.push(r.pcm); samples += r.pcm.length; }
    }
    const ms = perf() - t0, seconds = samples / SAMPLE_RATE;
    const res = { sampleRate: SAMPLE_RATE, samples, seconds, ms, xRealTime: ms > 0 ? seconds / (ms / 1000) : 0, clauses: clauses.length, oov, style: weights, tag: tag.tag };
    if (onChunk) Object.assign(res, { firstChunkMs, chunks });
    if (collect) res.pcm = concat(parts);
    return res;
  }
  return voice;
}

const SYM = (p) => SYM_ID[p];
function concat(list) {
  if (list.length === 1) return list[0];
  const out = new Float32Array(list.reduce((n, a) => n + a.length, 0)); let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}
