// The assistant's LLM pipeline: Gemma 4 E2B-it as a p0pc0rn engine model.  Exposes chat() over the Gemma4 runner (gemma4.js).
// The model is loaded only for its own job and unloaded after (Josh's one-model-at-a-time queue): load() preloads the weights,
// chat() runs prefill + greedy/sampled decode streaming tokens, unload() frees everything.  Same download / progress / cancel / error
// conventions as the image + video pipelines.  Vision (image questions) is handled by ./vision.js, loaded only when images are passed.
'use strict';
import { Gemma4 } from './gemma4.js';
import { GemmaTokenizer } from './tokenizer.js';
import { renderChat, expandImages, parseReply } from './chat_template.js';

const err = (code, m) => { const e = new Error(m); e.code = code; return e; };

export class LLMPipeline {
  constructor(ctx) { this.g = ctx.gpu; this.store = ctx.store; this.emit = ctx.emit || (() => {}); this.opts = ctx.opts || {}; this.model = null; this.tok = null; this.vision = null; this.loaded = false; }

  async _tokenizer() {
    if (this.tok) return this.tok;
    const b = await this.store.readFile('tokenizer.tokenizer'), m = await this.store.readFile('tokenizer.tokenizer_meta');
    this.tok = new GemmaTokenizer(b, JSON.parse(new TextDecoder().decode(m)));
    return this.tok;
  }

  /** preload weights resident (default) or set stream mode; returns {residentMB, mode} */
  /** which MLP shards to stream per token.  mode: 'resident' | 'lean' (resident <= 1200 MB) | 'stream' (<= 800 MB) | {budgetMB} | {streamMlp: [layers]}.
   *  A budget streams the biggest MLP shards first (the double-wide layers 15-34, from the last layer down) until the resident weights fit. */
  planStream(mode) {
    if (mode && typeof mode === 'object' && mode.streamMlp) return mode.streamMlp;
    const budget = mode === 'lean' ? 1200 : mode === 'stream' ? 800 : (mode && typeof mode === 'object' && mode.budgetMB) || Infinity;
    const sh = this.store.shards, NL = this.store.m.model.layers, name = (l) => `lm.layer.${String(l).padStart(2, '0')}.m`;
    let total = 0; for (const s of this.store.m.shards) if (s.name.startsWith('lm.')) total += s.bytes;
    const order = Array.from({ length: NL }, (_, i) => NL - 1 - i).sort((a, b) => sh.get(name(b)).bytes - sh.get(name(a)).bytes || b - a);
    const out = []; for (const l of order) { if (total / 1e6 <= budget) break; out.push(l); total -= sh.get(name(l)).bytes; }
    return out.sort((a, b) => a - b);
  }
  async load({ mode = 'resident', ctxCap = 4096, onProgress } = {}) {
    await this._tokenizer();
    this.model = new Gemma4(this.g, this.store);
    this.model.ctxCap = ctxCap;
    const streamMlp = this.planStream(mode);
    this._streamMlp = streamMlp; await this.model.preload(onProgress, { streamMlp });
    const streamedMB = streamMlp.reduce((a, l) => a + this.store.shards.get(`lm.layer.${String(l).padStart(2, '0')}.m`).bytes, 0) / 1e6;
    this.loaded = true;
    return { residentMB: Math.round(this.g.alive / 1e6), mode: this.model.mode, streamedPerTokenMB: Math.round(streamedMB) };
  }

  unload() {
    if (this.model) { this.model.releaseResident(); this.model.freeKV(); this.model.freeHeadScratch(); for (const b of Object.values(this.model.rope)) this.g.free(b); }
    if (this.vision) this.vision.release();
    this.model = null; this.vision = null; this.tok = null; this.loaded = false;
    this.g.runner.flush(); this.g.freeAll();
    // the ops cache small dummy buffers on the Gpu object; freeAll destroyed them -> drop the caches so the next load makes new ones
    for (const k of ['_ldummies', '_lpdummies', '_dummies', '_vdummies']) this.g[k] = undefined;
  }

  /** chat(messages, {tools, images, maxTokens, temperature, topK, topP, seed, onToken, signal})
   *  messages: [{role, content}] (content string, or parts [{type:'text'|'image', ...}]); images: [ImageBitmap|...] in order of the <image> parts.
   *  -> {text, reply: {thinking, content, toolCalls}, tokens, timings:{prefill, firstToken, decode}, tokPerS, peakMB, stopped} */
  async chat(messages, o = {}) {
    if (!this.loaded) throw err('NOT_LOADED', 'Load the assistant first.');
    const g = this.g, m = this.model, tok = this.tok, cfg = m.m;
    const check = () => { if (o.signal && o.signal.aborted) { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; } if (g.lost) throw err('GPU_LOST', 'GPU reset'); };
    // render + tokenize; count image parts
    const imgCounts = [];
    let text = renderChat(messages, { tools: o.tools, enableThinking: !!o.thinking, addGenerationPrompt: true });
    let inputsEmbeds = null, imageSpans = [];
    if (o.images && o.images.length) {
      if (!this.vision) { const { VisionTower } = await import('./vision.js'); this.vision = new VisionTower(g, this.store); }
      // one model on the GPU at a time: drop the resident LLM weights while the vision tower runs, re-upload after (peak = max, not sum)
      const hadResident = m.resident.size > 0; if (hadResident) { g.runner.flush(); m.releaseResident(); }
      const soft = [];
      for (const im of o.images) { const r = await this.vision.encode(im, { check }); soft.push(r); imgCounts.push(r.n); }
      this.vision.release();
      if (hadResident) await m.preload(null, { streamMlp: this._streamMlp || [] });
      text = expandImages(text, imgCounts);
      // one f32 buffer with all soft tokens, concatenated; spans filled after we know token positions
      const D = cfg.hidden, total = soft.reduce((a, s) => a + s.n, 0);
      inputsEmbeds = g.buffer(total * D * 4, 'softtok'); let off = 0; imageSpans = [];
      for (const s of soft) { g.runner.copy(s.buf, 0, inputsEmbeds, off * D * 4, s.n * D * 4); off += s.n; }
      g.runner.flush(); for (const s of soft) g.free(s.buf);
    }
    // p0pc0rn v019: o.prefix = a forced start of the answer (e.g. '<|tool_call>call:write_song{'): appended to the prompt, and put back
    // in front of the decoded text so the parser sees the whole call (the agent's focused write_song / look_at_result / plan_shots calls)
    if (o.prefix) text += o.prefix;
    gpu_reset(g);
    const ids = tok.encode(text);
    if (ids.length > m.ctxCap - (o.maxTokens || 256)) throw err('TOO_LONG', 'The conversation is too long for this context.');
    // map the <image> token positions to the soft-token buffer rows
    if (inputsEmbeds) { let srcOff = 0, k = 0; for (let i = 0; i < ids.length; i++) if (ids[i] === cfg.image_token) { imageSpans.push({ pos: i, srcOff: srcOff++, n: 1 }); k++; } }
    const t0 = performance.now();
    const pr = await m.prefill(ids, { inputsEmbeds, imageSpans, check });
    await g.done(); const prefillMs = performance.now() - t0;
    if (inputsEmbeds) { g.runner.flush(); g.free(inputsEmbeds); }
    const out = [pr.argmax]; const sc = m.allocScratch(); const eos = new Set(cfg.eos);
    if (o.onToken && !eos.has(pr.argmax)) o.onToken(tok.decode([pr.argmax], { skipSpecial: false }), pr.argmax);   // the first token comes from the prefill
    const maxTok = o.maxTokens || 256; let firstMs = 0; const td0 = performance.now(); let stopped = 'length';
    const sampler = makeSampler(o, g);
    try {
      for (let i = 0; i < maxTok - 1; i++) {
        check();
        const last = out[out.length - 1];
        if (eos.has(last)) { stopped = 'eos'; break; }
        const pos = ids.length + i;
        const pleRow = await this.store.readRows('embed_tokens_per_layer.weight', [last]);
        const psc = Math.fround(cfg.ple_scale); for (let j = 0; j < pleRow.length; j++) pleRow[j] = Math.fround(pleRow[j] * psc);
        const plb = g.upload(pleRow, 'pleRow');
        const r = await m.decodeStep(last, pos, plb, sc, sampler ? { wantLogits: true } : {});
        g.free(plb);
        let nxt = r.argmax;
        if (sampler) { nxt = await sampler(r.logitsBuf); }
        if (i === 0) { await g.done(); firstMs = performance.now() - td0; }
        out.push(nxt);
        if (o.onToken && !eos.has(nxt)) { const piece = tok.decode([nxt], { skipSpecial: false }); o.onToken(piece, nxt); }
      }
    } catch (e) { if (e && e.name === 'AbortError') stopped = 'cancelled'; else throw e; }
    finally { await g.done(); m.freeScratch(sc); }
    const decodeMs = performance.now() - td0;
    const genIds = eos.has(out[out.length - 1]) ? out.slice(0, -1) : out;
    const full = (o.prefix || '') + tok.decode(genIds, { skipSpecial: false });
    let reply; try { reply = parseReply(full); } catch (e) { reply = { thinking: null, content: '', toolCalls: [], parseError: String((e && e.message) || e) }; }   // p0pc0rn v026.8: an unreadable tool call is the caller's to retry, not a failed turn
    return { text: full, reply, tokens: genIds.length, stopped,
      timings: { prefill: +(prefillMs / 1000).toFixed(3), firstToken: +((prefillMs + firstMs) / 1000).toFixed(3), decode: +(decodeMs / 1000).toFixed(3) },
      tokPerS: +((genIds.length - 1) / (decodeMs / 1000)).toFixed(2), prefillTokPerS: +(ids.length / (prefillMs / 1000)).toFixed(1),
      peakMB: Math.round(g.peak / 1e6), promptTokens: ids.length };
  }
}

function gpu_reset(g) { g.resetPeak(); }

// greedy by default (argmax in the engine); if temperature/topK/topP given, sample on the CPU from the softcapped logits
function makeSampler(o, g) {
  if (!o.temperature && !o.topK && !o.topP) return null;
  const T = o.temperature || 1.0, topK = o.topK || 0, topP = o.topP || 1.0;
  let s = (o.seed || 1234) >>> 0; const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return async (logitsBuf) => {
    const lg = new Float32Array(await g.read(logitsBuf, 0, null));
    let ix = Array.from(lg.keys());
    let mx = -Infinity; for (let i = 0; i < lg.length; i++) if (lg[i] > mx) mx = lg[i];   // p0pc0rn v024: Math.max(...262,144 logits) overflowed the stack
    const p = lg.map((v) => Math.exp((v - mx) / T));
    ix.sort((a, b) => p[b] - p[a]);
    if (topK) ix = ix.slice(0, topK);
    let z = 0; for (const i of ix) z += p[i]; let cum = 0; const keep = [];
    for (const i of ix) { cum += p[i] / z; keep.push(i); if (cum >= topP) break; }
    let zz = 0; for (const i of keep) zz += p[i]; let r = rng() * zz;
    for (const i of keep) { r -= p[i]; if (r <= 0) return i; }
    return keep[keep.length - 1];
  };
}
