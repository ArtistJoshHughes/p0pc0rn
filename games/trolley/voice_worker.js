// voice_worker.js - Juli's voice off the main thread. voice.js starts this as a module Worker when voice_pick.js allows it, posts
// { op: 'init', url } once (the voice module's full URL), then { op: 'speak', id, text } per line. Each reply carries the PCM (a copy of
// what the module returned, transferred, never the module's own memory), its rate and the synthesis time. No DOM; the module fetches
// its own files (the WebAssembly, the voice file) from the game's folder.
let mod = null;
const msg = (e) => String((e && (e.message || e)) || 'failed').slice(0, 160);
const plain = (o) => { try { return JSON.parse(JSON.stringify(o || {})); } catch (e) { return {}; } };
/** whatever the module returned -> a fresh Float32Array (its own buffer, safe to transfer) and its rate */
function pcmOf(r) {
  const a = r && typeof r === 'object' && !ArrayBuffer.isView(r) && !Array.isArray(r) ? (r.pcm || r.samples) : r;
  const rate = (r && +r.sampleRate) || (mod && mod.info && +mod.info.sampleRate) || 16000;
  if (a instanceof Int16Array) { const f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = a[i] / 32768; return { pcm: f, rate }; }
  if (a instanceof Float32Array || Array.isArray(a)) return { pcm: Float32Array.from(a), rate };
  return { pcm: new Float32Array(0), rate };
}
self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.op === 'init') {
    try {
      mod = await import(m.url);
      if (typeof mod.speak !== 'function') throw new Error('the voice module has no speak()');
      if (typeof mod.load === 'function') await mod.load();
      self.postMessage({ op: 'ready', info: plain(mod.info) });
    } catch (e) { mod = null; self.postMessage({ op: 'error', why: msg(e) }); }
    return;
  }
  if (m.op === 'speak') {
    try {
      if (!mod) throw new Error('not loaded');
      const t0 = performance.now(), r = await mod.speak(m.text), ms = performance.now() - t0, { pcm, rate } = pcmOf(r);
      const mem = typeof mod.memoryBytes === 'function' ? mod.memoryBytes() : null;
      self.postMessage({ op: 'pcm', id: m.id, pcm, rate, ms, mem }, [pcm.buffer]);
    } catch (e) { self.postMessage({ op: 'pcm', id: m.id, error: msg(e) }); }
  }
};
