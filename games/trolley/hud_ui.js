// hud_ui.js - Troll-E's HUD helpers (Josh, Nov 2: "the entire UI could use some work"; Nov 3: "It's impossible to see with all of the
// notifications and text"). DOM and classes only: no images, no canvas, no imports (main.js imports this, never the other way round).
// The look is game.css's.
//   createObjectiveChip(): the objective chip (#nav: #objective over #compass). The objective's name shows once as it changes (the chip
//     opens for ~5 s), then the chip folds to the compass and the distance; a tap (or Enter) opens it again, a tap or ~5 s folds it.
//   createMessages(): the ONE message area (#msg, just above the controls, never over the trolley or its path): one message at a time,
//     queued, Juli's first. Each stays as long as it takes to read (about 60 ms a character, at least 2.5 s), then fades.
//   createHintChip(): the step's hint as a chip in the top bar (#hint-box: "10 / 15"). A new step shows its hint in full in the message
//     area for ~5 s; a tap shows it again, a tap (or ~5 s) folds it.
//   createZoneFlash(): the zone's name (#zone-chip) shows for ~2 s when a01 moves into another one, then goes.
//   createComms(): wires them to the page's own elements: Juli's radio line (#radio, #radio-txt), her move chip (#juli-move), the toast
//     (#toast) and the hint stay where main.js writes them (their ids, words and hidden flags unchanged: the desks read them), hidden; what
//     they say is shown in the message area. Her subtitles always show: nothing here hides them, and there is no switch for them.

/**
 * createObjectiveChip({ root, onTap, openMs, settleMs, recentMs, now, timers }) -> { update(name, distM), open(ms), close(), isOpen(), el }
 *   root: the chip (#nav); its .nav-d gets the distance while it is folded
 *   update(name, distM): the objective now (name null: none), called with the HUD (main.js hud()). A new name that holds settleMs opens
 *     the chip for openMs, unless the chip showed that name within recentMs (two nearby things trading places as the nearest)
 *   onTap(open): after a tap opened or folded it
 */
export function createObjectiveChip({ root, onTap = null, openMs = 5000, settleMs = 600, recentMs = 20000, now = () => performance.now(), timers = globalThis } = {}) {
  const S = { open: false, cur: null, pend: null, pendAt: 0, shown: new Map(), timer: 0, d: null, none: null, ping: 'b' };
  if (!root) return { update() {}, open() {}, close() {}, isOpen: () => false, el: null };
  const dist = root.querySelector('.nav-d');
  const stop = () => { if (S.timer) { timers.clearTimeout(S.timer); S.timer = 0; } };
  function close() {
    stop(); S.open = false;
    root.classList.add('min'); root.setAttribute('aria-expanded', 'false');
  }
  function open(ms = openMs) {
    stop(); S.open = true;
    root.classList.remove('min'); root.setAttribute('aria-expanded', 'true');
    S.ping = S.ping === 'a' ? 'b' : 'a'; root.dataset.ping = S.ping;   // (the neon ping plays again: a new animation name each time)
    if (S.cur) { S.shown.set(S.cur, now()); if (S.shown.size > 12) S.shown.delete(S.shown.keys().next().value); }
    S.timer = timers.setTimeout(close, ms);
  }
  function update(name, distM) {
    const n = name ? String(name) : null, t = now();
    const ds = n && Number.isFinite(distM) ? `${distM.toFixed(1)} m` : '';
    if (ds !== S.d) { S.d = ds; if (dist) dist.textContent = ds; }
    if (S.none !== !n) { S.none = !n; root.classList.toggle('none', !n); }
    if (!n) { S.cur = null; S.pend = null; return; }
    if (n === S.cur) { S.pend = null; return; }
    if (S.pend !== n) { S.pend = n; S.pendAt = t; return; }
    if (t - S.pendAt < settleMs) return;
    S.cur = n; S.pend = null;
    const last = S.shown.get(n);
    if (last != null && t - last < recentMs) return;
    open();
  }
  function tap() {
    if (S.none) return;
    if (S.open) close(); else open();
    if (onTap) { try { onTap(S.open); } catch (e) { /* the page's problem */ } }
  }
  root.addEventListener('click', tap);
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat) { tap(); e.preventDefault(); } });
  close();
  return { update, open, close, isOpen: () => S.open, el: root };
}

/** how long a line stays: about `per` ms a character, at least `min`, at most `max` (Josh: ~60 ms a character, at least 2.5 s) */
export const readMs = (text, { per = 60, min = 2500, max = 9000 } = {}) => Math.max(min, Math.min(max, String(text || '').trim().length * per));

const JULI = new Set(['juli', 'move']);
const TOAST_KINDS = ['good', 'bad', 'rom'];

/**
 * createMessages({ el, speaking, blocked, hintMs, now, timers, tickMs, fadeMs, maxWaiting }) -> the one message area
 *   el: #msg (its .msg-card: .msg-move over .msg-k + .msg-t; made here if the markup has none)
 *   speaking(): true while Juli's voice is still saying a line: her subtitle stays until she is done (at most 15 s)
 *   blocked(): true while nobody can read it (the HUD hidden or dimmed, the pause sheet up): the clock of the message on screen waits
 * -> { push(m), dismiss(key), update(key, patch), current(), waiting(), onChange(fn), clear(), el }
 *   push({ kind, text, tag, cls, ms, key, now }): kind 'juli' (her line) | 'move' (her move) | 'hint' | 'toast'. Juli's go before the
 *     rest and take the place of a toast or a hint on screen (it comes back after, for what it had left). A move that comes with her line
 *     is shown with it (one message). key 'hint': one hint at a time (a newer one replaces it). now: shown at once (a tap)
 */
export function createMessages({ el, speaking = null, blocked = null, hintMs = 5000, now = () => performance.now(), timers = globalThis, tickMs = 200, fadeMs = 260, maxWaiting = 5 } = {}) {
  const Q = [], subs = [];
  let C = null, tick = 0, last = 0, fadeT = 0, fx = 'b', firstJuli = true, firstT = 0;
  const nop = { push() {}, dismiss() {}, update() {}, current: () => null, waiting: () => 0, onChange() {}, clear() {}, el: null };
  if (!el) return nop;
  let card = el.querySelector('.msg-card');
  if (!card) { card = document.createElement('div'); card.className = 'msg-card'; el.append(card); }
  const part = (cls) => { let p = card.querySelector('.' + cls); if (!p) { p = document.createElement('span'); p.className = cls; card.append(p); } return p; };
  const mv = part('msg-move'), line = card.querySelector('.msg-line') || card, k = part('msg-k'), t = part('msg-t');
  if (k.parentNode !== line) line.append(k);
  if (t.parentNode !== line) line.append(t);
  const juli = (m) => JULI.has(m.kind);
  const isBlocked = () => { try { return !!(blocked && blocked()); } catch (e) { return false; } };
  const emit = () => { for (const f of subs) { try { f(C); } catch (e) { /* */ } } };
  const timeFor = (m) => {
    if (m.ms) return m.ms;
    if (m.kind === 'hint') return hintMs;
    if (juli(m)) return readMs((m.move || '') + ' ' + (m.text || ''));
    return Q.length >= 2 ? readMs(m.text, { per: 45, min: 1800, max: 4500 }) : readMs(m.text, { per: 55, min: 2200, max: 7000 });
  };

  function render(m, pop = true) {
    const only = !m.text && !!m.move;   // her move on its own: "JULI · LIGHTS OUT 6 s"
    const kind = only ? 'move' : m.kind === 'move' ? 'juli' : m.kind, words = only ? m.move : m.text, over = only ? '' : m.move || '';
    card.className = 'msg-card k-' + kind + (m.cls ? ' ' + m.cls : '') + (words.length + over.length > 96 ? ' long' : '');
    mv.textContent = over; mv.hidden = !over;
    k.textContent = m.tag || ''; k.hidden = !m.tag && kind !== 'toast';
    t.textContent = words; t.hidden = !words;
    if (pop) { fx = fx === 'a' ? 'b' : 'a'; card.dataset.fx = fx; }   // (its little pop plays again: a new animation name each time)
  }
  function show(m) {
    if (fadeT) { timers.clearTimeout(fadeT); fadeT = 0; }
    C = m; m.shown = m.shown || 0; m.t0 = now(); m.ms = timeFor(m);
    render(m); el.classList.add('on');
    if (juli(m) && firstJuli && m.text) { firstJuli = false; el.classList.add('first'); if (firstT) timers.clearTimeout(firstT); firstT = timers.setTimeout(() => { el.classList.remove('first'); firstT = 0; }, 4200); }
    last = now(); if (!tick) tick = timers.setInterval(step, tickMs);
    emit();
  }
  function end() {
    if (!C) return;
    C = null; el.classList.remove('on');
    if (tick) { timers.clearInterval(tick); tick = 0; }
    emit();
    if (fadeT) timers.clearTimeout(fadeT);
    fadeT = timers.setTimeout(() => { fadeT = 0; next(); }, fadeMs);   // (it fades out, then the next fades in)
  }
  function next() { if (C || fadeT) return; const m = Q.shift(); if (m) show(m); }
  function step() {
    if (!C) return;
    const n = now(), dt = n - last; last = n;
    if (isBlocked()) return;
    C.shown += dt;
    if (C.shown < C.ms) return;
    if (juli(C) && speaking && C.shown < 15000) { let s = false; try { s = !!speaking(); } catch (e) { s = false; } if (s) return; }
    end();
  }
  /** a toast or a hint on screen gives way (it comes back first, for what it had left: at least 1.5 s) */
  function bump() {
    const m = C; C = null;
    m.ms = Math.max(1500, m.ms - m.shown); m.shown = 0; m.back = true;
    Q.unshift(m);
  }
  const sameAs = (a, b) => a && b && a.kind === b.kind && a.text === b.text && (a.move || '') === (b.move || '');
  function push(m0) {
    const m = Object.assign({ kind: 'toast', text: '', tag: '', cls: '', ms: 0, key: null }, m0);
    m.text = String(m.text || '').trim(); m.move = m.move ? String(m.move) : '';
    if (!m.text && !m.move) return;
    if (m.key) {   // one of its kind: a newer one replaces it (on screen: in place, its time again)
      for (let i = Q.length - 1; i >= 0; i--) if (Q[i].key === m.key) Q.splice(i, 1);
      if (C && C.key === m.key && !m.now) { Object.assign(C, { text: m.text, tag: m.tag, cls: m.cls }); C.shown = 0; render(C); emit(); return; }
    }
    if (C && sameAs(C, m)) { C.shown = Math.min(C.shown, 600); return; }   // the same again: it simply stays
    if (Q.some((q) => sameAs(q, m))) return;
    if (juli(m)) {
      // her move and her line together are one message (the move named over her line): a move joins her line on screen (at once: her
      // warnings are urgent) or the next one waiting; her line fills a move shown on its own a moment ago
      const grow = (x) => { if (x === C) { C.ms = Math.max(C.ms, C.shown + readMs(C.move + ' ' + C.text)); render(C); } };
      if (m.kind === 'move') {
        const tgt = C && juli(C) && C.text && !C.move ? C : Q.find((q) => juli(q) && q.text && !q.move) || null;
        if (tgt) { tgt.move = m.text; grow(tgt); return; }
        m.move = m.text; m.text = '';
      } else {
        const tgt = C && juli(C) && !C.text && C.shown < 2500 ? C : Q.find((q) => juli(q) && !q.text) || null;
        if (tgt) { tgt.kind = 'juli'; tgt.text = m.text; tgt.tag = m.tag; grow(tgt); return; }
      }
      m.tag = m.tag || 'JULI';
      if (C && !juli(C)) bump();
      let i = Q.findIndex((q) => !juli(q)); if (i < 0) i = Q.length;
      Q.splice(i, 0, m);
    } else if (m.now) {
      if (C) bump();
      Q.unshift(m);
    } else {
      Q.push(m);
      // a pile-up: the oldest plain toast waiting goes (never a warning, never the hint)
      const rest = Q.filter((q) => !juli(q));
      if (rest.length > maxWaiting) { const drop = rest.find((q) => q.kind === 'toast' && q.cls !== 'bad'); if (drop) Q.splice(Q.indexOf(drop), 1); }
    }
    if (!C) { if (fadeT) { timers.clearTimeout(fadeT); fadeT = 0; } next(); }
  }
  function dismiss(key) { if (C && (key == null || C.key === key)) end(); }
  function update(key, patch) {
    if (C && C.key === key) { Object.assign(C, patch); render(C, false); }
    for (const q of Q) if (q.key === key) Object.assign(q, patch);
  }
  function clear() { Q.length = 0; if (C) end(); }
  return { push, dismiss, update, current: () => C, waiting: () => Q.length, onChange: (f) => { subs.push(f); }, clear, el };
}

/**
 * createHintChip({ root, messages, ms }) -> { open(), close(), isOpen(), el }
 *   root: #hint-box (its #step: "10 / 15" or "DAY 3"; its #hint: the words, written by main.js). A new step (or a new hint main.js
 *   flashes) shows the words in the message area for ~ms; the open world's hint, rewritten as its clock runs, just follows quietly.
 *   A tap (or Enter) shows it; a tap again, or ~ms, folds it.
 */
export function createHintChip({ root, messages, ms = 5000 } = {}) {
  if (!root || !messages) return { open() {}, close() {}, isOpen: () => false, el: null };
  const stepEl = root.querySelector('#step') || root.querySelector('.step'), textEl = root.querySelector('#hint') || root.querySelector('p');
  const S = { step: null, text: null };
  const read = () => ({ step: stepEl ? stepEl.textContent.trim() : '', text: textEl ? textEl.textContent.trim() : '' });
  const msg = (now = false) => { const r = read(); return { kind: 'hint', key: 'hint', tag: r.step, text: r.text, ms, now }; };
  const isOpen = () => { const c = messages.current(); return !!(c && c.key === 'hint'); };
  function label() { const r = read(); root.setAttribute('aria-label', `The hint, ${r.step} (tap to ${isOpen() ? 'fold' : 'show'} it)`); }
  messages.onChange(() => { const o = isOpen(); if (o) root.dataset.open = ''; else delete root.dataset.open; root.setAttribute('aria-expanded', String(o)); label(); });
  function seen() {   // (main.js rewrites the open world's step every HUD tick, unchanged: nothing to do then)
    const r = read(); if (!r.text) return;
    if (r.step !== S.step) { S.step = r.step; S.text = r.text; messages.push(msg()); label(); }
    else if (r.text !== S.text) {
      S.text = r.text;
      if (root.classList.contains('flash')) messages.push(msg());
      else messages.update('hint', { text: r.text, tag: r.step });
    }
  }
  function open() { messages.push(msg(true)); }
  function close() { messages.dismiss('hint'); }
  function tap() { if (isOpen()) close(); else open(); }
  root.addEventListener('click', tap);
  root.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { tap(); e.preventDefault(); } });
  if (typeof MutationObserver === 'function') new MutationObserver(seen).observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  const r0 = read(); S.step = r0.step; S.text = r0.text; label();   // (the page's first words are the markup's: not news)
  root.setAttribute('aria-expanded', 'false');
  return { open, close, isOpen, el: root };
}

/** createZoneFlash({ el, ms }): #zone-chip shows (data-flash) for ~ms each time main.js writes a new zone into it */
export function createZoneFlash({ el, ms = 2000, timers = globalThis } = {}) {
  if (!el || typeof MutationObserver !== 'function') return { destroy() {} };
  let T = 0;
  const mo = new MutationObserver(() => {
    if (!el.textContent.trim()) return;
    el.dataset.flash = ''; if (T) timers.clearTimeout(T);
    T = timers.setTimeout(() => { delete el.dataset.flash; T = 0; }, ms);
  });
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  return { destroy: () => mo.disconnect() };
}

/**
 * createComms({ root, radio, move, toast, msg, hint, zone, speaking, blocked }) -> { messages, hint, destroy() }
 *   root: Juli's corner (#comms, hidden: it keeps her radio line and her move chip, made by main.js in the chips' row, moved here with
 *   its id and the page's hold on it unchanged); radio: #radio (its #radio-txt); move: #juli-move; toast: #toast; msg: #msg; hint:
 *   #hint-box; zone: #zone-chip (each looked up by id when not given). What main.js writes into them goes to the one message area.
 *   speaking(): Juli's voice is still saying her line (main.js: () => voice.speaking)
 */
export function createComms({ root = null, radio = null, move = null, toast = null, msg, hint, zone, speaking = null, blocked = null } = {}) {
  const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  if (msg === undefined) msg = byId('msg');
  if (hint === undefined) hint = byId('hint-box');
  if (zone === undefined) zone = byId('zone-chip');
  if (root && move && move.parentNode !== root) root.insertBefore(move, root.firstChild);
  const hud = msg ? msg.closest('.hud') : null, pause = byId('pause');
  const block = blocked || (() => !!(msg && (msg.closest('[hidden]') || (hud && hud.classList.contains('dim')) || (pause && !pause.hidden))));
  const messages = createMessages({ el: msg, speaking, blocked: block });
  const hintChip = createHintChip({ root: hint, messages });
  const zf = createZoneFlash({ el: zone });
  const line = radio ? radio.querySelector('#radio-txt') || radio : null;
  if (typeof MutationObserver !== 'function') return { messages, hint: hintChip, destroy() {} };
  const said = () => { const s = line ? line.textContent.trim() : ''; if (s) messages.push({ kind: 'juli', tag: 'JULI', text: s }); };
  const moved = () => { if (move.hidden) return; const s = move.textContent.replace(/^\s*JULI\s*·\s*/, '').trim(); if (s) messages.push({ kind: 'move', tag: 'JULI', text: s }); };
  const toasted = () => { const s = toast.textContent.trim(); if (!s) return; const cls = TOAST_KINDS.find((c) => toast.classList.contains(c)) || ''; messages.push({ kind: 'toast', text: s, cls }); };
  const mo = new MutationObserver((list) => {
    const hit = new Set();
    for (const m of list) {
      const tg = m.target && m.target.nodeType === 3 ? m.target.parentNode : m.target;
      for (const el of [line, move, toast]) if (el && tg && (el === tg || el.contains(tg))) hit.add(el);
    }
    // her line before her move (main.js says the line, then names the move), then the toast
    if (hit.has(line)) said();
    if (hit.has(move)) moved();
    if (hit.has(toast)) toasted();
  });
  for (const el of [line, move, toast]) if (el) mo.observe(el, { childList: true, characterData: true, subtree: true });
  return { messages, hint: hintChip, destroy: () => { mo.disconnect(); zf.destroy(); } };
}
