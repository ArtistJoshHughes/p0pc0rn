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

## The licence in plain words (LICENSE.md is the p0pc0rn Non-Commercial License 1.1; the file governs)

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
| `ui/`, `popcorn/` | chat and research views; the progress animation |
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

1. **iPhone.** Use Safari, iOS 26 or later. Android (Chrome): experimental — prepared on desktop with Android-like limits; first device test pending (Pixel 10): run Settings › About › Device check first; the user may share the report in a GitHub issue or a DM to @p0pc0rnapp.
   - Tailscale must be on, on the phone. Then open the `https://…ts.net` address. It won't work over `http://` or a LAN address,
     because WebGPU needs HTTPS.
2. **iPhone: choose Safari or the Home Screen icon first, and stick to it.**
   - iOS gives the Home Screen app its own storage, so models and the agreement downloaded in Safari aren't in the icon.
   - The app suggests the Home Screen: Share › Add to Home Screen, then open from the icon.
   - On Android, the installed app and Chrome share storage.
3. **The rights lesson and "I agree".** The user reads and agrees themselves. Make stays disabled until they do.
4. **Settings › Storage › Protected from iOS cleanup › Allow.** This helps iOS keep the models.
5. **Settings › Models:** tap Download on each feature the user wants (sizes are in SETUP.md).
   - Each model shows its licence first; the user reads it and accepts.
   - Keep the app in front, the phone plugged in and on Wi-Fi.
   - If the screen locks or the app goes to the background, the download stops. Back in the app, it picks up where it stopped
     (tap Download if it doesn't).
   - Music videos need Assistant, Songs, Pictures, Videos and the picture reader.
   - Lip-sync needs Voice.
6. **First result:** Create › type a description › Make. A picture takes about 2 to 3 minutes.

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
- **A clip stops while it develops.** Settings › Video decode memory › 450 MB.
- **The phone is hot or slow.** Plug it in, take the case off, keep it out of the sun, and leave a short break between jobs.
- **Out of space.** Settings › Models: delete the models the user doesn't need. The Library stays.
- **Diagnostics:** Settings › About › Diagnostics › Copy. It holds the last 50 steps with memory figures. Nothing leaves the phone
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
