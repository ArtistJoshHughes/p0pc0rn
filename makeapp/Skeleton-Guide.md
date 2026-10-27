# p0pc0rn Skeleton Guide (for Claude or any AI helper)

**How to use this file:** attach it to a chat with an AI helper (for example Claude), then write one or two sentences under "MY APP"
at the end. The AI replies with **one file** named `<your-app-id>.p0skel.json`. Save it, then in p0pc0rn open the **Apps** tab ›
**Import a skeleton** and pick the file. p0pc0rn checks it, shows what it asks permission for, and puts it on your skeleton shelf.
After that you can use it as it is, and Juli (the assistant in p0pc0rn) can make new apps from it just by filling in its slots.

This guide is for p0pc0rn 3.8.

---

## Instructions for the AI writing the skeleton

You are writing a **skeleton**: a complete, working mini-app for p0pc0rn, a private creative app that runs in Safari on an iPhone
(it also works in desktop browsers). The app runs in a locked sandbox. Juli, a small on-phone AI (about 2B parameters), will later
re-use your skeleton for many similar requests by filling in its **slots**: a short JSON object of content, labels, colours and
numbers. Juli never edits code. So:

1. **The code must be complete and correct on its own.** Every slot has a default; with no slots at all the app runs and looks good.
2. **Everything request-specific is a slot.** Titles, labels, starter items, colours, goals, choices, short copy.
3. **Slots must be easy for a small model to fill.** Rules below.
4. **Live numbers are never slots.** Weather, prices, fires and anything else that changes come from `p0.fetch` at run time.
   Never put made-up readings, prices or history in slots or code; a new app starts empty or with neutral starting values.
5. **Reply with exactly one JSON file** (the bundle format below), nothing else. Put it in one code block so the person can save it.

### The bundle (`<id>.p0skel.json`)

```json
{
  "p0skel": 1,
  "manifest": {
    "id": "lower-case-id",            // 3-40 chars: a-z 0-9 -
    "name": "Display name",           // <= 30 chars
    "description": "1-2 sentences: what it does and which requests it fits. Juli's router picks skeletons by this.",
    "category": "non-agentic",        // or "agentic": see Two kinds of app
    "goal": "One sentence",           // agentic apps: what it works toward
    "kind": "game",                   // optional: a game, where Juli can be a player (see Games: Juli as a player)
    "version": "1.0",
    "author": "optional",
    "runtime": "p5-kit@1",            // p5.js 1.11 + the p0pc0rn Kit, provided by the host (never include them)
    "entry": "sketch.js",
    "permissions": { "storage": true },   // see Permissions; ask only for what the app needs
    "triggers": [ { "type": "manual" } ], // see Triggers
    "slots": { "title": { "type": "string", "max": 22, "required": true, "desc": "large title" } }
  },
  "slots_default": { "title": "My App" },  // a complete, valid set of slot values
  "notes_for_juli": "Plain-words advice on filling the slots well (<= 1500 chars).",
  "files": { "sketch.js": "...the whole app as one string..." }
}
```
(The `//` comments above are explanations only. The real file is plain JSON with no comments.) Only these fields; p0pc0rn rejects
unknown ones. The whole file must stay under 400 KB and `sketch.js` under 160 KB.
Optional: `"skills": {"<name>": "<the skill's whole .md text>"}`, up to 3 skills (know-how for Juli) that come with the skeleton
(see **Skills** below).

### Two kinds of app: `"category"` (required)
**An app answers the tap. An agentic app keeps going.**
- **`non-agentic`** - a tool the person uses: lists, flashcards, counters, logs, dashboards, games. It does what they tap. A "live" one
  may also check a source on a timer (`on-open` / `interval` triggers and `p0.onCheck`) and post what it finds, like the Apps tab's
  Weather Alerts. It has no goal of its own, and Juli doesn't work in it.
- **`agentic`** - Juli works in it on her own, toward a goal the person set, while p0pc0rn is open. The person hands it work in the open
  app (a trip, a note, a question). Juli does that work, plus her own **idle tasks** (look things up, re-check, sum up), in the app's
  checks; the first check comes right after the app closes. It keeps what it learns in a **notebook** on the phone and brings what needs
  the person's eye to a **review queue**. It knows more next week than today.

An agentic app declares five things (the person sees them on its permission sheet):
1. **Goal** - `manifest.goal`: one sentence it works toward, e.g. "Keep an eye on the weather for my trips".
2. **Notebook** - `K.notebook(name)`: its memory on the phone, in four shelves. `confirmed`: only the person puts things here (a tap
   in the open app; an unseen check can't). `suspected`: its own guesses and findings, Juli's words, and the requests waiting for her,
   each with its evidence. `grounding`: facts from a source, with where and when they came from. `dismissed`: what the person said no
   to, raised again only when it changes.
3. **Tasks** - `K.agent({tasks})`: they run in the app's checks (`on-open` and/or `interval`, plus one right after the app closes). A
   task's `due()` makes the next check run it when work is waiting. The open app may run a task at once (`K.agent.run(id)`) for the
   parts that need no Juli (a fetch, a rule).
4. **Reach** - the sources in `permissions.online`, and Juli (`permissions.juli: ["ask"]`, required). Nothing else.
5. **Review queue** - `nb.review()`, drawn with `K.review(...)`: what it raises for the person's eye, with its evidence. They confirm,
   say no, or ask; a question is saved for Juli and answered in the next check.

The rules (the Kit makes most of them automatic):
- **Juli never works while the app is open.** The phone's memory goes to the open app, so `K.ask` works only in a check. Save what the
  person asks for in the notebook; a task answers it in the next check, and a notice in Juli's chat says so.
- **It never confirms anything itself.** `nb.confirm` and `nb.dismiss` work only in the open app, from the person's tap.
- **It shows its sources.** Every grounding entry keeps its source and time (`evidence: [{source, at}]`); show them next to the fact.
- **Juli's numbers come from the source.** Put her words through `K.facts(text, data)` and leave out any line that fails. Live
  readings never come from Juli, slots or code.
- **Private.** Photos, exact places and the notebook stay on the phone; a source gets only a rounded position or the words the app passes.
- **Quiet.** It posts to the chat (`chat.post`) only when something new or worse needs the person, once per thing.
- **Visible.** It shows what it did (`K.agent.logs()`) and what waits for Juli, and the person can remove anything it keeps.
- **In its lane.** Facts for its goal, never advice outside it, and never trading advice.
- **Open only.** Checks run only while p0pc0rn is open (an old phone on a charger with p0pc0rn open works as an always-on agent), never
  while p0pc0rn is rendering. Push notifications come in a later update.
p0pc0rn's shelf shows the two kinds separately. Trip Watch, the second example at the end of this guide, is a complete agentic app to copy.

### Runtime and sandbox rules
- The host loads p5.js 1.11, then the p0pc0rn Kit (`kit.js`, global `K`; it includes the Game Kit, `K.game`) and your `sketch.js` as
  one script, with `window.SLOTS = {...}` set first. Then it starts p5 in global mode.
- Write a normal p5 sketch: `setup()` calls `K.setup(...)` first; `draw()` calls `K.render()`; draw screens with `K.scene`.
- Read slots ONLY through `window.SLOTS`, validate every value, clamp lengths and numbers, and fall back to a default.
- **No network.** No `fetch`, XHR, WebSocket, WebRTC, `import()`, `eval`, `new Function`, CDN links or `http(s)://` text in the code (comments
  are fine). Online data comes only through `p0.fetch` (below), and only for sources listed in `permissions.online`.
- **No raw storage.** Use `K.load(key, fallback)` / `K.save(key, value)`: the host keeps them per app, on the phone (at most 1 MB per
  app). Bump the key (`v1` -> `v2`) when the saved shape changes. `localStorage`, cookies and IndexedDB are not available.
- Do not touch `parent`, `top`, `opener` or `postMessage`, or the DOM outside your canvas (the Kit's `K.input` is the only text field).
- No frames, `<link>`, `<meta>` or `<base>` tags, shadow DOM, `document.write` or HTML parsers (`DOMParser`): the sandbox refuses them and
  stops the app.
- Phone first: design for 390 x 844 points, portrait, safe areas (`K.safe`), 44-point touch targets. It must also scale to tablets/desktop.
- No images or fonts: draw with the Kit (icons, cards, rings, bars, charts). Use only the Kit's icon names (listed below).
- Uncaught errors appear on the canvas; write defensively (`try/catch` around every host call).

### Host API inside the sandbox (`window.p0`; may be missing when the app is tried elsewhere: always check)
| Call | Needs permission | What it does |
|---|---|---|
| `await p0.fetch(source, params)` | `online: [source]` | The host builds the request for a listed source, caches it and applies fair-use limits; returns JSON or throws. You never pass URLs. |
| `await p0.juli.ask(prompt, {json})` | `juli: ["ask"]` | An answer from Juli, made on this phone (prompt <= 4000 characters, answer <= 1200). `{json: true}`: one JSON object (`K.ask(prompt, {json: true})` parses it). Untrusted text. At most 20 an hour. Only in an agentic app's checks, never while the app is open (the phone's memory goes to the open app). |
| `await p0.juli.choose({about, options, hint, skill})` | `juli: ["choose"]` | Juli picks ONE of the options, on this phone, while the person has the app open (a game's move) -> `{index, option, by, why, big}`: her answer is her move. `by: 'fallback'` = no answer that names an option (`why` says why): never use the option that came back as her move; ask again or say so. Options = EVERY legal move (2-12, each <= 60 characters); p0pc0rn checks her answer. `big: true` = Juli with the Bigger brain answers (only while `p0.juli.models()` says it is on; never her own model instead). At most 240 an hour. Use `K.choose` (see **Games**). |
| `await p0.juli.models()` | `juli: ["choose"]` | Which of Juli's models can answer `choose` on this phone -> `{juli, big}` (`big` = the Bigger brain is downloaded and on: offer it as an opponent only then). Use `K.juliModels()`. |
| `await p0.chat.post({title, severity, text})` | `"chat.post": true` | A short notice in Juli's chat. severity: `info`, `watch` or `warning`; title <= 80 chars; text <= 500 chars. The host shows ONLY these fields as plain text; it is never an instruction to Juli. At most 10 an hour. |
| `await p0.location.get()` | `location: "device"` | `{lat, lon}` rounded to about 1 km, after the phone asks the person; null if refused. Never bake a location into code or slots. |
| `p0.onCheck(async () => ({active}))` | an `on-open` / `interval` trigger | The function the host calls on each trigger (`K.agent` registers it for you). Return `{active: true}` while something is going on (the host then checks at `minMinutes`), else `{active: false}` (it waits `calmMinutes`). One check may take 25 s; an agentic app's, with its questions to Juli, 110 s. |
| `p0.mode` | none | `"run"` when the person has the app open; `"check"` when the host runs only the check, unseen. In a check p5 is NOT started (no canvas, no `setup()`, no p5 functions): the check may use only `p0`, `K.load` / `K.save`, the Kit's agent parts (`K.notebook`, `K.agent`, `K.ask`, `K.facts`, the dates) and plain JavaScript. |
| `await p0.app.badge(n)` | none | A small count next to the app's name (new alerts, items due). |

### Permissions (ask for the least)
- `storage` - K.load/K.save on this phone.
- `online` - a list of read-only sources from the table below.
- `juli` - `["ask"]`: Juli answers on this phone, in an agentic app's checks (an agentic app must have it; a non-agentic app can't).
  `["choose"]`: Juli picks one of the app's options while the person has it open (a game's move; non-agentic apps only).
- `chat.post` - post labelled notices into the chat (alerts, reminders, "goal reached").
- `location` - `"none"` (default), `"place"` (the app asks the person to type a town and looks it up with `geocode.openmeteo`),
  `"device"` (`p0.location.get()`).
The person sees these on a permission sheet and can refuse. Apps never get the person's photos, Library, Cast, files, or other apps' data.

### Online sources in p0pc0rn 3.8 (free, no keys; fetched by the host)
| source | params | gives |
|---|---|---|
| `alerts.nws` | `{lat, lon}` | `{alerts: [{id, event, severity, urgency, certainty, headline, area, effective, ends, sender, description, instruction}]}` US National Weather Service active alerts at that point |
| `weather.nws` | `{lat, lon}` | `{place, periods: [{name, start, day, temp, unit, wind, short, pop, detail}]}` US NWS forecast: 14 day and night periods (about 7 days); `pop` = chance of rain or snow in % (null when NWS gives none); `detail` = NWS's own sentence for the period |
| `geocode.openmeteo` | `{name}` | `{results: [{name, region, country, cc, lat, lon}]}` place search, worldwide |
| `fires.wfigs` | `{lat, lon, radiusMi}` (5-200) | `{fires: [{id, name, acres, contained, discovered, state, lat, lon}]}` current US wildfire incidents (NIFC / WFIGS) |
| `prices.coingecko` | `{ids: ["avalanche-2", "bitcoin", ...]}` (<= 20) | `{coins: [{id, symbol, name, price, cap, rank, volume, supply, chg: {D, W, M, Y}}]}` crypto prices in US dollars and % change over a day / week / month / year |
| `chain.snowtrace` | `{op: "watch", items: [{address, kind: "wallet" or "contract", since}]}` (1-5); `{op: "history", address}`; `{op: "contract", address}`; `{op: "labels", addresses}` (1-6) | Public Avalanche C-Chain activity from Snowtrace, the public explorer (3.9): `watch` -> `{balances, items: [{address, txs, tok, int, done}], stopped}` (rows `{h, b, t, f, to, v, fn, err}`, tokens + `{c, sym, dec}`; `since` = the block to start from); `history` -> its newest rows; `contract` -> `{verified, name, proxy, impl}`; `labels` -> the explorer's public tags of organisations and contracts only. p0pc0rn's hard restrictions: every request counts against its cap (5,000 a day for all apps together, 1,600 for one app, 1 a second): when it is used up `p0.fetch` throws `DAILY_CAP` or `APP_CAP` (or `BACKOFF` after the explorer said "too many"), and the answer's `quota` says how many today. An app that reads it is checked at most every 15 minutes (use `minMinutes` 15 or more) and only when the phone is idle: a job of the person's that arrives during a check stops its requests (`BUSY`) and its `K.ask` (keep your own words for a notice). Only the addresses go out. Show "Powered by Routescan.io APIs" (p0pc0rn adds the links, [routescan.io](https://routescan.io), [@routescan_io on X](https://x.com/routescan_io), under your app and on its sheets: an app holds no web address). Never advice, never a guess who owns an address. |
Every answer also has `source` (show it, e.g. "Data: NWS", "Prices by CoinGecko") and `fetchedAt`. Show cached data when offline.
Positions are rounded to about 1 km before they leave the phone. More sources come in later updates; any other name is rejected.
**No trading advice:** an app and Juli may show prices, charts and changes, but never say what to buy, sell or hold, never predict
prices, and never promise returns.

### Triggers
- `manual` - the app runs when the person opens it.
- `on-open` - the host also runs the app's check soon after p0pc0rn opens (agentic apps, and live non-agentic ones).
- `interval` - `{"type": "interval", "minMinutes": 90, "calmMinutes": 720}` (15-1440): the host runs the check on a
  timer **only while p0pc0rn is open**: every `minMinutes` while the last check said `active`, every `calmMinutes` when calm. A check
  may also return `{next: minutes}`: the host checks again then, kept between `minMinutes` and `calmMinutes` (Wallet Watch: its own
  15-60 minute setting).

### Slot conventions (a 2B model fills these: keep them simple)
- Flat and named. Prefer arrays of small objects with named fields (`{"front": "", "back": ""}`) over positional arrays.
- Every slot has `type`, `required`, `desc`, and limits: `max` length for strings (required), `min`/`max` for ints and array sizes
  (required), optional `min`/`max` for numbers.
- Types: `string`, `int`, `number`, `bool`, `color` (#rrggbb), `icon` (one Kit icon name), `enum` (list the values), `ref` (must equal a
  value elsewhere, e.g. a task's `list` must be one of `lists[].name`; write `"ref": "lists.name"`), `object` (`item` = named slots),
  `array` (`item` = named slots, or `"string:N"`).
- At most ~10 top-level slots (40 is the hard limit) and 2 levels of nesting. No code, HTML, URLs or locations in slots.
- `slots_default` fills every required slot with NEUTRAL starting values (an empty list, "My Log", a sensible goal): it is what the
  person gets with "Use", and what replaces a slot Juli could not fill. Never fake data there.
- `notes_for_juli`: say what a good fill looks like and give one short example fill for a different request.
- In code, validate again (clamp, default, drop bad items); never trust a slot.

### Test checklist (do these before replying)
1. The app runs with `window.SLOTS = {}` and with `slots_default`, without `window.p0` and with it.
2. Every control works with a finger (tap targets >= 44 pt), nothing overlaps at 390 x 844, text never overflows.
3. No banned calls (network, eval, raw storage, `http` text, `parent`/`postMessage`). Host calls are wrapped in `if (window.p0)` + try/catch.
4. Permissions list only what is used. A check (`K.agent` or `p0.onCheck`) is registered at the top level and posts each event once. Agentic: a
   `K.notebook`, Juli only in checks (the open app saves the request), `nb.confirm` only from a tap, Juli's words through `K.facts`,
   `K.agent.logs()` on screen, and a way to work when Juli can't answer.
5. The whole bundle is valid JSON (escape quotes and newlines in `sketch.js`).

### Skills: know-how for Juli (optional)
A **skill** is know-how for Juli: a short Markdown file she reads only when it fits what the person asks. A skill has no screen, no code
and no permissions, and it never changes p0pc0rn's rules. **Skills and apps combine:** a game skeleton (the app) plus a "how to play"
skill (the know-how). p0pc0rn comes with `make-an-app` (how Juli fills a skeleton), `change-an-app` (how she changes an app),
`play-four-in-a-row` (her Four in a Row know-how), `make-a-game` (how a game is made on the Game Kit) and
`watch-a-wallet` (how she writes Wallet Watch's notes).

One skill is one `<name>.md` file:
```
---
name: play-my-game
description: One line: what this helps Juli do and when to use it (at most 200 characters).
for: [game]
---
The body: plain Markdown, the most important lines first.
```
- `name`: 3-40 characters: a-z, 0-9 and `-`. `for`: when Juli uses it, one or more of `make` (making an app), `change` (changing an
  app), `chat` (her chat), `game` (playing a game app), `app` (an app that works for you names it in its questions to Juli:
  `K.ask(prompt, {skill: 'its-name'})`; Wallet Watch's `watch-a-wallet`).
- The body: 600 tokens (about 2,000 characters) or fewer works best; 900 tokens and 6 KB are the limits. No web addresses, no HTML, no
  personal data.
- Write for a small model: short plain lines, one rule each, the most important first. Juli's memory is small, so a long skill is cut
  at a paragraph to fit; `## ` sections help.
- A game's how-to-play skill is strategy, not rules. The app enforces the rules, works out the legal moves (and hints such as "this
  column wins") and offers Juli only those; the skill says what makes a good choice (win now if you can, block the person's win, then
  your own plan).

**Bundling skills with a skeleton:** add `"skills": {"play-my-game": "---\nname: play-my-game\n..."}` to the bundle: at most 3, each key
its skill's `name`, each value the whole `.md` text as one JSON string. When the person allows the skeleton, its skills come with it,
turned on; removing the skeleton removes them. A name that a skill already on the phone has is refused.

**A skill on its own:** Skills on the home screen › Import a skill (.md). p0pc0rn shows the whole text before it is turned on; the person can view,
turn off, export or delete it there.

### Games: Juli as a player
A **game** is a non-agentic app with `"kind": "game"` (the shelf lists it under Games) in which Juli is the other player. Build it on
**the Game Kit** (`K.game`, in the Kit API below): it brings the turns, the saved game, the score, Juli's turns, the motion, the sound,
the results card and accessibility, so a game is mostly its rules and its look. Juli plays to win, and every move is her own:
1. **The game keeps every rule** in a pure `// ===== RULES` block: the board, the legal moves, the winner, and the facts a player needs
   (a move that wins now, a threat to block).
2. **Her model makes every move.** On her turn `K.game.match` calls your `pick`, `K.choose(about, options, {skill, hint})` (needs
   `permissions.juli ["choose"]`): `about` = the state as text (<= 1200 characters, e.g. the board in rows), `options` = EVERY legal move
   (2-12, each <= 60 characters, labelled in words: column letters, cell names, never numbers), `hint` = what the game worked out
   (<= 300 characters, naming each choice's number), `skill` = the name of the game's how-to-play skill. p0pc0rn checks her answer is
   one of the options, and her answer is her move, even a weak one. Never filter or reorder her options to steer her, and never replace
   her answer with your own move.
3. **The game's read is a hint, nothing more.** Make it as good as the phone allows: read every option (a search such as
   `K.game.search`, or your own in the RULES block, run in slices with `K.game.work` so the frames keep flowing) and say plainly where
   each of HER choices leads, best first: "wins now: 4 (D); even: 3 (C); loses at once: 2 (B)" (a small model read "they win next" as
   "block there": say what her own move does), and put the same words beside each option ("column D (wins now)"): next to its
   number a small model takes it in far better (Four in a Row, Juli's model on 36 positions: blocks missed 4 of 12 with the read in the
   hint only, 1 of 12 with the same words beside each choice too). Information only: she still picks from every option, in the
   options' own order.
4. **No answer, no move.** An answer that names no option is asked again (three times in all, by the Game Kit). When her model gives no
   answer (it stopped, it is not downloaded, another question was on its way) the match is stuck: say so in plain words ("Juli's model
   stopped") with an "Ask Juli again" button (`M.askAgain()`). The game never moves for her; only a move that is the ONLY legal one is
   played as it is.
5. **The phone's memory:** for `choose` only, her model (Juli's own; the Bigger brain only when the game asks for it) runs next to the
   open game and stays loaded for a minute after each move; it leaves when the game closes. Every other job still closes an open app.
   At most 240 moves an hour.
6. **An opponent to earn (if you like):** Four in a Row starts everyone against Juli on her own model; 10 wins in a row unlock, for good
   on that phone, the choice of Juli with the Bigger brain (offer it only while `await K.juliModels()` says `big`; `juli.big()` in the
   match asks it, with the same rules: her answer is her move). Keep the run and the unlock in `M.st.keep` (the match's `tally`), show
   the run on the results card (`progress`) and celebrate the unlock (`K.game.unlock` with `K.game.celebrate`).
7. **Bring a skill:** a short how-to-play skill in the bundle's `skills` (strategy, not rules: "win now, block, then the middle").
8. **Saved:** the match saves every move, so a game left open goes on next time, also after the page reloads. A check never runs a game
   (use the `manual` trigger).

p0pc0rn comes with Four in a Row (`connect-four`, with its skill `play-four-in-a-row`), the Game Kit's showcase: its read looks many
moves ahead (a bitboard search) inside "Juli is thinking". **A complete game example** near the end of this guide is a small one to
copy (noughts and crosses). The skill `make-a-game` sums up the recipe.

---

## The p0pc0rn Kit API (provided by the host as `K`)


The kit is loaded before sketch.js. It hooks every p5 frame itself: input, tweens, springs, toasts and the controls map that automated tests read
update automatically. Your sketch only calls `K.*`. It draws on the canvas 2D context inside save/restore, so
p5's fill()/stroke() state is never disturbed and you can mix p5 drawing (rect, ellipse, image...) with kit drawing freely.
Kit hit areas use UNTRANSFORMED screen coordinates: never draw a kit control inside your own translate()/scale() - pass its real x/y.

### Frame
```js
function setup() { K.setup({ mode: 'dark', accent: '#6c7bff' }); K.scene('title', drawTitle); K.scene('play', drawPlay); }
function draw() { K.render(); tab = K.tabBar('tabs', TABS, tab); sheetOpen = K.sheet('opts', sheetOpen, 320, drawOpts); }   // sheets LAST
```
- `K.setup({mode:'dark'|'light', accent, bg, surface, surface2, surface3, text, text2, text3, line, good, warn, bad, density:2})` creates the full-screen canvas, theme, safe area, scroll lock, pointer input. Call FIRST in setup(). Any palette token can be overridden; a given `surface` derives surface2/surface3 (pass them too for a strongly tinted surface). `K.theme({...})` re-themes live; `K.mode` is 'dark'|'light'.
- `K.scene(name, fn)` registers a screen; the first one registered is shown first. `fn()` draws the WHOLE screen (background first) and handles its own input.
- `K.go(name, fx, ms, {restart})` changes screen with a transition: `'fade'` (default) `'slide'` `'back'` `'up'` (modal) `'down'` `'zoom'` `'none'`; ms 0 = instant. Ignored while the outgoing screen is being drawn. `{restart:true}` replays the CURRENT screen (retry: entrances run again). A tap that began on the previous screen never fires on the new one. `K.sceneName`, `K.sceneAge()` (s since the screen being drawn opened), `K.inTransition()`.
- `K.render({fx:false})` skips drawing particles/floaters/rings so a game can call `K.fx()` itself (inside `K.camera`, under its HUD). Effects are in SCREEN coordinates.
- Time: `K.t` (s since start), `K.dt` (s this frame, capped), `K.ms`, `K.frame`, `K.gdt` (gameplay dt: 0 during `K.hitstop`, scaled by `K.timeScale` - set `K.timeScale = 0.3` for slow motion). Size: `K.W`, `K.H`. Safe area: `K.safe.top/bottom/left/right` (in p0pc0rn the host passes the top and bottom ones for where the app's frame really sits:
the top is 0 under p0pc0rn's bar, the bottom is the home indicator when the frame reaches it; keep controls above `K.H - K.safe.bottom`). `K.clamp(v, lo, hi)`, `K.inRect(px, py, x, y, w, h)`.

### Palette + type (never hard-code grey; use the theme)
- `K.C.bg bg2 surface surface2 surface3 line text text2 text3 accent accentText good warn bad` - colour strings. `K.setAccent(c)` changes only the accent (phase colours).
- `K.alpha(color, a)` -> rgba string (the ONLY way to add alpha to a hex colour). `K.mix(a, b, t)`, `K.lighten(c, t)`, `K.darken(c, t)`, `K.hsl(h, s, l, a)`, `K.luma(c)`, `K.onColor(fill)` (readable text colour on a fill).
- `K.text(str, x, y, role, color, {align:'left'|'center'|'right', base:'alphabetic'|'middle'|'top', size, weight, family:'FONT'|'ROUNDED'|'MONO', italic, ls, alpha, maxW, shadow, shadowBlur, shadowY, stroke, strokeColor})` -> width. Roles: `hero display largeTitle title title2 title3 headline body callout subhead footnote caption label button num score game` (`K.TYPE[role]` = [size, weight, family, letterSpacing, lineHeight]). `label` = tracked small caps for section headers (pass UPPERCASE text).
- `K.num(str, x, y, role, color, {align, size, alpha})` - numbers in fixed-width digit cells; `K.measureNum(str, role, {size})` -> its width. Fit a big number: `size = Math.min(40, 40 * maxW / K.measureNum(s, 'display', {size: 40}))`.
- `K.para(str, x, y, w, role, color, {align, maxLines, alpha})` -> height; `K.paraHeight(str, w, role, {maxLines})` -> the same height BEFORE drawing (size the card first); `K.wrap(str, w, role)` -> lines; `K.measure(str, role, {size, weight})` -> width.
- `K.fmt.num(n, d) money(n, '$', 2) pct(n) compact(n) clock(ms) time(Date.now()) time12(Date.now()) ago(ts) date(ts)` - compact: 999 1.2K 10K 123K 1M 1.5T; time/time12 take WALL-CLOCK ms (Date.now()), never millis().
- Spacing `K.S.xs s m l xl xxl` (4 8 12 16 24 32), radii `K.R.s m l xl pill`.

### Surfaces
- `K.backdrop({top, bottom, glow:[{x, y, r, color, s}], vignette:0.35, vignetteColor, grain:0.05})` - gradient + light pools + vignette + film grain. First call of every scene.
- `K.card(x, y, w, h, {fill, r, elev, stroke, alpha, glow})`, `K.rect(x, y, w, h, {fill, r, grad:[top, bottom], stroke, sw, elev 0-4, shadow, alpha})`, `K.circle(x, y, r, {fill, stroke, sw, elev, alpha})`, `K.line(x1, y1, x2, y2, color, w, {dash, alpha})`, `K.glow(x, y, r, color, s)`, `K.gradRect(x, y, w, h, [c0, c1...], vertical)`.
- `K.clip(x, y, w, h, fn, r)` - draw fn clipped; kit hit tests AND the controls map that automated tests read only see what is inside the clip. `K.with(ctx => ...)` raw 2D context inside save/restore (returns fn's value); `K.pathRR(ctx, x, y, w, h, r)` builds a rounded-rect path on it (dashed outline: `K.with(c => { K.pathRR(c, x, y, w, h, 12); c.setLineDash([6, 5]); c.strokeStyle = K.C.line; c.stroke(); })`).
- `K.fade(a, fn)` - fade a whole block (plain drawing, custom hit areas, kit controls) as one piece; below 0.3 it is inert, like `{alpha}`. Returns fn's value. Use it for card entrances instead of push/globalAlpha.
- `K.icon(name, cx, cy, size, color, {weight, fill, alpha})` - line icons; `{fill:true}` fills closed shapes (liked heart, rated star, saved bookmark). `K.ICONS` (use only these names): plus minus close check chevronRight chevronLeft chevronUp chevronDown back arrowRight arrowUp arrowDown menu more search heart play pause stop undo redo backspace refresh share trash edit home chart trend list grid user bell clock calendar timer flame bolt drop sun moon cloud rain lock info alert trophy coin star sound mute camera pin bookmark filter sparkle music mic image globe send chat dice cart target leaf book paw dollar eye settings shield gift key swords ghost skipBack skipForward shuffle repeat copy download upload flag tag checkCircle plusCircle xCircle thumbUp sliders arrowLeft compass skull.

### Motion
- `K.tween(obj, {prop: to}, ms, {ease, delay, onDone, yoyo, loop, scene})` -> handle.stop(). `{scene:true}` binds to the screen showing when the tween first steps (make it, then `K.go` = it belongs to the NEW screen) and stops when you leave it. `K.ease.*` are functions `t -> t'`: linear inQuad outQuad inOutQuad inCubic outCubic inOutCubic outQuart outQuint inOutSine outExpo inOutExpo outBack inBack inOutBack outElastic outBounce.
- `K.spring(v, {k, d})` -> `{v, vel, to(x), set(x), kick(vel)}` updated for you. `K.springTo(key, target, {k, d})` -> spring value remembered by key (`const s = K.springTo('card'+i, selected ? 1.05 : 1)`). `K.springKick(key, vel)` - a pop: on tap `K.springKick('like', 6)`, then draw at `K.springTo('like', 1)`.
- `K.anim(key, target, speed, dt)` -> smoothed value (no overshoot); steps once per frame per key. `K.approach(cur, target, speed, dt)` frame-rate independent lerp; pass `K.gdt` as dt for gameplay values that hitstop/slow-mo should freeze.
- `K.count(key, value, ms, {snap})` -> a number that rolls to each new value (score, price). `K.countReset(key)` so a new run starts at its value instead of rolling down; `K.countReset(key, 0)` so it rolls UP from 0 (a results card).
- `K.stagger(i, stepMs, durMs, ease)` -> 0..1 entrance progress of item i since the screen opened (stepMs 0 means the 40 ms default). `K.entrance(delayMs, durMs, ease)` -> the same with a plain delay. `K.since(t0, delayMs, durMs, ease)` -> 0..1 since `K.t` was t0 (a result card, a banner, the next question: store `t0 = K.t` when it appears).
- `K.wave(speed, phase)` -1..1, `K.pulse(speed)` 0..1 - idle breathing, bobbing, blinking.

### Juice (games AND apps: every action answers with motion + sound)
- `K.burst(x, y, {n, colors:[...], speed, life, gravity, size, shape:'circle'|'square'|'spark'|'confetti'|'star', angle, spread, drag})`
- `K.floater('+10', x, y, {color, role, rise, ms, stroke})` (stroke: outline colour or false), `K.ring(x, y, {color, r0, r1, ms, width})` (tap feedback), `K.shake(px, ms)`, `K.flash(color, ms)`, `K.hitstop(ms)`.
- `K.camera(fn, {x, y, zoom})` - draw world content with shake (+ pan/zoom).
- `K.sfx(name, {vol, pitch})` - synthesised sounds: `tap tick pop select toggle back success error coin jump shoot hit boom powerup lose win whoosh click`. The first touch unlocks audio. `K.sound = false` mutes every kit sound (a Sounds toggle writes it; save it with K.save); `K.volume` 0..1 (0.6). `K.audio()` -> the kit's AudioContext for your own synth; `K.markSound(name)` tells automated tests a custom sound played.

### Input (event-driven: a sub-frame tap is never lost; no touchStarted/mousePressed needed)
- `K.tapIn(x, y, w, h, keepIt)` -> tap object or null (started + ended inside, not a drag, began on this screen; consumed unless keepIt). `K.pressIn(...)` pointer went down inside this frame. `K.holdIn(...)` live pointer that started inside (a whole tap inside one frame never shows in holdIn - check tapIn first). `K.longPress(...)` (450 ms still).
- `K.freeTap()` / `K.freePress()` - a tap/press that did NOT land on any kit control (world taps never fire through buttons).
- `K.swipe` = 'left'|'right'|'up'|'down'|null this frame (gestures up to 1.3 s, 40 px); `K.swipeFrom` = its start {x, y} (limit a swipe to one region). `K.ptr {x, y, down, pressed, released}`, `K.pointers` (live fingers: `{id, x, y, sx, sy, dist, t0, claimed}`). `K.keys['ArrowLeft']`, `K.pressedKeys` (desktop testing).
- `K.claim(p, tag)` - claim a finger from K.holdIn / K.pointers for a custom drag (swipe-to-delete, card drag, drawing stroke): taps, swipes, sliders, scroll and pager then leave it alone. Never write `p.claimed` yourself.
- `K.stick(id, cx, cy, r, {color, base, deadzone})` -> `{x, y, mag, angle, active}` virtual joystick (-1..1; claims its finger; registers a d-pad for automated tests).
- **Modal + inert:** an open `K.sheet` or `K.modal` makes every control drawn OUTSIDE it inert (not tappable, not in the controls map) - no private flags needed. It takes effect the frame after the overlay first draws. `K.inert(fn)` / `K.inert(cond, fn)` draws anything inert on purpose (content scrolled under a bar, an outgoing card). `K.modal(open, fn)` - your own overlay (pause card, results) with the same capture; to animate one OUT, draw `open ? K.modal(true, fn) : K.inert(fn)` until it is gone. `K.isBlocked()`. Raw `K.pointers` are not filtered by modals.
- `K.registerControl(name, x, y, w, h)` - put a custom hit area in the controls map that automated tests read (every frame it is shown; only its part inside K.clip and the screen is listed). `K.uiRect(x, y, w, h)` - mark an area as UI so `K.freeTap` ignores it.

### Controls (immediate mode: call every frame; each draws itself, animates its press state, registers in window.__controls, plays a sound, returns the result)
`{alpha}` fades button iconButton holdButton stick toggle slider segmented chip stepper listRow input navBar tabBar pager dots spark progressRing progressBar bars empty avatar (below 0.3 also inert - a finger resting on a control that fades out loses its tap): `K.button('go', x, y, w, h, 'Go', { alpha: K.stagger(3) })`. Anything else: `K.fade(a, fn)`.
- `K.button(id, x, y, w, h, label, {style:'primary'|'secondary'|'tinted'|'ghost'|'danger'|'glass', icon, color, disabled, role, size, r, iconSize, sfx, alpha})` -> true on tap. `disabled` looks disabled (a ghost stays plate-less) and is left out of automated tests's map.
- `K.iconButton(id, cx, cy, size, icon, {style:'filled'|'tinted'|'plain'|'glass', color, iconColor, fillIcon, badge, disabled, sfx, alpha})` -> true on tap (hit area >= 44).
- `K.holdButton(id, cx, cy, size, icon, {color, label, alpha})` -> true while held (FIRE, gas, charge).
- `K.toggle(id, x, y, value, {color})` -> bool (51x31). `K.slider(id, x, y, w, value, min, max, {step, color, track, sfx, tickEvery})` -> number (drag or tap the track; ticks only under a finger; `K.slider.dragging`). `K.segmented(id, x, y, w, labels, index, {color, track, h})` -> index.
- `K.tabBar(id, [{icon, label, badge, badgeColor}], index, {color, bg, badgeColor})` -> index (bottom, safe area; `K.tabBar.height()` = 58 + K.safe.bottom before it draws). `K.navBar(title, scrollY, {left:{id, icon|label, style, sfx, badge, fillIcon, iconColor, disabled}, right:{...}, sub})` -> tapped side id; iOS large title that collapses as you scroll; content starts at `K.navBar.top(sub)`; clip scrolled content from `K.navBar.bottom()` (the collapsed bar's bottom) - both known before the bar draws.
- `K.scroll(id, x, y, w, h, contentH)` -> offset with momentum + rubber band; draw rows at `y - offset` inside `K.clip(...)` so rows scrolled away cannot be tapped and leave automated tests's map. `K.scrollTo(id, off)`.
- `K.listRow(id, x, y, w, h, {title, sub, icon, iconColor, value, chevron, toggle, r})` -> `{tap, toggle}` (r rounds the pressed highlight to the card).
- `K.sheet(id, open, h, (x, y, w, h, close) => {...}, {modal})` -> open state: `open = K.sheet(id, open, h, fn)`. Close from inside with `close()` or `return false` (assigning your own flag inside fn is overwritten by the return). Swipe-down and a backdrop tap close it. Draw sheets LAST in draw().
- `K.input(id, x, y, w, h, value, {placeholder, type, icon, onEnter, role})` -> text (opens the real keyboard; the field follows the drawn box; code can set the value while it is focused; type 'password' stays masked). `K.blurInputs()`.
- `K.toast(text, {tone:'info'|'good'|'bad'|'warn', icon, ms:2800, y})`. `K.chip(x, y, label, {color, icon, filled, alpha})` -> width; `K.chipWidth(label, {icon})` measures first. `K.progressRing(cx, cy, r, t, {width, color | [c0, c1], track, glow, cap})`. `K.progressBar(x, y, w, h, t, {color, track, r, grad})`.
- `K.pager(id, x, y, w, h, count, (i, px, py, pw, ph) => {...}, {index, gap, r})` -> page index: swipe pages with snap (onboarding, carousels). `K.pagerGo(id, i)`. `K.dots(cx, y, count, index, {color, id})` (give an id when the dots move).
- `K.stepper(id, x, y, value, {min, max, step, show, sfx, limitSfx})` -> value; `show:true` draws [- n +] (128 wide), else [- +] (94). At a limit it plays `limitSfx` ('error'; false = silent) and sets `K.stepper.limit = 'min'|'max'` that frame.
- `K.avatar(cx, cy, r, name, {colors:[c0, c1]})`. `K.spark(values, x, y, w, h, {color, fill, dot, t, min, max, width, smooth})` sparkline/area chart. `K.bars(values, x, y, w, h, {colors:[...], color, labels, values:true|fn, valueRole, valueColor, valueWeight, valueGap, track, highlight, max, gap, r, t})`. `K.shimmer(x, y, w, h, r)` loading skeleton. `K.empty(cx, y, icon, title, body, {color, w})` -> height used; `K.empty.height(body, {w})` -> that height before drawing.

### Storage + errors
- `K.load(key, fallback)`, `K.save(key, value)` - JSON kept by the host for this app, on the phone (at most 1 MB per app).
- Uncaught errors are painted on the canvas automatically; a tap dismisses.

### Hooks: an app's added part (Kit 1.5)
- `K.on('start' | 'draw' | 'tap', fn)` - the way in for an app's ADDED PART: what Juli writes when the person changes a made app by chat
  and no slot can do it ("add a line with the total"). The part is at most 4 KB of code kept with that one app (never in the skeleton);
  it runs after `sketch.js` in its own scope, so it can read the sketch's top-level names and `window.SLOTS`. `'start'` runs once, at the
  first frame after it is added; `'draw'` every frame after the sketch draws, in screen coordinates, inside push/pop; `'tap'` gets
  `{x, y}` for each tap the app did not use. A hook that throws is taken out and reported, and the app goes on. A check runs no hooks.
- A skeleton needs nothing for this, but these help Juli: keep the app's state in clearly named top-level variables (`let st = {...}`),
  leave a little room at the bottom of the main screen, and draw text with `K.text` / `K.num` (p0pc0rn's test runs read the text a frame
  drew, so Juli hears what the screen shows).

### Agents (agentic apps; none of these needs p5, so they also work in an unseen check)
- `const nb = K.notebook('trips', {max: 400})` - the notebook, kept with K.save. An entry is `{id, key, shelf, kind, title, text, data,
  evidence: [{source, at, note}], review, until, at, upd}`. `nb.add(fields)` -> a new entry (shelf `suspected`, or `{shelf: 'grounding'}`).
  `nb.put(key, fields)` adds or updates the entry with your own key; `{shelf: 'suspected'}` brings a dismissed entry back when something
  changed (a confirmed entry keeps its shelf). `nb.get(idOrKey)`, `nb.list(shelf, kind)` (newest change first; null = any), `nb.review()`
  (suspected entries with `review: true`), `nb.confirm(id, fields)` and `nb.dismiss(id)` (the person's yes and no: open app only, they throw
  in a check), `nb.remove(id)`, `nb.prune()` (drops entries past `until`; keeps at most `max`, oldest grounding first), `nb.all`, `nb.size`.
  Keep `data` small: 40 KB an entry, and the whole app keeps at most 1 MB.
- `K.agent({goal, tasks: [{id, every, run, due}], budgetS})` - call it ONCE at the top level of sketch.js (outside setup()); it registers
  `p0.onCheck`. `budgetS`: 20 s unless you say (a live app's check gets 25 s); an agentic app whose tasks ask Juli may use up to 100 s. Each check runs, in order, the tasks whose `every` minutes have passed or whose `due()` returns true (work waiting). `run`
  is `async (ctx) => ({active})` with `ctx = {mode, log(text), left(), first}`: `ctx.mode` is `'check'` in a check (Juli can help) and
  `'run'` in the open app (no Juli); start no new step when `ctx.left()` (seconds) is low; return `{active: true}` while something is
  going on. `K.agent.run(id)` runs one task now (the open app); `K.agent.log(text)`; `K.agent.logs()` -> `[{at, text, n}]`, newest first
  (show them); `K.agent.last(id)`; `K.agent.busy()`.
- `await K.ask(prompt, {json})` - Juli's answer as text, or with `{json: true}` one parsed object (null when she did not answer in JSON).
  Only in a check: in the open app it throws `OPEN_APP`. It also throws when Juli can't answer (not downloaded, busy, too many questions
  this hour): keep the request and try again in the next check, and keep a way to do the job without her.
- `K.facts(text, data)` -> `{ok, missing}`: every number written in `text` appears somewhere in `data`. Leave out Juli's words when `ok` is false.
- Dates (this phone's own day): `K.today()` -> 'YYYY-MM-DD', `K.addDays(day, n)`, `K.daysFrom(a, b)`, `K.isDay(text)`, `K.dayName(day, short)`,
  `K.dayLabel(day)` -> 'Fri Oct 30', `K.calendar(21)` -> a calendar for a prompt (Juli turns "this Friday" into the right date with one).
- `K.json(text)` -> the first JSON object in a reply, or null.
- `K.review(id, x, y, w, entries, {yes, no, ask, color, extraH, extra, max})` -> `{h, act}`: the review queue's cards (title, text, evidence,
  buttons). `yes(e)` / `no(e)` -> a button label or null (defaults 'Confirm' and 'Not this'); `ask(e)` -> true for an Ask button; `color(e)` ->
  the card's stripe; `extraH(e, w)` + `extra(e, x, y, w)` draw your own choices inside a card. `act = {entry, action: 'yes' | 'no' | 'ask'}`
  in the frame a button was tapped, else null.

### The Game Kit (`K.game`: games)
Part of the Kit, in every app (`K.game.version` '1.0'). A game = its RULES + `K.game.match` + its drawing; the Game Kit does the rest.
Its pure parts (boards, layout, search, the match's rules) work without p5. Players: 1 = the person, 2 = Juli.
```js
const M = K.game.match({ key: 'mygame.v1', first: 'take turns',
  fresh: () => newBoard(), legal: (b, who) => moves(b, who), apply: (b, m, who) => ({ board: next(b, m, who), last: m }),
  result: (b, m, who) => (wins(b, who) ? { who, cells: line(b) } : full(b) ? { who: 0, cells: [] } : null),
  animate: (m, who) => myDropAnimation(m, who),   // a promise: the match waits for it
  juli: { ask: async (b, legal) => ({ about: boardText(b), options: legal.map((m) => ({ move: m, label: nameOf(m) })),   // EVERY legal move
                                       hint: await myRead(b, legal), skill: 'play-my-game' }) } });   // K.choose asks her: her answer is her move
M.on('stuck', (s) => showAskAgain(s.kind));   // no answer from her model: say so, offer "Ask Juli again" (M.askAgain())
function setup() { K.setup({ mode: 'dark' }); M.start(); K.scene('play', drawPlay); }   // a saved game goes on; on Juli's turn she is asked
```
- **The match:** `M.play(move)` (the person's move; false when it is not theirs to make), `M.canPlay()`, `M.newGame()`, `M.thinking` (while Juli chooses: show it), `M.stuck` (`{kind, why}`: her model gave no move; `M.askAgain()` asks once more), `M.animating`, `M.phase`, `M.st` = `{board, turn, over: null | {who, cells}, moves, games, score: {you, juli, draw}, streak: {who, n}, by: 'juli' | 'forced', keep}` (saved after every move; `keep` = your own values that last across games, such as an unlock or a chosen opponent: `tally(st, who)` in the match's config updates them at the end of each game, in the same save as the score), `M.stats` (`{asked, juli, forced, reasked, stuck}`), `M.on('new' | 'resume' | 'move' | 'think' | 'decided' | 'stuck' | 'turn' | 'end', fn)`. Juli's model makes every move: her answer is her move; an answer naming no option is asked again (`juli.tries`, 3 in all); when she gives none the match is stuck, never moved for her (`kind`: 'stopped', 'unreadable', 'busy', 'missing', 'nobig', 'nojuli', 'notallowed', 'ratelimit'). `juli.big()` -> true: Juli with the Bigger brain answers (`K.choose(..., {big: true})`; `await K.juliModels()` -> `{juli, big}` says whether it is downloaded and on: offer it only then; when it is off the match is stuck with 'nobig', never answered by her own model instead). Only a move that is the ONLY legal one is played as it is (by 'forced'). `M.newGame({clear: () => myClearOut()})`: the game that was on stops at once (Juli's turn, the end of a move still animating), your clear-out plays (`M.clearing` meanwhile), then the new game starts; a New game button may be pressed at any moment. A timer started in `'end'` (the card after a second) checks the game is still the same: `const n = M.st.games;` ... `if (M.st.over && M.st.games === n) open = true`. `juli.ask(board, legal)` may be async (the game's read); `juli.minMs` (700): her turn lasts at least this, so the move reads as hers; `juli.beforeMove(move)`: a promise before her move lands (her ghost glides over). `await K.game.juliPick({about, options, hint, skill}, {tries, big})` -> `{index, by: 'juli', big}` or `{index: -1, by: 'none', kind, why}` is the same ask on its own (a question still on its way from a dropped turn is let finish first, so the next one reaches her). `await K.game.work((ms) => job.step(ms), {sliceMs: 10, wallMs})`: long work (a deep read) in slices, the frames drawn between them.
- **Boards** (`b[r][c]`, the top row first): `K.game.grid(rows, cols, fill)`, `copy(b)`, `inside(b, r, c)`, `each(b, fn(v, r, c))`, `count(b, v)`, `full(b)`, `lineAt(b, r, c, n)` -> `{who, cells}` (n or more in a row through a cell), `findLine(b, n)`, `colName(c)` -> 'A', `cellName(r, c, rows)` -> 'A1' (row 1 at the bottom), `text(b, {symbols})` (the board for Juli).
- **Layout + aiming:** `const L = K.game.layout({rows, cols, x, y, w, h, pad, maxCell})` -> square cells centred in the box: `L.cell`, `L.cx(c)`, `L.cy(r)`, `L.rect(r, c)`, `L.col(px)`, `L.at(px, py)`. Every frame: `const a = K.game.aim(id, L, {mode: 'column' | 'cell', enabled: M.canPlay(), legal(t), top, bottom})` -> `a.hover` (the column, or `{r, c}`, under a finger that is down: light it and show a ghost piece), `a.drop` (released there this frame: `M.play(...)`), `a.press`. Whole columns are the targets, from one cell above the board; a cancelled touch never drops; arrow keys + Enter work too; the targets are in the controls map ('column D', 'cell B2').
- **Art, drawn once and cached** (cheap every frame): `K.game.backdrop({top, bottom, glows: [{x, y, r, color, a}], vignette})` (x, y, r: parts of the screen, 0..1); `K.game.board(L, {style, color, color2, hole})`: `'holes'` = a moulded face with holes cut through (draw the pieces FIRST: they show through, and a falling piece passes behind the face), `'squares'` = chess and checkers, `'lines'` = noughts and crosses and go (draw pieces after); `K.game.piece(cx, cy, r, color, {style: 'disc' | 'ball' | 'flat', shadow, alpha, sx, sy})` = a glossy, lit piece; `K.game.glow(x, y, r, color, a)` = a soft light added on top; your own: `K.game.sprite(key, w, h, (ctx, w, h) => {...})` + `K.game.blit(sprite, x, y, w, h, {alpha, add, rot, sx, sy})`. Never blur or shadow something that moves (60 fps on a phone).
- **Motion** (the game's clock; the Game Kit steps it every frame): `K.game.timeline()` -> `.tween(obj, {prop: to}, ms, {ease, at})`, `.call(fn, {at})`, `.wait(ms)`, `.play()` -> a promise, `.skip()`; `at` = ms from its start, `'<'` (with the step before) or `'+=200'`. `K.game.fall({from, to, g, bounce, onHit(speed, n, strength), onDone})` -> `{y, squash, promise}`: a drop with gravity that bounces (play the clack and the jolt in `onHit`). `K.game.jolt(key, px)` + `K.game.joltOf(key)` -> `{x, y}`: a knock that springs back (`push(); translate(j.x, j.y); ...; pop();`). `K.game.reduced` = the phone asks for less motion (no bounce, no shake, quick moves, a little confetti; the Game Kit's own parts follow it). `K.game.hot(ms)` = keep 60 fps for your own animation (the Kit drops to 30 fps when nothing moves).
- **Effects:** `K.game.confetti(x, y, {n, colors, power, angle, spread})` (paper that flutters down), `K.game.sparks(x, y, {n, color})`, `K.game.ring(x, y, {r0, r1, color})`; draw them with `K.game.fx()` once a frame, above the board.
- **Sound** (synthesised: no files; silent until the person's first tap; a mute that is remembered): `K.game.sound.play(name, {vel, pitch})`: `clack` (a disc landing, vel 0..1), `place`, `tap`, `tick`, `turn`, `start`, `clear`, `win`, `lose`, `draw`, `error`. `K.game.sound.on`, `.toggle()`; `K.game.soundButton(id, cx, cy, size)` draws the speaker button.
- **Search** (two-player games): `await K.game.search({state, who, moves(s, who), do(s, m, who) -> undo, undo(s, m, undo, who), won(s, m, undo, who), draw(s), score(s, who)}, {depth, timeMs})` -> `{move, score, ranked: [{move, score}] (best first), depth}`. Alpha-beta, one level deeper while time lasts, frames keep flowing; `state` is searched IN PLACE (pass `K.game.copy(board)`). `K.game.searchSync(...)` for small depths; a win scores `K.game.WIN`. The search reads the board for the hint; it never chooses for Juli.
- **Faces and cards:** `K.game.avatar(cx, cy, r, {mood: 'idle' | 'thinking' | 'happy' | 'sad'})` (Juli: her bubble on violet; thinking = waving dots and a turning ring); `K.game.player(id, x, y, w, h, {name, score, color, active, juli, mood, align})` (a player's card: a new point pops); `K.game.results(id, {open, outcome: 'win' | 'lose' | 'draw', title, sub, color, score, prev, names, colors, streak, note, progress})` -> `'again' | 'board'` (the end card: modal, a spring from below, the score rolls up from `prev`, a short note line; `progress: {n, of, text}` = a run toward something to earn, as pips and a line: "3 in a row: 7 more to unlock a new opponent"). Something earned: `K.game.unlock(id, {open, title, sub, icon, action, again})` -> `'action' | 'again'` (the celebration card: a gold badge with turning rays, the action, e.g. 'Choose your opponent') with `K.game.celebrate()` (the big burst of confetti) when it opens; keep what was earned in `M.st.keep`.
- **Accessibility:** `K.game.a11y.say(text)` (a screen reader reads it: "Juli dropped a disc in column C"), `K.game.a11y.controls([{id, label, disabled, press}])` every frame (buttons a screen reader or a keyboard can press, hidden from the eye), `K.game.a11y.title(text)`. Touch targets: whole columns or cells, 44 points or more.
- Automated tests read `window.__game` (`{phase, turn, over, moves, games, by, stuck, score, stats, fps}`).

### Rules that still apply
Only `K` is global from the kit: never declare a top-level name `K`, never read or write `K._` internals. No p5 name at the top level
of sketch.js: p5 starts after your script and writes its own functions and values onto `window`, so a top-level `function` or `var`
named like one of them (`save`, `text`, `rect`, `fill`, `stroke`, `image`, `color`, `random`, `noise`, `map`, `print`, `frameRate`,
`loadImage`, `createCanvas`, `remove`, `width`, ...) becomes p5's (a `function save()` turns into p5's download of the canvas: the app
never keeps anything), and a top-level `let` / `const` / `class` hides p5's own from your code and the Kit's. Name yours otherwise
(`saveState`, `gameMap`, `label`); names inside functions and objects are fine. p0pc0rn's check refuses a top-level `function` or
`var` with a p5 name, and a `let` / `const` the Kit needs, and names the word. Loads (loadImage/loadSound/loadJSON)
only in preload(). A hex colour never takes a separate alpha: `K.alpha('#ff0000', 0.5)`. Online data only through `p0.fetch`, with try/catch and an offline state.

---

## A complete example bundle

This is a real, tested skeleton that comes with p0pc0rn ("Daily Counter", non-agentic). Yours should be this complete.
The Apps tab's Weather Alerts and Wildfire Watch are live non-agentic apps (a check on a timer with `p0.onCheck`, `p0.chat.post` and `p0.fetch`);
Trip Watch, next, is the agentic example.

```json
{
 "p0skel": 1,
 "manifest": {
  "id": "daily-counter",
  "name": "Daily Counter",
  "description": "Counts something toward a daily goal with a big progress ring, a +step button, undo and the last 7 days. Fits: water, pages read, push-ups, breaks, cups of tea, any daily count.",
  "category": "non-agentic",
  "version": "1.0",
  "author": "p0pc0rn",
  "runtime": "p5-kit@1",
  "entry": "sketch.js",
  "permissions": {
   "storage": true,
   "chat.post": true,
   "location": "none"
  },
  "triggers": [
   {
    "type": "manual"
   }
  ],
  "slots": {
   "title": {
    "type": "string",
    "max": 22,
    "required": true,
    "desc": "large title, e.g. Water"
   },
   "accent": {
    "type": "color",
    "required": true,
    "desc": "#rrggbb"
   },
   "goal": {
    "type": "int",
    "min": 1,
    "max": 100,
    "required": true,
    "desc": "the daily goal"
   },
   "step": {
    "type": "int",
    "min": 1,
    "max": 20,
    "required": true,
    "desc": "how much one tap adds"
   },
   "unit": {
    "type": "string",
    "max": 14,
    "required": true,
    "desc": "plural unit, e.g. glasses"
   },
   "icon": {
    "type": "icon",
    "required": true
   },
   "cheers": {
    "type": "array",
    "min": 2,
    "max": 5,
    "required": true,
    "item": "string:40",
    "desc": "short encouragements"
   },
   "done_text": {
    "type": "string",
    "max": 40,
    "required": true,
    "desc": "posted to the chat when the goal is reached"
   }
  }
 },
 "slots_default": {
  "title": "Water",
  "accent": "#32ade6",
  "goal": 8,
  "step": 1,
  "unit": "glasses",
  "icon": "drop",
  "cheers": [
   "Nice!",
   "Keep going",
   "Halfway there",
   "Almost!"
  ],
  "done_text": "Goal reached for today"
 },
 "notes_for_juli": "Pick a short title (1-2 words) and a plural unit that matches the thing being counted. goal = a realistic daily number for that thing (water 8 glasses, pages 20, push-ups 50 with step 10). step = how many one tap adds (1 unless the person counts in sets). Choose one icon that shows the thing (drop for water, book for pages, flame for workouts, timer for breaks). cheers = 3-4 short, friendly lines, no emoji. done_text = one short sentence for the moment the goal is reached.\n",
 "files": {
  "sketch.js": "/* DAILY COUNTER - count something toward a daily goal (water, pages, push-ups, breaks). p0pc0rn example skeleton (p0pc0rn Kit).\n   Slots come from window.SLOTS (the host writes them); every slot has a default, so the app also runs with no slots at all.\n   Host features (window.p0) are optional: without them the app still works (it just skips posting to the chat). */\n\n// ===== SLOTS =====\nconst SL = window.SLOTS || {};\nconst TITLE = String(SL.title || 'Water').slice(0, 22);\nconst ACCENT = /^#[0-9a-fA-F]{6}$/.test(SL.accent || '') ? SL.accent : '#32ade6';\nconst GOAL = Math.max(1, Math.min(100, Math.round(+SL.goal || 8)));\nconst STEP = Math.max(1, Math.min(GOAL, Math.round(+SL.step || 1)));\nconst UNIT = String(SL.unit || 'glasses').slice(0, 14);\nconst ICON = typeof SL.icon === 'string' && SL.icon ? SL.icon : 'drop';\nconst CHEERS = Array.isArray(SL.cheers) && SL.cheers.length ? SL.cheers.slice(0, 5).map((s) => String(s).slice(0, 40)) : ['Nice!', 'Keep going', 'Halfway there', 'Almost!'];\nconst DONE_TEXT = String(SL.done_text || 'Goal reached for today').slice(0, 40);\n\n// ===== STATE (per day, saved) =====\nconst dayKey = () => new Date().toISOString().slice(0, 10);\nlet st = { day: dayKey(), count: 0, history: [] };   // history = the last 7 finished days' counts\n\nfunction setup() {\n  K.setup({ mode: 'light', accent: ACCENT });\n  const saved = K.load('counter.v1', null);\n  if (saved && saved.day) st = saved;\n  rollover();\n  K.scene('main', drawMain);\n}\n\nfunction rollover() {\n  if (st.day === dayKey()) return;\n  st.history = st.history.concat([st.count]).slice(-7);\n  st.day = dayKey(); st.count = 0; K.save('counter.v1', st);\n}\n\nfunction add(n) {\n  const before = st.count;\n  st.count = Math.max(0, st.count + n);\n  K.save('counter.v1', st);\n  if (n > 0) {\n    K.sfx(st.count >= GOAL && before < GOAL ? 'win' : 'pop');\n    if (st.count >= GOAL && before < GOAL) {\n      K.burst(K.W / 2, K.H * 0.36, { n: 40, colors: [ACCENT, K.C.good], shape: 'confetti' });\n      if (window.p0 && window.p0.chat) window.p0.chat.post({ title: TITLE, severity: 'info', text: DONE_TEXT + ' (' + st.count + ' ' + UNIT + ').' });\n    } else K.toast(CHEERS[st.count % CHEERS.length], { tone: 'good', icon: ICON, ms: 1200 });\n  }\n}\n\nfunction drawMain() {\n  K.backdrop({ top: K.C.bg, bottom: K.lighten(ACCENT, 0.85) });\n  K.navBar(TITLE, 0, { sub: K.fmt.date(Date.now()) });\n  const cx = K.W / 2, cy = K.H * 0.36, r = Math.min(K.W * 0.32, 130);\n  const t = Math.min(1, K.count('ring', st.count, 500) / GOAL);\n  K.progressRing(cx, cy, r, t, { width: 18, color: [ACCENT, K.lighten(ACCENT, 0.3)], glow: st.count >= GOAL });\n  K.icon(ICON, cx, cy - 34, 34, ACCENT, { fill: true });\n  K.num(String(st.count), cx, cy + 18, 'display', K.C.text, { align: 'center' });\n  K.text('of ' + GOAL + ' ' + UNIT, cx, cy + 46, 'subhead', K.C.text2, { align: 'center' });\n  const bw = K.W - 2 * K.S.l, by = cy + r + 40;\n  if (K.button('add', K.S.l, by, bw, 56, '+' + STEP + ' ' + UNIT, { style: 'primary', icon: 'plus', alpha: K.stagger(1) })) add(STEP);\n  if (K.button('undo', K.S.l, by + 68, bw, 48, 'Undo', { style: 'secondary', icon: 'undo', alpha: K.stagger(2), disabled: st.count === 0 })) add(-STEP);\n  const hist = st.history.length ? st.history : [0];\n  K.text('LAST 7 DAYS', K.S.l, by + 150, 'label', K.C.text2);\n  K.bars(hist.concat([st.count]), K.S.l, by + 162, bw, 80, { color: ACCENT, highlight: hist.length, max: Math.max(GOAL, ...hist, st.count), gap: 8, r: 4 });\n}\n\nfunction draw() { rollover(); K.render(); }\n"
 }
}
```

---

## A complete agentic example: Trip Watch

This is a real, tested agentic skeleton that comes with p0pc0rn. Copy its shape for any agentic app:
- **Goal:** `manifest.goal`.
- **Notebook:** `K.notebook('trips')`: your trips (confirmed), each trip's forecast (grounding), flags, Juli's lines, trip
  suggestions and the notes and questions waiting for her (suspected), and what you waved off (dismissed).
- **Tasks:** `K.agent` at the top level with two idle tasks, `watch` and `tidy`. `watch` has a `due()`, so a note you leave is read in
  the very next check.
- **The open app never calls Juli.** It saves the person's words ("camping at Zion this Friday to Sunday") or a question. In the next
  check, `K.ask(prompt, {json: true})` turns the words into a place and dates, which the person then confirms, and a notice in Juli's
  chat says so.
- **Reach:** three sources plus Juli, with `K.facts` checking everything Juli writes.
- **Review queue:** `K.review` with the evidence, plus what waits for Juli and `K.agent.logs()` on screen.
- **Without Juli:** "Pick it myself" adds a trip by hand.

To make a different agentic app, keep that structure and change what it watches, what it keeps and what it raises.

```json
{
 "p0skel": 1,
 "manifest": {
  "id": "trip-watch",
  "name": "Trip Watch",
  "description": "Watches the US forecast and weather alerts for trips you add (a place and dates), re-checks as they change, and flags wind, rain, heat, cold or alerts for your eye. Juli writes one line per trip and answers questions. US only. Fits: hikes, camping, road trips, outdoor events.",
  "category": "agentic",
  "goal": "Keep an eye on the weather for my trips and tell me what changed",
  "version": "1.0",
  "author": "p0pc0rn",
  "runtime": "p5-kit@1",
  "entry": "sketch.js",
  "permissions": {
   "storage": true,
   "online": [
    "weather.nws",
    "alerts.nws",
    "geocode.openmeteo"
   ],
   "juli": [
    "ask"
   ],
   "chat.post": true,
   "location": "place"
  },
  "triggers": [
   {
    "type": "on-open"
   },
   {
    "type": "interval",
    "minMinutes": 90,
    "calmMinutes": 360
   }
  ],
  "slots": {
   "title": {
    "type": "string",
    "max": 22,
    "required": true,
    "desc": "large title, e.g. Trip Watch"
   },
   "accent": {
    "type": "color",
    "required": true,
    "desc": "#rrggbb"
   },
   "trip_word": {
    "type": "string",
    "max": 14,
    "required": true,
    "desc": "what the person calls one plan, singular: trip, hike, camping trip, game, wedding"
   },
   "wind_mph": {
    "type": "int",
    "min": 10,
    "max": 60,
    "required": true,
    "desc": "flag wind or gusts at or above this (mph)"
   },
   "rain_pct": {
    "type": "int",
    "min": 20,
    "max": 100,
    "required": true,
    "desc": "flag rain or snow when its chance is at or above this (%)"
   },
   "hot_f": {
    "type": "int",
    "min": 70,
    "max": 120,
    "required": true,
    "desc": "flag a high at or above this (F)"
   },
   "cold_f": {
    "type": "int",
    "min": -20,
    "max": 50,
    "required": true,
    "desc": "flag a low at or below this (F)"
   },
   "alert_level": {
    "type": "enum",
    "enum": [
     "warnings",
     "watches",
     "all"
    ],
    "required": true,
    "desc": "which NWS alerts to raise: warnings only, warnings and watches, or all"
   },
   "example": {
    "type": "string",
    "max": 60,
    "required": false,
    "desc": "a sample plan shown in the empty add box, in the words of the request"
   }
  }
 },
 "slots_default": {
  "title": "Trip Watch",
  "accent": "#30b0c7",
  "trip_word": "trip",
  "wind_mph": 25,
  "rain_pct": 50,
  "hot_f": 90,
  "cold_f": 32,
  "alert_level": "watches"
 },
 "notes_for_juli": "title: 1-3 words for what is watched (Trip Watch, Hike Weather, Game Day Watch). trip_word: what the person calls one plan, singular. Set the lines for the activity: a family picnic wind 20, rain 40; a ridge hike wind 25, hot 85; a ski trip cold -10, wind 30; a beach day hot 95, rain 40; otherwise keep the starting values. alert_level: warnings when the person wants only serious ones, all for everything, else watches. example: one short plan in the words of the request, with a day name, never a date. Never put places, dates or readings in slots: the person adds trips and the app reads the forecast.",
 "files": {
  "sketch.js": "/* TRIP WATCH - an agentic p0pc0rn app, and the Skeleton Guide's agentic example. Tell it about a trip (\"camping at Zion this Friday to\n   Sunday\") and close it: Juli turns your words into a place and dates in its next check, and a notice in her chat asks you to confirm\n   them. Then, while p0pc0rn is open, it watches the US National Weather Service forecast and alerts for the trip's days, re-checks as\n   they change, and brings what needs your eye to its review queue (with one notice in Juli's chat): strong wind, rain or snow, heat,\n   cold, or an alert. Juli writes one line per trip from the forecast's own numbers (a line with any other number is left out, never\n   shown) and answers your questions about a trip from the same forecast.\n   Juli never works while the app is open: the phone's memory goes to the open app. The open app saves what you ask for; her work\n   happens in the checks, the first one right after you close the app.\n   The five parts of an agentic app (Skeleton Guide, \"Two kinds of app\"):\n     goal      manifest.goal: keep an eye on the weather for my trips and tell me what changed\n     notebook  K.notebook('trips'): confirmed = your trips; suspected = flags, Juli's lines and answers, trip suggestions (the review queue),\n               your notes and questions waiting for Juli; grounding = each trip's forecast (NWS, with when it came); dismissed = what you\n               waved off (raised again only if it gets worse)\n     tasks     active (the open app): leave Juli a trip note or a question, pick a trip yourself, confirm. idle (K.agent): 'watch' reads your\n               notes and questions with Juli, fetches, compares, flags and sums up; 'tidy' lets finished trips go\n     reach     weather.nws, alerts.nws, geocode.openmeteo, and Juli (permissions.juli [\"ask\"])\n     review    K.review(): flags and trip suggestions with their evidence. Only you add a trip.\n   US only (NWS). Everything it keeps stays on this phone. */\n\n// ===== SLOTS =====\nconst SL = window.SLOTS || {};\nconst sl = (v, n, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : d);\nconst si = (v, lo, hi, d) => (v != null && v !== '' && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);\nconst TITLE = sl(SL.title, 22, 'Trip Watch');\nconst ACCENT = /^#[0-9a-fA-F]{6}$/.test(SL.accent || '') ? SL.accent : '#30b0c7';\nconst WORD = sl(SL.trip_word, 14, 'trip').toLowerCase();\nconst WIND = si(SL.wind_mph, 10, 60, 25), RAIN = si(SL.rain_pct, 20, 100, 50), HOT = si(SL.hot_f, 70, 120, 90), COLD = si(SL.cold_f, -20, 50, 32);\nconst LEVELS = ['warnings', 'watches', 'all'], LEVEL = LEVELS.includes(SL.alert_level) ? SL.alert_level : 'watches';\nconst EXAMPLE = sl(SL.example, 60, 'Hiking at Zion this Saturday');\nconst cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);\nconst plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');\n\n// ===== THE NOTEBOOK (on this phone) =====\nconst nb = K.notebook('trips', { max: 300 });\nconst trips = () => nb.list('confirmed', 'trip').filter((e) => e.data && e.data.place && K.isDay(e.data.start)).sort((a, b) => (a.data.start < b.data.start ? -1 : 1));\nconst forTrip = (id, kind) => nb.all.filter((e) => e.data && e.data.trip === id && (!kind || e.kind === kind));\nconst waiting = () => nb.all.filter((e) => e.shelf === 'suspected' && (e.kind === 'note' || e.kind === 'question' || e.kind === 'note!')).sort((a, b) => a.at - b.at);\nconst placeName = (p) => [p.name, p.region].filter(Boolean).join(', ');\nconst dates = (t) => (t.end && t.end !== t.start ? K.dayLabel(t.start) + ' – ' + K.dayLabel(t.end) : K.dayLabel(t.start));\nconst whatOf = (t) => sl(t.what, 30, WORD);\nfunction badge() { if (window.p0) p0.app.badge(nb.review().length).catch(() => {}); }\nasync function post(n, ctx) {   // a short notice in Juli's chat, only from a check (in the open app you see it here)\n  if (ctx.mode !== 'check' || !window.p0) return;\n  try { await p0.chat.post(n); } catch (e) { /* too many this hour: it still shows in the app */ }\n}\n\n// ===== READING THE FORECAST (NWS: a day and a night period for about 7 days) =====\nconst dayOf = (p) => String(p.start || '').slice(0, 10);   // the trip place's own date (NWS gives its local time)\nconst inTrip = (t, p) => { const d = dayOf(p); return d >= t.start && d <= t.end; };\nconst windOf = (p) => { const n = (String(p.wind || '').match(/\\d+/g) || []).map(Number), g = /gusts? (?:as high as |up to )?(\\d+) mph/i.exec(p.detail || ''); return { mph: n.length ? Math.max(...n) : 0, gust: g ? +g[1] : 0 }; };\nconst tempF = (p) => (p.unit === 'C' ? Math.round(p.temp * 9 / 5 + 32) : +p.temp);\nconst wet = (p) => /rain|shower|snow|sleet|thunder|storm/i.test(p.short || '');\nconst sevOf = (a) => (a.severity === 'Extreme' || a.severity === 'Severe' || /warning|emergency/i.test(a.event) ? 'warning' : /watch/i.test(a.event) ? 'watch' : 'info');\nconst alertWorth = (a) => { const s = sevOf(a); return s === 'warning' || (s === 'watch' && LEVEL !== 'warnings') || LEVEL === 'all'; };\nfunction alertInTrip(a, t) {   // an alert counts when its time overlaps the trip's days (no end time = still on)\n  const from = Date.parse(t.start + 'T00:00:00'), to = Date.parse(K.addDays(t.end, 1) + 'T00:00:00');\n  return (Date.parse(a.effective) || 0) < to && (Date.parse(a.ends) || Infinity) > from;\n}\n/** what in a trip's forecast needs the person's eye: [{key, type, value, sev, text}]; value = the reading that crossed the line */\nfunction flagsFor(tr, fc) {\n  const out = [];\n  for (const p of fc.periods) {\n    const d = dayOf(p) + (p.day ? '' : 'n'), w = windOf(p), top = Math.max(w.mph, w.gust), f = tempF(p);\n    if (top >= WIND) out.push({ type: 'wind', day: d, value: top, sev: top >= WIND + 15 ? 'warning' : 'watch', text: `${p.name}: wind ${p.wind}${w.gust ? ', gusts to ' + w.gust + ' mph' : ''}` });\n    if (wet(p) && (p.pop != null ? p.pop >= RAIN : /likely|heavy/i.test(p.short || ''))) out.push({ type: 'wet', day: d, value: p.pop != null ? p.pop : 0, sev: 'watch', text: `${p.name}: ${p.short}${p.pop != null ? ' (' + p.pop + '%)' : ''}` });\n    if (p.day && f >= HOT) out.push({ type: 'hot', day: d, value: f, sev: f >= HOT + 10 ? 'warning' : 'watch', text: `${p.name}: high ${p.temp}°${p.unit}` });\n    if (!p.day && f <= COLD) out.push({ type: 'cold', day: d, value: -f, sev: f <= COLD - 15 ? 'warning' : 'watch', text: `${p.name}: low ${p.temp}°${p.unit}` });\n  }\n  for (const a of fc.alerts) if (alertWorth(a)) out.push({ type: 'alert', day: String(a.id).slice(-60), value: 0, sev: sevOf(a), text: `${a.event}: ${a.headline || a.area}`.slice(0, 300) });\n  return out.map((f) => Object.assign(f, { key: `flag:${tr.id}:${f.type}:${f.day}` }));\n}\n// a flag the person waved off comes back only when it is clearly worse (alerts: each one once)\nconst worse = (f, was) => f.type !== 'alert' && !!was && f.value >= (was.value || 0) + (f.type === 'wind' ? 10 : f.type === 'wet' ? 20 : 5);\nfunction forecastText(fc) {\n  const ps = fc.periods.map((p) => `- ${p.name} (${dayOf(p)}): ${p.temp}°${p.unit}, wind ${p.wind}${p.pop != null ? ', ' + p.pop + '% chance of rain or snow' : ''}, ${p.short}`).join('\\n');\n  const al = fc.alerts.length ? fc.alerts.map((a) => `- ${a.event}: ${a.headline || a.area}`).join('\\n') : '- none';\n  return `The US National Weather Service forecast for those days:\\n${ps || '- not out yet'}\\nActive alerts:\\n${al}`;\n}\nconst notIn = (m) => `${m.join(', ')} ${m.length > 1 ? 'are' : 'is'} not in the forecast`;\nconst tripLine = (t) => `A ${whatOf(t)} at ${placeName(t.place)}, ${t.start}${t.end !== t.start ? ' to ' + t.end : ''}.`;\n\n// ===== YOUR WORDS -> A TRIP (Juli, in a check) =====\nfunction nextDom(n) { for (let i = 1; i <= 62; i++) { const d = K.addDays(K.today(), i); if (+d.slice(8) === n) return d; } return K.addDays(K.today(), 10); }\nfunction nextWeekend() { const dow = new Date().getDay(), sat = K.addDays(K.today(), (dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow) + 7); return [sat, K.addDays(sat, 1)]; }   // the weekend after this one\nconst STATES = ('AL Alabama AK Alaska AZ Arizona AR Arkansas CA California CO Colorado CT Connecticut DE Delaware FL Florida GA Georgia HI Hawaii ID Idaho IL Illinois IN Indiana IA Iowa KS Kansas KY Kentucky '\n  + 'LA Louisiana ME Maine MD Maryland MA Massachusetts MI Michigan MN Minnesota MS Mississippi MO Missouri MT Montana NE Nebraska NV Nevada NH New_Hampshire NJ New_Jersey NM New_Mexico NY New_York '\n  + 'NC North_Carolina ND North_Dakota OH Ohio OK Oklahoma OR Oregon PA Pennsylvania RI Rhode_Island SC South_Carolina SD South_Dakota TN Tennessee TX Texas UT Utah VT Vermont VA Virginia WA Washington '\n  + 'WV West_Virginia WI Wisconsin WY Wyoming DC District_of_Columbia').split(' ');\nconst stateName = (x) => { x = String(x || '').trim(); const i = STATES.indexOf(x.toUpperCase()); return i >= 0 && i % 2 === 0 ? STATES[i + 1].replace(/_/g, ' ') : x; };   // 'GA' -> 'Georgia'\nfunction tripPrompt(note) {\n  const d3 = nextDom(3), [sat, sun] = nextWeekend();\n  return 'Turn the note into a trip for a weather app.\\n' + K.calendar(21) + '\\n' +\n    '\"This <day>\" = the first such day after today; \"this weekend\" = the coming Saturday and Sunday (this one if today is a weekend day); \"next weekend\" = the weekend after that; \"for N days\" counts the first day; one day = the same start and end.\\n' +\n    'Reply with ONE JSON object and nothing else: {\"place\": \"town or park name only\", \"region\": \"US state if said or known\", \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\", \"what\": \"1-3 words: hike, camping, wedding...\"}\\n' +\n    'If the note has no place or no future date, reply {\"none\": \"what is missing\"}.\\n' +\n    'Examples:\\n' +\n    `We hike Yosemite on the 3rd -> {\"place\": \"Yosemite\", \"region\": \"California\", \"start\": \"${d3}\", \"end\": \"${d3}\", \"what\": \"hike\"}\\n` +\n    `Camping at Lake Tahoe next weekend -> {\"place\": \"Lake Tahoe\", \"region\": \"California\", \"start\": \"${sat}\", \"end\": \"${sun}\", \"what\": \"camping\"}\\n` +\n    'Our Zion trip last year was great -> {\"none\": \"a past trip\"}\\n\\n' +\n    'Note: ' + note;\n}\n/** Juli reads a note: {trip: {what, start, end, places}} or {why}; throws when Juli can't answer */\nasync function readTrip(note) {\n  const r = await K.ask(tripPrompt(note), { json: true });\n  if (!r || r.none || typeof r.place !== 'string' || !r.place.trim()) return { why: r && r.none ? cap(String(r.none).slice(0, 60)) : \"Juli couldn't find a place and a date in it\" };\n  const today = K.today();\n  let start = K.isDay(r.start) ? r.start : null, end = K.isDay(r.end) && r.end >= (start || '') ? r.end : start;\n  // your own words win over Juli's arithmetic in the plain cases: \"today\", \"tomorrow\", \"on the 3rd\" (no month named)\n  const low = note.toLowerCase(), named = /\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b/.test(low), nth = /\\b(\\d{1,2})(?:st|nd|rd|th)\\b/.exec(low);\n  const plain = /\\btoday\\b/.test(low) ? today : /\\btomorrow\\b/.test(low) ? K.addDays(today, 1) : nth && !named && +nth[1] >= 1 && +nth[1] <= 31 ? nextDom(+nth[1]) : null;\n  if (plain && start && plain !== start) { end = K.addDays(plain, Math.max(0, K.daysFrom(start, end))); start = plain; }\n  if (!start) return { why: 'Say when it is, like \"this Saturday\"' };\n  if (end < today) return { why: 'That date has passed' };\n  if (start < today) start = today;\n  if (K.daysFrom(start, end) > 13) end = K.addDays(start, 13);\n  let places;\n  try { places = ((await p0.fetch('geocode.openmeteo', { name: String(r.place).slice(0, 60) })).results || []).filter((x) => x.cc === 'US'); }\n  catch (e) { throw Object.assign(new Error(\"couldn't reach the place search\"), { code: 'OFFLINE' }); }   // the note waits for the next check\n  const rg = stateName(r.region).toLowerCase(), same = (x) => !!rg && (x.region || '').toLowerCase() === rg;\n  places = places.filter(same).concat(places.filter((x) => !same(x))).slice(0, 3);\n  if (!places.length) return { why: `No US place called ${String(r.place).slice(0, 30)}` };\n  return { trip: { what: sl(r.what, 30, ''), start, end, places } };\n}\n\n// ===== IDLE TASK 1: watch (the host runs it while p0pc0rn is open, first right after you close the app; the open app runs it too, without Juli) =====\nasync function watch(ctx) {\n  const juli = ctx.mode === 'check';   // Juli works only in a check: the open app keeps the phone's memory\n  if (juli) await readNotes(ctx);\n  const today = K.today(), list = trips().filter((tr) => tr.data.end >= today), offline = new Set(); let active = false, fresh = 0, looked = 0;\n  for (const tr of list) {\n    const t = tr.data, inDays = K.daysFrom(today, t.start);\n    if (inDays > 6) continue;   // not in the forecast yet (NWS looks about 7 days ahead)\n    if (ctx.left() < 15) break;\n    let w, al;\n    try { [w, al] = await Promise.all([p0.fetch('weather.nws', { lat: t.place.lat, lon: t.place.lon }), p0.fetch('alerts.nws', { lat: t.place.lat, lon: t.place.lon })]); }\n    catch (e) { offline.add(tr.id); ctx.log(`Couldn't reach the weather service for ${t.place.name}`); continue; }\n    looked++;\n    const fc = { periods: (w.periods || []).filter((p) => inTrip(t, p)), alerts: (al.alerts || []).filter((a) => alertInTrip(a, t)).slice(0, 6), at: w.fetchedAt || Date.now() };\n    const sig = JSON.stringify([fc.periods.map((p) => [p.name, p.temp, p.wind, p.pop, p.short, p.detail]), fc.alerts.map((a) => a.id)]);\n    const old = nb.get('fc:' + tr.id), changed = !old || !old.data || old.data.sig !== sig || !!(old.data && old.data.unsummed);\n    // flags: new or worse ones go to the review queue (and, unseen, one notice each in Juli's chat); cleared ones go away\n    const flags = flagsFor(tr, fc), keys = new Set(flags.map((f) => f.key)), raised = [];\n    for (const f of flags) {\n      const was = nb.get(f.key), fields = { kind: 'flag', title: `${cap(whatOf(t))} · ${t.place.name}`, text: f.text, data: { trip: tr.id, type: f.type, value: f.value, sev: f.sev }, evidence: [{ source: 'NWS forecast', at: fc.at }] };\n      let raise = false;\n      if (!was) { nb.add(Object.assign({ key: f.key, review: true }, fields)); raise = true; }\n      else if (was.shelf === 'dismissed') { if (worse(f, was.data)) { nb.put(f.key, Object.assign({ shelf: 'suspected', review: true }, fields)); raise = true; } }\n      else { raise = worse(f, was.data); nb.put(f.key, Object.assign(raise ? { review: true } : {}, fields)); }\n      if (raise) { fresh++; raised.push(f); ctx.log((was ? 'Worse: ' : 'New: ') + f.text + ' at ' + t.place.name); }\n    }\n    if (raised.length) await post({ title: `${TITLE} · ${t.place.name}`, severity: raised.some((f) => f.sev === 'warning') ? 'warning' : 'watch',   // one notice for the trip\n      text: `${raised.map((f) => f.text).join('; ')}. For your ${whatOf(t)}, ${dates(t)}. Data: NWS.` }, ctx);\n    for (const e of forTrip(tr.id, 'flag')) if (e.shelf === 'suspected' && !keys.has(e.key)) { nb.remove(e.id); ctx.log('Cleared: ' + e.text + ' at ' + t.place.name); }\n    // Juli's line for the trip when the forecast changed (in the open app it waits for the next check: 'unsummed')\n    const summed = changed && fc.periods.length && juli && ctx.left() > 25 ? await brief(tr, fc, ctx) : !changed;\n    nb.put('fc:' + tr.id, { shelf: 'grounding', kind: 'forecast', title: 'Forecast for ' + t.place.name, data: Object.assign({ trip: tr.id, sig, unsummed: !summed && !!fc.periods.length }, fc), evidence: [{ source: 'NWS', at: fc.at }] });\n    if (inDays <= 2 || flags.length) active = true;\n  }\n  if (juli) await answerQuestions(ctx, offline);\n  badge();\n  ctx.log(!list.length ? 'Nothing to watch yet' : !looked ? `${plural(list.length, WORD)}, not in the forecast yet` : `Checked ${plural(looked, WORD)}` + (fresh ? `: ${fresh} new to look at` : ': nothing new'));\n  return { active: active || waiting().some((e) => e.kind !== 'note!') };\n}\nasync function brief(tr, fc, ctx) {   // Juli's one line for a trip: kept only if every number in it is in the forecast. -> true when done\n  const t = tr.data;\n  let line = '';\n  try { line = (await K.ask(`${tripLine(t)}\\n${forecastText(fc)}\\n\\nIn ONE short sentence, say what matters most about the weather for this ${whatOf(t)}. Use only numbers from the forecast above. No other text.`)).replace(/\\s+/g, ' ').trim(); }\n  catch (e) { ctx.log(`Juli couldn't sum up ${t.place.name} this time`); return false; }\n  if (!line) return true;\n  const chk = K.facts(line, fc);\n  if (!chk.ok) { ctx.log(`Left out Juli's line for ${t.place.name}: ${notIn(chk.missing)}`); return true; }\n  nb.put('brief:' + tr.id, { shelf: 'suspected', kind: 'brief', title: 'Juli on ' + t.place.name, text: line.slice(0, 240), data: { trip: tr.id }, evidence: [{ source: 'Juli, from the NWS forecast', at: Date.now() }] });\n  ctx.log('Juli summed up ' + t.place.name);\n  return true;\n}\nasync function readNotes(ctx) {   // the trip notes you left: Juli reads each one; a suggestion waits for your tap (and a notice says so)\n  for (const e of nb.list('suspected', 'note').reverse().slice(0, 3)) {\n    if (ctx.left() < 30) break;\n    const note = String((e.data && e.data.note) || e.title || '');\n    let r;\n    try { r = await readTrip(note); }\n    catch (x) { if (x && x.code === 'NOT_DOWNLOADED') { nb.put(e.id, { kind: 'note!', text: 'Juli is not downloaded: pick the place and day yourself.' }); continue; }\n      ctx.log(x && x.code === 'OFFLINE' ? \"Couldn't reach the place search: Juli tries your note again next time\" : \"Juli couldn't read a note this time: \" + note.slice(0, 50)); break; }\n    if (!r.trip) { nb.put(e.id, { kind: 'note!', text: r.why }); ctx.log(`Juli couldn't make a ${WORD} of: ${note.slice(0, 50)}`); continue; }\n    nb.remove(e.id);\n    const s = nb.add({ kind: 'trip?', review: true, title: `Add this ${WORD}?`, text: `${cap(r.trip.what || WORD)} · ${dates(r.trip)}`, data: Object.assign({ pick: 0 }, r.trip), evidence: [{ source: 'Juli, from your words', at: Date.now(), note }] });\n    ctx.log(`Juli read your note: ${s.text}, ${placeName(r.trip.places[0])}`);\n    await post({ title: `${TITLE}: a ${WORD} to confirm`, severity: 'info', text: `${s.text}, ${placeName(r.trip.places[0])}. Open ${TITLE} to add it.` }, ctx);\n  }\n}\nasync function answerQuestions(ctx, offline) {   // your questions about a trip, from its newest forecast (fetched in this same check)\n  for (const e of nb.list('suspected', 'question').reverse().slice(0, 2)) {\n    if (ctx.left() < 20) break;\n    const tr = nb.get((e.data || {}).trip), q = String((e.data && e.data.q) || e.title || '');\n    if (!tr) { nb.remove(e.id); continue; }\n    if (offline.has(tr.id)) continue;   // its forecast couldn't be fetched this time: the question waits\n    const fc = (nb.get('fc:' + tr.id) || {}).data, t = tr.data;\n    let text;\n    if (!fc || !fc.periods || !fc.periods.length) text = 'The forecast for these days is not out yet: it reaches about 7 days ahead.';\n    else {\n      try { text = (await K.ask(`${tripLine(t)}\\n${forecastText(fc)}\\n\\nQuestion: ${q}\\nAnswer in at most three short sentences, using only the forecast above. If it does not say, say so.`)).replace(/\\s+/g, ' ').trim(); }\n      catch (x) { ctx.log(`Juli couldn't answer a question about ${t.place.name} this time`); break; }\n      const chk = K.facts(text, { q, fc });\n      if (!text || !chk.ok) { if (text) ctx.log(`Left out an answer about ${t.place.name}: ${notIn(chk.missing)}`); text = \"Juli's answer used a number that isn't in the forecast, so it isn't shown. Ask another way.\"; }\n    }\n    for (const a of nb.list('suspected', 'answer').filter((x) => x.data && x.data.trip === tr.id).slice(2)) nb.remove(a.id);   // keep the newest three\n    nb.put(e.id, { kind: 'answer', text: text.slice(0, 600), evidence: [{ source: 'Juli, from the NWS forecast', at: Date.now() }] });\n    ctx.log(`Juli answered your question about the ${whatOf(t)} at ${t.place.name}`);\n    await post({ title: `${TITLE}: your question`, severity: 'info', text: `${q.slice(0, 120)}: ${text.slice(0, 300)}` }, ctx);\n  }\n}\n\n// ===== IDLE TASK 2: tidy (a trip leaves the day after it ends, with everything kept for it) =====\nasync function tidy(ctx) {\n  const today = K.today();\n  for (const tr of trips()) if (tr.data.end < today) { for (const e of forTrip(tr.id)) nb.remove(e.id); nb.remove(tr.id); ctx.log(`The ${whatOf(tr.data)} at ${tr.data.place.name} is over: let go`); }\n  for (const e of nb.list('suspected', 'trip?')) if (Date.now() - e.at > 7 * 864e5) nb.remove(e.id);   // a suggestion nobody answered goes after a week\n  nb.prune(); badge();\n  return { active: false };\n}\n\nconst juliWork = () => waiting().some((e) => e.kind === 'note' || e.kind === 'question') || nb.list('grounding', 'forecast').some((e) => e.data && e.data.unsummed);\nK.agent({ goal: 'Keep an eye on the weather for my trips', budgetS: 95, tasks: [{ id: 'watch', every: 60, run: watch, due: juliWork }, { id: 'tidy', every: 720, run: tidy }] });   // due: Juli has work waiting -> the next check\n\n// ===== ACTIVE TASKS (the open app): leave Juli a note or a question, pick a trip yourself, confirm =====\nconst ui = { text: '', busy: '', manual: null, open: null, ask: null, askOpen: false, q: '', contentH: 900 };\nfunction leaveNote() {   // the open app keeps your words; Juli reads them in the next check, right after you close Trip Watch\n  const note = ui.text.trim().slice(0, 300);\n  if (note.length < 4) return;\n  nb.add({ kind: 'note', title: note, data: { note }, evidence: [{ source: 'You', at: Date.now() }] });\n  ui.text = ''; K.blurInputs(); K.sfx('pop');\n  K.toast(`Saved. Close ${TITLE} and Juli reads it`, { tone: 'good', icon: 'sparkle', ms: 3200 });\n}\nfunction leaveQuestion(tr) {\n  const q = ui.q.trim().slice(0, 200);\n  if (q.length < 3) return;\n  nb.add({ kind: 'question', title: q, data: { trip: tr.id, q }, evidence: [{ source: 'You', at: Date.now() }] });\n  ui.q = ''; ui.askOpen = false; K.blurInputs(); K.sfx('pop');\n  K.toast(`Saved. Close ${TITLE} and Juli answers it`, { tone: 'good', icon: 'sparkle', ms: 3200 });\n}\nfunction confirmTrip(e) {   // the person's yes (a tap): the trip goes on the confirmed shelf, and the app looks at its forecast at once\n  const d = e.data || {}, pl = (d.places || [])[d.pick || 0]; if (!pl) return;\n  nb.confirm(e.id, { kind: 'trip', title: `${cap(d.what || WORD)} at ${pl.name}`, text: dates(d), data: { place: { name: pl.name, region: pl.region || '', lat: pl.lat, lon: pl.lon }, start: d.start, end: d.end, what: d.what || '' },\n    evidence: [{ source: 'Added by you', at: Date.now() }] });\n  K.sfx('success'); K.toast(`Watching ${pl.name}`, { tone: 'good', icon: 'check' }); badge();\n  K.agent.run('watch');\n}\nfunction removeTrip(tr) { for (const e of forTrip(tr.id)) nb.remove(e.id); nb.remove(tr.id); K.agent.log(`You removed the ${whatOf(tr.data)} at ${tr.data.place.name}`); badge(); K.sfx('back'); }\nasync function manualSearch() {\n  const m = ui.manual; if (!m || m.query.trim().length < 2 || ui.busy) return;\n  if (!window.p0) { K.toast('Open this app in p0pc0rn to look up places', { tone: 'warn' }); return; }\n  K.blurInputs(); ui.busy = 'Finding places…';\n  try { m.results = ((await p0.fetch('geocode.openmeteo', { name: m.query.trim() })).results || []).filter((x) => x.cc === 'US').slice(0, 4); if (!m.results.length) K.toast('No US place with that name', { tone: 'warn' }); }\n  catch (e) { K.toast(\"Couldn't search for places\", { tone: 'bad' }); }\n  ui.busy = '';\n}\nfunction manualAdd(pl) {\n  const m = ui.manual, start = K.addDays(K.today(), m.start), end = K.addDays(start, m.days - 1);\n  confirmTrip(nb.add({ kind: 'trip?', title: 'Your ' + WORD, data: { what: '', start, end, places: [pl], pick: 0 } }));\n  ui.manual = null;\n}\nfunction onReview(act) {\n  const e = act.entry;\n  if (e.kind === 'trip?') { if (act.action === 'yes') confirmTrip(e); else { nb.remove(e.id); K.sfx('back'); badge(); } return; }\n  if (act.action === 'no') { nb.dismiss(e.id); K.sfx('tap'); badge(); return; }   // \"Got it\": raised again only if it gets worse\n  if (act.action === 'ask') { const tr = nb.get((e.data || {}).trip); if (tr) { ui.ask = tr.id; ui.askOpen = true; ui.q = ''; } }\n}\n\n// ===== DRAWING (the open app only: an unseen check never gets here) =====\nfunction setup() {\n  K.setup({ mode: 'dark', accent: ACCENT });\n  K.scene('main', drawMain);\n  if (window.p0 && p0.mode === 'run' && trips().length && Date.now() - K.agent.last('watch') > 30 * 60e3) K.agent.run('watch');   // a fresh look when it opens (no Juli)\n}\nfunction draw() { K.render(); ui.askOpen = K.sheet('ask', ui.askOpen, 400, drawAsk); }\n\nfunction drawMain() {\n  K.backdrop({ top: K.C.bg, bottom: K.darken(ACCENT, 0.84), glow: [{ x: K.W * 0.15, y: 90, r: 280, color: K.alpha(ACCENT, 0.16) }] });\n  const n = trips().length, rv = nb.review().length;\n  const sub = n ? `Watching ${plural(n, WORD)}` + (rv ? ` · ${rv} to look at` : '') : `Tell it about a ${WORD}`;\n  const top = K.navBar.top(sub) + 8, clipY = K.navBar.bottom(), x = K.S.l, w = K.W - 2 * K.S.l;\n  const off = K.scroll('main', 0, clipY, K.W, K.H - clipY, ui.contentH);\n  K.clip(0, clipY, K.W, K.H - clipY, () => { ui.contentH = body(x, top - off, w) + off - top + 40; });\n  const tap = K.navBar(TITLE, off, { sub, right: n ? { id: 'refresh', icon: 'refresh' } : undefined });\n  if (tap === 'refresh' && !K.agent.busy()) K.agent.run('watch').then(() => K.toast('Checked', { tone: 'good', icon: 'refresh', ms: 1200 }));\n}\n\nfunction body(x, y, w) {\n  const y0 = y, sevN = (e) => (e.kind === 'trip?' ? 0 : (e.data || {}).sev === 'warning' ? 1 : 2);   // suggestions first, then warnings, then by day\n  const rv = nb.review().sort((a, b) => sevN(a) - sevN(b) || String(a.key || '').localeCompare(String(b.key || '')));\n  if (rv.length) {   // 1. the review queue\n    K.text('TO LOOK AT', x, y + 14, 'label', K.C.text2); y += 26;\n    const r = K.review('rv', x, y, w, rv, {\n      yes: (e) => (e.kind === 'trip?' ? 'Add ' + WORD : null),\n      no: (e) => (e.kind === 'trip?' ? 'Not this' : 'Got it'),\n      ask: (e) => e.kind === 'flag',\n      color: (e) => (e.kind === 'trip?' ? ACCENT : (e.data || {}).sev === 'warning' ? K.C.bad : K.C.warn),\n      extraH: (e) => (e.kind === 'trip?' ? 44 * Math.min(3, ((e.data || {}).places || []).length) + 4 : 0),\n      extra: drawPlaces,\n    });\n    if (r.act) onReview(r.act);\n    y += r.h + 6;\n  }\n  y = waitBox(x, y, w);   // 2. what waits for Juli\n  y = addBox(x, y, w);   // 3. add a trip\n  const list = trips();   // 4. your trips\n  if (list.length) { K.text(('Your ' + WORD + 's').toUpperCase(), x, y + 18, 'label', K.C.text2); y += 30; for (const tr of list) y = tripCard(tr, x, y, w) + 10; }\n  else if (!rv.length && !ui.manual && !waiting().length) y += K.empty(K.W / 2, y + 6, 'compass', `No ${WORD}s yet`, 'Say where and when above. It watches the weather for those days and tells you what changed.', { w: w - 40 }) + 10;\n  const logs = K.agent.logs().slice(0, 6);   // 5. what the agent did\n  if (logs.length) {\n    K.text(('What ' + TITLE + ' did').toUpperCase(), x, y + 18, 'label', K.C.text2); y += 30;\n    const lh = 42; K.card(x, y, w, logs.length * lh + 8, { r: 16 });\n    logs.forEach((l, i) => { const ly = y + 4 + i * lh; if (i) K.line(x + 14, ly, x + w - 14, ly, K.C.line, 1); K.text(l.text, x + 14, ly + 19, 'footnote', K.C.text, { maxW: w - 28 }); K.text(K.fmt.ago(l.at) + (l.n > 1 ? ` · ${l.n} times` : ''), x + 14, ly + 35, 'caption', K.C.text3); });\n    y += logs.length * lh + 18;\n  }\n  y += K.para(`Forecast and alerts: US National Weather Service. Juli works on your notes and questions after you close ${TITLE}, and her lines are checked against the forecast's own numbers. Only you add a ${WORD}. ${TITLE} works while p0pc0rn is open.`, x, y + 8, w, 'caption', K.C.text3) + 12;\n  return y - y0;\n}\n\nfunction drawPlaces(e, x, y, w) {   // inside a suggestion card: which place (the search can find more than one)\n  const d = e.data || {};\n  (d.places || []).slice(0, 3).forEach((p, i) => {\n    const ry = y + i * 44, on = (d.pick || 0) === i;\n    K.rect(x, ry, w, 38, { r: 10, fill: on ? K.alpha(ACCENT, 0.2) : K.alpha(K.C.text, 0.05) });\n    K.icon(on ? 'checkCircle' : 'pin', x + 18, ry + 19, 16, on ? ACCENT : K.C.text3);\n    K.text(placeName(p), x + 36, ry + 24, 'subhead', K.C.text, { maxW: w - 48 });\n    K.registerControl('place:' + e.id + ':' + i, x, ry, w, 38);\n    if (!on && K.tapIn(x, ry, w, 38)) { nb.put(e.id, { data: Object.assign({}, d, { pick: i }) }); K.sfx('select'); }\n  });\n}\n\nfunction waitBox(x, y, w) {   // your notes and questions waiting for Juli (and the ones she couldn't use)\n  const list = waiting(); if (!list.length) return y;\n  K.text('WAITING FOR JULI', x, y + 18, 'label', K.C.text2); y += 28;\n  for (const e of list) {\n    const tr = e.kind === 'question' ? nb.get((e.data || {}).trip) : null;\n    const sub = e.kind === 'note!' ? e.text || \"Juli couldn't use it\" : e.kind === 'question' ? `A question about ${tr ? tr.data.place.name : 'a trip'}` : `A ${WORD} note`;\n    const th = K.paraHeight(e.title || '', w - 92, 'callout', { maxLines: 3 }), h = th + 46;\n    K.card(x, y, w, h, { r: 14 });\n    K.icon(e.kind === 'note!' ? 'alert' : 'sparkle', x + 22, y + 22, 16, e.kind === 'note!' ? K.C.warn : ACCENT);\n    K.para(e.title || '', x + 42, y + 8, w - 92, 'callout', K.C.text, { maxLines: 3 });\n    K.text(sub, x + 42, y + th + 30, 'caption', e.kind === 'note!' ? K.C.warn : K.C.text3, { maxW: w - 92 });\n    if (K.iconButton('wrm:' + e.id, x + w - 26, y + h / 2, 34, 'trash', { style: 'plain', color: K.C.text3 })) { nb.remove(e.id); K.sfx('back'); }\n    y += h + 8;\n  }\n  y += K.para(list.some((e) => e.kind !== 'note!') ? `Juli works on these as soon as you close ${TITLE} (not while it's open: the phone's memory goes to the open app). A notice in her chat says when.` : '', x, y + 2, w, 'caption', K.C.text3) + 8;\n  return y;\n}\n\nfunction addBox(x, y, w) {\n  K.text(('Add a ' + WORD).toUpperCase(), x, y + 18, 'label', K.C.text2); y += 28;\n  if (ui.manual) return manualBox(x, y, w);\n  ui.text = K.input('add', x, y, w, 48, ui.text, { placeholder: EXAMPLE, icon: 'compass', onEnter: leaveNote });\n  y += 58;\n  const bw = (w - 8) / 2;\n  if (K.button('add-juli', x, y, bw, 44, 'Give it to Juli', { style: 'primary', icon: 'sparkle', disabled: ui.text.trim().length < 4 })) leaveNote();\n  if (K.button('add-self', x + bw + 8, y, bw, 44, 'Pick it myself', { style: 'secondary', icon: 'pin' })) ui.manual = { query: ui.text.trim().slice(0, 60), results: null, start: 0, days: 1 };\n  return y + 60;\n}\n\nfunction manualBox(x, y, w) {\n  const m = ui.manual;\n  m.query = K.input('mq', x, y, w - 96, 48, m.query, { placeholder: 'Town or park (US)', icon: 'pin', onEnter: manualSearch });\n  if (K.button('mfind', x + w - 86, y, 86, 48, ui.busy ? '…' : 'Find', { style: 'primary', disabled: !!ui.busy })) manualSearch();\n  y += 60;\n  K.text('FIRST DAY', x, y + 14, 'label', K.C.text3); y += 22;\n  const labels = [0, 1, 2, 3, 4].map((i) => (i === 0 ? 'Today' : i === 1 ? 'Tmrw' : K.dayName(K.addDays(K.today(), i), true)));\n  m.start = K.segmented('mstart', x, y, w, labels, m.start); y += 46;\n  K.text('DAYS', x, y + 20, 'label', K.C.text3);\n  m.days = K.stepper('mdays', x + w - 128, y + 4, m.days, { min: 1, max: 7, show: true }); y += 46;\n  for (const [i, p] of (m.results || []).entries()) {\n    const row = K.listRow('mres' + i, x, y, w, 56, { title: p.name, sub: [p.region, 'tap to add'].filter(Boolean).join(' · '), icon: 'pin', iconColor: ACCENT, chevron: true, r: 14 });\n    if (row.tap) manualAdd(p);\n    y += 62;\n  }\n  if (K.button('mcancel', x, y + 2, w, 42, 'Cancel', { style: 'ghost' })) { ui.manual = null; K.blurInputs(); }\n  return y + 54;\n}\n\nfunction tripCard(tr, x, y, w) {\n  const t = tr.data, today = K.today(), inDays = K.daysFrom(today, t.start), open = ui.open === tr.id;\n  const fc = (nb.get('fc:' + tr.id) || {}).data, br = nb.get('brief:' + tr.id), flags = forTrip(tr.id, 'flag').filter((e) => e.shelf === 'suspected');\n  const when = t.start <= today ? 'Now' : inDays === 1 ? 'Tomorrow' : `In ${inDays} days`;\n  const status = !fc ? (inDays > 6 ? 'Forecast from ' + K.dayLabel(K.addDays(t.start, -6)) : 'Not checked yet') : flags.length ? plural(flags.length, 'thing') + ' to look at' : 'Nothing to look at';\n  const tw = w - 32, brH = br && br.text ? K.paraHeight(br.text, tw, 'callout', { maxLines: 4 }) + 26 : 0;\n  const rows = open && fc ? fc.periods.slice(0, 14) : [], rowsH = rows.length ? rows.length * 46 + 6 : open ? 30 : 0;\n  const ans = open ? nb.list('suspected', 'answer').filter((e) => e.data && e.data.trip === tr.id).slice(0, 3) : [];\n  const ansH = ans.reduce((s, e) => s + K.paraHeight(e.text || '', tw, 'footnote', { maxLines: 5 }) + 34, 0);\n  const h = 98 + brH + rowsH + ansH + 54;\n  K.card(x, y, w, h, { r: 18 });\n  K.text(`${cap(whatOf(t))} at ${t.place.name}`, x + 16, y + 30, 'headline', K.C.text, { maxW: w - 40 - K.chipWidth(when) });\n  K.chip(x + w - 16 - K.chipWidth(when), y + 14, when, { color: inDays <= 1 ? K.C.warn : ACCENT });\n  K.text(dates(t) + (t.place.region ? ' · ' + t.place.region : ''), x + 16, y + 52, 'subhead', K.C.text2, { maxW: tw });\n  K.icon(flags.length ? 'alert' : fc ? 'checkCircle' : 'clock', x + 24, y + 78, 16, flags.length ? K.C.warn : fc ? K.C.good : K.C.text3);\n  K.text(status + (fc ? ' · checked ' + K.fmt.ago(fc.at) : ''), x + 40, y + 83, 'footnote', K.C.text3, { maxW: w - 56 });\n  let yy = y + 98;\n  if (brH) { K.para(br.text, x + 16, yy, tw, 'callout', K.C.text, { maxLines: 4 }); yy += brH - 26; K.text('Juli, from the NWS forecast · ' + K.fmt.ago(br.upd), x + 16, yy + 16, 'caption', K.C.text3); yy += 26; }\n  if (open && !rows.length) { K.text(inDays > 6 ? 'The forecast does not reach these days yet.' : 'No forecast yet.', x + 16, yy + 18, 'footnote', K.C.text3); yy += 30; }\n  rows.forEach((p, i) => {\n    const ry = yy + i * 46; if (i) K.line(x + 16, ry, x + w - 16, ry, K.C.line, 1);\n    K.icon(wet(p) ? 'rain' : /cloud|fog/i.test(p.short || '') ? 'cloud' : p.day ? 'sun' : 'moon', x + 26, ry + 23, 16, ACCENT);\n    K.text(p.name, x + 44, ry + 20, 'subhead', K.C.text, { maxW: w - 130 });\n    K.text(`${p.short}${p.pop != null ? ' · ' + p.pop + '%' : ''} · ${p.wind}`, x + 44, ry + 37, 'caption', K.C.text3, { maxW: w - 130 });\n    K.text(p.temp + '°' + p.unit, x + w - 16, ry + 29, 'headline', K.C.text, { align: 'right' });\n  });\n  if (rows.length) yy += rowsH;\n  for (const e of ans) { K.text(e.title, x + 16, yy + 16, 'subhead', K.C.text2, { maxW: tw }); yy += 24 + K.para(e.text || '', x + 16, yy + 22, tw, 'footnote', K.C.text, { maxLines: 5 }) + 10; }\n  const bw = (tw - 16) / 3, by = y + h - 52;\n  if (K.button('ask:' + tr.id, x + 16, by, bw, 38, 'Ask Juli', { style: 'tinted', icon: 'chat' })) { ui.ask = tr.id; ui.askOpen = true; ui.q = ''; }\n  if (K.button('open:' + tr.id, x + 24 + bw, by, bw, 38, open ? 'Less' : 'Forecast', { style: 'secondary', icon: open ? 'chevronUp' : 'chevronDown' })) ui.open = open ? null : tr.id;\n  if (K.button('rm:' + tr.id, x + 32 + 2 * bw, by, bw, 38, 'Remove', { style: 'ghost', icon: 'trash' })) removeTrip(tr);\n  return y + h;\n}\n\nfunction drawAsk(x, y, w, h) {   // a question for Juli about one trip: kept, and answered in the next check (after you close the app)\n  const tr = nb.get(ui.ask); if (!tr) return false;\n  const px = 20, pw = w - 40; let yy = y + 34;\n  K.text(`Ask about the ${whatOf(tr.data)} at ${tr.data.place.name}`, px, yy, 'headline', K.C.text, { maxW: pw }); yy += 20;\n  K.text(dates(tr.data), px, yy, 'footnote', K.C.text3); yy += 14;\n  ui.q = K.input('q', px, yy, pw, 48, ui.q, { placeholder: 'Is Sunday better for it?', icon: 'chat', onEnter: () => leaveQuestion(tr) }); yy += 58;\n  if (K.button('qgo', px, yy, pw, 46, 'Give it to Juli', { style: 'primary', icon: 'send', disabled: ui.q.trim().length < 3 })) leaveQuestion(tr);\n  yy += 58;\n  K.para(`Juli answers from the newest forecast as soon as you close ${TITLE}; the answer shows on the ${WORD} and in her chat.`, px, yy, pw, 'footnote', K.C.text3, { maxLines: 4 });\n  if (K.button('qdone', px, y + h - 64, pw, 44, 'Done', { style: 'ghost' })) { K.blurInputs(); return false; }\n}\n"
 }
}
```

---

## A complete game example: Noughts and Crosses on the Game Kit

A small, tested game to copy for any two-player game (chess, checkers, reversi, gomoku, dots and boxes): the RULES block (pure), a
`K.game.match` whose `ask` offers Juli EVERY free cell with the game's read of each one (the Game Kit's search sees to the end of a 3 x 3
game), her answer as her move, the "Ask Juli again" state when her model gives none, a `'lines'` board, marks that draw on as they land,
the winning line, confetti, sound, the results card and screen-reader buttons. Four in a Row, which comes with p0pc0rn, is the same
shape with more polish (a ghost disc under the finger, gravity and bounce, a jolt, Juli's ghost wandering while she thinks, a deep read
run in slices, the clear-out). For a bigger game: keep the options to at most 12 legal moves (a game with more groups them: a piece,
then its square), label each in words ("knight b1 to c3"), and let the read name each choice by its number, best first.
```json
{
 "p0skel": 1,
 "manifest": {
  "id": "tic-tac-toe",
  "name": "Noughts and Crosses",
  "description": "Noughts and crosses (tic-tac-toe) against Juli on a 3 x 3 board: three in a row wins. Juli plays to win and every move is her own, picked on this phone. Fits: tic-tac-toe, noughts and crosses, a very quick game with Juli.",
  "category": "non-agentic",
  "kind": "game",
  "version": "1.1",
  "author": "p0pc0rn",
  "runtime": "p5-kit@1",
  "entry": "sketch.js",
  "permissions": {
   "storage": true,
   "juli": [
    "choose"
   ]
  },
  "triggers": [
   {
    "type": "manual"
   }
  ],
  "slots": {
   "title": {
    "type": "string",
    "max": 22,
    "required": true,
    "desc": "the game's name"
   },
   "player_name": {
    "type": "string",
    "max": 14,
    "required": true,
    "desc": "the person's name on the score"
   },
   "juli_name": {
    "type": "string",
    "max": 14,
    "required": true,
    "desc": "Juli's name on the score"
   },
   "player_color": {
    "type": "color",
    "required": true,
    "desc": "the person's crosses, #rrggbb"
   },
   "juli_color": {
    "type": "color",
    "required": true,
    "desc": "Juli's noughts, #rrggbb, easy to tell from the person's"
   },
   "board_color": {
    "type": "color",
    "required": true,
    "desc": "the board, #rrggbb, darker than both"
   },
   "first": {
    "type": "enum",
    "enum": [
     "you",
     "juli",
     "take turns"
    ],
    "required": true,
    "desc": "who goes first"
   },
   "win_text": {
    "type": "string",
    "max": 40,
    "required": true,
    "desc": "the title when the person wins"
   },
   "juli_win_text": {
    "type": "string",
    "max": 40,
    "required": true,
    "desc": "the title when Juli wins"
   }
  }
 },
 "slots_default": {
  "title": "Noughts and Crosses",
  "player_name": "You",
  "juli_name": "Juli",
  "player_color": "#ff4757",
  "juli_color": "#ffc43a",
  "board_color": "#3b2a7a",
  "first": "take turns",
  "win_text": "You win!",
  "juli_win_text": "Juli wins"
 },
 "notes_for_juli": "Fill names and colours from the request; keep the two marks' colours easy to tell apart and the board darker. Juli always plays her best: there are no levels. Example for 'tic tac toe, blue and orange, I start': player_color #2f80ed, juli_color #f2994a, first you.",
 "files": {
  "sketch.js": "/* NOUGHTS AND CROSSES - you against Juli on a 3 x 3 board: the Skeleton Guide's small game on the Game Kit (K.game). The game keeps the\n   rules (the RULES block: pure), reads every free cell with the Game Kit's search (on a 3 x 3 board it sees to the end) and gives Juli\n   that read as a hint; her model picks one of ALL the free cells (K.choose) and her answer is her move. The Game Kit does the rest: the\n   turns, the score and saving (K.game.match), the board, a pop and a sound when a mark lands, the winning line, confetti, the results\n   card and buttons for a screen reader. When her model gives no answer the game says so (\"Ask Juli again\"); it never moves for her.\n   Slots come from window.SLOTS; every slot has a default, so the game also runs with no slots and without window.p0. */\n\n// ===== RULES (pure: no Kit, no p5) =====\nconst N = 3, LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];\nconst NAME = ['top left', 'top middle', 'top right', 'middle left', 'centre', 'middle right', 'bottom left', 'bottom middle', 'bottom right'];\nconst at = (b, m) => b[Math.floor(m / N)][m % N];\n/** the board: 3 rows of 3, top row first; 0 = empty, 1 = the person (X), 2 = Juli (O); a move is a cell number 0-8 */\nfunction emptyBoard() { return [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; }\nfunction freeCells(b) { const out = []; for (let m = 0; m < 9; m++) if (!at(b, m)) out.push(m); return out; }\nfunction place(b, m, who) { const nb = b.map((r) => r.slice()); nb[Math.floor(m / N)][m % N] = who; return nb; }\n/** three in a row -> {who, cells: [[r, c] x3]} or null */\nfunction lineOf(b) { for (const L of LINES) { const v = at(b, L[0]); if (v && at(b, L[1]) === v && at(b, L[2]) === v) return { who: v, cells: L.map((m) => [Math.floor(m / N), m % N]) }; } return null; }\nfunction winsNow(b, who) { return freeCells(b).filter((m) => !!lineOf(place(b, m, who))); }\nfunction boardText(b) { return 'Noughts and crosses, 3 x 3. X = the person, O = you (Juli), . = empty. Three in a row wins.\\nThe board, top row first:\\n' + b.map((r) => r.map((v) => '.XO'[v]).join(' ')).join('\\n'); }\n/** the game as the search sees it (K.game.search: in place), centre and corners first */\nfunction searchSpec(b, me) {\n  return { state: b, who: me, moves: (s) => [4, 0, 2, 6, 8, 1, 3, 5, 7].filter((m) => !at(s, m)),\n    do: (s, m, w) => { s[Math.floor(m / N)][m % N] = w; }, undo: (s, m) => { s[Math.floor(m / N)][m % N] = 0; },\n    won: (s) => !!lineOf(s), draw: (s) => s.every((r) => r.every((v) => v)), score: () => 0 };\n}\n// ===== END RULES =====\n\n// ===== SLOTS =====\nconst SL = window.SLOTS || {};\nconst hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);\nconst TITLE = String(SL.title || 'Noughts and Crosses').slice(0, 22);\nconst YOU = String(SL.player_name || 'You').slice(0, 14) || 'You', JULI = String(SL.juli_name || 'Juli').slice(0, 14) || 'Juli';\nconst C_YOU = hex(SL.player_color, '#ff4757'), C_JULI = hex(SL.juli_color, '#ffc43a'), C_BOARD = hex(SL.board_color, '#3b2a7a');\nconst FIRST = ['you', 'juli', 'take turns'].includes(SL.first) ? SL.first : 'take turns';\nconst WIN_TEXT = String(SL.win_text || 'You win!').slice(0, 40), JULI_WIN_TEXT = String(SL.juli_win_text || 'Juli wins').slice(0, 40);\nconst G = K.game, colorOf = (who) => (who === 1 ? C_YOU : C_JULI);\n\n// ===== JULI'S MOVES: the game reads every free cell (to the end of the game), her model chooses =====\n/** the read of every free cell -> {words: cell -> what HER move there leads to, text: the same, best first, the same reads said once:\n *  \"draws: 5 (centre); loses at once: 1 (top left), ...\"} */\nfunction readOf(b, opts) {\n  const r = G.searchSync(searchSpec(G.copy(b), 2), { depth: 9 }), half = G.WIN / 2, words = new Map();\n  const what = (x) => {\n    if (x.score > half) return winsNow(b, 2).includes(x.move) ? 'wins now' : 'wins';\n    if (x.score < -half) return winsNow(place(b, x.move, 2), 1).length ? 'loses at once' : 'loses';\n    return 'draws';\n  };\n  const groups = [];\n  for (const x of r.ranked) { const w = what(x), g = groups[groups.length - 1]; words.set(x.move, w); if (g && g.w === w) g.ms.push(x.move); else groups.push({ w, ms: [x.move] }); }\n  return { words, text: 'what each choice leads to, best first: ' + groups.map((g) => g.w + ': ' + g.ms.map((m) => (opts.indexOf(m) + 1) + ' (' + NAME[m] + ')').join(', ')).join('; ') };\n}\n\n// ===== THE MATCH (the Game Kit keeps the turns, the score and the saved game) =====\nlet popAnim = null, endAt = 0, cardOpen = false, startScore = null;\nconst STUCK = { stopped: JULI + '’s model stopped', unreadable: JULI + ' didn’t name a cell', missing: JULI + ' isn’t downloaded yet', nojuli: JULI + ' plays inside p0pc0rn' };\nconst M = G.match({\n  key: 'ttt.v1', first: FIRST, fresh: emptyBoard, legal: (b) => freeCells(b),\n  valid: (b) => b.length === 3 && b.every((r) => Array.isArray(r) && r.length === 3),\n  apply: (b, m, who) => ({ board: place(b, m, who), last: m }),\n  result: (b) => { const l = lineOf(b); return l ? { who: l.who, cells: l.cells } : freeCells(b).length ? null : { who: 0, cells: [] }; },\n  animate: (m, who) => { popAnim = { m, who, k: 0 }; G.sound.play('place', { vel: 0.8 }); return G.timeline().tween(popAnim, { k: 1 }, G.reduced ? 80 : 320, { ease: 'outBack' }).play(); },\n  juli: {   // every free cell is hers to pick; the read is information, never a filter\n    ask: (b) => { const opts = freeCells(b), rd = readOf(b, opts);   // every free cell, the read beside each one too\n      return { about: boardText(b), skill: 'play-tic-tac-toe', options: opts.map((m) => ({ move: m, label: NAME[m] + ' (' + rd.words.get(m) + ')' })), hint: rd.text }; },\n    pick: (a) => K.choose(a.about, a.options, { skill: a.skill, hint: a.hint }),\n  },\n});\nM.on('new', () => { cardOpen = false; endAt = 0; startScore = Object.assign({}, M.st.score); });\nM.on('resume', () => { startScore = Object.assign({}, M.st.score); if (M.st.over) { cardOpen = true; endAt = K.t - 10; } });\nM.on('move', (e) => G.a11y.say((e.who === 1 ? 'You' : JULI) + ' took ' + NAME[e.move] + '.'));\nM.on('stuck', (s) => G.a11y.say((STUCK[s.kind] || STUCK.stopped) + '. Ask ' + JULI + ' again.'));\nM.on('end', (o) => {\n  endAt = K.t; G.sound.play(o.who === 1 ? 'win' : o.who === 2 ? 'lose' : 'draw');\n  if (o.who === 1) G.confetti(K.W / 2, K.H * 0.95, { n: 90, colors: [C_YOU, C_JULI, '#fff4d6'], spread: 1.1, power: 1300 });\n  const gno = M.st.games;   // Play again can come first: then the card stays shut\n  G.timeline().call(() => { if (M.st.over && M.st.games === gno) cardOpen = true; }, { at: 1100 }).play();\n  G.a11y.say(o.who === 1 ? WIN_TEXT : o.who === 2 ? JULI_WIN_TEXT : 'A draw.');\n});\n\nfunction setup() { K.setup({ mode: 'dark', accent: C_BOARD }); M.start(); G.a11y.title(TITLE + ': you against ' + JULI); K.scene('play', drawPlay); }\n\nfunction geo() {\n  const W = K.W, H = K.H, top = Math.max(K.safe.top, 10), size = Math.min(W - 40, H - top - 230, 440);\n  return { top, L: G.layout({ rows: 3, cols: 3, x: (W - size) / 2, y: top + 128, w: size, h: size, pad: Math.round(size * 0.04), align: 'top' }) };\n}\n\nfunction drawPlay() {\n  const g = geo(), L = g.L, st = M.st, W = K.W;\n  G.backdrop({ top: '#1d1442', bottom: '#08060f', glows: [{ x: 0.5, y: 0.45, r: 0.7, color: C_BOARD, a: 0.35 }] });\n  G.soundButton('sound', W - 34, g.top + 22, 36);\n  const pw = (W - 38) / 2;\n  G.player('you', 14, g.top + 46, pw, 54, { name: YOU, score: st.score.you, color: C_YOU, active: !st.over && st.turn === 1 });\n  G.player('juli', W - 14 - pw, g.top + 46, pw, 54, { name: JULI, score: st.score.juli, color: C_JULI, active: !st.over && st.turn === 2, juli: true, mood: M.thinking ? 'thinking' : 'idle', align: 'right' });\n  const t = st.over ? '' : M.stuck ? STUCK[M.stuck.kind] || STUCK.stopped : M.thinking ? JULI + ' is thinking…' : st.turn === 1 ? 'Your turn' : '';\n  K.text(t, W / 2, g.top + 120, 'headline', M.stuck ? '#ffb36b' : K.C.text, { align: 'center' });\n  G.board(L, { style: 'lines', color: C_BOARD });\n  for (let m = 0; m < 9; m++) { const v = at(st.board, m); if (v) drawMark(L, m, v, popAnim && popAnim.m === m ? popAnim.k : 1); }\n  if (st.over && st.over.cells.length) {   // the winning line glows\n    const a = st.over.cells[0], b = st.over.cells[2], k = Math.min(1, (K.t - endAt) / 0.4), col = colorOf(st.over.who);\n    for (const [r, c] of st.over.cells) G.glow(L.cx(c), L.cy(r), L.cell * 0.6, col, 0.4 + 0.2 * K.pulse(5));\n    K.line(L.cx(a[1]), L.cy(a[0]), L.cx(a[1]) + (L.cx(b[1]) - L.cx(a[1])) * k, L.cy(a[0]) + (L.cy(b[0]) - L.cy(a[0])) * k, K.alpha('#ffffff', 0.85), L.cell * 0.07);\n    if (k < 1) G.hot(200);\n  }\n  const aim = G.aim('cells', L, { mode: 'cell', enabled: M.canPlay() && !cardOpen, legal: (x) => !st.board[x.r][x.c] });\n  if (aim.hover) G.glow(L.cx(aim.hover.c), L.cy(aim.hover.r), L.cell * 0.5, C_YOU, 0.25);\n  if (aim.drop) M.play(aim.drop.r * 3 + aim.drop.c);\n  G.fx();\n  if (M.stuck && !st.over && K.button('askagain', W / 2 - 90, L.y + L.h + 24, 180, 44, 'Ask ' + JULI + ' again', { style: 'primary', icon: 'refresh' })) M.askAgain();\n  const out = st.over ? (st.over.who === 1 ? 'win' : st.over.who === 2 ? 'lose' : 'draw') : 'draw';\n  const act = G.results('end', { open: !!(st.over && cardOpen), outcome: out, title: out === 'win' ? WIN_TEXT : out === 'lose' ? JULI_WIN_TEXT : 'Draw', sub: out === 'draw' ? 'Nobody made three in a row' : 'Three in a row',\n    color: out === 'win' ? C_YOU : out === 'lose' ? C_JULI : K.C.accent, score: st.score, prev: startScore, names: { you: YOU, juli: JULI }, colors: { you: C_YOU, juli: C_JULI }, streak: st.streak, note: 'Every move ' + JULI + ' made was her own.' });\n  if (act === 'again') M.newGame(); else if (act === 'board') cardOpen = false;\n  if (st.over && !cardOpen && K.button('again', W / 2 - 80, L.y + L.h + 24, 160, 44, 'Play again', { style: 'primary', icon: 'refresh' })) M.newGame();\n  G.a11y.controls(Array.from({ length: 9 }, (_, m) => ({ id: 'c' + m, label: NAME[m] + (at(st.board, m) ? ' (taken)' : ''), disabled: !M.canPlay() || !!at(st.board, m), press: () => M.play(m) }))\n    .concat(M.stuck && !st.over ? [{ id: 'askagain', label: 'Ask ' + JULI + ' again', press: () => M.askAgain() }] : [])\n    .concat(st.over ? [{ id: 'again', label: 'Play again', press: () => M.newGame() }] : []));\n}\n\n/** a cross or a nought, drawn on as it lands (k 0..1, a little past 1 for the pop) */\nfunction drawMark(L, m, who, k) {\n  const cx = L.cx(m % 3), cy = L.cy(Math.floor(m / 3)), s = L.cell * 0.27 * Math.min(1.15, k), col = colorOf(who);\n  G.glow(cx, cy, L.cell * 0.42, col, 0.18);\n  K.with((c) => {\n    c.lineCap = 'round'; c.lineWidth = L.cell * 0.11; c.strokeStyle = col;\n    const p = Math.min(1, k);\n    if (who === 1) { c.beginPath(); c.moveTo(cx - s, cy - s); c.lineTo(cx - s + 2 * s * Math.min(1, p * 2), cy - s + 2 * s * Math.min(1, p * 2)); c.stroke();\n      if (p > 0.5) { c.beginPath(); c.moveTo(cx + s, cy - s); c.lineTo(cx + s - 2 * s * (p - 0.5) * 2, cy - s + 2 * s * (p - 0.5) * 2); c.stroke(); } }\n    else { c.beginPath(); c.arc(cx, cy, s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); c.stroke(); }\n  });\n}\n\nfunction draw() { K.render(); }\n"
 },
 "skills": {
  "play-tic-tac-toe": "---\nname: play-tic-tac-toe\ndescription: How Juli picks a strong noughts and crosses move from the free cells the game offers: win now, block the person, then the centre and the corners.\nfor: [game]\n---\n## Each move, in this order\n1. If a cell wins for you now, take it.\n2. If the person wins next in a cell, take that cell to block.\n3. Otherwise take the centre, then a corner.\n\n## Reading the game\n- The game offers every free cell; its read sees to the end of the game and lists the best choices first.\n- Answer with the number of the choice.\n"
 }
}
```

---

## MY APP (write here, then send this file to the AI)

I want an app that ...

Kind: non-agentic (a tool I use; Juli helps when I ask) / agentic (Juli works in it on her own while p0pc0rn is open) / a game (I play
against Juli; built on the Game Kit) - pick one.

(Optional: who uses it, what it should show, which online data it needs. For an agentic app: its goal, what it should keep in its notebook,
what it should look up or re-check on its own and how often, and what it should bring to me.)
