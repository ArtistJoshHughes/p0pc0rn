// 3.8 (from the phone bench v036-v040; Josh, 10-24: "I want both models"): a model split across this page and a module SharedWorker in
// its OWN process (engine/llm/lworker.js). The app's service worker (sw.js) serves the worker as lworker_coep.js with the header
// Cross-Origin-Embedder-Policy: require-corp, and iOS 27 then gives it a process, and a memory budget, of its own (the phone bench: 6 of
// 6 runs). The worker runs layers [0, S) with their KV caches; this page runs the embedding and the per-layer inputs, layers [S, NL), the
// head and the drafter (the drafter reads the target's embedding and the KV of the last sliding and full layers that keep their own,
// all here). Per token (or per verify pass of M rows): this page's front -> its rows read back -> the worker -> its rows back -> this
// page's back half. The GPU takes turns between the processes and a busy second process starves the other (the bench: x13), so the two
// halves run strictly one after the other. Every token is the target's own choice: its argmax (with or without the drafter) or the
// caller's sampler (no drafter). Gemma 4 E2B split at 13 gives the words of one process; NVIDIA Bolt E4B splits at 24 (3.9; 23 in 3.8).
'use strict';
import { DecodeRunner } from './drunner.js';
import { rowstats } from '../ops/misc.js';
import * as K from './lops.js';
import * as S from './lops_spec.js';
import { specKept, encodeVerifyFront, encodeVerifyLayers, encodeVerifyHead, polOf, polChoose, polLearn, polTime } from './spec.js';
import { dropAB } from './gemma4.js';   // 3.9 (E4B room)

const now = () => performance.now();
const r2 = (v) => +(+v).toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const TAG = 'p0split';   // the messages' marker (lworker.js)
const gone = (m) => Object.assign(new Error(m), { code: 'SPLIT_GONE' });

/** the service worker that serves the worker part (sw.js at the app's root), registered and active -> { ok, why } */
export async function ensureServiceWorker(swUrl, scope) {
  if (!('serviceWorker' in navigator)) return { ok: false, why: 'no service workers here' };
  if (typeof SharedWorker !== 'function') return { ok: false, why: 'no shared workers here' };
  try {
    const reg = await navigator.serviceWorker.register(String(swUrl), { scope: String(scope) });
    const s = reg.installing || reg.waiting;   // a new one (first time, or an updated sw.js) takes over at once (skipWaiting): wait for it
    if (s) await Promise.race([new Promise((r) => { if (s.state === 'activated') r(); s.addEventListener('statechange', () => { if (s.state === 'activated' || s.state === 'redundant') r(); }); }), sleep(10000)]);
    return reg.active ? { ok: true, why: '' } : { ok: false, why: 'the service worker did not start' };
  } catch (e) { return { ok: false, why: 'the service worker could not register: ' + String((e && e.message) || e).slice(0, 160) }; }
}

export const SPLIT_PROTO = 3;   // the page and the worker part speak the same version of these messages (lworker.js PROTO)
let HIDDEN_AT = 0;   // the last time this page was hidden: its timers stop, and a worker's answer can come late after it
try { document.addEventListener('visibilitychange', () => { if (document.hidden) HIDDEN_AT = now(); }); } catch (e) { /* no document */ }
/** 3.8 port: was this page in the background at any time since t (performance.now())? (iOS may end a background process; for the log) */
export const hiddenSince = (t) => HIDDEN_AT > t || (typeof document !== 'undefined' && !!document.hidden);
/** 3.8 port: what a failed second process means (it ended, or its GPU work stalled). fails = failures in a row before this one (a good
 *  answer resets it); oneProcessOk = this model can go on without it (Juli). -> { code, oneProcess, down }: the first failure = one
 *  fresh worker part (SPLIT_RETRY: on the phone a fresh one loaded at once after a stall); a second in a row = no second process this
 *  session (Juli: one process; the Bigger brain: down, its work goes to Juli) */
export function splitFailure({ fails = 0, oneProcessOk }) {
  const done = fails >= 1;
  return { code: done ? 'SPLIT_GONE' : 'SPLIT_RETRY', oneProcess: done && !!oneProcessOk, down: done && !oneProcessOk };
}
const abortErr = () => Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' });
const segs = (c, pos, M) => { if (!c.ring) return [[pos, M]]; const r0 = pos % c.ring, n1 = Math.min(M, c.ring - r0); return n1 < M ? [[r0, n1], [0, M - n1]] : [[r0, M]]; };   // positions -> rows of a KV cache (a sliding ring may wrap)

/** the worker part: a module shared worker -> { hello, call(op, args, transfer, ms, signal), close(), gone, closed }. A new name per load =
 *  a new worker. One op at a time: each call waits until the one before it has come back from the worker (even one whose caller stopped
 *  waiting: Stop rejects the call at once, the op itself finishes there first), so the worker never runs two ops at once. A call's
 *  time limit pauses while the page is hidden (iOS stops a hidden page's timers and GPU work). */
export function connectWorker(url, name, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let w = null, settled = false, helloT = null;
    const pend = new Map(); let seq = 0, tail = Promise.resolve();
    const api = {
      hello: null, gone: false, closed: false,
      call(op, args = {}, transfer = [], ms = 120000, signal = null) {
        if (api.gone || api.closed) return Promise.reject(gone('the worker part is gone'));
        if (signal && signal.aborted) return Promise.reject(abortErr());
        const run = tail.then(() => new Promise((res, rej) => {
          if (api.gone || api.closed) { rej(gone('the worker part is gone')); return; }
          const id = ++seq, p = { res, rej, timer: null };
          const arm = (since, wait = ms, quick = false) => {
            p.timer = setTimeout(() => {
              if (!pend.has(id)) return;
              if (typeof document !== 'undefined' && document.hidden) { arm(now()); return; }   // hidden time does not count
              // 3.8 port: back from the background: a live worker part beats again within a second; a silent one gets 4 s, not the limit
              if (HIDDEN_AT > since) { const alive = api.lastHb > HIDDEN_AT; arm(now(), alive ? ms : 4000, !alive); return; }
              if (quick && api.lastHb > since) { arm(now()); return; }   // it beat after all: the full limit
              pend.delete(id); api.gone = true;
              rej(gone(`the worker part stopped answering (${op}, ${Math.round(wait / 1000)} s): its process may have ended`));
            }, wait);
          };
          pend.set(id, p);
          try { w.port.postMessage(Object.assign({ [TAG]: 1, op, id }, args), transfer); } catch (e) { pend.delete(id); rej(e); return; }
          if (ms) arm(now());
        }));
        tail = run.catch(() => {});
        if (!signal) return run;
        return new Promise((res, rej) => {
          const ab = () => rej(abortErr());
          signal.addEventListener('abort', ab, { once: true });
          run.then((v) => { signal.removeEventListener('abort', ab); res(v); }, (e) => { signal.removeEventListener('abort', ab); rej(e); });
        });
      },
      /** frees the worker's GPU memory and ends it (lworker.js 'free' closes the worker after it): ALWAYS sent, also after a timeout (a
       *  worker that was only late frees its memory instead of lingering beside the next one) */
      close() {
        if (api.closed) return; api.closed = true;
        try { if (w) w.port.postMessage({ [TAG]: 1, op: 'free', id: 0 }); } catch (e) { /* */ }
        setTimeout(() => { try { if (w) w.port.close(); } catch (e) { /* */ } }, 500);
        for (const p of pend.values()) { clearTimeout(p.timer); p.rej(gone('the worker part was closed')); } pend.clear();
      },
    };
    const fail = (e) => { if (settled) return; settled = true; clearTimeout(helloT); api.close(); reject(e); };   // a late worker is told to end too
    try { w = new SharedWorker(String(url), { type: 'module', name }); } catch (e) { fail(e); return; }
    w.port.onmessage = (ev) => {
      const d = ev.data || {}; if (d[TAG] !== 1) return;
      if (d.hello) { api.hello = d; if (!settled) { settled = true; clearTimeout(helloT); resolve(api); } return; }
      if (d.hb) { api.lastHb = now(); return; }   // 3.8 port: the worker part's heartbeat
      const p = pend.get(d.id); if (!p) return; pend.delete(d.id); clearTimeout(p.timer);
      if (d.ok) p.res(d.r); else p.rej(Object.assign(new Error('worker: ' + (d.error || 'failed')), { code: d.code || 'SPLIT_WORKER' }));
    };
    w.onerror = (e) => { api.gone = true; fail(new Error('the worker part failed to start: ' + ((e && e.message) || 'error'))); };
    w.port.start();
    helloT = setTimeout(() => fail(new Error(`the worker part did not answer in ${timeoutMs / 1000} s`)), timeoutMs);
  });
}

export class SplitModel {
  /** page = a Gemma4 with l0 = S, l1 = NL (the embedding and the head here, resident weights); wk = connectWorker() after its 'init'
   *  (layers [0, S)); info = the init's answer (its memory, its process) */
  constructor(page, wk, info = {}) { this.m = page; this.g = page.g; this.wk = wk; this.info = info; this.T = { hops: 0, readMs: 0, postMs: 0, wkMs: 0, bytes: 0 }; this.mirror = page.mirrorKV ? page.mirrorKV() : []; }
  /** 3.8: the worker part's K and V rows of the mirror layers (positions pos .. pos + M - 1, lworker.js kvRows' order) into this page's
   *  mirror caches, before this page's layers of the same step run (the queue keeps the order) */
  _mirrorIn(pos, M, kv) {
    if (!this.mirror.length) return;
    if (!kv) throw Object.assign(new Error('the worker part sent no mirror rows'), { code: 'SPLIT_WORKER' });
    const m = this.m, q = this.g.device.queue; let o = kv.byteOffset;
    for (const l of this.mirror) {
      const c = m.kv[l], rb = c.hd * 2;
      for (const buf of [c.kc, c.vc]) for (let h = 0; h < m.NKV; h++) {
        let k = 0;
        for (const [r, n] of segs(c, pos, M)) { q.writeBuffer(buf, (h * c.len + r) * rb, kv.buffer, o + k * rb, n * rb); k += n; }
        o += M * rb;
      }
    }
  }
  get drafter() { return this.m.drafter; }
  /** 3.8 port (bench v045): the decode loops' recorders, kept from answer to answer (a new pair per answer = new uniform buffers and new
   *  bind groups every answer; iOS 27.0.1 gives a dropped bind group's memory back only at garbage collection). A GPU-timer run, or a
   *  pair whose last answer ended with a read still pending (Stop), is replaced. -> { F, B, own } (own = destroy it after this answer) */
  async _runners(kind, make, timer) {
    if (timer) { const [F, B] = make(); return { F, B, own: true }; }
    const k = this._drs;
    if (k && k.kind === kind && !k.F.maps && !k.B.maps && !k.F.cur && !k.B.cur) return k;
    this._drs = null; if (k) { try { await k.F.destroy(); await k.B.destroy(); } catch (e) { /* */ } }
    const [F, B] = make(); return (this._drs = { kind, F, B, own: false });
  }
  /** the kept recorders go with the model (llm.js unload) */
  release() { const k = this._drs; this._drs = null; if (k) { k.F.destroy().catch(() => {}); k.B.destroy().catch(() => {}); } }
  /** the worker's memory now (diagnostics; null when it does not answer) */
  async stats() { try { return await this.wk.call('stats', {}, [], 10000); } catch (e) { return null; } }
  close() { try { this.wk.close(); } catch (e) { /* */ } }

  /** the prompt read-in: each chunk's front here, its first S layers in the worker, the rest here (the page model's own loop, with a hook) */
  async prefill(ids, o = {}) {
    const m = this.m, g = this.g, D = m.D, NT = m.NL * 256, M = ids.length, C = Math.min(M, o.chunk || (m.opts && m.opts.chunk) || 256), T = this.T, wk = this.wk;
    const onLayer = async (l, p0) => {
      if (l !== -1) return;   // -1 = after this chunk's embedding + per-layer inputs, before the page's own layers
      const s = m._dbg, MC = Math.min(C, M - p0), t0 = now();
      const x = new Float32Array(await g.read(s.x, 0, MC * D * 4)), ple = new Float32Array(await g.read(s.ple, 0, MC * NT * 4)), t1 = now();
      // the first chunk builds the worker's pipelines (up to 2 min); a chunk after it takes about a second on an iPhone
      const r = await wk.call('prefill', { p0, M: MC, Mtot: M, chunk: C, x, ple, first: p0 === 0, last: p0 + C >= M }, [x.buffer, ple.buffer], p0 === 0 ? 45000 : 30000, o.signal);   // 3.8 port: a chunk takes well under 2 s; a stalled one cost 120 s
      const t2 = now();
      g.device.queue.writeBuffer(s.x, 0, r.x.buffer, r.x.byteOffset, MC * D * 4); this._mirrorIn(p0, MC, r.kv);
      dropAB(r.x.buffer);   // 3.9 (E4B room): the chunk's rows and mirror rows are on the GPU now
      T.hops++; T.readMs += t1 - t0; T.postMs += Math.max(0, t2 - t1 - r.ms); T.wkMs += r.ms; T.bytes += MC * (2 * D + NT) * 4;
      if (o.check) o.check();
    };
    return m.prefill(ids, Object.assign({}, o, { onLayer, chunk: C }));
  }

  /** decode: the same contract as Gemma4.decodeLoop -> { ids, stopped }. Greedy with the drafter = specLoop; anything else (greedy without
   *  it, or the caller's sampler: o.pick reads r.logitsBuf) = one token at a time across the two parts */
  async decodeLoop(s, o) {
    const sp = this.m._specConf(o);
    if (sp && !sp.samp) return this.specLoop(s, o, Object.assign({}, sp, { pld: (this.m.opts && this.m.opts.pld) || null }));   // 3.8: + prompt lookup (the registry)
    const m = this.m, g = this.g, D = m.D, NT = m.NL * 256, wk = this.wk, eos = o.eos || (() => false), st = o.stats || null, core = g.runner;
    if (!this._hop) this._hop = g.buffer((D + NT) * 4, 'split.hop');   // kept with the model (no free + make per answer)
    const hop = this._hop;
    const RN = await this._runners('dec', () => [new DecodeRunner(g, { cap: 64, stage: (D + NT) * 4 }), new DecodeRunner(g, { cap: 1200, stage: 16, timer: !!(st && st.gpuTimer) })], !!(st && st.gpuTimer));
    const drF = RN.F, drB = RN.B;   // 3.8 port: kept
    const eh = m.resident.get('lm.embed'), gh = m.resident.get('lm.global'), et = eh.t('embed_tokens.weight');
    const T = { ple: 0, front: 0, wk: 0, post: 0, back: 0, encB: 0, wkEnc: 0, pick: 0, n: 0 };
    const recFront = (par) => {
      g.runner = drF;
      try {
        drF.begin(par);
        K.embed(g, { w: { buf: et.buf, off: et.off, bytes: et.bytes, enc: et.enc }, ids: { buf: s.idb }, x: { buf: s.x }, st: { buf: s.st }, K: D, scale: Math.fround(m.m.embed_scale), n: 1 });
        m._pleProj(s, gh, s.pler);
        drF.copy(s.x, 0, hop, 0, D * 4); drF.copy(s.ple, 0, hop, D * 4, NT * 4);
        return drF.end(hop, (D + NT) * 4);
      } finally { g.runner = core; if (drF.cur) drF.cur = null; }
    };
    const recBack = (pos, par) => {
      const a = now(); g.runner = drB;
      try {
        drB.begin(par);
        for (let l = m.l0; l < m.l1; l++) {
          const ah = m.resident.get(`lm.layer.${String(l).padStart(2, '0')}.a`), mh = m.resident.get(`lm.layer.${String(l).padStart(2, '0')}.m`);
          m._attnPart(l, pos, s, ah); m._mlpPart(l, s, mh); m._plePart(l, s, ah);
        }
        rowstats(g, { x: { buf: s.x, ld: D }, rows: 1, cols: D, mode: 'rms', eps: m.eps, st: { buf: s.st } });
        return drB.end(m._headWith({ buf: s.x, rowB: 0 }, { buf: s.st, off: 1 }, gh, eh, m._logits()));
      } finally { g.runner = core; if (drB.cur) drB.cur = null; T.encB += now() - a; }
    };
    const ids = []; let stopped = 'length', id = o.first; const t0 = now();
    core.flush();
    try {
      for (let i = 0; i < o.steps; i++) {
        if (o.check) o.check();
        if (eos(id)) { stopped = 'eos'; break; }
        const pos = o.pos0 + i;
        let a = now(); const row = await o.pleRow(id); T.ple += now() - a;
        g.device.queue.writeBuffer(s.idb, 0, Uint32Array.of(id === m.m.image_token ? m.m.pad : id));
        g.device.queue.writeBuffer(s.pler, 0, row.buffer, row.byteOffset, row.byteLength);
        a = now(); const fo = await drF.submit(recFront(i & 1)); const b = now(); T.front += b - a;
        const wq = wk.call('decode', { pos, x: new Float32Array(fo.buffer, 0, D), ple: new Float32Array(fo.buffer, D * 4, NT) }, [fo.buffer], 30000, o.signal);
        await null;   // 3.8 (v041): the call posts in a microtask behind the call before it: let it go out first, then record
        let tk; try { tk = recBack(pos, i & 1); } catch (x) { wq.catch(() => {}); throw x; }   // 3.8: recorded while the worker part runs its layers
        const r = await wq;
        const c = now(); T.wk += r.ms; T.wkEnc += r.encMs; T.post += Math.max(0, c - b - r.ms);
        g.device.queue.writeBuffer(s.x, 0, r.x.buffer, r.x.byteOffset, D * 4); this._mirrorIn(pos, 1, r.kv);   // before the recording is submitted
        const bo = await drB.submit(tk); T.back += now() - c;
        const res = { argmax: bo[0], maxLogit: new Float32Array(new Uint32Array([bo[1]]).buffer)[0], logitsBuf: m._logits() };
        let nxt = bo[0];
        if (o.pick) { a = now(); nxt = await o.pick(res, i); T.pick += now() - a; }   // the caller's sampler reads the logits (this page's head)
        ids.push(nxt); T.n++;
        if (o.onToken) o.onToken(nxt, Object.assign(res, { logitsBuf: null }), i);
        id = nxt;
      }
      if (stopped === 'length' && ids.length && eos(ids[ids.length - 1])) stopped = 'eos';
    } finally {
      if (RN.own) { await drF.destroy(); await drB.destroy(); }   // 3.8 port: else kept for the next answer
      if (st) {
        const n = Math.max(1, T.n);
        Object.assign(st, { loop: o.pick ? 'split-sampled' : 'split', tokens: T.n, wallMs: Math.round(now() - t0), msPerToken: r2((now() - t0) / n), pleMs: r2(T.ple / n), frontMs: r2(T.front / n),
          workerMs: r2(T.wk / n), workerEncMs: r2(T.wkEnc / n), postMs: r2(T.post / n), backMs: r2(T.back / n), backEncMs: r2(T.encB / n), pickMs: o.pick ? r2(T.pick / n) : undefined,
          backGpuMs: drB.timer && drB.timer.tokens ? r2(drB.timer.busyMs / drB.timer.tokens) : null, bindGroupsNew: drB.bgNew, bindGroupsCached: drB.bgHit });
      }
    }
    return { ids, stopped };
  }

  /** speculative greedy decode with the drafter (on this page): per pass, the verify of M = k + 1 rows crosses to the worker and back, then
   *  the accept and the next drafts here. conf = Gemma4._specConf's { k, kmax, policy: 'cost' (spec.js's expected tokens per ms, its
   *  pass times measured here, hops included) | 'simple' (+1 / -1) | 'fixed', ktest } -> { ids, stopped } */
  async specLoop(s, o, conf = {}) {
    const m = this.m, g = this.g, D = m.D, NT = m.NL * 256, wk = this.wk, dft = m.drafter, eos = o.eos || (() => false), st = o.stats || null, core = g.runner;
    if (!dft) throw new Error('specLoop: no drafter loaded');
    const kmax = Math.max(1, Math.min(7, conf.kmax || 4)), Mmax = kmax + 1, img = m.m.image_token, pad = m.m.pad, psc = Math.fround(m.m.ple_scale), cap = m.ctxCap;
    const V = specKept(m, Mmax);   // kept on the model from answer to answer (spec.js)
    if (!this._hopV || this._hopVM < Mmax) { if (this._hopV) { core.flush(); g.free(this._hopV); } this._hopV = g.buffer(Mmax * (D + NT) * 4, 'split.hopV'); this._hopVM = Mmax; }
    const hopV = this._hopV;
    const RN = await this._runners('spec' + Mmax, () => [new DecodeRunner(g, { cap: 64, stage: Mmax * (D + NT) * 4 }), new DecodeRunner(g, { cap: 1600, stage: S.RES_WORDS * 4, timer: !!(st && st.gpuTimer) })], !!(st && st.gpuTimer));
    const drF = RN.F, drB = RN.B;   // 3.8 port: kept
    const nw = m.nw(m.resident.get('lm.global'), 'norm.weight');
    const ctxD = { target: m, ids: { buf: V.idb }, res: { buf: V.res }, sp: { buf: V.sp }, nchunkFull: 0, img, pad, samp: null };
    const T = { ple: 0, front: 0, wk: 0, wkEnc: 0, post: 0, back: 0, encB: 0, passes: 0, rows: 0, m: new Array(Mmax).fill(0), k: new Array(Mmax).fill(0), kh: new Array(Mmax).fill(0),
      pldPasses: 0, pldTok: 0, pldCooled: 0 };
    let kPol = Math.max(1, Math.min(kmax, conf.k || 2)), kti = 0;
    const pol = conf.policy || (conf.adaptive ? 'simple' : 'fixed'), P = pol === 'cost' ? polOf(m) : null, KT = Array.isArray(conf.ktest) && conf.ktest.length ? conf.ktest : null;
    // 3.8: prompt lookup (conf.pld = { ngram, minN, min, maxK }): the latest earlier occurrence (the prompt + the answer so far) of the last
    // ngram .. minN tokens whose continuation has >= min tokens -> up to maxK drafts (the phone bench: matches of 2 tokens fire on prose
    // and waste big passes: minN 3)
    // test switch (an A/B on a phone without a rebuild): localStorage 'p0pc0rn:test:pld' = '0' turns the lookup off
    const pldOff = (() => { try { return localStorage.getItem('p0pc0rn:test:pld') === '0'; } catch (e) { return false; } })();
    const pld = (!pldOff && conf.pld) || null, PMAX = pld ? Math.max(0, Math.min(Mmax - 1, pld.maxK || 4)) : 0, NG = pld ? pld.ngram || 4 : 0, NMIN = pld ? pld.minN || 3 : 0, PMIN = pld ? pld.min || 3 : 0;
    const hist = pld ? Array.from(o.history || []) : null; let pldCool = 0;
    const pldFind = () => {
      const L = hist.length;
      for (let n = NG; n >= NMIN; n--) {
        if (L < n + 1) continue;
        for (let i = L - n - 1; i >= 0; i--) {
          let ok = true; for (let j = 0; j < n; j++) if (hist[i + j] !== hist[L - n + j]) { ok = false; break; }
          if (!ok) continue;
          const c = hist.slice(i + n, Math.min(i + n + PMAX, L));
          if (c.length >= PMIN && !c.some((t) => eos(t))) return c;
        }
      }
      return null;
    };
    const kWant = (pos) => (KT ? Math.max(0, Math.min(kmax, KT[kti++ % KT.length] | 0)) : P ? polChoose(P, pos, kmax) : kPol);
    const kChoice = (posHi, Mn) => Math.max(0, Math.min(kWant(posHi), kmax, cap - 2 - (posHi + Mn)));   // never draft past the KV cache
    const recFront = (M, par) => {
      g.runner = drF;
      try {
        drF.begin(par); encodeVerifyFront(m, V, M);
        drF.copy(V.x, 0, hopV, 0, M * D * 4); drF.copy(V.ple, 0, hopV, M * D * 4, M * NT * 4);
        return drF.end(hopV, M * (D + NT) * 4);
      } finally { g.runner = core; if (drF.cur) drF.cur = null; }
    };
    const recBack = (M, kNext, pos, par) => {
      const a = now(); g.runner = drB;
      try {
        drB.begin(par);
        const nch = Math.ceil((pos + M) / 64);
        encodeVerifyLayers(m, V, M, nch, m.l0, m.l1); encodeVerifyHead(m, V, M);
        S.accept(g, { arg: { buf: V.arg }, ids: { buf: V.idb }, sp: { buf: V.sp }, res: { buf: V.res }, M, img, pad });
        if (kNext > 0) {
          S.dprep(g, { x: { buf: V.x }, st: { buf: V.st }, norm: nw, sp: { buf: V.sp }, res: { buf: V.res }, z: { buf: dft.s.z }, tok: { buf: dft.s.tok }, D });
          drB.split(); ctxD.nchunkFull = nch;
          for (let j = 1; j <= kNext; j++) dft.encodeStep(ctxD, j);
        }
        return drB.end(V.res, S.RES_WORDS * 4);
      } finally { g.runner = core; if (drB.cur) drB.cur = null; T.encB += now() - a; }
    };
    const readRows = async (rid) => {
      const a = now(); const r = await m.pleRows(rid); for (let j = 0; j < r.length; j++) r[j] = Math.fround(r[j] * psc); T.ple += now() - a;
      g.device.queue.writeBuffer(V.pler, 0, r.buffer, r.byteOffset, rid.length * NT * 4);
    };
    const ids = []; let stopped = 'length', tPrev = null; const t0 = now();
    core.flush();
    try {
      if (o.steps <= 0) return { ids, stopped };
      if (eos(o.first)) return { ids, stopped: 'eos' };
      g.device.queue.writeBuffer(V.sp, 0, Uint32Array.of(o.pos0, 0, 0, 0));
      g.device.queue.writeBuffer(V.idb, 0, Uint32Array.of(o.first === img ? pad : o.first));
      await readRows([o.first]);
      if (hist) hist.push(o.first);
      let cur = { M: 1, pos: o.pos0, pld: false }; cur.k = kChoice(cur.pos + 1, 1);
      let preF = null;   // 3.8 (v041): the next pass's front, recorded while the GPU runs this pass's back half
      for (let par = 0; ; par ^= 1) {
        if (o.check) o.check();
        const a = now(); const fo = await drF.submit(preF && preF.M === cur.M ? preF.tk : recFront(cur.M, par)); preF = null; const b = now(); T.front += b - a;
        const wq = wk.call('verify', { pos: cur.pos, M: cur.M, x: new Float32Array(fo.buffer, 0, cur.M * D), ple: new Float32Array(fo.buffer, cur.M * D * 4, cur.M * NT) }, [fo.buffer], 30000, o.signal);
        await null;   // 3.8 (v041): the call posts in a microtask behind the call before it: let it go out first, then record
        let tk; try { tk = recBack(cur.M, cur.k, cur.pos, par); } catch (x) { wq.catch(() => {}); throw x; }   // 3.8: recorded while the worker part runs its layers
        const r = await wq;
        const c = now(); T.wk += r.ms; T.wkEnc += r.encMs; T.post += Math.max(0, c - b - r.ms);
        g.device.queue.writeBuffer(V.x, 0, r.x.buffer, r.x.byteOffset, cur.M * D * 4); this._mirrorIn(cur.pos, cur.M, r.kv);   // before the recording is submitted
        const pB = drB.submit(tk);
        preF = { M: cur.k + 1, tk: recFront(cur.k + 1, par ^ 1) };   // 3.8 (v041): the next pass's front (its ids and rows are written before its submit)
        const R32 = await pB; const e = now(); T.back += e - c;
        T.passes++; T.rows += cur.M; T.kh[cur.M - 1]++;
        if (P && tPrev != null) polTime(P, cur.M, cur.k, cur.pos, e - tPrev);   // readback to readback, as spec.js: its rows, front, worker and back (hops included)
        tPrev = e;
        const mm = R32[0], posNext = R32[2], nids = [];
        for (let j = 0; j <= cur.k; j++) nids.push(R32[S.RES_IDS + j]);   // the next pass's ids: the bonus + its drafts
        if (cur.M > 1) {
          T.k[cur.M - 1]++; T.m[mm]++;
          if (cur.pld) { T.pldTok += mm; if (mm < Math.ceil((cur.M - 1) / 2)) pldCool = 2; }   // 3.8: a poor lookup pass: 2 passes without lookup
          if (P) polLearn(P, cur.M, mm);
          if (pol === 'simple') { if (mm === cur.M - 1) kPol = Math.min(kmax, kPol + 1); else if (mm === 0) kPol = Math.max(1, kPol - 1); }
        }
        if (st && st.trace) st.trace.push({ pos: cur.pos, M: cur.M, m: mm, next: nids.slice() });
        let stop = false;
        for (let i = 0; i <= mm; i++) {
          const id = R32[S.RES_ARG + 2 * i], at = ids.length; ids.push(id); if (hist) hist.push(id);
          if (o.onToken) o.onToken(id, { argmax: id, maxLogit: new Float32Array(new Uint32Array([R32[S.RES_ARG + 2 * i + 1]]).buffer)[0], logitsBuf: null }, at);
          if (at + 1 >= o.steps) { stopped = 'length'; stop = true; break; }
          if (eos(id)) { stopped = 'eos'; stop = true; break; }
        }
        if (stop) break;
        if (posNext !== cur.pos + mm + 1) throw new Error('speculative decode: position ' + posNext + ' after ' + cur.pos + ' + ' + mm);
        let lk = null;
        if (pld) { if (pldCool > 0) { pldCool--; T.pldCooled++; } else lk = pldFind(); }
        if (lk) lk = lk.slice(0, Math.max(0, Math.min(PMAX, cap - 3 - posNext)));   // never past the KV cache
        let nxt;
        if (lk && lk.length > cur.k) {   // 3.8: prompt lookup: its drafts in place of the drafter's (the verify checks every one)
          const nid = [nids[0], ...lk];   // the bonus + the lookup's tokens
          g.device.queue.writeBuffer(V.idb, 0, Uint32Array.from(nid.map((t) => (t === img ? pad : t))));
          g.device.queue.writeBuffer(V.res, S.RES_IDS * 4, Uint32Array.from(nid));   // what accept compares the target's argmaxes with
          nxt = { M: nid.length, pos: posNext, pld: true }; T.pldPasses++;
          await readRows(nid);
        } else {
          nxt = { M: cur.k + 1, pos: posNext, pld: false };
          await readRows(nids);
        }
        nxt.k = kChoice(nxt.pos + nxt.M, nxt.M);
        // inside a copied run (this lookup pass kept every draft and the next one is a lookup pass too) the drafter's drafts would be
        // thrown away: the next back half drafts nothing (if the lookup stops, the pass after is a plain step)
        if (pld && pld.skipDraft !== false && nxt.pld && cur.pld && mm === cur.M - 1) nxt.k = 0;
        cur = nxt;
      }
    } finally {
      if (RN.own) { await drF.destroy(); await drB.destroy(); }   // 3.8 port: else kept for the next answer
      g.runner.flush();   // V and the hop buffer stay with the model
      if (st) {
        const n = Math.max(1, ids.length), np = Math.max(1, T.passes);
        Object.assign(st, { loop: pld ? 'split-spec+pld' : 'split-spec', pldPasses: T.pldPasses, pldAccepted: T.pldTok, pldCooled: T.pldCooled, tokens: ids.length, passes: T.passes, tokPerPass: r2(ids.length / np), rowsPerPass: r2(T.rows / np), wallMs: Math.round(now() - t0),
          msPerToken: r2((now() - t0) / n), msPerPass: r2((now() - t0) / np), pleMs: r2(T.ple / np), frontMs: r2(T.front / np), workerMs: r2(T.wk / np), workerEncMs: r2(T.wkEnc / np),
          postMs: r2(T.post / np), backMs: r2(T.back / np), backEncMs: r2(T.encB / np), accepted: T.m.slice(), drafted: T.k.slice(), kHist: T.kh.slice(), kFinal: kPol,
          policy: KT ? 'test' : pol, kmax, costScale: P ? r2(P.s) : null, acceptEst: P ? P.a.slice(1, kmax + 1).map(r2) : null,
          backGpuMs: drB.timer && drB.timer.tokens ? r2(drB.timer.busyMs / drB.timer.tokens) : null, drafterMB: Math.round(dft.bytes / 1e6), trace: st.trace || undefined });
      }
    }
    return { ids, stopped };
  }
}
