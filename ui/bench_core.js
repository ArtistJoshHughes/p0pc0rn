// bench_core.js - p0pc0rn 3.9: Settings › Benchmark › Full's feature checks, the pure part. Josh (Oct-26): "we also need the full bench
// test in the popcorn app under settings. Including everything up to this point so as to ensure all features get a pass fail". Full
// keeps 3.8's speed tests exactly (their numbers compare run to run) and adds a pass / fail line for every feature; this module says which
// checks run on this phone and in what order, sums them up for the card, derives the lines that come from the speed tests' own results
// and compares the person's data before and after (the checks use test data only and remove it). No DOM, no storage: node-tested.
// The checks themselves are ui/bench_features.js.

/** every feature check: name (the card's words), group (when it runs), needs (what this phone must have), eta (seconds, for the plan).
 *  Groups, in run order: 'idle' (no model: before any model loads), 'juli' (Juli's own model, right after her speed tests: no swap),
 *  'big' (after the Bigger brain's speed tests: the Bigger brain where it runs, else Juli), 'icon' (before the picture test: its model
 *  is then in memory for it), 'final' (last: the lines that come from the speed tests, and the person's data compared) */
export const FEATURES = {
  'shell.home': { name: 'Home screen · every icon with its name', group: 'idle', eta: 3, needs: ['shell'] },
  'shell.dock': { name: 'Dock · Juli, Create, Music, Settings', group: 'idle', eta: 2, needs: ['shell'] },
  'shell.pill': { name: 'The p0pc0rn pill above the dock opens Juli', group: 'idle', eta: 3, needs: ['shell'] },
  'shell.screens': { name: 'Every screen opens and goes back home', group: 'idle', eta: 14, needs: ['shell'] },
  'shell.badge': { name: 'A red number badge at the top left, set and cleared', group: 'idle', eta: 2, needs: ['shell'] },
  'shell.wall': { name: 'The wallpaper behind the icons, blurred', group: 'idle', eta: 1, needs: ['shell'] },
  'shell.conn': { name: 'Connection says only “Coming soon”', group: 'idle', eta: 2, needs: ['shell'] },
  'shell.edit': { name: 'Edit mode: a long press on, Done off', group: 'idle', eta: 3, needs: ['shell'] },
  'shell.pin': { name: 'A made app added to the home screen and taken off', group: 'idle', eta: 3, needs: ['shell', 'apps'] },
  'skills.load': { name: 'Skills · the five that come with p0pc0rn', group: 'idle', eta: 1, needs: ['skills'] },
  'skills.words': { name: 'Skills · picked by the words of a request', group: 'idle', eta: 1, needs: ['skills'] },
  'skills.named': { name: 'Skills · “use my … skill” picks that skill', group: 'idle', eta: 1, needs: ['skills'] },
  'chat.actions': { name: 'Chat · the action bubbles for each kind of result', group: 'idle', eta: 1, needs: ['chat'] },
  'music.player': { name: 'Music · play, pause, next, seek (test tones)', group: 'idle', eta: 10, needs: ['music'] },
  'music.lock': { name: 'Music · the lock-screen details and buttons', group: 'idle', eta: 1, needs: ['music'] },
  'memory.beat': { name: 'Routines · a due one runs once, none while busy', group: 'idle', eta: 1, needs: ['memory'] },
  'chat.reply': { name: 'Chat · Juli answers in a new conversation', group: 'juli', eta: 30, needs: ['brain'] },
  'chat.unread': { name: 'Chat · an answer you have not seen counts on Juli’s badge, and goes', group: 'juli', eta: 1, needs: ['brain', 'chat'] },
  'memory.about': { name: 'About me · reaches Juli (test text; yours is not touched)', group: 'juli', eta: 25, needs: ['brain', 'memory'] },
  'memory.routine': { name: 'Routines · a routine’s message gets an answer', group: 'juli', eta: 25, needs: ['brain', 'memory'] },
  'chat.writing': { name: 'Chat · Juli writes a piece herself when the Bigger brain is not used', group: 'juli', eta: 30, needs: ['brain'] },
  'games.c4': { name: 'Games · Juli plays Four in a Row: legal, wins, blocks', group: 'juli', eta: 60, needs: ['brain', 'games'] },
  'split.beat': { name: 'Two processes · the helper’s heartbeat', group: 'juli', eta: 1, needs: ['brain', 'split'] },
  'big.writing': { name: 'Bigger brain · writes when asked to write', group: 'big', eta: 60, needs: ['brain', 'brain4'] },
  'apps.make': { name: 'Make an app · from one sentence, and it starts', group: 'big', eta: 100, needs: ['brain', 'apps'] },
  'apps.change': { name: 'Change an app · by asking, and it starts after', group: 'big', eta: 150, needs: ['brain', 'apps', 'edit'] },
  'apps.icon': { name: 'Add to Home Screen · Make an icon: one picture on a test pin', group: 'icon', eta: 120, needs: ['apps', 'shell', 'icon', 'picture'] },
  'final': { name: 'The checks’ results', group: 'final', eta: 3, needs: [] },
};
/** the lines 'final' adds from the speed tests' own results and the data check (derive() below); a media line is 'not run' with its
 *  reason when its test was not planned (bench.js: the model is not downloaded) */
export const DERIVED = {
  'apps.open': 'Apps · every app that comes with p0pc0rn starts',
  'agentic.trip': 'Agentic app · Trip Watch’s check with Juli (test data)',
  'split.juli': 'Two processes · Juli’s first layers in the helper',
  'split.big': 'Two processes · the Bigger brain’s first layers in the helper',
  'split.stayed': 'Two processes · stayed up for the whole run',   // 3.9 (Josh's phone, Oct-26: the card said split while Juli went on in one process)
  'media.picture': 'Picture · made',
  'media.clip': 'Clip · made',
  'media.song': 'Song · made',
  'data.same': 'Your data is as it was (conversations, apps, home screen, wallpaper, About me, routines, playlists)',
};
const WHY = {
  shell: 'the 3.9 home screen is not in this build', apps: 'the Apps tab has not started', skills: 'skills are not in this build',
  chat: 'the 3.9 chat is not in this build', music: 'Music is not in this build', memory: 'About me and Routines are not in this build',
  brain: 'Juli is not downloaded (Settings › Models)', brain4: 'the Bigger brain does not run here (or is off)', games: 'Four in a Row is not on this phone',
  edit: 'changing an app is not in this build', split: 'one process on this phone (no helper)',
  icon: 'Make an icon is not in this build', picture: 'the picture model is not downloaded (Settings › Models)',
};
/** which feature checks run on this phone -> { ids (by group), skipped: [{id, why}] }. env: { shell, apps, skills, chat, music, memory,
 *  brain, brain4, games, edit, split, icon, picture } (true = this phone has it). 'apps.make' and 'apps.change' need only Juli (the
 *  Bigger brain plans them where it runs) */
export function featurePlan(env = {}) {
  const groups = { idle: [], juli: [], big: [], icon: [], final: [] }, skipped = [];
  for (const [id, F] of Object.entries(FEATURES)) {
    const miss = F.needs.filter((n) => !env[n]);
    if (miss.length) { skipped.push({ id, why: WHY[miss[0]] || miss[0] }); continue; }
    groups[F.group].push(id);
  }
  return { groups, skipped };
}
const FK = (id) => 'f:' + id;
export const isFeature = (k) => typeof k === 'string' && k.startsWith('f:');
export const featureOf = (k) => (isFeature(k) ? k.slice(2) : null);
/** the whole run: 3.8's speed tests in their order (tests38: the keys bench.js planned) with the feature groups between them: idle checks
 *  first (before any model), Juli's right after her speed tests, the Bigger brain's after its tests, the icon's before the picture
 *  test (the picture model stays in memory for it), final last */
export function runOrder(tests38, groups) {
  const juli = ['chat', 'readin', 'longanswer'], big = ['e4bchat', 'e4breadin', 'e4blong'], media = ['picture', 'clip', 'song'];
  const has = (k) => tests38.includes(k), out = groups.idle.map(FK);
  for (const k of juli) if (has(k)) out.push(k);
  out.push(...groups.juli.map(FK));
  for (const k of tests38) if (!juli.includes(k) && !big.includes(k) && !media.includes(k)) out.push(k);   // the apps step (and any other)
  for (const k of big) if (has(k)) out.push(k);
  out.push(...groups.big.map(FK));
  out.push(...(groups.icon || []).map(FK));
  for (const k of media) if (has(k)) out.push(k);
  out.push(...groups.final.map(FK));
  return out;
}
/** seconds the planned run should take: speed tests' etas (tests38Eta: key -> s) + the feature checks' */
export function etaOf(order, tests38Eta = {}) {
  return order.reduce((s, k) => s + (isFeature(k) ? (FEATURES[featureOf(k)] || { eta: 0 }).eta : (tests38Eta[k] || 0)), 0);
}

// ------------------------------------------------------------------------------------------------ results
/** one check's result: ok true (pass) | false (fail) | null (not run here, with why); s = its seconds */
export const pass = (why = '', extra = {}) => Object.assign({ ok: true, why: String(why || '') }, extra);
export const fail = (why, extra = {}) => Object.assign({ ok: false, why: String(why || 'failed').slice(0, 200) }, extra);
export const notRun = (why, extra = {}) => Object.assign({ ok: null, why: String(why || '') }, extra);
/** -> { pass, fail, notRun, total } over a feature map (id -> result) */
export function summary(features = {}) {
  const v = Object.values(features);
  return { pass: v.filter((x) => x && x.ok === true).length, fail: v.filter((x) => x && x.ok === false).length,
    notRun: v.filter((x) => x && x.ok == null).length, total: v.length };
}
export const nameOf = (id) => (FEATURES[id] && FEATURES[id].name) || DERIVED[id] || id;
/** the card's order: the checks in the order a run makes them (runOrder: the no-model checks, Juli's, the apps step, the Bigger
 *  brain's, the icon), each line that comes from a speed test at that test's place, the two whole-run lines last */
export function cardOrder() {
  const of = (g) => Object.keys(FEATURES).filter((id) => FEATURES[id].group === g);
  return [...of('idle'), 'split.juli', ...of('juli'), 'apps.open', 'agentic.trip', 'split.big', ...of('big'), ...of('icon'), 'media.picture', 'media.clip', 'media.song', 'split.stayed', 'data.same'];
}
/** the card's feature lines: the count, then ONE line a check (fails first so they are seen), in the order they ran (3.9: an order
 *  that names a check twice still gives it one line, its result: the card printed every line twice) */
export function featureLines(features = {}, order = Object.keys(features)) {
  const s = summary(features), L = [`Features: ${s.pass} pass, ${s.fail} fail${s.notRun ? `, ${s.notRun} not run` : ''}`];
  const ids = [...new Set([...order, ...Object.keys(features)])].filter((id) => features[id]);
  const line = (id) => { const r = features[id], t = r.s != null ? ` · ${r.s} s` : ''; return r.ok === true ? `✓ ${nameOf(id)}${r.why ? ': ' + r.why : ''}${t}`
    : r.ok === false ? `✗ ${nameOf(id)}: ${r.why}${t}` : `– ${nameOf(id)}: not run (${r.why || 'not on this phone'})`; };
  for (const id of ids) if (features[id].ok === false) L.push(line(id));
  for (const id of ids) if (features[id].ok !== false) L.push(line(id));
  return L;
}
/** the lines that come from the speed tests' own results (r.tests) and the run's skip reasons: the apps step (every app starts, Trip
 *  Watch's check), each model's load (split = its first layers in the helper process; only expected where env.split), the picture /
 *  clip / song. A test that was not planned gives no line; one that did not finish is a fail. 3.9: runSplit = the run's second-process
 *  events (splitScan below): one of them = the two processes did not stay up (a load line only says how the model loaded) */
export function derive(tests = {}, env = {}, runSplit = null) {
  const out = {}, err = (v) => v && v.error;
  const a = tests.apps;
  if (a) {
    if (err(a)) { out['apps.open'] = fail(a.error); }
    else {
      out['apps.open'] = a.of && a.started === a.of ? pass(`${a.started}/${a.of}`) : fail(`${a.started}/${a.of} started${(a.problems || []).length ? ': ' + a.problems[0] : ''}`);
      if (a.trip) out['agentic.trip'] = a.trip.ok ? pass(`${a.trip.flags} to look at, ${a.trip.seconds} s`) : fail(a.trip.said || 'no answer');
    }
  }
  const split = (k, id) => {
    const v = tests[k]; if (!v) return;
    if (err(v)) { out[id] = fail('its test did not finish: ' + v.error); return; }
    const sp = v.load && v.load.split;
    if (!env.split) { out[id] = notRun(sp ? 'split, but not expected here' : 'one process on this phone'); return; }
    out[id] = sp ? pass(`page ${sp.pageMB} MB + helper ${sp.workerMB} MB`) : fail('loaded in one process' + (v.load && v.load.splitError ? ': ' + v.load.splitError : ''));
  };
  split('chat', 'split.juli'); split('e4bchat', 'split.big');
  const llm = LLM_TESTS.filter((k) => tests[k]), ev = (runSplit && runSplit.log) || [];   // 3.9: the whole run, once a language-model test was planned
  if (llm.length) out['split.stayed'] = !env.split ? notRun('one process on this phone') : ev.length ? fail(splitText(ev))
    : llm.some((k) => !err(tests[k])) ? pass('no second process stopped or went unused') : notRun('no language-model test finished');
  for (const [k, id] of [['picture', 'media.picture'], ['clip', 'media.clip'], ['song', 'media.song']]) {
    const v = tests[k]; if (!v) continue;
    out[id] = err(v) ? fail(v.error) : pass(v.seconds != null ? `${v.seconds} s` : '');
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the second processes during a run
// 3.9 (Josh's phone, Oct-26): Juli's second process stopped answering in the long read-in, the fresh one did not start, and she went on
// in ONE process; the card still said "split" for every line after it. The app writes each such event to its diagnostics (app.js
// diag(): wire() 'second process failed' {model, code, raw}, 'bigger brain off for this page'; loadBrain / onSplitOff 'split not used'
// {why}: Juli's; loadBrain4 'bigger brain did not load' {code}), which keep the last 200 steps over a page's end: the bench reads the
// new ones after every step (bench.js) and keeps the events with the step they happened in.
export const LLM_TESTS = ['chat', 'readin', 'longanswer', 'e4bchat', 'e4breadin', 'e4blong'];
const WHO = { brain: 'Juli', brain4: 'the Bigger brain' };
const shortWhy = (s) => String(s || '').replace(/^split: /, '').replace(/^the worker part /, '').replace(/: its process may have ended\.?$/, '').slice(0, 80);
/** one diagnostics step -> {model, code, what, off} when it says a second process stopped, ended or was not used (off = that model goes
 *  on in one process in this page; SPLIT_RETRY: the engine tries a fresh one first), else null */
export function splitEvent(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.step === 'second process failed') { const retry = r.code === 'SPLIT_RETRY'; return { model: r.model === 'brain4' ? 'brain4' : 'brain', code: r.code || null, what: shortWhy(r.raw) || (retry ? 'stopped' : 'ended'), off: !retry }; }
  if (r.step === 'split not used') return { model: 'brain', code: null, what: 'not used' + (r.why ? ` (${shortWhy(r.why)})` : ''), off: true };
  if (r.step === 'bigger brain off for this page') return { model: 'brain4', code: 'SPLIT_GONE', what: 'ended (the Bigger brain is off for this page)', off: true };
  if (r.step === 'bigger brain did not load' && /^SPLIT_/.test(String(r.code || ''))) return { model: 'brain4', code: r.code, what: 'did not start' + (r.error ? ` (${shortWhy(r.error)})` : ''), off: true };
  return null;
}
/** a diagnostics step's short key (FNV-1a of it as JSON): the cursor the next look starts after, without keeping the step itself */
export function rowKey(r) {
  let s = ''; try { s = JSON.stringify(r); } catch (e) { s = String(r); }
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${s.length}:${h.toString(16)}`;
}
/** the diagnostics steps after the one the cursor names -> {rows, cursor}. A cursor the log no longer holds (more than 200 steps since,
 *  or it was cleared): every step it has is new. cursor null = none yet: nothing counts (the run starts after the last step) */
export function diagSince(rows, cursor) {
  const L = Array.isArray(rows) ? rows : [], last = L.length ? rowKey(L[L.length - 1]) : cursor || null;
  if (cursor == null) return { rows: [], cursor: last };
  let at = -1; for (let i = L.length - 1; i >= 0; i--) if (rowKey(L[i]) === cursor) { at = i; break; }
  return { rows: L.slice(at + 1), cursor: last };
}
/** one look at the diagnostics: the run's state {cursor, log: [{t, at, model, code, what}] (at most 8), off: {brain, brain4} (that model
 *  went on in one process in THIS page: a page's own start tries the split again)} -> the new state; at = the step's name */
export function splitScan(rows, st = {}, at = '') {
  const { rows: R, cursor } = diagSince(rows, st.cursor == null ? null : st.cursor), log = (st.log || []).slice(), off = Object.assign({ brain: null, brain4: null }, st.off || {});
  for (const r of R) {
    if (!r || typeof r !== 'object') continue;
    if (r.step === 'page open') { off.brain = null; off.brain4 = null; continue; }
    if (r.step === 'Juli split') { off.brain = null; continue; }
    if (r.step === 'bigger brain loaded' && r.split) { off.brain4 = null; continue; }
    const e = splitEvent(r); if (!e) continue;
    if (log.length < 8) log.push({ t: String(r.t || ''), at: String(at || '').slice(0, 60), model: e.model, code: e.code, what: e.what });
    if (e.off) off[e.model] = e.what;
  }
  return { cursor, log, off };
}
/** the card's words for the run's second-process events: the first with the step it happened in, then the next two, then how many more */
export function splitText(ev = []) {
  const one = (e) => `${WHO[e.model] || 'Juli'}’s second process: ${e.what}${e.at ? ` in “${e.at}”` : ''}`;
  return one(ev[0]) + ev.slice(1, 3).map((e) => `; then ${(WHO[e.model] || 'Juli')}’s: ${e.what}`).join('') + (ev.length > 3 ? `; ${ev.length - 3} more` : '');
}

// ------------------------------------------------------------------------------------------------ a page that ended during a run
/** 3.9 (Josh, Oct-26: "all features get a pass fail"): an UNPLANNED reload (the phone ended the page; a planned fresh page carries the
 *  run on) fails the step it happened in, and a Full run goes on with the next one, unless it is the run's RELOADS_MAX-th or the same
 *  step's as the one before (the run then stops there, as 3.8's did). reloads = the run's earlier ones [{i}] -> {stop, why} */
export const RELOADS_MAX = 2;
export function afterReload(reloads = [], i) {
  const L = Array.isArray(reloads) ? reloads : [], last = L[L.length - 1], n = L.length + 1;
  if (last && last.i === i) return { stop: true, why: 'the same check reloaded twice in a row' };
  if (n >= RELOADS_MAX) return { stop: true, why: `the page reloaded ${n} times in this run` };
  return { stop: false, why: '' };
}

// ------------------------------------------------------------------------------------------------ the person's data, before and after
/** keys compared as "never lower": {id: count} as JSON (the Chats list's unread counts: the person's own apps may post meanwhile, but
 *  the run never marks the person's messages read) */
export const NEVER_LOWER = new Set(['chats unread']);
const lowered = (x, y) => { let A, B; try { A = JSON.parse(x || '{}'); B = JSON.parse(y || '{}'); } catch (e) { return x !== y; } return Object.keys(A).some((id) => id in B && (Number(B[id]) || 0) < (Number(A[id]) || 0)); };
/** the keys whose values differ between two snapshots ({key: string}); a key only one side has counts */
export function snapDiff(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => (NEVER_LOWER.has(k) && k in a && k in b ? lowered(a[k], b[k]) : a[k] !== b[k])).sort();
}
/** test data the run made, so a later page can remove what a stopped run left: [{k: 'session' | 'app' | 'thread', id}]; 3.9: + {k: 'home',
 *  id, v}: the home screen's keys as they were (v: their raw values), put back as they were. The first entry for a k + id stays */
export function fxAdd(list, fx) { const L = Array.isArray(list) ? list.slice() : []; if (fx && fx.k && fx.id && !L.some((x) => x.k === fx.k && x.id === fx.id)) L.push(Object.assign({ k: fx.k, id: fx.id }, fx.v !== undefined ? { v: fx.v } : {})); return L; }
export function fxDrop(list, fx) { return (Array.isArray(list) ? list : []).filter((x) => !(x.k === fx.k && x.id === fx.id)); }
/** the bench's own test names (an app it made or changed, a conversation's first line): never the person's */
export const TEST_NAME = 'Benchmark test';
export const isTestName = (s) => typeof s === 'string' && s.startsWith(TEST_NAME);

// ------------------------------------------------------------------------------------------------ Four in a Row positions for Juli
/** R = the game's own rules (ui/bench_c4.js, made from the skeleton's RULES block) -> fixed positions where Juli (O, 2) moves next:
 *  win (she can win now), block (the person wins next unless she blocks), quiet (neither: any legal move passes). X (1) moves first */
export function c4Positions(R) {
  const after = (cols) => { let b = R.emptyBoard(), who = 1; for (const c of cols) { const p = R.play(b, c, who); if (!p) throw new Error('bad position'); b = p.board; who = 3 - who; } return b; };
  return [
    // O has three in column D (3) and moves next (an odd number of moves): D wins (X played A, B, G, F between: no threat of its own)
    { name: 'win', board: after([0, 3, 1, 3, 6, 3, 5]), expect: 'win' },
    // X has A, B, C on the bottom row (O played E, E between): X wins next in D: O must block D
    { name: 'block', board: after([0, 4, 1, 4, 2]), expect: 'block' },
    // nothing to win or block
    { name: 'quiet', board: after([3]), expect: 'legal' },
  ];
}
/** was Juli's column right for the position? -> {ok, why} (col = her column index; -1 = none) */
export function c4Judge(R, pos, col) {
  const legal = R.legalCols(pos.board);
  if (!legal.includes(col)) return { ok: false, why: `not a legal column (${col})` };
  if (pos.expect === 'win') { const w = R.winsNow(pos.board, 2); return w.includes(col) ? { ok: true, why: 'took the win' } : { ok: false, why: `missed the win in ${w.map((c) => R.NAMES[c]).join('/')}` }; }
  if (pos.expect === 'block') { const t = R.winsNow(pos.board, 1); return t.includes(col) ? { ok: true, why: 'blocked' } : { ok: false, why: `did not block ${t.map((c) => R.NAMES[c]).join('/')}` }; }
  return { ok: true, why: 'legal' };
}
