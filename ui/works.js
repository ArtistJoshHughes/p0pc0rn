// works.js - p0pc0rn 3.9 polish: apps that work on their own ("Works for you") behave like phone features people already trust. Josh
// (Oct-26): "I am really trying to get the always on agent UI/UX to be as seemless as iOS native apps because Ai agents are 'scary'
// enough already ... it's hard for normal every day users to understand". Here: the 3-card intro on the first open (what it does, what it
// can see, how to pause it), each app's settings page (what it can do, access, Pause, today's activity), the activity log and its report
// (like a phone's privacy report, with Pause all), and the live state of a running check (the home screen's activity pill reads it).
// Apps only ever suggest: nothing acts on its own, and every one of these screens says so. The log and the pauses stay on this phone.
import { createActivity, report, appDay, stepText, pausedAll, setPausedAll, introSeen, markIntro, dayStart } from './works_core.js';
import { worksAlone, withJuli, isGame, WORKS, plainOf, seesOf, stopOf, permRows } from './storefront_core.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const NS = 'http://www.w3.org/2000/svg';
const useIcon = (href) => { const s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use'); u.setAttribute('href', href); s.append(u); s.setAttribute('aria-hidden', 'true'); return s; };
const btn = (label, cls, fn) => { const b = mk('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };
const ROW_ICON = { cloud: '#i-sf-cloud', pin: '#i-sf-pin', flame: '#i-sf-flame', chart: '#i-sf-chart', juli: '#i-chat', game: '#i-sh-game', chat: '#i-chat', clock: '#i-sf-clock', check: '#i-check', lock: '#i-sf-lock', book: '#i-sh-skill', shield: '#i-shield' };
const ago = (t, now = Date.now()) => { const s = (now - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 86400 * 1.5 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
const STAY = 'It only suggests: nothing happens until you confirm.';

export function createWorks({ apps = () => null, toast = () => {}, sheet = null, iconTile = () => mk('span'), appById = () => null, skelOf = () => null } = {}) {
  const ls = (() => { try { return localStorage; } catch (e) { return { getItem: () => null, setItem() {}, removeItem() {} }; } })();
  const log = createActivity(ls);
  let live = null;   // the check that runs now: { appId, name, at, steps: [{ what, label, at }] }
  const listeners = new Set();
  addEventListener('p0:apps', (ev) => {
    const d = (ev && ev.detail) || {};
    try { if (!(d.type === 'step' && d.what === 'fetch' && d.cached)) log.add(d); } catch (e) { /* storage full: the log waits */ }
    if (d.type === 'check-start') live = { appId: d.appId, name: d.name, at: d.at || Date.now(), steps: [] };
    else if (d.type === 'step' && live && live.appId === d.appId) live.steps.push({ what: d.what, label: stepText(d), at: d.at || Date.now() });
    else if (d.type === 'check-end' && live && live.appId === d.appId) live = null;
    for (const f of listeners) { try { f(d); } catch (e) { /* a page's own problem */ } }
  });
  const checking = () => (live ? { appId: live.appId, name: live.name, at: live.at, steps: live.steps.slice() } : null);

  // ---------------------------------------------------------------------------------------------- pauses
  function pause(appId, on) {
    const X = apps(), a = appById(appId); if (!X || !a || !X.pause) return false;
    X.pause(a, !!on); toast(on ? `${a.name} is paused: it won’t check on its own` : `${a.name} works for you again`); return !!on;
  }
  const paused = (appId) => { const a = appById(appId); return !!(a && a.youPaused); };
  function pauseAll(on) {
    if (on === undefined) return pausedAll(ls);
    const X = apps(); if (X && X.pauseAll) X.pauseAll(!!on); else setPausedAll(ls, !!on);
    toast(on ? 'All apps are paused: none checks on its own' : 'Apps work for you again'); return !!on;
  }
  const swRow = (label, sub, checked, onChange, id) => {
    const l = mk('label', 'li sw-row sf-sw'); const t = mk('span'); t.append(mk('span', 'sw-name', label)); if (sub) t.append(mk('span', 'footnote dim', sub));
    const i = mk('input', 'sw'); i.type = 'checkbox'; i.checked = !!checked; if (id) i.id = id; i.addEventListener('change', () => onChange(i.checked, i));
    l.append(t, i); return l;
  };

  // ---------------------------------------------------------------------------------------------- the 3-card intro (first open)
  const needsIntro = (skel) => !!(skel && skel.manifest && worksAlone(skel.manifest) && !introSeen(ls, skel.manifest.id));
  function intro(skel, then) {
    const m = skel && skel.manifest; if (!m) return then && then();
    if (!sheet) { markIntro(ls, m.id); return then && then(); }
    const { sheet: sh, close } = sheet('sf-intro', `${m.name} works for you`);
    sh.classList.add('sf-intro');
    sh.insertBefore(iconTile({ manifest: m }, 'big'), sh.firstChild);
    sh.append(mk('p', 'footnote dim sf-intro-lead', 'Three things to know before it starts.'));
    const cards = [['What it does', plainOf(m), '#i-sparkle'], ['What it can see', seesOf(m).line, '#i-shield'],
      ['How to pause it', stopOf(m) + (withJuli(m) ? ' ' + STAY : ''), '#i-pause']];
    for (const [t, x, ic] of cards) { const r = mk('div', 'sf-intro-row'); const i = mk('span', 'sf-intro-ic'); i.append(useIcon(ic)); const tx = mk('div'); tx.append(mk('p', 'headline', t), mk('p', 'footnote', x)); r.append(i, tx); sh.append(r); }
    const go = btn('Continue', 'btn cta', () => { markIntro(ls, m.id); close(); if (then) setTimeout(then, 60); }); go.id = 'sf-intro-go';
    const later = btn('Not now', 'btn ghost', () => close()); later.id = 'sf-intro-later';
    sh.append(go, later);
    setTimeout(() => { try { go.focus(); } catch (e) { /* */ } }, 80);
  }

  // ---------------------------------------------------------------------------------------------- an app's settings page
  const group = (title, ...kids) => { const d = mk('div', 'sf-group'); if (title) d.append(mk('p', 'label', title)); const l = mk('div', 'list'); l.append(...kids); d.append(l); return d; };
  const line = (text, sub, icon) => { const r = mk('div', 'li sf-line'); if (icon) { const i = mk('span', 'sf-line-ic'); i.append(useIcon(icon)); r.append(i); } const t = mk('span', 'sf-line-txt'); t.append(mk('span', 'callout', text)); if (sub) t.append(mk('span', 'footnote dim', sub)); r.append(t); return r; };
  // 3.9 Wallet Watch: a row's source credit with its direct links (they open in the phone's own browser sheet; never fetched)
  const credited = (row, c) => { if (!c) return row; const t = row.querySelector('.sf-line-txt') || row, s = mk('span', 'footnote ww-links', c.line + ': ');
    c.links.forEach((l, i) => { if (i) s.append(' · '); const a = mk('a', null, l.text); if (/^https:\/\//.test(String(l.href))) a.href = l.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; if (l.label) a.setAttribute('aria-label', l.label); s.append(a); });
    t.append(s); return row; };
  async function settings(appId) {
    const X = apps(), a = appById(appId); if (!X || !a || !sheet) return;
    const s = skelOf(a.skel), m = s && s.manifest;
    const { sheet: sh, close } = sheet('sf-settings', a.name);
    sh.classList.add('sf-page', 'sf-settings'); sh.dataset.app = a.id;
    const head = mk('div', 'sf-page-head'); head.append(iconTile({ app: a }, 'big'));
    const ht = mk('div', 'sf-page-ht'), chips = mk('span', 'sf-chips');
    if (m && isGame(m)) chips.append(mk('span', 'sf-chip game', 'Game'), mk('span', 'sf-chip vs', 'You vs Juli'));
    else if (m && worksAlone(m)) { chips.append(mk('span', 'sf-chip works', WORKS)); if (withJuli(m)) chips.append(mk('span', 'sf-chip juli', 'with Juli')); }
    ht.append(chips, mk('p', 'footnote dim sf-status', X.statusOf ? X.statusOf(a) : '')); head.append(ht);
    sh.append(head);
    if (!m) { sh.append(mk('p', 'callout', 'Its design is no longer on this phone, so it can’t open. Import the design again, or delete it.'), btn('Delete', 'btn danger', () => { close(); X.askRemove && X.askRemove(a); })); return; }
    sh.append(mk('p', 'callout sf-page-plain', plainOf(m)));
    if ((a.badge || 0) > 0) { const n = btn(`${a.badge} to look at: open it`, 'btn cta sf-look-go', () => { close(); X.openApp(a); }); n.id = 'sf-settings-look'; sh.append(n); }
    // what it can do, in plain words (the same rows its permission sheet showed)
    const rows = permRows(m, X.hosts ? X.hosts() : {}).map((r) => credited(line(r.text, r.sub, ROW_ICON[r.icon] || '#i-check'), r.credit));   // 3.9 Wallet Watch: + a source's credit
    rows.push(line('Never sees your photos, Library, Cast or files', 'Apps run in a locked box on this phone.', '#i-shield'));
    sh.append(group('What it can do', ...rows));
    // access: allowed or not; taking it back stops its checks, and the next open asks again
    const ok = X.granted ? X.granted(m.id) : true;
    const acc = mk('div', 'li sf-access'); const at = mk('span', 'sf-line-txt');
    at.append(mk('span', 'callout', ok ? 'Allowed' : 'Not allowed'), mk('span', 'footnote dim', ok ? 'You allowed what it asks for. Turn it off and it stops; it asks again before it runs.' : 'It asks before it does anything.'));
    const ab = ok ? btn('Turn off access', 'btn sm', async () => { await X.revoke(m.id); toast(`${a.name} has no access now`); settings(a.id); })
      : btn('Allow…', 'btn sm', () => X.allow(m.id, () => settings(a.id)));
    ab.id = 'sf-access'; acc.append(at, ab);
    sh.append(group('Access', acc));
    if (worksAlone(m)) {
      const all = pausedAll(ls);
      const p1 = swRow(`Pause ${a.name}`, all ? 'All apps are paused right now (Pause all).' : stopOf(m), !!a.youPaused, (on) => pause(a.id, on), 'sf-pause');
      const p2 = swRow('Pause all', 'Every app that works on its own waits until you turn this off.', all, (on) => { pauseAll(on); settings(a.id); }, 'sf-pause-all');
      sh.append(group(WORKS, p1, p2));
      sh.append(mk('p', 'footnote dim sf-stay', STAY));
      // today: what it did (the log) and what it wrote itself
      const today = log.list({ app: a.id, since: dayStart(Date.now()) });
      const own = X.ownLog ? await X.ownLog(a.id, 4) : [];
      const d = appDay(today, a.id, own.length && own[0].at >= dayStart(Date.now()) ? own[0].text : '');
      const act = [line(today.length || own.length ? d.line.replace(/^An app/, a.name) : 'Nothing yet today.', null, '#i-queue')];
      for (const o of own.slice(0, 3)) act.push(line(o.text + (o.n > 1 ? ` (${o.n}×)` : ''), ago(o.at), null));
      for (const q of X.quota ? X.quota(m.id, a.id) : []) act.push(line(q.text, q.sub, q.icon || '#i-sf-chart'));   // 3.9 Wallet Watch: how often it checks, "Snowtrace requests today: N of 5,000"
      const more = btn('All activity', 'li link sf-more', () => { close(); setTimeout(activity, 60); }); more.append(useIcon('#i-chevron'));
      act.push(more);
      sh.append(group('Today', ...act));
    }
    const acts = mk('div', 'sf-page-acts');
    const o = btn(m && isGame(m) ? 'Play' : 'Open', 'btn cta', () => { close(); X.openApp(a); }); o.id = 'sf-settings-open';
    const c = btn('Change', 'btn', () => { close(); X.changeSheet(a); });
    const sharer = btn('Share', 'btn', () => { if (globalThis.P0STORE) globalThis.P0STORE.share(a.id); });
    const pin = document.querySelector(`#apps-mine .sh-pin-btn[data-pin="${CSS.escape(a.id)}"]`);
    const home = pin ? btn(pin.getAttribute('aria-pressed') === 'true' ? 'Remove from Home Screen' : 'Add to Home Screen', 'btn', () => { close(); pin.click(); }) : null;
    const del = btn('Delete', 'btn danger', () => { close(); X.askRemove && X.askRemove(a); }); del.id = 'sf-settings-delete';
    acts.append(o, c); if (home) acts.append(home); acts.append(sharer, del);
    sh.append(acts);
  }

  // ---------------------------------------------------------------------------------------------- the activity report
  async function activity() {
    const X = apps(); if (!sheet) return;
    const { sheet: sh } = sheet('sf-activity', 'Activity');
    sh.classList.add('sf-page', 'sf-activity');
    sh.append(mk('p', 'footnote dim', 'What your apps did on their own, on this phone. Each app sees only what you add in it; below is what it looked up outside the phone, and when. Kept here for two weeks; nothing is sent anywhere. ' + STAY));
    const all = pausedAll(ls);
    sh.append(group('', swRow('Pause all', all ? 'Every app that works on its own is waiting.' : 'Stops every app that works on its own until you turn this off.', all, (on) => { pauseAll(on); activity(); }, 'sf-act-pause-all')));
    const list = log.list(), own = {}, mine = X && X.state ? X.state.apps || [] : [];
    if (X && X.ownLog) for (const a of mine) { const s = skelOf(a.skel); if (s && worksAlone(s.manifest)) { const l = await X.ownLog(a.id, 1); if (l[0] && l[0].at >= dayStart(Date.now())) own[a.id] = l[0].text; } }
    const R = report(list, { own });
    if (!R.length) sh.append(mk('p', 'callout sf-empty', 'Nothing yet. When an app works for you, what it did shows here.'));
    for (const day of R) {
      const kids = day.apps.map((x) => {
        const a = mine.find((y) => y.id === x.app), r = mk('div', 'li sf-act-row');
        r.append(a ? iconTile({ app: a }) : mk('span', 'sf-ico letter', (x.name || '?').charAt(0)));
        const t = mk('span', 'sf-line-txt'); t.append(mk('span', 'callout', x.line)); r.append(t);
        if (a && day.label === 'Today') {   // its Pause switch (the same as in its settings)
          const s = skelOf(a.skel);
          if (s && worksAlone(s.manifest)) {
            const b = btn(a.youPaused ? 'Resume' : 'Pause', 'btn sm sf-act-pause', () => { pause(a.id, !a.youPaused); setTimeout(activity, 250); });
            b.setAttribute('aria-label', a.youPaused ? `Resume ${a.name}: let it work for you again` : `Pause ${a.name}: stop it working on its own`); r.append(b);
          }
        }
        return r;
      });
      sh.append(group(day.label, ...kids));
    }
    if (R.length) { const c = btn('Clear activity', 'btn ghost', () => { log.clear(); activity(); }); c.id = 'sf-act-clear'; sh.append(c); }
  }

  // ---------------------------------------------------------------------------------------------- Change: before and after
  async function beforeAfter(app) {
    if (typeof app === 'string') app = appById(app);
    const X = apps(); if (!X || !X.beforeAfter || !sheet || !app) return;
    const { sheet: sh, close } = sheet('sf-ba', 'Before and after');
    sh.classList.add('sf-page', 'sf-ba');
    const note = mk('p', 'footnote dim', 'Trying both versions on this phone, unseen…'), grid = mk('div', 'sf-ba-grid');
    sh.append(note, grid);
    const urls = [];
    const r = await X.beforeAfter(app).catch(() => null);
    if (!sh.isConnected) return;
    if (!r || (!r.before && !r.after)) note.textContent = 'No picture of the two versions right now (Juli or a render may be using the memory). Undo still works.';
    else {
      note.textContent = `“${app.name}” before the last change, and now.`;
      for (const [label, b] of [['Before', r.before], ['After', r.after]]) {
        const f = mk('figure', 'sf-ba-fig');
        if (b) { const u = URL.createObjectURL(b); urls.push(u); const i = new Image(); i.alt = `${app.name}, ${label.toLowerCase()}`; i.src = u; f.append(i); } else f.append(mk('span', 'sf-ba-none', 'No picture'));
        f.append(mk('figcaption', 'footnote dim', label)); grid.append(f);
      }
    }
    const undo = btn('Undo the change', 'btn', async () => { close(); await X.undoEdit(app); }); undo.id = 'sf-ba-undo';
    const keep = btn('Keep it', 'btn cta', () => close()); keep.id = 'sf-ba-keep';
    sh.append(keep, undo);
    const watch = new MutationObserver(() => { if (!sh.isConnected) { watch.disconnect(); for (const u of urls) URL.revokeObjectURL(u); } });
    watch.observe(document.body, { childList: true });
  }

  return { intro, needsIntro, settings, activity, pause, paused, pauseAll, checking, beforeAfter, log, on: (f) => listeners.add(f) };
}
