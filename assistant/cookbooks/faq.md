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

## Talking to Juli (voice input)
Short answer (say all of it): "Yes: tap the mic beside Send and talk. Your words appear as you speak, and when you stop I get the message after a short pause, with Undo and Edit. It runs on this phone with NVIDIA's Nemotron 3.5 speech recogniser: your voice never leaves the phone and is never kept. It's a 640 MB download in Settings > Models > Voice input."
Details:
- What it is: NVIDIA Nemotron 3.5 ASR Streaming (0.6B), a speech recogniser that writes as you talk, with punctuation, in 40 language-locales (English, Spanish, French, German, Italian, Portuguese, Dutch, Turkish, Russian, Arabic, Hindi, Japanese, Korean, Vietnamese, Ukrainian, Polish, Swedish, Chinese and more).
- Your voice: it goes from the microphone straight to the recogniser on this phone and is dropped. Nothing is recorded, saved or sent anywhere; only the words you send become a message.
- The microphone: the phone asks once, the first time you tap the mic. To change that later: the phone's Settings > Apps > Safari > Microphone.
- Sending: about a second after you stop talking, the message goes; for a few seconds Undo or Edit takes it back. Settings > Juli > "Send when I stop talking" off keeps your words in the message box instead. Tap the mic again to stop listening.
- Language: Settings > Juli > "Language you speak": Automatic, or your language (a little more accurate).
- I answer out loud when you talk to me (Settings > Juli > "Juli speaks her replies"); Stop, over the message box, ends it, and tapping the mic does too. My voice is made on this phone as well.
- Where it runs: an iPhone with iOS 27 in Safari (my model then keeps all its layers in the second process, so the recogniser fits beside it), or a desktop browser.
- Licence: NVIDIA's OpenMDW License 1.1, shown once before the download.

## The weather
Short answer: "Ask me about the weather in a US city or town, or by ZIP code, and I read you the US National Weather Service forecast. Outside the US I can't give forecasts yet."
Details:
- Where: name a US city and its state ("Portland, Oregon"), or a ZIP code. With no place, I use your home ZIP (Settings > Juli > "Home ZIP for weather", or tell me "my ZIP is 10001" and say yes), then your phone's location only if you already let p0pc0rn use it. I never ask for your location from the chat.
- Privacy: the place's name and the ZIP stay on this phone (I find them in a US Census Bureau list kept here); only its rounded coordinates (about 1 km) go to the US National Weather Service (weather.gov).
- Two places with the same name ("Springfield"): I ask which one, or for a ZIP code. A much bigger one (Austin, Texas) I name with its state, so you can say another.
- Outside the US, or a place that is not in the list: I say the forecasts cover the US for now. I never make the weather up.
- A forecast is kept for 30 minutes, so asking again is quick. With lookups off (Settings > Juli > "Look things up on Wikipedia & Fandom") I can't check the weather either.

## How to ask Juli (making things, finding things)
- Make a picture (2 to 3 minutes): ask me in one sentence with the subject, the setting and a style: "Make a picture of a red fox in the snow at sunrise, watercolor". Add "tall" for a phone wallpaper, or "square". Or Create in the dock: Picture, describe it, Make.
- Make a clip (1 to 5 seconds, silent): "Make a 5-second clip of waves rolling onto a beach at dusk". After a picture, "Animate it" brings it to life.
- Make a song (10 to 60 seconds, with words or instrumental; it takes a couple of minutes): "Make a song about a road trip, upbeat folk, 30 seconds". I write the lyrics.
- Make a music video: make a song first, then tap Animate under the song.
- Edit your own photo: tap the photo button in the message bar, add the photo and tick that it is yours, then say the change: "Make the sky a sunset".
- Write something: "Write a short poem about autumn rain", "Write a birthday message for my mom".
- Ask a question: ask anything. I look facts up on Wikipedia and Fandom and show the sources.
- After a result: the bubbles under it offer Make again, Edit this, Animate, Save and Open in Library.
- Find what you made: the Library on the home screen keeps everything; songs also play in Music in the dock, with playlists.
- Settings: the gear in the dock. Each kind of model downloads once, in Settings › Models.
- Chats: Juli › Chats lists every conversation; the pencil there starts a new chat.
- Make an app: open Apps on the home screen, describe the app ("A packing list for a camping weekend"), then tap Make it.
- Change the wallpaper or move icons: press and hold an icon on the home screen, then tap Wallpaper, or drag the icons; Done when you are finished.
- Real people, famous characters and logos: I make an original take instead (Settings › Rights & Copyright explains why). People in your Cast are the exception: add yourself (or someone who agrees) in Settings › Cast, then name them ("a clip of Patrick in white clown face paint"). Costumes and makeup work as a description; a famous character's name does not.
- About me: I'm Juli, the assistant in p0pc0rn, an app by Joshua Hughes. I run on this phone (Google's Gemma 4 E2B), with no body and no fixed look.
- Remembering you: every conversation is kept in Juli › Chats, and what you write in Settings › Juli › About me I read in every chat; I don't remember anything else.

## Games: Four in a Row
- To play: tap Games on the home screen, then tap Four in a Row, then tap Play. Four in a Row is inside Games, not on the home screen itself.
- You are red and I'm yellow. I play to win, and every move is my own: the game reads the board for me and I pick.
- Beat me 10 times in a row to unlock a new opponent: me with the Bigger brain, if it is on this phone.
- The game keeps the score across games and can show you a hint.
- Make a game of your own: the Skeleton Guide's Game Kit lets an AI helper write one for p0pc0rn, and Apps › Import adds it.

## Wallet Watch (beta)
- What it is: an app that works for you. It watches public Avalanche addresses you add, wallets or contracts, and tells you what changed, in the app and in my chat. Once a day I describe a wallet's habits from its public history.
- Get it: Apps › Works for you › Wallet Watch (beta) › Get. You can add it to the Home Screen.
- What goes online: only public addresses, to Snowtrace, the public Avalanche explorer: the ones you add, and once a day a few they deal with most, to show their public names. Data: Snowtrace, Powered by Routescan.io APIs (routescan.io, @routescan_io on X).
- How often: at most every 15 minutes (every 30 to start), only while p0pc0rn is open from your Home Screen and your phone is idle; each copy of p0pc0rn sends Snowtrace at most 2,500 requests a day for all your apps, so even two copies stay within half its free limit. In a Safari tab it reads nothing from Snowtrace.
- It never gives advice, never touches a wallet and never guesses who is behind an address. It is a beta and will get more work.

## Token Watch (beta)
- What it is: an app that works for you. It shows the new tokens that rose most since they launched in the last hour, on the chains you pick (Avalanche to start; Solana, Base, Ethereum, BNB Chain and Arbitrum too, up to 3 at a time), and I sum it up in my chat. It says "rose most since launch", never "best".
- Get it: Apps › Works for you › Token Watch (beta) › Get.
- How it ranks, in code (not me): launched in the last hour, graduated to a real DEX pool (a token still on a launchpad's bonding curve is never shown) with at least $5,000 in liquidity, biggest rise since launch first, the top 5, with what GoPlus (EVM chains) or RugCheck (Solana) report. When nothing qualifies on a chain it says so and offers "Look back 6 hours".
- Watch closely: tap it in the app, or say "watch closely" or "watch Avalanche closely" here. Every 15 minutes while p0pc0rn is open I post only when a new token enters the top 5 or a safety flag changes; it stops after 2 hours or when p0pc0rn closes.
- What goes online: the chains you pick and public token addresses, each chain at most every 5 minutes, at most 12 requests a look.
- Snowtrace (Avalanche, at your tap): "Check on Snowtrace" checks a token once on Routescan: holders, a verified contract or not, and failed transactions among its last 100.
- Name references: a switch in the app, off until you turn it on. The Bigger brain checks whether a token's name refers to a character or thing on Wikipedia or Fandom, with the source. Not downloaded? The app offers it (free).
- Safety: p0pc0rn takes no responsibility for security or safety. It only relays the information GoPlus, RugCheck and Routescan report. Juli does not check contracts and cannot provide any safety information.
- Not financial advice. New tokens are very high risk and many are scams. It cannot buy, sell or swap anything.

## The home screen and your apps
- The dock holds Juli, Create, Music and Settings; the p0pc0rn pill above it opens my chat. Swipe in from the left edge to go back home.
- A card at the top means an app that works for you has something for you. Swipe it away and it comes back only with something new.
- Browser: a search box and bookmarks. Links open in your phone's own browser sheet, and searches go to DuckDuckGo.
- Cast: you and the people who agreed, added in Settings › Cast with their photos and voice. I make pictures and clips of them by name, and "make <name> say <line>" gives them your line in their voice.
- Skills: short texts that teach me how to do something. Six come with p0pc0rn; Skills › Import a skill adds yours, and "use my <name> skill" in a chat picks one.
- Change an app by asking: Apps › My apps › Change, then say what to change. Undo, or Versions for an earlier one.
- Which app goes first: Settings › Apps › Priority. Each app that works for you is High, Normal or Low; when several are due, High goes first and Low waits, never for long. Anything you ask me or make always goes first.
- Routines: Settings › Juli › Routines. Messages I run for you while p0pc0rn is open: when it opens, every few hours, or daily at a time.
- Connection: coming soon.
- Benchmark: Settings › Benchmark › Quick or Full tests this phone. Nothing is sent.

## Make HDR (HDR copies of pictures and clips)
- What it does: a picture or clip made in p0pc0rn gets an HDR copy that shines brighter on an HDR screen, like a recent iPhone's. The original stays as it is; the copy sits beside it in the Library, marked HDR.
- How: open the picture or clip in the Library, tap Make HDR, pick a look, then tap Make the HDR copy. It takes a second or two, after anything that is being made.
- The looks: Vivid (the default) gives bright highlights and richer colour and keeps the rest as it was. Bright lifts the whole picture brighter, with gentle colour. The sheet shows a before and after.
- Save or share the copy with Save in the viewer, like anything else. Clips are HLG HDR video; pictures are JPEGs with an HDR gain map. On a screen without HDR they look like the original.
- Songs have no HDR, and an HDR copy can't be made HDR again.

---
Sources: p0pc0rn's model-download design (Oct 12 2026: the video model's Gemma 2 text encoder is gated, so each person logs in once); the Gemma Terms of Use shipped in licenses/GEMMA_TERMS_OF_USE.txt; the video pack notice (licenses/NOTICE-video.md: SANA-Video reads prompts with Gemma-2-2B-it); the Bigger brain: NVIDIA's model card for NVIDIA-Nemotron-3.5-Bolt-E4B-BF16 (text in, text out; OpenMDW-1.1) and p0pc0rn 3.8's design (Oct 24 2026: chat and pictures on Juli's own model; writing and making planned and written by the Bigger brain).
