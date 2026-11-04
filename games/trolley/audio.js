// audio.js - the trolley's own sounds, made with Web Audio (no sound files): the hub motors' hum (v7: its pitch and level follow the
// tyres' speed, a little strain the motors' load), the steering servos while the modules swing, a clack when a passive part reaches its stop, a
// thump when the crate shifts in its pocket. v2: the arm's and the hoist's servos (the same servo voice, lower), a chime when trash
// earns ROMs, a wet splash when diesel spills. Starts on the first tap (iOS needs one).
// v6, Juli's voice (voice.js): her lines arrive as PCM (16 kHz) and play on the same master as every other sound, so the mute covers
// her. On the radio: a band from 350 Hz to 3.2 kHz (two biquads a side, a 4th-order Butterworth), a light bit-crush, a compressor, and
// a squelch with a little crackle opening and closing each line; radio off: the compressor alone, no squelch. playPCM(pcm, rate, opts)
// plays one line; squelch(kind, opts) the radio's open/close; voiceChain() is built once, at the first line.
// v7, the drive's sound redone (it "sounds like crying cats"): the old hub motors were a sawtooth and a square sweeping 55 -> 680 Hz
// and 110 -> 1.4 kHz at cruise through a resonant band-pass (Q 2.5) that climbed past 2 kHz, the old servos a triangle at 220-540 Hz
// with a 38 Hz vibrato: a cry and a warble, both in the band ears (and phone speakers) are keenest on. Now (DRIVE): one hum of integer
// harmonics (no detune, no LFO: nothing beats or wavers) low and narrow, 60 -> 104 Hz over the whole speed range (1.2 m/s sits at
// 91 Hz), under a gentle low-pass (Q 0.5, no peak) that opens a little with speed and load; pink noise under a low-pass for the tyres,
// very low; the servos a steady low sawtooth under a low-pass (the steering 150 Hz, the arm 118, the hoist 96) that spins up and down
// instead of warbling, with a whisper of gear noise; every level and pitch eased in and out (time constants, never steps); all of
// it on one bus (DRIVE.level, the default volume) through a last low-pass at 1.6 kHz, so nothing from the motors can squeal.
export const DRIVE = {
  level: 0.5,                              // the motors' bus into the master: hum, tyres and servos together (the default volume; at 0.5
                                           // a cruise is about 6 dB under the old motor on a phone speaker, 1.0 about level with it)
  f0: [60, 104], vRef: 1.0,                // the hum's fundamental (Hz), just moving -> flat out, along 1 - e^(-speed / vRef) (m/s)
  partials: [0.7, 0.75, 0.55, 0.4, 0.25, 0.15, 0.08, 0.04],   // the hum's harmonics 1..8 (a PeriodicWave; a triangle where there is none):
                                           // the 2nd-4th carry it (a phone speaker plays them), the fundamental is not left to boom
  lp: [300, 640], lpLoad: 160, q: 0.5,     // the hum's low-pass (Hz): at rest -> flat out, plus what full load opens; Q below 0.707
  hum: 0.07, humLoad: 0.022,               // the hum's level flat out (it starts at 45 % of that), and what full load adds (a stall's strain)
  move: [0.02, 0.25],                      // m/s: the hum fades in between these (and out again on the way down)
  load: [0.03, 0.4], loadT: 0.25,          // load (0..1) -> strain: the dead zone and full strain; strain's own smoothing (s)
  roll: 0.04, rollLp: [260, 700],          // the tyres: pink noise, its level flat out (about 16 dB under the hum), its low-pass (Hz)
  rise: 0.1, fall: 0.22, glide: 0.18,      // time constants (s): levels rising, levels falling, the pitch's glide
  servo: { steer: 150, arm: 118, hoist: 96, lp: 700, gain: 0.09, noise: 0.4, rise: 0.06, fall: 0.12, spin: 0.82 },   // spin: the pitch it winds down to
  bus: 1600,                               // the bus's last low-pass (Hz)
};
export const RADIO = {
  hp: 350, lp: 3200, q: [0.54, 1.31],   // the band's corners and the two stages' Q (together a 4th-order Butterworth each side)
  bits: 7,                               // the crush: 7-bit steps (64 a side), a light grit about 42 dB down
  comp: { threshold: -24, knee: 8, ratio: 6, attack: 0.003, release: 0.15 },     // the radio's
  clean: { threshold: -20, knee: 12, ratio: 3, attack: 0.005, release: 0.2 },    // radio off
  gain: 0.8,                             // the voice into the master
  open: 0.07, close: 0.16, cut: 0.09,    // the squelch's lengths (s): the key-up click, the tail, a line cut short
  squelch: 0.07, crackle: 0.6,           // the squelch's peak and its crackle's level (relative)
};
/** the crush's WaveShaper curve: x in -1..1 rounded to 2^(bits-1) steps a side */
export function crushCurve(bits = RADIO.bits, n = 4096) {
  const L = 2 ** (bits - 1), c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.round(((i / (n - 1)) * 2 - 1) * L) / L;
  return c;
}
/** linear resampling (only when a browser refuses a 16 kHz AudioBuffer; the radio's lowpass hides what it leaves) */
export function resample(pcm, from, to) {
  if (!(from > 0) || !(to > 0) || from === to) return pcm;
  const n = Math.max(1, Math.round(pcm.length * to / from)), out = new Float32Array(n), k = from / to, last = pcm.length - 1;
  for (let i = 0; i < n; i++) { const x = i * k, a = Math.min(last, Math.floor(x)), f = x - a; out[i] = pcm[a] + (pcm[Math.min(last, a + 1)] - pcm[a]) * f; }
  return out;
}
/** pink noise (Paul Kellet's filter), `sec` long, its end crossfaded into its start so it loops without a seam; RMS about 0.25 */
function pinkNoise(ctx, sec = 3) {
  const sr = ctx.sampleRate, n = Math.round(sr * sec), x = Math.round(sr * 0.1), a = new Float32Array(n + x);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, e = 0;
  for (let i = 0; i < a.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; e += a[i] * a[i];
  }
  const k = 0.25 / Math.sqrt(e / a.length || 1), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (i < x ? a[i] * Math.sqrt(i / x) + a[n + i] * Math.sqrt(1 - i / x) : a[i]) * k;
  return buf;
}
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
export function createAudio() {
  let ctx = null, master = null, motor = null, servo = null, noise = null, muted = false;
  let vch = null, crackle = null;   // v6: Juli's voice chain and the squelch's crackle, built at her first line
  const drv = { t: 0, strain: 0, last: new Map(), on: null, going: false, offAt: -1 };   // v7: the drive's state between frames
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return false;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    const D = DRIVE, lowpass = (f, q = D.q) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // v7: the motors' bus: everything below goes through its last low-pass and its level (DRIVE.level) into the master
    const busLp = lowpass(D.bus), bus = gain(D.level); busLp.connect(bus); bus.connect(master);
    // the hub motors: one hum of harmonics 1..8 under a gentle low-pass
    const o = ctx.createOscillator(), lp = lowpass(D.lp[0]), g = gain(0);
    o.type = 'triangle';
    if (typeof ctx.createPeriodicWave === 'function' && typeof o.setPeriodicWave === 'function') {
      const re = new Float32Array(D.partials.length + 1), im = new Float32Array(D.partials.length + 1);
      D.partials.forEach((p, i) => { im[i + 1] = p; });
      try { o.setPeriodicWave(ctx.createPeriodicWave(re, im)); } catch (e) { o.type = 'triangle'; }
    }
    o.frequency.value = D.f0[0]; o.connect(lp); lp.connect(g); g.connect(busLp); o.start();
    // the tyres and the servos' gears: one looped pink noise, two low-passes
    const pn = ctx.createBufferSource(), rlp = lowpass(D.rollLp[0]), rg = gain(0);
    pn.buffer = pinkNoise(ctx); pn.loop = true; pn.connect(rlp); rlp.connect(rg); rg.connect(busLp);
    motor = { o, lp, g, rlp, rg };
    // the servos: a steady low sawtooth under a low-pass (no vibrato), and a little band of gear noise with it
    const S = D.servo, s1 = ctx.createOscillator(), slp = lowpass(S.lp), sg = gain(0), nlp = lowpass(1500), nhp = ctx.createBiquadFilter(), ng = gain(0);
    s1.type = 'sawtooth'; s1.frequency.value = S.steer * S.spin; s1.connect(slp); slp.connect(sg); sg.connect(busLp); s1.start();
    nhp.type = 'highpass'; nhp.frequency.value = 400; nhp.Q.value = D.q; pn.connect(nlp); nlp.connect(nhp); nhp.connect(ng); ng.connect(busLp); pn.start();
    servo = { s1, sg, ng };
    const n = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = n;
    drv.t = ctx.currentTime;
    return true;
  }
  const now = () => (ctx ? ctx.currentTime : 0);
  /** an AudioParam eased towards v: the `up` time constant when v is above its last target, `down` below it */
  function ease(p, v, t, up, down = up) { const was = drv.last.get(p); drv.last.set(p, v); p.setTargetAtTime(v, t, was === undefined || v >= was ? up : down); }
  /** speed = mean tyre surface speed (m/s), load = 0..1 (torque against its cap), servo = 0..1 (modules swinging), arm/hoist = 0..1 (busy) */
  function update({ speed = 0, load = 0, servo: sv = 0, arm = 0, hoist = 0 }) {
    if (!ctx) return;
    const f = (v) => (Number.isFinite(v) ? v : 0); speed = f(speed); load = f(load); sv = f(sv); arm = f(arm); hoist = f(hoist);
    const D = DRIVE, S = D.servo, t = now(), dt = Math.min(0.25, Math.max(0, t - drv.t)); drv.t = t;
    // the hum: pitch, level and brightness follow speed along one soft curve; load (smoothed) adds a little strain
    const v = Math.abs(speed), u = 1 - Math.exp(-v / D.vRef), mv = smooth(D.move[0], D.move[1], v);
    drv.strain += (smooth(D.load[0], D.load[1], load) - drv.strain) * (1 - Math.exp(-dt / D.loadT));
    const L = drv.strain;
    motor.o.frequency.setTargetAtTime(D.f0[0] + (D.f0[1] - D.f0[0]) * u, t, D.glide);
    motor.lp.frequency.setTargetAtTime(D.lp[0] + (D.lp[1] - D.lp[0]) * u + D.lpLoad * L, t, D.glide);
    ease(motor.g.gain, mv * D.hum * (0.45 + 0.55 * u) + D.humLoad * L, t, D.rise, D.fall);
    motor.rlp.frequency.setTargetAtTime(D.rollLp[0] + (D.rollLp[1] - D.rollLp[0]) * u, t, D.glide);
    ease(motor.rg.gain, mv * D.roll * u * (1 + 0.6 * L), t, D.rise, D.fall);
    // the servos: the steering's, else the arm's, else the hoist's; each spins up to its pitch and winds down from it
    const kind = sv > 0.05 ? 'steer' : arm > 0.05 ? 'arm' : hoist > 0.05 ? 'hoist' : null;
    const w = kind === 'steer' ? Math.min(1, sv) : kind === 'arm' ? 0.85 * Math.min(1, arm) : kind === 'hoist' ? 0.75 * Math.min(1, hoist) : 0;
    if (kind && !drv.going && t - drv.offAt > 0.4) { servo.s1.frequency.cancelScheduledValues(t); servo.s1.frequency.setValueAtTime(S[kind] * S.spin, t); }   // rested: from the bottom
    const going = kind !== null; if (going !== drv.going) { drv.going = going; if (!going) drv.offAt = t; }
    if (kind) drv.on = kind;
    const pitch = S[drv.on || 'steer'] * (kind ? 1 : S.spin);
    servo.s1.frequency.setTargetAtTime(pitch, t, kind ? 0.12 : 0.2);
    ease(servo.sg.gain, S.gain * w, t, S.rise, S.fall); ease(servo.ng.gain, S.gain * S.noise * w, t, S.rise, S.fall);
  }
  function chime(n = 1) {   // ROMs: two bright notes, a third for a big one
    if (!ctx) return;
    const t = now(), notes = n >= 20 ? [988, 1319, 1976] : [988, 1480];
    notes.forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.08); g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.08 + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + i * 0.08 + 0.28);
      o.connect(g); g.connect(master); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.3); });
  }
  function sting() {   // Juli's radio sting: a falling two-tone through a little spring
    if (!ctx) return;
    const t = now(); [[880, 0], [587, 0.12], [440, 0.24]].forEach(([f, d]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.06, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + d + 0.16); o.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 0.18); });
  }
  function splash() { burst({ gain: 0.32, hp: 400, dur: 0.35, rate: 0.5 }); burst({ gain: 0.18, hp: 2500, dur: 0.2, rate: 0.8 }); }
  function burst({ gain = 0.3, hp = 1800, dur = 0.05, rate = 1 }) {
    if (!ctx) return;
    const t = now(), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.playbackRate.value = rate; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  }
  function clack(strength = 1) { burst({ gain: Math.min(0.35, 0.08 + strength * 0.12), hp: 2200, dur: 0.045 }); }
  function thump(strength = 1) {
    if (!ctx) return;
    const t = now(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    const v = Math.min(0.5, 0.15 + strength * 0.6); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
    burst({ gain: v * 0.4, hp: 300, dur: 0.08, rate: 0.6 });
  }
  function setMuted(m) { muted = !!m; if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.05); }
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
  // ---- v6: Juli's voice
  const setComp = (c, o) => { c.threshold.value = o.threshold; c.knee.value = o.knee; c.ratio.value = o.ratio; c.attack.value = o.attack; c.release.value = o.release; };
  /** the voice's two paths into the master: radioIn (the band, the crush, the compressor) and cleanIn (the compressor alone) */
  function voiceChain() {
    if (!ctx) return null;
    if (vch) return vch;
    const R = RADIO, radioIn = ctx.createGain(), cleanIn = ctx.createGain(), out = ctx.createGain(), crush = ctx.createWaveShaper(), comp = ctx.createDynamicsCompressor(), cleanComp = ctx.createDynamicsCompressor();
    const hp = R.q.map((q) => { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = R.hp; f.Q.value = q; return f; });
    const lp = R.q.map((q) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = R.lp; f.Q.value = q; return f; });
    crush.curve = crushCurve(R.bits); crush.oversample = 'none';
    setComp(comp, R.comp); setComp(cleanComp, R.clean); out.gain.value = R.gain;
    let n = radioIn; for (const f of [...hp, ...lp, crush, comp]) { n.connect(f); n = f; }
    n.connect(out); cleanIn.connect(cleanComp); cleanComp.connect(out); out.connect(master);
    vch = { radioIn, cleanIn, hp, lp, crush, comp, cleanComp, out };
    return vch;
  }
  function crackleBuffer() {   // sparse clicks, each a short decaying burst: the radio's crackle under the squelch
    if (crackle) return crackle;
    const sr = ctx.sampleRate, b = ctx.createBuffer(1, Math.round(sr * 0.4), sr), d = b.getChannelData(0), ring = Math.round(sr * 0.002);
    for (let i = 0; i < 60; i++) { const at = Math.floor(Math.random() * (d.length - ring)), a = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.7); for (let j = 0; j < ring; j++) d[at + j] += a * Math.exp(-j / (ring / 5)) * (Math.random() * 2 - 1); }
    return (crackle = b);
  }
  /** the radio's squelch: 'open' (a key-up click) or 'close' (the tail), at ctx time `at`; dur overrides its length. -> { start, end, stop() } */
  function squelch(kind = 'open', { at = 0, dur = 0 } = {}) {
    if (!ctx) return null;
    const ch = voiceChain(), R = RADIO, t = Math.max(now(), at || 0), close = kind !== 'open', d = dur > 0 ? dur : close ? R.close : R.open;
    const bp = ctx.createBiquadFilter(), g = ctx.createGain(), kg = ctx.createGain(), n = ctx.createBufferSource(), k = ctx.createBufferSource();
    bp.type = 'bandpass'; bp.frequency.value = close ? 2300 : 1600; bp.Q.value = 0.9; kg.gain.value = R.crackle;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(R.squelch, t + 0.004);
    if (close) g.gain.setValueAtTime(R.squelch, t + d * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0003, t + d);
    n.buffer = noise; k.buffer = crackleBuffer();
    n.connect(bp); k.connect(kg); kg.connect(bp); bp.connect(g); g.connect(ch.out);
    n.start(t, Math.random() * 0.3); k.start(t, Math.random() * 0.2); n.stop(t + d + 0.02); k.stop(t + d + 0.02);
    n.onended = () => { try { g.disconnect(); } catch (e) { /* gone */ } };
    return { kind: close ? 'close' : 'open', start: t, end: t + d, stop() { const s = now(); for (const x of [n, k]) { try { x.stop(s); } catch (e) { /* ended */ } } } };
  }
  /** one line of Juli's voice: pcm (Float32Array, -1..1) at `rate` Hz, through the radio chain (radio: true) or clean, starting at ctx
   *  time `at` (or now). -> { source, start, end, duration, radio, stop(fade) } or null (no context yet, or nothing to play) */
  function playPCM(pcm, rate = 16000, { radio = true, gain = 1, at = 0, onended = null } = {}) {
    if (!ctx || !pcm || !pcm.length) return null;
    const ch = voiceChain(); let buf;
    try { buf = ctx.createBuffer(1, pcm.length, rate); buf.getChannelData(0).set(pcm); }
    catch (e) { const up = resample(pcm, rate, ctx.sampleRate); buf = ctx.createBuffer(1, up.length, ctx.sampleRate); buf.getChannelData(0).set(up); }   // a browser without 16 kHz buffers
    const src = ctx.createBufferSource(), g = ctx.createGain(), t = Math.max(now(), at || 0);
    src.buffer = buf; g.gain.value = gain; src.connect(g); g.connect(radio ? ch.radioIn : ch.cleanIn);
    let done = false;
    src.onended = () => { if (done) return; done = true; try { g.disconnect(); } catch (e) { /* gone */ } if (onended) onended(); };
    src.start(t);
    return { source: src, start: t, end: t + buf.duration, duration: buf.duration, radio: !!radio,
      stop(fade = 0.03) { const s = now(); try { g.gain.cancelScheduledValues(s); g.gain.setValueAtTime(gain, s); g.gain.linearRampToValueAtTime(0, s + fade); src.stop(s + fade + 0.005); } catch (e) { /* ended */ } } };
  }
  return { start, update, clack, thump, chime, splash, sting, setMuted, suspend, resume, get muted() { return muted; }, get running() { return !!ctx && ctx.state === 'running'; },
    voiceChain, playPCM, squelch, get context() { return ctx; } };
}
