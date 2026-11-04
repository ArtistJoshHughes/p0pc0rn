// boot_crumbs.js - crash breadcrumbs for the boot (and the later heavy loads). A page the phone kills for memory runs no handler, so
// the game writes where it is as it goes (localStorage, `p0pc0rn:trolley:boot`): the last milestone (the physics, the hall's
// textures, the first frame, the start card, play...) and the loads in flight (each model, the open world, Juli's model). A clean
// leave (pagehide) or 10 s of stable play with nothing loading clears it. A record still there when the page opens again means the
// last one stopped there: the start card says so in one line, and it goes into the app's Diagnostics (`p0pc0rn:diag`, the same rows
// Settings > About > Diagnostics shows). Every storage access is wrapped: with storage blocked the game runs and remembers nothing.
export const CRUMB_KEY = 'p0pc0rn:trolley:boot', DIAG_KEY = 'p0pc0rn:diag', STABLE_S = 10;

const LABELS = {
  start: 'the page', rapier: 'the physics', 'tex:hall': "the hall's textures", data: "the open world's data", 'gltf:trolley': "the trolley's model",
  'gltf:arm': "the arm's model", 'first-frame': 'the first frame', ready: 'the start card', play: 'the first moments of play', 'juli:load': "Juli's model",
  'world:open': 'the open world', 'juli:plot': "Juli's plotting (the Bigger brain, in the loading screen)", 'voice:load': "Juli's voice", landing: 'the landing screen',
};
/** a stage's words for the start card */
export function crumbLabel(stage) {
  if (!stage) return 'the game';
  if (LABELS[stage]) return LABELS[stage];
  if (stage.startsWith('world:')) return `the ${stage.slice(6)} quadrant's models`;
  if (stage.startsWith('gltf:')) return `a model (${stage.slice(5)})`;
  return stage;
}

/** createCrumbs({ store, now, clock }) -> { last, line, stage(name), begin(name), end(name), tick(playing), clear(), inflight(), log, report(diagExtra) }
 *  store: localStorage (or a stand-in); now: wall time (ms, for the record); clock: play time (s, for the 10 s of stable play) */
export function createCrumbs({ store = (() => { try { return globalThis.localStorage || null; } catch (e) { return null; } })(), now = () => Date.now(), clock = () => 0 } = {}) {
  const read = (k) => { try { const v = store && store.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const write = (k, o) => { try { if (!store) return; if (o == null) store.removeItem(k); else store.setItem(k, JSON.stringify(o)); } catch (e) { /* storage full or blocked */ } };
  const last = read(CRUMB_KEY);   // what the previous page left behind: it stopped there
  const S = { stage: null, inflight: [], changedAt: 0, cleared: true, log: [] };
  const save = () => { S.cleared = false; S.changedAt = clock(); write(CRUMB_KEY, { v: 1, stage: S.stage, loading: S.inflight.slice(0, 8), at: now() }); };
  const mark = (what, name) => { S.log.push([what, name, Math.round(now())]); if (S.log.length > 200) S.log.shift(); };
  function stage(name) { S.stage = name; mark('stage', name); save(); }
  function begin(name) { S.inflight.push(name); mark('begin', name); save(); }
  function end(name) { const i = S.inflight.indexOf(name); if (i >= 0) S.inflight.splice(i, 1); mark('end', name); save(); }
  /** call every few frames: once play has run STABLE_S seconds with nothing loading and no new stage, the record goes */
  function tick(playing) { if (S.cleared || !playing || S.inflight.length) return; if (clock() - S.changedAt >= STABLE_S) { write(CRUMB_KEY, null); S.cleared = true; mark('clear', 'stable'); } }
  function clear() { write(CRUMB_KEY, null); S.cleared = true; }
  /** the previous page's stop, in words: what was loading (or the stage it had reached) */
  const what = last ? (last.loading && last.loading.length ? last.loading.slice(0, 2).map(crumbLabel).join(' and ') : crumbLabel(last.stage)) : null;
  const line = last ? `Last time Troll-E stopped while loading ${what}.` : null;
  /** the stop into the app's Diagnostics (at most 200 rows, the oldest dropped), once */
  let reported = false;
  function report(extra = {}) {
    if (!last || reported) return false; reported = true;
    try {
      const d = new Date(), t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      const rows = read(DIAG_KEY); const all = (Array.isArray(rows) ? rows : []).concat(Object.assign({ t, step: 'Troll-E stopped while loading', stage: last.stage || null, loading: last.loading || [], when: last.at ? new Date(last.at).toISOString() : null }, extra)).slice(-200);
      write(DIAG_KEY, all); return true;
    } catch (e) { return false; }
  }
  return { last, line, stage, begin, end, tick, clear, report, inflight: () => S.inflight.slice(), get stageNow() { return S.stage; }, log: S.log };
}
