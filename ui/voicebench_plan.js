// voicebench_plan.js - v4: Settings › Benchmark › Voice in (pure: no DOM, no engine; node-tested). The plan of the voice-input bench,
// its run state (kept in localStorage p0pc0rn:voicein:bench, nothing else), the word error rate and the card's lines. The page that
// runs it is ui/voicebench.html (ui/voicebench.js): each step in a fresh page, so a page the phone ends is a reading and the run goes on.
//   alone   the recogniser by itself: load, memory, every bundled line as fast as it goes (real-time factor, word error rate), then three
//           lines at the speed they are spoken with silence after (first word on screen, end of speech noticed)
//   layouts (Josh's phone, Nov 2: beside the chat layout the page ended; beside the all-in-helper layout iOS ended the second process, too
//           full): the whole voice loop in layouts that leave both processes room, safest first. Each: Juli (E2B) with layers
//           0..at-1 in the second process, the recogniser on the page or in a process of its own (engine/stt/sttworker.js), loaded after
//           or before her, and her voice (ui/voiceout.js: p0voice, Flite if it cannot run); one answer from Juli, then five turns: a bundled line spoken in
//           real time, its end noticed, Juli's answer in voice mode (a mood tag first), its first sentence spoken as soon as it is
//           written. Read: the memory of every process, the latencies from the moment the speech ended, her speed, both real-time
//           factors, whether a process ended (a page that ends is recorded and the run goes on)
export const BENCH_KEY = 'p0pc0rn:voicein:bench';
const L = (at, stt, order, eta = 130) => ({ name: `Voice loop · Juli 0-${at - 1} in the helper · the recogniser ${stt === 'worker' ? 'in a process of its own' : 'on the page'}, loaded ${order} her`,
  eta, layout: { at, stt, order } });
export const STEPS = {
  alone: { name: 'Voice in · alone', eta: 60 },
  l29a: L(29, 'page', 'after'), l29b: L(29, 'page', 'before'),
  l25a: L(25, 'page', 'after'), l25b: L(25, 'page', 'before'),   // v4 (Josh's phone, Nov 2: the 0-28 helper ended once beside the snapshot): the middle way
  l21a: L(21, 'page', 'after'), l21b: L(21, 'page', 'before'),
};
export const ORDER = ['alone', 'l29a', 'l29b', 'l25a', 'l25b', 'l21a', 'l21b'];   // the page's room shrinks from first to last (a page end stops the app; a helper end gets a fresh engine)
/** v4: which layout voice mode should use, from a run: no page end first (it stops the app), then the fewest helper ends (each costs a
 *  fresh engine), then the quickest first word -> { id, at, why } or null (no layout finished) */
export function pickLayout(st) {
  const R = (st && st.res) || {}, rows = [];
  for (const id of ORDER) {
    const r = R[id], o = r && r.loop; if (!o || !STEPS[id] || !STEPS[id].layout) continue;
    const pageEnd = !!(r.ended || r.pageEnded), helper = (o.recovered || []).length + (o.ended || []).filter((x) => /SPLIT/.test(x)).length;
    rows.push({ id, at: STEPS[id].layout.at, pageEnd, helper, word: (o.med && o.med.wordMs) || 1e9 });
  }
  const ok = rows.filter((x) => !x.pageEnd).sort((a, b) => a.helper - b.helper || a.word - b.word);
  if (!ok.length) return null;
  const b = ok[0];
  return { id: b.id, at: b.at, why: `no page end, ${b.helper} helper end${b.helper === 1 ? '' : 's'}${b.word < 1e9 ? `, first word ${Math.round(b.word)} ms` : ''}` };
}
export const LOOP_LINES = ['v01', 'v03', 'v05', 'v07', 'v08'];   // five things people ask Juli
export const LOOP_TOKENS = 64;
// Josh's phone (Nov 2, a real voice chat): the chat's own prompt is what ended the second process and made her slow; three turns use it
// as the chat sends it, with the prefix snapshot (engine/llm/llm.js keepPrefix): small talk first (the voice prompt's system turn is
// kept), more small talk (a hit), then a lookup question (the planner's system turn is kept; the answer's system turn differs only in its
// last note: a partial hit)
// + weather (Josh, Nov 2: the US National Weather Service in chat): the bundled line asks about Paris (outside the US: she says the forecasts
// cover the US for now), and a typed US question reads the real forecast (api.weather.gov: the card shows the source, its time and periods)
export const REAL_TURNS = [{ id: 'v17', real: 'chat' }, { id: 'v07', real: 'again' }, { id: 'v18', real: 'lookup' }, { id: 'v01', real: 'weather' },
  { id: 'wx', real: 'weather', typed: "What's the weather like in Portland, Oregon this weekend?" }];
const REAL_NAME = { lookup: 'a lookup question (its planner, then the answer)', chat: 'small talk', again: 'more small talk', weather: 'a weather question' };
/** a weather turn: where, and the forecast's source, time and periods */
export function wxText(w) {
  if (!w) return '';
  return w.kind === 'ok' ? `${w.place}: ${w.source === 'nws' ? 'US National Weather Service' : w.source || '–'}, ${w.ms != null ? w.ms + ' ms' : '–'}, ${w.periods} periods · `
    : `${w.place ? w.place + ': ' : ''}no forecast (${w.kind}) · `;
}
/** a real turn's prefix snapshot: hit / miss (why), the tokens it read in, the MB every kept prefix takes on each side */
export function snapText(s) {
  if (!s) return 'snapshot –';
  const mbs = s.kept ? ` · the snapshots take ${s.pageMB} MB on the page${s.helperMB ? `, ${s.helperMB} MB in the helper` : ''}` : '';
  return `snapshot ${s.hit ? (s.partial ? 'partial hit' : 'hit') : 'miss'}${(!s.hit || s.partial) && s.why ? ` (${s.why})` : ''} · read in ${s.readIn != null ? s.readIn : '–'}${mbs}`;
}
export const PACED = ['v02', 'v05', 'v07'];       // spoken at their own speed, then silence: the latencies
export const LOOKAHEAD = 3, EOU_MS = 900, TAIL_S = 2.5;
export const ETA_S = ORDER.reduce((s, k) => s + STEPS[k].eta, 0) + 20;
export const planLines = () => [
  'Alone: load, memory, all 18 lines as fast as it goes (real-time factor, word errors), then 3 lines spoken in real time (first word on screen, end of speech noticed).',
  'Then the whole voice loop in four layouts, safest first: Juli with layers 0-28 in the second process (the chat’s voice layout) and the recogniser on the page, then Juli 0-20; each with the recogniser loaded after Juli, then before her.',
  'Each layout: Juli answers once, then five lines are spoken in real time and Juli answers each out loud (her own voice, p0voice; Flite if it cannot run), then three more with the chat’s own voice-mode prompt and its prefix snapshot (small talk, more small talk, a lookup question with its planner, the bundled weather question and a typed US one that reads the real forecast from the US National Weather Service). The card: every process’s memory, the time from the end of the speech to her first word and her first sound, which voice spoke and how long her first sentence took to make, her speed, whether anything ended.',
  'Every step in a fresh page; a page the phone ends is a reading and the run goes on. The test speech is bundled (made with Qwen3-TTS in the voice of CMU Flite’s slt). Results stay on this phone.',
];

export function newRun({ nonce = '', device = '', app = '' } = {}) {
  return { v: 1, nonce, device, app, startedAt: Date.now(), steps: ORDER.slice(), i: 0, res: {}, cur: null, done: false };
}
/** a page opened with this run: what to do. A step that was running when the page ended is recorded (ended: its last stage) */
export function resume(st, now = Date.now()) {
  if (!st || !Array.isArray(st.steps)) return { act: 'none' };
  if (!st.done && st.steps.some((id) => !STEPS[id])) return { act: 'none' };   // a run of an older version of this bench: never carried on
  if (st.done) return { act: 'show', st };
  if (now - (st.startedAt || 0) > 60 * 60e3) return { act: 'none' };
  if (st.cur && !st.res[st.cur.id]) {
    const id = st.cur.id, out = Object.assign({}, st, { res: Object.assign({}, st.res, { [id]: { ended: true, stage: st.cur.stage || '', at: st.cur.at || null } }), cur: null, i: st.steps.indexOf(id) + 1 });
    out.done = out.i >= out.steps.length;
    return { act: out.done ? 'show' : 'run', st: out, crashed: id, settle: 20 };
  }
  return { act: 'run', st };
}
export const begin = (st, id) => Object.assign({}, st, { cur: { id, stage: 'starting', at: Date.now() } });
export function finish(st, id, r) {
  const out = Object.assign({}, st, { res: Object.assign({}, st.res, { [id]: r }), cur: null, i: st.steps.indexOf(id) + 1 });
  out.done = out.i >= out.steps.length; if (out.done) out.endedAt = Date.now();
  return out;
}

// ---- word error rate (normalised the way the desk check normalises: lower case, punctuation dropped, hyphens -> spaces, apostrophes kept)
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFC').replace(/-/g, ' ').replace(/’/g, "'").replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/(^|\s)'+|'+(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean);
}
/** word edits (Levenshtein over words) -> {errors, words} */
export function wordErrors(ref, hyp) {
  const r = norm(ref), h = norm(hyp), d = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= h.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] === h[j - 1] ? 0 : 1)); prev = t; }
  }
  return { errors: d[h.length], words: r.length };
}
/** one fast pass's lines [{id, lang, ref, text, audioS, encMs, decMs}] -> {wer, werEn, werOther, rtf, chunkMs, exact} */
export function passStats(lines) {
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const en = lines.filter((l) => /^en/.test(l.lang)), xx = lines.filter((l) => !/^en/.test(l.lang));
  const w = (L) => { const e = L.map((l) => wordErrors(l.ref, l.text)); const n = sum(e, (x) => x.words); return n ? +(100 * sum(e, (x) => x.errors) / n).toFixed(1) : null; };
  const aud = sum(lines, (l) => l.audioS || 0), cmp = sum(lines, (l) => (l.encMs || 0) + (l.decMs || 0));
  return { lines: lines.length, wer: w(lines), werEn: w(en), werOther: w(xx), rtf: aud ? +(cmp / 1000 / aud).toFixed(3) : null,
    chunkMs: sum(lines, (l) => l.chunks || 0) ? +(cmp / sum(lines, (l) => l.chunks || 0)).toFixed(1) : null,
    exact: lines.filter((l) => norm(l.ref).join(' ') === norm(l.text).join(' ')).length };
}

const mb = (x) => (x == null ? '–' : `${Math.round(x)} MB`);
/** v4: her voice in a loop: which one spoke (her own, p0voice, or the Flite fallback and why), its load, the median time her first sentence
 *  took to make (from the sentence being written to its sound ready) and its speed; a voice that changed during the run is listed */
export function voiceText(o, turns, m = {}) {
  const played = [...new Set(turns.map((t) => t.voice).filter(Boolean))], T = o.voiceT || {};
  const why = o.voiceWhy ? ` (the fallback: ${o.voiceWhy === 'NO_WEBGPU' ? 'this browser has no WebGPU' : o.voiceWhy === 'NO_PACK' ? 'this build has no pack for her own voice' : 'her own voice did not load, ' + o.voiceWhy})` : '';
  return `Her voice: ${o.voice}${why}${T.ms != null ? ` · loaded in ${T.ms} ms${T.warmMs != null ? ` (${T.opfsMs} ms reading it, ${T.loadMs} ms to the GPU, ${T.warmMs} ms first line)` : ''}` : ''}`
    + ` · first sound ${m.voiceMs != null ? Math.round(m.voiceMs) + ' ms' : '–'} after her first sentence was written (median) · ${m.ttsX != null ? m.ttsX + 'x real time' : '–'}`
    + (played.length && (played.length > 1 || played[0] !== o.voice) ? ` · played: ${played.join(', ')}` : '');
}
const ms = (x) => (x == null ? '–' : `${Math.round(x)} ms`);
/** the card: one block a step */
export function cardText(st) {
  if (!st) return '';
  const L = [`Voice in bench · ${st.app || ''} · ${st.device || ''}`.trim(), new Date(st.startedAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    `NVIDIA Nemotron 3.5 ASR Streaming 0.6B (int8) · ${LOOKAHEAD + 1} frames a chunk (${(LOOKAHEAD + 1) * 80} ms) · end of speech after ${EOU_MS} ms of quiet`];
  for (const id of st.steps) {
    const r = st.res[id], S = STEPS[id]; L.push('', S ? S.name : `${id} (from an older version of this bench)`);
    if (!r) { L.push('  not run'); continue; }
    if (r.notRun) { L.push(`  not run: ${r.notRun}`); continue; }
    if (r.ended) { L.push(`  THE PAGE ENDED while ${r.stage || 'it ran'}`); continue; }
    if (r.error) L.push(`  error: ${r.error}`);
    if (r.juli) {
      const j = r.juli;
      L.push(`  Juli: ${j.at ? `layers 0-${j.at - 1} in the second process` : 'one process'} · load ${j.loadS} s · page ${mb(j.pageMB)} + helper ${mb(j.helperMB)}${j.drafter ? ' · faster replies' : ''}`);
      L.push(`  Juli answers: before ${j.tokPerS1 != null ? j.tokPerS1 + ' tok/s' : '–'} · beside the recogniser ${j.tokPerS2 != null ? j.tokPerS2 + ' tok/s' : j.err2 ? 'FAILED ' + j.err2 : '–'}`);
    }
    if (r.load) L.push(`  Recogniser: load ${r.load.s} s · its GPU memory ${mb(r.load.gpuMB)} · the page's GPU memory ${mb(r.load.pageGpuMB)}${r.load.jsMB != null ? ` · JS ${mb(r.load.jsMB)}` : ''}`);
    if (r.fast) L.push(`  ${r.fast.lines} lines as fast as it goes: real-time factor ${r.fast.rtf} (${r.fast.chunkMs} ms a chunk) · word errors ${r.fast.wer} % (English ${r.fast.werEn} %, other languages ${r.fast.werOther} %) · ${r.fast.exact} exact`);
    if (r.paced) L.push(`  Spoken in real time: first word on screen ${ms(r.paced.firstWordMs)} after the speech starts · end of speech noticed ${ms(r.paced.endMs)} after it ends (median of ${r.paced.n})`);
    if (r.misses && r.misses.length) for (const m of r.misses.slice(0, 4)) L.push(`    ${m.id}: "${m.text}"`);
    if (r.loop) {
      const o = r.loop, m = o.med || {}, j = o.juli || {}, k = o.mem || {};
      L.push(`  Loaded: ${(o.order || []).join(', then ')}`);
      if (o.juli) L.push(`  Juli: ${j.at ? `layers 0-${j.at - 1} in the second process` : 'one process'} · load ${j.loadS} s · page ${mb(j.pageMB)} + helper ${mb(j.helperMB)}${j.drafter ? ' · faster replies' : ''} · first answer ${j.tokPerS1 != null ? j.tokPerS1 + ' tok/s' : '–'}`);
      if (o.stt) L.push(`  Recogniser: ${o.stt.where === 'worker' ? `its own process (${o.stt.coep ? 'COEP' : 'no COEP'}), ${mb(o.stt.gpuMB)} there` : `on the page, ${mb(o.stt.gpuMB)}`} · load ${o.stt.loadS} s`);
      L.push(`  All three loaded: page GPU ${mb(k.pageGpuMB)} · Juli's helper ${mb(k.helperMB)}${k.sttHelperMB != null ? ` · the recogniser's process ${mb(k.sttHelperMB)}` : ''} · voice ${mb(k.voiceMB)} (${o.voice || '–'})${k.jsMB != null ? ` · JS ${mb(k.jsMB)}` : ''}`);
      L.push(`  ${o.turns.filter((t) => t.reply).length} of ${o.turns.length} turns answered; the bench prompt's medians from the end of the speech: end noticed ${ms(m.eouMs)} · Juli's first word ${ms(m.wordMs)} · her first sound ${ms(m.audioMs)} · Juli ${m.tokPerS != null ? m.tokPerS + ' tok/s' : '–'} · recogniser real-time factor ${m.sttRtf != null ? m.sttRtf : '–'} · voice ${m.ttsX != null ? m.ttsX + 'x real time' : '–'}`);
      for (const t of o.turns.filter((x) => x.real)) L.push(`  The chat’s own prompt, ${REAL_NAME[t.real] || t.real}: ${t.error ? 'FAILED ' + t.error : `${t.typed ? 'typed: ' : ''}${wxText(t.wx)}${(t.promptTokens || []).join(' + ')} prompt tokens · ${t.planSnap ? `the planner's ${snapText(t.planSnap)}, the answer's ` : ''}${snapText(t.snap)} · first word ${ms(t.wordMs)} · first sound ${ms(t.audioMs)} after ${t.typed ? 'it was sent' : 'the speech ended'} · ${t.tokPerS != null ? t.tokPerS + ' tok/s' : '–'}`}`);
      if (o.warm) L.push(`  Warm-up (the voice prompt and the planner, ${(o.warm.readIn || []).join(' + ')} tokens, ${ms(o.warm.ms)}) while a line was spoken: recogniser real-time factor ${o.warm.rtf != null ? o.warm.rtf : '–'} (${m.sttRtf != null ? m.sttRtf : '–'} without), end noticed ${ms(o.warm.eouMs)}${o.warm.error ? ' · FAILED ' + o.warm.error : ''}`);
      if (o.voice) L.push(`  ${voiceText(o, o.turns.filter((t) => !t.real), m)}`);   // v4
      for (const x of o.recovered || []) L.push(`  Juli's second process ended at ${x.at} (${x.code}): a fresh engine, the same layout, in ${ms(x.ms)}${x.ok ? '' : ' (it did not load)'}`);
      L.push(`  Ended: ${o.ended && o.ended.length ? o.ended.join(', ') : (o.recovered || []).length ? 'nothing else' : 'nothing (every process stayed up)'}`);
      for (const t of o.turns.slice(0, 5)) L.push(`    ${t.id}: heard "${(t.heard || '').slice(0, 50)}" -> ${t.moods && t.moods.length ? '[' + t.moods.join(' and ') + '] ' : ''}"${(t.reply || t.error || '').slice(0, 60)}"${t.voiceMs != null ? ` · voice ${t.voiceMs} ms` : ''}`);
    }
  }
  const pk = pickLayout(st); if (pk) L.push('', `Voice mode's layout from this run: Juli 0-${pk.at - 1} in the helper (${pk.why}).`);   // v4
  if (st.done) L.push('', 'Results stay on this phone. Copy shares the card.');
  return L.join('\n');
}
