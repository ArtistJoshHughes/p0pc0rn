// freshapp.js - p0pc0rn 3.9: the app on screen across a PLANNED fresh page (app.js freshPage: on WebKit, before a model loads after
// another one, the app reloads into a clean page and its jobs go on there). Josh, Oct-26, playing Connect Four right after a benchmark
// had left the Bigger brain as the last model: "The first time I loaded the game it switched models and sent me back to the game select
// screen. But after that Juli was super fast". freshPage kept the screen (the tab, an open storyboard, the queue sheet) but not the open
// app: the new page showed the Apps list. Now freshPage also keeps the open app's id (openAppOf), and restoreUi opens that app again the
// person's way, through the Apps host's own openApp (reopenApp: the permission sheet when it is not allowed, the wait while a model is
// busy). Juli's move that switched the models (the queue job 'appchoose') was asked by the game of the page that went, and the queue
// resumes it on the new page: it is not run on a model again (freshMoves: it answers 'fallback' at once and leaves the queue), and the
// reopened game, which saved its board, asks again on its turn: one move, one job, the game never waits on the old one.

const PAGE_T0 = Date.now();   // this page's start: a move job added before it was asked by a game of an earlier page

/** the app open on screen (its id), for a planned fresh page's ui; null when none, and for the benchmark's own test apps (its checks
 *  open them again themselves, with their permissions in memory) */
export function openAppOf(APPS) {
  try { const o = APPS && APPS.state && APPS.state.open, app = o && o.app; return app && app.id && app.from !== 'bench' ? String(app.id) : null; } catch (e) { return null; }
}

/** after the planned fresh page: the app opens again once the Apps tab has started (its own openApp) -> true when it was asked to open;
 *  false when the tab did not start within ms, the app is gone, or another app is already open */
export async function reopenApp(APPS, id, ms = 8000) {
  const t0 = Date.now(), ready = () => { const A = APPS && APPS.state; return !!(A && A.db && A.skels && A.skels.size); };
  while (!ready()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 100)); }
  const A = APPS.state, app = (A.apps || []).find((a) => a.id === id);
  if (!app || A.open) return false;
  await APPS.openApp(app);
  return true;
}

/** the 'appchoose' runner (makeapp/host.js chooseRunner) with a move from an earlier page answered without a model: the game that asked
 *  it went with that page (a planned fresh page, or the page ended). It needs no model (nothing loads for it), answers the game's own
 *  first option by 'fallback' (as when Juli cannot answer) and leaves the queue once done; getQ() -> the queue */
export function freshMoves(runner, getQ) {
  const old = (j) => !!j && (Number(j.createdAt) || 0) < PAGE_T0;
  return Object.assign({}, runner, {
    model: (j) => (old(j) ? null : runner.model(j)),
    async run(ctx) {
      if (!old(ctx.job)) return runner.run(ctx);
      const Q = getQ(), id = ctx.job.id;
      if (Q) { const offs = ['done', 'failed', 'cancelled'].map((n) => Q.on(n, (j) => { if (j.id !== id) return; offs.forEach((o) => o()); setTimeout(() => Q.remove(id).catch(() => {}), 0); })); }
      return { index: 0, by: 'fallback', stale: true, said: [] };
    },
  });
}
