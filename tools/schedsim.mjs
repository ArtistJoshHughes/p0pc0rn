// schedsim.mjs - p0pc0rn v4: the scheduler bench in node (a fake clock, fake sources, a fake model). The MIX of makeapp/schedbench.js (12
// apps for 3 hours, the person chatting about every 10 minutes, one render) under both policies: the v4 scheduler and 3.9's tick.
// Nothing goes online, nothing is stored. Writes <out>.json and <out>.md (the results card) when an out path is given.
// usage: node tools/schedsim.mjs [out-path-without-extension] [--seed N] [--big-unusable]
import fs from 'node:fs';
import { runMix, card, MIX } from '../makeapp/schedbench.js';

const args = process.argv.slice(2), out = args.find((a) => !a.startsWith('--')), seedAt = args.indexOf('--seed');
const seed = seedAt >= 0 ? +args[seedAt + 1] || 7 : 7, bigUsable = !args.includes('--big-unusable');
const a = await runMix({ policy: 'sched', seed, bigUsable }), b = await runMix({ policy: 'naive', seed, bigUsable });
const md = card(a, b, `Scheduler bench (node sim): ${MIX.apps.length} apps, ${MIX.hours} hours, seed ${seed}${bigUsable ? '' : ', the Bigger brain unusable'}`);
console.log(md);
if (out) { fs.writeFileSync(out + '.json', JSON.stringify({ seed, mix: MIX, sched: a, naive: b }, null, 1)); fs.writeFileSync(out + '.md', md); console.log('wrote', out + '.json', out + '.md'); }
