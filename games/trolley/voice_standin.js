// voice_standin.js - Juli's voice until the real one lands (CMU Flite with its cmu_us_slt voice, in WebAssembly: vendor/flite/README.md):
// the same API, a quiet murmur instead of words. speak(text) -> Float32Array PCM at 16 kHz, about 0.065 s a character (at least 0.4 s):
// a soft band-limited buzz (a voice-like 195 Hz fundamental and five harmonics, all under 1.3 kHz, gliding down a little over the
// line) under a syllable-rate envelope (about one syllable per three letters, ~5 a second), silent between words and on punctuation.
// The same text always gives the same samples. No network, no files: load() resolves at once.
export const info = { name: 'stand-in', sampleRate: 16000 };
export const SEC_PER_CHAR = 0.065, MIN_S = 0.4, PEAK = 0.12;
const R = info.sampleRate, F0 = 195, HARMONICS = 6, TN = 2048;
let TABLE = null;
/** one period of the buzz: the first six harmonics, falling as 1/k, normalised to a peak of 1 */
function table() {
  if (TABLE) return TABLE;
  const t = new Float32Array(TN); let mx = 0;
  for (let i = 0; i < TN; i++) { let v = 0; for (let k = 1; k <= HARMONICS; k++) v += Math.sin(2 * Math.PI * k * i / TN) / k; t[i] = v; mx = Math.max(mx, Math.abs(v)); }
  for (let i = 0; i < TN; i++) t[i] /= mx;
  return (TABLE = t);
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

export async function load() { return info; }
/** how many samples speak(text) gives */
export function lengthFor(text) {
  const n = typeof text === 'string' ? text.length : 0;
  return Math.max(Math.round(MIN_S * R), Math.round(n * SEC_PER_CHAR * R));
}
/** text -> Float32Array PCM at 16 kHz, -PEAK..PEAK */
export function speak(text) {
  const s = typeof text === 'string' ? text : '', N = lengthFor(s), out = new Float32Array(N);
  if (!/[a-z0-9]/i.test(s)) return out;   // nothing to say: silence of the minimum length
  const T = table(), cs = N / s.length, seed = hash(s) * 2 * Math.PI, re = /[a-z0-9']+/gi;
  let ph = 0, m;
  while ((m = re.exec(s))) {   // each word: its share of the line's samples, one hump per syllable
    const a = Math.floor(m.index * cs), b = Math.min(N, Math.floor((m.index + m[0].length) * cs)), len = b - a, syl = Math.max(1, Math.round(m[0].length / 3));
    for (let i = a; i < b; i++) {
      const u = (i - a) / len, hump = Math.sin(Math.PI * syl * u), edge = Math.min(1, u * 10, (1 - u) * 10);
      const f0 = F0 * (1.08 - 0.16 * i / N) * (1 + 0.04 * Math.sin(2 * Math.PI * 0.9 * i / R + seed));
      ph += f0 / R * TN; if (ph >= TN) ph -= TN;
      out[i] = PEAK * edge * (0.3 + 0.7 * hump * hump) * T[ph | 0];
    }
  }
  return out;
}
