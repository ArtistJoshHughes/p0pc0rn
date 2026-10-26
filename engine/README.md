# pocketflux-engine (drop-in folder)

1. Copy this folder into the app as `engine/` (keep `opfs_worker.js` next to `pocketflux-engine.js`; serve `.js` as JavaScript).
2. `import { createEngine } from './engine/pocketflux-engine.js';` (the app reaches it through `pocketflux.js`).
3. `const eng = await createEngine({ packUrl: P0_CONFIG.packs['flux2-klein-4b'] });` - the pack URL must allow HTTP Range (resume).
4. `eng.capabilities()` -> `{supported, reason, ...}`; if not supported, show `reason` and stop.
5. From a button tap: `await eng.requestPersistentStorage()`, then `await eng.download({onProgress, signal})` (4.6 GB, resumable, verified).
6. `const r = await eng.textToImage({prompt, width: 1280, height: 720, seed, steps: 4, onProgress, signal})` -> `r.blob` (PNG), `r.url`, `r.timings`.
7. Edits: `eng.imageToImage({image: file, prompt, width, height, reference: 'half' | 'full', ...})`.
8. `eng.cancel()` rejects the job with `AbortError`; errors carry `code` (NOT_DOWNLOADED, BUSY, BAD_SIZE, GPU_LOST, OUT_OF_MEMORY, ...).
9. Events: `eng.on('progress' | 'state' | 'warning' | 'gpu-lost', fn)`; warning codes HOT, LOW_STORAGE, KILLED_LAST_RUN.
10. One job at a time. Same prompt again skips the text phase (prompt cache). Sizes: multiples of 16, at most 1280x720 pixels.
11. Keep Safari in front, plugged in, cool; a 720p picture takes minutes on a phone. Full API: ENGINE_API.md.
12. Rebuild this folder from the engine sources with `python engine/tools/build_dist.py`. Licences: NOTICE.md.
13. Video (engine 0.3): `createEngine({ model: 'sanavideo2-5b', packUrl: P0_CONFIG.packs['sanavideo2-5b'] })`, then
    `eng.textToVideo({ prompt, width: 832, height: 480, frames: 81 })` -> `{ blob (video/mp4), url, timings }`. ENGINE_API.md section 6.
14. Clips from pictures (p0pc0rn v018, i2v 0.2.0): `createEngine({ model: 'sanavideo2-5b', packUrl, encoderPackUrl: P0_CONFIG.packs['ltx23-still-enc'] })` adds
    `imageToVideo`, `framesToVideo`, `resumeVideo`, `encoderStatus`, `downloadEncoder`, `deleteEncoder`, `videoCheckpoint(mode)` (ENGINE_API.md section 8).
    The bundle is built by p0pc0rn_v018/build_engine.py (the core modules unchanged).
15. The assistant (p0pc0rn v019): `llm/llm_engine.js` - `createEngine({ model: 'gemma4-e2b', packUrl: P0_CONFIG.packs['gemma4-e2b'], dir: 'pocketllm/pack' })`,
    then `load({mode})`, `chat(messages, {tools, images, maxTokens, prefix, onToken, signal})`, `unload()` (ENGINE_API.md section 9).
16. Songs (p0pc0rn v019): `music/music.js` - `createEngine({ model: 'acestep15-turbo', packUrl: P0_CONFIG.packs['acestep15-turbo'] })`, then
    `textToMusic({tags, lyrics, seconds, seed, bpm, keyscale, timesignature, lm})`; the lyrics planner via `lmStatus / downloadLM / deleteLM`
    (ENGINE_API.md section 10). Both trees are the probes' files byte for byte (+ the `prefix` option in llm/llm.js).
17. The assistant's Bigger brain (p0pc0rn 3.8): the same `llm/llm_engine.js` with `createEngine({ model: 'bolt-e4b', split: 'required' })`
    (NVIDIA Nemotron 3.5 Bolt E4B, text only). `split` runs the first layers in a module SharedWorker (`llm/lworker.js`, served with
    COEP require-corp by the app's service worker; `llm/split.js` is the page's side): on iOS 27 a process of its own. Juli's E2B uses
    `split: true` with `splitFallback` (ENGINE_API.md section 9).
