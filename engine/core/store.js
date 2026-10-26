// Weight pack store: download once (HTTP Range resume, per-16-MiB-chunk SHA-256 with native WebCrypto), keep in OPFS,
// stream shards to the GPU as a NEW buffer per shard filled with queue.writeBuffer (the fastest upload path on the iPhone probe:
// 2.18 GB/s).  Uploads are sequential with compute (the probe's overlap path was slower on the phone).  docs/FORMAT.md.
'use strict';
import { h2f } from './gpu.js';
import { fetchManifest, manifestRefused } from './pin.js';   // v027.3: pinned manifests
// 3.8 port (bench v047): a load waits for the GPU after every UPCAP bytes it writes. queue.writeBuffer copies into Safari's GPU
// process, which held a whole model's worth (3.1 GB for the Bigger brain) until the copies ran: with the page and the second process
// loaded, the phone had 46 MB free (iPhone memory report, 10-25). Bounded, the GPU process holds ~64 MB of weights in flight.
const UPCAP = 64 * 1024 * 1024;

export class Storage {
  constructor(url) { this.url = url || new URL('./opfs_worker.js', import.meta.url); this.id = 0; this.pend = new Map(); }
  async start() {
    if (this.closing) await this.closing;   // p0pc0rn v026.7: a retiring worker lets go of its file handles first
    if (this.w) return;
    const w = this.w = new Worker(this.url, { type: 'module' });
    w.onmessage = (ev) => { const m = ev.data; const p = this.pend.get(m.id); if (!p) return; this.pend.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.result); if (!this.pend.size && this.w === w) this._idle(); };
    w.onerror = (e) => { for (const p of this.pend.values()) p.rej(new Error('storage worker error: ' + (e.message || e))); this.pend.clear(); };
    const r = await this.call('hello');
    if (!r.sync) throw new Error('OPFS sync access handles are not available');
  }
  call(op, args = {}, transfer = []) {
    if (this.idleT) { clearTimeout(this.idleT); this.idleT = null; }
    if (!this.w) return this.start().then(() => this.call(op, args, transfer));   // v026.7: retired while idle: a new worker
    return new Promise((res, rej) => { const id = ++this.id; this.pend.set(id, { res, rej }); this.w.postMessage(Object.assign({ id, op }, args), transfer); });
  }
  /** p0pc0rn v026.7: idle for `idleMs` (20 s; 0 = never) -> close every file handle, terminate the worker (WebKit: a thread + a JS VM each) */
  _idle() {
    const ms = this.idleMs != null ? this.idleMs : 20000; if (!ms) return;
    if (this.idleT) clearTimeout(this.idleT);
    this.idleT = setTimeout(() => {
      this.idleT = null; const w = this.w; if (!w || this.pend.size) return;
      this.w = null; this.retired = (this.retired || 0) + 1;
      this.closing = new Promise((res) => {
        const id = ++this.id, end = () => { clearTimeout(to); try { w.terminate(); } catch (e) { /* */ } res(); }, to = setTimeout(end, 3000);
        this.pend.set(id, { res: end, rej: end }); w.postMessage({ id, op: 'closeAll' });
      }).then(() => { this.closing = null; });
    }, ms);
  }
}

const hex = (ab) => Array.from(new Uint8Array(ab), (b) => b.toString(16).padStart(2, '0')).join('');

export class WeightStore {
  /** gpu: core Gpu; opts: {base: URL of the pack directory (manifest.json lives there), dir: OPFS folder, storage} */
  constructor(gpu, opts) {
    this.gpu = gpu; this.base = opts.base.endsWith('/') ? opts.base : opts.base + '/';
    this.dir = opts.dir || 'pocketflux'; this.st = opts.storage || new Storage();
    this.pool = []; this.stats = { uploadBytes: 0, uploadMs: 0, readMs: 0 };
    this.http = opts.source === 'http';
  }
  async open() {
    if (this.http) {
      const got = await fetchManifest(this.base);   // v027.3: checked against config.js before it is used
      if (!got || got.bad) { if (got) manifestRefused(got, false); throw new Error(got ? got.bad : 'pack manifest unavailable'); }
      const m = got.m;
      if (m.format !== 'pocketflux.pack' || m.format_version !== 1) throw new Error('unsupported pack format ' + m.format + '/' + m.format_version);
      this.m = m; this.shards = new Map(m.shards.map((s) => [s.name, s]));
      this.state = { pack_version: m.pack_version, done: Object.fromEntries(m.shards.map((s) => [s.name, { sha256: s.sha256, chunks: s.chunk_sha256.length }])) };
      return m;
    }
    await this.st.start();
    let m = null;
    // v027.3: the manifest is used and kept only when it matches config.js (its exact bytes are kept); offline or refused: the stored copy
    const got = await fetchManifest(this.base), path = `${this.dir}/manifest.json`;
    if (got && got.m) {
      m = got.m; const ab = got.ab;
      await this.st.call('write', { name: path, at: 0, buf: ab, truncate: 0 }, [ab]); await this.st.call('close', { name: path });
    } else {
      const sz = (await this.st.call('size', { name: path })).size;
      if (got) manifestRefused(got, sz > 0);
      if (sz <= 0) throw new Error(got ? got.bad : 'pack manifest unavailable (offline and not downloaded)');
      const r = await this.st.call('read', { name: path, at: 0, len: sz });
      m = JSON.parse(new TextDecoder().decode(new Uint8Array(r.buf, 0, sz)));
    }
    if (m.format !== 'pocketflux.pack' || m.format_version !== 1) throw new Error('unsupported pack format ' + m.format + '/' + m.format_version);
    this.m = m; this.shards = new Map(m.shards.map((s) => [s.name, s]));
    this.state = await this._loadState();
    return m;
  }
  async _loadState() {
    const p = `${this.dir}/state.json`, sz = (await this.st.call('size', { name: p })).size;
    if (sz <= 0) return { pack_version: this.m.pack_version, done: {} };
    const r = await this.st.call('read', { name: p, at: 0, len: sz });
    const s = JSON.parse(new TextDecoder().decode(new Uint8Array(r.buf, 0, sz)));
    return s;
  }
  async _saveState() {
    const ab = new TextEncoder().encode(JSON.stringify(this.state)).buffer, p = `${this.dir}/state.json`;
    await this.st.call('write', { name: p, at: 0, buf: ab, truncate: 0 }, [ab]); await this.st.call('flush', { name: p });
  }
  /** per-shard chunk bitmap ('1' = written + sha256-verified); also reads the v1 state ({chunks: n} = the first n chunks) */
  _bits(s) {
    const d = this.state.done[s.name], n = s.chunk_sha256.length;
    if (!d || d.sha256 !== s.sha256) return '0'.repeat(n);
    if (typeof d.bits === 'string' && d.bits.length === n) return d.bits;
    const k = Math.min(n, d.chunks | 0); return '1'.repeat(k) + '0'.repeat(n - k);
  }
  /** a shard is complete when every chunk is verified against the manifest (whose shard sha256 must match the stored one) */
  status() {
    let have = 0, total = 0; const missing = [];
    for (const s of this.m.shards) {
      total += s.bytes;
      const b = this._bits(s); let all = true;
      for (let i = 0; i < b.length; i++) { if (b[i] === '1') have += Math.min(s.chunk_bytes, s.bytes - i * s.chunk_bytes); else all = false; }
      if (!all) missing.push(s.name);
    }
    return { have, total, missing, complete: missing.length === 0 };
  }
  /** download everything missing as 16 MiB HTTP Range requests, `parallel` (default 4) in flight; each chunk is SHA-256 verified
   *  (native WebCrypto) and written to OPFS as it lands, a bad chunk is re-fetched (up to 4 tries).  Resumable per chunk: the state
   *  (a bitmap per shard) is saved every ~3 s from a snapshot taken BEFORE the flush, so a kill never marks unflushed data as done.
   *  onProgress({have, total, shard, bytesPerSec}); signal: AbortSignal (pause). */
  async download(opts = {}) {
    if (this.http) return this.status();
    const par = Math.max(1, Math.min(8, opts.parallel || 4)), t0 = performance.now(), st0 = this.status();
    const bits = new Map(this.m.shards.map((s) => [s.name, this._bits(s).split('')])), q = [], dirty = new Set();
    for (const s of this.m.shards) bits.get(s.name).forEach((b, i) => { if (b !== '1') q.push([s, i]); });
    let got = 0, lastSave = performance.now(), saving = null, err = null;
    const save = async () => {
      const snap = this.m.shards.map((s) => [s, bits.get(s.name).join('')]), files = Array.from(dirty); dirty.clear();
      for (const f of files) await this.st.call('flush', { name: f });
      for (const [s, b] of snap) { let k = 0; while (k < b.length && b[k] === '1') k++; this.state.done[s.name] = { sha256: s.sha256, bits: b, chunks: k }; }
      this.state.pack_version = this.m.pack_version; await this._saveState(); lastSave = performance.now();
    };
    const aborted = () => opts.signal && opts.signal.aborted;
    const worker = async () => {
      while (q.length && !err) {
        const [s, ci] = q.shift(), at = ci * s.chunk_bytes, len = Math.min(s.chunk_bytes, s.bytes - at), name = `${this.dir}/${s.file}`;
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok && !err; attempt++) {
          if (aborted()) throw new DOMException('aborted', 'AbortError');
          let ab = null;
          try {
            const r = await fetch(this.base + s.file, { headers: { Range: `bytes=${at}-${at + len - 1}` }, signal: opts.signal, cache: 'no-store' });
            if (r.status !== 206 && !(r.status === 200 && at === 0 && len === s.bytes)) {
              try { await r.body.cancel(); } catch (e) { /* an unread body would pin one of the browser's few connections */ }
              throw Object.assign(new Error(`download ${s.file}: HTTP ${r.status} (the pack server must honour HTTP Range requests)`), { fatal: r.status === 200 || r.status === 404 || r.status === 403 });
            }
            ab = await r.arrayBuffer();
          } catch (e) {
            if ((e && e.name === 'AbortError') || aborted()) throw new DOMException('aborted', 'AbortError');
            if (attempt === 3 || (e && e.fatal)) throw e;
            await new Promise((res) => setTimeout(res, 400 * (attempt + 1))); continue;
          }
          if (ab.byteLength !== len || hex(await crypto.subtle.digest('SHA-256', ab)) !== s.chunk_sha256[ci]) continue;
          await this.st.call('write', { name, at, buf: ab }, [ab]);
          ok = true;
        }
        if (err) return;
        if (!ok) throw new Error(`download ${s.file}: chunk ${ci} failed verification 4 times`);
        bits.get(s.name)[ci] = '1'; dirty.add(name); got += len;
        if (opts.onProgress) opts.onProgress({ have: st0.have + got, total: st0.total, shard: s.name, bytesPerSec: got / ((performance.now() - t0) / 1000) });
        if (!saving && performance.now() - lastSave > 3000) { saving = save(); try { await saving; } finally { saving = null; } }
      }
    };
    await Promise.all(Array.from({ length: par }, () => worker().catch((e) => { if (!err) err = e; })));
    if (saving) await saving;
    await save(); await this.st.call('closeAll');
    this.stats.downloadBytes = got; this.stats.downloadSec = (performance.now() - t0) / 1000;
    if (err) throw err;
    return this.status();
  }
  async remove() { await this.st.call('remove', { name: this.dir }); this.state = { pack_version: this.m && this.m.pack_version, done: {} }; }

  // ------------------------------------------------------------------ direct-HTTP source (development / tests: no OPFS copy)
  async _range(file, at, len) {
    const r = await fetch(this.base + file, { headers: { Range: `bytes=${at}-${at + len - 1}` } });
    if (!r.ok) throw new Error(`fetch ${file}: HTTP ${r.status}`);
    const ab = await r.arrayBuffer();
    return r.status === 206 ? ab : ab.slice(at, at + len);
  }
  async _uploadHttp(s, buf) {
    const res = await fetch(this.base + s.file);
    if (!res.ok) throw new Error(`fetch ${s.file}: HTTP ${res.status}`);
    const rd = res.body.getReader(), CH = 16 * 1024 * 1024; let st = new Uint8Array(CH), fill = 0, off = 0;
    const put = async (n) => { this.gpu.device.queue.writeBuffer(buf, off, st.buffer, 0, Math.ceil(n / 4) * 4); off += n; fill = 0;
      if ((this.inflight = (this.inflight || 0) + n) >= UPCAP) { this.inflight = 0; try { await this.gpu.device.queue.onSubmittedWorkDone(); } catch (e) { /* */ } }   // 3.8 port: at most ~64 MB of weights in flight
    };
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      let v = value;
      while (v.length) { const k = Math.min(v.length, CH - fill); st.set(v.subarray(0, k), fill); fill += k; v = v.subarray(k); if (fill === CH) await put(CH); }
    }
    if (fill) await put(fill);
  }
  /** a whole pack file as an ArrayBuffer (tokenizer files, small tables) */
  async readFile(shardName) {
    const s = this.shards.get(shardName);
    if (this.http) return (await fetch(this.base + s.file)).arrayBuffer();
    const r = await this.st.call('read', { name: `${this.dir}/${s.file}`, at: 0, len: s.bytes });
    return r.buf.byteLength === s.bytes ? r.buf : r.buf.slice(0, s.bytes);
  }
  /** a few tensors of a shard in a NEW small buffer (e.g. img_in + final_layer.linear kept across the denoise loop) */
  async uploadPart(shardName, names) {
    const s = this.shards.get(shardName), T = this.m.tensors, A = 256;
    let tot = 0; const lay = names.map((n) => { const x = T[n]; const o = tot; tot += Math.ceil(x.bytes / A) * A; return [n, x, o]; });
    const buf = this.gpu.buffer(tot, 'part ' + shardName);
    for (const [, x, o] of lay) {
      const ab = this.http ? await this._range(s.file, x.offset, x.bytes) : (await this.st.call('read', { name: `${this.dir}/${s.file}`, at: x.offset, len: x.bytes })).buf;
      this.gpu.device.queue.writeBuffer(buf, o, ab, 0, Math.ceil(x.bytes / 4) * 4 <= ab.byteLength ? Math.ceil(x.bytes / 4) * 4 : x.bytes);
    }
    const map = new Map(lay.map(([n, x, o]) => [n, { buf, off: o, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }]));
    return { name: shardName + '(part)', buf, bytes: tot, t: (tn) => { const r = map.get(tn); if (!r) throw new Error(`tensor ${tn} not in part`); return r; } };
  }

  // ------------------------------------------------------------------ GPU upload: one NEW buffer per shard
  /** returns a ShardHandle {name, buf, bytes, t(tensorName)}; call release(h) when the block is done */
  async upload(shardName) {
    const s = this.shards.get(shardName);
    if (!s) throw new Error('unknown shard ' + shardName);
    const g = this.gpu, name = `${this.dir}/${s.file}`, CH = 16 * 1024 * 1024;
    const t0 = performance.now();
    const buf = this._reuse(s.bytes) || g.buffer(s.bytes, 'shard ' + shardName);   // p0pc0rn v024.1: the kept buffer of the same size
    if (this.http) {
      await this._uploadHttp(s, buf);
      this.stats.uploadBytes += s.bytes; this.stats.uploadMs += performance.now() - t0;
      return this._handle(shardName, buf, s.bytes);
    }
    const take = () => this.pool.pop() || new ArrayBuffer(CH);
    // p0pc0rn v024: the staging buffer is TRANSFERRED to the worker and back (zero-copy); a cloned one left 16 MB of garbage per chunk
    const read = (at, len) => { const b = take(); return this.st.call('read', { name, at, len, buf: b }, [b]); };
    let next = read(0, Math.min(CH, s.bytes));
    for (let off = 0; off < s.bytes; off += CH) {
      const r = await next;
      const nOff = off + CH;
      if (nOff < s.bytes) next = read(nOff, Math.min(CH, s.bytes - nOff));   // read-ahead (I/O only)
      g.device.queue.writeBuffer(buf, off, r.buf, 0, r.len);
      if (this.pool.length < 3) this.pool.push(r.buf);
      if ((this.inflight = (this.inflight || 0) + r.len) >= UPCAP) { this.inflight = 0; try { await g.device.queue.onSubmittedWorkDone(); } catch (e) { /* */ } }   // 3.8 port: at most ~64 MB of weights in flight
    }
    this.stats.uploadBytes += s.bytes; this.stats.uploadMs += performance.now() - t0;
    return this._handle(shardName, buf, s.bytes);
  }
  _handle(shardName, buf, bytes) {
    const tensors = this.m.tensors, h = { name: shardName, buf, bytes };
    h.t = (tn) => { const x = tensors[tn]; if (!x || x.shard !== shardName) throw new Error(`tensor ${tn} not in ${shardName}`);
      return { buf: h.buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }; };
    return h;
  }
  /** p0pc0rn v024.1: release KEEPS the last released shard buffer for the next upload of the same size (streamed layers are equal:
   *  no create / destroy per layer, which WebKit reclaims lazily); any other upload destroys it first, so the peak never grows */
  release(h) {
    if (!h || !h.buf) return;
    const b = h.buf; h.buf = null;
    if (!this.gpu.bufs.has(b)) return;
    for (const x of this.gpool || []) this.gpu.free(x);
    this.gpool = [b];
  }
  _reuse(bytes) {
    const size = Math.max(16, Math.ceil(bytes / 16) * 16), P = this.gpool || [];
    this.gpool = [];
    let hit = null;
    for (const b of P) { if (!hit && b._pf === size && this.gpu.bufs.has(b)) hit = b; else this.gpu.free(b); }
    if (hit) this.gpu.runner.flush();   // batched dispatches that still read the old contents are submitted before the new writes
    return hit;
  }
  /** destroy the kept buffer (before a phase that allocates a lot, and at the end of a job) */
  drainPool() { for (const b of this.gpool || []) this.gpu.free(b); this.gpool = []; }

  /** gather + dequantise rows of a *.rows tensor (TE embedding) -> Float32Array [ids.length, K] */
  async readRows(tensorName, ids) {
    const x = this.m.tensors[tensorName], s = this.shards.get(x.shard), K = x.shape[1];
    const q4 = x.enc === 'q4g32a.rows';
    if (!q4 && x.enc !== 'q8g64s.rows') throw new Error('readRows: ' + x.enc);
    const rb = q4 ? K / 2 + (K / 32) * 4 : K + (K / 64) * 2;
    let r;
    if (this.http) {
      const parts = await Promise.all(ids.map((i) => this._range(s.file, x.offset + i * rb, rb))), all = new Uint8Array(ids.length * rb);
      parts.forEach((ab, i) => all.set(new Uint8Array(ab), i * rb)); r = { buf: all.buffer };
    } else r = await this.st.call('readMany', { name: `${this.dir}/${s.file}`, ranges: ids.map((i) => [x.offset + i * rb, rb]) });
    const out = new Float32Array(ids.length * K), u8 = new Uint8Array(r.buf), dv = new DataView(r.buf);
    for (let i = 0; i < ids.length; i++) {
      const b = i * rb, o = i * K;
      if (q4) {
        for (let g = 0; g < K / 32; g++) {
          const sc = h2f(dv.getUint16(b + K / 2 + g * 4, true)), mn = h2f(dv.getUint16(b + K / 2 + g * 4 + 2, true));
          for (let j = 0; j < 16; j++) { const by = u8[b + g * 16 + j]; out[o + g * 32 + 2 * j] = (by & 15) * sc + mn; out[o + g * 32 + 2 * j + 1] = (by >> 4) * sc + mn; }
        }
      } else {
        for (let g = 0; g < K / 64; g++) {
          const sc = h2f(dv.getUint16(b + K + g * 2, true));
          for (let j = 0; j < 64; j++) out[o + g * 64 + j] = dv.getInt8(b + g * 64 + j) * sc;
        }
      }
    }
    return out;
  }
}
