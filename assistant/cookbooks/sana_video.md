# Clips: SANA-Video 2.0 5B

## What the model is
- make_clip: words in, a silent clip out. animate_picture starts from a picture; clip_between runs from one picture to another (see below).
- 16 frames a second, 1 to 5 seconds. On this phone a 5-second 832x480 clip takes about 6 minutes, longer when the phone is warm.
- Shapes: wide = 832x480 (default), tall = 480x832. Bigger sizes are slow and can run out of memory.
- Downloading it needs a one-time, free Hugging Face login (Google's Gemma 2 terms; read-only token kept on the phone). See the FAQ.
- It was trained on long, concrete visual descriptions, so a detailed paragraph works better than a short phrase.

## Writing the motion prompt
One paragraph, 50 to 110 words, present tense:
1. The scene: place, time, light, mood in one sentence.
2. The subject and how it looks (colours, clothes, materials).
3. ONE main action, as a short sequence: "the heron lifts one leg, steps forward, then spears the water".
4. ONE camera behaviour, in plain words: "The camera holds still", "The camera slowly moves closer to the heron", "The camera follows the cyclist from the side", "The camera pans left across the harbour".
5. The ending sentence (see below).

## The clip ends with
Finish every motion prompt with one sentence that starts "The clip ends with" and states the LAST frame:
- where the subject is and its final pose,
- what the background motion is doing at that moment,
- how the shot is framed when the camera stops.
Example: "The clip ends with the heron standing still, a small fish in its beak, ripples spreading across the water, framed in a medium shot."
Why: a clear end state stops the motion drifting back toward the start. (Learned on another video model, where it gave the smoothest clips; keep it here unless reviews show it hurts.)

## Camera grammar
- Safest: a still camera. Then: a slow move closer, a pan, a tilt down, following a moving subject.
- One camera move per clip. Two moves in 5 seconds look frantic.
- Say what the frame does, not the rig: avoid "dolly", "truck", "jib", "crane" (rig words get painted into the scene on similar models).
- Avoid "orbit" / "circle around": on similar models the subject spins on the spot instead of the camera moving.
- Avoid extreme close-ups of faces and fast zoom-outs: faces deform.

## Matching the length
- 1 to 2 seconds: one gesture (a blink, a turn of the head, a wave breaking).
- 3 seconds: one action.
- 5 seconds: one action and a settle. Never three events in five seconds.

## Animating a picture (animate_picture)
- The picture IS the first frame. Do not describe it again in detail: name the subject in a few words, then say what MOVES and what the camera does. "The fox lifts its head and turns its ears toward a sound; snow drifts across the frame. The camera holds still."
- Choose motion the picture can support: small actions, wind, water, light changing, a slow move closer. Avoid turning around, walking out of frame or moving the camera back: the model must invent what the picture does not show, and faces and details drift.
- Keep "The clip ends with" for the last frame. The clip takes the picture's shape (a tall picture makes a tall clip).

## Between two pictures (clip_between)
- The first and last pictures are fixed. The prompt describes the CHANGE between them: what moves, in what order, and the camera's path. "She walks from the doorway to the window and turns toward the light."
- It works best when both pictures share the place or the subject (one character in two poses; one street by day and by night). Very different pictures give a dissolve or a morph.
- End with "The clip ends with" describing the LAST picture.

## What fails
- Readable text, logos, numbers on screens. Write "a glowing screen".
- Hands doing fine work, people touching, crowds that interact, objects passing behind other objects (they vanish or merge).
- Long or abstract prompts: "the feeling of hope" shows nothing. Describe what the camera sees.

## Review (look_at_result)
You get the first, middle and last frame. Check:
1. The same subject in all three frames (no swap, no melting).
2. The asked action actually happens (the frames differ in the right way).
3. Anatomy and faces hold together.
4. The last frame matches "The clip ends with".
Reroll for a missing action, a subject swap or broken anatomy. In the fix_prompt simplify the action or make the camera still.
For animate_picture and clip_between, the first (and last) frame should also match the picture(s) it was made from.

---
Sources: SANA-Video 2.0 5B 720p 4-step model card, huggingface.co/Efficient-Large-Model/SANA-Video_2.0_5B_720p_4step (Apache-2.0; text-to-video only; 81 frames at 16 fps; Gemma-2-2B-it text encoder with a detailed-description instruction; card caveats on motion, anatomy, text, object permanence and long prompts), read through a research agent and the pack's card copy, Oct 12 2026. Phone timing: p0pc0rn estimate. SANA-Video 2.0 5B 720p base card (huggingface.co/Efficient-Large-Model/SANA-Video_2.0_5B_720p: text-image-to-video; "image-conditioned generation can drift from fine details in the source image"). Ending-frame and camera-word rules: adapted from an LTX camera cookbook and "the clip ends with" rule; picture-start and two-picture rules: adapted from a first/last-frame lane and identity notes (never move back from a face). None measured on SANA-Video yet.
