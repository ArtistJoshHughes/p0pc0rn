// Pocket STT stream: 16 kHz samples in, words out, as they are spoken.  Used by stt_engine.js (after its checks) and by the desk check.
//   new SttStream({ model (a loaded SttModel), gpu, prompt (index), onClose }, { lookahead, eouMs, maxSeconds, onText, onEnd, profile })
// End of speech: the model has no end-of-utterance token (it writes a sentence's full stop only once the next sentence starts), so a
// turn ends on silence: no new word for `eouMs` of processed audio AND no voice in the audio for `eouMs` (a level gate over a floor that
// follows the room: fast down, slow up).  Nothing is kept: samples become mel frames, the frames go to the GPU, both are dropped.
'use strict';
import { LOOKAHEADS } from './stt.js';
import { MelStream } from './mel.js';

const SR = 16000, FRAME_S = 0.08;
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };

export class SttStream {
  constructor(ctx, o) {
    this.ctx = ctx; this.m = ctx.model; this.gpu = ctx.gpu; this.o = Object.assign({ lang: 'auto', lookahead: 3, eouMs: 900, maxSeconds: 60 }, o);
    if (!LOOKAHEADS.includes(this.o.lookahead)) throw err('BAD_ARG', 'lookahead must be one of ' + LOOKAHEADS.join(', '));
    this.mel = new MelStream(this.m.melFb);
    this.m.reset(ctx.prompt, this.o.lookahead);
    this.pend = new Float32Array(0); this.tokens = []; this.text = ''; this.lang = null; this.done = false; this.ended = false;
    this.n = 0; this.chain = Promise.resolve(); this.err = null;
    this.vad = { noise: 0.01, thr: 0.006, lastVoice: -1, firstVoice: -1, blk: new Float32Array(160), bn: 0 };
    this.st = { chunks: 0, encMs: 0, decMs: 0, reads: 0, wallFirstVoice: 0, wallFirstText: 0, wallLastVoice: 0, wallEnd: 0, lastTokFrame: -1, audioS: 0 };
  }
  get seconds() { return this.n / SR; }
  /** 16 kHz mono float samples (any length) */
  push(x) {
    if (this.done || this.err) return;
    this.n += x.length;
    this._vad(x);
    this._append(this.mel.push(x));
    this._pump();
    if (this.seconds > this.o.maxSeconds && !this.ended) this._end('max');
  }
  _vad(x) {
    const v = this.vad;
    for (let i = 0; i < x.length; i++) {
      v.blk[v.bn++] = x[i];
      if (v.bn === 160) {
        let s = 0; for (let j = 0; j < 160; j++) s += v.blk[j] * v.blk[j];
        const rms = Math.sqrt(s / 160), t = (this.n - x.length + i + 1) / SR;
        if (rms < v.noise) v.noise = rms; else v.noise += (rms - v.noise) * 0.002;   // the room's floor: fast down, slow up
        v.thr = Math.max(v.noise * 3.2, 0.004);
        if (rms > v.thr) { if (v.firstVoice < 0) { v.firstVoice = t; this.st.wallFirstVoice = performance.now(); } v.lastVoice = t; this.st.wallLastVoice = performance.now(); }
        v.bn = 0;
      }
    }
  }
  _pump() {
    this.chain = this.chain.then(async () => {
      while (!this.err && this.pend.length >= this.m.need * 128 && !(this.o.maxChunks && this.st.chunks >= this.o.maxChunks)) {
        const k = this.m.need * 128, mel = this.pend.subarray(0, k); this.pend = this.pend.slice(k);
        const t0 = performance.now();
        this.m.chunk(mel);
        if (this.o.profile) await this.gpu.done();
        const t1 = performance.now();
        if (this.o.tap) await this.o.tap(this.m);   // the desk check reads E here (not timed)
        const t1b = performance.now();
        const toks = await this.m.decode({ trace: this.o.trace });
        const t2 = performance.now();
        this.st.chunks++; this.st.encMs += t1 - t0; this.st.decMs += t2 - t1b; this.st.reads += this.m.reads;
        if (toks.length) {
          for (const t of toks) this.tokens.push(t);
          this.st.lastTokFrame = toks[toks.length - 1].frame;
          const r = this.m.text(this.tokens); this.text = r.text; if (r.lang) this.lang = r.lang;
          if (this.text && !this.st.wallFirstText) this.st.wallFirstText = performance.now();
          if (this.o.onText && !this.ended) try { this.o.onText({ text: this.text, lang: this.lang, tokens: this.tokens.length }); } catch (e) { /* */ }
        }
        this._eou();
      }
    }).catch((e) => { this.err = e; if (this.o.onEnd && !this.ended) { this.ended = true; try { this.o.onEnd({ text: this.text, lang: this.lang, reason: 'error', error: e }); } catch (e2) { /* */ } } });
  }
  _eou() {
    if (this.ended || !this.text.trim()) return;
    const procS = this.m.P * FRAME_S, sinceTok = procS - (this.st.lastTokFrame + 1) * FRAME_S, sinceVoice = this.seconds - Math.max(0, this.vad.lastVoice), q = this.o.eouMs / 1000;
    if (sinceTok >= q && sinceVoice >= q) this._end('silence');
  }
  _end(reason) {
    if (this.ended) return;
    this.ended = true; this.st.wallEnd = performance.now();
    if (this.o.onEnd) try { this.o.onEnd({ text: this.text, lang: this.lang, reason }); } catch (e) { /* */ }
  }
  _append(f) { if (f.length) { const p = new Float32Array(this.pend.length + f.length); p.set(this.pend); p.set(f, this.pend.length); this.pend = p; } }
  /** no more audio: pad silence (not counted as audio) until every pushed frame is through the encoder -> {text, lang, tokens, stats}.
   *  fo.pad false: no padding (the desk check feeds the reference's own padded audio) */
  async finish(fo = {}) {
    if (!this.done) {
      if (fo.pad !== false) this._append(this.mel.push(new Float32Array((16 * (this.m.r + 1) + 4) * 160 + 1600)));
      this.done = true; this._pump();
    }
    await this.chain;
    if (!this.ended && !this.err) this._end('finish');
    this._close();
    if (this.err) throw this.err;
    return { text: this.text, lang: this.lang, tokens: this.tokens.map((t) => t.tok), stats: this.stats() };
  }
  cancel() { this.done = true; this.err = this.err || Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' }); this._close(); }
  _close() { if (this.ctx.onClose) this.ctx.onClose(this); }
  stats() {
    const s = this.st, aud = this.seconds;
    return { chunks: s.chunks, audioS: +aud.toFixed(2), encMs: Math.round(s.encMs), decMs: Math.round(s.decMs), reads: s.reads,
      rtf: aud > 0 ? +((s.encMs + s.decMs) / 1000 / aud).toFixed(3) : null, chunkMs: s.chunks ? +((s.encMs + s.decMs) / s.chunks).toFixed(1) : null,
      firstWordMs: s.wallFirstText && s.wallFirstVoice ? Math.round(s.wallFirstText - s.wallFirstVoice) : null,
      endMs: s.wallEnd && s.wallLastVoice ? Math.round(s.wallEnd - s.wallLastVoice) : null, lookahead: this.o.lookahead };
  }
}
