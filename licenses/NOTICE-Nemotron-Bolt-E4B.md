# The Bigger brain: NVIDIA Nemotron 3.5 Bolt E4B

p0pc0rn's optional Bigger brain runs **NVIDIA-Nemotron-3.5-Bolt-E4B** by NVIDIA Corporation. Juli writes and plans with it. It reads and
writes text only: pictures always go to Juli's own model (Gemma 4 E2B-it). Source: https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16

## Licence

NVIDIA's model card, "License/Terms of Use", as published at the revision below:

> **Governing Terms:** Use of this model is governed by the OpenMDW License Agreement, version 1.1. This model has been post-trained on
> the Google Gemma 4 model, and use of the Google Gemma 4 model is governed by Apache License, Version 2.0

The card links the agreement at https://github.com/OpenMDW/OpenMDW/blob/main/1.1/LICENSE.OpenMDW-1.1 and says: "This model is ready
for commercial or non‑commercial use." It describes the model as "further post-trained from Gemma-4-E4B-it by NVIDIA". The Gemma 4
base model (google/gemma-4-E4B-it, Google) is Apache-2.0: LICENSE-Gemma-4-Apache-2.0.txt.

The full agreement is LICENSE-OpenMDW-1.1.txt in this folder: the publisher's own text, from github.com/OpenMDW/OpenMDW,
1.1/LICENSE.OpenMDW-1.1 at commit 9067ba54b2f84bc9e15a05734f570ec88e9f445d (committed 2026-05-19), the link the card gives; sha256
2ab44b68365473c112f5092211a38f231cb23e50de68b75a13369adbd76a74df. In plain words: keep a copy of the agreement and NVIDIA's notices
with any copy of the model; it puts no limits on what you make with it.

## Modified files

The pack p0pc0rn downloads contains 4-bit group-wise re-quantised, row-fused (q|k|v and gate|up) and re-laid-out versions of the
original weights, produced by the p0pc0rn packer (pocketflux.pack/1). The tokenizer is converted to the engine's compact tokenizer
format; NVIDIA's chat template is kept as a reference copy. The pack carries this notice: "Modified by the p0pc0rn project: converted
and quantized from the original weights." They are not the original files. This is not an official NVIDIA product, and NVIDIA has not
endorsed it. "NVIDIA" and "Nemotron" are NVIDIA trademarks; no trademark rights are granted.

Source: nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16, revision 49843eed8db1f1c616c47af75cfd36e07aec0667,
model-00001-of-00001.safetensors sha256 15006dbbfc99dbde9cc3fb5742b08976837b6ddc9db05b1ceb8b223de8cfc520.

## Its drafter

The Bigger brain's drafter is Google's Gemma 4 E4B MTP drafter (google/gemma-4-E4B-it-assistant, Google, Apache-2.0:
LICENSE-Gemma-4-Apache-2.0.txt). Its pack holds 8-bit layers and a 4-bit head, made by the same packer. It only guesses a few words
ahead; the Bigger brain checks every guess, so each word is still the Bigger brain's own choice.

Source: google/gemma-4-E4B-it-assistant, revision 8d0031ea8c2109e2b1e86bb9368a4539b537f80a, model.safetensors
sha256 12875062fc25c51e8fa9b62abd2de7ad48b7d63f8559d5d604fbd5a3d6bcff16.
