// homeplus.js - p0pc0rn 3.9 polish (A1): the home screen's iOS-like touches. Josh (Oct-26): "I am really trying to get the always on
// agent UI/UX to be as seemless as iOS native apps because Ai agents are 'scary' enough already".
//   - P0MENU: a context menu for an icon (a long press on a made app's icon: Open, Change, Remove from Home Screen, Share, Delete,
//     Edit Home Screen); also globalThis.P0MENU for the Apps screen's own long press. The icon lifts over a dimmed, blurred page.
//   - the install ring: an app that was just made or added fills a ring on its home-screen icon the next time the home screen shows,
//     then pops in (SHELL.install).
//   - the activity pill: while an app works on its own (its check, while p0pc0rn is open) a black pill at the top centre of the home
//     screen says what it is doing ("Trip Watch · looking up the weather"); a tap shows the steps, with Pause and the activity log.
// It reads the window event 'p0:apps' (the Apps host) and globalThis.P0STORE (the Apps screen) when they are there; nothing here
// fetches, stores or runs anything on its own. No timer runs while nothing is checking; nothing moves while a render runs (data-busy).
import { islandReducer, islandText, islandTitle, stepDone, pinMenuItems, menuPlace } from './homeplus_core.js';
import { letterIcon, relTime } from './shell_core.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svgUse = (href) => { const s = document.createElementNS(SVGNS, 'svg'), u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', href); s.append(u); s.setAttribute('aria-hidden', 'true'); return s; };
const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v)); return e; };
const busyNow = () => document.documentElement.hasAttribute('data-busy');
const reducedNow = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const SPRING = 'cubic-bezier(.2,.9,.25,1.12)';
const store = () => globalThis.P0STORE || null;
const hhmm = (t) => { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };

// ------------------------------------------------------------------------------------------------ the context menu (P0MENU)
/** show(anchor, items, {title, fromPress}): items = [{label, icon, danger, run}]. fromPress: opened by a finger that is still down, so
 *  the click its lifting makes never closes the menu or picks an item */
export function createMenu({ busy = busyNow, reduced = reducedNow } = {}) {
  let cur = null;
  function close(now) {
    if (!cur) return;
    const c = cur; cur = null;
    document.removeEventListener('keydown', c.onKey, true);
    document.removeEventListener('pointerup', c.onUp, true);
    removeEventListener('resize', c.onResize);
    const fin = () => {
      c.wrap.remove();
      if (c.anchor) c.anchor.style.visibility = c.vis;
      if (c.back && c.back.isConnected && c.back.focus) { try { c.back.focus({ preventScroll: true }); } catch (e) { /* */ } }
    };
    if (now || busy() || reduced() || !c.wrap.animate) return fin();
    const a = c.wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in' });
    a.onfinish = fin; a.oncancel = fin;
  }
  function show(anchor, items, o = {}) {
    close(true);
    if (!anchor || !anchor.getBoundingClientRect || !Array.isArray(items) || !items.length) return null;
    const r = anchor.getBoundingClientRect(), back = document.activeElement;
    const wrap = mk('div', 'hp-menu-wrap'); wrap.id = 'hp-menu';
    const scrim = mk('div', 'hp-menu-scrim'); scrim.setAttribute('aria-hidden', 'true');
    const lift = anchor.cloneNode(true);
    lift.classList.add('hp-lift'); lift.removeAttribute('id'); lift.setAttribute('aria-hidden', 'true'); lift.tabIndex = -1; lift.inert = true;
    for (const e of lift.querySelectorAll('[id]')) e.removeAttribute('id');
    const icon = getComputedStyle(anchor).getPropertyValue('--sh-icon');
    if (icon) lift.style.setProperty('--sh-icon', icon.trim());
    Object.assign(lift.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const menu = mk('div', 'hp-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', o.title ? `${o.title}: actions` : 'Actions');
    if (o.title) { const t = mk('p', 'hp-menu-title', o.title); t.setAttribute('aria-hidden', 'true'); menu.append(t); }
    const st = { wrap, anchor, vis: anchor.style.visibility, back, armed: !o.fromPress, upAt: 0 };
    const armed = () => st.armed || (st.upAt > 0 && performance.now() - st.upAt > 200);
    for (const it of items) {
      const b = mk('button', 'hp-mi' + (it.danger ? ' danger' : '')); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.tabIndex = -1;
      if (it.id) b.dataset.id = it.id;
      b.append(mk('span', 'hp-mi-label', it.label));
      if (it.icon) b.append(svgUse(it.icon));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (!armed()) return; close(true); try { if (typeof it.run === 'function') it.run(); } catch (x) { /* the action's own problem */ } });
      menu.append(b);
    }
    scrim.addEventListener('click', () => { if (armed()) close(); });
    wrap.append(scrim, lift, menu); document.body.append(wrap);
    anchor.style.visibility = 'hidden';   // the lifted copy stands in for it
    const mr = menu.getBoundingClientRect(), p = menuPlace(r, { w: mr.width, h: mr.height }, { w: innerWidth, h: innerHeight });
    Object.assign(menu.style, { top: p.top + 'px', left: p.left + 'px', transformOrigin: `${Math.round(r.left + r.width / 2 - p.left)}px ${p.below ? 0 : Math.round(mr.height)}px` });
    st.onUp = () => { if (!st.upAt) st.upAt = performance.now(); };
    st.onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const bs = [...menu.querySelectorAll('.hp-mi')], i = bs.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % bs.length : (i - 1 + bs.length) % bs.length; bs[n].focus();
      }
    };
    st.onResize = () => close(true);
    document.addEventListener('keydown', st.onKey, true);
    document.addEventListener('pointerup', st.onUp, true);
    addEventListener('resize', st.onResize);
    cur = st;
    if (!busy() && !reduced() && wrap.animate) {
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      lift.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }], { duration: 260, easing: SPRING, fill: 'forwards' });
      menu.animate([{ opacity: 0, transform: 'scale(.82)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 280, easing: SPRING });
    } else lift.classList.add('still');
    const first = menu.querySelector('.hp-mi'); if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* */ } }
    return { close: () => close() };
  }
  return { show, close: () => close(), closeNow: () => close(true), get open() { return !!cur; } };
}

// ------------------------------------------------------------------------------------------------ the home screen's extras
/** api (from ui/shell.js): { tab(), toast(t), sheet(id, title), apps(), open(id, {from}), unpin(id), enterEdit(), on(ev, fn), browser() } */
export function createHomePlus(api = {}) {
  const busy = busyNow, reduced = reducedNow;
  const menu = createMenu({ busy, reduced });
  try { globalThis.P0MENU = { show: (a, items, o) => menu.show(a, items, o), close: () => menu.close(), get open() { return menu.open; } }; } catch (e) { /* not a browser */ }

  // ---- a made app's menu (a long press on its home-screen icon)
  const appOf = (ref) => { try { const A = api.apps && api.apps(), st = A && A.state; return (st && st.apps && st.apps.find((x) => x.id === ref)) || null; } catch (e) { return null; } };
  const rowDelete = (ref) => {   // My apps' own Delete for this app (it asks first): the fallback when the Apps screen has no P0STORE
    const o = document.querySelector(`#apps-mine button[data-app="${CSS.escape(ref)}"]`);
    return o ? [...o.parentElement.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete') || null : null;
  };
  function share(title) {   // the fallback when the Apps screen has no share of its own: a line of text (it says it was made with AI)
    const text = `${title}: an app I made on my phone with p0pc0rn. Made with AI using p0pc0rn.`;
    if (navigator.share) return navigator.share({ title, text }).catch(() => {});
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => api.toast('Copied: paste it anywhere'), () => api.toast('Couldn’t share it'));
    api.toast('Couldn’t share it');
  }
  /** -> true when the menu showed (the icon is a made app's) */
  function pinMenu(icon, sc, o = {}) {
    if (!icon || !sc || !/^app:/.test(sc.id || '')) return false;
    const ST = store(), ref = sc.ref || String(sc.id).slice(4), title = sc.title || 'App', A = api.apps && api.apps(), app = appOf(ref);
    const run = {
      open: () => api.open(sc.id, { from: icon.querySelector('.sh-tile') }),
      change: () => (ST && ST.change ? ST.change(ref) : A && app && A.changeSheet ? A.changeSheet(app) : null),
      unpin: () => { api.unpin(sc.id); api.toast(`${title} left the Home Screen`); },
      share: () => (ST && ST.share ? ST.share(ref) : share(title)),
      delete: () => { if (ST && ST.remove) return ST.remove(ref); const d = rowDelete(ref); if (d) d.click(); else api.toast('Delete it in Apps › My apps'); },
      edit: () => api.enterEdit(),
    };
    const items = pinMenuItems({ canChange: !!((ST && ST.change) || (A && A.changeSheet && app)), canShare: true, canDelete: !!((ST && ST.remove) || rowDelete(ref)) })
      .map((it) => Object.assign({}, it, { run: run[it.id] }));
    return !!menu.show(icon, items, { title, fromPress: !!o.fromPress });
  }

  // ---- the install ring (SHELL.install): the next time the home screen shows, the tile fills a ring, then pops in
  const pending = new Set();
  let ringT = 0;
  function installing(id) { if (!id) return; pending.add(String(id)); schedule(api.tab && api.tab() === 'home' ? 80 : null); }
  function schedule(ms) { if (ms == null) return; clearTimeout(ringT); ringT = setTimeout(play, ms); }
  function play() {
    ringT = 0;
    if (api.tab && api.tab() !== 'home') return;
    for (const id of [...pending]) {
      const b = document.querySelector(`#home-grid .sh-app[data-id="${CSS.escape(id)}"]`); if (!b) continue;   // not drawn yet: the next time
      pending.delete(id);
      if (!busy() && !reduced() && b.animate) ring(b);
    }
  }
  function ring(b) {
    const tile = b.querySelector('.sh-tile'); if (!tile || tile.querySelector('.hp-ring')) return;
    b.classList.add('hp-installing');
    const svg = svgEl('svg', { class: 'hp-ring', viewBox: '0 0 36 36', 'aria-hidden': 'true' });
    const fill = svgEl('circle', { class: 'hp-ring-fill', cx: 18, cy: 18, r: 14, pathLength: 100 });
    svg.append(svgEl('circle', { class: 'hp-ring-track', cx: 18, cy: 18, r: 14 }), fill); tile.append(svg);
    const done = () => {
      svg.remove(); b.classList.remove('hp-installing');
      if (!busy() && !reduced()) tile.animate([{ transform: 'scale(.78)' }, { transform: 'scale(1.1)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34,1.32,.64,1)' });
    };
    const a = fill.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 1100, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
    a.onfinish = done; a.oncancel = done;
  }

  // ---- the activity pill: an app working on its own (its check)
  let st = null, endT = 0, pill = null, sheetOpen = null;
  function pillEl() {
    if (pill && pill.isConnected) return pill;
    const home = document.getElementById('v-home'); if (!home) return null;
    pill = mk('button', 'hp-island'); pill.type = 'button'; pill.id = 'hp-island'; pill.hidden = true;
    pill.append(mk('span', 'hp-isl-ico'), mk('span', 'hp-isl-text'), mk('span', 'hp-isl-spin'));
    pill.querySelector('.hp-isl-spin').setAttribute('aria-hidden', 'true');
    pill.addEventListener('click', openSheet);
    home.append(pill);
    return pill;
  }
  function iconInto(box, s) {
    box.replaceChildren(); box.className = 'hp-isl-ico'; box.style.background = '';
    if (!s) return;
    let u = null; try { u = globalThis.P0APPICON && s.appId ? globalThis.P0APPICON.url(s.appId) : null; } catch (e) { u = null; }
    if (u && u.u120) { const i = new Image(); i.alt = ''; i.src = u.u120; box.append(i); return; }
    const li = letterIcon(s.name); box.textContent = li.letter; box.style.background = li.color; box.classList.add('letter');
  }
  function paint() {
    const p = pillEl(); if (!p) return;
    const was = !p.hidden;
    if (!st) { p.hidden = true; document.documentElement.removeAttribute('data-hp-island'); return; }
    const text = islandText(st);
    p.querySelector('.hp-isl-text').textContent = text;
    iconInto(p.querySelector('.hp-isl-ico'), st);
    p.dataset.phase = st.phase; p.dataset.found = st.phase === 'done' && st.found ? '1' : '';
    p.setAttribute('aria-label', `${text}. Show what it is doing.`);
    p.hidden = false; document.documentElement.setAttribute('data-hp-island', '');
    if (!was && !busy() && !reduced() && p.animate) p.animate([{ opacity: 0, transform: 'translateX(-50%) scale(.6)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 320, easing: SPRING });
    if (sheetOpen && sheetOpen.isConnected) fillSheet(sheetOpen);
  }
  function feed(d) {
    if (!d || !['check-start', 'step', 'check-end'].includes(d.type)) return;
    st = islandReducer(st, d); clearTimeout(endT);
    if (st && st.phase === 'done') endT = setTimeout(() => { if (st && st.phase === 'done') { st = null; paint(); } }, 3200);   // one short end state, then it goes
    paint();
  }
  function adopt() {   // a check already running when the home screen shows (the events came while this page was elsewhere)
    if (st) return;
    let c = null; try { const S2 = store(); c = S2 && S2.checking ? S2.checking() : null; } catch (e) { c = null; }
    if (!c || !c.appId) return;
    st = { appId: c.appId, name: String(c.name || 'An app').slice(0, 40), phase: 'checking', at: c.at || Date.now(), steps: (c.steps || []).slice(-20), found: 0, ok: true };
    paint();
  }
  function fillSheet(sh) {
    const body = sh.querySelector('.hp-act-body'); if (!body || !st) return;
    const t = sh.querySelector('.title'); if (t) t.textContent = islandTitle(st);
    const ul = mk('ul', 'hp-act-steps');
    const li = (text, at, cls) => { const l = mk('li', cls || ''); l.append(mk('span', 'hp-act-what', text), mk('span', 'hp-act-when footnote', at ? hhmm(at) : '')); return l; };
    ul.append(li(`Started ${relTime(st.at)}`, st.at, 'hp-act-start'));
    for (const s of st.steps || []) { const w = stepDone(s); if (w) ul.append(li(w, s.at)); }
    if (st.phase === 'done') ul.append(li(!st.ok ? 'Couldn’t check this time' + (st.error ? `: ${st.error}` : '') : st.found ? `Found ${st.found} ${st.found === 1 ? 'thing' : 'things'} for you to look at` : 'Nothing new', st.endAt, 'hp-act-end'));
    else ul.append(li('Still working…', null, 'hp-act-now'));
    const S2 = store(), sees = S2 && S2.seesLine && st.appId ? S2.seesLine(st.appId) : '';   // what it can see, in plain words (ui/storefront.js)
    body.replaceChildren(ul, mk('p', 'hp-act-calm footnote', (sees ? sees + ' ' : '') + 'It only suggests: nothing happens until you confirm. It works only while p0pc0rn is open.'));
  }
  function openSheet() {
    if (!st || !api.sheet) return;
    const s = st, S2 = store();
    const { sheet, close } = api.sheet('hp-activity', islandTitle(s));
    sheet.classList.add('hp-act-sheet');
    sheet.append(mk('div', 'hp-act-body'));
    const row = mk('div', 'hp-act-btns');
    if (S2 && S2.pause && s.appId) {
      const pz = mk('button', 'btn', `Pause ${s.name}`); pz.type = 'button'; pz.id = 'hp-act-pause';
      pz.onclick = () => { try { S2.pause(s.appId, true); } catch (e) { /* */ } close(); api.toast(`${s.name} is paused. Turn it back on in its settings.`); };
      row.append(pz);
    }
    if (S2 && S2.activity) { const ac = mk('button', 'btn ghost', 'See activity'); ac.type = 'button'; ac.id = 'hp-act-log'; ac.onclick = () => { close(); try { S2.activity(); } catch (e) { /* */ } }; row.append(ac); }
    const x = mk('button', 'btn ghost', 'Close'); x.type = 'button'; x.dataset.close = ''; row.append(x);
    sheet.append(row);
    sheetOpen = sheet; fillSheet(sheet);
  }
  addEventListener('p0:apps', (e) => { feed(e && e.detail); });

  if (api.on) {
    api.on('home', () => { schedule(380); adopt(); });   // after the screen shrinks into its icon
    api.on('open', (id) => { if (id === 'browser' && api.browser) { const b = api.browser(); if (b && b.render) b.render(); } });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && api.tab && api.tab() === 'home') adopt(); });
  setTimeout(adopt, 1500);
  return { pinMenu, installing, menuOpen: () => menu.open, closeMenu: () => menu.closeNow(), get island() { return st; } };
}
// 3.9 polish (A1)
