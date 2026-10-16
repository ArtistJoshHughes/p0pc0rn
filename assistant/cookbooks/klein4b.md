# Pictures: FLUX.2 [klein] 4B

## What the model is
- A 4-billion-parameter image model that makes a picture from words (make_picture) or changes a picture (edit_picture).
- On this phone it takes 4 steps (Best) or 3 steps (Fast, a little softer). A wide 1280x720 picture takes about 2.5 to 3 minutes; 512x512 takes under a minute.
- It reads plain English sentences. It does not know facts: a name it has not seen becomes a guess. Use research for real places and things, then describe what they LOOK like.

## Sizes
- wide = 1280x720 (default), tall = 720x1280 (phone screens, stories), square = 768x768.
- Quick sizes (960x544, 544x960, 512x512) are for drafts or when the phone is hot.
- Faces and small details need room: a face that fills less than a tenth of the frame often comes out blurred or wrong.

## Writing the prompt
One paragraph, 30 to 90 words, in this order:
1. Subject first: who or what, doing what. "An old fisherman mending a red net on a dock" beats "a dock scene".
2. Setting: place, time of day, season, weather.
3. Light: name the source and direction ("low sun from the left", "soft window light", "neon from a sign above").
4. Framing: wide shot, medium shot, close-up; eye level, low angle; "shallow depth of field" for a soft background.
5. Style: ONE medium (photograph, film still, watercolour, linocut print, 3D render, pixel art).
6. Colour: two or three colours that matter.
Write what you WANT to see. "No people" often adds people; say "an empty street" instead.

## Rules that save rerolls
- Give each person their own sentence (age, clothes, pose). Words about one person bleed onto the next.
- For people, write "natural healthy skin". Never "macro", "pores", "film grain" or "real textures": they invent blemishes and age.
- Text in the picture is fragile: at most 1 to 3 short words, in quotes, on a big flat surface ("a shop sign that says "OPEN""). Screens and phones: "a softly glowing screen", no readable text.
- Count small: 1 to 3 main subjects. Crowds are fine as "a crowd"; exact counts above 3 fail.
- Hands: keep them simple (holding one object, resting). Complex finger poses fail.
- One style word only. Mixing "photo" with "oil painting" gives mush.

## Editing a picture (edit_picture)
- Write the change as an instruction plus what must stay: "Make the jacket red. Keep the face, pose and background the same."
- keep: "loose" follows your words more (faster); "close" copies the photo more exactly (slower).
- The photo is centre-cropped to the output shape. Pick the shape that matches the photo.
- Only edit photos the person put in and ticked the rights box for, or results made here.

## What fails
- Long text, logos, maps, diagrams, clocks with a set time, mirrors, chess boards.
- Two people touching or hugging (limbs merge); three or more faces close-up.
- Exact likeness of anyone: never try (see the safety rules).

## Review (look_at_result)
Look at the picture and check, in order:
1. Is the main subject there and doing what was asked?
2. Anatomy: extra or missing fingers, limbs, eyes; melted faces.
3. Garbled text or signs that should have been blank.
4. Framing: a head or the subject cut off at the edge.
5. Style and colours as asked.
Reroll only for a real problem, and write a fix_prompt that changes the cause (simpler pose, fewer subjects, bigger face, shorter text). Small flaws: accept.

---
Sources: FLUX.2 [klein] 4B model card, huggingface.co/black-forest-labs/FLUX.2-klein-4B (Apache-2.0; 3.876 B parameters; text-to-image and editing; card caveats on text rendering and prompt style), read through a research agent, Oct 12 2026. Phone timings and the 4-bit text finding: p0pc0rn engine measurements (iPhone 16 Pro Max, Oct 11 2026). Skin, text-on-screens and prompt-bleed rules: lessons from the picture lane, rewritten.
