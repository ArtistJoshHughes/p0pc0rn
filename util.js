// util.js - small helpers with no app state: per-viewer storage, formatting, Screen Wake Lock, sharing and saving files,
// photo downscaling, library thumbnails and clip poster frames, the one-shot "latent plate" noise picture, and the viewer's pinch / swipe.

export const $ = (id) => document.getElementById(id);

/** localStorage as JSON; every access can throw (private mode, blocked site data), so never rely on it */
export const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

export const clock = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** "about 2½ min" / "under a minute" (half-minute steps, so Best and Fast never read the same) */
export function about(s) {
  if (s == null || !isFinite(s)) return '';
  if (s < 45) return 'under a minute';
  const h = Math.round(s / 30) / 2;
  return `about ${Math.floor(h)}${h % 1 ? '½' : ''} min`;
}
/** "about 6 minutes" / "about 2½ minutes" / "under a minute" (the longer form, for sentences) */
export const aboutLong = (s) => about(s).replace(/ min$/, (m, i, all) => (/^about 1 min$/.test(all) ? ' minute' : ' minutes'));
export const gb = (b) => `${(b / 1e9).toFixed(1)} GB`;
/** bytes as "4.6 GB" / "129 MB" / "12 KB" */
export const size = (b) => (b >= 1e9 ? gb(b) : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(b > 0 ? 1 : 0, Math.round(b / 1e3))} KB`);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 'ABORTED');

/** Screen Wake Lock held while downloading or making a picture; re-acquired when the page comes back. */
let lock = null, want = false;
export const wake = {
  supported: 'wakeLock' in navigator,
  get held() { return !!lock; },
  on() {
    want = true;
    if (!this.supported || lock || document.hidden) return;
    navigator.wakeLock.request('screen')   // called synchronously inside the tap
      .then((l) => { if (!want) { l.release().catch(() => {}); return; } lock = l; l.addEventListener('release', () => { lock = null; }); })
      .catch(() => { lock = null; });
  },
  off() { want = false; if (lock) { lock.release().catch(() => {}); lock = null; } },
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && want) wake.on(); });

/** File named p0pc0rn-YYYYMMDD-HHMM-<seed>.png (pictures), .mp4 (clips) or .m4a (songs; the extension follows the blob's type) */
export function mediaFile(blob, seed, when) {
  const d = new Date(when || Date.now()), p = (n) => String(n).padStart(2, '0'), t = blob.type || 'image/png';
  const ext = /^audio\/(mp4|aac|x-m4a)/.test(t) ? 'm4a' : /^audio\/(wav|x-wav|wave)/.test(t) ? 'wav' : /^audio\/(ogg|webm)/.test(t) ? 'ogg' : /mp4/.test(t) ? 'mp4' : /webm/.test(t) ? 'webm' : 'png';
  const name = `p0pc0rn-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${seed}.${ext}`;
  return new File([blob], name, { type: t });
}
/** Plain download (the share sheet's fallback for clips): a temporary link, clicked once. */
export function saveFile(file) {
  const a = document.createElement('a'), u = URL.createObjectURL(file);
  a.href = u; a.download = file.name; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}
/** Share sheet (iOS: "Save Image"). Must run synchronously inside the tap. AbortError = the person closed the sheet. */
export function share(file, fallback, text = '') {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share(Object.assign({ files: [file] }, text ? { text } : {})).catch((e) => { if (!e || e.name !== 'AbortError') fallback(); });   // v026.4: + "Made with AI using p0pc0rn"
      return;
    }
  } catch (e) { /* fall through */ }
  fallback();
}

/** Decode a picked photo once, shrink it to a long edge of at most `max`, re-encode as JPEG and drop everything else. */
export async function shrinkPhoto(file, max = 1600) {
  const url = URL.createObjectURL(file), img = new Image();
  try {
    img.src = url; await img.decode();
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(16, Math.round(img.naturalWidth * s)), h = Math.max(16, Math.round(img.naturalHeight * s));
    const blob = await drawTo(img, w, h, 'image/jpeg', 0.92);
    return { blob, w, h };
  } finally { URL.revokeObjectURL(url); img.removeAttribute('src'); }
}
/** Library thumbnail: JPEG, at most 432 px wide (sharp in a two-column grid at 3x). */
export async function makeThumb(blob, maxW = 432) {
  const bmp = await createImageBitmap(blob);
  try { const s = Math.min(1, maxW / bmp.width); return await drawTo(bmp, Math.round(bmp.width * s), Math.round(bmp.height * s), 'image/jpeg', 0.82); }
  finally { bmp.close && bmp.close(); }
}
/** A clip's poster frame for the Library: the frame at ~0.4 s, as a JPEG at most 432 px wide. Never throws: a clip the browser
 *  can't decode gets a plain tinted card instead (the tile still shows the play badge). */
export async function posterOf(blob, w, h, maxW = 432) {
  const v = document.createElement('video'), url = URL.createObjectURL(blob);
  const s = Math.min(1, maxW / (w || 832)), tw = Math.round((w || 832) * s), th = Math.round((h || 480) * s);
  const once = (ev) => new Promise((res, rej) => { v.addEventListener(ev, res, { once: true }); v.addEventListener('error', () => rej(v.error || new Error('video error')), { once: true }); });
  try {
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await Promise.race([once('loadeddata'), new Promise((_, rej) => setTimeout(() => rej(new Error('poster timeout')), 5000))]);
    await Promise.race([v.play().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]); v.pause();   // iOS paints frames of a detached video only once it has played
    const at = Math.min(0.4, (v.duration || 1) / 2);
    if (at > 0) { const sk = once('seeked'); v.currentTime = at; await Promise.race([sk, new Promise((r) => setTimeout(r, 2000))]); }
    return await drawTo(v, tw, th, 'image/jpeg', 0.82);
  } catch (e) {
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, tw, th); g.addColorStop(0, '#2a2540'); g.addColorStop(1, '#121216');
    x.fillStyle = g; x.fillRect(0, 0, tw, th);
    return new Promise((res) => c.toBlob((b) => { c.width = c.height = 0; res(b); }, 'image/jpeg', 0.82));
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}
function drawTo(src, w, h, type, q) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;   // detached; zeroed right after
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob((b) => { c.width = c.height = 0; b ? res(b) : rej(new Error('Could not encode the picture')); }, type, q));
}

/** The latent plate: one grey-noise cell per model patch (w/16 x h/16), tinted 20% toward the accent, painted ONCE as a data URL. */
export function noisePlate(w, h, seed) {
  const cw = Math.max(1, Math.round(w / 16)), ch = Math.max(1, Math.round(h / 16)), c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const x = c.getContext('2d'), d = x.createImageData(cw, ch), light = matchMedia('(prefers-color-scheme: light)').matches;
  const acc = light ? [91, 75, 245] : [139, 124, 255];
  let a = (seed >>> 0) || 1;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < cw * ch; i++) {
    const g = light ? 150 + (rnd() + rnd()) * 50 : 20 + (rnd() + rnd()) * 70;   // soft, roughly bell-shaped grey
    for (let k = 0; k < 3; k++) d.data[4 * i + k] = g * 0.8 + acc[k] * 0.2;
    d.data[4 * i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  const url = c.toDataURL('image/png'); c.width = c.height = 0;
  return url;
}

/** Viewer gestures on `el` acting on target() (the picture or the clip): pinch to zoom (1-4x), drag to pan when zoomed, double-tap to toggle 2.5x,
 *  horizontal swipe when not zoomed calls onSwipe(+1 | -1). Plain pointer events; no animation frames. Returns reset(). */
export function gestures(el, target, onSwipe) {
  const pts = new Map(); let s = 1, x = 0, y = 0, start = null, pinch = null, lastTap = 0;
  const apply = (glide) => { const img = target(); img.classList.toggle('glide', !!glide); img.style.transform = `translate(${x}px, ${y}px) scale(${s})`; };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, ox: x, oy: y, t: Date.now() };
    if (pts.size === 2) pinch = { d: dist(), s };
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) { s = Math.min(4, Math.max(1, pinch.s * dist() / pinch.d)); if (s === 1) x = y = 0; apply(); }
    else if (pts.size === 1 && start) { const dx = e.clientX - start.x, dy = e.clientY - start.y; if (s > 1) { x = start.ox + dx; y = start.oy + dy; } else { x = dx; y = 0; } apply(); }
  });
  const up = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size === 1) { const [p] = pts.values(); start = { x: p.x, y: p.y, ox: x, oy: y, t: Date.now() }; pinch = null; return; }
    if (pts.size) return;
    const dx = start ? e.clientX - start.x : 0, moved = Math.abs(dx) > 8 || (start && Math.abs(e.clientY - start.y) > 8);
    if (pinch) { pinch = null; if (s <= 1.02) { s = 1; x = y = 0; apply(true); } return; }
    if (s === 1 && Math.abs(dx) > 60) { x = 0; apply(false); onSwipe(dx < 0 ? 1 : -1); return; }
    if (!moved && Date.now() - lastTap < 300) { s = s > 1 ? 1 : 2.5; x = y = 0; apply(true); lastTap = 0; return; }
    if (!moved) lastTap = Date.now();
    if (s === 1) { x = y = 0; apply(true); }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  return () => { pts.clear(); s = 1; x = y = 0; pinch = null; apply(false); };
}
