# The assistant model: Gemma 4 E2B-it

p0pc0rn's assistant runs **Gemma 4 E2B-it**, Copyright Google LLC, licensed under the **Apache License 2.0**
(LICENSE-Gemma-4-Apache-2.0.txt, the copy Google ships with the model). Source: https://huggingface.co/google/gemma-4-E2B-it

This is NOT the Gemma Terms of Use. Those terms (GEMMA_TERMS_OF_USE.txt) cover the video model's separate Gemma-2-2B-it text encoder only.

## Modified files

The model pack p0pc0rn downloads contains 4-bit group-wise re-quantised, row-fused (q|k|v and gate|up) and re-laid-out versions of the
original Gemma 4 E2B-it weights, produced by the p0pc0rn packer (pocketflux.pack/1). They are derivative works under Apache-2.0 Section 4.
The tokenizer is converted to the engine's compact tokenizer format; the chat template is shipped verbatim. "Gemma" is a Google trademark; no trademark rights are granted.

Source: google/gemma-4-E2B-it, revision 3e22461f65e89153144f8adb70e3b8c2cc9845a7, model.safetensors
sha256 2db5482b20d746879bb3ef79b5203e9075a2e2b98f54ec7c2f281c1477ddc550.

## Lookups

When the assistant looks something up, the words of the lookup are sent to Wikipedia (text under CC BY-SA 4.0) or to a Fandom wiki
(text under CC BY-SA, as each wiki states). Nothing else leaves the phone. Answers that use a page cite it: its title, a link to the
revision read, a link to its authors (the page history) and its licence.
