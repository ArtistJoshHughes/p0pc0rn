// recorder.js (voice probe v002) - the read-aloud take: microphone -> 3-2-1 countdown -> live level -> auto-stop at the end of speech (or Stop)
// -> trim the silence -> checks (length, clipping, level, noise) in plain words. analyzeTake() is pure (unit-tested without a browser).
'use strict';

/** public-domain, phonetically rich scripts that fit the model's 3-10 s reference window (about 7-9 s read naturally): statements + a question */
export const SCRIPTS = [
  { id: 'fox', text: 'The birch canoe slid on the smooth planks. The quick brown fox jumps over the lazy dog. Are you ready?',
    src: 'a Harvard sentence (IEEE 1969), the traditional pangram, and a question' },
  { id: 'rainbow', text: 'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. Did you see it too?',
    src: 'the opening of the Rainbow Passage, and a question' },
  { id: 'well', text: "Glue the sheet to the dark blue background. It's easy to tell the depth of a well. Why is the sky so blue?",
    src: 'two Harvard sentences (IEEE 1969) and a question' },
  { id: 'rice', text: 'These days a chicken leg is a rare dish. Rice is often served in round bowls. Would you like some?',
    src: 'two Harvard sentences (IEEE 1969) and a question' },
];
export const MIN_S = 3, MAX_S = 12, IDEAL_MAX_S = 10, HARD_STOP_S = 16;

const rmsOf = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);

/** samples (mono Float32, any rate), rate, noise (RMS measured before speaking, or null) ->
 *  {ok, heard, start, end (samples), seconds, trimmed (Float32Array), peak, speechRms, noise, snrDb, clipped, checks: [{ok, warn, text}], why} */
export function analyzeTake(x, rate, noise = null) {
  const hop = Math.max(1, Math.round(rate * 0.01)), nF = Math.floor(x.length / hop), fr = new Float32Array(nF);
  for (let f = 0; f < nF; f++) fr[f] = rmsOf(x, f * hop, (f + 1) * hop);
  if (noise == null) { const s = Array.from(fr).sort((a, b) => a - b); noise = s[Math.floor(s.length * 0.1)] || 0; }   // the quietest tenth
  const thr = Math.max(noise * 3.2, 0.004);
  let first = -1, last = -1, act = 0, actSq = 0;
  for (let f = 0; f < nF; f++) if (fr[f] > thr) { if (first < 0) first = f; last = f; }
  // a run of >= 60 ms above the threshold counts as speech (a click does not)
  let heard = false; for (let f = 0, run = 0; f < nF; f++) { run = fr[f] > thr ? run + 1 : 0; if (run >= 6) { heard = true; break; } }
  const r = { ok: false, heard, noise, thr, checks: [] };
  if (!heard || first < 0) {
    r.checks.push({ ok: false, text: "I didn't hear any speech. Check that the microphone is allowed, then try again." });
    r.why = r.checks[0].text; r.seconds = 0; r.trimmed = new Float32Array(0); return r;
  }
  const start = Math.max(0, first * hop - Math.round(0.2 * rate)), end = Math.min(x.length, (last + 1) * hop + Math.round(0.3 * rate));
  const t = x.slice(start, end);
  for (let f = first; f <= last; f++) if (fr[f] > thr) { act++; actSq += fr[f] * fr[f]; }
  let peak = 0, clip = 0, run = 0, longest = 0;
  for (let i = 0; i < t.length; i++) { const a = Math.abs(t[i]); if (a > peak) peak = a; if (a >= 0.99) { clip++; run++; if (run > longest) longest = run; } else run = 0; }
  const speechRms = Math.sqrt(actSq / Math.max(1, act)), seconds = t.length / rate, snrDb = db(speechRms) - db(Math.max(noise, 1e-5));
  Object.assign(r, { start, end, seconds, trimmed: t, peak, speechRms, snrDb, clipped: clip / Math.max(1, t.length), clipRun: longest });
  const C = r.checks;
  if (seconds < MIN_S) C.push({ ok: false, text: `That was short (${seconds.toFixed(1)} s). Read the whole script, then stop.` });
  else if (seconds > MAX_S) C.push({ ok: false, text: `That was long (${seconds.toFixed(1)} s). Read a little faster, and stop right after the last word.` });
  else C.push({ ok: true, warn: seconds > IDEAL_MAX_S, text: `Length ${seconds.toFixed(1)} s${seconds > IDEAL_MAX_S ? ' (a bit long, but it works)' : ''}.` });
  if (r.clipped > 0.0005 || longest >= 4) C.push({ ok: false, text: 'Too loud: the sound clipped. Hold the phone a little further away and try again.' });
  else C.push({ ok: true, text: 'Not clipped.' });
  if (speechRms < 0.01 || peak < 0.05) C.push({ ok: false, text: 'Too quiet. Hold the phone closer (about a hand’s width) and speak up a little.' });
  else C.push({ ok: true, text: `Level good (${db(speechRms).toFixed(0)} dBFS).` });
  if (snrDb < 14) C.push({ ok: true, warn: true, text: 'The room is a bit noisy; a quieter spot sounds better.' });
  r.ok = C.every((c) => c.ok);
  r.why = (C.find((c) => !c.ok) || {}).text || '';
  return r;
}

/** the microphone, opened inside a tap. -> {ctx, rate, start(), stop(), close()}; onBlock({rms, peak, t, capturing}) per ~40 ms block */
export async function openMic(onBlock) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try { await ctx.resume(); } catch (e) { /* */ }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch (e) { try { await ctx.close(); } catch (e2) { /* */ } throw Object.assign(new Error('The microphone is not allowed: ' + (e.message || e.name)), { code: 'NO_MIC' }); }
  const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(2048, 1, 1), mute = ctx.createGain();
  mute.gain.value = 0;
  const chunks = []; let capturing = false, n = 0;
  proc.onaudioprocess = (ev) => {
    const d = ev.inputBuffer.getChannelData(0);
    let s = 0, p = 0; for (let i = 0; i < d.length; i++) { const v = d[i]; s += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; }
    if (capturing) { chunks.push(new Float32Array(d)); n += d.length; }
    if (onBlock) onBlock({ rms: Math.sqrt(s / d.length), peak: p, t: n / ctx.sampleRate, capturing });
  };
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  return {
    ctx, rate: ctx.sampleRate,
    start() { chunks.length = 0; n = 0; capturing = true; },
    stop() { capturing = false; const out = new Float32Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } chunks.length = 0; return out; },
    async close() { capturing = false; try { proc.onaudioprocess = null; src.disconnect(); proc.disconnect(); mute.disconnect(); } catch (e) { /* */ } stream.getTracks().forEach((t) => t.stop()); try { await ctx.close(); } catch (e) { /* */ } },
  };
}

/** end-of-speech detector for the live take: feed(rms, t) -> 'stop' | null. expectSec = the script's natural length */
export function endpointer(noise, expectSec) {
  const thr = Math.max(noise * 3.2, 0.006);
  let run = 0, started = -1, lastVoice = -1;
  return {
    thr,
    feed(rms, t) {
      if (rms > thr) { run++; if (run >= 3 && started < 0) started = t; lastVoice = t; } else run = 0;
      if (t >= HARD_STOP_S) return 'stop';
      if (started < 0) return t > 7 ? 'stop' : null;   // nothing heard in 7 s
      const spoken = lastVoice - started, quiet = t - lastVoice;
      if (spoken >= 0.6 * expectSec && quiet >= 1.2) return 'stop';
      if (spoken >= 2 && quiet >= 2.2) return 'stop';
      return null;
    },
    get started() { return started; },
  };
}
