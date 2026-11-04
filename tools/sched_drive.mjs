// sched_drive.mjs - p0pc0rn v4: drive the scheduler bench (schedbench.html) in a Chrome that is already running with
// --remote-debugging-port (the autotune harness's headless Chrome, reached directly or through an SSH tunnel): open the page in a new
// tab, print its log as it goes, save the partial result every 30 s, and write <out>.json and <out>.md (the results card) at the end.
// Never a hang (a desktop run of a4e003e sat 3 hours on a page that stopped answering):
//   - every DevTools call has a time limit (--eval-timeout, 20 s); a page that does not answer counts as no progress;
//   - no new log line for --stall-min minutes (10) = the run is stalled: the last partial is saved, <out>.json and <out>.md say so, and
//     the driver exits with code 3; a browser that went away (its connection closed) the same way, code 4; --timeout (7200 s) code 5.
// Nothing here clicks anything on the page but its own Run (autostart does that), and nothing is written to the browser's storage.
//   node tools/sched_drive.mjs --cdp 127.0.0.1:9333 --url "http://127.0.0.1:8766/app/schedbench.html?bench=scheduler&autostart=1&pack=/pack/" --out results/desktop [--timeout 7200] [--stall-min 10]
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CDP = arg('--cdp', '127.0.0.1:9333'), URL0 = arg('--url'), OUT = arg('--out'), TIMEOUT = +arg('--timeout', 7200) * 1000;
const STALL = +arg('--stall-min', 10) * 60e3, EVAL_MS = +arg('--eval-timeout', 20) * 1000;
if (!URL0 || !OUT) { console.error('need --url and --out'); process.exit(2); }

const ver = await (await fetch(`http://${CDP}/json/version`, { signal: AbortSignal.timeout(10000) })).json();
console.log('browser:', ver.Browser);
const ws = new WebSocket(ver.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://${CDP}`));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('no DevTools connection in 10 s')), 10000); });
let id = 0, gone = false; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); clearTimeout(p.tm); if (d.error) p.rej(new Error(JSON.stringify(d.error))); else p.res(d.result); } };
ws.onclose = () => { gone = true; for (const p of pend.values()) { clearTimeout(p.tm); p.rej(new Error('the browser connection closed')); } pend.clear(); };
/** a DevTools call with a time limit: a page that hangs never hangs the driver */
const call = (method, params = {}, sessionId, ms = EVAL_MS) => new Promise((res, rej) => {
  if (gone) return rej(new Error('the browser connection closed'));
  const i = ++id, tm = setTimeout(() => { pend.delete(i); rej(Object.assign(new Error(`${method} did not answer in ${ms / 1000} s`), { code: 'TIMEOUT' })); }, ms);
  pend.set(i, { res, rej, tm }); ws.send(JSON.stringify(Object.assign({ id: i, method, params }, sessionId ? { sessionId } : {})));
});
const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
await call('Runtime.enable', {}, sessionId); await call('Page.enable', {}, sessionId);
await call('Page.navigate', { url: URL0 }, sessionId, 60000);
const ev = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId); return r.result && r.result.value; };

const t0 = Date.now(); let shown = 0, lastSave = 0, lastLine = Date.now(), st = null, partial = null, tail = [], end = null, misses = 0;
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  if (gone) { end = { code: 4, state: 'gone', why: 'the browser went away (its DevTools connection closed)' }; break; }
  let o = null;
  try { o = JSON.parse(await ev(`JSON.stringify(window.__schedBench ? { s: __schedBench.state, done: __schedBench.done, n: __schedBench.log.length, log: __schedBench.log.slice(${shown}) } : null)`) || 'null'); misses = 0; }
  catch (e) { misses++; if (misses === 1 || misses % 15 === 0) console.log(`the page did not answer (${e.message})`); }
  if (o) {
    for (const l of o.log) { console.log(l); tail.push(l); }
    if (o.log.length) lastLine = Date.now();
    tail = tail.slice(-30); shown = o.n; st = o;
    if (Date.now() - lastSave > 30000) {
      lastSave = Date.now();
      try { const p = await ev('JSON.stringify(window.__schedBench.partial)'); if (p && p !== 'null') { partial = JSON.parse(p); fs.writeFileSync(OUT + '.partial.json', p); } } catch (e) { /* next time */ }
    }
    if (o.done) break;
  }
  if (Date.now() - lastLine > STALL) { end = { code: 3, state: 'stalled', why: `no new log line for ${Math.round((Date.now() - lastLine) / 60e3)} min${misses ? `, and the page has not answered for ${misses} tries (its thread is blocked or it crashed)` : ''}` }; break; }
  if (Date.now() - t0 > TIMEOUT) { end = { code: 5, state: 'timeout', why: `the run passed --timeout (${TIMEOUT / 1000} s)` }; break; }
}

let res = null;
if (!end) { try { res = JSON.parse(await ev('JSON.stringify(window.__schedBench.result)') || 'null'); } catch (e) { end = { code: 3, state: 'stalled', why: 'the result could not be read: ' + e.message }; } }
if (end) {   // what the run had measured so far: the page's result if it still answers, else the last partial this driver saved
  let pageRes = null; try { pageRes = JSON.parse(await ev('JSON.stringify(window.__schedBench && (window.__schedBench.result || window.__schedBench.partial))') || 'null'); } catch (e) { /* the page is gone */ }
  res = Object.assign({ driver: end, lastLog: tail }, pageRes && pageRes.card && !pageRes.progress ? pageRes : { partial: pageRes || partial });
  const card = (pageRes && pageRes.card) || (partial && partial.card) || '';
  res.card = `## Scheduler bench: ${end.state.toUpperCase()}\n\n${end.why}.\n\n${card ? card + '\n' : 'Nothing measured yet.\n'}\nLast log lines:\n\n\`\`\`\n${tail.slice(-12).join('\n')}\n\`\`\`\n`;
}
fs.writeFileSync(OUT + '.json', JSON.stringify(res, null, 1));
fs.writeFileSync(OUT + '.md', (res && res.card) || '```\n' + JSON.stringify(res, null, 1) + '\n```\n');
console.log(`state ${end ? end.state : st && st.s}; wrote ${OUT}.json and ${OUT}.md`);
if (res && res.card) console.log(res.card);
try { await call('Target.closeTarget', { targetId }, undefined, 5000); } catch (e) { /* it may be hung */ }
try { ws.close(); } catch (e) { /* */ }
process.exit(end ? end.code : st && st.s === 'done' ? 0 : 1);
