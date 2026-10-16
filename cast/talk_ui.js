// talk_ui.js - the two "Make them talk" (EXPERIMENTAL) sheets: from a Cast "say" bubble (the line is there: pick a clip, or make one from the
// person's photo) and from a Library clip (pick a Cast voice, type the line, tick that the face is yours or permitted). Defaults: the v2
// blend; the quality switch and the medium-shot tip sit under "Advanced".
'use strict';
import { ATTEST, logUpload } from '../rights.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls = 'btn sm') => { const b = el('button', cls, label); b.type = 'button'; return b; };
const TIP = 'A medium shot syncs sharper than a close-up: the mouth is drawn at 256 × 256 px, so a face about 256 px tall in the clip keeps its detail; a close-up is stretched.';

/** app = {Q: () => queue, cast, lib: () => Library items, getLibBlob(id), ready(k), dl(k), sizeOf(k), consented, openLesson, toast, diag} */
export function initTalk(app) {
  let wrap = null;
  const close = () => { if (!wrap) return; const w = wrap; wrap = null; w.classList.add('out'); setTimeout(() => w.remove(), 260); };
  function sheet(title) {
    if (wrap) wrap.remove();
    const w = el('div', 'sheet-wrap cast-wrap'), scrim = el('div', 'scrim'), sh = el('div', 'sheet cast-sheet');
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
    const head = el('div', 'cast-head'), t = el('p', 'title', title), x = btn('Cancel', 'btn sm ghost'); x.onclick = close; scrim.onclick = close;
    head.append(t, x); sh.append(head, el('p', 'cast-exp', 'Experimental')); w.append(scrim, sh); document.body.append(w); wrap = w;
    return sh;
  }
  /** the model row inside a sheet: the lip-sync model (1.0 GB) must be on the phone */
  function modelNeed(sh, keys) {
    const miss = keys.filter((k) => !app.ready(k));
    if (!miss.length) return true;
    for (const k of miss) {
      const b = btn(`Download ${app.nameOf(k)} · ${app.sizeOf(k)}`, 'btn sm'); b.onclick = () => { app.dl(k); close(); app.toast(`Downloading ${app.nameOf(k)}: tap Lip-sync again when it is done.`); };
      sh.append(b);
    }
    return false;
  }
  function advanced() {
    const d = el('details', 'cast-adv'), s = el('summary', null, 'Advanced');
    const lab = el('label', 'attest-row'), q = el('input'); q.type = 'checkbox'; q.checked = true;
    lab.append(q, el('span', null, 'Quality fixes: colour-matched seam, the original skin and beard detail kept around the mouth, sharper lips. Untick for the plain blend.'));
    d.append(s, lab, el('p', 'footnote dim', TIP));
    return { el: d, blend: () => (q.checked ? 'v2' : 'plain') };
  }
  /** a Library clip picker (clips only, not music videos) -> {id, blob} via onPick */
  function clipPicker(onPick) {
    const g = el('div', 'cast-grid talk-grid'), clips = app.lib().filter((m) => m.media === 'video' && m.vmode !== 'mv');
    if (!clips.length) { g.append(el('p', 'footnote dim', 'No clips in the Library yet.')); return g; }
    for (const m of clips.slice(0, 24)) {
      const b = el('button', 'cast-ph talk-pick'); b.type = 'button'; b.setAttribute('aria-label', m.prompt || 'A clip');
      if (m.thumb) { const im = el('img'); im.alt = ''; im.src = URL.createObjectURL(m.thumb); b.append(im); }
      b.onclick = async () => { for (const x of g.children) x.classList.remove('on'); b.classList.add('on'); onPick({ id: m.id, blob: await app.getLibBlob(m.id), meta: m }); };
      g.append(b);
    }
    return g;
  }
  /** from a Cast "say" bubble (or the card): the line is there; the clip is picked or made from the person's photo */
  async function fromSay(sayJob, session) {
    const P = (sayJob && sayJob.params) || {}, person = await app.cast.get(P.personId);
    if (!person) return app.toast(`${P.name || 'That person'} is not in your cast any more.`);
    const sh = sheet(`Make ${person.name} talk`);
    sh.append(el('p', 'callout', `“${P.line}” in ${person.name}'s voice, lip-synced onto a clip of ${person.self ? 'you' : person.name}.`));
    if (!modelNeed(sh, ['lipsync'])) return;
    let pick = null, attOK = false;
    const photoOK = person.photos.length > 0 && app.ready('image') && app.ready('video');
    const fromPhoto = el('label', 'cast-radio'), rP = el('input'); rP.type = 'radio'; rP.name = 'talk-src'; rP.checked = photoOK; rP.disabled = !photoOK;
    fromPhoto.append(rP, el('span', null, person.photos.length ? `Make a clip from ${person.self ? 'your' : `${person.name}'s`} photo` : `Add a photo of ${person.name} in Settings › Cast to make a clip`));
    const fromLib = el('label', 'cast-radio'), rL = el('input'); rL.type = 'radio'; rL.name = 'talk-src'; rL.checked = !photoOK;
    fromLib.append(rL, el('span', null, 'Pick a clip from the Library'));
    const need = el('p', 'footnote dim', person.photos.length && !photoOK ? 'Making a clip needs the picture and video models (Settings › Models).' : 'From the photo: a still, then a steady talking-pose clip (about 10 minutes on the phone), then the lip-sync.');
    const libBox = el('div'), att = el('div', 'attest'), lab = el('label', 'attest-row'), ok = el('input'); ok.type = 'checkbox';
    lab.append(ok, el('span', null, `${ATTEST} The face in this clip is ${person.self ? 'mine' : `${person.name}'s`}, or I have permission.`)); att.append(lab);
    const grid = clipPicker((x) => { pick = x; sync(); }); libBox.append(grid, att);
    const adv = advanced(), go = btn('Lip-sync', 'btn cta');
    const sync = () => { libBox.hidden = !rL.checked; attOK = ok.checked; go.disabled = rL.checked ? !(pick && attOK) : !rP.checked; };
    rP.onchange = sync; rL.onchange = sync; ok.onchange = sync;
    go.onclick = async () => {
      if (!app.consented()) { close(); return app.openLesson(); }
      go.disabled = true;
      try {
        const Q = app.Q(), base = { personId: person.id, name: person.name, line: P.line, sayJobId: sayJob.id, blend: adv.blend(), shape: 'tall', session: session || null };
        if (rL.checked) {
          await logUpload(pick.blob);
          const clipKey = await Q.putBlob(pick.blob, { role: 'talk-clip' });
          await Q.add('talk', Object.assign(base, { clipKey, clipFrom: 'library', attested: true }), { session: session || undefined, title: `${person.name} talks` });
        } else await Q.add('talk', Object.assign(base, { clipFrom: 'photo', attested: true }), { session: session || undefined, title: `${person.name} talks` });
        app.diag('talk: started', { from: rL.checked ? 'library' : 'photo', blend: adv.blend() });
        close(); app.toast('Lip-sync started (experimental)');
      } catch (e) { go.disabled = false; app.toast(e.message || String(e)); }
    };
    sh.append(el('p', 'label', 'The clip'), fromPhoto, fromLib, need, libBox, adv.el, go); sync();
  }
  /** from a Library clip: a Cast voice + a line + the face tick */
  async function fromClip(libId) {
    const sh = sheet('Lip-sync this clip');
    if (!modelNeed(sh, ['lipsync', 'voice'])) return;
    const people = (await app.cast.list()).filter((p) => p.voice);
    if (!people.length) { sh.append(el('p', 'callout', 'Nobody in your Cast has a voice yet: add someone in Settings › Cast and record their voice first.')); return; }
    const who = el('div', 'talk-who'); let chosen = people[0];
    people.forEach((p, i) => { const l = el('label', 'cast-radio'), r = el('input'); r.type = 'radio'; r.name = 'talk-who'; r.checked = !i; r.onchange = () => { chosen = p; sync(); }; l.append(r, el('span', null, p.name + (p.self ? ' · you' : ''))); who.append(l); });
    const line = el('textarea', 'cast-field'); line.rows = 2; line.maxLength = 300; line.placeholder = 'The line to say';
    const att = el('div', 'attest'), lab = el('label', 'attest-row'), ok = el('input'); ok.type = 'checkbox';
    lab.append(ok, el('span', null, `${ATTEST} The face in this clip is mine, or I have the person's permission.`)); att.append(lab);
    const adv = advanced(), go = btn('Lip-sync', 'btn cta');
    const sync = () => { go.disabled = !(line.value.trim() && ok.checked && chosen); };
    line.oninput = sync; ok.onchange = sync;
    go.onclick = async () => {
      if (!app.consented()) { close(); return app.openLesson(); }
      go.disabled = true;
      try {
        const Q = app.Q(), blob = await app.getLibBlob(libId);
        if (!blob) throw new Error('That clip is gone from the Library.');
        await logUpload(blob);
        const clipKey = await Q.putBlob(blob, { role: 'talk-clip' });
        await Q.add('talk', { personId: chosen.id, name: chosen.name, line: line.value.replace(/\s+/g, ' ').trim(), clipKey, clipFrom: 'library', attested: true, blend: adv.blend(), shape: 'tall', libId }, { title: `${chosen.name} talks` });
        app.diag('talk: started', { from: 'library clip', blend: adv.blend() });
        close(); app.toast('Lip-sync started (experimental): it lands in the Library');
      } catch (e) { go.disabled = false; app.toast(e.message || String(e)); }
    };
    sh.append(el('p', 'label', 'Voice'), who, el('p', 'label', 'Line'), line, att, adv.el, go); sync();
  }
  return { fromSay, fromClip, close };
}
