# p0pc0rn: notices

p0pc0rn, by Joshua Hughes. Its own code is under LICENSE.md (the p0pc0rn License 1.2). The models and the data it uses are not
part of p0pc0rn: each keeps its own licence, listed in MODELS.md, with the full texts in `licenses/` (Settings › About › Licences and
notices). Nothing here is legal advice.

## Required notices

- **Gemma 2** (the video model's text encoder, Gemma-2-2B-it): Gemma is provided under and subject to the Gemma Terms of Use found at
  ai.google.dev/gemma/terms
  - Copies: licenses/GEMMA_TERMS_OF_USE.txt and licenses/GEMMA_PROHIBITED_USE_POLICY.txt. The Prohibited Use Policy is part of
    p0pc0rn's terms (USE-POLICY.md).
- **LTX-2.3 video autoencoder** (Lightricks; the video decoder and the picture reader): the LTX-2 Community License Agreement, complete,
  with Attachment A (licenses/LICENSE-LTX-2.txt). The app shows it and asks you to accept it before it downloads either part.
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
- Gemma 4 E2B-it (the assistant): Google, Apache-2.0 (not the Gemma Terms of Use).
- Gemma 4 E2B-it MTP drafter ("faster replies", the assistant's add-on): Google, Apache-2.0.
- NVIDIA Nemotron 3.5 Bolt E4B ("Bigger brain"): NVIDIA Corporation, OpenMDW License Agreement 1.1; post-trained from Google's
  Gemma 4 E4B-it (Apache-2.0).
- Gemma 4 E4B-it MTP drafter (the Bigger brain's drafter): Google, Apache-2.0.
- LTX-2.3: Lightricks, LTX-2 Community License Agreement.
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

## Online data in apps

- Wallet Watch (3.9) reads public Avalanche C-Chain data from Snowtrace, the public Avalanche explorer, through the free API of
  Routescan (api.routescan.io). Powered by Routescan.io APIs:
  [routescan.io](https://routescan.io), [@routescan_io on X](https://x.com/routescan_io). The data is public blockchain data, shown for
  information only; it is not investment advice. p0pc0rn keeps to half of the API's free limits (at most 1 request a second and
  5,000 a day for all apps, 1,600 for one), and its apps look at most every 15 minutes, only when the phone is idle.
- Wallet Watch's icon (icons/apps/wallet-watch-180.png and -120.png; 3.9) is AI-generated like the home-screen icons: made for
  p0pc0rn with FLUX.2 [klein] 9B by Black Forest Labs, from a composition sketch drawn for p0pc0rn (FLUX Non-Commercial License
  2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md).
- The Games screen's Four in a Row cover (icons/games/connect-four-cover.png; 3.9) is AI-generated too: made for p0pc0rn with
  FLUX.2 [klein] 9B by Black Forest Labs (FLUX Non-Commercial License 2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md).

## Typefaces and the app's own art

- Typefaces: p0pc0rn includes no font files. Its text is shown in the fonts already on your device (the system font, for example
  San Francisco on Apple devices, Roboto on Android and Segoe UI on Windows), which come with your operating system under its own
  licence.
- The home-screen icons and the default wallpaper (icons/ui/, wallpapers/; 3.9) are AI-generated: made for p0pc0rn with FLUX.2
  [klein] 9B by Black Forest Labs, from composition sketches drawn for p0pc0rn. That model's licence claims no rights in its outputs
  (FLUX Non-Commercial License 2.1, section 2(d): licenses/LICENSE-FLUX-Non-Commercial-v2.1.md).

## Full licence texts

Apache-2.0: licenses/LICENSE-Apache-2.0.txt (and the per-model copies next to it). MIT: licenses/LICENSE-ACE-Step-1.5.txt,
LICENSE-MuseTalk-MIT.txt, LICENSE-Whisper-MIT.txt, LICENSE-sd-vae-ft-mse-MIT.txt, LICENSE-TOON-MIT.txt. Gemma: GEMMA_TERMS_OF_USE.txt,
GEMMA_PROHIBITED_USE_POLICY.txt, NOTICE-Gemma.txt. LTX-2: LICENSE-LTX-2.txt. CC BY-SA 4.0: the starter pack's LICENSE.
LGPL-2.1: licenses/LICENSE-p5js-LGPL-2.1.txt. OpenMDW-1.1 (the Bigger brain): licenses/LICENSE-OpenMDW-1.1.txt and
licenses/NOTICE-Nemotron-Bolt-E4B.md.
