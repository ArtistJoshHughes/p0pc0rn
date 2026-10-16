// cast.js - p0pc0rn Cast (Josh, Oct 14: "Voice clone successful. Wire it in to cast under settings"): the people this phone may use by name.
// A cast member is the person's OWN consented recording / upload ("This is me, or I have this person's permission. Not a minor. No
// impersonation."), so their name in a request means: speak in their voice, paint them from their photos. Everyone else is still gated.
// Everything stays on the phone: IndexedDB 'p0pc0rn-cast' (people + blobs), the consent log in localStorage 'p0pc0rn:castConsent'.
//   person = {id, name, self (this is me), createdAt, updatedAt, consent: {at, terms, text},
//             voice: {refKey (24 kHz mono WAV), text (exactly what was read), scriptId, seconds, voiceKey (the engine's learned-voice key), at} | null,
//             photos: [{key (the face crop, <= 720 px), w, h, face (found), attest: {at, sha256, text}}]}
'use strict';

export const CONSENT_TEXT = "This is me, or I have this person's permission. Not a minor. No impersonation.";
export const CONSENT_KEY = 'p0pc0rn:castConsent', TERMS = '2026-10-14';
export const MAX_PHOTOS = 8, MIN_PHOTOS = 1;   // Josh, Oct 14: 1 minimum, 3-4 recommended, 8 maximum
export const PHOTO_TIPS = 'Clear face, good light, a few different angles and expressions; no sunglasses or other people in the shot.';
const DB = 'p0pc0rn-cast';
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('people')) d.createObjectStore('people', { keyPath: 'id' }); if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
let dbp = null;
const db = () => dbp || (dbp = open());
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode), st = t.objectStore(store); let out; const q = fn(st); if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
/** names compare without case, accents or punctuation */
export const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createCast() {
  let cache = null;
  const listeners = new Set();
  const changed = () => { cache = null; for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
  const C = {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async list() { if (!cache) cache = ((await tx('people', 'readonly', (s) => s.getAll())) || []).sort((a, b) => a.createdAt - b.createdAt); return cache.slice(); },
    async get(id) { return (await C.list()).find((p) => p.id === id) || null; },
    async putBlob(blob) { const key = uid('cb'); await tx('blobs', 'readwrite', (s) => s.put({ key, blob, type: blob.type, size: blob.size, at: Date.now() })); return key; },
    async getBlob(key) { if (!key) return null; const r = await tx('blobs', 'readonly', (s) => s.get(key)); return r ? r.blob : null; },
    async dropBlob(key) { if (key) await tx('blobs', 'readwrite', (s) => s.delete(key)); },
    /** a new person, AFTER the consent step: the consent is logged on the phone (CONSENT_KEY) */
    async add(name, { self = false } = {}) {
      name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) throw Object.assign(new Error('Type a name.'), { code: 'NO_NAME' });
      if ((await C.list()).some((p) => norm(p.name) === norm(name))) throw Object.assign(new Error(`${name} is already in your cast.`), { code: 'DUPLICATE' });
      if (self && (await C.list()).some((p) => p.self)) throw Object.assign(new Error('You are already in your cast.'), { code: 'SELF_TWICE' });
      const at = new Date().toISOString(), p = { id: uid('p'), name, self: !!self, createdAt: Date.now(), updatedAt: Date.now(), consent: { at, terms: TERMS, text: CONSENT_TEXT }, voice: null, photos: [] };
      logConsent({ at, name, self: !!self, text: CONSENT_TEXT, terms: TERMS, action: 'add' });
      await tx('people', 'readwrite', (s) => s.put(p)); changed(); return p;
    },
    async save(p) { p.updatedAt = Date.now(); await tx('people', 'readwrite', (s) => s.put(p)); changed(); return p; },
    async rename(id, name) {
      const p = await C.get(id); if (!p) return null; name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) throw Object.assign(new Error('Type a name.'), { code: 'NO_NAME' });
      if ((await C.list()).some((x) => x.id !== id && norm(x.name) === norm(name))) throw Object.assign(new Error(`${name} is already in your cast.`), { code: 'DUPLICATE' });
      p.name = name; return C.save(p);
    },
    /** the cleaned read-aloud take (or a file) + exactly what is said in it; the learned voice is forgotten (a new reference) */
    async setVoice(id, { blob, text, scriptId = null, seconds }) {
      const p = await C.get(id); if (!p) return null;
      const old = p.voice; const refKey = await C.putBlob(blob);
      p.voice = { refKey, text: String(text || '').trim(), scriptId, seconds: +(+seconds).toFixed(2), voiceKey: null, at: Date.now() };
      await C.save(p); if (old) await C.dropBlob(old.refKey);
      return { person: p, oldVoiceKey: old && old.voiceKey };
    },
    async setVoiceKey(id, voiceKey) { const p = await C.get(id); if (!p || !p.voice) return; p.voice.voiceKey = voiceKey; await C.save(p); },
    /** a photo = its face crop (<= 720 px) + a thumbnail; the original is never kept. attest = the ticked upload box for THIS photo */
    async addPhoto(id, { blob, thumb, w, h, face, attest }) {
      const p = await C.get(id); if (!p) return null;
      if (!attest || !attest.at) throw Object.assign(new Error('Tick the box for this photo first.'), { code: 'NOT_ATTESTED' });
      if (p.photos.length >= MAX_PHOTOS) throw Object.assign(new Error(`Up to ${MAX_PHOTOS} photos: remove one to add another.`), { code: 'TOO_MANY' });
      const key = await C.putBlob(blob), thumbKey = thumb ? await C.putBlob(thumb) : null;
      p.photos.push({ key, thumbKey, w, h, face: !!face, attest }); return C.save(p);
    },
    async removePhoto(id, key) {
      const p = await C.get(id); if (!p) return null; const ph = p.photos.find((x) => x.key === key);
      p.photos = p.photos.filter((x) => x.key !== key); await C.dropBlob(key); if (ph) await C.dropBlob(ph.thumbKey); return C.save(p);
    },
    /** every blob this phone keeps for the people (tests: Delete erases everything) */
    async blobCount() { return ((await tx('blobs', 'readonly', (s) => s.getAllKeys())) || []).length; },
    /** Delete erases the person, their audio and photos (the learned voice too: the caller forgets voiceKey in the voice engine) */
    async remove(id) {
      const p = await C.get(id); if (!p) return null;
      for (const ph of p.photos) { await C.dropBlob(ph.key); await C.dropBlob(ph.thumbKey); }
      if (p.voice) await C.dropBlob(p.voice.refKey);
      await tx('people', 'readwrite', (s) => s.delete(id));
      logConsent({ at: new Date().toISOString(), name: p.name, action: 'delete' });
      changed(); return p;
    },
    /** cast members named in a text -> [{person, as}]: the full name or the first name (3+ letters) as a whole word, written with a capital
     *  ("Rose" in "a picture of Rose", never "a rose garden"); "me" / "myself" = the person marked "This is me" */
    async find(text) {
      const t = String(text || ''), out = [];
      for (const p of await C.list()) {
        const full = String(p.name).trim(), first = full.split(/\s+/)[0];
        for (const n of first.length >= 3 && first !== full ? [full, first] : [full]) {
          const m = t.match(new RegExp(`(?<![\\p{L}\\p{N}])(${esc(n)})(?:['’]s)?(?![\\p{L}\\p{N}])`, 'iu'));
          // a one-word name followed by another capitalised word is someone else's full name ("Josh Brolin" is not Cast member Josh)
          if (m && /^\p{Lu}/u.test(m[1]) && (/\s/.test(n) || !/^['’]?s?\s+\p{Lu}/u.test(t.slice(m.index + m[0].length)))) { out.push({ person: p, as: m[1] }); break; }
        }
      }
      if (/(?<![\p{L}])(me|myself)(?![\p{L}])/iu.test(t)) { const me = (await C.list()).find((p) => p.self); if (me && !out.some((o) => o.person.id === me.id)) out.push({ person: me, as: 'me' }); }
      return out;
    },
    /** the cast member a typed name means (the say path): the full name or the first name, any case; "me" / "myself" = "This is me" */
    async byName(name) {
      const n = norm(name), list = await C.list();
      if (n === 'me' || n === 'myself') return list.find((p) => p.self) || null;
      return list.find((p) => norm(p.name) === n) || list.find((p) => norm(p.name).split(' ')[0] === n) || null;
    },
    /** the names (and first names) of every cast member, for the likeness gate (lower case) */
    async names() { const out = []; for (const p of await C.list()) { for (const n of [norm(p.name), String(p.name).toLowerCase().trim()]) { if (!out.includes(n)) out.push(n); const f = n.split(' ')[0]; if (f.length >= 3 && f !== n && !out.includes(f)) out.push(f); } } return out; },
    consentLog() { try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || '[]'); } catch (e) { return []; } },
  };
  return C;
}
function logConsent(rec) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(CONSENT_KEY) || '[]'); } catch (e) { list = []; }
  list.push(rec);
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(list.slice(-200))); } catch (e) { /* full: the person record keeps its own consent */ }
}

// ------------------------------------------------------------------------------------------------ "make <name> say <line>"
const SAY = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:make|have|let|get)\s+(.{1,40}?)\s+(?:say|says|saying|to say)\s*[:,-]?\s*(.+?)\s*$/i;
/** a chat message -> {name, line} when it asks for a cast member to say a line, else null (the quotes around the line are dropped) */
export function sayIntent(text) {
  const m = String(text || '').replace(/\s+/g, ' ').match(SAY);
  if (!m) return null;
  const line = m[2].replace(/^["“'‘]+|["”'’]+$/g, '').trim(), name = m[1].replace(/^["“']+|["”']+$/g, '').trim();
  if (!line || line.length > 500 || !name) return null;
  return { name, line };
}

// ------------------------------------------------------------------------------------------------ a photo -> the face crop (<= 720 px)
const HEIC = /hei[cf]/i;
/** a picked file (JPEG / PNG / HEIC ...) -> {base (a canvas <= 1600 px, the orientation applied), W, H}; a file that can't be read -> a plain error */
export async function readPhoto(file) {
  let src = null;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; }
  if (!src) {   // Safari decodes HEIC in <img> even where createImageBitmap does not
    try { src = await new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); }; im.src = u; }); } catch (e) { src = null; }
  }
  const w0 = src && (src.naturalWidth || src.width), h0 = src && (src.naturalHeight || src.height);
  if (!src || !w0 || !h0) {
    const heic = HEIC.test(`${file.type} ${file.name}`);
    throw Object.assign(new Error(`Can't read “${file.name || 'this photo'}”${heic ? ": this browser can't open HEIC photos. Pick it again and choose Most Compatible (JPEG) in the Photos options" : ": it isn't a photo this phone can open"}.`), { code: 'BAD_PHOTO' });
  }
  const s0 = Math.min(1, 1600 / Math.max(w0, h0)), W = Math.max(1, Math.round(w0 * s0)), H = Math.max(1, Math.round(h0 * s0));
  const base = new OffscreenCanvas(W, H), cx = base.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, W, H);
  try { if (src.close) src.close(); } catch (e) { /* */ }
  return { base, W, H };
}
/** the crop when no face was found: a centred square of 80 % of the short side (the person can still move and zoom it) */
export const centreBox = (W, H) => { const s = Math.round(Math.min(W, H) * 0.8); return [Math.round((W - s) / 2), Math.round((H - s) / 2), Math.round((W + s) / 2), Math.round((H + s) / 2)]; };
/** move a crop by (dx, dy) of its own size and zoom it by z (> 1 = tighter) about its centre; the aspect is kept, the box stays in the photo */
export function adjustBox(box, W, H, { dx = 0, dy = 0, z = 1 } = {}) {
  let [x0, y0, x1, y1] = box; const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2 + dx * w, cy = (y0 + y1) / 2 + dy * h;
  let nw = w / z, nh = h / z; const k = Math.min(1, W / nw, H / nh); nw *= k; nh *= k; nw = Math.max(nw, 48); nh = Math.max(nh, 48 * h / w);
  x0 = Math.min(Math.max(0, cx - nw / 2), W - nw); y0 = Math.min(Math.max(0, cy - nh / 2), H - nh);
  return [Math.round(x0), Math.round(y0), Math.round(x0 + nw), Math.round(y0 + nh)];
}
/** the stored crop: <= 720 px (full-size phone photos crashed GPUs in testing) + a 160 px thumbnail */
export async function cropOut(base, box, max = 720) {
  const [x0, y0, x1, y1] = box, cw = x1 - x0, ch = y1 - y0;
  const make = async (m, q) => { const s = Math.min(1, m / Math.max(cw, ch)), w = Math.max(1, Math.round(cw * s)), h = Math.max(1, Math.round(ch * s)), c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(base, x0, y0, cw, ch, 0, 0, w, h); return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: q }), w, h }; };
  const a = await make(max, 0.92), t = await make(160, 0.8);
  return { blob: a.blob, w: a.w, h: a.h, thumb: t.blob };
}
/** a picked file -> {base, W, H, box, face} (the auto crop: the crop rule around the found face; else the centre) */
export async function prepPhoto(file, findFace) {
  const r = await readPhoto(file);
  let box = null, face = false;
  try { const f = await findFace(r.base); if (f && f.box) { const { castCrop } = await import('../engine/face/blaze.js'); box = castCrop(f.box, r.W, r.H); face = true; } } catch (e) { box = null; }
  return Object.assign(r, { box: box || centreBox(r.W, r.H), face });
}
/** the whole path in one call (tests): file -> the stored crop */
export async function faceCrop(file, findFace, max = 720) { const p = await prepPhoto(file, findFace); return Object.assign(await cropOut(p.base, p.box, max), { face: p.face }); }
/** a face crop -> a reference for Klein at the output's aspect (the engine centre-crops its reference to the output's aspect: a portrait
 *  crop would lose the forehead and the chin), letterboxed on a soft neutral background */
export async function refForShape(blob, width, height) {
  const bmp = await createImageBitmap(blob);
  try {
    const W = Math.min(width, 1280), H = Math.round(W * height / width), cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d');
    cx.fillStyle = '#7f7f7f'; cx.fillRect(0, 0, W, H);
    const s = Math.min(W / bmp.width, H / bmp.height), w = bmp.width * s, h = bmp.height * s;
    cx.imageSmoothingQuality = 'high'; cx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
    return await cv.convertToBlob({ type: 'image/png' });
  } finally { try { bmp.close(); } catch (e) { /* */ } }
}
/** the request's text for the image model: a cast member's name becomes "the person in the reference photo" (the name means nothing to it) */
export function refPrompt(prompt, names) {
  let p = String(prompt || '');
  for (const n of names) p = p.replace(new RegExp(`\\b${esc(n)}(?:'s)?\\b`, 'gi'), (m) => (/'s$/i.test(m) ? "the reference photo's person's" : 'the person in the reference photo'));
  if (!/reference photo/i.test(p)) p = `The person in the reference photo, ${p.charAt(0).toLowerCase()}${p.slice(1)}`;
  return `${p.replace(/[.\s]*$/, '.')} Keep their face exactly as in the reference photo.`;
}
