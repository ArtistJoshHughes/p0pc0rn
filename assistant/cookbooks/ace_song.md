# Songs: ACE-Step 1.5 turbo

## What the model is
- A music model: a style description (tags) plus optional lyrics in, a finished song with vocals out. A small lyrics planner (on when it is downloaded) lays the words onto the beat.
- On this phone songs are 10 to 60 seconds: 60 (the Instagram length) unless the person asks for a length. A 10-second song holds about two short lines. A 60-second song should take a minute or two.
- Its makers trained it on licensed, royalty-free and synthetic music, but any music model can drift close to an existing style. Never ask it to sound like a named artist or song.

## Tags (the style)
Comma-separated, 6 to 12 tags, most important first:
- genre and sub-genre ("synthwave, retro pop"),
- mood ("wistful", "triumphant"),
- 2 to 4 instruments ("analog synth bass, gated drums, electric piano"),
- the voice ("male vocal", "female vocal", "duet", or "instrumental"),
- delivery words for the voice ("breathy", "powerful") belong HERE, not in the lyrics.
No artist names, band names or song titles in tags. The tempo goes in bpm, not in the tags.

## Tempo, key and metre
- Always give bpm, chosen for the style: ballad 70 to 85, hip hop 85 to 100, pop 100 to 120, house 120 to 128, drum and bass 170 to 175.
- key ("A minor", "E major") and time_signature (4/4, 3/4, 6/8) are optional. Missing values become 120 BPM, C major, 4/4, which suits few ballads, so pick them on purpose.

## Lyrics structure
- Each section starts with a marker on its own line: [intro] [verse] [pre-chorus] [chorus] [bridge] [outro]. Also allowed: [hook] [break] [inst] [solo].
- Markers stay plain: write "[chorus]", never "[chorus - powerful]" or "[Verse 2: soft]". Extra words inside the brackets made a music model drop whole choruses (in testing, normalising markers took a song from 26 to 43 of 46 lines sung). The app normalises markers anyway.
- Fit the lines to the length: at most (seconds - 6) x bpm / 480 sung lines. Markers do not count. That is 6 lines for 30 seconds at 120 BPM; for 60 seconds, about 10 at 90 BPM, 13 at 120, 14 at 128. Longer lyrics get skipped or rushed, and the app trims them.
- Shape: verse, chorus, short verse, chorus. Never two identical choruses back to back (they scored worse). End on a chorus: a lone verse at the end tends to go unsung.
- Short lines (6 to 10 syllables) sing best. Repeat the chorus words exactly; the hook line is the song's title idea.
- Instrumental: leave lyrics empty and put "instrumental" in the tags.

## Grounded songs
- A song about a real person, place, event, ship, building or work, or about a character or franchise, is looked up first (Wikipedia, or the franchise's Fandom wiki). Its FACTS come with the request.
- Build the lyrics from 3 to 5 of those facts: names, dates, places, numbers, details. Use no other facts: never invent a date, a name or a number.
- Turn each fact into a sung image, not a list: "November gales on Lake Superior" rather than "it sank in 1975".
- Songs about the person's own life, family, friends or pets, or about a feeling or a season, are written from the request alone.
- Never quote an existing song's lyrics or the source's words. Style tags name a genre, an era and instruments, never an artist.

## Writing words that are not cliches
- Use concrete, specific images from the person's request.
- Do not mention coffee, cups, mugs or cafes unless the person asked for them. Avoid stock filler ("neon lights", "heart on fire", "ghost", "gold", "sunrise") unless it fits the brief.
- Never copy lines from existing songs.

## For a music video
- Put the hook in the first 15 seconds: open on the chorus or a short [hook] before the first verse.
- 30-second video: [chorus], [verse], [chorus] within the line budget. 60 seconds: [verse], [chorus], [verse] (short), [chorus].

## Review
- The assistant cannot listen to songs. Accept the take, tell the person, and offer another seed if they do not like it.

---
Sources: ACE-Step 1.5 Hugging Face card, huggingface.co/ACE-Step/Ace-Step1.5, and GitHub README, github.com/ace-step/ACE-Step-1.5 (MIT; turbo DiT + Qwen3-Embedding-0.6B + VAE + optional 5 Hz lyrics LM; 10 s to 10 min; 50+ languages; training data licensed / royalty-free / synthetic MIDI; caveat: unintentional similarity to existing styles), read through a research agent, Oct 12 2026. Line budget, tempo defaults and structure: p0pc0rn music probe v002 (Oct 12 2026, the 5 Hz LM 0.6B planner on: lines heard 21 to 35 of 40; back-to-back identical choruses scored worse). Marker and end-on-chorus rules: the song-lane measurements (Sep 23 2026), rewritten. No-coffee rule: Josh, Oct 8 2026.
