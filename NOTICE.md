# p0pc0rn: notices

p0pc0rn, by Joshua Hughes. Its own code is under LICENSE.md (the p0pc0rn License 1.1). The models and the data it uses are not
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
- LTX-2.3: Lightricks, LTX-2 Community License Agreement.
- ACE-Step 1.5 (music) and its 5 Hz lyrics planner: Copyright (c) 2026 ACEStep, MIT; their Qwen3-based parts Apache-2.0.
- Qwen3-TTS (voice): Copyright 2026 Alibaba Cloud, Apache-2.0.
- TOON (the knowledge format p0pc0rn's fork extends): Copyright (c) 2025-PRESENT Johann Schopplich, MIT.
- Lip-sync (experimental): MuseTalk 1.5, Copyright (c) 2024 Tencent Music Entertainment Group, MIT (its card's CreativeML Open RAIL-M
  tag: p0pc0rn applies that licence's Attachment A use restrictions as part of its terms; licenses/LICENSE-CreativeML-OpenRAIL-M.txt); Whisper,
  Copyright (c) 2022 OpenAI, MIT; sd-vae-ft-mse, Stability AI, MIT (its card names no copyright holder); MediaPipe face models,
  Google, Apache-2.0.
- Tokenizers in the engine: Apache-2.0 (engine/LICENSE-tokenizers.txt).

## Full licence texts

Apache-2.0: licenses/LICENSE-Apache-2.0.txt (and the per-model copies next to it). MIT: licenses/LICENSE-ACE-Step-1.5.txt,
LICENSE-MuseTalk-MIT.txt, LICENSE-Whisper-MIT.txt, LICENSE-sd-vae-ft-mse-MIT.txt, LICENSE-TOON-MIT.txt. Gemma: GEMMA_TERMS_OF_USE.txt,
GEMMA_PROHIBITED_USE_POLICY.txt, NOTICE-Gemma.txt. LTX-2: LICENSE-LTX-2.txt. CC BY-SA 4.0: the starter pack's LICENSE.
