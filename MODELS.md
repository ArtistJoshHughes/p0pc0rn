# p0pc0rn models and their licenses — DRAFT

> DRAFT, October 14, 2026. Verified against each publisher's own license files, model cards and license pages on
> October 14, 2026. Not legal advice. Re-check before each release; licenses and gating change.

p0pc0rn's own code is under `LICENSE.md`. Each model the app downloads or runs is governed only by its own license.
Where a model's license limits how you may use it or its outputs, that limit applies to you.

How models reach your phone: every model in this build allows redistribution, so your phone downloads a
ready-converted p0pc0rn pack from the p0pc0rn repositories on Hugging Face (huggingface.co/JoshHughes). You accept
that model's terms in the app first. Each pack carries the model's license, its notices and a note that it was
converted and quantized by the p0pc0rn project. A model whose license does not allow redistribution is not offered
as a ready-made pack.

**Status key:**
- **GREEN:** fine as used; outputs can be used commercially.
- **YELLOW:** usable with the conditions listed.
- **RED:** not shipped.

| Feature | Model | Weights license | Commercial use of outputs | Conditions | Status |
|---|---|---|---|---|---|
| Pictures | black-forest-labs/FLUX.2-klein-4B | Apache-2.0 | Yes | Apache notice. No Black Forest Labs / FLUX trademarks in ways that imply endorsement. | GREEN |
| Better pictures (optional) | black-forest-labs/FLUX.2-klein-9B, with Qwen/Qwen3-8B as its text encoder (Apache-2.0) | FLUX Non-Commercial License v2.1 (Black Forest Labs) | FLUX.2 klein 9B is under Black Forest Labs' FLUX Non-Commercial License. BFL says you may use outputs "for any purpose (including for commercial purposes)" (§2(d)), and limits use of the model itself to non-commercial purposes (§1(c), §4(a)). Read the licence before using it for business. The 4B model is Apache-2.0. | You accept the FLUX Non-Commercial License at download. The converted pack carries the licence, BFL's attribution notice and a note that it was modified. | YELLOW |
| Video | Efficient-Large-Model/SANA-Video_2.0_5B_720p (+ _4step) | Apache-2.0 (Copyright 2024 Nvidia) | Yes, but every video also passes through the two models below | Apache notice. Inherits the Gemma 2 and LTX-2 conditions below. | YELLOW |
| Video text encoder | google/gemma-2-2b-it | Gemma Terms of Use (last modified 1 Apr 2026) + Gemma Prohibited Use Policy | Yes ("Google claims no rights in Outputs") | Ready-converted pack under the Gemma Terms of Use, which you accept in the app before download. The Prohibited Use Policy applies to you. Notice: "Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms" | YELLOW |
| Video decoder | Lightricks/LTX-2.3 (VAE) | LTX-2 Community License Agreement (5 Jan 2026) | Yes, within Attachment A ("Licensor claims no rights in the Output") | You accept the LTX-2 license and its Attachment A before download. Attachment A bars, among others, deepfakes without consent and content that isn't disclosed as machine-generated. Organisations with $10M+ annual revenue need a paid license from Lightricks. No Lightricks trademarks. | YELLOW |
| Assistant | google/gemma-4-E2B-it | Apache-2.0 (Gemma 4 license page) | Yes | Apache notice. Not gated. | GREEN |
| Knowledge search | Qwen/Qwen3-Embedding-0.6B | Apache-2.0 | Yes | Apache notice. | GREEN |
| Music | ACE-Step/Ace-Step1.5 + ACE-Step/acestep-5Hz-lm-0.6B | MIT ("Copyright (c) 2026 ACEStep"); Qwen-based parts Apache-2.0 | Yes ("You can strictly use the generated music for commercial purposes") | MIT + Apache notices. The publisher asks you to check originality and disclose AI involvement. | GREEN |
| Voice | Qwen/Qwen3-TTS-12Hz-0.6B-Base | Apache-2.0 ("Copyright 2026 Alibaba Cloud") | Yes | Apache notice. p0pc0rn's own rule: only clone your own voice, or a voice you have permission to use; no impersonation. | YELLOW |
| Lip-sync (experimental) | TMElyralab/MuseTalk 1.5, with stabilityai/sd-vae-ft-mse (MIT), openai/whisper-tiny (MIT) and Google MediaPipe face models (Apache-2.0); p0pc0rn does not use BiSeNet, DWPose or S3FD | MIT (Tencent Music); the HF tag says CreativeML OpenRAIL-M, so its use restrictions are applied as a precaution | Yes per the publisher's README | Experimental feature. Only for faces and voices of people who have consented (Cast members or your own ticked uploads). | YELLOW |
| Sound (not shipped) | hkchengrex/MMAudio (+ apple/DFN5B-CLIP) | CC BY-NC 4.0; Apple research-only license | No | Not shipped. | RED |
| Starter knowledge pack | Wikipedia text | CC BY-SA 4.0 | Facts: yes. Quoted text: attribution required. | The pack is licensed CC BY-SA 4.0, with article credits. | YELLOW |
| Live research | Fandom wiki text | CC BY-SA 3.0 by default; some wikis differ | Facts: yes. Quoted text: attribution required. | Quotes are shown with a link to the article. Wikis under NC or ND licences aren't used. | YELLOW |
| Data format | TOON (toon-format/toon), modified fork | MIT ("Copyright (c) 2025-PRESENT Johann Schopplich") | n/a | Keep the MIT notice. | GREEN |

## What every user should know

- **AI disclosure.** Videos are decoded by the LTX-2.3 decoder. Its license (Attachment A) requires machine-generated
  content to be clearly disclosed as machine-generated when you use or share it. The music model's publisher asks the
  same.
- **People.** Don't make deepfakes, voice clones or lip-syncs of anyone without their consent (LTX-2 Attachment A,
  p0pc0rn Use Policy).
- **Large organisations.** If your organisation has annual revenue of $10M or more, LTX-2 requires a paid license from
  Lightricks to use the video feature.
- **Your outputs.** No model license claims your outputs. Whether they can be protected by copyright depends on the law
  where you are and on your own human contribution (see `LICENSE.md` section 5).

Full license texts are in `licenses/`; copyright notices are in `NOTICE`.
