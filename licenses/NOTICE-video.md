# Pocket Video pack - notices

This pack is a mixed-licence bundle of MODIFIED model weights. Every weight file (*.pfw) was re-quantised (4-bit / 8-bit group-wise)
and re-laid-out by the Pocket Video packer (pocketflux.pack/1); they are not the original files.

- SANA-Video 2.0 5B 720p 4-step (DiT): Copyright NVIDIA Corporation, Apache-2.0 (LICENSE-SANA-Video.txt).
  Source: https://huggingface.co/Efficient-Large-Model/SANA-Video_2.0_5B_720p_4step . Modified: 4-bit re-quantised by Pocket Video.
- Gemma-2-2B-it (text encoder; te.* files and tokenizer): Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms. Copies: GEMMA_TERMS_OF_USE.txt,
  GEMMA_PROHIBITED_USE_POLICY.txt, NOTICE. Modified: 8-bit (embedding 4-bit) re-quantised by Pocket Video. Use is subject to the
  Gemma Prohibited Use Policy; those restrictions are part of the app's terms of use.
- LTX-2.3 video VAE decoder (vae.dec.* files): Copyright Lightricks, LTX-2 Community License Agreement (LICENSE-LTX-2.txt, complete copy).
  Source: Lightricks/LTX-2.3 at revision 3c6a4e66e5d0a684231950b9c74dd4ded7b6fadc (ltx-2.3-22b-dev.safetensors: its vae.* tensors), https://huggingface.co/Lightricks/LTX-2.3.
  Modified: 8-bit re-quantised by Pocket Video; this derivative is distributed only under that Agreement, and its use restrictions
  (paragraph 4 and Attachment A) are part of the app's terms of use. Entities with annual revenue of USD 10 million or more need a
  separate commercial licence from Lightricks.

## The picture reader (p0pc0rn v018: clips from a picture, or between two pictures)

- LTX-2.3 video VAE ENCODER (the separate 213 MB "picture reader" pack, vae.enc.* files): Copyright Lightricks, LTX-2 Community License
  Agreement (LICENSE-LTX-2.txt, complete copy). Source: Lightricks/LTX-2.3 at revision 3c6a4e66e5d0a684231950b9c74dd4ded7b6fadc (ltx-2.3-22b-dev.safetensors: its vae.* tensors), https://huggingface.co/Lightricks/LTX-2.3.
  MODIFIED by the p0pc0rn packer: the causal 3-D convolutions are collapsed to single-frame 2-D kernels (time taps summed), conv_in is
  zero-padded, the down3 / mid residual stream is rescaled by 1/64 (compensated exactly by PixelNorm), and the weights are stored as
  16-bit floats; these are not the original files. This derivative is distributed only under the LTX-2 Community License Agreement;
  its use restrictions (paragraph 4 and Attachment A) are part of the app's terms of use. Entities with annual revenue of USD 10 million
  or more need a separate commercial licence from Lightricks.
- How a picture becomes a clip: the official SANA-Video 2.0 image-to-video mechanism (NVlabs Sana, `task=ltx`: the picture's latent
  replaces latent frame 0 and runs at timestep 0 through per-frame AdaLN), applied to the 4-step model p0pc0rn already ships. "Between
  two pictures" pins the last latent frame the same way (a p0pc0rn extension, not an official SANA mode).

## Where the LTX-2.3 weights come from (p0pc0rn v026.4)

Both LTX-2.3 parts (the decoder in the video pack, the encoder in the picture reader pack) are built from Lightricks' own repository,
Lightricks/LTX-2.3, which carries the LTX-2 Community License. Only the 170 `vae.*` tensors of ltx-2.3-22b-dev.safetensors are read
(range requests on the safetensors header), renamed to the Diffusers layout and converted as before. They are byte-identical to the copy
the packs were first built from (Efficient-Large-Model/LTX-2.3-Diffusers, which ships no licence), and so are the packs.
