// tune.js - p0pc0rn v4: the "make p0pc0rn fast here" pop-up (Josh, Oct-29: "Autotune has to be a pop up in v4 to tune their phone/
// laptop to the most effective kernels known+measured") and its row in Settings › Benchmark (Speed: Tune again). It asks on the first
// run once the agreement is in, again after an update changes the kernels (or the browser), and any time from Settings. The tune itself
// (engine/tune/autotune.js) runs on its own graphics device with made-up numbers: nothing is downloaded or sent. The card says in plain
// words what runs well here; never a memory figure. Built from the app's own sheet, list and button classes (no new stylesheet).
// v4 (a laptop with two graphics chips can run p0pc0rn on its built-in one): the card says which graphics chip ran, every
// page logs it to Diagnostics once, and a Windows computer on built-in graphics gets a tip (Windows' per-app Graphics setting; Chrome on
// Windows ignores WebGPU's powerPreference): always in the results card, in the pop-up and in Settings › Benchmark until dismissed.
import { runTune } from '../engine/tune/autotune.js';
import { applyResult, writeCache, readCache, setAppVersion } from '../engine/tune/apply.js';
import { ASKED_KEY, tuneKey, promptReason, cardLines, integratedHint, platform, STATE_WORD, TIP_KEY, gpuLine, gpuKind, tipId, tipDue } from '../engine/tune/tunecore.js';
import { KERNEL_VERSION } from '../engine/llm/lopsx.js';

const T = { api: {}, el: null, running: null, shown: false };
const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const deviceWord = () => { const o = platform(navigator.userAgent || '').os; return o === 'iPhone' || o === 'Android' ? 'phone' : o === 'iPad' ? 'iPad' : 'computer'; };
const asked = () => { try { return JSON.parse(localStorage.getItem(ASKED_KEY) || 'null'); } catch (e) { return null; } };
const setAsked = (o) => { try { localStorage.setItem(ASKED_KEY, JSON.stringify(Object.assign({ t: Date.now() }, o))); } catch (e) { /* private mode */ } };
const diag = (s, d) => { try { T.api.diag && T.api.diag('tune: ' + s, d); } catch (e) { /* */ } };
const ua = () => (globalThis.navigator && navigator.userAgent) || '';
const tipDismissed = () => { try { return JSON.parse(localStorage.getItem(TIP_KEY) || 'null'); } catch (e) { return null; } };

/** the adapter's key now (the same fields as an engine's: engine/tune/apply.js keyOf) */
async function keyNow() {
  const ad = navigator.gpu && (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }));
  if (!ad) return { key: null, ad: null };
  const wgsl = navigator.gpu.wgslLanguageFeatures ? [...navigator.gpu.wgslLanguageFeatures] : [];
  return { ad, key: tuneKey({ info: ad.info || {}, limits: ad.limits, features: [...ad.features], wgsl, ua: navigator.userAgent || '', app: T.api.appVersion || '', kernels: KERNEL_VERSION }) };
}
/** v4: this page's adapter, asked for once (its key, and its info in T.info); the first answer goes to Diagnostics and paints the tip */
let ADP = null;
function adapterNow() {
  if (!ADP) {
    ADP = keyNow().then((r) => {
      if (r.ad) {
        const i = r.ad.info || {}, p = platform(ua());
        T.info = { vendor: i.vendor || '', architecture: i.architecture || '', description: i.description || '' };
        try { T.api.diag && T.api.diag('graphics adapter', Object.assign({}, T.info, { kind: gpuKind(T.info) || 'not known', os: p.os, browser: p.browser, fallback: !!(r.ad.isFallbackAdapter || i.isFallbackAdapter) })); } catch (e) { /* */ }
        paintTip();
      }
      return r;
    }, (e) => { ADP = null; diag('adapter', String((e && e.message) || e)); return { key: null, ad: null }; });
  }
  return ADP;
}
/** the tip for this computer now ('' = none): Windows, built-in graphics (engine/tune/tunecore.js integratedHint) */
const hintNow = (info = T.info) => (info ? integratedHint(info, platform(ua()).os, platform(ua()).browser) : '');

// ------------------------------------------------------------------------------------------------ the sheet
function build() {
  if (T.el) return T.el;
  const w = mk('div', 'sheet-wrap'); w.id = 'tune-sheet'; w.hidden = true;
  const scrim = mk('div', 'scrim'); scrim.dataset.close = '';
  const s = mk('div', 'sheet'); s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'tn-title');
  const bar = mk('div', 'bar'); bar.id = 'tn-bar'; bar.hidden = true; const fill = mk('i'); fill.id = 'tn-fill'; bar.append(fill);
  const card = mk('div', 'list'); card.id = 'tn-card'; card.hidden = true;
  const go = mk('button', 'btn cta', 'Tune now'); go.id = 'tn-go'; go.type = 'button';
  const later = mk('button', 'btn ghost', 'Later'); later.id = 'tn-later'; later.type = 'button'; later.dataset.close = '';
  const never = mk('button', 'btn ghost', 'Don’t ask again'); never.id = 'tn-never'; never.type = 'button';
  s.append(Object.assign(mk('p', 'title'), { id: 'tn-title' }), Object.assign(mk('p', 'callout dim'), { id: 'tn-text' }), bar, Object.assign(mk('p', 'footnote dim'), { id: 'tn-step' }),
    card, Object.assign(mk('p', 'footnote dim'), { id: 'tn-gpu', hidden: true }), Object.assign(mk('p', 'footnote'), { id: 'tn-hint', hidden: true }), go, later, never);
  w.append(scrim, s); document.body.append(w);
  w.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  go.onclick = () => (T.running ? stop() : T.done ? close() : start());
  never.onclick = () => { setAsked({ never: true }); close(); };
  T.el = w; return w;
}
function open(mode) {
  const w = build(), dev = deviceWord();
  T.done = false; $('tn-card').hidden = true; $('tn-card').replaceChildren(); $('tn-bar').hidden = true; $('tn-step').textContent = ''; $('tn-hint').hidden = true; $('tn-gpu').hidden = true;
  const hint = hintNow();   // v4: before a tune on built-in graphics, the way to the card first (unless dismissed in Settings on this device)
  if (tipDue(hint, tipDismissed(), tipId(T.info || {}, ua()))) { $('tn-hint').textContent = hint; $('tn-hint').hidden = false; }
  $('tn-go').textContent = 'Tune now'; $('tn-later').hidden = false; $('tn-never').hidden = mode === 'settings';
  $('tn-title').textContent = mode === 'update' ? 'p0pc0rn’s maths changed' : `Make p0pc0rn fast on this ${dev}`;
  $('tn-text').textContent = mode === 'update'
    ? `This update (or your browser’s) changed how p0pc0rn does its maths. Tune again to keep the fastest ways for this ${dev}. It takes about a minute.`
    : `p0pc0rn can try a few ways of doing its maths on this ${dev}’s graphics chip and keep the fastest ones that give the right answers. It takes about a minute. Keep p0pc0rn open. Nothing is downloaded and nothing leaves your ${dev}.`;
  w.classList.remove('out'); w.hidden = false; T.shown = true; $('tn-go').focus();
}
function close() {
  if (T.running) return;   // Stop first (the button)
  const w = T.el; if (!w || w.hidden) return;
  if (!T.done) setAsked({ forId: T.keyId || null });   // Later: not again by itself for this key (Settings › Benchmark › Speed still can)
  w.classList.add('out'); setTimeout(() => { w.hidden = true; w.classList.remove('out'); }, 240);
  T.shown = false; paintRow();
}
function stop() { if (T.running) T.running.abort(); }

async function start() {
  if (T.running) return;
  if (T.api.busy && T.api.busy()) { $('tn-step').textContent = 'p0pc0rn is busy with something. Try again when it has finished.'; return; }
  const ac = new AbortController(); T.running = ac;
  if (T.api.before) { try { await T.api.before(); } catch (e) { /* the tune goes on */ } }   // v4: voice input gives its memory back first
  $('tn-go').textContent = 'Stop'; $('tn-later').hidden = true; $('tn-never').hidden = true; $('tn-bar').hidden = false; $('tn-fill').style.transform = 'scaleX(0)';
  $('tn-text').textContent = 'Trying the ways this graphics chip can do p0pc0rn’s maths. Keep p0pc0rn open.';
  const models = ['e2b']; if (T.api.e4bHere && T.api.e4bHere()) models.push('e4b');
  let r = null, error = null;
  try {
    if (T.api.wake) try { T.api.wake(true); } catch (e) { /* */ }
    r = await runTune({ models, signal: ac.signal, app: T.api.appVersion || '', budgetMs: 85000,
      onStep: (t, f) => { $('tn-step').textContent = t; $('tn-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, f)).toFixed(3)})`; } });
  } catch (e) { error = e; }
  finally { T.running = null; if (T.api.wake) try { T.api.wake(false); } catch (e) { /* */ } }
  if (error && error.name === 'AbortError') { $('tn-text').textContent = 'Stopped. p0pc0rn keeps the settings it had.'; $('tn-step').textContent = ''; $('tn-bar').hidden = true; $('tn-go').textContent = 'Close'; T.done = true; $('tn-later').hidden = true; return; }
  if (error || !r) { diag('failed', String((error && error.message) || error)); $('tn-text').textContent = 'The tune stopped before it finished. p0pc0rn keeps its usual settings.'; $('tn-bar').hidden = true; $('tn-go').textContent = 'Close'; T.done = true; return; }
  if (r.f16 && !r.partial) { writeCache(r); applyResult(r); }
  else if (r.f16 && r.partial) { writeCache(Object.assign({}, r, { picks: null, ad: null })); }   // ran out of time: nothing changes
  else writeCache(r);
  setAsked({ forId: r.key && r.key.id });
  showResult(r); paintRow(); diag('done', { ms: r.ms, partial: r.partial, picks: r.picks ? Object.keys(r.picks).length : 0, ad: r.ad && r.ad.name });
}
function showResult(r) {
  T.done = true; $('tn-bar').hidden = true; $('tn-step').textContent = ''; $('tn-go').textContent = 'Done'; $('tn-later').hidden = true; $('tn-never').hidden = true;
  const secs = Math.max(1, Math.round((r.ms || 0) / 1000)), gain = r.est && r.est.e2b ? r.est.e2b.gain : null;
  $('tn-title').textContent = r.f16 ? `Done in ${secs} seconds` : 'p0pc0rn can’t run here';
  $('tn-text').textContent = !r.f16 ? '' : r.partial ? 'It ran out of time before every test finished, so p0pc0rn keeps its usual settings.'
    : gain >= 1.03 ? `Chat is about ${Math.round((gain - 1) * 100)}% faster than before on this ${deviceWord()}.` : `The usual settings were already the fastest here.`;
  const lines = cardLines({ f16: r.f16, wgMemKB: r.wgMemKB, os: r.os, e2bTokS: r.est && r.est.e2b && r.est.e2b.tokSAfter, e4bTokS: r.est && r.est.e4b && r.est.e4b.tokSAfter,
    e4bHere: T.api.e4bHere ? T.api.e4bHere() : false, e4bWhy: T.api.e4bWhy ? T.api.e4bWhy() : '', picSec: r.picSec, clipSec: r.clipSec });
  const card = $('tn-card'); card.replaceChildren();
  for (const l of lines) { const li = mk('div', 'li'); const a = mk('span'); a.append(mk('b', null, l.what), mk('br'), mk('span', 'footnote dim', l.why)); li.append(a, mk('span', l.state === 'well' ? 'ok' : 'dim', STATE_WORD[l.state])); card.append(li); }
  card.hidden = !lines.length;
  // v4: which graphics chip ran (vendor / architecture / description as the browser reports them), and on built-in graphics on Windows
  // the tip, always (the results card is where it is read)
  $('tn-gpu').textContent = r.info ? `Ran on: ${gpuLine(r.info)}` : ''; $('tn-gpu').hidden = !r.info;
  const hint = r.info ? integratedHint(r.info, r.os, platform(ua()).browser) : ''; $('tn-hint').textContent = hint ? hint + ' Then tune again.' : ''; $('tn-hint').hidden = !hint;
}

// ------------------------------------------------------------------------------------------------ Settings › Benchmark › Speed
function paintRow() {
  const st = $('s-speed-state'); if (!st) return;
  const c = readCache();
  st.textContent = !c ? 'Not tuned yet' : !c.f16 ? 'Can’t run on this graphics chip' : c.partial ? 'Last tune didn’t finish' : c.picks || c.ad ? 'Tuned for this device' : 'The usual settings are the fastest here';
}
function addRow() {
  if ($('s-speed')) return;
  const quick = $('s-bench-quick'), list = quick && quick.closest('.list'); if (!list) return;
  const li = mk('div', 'li'); li.id = 's-speed';
  const a = mk('span'); a.append(mk('span', null, 'Speed'), mk('br'), Object.assign(mk('span', 'footnote dim'), { id: 's-speed-state' }));
  const b = mk('button', 'btn sm', 'Tune for this device'); b.id = 's-speed-tune'; b.type = 'button'; b.onclick = () => open('settings');
  li.append(a, b);
  // v4: the faster-graphics-card tip (Windows on built-in graphics), until "Got it" on this device
  const tip = mk('div', 'li'); tip.id = 's-speed-tip'; tip.hidden = true; tip.setAttribute('role', 'note');
  const tt = mk('span', 'footnote'); tt.id = 's-speed-tip-text';
  const ok = mk('button', 'btn sm', 'Got it'); ok.id = 's-speed-tip-ok'; ok.type = 'button';
  ok.onclick = () => { try { localStorage.setItem(TIP_KEY, JSON.stringify({ id: tipId(T.info || {}, ua()), t: Date.now() })); } catch (e) { /* private mode */ } tip.hidden = true; diag('tip dismissed', {}); };
  tip.append(tt, ok); list.append(li, tip); paintRow(); paintTip();
}
function paintTip() {
  const box = $('s-speed-tip'); if (!box) return;
  const hint = hintNow(); box.hidden = !tipDue(hint, tipDismissed(), tipId(T.info || {}, ua()));
  $('s-speed-tip-text').textContent = box.hidden ? '' : hint;
}

/** api = { appVersion, busy(), consented(), e4bHere(), e4bWhy(), wake(on), diag(step, data), before() (v4: voice input lets go first) } */
/** v4: is the tune running now? (voice input waits for it) */
export const tuning = () => !!T.running;
export function initTune(api = {}) {
  T.api = api || {}; setAppVersion(T.api.appVersion || '');
  try { addRow(); } catch (e) { diag('row', String(e && e.message)); }
  // v4: a computer asks for its adapter now (which chip, the tip); a phone or tablet only when the pop-up looks (maybeAsk), as before
  // (an iPad's Safari says "Mac": a Mac with a touch screen is taken for one)
  const os = platform(ua()).os, ipad = os === 'Mac' && ((globalThis.navigator && navigator.maxTouchPoints) || 0) > 1;
  if (globalThis.navigator && navigator.gpu && !ipad && !['iPhone', 'iPad', 'Android'].includes(os)) adapterNow();
}
/** ask by itself when it should (first run, or a result for an older app / kernels / browser); never under automation unless a test asks */
export async function maybeAsk() {
  try {
    if (T.shown || T.running || !navigator.gpu) return '';
    const test = localStorage.getItem('p0pc0rn:test:tunepop');
    if (test === '0' || (navigator.webdriver && test !== '1')) return '';
    if (T.api.consented && !T.api.consented()) return '';
    if (T.api.busy && T.api.busy()) return '';
    const { key } = await adapterNow(); if (!key) return '';
    T.keyId = key.id;
    const why = promptReason(readCache(), asked(), key);
    if (why) open(why);
    return why;
  } catch (e) { diag('ask', String(e && e.message)); return ''; }
}
/** ask when the agreement is in and the phone is free: first after firstMs, then every 20 s for a while (a first run reads the lesson) */
export function scheduleAsk(firstMs = 4000, tries = 30) {
  let n = 0;
  const go = async () => {
    n++;
    if (T.shown || T.done) return;
    const waiting = (T.api.consented && !T.api.consented()) || (T.api.busy && T.api.busy()) || document.hidden;
    if (!waiting) { await maybeAsk(); return; }
    if (n < tries) setTimeout(go, 20000);
  };
  setTimeout(go, firstMs);
}
export const _test = { open, showResult, cardLines, paintTip, adapterNow, reset: () => { ADP = null; T.info = null; } };
