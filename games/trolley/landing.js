// landing.js - Troll-E's title screen (Josh, Nov 1: "Troll-E needs a landing screen start, load saved game and settings"). It replaces
// the old start card: the key art, the TROLL-E neon title and a console menu: Start (a new game: the tutorial), Load saved game (what is
// in the save), Skip the tutorial (once it was finished, or a save exists), Settings, Controls, About, Back to p0pc0rn. A new game over
// a save asks first. The same screen is then the loading screen (setLoading) until the game starts (hide).
// DOM and one picture: it imports nothing, so nothing of the game (the physics, the world, the trolley, Juli's model) loads before a
// choice. It never deletes a save: it returns the choice, and the page does the rest.
// The settings are kept per device in localStorage (every access wrapped: blocked storage just means nothing is remembered). Juli's
// subtitles have no switch: they are always on (Josh: "Subtitles have to be on, no option to turn them off").
// createPause() is the in-game pause sheet's helper (the HUD's pause button: Resume, the sound and the restart, Save and quit to the
// landing screen, Back to p0pc0rn).

/** the settings' localStorage keys (values '1' / '0'). v4 (Troll-E v1): no brain choice: she plays on her own model, the Bigger brain
 *  only plots (a 'p0pc0rn:trolley:brain' saved before is ignored) */
export const KEYS = Object.freeze({
  juli: 'p0pc0rn:trolley:juli', voice: 'p0pc0rn:trolley:voice', radio: 'p0pc0rn:trolley:radio', muted: 'p0pc0rn:trolley:muted',
  probe: 'p0pc0rn:trolley:probe', plot: 'p0pc0rn:trolley:plot',
});
/** the area of the key art (fractions of its width and height) that holds the trolley: the landscape poster never crops it */
export const ART = Object.freeze({ w: 611, h: 1088, trolley: { x0: 0.27, x1: 0.70, y0: 0.30, y1: 0.54 } });

const storeOf = (store) => {
  let S = store;
  if (S === undefined) { try { S = globalThis.localStorage || null; } catch (e) { S = null; } }
  return {
    get: (k) => { try { return S ? S.getItem(k) : null; } catch (e) { return null; } },
    set: (k, v) => { try { if (S) S.setItem(k, v); } catch (e) { /* private mode, full or blocked */ } },
  };
};

/** the switches as saved on this device (defaults: Juli, her voice, the radio, the sound and the plotting on; the probe off) */
export function readPrefs(store) {
  const g = storeOf(store).get;
  return { juli: g(KEYS.juli) !== '0', voice: g(KEYS.voice) !== '0', radio: g(KEYS.radio) !== '0', muted: g(KEYS.muted) === '1', probe: g(KEYS.probe) === '1',
    plot: g(KEYS.plot) !== '0' };
}
/** what the game should do with them here: she plays live on her own model (brain 'e2b', every device); the plotting (the Bigger brain
 *  in the loading screen, no scene beside it, then let go) where env.plotOK, with Juli on */
export function effective(prefs, env = {}) {
  return { juli: prefs.juli, voice: prefs.voice, radio: prefs.radio, sound: !prefs.muted, muted: prefs.muted, probe: prefs.probe, brain: 'e2b',
    plot: !!(prefs.juli && env.plotOK && prefs.plot), prefs: Object.assign({}, prefs) };
}
/** the settings without a landing screen (the bench, a reload straight into play) */
export const readSettings = (env = {}, store) => effective(readPrefs(store), env);

const romWord = (n) => (n === 1 ? 'ROM' : 'ROMs');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** the save's day (10 game minutes a day: save.time / 600) */
export const dayOf = (save) => Math.floor(((save && save.time) || 0) / 600) + 1;
/** when the save was written, in words: "just now", "5 minutes ago", "3 hours ago", "yesterday, 21:05", "Friday, 21:05", "30 Oct, 21:05" */
export function whenText(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t), s = (now - t) / 1000;
  let hm = ''; try { hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { hm = d.toTimeString().slice(0, 5); }
  if (s >= -60 && s < 60) return 'just now';
  if (s >= 0 && s < 3600) return `${plural(Math.floor(s / 60), 'minute')} ago`;
  if (s >= 0 && s < 6 * 3600) return `${plural(Math.floor(s / 3600), 'hour')} ago`;
  const day0 = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); }, days = Math.round((day0(now) - day0(t)) / 86400000);
  if (days === 0) return `today, ${hm}`;
  if (days === 1) return `yesterday, ${hm}`;
  try {
    if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'long' })}, ${hm}`;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })}, ${hm}`;
  } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
}
/** a save's summary for the Load slot: { day, at, place, battery (0..100), roms, when } */
export function saveSummary(save, roms = 0, now = Date.now()) {
  if (!save) return null;
  const b = Math.round(Math.max(0, Math.min(1, Number.isFinite(save.battery) ? save.battery : 1)) * 100);
  return { day: dayOf(save), at: save.at === 'dock' ? 'dock' : 'shelter', place: save.at === 'dock' ? 'At the dock' : 'At the shelter', battery: b,
    roms: Math.max(0, Math.floor(roms || 0)), when: whenText(save.saved, now) };
}

const SWITCHES = [
  // [setting, element id, its words]: the old start card's three keep their exact words (the desk tests read them)
  ['juli', 't-juli', (on) => `Juli: ${on ? 'on' : 'off'}`],
  ['voice', 't-voice', (on) => `Juli’s voice: ${on ? 'on' : 'off'}`],
  ['radio', 't-radio', (on) => `Radio: ${on ? 'on' : 'off'}`],
  ['plot', 't-plot', (on) => `Juli plots her shift: ${on ? 'on' : 'off'}`],
  ['sound', 't-sound', (on) => `Sound: ${on ? 'on' : 'off'}`],
  ['probe', 't-probe', (on) => `Probe: Juli + FPS: ${on ? 'on' : 'off'}`],
];
const NEEDS_JULI = new Set(['voice', 'radio', 'plot']);
const PANELS = ['main', 'settings', 'controls', 'about', 'confirm', 'loading'];
const OPENER = { settings: 'l-settings', controls: 'l-controls', about: 'l-about' };

/**
 * createLanding({ $, saves, progress, env, onChoice, onSetting, store, now }) -> the title screen, wired to the markup in index.html (#start)
 *   saves: save.js's createSaves() (only load() is used); progress: progress.js's createProgress() (roms, best)
 *   env: { plotOK, plotWhy, lowmem }: where the Bigger brain can plot her shift, and why not (shown as a note)
 *   onChoice(action): 'start' | 'load' | 'skip' | 'leave', once confirmed; onSetting(key, value, settings) after a switch changes
 * -> { show(), hide(), setLoading(text, { pct, sub }), setCrumb(line), choose(): Promise<action>, settings(), setEnv(patch), refresh(), panel(), el }
 */
export function createLanding({ $ = (id) => document.getElementById(id), saves = null, progress = null, env = {}, onChoice = null, onSetting = null, store, now = () => Date.now() } = {}) {
  const st = storeOf(store);
  const root = $('start'), art = $('landing-art');
  const prefs = readPrefs(store);
  const E = Object.assign({}, env);
  const W = { waiters: [], queued: null, busy: false, panel: 'main', confirm: null, save: null, sum: null, sel: null };
  const artSrc = art ? art.getAttribute('src') : null;
  const panelEl = (p) => $('lp-' + p);
  const visible = (el) => !!el && !el.disabled && el.getClientRects().length > 0;
  const settings = () => effective(prefs, E);
  if (E.lowmem) root.classList.add('lowmem');

  // ---- selection: one item is "selected" (a neon edge and a diamond); it follows the keyboard's focus and the pointer
  const navItems = () => { const p = panelEl(W.panel); return p ? [...p.querySelectorAll('button')].filter(visible) : []; };
  function select(el, focus = false) {
    if (W.sel && W.sel !== el) W.sel.classList.remove('sel');
    W.sel = el || null;
    if (!el) return;
    el.classList.add('sel');
    if (focus) { try { el.focus({ preventScroll: false }); } catch (e) { /* */ } }
  }
  function showPanel(p, { focus = false, sel = null } = {}) {
    W.panel = p; root.dataset.panel = p;
    for (const q of PANELS) { const el = panelEl(q); if (el) el.hidden = q !== p; }
    let def = sel && visible(sel) ? sel : null;
    if (!def && p === 'main') def = W.save ? $('continue') : $('boot');
    if (!def && p === 'confirm') def = $('confirm-no');
    if (!def) def = navItems()[0] || null;
    select(def, focus);
    if (p !== 'loading') { const sc = panelEl(p) && panelEl(p).querySelector('.lp-scroll'); if (sc) sc.scrollTop = 0; }
  }

  // ---- the save slot, Skip, the kicker
  function renderSave() {
    let sv = null; try { sv = saves && saves.load ? saves.load() : null; } catch (e) { sv = null; }
    const roms = progress && Number.isFinite(progress.roms) ? progress.roms : 0, best = progress ? progress.best : null;
    W.save = sv; W.sum = saveSummary(sv, roms, now());
    const c = $('continue'), s = W.sum;
    c.disabled = !s;
    $('save-none').hidden = !!s; $('save-chips').hidden = !s; $('save-when').hidden = !(s && s.when);
    if (s) {
      $('save-day').textContent = `Day ${s.day}`;
      $('save-at').textContent = s.place;
      $('save-bpct').textContent = `${s.battery}%`;
      const sb = $('save-batt'); sb.classList.toggle('mid', s.battery < 50 && s.battery >= 20); sb.classList.toggle('low', s.battery < 20);
      sb.setAttribute('aria-label', `Battery ${s.battery}%`);
      $('save-bfill').style.transform = `scaleX(${Math.max(0.04, s.battery / 100)})`;   // (the CSSOM: the page's CSP allows no style attributes)
      $('save-romn').textContent = `${s.roms} ${romWord(s.roms)}`;
      $('save-when').textContent = s.when ? `Last played ${s.when}` : '';
    }
    $('skip').hidden = !(sv || best != null);
    $('boot-sub').textContent = sv ? 'A new game, from the tutorial' : 'Level 1: the tutorial';
    $('start-kicker').textContent = s ? `The open world · day ${s.day}` : 'Level 1 · the tutorial';
  }

  // ---- the settings
  function renderSettings() {
    const on = { juli: prefs.juli, voice: prefs.voice, radio: prefs.radio, plot: prefs.plot, sound: !prefs.muted, probe: prefs.probe };
    for (const [k, id, words] of SWITCHES) {
      const b = $(id); if (!b) continue;
      b.setAttribute('aria-checked', String(on[k])); b.textContent = words(on[k]);
      b.disabled = NEEDS_JULI.has(k) && !prefs.juli;
    }
    // the plotting: only where it fits (else one line why), and only with the Bigger brain
    const plot = $('t-plot'), pn = $('plot-note'), pd = $('d-plot');
    plot.hidden = !E.plotOK; pd.hidden = !E.plotOK; pn.hidden = !!E.plotOK;
    $('plot-why').textContent = E.plotOK ? '' : (E.plotWhy || 'only with the Bigger brain');
    pd.textContent = 'The Bigger brain plans her shift while the game loads, then lets go: she plays on her own model.';
  }
  function flip(k) {
    if (k === 'sound') { prefs.muted = !prefs.muted; st.set(KEYS.muted, prefs.muted ? '1' : '0'); }
    else { prefs[k] = !prefs[k]; st.set(KEYS[k], prefs[k] ? '1' : '0'); }
    renderSettings();
    if (onSetting) { try { onSetting(k, k === 'sound' ? !prefs.muted : prefs[k], settings()); } catch (e) { /* the page's problem */ } }
  }
  for (const [k, id] of SWITCHES) { const b = $(id); if (b) b.addEventListener('click', () => { if (!W.busy && !b.disabled) flip(k); }); }

  // ---- the choices
  function pick(action) {
    if (W.busy) return;
    W.busy = true; root.classList.add('busy');
    if (onChoice) { try { onChoice(action); } catch (e) { /* the page's problem */ } }
    const w = W.waiters; W.waiters = [];
    if (w.length) for (const r of w) r(action); else W.queued = action;
  }
  function newGame(kind) {
    if (W.busy) return;
    if (!W.save) return pick(kind);
    const s = W.sum;
    W.confirm = kind;
    $('confirm-h').textContent = kind === 'skip' ? 'Skip into a new game?' : 'Start a new game?';
    $('confirm-line').textContent = `It replaces your saved game: day ${s.day}, ${s.place.toLowerCase()}, ${s.battery}% battery. Your ROMs stay.`;
    $('confirm-yes-t').textContent = kind === 'skip' ? 'New game, skip the tutorial' : 'Start a new game';
    showPanel('confirm', { focus: true });
  }
  const on = (id, fn) => $(id).addEventListener('click', (e) => { if (!W.busy && !e.currentTarget.disabled) fn(); });
  on('boot', () => newGame('start'));
  on('skip', () => newGame('skip'));
  on('continue', () => { if (W.save) pick('load'); });
  on('leave', () => pick('leave'));
  on('confirm-yes', () => { const k = W.confirm; W.confirm = null; if (k) pick(k); });
  on('confirm-no', () => { const k = W.confirm; W.confirm = null; showPanel('main', { focus: true, sel: $(k === 'skip' ? 'skip' : 'boot') }); });
  for (const [p, id] of Object.entries(OPENER)) on(id, () => showPanel(p, { focus: true }));
  for (const b of root.querySelectorAll('[data-back]')) b.addEventListener('click', () => { if (!W.busy) back(); });
  function back() {
    const from = W.panel, k = W.confirm; W.confirm = null;
    showPanel('main', { focus: true, sel: $(OPENER[from] || (from === 'confirm' ? (k === 'skip' ? 'skip' : 'boot') : 'boot')) });
  }

  // ---- the pointer and the keyboard (a console's menu: up and down, Enter, Escape for back)
  root.addEventListener('pointerover', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && root.contains(b) && visible(b)) select(b); });
  root.addEventListener('focusin', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && root.contains(b)) select(b); });
  document.addEventListener('keydown', (e) => {
    if (root.hidden || W.panel === 'loading' || W.busy || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key, items = navItems();
    const step = (d) => { if (!items.length) return; let i = items.indexOf(W.sel); i = i < 0 ? 0 : (i + d + items.length) % items.length; select(items[i], true); e.preventDefault(); };
    if (k === 'ArrowDown' || k === 'ArrowRight') step(1);
    else if (k === 'ArrowUp' || k === 'ArrowLeft') step(-1);
    else if ((k === 'Escape' || k === 'Backspace') && W.panel !== 'main') { back(); e.preventDefault(); }
    else if ((k === 'Enter' || k === ' ') && W.sel && visible(W.sel) && !(document.activeElement && document.activeElement.tagName === 'BUTTON' && root.contains(document.activeElement))) { W.sel.click(); e.preventDefault(); }
  });

  // ---- the screen's states
  const keepArt = () => { if (art && artSrc && art.getAttribute('src') !== artSrc) art.setAttribute('src', artSrc); };
  function refresh() { renderSave(); renderSettings(); }
  function show() {
    keepArt(); W.busy = false; root.classList.remove('busy'); W.confirm = null;
    refresh(); root.hidden = false; showPanel('main');
    root.classList.remove('in'); void root.offsetWidth; root.classList.add('in');   // (the menu rises in again)
  }
  /** the loading screen: the menu gives way to a status line and a bar (a "42%" in the text, or opts.pct 0..100, fills it; none: it
   *  sweeps), and an optional second line (Juli plotting her shift) */
  function setLoading(text = '', { pct = null, sub = null } = {}) {
    keepArt(); W.busy = true; root.classList.add('busy'); root.hidden = false;
    if (W.panel !== 'loading') showPanel('loading');
    $('load').textContent = text || '';
    const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(text || ''), p = Number.isFinite(pct) ? pct : (m ? +m[1] : null);
    const meter = $('load-meter'), bar = $('load-bar');
    if (p == null) { meter.classList.add('ind'); meter.removeAttribute('aria-valuenow'); bar.style.transform = ''; }
    else { const v = Math.max(0, Math.min(100, p)); meter.classList.remove('ind'); meter.setAttribute('aria-valuenow', String(Math.round(v))); bar.style.transform = `scaleX(${v / 100})`; }
    const sb = $('load-sub'); sb.textContent = sub || ''; sb.hidden = !sub;
  }
  /** the game starts: the screen goes, and so does its picture's memory (show() brings it back) */
  function hide() { root.hidden = true; select(null); if (art) art.removeAttribute('src'); }
  function setCrumb(line) { const c = $('crumb'); c.textContent = line || ''; c.hidden = !line; }
  function choose() {
    if (W.queued) { const a = W.queued; W.queued = null; return Promise.resolve(a); }
    return new Promise((r) => W.waiters.push(r));
  }
  function setEnv(patch) { Object.assign(E, patch || {}); root.classList.toggle('lowmem', !!E.lowmem); renderSettings(); }

  refresh(); showPanel('main');
  return { show, hide, setLoading, setCrumb, choose, settings, setEnv, refresh, panel: () => W.panel, el: root };
}

/**
 * createPause({ $, onOpen, onResume, onSaveQuit, onLeave }) -> the pause sheet (#pause) behind the HUD's pause button (#pause-btn)
 *   onOpen() -> false (not now), or { canSave, line, world }: canSave false words the middle button "Quit to the landing screen" (the
 *     tutorial has no save); line is one status line ("Day 4 · 14:20"); world (default: canSave) words the restart for the open world.
 *     The page pauses the game here.
 *   onResume(): the sheet closed (Resume, Escape, the pause button again, the restart). onSaveQuit(): the page saves and reloads to the
 *     landing screen (return false, or a promise of false, to stay). onLeave(): back to p0pc0rn.
 *   The sound (#mute) and the restart (#reset) are the page's own buttons (its handlers on them, out of the HUD's top bar since Nov 3):
 *   the sound stays in the sheet; the restart closes it (the page puts a01 back first, then the game goes on).
 * -> { open(), close(), isOpen(), setLine(text) }
 */
export function createPause({ $ = (id) => document.getElementById(id), onOpen = null, onResume = null, onSaveQuit = null, onLeave = null } = {}) {
  const btn = $('pause-btn'), sheet = $('pause'), resume = $('pause-resume'), sq = $('pause-savequit'), lv = $('pause-leave'), line = $('pause-line');
  const mute = $('mute'), rs = $('reset'), rsSub = $('reset-sub');
  const P = { open: false, busy: false, sel: null };
  const items = () => [resume, mute, rs, sq, lv].filter((b) => b && !b.disabled && sheet.contains(b));
  const select = (b, focus = false) => { if (P.sel) P.sel.classList.remove('sel'); P.sel = b || null; if (b) { b.classList.add('sel'); if (focus) { try { b.focus({ preventScroll: true }); } catch (e) { /* */ } } } };
  function setLine(text) { line.textContent = text || ''; line.hidden = !text; }
  function open() {
    if (P.open) return true;
    let o; try { o = onOpen ? onOpen() : undefined; } catch (e) { o = undefined; }
    if (o === false) return false;
    o = o || {};
    $('pause-savequit-t').textContent = o.canSave === false ? 'Quit to the landing screen' : 'Save and quit to the landing screen';
    setLine(o.line || '');
    if (rs) {   // the restart, in the page's words: the step's start in the tutorial; the shelter's pad (or the dock) in the open world
      const world = o.world != null ? !!o.world : o.canSave !== false;
      if (rsSub) rsSub.textContent = world ? 'Pad or dock' : 'This step’s start';
      rs.setAttribute('aria-label', world ? 'Put a01 back on its shelter’s pad, or at the dock' : 'Put a01 back at this step’s start');
    }
    release();
    sheet.hidden = false; P.open = true; btn.setAttribute('aria-expanded', 'true');
    select(resume, true);
    return true;
  }
  function close() { if (!P.open) return; sheet.hidden = true; P.open = false; btn.setAttribute('aria-expanded', 'false'); select(null); }
  function doResume() { if (!P.open || P.busy) return; close(); if (onResume) { try { onResume(); } catch (e) { /* */ } } }
  function hold() { P.busy = true; for (const b of [sq, lv, rs]) if (b) b.disabled = true; }
  function release() { P.busy = false; for (const b of [sq, lv, rs]) if (b) b.disabled = false; }
  btn.addEventListener('click', () => (P.open ? doResume() : open()));
  resume.addEventListener('click', doResume);
  if (rs) rs.addEventListener('click', () => { if (sheet.contains(rs)) doResume(); });   // (after the page's own handler: a01 is put back, then the game goes on)
  sq.addEventListener('click', () => {
    if (P.busy) return; hold();
    let r; try { r = onSaveQuit ? onSaveQuit() : undefined; } catch (e) { r = false; }
    Promise.resolve(r).then((v) => { if (v === false) release(); }, () => release());
  });
  lv.addEventListener('click', () => { if (P.busy) return; hold(); try { if (onLeave) onLeave(); } catch (e) { release(); } });
  sheet.addEventListener('pointerover', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && !b.disabled) select(b); });
  sheet.addEventListener('focusin', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) select(b); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!P.open) { if (e.key === 'Escape' && btn.getClientRects().length && !btn.closest('[hidden]')) { if (open()) e.preventDefault(); } return; }
    const its = items();
    const step = (d) => { let i = its.indexOf(P.sel); i = i < 0 ? 0 : (i + d + its.length) % its.length; select(its[i], true); e.preventDefault(); };
    if (e.key === 'Escape') { doResume(); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && P.sel === mute)) step(1);
    else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && P.sel === rs)) step(-1);
  });
  return { open, close, isOpen: () => P.open, setLine };
}
