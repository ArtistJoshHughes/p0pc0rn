// bench_trolley.js - v4: Settings › Benchmark › Troll-E + Juli (Josh, Nov 1: "Write a phone bench to get some data I think"; "one button
// click option so that it runs the whole bench"). One button: a short sheet with the plan and Start; Start opens the game's own page in
// its bench mode (games/trolley/bench.js runs every step by itself, a fresh page a step, and goes on after a page the phone ends), and
// its card comes back here: the last run's lines with Copy. An unfinished run (v4, Nov 1: Josh's first run stopped after three page ends
// and showed nothing) shows every step it measured, where and why it stopped, Copy, and Continue from its next step. It reads and writes
// only the bench's own key (p0pc0rn:trolley:bench); it never runs while a job is queued or running (that page would look like it had died
// in the job), nor before the agreement.
import { armBench, freshNonce } from './benchnonce.js';   // 4.0 (review)
import { BENCH_KEY, cardText, planLines, ETA_S, whereStopped, continueAt } from '../games/trolley/bench_plan.js';
import { consent } from '../rights.js';

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const last = () => { try { return JSON.parse(localStorage.getItem(BENCH_KEY) || 'null'); } catch (e) { return null; } };

/** mount once (ui/settings.js initSettings): the button in the benchmark's row, its box under the benchmark's card */
export function mountTrolleyBench({ diag = () => {}, busy = () => document.documentElement.hasAttribute('data-busy') } = {}) {
  const row = document.querySelector('#v-settings .bench-row') || ($('s-bench-quick') && $('s-bench-quick').parentElement);
  // v4 (Nov 3; Josh's play crash left nothing in Diagnostics): the game's play trail of a page that ended mid-game, one line, once
  import('../games/trolley/trail.js').then((m) => m.reportTrail({ diag: (line) => diag(line, {}) })).catch(() => {});
  if (!row || $('s-bench-trolley')) return false;
  const btn = mk('button', 'btn sm', `Troll-E + Juli · ~${Math.round(ETA_S / 60) + 1} min`); btn.type = 'button'; btn.id = 's-bench-trolley';
  row.append(btn);
  const box = mk('div', 'bench-out'); box.id = 's-bench-trolley-out';
  const anchor = $('s-bench-out') || row.parentElement; anchor.after(box);
  /** why the bench cannot open now ('' = it can): the agreement first, and never over a job */
  const blocked = () => {
    if (!consent()) return 'Agree to the p0pc0rn terms first (the short lesson).';
    let b = ''; try { b = busy() ? 'something is being made' : ''; } catch (e) { b = ''; }
    return b ? `Troll-E + Juli opens when that’s done: ${b}.` : '';
  };
  /** open the game's page in its bench mode: a new run (start) or the unfinished one from its next step (continue) */
  const open = (mode, n, order = null) => {
    diag(mode === 'continue' ? 'bench: Troll-E + Juli continued' : 'bench: Troll-E + Juli started', {});
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* the game asks again */ }
    armBench(n);   // 4.0 (review): the page starts or continues the run only with this tab's one-time nonce
    const u = new URL('games/trolley/index.html', location.href); u.searchParams.set('bench', mode); u.searchParams.set('n', n); if (order) u.searchParams.set('order', order);
    try { location.replace(u.href); } catch (e) { location.href = u.href; }
  };
  const fresh = () => freshNonce();
  const copyBtn = (r, id) => {
    const c = mk('button', 'btn sm', 'Copy'); c.type = 'button'; c.id = id;
    c.onclick = async () => { try { await navigator.clipboard.writeText(cardText(r)); c.textContent = 'Copied'; } catch (e) { c.textContent = 'Select the text to copy it'; } };
    return c;
  };
  const contBtn = (r, at, cls) => {
    const c = mk('button', cls, `Continue the bench · step ${at.k} of ${at.of}`); c.type = 'button'; c.id = 's-bench-trolley-continue'; c.title = at.name;
    c.onclick = () => {
      const why = blocked(); if (why) return render(why);
      // v4 (Nov 3): this Continue, kept: if its page ends before the step begins, that step is recorded as ended and never offered again
      try { const cur = last(); if (cur && cur.nonce === r.nonce) { const ct = cur.contTried && cur.contTried.id === at.id ? cur.contTried : null; cur.contTried = { id: at.id, k: at.k, n: (ct ? ct.n : 0) + 1, opened: false, begun: false, at: Date.now() }; localStorage.setItem(BENCH_KEY, JSON.stringify(cur)); } } catch (e) { /* storage full: Continue still opens */ }
      open('continue', r.nonce);
    };
    return c;
  };
  const render = (why = '') => {
    box.replaceChildren(); const r = last();
    if (why) box.append(mk('p', 'callout', why));
    if (r && r.done) {
      box.append(mk('pre', 'mono footnote bench-text', cardText(r)), copyBtn(r, 's-bench-trolley-copy'));
    } else if (r && r.startedAt && !r.done) {   // v4: what it measured so far, where and why it stopped, and Continue
      const w = whereStopped(r), at = continueAt(r);
      // v4 (Nov 3): Continue first and clear, the moment an unfinished run is found
      if (at) box.append(contBtn(r, at, 'btn cta'));
      box.append(mk('p', 'footnote', `A Troll-E + Juli bench was left unfinished: ${w ? w.why : 'it stopped'}. Its steps so far are below.`));
      box.append(mk('pre', 'mono footnote bench-text', cardText(r)), copyBtn(r, 's-bench-trolley-copy'));
      if (!at) box.append(mk('p', 'footnote dim', 'Nothing is left to run: its last step ended the page (headroom does that on purpose), so the card above is complete.'));
    }
    box.hidden = !box.childElementCount;
  };
  btn.onclick = () => {
    const why = blocked(); if (why) return render(why);
    const r = last(), at = r && r.startedAt && !r.done ? continueAt(r) : null;
    box.replaceChildren();
    box.append(mk('p', 'callout', `Troll-E + Juli bench · about ${Math.round(ETA_S / 60) + 1} minutes. The game opens and runs by itself: a01 drives round the hall while Juli plays live on her own model at several split points, the Bigger brain plans her shift in a loading screen (in Troll-E v1 that is all it does), then the room left for the game. Keep the phone plugged in and the screen on. If the page ends, that is a reading: it reloads and carries on. If Safari says “A problem repeatedly occurred”, tap Reload: the bench goes on with its next step. If p0pc0rn opens instead, come back here and tap Continue. Results stay on this phone.`));
    const ul = mk('ul', 'perm-list'); for (const l of planLines()) ul.append(mk('li', 'footnote', l)); box.append(ul);
    if (at) box.append(contBtn(r, at, 'btn cta'));
    const go = mk('button', at ? 'btn' : 'btn cta', at ? 'Start a new run' : 'Start'); go.type = 'button'; go.id = 's-bench-trolley-go';
    go.onclick = () => open('start', fresh());
    // v4 (Nov 3): a one-off order: the Bigger brain's plot first, on a fresh page before any of Juli's steps
    const e4 = mk('button', 'btn', 'Start: the Bigger brain first'); e4.type = 'button'; e4.id = 's-bench-trolley-e4b'; e4.onclick = () => open('start', fresh(), 'e4b');
    const no = mk('button', 'btn', 'Not now'); no.type = 'button'; no.onclick = () => render();
    box.append(go, e4, no); box.hidden = false;
  };
  render();
  return true;
}
