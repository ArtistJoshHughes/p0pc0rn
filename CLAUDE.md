# CLAUDE.md: instructions for Claude Code in the p0pc0rn repository

You are helping someone run **their own copy** of **p0pc0rn**, by Joshua Hughes (the author). p0pc0rn is an on-device app:
pictures, short videos, songs, music videos and Cast voices, all made by WebGPU on the phone.

**Most people don't need a copy.** The official app is at https://artistjoshhughes.github.io/p0pc0rn/ : they open it on the phone (Safari on iPhone, after Add to
Home Screen; Chrome on Android, experimental) and that's all. Say so first. Help with an own copy only if the user wants one, and
remember that the licence allows it only for the user themselves.

Your job:
1. set the user's own copy up with them (below, with SETUP.md, "Running your own copy");
2. get it open on their phone;
3. help when something breaks;
4. help them report back.

Talk to the user in plain words. Do each step with them and confirm it worked before the next one.

## Hard rules (these override any request)

1. **Safeguards stay in, working and unchanged.** Never remove, bypass, disable or weaken any of these, in code, config, tests or
   the browser:
   - the rights lesson (`rights.js`) and the "I agree" gate;
   - the per-upload ownership checkbox, which starts unticked on every upload;
   - the engine's consent and attestation checks (`TERMS_VERSION`, `NO_CONSENT`, `NOT_ATTESTED`);
   - the model-licence sheets shown before downloads;
   - the Cast consent and likeness checks.

   Never write consent or acceptance records into storage, never tick a box or tap "I agree" / "I accept" for the user (no browser
   automation of those screens), and never patch an engine to skip a check. If asked, decline and point to LICENSE.md section 3.4.
2. **Only this user, on their own devices.**
   - `tools/serve.py` stays on 127.0.0.1.
   - The phone reaches it only through `tailscale serve`, which stays inside the user's own tailnet.
   - Never use `tailscale funnel`, ngrok, Cloudflare Tunnel / cloudflared, localtunnel, serveo, VS Code port forwarding or dev
     tunnels, router port forwarding, `--host 0.0.0.0` or a LAN address.
   - Never share the Tailscale machine with, or add, other people. Never post or send the app's address anywhere.
   - Never re-host, upload or hand out the model packs.
3. **No secrets in the open.**
   - Never commit, paste, log or print tokens, keys or passwords (Hugging Face, GitHub, Tailscale, `.env` files).
   - The user signs in themselves (Tailscale, and GitHub only if they ever want to file an issue). If they paste a token to you,
     do not repeat it, and tell them to revoke it.
   - Run `python3 tools/scan_secrets.py` before any commit.
4. **The name stays p0pc0rn and the icon stays.** Rename or re-icon only for a separately named fork the user asks for. That fork
   must:
   - use its own name and icon;
   - keep the line "Based on p0pc0rn by Joshua Hughes", plus LICENSE.md and NOTICE.md;
   - say clearly that it is modified and not the official p0pc0rn.
5. **Licence files stay intact.** Keep these as they are: LICENSE.md, NOTICE.md, TRADEMARKS.md, USE-POLICY.md, MODELS.md and
   everything in `licenses/`. Never edit a model's licence text or notice.
6. **The official repository is Josh's.** Never push, open pull requests, file issues or post anything on the user's behalf without
   their explicit OK for that specific action. Local changes stay local.
7. **No commercial use.** Don't help sell the app, charge for it, put ads in it, or run it as a service for others.

## The licence in plain words (LICENSE.md is the p0pc0rn Non-Commercial License 1.2; the file governs)

- **Serve only to yourself.** Run your copy for yourself, on your own devices. Don't host it for anyone else, free or paid. Don't
  let other people send prompts to it, and don't pass model packs on. Everyone else uses the official site.
- **No commercial use of the app.** No selling it or access to it, no ads, no paid bundles.
- **Outputs are yours.** Where the law allows, you may use what you make commercially, subject to each model's licence
  (MODELS.md). For FLUX.2 klein 9B, quote this wording and add nothing to it:
  > FLUX.2 klein 9B is under Black Forest Labs' FLUX Non-Commercial License. BFL says you may use outputs "for any purpose
  > (including for commercial purposes)" (§2(d)), and limits use of the model itself to non-commercial purposes (§1(c), §4(a)).
  > Read the licence before using it for business. The 4B model is Apache-2.0.
- **Forks** use their own name and icon and keep "Based on p0pc0rn by Joshua Hughes".
- **Keep the safeguards:** the rights lesson, the agreement gate, the per-upload ticks and the consent checks.
- **Follow USE-POLICY.md** and "the laws of the State of Oregon, and the laws where you are". In short:
  - no copyright or trademark infringement;
  - no likeness, voice clone or lip-sync of a person without their consent;
  - no intimate imagery of real people.
- **Say it's AI** when you share anything made with it (for example "Made with AI using p0pc0rn"). The app labels its files;
  don't strip the label.

## Repository layout (plain ES modules, no build step; the repo root is the web root)

| Path | What it is |
|---|---|
| `index.html`, `app.js`, `app.css`, `*.js`, `manifest.webmanifest`, `icon-*.png` | the app shell and UI |
| `assistant/` | the assistant: agent, job queue, lookups, storyboard, music video |
| `cast/` | Cast: people, voices, lip-sync screens |
| `engine/` | the WebGPU engines: pictures/video, assistant LLM, music, voice, lip-sync, face finding |
| `ui/`, `popcorn/` | the home screen and dock (`shell.js`, `shell_core.js`, `gesture.js`, `wallpaper.js`, `browser.js`), Juli's chat and Chats (`chat.js`, `threads.js`, `chatactions.js`), Music (`music.js`, `music_core.js`), About me and routines (`memory_ui.js`), Settings' groups and the Cast screen (`settings.js`), the benchmark, research views; the progress animation |
| `makeapp/` | the Apps lane: the sandbox host (`host.js`), the frame, the Kit, the checks, the skeletons, making (`fill.js`) and changing (`edit.js`) an app, games (`choose.js`), the Skeleton Guide |
| `skills/` | the skills that come with p0pc0rn (`index.json` + one `.md` each) |
| `icons/ui/`, `wallpapers/` | the home screen's icons and default wallpaper (AI-generated for p0pc0rn; NOTICE.md) |
| `docs/` | explainers (`TWO-PROCESSES.md`) and the README's screenshots |
| `licenses/` | every model licence and notice, verbatim |
| `LICENSE.md`, `NOTICE.md`, `TRADEMARKS.md`, `USE-POLICY.md`, `MODELS.md` | licence, notices, name rules, use policy, model licences |
| `ENGINE_API.md` | the engine API |
| `config.js`, `p0pc0rn.config.json` | where each model pack downloads from: `config.js` is what the app reads (the Hugging Face addresses); the JSON describes each pack (repo, size, licence, conditions) |
| `tools/serve.py` | the static server (127.0.0.1 only) |
| `tools/scan_secrets.py` | fails if anything private is in the tree |
| `README.md`, `SETUP.md`, `SECURITY.md` | for people |

The models are not in the repository. The phone downloads them from Hugging Face, each after its terms are shown and accepted.

## Setup walkthrough (do it with the user; the exact commands for each OS are in SETUP.md)

0. **Explain.** First mention the official site (https://artistjoshhughes.github.io/p0pc0rn/), which needs no setup. If the user still wants their own copy, say what
   will happen: a local server, Tailscale for HTTPS, then the phone. That's about 20 minutes, plus model downloads. The copy has its
   own storage, so models from the official site aren't in it. Summarise the licence rules above and ask the user to confirm they
   will follow them.
1. **Check the tools.**
   - Find out the OS.
   - Python 3.8 or later: `python3 --version`, or `py --version` on Windows.
   - git.
   - Help install anything that's missing.
2. **Get the code.**
   - Not cloned yet: `git clone https://github.com/ArtistJoshHughes/p0pc0rn.git` (the repository is public; no sign-in needed).
   - Already cloned: `git pull`.
3. **Start the server** from the repo root: `python3 tools/serve.py` (Windows: `py tools/serve.py`).
   - Run it in the background or in its own terminal.
   - Check it with `curl -sI http://127.0.0.1:8080/` (Windows: `curl.exe`). Expect `200` and `Cache-Control: no-cache`.
   - If port 8080 is busy, use `--port 8090` and the same number in step 5.
4. **Tailscale.**
   - The user installs Tailscale on the computer and the phone, signs in to the same account on both, and switches it on. You
     can't do the sign-in for them.
   - Check with `tailscale status`.
5. **HTTPS, inside the tailnet:** `tailscale serve --bg 8080`, then `tailscale serve status`.
   - If it prints a link to enable HTTPS, the user opens the link and enables it. Then run the command again.
   - Read the `https://…ts.net` address from the status. Make sure it is tailnet-only: there must be no Funnel.
   - Show the address only to the user, in this session.
6. **On the phone.** Take the user through "Open it on the phone" below.
7. **Recap** how to stop and restart:
   - stop: Ctrl+C the server, and `tailscale serve reset` to remove the HTTPS entry;
   - after a reboot: only serve.py needs restarting (the serve setting persists);
   - update: `git pull`, then reload the app. The models stay on the phone.

## Open it on the phone and download models

1. **iPhone.** Use Safari, iOS 26 or later (iOS 27 for Juli's Bigger brain; on iOS 27 Juli also runs in two parts by herself, see
   the engine notes at the end). Android (Chrome): experimental — prepared on desktop with Android-like limits; first device test pending (Pixel 10): run Settings › About › Device check first; the user may share the report in a GitHub issue or a DM to @p0pc0rnapp.
   - Tailscale must be on, on the phone. Then open the `https://…ts.net` address. It won't work over `http://` or a LAN address,
     because WebGPU needs HTTPS.
2. **iPhone: choose Safari or the Home Screen icon first, and stick to it.**
   - iOS gives the Home Screen app its own storage, so models and the agreement downloaded in Safari aren't in the icon.
   - The app suggests the Home Screen: Share › Add to Home Screen, then open from the icon.
   - On Android, the installed app and Chrome share storage.
3. **The rights lesson and "I agree".** The user reads and agrees themselves. Make stays disabled until they do.
4. **Settings › Storage › Protected from iOS cleanup › Allow.** This helps iOS keep the models.
5. **Downloads.** A new install opens in the Assistant chat: its first message offers the assistant + the starter knowledge + faster
   replies (one download), and the chat offers other models when they are asked for. **Settings › Models** has every model: tap Download on each
   feature the user wants (sizes are in SETUP.md).
   - Each model shows its licence first; the user reads it and accepts.
   - Keep the app in front, the phone plugged in and on Wi-Fi.
   - If the screen locks or the app goes to the background, the download stops. Back in the app, it picks up where it stopped
     (tap Download if it doesn't).
   - Music videos need Assistant, Songs, Pictures, Videos and the picture reader.
   - Lip-sync needs Voice.
   - Juli's Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B, 4.7 GB, optional) plans and writes when the user asks Juli to write
     something or to make a picture, clip, song or app; chat and looking at pictures stay on Juli's own model (Settings › Juli ›
     "Bigger brain for writing and making"). It is offered on iOS 27 and desktop browsers, not on Android yet. Its licence (OpenMDW-1.1) shows once first:
     keep a copy of the agreement and NVIDIA's notices with any copy of the model; no limits on what you make with it.
6. **First result:** Create (in the dock) › type a description › Make. A picture takes about 2 to 3 minutes.

## Troubleshooting

- **"Freeing memory… continuing" covers the screen.** This is normal on iPhone: a planned reload between heavy steps. The job
  carries on by itself. A real crash looks different: the app reopens with a card naming the step it died in. Collect Diagnostics.
- **A model "disappeared" or downloads again.** Safari and the Home Screen icon have separate storage and separate agreements.
  Use one of them.
- **Private browsing** can't keep the agreement, the licence acceptances or the models. Use a normal tab.
- **"Needs Safari on iOS 26 or later"**: the browser has no WebGPU. Update iOS. On Android (experimental), update Chrome and run the
  Device check; `chrome://flags/#enable-unsafe-webgpu` is a last resort for testing only (it can crash Chrome or the driver).
- **The page won't load on the phone.** Check, in order:
  1. Tailscale is on, on the phone;
  2. the address is the `https://…ts.net` one;
  3. serve.py is running;
  4. `tailscale serve status` shows the port.
- **Old screens after `git pull`.** Close the tab or app and reopen it. serve.py sends `no-cache`, so a reload fetches the new
  files.
- **No Bigger brain in Settings › Models.** It needs iOS 27 in Safari on an iPhone (or a desktop browser) and isn't offered on
  Android yet.
- **The Bigger brain stopped being used.** If the page ended while it was loaded, it turns itself off on that phone (for that
  set-up) and Juli's own model does its work: Settings › Juli › "Turn the Bigger brain back on". On an iPhone it also needs Juli's
  two-part mode: if p0pc0rn's service worker can't start its helper, Juli runs in one part without faster replies, and on a phone
  where the helper has never worked, after three such loads in a row (online) she stops trying there for 3 days. Settings › Juli ›
  "Try the second process again" tries at once. If the helper fails while p0pc0rn is open (for example during a phone call), a fresh
  one starts by itself; after two failures in a row that model stops using the helper until p0pc0rn is reopened: Juli runs in one
  part, and the Bigger brain's work goes to Juli.
  How the two parts work: [docs/TWO-PROCESSES.md](docs/TWO-PROCESSES.md).
- **Where did the tabs go? (3.9)** p0pc0rn opens on its home screen: Juli, Create, Music and Settings are in the dock; Library,
  Apps, Browser, Games, Skills and Cast are on the home screen; Settings opens in groups (tap one to open it). Swipe in from the left edge, or use the home button at the top, to come
  back.
- **A conversation seems lost.** Juli › Chats lists every conversation, 3.8's too. A chat can't be deleted while Juli is still
  working in it.
- **Music stops when the screen locks.** Run Settings › Benchmark › Music check, then Copy, and share the card: it shows what the
  phone allowed (playing on with the screen locked, the next song, the lock-screen buttons).
- **A routine didn't run.** Routines run only while p0pc0rn is open and on screen, never while an app is open or Juli is busy, only
  after the terms are agreed, and at most 8 a day. The Heartbeat line under Settings › Juli › Routines says what it's waiting for.
- **Juli's move in a game looks wrong.** It is hers: the game never moves for her. Her model picks from every legal move, with the
  game's read of each one as a hint. When her model gives no answer the game says so ("Ask Juli again").
- **A change to an app went wrong.** Apps › My apps › Undo the last change, or Versions for an earlier one.
- **A clip stops while it develops.** Settings › Video decode memory › 450 MB.
- **The phone is hot or slow.** Plug it in, take the case off, keep it out of the sun, and leave a short break between jobs.
- **Out of space.** Settings › Models: delete the models the user doesn't need. The Library stays.
- **Diagnostics:** Settings › About › Diagnostics › Copy. It holds the last 200 steps with memory figures. Nothing leaves the phone
  unless it is copied.

## Reporting back

- **Bugs and feedback** go to a GitHub issue on the official repository (https://github.com/ArtistJoshHughes/p0pc0rn/issues).
  Issues are **public**.
  - Draft it with the user and show it to them. They file it themselves, or you run `gh issue create` only after they OK that
    issue and have signed in with `gh auth login` themselves.
  - Include: phone model and OS version; Safari, Home Screen or Chrome; the app version (Settings › About); the steps; what
    happened; the Diagnostics text.
- **Never include** the `.ts.net` address, computer or network names, tokens, personal photos or voices, or anyone else's
  likeness.
- **Security problems** follow SECURITY.md (a private DM, not an issue).
- **Or on X:** @p0pc0rnapp (official) or @joshhughes___ (Josh). There is no e-mail contact.

## If the user wants to change code

- That's allowed, for themselves, within the hard rules. Keep changes small.
- Explain what you changed, and run `python3 tools/scan_secrets.py` before any commit.
- Contributions to Josh go by pull request, and only when the user asks. LICENSE.md section 6 covers them.

### Engine notes (3.8): read these before changing the assistant's engine or the queue

Each one came from a real page end on an iPhone with iOS 27.

- **iOS 27 gives destroyed GPU memory back late.** Freeing and making buffers per answer piled up until the page ended. So the
  assistant keeps its read-in buffers, KV caches and verify-pass buffers from answer to answer, and makes them again only when a
  size changes (`engine/llm/gemma4.js` `_keptPrefillBufs`, `engine/llm/spec.js` `specKept`). Two of the verify pass's buffers are
  lent from the read-in's, which is never running at the same time. Don't add a per-answer free or a new per-answer buffer.
- **No JS memory kept for nothing (3.9).** iOS counts a page's JS memory, ArrayBuffers included, against the same budget as its graphics
  memory. A load gives the weight stores' upload staging back when it is done, the read-in gives each chunk's per-layer rows and the
  second process's reply back once they are on the GPU (`dropAB` in `engine/llm/gemma4.js`: `ArrayBuffer.prototype.transfer(0)`,
  at once, not at the next garbage collection), and every engine on the page shares one tokenizer for identical tokenizer files
  (`engine/llm/llm_engine.js` `_sharedTok`). Don't keep per-model copies of either.
- **The queue's hold** (`assistant/queue.js`, `holdMs`): Juli's models stay loaded 5 s after a job, for a follow-up, instead of
  unloading and loading again. The hold ends at once when another model's job is added, when a job becomes runnable, on
  `endHold()` (an app opens) and when the page is hidden. `Q.holding` counts as busy.
- **`settle()` after an unload** (`app.js`, WebKit): loading a model or opening an app right after a model unloaded first waits
  until 8 s have passed since the unload, so WebKit has the memory back (the LLM engine's own reload waits too: `reloadSettleMs`).
- **The faster-replies safety net** (`app.js`): if the page ended while Juli answered with faster replies loaded, they stay off on
  that phone; a toast and Settings › Juli turn them back on. A stop recorded in one process (`pf.app.fasterOff` without `split`)
  doesn't count on an iPhone where the split works; an iPhone without the split keeps them off.
- **The split** (`engine/llm/split.js`, `engine/llm/lworker.js`, `sw.js`; ENGINE_API.md section 9): on iOS 27 Juli's first layers
  (E2B: 0-12; the Bigger brain: 0-23) run in a module SharedWorker that the app's service worker serves with COEP require-corp,
  which gives it a process, and a memory budget, of its own. The worker's part loads first, so a split that can't start costs the
  page nothing. In plain words, with the measured memory: [docs/TWO-PROCESSES.md](docs/TWO-PROCESSES.md).
  - The KV mirror: page layers that read a worker layer's keys and values get them back with every hop (`Gemma4.mirrorKV()`; the
    Bigger brain's layers 22 and 23, which its shared layers and its drafter read). The page and the worker share one message version
    (`SPLIT_PROTO` = 3); bump both together.
  - The two processes take turns: never run GPU work in both at once (a busy second process slowed the other about 13 times on
    an iPhone). One hop per token or verify pass costs 1-3% of the time.
  - The worker never fetches weights: it reads the pack the page downloaded, from OPFS, read only.
  - The service worker answers only the worker's file and stores nothing; every other request goes to the network untouched. Keep
    it that way: no cache, no other routes.
  - Where it splits: `SPLIT_HERE` in `app.js` (WebKit, Safari's `Version/` 27 or later, service workers, SharedWorker). Faster
    replies on iOS 27 only with the split (one process there has no room for a long prompt beside them); iOS 26 keeps them as
    before; Chrome on an iPhone has them off.
  - When it can't split: Juli's engine goes on in one process by itself (`splitFallback`), without faster replies and with
    128-token read-in chunks (256 when split). On a phone where the split has never worked (`pf.app.splitWorked` unset), three such
    loads in a row while online stop the tries there (`pf.app.splitOff`) for 3 days, or until Settings › Juli › "Try the second
    process again".
  - When the second process fails during a call (it ended, or its work stalled: on an iPhone a fresh one loaded at once after a
    stall): the first failure is `SPLIT_RETRY` (the engine unloads and the queue runs the job again with a fresh worker part); a
    second in a row is `SPLIT_GONE` (Juli: one process for the rest of the page; the Bigger brain: off for the page, `E4B_DOWN`, its
    jobs go to Juli). No notes: the diagnostics log it. The worker part sends a heartbeat every second, so after the page was hidden
    (a phone call, another app) a silent one is caught 4 s after the page is back. Limits: worker start 30 s, read-in calls 45 s for
    the first chunk and 30 s after, a token or verify pass 30 s. A call's limit skips time while the page is hidden, Stop reaches
    it, and the second process is always told to free its memory, also after a timeout.
  - Loading writes at most 64 MB of weights before it waits for the GPU (`engine/core/store.js`, lworker.js `UPCAP`): without
    that, Safari's GPU process held a second copy of a model while it loaded. Keep the page's GPU device between models (destroying
    it after every unload ended with "The GPU was reset" after a dozen loads).
  - The Bigger brain never loads in one process on WebKit (`split: 'required'`, `SPLIT_UNAVAILABLE`), reads prompts in 64-token
    chunks there, loads in a fresh page, and turns itself off if the page ends while it is loaded (`pf.app.brain4Off`), for that
    set-up only (`E4B_CFG()`: drafter + chunk), so a changed set-up gets a fresh try. `countTokens()` (no GPU) is how the router
    fits its 2,048-token prompts.
  - With one KV head and every layer in one process the kernels run the same arithmetic in the same order as before. A kernel
    change must keep the words the same, split or not: check on a desktop browser first.

### 3.9 notes: read these before changing the home screen, the chat, Music, games, skills or memory

The APIs are in ENGINE_API.md section 25. Each part has node tests for its pure module; keep them passing.

- **The shell** (`ui/shell.js`; pure parts `ui/shell_core.js`, `ui/gesture.js`; `ui/wallpaper.js`, `ui/browser.js`): the home
  screen, the dock, the p0pc0rn pill, badges, edit mode, pinned apps and the Browser. The 3.8 views (`create`, `assistant`, `apps`,
  `library`, `settings`) are kept and still shown through `go(tab)`; `home` is the start screen (a new install opens in Juli's chat
  to download her). Other parts add their screen with `SHELL.register(...)` and their count with `SHELL.badge(id, n)`.
  - Kept on the phone: the home order (`p0pc0rn:home:order`), pinned apps (`p0pc0rn:home:pins`), bookmarks
    (`p0pc0rn:browser:bookmarks`) and unseen results (`p0pc0rn:shell:unseen`) in localStorage; the wallpaper in IndexedDB
    `p0pc0rn-shell`, scaled to 720 px wide and blurred by CSS.
  - Connection is a grayed placeholder: a tap shows only "Coming soon".
  - The page's rules still hold (the CSP in index.html): no inline styles or scripts, no `data:` images, no new network hosts.
    p0pc0rn ships no font files: text uses the device's system fonts (NOTICE.md). Nothing animates while `data-busy` is set.
- **Settings and Cast** (`ui/settings.js`; pure parts `ui/settings_core.js`): Settings' 3.8 sections are moved, whole, into six
  groups; every id and handler stays. Settings shows as an overview, every group closed, each time it opens; one group opens at a
  time. `revealSetting(el)` opens the group a row is in before something scrolls to it, and the Benchmark group opens for a run.
  Cast is a screen of its own (`#v-cast`, a home-screen icon); Settings keeps a link to it.
- **Conversations** (`ui/threads.js`, `ui/chatactions.js`, `ui/chat.js`): one conversation is one agent session in
  `p0pc0rn-assistant`; the Chats list is a small index in IndexedDB `p0pc0rn-chats`, built once from 3.8's sessions and then kept
  current by every message. A plan still sees only its own conversation's recent turns. The option bubbles under a result only run
  paths p0pc0rn already has.
- **Music** (`ui/music_core.js` pure, `ui/music.js`): one audio element for the visit; queue, shuffle, repeat and playlists in
  localStorage `p0pc0rn:music`; the lock screen through the Media Session API; one sound at a time in the app. What only a phone
  shows (playing on with the screen locked, the next song while locked, the lock-screen buttons) is the Music check.
- **Games** (`makeapp/choose.js`, Kit 1.6 `K.choose`; the Game Kit `K.game` 1.0 at the end of `makeapp/kit.js`, its API in the
  Skeleton Guide): the app keeps the rules and offers Juli EVERY legal move; her model picks one (greedy, from a numbered list; the
  Bigger brain the same way when it plays) and her answer is her move. An answer naming no option is asked again
  (three tries); no answer = the game says so ("Ask Juli again"), never a move made for her. Four in a Row's hint is its engine's
  read of every column (a bitboard search in the sketch, about 1.2 s). Her `appchoose` job runs on her own
  model (the Bigger brain only when the game asks for it: Four in a Row's opponent, earned with 10 wins in a row) beside the open game without closing it, and the game hold keeps the model loaded 60 s after each move, until the game
  closes: the one exception to "an open app closes when a model job starts".
- **Skills** (`assistant/skills.js`; bundled ones in `skills/`): know-how text for Juli, never permissions or code. A skill is
  framed in prompts as guidance under p0pc0rn's own rules and only goes in when it fits the model's room.
- **Changing an app** (`makeapp/edit.js`, the `appedit` job): a planner (the Bigger brain when usable, else Juli), a worker (Juli,
  one small JSON tool a step) and an advisory reviewer; after every change the host runs the app unseen on the person's data,
  read-only. Nothing is kept until the last phase; Undo and Versions restore earlier ones.
- **About me and routines** (`assistant/memory.js` pure, `ui/memory_ui.js`): kept in IndexedDB `p0pc0rn-apps`, store `memory`.
  About me is never given to apps and is the first thing dropped after a skill when a prompt is too long. A routine is sent as the
  person's own message, so it follows the same queue and agreement rules as a typed one. The heartbeat runs routines only while the
  page is visible, no app is open, nothing is busy, the terms are agreed and the last routine is answered; at most one a minute and
  8 a day.
- **Answers and how to ask** (`assistant/answers.js` pure; hooks in `assistant/agent.js`): a question about using p0pc0rn or about
  Juli herself is quick chat on her own model (no tool, no lookup, never the Bigger brain), answered from the FAQ's "How to ask
  Juli" section. Juli is never looked up. A how-to gets steps from what she knows (nothing looked up or made). An everyday question
  is answered plainly from what the lookup found, numbers, dates and names only from it (else she says she is not sure), with a short
  caveat only when it matters; a refusal there is asked again once. Asked whether something is safe, with nothing looked up that says
  so, she answers cautiously and never says "safe". The Rights & Copyright pointer stays only where copyright, trademarks or a likeness
  are the matter. A request that could hurt someone is never pushed.
- **Wallet Watch** (agentic; `makeapp/skeletons/wallet-watch.p0skel.json`, its pure CORE block node-tested): public Avalanche C-Chain
  addresses through the source `chain.snowtrace` (`makeapp/snowtrace.js`: Snowtrace's free, keyless API at `api.routescan.io`, the
  page's only new host). Josh's hard restrictions, all in the host: every request passes the HARD CAP in `makeapp/budget.js` (in
  `createFetcher`): 1 a second, 60 a minute, 5,000 a day for every app together (half of the free 2 a second and 10,000 a day; the
  day is UTC, kept in localStorage `p0pc0rn:quota:snowtrace`) and 1,600 a day for any one app; a refused request is never sent, a
  429 rests the source 1 minute, then 2, 4 ... 1 hour. An app that reads it (`idleOnly`) is checked at most every 15 minutes (its
  trigger's minMinutes; `check.js` keeps 15 for every app) and only when the phone is idle (`phoneBusy`: no model, no job of the
  person's queued or running); a job that arrives stops its requests (`BUSY`) and its question to Juli. Its data carries Routescan's
  credit with links to routescan.io and x.com/routescan_io (`SOURCE_CREDITS` in `ui/storefront_core.js`): shown, never fetched.
  Keep the caps, the floor, the idle rule, the credit and the one host. Juli's notices and habits are kept only when `K.facts` and
  the app's checks pass (no advice, no guess who is behind an address). Its skill `watch-a-wallet` (`for: app`) rides along with
  `K.ask(prompt, {skill})`. A check may return `{next}` (minutes; the host keeps it within its trigger's range).
- **Made apps: p5's names and the home indicator** (`makeapp/p5names.js`; hooks in `makeapp/check.js`, `host.js`, `frame.html`,
  `kit.js`): p5 starts after an app's script and writes its own functions and values onto `window`, so `checkBundle` refuses a
  sketch's top-level `function` / `var` with a p5 name (and a `let` / `const` / `class` with a name the Kit uses from p5, or `K`).
  The 3.8 Tiles Log had that bug (its `save()` was p5's: nothing it logged was kept); it is `saveState()` now. Inside an app's
  frame env() gives the SCREEN's safe-area insets wherever the frame sits (59 px over every title under p0pc0rn's bar on an iPhone
  16 Pro Max): the host measures how far the frame reaches into the top and bottom unsafe areas (`frameSafeTop`, `frameSafeBottom`)
  and the Kit's `K.safe.top` / `K.safe.bottom` take them (`p0.safe` with `host: true`, the boot message's `safe`, a `safe` message
  on a resize or when the frame's own size changes).
- **Home cards** (`ui/shell_core.js` `widgetsOf`, `ui/shell.js` `renderWidgets` / `swipeCard`, `makeapp/host.js` `newsAt`): Josh, Oct-27:
  "Only with news, swipe away". A card only for an app that works for you with news (items to review, or a check that needs a look;
  none when it is quiet or the person paused it); `app.newsAt` is set when its badge goes up or a check ends with a new error. A card
  swiped away is kept in localStorage `p0pc0rn:home:cardsGone` (`{appId: newsAt}`) and comes back only when `newsAt` is newer.
- **3.9 phone fit** (`app.js` `fitViewport`, `vpLine`): iOS 27 sizes a Home Screen app installed with black-translucent as the
  screen minus the status bar but draws it from the top (an open WebKit bug: 313800, 317153, 301994), leaving a strip the page cannot
  paint (moving layers into it clips them). Only in the Home Screen app on an iPhone whose page is 20-90 px short, the document is
  made as tall as the screen, which makes iOS grow the page (Josh's iPhone 16 Pro Max, 27.0.1: 894 -> 956 in 300 ms); if it does
  not grow, the scroll lock is lifted for one more try, then everything is put back. Diagnostics' second line shows the numbers.
  Never fill the gap by moving layers below the page; never use 100vh / 100lvh for heights.
