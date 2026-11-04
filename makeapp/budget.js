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
// v4 (Josh, Nov 1): Snowtrace's minute is SHARED while two or more apps use it at once (share: each app that sent a request in the last
// minute gets an equal part of perMin, so a manual Token Watch tap never starves Wallet Watch's check, nor the other way round); an app
// using it alone has the whole minute. A refused request (code SHARE) is never sent and never retried by itself.
// v4 (Token Watch): the same cap for the four keyless sources Token Watch reads (DEX Screener, GeckoTerminal, GoPlus, RugCheck), each
// with an HOURLY cap as well (perHour: the UTC clock hour, kept in the same record), all far below what each one documents; and the
// spacing of a look (createSpacing): one chain is looked at most every 5 minutes, whatever asks, also across a reload.
// v4 (security review, Oct-30; Josh: "correct the route scan issue"): the promise to Routescan is per DEVICE, but storage is per
// browsing context: on an iPhone the Home Screen app and a Safari tab (and each extra Home Screen copy) keep separate storage, so each
// counted its own 5,000. Storage can't be shared across them, so the promise holds another way:
//   - Snowtrace is read ONLY in p0pc0rn opened from the Home Screen (installed: display-mode standalone; sources.js installedOnly): a
//     Safari tab, or any browser tab, gets none and says to open p0pc0rn from the Home Screen;
//   - each copy keeps to a QUARTER of the free allocation (SNOWTRACE_CAP: one request every 2 s, 30 a minute, 2,500 a day), so even two
//     copies on one phone (two Home Screen icons, or an installed app in two browsers) stay within the half Josh promised.
// Pure: no DOM; the storage and the clock are passed in (node tests).

/** Routescan's keyless free tier (Snowtrace's API), and p0pc0rn's own caps for it. v4: per COPY of p0pc0rn a quarter of the free tier
 *  (copies: 2 -> two copies on one phone together stay at half), and a ceiling for one app (Wallet Watch's worst case at its floor) */
export const SNOWTRACE_FREE = { perSecond: 2, perDay: 10000 };
export const SNOWTRACE_COPIES = 2;   // the copies on one device the cap is sized for (each its own storage: Home Screen icons, browsers)
export const SNOWTRACE_CAP = { key: 'snowtrace', name: 'Snowtrace', perSec: 0.5, perMin: 30, perDay: 2500, perApp: 1600, share: true, copies: SNOWTRACE_COPIES, freePerDay: SNOWTRACE_FREE.perDay, freePerSec: SNOWTRACE_FREE.perSecond };
export const BACKOFF = { first: 60e3, max: 3600e3 };
/** v4 (Token Watch): its four sources, keyless, and p0pc0rn's own caps for each (one record per source for every app on this phone).
 *  DEX Screener documents 60 requests a minute for its token-profiles and token-boosts lists and 300 a minute for its token lookups
 *  (docs.dexscreener.com); GeckoTerminal rate-limits its free API (it answered 429 at about 24 requests a minute on Nov 1 2026); GoPlus
 *  and RugCheck answered keyless. Their terms, checked 2026-11-03: DEX Screener's API Terms (Aug 18 2023) allow commercial and
 *  non-commercial use, forbid a product whose primary purpose is to compete directly with it and making the API available to third
 *  parties (revocable; no attribution required); GoPlus's API License Agreement (marked "old") makes the API free and asks for
 *  "Powered by GoPlus Security" with a link where its data shows; RugCheck and GeckoTerminal publish no API terms we found. p0pc0rn
 *  stops using any service that objects. p0pc0rn keeps every one of them
 *  far below: DEX Screener at most 120 an HOUR (each shown token needs one look at all its pairs, to tell a graduated token from one on a
 *  bonding curve and when it really launched), GeckoTerminal 4 a minute, the others at most 36 to 60 an hour. One look sends at most
 *  TOKENWATCH_RULES.perRefresh requests across all four, and each chain is looked at most every 5 minutes (refreshGapMs). */
export const TOKENWATCH_RULES = { perRefresh: 12, refreshGapMs: 5 * 60e3, floorUsd: 5000, top: 5, maxChains: 3, hours: [1, 6], keepMs: 5 * 60e3 };
const TW = { perApp: 0, share: false, freePerDay: 0, freePerSec: 0 };
export const DEXSCREENER_CAP = Object.assign({ key: 'dexscreener', name: 'DEX Screener', perSec: 2, perMin: 20, perHour: 120, perDay: 1200, limitNote: 'it documents 60 a minute for its lists and 300 for its token lookups' }, TW);
export const GECKOTERMINAL_CAP = Object.assign({ key: 'geckoterminal', name: 'GeckoTerminal', perSec: 1, perMin: 4, perHour: 36, perDay: 300, limitNote: 'it rate-limits its free API' }, TW);
export const GOPLUS_CAP = Object.assign({ key: 'goplus', name: 'GoPlus', perSec: 1, perMin: 6, perHour: 36, perDay: 300, limitNote: '' }, TW);
export const RUGCHECK_CAP = Object.assign({ key: 'rugcheck', name: 'RugCheck', perSec: 1, perMin: 6, perHour: 60, perDay: 500, limitNote: '' }, TW);

/** v4 (the scheduler, Josh Nov 1: "if multiple apps are calling APIs ... Juli can schedule all jobs"): ONE budget per source for every
 *  app on this phone, at or below the strictest limit its maker documents (a source's `shared`, in sources.js: no quota on its answers,
 *  no row on an app's settings page, never a rest for a check; a refused request waits for its window; Diagnostics counts the calls). CoinGecko's keyless public API about 5 to 15 a minute (the strictest: 5); the National Weather Service and NIFC's ArcGIS service
 *  document no number, so p0pc0rn stays small. One key per host: the NWS forecast and its alerts share theirs. */
const QUIET = { perApp: 0, share: false, freePerDay: 0, freePerSec: 0, quiet: true };
export const NWS_CAP = Object.assign({ key: 'nws', name: 'the National Weather Service', perSec: 1, perMin: 10, perHour: 240, perDay: 2000, limitNote: 'it documents no number and asks for reasonable use' }, QUIET);
export const COINGECKO_CAP = Object.assign({ key: 'coingecko', name: 'CoinGecko', perSec: 1, perMin: 5, perHour: 120, perDay: 1000, limitNote: 'its keyless API allows about 5 to 15 a minute' }, QUIET);
export const WFIGS_CAP = Object.assign({ key: 'wfigs', name: 'NIFC WFIGS', perSec: 1, perMin: 6, perHour: 120, perDay: 1000, limitNote: 'it documents no number' }, QUIET);

/** v4 (Token Watch's name references): the lookups an app's Bigger brain job makes through Juli's research lane (Wikipedia, then
 *  Fandom), one budget for every app: far below what either asks of an API client */
export const REFLOOKUP_CAP = Object.assign({ key: 'reflookups', name: 'Wikipedia and Fandom (apps)', perSec: 1, perMin: 6, perHour: 60, perDay: 300, limitNote: '' }, QUIET);

export const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
export const nextUtcMidnight = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
export const utcHour = (t) => new Date(t).toISOString().slice(0, 13);   // v4 (Token Watch): '2026-11-01T14'
export const nextUtcHour = (t) => Math.floor(t / 3600e3) * 3600e3 + 3600e3;
const keyOf = (cfg) => 'p0pc0rn:quota:' + String((cfg && cfg.key) || 'source').replace(/[^\w-]/g, '').slice(0, 40);
const nat = (v) => (Number.isFinite(+v) && +v > 0 ? Math.ceil(+v) : 0);   // a count from storage: never below 0, a fraction rounds up
const appKey = (scope) => String(scope == null ? '' : scope).replace(/[^\w-]/g, '').slice(0, 60);   // an app's id ('' = no app: the all-apps cap only)
function cleanApps(o) {   // today's count per app: at most 40 apps, never a negative or odd count
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 40)) { const a = appKey(k); if (a && a === k) out[a] = nat(v); }
  return out;
}

/** the stored day record -> {day, n, n429, until, level, apps, hour, nh}; anything odd reads as a fresh day (never as a bigger allowance).
 *  v4 (Token Watch): nh = the requests in the UTC hour `hour` (a new hour counts from 0) */
function clean(v, day, hour = '') {
  const o = v && typeof v === 'object' ? v : {};
  const rest = { until: nat(o.until), level: Math.min(20, nat(o.level)), hour, nh: hour && o.hour === hour ? nat(o.nh) : 0 };   // a rest outlives the day it began in
  return o.day === day ? Object.assign({ day, n: nat(o.n), n429: nat(o.n429), apps: cleanApps(o.apps) }, rest) : Object.assign({ day, n: 0, n429: 0, apps: {} }, rest);
}
function readRaw(store, k) { try { const s = store && store.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

/** createBudget({key, name, perSec, perMin, perDay, perApp}, {store, now}) -> {take, note429, noteOk, usage}. store = localStorage (null:
 *  this page only). take(scope) (scope = the asking app's id) -> {ok: true, used} or {ok: false, code: 'RATE_LIMIT' | 'DAILY_CAP' |
 *  'APP_CAP' | 'BACKOFF' | 'SHARE', waitMs, until}: a refused take counts nothing and must not be followed by a request. cfg.share: the
 *  minute is split equally between the apps that sent a request in the last minute (alone: the whole minute) */
export function createBudget(cfg, { store = null, now = () => Date.now(), backoff = BACKOFF } = {}) {
  const C = Object.assign({}, SNOWTRACE_CAP, cfg || {}), K = keyOf(C);
  let mem = null;   // when storage refuses (private mode, full): this page only
  const read = (t) => clean(store ? readRaw(store, K) || mem : mem, utcDay(t), utcHour(t));
  const write = (s) => { mem = s; if (!store) return; try { store.setItem(K, JSON.stringify(s)); } catch (e) { /* this page only */ } };
  const bucket = (perMs, cap) => ({ tokens: cap, at: now(), perMs, cap });
  const sec = bucket(C.perSec / 1000, Math.max(1, C.perSec)), min = bucket(C.perMin / 60000, C.perMin);   // v4: a rate under one a second (Snowtrace: one every 2 s) still holds one request
  const refill = (b, t) => { if (t > b.at) { b.tokens = Math.min(b.cap, b.tokens + (t - b.at) * b.perMs); b.at = t; } };
  const waitFor = (b) => Math.max(1, Math.ceil((1 - b.tokens) / b.perMs));
  const lastMin = new Map();   // v4 (share): app -> its request times in the last minute (this page)
  function shareOf(a, t) {   // -> null, or why this app waits for its part of the minute
    for (const [k, l] of lastMin) { const f = l.filter((x) => t - x < 60e3); if (f.length) lastMin.set(k, f); else lastMin.delete(k); }
    const n = new Set([...lastMin.keys(), a]).size, mine = lastMin.get(a) || [];
    if (n < 2 || mine.length < Math.ceil(C.perMin / n)) return null;
    const u = mine[0] + 60e3; return { ok: false, code: 'SHARE', waitMs: u - t, until: u };
  }
  function take(scope = '') {
    const t = now(), s = read(t), a = appKey(scope);
    if (s.until > t) return { ok: false, code: 'BACKOFF', waitMs: s.until - t, until: s.until };
    if (s.n >= C.perDay) { const u = nextUtcMidnight(t); return { ok: false, code: 'DAILY_CAP', waitMs: u - t, until: u }; }
    if (a && C.perApp && (s.apps[a] || 0) >= C.perApp) { const u = nextUtcMidnight(t); return { ok: false, code: 'APP_CAP', waitMs: u - t, until: u }; }
    if (C.perHour && s.nh >= C.perHour) { const u = nextUtcHour(t); return { ok: false, code: 'HOUR_CAP', waitMs: u - t, until: u }; }   // v4 (Token Watch)
    if (C.share && a) { const w = shareOf(a, t); if (w) return w; }   // v4: another app is using it too: this app's part of the minute is spent
    refill(sec, t); refill(min, t);
    if (min.tokens < 1) { const w = waitFor(min); return { ok: false, code: 'RATE_LIMIT', waitMs: w, until: t + w }; }
    if (sec.tokens < 1) { const w = waitFor(sec); return { ok: false, code: 'RATE_LIMIT', waitMs: w, until: t + w }; }
    sec.tokens -= 1; min.tokens -= 1; s.n += 1; s.nh += 1;
    if (a) { if (!(a in s.apps) && Object.keys(s.apps).length >= 40) delete s.apps[Object.keys(s.apps)[0]]; s.apps[a] = (s.apps[a] || 0) + 1; }
    if (C.share && a) { const l = lastMin.get(a) || []; l.push(t); lastMin.set(a, l); if (lastMin.size > 40) lastMin.delete(lastMin.keys().next().value); }
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
    hourUsed: s.nh || 0, hourCap: C.perHour || 0, hourResetAt: nextUtcHour(t),   // v4 (Token Watch)
    paused: rest ? 'backoff' : s.n >= C.perDay ? 'day' : a && C.perApp && mine >= C.perApp ? 'app' : C.perHour && s.nh >= C.perHour ? 'hour' : null };
}
/** what is in storage now, without a budget (the host's checks, the settings page); scope = an app's id for its own share */
export function readUsage(cfg, store, t = Date.now(), scope = '') {
  const C = Object.assign({}, SNOWTRACE_CAP, cfg || {});
  return usageOf(C, clean(readRaw(store, keyOf(C)), utcDay(t), utcHour(t)), t, scope);
}
/** null, or why no request can go now and until when: {code: 'DAILY_CAP' | 'APP_CAP' | 'BACKOFF', until} (a check is skipped then: no
 *  frame starts) */
export function pausedFor(cfg, store, t = Date.now(), scope = '') {
  const u = readUsage(cfg, store, t, scope);
  return u.paused === 'backoff' ? { code: 'BACKOFF', until: u.backoffUntil } : u.paused === 'day' ? { code: 'DAILY_CAP', until: u.resetAt }
    : u.paused === 'app' ? { code: 'APP_CAP', until: u.resetAt } : u.paused === 'hour' ? { code: 'HOUR_CAP', until: u.hourResetAt } : null;
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
    : p.code === 'HOUR_CAP' ? `Paused until ${whenText(p.until, t)} to stay within p0pc0rn’s hourly cap for ${name}`   // v4 (Token Watch)
    : `Paused until ${whenText(p.until, t)} to stay within ${name}’s free limit`;
}
/** the settings page's row: {text: "Snowtrace requests today: 412 of 5,000", sub} (scope = the app's id: its own share too) */
export function quotaRow(cfg, store, t = Date.now(), scope = '') {
  const C = Object.assign({}, SNOWTRACE_CAP, cfg || {}), u = readUsage(C, store, t, scope);
  const rate = C.perSec >= 1 ? `${n0(C.perSec)} a second` : `one every ${n0(1 / C.perSec)} seconds`;
  const free = C.freePerDay ? (C.copies > 1 ? ` This copy of p0pc0rn sends at most ${rate} and stops at ${n0(C.perDay)} a day, a ${C.copies === 2 ? 'quarter' : 'part'} of ${C.name}’s free limit (${n0(C.freePerDay)} a day), so even ${C.copies} copies on one phone stay within half. It reads ${C.name} only when opened from the Home Screen.`
    : ` p0pc0rn sends at most ${rate} and stops at half of ${C.name}’s free limit (${n0(C.freePerDay)} a day).`) : '';
  const p = pausedFor(C, store, t, scope);
  if (C.perHour) return { text: `${C.name} requests this hour: ${n0(u.hourUsed)} of ${n0(C.perHour)}`,   // v4 (Token Watch): the hourly cap first
    sub: (p ? pauseLine(C, p, t) + '. ' : '') + `Today: ${n0(u.used)} of ${n0(u.cap)}, shared by all your apps that use ${C.name}; the hour starts again at ${whenText(u.hourResetAt, t)}.`
      + (C.limitNote ? ` p0pc0rn stays far below what ${C.name} allows (${C.limitNote}).` : '') + (u.n429 ? ` ${C.name} asked it to slow down ${u.n429 === 1 ? 'once' : u.n429 + ' times'} today.` : '') };
  return { text: `${C.name} requests today: ${n0(u.used)} of ${n0(u.cap)}`,
    sub: (p ? pauseLine(C, p, t) + '. ' : '') + (scope && C.perApp ? `This app: ${n0(u.appUsed)} of ${n0(C.perApp)}. ` : '')
      + `Shared by all your apps that use ${C.name}; it starts again at ${whenText(u.resetAt, t)} (midnight UTC).${free}`
      + (u.n429 ? ` ${C.name} asked it to slow down ${u.n429 === 1 ? 'once' : u.n429 + ' times'} today.` : '') };
}

/** v4 (Token Watch): the spacing of a look. createSpacing({key, gapMs}, {store, now}) -> {check(scope, item), mark(scope, item), last}: an
 *  item (a chain) is looked at most once every gapMs for one app (scope), whatever asks (the open app, a check, Watch closely), and the
 *  time is kept in storage ('p0pc0rn:looks:<key>'), so a reload never makes a look sooner. check -> {ok: true} or {ok: false, code:
 *  'TOO_SOON', until}. A stored time in the future reads as no look (never as a longer wait). */
export function createSpacing(cfg, { store = null, now = () => Date.now() } = {}) {
  const gap = Math.max(1000, +(cfg && cfg.gapMs) || TOKENWATCH_RULES.refreshGapMs);
  const K = 'p0pc0rn:looks:' + String((cfg && cfg.key) || 'source').replace(/[^\w-]/g, '').slice(0, 40);
  const ik = (v) => String(v == null ? '' : v).replace(/[^\w-]/g, '').slice(0, 60);
  let mem = {};
  const read = () => { const v = (store ? readRaw(store, K) : null) || mem; return v && typeof v === 'object' ? v : {}; };
  const last = (scope, item) => { const t = now(), r = read(), at = nat((r[ik(scope)] || {})[ik(item)]); return at && at <= t ? at : 0; };
  function check(scope, item) { const at = last(scope, item), t = now(); return at && t - at < gap ? { ok: false, code: 'TOO_SOON', until: at + gap } : { ok: true }; }
  function mark(scope, item) {
    const r = read(), s = ik(scope), t = now(), out = {};
    for (const [k, v] of Object.entries(r).filter(([k]) => k !== s).slice(-39)) if (v && typeof v === 'object') out[k] = v;   // at most 40 apps
    const mine = Object.assign({}, r[s] && typeof r[s] === 'object' ? r[s] : {}); mine[ik(item)] = t;
    for (const [k, v] of Object.entries(mine)) if (!(nat(v) > t - 864e5)) delete mine[k];   // only the last day's
    out[s] = mine; mem = out;
    if (store) { try { store.setItem(K, JSON.stringify(out)); } catch (e) { /* this page only */ } }
  }
  return { check, mark, last, gapMs: gap };
}
