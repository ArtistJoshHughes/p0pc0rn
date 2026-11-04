// bench_voice.js - v4: Settings › Benchmark › Voice in (one button, as Troll-E + Juli's). A short sheet with the plan and Start; Start
// opens the bench's own page (ui/voicebench.html runs every step by itself, a fresh page a step, and goes on after a page the phone ends),
// and its card comes back here: the last run's lines with Copy. Shown when this build has the voice input pack; it reads and writes only
// the bench's own key (p0pc0rn:voicein:bench); it never runs while something is being made, nor before the agreement.
import { armBench, freshNonce } from './benchnonce.js';   // 4.0 (review)
import { BENCH_KEY, cardText, planLines, ETA_S } from './voicebench_plan.js';
import { consent } from '../rights.js';

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const last = () => { try { return JSON.parse(localStorage.getItem(BENCH_KEY) || 'null'); } catch (e) { return null; } };

export function mountVoiceBench({ diag = () => {}, busy = () => document.documentElement.hasAttribute('data-busy') } = {}) {
  if (!(globalThis.P0_CONFIG && P0_CONFIG.packs && P0_CONFIG.packs['nemotron35-asr-0.6b'])) return false;   // the feature is not in this build yet
  const row = document.querySelector('#v-settings .bench-row') || ($('s-bench-quick') && $('s-bench-quick').parentElement);
  if (!row || $('s-bench-voice')) return false;
  const btn = mk('button', 'btn sm', `Voice in · ~${Math.round(ETA_S / 60) + 1} min`); btn.type = 'button'; btn.id = 's-bench-voice';
  row.append(btn);
  const box = mk('div', 'bench-out'); box.id = 's-bench-voice-out';
  const anchor = $('s-bench-trolley-out') || $('s-bench-out') || row.parentElement; anchor.after(box);
  const render = (why = '') => { try { draw(why); } catch (e) { box.replaceChildren(); box.hidden = true; diag('bench: the last Voice in card could not be shown', { message: String((e && e.message) || e).slice(0, 120) }); } };   // a saved card never stops the button
  const draw = (why = '') => {
    box.replaceChildren(); const r = last();
    if (why) box.append(mk('p', 'callout', why));
    if (r && r.done) {
      box.append(mk('pre', 'mono footnote bench-text', cardText(r)));
      const c = mk('button', 'btn sm', 'Copy'); c.type = 'button';
      c.onclick = async () => { try { await navigator.clipboard.writeText(cardText(r)); c.textContent = 'Copied'; } catch (e) { c.textContent = 'Select the text to copy it'; } };
      box.append(c);
    } else if (r && !r.done && r.startedAt && Date.now() - r.startedAt < 20 * 60e3) box.append(mk('p', 'footnote dim', 'A Voice in bench was left unfinished. Start runs a new one.'));
    box.hidden = !box.childElementCount;
  };
  btn.onclick = () => {
    if (!consent()) return render('Agree to the p0pc0rn terms first (the short lesson).');
    let b = ''; try { b = busy() ? 'something is being made' : ''; } catch (e) { b = ''; }
    if (b) return render(`The Voice in bench opens when that’s done: ${b}.`);
    box.replaceChildren();
    box.append(mk('p', 'callout', `Voice in bench · about ${Math.round(ETA_S / 60) + 1} minutes. Its page opens and runs by itself: the recogniser alone, then beside Juli in her two layouts, playing bundled test speech into it (no microphone). Keep the phone plugged in and the screen on. If the page ends, that is a reading: it reloads and carries on. If Safari says “A problem repeatedly occurred”, tap Reload. Results stay on this phone.`));
    const ul = mk('ul', 'perm-list'); for (const l of planLines()) ul.append(mk('li', 'footnote', l)); box.append(ul);
    const go = mk('button', 'btn cta', 'Start'); go.type = 'button'; go.id = 's-bench-voice-go';
    go.onclick = () => {
      diag('bench: Voice in started', {});
      const n = freshNonce(); armBench(n);   // 4.0 (review): the page starts the run only with this tab's one-time nonce
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* the page asks again */ }
      const u = new URL('ui/voicebench.html', location.href); u.searchParams.set('bench', 'start'); u.searchParams.set('n', n);
      try { location.replace(u.href); } catch (e) { location.href = u.href; }
    };
    const no = mk('button', 'btn', 'Not now'); no.type = 'button'; no.onclick = () => render();
    box.append(go, no); box.hidden = false;
  };
  render();
  return true;
}
