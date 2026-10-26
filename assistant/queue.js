// queue.js - p0pc0rn's ONE job queue for chat and every render (Josh's design, Oct 12 2026): one model on the GPU at a time - load
// for the job, unload after; nothing stays resident while the queue is idle. Jobs live in IndexedDB 'p0pc0rn-queue', so a page that
// iOS kills (memory, heat) or a reload picks up where it stopped: a job found 'running' at start-up goes back to the queue with the
// SAME params (its seed was fixed when it was added), and the engine resumes from its own checkpoint (Klein: per denoise step;
// SANA-Video: per step + decode-only; the agent and the music-video coordinator: per stage, saved through ctx.saveCheckpoint/setState).
//
//   const q = await createQueue({ runners, host: new EngineHost({ create: (id) => PF.createEngine({ model: id }) }), consent });
//   const job = await q.add('picture', { prompt, width: 1280, height: 720 });
//   q.on('progress', (job, p) => ...); q.on('change', (job) => ...); q.cancel(id); q.move(id, index);
//
// Kinds: chat, picture, edit, clip, foley, song, musicvideo (+ 'assemble', a music video's CPU-only last child). A runner per kind
// (runners.js) says which model it needs and does the work; a coordinator (musicvideo, an agent turn) enqueues CHILDREN and returns
// {wait: 'all'}; it is woken (run again, its saved state intact) when its children are finished. A family (a top-level job and all
// its descendants) moves as one block when the person reorders.
// Every render goes through the consent gate: without the p0pc0rn agreement a render job is 'blocked' (never failed, never run) until
// q.recheck() after the person agrees; the engine refuses NO_CONSENT on its own too, which lands in the same state.
// RUN ORDER (Josh, Oct 12 2026: chat jumps the queue): (1) a render that was interrupted (page kill, GPU reset) resumes first - it
// already started and its engine checkpoint is waiting; (2) every queued 'chat' job (a person's message, or an assistant turn
// woken to look at its result and answer), FIFO among chats; (3) everything else in family order. A running job is never preempted
// or paused: priority only decides what starts next, so a chat can slot between a music video's not-yet-started children (whose
// relative order never changes) but never splits a running one. runOrder() / positionOf() give the Queue view the same order.
import { openDB, uid } from './idb.js';

export const RENDER_KINDS = new Set(['picture', 'edit', 'clip', 'animate', 'between', 'foley', 'song', 'musicvideo', 'assemble', 'say', 'talk', 'lipsync']);   // + p0pc0rn Cast
export const SEEDED_KINDS = new Set(['picture', 'edit', 'clip', 'animate', 'between', 'foley', 'song', 'say']);
export const PRIORITY_KINDS = new Set(['chat']);
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const FALLBACK_CODES = new Set(['OUT_OF_MEMORY', 'GPU_LOST', 'SPLIT_UNAVAILABLE', 'NOT_DOWNLOADED', 'TOO_LONG', 'NO_VISION', 'SPLIT_GONE']);   // 3.8 (v040): runner.fallback; 3.8 port: + the Bigger brain's second process ended -> Juli
export const isTerminal = (j) => TERMINAL.has(j.status);
const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 'ABORTED');
const newSeed = () => (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 32)) % 2147483648;

// ------------------------------------------------------------------------------------------------ one engine on the GPU
/** The default unload for p0pc0rn's engines (0.3.x have no unload()): destroy the idle GPU device; the engine makes a new one on its
 *  next job, the same path as its GPU-reset recovery (app.js releaseOther). Engines that have unload() use it. */
export async function defaultUnload(engine) {
  if (!engine) return;
  if (typeof engine.unload === 'function') { await engine.unload(); return; }
  const g = engine.gpu;
  if (!g || g.lost || !g.device || engine.job) return;
  try { g.device.destroy(); await Promise.race([g.device.lost, new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* recreated on its next job */ }
}

export class EngineHost {
  /** create(modelId) -> engine (may return a cached object: p0pc0rn keeps one engine object per model for downloads and status);
   *  unload(engine, modelId) frees its GPU memory. */
  constructor({ create, unload = defaultUnload, onEvent = null } = {}) {
    this.create = create; this.unloadFn = unload; this.onEvent = onEvent;
    this.current = null; this.stats = { loads: 0, unloads: 0, maxResident: 0 };
  }
  get currentId() { return this.current ? this.current.id : null; }
  async acquire(modelId) {
    if (this.current && this.current.id === modelId) return this.current.engine;
    await this.release();                                     // the previous model leaves the GPU BEFORE the next one loads
    const engine = await this.create(modelId);
    this.current = { id: modelId, engine }; this.stats.loads++;
    this.stats.maxResident = Math.max(this.stats.maxResident, 1);
    if (this.onEvent) this.onEvent({ type: 'load', model: modelId });
    return engine;
  }
  async release() {
    if (!this.current) return;
    const { id, engine } = this.current;
    this.current = null;
    try { await this.unloadFn(engine, id); } finally { this.stats.unloads++; if (this.onEvent) this.onEvent({ type: 'unload', model: id }); }
  }
}

// ------------------------------------------------------------------------------------------------ the queue
export async function createQueue(opts) { const q = new JobQueue(opts); await q.init(); return q; }

export class JobQueue {
  constructor({ name = 'p0pc0rn-queue', runners = {}, host, consent = () => true, maxKills = 2, autoStart = true, lock = true, planned = null, holdMs = null } = {}) {
    Object.assign(this, { name, runners, host, consent, maxKills, autoStart, useLock: lock, planned, holdMs });   // v024.2: planned(job) -> the app reloaded on purpose
    this.holding = false; this._holdEnd = null;   // 3.8: holdMs(modelId) -> ms the model stays loaded after a job, for a follow-up job (see runJob)
    this.jobs = new Map(); this.listeners = new Map(); this.active = null; this.paused = false; this.pumping = false;
    this.lastSave = new Map(); this.readOnly = false;
  }
  // ---- events
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); return () => this.off(n, fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  emit(n, ...a) { for (const fn of this.listeners.get(n) || []) { try { fn(...a); } catch (e) { console.error(e); } } }

  async init() {
    this.db = await openDB(this.name, 1, { jobs: { keyPath: 'id' }, blobs: { keyPath: 'key' } });
    for (const j of await this.db.all('jobs')) this.jobs.set(j.id, j);
    // a job found 'running' was cut off (page killed, reload): back to the queue with the same params, or failed after maxKills
    const recovered = [];
    for (const j of this.jobs.values()) {
      if (j.status !== 'running') continue;
      // v024.2: a planned fresh page (the app reloaded between heavy stages on purpose) is not a kill: back to the queue as it was
      if (this.planned && this.planned(j)) { j.status = 'queued'; j.resumed = true; j.fresh = (j.fresh || 0) + 1; recovered.push(j); continue; }
      j.kills = (j.kills || 0) + 1; j.resumed = true; j.interrupted = true;
      // v024: a chat turn gets ONE more try (the page dying twice in the same turn is memory, not luck); renders keep maxKills
      const maxK = j.kind === 'chat' || j.kind === 'song' ? 1 : this.maxKills;   // v024.1: a song too (its second death ended DONE with a broken file)
      if (j.kills > maxK) Object.assign(j, { status: 'failed', endedAt: Date.now(), error: { code: 'KILLED', message: `The page stopped ${j.kills} times during this job (memory or heat).` + (j.kind === 'chat' ? '' : ' Try a smaller size or shorter clip.') } });
      else j.status = 'queued';
      recovered.push(j);
    }
    if (recovered.length) await this.db.putMany('jobs', recovered);
    this.recovered = recovered.map((j) => j.id);
    // one queue per browser: a second p0pc0rn tab watches but never runs jobs (two pumps would fight over the GPU)
    if (this.useLock && typeof navigator !== 'undefined' && navigator.locks) {
      await new Promise((resolve) => {
        navigator.locks.request('p0pc0rn-queue-owner', { ifAvailable: true }, (lock) => {
          if (!lock) { this.readOnly = true; resolve(); return undefined; }
          resolve(); return new Promise((r) => { this.releaseLock = r; });   // held for the page's lifetime
        });
      });
    }
    if (this.recovered.length) this.emit('resumed', this.recovered.map((id) => this.jobs.get(id)));
    if (this.autoStart) this.pump();
  }
  close() { this.paused = true; if (this.releaseLock) this.releaseLock(); }

  // ---- reading
  get(id) { return this.jobs.get(id) || null; }
  rootOf(j) { return this.jobs.get(j.root) || j; }
  /** every job in run order: top-level families by `order`, members of a family by `seq` (the coordinator first: seq 0) */
  list({ includeTerminal = true } = {}) {
    const all = [...this.jobs.values()].filter((j) => includeTerminal || !isTerminal(j));
    return all.sort((a, b) => (this.rootOf(a).order - this.rootOf(b).order) || (a.seq - b.seq) || (a.createdAt - b.createdAt));
  }
  children(id) { return [...this.jobs.values()].filter((j) => j.parent === id).sort((a, b) => a.seq - b.seq); }
  descendants(id) { const out = []; const walk = (p) => { for (const c of this.children(p)) { out.push(c); walk(c.id); } }; walk(id); return out; }
  /** the queued jobs in the order they will START: interrupted renders, then chats (FIFO), then the rest (family order) */
  runOrder() {
    const fam = (a, b) => (this.rootOf(a).order - this.rootOf(b).order) || (a.seq - b.seq) || (a.createdAt - b.createdAt);
    const rank = (j) => (j.interrupted ? 0 : PRIORITY_KINDS.has(j.kind) ? 1 : 2);
    return [...this.jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => (rank(a) - rank(b)) || fam(a, b));
  }
  /** for the Queue view: 0 = running now, 1 = starts next, ...; null = not waiting to run (done, blocked, waiting on children) */
  positionOf(id) {
    if (this.active && this.active.job.id === id) return 0;
    const i = this.runOrder().findIndex((j) => j.id === id);
    return i < 0 ? null : i + 1;
  }
  /** the next job to run */
  next() {
    if (this.paused) return null;
    return this.runOrder()[0] || null;
  }
  modelOf(j) {
    const r = this.runners[j.kind], m = r && r.model ? (r.model(j) || null) : null;
    return m && j.fellBack && j.fellBack.from === m ? j.fellBack.to : m;   // 3.8 (v040): a model that could not do this job -> its fallback (runner.fallback)
  }

  // ---- writing
  async save(j) { this.lastSave.set(j.id, Date.now()); await this.db.put('jobs', j); this.emit('change', j); }
  /** add a job. opts: {parent, title, front (top of the queue), session} -> the job record */
  async add(kind, params = {}, opts = {}) {
    if (!this.runners[kind]) throw Object.assign(new Error('no runner for ' + kind), { code: 'NO_RUNNER' });
    const p = Object.assign({}, params);
    if (SEEDED_KINDS.has(kind) && (p.seed === undefined || p.seed === null)) p.seed = newSeed();   // fixed now: a resumed job hits the engine checkpoint
    const parent = opts.parent ? this.jobs.get(opts.parent) : null;
    const j = { id: uid('j'), kind, status: 'queued', params: p, title: opts.title || '', session: opts.session || (parent && parent.session) || null,
      parent: parent ? parent.id : null, tag: opts.tag || null, root: null, seq: 0, nextSeq: 1, order: 0, createdAt: Date.now(), startedAt: null, endedAt: null,
      attempts: 0, kills: 0, progress: null, result: null, error: null, state: null, checkpoint: null };
    if (parent) {
      const root = this.rootOf(parent);
      j.root = root.id; j.seq = root.nextSeq++; await this.db.put('jobs', root);
    } else {
      j.root = j.id;
      const tops = [...this.jobs.values()].filter((x) => x.root === x.id && !isTerminal(x));
      const orders = tops.map((x) => x.order);
      j.order = opts.front ? (orders.length ? Math.min(...orders) - 1 : 0) : (orders.length ? Math.max(...orders) + 1 : 0);
      if (opts.front && this.active) { const ar = this.rootOf(this.active.job); j.order = ar.order + 0.5; }   // never ahead of the running family
    }
    this.jobs.set(j.id, j);
    await this.save(j);
    this.emit('added', j);
    if (!this.pumping) queueMicrotask(() => this.pump());
    return j;
  }
  /** cancel a job and everything under it. A running job stops through its AbortSignal and engine.cancel(). */
  async cancel(id) {
    const j = this.jobs.get(id); if (!j || isTerminal(j)) return false;
    const fam = [j, ...this.descendants(id)];
    for (const x of fam) {
      if (isTerminal(x)) continue;
      if (this.active && this.active.job.id === x.id) { x.cancelRequested = true; this.active.ctl.abort(); try { if (this.active.engine && this.active.engine.cancel) this.active.engine.cancel(); } catch (e) { /* */ } continue; }
      Object.assign(x, { status: 'cancelled', endedAt: Date.now() });
      await this.save(x); this.emit('cancelled', x);
    }
    if (j.parent) await this.wakeParent(j);
    return true;
  }
  /** move a top-level family to position `index` among the waiting families (0 = next). The running family stays first. */
  async move(id, index) {
    const j = this.jobs.get(id); if (!j) return false;
    const root = this.rootOf(j);
    const tops = [...this.jobs.values()].filter((x) => x.root === x.id && !isTerminal(x)).sort((a, b) => a.order - b.order);
    const running = this.active ? this.rootOf(this.active.job) : null;
    if (running && running.id === root.id) return false;
    const rest = tops.filter((x) => x.id !== root.id && (!running || x.id !== running.id));
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, root);
    const seq = running ? [running, ...rest] : rest;
    const changed = [];
    seq.forEach((x, k) => { if (x.order !== k) { x.order = k; changed.push(x); } });
    if (changed.length) { await this.db.putMany('jobs', changed); changed.forEach((x) => this.emit('change', x)); }
    this.emit('reordered', this.list({ includeTerminal: false }).map((x) => x.id));
    return true;
  }
  /** after the person agrees to the terms or downloads a model: blocked jobs go back to the queue */
  async recheck() {
    for (const j of this.jobs.values()) if (j.status === 'blocked') { j.status = 'queued'; j.error = null; await this.save(j); }
    this.pump();
  }
  async retry(id) {
    const j = this.jobs.get(id); if (!j || !['failed', 'cancelled'].includes(j.status)) return false;
    Object.assign(j, { status: 'queued', error: null, kills: 0, endedAt: null });
    if (j.root === j.id) { const tops = [...this.jobs.values()].filter((x) => x.root === x.id && !isTerminal(x) && x.id !== j.id); j.order = tops.length ? Math.max(...tops.map((x) => x.order)) + 1 : 0; }
    await this.save(j); this.pump(); return true;
  }
  async remove(id) {   // forget a finished family (and its blobs)
    const j = this.jobs.get(id); if (!j || !isTerminal(j)) return false;
    for (const x of [j, ...this.descendants(id)]) {
      for (const k of blobKeys(x.result)) await this.db.del('blobs', k);
      for (const k of blobKeys(x.params)) await this.db.del('blobs', k);
      this.jobs.delete(x.id); await this.db.del('jobs', x.id);
    }
    this.emit('removed', id); return true;
  }
  pause() { this.paused = true; this.emit('paused'); }
  resume() { this.paused = false; this.emit('resumed-queue'); this.pump(); }

  // ---- blobs (inputs and results)
  async putBlob(blob, meta = {}) { const key = uid('b'); await this.db.put('blobs', Object.assign({ key, blob, type: blob.type, size: blob.size, at: Date.now() }, meta)); return key; }
  async getBlob(key) { const r = await this.db.get('blobs', key); return r ? r.blob : null; }

  // ---- the pump: one job at a time, in order
  async pump() {
    if (this.pumping || this.readOnly) return;
    this.pumping = true;
    try {
      for (;;) {
        const j = this.next();
        if (!j) break;
        await this.runJob(j);
      }
      if (this.host && !this.active) await this.host.release();   // idle: nothing stays resident
      this.emit('idle');
    } finally { this.pumping = false; }
    if (this.next()) this.pump();   // something was added while the last job finished
  }

  async runJob(j) {
    const runner = this.runners[j.kind];
    if (RENDER_KINDS.has(j.kind) && runner.needsConsent !== false && !this.consent()) return this.block(j, 'NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson) first.');
    const model = this.modelOf(j);
    Object.assign(j, { status: 'running', startedAt: j.startedAt || Date.now(), attempts: (j.attempts || 0) + 1, error: null, interrupted: false });
    await this.save(j);                              // persisted BEFORE any GPU work: a kill from here on is detected at the next start
    const ctl = new AbortController();
    this.active = { job: j, ctl, engine: null };
    let out = null, err = null;
    try {
      let engine = null;
      try { engine = model ? await this.host.acquire(model) : null; }
      catch (e) {   // 3.8 (v040): a model that could not load (the Bigger brain: no second process, out of memory, a GPU reset) -> the runner's other model, once
        const fb = !isAbort(e) && !j.fellBack && runner.fallback ? runner.fallback(j, model, e) : null;
        if (!fb) throw e;
        j.fellBack = { from: model, to: fb, code: (e && e.code) || null }; await this.save(j); this.emit('fallback', j, j.fellBack);
        engine = await this.host.acquire(fb);
      }
      this.active.engine = engine;
      if (ctl.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      out = await runner.run(this.ctx(j, engine, ctl.signal));
    } catch (e) { err = e; }
    this.active = null;
    if (err) await this.fail(j, err);
    else if (out && out.wait) {
      Object.assign(j, { status: 'waiting', waitFor: out.wait === 'any' ? 'any' : 'all' });
      await this.save(j);
      await this.maybeWake(j);                      // all its children may already be finished
    } else {
      let result = null, storeErr = null;
      try { result = await this.storeResult(out); } catch (e) { storeErr = e; }   // e.g. QuotaExceededError on a full phone
      if (storeErr) await this.fail(j, Object.assign(new Error('could not save the result: ' + (storeErr.message || storeErr.name)), { code: storeErr.name === 'QuotaExceededError' ? 'STORAGE_FULL' : 'STORAGE' }));
      else { Object.assign(j, { status: 'done', endedAt: Date.now(), result, progress: Object.assign({}, j.progress || {}, { frac: 1 }) }); await this.save(j); this.emit('done', j); }
    }
    // the engine stays only if the very next job needs the same model.  3.8: a model with a hold (Juli) first waits that long for one:
    // the next benchmark test or an app check's next question lands right after an answer, and iOS 27 ended the page when 1.7 GB
    // loaded again within a second of its unload (WebKit gives destroyed GPU memory back late)
    if (isTerminal(j) && j.parent) await this.wakeParent(j);   // 3.8: first, so a parent that wakes is the next job (no hold, no reload)
    let nx = this.next();
    const hold = !nx && this.host && this.host.currentId && this.holdMs ? this.holdMs(this.host.currentId) : 0;
    if (hold > 0) { this.holding = true; try { await this._holdWait(hold); } finally { this.holding = false; } nx = this.next(); }
    if (this.host && (!nx || this.modelOf(nx) !== this.host.currentId)) await this.host.release();
  }
  /** 3.8: the hold's wait: resolves when a job is added or becomes runnable (a resume, a retry, a woken parent), when endHold() is called
   *  (an app opens, the page is hidden), or after ms */
  _holdWait(ms) {
    return new Promise((r) => {
      let done = false, off = null, iv = null, t = null;
      const end = () => { if (done) return; done = true; clearTimeout(t); clearInterval(iv); if (off) off(); this._holdEnd = null; r(); };
      t = setTimeout(end, ms); off = this.on('added', end); iv = setInterval(() => { if (this.next()) end(); }, 250); this._holdEnd = end;
    });
  }
  /** 3.8: end a hold now: the held model is released as when the hold runs out */
  endHold() { if (this._holdEnd) this._holdEnd(); }
  async fail(j, e) {
    const code = e && e.code;
    if (isAbort(e) || j.cancelRequested) {
      Object.assign(j, { status: 'cancelled', endedAt: Date.now() }); await this.save(j); this.emit('cancelled', j);
      for (const d of this.descendants(j.id)) if (!isTerminal(d)) { Object.assign(d, { status: 'cancelled', endedAt: Date.now() }); await this.save(d); }
      return;
    }
    if (code === 'NO_CONSENT') return this.block(j, code, e.message);
    // 3.8 (v040): the job's model ran out of memory, lost its GPU, is not on the phone or got a prompt too long for it (the Bigger brain:
    // 2,048 tokens) -> its runner's other model (runner.fallback), once; the job goes on from its saved state
    const fr = this.runners[j.kind], from = FALLBACK_CODES.has(code) && !j.fellBack && fr && fr.fallback ? this.modelOf(j) : null, fb = from ? fr.fallback(j, from, e) : null;
    if (fb) { j.fellBack = { from, to: fb, code }; j.status = 'queued'; j.interrupted = true; await this.save(j); this.emit('fallback', j, j.fellBack); return; }
    if (code === 'NOT_DOWNLOADED') return this.block(j, code, e.message);
    if ((code === 'GPU_LOST' || code === 'BUSY' || code === 'SPLIT_GONE' || code === 'SPLIT_RETRY') && (j.softRetries || 0) < 2) {   // the engine recovers by itself; same params = resume (3.8 port: + a failed second process: a fresh worker part once; Juli after her second one failed twice: one process)
      j.softRetries = (j.softRetries || 0) + 1; j.status = 'queued'; j.interrupted = true; await this.save(j);
      if (code === 'BUSY') await new Promise((r) => setTimeout(r, 1000));
      return;
    }
    Object.assign(j, { status: 'failed', endedAt: Date.now(), error: { code: code || 'ERROR', message: String((e && e.message) || e).slice(0, 400) } });
    await this.save(j); this.emit('failed', j);
  }
  async block(j, code, message) {
    Object.assign(j, { status: 'blocked', error: { code, message } });
    await this.save(j);
    this.emit(code === 'NO_CONSENT' ? 'needs-consent' : code === 'NOT_DOWNLOADED' ? 'needs-download' : 'blocked', j, this.modelOf(j));
  }
  async wakeParent(child) {
    const p = this.jobs.get(child.parent);
    if (p && p.status === 'waiting') await this.maybeWake(p);
  }
  async maybeWake(p) {
    const kids = this.children(p.id);
    const fin = kids.filter(isTerminal).length;
    if (kids.length === 0 || (p.waitFor === 'any' ? fin > (p.wokeAt || 0) : fin === kids.length)) {
      p.wokeAt = fin; p.status = 'queued'; await this.save(p);
      if (!this.pumping) queueMicrotask(() => this.pump());
    }
  }
  async storeResult(out) {
    if (!out || typeof out !== 'object') return out === undefined ? null : out;
    const r = {};
    for (const [k, v] of Object.entries(out)) {
      if (typeof Blob !== 'undefined' && v instanceof Blob) r[k] = { blobKey: await this.putBlob(v), type: v.type, size: v.size };
      else r[k] = v;
    }
    return r;
  }
  ctx(j, engine, signal) {
    const q = this;
    let lastP = 0;
    return {
      job: j, params: j.params, engine, signal, queue: q,
      resumed: !!j.resumed || j.attempts > 1,
      checkpoint: j.checkpoint, state: j.state,
      progress(p) {
        j.progress = Object.assign({}, p, { at: Date.now() }); q.emit('progress', j, j.progress);
        if (Date.now() - lastP > 2000) { lastP = Date.now(); q.db.put('jobs', j).catch(() => {}); }
      },
      async saveCheckpoint(c) { j.checkpoint = c; await q.db.put('jobs', j); },
      async setState(s) { j.state = s; this.state = s; await q.db.put('jobs', j); },
      putBlob: (b, m) => q.putBlob(b, m),
      getBlob: (k) => q.getBlob(k),
      enqueue: (kind, params, opts = {}) => q.add(kind, params, Object.assign({}, opts, { parent: j.id })),
      /** idempotent enqueue for coordinators: a child with this tag that already exists (a resumed run) is returned, not duplicated */
      async enqueueOnce(tag, kind, params, opts = {}) {
        const have = q.children(j.id).find((c) => c.tag === tag && c.status !== 'cancelled');
        return have || q.add(kind, params, Object.assign({}, opts, { parent: j.id, tag }));
      },
      children: () => q.children(j.id),
      throwIfAborted() { if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); },
    };
  }
}
function blobKeys(o, out = []) {
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) {
    if (/Key$/.test(k) && typeof v === 'string') out.push(v);
    else if (/Keys$/.test(k) && Array.isArray(v)) out.push(...v.filter((x) => typeof x === 'string'));
    else if (v && typeof v === 'object') blobKeys(v, out);
  }
  return out;
}
