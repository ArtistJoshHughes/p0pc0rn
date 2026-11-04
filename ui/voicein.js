// ui/voicein.js - v4: talk to Juli (Josh, Nov 1: "Let's use Nvidia's best"; Nov 2: "Yes lock it in and I also want some kind of wave form
// visualizer"). The mic button in her chat: tap, speak (a live waveform beside it), your words appear in the message box as you say them
// (NVIDIA Nemotron 3.5 ASR Streaming on this phone, engine/stt/), and when you stop talking the message is sent after a short pause with
// Undo and Edit; Settings › Juli can turn the sending off (the words stay in the box). Tap the mic again to stop. A spoken message gets a
// spoken answer (voice mode, Settings › Juli › "Juli speaks her replies"): Juli starts with a mood tag (never shown or spoken: app.js
// brainChat strips it) and her first sentence is spoken while the rest is written (ui/voicetalk.js through ui/voiceout.js: her own voice, p0voice, in the reply's mood; Flite when it cannot run);
// Stop ends it. The microphone is asked for on the first tap only; the audio never leaves the phone and is never stored. The recogniser
// and her voice load on the first tap, beside Juli (on iOS 27 Juli then keeps layers 0-28 in the second process: app.js voiceLayout),
// and are let go after a minute without use, when the page is hidden, before any other model loads and when voice input is switched off.
// Kept: only the settings (localStorage p0pc0rn:voice).
import { openMic16k } from '../engine/stt/mic.js';
import { createVoiceOut, setMood } from './voiceout.js';
import { createTalker } from './voicetalk.js';
import { createWave } from './voicewave.js';

const KEY = 'p0pc0rn:voice';
const IDLE_MS = 60e3, SENT_MS = 3000, QUIET_MS = 12e3, VOICE_TURN_MS = 120e3;
// the locales NVIDIA lists as transcription-ready or broad-coverage (the model card), plus Automatic
export const VOICE_LANGS = [['auto', 'Automatic'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Spanish (Spain)'], ['es-US', 'Spanish (US)'],
  ['fr-FR', 'French'], ['fr-CA', 'French (Canada)'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'],
  ['nl-NL', 'Dutch'], ['tr-TR', 'Turkish'], ['ru-RU', 'Russian'], ['ar-AR', 'Arabic'], ['hi-IN', 'Hindi'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'],
  ['vi-VN', 'Vietnamese'], ['uk-UA', 'Ukrainian'], ['pl-PL', 'Polish'], ['sv-SE', 'Swedish'], ['cs-CZ', 'Czech'], ['nb-NO', 'Norwegian (Bokmål)'], ['da-DK', 'Danish'],
  ['bg-BG', 'Bulgarian'], ['fi-FI', 'Finnish'], ['hr-HR', 'Croatian'], ['sk-SK', 'Slovak'], ['zh-CN', 'Chinese (Mandarin)'], ['hu-HU', 'Hungarian'], ['ro-RO', 'Romanian'], ['et-EE', 'Estonian']];
/** the phone's own language when the model knows it, else Automatic */
export function defaultLang(nav = globalThis.navigator) {
  const l = String((nav && (nav.language || (nav.languages && nav.languages[0]))) || '');
  const hit = VOICE_LANGS.find(([k]) => k.toLowerCase() === l.toLowerCase()) || VOICE_LANGS.find(([k]) => k !== 'auto' && k.split('-')[0] === l.split('-')[0].toLowerCase());
  return hit ? hit[0] : 'auto';
}
export function voiceSettings() {
  let v = null; try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { v = null; }
  v = Object.assign({ on: true, autoSend: true, speak: true, lang: null }, v || {});
  if (!v.lang || !VOICE_LANGS.some(([k]) => k === v.lang)) v.lang = defaultLang();
  return v;
}
function saveSettings(p) { const v = Object.assign(voiceSettings(), p); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private browsing */ } return v; }

/** the recogniser hears "Juli" as "Julie": put her name right where it is said TO her (the start of what was said, after a greeting, or
 *  at the very end after a comma); a Julie in the middle of a sentence, or Julie's, is someone else and stays */
// v4 (Josh's phone, Nov 2: "Hey Juli" heard as "Hagely"): her name after a greeting, misheard as one word or as a near name, at the very
// start only: "Hagely", "Heyjuli", "Hey gully", "Hi jolly" -> "Hey Juli", "Hi Juli". Never "Hagley Park" (no vowel after the g), "Hugely",
// "Hey Julia", "Hey jelly", or such words later in the sentence
const WAKE_ONE = /^(\s*)h[ae]y?[gj](?:u|oo|o|e)l+(?:ie|ee|ey|y|i)\b(?!['’]s)/i;
const WAKE_TWO = /^(\s*)(hey|hi|hello|ok|okay)([\s,!.]+)[gj](?:u|oo|o)l+(?:ie|ee|ey|y|i)\b(?!['’]s)/i;
export function fixName(text) {
  return String(text || '')
    .replace(WAKE_ONE, (m, sp) => sp + 'Hey Juli').replace(WAKE_TWO, (m, sp, g, sep) => sp + g + sep + 'Juli')
    .replace(/^(\s*(?:(?:hey|hi|hello|ok|okay|oh|so|thanks|thank you|yes|no)[\s,!.]+)?)julie\b(?!['’]s)/i, (m, pre) => pre + 'Juli')
    .replace(/\b(hey|hi|hello|ok|okay|thanks|thank you)([\s,!.]+)julie\b(?!['’]s)/gi, (m, g, sep) => g + sep + 'Juli')
    .replace(/,\s*julie([.?!]*)\s*$/i, (m, p) => ', Juli' + p);
}

/** app: { engine() (E.stt), ready() (downloaded), here() (fits beside Juli on this phone), consented(), openLesson(), toast(m), diag(m, d),
 *  send({ voice }) (the chat's send: the message box's text), input() (the message box), canSend(), busyWhy() (what voice input waits
 *  for: '' if nothing), beforeLoad() (makes room before the recogniser loads), onChange() (a setting changed) } */
export function initVoiceIn(app) {
  const $ = (id) => document.getElementById(id);
  const V = { state: 'idle', mic: null, stream: null, prefix: '', idleT: 0, sendT: 0, text: '', voiceAt: 0, usedAt: 0, bar: 'off' };
  const btn = $('as-mic'), bar = $('as-voicebar'), barText = $('as-voicebar-text'), undo = $('as-voice-undo'), edit = $('as-voice-edit'), stopB = $('as-voice-stop');
  const wave = createWave($('as-wave'));
  const voice = createVoiceOut({ diag: app.diag });   // v4: her own voice (p0voice), Flite as the fallback
  const talker = createTalker({ voice, diag: app.diag, onState: (s) => { if (s === 'speaking') showBar('juli'); else if (V.bar === 'juli') showBar('off'); } });
  const usable = () => { const s = voiceSettings(); return !!app.engine() && app.ready() && app.here() && s.on && !(app.paused && app.paused()); };   // paused: Juli needs the memory (app.js pauseVoice)
  const speaks = () => usable() && voiceSettings().speak;
  function render() {
    if (!btn) return;
    btn.hidden = !usable();
    btn.classList.toggle('on', V.state === 'listening');
    btn.classList.toggle('wait', V.state === 'starting');
    btn.setAttribute('aria-label', V.state === 'listening' ? 'Stop listening' : 'Speak to Juli');
    btn.setAttribute('aria-pressed', String(V.state === 'listening'));
    const inp = app.input(); if (inp) inp.placeholder = V.state === 'listening' ? 'Listening…' : V.state === 'starting' ? 'Getting the microphone ready…' : 'Message Juli';
  }
  /** the bar over the message box: 'mic' (your waveform), 'send' (Sent · Undo Edit), 'juli' (her waveform, Stop), 'off' */
  function showBar(mode) {
    V.bar = mode; if (!bar) return;
    bar.hidden = mode === 'off'; bar.dataset.mode = mode;
    if (barText) barText.textContent = mode === 'mic' ? 'Listening' : mode === 'send' ? 'Sent' : mode === 'juli' ? 'Juli is speaking' : '';
    if (undo) undo.hidden = mode !== 'send'; if (edit) edit.hidden = mode !== 'send'; if (stopB) stopB.hidden = mode !== 'juli' && mode !== 'mic';
    wave.show(mode === 'mic' ? 'mic' : mode === 'juli' ? 'juli' : 'off', talker.analyser);
  }
  const setBox = (t) => { const inp = app.input(); if (!inp) return; inp.value = t; inp.dispatchEvent(new Event('input')); };
  const joined = (t) => (V.prefix && t ? V.prefix.replace(/\s+$/, '') + ' ' + t : V.prefix + t);
  function hideSend() { clearTimeout(V.sendT); V.sendT = 0; if (V.bar === 'send') showBar('off'); }
  function scheduleRelease() { clearTimeout(V.idleT); V.idleT = setTimeout(() => { if (V.state === 'idle' && !talker.speaking) release('idle'); }, IDLE_MS); }

  async function start() {
    if (V.state !== 'idle') return;
    if (!app.consented()) return app.openLesson();
    const why = app.busyWhy(); if (why) return app.toast(`Voice input waits until ${why} is done.`);
    talker.stop(); talker.unlock(); hideSend(); clearTimeout(V.idleT);   // the tap: her voice stops (you talk now), the speaker is unlocked
    V.state = 'starting'; V.usedAt = Date.now(); render();
    try {
      const e = app.engine(), eng = e.lazy ? await e.ensure() : e;
      if (!eng.loaded) { if (app.beforeLoad) await app.beforeLoad(); const r = await eng.load(); app.diag('voice input loaded', { seconds: +r.seconds.toFixed(2), gpuMB: r.gpuMB }); }
      if (speaks() && !voice.loaded) voice.load().then(() => app.diag('voice: her voice', { voice: voice.name, why: voice.why || null, timings: voice.timings, mb: +(voice.memoryBytes() / 1e6).toFixed(1) }),
        (x) => app.diag('voice: her voice did not load', { message: String((x && x.message) || x).slice(0, 120) }));   // beside the first words
      const s = voiceSettings(), inp = app.input();
      V.prefix = inp && inp.value.trim() ? inp.value : ''; V.text = '';
      V.stream = eng.stream({ lang: s.lang, lookahead: 3, eouMs: 900,
        onText: ({ text }) => { V.text = fixName(text); setBox(joined(V.text)); V.voiceAt = Date.now(); },
        onEnd: ({ reason }) => { if (reason === 'silence' || reason === 'max') stop(s.autoSend && reason === 'silence'); else if (reason === 'error') stop(false); } });
      V.mic = await openMic16k({ onAudio: (b) => { if (V.stream) V.stream.push(b); }, onLevel: (rms) => wave.mic(rms) });
      V.state = 'listening'; render(); showBar('mic'); if (app.listening) app.listening();   // v4: the app stops a voice warm-up (app.js warmVoice)
      clearTimeout(V.quietT);   // nothing said at all: the microphone is let go after a while
      V.quietT = setTimeout(() => { if (V.state === 'listening' && !V.text) { stop(false); app.toast('I didn’t hear anything. Tap the mic and try again.'); } }, QUIET_MS);
    } catch (x) {
      try { if (V.stream) V.stream.cancel(); } catch (y) { /* */ } V.stream = null;
      V.state = 'idle'; render(); showBar('off');
      const code = x && x.code;
      if (code === 'NO_MIC') app.toast('The microphone isn’t allowed. Allow it for this site in Settings › Apps › Safari › Microphone, then tap the mic again.');
      else if (code === 'NOT_DOWNLOADED') app.toast('Voice input isn’t on this phone yet: Settings › Models.');
      else app.toast('Voice input couldn’t start. Try again.');
      app.diag('voice input did not start', { code: code || null, error: String((x && x.message) || x).slice(0, 160) });
      scheduleRelease();
    }
  }
  /** stop listening; send = the person stopped talking and auto-send is on (sent at once; Undo / Edit for a few seconds) */
  async function stop(send) {
    if (V.state !== 'listening' && V.state !== 'starting') return;
    V.state = 'stopping'; render(); clearTimeout(V.quietT); if (V.bar === 'mic') showBar('off');
    const mic = V.mic, st = V.stream; V.mic = null;
    if (mic) await mic.close();
    let text = V.text;
    if (st) { try { const r = await st.finish(); text = fixName(r.text); app.diag('voice input', Object.assign({ chars: text.length }, r.stats)); } catch (x) { /* cancelled */ } }
    V.stream = null; V.state = 'idle'; V.usedAt = Date.now(); render();
    if (text) { setBox(joined(text)); V.voiceAt = Date.now(); }
    scheduleRelease();
    if (send && text.trim() && app.canSend()) {   // sent at once (Juli starts reading now); Undo or Edit for a few seconds stops her answer
      V.sentText = joined(text); app.send();
      if (!bar) return;
      showBar('send'); V.sendT = setTimeout(() => hideSend(), SENT_MS);
    }
  }
  /** give the recogniser's and her voice's memory back (idle, another model is about to load, the page is hidden, switched off) */
  async function release(why = '') {
    clearTimeout(V.idleT);
    if (V.state === 'listening' || V.state === 'starting') { hideSend(); await stop(false); }
    talker.stop(); voice.unload();
    const e = app.engine(); if (!e || (e.lazy && !e.loaded)) return;   // the lazy wrapper: its module was never started, nothing to free
    try { const real = e.lazy ? await e.ensure() : e; if (real.loaded) { real.unload(); if (why) app.diag('voice input unloaded', { why }); } } catch (x) { /* */ }
  }
  if (btn) btn.onclick = () => (V.state === 'listening' ? stop(false) : start());
  /** Undo / Edit after a message went: her answer stops (the chat job is cancelled), the words come back to the message box */
  const takeBack = () => { hideSend(); talker.stop(); if (app.undoSend) app.undoSend(); setBox(V.sentText || ''); V.voiceAt = Date.now(); };
  if (undo) undo.onclick = () => { takeBack(); setBox(V.prefix); V.voiceAt = 0; };
  if (edit) edit.onclick = () => { takeBack(); const inp = app.input(); if (inp) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (x) { /* */ } } };
  if (stopB) stopB.onclick = () => { if (V.state === 'listening') stop(false); else { talker.stop(); showBar('off'); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') release('hidden'); });

  // ---- Settings › Juli › Voice input
  function renderSettings() {
    const row = $('s-voice-box'); if (!row) return;
    row.hidden = !(app.engine() && app.ready() && app.here());
    const s = voiceSettings();
    $('s-voice').checked = s.on; $('s-voice-auto').checked = s.autoSend; $('s-voice-auto').disabled = !s.on;
    const sp = $('s-voice-speak'); if (sp) { sp.checked = s.speak; sp.disabled = !s.on; }
    const sel = $('s-voice-lang');
    if (!sel.options.length) for (const [k, n] of VOICE_LANGS) { const o = document.createElement('option'); o.value = k; o.textContent = n; sel.append(o); }
    sel.value = s.lang; sel.disabled = !s.on;
  }
  const sw = (id, key) => { const el = $(id); if (el) el.addEventListener('change', () => {
    saveSettings({ [key]: id === 's-voice-lang' ? el.value : el.checked }); renderSettings(); render();
    if (!voiceSettings().on || !voiceSettings().speak) { talker.stop(); voice.unload(); if (!voiceSettings().on) release('switched off'); }
    if (app.onChange) app.onChange(); }); };
  sw('s-voice', 'on'); sw('s-voice-auto', 'autoSend'); sw('s-voice-speak', 'speak'); sw('s-voice-lang', 'lang');
  render();
  return {
    render, renderSettings, release, get state() { return V.state; }, settings: voiceSettings,
    /** the chat's send: did this message come from the mic (voice filled the box in the last 2 minutes)? Once per message */
    takeVoice() { const v = V.voiceAt && Date.now() - V.voiceAt < VOICE_TURN_MS; V.voiceAt = 0; return !!v; },
    /** voice input in use (listening, or used in the last 90 s, or she is speaking): Juli stays loaded longer between turns */
    active() { return V.state !== 'idle' || talker.speaking || (V.usedAt && Date.now() - V.usedAt < 90e3); },
    /** her spoken reply (voice mode): begin, the words so far, the whole reply; or one reply at once; stop */
    speaks,
    listening: () => V.state === 'listening' || V.state === 'starting',   // v4: no voice warm-up while the mic is open (app.js)
    replyBegin() { setMood(null); if (speaks()) { talker.unlock(); talker.begin(); } },   // v4: no mood until this reply's tag arrives
    replyNext() { if (speaks()) talker.next(); },
    replyFeed(text) { if (speaks()) talker.feed(text); },
    replyEnd(text) { if (speaks()) talker.end(text); V.usedAt = Date.now(); scheduleRelease(); },
    replySpeak(text) { setMood(null); if (speaks()) talker.speak(text); V.usedAt = Date.now(); scheduleRelease(); },
    stopSpeaking() { talker.stop(); },
  };
}
