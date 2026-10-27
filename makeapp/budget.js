// budget.js - p0pc0rn 3.9 (Wallet Watch): a HARD CAP on the requests p0pc0rn sends to a source with a free tier. p0pc0rn keeps well inside
// the free plan's rules: half of the free allocation, with the provider's attribution and links, and apps that look rarely and only when
// the phone is idle, because a non-commercial app that gives no trading advice never needs an address checked every second, and the
// phone's own work for the person comes first. Snowtrace's API (run by Routescan) is free
// without a key or an account at 2 requests a second and 10,000 a day (routescan.io/docs, Plans and limits, Oct 2026). The host's fetcher
// (makeapp/sources.js) asks take() before EVERY request to such a source, so the cap covers every app and every copy of an app on this
// phone together, and no app can get around it (apps have no network of their own). p0pc0rn keeps to half the free limits:
//   - one request a second and 60 a minute: two token buckets, in memory (per page);
//   - 5,000 a day for every app together: a counter kept in localStorage ('p0pc0rn:quota:<key>'), so it survives reloads; the day is the
//     UTC day (the API does not say which day it counts, so its day starts again at midnight UTC);
//   - 1,600 a day for any one app (the same record, per app): Wallet Watch's own worst case at its floor (5 wallets, a check every 15
//     minutes for 24 hours: 96 x 16 + 30 = 1,566), so one app can never use more than a third of the day's cap.
// A refused request is never sent. After a 429 (or the API's own "rate limit" answer) the source rests: 1 minute, then 2, 4 ... up to an
// hour (kept in storage too: a reload never bursts), and the next answer that works ends the rest. Never a retry in a burst.
// Pure: no DOM; the storage and the clock are passed in (node tests).

/** Routescan's keyless free tier (Snowtrace's API), and p0pc0rn's own caps for it: half, and a ceiling for one app */
export const SNOWTRACE_FREE = { perSecond: 2, perDay: 10000 };
export const SNOWTRACE_CAP = { key: 'snowtrace', name: 'Snowtrace', perSec: 1, perMin: 60, perDay: 5000, perApp: 1600, freePerDay: SNOWTRACE_FREE.perDay, freePerSec: SNOWTRACE_FREE.perSecond };
export const BACKOFF = { first: 60e3, max: 3600e3 };

export const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
export const nextUtcMidnight = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
const keyOf = (cfg) => 'p0pc0rn:quota:' + String((cfg && cfg.key) || 'source').replace(/[^\w-]/g, '').slice(0, 40);
const nat = (v) => (Number.isFinite(+v) && +v > 0 ? Math.ceil(+v) : 0);   // a count from storage: never below 0, a fraction rounds up
const appKey = (scope) => String(scope == null ? '' : scope).replace(/[^\w-]/g, '').slice(0, 60);   // an app's id ('' = no app: the all-apps cap only)
function cleanApps(o) {   // today's count per app: at most 40 apps, never a negative or odd count
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 40)) { const a = appKey(k); if (a && a === k) out[a] = nat(v); }
  return out;
}

/** the stored day record -> {day, n, n429, until, level, apps}; anything odd reads as a fresh day (never as a bigger allowance) */
function clean(v, day) {
  const o = v && typeof v === 'object' ? v : {};
  const rest = { until: nat(o.until), level: Math.min(20, nat(o.level)) };   // a rest outlives the day it began in
  return o.day === day ? Object.assign({ day, n: nat(o.n), n429: nat(o.n429), apps: cleanApps(o.apps) }, rest) : Object.assign({ day, n: 0, n429: 0, apps: {} }, rest);
}
function readRaw(store, k) { try { const s = store && store.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

/** createBudget({key, name, perSec, perMin, perDay, perApp}, {store, now}) -> {take, note429, noteOk, usage}. store = localStorage (null:
 *  this page only). take(scope) (scope = the asking app's id) -> {ok: true, used} or {ok: false, code: 'RATE_LIMIT' | 'DAILY_CAP' |
 *  'APP_CAP' | 'BACKOFF', waitMs, until}: a refused take counts nothing and must not be followed by a request. */
export function createBudget(cfg, { store = null, now = () => Date.now(), backoff = BACKOFF } = {}) {
  const C = Object.assign({}, SNOWTRACE_CAP, cfg || {}), K = keyOf(C);
  let mem = null;   // when storage refuses (private mode, full): this page only
  const read = (t) => clean(store ? readRaw(store, K) || mem : mem, utcDay(t));
  const write = (s) => { mem = s; if (!store) return; try { store.setItem(K, JSON.stringify(s)); } catch (e) { /* this page only */ } };
  const bucket = (perMs, cap) => ({ tokens: cap, at: now(), perMs, cap });
  const sec = bucket(C.perSec / 1000, C.perSec), min = bucket(C.perMin / 60000, C.perMin);
  const refill = (b, t) => { if (t > b.at) { b.tokens = Math.min(b.cap, b.tokens + (t - b.at) * b.perMs); b.at = t; } };
  const waitFor = (b) => Math.max(1, Math.ceil((1 - b.tokens) / b.perMs));
  function take(scope = '') {
    const t = now(), s = read(t), a = appKey(scope);
    if (s.until > t) return { ok: false, code: 'BACKOFF', waitMs: s.until - t, until: s.until };
    if (s.n >= C.perDay) { const u = nextUtcMidnight(t); return { ok: false, code: 'DAILY_CAP', waitMs: u - t, until: u }; }
    if (a && C.perApp && (s.apps[a] || 0) >= C.perApp) { const u = nextUtcMidnight(t); return { ok: false, code: 'APP_CAP', waitMs: u - t, until: u }; }
    refill(sec, t); refill(min, t);
    if (min.tokens < 1) { const w = waitFor(min); return { ok: false, code: 'RATE_LIMIT', waitMs: w, until: t + w }; }
    if (sec.tokens < 1) { const w = waitFor(sec); return { ok: false, code: 'RATE_LIMIT', waitMs: w, until: t + w }; }
    sec.tokens -= 1; min.tokens -= 1; s.n += 1;
    if (a) { if (!(a in s.apps) && Object.keys(s.apps).length >= 40) delete s.apps[Object.keys(s.apps)[0]]; s.apps[a] = (s.apps[a] || 0) + 1; }
    write(s);
    return { ok: true, used: s.n };
  }
  function note429() {   // the source said "too many": rest, longer each time in a row
    const t = now(), s = read(t);
    s.level = Math.min(20, s.level + 1); s.n429 += 1;
    s.until = t + Math.min(backoff.max, backoff.first * 2 ** (s.level - 1));
    write(s);
  }
  function noteOk() { const t = now(), s = read(t); if (s.level || s.until) { s.level = 0; s.until = 0; write(s); } }
  const usage = (scope = '') => usageOf(C, read(now()), now(), scope);
  return { take, note429, noteOk, usage, cfg: C };
}

function usageOf(C, s, t, scope = '') {
  const resetAt = nextUtcMidnight(t), rest = s.until > t ? s.until : 0, a = appKey(scope), mine = a ? s.apps[a] || 0 : 0;
  return { day: s.day, used: s.n, cap: C.perDay, left: Math.max(0, C.perDay - s.n), n429: s.n429, resetAt, backoffUntil: rest,
    appUsed: mine, appCap: C.perApp || 0, appLeft: C.perApp ? Math.max(0, C.perApp - mine) : 0,
    paused: rest ? 'backoff' : s.n >= C.perDay ? 'day' : a && C.perApp && mine >= C.perApp ? 'app' : null };
}
/** what is in storage now, without a budget (the host's checks, the settings page); scope = an app's id for its own share */
export function readUsage(cfg, store, t = Date.now(), scope = '') {
  const C = Object.assign({}, SNOWTRACE_CAP, cfg || {});
  return usageOf(C, clean(readRaw(store, keyOf(C)), utcDay(t)), t, scope);
}
/** null, or why no request can go now and until when: {code: 'DAILY_CAP' | 'APP_CAP' | 'BACKOFF', until} (a check is skipped then: no
 *  frame starts) */
export function pausedFor(cfg, store, t = Date.now(), scope = '') {
  const u = readUsage(cfg, store, t, scope);
  return u.paused === 'backoff' ? { code: 'BACKOFF', until: u.backoffUntil } : u.paused === 'day' ? { code: 'DAILY_CAP', until: u.resetAt }
    : u.paused === 'app' ? { code: 'APP_CAP', until: u.resetAt } : null;
}

const n0 = (n) => Math.round(n).toLocaleString('en-US');
/** "5:00 PM", or "tomorrow at 1:00 AM" when the time falls on the next day of this phone */
export function whenText(until, t = Date.now()) {
  const d = new Date(until), n = new Date(t), hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === n.toDateString() ? hm : `tomorrow at ${hm}`;
}
/** the line an app's card shows while its source rests */
export function pauseLine(cfg, p, t = Date.now()) {
  const name = (cfg && cfg.name) || 'the source';
  if (!p) return '';
  return p.code === 'BACKOFF' ? `Resting until ${whenText(p.until, t)}: ${name} asked p0pc0rn to slow down`
    : `Paused until ${whenText(p.until, t)} to stay within ${name}’s free limit`;
}
/** the settings page's row: {text: "Snowtrace requests today: 412 of 5,000", sub} (scope = the app's id: its own share too) */
export function quotaRow(cfg, store, t = Date.now(), scope = '') {
  const C = Object.assign({}, SNOWTRACE_CAP, cfg || {}), u = readUsage(C, store, t, scope);
  const free = C.freePerDay ? ` p0pc0rn sends at most ${n0(C.perSec)} a second and stops at half of ${C.name}’s free limit (${n0(C.freePerDay)} a day).` : '';
  const p = pausedFor(C, store, t, scope);
  return { text: `${C.name} requests today: ${n0(u.used)} of ${n0(u.cap)}`,
    sub: (p ? pauseLine(C, p, t) + '. ' : '') + (scope && C.perApp ? `This app: ${n0(u.appUsed)} of ${n0(C.perApp)}. ` : '')
      + `Shared by all your apps that use ${C.name}; it starts again at ${whenText(u.resetAt, t)} (midnight UTC).${free}`
      + (u.n429 ? ` ${C.name} asked it to slow down ${u.n429 === 1 ? 'once' : u.n429 + ' times'} today.` : '') };
}
