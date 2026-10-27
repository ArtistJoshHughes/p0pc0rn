// shell_core.js - p0pc0rn 3.9: the phone-OS shell's pure parts (no DOM, node-testable): the home grid's layout and order, badges, the
// pinned made apps, letter icons, the Browser's address logic and bookmarks, the agentic-app widgets. ui/shell.js draws them.
// Josh (Oct-25): the dock = Juli, Create, Music, Settings; the home screen scrolls up and down (no pages); red number badges; made apps
// may land on the home screen; a Browser icon; a grayed Connection icon.

export const DOCK = ['assistant', 'create', 'music', 'settings'];
export const HOME_ORDER = ['library', 'apps', 'browser', 'games', 'skills', 'connection'];

/** the home grid for a screen `width` CSS px wide: 4 columns on a phone (more on wider screens), the icons spread to the margins; a
 *  phone too narrow for the full icon gets smaller icons, never fewer columns */
export function gridLayout(width, { icon = 62, margin = 24, gapPref = 26, minGap = 14, minCols = 4, maxCols = 8, label = 18, rowGap = 22 } = {}) {
  const W = Math.max(0, width - 2 * margin);
  const cols = Math.min(maxCols, Math.max(minCols, Math.floor((W + gapPref) / (icon + gapPref))));
  let gap = (W - cols * icon) / (cols - 1);
  if (gap < minGap) { gap = minGap; icon = (W - (cols - 1) * minGap) / cols; }
  return { cols, icon, gap, left: margin, label, rowH: icon + label + rowGap };
}
/** the top-left corner of cell i (relative to the grid's box) */
export const cellPos = (g, i) => ({ x: g.left + (i % g.cols) * (g.icon + g.gap), y: Math.floor(i / g.cols) * g.rowH });
/** the slot a dragged icon's centre (x, y, relative to the grid's box) lands on, among n slots */
export function slotAt(g, x, y, n) {
  const col = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.left - g.icon / 2) / (g.icon + g.gap))));
  const row = Math.max(0, Math.floor(y / g.rowH));
  return Math.max(0, Math.min(n - 1, row * g.cols + col));
}

/** a badge's text: '' (none), the count, or 99+ */
export function badgeText(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 1) return '';
  n = Math.floor(n);
  return n > 99 ? '99+' : String(n);
}
export const badgeLabel = (title, n) => { const t = badgeText(n); return t ? `${title}, ${t} new` : title; };

export function moveItem(list, from, to) {
  const a = list.slice();
  if (from < 0 || from >= a.length) return a;
  to = Math.max(0, Math.min(a.length - 1, to));
  const [x] = a.splice(from, 1); a.splice(to, 0, x);
  return a;
}
/** the person's saved order of the home icons, kept for the ids that still exist; new ids follow in their default order */
export function orderIds(saved, available) {
  const have = new Set(available), out = [];
  if (Array.isArray(saved)) for (const id of saved) if (have.has(id) && !out.includes(id)) out.push(id);
  for (const id of available) if (!out.includes(id)) out.push(id);
  return out;
}

// letter icons for pinned made apps: a letter on a colour, no network, no file
export const LETTER_COLORS = ['#5B4BF5', '#E0464E', '#E98A2B', '#2E9C6A', '#1D86B8', '#C23F72', '#7F62E8', '#5F6F80'];
export function letterIcon(name) {
  const s = String(name || '').trim(), m = /[\p{L}\p{N}]/u.exec(s);
  let h = 5381;
  for (const ch of s.toLowerCase()) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return { letter: m ? m[0].toUpperCase() : '?', color: LETTER_COLORS[h % LETTER_COLORS.length] };
}

function store(storage, key) {
  return {
    read() { try { const v = JSON.parse(storage.getItem(key) || 'null'); return Array.isArray(v) ? v : null; } catch (e) { return null; } },
    write(v) { try { storage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode / full: kept in memory for this page */ } },
  };
}
/** the made apps the person put on the home screen: [{id, title, letter, color, ref}] (ref = the app's id in the Apps host) */
export function createPins(storage, key = 'p0pc0rn:home:pins', max = 24) {
  const st = store(storage, key);
  const clean = (p) => {
    const title = String(p.title || '').trim().slice(0, 40) || 'App', li = letterIcon(title);
    return { id: String(p.id), title, letter: String(p.letter || li.letter).slice(0, 2), color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : li.color, ref: p.ref != null ? String(p.ref) : '' };
  };
  let pins = (st.read() || []).filter((p) => p && typeof p.id === 'string' && p.id).map(clean).slice(0, max);
  return {
    list: () => pins.map((p) => Object.assign({}, p)),
    has: (id) => pins.some((p) => p.id === id),
    add(p) {
      if (!p || typeof p.id !== 'string' || !p.id) return false;
      const c = clean(p), i = pins.findIndex((x) => x.id === c.id);
      if (i >= 0) pins[i] = c; else if (pins.length >= max) return false; else pins.push(c);
      st.write(pins); return true;
    },
    remove(id) { pins = pins.filter((p) => p.id !== id); st.write(pins); },
  };
}

// ---- the Browser: words search the web (DuckDuckGo), an address opens; only http(s) ever opens
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d{1,5})?([/?#]\S*)?$/i;
export function browserTarget(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) { try { const u = new URL(s); if (u.protocol === 'https:' || u.protocol === 'http:') return { kind: 'url', url: u.href }; } catch (e) { /* not an address */ } }
  else if (!/\s/.test(s) && DOMAIN.test(s)) { try { new URL('https://' + s); return { kind: 'url', url: 'https://' + s }; } catch (e) { /* */ } }
  return { kind: 'search', url: 'https://duckduckgo.com/?q=' + encodeURIComponent(s) };
}
export const DEFAULT_BOOKMARKS = [
  { title: 'Wikipedia', url: 'https://en.wikipedia.org/' },
  { title: 'p0pc0rn on GitHub', url: 'https://github.com/ArtistJoshHughes/p0pc0rn' },
  { title: 'p0pc0rn-kernels', url: 'https://github.com/ArtistJoshHughes/p0pc0rn-kernels' },
  { title: 'p0pc0rn on X', url: 'https://x.com/p0pc0rnapp' },
];
const sameUrl = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch (e) { return a === b; } };
export function createBookmarks(storage, key = 'p0pc0rn:browser:bookmarks', max = 30) {
  const st = store(storage, key);
  let list = (st.read() || DEFAULT_BOOKMARKS).filter((b) => b && typeof b.url === 'string' && /^https?:\/\//.test(b.url) && b.title).slice(0, max)
    .map((b) => ({ title: String(b.title).slice(0, 60), url: b.url }));
  return {
    list: () => list.map((b) => Object.assign({}, b)),
    add({ title, url } = {}) {
      const t = String(title || '').trim().slice(0, 60), u = browserTarget(url);
      if (!t || !u || u.kind !== 'url' || list.some((b) => sameUrl(b.url, u.url)) || list.length >= max) return false;
      list.push({ title: t, url: u.url }); st.write(list); return true;
    },
    remove(url) { list = list.filter((b) => !sameUrl(b.url, url)); st.write(list); },
  };
}

/** plain words for a time: 'just now', '5 min ago', '3 h ago', '2 days ago', 'in 10 min' */
export function relTime(t, now = Date.now()) {
  if (!t) return '';
  const d = now - t, a = Math.abs(d), fut = d < 0;
  if (a < 60e3) return 'just now';
  const n = a < 3600e3 ? `${Math.round(a / 60e3)} min` : a < 86400e3 ? `${Math.round(a / 3600e3)} h` : (() => { const k = Math.round(a / 86400e3); return `${k} day${k === 1 ? '' : 's'}`; })();
  return fut ? `in ${n}` : `${n} ago`;
}

/** the home screen's cards for apps that work for you (agentic), like notifications (3.9, Josh, Oct-27: "Only with news, swipe away"): a
 *  card only when an app has something for the person (items to review, or a check that needs a look); none for a quiet app (its
 *  "Checked 4 min ago" is in Apps › My apps) or one the person paused. gone = {appId: the app's newsAt when its card was swiped away}:
 *  that card stays away until the app's news is newer (app.newsAt, makeapp/host.js). Those with items to review first. */
export function widgetsOf(apps, skels, now = Date.now(), limit = 4, gone = {}) {
  if (!Array.isArray(apps) || !skels) return [];
  const get = (id) => (typeof skels.get === 'function' ? skels.get(id) : skels[id]);
  const away = gone && typeof gone === 'object' ? gone : {};
  const out = [];
  for (const a of apps) {
    const s = a && get(a.skel), m = s && s.manifest;
    if (!m || m.category !== 'agentic' || a.youPaused) continue;
    const count = Math.max(0, Math.floor(Number(a.badge)) || 0);
    if (!count && !a.lastError) continue;   // quiet: nothing for the person
    const g = away[a.id];
    if (typeof g === 'number' && g > 0 && !((Number(a.newsAt) || 0) > g)) continue;   // swiped away: back only with something new
    out.push({ id: a.id, name: String(a.name || m.name || 'App'), kind: String(m.name || ''), count, line: count ? `${badgeText(count)} to review` : 'Needs a look', app: a });
  }
  return out.map((w, i) => [w, i]).sort((x, y) => (y[0].count - x[0].count) || (x[1] - y[1])).map((x) => x[0]).slice(0, limit);
}
/** the Apps icon's badge: every made app's own badge (an agentic app's items to review, a live app's count) */
export const appsBadge = (apps) => (Array.isArray(apps) ? apps.reduce((s, a) => s + (Math.max(0, Math.floor(Number(a && a.badge)) || 0)), 0) : 0);

/** a home icon -> the screen it opens (the Games icon opens the Apps screen at its Games group) */
export const screenOf = (id) => (id === 'games' ? 'apps' : id);
/** 3.8 opened an existing install on Create and a new install in Juli's chat (her download comes first): 3.9 opens on the home screen,
 *  a new install still in Juli's chat */
export const startTab = (t) => (t === 'assistant' ? 'assistant' : 'home');
// 3.9 shell e0a37a022ea8
