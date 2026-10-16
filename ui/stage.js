// stage.js - p0pc0rn v026.9: a job's progress as STAGES (Josh, Oct 15: "let's change the popping animation to be % within stage of render.
// Right now it make the user aka me feel like the render itself or the rendering is slow"). The popcorn runs from the first kernel to the
// last frame within each stage (getting ready, reading the words, each denoise step, the decode parts, the mix, saving) and starts again at
// the next; the text keeps the whole job: "Stage 2 of 4 · Painting · step 3/4" and the time left for everything.

// the stages each kind of job goes through, in order (a job may skip one: an edit reads its photo, a clip from words has no picture)
const LISTS = {
  picture: [['load', 'Getting ready'], ['text', 'Reading your words'], ['denoise', 'Painting'], ['decode', 'Developing']],
  edit: [['load', 'Getting ready'], ['text', 'Reading your words'], ['encode', 'Studying your photo'], ['denoise', 'Painting'], ['decode', 'Developing']],
  clip: [['load', 'Getting ready'], ['text', 'Reading your words'], ['denoise', 'Filming'], ['decode', 'Developing'], ['encode', 'Saving the clip']],
  picclip: [['load', 'Getting ready'], ['image', 'Reading your picture'], ['text', 'Reading your words'], ['denoise', 'Filming'], ['decode', 'Developing'], ['encode', 'Saving the clip']],
  song: [['load', 'Getting ready'], ['plan', 'Planning the song'], ['text', 'Reading the style'], ['lyrics', 'Reading the words'], ['cond', 'Tuning the band'], ['denoise', 'Recording'], ['decode', 'Mixing'], ['encode', 'Saving the song']],
};
const listOf = (j) => {
  const k = j.kind, P = (j.params || {});
  if (j.media === 'audio' && (k === 'song' || !k)) return LISTS.song;
  if (j.media === 'video') return k === 'animate' || k === 'between' || k === 'resume' || P.kind === 'i2v' || P.kind === 'flf' ? LISTS.picclip : LISTS.clip;
  if (j.media === 'image') return k === 'edit' || P.kind === 'i2i' ? LISTS.edit : LISTS.picture;
  return null;   // Cast (say, lip-sync), the music-video cut: their own phases, counted as they come
};
const ofN = (s) => { const r = /(\d+)\s*(?:of|\/)\s*(\d+)/i.exec(String(s || '')); return r ? [Number(r[1]), Number(r[2])] : null; };

/** the job's current stage: {key, name, index (1-based, 0 = unknown), count, frac (done within the stage, 0..1), next (where the next
 *  tick will land, for smooth motion), sub ('step 3/4' | 'part 2/24' | ''), timed (no sub-steps: time-based)} */
export function stageOf(j, names = {}) {
  const p = j.p || {}, key = p.phase || 'load', L = listOf(j);
  const i = L ? L.findIndex((x) => x[0] === key) : -1;
  const name = names[key] || (i >= 0 ? L[i][1] : (p.message ? String(p.message).replace(/[:·(].*$/, '').trim() : 'Working'));
  let frac = 0, next = 0, sub = '', timed = false;
  if (key === 'denoise' && p.steps) { const s = Math.max(0, Math.min(p.steps, p.step || 0)); frac = s / p.steps; next = Math.min(1, (s + 1) / p.steps); sub = `step ${Math.min(p.steps, s + 1)}/${p.steps}`; }   // p.step = steps done (the engines' convention): the one in progress is s + 1
  else {
    const t = ofN(p.message);
    if (t && t[1] > 0) { frac = Math.min(1, (t[0] - 1) / t[1]); next = Math.min(1, t[0] / t[1]); sub = `${/tile/i.test(p.message) ? 'tile' : /frame/i.test(p.message) ? 'frame' : 'part'} ${t[0]}/${t[1]}`; }
    else if (p.stageFrac != null) { frac = Math.max(0, Math.min(1, p.stageFrac)); next = Math.min(1, frac + 0.1); }
    else { timed = true; frac = 0; next = 0.92; }   // no sub-steps: the popcorn eases toward 92% and completes when the next stage begins
  }
  return { key, name, index: i >= 0 ? i + 1 : 0, count: L ? L.length : 0, frac, next, sub, timed };
}
/** "Stage 2 of 4 · Painting · step 3/4" */
export function stageText(st) {
  return [st.index && st.count ? `Stage ${st.index} of ${st.count}` : '', st.name, st.sub].filter(Boolean).join(' · ');
}
