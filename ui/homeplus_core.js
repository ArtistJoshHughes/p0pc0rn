// homeplus_core.js - p0pc0rn 3.9 polish (A1): the pure parts of ui/homeplus.js and the Browser's start page (no DOM, node-testable). The
// art probe (an Image() test with a timeout: any static server answers it, and it can never hang), the Browser's recents and its letter
// tiles, the activity pill's words (an app that works on its own while p0pc0rn is open), and the items of a made app's context menu.

/** does this picture load? An Image() test (a HEAD request is refused with 405 by some static servers), never longer than `ms`.
 *  Img = the Image constructor (a fake one in tests); later = setTimeout */
export function probeImage(url, { Img = globalThis.Image, ms = 8000, later = setTimeout, clear = clearTimeout } = {}) {
  return new Promise((res) => {
    if (typeof Img !== 'function' || !url) return res(false);
    let done = false, t = 0;
    const img = new Img();
    const end = (ok) => { if (done) return; done = true; clear(t); img.onload = img.onerror = null; res(ok); };
    img.onload = () => end(/\.svg(\?|$)/i.test(url) || (img.naturalWidth || 0) > 0);
    img.onerror = () => end(false);
    t = later(() => end(false), ms);
    try { img.decoding = 'async'; } catch (e) { /* an old engine */ }
    img.src = url;
  });
}
/** the icon set the build ships: one check per set -> 'png' (the rendered finals) | 'svg' (the drawn guides) | '' (the sprites) */
export async function artKind(load) {
  if (await load('icons/ui/juli-180.png')) return 'png';
  if (await load('icons/ui/juli.svg')) return 'svg';
  return '';
}

// ---- the Browser: recents (what was searched or opened from its box), newest first
export const RECENTS_KEY = 'p0pc0rn:browser:recents';
export function createRecents(storage, key = RECENTS_KEY, max = 8) {
  const read = () => { try { const v = JSON.parse(storage.getItem(key) || 'null'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const write = (v) => { try { storage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode / full: this page only */ } };
  let list = read().filter((r) => r && typeof r.url === 'string' && /^https?:\/\//.test(r.url) && (r.kind === 'search' || r.kind === 'url'))
    .map((r) => ({ kind: r.kind, text: String(r.text || r.url).slice(0, 200), url: r.url, at: Number(r.at) || 0 })).slice(0, max);
  return {
    list: () => list.map((r) => Object.assign({}, r)),
    /** t = browserTarget(text) ({kind, url}); the same address again moves to the top */
    add(t, text, now = Date.now()) {
      if (!t || !/^https?:\/\//.test(t.url || '')) return false;
      const r = { kind: t.kind === 'url' ? 'url' : 'search', text: String(text || t.url).trim().slice(0, 200) || t.url, url: t.url, at: now };
      list = [r, ...list.filter((x) => x.url !== r.url)].slice(0, max); write(list); return true;
    },
    clear() { list = []; try { storage.removeItem(key); } catch (e) { /* */ } },
  };
}
/** what a recent shows: a search's own words; an address without its scheme (and without a lone trailing slash) */
export function recentLabel(r) {
  if (!r) return '';
  if (r.kind === 'search') return r.text;
  return String(r.url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

// ---- the Browser's favourites: a letter tile per site, coloured by the site (the same site, the same tile), like pinned apps' letters
export const TILE_COLORS = ['#5B4BF5', '#E0464E', '#E98A2B', '#2E9C6A', '#1D86B8', '#C23F72', '#7F62E8', '#5F6F80'];
const SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
/** the name a site goes by: en.wikipedia.org -> wikipedia, github.com -> github, bbc.co.uk -> bbc, x.com -> x */
export function siteName(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
  const p = h.replace(/^www\./, '').split('.').filter(Boolean);
  if (p.length >= 3 && p[p.length - 1].length === 2 && SECOND.has(p[p.length - 2])) return p[p.length - 3];
  return p.length >= 2 ? p[p.length - 2] : p[0] || '';
}
export function siteTile(url, title) {
  const s = siteName(url) || String(title || '').trim().toLowerCase(), m = /[\p{L}\p{N}]/u.exec(s);
  let h = 5381;
  for (const ch of s) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return { letter: m ? m[0].toUpperCase() : '?', color: TILE_COLORS[h % TILE_COLORS.length] };
}

// ---- the activity pill: an app working on its own (window event 'p0:apps', ui/storefront.js / makeapp/host.js)
const SOURCE_WORDS = { 'weather.nws': 'the weather', 'alerts.nws': 'weather alerts', 'geocode.openmeteo': 'places', 'fires.wfigs': 'wildfires', 'prices.coingecko': 'prices', 'chain.snowtrace': 'Avalanche addresses on Snowtrace' };   // 3.9 Wallet Watch: + Snowtrace
/** what a fetch looked up: the event's label ('the weather'; a whole phrase 'looking up the weather' is taken apart), else the source's */
const looked = (s) => String(s.label || SOURCE_WORDS[s.source] || 'something online').replace(/^looking up\s+/i, '') || 'something online';
/** one step in plain words ('looking up the weather', 'asking Juli', ...), or '' for a step nobody needs to see */
export function stepWords(s) {
  if (!s) return '';
  if (s.what === 'fetch') return 'looking up ' + looked(s);
  if (s.what === 'ask') return 'asking Juli';
  if (s.what === 'post') return "posting a note in Juli's chat";
  return '';
}
/** the same step, done (for the list in the sheet) */
export function stepDone(s) {
  if (!s) return '';
  if (s.what === 'fetch') return 'Looked up ' + looked(s);
  if (s.what === 'ask') return 'Asked Juli';
  if (s.what === 'post') return "Posted a note in Juli's chat";
  if (s.what === 'badge') return s.n ? `${s.n} to look at` : 'Nothing to look at';
  return '';
}
/** the pill's state from the events: feed(e) -> the new state (null = nothing to show). Events: check-start, step, check-end; others
 *  are ignored. A step or an end for another app than the one shown starts that app's own state (one app checks at a time). */
export function islandReducer(state, e) {
  if (!e || !e.type) return state;
  const name = String(e.name || 'An app').slice(0, 40);
  if (e.type === 'check-start') return { appId: e.appId, name, phase: 'checking', at: e.at || Date.now(), steps: [], found: 0, ok: true };
  if (e.type === 'step') {
    if (e.what === 'fetch' && e.cached) return state;   // answered from the phone's own copy: nothing went online (the activity log skips it too)
    const st = state && state.appId === e.appId && state.phase === 'checking' ? state : { appId: e.appId, name, phase: 'checking', at: e.at || Date.now(), steps: [], found: 0, ok: true };
    const s = { what: e.what, source: e.source || '', label: e.label || '', n: e.n, at: e.at || Date.now() };
    return Object.assign({}, st, { steps: st.steps.concat(s).slice(-20) });
  }
  if (e.type === 'check-end') {
    const st = state && state.appId === e.appId ? state : { appId: e.appId, name, at: e.at || Date.now(), steps: [] };
    return Object.assign({}, st, { phase: 'done', ok: e.ok !== false, found: Math.max(0, Math.floor(Number(e.found)) || 0), error: e.error ? String(e.error).slice(0, 120) : '', endAt: e.at || Date.now() });
  }
  return state;
}
/** the pill's line: "Trip Watch is checking…", "Trip Watch · looking up the weather", "Trip Watch · found 1 thing to look at" */
export function islandText(st) {
  if (!st) return '';
  if (st.phase === 'done') {
    if (!st.ok) return `${st.name} · couldn’t check this time`;
    return st.found ? `${st.name} · found ${st.found} ${st.found === 1 ? 'thing' : 'things'} to look at` : `${st.name} · nothing new`;
  }
  const last = [...(st.steps || [])].reverse().find((s) => stepWords(s));
  return last ? `${st.name} · ${stepWords(last)}` : `${st.name} is checking…`;
}
/** the sheet's title */
export const islandTitle = (st) => (!st ? '' : st.phase === 'done' ? `What ${st.name} did` : `What ${st.name} is doing`);

// ---- a made app's context menu (a long press on its home-screen icon)
/** -> [{ id, label, icon, danger }] in the order the menu shows them (the app's name is the menu's title) */
export function pinMenuItems({ canChange = true, canShare = true, canDelete = true } = {}) {
  const out = [{ id: 'open', label: 'Open', icon: '#i-chevron' }];
  if (canChange) out.push({ id: 'change', label: 'Change', icon: '#i-pencil' });
  out.push({ id: 'unpin', label: 'Remove from Home Screen', icon: '#i-x' });
  if (canShare) out.push({ id: 'share', label: 'Share', icon: '#i-share' });
  if (canDelete) out.push({ id: 'delete', label: 'Delete', icon: '#i-trash', danger: true });
  out.push({ id: 'edit', label: 'Edit Home Screen', icon: '#i-apps' });
  return out;
}
/** where the menu sits: under the icon when it fits, else above; inside the screen with a 16 px margin. r = the icon's rect */
export function menuPlace(r, menu, view, { gap = 10, margin = 16 } = {}) {
  const below = r.bottom + gap + menu.h <= view.h - margin;
  const top = below ? r.bottom + gap : Math.max(margin, r.top - gap - menu.h);
  const left = Math.min(Math.max(margin, r.left), Math.max(margin, view.w - margin - menu.w));
  return { top: Math.round(top), left: Math.round(left), below };
}
// 3.9 polish (A1)
