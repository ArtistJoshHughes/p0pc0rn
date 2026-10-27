# Pocket Flux engine API (for the app UI)

The UI talks to the engine only through this API. Two files implement it:

- `engine/pocketflux-engine.js`: the real engine (pictures and videos); the other engines are listed in the sections below.
- A mock engine with the same API was used to build the UI; it is not part of this release.

Both are ES modules with no dependencies. Load them with `<script type="module">` or `import`.

```js
import { createEngine } from './engine/pocketflux-engine.js';
const eng = await createEngine({ model: 'flux2-klein-4b', packUrl: 'https://…/pack/' });
```

## 1. Can this phone run it?

`eng.capabilities()` returns `{ supported, reason, gpu, subgroups, maxBufferMB, storageQuotaGB, persisted }`.

- If `supported` is false, show `reason` ("needs iOS 26 Safari with WebGPU", "not enough storage", …) and stop.
- Call `await eng.requestPersistentStorage()` once from a button tap; Safari only grants it after a user gesture. It returns true or false.

## 2. Model download (once, about 4.6 GB)

| call | what it does |
|---|---|
| `await eng.status()` | returns `{ complete, haveBytes, totalBytes, packVersion }` |
| `await eng.download({ onProgress, signal })` | resumes from where it stopped; safe to call again after a kill, a reload or a network loss. `onProgress({ haveBytes, totalBytes, bytesPerSec, etaSeconds, part })` fires about 4 times a second. `signal` is an `AbortController` signal that pauses the download. |
| `await eng.deleteModel()` | frees the storage |

UI notes:

- Show the size (4.6 GB) before starting.
- Ask the person to keep Safari in front.
- Suggest Wi-Fi.
- A Home Screen install helps storage persist.

## 3. Make a picture

```js
const result = await eng.textToImage({
  prompt: 'a red apple on a wooden table, soft window light',
  width: 1280, height: 720,          // multiples of 16; presets below
  seed: 42,                          // optional; random if missing (returned in the result)
  steps: 4,                          // optional; 4 is the model default
  onProgress: (p) => {},             // see below
  signal,                            // optional AbortSignal (same effect as eng.cancel())
});

const result2 = await eng.imageToImage({
  image,                             // File / Blob / ImageBitmap / HTMLImageElement / ImageData
  prompt: 'make it a green apple',
  width: 1280, height: 720,          // output size; the input is centre-cropped and scaled to it
  reference: 'half',                 // 'half' (default, faster) | 'full' (sharper copy of the input, slower)
  seed, steps, onProgress, signal,
});
```

**Size presets** (width × height): 1280×720, 720×1280, 960×544, 544×960, 768×768, 512×512. Any multiple of 16 is accepted up to 921,600 pixels (1280×720).

**`result`** = `{ blob, url, width, height, seed, steps, prompt, seconds, timings: { text, denoise, decode, encode } }`

- `blob` is a PNG with no metadata.
- `url` is an object URL for the blob. Call `URL.revokeObjectURL(url)` when you are done with it.

**`onProgress(p)`** = `{ phase, frac, step, steps, etaSeconds, message }`

- `frac` is the progress of the whole job, 0..1. Use it for one progress bar.
- `phase` is one of:
  - `'load'`: preparing;
  - `'text'`: reading the prompt;
  - `'encode'`: reading the input picture (image-to-image only);
  - `'denoise'`: the main work; `step` / `steps` count up;
  - `'decode'`: making the final pixels.
- `etaSeconds` gets better after the first step.

**Rerolls are cheaper.** The prompt is encoded once and remembered. Calling again with the same prompt and a new seed skips the `'text'` phase.

## 4. Cancel, errors, events

- **Cancel:** `eng.cancel()` stops the current job. Its promise rejects with an error whose `name === 'AbortError'`. Only one job runs at a time. Starting a second job while one runs rejects with `code: 'BUSY'`.
- **Errors:** they have a `code`:

  | code | meaning |
  |---|---|
  | `NOT_DOWNLOADED` | the model is not downloaded |
  | `EMPTY_PROMPT` | the prompt is empty |
  | `BAD_SIZE` | the size is not a multiple of 16 or is too large |
  | `BAD_IMAGE` | the input picture cannot be read |
  | `GPU_LOST` | the GPU was reset; the engine recovers by itself, retry |
  | `OUT_OF_MEMORY` | too big for this phone; try a smaller size |
  | `BUSY` | a job is already running |
  | `UNSUPPORTED` | this phone or browser cannot run it |
  | `NO_CONSENT` | (0.3.4) the person has not agreed to the current p0pc0rn terms; see §7 |

- **Events:** `eng.on(name, fn)` and `eng.off(name, fn)`. The names are:
  - `'progress'`: same object as `onProgress`;
  - `'state'`: `{ state: 'idle' | 'downloading' | 'working' }`;
  - `'warning'`: `{ code: 'HOT' | 'LOW_STORAGE' | 'KILLED_LAST_RUN', message }`;
  - `'gpu-lost'`.

A page that was killed by iOS mid-job reports `KILLED_LAST_RUN` on the next `createEngine`. The UI should show "The last picture was interrupted (the phone ran out of memory or got hot). Try again, or pick a smaller size."

## 5. UI guidance from the engine side

- A 1280×720 picture takes minutes on a phone; the estimate is shown in `etaSeconds`. Tell the person to keep the phone plugged in and cool, and to keep Safari in front until it finishes. The screen may dim, but the page must stay visible.
- Keep a short history of results (blob plus prompt, seed and size) in the app's own storage. The engine keeps nothing but the model and the prompt cache.
- **Extras of the real engine (optional):** `createEngine({source: 'http'})` streams weights straight from `packUrl` without the OPFS copy (development); `await eng.load()` creates the GPU device and calibrates now (`{gpu, calib, tune}`); `eng.tune({acc: 'f16' | 'f32'})` sets the DiT accumulate mode. Results also carry `timings.steps` (seconds per step), `timings.upload`, `peakMB`, `textCached`, `resumedFromStep`.
- Later models (a small video model, a chat model) will use the same `createEngine({ model })`, with `eng.textToVideo(...)` and `eng.chat(...)`. They are not available yet; `eng.models()` lists what is installed.

## 6. Video (engine 0.3: `model: 'sanavideo2-5b'`)

The same engine serves a text-to-video model. Create it with its own pack; download, status, cancel, events and errors work exactly as above.

```js
const eng = await createEngine({ model: 'sanavideo2-5b', packUrl: P0_CONFIG.packs['sanavideo2-5b'] });   // 5.7 GB pack (config.js)
const clip = await eng.textToVideo({
  prompt: 'A red apple slowly rotating on a wooden table, soft window light, static camera.',
  width: 832, height: 480,      // multiples of 32, at most 1280x736 pixels; presets 832x480, 480x832, 960x544, 544x960, 1280x736, 736x1280
  frames: 81,                   // 8k + 1: 81 = 5 s, 49 = 3 s, 33 = 2 s, 17 = 1 s (16 fps)
  seed, onProgress, signal,
});
// clip = { blob (video/mp4, H.264), url, frames, width, height, fps, seed, prompt, seconds, timings: { text, steps[], denoise, decode, tiles, encode } }
```

- **Phases** (`onProgress.phase`): `'text'`, `'denoise'` (`step` / `steps` = 4), `'decode'` (message "Frames: tile i of n"), `'encode'`.
- **Calling the wrong method** for the model rejects with `UNSUPPORTED`. `eng.models()` reports the kind (`'image'` | `'video'`).
- **Each model keeps its own storage folder**, so the image and video packs can both be installed. `deleteModel()` removes only that model.
- **Saving a clip:** `navigator.share({ files: [new File([clip.blob], 'clip.mp4', { type: 'video/mp4' })] })`. That gives the Photos share sheet on iOS.
- **Resume (engine 0.3.1).** The latent is checkpointed after every step.
  - `eng.videoCheckpoint()` returns the unfinished clip as `{prompt, width, height, frames, seed, step}`, or null. `step` 4 means only decoding is left.
  - Calling `textToVideo` again with the same prompt, size, frames and seed resumes automatically (decode-only when `step` is 4). `resume: false` forces a fresh run.
  - Offer "Decode the last clip" when a checkpoint exists, since a kill during decode must not cost the steps again.
- **Decoder memory.** Pass `decodeBudgetMB` to `createEngine`, or call `eng.tune({ decodeBudgetMB })`. The default is 450 on Apple GPUs and 1200 elsewhere. Frames are assembled in OPFS and encoded one frame at a time.

## 7. The user agreement (engine 0.3.4, p0pc0rn)

- `textToImage`, `imageToImage` and `textToVideo` reject with `code: 'NO_CONSENT'` until this browser holds the person's agreement to the current terms: `localStorage['p0pc0rn:consent'] = {"terms": "2026-10-12", "agreedAt": "<ISO time>"}`.
- The app writes that record only after its copyright / trademark / likeness lesson and the "I agree" card. It stays on the phone.
- A new `TERMS_VERSION` inside the engine invalidates older records, so the lesson shows again.
- Builds that remove this check may not use the p0pc0rn name or icon (TRADEMARKS.md).

## 8. Clips from pictures (engine 0.3.4 core + i2v 0.2.0, p0pc0rn v018)

The video engine gains two modes when it is created with the picture reader's pack. `pocketflux.js` passes it for the video model:

```js
const eng = await createEngine({ model: 'sanavideo2-5b', packUrl: P0_CONFIG.packs['sanavideo2-5b'], encoderPackUrl: P0_CONFIG.packs['ltx23-still-enc'] });
```

The core engine files are byte-identical to 0.3.4 (`p0pc0rn_v018/build_engine.py` proves it at every build: the core-only rebuild equals v017's
shipped engine, and every core module body appears verbatim in the new bundle). The picture modes are attached to **the same engine object**
(`attachI2V`), so they share its GPU device, its job slot (a picture job and `textToVideo` are `BUSY` for each other), cancel, events and the
agreement check. **Text-to-video keeps its own path** (`pipelines/sana_video.js`); routing it through the conditioned pipeline was not done.

| call | what it does |
|---|---|
| `eng.imageToVideo({ image, prompt, width = 832, height = 480, frames = 81, seed, fps, attested, onProgress, signal })` | the picture becomes frame 0 and the clip moves from it |
| `eng.framesToVideo({ first, last, prompt, width, height, frames (>= 17), seed, fps, attested, onProgress, signal })` | the clip starts on `first` and ends on `last` |
| `eng.resumeVideo({ mode?, onProgress, signal })` | finishes an unfinished clip from its checkpoint; `mode` `'t2v'` or `'picture'` (default: the newer one). Pictures are not needed: the pinned latents are checkpointed. Decode only after step 4 |
| `eng.videoCheckpoint(mode?)` | `{ mode: 't2v' \| 'i2v' \| 'flf', prompt, width, height, frames, seed, step, t }` or null. `'t2v'` = the text-to-video slot, `'picture'` (or `'i2v'` / `'flf'`) = the picture slot, none = the newer. **The two slots never overwrite each other** (`pocketvideo:ckpt` + `engine/sanavideo2-5b/run` vs `p0pc0rn:i2v:ckpt` + `engine/sanavideo2-5b/i2v-run`); i2v and FLF share the picture slot |
| `eng.videoCheckpoints()` | both slots, as a list |
| `eng.encoderStatus()` | the picture reader: `{ complete, haveBytes, totalBytes, packVersion }` (`status()` still reports the video model only) |
| `eng.downloadEncoder({ onProgress, signal })` | downloads the picture reader only (212.7 MB, resumable, verified); `signal` pauses |
| `eng.deleteEncoder()` | removes the picture reader (`engine/ltx23-still-enc`) |
| `ENCODER` (module export) | `{ id: 'ltx23-still-enc', dir: 'engine/ltx23-still-enc/pack', wipe: ['engine/ltx23-still-enc'], ... }`: keep it out of storage clean-ups |

- `image` / `first` / `last`: File / Blob / ImageBitmap / HTMLImageElement / ImageData. The picture is centre-cropped to the clip's aspect and scaled.
- **`attested`**: the engine refuses user pictures with `NOT_ATTESTED` unless it is true. The app passes true only when every phone photo's own
  attestation box (`rights.ATTEST`, unticked for each new photo) is ticked; pictures from the app's own Library need no tick.
- **Result**: as `textToVideo` + `mode`, `imagePeakMB`, `denoisePeakMB`, `timings.image`, `timings.imageUpload`.
- **Phases**: `'load'`, `'image'` (new: "Reading the picture" / "Reading the pictures"), `'text'`, `'denoise'`, `'decode'`, `'encode'`.
- **Errors**: all of `textToVideo`'s (incl. `NO_CONSENT`, `BUSY`, `OUT_OF_MEMORY`, `GPU_LOST`), plus `NOT_ATTESTED`, `NO_CHECKPOINT`, `BAD_IMAGE`,
  and `NOT_DOWNLOADED` with the message "Download the picture reader first." when the reader is missing.
- **Killed by iOS**: a picture job leaves `p0pc0rn:i2v:running`; the next `createEngine` emits `KILLED_LAST_RUN` with `lastRun.picture = true` and `lastRun.mode`.
- `deleteModel()` on the video engine also forgets the picture checkpoint (its files lived in the video model's folder). The reader stays; the
  app deletes it too and says so.
- **FLF is zero-shot**: a movement (pose, head turn) travels smoothly; a change of look (expression, light, colour) can snap in during the
  last ~0.3–0.4 s (I2V_FLF_SPEC.md section 5.2). Faces can drift over a 5 s picture clip.
- **i2v 0.2.0 fix**: a fresh picture job now drops an older picture checkpoint record before it overwrites the pinned-picture files (0.1.0 could
  have resumed an old latent with new pins after a cancel during the next job's first step).


## 9. The assistant (`model: 'gemma4-e2b'`, p0pc0rn v019)

Gemma 4 E2B-it (Apache-2.0) on the p0pc0rn WebGPU engine: pure JS + WGSL in `engine/llm/` (+ the shared `engine/core/`, `engine/ops/`,
`engine/audio/`). The bridge routes the model id to `engine/llm/llm_engine.js` (`LLM_MODULE` in `pocketflux.js`) and passes the pack:

```js
const brain = await PF.createEngine({ model: 'gemma4-e2b' });   // packUrl + OPFS folder from PF.assistantPack ({url, dir}) - ONE value
```

| call | what it does |
|---|---|
| `status()` / `download({onProgress, signal})` / `deleteModel()` | as the other models (3.09 GB at 4-bit, resumable, SHA-256 per chunk). OPFS folder `pocketllm/pack` (the probe's folder: a phone that downloaded it in the probe already has it) |
| `load({ mode })` | `'resident'` (default; 1,426 MB of weights on the GPU, fastest) or `'lean'` (<= 1.2 GB resident, the largest MLP shards re-read from OPFS per token). Returns `{residentMB, mode}` |
| `unload()` | frees every GPU buffer. The queue calls it before any render and when the queue is idle |
| `chat(messages, { tools, images, maxTokens, prefix, signal, onToken })` | -> `{ text (with the special tokens), reply, tokens, stopped, timings: {prefill, firstToken, decode}, tokPerS, prefillTokPerS, peakMB, promptTokens }` |
| `cancel()` | stops the answer (AbortError) |

- **`prefix` (new in v019, `engine/llm/llm.js`, 3 lines):** a forced start of the answer, e.g. `'<|tool_call>call:write_song{'`. It is appended to the
  rendered prompt and put back in front of `text`, so the agent's focused calls (write_song, look_at_result, plan_shots, review_shots) always
  come back as a tool call. Without `prefix` nothing changes (the probe's parity tests stand).
- Messages: `{type: 'image'}` parts consume `images` in order (the app's adapter moves `{type:'image', image: Blob}` parts there).
- Decoding is greedy in v019 (no temperature / topK / topP): what the phone measured (17.8 tok/s, TTFT 0.4 s); the engine's CPU sampler reads
  all 262k logits per token and was not measured on the phone.
- Errors: `NOT_DOWNLOADED`, `NOT_LOADED`, `BUSY`, `GPU_LOST`, `OUT_OF_MEMORY`, `TOO_LONG` (prompt + maxTokens > 4096: the app retries once with
  maxTokens 400), `NO_CONSENT` (chat needs the p0pc0rn agreement too).
- **Memory fallback (app):** the assistant loads resident; an `OUT_OF_MEMORY` on load retries `'lean'` at once, and a page that dies WHILE
  loading (the app keeps `pf.app.brainLoading` set during `load()`) loads lean from then on, with a note. Settings › Assistant memory can switch back.
- **3.8 (engine 0.2): faster decoding and read-in, and the drafter add-on.** The decode loop records each token while the GPU runs the one
  before it; the prompt read-in runs its attention as GEMMs and reads the next chunk's per-layer rows ahead. The words do not change.
  The add-on is Google's Gemma 4 E2B MTP drafter (`google/gemma-4-E2B-it-assistant`, Apache-2.0), its own 54 MB pack (8-bit layers
  and a 4-bit head, as fast as the 81 MB 8-bit-head pack on an iPhone; `PF.drafterPack` = `{url, dir}` from config.js, which also names
  its OPFS folder):

  | call | what it does |
  |---|---|
  | `hasDrafter()` | true when the engine has a drafter address and was not made with `drafter: false` (the app passes `false` on Android for now) |
  | `drafterStatus()` / `downloadDrafter({onProgress, signal})` / `deleteDrafter()` | as `status` / `download` / `deleteModel`, for the drafter's pack |
  | `load()` | also loads the drafter when it is on the phone and the weights are fully resident; returns `drafter` (true / false), `drafterMB`, and `drafterError` if it could not be used (then decoding is plain, with no error) |

  With the drafter, greedy `chat()` drafts 0 to 4 tokens per pass (chosen from the costs measured on an iPhone and the running acceptance)
  and the assistant checks them in one pass over its weights; every token is still the assistant's own choice, so the text is the same.

  A sampled `chat()` (`temperature` / `topP` / `topK` from 1 to 64, `seed`; the app's adapter does not pass them) uses the drafter too:
  speculative sampling (`engine/llm/lops_samp.js`). The drafts are sampled from the drafter's own distribution; each is kept with
  probability min(1, p / q), and the first one not kept is replaced by a token drawn from max(0, p - q). The answers follow the same
  distribution as plain sampling, but not with the same words: the random numbers are not the CPU sampler's, and they also depend on how
  many drafts each pass made. On an iPhone 16 Pro Max at temperature 0.3, top-p 0.95, top-k 64 this ran 2.4x the plain sampled loop.
  Without the drafter (or with another `topK`) the CPU sampler picks as before, now keeping the top K by insertion instead of sorting
  every logit (the same tokens for the same seed). If the sampling kernels cannot run on a GPU, the answer goes on with the CPU sampler
  from its last good token and the result carries `samplingError` (and a `drafter` event).
- **3.8: the Bigger brain (`model: 'bolt-e4b'`) and the split.** The same engine runs a second model, NVIDIA Nemotron 3.5 Bolt E4B
  (OpenMDW-1.1; a post-train of Gemma 4 E4B-it: 42 layers, hidden 2,560, 2 KV heads, KV sharing from the manifest's `kv_source`; text
  only), with Google's Gemma 4 E4B MTP drafter (`google/gemma-4-E4B-it-assistant`, Apache-2.0) as its add-on. Its packs come from
  config.js (`packs['bolt-e4b']`, `packs['bolt-e4b-drafter']`; `PF.e4bPack` / `PF.e4bDrafterPack` = `{url, dir}`; OPFS folders
  `pocketllm/e4b` and `pocketllm/e4b_drafter`):

  ```js
  const big = await PF.createEngine({ model: 'bolt-e4b', split: 'required' });   // iOS 27 (a desktop browser: split false = one process)
  // the same calls as 'gemma4-e2b': status / download / drafterStatus / downloadDrafter / deleteDrafter / load / chat / unload
  ```

  `LLM_MODELS` (engine/llm/llm_engine.js) holds, per model: `split` (the first layer of the page's part: E2B 13, E4B 23), `vision`
  (E2B true, E4B false), `spec` (the drafter's settings: E4B `{ specK: 2 }`, two drafts a pass, the iPhone's best for it; E2B
  chooses per pass from the measured costs) and, where a model loads with its own, `ctxCap` / `chunk` (E4B: 2,048 tokens of context,
  128-token read-in chunks; the app passes 64 on WebKit). The kernels take any number of KV heads, hidden sizes above 2,048 and a range
  of layers; with one KV head, hidden <= 2,048 and every layer in one process (E2B as before) each kernel runs the same arithmetic in
  the same order, so the words are the same.

  | option / call | what it does |
  |---|---|
  | `split` (createEngine): `false` (default), `true` or `'required'` | `true` / `'required'`: `load()` runs layers [0, split) in a second process: a module SharedWorker (`engine/llm/lworker.js`) that the app's service worker (`sw.js`, at the app's root) serves as `engine/llm/lworker_coep.js` with `Cross-Origin-Embedder-Policy: require-corp`. On iOS 27 that gives it a process, and a memory budget, of its own. The page keeps the embedding, layers [split, end), the head and the drafter (which reads the page's KV caches). The worker's part loads before the page's, so a split that can't start costs the page nothing. The worker reads the pack from this device's storage, so a pack read over HTTP (`source: 'http'`) can't split |
  | `splitFallback` (createEngine; the app sets it for Juli) | when the split can't start, or its second process failed twice in a row (it ended, or stopped answering), the engine goes on in one process by itself: no drafter, `oneProcessOpts` merged into `modelOpts` (the app: 128-token read-in chunks on WebKit), and a `split` event `{ off: true, why }` |
  | `splitAt` (createEngine; tests) | overrides the registry's `split` |
  | `reloadSettleMs` (createEngine) | a `load()` right after an `unload()` first waits until that long has passed since the unload (the app: 8 s on WebKit) |
  | `load()` result | + `split: { at, mirror, pageMB, workerMB, coep, isolated, workerS }` when the load split: `at` = the first layer of the page's part as loaded, `mirror` = the layers whose keys and values come back from the worker (below). No `split` field when it didn't split |
  | `countTokens(messages, { tools, prefix, thinking })` | a prompt's length in tokens with the pack's own tokenizer, without loading the model or the GPU (the router fits the Bigger brain's 2,048-token prompts with it); a picture counts as its placeholder only |
  | `splitAvailable()` (module export) | `{ ok, why, coep, isolated }`: registers `sw.js`, starts a worker part and checks it came from the service worker's copy (`coep: 'require-corp'`); once per page |
  | `chat()` | split answers are greedy, with the drafter; the app's calls are greedy already |

  - How it works, in plain words: [docs/TWO-PROCESSES.md](docs/TWO-PROCESSES.md).
  - The KV mirror: a layer in the page that reads the keys and values of a layer in the worker gets them back with every hop
    (`Gemma4.mirrorKV()` lists those layers; lworker.js `kvRows`, split.js `_mirrorIn`). Bolt E4B splits at 24 (3.9; 23 in 3.8): layers
    0-23 run in the second process, and the keys and values of layers 22 and 23 come back for the page's layers that share them and
    for the drafter. E2B, split at 13, needs no mirror.
  - The page and the worker speak one version of their messages (split.js `SPLIT_PROTO` = 3, lworker.js `PROTO`); the page refuses a
    worker part of another version.
  - Each token or verify pass sends the hidden rows and the per-layer inputs to the worker and takes the rows back: 1-3% of the time
    per token on an iPhone. The two processes take turns: GPU work never runs in both at once.
  - A worker call's time limit doesn't count time while the page is hidden (iOS stops a hidden page's timers and GPU work), Stop (the
    job's signal) reaches a worker call, and the second process is always told to free its memory, also after a timeout.
  - The worker reads its layers from the pack the page downloaded (this origin's OPFS, read only); it never fetches weights.
  - The service worker answers only that one file and stores nothing; every other request goes to the network untouched.
  - `unload()` frees the worker's part too.
  - The worker part sends a heartbeat every second. A call that waited while the page was hidden (a phone call, another app) gives up
    on a silent worker part 4 s after the page is back, not after its whole limit. Limits: starting the worker part 30 s; a read-in
    call 45 s for its first chunk and 30 s for the others; a token or verify pass 30 s.
  - Loading waits for the GPU after every 64 MB of weights it writes (`engine/core/store.js`, for every model; lworker.js `UPCAP`),
    so Safari's GPU process never holds a second copy of a model while it loads (on iOS 27 that left the phone without memory).
  - Errors:
    - `SPLIT_FAILED`: `split: true` without `splitFallback`, and no second process here. Nothing stays loaded.
    - `SPLIT_UNAVAILABLE`: the same for `split: 'required'` (the Bigger brain on WebKit), which never loads in one process there.
    - `SPLIT_RETRY`: the second process failed during a call: it ended, or its work stalled (no answer within the call's limit). The
      engine unloads; run the job again and it loads with a fresh worker part (the app's queue does this by itself).
    - `SPLIT_GONE`: the second such failure in a row (a good answer resets the count). With `splitFallback` the engine goes on in one
      process from then on; without it (the Bigger brain) it also emits `split` `{ off: true, down: true, why }`. A `GPU_LOST` while
      split unloads the same way.
    - `NO_VISION`: pictures sent to a model without `vision` (the Bigger brain).
  - The app (`app.js`):
    - The split is on where `SPLIT_HERE` (WebKit, Safari's `Version/` 27 or later, service workers and SharedWorker) and this phone
      hasn't given it up: on a phone where it has never worked (`pf.app.splitWorked` unset), three one-process fallbacks in a row
      while online set `pf.app.splitOff`, which expires after 3 days; Settings › Juli has "Try the second process again". Where it
      has worked, a failure only costs a fresh worker part, then one process for the rest of that page.
    - A Bigger-brain job whose second process failed twice in a row goes to Juli, and so does the Bigger brain's work for the rest of
      the page (`E4B_DOWN`), without a note. The diagnostics log each failure ('second process failed').
    - The page keeps its GPU device from model to model: destroying it after every unload ended with "The GPU was reset" after a
      dozen loads on iOS 27.
    - Juli: `split: true` with `splitFallback`; the read-in goes in 256-token chunks split, 128 in one process on WebKit
      (`oneProcessOpts`). Faster replies on iOS 27 only with the split; iOS 26 keeps them as before; Chrome on an iPhone (no Safari
      version) has them off. A stop the safety net recorded in one process (`pf.app.fasterOff` without `split`) doesn't count on an
      iPhone where the split works; without the split they stay off.
    - The Bigger brain: `split: 'required'` on WebKit (one process on a desktop browser), its drafter on, 64-token read-in chunks on
      WebKit. It is offered where `E4B_HERE()` (the split works here, or a desktop browser; not Android) and loads in a fresh page on
      WebKit. If the page ends while it is loaded it turns itself off on that device (`pf.app.brain4Off`), but only for that set-up
      (its `cfg`, drafter + chunk, against `E4B_CFG()`): a changed set-up gets a fresh try. Settings › Juli has "Turn the Bigger brain
      back on".
  - On an iPhone 16 Pro Max (iOS 27.0.1), Bolt E4B split at 24 (3.9) with its drafter holds about 1.53 GB in the page and about 1.50 GB
    in the second process, whose own ceiling is about 1.6 GB (3.8's split at 23: 1.6 GB and 1.44 GB); E2B split at 13 about 1.27 GB
    and 0.43 GB. On a desktop browser, where both ways run, the split gives the same words as one process.

## 10. Songs (`model: 'acestep15-turbo'`, p0pc0rn v019)

ACE-Step 1.5 turbo (MIT) + the Qwen3-Embedding-0.6B text encoder (Apache-2.0) + the optional 5 Hz LM 0.6B lyrics planner (MIT), in
`engine/music/` (module music-0.2, the music probe v002 byte for byte). Bridge: `MUSIC_MODULE` in `pocketflux.js`.

```js
const music = await PF.createEngine({ model: 'acestep15-turbo' });   // its pack: config.js (2.77 GB); the planner = <pack>/lm/ (0.94 GB)
const r = await music.textToMusic({ tags, lyrics, seconds: 30 | 60, seed, bpm, keyscale: 'A minor', timesignature: '4', lm: true, onProgress, signal });
// -> { blob (audio/mp4 AAC .m4a, or WAV where the browser can't encode AAC), wavBlob, durationSec, seconds (wall time), codec, timings, plan, resumedFromStep }
```

| call | what it does |
|---|---|
| `status()` / `download()` / `deleteModel()` | the music model; OPFS `engine/acestep15-turbo/` (deleting it removes the planner too: same folder) |
| `lmStatus()` / `downloadLM()` / `deleteLM()` | the lyrics planner (Settings › Models › Lyrics planner) |
| `textToMusic(...)` | phases `load`, `plan` (planner), `text`, `lyrics`, `cond`, `denoise` (8 steps), `decode` ("Sound: part i of n"), `encode` |
| `musicCheckpoint()` | the unfinished song, or null. The SAME request resumes (the plan and each step are checkpointed) |

- The app's adapter maps the runner's call: `key` -> `keyscale`, `timeSignature` '4/4' -> '4' ('3/4' -> '3', '6/8' -> '6'), `lm` = on when the
  planner is downloaded (35 of 40 lines heard vs 21 without it), and the result's `seconds` = the song's length (`durationSec`).
- Lyrics reach it already normalised by `assistant/tools.js` (plain markers, at most (seconds - 6) x BPM / 480 sung lines).
- No `unload()`: the queue destroys its idle GPU device; the next song recreates it (and recalibrates).
- `KILLED_LAST_RUN` (a page kill mid-song): the queue already re-runs the song with the same arguments, so the engine resumes it.

## 11. The queue (`assistant/queue.js`) - how the app runs every job

- `Make` (Create) and every assistant tool add a job: `picture`, `edit`, `clip`, `animate`, `between` (assistant/runners.js), `resume` (the
  app's runner for Create's "Unfinished clip" banner: `resumeVideo({mode: 'picture'})`), `song`, `musicvideo` (+ `assemble`), `chat`.
- `EngineHost` loads ONE model for a job (`hostCreate` in app.js: the assistant is `load()`ed; the video engine gets `tune({decodeBudgetMB})`)
  and unloads it when the next job needs another model and when the queue is idle (`unload()` where the engine has it, else the idle GPU
  device is destroyed, as v018's `releaseOther` did).
- The runners call the engines in the shape INTEGRATION.md wrote for them; app.js adapts that to the real engines (video: `{seconds, size}` ->
  `{width, height, frames, attested}`; music: above; assistant: `images`, greedy, streaming `onToken` into the chat).
- Run order: an interrupted job first (its checkpoint waits), then chats (FIFO), then the rest in family order. A running job is never preempted.
- A page kill: the job found `running` at the next start goes back to the queue with the same params and seed (3 kills = `KILLED`).
- `GPU_LOST` / `BUSY` are retried by the queue twice by itself (same seed = resume); other errors fail the job (Create shows v018's error card).
- `NO_CONSENT` / `NOT_DOWNLOADED` block a job until the agreement / the download (then `queue.recheck()`); the picture reader downloads by
  itself when an assistant clip needs it.
- **3.8, the hold (`createQueue({ holdMs })`):** a model can stay loaded for `holdMs(modelId)` after its job (the app: 5 s for Juli's
  models) so a follow-up job doesn't unload and load it again. The hold ends at once when another model's job is added, when a job
  becomes runnable without an `added` event (checked every 250 ms), on `endHold()` (an app opens) and when the page is hidden.
  `Q.holding` counts as busy.

## 12. Looking things up: grounded chat, grounded songs and the phone's KB (p0pc0rn v021)

The research lane (`assistant/research.js`) is airlocked: Wikipedia and Fandom only, from the phone's browser. Code picks the page and
checks it with guards: model tokens, every word of a proper name, relevance, a person only when the topic names one, disambiguation pages,
page views and recent edits. Code then scrubs the text. A quarantined reader (a stateless call with no tools and no history) turns it into
a closed JSON schema, and code renders that as fact lines. The planner and the song writer only ever see those fact lines. Code appends
the citation: title, the permalink to the exact revision, the authors (page history), the licence and "as of <the revision's date>".

- **Grounded chat:** every plain chat turn runs a code step first (`Agent.groundChat`). Render requests, small talk and questions
  about the app skip it. A LOOKUP PLANNER call lists up to 2 topics (4 with "research: X" / "look up X"), the lane looks each one
  up, and the answer is written from the fact lines with the citation. A follow-up reuses the facts the chat already has. A
  disambiguation page asks "which one did you mean". Settings › Assistant › "Look things up on Wikipedia & Fandom" (on by default):
  when it is off there is no lookup, the research tool is not offered, and the assistant says it can't look things up.
- **Grounded songs:** before the lyrics, `make_song` sorts the subject in code (`song_subject`: real / popculture / personal /
  abstract). A real or pop-culture subject is looked up, and the writer gets the fact lines with every number spelled the way to
  sing it. It must use at least 3 of the facts (2 for short songs), checked in code with the number itself or the words for it.
  The reply says what was looked up and cites it. A personal or abstract subject is not looked up and nothing is said. A miss
  gets one line ("No facts found for …, so the words come from your request alone").

### The phone's KB (`assistant/kb.js`, IndexedDB `p0pc0rn-kb`)

Every hit is kept for good (the 14-day page cache is separate). Each entry holds the typed facts, the rendered lines, a short
summary (at most 300 characters, scrubbed, used only by the guards), the categories, the topics asked, and the citation: title,
url, permalink, revid, `revised` (that revision's time), `retrieved`, the authors link and the licence (CC BY-SA 4.0 on Wikipedia,
the wiki's own licence on Fandom, usually CC BY-SA 3.0). Page text is never kept.

- `lookup()` checks, in order: **the phone's KB → the starter pack (when installed) → the network**. A local hit makes no request
  and no reader call. An entry may answer only if one of these holds:
  - the same topic was asked before;
  - the title is the query;
  - the title sits inside the query. Then every name word must be in the title and every other significant word in the title
    or the summary.

  On top of that, the same name, model and relevance guards apply, plus the biography guard. "Eiffel Tower" is never
  answered with "Eiffel". The facts are validated again on every use.
- **Stale check:** an entry whose revision is older than 180 days, and was not checked in the last 7 days, gets ONE revision
  query after the reply (`research.afterAnswer()`, which the agent calls after it speaks; a 45 s timer is the fallback). It runs
  only online and never blocks. Same revision: `checkedAt` is updated. A newer revision: the entry is marked `stale`. The next ask
  reads the page live; the 14-day cache counts only when it holds that newer revision. The entry is then replaced. If the live
  read fails, the kept facts answer, flagged "changed since".
- Settings › Assistant › "Things the assistant has looked up · N" › **Clear** (`research.clearAll()`) empties the KB, the 14-day
  cache and the miss memory. `research.purgeRecent(hours)` is the injection escape hatch, and it drops KB entries saved in that
  window too. Nothing in the KB is ever uploaded.
- `createResearch({ kb })`: `'auto'` (default) uses `p0pc0rn-kb`, or `<dbName>-kb` for another dbName; `null` turns the KB off.

### The starter-KB seam (v021 interface; the pack itself is wired in v022, below)

```js
// app.js: const STARTER = null;  ->  RS = await createResearch({ starter: STARTER });
starter = {
  name: 'starter',          // shows as rec.local
  readOnly: true,
  async search(query) {     // -> Promise<Entry[]> (generous is fine: the lane filters and guards)
    return [/* Entry */];
  },
};
// Entry = {
//   key, site: 'wikipedia' | 'fandom', wiki (fandom subdomain or null), title,
//   topics: [normalised keys],                  // lower case, a-z0-9 and single spaces
//   facts: [{ relation, value, kind }],         // the closed schema; validated again on use
//   lines: [rendered fact lines], summary (<= 300 chars), categories, flags, others, isPerson, isCharacter,
//   source: { site, wiki, siteName, url, permalink, authors, license, licenseUrl, revid, revised (ISO), retrieved (ISO) },
// }
```

The starter is checked after the phone's KB and before the network, with the same match rule and guards. Its `url`,
`permalink` and `authors` must be `https://en.wikipedia.org/...` or `https://<wiki>.fandom.com/...`, or the entry is refused.
A starter hit is cited "as of <revised>" and is NOT copied into the phone's KB, so the count in Settings stays "what the
assistant has looked up". Its entries never get the stale check: the pack is replaced as a whole.

## 13. v022: quote-anchored facts, the likeness gate, the starter knowledge pack

### The reader, v022 (`assistant/research.js`): the page in portions, TOON rows with a subject, quote-anchored

The page is cut into portions by code (`portions`): paragraphs, with long ones split into a few sentences of at most 520 characters,
never across a section, and at most 3 per page.

1. **One reader call per portion.** Each call is a short, stateless call with no tools and no history. The user turn is
   `ARTICLE: <title> / SECTION: <heading> / TEXT: <portion>`.
2. **TOON output.** The reader answers in TOON, the notation of the KB and the starter pack, with the subject written out on every row:
   `facts[N]{subject,relation,value,quote}:` then `  subject,relation,value,"quote"`.
   - The answer is forced to start after that header (`READER_PREFIX`).
   - maxTokens is 220 and there are at most 5 rows per portion.
   - `parseToon` is tolerant: cells may be quoted, and the quote is the last column. A short row or an unclosed quote is dropped, never
     guessed.
3. **Code keeps a row only if its subject IS the article** (`subjectIs` against `aliasesOf`): the title with or without its
   disambiguator, the topic it was looked up as, the name that opens its first sentence, and any "known (professionally) as …" name.
   - A shorter form of one of those names also counts.
   - "it", "he" and "she" never count.
   - Rows about any other named entity are dropped and counted in `lastRead.other`. That is how "A Hard Day's Night, released, 1964"
     stays with the film.
4. **`quoteOk` per row, against its own portion:**
   - **The quote is in the text.** Case, whitespace, quote marks, dashes, thousands separators and punctuation are normalised; "..."
     may join pieces.
   - **The value is in the quote.** Numbers may be digits or words, with the unit beside them. Dates may be ISO or written out. A year
     span needs every year.
   - **The relation word is in the quote, outside the value.** For a "when" relation it must come within 7 words before the value, and
     no other Name may come before it.
   - **Shape rules:**
     - a nationality is a demonym;
     - capital_of reads "capital of";
     - a population is current;
     - a role is never the show it was in;
     - the "by" relations need a name.
5. **`subjectFilter` on the whole page** (`personSign` on the page text):
   - a person keeps only `PERSON_OK` relations;
   - only a person is born or dies;
   - role, era and occupation belong to a person;
   - nationality and appears_in need a person's page;
   - a thing's affiliation names its owner;
   - one-value relations keep one value.
6. **The relation whitelist.** On Wikipedia only `WIKI_OK` is kept: born, died, nationality, occupation, located_in, capital_of,
   population, area, elevation, height, length, depth, founded, founded_by, opened, built, designed_by, directed_by, developed_by,
   author, creator, headquarters, genre, known_for, affiliation, part_of and date_of. "released" was dropped in round 6. A fan wiki
   also keeps `FICTION_OK`: the look relations, franchise, species, homeworld, weapon, appears_in, first_appearance, role and released.
   "List of …" pages give no facts.
7. **The same code runs in the app and the bench.** `Research.read()` calls `readFacts(parts, title, page, site, names)`, and
   `bench/revalidate6.mjs` runs that code on the saved answers. Dropped rows are in `research.lastRead`.
8. **Storage and the planner.** Each fact's quote is stored with it (KB entries are `v: 2`; a v021 entry is read again live). The planner
   sees only the rendered fact line, never the quote.
9. **Unverified starter facts.** Starter-pack facts marked `unverified` render as "Reportedly …".

### The likeness gate (`assistant/likeness.js`, wired in `agent.gateRender` / `likeCheck`)

- Facts may go into chat answers and lyrics, names included. A visual job (make_picture, edit_picture, make_clip, animate_picture,
  clip_between, make_music_video and its shots, rerolls) is an original take.
- `entityClass(record)` decides what may be named:
  - **Protected:** people, characters (any Fandom page), brands and works.
  - **Fine as a named setting** (no logos): places, events, historic objects and nature.
- `blockTerms(record)` collects a protected record's identity: its title, title words, aliases and the entries that also matched.
  It also collects its other names (franchise, creator, the names in its fiction, the name on its emblem) and its looks: colour,
  material, form, style, weapon, plus `signatures` from safety_terms.json.
- The first hit in a visual prompt gets ONE rewrite request that names the offending words. A second hit is stripped in code:
  - an identity becomes the generic descriptor ("a singer-songwriter", "an original shield");
  - other names and any TWO looks of one entity are cut with their phrase.
- After the code gate, a forced E2B `recognisable` yes/no call runs. On yes, one `original_prompt` regeneration runs, and it passes
  through the code gate again.
- The person sees one plain line: "Here's an original take inspired by <subject>. p0pc0rn doesn't recreate real people or
  copyrighted characters." Every hit is logged in `agent.likeLog`.
- Real people and famous characters named in a visual request are transformed, not refused. NCII and minors are still hard
  refusals.
- Songs: lyric lines that copy 6 or more words of the source are dropped. The check uses the text, or 32-bit shingle hashes when only
  the KB entry is at hand. Style tags lose any artist name (`cleanTags`), and the writer is told never to quote an existing song.

### The starter knowledge pack (`assistant/starter.js`, `assistant/kbstarter.js` from the pack builder)

- **Settings:** Settings › Models › "Starter knowledge" › "Download starter knowledge · 3 MB". It downloads the manifest, index and 7
  shards (the gzip files: 2,631,059 B) from the starter pack's address (config.js) into IndexedDB `p0pc0rn-starter`.
- **Checks:** sha256 is checked when each file arrives. kbstarter.js inflates and re-checks it on use.
- **Engine:** it is an engine-shaped object (status / download / deleteModel), so pause, resume and delete work like the models.
- **Lookup order:** the phone's KB, then the starter pack (`title_match` exact / exact_base / alias / all_words only), then live
  Wikipedia/Fandom.
- **Relations:** starter facts outside the phone's closed schema are left out. director, plays_for, team, party and writer map to
  the phone's names. Starter hits are never copied into the phone's KB.

## 14. v023: the music video from a landed song (`assistant/storyboard.js`, `assistant/mvflf.js`)

There is no chat command for it. app.js removes `make_music_video` from `MAIN_TOOLS` (as it removes `add_sound`), so the planner is never
offered it. The v019 `musicvideo` runners stay only for jobs already in a queue.

There are two entry points:
- a landed song's bubble in the chat (`Animate`, `ui/chat.js` -> `api.animateSong(jobId)`);
- the Library song viewer (`#v-anim`).

Both open the same sheet:
- the shape: tall 480x832 (the default) or wide 832x480;
- a direction of at most 300 characters (optional);
- "Stop at the storyboard", ticked by default;
- the honest estimate (`mvflf.estimate`).

**Make** calls `startMusicVideo(Q, song, {shape, direction, hold, session, brain})`. This adds ONE durable `mvflf` job, with the song's
blob copied into the queue.

### Timing (code; the model never computes times)

- `shotTimes(duration)` gives one shot per 5 s of the song. Each shot is one SANA clip of 81 frames at 16 fps.
- The last shot is shortened to the 8k+1 frame count that covers what is left (at least 17 frames), so its end cap lands on the song's
  end. Examples:
  - 47 s is 9 x 81 frames plus 33 frames;
  - 8 s is 81 + 49 frames.
- `shotSlots(song)` gives every slot its section and the line sung at that moment.

### The storyboard (`mvplan` child job, Gemma 4 E2B)

1. `plannerMessages` / `PLANNER_SYS` set up the call: JSON only, one row per shot `{n, join, first, last, motion}`.
   - The answer is forced to start `{"shots":[{"n":<first>,`.
   - A long song is planned in chunks of 12 shots.
2. Code checks the rows (`parsePlan`, `checkRows`):
   - extra keys are dropped;
   - a repeated, out-of-range or non-object row is dropped;
   - shot 1 is always a `cut`;
   - word limits apply (frame 6-90 words, motion 3-60);
   - a cut-off answer keeps its complete rows.
3. Whatever is unusable is filled per field from the deterministic `fallbackShots`. A planner that answers prose gives the whole
   fallback storyboard. `sb.source` is `model`, `mixed` or `fallback`.
4. Joins:
   - a `cut` shot opens on its own painted first frame;
   - a `continues` shot opens on the previous shot's LAST frame, with no new paint, so one action can run across 10 or 15 s without a
     jump.

### The gate on every frame prompt, motion line and nudge (`storyboard.gate`, synchronous)

1. `screenRequest`'s absolute cases are refused (`refused: code`). The fallback text is used in that slot.
2. Famous characters and brands from the static lists, and the people and things in `records`, are rewritten by `likeness.stripPrompt`
   into an original take:
   - the names become the generic descriptor ("a person", "a singer-songwriter", "an original character");
   - the look terms are cut;
   - the strip is logged in `sb.like`.
3. Coffee sentences go unless the song asked for coffee.
4. Clip-model camera words go from motion lines.

`records` are the phone's KB entries (`likeSources`) plus, since the v023 merge, the real people the plan names:
- `planStoryboard({..., moreRecords})` passes the planner's rows and the direction to `cfg.realPeople`;
- in app.js that runs `research.isRealPerson` on each proper name (at most 8). That is the chat's deterministic check: a Wikipedia
  opensearch plus the page's person signs, cached in IndexedDB, with no model.
- It is off when lookups are off in Settings.
- A reroll's nudge goes through the same lookup.

### The phases (one model on the GPU at a time; each frame, shot and cut is a child job)

1. **plan:** the `mvplan` job (the assistant). If the assistant is not installed, the fallback storyboard is used.
2. **frames:** Klein paints EVERY keyframe as a `picture` child: 4 steps, at the clip size, with tag `f<k>v<version>`. A failed frame
   gets one automatic retry with the same words and a new seed. After that it is `stuck` and the person decides.
3. **board:** with "Stop at the storyboard" ticked, the job waits:
   - the person can reroll any frame (`requestFrameReroll`: a new version, with an optional nudge of at most 300 characters; the last 3
     nudges are kept);
   - then taps `Animate N shots` (`requestGo`).
4. **shots:** SANA `framesToVideo` films each shot as a `between` child, between its two CURRENT frames (the end caps), using the motion
   line plus any nudges.
5. **cut:** `assemble` joins the takes and muxes the song with `mp4.js` (AAC where the browser encodes it, else Opus).
   - The cut lands in the Library: `vmode: 'mv'`, `kind: 'musicvideo'`, `mvId`, `mvVersion`.
   - It also lands in the chat ("Your music video is ready", with Edit video).

### Rerolls

- **A shot** (`requestShotReroll`), with a nudge and "Repaint the stills":
  - Off: a new motion take between the same frames.
  - On: the shot's own frames are repainted first (a `continues` shot owns only its last frame), then a new take is filmed.
- Rerolls queue at the TAIL of the job, and the video is cut again when they land.
- After the video is done, a reroll makes a new version: a new `mvflf` job with `editOf`, which copies the frames and takes it keeps.
  Every cut stays in the Library ("· version 2").

### Durability

- The coordinator saves its stage before every wait.
- Children are added once per tag (`enqueueOnce`), never twice.
- A page kill puts the running child back in the queue with the same seed (the engines resume their checkpoints), and the coordinator
  carries on from its stage.

### Estimate

`mvflf.TIMES` holds the iPhone 16 Pro Max figures:
- a Klein frame at 1280x720 takes 180 s, scaled by pixels;
- one FLF take of 5 s takes 496 s (measured);
- the planner takes about 10 s + 8 s per shot;
- the cut takes 15 s + 1 s per shot.

A 30 s song (6 shots, about 9 frames) comes to about 67 minutes; 60 s comes to about 2.2 hours. The job's own finished children replace
the figures while it runs (`progressOf`).

There is no model QA and no contact-sheet review: the person is the QA (Josh: "bare bones, user rerolls, no QA from model").

## 15. v022.1: the quoted-sentence reader (replaces § 13's reader; Josh, Oct 13)

The phone stops labelling facts. Every error left in round 6 was a relation the model chose, and the values themselves were right. So
the reader now only COPIES: the facts are the page's own sentences.

### The read (`Research.read()` -> `quoteSys()` / `readQuotes()`, `assistant/research.js`)

- **Portions.** Round 6's portions: paragraphs, with long ones cut into sentences of at most 520 characters, at most 3 per page.
  - A portion is never cut after a short abbreviation (St., Inc., Mr., ...) or a single initial ("U.S.", "D.").
- **One call per portion.** The call is short and stateless, with no tools and no history. The user turn is
  `ARTICLE: <title> / SECTION: <heading> / TEXT: <portion>`.
- **TOON output.** The answer is `quotes[N]{subject,quote}`. It is forced to open with that header (`QUOTE_PREFIX`); maxTokens is 320;
  there are at most 5 rows.
  - subject = the article's name when the sentence tells something about it. Otherwise it is the name of what the sentence is about.
  - quote = one sentence (or one clause of a long one), copied exactly.
  - There is no relation and no value.
- **`parseQuotes` is tolerant.** A row that does not read as 2 cells is dropped, never guessed.

### Code keeps a row only if all of these hold (`quoteCheck`)

1. **The subject is the article** (`subjectIs` against `aliasesOf`: the title, the topic it was looked up as, the opening name,
   "known as ..." names), or it is "The <class noun>" ("The band").
2. **5+ words, at most 240 characters, not boilerplate.** Boilerplate is "main article", "see also", "this article", "Wikipedia",
   pronunciation guides and IPA.
3. **Verbatim in its own portion.** Only Unicode form, quote marks, dashes and whitespace are normalised; case and words must match.
4. **A whole sentence or clause.** It starts at the portion's start (with a capital, a digit or a quote mark) or after `. ! ? ; : , ( "` or
   a dash. It ends at the portion's end, before one of `. ! ? ; : , ) "`, before a dash, or before a parenthesis.
5. **It names the article.** That means one of:
   - one of the article's names (a ship's also without "SS" / "HMS" ...);
   - the surname, on a person's page;
   - "the <class noun>" ("the dam"), where the class noun comes from the first sentence's "is a ... <noun>";
   - the class's generic word ("the structure" for a bridge / dam / tower, "the group" for a band, "the ship" / "the vessel" for a ship);
   - OR its main clause opens with a pronoun that can stand for THIS article (`pronounLead`: a person he / she / his / her; a band or
     team they / their / it / its; a ship she / her / it / its; anything else it / its), and the sentences before it in the portion
     are about the article (or it opens the portion).
6. **No duplicates.** A quote inside a longer kept one is a duplicate, and the longer one is kept.

At most 8 quotes per page are kept, in page order. The kept quotes ARE the facts: `{relation: 'quote', value: <the quote>, kind: 'quote',
quote}`. The round-6 type guards and relation whitelist do not apply, because there is no typed value.

### Use

- **The planner and the song writer.** They get each quote as `- According to Wikipedia: "<quote>" [n]` (or the wiki's name), plus a
  NOTE to say "according to ..." and use only what the quotes say. The citation footer carries the revision link as before. That is the
  same for a live read and for the phone's KB: the quotes are the page's words either way.
- **Songs.** The closed check counts a quote as used when one of its numbers is sung, or else one of its distinctive words (5+
  letters, not filler). It reports that number or word, never the sentence. `dropQuoted` still drops any lyric line that copies 6
  words in a row from the source.
- **The phone's KB.** Entries are `v: 3`. Each keeps `quotes` rows `{subject, quote, source (the revision link), revision, retrieved}`
  and the same rows as TOON (`toon`: `quotes[n]{subject,quote,source,revision,retrieved}`).
  - On use the quotes are re-checked (`validQuotes`).
  - A v1 or v2 entry (labelled facts) is read again live.
- **The 14-day page cache.** It moved to new keys (`w3:` / `f3:`).
- **The starter pack.** Unchanged: relation rows, "Reportedly ..." for the unverified ones. It is looked up by subject as before
  (KB -> starter -> live).

The round-6 reader (`readerSys`, `readFacts`, `quoteOk`, the A/B check, `typeGuard`) stays in the file for the bench, unused by the app.

## 16. v024: memory, a page kill in a turn, diagnostics

### The crash on Josh's iPhone (Oct 13, v023)

"Make me a song about roses" went to "No facts found", then "Thinking...", then the page died. The resumed turn ended "Sorry, I couldn't
finish that (ERROR)".

The real smoke now accounts memory at every step: the WebGPU buffer bytes alive at the peak, counted at every `createBuffer` / `destroy`
on the page, plus the JS heap peak. Each step must stay under the iPhone's 1,856 MB, or the smoke fails it. On v023 it showed two causes:

1. **The weight loader's staging buffers were cloned, not transferred.** Every 16 MB chunk read for an upload (`core/store.js upload()`)
   was posted to the OPFS worker without its transfer list, so a 16 MB copy stayed behind on the page. That is 1.6 GB of garbage per
   assistant load, and more for the song models, and the JS heap reached 240-600 MB around the loads.
   - Now the buffer is transferred to the worker and back, zero-copy.
   - The assistant's load peaks at 35 MB of JS heap in the probe.
2. **A long prompt queued every prefill chunk at once.** Each queued batch keeps its own 128 KB uniform buffer (`Runner`), which the
   engine's own accounting never sees.
   - On the ~3,000-token planning call that was about 110 MB more on the GPU: a page-wide peak of 1,797 MB against the engine's own
     1,684 MB.
   - Now `prefill` waits for the GPU after each 256-token chunk. The peak is 1,685 MB and the prefill takes the same time (85 s for
     3,223 tokens on a desktop test GPU).

After the fixes, the real smoke (an integrated GPU, Chrome) measures, per step (GPU peak + JS heap peak):
- the assistant's calls in a fresh page: 1,750-1,786 MB;
- its loads: about 1,675 MB;
- the song (ACE-Step): 949-1,009 MB.

Two kinds of step still go over 1,856 MB in that accounting:
- **A turn right after a song render in the same page:** up to 1,883 MB, because V8 had not collected about 100 MB of the song engine's
  per-render tokenizers yet.
- **The first assistant load right after downloading every model in the same page:** 2,272 MB of download garbage.

Both are uncollected JS garbage. iOS (JavaScriptCore under memory pressure) is expected to collect sooner, but this is not measured on
the phone.

Two things were checked and are not the cause:
- **The reader's calls do not leak.** The KV cache (about 34 MB at 4,096 tokens) is freed and reallocated per call, and the engine's
  live bytes return to the resident 1,638 MB after every call.
- **The assistant and the song model are never resident together.** The queue unloads the assistant (all its buffers destroyed)
  before ACE-Step loads.

Also fixed: the engine's sampler (`temperature` / `topK` / `topP`, not used by the app) overflowed the stack on `Math.max(...logits)`.

### A page kill in a turn (`assistant/queue.js`, `app.js`, `assistant/agent.js`)

- A chat turn the page died in is retried ONCE (`maxKills` 1 for chat jobs; renders keep 2).
- The retry loads the assistant lighter (`lean`, about 1.2 GB resident) for that load, and the chat says so.
- If the page dies again in the same turn, the job fails with `KILLED`, and nothing runs again.
- A failed turn never shows a bare code. `failReason(job)` says what happened and what it was doing ("the page stopped twice while
  writing the song, so the phone is probably short on memory", "the phone ran out of memory while writing the song", "something went
  wrong while writing the song (...)").

### Diagnostics (Settings › About › Diagnostics)

- The last 50 steps are kept in localStorage (`p0pc0rn:diag`), so they survive a page kill. A step is any of:
  - the page opening (with what it resumed);
  - a job added, done or failed (with its full error);
  - a model loaded or unloaded;
  - an assistant call and its result (purpose, prompt tokens, tokens, the engine's GPU peak);
  - a song render;
  - a page error.
- Each step carries a memory estimate: WebGPU buffer MB alive and the peak since the step before, counted at `createBuffer` / `destroy`;
  and the JS heap where the browser reports it (not Safari).
- Settings shows the steps as text with Copy (the clipboard, or the text selected).
- Nothing leaves the phone.

## 17. v024.1: safe open, the song's file, the song probe

### Safe open after a page death (`app.js`)

- While a job runs, a breadcrumb is kept in localStorage (`p0pc0rn:inflight`): the job, its current sub-step, the engine's live / peak
  GPU MB. It is written when the job starts and at every new sub-step, and cleared when the job stops.
- If the page opens and the breadcrumb is still there, the page died in that job. Nothing resumes on its own: the queue stays paused and
  a card says "p0pc0rn closed while <the job> was working at <step>", with:
  - **Try again**: resumes the queue (a chat turn loads the assistant lighter for that load);
  - **Discard it**: cancels that job and its family, then resumes the rest;
  - **Diagnostics**: Settings › About › Diagnostics, with the queue still paused.
- The breadcrumb stays until a choice is made, so reopening asks again.
- `?safe=1` opens with the queue paused and nothing resumed or preloaded.
- Nothing here touches the downloaded models (OPFS) or IndexedDB.
- A song job, like a chat turn, gets ONE more try after a page death (`maxKills` 1); a second death fails it with `KILLED` and a plain
  message. It never ends DONE.

### Memory around "Mixing" (the song's VAE decode)

- Each denoise step streams the DiT as 24 equal layer shards (60.6 MB each). Each was uploaded into a new GPU buffer and destroyed
  right after: 192 create / destroy pairs per song. WebKit gives destroyed GPU memory back lazily, so the decode allocated on top of
  memory not yet returned.
- `WeightStore.release()` now keeps the last released shard buffer and `upload()` reuses it for the next shard of the same size
  (`_reuse`). Any other upload destroys it first, so the peak never grows. `drainPool()` destroys it before the decode and before
  saving. The same is in the bundled store in `engine/pocketflux-engine.js` (pictures / video), which also transfers its staging
  buffers now (v024's zero-copy loader fix).
- The decoder works in a 450 MB tile budget on every device (the engine's Apple default), so the desktop measures the phone's decode.
- The song's waveform is released before encoding. The WAV copy is only built when the AAC / Opus encode fails.
- The assistant's GPU device is destroyed when it unloads.
- Sub-steps reported through `onProgress` (and kept in Diagnostics): "Sound: loading the decoder", "Sound: part i of n",
  "Saving: encoding the sound", "Saving: packing the file", "Saving: writing a WAV file".

### The song's file (`engine/music/m4a.js`, `assistant/audiocheck.js`)

- **The AudioSpecificConfig.** `encodeStereo` took the AAC config only from the encoder's `decoderConfig.description`. When the encoder
  gave none (or ADTS-framed AAC), the esds carried an EMPTY DecoderSpecificInfo: Chrome plays that, Safari refuses it ("Error" in the
  player). Now:
  - the encoder is asked for raw AAC (`aac: { format: 'aac' }`);
  - ADTS headers are stripped, and the config comes from the first one;
  - otherwise `aacLcAsc(rate, channels)` builds the AAC-LC config (48 kHz stereo = `11 90`).
- **Faststart.** `muxM4a` writes ftyp, moov, then mdat.
- **Safari saves songs as WAV** (`songFormat()` in `app.js`; every iPhone browser is WebKit) until this phone has passed the AAC test
  on the song probe, which sets `p0pc0rn:aacOk` = '1'. WAV is plain JS and plays everywhere (about 11.5 MB a minute). Other browsers
  keep .m4a. The chat's Save button names the real file (.wav / .m4a).
- **No song is DONE with a file the phone cannot play.** The song runner calls `checkSong(blob, seconds)` before it returns:
  - `checkM4a(bytes, {seconds})`:
    - ftyp first; moov and mdat; no box running past the end;
    - the mdhd timescale and duration;
    - one sound trak whose stsd entry (mp4a / Opus) has 1-2 channels and a rate equal to the timescale;
    - for AAC, an esds whose AudioSpecificConfig is present (AAC-LC / HE), whose rate index is the track's rate and whose channel
      configuration is the entry's;
    - stsz samples inside mdat;
    - the length within max(1.5 s, 5%) of what was asked;
  - a WAV must start RIFF / WAVE;
  - `playable(blob)`: the browser's own media element loads it (loadedmetadata, a duration).
  - Only the structure check or an explicit media ERROR fails a song. iOS may hold media loading until a tap, so a player that never
    loads in 8 s is noted in `info.player`, not failed.
- A file that fails throws `BAD_AUDIO`: the job fails with "The song was made, but this phone could not play the file, so it was not
  kept", never DONE with a player that says "Error".
- The chat shows no player for a missing file ("The song file is missing.") or one the player refuses ("This phone could not play the
  song file.").

### The song probe (`probe-music.html`, same origin as the app)

The ACE-Step engine alone, with a breadcrumb at every step. It uses the Music model and the agreement the app already has, and nothing
runs until a tap.

- **Make a 10 s song / Make a 60 s song.** Options:
  - the lyrics planner (on);
  - a smaller decode budget (300 MB);
  - save as WAV (skip the AAC encoder).
- **Test the sound encoder only.** No model: 60 s of stereo tones -> AAC -> .m4a -> the structure check + this phone's player; then a
  WAV the same way. It sets or clears `p0pc0rn:aacOk` for the app.
- Every progress change is a log line: the step that is starting, with the peaks since the line before. It has the local time, the engine's live / peak GPU MB, the page-wide GPU MB (every `createBuffer` /
  `destroy`), and the JS heap where the browser reports it. Then:
  - "engine returned" (codec, MIME, bytes, timings);
  - "file checked";
  - "player check";
  - "device destroyed".
- The log (the last 400 lines) is saved in localStorage after every line (`p0pc0rn:probe-music`). If the page dies, the next open
  says at which step, and **Copy the log** copies it.

## 18. v024.2: nothing allocated per step in the song's loops; a planned fresh page between heavy stages

### Josh's iPhone on v024.1 (Oct 14, 07:50)

The page died at "Mixing · Sound: part 7 of 24". Diagnostics showed everything the engine tracks flat and small: 174 MB live per
part (peak 347), with the page at 176 MB. It died about 48 s after the 1.6 GB assistant unloaded. What kills the page is GPU memory
already destroyed that WebKit has not given back yet, and no counter on the page can see it.

### No transient GPU allocations in steady loops (`engine/core/gpu.js`, `engine/music/ace.js`, `engine/music/music.js`)

- **The decoder's working set** is three buffers, allocated once at the largest part by `AceVae.arena(nMax)` and reused by every part:
  - `F` (f32): each stage's input / output stream;
  - `B1` (f16): the snake activations;
  - `B2`: the residual units' hidden state, then the waveform.
  - In every dispatch the source and the destination are different buffers, and a stage's input is consumed before its output lands
    in the same buffer.
  - At the iPhone's 450 MB budget the three come to about 173 MB. It used to be 22 buffers created and destroyed per part.
  - `decodeTile` returns `B2`. The caller reads it and never frees it; `unload()` frees the arena.
  - The output is byte-identical to v024.1's decoder: the same 10 s song, same SHA-256.
- **Every decoder part:**
  - reads with `g.readInto()` into one array;
  - writes its PCM straight into the whole song's `L` / `R`. The encoder takes them as they are, and parts decoded before a reload
    come from the checkpoint;
  - awaits `g.done()` before the next part;
  - reports `gpuBufs`, `gpuMB`, `bindGroups` and `readbacks` in its progress.
  - If the part size differs from the checkpoint's parts, the decode starts over.
- **`Gpu.read` / `readInto`** use ONE reusable MAP_READ staging buffer:
  - it grows by powers of two up to 16 MB, and bigger reads get their own;
  - it is mapped, copied out and unmapped every time;
  - reads are serialised.
- **`Runner`:**
  - The uniform-batch buffers are a fixed ring of up to 64, never destroyed while the device lives. After every `Gpu.done()` they are
    taken in order from the start, so the same work uses the same buffers and slots. A ring buffer still in flight is skipped.
  - Bind groups are cached by (pipeline, uniform buffer, slot, bindings). The cache holds at most 8,192 entries and is dropped on any
    `Gpu.free`, so nothing cached outlives a buffer it binds.
  - The decoder makes no bind group from its second part on.
- **The DiT's constants** (`dit.const`) stay on the GPU from `prepare()` to `freeState()`. They were uploaded and destroyed twice per
  denoise step.
- **NOT changed:** the bundled pictures / video engine (`engine/pocketflux-engine.js`: the LTX-2 decoder's tiles, Klein's VAE). It
  has its own copies of `Gpu` / `Runner` and still allocates per tile.

### A planned fresh page (`app.js`, `assistant/queue.js`; on by default on WebKit, off on desktop)

- `freshPage(stage, jobId)` reloads the page when this page has destroyed enough GPU memory, as the page-wide meter counts it (a
  device destroyed whole counts):
  - **before a model loads** (`hostCreate`): 256 MB. Not between two assistant turns, which unload whenever the queue is idle; only
    after another model;
  - **before the song's denoise** (`textToMusic({ beforeStage })`; the plan is in the checkpoint): 64 MB;
  - **before the song's decode** (the denoised latent is in the checkpoint): 64 MB.
- What it does:
  - marks the running jobs (`p0pc0rn:planned` = {t, ids, stage, key});
  - covers the page with "Freeing memory…";
  - calls `location.reload()`.
- On open, the queue's `planned(job)` puts those jobs back as queued with `fresh += 1` and NO kill. Nothing is paused and no card is
  shown; a "Freed memory: continuing" toast appears, and Diagnostics gets "fresh page: continuing".
- At most once per job and stage (`p0pc0rn:freshDone`, 30 min).
- A real crash (a breadcrumb without the marker) still opens the safe-open card.
- `localStorage['p0pc0rn:freshPages']`: `'1'` on, `'0'` off, `'always'` reload at every boundary regardless of the bytes (tests).
- The music engine's `textToMusic` takes `beforeStage(stage)`, an async callback before `'denoise'` and `'decode'`, and the engine
  waits for it.

### Diagnostics

- Every step carries:
  - the page's live GPU buffer count (`gpuBufs`);
  - the bytes destroyed in the last 60 s (`freed60MB`) and since the page opened (`freedMB`).
- A job's step also has the engine's buffer count (`engineBufs`) and the bind groups it has made (`bindGroups`).

### The song probe

- The same counters on every line.
- Decode budget 450 / 300 / 200 MB.
- "Fresh page between stages", ticked by default on iPhone, with the same 64 MB rule. The run continues by itself after each reload,
  and `?fresh=always` forces it.
- The song's SHA-256 (the first 8 bytes) on "engine returned".

## 19. v026.1: seamless planned reloads; the song's .m4a on Safari

### Seamless planned reloads (`index.html`, `app.js`)

- `freshPage()` stores the screen in the marker (`ui`: the tab, the open storyboard `board`, whether the queue sheet is open). It reads
  the marker back before reloading; without it there is no reload. It puts up the cover (`html.pf-fresh`) and reloads.
- If the page is still there 8 s later, the cover goes, Diagnostics says so, and the work carries on in the same page.
- An inline script in `index.html`'s `<head>` sees a recent marker and sets `html.pf-fresh` before anything renders. An inline style
  then paints the cover ("Freeing memory… continuing") as the first frame and hides everything else. It is taken down after 20 s if the
  app does not start.
- `restoreUi()` runs at the end of `boot()`. Under the cover it:
  1. calls `go(ui.tab)`;
  2. awaits the chat's rebuild (`S.chatShown`);
  3. reopens the storyboard or the queue sheet;
  4. scrolls the chat to the bottom.
  The cover goes two frames later.

### The song's .m4a on Safari (`engine/music/m4a.js`, `assistant/audiocheck.js`)

- Safari's `AudioEncoder` gives a whole ES descriptor (`03 .. 04 .. 05 11 90 ..`) as `decoderConfig.description`, not an
  AudioSpecificConfig. `encodeStereo` therefore ALWAYS writes `aacLcAsc(rate, 2)` (11 90) for AAC: the song is AAC-LC by construction.
  It returns `diag` = {encDesc (hex), encDescLen, adts, ascUsed, frames, priming}, which the engine passes on as `aacDiag`.
- `muxM4a`'s esds:
  - ES_ID 1;
  - DecoderConfig 0x40 / 0x15;
  - bufferSizeDB = the largest frame;
  - maxBitrate = the most bits in any 1 s window (at least the average), avgBitrate = the song's average;
  - the ASC.
- `checkM4a`:
  - names an ES descriptor nested as the ASC;
  - checks the DecoderConfig object type (0x40) and stream type (0x15);
  - reports `dcd` = {oti, stream, bufferSizeDB, maxBitrate, avgBitrate}.

### The probe's fresh pages

- Every run has an id. The once-per-stage allowance is per run (`p0pc0rn:probe-music:freshDone` = {run, stages}).
- The continue marker is read back before the reload.
- The reopened page logs "page reopened" first.
- A reload that has not happened within 8 s is logged, and the run carries on in the same page.

## 20. v026.2: the research list; a slow planned reload

### The research list (`assistant/agent.js`, `ui/research.js`, `ui/chat.js`, `app.js`)

- The agent keeps one row per topic on the chat job (`st.rl`): {topic, status: searching | found | miss | skipped, origin: local | web,
  cached, local, title, site, url (the revision link), asOf, reason, quotes (kept), used (the facts the lyrics used)}.
  - `rlSet()` updates a row and emits `'research'` (sid, jobId, rows).
  - `rlDiag()` emits `'diag'` (step, data). The app writes it to Diagnostics.
- Where the rows come from:
  - `doResearch()`: a searching row, then found / not found, with the reader's `lastRead` stats (kept, dropped, why);
  - `groundSong()`: a skipped row for every skip (research off, instrumental, no subject, a personal subject, an abstract subject, the
    subject could not be sorted), and a miss when the page is not about the subject;
  - the song writer: `used`.
- Where the rows go:
  - the reply message (`m.research`);
  - the song / music-video job (`params.research`), so the Library meta has `research`.
- `ui/research.js`:
  - `researchList(rows, {live})`: the live list, or a collapsed summary ("🔎 grounded on N sources" / "research found nothing · N
    missed" / "no research: <why>") over the same list;
  - `lyricsEl(lyrics, rows)`: lyric lines marked when they sing a used fact;
  - `usedQuotes`, `lyricMarks`.
- Diagnostics keep 200 steps. The research steps are:
  - "research: the song is about";
  - "research: looking up";
  - "research: found" (from the web / the cache / the phone; kept, dropped, the reader's reasons);
  - "research: not found" / "not about the subject" / "skipped";
  - "research: the lyrics use".

### A slow planned reload

- `freshPage()` asks for the reload again after 15 s and gives up after 60 s. It never removes the marker, so a reload that lands late is
  still a planned one: the cover comes up and the screen it left comes back.
- "fresh page: continuing" logs:
  - the navigation type;
  - whether the cover was up when the app started (`coverAtStart`);
  - how long the reload took (`reloadMs`);
  - the tab to restore.

## 21. v026.3: the pictures / video engine's reuse pool; a fresh page per render job; music-video continuity

### Reuse pool (`engine/pocketflux-engine.js`, its own `Gpu`)

- `buffer(size, label, usage)`: a pooled buffer of exactly this size and usage is reused; otherwise a new one is made.
  - A reused buffer is cleared first: the runner is flushed, then a `clearBuffer` is submitted before anything later can use it. Results
    are byte-identical to fresh, zeroed buffers.
- `free(b)`: the buffer goes to the pool when `alive + pooled + size <= poolCap()`, else it is destroyed.
  - `poolCap()` = `hw + maxBuf`: the most live bytes this device ever held, plus its largest buffer.
  - The extra largest buffer is exactly room for a streamed loop's alternate weight shard. Klein streams 5 double + 20 single blocks
    per step; with the cap at `hw` alone, every step destroyed one shard size and made the other.
  - (Not `cap()`: that is the existing dispatch-size cap.)
- Before a new buffer is made, the oldest pooled buffers are destroyed until pooled + live fit the cap.
- `drainPool()`, `poolStats()` = {aliveMB, pooledMB, bufs, pooledN, creates, reuses, evictions, hwMB, capMB}. Every progress event of the
  Klein / SANA / i2v pipelines carries `pool`. `freeAll()` also drains the pool.
- `read()` uses one reusable MAP_READ staging buffer (powers of two up to 64 MB; larger reads get their own). Reads are serialised.
- The `Runner` keeps up to 64 uniform-batch buffers.
- `LTX2Decoder` keeps one readback staging buffer per decoder, across sub-tiles, tiles and clips. Its tile reports (and the progress
  events' `pool`) carry `poolStats()`.
- Every textToImage / imageToImage / textToVideo / imageToVideo / framesToVideo result has `gpuPool`.

### A fresh page per render job (`app.js`, WebKit)

- `beforeRender(kind)` runs before every picture / clip render: the clip adapter's methods, and a Proxy on the pictures engine's
  `textToImage` / `imageToImage`.
- It calls `freshPage('render <kind>')`. That reloads whenever another render already ran in this page (`RENDERED`), or when the page
  has destroyed 64 MB or more.

### Music-video continuity (`assistant/mvflf.js`)

- `depOf(sb, k)`: the frame k is edited from (null = the opening frame, painted from text).
  - A last frame comes from its shot's first frame.
  - A cut's first frame comes from frame 0.
- `enqueueFrame()`:
  - the opening frame is a `picture` job;
  - every other frame is an `edit` job {inputKey: the reference's CURRENT image, attested: true, reference: 'half',
    mv: {frame, v, nudges, ref: {k, v}}}.
- `leadLine(sb)`: the opening prompt's subject and place. `framePrompt()` appends "Keep the same lead and world as the reference: …".
- The frames stage:
  - waits for a frame's reference;
  - re-edits a last frame whose reference was repainted (`stale`: its `ref.v` is no longer the reference's current `v`).
- `handleRequests`: a shot reroll whose last frame went stale repaints it first, then asks again for the take (a follow-up `mvreq`).
- `requestFrameReroll()`: the frame is edited from its reference's current image when it has one.

### The music video's segments (`assistant/storyboard.js`, `assistant/mvflf.js`, `assistant/runners.js`)

- `CLIP` = {frames: 81, keep: 72, drop: 9, fps: 16, seconds: 4.5}.
- `shotTimes(d)` gives 4.5 s segments {n, start, dur (kept seconds), frames (rendered), keep}. The last segment keeps what is left and
  renders the 8k+1 count that covers it + 9.
- The between runner renders `frames` with `_keepFrames`, reads frame `keep-1` back (`result._r.readFrame(f)`, new on the
  engine's video results) and returns it as `handoff` (a PNG).
- The cut trims every clip to `dur` (`concatVideo` durations).
- A 'continues' shot is chained:
  - `chainedLast(sb, k)` marks its last keyframe;
  - the frames stage skips it;
  - the shots stage first edits that keyframe from the previous take's `handoff` (`mv.ref.handoff`), then films from the handoff
    (`mv.fh`) to it.
  - A new previous take (a reroll) makes both stale: they are redone before the cut.
- `buildStoryboard` turns a third chained segment into a cut (a beat is at most 9 s).

### Standalone first/last-frame clips (`assistant/runners.js`, `app.js`)

- A 'between' job WITHOUT `params.mv` (Create's Between two pictures, the Library's Make a clip / Clip to another picture, the
  chat's clip_between) is saved trimmed: `FLF_DROP` = 9, `flfKeep(frames)` = frames - 9 (81 -> 72), `keepHead(blob, keep, fps)` remuxes
  the first `keep` frames (mp4.js `assemble`, no re-encode). The result: `frames` = kept, `rendered` = the engine's count,
  `fileFrames` = the frames the remux wrote.
- The app's Create 'resume' runner trims an unfinished first/last-frame clip (`params.ui.kind === 'flf'`) the same way.
- `lenText(frames)` is a saved clip's length (kept frames / 16); `lenLabel(n, kind)` a length pick's (n - 0.5 s for 'flf').
- Music-video takes keep the whole render (the cut trims, the handoff is frame keep-1). i2v and t2v are not trimmed.

## 22. v026.4: licence compliance (the AI label, the LTX-2 acceptance, the starter pack's credits, Fandom licences)

### The AI label on exported files (`export.js`)

- `tagMedia(blob) -> Blob`: the same media with ONLY the string `AI_TAG` ("AI-generated with p0pc0rn") in its standard text fields, every
  other metadata field dropped. PNG: tEXt `Comment` + iTXt XMP (`dc:description`); JPEG: COM + APP1 XMP (JFIF / ICC / Adobe kept);
  MP4 / M4A: `moov/udta/©cmt` (QuickTime text) + `moov/udta/meta/ilst/©cmt` (iTunes) + a top-level XMP `uuid` box appended at the end,
  `stco` / `co64` shifted by the moov's size change (fragmented files: the XMP box only); WAV: `LIST/INFO/ICMT`. Anything else: unchanged.
  The media data is never touched (decoded frames and samples are byte-identical).
- `readTag(blob)`: how many times the label occurs (PNG 2, MP4 / M4A 3, WAV 1).
- `SHARE_TEXT` ("Made with AI using p0pc0rn") is the share sheet's text (`util.share(file, fallback, text)`).
- app.js: `exportOf(o)` makes and caches `o.expFile` for `{blob, seed, createdAt}`; `shareItem(o, fallback)` shares it (prepared ahead so
  the share sheet opens inside the tap); `aiReminder()` toasts once per phone (`p0pc0rn:aiReminded`). The viewer shows a picture's
  labelled copy (a long press saves it); its Download link is the labelled copy. The Library keeps the untouched originals.

### The LTX-2 licence before the video model or the picture reader downloads (app.js)

- `startDownload('video' | 'reader')` opens the `#ltx` sheet unless `p0pc0rn:ltx-license` = `{license, date: '2026-01-05', acceptedAt,
  gemmaNotice}` is stored. The sheet: a five-point summary, the Gemma NOTICE line + the Prohibited Use Policy link, the full
  licences/LICENSE-LTX-2.txt (I accept is enabled only when its text with ATTACHMENT A has loaded). A new licence date asks again.

### The starter pack's credits (`assistant/starter.js`)

- `extras({only})`: CREDITS.md, NOTICE.md and LICENSE from the pack, each checked against `manifest.files[name].sha256` and kept in the
  pack's IndexedDB. A phone whose stored manifest predates them reads the server's manifest (stored when its data hashes match).
  `download()` fetches them after the data files (never failing the pack); `credits()` returns CREDITS.md (Settings › About).

### Fandom licences (`assistant/research.js`)

- `wikiLicense(siteinfo) -> {ok, name}`: false for a non-commercial or no-derivatives wiki (siteinfo `rightsinfo` text or URL); unknown =
  Fandom's default CC BY-SA 3.0. `fandom()` returns a miss for such a wiki and `chooseWiki()` skips it.

## 23. Cast (Josh, Oct 14: "Voice clone successful. Wire it in to cast under settings") + Make them talk (EXPERIMENTAL)

### Cast (`cast/cast.js`, `cast/cast_ui.js`, IndexedDB `p0pc0rn-cast`)
- Cast (its own screen since 3.9; Settings links to it) lists the people this phone may use by name.
- **Add a person** has three steps:
  1. The name.
  2. The consent step: "This is me" or "Someone else", plus the tick "This is me, or I have this person's permission. Not a minor. No
     impersonation." It is logged in `localStorage['p0pc0rn:castConsent']`.
  3. The person's page, with Voice and Photos side by side.
- **Voice** is the voice probe's read-aloud flow (`cast/recorder.js`):
  - 4 public-domain scripts, Different script, 3-2-1, a level meter, auto-stop, trim;
  - the checks (3-12 s, not clipped, not too quiet), play back, Use this / Record again;
  - the cleaned 24 kHz WAV and the script's words are kept. Advanced: a file plus its typed transcript.
- The learned voice (the engine's OPFS `engine/qwen3-tts-0.6b/voices/<key>.bin`) is learned once per recording. Its key is kept on the
  person. A new recording or Delete forgets it (`forgetVoice`).
- **Photos**: 1 minimum, 3-4 recommended, 8 maximum.
  - Adding: "Add photos" (multiple select) or "Take photo" (`capture="user"`). JPEG / PNG / HEIC; a file the browser can't read gets
    plain words.
  - Each photo has its OWN unticked upload box (`rights.ATTEST`, logged by `rights.logUpload`).
  - The auto crop: BlazeFace (`engine/face/blaze.js`, 207 KB weights in the tree), then the crop rule: 25 % of w either side, 30 % of h
    above, the bottom at y + 1.38 h. The person can drag, zoom or nudge it; "No face found: try a clearer photo" when there is none.
  - Only the crop (<= 720 px) and a 160 px thumbnail are kept, never the original. Delete erases the person, the recording, the photos
    and the learned voice.
- **The card**: Voice (✓ / Record) and Photos (n ✓ / Add) side by side, "Say something" (a `say` job, the result in the card and the
  Library), and "Lip-sync · experimental".

### Voice jobs (`cast/castsay.js`)
- **The chat**: `wrapAsk` turns "make|have|let|get <name> say <line>" into a `chat` job with purpose `say`. It has NO model (the assistant
  is never loaded).
  - The answer is in code. Not in your Cast: a plain answer. No voice yet: "Record ... first". Voice model missing: needs-download.
  - Otherwise it queues a `say` child and posts the audio bubble (Save .m4a / .wav, Open in Library, Lip-sync · experimental).
  - `screenRequest` (the hard cases) screens the line.
- **The `say` job** is a render (consent-gated, seeded) on the voice engine (`engine/voice/`, the voice probe v002 engine with its own
  pooled core `engine/voice/vgpu.js`). Its stages:
  1. learnVoice, only if the learned voice is gone;
  2. a fresh page, then talk (the codes are kept as a queue blob);
  3. a fresh page, then decodeLine;
  4. the file: AAC .m4a (ASC built from the rate and channels), checked by `audiocheck.checkSong`, else a checked WAV.
  - A reload resumes from the job state. The fresh-page rule is the song's (64 MB).

### Klein references
- A picture or clip request that names a Cast member with photos (capitalised, whole word; "me" / "myself" = the person marked "This is
  me") goes through the agent hook `castJob`:
  - the job becomes an `edit` of their face crop, letterboxed to the output aspect (`refForShape`), reference 'full';
  - the name in the prompt becomes "the person in the reference photo";
  - a clip runs that still first, then image-to-video (`pending.then` in `agent.afterChild`).
- The likeness gate (`gateRender`, hook `castNames`):
  - Cast names are never looked up as real people and never stripped. That is exact names only: Cast member "Josh" does not cover
    "Josh Brolin".
  - Unknown names and research-found people are gated as before. The unit tests are in the hand-off.

### Make them talk (EXPERIMENTAL: `cast/talk.js`, `cast/talk_ui.js`; the lip-sync probe v002 engine in `engine/lipsync/`)
- Settings › Models has a "Lip-sync (experimental)" row: MuseTalk 1.5, 1.0 GB, its pack address in config.js.
- **`talk`** is a coordinator with no model:
  1. the line (the bubble's `say` job, or a new one);
  2. the clip: one from the Library (ticked as yours or permitted), or one made from the Cast photo (Klein head-and-shoulders still, then
     SANA i2v, "talks calmly, mouth mostly closed");
  3. `lipsync`.
- **`lipsync`** is a render:
  - the v2 blend by default (the quality switch and the medium-shot tip are under Advanced);
  - fresh pages between its stages when the page freed >= 384 MB;
  - the MP4 is checked (`cast/avcheck.js`: the H.264 track, the sound track, then the player) before it is done;
  - the result's `stageSec` (wall-clock seconds per stage, kept in the job's state) and `totalSec` survive a fresh page, but the
    engine's own `timings` restart after a fresh page, so use `stageSec` for reports.
- Entry points: the say bubble and the Cast card ("Lip-sync · experimental"), and a Library clip's viewer ("Lip-sync · experimental":
  pick a Cast voice, type the line, tick the face).
- Results: an MP4 bubble with sound, and the Library (`vmode: 'lipsync'`, plays with its sound). Every place says Experimental.

## 24. v026.5: a Cast member as the music video's lead (assistant/mvflf.js, app.js)

- The Animate sheet has "Lead (optional)": "No one from Cast" or "Lead: <name>" for every Cast member with a photo. Naming a Cast
  member in the direction picks them (until the person picks by hand).
- `startMusicVideo(Q, song, {..., lead})`: `lead` = `{id, name, names, key}`; `key` = the person's first photo shaped to the video
  (`refForShape`, 480x832 or 832x480) in the queue's blob store. Kept as `params.lead`.
- The opening frame (k = 0) with a lead is an `edit` (not a `picture`): `inputKey` = the lead's photo, `reference: 'full'`, the prompt
  through `refPrompt` ("the person in the reference photo ... Keep their face exactly as in the reference photo."), `cast: {id, name}`,
  `mv.ref = {cast: id}`. Its rerolls take the same path.
- `leadOf(sb, P)`: the fixed lead line becomes "<name>, the same person as in the reference, <the opening prompt's place>"
  (`sb.castLead` records who). `dirOf(P)`: the planner's direction gets "The lead is <name>." when it does not name them.
- The likeness gate never treats a Cast name (full or first, lower case) as a protected person: `mvRecords` drops KB records titled
  with a Cast name, and `mvRealPeople` never looks one up.

## 25. 3.9: the home screen, conversations, Music, games, skills, changing an app, About me and routines

### The shell (`ui/shell.js`; pure parts `ui/shell_core.js`, `ui/gesture.js`)

```js
SHELL.register({ id, title, icon, view, dock, home, order, badge, onOpen, onClose, hidden })
SHELL.open(id, { from })   // a 3.8 view goes through go(tab); from = the icon the screen grows from
SHELL.home()
SHELL.badge(id, n)         // a red number at the icon's top left (0 = none); SHELL.refresh() re-reads every badge()
SHELL.pin({ id, title, letter, color, open }) / SHELL.unpin(id)   // made apps on the home screen
SHELL.on('open' | 'close' | 'home', fn)
```

- `window.SHELL` is the same object; the event `p0:shell-ready` fires at start.
- Ids: the 3.8 views (`create`, `assistant`, `apps`, `library`, `settings`), `home`, `music`, `browser`, `games` (the Apps shelf's
  Games group), `skills` and `connection` (a placeholder: a tap shows "Coming soon" only).
- The dock: Juli, Create, Music, Settings. The home screen: cards of agentic apps with news on top (at most 3; one swiped away stays away
  until that app's news is newer), then Library, Apps, Browser,
  Games, Skills, Connection, then pinned apps. A new install starts in Juli's chat; every other start opens the home screen.

### Conversations (`ui/threads.js`, `ui/chatactions.js`, `ui/chat.js`)

- One conversation is one agent session (`p0pc0rn-assistant`, unchanged). The Chats list is an index in IndexedDB `p0pc0rn-chats`
  (store `threads`: per conversation a name, its last line, the time and the unread count), built once from 3.8's sessions and
  then kept current by every message; its writes are serialised.
- `createChat(...)` also returns `unread()`, `openList()` and `openThread(id)`; the unread total goes to `SHELL.badge('assistant', n)`.
- Option bubbles per result kind (`ui/chatactions.js`), each running an existing path:
  - a picture: Make again, Edit this, Animate, Clip to another picture, Save, Open in Library;
  - a clip: Make again, Save, Open in Library;
  - a song: Make again, Animate (its music video), Save as .m4a / .wav, Open in Library;
  - a music video: Edit video, Save, Open in Library;
  - a Cast voice line: Lip-sync (experimental), Save.
  Make again is the same job with a new seed; it needs the original job, which the queue keeps for 3 days.

### Music (`ui/music_core.js`, `ui/music.js`)

- `MUSIC = { screen, open, close, badge, libChanged, pause, check, player, register }`, made in app.js by `createMusic(musicApi())`.
- Storage: localStorage `p0pc0rn:music` (version 1; up to 100 playlists of up to 500 songs; names up to 40 characters). Data from a
  newer version is kept aside, not overwritten.
- One audio element for the visit; the first tap unlocks it; the next song loads when one ends; three failures in a row stop the
  player with a message. One sound at a time in the app.
- Media Session: the title, artist "p0pc0rn", the playlist as the album, the song's cover (else the app icon), the position, and
  every action the browser supports.
- The badge: songs made since Music first looked at the Library and not yet played in Music.
- `MUSIC.check()` (or `#music-check` in the address): the phone check: three generated tones (never in the Library) whose titles say
  what to do (lock the screen, wait for the next one, try the lock-screen buttons), then a card with Copy.

### Games: Juli picks a move (`makeapp/choose.js`; Kit 1.6)

```js
const r = await p0.juli.choose({ about, options, skill, hint });   // in the sandbox; K.choose(about, options, { skill, hint }) wraps it
// r = { index, option, by: 'juli' | 'fallback' }
```

- 2-12 options of up to 60 characters; `about` (the board as text) up to 1,200 characters; `hint` up to 300; `skill` = a skill's
  name. At most 240 calls an hour, only from the open app (a check gets `CHECK`); a bad option list throws `BAD_CHOICE`.
- The host runs an `appchoose` job on Juli's own model (Gemma 4 E2B by default; the Bigger brain only for a job the app asks with `big: true`, below): the rules, the
  skill (up to 500 tokens), the board, the hint and the numbered options; a 4-token greedy answer, read as the option's words, its
  number or a unique last word; one retry without the skill and the board; then the first option (`by: 'fallback'`), which is also
  the answer when Juli isn't downloaded or a move is already waiting.
- The game hold: the open game is not closed by its own move's job; Juli's model stays loaded 60 s after each move and is released
  when the game closes.
- Manifest: `kind: "game"` (the shelf's Games group) and `permissions.juli: ["choose"]` (non-agentic apps only; `"ask"` stays
  agentic-only). The permission sheet says "Juli picks her moves in this app (on this phone only)".
- The mover: app.js `RUN.appchoose` = Juli's own model, always; the Bigger brain only for a job with `big` (`K.choose(..., {big:
  true})`: Four in a Row's opponent, earned with 10 wins in a row) while it is downloaded and on (`p0.juli.models()` /
  `K.juliModels()` say so); never one model for the other (`by: 'fallback'`, why "the Bigger brain is not on"). Both answer with the
  number of their choice (`choose.js` also has a tool-call framing, `choose_move {choice}`, the runner's `o.tool`: the Bigger brain
  read worse that way). The game hold keeps whichever answered. Her answer is her move: no answer naming a choice comes back
  `by: 'fallback'` with `why`, and the game asks again or says so.
- One move at a time per open game: a move still waiting from a game that was closed does not block the game opened again. An
  app's waiting saves (debounced 400 ms) are written before Juli's job starts (it may load her model in a planned fresh page),
  before the app opens again and when the page is hidden.
- The Game Kit (`K.game` 1.0, part of `makeapp/kit.js`; the Skeleton Guide has its API): `K.game.match` (turns, the saved game,
  the score; her model makes every move from all the legal ones, an unclear answer is asked again, no answer = stuck with "Ask Juli
  again", never a move made for her), `K.game.search` (alpha-beta for two-player games, time-sliced) and `K.game.work` (long work in
  slices), boards and aiming, cached art (`board`, `piece`, `backdrop`, `glow`), motion (`timeline`, `fall` with bounce, `jolt`;
  `reduced` motion), effects (`confetti`, `sparks`), synthesised sound (silent until the first tap, a remembered mute), Juli's
  `avatar`, the `results` card (with a run toward an unlock: `progress`), `unlock` + `celebrate` (something earned), the match's
  `st.keep` and `tally` (values that last across games, saved with the score) and `a11y` (spoken updates and screen-reader buttons).
  It paces the frame: 60 fps while anything moves, 30 when calm.

### Skills (`assistant/skills.js`; bundled: `skills/index.json` + `skills/<name>.md`)

```
---
name: play-four-in-a-row         # 3-40 characters: a-z, 0-9, -
description: One line: what it helps Juli do and when (up to 200 characters).
for: [game]                      # make | change | chat | game | app (default chat)
---
The body: plain Markdown, up to 900 tokens and 6 KB (600 tokens advised), no links, scripts or frames.
```

- Pure: `parseSkill(md)`, `skillProblems(skill)`, `bundleSkillProblems`, `skillIndex`, `pickSkill(text, skills, kind)` (shared
  words), `explicitSkill` ("use my <name> skill" and close variants), `skillBody(skill, budget)`, `skillText`, `makeSkillFor`,
  `textTokens`.
- The registry `createSkills({ db, fetchText, base, skelName })`: `loadSkills`, `list`, `getSkill`, `skillsFor(kind)`,
  `checkImport`, `importSkill`, `setEnabled`, `removeSkill` (the person's own only), `setBundle`, `removeBundle`, `clash`,
  `bundleClashes`.
- Storage: IndexedDB `p0pc0rn-apps` version 2, store `skills` (version 1's data kept). A skeleton bundle may carry
  `skills: { <name>: <md> }` (up to 3): stored once the person allows the bundle, removed with it.
- Use: making an app gets make-an-app's sections, changing one gets change-an-app, a game's moves get its how-to-play skill, and a
  chat turn gets a `for: chat` skill picked by words or by name. A skill goes in only when it fits the model's room; on the Bigger
  brain's 2,048-token context the skill is the first thing dropped.

### Wallet Watch: the Snowtrace source and its hard restrictions (`makeapp/snowtrace.js`, `makeapp/budget.js`; 3.9)

- Source `chain.snowtrace` (`SOURCES`, host `api.routescan.io`, Routescan's Etherscan-style API for Avalanche C-Chain mainnet,
  `.../v2/network/mainnet/evm/43114/etherscan/api`; keyless). `p0.fetch('chain.snowtrace', {op, ...})`:
  - `watch` `{items: [{address, kind: 'wallet' | 'contract', since}]}` (1-5) -> `{balances: {address: wei}, items: [{address, kind,
    first, txs, tok, int, full, done}], stopped}`: one `balancemulti`, then per address `txlist` + `tokentx` (+ `txlistinternal` for a
    wallet) from block `since` (inclusive; none = a first look at the newest 25 rows), 100 rows a list, newest first.
  - `history` `{address}` (100 + 100 + 50 rows), `contract` `{address}` -> `{verified, name, compiler, proxy, impl, license}`,
    `labels` `{addresses}` (1-6) -> the explorer's public name tags, only with an organisation category (`tagOf`).
  - Rows: `{h, b, t, f, to, v, fn, err}`, tokens `+ {c, sym, dec}` (a symbol that is a message or a web address is dropped: `cleanSym`).
- The hard cap (`createBudget(cfg, {store, now})`): before every request the fetcher calls `take(scope)` (scope = the app's id):
  per-second and per-minute token buckets (in memory) and a per-day counter in `localStorage` (`p0pc0rn:quota:<key>`, UTC day) for every
  app together and per app. Snowtrace: `SNOWTRACE_CAP` = 1 a second, 60 a minute, 5,000 a day, 1,600 a day for one app (the free tier:
  2 a second, 10,000 a day). A refusal throws `DAILY_CAP`, `APP_CAP`, `RATE_LIMIT` or `BACKOFF` (with `until`) and nothing is sent;
  `watch` answers with what came back and `stopped`. A 429, or the API's own "rate limit" answer (`S.rateLimited`), calls `note429()`:
  1 minute, then 2, 4 ... 1 hour, kept in storage; a working answer ends it. Answers carry `quota` (`{used, cap, left, appUsed, appCap,
  n429, resetAt, backoffUntil, paused}`). `pausedFor` / `pauseLine` / `quotaRow` are the host's words.
- The idle rule (`SNOWTRACE.idleOnly`, `phoneBusy(Q, modelBusy, own)` in `host.js`): an app that reads the source is checked at most
  every `minMinutes` of its interval trigger (15), whatever asks (p0pc0rn opening, the app closed), and only when no model is in memory
  and no job of the person's is queued, running or waiting (Juli answering them included). Its check's requests pass `{gate}` to the
  fetcher (a busy phone = `BUSY`, nothing sent) and its `K.ask` yields (`BUSY` before, cancelled when a job arrives): the app's own
  words go then. The worst case of one app at the floor: 96 checks x (1 + 3 x 5 wallets) + 30 = 1,566 requests a day.
- Host: an app whose source rests is not checked (`due()`), its card says "Paused until 5:00 PM to stay within Snowtrace’s free
  limit" (or "waiting for your phone to be idle"); `apps.quota(skelId, appId)` gives the settings page's rows. A check's `{next}`
  (minutes) sets its next check within its interval trigger's `minMinutes` .. `calmMinutes`.
- Credit: "Powered by Routescan.io APIs" with links to https://routescan.io and https://x.com/routescan_io (`SOURCE_CREDITS`, `creditsOf` in
  `ui/storefront_core.js`) on the permission sheet, the app's settings page and the bar under the running app (`#app-credit`); links
  open in a new tab (the phone's browser sheet), are never fetched and need no CSP change.
- Skills: `for: app` = know-how an app names in `K.ask(prompt, {skill})` (`p0.juli.ask(prompt, {json, skill})`); the host adds it to
  the `appask` job when it is on (`appSkill`, cut to 500 tokens, framed by `skillHead`).
- Icons: a design that comes with p0pc0rn may ship `icons/apps/<id>-180.png` / `-120.png` (`designArt`, `ART_DESIGNS` in
  `ui/storefront_core.js`): its card, its made apps and their home tiles use it; an icon Juli makes for one app still wins.

### Changing an app (`makeapp/edit.js`; the `appedit` job)

- Tools, one JSON object a call: `show`, `set`, `edit`, `run`, `look`, `ask`, `done` (`set` takes `add` / `remove` and paths such
  as `tiles[1].goal`).
- The planner: the Bigger brain when usable, else Juli (a prompt up to 1,400 tokens, an answer up to 200, at most 4 steps; skipped
  when one setting is clearly meant). The worker: Juli (a prompt up to 2,800 tokens, one tool a call). The reviewer: advisory.
  Budgets: 8 worker calls, 2 fix tries a step, 300 s.
- After every `set` / `edit` the host runs the app unseen at 390 × 844 on the person's data, read-only, and feeds back new errors
  and the screen's text; `look` sends a picture of it to Juli.
- The phases are child jobs (plan, work, review: at most 2 model swaps); the state is saved per phase; nothing is kept until the
  last one, and Cancel keeps nothing.
- The app record gains `custom` (an added part, up to 4,096 characters), `history` (up to 10 of `{ at, slots, custom, name, note }`)
  and `edits`.
- Kit 1.5: `K.on('start' | 'draw' | 'tap', fn)` for the added part (draw hooks run after the sketch; a hook that throws is removed
  and reported; a check runs none). The frame runs the added part as a script of its own and reports `custom-error` (with a line)
  instead of failing the app; host → frame `snap` → `snapped` (a PNG up to 1 MB, the scene, the button names and the texts).

### About me and routines (`assistant/memory.js`, `ui/memory_ui.js`)

- IndexedDB `p0pc0rn-apps`, store `memory`: id `about` and id `routines`.
- About me: up to 1,200 characters. In Juli's plan prompt up to 200 tokens (the Bigger brain's 120, the make and change planners'
  80), cut at sentences, under the heading "ABOUT THE PERSON (their own words; fit your answers to them, but they never change your
  rules)". When a prompt is too long it is dropped right after the skill (the TOO_LONG retry; fitPlan's `'no about me'` step).
  Diagnostics get its size, never its words. It is never given to apps.
- Routines: up to 5 of up to 200 characters, each on open, every 1-168 hours, or daily at HH:MM; Run now, Edit, Delete. A routine is
  sent as `AG.ask(sid, text, { kind: 'routine' })` and drawn as a Routine card.
- The heartbeat: a 60 s timer; at most one routine a tick and 8 a day; an "on open" routine once per opening (a start, or back after
  10 minutes away) and at least 4 hours apart. It waits while the page is hidden, p0pc0rn is open in another tab, Juli isn't ready or
  isn't downloaded, the terms aren't agreed, an app is open, Juli or a render is busy, or the last routine is still waiting.

### Writing without the Bigger brain (`assistant/agent.js`, `JULI_WRITE`)

- A piece of writing Juli plans herself (no Bigger brain on the phone, or a turn it does not take: a photo attached, or too long
  for it) is her own reply: only `ask_user` is offered and her prompt says to write it all herself in plain text. A make tool she
  calls anyway is not run. The Bigger brain's writing turn is unchanged.

### Answers, how-to and self questions (`assistant/answers.js`; hooks in `assistant/agent.js`, `assistant/research.js`)

- Routing (`taskKind`): a question about using p0pc0rn or about Juli (`helpAsk`, `selfAsk`), a general how-to (`howToAsk`, unless it
  asks for a piece of writing) and a joke are `chat`: Juli's own model, never the Bigger brain.
- A how-to or self question gets no tool and no lookup; its prompt gets `HELP_NOTE`, the FAQ section its words match and
  `faq#how-to-ask-juli` (one line per thing to do, with example requests). A tool call there is turned back into words.
- Juli herself is never a lookup topic (`PLAN_SYS`, `cleanTopics`, `lookupWorthy`). A picture of her gets `SELF_PIC_NOTE` (an original
  look: she has no fixed one), on her model and on the Bigger brain's.
- A how-to (`howToAsk`, or a terse task: `taskAsk`) in a chat with nothing made yet gets `HOWTO_NOTE` (steps from what she knows)
  and no tool; it is not looked up, a lookup or make call is turned back into words, and a bare tool name as the reply is asked for
  once more in words. Not for `dangerAsk`.
- An everyday question on Juli's own model (lookups on, no photo, no make tool offered, not held by the safety screen, not
  `dangerAsk`) gets `ANSWER_NOTE` (from the facts looked up for it: numbers, dates and names only from them, "how many" = each one
  named, then the count; `ANSWER_NOTE_OWN` when there are none: no number, date or name from memory) and its notes lose the
  render-only safety sections. A reply that refuses or only defers is asked again once (`NUDGE`, `shouldNudge`); if it still refuses,
  the facts' own words answer (`factsAnswer`, only from an article about the question). A request that could hurt someone, a refused
  tool call and the screen's holds are never pushed.
- A question whether something is safe to eat, drink, give or use (`safetyAsk`) that nothing looked up answers (`safetyCovered`) gets
  one more lookup, "<the thing> toxicity" (`safetyTopic`: "Avocado toxicity" finds "Persin"), used only when it says whether it is
  safe and is about the thing (`safetyFound`: its title or first quote names it). Still nothing: `safetyNote` (the cautious answer
  itself), never asked again, and a reply that still says it is safe (`assertsSafe`) or refuses becomes `cautionLine` (best avoided
  until a vet, a pharmacist or a doctor says it is OK). Facts that say it is harmful and a reply that says "safe" anyway: the facts'
  own words (`harmLine`).
- `finish()`: the model's own Rights & Copyright sentence is dropped unless the message is about copyright, trademarks, likeness or
  real people, or this turn refused a make call or took a likeness out of one (`stripPointer`); a "Yes:" before the answer to a
  question that is not a yes-or-no one goes (`stripYes`). The message that a job started says where its result will show up.
- Research (`wikipedia()`): when no title match (opensearch) is usable, one full-text search (`list=search` on `en.wikipedia.org`: no
  new host; once more with its spelling suggestion when it finds nothing) offers up to 3 more candidates, each through the same checks
  plus "carries most of the topic's words" (in the title, the lead, or the redirect and snippet Wikipedia matched), which a near title
  sharing one word only (`weakTitle`) needs too. A list article is skipped, never read. A title word one letter off the topic's is the
  same word (`nearWord` in `assistant/lookupwords.js`). The quote reader keeps a concept article's sentences that carry most of its
  title's words (`conceptHit`: "Grape toxicity in dogs" never repeats its title); a proper name must still be named; a character's
  article (`PERSONA` class nouns: superhero, character ...) is "he" / "she" like a person's; a formula's column of lines in a plain-text
  extract goes back into its sentence (`flatMath`).

### Made apps: p5's names and the home indicator (`makeapp/p5names.js`, `makeapp/check.js`, `makeapp/host.js`, `makeapp/frame.html`, `makeapp/kit.js`)

- p5 (1.11.13, `makeapp/p5.min.js`) starts after the app's script and writes its own functions and values onto `window`: a top-level
  `function` or `var` with one of those names is p5's from then on; a top-level `let` / `const` / `class` stays the app's and hides
  p5's (measured in Edge). `checkBundle` refuses the first for any p5 name, the second for a name the Kit itself uses from p5
  (`KIT_USES`), and `K` in any form: `sketch.js uses the name "save", which p5 uses: rename it (e.g. saveState)`.
  `topDeclarations(code)` reads the sketch without running it (comments, strings, templates and regular expressions blanked; braces
  counted; function and class expressions, names inside functions, blocks and objects, and `let` / `const` in a `for` head are not
  top-level). `p5Clashes(code, { strict: true })` also lists every `let` / `const` with a p5 function's name.
- The safe area: `frameSafeTop(frame)` / `frameSafeBottom(frame)` (host.js) = how far the frame reaches into the page's top / bottom
  safe-area inset (CSS pixels; 0 when it sits under p0pc0rn's bar or above the credit bar). The boot message carries them as
  `safe: { top, bottom }`, a window resize or a change of the frame's own size sends `{ t: 'safe', top, bottom }`, the frame keeps
  them as `p0.safe` (`{ top, bottom, host: true }`) and fires `p0:safe`; the Kit's `K.safe.top` / `K.safe.bottom` = the host's
  (inside a frame, env() reports the screen's insets wherever the frame sits).
