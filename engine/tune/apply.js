// apply.js - p0pc0rn v4 autotune: put this device's tune into the decode kernels when an engine creates its GPU (llm_engine.js _gpu;
// the split's worker gets the page's state in its init). The order (tunecore.resolve): measured on this device (the same key: GPU,
// browser, OS, app and kernel versions) -> the known table for this GPU family -> what ships. Synchronous; never throws.
import { setPicks, KERNEL_VERSION } from '../llm/lopsx.js';
import { setAD } from '../llm/lopsd.js';
import { STORE_KEY, tuneKey, resolve } from './tunecore.js';

export const TUNE = { source: 'shipped', key: null, family: null, app: '' };
/** the app's version (part of the key); the app sets it once at start */
export function setAppVersion(v) { TUNE.app = String(v || ''); }
export function readCache() { try { return JSON.parse((globalThis.localStorage && localStorage.getItem(STORE_KEY)) || 'null'); } catch (e) { return null; } }
export function writeCache(r) { try { localStorage.setItem(STORE_KEY, JSON.stringify(r)); return true; } catch (e) { return false; } }
/** the key of this device now, from an engine's Gpu (core/gpu.js) */
export function keyOf(g) {
  const nav = globalThis.navigator || {}, wgsl = nav.gpu && nav.gpu.wgslLanguageFeatures ? [...nav.gpu.wgslLanguageFeatures] : [];
  const feats = g.adapter ? [...g.adapter.features] : g.device ? [...g.device.features] : [];   // the adapter's: the same whatever a device asked for
  return tuneKey({ info: g.info || {}, limits: g.limits || {}, features: feats, wgsl, ua: nav.userAgent || '', app: TUNE.app, kernels: KERNEL_VERSION });
}
/** apply what fits this GPU now -> TUNE ({source: 'measured' | 'family' | 'shipped', ...}) */
export function applyFor(g) {
  try {
    if (globalThis.localStorage && localStorage.getItem('p0pc0rn:test:tune') === '0') { setPicks(null); setAD(null); return Object.assign(TUNE, { source: 'shipped', key: null, family: null }); }
    const key = keyOf(g), r = resolve(readCache(), key, g.info || {});
    setPicks(r.picks); setAD(r.ad);
    return Object.assign(TUNE, { source: r.source, key, family: r.family || null });
  } catch (e) { setPicks(null); setAD(null); return Object.assign(TUNE, { source: 'shipped', key: null, family: null }); }
}
/** a tune just measured here (the pop-up): its choices from now on, in this page (an engine's split worker takes them at its next start) */
export function applyResult(r) { try { setPicks((r && r.picks) || null); setAD((r && r.ad) || null); TUNE.source = r ? 'measured' : 'shipped'; } catch (e) { /* */ } return TUNE; }
