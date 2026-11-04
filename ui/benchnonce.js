// benchnonce.js - 4.0 (review): a bench page (games/trolley/index.html, ui/voicebench.html) starts or continues a run only when the
// app's own bench button sent it there. The button keeps a one-time nonce in this tab's sessionStorage just before it navigates; the page
// takes it once (and removes it) and must find the same nonce in its own address (?n=). A link from anywhere else cannot start a bench.
// The desk's automation (?test on 127.0.0.1 / localhost only) is the one exception, as for ?clamp.
export const BENCH_NONCE_KEY = 'p0pc0rn:bench:nonce';

/** a new run's nonce: 16 hex characters from the browser's random source */
export function freshNonce() {
  try { const b = new Uint8Array(8); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
}
/** the bench button: keep `n` for the page it is about to open (this tab only) */
export function armBench(n) { try { sessionStorage.setItem(BENCH_NONCE_KEY, String(n)); return true; } catch (e) { return false; } }

const local = () => { try { return /^(?:127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname); } catch (e) { return false; } };
/** the bench page: may it start (or continue) the run `n`? true once per arming, then the nonce is gone */
export function takeBench(n, { test = false } = {}) {
  let ok = false;
  try { const s = sessionStorage.getItem(BENCH_NONCE_KEY); if (s && n && s === String(n)) { ok = true; sessionStorage.removeItem(BENCH_NONCE_KEY); } } catch (e) { /* no storage: no start */ }
  return ok || (!!test && local());
}
