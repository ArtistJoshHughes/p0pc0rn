// appicon_core.js - p0pc0rn 3.9: "Make an icon" for a made app, the parts without a page (node-testable). Josh, 10-26: "App to
// homescreen including openclaw like workflows needs a skeleton for flux.2 4b to make the app icon. One shot and reroll with prompt once
// it lands. Generating the app icon is optional within the "add to Home Screen" option when making the application".
// A small workflow sized for the phone's models: Juli (her own model, greedy) answers one tiny JSON with the icon's idea; the ICON
// SKELETON (ICON_STYLE) wraps that idea in the system icons' "Popcorn family" look for FLUX.2 [klein] 4B; one shot; the person keeps it,
// or edits the idea and tries again, or keeps the app's letter. ui/appicon.js is the page side (the sheet, the queue jobs, the store).
'use strict';

export const SHOT = { width: 512, height: 512, steps: 4 };   // the picture engine's own small square and steps: one quick shot
export const SIZES = [180, 120];   // the home screen's tile (62 px) on 2x and 3x screens, as the system icons (icons/ui/<id>-180/-120.png)
export const IDEA_MAX = 80, IDEA_WORDS = 8;
export const DEFAULT_IDEA = 'a bright star';
export const PLAN_PREFIX = '{"symbol": "';   // the forced start of Juli's answer: she only has to finish the words
export const PLAN_MAX_TOKENS = 20;
export const MAX_TRIES = 6;   // one shot + five tries again in one sheet

/** each bundled skeleton's own picture: the idea when Juli is not on the phone or her answer is not usable (never the app's name: a
 *  name in an image prompt comes out as drawn text) */
export const SYMBOLS = {
  'trip-watch': 'a tent under a bright sun',
  'list-tasks': 'a clipboard with a big check mark',
  'flashcards-learn': 'a small stack of cards',
  'dashboard-live': 'a rising line chart',
  'daily-counter': 'a round counter dial',
  'tiles-log': 'a neat grid of four tiles',
  'weather-alerts': 'a cloud with a lightning bolt',
  'wildfire-watch': 'a single flame',
  'connect-four': 'a round game disc',
};

// words an icon must not show: text of any kind (the model would draw it), people (likeness), and things this app never makes
const BANNED = new Set(('text texts letter letters word words number numbers digit digits logo logos brand brands label labels sign signs '
  + 'name names caption captions title titles writing font fonts people person persons man men woman women boy boys girl girls child '
  + 'children kid kids baby face faces selfie portrait nude naked gore blood weapon weapons gun guns knife knives').split(' '));
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

/** the idea for the picture: plain words only (letters, spaces, hyphens, apostrophes), no text-like or people words, short */
export function cleanIdea(s) {
  let t = String(s == null ? '' : s).normalize('NFKC').replace(INVISIBLE, '');
  t = t.replace(/[^\p{L}\s'-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter((w) => w && !BANNED.has(w.toLowerCase().replace(/^'+|'+$/g, ''))
    && !(w.length >= 2 && /^\p{Lu}+$/u.test(w)));   // an ALL-CAPS word is usually words to print: dropped
  t = words.slice(0, IDEA_WORDS).join(' ').replace(/^[-' ]+|[-' ]+$/g, '');
  if (t.length > IDEA_MAX) t = t.slice(0, IDEA_MAX).replace(/\s+\S*$/, '');
  return (t.match(/\p{L}/gu) || []).length >= 2 ? t : '';
}

/** Juli's answer -> the idea ('' when nothing usable): the forced start + her words, a JSON object, or a bare line */
export function parsePlan(text) {
  const s = String(text == null ? '' : text);
  if (/"symbol"/.test(s)) { const k = /"symbol"\s*:\s*"([^"\n]{1,200})/.exec(s); return k ? cleanIdea(k[1]) : ''; }
  const m = /"([^"\n]{2,200})"/.exec(s);
  if (m) return cleanIdea(m[1]);
  return /[{}]/.test(s) ? '' : cleanIdea(s.split('\n')[0]);
}

export const fallbackIdea = ({ skel } = {}) => SYMBOLS[skel] || DEFAULT_IDEA;

const plain = (s, n) => String(s == null ? '' : s).normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, n);
/** the plan: one system line + the app's own words as data, about 150 tokens with Gemma's tokenizer */
export function planMessages({ name, skelName, about } = {}) {
  const sys = 'You choose the picture for a phone app icon. Answer with one line of JSON only: {"symbol": "..."}. The symbol is 2 to 7 '
    + 'plain words naming one simple object, or two together, that can be drawn as a bold flat shape, for example "a tent under a sun" '
    + 'or "a stack of books". Never text, letters, numbers, logos, brands, people or faces.';
  const lines = [`App: ${plain(name, 40) || 'an app'}`];
  if (plain(skelName, 40)) lines.push(`Kind: ${plain(skelName, 40)}`);
  if (plain(about, 160)) lines.push(`What it does: ${plain(about, 160)}`);
  return [{ role: 'system', content: sys }, { role: 'user', content: lines.join('\n') }];
}

/** THE ICON SKELETON: the system icons' "Popcorn family" style (Josh picked it for 3.9), as one FLUX.2 [klein] 4B text-to-image prompt.
 *  The square is the tile itself, edge to edge: the home screen rounds the corners (as it does for the system icons). */
export const ICON_STYLE = 'Style: a modern flat illustration with subtle soft gradients and gentle highlights, friendly and warm like a '
  + 'cinema popcorn brand: the background is a smooth diagonal gradient from deep violet to near-black that fills the whole square to every '
  + 'edge and corner; the symbol is warm cream with butter-yellow and cinema-red accents, crisp clean edges and a soft shadow beneath it. ';
export function iconPrompt(idea) {
  const what = cleanIdea(idea) || DEFAULT_IDEA;
  return `A finished phone app icon, square, one bold friendly symbol in the centre: ${what}, large, simple and readable when small. `
    + ICON_STYLE + 'Minimal, no text, no letters, no numbers, no logos, no border, no frame.';
}

/** FLUX often draws "a phone app icon" as its own rounded tile on a light page. TRIM_MAX: the most of each side that page may take;
 *  CORNER_MAX: how far into each corner its light corners may reach */
export const TRIM_MAX = 0.12, CORNER_MAX = 0.25;
const lightAt = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; return r >= 200 && g >= 200 && b >= 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 40; };

/** the square to keep from a w x h picture (RGBA bytes): rows and columns from each edge that are mostly near-white are FLUX's page and go;
 *  then the centre square of what is left. A picture that fills its square comes back whole (its centre square). */
export function frameBox(d, w, h) {
  const max = Math.floor(Math.min(w, h) * TRIM_MAX);
  const row = (y) => { let n = 0; for (let x = 0; x < w; x++) if (lightAt(d, (y * w + x) * 4)) n++; return n * 2 >= w; };
  const col = (x) => { let n = 0; for (let y = 0; y < h; y++) if (lightAt(d, (y * w + x) * 4)) n++; return n * 2 >= h; };
  let t = 0, b = 0, l = 0, r = 0;
  while (t < max && row(t)) t++;
  while (b < max && row(h - 1 - b)) b++;
  while (l < max && col(l)) l++;
  while (r < max && col(w - 1 - r)) r++;
  const bw = w - l - r, bh = h - t - b, s = Math.min(bw, bh);
  return { sx: l + Math.floor((bw - s) / 2), sy: t + Math.floor((bh - s) / 2), s };
}

/** FLUX's light corners outside its rounded tile -> see-through: the light pixels joined to each corner, never past CORNER_MAX of the side
 *  from that corner (a light symbol stays). Changes d (RGBA bytes, w x h); returns how many pixels it cleared. */
export function clearCorners(d, w, h) {
  const bw = Math.floor(w * CORNER_MAX), bh = Math.floor(h * CORNER_MAX);
  let n = 0;
  for (const [cx, cy, x0, y0] of [[0, 0, 0, 0], [w - 1, 0, w - bw, 0], [0, h - 1, 0, h - bh], [w - 1, h - 1, w - bw, h - bh]]) {
    const todo = [[cx, cy]];
    while (todo.length) {
      const [x, y] = todo.pop();
      if (x < x0 || x >= x0 + bw || y < y0 || y >= y0 + bh) continue;
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0 || !lightAt(d, i)) continue;
      d[i + 3] = 0; n++;
      todo.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  return n;
}

/** a seed for one shot: 1 .. 2^31 - 2 */
export function newSeed(rand) {
  if (typeof rand === 'function') return 1 + Math.floor(rand() * (2 ** 31 - 2));
  try { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return 1 + (a[0] % (2 ** 31 - 2)); } catch (e) { return 1 + Math.floor(Math.random() * (2 ** 31 - 2)); }
}

/** what went wrong, in plain words */
export function errorText(e) {
  const code = e && e.code;
  if (code === 'NOT_DOWNLOADED') return 'Download the picture model first (Settings › Models), then make the icon.';
  if (code === 'NO_CONSENT') return 'Agree to the p0pc0rn terms first (the short lesson).';
  if (code === 'CANCELLED') return 'Stopped.';
  if (code === 'OUT_OF_MEMORY') return 'The phone ran short of memory: close other apps and try again.';
  if (code === 'GPU_LOST') return 'The picture model stopped: try again.';
  if (code === 'BUSY') return 'Something else is running: try again in a moment.';
  return 'Juli couldn’t make the icon: ' + String((e && e.message) || e || 'it stopped').slice(0, 120);
}

/** the icons on this phone: { id: the app's id, png180, png120 (Blobs), idea, at }, at most `max` (the oldest leave first). `db` =
 *  { get(id), put(rec), del(id), all() } (ui/appicon.js gives IndexedDB 'p0pc0rn-icons'; the tests a Map) */
export function createIconStore(db, { max = 60 } = {}) {
  return {
    get: async (id) => (id ? (await db.get(String(id))) || null : null),
    all: async () => (await db.all()) || [],
    remove: async (id) => { if (id) await db.del(String(id)); },
    async put(id, rec = {}) {
      if (!id) throw new Error('an icon needs the app id');
      if (!rec.png180 || !rec.png120) throw new Error('an icon needs both sizes');
      const r = { id: String(id), png180: rec.png180, png120: rec.png120, idea: cleanIdea(rec.idea), at: Number(rec.at) || Date.now() };
      await db.put(r);
      const all = (await db.all()) || [];
      if (all.length > max) for (const x of all.filter((y) => y.id !== r.id).sort((a, b) => a.at - b.at).slice(0, all.length - max)) await db.del(x.id);
      return r;
    },
  };
}

/** the sheet's workflow: plan (Juli, once) -> one shot -> preview -> Use this | Try again (the person's words, a new seed) | Keep the
 *  letter. plan(app) -> idea; render({prompt, seed, width, height, steps}) -> image Blob; toIcons(image) -> {png180, png120};
 *  save(icons, idea); onState(snapshot) after every change. The sheet draws state; nothing here touches a page. */
export function createFlow({ plan, render, toIcons, save, onState = () => {}, maxTries = MAX_TRIES } = {}) {
  const state = { step: 'idle', idea: '', ideaBy: '', image: null, seed: 0, tries: 0, error: '', note: '' };
  let run = 0;   // a cancel (or a newer start) ends what is still running
  const emit = () => { try { onState(Object.assign({}, state)); } catch (e) { /* the sheet's own problem */ } };
  const set = (o) => { Object.assign(state, o); emit(); };
  async function shot(idea, my) {
    if (state.tries >= maxTries) { set({ note: `That makes ${maxTries} tries: use one, or keep the letter.` }); return; }
    const seed = newSeed();
    set({ step: 'rendering', idea, seed, tries: state.tries + 1, error: '', note: '' });
    try {
      const image = await render(Object.assign({ prompt: iconPrompt(idea), seed }, SHOT));
      if (my !== run) return;
      set({ step: 'preview', image });
    } catch (e) {
      if (my !== run) return;
      set({ step: 'error', error: errorText(e) });
    }
  }
  return {
    state,
    async start(app) {
      const my = ++run;
      set({ step: 'planning', idea: '', ideaBy: '', image: null, seed: 0, tries: 0, error: '', note: '' });
      let idea = '';
      try { idea = cleanIdea(await plan(app)); } catch (e) { idea = ''; }
      if (my !== run) return;
      if (idea) state.ideaBy = 'juli'; else { idea = fallbackIdea(app || {}); state.ideaBy = 'fallback'; }
      await shot(idea, my);
    },
    retry(words) {
      const mine = cleanIdea(words);
      if (mine) state.ideaBy = 'person';
      return shot(mine || state.idea || DEFAULT_IDEA, run);
    },
    async use() {
      if (state.step !== 'preview' || !state.image) throw new Error('there is nothing to use yet');
      const my = run;
      set({ step: 'saving' });
      const icons = await toIcons(state.image);
      if (my !== run) return { icon: false };
      await save(icons, state.idea);
      set({ step: 'done' });
      return { icon: true };
    },
    keepLetter() { run++; set({ step: 'done' }); return { icon: false }; },
    cancel() { run++; set({ step: 'idle', image: null }); },
  };
}
