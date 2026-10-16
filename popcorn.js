// popcorn.js - p0pc0rn's progress picture (v017): kernels heat up and pop on a matte black surface, seen from the side.
// The frame on screen IS the job's percent: frame = round(progress x 100) from ONE sprite atlas (popcorn/atlas.webp, JPEG fallback,
// grid in popcorn/atlas.json). No animation loop: a frame is drawn only when the percent changes. Before the first percent (model
// load, reading the words, reading the photo) a short "heating" loop plays at a gentle 6 fps on a timer that stops when the page is
// hidden; with reduced motion it is a still. The atlas is loaded at the first job and let go a few seconds after each job.
// The animation was generated with LTX-2.3 (Lightricks) from a FLUX.2 Klein still; see licenses/.
import { reducedMotion } from './util.js';

const BASE = 'popcorn/';
let meta = null, img = null, imgUrl = '', loading = null, dropT = 0, alive = 0;   // alive: canvases showing a job now (v019: the stage + the chat card)

function load() {
  clearTimeout(dropT);
  if (img) return Promise.resolve(img);
  if (loading) return loading;
  // fetched as bytes and typed here, so a server that labels .webp wrongly (or not at all) can't stop the decode
  const get = ([src, type]) => fetch(BASE + src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(src + ' ' + r.status))))
    .then((buf) => new Promise((res, rej) => {
      const url = URL.createObjectURL(new Blob([buf], { type })), im = new Image(); im.decoding = 'async';
      im.onload = () => { imgUrl = url; res(im); }; im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('could not decode ' + src)); }; im.src = url;
    }));
  loading = (meta ? Promise.resolve(meta) : fetch(BASE + 'atlas.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('atlas.json ' + r.status)))))
    .then((m) => { meta = m; return get(m.image).catch(() => get(m.fallback)); })   // WebP first; the JPEG if this browser can't decode it
    .then((im) => (img = im))
    .finally(() => { loading = null; });
  return loading;
}
function drop() { img = null; if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = ''; } }

/** The progress canvas. `set(frac, heating)` on every progress event (cheap when nothing changes), `start()` when a job starts,
 *  `finish()` on success (shows the last frame), `stop()` when the job ends either way. */
export function popcorn(canvas) {
  const x = canvas.getContext('2d', { alpha: false });
  let live = false, cell = -1, want = 0, heat = false, hi = 0, hT = 0;
  // v026.9: per-stage progress (stage()): the stage key, its tick, the target and where the next tick lands, the frame shown, the timer
  let skey = null, sT0 = 0, tick = 0, tickMs = 0, tgt = 0, nxt = 0, timed = false, shown = 0, hold = 0, aT = 0;
  const log = (canvas._log = []);   // [stage, percent] each time the frame changes (tests read it; bounded)

  const fit = () => {   // backing store = the CSS box at up to 2x (the frames are smaller than that anyway)
    const r = canvas.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; cell = -1; }
  };
  const draw = (c) => {
    if (c === cell) return;
    if (log.length > 600) log.splice(0, 200);
    log.push([skey, Math.round((meta && meta.pct ? meta.pct.indexOf(c) : -1))]);
    const W = canvas.width, H = canvas.height;
    x.fillStyle = (meta && meta.bg) || '#000'; x.fillRect(0, 0, W, H);
    cell = img ? c : -1; canvas.dataset.frame = String(cell);
    if (!img) return;
    const fw = meta.w, fh = meta.h, sx = (c % meta.cols) * fw, sy = Math.floor(c / meta.cols) * fh;
    // fit: a wide stage shows the whole frame; a tall or square one zooms in until `span` of the frame width fills it (never past
    // cover), centred on the pile; the frame edges fade to the surface colour, so any band above or below reads as the same dark
    const contain = Math.min(W / fw, H / fh), cover = Math.max(W / fw, H / fh);
    const s = Math.min(cover, Math.max(contain, W / ((meta.span || 1) * fw)));
    const dw = fw * s, dh = fh * s, fx = meta.focus ? meta.focus[0] : 0.5, fy = meta.focus ? meta.focus[1] : 0.5;
    let dx = W / 2 - fx * dw, dy = dh > H ? H / 2 - fy * dh : (H - dh) / 2;
    if (dw >= W) dx = Math.min(0, Math.max(W - dw, dx)); else dx = (W - dw) / 2;
    if (dh >= H) dy = Math.min(0, Math.max(H - dh, dy));
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(img, sx, sy, fw, fh, dx, dy, dw, dh);
  };
  const pctCell = (f) => (meta ? meta.pct[Math.max(0, Math.min(100, Math.round(f * 100)))] : 0);
  const loopOn = () => heat && live && !document.hidden && !reducedMotion() && meta && img;
  const step = () => {
    clearTimeout(hT); hT = 0;
    if (!loopOn()) return paint();
    draw(meta.heat[hi % meta.heat.length]); hi++;
    hT = setTimeout(step, 1000 / (meta.heatFps || 6));
  };
  const paint = () => {
    if (!live) return;
    if (loopOn()) { if (!hT) step(); return; }
    clearTimeout(hT); hT = 0;
    draw(pctCell(want));
  };
  // ---- v026.9: the stage animation (a timer at ~12 fps while a stage runs and the page is visible; none with reduced motion)
  const sFrame = () => {
    clearTimeout(aT); aT = 0;
    if (!live || skey === null) return;
    const now = performance.now();
    if (now < hold) { aT = setTimeout(sFrame, hold - now); return; }
    let v = tgt;
    if (!reducedMotion()) {
      if (timed) v = Math.max(tgt, nxt * (1 - Math.exp(-(now - sT0) / 5000)));
      else v = tgt + (nxt - tgt) * Math.min(0.95, (now - tick) / Math.max(400, tickMs || 1500));
    }
    shown = Math.max(shown, Math.min(1, v)); canvas.dataset.stage = skey; canvas.dataset.pct = String(Math.round(shown * 100));
    if (img) draw(pctCell(shown));
    if (!document.hidden && !reducedMotion() && shown < 0.999) aT = setTimeout(sFrame, 83);
  };
  const vis = () => { if (live) { if (skey !== null) sFrame(); else paint(); } };
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('resize', () => { if (live) { fit(); cell = -1; paint(); } });

  return {
    start() {
      if (!live) alive++;
      live = true; want = 0; heat = true; hi = 0; cell = -1; skey = null; shown = 0; clearTimeout(aT); aT = 0; fit();
      x.fillStyle = (meta && meta.bg) || '#000'; x.fillRect(0, 0, canvas.width, canvas.height);
      load().then(() => { if (live) { fit(); cell = -1; if (skey !== null) sFrame(); else paint(); } }).catch(() => { /* no atlas: the dark plate and the progress line still show */ });
    },
    set(frac, heating) {
      if (!live) return;
      want = Math.max(want, Math.min(1, frac || 0)); heat = !!heating && want < 0.995;
      if (!heat && hT) { clearTimeout(hT); hT = 0; }
      paint();
    },
    /** v026.9: the job's current stage ({key, frac, next, timed} from ui/stage.js): the popcorn runs 0 -> 100% within it */
    stage(st) {
      if (!live || !st) return;
      const now = performance.now();
      heat = false; if (hT) { clearTimeout(hT); hT = 0; }
      if (st.key !== skey) {
        if (skey !== null) { shown = 1; if (img) draw(pctCell(1)); hold = now + (reducedMotion() ? 0 : 220); }   // the old stage ends on its last frame
        skey = st.key; sT0 = now; tick = now; tickMs = 0; shown = 0; tgt = st.frac || 0; nxt = Math.max(tgt, st.next || 0); timed = !!st.timed;
      } else if ((st.frac || 0) > tgt + 1e-6) {
        const d = now - tick; tickMs = tickMs ? 0.6 * tickMs + 0.4 * d : d; tick = now; tgt = st.frac; nxt = Math.max(tgt, st.next || tgt); timed = !!st.timed;
      }
      if (!aT) sFrame();
    },
    finish() { if (!live) return; want = 1; heat = false; clearTimeout(hT); hT = 0; clearTimeout(aT); aT = 0; shown = 1; draw(pctCell(1)); },
    stop() {
      if (live) alive = Math.max(0, alive - 1);
      live = false; heat = false; clearTimeout(hT); hT = 0; clearTimeout(aT); aT = 0; skey = null;
      clearTimeout(dropT); dropT = setTimeout(() => { if (!alive) drop(); }, 8000);   // let the decoded atlas go between jobs (never while another canvas shows one)
    },
    get frame() { return cell; },
  };
}
