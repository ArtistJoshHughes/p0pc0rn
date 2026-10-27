// storefront_core.js - p0pc0rn 3.9 polish: the pure parts (no DOM, node-testable) of the Apps, Games and Skills screens and of the apps
// that work on their own. Josh (Oct-26): "apps browser games and skills are just text with very little visual polish" and "I am really
// trying to get the always on agent UI/UX to be as seemless as iOS native apps because Ai agents are 'scary' enough already". So every
// app says, in plain words, what it does, when, what it can see and how to stop it; on screen p0pc0rn never says "agentic", "skeleton",
// "slots" or "tools": an app that works on its own "Works for you". ui/storefront.js and ui/works.js draw what this file decides.
import { letterIcon } from './shell_core.js';

/** an app design that works on its own: it checks when p0pc0rn opens and / or on a timer, while p0pc0rn is open */
export const worksAlone = (m) => !!m && Array.isArray(m.triggers) && m.triggers.some((t) => t && (t.type === 'on-open' || t.type === 'interval'));
/** Juli works in it (in its checks) */
export const withJuli = (m) => !!m && Array.isArray((m.permissions || {}).juli) && m.permissions.juli.includes('ask');
export const isGame = (m) => !!m && m.kind === 'game';
export const WORKS = 'Works for you';

/** the online sources in plain words (makeapp/sources.js has the hosts) */
export const PLAIN_SOURCES = {
  'weather.nws': { short: 'the weather', what: 'the weather forecast', who: 'the US National Weather Service' },
  'alerts.nws': { short: 'weather alerts', what: 'weather alerts', who: 'the US National Weather Service' },
  'geocode.openmeteo': { short: 'places', what: 'the places you type', who: 'Open-Meteo place search' },
  'fires.wfigs': { short: 'wildfires', what: 'wildfires near your place', who: 'the US wildfire service (NIFC)' },
  'prices.coingecko': { short: 'prices', what: 'the prices you pick', who: 'CoinGecko' },
  'chain.snowtrace': { short: 'public Avalanche addresses on Snowtrace', what: 'the public activity of the addresses you add', who: 'Snowtrace, the public Avalanche explorer' },   // 3.9 Wallet Watch
};
/** 3.9 Wallet Watch: a source whose data carries its maker's credit (their terms: "Powered by Routescan.io APIs"), with direct links to
 *  its official site and its official X account. p0pc0rn shows them (the permission sheet, the app's settings page, under the running
 *  app) and never fetches them: they open in the phone's own browser sheet. Routescan's X account, @routescan_io: confirmed by Josh from
 *  the verified profile itself (Oct-27); routescan.io's home page lists no social links. -> {line, links: [{text, href, label}]} */
export const SOURCE_CREDITS = {
  'chain.snowtrace': { line: 'Powered by Routescan.io APIs', links: [
    { text: 'routescan.io', href: 'https://routescan.io', label: 'Routescan’s official site, routescan.io' },
    { text: '@routescan_io on X', href: 'https://x.com/routescan_io', label: 'Routescan’s official account on X, @routescan_io' }] },
};
/** the credits a design's sources ask for -> [{line, links}] (each once) */
export const creditsOf = (m) => [...new Set(((m && m.permissions) || {}).online || [])].map((s) => SOURCE_CREDITS[s]).filter(Boolean);
export const sourceShort = (id) => (PLAIN_SOURCES[id] || {}).short || 'a source';

/** "a, b and c" */
export function and(list) {
  const l = (list || []).filter(Boolean);
  return l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
}
/** once, twice, 3 times */
export const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** the first sentence of a description, without its "Fits: …" list (that part is for Juli) */
export function firstSentence(d) {
  const s = String(d || '').replace(/\s+/g, ' ').replace(/\s*Fits:.*$/i, '').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  return (m ? m[1] : s).trim();
}

/** how often it works on its own, in plain words */
export function cadence(m) {
  const T = (m && m.triggers) || [], open = T.some((t) => t && t.type === 'on-open'), iv = T.find((t) => t && t.type === 'interval');
  if (!open && !iv) return '';
  const every = iv ? (iv.minMinutes >= 600 ? 'about twice a day' : iv.minMinutes >= 180 ? 'a few times a day' : iv.minMinutes >= 60 ? 'every few hours' : `at most every ${iv.minMinutes} minutes`) : '';   // 3.9 Wallet Watch: + minutes
  return (open && every ? `when p0pc0rn opens and ${every}` : open ? 'when p0pc0rn opens' : every) + ' while p0pc0rn is open';
}

/** the one sentence a card shows: what it does, when, and what it looks at. manifest.plain when the design has one (every design that
 *  comes with p0pc0rn does), else built from its description and its permissions */
export function plainOf(m) {
  if (!m) return '';
  if (typeof m.plain === 'string' && m.plain.trim()) return m.plain.trim();
  const first = firstSentence(m.description) || String(m.name || 'An app');
  const P = m.permissions || {}, on = (P.online || []).map((s) => (PLAIN_SOURCES[s] || {}).short).filter(Boolean);
  const when = worksAlone(m) ? ` It works on its own ${cadence(m)}.` : ' It works when you open it.';
  const out = on.length ? ` It only looks up ${and([...new Set(on)])}; everything else stays on this phone.` : ' It keeps everything on this phone and never goes online.';
  return (first + when + out).slice(0, 400);
}

/** what it can see, in plain words -> { line, items } (items: what it reads and reaches; the line: one sentence) */
export function seesOf(m) {
  const P = (m && m.permissions) || {}, items = ['only what you add in it'];
  const src = P.online || [];
  for (const s of src) { const p = PLAIN_SOURCES[s]; if (p) items.push(`${p.what} (${p.who})`); }
  if (withJuli(m)) items.push('Juli, on this phone, to read and sum up');
  if (P['chat.post']) items.push('Juli’s chat, to post a short note');
  const loc = P.location === 'device' ? 'Your phone’s location only if you allow it, rounded to about 1 km.' : P.location === 'place' ? 'A place you type, never your phone’s location.' : '';
  const line = `It sees ${and(items)}. ` + (loc ? loc + ' ' : '') + 'Never your photos, Library, Cast or files.';
  return { line, items, never: ['photos', 'Library', 'Cast', 'files'].concat(P.location === 'device' ? [] : ['your phone’s location']) };
}

/** how to stop it, in plain words */
export function stopOf(m) {
  return worksAlone(m) ? 'To stop it, use the Pause switch in its settings, or Pause all. It only works while p0pc0rn is open, and deleting it stops it for good.'
    : 'It only runs while you have it open: close it to stop it, or delete it.';
}
/** the stop line on a made app's card: what stops it, in one short line (the card opens its settings) */
export function stopShort(m) {
  return worksAlone(m) ? 'To stop it: the Pause switch in its settings (tap the card), or delete it.' : 'It only runs while it is open: close it to stop it.';
}
/** what it can see, in one short line ("It reads only what you add and looks up the weather, weather alerts and places") */
export function seesShort(m) {
  const on = [...new Set(((m && m.permissions && m.permissions.online) || []).map((s) => (PLAIN_SOURCES[s] || {}).short).filter(Boolean))];
  return on.length ? `It reads only what you add and looks up ${and(on)}` : 'It reads only what you add and never goes online';
}

/** the iOS-style permission sheet: "<name> would like to:" and one row per thing it asks for -> [{ icon, text, sub }] (the choose line is
 *  the game part's own words, kept as they are) */
export function permRows(m, hosts = {}) {
  const P = (m && m.permissions) || {}, rows = [], host = (s) => hosts[s] || '';
  const online = P.online || [];
  const nws = online.filter((s) => s === 'weather.nws' || s === 'alerts.nws');
  if (nws.length) rows.push({ icon: 'cloud', text: nws.length === 2 ? 'Check the weather and weather alerts' : nws[0] === 'alerts.nws' ? 'Check weather alerts' : 'Check the weather', sub: `For the places you add, from the US National Weather Service (${host(nws[0]) || 'api.weather.gov'}).` });
  for (const s of online) {
    if (s === 'weather.nws' || s === 'alerts.nws') continue;
    if (s === 'chain.snowtrace') {   // 3.9 Wallet Watch: what goes out, plainly, and Routescan's credit with its links
      rows.push({ icon: 'chart', text: 'Look up the addresses you add on Snowtrace', sub: `The addresses you add are sent to Snowtrace, the public Avalanche explorer${host(s) ? ' (' + host(s) + ')' : ''}, to read their public activity: transactions, transfers and balances; once a day, so are a few addresses they deal with most, for their public names. Nothing else: no key, no account, no name.`, credit: SOURCE_CREDITS[s] });
      continue;
    }
    const p = PLAIN_SOURCES[s]; if (!p) continue;
    rows.push({ icon: s === 'geocode.openmeteo' ? 'pin' : s === 'fires.wfigs' ? 'flame' : 'chart', text: s === 'geocode.openmeteo' ? 'Find the places you type' : `Look up ${p.what}`, sub: `From ${p.who}${host(s) ? ' (' + host(s) + ')' : ''}. Only what it needs is sent.` });
  }
  if (withJuli(m)) rows.push({ icon: 'juli', text: 'Ask Juli to read and sum up for it', sub: 'Juli runs on this phone: nothing goes online for this.' });
  if ((P.juli || []).includes('choose')) rows.push({ icon: 'game', text: 'Juli picks her moves in this app (on this phone only)', sub: 'While you have it open, Juli chooses from the moves the app offers. Her own small model loads next to the app and leaves when you close it.' });
  if (P['chat.post']) rows.push({ icon: 'chat', text: 'Post short notes in Juli’s chat', sub: 'Labelled with its name, at most 10 an hour.' });
  if (P.location === 'place') rows.push({ icon: 'pin', text: 'Use a place you type', sub: 'Never your phone’s location.' });
  if (P.location === 'device') rows.push({ icon: 'pin', text: 'Ask for this phone’s location', sub: 'Rounded to about 1 km. Your phone asks you first.' });
  if (worksAlone(m)) rows.push({ icon: 'clock', text: 'Check on its own', sub: `${cadence(m).replace(/^./, (c) => c.toUpperCase())}. Never while p0pc0rn is closed, and never while something is being made.` });
  if (withJuli(m)) rows.push({ icon: 'check', text: 'Bring you what needs your eye', sub: (m.goal ? `Its goal: ${String(m.goal).slice(0, 140).replace(/\.?$/, '.')} ` : '') + 'It only suggests: nothing happens until you confirm.' });
  if (P.storage) rows.push({ icon: 'lock', text: 'Keep its own notes on this phone', sub: 'What you add stays here.' });
  return rows;
}

/** the make preview: the app in one line ("a Daily Counter for glasses: a goal of 8 a day"), from the design and what Juli filled in.
 *  A game is named as its design names it (never a name written here) and has no levels: Juli always plays her best */
export function previewLine(m, slots, name) {
  const S = slots || {}, id = (m && m.id) || '', n = (v) => (Array.isArray(v) ? v.length : 0);
  const title = String(name || S.title || S.app_name || (m && m.name) || 'your app').slice(0, 40), what = String((m && m.name) || 'app');
  let line;
  if (isGame(m)) return `“${title}”, ${title === what ? 'a game' : `a game of ${what}`} against Juli.`;
  switch (id) {
    case 'daily-counter': line = `a counter for ${S.unit || 'something'} with a goal of ${S.goal || 'a number'} a day`; break;
    case 'list-tasks': line = `a to-do list with ${plural(n(S.tasks), 'task')}` + (n(S.lists) > 1 ? ` in ${n(S.lists)} lists` : '') + (n(S.habits) ? ` and ${plural(n(S.habits), 'habit')}` : ''); break;
    case 'flashcards-learn': { const c = (S.decks || []).reduce((k, d) => k + n(d && d.cards), 0); line = `flashcards: ${plural(c, 'card')}` + (n(S.decks) > 1 ? ` in ${n(S.decks)} decks` : ''); break; }
    case 'dashboard-live': line = `a price board with ${plural(n(S.items), 'item')}` + (n(S.items) ? ` (${and((S.items || []).slice(0, 3).map((x) => x && (x.sym || x.name)).filter(Boolean))})` : ''); break;
    case 'tiles-log': line = `a log with ${plural(n(S.tiles), 'tile')}` + (n(S.tiles) ? `: ${and((S.tiles || []).slice(0, 4).map((x) => x && x.label).filter(Boolean))}` : ''); break;
    case 'trip-watch': line = 'a weather watch for your trips: it flags' + ` wind over ${S.wind_mph || 25} mph, rain over ${S.rain_pct || 50}%, heat over ${S.hot_f || 90}°F and cold under ${S.cold_f || 32}°F`; break;
    case 'wallet-watch': line = `a watch for public Avalanche addresses${n(S.addresses) ? ' (' + and((S.addresses || []).slice(0, 3).map((x) => x && x.label).filter(Boolean)) + ')' : ''}, every ${S.interval_min || 30} minutes while p0pc0rn is open and your phone is idle`; break;   // 3.9 Wallet Watch
    case 'weather-alerts': line = 'weather alerts for a place you pick'; break;
    case 'wildfire-watch': line = `a wildfire watch within ${S.radius_mi || 50} miles of a place you pick`; break;
    default: line = `a ${what}`;
  }
  return `“${title}”, ${line}.`;
}

/** the app the person already has from this design: the one opened last (else the newest), or null */
export function yoursOf(apps, skelId) {
  const mine = (apps || []).filter((a) => a && a.skel === skelId);
  if (!mine.length) return null;
  return mine.slice().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0))[0];
}

/** the icons of the designs that come with p0pc0rn (24-unit line glyphs on the home screen's tile), else a letter on a colour; a game
 *  without its own glyph gets the board ('game': known by its kind, so a renamed game keeps it) */
export const GLYPHS = {
  'list-tasks': ['M4.6 6.6l1.3 1.3 2.3-2.6', 'M4.6 12.1l1.3 1.3 2.3-2.6', 'M4.6 17.6l1.3 1.3 2.3-2.6', 'M11 7h8.5', 'M11 12.5h8.5', 'M11 18h6'],
  'flashcards-learn': ['M6.5 8.5h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M8 5.5h9.5a2 2 0 0 1 2 2v8.5', 'M8.5 14h5'],
  'dashboard-live': ['M4 19.5h16', 'M5.5 15.5l4-4.5 3 2.6 5.5-6.6', 'M15 7h3v3'],
  'daily-counter': ['M12 4.5a7.5 7.5 0 1 1-7.5 7.5', 'M12 9v6M9 12h6'],
  'tiles-log': ['M5.5 4.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z', 'M13.5 4.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z', 'M5.5 12.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z', 'M15.5 13v6M13 16h5'],
  'weather-alerts': ['M7.5 16.5a3.8 3.8 0 0 1-.4-7.6 5.2 5.2 0 0 1 10.1.9 3.4 3.4 0 0 1-.7 6.7', 'M12.6 12.5 10.8 16h2.6l-1.8 3.5'],
  'wildfire-watch': ['M12 3.8c.9 2.9 4.6 4.6 4.6 8.8a4.6 4.6 0 0 1-9.2 0c0-2 1-3.3 2-4.3.2 1.4.9 2.3 1.8 2.6-.5-2.3-.1-4.6.8-7.1Z', 'M12 19.2a2 2 0 0 1-2-2c0-1.2.9-1.9 2-3 1.1 1.1 2 1.8 2 3a2 2 0 0 1-2 2Z'],
  'trip-watch': ['M3.5 18.5 9 10.5l3.6 5.1 2.4-3.3 5.5 6.2Z', 'M16.5 4.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z'],
  'wallet-watch': ['M3.5 12.5h17', 'M7 12.5c0-4 1.3-6.5 5-6.5s5 2.5 5 6.5', 'M8.5 15.5h7l-2 4h-3Z', 'M13.4 16.6h.2'],   // 3.9 Wallet Watch: a hat and a collar (its picture: icons/apps/)
  game: ['M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v10.5h-17V7A1.5 1.5 0 0 1 5 5.5Z', 'M3 17.5h18', 'M8 9.5a1.1 1.1 0 1 1 0 .1M12 9.5a1.1 1.1 0 1 1 0 .1M16 9.5a1.1 1.1 0 1 1 0 .1M8 13.5a1.1 1.1 0 1 1 0 .1M12 13.5a1.1 1.1 0 1 1 0 .1M16 13.5a1.1 1.1 0 1 1 0 .1'],
};
/** the glyph's colour on the tile (the home screen's icon family: warm glyphs on a plum tile) */
export const TINTS = { 'list-tasks': '#FFD27A', 'flashcards-learn': '#FFB86B', 'dashboard-live': '#FF8F6B', 'daily-counter': '#7FD8FF', 'tiles-log': '#FFE08A',
  'weather-alerts': '#FFC24D', 'wildfire-watch': '#FF9255', 'trip-watch': '#9EE6B8', 'wallet-watch': '#F2B33D', game: '#FFD34D' };
export function iconOf(m) {
  const id = m && m.id, key = id && GLYPHS[id] && id !== 'game' ? id : isGame(m) ? 'game' : '';
  if (key) return { glyph: GLYPHS[key], tint: TINTS[key] || '#FFD27A' };
  return Object.assign({ glyph: null }, letterIcon((m && m.name) || '?'));
}

/** 3.9 Wallet Watch: a design that comes with p0pc0rn and ships its own icon (icons/apps/<id>-180.png / -120.png, a picture made for it):
 *  the picture for its card, its made apps and their home-screen tile (an icon Juli makes for one app still wins) -> {src, srcset} | null */
export const ART_DESIGNS = new Set(['wallet-watch']);
export const designArt = (id) => (ART_DESIGNS.has(id) ? { src: `icons/apps/${id}-180.png`, srcset: `icons/apps/${id}-120.png 120w, icons/apps/${id}-180.png 180w` } : null);
/** a game's cover picture: one file per game (icons/games/<the id in its design>-cover.png); without it the screen draws one */
export const coverPath = (id) => `icons/games/${String(id || '').replace(/[^a-z0-9-]/g, '')}-cover.png`;

/** Skills: one line on what it is for, and the chips ("what it can do"): where Juli uses it, where it came from, and Off. A game's skill
 *  says it in its own words (its first sentence), so the game is named as its design names it */
const SKILL_PURPOSE = {
  'make-an-app': 'Helps Juli turn your words into an app that fits.',
  'change-an-app': 'Helps Juli change an app you made, one small step at a time, with Undo.',
  'make-a-game': 'Helps Juli make a game you play against her, and say plainly when a new kind of game needs its own design.',
};
const FOR_CHIP = { make: 'Making apps', change: 'Changing apps', chat: 'Chat', game: 'Games', app: 'Apps that work for you' };   // 3.9 Wallet Watch: + app
export function skillCard(k, appName) {
  if (!k) return { purpose: '', chips: [], icon: 'make' };
  const purpose = (k.from === 'p0pc0rn' && SKILL_PURPOSE[k.name]) || firstSentence(k.description) || String(k.description || '');
  const chips = (k.for || []).map((f) => FOR_CHIP[f] || f);
  chips.push(k.from === 'p0pc0rn' ? 'Built in' : k.from === 'import' ? 'Yours' : `From ${appName || 'an app'}`);
  if (!k.enabled) chips.push('Off');
  const f = (k.for || [])[0];
  return { purpose, chips, icon: f === 'game' ? 'game' : f === 'change' ? 'change' : f === 'chat' ? 'chat' : 'make', off: !k.enabled };
}

/** a home-screen widget's line for an app that works for you: what it does (its plain sentence's first part), that it only suggests,
 *  and where to pause it ("Keeps an eye on the weather for the trips you add and tells you what changed. It only suggests ...") */
export function widgetLine(m) {
  const first = firstSentence(plainOf(m)).replace(/,\s*(on its own|when|while|each|every)\b.*$/i, '').replace(/[.!?]$/, '');
  return `${first}. ${seesShort(m)}. It only suggests. Pause it any time with the Pause switch in its settings.`;
}
/** the words on a made app's card under its name (the host's own line, in plain words, plus what needs the person) */
export function lookLine(badge) { const b = Math.max(0, Math.floor(+badge) || 0); return b ? `${b} to look at` : ''; }
