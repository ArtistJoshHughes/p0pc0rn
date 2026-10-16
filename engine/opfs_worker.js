// OPFS storage worker (module worker).  Sync access handles = the fastest OPFS path (iPhone probe: write 1.0 GB/s, read 2.9 GB/s).
// One request at a time; replies carry the request id; read buffers are transferred both ways (no copies, no growth).
'use strict';
let root = null;
const handles = new Map();   // name -> FileSystemSyncAccessHandle (kept open while in use)
const maybe = (v) => (v && typeof v.then === 'function' ? v : Promise.resolve(v));

async function dir(path) {
  if (!root) root = await navigator.storage.getDirectory();
  let d = root;
  for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create: true });
  return d;
}
async function handle(name, create) {
  let h = handles.get(name);
  if (h) return h;
  const i = name.lastIndexOf('/');
  const d = await dir(i < 0 ? '' : name.slice(0, i));
  const fh = await d.getFileHandle(name.slice(i + 1), { create: !!create });
  h = await fh.createSyncAccessHandle();
  handles.set(name, h);
  return h;
}
async function close(name) {
  const h = handles.get(name);
  if (h) { handles.delete(name); try { await maybe(h.flush()); } catch (e) { /* */ } await maybe(h.close()); }
}

const ops = {
  async write(m) {            // {name, at, buf, truncate?}
    const h = await handle(m.name, true);
    if (m.truncate != null) await maybe(h.truncate(m.truncate));
    const n = await maybe(h.write(new Uint8Array(m.buf), { at: m.at }));
    if (typeof n === 'number' && n !== m.buf.byteLength) throw new Error(`short write ${n}/${m.buf.byteLength}`);
    return { n, buf: m.buf, transfer: [m.buf] };
  },
  async read(m) {             // {name, at, len, buf?} -> fills buf (or a new one)
    const h = await handle(m.name, false);
    const buf = m.buf && m.buf.byteLength >= m.len ? m.buf : new ArrayBuffer(m.len);
    const n = await maybe(h.read(new Uint8Array(buf, 0, m.len), { at: m.at }));
    if (typeof n === 'number' && n !== m.len) throw new Error(`short read ${n}/${m.len} at ${m.at} of ${m.name}`);
    return { buf, len: m.len, transfer: [buf] };
  },
  async readMany(m) {         // {name, ranges:[[at,len],...]} -> one buffer with the ranges concatenated
    const h = await handle(m.name, false);
    const tot = m.ranges.reduce((s, r) => s + r[1], 0), buf = new ArrayBuffer(tot);
    let o = 0;
    for (const [at, len] of m.ranges) { await maybe(h.read(new Uint8Array(buf, o, len), { at })); o += len; }
    return { buf, transfer: [buf] };
  },
  async writeRect(m) {        // {name, buf: [F][ch][cw] RGBA, F, f0, H, W, x0, y0, cw, ch}: a tile of video frames into a [F][H][W] RGBA file
    const h = await handle(m.name, true), u = new Uint8Array(m.buf), rb = m.cw * 4;
    for (let f = 0; f < m.F; f++) for (let r = 0; r < m.ch; r++) {
      const src = (f * m.ch + r) * rb;
      await maybe(h.write(u.subarray(src, src + rb), { at: (((m.f0 || 0) + f) * m.H + m.y0 + r) * m.W * 4 + m.x0 * 4 }));
    }
    return { n: m.F * m.ch, buf: m.buf, transfer: [m.buf] };
  },
  async truncate(m) { const h = await handle(m.name, true); await maybe(h.truncate(m.size)); return {}; },
  async size(m) { try { const h = await handle(m.name, false); return { size: await maybe(h.getSize()) }; } catch (e) { return { size: -1 }; } },
  async flush(m) { const h = handles.get(m.name); if (h) await maybe(h.flush()); return {}; },
  async close(m) { await close(m.name); return {}; },
  async closeAll() { for (const n of Array.from(handles.keys())) await close(n); return {}; },
  async remove(m) {           // {name} file or directory (recursive)
    for (const n of Array.from(handles.keys())) if (n === m.name || n.startsWith(m.name + '/')) await close(n);
    const i = m.name.lastIndexOf('/');
    const d = await dir(i < 0 ? '' : m.name.slice(0, i));
    try { await d.removeEntry(m.name.slice(i + 1), { recursive: true }); } catch (e) { if (!e || e.name !== 'NotFoundError') throw e; }
    return {};
  },
  async hello() { return { sync: typeof FileSystemSyncAccessHandle !== 'undefined' }; },
};

let q = Promise.resolve();
self.onmessage = (ev) => {
  const m = ev.data || {};
  q = q.then(async () => {
    try {
      const r = await ops[m.op](m);
      const tr = r.transfer || []; delete r.transfer;
      self.postMessage({ id: m.id, result: r }, tr);
    } catch (e) {
      const out = { id: m.id, error: (e && (e.name ? e.name + ': ' : '') + (e.message || String(e))) || 'error' };
      if (m.buf) { out.buf = m.buf; self.postMessage(out, [m.buf]); } else self.postMessage(out);
    }
  });
};
