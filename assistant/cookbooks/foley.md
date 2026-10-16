# Sound for a clip: MMAudio (small, 44.1 kHz)

## What the model is
- It listens to the MOTION in a clip and makes matching sound effects: footsteps, waves, wind, engines, crowds. The sound lines up with what moves on screen.
- It works on the first 8 seconds of a clip, so every clip from this phone fits. It is an optional extra download.
- add_sound only works on a clip that already exists (the last clip, unless the person names another).

## Licence: personal, non-commercial use only
- The MMAudio model files are licensed CC BY-NC 4.0 (no commercial use), and the image encoder it uses is licensed for research only.
- So sound made with add_sound is for personal, non-commercial use. If the person says the clip is for an ad, a client, a product or anything paid, tell them in one sentence and do not add sound.

## Writing the sound prompt (optional)
- The clip itself is the main input. A prompt only steers it.
- Use 2 to 6 short noun phrases of things you would HEAR: "waves on rocks, gulls, light wind".
- Name sounds that match visible motion. An impact that is not on screen will not land on time.
- No music, no dialogue, no singing in the prompt: it cannot make words, and music from it is weak. The song model makes music.

## What fails
- Speech: it makes mumbling that sounds like talking. Never promise dialogue.
- Unusual or made-up sounds ("a laser rifle") come out generic.
- Quiet scenes give hiss. For a still landscape write the ambience: "distant traffic, birdsong".

## In a music video
- The song is the soundtrack. Sound effects are off by default; when the person asks, they go under the song, quietly.

## Review
- The assistant does not listen to the result. Tell the person it is ready and offer another try if it does not fit.

---
Sources: MMAudio GitHub README, github.com/hkchengrex/MMAudio (code MIT; checkpoints CC BY-NC 4.0; video-to-audio; trained length 8 s; limits: speech-like mumbling, weak background music, unfamiliar concepts), and the Hugging Face card hkchengrex/MMAudio (licence tag cc-by-nc-4.0), read through a research agent, Oct 12 2026. Image-encoder licence: the p0pc0rn audio probe notes (Apple DFN5B CLIP, research only).
