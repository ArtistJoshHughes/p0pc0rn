# The music model: ACE-Step 1.5 turbo (+ the optional lyrics planner)

Songs are made on the phone with these models. Every weight in the packs p0pc0rn downloads is a re-quantised (pocketflux.pack/1:
q8 / q4 / f16 / f32) and re-laid-out copy, not the original file.

- **ACE-Step 1.5 turbo** (the 2B DiT and its condition encoder) and its **Oobleck audio decoder (VAE)**: © ACE Studio and StepFun (the
  ACE-Step team), **MIT licence** (LICENSE-ACE-Step-1.5.txt). https://huggingface.co/ACE-Step/Ace-Step1.5 ,
  code https://github.com/ace-step/ACE-Step-1.5 . The model card says training used licensed, royalty-free and synthetic (MIDI) data,
  and warns that a song can unintentionally resemble existing styles.
- **Qwen3-Embedding-0.6B** (the text encoder, as shipped inside the ACE-Step 1.5 repository): © Alibaba Cloud (Qwen team),
  **Apache-2.0** (LICENSE-Qwen3-Embedding-Apache-2.0.txt). https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
- **The lyrics planner** (optional, a separate 0.94 GB download): the ACE-Step **5 Hz LM 0.6B** and the ACE-Step 1.5 turbo
  audio-token detokenizer, © ACE Studio and StepFun, **MIT licence** (LICENSE-ACE-Step-1.5.txt: "Copyright (c) 2026 ACEStep").
  https://huggingface.co/ACE-Step/acestep-5Hz-lm-0.6B . The LM is built on **Qwen3-0.6B** (© Alibaba Cloud, **Apache-2.0**,
  LICENSE-Apache-2.0.txt), so its Qwen-based parts are also under Apache-2.0.
- The ACE-Step 1.5 repository is tagged MIT but bundles the Apache-2.0 Qwen3-Embedding-0.6B folder; p0pc0rn treats those parts as
  Apache-2.0 (above).

The lesson in the app (Settings › Rights & Copyright) and p0pc0rn's terms apply to songs as they do to pictures and clips.
