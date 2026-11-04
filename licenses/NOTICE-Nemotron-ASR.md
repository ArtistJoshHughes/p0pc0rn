# Voice input: NVIDIA Nemotron 3.5 ASR Streaming 0.6B

p0pc0rn's voice input (the mic in Juli's chat) runs **Nemotron 3.5 ASR Streaming 0.6B** by NVIDIA Corporation. It turns your speech into
text on the phone, in 40 language-locales; your voice never leaves the phone and is never kept. Source:
https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b

## Licence

NVIDIA's model card, "License/Terms of Use", as published at the revision below:

> Governing Terms: Use of the model is governed by the OpenMDW-1.1 license.

The card links the agreement at https://openmdw.ai/license/1-1/ and says: "This model is ready for commercial use."

The full agreement is LICENSE-OpenMDW-1.1.txt in this folder: the publisher's own text (the same agreement as the page NVIDIA's card
links; that page differs only in using a curly apostrophe), sha256 2ab44b68365473c112f5092211a38f231cb23e50de68b75a13369adbd76a74df. In
plain words: keep a copy of the agreement and NVIDIA's notices with any copy of the model; it puts no limits on what you make with it.
The rights end for anyone who sues claiming the model infringes a patent or copyright.

## Modified files

The pack p0pc0rn downloads (made by tools/stt_pack.py, pocketflux.pack/1) holds 8-bit (one fp16 scale per 64 weights) re-quantised and
re-laid-out versions of the original weights, with the language prompt folded into a per-language bias, prompt_projector.linear_2 and
encoder_projector folded into one linear, the relative-position projection turned into a table, and the vocabulary converted to the
engine's JSON. The pack carries this notice: "Modified by the p0pc0rn project: converted and quantized from the original weights." They
are not the original files. This is not an official NVIDIA product, and NVIDIA has not endorsed it. "NVIDIA" and "Nemotron" are NVIDIA
trademarks; no trademark rights are granted.

Source: nvidia/nemotron-3.5-asr-streaming-0.6b, revision ea30d66debe3740a08b573244286791d423d6b3e, model.safetensors
sha256 9eebdd6590289cb3030f310858f3df93256600a800a3e8200c5993d5f967e174, tokenizer.json
sha256 3f3d481deb073b64c2082e8c7860d487a3a62774bf4e9e4faac83007e181f246.
