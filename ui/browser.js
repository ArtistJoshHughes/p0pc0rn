// browser.js - p0pc0rn 3.9: the Browser screen. Josh asked "is it possible to have a webrowser within a PWA?": not a real one (most
// sites refuse to be shown inside another page). So: a start page. Words search the web (DuckDuckGo); an address opens; every link opens
// in the phone's own in-app browser sheet (a new window from a Home Screen app), which has its own Done button to come back. p0pc0rn
// fetches nothing here: the page talks to no new host, and only http(s) links ever open.
// 3.9 polish (A1): a start page like the phone's own browser (Josh: "apps browser games and skills are just text with very little visual
// polish"): the search bar, Favourites as letter tiles (a letter on a colour per site, never a picture from the web; Edit shows a − on
// each), and Recents: what was searched or opened from the box, newest first, at most 8, kept only on this phone (Clear empties it).
import { browserTarget, createBookmarks, relTime } from './shell_core.js';
import { createRecents, recentLabel, siteTile } from './homeplus_core.js';

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const icon = (paths, cls) => {   // a small line drawing (the sprite has no magnifier or clock)
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
  for (const [tag, a] of paths) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v)); s.append(e); }
  return s;
};
const useIcon = (href, cls) => { const s = document.createElementNS(SVGNS, 'svg'), u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', href); s.append(u); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); return s; };
const MAG = [['circle', { cx: 10.5, cy: 10.5, r: 6.2 }], ['path', { d: 'm15.2 15.2 4.8 4.8' }]];
const PLUS = [['path', { d: 'M12 5.5v13M5.5 12h13' }]];
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } };

export function createBrowser({ toast = () => {}, sheet = null } = {}) {
  let sec = $('v-browser');
  if (!sec) { sec = mk('section', 'view'); sec.id = 'v-browser'; sec.setAttribute('aria-label', 'Browser'); sec.hidden = true; $('main').append(sec); }
  sec.classList.add('br-start');
  const bm = createBookmarks(localStorage), rc = createRecents(localStorage);
  let editing = false;
  const open = (url) => {
    const t = browserTarget(url); if (!t) return null;
    try { window.open(t.url, '_blank', 'noopener,noreferrer'); } catch (e) { toast("Couldn't open it"); }   // (with noopener the call returns null even when it opened)
    return t;
  };

  // ---- the search bar
  const bar = mk('div', 'br-search'); bar.setAttribute('role', 'search');
  const lab = mk('label', 'vh', 'Search or enter an address'); lab.htmlFor = 'br-in';
  const field = mk('div', 'br-box');
  const inp = mk('input'); inp.id = 'br-in'; inp.type = 'search'; inp.placeholder = 'Search or enter an address'; inp.enterKeyHint = 'go';
  inp.autocapitalize = 'off'; inp.setAttribute('autocorrect', 'off'); inp.spellcheck = false;
  const go = mk('button', 'br-go', 'Go'); go.type = 'button'; go.id = 'br-go';
  const submit = () => {
    const v = inp.value; if (!v.trim()) return inp.focus();
    const t = open(v); if (t) { rc.add(t, v.trim()); renderRecents(); }
    inp.blur();
  };
  go.onclick = submit; inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  field.append(icon(MAG, 'br-mag'), inp, go);
  bar.append(lab, field);
  const hint = mk('p', 'footnote dim br-hint', "Links open in this phone's own browser sheet: tap Done there to come back. Searches go to DuckDuckGo.");

  // ---- Favourites: letter tiles
  const favHead = mk('div', 'br-head'); const favTitle = mk('h2', 'br-h', 'Favourites'); favTitle.id = 'br-fav-h';
  const edit = mk('button', 'mini br-editbtn', 'Edit'); edit.type = 'button'; edit.id = 'br-edit';
  favHead.append(favTitle, edit);
  const list = mk('div', 'br-grid'); list.id = 'br-list'; list.setAttribute('role', 'list'); list.setAttribute('aria-labelledby', 'br-fav-h');
  const add = mk('button', 'br-addtile'); add.type = 'button'; add.id = 'br-add'; add.setAttribute('aria-label', 'Add a bookmark');
  const addTile = mk('span', 'br-tile br-tile-add'); addTile.append(icon(PLUS)); add.append(addTile, mk('span', 'br-name', 'Add'));
  edit.onclick = () => { editing = !editing; sec.classList.toggle('br-editing', editing); edit.textContent = editing ? 'Done' : 'Edit'; edit.setAttribute('aria-pressed', String(editing)); };
  function render() {
    list.replaceChildren(...bm.list().map((b) => {
      const row = mk('div', 'br-row'); row.setAttribute('role', 'listitem');
      const a = mk('a', 'br-link'); a.href = b.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', `${b.title}, ${host(b.url)}`);
      const li = siteTile(b.url, b.title), tile = mk('span', 'br-tile', li.letter); tile.style.background = li.color; tile.setAttribute('aria-hidden', 'true');
      a.append(tile, mk('span', 'br-name', b.title));
      a.addEventListener('click', (e) => { if (editing) e.preventDefault(); });   // Edit: a tap never leaves the page
      const x = mk('button', 'br-x', '−'); x.type = 'button'; x.setAttribute('aria-label', 'Remove the bookmark ' + b.title);
      x.onclick = () => { bm.remove(b.url); render(); toast('Bookmark removed'); };
      row.append(a, x); return row;
    }), add);
    renderRecents();
  }
  add.onclick = () => {
    if (!sheet) return;
    const { sheet: sh, close } = sheet('br-add-sheet', 'Add a bookmark');
    const t = mk('input'); t.type = 'text'; t.placeholder = 'Name'; t.maxLength = 60; t.className = 'br-field'; t.setAttribute('aria-label', 'Name');
    const u = mk('input'); u.type = 'url'; u.placeholder = 'Address, like example.com'; u.className = 'br-field'; u.setAttribute('aria-label', 'Address');
    u.autocapitalize = 'off'; u.spellcheck = false;
    if (browserTarget(inp.value) && browserTarget(inp.value).kind === 'url') u.value = inp.value.trim();
    const save = mk('button', 'btn cta', 'Save'); save.type = 'button';
    save.onclick = () => { if (bm.add({ title: t.value, url: u.value })) { close(); render(); toast('Bookmark added'); } else toast(!t.value.trim() ? 'Give it a name' : 'Use an address like example.com (and not one already saved)'); };
    const cancel = mk('button', 'btn ghost', 'Cancel'); cancel.type = 'button'; cancel.dataset.close = '';
    sh.append(t, u, save, cancel); setTimeout(() => t.focus(), 60);
  };

  // ---- Recents
  const recHead = mk('div', 'br-head'); const recTitle = mk('h2', 'br-h', 'Recents'); recTitle.id = 'br-rec-h';
  const clear = mk('button', 'mini br-clear', 'Clear'); clear.type = 'button'; clear.id = 'br-clear';
  clear.onclick = () => { rc.clear(); renderRecents(); toast('Recents cleared'); };
  recHead.append(recTitle, clear);
  const recents = mk('div', 'br-recents'); recents.id = 'br-recents'; recents.setAttribute('aria-labelledby', 'br-rec-h');
  const recNone = mk('p', 'footnote dim br-rec-none', 'What you search or open here shows up here. It stays on this phone.');
  function renderRecents() {
    const L = rc.list(), now = Date.now();
    recents.replaceChildren(...L.map((r) => {
      const b = mk('button', 'br-recent'); b.type = 'button';
      const txt = mk('span', 'br-rtext', recentLabel(r)), when = mk('span', 'br-rtime footnote', relTime(r.at, now));
      b.append(r.kind === 'search' ? icon(MAG, 'br-ricon') : useIcon('#i-sh-globe', 'br-ricon'), txt, when);
      b.setAttribute('aria-label', (r.kind === 'search' ? 'Search again: ' : 'Open again: ') + recentLabel(r));
      b.onclick = () => { if (open(r.url)) { rc.add({ kind: r.kind, url: r.url }, r.text); renderRecents(); } };   // a search stays a search
      return b;
    }));
    recents.hidden = !L.length; clear.hidden = !L.length; recNone.hidden = !!L.length;
  }

  sec.replaceChildren(bar, hint, favHead, list, recHead, recents, recNone);
  render();
  return { open, render };
}
// 3.9 polish (A1)
// 3.9 shell 42dbb54204f6
