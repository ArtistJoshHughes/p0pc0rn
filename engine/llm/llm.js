// The assistant's LLM pipeline: Gemma 4 E2B-it as a p0pc0rn engine model.  Exposes chat() over the Gemma4 runner (gemma4.js).
// The model is loaded only for its own job and unloaded after (Josh's one-model-at-a-time queue): load() preloads the weights,
// chat() runs prefill + greedy/sampled decode streaming tokens, unload() frees everything.  Same download / progress / cancel / error
// conventions as the image + video pipelines.  Vision (image questions) is handled by ./vision.js, loaded only when images are passed.
// v044 (10-21): the decode runs Gemma4.decodeLoop(): persistent per-token buffers + each token recorded while the GPU runs the one before.
'use strict';
import { Gemma4, dropAB } from './gemma4.js';   // 3.9 (E4B room): + dropAB
import { GemmaTokenizer } from './tokenizer.js';
import { renderChat, expandImages, parseReply } from './chat_template.js';
import { SplitModel, connectWorker, SPLIT_PROTO } from './split.js';   // 3.8: iOS 27's second process
import { KX } from './lopsx.js';   // 3.8 (bench v041): the second process runs the same kernels

const err = (code, m) => { const e = new Error(m); e.code = code; return e; };

export class LLMPipeline {
  constructor(ctx) { this.g = ctx.gpu; this.store = ctx.store; this.emit = ctx.emit || (() => {}); this.opts = ctx.opts || {}; this.model = null; this.tok = null; this.vision = null; this.loaded = false; this.split = null; }

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
  /** 3.8: split = { at, chunk, workerUrl } (engine/llm/split.js): this page loads layers [at, NL) + the embedding and the head, a module
   *  shared worker in a process of its own loads layers [0, at) from the same pack in storage; anything wrong there = SPLIT_FAILED */
  async load({ mode = 'resident', ctxCap = 4096, onProgress, split = null } = {}) {
    await this._tokenizer();
    this.model = new Gemma4(this.g, this.store);
    this.model.ctxCap = ctxCap;
    if (split) { this.model.l0 = split.at; await this._startWorker(split, ctxCap); }   // the worker part FIRST: a split that can't start costs this page nothing
    const streamMlp = split ? [] : this.planStream(mode);   // the split's page part stays resident (it is small enough)
    this._streamMlp = streamMlp; await this.model.preload(onProgress, { streamMlp });
    const streamedMB = streamMlp.reduce((a, l) => a + this.store.shards.get(`lm.layer.${String(l).padStart(2, '0')}.m`).bytes, 0) / 1e6;
    if (split) this.split = new SplitModel(this.model, this._wk, this._wkInfo);
    this.loaded = true;
    return { residentMB: Math.round(this.g.alive / 1e6), mode: this.model.mode, streamedPerTokenMB: Math.round(streamedMB) };
  }

  /** 3.8: the worker part: a new module shared worker (served by sw.js with COEP require-corp, or it would share this page's process),
   *  its init = layers [0, at) of the pack this page loaded (its storage worker lets go of its file handles first) */
  async _startWorker(sp, ctxCap) {
    const t0 = performance.now(); let wk = null;
    try {
      if (!this.store.http) { try { await this.store.st.call('closeAll'); } catch (e) { /* none were open */ } }
      wk = await connectWorker(sp.workerUrl, 'p0split-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), { timeoutMs: 20000 });
      const h = wk.hello || {};
      if (h.coep !== 'require-corp') throw new Error(`the worker part did not come from the service worker (coep ${h.coep || 'none'}): it would share this page's process`);
      if (h.proto !== SPLIT_PROTO) throw new Error(`the worker part is another version (${h.proto} here ${SPLIT_PROTO})`);
      const info = await wk.call('init', { dir: this.store.dir, packVersion: this.store.m.pack_version, l0: 0, l1: sp.at, ctxCap, chunk: sp.chunk, opts: { chunk: sp.chunk }, Mmax: 8, mirror: this.model.mirrorKV(), kx: KX.on }, [], 30000);   // 3.8 port: a start takes 0.5-4 s; a hung one cost 120 s
      info.ms = Math.round(performance.now() - t0);
      this._wk = wk; this._wkInfo = info;
    } catch (e) {
      if (wk) wk.close();
      throw err('SPLIT_FAILED', 'split: ' + String((e && e.message) || e).slice(0, 300));
    }
  }

  unload() {
    const wk = this._wk; if (this.split && this.split.release) this.split.release(); this.split = null; this._wk = null; this._wkInfo = null; if (wk) wk.close();   // 3.8 port: + the kept recorders   // 3.8: the worker part frees its memory and ends
    if (this.model) { this.model.releaseResident(); this.model.freeKV(); this.model.freeHeadScratch(); for (const b of Object.values(this.model.rope)) this.g.free(b); }
    if (this.vision) this.vision.release();
    this.model = null; this.vision = null; this.tok = null; this.loaded = false;
    this.g.runner.flush(); this.g.freeAll();
    // the ops cache small dummy buffers on the Gpu object; freeAll destroyed them -> drop the caches so the next load makes new ones
    for (const k of ['_ldummies', '_lpdummies', '_dummies', '_vdummies', '_spdummies', '_kxdummies']) this.g[k] = undefined;   // 3.8: + the speculative loop's
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
    if (o.images && o.images.length && !cfg.vision) throw err('NO_VISION', 'This model does not read pictures.');   // 3.8: Bolt E4B is text only
    if (o.images && o.images.length) {
      if (!this.vision) { const { VisionTower } = await import('./vision.js'); this.vision = new VisionTower(g, this.store); }
      // one model on the GPU at a time: drop the resident LLM weights while the vision tower runs, re-upload after (peak = max, not sum)
      const hadResident = m.resident.size > 0; if (hadResident) { g.runner.flush(); m.releaseResident(); }
      const soft = [];
      for (const im of o.images) { const r = await this.vision.encode(im, { check }); soft.push(r); imgCounts.push(r.n); }
      this.vision.release();
      if (hadResident) await m.preload(null, { streamMlp: this._streamMlp || [] });
      if (Array.isArray(this.store.pool)) { for (const b of this.store.pool) dropAB(b); this.store.pool.length = 0; }   // 3.9 (E4B room): no upload staging kept after the re-upload
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
    const t0 = performance.now(), R = this.split || m;   // 3.8: a split model's two halves (engine/llm/split.js)
    const pr = await R.prefill(ids, { inputsEmbeds, imageSpans, check, signal: o.signal });
    await g.done(); const prefillMs = performance.now() - t0;
    if (inputsEmbeds) { g.runner.flush(); g.free(inputsEmbeds); }
    const out = [pr.argmax]; const sc = m.scratch(); const eos = new Set(cfg.eos);   // 3.8: kept on the model (gemma4.js scratch())
    if (o.onToken && !eos.has(pr.argmax)) o.onToken(tok.decode([pr.argmax], { skipSpecial: false }), pr.argmax);   // the first token comes from the prefill
    const maxTok = o.maxTokens || 256; let firstMs = 0; const td0 = performance.now(); let stopped = 'length', samplingError = null;
    const sampler = makeSampler(o, g);
    const psc = Math.fround(cfg.ple_scale);
    const pleRow = async (id) => { const r = await this.store.readRows('embed_tokens_per_layer.weight', [id]); for (let j = 0; j < r.length; j++) r[j] = Math.fround(r[j] * psc); return r; };
    try {
      const res = await R.decodeLoop(sc, { first: pr.argmax, pos0: ids.length, steps: maxTok - 1, check, pleRow, signal: o.signal, history: ids, eos: (id) => eos.has(id), stats: o.decodeStats || null,
        pick: sampler ? (r) => sampler(r.logitsBuf) : null, samp: sampler ? samplingOf(o) : null,   // 3.8: with the drafter, speculative sampling (spec.js)
        onToken: (nxt, r, i) => {
          if (i === 0) firstMs = performance.now() - td0;
          out.push(nxt);
          if (o.onToken && !eos.has(nxt)) { const piece = tok.decode([nxt], { skipSpecial: false }); o.onToken(piece, nxt); }
        } });
      stopped = res.stopped; samplingError = res.samplingError || null;
    } catch (e) { if (e && e.name === 'AbortError') stopped = 'cancelled'; else throw e; }
    finally { await g.done(); }
    const decodeMs = performance.now() - td0;
    const genIds = eos.has(out[out.length - 1]) ? out.slice(0, -1) : out;
    const full = (o.prefix || '') + tok.decode(genIds, { skipSpecial: false });
    let reply; try { reply = parseReply(full); } catch (e) { reply = { thinking: null, content: '', toolCalls: [], parseError: String((e && e.message) || e) }; }   // p0pc0rn v026.8: an unreadable tool call is the caller's to retry, not a failed turn
    return Object.assign({ text: full, reply, tokens: genIds.length, stopped,
      timings: { prefill: +(prefillMs / 1000).toFixed(3), firstToken: +((prefillMs + firstMs) / 1000).toFixed(3), decode: +(decodeMs / 1000).toFixed(3) },
      tokPerS: +((genIds.length - 1) / (decodeMs / 1000)).toFixed(2), prefillTokPerS: +(ids.length / (prefillMs / 1000)).toFixed(1),
      peakMB: Math.round(g.peak / 1e6), promptTokens: ids.length }, samplingError ? { samplingError } : {});   // 3.8: speculative sampling fell back
  }
}

function gpu_reset(g) { g.resetPeak(); }

// greedy by default (argmax in the engine); if temperature/topK/topP given, sample on the CPU from the softcapped logits
// 3.8: the top K by insertion instead of sorting all 262,144 logits (the same tokens for the same seed: equal probabilities keep the
// index order of the stable sort)
function makeSampler(o, g) {
  if (!o.temperature && !o.topK && !o.topP) return null;
  const T = o.temperature || 1.0, topK = o.topK || 0, topP = o.topP || 1.0;
  let s = (o.seed || 1234) >>> 0; const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  let p = null;
  return async (logitsBuf) => {
    const lg = new Float32Array(await g.read(logitsBuf, 0, null)), n = lg.length;
    let mx = -Infinity; for (let i = 0; i < n; i++) if (lg[i] > mx) mx = lg[i];   // p0pc0rn v024: Math.max(...262,144 logits) overflowed the stack
    if (!p || p.length !== n) p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = Math.exp((lg[i] - mx) / T);
    let ix;
    if (topK && topK < n) {
      ix = [];
      for (let i = 0; i < n; i++) {
        const v = p[i];
        if (ix.length === topK && !(v > p[ix[topK - 1]])) continue;   // an equal p with a higher index stays behind (the stable sort)
        let j = ix.length; while (j > 0 && p[ix[j - 1]] < v) j--;
        ix.splice(j, 0, i); if (ix.length > topK) ix.pop();
      }
    } else { ix = Array.from(p.keys()); ix.sort((a, b) => p[b] - p[a]); }
    let z = 0; for (const i of ix) z += p[i]; let cum = 0; const keep = [];
    for (const i of ix) { cum += p[i] / z; keep.push(i); if (cum >= topP) break; }
    let zz = 0; for (const i of keep) zz += p[i]; let r = rng() * zz;
    for (const i of keep) { r -= p[i]; if (r <= 0) return i; }
    return keep[keep.length - 1];
  };
}
/** 3.8: makeSampler's settings for the GPU's speculative sampling (spec.js, lops_samp.js): its rule, its defaults, its seed */
function samplingOf(o) {
  return { temperature: o.temperature || 1.0, topK: o.topK || 0, topP: o.topP || 1.0, seed: (o.seed || 1234) >>> 0 };
}
