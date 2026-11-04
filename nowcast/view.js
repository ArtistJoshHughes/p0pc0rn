// nowcast/view.js - the Nowcast screen: a full-screen map with two layers on one timeline - the NOAA radar up to now (left of Now) and
// the nowcast from the model on this phone (right of Now, marked "Nowcast · Experimental") - a legend bar on top, a timeline card at
// the bottom (play / pause, a scrubber with ticks every 10 minutes and bigger ones every 30), Layers on the left, Search and Locate on
// the right, NWS warnings drawn on the map and in a banner, and a place's forecast sheet (a tap on a city, or a long press anywhere).
// The fine print (follow the NWS, Experimental, how accurate, credits) is behind the card's "?"; city names keep out from under the controls.
// Nothing runs by itself: the radar loads when the screen opens, a nowcast runs when the person asks (through the app's job queue).
import { createMap, paint } from './map.js';
import { decodeLines } from './lines.js';
import { createRadar } from './radar.js';
import { createNws, NWS_LINE, OFFICIAL } from './nws.js';
import { codeLut, chanceLut, levelOf, RAIN, SNOW, CHANCE, cssOf } from './colors.js';
import { boxProjection, inConus } from './regrid.js';
import { summaryAt, pixelOf, outlines, THRESHOLDS } from './run.js';
import { radarLine, radarAge, clockShort } from './summary.js';
import { recentRun, getRun } from './store.js';
import { icon, weatherIcon } from './icons.js';
import { DGMR } from './model.js';
import { SKILL } from './skill.js';
import { createClouds, CLOUD_CREDIT } from './clouds.js';

const LS_KEY = 'p0pc0rn:nowcast:view';
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; } };
const lsSet = (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(lsGet(), v))); } catch (e) { /* private mode */ } };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (cls, label, ic) => { const b = mk('button', cls); b.type = 'button'; if (ic) b.append(icon(ic)); if (label) b.append(mk('span', null, label)); return b; };
const MB = (b) => `${(b / 1e6).toFixed(b >= 1e7 ? 0 : 1)} MB`;
const clock = (t) => { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return new Date(t).toISOString().slice(11, 16); } };
const dark = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return true; } };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const DATA_LINES = new URL('./data/us_lines.bin', import.meta.url).href;
export const ATTRIB = 'Radar: NOAA MRMS · Basemap: NASA GIBS · Places: US Census · Nowcast: DeepMind DGMR (CC BY 4.0), modified';
const attribOf = (on) => (on ? ATTRIB.replace(' · Places', ` · ${CLOUD_CREDIT} · Places`) : ATTRIB);

/** app: { root, ready(), sizeOf(), download(), dl(), run({lat, lon, label, wide, members}, onProgress) -> Promise<run id>, geo(), homeZip(),
 *  position(), searchPlaces(geo, q, n), toast, diag, home() } -> { open(o), close(), shown } */
export function createNowcastView(app) {
  const root = app.root; root.classList.add('nc'); root.textContent = '';
  const radar = app.radar || createRadar({ diag: app.diag }), nws = createNws();
  const S = { place: null, av: null, plan: null, frames: new Map(), idx: -1, items: [], playing: false, timer: 0, run: null, running: null, open: false,
    layers: Object.assign({ radar: true, nowcast: true, type: true, warnings: true, clouds: false }, lsGet().layers || {}), mode: lsGet().mode || 'rate', thr: lsGet().thr || 4,
    members: lsGet().members || DGMR.ensemble.members, wide: !!lsGet().wide, loopMin: lsGet().loopMin || 60, warnings: [], alerts: [], places: null, loadedAt: 0, err: null };
  const LUT = codeLut(), CLUT = chanceLut();
  const clouds = createClouds({ onTile: () => map.draw() });
  let leaving = false; addEventListener('pagehide', () => { leaving = true; if (radar.abort) radar.abort(); });   // a reload or a closed page: its fetches stop, and are not failures
  // ---------------------------------------------------------------------------------------------- the DOM
  const canvas = mk('canvas', 'nc-map'); canvas.setAttribute('aria-label', 'Rain map');
  const top = mk('div', 'nc-top'), back = btn('nc-round nc-back', null, 'back'); back.setAttribute('aria-label', 'Home Screen');
  const legend = mk('div', 'nc-legend'), lgRain = mk('canvas', 'nc-ramp'), lgSnow = mk('canvas', 'nc-ramp'), lgTxt = mk('div', 'nc-lg-txt');
  const lgRow1 = mk('div', 'nc-lg-row'), lgRow2 = mk('div', 'nc-lg-row'), lgQc = mk('div', 'nc-lg-qc', '◌ low radar confidence'); lgQc.hidden = true;
  lgRow1.append(mk('span', 'nc-lg-name', 'Rain'), lgRain); lgRow2.append(mk('span', 'nc-lg-name', 'Snow'), lgSnow); legend.append(lgRow1, lgRow2, lgTxt, lgQc);
  top.append(back, legend);
  const left = mk('div', 'nc-side nc-left'), layersB = btn('nc-round', null, 'layers'); layersB.setAttribute('aria-label', 'Layers'); left.append(layersB);
  const right = mk('div', 'nc-side nc-right'), searchB = btn('nc-round', null, 'search'), locB = btn('nc-round', null, 'locate');
  searchB.setAttribute('aria-label', 'Search for a place'); locB.setAttribute('aria-label', 'Show my location'); right.append(searchB, locB);
  const card = mk('div', 'nc-card'), warn = mk('button', 'nc-warn'); warn.type = 'button'; warn.hidden = true;
  const head = mk('div', 'nc-head'), placeEl = mk('p', 'nc-place'), radarEl = mk('button', 'nc-radar'); radarEl.type = 'button';
  const infoB = mk('button', 'nc-info', '?'); infoB.type = 'button'; infoB.setAttribute('aria-label', 'About this map: warnings, accuracy and credits');
  head.append(placeEl, radarEl, infoB);
  const sumEl = mk('p', 'nc-sum'), noteEl = mk('p', 'nc-note footnote'), action = mk('div', 'nc-action');
  const tl = mk('div', 'nc-tl'), play = btn('nc-play', null, 'play'), track = mk('div', 'nc-track'), ticks = mk('div', 'nc-ticks'), thumb = mk('i', 'nc-thumb'), nowM = mk('i', 'nc-now');
  const tlab = mk('p', 'nc-tlab');
  play.setAttribute('aria-label', 'Play'); track.setAttribute('role', 'slider'); track.setAttribute('aria-label', 'Time'); track.tabIndex = 0;
  track.append(ticks, nowM, thumb); tl.append(play, track);
  card.append(warn, head, sumEl, noteEl, action, tl, tlab);
  const sheet = mk('div', 'nc-sheet'), sheetBox = mk('div', 'nc-sheet-box'), sheetBody = mk('div', 'nc-sheet-body'), sheetX = btn('nc-round nc-sheet-x', null, 'close');
  sheetX.setAttribute('aria-label', 'Close'); sheet.hidden = true; sheetBox.append(sheetX, sheetBody); sheet.append(sheetBox);
  root.append(canvas, top, left, right, card, sheet);

  const map = createMap(canvas, { dark, onTap: (e) => openForecast({ lat: e.lat, lon: e.lon, label: `${e.name}, ${e.st}` }), onLongPress: (lat, lon) => openForecast({ lat, lon, label: null }), onMove: (m) => moved(m), avoid: controlBoxes });
  // city names and dots stay out from under the buttons, the legend and the card (their boxes in the map's own pixels, read each frame)
  function controlBoxes() {
    const c = canvas.getBoundingClientRect(), out = [];
    for (const el of [back, legend, layersB, searchB, locB, card]) { const r = el.getBoundingClientRect(); if (r.width && r.height) out.push({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height }); }
    return out;
  }
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => map.draw()); ro.observe(card); ro.observe(legend); }
  // close in, away from the place: the 1 km crop follows the map's centre (the frames are read again from this page's copies)
  let moveT = 0;
  function moved(m) {
    if (!S.open || m.z < 6.8 || !S.cropBox) return;
    const b = S.cropBox, la1 = 54.995, lo1 = -129.995, r = (la1 - m.lat) / 0.01, c = (m.lon - lo1) / 0.01;
    if (r > b.r0 + 120 && r < b.r1 - 120 && c > b.c0 + 150 && c < b.c1 - 150) return;
    clearTimeout(moveT); moveT = setTimeout(() => { S.cropAt = { lat: map.state.lat, lon: map.state.lon }; loadRadar(false, true); }, 700);
  }
  function ramp(c, stops, to) {
    const w = 160, h = 10; c.width = w * 2; c.height = h * 2; const g = c.getContext('2d');
    for (let x = 0; x < w * 2; x++) { const v = stops[0][0] * (to / stops[0][0]) ** (x / (w * 2 - 1)); g.fillStyle = cssOf(stops, v); g.fillRect(x, 0, 1, h * 2); }
  }
  function paintLegend(chance) {
    legend.classList.toggle('chance', !!chance);
    if (chance) { ramp(lgRain, CHANCE, 1); lgRow1.firstChild.textContent = `Chance over ${S.thr} mm/h`; lgRow2.hidden = true; lgTxt.textContent = '10%  ·  50%  ·  100%'; return; }
    ramp(lgRain, RAIN, 100); ramp(lgSnow, SNOW, 10); lgRow1.firstChild.textContent = 'Rain'; lgRow2.hidden = !S.layers.type; lgTxt.textContent = 'Light  ·  Moderate  ·  Heavy';
  }

  // ---------------------------------------------------------------------------------------------- data
  async function loadStatic() {
    if (!map.get('lines')) { try { map.set('lines', decodeLines(await (await fetch(DATA_LINES)).arrayBuffer())); } catch (e) { app.diag('nowcast: lines', { message: String(e.message || e).slice(0, 80) }); } }
    if (!S.places) {
      try {
        const geo = await app.geo(); const all = [];
        for (const l of geo.places.values()) for (const e of l) if (e.st !== 'AK' && e.st !== 'HI' && e.st !== 'PR') all.push(e);
        S.places = all.sort((a, b) => b.w - a.w); S.geo = geo; map.set('places', S.places);
      } catch (e) { S.places = []; }
    }
  }
  async function where(o) {
    if (o && o.lat != null) return { lat: o.lat, lon: o.lon, label: o.label || 'This place' };
    const v = lsGet(); if (v.place) return v.place;
    try { const z = app.homeZip(), geo = S.geo || (await app.geo()); const e = z && geo.zcta.find(z); if (e) return { lat: e.lat, lon: e.lon, label: `ZIP ${e.zip}` }; } catch (e) { /* */ }
    try { const p = await app.position(); if (p) return { lat: p.lat, lon: p.lon, label: 'Your location' }; } catch (e) { /* */ }
    return null;
  }
  const nearest = (lat, lon) => {
    let best = null, bd = Infinity; const kx = Math.cos(lat * Math.PI / 180);
    for (const e of S.places || []) { const d = (e.lat - lat) ** 2 + ((e.lon - lon) * kx) ** 2; if (d < bd) { bd = d; best = e; } }
    return best && Math.sqrt(bd) * 111 < 15 ? `near ${best.name}, ${best.st}` : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  };
  async function loadRadar(fresh = false, recrop = false) {
    const now = Date.now();
    try {
      S.av = await radar.available(now, 110, { fresh: fresh || !S.av || now - (S.av.newest || 0) > 4 * 60e3 });
      S.err = null;
    } catch (e) { S.err = 'NOAA radar could not be reached. Check the connection and try again.'; render(); return; }
    S.plan = radar.loopPlan(S.av, { minutes: S.loopMin, step: 10, typed: S.layers.type });
    S.loadedAt = now; buildItems(); render();
    const crop = cropFor(S.cropAt || S.place); S.cropBox = crop;
    if (recrop) for (const [t, f] of S.frames) if (f.cropKey !== (crop && crop.key)) S.frames.delete(t);
    for (const t of S.plan.times.slice().reverse()) {   // the newest first: it shows at once
      if (S.frames.has(t) && S.frames.get(t).cropKey === (crop && crop.key)) continue;
      try { const f = await radar.frame(t, { typed: S.layers.type, flags: S.av.flag, crop, rqi: S.plan.rqi }); f.cropKey = crop && crop.key; S.frames.set(t, f); }
      catch (e) { if (!leaving && !(e && (e.name === 'AbortError' || e.code === 'ABORTED'))) app.diag('nowcast: radar frame', { message: String(e.message || e).slice(0, 80) }); }
      if (!S.open) return;
      if (S.idx < 0 || S.items[S.idx] && S.items[S.idx].t === t) show(S.idx < 0 ? nowIndex() : S.idx); else renderTl();
    }
    for (const t of [...S.frames.keys()]) if (!S.plan.times.includes(t)) S.frames.delete(t);
  }
  /** the native 1 km crop around the place (about 600 x 700 km), for close zooms */
  function cropFor(p) {
    if (!p || !S.frames || !inConus(p.lat, p.lon)) return null;
    const la1 = 54.995, lo1 = -129.995, d = 0.01, r = Math.round((la1 - p.lat) / d), c = Math.round((p.lon - lo1) / d);
    return { r0: r - 300, r1: r + 300, c0: c - 360, c1: c + 360, key: `${r},${c}` };
  }
  /** a frame's quality marks for the map: rings around isolated specks, hatching (every third diagonal) over low-quality radar */
  function qcLayer(f) {
    if (!f.qc || !f.cropBox) return null;
    const b = f.cropBox, m = f.meta, w = b.c1 - b.c0 + 1, h = b.r1 - b.r0 + 1;
    let hatch = null;
    if (f.qc.low) {
      if (f.qc.lowN == null) { let n = 0; for (const v of f.qc.low) n += v; f.qc.lowN = n; }
      if (f.qc.lowN) {
        const c = f.hatchCanvas || Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d'), im = g.createImageData(w, h), d = new Uint32Array(im.data.buffer);
        const ink = dark() ? 0x99ffffff : 0x99202028;   // ABGR (little-endian ImageData)
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f.qc.low[y * w + x] && (x + y) % 3 === 0) d[y * w + x] = ink;
        g.putImageData(im, 0, 0); f.hatchCanvas = c;
        hatch = { canvas: c, top: m.la1 + m.dj / 2 - b.r0 * m.dj, left: m.lo1 - 360 - m.di / 2 + b.c0 * m.di, dlat: m.dj, dlon: m.di, rows: h, cols: w };
      }
    }
    return { rings: f.qc.speckle, hatch };
  }
  async function cloudsOn() {
    try { await clouds.prepare(map.state.lat, map.state.lon); } catch (e) { app.toast('The satellite clouds could not be reached.'); return; }
    if (S.items[S.idx] && S.items[S.idx].kind === 'radar') show(S.idx);
  }
  async function loadWarnings() {
    if (!S.layers.warnings) { map.set('warnings', []); return; }
    try { S.warnings = await nws.warnings(); map.set('warnings', S.warnings); } catch (e) { S.warnings = []; }
    if (S.place) { try { S.alerts = await nws.at(S.place.lat, S.place.lon); } catch (e) { S.alerts = []; } }
    render();
  }
  async function loadRun() {
    if (!S.place) return;
    const r = (S.run && pixelOf(S.run, S.place.lat, S.place.lon) && Date.now() - S.run.t0 < 25 * 60e3) ? S.run
      : await recentRun(S.place.lat, S.place.lon, { covers: (x, la, lo) => !!pixelOf(x, la, lo) });
    setRun(r);
  }
  function setRun(r) {
    S.run = r || null;
    map.set('outlines', r ? outlines(r).map((c) => ({ corners: c })) : []);
    buildItems(); if (S.open) show(S.idx >= 0 && S.items[S.idx] ? S.idx : nowIndex()); render();
  }

  // ---------------------------------------------------------------------------------------------- the timeline
  function buildItems() {
    const it = [];
    if (S.layers.radar && S.plan) for (const t of S.plan.times) it.push({ t, kind: 'radar' });
    const newest = S.plan && S.plan.times.length ? S.plan.times[S.plan.times.length - 1] : 0;
    if (!S.layers.radar && newest) it.push({ t: newest, kind: 'radar', hidden: true });
    if (S.layers.nowcast && S.run) S.run.mean && Array.from({ length: S.run.spec.frames }, (_, k) => k).forEach((k) => { const t = S.run.t0 + (S.run.spec.firstMin + k * S.run.spec.everyMin) * 60e3; if (t > newest) it.push({ t, kind: 'nowcast', k }); });
    const cur = S.items[S.idx]; S.items = it;
    S.idx = cur ? Math.max(0, it.findIndex((x) => x.t === cur.t && x.kind === cur.kind)) : -1;
  }
  const nowIndex = () => { let k = -1; S.items.forEach((x, i) => { if (x.kind === 'radar') k = i; }); return k; };
  const codesBuf = { a: null, n: 0 };
  function show(i) {
    if (i < 0 || !S.items.length) { map.set('rain', null); map.set('nowcast', null); renderTl(); return; }
    S.idx = Math.max(0, Math.min(S.items.length - 1, i)); const it = S.items[S.idx];
    if (it.kind === 'radar') {
      const f = S.frames.get(it.t);
      map.set('nowcast', null);
      if (f && !it.hidden) {
        const m = f.meta, coarse = { canvas: paint(f.conus, f.cw, f.ch, LUT, S.cv1), top: m.la1 + m.dj / 2, left: m.lo1 - 360 - m.di / 2, dlat: m.dj * f.step, dlon: m.di * f.step, rows: f.ch, cols: f.cw };
        S.cv1 = coarse.canvas;
        let fine = null;
        if (f.crop) { const b = f.cropBox, w = b.c1 - b.c0 + 1, h = b.r1 - b.r0 + 1; fine = { canvas: paint(f.crop, w, h, LUT, S.cv2), top: m.la1 + m.dj / 2 - b.r0 * m.dj, left: m.lo1 - 360 - m.di / 2 + b.c0 * m.di, dlat: m.dj, dlon: m.di, rows: h, cols: w }; S.cv2 = fine.canvas; }
        map.set('rain', { coarse, fine });
        map.set('qc', qcLayer(f)); lgQc.hidden = !(f.qc && (f.qc.speckle.length || f.qc.lowN));
      } else { map.set('rain', null); map.set('qc', null); lgQc.hidden = true; }
      S.cloud = null;
      if (S.layers.clouds && S.place) { S.cloud = clouds.at(it.t, map.state.lat, map.state.lon); map.set('clouds', S.cloud); } else map.set('clouds', null);
      paintLegend(false);
    } else {
      const r = S.run, n = r.size * r.size, k = it.k;
      if (codesBuf.n !== n) { codesBuf.a = new Uint8Array(n); codesBuf.n = n; }
      const c = codesBuf.a, chance = S.mode === 'chance';
      // the same colours and opacity as the radar; "Average" is the PMM (the average's pattern, the runs' own intensities: a plain
      // average of misplaced showers is a faint smear), "One possible future" one run as it came
      if (chance) { const p = r.prob[S.thr] || r.prob[THRESHOLDS[1]]; for (let q = 0; q < n; q++) c[q] = p[k * n + q] >= 26 ? p[k * n + q] : 0; }
      else { const f = (S.mode === 'one' && r.one) || r.pmm || r.mean; for (let q = 0; q < n; q++) c[q] = levelOf(f[k * n + q] / 64); }
      map.set('clouds', null); S.cloud = null; map.set('qc', null); lgQc.hidden = true;   // the future's clouds are not known
      const P = boxProjection(r.lat, r.lon, r.size, r.km), tl0 = P.toLatLon(-0.5, -0.5), br = P.toLatLon(r.size - 0.5, r.size - 0.5);
      const g = { canvas: paint(c, r.size, r.size, chance ? CLUT : LUT, S.cv3), top: tl0.lat, left: tl0.lon, dlat: (tl0.lat - br.lat) / r.size, dlon: (br.lon - tl0.lon) / r.size, rows: r.size, cols: r.size };
      S.cv3 = g.canvas; map.set('rain', null); map.set('nowcast', g); paintLegend(chance);
    }
    renderTl();
  }
  function renderTl() {
    ticks.textContent = '';
    const n = S.items.length; track.classList.toggle('empty', !n);
    if (!n) { tlab.textContent = S.err || 'Loading the radar…'; return; }
    const t0 = S.items[0].t, t1 = S.items[n - 1].t, span = Math.max(1, t1 - t0), pos = (t) => `${(100 * (t - t0) / span).toFixed(2)}%`;
    for (let t = Math.ceil(t0 / 600e3) * 600e3; t <= t1; t += 600e3) {
      const d = new Date(t), major = d.getMinutes() % 30 === 0, tk = mk('i', 'nc-tick' + (major ? ' major' : '') + (t > (S.plan && S.plan.times.length ? S.plan.times[S.plan.times.length - 1] : 0) ? ' future' : ''));
      tk.style.left = pos(t); ticks.append(tk);
      if (major) { const f = (t - t0) / span, lb = mk('span', 'nc-ticklab' + (f < 0.06 ? ' first' : f > 0.94 ? ' last' : ''), clockShort(t)); lb.style.left = pos(t); ticks.append(lb); }
    }
    const ni = nowIndex(), fut = S.items.findIndex((x) => x.kind === 'nowcast');
    nowM.hidden = ni < 0; if (ni >= 0) nowM.style.left = pos(S.items[ni].t);
    track.classList.toggle('has-future', fut >= 0);
    if (fut >= 0) track.style.setProperty('--fut', pos(S.items[fut].t)); else track.style.removeProperty('--fut');
    const it = S.items[Math.max(0, S.idx)];
    thumb.style.left = pos(it.t); thumb.classList.toggle('future', it.kind === 'nowcast');
    track.setAttribute('aria-valuetext', `${clock(it.t)}${it.kind === 'nowcast' ? ', nowcast' : ', radar'}`);
    const isNow = S.idx === ni;
    tlab.textContent = ''; tlab.classList.toggle('future', it.kind === 'nowcast'); tlab.classList.toggle('two', fut >= 0 || !!S.cloud);   // time, then what it is: one height while it plays
    if (it.kind === 'nowcast') {
      const m = Math.round((it.t - Date.now()) / 60e3);
      tlab.append(mk('b', null, `${m > 0 ? `+${m} min` : 'Now'} · ${clock(it.t)}`), mk('span', 'nc-tag', S.mode === 'chance' ? `Nowcast · Experimental · chance over ${S.thr} mm/h`
        : S.mode === 'one' || S.run.members < 2 ? 'Nowcast · Experimental · one possible future' : `Nowcast · Experimental · average of ${S.run.members} runs`));
    } else tlab.append(mk('b', null, `${isNow ? 'Now' : `${Math.round((it.t - Date.now()) / 60e3)} min`} · ${clock(it.t)}`), mk('span', 'nc-tag past', it.hidden ? 'Radar layer off' : 'Radar'),
      ...(S.cloud ? [mk('span', 'nc-tag past', `· clouds ${clock(S.cloud.t)}${S.cloud.kind === 'geo' ? '' : ' (infrared)'}`)] : []));
  }
  function seek(ev) {
    const r = track.getBoundingClientRect(), x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), n = S.items.length; if (!n) return;
    const t = S.items[0].t + x * (S.items[n - 1].t - S.items[0].t); let best = 0;
    S.items.forEach((it, i) => { if (Math.abs(it.t - t) < Math.abs(S.items[best].t - t)) best = i; });
    stop(); show(best);
  }
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); seek(e); track.onpointermove = seek; });
  track.addEventListener('pointerup', () => { track.onpointermove = null; });
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { stop(); show(S.idx + 1); } if (e.key === 'ArrowLeft') { stop(); show(S.idx - 1); } });
  function stop() { S.playing = false; clearTimeout(S.timer); play.replaceChildren(icon('play')); play.setAttribute('aria-label', 'Play'); }
  function tick() { if (!S.playing) return; show(S.idx + 1 >= S.items.length ? 0 : S.idx + 1); S.timer = setTimeout(tick, S.idx === S.items.length - 1 ? 1400 : S.items[S.idx].kind === 'nowcast' ? 420 : 650); }
  play.onclick = () => { if (S.playing) return stop(); if (!S.items.length) return; S.playing = true; play.replaceChildren(icon('pause')); play.setAttribute('aria-label', 'Pause'); tick(); };

  // ---------------------------------------------------------------------------------------------- the card
  function render() {
    if (!S.open) return;
    const p = S.place;
    placeEl.textContent = p ? p.label : 'Pick a place: search, locate, or press and hold on the map';
    const newest = S.av && S.av.newest;
    radarEl.replaceChildren(icon('refresh', 'nc-ic sm', 16), mk('span', null, newest ? radarAge(newest) : S.err ? 'radar not reached' : 'radar…'));
    radarEl.setAttribute('aria-label', `${newest ? radarLine(newest) : 'Radar'}. Load the newest radar`);
    radarEl.classList.toggle('stale', !!newest && Date.now() - newest > 15 * 60e3);
    // official warnings first
    const wl = (S.alerts || []).filter((a) => /warning/i.test(a.event));
    warn.hidden = !wl.length;
    if (wl.length) { warn.replaceChildren(icon('alert', 'nc-ic sm', 18), mk('b', null, wl[0].event), mk('span', null, wl[0].ends ? ` until ${clock(Date.parse(wl[0].ends))}` : ''), mk('span', 'nc-more', wl.length > 1 ? ` · +${wl.length - 1} more` : '')); warn.style.setProperty('--wc', wl[0].color); }
    action.textContent = ''; noteEl.textContent = ''; sumEl.textContent = '';
    if (!p) return;
    if (!inConus(p.lat, p.lon)) { sumEl.textContent = 'The nowcast covers the lower 48 states only.'; return; }
    if (S.running) {
      const r = S.running; sumEl.textContent = r.text || 'Nowcasting…';
      const bar = mk('div', 'nc-bar'), i = mk('i'); i.style.transform = `scaleX(${(r.frac || 0).toFixed(3)})`; bar.append(i); action.append(bar); return;
    }
    if (newest && Date.now() - newest > 15 * 60e3) { sumEl.textContent = `The newest NOAA radar is ${Math.round((Date.now() - newest) / 60e3)} minutes old, so no nowcast runs now. Try again in a few minutes.`; return; }
    const s = S.run ? summaryAt(S.run, p.lat, p.lon) : null;
    if (s) {
      sumEl.textContent = s.text;
      const age = Math.round((Date.now() - S.run.t0) / 60e3);
      noteEl.textContent = [`Nowcast from radar ${clock(S.run.t0)}${age > 10 ? ` (${age} min ago)` : ''} · ${S.run.members} run${S.run.members > 1 ? 's' : ''}${S.run.precision === 'int8' ? ' · low-memory model' : ''}`, s.snowNote || ''].filter(Boolean).join(' · ');
      if (wl.length) sumEl.textContent += ' Follow the warning above.';
      const again = btn('nc-btn ghost', 'Nowcast again'); again.onclick = () => nowcast(); if (age > 6) action.append(again);
      return;
    }
    if (!app.ready()) {
      const d = app.dl(), b = btn('nc-btn', d && d.running ? `Downloading · ${Math.floor(100 * (d.pct || 0))}%` : `Get the nowcast model · ${MB(app.sizeOf())}`);
      b.disabled = !!(d && d.running); b.onclick = () => offerDownload(); action.append(b);
      sumEl.textContent = 'The nowcast runs on this phone: a one-time model download first.'; return;
    }
    const b = btn('nc-btn', 'Nowcast here'); b.onclick = () => nowcast(); action.append(b);
    sumEl.textContent = wl.length ? 'Follow the warning above.' : 'The next 90 minutes of rain here, worked out on this phone.';
  }
  radarEl.onclick = () => loadRadar(true);
  warn.onclick = () => openAlert();
  infoB.onclick = () => openInfo();
  back.onclick = () => app.home();

  async function nowcast(p = S.place) {
    if (!p || S.running) return;
    if (!app.ready()) return offerDownload();
    const fresh = S.run && S.av && S.av.newest && pixelOf(S.run, p.lat, p.lon) && Math.abs(S.run.lat - p.lat) < 0.05 && Math.abs(S.run.lon - p.lon) < 0.05 && S.av.newest - S.run.t0 < 3 * 60e3;
    if (fresh) { closeSheet(); const fi = S.items.findIndex((x) => x.kind === 'nowcast'); if (fi >= 0) show(fi); app.toast('This nowcast is from the newest radar.'); return; }
    S.running = { frac: 0, text: 'Getting the newest radar…' }; render(); closeSheet();
    try {
      const id = await app.run({ lat: p.lat, lon: p.lon, label: p.label, wide: S.wide, members: S.members }, onRunProgress);
      S.running = null; const r = await getRun(id); setRun(r);
      const fi = S.items.findIndex((x) => x.kind === 'nowcast'); if (fi >= 0) show(fi);
    } catch (e) { runFailed(e); }
  }
  function onRunProgress(pr) {
        S.running = { frac: pr.frac || 0, text: pr.phase === 'radar' ? 'Getting the newest radar…' : pr.phase === 'model' ? `Nowcasting on this phone · run ${pr.member || 1} of ${pr.members || S.members}${pr.tiles > 1 ? ` · area ${pr.tile} of ${pr.tiles}` : ''}` : pr.phase === 'queue' ? 'Waiting its turn…' : 'Nowcasting…' };
        render();
  }
  /** a nowcast job that is already queued or running (after a fresh page, or Juli's): the card follows it */
  async function follow() {
    if (S.running || !app.inflight) return;
    const w = app.inflight(onRunProgress); if (!w) return;
    S.running = { frac: 0, text: 'Nowcasting…' }; render();
    try { const id = await w; S.running = null; const r = await getRun(id); if (r) { setRun(r); const fi = S.items.findIndex((x) => x.kind === 'nowcast'); if (fi >= 0) show(fi); } else render(); }
    catch (e) { runFailed(e); }
  }
  function runFailed(e) {
      S.running = null; render();
      const code = e && e.code;
      sumEl.textContent = code === 'STALE' ? `The newest NOAA radar is ${Math.round(e.ageMin || 16)} minutes old, so no nowcast runs now. Try again in a few minutes.`
        : code === 'RADAR_MISSING' ? 'NOAA has no recent radar right now, so no nowcast runs.' : code === 'OUT_OF_MEMORY' ? 'This phone ran out of graphics memory for the nowcast. The smaller model (Settings › Models) needs less.'
        : code === 'ABORTED' || (e && e.name === 'AbortError') ? 'Stopped.' : `The nowcast stopped: ${String((e && e.message) || e).slice(0, 120)}`;
  }

  // ---------------------------------------------------------------------------------------------- sheets
  function openSheet(build, cls = '') {
    sheetBody.textContent = ''; sheetBox.className = 'nc-sheet-box ' + cls; build(sheetBody); sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add('on'));
  }
  function closeSheet() { sheet.classList.remove('on'); sheet.hidden = true; sheetBody.textContent = ''; map.set('pick', null); }
  sheetX.onclick = closeSheet; sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  const sw = (label, on, set, sub) => { const l = mk('label', 'nc-sw'), t = mk('span', 'nc-sw-t'), i = mk('input'); i.type = 'checkbox'; i.checked = !!on; i.onchange = () => set(i.checked); t.append(mk('b', null, label)); if (sub) t.append(mk('span', 'footnote', sub)); l.append(t, i); return l; };
  const seg = (opts, cur, set) => { const r = mk('div', 'nc-seg'); for (const [v, lab] of opts) { const b = btn('nc-seg-b' + (v === cur ? ' on' : ''), lab); b.onclick = () => { set(v); r.querySelectorAll('.nc-seg-b').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }; r.append(b); } return r; };
  function saveLayers() { lsSet({ layers: S.layers, mode: S.mode, thr: S.thr, members: S.members, wide: S.wide, loopMin: S.loopMin }); }
  function openLayers() {
    openSheet((b) => {
      b.append(mk('h2', 'nc-h', 'Layers'));
      b.append(sw('Radar', S.layers.radar, (v) => { S.layers.radar = v; saveLayers(); buildItems(); show(nowIndex() >= 0 ? nowIndex() : 0); }, 'NOAA MRMS, up to now'));
      b.append(sw('Nowcast', S.layers.nowcast, (v) => { S.layers.nowcast = v; saveLayers(); buildItems(); show(S.idx); render(); }, 'The next 90 minutes, from the model on this phone · Experimental'));
      b.append(sw('Rain or snow', S.layers.type, (v) => { S.layers.type = v; saveLayers(); S.frames.clear(); loadRadar(true); }, 'On the radar, from NOAA\'s precipitation type'));
      b.append(sw('NWS warnings', S.layers.warnings, (v) => { S.layers.warnings = v; saveLayers(); loadWarnings(); }, 'Tornado, severe thunderstorm and flash flood outlines'));
      b.append(sw('Clouds', S.layers.clouds, (v) => { S.layers.clouds = v; saveLayers(); if (v) cloudsOn(); else { map.set('clouds', null); S.cloud = null; renderTl(); } },
        "NOAA GOES satellite: infrared at night, true colour by day, for the radar's past hour (about 3 MB a loop)"));
      b.append(mk('p', 'nc-sub', 'The nowcast shows'));
      b.append(seg([['rate', 'Average of runs'], ['one', 'One possible future'], ['chance', 'Chance of rain']], S.mode, (v) => { S.mode = v; saveLayers(); show(S.idx); }));
      b.append(mk('p', 'nc-sub', 'Chance of rain over'));
      b.append(seg([[1, '1 mm/h · light'], [4, '4 · moderate'], [8, '8 · heavy']], S.thr, (v) => { S.thr = v; saveLayers(); show(S.idx); }));
      b.append(mk('p', 'nc-sub', 'Runs per nowcast'));
      b.append(seg([[4, '4 · more reliable'], [1, '1 · quicker']], S.members, (v) => { S.members = v; saveLayers(); }));
      b.append(sw('Nowcast a wider area', S.wide, (v) => { S.wide = v; saveLayers(); }, `3 × 3 areas, 512 km across at 2 km · about ${Math.round(S.members * 9 * (lsGet().msPerRun || 2.2) / 10) * 10} s ${lsGet().msPerRun ? 'on this device' : 'on a recent phone'}`));
      b.append(mk('p', 'nc-sub', 'Radar loop'));
      const sizes = (m) => { if (!S.av) return ''; const pl = radar.loopPlan(S.av, { minutes: m, step: 10, typed: S.layers.type }); return ` · ${MB(pl.bytes)}`; };
      b.append(seg([[30, '30 min' + sizes(30)], [60, '1 h' + sizes(60)], [90, '90 min' + sizes(90)]], S.loopMin, (v) => { S.loopMin = v; saveLayers(); loadRadar(true); }));
      b.append(mk('p', 'footnote nc-fine', 'Each radar frame is NOAA\'s whole-US file (about 1.1 MB, + 0.25 MB for rain or snow), downloaded when this screen opens and kept only while p0pc0rn is open. A nowcast needs 6 frames (about 7 MB), most of them shared with the loop.'));
    }, 'layers');
  }
  layersB.onclick = openLayers;
  function openSearch() {
    openSheet((b) => {
      b.append(mk('h2', 'nc-h', 'Find a place'));
      const inp = mk('input', 'nc-input'); inp.type = 'search'; inp.placeholder = 'A US town or a ZIP code'; inp.setAttribute('aria-label', 'A US town or a ZIP code'); inp.autocomplete = 'off';
      const list = mk('div', 'nc-results'), note = mk('p', 'footnote nc-fine', 'Searched on this phone, in the US Census Bureau\'s list of towns and ZIP codes: nothing you type is sent anywhere.');
      b.append(inp, list, note);
      const go = async () => {
        list.textContent = ''; const q = inp.value.trim(); if (q.length < 2) return;
        const geo = S.geo || (await app.geo()); let res = [];
        if (/^\d{5}$/.test(q)) { const z = geo.zcta.find(q); if (z) res = [{ name: `ZIP ${z.zip}`, region: '', lat: z.lat, lon: z.lon }]; }
        else res = app.searchPlaces(geo, q, 8);
        if (!res.length) { list.append(mk('p', 'footnote', 'US towns and ZIP codes only for now.')); return; }
        for (const e of res) { const r = btn('nc-res', `${e.name}${e.region ? ', ' + e.region : ''}`); r.onclick = () => { closeSheet(); setPlace({ lat: e.lat, lon: e.lon, label: `${e.name}${e.region ? ', ' + e.region : ''}` }, 7.6); }; list.append(r); }
      };
      inp.oninput = () => { clearTimeout(inp.t); inp.t = setTimeout(go, 160); };
      setTimeout(() => inp.focus(), 60);
    }, 'search');
  }
  searchB.onclick = openSearch;
  locB.onclick = () => {   // the person asked: the location prompt is fine here
    if (!navigator.geolocation) return app.toast('This browser cannot share your location.');
    navigator.geolocation.getCurrentPosition((pos) => { const lat = Math.round(pos.coords.latitude * 100) / 100, lon = Math.round(pos.coords.longitude * 100) / 100; map.set('here', { lat, lon }); setPlace({ lat, lon, label: 'Your location' }, 7.6); },
      () => app.toast('Your location is off for p0pc0rn (your phone\'s settings).'), { maximumAge: 120e3, timeout: 12e3 });
  };
  function offerDownload() {
    openSheet((b) => {
      const sz = app.sizeOf(), prec = app.precision ? app.precision() : 'float';
      b.append(mk('h2', 'nc-h', 'The nowcast model'));
      b.append(mk('p', null, `DeepMind's DGMR, a model for the next 90 minutes of rain, runs on this phone: ${MB(sz)}, downloaded once.${prec === 'int8' ? ' This device gets the smaller 8-bit model, which needs less memory.' : ''}`));
      b.append(mk('p', null, 'It was trained on UK radar, so on US radar it is an experiment: it can be wrong, and it is no substitute for National Weather Service warnings.'));
      const lic = mk('p', 'footnote'), a = mk('a', null, 'CC BY 4.0'); a.href = DGMR.licence.url; a.target = '_blank'; a.rel = 'noopener';
      const s = mk('a', null, 'DeepMind'); s.href = DGMR.licence.source; s.target = '_blank'; s.rel = 'noopener';
      lic.append(`${DGMR.licence.holder}. The model is licensed under `, a, ` by `, s, `. ${DGMR.licence.changes}`); b.append(lic);
      b.append(mk('p', 'footnote', 'Keep p0pc0rn open while it downloads. Each nowcast also downloads about 7 MB of NOAA radar.'));
      const go = btn('nc-btn', `Download · ${MB(sz)}`); go.onclick = () => { app.download(); closeSheet(); render(); }; b.append(go);
    }, 'dl');
  }
  async function openForecast(p) {
    if (!p.label) p.label = nearest(p.lat, p.lon);
    map.set('pick', { lat: p.lat, lon: p.lon });
    openSheet((b) => {
      const h = mk('div', 'nc-fc-head'), t = mk('h2', 'nc-h', p.label), nb = btn('nc-btn sm', 'Nowcast here');
      nb.onclick = () => { closeSheet(); setPlace(p); nowcast(p); };
      h.append(t, nb); b.append(h);
      const nx = mk('div', 'nc-fc-now');
      const s = S.run ? summaryAt(S.run, p.lat, p.lon) : null;
      nx.append(mk('p', 'nc-sub', 'Next 90 minutes · Nowcast · Experimental'), mk('p', null, s ? s.text : inConus(p.lat, p.lon) ? 'Outside the nowcast area. "Nowcast here" works it out on this phone.' : 'The nowcast covers the lower 48 states only.'));
      if (s && s.snowNote) nx.append(mk('p', 'footnote', s.snowNote));
      const al = mk('div', 'nc-fc-alerts'), list = mk('div', 'nc-fc-list');
      list.append(mk('p', 'footnote', 'Getting the forecast…'));
      b.append(al, nx, list, Object.assign(mk('p', 'footnote nc-credit'), { textContent: NWS_LINE }));
      nws.at(p.lat, p.lon).then((A) => { for (const a of A.slice(0, 4)) { const x = btn('nc-alert', null); x.style.setProperty('--wc', a.color); x.append(icon('alert', 'nc-ic sm', 18), mk('b', null, a.event), mk('span', 'footnote', a.headline || '')); x.onclick = () => openAlert(a); al.append(x); } }, () => {});
      nws.forecast(p.lat, p.lon).then((fc) => {
        list.textContent = '';
        if (fc.outside) { list.append(mk('p', null, 'The National Weather Service has no forecast for this place.')); return; }
        for (const per of fc.periods) {
          const row = btn('nc-per' + (per.day ? '' : ' night'), null);
          const ic = icon(weatherIcon(per.short, per.day), 'nc-wic', 28), tx = mk('span', 'nc-per-t'), tp = mk('b', 'nc-per-temp', `${per.temp}°${per.unit || 'F'}`);
          tx.append(mk('b', null, per.name), mk('span', null, per.short), mk('span', 'footnote', [per.pop != null ? `${per.pop}% chance of rain or snow` : '', per.wind ? `wind ${per.wind}` : ''].filter(Boolean).join(' · ')));
          row.append(ic, tx, tp);
          const det = mk('p', 'nc-per-d footnote', per.detail || per.short); det.hidden = true;
          row.onclick = () => { det.hidden = !det.hidden; row.classList.toggle('open', !det.hidden); };
          list.append(row, det);
        }
      }, () => { list.textContent = ''; list.append(mk('p', null, 'The National Weather Service could not be reached just now.')); });
    }, 'fc');
  }
  function openAlert(a) {
    const A = a || (S.alerts || []).find((x) => /warning/i.test(x.event)); if (!A) return;
    openSheet((b) => {
      const h = mk('h2', 'nc-h nc-alert-h', A.event); h.style.setProperty('--wc', A.color); b.append(h);
      if (A.headline) b.append(mk('p', null, A.headline));
      if (A.instruction) b.append(mk('p', null, A.instruction));
      if (A.area) b.append(mk('p', 'footnote', A.area));
      b.append(mk('p', 'footnote', OFFICIAL));
      const l = mk('a', 'nc-link', 'weather.gov'); l.href = 'https://www.weather.gov/'; l.target = '_blank'; l.rel = 'noopener'; b.append(l);
    }, 'alert');
  }
  /** the fine print, behind the card's "?": the warnings line, the label, how accurate it is, and every credit */
  function openInfo() {
    openSheet((b) => {
      b.append(mk('h2', 'nc-h', 'About this map'));
      b.append(mk('p', 'nc-exp', DGMR.label), mk('p', null, OFFICIAL));
      const how = btn('nc-link', 'How accurate is this?'); how.onclick = () => openAccuracy(); b.append(how);
      b.append(mk('p', 'nc-sub', 'Credits'), mk('p', 'footnote', attribOf(S.layers.clouds)));
      const lic = mk('p', 'footnote'), a = mk('a', null, 'CC BY 4.0'); a.href = DGMR.licence.url; a.target = '_blank'; a.rel = 'noopener';
      const src = mk('a', null, 'DeepMind'); src.href = DGMR.licence.source; src.target = '_blank'; src.rel = 'noopener';
      lic.append(`${DGMR.licence.holder}. The model is licensed under `, a, ` by `, src, `. ${DGMR.licence.changes}`); b.append(lic);
      b.append(mk('p', 'footnote', 'Warnings and forecasts: US National Weather Service'));
    }, 'info');
  }
  function openAccuracy() {
    openSheet((b) => {
      b.append(mk('h2', 'nc-h', 'How accurate is this?'));
      for (const p of SKILL.intro) b.append(mk('p', null, p));
      for (const tb of SKILL.tables) {
        b.append(mk('p', 'nc-sub', tb.title));
        const t = mk('table', 'nc-skill'), hr = mk('tr'); for (const c of tb.head) hr.append(mk('th', null, c)); t.append(hr);
        for (const r of tb.rows) { const tr = mk('tr'); r.forEach((c, i) => tr.append(mk(i ? 'td' : 'th', null, c))); t.append(tr); }
        b.append(t); if (tb.note) b.append(mk('p', 'footnote', tb.note));
      }
      for (const p of SKILL.outro) b.append(mk('p', 'footnote', p));
    }, 'acc');
  }

  // ---------------------------------------------------------------------------------------------- place + open / close
  function setPlace(p, z) {
    const moved = !S.place || Math.abs(S.place.lat - p.lat) > 0.5 || Math.abs(S.place.lon - p.lon) > 0.5;
    S.place = { lat: p.lat, lon: p.lon, label: p.label }; lsSet({ place: S.place });
    if (z) map.center(p.lat, p.lon, z);
    map.set('pick', null);
    if (!map.get('here') || map.get('here').lat !== p.lat) map.set('here', { lat: p.lat, lon: p.lon });
    if (moved) S.frames.clear();
    loadRun(); loadWarnings(); if (moved) loadRadar(); render();
  }
  return {
    get shown() { return S.open; },
    /** open the screen; o: { lat, lon, label, run (id), sheet: 'forecast' } */
    async open(o = {}) {
      S.open = true; render();
      await loadStatic();
      const p = await where(o);
      if (p) { S.place = { lat: p.lat, lon: p.lon, label: p.label }; lsSet({ place: S.place }); map.set('here', { lat: p.lat, lon: p.lon }); map.center(p.lat, p.lon, 7.4); }
      else map.fit(24.5, -125, 49.5, -66.9);
      if (o.run) { const r = await getRun(o.run); if (r) setRun(r); } else await loadRun();
      render(); loadWarnings(); follow();
      if (S.layers.clouds) cloudsOn();
      await loadRadar(Date.now() - S.loadedAt > 4 * 60e3);
      if (o.sheet === 'forecast' && p) openForecast(p);
    },
    close() { S.open = false; stop(); closeSheet(); if (radar.abort) radar.abort(); },
    /** the app's download moved on: the card shows it */
    refresh() { render(); },
    /** a run finished elsewhere (Juli's): show it if it is for this place */
    showRun: setRun,
    destroy() { stop(); map.destroy(); radar.drop(); },
  };
}
