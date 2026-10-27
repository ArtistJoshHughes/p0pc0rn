// storefront.js - p0pc0rn 3.9 polish: the Apps screen as an app store (a hero to make an app, what needs you, My apps as cards with their
// icons, the shelves as cards), Games as its second pane (a big cover per game, Play, "You vs Juli"), Skills as cards. Josh (Oct-26):
// "library create Juli and music feel like 'apps' enough right now but apps browser games and skills are just text with very little
// visual polish". The Apps host (makeapp/host.js) still renders its rows, with the ids, classes and buttons the bench and the desk suites
// click; this module dresses each row as the host draws it (one MutationObserver per list) and adds what a row has no room for: its
// icon, its chips, its plain sentence, swipe to delete, press and hold for the menu, a tap for its page. The trust parts (the intro, the
// settings page, the activity log, pauses) are ui/works.js. Also window.P0STORE, for the home screen (ui/homeplus.js) and the host.
import { worksAlone, withJuli, isGame, WORKS, plainOf, seesOf, stopOf, iconOf, coverPath, skillCard, lookLine, permRows, firstSentence, widgetLine, stopShort, seesShort } from './storefront_core.js';
import { letterIcon } from './shell_core.js';
import { designArt } from './storefront_core.js';   // 3.9 Wallet Watch: a design's own icon (icons/apps/)
import { createWorks } from './works.js';

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v)); return e; };
const useIcon = (href, cls) => { const s = svgEl('svg', { 'aria-hidden': 'true' }); if (cls) s.setAttribute('class', cls); const u = svgEl('use', { href }); s.append(u); return s; };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const busy = () => document.documentElement.hasAttribute('data-busy');
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* this page only */ } };
const PANE_KEY = 'p0pc0rn:apps:pane';
const SKILL_ICON = { make: '#i-sparkle', change: '#i-pencil', chat: '#i-chat', game: '#i-sh-game' };
const friendly = (name) => String(name || '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** an icon tile: a made app's own icon (Make an icon), else its letter on its colour (as its home-screen pin); a design: its glyph */
export function iconTile(o, cls = '') {
  const t = mk('span', 'sf-ico' + (cls ? ' ' + cls : '')); t.setAttribute('aria-hidden', 'true');
  const AI = globalThis.P0APPICON;
  if (o && o.app && AI && AI.url && AI.url(o.app.id)) { const i = AI.img(o.app.id); if (i) { i.sizes = '60px'; t.append(i); t.classList.add('art'); return t; } }
  { const art = designArt(o && o.app ? o.app.skel : o && o.manifest ? o.manifest.id : ''); if (art) { const i = new Image(); i.alt = ''; i.decoding = 'async'; i.draggable = false; i.srcset = art.srcset; i.sizes = '60px'; i.src = art.src; t.append(i); t.classList.add('art'); return t; } }   // 3.9 Wallet Watch
  if (o && o.app) { const li = letterIcon(o.app.name); t.textContent = li.letter; t.style.background = li.color; t.classList.add('letter'); return t; }
  const ic = iconOf(o && o.manifest);
  if (ic.glyph) {
    const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); s.style.color = ic.tint;
    for (const d of ic.glyph) s.append(svgEl('path', { d }));
    t.append(s); t.classList.add('glyph'); t.dataset.design = o.manifest.id; return t;
  }
  t.textContent = ic.letter; t.style.background = ic.color; t.classList.add('letter'); return t;
}

/** the cover a game gets until its picture is in icons/games/<id>-cover.png: a board with discs and the game's name as its design names
 *  it (its first word, then the rest), drawn here (no file, no network) */
function drawnCover(id, name) {
  const s = svgEl('svg', { viewBox: '0 0 320 180', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  const g = svgEl('linearGradient', { id: 'stc-bg-' + id, x1: '0', y1: '0', x2: '1', y2: '1' });
  g.append(svgEl('stop', { offset: '0', 'stop-color': '#2B1846' }), svgEl('stop', { offset: '.55', 'stop-color': '#4A1E5C' }), svgEl('stop', { offset: '1', 'stop-color': '#B4532F' }));
  const b = svgEl('linearGradient', { id: 'stc-bd-' + id, x1: '0', y1: '0', x2: '0', y2: '1' });
  b.append(svgEl('stop', { offset: '0', 'stop-color': '#3D7BEA' }), svgEl('stop', { offset: '1', 'stop-color': '#1F4FB8' }));
  defs.append(g, b); s.append(defs);
  s.append(svgEl('rect', { x: 0, y: 0, width: 320, height: 180, fill: `url(#stc-bg-${id})` }));
  s.append(svgEl('circle', { cx: 70, cy: 40, r: 64, fill: '#FFB347', opacity: '.16' }), svgEl('circle', { cx: 300, cy: 170, r: 70, fill: '#8B7CFF', opacity: '.18' }));
  const bx = 150, by = 36, cw = 21, rows = 6, cols = 7;   // the board on the right (the "You vs Juli" badge sits bottom left)
  s.append(svgEl('rect', { x: bx - 8, y: by - 8, width: cols * cw + 16, height: rows * cw + 14, rx: 12, fill: `url(#stc-bd-${id})` }));
  s.append(svgEl('rect', { x: bx - 14, y: by + rows * cw + 5, width: cols * cw + 28, height: 8, rx: 4, fill: '#183C8F' }));
  const disc = { '5,1': 'r', '5,2': 'y', '5,3': 'r', '5,4': 'y', '4,2': 'r', '4,3': 'y', '4,4': 'r', '3,3': 'y', '3,4': 'r', '2,4': 'y', '5,5': 'r', '4,5': 'y' };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = disc[`${r},${c}`], cx = bx + c * cw + cw / 2, cy = by + r * cw + cw / 2;
    s.append(svgEl('circle', { cx, cy, r: 7.8, fill: k === 'r' ? '#FF5A5F' : k === 'y' ? '#FFC83D' : '#12245C' }));
    if (k) s.append(svgEl('circle', { cx: cx - 2.4, cy: cy - 2.4, r: 2.4, fill: '#FFFFFF', opacity: '.35' }));
  }
  s.append(svgEl('circle', { cx: bx + 5 * cw + cw / 2, cy: by - 17, r: 7.8, fill: '#FFC83D' }));   // Juli's next disc, about to drop
  const words = String(name || '').trim().split(/\s+/).filter(Boolean), lines = [words[0] || '', words.slice(1).join(' ')].filter(Boolean).map((l) => l.slice(0, 22));
  const size = Math.max(13, Math.min(26, Math.floor(118 / (0.6 * Math.max(1, ...lines.map((l) => l.length))))));   // the left of the board: about 118 px
  lines.forEach((l, k) => {
    const t = svgEl('text', { x: 22, y: (lines.length === 1 ? 78 : 64) + k * Math.round(size * 1.08), fill: k ? '#FFD34D' : '#FFFFFF', 'font-size': size, 'font-weight': 800, 'font-family': '-apple-system, system-ui, sans-serif' });
    t.textContent = l; s.append(t);
  });
  return s;
}
const covers = new Map();   // id -> Promise<bool>: is the picked cover picture there (one check per page)
function coverOk(id) {
  if (!covers.has(id)) covers.set(id, new Promise((res) => {
    const i = new Image(); let done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(t); i.onload = i.onerror = null; res(v); };
    const t = setTimeout(() => end(false), 8000);
    i.onload = () => end(i.naturalWidth > 0); i.onerror = () => end(false); i.src = coverPath(id);
  }));
  return covers.get(id);
}
function coverEl(id, name) {
  const c = mk('span', 'sf-cover'); c.dataset.cover = 'drawn'; c.setAttribute('role', 'img'); c.setAttribute('aria-label', `${name}: the game’s cover`);
  c.append(drawnCover(id, name));
  coverOk(id).then((ok) => { if (!ok || !c.isConnected) return; const i = new Image(); i.alt = ''; i.decoding = 'async'; i.src = coverPath(id); i.onload = () => { c.replaceChildren(i); c.dataset.cover = 'art'; }; });
  return c;
}

export function createStorefront({ apps = () => null, go = () => {}, tab = () => '', toast = () => {}, sheet = null, diag = () => {} } = {}) {
  const A = () => { try { const X = apps(); return X && X.state ? X : null; } catch (e) { return null; } };
  const ST = () => { const X = A(); return X ? X.state : null; };
  const appById = (id) => { const s = ST(); return s && s.apps ? s.apps.find((a) => a.id === id) || null : null; };
  const skelOf = (id) => { const s = ST(); return s && s.skels ? s.skels.get(id) || null : null; };
  /** the game a skill is for: the design that brings it (so its card names the game as the design does, never a name written here) */
  const gameOf = (skill) => { const s = ST(); for (const sk of (s && s.skels ? s.skels.values() : [])) if (sk && isGame(sk.manifest) && sk.skills && Object.prototype.hasOwnProperty.call(sk.skills, skill)) return sk.manifest; return null; };
  const P = { pane: ssGet(PANE_KEY) === 'games' ? 'games' : 'apps' };
  const works = createWorks({ apps: A, toast, sheet, iconTile, appById, skelOf, go });

  // ---------------------------------------------------------------------------------------------- panes: Apps | Games
  function pane(id) {
    if (id === undefined) return P.pane;
    P.pane = id === 'games' ? 'games' : 'apps'; ssSet(PANE_KEY, P.pane);
    for (const p of document.querySelectorAll('#v-apps .sf-pane')) p.hidden = p.dataset.pane !== P.pane;
    for (const b of document.querySelectorAll('#sf-seg [data-pane]')) b.setAttribute('aria-selected', String(b.dataset.pane === P.pane));
    if (tab() === 'apps') { const t = $('title'); if (t) t.textContent = P.pane === 'games' ? 'Games' : 'Apps'; const m = $('main'); if (m) m.scrollTop = 0; }
    return P.pane;
  }
  function wirePanes() {
    for (const b of document.querySelectorAll('#sf-seg [data-pane]')) b.addEventListener('click', () => pane(b.dataset.pane));
    const act = $('sf-activity'); if (act) act.addEventListener('click', () => works.activity());
    pane(P.pane);
  }

  // ---------------------------------------------------------------------------------------------- dressing the host's rows
  const chip = (text, cls = '') => mk('span', 'sf-chip' + (cls ? ' ' + cls : ''), text);
  function chipsFor(m) {
    const box = mk('span', 'sf-chips');
    if (isGame(m)) box.append(chip('Game', 'game'), chip('You vs Juli', 'vs'));
    else if (worksAlone(m)) { box.append(chip(WORKS, 'works')); if (withJuli(m)) box.append(chip('with Juli', 'juli')); }
    return box;
  }
  /** a tap on a card's icon or words (not its buttons) opens its page; press and hold opens its menu; a made app's card swipes */
  function cardTaps(row, onTap, onHold) {
    const zone = row.querySelector('.sf-slide') || row;
    let t0 = null, x0 = 0, y0 = 0, moved = false, held = false;
    zone.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('button, a, input, label')) return;
      x0 = e.clientX; y0 = e.clientY; moved = false; held = false; clearTimeout(t0);
      if (onHold) t0 = setTimeout(() => { t0 = null; if (moved) return; held = true; onHold(row); }, 520);
    });
    zone.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - x0) > 8 || Math.abs(e.clientY - y0) > 8) { moved = true; clearTimeout(t0); } });
    const up = () => clearTimeout(t0);
    zone.addEventListener('pointerup', up); zone.addEventListener('pointercancel', up);
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
    zone.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, label') || held || row.dataset.swiped || row.classList.contains('sf-open')) { if (row.classList.contains('sf-open') && !e.target.closest('button')) close1(row); return; }
      onTap(row);
    });
    zone.setAttribute('tabindex', '-1');
  }
  // swipe a made app's card left: Delete shows behind it (a tap there asks first, through the host's own Delete); a card that is open
  // closes on any tap; press and hold opens the menu (so deleting never depends on a swipe)
  const W = 92;
  function close1(row) { row.classList.remove('sf-open'); row.classList.add('sf-swiping'); const s = row.querySelector('.sf-slide'); if (s) { s.style.transition = ''; s.style.transform = ''; } setTimeout(() => { if (!row.classList.contains('sf-open')) row.classList.remove('sf-swiping'); }, reduced() ? 0 : 340); }
  function swipe(row, onDelete) {
    const s = row.querySelector('.sf-slide'); if (!s) return;
    let pid = null, x0 = 0, y0 = 0, dx = 0, drag = false;
    const set = (v, ease) => { s.style.transition = ease && !reduced() ? '' : 'none'; s.style.transform = v ? `translateX(${v}px)` : ''; };
    s.addEventListener('pointerdown', (e) => { if (e.button > 0 || e.target.closest('button')) return; pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; drag = false; dx = row.classList.contains('sf-open') ? -W : 0; });
    s.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!drag && Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { pid = null; return; }   // a scroll
      if (!drag && Math.abs(mx) > 10) { drag = true; row.classList.add('sf-swiping'); try { s.setPointerCapture(pid); } catch (x) { /* */ } }
      if (drag) { dx = Math.max(-W - 16, Math.min(0, mx + (row.classList.contains('sf-open') ? -W : 0))); set(dx); }
    });
    const end = (e) => {
      if (e.pointerId !== pid) return; pid = null;
      if (!drag) return; drag = false;
      const open = dx < -W / 2; row.classList.toggle('sf-open', open); set(open ? -W : 0, true);
      if (!open) setTimeout(() => { if (!row.classList.contains('sf-open')) row.classList.remove('sf-swiping'); }, reduced() ? 0 : 340); else row.classList.remove('sf-swiping');
      row.dataset.swiped = '1'; setTimeout(() => { delete row.dataset.swiped; }, 120);
      if (open) for (const r of document.querySelectorAll('#apps-mine .app-row.sf-open')) if (r !== row) close1(r);
    };
    s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
    const del = mk('span', 'sf-swipe-del', 'Delete'); del.setAttribute('aria-hidden', 'true');
    del.addEventListener('click', (e) => { e.stopPropagation(); close1(row); onDelete(); });
    row.prepend(del);
  }
  /** the card's icon is also its way in for a keyboard or VoiceOver (a row keeps exactly its host buttons: the desk suites count them) */
  function keyOpen(el, label, fn) {
    el.removeAttribute('aria-hidden'); el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', label);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }
  /** move a row's children into one sliding layer (the buttons keep their parent: Open, Change, Add to Home and Delete stay together) */
  function slide(row) { if (row.querySelector(':scope > .sf-slide')) return; const s = mk('span', 'sf-slide'); while (row.firstChild) s.append(row.firstChild); row.append(s); }

  function dressMine(row) {
    const a = appById(row.dataset.mine || (row.querySelector('button[data-app]') || {}).dataset?.app); if (!a) return;
    const skel = skelOf(a.skel), m = skel && skel.manifest;
    row.classList.add('sf-card', 'sf-mine-card'); row.dataset.mine = a.id;
    const txt = row.querySelector('.app-txt'), name = txt && txt.querySelector('.sw-name');
    const ico = iconTile({ app: a });
    if (a.badge) { const b = mk('span', 'sf-badge', a.badge > 99 ? '99+' : a.badge); ico.append(b); }
    row.prepend(ico);
    if (name && m) name.after(chipsFor(m));
    if (txt && a.badge) txt.append(mk('span', 'footnote sf-look', lookLine(a.badge)));
    if (txt && m) { const p = mk('span', 'footnote dim sf-plain', plainOf(m)); txt.append(p); }
    if (txt && m) txt.append(mk('span', 'footnote sf-stop', stopShort(m)));   // how to stop it, on every card
    const open = row.querySelector('button[data-app]'); if (open) { open.classList.add('sf-get'); if (m && isGame(m)) open.setAttribute('aria-label', 'Play ' + a.name); }
    const end = row.querySelector('.li-end'); if (end) end.classList.add('sf-acts');
    const del = end ? [...end.querySelectorAll('button')].find((b) => b.textContent === 'Delete') : null;
    if (del) del.classList.add('sf-del');
    const ch = end ? end.querySelector('button[data-change]') : null; if (ch) ch.classList.add('sf-quiet');
    slide(row);
    swipe(row, () => { if (del) del.click(); });
    cardTaps(row, () => works.settings(a.id), () => menuFor(a, ico));
    keyOpen(ico, `${a.name}: its settings, what it can see, Pause`, () => works.settings(a.id));
    row.setAttribute('role', 'group'); row.setAttribute('aria-label', `${a.name}${m ? ', ' + (worksAlone(m) ? WORKS : isGame(m) ? 'a game' : m.name) : ''}${a.badge ? ', ' + lookLine(a.badge) : ''}`);
  }
  function dressShelf(row) {
    const s = skelOf(row.dataset.skel); if (!s) return;
    const m = s.manifest, txt = row.querySelector('.app-txt'), name = txt && txt.querySelector('.sw-name');
    if (isGame(m) && row.closest('#apps-games')) return dressGame(row, s);
    row.classList.add('sf-card', 'sf-shelf-card');
    const ico = iconTile({ manifest: m }); row.prepend(ico); keyOpen(ico, `About ${m.name}: what it does, what it can see, how to stop it`, () => designPage(m.id));
    if (name) name.after(chipsFor(m));
    if (txt && worksAlone(m)) txt.append(mk('span', 'footnote sf-stop', 'Once it’s yours, you can stop it any time with the Pause switch in its settings, or delete it.'));
    const first = row.querySelector('.li-end button'); if (first) first.classList.add('sf-get');
    const end = row.querySelector('.li-end'); if (end) end.classList.add('sf-acts');
    cardTaps(row, () => designPage(m.id), null);
  }
  function dressGame(row, s) {
    const m = s.manifest, X = A();
    row.classList.add('sf-game');
    const top = mk('span', 'sf-game-top');
    top.append(coverEl(m.id, m.name), mk('span', 'sf-vs', 'You vs Juli'));
    row.prepend(top);
    const txt = row.querySelector('.app-txt'), foot = txt && txt.querySelector('.footnote');
    if (foot) { foot.classList.add('sf-gline'); foot.textContent = firstSentence(plainOf(m)); }   // one line on the cover card; its page has the rest
    const first = row.querySelector('.li-end button'); if (first) { first.classList.add('sf-play'); first.textContent = 'Play'; }
    const mine = X && X.state ? (X.state.apps || []).filter((a) => a.skel === m.id) : [];
    if (txt && mine.length) txt.append(mk('span', 'footnote dim sf-yours', mine.length === 1 ? 'Play opens your game, with its score.' : `Play opens the one you played last (you have ${mine.length}: see My apps).`));
  }
  function dressSkill(row) {
    const X = A(), k = X && X.state && X.state.skills && X.state.skills.getSkill ? X.state.skills.getSkill(row.dataset.skill) : null; if (!k) return;
    const from = k.from && k.from !== 'p0pc0rn' && k.from !== 'import' ? ((skelOf(String(k.from).replace(/^[a-z]+:/, '')) || {}).manifest || {}).name || '' : '';
    const c = skillCard(k, from);
    row.classList.add('sf-card', 'sf-skill-card'); if (c.off) row.classList.add('sf-off');
    const t = mk('span', 'sf-ico glyph skill'); t.setAttribute('aria-hidden', 'true'); t.dataset.kind = c.icon; t.append(useIcon(SKILL_ICON[c.icon] || '#i-sparkle'));
    row.prepend(t);
    const txt = row.querySelector('.app-txt'), name = txt && txt.querySelector('.sw-name');
    const game = (k.for || []).includes('game') ? gameOf(k.name) : null;
    if (name) { name.textContent = game ? `Play ${game.name}` : friendly(k.name); name.classList.remove('dim'); }
    for (const f of (txt ? txt.querySelectorAll('.footnote') : [])) f.classList.add('sf-hide');
    const purpose = mk('span', 'footnote sf-purpose', c.purpose), chips = mk('span', 'sf-chips sf-can');
    for (const x of c.chips) chips.append(chip(x, x === 'Off' ? 'off' : ''));
    if (name) name.after(purpose, chips);
    const end = row.querySelector('.li-end'); if (end) end.classList.add('sf-acts');
    const v = end && end.querySelector('button'); if (v) v.classList.add('sf-get');
  }
  /** what needs the person: every made app with something to look at, newest first; a tap opens it (at its items: its own first screen) */
  function needs() {
    const box = $('sf-needs'), S2 = ST(); if (!box) return;
    const list = S2 && S2.apps ? S2.apps.filter((a) => (a.badge || 0) > 0 && skelOf(a.skel)) : [];
    box.hidden = !list.length;
    const keys = list.map((a) => a.id + ':' + a.badge).join('|'); if (box.dataset.keys === keys) return; box.dataset.keys = keys;
    box.replaceChildren();
    if (!list.length) return;
    box.append(mk('p', 'sf-needs-head', list.length === 1 ? 'Waiting for you' : `${list.length} apps are waiting for you`));
    for (const a of list) {
      const b = mk('button', 'sf-need'); b.type = 'button'; b.dataset.app = a.id;
      const ico = iconTile({ app: a }); ico.append(mk('span', 'sf-badge', a.badge > 99 ? '99+' : a.badge));
      const t = mk('span', 'sf-need-txt'); t.append(mk('span', 'headline', a.name), mk('span', 'footnote dim', `${lookLine(a.badge)} · It only suggests: nothing changes until you confirm.`));
      b.append(ico, t, mk('span', 'sf-need-go', 'Open'));
      b.setAttribute('aria-label', `${a.name}: ${lookLine(a.badge)}. Open it.`);
      b.addEventListener('click', () => open(a.id));
      box.append(b);
    }
  }
  const DRESS = [['apps-mine', '.app-row', dressMine], ['apps-agentic', '.skel-row', dressShelf], ['apps-tools', '.skel-row', dressShelf], ['apps-games', '.skel-row', dressShelf], ['apps-skills', '.skill-row', dressSkill]];
  function dressAll(id) {
    for (const [lid, sel, fn] of DRESS) {
      if (id && id !== lid) continue;
      const box = $(lid); if (!box) continue;
      for (const row of box.querySelectorAll(':scope > ' + sel)) { if (row.dataset.st) continue; row.dataset.st = '1'; try { fn(row); } catch (e) { diag('storefront: a card could not be drawn', { list: lid, message: String((e && e.message) || e).slice(0, 120) }); } }
      if (lid === 'apps-mine') needs();
      if (lid === 'apps-games') { const none = $('sf-games-none'); if (none) none.hidden = !!box.querySelector('.skel-row'); }
    }
  }
  function watch() {
    for (const [lid] of DRESS) {
      const box = $(lid); if (!box) continue;
      new MutationObserver(() => dressAll(lid)).observe(box, { childList: true });
    }
    dressAll();
  }

  // ---------------------------------------------------------------------------------------------- pages and menus
  /** a design's own page (the shelf card's tap): what it does, sees, how to stop it, and Get / Open */
  function designPage(skelId) {
    const s = skelOf(skelId), X = A(); if (!s || !sheet || !X) return;
    const m = s.manifest, mine = (X.state.apps || []).find((a) => a.skel === m.id);
    const { sheet: sh, close } = sheet('sf-design', m.name);
    sh.classList.add('sf-page');
    const head = mk('div', 'sf-page-head'); head.append(iconTile({ manifest: m }, 'big'));
    const ht = mk('div', 'sf-page-ht'); ht.append(chipsFor(m), mk('p', 'footnote dim', s && X.state.bundled && X.state.bundled.has(m.id) ? 'Comes with p0pc0rn' : 'Imported')); head.append(ht);
    sh.append(head, mk('p', 'callout sf-page-plain', plainOf(m)));
    const sec = (title, text) => { const d = mk('div', 'sf-sec'); d.append(mk('p', 'label', title), mk('p', 'footnote', text)); return d; };
    sh.append(sec('What it can see', seesOf(m).line), sec('How to stop it', stopOf(m)));
    if (worksAlone(m) && withJuli(m)) sh.append(sec('You stay in charge', 'It only suggests: nothing happens until you confirm.'));
    const get = mk('button', 'btn cta', isGame(m) ? 'Play' : mine ? 'Open' : 'Get'); get.type = 'button'; get.id = 'sf-design-get';
    get.onclick = () => { close(); X.getOrOpen ? X.getOrOpen(m.id) : null; };
    const own = mk('button', 'btn', 'Make my own with Juli'); own.type = 'button';
    own.onclick = () => { close(); const r = document.querySelector(`.skel-row[data-skel="${CSS.escape(m.id)}"]`), b = r && [...r.querySelectorAll('button')].find((x) => /^Make my own$/.test(x.textContent)); if (b) b.click(); };
    sh.append(get, own);
  }
  /** press and hold a made app: Open, Change, Add to Home, Share, Delete (the home screen's menu, ui/homeplus.js P0MENU) */
  function menuFor(a, anchor) {
    const M = globalThis.P0MENU; if (!M || !M.show) return works.settings(a.id);
    M.show(anchor, [
      { label: 'Open', icon: '#i-chevron', run: () => open(a.id) },
      { label: 'Change', icon: '#i-pencil', run: () => change(a.id) },
      { label: home1(a.id) ? 'Remove from Home Screen' : 'Add to Home Screen', icon: '#i-sh-home', run: () => home(a.id) },
      { label: 'Share', icon: '#i-share', run: () => share(a.id) },
      { label: 'Settings', icon: '#i-gear', run: () => works.settings(a.id) },
      { label: 'Delete', icon: '#i-trash', danger: true, run: () => remove(a.id) },
    ], { title: a.name, fromPress: true });   // opened by a finger that is still down: its lift neither closes the menu nor picks an item
  }
  const home1 = (appId) => { const b = document.querySelector(`#apps-mine .sh-pin-btn[data-pin="${CSS.escape(appId)}"]`); return b ? b.getAttribute('aria-pressed') === 'true' : false; };

  // ---------------------------------------------------------------------------------------------- the API (window.P0STORE)
  function open(appId) { const X = A(), a = appById(appId); if (X && a) X.openApp(a); }
  function change(appId) { const X = A(), a = appById(appId); if (X && a) X.changeSheet(a); }
  function remove(appId) { const X = A(), a = appById(appId); if (X && a && X.askRemove) X.askRemove(a); }
  function home(appId) { const b = document.querySelector(`#apps-mine .sh-pin-btn[data-pin="${CSS.escape(appId)}"]`); if (b) b.click(); }
  async function share(appId) {
    const a = appById(appId), s = a && skelOf(a.skel); if (!a) return;
    const text = `${a.name}: ${s ? plainOf(s.manifest) : ''}\nAn app I made on my phone with p0pc0rn. Made with AI using p0pc0rn.`.replace(/: \n/, '\n');
    try { if (navigator.share) { await navigator.share({ title: a.name, text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Copied: paste it anywhere'); } catch (e) { toast('Sharing isn’t available here'); }
  }
  function appOf(appId) {
    const a = appById(appId), s = a && skelOf(a.skel); if (!a) return null;
    return { id: a.id, name: a.name, skel: a.skel, plain: s ? plainOf(s.manifest) : '', works: !!(s && worksAlone(s.manifest)), badge: a.badge || 0 };
  }
  /** the home screen's widget for an app that works for you: a line of plain words under its count (ui/shell.js renderWidgets) */
  function widgetLineOf(appId) { const a = appById(appId), s = a && skelOf(a.skel); return s ? widgetLine(s.manifest) : ''; }
  /** what an app can see, in one line (the activity pill's sheet, ui/homeplus.js) */
  function seesLineOf(appId) { const a = appById(appId), s = a && skelOf(a.skel); return s ? seesShort(s.manifest) + '.' : ''; }
  const api = { pane, open, change, share, remove, home, appOf, widgetLine: widgetLineOf, seesLine: seesLineOf, iconEl: (m, cls) => iconTile({ manifest: m }, cls), appIconEl: (a, cls) => iconTile({ app: a }, cls), permRows,
    settings: works.settings, activity: works.activity, pause: works.pause, paused: works.paused, pauseAll: works.pauseAll, checking: works.checking,
    intro: works.intro, needsIntro: works.needsIntro, beforeAfter: works.beforeAfter,
    makePreview: (skelId, slots, name) => { const X = A(); if (!X || !X.confirmMake) return Promise.resolve(null); pane('apps'); return X.confirmMake(skelId, slots, name); },
    refresh: () => { for (const [lid] of DRESS) { const b = $(lid); if (b) for (const r of b.children) delete r.dataset.st; } dressAll(); } };
  try { wirePanes(); watch(); } catch (e) { diag('storefront: start failed', { message: String((e && e.message) || e).slice(0, 160) }); }
  try { globalThis.P0STORE = api; } catch (e) { /* not a browser */ }
  return api;
}
