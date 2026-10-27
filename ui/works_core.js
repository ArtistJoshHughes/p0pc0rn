// works_core.js - p0pc0rn 3.9 polish: the pure parts (no DOM, node-testable) of the apps that work on their own ("Works for you"): the
// activity log, kept on this phone and capped (what each app did: its checks, what it looked up, Juli's help, its notes in Juli's chat),
// its plain-words summary per day (like a phone's privacy report: "Trip Watch checked 1 trip, found 1 thing to look at. Looked up the
// weather twice."), the pauses (one app, or all of them: makeapp/host.js reads the same key before every check) and which intros were seen.
import { sourceShort, and, times } from './storefront_core.js';

export const ACT_KEY = 'p0pc0rn:apps:activity';
export const PAUSE_KEY = 'p0pc0rn:apps:pause';   // 'all' = Pause all (makeapp/host.js pausedAll())
export const INTRO_KEY = 'p0pc0rn:apps:intro';   // the app designs whose 3-card intro the person has seen
const DAY = 86400e3;

const str = (v, n) => (v == null ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
/** a 'p0:apps' event's detail -> one log entry, or null (not kept) */
export function entryOf(d) {
  if (!d || typeof d !== 'object' || !d.appId) return null;
  const e = { t: Number(d.at) || Date.now(), a: str(d.appId, 60), n: str(d.name, 40) };
  switch (d.type) {
    case 'check-start': return Object.assign(e, { k: 'check' });
    case 'check-end': return Object.assign(e, { k: 'done', c: Math.max(0, Math.floor(+d.found) || 0), ok: d.ok !== false, x: d.error ? str(d.error, 80) : undefined });
    case 'step':
      if (d.what === 'fetch') return Object.assign(e, { k: 'fetch', s: str(d.source, 40), m: d.mode === 'run' ? 'run' : 'check' });
      if (d.what === 'ask') return Object.assign(e, { k: 'ask' });
      if (d.what === 'post') return Object.assign(e, { k: 'post', x: str(d.title, 60) });
      return null;   // badges: the check's end says what is waiting
    case 'added': return Object.assign(e, { k: 'added' });
    case 'removed': return Object.assign(e, { k: 'removed' });
    case 'paused': return Object.assign(e, { k: d.on ? 'paused' : 'resumed' });
    default: return null;
  }
}

/** the log in `storage` (localStorage): at most `max` entries and `days` days; a full storage keeps the newest half */
export function createActivity(storage, { key = ACT_KEY, max = 400, days = 14, now = () => Date.now() } = {}) {
  const read = () => { try { const v = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((e) => e && typeof e.t === 'number' && e.a && e.k) : []; } catch (e) { return []; } };
  let list = read();
  const prune = () => { const cut = now() - days * DAY; list = list.filter((e) => e.t >= cut).slice(-max); };
  const write = () => {   // a full storage: the newest half, then a half of that, until it fits (never the person's other data)
    for (;;) {
      try { storage.setItem(key, JSON.stringify(list)); return; } catch (e) { /* full */ }
      if (list.length <= 1) { list = []; try { storage.removeItem(key); } catch (e) { /* */ } return; }
      list = list.slice(-Math.floor(list.length / 2));
    }
  };
  prune();
  return {
    add(d) { const e = d && d.k ? d : entryOf(d); if (!e) return null; list.push(e); prune(); write(); return e; },
    list({ app = null, since = 0 } = {}) { return list.filter((e) => (!app || e.a === app) && e.t >= since).slice(); },
    clear(app = null) { list = app ? list.filter((e) => e.a !== app) : []; write(); },
    get size() { return JSON.stringify(list).length; },
  };
}

export const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** the days that have entries, newest first, as labels: Today, Yesterday, then the weekday and date */
export function dayLabel(t, now = Date.now()) {
  const d0 = dayStart(now), d = dayStart(t);
  if (d === d0) return 'Today';
  if (d0 - d <= DAY + 3600e3 && d < d0) return 'Yesterday';
  return new Date(d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** one app's day in plain words -> { app, name, checks, found, lookups: [[source, n]], asks, posts, paused, line } (own = the app's own
 *  last line of the day, e.g. "Checked 1 trip: 1 new to look at", from its log in the open app's store) */
export function appDay(entries, app, own = '') {
  const E = entries.filter((e) => e.a === app).sort((x, y) => x.t - y.t);
  if (app === '*') {   // Pause all (the person's own switch): what it was at the end of the day
    const last = E.filter((e) => e.k === 'paused' || e.k === 'resumed').pop(), on = !!last && last.k === 'paused';
    return { app, name: 'All apps', checks: 0, found: 0, lookups: [], asks: 0, posts: 0, paused: on, line: on ? 'You paused all apps (Pause all).' : 'You turned Pause all off: apps work for you again.' };
  }
  const name = (E.find((e) => e.n) || {}).n || 'An app';
  const checks = E.filter((e) => e.k === 'check').length, asks = E.filter((e) => e.k === 'ask').length, posts = E.filter((e) => e.k === 'post').length;
  const ends = E.filter((e) => e.k === 'done'), last = ends[ends.length - 1], found = last ? last.c || 0 : 0;
  const by = new Map(); for (const e of E) if (e.k === 'fetch') by.set(e.s, (by.get(e.s) || 0) + 1);
  const lookups = [...by.entries()];
  const pz = E.filter((e) => e.k === 'paused' || e.k === 'resumed'), paused = pz.length ? pz[pz.length - 1].k === 'paused' : false;
  const parts = [];
  if (own) parts.push(`${name}: ${String(own).replace(/\.$/, '')}.`);
  else if (checks) parts.push(`${name} checked ${times(checks)}${found ? `, found ${found} ${found === 1 ? 'thing' : 'things'} to look at` : ', nothing new to look at'}.`);
  else parts.push(`${name} did not check.`);
  if (own && found) parts.push(`${found} waiting for you.`);
  if (lookups.length) parts.push(`Looked up ${and(lookups.map(([s, n]) => `${sourceShort(s)} ${times(n)}`))}.`);
  if (asks) parts.push(`Asked Juli ${times(asks)}, on this phone.`);
  if (posts) parts.push(`Posted ${posts === 1 ? 'a note' : posts + ' notes'} in Juli’s chat.`);
  if (last && last.ok === false) parts.push('The last check didn’t finish.');
  if (paused) parts.push('Paused by you.');
  return { app, name, checks, found, lookups, asks, posts, paused, line: parts.join(' ') };
}
/** the report: days (newest first), each with its apps' lines -> [{ day, label, apps: [appDay] }] */
export function report(entries, { now = Date.now(), own = {} } = {}) {
  const days = new Map();
  for (const e of entries) { const d = dayStart(e.t); if (!days.has(d)) days.set(d, []); days.get(d).push(e); }
  return [...days.keys()].sort((a, b) => b - a).map((d) => {
    const E = days.get(d), apps = [...new Set(E.map((e) => e.a))];
    const today = d === dayStart(now);
    return { day: d, label: dayLabel(d, now), apps: apps.map((a) => appDay(E, a, today ? own[a] || '' : '')).sort((x, y) => (y.found - x.found) || (y.checks - x.checks)) };
  });
}

/** a running check's live step, in plain words ("looking up the weather") */
export function stepText(d) {
  if (!d) return '';
  if (d.what === 'fetch') return `looking up ${sourceShort(d.source)}`;
  if (d.what === 'ask') return 'asking Juli, on this phone';
  if (d.what === 'post') return 'posting a note in Juli’s chat';
  if (d.what === 'badge') return d.n ? `found ${d.n} to look at` : 'nothing new to look at';
  return 'checking';
}

// ---- pauses and intros (localStorage; makeapp/host.js reads PAUSE_KEY itself before every check)
export const pausedAll = (storage) => { try { return storage.getItem(PAUSE_KEY) === 'all'; } catch (e) { return false; } };
export const setPausedAll = (storage, on) => { try { if (on) storage.setItem(PAUSE_KEY, 'all'); else storage.removeItem(PAUSE_KEY); } catch (e) { /* this page only */ } return !!on; };
export function introSeen(storage, id) { try { return (JSON.parse(storage.getItem(INTRO_KEY) || '[]') || []).includes(id); } catch (e) { return false; } }
export function markIntro(storage, id) {
  try { const l = JSON.parse(storage.getItem(INTRO_KEY) || '[]') || []; if (!l.includes(id)) { l.push(id); storage.setItem(INTRO_KEY, JSON.stringify(l.slice(-100))); } } catch (e) { /* */ }
}
