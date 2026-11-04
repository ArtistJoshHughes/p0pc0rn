// tunecore.js - p0pc0rn v4 autotune: the pure parts (no GPU, no DOM; node-testable). The tuner (autotune.js) times this device's
// chat decode kernels and keeps the fastest correct ones; this file says WHICH shapes it times, which candidates each gets, when a
// faster one is worth switching to (3% or more over what ships), how a result is keyed and cached, the fallback order (measured here ->
// the known table for this GPU family -> what ships), and the plain words of the results card. Never a memory figure.
import { FAMILY } from './family.js';

export const STORE_KEY = 'p0pc0rn:tune';          // the cached result (one per origin: the Home Screen app and a Safari tab each have one)
export const ASKED_KEY = 'p0pc0rn:tuneAsked';     // {t, never}: the pop-up was answered (Later / Don't ask again)
export const SCHEMA = 1;
export const GAIN = 1.03;                         // switch only when the candidate is at least 3% faster than what ships

// ------------------------------------------------------------------------------------------------ the shapes (the packs' manifests)
// [model, encoding, prologue, epilogue, N, K, kPer, calls per token] as gemma4.js decodes (E2B's balanced pack: attention, the
// per-layer-input gate/projection and MLP layers 4/6/12/13 are 8-bit; Bolt E4B: all 4-bit). Only 4-bit shapes have candidates (the v5
// family); 8-bit ones are timed once for the speed estimate.
export const SHAPES = [
  ['e2b', 'q8', 'rms', 'store', 2560, 1536, 0, 12], ['e2b', 'q8', 'rms', 'store', 5120, 1536, 0, 3], ['e2b', 'q8', 'rms', 'store', 2048, 1536, 0, 16],
  ['e2b', 'q8', 'rms', 'store', 4096, 1536, 0, 4], ['e2b', 'q8', 'raw', 'store', 1536, 2048, 2048, 28], ['e2b', 'q8', 'raw', 'store', 1536, 4096, 2048, 7],
  ['e2b', 'q4', 'rms', 'geglu', 6144, 1536, 0, 11], ['e2b', 'q4', 'rms', 'geglu', 12288, 1536, 0, 20], ['e2b', 'q8', 'rms', 'geglu', 6144, 1536, 0, 4],
  ['e2b', 'q4', 'raw', 'store', 1536, 6144, 2048, 11], ['e2b', 'q4', 'raw', 'store', 1536, 12288, 2048, 20], ['e2b', 'q8', 'raw', 'store', 1536, 6144, 2048, 4],
  ['e2b', 'q8', 'raw', 'store', 256, 1536, 0, 35], ['e2b', 'q8', 'pleg', 'store', 1536, 256, 0, 35], ['e2b', 'q4', 'raw', 'store', 8960, 1536, 0, 1],
  ['e2b', 'q4', 'rms', 'softcap', 262144, 1536, 0, 1],
  ['e4b', 'q4', 'rms', 'store', 3072, 2560, 0, 20], ['e4b', 'q4', 'rms', 'store', 6144, 2560, 0, 4], ['e4b', 'q4', 'rms', 'store', 2048, 2560, 0, 15],
  ['e4b', 'q4', 'rms', 'store', 4096, 2560, 0, 3], ['e4b', 'q4', 'raw', 'store', 2560, 2048, 2048, 35], ['e4b', 'q4', 'raw', 'store', 2560, 4096, 2048, 7],
  ['e4b', 'q4', 'rms', 'geglu', 10240, 2560, 0, 42], ['e4b', 'q4', 'raw', 'store', 2560, 10240, 2048, 42], ['e4b', 'q4', 'raw', 'store', 256, 2560, 0, 42],
  ['e4b', 'q4', 'pleg', 'store', 2560, 256, 0, 42], ['e4b', 'q4', 'raw', 'store', 10752, 2560, 0, 1], ['e4b', 'q4', 'rms', 'softcap', 262144, 2560, 0, 1],
].map(([model, w, pro, epi, N, K, kPer, count]) => ({ model, w, pro, epi, N, K, kPer, count, key: `${pro}.${epi}.${N}x${K}` }));
export const MODELS = { e2b: { layers: 35, D: 1536, nkv: 1, full: 7 }, e4b: { layers: 42, D: 2560, nkv: 2, full: 7 } };
/** the decode attention configurations the tuner times per model: [kind, head size, keys] (a sliding layer reads the last 512) */
export const ATTN = [['sliding', 256, 512], ['full', 512, 2048]];

/** v5 options <-> a short tag ('n2.L8.s.shift'); 'engine' = the engine's own kernel */
export const tagOf = (o) => (!o || o === 'engine' ? 'engine' : `n${o.ND || 4}.L${o.L || 8}.${o.mode === 'direct' ? 'd' : 's'}.${o.deq || 'shift'}`);
export function optsOf(tag) {
  if (!tag || tag === 'engine') return 'engine';
  const m = /^n(\d+)\.L(\d+)\.([sd])\.(shift|mask|u8)$/.exec(tag); if (!m) return null;
  const o = { ND: +m[1], L: +m[2] }; if (m[3] === 'd') o.mode = 'direct'; if (m[4] !== 'shift') o.deq = m[4];
  return o;
}
/** the few variants every 4-bit shape tries besides what ships (the families' winners on the desk GPUs and the iPhone's picks) */
export const BASE_TAGS = ['n2.L8.s.shift', 'n4.L16.d.shift', 'n4.L16.d.mask', 'n4.L8.d.mask', 'n2.L4.d.shift', 'n1.L4.d.mask'];
/** a shape's candidates: the engine's kernel, what ships (pick), the family's choice, then BASE_TAGS, at most max, no repeats */
export function candidatesFor(shape, pick, family, max = 6) {
  const out = ['engine'];
  const add = (t) => { if (t && !out.includes(t) && out.length < max) out.push(t); };
  if (shape.w !== 'q4') return out;
  add(pick ? tagOf(pick) : null); add(family && family[shape.key]); for (const t of BASE_TAGS) add(t);
  return out;
}

// ------------------------------------------------------------------------------------------------ choosing
/** ms = { tag: median ms } for one shape; shipped = the tag that ships for it -> { tag, gain } (shipped unless >= GAIN faster) */
export function choose(ms, shipped, gain = GAIN) {
  const base = ms[shipped];
  if (!(base > 0)) return { tag: shipped, gain: 1 };
  let best = shipped, bt = base;
  for (const [t, v] of Object.entries(ms)) if (v > 0 && v < bt) { best = t; bt = v; }
  return base / bt >= gain ? { tag: best, gain: base / bt } : { tag: shipped, gain: 1 };
}
/** the picks table for lopsx.setPicks from the per-shape choices: only shapes whose choice differs from what ships */
export function picksFrom(choices, shippedOf) {
  const over = {};
  for (const [key, tag] of Object.entries(choices)) if (tag !== shippedOf(key)) { const o = optsOf(tag); if (o) over[key] = o; }
  return Object.keys(over).length ? over : null;
}

// ------------------------------------------------------------------------------------------------ the cache key
/** the operating system and the browser's name and major version (never the whole user agent). iOS Safari freezes the iOS version in
 *  its user agent (18_7), so on an iPhone the Safari version stands for it. */
export function platform(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11|CrOS/.test(ua) ? 'Linux' : 'other';
  const m = ua.match(/Edg\/(\d+)/) || ua.match(/(?:Chrome|CriOS)\/(\d+)/) || ua.match(/Firefox\/(\d+)/) || ua.match(/Version\/(\d+)(?:\.\d+)?.*Safari/);
  const name = /Edg\//.test(ua) ? 'Edge' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'other';
  return { os, browser: name + (m ? ' ' + m[1] : '') };
}
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
/** what a result is valid for: the GPU (adapter info + the limits the kernels depend on + features), the browser and OS, the app and
 *  kernel versions. Any change = a new key = the old result no longer applies. -> { ...fields, id } */
export function tuneKey({ info = {}, limits = {}, features = [], wgsl = [], ua = '', app = '', kernels = '' } = {}) {
  const k = {
    gpu: [info.vendor || '', info.architecture || '', info.device || '', info.description || ''].join('/'),
    limits: [limits.maxComputeWorkgroupStorageSize, limits.maxStorageBufferBindingSize, limits.maxStorageBuffersPerShaderStage, limits.maxComputeInvocationsPerWorkgroup].join('/'),
    features: ['shader-f16', 'subgroups', 'timestamp-query'].filter((f) => features.includes(f)).join(','),
    wgsl: wgsl.includes('packed_4x8_integer_dot_product') ? 'p4x8' : '',
    ...platform(ua), app: String(app).replace(/[^ -~]/g, ''), kernels: String(kernels),   // printable ASCII: a server's charset never changes the key
  };
  k.id = fnv(JSON.stringify(k));
  return k;
}
/** a cached result -> what applies now: 'measured' (same key), else the family table's entry for this GPU, else 'shipped' (null).
 *  -> { source, picks, ad, family } */
export function resolve(cache, key, info = {}) {
  if (cache && cache.schema === SCHEMA && cache.key && cache.key.id === key.id && !cache.failed) return { source: 'measured', picks: cache.picks || null, ad: cache.ad || null };
  const fam = familyEntry(info);
  if (fam) return { source: 'family', picks: fam.picks ? Object.fromEntries(Object.entries(fam.picks).map(([k, t]) => [k, optsOf(t)]).filter(([, o]) => o)) : null, ad: fam.ad || null, family: fam.name };
  return { source: 'shipped', picks: null, ad: null };
}
export function familyEntry(info = {}, table = FAMILY) {
  const v = String(info.vendor || '').toLowerCase(), a = String(info.architecture || '').toLowerCase();
  return table.find((e) => e.vendor === v && e.architecture === a) || null;
}
/** why the pop-up should show now: 'first' (never tuned or asked), 'update' (a result for an older app / kernels / browser), or '' */
export function promptReason(cache, asked, key) {
  if (asked && asked.never) return '';
  if (!cache) return asked ? '' : 'first';
  if (cache.key && cache.key.id !== key.id) return asked && asked.forId === key.id ? '' : 'update';
  return '';
}

// ------------------------------------------------------------------------------------------------ which graphics chip (v4)
// A laptop with two graphics chips can run p0pc0rn on its built-in one. Every engine asks
// for 'high-performance', but Chrome on Windows ignores WebGPU's powerPreference (crbug 369219127): a hybrid-graphics laptop gets its
// built-in chip unless Windows' own per-app setting says otherwise. These say which chip ran and, on Windows, how to change it.
export const TIP_KEY = 'p0pc0rn:gpuTip';         // {id, t}: the "faster graphics card" tip in Settings › Benchmark was dismissed on this device
const lc = (s) => String(s || '').trim().toLowerCase();
/** what WebGPU reports about an adapter -> one plain line: "Intel(R) UHD Graphics 620 (intel, gen-12lp)"; the vendor and architecture
 *  alone when the browser gives no description */
export function gpuLine(info = {}) {
  const v = String(info.vendor || '').trim(), a = String(info.architecture || '').trim(), d = String(info.description || '').trim();
  const va = [v, a].filter(Boolean).join(', ');
  return d ? (va ? `${d} (${va})` : d) : va || 'not reported by this browser';
}
/** a computer's built-in graphics or a separate card, from what WebGPU reports: 'integrated' | 'discrete' | '' (can't tell).
 *  Intel by its architecture (gen-* and *-lp* are built in, *-hp* are cards) or its name (UHD, Iris, HD Graphics; Arc A / B = a card);
 *  AMD by its name only (a Ryzen's "Radeon(TM) Graphics", "Vega 8", "APU", "integrated"; RX / Pro = a card); NVIDIA = a card. */
export function gpuKind(info = {}) {
  const v = lc(info.vendor), a = lc(info.architecture), d = lc(info.description);
  if (v === 'nvidia') return 'discrete';
  if (v === 'intel') {
    if (/hp/.test(a) || /\barc(\(tm\))? [ab]\d/.test(d)) return 'discrete';
    if (/^gen-\d+(lp)?$/.test(a) || /^xe\d*-lp/.test(a) || /\buhd\b|\biris\b|\bhd graphics\b/.test(d)) return 'integrated';
    return '';
  }
  if (v === 'amd') {
    if (/\brx\b|radeon pro|firepro|instinct/.test(d)) return 'discrete';
    if (/integrated|\bapu\b|radeon(\(tm\))?\s*(graphics|\d{3}m\b)|vega \d/.test(d)) return 'integrated';
    return '';
  }
  return '';
}
/** the browser's own name in Windows' Graphics settings list */
const appName = (browser = '') => (/^Edge\b/.test(browser) ? 'Microsoft Edge' : /^Chrome\b/.test(browser) ? 'Google Chrome' : /^Firefox\b/.test(browser) ? 'Firefox' : 'Google Chrome (or Edge)');
/** the tip for a Windows computer whose browser runs on built-in graphics: Windows' per-app setting picks the card. '' anywhere else
 *  (macOS and Linux: WebGPU gives no sign of a second chip; phones and tablets have one). browser = platform(ua).browser */
export function integratedHint(info = {}, os = '', browser = '') {
  if (os !== 'Windows' || gpuKind(info) !== 'integrated') return '';
  return `This computer may have a faster graphics card. In Windows: Settings › System › Display › Graphics › ${appName(browser)} › Options › High performance, then close and reopen the browser.`;
}
/** the tip's per-device id: the chip and the browser's name (not its version: an update never brings a dismissed tip back) */
export function tipId(info = {}, ua = '') {
  const p = platform(ua);
  return fnv([lc(info.vendor), lc(info.architecture), lc(info.description), p.os, p.browser.split(' ')[0]].join('/'));
}
/** the tip shows in Settings until it is dismissed on this device (dismissed = the TIP_KEY record) */
export const tipDue = (hint, dismissed, id) => !!hint && !(dismissed && dismissed.id === id);

// ------------------------------------------------------------------------------------------------ the results card (plain words)
/** the card's lines: [{ what, state: 'well' | 'slow' | 'no', why }]. r = { f16, wgMemKB, os, e2bTokS, e4bTokS, e4bHere, e4bWhy, picSec,
 *  clipSec }: speeds are this device's measured estimates (GPU time); no memory figure is ever shown. */
export const THRESH = { chatWell: 8, chatSlow: 3, picWell: 180, picSlow: 600, clipWell: 360, clipSlow: 1200 };
export function cardLines(r = {}) {
  const L = [];
  if (!r.f16) {
    const why = r.os === 'Linux' ? 'This graphics chip and browser don’t offer the 16-bit maths p0pc0rn needs. On Linux with an NVIDIA card, Chrome doesn’t offer it yet.'
      : 'This graphics chip and browser don’t offer the 16-bit maths p0pc0rn needs.';
    return [{ what: 'p0pc0rn', state: 'no', why: why + ' Nothing will run here.' }];
  }
  const chat = (n) => (n >= THRESH.chatWell ? 'well' : n >= THRESH.chatSlow ? 'slow' : 'no');
  if (r.e2bTokS != null) L.push({ what: 'Chat with Juli', state: chat(r.e2bTokS), why: chat(r.e2bTokS) === 'no' ? 'Answers would come very slowly here.' : chat(r.e2bTokS) === 'slow' ? 'Answers come, a little slowly.' : 'Answers come quickly.' });
  if (!r.e4bHere) L.push({ what: 'Bigger brain', state: 'no', why: r.e4bWhy ? cap(r.e4bWhy) + '.' : 'Not on this device.' });
  else if (r.e4bTokS != null) L.push({ what: 'Bigger brain', state: chat(r.e4bTokS), why: chat(r.e4bTokS) === 'well' ? 'Writes well here.' : chat(r.e4bTokS) === 'slow' ? 'Writes, a little slowly.' : 'Would be very slow here.' });
  const pic = (s) => (s <= THRESH.picWell ? 'well' : s <= THRESH.picSlow ? 'slow' : 'no');
  if (r.picSec != null) L.push({ what: 'Pictures', state: pic(r.picSec), why: `About ${mins(r.picSec)} for a picture.` });
  const clip = (s) => (s <= THRESH.clipWell ? 'well' : s <= THRESH.clipSlow ? 'slow' : 'no');
  if (r.clipSec != null) L.push({ what: 'Clips', state: clip(r.clipSec), why: `About ${mins(r.clipSec)} for a 2-second clip.` });
  if (r.wgMemKB != null && r.wgMemKB < 32) L.push({ what: 'Faster replies', state: 'no', why: 'This graphics chip has too little fast memory for the add-on that speeds up Juli.' });
  return L;
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
function mins(sec) { if (sec < 90) return `${Math.max(10, Math.round(sec / 10) * 10)} seconds`; const m = Math.round(sec / 60); return m === 1 ? '1 minute' : `${m} minutes`; }
export const STATE_WORD = { well: 'Runs well', slow: 'Runs, slowly', no: 'Won’t run here' };
