/* p0pc0rn Kit v1.4 (kit.js) - the design, motion and input layer every p0pc0rn app is built on.
   Vendored and LOCKED: p0pc0rn sends this file into every app's sandbox ahead of the app's own code; never edit or re-type it in an app.
   One global: K. It hooks p5's frame automatically (pre/post), so sketch.js only calls K.* functions.
   API reference: makeapp/Skeleton-Guide.md. Everything draws on the canvas 2D context inside save/restore, so p5's own
   fill/stroke state is never disturbed. Colours are '#rrggbb' strings or 'rgba(...)' strings from K.alpha(). */
const K = (function () {
  'use strict';
  const K = { version: '1.4' };
  const $ = () => (K._g ? K._g.drawingContext : window.drawingContext);   // the active 2D context
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  K.clamp = clamp;

  // ------------------------------------------------------------------ colour
  function parse(c) {
    if (Array.isArray(c)) return { r: c[0], g: c[1], b: c[2], a: c.length > 3 ? c[3] : 1 };
    c = String(c || '#000').trim();
    let m;
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    if ((m = c.match(/rgba?\(([^)]+)\)/))) {
      const p = m[1].split(',').map(s => parseFloat(s));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  const rgba = o => 'rgba(' + Math.round(o.r) + ',' + Math.round(o.g) + ',' + Math.round(o.b) + ',' + (+o.a.toFixed(3)) + ')';
  /** K.alpha(color, a) -> 'rgba(...)' with that opacity (the ONLY safe way to add alpha to a hex colour). */
  K.alpha = (c, a) => { const o = parse(c); o.a = clamp(a, 0, 1) * o.a; return rgba(o); };
  /** K.mix(c1, c2, t) -> colour between c1 (t=0) and c2 (t=1). */
  K.mix = (a, b, t) => { const x = parse(a), y = parse(b); t = clamp(t, 0, 1); return rgba({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: x.a + (y.a - x.a) * t }); };
  K.lighten = (c, t) => K.mix(c, '#ffffff', t);
  K.darken = (c, t) => K.mix(c, '#000000', t);
  K.hsl = (h, s, l, a) => { h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    const f = n => { const k = (n + h * 12) % 12, q = s * Math.min(l, 1 - l); return l - q * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return rgba({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: a == null ? 1 : a }); };
  K.luma = c => { const o = parse(c); return (0.2126 * o.r + 0.7152 * o.g + 0.0722 * o.b) / 255; };
  // readable text on a fill; a mostly transparent fill shows the page behind it, so the theme's text colour wins (v1.1)
  K.onColor = c => { const o = parse(c); if (o.a < 0.5) return K.C.text; return K.luma(c) > 0.6 ? '#0b0d12' : '#ffffff'; };

  // ------------------------------------------------------------------ tokens
  K.FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  K.ROUNDED = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  K.MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace';
  K.S = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, xxxl: 48 };          // spacing
  K.R = { s: 8, m: 12, l: 18, xl: 26, pill: 999 };                                   // corner radii
  // type roles: [size px, weight, family, letterSpacing px, lineHeight factor]
  K.TYPE = {
    hero: [64, 800, 'FONT', -1.5, 1.0], display: [48, 800, 'FONT', -1, 1.05], largeTitle: [34, 800, 'FONT', -0.6, 1.12],
    title: [28, 700, 'FONT', -0.4, 1.15], title2: [22, 700, 'FONT', -0.3, 1.2], title3: [20, 600, 'FONT', -0.2, 1.22],
    headline: [17, 600, 'FONT', -0.2, 1.3], body: [17, 400, 'FONT', -0.2, 1.35], callout: [16, 400, 'FONT', -0.15, 1.35],
    subhead: [15, 400, 'FONT', -0.1, 1.33], footnote: [13, 400, 'FONT', 0, 1.35], caption: [12, 500, 'FONT', 0.1, 1.3],
    label: [11, 700, 'FONT', 0.9, 1.2], button: [17, 600, 'FONT', -0.2, 1.2], num: [17, 600, 'MONO', 0, 1.2],
    score: [40, 800, 'ROUNDED', -0.5, 1.0], game: [22, 800, 'ROUNDED', 0, 1.1]
  };
  const THEMES = {
    dark: { bg: '#0b0d12', bg2: '#121620', surface: '#171b26', surface2: '#1f2533', surface3: '#283043', line: 'rgba(255,255,255,0.08)',
            text: '#f3f5f9', text2: 'rgba(243,245,249,0.64)', text3: 'rgba(243,245,249,0.38)', accent: '#5b8cff', good: '#34c759', warn: '#ff9f0a', bad: '#ff453a', shadow: 'rgba(0,0,0,0.45)' },
    light: { bg: '#f2f3f7', bg2: '#e8eaf0', surface: '#ffffff', surface2: '#f6f7fa', surface3: '#eceef3', line: 'rgba(10,12,20,0.08)',
             text: '#0b0d12', text2: 'rgba(11,13,18,0.62)', text3: 'rgba(11,13,18,0.36)', accent: '#2f6bff', good: '#1faa4a', warn: '#e8850a', bad: '#e5372c', shadow: 'rgba(20,24,40,0.16)' }
  };
  K.C = Object.assign({}, THEMES.dark);
  /** K.theme({mode:'dark'|'light', accent, bg, surface, good, warn, bad}) -> sets K.C (the palette every component reads). */
  K.theme = (o) => {
    o = o || {}; const base = THEMES[o.mode === 'light' ? 'light' : 'dark'];
    K.C = Object.assign({}, base, o); delete K.C.mode; K.mode = o.mode === 'light' ? 'light' : 'dark';
    for (const k of ['density', 'canvas']) delete K.C[k];
    if (o.bg && !o.bg2) K.C.bg2 = K.mix(o.bg, K.mode === 'dark' ? '#ffffff' : '#000000', 0.04);
    if (o.bg && !o.surface) { K.C.surface = K.mix(o.bg, K.mode === 'dark' ? '#ffffff' : '#ffffff', K.mode === 'dark' ? 0.06 : 1); K.C.surface2 = K.mix(o.bg, '#ffffff', K.mode === 'dark' ? 0.1 : 0.7); K.C.surface3 = K.mix(o.bg, '#ffffff', K.mode === 'dark' ? 0.15 : 0.5); }
    // v1.1: a given surface derives its own surface2/surface3 (a tinted theme no longer mixes in the neutral base greys)
    if (o.surface && !o.surface2) K.C.surface2 = K.mix(o.surface, K.mode === 'dark' ? '#ffffff' : '#000000', K.mode === 'dark' ? 0.05 : 0.03);
    if (o.surface && !o.surface3) K.C.surface3 = K.mix(o.surface, K.mode === 'dark' ? '#ffffff' : '#000000', K.mode === 'dark' ? 0.1 : 0.07);
    K.C.accentText = K.onColor(K.C.accent);
    return K.C;
  };
  /** K.setAccent(color) - change only the accent (phase colours, brand colours) without resetting the palette. */
  K.setAccent = (c) => { K.C.accent = c; K.C.accentText = K.onColor(c); return c; };
  // bar/chrome colour that follows the theme (tab bar, nav bar, segmented track) instead of a fixed grey
  const chrome = (a) => K.alpha(K.mix(K.C.bg, K.C.surface, 0.55), a == null ? 0.94 : a);
  K.theme({ mode: 'dark' });

  // ------------------------------------------------------------------ frame + time
  K.t = 0; K.dt = 1 / 60; K.ms = 16; K.frame = 0; K.W = 390; K.H = 844; K.safe = { top: 0, bottom: 0, left: 0, right: 0 };
  K.timeScale = 1; let hitstopUntil = 0;

  // ------------------------------------------------------------------ easing
  const E = {
    linear: t => t, inQuad: t => t * t, outQuad: t => 1 - (1 - t) * (1 - t), inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    inCubic: t => t * t * t, outCubic: t => 1 - Math.pow(1 - t, 3), inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outQuart: t => 1 - Math.pow(1 - t, 4), outQuint: t => 1 - Math.pow(1 - t, 5), inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    outExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)), inOutExpo: t => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    inBack: t => { const c1 = 1.70158; return (c1 + 1) * t * t * t - c1 * t * t; },
    inOutBack: t => { const c2 = 1.70158 * 1.525; return t < 0.5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2; },
    outElastic: t => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
    outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; }
  };
  K.ease = E;

  // ------------------------------------------------------------------ tweens, springs, keyed motion
  const tweens = [];
  /** K.tween(obj, {prop: to, ...}, ms, {ease, delay, onDone, loop, yoyo}) -> handle {stop()}. Animates numbers on obj. */
  K.tween = (obj, to, ms, o) => {
    o = o || {}; const tw = { obj, to, from: null, ms: Math.max(1, ms || 300), t: -(o.delay || 0), ease: E[o.ease] || o.ease || E.outCubic, o, dead: false, scene: null };   // v1.2: {scene:true} binds to the screen showing when it first steps (tween, then K.go = the NEW screen)
    tw.stop = () => { tw.dead = true; }; tweens.push(tw); return tw;
  };
  function stepTweens(ms) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; if (tw.dead) { tweens.splice(i, 1); continue; }
      if (tw.o.scene) { if (tw.scene == null) tw.scene = K.sceneName; else if (K.sceneName !== tw.scene) { tweens.splice(i, 1); continue; } }   // v1.1: {scene:true} tweens die when you leave the screen (no stale onDone)
      tw.t += ms; if (tw.t < 0) continue;
      if (!tw.from) { tw.from = {}; for (const k in tw.to) tw.from[k] = +tw.obj[k] || 0; }
      let p = clamp(tw.t / tw.ms, 0, 1); const e = tw.ease(p);
      for (const k in tw.to) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (p >= 1) {
        if (tw.o.yoyo) { const f = tw.from; tw.from = Object.assign({}, tw.to); tw.to = f; tw.t = 0; if (!tw.o.loop) tw.o.yoyo = false; continue; }
        if (tw.o.loop) { tw.t = 0; for (const k in tw.to) tw.obj[k] = tw.from[k]; continue; }
        tweens.splice(i, 1); if (tw.o.onDone) try { tw.o.onDone(); } catch (e2) { console.error(e2); }
      }
    }
  }
  /** K.spring(value, {k: stiffness, d: damping}) -> {v, target, vel, to(x), set(x)}; updated automatically every frame. */
  const springs = [];
  K.spring = (v, o) => { o = o || {}; const s = { v: v || 0, target: v || 0, vel: 0, k: o.k || 170, d: o.d || 22, to(x) { s.target = x; return s; }, set(x) { s.v = s.target = x; s.vel = 0; return s; }, kick(v2) { s.vel += v2; return s; } }; springs.push(s); return s; };
  function stepSprings(dt) { for (const s of springs) { const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; for (let i = 0; i < n; i++) { const a = -s.k * (s.v - s.target) - s.d * s.vel; s.vel += a * h; s.v += s.vel * h; } } }
  /** K.approach(cur, target, speed) -> frame-rate independent exponential smoothing (speed ~ 6 slow .. 30 snappy). */
  K.approach = (cur, target, speed, dt) => cur + (target - cur) * (1 - Math.exp(-(speed || 12) * (dt == null ? K.dt : dt)));   // pass K.gdt for gameplay time
  const anims = new Map();
  /** K.anim(key, target, speed, dt) -> a smoothed number remembered under key (immediate-mode motion: press states, highlights).
      v1.1: steps ONCE per frame per key, however many times it is called (was: once per call). */
  K.anim = (key, target, speed, dt) => {
    const a = anims.get(key);
    if (a && a.f === K.frame) { a.target = target; return a.v; }
    const cur = a ? a.v : target; const nv = K.approach(cur, target, speed || 14, dt); anims.set(key, { v: nv, f: K.frame, target }); return nv;
  };
  const springKeys = new Map();
  /** K.springTo(key, target, {k, d}) -> a spring-animated number remembered under key (overshoot allowed). */
  K.springTo = (key, target, o) => { let s = springKeys.get(key); if (!s) { s = K.spring(target, o); springKeys.set(key, s); } s.to(target); return s.v; };
  /** K.springKick(key, vel) - kick a K.springTo value for a pop (tap: K.springKick('like', 6); draw: scale(K.springTo('like', 1))). v1.2 */
  K.springKick = (key, vel, o) => { let s = springKeys.get(key); if (!s) { s = K.spring(1, o); springKeys.set(key, s); } s.kick(vel); return s.v; };
  const counts = new Map();
  /** K.count(key, value, ms) -> the displayed number rolls to a new value over ms (scores, prices, timers). */
  K.count = (key, value, ms, o) => {
    let c = counts.get(key); if (!c || (o && o.snap)) { c = { from: value, to: value, t0: K.t, ms: ms || 600 }; counts.set(key, c); }
    if (value !== c.to) { const cur = c.from + (c.to - c.from) * E.outCubic(clamp((K.t - c.t0) * 1000 / c.ms, 0, 1)); c.from = cur; c.to = value; c.t0 = K.t; c.ms = ms || 600; }
    return c.from + (c.to - c.from) * E.outCubic(clamp((K.t - c.t0) * 1000 / c.ms, 0, 1));
  };
  /** K.countReset(key, from) - the next K.count(key, v) starts AT v (a new run's score starts at 0 instead of rolling down); with from it rolls up from that number instead (a results card counting up from 0). */
  K.countReset = (key, from) => { if (key == null) counts.clear(); else if (from != null) counts.set(key, { from, to: from, t0: K.t, ms: 600 }); else counts.delete(key); };
  const sceneT0 = {};   // v1.1: each scene remembers when IT opened, so an outgoing screen never replays its entrance mid-transition
  const t0Of = () => (sceneT0[K.sceneName] != null ? sceneT0[K.sceneName] : K._sceneT0);
  /** K.stagger(i, stepMs, durMs, ease) -> 0..1 entrance progress for item i since the scene (being drawn) opened (lists, cards, menus). */
  K.stagger = (i, stepMs, durMs, ease) => { const el = (K.t - t0Of()) * 1000 - i * (stepMs || 40); return (E[ease] || E.outCubic)(clamp(el / (durMs || 420), 0, 1)); };
  /** K.since(t0, delayMs, durMs, ease) -> 0..1 progress of an entrance that started at K.t = t0 (a result card, a banner, the next question). */
  K.since = (t0, delayMs, durMs, ease) => { const el = (K.t - (t0 || 0)) * 1000 - (delayMs || 0); return (E[ease] || E.outCubic)(clamp(el / (durMs || 420), 0, 1)); };
  /** K.entrance(delayMs, durMs, ease) -> 0..1 progress since the screen being drawn opened, after a plain delay (v1.2; K.stagger(i, 0) still means 40 ms steps). */
  K.entrance = (delayMs, durMs, ease) => K.since(t0Of(), delayMs, durMs, ease);
  K.wave = (speed, phase) => Math.sin(K.t * (speed || 2) + (phase || 0));   // -1..1, for idle bobbing
  K.pulse = (speed) => 0.5 + 0.5 * Math.sin(K.t * (speed || 3));           // 0..1

  // ------------------------------------------------------------------ drawing primitives (all on the 2D context, state-safe)
  let p5r = null; const p5sync = (c) => { try { const r = p5r || (p5r = (window.p5 && p5.instance && p5.instance._renderer) || window._renderer || null); if (r && r.drawingContext === c) { r._cachedFillStyle = r._cachedStrokeStyle = undefined; } else p5r = null; } catch (e) { /* ignore */ } };   // v1.2: after a restore p5's cached fill/stroke match the canvas again (as p5's own pop() does), so a repeated fill() is never skipped
  const with2d = (fn) => { const c = $(); if (!c) return; c.save(); try { return fn(c); } finally { c.restore(); p5sync(c); } };
  K.with = with2d;
  function rrPath(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r); c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
  }
  K.pathRR = rrPath;
  const ELEV = [null, [0, 1, 3, 0.18], [0, 4, 12, 0.22], [0, 10, 28, 0.28], [0, 18, 48, 0.34]];
  function shadow(c, lvl, color) { const e = ELEV[lvl | 0]; if (!e) return; c.shadowOffsetX = e[0]; c.shadowOffsetY = e[1]; c.shadowBlur = e[2]; c.shadowColor = color || K.alpha(K.mode === 'dark' ? '#000000' : '#141828', e[3] * (K.mode === 'dark' ? 1.6 : 0.8)); }
  /** K.rect(x, y, w, h, {fill, r, stroke, sw, elev, grad:[top,bottom], alpha}) - a rounded rectangle with optional gradient, border and soft shadow. */
  K.rect = (x, y, w, h, o) => with2d(c => {
    o = o || {}; if (o.alpha != null) c.globalAlpha *= o.alpha;
    rrPath(c, x, y, w, h, o.r == null ? K.R.m : o.r);
    if (o.grad) { const g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, o.grad[0]); g.addColorStop(1, o.grad[1]); c.fillStyle = g; } else c.fillStyle = o.fill || K.C.surface;
    if (o.elev) shadow(c, o.elev, o.shadow);
    if (o.fill !== 'none') c.fill();
    if (o.stroke) { c.shadowColor = 'transparent'; c.lineWidth = o.sw || 1; c.strokeStyle = o.stroke; c.stroke(); }
  });
  /** K.circle(x, y, r, {fill, stroke, sw, elev, alpha}) */
  K.circle = (x, y, r, o) => with2d(c => {
    o = o || {}; if (o.alpha != null) c.globalAlpha *= o.alpha; c.beginPath(); c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
    if (o.elev) shadow(c, o.elev, o.shadow);
    if (o.fill !== 'none') { c.fillStyle = o.fill || K.C.accent; c.fill(); }
    if (o.stroke) { c.shadowColor = 'transparent'; c.lineWidth = o.sw || 2; c.strokeStyle = o.stroke; c.stroke(); }
  });
  /** K.line(x1, y1, x2, y2, color, width, {cap, alpha, dash}) */
  K.line = (x1, y1, x2, y2, col, w, o) => with2d(c => { o = o || {}; if (o.alpha != null) c.globalAlpha *= o.alpha; if (o.dash) c.setLineDash(o.dash); c.lineCap = o.cap || 'round'; c.strokeStyle = col || K.C.line; c.lineWidth = w || 1; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); });
  /** K.glow(x, y, r, color, strength 0..1) - a soft radial light (behind titles, pickups, the player, active buttons). */
  K.glow = (x, y, r, col, s) => with2d(c => { const g = c.createRadialGradient(x, y, 0, x, y, Math.max(1, r)); g.addColorStop(0, K.alpha(col || K.C.accent, s == null ? 0.5 : s)); g.addColorStop(1, K.alpha(col || K.C.accent, 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); });
  /** K.gradRect(x, y, w, h, [c0, c1, ...], vertical=true) - a linear gradient fill. */
  K.gradRect = (x, y, w, h, cols, vertical) => with2d(c => { const g = vertical === false ? c.createLinearGradient(x, y, x + w, y) : c.createLinearGradient(x, y, x, y + h); cols.forEach((col, i) => g.addColorStop(i / Math.max(1, cols.length - 1), col)); c.fillStyle = g; c.fillRect(x, y, w, h); });
  let grainTile = null;
  function grain() {
    if (grainTile !== null) return grainTile;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 96; const g = cv.getContext('2d'); const im = g.createImageData(96, 96);
      for (let i = 0; i < im.data.length; i += 4) { const v = (Math.random() * 255) | 0; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
      g.putImageData(im, 0, 0); grainTile = cv;
    } catch (e) { grainTile = false; }
    return grainTile;
  }
  /** K.backdrop({top, bottom, glow:[{x,y,r,color,s}], vignette 0..1, grain 0..1}) - a full-screen background with depth. Call first in a scene. */
  K.backdrop = (o) => with2d(c => {
    o = o || {}; const W = K.W, H = K.H;
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, o.top || K.C.bg2); g.addColorStop(1, o.bottom || K.C.bg); c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (const gl of (o.glow || [])) { const r = gl.r || W; const rg = c.createRadialGradient(gl.x, gl.y, 0, gl.x, gl.y, r); rg.addColorStop(0, K.alpha(gl.color || K.C.accent, gl.s == null ? 0.25 : gl.s)); rg.addColorStop(1, K.alpha(gl.color || K.C.accent, 0)); c.fillStyle = rg; c.fillRect(0, 0, W, H); }
    const v = o.vignette == null ? 0.35 : o.vignette;
    const vc = o.vignetteColor || (K.mode === 'light' ? K.darken(K.C.bg2, 0.35) : '#000000');   // v1.1: light themes get a tinted, soft vignette
    if (v > 0) { const vg = c.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8); vg.addColorStop(0, K.alpha(vc, 0)); vg.addColorStop(1, K.alpha(vc, v)); c.fillStyle = vg; c.fillRect(0, 0, W, H); }
    const gr = o.grain == null ? 0.05 : o.grain, t = gr > 0 ? grain() : null;
    if (t) { c.globalAlpha = gr; c.globalCompositeOperation = 'overlay'; const p = c.createPattern(t, 'repeat'); if (p) { c.fillStyle = p; c.fillRect(0, 0, W, H); } }
  });

  // ------------------------------------------------------------------ type
  function fontOf(role, o) {
    const t = K.TYPE[role] || K.TYPE.body; o = o || {};
    const size = o.size || t[0], weight = o.weight || t[1], fam = K[o.family || t[2]] || o.family || K.FONT;
    return { css: (o.italic ? 'italic ' : '') + weight + ' ' + size + 'px ' + fam, size, ls: o.ls == null ? t[3] : o.ls, lh: (o.lh || t[4]) * size };
  }
  /** K.text(str, x, y, role, color, {align:'left'|'center'|'right', base:'alphabetic'|'middle'|'top', size, weight, ls, alpha, shadow, maxW}) -> width drawn. */
  K.text = (str, x, y, role, col, o) => {
    o = o || {}; let w = 0; str = String(str == null ? '' : str);
    with2d(c => {
      const f = fontOf(role, o); c.font = f.css; c.textAlign = o.align || 'left'; c.textBaseline = o.base || 'alphabetic';
      if ('letterSpacing' in c) c.letterSpacing = f.ls + 'px';
      if (o.alpha != null) c.globalAlpha *= o.alpha;
      if (o.shadow) { c.shadowColor = o.shadow === true ? 'rgba(0,0,0,0.45)' : o.shadow; c.shadowBlur = o.shadowBlur || 12; c.shadowOffsetY = o.shadowY == null ? 2 : o.shadowY; }
      c.fillStyle = col || K.C.text;
      if (o.maxW) { while (str.length > 1 && c.measureText(str).width > o.maxW) str = str.slice(0, -2) + '…'; }
      if (o.stroke) { c.lineJoin = 'round'; c.lineWidth = o.stroke; c.strokeStyle = o.strokeColor || 'rgba(0,0,0,0.6)'; c.strokeText(str, x, y); }
      c.fillText(str, x, y); w = c.measureText(str).width;
    });
    return w;
  };
  /** K.measure(str, role, {size, weight}) -> width in px. */
  K.measure = (str, role, o) => { let w = 0; with2d(c => { const f = fontOf(role, o); c.font = f.css; if ('letterSpacing' in c) c.letterSpacing = f.ls + 'px'; w = c.measureText(String(str)).width; }); return w; };
  /** K.wrap(str, maxW, role, o) -> array of lines that fit maxW. */
  K.wrap = (str, maxW, role, o) => {
    const words = String(str).split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (K.measure(t, role, o) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  };
  /** K.para(str, x, y, w, role, color, {align, maxLines, alpha}) -> height used. Wrapped paragraph. */
  K.para = (str, x, y, w, role, col, o) => {
    o = o || {}; const f = fontOf(role, o); let lines = K.wrap(str, w, role, o);
    if (o.maxLines && lines.length > o.maxLines) { lines = lines.slice(0, o.maxLines); lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S*$/, '…'); }
    const ax = o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w : x;
    lines.forEach((l, i) => K.text(l, ax, y + f.size + i * f.lh, role, col, o));
    return lines.length * f.lh;
  };
  /** K.paraHeight(str, w, role, {maxLines}) -> the height K.para will use, measured before drawing (size a card first). v1.2 */
  K.paraHeight = (str, w, role, o) => { o = o || {}; const f = fontOf(role, o); let n = K.wrap(str, w, role, o).length; if (o.maxLines) n = Math.min(n, o.maxLines); return n * f.lh; };
  /** K.num(str, x, y, role, color, {align}) - numbers in fixed-width digit cells so counters never jitter. */
  K.num = (str, x, y, role, col, o) => {
    o = o || {}; str = String(str); let total = 0;
    with2d(c => {
      const f = fontOf(role, o); c.font = f.css; if ('letterSpacing' in c) c.letterSpacing = '0px'; const dw = c.measureText('0').width;
      const cw = ch => (/[0-9]/.test(ch) ? dw : c.measureText(ch).width + (f.ls || 0));
      for (const ch of str) total += cw(ch);
      let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
      c.fillStyle = col || K.C.text; c.textBaseline = o.base || 'alphabetic'; c.textAlign = 'center';
      if (o.alpha != null) c.globalAlpha *= o.alpha;
      if (o.shadow) { c.shadowColor = o.shadow === true ? 'rgba(0,0,0,0.45)' : o.shadow; c.shadowBlur = 14; c.shadowOffsetY = 2; }
      for (const ch of str) { const w = cw(ch); c.fillText(ch, cx + w / 2, y); cx += w; }
    });
    return total;
  };
  /** K.measureNum(str, role, o) -> the width K.num will draw (fixed digit cells). */
  K.measureNum = (str, role, o) => { let total = 0; with2d(c => { const f = fontOf(role, o); c.font = f.css; if ('letterSpacing' in c) c.letterSpacing = '0px'; const dw = c.measureText('0').width; for (const ch of String(str)) total += /[0-9]/.test(ch) ? dw : c.measureText(ch).width + (f.ls || 0); }); return total; };
  K.fmt = {
    num: (n, d) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }),
    money: (n, cur, d) => (n < 0 ? '-' : '') + (cur || '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }),
    pct: (n, d) => (n > 0 ? '+' : '') + Number(n || 0).toFixed(d == null ? 2 : d) + '%',
    compact: n => { n = Number(n) || 0; const U = ['', 'K', 'M', 'B', 'T']; let i = 0, q = Math.round(n); if (Math.abs(q) < 1000) return String(q); q = n; while (Math.abs(q) >= 1000 && i < 4) { q /= 1000; i++; } let s = Math.abs(q) >= 100 ? q.toFixed(0) : q.toFixed(1); if (Math.abs(parseFloat(s)) >= 1000 && i < 4) { q /= 1000; i++; s = q.toFixed(1); } return s.replace(/\.0$/, '') + U[i]; },   // v1.2: 999980 -> 1M, 10000 -> 10K, trillions
    clock: (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60), h = Math.floor(m / 60); const p = x => String(x).padStart(2, '0'); return h ? h + ':' + p(m % 60) + ':' + p(s % 60) : p(m) + ':' + p(s % 60); },
    time: (d) => { d = d instanceof Date ? d : new Date(d == null ? Date.now() : d); const p = x => String(x).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); },   // wall clock: pass Date.now(), never millis()
    time12: (d) => { d = d instanceof Date ? d : new Date(d == null ? Date.now() : d); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap; },
    ago: (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 45 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; },
    date: (d, o) => new Date(d).toLocaleDateString('en-US', o || { weekday: 'short', month: 'short', day: 'numeric' })
  };

  // ------------------------------------------------------------------ icons (24-unit line icons, drawn as paths)
  // commands: M x y | L x y | C x1 y1 x2 y2 x y | Q x1 y1 x y | Z | O cx cy r (circle) | R x y w h r (rounded rect) | F (fill the next shapes) | S (back to stroke)
  const I = {
    plus: 'M12 5 L12 19 M5 12 L19 12', minus: 'M5 12 L19 12', close: 'M6 6 L18 18 M18 6 L6 18', check: 'M5 12.5 L10 17.5 L19 7',
    chevronRight: 'M9 5 L16 12 L9 19', chevronLeft: 'M15 5 L8 12 L15 19', chevronUp: 'M5 15 L12 8 L19 15', chevronDown: 'M5 9 L12 16 L19 9',
    back: 'M19 12 L5 12 M11 6 L5 12 L11 18', arrowRight: 'M5 12 L19 12 M13 6 L19 12 L13 18', arrowUp: 'M12 19 L12 5 M6 11 L12 5 L18 11', arrowDown: 'M12 5 L12 19 M6 13 L12 19 L18 13',
    menu: 'M4 7 L20 7 M4 12 L20 12 M4 17 L20 17', more: 'F O 5.5 12 1.7 O 12 12 1.7 O 18.5 12 1.7', search: 'O 11 11 6.5 M16 16 L20.5 20.5',
    heart: 'M12 20 C12 20 3 14.5 3 8.8 C3 6 5.2 4 7.8 4 C9.6 4 11.1 5 12 6.4 C12.9 5 14.4 4 16.2 4 C18.8 4 21 6 21 8.8 C21 14.5 12 20 12 20 Z',
    play: 'F M8 5 L19 12 L8 19 Z', pause: 'F R 6.5 5 4 14 1.2 R 13.5 5 4 14 1.2', stop: 'F R 6 6 12 12 2.5',
    undo: 'M9 14 L4 9 L9 4 M4 9 L15 9 C18 9 20.5 11.5 20.5 14.5 C20.5 17.5 18 20 15 20 L11 20', redo: 'M15 14 L20 9 L15 4 M20 9 L9 9 C6 9 3.5 11.5 3.5 14.5 C3.5 17.5 6 20 9 20 L13 20',
    backspace: 'M9 5 L20 5 C20.6 5 21 5.4 21 6 L21 18 C21 18.6 20.6 19 20 19 L9 19 L3 12 Z M11.5 9 L16.5 15 M16.5 9 L11.5 15',
    refresh: 'M19.5 12 C19.5 16.1 16.1 19.5 12 19.5 C7.9 19.5 4.5 16.1 4.5 12 C4.5 7.9 7.9 4.5 12 4.5 C14.6 4.5 16.9 5.8 18.2 7.8 M18.8 3.8 L18.6 8.2 L14.2 8',
    share: 'M12 3.5 L12 15 M8 7.5 L12 3.5 L16 7.5 M6 11 L5.5 11 L5.5 20.5 L18.5 20.5 L18.5 11 L18 11',
    trash: 'M4 7 L20 7 M9 7 L9 4.5 L15 4.5 L15 7 M6 7 L7 20 L17 20 L18 7 M10 11 L10 16 M14 11 L14 16', edit: 'M4 20 L8 19 L19 8 L16 5 L5 16 Z M14 7 L17 10',
    home: 'M4 11 L12 4 L20 11 M6 9.5 L6 20 L18 20 L18 9.5 M10 20 L10 14 L14 14 L14 20', chart: 'M5 20 L5 13 M10 20 L10 8 M15 20 L15 11 M20 20 L20 5',
    trend: 'M3.5 17 L9 11.5 L13 15 L20.5 7.5 M15 7.5 L20.5 7.5 L20.5 13', list: 'M9 7 L20 7 M9 12 L20 12 M9 17 L20 17 F O 5 7 1.3 O 5 12 1.3 O 5 17 1.3',
    grid: 'R 4 4 7 7 1.8 R 13 4 7 7 1.8 R 4 13 7 7 1.8 R 13 13 7 7 1.8', user: 'O 12 8 4 M4.5 20 C5.5 15.5 8.5 13.5 12 13.5 C15.5 13.5 18.5 15.5 19.5 20',
    bell: 'M6 16 L6 11 C6 7.5 8.7 5 12 5 C15.3 5 18 7.5 18 11 L18 16 L20 18 L4 18 Z M10 20.5 C10.6 21.4 11.2 21.8 12 21.8 C12.8 21.8 13.4 21.4 14 20.5',
    clock: 'O 12 12 8.5 M12 7 L12 12 L15.5 14', calendar: 'R 4 5.5 16 14.5 2.5 M4 10 L20 10 M8.5 3.5 L8.5 7.5 M15.5 3.5 L15.5 7.5',
    timer: 'O 12 13.5 7.5 M12 9.5 L12 13.5 L14.5 15.5 M10 3 L14 3 M12 3 L12 6',
    flame: 'M12 21 C8 21 5.5 18.5 5.5 15 C5.5 11 9 9 9.5 4.5 C12.5 6.5 13 9 12.5 11 C14 10.5 15 9.5 15.5 8 C17.5 10 18.5 12.5 18.5 15 C18.5 18.5 16 21 12 21 Z',
    bolt: 'F M13.5 3 L5.5 13.5 L11 13.5 L10 21 L18.5 10 L13 10 Z', drop: 'M12 3.5 C12 3.5 5.5 10.5 5.5 14.5 C5.5 18.1 8.4 21 12 21 C15.6 21 18.5 18.1 18.5 14.5 C18.5 10.5 12 3.5 12 3.5 Z',
    sun: 'O 12 12 4 M12 3 L12 5 M12 19 L12 21 M3 12 L5 12 M19 12 L21 12 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M5.6 18.4 L7 17 M17 7 L18.4 5.6',
    moon: 'M19.5 14.5 C18.5 18 15.4 20.5 11.8 20.5 C7.2 20.5 3.5 16.8 3.5 12.2 C3.5 8.6 5.9 5.5 9.3 4.5 C8.8 5.6 8.5 6.8 8.5 8.1 C8.5 12.6 12.2 16.3 16.7 16.3 C17.7 16.3 18.7 16.1 19.5 15.8 Z',
    cloud: 'M7.5 18.5 L17 18.5 C19.2 18.5 21 16.7 21 14.6 C21 12.5 19.3 10.9 17.3 10.8 C16.7 8 14.3 6 11.5 6 C8.4 6 5.9 8.4 5.7 11.4 C3.9 11.9 3 13.3 3 14.9 C3 16.9 4.9 18.5 7.5 18.5 Z',
    rain: 'M7.5 15 L17 15 C19.2 15 21 13.2 21 11.1 C21 9 19.3 7.4 17.3 7.3 C16.7 4.5 14.3 2.5 11.5 2.5 C8.4 2.5 5.9 4.9 5.7 7.9 C3.9 8.4 3 9.8 3 11.4 C3 13.4 4.9 15 7.5 15 Z M8 18 L7 21 M12 18 L11 21 M16 18 L15 21',
    lock: 'R 5 10.5 14 10 2.5 M8 10.5 L8 7.5 C8 5.3 9.8 3.5 12 3.5 C14.2 3.5 16 5.3 16 7.5 L16 10.5', info: 'O 12 12 8.5 M12 11 L12 16.5 F O 12 7.8 1.1',
    alert: 'M12 4 L21 19.5 L3 19.5 Z M12 10 L12 14 F O 12 16.7 1.05', trophy: 'M8 4 L16 4 L16 10 C16 12.2 14.2 14 12 14 C9.8 14 8 12.2 8 10 Z M8 6 L5 6 C5 9 6.5 10.5 8 10.5 M16 6 L19 6 C19 9 17.5 10.5 16 10.5 M12 14 L12 18 M8.5 20 L15.5 20',
    coin: 'O 12 12 8.5 O 12 12 5.5', star: 'M12 3.5 L14.6 9 L20.5 9.6 L16 13.6 L17.3 19.5 L12 16.5 L6.7 19.5 L8 13.6 L3.5 9.6 L9.4 9 Z',
    sound: 'M4 9.5 L8 9.5 L12.5 5.5 L12.5 18.5 L8 14.5 L4 14.5 Z M16 9 C17 10 17 14 16 15 M18.5 6.5 C21 9 21 15 18.5 17.5', mute: 'M4 9.5 L8 9.5 L12.5 5.5 L12.5 18.5 L8 14.5 L4 14.5 Z M16 9.5 L21 14.5 M21 9.5 L16 14.5',
    camera: 'R 3.5 7 17 12.5 2.5 M8.5 7 L10 4.5 L14 4.5 L15.5 7 O 12 13 3.5', pin: 'M12 21 C12 21 5.5 14.5 5.5 9.8 C5.5 6.2 8.4 3.5 12 3.5 C15.6 3.5 18.5 6.2 18.5 9.8 C18.5 14.5 12 21 12 21 Z O 12 10 2.5',
    bookmark: 'M6.5 4 L17.5 4 L17.5 20.5 L12 16.5 L6.5 20.5 Z', filter: 'M4 6 L20 6 M7 12 L17 12 M10 18 L14 18',
    sparkle: 'M12 3 C12.8 8 16 11.2 21 12 C16 12.8 12.8 16 12 21 C11.2 16 8 12.8 3 12 C8 11.2 11.2 8 12 3 Z', music: 'M9 17.5 L9 5.5 L19 3.5 L19 15.5 O 6.8 17.5 2.3 O 16.8 15.5 2.3',
    mic: 'R 9 3.5 6 11 3 M5.5 11.5 C5.5 15.1 8.4 18 12 18 C15.6 18 18.5 15.1 18.5 11.5 M12 18 L12 21', image: 'R 3.5 4.5 17 15 2.5 O 9 9.5 1.7 M3.5 17 L9 12 L13 15.5 L16 13 L20.5 17',
    globe: 'O 12 12 8.5 M3.5 12 L20.5 12 M12 3.5 C9 6.5 9 17.5 12 20.5 M12 3.5 C15 6.5 15 17.5 12 20.5', send: 'M4 12 L20 4.5 L15 20 L11.5 13.5 Z M11.5 13.5 L20 4.5',
    chat: 'M5 19 L5 7.5 C5 5.8 6.3 4.5 8 4.5 L17 4.5 C18.7 4.5 20 5.8 20 7.5 L20 13.5 C20 15.2 18.7 16.5 17 16.5 L8.5 16.5 Z', dice: 'R 4 4 16 16 3.5 F O 8.5 8.5 1.4 O 15.5 15.5 1.4 O 12 12 1.4',
    cart: 'M3.5 4.5 L6 4.5 L8.5 15.5 L18 15.5 L20 8 L7 8 O 9.5 19.5 1.4 O 17 19.5 1.4', target: 'O 12 12 8 O 12 12 3.5 M12 2.5 L12 6 M12 18 L12 21.5 M2.5 12 L6 12 M18 12 L21.5 12',
    leaf: 'M5 19 C5 11 10 5 19 5 C19 14 13 19 5 19 Z M5 19 L13 11', book: 'M4 5.5 C6.5 4.5 9.5 4.5 12 6 L12 20 C9.5 18.5 6.5 18.5 4 19.5 Z M20 5.5 C17.5 4.5 14.5 4.5 12 6 L12 20 C14.5 18.5 17.5 18.5 20 19.5 Z',
    paw: 'F O 7 10 1.8 O 10.4 6.6 1.8 O 13.6 6.6 1.8 O 17 10 1.8 M8 16.5 C8 13.8 9.8 12 12 12 C14.2 12 16 13.8 16 16.5 C16 18.2 14.8 19 13.5 19 C12.8 19 12.4 18.6 12 18.6 C11.6 18.6 11.2 19 10.5 19 C9.2 19 8 18.2 8 16.5 Z',
    dollar: 'M12 3.5 L12 20.5 M16 7.5 C15.2 6.3 13.7 5.7 12 5.7 C9.8 5.7 8.2 6.9 8.2 8.6 C8.2 12.6 16 10.7 16 15.1 C16 16.9 14.3 18.3 12 18.3 C10 18.3 8.4 17.5 7.6 16.2',
    eye: 'M2.5 12 C4.8 7.8 8.2 5.5 12 5.5 C15.8 5.5 19.2 7.8 21.5 12 C19.2 16.2 15.8 18.5 12 18.5 C8.2 18.5 4.8 16.2 2.5 12 Z O 12 12 3',
    settings: 'O 12 12 3.2 M12 3 L12 5.5 M12 18.5 L12 21 M3 12 L5.5 12 M18.5 12 L21 12 M5.6 5.6 L7.4 7.4 M16.6 16.6 L18.4 18.4 M5.6 18.4 L7.4 16.6 M16.6 7.4 L18.4 5.6 O 12 12 6.5',
    shield: 'M12 3.5 L19 6 L19 11.5 C19 16 16 19.3 12 20.5 C8 19.3 5 16 5 11.5 L5 6 Z', gift: 'R 4 9 16 11.5 2 M3.5 9 L20.5 9 M12 9 L12 20.5 M12 9 C10 5 6.5 5.5 7.5 7.5 C8 8.5 10 9 12 9 C14 9 16 8.5 16.5 7.5 C17.5 5.5 14 5 12 9',
    key: 'O 8 15 4 M11 12 L19.5 3.5 M16 7 L18.5 9.5 M14 9 L16 11', swords: 'M4 4 L13 13 M4 4 L4 7.5 M4 4 L7.5 4 M20 4 L11 13 M20 4 L20 7.5 M20 4 L16.5 4 M9 17 L5 21 M15 17 L19 21 M7.5 14.5 L9.5 16.5 M16.5 14.5 L14.5 16.5',
    ghost: 'M5.5 20 L5.5 10.5 C5.5 6.9 8.4 4 12 4 C15.6 4 18.5 6.9 18.5 10.5 L18.5 20 L16.3 18.2 L14.2 20 L12 18.2 L9.8 20 L7.7 18.2 Z F O 9.7 10.5 1.2 O 14.3 10.5 1.2',
    skipBack: 'M6 6 L6 18 F M19 6 L9 12 L19 18 Z', skipForward: 'M18 6 L18 18 F M5 6 L15 12 L5 18 Z',
    shuffle: 'M4 7 L7 7 C11 7 13 17 17 17 L20 17 M17 14 L20 17 L17 20 M4 17 L7 17 C9 17 10.5 14.5 11.5 12.5 M13.5 9.5 C14.5 8 15.5 7 17 7 L20 7 M17 4 L20 7 L17 10',
    repeat: 'M4 11 L4 9 C4 7.3 5.3 6 7 6 L19 6 M16 3 L19 6 L16 9 M20 13 L20 15 C20 16.7 18.7 18 17 18 L5 18 M8 21 L5 18 L8 15',
    copy: 'R 8 8 12 12 2.5 M16 8 L16 6 C16 4.9 15.1 4 14 4 L6 4 C4.9 4 4 4.9 4 6 L4 14 C4 15.1 4.9 16 6 16 L8 16', download: 'M12 4 L12 15 M7 10 L12 15 L17 10 M5 20 L19 20',
    upload: 'M12 20 L12 9 M7 14 L12 9 L17 14 M5 4 L19 4', flag: 'M5 21 L5 4 M5 4 L18 4 L15 8.5 L18 13 L5 13', tag: 'M3.5 12.5 L3.5 4.5 C3.5 4 4 3.5 4.5 3.5 L12.5 3.5 L20.5 11.5 L11.5 20.5 Z O 8 8 1.5',
    checkCircle: 'O 12 12 8.5 M8 12.5 L11 15.5 L16.5 9.5', plusCircle: 'O 12 12 8.5 M12 8 L12 16 M8 12 L16 12', xCircle: 'O 12 12 8.5 M9 9 L15 15 M15 9 L9 15',
    thumbUp: 'M7 11 L7 20 L4 20 L4 11 Z M7 11 L11 4 C12.5 4 13.5 5 13.5 6.5 L13 10 L18.5 10 C19.6 10 20.4 11 20.2 12.1 L19 18.5 C18.8 19.4 18 20 17 20 L7 20',
    sliders: 'M4 8 L20 8 M4 16 L20 16 F O 9 8 2.2 O 15 16 2.2', arrowLeft: 'M19 12 L5 12 M11 6 L5 12 L11 18', compass: 'O 12 12 8.5 F M15.5 8.5 L13.2 13.2 L8.5 15.5 L10.8 10.8 Z',
    skull: 'M6 15 C4.8 13.8 4 12 4 10 C4 6.1 7.6 3 12 3 C16.4 3 20 6.1 20 10 C20 12 19.2 13.8 18 15 L18 18.5 L6 18.5 Z M9 18.5 L9 21 M12 18.5 L12 21 M15 18.5 L15 21 F O 9 10.5 1.8 O 15 10.5 1.8'
  };
  K.ICONS = Object.keys(I);
  const iconCache = {};
  function iconOps(name) {
    if (iconCache[name]) return iconCache[name];
    const src = I[name] || I.info; const tk = src.match(/[MLCQZORFS]|-?\d*\.?\d+/g) || []; const ops = []; let i = 0;   // 'M12 5' and 'M 12 5' both parse
    const n = () => parseFloat(tk[i++]);
    while (i < tk.length) { const cmd = tk[i++]; if (cmd === 'M' || cmd === 'L') ops.push([cmd, n(), n()]); else if (cmd === 'C') ops.push(['C', n(), n(), n(), n(), n(), n()]); else if (cmd === 'Q') ops.push(['Q', n(), n(), n(), n()]); else if (cmd === 'O') ops.push(['O', n(), n(), n()]); else if (cmd === 'R') ops.push(['R', n(), n(), n(), n(), n()]); else ops.push([cmd]); }
    iconCache[name] = ops; return ops;
  }
  /** K.icon(name, cx, cy, size, color, {weight 1..3, alpha}) - a line icon centred on (cx, cy). Names: K.ICONS. */
  K.icon = (name, cx, cy, size, col, o) => with2d(c => {
    o = o || {}; const s = (size == null ? 24 : size) / 24; if (o.alpha != null) c.globalAlpha *= o.alpha;
    c.translate(cx - 12 * s, cy - 12 * s); c.scale(s, s);
    c.lineWidth = (o.weight || 2) ; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = c.fillStyle = col || K.C.text;
    let fill = !!o.fill; let open = false;   // v1.1: {fill:true} fills closed shapes (liked heart, rated star, saved bookmark)
    const flush = () => { if (open) { if (fill) c.fill(); else c.stroke(); open = false; } };
    for (const op of iconOps(name)) {
      const k = op[0];
      if (k === 'F') { flush(); fill = true; continue; } if (k === 'S') { flush(); fill = false; continue; }
      if (k === 'M') { if (!open) { c.beginPath(); open = true; } c.moveTo(op[1], op[2]); }
      else if (k === 'L') c.lineTo(op[1], op[2]); else if (k === 'C') c.bezierCurveTo(op[1], op[2], op[3], op[4], op[5], op[6]); else if (k === 'Q') c.quadraticCurveTo(op[1], op[2], op[3], op[4]);
      else if (k === 'Z') c.closePath();
      else if (k === 'O') { flush(); c.beginPath(); c.arc(op[1], op[2], op[3], 0, Math.PI * 2); if (fill) c.fill(); else c.stroke(); }
      else if (k === 'R') { flush(); rrPath(c, op[1], op[2], op[3], op[4], op[5]); if (fill) c.fill(); else c.stroke(); }
    }
    flush();
  });

  // ------------------------------------------------------------------ input: pointer events (never loses a sub-frame tap)
  const ptrs = new Map();       // id -> live pointer
  let downs = [], ups = [];     // events of THIS frame (moved in from the queues at frame start)
  let qDown = [], qUp = [];
  K.pointers = []; K.ptr = { x: -1, y: -1, down: false };
  K._uiRects = []; K._uiRectsPrev = [];
  // v1.1 MODAL CAPTURE: a sheet/modal that was visible last frame makes every control OUTSIDE it inert this frame (and hides them from
  // the controls map (for automated tests)). K.inert(fn) makes anything inert on purpose. Clip rects (K.clip) limit hit tests to what is visible.
  let modalNext = false, modalActive = false, modalDepth = 0; const clipStack = []; let sceneGen = 0;   // v1.2: K.go bumps sceneGen; a pointer remembers the screen it went down on
  const blocked = () => !!K._inert || (modalActive && modalDepth === 0);
  const inClip = (x, y) => { for (const r of clipStack) if (x < r[0] || x > r[0] + r[2] || y < r[1] || y > r[1] + r[3]) return false; return true; };
  /** K.inert(fn) or K.inert(on, fn) - draw fn with its controls inert (drawn, not tappable, not in the controls map). */
  K.inert = (a, b) => { const on = typeof a === 'function' ? true : !!a, fn = typeof a === 'function' ? a : b; const was = K._inert; if (on) K._inert = true; try { return fn && fn(); } finally { K._inert = was; } };
  /** K.modal(open, fn) - draw fn as a modal layer: while it is visible, controls drawn outside it are inert. Returns open. For custom overlays (pause card, results). */
  K.modal = (open, fn) => { if (!open) return open; modalNext = true; modalDepth++; try { fn && fn(); } finally { modalDepth--; } return open; };
  K.isBlocked = () => blocked();
  function toCanvas(e) { let r = null; try { const cv = (window.drawingContext && window.drawingContext.canvas) || document.querySelector('canvas'); r = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect() : null; } catch (x) { r = null; } return { x: e.clientX - (r ? r.left : 0), y: e.clientY - (r ? r.top : 0) }; }
  function onDown(e) {
    const p = toCanvas(e); const rec = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: performance.now(), dist: 0, claimed: null, long: false, type: e.pointerType, gen: sceneGen };
    ptrs.set(e.pointerId, rec); qDown.push(Object.assign({}, rec, { ref: rec })); audioUnlock();
  }
  function onMove(e) { const r = ptrs.get(e.pointerId); if (!r) return; const p = toCanvas(e); r.x = p.x; r.y = p.y; r.dist = Math.max(r.dist, Math.hypot(p.x - r.sx, p.y - r.sy)); }
  function onUp(e) { const r = ptrs.get(e.pointerId); if (!r) return; const p = toCanvas(e); r.x = p.x; r.y = p.y; r.dist = Math.max(r.dist, Math.hypot(p.x - r.sx, p.y - r.sy)); r.t1 = performance.now(); r.cancel = e.type === 'pointercancel'; ptrs.delete(e.pointerId); qUp.push(r); }
  function installInput() {
    if (K._inputOn) return; K._inputOn = true;
    const opt = { capture: true, passive: true };
    window.addEventListener('pointerdown', onDown, opt); window.addEventListener('pointermove', onMove, opt);
    window.addEventListener('pointerup', onUp, opt); window.addEventListener('pointercancel', onUp, opt);
    window.addEventListener('pointerup', audioUnlock, opt); window.addEventListener('touchend', audioUnlock, opt);   // v1.1: iOS activates audio on the END of a touch
    window.addEventListener('keydown', e => { K.keys[e.key] = true; K._keyDown.push(e.key); if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault(); }, { capture: true });
    window.addEventListener('keyup', e => { K.keys[e.key] = false; }, { capture: true });
  }
  K.keys = {}; K._keyDown = []; K.pressedKeys = [];
  let swipeVal = null;
  Object.defineProperty(K, 'swipe', { get: () => (blocked() ? null : swipeVal), set: (v) => { swipeVal = v; }, configurable: true, enumerable: true });
  function stepInput() {
    downs = qDown; ups = qUp; qDown = []; qUp = [];
    K.pressedKeys = K._keyDown; K._keyDown = [];
    K.pointers = Array.from(ptrs.values());
    const now = performance.now();
    for (const p of K.pointers) if (!p.long && !p.claimed && p.dist < 10 && now - p.t0 > 450) { p.long = true; p.longNow = true; } else p.longNow = false;
    const last = K.pointers[0] || ups[ups.length - 1];
    if (last) { K.ptr.x = last.x; K.ptr.y = last.y; }
    K.ptr.down = K.pointers.length > 0;
    K.ptr.pressed = downs.length > 0; K.ptr.released = ups.length > 0;
    K._uiRectsPrev = K._uiRects; K._uiRects = [];
    modalActive = modalNext; modalNext = false; modalDepth = 0; clipStack.length = 0;
    K.swipe = null; K.swipeFrom = null;
    for (const u of ups) {
      if (u.claimed || u.cancel) continue; const dx = u.x - u.sx, dy = u.y - u.sy, dt = (u.t1 - u.t0);
      if (dt < 1300 && Math.hypot(dx, dy) > 40) { if (Math.abs(dx) > Math.abs(dy) * 1.3) K.swipe = dx > 0 ? 'right' : 'left'; else if (Math.abs(dy) > Math.abs(dx) * 1.3) K.swipe = dy > 0 ? 'down' : 'up'; if (swipeVal) K.swipeFrom = { x: u.sx, y: u.sy }; }   // v1.1: 1.3 s / 40 px - slow thumbs and automated tests's ~1 s swipes count
    }
  }
  const inR = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  const inRs = (p, x, y, w, h) => p.sx >= x && p.sx <= x + w && p.sy >= y && p.sy <= y + h;
  K.inRect = (px, py, x, y, w, h) => px >= x && px <= x + w && py >= y && py <= y + h;
  /** K.tapIn(x, y, w, h) -> the tap (released inside, started inside, barely moved) this frame or null; consumes it. */
  K.tapIn = (x, y, w, h, keepIt) => { if (blocked()) return null; for (const u of ups) { if (!u.used && !u.claimed && !u.cancel && u.dist < 14 && u.gen === sceneGen && inRs(u, x, y, w, h) && inClip(u.sx, u.sy) && inR(u, x - 12, y - 12, w + 24, h + 24)) { if (!keepIt) u.used = true; return u; } } return null; };
  /** K.pressIn(x, y, w, h) -> a pointer that went down inside this frame (for instant actions like FIRE / jump). */
  K.pressIn = (x, y, w, h) => { if (blocked()) return null; for (const d of downs) if (!d.used && inR(d, x, y, w, h) && inClip(d.x, d.y)) { d.used = true; return d; } return null; };
  /** K.holdIn(x, y, w, h) -> the live pointer that started inside and is still down (held buttons, drag handles). */
  K.holdIn = (x, y, w, h) => { if (blocked()) return null; for (const p of K.pointers) if (!p.claimed && inRs(p, x, y, w, h) && inClip(p.sx, p.sy)) return p; return null; };
  /** K.freeTap() -> a tap this frame that did NOT land on any UI control (so game taps never fire through buttons). */
  K.freeTap = () => { if (blocked()) return null; for (const u of ups) { if (u.used || u.claimed || u.cancel || u.dist >= 14 || u.gen !== sceneGen) continue; if (K._uiRectsPrev.some(r => inR(u, r[0], r[1], r[2], r[3]))) continue; u.used = true; return u; } return null; };
  /** K.freePress() -> a pointer that went down this frame outside every UI control. */
  K.freePress = () => { if (blocked()) return null; for (const d of downs) { if (d.used) continue; if (K._uiRectsPrev.some(r => inR(d, r[0], r[1], r[2], r[3]))) continue; d.used = true; return d; } return null; };
  /** K.longPress(x, y, w, h) -> true on the frame a pointer has been held 450 ms inside without moving. */
  K.longPress = (x, y, w, h) => { if (blocked()) return false; for (const p of K.pointers) if (p.longNow && p.gen === sceneGen && inRs(p, x, y, w, h) && inClip(p.sx, p.sy)) { p.claimed = 'long'; return true; } return false; };   // v1.2: clip-aware
  function uiRect(x, y, w, h) { K._uiRects.push([x, y, w, h]); }
  K.uiRect = uiRect;
  /** K.claim(p, tag) - claim a finger (from K.holdIn or K.pointers) for a custom drag: taps, swipes, sliders, scroll and pager then leave it alone. v1.2 */
  K.claim = (p, tag) => { if (p) p.claimed = tag || 'app'; return p; };

  // ------------------------------------------------------------------ controls map for automated tests, written every frame
  function ctlReset() { window.__controls = { dpad: null, buttons: [], screen: K.sceneName || '' }; }
  function ctl(name, x, y, w, h) {   // v1.2: only the part inside every K.clip and the screen is offered to automated tests (rows scrolled under a bar drop out)
    if (blocked()) return; let x1 = Math.max(x, 0), y1 = Math.max(y, 0), x2 = Math.min(x + w, K.W), y2 = Math.min(y + h, K.H);
    for (const r of clipStack) { x1 = Math.max(x1, r[0]); y1 = Math.max(y1, r[1]); x2 = Math.min(x2, r[0] + r[2]); y2 = Math.min(y2, r[1] + r[3]); }
    if (x2 - x1 < 10 || y2 - y1 < 10) return;
    try { (window.__controls || (ctlReset(), window.__controls)).buttons.push({ name: String(name), x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1), screen: K.sceneName || '' }); } catch (e) { /* ignore */ }
  }
  K.registerControl = ctl;

  // ------------------------------------------------------------------ sound (synthesised; no asset files needed)
  let AC = null; K.sound = true; K.volume = 0.6;
  function audioUnlock() { try { if (!AC) { const A = window.AudioContext || window.webkitAudioContext; if (A) AC = new A(); } if (AC && AC.state === 'suspended' && AC.resume) { const pr = AC.resume(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) { AC = null; } }
  const SFX = {
    tap: [['sine', 880, 660, 0.05, 0.25]], tick: [['square', 1800, 1800, 0.015, 0.08]], pop: [['sine', 340, 920, 0.08, 0.35]],
    select: [['triangle', 660, 990, 0.07, 0.25]], toggle: [['sine', 520, 780, 0.06, 0.25]], back: [['sine', 700, 420, 0.07, 0.22]],
    success: [['triangle', 660, 660, 0.09, 0.3], ['triangle', 990, 990, 0.14, 0.3, 0.08]], error: [['sawtooth', 220, 150, 0.18, 0.18]],
    coin: [['square', 988, 988, 0.06, 0.14], ['square', 1319, 1319, 0.2, 0.14, 0.06]], jump: [['square', 300, 700, 0.14, 0.16]],
    shoot: [['square', 1200, 180, 0.09, 0.14], ['noise', 0, 0, 0.05, 0.12]], hit: [['noise', 0, 0, 0.08, 0.3], ['sine', 160, 60, 0.12, 0.35]],
    boom: [['noise', 0, 0, 0.45, 0.45], ['sine', 110, 30, 0.5, 0.5]], powerup: [['triangle', 400, 1200, 0.3, 0.25]], lose: [['triangle', 440, 110, 0.6, 0.3]],
    win: [['triangle', 523, 523, 0.12, 0.28], ['triangle', 659, 659, 0.12, 0.28, 0.1], ['triangle', 784, 784, 0.12, 0.28, 0.2], ['triangle', 1047, 1047, 0.3, 0.28, 0.3]],
    whoosh: [['noise', 0, 0, 0.22, 0.12]], click: [['square', 2400, 2400, 0.01, 0.1]]
  };
  /** K.audio() -> the kit's AudioContext (unlocked on the first touch) for apps with their own synth; K.markSound(name) tells automated tests a sound played. */
  K.audio = () => { audioUnlock(); return AC; };
  K.markSound = (name) => { try { (window.__p0Sounds = window.__p0Sounds || []).push('app:' + name); } catch (e) { /* ignore */ } };
  /** K.sfx(name, {vol, pitch}) - a synthesised UI/game sound: tap tick pop select toggle back success error coin jump shoot hit boom powerup lose win whoosh click. */
  K.sfx = (name, o) => {
    try { (window.__p0Sounds = window.__p0Sounds || []).push('kit:' + name); } catch (e) { /* ignore */ }
    if (!K.sound) return; audioUnlock(); if (!AC || !AC.createOscillator) return; o = o || {};
    try {
      const now = AC.currentTime; const pitch = o.pitch || 1;
      for (const v of (SFX[name] || SFX.tap)) {
        const [type, f0, f1, dur, vol, delay] = v; const t0 = now + (delay || 0); const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * K.volume * (o.vol == null ? 1 : o.vol)), t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(AC.destination);
        if (type === 'noise') {
          const n = Math.max(1, Math.floor(AC.sampleRate * dur)); const b = AC.createBuffer(1, n, AC.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
          const s = AC.createBufferSource(); s.buffer = b; s.connect(g); s.start(t0); s.stop(t0 + dur + 0.02);
        } else {
          const os = AC.createOscillator(); os.type = type; os.frequency.setValueAtTime(f0 * pitch, t0); os.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), t0 + dur); os.connect(g); os.start(t0); os.stop(t0 + dur + 0.02);
        }
      }
    } catch (e) { /* audio is never allowed to break the app */ }
  };

  // ------------------------------------------------------------------ juice: shake, flash, hitstop, particles, floaters, rings
  let shakeAmt = 0, shakeT = 0, flashCol = null, flashA = 0, flashMs = 1;
  /** K.shake(px, ms) - screen shake applied to K.camera() blocks. */
  K.shake = (px, ms) => { shakeAmt = Math.max(shakeAmt, px || 6); shakeT = Math.max(shakeT, (ms || 220) / 1000); };
  /** K.flash(color, ms) - a full-screen colour flash that fades out (hits, level up, photo taken). */
  K.flash = (col, ms) => { flashCol = col || '#ffffff'; flashA = 1; flashMs = ms || 180; };
  /** K.hitstop(ms) - freeze gameplay time briefly on a big hit (K.gdt becomes 0). */
  K.hitstop = (ms) => { hitstopUntil = Math.max(hitstopUntil, performance.now() + (ms || 60)); };
  /** K.camera(fn, {x, y, zoom}) - draw world content with the current shake (and optional pan/zoom) applied. */
  K.camera = (fn, o) => { o = o || {}; push(); const s = shakeT > 0 ? shakeAmt * (shakeT / 0.25) : 0; translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s); if (o.zoom) { translate(K.W / 2, K.H / 2); scale(o.zoom); translate(-K.W / 2, -K.H / 2); } if (o.x || o.y) translate(-(o.x || 0), -(o.y || 0)); try { fn(); } finally { pop(); } };
  const parts = [];
  /** K.burst(x, y, {n, colors:[...], speed, life ms, gravity, size, shape:'circle'|'square'|'spark'|'confetti'|'star', spread, angle, drag}) */
  K.burst = (x, y, o) => {
    o = o || {}; const n = o.n || 16; const cols = o.colors || [o.color || K.C.accent];
    for (let i = 0; i < n; i++) {
      const a = (o.angle == null ? Math.random() * Math.PI * 2 : o.angle + (Math.random() - 0.5) * (o.spread == null ? 1.2 : o.spread));
      const sp = (o.speed || 240) * (0.35 + Math.random() * 0.75);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life || 700) * (0.6 + Math.random() * 0.6), t: 0, g: o.gravity == null ? 520 : o.gravity,
        size: (o.size || 5) * (0.6 + Math.random() * 0.8), col: cols[(Math.random() * cols.length) | 0], shape: o.shape || 'circle', rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12, drag: o.drag == null ? 1.6 : o.drag });
    }
  };
  const floaters = [];
  /** K.floater(text, x, y, {color, role, rise px, ms}) - floating '+10' style text. */
  K.floater = (txt, x, y, o) => { o = o || {}; floaters.push({ txt: String(txt), x, y, t: 0, ms: o.ms || 900, rise: o.rise || 46, col: o.color || K.C.text, role: o.role || 'game', stroke: o.stroke === undefined ? (K.mode === 'light' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)') : o.stroke }); };
  const rings = [];
  /** K.ring(x, y, {color, r0, r1, ms, width}) - an expanding ring (tap feedback, pickups, pulses). */
  K.ring = (x, y, o) => { o = o || {}; rings.push({ x, y, t: 0, ms: o.ms || 420, r0: o.r0 || 6, r1: o.r1 || 60, col: o.color || K.C.accent, w: o.width || 3 }); };
  /** K.fx() - draw particles, floaters and rings (call once per frame where they belong in depth; K.render() calls it for you). */
  K.fx = () => with2d(c => {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += K.ms * K.timeScale; if (p.t > p.life) { parts.splice(i, 1); continue; }
      const dt = K.dt * K.timeScale; p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt); p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = 1 - p.t / p.life; c.globalAlpha = Math.min(1, k * 1.6); c.fillStyle = p.col; c.strokeStyle = p.col;
      if (p.shape === 'spark') { c.lineWidth = Math.max(1, p.size * 0.5); c.lineCap = 'round'; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); c.stroke(); }
      else if (p.shape === 'square' || p.shape === 'confetti') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); const s = p.size * (p.shape === 'confetti' ? 1 : k); c.fillRect(-s / 2, -s * (p.shape === 'confetti' ? 0.3 : 0.5), s, s * (p.shape === 'confetti' ? 0.6 : 1)); c.restore(); }
      else if (p.shape === 'star') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); const s = p.size * k; c.beginPath(); for (let j = 0; j < 10; j++) { const r = j % 2 ? s * 0.45 : s; const a = j * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); c.restore(); }
      else { c.beginPath(); c.arc(p.x, p.y, Math.max(0.5, p.size * (0.4 + 0.6 * k)), 0, Math.PI * 2); c.fill(); }
    }
    c.globalAlpha = 1;
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.t += K.ms; const k = r.t / r.ms; if (k >= 1) { rings.splice(i, 1); continue; } const e = E.outCubic(k); c.globalAlpha = 1 - k; c.lineWidth = r.w * (1 - k * 0.6); c.strokeStyle = r.col; c.beginPath(); c.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2); c.stroke(); }
    c.globalAlpha = 1;
    for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.t += K.ms; const k = f.t / f.ms; if (k >= 1) { floaters.splice(i, 1); continue; } const sc = k < 0.15 ? E.outBack(k / 0.15) : 1; const fo = fontOf(f.role); c.font = fontOf(f.role, { size: fo.size * sc }).css; c.textAlign = 'center'; c.fillStyle = f.col; c.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1; c.lineWidth = 4; c.lineJoin = 'round'; const yy = f.y - f.rise * E.outCubic(k); if (f.stroke) { c.strokeStyle = f.stroke; c.strokeText(f.txt, f.x, yy); } c.fillText(f.txt, f.x, yy); }
  });

  // ------------------------------------------------------------------ scenes + transitions
  const scenes = {}; K.sceneName = ''; K._sceneT0 = 0; let prevScene = null, trans = null;
  /** K.scene(name, drawFn) - register a screen. drawFn() draws the whole screen (background first) and handles its input. */
  K.scene = (name, fn) => { scenes[name] = fn; if (!K.sceneName) { K.sceneName = name; K._sceneT0 = K.t; sceneT0[name] = K.t; } };
  /** K.go(name, fx='fade'|'slide'|'back'|'up'|'down'|'zoom'|'none', ms, {restart}) - switch screens with a transition.
      v1.1: ignored while an outgoing screen is being drawn (no restarted transitions); {restart:true} replays the CURRENT screen (retry). */
  K.go = (name, fx, ms, o) => {
    o = o || {}; if (!scenes[name] || K._inert) return;
    if (name === K.sceneName && !o.restart) return;
    sceneGen++;
    if (name === K.sceneName) { K._sceneT0 = K.t; sceneT0[name] = K.t; trans = null; prevScene = null; return; }
    prevScene = K.sceneName; K.sceneName = name; K._sceneT0 = K.t; sceneT0[name] = K.t; trans = { fx: fx || 'fade', t: 0, ms: ms == null ? (fx === 'none' ? 1 : 380) : Math.max(1, ms) };   // v1.2: ms 0 = instant
  };
  K.sceneAge = () => K.t - t0Of();     // seconds since the scene being drawn opened
  K.inTransition = () => !!trans;
  /** K.render() - call once in draw(): draws the current scene (and the outgoing one during a transition), then effects and overlays. */
  K.render = (ro) => {
    const cur = scenes[K.sceneName];
    if (trans && prevScene && scenes[prevScene]) {
      trans.t += K.ms; const k = clamp(trans.t / trans.ms, 0, 1), e = E.inOutCubic(k), W = K.W, H = K.H;
      const drawScene = (nm, fn, inert) => { K._inert = inert; const was = K.sceneName; K.sceneName = nm; push(); try { fn(); } finally { pop(); K.sceneName = was; K._inert = false; } };
      if (trans.fx === 'slide' || trans.fx === 'back') { const dir = trans.fx === 'back' ? -1 : 1; push(); translate(-dir * W * 0.3 * e, 0); drawScene(prevScene, scenes[prevScene], true); pop(); K.rect(0, 0, W, H, { fill: 'rgba(0,0,0,' + (0.35 * e) + ')', r: 0 }); push(); translate(dir * W * (1 - e), 0); K.rect(-24, 0, 24, H, { r: 0, grad: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)'] }); drawScene(K.sceneName, cur, false); pop(); }
      else if (trans.fx === 'up' || trans.fx === 'down') { const dir = trans.fx === 'up' ? 1 : -1; drawScene(prevScene, scenes[prevScene], true); K.rect(0, 0, W, H, { fill: 'rgba(0,0,0,' + (0.4 * e) + ')', r: 0 }); push(); translate(0, dir * H * (1 - E.outQuint(k))); drawScene(K.sceneName, cur, false); pop(); }
      else if (trans.fx === 'zoom') { const a = 1 - e; push(); translate(W / 2, H / 2); scale(1 + 0.08 * e); translate(-W / 2, -H / 2); drawScene(prevScene, scenes[prevScene], true); pop(); push(); translate(W / 2, H / 2); scale(0.92 + 0.08 * E.outBack(k)); translate(-W / 2, -H / 2); drawingContext.globalAlpha = e; drawScene(K.sceneName, cur, false); pop(); drawingContext.globalAlpha = 1; void a; }
      else if (trans.fx === 'none') { drawScene(K.sceneName, cur, false); }
      else { if (k < 0.5) { drawScene(prevScene, scenes[prevScene], true); K.rect(0, 0, W, H, { fill: K.alpha(K.C.bg, E.inOutSine(k * 2)), r: 0 }); } else { drawScene(K.sceneName, cur, false); K.rect(0, 0, W, H, { fill: K.alpha(K.C.bg, 1 - E.inOutSine((k - 0.5) * 2)), r: 0 }); } }
      if (k >= 1) { trans = null; prevScene = null; }
    } else if (cur) { cur(); }
    if (!ro || ro.fx !== false) K.fx();   // v1.1: K.render({fx:false}) lets a game call K.fx() itself (inside K.camera, under its HUD)
  };

  // ------------------------------------------------------------------ components (immediate mode: call every frame; they draw AND report input)
  const pressK = (id) => 'press:' + id;
  function pressAmt(id, held) { return K.springTo(pressK(id), held ? 1 : 0, { k: 420, d: 26 }); }
  /** K.button(id, x, y, w, h, label, {style:'primary'|'secondary'|'tinted'|'ghost'|'danger'|'glass', icon, color, disabled, role, sfx:'tap'|false, r}) -> true on tap. */
  K.button = (id, x, y, w, h, label, o) => {
    o = o || {}; const held = !o.disabled && !!K.holdIn(x, y, w, h); const pa = pressAmt(id, held); const tap = !o.disabled && K.tapIn(x, y, w, h);
    uiRect(x, y, w, h); if (!o.disabled) ctl(id, x, y, w, h);   // v1.1: a disabled button is not offered to automated tests
    const col = o.color || (o.style === 'danger' ? K.C.bad : K.C.accent); const r = o.r == null ? Math.min(K.R.l, h / 2) : o.r;
    const s = 1 - 0.04 * pa, cx = x + w / 2, cy = y + h / 2;
    push(); translate(cx, cy); scale(s); translate(-cx, -cy);
    const st = o.disabled ? 'disabled' : (o.style || 'primary'); let fg = K.C.text;
    if (st === 'disabled') { if (o.style !== 'ghost') K.rect(x, y, w, h, { r, fill: K.alpha(K.C.text, K.mode === 'dark' ? 0.08 : 0.06), stroke: K.alpha(K.C.text, 0.06) }); fg = K.C.text3; }   // v1.2: a disabled ghost keeps no plate   // v1.1: looks disabled
    else if (st === 'primary' || st === 'danger') { K.rect(x, y, w, h, { r, grad: [K.lighten(col, 0.1 - pa * 0.08), K.darken(col, 0.08 + pa * 0.1)], elev: o.disabled ? 0 : (pa > 0.5 ? 1 : 2), shadow: K.alpha(col, 0.35) }); with2d(c => { rrPath(c, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1)); c.clip(); c.fillStyle = 'rgba(255,255,255,' + (0.1 * (1 - pa)) + ')'; c.fillRect(x + 1, y + 1, w - 2, h * 0.5); }); fg = K.onColor(col); }   // v1.2: gloss clipped to the shape (no ears on pills)
    else if (st === 'secondary') { K.rect(x, y, w, h, { r, fill: K.C.surface2, stroke: K.C.line, elev: pa > 0.5 ? 0 : 1 }); fg = K.C.text; }
    else if (st === 'tinted') { K.rect(x, y, w, h, { r, fill: K.alpha(col, 0.16 + 0.08 * pa) }); fg = col; }
    else if (st === 'glass') { K.rect(x, y, w, h, { r, fill: 'rgba(255,255,255,' + (0.1 + 0.06 * pa) + ')', stroke: 'rgba(255,255,255,0.18)' }); fg = '#ffffff'; }
    else { if (pa > 0.02) K.rect(x, y, w, h, { r, fill: K.alpha(col, 0.12 * pa) }); fg = col; }
    if (o.disabled) fg = K.C.text3;
    const role = o.role || (h < 40 ? 'subhead' : 'button'); const tw = label ? K.measure(label, role, o.size ? { size: o.size } : null) : 0; const isz = o.iconSize || Math.min(22, h * 0.46); const gap = label && o.icon ? 8 : 0;
    const total = tw + (o.icon ? isz : 0) + gap; let lx = cx - total / 2;
    if (o.icon) { K.icon(o.icon, lx + isz / 2, cy, isz, fg, { weight: 2.2 }); lx += isz + gap; }
    if (label) K.text(label, lx, cy + 0.5, role, fg, { base: 'middle', size: o.size });
    pop();
    if (tap && o.sfx !== false) K.sfx(o.sfx || 'tap');
    return !!tap;
  };
  /** K.iconButton(id, cx, cy, size, icon, {style:'filled'|'tinted'|'plain'|'glass', color, badge}) -> true on tap. Round button centred on (cx, cy). */
  K.iconButton = (id, cx, cy, size, icon, o) => {
    o = o || {}; const x = cx - size / 2, y = cy - size / 2, hit = Math.max(44, size); const hx = cx - hit / 2, hy = cy - hit / 2;
    const held = !o.disabled && !!K.holdIn(hx, hy, hit, hit); const pa = pressAmt(id, held); const tap = !o.disabled && K.tapIn(hx, hy, hit, hit);
    uiRect(hx, hy, hit, hit); if (!o.disabled) ctl(id, hx, hy, hit, hit);
    if (o.disabled) { push(); drawingContext.globalAlpha *= 0.4; }
    const col = o.color || K.C.accent, st = o.style || 'tinted'; const s = 1 - 0.1 * pa;
    push(); translate(cx, cy); scale(s); translate(-cx, -cy);
    let fg = col;
    if (st === 'filled') { K.circle(cx, cy, size / 2, { fill: col, elev: pa > 0.5 ? 1 : 2, shadow: K.luma(col) > 0.8 ? 'rgba(0,0,0,0.22)' : K.alpha(col, 0.4) }); fg = K.onColor(col); }
    else if (st === 'tinted') K.circle(cx, cy, size / 2, { fill: K.alpha(col, 0.16 + 0.1 * pa) });
    else if (st === 'glass') { K.circle(cx, cy, size / 2, { fill: 'rgba(255,255,255,' + (0.12 + 0.08 * pa) + ')', stroke: 'rgba(255,255,255,0.2)', sw: 1 }); fg = '#ffffff'; }
    else if (pa > 0.02) K.circle(cx, cy, size / 2, { fill: K.alpha(col, 0.14 * pa) });
    K.icon(icon, cx, cy, size * 0.5, o.iconColor || fg, { weight: 2.2, fill: o.fillIcon });
    if (o.badge) { K.circle(cx + size * 0.34, cy - size * 0.34, 9, { fill: K.C.bad }); K.text(String(o.badge), cx + size * 0.34, cy - size * 0.34 + 0.5, 'caption', '#fff', { align: 'center', base: 'middle', size: 11, weight: 700 }); }
    pop(); if (o.disabled) pop();
    if (tap && o.sfx !== false) K.sfx(o.sfx || 'tap');
    return !!tap;
  };
  /** K.holdButton(id, cx, cy, size, icon, {color, label}) -> true every frame it is held (FIRE, accelerate, charge). */
  K.holdButton = (id, cx, cy, size, icon, o) => {
    o = o || {}; const x = cx - size / 2, y = cy - size / 2; const held = !!K.holdIn(x, y, size, size) || !!K.pressIn(x, y, size, size); const pa = pressAmt(id, held);
    uiRect(x, y, size, size); ctl(id, x, y, size, size);
    const col = o.color || K.C.bad; const s = 1 - 0.08 * pa;
    push(); translate(cx, cy); scale(s); translate(-cx, -cy);
    K.glow(cx, cy, size * 0.9, col, 0.25 + 0.35 * pa);
    K.circle(cx, cy, size / 2, { fill: col, elev: 2, shadow: K.alpha(col, 0.5) });
    K.circle(cx, cy - size * 0.08, size * 0.4, { fill: 'rgba(255,255,255,' + (0.16 - 0.1 * pa) + ')' });
    K.circle(cx, cy, size / 2, { fill: 'none', stroke: 'rgba(255,255,255,0.35)', sw: 2 });
    if (icon) K.icon(icon, cx, cy - (o.label ? 6 : 0), size * 0.38, K.onColor(col), { weight: 2.4 });
    if (o.label) K.text(o.label, cx, cy + size * 0.24, 'label', K.onColor(col), { align: 'center', base: 'middle' });
    pop(); return held;
  };
  /** K.stick(id, cx, cy, r) -> {x, y, mag, angle, active}: a virtual joystick; x/y in -1..1 with a dead zone. Registers a d-pad in the controls map. */
  const sticks = {};
  K.stick = (id, cx, cy, r, o) => {
    o = o || {}; const st = sticks[id] || (sticks[id] = { pid: null, kx: 0, ky: 0 });
    let p = st.pid != null ? K.pointers.find(q => q.id === st.pid) : null;
    if (blocked()) { p = null; st.pid = null; }
    else if (!p) { st.pid = null; for (const q of K.pointers) if (!q.claimed && Math.hypot(q.sx - cx, q.sy - cy) < r * 1.7) { p = q; st.pid = q.id; q.claimed = 'stick:' + id; break; } }
    let vx = 0, vy = 0;
    if (p) { let dx = p.x - cx, dy = p.y - cy; const d = Math.hypot(dx, dy); if (d > r) { dx *= r / d; dy *= r / d; } vx = dx / r; vy = dy / r; }
    st.kx = p ? vx : K.approach(st.kx, 0, 18); st.ky = p ? vy : K.approach(st.ky, 0, 18);
    const mag = Math.hypot(vx, vy), dz = o.deadzone == null ? 0.12 : o.deadzone;
    uiRect(cx - r * 1.7, cy - r * 1.7, r * 3.4, r * 3.4);
    try { if (!blocked()) (window.__controls || (ctlReset(), window.__controls)).dpad = { cx: Math.round(cx), cy: Math.round(cy), r: Math.round(r) }; } catch (e) { /* ignore */ }
    const a = p ? 1 : 0.7;
    const base = o.base || '#ffffff';   // v1.1: o.base tints the ring and the resting knob (was fixed white)
    K.circle(cx, cy, r, { fill: K.alpha(base, 0.06 * a), stroke: K.alpha(base, 0.16 * a), sw: 1.5 });
    K.circle(cx, cy, r * 0.62, { fill: 'none', stroke: K.alpha(base, 0.06), sw: 1 });
    const kx = cx + st.kx * r, ky = cy + st.ky * r;
    if (p) K.glow(kx, ky, r * 0.9, o.color || K.C.accent, 0.25);
    K.circle(kx, ky, r * 0.42, { fill: p ? (o.color || K.C.accent) : K.alpha(base, 0.22), elev: 2 });
    K.circle(kx, ky - r * 0.06, r * 0.3, { fill: 'rgba(255,255,255,0.14)' });
    return mag < dz ? { x: 0, y: 0, mag: 0, angle: 0, active: !!p } : { x: vx, y: vy, mag: Math.min(1, mag), angle: Math.atan2(vy, vx), active: !!p };
  };
  /** K.card(x, y, w, h, {fill, r, elev, stroke, alpha, glow}) - a raised surface. */
  K.card = (x, y, w, h, o) => { o = o || {}; if (o.glow) K.glow(x + w / 2, y + h / 2, Math.max(w, h) * 0.7, o.glow, 0.18 * (o.alpha == null ? 1 : o.alpha)); K.rect(x, y, w, h, { r: o.r == null ? K.R.l : o.r, fill: o.fill || K.C.surface, elev: o.elev == null ? 2 : o.elev, stroke: o.stroke || K.C.line, alpha: o.alpha }); };
  /** K.toggle(id, x, y, value) -> new boolean (iOS switch 51x31 at x, y). */
  K.toggle = (id, x, y, value, o) => {
    o = o || {}; const w = 51, h = 31; const tap = K.tapIn(x - 6, y - 7, w + 12, h + 14); uiRect(x, y, w, h); ctl(id, x - 6, y - 7, w + 12, h + 14);
    if (tap) { value = !value; K.sfx('toggle'); }
    const k = K.springTo('tg:' + id, value ? 1 : 0, { k: 300, d: 24 });
    K.rect(x, y, w, h, { r: h / 2, fill: K.mix(K.mode === 'dark' ? '#39393d' : '#e3e4e8', o.color || K.C.good, clamp(k, 0, 1)) });
    K.circle(x + h / 2 + (w - h) * k, y + h / 2, h / 2 - 2, { fill: '#ffffff', elev: 1 });
    return value;
  };
  /** K.slider(id, x, y, w, value, min, max, {color, step}) -> new value (drag the knob or tap the track). */
  const sliders = {};
  K.slider = (id, x, y, w, value, lo, hi, o) => {
    o = o || {}; const h = 28; const S = sliders[id] || (sliders[id] = { pid: null, last: value });
    uiRect(x - 12, y - h / 2, w + 24, h); ctl(id, x - 12, y - h / 2, w + 24, h);
    let p = S.pid != null ? K.pointers.find(q => q.id === S.pid) : null;   // v1.1: follow THIS finger by id for the whole drag
    if (blocked()) { p = null; S.pid = null; }
    else if (!p) { S.pid = null; const q = K.holdIn(x - 12, y - h / 2, w + 24, h); if (q) { p = q; S.pid = q.id; q.claimed = 'slider:' + id; } }
    const tq = p ? null : K.tapIn(x - 12, y - h / 2, w + 24, h), f = p || tq;   // v1.2: a quick tap on the track sets it too
    if (f) { const t = clamp((f.x - x) / w, 0, 1); let v = lo + (hi - lo) * t; if (o.step) v = Math.round(v / o.step) * o.step; value = v; }
    if (value !== S.last) { const stepSz = o.tickEvery || o.step || (hi - lo) / 20; if (!f) S.last = value; else if (tq || Math.abs(value - S.last) >= stepSz * 0.999) { if (o.sfx !== false) K.sfx('tick', { vol: 0.5 }); S.last = value; } }   // v1.2: ticks only under a finger, never when code moves it
    const t = clamp((value - lo) / ((hi - lo) || 1), 0, 1); const col = o.color || K.C.accent; const kx = x + w * t;
    K.rect(x, y - 2.5, w, 5, { r: 2.5, fill: o.track || K.alpha(K.C.text, K.mode === 'dark' ? 0.16 : 0.14) }); K.rect(x, y - 2.5, w * t, 5, { r: 2.5, fill: col });
    const ks = K.springTo('sl:' + id, p ? 1.15 : 1, { k: 400, d: 24 });
    K.circle(kx, y, 13 * ks, { fill: '#ffffff', elev: 2, stroke: K.mode === 'light' ? 'rgba(0,0,0,0.06)' : null, sw: 1 });
    K.slider.dragging = !!p;
    return value;
  };
  /** K.segmented(id, x, y, w, labels[], index) -> new index (iOS segmented control with a sliding pill). */
  K.segmented = (id, x, y, w, labels, index, o) => {
    o = o || {}; const h = o.h || 34, n = labels.length, sw = w / n;
    for (let i = 0; i < n; i++) { if (K.tapIn(x + i * sw, y, sw, h) && i !== index) { index = i; K.sfx('select'); } ctl(id + ':' + labels[i], x + i * sw, y, sw, h); }
    uiRect(x, y, w, h);
    const px = K.springTo('seg:' + id, x + index * sw, { k: 380, d: 30 });
    K.rect(x, y, w, h, { r: 10, fill: o.track || K.alpha(K.C.text, K.mode === 'dark' ? 0.1 : 0.06) });
    const pill = o.color || (K.mode === 'dark' ? K.mix(K.C.surface3, '#ffffff', 0.14) : '#ffffff');   // v1.1: o.color tints the selected pill; default follows the theme
    K.rect(px + 2, y + 2, sw - 4, h - 4, { r: 8, fill: pill, elev: 1 });
    labels.forEach((l, i) => K.text(l, x + i * sw + sw / 2, y + h / 2 + 0.5, 'subhead', i === index && o.color ? K.onColor(pill) : K.C.text, { align: 'center', base: 'middle', weight: i === index ? 600 : 500 }));
    return index;
  };
  /** K.tabBar(id, items[{icon, label}], index, {color}) -> new index. A bottom tab bar in the safe area with a bouncing selected icon. */
  K.tabBar = (id, items, index, o) => {
    o = o || {}; const h = 58 + K.safe.bottom, y = K.H - h, w = K.W / items.length;
    K.rect(0, y, K.W, h, { r: 0, fill: o.bg || chrome(0.94) }); K.line(0, y, K.W, y, K.C.line, 1);   // v1.1: follows the theme
    uiRect(0, y, K.W, h);
    items.forEach((it, i) => {
      const cx = w * i + w / 2; ctl(id + ':' + (it.label || i), w * i, y, w, 58);
      if (K.tapIn(w * i, y, w, 58) && i !== index) { index = i; K.sfx('select'); K.springTo('tab:' + id + ':' + i, 1, { k: 500, d: 14 }); K.springKick('tab:' + id + ':' + i, 6); }   // v1.2: the bounce shows (a 1.25 target was reset to 1 in the same frame)
      const on = i === index; const bump = K.springTo('tab:' + id + ':' + i, 1, { k: 500, d: 14 });
      const col = on ? (o.color || K.C.accent) : K.C.text3;
      push(); translate(cx, y + 22); scale(bump); K.icon(it.icon, 0, 0, 24, col, { weight: on ? 2.4 : 2 }); pop();
      K.text(it.label || '', cx, y + 45, 'caption', col, { align: 'center', size: 10.5, weight: on ? 600 : 500 });
      if (it.badge) { const bx = cx + 12, by = y + 12; const bc = it.badgeColor || o.badgeColor || K.C.bad; K.circle(bx, by, 8.5, { fill: bc }); K.text(String(it.badge), bx, by + 0.5, 'caption', K.onColor(bc), { align: 'center', base: 'middle', size: 10, weight: 700 }); }
    });
    return index;
  };
  /** K.navBar(title, scrollY, {left:{id, icon, label}, right:{id, icon, label}, sub}) -> id of a tapped side button or null.
      iOS large title that collapses into a centred inline title as scrollY grows. Content starts at K.navBar.top(sub); clip scrolled content below K.navBar.bottom(). */
  K.navBar = (title, scrollY, o) => {
    o = o || {}; const top = K.safe.top, k = clamp((scrollY || 0) / 52, 0, 1); let hit = null;
    const barH = top + 50; K.navBar.contentTop = top + (o.sub ? 136 : 112); K.navBar.barH = barH;
    if (k > 0.02) { K.rect(0, 0, K.W, barH, { r: 0, fill: chrome(0.94 * k) }); K.line(0, barH, K.W, barH, K.alpha(K.C.text, 0.1 * k), 1); }
    uiRect(0, 0, K.W, barH);
    if (k > 0.6) K.text(title, K.W / 2, top + 30, 'headline', K.C.text, { align: 'center', base: 'middle', alpha: (k - 0.6) / 0.4, maxW: K.W - 140 });
    const ly = top + 50 + 40 - (scrollY || 0); if (k < 1) K.text(title, 16, ly, 'largeTitle', K.C.text, { alpha: 1 - clamp((k - 0.4) / 0.6, 0, 1), maxW: K.W - 32 });
    if (o.sub && k < 0.5) K.text(o.sub, 16, ly + 22, 'subhead', K.C.text2, { alpha: 1 - k * 2 });
    const side = (b, x, align) => { if (!b) return; if (b.icon && !b.label) { if (K.iconButton(b.id, x, top + 25, 34, b.icon, { style: b.style || 'plain', color: b.color || K.C.accent, sfx: b.sfx, badge: b.badge, fillIcon: b.fillIcon, iconColor: b.iconColor, disabled: b.disabled })) hit = b.id; } else { const tw = K.measure(b.label, 'body') + (b.icon ? 26 : 0); const bx = align === 'right' ? x - tw : x; if (K.button(b.id, bx - 6, top + 8, tw + 12, 34, b.label, { style: b.style || 'ghost', icon: b.icon, role: 'body', color: b.color, sfx: b.sfx })) hit = b.id; } };
    side(o.left, o.left && o.left.label ? 10 : 30, 'left'); side(o.right, o.right && o.right.label ? K.W - 10 : K.W - 30, 'right');
    return hit;
  };
  K.navBar.contentTop = 136;   // safe default for the first frame (navBar runs after the content it sits above)
  /** K.navBar.top(sub) -> where content starts under a navBar, known BEFORE the bar is drawn (no one-frame jump between screens). */
  K.navBar.top = (sub) => K.safe.top + (sub ? 136 : 112);
  /** K.scroll(id, x, y, w, h, contentH) -> current offset (>= 0): a momentum scroll area with rubber-band edges.
      Draw the content yourself translated by -offset inside K.clip(x, y, w, h, fn). Rows use K.tapIn as usual (a drag never becomes a tap). */
  const scrolls = {};
  K.scroll = (id, x, y, w, h, contentH) => {
    const s = scrolls[id] || (scrolls[id] = { off: 0, vel: 0, pid: null, last: 0, lastT: 0 }); const max = Math.max(0, contentH - h);
    let p = s.pid != null ? K.pointers.find(q => q.id === s.pid) : null;
    if (blocked()) { p = null; s.pid = null; }
    if (!p && !blocked()) { s.pid = null; for (const q of K.pointers) if (!q.claimed && inRs(q, x, y, w, h) && Math.abs(q.y - q.sy) > 8 && Math.abs(q.y - q.sy) > Math.abs(q.x - q.sx)) { p = q; s.pid = q.id; q.claimed = 'scroll:' + id; s.last = q.y; s.grabOff = s.off; break; } }
    if (p) { const dy = p.y - s.last; s.last = p.y; let off = s.off - dy; if (off < 0) off = s.off - dy * 0.4; if (off > max) off = s.off - dy * 0.4; s.vel = K.approach(s.vel, -dy / Math.max(K.dt, 0.001), 30); s.off = off; }
    else { s.off += s.vel * K.dt; s.vel *= Math.exp(-3.2 * K.dt); if (Math.abs(s.vel) < 4) s.vel = 0; if (s.off < 0) { s.off = K.approach(s.off, 0, 16); s.vel *= 0.6; } if (s.off > max) { s.off = K.approach(s.off, max, 16); s.vel *= 0.6; } }
    return s.off;
  };
  K.scrollTo = (id, off) => { if (scrolls[id]) { scrolls[id].off = off; scrolls[id].vel = 0; } };
  /** K.clip(x, y, w, h, fn, r) - draw fn() clipped to a (rounded) rectangle. */
  K.clip = (x, y, w, h, fn, r) => { const c = $(); c.save(); rrPath(c, x, y, w, h, r || 0); c.clip(); clipStack.push([x, y, w, h]); try { fn(); } finally { clipStack.pop(); c.restore(); p5sync(c); } };   // v1.1: kit hit tests inside fn only see taps within the clip
  /** K.listRow(id, x, y, w, h, {title, sub, icon, iconColor, value, chevron, toggle}) -> 'tap' | 'swipe' | new toggle value... returns {tap, swiped, toggle}. */
  K.listRow = (id, x, y, w, h, o) => {
    o = o || {}; const res = { tap: false, swiped: false, toggle: o.toggle };
    const held = !!K.holdIn(x, y, w, h) && o.toggle == null; const pa = K.anim('row:' + id, held ? 1 : 0, 30);
    if (pa > 0.02) K.rect(x, y, w, h, { r: o.r || 0, fill: K.alpha(K.C.text, 0.06 * pa) });   // o.r: match the card's corners
    let tx = x + 16;
    if (o.icon) { K.rect(x + 16, y + h / 2 - 15, 30, 30, { r: 8, fill: o.iconColor || K.C.accent }); K.icon(o.icon, x + 31, y + h / 2, 18, '#ffffff', { weight: 2.2 }); tx = x + 58; }
    const right = x + w - 16;
    if (o.toggle != null) { res.toggle = K.toggle(id + ':t', right - 51, y + h / 2 - 15.5, o.toggle); }
    const rv = o.chevron ? right - 16 : right;
    if (o.chevron) K.icon('chevronRight', right - 5, y + h / 2, 16, K.C.text3, { weight: 2.4 });
    if (o.value != null && o.toggle == null) K.text(String(o.value), rv, y + h / 2 + 0.5, 'body', K.C.text2, { align: 'right', base: 'middle' });
    const maxT = (o.value != null ? rv - K.measure(String(o.value), 'body') - 12 : rv) - tx;
    if (o.sub) { K.text(o.title || '', tx, y + h / 2 - 3, 'body', K.C.text, { maxW: maxT }); K.text(o.sub, tx, y + h / 2 + 16, 'footnote', K.C.text2, { maxW: maxT }); }
    else K.text(o.title || '', tx, y + h / 2 + 0.5, 'body', K.C.text, { base: 'middle', maxW: maxT });
    if (o.toggle == null && K.tapIn(x, y, w, h)) { res.tap = true; K.sfx('tap'); }
    if (o.toggle == null) ctl(id, x, y, w, h);   // v1.1: a toggle row offers only its switch to automated tests
    return res;
  };
  /** K.sheet(id, open, h, (x, y, w, h, close) => {...}, {modal}) -> open state after this frame. A bottom sheet with a spring.
      v1.1: it is MODAL (controls outside it are inert while it shows, and hidden from automated tests); a button inside closes it by calling
      close() or by returning false from the draw function; swipe-down and a backdrop tap close it too. Use: open = K.sheet(id, open, h, fn). */
  K.sheet = (id, open, h, fn, so) => {
    so = so || {}; const k = K.springTo('sheet:' + id, open ? 1 : 0, { k: 260, d: 26 }); if (k < 0.002 && !open) return open;
    const H = K.H, y = H - h * k; let closed = false; const close = () => { closed = true; };
    if (open && so.modal !== false) modalNext = true;
    modalDepth++; const wasInert = K._inert; if (!open) K._inert = true;   // a closing sheet's controls are inert
    try {
      K.rect(0, 0, K.W, H, { r: 0, fill: 'rgba(0,0,0,' + (0.45 * clamp(k, 0, 1)) + ')' });
      if (open && K.tapIn(0, 0, K.W, H - h)) { closed = true; K.sfx('back'); }
      if (open) uiRect(0, 0, K.W, H);
      K.rect(0, y, K.W, h + 40, { r: 22, fill: K.C.surface, elev: 4 });
      K.rect(K.W / 2 - 18, y + 7, 36, 5, { r: 3, fill: K.C.text3 });
      const p = open ? K.holdIn(0, y, K.W, 40) : null; if (p && p.y - p.sy > 90) { closed = true; p.claimed = 'sheet'; K.sfx('back'); }
      const r = fn(0, y, K.W, h, close); if (r === false || r === 'close') closed = true;
    } finally { modalDepth--; K._inert = wasInert; }
    return closed ? false : open;
  };
  const toasts = [];
  /** K.toast(text, {icon, tone:'info'|'good'|'bad'|'warn', ms}) - a pill that drops in from the top. */
  K.toast = (msg, o) => { o = o || {}; toasts.push({ msg: String(msg), icon: o.icon || (o.tone === 'good' ? 'check' : o.tone === 'bad' ? 'alert' : o.tone === 'warn' ? 'alert' : 'info'), tone: o.tone || 'info', t: 0, ms: o.ms || 2800, y: o.y }); if (toasts.length > 3) toasts.shift(); };
  function drawToasts() {
    let yy = K.safe.top + 10;
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i]; t.t += K.ms; if (t.t > t.ms) { toasts.splice(i, 1); continue; }
      if (t.y != null && i === toasts.length - 1) yy = t.y;   // v1.1: {y} drops the newest toast lower (under a large title)
      const kin = E.outBack(clamp(t.t / 380, 0, 1)), kout = t.t > t.ms - 260 ? E.inCubic((t.t - (t.ms - 260)) / 260) : 0;
      const w = Math.min(K.W - 32, K.measure(t.msg, 'subhead', { weight: 600 }) + 58), h = 44, x = K.W / 2 - w / 2, y = yy - 70 * (1 - kin) - 30 * kout;
      const col = t.tone === 'good' ? K.C.good : t.tone === 'bad' ? K.C.bad : t.tone === 'warn' ? K.C.warn : K.C.accent;
      K.rect(x, y, w, h, { r: 22, fill: K.mode === 'dark' ? '#23283a' : '#ffffff', elev: 3, stroke: K.C.line, alpha: 1 - kout });
      K.circle(x + 24, y + h / 2, 11, { fill: K.alpha(col, 0.2), alpha: 1 - kout }); K.icon(t.icon, x + 24, y + h / 2, 14, col, { weight: 2.6, alpha: 1 - kout });
      K.text(t.msg, x + 42, y + h / 2 + 0.5, 'subhead', K.C.text, { base: 'middle', weight: 600, alpha: 1 - kout, maxW: w - 54 });
      yy += (h + 8) * (1 - kout);
    }
  }
  /** K.progressRing(cx, cy, r, t 0..1, {width, color, track, cap}) */
  K.progressRing = (cx, cy, r, t, o) => with2d(c => {
    o = o || {}; c.lineWidth = o.width || 10; c.lineCap = o.cap || 'round';
    c.strokeStyle = o.track || K.alpha(K.C.text, 0.1); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * clamp(t, 0, 1);
    if (t > 0.001) { const col = o.color || K.C.accent; if (Array.isArray(col)) { const g = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r); col.forEach((cc, i) => g.addColorStop(i / Math.max(1, col.length - 1), cc)); c.strokeStyle = g; } else c.strokeStyle = col; c.shadowColor = K.alpha(Array.isArray(col) ? col[0] : col, 0.5); c.shadowBlur = o.glow == null ? 12 : o.glow; c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke(); }
  });
  /** K.progressBar(x, y, w, h, t 0..1, {color, track, r}) */
  K.progressBar = (x, y, w, h, t, o) => { o = o || {}; K.rect(x, y, w, h, { r: o.r == null ? h / 2 : o.r, fill: o.track || K.alpha(K.C.text, 0.1) }); if (t > 0.001) K.rect(x, y, Math.max(h, w * clamp(t, 0, 1)), h, { r: o.r == null ? h / 2 : o.r, grad: o.grad || [K.lighten(o.color || K.C.accent, 0.12), o.color || K.C.accent] }); };
  /** K.chip(x, y, label, {color, icon, filled}) -> width. A small pill tag. */
  K.chip = (x, y, label, o) => { o = o || {}; const col = o.color || K.C.accent; const tw = K.measure(label, 'caption', { weight: 600 }); const w = tw + 20 + (o.icon ? 16 : 0), h = 24; K.rect(x, y, w, h, { r: 12, fill: o.filled ? col : K.alpha(col, 0.16) }); let tx = x + 10; if (o.icon) { K.icon(o.icon, x + 16, y + h / 2, 13, o.filled ? K.onColor(col) : col, { weight: 2.4 }); tx += 14; } K.text(label, tx, y + h / 2 + 0.5, 'caption', o.filled ? K.onColor(col) : col, { base: 'middle', weight: 600 }); return w; };
  /** K.chipWidth(label, {icon}) -> the width K.chip will draw (centre or right-align chips before drawing). */
  K.chipWidth = (label, o) => K.measure(label, 'caption', { weight: 600 }) + 20 + (o && o.icon ? 16 : 0);
  /** K.spark(values[], x, y, w, h, {color, fill, dot, min, max, t 0..1 draw-on, width, smooth}) - a sparkline / area chart. */
  K.spark = (vals, x, y, w, h, o) => with2d(c => {
    o = o || {}; if (!vals || vals.length < 2) return; const n = vals.length; let lo = o.min == null ? Math.min.apply(null, vals) : o.min, hi = o.max == null ? Math.max.apply(null, vals) : o.max; if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const T = o.t == null ? 1 : clamp(o.t, 0, 1); const m = Math.max(2, Math.ceil(n * T)); const col = o.color || K.C.accent;
    const P = i => [x + (i / (n - 1)) * w, y + h - ((vals[i] - lo) / (hi - lo)) * h];
    const path = () => { c.beginPath(); const p0 = P(0); c.moveTo(p0[0], p0[1]); for (let i = 1; i < m; i++) { const a = P(i - 1), b = P(i); if (o.smooth === false) c.lineTo(b[0], b[1]); else { const mx = (a[0] + b[0]) / 2; c.bezierCurveTo(mx, a[1], mx, b[1], b[0], b[1]); } } };
    if (o.fill !== false) { path(); const pe = P(m - 1); c.lineTo(pe[0], y + h); c.lineTo(x, y + h); c.closePath(); const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, K.alpha(col, 0.32)); g.addColorStop(1, K.alpha(col, 0)); c.fillStyle = g; c.fill(); }
    path(); c.strokeStyle = col; c.lineWidth = o.width || 2.5; c.lineJoin = 'round'; c.lineCap = 'round'; c.shadowColor = K.alpha(col, 0.5); c.shadowBlur = 8; c.stroke();
    if (o.dot !== false) { const pe = P(m - 1); c.shadowBlur = 0; c.fillStyle = K.alpha(col, 0.25 * K.pulse(4)); c.beginPath(); c.arc(pe[0], pe[1], 9, 0, Math.PI * 2); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(pe[0], pe[1], 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = K.C.bg; c.lineWidth = 2; c.stroke(); }
  });
  /** K.bars(values[], x, y, w, h, {color, gap, r, t, labels, highlight}) - an animated bar chart. */
  K.bars = (vals, x, y, w, h, o) => {
    o = o || {}; const n = vals.length; if (!n) return; const gap = o.gap == null ? 6 : o.gap; const bw = (w - gap * (n - 1)) / n; const hi = o.max || Math.max.apply(null, vals.concat([1e-9]));
    vals.forEach((v, i) => {
      const e = o.t == null ? K.stagger(i, 45, 520, 'outBack') : o.t; const bh = v > 0 ? Math.max(3, (v / hi) * h * e) : 0; const on = o.highlight === i;
      const col = (o.colors && o.colors[i % o.colors.length]) || o.color || K.C.accent; const bx = x + i * (bw + gap), rr = o.r == null ? Math.min(6, bw / 2) : o.r;
      if (o.track) K.rect(bx, y, bw, h, { r: rr, fill: o.track === true ? K.alpha(K.C.text, 0.06) : o.track });
      if (bh > 0) K.rect(bx, y + h - bh, bw, bh, { r: rr, grad: [K.lighten(col, on ? 0.25 : 0.08), K.alpha(col, on || o.colors ? 1 : 0.75)] });
      if (o.values) K.text(typeof o.values === 'function' ? o.values(v, i) : String(v), bx + bw / 2, y + h - bh - (o.valueGap == null ? 6 : o.valueGap), o.valueRole || 'caption', o.valueColor ? (typeof o.valueColor === 'function' ? o.valueColor(v, i) : o.valueColor) : (on ? K.C.text : K.C.text2), { align: 'center', alpha: clamp(e, 0, 1), weight: o.valueWeight });
      if (o.labels) K.text(o.labels[i], bx + bw / 2, y + h + 16, 'caption', on ? K.C.text : K.C.text3, { align: 'center' });
    });
  };
  /** K.shimmer(x, y, w, h, r) - a loading skeleton block with a moving highlight. */
  K.shimmer = (x, y, w, h, r) => { K.rect(x, y, w, h, { r: r == null ? 8 : r, fill: K.alpha(K.C.text, 0.07) }); K.clip(x, y, w, h, () => { const sx = x - w + ((K.t * 0.9) % 1.6) * w * 1.6; K.gradRect(sx, y, w, h, [K.alpha(K.C.text, 0), K.alpha(K.C.text, 0.08), K.alpha(K.C.text, 0)], false); }, r == null ? 8 : r); };
  /** K.empty(cx, y, icon, title, body, {w}) - an empty state: tinted icon disc, headline, one line of guidance. */
  K.empty = (cx, y, icon, title, body, o) => {
    o = o || {}; const col = o.color || K.C.accent; const b = 1 + 0.04 * K.wave(2);
    K.circle(cx, y + 36, 36 * b, { fill: K.alpha(col, 0.14) }); K.icon(icon, cx, y + 36, 34, col, { weight: 2 }); K.text(title, cx, y + 104, 'title3', K.C.text, { align: 'center' });
    const ph = body ? K.para(body, cx - (o.w || 260) / 2, y + 114, o.w || 260, 'subhead', K.C.text2, { align: 'center', maxLines: 3 }) : 0;
    return 118 + ph;   // v1.1: the height it used, to size the card around it
  };
  /** K.input(id, x, y, w, h, value, {placeholder, type, onEnter, role}) -> current text. A canvas-drawn field that opens a real keyboard (DOM input) when tapped. */
  const inputs = {};
  K.input = (id, x, y, w, h, value, o) => {
    o = o || {}; let st = inputs[id]; if (!st) st = inputs[id] = { el: null, value: value || '', focus: false };
    if (value != null && !st.focus) st.value = value;
    const tap = K.tapIn(x, y, w, h); uiRect(x, y, w, h); ctl(id, x, y, w, h);
    const padL = o.icon ? 40 : 14;
    if (st.focus && st.el) {   // v1.1: the live field follows the drawn one (a springing sheet, a moving layout); code can set the value while focused
      try { const cv = document.querySelector('canvas'); const r = cv ? cv.getBoundingClientRect() : { left: 0, top: 0 }; st.el.style.left = (r.left + x + padL) + 'px'; st.el.style.top = (r.top + y) + 'px'; st.el.style.width = (w - padL - 14) + 'px'; } catch (e) { /* ignore */ }
      if (value != null && value !== st.lastExt && value !== st.value) { st.value = value; st.el.value = value; }
    }
    st.lastExt = value;
    if (tap && !st.focus) {
      try {
        const el = document.createElement('input'); el.type = o.type || 'text'; el.value = st.value; el.placeholder = o.placeholder || ''; el.autocomplete = 'off';
        const cv = document.querySelector('canvas'); const r = cv ? cv.getBoundingClientRect() : { left: 0, top: 0 };
        Object.assign(el.style, { position: 'fixed', left: (r.left + x + padL) + 'px', top: (r.top + y) + 'px', width: (w - padL - 14) + 'px', height: h + 'px', border: '0', outline: 'none', background: 'transparent', color: K.C.text, font: fontOf(o.role || 'body').css, zIndex: 9999, padding: '0', margin: '0', caretColor: K.C.accent });
        el.addEventListener('input', () => { st.value = el.value; });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { st.submitted = true; el.blur(); } });
        el.addEventListener('blur', () => { st.focus = false; try { el.remove(); } catch (e) { /* ignore */ } st.el = null; });
        document.body.appendChild(el); st.el = el; st.focus = true; setTimeout(() => { try { el.focus(); } catch (e) { /* ignore */ } }, 0);
      } catch (e) { /* no DOM */ }
    }
    const fk = K.anim('in:' + id, st.focus ? 1 : 0, 18);
    K.rect(x, y, w, h, { r: 12, fill: K.C.surface2, stroke: K.mix(K.C.line, K.C.accent, fk), sw: 1 + fk });
    if (o.icon) K.icon(o.icon, x + 22, y + h / 2, 18, st.focus ? K.C.accent : K.C.text3, { weight: 2.2 });
    if (!st.focus) { if (st.value) K.text(o.type === 'password' ? '\u2022'.repeat(String(st.value).length) : st.value, x + padL, y + h / 2 + 0.5, o.role || 'body', K.C.text, { base: 'middle', maxW: w - padL - 14 }); else K.text(o.placeholder || '', x + padL, y + h / 2 + 0.5, o.role || 'body', K.C.text3, { base: 'middle', maxW: w - padL - 14 }); }
    if (st.submitted) { st.submitted = false; if (o.onEnter) try { o.onEnter(st.value); } catch (e) { console.error(e); } }
    return st.value;
  };
  K.blurInputs = () => { for (const k in inputs) if (inputs[k].el) try { inputs[k].el.blur(); } catch (e) { /* ignore */ } };

  /** K.pager(id, x, y, w, h, count, drawPage(i, px, py, pw, ph), {index, gap}) -> current page index. Horizontal swipe pages with a snapping spring
      (onboarding, carousels, photo galleries). Pages are drawn at px = x + i*(w+gap) - offset; only visible ones are drawn. o.r rounds the clip. */
  const pagers = {};
  K.pager = (id, x, y, w, h, count, fn, o) => {
    o = o || {}; const gap = o.gap == null ? 0 : o.gap; const P = pagers[id] || (pagers[id] = { idx: o.index || 0, off: (o.index || 0) * (w + gap), pid: null, grab: 0 });
    if (o.index != null && o.index !== P.idx && P.pid == null) P.idx = clamp(o.index, 0, count - 1);
    let p = P.pid != null ? K.pointers.find(q => q.id === P.pid) : null;
    if (blocked()) { p = null; P.pid = null; }
    else if (!p) { if (P.pid != null) { const q = ups.find(u => u.id === P.pid); if (q) { const dx = q.x - q.sx, v = dx / Math.max(0.05, (q.t1 - q.t0) / 1000); let ni = P.idx; if (dx < -w * 0.2 || v < -500) ni++; else if (dx > w * 0.2 || v > 500) ni--; ni = clamp(ni, 0, count - 1); if (ni !== P.idx) K.sfx('tick'); P.idx = ni; } P.pid = null; }
      for (const q of K.pointers) if (!q.claimed && inRs(q, x, y, w, h) && Math.abs(q.x - q.sx) > 10 && Math.abs(q.x - q.sx) > Math.abs(q.y - q.sy)) { p = q; P.pid = q.id; q.claimed = 'pager:' + id; P.grab = P.off; break; } }
    const target = P.idx * (w + gap);
    if (p) { let off = P.grab - (p.x - p.sx); const max = (count - 1) * (w + gap); if (off < 0) off *= 0.35; if (off > max) off = max + (off - max) * 0.35; P.off = off; }
    else P.off = K.springTo('pager:' + id, target, { k: 220, d: 26 });
    if (p) { let s = springKeys.get('pager:' + id); if (!s) { s = K.spring(P.off, { k: 220, d: 26 }); springKeys.set('pager:' + id, s); } s.set(P.off); }   // release animates from the finger
    uiRect(x, y, w, h);
    K.clip(x, y, w, h, () => { for (let i = 0; i < count; i++) { const px = x + i * (w + gap) - P.off; if (px > x - w - gap && px < x + w + gap) fn(i, px, y, w, h); } }, o.r || 0);
    return P.idx;
  };
  K.pagerGo = (id, i) => { if (pagers[id]) pagers[id].idx = i; };
  /** K.dots(cx, y, count, index, {color}) - page dots with a stretching active pill. */
  K.dots = (cx, y, n, idx, o) => { o = o || {}; const gap = 16, x0 = cx - (n - 1) * gap / 2; const ax = K.springTo('dots:' + (o.id || cx + ':' + y), x0 + idx * gap, { k: 300, d: 24 }); for (let i = 0; i < n; i++) K.circle(x0 + i * gap, y, 3.5, { fill: K.alpha(K.C.text, 0.25) }); K.rect(ax - 9, y - 3.5, 18, 7, { r: 3.5, fill: o.color || K.C.accent }); };
  /** K.stepper(id, x, y, value, {min, max, step, show}) -> value. [- +] (94x32), or [- n +] (128x32) with show:true.
      A tap at a limit plays an error tick and sets K.stepper.limit = 'min' | 'max' for that frame (answer it with a toast if you like). */
  K.stepper = (id, x, y, value, o) => {
    o = o || {}; const lo = o.min == null ? 0 : o.min, hi = o.max == null ? 99 : o.max, st = o.step || 1; const W = o.show ? 128 : 94, bw = o.show ? 40 : 47;
    K.stepper.limit = null;
    K.rect(x, y, W, 32, { r: 9, fill: K.alpha(K.C.text, K.mode === 'dark' ? 0.1 : 0.06) });
    if (!o.show) K.line(x + 47, y + 7, x + 47, y + 25, K.C.line, 1);
    if (K.tapIn(x, y, bw, 32)) { if (value > lo) { value = Math.max(lo, value - st); if (o.sfx !== false) K.sfx('tick'); K.springTo('stp:' + id, 1, { k: 500, d: 16 }); K.springKick('stp:' + id, 4); } else { K.stepper.limit = 'min'; if (o.sfx !== false && o.limitSfx !== false) K.sfx(o.limitSfx || 'error', { vol: 0.4 }); } }
    if (K.tapIn(x + W - bw, y, bw, 32)) { if (value < hi) { value = Math.min(hi, value + st); if (o.sfx !== false) K.sfx('tick'); K.springTo('stp:' + id, 1, { k: 500, d: 16 }); K.springKick('stp:' + id, 4); } else { K.stepper.limit = 'max'; if (o.sfx !== false && o.limitSfx !== false) K.sfx(o.limitSfx || 'error', { vol: 0.4 }); } }
    uiRect(x, y, W, 32); ctl(id + ':minus', x, y, bw, 32); ctl(id + ':plus', x + W - bw, y, bw, 32);
    K.icon('minus', x + bw / 2, y + 16, 16, value > lo ? K.C.text : K.C.text3, { weight: 2.4 }); K.icon('plus', x + W - bw / 2, y + 16, 16, value < hi ? K.C.text : K.C.text3, { weight: 2.4 });
    if (o.show) { const s = K.springTo('stp:' + id, 1, { k: 500, d: 16 }); push(); translate(x + W / 2, y + 16); scale(s); K.num(String(value), 0, 5.5, 'headline', K.C.text, { align: 'center' }); pop(); }
    return value;
  };
  /** K.avatar(cx, cy, r, name, {colors}) - a round avatar with initials on a gradient picked from the name (people, contacts, chat). */
  K.avatar = (cx, cy, r, name, o) => with2d(c => {
    o = o || {}; name = String(name || '?'); let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = h % 360; const g = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r); const cs = o.colors || [K.hsl(hue, 80, 62), K.hsl(hue + 40, 75, 45)]; g.addColorStop(0, cs[0]); g.addColorStop(1, cs[1] || cs[0]);
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
    c.font = fontOf('headline', { size: r * 0.8, weight: 700 }).css; c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ini, cx, cy + r * 0.04);
  });

  // v1.1: {alpha} on every control - fades it for entrances; below 0.3 it is also inert (a control still fading in cannot be tapped)
  const fade = (o, fn) => { const a = o && o.alpha; if (a == null || a >= 0.999) return fn(); push(); drawingContext.globalAlpha *= clamp(a, 0, 1); const was = K._inert; if (a < 0.3) K._inert = true; try { return fn(); } finally { K._inert = was; pop(); } };
  for (const [name, oi] of [['button', 6], ['iconButton', 5], ['holdButton', 5], ['stick', 4], ['toggle', 4], ['segmented', 6], ['chip', 3], ['stepper', 4], ['listRow', 5], ['slider', 7], ['input', 6], ['navBar', 2], ['tabBar', 3], ['pager', 7], ['dots', 4], ['spark', 5], ['progressRing', 4], ['progressBar', 5], ['bars', 5], ['empty', 5], ['avatar', 4]]) {   // v1.2: + bars, chrome, pager, charts
    const f = K[name]; K[name] = function () { const args = arguments; return fade(args[oi], () => f.apply(null, args)); };
  }
  K.navBar.top = K.navBar.top || ((sub) => K.safe.top + (sub ? 136 : 112));
  /** v1.2: K.fade(a, fn) - fade a whole block (plain drawing, custom hit areas, kit controls) like {alpha}; below 0.3 it is inert. Returns fn's value. */
  K.fade = (a, fn) => fade({ alpha: a }, fn);
  /** v1.2: geometry known before the bars draw - K.navBar.bottom() (collapsed bar bottom = the K.clip top for scrolled content), K.tabBar.height(). */
  K.navBar.contentTop = 136; K.navBar.barH = 50; K.navBar.bottom = () => K.safe.top + 50; K.tabBar.height = () => 58 + K.safe.bottom;
  /** v1.2: K.empty.height(body, {w}) - the height K.empty will use, before drawing it. */
  K.empty.height = (body, o) => 118 + (body ? K.paraHeight(body, (o && o.w) || 260, 'subhead', { maxLines: 3 }) : 0);

  // ------------------------------------------------------------------ storage
  K.load = (key, fallback) => { try { const S = window.__p0store, v = S ? S.get('p0kit:' + key) : localStorage.getItem('p0kit:' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };   // in p0pc0rn: the host keeps each app's storage
  K.save = (key, value) => { try { const S = window.__p0store, s = JSON.stringify(value); if (S) return S.set('p0kit:' + key, s); localStorage.setItem('p0kit:' + key, s); return true; } catch (e) { return false; } };

  // ------------------------------------------------------------------ agents (v1.4): the parts of an AGENTIC app. None of them needs p5,
  // so they work the same in an unseen check (p0.mode 'check') and in the open app. See "Agentic apps" in the Skeleton Guide.
  const inCheck = () => !!(window.p0 && window.p0.mode === 'check');
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const dayDate = (day) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(day || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
  /** K.today(ms) -> this phone's date 'YYYY-MM-DD' (local time). K.addDays(day, n) -> 'YYYY-MM-DD'. K.daysFrom(a, b) -> whole days from a to b. */
  K.today = (t) => { const d = t == null ? new Date() : new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  K.addDays = (day, n) => { const d = dayDate(day); if (!d) return null; d.setDate(d.getDate() + Math.round(+n || 0)); return K.today(d.getTime()); };
  K.daysFrom = (a, b) => { const x = dayDate(a), y = dayDate(b); return x && y ? Math.round((y - x) / 864e5) : null; };
  K.isDay = (day) => !!dayDate(day) && K.today(dayDate(day).getTime()) === day;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** K.dayName('2026-10-30') -> 'Friday' (short: 'Fri'). K.dayLabel(day) -> 'Fri Oct 30'. */
  K.dayName = (day, short) => { const d = dayDate(day); if (!d) return ''; const n = DAYS[d.getDay()]; return short ? n.slice(0, 3) : n; };
  K.dayLabel = (day) => { const d = dayDate(day); return d ? DAYS[d.getDay()].slice(0, 3) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate() : ''; };
  /** K.calendar(n) -> 'Today is Saturday, 2026-10-24. The next days: Sun 2026-10-25, Mon 2026-10-26, ...' (n days, 21 by default). Put it in a
      prompt whenever Juli must turn words like "this Friday" into dates: a small model gets dates right with a calendar to read. */
  K.calendar = (n) => { const t = K.today(), out = []; for (let i = 1; i <= clamp(n || 21, 1, 60); i++) { const d = K.addDays(t, i); out.push(K.dayName(d, true) + ' ' + d); } return 'Today is ' + K.dayName(t) + ', ' + t + '. The next days: ' + out.join(', ') + '.'; };
  /** K.json(text) -> the first JSON object in a model's answer, or null. */
  K.json = (text) => { try { const s = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, ''); const a = s.indexOf('{'), b = s.lastIndexOf('}'); return a < 0 || b < a ? null : JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; } };
  /** await K.ask(prompt, {json}) -> Juli's answer, made on this phone (needs permissions.juli ["ask"]): text, or with {json: true} an object
      (null when the answer was not JSON). ONLY in a check (p0.mode 'check'): Juli never works while the app is open, because the phone's
      memory goes to the open app. In the open app, save the person's request in the notebook; a task answers it in the next check, which
      comes right after the app closes. Throws when Juli can't answer (open app, not downloaded, busy, too many questions): keep a way to
      work without her. */
  K.ask = async (prompt, o) => {
    o = o || {}; if (!window.p0 || !window.p0.juli) throw Object.assign(new Error('Juli is only there inside p0pc0rn'), { code: 'NO_JULI' });
    if (window.p0.mode !== 'check') throw Object.assign(new Error("Juli works in the app's checks, after it closes"), { code: 'OPEN_APP' });
    const a = await window.p0.juli.ask(String(prompt), { json: !!o.json });
    return o.json ? K.json(a) : String(a == null ? '' : a);
  };
  /** K.facts(text, data) -> {ok, missing}: every number written in text also appears somewhere in data (any JSON). Put Juli's words through it
      before you show or keep them: a line with a reading the source never gave is dropped, never shown. */
  const nums = (s) => (String(s).match(/\d+(?:\.\d+)?/g) || []).map((x) => String(+x));
  K.facts = (text, data) => { const have = new Set(nums(JSON.stringify(data == null ? '' : data))); const miss = [...new Set(nums(text).filter((x) => !have.has(x)))]; return { ok: !miss.length, missing: miss }; };

  /** K.notebook(name, {max}) -> the agent's memory, kept on this phone (K.save). Every entry sits on one shelf:
        'confirmed'  only the person puts things here (nb.confirm, in the open app; an unseen check can't)
        'suspected'  the app's own guesses, findings and Juli's words, each with its evidence
        'grounding'  facts from a source, with where and when they came from
        'dismissed'  the person's no (nb.dismiss): kept so the same thing is not raised again unless it changes
      entry = {id, key, shelf, kind, title, text, data, evidence: [{source, at, note}], review, until, at, upd}. review: true puts a suspected
      entry in the review queue (nb.review()); until (ms) lets it expire. */
  const SHELF_APP = ['suspected', 'grounding'];
  K.notebook = (name, no) => {
    no = no || {}; const KEY = 'nb.' + String(name || 'main').replace(/[^\w-]/g, '').slice(0, 40), MAX = clamp(Math.round(no.max || 400), 20, 2000);
    let st = K.load(KEY, null); if (!st || !Array.isArray(st.e)) st = { v: 1, e: [] };
    const rid = () => Math.random().toString(36).slice(2, 9) + (Date.now() % 1e6).toString(36);
    const s = (v, n) => (v == null ? '' : String(v)).slice(0, n);
    const clean = (f) => {
      const o = {};
      if (f.key != null) o.key = s(f.key, 120);
      if (f.kind != null) o.kind = s(f.kind, 40);
      if (f.title != null) o.title = s(f.title, 120);
      if (f.text != null) o.text = s(f.text, 2000);
      if (f.data !== undefined) { const j = JSON.stringify(f.data); if (j && j.length > 40000) throw new Error('notebook data over 40 KB'); o.data = j == null ? null : JSON.parse(j); }
      if (f.evidence != null) o.evidence = (Array.isArray(f.evidence) ? f.evidence : [f.evidence]).slice(0, 8).map((v) => ({ source: s(v && v.source, 60), at: +(v && v.at) || null, note: s(v && v.note, 200) }));
      if (f.review != null) o.review = !!f.review;
      if (f.until !== undefined) o.until = f.until == null ? null : +f.until || null;
      return o;
    };
    const find = (x) => { if (x && typeof x === 'object') x = x.id; return st.e.find((e) => e.id === x) || st.e.find((e) => e.key != null && e.key === x) || null; };
    const trim = (hard) => {
      const t = Date.now(); st.e = st.e.filter((e) => !(e.until && e.until < t));
      const cap = hard ? Math.floor(st.e.length * 0.75) : MAX;
      while (st.e.length > cap) {   // the oldest grounding first, then the oldest suspected; confirmed entries stay
        const by = (sh) => { let i = -1; st.e.forEach((e, j) => { if (e.shelf === sh && (i < 0 || e.upd < st.e[i].upd)) i = j; }); return i; };
        const i = [by('grounding'), by('dismissed'), by('suspected')].find((j) => j >= 0); if (i == null) break; st.e.splice(i, 1);
      }
    };
    const save = () => { if (K.save(KEY, st)) return true; trim(true); return K.save(KEY, st); };
    const nb = {
      name: KEY.slice(3),
      /** nb.add(fields) -> the new entry (shelf 'suspected' unless {shelf: 'grounding'}) */
      add(f) {
        f = f || {}; if (f.shelf && !SHELF_APP.includes(f.shelf)) throw Object.assign(new Error('only the person confirms or dismisses (nb.confirm / nb.dismiss)'), { code: 'NOT_ALLOWED' });
        const t = Date.now(), e = Object.assign({ id: rid(), shelf: f.shelf || 'suspected', review: false, at: t, upd: t }, clean(f)); st.e.push(e); trim(); save(); return e;
      },
      /** nb.put(key, fields) -> add or update the entry with this key. {shelf: 'suspected' | 'grounding'} moves it (a dismissed one comes back
          only this way, when something changed); a confirmed entry keeps its shelf. */
      put(key, f) {
        f = f || {}; const e = find(key); if (!e) return nb.add(Object.assign({}, f, { key }));
        if (f.shelf && !SHELF_APP.includes(f.shelf)) throw Object.assign(new Error('only the person confirms or dismisses (nb.confirm / nb.dismiss)'), { code: 'NOT_ALLOWED' });
        Object.assign(e, clean(f), { upd: Date.now() }); if (f.shelf && e.shelf !== 'confirmed') e.shelf = f.shelf; save(); return e;
      },
      get: (x) => find(x),
      /** nb.list(shelf, kind) -> entries (newest change first); shelf or kind null = any */
      list: (shelf, kind) => st.e.filter((e) => (!shelf || e.shelf === shelf) && (!kind || e.kind === kind)).sort((a, b) => b.upd - a.upd),
      /** nb.review() -> what waits for the person's eye: suspected entries with review: true, newest first */
      review: () => st.e.filter((e) => e.shelf === 'suspected' && e.review).sort((a, b) => b.upd - a.upd),
      /** nb.confirm(x, fields) - the person's yes (in the open app only) */
      confirm(x, f) {
        if (inCheck()) throw Object.assign(new Error('only the person confirms (from a tap in the open app)'), { code: 'NOT_ALLOWED' });
        const e = find(x); if (!e) return null; Object.assign(e, clean(f || {}), { shelf: 'confirmed', review: false, upd: Date.now() }); save(); return e;
      },
      /** nb.dismiss(x) - the person's no (in the open app only) */
      dismiss(x) {
        if (inCheck()) throw Object.assign(new Error('only the person dismisses (from a tap in the open app)'), { code: 'NOT_ALLOWED' });
        const e = find(x); if (!e) return null; e.shelf = 'dismissed'; e.review = false; e.upd = Date.now(); save(); return e;
      },
      /** nb.remove(x) - delete an entry (housekeeping is fine in a check) */
      remove(x) { const e = find(x); if (!e) return false; st.e = st.e.filter((y) => y !== e); save(); return true; },
      /** nb.prune() - drop expired entries and keep at most `max` (oldest grounding first) */
      prune() { trim(); save(); },
      get all() { return st.e.slice(); },
      get size() { return JSON.stringify(st).length; },
    };
    return nb;
  };

  /** K.agent({goal, tasks: [{id, every, run}], budgetS}) - the agent loop. Call it once at the top level of sketch.js (outside setup()); it
      registers p0.onCheck for you. On each check the host makes (on-open, interval) it runs every task whose `every` minutes have passed, in
      order, while time is left (budgetS: 20 s unless you say; at most 100 s, for an agentic app whose host check allows 110 s); a task with due() -> true (work waiting, e.g. a request the person left) runs at
      the next check whatever its `every`. A task is async (ctx) => ({active}); return {active: true} while something is going on (the host
      then checks again sooner). ctx = {mode: 'check' | 'run', log(text), left() -> seconds left, first}.
      K.agent.run(id) runs one task now, whatever its `every` (in the open app, right after the person adds something); K.agent.run() runs all.
      K.agent.logs() -> [{at, text, n}], newest first (n = the same line that many times in a row): what the agent did. Show it: people
      should be able to see what an agent does. */
  const AG = { goal: '', tasks: [], budget: 80, busy: null }, AKEY = 'agent.v1';
  const agState = () => { const v = K.load(AKEY, null); return v && typeof v === 'object' ? Object.assign({ last: {}, log: [] }, v) : { last: {}, log: [] }; };
  const agLog = (text) => {   // the same line again (a quiet "nothing new") moves up with a count instead of filling the log
    text = String(text).replace(/\s+/g, ' ').slice(0, 160); const st = agState(), top = st.log[0];
    if (top && top.text === text) { top.at = Date.now(); top.n = (top.n || 1) + 1; } else st.log.unshift({ at: Date.now(), text });
    st.log = st.log.slice(0, 60); K.save(AKEY, st);
  };
  async function agRun(only, force) {
    while (AG.busy) { try { await AG.busy; } catch (e) { /* */ } }
    const job = (async () => {
      const t0 = Date.now(), left = () => AG.budget - (Date.now() - t0) / 1000; let active = false, ran = 0;
      for (const t of AG.tasks) {
        if (only && t.id !== only) continue;
        const last = agState().last[t.id] || 0;
        let due = false; try { due = !!(t.due && t.due()); } catch (e) { /* not due */ }
        if (!force && !due && Date.now() - last < t.every * 60e3) continue;
        if (left() < 2) break;
        let r = null;
        try { r = await t.run({ mode: window.p0 ? window.p0.mode : 'run', log: agLog, left, first: !last }); }
        catch (e) { agLog(t.id + ' stopped: ' + String((e && e.message) || e).slice(0, 100)); }
        const st = agState(); st.last[t.id] = Date.now(); K.save(AKEY, st); ran++;
        if (r && r.active) active = true;
      }
      return { active, ran };
    })();
    AG.busy = job;
    try { return await job; } finally { if (AG.busy === job) AG.busy = null; }
  }
  K.agent = (o) => {
    o = o || {}; AG.goal = String(o.goal || '').slice(0, 140); AG.budget = clamp(+o.budgetS || 20, 5, 100);   // a live app's check gets 25 s, an agentic app's 110 s
    AG.tasks = (o.tasks || []).filter((t) => t && typeof t.run === 'function').map((t) => ({ id: String(t.id || 'task').slice(0, 30), every: clamp(+t.every || 0, 0, 10080), run: t.run, due: typeof t.due === 'function' ? t.due : null }));
    if (window.p0 && typeof window.p0.onCheck === 'function') window.p0.onCheck(() => agRun(null, false));
    return K.agent;
  };
  K.agent.run = (id) => agRun(id || null, true);
  K.agent.log = agLog;
  K.agent.logs = () => agState().log;
  K.agent.last = (id) => agState().last[id] || 0;
  K.agent.busy = () => !!AG.busy;

  /** K.review(id, x, y, w, entries, {yes, no, ask, color, extra, extraH, max}) -> {h, act}. The review queue: one card per entry - its title,
      text and evidence ('source · 2 h ago'), then buttons. yes(e) / no(e) -> a button label or null (defaults 'Confirm' / 'Not this'); ask(e) ->
      true for an 'Ask' button; color(e) -> the card's stripe; extraH(e, w) + extra(e, x, y, w) draw your own part (choices) under the text.
      act = {entry, action: 'yes' | 'no' | 'ask'} in the frame a button is tapped, else null. Answer 'yes' with nb.confirm, 'no' with nb.dismiss. */
  K.review = (id, x, y, w, list, o) => {
    o = o || {}; const y0 = y; let act = null;
    for (const e of (list || []).slice(0, o.max || 8)) {
      const yes = o.yes ? o.yes(e) : 'Confirm', no = o.no ? o.no(e) : 'Not this', ask = o.ask ? !!o.ask(e) : false, tw = w - 32;
      const th = e.text ? K.paraHeight(e.text, tw, 'footnote', { maxLines: 6 }) : 0;
      const ev = (e.evidence || []).slice(0, 2).map((v) => v.source + (v.at ? ' · ' + K.fmt.ago(v.at) : '')).join('   ');
      const xh = o.extraH ? Math.max(0, +o.extraH(e, tw) || 0) : 0, bs = [yes && ['yes', yes, 'primary'], no && ['no', no, 'secondary'], ask && ['ask', 'Ask', 'tinted']].filter(Boolean);
      const h = 44 + (th ? th + 6 : 0) + (ev ? 18 : 0) + xh + (bs.length ? 56 : 8);
      K.card(x, y, w, h, { r: 16 });
      K.rect(x, y + 12, 4, h - 24, { fill: o.color ? o.color(e) || K.C.accent : K.C.accent, r: 2 });
      let yy = y + 16;
      K.text(e.title || '', x + 16, yy + 16, 'headline', K.C.text, { maxW: tw }); yy += 26;
      if (th) { K.para(e.text, x + 16, yy + 2, tw, 'footnote', K.C.text2, { maxLines: 6 }); yy += th + 6; }
      if (ev) { K.text(ev, x + 16, yy + 12, 'caption', K.C.text3, { maxW: tw }); yy += 18; }
      if (xh && o.extra) { o.extra(e, x + 16, yy, tw); yy += xh; }
      const bw = bs.length ? (tw - 8 * (bs.length - 1)) / bs.length : 0;
      bs.forEach((b, j) => { if (K.button(id + ':' + e.id + ':' + b[0], x + 16 + j * (bw + 8), yy + 6, bw, 40, b[1], { style: b[2] })) act = { entry: e, action: b[0] }; });
      y += h + 10;
    }
    return { h: y - y0, act };
  };

  // ------------------------------------------------------------------ iCompiler parity (the iOS "Processing & p5.js iCompiler" app)
  // v1.3: the iCompiler's page base IS <project>/data/ ('data/x.png' there = data/data/x.png); K.path(p) drops that 'data/' prefix there only
  K.icompiler = (() => { try { return /\/data\/$/.test(String(document.baseURI || '')); } catch (e) { return false; } })();
  K.path = (p) => (Array.isArray(p) ? p.map(K.path) : (K.icompiler && typeof p === 'string' ? p.replace(/^(\.\/)?data\//, '') : p));
  // v1.3: in the iCompiler p5's file loaders take their path through K.path, so apps keep writing 'data/x.png' (nothing changes elsewhere)
  try { if (K.icompiler && window.p5 && p5.prototype) for (const f of ['loadImage', 'loadSound', 'loadJSON', 'loadStrings', 'loadFont', 'loadTable', 'loadBytes', 'loadModel', 'loadXML', 'loadShader', 'createImg', 'createVideo', 'createAudio']) { const orig = p5.prototype[f]; if (typeof orig !== 'function' || orig.__kitPath) continue; const w = function () { const a = Array.prototype.slice.call(arguments); a[0] = K.path(a[0]); if (f === 'loadShader') a[1] = K.path(a[1]); return orig.apply(this, a); }; w.__kitPath = true; p5.prototype[f] = w; } } catch (e) { /* the loaders stay as they are */ }

  // ------------------------------------------------------------------ setup, safe area, scroll lock, errors
  function measureSafe() {
    try {
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);visibility:hidden;pointer-events:none';
      document.body.appendChild(d); const cs = getComputedStyle(d);
      K.safe = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0 }; d.remove();
    } catch (e) { K.safe = { top: 0, bottom: 0, left: 0, right: 0 }; }
    if (K.safe.top < 20 && /iPhone|iPad/.test(navigator.userAgent || '')) K.safe.top = Math.max(K.safe.top, 20);
  }
  function lockScrolling() {
    try {
      const b = document.body.style, h = document.documentElement.style; b.margin = '0'; b.overflow = 'hidden'; b.overscrollBehavior = 'none'; b.webkitUserSelect = 'none'; b.userSelect = 'none'; b.webkitTouchCallout = 'none'; b.touchAction = 'none'; h.overflow = 'hidden'; h.overscrollBehavior = 'none'; b.background = K.C.bg;
      document.addEventListener('touchmove', e => { if (!(e.target && e.target.tagName === 'INPUT')) e.preventDefault(); }, { passive: false });
      document.addEventListener('gesturestart', e => e.preventDefault());
      document.addEventListener('dblclick', e => e.preventDefault());
      const cv = document.querySelector('canvas'); if (cv) { cv.style.touchAction = 'none'; cv.style.display = 'block'; }
    } catch (e) { /* ignore */ }
  }
  K.errors = [];
  window.addEventListener('error', (e) => { try { K.errors.push(String((e && e.message) || e) + (e && e.lineno ? ' (line ' + e.lineno + ')' : '')); if (K.errors.length > 3) K.errors.shift(); } catch (x) { /* ignore */ } });
  function drawErrors() {
    if (!K.errors.length) return; const y = K.H - 150 - K.safe.bottom;
    K.rect(12, y, K.W - 24, 132, { r: 16, fill: 'rgba(40,6,10,0.94)', stroke: '#ff453a', elev: 3 });
    K.text('Something broke', 28, y + 30, 'headline', '#ff8a80');
    K.para(K.errors[K.errors.length - 1], 28, y + 38, K.W - 56, 'footnote', '#ffd7d4', { maxLines: 4 });
    if (K.tapIn(12, y, K.W - 24, 132)) K.errors = [];
  }
  /** K.setup({mode, accent, bg, ..., density}) - call first in setup(): canvas at full screen, theme, safe area, scroll lock, input. */
  K.setup = (o) => {
    o = o || {};
    if (o.canvas !== false && (typeof width !== 'number' || width !== windowWidth || height !== windowHeight)) createCanvas(windowWidth, windowHeight);   // p5's default canvas is 100x100
    try { pixelDensity(Math.min(o.density || 2, displayDensity())); } catch (e) { /* ignore */ }
    K.theme(o); K.W = width; K.H = height; measureSafe(); K.navBar.barH = K.safe.top + 50; lockScrolling(); installInput(); ctlReset();
    try { textFont(K.FONT); } catch (e) { /* ignore */ }
    window.addEventListener('resize', () => { try { resizeCanvas(windowWidth, windowHeight); K.W = width; K.H = height; measureSafe(); } catch (e) { /* ignore */ } });
    K._ready = true; return K;
  };

  // ------------------------------------------------------------------ the frame hooks
  let lastPre = -1, lastPost = -1;
  K.begin = () => {
    if (lastPre === window.frameCount) return; lastPre = window.frameCount;
    const ms = Math.min(Math.max(window.deltaTime || 16.7, 1), 60); K.ms = ms; K.dt = ms / 1000; K.t += K.dt; K.frame++;
    K.gdt = performance.now() < hitstopUntil ? 0 : K.dt * K.timeScale;   // gameplay dt: 0 during hitstop
    if (typeof width === 'number') { K.W = width; K.H = height; }
    ctlReset(); stepInput(); stepTweens(ms); stepSprings(K.dt);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - K.dt);
  };
  K.end = () => {
    if (lastPost === window.frameCount) return; lastPost = window.frameCount;
    drawToasts();
    if (flashA > 0 && flashCol) { K.rect(0, 0, K.W, K.H, { r: 0, fill: K.alpha(flashCol, 0.55 * flashA) }); flashA = Math.max(0, flashA - K.ms / flashMs); }
    drawErrors();
    try { if (window.__controls) window.__controls.screen = K.sceneName || ''; } catch (e) { /* ignore */ }
  };
  try { if (window.p5 && p5.prototype.registerMethod) { p5.prototype.registerMethod('pre', function () { if (K._ready) K.begin(); }); p5.prototype.registerMethod('post', function () { if (K._ready) K.end(); }); } } catch (e) { /* the sketch can call K.begin()/K.end() itself */ }
  return K;
})();
