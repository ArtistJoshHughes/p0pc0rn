// e4b_probe_matrix.mjs - p0pc0rn v4: run tools/e4bprobe.html once per variant (each in its own tab, through tools/sched_drive.mjs and
// its stall guard) and write one table: which variant answers, which stops, and at which stage. A variant that hangs the browser's GPU
// process can spoil the ones after it: --restart "<command>" runs between variants (e.g. the scheduled task that restarts Chrome).
//   node tools/e4b_probe_matrix.mjs --cdp 127.0.0.1:9333 --base "http://127.0.0.1:8766/app/tools/e4bprobe.html?pack=/pack/" --out results/e4bprobe [--restart "schtasks /run /tn p0SchedBench"]
import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CDP = arg('--cdp', '127.0.0.1:9333'), BASE = arg('--base'), OUT = arg('--out'), RESTART = arg('--restart', ''), STALL = arg('--stall-min', '4');
if (!BASE || !OUT) { console.error('need --base and --out'); process.exit(2); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
// the app's own desktop set-up first (drafter on, read-in chunk 128), then one change at a time
const VARIANTS = [
  ['app (desktop): drafter, chunk 128', 'drafter=1&chunk=128'],
  ['no drafter, chunk 128', 'drafter=0&chunk=128'],
  ['drafter, chunk 64 (the WebKit set-up the bench used)', 'drafter=1&chunk=64'],
  ['no drafter, chunk 64', 'drafter=0&chunk=64'],
  ['Juli first, then the app set-up', 'juli=1&drafter=1&chunk=128'],
  ['no forced start', 'drafter=1&chunk=128&prefix=0'],
];
const rows = [];
for (const [name, q] of VARIANTS) {
  const out = `${OUT}-${rows.length + 1}`;
  console.log(`\n=== ${name}`);
  const r = spawnSync('node', [path.join(HERE, 'sched_drive.mjs'), '--cdp', CDP, '--url', `${BASE}&${q}&autostart=1`, '--out', out, '--timeout', '900', '--stall-min', STALL], { encoding: 'utf8', timeout: 1000e3 });
  let res = null; try { res = JSON.parse(fs.readFileSync(out + '.json', 'utf8')); } catch (e) { /* none */ }
  const log = (res && (res.lastLog || null)) || [];
  const st = res ? (res.driver ? res.driver.state : res.ok ? 'answered' : res.stuck ? 'stuck' : 'error') : 'no result';
  const lastStage = res && res.stuck ? res.stuck : res && res.stages && res.stages.length ? res.stages[res.stages.length - 1].name + ' (done)' : (log.filter((l) => / \.\.\.$/.test(l)).pop() || '').replace(/^.*?s /, '');
  rows.push({ name, q, state: st, exit: r.status, lastStage, plain: res && res.plain, prefixed: res && res.prefixed, error: res && res.error ? String(res.error).slice(0, 160) : '' });
  console.log(`-> ${st} (driver exit ${r.status}); last stage: ${lastStage}`);
  if (RESTART && st !== 'answered') { try { execSync(RESTART, { stdio: 'inherit', timeout: 60000 }); await new Promise((x) => setTimeout(x, 15000)); } catch (e) { console.log('restart failed: ' + e.message); } }
}
const fmt = (a) => (a ? `${a.first} ms first, ${a.tps} tok/s` : '-');
const md = '## Bigger brain probe\n\n| variant | result | last stage | answer | forced start |\n|---|---|---|---|---|\n' +
  rows.map((x) => `| ${x.name} | ${x.state} | ${x.lastStage || '-'} | ${fmt(x.plain)} | ${fmt(x.prefixed)} |`).join('\n') + '\n' +
  (rows.some((x) => x.error) ? '\n' + rows.filter((x) => x.error).map((x) => `- ${x.name}: ${x.error}`).join('\n') + '\n' : '');
fs.writeFileSync(OUT + '-matrix.md', md); fs.writeFileSync(OUT + '-matrix.json', JSON.stringify(rows, null, 1));
console.log('\n' + md);
