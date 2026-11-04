// nowcast/map.js - the Nowcast's map: one canvas, Web Mercator, pan with a finger, pinch or the wheel to zoom, a double tap to zoom in.
// Layers, bottom up: the basemap (NASA GIBS Blue Marble shaded relief: US government imagery, tiles fetched from NASA, nothing else),
// the rain (radar or nowcast pictures on their own lat / lon grids, drawn in thin strips so they sit right on Mercator), the bundled
// Census coast, state and county lines, NWS warning outlines, the nowcast area's outline, city names from the on-phone Census table
// (more as you zoom in; never under the screen's own buttons and card: avoid() gives their boxes), and the "you are here" dot. A tap on
// a city name or a long press anywhere asks for that place's forecast.
import { linesIn } from './lines.js';

export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const TILE = 256, MAXTZ = 8, D2R = Math.PI / 180;
const wx = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const wy = (lat, z) => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * D2R); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
const lonOf = (x, z) => (x / (TILE * 2 ** z)) * 360 - 180;
const latOf = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z); return (180 / Math.PI) * Math.atan(Math.sinh(n)); };

export function createMap(canvas, { tileUrl = GIBS, fetchFn = (...a) => fetch(...a), onTap = () => {}, onLongPress = () => {}, onMove = () => {}, avoid = () => [], dark = () => false, minZoom = 3.2, maxZoom = 11 } = {}) {
  const ctx = canvas.getContext('2d');
  const st = { lat: 37.5, lon: -96, z: 3.6, w: 0, h: 0, dpr: 1 };
  const tiles = new Map();   // 'z/x/y' -> { img, at } | { p }
  const L = { lines: null, rain: null, nowcast: null, warnings: [], outlines: [], places: [], here: null, pick: null };
  let labels = [], raf = 0, pending = false, gone = false;

  function size() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (!r.width || !r.height) return false;
    st.w = r.width; st.h = r.height; st.dpr = dpr;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    return true;
  }
  /** screen (CSS px) <-> lat / lon */
  const origin = () => ({ x: wx(st.lon, st.z) - st.w / 2, y: wy(st.lat, st.z) - st.h / 2 });
  const toScreen = (lat, lon) => { const o = origin(); return { x: wx(lon, st.z) - o.x, y: wy(lat, st.z) - o.y }; };
  const toLatLon = (x, y) => { const o = origin(); return { lat: latOf(o.y + y, st.z), lon: lonOf(o.x + x, st.z) }; };
  const view = () => { const a = toLatLon(0, 0), b = toLatLon(st.w, st.h); return [a.lon, b.lat, b.lon, a.lat]; };

  function tile(z, x, y) {
    const n = 2 ** z; if (y < 0 || y >= n) return null;
    const xx = ((x % n) + n) % n, k = `${z}/${xx}/${y}`, t = tiles.get(k);
    if (t) { t.at = performance.now(); return t.img || null; }
    const rec = { at: performance.now(), img: null }; tiles.set(k, rec);
    fetchFn(tileUrl.replace('{z}', z).replace('{x}', xx).replace('{y}', y)).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null))
      .then((img) => { if (gone) { if (img && img.close) img.close(); return; } rec.img = img; draw(); }, () => { /* offline: the map goes on without it */ });
    if (tiles.size > 220) {   // the oldest tiles go
      const old = [...tiles.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 40);
      for (const [kk, v] of old) { if (v.img && v.img.close) v.img.close(); tiles.delete(kk); }
    }
    return null;
  }
  function drawBase() {
    const tz = Math.max(0, Math.min(MAXTZ, Math.round(st.z))), sc = 2 ** (st.z - tz), o = origin();
    const x0 = Math.floor(o.x / sc / TILE), y0 = Math.floor(o.y / sc / TILE), x1 = Math.floor((o.x + st.w) / sc / TILE), y1 = Math.floor((o.y + st.h) / sc / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let img = tile(tz, x, y), dz = 0;
      // not here yet: a parent tile, scaled up, until it lands
      let px = x, py = y;
      while (!img && dz < 3 && tz - dz > 0) { dz++; px = Math.floor(x / 2 ** dz) ; py = Math.floor(y / 2 ** dz); const k = `${tz - dz}/${((px % 2 ** (tz - dz)) + 2 ** (tz - dz)) % 2 ** (tz - dz)}/${py}`; const t = tiles.get(k); img = t && t.img; }
      const s = TILE * sc;
      if (img && dz) { const f = 2 ** dz, sx = (x - px * f) * TILE / f, sy = (y - py * f) * TILE / f; ctx.drawImage(img, sx, sy, TILE / f, TILE / f, x * s - o.x, y * s - o.y, s + 0.5, s + 0.5); }
      else if (img) ctx.drawImage(img, x * s - o.x, y * s - o.y, s + 0.5, s + 0.5);
    }
    ctx.fillStyle = dark() ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.12)'; ctx.fillRect(0, 0, st.w, st.h);
  }
  /** satellite clouds: src = { maxZ, alpha, get(z, x, y) -> ImageBitmap | null (it loads what is missing and calls draw()) } */
  function drawClouds(src) {
    const tz = Math.max(0, Math.min(src.maxZ, Math.round(st.z))), sc = 2 ** (st.z - tz), o = origin(), s = TILE * sc, n = 2 ** tz;
    const x0 = Math.floor(o.x / s), y0 = Math.floor(o.y / s), x1 = Math.floor((o.x + st.w) / s), y1 = Math.floor((o.y + st.h) / s);
    // see-through tiles meet on whole device pixels: an overlap would be drawn twice (a light line along every tile edge)
    const px = (v) => Math.round(v * st.dpr) / st.dpr;
    ctx.save(); ctx.globalAlpha = src.alpha == null ? 1 : src.alpha;
    for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) for (let x = x0; x <= x1; x++) {
      const img = src.get(tz, ((x % n) + n) % n, y), l = px(x * s - o.x), t = px(y * s - o.y);
      if (img) ctx.drawImage(img, l, t, px((x + 1) * s - o.x) - l, px((y + 1) * s - o.y) - t);
    }
    ctx.restore();
  }
  /** a grid's box on screen */
  const gridRect = (g) => { const a = toScreen(g.top, g.left), b = toScreen(g.top - g.rows * g.dlat, g.left + g.cols * g.dlon); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }; };
  /** a picture on a lat / lon grid: row r at lat top - r * dlat, column c at lon left + c * dlon; drawn in strips of 8 rows. `hole`:
   *  a screen rectangle left out (the fine radar is drawn there instead, so no rain is drawn twice) */
  function drawGrid(g, alpha = 1, hole = null) {
    if (!g || !g.canvas) return;
    const v = view(), n = g.rows, strip = 8;
    ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false;
    if (hole) { ctx.beginPath(); ctx.rect(0, 0, st.w, st.h); ctx.rect(hole.x, hole.y, hole.w, hole.h); ctx.clip('evenodd'); }
    // strip edges snapped to whole device pixels: neighbouring strips meet exactly (an overlap would draw see-through colours twice)
    const snap = (y) => Math.round(y * st.dpr) / st.dpr;
    const xa = snap(toScreen(0, g.left).x), xb = snap(toScreen(0, g.left + g.cols * g.dlon).x);
    for (let r = 0; r < n; r += strip) {
      const la = g.top - r * g.dlat, lb = g.top - Math.min(n, r + strip) * g.dlat;
      if (lb > v[3] || la < v[1]) continue;
      const ya = snap(toScreen(la, 0).y), yb = snap(toScreen(lb, 0).y);
      if (yb > ya) ctx.drawImage(g.canvas, 0, r, g.cols, Math.min(strip, n - r), xa, ya, xb - xa, yb - ya);
    }
    ctx.restore();
  }
  function path(pts, close) {   // pts: Int32Array thousandths (lon, lat, ...)
    for (let i = 0; i < pts.length; i += 2) { const p = toScreen(pts[i + 1] / 1000, pts[i] / 1000); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
    if (close) ctx.closePath();
  }
  function drawLines() {
    if (!L.lines) return;
    const v = view(), want = st.z >= 6.2 ? ['outline', 'state', 'county'] : ['outline', 'state'], got = linesIn(L.lines, v, want), dk = dark();
    const style = { county: [dk ? 'rgba(255,255,255,0.22)' : 'rgba(30,30,40,0.22)', 0.7], state: [dk ? 'rgba(255,255,255,0.6)' : 'rgba(25,25,35,0.55)', 1.2], outline: [dk ? 'rgba(255,255,255,0.75)' : 'rgba(25,25,35,0.65)', 1.1] };
    for (const c of want) { ctx.beginPath(); for (const p of got[c] || []) path(p); ctx.strokeStyle = style[c][0]; ctx.lineWidth = style[c][1]; ctx.stroke(); }
  }
  function drawWarnings() {
    for (const w of L.warnings) {
      ctx.beginPath();
      for (const ring of w.rings) { ring.forEach(([lon, lat], i) => { const p = toScreen(lat, lon); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); }
      ctx.fillStyle = w.color + '26'; ctx.fill(); ctx.strokeStyle = w.color; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  /** radar quality marks: a dashed ring around each isolated speck (drawn as it is, never removed), hatching over low-quality radar */
  function drawQc() {
    const q = L.qc; if (!q) return;
    if (q.hatch) drawGrid(q.hatch);
    const r = Math.max(7, 3 * TILE * 2 ** st.z / 40075);   // about 3 km, at least 7 px
    ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = dark() ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,30,0.85)';
    for (const s of q.rings || []) { const p = toScreen(s.lat, s.lon); if (p.x < -20 || p.y < -20 || p.x > st.w + 20 || p.y > st.h + 20) continue; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.restore();
  }
  function drawOutlines() {
    for (const o of L.outlines) {
      ctx.beginPath(); o.corners.forEach((c, i) => { const p = toScreen(c.lat, c.lon); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath();
      ctx.setLineDash([6, 5]); ctx.strokeStyle = o.color || (dark() ? 'rgba(200,190,255,0.9)' : 'rgba(80,60,220,0.85)'); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  const minW = () => (st.z < 4.6 ? 300 : st.z < 5.6 ? 100 : st.z < 6.6 ? 30 : st.z < 7.6 ? 8 : st.z < 8.6 ? 2 : 0);
  function drawLabels() {
    labels = []; if (!L.places.length) return;
    const v = view(), mw = minW(), boxes = [], dk = dark(), maxN = st.z < 5 ? 18 : st.z < 7 ? 30 : 45;
    let keep = []; try { keep = avoid() || []; } catch (e) { /* no boxes: draw everywhere */ }
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for (const e of L.places) {
      if (e.w < mw) break;
      if (e.lon < v[0] || e.lon > v[2] || e.lat < v[1] || e.lat > v[3]) continue;
      const p = toScreen(e.lat, e.lon), at = placeLabel(p, ctx.measureText(e.name).width, boxes, keep, st.w, st.h);
      if (!at) continue;
      boxes.push(at.b); labels.push({ e, b: at.b, p, tx: at.tx });
      if (labels.length >= maxN) break;
    }
    for (const { e, p, tx } of labels) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 2 * Math.PI); ctx.fillStyle = dk ? '#fff' : '#111'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = dk ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)'; ctx.strokeText(e.name, tx, p.y);
      ctx.fillStyle = dk ? '#F5F5F7' : '#0A0A0B'; ctx.fillText(e.name, tx, p.y);
    }
  }
  function drawHere() {
    for (const [pt, kind] of [[L.pick, 'pick'], [L.here, 'here']]) {
      if (!pt) continue;
      const p = toScreen(pt.lat, pt.lon);
      ctx.beginPath(); ctx.arc(p.x, p.y, kind === 'here' ? 11 : 9, 0, 2 * Math.PI); ctx.fillStyle = kind === 'here' ? 'rgba(10,132,255,0.22)' : 'rgba(139,124,255,0.25)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, 2 * Math.PI); ctx.fillStyle = kind === 'here' ? '#0A84FF' : '#8B7CFF'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  function frame() {
    raf = 0; pending = false; if (gone || !size()) return;
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); ctx.clearRect(0, 0, st.w, st.h);
    ctx.fillStyle = dark() ? '#0B0D12' : '#C9D3DC'; ctx.fillRect(0, 0, st.w, st.h);
    drawBase();
    if (L.clouds) drawClouds(L.clouds);
    // the radar: the native 1 km crop around the place, the whole-US picture (one byte a 4 km block) only outside it - never both in one
    // place (two see-through layers made the radar look stronger than the nowcast, and the blocks' maxima made it look bigger)
    if (L.rain) { const fine = L.rain.fine; drawGrid(L.rain.coarse, 1, fine ? gridRect(fine) : null); if (fine) drawGrid(fine); }
    if (L.nowcast) drawGrid(L.nowcast);
    drawQc();
    drawLines(); drawWarnings(); drawOutlines(); drawLabels(); drawHere();
    onMove({ lat: st.lat, lon: st.lon, z: st.z, view: view() });
  }
  function draw() { if (!pending) { pending = true; raf = requestAnimationFrame(frame); } }

  // ---------------------------------------------------------------------------------------------- gestures
  const pts = new Map(); let pinch = null, press = 0, moved = false, lastTap = 0, downAt = null;
  const clampZ = (z) => Math.max(minZoom, Math.min(maxZoom, z));
  function zoomAt(z, sx, sy) {
    z = clampZ(z); const a = toLatLon(sx, sy);
    st.z = z; const p = toScreen(a.lat, a.lon); const o = origin();   // keep the point under the finger
    st.lon = lonOf(o.x + (p.x - sx) + st.w / 2, z); st.lat = latOf(o.y + (p.y - sy) + st.h / 2, z); draw();
  }
  function panBy(dx, dy) { const o = origin(); st.lon = lonOf(o.x - dx + st.w / 2, st.z); st.lat = Math.max(15, Math.min(60, latOf(o.y - dy + st.h / 2, st.z))); draw(); }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); const p = local(e); pts.set(e.pointerId, p); moved = false; downAt = p;
    clearTimeout(press);
    if (pts.size === 1) press = setTimeout(() => { if (!moved && pts.size === 1) { const ll = toLatLon(p.x, p.y); onLongPress(ll.lat, ll.lon); } }, 550);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: st.z }; clearTimeout(press); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e), q = pts.get(e.pointerId); pts.set(e.pointerId, p);
    if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 6) { moved = true; clearTimeout(press); }
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      panBy((p.x - q.x) / 2, (p.y - q.y) / 2); zoomAt(pinch.z + Math.log2(d / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1) panBy(p.x - q.x, p.y - q.y);
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e); pts.delete(e.pointerId); clearTimeout(press);
    if (pts.size < 2) pinch = null;
    if (!moved && pts.size === 0) {
      const now = performance.now();
      if (now - lastTap < 320) { zoomAt(st.z + 1, p.x, p.y); lastTap = 0; return; }
      lastTap = now;
      const hit = labels.find((l) => p.x >= Math.min(l.b.x, l.p.x - 6) && p.x <= Math.max(l.b.x + l.b.w, l.p.x + 6) && p.y >= l.b.y - 4 && p.y <= l.b.y + l.b.h + 4);
      if (hit) onTap(hit.e);
    }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(st.z - e.deltaY / 300, p.x, p.y); }, { passive: false });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null; if (ro) ro.observe(canvas);

  return {
    draw, toScreen, toLatLon, view,
    get state() { return { lat: st.lat, lon: st.lon, z: st.z }; },
    /** centre on a point at a zoom (the 256 km box fills a phone screen at about 8) */
    center(lat, lon, z = st.z) { st.lat = lat; st.lon = lon; st.z = clampZ(z); draw(); },
    /** fit a lat / lon box */
    fit(s, w, n, e, pad = 24) {
      if (!size()) return;
      const span = Math.max((wx(e, 0) - wx(w, 0)) / (st.w - 2 * pad), (wy(s, 0) - wy(n, 0)) / (st.h - 2 * pad));
      st.z = clampZ(Math.log2(1 / span)); st.lon = (w + e) / 2; st.lat = latOf((wy(s, st.z) + wy(n, st.z)) / 2, st.z); draw();
    },
    set(k, v) { L[k] = v; draw(); },
    get(k) { return L[k]; },
    destroy() { gone = true; if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); for (const t of tiles.values()) if (t.img && t.img.close) t.img.close(); tiles.clear(); },
  };
}

/** where a city's name goes: right of its dot as always (off the screen's edge or on another name: no name); under one of the screen's
 *  buttons, its legend or its card, the other side of the dot (the nudge), else no name; a dot under one of them: no name either.
 *  p: the dot (CSS px), tw: the name's width, placed: names' boxes already taken, avoid: the controls' boxes ({x, y, w, h}), w / h: the
 *  map's size -> { b: the name's box, tx: where its text starts } | null */
export function placeLabel(p, tw, placed, avoid, w, h) {
  const hits = (b, q, mx, my) => b.x < q.x + q.w + mx && b.x + b.w + mx > q.x && b.y < q.y + q.h + my && b.y + b.h + my > q.y;
  const clear = (b) => !avoid.some((q) => hits(b, q, 4, 4)), free = (b) => !placed.some((q) => hits(b, q, 6, 2));
  const fits = (b) => b.x >= 2 && b.x + b.w <= w - 4 && b.y >= 2 && b.y + b.h <= h - 2;
  if (!clear({ x: p.x - 3, y: p.y - 3, w: 6, h: 6 })) return null;
  const right = { x: p.x + 5, y: p.y - 8, w: tw + 4, h: 16 }, left = { x: p.x - 9 - tw, y: p.y - 8, w: tw + 4, h: 16 };
  if (!fits(right) || !free(right)) return null;
  if (clear(right)) return { b: right, tx: p.x + 6 };
  if (fits(left) && free(left) && clear(left)) return { b: left, tx: p.x - 6 - tw };
  return null;
}

/** codes (one byte a pixel) -> a canvas through a 256-colour table (reuses `into`) */
export function paint(codes, w, h, lut, into = null) {
  const c = into && into.width === w && into.height === h ? into : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d'), im = g.createImageData(w, h), d = new Uint32Array(im.data.buffer), L32 = new Uint32Array(lut.buffer);
  for (let i = 0; i < codes.length; i++) d[i] = L32[codes[i]];
  g.putImageData(im, 0, 0); return c;
}
