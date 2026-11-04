// flite_voice.js - Juli's voice (Josh, Nov 1: "Voice 4 is what we go with"): CMU Flite 2.2 and its cmu_us_slt voice (the CMU ARCTIC slt voice), compiled to
// WebAssembly for p0pc0rn (juli_tts.mjs + juli_tts.wasm, Emscripten; juli_tts.c is its entry point; Flite's own sources unchanged).
// The API voice.js expects of a voice module: info, load(), speak(text) -> Float32Array PCM (-1..1) at info.sampleRate (16 kHz),
// memoryBytes(). It runs in voice.js's Worker (voice_worker.js) or on the page; it loads only when her first line is spoken (never on the
// landing screen). Licences: LICENSE-flite.txt (CMU, BSD-style) and LICENSE-emscripten.txt (MIT) beside it; the credit is in NOTICE.md.
/** the voice file: one name, so a smoother Juli voice built the same way can replace it */
export const VOICE_FILE = 'cmu_us_slt.flitevox';
export const info = { name: 'Flite slt', sampleRate: 16000 };
let M = null, np = 0, pending = null;
const here = (f) => new URL(f, import.meta.url).href;
/** the WebAssembly module and the voice, once (about 11.9 MB: the voice file is kept in the module's own memory) */
export async function load() {
  if (M) return true;
  if (!pending) pending = (async () => {
    const { default: createJuliTTS } = await import('./juli_tts.mjs');
    const mod = await createJuliTTS({ locateFile: (f) => here(f) });
    const r = await fetch(here(VOICE_FILE)); if (!r.ok) throw new Error('the voice file did not load (' + r.status + ')');
    mod.FS.writeFile('/juli.flitevox', new Uint8Array(await r.arrayBuffer()));
    if (mod.ccall('juli_init', 'number', ['string'], ['/juli.flitevox']) !== 1) throw new Error('Flite did not take the voice');
    np = mod._malloc(8); M = mod; return true;
  })().catch((e) => { pending = null; throw e; });
  return pending;
}
/** one line -> its PCM at info.sampleRate (a fresh copy: the module reuses its buffer on the next call) */
export function speak(text) {
  if (!M) throw new Error('the voice is not loaded');
  const p = M.ccall('juli_speak', 'number', ['string', 'number', 'number'], [String(text || ''), np, np + 4]);
  const n = M.HEAP32[np >> 2], hz = M.HEAP32[(np >> 2) + 1];
  if (!p || !(n > 0)) return new Float32Array(0);
  if (hz > 0) info.sampleRate = hz;
  const s = M.HEAP16.subarray(p >> 1, (p >> 1) + n), f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = s[i] / 32768;
  return f;
}
/** the module's memory now (its heap holds the voice) */
// (v4, Nov 2: the module exports HEAP16 and HEAP32, not HEAP8: any exported view's buffer is its whole memory)
export function memoryBytes() { const v = M && (M.HEAP16 || M.HEAP32 || M.HEAP8 || M.HEAPU8); return v ? v.buffer.byteLength : 0; }
