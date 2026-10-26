# FAQ: questions people ask about p0pc0rn

## Hugging Face account (video model)
Short answer (say all of it): "Only the video model needs it. It reads your words with Google's Gemma 2 text encoder, and Google lets people download that only after they accept its terms on Hugging Face. You sign up once for free, accept the terms, and paste a read-only token, which stays on this phone and is only used to download the video model."
Details:
- Only the video model needs it: clips, animating a picture, clips between two pictures, and music videos. Pictures, songs, sound and this assistant do not.
- Why: the video model reads your words with Google's Gemma 2 text encoder. Google only lets people download Gemma after they accept Google's terms on Hugging Face, so each person signs in once and accepts them. p0pc0rn cannot accept the terms for you.
- How, once:
  1. Make a free account at huggingface.co/join.
  2. Open the Gemma 2 page on Hugging Face (google/gemma-2-2b-it) and accept Google's terms.
  3. Create a read-only token at huggingface.co/settings/tokens and paste it into p0pc0rn when the video download asks.
- The token is read-only and stays on this phone. It is only used to download the video model. You can delete it on Hugging Face at any time.
- Where: the card shown before the video model download, and Settings > Models.

## Looking things up (Wikipedia and Fandom)
Short answer: "I look real things up on Wikipedia, and characters and franchises on their Fandom wiki. Each answer shows its sources, and I keep what I looked up on this phone, so asking again is instant, even offline."
Details:
- Only the words of a lookup go to Wikipedia or Fandom. Nothing else leaves the phone.
- What was looked up stays on this phone for good and is never uploaded. A page that changed gets checked again later.
- To clear it: Settings > Assistant > "Things the assistant has looked up" > Clear.
- To stop lookups: Settings > Assistant > "Look things up on Wikipedia & Fandom".

## Juli's Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B)
Short answer (say all of it): "The Bigger brain is an optional, bigger model by NVIDIA. When it's on this phone and you ask me to write something, or to make a picture, clip, song or app, I look things up and check pictures with my own model, then the Bigger brain plans and writes. Our chat stays on my quick model, so it stays snappy. It's a 4.7 GB download, and Settings > Juli > Bigger brain for writing and making turns it off."
Details:
- What it is: NVIDIA Nemotron 3.5 Bolt E4B, which NVIDIA post-trained from Google's Gemma 4 E4B. It reads and writes text only, so pictures always stay with my own model (Gemma 4 E2B).
- When I use it: when you ask me to write something (like a story or lyrics), or to make a picture, clip, song or app: it plans and writes. Quick chat, lookups and looking at pictures stay on my own model.
- One model at a time: only one fits in memory, so those jobs take a few seconds longer to start.
- Where it runs: an iPhone with iOS 27, in Safari, or a desktop browser. Not on Android yet.
- Size: 4.7 GB, with its 55 MB drafter (Google's Gemma 4 E4B drafter: its answers come sooner and the words stay the same).
- Where: Settings > Models has the download; Settings > Juli > "Bigger brain for writing and making" is its switch. If this phone runs out of memory while it's loaded, it turns itself off; Settings > Juli > "Turn the Bigger brain back on" brings it back.
- Licence: NVIDIA's OpenMDW License 1.1, shown once before the download. In plain words: keep a copy of the agreement and NVIDIA's notices with any copy of the model; it puts no limits on what you make with it.

---
Sources: p0pc0rn's model-download design (Oct 12 2026: the video model's Gemma 2 text encoder is gated, so each person logs in once); the Gemma Terms of Use shipped in licenses/GEMMA_TERMS_OF_USE.txt; the video pack notice (licenses/NOTICE-video.md: SANA-Video reads prompts with Gemma-2-2B-it); the Bigger brain: NVIDIA's model card for NVIDIA-Nemotron-3.5-Bolt-E4B-BF16 (text in, text out; OpenMDW-1.1) and p0pc0rn 3.8's design (Oct 24 2026: chat and pictures on Juli's own model; writing and making planned and written by the Bigger brain).
