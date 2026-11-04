// hdr.js - p0pc0rn v4 "Make HDR" in the Library (Josh, Nov 1: "Make the hdr button with both profiles as options"; "video and images
// will use it"). A finished picture or clip in the viewer gets Make HDR: a small sheet with the two looks (Vivid, the default; Bright),
// a live before / after on an HDR canvas when the phone is free, and one plain line when the screen can't show HDR (the file can still
// be made). The work is an 'hdr' job in the app's one queue (no model: it waits its turn behind a render and never runs beside one); its
// result is a NEW Library item beside the original, marked HDR. Save and share go through the app's own path (export.js labels it).
// The engine side: engine/hdr/ (hdr.js: the clip and picture pipelines; ENGINE_API.md section 26).

import { LOOKS, DEFAULT_LOOK, lookOf } from '../engine/hdr/hdr_core.js';
import { ROUTES, DEFAULT_ROUTE } from '../engine/hdr/gainmap.js';

export const HDR_KIND = 'hdr';
const ROUTE_KEY = 'p0pc0rn:hdr:route';   // the picture's gain-map metadata: 'both' (default) | 'xmp' | 'iso' (for the Photos test on a phone)
const VUI_KEY = 'p0pc0rn:hdr:vui';       // '0' = leave the HEVC bitstream's colour as the encoder wrote it (the MP4 still says HLG)
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
let ENGINE = null;
const engine = () => (ENGINE = ENGINE || import('../engine/hdr/hdr.js'));   // loaded on the first Make HDR, not at start-up
let PREVIEW = null;
const previewMod = () => (PREVIEW = PREVIEW || import('../engine/hdr/hdr_gpu.js'));

export const pictureRoute = () => { const r = lsGet(ROUTE_KEY); return ROUTES.includes(r) ? r : DEFAULT_ROUTE; };
export const vuiOn = () => lsGet(VUI_KEY) !== '0';
/** a Library item that can get an HDR copy: a picture or a clip (music videos and lip-sync included), not a song, not an HDR copy */
export function eligible(m) { return !!m && !m.hdr && (m.media === 'image' || !m.media || m.media === 'video'); }
/** the viewer's info line: " · HDR · Vivid" for a copy */
export function infoOf(m) { return m && m.hdr ? ` · HDR · ${lookOf(m.hdr.look).name}` : ''; }
/** the fields of the original the copy keeps (no blobs; nothing that ties it to a music video's storyboard or versions) */
const KEEP = ['media', 'kind', 'prompt', 'seed', 'width', 'height', 'seconds', 'frames', 'fps', 'vmode', 'sources', 'steps', 'reference', 'by', 'duration', 'title', 'research', 'model', 'hq'];
export function snapshot(m) { const o = {}; for (const k of KEEP) if (m[k] !== undefined && !(m[k] instanceof Blob)) o[k] = m[k]; if (Array.isArray(o.sources)) o.sources = o.sources.map(({ from, libId }) => ({ from, libId })); return o; }
/** where the copy sits: just after (newer than) its original and any copy made of it before, so it is one swipe away in the Library */
export function copyTime(orig, lib) { const n = lib.filter((x) => x.hdr && x.hdr.from === orig.id).length; return (orig.createdAt || Date.now()) + 1 + n; }

/**
 * api: { Q(), getBlob(id) (the Library's), lib(), toast(text, opts), sheet(id, title) -> {sheet, close, wrap}, el, btn, consented(),
 *        openLesson(), settle(), busy() (a model is or is about to be in memory), saveToLibrary(res), loadLib(), openViewer(id), viewerId(),
 *        diag(step, data) }
 */
export function createHdr(api) {
  const el = api.el, btn = api.btn;

  // ---------------------------------------------------------------------------------------------- the job (the app's one queue)
  const runner = {
    model: () => null,   // no model: the queue releases the last one first and runs this between renders, never beside one
    async run(ctx) {
      const P = ctx.params || {};
      if (!api.consented()) throw Object.assign(new Error('Agree to the p0pc0rn terms (the lesson) first.'), { code: 'NO_CONSENT' });
      await api.settle();   // WebKit: a model that just left gives its memory back late
      ctx.throwIfAborted();
      const blob = await api.getBlob(P.libId).catch(() => null);
      if (!blob) throw Object.assign(new Error('The original isn’t in the Library any more.'), { code: 'GONE' });
      const E = await engine(), say = (p) => ctx.progress({ phase: 'hdr', frac: p.frac || 0, message: p.message && /frame/i.test(p.message) ? `Making the HDR copy · ${p.message.toLowerCase()}` : 'Making the HDR copy' });
      say({ frac: 0 });
      if (P.media === 'video') {
        const r = await E.makeHdrVideo(blob, { look: P.look, onProgress: say, signal: ctx.signal, vui: P.vui !== false });
        api.diag('hdr: clip made', { look: r.look, codec: r.codec, s: r.timings.total, vui: r.vui.written, vuiWhy: r.vui.why || undefined, sound: r.sound, path: r.decodePath, up: r.uploadPath });
        return { video: r.blob, info: { look: r.look, curve: r.curve, codec: r.codec, kind: r.kind, vui: r.vui, sound: r.sound, frames: r.frames, fps: r.fps, width: r.width, height: r.height, seconds: r.timings.total, version: r.version } };
      }
      const r = await E.makeHdrPicture(blob, { look: P.look, route: P.route || pictureRoute(), signal: ctx.signal });
      api.diag('hdr: picture made', { look: r.look, route: r.route, s: r.timings.total, decodes: r.decodes, gain: `${r.gainMap.minLog2}..${r.gainMap.maxLog2}` });
      return { image: r.blob, info: { look: r.look, curve: r.curve, route: r.route, gainMap: r.gainMap, width: r.width, height: r.height, seconds: r.timings.total, version: r.version } };
    },
  };

  /** a finished job -> its copy in the Library (id 'hdr-<job>': a replayed event never saves it twice), then the queue forgets it */
  async function landed(j) {
    const Q = api.Q(); if (!Q || !j || j.kind !== HDR_KIND || j.status !== 'done') return;
    const P = j.params || {}, r = j.result || {}, key = (r.video || r.image || {}).blobKey, id = 'hdr-' + j.id;
    if (api.lib().some((m) => m.id === id)) { Q.remove(j.id).catch(() => {}); return; }
    const blob = key ? await Q.getBlob(key).catch(() => null) : null;
    if (!blob) { api.toast('The HDR copy could not be saved'); return; }
    const orig = api.lib().find((m) => m.id === P.libId) || null, base = orig ? snapshot(orig) : (P.meta || {});
    const info = r.info || {};
    const res = Object.assign({}, base, { id, blob, createdAt: orig ? copyTime(orig, api.lib()) : (P.at || Date.now()), media: P.media === 'video' ? 'video' : 'image',
      width: info.width || base.width, height: info.height || base.height,
      hdr: { look: info.look || P.look, curve: info.curve || lookOf(P.look).curve, from: P.libId, codec: info.codec || null, route: info.route || null, vui: info.vui ? !!info.vui.written : null, made: Date.now(), v: info.version || null } });
    if (orig && orig.thumb instanceof Blob) res.thumb = orig.thumb;   // the same picture: its SDR thumbnail is the copy's too
    if (orig && orig.poster) res.poster = orig.poster;
    await api.saveToLibrary(res);
    await api.loadLib();   // the Library's own order (newest first): the copy right beside its original
    Q.remove(j.id).catch(() => {});
    api.toast(`HDR copy (${lookOf(res.hdr.look).name}) saved beside the original`, { action: 'Show', ms: 5000, onAction: () => api.openViewer(id) });
  }
  function failed(j) {
    if (!j || j.kind !== HDR_KIND) return;
    const code = j.error && j.error.code;
    api.toast(code === 'GONE' ? 'The original isn’t in the Library any more' : code === 'UNSUPPORTED' ? 'This browser can’t make HDR copies of clips' : 'The HDR copy didn’t work. Try again.');
    api.diag('hdr: failed', { code: code || null, message: String((j.error && j.error.message) || '').slice(0, 160) });
    const Q = api.Q(); if (Q) Q.remove(j.id).catch(() => {});
  }
  function wire() {
    const Q = api.Q(); if (!Q) return;
    Q.on('done', (j) => { if (j.kind === HDR_KIND) landed(j).catch((e) => api.diag('hdr: save failed', { message: String((e && e.message) || e).slice(0, 160) })); });
    Q.on('failed', failed);
    Q.on('cancelled', (j) => { if (j.kind === HDR_KIND) Q.remove(j.id).catch(() => {}); });
    for (const j of Q.list()) if (j.kind === HDR_KIND && j.status === 'done') landed(j).catch(() => {});   // the page ended between the job and the save
  }

  // ---------------------------------------------------------------------------------------------- the sheet
  async function open(meta, { media = null } = {}) {
    const Q = api.Q();
    if (!eligible(meta)) return;
    if (!Q) return api.toast('The queue is not ready yet');
    if (Q.readOnly) return api.toast('p0pc0rn is open in another tab.');
    const clip = meta.media === 'video', mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
    const { sheet, close, wrap } = api.sheet('hdr-sheet', 'Make HDR');
    sheet.classList.add('hdr-sheet');
    let look = DEFAULT_LOOK, split = 0.5, pv = null, src = null, raf = 0, gone = false;
    sheet.append(el('p', 'callout dim', `A new HDR copy of this ${clip ? 'clip' : 'picture'} goes beside it in the Library, marked HDR. The original stays as it is.`));
    // the before / after (an extended-range canvas; drawn only when the phone is free)
    const fig = el('div', 'hdr-pv'); fig.hidden = true;
    const cv = el('canvas'); cv.id = 'hdr-pv'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Before and after. Drag across to compare.');
    const lb = el('span', 'hdr-pv-l footnote', 'Before'), la = el('span', 'hdr-pv-r footnote', 'After');
    fig.append(cv, lb, la);
    const pvNote = el('p', 'footnote dim'); pvNote.id = 'hdr-pv-note'; pvNote.hidden = true;
    sheet.append(fig, pvNote);
    if (!mq('(dynamic-range: high)')) { const n = el('p', 'footnote dim', 'This screen can’t show HDR, so the copy looks like the original here. You can still make it.'); n.id = 'hdr-sdr'; sheet.append(n); }
    // the looks
    const opts = el('div', 'hdr-opts'); opts.setAttribute('role', 'radiogroup'); opts.setAttribute('aria-label', 'Look');
    for (const L of [LOOKS.vivid, LOOKS.bright]) {
      const b = btn('', 'hdr-opt'); b.dataset.v = L.id; b.setAttribute('role', 'radio');
      const t = el('span', 'hdr-opt-t'); t.append(el('span', 'headline', L.name), L.id === DEFAULT_LOOK ? el('span', 'footnote dim', ' · default') : '');
      b.append(t, el('span', 'footnote dim', L.line));
      b.onclick = () => { look = L.id; paintOpts(); draw(); };
      opts.append(b);
    }
    const paintOpts = () => { for (const b of opts.children) { b.setAttribute('aria-checked', String(b.dataset.v === look)); b.tabIndex = b.dataset.v === look ? 0 : -1; } };
    opts.addEventListener('keydown', (e) => { if (!/^Arrow/.test(e.key)) return; e.preventDefault(); look = look === 'vivid' ? 'bright' : 'vivid'; paintOpts(); draw(); opts.querySelector(`[data-v="${look}"]`).focus(); });
    paintOpts();
    sheet.append(el('p', 'label', 'Look'), opts);
    const go = btn('Make the HDR copy', 'btn cta'); go.id = 'hdr-go';
    const cancel = btn('Cancel', 'btn ghost'); cancel.dataset.close = '';
    sheet.append(go, cancel);
    go.onclick = async () => {
      if (!api.consented()) { close(); return api.openLesson(); }   // the agreement first, as every Make (the job checks it again)
      go.disabled = true;
      try {
        const P = { libId: meta.id, media: clip ? 'video' : 'image', look, at: Date.now(), meta: snapshot(meta) };
        if (clip) P.vui = vuiOn(); else P.route = pictureRoute();
        const waiting = !!(Q.active || Q.next());
        await Q.add(HDR_KIND, P, { title: `HDR copy · ${lookOf(look).name}` });
        close();
        api.toast(waiting ? 'The HDR copy is next in line, after what’s being made now' : 'Making the HDR copy…');
      } catch (e) { go.disabled = false; api.toast('Couldn’t start the HDR copy'); }
    };
    // tidy up when the sheet goes (its own close, the scrim, the back button)
    const watch = new MutationObserver(() => { if (!wrap.isConnected) { watch.disconnect(); gone = true; cancelAnimationFrame(raf); if (pv) pv.destroy(); if (src) src.close(); } });
    watch.observe(document.body, { childList: true });
    // the preview: the picture itself, or the frame the viewer shows
    if (api.busy()) { pvNote.textContent = 'The before and after shows when nothing else is being made.'; pvNote.hidden = false; return; }
    try {
      const G = await previewMod(), device = await G.hdrDevice();
      const w0 = Number(meta.width) || 0, h0 = Number(meta.height) || 0, ar = w0 > 0 && h0 > 0 ? w0 / h0 : 16 / 9;
      const cw = Math.min(960, Math.max(64, Math.round(w0 || 960))) & ~1, ch = Math.max(2, Math.round(cw / ar)) & ~1;
      const resize = { resizeWidth: cw, resizeHeight: ch, resizeQuality: 'high' };
      if (clip && media && media.readyState >= 2) { try { src = await createImageBitmap(media, resize); } catch (e) { src = null; } }
      if (!src) { const b = clip ? (meta.poster || meta.thumb) : await api.getBlob(meta.id).catch(() => null); if (b) src = await createImageBitmap(b, resize); }
      if (!src || gone) return;
      cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('webgpu'), cfg = ctx && G.configureHdrCanvas(device, ctx);
      if (!cfg) throw new Error('no canvas');
      pv = await new G.Preview(device, ctx, cfg, src).init();
      if (gone) { pv.destroy(); return; }
      fig.style.aspectRatio = `${cw} / ${ch}`; fig.hidden = false;
      if (!(cfg.extended === true || cfg.extended === 'unknown') && !sheet.querySelector('#hdr-sdr')) { pvNote.textContent = 'This browser shows the before and after without HDR.'; pvNote.hidden = false; }
      draw();
      const at = (e) => { const r = cv.getBoundingClientRect(); split = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))); draw(); };
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); at(e); });
      cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) at(e); });
    } catch (e) { api.diag('hdr: no preview', { message: String((e && e.message) || e).slice(0, 160) }); fig.hidden = true; }
    function draw() {
      if (!pv || gone) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (pv && !gone) pv.draw({ look: lookOf(look), split: Math.round(split * cv.width), mode: clip ? 0 : 1, cw: cv.width, ch: cv.height }); });
    }
  }

  return { runner, open, wire, landed, eligible, mark: hdrMark, info: infoOf, kind: HDR_KIND };
}
/** a Library tile's HDR mark (bottom right; the tile's label says it too), or null */
export function hdrMark(m) {
  if (!m || !m.hdr) return null;
  const s = document.createElement('span'); s.className = 'badgehdr num'; s.textContent = 'HDR'; s.setAttribute('aria-hidden', 'true');
  return s;
}
