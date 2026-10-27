// shell.js - p0pc0rn 3.9: the phone-OS shell. Josh (Oct-25): "I want ... the UI to be like a mobile OS". A home screen that scrolls up
// and down (no pages), a fixed dock (Juli, Create, Music, Settings), the p0pc0rn pill above it (tap = Juli), red number badges at the top
// left of an icon, widgets for agentic apps, made apps the person pins, a blurred wallpaper they choose, edit mode (a long press: the
// icons wiggle, drag to reorder, remove a pinned app), screens that grow from their icon and go back with a swipe from the left edge.
// The 3.8 screens stay as they were: go(tab) still shows one (app.js); this module adds the home around them and calls nothing in them.
// API (for every part of the app; also window.SHELL): SHELL.register / open / home / badge / refresh / pin / unpin / on.
// app.js's hooks: init (once, at start), went (every go), note (a result landed), titleOf, startTab, restorable, homeButton.
import { DOCK, HOME_ORDER, gridLayout, slotAt, badgeText, badgeLabel, moveItem, orderIds, createPins, widgetsOf, appsBadge, screenOf, startTab } from './shell_core.js';
import { createRecognizer, attach } from './gesture.js';
import { createWallpaper } from './wallpaper.js';
import { createHomePlus } from './homeplus.js';   // 3.9 polish (A1): an icon's context menu, the install ring, the activity pill
import { probeImage, artKind } from './homeplus_core.js';   // 3.9 polish (A1): the art probe (an Image() test, never a HEAD request)
import { createBrowser } from './browser.js';
import { createStorefront } from './storefront.js';   // 3.9 polish (A1): the Apps, Games and Skills screens; apps that work for you
import { designArt } from './storefront_core.js';   // 3.9 Wallet Watch: a pinned app's design may ship its own icon (icons/apps/)

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svgUse = (href) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', href); s.append(u); s.setAttribute('aria-hidden', 'true'); return s; };
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: this page only */ } };
const KEY = { order: 'p0pc0rn:home:order', unseen: 'p0pc0rn:shell:unseen', cardsGone: 'p0pc0rn:home:cardsGone' };   // 3.9 home cards: + cardsGone
const EASE = 'cubic-bezier(.2,.85,.25,1)';
const VIEWS_38 = ['create', 'assistant', 'apps', 'library', 'settings'];

// the screens p0pc0rn 3.9 has itself; other parts register their own (Music: 'music')
const BUILTIN = [
  { id: 'assistant', title: 'Juli', icon: '#i-chat', view: 'v-assistant', dock: true, badge: () => {   // the chat's unread count (ui/chat.js unread())
    const ch = S.api && S.api.chat && S.api.chat(); return ch && typeof ch.unread === 'function' ? ch.unread() : 0; } },
  { id: 'create', title: 'Create', icon: '#i-sh-camera', view: 'v-create', dock: true },
  { id: 'settings', title: 'Settings', icon: '#i-gear', view: 'v-settings', dock: true },
  { id: 'library', title: 'Library', icon: '#i-grid', view: 'v-library', home: true },
  { id: 'apps', title: 'Apps', icon: '#i-apps', view: 'v-apps', home: true },
  { id: 'browser', title: 'Browser', icon: '#i-sh-globe', view: 'v-browser', home: true },
  { id: 'games', title: 'Games', icon: '#i-sh-game', view: 'v-apps', home: true },   // the Apps screen at its Games group
  { id: 'skills', title: 'Skills', icon: '#i-sh-skill', view: 'v-skills', home: true },
  { id: 'connection', title: 'Connection', icon: '#i-sh-link', home: true, grayed: true },   // "coming soon", nothing else
];

const S = {
  api: null, ready: false, screens: new Map(), badges: new Map(), on: { open: [], close: [], home: [] },
  pins: null, pinOpen: new Map(), editing: false, from: null, fromId: null, suppress: 0, art: {}, timer: 0,
  unseen: lsGet(KEY.unseen, { create: 0 }), wall: null, browser: null, skipClose: false, anim: null,
};
const emit = (ev, id) => { for (const f of S.on[ev] || []) { try { f(id); } catch (e) { /* a listener's own problem */ } } };
const diag = (m, d) => { try { if (S.api && S.api.diag) S.api.diag('shell: ' + m, d || {}); } catch (e) { /* */ } };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const busy = () => document.documentElement.hasAttribute('data-busy');   // a render is running: nothing moves that needn't
const tab = () => (S.api ? S.api.tab() : 'home');
const appsState = () => { try { const A = S.api && S.api.apps && S.api.apps(); return A && A.state; } catch (e) { return null; } };
const pinArt = (ref) => { const st = appsState(), a = st && st.apps ? st.apps.find((x) => x.id === ref) : null; return a ? designArt(a.skel) : null; };   // 3.9 Wallet Watch
const homeLabel = (t) => String(t || '').replace(/\s*\(beta\)$/i, '');   // 3.9 Wallet Watch (beta): the label under the icon (80 px) drops "(beta)"; the full name stays in its aria-label, My apps and the shelf

// ------------------------------------------------------------------------------------------------ the registry + the public API
function register(o) {
  if (!o || typeof o.id !== 'string' || !o.id) return;
  const prev = S.screens.get(o.id) || {};
  S.screens.set(o.id, Object.assign({}, prev, o));
  if (S.ready) renderAll();
}
function badgeOf(id) {
  const sc = S.screens.get(id);
  let n = 0;
  if (sc && typeof sc.badge === 'function') { try { n = Number(sc.badge()) || 0; } catch (e) { n = 0; } }
  if (S.badges.has(id)) n = Math.max(n, S.badges.get(id));
  return n;
}
function open(id, { from } = {}) {
  if (!S.api || !id) return;
  if (S.editing) exitEdit();
  if (id === 'connection') return comingSoon();
  if (id.startsWith('app:')) return openPin(id);
  const target = screenOf(id);
  if (!S.screens.has(id) && !VIEWS_38.includes(target) && !$('v-' + target)) return;
  S.from = from && from.getBoundingClientRect ? from.getBoundingClientRect() : null;
  S.fromId = id;
  if ((id === 'apps' || id === 'games') && S.store) S.store.pane(id === 'games' ? 'games' : 'apps');   // 3.9 polish: Games is the Apps screen's second pane
  if (target === tab()) { S.from = null; if (id === 'games') toGames(); return; }
  S.api.go(target);
  if (id === 'games') toGames();
}
function toGames() { if (S.store) S.store.pane('games'); }   // 3.9 polish: its own pane (ui/storefront.js), titled Games
function home() { if (S.api && tab() !== 'home') S.api.go('home'); }
function badge(id, n) { n = Math.max(0, Math.floor(Number(n)) || 0); if (n) S.badges.set(id, n); else S.badges.delete(id); paintBadges(); }
function refresh() { if (!S.ready) return; renderHome(); renderWidgets(); paintBadges(); }
function pin(p) {
  if (!p || !p.id) return false;
  const okAdd = S.pins.add(p);
  if (okAdd && typeof p.open === 'function') S.pinOpen.set(p.id, p.open);
  renderHome(); return okAdd;
}
function unpin(id) { S.pins.remove(id); S.pinOpen.delete(id); renderHome(); try { if (globalThis.P0APPICON && String(id).startsWith('app:')) globalThis.P0APPICON.drop(String(id).slice(4)); } catch (e) { /* */ } }   // 3.9: a pin's icon leaves with it
/** 3.9 polish (A1): Add to Home Screen, the person's tap, lands an app like an install: pinned, and the next time the home screen shows,
 *  its icon fills a ring, then pops in (ui/homeplus.js). false = the home screen is full (as pin) */
function install(p) { const ok = pin(p); if (ok && S.hp && p && p.id) S.hp.installing(p.id); return ok; }
function on(ev, fn) { if (S.on[ev] && typeof fn === 'function') S.on[ev].push(fn); }

// ------------------------------------------------------------------------------------------------ app.js's hooks
function titleOf(id) { if (id === 'apps' && S.store && S.store.pane() === 'games') return 'Games'; const sc = S.screens.get(id); return sc ? sc.title : { create: 'Create', assistant: 'Juli', apps: 'Apps', library: 'Library', settings: 'Settings' }[id] || ''; }
const restorable = (id) => id === 'home' || (S.screens.has(id) && !!$((S.screens.get(id).view) || ''));
/** a result landed in the Library: Create's badge counts it until Create or the Library is seen */
function note(id) {
  if (id !== 'create' || ['create', 'library'].includes(tab())) return;
  S.unseen.create = Math.min(999, (S.unseen.create || 0) + 1); lsSet(KEY.unseen, S.unseen); paintBadges();
}
/** My apps' "Add to Home Screen" (makeapp/host.js asks for it per made app): a toggle. 3.9 polish (A1): the person's tap lands the app as
 *  an install (install(): a ring fills on the home screen, then its icon pops in); Make and Get never pin by themselves */
function homeButton(app, openFn) {
  if (!app || !app.id || !S.pins) return null;
  const id = 'app:' + app.id;
  if (typeof openFn === 'function') S.pinOpen.set(id, openFn);
  const b = mk('button', 'mini sh-pin-btn'); b.type = 'button'; b.dataset.pin = app.id; b.append(svgUse('#i-sh-home'));   // an icon: the row already holds Open, Change and Delete
  const paint = () => { const on2 = S.pins.has(id); b.setAttribute('aria-pressed', String(on2)); const t = on2 ? `${app.name} is on the Home Screen: remove it` : `Add ${app.name} to the Home Screen`; b.setAttribute('aria-label', t); b.title = t; };
  b.onclick = () => {
    if (S.pins.has(id)) { unpin(id); toast(`${app.name} left the Home Screen`); }
    else if (globalThis.P0APPICON && globalThis.P0APPICON.offer) globalThis.P0APPICON.offer(app, () => { const ok2 = install({ id, title: app.name, ref: app.id, open: openFn }); toast(ok2 ? `${app.name} is on the Home Screen` : 'The Home Screen is full: remove a pinned app first'); paint(); return ok2; });   // 3.9: Add to Home Screen offers an icon; the letter is one tap (ui/appicon.js)
    else if (install({ id, title: app.name, ref: app.id, open: openFn })) toast(`${app.name} is on the Home Screen`);
    else toast('The Home Screen is full: remove a pinned app first');
    paint();
  };
  paint(); return b;
}
function toast(t) { try { if (S.api && S.api.toast) S.api.toast(t); } catch (e) { /* */ } }

/** every go(tab): the screen layer, its animation, the dock's current item, open / close callbacks and badges */
function went(from, to) {
  if (!S.ready) return;
  const scr = $('screen'), toHome = to === 'home';
  document.documentElement.toggleAttribute('data-sh-home', toHome);
  setInert(toHome);
  paintDock();
  if (toHome) {
    const id = S.fromId && screenOf(S.fromId) === from ? S.fromId : from;
    if (S.skipClose) { S.skipClose = false; stopAnim(); hideScreen(); } else closeAnim(id);
    S.fromId = null; refresh(); emit('home', from);
  } else {
    if (scr.hidden || (S.anim && S.anim.shClose)) { scr.hidden = false; openAnim(S.from); }   // opened while the last screen was still closing: the close is dropped
    S.from = null;
  }
  const a = S.screens.get(from), b = S.screens.get(to);
  if (a && typeof a.onClose === 'function') { try { a.onClose(); } catch (e) { /* */ } }
  if (b && typeof b.onOpen === 'function') { try { b.onOpen(); } catch (e) { /* */ } }
  if (from && from !== 'home') emit('close', from);
  if (!toHome) emit('open', to);
  if ((to === 'create' || to === 'library') && S.unseen.create) { S.unseen.create = 0; lsSet(KEY.unseen, S.unseen); }
  paintBadges();
}

// ------------------------------------------------------------------------------------------------ the screen layer: open / close
// one animation at a time (S.anim): a new open or close cancels the running one, and the end of a close only hides the screen layer
// while the home screen is still what is meant to show (a screen opened during the close stays open)
function hideScreen() { if (tab() !== 'home') return; const scr = $('screen'); scr.hidden = true; scr.style.transform = ''; scr.style.opacity = ''; scr.style.transformOrigin = ''; }
function stopAnim() { const a = S.anim; S.anim = null; if (a) { try { a.cancel(); } catch (e) { /* */ } $('screen').style.transformOrigin = ''; } }
function track(a, close, end) { S.anim = a; a.shClose = close; a.onfinish = () => { if (S.anim !== a) return; S.anim = null; end(); }; }
function originFor(r) {   // the screen, scaled to the icon's width, lines up with the icon (and centred on it vertically)
  const W = innerWidth, H = innerHeight, s = Math.min(0.9, Math.max(0.08, r.width / W)), cy = r.top + r.height / 2;
  return { s, ox: r.left / (1 - s), oy: (cy - (H * s) / 2) / (1 - s) };
}
function openAnim(r) {
  const el = $('screen'), none = () => {};
  stopAnim();
  if (busy() || !el.animate) return;
  if (reduced()) return track(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 }), false, none);
  if (!r || !r.width) return track(el.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE }), false, none);
  const { s, ox, oy } = originFor(r);
  el.style.transformOrigin = `${ox}px ${oy}px`;
  const a = el.animate([{ transform: `scale(${s})`, opacity: 0, borderRadius: `${Math.round(16 / s)}px` }, { transform: 'scale(1)', opacity: 1, borderRadius: '0px' }],
    { duration: 340, easing: EASE });
  track(a, false, () => { el.style.transformOrigin = ''; });
}
function iconFor(id) {
  return document.querySelector(`#home-grid .sh-app[data-id="${CSS.escape(id)}"] .sh-tile`) || document.querySelector(`#dock .dock-btn[data-id="${CSS.escape(id)}"] .sh-tile`);
}
function closeAnim(id) {
  const el = $('screen');
  if (el.hidden) return;
  stopAnim();
  if (busy() || !el.animate) return hideScreen();
  if (reduced()) return track(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120 }), true, hideScreen);
  const t = id && iconFor(id), r = t && t.getBoundingClientRect();
  if (!r || !r.width) return track(el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 200, easing: EASE }), true, hideScreen);
  const { s, ox, oy } = originFor(r);
  el.style.transformOrigin = `${ox}px ${oy}px`;
  const a = el.animate([{ transform: 'scale(1)', opacity: 1, borderRadius: '0px' }, { transform: `scale(${s})`, opacity: 0, borderRadius: `${Math.round(16 / s)}px` }],
    { duration: 300, easing: EASE });
  track(a, true, hideScreen);
}
function setInert(onHome) {   // the hidden half never takes focus or taps (screen readers, keyboard)
  const homeEls = [$('v-home'), $('dockwrap')], scr = $('screen');
  for (const e of homeEls) if (e) { e.inert = !onHome; e.setAttribute('aria-hidden', String(!onHome)); }
  if (scr) { scr.inert = onHome; }
}

// the back swipe from the left edge of a screen: the screen follows the finger; past a third (or a flick) it goes home. It listens on
// its own strip as wide as the page's gutter (nothing of the screen is under it), whose touch-action leaves every pan to us; the rest
// of the screen keeps its own scrolling, horizontal included
function wireBackSwipe() {
  const scr = $('screen');
  let strip = $('edge-back');
  if (!strip) { strip = mk('div', 'edge-back'); strip.id = 'edge-back'; strip.setAttribute('aria-hidden', 'true'); scr.append(strip); }
  let live = false;
  const rec = createRecognizer({ edge: 40, width: () => innerWidth, onEvent(e) {
    if (e.type === 'edgestart') {
      live = tab() !== 'home' && !document.documentElement.hasAttribute('data-viewer') && !document.documentElement.hasAttribute('data-lesson') && !document.querySelector('.sheet-wrap:not([hidden]), .app-run');
      if (live) { ctl.capture(); scr.classList.add('sh-swiping'); }
    } else if (e.type === 'edge' && live) {
      scr.style.transform = `translateX(${Math.round(e.dx)}px)`;
    } else if (e.type === 'edgeend' && live) {
      live = false; scr.classList.remove('sh-swiping');
      const W = innerWidth, x = Math.round(e.dx);
      if (e.commit && !e.cancelled) {
        const at = tab(), done = () => { scr.style.transform = ''; if (tab() !== at) return; S.skipClose = true; home(); };   // a screen opened meanwhile stays
        if (busy() || reduced() || !scr.animate) return done();
        const a = scr.animate([{ transform: `translateX(${x}px)` }, { transform: `translateX(${W}px)` }], { duration: 180, easing: EASE }); a.onfinish = done;
        scr.style.transform = `translateX(${W}px)`;
      } else {
        if (busy() || reduced() || !scr.animate) { scr.style.transform = ''; return; }
        const a = scr.animate([{ transform: `translateX(${x}px)` }, { transform: 'translateX(0)' }], { duration: 200, easing: EASE });
        scr.style.transform = ''; a.onfinish = () => { scr.style.transform = ''; };
      }
    }
  } });
  const ctl = attach(strip, rec);
}

// ------------------------------------------------------------------------------------------------ icons
// the icon set (installed by the build): icons/ui/<id>.svg = the drawn guides (always there), icons/ui/<id>-180.png / -120.png = the
// rendered finals Josh picked; ids as the set names them (Juli = 'juli')
const ART_IDS = new Set(['cast', 'juli', 'create', 'music', 'settings', 'library', 'apps', 'browser', 'games', 'skills', 'connection']);
const artId = (id) => (id === 'assistant' ? 'juli' : id);
function tileFor(sc) {
  const t = mk('span', 'sh-tile'); t.dataset.id = sc.id;
  const a = artId(sc.id), art = S.art.kind && ART_IDS.has(a) ? `icons/ui/${a}${S.art.kind === 'png' ? '-180.png' : '.svg'}` : '';
  if (art) {
    const img = new Image(); img.alt = ''; img.decoding = 'async'; img.draggable = false;
    if (S.art.kind === 'png') { img.srcset = `icons/ui/${a}-120.png 120w, icons/ui/${a}-180.png 180w`; img.sizes = '62px'; }   // a 2x screen takes the 120
    img.src = art; t.append(img); t.classList.add('art');
  }
  else if (sc.pin && sc.ref && globalThis.P0APPICON && globalThis.P0APPICON.url(sc.ref)) { t.append(globalThis.P0APPICON.img(sc.ref)); t.classList.add('art'); }   // 3.9: the icon made for this app (ui/appicon.js)
  else if (sc.pin && sc.ref && pinArt(sc.ref)) { const art = pinArt(sc.ref), img = new Image(); img.alt = ''; img.decoding = 'async'; img.draggable = false; img.srcset = art.srcset; img.sizes = '62px'; img.src = art.src; t.append(img); t.classList.add('art'); }   // 3.9 Wallet Watch: its design's icon
  else if (sc.letter) { t.textContent = sc.letter; t.style.background = sc.color; t.classList.add('letter'); }
  else if (typeof sc.icon === 'string' && /\.(png|webp|jpe?g|svg)$/i.test(sc.icon)) { const img = new Image(); img.alt = ''; img.draggable = false; img.src = sc.icon; t.append(img); t.classList.add('art'); }
  else t.append(svgUse(typeof sc.icon === 'string' && sc.icon.startsWith('#') ? sc.icon : '#i-apps'));
  return t;
}
function homeItems() {
  const rank = (s) => { const i = HOME_ORDER.indexOf(s.id); return i >= 0 ? i : 100 + (Number(s.order) || 0); };
  const reg = [...S.screens.values()].filter((s) => s.home && !(typeof s.hidden === 'function' && s.hidden())).sort((a, b) => rank(a) - rank(b));
  const st = appsState(), have = st && st.apps ? new Set(st.apps.map((a) => a.id)) : null;
  const pins = S.pins.list().filter((p) => !have || have.has(p.ref)).map((p) => Object.assign({ pin: true }, p));
  const byId = new Map([...reg, ...pins].map((x) => [x.id, x]));
  return orderIds(lsGet(KEY.order, null), [...byId.keys()]).map((id) => byId.get(id));
}
function appButton(sc, cls = 'sh-app') {
  const b = mk('button', cls); b.type = 'button'; b.dataset.id = sc.id;
  if (sc.grayed) b.classList.add('grayed');
  b.dataset.name = sc.title || '';   // 3.9 Wallet Watch (beta): the full name, for its aria-label (the label under it may be shorter)
  b.append(tileFor(sc), mk('span', 'sh-badge'), mk('span', 'sh-label', homeLabel(sc.title)));
  if (sc.pin) { const x = mk('span', 'sh-x', '−'); x.setAttribute('aria-hidden', 'true'); b.append(x); }
  b.setAttribute('aria-label', sc.title);
  b.addEventListener('click', (e) => {
    if (Date.now() < S.suppress) return;
    if (S.editing) { if (sc.pin && e.target.closest('.sh-x')) { unpin(sc.id); toast(`${sc.title} left the Home Screen`); } return; }
    open(sc.id, { from: b.querySelector('.sh-tile') });
  });
  return b;
}
function renderHome() {
  const grid = $('home-grid'); if (!grid || !S.pins) return;
  const items = homeItems(), keys = items.map((i) => i.id + (i.grayed ? '~' : '')).join('|');
  if (grid.dataset.keys !== keys) { grid.replaceChildren(...items.map((s) => appButton(s))); grid.dataset.keys = keys; }
  layoutGrid();
}
function layoutGrid() {
  const grid = $('home-grid'); if (!grid) return;
  const w = grid.clientWidth || innerWidth, g = gridLayout(w);
  for (const [k, v] of [['--sh-cols', String(g.cols)], ['--sh-icon', g.icon.toFixed(2) + 'px'], ['--sh-gap', g.gap.toFixed(2) + 'px'], ['--sh-left', g.left + 'px']]) grid.style.setProperty(k, v);
  S.layout = g;
}
function renderDock() {
  const dock = $('dock'); if (!dock) return;
  const items = DOCK.map((id) => S.screens.get(id)).filter((s) => s && !(typeof s.hidden === 'function' && s.hidden()));
  const keys = items.map((s) => s.id).join('|');
  if (dock.dataset.keys !== keys) { dock.replaceChildren(...items.map((s) => appButton(s, 'dock-btn'))); dock.dataset.keys = keys; }
  paintDock();
}
function paintDock() { const t = tab(); for (const b of document.querySelectorAll('#dock .dock-btn')) { if (b.dataset.id === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); } }
function paintBadges() {
  const st = appsState(), all = st && st.apps ? st.apps : [];
  for (const b of document.querySelectorAll('#home-grid .sh-app, #dock .dock-btn')) {
    const id = b.dataset.id, sc = S.screens.get(id);
    let n;
    if (id === 'create') n = Math.max(S.unseen.create || 0, badgeOf(id));
    else if (id === 'apps') n = Math.max(appsBadge(all), badgeOf(id));
    else if (id.startsWith('app:')) { const p = S.pins.list().find((x) => x.id === id), a = p && all.find((x) => x.id === p.ref); n = a ? Number(a.badge) || 0 : 0; }
    else n = badgeOf(id);
    const t = badgeText(n), el = b.querySelector('.sh-badge');
    if (el && el.textContent !== t) el.textContent = t;
    b.setAttribute('aria-label', sc && sc.grayed ? `${sc.title}, coming soon` : badgeLabel((sc && sc.title) || b.dataset.name || b.querySelector('.sh-label').textContent, n));   // 3.9 Wallet Watch (beta): the full name
  }
}
// 3.9 home cards (Josh, Oct-27: "Only with news, swipe away"): an app that works for you puts a card here when it has something for the
// person (ui/shell_core.js widgetsOf); a sideways swipe clears it until that app has something new (its newsAt, makeapp/host.js)
const cardsGone = () => { const g = lsGet(KEY.cardsGone, {}); return g && typeof g === 'object' && !Array.isArray(g) ? g : {}; };
function clearCard(c, w, dir) {
  if (!c || c.dataset.gone) return; c.dataset.gone = '1';
  const g = cardsGone(); g[w.id] = Number(w.app && w.app.newsAt) || Date.now(); lsSet(KEY.cardsGone, g);
  if (reduced() || !c.isConnected) { renderWidgets(); return; }
  c.style.transition = `transform .24s ${EASE}, opacity .24s ${EASE}`; c.style.transform = `translateX(${(dir < 0 ? -1 : 1) * (c.offsetWidth + 40)}px)`; c.style.opacity = '0';
  setTimeout(renderWidgets, 250);
}
/** a card follows a sideways finger: past 72 px (or a flick) it slides out and is cleared, otherwise it springs back; a swipe never also
 *  opens the app; a scroll that starts on a card stays the home screen's (touch-action: pan-y in ui/shell.css) */
function swipeCard(c, w) {
  let pid = null, x0 = 0, y0 = 0, t0 = 0, dx = 0, drag = false;
  const set = (v, ease) => { c.style.transition = ease && !reduced() ? `transform .28s ${EASE}, opacity .28s ${EASE}` : 'none'; c.style.transform = v ? `translateX(${v}px)` : ''; c.style.opacity = v ? String(Math.max(0.2, 1 - Math.abs(v) / Math.max(1, c.offsetWidth))) : ''; };
  const stop = () => { pid = null; if (drag) { drag = false; c.classList.remove('sh-w-drag'); set(0, true); } };
  c.addEventListener('pointerdown', (e) => { if (e.button > 0 || S.editing || c.dataset.gone) return; pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); dx = 0; drag = false; });
  c.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    if (S.editing) return stop();   // a long press turned edit mode on: the card stays
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!drag && Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { pid = null; return; }   // a scroll: the home screen's
    if (!drag && Math.abs(mx) > 8) { drag = true; c.dataset.swiped = '1'; c.classList.add('sh-w-drag'); try { c.setPointerCapture(pid); } catch (x) { /* the pointer is gone */ } }
    if (drag) { dx = mx; set(dx); }
  });
  const end = (e) => {
    if (e.pointerId !== pid) return; pid = null;
    if (!drag) return; drag = false; c.classList.remove('sh-w-drag');
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);   // px / ms over the whole swipe
    if (e.type === 'pointerup' && (Math.abs(dx) > 72 || (v > 0.5 && Math.abs(dx) > 24))) clearCard(c, w, dx); else set(0, true);
    setTimeout(() => { delete c.dataset.swiped; }, 150);   // the click this lift makes is not a tap
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('keydown', (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && !S.editing) { e.preventDefault(); clearCard(c, w, 1); } });
}
function renderWidgets() {
  const box = $('home-widgets'); if (!box) return;
  const st = appsState();
  let gone = cardsGone();
  if (st && Array.isArray(st.apps) && st.apps.length) {   // forget the cards of apps that are no longer on the phone (once the list is in)
    const have = new Set(st.apps.map((a) => a.id)), keep = {}; let drop = false;
    for (const k of Object.keys(gone)) { if (have.has(k)) keep[k] = gone[k]; else drop = true; }
    if (drop) { gone = keep; lsSet(KEY.cardsGone, gone); }
  }
  const list = st ? widgetsOf(st.apps, st.skels, Date.now(), 3, gone) : [];
  box.hidden = !list.length;
  const keys = list.map((w) => `${w.id}:${w.count}:${w.line}:${w.name}`).join('|');
  if (box.dataset.keys === keys) return;
  box.dataset.keys = keys;
  box.replaceChildren(...list.map((w) => {
    const c = mk('button', 'sh-widget'); c.type = 'button'; c.dataset.app = w.id;
    const top = mk('span', 'sh-w-top'); top.append(mk('span', 'sh-w-kind', w.kind || 'Works for you'));
    if (w.count) top.append(mk('span', 'sh-w-count', badgeText(w.count)));
    c.append(top, mk('span', 'sh-w-name', w.name), mk('span', 'sh-w-line', w.line));
    try { const I = globalThis.P0STORE, t = I && I.widgetLine ? I.widgetLine(w.id) : ''; if (t) c.append(mk('span', 'sh-w-about', t)); } catch (e) { /* the widget without it */ }   // 3.9 polish: what it does, that it only suggests, where to pause it
    c.setAttribute('aria-label', `${w.name}: ${w.line}. Swipe to clear.`);
    c.onclick = () => { if (S.editing || Date.now() < S.suppress || c.dataset.swiped || c.dataset.gone) return; const A = S.api.apps && S.api.apps(); if (A && A.openApp) A.openApp(w.app); };
    swipeCard(c, w);
    return c;
  }));
}
function openPin(id) {
  const p = S.pins.list().find((x) => x.id === id); if (!p) return;
  const f = S.pinOpen.get(id);
  if (f) return f();
  const A = S.api.apps && S.api.apps(), st = A && A.state, a = st && st.apps && st.apps.find((x) => x.id === p.ref);
  if (a && A.openApp) return A.openApp(a);
  toast('That app is no longer on this phone'); unpin(id);
}
function comingSoon() {
  if (!S.api || !S.api.sheet) return toast('Coming soon');
  const { sheet, close } = S.api.sheet('sh-connection', 'Connection');
  sheet.classList.add('sh-soon');
  const ok = mk('button', 'btn', 'OK'); ok.type = 'button'; ok.onclick = close;
  sheet.append(mk('p', 'callout', 'Coming soon'), ok);
}

// ------------------------------------------------------------------------------------------------ edit mode (a long press on the home screen)
function enterEdit() {
  if (S.editing) return;
  S.editing = true; document.documentElement.classList.add('sh-editing');
  $('home-done').hidden = false; $('home-edit').hidden = false; S.homeRec.set({ dragImmediate: true });
}
function exitEdit() {
  if (!S.editing) return;
  S.editing = false; document.documentElement.classList.remove('sh-editing');
  $('home-done').hidden = true; $('home-edit').hidden = true; S.homeRec.set({ dragImmediate: false });
}
/** 3.9 polish (A1): a long press on a made app's icon opens its menu (ui/homeplus.js: Open, Change, Remove from Home Screen, Share, Delete,
 *  Edit Home Screen) -> true when it showed; the other icons and the empty space keep edit mode */
function pinMenuAt(x, y) {
  const hit = document.elementFromPoint(x, y), b = hit && hit.closest('#home-grid .sh-app');
  if (!b || !/^app:/.test(b.dataset.id || '')) return false;
  const sc = homeItems().find((s) => s.id === b.dataset.id);
  return !!(sc && S.hp.pinMenu(b, sc, { fromPress: true }));
}
function wireHome() {
  const area = $('home-scroll'), grid = $('home-grid');
  let drag = null;
  const rec = S.homeRec = createRecognizer({ width: () => innerWidth, onEvent(e) {
    if (e.type === 'longpress') {
      if (tab() !== 'home') return;
      S.held = true;   // the click that comes with lifting this finger is not a tap (see the pointerup listener below)
      if (!S.editing && S.hp && pinMenuAt(e.x, e.y)) return;   // 3.9 polish (A1): a made app's icon: its menu; any other: edit mode
      if (!S.editing) enterEdit();
    } else if (e.type === 'dragstart' && (S.editing || (S.hp && S.hp.menuOpen() && (S.hp.closeMenu(), enterEdit(), true)))) {   // 3.9 polish (A1): a drag from the menu edits
      const b = document.elementFromPoint(e.x - e.dx, e.y - e.dy); const icon = b && b.closest('#home-grid .sh-app');
      if (!icon) return;
      ctl.capture(); S.held = true;
      drag = { icon, id: icon.dataset.id, x0: e.x - e.dx, y0: e.y - e.dy }; icon.classList.add('dragging');
    } else if (e.type === 'drag' && drag) {
      drag.icon.style.transform = `translate(${e.dx}px, ${e.dy}px) scale(1.08)`;
    } else if (e.type === 'dragend' && drag) {
      const d = drag; drag = null; d.icon.classList.remove('dragging'); d.icon.style.transform = '';
      if (e.cancelled || !S.layout) return;
      const box = grid.getBoundingClientRect(), r = d.icon.getBoundingClientRect();
      const ids = homeItems().map((x) => x.id), from = ids.indexOf(d.id);
      const to = slotAt(S.layout, r.left + r.width / 2 + e.dx - box.left, r.top + S.layout.icon / 2 + e.dy - box.top, ids.length);
      if (from >= 0 && to !== from) { lsSet(KEY.order, moveItem(ids, from, to)); renderHome(); paintBadges(); }
    }
  } });
  const ctl = attach(area, rec);
  // only the click that the lifted long-press (or drag) finger makes is swallowed: the very next tap works
  const lifted = () => { if (S.held) { S.held = false; S.suppress = Date.now() + 350; } };
  area.addEventListener('pointerup', lifted, true); area.addEventListener('pointercancel', lifted, true);
  area.addEventListener('contextmenu', (e) => e.preventDefault());   // a long press is edit mode, never a menu
  area.addEventListener('click', (e) => { if (S.editing && Date.now() >= S.suppress && !e.target.closest('.sh-app, .sh-widget, #home-done, #home-wall, .home-status')) exitEdit(); });   // a tap on an empty spot ends edit mode; the lifted long press that began it does not
  $('home-done').onclick = exitEdit;
  $('home-wall').onclick = () => { if (S.wall) S.wall.choose(); };
  addEventListener('resize', () => { layoutGrid(); });
}

// ------------------------------------------------------------------------------------------------ the status chip + Juli's unread (3.8 parts)
function wireMirrors() {
  const pill = $('pill'), chip = $('home-status');
  if (pill && chip) {
    const sync = () => { const tone = pill.dataset.tone || 'ok', t = pill.querySelector('span') ? pill.querySelector('span').textContent : ''; chip.hidden = tone === 'ok' && !/Popped/.test(t); chip.dataset.tone = tone; chip.querySelector('span').textContent = t; chip.setAttribute('aria-label', pill.getAttribute('aria-label') || t); };
    new MutationObserver(sync).observe(pill, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-tone', 'aria-label'] });
    chip.onclick = () => pill.click(); sync();
  }
  // Juli's badge is the chat's own unread count: ui/chat.js paints SHELL.badge('assistant', n) and its unread() is read on every refresh
  // (BUILTIN 'assistant'); the 3.8 tab dot, kept hidden, is never read (it only knows unread yes / no)
}

// ------------------------------------------------------------------------------------------------ the splash (once per page)
function splash() {
  const sp = $('splash'), shell = $('shell'); if (!sp || !shell) return;
  if (document.documentElement.classList.contains('pf-fresh')) { sp.remove(); return; }   // a planned fresh page has its own cover
  const go = () => {
    if (shell.hidden) return;
    obs.disconnect();
    setTimeout(() => { if (reduced()) return sp.remove(); sp.classList.add('out'); setTimeout(() => sp.remove(), 420); }, reduced() ? 120 : 520);
  };
  const obs = new MutationObserver(go); obs.observe(shell, { attributes: true, attributeFilter: ['hidden'] }); go();
}

// ------------------------------------------------------------------------------------------------ init
function renderAll() { renderDock(); renderHome(); renderWidgets(); paintBadges(); }
/** ART's icons: the finals when the build has them (a set: one check), else its drawn guides, else this file's sprite placeholders;
 *  and ART's default wallpaper (ui/wallpaper.js tests it with an Image() itself and falls back to the gradient: no second download).
 *  3.9 polish (A1): an Image() test (homeplus_core.js probeImage), never a HEAD request (a static server may refuse HEAD with 405: an
 *  iPhone then showed the placeholders and no wallpaper); it gives up after a few seconds, so it never hangs */
async function loadArt() {
  const kind = await artKind((u) => probeImage(u));
  if (kind) { S.art = { kind }; for (const el of document.querySelectorAll('#home-grid, #dock')) el.dataset.keys = ''; renderAll(); }
  return { wallpaper: 'wallpapers/default.webp' };
}
function init(api) {
  if (S.ready) return;
  S.api = api || {};
  try {
    S.pins = createPins(localStorage);
    for (const b of BUILTIN) if (!S.screens.has(b.id)) S.screens.set(b.id, Object.assign({}, b)); else S.screens.set(b.id, Object.assign({}, b, S.screens.get(b.id)));
    S.ready = true;
    renderAll(); wireHome(); wireMirrors(); wireBackSwipe(); splash();
    $('brand-pill').onclick = () => { open('assistant', { from: $('brand-pill') }); setTimeout(() => { const i = $('as-in'); if (i && !i.closest('[hidden]') && !i.disabled) i.focus(); }, reduced() ? 60 : 380); };
    $('home-btn').onclick = () => home();
    const onHome = tab() === 'home';
    document.documentElement.toggleAttribute('data-sh-home', onHome);
    $('screen').hidden = onHome; setInert(onHome);
    S.timer = setInterval(() => { if (tab() === 'home' && !document.hidden && !busy()) refresh(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && tab() === 'home') refresh(); });
  } catch (e) { diag('init failed', { message: String((e && e.message) || e).slice(0, 200) }); }
  try { S.browser = createBrowser({ toast, sheet: S.api.sheet }); } catch (e) { diag('browser failed', { message: String((e && e.message) || e).slice(0, 200) }); }
  try { S.hp = createHomePlus({ tab, toast, sheet: S.api.sheet, apps: () => (S.api.apps ? S.api.apps() : null), open, unpin, enterEdit, on, browser: () => S.browser }); }   // 3.9 polish (A1)
  catch (e) { diag('home extras failed', { message: String((e && e.message) || e).slice(0, 200) }); }
  loadArt().then((j) => {
    try { S.wall = createWallpaper({ toast, sheet: S.api.sheet, art: j && j.wallpaper ? j.wallpaper : null }); S.wall.load(); } catch (e) { diag('wallpaper failed', { message: String((e && e.message) || e).slice(0, 200) }); }
  });
  try { S.store = createStorefront({ apps: () => (S.api.apps ? S.api.apps() : null), go: S.api.go, tab, toast, sheet: S.api.sheet, diag }); } catch (e) { diag('storefront failed', { message: String((e && e.message) || e).slice(0, 200) }); }   // 3.9 polish (A1)
  // the 3.8 Apps host fills its data after start: draw the widgets and badges once it has
  let n = 0; const wait = setInterval(() => { const st = appsState(); if ((st && st.db) || ++n > 40) { clearInterval(wait); refresh(); } }, 500);
  try { dispatchEvent(new Event('p0:shell-ready')); } catch (e) { /* */ }   // parts that loaded before the shell register now (Music)
}

export const SHELL = { register, open, home, badge, refresh, pin, unpin, install, on, init, went, note, titleOf, startTab, restorable, homeButton,
  get editing() { return S.editing; }, get ready() { return S.ready; } };
try { window.SHELL = SHELL; } catch (e) { /* not a browser */ }
// 3.9 shell 491403dfc088
