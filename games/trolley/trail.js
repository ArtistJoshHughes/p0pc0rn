// trail.js - v4 (Nov 3; Josh: "Crash troll-e when I went into the dock to recharge", and nothing of it reached the app's Diagnostics): the
// game's play trail. A small ring of what the game was doing, kept in localStorage as it plays: every few seconds, and at every zone change,
// loading screen, model load / unload / end and turn. Each entry: the zone and area, what is loading, the page's counted memory, her helper's
// memory and state, Juli's state and model, and the last thing that happened. A clean leave (pagehide) closes the trail. A trail that was
// never closed means the page ended in it: the next open (the game's landing, or p0pc0rn's Settings) writes ONE line into the app's
// Diagnostics and shows it on the landing. No DOM, every storage access wrapped (with storage blocked the game plays and keeps nothing).
export const TRAIL_KEY = 'p0pc0rn:trolley:trail', TRAIL_V = 1, TRAIL_N = 40, DIAG_KEY = 'p0pc0rn:diag';
const read = (store, k) => { try { const v = store && store.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const write = (store, k, v) => { try { if (store) store.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

/** createTrail({ store, now }) -> { mark(ev, fields), close(why), last } (last = the trail the page before left, if it never closed) */
export function createTrail({ store = (() => { try { return globalThis.localStorage || null; } catch (e) { return null; } })(), now = () => Date.now() } = {}) {
  const prev = read(store, TRAIL_KEY);
  const last = prev && prev.v === TRAIL_V && !prev.closed && Array.isArray(prev.e) && prev.e.length ? prev : null;
  const T = { v: TRAIL_V, started: now(), closed: false, reported: false, e: [] };
  // the page before's unclosed trail is kept beside this one until it is reported (prev), so a page that ends early still leaves it
  if (last && !last.reported) T.prev = { started: last.started, e: last.e.slice(-6), reported: false };
  else if (prev && prev.prev && !prev.prev.reported) T.prev = prev.prev;
  write(store, TRAIL_KEY, T);
  let lastAt = 0;
  /** one entry (ev: 'tick' | 'zone' | 'screen' | 'load' | 'unload' | 'gone' | 'turn' | ...); fields: zone, area, loading, pageMB, helperMB,
   *  mem ({ tex, draw, cnv, img, buf }: the page's memory by kind, MB), helper ('alive' | 'busy' | 'gone' | 'none'), juli (her state), model,
 *  last (the last thing that happened) */
  function mark(ev, f = {}) {
    const t = now(); if (ev === 'tick' && t - lastAt < 4000) return; lastAt = t;
    T.e.push(Object.assign({ t, ev }, f)); if (T.e.length > TRAIL_N) T.e.splice(0, T.e.length - TRAIL_N);
    write(store, TRAIL_KEY, T);
  }
  function close(why = 'left') { T.closed = true; T.closedWhy = why; write(store, TRAIL_KEY, T); }
  return { mark, close, get last() { return T.prev && !T.prev.reported ? T.prev : null; }, get entries() { return T.e; } };
}

/** a trail's last entry in one line: "Troll-E stopped in the dock zone (area yard), loading …, page N MB, helper M MB (alive), Juli online
 *  (e2b), last: …, at hh:mm:ss" */
export function trailLine(tr) {
  const e = tr && tr.e && tr.e[tr.e.length - 1]; if (!e) return null;
  const d = new Date(e.t), hm = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
  const bits = [`Troll-E stopped in ${e.zone ? `the ${e.zone} zone` : 'the game'}${e.area ? ` (area ${e.area})` : ''}`];
  if (e.loading && e.loading.length) bits.push(`loading ${e.loading.slice(0, 3).join(', ')}`);
  if (e.pageMB != null) bits.push(`page ${e.pageMB} MB${e.mem ? ` (textures ${e.mem.tex}, screen ${e.mem.draw}, canvases ${e.mem.cnv}, pictures ${e.mem.img}, buffers ${e.mem.buf})` : ''}`);
  if (e.helperMB != null || e.helper) bits.push(`helper ${e.helperMB != null ? e.helperMB + ' MB' : '?'}${e.helper ? ` (${e.helper})` : ''}`);
  if (e.juli) bits.push(`Juli ${e.juli}${e.model ? ` (${e.model})` : ''}`);
  if (e.last) bits.push(`last: ${String(e.last).slice(0, 80)}`);
  bits.push(`at ${hm} (${e.ev})`);
  return bits.join(', ');
}

/** the next open: an unreported trail of a page that ended -> its line into the app's Diagnostics (once), and the line (or null) */
// minAgeMs: the game's own landing passes 0 (the trail it finds can only be the page before's); p0pc0rn's Settings waits 15 s of quiet
export function reportTrail({ store = (() => { try { return globalThis.localStorage || null; } catch (e) { return null; } })(), diag = null, now = () => Date.now(), minAgeMs = 15000 } = {}) {
  const cur = read(store, TRAIL_KEY); if (!cur || cur.v !== TRAIL_V) return null;
  // the trail to report: the page before's kept one (this page opened a new trail), or the stored one itself if it never closed
  const target = cur.prev && !cur.prev.reported ? cur.prev : !cur.closed && !cur.reported && cur.e && cur.e.length && (now() - cur.e[cur.e.length - 1].t) >= minAgeMs ? cur : null;
  if (!target) return null;
  const line = trailLine(target); if (!line) return null;
  target.reported = true; write(store, TRAIL_KEY, cur);
  try {
    if (diag) diag(line);
    else {
      const d = new Date(), t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
      const rows = read(store, DIAG_KEY);
      write(store, DIAG_KEY, (Array.isArray(rows) ? rows : []).concat({ t, step: line, trail: target.e.slice(-4) }).slice(-200));
    }
  } catch (e) { /* diagnostics are best effort */ }
  return line;
}
