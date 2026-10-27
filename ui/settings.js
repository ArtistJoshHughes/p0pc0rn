// settings.js - p0pc0rn 3.9: Settings in six groups that open and close, and Cast on its own screen. Josh (Oct-26): "settings is not
// optimized for reading. It's an endless scroll which would be better if each section expanded for those that make sense and those that
// need to be grouped then should be together. 'Cast' is hidden inside of settings."
//   - Settings keeps every 3.8 section (a label, its list, its notes): every id and every handler stays (app.js, the benchmark and the desk
//     suites still find and click them). At start this module moves each section, whole, into its group (ui/settings_core.js decides
//     which): a heading (h2) with a button that says whether it is open (aria-expanded) over the region it opens. Each time Settings is
//     shown it is an overview, every group closed (one screen, for reading); a tap opens one group (the others close), a tap on the open
//     one closes it. Two exceptions open a group by themselves: a row something points to (revealSetting), and the Benchmark group while
//     a run is on or once its results land. If anything here fails, 3.8's one long page stays.
//   - Cast (the person's own consented voice and lip-sync recordings) is a screen of its own with a home-screen icon (SHELL.register);
//     Settings keeps a one-line link to it, with how many people are in it.
// API: initSettings(api) once, from app.js init(): api = { placeInd(seg, instant) (app.js: a segmented control's indicator, which skips a
// hidden one), cast (the Cast store: list()), castUi() (cast/cast_ui.js: render()), diag(step, data) }. revealSetting(el) opens the group
// that holds el (app.js openSettings and the stalled queue's Diagnostics call it after go('settings'), before they scroll to a row).
// No style attributes (ui/settings.css); nothing animates while a render runs; nothing is stored.
import { GROUPS, assign, toggled, openOnShow, benchOpens } from './settings_core.js';

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NS = 'http://www.w3.org/2000/svg';
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const busy = () => document.documentElement.hasAttribute('data-busy');   // a render is running: nothing moves that needn't

// each group's small icon (our own drawings on the sprite's 24-unit grid): a sprite symbol, or paths drawn here
const GLYPH = {
  models: { use: '#i-download' },
  juli: { use: '#i-chat' },
  making: { use: '#i-sparkle' },
  bench: { d: ['M4.6 16.5a7.5 7.5 0 1 1 14.8 0', 'm12 16.2 3.6-4.6', 'M7.6 9.4l.9.8M12 6.9v1.2M16.4 9.4l-.9.8'] },   // a gauge
  storage: { d: ['M5.5 5h13A1.5 1.5 0 0 1 20 6.5v3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 9.5v-3A1.5 1.5 0 0 1 5.5 5Z',
    'M5.5 13h13a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-3A1.5 1.5 0 0 1 5.5 13Z', 'M7.5 8h.01M7.5 16h.01'] },   // two drives
  about: { use: '#i-shield' },
};
function glyph(id) {
  const g = GLYPH[id] || GLYPH.juli, s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  if (g.use) { const u = document.createElementNS(NS, 'use'); u.setAttribute('href', g.use); s.append(u); }
  else for (const d of g.d) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
function chevron() {
  const s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use');
  s.setAttribute('class', 'ic sg-chev'); s.setAttribute('aria-hidden', 'true'); u.setAttribute('href', '#i-chevron'); s.append(u); return s;
}

const ST = { api: {}, ready: false, open: null, groups: new Map(), benchRun: false, benchLanded: false };
const tab = () => document.documentElement.dataset.tab || '';
const diag = (m, e) => { try { if (ST.api.diag) ST.api.diag(m, { message: String((e && e.message) || e).slice(0, 200) }); } catch (x) { /* */ } };

/** Settings' 3.8 sections, in order: each starts at a section label (p.label) and runs to the next one */
function sections(view) {
  const out = []; let cur = null;
  for (const el of [...view.children]) {
    if (el.classList.contains('sg')) continue;
    if (!cur || (el.tagName === 'P' && el.classList.contains('label'))) { cur = { els: [], label: '', ids: [] }; out.push(cur); }
    if (!cur.els.length && el.classList.contains('label')) cur.label = el.textContent;
    cur.els.push(el);
    if (el.id) cur.ids.push(el.id);
    for (const x of el.querySelectorAll('[id]')) cur.ids.push(x.id);
  }
  return out;
}
/** the five groups, drawn first (empty, in the view), then each section moved into its own: an element is never out of the page */
function build(view) {
  const parts = sections(view), where = assign(parts);
  for (const g of GROUPS) {
    const sec = mk('section', 'sg'); sec.dataset.sg = g.id;
    const h = mk('h2', 'sg-h'), b = mk('button', 'sg-btn'); b.type = 'button'; b.id = 'sg-btn-' + g.id;
    b.setAttribute('aria-controls', 'sg-' + g.id); b.setAttribute('aria-expanded', 'false');
    const ic = mk('span', 'sg-ic'); ic.dataset.sg = g.id; ic.append(glyph(g.id));
    const txt = mk('span', 'sg-txt'); txt.append(mk('span', 'sg-title', g.title), mk('span', 'sg-sub', g.sub));
    b.append(ic, txt, chevron()); h.append(b);
    const body = mk('div', 'sg-body'); body.id = 'sg-' + g.id; body.setAttribute('role', 'region'); body.setAttribute('aria-labelledby', b.id); body.hidden = true;
    sec.append(h, body); view.append(sec);
    ST.groups.set(g.id, { sec, btn: b, body });
    b.addEventListener('click', () => tap(g.id));
  }
  parts.forEach((p, i) => { const g = ST.groups.get(where[i]); if (g) g.body.append(...p.els); });
  for (const g of ST.groups.values()) g.sec.hidden = !g.body.childElementCount;   // a group with nothing in it (a build without a part) stays out
  view.classList.add('sg-on');
}
/** open one group (null = none): the others close; its segmented controls get their indicator (3.8's skips a hidden control) */
function set(id, { scroll = false } = {}) {
  ST.open = id;
  for (const [gid, g] of ST.groups) {
    const on = gid === id;
    g.btn.setAttribute('aria-expanded', String(on)); g.body.hidden = !on; g.sec.classList.toggle('open', on);
    if (!on) continue;
    g.body.classList.remove('sg-in');
    if (!busy() && !reduced()) { void g.body.offsetWidth; g.body.classList.add('sg-in'); }
    for (const s of g.body.querySelectorAll('.seg')) { try { if (ST.api.placeInd) ST.api.placeInd(s, true); } catch (e) { /* */ } }
  }
  const g = id && ST.groups.get(id);
  if (scroll && g) requestAnimationFrame(() => { try { g.sec.scrollIntoView({ block: 'start', behavior: reduced() || busy() ? 'auto' : 'smooth' }); } catch (e) { /* */ } });
}
function tap(id) {
  const next = toggled(ST.open, id), g = ST.groups.get(id);
  set(next, { scroll: !!next });
  if (!next && g) requestAnimationFrame(() => { try { g.sec.scrollIntoView({ block: 'nearest' }); } catch (e) { /* */ } });   // closed from its stuck heading: it stays in view
}

/** the group that holds el opens; true when el is in Settings' groups */
export function revealSetting(el) {
  try {
    if (!ST.ready || !el || !el.closest) return false;
    const sec = el.closest('#v-settings .sg'); if (!sec) return false;
    if (ST.open !== sec.dataset.sg) set(sec.dataset.sg);
    return true;
  } catch (e) { return false; }
}

/** the benchmark writes its run and its results into #s-bench-out: its group opens when a run starts and when the results land (results
 *  that land while Settings is not on screen keep it open for the next time Settings shows) */
function watchBench() {
  const out = $('s-bench-out'), g = ST.groups.get('bench'); if (!out || !g || !g.body.contains(out)) return;
  const check = () => {
    const r = benchOpens(out.hidden ? '' : out.textContent, ST.benchRun);
    if (r.open) { if (!r.running && tab() !== 'settings') ST.benchLanded = true; if (ST.open !== 'bench') set('bench'); }
    ST.benchRun = r.running;
  };
  new MutationObserver(check).observe(out, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  ST.benchRun = /^\s*Running\b/.test(out.hidden ? '' : out.textContent);   // a run this page picked up (after a planned fresh page) counts
}

// ------------------------------------------------------------------------------------------------ Cast: its own screen
const SH = () => globalThis.SHELL;
function castScreen() {
  if (!$('v-cast')) return;
  const screen = {
    id: 'cast', title: 'Cast', icon: 'icons/ui/cast.svg', view: 'v-cast', home: true,
    order: -95.5,   // ui/shell.js ranks a registered screen 100 + order after its own list: 4.5 = after Skills, before the grayed Connection
    onOpen() { try { const u = ST.api.castUi && ST.api.castUi(); if (u) u.render(); } catch (e) { diag('cast screen: render failed', e); } },
  };
  const reg = () => { const S = SH(); if (!S || typeof S.register !== 'function') return false; S.register(screen); return true; };
  if (!reg()) addEventListener('p0:shell-ready', reg, { once: true });
  const link = $('s-cast');
  if (link) link.addEventListener('click', () => { const S = SH(); if (S && S.open) S.open('cast'); });
  const vgo = $('cast-voice-go');   // the Cast screen's "Download Voice in Settings › Models"
  if (vgo) vgo.addEventListener('click', () => {
    const S = SH(), m = $('models'); if (S && S.open) S.open('settings');
    if (m) { revealSetting(m); setTimeout(() => m.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }), 90); }
  });
  const paint = () => {
    const n = $('s-cast-n'), c = ST.api.cast; if (!n || !c || typeof c.list !== 'function') return;
    c.list().then((p) => { n.textContent = p.length ? `${p.length} ${p.length === 1 ? 'person' : 'people'}` : 'None'; }).catch(() => {});
  };
  const S = SH(); if (S && typeof S.on === 'function') S.on('open', (id) => { if (id === 'settings') paint(); });
  paint();
}

/** Settings is shown (any way: the dock, a link, a planned fresh page): the overview, every group closed, but a run's Benchmark */
function onShow() {
  const id = openOnShow({ running: ST.benchRun, landed: ST.benchLanded });
  ST.benchLanded = false;
  set(id);
}

export function initSettings(api = {}) {
  if (ST.ready) return;
  ST.api = api || {};
  try {
    const view = $('v-settings');
    if (view) {
      build(view); ST.ready = true;
      set(null);
      watchBench();
      const S = SH(); if (S && typeof S.on === 'function') S.on('open', (id) => { if (id === 'settings') onShow(); });   // before openSettings' revealSetting
    }
  } catch (e) { diag('settings: groups failed', e); }
  try { castScreen(); } catch (e) { diag('settings: the Cast screen failed', e); }
}
// 3.9 settingschat 9415cfa086ca
