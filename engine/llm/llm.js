// The assistant's LLM pipeline: Gemma 4 E2B-it as a p0pc0rn engine model.  Exposes chat() over the Gemma4 runner (gemma4.js).
// The model is loaded only for its own job and unloaded after (Josh's one-model-at-a-time queue): load() preloads the weights,
// chat() runs prefill + greedy/sampled decode streaming tokens, unload() frees everything.  Same download / progress / cancel / error
// conventions as the image + video pipelines.  Vision (image questions) is handled by ./vision.js, loaded only when images are passed.
// v044 (10-21): the decode runs Gemma4.decodeLoop(): persistent per-token buffers + each token recorded while the GPU runs the one before.
'use strict';
import { Gemma4, dropAB } from './gemma4.js';   // 3.9 (E4B room): + dropAB
import { GemmaTokenizer } from './tokenizer.js';
import { renderChat, expandImages, parseReply } from './chat_template.js';
import { SplitModel, connectWorker, SPLIT_PROTO, SNAP_CAP_MB, splitSettled, splitHelpers } from './split.js';   // 3.8: iOS 27's second process
import { KX, picksNow } from './lopsx.js';   // 3.8 (bench v041): the second process runs the same kernels
import { adNow } from './lopsd.js';   // v4 (autotune): and the same decode attention

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
    if (split) { this.model.l0 = split.at; if (split.mirror) this.model.mirrorPlus = split.mirror; await this._startWorker(split, ctxCap); }   // the worker part FIRST: a split that can't start costs this page nothing (v4: + mirror layers asked for)
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
    const t0 = performance.now(); let wk = null, before = null;
    // v4: a worker part this page closed before (Juli's, ahead of the Bigger brain's) must have confirmed its end first (split.js)
    try { before = await splitSettled({ timeoutMs: sp.closeWaitMs || 15000 }); } catch (e) { before = { timeout: true, helpers: splitHelpers() }; }
    try {
      if (!this.store.http) { try { await this.store.st.call('closeAll'); } catch (e) { /* none were open */ } }
      wk = await connectWorker(sp.workerUrl, 'p0split-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), { timeoutMs: 20000 });
      const h = wk.hello || {};
      if (h.coep !== 'require-corp') throw new Error(`the worker part did not come from the service worker (coep ${h.coep || 'none'}): it would share this page's process`);
      if (h.proto !== SPLIT_PROTO) throw new Error(`the worker part is another version (${h.proto} here ${SPLIT_PROTO})`);
      const info = await wk.call('init', { dir: this.store.dir, packVersion: this.store.m.pack_version, l0: 0, l1: sp.at, ctxCap, chunk: sp.chunk, opts: { chunk: sp.chunk }, Mmax: 8, mirror: this.model.mirrorKV(), kx: KX.on, tune: { picks: picksNow(), ad: adNow() } }, [], 30000);   // 3.8 port: a start takes 0.5-4 s; a hung one cost 120 s
      info.ms = Math.round(performance.now() - t0); info.before = before;
      this._wk = wk; this._wkInfo = info;
    } catch (e) {
      if (wk) wk.close();
      throw err('SPLIT_FAILED', 'split: ' + String((e && e.message) || e).slice(0, 300));
    }
  }

  /** v4 (the prefix snapshot, chat keepPrefix): the MB the kept prefixes take on each side ({ page, helper }), or null when nothing is loaded */
  prefixMB() { if (!this.model) return null; return this.split ? this.split.prefixMB() : { page: this.model.prefixMB(), helper: 0 }; }
  /** lets every kept prefix go, on both sides */
  async dropPrefix() { if (this._keeps) this._keeps.clear(); if (!this.model) return; if (this.split) await this.split.dropPrefix(); else this.model.dropPrefix(); }
  /** -> a Promise of the worker part's confirmed end ({ closed, device, ms, waitMs }; rejects SPLIT_CLOSE_TIMEOUT), or null (no split) */
  unload() {
    const wk = this._wk; if (this.split && this.split.release) this.split.release(); this.split = null; this._wk = null; this._wkInfo = null;   // 3.8 port: + the kept recorders
    const closing = wk ? (wk.closeAsync ? wk.closeAsync() : (wk.close(), null)) : null;   // 3.8: the worker part frees its memory and ends; v4: confirmed
    if (closing) closing.catch(() => {});
    if (this.model) { this.model.releaseResident(); this.model.freeKV(); this.model.freeHeadScratch(); for (const b of Object.values(this.model.rope)) this.g.free(b); }
    if (this.vision) this.vision.release();
    this.model = null; this.vision = null; this.tok = null; this.loaded = false; this._keeps = null;   // v4: the prefix snapshots go with the model
    this.g.runner.flush(); this.g.freeAll();
    // the ops cache small dummy buffers on the Gpu object; freeAll destroyed them -> drop the caches so the next load makes new ones
    for (const k of ['_ldummies', '_lpdummies', '_dummies', '_vdummies', '_spdummies', '_kxdummies']) this.g[k] = undefined;   // 3.8: + the speculative loop's
    return closing;
  }

  /** chat(messages, {tools, images, maxTokens, temperature, topK, topP, seed, onToken, signal})
   *  messages: [{role, content}] (content string, or parts [{type:'text'|'image', ...}]); images: [ImageBitmap|...] in order of the <image> parts.
   *  -> {text, reply: {thinking, content, toolCalls}, tokens, timings:{prefill, firstToken, decode}, tokPerS, peakMB, stopped} */
  async chat(messages, o = {}) {
    if (!this.loaded) throw err('NOT_LOADED', 'Load the assistant first.');
    const g = this.g, m = this.model, tok = this.tok, cfg = m.m;
    // v4 (the Bigger brain's first answer stopped the page on desktop browsers): o.trace(stage) = where an answer is, step by step (tools/
    // e4bprobe.js logs it; nothing else passes it)
    const tr = typeof o.trace === 'function' ? (s) => { try { o.trace(s); } catch (e) { /* the log only */ } } : null;
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
    if (tr) tr(`prompt rendered (${text.length} characters)`);
    const ids = tok.encode(text);
    if (tr) tr(`tokenized: ${ids.length} tokens`);
    if (ids.length > m.ctxCap - (o.maxTokens || 256)) throw err('TOO_LONG', 'The conversation is too long for this context.');
    // map the <image> token positions to the soft-token buffer rows
    if (inputsEmbeds) { let srcOff = 0, k = 0; for (let i = 0; i < ids.length; i++) if (ids[i] === cfg.image_token) { imageSpans.push({ pos: i, srcOff: srcOff++, n: 1 }); k++; } }
    const t0 = performance.now(), R = this.split || m;   // 3.8: a split model's two halves (engine/llm/split.js)
    // v4 (the prefix snapshot): o.keepPrefix = the prompt's fixed start (its system turn, or its first n turns) is kept for the next
    // answers (gemma4.js snapshotPrefix; in a split each process keeps its own caches' rows). The same start again = a hit: only what
    // follows it is read in. A start that shares most of a kept one (a voice prompt whose last note changed) = a partial hit: the kept rows
    // go back, the read-in starts where the tokens part, and the new start replaces the kept one. Anything else = a miss: all of it is read
    // in and kept. A kept start's key = its token count + a hash of its tokens; this page compares the tokens themselves before any reuse.
    // o.prefixOnly = read in and keep only the start (a warm-up: no answer)
    let from = 0, snapAt = 0, snapKey = null, snap = null, side = {}, spec = null;
    const split = !!this.split, keeps = this._keeps || (this._keeps = new Map());
    if (o.keepPrefix) {
      spec = prefixSpec(o.keepPrefix);
      const off = inputsEmbeds ? 'a picture' : (m.opts || {}).prefillAhead === false ? 'the read-in without load-ahead' : split && !spec.helper ? 'off in the helper (it runs the first layers)'
        : !split && !spec.page ? 'off on the page' : split && !spec.page && !this.split.mirrorsOnly() ? 'the page runs layers of its own' : null;
      const pf = off ? { why: off } : prefixOf(text, ids, (t) => tok.encode(t), spec);
      snap = { hit: false, P: pf.P || 0 };
      if (!pf.key) snap.why = pf.why;
      else {
        let best = null;   // the kept start that shares the most tokens with this prompt (the same start first)
        for (const [key, k] of keeps) {
          const n = Math.min(k.length, pf.P); let i = 0; while (i < n && k[i] === ids[i]) i++;
          if (key === pf.key && i === k.length && k.length === pf.P) { best = { key, k, at: i, full: true }; break; }
          if (i >= Math.max(64, m.prefixReuseFrom(k.length)) && (!best || i > best.at)) best = { key, k, at: Math.min(i, pf.P - 1), full: false };
        }
        const P = best ? await (split ? this.split.restorePrefix(best.key, { signal: o.signal }) : m.restorePrefix(best.key)) : 0;
        if (best) keeps.delete(best.key);
        if (best && P === best.k.length) {
          from = best.full ? P : best.at; snap.hit = true; if (split) snap.pageFrom = this.split.from;
          if (best.full) keeps.set(best.key, best.k);
          else { snap.partial = true; snap.why = `the start changed after token ${best.at}`; await (split ? this.split.dropPrefix(best.key) : m.dropPrefix(best.key)); }   // the new start replaces it
        } else snap.why = best ? 'gone (the model let it go)' : keeps.size ? 'a new start' : 'none yet';
        if (!best || !best.full || P !== best.k.length) { snapAt = pf.P; snapKey = pf.key; side = { snapAt, snapKey, snapSelf: spec.page, snapCapMB: spec.pageCapMB, snapMax: spec.max, helperCapMB: spec.helperCapMB }; }
      }
    }
    const NLr = (m.l1 || cfg.layers) - (m.l0 || 0), onLayer = tr ? async (l, p0) => { if (l < 0) tr(`read-in chunk at ${p0}: its rows and embeddings`); else if ((l + 1) % 6 === 0 || l === (m.l1 || cfg.layers) - 1) tr(`read-in chunk at ${p0}: ${l + 1 - (m.l0 || 0)} of ${NLr} layers recorded`); } : undefined;
    const warm = !!o.prefixOnly, rid = warm && snapKey ? ids.slice(0, snapAt) : ids;   // a warm-up reads in the prefix alone
    if (tr) tr(`read-in: ${rid.length - from} tokens${from ? ` (the first ${from} kept)` : ''}, ${split ? 'split' : 'one process'}`);
    const pr = warm && !snapKey ? null : await R.prefill(rid, Object.assign({ inputsEmbeds, imageSpans, check, signal: o.signal }, from ? { from } : {}, side, onLayer ? { onLayer } : {}));
    if (snap) {   // what each process keeps now (MB)
      if (snapKey) {
        const kept = split ? !!(this.split.last && this.split.last.kept) : m.hasPrefix(snapKey);
        if (kept) { keeps.set(snapKey, Uint32Array.from(ids.slice(0, snapAt))); while (keeps.size > spec.max) keeps.delete(keeps.keys().next().value); }
        else snap.why = `${snap.why}; not kept: ${(split ? this.split.last && this.split.last.why : m._pfxLast && m._pfxLast.why) || 'unknown'}`;
        snap.kept = kept;
      } else snap.kept = snap.hit;
      const mb = split ? this.split.prefixMB() : { page: m.prefixMB(), helper: 0 };
      Object.assign(snap, { readIn: warm ? (snapKey ? snapAt : 0) : ids.length - from, pageMB: mb.page, helperMB: mb.helper });
    }
    if (warm) {   // no answer
      await g.done(); if (inputsEmbeds) { g.runner.flush(); g.free(inputsEmbeds); }
      const ms = performance.now() - t0;
      return { text: '', reply: { thinking: null, content: '', toolCalls: [] }, tokens: 0, stopped: 'prefix', timings: { prefill: +(ms / 1000).toFixed(3), firstToken: 0, decode: 0 },
        tokPerS: 0, prefillTokPerS: 0, peakMB: Math.round(g.peak / 1e6), promptTokens: ids.length, snapshot: snap || { hit: false, P: 0, why: 'no keepPrefix' } };
    }
    if (tr) tr('read-in: its first token chosen');
    await g.done(); const prefillMs = performance.now() - t0;
    if (tr) tr(`read-in done on the GPU (${Math.round(prefillMs)} ms)`);
    if (inputsEmbeds) { g.runner.flush(); g.free(inputsEmbeds); }
    const out = [pr.argmax]; const sc = m.scratch(); const eos = new Set(cfg.eos);   // 3.8: kept on the model (gemma4.js scratch())
    if (o.onToken && !eos.has(pr.argmax)) o.onToken(tok.decode([pr.argmax], { skipSpecial: false }), pr.argmax);   // the first token comes from the prefill
    const maxTok = o.maxTokens || 256; let firstMs = 0; const td0 = performance.now(); let stopped = 'length', samplingError = null;
    const sampler = makeSampler(o, g);
    const psc = Math.fround(cfg.ple_scale);
    const pleRow = async (id) => { const r = await this.store.readRows('embed_tokens_per_layer.weight', [id]); for (let j = 0; j < r.length; j++) r[j] = Math.fround(r[j] * psc); return r; };
    if (tr) tr(`decode starts (${sampler ? 'sampled' : 'greedy'}${m.drafter ? ', drafter' : ''})`);
    try {
      const res = await R.decodeLoop(sc, { first: pr.argmax, pos0: ids.length, steps: maxTok - 1, check, pleRow, signal: o.signal, history: ids, eos: (id) => eos.has(id), stats: o.decodeStats || null,
        pick: sampler ? (r) => sampler(r.logitsBuf) : null, samp: sampler ? samplingOf(o) : null,   // 3.8: with the drafter, speculative sampling (spec.js)
        onToken: (nxt, r, i) => {
          if (i === 0) { firstMs = performance.now() - td0; if (tr) tr('decode: step 1 done'); } else if (tr && (i === 1 || i % 16 === 0)) tr(`decode: step ${i + 1} done`);
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
      peakMB: Math.round(g.peak / 1e6), promptTokens: ids.length }, samplingError ? { samplingError } : {}, snap ? { snapshot: snap } : {});   // 3.8: speculative sampling fell back   // v4: + the system-prompt snapshot
  }
}

function gpu_reset(g) { g.resetPeak(); }

/** v4 (the prefix snapshot): keepPrefix's settings (true = the defaults) -> { messages: the start = the first n turns (1: the system
 *  turn), page / helper: each side keeps its rows (a split's page may leave its mirrors' rows to the helper), pageCapMB / helperCapMB:
 *  that side's GPU memory with them at most (0 = no limit; the helper's default SNAP_CAP_MB), max: starts kept per side (2) } */
export function prefixSpec(k) {
  const o = k && typeof k === 'object' ? k : {};
  return { messages: Math.max(1, (o.messages | 0) || 1), page: o.page !== false, helper: o.helper !== false,
    pageCapMB: +o.pageCapMB || 0, helperCapMB: o.helperCapMB != null ? (+o.helperCapMB || 0) : SNAP_CAP_MB, max: Math.max(1, (o.max | 0) || 2) };
}
/** the prompt's fixed start as tokens (its first spec.messages turns, to the end of the n-th '<turn|>\n'), when they are the first
 *  tokens of the whole prompt as tokenized and something follows them -> { P, key } (key = the count + a hash of those tokens) or { why } */
export function prefixOf(text, ids, encode, spec = {}) {
  if (!text.startsWith('<bos><|turn>')) return { why: 'the prompt starts with no turn' };
  let end = -1; for (let i = 0; i < (spec.messages || 1); i++) { end = text.indexOf('<turn|>\n', end + 1); if (end < 0) return { why: 'fewer turns than the prefix' }; }
  const pids = encode(text.slice(0, end + 8)), P = pids.length;
  if (!(P > 0)) return { why: 'an empty prefix' };
  if (P >= ids.length) return { why: 'nothing after the prefix' };
  for (let i = 0; i < P; i++) if (ids[i] !== pids[i]) return { why: 'the prefix is tokenized another way here' };
  return { P, key: P + ':' + hashIds(ids, P) };
}
/** the system turn alone (keepPrefix: true): prefixOf with one turn -> { P, key } or null */
export const systemPrefix = (text, ids, encode) => { const r = prefixOf(text, ids, encode, { messages: 1 }); return r.key ? r : null; };
/** a 53-bit hash (cyrb53) of the first n token ids, base 36 */
export function hashIds(ids, n = ids.length) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < n; i++) { const c = ids[i] >>> 0; h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

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
