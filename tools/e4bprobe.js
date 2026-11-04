// e4bprobe.js - p0pc0rn v4: where does the Bigger brain stop? (the scheduler bench hung on its first Bigger-brain answer on a desktop test
// machine's graphics card in headless Chrome, twice, right after "Bigger brain loaded"). One page = one variant, from the query:
//   pack (default /pack/), juli=1 (load Juli, ask her once and unload her first), drafter=0|1 (the Bigger brain's drafter, default 1),
//   chunk=64|128 (its read-in chunk; the app uses 128 on a desktop browser, 64 on WebKit), prefix=0|1 (the name-reference job's forced
//   start, default 1), tokens (default 48), autostart=1.
// Every stage is logged with its time (window.__schedBench, so tools/sched_drive.mjs drives it and its stall guard applies); a heartbeat
// line every 10 s says the page's thread is free while it waits; the last line before a stop names the stage that did not return.
const Q = new URLSearchParams(location.search);
const PACK = (Q.get('pack') || '/pack/').replace(/\/?$/, '/');
const V = { juli: Q.get('juli') === '1', drafter: Q.get('drafter') !== '0', chunk: +Q.get('chunk') || 128, prefix: Q.get('prefix') !== '0', tokens: +Q.get('tokens') || 48 };
const SB = window.__schedBench = { state: 'idle', done: false, partial: null, result: null, log: [] };
const t00 = performance.now(), sec = () => ((performance.now() - t00) / 1000).toFixed(1);
const say = (m) => { const l = `${new Date().toISOString().slice(11, 19)} +${sec()}s ${m}`; SB.log.push(l); console.log('e4bprobe: ' + m); const el = document.getElementById('sb-log'); if (el) el.textContent = SB.log.slice(-30).join('\n'); };
const R = { variant: V, stages: [], ok: false };
const STAGE_S = +Q.get('stageS') || 180;   // a stage that has not returned by then = it is stuck: the probe ends and says which
async function stage(name, fn) {
  say(name + ' ...'); const t0 = performance.now(); let tm = null;
  const stuck = new Promise((_, rej) => { tm = setTimeout(() => rej(Object.assign(new Error(`STUCK: "${name}" has not returned after ${STAGE_S} s`), { stuck: name })), STAGE_S * 1000); });
  try { const v = await Promise.race([Promise.resolve().then(fn), stuck]); const ms = Math.round(performance.now() - t0); R.stages.push({ name, ms }); say(`${name}: ${ms} ms`); return v; }
  finally { clearTimeout(tm); }
}
let beatAt = performance.now(); setInterval(() => { if (SB.state === 'running' && performance.now() - beatAt > 10000) { beatAt = performance.now(); say('(the page is free: waiting on the GPU)'); } }, 1000);
const CFG = {
  e2b: { model: 'gemma4-e2b', packUrl: PACK + 'bal/', dir: 'pocketllm/pack_bal', source: 'http', drafterUrl: PACK + 'drafter/', drafterDir: 'pocketllm/drafter_q4h' },
  big: { model: 'bolt-e4b', packUrl: PACK + 'e4b/', dir: 'pocketllm/e4b', source: 'http', drafterUrl: PACK + 'e4b_drafter/', drafterDir: 'pocketllm/e4b_drafter', drafter: V.drafter, split: false, modelOpts: { chunk: V.chunk } },
};
const MSG = [{ role: 'system', content: 'You compare a token\'s name with facts about fictional works. Answer with ONE JSON object and nothing else.' },
  { role: 'user', content: 'DATA: {"name":"Shrek Coin","symbol":"SHREK"}\nFACTS:\n- Page: Shrek (character).\n- Franchise: Shrek.\n- Species: ogre.\nJSON:' }];
async function ask(e, who, prefix) {
  let first = null, n = 0; const t0 = performance.now();
  const r = await e.pipe.chat(MSG, Object.assign({ maxTokens: V.tokens, trace: (s) => say(`${who} · ${s}`), onToken: () => { n++; if (!first) { first = Math.round(performance.now() - t0); say(`${who}: first token after ${first} ms`); } else if (n % 16 === 0) say(`${who}: ${n} tokens`); } }, prefix ? { prefix: '{"reference": "' } : {}));
  const ms = performance.now() - t0, tps = r.tokens ? +(r.tokens / (ms / 1000)).toFixed(1) : null;
  say(`${who}: ${r.tokens} tokens in ${Math.round(ms)} ms (${tps} tokens/s): ${JSON.stringify(String(r.text || '').slice(0, 80))}`);
  return { first, tokens: r.tokens, ms: Math.round(ms), tps };
}
// v4: the packs' server must honour HTTP Range requests (tools/serve.py does; Python's SimpleHTTPRequestHandler does not, and the engine
// then refuses every row read: NO_RANGE). Checked once before any model loads, so a wrong server says so at once
async function rangeOk(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-15' }, cache: 'no-store' });
    try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) { /* */ }
    return r.status === 206 ? '' : `the pack server answered ${r.status} to a byte range (it must honour HTTP Range requests: serve the packs with the tree's tools/serve.py --root <folder>)`;
  } catch (e) { return 'the pack server did not answer: ' + String((e && e.message) || e).slice(0, 120); }
}
async function run() {
  SB.state = 'running';
  say(`variant ${JSON.stringify(V)}; pack ${PACK}`);
  try {
    const no = await rangeOk(PACK + 'e4b/manifest.json'); if (no) throw new Error(no);
    say('the pack server honours byte ranges');
    const ad = await navigator.gpu.requestAdapter(), info = ad && (ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : {}));
    R.adapter = info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null;
    say('adapter: ' + JSON.stringify(R.adapter) + `; maxBufferSize ${ad && ad.limits.maxBufferSize}, maxStorageBufferBindingSize ${ad && ad.limits.maxStorageBufferBindingSize}`);
    const LLM = await import('../engine/llm/llm_engine.js');
    if (V.juli) {
      const j = await stage('Juli: engine', () => LLM.createEngine(CFG.e2b)); j.on('gpu-lost', () => say('GPU LOST (Juli\'s engine)'));
      const ld = await stage('Juli: load', () => j.load()); say(`Juli: ${ld.residentMB} MB resident${ld.drafter ? ', drafter' : ''}`);
      R.juli = await stage('Juli: one answer', () => ask(j, 'Juli', false));
      await stage('Juli: unload', async () => { j.unload(); await new Promise((r) => setTimeout(r, 1500)); });
    }
    const e = await stage('Bigger brain: engine', () => LLM.createEngine(CFG.big)); e.on('gpu-lost', () => say('GPU LOST (the Bigger brain\'s engine)'));
    const ld = await stage('Bigger brain: load', () => e.load({ mode: 'resident' }));
    say(`Bigger brain: ${ld.residentMB} MB resident${ld.drafter ? ', drafter' : ', no drafter'}${ld.drafterError ? ' (drafter error: ' + ld.drafterError + ')' : ''}`);
    R.plain = await stage('Bigger brain: one answer, no forced start', () => ask(e, 'Bigger brain', false));
    if (V.prefix) R.prefixed = await stage('Bigger brain: one answer with the forced start', () => ask(e, 'Bigger brain (forced start)', true));
    await stage('Bigger brain: unload', async () => e.unload());
    R.ok = true; SB.result = R; SB.state = 'done'; say('done');
  } catch (err) { R.error = String((err && (err.stack || err.message)) || err).slice(0, 600); if (err && err.stuck) R.stuck = err.stuck; SB.result = R; SB.state = err && err.stuck ? 'stalled' : 'error'; say((err && err.stuck ? '' : 'error: ') + R.error); }
  SB.done = true;
}
if (Q.get('autostart') === '1') run();
