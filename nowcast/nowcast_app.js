// nowcast/nowcast_app.js - the Nowcast inside p0pc0rn (Experimental): its screen on the home screen (the shell's 'nowcast'), its queue
// job ('nowcast': one run at a time, through the app's one queue, the model loaded for the job and let go after), Juli's answer to "will
// it rain in the next hour" (a nowcast job instead of a chat turn when the model is on the phone), and the cards in her chat. Loaded
// lazily by app.js the first time any of these is needed; the model and the radar only when a run or the screen asks.
import { createNowcastView, ATTRIB } from './view.js';
import { createRadar } from './radar.js';
import { runNowcast, pixelOf } from './run.js';
import { saveRun, getRun } from './store.js';
import { nowcastAsk, nowcastSource } from './juli.js';
import { inConus, boxProjection } from './regrid.js';
import { decodeLines } from './lines.js';
import { codeLut, levelOf } from './colors.js';
import { DGMR } from './model.js';
import { resolvePlace, createWeather } from '../assistant/weather.js';
import { createNws } from './nws.js';
import { searchPlaces } from '../assistant/places.js';

export const MODEL_IDS = { float: 'dgmr-nowcast', int8: 'dgmr-nowcast-int8' };
const OUTSIDE = new Set(['AK', 'HI', 'PR']);
const CREDIT = 'Nowcast: DeepMind DGMR (CC BY 4.0), modified · Radar: NOAA MRMS';

/** api: { Q(), AG(), engine() (the lazy engine), ready(), dl(), download(), sizeOf(), precision(), research(), geo(), homeZip(), position(),
 *  toast, diag, openScreen(o), home(), section (the screen's element) } */
export function initNowcast(api) {
  const radar = createRadar({ diag: api.diag });
  let view = null;
  const viewOf = () => view || (view = createNowcastView({ root: api.section, radar, ready: api.ready, dl: api.dl, sizeOf: api.sizeOf, precision: api.precision,
    download: api.download, run: runJob, inflight, geo: api.geo, homeZip: api.homeZip, position: api.position, searchPlaces, toast: api.toast, diag: api.diag, home: api.home }));
  const live = (j) => j && j.kind === 'nowcast' && !/^(done|failed|cancelled)$/.test(j.status);
  const samePlace = (a, b) => Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02 && !!a.wide === !!b.wide;
  /** a nowcast job not finished yet for this place (or any, without one) */
  const pendingFor = (p) => { const Q = api.Q(); return Q ? Q.list().find((j) => live(j) && (!p || samePlace(j.params, p))) || null : null; };

  /** a nowcast through the queue -> Promise<run id>; onProgress({ phase, frac, member, members, tile, tiles }). The same place already
   *  queued or running: that job is waited for, never a second one (a second tap, a page that came back after a fresh page) */
  async function runJob(params, onProgress = () => {}) {
    const Q = api.Q(); if (!Q) throw new Error('the queue is not ready');
    const j = pendingFor(params) || await Q.add('nowcast', Object.assign({ purpose: 'view' }, params), { title: params.label || 'Nowcast' });
    return waitFor(j, onProgress);
  }
  /** the view's place may already have a job going: -> Promise<run id> | null */
  function inflight(onProgress = () => {}) { const j = pendingFor(null); return j ? waitFor(j, onProgress) : null; }
  function waitFor(j, onProgress) {
    const Q = api.Q();
    onProgress(j.progress || { phase: 'queue', frac: 0 });
    return new Promise((res, rej) => {
      const offs = [];
      const end = (f) => { for (const o of offs) o(); f(); };
      offs.push(Q.on('progress', (x, p) => { if (x.id === j.id) onProgress(p); }));
      offs.push(Q.on('done', (x) => { if (x.id === j.id) end(() => (x.result && x.result.runId ? res(x.result.runId) : rej(Object.assign(new Error((x.result && x.result.error) || 'no nowcast'), { code: (x.result && x.result.code) || null })))); }));
      offs.push(Q.on('failed', (x) => { if (x.id === j.id) end(() => rej(Object.assign(new Error((x.error && x.error.message) || 'failed'), { code: x.error && x.error.code }))); }));
      offs.push(Q.on('cancelled', (x) => { if (x.id === j.id) end(() => rej(Object.assign(new Error('cancelled'), { code: 'ABORTED' }))); }));
      offs.push(Q.on('blocked', (x) => { if (x.id === j.id) end(() => rej(Object.assign(new Error((x.error && x.error.message) || 'blocked'), { code: x.error && x.error.code }))); }));
      offs.push(Q.on('needs-download', (x) => { if (x.id === j.id) { Q.cancel(x.id).catch(() => {}); end(() => rej(Object.assign(new Error('Download the nowcast model first.'), { code: 'NOT_DOWNLOADED' }))); } }));
    });
  }
  // ---------------------------------------------------------------------------------------------- the queue's runner
  const runner = {
    model: () => MODEL_IDS.float,
    /** out of memory with the float model: the 8-bit one, when it is on the phone */
    fallback: (j, m, e) => (m === MODEL_IDS.float && api.int8Ready && api.int8Ready() ? MODEL_IDS.int8 : null),
    needsConsent: false,
    async run(ctx) {
      const P = ctx.params, chat = P.purpose === 'chat' && P.sid;
      try {
        const r = await runNowcast({ engine: ctx.engine, radar, lat: P.lat, lon: P.lon, label: P.label, wide: !!P.wide, members: P.members || DGMR.ensemble.members, signal: ctx.signal, onProgress: (p) => ctx.progress(p) });
        await saveRun(r);
        try { const v = JSON.parse(localStorage.getItem('p0pc0rn:nowcast:view') || '{}'); v.msPerRun = +(r.ms.reduce((a, b) => a + b, 0) / r.ms.length / 1000).toFixed(2); localStorage.setItem('p0pc0rn:nowcast:view', JSON.stringify(v)); } catch (e) { /* */ }
        api.diag('nowcast done', { precision: r.precision, members: r.members, tiles: r.tiles.length, ms: r.totalMs, perRun: Math.round(r.ms.reduce((a, b) => a + b, 0) / r.ms.length), ageMin: Math.round(r.ageMin) });
        if (view && view.shown) view.showRun(r);   // also after a planned fresh page, when the screen came back without its wait
        if (chat) await say(P, r);
        return { runId: r.id, t0: r.t0, summary: r.summary ? r.summary.text : '' };
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.code === 'ABORTED')) throw e;
        if (e && (e.code === 'OUT_OF_MEMORY' || e.code === 'GPU_LOST')) throw e;   // the queue's fallback / retry
        api.diag('nowcast stopped', { code: (e && e.code) || null, message: String((e && e.message) || e).slice(0, 160) });
        if (chat) await api.AG().say(P.sid, { text: failText(e), kind: 'error' });
        return { error: String((e && e.message) || e).slice(0, 200), code: (e && e.code) || 'ERROR' };
      }
    },
  };
  const failText = (e) => (e && e.code === 'STALE' ? `The newest NOAA radar is ${Math.round(e.ageMin || 16)} minutes old, so I can't run the nowcast right now. Ask again in a few minutes.`
    : e && e.code === 'RADAR_MISSING' ? 'NOAA has no recent radar right now, so I can\'t run the nowcast.' : `The nowcast couldn't run: ${String((e && e.message) || e).slice(0, 120)}`);
  /** Juli's answer: the summary, made in code (through the weather sources' interface), with a card that opens the Nowcast. 4.0 (review):
   *  an NWS alert in force at the point is said first, and every answer ends with the Experimental line (typed and spoken alike) */
  let NWSP = null;
  async function say(P, r) {
    const W = createWeather({ sources: [nowcastSource({ latest: async () => r })], ttlMs: 1 });
    const fc = await W.forecast(P.lat, P.lon, { nowcast: true });
    const where = P.label && !/^your /i.test(P.label) ? `${P.label}: ` : '';
    let alert = '';
    if (!fc.outside) { try { const A = await (NWSP || (NWSP = createNws())).at(P.lat, P.lon); const a = A && A[0]; if (a) alert = `${(a.headline || a.event).replace(/\s+/g, ' ').replace(/[.\s]+$/, '')} (National Weather Service). `; } catch (e) { /* the alert line is best effort */ } }
    const text = fc.outside ? 'This place is outside the nowcast area.' : `${alert}${where}${fc.summary}${r.summary && r.summary.snowNote ? ' ' + r.summary.snowNote : ''} Experimental nowcast; for warnings, follow the National Weather Service.`;
    await api.AG().say(P.sid, { text, kind: 'nowcast', nowcast: { runId: r.id, lat: P.lat, lon: P.lon, label: P.label || '', t0: r.t0 } });
  }
  // ---------------------------------------------------------------------------------------------- Juli's hook (agent.ask)
  /** a question about rain in the next 90 minutes, with the model on the phone and lookups on -> the nowcast job (her reply), or null
   *  (the chat turn goes on: she answers from the NWS, or asks which place) */
  async function juliTurn(sid, m, { voice = false } = {}) {   // (a run of the same place already going: it answers when that one lands)
    const ask = nowcastAsk(m && m.text); if (!ask) return null;
    if (!api.research() || !api.ready()) return null;
    let res = { kind: 'none' };
    try {
      const geo = await api.geo(); res = resolvePlace({ zip: ask.zip, place: ask.place }, geo);
      if (res.kind === 'none') {
        const z = api.homeZip(), e = z && geo.zcta.find(z);
        if (e) res = { kind: 'ok', lat: e.lat, lon: e.lon, label: `your home ZIP (${e.zip})`, via: 'home' };
        else { const p = await api.position(); if (p) res = { kind: 'ok', lat: p.lat, lon: p.lon, label: 'your location', via: 'location' }; }
      }
    } catch (e) { return null; }
    if (res.kind !== 'ok') return null;
    const st = /, ([A-Z]{2})$/.exec(res.label || '') || null;
    if (!inConus(res.lat, res.lon) || (st && OUTSIDE.has(st[1]))) {
      await api.AG().say(sid, { text: 'The rain nowcast covers the lower 48 states only, so this answer comes from the National Weather Service forecast.', kind: 'status', history: false });
      return null;
    }
    const Q = api.Q(), dup = pendingFor({ lat: res.lat, lon: res.lon, wide: false });
    if (dup && dup.params.purpose === 'chat' && dup.params.sid === sid) return dup;   // the same question twice: one answer
    return Q.add('nowcast', { purpose: 'chat', sid, lat: res.lat, lon: res.lon, label: res.label, members: DGMR.ensemble.members, wide: false, voice: !!voice, message: m.id }, { session: sid, title: m.text.slice(0, 60) });
  }
  // ---------------------------------------------------------------------------------------------- cards in the chat
  let LINES = null; const LUT = codeLut();
  const linesP = () => LINES || (LINES = fetch(new URL('./data/us_lines.bin', import.meta.url)).then((r) => r.arrayBuffer()).then(decodeLines).catch(() => null));
  /** the nowcast card: a small map at the place's wettest lead time, the credit, and Open */
  function nowcastCard(m) {
    const n = m.nowcast || {}, box = document.createElement('div'); box.className = 'nc-chat';
    const cv = document.createElement('canvas'); cv.className = 'nc-chat-map'; cv.width = 320; cv.height = 320; cv.setAttribute('aria-label', 'Rain map');
    const cap = document.createElement('p'); cap.className = 'footnote dim'; cap.textContent = `${DGMR.label} · ${CREDIT}`;
    const open = document.createElement('button'); open.type = 'button'; open.className = 'btn sm'; open.textContent = 'Open the Nowcast';
    open.onclick = () => api.openScreen({ lat: n.lat, lon: n.lon, label: n.label, run: n.runId });
    box.append(cv, cap, open);
    getRun(n.runId).then(async (r) => { if (r) drawThumb(cv, r, n, await linesP()); else { cv.remove(); } }, () => cv.remove());
    return box;
  }
  /** the NWS forecast card under Juli's weather answer: opens the place's 7-day forecast (and its nowcast) */
  function forecastCard(m) {
    const f = m.forecast || {}, b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm nc-chat-fc'; b.textContent = 'The week’s forecast and the rain map';
    b.onclick = () => api.openScreen({ lat: f.lat, lon: f.lon, label: f.label, sheet: 'forecast' }); return b;
  }
  function drawThumb(cv, r, n, lines) {
    const g = cv.getContext('2d'), W = cv.width, S = r.size, N = S * S, dk = matchMedia('(prefers-color-scheme: dark)').matches;
    let k = 0, best = -1; const q = pixelOf(r, n.lat, n.lon);
    if (q) for (let f = 0; f < r.spec.frames; f++) { const v = r.mean[f * N + Math.round(q.i) * S + Math.round(q.j)]; if (v > best) { best = v; k = f; } }
    const im = g.createImageData(S, S), d = new Uint32Array(im.data.buffer), L = new Uint32Array(LUT.buffer);
    for (let p = 0; p < N; p++) d[p] = L[levelOf(r.mean[k * N + p] / 64)];
    const t = document.createElement('canvas'); t.width = S; t.height = S; t.getContext('2d').putImageData(im, 0, 0);
    g.fillStyle = dk ? '#101216' : '#E9EDF2'; g.fillRect(0, 0, W, W); g.imageSmoothingEnabled = false; g.drawImage(t, 0, 0, W, W);
    const P = boxProjection(r.lat, r.lon, S, r.km), sc = W / S;
    if (lines) {
      g.strokeStyle = dk ? 'rgba(255,255,255,0.5)' : 'rgba(20,20,30,0.5)'; g.lineWidth = 1;
      const tl = P.toLatLon(0, 0), br = P.toLatLon(S - 1, S - 1);
      for (const cls of ['outline', 'state', 'county']) {
        g.globalAlpha = cls === 'county' ? 0.35 : 1; g.beginPath();
        for (let li = 0; li < lines[cls].length; li++) {
          const b = lines.boxes[cls].subarray(4 * li, 4 * li + 4); if (b[2] < tl.lon || b[0] > br.lon || b[3] < br.lat || b[1] > tl.lat) continue;
          const pts = lines[cls][li];
          for (let i = 0; i < pts.length; i += 2) { const x = P.toIJ(pts[i + 1] / 1000, pts[i] / 1000); if (i) g.lineTo(x.j * sc, x.i * sc); else g.moveTo(x.j * sc, x.i * sc); }
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (q) { g.beginPath(); g.arc(q.j * sc, q.i * sc, 6, 0, 2 * Math.PI); g.fillStyle = '#8B7CFF'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke(); }
    g.fillStyle = dk ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)'; g.fillRect(0, W - 26, W, 26); g.fillStyle = dk ? '#fff' : '#111'; g.font = '600 13px system-ui, sans-serif';
    const at = r.t0 + (r.spec.firstMin + k * r.spec.everyMin) * 60e3;
    g.fillText(`Nowcast · ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · Experimental`, 8, W - 9);
  }
  return {
    runner, juliTurn, nowcastCard, forecastCard, radar, ATTRIB,
    open: (o) => viewOf().open(o), close: () => { if (view) view.close(); }, refresh: () => { if (view) view.refresh(); },
    /** the screen is open: the model stays loaded between its nowcasts (app.js holdMs) */
    get shown() { return !!(view && view.shown); },
    get view() { return viewOf(); },
  };
}
