# p0pc0rn: notices

p0pc0rn, by Joshua Hughes. Its own code is under LICENSE.md (the p0pc0rn License 1.2). The models and the data it uses are not
part of p0pc0rn: each keeps its own licence, listed in MODELS.md, with the full texts in `licenses/` (Settings › About › Licences and
notices). Nothing here is legal advice.

## Required notices

- **Gemma 2** (the video model's text encoder, Gemma-2-2B-it): Gemma is provided under and subject to the Gemma Terms of Use found at
  ai.google.dev/gemma/terms
  - Copies: licenses/GEMMA_TERMS_OF_USE.txt and licenses/GEMMA_PROHIBITED_USE_POLICY.txt. The Prohibited Use Policy is part of
    p0pc0rn's terms (USE-POLICY.md).
- **LTX-2.3 video autoencoder** (Lightricks; the video decoder, the picture reader and, in 4.0, the clip reader that Restyle a clip
  uses): the LTX-2 Community License Agreement, complete, with Attachment A (licenses/LICENSE-LTX-2.txt). The app shows it and asks you
  to accept it before it downloads any of these parts.
  Attachment A is part of p0pc0rn's terms. Entities with annual revenues of USD 10 million or more need a paid licence from Lightricks.
- **FLUX.2 [klein] 9B** ("Better pictures", Black Forest Labs): the FLUX Non-Commercial License v2.1 (licenses/LICENSE-FLUX-Non-Commercial-v2.1.md),
  shown and accepted once before it downloads. Its Attribution Notice:
  > This FLUX Model is licensed by Black Forest Labs Inc. under the FLUX Non-Commercial License. Copyright Black Forest Labs Inc. IN NO
  > EVENT SHALL BLACK FOREST LABS INC. BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  > OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH USE OF THIS MODEL.
  The p0pc0rn project modified it: converted and quantized from the original weights. This is not an official Black Forest Labs product,
  and Black Forest Labs has not endorsed or approved it. Its text encoder, Qwen3-8B (Alibaba Cloud), is Apache-2.0.
- **NVIDIA Nemotron 3.5 Bolt E4B** ("Bigger brain", the assistant's optional second model; NVIDIA Corporation): NVIDIA's model card says
  "Use of this model is governed by the OpenMDW License Agreement, version 1.1. This model has been post-trained on the Google Gemma 4
  model, and use of the Google Gemma 4 model is governed by Apache License, Version 2.0". The app shows the licence once before it
  downloads. The p0pc0rn project modified it: converted and quantized from the original weights. This is not an official NVIDIA
  product, and NVIDIA has not endorsed it. Details and sources: licenses/NOTICE-Nemotron-Bolt-E4B.md.
  - The full agreement: licenses/LICENSE-OpenMDW-1.1.txt, the publisher's own text (github.com/OpenMDW/OpenMDW, 1.1/LICENSE.OpenMDW-1.1
    at commit 9067ba54b2f84bc9e15a05734f570ec88e9f445d, the link NVIDIA's card gives; sha256
    2ab44b68365473c112f5092211a38f231cb23e50de68b75a13369adbd76a74df).
  - In plain words: keep a copy of the agreement and NVIDIA's notices with any copy of the model; it puts no limits on what you
    make with it.
- **NVIDIA Nemotron 3.5 ASR Streaming 0.6B** ("Voice input", v4: the mic in Juli's chat; NVIDIA Corporation): NVIDIA's model card says
  "Governing Terms: Use of the model is governed by the OpenMDW-1.1 license." The app shows the licence once before it downloads. The
  p0pc0rn project modified it: converted and quantized from the original weights. This is not an official NVIDIA product, and NVIDIA
  has not endorsed it. The full agreement: licenses/LICENSE-OpenMDW-1.1.txt. Details and sources: licenses/NOTICE-Nemotron-ASR.md.
- **Juli's voice** (v4, voice mode: engine/p0voice/, the pack p0voice-juli): p0voice v3, p0pc0rn's own text-to-speech, trained from
  scratch by the p0pc0rn project (Josh Hughes owns the engine and the weights; p0pc0rn's own licence, LICENSE.md); no real person's
  voice was used: the training speech was made with Qwen3-TTS (Qwen3-TTS-12Hz-1.7B-VoiceDesign and Qwen3-TTS-12Hz-0.6B-Base, Copyright
  2026 Alibaba Cloud, Apache-2.0, which puts no terms on what the models make) reading public-domain texts from Project Gutenberg and
  lines written for p0pc0rn. Its pronunciations (the lexicon) come from the CMU Pronouncing Dictionary, and its letters-to-sounds model was
  trained on it: "Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved." (BSD 2-Clause:
  licenses/LICENSE-cmudict-BSD-2-Clause.txt, also in the pack). Without WebGPU, or before her pack is on the phone, voice mode speaks
  with Flite (below).
- **Modified files:** every model file p0pc0rn downloads carries this notice:
  "Modified by the p0pc0rn project: converted and quantized from the original weights." They are not the original files.
- **Starter knowledge pack:** contains text from Wikipedia, available under CC BY-SA 4.0. The pack is licensed CC BY-SA 4.0; the
  article credits (title, address, revision, retrieved date, authors) are in the pack's CREDITS.md and at Settings › About ›
  Starter pack credits. Live lookups from Wikipedia and Fandom wikis cite each article, its authors and its licence where they are
  shown; Fandom wikis whose licence is non-commercial or no-derivatives are not read.

## Copyright notices kept

- FLUX.2 [klein] 4B and the FLUX.2 autoencoder: Black Forest Labs, Apache-2.0.
- Qwen3-4B (Klein's text encoder) and Qwen3-Embedding-0.6B: Alibaba Cloud, Apache-2.0.
- SANA-Video 2.0 5B: Copyright 2024 Nvidia, Apache-2.0.
- The video LoRA (v4, Settings › Models › Video LoRA): LoRA by Josh Hughes, trained on SANA-Video 2.0 (NVIDIA, Apache-2.0); Apache-2.0
  (licenses/LICENSE-Apache-2.0.txt). It runs with SANA-Video 2.0 and the separately licensed LTX-2.3 decoder and picture reader.
- The looks LoRA (v4, Settings › Models › Looks LoRA, style video to video): LoRA by Josh Hughes, trained on SANA-Video 2.0 (NVIDIA,
  Apache-2.0); Apache-2.0 (licenses/LICENSE-Apache-2.0.txt). The clip reader it works with is LTX-2.3's video encoder (Lightricks, LTX-2
  Community License Agreement), converted for phones (a Derivative).
- Gemma 4 E2B-it (the assistant): Google, Apache-2.0 (not the Gemma Terms of Use).
- Gemma 4 E2B-it MTP drafter ("faster replies", the assistant's add-on): Google, Apache-2.0.
- NVIDIA Nemotron 3.5 Bolt E4B ("Bigger brain"): NVIDIA Corporation, OpenMDW License Agreement 1.1; post-trained from Google's
  Gemma 4 E4B-it (Apache-2.0).
- Gemma 4 E4B-it MTP drafter (the Bigger brain's drafter): Google, Apache-2.0.
- NVIDIA Nemotron 3.5 ASR Streaming 0.6B ("Voice input", v4): NVIDIA Corporation, OpenMDW License Agreement 1.1.
- CMU Pronouncing Dictionary (Juli's voice, v4: its lexicon and its letters-to-sounds model's training data): Copyright (C) 1993-2015
  Carnegie Mellon University, BSD 2-Clause.
- LTX-2.3: Lightricks, LTX-2 Community License Agreement (the video decoder, the picture reader and the clip reader).
- DGMR (the Nowcast, v4): Copyright 2021 DeepMind Technologies Limited, CC BY 4.0, modified (licenses/NOTICE-nowcast.md).
- ACE-Step 1.5 (music) and its 5 Hz lyrics planner: Copyright (c) 2026 ACEStep, MIT; their Qwen3-based parts Apache-2.0.
- Qwen3-TTS (voice): Copyright 2026 Alibaba Cloud, Apache-2.0.
- TOON (the knowledge format p0pc0rn's fork extends): Copyright (c) 2025-PRESENT Johann Schopplich, MIT.
- Lip-sync (experimental): MuseTalk 1.5, Copyright (c) 2024 Tencent Music Entertainment Group, MIT (its card's CreativeML Open RAIL-M
  tag: p0pc0rn applies that licence's Attachment A use restrictions as part of its terms; licenses/LICENSE-CreativeML-OpenRAIL-M.txt); Whisper,
  Copyright (c) 2022 OpenAI, MIT; sd-vae-ft-mse, Stability AI, MIT (its card names no copyright holder); MediaPipe face models,
  Google, Apache-2.0.
- Tokenizers in the engine: Apache-2.0 (engine/LICENSE-tokenizers.txt).
- p5.js 1.11.13 (the Apps tab's drawing library, makeapp/p5.min.js, unmodified): the Processing Foundation and p5.js contributors,
  LGPL-2.1 (licenses/NOTICE-p5js.md has the source link).

## Weather and US places (v4)

- The Nowcast (Experimental, nowcast/): the model is DeepMind's DGMR (the 256 x 256 TF-Hub snapshot), Copyright 2021 DeepMind
  Technologies Limited, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified by p0pc0rn: its weights
  converted to 16-bit floats (the full model) or quantised to 8-bit integers (the low-memory model) and run as WebGPU kernels; trained by
  DeepMind on UK radar. Credit shown with every nowcast: "Nowcast model: DeepMind DGMR (CC BY 4.0), modified". licenses/NOTICE-nowcast.md.
- Its radar is NOAA MRMS (Multi-Radar Multi-Sensor) rain rate and precipitation type, from NOAA's open data on AWS: US government work,
  public domain ("Radar: NOAA MRMS"). Its map's background is NASA GIBS Blue Marble shaded relief (NASA, public domain: "Basemap:
  NASA GIBS"); its state, county and coast lines (nowcast/data/us_lines.bin, made by tools/nowcast_lines.py) come from the US Census
  Bureau's 2024 cartographic boundary file for counties, and its city names from the Census tables below (public domain: "Places: US
  Census"). Warnings drawn on its map and the 7-day forecast come from the US National Weather Service (api.weather.gov). Its Clouds layer
  (off by default) is NOAA GOES-East / GOES-West imagery (band 13 clean infrared, and GeoColor by day) served by NASA GIBS: US government
  data, public domain ("Clouds: NOAA GOES via NASA GIBS"); the infrared is shown through NASA's own colour table, as white clouds.

- Forecasts and alerts in Juli's chat come from the US National Weather Service (api.weather.gov, NOAA): a US government work, in the
  public domain. Each forecast is credited "Forecast: US National Weather Service (weather.gov)" under the answer. Only rounded
  coordinates (0.01 degree) are sent.
- The US places and ZIP code tables on the phone (assistant/data/places_us.txt.gz, zcta_us.bin.gz; made by tools/gaz_pack.py) are
  made from the US Census Bureau's 2025 Gazetteer files (places, ZIP Code Tabulation Areas) and its 2024 city and town population
  estimates: US government works, in the public domain. A ZCTA is the Census Bureau's area for a ZIP code, close to but not always the
  same as the US Postal Service's ZIP code.

## Online data in apps

- Wallet Watch (3.9) reads public Avalanche C-Chain data from Snowtrace, the public Avalanche explorer, through the free API of
  Routescan (api.routescan.io). Powered by Routescan.io APIs:
  [routescan.io](https://routescan.io), [@routescan_io on X](https://x.com/routescan_io). The data is public blockchain data, shown for
  information only; it is not investment advice. p0pc0rn keeps to half of the API's free limits per device: it reads Snowtrace only
  when opened from the Home Screen (a browser tab reads none), and each copy sends at most one request every 2 seconds and 2,500 a day
  for all apps (1,600 for one), a quarter of the free limits, so even two copies on one phone stay within half. Its apps look at most
  every 15 minutes, only when the phone is idle.
- Wallet Watch's icon (icons/apps/wallet-watch-180.png and -120.png; 3.9) is AI-generated like the home-screen icons: made for
  p0pc0rn with FLUX.2 [klein] 9B by Black Forest Labs, from a composition sketch drawn for p0pc0rn (FLUX Non-Commercial License
  2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md).
- Token Watch's icon (icons/apps/token-watch-180.png and -120.png; v4) is AI-generated in the same icon pipeline as Wallet Watch's:
  made for p0pc0rn with FLUX.2 [klein] 9B by Black Forest Labs, from a composition sketch drawn for p0pc0rn (FLUX Non-Commercial
  License 2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md). No exchange's or token's logo is in it.
- The Games screen's Four in a Row cover (icons/games/connect-four-cover.png; 3.9) is AI-generated too: made for p0pc0rn with
  FLUX.2 [klein] 9B by Black Forest Labs (FLUX Non-Commercial License 2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md).
- The Video benchmark's test pictures (ui/bench_video/fox-first.jpg and fox-last.jpg; v4) are AI-generated: made for p0pc0rn with
  FLUX.2 [klein] 4B by Black Forest Labs (Apache-2.0); an original character (Sorrel, a clay fox), the second picture an edit of the first.
  Its test clip (ui/bench_video/fox-move.mp4; v4) is AI-generated too: SANA-Video 2.0 (NVIDIA, Apache-2.0) with the video LoRA from
  fox-first.jpg, decoded with the LTX-2.3 decoder (Lightricks); the first 2 seconds.
- The Voice in benchmark's spoken lines (ui/voicebench/v01-v18.wav; v4) are synthetic: made with Qwen3-TTS-12Hz-0.6B-Base (Alibaba
  Cloud, Apache-2.0), its voice cloned from a clip of Flite's cmu_us_slt voice (above, Troll-E: recorded by a US English female speaker for CMU ARCTIC, released free for any use); the words of v13-v16 are CMU ARCTIC
  prompts (sentences from out-of-copyright texts). ui/voicebench/README.md.
- The looks' thumbnails in Create › Video › Restyle a clip (ui/looks/*.jpg; v4) are AI-generated: frames of the looks LoRA's published
  example clips (their styled rows): the lab's own test characters and scenes made with FLUX.2 [klein] 4B by Black Forest Labs
  (Apache-2.0), restyled with FLUX.2 [klein] 4B and SANA-Video 2.0 (NVIDIA, Apache-2.0) with the looks LoRA (LoRA by Josh Hughes), decoded
  with the LTX-2.3 decoder (Lightricks). No real people.

- Token Watch (v4) reads public token data. Data: [DEX Screener](https://dexscreener.com) · New pools: [GeckoTerminal](https://www.geckoterminal.com) by CoinGecko · Solana checks: [RugCheck](https://rugcheck.xyz) · Powered by [GoPlus Security](https://gopluslabs.io). Every number is DEX Screener's; GeckoTerminal finds new pools; GoPlus (EVM chains) and RugCheck (Solana) give the safety flags. The data is public market data, shown for information
  only: it is not financial advice, and new tokens are very high risk. p0pc0rn takes no responsibility for security or safety. It only relays the information GoPlus, RugCheck and Routescan report. Juli does not check contracts and cannot provide any safety information. p0pc0rn shows the data only on the phone that asked for it and never
  caches or serves it to anyone else. Their terms, checked 2026-11-03: DEX Screener's API Terms (last updated August 18, 2023) allow commercial and non-commercial
  use, forbid a product whose primary purpose is to compete directly with DEX Screener and forbid making the API available to third
  parties; the licence is revocable, and no attribution is required (p0pc0rn credits it anyway). GoPlus's API License Agreement (the
  page is marked "old") makes the API free and asks for "Powered by GoPlus Security" with a link wherever its data is shown, which
  Token Watch shows by its safety results and at the foot of the app. RugCheck and GeckoTerminal publish no API terms that we could
  find; p0pc0rn uses both without a key and far below their limits. p0pc0rn stops using any service that objects. p0pc0rn's own caps: each chain at most every 5 minutes, at most 12 requests a look, and an hourly
  cap for each source far below what it documents (makeapp/budget.js). For an Avalanche token, and only when the person taps "Check on
  Snowtrace" (once per token: the answer is kept and never asked again), Token Watch reads its holder count, whether its contract is
  verified and its newest 100 transactions from Snowtrace, Powered by Routescan.io APIs ([routescan.io](https://routescan.io),
  [@routescan_io on X](https://x.com/routescan_io)), under the same hard cap as Wallet Watch (half of Routescan's free allocation, shared
  while both apps use it). It relays what Routescan reports ("Routescan shows 34 of the last 100 transactions failed": at least 10 and at
  least 20 % of them), never a verdict. Name references (off until the person turns on the app's own switch): a token's public name,
  cleaned in code, is looked up through Juli's lookups on Wikipedia and Fandom (CC BY-SA; each line cites its page, revision link and
  licence), and the Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B, on the phone) compares them; a reference says nothing about a token's
  value or safety.

## Troll-E (games/trolley/; v4)

- The trolley model: `equipment_trash_trolley_a01` by NVIDIA (NVIDIA SimReady), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
  Credit: "Trolley model: equipment_trash_trolley_a01, NVIDIA SimReady, CC BY 4.0." The p0pc0rn project modified it (converted to
  glTF, reduced, textures repacked); the Games screen's cover for the game (icons/games/trolley-cover.jpg) is a frame of the game with
  it in. Details and the full list of changes: licenses/NOTICE-trolley-model.md. NVIDIA does not endorse p0pc0rn.
- The props (games/trolley/assets/props/: the grab arm and its claw, the diesel can, the trash, the battery, the drum, the pallet, the
  barricade): NVIDIA SimReady Assets by NVIDIA, CC BY 4.0. Credit: "3D assets: NVIDIA SimReady Assets (CC BY 4.0), modified." The p0pc0rn
  project modified them (converted to glTF, reduced, textures resized, the arm and claw combined). Details and the per-asset list:
  licenses/NOTICE-trolley-props.md. NVIDIA does not endorse p0pc0rn.
- The world round the hall (games/trolley/assets/world/: the dock's forklift, pallet jack, tote, crates, rack, hopper and rail; the
  park's sofas, armchairs, kiosk, cooler, bins and flood-lights; the metro's car shell, kiosk, vending machine, barriers, cabinet, siren
  poles, bins and duct; the forest's wheelbarrow, pipes and boards; the dead trees' bark): NVIDIA SimReady Assets by NVIDIA, CC BY 4.0,
  the same credit line. The p0pc0rn project modified them (converted to glTF, decimated, grime baked in, some re-coloured); the dead
  trees' shapes are its own. Per-asset list: licenses/NOTICE-trolley-props.md. NVIDIA does not endorse p0pc0rn.
- The open world (4.0: games/trolley/assets/survival/ and assets/craft/: the 24 crafted machines, the supplies and salvage, the shelter
  kits, the night lights, the energy leech, the solar panel, the robot charger, the LED hex grid, the hydraulic-oil jug and the rusty
  beam): NVIDIA SimReady Assets by NVIDIA, CC BY 4.0, the same credit line ("3D assets: NVIDIA SimReady Assets (CC BY 4.0), modified:
  https://huggingface.co/datasets/nvidia/simready-assets"). The p0pc0rn project modified them (converted from OpenUSD to glTF,
  decimated, grime baked in, re-coloured with neon accents, the accordion gate split into its moving parts; the energy leech and the
  solar panel are rearrangements of NVIDIA parts). Per-asset list: licenses/NOTICE-trolley-props.md. NVIDIA does not endorse p0pc0rn.
- Troll-E's title art (games/trolley/assets/landing/keyart.webp, the landing screen's picture; v4): "Troll-E title art made with
  FLUX.2 [klein] 9B by Black Forest Labs; the trolley and props are NVIDIA SimReady Assets (CC BY 4.0), modified." It is AI-generated
  for p0pc0rn like Wallet Watch's icon (FLUX Non-Commercial License 2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md);
  the landing screen's About shows the same credit. NVIDIA does not endorse p0pc0rn.
- Juli's voice in Troll-E (games/trolley/voice/: juli_tts.mjs, juli_tts.wasm, cmu_us_slt.flitevox, juli_tts.c; v4): "Juli's voice: CMU
  Flite 2.2, Copyright (c) 1999-2017 Language Technologies Institute, Carnegie Mellon University (BSD-style licence, LICENSE-flite.txt),
  with its cmu_us_slt voice (the CMU ARCTIC slt voice, Copyright (c) 2003 Carnegie Mellon University: "free for use for any purpose
  (commercial or otherwise)", LICENSE-cmu_us_slt.txt; recorded by a US English female speaker for CMU ARCTIC, released free for any use; festvox.org's packed
  Flite voice, unmodified); it is also Juli's fallback voice in voice mode; compiled to
  WebAssembly with Emscripten (MIT), whose C library is musl (Copyright (c) 2005-2020 Rich Felker, et al., MIT); juli_tts.c by Josh
  Hughes for p0pc0rn." Flite's own sources are compiled unchanged; juli_tts.c is new (its header says so). Licences:
  licenses/LICENSE-flite.txt, licenses/LICENSE-emscripten.txt, licenses/LICENSE-musl-MIT.txt (and the first two beside the files).
- three.js r186 (0.186.1; games/trolley/vendor/: three.module.js, three.core.js and the GLTFLoader, BufferGeometryUtils, SkeletonUtils,
  RoomEnvironment and RoundedBoxGeometry add-ons, their `three` imports pointed at the files beside them): Copyright © 2010-2026
  three.js authors, MIT (licenses/LICENSE-three.js-MIT.txt).
- Rapier 0.21.0 (`@dimforge/rapier3d-compat`, games/trolley/vendor/rapier.mjs, its WebAssembly inside; the source-map line removed):
  Copyright 2020 Dimforge EURL, Apache-2.0 (licenses/LICENSE-Rapier-Apache-2.0.txt).
- The room, the staircase, the ramp, the world's ground, walls, blocks, lamp posts and containers, and their textures are drawn by the game's own code.

## Typefaces and the app's own art

- Typefaces: p0pc0rn includes no font files. Its text is shown in the fonts already on your device (the system font, for example
  San Francisco on Apple devices, Roboto on Android and Segoe UI on Windows), which come with your operating system under its own
  licence.
- The home-screen icons and the default wallpaper (icons/ui/, wallpapers/; 3.9) are AI-generated: made for p0pc0rn with FLUX.2
  [klein] 9B by Black Forest Labs, from composition sketches drawn for p0pc0rn. That model's licence claims no rights in its outputs
  (FLUX Non-Commercial License 2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md).

## Make HDR (v4)

- HDR copies use Hybrid Log-Gamma (HLG), the HDR system developed by the BBC and NHK and standardised as ITU-R BT.2100 and ARIB
  STD-B67. The BBC describes HLG as royalty-free. p0pc0rn writes HLG only (no PQ / HDR10).
- A clip's HDR copy is encoded by the phone's own video encoder through the browser (WebCodecs); p0pc0rn ships no video encoder. Its MP4
  writer, its picture writer (a JPEG with a gain map in the hdrgm XMP and ISO 21496-1 layouts) and the two looks, Vivid and Bright, are
  p0pc0rn's own code and its own curves (not the formulas of ITU-R BT.2446).

## Full licence texts

Apache-2.0: licenses/LICENSE-Apache-2.0.txt (and the per-model copies next to it; Rapier: LICENSE-Rapier-Apache-2.0.txt). MIT: licenses/LICENSE-ACE-Step-1.5.txt,
LICENSE-MuseTalk-MIT.txt, LICENSE-Whisper-MIT.txt, LICENSE-sd-vae-ft-mse-MIT.txt, LICENSE-TOON-MIT.txt, LICENSE-three.js-MIT.txt. CC BY 4.0 (the Nowcast's
model, the trolley model and the trolley's props): licenses/LICENSE-CC-BY-4.0.txt, with licenses/NOTICE-nowcast.md,
licenses/NOTICE-trolley-model.md and licenses/NOTICE-trolley-props.md. BSD-2-Clause (CMUdict, Juli's voice): licenses/LICENSE-cmudict-BSD-2-Clause.txt.
Flite (BSD-style), Emscripten (MIT) and musl (MIT), Juli's voice in Troll-E: licenses/LICENSE-flite.txt, licenses/LICENSE-emscripten.txt,
licenses/LICENSE-musl-MIT.txt, licenses/LICENSE-cmu_us_slt.txt (its voice). Gemma: GEMMA_TERMS_OF_USE.txt,
GEMMA_PROHIBITED_USE_POLICY.txt, NOTICE-Gemma.txt. LTX-2: LICENSE-LTX-2.txt. CC BY-SA 4.0: the starter pack's LICENSE.
LGPL-2.1: licenses/LICENSE-p5js-LGPL-2.1.txt. OpenMDW-1.1 (the Bigger brain and voice input): licenses/LICENSE-OpenMDW-1.1.txt,
licenses/NOTICE-Nemotron-Bolt-E4B.md and licenses/NOTICE-Nemotron-ASR.md.
