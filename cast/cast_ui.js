// cast_ui.js - Settings › Cast: the list of people, "Add a person" (name -> consent -> voice -> photos), Edit / re-record / Delete, and a
// "Say something" box on each card. The voice step is the voice probe's read-aloud flow (a script on screen, 3-2-1, a level meter,
// auto-stop, trim, checks, play back, Use this / Record again); photos carry the app's per-upload rights box and are cut to the face.
'use strict';
import { CONSENT_TEXT, MAX_PHOTOS, MIN_PHOTOS, PHOTO_TIPS, prepPhoto, adjustBox, cropOut } from './cast.js';
import { SCRIPTS, analyzeTake, openMic, endpointer } from './recorder.js';
import { toMono24k, wav16 } from '../engine/voice/m4a.js';
import { ATTEST, logUpload } from '../rights.js';
import { VOICE_MODEL } from './castsay.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls = 'btn sm') => { const b = el('button', cls, label); b.type = 'button'; return b; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectSec = (t) => t.split(/\s+/).length / 2.6;

/** app = {Q: () => queue, voice: () => the voice engine (E.voice), voiceReady: () => bool, consented, openLesson, toast, saveResult(jobId),
 *  openLibraryItem(id), mediaFile, share, saveFile, dlVoice(), diag(step, data), talk(person, line) (Lip-sync, experimental)} */
export function initCast({ root, cast, app }) {
  const urls = new Set(), say = new Map();   // personId -> {jobId, text, status, blobUrl}
  const url = (b) => { const u = URL.createObjectURL(b); urls.add(u); return u; };
  let tok = 0;

  // ---------------------------------------------------------------------------------------------- the list
  async function render() {
    const t = ++tok, people = await cast.list(); if (t !== tok) return;
    for (const u of urls) URL.revokeObjectURL(u); urls.clear();
    const list = root.querySelector('#cast-list'), none = root.querySelector('#cast-none');
    list.replaceChildren(); none.hidden = people.length > 0; list.hidden = !people.length;
    for (const p of people) list.append(await card(p));
    root.querySelector('#cast-voice-note').hidden = app.voiceReady() || !people.some((p) => p.voice);
  }
  async function card(p) {
    const c = el('div', 'cast-card'); c.dataset.id = p.id;
    const top = el('div', 'cast-top'), av = el('div', 'cast-av');
    const ph = p.photos[0] && await cast.getBlob(p.photos[0].thumbKey || p.photos[0].key);
    if (ph) { const im = el('img'); im.alt = ''; im.src = url(ph); av.append(im); } else av.textContent = (p.name[0] || '?').toUpperCase();
    const txt = el('div', 'cast-txt'); txt.append(el('p', 'cast-name', p.name + (p.self ? ' · you' : '')));
    const ed = btn('Edit', 'btn sm ghost cast-edit'); ed.onclick = () => openPerson(p.id);
    top.append(av, txt, ed); c.append(top);
    // Voice and Photos, side by side: recorded / n photos, or the step still to do
    const two = el('div', 'cast-two');
    const v = btn(p.voice ? 'Voice ✓' : 'Record voice', `btn sm cast-v ${p.voice ? 'done' : 'todo'}`); v.onclick = () => openPerson(p.id, false, 'voice');
    const ps = btn(p.photos.length ? `Photos · ${p.photos.length} ✓` : 'Add photos', `btn sm cast-p ${p.photos.length ? 'done' : 'todo'}`); ps.onclick = () => openPerson(p.id, false, 'photos');
    two.append(v, ps); c.append(two);
    // "Say something" + "Lip-sync (experimental)"
    const row = el('div', 'cast-say'), inp = el('input', 'cast-in'); inp.type = 'text'; inp.maxLength = 300; inp.placeholder = p.voice ? `Something for ${p.name} to say…` : 'Record a voice first';
    inp.disabled = !p.voice; inp.setAttribute('aria-label', `Something for ${p.name} to say`);
    const go = btn('Say', 'btn sm cast-go'); go.disabled = !p.voice;
    const lip = btn('Lip-sync · experimental', 'btn sm ghost cast-lip'); lip.disabled = !p.voice;
    const out = el('div', 'cast-out');
    const s = say.get(p.id);
    if (s) paintSay(out, s);
    go.onclick = () => sayNow(p, inp.value, out);
    lip.onclick = () => { const line = inp.value.replace(/\s+/g, ' ').trim(); if (!line) { app.toast('Type the line first, then Lip-sync.'); inp.focus(); return; } app.talk(p, line); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sayNow(p, inp.value, out); } });
    row.append(inp, go); c.append(row, lip, out);
    return c;
  }
  async function sayNow(p, text, out) {
    const line = String(text || '').replace(/\s+/g, ' ').trim();
    if (!line) return app.toast('Type something to say.');
    if (!app.consented()) return app.openLesson();
    if (!app.voiceReady()) { app.toast('Download the voice model first (Settings › Models · Voice).'); return app.dlVoice(); }
    const Q = app.Q(); if (!Q) return app.toast('The queue is still starting.');
    const j = await Q.add('say', { personId: p.id, name: p.name, line }, { title: `${p.name} says` });
    const s = { jobId: j.id, text: line, status: 'Waiting its turn' }; say.set(p.id, s);
    app.diag('cast: say from the card', { chars: line.length });   // v027.3: never a Cast member's name in Diagnostics
    paintSay(out, s);
  }
  function paintSay(out, s) {
    out.replaceChildren();
    const Q = app.Q(), j = Q && Q.get(s.jobId);
    if (!j) return;
    if (j.status === 'done') {
      const au = el('audio', 'cast-audio'); au.controls = true; au.preload = 'metadata';
      const acts = el('div', 'row-btns'), sv = btn('Save', 'btn sm'), lib = btn('Open in Library', 'btn sm ghost');
      Q.getBlob(j.result && j.result.audio && j.result.audio.blobKey).then((b) => {
        if (!b) { out.replaceChildren(el('p', 'footnote dim', 'The audio is gone.')); return; }
        au.src = url(b); sv.textContent = /wav/.test(b.type) ? 'Save as .wav' : 'Save as .m4a';
        sv.onclick = () => { if (!sv.item) { sv.item = { blob: b, seed: j.params.seed || 0, createdAt: Date.now() }; if (app.exportOf) app.exportOf(sv.item); } if (app.shareItem) app.shareItem(sv.item, (f) => app.saveFile(f)); else { const f = app.mediaFile(b, j.params.seed || 0, Date.now()); app.share(f, () => app.saveFile(f)); } };   // v026.5: the labelled copy
      });
      lib.onclick = () => app.openLibraryItem('a-' + j.id);
      acts.append(sv, lib); out.append(el('p', 'footnote dim', `“${s.text}”`), au, acts);
      return;
    }
    const st = j.status === 'failed' ? `Didn't finish: ${(j.error && j.error.message) || j.error && j.error.code || 'error'}` : j.status === 'cancelled' ? 'Stopped'
      : j.status === 'blocked' ? (j.error && j.error.code === 'NO_CONSENT' ? 'Waiting for the agreement' : 'Waiting for the voice download')
      : j.status === 'running' ? `${(j.progress && j.progress.message) || 'Working'}${j.progress && j.progress.frac ? ` · ${Math.round(j.progress.frac * 100)}%` : ''}` : 'Waiting its turn';
    out.append(el('p', 'footnote dim cast-status', st));
  }
  function onJob(j) {
    if (j.kind !== 'say') return;
    for (const [pid, s] of say) if (s.jobId === j.id) {
      const out = root.querySelector(`.cast-card[data-id="${pid}"] .cast-out`); if (out) paintSay(out, s);
      if (j.status === 'done') app.saveResult(j.id);
    }
  }

  // ---------------------------------------------------------------------------------------------- the person sheet (add / edit)
  let sheet = null;
  function closeSheet() { if (!sheet) return; const w = sheet; sheet = null; stopMic(); w.classList.add('out'); setTimeout(() => w.remove(), 260); render(); }
  function openSheet(title) {
    if (sheet) sheet.remove();
    const w = el('div', 'sheet-wrap cast-wrap'), scrim = el('div', 'scrim'), sh = el('div', 'sheet cast-sheet');
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
    const head = el('div', 'cast-head'), t = el('p', 'title', title), x = btn('Done', 'btn sm ghost cast-done'); x.onclick = closeSheet; scrim.onclick = closeSheet;
    head.append(t, x); sh.append(head); w.append(scrim, sh); document.body.append(w); sheet = w;
    return sh;
  }
  /** Add a person: the name, then the consent step (logged on the phone), then the person's page */
  function addPerson() {
    const sh = openSheet('Add a person');
    const nm = el('input', 'cast-field'); nm.type = 'text'; nm.maxLength = 40; nm.placeholder = 'Name'; nm.autocapitalize = 'words'; nm.setAttribute('aria-label', 'Name');
    const who = el('div', 'cast-who'), me = el('label', 'cast-radio'), other = el('label', 'cast-radio');
    const rMe = el('input'); rMe.type = 'radio'; rMe.name = 'cast-who'; rMe.value = 'me';
    const rOt = el('input'); rOt.type = 'radio'; rOt.name = 'cast-who'; rOt.value = 'other'; rOt.checked = true;
    me.append(rMe, el('span', null, 'This is me')); other.append(rOt, el('span', null, 'Someone else')); who.append(me, other);
    const box = el('div', 'attest'), lab = el('label', 'attest-row'), ok = el('input'); ok.type = 'checkbox'; ok.id = 'cast-consent';
    lab.append(ok, el('span', null, CONSENT_TEXT)); box.append(lab);
    const note = el('p', 'footnote dim', 'A face and a voice are likeness. Only add people who said yes, never a minor, and never someone you would pass off as somebody else. The tick is kept on this phone.');
    const go = btn('Continue', 'btn cta'); go.disabled = true;
    const sync = () => { go.disabled = !(nm.value.trim() && ok.checked); };
    nm.oninput = sync; ok.onchange = sync;
    go.onclick = async () => {
      try { const p = await cast.add(nm.value, { self: rMe.checked }); app.diag('cast: added', { self: p.self }); openPerson(p.id, true); }
      catch (e) { app.toast(e.message); }
    };
    sh.append(nm, who, box, note, go); setTimeout(() => nm.focus(), 50);
  }
  async function openPerson(id, fresh, focus) {
    const p = await cast.get(id); if (!p) return closeSheet();
    const sh = openSheet(p.name);
    // the name
    const nrow = el('div', 'cast-row'), nm = el('input', 'cast-field'); nm.type = 'text'; nm.maxLength = 40; nm.value = p.name; nm.setAttribute('aria-label', 'Name');
    const rn = btn('Rename', 'btn sm ghost'); rn.onclick = async () => { try { await cast.rename(id, nm.value); app.toast('Renamed'); openPerson(id); } catch (e) { app.toast(e.message); } };
    nrow.append(nm, rn); sh.append(el('p', 'label', 'Name'), nrow);
    if (fresh) sh.append(el('p', 'callout', `Now ${p.self ? 'your' : `${p.name}'s`} voice (read a short script once) and photos (3 or 4 work best).`));
    const vl = el('p', 'label', 'Voice'), pl = el('p', 'label', `Photos · ${p.photos.length} of ${MAX_PHOTOS}`);
    sh.append(vl, voicePanel(p), pl, await photoPanel(p));
    if (focus === 'photos') setTimeout(() => pl.scrollIntoView({ block: 'start' }), 60); else if (focus === 'voice') setTimeout(() => vl.scrollIntoView({ block: 'start' }), 60);
    const del = btn(`Delete ${p.name}`, 'btn danger cast-del');
    del.onclick = async () => {
      if (!confirm(`Delete ${p.name}? This erases ${p.self ? 'your' : 'their'} recording, photos and learned voice from this phone.`)) return;
      const gone = await cast.remove(id);
      if (gone && gone.voice && gone.voice.voiceKey && app.voice()) { try { await app.voice().forgetVoice(gone.voice.voiceKey); } catch (e) { /* the file may already be gone */ } }
      say.delete(id); app.toast(`${p.name} deleted`); closeSheet();
    };
    sh.append(del);
  }

  // ---- the voice: the read-aloud take (the voice probe's flow)
  let mic = null;
  async function stopMic() { if (mic) { const m = mic; mic = null; try { await m.close(); } catch (e) { /* */ } } }
  function voicePanel(p) {
    const box = el('div', 'cast-voice');
    let si = Math.max(0, SCRIPTS.findIndex((x) => x.id === (p.voice && p.voice.scriptId))), take = null, busy = false;
    const status = el('p', 'footnote dim', p.voice ? `Voice saved (${p.voice.seconds.toFixed(1)} s). Record again to replace it.` : 'Read this out loud at your normal pace, in a quiet room, phone about a hand’s width away:');
    const pr = el('div', 'cast-prompter'), meta = el('p', 'footnote dim');
    const showScript = () => { pr.textContent = SCRIPTS[si].text; meta.textContent = `Script ${si + 1} of ${SCRIPTS.length}: ${SCRIPTS[si].src}.`; };
    showScript();
    const other = btn('Different script', 'btn sm ghost'); other.onclick = () => { if (busy) return; si = (si + 1) % SCRIPTS.length; showScript(); take = null; res.hidden = true; };
    const count = el('div', 'cast-count'); count.hidden = true;
    const meter = el('div', 'cast-meter'), fill = el('i'); meter.append(fill);
    const rec = btn('Record', 'btn cta cast-rec'), stop = btn('Stop', 'btn sm'); stop.hidden = true;
    const res = el('div', 'cast-take'); res.hidden = true;
    const checks = el('ul', 'cast-checks'), au = el('audio'); au.controls = true;
    const use = btn('Use this', 'btn sm'), again = btn('Record again', 'btn sm ghost');
    res.append(checks, au, (() => { const r = el('div', 'row-btns'); r.append(use, again); return r; })());
    const level = (rms, peak) => { const d = rms > 0 ? 20 * Math.log10(rms) : -100; fill.style.transform = `scaleX(${Math.max(0, Math.min(1, (d + 60) / 60)).toFixed(3)})`; fill.classList.toggle('hot', peak >= 0.98); };
    async function record() {
      if (busy) return; busy = true; take = null; res.hidden = true; rec.disabled = true; other.disabled = true;
      let noiseSum = 0, noiseN = 0, ep = null, stopNow = null;
      try {
        mic = await openMic((b) => {
          level(b.rms, b.peak);
          if (!b.capturing) { noiseSum += b.rms * b.rms; noiseN++; return; }
          status.textContent = `Recording… ${b.t.toFixed(1)} s`;
          if (ep && ep.feed(b.rms, b.t) === 'stop' && stopNow) stopNow();
        });
        count.hidden = false;
        for (const n of [3, 2, 1]) { count.textContent = String(n); status.textContent = 'Get ready to read…'; await sleep(800); }
        count.hidden = true;
        const noise = noiseN ? Math.sqrt(noiseSum / noiseN) : 0.002;
        ep = endpointer(noise, expectSec(SCRIPTS[si].text));
        pr.classList.add('live'); stop.hidden = false; status.textContent = 'Recording… read now.';
        const stopped = new Promise((r) => { stopNow = r; stop.onclick = () => r(); });
        mic.start(); await stopped;
        const raw = mic.stop(), rate = mic.rate; await stopMic();
        pr.classList.remove('live'); stop.hidden = true; level(0, 0);
        const a = analyzeTake(raw, rate, noise);
        app.diag('cast: take', { sec: +(a.seconds || 0).toFixed(2), ok: a.ok, why: a.why || undefined, snrDb: a.snrDb != null ? +a.snrDb.toFixed(1) : null });
        checks.replaceChildren(...a.checks.map((c) => el('li', c.ok ? (c.warn ? 'warn' : 'ok') : 'bad', `${c.ok ? (c.warn ? '•' : '✓') : '✗'} ${c.text}`)));
        res.hidden = false;
        if (a.trimmed.length) {
          const r24 = await toMono24k({ samples: a.trimmed, sampleRate: rate });
          const blob = new Blob([wav16(r24.samples, 24000)], { type: 'audio/wav' });
          take = { ok: a.ok, blob, seconds: r24.seconds, text: SCRIPTS[si].text, scriptId: SCRIPTS[si].id };
          au.src = url(blob); au.hidden = false;
        } else au.hidden = true;
        use.disabled = !a.ok;
        status.textContent = a.ok ? 'Listen back. If it sounds right, tap “Use this”.' : a.why;
      } catch (e) {
        status.textContent = e.message || String(e); await stopMic();
      } finally { busy = false; rec.disabled = false; other.disabled = false; stop.hidden = true; count.hidden = true; pr.classList.remove('live'); }
    }
    rec.onclick = record; again.onclick = record;
    use.onclick = async () => {
      if (!take || !take.ok) return;
      const r = await cast.setVoice(p.id, take);
      if (r && r.oldVoiceKey && app.voice()) { try { await app.voice().forgetVoice(r.oldVoiceKey); } catch (e) { /* */ } }
      app.diag('cast: voice saved', { sec: +take.seconds.toFixed(2), script: take.scriptId });
      app.toast(`${p.self ? 'Your' : `${p.name}'s`} voice is saved`); openPerson(p.id);
    };
    // the advanced path: a file + exactly what is said in it (the only place anything is typed)
    const adv = el('details', 'cast-adv'), sum = el('summary', null, 'Advanced: use an audio file instead');
    const file = el('input'); file.type = 'file'; file.accept = 'audio/*,video/*';
    const said = el('textarea', 'cast-field'); said.rows = 2; said.placeholder = 'Type exactly what is said in the file';
    const useF = btn('Use this file', 'btn sm'), fnote = el('p', 'footnote dim');
    useF.onclick = async () => {
      const f = file.files && file.files[0], text = said.value.trim();
      if (!f) { fnote.textContent = 'Pick a file first.'; return; }
      if (!text) { fnote.textContent = 'Type exactly what is said in it.'; return; }
      try {
        const r = await toMono24k(f);
        if (r.seconds < 2.5 || r.seconds > 12) { fnote.textContent = `${r.seconds.toFixed(1)} s: use 3 to 10 seconds of one voice.`; return; }
        const blob = new Blob([wav16(r.samples, 24000)], { type: 'audio/wav' });
        const rr = await cast.setVoice(p.id, { blob, text, scriptId: null, seconds: r.seconds });
        if (rr && rr.oldVoiceKey && app.voice()) { try { await app.voice().forgetVoice(rr.oldVoiceKey); } catch (e) { /* */ } }
        app.toast('Voice saved from the file'); openPerson(p.id);
      } catch (e) { fnote.textContent = e.message || String(e); }
    };
    adv.append(sum, file, said, useF, fnote);
    box.append(status, pr, meta, other, count, meter, (() => { const r = el('div', 'row-btns'); r.append(rec, stop); return r; })(), res, adv);
    return box;
  }

  // ---- photos (first-class, beside the voice): pick several or take one; each is cut to the face (the crop rule) with a preview the person
  // can nudge and zoom, and needs its OWN ticked upload box; only the <= 720 px crop and a thumbnail are kept, never the original
  async function photoPanel(p) {
    const box = el('div', 'cast-photos'), grid = el('div', 'cast-grid');
    for (const ph of p.photos) {
      const b = await cast.getBlob(ph.thumbKey || ph.key); if (!b) continue;
      const t = el('div', 'cast-ph'), im = el('img'); im.alt = `${p.name}`; im.src = url(b);
      const x = btn('×', 'cast-x'); x.setAttribute('aria-label', 'Remove this photo');
      x.onclick = async () => { await cast.removePhoto(p.id, ph.key); app.diag('cast: photo removed'); openPerson(p.id, false, 'photos'); };
      t.append(im, x); if (!ph.face) t.append(el('span', 'cast-nf', 'no face found')); grid.append(t);
    }
    const left = MAX_PHOTOS - p.photos.length;
    box.append(el('p', 'footnote dim', `${p.photos.length < MIN_PHOTOS ? 'At least 1 photo to put them in pictures and clips; 3 or 4 work best' : p.photos.length < 3 ? '3 or 4 photos work best' : 'Up to 8'}. ${PHOTO_TIPS}`), grid);
    if (left <= 0) { box.append(el('p', 'footnote dim', `${MAX_PHOTOS} photos: remove one to add another.`)); return box; }
    const pickRow = el('div', 'row-btns');
    const mkPick = (label, opts) => { const l = el('label', 'btn sm cast-pick'), f = el('input'); f.type = 'file'; f.accept = 'image/*,.heic,.heif'; f.hidden = true; Object.assign(f, opts); if (opts.capture) f.setAttribute('capture', opts.capture); l.append(document.createTextNode(label), f); return { l, f }; };
    const many = mkPick('Add photos', { multiple: true }), cam = mkPick('Take photo', { capture: 'user' });
    pickRow.append(many.l, cam.l);
    const pend = el('div', 'cast-pend'), save = btn('Save photos', 'btn cta cast-savep'); save.hidden = true;
    const items = [];
    const sync = () => {
      const ok = items.filter((x) => x.ok && x.tick.checked).length;
      save.hidden = !items.length; save.disabled = !ok;
      save.textContent = ok ? `Save ${ok} photo${ok === 1 ? '' : 's'}` : 'Tick the box under each photo to save it';
    };
    const add = async (files) => {
      const list = [...files].slice(0, Math.max(0, left - items.filter((x) => x.ok).length));
      if (files.length > list.length) app.toast(`Up to ${MAX_PHOTOS} photos: ${files.length - list.length} not added.`);
      const { findFace } = await import('../engine/face/blaze.js');
      for (const f of list) { const it = await pending(f, findFace, () => { items.splice(items.indexOf(it), 1); it.el.remove(); sync(); }, sync); items.push(it); pend.append(it.el); }
      sync();
    };
    many.f.onchange = () => { if (many.f.files && many.f.files.length) add(many.f.files); many.f.value = ''; };
    cam.f.onchange = () => { if (cam.f.files && cam.f.files.length) add(cam.f.files); cam.f.value = ''; };
    save.onclick = async () => {
      save.disabled = true; let n = 0;
      for (const it of items.filter((x) => x.ok && x.tick.checked)) {
        try {
          await logUpload(it.file);   // the app's upload log (time, SHA-256 of the file, terms, the exact text), as every upload
          const c = await cropOut(it.base, it.box);
          await cast.addPhoto(p.id, { blob: c.blob, thumb: c.thumb, w: c.w, h: c.h, face: it.face, attest: { at: new Date().toISOString(), text: ATTEST } });
          n++;
        } catch (e) { app.toast(e.message || String(e)); }
      }
      app.diag('cast: photos saved', { n, faces: items.filter((x) => x.ok && x.tick.checked && x.face).length });
      app.toast(`${n} photo${n === 1 ? '' : 's'} saved`); openPerson(p.id, false, 'photos');
    };
    box.append(pickRow, pend, save);
    return box;
  }
  /** one picked photo awaiting its tick: the auto crop on a preview, Move / Zoom, the crop itself, and its own unticked upload box */
  async function pending(file, findFace, onRemove, onChange) {
    const it = { file, ok: false, el: el('div', 'cast-pitem') };
    const rm = btn('Remove', 'btn sm ghost'); rm.onclick = onRemove;
    let pp = null;
    try { pp = await prepPhoto(file, findFace); } catch (e) {
      it.el.append(el('p', 'bad cast-perr', e.message || String(e)), rm); return it;
    }
    Object.assign(it, { ok: true, base: pp.base, box: pp.box, face: pp.face, W: pp.W, H: pp.H });
    const st = el('p', `footnote ${pp.face ? 'ok' : 'warn'}`, pp.face ? 'Face found ✓ (hair to below the chin). Move or zoom if you like.' : 'No face found: try a clearer photo, or move the square onto the face.');
    const cv = el('canvas', 'cast-cv'), pv = el('canvas', 'cast-pv'), S = Math.min(1, 300 / Math.max(pp.W, pp.H));
    cv.width = Math.round(pp.W * S); cv.height = Math.round(pp.H * S); pv.width = 96; pv.height = 96;
    const draw = () => {
      const x = cv.getContext('2d'); x.drawImage(pp.base, 0, 0, cv.width, cv.height);
      const [x0, y0, x1, y1] = it.box.map((v) => v * S); x.fillStyle = 'rgba(0,0,0,.45)';
      x.fillRect(0, 0, cv.width, y0); x.fillRect(0, y1, cv.width, cv.height - y1); x.fillRect(0, y0, x0, y1 - y0); x.fillRect(x1, y0, cv.width - x1, y1 - y0);
      x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(x0, y0, x1 - x0, y1 - y0);
      const q = pv.getContext('2d'), [a0, b0, a1, b1] = it.box, k = Math.min(96 / (a1 - a0), 96 / (b1 - b0)), w = (a1 - a0) * k, h = (b1 - b0) * k;
      q.clearRect(0, 0, 96, 96); q.drawImage(pp.base, a0, b0, a1 - a0, b1 - b0, (96 - w) / 2, (96 - h) / 2, w, h);
    };
    const move = (o) => { it.box = adjustBox(it.box, pp.W, pp.H, o); draw(); };
    const ctl = el('div', 'cast-ctl');
    for (const [label, o, aria] of [['−', { z: 0.9 }, 'Zoom out'], ['+', { z: 1.1 }, 'Zoom in'], ['←', { dx: -0.06 }, 'Move left'], ['→', { dx: 0.06 }, 'Move right'], ['↑', { dy: -0.06 }, 'Move up'], ['↓', { dy: 0.06 }, 'Move down']]) {
      const b = btn(label, 'btn sm ghost cast-nudge'); b.setAttribute('aria-label', aria); b.onclick = () => move(o); ctl.append(b);
    }
    let drag = null;   // drag the square with a finger
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.offsetX, y: e.offsetY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; const [x0, y0, x1, y1] = it.box, dx = (e.offsetX - drag.x) / S / (x1 - x0), dy = (e.offsetY - drag.y) / S / (y1 - y0); drag = { x: e.offsetX, y: e.offsetY }; move({ dx, dy }); });
    cv.addEventListener('pointerup', () => { drag = null; });
    const att = el('div', 'attest'), lab = el('label', 'attest-row'); it.tick = el('input'); it.tick.type = 'checkbox'; it.tick.checked = false;   // never pre-ticked
    lab.append(it.tick, el('span', null, ATTEST)); att.append(lab); it.tick.onchange = onChange;
    const vis = el('div', 'cast-pvis'); vis.append(cv, pv);
    it.el.append(st, vis, ctl, att, rm); draw();
    return it;
  }

  // ---------------------------------------------------------------------------------------------- wiring
  root.querySelector('#cast-add').onclick = () => addPerson();
  cast.on(() => { if (!sheet) render(); });
  return { render, openPerson, addPerson, onJob, close: closeSheet };
}
export { VOICE_MODEL };
