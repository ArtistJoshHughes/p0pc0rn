# Pocket Flux engine: notices

- Engine code (pocketflux-engine.js, opfs_worker.js, engine_mock.js): the Pocket Flux authors; clean-room WGSL/JS written from spec/SPEC.md.
- Bundled inside pocketflux-engine.js: `@huggingface/tokenizers` 0.2.0 (tokenizers.js), Copyright Hugging Face, Inc., Apache-2.0,
  unmodified (engine/vendor/tokenizers.min.mjs in the sources). Full licence text: LICENSE-tokenizers.txt.
- Model weights are NOT in this folder. They are downloaded at run time from the Pocket Flux pack, which carries its own LICENSE,
  NOTICE.md and README.md: FLUX.2 [klein] 4B and the FLUX.2 autoencoder, Copyright Black Forest Labs, Apache-2.0; Qwen3-4B text
  encoder and tokenizer, Copyright 2024 Alibaba Cloud, Apache-2.0. The pack holds 4-bit/8-bit re-quantised derivatives, not the originals.
- p0pc0rn v018: pocketflux-engine.js also bundles the i2v module 0.2.0 (engine/i2v/*.js: still encoder, frame-conditioned DiT, i2v pipeline,
  i2v engine; same authors, written from the p0pc0rn i2v spec and the official NVlabs Sana `task=ltx` mechanism). Its weights,
  the picture reader (a modified LTX-2.3 VAE encoder, Copyright Lightricks, LTX-2 Community License Agreement), come from their own pack
  with its own LICENSE-LTX-2.txt and NOTICE.md; see licenses/NOTICE-video.md in the app.
- p0pc0rn v019: two more engines as plain ES-module trees (not bundled): `llm/` (the assistant: Gemma 4 E2B runner, tokenizer, chat template,
  vision tower; same authors) and `music/` (ACE-Step 1.5 turbo DiT, text / lyric encoders, Oobleck decoder, the 5 Hz LM planner, the m4a
  muxer; same authors), with their shared `core/`, `ops/`, `audio/`, `models/` files and `vendor/tokenizers.min.mjs` (@huggingface/tokenizers,
  Apache-2.0, unmodified; vendor/LICENSE-tokenizers.txt). Weights come from their own packs: Gemma 4 E2B-it (Google, Apache-2.0;
  licenses/NOTICE-Gemma-4.md) and ACE-Step 1.5 + Qwen3-Embedding-0.6B + the 5 Hz LM (MIT / Apache-2.0; licenses/NOTICE-music.md).
