// Pocket Voice pipeline: Qwen3-TTS-12Hz-0.6B-Base voice cloning (ICL mode) on the p0pc0rn engine core.
//   voice(ref 24 kHz, refText) -> {codes [T*16], xvec [1024]}      codec encoder + speaker encoder (cached by the caller)
//   speak(line, voice, {seed, ...}) -> Float32Array 24 kHz            prompt rows -> talker prefill -> frame loop -> codec decoder
// Phases free their GPU buffers before the next: [encoders] -> [talker + code predictor, resident] -> [codec decoder].
'use strict';
import { buildTokenizer } from '../models/tokenizer.js';
import { h2f } from '../core/gpu.js';
import { Talker } from './talker.js';
import { CodecDecoder, CodecEncoder } from './codec.js';
import { SpeakerEncoder } from './spk.js';

export const VOICE_VERSION = 'voice-0.2';
const D = 1024;

export class QwenTTS {
  constructor(gpu, store) { this.g = gpu; this.s = store; this.m = store.m; this.ids = store.m.model.ids; this.tok = null; }
  bind(gpu) { this.g = gpu; this.s.gpu = gpu; if (this.talker) this.talker.g = gpu; }

  async tokenizer() {
    if (this.tok) return this.tok;
    const dec = new TextDecoder();
    const vocab = JSON.parse(dec.decode(await this.s.readFile('tokenizer.vocab'))), merges = dec.decode(await this.s.readFile('tokenizer.merges'));
    const cfg = JSON.parse(dec.decode(await this.s.readFile('tokenizer.tokenizer_config')));
    this.tok = buildTokenizer(vocab, merges, cfg);
    return this.tok;
  }
  /** official chat wrappers: line ids = ids[3:-5] of "<|im_start|>assistant\n{t}<|im_end|>\n<|im_start|>assistant\n"; ref = ids[3:-2] of "...{t}<|im_end|>\n" */
  async encodeText(line, refText) {
    const tok = await this.tokenizer();
    const li = tok.encode(`<|im_start|>assistant\n${line}<|im_end|>\n<|im_start|>assistant\n`, { add_special_tokens: false }).ids;
    const ri = refText != null ? tok.encode(`<|im_start|>assistant\n${refText}<|im_end|>\n`, { add_special_tokens: false }).ids : null;
    return { input: li, line: li.slice(3, li.length - 5), role: li.slice(0, 3), ref: ri ? ri.slice(3, ri.length - 2) : null };
  }
  /** rows of the projected text table (q8g64s.rows via the store, or f16 rows read by range here) -> Float32Array [ids.length * 1024] */
  async textRows(ids) {
    const x = this.m.tensors['text.table/P'];
    if (x.enc !== 'f16') return this.s.readRows('text.table/P', ids);
    const K = x.shape[1], rb = K * 2, s = this.s, sh = s.shards.get(x.shard), out = new Float32Array(ids.length * K);
    let buf;
    if (s.http) { const parts = await Promise.all(ids.map((i) => s._range(sh.file, x.offset + i * rb, rb))); buf = new Uint8Array(ids.length * rb); parts.forEach((ab, i) => buf.set(new Uint8Array(ab), i * rb)); }
    else buf = new Uint8Array((await s.st.call('readMany', { name: `${s.dir}/${sh.file}`, ranges: ids.map((i) => [x.offset + i * rb, rb]) })).buf);
    const h = new Uint16Array(buf.buffer, buf.byteOffset, ids.length * K);
    for (let i = 0; i < h.length; i++) out[i] = h2f(h[i]);
    return out;
  }
  /** the prefill rows (streaming ICL layout of Qwen3TTSForConditionalGeneration.generate / generate_icl_prompt):
   *  returns {base f32 [L*1024] (text rows + x-vector), gather [{dst, c0, rest}] (codec rows added on the GPU), L, tt f32 [(Ttr+1)*1024], Ttr} */
  async buildPrompt(text, refCodes, xvec, language = 'english') {
    const I = this.ids, Tref = refCodes.length / 16, langId = I.languages[language.toLowerCase()];
    if (langId == null) throw new Error('unsupported language ' + language);
    const textIds = [...text.ref, ...text.line];
    const codecLen = 1 + Tref, textLen = textIds.length + 1;   // + tts_eos
    const L = 3 + 6 + codecLen;
    const uniq = Array.from(new Set([...text.role, ...textIds, I.tts_pad, I.tts_bos, I.tts_eos]));
    const rows = await this.textRows(uniq), at = new Map(uniq.map((v, i) => [v, i]));
    const row = (id) => rows.subarray(at.get(id) * D, at.get(id) * D + D);
    const base = new Float32Array(L * D), gather = [];
    const put = (r, v) => { const o = r * D; for (let k = 0; k < D; k++) base[o + k] += v[k]; };
    for (let i = 0; i < 3; i++) put(i, row(text.role[i]));
    const codecPre = [I.think, I.think_bos, langId, I.think_eos, -1, I.codec_pad];   // -1 = the x-vector row
    for (let i = 0; i < 6; i++) {
      put(3 + i, row(i < 5 ? I.tts_pad : I.tts_bos));
      if (codecPre[i] >= 0) gather.push({ dst: 3 + i, c0: codecPre[i] }); else put(3 + i, xvec);
    }
    const textAll = [...textIds.map((id) => row(id)), row(I.tts_eos)];
    for (let i = 0; i < codecLen; i++) put(9 + i, i < textLen ? textAll[i] : row(I.tts_pad));
    gather.push({ dst: 9, c0: I.codec_bos });
    for (let t = 0; t < Tref; t++) gather.push({ dst: 10 + t, c0: refCodes[t * 16], rest: Array.from(refCodes.subarray(t * 16 + 1, t * 16 + 16)) });
    const trail = textLen > codecLen ? textAll.slice(codecLen) : [];
    const Ttr = trail.length, tt = new Float32Array((Ttr + 1) * D);
    trail.forEach((v, i) => tt.set(v, i * D)); tt.set(row(I.tts_pad), Ttr * D);
    return { base, gather, L, tt, Ttr };
  }

  async loadTalker(onPart) { if (!this.talker) this.talker = new Talker(this.g, this.s); await this.talker.load(onPart); return this.talker; }
  unloadTalker() { if (this.talker) { this.talker.unload(); this.talker = null; } }

  /** reference audio (24 kHz mono) -> {codes Int32Array [T*16], xvec Float32Array [1024], timings} (encoders loaded and freed here) */
  async voice(wav24, { check } = {}) {
    const t = {}; let t0 = performance.now();
    const enc = new CodecEncoder(this.g, this.s); await enc.load();
    let codes; try { codes = await enc.encode(wav24); } finally { enc.unload(); }
    t.codec = (performance.now() - t0) / 1000; if (check) check();
    t0 = performance.now();
    const spk = new SpeakerEncoder(this.g, this.s); await spk.load();
    let xvec; try { xvec = await spk.embed(wav24); } finally { spk.unload(); }
    t.speaker = (performance.now() - t0) / 1000;
    return { codes, xvec, timings: t };
  }

  /** stage 2 (probes v002): the line's codes. o = {seed, mode ('sample'|'greedy'), maxFrames, onProgress, check, keepTalker, sampling overrides,
   *  language} -> {codes Int32Array [frames*16], frames, eos, ran, timings {prompt, load, prefill, frames, framesPerSec}, promptLen} */
  async talk(line, refText, voice, o = {}) {
    const g = this.g, T = {}, P = (x) => o.onProgress && o.onProgress(x);
    let t0 = performance.now();
    const text = o._text || await this.encodeText(line, refText);
    const pr = o._prompt || await this.buildPrompt(text, voice.codes, voice.xvec, o.language || 'english');
    T.prompt = (performance.now() - t0) / 1000;
    t0 = performance.now();
    P({ phase: 'load', frac: 0 });
    const tk = await this.loadTalker((i, n) => P({ phase: 'load', frac: i / n }));
    T.load = (performance.now() - t0) / 1000;
    const words = line ? Math.max(1, line.trim().split(/\s+/).length) : Math.max(1, Math.ceil(text.line.length / 1.3));
    const maxFrames = o.maxFrames || Math.min(600, Math.ceil(12.5 * (4 + words * 0.9)));
    tk.allocKV(pr.L + maxFrames + 4);
    const codes = g.buffer(maxFrames * 16 * 4 + 256, 'qt.codes'), tt = g.upload(pr.tt, 'qt.tt');
    let res;
    try {
      t0 = performance.now();
      const rows = tk.assemble(pr.base, pr.L, pr.gather);
      tk.prefill(rows, pr.L); g.runner.flush(); g.free(rows);
      await g.done(); T.prefill = (performance.now() - t0) / 1000;
      t0 = performance.now();
      const sampling = Object.assign({}, this.m.model.sampling, o.sampling || {});
      res = await tk.generate({ codes, maxFrames, mode: o.mode || (sampling.do_sample === false ? 'greedy' : 'sample'), sampling, seed: o.seed >>> 0, tt: { buf: tt }, Ttr: pr.Ttr,
        ids: { eos: this.ids.codec_eos }, check: o.check, onFrame: (k) => P({ phase: 'speak', frac: Math.min(0.99, (k + 1) / (maxFrames * 0.5)), frame: k + 1, seconds: (k + 1) / 12.5 }) });
      await g.done(); T.frames = (performance.now() - t0) / 1000; T.framesPerSec = res.ran / T.frames;
      res.codes = new Int32Array(await g.read(codes, 0, res.frames * 64));
    } finally { g.runner.flush(); g.free(codes); g.free(tt); if (!o.keepTalker) this.unloadTalker(); else tk.freeKV(); }
    return { codes: res.codes, frames: res.frames, eos: res.eos, ran: res.ran, timings: T, promptLen: pr.L };
  }
  /** stage 3 (probes v002): codec decoder over [ref codes ; generated] -> only the generated region is synthesised (exact: causal conv
   *  tiles, see codec.js) -> {wav Float32Array 24 kHz, timings {decode}} */
  async render(refCodes, genCodes, o = {}) {
    const g = this.g, P = (x) => o.onProgress && o.onProgress(x), t0 = performance.now();
    P({ phase: 'decode', frac: 0 });
    const all = new Int32Array(refCodes.length + genCodes.length); all.set(refCodes); all.set(genCodes, refCodes.length);
    const dec = new CodecDecoder(g, this.s); await dec.load();
    let wav; try { wav = await dec.decode(all, { from: refCodes.length / 16, check: o.check, onTile: (i, n, st) => P(Object.assign({ phase: 'decode', frac: i / n }, st || {})) }); } finally { dec.unload(); }
    return { wav, timings: { decode: (performance.now() - t0) / 1000 } };
  }
  /** the line in the voice (both stages in one call; tests). o = talk()'s options */
  async speak(line, refText, voice, o = {}) {
    const a = await this.talk(line, refText, voice, o);
    const b = await this.render(voice.codes, a.codes, o);
    return { wav: b.wav, sampleRate: 24000, frames: a.frames, eos: a.eos, codes: a.codes, timings: Object.assign({}, a.timings, b.timings), promptLen: a.promptLen };
  }
}
