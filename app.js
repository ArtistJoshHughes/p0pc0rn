// app.js - p0pc0rn UI (v013: pictures AND short videos). One state object S; set(patch) re-renders. Plain DOM: no canvas UI, no frame loop.
// Two engines from window.PF (pocketflux.js), one per model (ENGINE_API.md, engine 0.3.3): E.image = FLUX.2 Klein 4B (textToImage,
// imageToImage), E.video = SANA-Video 2.0 5B (textToVideo, videoCheckpoint, tune({decodeBudgetMB})). Each model keeps its own OPFS
// folder, so a model already on the phone is found by eng.status(): download() runs only from a Download tap, deleteModel() only from
// a confirmed sheet, and Settings' clean-up never touches a model folder.
// v017: the progress picture is popcorn (popcorn.js): kernels heat up, then pop; the frame shown = the job's percent. The status pill
// reads Heating up / Popping 37% / Popped! instead of Making.
// v018: a clip can start FROM A PICTURE (image-to-video) or go BETWEEN TWO PICTURES (first/last frame): Create > Video > source choice,
// picture slots filled from the Library (the key flow: a Klein picture -> a clip) or the phone (every phone photo has its own unticked
// attestation box; the engine refuses with NOT_ATTESTED). The picture reader (213 MB) downloads by itself when a picture clip needs it.
// Library viewer: Animate, More > Clip to another picture; Library Select two pictures > Make a clip. Clips keep their mode + source
// thumbnails. The picture checkpoint has its own slot, so text-to-video and picture clips never overwrite each other's unfinished clip.
// v014: nothing renders before the person has read the copyright / trademark / likeness lesson and agreed (rights.js). The app keeps
// Make disabled, and the engine itself (0.3.4) refuses every job without the agreement for the current TERMS_VERSION. Every photo
// put in needs its own ticked attestation box.
// v019: THE ASSISTANT + ONE JOB QUEUE + SONGS. Every render (Create's Make and the assistant's tools) goes through assistant/queue.js:
// one model on the GPU at a time (EngineHost loads it for the job and unloads it after), chat jumps ahead of renders that have not
// started (never preempts one), and a page kill resumes the interrupted job from its engine checkpoint. The Assistant tab (ui/chat.js)
// talks to Gemma 4 E2B (engine/llm) through assistant/agent.js, which writes the prompts, the song's tags and lyrics, and calls the
// picture / clip / song / music-video tools. Songs (ACE-Step 1.5 turbo, engine/music) land in the Library as audio items.
import * as store from './store.js';
import { researchList, lyricsEl } from './ui/research.js';   // v026.2
import * as rights from './rights.js';
import * as opfs from './opfs.js';
import { $, ls, clock, about, aboutLong, gb, size as fmtSize, reducedMotion, standalone, isAbort, wake, mediaFile, saveFile, share, shrinkPhoto, makeThumb, gestures } from './util.js';
import { popcorn } from './popcorn.js';
import { stageOf, stageText } from './ui/stage.js';   // v026.9: the popcorn runs per stage
import { initBack } from './ui/back.js';   // v026.9: the Android back button closes the open sheet
import { tagMedia, SHARE_TEXT, AI_TAG } from './export.js';   // v026.4: every saved / shared file carries only the AI label
import { createQueue, EngineHost, RENDER_KINDS } from './assistant/queue.js';
import { createRunners, FLF_DROP, flfKeep, keepHead } from './assistant/runners.js';   // v026.3: + the first/last-frame trim
import { createAgent, loadCookbooks } from './assistant/agent.js';
import { startMemory } from './ui/memory_ui.js';   // 3.9: About me + Routines (Settings › Juli) and their heartbeat
let MEM = null;   // 3.9: startMemory(memApi()) once the Apps tab has started (init)
import { createResearch } from './assistant/research.js';
import { createStarterEngine } from './assistant/starter.js';   // v022: the starter knowledge pack (Settings › Models), research's second local source
import { setSafetyTerms, MAIN_TOOLS, FRAMES as TFRAMES, CLIP_SIZE, properNames } from './assistant/tools.js';
import { createChat } from './ui/chat.js';
import { initVoiceIn, voiceSettings } from './ui/voicein.js';
import { splitMood, wordsSoFar, fixCaps, sayZip, createVoicePackEngine } from './ui/voiceout.js';
import { dropNoLive } from './assistant/weather.js';
import { loadGeo } from './assistant/places.js';   // v4: the Nowcast's places (the same on-phone Census tables as Juli's weather)
import { BENCH_KEY, pickLayout } from './ui/voicebench_plan.js';   // v4: the Voice in bench picks voice mode's layout on this phone   // v4: never "I don't have live weather" over the live forecast   // v4: voice mode's mood tag (never shown or spoken)   // v4: voice input in Juli's chat
import { createKB } from './assistant/kb.js';   // v023: the likeness gate reads what the phone has looked up (read only)
import { startMusicVideo, requestGo, requestFrameReroll, requestShotReroll, boardOf, progressOf, estimate as mvEstimate, mvRoot } from './assistant/mvflf.js';   // v023
// p0pc0rn Cast (Josh, Oct 14: "Voice clone successful. Wire it in to cast under settings"): people the phone may use by name, their voice
// (the voice probe v002 engine) and photos (Klein references); + "Make them talk" (EXPERIMENTAL lip-sync, the lip-sync probe v002 engine)
import { createCast, refForShape, refPrompt, sayIntent } from './cast/cast.js';
import { sayRunner, sayTurn, wrapAsk } from './cast/castsay.js';
import { initCast } from './cast/cast_ui.js';
import { lipsyncRunner, talkRunner } from './cast/talk.js';
import { initTalk } from './cast/talk_ui.js';
import { initSettings, revealSetting } from './ui/settings.js';   // 3.9 polish: Settings in groups that open; Cast on its own screen
import { initTune, scheduleAsk, tuning } from './ui/tune.js';   // v4: the kernel tune (its pop-up, Settings › Benchmark › Speed)
import { NUDGE_MAX, shotsOfFrame } from './assistant/storyboard.js';   // v023
import { createApps, phoneBusy } from './makeapp/host.js';   // 3.8: the Apps tab (apps made from skeletons, agentic and non-agentic); v4: + phoneBusy (a game on its own page waits for it)
import { openAppOf, reopenApp, freshMoves } from './makeapp/freshapp.js';   // 3.9: the open app (a game) across a planned fresh page
import { createBench, benchRunner } from './ui/bench.js';   // 3.8: Settings › Benchmark
import { createAppIcon, iconPlanRunner, iconRenderRunner } from './ui/appicon.js';   // 3.9: "Make an icon" for a made app on the home screen (ui/appicon.js)
let ICON = null;   // 3.9: the app icon maker, made in init() (also globalThis.P0APPICON for the shell and the Apps tab)
import { createMusic } from './ui/music.js';   // 3.9: Music (songs, playlists, the lock screen)
import { createClipThumbs, clipPoster, clipLibrary } from './ui/clipthumbs.js';   // 3.9: the Library's clip posters + play buttons (Josh, 10-26)
import { LOOKS, lookOf, lookThumb, styleSize, fitText, maxLen, framesOf, lenFor, styleSeconds, styleMissing, editParams, clipParams, STYLE_CAP_S, PREP_SECONDS_PER_FRAME, STYLE_FPS,
  partsOf, joinedFrames, wholeSeconds, wholeText, wholeNotice, longParams, JOIN_SECONDS, STYLE_FOLLOW, followOf, followFor, LOOK_FOLLOW } from './ui/style_v2v.js';   // v4 Phase 4: Create › Video › Restyle a clip (+ the whole video in parts)
import { restyleRunner, restyleLongRunner } from './ui/style_run.js';   // v4 Phase 4: the queue's 'restyle' job; v4: 'restylelong', the whole video in parts
import { createHdr, hdrMark, infoOf as hdrInfo, eligible as hdrOk } from './ui/hdr.js';   // v4: Make HDR (a picture's or clip's HDR copy, ui/hdr.js + engine/hdr/)
let CLIPT = null;   // 3.9: the Library's clip posters (ui/clipthumbs.js), made in init() (also globalThis.P0CLIPT)
let MUSIC = null;   // 3.9: the Music screen (ui/music.js), made in init()
import { SHELL } from './ui/shell.js';   // 3.9: the phone-OS shell (home screen, dock, badges, wallpaper)

const APP_VERSION = '4.0 · v054';
const MODELS = {
  image: { id: 'flux2-klein-4b', name: 'FLUX.2 Klein 4B', what: 'Pictures', noun: 'picture', total: 4.62e9 },
  video: { id: 'sanavideo2-5b', name: 'SANA-Video 2.0 5B', what: 'Videos', noun: 'video', total: 5.72e9 },
  reader: { id: 'ltx23-still-enc', name: 'Picture reader', what: 'Reads pictures for clips', noun: 'picture reader', total: 212701440 },
  // v4: the video LoRA (Josh's, for SANA-Video 2.0): rides on the video engine; clips from pictures run with it when it is on (Settings)
  lora: { id: 'sanavideo2-5b-lora', name: 'Video LoRA', what: 'LoRA by Josh Hughes, trained on SANA-Video 2.0 (NVIDIA, Apache-2.0) · clips from pictures', noun: 'video LoRA', total: 64061440 },
  // v4 Phase 3: style video to video: the looks LoRA (c20, style jobs only: one LoRA a job, never stacked) and the clip reader (LTX-2.3's
  // video encoder: a clip becomes latent frames), both riding on the video engine
  lora2: { id: 'sanavideo2-5b-style-lora', name: 'Looks LoRA', what: 'LoRA by Josh Hughes, trained on SANA-Video 2.0 (NVIDIA, Apache-2.0) · style video to video', noun: 'looks LoRA', total: 64061440 },
  venc: { id: 'ltx23-video-enc', name: 'Clip reader', what: 'Reads clips for style video to video', noun: 'clip reader', total: 637964544 },
  // v019: the assistant, the music model and its optional lyrics planner (none of them needs a Hugging Face login)
  brain: { id: 'gemma4-e2b', name: 'Juli', what: 'Gemma 4 E2B, balanced 4/8-bit', noun: 'assistant', total: 3262871724 },
  // 3.8: the assistant's add-on: Google's Gemma 4 E2B MTP drafter. Answers come faster with the same words (it guesses ahead, the assistant checks)
  drafter: { id: 'gemma4-e2b-drafter', name: 'Faster replies', what: 'Gemma 4 drafter by Google · same answers, sooner', noun: 'faster replies', total: 53962752 },
  // 3.8 (v040): Juli's Bigger brain (Josh: "I want both models"): NVIDIA Nemotron 3.5 Bolt E4B (post-trained from Google's Gemma 4 E4B,
  // OpenMDW-1.1, text only) with Google's Gemma 4 E4B MTP drafter riding in its row (one tap downloads both). Chat stays with Juli
  // (E2B); writing and agent tasks think with it where it can run (E4B_HERE)
  brain4: { id: 'bolt-e4b', name: 'Bigger brain', what: 'NVIDIA Nemotron 3.5 Bolt E4B · Juli thinks and writes with it', noun: 'bigger brain', total: 4675838692 },
  drafter4: { id: 'bolt-e4b-drafter', name: 'Bigger brain faster replies', what: 'Gemma 4 E4B drafter by Google · same answers, sooner', noun: 'bigger brain’s faster replies', total: 54773760 },
  music: { id: 'acestep15-turbo', name: 'Music', what: 'ACE-Step 1.5 turbo · songs', noun: 'music', total: 2774088531 },
  planner: { id: 'acestep15-lm06', name: 'Lyrics planner', what: 'Helps the singer follow the words', noun: 'lyrics planner', total: 939540992 },
  // v022: the starter knowledge pack (3,214 Wikipedia articles; the assistant looks there before going online)
  starter: { id: 'starter-kb', name: 'Starter knowledge', what: '3,214 Wikipedia articles, offline', noun: 'starter knowledge', total: 2631059 },
  // v026.6: FLUX.2 [klein] 9B ("Better pictures"): slower, better pictures and video frames; FLUX Non-Commercial License (shown once at download)
  k9b: { id: 'flux2-klein-9b', name: 'Better pictures (Klein 9B)', what: 'FLUX.2 [klein] 9B · slower, better pictures', noun: 'Klein 9B', total: 9636509952 },
  // p0pc0rn Cast: your Cast's voices (Qwen3-TTS 0.6B Base, the voice probe's pack) and the EXPERIMENTAL lip-sync (MuseTalk 1.5, the lip-sync probe's pack)
  voice: { id: 'qwen3-tts-0.6b', name: 'Voice', what: 'Qwen3-TTS 0.6B · your Cast speaks', noun: 'voice', total: 1388e6 },
  lipsync: { id: 'musetalk-1.5', name: 'Lip-sync (experimental)', what: 'MuseTalk 1.5 · experimental', noun: 'lip-sync', total: 1037e6 },
  // v4: voice input (Josh, Nov 1: "Let's use Nvidia's best"): NVIDIA Nemotron 3.5 ASR Streaming 0.6B (OpenMDW-1.1), engine/stt/, ui/voicein.js;
  // its row shows once config.js lists its pack, and only where it fits beside Juli (voiceHere)
  stt: { id: 'nemotron35-asr-0.6b', name: 'Voice input', what: 'NVIDIA Nemotron 3.5 ASR · speak to Juli, 32 language choices', noun: 'voice input', total: 640473363 },
  // v4: the Nowcast (Experimental): DeepMind DGMR (CC BY 4.0, modified), the next 90 minutes of rain on this phone (nowcast/); its row and
  // screen show once config.js lists its pack. The float model (136 MB) by default; the 8-bit one (71 MB) where the float one cannot fit
  // v4: Juli's own voice in voice mode (p0voice v3, ui/voiceout.js): its row shows once config.js lists its pack, where voice input shows;
  // voice mode downloads it by itself the first time she speaks, and Delete frees it
  jvoice: { id: 'p0voice-juli', name: 'Juli’s voice', what: 'p0voice v3 · p0pc0rn’s own voice · voice mode', noun: 'Juli’s voice', total: 24718711 },
  nowcast: { id: 'dgmr-nowcast', name: 'Nowcast (experimental)', what: 'DeepMind DGMR · rain for the next 90 minutes · trained on UK radar', noun: 'nowcast', total: 135786355 },
};
const PACKS = (window.PF && PF.packs) || (window.P0_CONFIG && P0_CONFIG.packs) || {};   // v026.6: every pack address comes from config.js
const CAST_PACKS = { voice: PACKS['qwen3-tts-0.6b'], lipsync: PACKS['musetalk-1.5'] };
const CAST_KINDS = new Set(['say', 'talk', 'lipsync']);   // queue jobs of Cast (never on Create's stage)
const KEYS = ['image', 'video'];             // the two engines made at boot (Create's pictures and clips)
const DL = ['image', 'k9b', 'video', 'reader', 'lora', 'lora2', 'venc', 'brain', 'drafter', 'brain4', 'drafter4', 'music', 'planner', 'starter', 'voice', 'lipsync', 'stt', 'jvoice', 'nowcast'];   // everything that downloads; the reader rides on the video engine, the planner on the music engine, the drafter (3.8) on the assistant's, the bigger brain's drafter (v040) on its
const ADDON = { reader: 'video', lora: 'video', lora2: 'video', venc: 'video', planner: 'music', drafter: 'brain', drafter4: 'brain4' };   // add-ons that live inside another model's engine
const KEY_OF = { 'flux2-klein-4b': 'image', 'flux2-klein-9b': 'k9b', 'sanavideo2-5b': 'video', 'gemma4-e2b': 'brain', 'bolt-e4b': 'brain4', 'acestep15-turbo': 'music', 'qwen3-tts-0.6b': 'voice', 'musetalk-1.5': 'lipsync', 'nemotron35-asr-0.6b': 'stt', 'p0voice-juli': 'jvoice', 'dgmr-nowcast': 'nowcast', 'dgmr-nowcast-int8': 'nowcast' };
const K9B_PACK = PACKS['flux2-klein-9b'];   // v026.6 (the probe's pack and OPFS folder)
// OPFS folders that belong to each model (the engine registry's `wipe` lists; refreshed from the engine at boot)
const KEEP = { image: ['pocketflux/pack', 'pocketflux/cond', 'pocketflux/ckpt'], video: ['engine/sanavideo2-5b'], reader: ['engine/ltx23-still-enc'], lora: ['engine/sana-lora'], lora2: ['engine/sana-lora'], venc: ['engine/ltx23-video-enc'],
  brain: [(window.PF && PF.assistantPack && PF.assistantPack.dir) || 'pocketllm/pack'], drafter: [(window.PF && PF.drafterPack && PF.drafterPack.dir) || 'pocketllm/drafter'],
  brain4: [(window.PF && PF.e4bPack && PF.e4bPack.dir) || 'pocketllm/e4b'], drafter4: [(window.PF && PF.e4bDrafterPack && PF.e4bDrafterPack.dir) || 'pocketllm/e4b_drafter'], music: ['engine/acestep15-turbo'], planner: ['engine/acestep15-turbo/lm'], voice: ['engine/qwen3-tts-0.6b'], lipsync: ['engine/musetalk-1.5'], k9b: ['pocketflux/k9b'], stt: ['engine/nemotron35-asr-0.6b'], jvoice: ['engine/p0voice-juli/pack'], nowcast: ['nowcast/dgmr_f16', 'nowcast/dgmr_int8'] };
const VRUN = 'engine/sanavideo2-5b/run';   // the video engine's scratch folder: checkpoint latent + the frames file of a decode
const IRUN = 'engine/sanavideo2-5b/i2v-run';   // the picture clips' own scratch folder: latent + pinned pictures + frames
// where a clip starts: words (text-to-video), a picture (i2v: the picture is frame 0), two pictures (FLF: first and last frame)
// v4 Phase 4: + a clip restyled into a look (style video to video: the clip and its restyled first frame; no picture slots)
const SRC = { words: { kind: 't2v', n: 0, name: 'From words' }, pic: { kind: 'i2v', n: 1, name: 'From a picture' }, two: { kind: 'flf', n: 2, name: 'Between two pictures' }, style: { kind: 'v2v', n: 0, name: 'Restyle a clip' } };
const srcOf = (kind) => (kind === 'i2v' ? 'pic' : kind === 'flf' ? 'two' : kind === 'v2v' ? 'style' : 'words');
const isPic = (kind) => kind === 'i2v' || kind === 'flf';
const HINT = {
  pic: 'Describe what moves: the subject, the motion and the camera, e.g. “she turns to the window and smiles, hair moving in the breeze, slow push in.” Your picture is the first frame.',
  two: 'Describe the change from the first picture to the last, e.g. “the dog slowly turns its head to the left.” A movement travels smoothly; a change of look (expression, light, colour) can jump in the last half second.',
  style: 'Say what is in the clip and what happens, e.g. “a fox gardener bends down to touch a leaf, then straightens up.” The look’s own words go in front by themselves. A clip from your Library brings its own words.',
};
const SIZES = [
  { id: 'wide', w: 1280, h: 720, name: 'Wide', g: 13 }, { id: 'tall', w: 720, h: 1280, name: 'Tall', g: 13 },
  { id: 'square', w: 768, h: 768, name: 'Square', g: 11 }, { id: 'wideq', w: 960, h: 544, name: 'Quick wide', g: 11 },
  { id: 'tallq', w: 544, h: 960, name: 'Quick tall', g: 11 }, { id: 'small', w: 512, h: 512, name: 'Small', g: 9 },
];
const SMALLER = { wide: 'wideq', tall: 'tallq', square: 'small', wideq: 'small', tallq: 'small' };   // same aspect where possible
const VSIZES = [
  { id: 'wide', w: 832, h: 480, name: 'Wide', g: 13 }, { id: 'wide2', w: 960, h: 544, name: 'Wide+', g: 13 },
  { id: 'big', w: 1280, h: 736, name: 'Large · slow', g: 13, slow: true }, { id: 'tall', w: 480, h: 832, name: 'Tall', g: 13 },
  { id: 'tall2', w: 544, h: 960, name: 'Tall+', g: 13 }, { id: 'bigt', w: 736, h: 1280, name: 'Large · slow', g: 13, slow: true },
];
const VSMALLER = { big: 'wide2', bigt: 'tall2', wide2: 'wide', tall2: 'tall' };
const FRAMES = { 1: 17, 2: 33, 3: 49, 4: 65, 5: 81 };   // 8k + 1 frames at 16 fps
const lenOf = (frames) => Number(Object.keys(FRAMES).find((k) => FRAMES[k] === frames || FRAMES[k] === frames + FLF_DROP)) || Math.max(1, Math.round((frames - 1) / 16));
// v026.3: a first/last-frame clip keeps all but its last FLF_DROP frames (the morph toward the end picture): a length pick of n s
// renders 16n + 1 frames and plays n - 0.5 s. lenText is a SAVED clip's length (its kept frames), lenLabel a pick's length for that kind.
const lenText = (frames) => { const k = Object.keys(FRAMES).find((x) => FRAMES[x] === frames); return k || String(Math.round(frames / 1.6) / 10); };
const lenLabel = (len, kind) => (kind === 'flf' ? lenText(flfKeep(FRAMES[len] || 16 * len + 1)) : String(len));
const BASE_SECONDS = { 4: 180, 3: 132 };   // a 1280x720 picture on the owner's iPhone 16 Pro Max (measured)
const VBASE = 360;                          // a 5 s 832x480 clip on the same phone (estimate: 4 steps + 6 decode tiles)
const CAPTION = { load: 'Getting ready', text: 'Reading your words', encode: 'Studying your photo', decode: 'Developing', image: 'Reading your picture' };
// a song's phases (engine/music): the planner, the style, the words and the band's set-up heat the kernels; the 8 steps and the mix pop them
const SONG_CAPTION = { load: 'Getting ready', plan: 'Planning the song', text: 'Reading the style', lyrics: 'Reading the words', cond: 'Tuning the band', decode: 'Mixing', encode: 'Saving the song' };
const SONG_HEAT = new Set(['load', 'plan', 'text', 'lyrics', 'cond']);
const NOUN = { makeapp: 'app', appask: 'app question', bench: 'benchmark', picture: 'picture', edit: 'picture', clip: 'clip', animate: 'clip', between: 'clip', resume: 'clip', restyle: 'clip', restylelong: 'clip', song: 'song', musicvideo: 'music video', assemble: 'music video', mvflf: 'music video', mvplan: 'storyboard', say: 'voice line', talk: 'lip-sync', lipsync: 'lip-sync', hdr: 'HDR copy', nowcast: 'nowcast' };
NOUN.appicon = 'app icon'; NOUN.appiconplan = 'icon idea';   // 3.9: "Make an icon" (ui/appicon.js)
NOUN.appedit = 'app change';   // H39: an app changed by chat (makeapp/edit.js)
NOUN.appchoose = 'game move';
NOUN.appref = 'name reference';   // v4: Token Watch (the Bigger brain)   // 3.9: Juli's move in a game app (makeapp/choose.js)
const DECODE = [450, 560, 700];
// v030: clips decode with 700 MB by default (720p -36% against v027.3 on an iPhone 16 Pro Max: one tile, peak ~580 MB). Android
// (experimental, not yet run on a device) keeps 450. A clip that runs out of memory still offers "Use 450 MB and retry".
const DECODE_DEFAULT = /Android/i.test(navigator.userAgent || '') ? 450 : 700;
// v030: Android keeps the picture decoder's full-precision (fp32) sums: fp16 sums save only ~2 s a picture there, the Android picture
// decoder already shows banding, and no Android device has run them yet
const PIC_ACC = /Android/i.test(navigator.userAgent || '') ? { picAcc: 'f32' } : {};
const size = (id) => SIZES.find((z) => z.id === id) || SIZES[0];
const vsize = (id) => VSIZES.find((z) => z.id === id) || VSIZES[0];
const sizeFor = (w, h) => (SIZES.find((z) => z.w === w && z.h === h) || {}).id;
const vsizeFor = (w, h) => (VSIZES.find((z) => z.w === w && z.h === h) || {}).id;
const msg = (e) => String((e && (e.message || e.name)) || e || '');
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const decodeMB = () => { const v = Number(ls.get('pf.app.decodeMB', DECODE_DEFAULT)); return DECODE.includes(v) ? v : DECODE_DEFAULT; };
const tileOf = (m) => { const r = /tile (\d+)\s*(?:\/|of)\s*(\d+)/i.exec(m || ''); return r ? [Number(r[1]), Number(r[2])] : null; };
const dlState = (total) => ({ sub: 'idle', have: 0, total, bps: 0, eta: null, low: false, userPaused: false, detail: '', ctl: null });
const isClip = (m) => !!m && m.media === 'video';
const isSong = (m) => !!m && m.media === 'audio';
const isPicture = (m) => !!m && (m.media === 'image' || !m.media);   // v012 and older saved pictures without `media`
const isMV = (m) => isClip(m) && m.vmode === 'mv';                    // a music video: a clip WITH sound (clips + the song)
const consented = () => !!rights.consent();

const S = {
  phase: 'boot',        // boot | stop | setup (iPhone: "Add to Home Screen first") | ready | working | result | error
  tab: 'home', mode: ls.get('pf.app.mode') === 'video' ? 'video' : 'image',   // 3.9: the home screen (ui/shell.js) is where the app starts
  caps: null, persisted: false, st: { image: null, video: null, reader: null, lora: null, lora2: null, venc: null, brain: null, drafter: null, brain4: null, drafter4: null, music: null, planner: null, voice: null, lipsync: null, k9b: null, stt: null, jvoice: null, nowcast: null },
  dl: Object.fromEntries(DL.map((k) => [k, dlState(MODELS[k].total)])),
  stop: null,           // {title, text, detail, retry: 'reload' | 'boot'}
  free: null,           // bytes free for p0pc0rn on this phone (the chat's first message says it)
  form: Object.assign({ prompt: '', size: 'wide', steps: 4, seedMode: 'random', seed: '', ref: 'half', model: '4b' }, ls.get('pf.app.draft', {})),   // v026.6: + model ('4b' | '9b', remembered)
  vform: Object.assign({ prompt: '', size: 'wide', len: 5, seedMode: 'random', seed: '', src: 'words', q: 'standard', end: '', look: null, followPick: null }, ls.get('pf.app.vdraft', {})),   // v4: + look and followPick (Restyle a clip: "Follow the motion", the person's own pick; none = the look's)   // v026.6: + q (standard | high | highest), end
  hq: ls.get('pf.app.hq', null),   // v026.6: a High / Highest video's 9B frames being made or reviewed (survives the planned fresh pages)
  sty: ls.get('pf.app.sty', null),   // v4: Restyle a clip: {stage: null | 'first' | 'review' | 'clip', clip, attest, seed, look}; its blobs: S.styB (store 'inputs' 'style')
  styB: null, styPrep: null,         // v4: {pack, first, thumb, styled, urls}; the clip being read: {i, n}
  vslots: [null, null], // the clip's pictures: {blob, url, w, h, from: 'library' | 'phone', libId, thumb, attest}; [0] = the picture / first, [1] = last
  pending: false,       // a picture clip waits for the picture reader's download, then starts by itself
  sel: null,            // Library selection (ids in tap order) while picking two pictures, else null
  photo: null,          // {blob, url, w, h}: the picture to edit (already shrunk)
  job: null,            // {id (queue job), token, origin ('create' | 'assistant'), kind, media, params, input, sub: 'running' | 'cancelling', armed, waiting, p, frac, t0, at}
  result: null,         // {id, media, blob, url, width, height, seed, prompt, seconds, kind, createdAt, params, input, steps | frames, fps}
  error: null,          // {title, note, actions: [[label, fn]], detail, busy}
  hot: false, gpuReset: false, killed: null, vkilled: null, ck: { t2v: null, pic: null }, ckHidden: false, lib: [], files: null,
  attest: false,        // the attestation box for the photo now in Create (reset on every new photo)
  popped: 0,            // when the last job finished: the pill says 'Popped!' for POPPED_MS, then 'Ready'
};
const L = { open: false, i: 0, seen: new Set(), auto: false, dlKey: null, settleT: 0 };   // the lesson overlay
if (!SIZES.some((z) => z.id === S.form.size)) S.form.size = 'wide';
if (S.form.steps !== 3) S.form.steps = 4;
if (!VSIZES.some((z) => z.id === S.vform.size)) S.vform.size = 'wide';
if (!FRAMES[S.vform.len]) S.vform.len = 5;
if (!SRC[S.vform.src]) S.vform.src = 'words';
const E = { image: null, video: null, reader: null, lora: null, lora2: null, venc: null, brain: null, drafter: null, brain4: null, drafter4: null, music: null, planner: null, starter: null, voice: null, lipsync: null, stt: null, jvoice: null, nowcast: null };
const CAST = createCast();   // p0pc0rn Cast (IndexedDB 'p0pc0rn-cast')
let CASTUI = null, TALKUI = null;
let armT = 0, tickT = 0, draftT = 0, storTok = 0, poppedT = 0;
let pop = null;   // the popcorn progress canvas (popcorn.js), made in init()
const POPPED_MS = 3000;
// ---- v019: the queue, the assistant and its settings
let Q = null, AG = null, RS = null, RUN = null, CH = null, APPS = null, BENCH = null, VOICEIN = null;
// Connection: off in public builds (its tile says "Coming soon"); CONNECT_ON is false unless a test config sets P0_CONFIG.connect
const CONNECT_ON = !!(window.P0_CONFIG && window.P0_CONFIG.connect === true);   // Connection (off in public builds)
let CONNECT_P = null;
const connectP = () => (CONNECT_ON ? (CONNECT_P || (CONNECT_P = import('./connect/app.js').then((m) => m.initConnect(connectApi())))) : Promise.reject(Object.assign(new Error('Connection is not in this version.'), { code: 'REMOTE_OFF' })));
let VOICE_TURN = null;   // v4: the voice turn being answered ({ sid, job, spoke })
let VOICE_PAUSED = null;   // v4: voice mode paused for this page ({ why }): Juli's second process ended twice, or she runs in one process here
let VOICE_FAILS = 0;   // v4: second-process failures in voice mode this page
const CJ = new Map();   // queue job id -> {params, input, srcs} of a Create job (what Again / Edit / the Library need; rebuilt after a reload)
let HDR = null;   // v4: Make HDR (ui/hdr.js)
const AS = { research: ls.get('pf.app.research', true) !== false, review: ls.get('pf.app.review', true) !== false, brainMode: ls.get('pf.app.brainMode', 'resident') === 'lean' ? 'lean' : 'resident' };
/** Heating = before the first real work: loading the model, reading the words, reading a photo (a clip's 'encode' is the save at the end).
 *  A song heats while it plans, reads its style and words and sets up the band; a job still waiting its turn heats too. */
const heating = (j) => j.sub !== 'cancelling' && (j.waiting || (j.media === 'audio' ? SONG_HEAT.has(j.p.phase) : (j.p.phase === 'load' || j.p.phase === 'text' || j.p.phase === 'image' || (j.media === 'image' && j.p.phase === 'encode'))));
const F = (k = S.mode) => (k === 'video' ? S.vform : S.form);
const done = (k) => !!(S.st[k] && S.st[k].complete);
const set = (patch) => { Object.assign(S, patch); render(); };
/** A tap that lands within `ms` of the last accepted one is dropped: a double or triple tap on Download or Make
 *  must never flip straight into Pause / Cancel (the 2nd and 3rd taps of a burst are ignored, a deliberate tap is not). */
const tapGuard = (fn, ms = 300) => { let at = 0; return (...a) => { const now = Date.now(); if (now - at < ms) return; at = now; fn(...a); }; };
/** bring the stage back into view (job start, result, error, photo picked) when the form was scrolled down */
const toStage = () => { if (S.tab === 'create') $('main').scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); };
/** the screen stays on while anything works: a picture, a clip or a download */
const syncWake = () => (S.phase === 'working' || DL.some((k) => S.dl[k].sub === 'downloading') || (Q && (Q.active || Q.next())) ? wake.on() : wake.off());
/** a clip job is in the queue (it resumes the engine's checkpoint itself): the "Unfinished clip" card stays hidden meanwhile */
const queueHasClip = () => !!Q && (Q.list({ includeTerminal: false }).some((j) => ['clip', 'animate', 'between', 'resume', 'restyle', 'restylelong'].includes(j.kind)) || !!longKept());   // v4: + the whole video in parts (and one that stopped, kept for Carry on)
/** the picture modes exist when the video engine carries the picture reader (engine i2v 0.2.0) */
const picOK = () => !!E.reader;
/** v4 Phase 4: Restyle a clip exists when this build carries the clip reader and the looks LoRA (config.js), with the picture modes */
const styleOK = () => picOK() && !!E.venc && !!E.lora2;
const vsrc = () => (picOK() && (S.vform.src !== 'style' || styleOK()) ? S.vform.src : 'words');
const slotsNeeded = () => SRC[vsrc()].n;
const activeSlots = () => S.vslots.slice(0, slotsNeeded());
const slotsReady = () => activeSlots().every(Boolean);
const attestOK = () => activeSlots().every((x) => !x || x.from !== 'phone' || x.attest);
const sourcesOf = (slots) => slots.map((x) => ({ from: x.from, libId: x.libId || null, thumb: x.thumb || null }));
/** the picture reader as a model of its own (status / download / delete), carried by the video engine */
function readerEngine(v) {
  if (!v || typeof v.encoderStatus !== 'function') return null;
  return { status: () => v.encoderStatus(), download: (o) => v.downloadEncoder(o), deleteModel: () => v.deleteEncoder(), requestPersistentStorage: () => v.requestPersistentStorage(), cancel() {} };
}
/** v4: a video LoRA as a model of its own (status / download / delete), carried by the video engine; null when this build has no pack for it */
function loraEngine(v, k = 'lora') {
  if (!v || typeof v.loras !== 'function' || !v.loras().includes(MODELS[k].id)) return null;
  const id = MODELS[k].id;
  return { status: () => v.loraStatus(id), download: (o) => v.downloadLora(id, o), deleteModel: () => v.deleteLora(id), requestPersistentStorage: () => v.requestPersistentStorage(), cancel() {} };
}
/** v4 Phase 3: the clip reader (LTX-2.3 video encoder) as a model of its own, carried by the video engine; null without its pack */
function vencEngine(v) {
  if (!v || typeof v.hasVideoEncoder !== 'function' || !v.hasVideoEncoder()) return null;
  return { status: () => v.videoEncoderStatus(), download: (o) => v.downloadVideoEncoder(o), deleteModel: () => v.deleteVideoEncoder(), requestPersistentStorage: () => v.requestPersistentStorage(), cancel() {} };
}
/** v4: each video LoRA is used when it is on this phone and its switch is on (Settings › Models; on by default). One LoRA a job: picture
 *  clips the video LoRA (f3), style video to video the looks LoRA (c20) */
const loraOn = () => ls.get('pf.app.loraOn', true) !== false;
const loraUse = () => (E.lora && done('lora') && loraOn() ? { id: MODELS.lora.id, scale: 1 } : null);
const lora2On = () => ls.get('pf.app.lora2On', true) !== false;
const styleLoraUse = () => (E.lora2 && done('lora2') && lora2On() ? { id: MODELS.lora2.id, scale: 1 } : null);
/** v019: the lyrics planner as a model of its own (status / download / delete), carried by the music engine (its lm/ pack) */
function plannerEngine(m) {
  if (!m || typeof m.lmStatus !== 'function') return null;
  return { status: () => m.lmStatus(), download: (o) => m.downloadLM(o), deleteModel: () => m.deleteLM(), requestPersistentStorage: () => m.requestPersistentStorage(), cancel() {} };
}
/** 3.8: the drafter ("Faster replies") as a model of its own (status / download / delete), carried by the assistant's engine. The
 *  engine uses it by itself when it is on the phone; Android keeps plain decoding for now (FASTER_REPLIES). */
function drafterEngine(b) {
  if (!b || typeof b.hasDrafter !== 'function' || !b.hasDrafter()) return null;
  return { status: () => b.drafterStatus(), download: (o) => b.downloadDrafter(o), deleteModel: () => b.deleteDrafter(), requestPersistentStorage: () => b.requestPersistentStorage(), cancel() {} };
}
/** 3.8: a phone that already has the assistant is offered the drafter ONCE (a toast with Add; Settings › Models has it too) */
function offerDrafter() {
  if (!E.drafter || !done('brain') || done('drafter') || S.dl.drafter.have > 0 || !consented() || (S.st.drafter && S.st.drafter.error)) return;
  if (ls.get('pf.app.drafterOffered', false)) return;
  ls.set('pf.app.drafterOffered', Date.now());
  toast(`Faster replies: add Google's drafter to Juli · ${fmtSize(partTotal('drafter'))}`, { action: 'Add', ms: 12000, onAction: () => startDownload('drafter') });
}
/** the status of one model into S.st / S.dl (never throws: a model that can't be reached shows "can't reach" on its row) */
async function refreshStatus(k) {
  if (!E[k]) return;
  const r = await E[k].status().then((x) => x, (e) => ({ error: msg(e) }));
  S.st[k] = r; if (!r.error) Object.assign(S.dl[k], { have: r.haveBytes, total: r.totalBytes || S.dl[k].total });
  if (k === 'stt') setVoiceLayout();   // v4: Juli's layout follows voice input (on this phone and switched on)
}

// ------------------------------------------------------------------------------------------------ boot
async function boot() {
  set({ phase: 'boot' });
  try {
    for (const k of KEYS) {
      if (E[k]) continue;
      const e = await PF.createEngine(k === 'video' ? { model: MODELS.video.id, decodeBudgetMB: decodeMB(), ...PIC_ACC } : { model: MODELS.image.id, ...PIC_ACC });
      wire(e, k); E[k] = e;   // same tick, before any other await: KILLED_LAST_RUN comes from a setTimeout(0) inside createEngine
    }
    E.reader = readerEngine(E.video);
    E.lora = loraEngine(E.video);   // v4
    E.lora2 = loraEngine(E.video, 'lora2'); E.venc = vencEngine(E.video);   // v4 Phase 3
    S.caps = E.image.capabilities(); S.persisted = !!S.caps.persisted;
  } catch (e) {
    return set({ phase: 'stop', stop: { title: "p0pc0rn couldn't start", text: 'Check your connection, then try again.', detail: msg(e), retry: 'reload' } });
  }
  try { const reg = PF.registry && await PF.registry(); for (const k of KEYS) { const r = reg && reg[MODELS[k].id]; if (r && r.wipe && r.wipe.length) KEEP[k] = r.wipe.slice(); } } catch (e) { /* keep the built-in list */ }
  try { const enc = PF.encoder && await PF.encoder(); if (enc && enc.wipe && enc.wipe.length) KEEP.reader = enc.wipe.slice(); } catch (e) { /* keep the built-in list */ }
  try { const lr = PF.lora && await PF.lora(); if (lr && lr.root) KEEP.lora = KEEP.lora2 = [lr.root]; } catch (e) { /* keep the built-in list */ }   // v4
  try { const ve = PF.videoEncoder && await PF.videoEncoder(); if (ve && ve.wipe && ve.wipe.length) KEEP.venc = ve.wipe.slice(); } catch (e) { /* keep the built-in list */ }   // v4 Phase 3
  if (!S.caps.supported) return set({ phase: 'stop', stop: { title: "Can't run on this phone", text: unsupportedText(S.caps.reason), detail: S.caps.reason, retry: 'reload' } });
  const st = await Promise.all(KEYS.map((k) => E[k].status().then((s) => s, (e) => ({ error: msg(e) }))));
  KEYS.forEach((k, i) => { S.st[k] = st[i]; if (!st[i].error) Object.assign(S.dl[k], { have: st[i].haveBytes, total: st[i].totalBytes || S.dl[k].total }); });
  if (E.reader) {   // the picture reader never blocks the start: offline and not downloaded = 'can't reach' on its row
    const r = await E.reader.status().then((x) => x, (e) => ({ error: msg(e) }));
    S.st.reader = r; if (!r.error) Object.assign(S.dl.reader, { have: r.haveBytes, total: r.totalBytes || S.dl.reader.total });
  }
  if (E.lora) await refreshStatus('lora');   // v4: never blocks the start either
  if (E.lora2) await refreshStatus('lora2'); if (E.venc) await refreshStatus('venc');   // v4 Phase 3
  if (st.every((s) => s.error)) {
    return set({ phase: 'stop', stop: { title: 'Connect to Wi-Fi to set up p0pc0rn', text: "If you're on Wi-Fi, sign in to the server that hosts p0pc0rn first, then try again.", detail: st[0].error, retry: 'boot' } });
  }
  // v019: the assistant and the music engine (+ its lyrics planner). They never block the start: a failure = "can't reach" on their rows.
  for (const k of ['brain', 'music']) {
    if (E[k]) continue;
    // v024.1: the song's decoder works in the iPhone's tile budget everywhere (450 MB: the engine's own Apple default), so a desktop test
    // smoke measures the phone's decode ("Mixing") and not a 1.2 GB desktop one
    try { const e = await PF.createEngine(k === 'music' ? { model: MODELS[k].id, decodeBudgetMB: 450 } : Object.assign({ model: MODELS[k].id }, brainOpts())); wire(e, k); E[k] = e; } catch (e) { E[k] = null; }
  }
  E.planner = plannerEngine(E.music);
  E.drafter = drafterEngine(E.brain);   // 3.8
  // 3.8 (v040): the Bigger brain's engine where it can run (its row's status; nothing loads until a job needs it)
  if (MODELS.brain4 && E4B_HERE() && !E.brain4) { try { const e = await PF.createEngine(Object.assign({ model: MODELS.brain4.id }, brain4Opts())); wire(e, 'brain4'); E.brain4 = e; } catch (e) { E.brain4 = null; } }
  E.drafter4 = E.brain4 ? drafterEngine(E.brain4) : null;
  // p0pc0rn Cast: the voice engine and the (experimental) lip-sync engine, each its own module tree; never blocking the start
  // 3.8: and one between a 9B picture's stages (the 9B marks each stage as running before its fresh page; the job resumes from its own checkpoint)
  if (PLANNED_IN) { try { localStorage.removeItem('pocketlipsync:running'); if (/^k9b /.test(PLANNED_IN.stage || '')) localStorage.removeItem('pocketk9b:running'); } catch (x) { /* a planned fresh page is not a kill */ } }
  // v026.7: LAZY (Josh's iPhone, Oct 15: the song died near the memory line): no module, store, worker or pack read until a job needs them
  if (!E.voice) E.voice = lazyEngine('voice', async () => (await import('./engine/voice/voice_engine.js')).createVoiceEngine({ model: MODELS.voice.id, packUrl: CAST_PACKS.voice }));
  if (!E.lipsync) E.lipsync = lazyEngine('lipsync', async () => (await import('./engine/lipsync/engine_lipsync.js')).createEngine({ model: MODELS.lipsync.id, packUrl: CAST_PACKS.lipsync }));
  if (!E.starter) E.starter = createStarterEngine({ base: PACKS['starter-kb'] });
  if (!E.k9b) E.k9b = lazyEngine('k9b', async () => (await import('./engine/k9b/k9b_engine.js')).createK9bEngine({ packUrl: K9B_PACK }));   // v026.6
  if (!E.stt && PACKS[MODELS.stt.id]) E.stt = lazyEngine('stt', async () => (await import('./engine/stt/stt_engine.js')).createSttEngine({ model: MODELS.stt.id, packUrl: PACKS[MODELS.stt.id] }));   // v4: voice input
  if (!E.jvoice) E.jvoice = createVoicePackEngine();   // v4: Juli's voice (null when config.js has no pack for it)
  if (!E.nowcast && PACKS[MODELS.nowcast.id]) E.nowcast = lazyEngine('nowcast', async () => (await import('./nowcast/engine.js')).createNowcastEngine({ packUrl: PACKS[MODELS.nowcast.id] }));   // v4: the Nowcast (Experimental)
  await Promise.all(['brain', 'drafter', 'brain4', 'drafter4', 'music', 'planner', 'starter', 'voice', 'lipsync', 'k9b', 'stt', 'jvoice', 'nowcast'].map(refreshStatus));
  // 3.8: a lighter mode that an earlier version set by itself (not the person's own choice) goes back to Full once; one more failure
  // loading in full and it stays lighter (brainFullFailed)
  if (AS.brainMode === 'lean' && ls.get('pf.app.brainModeBy', null) !== 'user' && !ls.get('pf.app.leanReset38', null)) {
    setBrainMode('resident', true); ls.set(FULL_FAILS, 1); ls.set('pf.app.leanReset38', Date.now()); diag('assistant back to full (3.8)');
  }
  const bl = ls.get('pf.app.brainLoading');   // the page died while the assistant was loading: the next load is lighter, once
  if (bl) {
    ls.set('pf.app.brainLoading', null);
    if (bl.mode !== 'lean') { if (brainFullFailed() >= 2) S.brainNote = 'Juli stopped twice while loading in full, so it now loads lighter (about 1.2 GB, slower). Settings › Juli can switch it back to Full.'; else S.resumeLean = true; }
  }
  refreshCk();
  if (!Q) { try { await initAssistant(); } catch (e) { S.agentError = S.agentError || msg(e); } }
  // onboarding: an iPhone's Safari tab with nothing downloaded yet asks for the Home Screen first (its storage is separate); everyone
  // else opens the app: a new install in the Assistant chat, an install that has a model or history on Create (homeTab)
  if (!onPhone() && !standalone() && !ANDROID) enterSetup(); else await enterApp();
  startQueue();
  styLoad().catch(() => {});   // v4: a restyle's clip and first frame, back from the store (after a reload or a planned fresh page)
  restoreUi();
  setTimeout(seedLazy, 6000);   // v026.7: the first open after the update learns the lazy engines' status once, in the background
  setTimeout(offerDrafter, 4000);   // 3.8: once, to a phone that already has the assistant
}
// ---- v026.7: lazy engines (Cast voice, lip-sync, Klein 9B). The stand-in answers status() from what the app remembered; any other call
// loads the real engine first (its module, then its store on demand). Downloads, deletes and jobs keep the remembered status current.
const LZK = (k) => 'p0pc0rn:st:' + k;
function lazyEngine(k, load) {
  let real = null, loading = null; const L = [];
  const ensure = () => (real ? Promise.resolve(real) : (loading || (loading = load().then((e) => { real = e; wire(e, k); for (const [n, f] of L) e.on(n, f); diag('engine loaded', { model: k }); return e; },
    (x) => { loading = null; throw Object.assign(new Error(`the ${MODELS[k].name} engine couldn't start: ${msg(x)}`), { code: x && x.code || 'UNSUPPORTED' }); }))));
  const cached = () => ls.get(LZK(k), null);
  const remember = (s) => { if (s && !s.error) ls.set(LZK(k), { complete: !!s.complete, haveBytes: s.haveBytes || 0, totalBytes: s.totalBytes || 0, packVersion: s.packVersion || null }); return s; };
  const fresh = async () => { const e = await ensure(); return remember(await e.status()); };
  const api = {
    lazy: true, ensure, get loaded() { return !!real; }, known: () => !!cached(),
    get state() { return real ? real.state : 'idle'; }, get job() { return real ? real.job : null; }, get gpu() { return real ? real.gpu : null; },
    on(n, f) { if (real) real.on(n, f); else L.push([n, f]); }, off(n, f) { if (real && real.off) real.off(n, f); },
    status(o = {}) {   // remembered; nothing remembered yet = 'not known' (seedLazy learns it in the background, a job or a download loads it)
      if (real || o.fresh) return fresh();
      const c = cached(); return Promise.resolve(c ? Object.assign({}, c, { cached: true }) : { complete: false, haveBytes: 0, totalBytes: 0, unknown: true });
    },
    async download(o) { const e = await ensure(); try { return await e.download(o); } finally { await fresh().catch(() => null); } },
    async deleteModel() { const e = await ensure(); try { return await e.deleteModel(); } finally { await fresh().catch(() => null); } },
    requestPersistentStorage() { if (real) return real.requestPersistentStorage(); try { return navigator.storage.persist(); } catch (x) { return Promise.resolve(false); } },   // same gesture
    estimate(...a) { return real && real.estimate ? real.estimate(...a) : null; },
    cancel() { if (real) real.cancel(); }, unload() { return real && real.unload ? real.unload() : true; },
  };
  return new Proxy(api, { get(t, p) {
    if (p in t) return t[p];
    if (real) { const v = real[p]; return typeof v === 'function' ? v.bind(real) : v; }
    if (typeof p === 'symbol' || p === 'then') return undefined;
    return (...a) => ensure().then((e) => e[p](...a));
  } });
}
const LAZY = ['voice', 'lipsync', 'k9b'];
/** the first open after the update: a lazy engine with no remembered status loads once (in the background, never during a job) */
async function seedLazy() {
  for (const k of LAZY) {
    const e = E[k]; if (!e || !e.lazy || e.loaded || e.known()) continue;
    if (Q && Q.active) return setTimeout(seedLazy, 30000);
    try { const r = await e.status({ fresh: true }); S.st[k] = r; Object.assign(S.dl[k], { have: r.haveBytes, total: r.totalBytes || S.dl[k].total }); } catch (x) { /* offline: stays 'not known' */ }
    render();
  }
}
/** v026.1: after a planned fresh page, the screen it left (the tab, the chat scrolled to the bottom, the open storyboard or queue),
 *  under the cover; the cover goes only then. Without a planned page the cover is never up. */
async function restoreUi() {
  const root = document.documentElement, ui = (PLANNED_IN && PLANNED_IN.ui) || null;
  try {
    if (ui && ['ready', 'working', 'result', 'error'].includes(S.phase)) {
      if (['create', 'assistant', 'library', 'settings'].includes(ui.tab) || SHELL.restorable(ui.tab)) go(ui.tab);   // 3.9: + the home screen and the shell's screens
      if (ui.app && APPS && !SAFE) await Promise.race([reopenApp(APPS, ui.app), new Promise((r) => setTimeout(r, 8000))]);   // 3.9: the app that was open opens again (v4: not in safe mode; never one the page ended in)
      if (ui.tab === 'assistant' && S.chatShown) await Promise.race([S.chatShown, new Promise((r) => setTimeout(r, 4000))]);
      if (ui.board && Q && Q.get(ui.board)) openBoard(ui.board);
      else if (ui.queue && CH) CH.openQueue();
      if (ui.tab === 'assistant') { const m = $('main'); if (m) m.scrollTop = m.scrollHeight; }
    }
  } catch (x) { /* the cover still goes */ }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  root.classList.remove('pf-fresh');
}
function wire(e, k) {
  e.on('warning', (w) => onWarning(w, k));
  if (k === 'brain') e.on('split', onSplitOff);   // 3.8: Juli went on in one process
  if (k === 'brain') { e.on('split-failed', (d) => juliSplitFailed(e, d)); e.on('split', (d) => { if (d && d.off && WEBKIT && VOICEIN && !VOICE_PAUSED) pauseVoice('Juli runs in one process here'); }); }   // v4: voice mode's safety
  if (k === 'brain4') e.on('split', (d) => { if (d && d.down) { E4B_DOWN = { code: 'SPLIT_GONE', t: Date.now() }; diag('bigger brain off for this page', { why: d.why || '' }); } });   // 3.8 port: its work goes to Juli, no note
  e.on('split-failed', (d) => diag('second process failed', Object.assign({ model: k }, d)));   // 3.8 port: for the benchmark card / diagnostics
  e.on('gpu-lost', () => { if (S.phase === 'working' && S.job && !S.job.waiting && S.job.mk === k && Q && Q.active && Q.active.job.id === S.job.id) set({ gpuReset: true }); });   // the queue's own unload destroys idle devices: not a reset
  e.on('state', (s) => { if (s.state === 'idle' && S.error && S.error.busy) set({ phase: 'ready', error: null }); });
}
function unsupportedText(reason = '') {
  const r = reason.toLowerCase();
  if (ANDROID) {   // v026.9: Android (Chrome): experimental
    if (r.includes('adapter')) return "Chrome couldn't start the graphics chip (WebGPU). Update Chrome, close other apps, then try again. Settings › About › Device check shows what this phone offers.";
    if (r.includes('webgpu')) return 'Needs Chrome with WebGPU. Update Chrome in the Play Store; Settings › About › Device check explains the rest.';
    if (r.includes('shader-f16') || r.includes('buffers')) return "This phone's graphics chip doesn't offer what the models need yet (Settings › About › Device check says which part).";
  }
  if (r.includes('adapter')) return "Safari couldn't start the graphics chip. Close other apps and try again.";
  if (r.includes('webgpu')) return 'Needs Safari on iOS 26 or later. Update in Settings › General › Software Update.';
  if (r.includes('shader-f16') || r.includes('buffers')) return "This iPhone's graphics chip can't run the models.";
  if (r.includes('opfs') || r.includes('file storage')) return "This browser can't store the models. Open it in Safari.";
  if (r.includes('storage')) return 'Needs about 5 GB free. Free space in Settings › General › iPhone Storage.';
  return "This phone or browser can't run p0pc0rn.";
}
async function enterApp() {
  const first = S.phase !== 'ready';
  if (!done(S.mode) && !(S.dl[S.mode].have > 0)) S.mode = KEYS.find(done) || S.mode;   // open on a model that is there
  const home = first ? (APPS && APPS.brokeAtBoot && APPS.brokeAtBoot() ? 'home' : SHELL.startTab(await homeTab())) : S.tab;   // 3.9: an install that opened on Create opens on the home screen (v4: so does one whose last page ended in an app)
  set({ phase: 'ready' });
  if (first) { const c = $('compose'); c.classList.add('stagger'); setTimeout(() => c.classList.remove('stagger'), 700); freeSpace(); }
  syncPrompt(); placeAll();   // the shell is visible now, so the selectors can be measured
  if (home !== S.tab) go(home);
  if (first && APPS && APPS.booted) APPS.booted();   // v4: the app is on screen: the sheet for an app the page ended in last time (makeapp/host.js)
  if (!consented()) openLesson();   // the rights lesson and the agreement come before anything is made, on every tab
}
/** anything downloaded on this phone (any model, complete or partly) */
const onPhone = () => DL.some((k) => done(k) || S.dl[k].have > 0);
// ---- onboarding (Josh: "like Ollama does"): a NEW install opens in the Assistant chat, whose first message offers the assistant and the
// starter knowledge (ui/chat.js); the other models are offered there when they are asked for, and in Settings › Models. An install that
// already has a model, Library items or chats keeps opening on Create, as before. Decided on the first open of this version, then kept;
// 3.9 (review): an install that started in the chat while it was empty opens on the home screen once it has a model, a picture or a chat.
const HOME = 'p0pc0rn:home';
async function homeTab() {
  const h = ls.get(HOME, null);
  if (h === 'create') return h;
  let had = onPhone() || (await store.list().catch(() => [])).length > 0;
  if (!had && AG) had = (await AG.db.all('sessions').catch(() => [])).some((s) => s && s.messages && s.messages.length);
  if (h === 'assistant') {   // 3.9 (review): the chat was the start only while the install was empty
    if (!had) return h;
    ls.set(HOME, 'create'); diag('first open', { home: 'create', was: 'assistant' });
    return 'create';
  }
  const tab = had ? 'create' : 'assistant';
  ls.set(HOME, tab); diag('first open', { home: tab });
  return tab;
}

// ------------------------------------------------------------------------------------------------ downloads (the chat, Create card, Settings)
/** iPhone, a Safari tab with nothing downloaded: "Add to Home Screen first" (the Home Screen app's storage is its own). v026.9: not on
 *  Android, where Chrome's installed app shares the storage. "Download in Safari instead" opens the app. */
function enterSetup() { set({ phase: 'setup' }); }
/** what the chat's first message says about space (navigator.storage.estimate: the quota left for this site) */
async function freeSpace() {
  let free = null;
  try { const e = await navigator.storage.estimate(); free = (e.quota || 0) - (e.usage || 0); } catch (e) { /* */ }
  if (free == null && S.caps) free = S.caps.storageQuotaGB * 1e9;
  S.free = free; if (CH) CH.render();
}
function startDownload(k) {
  const u = S.dl[k];
  if (!['idle', 'paused', 'dropped', 'failed'].includes(u.sub)) return;   // Resume only after the old call has settled (no BUSY)
  if (LTX_KEYS.has(k) && !ltxOk()) return openLtx(() => startDownload(k));   // v026.4: the LTX-2 licence (+ the Gemma tick), accepted first: every download path comes here
  if (k === 'k9b' && !fluxAccepted()) return openFlux(() => startDownload(k));   // v026.6: the FLUX Non-Commercial License, accepted once
  if ((k === 'brain4' || k === 'stt') && !mdwAccepted(k)) return openMdw(() => startDownload(k), k);
  if (k === 'nowcast' && !ls.get(NC_LIC, null)) return openNcLicence(() => startDownload(k));   // v4: the Nowcast model's licence and what it is, shown once   // 3.8 (v040): NVIDIA's OpenMDW-1.1, accepted once (v4: voice input's too)
  const other = DL.find((m) => m !== k && ['downloading', 'pausing'].includes(S.dl[m].sub));
  if (other) { if (k === 'reader') S.pending = false; return toast(`One download at a time. Pause ${theNoun(other)} first.`); }
  if (!E[k]) return toast("Couldn't reach the model server. Check Wi-Fi, then try again.");
  E[k].requestPersistentStorage().then((p) => { S.persisted = p; }, () => {});   // same gesture; the answer never blocks
  u.ctl = new AbortController();
  Object.assign(u, { sub: 'downloading', userPaused: false, detail: '' }); syncWake(); render();
  if (!consented() && !L.auto) { L.auto = true; openLesson(k); }   // the lesson fills the wait
  E[k].download({ onProgress: (p) => { Object.assign(u, { have: p.haveBytes, total: p.totalBytes, bps: p.bytesPerSec, eta: p.etaSeconds }); renderDl(); }, signal: u.ctl.signal })
    .then(async () => {
      try { S.st[k] = await E[k].status(); } catch (e) { S.st[k] = { complete: false }; }
      if (!done(k)) Object.assign(u, { sub: 'failed', detail: 'The download ended early.' });
      else if (k === 'reader') { u.sub = 'idle'; if (!S.pending) toast('The picture reader is ready'); }
      else if (k === 'lora') { u.sub = 'idle'; toast(loraOn() ? 'The video LoRA is ready: clips from pictures use it' : 'The video LoRA is ready (it is switched off in Settings › Models)'); }   // v4
      else if (k === 'lora2') { u.sub = 'idle'; toast(lora2On() ? 'The looks LoRA is ready: style video to video uses it' : 'The looks LoRA is ready (it is switched off in Settings › Models)'); }   // v4 Phase 3
      else if (k === 'venc') { u.sub = 'idle'; toast('The clip reader is ready'); }
      else if (k === 'stt') { u.sub = 'idle'; setVoiceLayout(); toast('Voice input is ready: tap the mic in Juli’s chat'); }   // v4
      else if (k === 'jvoice') { u.sub = 'idle'; toast('Juli’s own voice is ready'); }   // v4
      else if (k === 'nowcast') { u.sub = 'idle'; toast('The nowcast model is ready'); if (NC) NC.refresh(); }   // v4
      else {
        u.sub = 'idle';
        const next = k === 'music' && S.musicPair && E.planner && !done('planner');   // v021: one tap = the music model AND the lyrics planner
        const nextS = k === 'brain' && S.brainPair && E.starter && !done('starter');   // onboarding: one tap = the assistant AND the starter knowledge
        const nextD = (k === 'brain' || k === 'starter') && S.brainPair && !nextS && E.drafter && !done('drafter');   // 3.8: ... AND faster replies
        const next4 = k === 'brain4' && S.e4bPair && E.drafter4 && !done('drafter4');   // 3.8 (v040): one tap = the bigger brain AND its faster replies
        if (k === 'planner' || (k === 'music' && !next)) S.musicPair = false;
        if (k === 'drafter' || ((k === 'starter' || k === 'brain') && !nextS && !nextD)) S.brainPair = false;
        if (k === 'drafter4' || (k === 'brain4' && !next4)) S.e4bPair = false;
        if (k === 'starter') plugStarter();
        toast(k === 'brain4' ? (next4 ? 'The bigger brain is in · now its faster replies' : 'The bigger brain is ready') : k === 'drafter4' ? (done('brain4') ? 'The bigger brain is ready' : 'Its faster replies are in')
          : k === 'drafter' ? 'Faster replies are ready' : k === 'starter' ? (nextD ? 'The starter knowledge is ready · now faster replies' : 'The starter knowledge is ready')
          : k === 'brain' ? (nextS ? 'Juli is ready · now the starter knowledge' : nextD ? 'Juli is ready · now faster replies' : 'Juli is ready') : next ? 'The music model is in · now the lyrics planner' : (k === 'planner' || k === 'music') && done('music') && (!E.planner || done('planner')) ? 'Music is ready'
          : k === 'planner' ? 'The lyrics planner is ready' : `The ${MODELS[k].noun} model is ready`);
        if (next) setTimeout(() => startDownload('planner'), 0);
        if (nextS) setTimeout(() => startDownload('starter'), 0);
        if (nextD) setTimeout(() => startDownload('drafter'), 0);
        if (next4) setTimeout(() => startDownload('drafter4'), 0);
      }
      if (k === 'reader' && !done(k)) S.pending = false;
      syncWake(); render(); renderLessonDl(); if (S.tab === 'settings') renderSettings(); if (CH) CH.render();
      if (k === 'reader' && S.pending) { S.pending = false; if (S.mode === 'video' && vsrc() !== 'words') make(); }   // the clip the Make tap asked for
      if (done(k) && Q && !(k === 'music' && S.musicPair) && !(k === 'brain4' && S.e4bPair)) Q.recheck();   // jobs that waited for this model go on (music, the bigger brain: once the pair is complete)
    }, (e) => {
      if (isAbort(e)) u.sub = 'paused';
      else if (!navigator.onLine || e instanceof TypeError) u.sub = 'dropped';
      else Object.assign(u, { sub: 'failed', detail: msg(e) });
      if (k === 'reader' && u.sub !== 'dropped') S.pending = false;   // a dropped connection resumes by itself, and the clip still follows
      syncWake(); render(); renderLessonDl(); if (CH) CH.render();
    });
}
function pauseDownload(k) {
  const u = S.dl[k]; if (u.sub !== 'downloading') return;
  if (k === 'reader') S.pending = false;
  Object.assign(u, { sub: 'pausing', userPaused: true }); render(); renderLessonDl(); u.ctl.abort();
}
const dlTap = (k) => (k === 'music' ? musicTap() : k === 'brain4' ? e4bTap() : S.dl[k].sub === 'downloading' ? pauseDownload(k) : startDownload(k));
// ---- v021 (Josh: "I want the music download button to do it all"): music = the music model + the lyrics planner, one tap, one bar
const musicKeys = () => ['music', 'planner'].filter((k) => E[k]);
const partTotal = (k) => S.dl[k].total || MODELS[k].total, partHave = (k) => (done(k) ? partTotal(k) : Math.min(S.dl[k].have || 0, partTotal(k)));
/** the pair as one download: {total, have, pct, running, pausing, ready, addPlanner, failed, label, short, parts} */
function musicDl() {
  const ks = musicKeys(), total = ks.reduce((a, k) => a + partTotal(k), 0), have = ks.reduce((a, k) => a + partHave(k), 0);
  const running = ks.find((k) => S.dl[k].sub === 'downloading') || null, pausing = ks.some((k) => S.dl[k].sub === 'pausing');
  const failed = ks.find((k) => S.dl[k].sub === 'failed') || null, musicOk = done('music'), ready = musicOk && (!E.planner || done('planner'));
  const addPlanner = musicOk && !ready && !running && !pausing && !S.musicPair && !(S.dl.planner.have > 0);
  const pct = total ? have / total : 0, left = fmtSize(Math.max(0, total - have));
  const label = ready ? 'Music is ready' : running ? `Pause · ${Math.floor(pct * 100)}%` : pausing ? 'Pausing…' : addPlanner ? `Add the lyrics planner · ${fmtSize(partTotal('planner'))} (recommended)`
    : have > 0 ? `Resume music · ${left} left` : `Download music · ${fmtSize(total)}`;
  const short = ready ? 'Ready' : running ? 'Pause' : pausing ? 'Pausing…' : addPlanner ? 'Add planner' : have > 0 ? 'Resume' : 'Download';
  const part = (k) => `${k === 'music' ? 'Music model' : 'Lyrics planner'} ${done(k) ? '✓' : S.dl[k].have > 0 ? `${Math.floor(partHave(k) / partTotal(k) * 100)}%` : fmtSize(partTotal(k))}`;
  return { total, have, pct, running, pausing, ready, addPlanner, failed, label, short, parts: ks.map(part).join(' · ') };
}
/** the one button: download what is missing (music, then the planner by itself), Pause / Resume the pair */
function musicTap() {
  const m = musicDl();
  if (m.running) { S.musicPair = true; return pauseDownload(m.running); }   // a paused pair resumes as a pair
  if (m.ready || m.pausing) return;
  S.musicPair = true;
  if (!done('music')) return startDownload('music');
  if (E.planner && !done('planner')) return startDownload('planner');
}
// ---- onboarding: the chat's first message offers the assistant AND the starter knowledge as one download (one button, one bar, both parts
// listed), built like music's pair: the assistant first, then the starter knowledge by itself; the same button pauses and resumes the pair
// 3.8: faster replies (the drafter add-on, 81 MB) is a third part when this phone's assistant engine has one (not on Android for now)
const assistKeys = () => ['brain', 'starter', 'drafter'].filter((k) => E[k]);
const ASSIST_PART = { brain: 'Assistant', starter: 'Starter knowledge', drafter: 'Faster replies' };
/** the pair as one download: {total, have, pct, running, pausing, partial, ready, addStarter, failed, label, parts} */
function assistDl() {
  const ks = assistKeys(), total = ks.reduce((a, k) => a + partTotal(k), 0), have = ks.reduce((a, k) => a + partHave(k), 0);
  const running = ks.find((k) => S.dl[k].sub === 'downloading') || null, pausing = ks.some((k) => S.dl[k].sub === 'pausing');
  const failed = ks.find((k) => S.dl[k].sub === 'failed') || null, brainOk = done('brain'), ready = brainOk && ks.every((k) => done(k));
  const partial = ks.some((k) => !done(k) && S.dl[k].have > 0), starterHere = !E.starter || done('starter');   // the starter may already be here (Settings)
  const addStarter = brainOk && !ready && !running && !pausing;   // the assistant is in, an add-on is not (or it stopped)
  const extras = ks.filter((k) => k !== 'brain' && !done(k)), addBytes = extras.reduce((a, k) => a + partTotal(k), 0);
  const addWhat = extras.map((k) => (k === 'starter' ? 'the starter knowledge' : 'faster replies')).join(' + ');
  const pct = total ? have / total : 0, left = fmtSize(Math.max(0, total - have));
  const label = ready ? 'Juli is ready' : running ? `Pause · ${Math.floor(pct * 100)}%` : pausing ? 'Pausing…' : addStarter ? `Add ${addWhat} · ${fmtSize(addBytes)}`
    : partial ? `Resume Juli · ${left} left` : starterHere ? `Download Juli · ${fmtSize(total - (E.starter ? partTotal('starter') : 0))}` : `Download Juli + starter knowledge · ${fmtSize(total)}`;
  const part = (k) => `${ASSIST_PART[k]} ${done(k) ? '✓' : S.dl[k].have > 0 ? `${Math.floor(partHave(k) / partTotal(k) * 100)}%` : fmtSize(partTotal(k))}`;
  return { total, have, pct, running, pausing, partial, ready, addStarter, failed, low: ks.some((k) => S.dl[k].low), label, parts: ks.map(part).join(' · ') };
}
/** the one button: download what is missing (the assistant, then the starter knowledge, then faster replies), Pause / Resume the pair */
function assistTap() {
  const a = assistDl();
  if (a.running) { S.brainPair = true; return pauseDownload(a.running); }   // a paused pair resumes as a pair
  if (a.ready || a.pausing) return;
  S.brainPair = true;
  if (!done('brain')) return startDownload('brain');
  if (E.starter && !done('starter')) return startDownload('starter');
  if (E.drafter && !done('drafter')) return startDownload('drafter');
}
/** 3.8 (v040): the Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B) and its faster replies (Google's Gemma 4 E4B drafter) as ONE download,
 *  built like music's pair: the bigger brain first, then its drafter by itself; the same button pauses and resumes the pair. Offered
 *  only where it can run (E4B_HERE: iOS 27's second process or a desktop browser) */
const e4bHere = () => typeof E4B_HERE === 'function' && !!E4B_HERE();
const e4bKeys = () => ['brain4', 'drafter4'].filter((k) => E[k]);
const E4B_PART = { brain4: 'Bigger brain', drafter4: 'Faster replies' };
/** the pair as one download: {total, have, pct, running, pausing, ready, addDrafter, failed, label, short, parts} */
function e4bDl() {
  const ks = e4bKeys(), total = ks.reduce((a, k) => a + partTotal(k), 0), have = ks.reduce((a, k) => a + partHave(k), 0);
  const running = ks.find((k) => S.dl[k].sub === 'downloading') || null, pausing = ks.some((k) => S.dl[k].sub === 'pausing');
  const failed = ks.find((k) => S.dl[k].sub === 'failed') || null, bigOk = done('brain4'), ready = bigOk && ks.every((k) => done(k));
  const addDrafter = bigOk && !ready && !running && !pausing && !S.e4bPair && !(S.dl.drafter4.have > 0);
  const pct = total ? have / total : 0, left = fmtSize(Math.max(0, total - have));
  const label = ready ? 'The bigger brain is ready' : running ? `Pause · ${Math.floor(pct * 100)}%` : pausing ? 'Pausing…' : addDrafter ? `Add faster replies · ${fmtSize(partTotal('drafter4'))}`
    : have > 0 ? `Resume the bigger brain · ${left} left` : `Download the bigger brain · ${fmtSize(total)}`;
  const short = ready ? 'Ready' : running ? 'Pause' : pausing ? 'Pausing…' : addDrafter ? 'Add' : have > 0 ? 'Resume' : 'Download';
  const part = (k) => `${E4B_PART[k]} ${done(k) ? '✓' : S.dl[k].have > 0 ? `${Math.floor(partHave(k) / partTotal(k) * 100)}%` : fmtSize(partTotal(k))}`;
  return { total, have, pct, running, pausing, ready, addDrafter, failed, label, short, parts: ks.map(part).join(' · ') };
}
/** the one button: download what is missing (the bigger brain, then its faster replies), Pause / Resume the pair */
function e4bTap() {
  const m = e4bDl();
  if (m.running) { S.e4bPair = true; return pauseDownload(m.running); }   // a paused pair resumes as a pair
  if (m.ready || m.pausing) return;
  S.e4bPair = true;
  if (!done('brain4')) return startDownload('brain4');
  if (E.drafter4 && !done('drafter4')) return startDownload('drafter4');
}
const autoResume = () => { if (document.hidden) return; for (const k of DL) { const u = S.dl[k]; if (u.sub === 'dropped' && !u.userPaused && E[k]) startDownload(k); } };
const dlPct = (u) => (u.total ? u.have / u.total : 0);
function dlLine(u, pct) {
  const amt = u.total < 1e9 ? `${Math.round(u.have / 1e6)} of ${Math.round(u.total / 1e6)} MB` : `${(u.have / 1e9).toFixed(1)} of ${gb(u.total)}`;
  const of = `${pct ? `${Math.floor(dlPct(u) * 100)}% · ` : ''}${amt}`;
  return u.sub === 'downloading' && u.bps > 0 ? `${of} · ${Math.round(u.bps / 1e6)} MB/s${u.eta != null ? ` · ${about(u.eta)} left` : ''}` : of;
}
const dlLabel = (u, short) => (u.sub === 'downloading' ? 'Pause' : u.sub === 'pausing' ? 'Pausing…' : u.have > 0 ? (short ? 'Resume' : `Resume · ${fmtSize(Math.max(0, u.total - u.have))} left`) : (short ? 'Download' : `Download ${fmtSize(u.total)}`));
function renderDl() { renderLessonDl(); if (S.phase === 'setup') return; renderPill(); if (S.tab === 'create') { renderNeed(); renderReader(); } if (S.tab === 'settings') renderModels(); if (CH) CH.renderDl(); if (VOICEIN) VOICEIN.render(); }
/** what a download is called in a sentence ("Pause the music model first.") */
const dlNoun = (k) => (k === 'reader' || k === 'lora' || k === 'lora2' || k === 'venc' || k === 'planner' || k === 'drafter' || k === 'brain4' || k === 'drafter4' ? MODELS[k].noun : k === 'brain' ? 'assistant' : `${MODELS[k].noun} model`);
const theNoun = (k) => (k === 'brain' ? 'Juli' : k === 'jvoice' ? 'Juli’s voice' : 'the ' + dlNoun(k));   // 3.8: the assistant is called Juli

// ------------------------------------------------------------------------------------------------ making a picture or a clip
function formParams() {
  const f = S.form, z = size(f.size), fixed = f.seedMode === 'fixed' && /^\d+$/.test(f.seed);
  return Object.assign({ media: 'image', kind: S.photo ? 'i2i' : 't2i', prompt: f.prompt.trim(), width: z.w, height: z.h, steps: f.steps,
    seed: fixed ? Number(f.seed) % 2147483648 : newSeed(), reference: f.ref, attested: !!(S.photo && S.attest) }, pic9() ? { quality: '9b' } : {});   // v026.6
}
// ---- v026.6: FLUX.2 [klein] 9B in Create
const pic9 = () => S.form.model === '9b' && done('k9b');
const vq = () => (done('k9b') && vsrc() === 'words' && ['high', 'highest'].includes(S.vform.q) ? S.vform.q : 'standard');
/** a 9B picture's time on the phone: the engine's calibrated model when it has one, else Josh's iPhone (512² in 131 s; 720×1280 ~7 min) */
function k9bSeconds(w, h, edit = false) {
  const e = E.k9b && E.k9b.estimate ? E.k9b.estimate(w, h, 4, edit) : null;
  if (e) return e.text + e.encode + 4 * e.step + e.decode + 10;
  return 131 * Math.pow((w * h) / 262144, 0.93) * (edit ? 1.3 : 1);
}
const HQ_TIP = 'For high quality renderings use 9B with first frame or first frame last frame.';   // Josh, verbatim
function saveHq() { ls.set('pf.app.hq', S.hq ? Object.assign({}, S.hq, { urls: undefined, blobs: undefined }) : null); }
/** High / Highest: 9B paints the first frame (Highest: and the last, a 9B EDIT of the first with how it ends), the person reviews and may
 *  reroll them, then SANA animates: image-to-video (High) or first/last frame with the 4.5 s trim (Highest) */
function startHq() {
  const f = S.vform, z = vsize(f.size), mode = vq(), end = String(f.end || '').trim();
  if (mode === 'highest' && !end) { toast('Say how the clip ends first.'); const e = $('v-end'); if (e) e.focus(); return; }
  if (!done('video')) { toast(`Get the ${MODELS.video.noun} model first.`); return; }
  S.hq = { mode, prompt: f.prompt.trim(), end, w: z.w, h: z.h, frames: FRAMES[f.len] || 81, seed: newSeed(), first: null, last: null, stage: 'first', t: Date.now() };
  saveHq(); hqPaint('first');
}
function hqPaint(role) {
  const H = S.hq; if (!H) return;
  const first = role === 'first', seed = first ? H.seed : newSeed();
  H.stage = role; saveHq();
  const p = { media: 'image', kind: first ? 't2i' : 'i2i', prompt: first ? H.prompt : `${H.end.replace(/[.\s]*$/, '.')} Keep the same subject and world as the reference.`, width: H.w, height: H.h, steps: 4,
    seed, quality: '9b', reference: 'half', attested: true, hq: { role, mode: H.mode } };
  if (first) return startJob(p, null);
  hqBlob('first').then((b) => { if (!b) { toast('The first frame is gone: paint it again.'); return hqPaint('first'); } startJob(p, b); });
}
async function hqBlob(role) {
  const H = S.hq; if (!H || !H[role]) return null;
  if (H.blobs && H.blobs[role]) return H.blobs[role];
  const b = await store.getBlob(H[role].libId).catch(() => null);
  if (b) { H.blobs = H.blobs || {}; H.blobs[role] = b; }
  return b;
}
/** a 9B frame landed (Create's own job, or after a fresh page) */
function hqFrameDone(params, res) {
  const H = S.hq, role = params.hq && params.hq.role; if (!H || !role || !res) return;
  H[role] = { libId: res.id, seed: res.seed }; H.blobs = Object.assign(H.blobs || {}, res.blob ? { [role]: res.blob } : {});
  if (role === 'first' && H.mode === 'highest') { H.last = null; saveHq(); setTimeout(() => hqPaint('last'), 60); return; }
  H.stage = 'review'; saveHq(); render(); renderHq();
}
async function renderHq() {
  const H = S.hq, box = $('hq-review'); if (!box) return;
  const show = !!(H && H.stage === 'review' && S.tab === 'create' && S.phase !== 'working');
  box.hidden = !show; if (!show) return;
  H.urls = H.urls || {};
  for (const role of ['first', 'last']) {
    const img = $('hq-' + role), fig = img && img.closest('figure'); if (!img) continue;
    if (fig) fig.hidden = role === 'last' && H.mode !== 'highest';
    if (role === 'last' && H.mode !== 'highest') continue;
    const b = await hqBlob(role); if (!b) continue;
    if (!H.urls[role] || H.urls[role].b !== b) { if (H.urls[role]) URL.revokeObjectURL(H.urls[role].u); H.urls[role] = { b, u: URL.createObjectURL(b) }; }
    if (img.getAttribute('src') !== H.urls[role].u) img.src = H.urls[role].u;
  }
  $('hq-title').textContent = H.mode === 'highest' ? 'Check the first and last frames (Klein 9B)' : 'Check the first frame (Klein 9B)';
  $('hq-re2').hidden = H.mode !== 'highest';
  const vk = H.mode === 'highest' ? 'flf' : 'i2v';
  $('hq-est').textContent = `Animate: ${aboutLong(estimate({ media: 'video', kind: vk, width: H.w, height: H.h, frames: H.frames }))} on this phone${H.mode === 'highest' ? ', the clip stops half a second before the last frame' : ''}.`;
}
async function hqAnimate() {
  const H = S.hq; if (!H || S.phase === 'working') return;
  if (!done('reader')) { toast(`Getting the picture reader first (${fmtSize(S.dl.reader.total)}, one time). Tap Animate again when it is done.`); startDownload('reader'); return; }
  const a = await hqBlob('first'), b = H.mode === 'highest' ? await hqBlob('last') : null;
  if (!a || (H.mode === 'highest' && !b)) { toast('A frame is missing: paint it again.'); return; }
  const highest = H.mode === 'highest';
  const p = { media: 'video', kind: highest ? 'flf' : 'i2v', prompt: highest ? `${H.prompt.replace(/[.\s]*$/, '.')} The clip ends with ${H.end.replace(/[.\s]*$/, '')}.` : H.prompt,
    width: H.w, height: H.h, frames: H.frames, seed: newSeed(), attested: true, hq: { mode: H.mode },
    sources: [{ from: 'library', libId: H.first.libId }].concat(highest ? [{ from: 'library', libId: H.last.libId }] : []) };
  H.stage = 'animate'; saveHq(); $('hq-review').hidden = true;
  startJob(p, highest ? [a, b] : [a], p.sources.map((s) => ({ from: 'library', libId: s.libId, thumb: null })));
}
function hqReroll(role) {
  const H = S.hq; if (!H || S.phase === 'working') return;
  if (role === 'first') { H.seed = newSeed(); H.first = null; H.last = null; if (H.blobs) H.blobs = {}; }   // a new first frame: the last is edited again from it
  else H.last = null;
  hqPaint(role);
}
// ---- v4 Phase 4: Create › Video › Restyle a clip. Pick a clip (the Library, or a video from the phone) and a look -> Klein 4B restyles
// its first frame (an 'edit' job: checked here, never saved) -> Use this -> the clip re-rendered from it with the looks LoRA (a 'restyle'
// job, ui/style_run.js) -> the Library, beside its source. The clip is read once, at pick time, into its frames (ui/clipprep.js). S.sty
// (localStorage 'pf.app.sty') and its blobs (the Library store's 'inputs' slot 'style') survive a reload and the planned fresh pages.
// v4 (Nov 2): the clip's own sound is read at pick time (ui/clipsound.js, the sound track only) and goes under the new clip; a video
// longer than 5 s is restyled as its first 5 s, or (the person's choice, Experimental) whole, in parts: the other parts' windows are read
// when "Restyle the whole video" is turned on (store 'inputs' slot 'style-parts'), and Use this queues one 'restylelong' job.
const STY_NEEDS = ['image', 'reader', 'venc', 'lora2'];   // besides the video model: what a restyle uses, in the order Make downloads it
{ const v = S.vform; if (v.followPick == null && v.follow === 'loose') v.followPick = 'loose'; delete v.follow; }   // v4 (Nov 3): a draft's 'follow' was the global default unless it said Loosely, which only a tap made
/** the look a restyle would take now: the checked first frame's while it is under review, else the one picked */
const styLookNow = () => (S.sty && S.sty.stage === 'review' && S.sty.look) || S.vform.look;
const saveSty = () => ls.set('pf.app.sty', S.sty ? { stage: S.sty.stage || null, clip: S.sty.clip || null, attest: !!S.sty.attest, seed: S.sty.seed || null, look: S.sty.look || null, whole: !!S.sty.whole } : null);
/** v4: the parts the picked clip would be restyled in whole ([] for 5 s or less), and whether the person chose that */
const styParts = () => { const c = S.sty && S.sty.clip; return c && c.duration ? partsOf(c.duration) : []; };
const styWhole = () => !!(S.sty && S.sty.whole && S.sty.clip && styParts().length > 1);
const styEst = (c, frames) => estimate({ media: 'video', kind: 'v2v', width: c.width, height: c.height, frames });
const styState = () => ({ clip: S.sty && S.sty.clip, preparing: !!S.styPrep, attest: !!(S.sty && S.sty.attest), look: S.vform.look, prompt: S.vform.prompt });
const styZ = () => { const c = S.sty && S.sty.clip; return c ? { w: c.width, h: c.height, slow: false } : { w: 832, h: 480, slow: false }; };
const styNeeds = () => STY_NEEDS.filter((k) => E[k] && !done(k));
const styAttested = () => !!(S.sty && S.sty.clip && (S.sty.clip.from === 'library' || S.sty.attest));
function styUrl(k) { const B = S.styB; if (!B || !B[k]) return null; B.urls = B.urls || {}; if (!B.urls[k]) B.urls[k] = URL.createObjectURL(B[k]); return B.urls[k]; }
/** what the stage shows: the clip's first frame (in review: the restyled one), already the restyle's size */
function styFirst() {
  const c = S.sty && S.sty.clip; if (!c || !S.styB) return null;
  const url = S.sty.stage === 'review' && S.styB.styled ? styUrl('styled') : styUrl('first');
  return url ? { url, w: c.width, h: c.height } : null;
}
/** forget the restyled first frame (all: the clip too) */
function styForget(all) {
  const B = S.styB; if (!B) return;
  for (const k of all ? ['first', 'styled', 'thumb'] : ['styled']) if (B.urls && B.urls[k]) { URL.revokeObjectURL(B.urls[k]); B.urls[k] = null; }
  if (all) S.styB = null; else B.styled = null;
}
const styKeep = () => (S.styB ? store.putStyleInput({ pack: S.styB.pack, first: S.styB.first, thumb: S.styB.thumb || null, styled: S.styB.styled || null, sound: S.styB.sound || null }).catch(() => toast("Couldn't keep the clip on this phone; it stays for this visit")) : Promise.resolve());   // v4: + its sound
async function styLoad() {
  if (!S.sty || !S.sty.clip) { if (S.sty) { S.sty = null; saveSty(); } return; }
  const r = await store.getStyleInput().catch(() => null);
  if (!r || !r.pack || !r.first) { S.sty = null; saveSty(); return render(); }
  S.styB = { pack: r.pack, first: r.first, thumb: r.thumb || null, styled: r.styled || null, sound: r.sound || null, urls: {}, partsN: 0 };
  { const pp = await store.getStyleParts().catch(() => null); S.styB.partsN = pp && pp.t === S.sty.clip.t && Array.isArray(pp.parts) ? pp.parts.length : 0; }   // v4: the other parts, read before the reload
  if (S.sty.whole && S.styB.partsN < styParts().length - 1) { if (S.sty.clip.from === 'library') styReadParts(); else S.sty.whole = false; }   // a phone video is not on the page any more: pick it again
  const busy = Q && Q.list({ includeTerminal: false }).some((j) => j.params && j.params.ui && j.params.ui.sty);
  if ((S.sty.stage === 'first' || S.sty.stage === 'clip') && !busy) S.sty.stage = S.styB.styled ? 'review' : null;   // its job is gone: back to the check
  if (S.sty.stage === 'review' && !S.styB.styled) S.sty.stage = null;
  saveSty(); render();
}
function styClear() {
  S.styTok = (S.styTok || 0) + 1; if (S.styAbort) { S.styAbort.abort(); S.styAbort = null; } styForget(true); S.sty = null; S.styPrep = null; S.styPartsRead = null; S.styOrig = null; saveSty();
  store.clearStyleInput().catch(() => {}); store.clearStyleParts().catch(() => {}); render();
}
/** a clip picked (the Library or the phone) -> its frames (its first seconds, at most STYLE_CAP_S, scaled to fit the SANA size nearest its shape:
 *  ui/style_v2v.js styleSize, never a hard crop) */
async function pickClip(blob, info) {
  if (S.phase === 'working') return toast('Wait — something is being made');
  const tok = (S.styTok = (S.styTok || 0) + 1);
  if (S.styAbort) S.styAbort.abort(); const ac = (S.styAbort = new AbortController());   // a clip still being read stops for the new one
  styForget(true); S.sty = { stage: null, clip: null, attest: false, whole: false }; S.styOrig = info.from === 'phone' ? blob : null; S.styPartsRead = null;
  S.styPrep = { i: 0, n: 0 }; saveSty(); store.clearStyleInput().catch(() => {}); store.clearStyleParts().catch(() => {}); render(); toStage();
  try {
    const CP = await import('./ui/clipprep.js');
    const pr = await CP.probeClip(blob); if (tok !== S.styTok) return;
    const ml = maxLen(pr.duration), shape = styleSize(pr.width, pr.height);   // v4: the whole frame, scaled to fit (a small trim, or its edges extended)
    const base = { from: info.from, libId: info.libId || null, duration: pr.duration, srcW: pr.width, srcH: pr.height, width: shape.width, height: shape.height, fit: shape.fit, maxLen: ml, t: Date.now() };
    if (ml < 1) { S.styPrep = null; S.sty.clip = Object.assign(base, { frames: 0 }); saveSty(); toast('That clip is shorter than a second. Pick a longer one.'); return render(); }
    const n = framesOf(ml); S.styPrep = { i: 0, n }; renderStyle();
    const r = await CP.prepareClip(blob, { width: shape.width, height: shape.height, frames: n, signal: ac.signal, onProgress: (i) => { if (tok === S.styTok && S.styPrep) { S.styPrep.i = i; renderStyleProgress(); } } });
    if (tok !== S.styTok) return;
    const thumb = await makeThumb(r.first, 160).catch(() => null);
    // v4: its own sound (the sound track only, never the picture), as long as the longest restyle of it can be: the whole video in parts
    const plan = partsOf(pr.duration), need = (plan.length ? joinedFrames(plan) : n) / STYLE_FPS;
    let sound = null, sw = 'none', why = null;
    try { const CS = await import('./ui/clipsound.js'), sd = await CS.readSound(blob, { seconds: need, signal: ac.signal }); if (sd.pcm) { sound = CS.soundBlob(sd.pcm); sw = 'yes'; } else { sw = sd.none; why = sd.why || null; } }
    catch (e) { if (isAbort(e)) throw e; sw = 'unreadable'; why = String((e && e.message) || e).slice(0, 120); }
    if (tok !== S.styTok) return;
    if (why) diag('restyle: the clip\'s sound', { sound: sw, why });
    S.styB = { pack: r.pack, first: r.first, thumb, styled: null, sound, urls: {}, partsN: 0 };
    S.sty = { stage: null, clip: Object.assign(base, { frames: n, via: r.via, sound: sw, parts: plan.length }), attest: false, whole: false }; S.styPrep = null; saveSty(); styKeep();
    if (S.vform.len > ml) S.vform.len = ml;
    if (info.prompt && (!S.vform.prompt.trim() || S.vform.prompt === S.styPrefill)) { S.vform.prompt = String(info.prompt).slice(0, 2000); S.styPrefill = S.vform.prompt; syncPrompt(); }
    saveDraft(); render(); toStage();
  } catch (e) {
    if (tok !== S.styTok) return;
    S.styPrep = null; S.sty = null; S.styOrig = null; saveSty(); render();
    toast(e && e.code === 'BAD_VIDEO' ? msg(e) : "That video couldn't be opened on this phone. Try another.");
  }
}
/** v4: "Restyle the whole video" turned on: the other parts' windows of the clip, read now (one frames pack a part; kept in the store,
 *  not on the page). A phone video must still be on the page (it is never copied whole); a Library clip is read from the Library. */
async function styReadParts() {
  const c = S.sty && S.sty.clip, plan = styParts().slice(1);
  if (!c || !plan.length || S.styPartsRead || (S.styB && S.styB.partsN === plan.length)) return;
  const tok = S.styTok, src = S.styOrig || (c.from === 'library' && c.libId ? await store.getBlob(c.libId).catch(() => null) : null);
  if (tok !== S.styTok) return;
  if (!src) { S.sty.whole = false; saveSty(); render(); return toast('Pick the video again to restyle all of it.'); }
  const ac = S.styAbort && !S.styAbort.signal.aborted ? S.styAbort : (S.styAbort = new AbortController());
  S.styPartsRead = { done: 0, total: plan.reduce((a, p) => a + p.frames, 0) }; renderStyle();
  try {
    const CP = await import('./ui/clipprep.js'), packs = [];
    await CP.prepareParts(src, { width: c.width, height: c.height, parts: plan, signal: ac.signal, onPart: (i, r) => { packs.push(r.pack); },
      onProgress: (d, t) => { if (tok === S.styTok && S.styPartsRead) { S.styPartsRead.done = d; S.styPartsRead.total = t; renderWholeProgress(); } } });
    if (tok !== S.styTok) return;
    await store.putStyleParts({ parts: packs, t: c.t });
    if (tok !== S.styTok) return;
    S.styB.partsN = packs.length; S.styPartsRead = null; render();
  } catch (e) {
    if (tok !== S.styTok) return;
    S.styPartsRead = null; S.sty.whole = false; saveSty(); render();
    if (!isAbort(e)) toast(`The rest of the video couldn't be read here. Its first ${STYLE_CAP_S} s can still be restyled.`);
  }
}
function openClipPicker() {
  PK.clip = true; PK.slot = 0; for (const u of PK.urls) URL.revokeObjectURL(u); PK.urls = [];
  const clips = S.lib.filter((m) => isClip(m) && !isMV(m) && m.vmode !== 'lipsync');
  $('pk-title').textContent = 'Pick a clip';
  $('pk-note').textContent = clips.length ? `From your Library. A clip longer than ${STYLE_CAP_S} s is restyled as its first ${STYLE_CAP_S} s (or whole, in parts: Experimental), the whole frame scaled to fit the video model’s size nearest its shape.` : '';
  $('pk-grid').replaceChildren(...clips.map((m) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pk-tile'; b.dataset.id = m.id; b.setAttribute('aria-label', `Clip, ${lenText(m.frames)} seconds: ${m.prompt || ''}`);
    if (m.thumb instanceof Blob) { const u = URL.createObjectURL(m.thumb); PK.urls.push(u); const img = document.createElement('img'); img.alt = ''; img.src = u; img.loading = 'lazy'; b.append(img); }
    return b;
  }));
  $('pk-empty').textContent = 'No clips in the Library yet. Make one under Video, or use a video from your phone.'; $('pk-empty').hidden = clips.length > 0;
  const w = $('picker'); w.classList.remove('out'); w.hidden = false;
}
/** the words a Library clip brings: its own prompt (a restyle: its description, without the look's words) */
const clipWords = (m) => (m.vmode === 'v2v' ? m.description || '' : m.prompt || '');
async function clipFromLibrary(id) {
  const m = S.lib.find((x) => x.id === id), b = m && await store.getBlob(id).catch(() => null);
  if (!b) return toast("Couldn't open that clip");
  pickClip(b, { from: 'library', libId: id, prompt: clipWords(m) });
}
/** the Library viewer's Restyle: Create › Video › Restyle a clip with this clip */
function restyleFrom(m, blob) { toVideoSrc('style'); pickClip(blob, { from: 'library', libId: m.id, prompt: clipWords(m) }); toast('Pick a look, then tap Make'); }
/** Reuse on a restyled clip: its look and words, and its source clip when it is still in the Library */
async function reuseStyle(m) {
  toVideoSrc('style'); if (lookOf(m.look)) S.vform.look = m.look; S.vform.followPick = m.followBy === 'you' || (!m.followBy && m.follow === 'loose') ? followOf(m.follow) : null;   // the person's own pick comes back (before Nov 3 only a tap made Loosely); the look's own stays the look's S.vform.prompt = m.description || ''; S.styPrefill = S.vform.prompt; saveDraft(); syncPrompt(); render();
  const x = (m.sources || [])[0], src = x && x.libId && S.lib.find((y) => y.id === x.libId), b = src && await store.getBlob(src.id).catch(() => null);
  if (b) { await pickClip(b, { from: 'library', libId: src.id, prompt: null }); return toast('Look, clip and words are ready — tap Make'); }
  toast('Look and words are ready — pick the clip again');
}
/** Make on Restyle a clip: what is missing first (the clip, its tick, a look, the words, then a download), then its first frame */
function styleMake() {
  const miss = styleMissing(styState());
  if (miss) { toast(miss.why); if (miss.focus === 'prompt') return void $('prompt').focus(); return flag({ clip: $('vclip'), attest: $('sattest-box'), looks: $('g-look') }[miss.focus]); }
  if (!ltxOk()) return void openLtx(() => make());
  if (!styGet(styNeeds())) return;
  if (!S.styB || !S.styB.first || !S.styB.pack) { toast('Pick the clip again.'); return flag($('vclip')); }
  styPaint();
}
/** a download the restyle still needs: started (one at a time; the clip reader asks for the LTX-2 licence first) -> false */
function styGet(need) {
  if (!need.length) return true;
  const k = need[0], u = S.dl[k];
  if (['downloading', 'pausing'].includes(u.sub)) toast(`${cap(theNoun(k))} is downloading. Tap Make again when it’s done.`);
  else { toast(`Getting ${theNoun(k)} first (${fmtSize(u.total)}, one time). Tap Make again when it’s done.`); startDownload(k); }
  render(); return false;
}
/** Klein 4B restyles the clip's first frame at the clip's size (a new seed each time: Try again) */
function styPaint() {
  const s = S.sty; if (!s || !s.clip || !S.styB) return;
  Object.assign(s, { seed: newSeed(), look: S.vform.look, stage: 'first' }); saveSty();
  styForget(false); styKeep();
  startJob(editParams({ look: s.look, clip: s.clip, seed: s.seed, attested: styAttested() }), S.styB.first);
}
/** the restyled first frame landed (Create's own job, or after a fresh page): the check, not the Library */
function styFrameDone(r, params, mine = true) {
  if (mine) { if (pop) pop.finish(); S.popped = Date.now(); clearTimeout(poppedT); poppedT = setTimeout(renderPill, POPPED_MS + 50); S.job = null; }
  ls.set('pf.app.lastJob', null); store.clearInput().catch(() => {});
  if (S.sty && S.sty.clip && S.styB && r && r.blob) {
    styForget(false); S.styB.styled = r.blob;
    Object.assign(S.sty, { stage: 'review', look: (params.sty && params.sty.look) || S.sty.look, seed: r.seed }); saveSty(); styKeep();
  }
  if (mine) { set({ phase: 'ready' }); syncWake(); toStage(); } else render();
  return null;
}
/** Use this: the clip re-rendered from the checked first frame with the looks LoRA */
function styUse() {
  const s = S.sty, f = S.vform; if (!s || s.stage !== 'review' || S.phase === 'working') return;
  if (!consented()) return openLesson();
  if (!S.styB || !S.styB.styled || !S.styB.pack) { s.stage = null; saveSty(); render(); return toast('The first frame is gone: make it again.'); }
  if (!f.prompt.trim()) { toast('Say what happens in the clip first.'); return void $('prompt').focus(); }
  if (!ltxOk()) return void openLtx(() => styUse());
  if (!styGet(styNeeds().filter((k) => k !== 'image'))) return;
  const fixed = f.seedMode === 'fixed' && /^\d+$/.test(f.seed), seed = fixed ? Number(f.seed) % 2147483648 : newSeed();
  const srcs = [{ from: s.clip.from, libId: s.clip.libId || null, thumb: S.styB.thumb || null }], snd = S.styB.sound ? [S.styB.sound] : [];
  if (styWhole()) return styUseWhole(seed, srcs, snd);   // v4: the whole video, in parts
  const p = clipParams({ look: s.look || f.look, clip: s.clip, len: f.len, seed, prompt: f.prompt, attested: styAttested(), sound: !!snd.length, follow: f.followPick });
  s.stage = 'clip'; saveSty(); $('sty-review').hidden = true;
  startJob(p, [S.styB.pack, S.styB.styled, ...snd], srcs);   // v4: + its sound
}
/** v4: Use this on the whole video: the notice first (it takes a while: the estimate per part times the parts), then ONE 'restylelong'
 *  job: its parts are 'restyle' jobs it queues one after another, each starting on the last frame of the one before */
async function styUseWhole(seed, srcs, snd) {
  const s = S.sty, c = s.clip, f = S.vform, plan = styParts();
  if (S.styPartsRead) return toast('The rest of the video is still being read. One moment.');
  const pp = await store.getStyleParts().catch(() => null);
  if (!pp || pp.t !== c.t || !Array.isArray(pp.parts) || pp.parts.length !== plan.length - 1 || !pp.parts.every(Boolean)) { styReadParts(); return toast('Reading the rest of the video first. Tap Use this again when it is read.'); }
  const est = (fr) => styEst(c, fr), eta = wholeSeconds(plan, est), N = wholeNotice(plan, eta, est(plan[0].frames));
  openSheet(N.title, N.text, N.ok, () => {
    closeSheet();
    if (!S.sty || S.sty.stage !== 'review' || S.phase === 'working' || !S.styB || !S.styB.styled) return;
    const p = longParams({ look: s.look || f.look, clip: c, parts: plan, seed, prompt: f.prompt, attested: styAttested(), sound: !!snd.length, follow: f.followPick });
    s.stage = 'clip'; saveSty(); $('sty-review').hidden = true;
    startJob(p, [S.styB.pack, ...pp.parts, S.styB.styled, ...snd], srcs);
  }, null, 'cta');
}
/** a restyle's job stopped or failed: its first frame -> nothing to check; its clip -> the check again */
function styJobEnded(params) {
  const s = S.sty; if (!s || !params || !params.sty) return;
  s.stage = params.sty.role === 'clip' && S.styB && S.styB.styled ? 'review' : null; saveSty();
}
/** a restyled clip landed: the clip stays picked (another look is one Make away); its first frame goes */
function styClipDone() { if (!S.sty) return; S.sty.stage = null; styForget(false); saveSty(); styKeep(); }
/** Create › Video › Restyle a clip: the clip slot, its tick, the looks, what still downloads */
function renderStyle() {
  const show = S.mode === 'video' && vsrc() === 'style', box = $('vstyle'); box.hidden = !show; if (!show) return;
  const s = S.sty || {}, c = s.clip, pr = S.styPrep, el = $('vclip'), whole = styWhole();
  const key = `${c ? c.t : ''}|${pr ? 'prep' : ''}|${S.styB && S.styB.first ? 1 : 0}|${whole ? 'w' : ''}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key; el.textContent = ''; el.classList.toggle('filled', !!c);
    const th = mk('div', 'vs-thumb' + (c && S.styB ? '' : ' none'));
    if (c && S.styB && styUrl('first')) { const img = document.createElement('img'); img.alt = ''; img.src = styUrl('first'); th.append(img); } else th.innerHTML = '<svg class="ic"><use href="#i-film"/></svg>';
    const tx = mk('div', 'vs-txt'); tx.append(mk('p', 'vs-name', 'Clip'));
    if (pr) { tx.append(mk('p', 'footnote dim vs-meta', 'Reading the clip…')); const bar = mk('div', 'vs-prep'); bar.append(document.createElement('i')); tx.append(bar); }
    else if (c) {
      const crop = !c.fit && Math.abs(c.srcW / c.srcH - c.width / c.height) > 0.01;   // a clip read before v4's fit
      const snd = c.sound === 'yes' ? ' · with its sound' : c.sound === 'unreadable' ? ' · its sound can’t be read here' : c.sound === 'none' ? ' · no sound' : '';   // v4: its own sound goes under the new clip
      const ps = styParts(), at = crop ? `, the middle cropped to ${c.width} × ${c.height}` : ` at ${c.width} × ${c.height}${c.fit ? ` (${fitText(c.fit)})` : ''}`, secs = ps.reduce((a, x) => a + x.seconds, 0);   // v4: the size and how the frame went in
      tx.append(mk('p', 'footnote dim vs-meta', `${c.from === 'library' ? 'From your Library' : 'A video from your phone'} · ${(Math.round(c.duration * 10) / 10).toFixed(1)} s · ${c.srcW} × ${c.srcH}${snd}`),
        mk('p', 'footnote dim', !(c.maxLen >= 1) ? 'Shorter than a second: pick a longer clip.'
          : whole ? `Restyles ${secs + 0.5 >= c.duration ? `all ${secs} s` : `its first ${secs} s`} in ${ps.length} parts${at}.`
          : `Restyles its first ${c.maxLen} s${at}.${c.duration >= STYLE_CAP_S + 0.5 ? ` A longer video is restyled as its first ${STYLE_CAP_S} s.` : ''}`));
    } else {
      tx.append(mk('p', 'footnote dim', `A finished clip from your Library, or a video from your phone, with its sound. A longer video is restyled as its first ${STYLE_CAP_S} s.`));
      const bt = mk('div', 'vs-btns');
      bt.innerHTML = '<button class="btn sm" type="button" data-act="clib"><svg class="ic"><use href="#i-grid"/></svg><span>Library</span></button>'
        + '<button class="btn sm" type="button" data-act="cphone"><svg class="ic"><use href="#i-film"/></svg><span>Video</span></button>';
      bt.children[0].setAttribute('aria-label', 'A clip from the Library'); bt.children[1].setAttribute('aria-label', "A video from your phone");
      tx.append(bt);
    }
    el.append(th, tx);
    if (c || pr) { const xb = document.createElement('button'); xb.type = 'button'; xb.className = 'icon-btn vs-x'; xb.dataset.act = 'cx'; xb.setAttribute('aria-label', pr ? 'Stop reading the clip' : 'Remove the clip'); xb.innerHTML = '<svg class="ic"><use href="#i-x"/></svg>'; el.append(xb); }
  }
  renderStyleProgress();
  // v4: a whole-video restyle that stopped stays here until it carries on or is stopped (the error card goes when Create changes mode)
  { const k = S.phase !== 'working' && S.phase !== 'error' ? longKept() : null, kb = $('sty-kept'); kb.hidden = !k;
    if (k) { const t = longWords(k); $('sty-kept-text').textContent = `Your whole-video restyle: ${t.title.charAt(0).toLowerCase()}${t.title.slice(1)} ${t.note}`; $('sty-kept-go').textContent = t.go; kb.dataset.job = k.id; } }
  // v4: the whole video, in parts (the person's choice; offered only for a clip longer than 5 s): its words, the estimate, its reading
  { const ps = styParts(), row = $('sty-whole-row'), on = !!(c && !pr && ps.length > 1); row.hidden = !on;
    if (on) {
      const t = wholeText(ps, wholeSeconds(ps, (fr) => styEst(c, fr)), c.duration);
      $('sty-whole-name').textContent = t.name; $('sty-whole').checked = whole; $('sty-whole').disabled = S.phase === 'working';
      $('sty-whole').setAttribute('aria-label', t.line); $('sty-whole-note').textContent = t.note; renderWholeProgress();
    } }
  // the tick: a video from the phone (rights.ATTEST verbatim, unticked for every new video)
  const at = $('sattest-box'), phone = !!(c && c.from === 'phone' && !pr); at.hidden = !phone;
  if (phone) {
    if (!$('sattest-text').textContent) { $('sattest-text').textContent = rights.ATTEST; const ul = $('sattest-means'); for (const [b, t] of rights.MEANS) { const li = mk('li'); li.append(mk('b', null, b), ' ' + nb(t)); ul.append(li); } $('sattest-asof').textContent = rights.AS_OF; }
    $('sattest').checked = !!s.attest;
  }
  // the looks: built once; the one picked is checked
  const g = $('looks');
  if (!g.children.length) g.append(...LOOKS.map((L0) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'look'; b.dataset.v = L0.id; b.setAttribute('role', 'radio');
    const img = document.createElement('img'); img.alt = ''; img.src = lookThumb(L0.id); img.loading = 'lazy'; img.decoding = 'async'; img.width = 160; img.height = 160;
    b.append(img, mk('span', 'ln', L0.name)); if (L0.beta) b.append(mk('span', 'lb', 'beta'));
    b.setAttribute('aria-label', L0.beta ? `${L0.name}, beta` : L0.name); return b;
  }));
  for (const b of g.children) b.setAttribute('aria-checked', String(b.dataset.v === S.vform.look));
  // what a restyle still downloads (Make gets them one at a time)
  const need = styNeeds(), nn = $('sty-need'); nn.hidden = !need.length;
  if (need.length) {
    const dl = need.find((k) => ['downloading', 'pausing'].includes(S.dl[k].sub));
    $('sty-need-text').textContent = dl ? `Getting ${theNoun(dl)} · ${dlLine(S.dl[dl], true)}`
      : `Restyling also uses ${need.map((k) => `${theNoun(k)} (${fmtSize(S.dl[k].total || MODELS[k].total)})`).join(', ')}. Make downloads ${need.length > 1 ? 'them one at a time' : 'it'}, once${need.includes('venc') ? '; the clip reader asks you to accept its licence first' : ''}.`;
  }
}
/** v4: the other parts being read (the switch's note), or what they say when read */
function renderWholeProgress() {
  const r = S.styPartsRead, bar = $('sty-whole-bar'), el = $('sty-whole-read'); if (!bar || !el) return;
  bar.hidden = !r; el.hidden = !r; if (!r) return;
  bar.firstElementChild.style.transform = `scaleX(${r.total ? (r.done / r.total).toFixed(3) : 0})`;
  el.textContent = `Reading the rest of the video · frame ${r.done} of ${r.total} · ${about(Math.max(1, (r.total - r.done) * PREP_SECONDS_PER_FRAME))} left`;
}
function renderStyleProgress() {
  const pr = S.styPrep, el = $('vclip'), i = el && el.querySelector('.vs-prep i'), m = el && el.querySelector('.vs-meta'); if (!pr || !i) return;
  i.style.transform = `scaleX(${pr.n ? (pr.i / pr.n).toFixed(3) : 0})`;
  if (m) m.textContent = pr.n ? `Reading the clip · frame ${pr.i} of ${pr.n} · ${about(Math.max(1, (pr.n - pr.i) * PREP_SECONDS_PER_FRAME))} left` : 'Reading the clip…';
}
/** the restyled first frame, checked before the clip: Use this / Try again / Start over */
function renderStyReview() {
  const s = S.sty, box = $('sty-review'), c = s && s.clip;
  const show = !!(S.tab === 'create' && S.mode === 'video' && vsrc() === 'style' && s && s.stage === 'review' && c && S.styB && S.styB.styled && S.phase !== 'working');
  box.hidden = !show; if (!show) return;
  const L0 = lookOf(s.look), u1 = styUrl('first'), u2 = styUrl('styled');
  if ($('sty-src').getAttribute('src') !== u1) $('sty-src').src = u1;
  if ($('sty-new').getAttribute('src') !== u2) $('sty-new').src = u2;
  $('sty-cap').textContent = `${L0 ? L0.name : 'The new look'}${L0 && L0.beta ? ' (beta)' : ''} · Klein 4B`;
  const n = lenFor(S.vform.len, c.maxLen), whole = styWhole(), ps = styParts(), again = S.vform.look && S.vform.look !== s.look ? ' You picked another look since: Try again makes its first frame.' : '';
  $('sty-tip').textContent = whole ? 'Every part takes this look and keeps the video’s motion. Each part starts on the last frame of the part before, so this is the only frame you check.'
    : 'The whole clip takes this look and keeps the clip’s motion. Anything Klein added stays in the clip too.';   // v4: + the whole video
  $('sty-est').textContent = whole ? `${wholeText(ps, wholeSeconds(ps, (fr) => styEst(c, fr)), c.duration).line}.${again}`
    : `The clip: ${aboutLong(estimate({ media: 'video', kind: 'v2v', width: c.width, height: c.height, frames: framesOf(n) }))} on this phone for its first ${n} s.${again}`;
}
function videoParams() {
  const f = S.vform, z = vsize(f.size), fixed = f.seedMode === 'fixed' && /^\d+$/.test(f.seed), src = vsrc();
  const p = { media: 'video', kind: SRC[src].kind, prompt: f.prompt.trim(), width: z.w, height: z.h, frames: FRAMES[f.len] || 81, seed: fixed ? Number(f.seed) % 2147483648 : newSeed() };
  // pictures from the Library are the app's own results; a phone photo needs its own tick (the engine refuses NOT_ATTESTED otherwise)
  if (src !== 'words') Object.assign(p, { attested: attestOK(), sources: activeSlots().map((x) => ({ from: x.from, libId: x.libId || null })) });
  return p;
}
/** a box (or slot) that needs attention: scrolled into view and outlined for a moment */
function flag(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  el.classList.add('need'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('need'), 2400);
}
/** Make on a picture clip whose picture reader is missing: download it (213 MB, once), then the clip starts by itself */
function readerThenMake() {
  const u = S.dl.reader; S.pending = true;
  if (['downloading', 'pausing'].includes(u.sub)) { toast('The picture reader is downloading. Your clip starts when it’s ready.'); return render(); }
  toast(`Getting the picture reader first (${fmtSize(u.total)}, one time). Your clip starts right after.`);
  startDownload('reader');
}
function make() {
  const vid = S.mode === 'video';
  if (!consented()) return openLesson();
  if (!done(S.mode)) { toast(`Get the ${MODELS[S.mode].noun} model first.`); toStage(); return; }
  if (!vid && S.photo && !S.attest) {
    toast('Tick the box about your photo first.'); const box = $('attest-box');
    box.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    box.classList.add('need'); clearTimeout(box._t); box._t = setTimeout(() => box.classList.remove('need'), 2400); return;
  }
  if (vid && vsrc() === 'style') return styleMake();   // v4 Phase 4: Restyle a clip (its own checks, then its first frame)
  const pic = vid && vsrc() !== 'words';
  if (pic) {
    const miss = activeSlots().findIndex((x) => !x);
    if (miss >= 0) { toast(slotsNeeded() === 2 ? (miss ? 'Pick the last picture.' : 'Pick the first picture.') : 'Pick a picture first.'); return flag(document.querySelector(`.vslot[data-i="${miss}"]`)); }
    const un = activeSlots().findIndex((x) => x.from === 'phone' && !x.attest);
    if (un >= 0) { toast('Tick the box about your photo first.'); return flag($(`vattest-box-${un}`)); }
  }
  if (!F().prompt.trim()) { toast(pic ? (vsrc() === 'two' ? 'Describe the change first.' : 'Describe what moves first.') : vid ? 'Describe the clip first.' : 'Describe the picture first.'); $('prompt').focus(); return; }
  if (vid && !ltxOk()) return void openLtx(() => make());   // the Gemma tick: before any video job (also High / Highest, whose 9B frames come first)
  if (pic && !done('reader')) return readerThenMake();
  if (pic) return startJob(videoParams(), activeSlots().map((x) => x.blob), sourcesOf(activeSlots()));
  if (vid && vq() !== 'standard') return startHq();   // v026.6: High / Highest: the 9B frames first, reviewed before animating
  startJob(vid ? videoParams() : formParams(), !vid && S.photo && S.photo.blob);
}
/** v019: Make (and Again, Try again, Resume) puts the job in THE queue (assistant/queue.js): one job on the GPU at a time, shared with
 *  the assistant. The stage turns 'working' at once (inside the tap); it shows "waiting its turn" until the queue starts the job, then
 *  the popcorn. The queue keeps the job's pictures and seed, so a page kill resumes it from the engine's checkpoint. */
async function startJob(params, input, srcs) {
  const k = params.media === 'video' ? 'video' : 'image', e = E[k], pic = isPic(params.kind);
  if (!['ready', 'result', 'error'].includes(S.phase) || !e) return;   // one job at a time on the stage: a double tap is a no-op
  if (!consented()) return openLesson();   // every way into a job (Make, Again, resume, retry) passes here
  if (k === 'video' && !ltxOk()) return void openLtx(() => startJob(params, input, srcs));   // the Gemma tick (and the LTX licence) before a video job
  if (params.kind === 'i2i' && (!input || !params.attested)) return;
  if (pic && (!picOK() || (!params.resume && (!Array.isArray(input) || input.length < (params.kind === 'flf' ? 2 : 1) || !input.every(Boolean) || !params.attested)))) return;
  if (params.kind === 'v2v' && !params.resume && (!styleOK() || !Array.isArray(input) || input.length < (params.long ? params.parts.length + 1 : 2) || !input.every(Boolean) || !params.attested)) return;   // v4: the clip's frames (each part's) + its styled first frame (+ its sound)
  if (!Q) return toast('p0pc0rn is still starting. Try again in a moment.');
  if (Q.readOnly) return toast('p0pc0rn is open in another tab. Make it there, or close that tab first.');
  wake.on();   // synchronously inside the tap (iOS)
  dropResult(); if (S.mode !== k && !params.hq && !params.sty) { S.mode = k; ls.set('pf.app.mode', k); }   // v026.6: a High / Highest frame stays on the Video form (v4: so does a restyle's first frame)
  const token = 'create:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  S.job = { id: null, token, origin: 'create', kind: queueKind(params), mk: k, media: k, params, input, srcs: pic || params.kind === 'v2v' ? srcs || null : null, sub: 'running', armed: false, waiting: true,
    p: { phase: 'load', step: 0, steps: k === 'video' ? 4 : params.steps, etaSeconds: null }, frac: 0, t0: Date.now(), at: Date.now() };
  Object.assign(S, { error: null, hot: false, gpuReset: false, killed: null, vkilled: null, ckHidden: false, popped: 0, pending: false });
  set({ phase: 'working' });   // synchronous, before any await
  ls.set(k === 'video' ? 'pf.app.lastVideo' : 'pf.app.lastJob', params); if (k === 'image') ls.set('pf.app.tipSeen', true);
  tick(); toStage();
  try {
    if (pic && !params.resume) await store.putVideoInputs(input.map((b, i) => Object.assign({ blob: b }, (srcs && srcs[i]) || { from: 'phone', libId: null, thumb: null }))).catch(() => {});   // the Library's thumbnails
    if (params.kind === 'i2i') await store.putInput(input).catch(() => {});
    const qp = await queueParams(params, input);
    if (CONNECT_ON && params.renderOn !== 'phone') await connectP().then((c) => c.route(queueKind(params), qp, params)).catch(() => false);   // Connection (off in public builds)
    if (!S.job || S.job.token !== token) return;
    if (S.job.cancelWanted) { S.job = null; set({ phase: 'ready' }); return syncWake(); }   // cancelled before it reached the queue
    const j = await Q.add(queueKind(params), qp, { tag: token, title: (params.prompt || '').slice(0, 60) });
    CJ.set(j.id, { params, input, srcs: pic || params.kind === 'v2v' ? srcs || null : null });
    if (S.job && S.job.token === token) { S.job.id = j.id; if (S.job.cancelWanted) Q.cancel(j.id); }
  } catch (x) { if (S.job && S.job.token === token) jobFailed(x, params, input); }
}
/** a Create job's queue kind (the runner that makes it, assistant/runners.js; 'resume' = the unfinished picture clip, app-side) */
const queueKind = (p) => (p.media === 'video' ? (p.resume && (isPic(p.kind) || p.kind === 'v2v') ? 'resume' : p.kind === 'v2v' ? (p.long ? 'restylelong' : 'restyle') : p.kind === 'i2v' ? 'animate' : p.kind === 'flf' ? 'between' : 'clip') : p.kind === 'i2i' ? 'edit' : 'picture');
/** the Create form's params -> the runner's params. Pictures go into the queue's own store first (blob keys), so a page kill keeps them. */
async function queueParams(p, input) {
  const ui = Object.assign({}, p, { sources: p.sources || null });
  const base = { prompt: p.prompt, width: p.width, height: p.height, seed: p.seed, ui };
  if (p.media !== 'video') {
    const q9 = p.quality === '9b' ? { quality: '9b' } : {};   // v026.6: the 9B
    if (p.kind === 'i2i') return Object.assign(base, { steps: p.steps, inputKey: await Q.putBlob(input, { role: 'create-photo' }), attested: !!p.attested, reference: p.reference || 'half' }, q9);
    return Object.assign(base, { steps: p.steps }, q9);
  }
  if (p.resume && (isPic(p.kind) || p.kind === 'v2v')) return Object.assign(base, { frames: p.frames, mode: 'picture', attested: true });
  if (p.kind === 'v2v' && p.long) {   // v4: the whole video in parts (ui/style_run.js restyleLongRunner): every part's frames pack, the checked first frame, the sound
    const n = p.parts.length, packKeys = [];
    for (let i = 0; i < n; i++) packKeys.push(await Q.putBlob(input[i], { role: 'create-clip' }));
    return Object.assign(base, { frames: p.frames, seconds: lenOf(p.frames), parts: p.parts, packKeys, firstKey: await Q.putBlob(input[n], { role: 'create-picture' }),
      soundKey: p.sound && input[n + 1] ? await Q.putBlob(input[n + 1], { role: 'create-sound' }) : null, attested: !!p.attested, follow: p.follow || null, startStep: p.startStep == null ? null : p.startStep, lowswap: p.lowswap || null,
      look: p.look || null, description: p.description || '' });
  }
  if (p.kind === 'v2v') return Object.assign(base, { frames: p.frames, seconds: lenOf(p.frames), sourceKey: await Q.putBlob(input[0], { role: 'create-clip' }), firstKey: await Q.putBlob(input[1], { role: 'create-picture' }),
    soundKey: p.sound && input[2] ? await Q.putBlob(input[2], { role: 'create-sound' }) : null,
    attested: !!p.attested, follow: p.follow || null, startStep: p.startStep == null ? null : p.startStep, lowswap: p.lowswap || null, look: p.look || null });   // v4: ui/style_run.js (the frames pack + the styled first frame + the clip's own sound)
  if (p.kind === 'i2v') return Object.assign(base, { frames: p.frames, seconds: lenOf(p.frames), imageKey: await Q.putBlob(input[0], { role: 'create-picture' }), attested: !!p.attested });
  if (p.kind === 'flf') return Object.assign(base, { frames: p.frames, seconds: lenOf(p.frames), firstKey: await Q.putBlob(input[0], { role: 'create-picture' }), lastKey: await Q.putBlob(input[1], { role: 'create-picture' }), attested: !!p.attested });
  return Object.assign(base, { frames: p.frames });
}
function onProgress(p) {
  const j = S.job; if (!j || !p) return;
  const changed = j.waiting || p.phase !== j.p.phase || p.step !== j.p.step || (p.phase === 'decode' && String(tileOf(p.message)) !== String(tileOf(j.p.message)));
  j.waiting = false; j.p = p; j.at = Date.now(); j.frac = Math.max(j.frac, p.frac || 0);   // the bar never moves back
  if (p.part) j.part = p.part;   // v4: the whole video: which part
  if (changed) { S.gpuReset = false; renderWork(true); }
  renderProgress();
}
function cancelTap() {
  const j = S.job; if (S.phase !== 'working' || !j || j.sub === 'cancelling') return;
  clearTimeout(armT);
  if (!j.armed) { j.armed = true; renderCta(); armT = setTimeout(() => { if (S.job === j) { j.armed = false; renderCta(); } }, 3000); return; }
  j.sub = 'cancelling'; render();   // "Stopping…" until the queue reports the job cancelled (a clip's decode stops within a few seconds)
  if (j.id) Q.cancel(j.id); else j.cancelWanted = true;
}
function jobDone(r, params, input) {
  const k = params.media === 'video' ? 'video' : 'image', srcs = S.job && S.job.srcs;
  if (S.job && S.job.input) input = S.job.input;   // a resumed picture clip got its pictures back from the store
  if (k === 'video' && !(r && r.blob)) return jobFailed(Object.assign(new Error('the clip came back empty'), { code: 'EMPTY_CLIP' }), params, input);
  if (params.long && Array.isArray(r.partTimes)) { for (const t of r.partTimes) if (!t.resumedFromStep && t.seconds > 0) learn({ media: 'video', kind: 'v2v', width: params.width, height: params.height, frames: t.frames }, t.seconds); }   // v4: each part teaches its own time
  else if (!r.resumedFromStep) learn(params, r.seconds);
  if (params.sty && k === 'image') return styFrameDone(r, params);   // v4: a restyle's first frame is checked on Create, not saved
  // keep only what the UI needs; the engine result also carries GPU details
  const res = { id: `${Date.now().toString(36)}-${r.seed}`, media: k, blob: r.blob, url: r.url || URL.createObjectURL(r.blob), width: r.width, height: r.height,
    seed: r.seed, prompt: params.prompt, seconds: r.seconds, kind: params.kind, createdAt: Date.now(), params, input };
  if (r.madeOn) res.madeOn = r.madeOn;   // Connection (off in public builds)
  if (k === 'video') Object.assign(res, { frames: r.frames || params.frames, fps: r.fps || 16, vmode: params.kind || 't2v', sources: isPic(params.kind) || params.kind === 'v2v' ? srcs || [] : null });
  if (k === 'video' && params.kind === 'v2v') { Object.assign(res, { look: params.look || null, follow: params.follow || null, followBy: params.followBy || null, description: params.description || null, parts: params.long ? params.parts.length : null }); styClipDone(); soundNote(params, r); }   // v4: a restyle, beside its source (+ the whole video's parts, its sound)
  else Object.assign(res, { steps: r.steps, reference: params.kind === 'i2i' ? params.reference : null });
  if (params.quality === '9b') res.model = MODELS.k9b.id;   // v026.6: the Library says which model made it
  if (params.hq && k === 'video') { res.hq = params.hq.mode; S.hq = null; saveHq(); }   // a High / Highest clip: its frames were 9B
  if (k === 'video') { ls.set('pf.app.lastVideo', null); refreshCk(); if (isPic(params.kind)) store.clearVideoInputs().catch(() => {}); } else { ls.set('pf.app.lastJob', null); store.clearInput().catch(() => {}); }
  if (pop) pop.finish();   // the last frame (most kernels popped); the stage holds it briefly under the reveal
  S.popped = Date.now(); clearTimeout(poppedT); poppedT = setTimeout(renderPill, POPPED_MS + 50);
  S.job = null; set({ phase: 'result', result: res }); syncWake(); toStage();
  exportOf(res);   // v026.4
  saveToLibrary(res);
  if (params.hq && k === 'image') hqFrameDone(params, res);   // v026.6
  return res;
}
/** v4: a restyle of a clip with sound that came back silent (no sound encoder on this phone): say so once */
function soundNote(params, r) { if (params && params.sound && r && r.sound === 'failed') { diag('restyle: no sound added', { why: r.soundWhy || null }); toast('The new clip has no sound: it couldn’t be added on this phone', { ms: 5000 }); } }
function jobFailed(e, params, input) {
  const k = params.media === 'video' ? 'video' : 'image', clip = k === 'video', stopping = !!(S.job && S.job.sub === 'cancelling'), pic = isPic(params.kind);
  const srcs = S.job && S.job.srcs; if (S.job && S.job.input) input = S.job.input;
  S.job = null; if (clip) refreshCk();
  if (params.sty) styJobEnded(params);   // v4: a restyle's first frame or clip: back to where it was (the clip stays picked)
  if (isAbort(e) || stopping) { ls.set(clip ? 'pf.app.lastVideo' : 'pf.app.lastJob', null); set({ phase: 'ready' }); return syncWake(); }   // cancel is silent; the prompt stays
  const retry = ['Try again', () => startJob(params, input, srcs)];
  const X = (title, note = '', actions = [], extra = {}) => { set({ phase: 'error', error: Object.assign({ title, note, actions, detail: msg(e) }, extra) }); syncWake(); toStage(); };
  switch (e && e.code) {
    case 'NO_CONSENT': openLesson(); return X('Agree to the rules first.', 'Read the short lesson about copyright, trademarks and likeness, then agree.', [['Start the lesson', () => openLesson()]]);
    case 'NOT_DOWNLOADED':
      if (pic && /picture reader/i.test(msg(e))) return X("The picture reader isn't on this phone yet.", `It's ${fmtSize(S.dl.reader.total)}, one time.`, [['Get it, then make the clip', () => { set({ phase: 'ready', error: null }); readerThenMake(); }]]);
      return X(`The ${MODELS[k].noun} model isn't on this phone yet.`, '', [['Set up', () => recheckModel(k)]]);
    case 'EMPTY_PROMPT': return X(clip ? 'Describe the clip first.' : 'Describe the picture first.');
    case 'BAD_SIZE': return X(clip ? "That size or length isn't available — pick another." : "That size isn't available — pick a shape.");
    case 'BAD_IMAGE': return X(pic ? "That picture couldn't be opened. Try another, or a screenshot of it." : "That photo couldn't be opened. Try another, or a screenshot of it.");
    case 'BAD_VIDEO': return X("That clip couldn't be read.", 'Pick it again, or another clip.');   // v4: Restyle a clip
    case 'NOT_ATTESTED': if (params.sty) { X('Tick the box about your video first.', 'A video from your phone needs its own tick.'); return flag($('sattest-box')); }   // v4
    { const i = S.vslots.findIndex((x) => x && x.from === 'phone' && !x.attest); X('Tick the box about your photo first.', 'Each photo from your phone needs its own tick.'); return flag($(`vattest-box-${Math.max(0, i)}`)); }
    case 'NO_CHECKPOINT': return X('That unfinished clip is gone.', 'Make it again from the pictures.');
    case 'GPU_LOST': return X("The phone reset its graphics chip. Nothing's broken.", clip ? 'Try again picks up after the last finished step.' : '', [retry]);   // same seed: resumes from the checkpoint
    case 'KILLED':   // v019: the queue gave up after the page stopped three times during this job (memory or heat)
    case 'OUT_OF_MEMORY': {
      const acts = [];
      if (clip) {
        if (decodeMB() > 450) acts.push(['Use 450 MB and retry', () => { setDecode(450); startJob(params, input, srcs); }]);
        const sm = VSMALLER[vsizeFor(params.width, params.height)], z = sm && vsize(sm);
        if (params.resume) { /* a resumed clip keeps its size: only the decode memory can change */ }
        else if (z) acts.push([`Try ${z.w}×${z.h}`, () => { S.vform.size = sm; saveDraft(); startJob(Object.assign({}, params, { width: z.w, height: z.h }), input, srcs); }]);
        else if (params.frames > FRAMES[1]) { const n = Math.max(1, lenOf(params.frames) - 2); acts.push([`Try ${lenLabel(n, params.kind)} s`, () => { S.vform.len = n; saveDraft(); startJob(Object.assign({}, params, { frames: FRAMES[n] }), input, srcs); }]); }
      } else {
        const sm = SMALLER[sizeFor(params.width, params.height)], z = sm && size(sm);
        if (z) acts.push([`Try ${z.w}×${z.h}`, () => { S.form.size = sm; saveDraft(); startJob(Object.assign({}, params, { width: z.w, height: z.h }), input); }]);
      }
      return X('Too big for the phone right now.', e.code === 'KILLED' ? 'The page stopped three times during this one (memory or heat). Closing other apps helps.' : 'Closing other apps helps.', acts);
    }
    case 'BUSY': return X('Already making one.', 'It will be ready to go again in a moment.', [], { busy: true });
    case 'STORAGE_FULL': return X('This phone is out of storage.', 'Save some pictures and clips to Photos, delete them here, then try again.', [retry]);
    case 'UNSUPPORTED':
      if (clip) return X("This phone can't make clips here.", "Safari couldn't start the video model or its video encoder.");
      return set({ phase: 'stop', stop: { title: "Can't run on this phone", text: "This phone or browser can't run p0pc0rn.", detail: msg(e), retry: 'reload' } });
    default: return X('Something went wrong.', '', [retry]);
  }
}
async function recheckModel(k) {
  try { S.st[k] = await E[k].status(); } catch (e) { return toast('Connect to Wi-Fi, then try again.'); }
  S.mode = k; set({ phase: 'ready', error: null }); toStage();   // a missing model shows its download card on Create
}
// ------------------------------------------------------------------------------------------------ v019: the queue + the assistant
const isStageKind = (kind) => (RENDER_KINDS.has(kind) && kind !== 'musicvideo' && !CAST_KINDS.has(kind)) || kind === 'resume' || kind === 'restylelong';   // jobs that put popcorn on the stage (v4: + the whole video in parts: its parts show as it)
/** v4: a part of a whole video restyled in parts (a 'restyle' job under a 'restylelong' coordinator) -> the coordinator, else null */
const longParent = (j) => { const p = j && j.kind === 'restyle' && j.parent && Q ? Q.get(j.parent) : null; return p && p.kind === 'restylelong' ? p : null; };
/** v4: a whole-video restyle that stopped and is kept so it can carry on from its part (the newest) */
const longKept = () => (Q ? Q.list().filter((j) => j.kind === 'restylelong' && j.status === 'failed' && isCreateJob(j)).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0] || null : null);
const mediaOfKind = (kind) => (kind === 'song' || kind === 'say' ? 'audio' : kind === 'picture' || kind === 'edit' ? 'image' : 'video');
const isCreateJob = (j) => !!j && typeof j.tag === 'string' && j.tag.startsWith('create:');
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const fetchJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
const installed = (id) => { const k = KEY_OF[id]; return !!k && done(k); };
const SONG_INFO = new Map();   // seed -> what the music engine said about the song (planner on, codec, timings): the Library meta + the report
let HOSTLOG = [];              // the last model loads / unloads
// ---- v024 diagnostics (Josh's phone crash, Oct 13): the last steps (200 since v026.2) survive a page kill (localStorage); Settings > About > Diagnostics
const DIAG_KEY = 'p0pc0rn:diag', GPUM = { live: 0, peak: 0, on: false, n: 0, freed: 0, ring: [] };
/** WebGPU buffer bytes alive (all engines), counted at createBuffer / destroy; the peak since the last diagnostics step */
function installGpuMeter() {
  try {
    const D = globalThis.GPUDevice && GPUDevice.prototype; if (!D || D.__pfMeter) return; D.__pfMeter = true; GPUM.on = true;
    // v024.2: the buffer COUNT, and the bytes DESTROYED (WebKit gives them back late: what was freed in the last 60 s is the pressure)
    const gone = (rec) => { if (!rec.alive) return; rec.alive = false; GPUM.live -= rec.size; GPUM.n--; GPUM.freed += rec.size; GPUM.ring.push([Date.now(), rec.size]); if (GPUM.ring.length > 4096) GPUM.ring.splice(0, 1024); };
    const cb = D.createBuffer;
    D.createBuffer = function (desc) {
      const b = cb.call(this, desc), size = Number(desc && desc.size) || 0, rec = { size, alive: true }; GPUM.live += size; GPUM.n++; if (GPUM.live > GPUM.peak) GPUM.peak = GPUM.live;
      (this.__pfRecs || (this.__pfRecs = new Set())).add(rec); const dev = this;
      const d = b.destroy; b.destroy = function () { gone(rec); dev.__pfRecs.delete(rec); return d.call(this); };
      return b;
    };
    const dd = D.destroy;   // a device destroyed whole (the pictures engine's idle device): all its buffers count as destroyed
    D.destroy = function () { for (const rec of this.__pfRecs || []) gone(rec); if (this.__pfRecs) this.__pfRecs.clear(); return dd.call(this); };
  } catch (e) { /* the estimate is optional */ }
}
installGpuMeter();
/** v024.2: GPU bytes destroyed in the last `ms` (all engines) */
function freedIn(ms = 60000) { const t0 = Date.now() - ms; let s = 0; for (let i = GPUM.ring.length - 1; i >= 0 && GPUM.ring[i][0] >= t0; i--) s += GPUM.ring[i][1]; return s; }
function memNow() {
  const pm = performance && performance.memory, r = { gpuMB: GPUM.on ? Math.round(GPUM.live / 1e6) : null, gpuPeakMB: GPUM.on ? Math.round(GPUM.peak / 1e6) : null, jsMB: pm ? Math.round(pm.usedJSHeapSize / 1e6) : null,
    gpuBufs: GPUM.on ? GPUM.n : null, freed60MB: GPUM.on ? Math.round(freedIn() / 1e6) : null, freedMB: GPUM.on ? Math.round(GPUM.freed / 1e6) : null };
  GPUM.peak = GPUM.live; return r;
}
/** one step: {t, step, ...data, mem}; at most 50, oldest dropped; never throws */
function diag(step, data = {}) {
  try {
    const d = new Date(), t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const all = (ls.get(DIAG_KEY, []) || []).concat(Object.assign({ t, step }, data, { mem: memNow() })).slice(-200);   // v026.2: 200 steps (50 held only a song's)
    ls.set(DIAG_KEY, all);
  } catch (e) { /* storage full: diagnostics are best effort */ }
}
/** v024.1: the step the page is in, written at every new sub-step and cleared when the job stops; found on open = the page died there */
const INFLIGHT = 'p0pc0rn:inflight', SAFE = /[?&]safe=1(?:&|$)/.test(location.search);
function engineMem(j) { try { const e = E[KEY_OF[Q.modelOf(j)]], g = e && e.gpu; return g ? { engineMB: Math.round(g.alive / 1e6), enginePeakMB: Math.round(g.peak / 1e6), engineBufs: g.bufs ? g.bufs.size : null, bindGroups: g.runner ? g.runner.bgNew : null } : {}; } catch (x) { return {}; } }
// ---- v024.2: a PLANNED FRESH PAGE between heavy stages (WebKit). Josh's iPhone died twice ~50 s after the 1.6 GB assistant unloaded
// (at 'Mixing', with everything the engine holds flat): destroyed GPU memory is given back late there, and a navigation frees it all.
// Before a model loads, and before the song's denoise / decode, a page that has destroyed >= 256 MB reloads; the jobs that were running
// go back to the queue WITHOUT a kill and resume from their checkpoints. Once per job and stage (no loops). A crash still shows the card.
const PLANNED = 'p0pc0rn:planned', FRESH_DONE = 'p0pc0rn:freshDone', FRESH_MIN = 256e6;
let PLANNED_IN = null;   // the marker this page was opened with (consumed by startQueue)
const COVER_AT_START = document.documentElement.classList.contains('pf-fresh');   // v026.2: the head script's cover was up when the app started
let PLANNED_DIED = null;   // v026.7: a marker the old page never stamped as it left: it died before (or instead of) reloading = a crash
try { PLANNED_IN = JSON.parse(localStorage.getItem(PLANNED) || 'null'); if (PLANNED_IN && Date.now() - PLANNED_IN.t > 10 * 60e3) PLANNED_IN = null; localStorage.removeItem(PLANNED); } catch (x) { PLANNED_IN = null; }
if (PLANNED_IN && !PLANNED_IN.left) { PLANNED_DIED = PLANNED_IN; PLANNED_IN = null; }
function freshMode() { let v = null; try { v = localStorage.getItem('p0pc0rn:freshPages'); } catch (x) { v = null; } return v === 'always' ? 'always' : v === '0' ? 'off' : v === '1' || WEBKIT || ANDROID ? 'on' : 'off'; }   // v026.9: Android too
async function freshPage(stage, jobId) {
  const mode = freshMode(); if (mode === 'off' || SAFE) return false;
  const key = `${jobId || '-'}:${stage}`, now = Date.now();
  let done = []; try { done = (JSON.parse(localStorage.getItem(FRESH_DONE) || '[]') || []).filter((d) => now - d.t < 30 * 60e3); } catch (x) { done = []; }
  if (done.some((d) => d.key === key)) return false;   // this job already had its fresh page for this stage
  const freed = GPUM.freed, f60 = freedIn();
  // nothing big was destroyed in this page: 256 MB before a model loads; 64 MB at the song's own stages (the denoise page frees ~180 MB,
  // and the decode must start clean: Josh's iPhone died in it)
  // v026.2: a picture / clip render job always starts in a page where no other render ran (each still / shot of a music video)
  const min = /^(song|say|k9b) |^load brain4/.test(stage) ? 64e6 : /^lipsync /.test(stage) ? 384e6 : /^render /.test(stage) ? (RENDERED ? 0 : 64e6) : FRESH_MIN;   // Cast: say = a song's rule; lip-sync: light
  if (mode !== 'always' && freed < min) return false;
  const ids = Q ? Q.list().filter((j) => j.status === 'running').map((j) => j.id) : [];
  const ui = { tab: S.tab, board: MB.id || null, queue: !!($('queue') && !$('queue').hidden), app: openAppOf(APPS) };   // v026.1: the same screen after the reload (3.9: + the open app)
  try { localStorage.setItem(FRESH_DONE, JSON.stringify(done.concat({ key, t: now }).slice(-40))); localStorage.setItem(PLANNED, JSON.stringify({ t: now, ids, stage, key, ui })); } catch (x) { return false; }
  diag('fresh page', { stage, freedMB: Math.round(freed / 1e6), freed60MB: Math.round(f60 / 1e6), jobs: ids.length });
  // v026.1: reload only once the marker reads back; if the page is still here 8 s later, carry on in it (and say so)
  let back = null; try { back = JSON.parse(localStorage.getItem(PLANNED) || 'null'); } catch (x) { back = null; }
  if (!back || back.key !== key) { diag('fresh page skipped: the marker did not stick', { stage }); return false; }
  // v026.7: the reload counts as planned only if this page really leaves (pagehide): a page killed in between (WebKit frees the last
  // model's memory late) opens as a crash, with the safe-open card, not as a planned page that resumes the job and dies again
  addEventListener('pagehide', () => { try { const m = JSON.parse(localStorage.getItem(PLANNED) || 'null'); if (m && m.key === key && !m.left) { m.left = Date.now(); localStorage.setItem(PLANNED, JSON.stringify(m)); } } catch (x) { /* */ } });
  document.documentElement.classList.add('pf-fresh');   // v026.1: the cover (index.html), the same one the reopened page paints first
  document.documentElement.setAttribute('data-fresh', String(stage || ''));   // 3.8: 'load <model>' = "Switching models..." (app.css)
  let rms = 120; try { rms = Number(localStorage.getItem('p0pc0rn:test:reloadMs')) || 120; } catch (x) { /* */ }   // v026.7: tests widen the window a page can die in
  setTimeout(() => location.reload(), rms);
  // v026.2: a reload can take long to commit on the iPhone (right after a 1.6 GB device is torn down); v026.1 gave up after 8 s and
  // REMOVED the marker, so when the reload did land the new page had no cover and no marker (Josh: "went to start screen" as the
  // song switched to planning). Now: ask again at 15 s, give up only at 60 s, and KEEP the marker (a late reload is still planned).
  await new Promise((r) => setTimeout(r, 15000));
  diag('fresh page: still here after 15 s, reloading again', { stage }); try { location.reload(); } catch (x) { /* */ }
  await new Promise((r) => setTimeout(r, 45000));
  document.documentElement.classList.remove('pf-fresh');
  diag('fresh page: the reload did not happen in 60 s, carrying on in this page', { stage });
  return false;
}
const activeJobId = () => (Q && Q.active && Q.active.job ? Q.active.job.id : null);
let LAST_UNLOADED = null;   // the model the engine host unloaded last in this page
let UNLOADED_AT = 0;   // 3.8: when it did
/** 3.8 (iOS 27): WebKit gives a destroyed model's GPU memory back late, and for a few seconds after a model leaves, opening an app or
 *  loading Juli again can end the page (Josh's iPhone: the Quick benchmark's Apps step 1-2 s after Juli unloaded). On WebKit this waits
 *  until SETTLE_MS have passed since the last unload; elsewhere it returns at once. -> the ms it waited */
const SETTLE_MS = 8000;
async function settle() {
  const left = WEBKIT ? UNLOADED_AT + SETTLE_MS - Date.now() : 0;
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  return Math.max(0, left);
}
let RENDERED = false;   // v026.2: a picture / clip render already ran in this page
/** v026.2: before a picture / clip render: a fresh page on WebKit if another render already ran in this page (see freshPage) */
async function beforeRender(kind) { await freshPage('render ' + kind, activeJobId()); RENDERED = true; }
function stepOf(j, p) {
  if (!p) return 'starting';
  const cap = j.kind === 'song' ? (SONG_CAPTION[p.phase] || p.phase) : p.phase;
  return `${cap || 'working'}${p.message ? ` · ${String(p.message).slice(0, 60)}` : ''}`;
}
function crumb(j, step) {
  try {
    const prev = ls.get(INFLIGHT, null);
    if (prev && prev.id === j.id && prev.step === step) return;
    const m = engineMem(j);
    ls.set(INFLIGHT, { id: j.id, kind: j.kind, step, t: Date.now(), ...m });
    diag('step', { kind: j.kind, step, ...m });
  } catch (x) { /* best effort */ }
}
// 3.9 phone fit (Josh's iPhone 16 Pro Max, iOS 27.0.1, Oct-27): in the Home Screen app iOS sizes the page as the screen minus the
// status bar but draws it from the top, so the bottom 62 px are a strip the page cannot paint (an open WebKit bug for black-translucent
// installs: 313800, 317153, 301994). iOS is reported to grow the page back once the document is taller than it, so only there (a Home
// Screen app on an iPhone whose page is 20-90 px short): make the document as tall as the screen and keep it if the page grows; else lift
// the scroll lock too (no bounce) and try again; else put everything back. Settings > About > Diagnostics shows what happened (vpLine).
const VP = { seen: 0, step: '', log: [], runs: 0, last: 0 };
const vpBox = (css) => { const p = document.createElement('div'); p.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;' + css; document.body.appendChild(p); const r = p.getBoundingClientRect(), cs = getComputedStyle(p); p.remove(); return { h: Math.round(r.height), pt: parseFloat(cs.paddingTop) || 0, pb: parseFloat(cs.paddingBottom) || 0 }; };
function vpMeasure() {
  const standalone = !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
  const portrait = innerHeight >= innerWidth, sw = screen.width || 0, sh = screen.height || 0;
  const screenW = portrait ? Math.min(sw, sh) : Math.max(sw, sh), screenH = portrait ? Math.max(sw, sh) : Math.min(sw, sh);
  const b = vpBox('bottom:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)');
  return { standalone, screenW, screenH, pageH: b.h, inner: innerHeight, visual: window.visualViewport ? Math.round(window.visualViewport.height) : null, top: b.pt, bottom: b.pb };
}
const vpLine = () => `screen ${VP.screen || '?'} · page ${VP.page || '?'} (inner ${VP.inner ?? '?'}, visual ${VP.visual ?? '?'}) · insets ${VP.top ?? '?'}/${VP.bottom ?? '?'}`
  + `${VP.end ? ` -> ${VP.end.top}/${VP.end.bottom}` : ''} · ${VP.standalone ? 'Home Screen app' : 'browser'} · short by ${VP.seen}`
  + `${VP.step ? ` · fill: ${VP.step}` : ''}${VP.log.length ? ` [${VP.log.join(' ')}]` : ''}${VP.end ? ` · lvh ${VP.end.lvh} dvh ${VP.end.dvh} svh ${VP.end.svh}` : ''}`;
async function fitViewport() {
  VP.runs += 1; VP.last = Date.now();
  const H = document.documentElement, B = document.body, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const finish = (step) => {
    VP.step = step;
    try { const e = vpBox('bottom:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)'); VP.end = { top: e.pt, bottom: e.pb, lvh: vpBox('height:100lvh').h, dvh: vpBox('height:100dvh').h, svh: vpBox('height:100svh').h }; } catch (e) { /* the numbers so far */ }
    H.dataset.vp = vpLine();
  };
  try {
    const m = vpMeasure(), grown = () => innerHeight >= m.screenH - 2;
    Object.assign(VP, { standalone: m.standalone, screen: `${m.screenW}x${m.screenH}`, page: `${innerWidth}x${m.pageH}`, inner: m.inner, visual: m.visual, top: m.top, bottom: m.bottom, seen: m.screenH - m.pageH });
    VP.log = [];
    if (!(m.standalone && /iPhone|iPad|iPod/.test(navigator.userAgent || '') && VP.seen >= 20 && VP.seen <= 90)) return finish('not needed');
    H.style.minHeight = m.screenH + 'px';   // (a) the document as tall as the screen
    for (const t of [300, 500, 700]) { await wait(t); VP.log.push(`a${t}:${innerHeight}`); if (grown()) return finish('filled (taller page)'); }
    H.style.overflow = 'visible'; B.style.overflow = 'visible'; H.style.overscrollBehavior = 'none'; B.style.overscrollBehavior = 'none';   // (b) + no scroll lock
    try { window.scrollTo(0, 1); window.scrollTo(0, 0); } catch (e) { /* */ }
    for (const t of [300, 500, 700]) {
      await wait(t); VP.log.push(`b${t}:${innerHeight}`);
      if (grown()) {   // the lock back on, if the page stays grown with it
        B.style.overflow = ''; H.style.overflow = ''; await wait(500); VP.log.push(`lock:${innerHeight}`);
        if (grown()) return finish('filled (scroll lock back on)');
        H.style.overflow = 'visible'; B.style.overflow = 'visible'; return finish('filled (scroll lock off)');
      }
    }
    H.style.minHeight = ''; H.style.overflow = ''; B.style.overflow = ''; H.style.overscrollBehavior = ''; B.style.overscrollBehavior = '';   // (c) as it was
    try { window.scrollTo(0, 0); } catch (e) { /* */ }
    finish('no change (put back)');
  } catch (e) { finish('error: ' + String((e && e.message) || e).slice(0, 80)); }
}
fitViewport();
addEventListener('resize', () => {   // the page came back short (e.g. after leaving the app's scope): once more, at most every 5 s
  try {
    const H = document.documentElement;
    if (innerHeight < innerWidth) { H.style.minHeight = ''; return; }   // sideways: no screen-tall document (it would scroll)
    const sh = Math.max(screen.width || 0, screen.height || 0);
    if (sh - innerHeight < 20 || Date.now() - VP.last < 5000 || VP.runs > 20) return;
    fitViewport();
  } catch (e) { /* */ }
});

function diagText() {
  const rows = ls.get(DIAG_KEY, []) || [];
  let sched = []; try { sched = APPS && APPS.schedLines ? APPS.schedLines(40) : []; } catch (e) { sched = []; }   // v4: the apps scheduler's last steps
  const head = `p0pc0rn ${APP_VERSION} · ${navigator.userAgent}${navigator.deviceMemory ? ` · deviceMemory ${navigator.deviceMemory} GB` : ''}${S.caps && S.caps.gpu ? ` · graphics ${S.caps.gpu}` : ''}`;   // v4: + the graphics chip (vendor, architecture, description)
  return [head, vpLine()].concat(sched, rows.map((r) => { const { t, step, mem, ...rest } = r; const m = mem || {}; return `${t} ${step}${Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''} | gpu ${m.gpuMB ?? '?'} MB (peak ${m.gpuPeakMB ?? '?'})${m.jsMB != null ? ` js ${m.jsMB} MB` : ''}`; })).join('\n');
}
addEventListener('error', (e) => diag('page error', { message: String((e && e.message) || e).slice(0, 300) }));
addEventListener('p0pc0rn:manifest', (e) => { const d = (e && e.detail) || {}; diag('pack list refused', { pack: d.pack || null, kept: !!d.kept }); });   // v027.3 (engine/core/pin.js)
addEventListener('unhandledrejection', (e) => diag('page error', { message: String((e && e.reason && (e.reason.stack || e.reason.message)) || (e && e.reason) || e).slice(0, 300) }));

// 3.8 (v040, Josh 10-24): who thinks for Juli. Chat always runs on Juli's own model (Gemma 4 E2B: fast replies). A writing task or a
// job that makes something (a picture, clip, song or app): Juli looks things up and checks pictures with her own model, and the Bigger
// brain (NVIDIA Nemotron 3.5 Bolt E4B, text only) plans and writes, when it is on the phone, can run here (E4B_HERE), did not run out
// of memory last time (E4B_BLOCKED) and is on in Settings › Juli (pf.app.brain4Use: on by default once downloaded). assistant/agent.js
// BRAIN runs such a turn in phases, one model in memory at a time; an app's own questions (Trip Watch) stay on Juli.
const BRAIN4_CTX = 2048;   // the Bigger brain's context on the phone (engine/llm/llm_engine.js LLM_MODELS['bolt-e4b'].ctxCap)
const brain4On = () => ls.get('pf.app.brain4Use', true) !== false;
const brain4Here = () => !!MODELS.brain4 && done('brain4') && typeof E4B_HERE === 'function' && !!E4B_HERE();
const brain4Blocked = () => typeof E4B_BLOCKED === 'function' && !!E4B_BLOCKED();
const brain4Usable = () => brain4Here() && !brain4Blocked() && brain4On();
const brainFor = (role) => (role !== 'chat' && role !== 'vision' && brain4Usable() ? MODELS.brain4.id : MODELS.brain.id);
async function initAssistant() {
  RUN = createRunners({ isInstalled: installed, foleyDefault: false, likeSources: mvRecords, realPeople: mvRealPeople });   // v023: + the music video's runners (mvflf, mvplan, mvreq)
  RUN.resume = { model: () => MODELS.video.id, async run(ctx) {   // Create's "Unfinished clip" (a picture clip): its checkpoint holds the pictures
    const r = await ctx.engine.resumeVideo({ mode: 'picture', onProgress: ctx.progress, signal: ctx.signal });
    try { if (r && r.url) URL.revokeObjectURL(r.url); } catch (e) { /* */ }
    if (!r || !r.blob) throw Object.assign(new Error('the clip came back empty'), { code: 'EMPTY_CLIP' });
    // v026.3: an unfinished first/last-frame clip is trimmed like a fresh one (its frames 0..71; the end picture is never shown)
    if (((ctx.params && ctx.params.ui) || {}).kind === 'flf') { const k = flfKeep(r.frames), t = await keepHead(r.blob, k, r.fps || 16); return { video: t.blob, frames: k, rendered: r.frames, fileFrames: t.frames, fps: r.fps, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0 }; }
    return { video: r.blob, frames: r.frames, fps: r.fps, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, resumedFromStep: r.resumedFromStep || 0 };
  } };
  RUN.restyle = restyleRunner({ model: MODELS.video.id });   // v4 Phase 4: Create › Video › Restyle a clip (ui/style_run.js; the looks LoRA comes from videoAdapter)
  RUN.restylelong = restyleLongRunner();   // v4: the whole video in parts (no model: it queues a 'restyle' job a part, then joins them and adds the sound)
  // the Gemma tick: every video job waits for the licence sheet while the LTX licence or the tick is missing (ltxGate)
  for (const k of ['clip', 'animate', 'between', 'resume', 'restyle']) { const r = RUN[k]; if (r && r.run) RUN[k] = Object.assign({}, r, { run: async (ctx) => { if (!ltxOk()) await ltxGate(ctx.signal); return r.run(ctx); } }); }
  // Connection (off in public builds)
  if (CONNECT_ON) for (const k of ['picture', 'edit', 'clip', 'animate', 'between', 'restyle']) { const r = RUN[k]; if (r && r.run) RUN[k] = Object.assign({}, r, { model: (j) => (j && j.params && j.params.remote ? null : r.model(j)), run: async (ctx) => (ctx.params && ctx.params.remote ? (await connectP()).run(ctx) : r.run(ctx)) }); }
  // p0pc0rn Cast: 'say' (a Cast member's voice), 'lipsync' + 'talk' (Make them talk, EXPERIMENTAL)
  RUN.say = sayRunner({ cast: CAST }); RUN.lipsync = lipsyncRunner();
  RUN.talk = talkRunner({ cast: CAST, say: (sid, m) => (AG ? AG.say(sid, m) : null), sizes: { tall: CLIP_SIZE.tall, wide: CLIP_SIZE.wide } });
  // 3.8: the Apps tab's jobs (Juli makes an app; an app asks Juli a question) and Settings › Benchmark: all through this one queue
  APPS = createApps(appsApi());
  RUN.makeapp = APPS.runner(() => brainFor('app'), { ctxOf: (id) => (MODELS.brain4 && id === MODELS.brain4.id ? BRAIN4_CTX : 0), small: MODELS.brain.id });   // 3.8 (v040): the Bigger brain makes apps when it can
  RUN.appask = APPS.askRunner(MODELS.brain.id);   // an app's own questions stay on Juli
  RUN.appref = APPS.refRunner(MODELS.brain4 ? MODELS.brain4.id : null, { research: () => (AS.research ? RS : null) });   // v4: Token Watch's name references (the Bigger brain only, never Juli's own model)
  RUN.appedit = APPS.editRunner({ big: () => brainFor('app'), small: MODELS.brain.id, ctxOf: (id) => (MODELS.brain4 && id === MODELS.brain4.id ? BRAIN4_CTX : 0) });   // H39: a change by chat: the Bigger brain plans and reviews when it can, Juli does the work
  // 3.9 polish (Josh: "the user can choose the opponent after they beat Juli e2B 10 times in a row"): a game's mover is Juli's own
  // model, always; the Bigger brain only when the game asks for it (big: the opponent the person earned and chose) and it is
  // downloaded and on, and never one model for the other. Both answer with the number of their choice (the Bigger brain read the
  // desk's 36 positions all right that way, 89% as a choose_move tool call). Either runs next to the open game; the game hold
  // keeps it for the next move
  RUN.appchoose = freshMoves(APPS.chooseRunner((j) => (j && j.params && j.params.big && brain4Usable() ? MODELS.brain4.id : MODELS.brain.id), {
    isBig: (id) => !!MODELS.brain4 && id === MODELS.brain4.id, big: () => brain4Usable() }), () => Q);   // a move an earlier page asked needs none (script 16)
  RUN.bench = benchRunner({ MODELS, RUN });
  RUN.appiconplan = iconPlanRunner(MODELS.brain.id); RUN.appicon = iconRenderRunner(MODELS.image.id, RUN.picture);   // 3.9: Juli's idea for an app icon (her own model), then ONE FLUX.2 [klein] 4B shot
  HDR = createHdr(hdrApi()); RUN.hdr = Object.assign({}, HDR.runner, { run: async (ctx) => { if (VOICEIN) await VOICEIN.release('hdr'); return HDR.runner.run(ctx); } });
  RUN.nowcast = { model: () => MODELS.nowcast.id, needsConsent: false, fallback: (j, m) => (m === MODELS.nowcast.id && ncInt8() ? 'dgmr-nowcast-int8' : null),   // v4: the Nowcast's job (nowcast/nowcast_app.js)
    run: async (ctx) => { if (VOICEIN) await VOICEIN.release('nowcast'); return (await ncGlue()).runner.run(ctx); } };   // v4: Make HDR (no model: between renders, in this queue); voice input lets go first
  // v019 has no sound effects yet: the assistant is never offered add_sound, and the foley cookbook is left out of its notes
  const fi = MAIN_TOOLS.indexOf('add_sound'); if (fi >= 0) MAIN_TOOLS.splice(fi, 1);
  // v023: no music video from chat (Josh: the landed song's bubble offers Animate); the v019 runners stay for old queue jobs
  const mi = MAIN_TOOLS.indexOf('make_music_video'); if (mi >= 0) MAIN_TOOLS.splice(mi, 1);
  Q = await createQueue({ runners: RUN, host: new EngineHost({ create: hostCreate, onEvent: (ev) => { HOSTLOG = HOSTLOG.concat(Object.assign({ t: Date.now() }, ev)).slice(-20); if (ev.type === 'unload') { LAST_UNLOADED = ev.model; UNLOADED_AT = Date.now(); } diag(`model ${ev.type}`, { model: ev.model }); } }), consent: consented, autoStart: false,
    planned: (j) => !!(PLANNED_IN && (PLANNED_IN.ids || []).includes(j.id)),   // v024.2: a planned fresh page is not a kill
    holdMs: (id) => (id === MODELS.brain.id && VOICEIN && VOICEIN.active() ? 45000 : id === MODELS.brain.id || (MODELS.brain4 && id === MODELS.brain4.id) ? 5000
      : KEY_OF[id] === 'nowcast' && NC && NC.shown ? 120000 : 0) });   // v4: the Nowcast's model stays while its screen is open (2 min idle; it goes when the screen closes)   // v4: 45 s in a voice conversation (the next thing you say comes soon)   // 3.8: Juli stays loaded 5 s for a follow-up job (iOS 27, see queue.js runJob)
  wireQueue(); wireMv(); HDR.wire();
  { const hold0 = Q.holdMs; Q.holdMs = (id) => Math.max(APPS && APPS.holdFor ? APPS.holdFor(id) : 0, hold0 ? hold0(id) : 0); }   // 3.9: the game hold (makeapp/host.js holdFor)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && Q) Q.endHold(); });   // 3.8: no model held in a hidden page
  addEventListener('pagehide', () => { if (Q) Q.endHold(); });
  Q.on('change', (j) => { if (j.kind === 'say' && CASTUI) CASTUI.onJob(j); if (j.kind === 'lipsync' && j.status === 'done') saveAssistantResult(j.id).catch(() => {}); });
  Q.on('progress', (j) => { if (j.kind === 'say' && CASTUI) CASTUI.onJob(j); });
  try {
    const [index, terms] = await Promise.all([fetchJSON('assistant/cookbooks/index.json'), fetchJSON('assistant/safety_terms.json')]);
    index.sections = index.sections.filter((x) => x.file !== 'foley.md');
    const files = {};
    for (const f of new Set(index.sections.map((x) => x.file))) { const r = await fetch('assistant/cookbooks/' + f); if (!r.ok) throw new Error(f + ' ' + r.status); files[f] = await r.text(); }
    setSafetyTerms(terms);
    // the Api-User-Agent comes from assistant/config.json (a public URL, never an email). v021: research keeps every hit in the phone's
    // own KB (IndexedDB 'p0pc0rn-kb') and checks it first. STARTER = the read-only starter KB pack's source when one is installed
    // (a separate download; {name, readOnly, search(query) -> entries}: see assistant/kb.js), checked after the KB, before the network.
    RS = await createResearch({});
    plugStarter();
    AG = await createAgent({ queue: Q, research: AS.research ? RS : null, cookbooks: loadCookbooks({ index, files }), hooks: { consent: consented, isInstalled: installed, review: AS.review, hfLogin: false,
      castNames: () => CAST.names(), castJob: (job, tool, args, text) => castJob(job, tool, args, text),   // p0pc0rn Cast: the likeness gate + photo references
      castDisplay: async () => (await CAST.list()).map((p) => p.name),   // v4: Juli is told who is in the Cast (agent.castNote)
      brainModel: () => (brain4Usable() ? MODELS.brain4.id : null),
      homeZip: () => HOME_ZIP.get(), setHomeZip: (z) => HOME_ZIP.set(z), position: () => positionIfAllowed() } });   // v4 (weather): the home ZIP, and the phone's location only if already allowed   // 3.8 (v040): the Bigger brain plans and writes (agent.js BRAIN)
    RUN.attach(AG);
    AG.hooks.skills = (kind) => (APPS && APPS.state.skills ? APPS.state.skills.skillsFor(kind) : []);
    AG.hooks.nowcastTurn = async (sid, m, o) => (E.nowcast && done('nowcast') ? (await ncGlue()).juliTurn(sid, m, o) : null);   // v4: "will it rain in the next hour" -> the Nowcast (Experimental), when its model is here   // H39: the skills that are on (Apps › Skills): a 'for: chat' one that fits goes into Juli's plan
    const chat = RUN.chat;   // a turn woken only to say "here's your song" (or that a job stopped) needs no model: no reload of the assistant
    // p0pc0rn Cast: "make <name> say <line>" is answered in code (no assistant model): the 'say' chat job queues the voice and posts the audio
    const SAYTURN = sayTurn({ cast: CAST, agent: AG, queue: Q, installed }), sayChat = (j) => !!j && j.kind === 'chat' && !!j.params && j.params.purpose === 'say';
    RUN.chat = Object.assign({}, chat, { model: (j) => (replyOnly(j) || sayChat(j) ? null : chat.model(j)), run: (ctx) => (sayChat(ctx.job) ? SAYTURN(ctx) : chat.run(ctx)) });
    wrapAsk(AG, Q);
    AG.on('message', onAgentMessage);
    AG.on('activity', (sid, jobId, text) => { if (CH) CH.activity(sid, text); });   // v021: "Looking up …" in the chat while it runs
    AG.on('research', (sid, jobId, rows) => { if (CH && CH.research) CH.research(sid, jobId, rows); });   // v026.2: the research list, live
    AG.on('diag', (step, data) => diag(step, data));   // v026.2: every research step in Diagnostics
  } catch (e) {
    AG = null; S.agentError = msg(e);
    RUN.chat = { model: () => null, needsConsent: false, run: async () => { throw Object.assign(new Error("Juli couldn't start: " + S.agentError), { code: 'NO_ASSISTANT' }); } };
  }
  CH = createChat(chatApi());
  VOICEIN = initVoiceIn({ engine: () => E.stt, ready: () => done('stt'), here: voiceHere, consented, openLesson, toast, diag, send: () => CH && CH.send(), input: () => $('as-in'),
    canSend: () => !!AG && consented(), busyWhy: voiceBusy, beforeLoad: voiceRoom, listening: abortWarm, onChange: setVoiceLayout, paused: () => VOICE_PAUSED,   // v4: + listening: the mic opening stops a voice warm-up
    undoSend: () => { const sid = CH && CH.sid, j = Q && sid ? Q.list({ includeTerminal: false }).filter((x) => x.kind === 'chat' && x.session === sid).pop() : null; if (j) Q.cancel(j.id).catch(() => {}); return !!j; } });   // v4: voice input (ui/voicein.js)
  setVoiceLayout();
  APPS.init().catch((e) => diag('apps: init failed', { message: String((e && e.message) || e).slice(0, 200) }));
  MEM = startMemory(memApi());   // 3.9: About me + Routines (Settings › Juli) and their heartbeat
  try { BENCH = createBench(benchApi()); } catch (e) { diag('bench: init failed', { message: String((e && e.message) || e).slice(0, 200) }); }
  try { ICON = createAppIcon(iconApi()); globalThis.P0APPICON = ICON; ICON.init(); } catch (e) { diag('app icon: init failed', { message: String((e && e.message) || e).slice(0, 200) }); }   // 3.9
  try { MUSIC = createMusic(musicApi()); } catch (e) { diag('music: init failed', { message: String((e && e.message) || e).slice(0, 200) }); }   // 3.9
  try { CLIPT = createClipThumbs({ Q: () => Q, lib: () => S.lib, visible: () => S.tab === 'library', viewerOpen: () => !$('viewer').hidden, songCover, diag }); } catch (e) { diag('clip posters: init failed', { message: String((e && e.message) || e).slice(0, 200) }); }   // 3.9
  if (CONNECT_ON) connectP().catch((e) => diag('connect: init failed', { message: String((e && e.message) || e).slice(0, 200) }));   // Connection (off in public builds)
}
/** Connection (off in public builds) */
function connectApi() {
  return { Q: () => Q, consented, openLesson: () => openLesson(), done: (k) => done(k), models: MODELS, dl: (k) => S.dl[k] || null, startDownload: (k) => startDownload(k),
    ltxOk: () => ltxOk(), openLtx: (cb) => openLtx(cb), toast: (t, o) => toast(t, o), diag, sheet: (id, title) => mvSheet(id, title), go: (t) => go(t), render: () => render() };
}
/** 3.8: what the Apps tab may use from the app (makeapp/host.js): the queue, the chat (an app's notice), sheets and toasts */
function appsApi() {
  return { Q: () => Q, toast, sheet: mvSheet, installed: (k) => done(k), consented, openLesson: () => openLesson(), diag,
    safe: () => SAFE,   // v4: safe mode (?safe=1): no app checks on its own
    homeButton: (a, open) => SHELL.homeButton(a, open),   // 3.9: My apps' "Add to Home" (ui/shell.js)
    settle: () => settle(), endHold: () => { if (Q) Q.endHold(); },   // 3.8 (iOS 27): a few seconds after a model leaves; Juli held for a follow-up lets go
    busy: () => S.phase === 'working' || !!(Q && Q.active && RENDER_KINDS.has(Q.active.job.kind)),
    modelBusy: () => S.phase === 'working' || !!(Q && (Q.holding || (Q.active && Q.modelOf(Q.active.job)) || (Q.next() && Q.modelOf(Q.next())))),   // a model is (about to be) in memory, Juli answering an app included (3.8: or held for a follow-up)
    // v4 (Token Watch's name references): the Bigger brain for an app's own switch: downloaded, can run here, size, this phone's speed
    bigState: () => { const b = ls.get('pf.app.bench', null), v = b && b.tests && b.tests.e4bchat;
      return { downloaded: !!MODELS.brain4 && done('brain4'), usable: brain4Here() && !brain4Blocked(), why: !e4bHere() ? 'this browser can’t run its second process' : brain4Blocked() ? 'it ran out of memory here last time' : '',
        sizeGB: MODELS.brain4 ? Math.round(MODELS.brain4.total / 1e8) / 10 : 0, tokPerS: v && +v.tokPerS > 0 ? +v.tokPerS : 0 }; },
    downloadBig: () => { const m = e4bDl(); if (!m.running && !m.ready && !m.pausing) e4bTap(); },   // the existing flow: NVIDIA's licence screen first (the person accepts it), then the download
    loadedModel: () => { const id = Q && (Q.active ? Q.modelOf(Q.active.job) : Q.host ? Q.host.currentId : null); return !id ? null : id === MODELS.brain.id ? 'e2b' : MODELS.brain4 && id === MODELS.brain4.id ? 'big' : 'other'; },   // v4 (scheduler)
    confirm: (title, text, ok, fn) => openSheet(title, text, ok, fn),
    about: (budget) => (MEM ? MEM.about(budget) : ''),   // 3.9: About me for the make and change prompts (the framed block; '' when none)
    async notice(app, n) {   // an app's notice in Juli's chat: kept out of the model's history (it is never an instruction to Juli)
      if (!AG || !CH) throw new Error('Juli is not ready');
      const sid = await CH.session(); if (!sid) throw new Error('no chat');
      await AG.say(sid, { kind: 'notice', app: String(app).slice(0, 30), title: n.title, severity: n.severity, text: n.text, history: false });
      if (S.tab !== 'assistant') toast(`${app} posted in Juli’s chat`, { action: 'Show', onAction: () => go('assistant'), ms: 5000 });
    } };
}
/** 3.9: what About me and Routines (ui/memory_ui.js) may use: the Apps tab's database (its store `memory`), Juli and her chat, whether a
 *  model or an open app holds the phone's memory, sheets and toasts */
function memApi() {
  return { db: () => (APPS && APPS.state && APPS.state.db) || null, AG: () => AG, CH: () => CH, installed: () => done('brain'),
    consented: () => consented(), modelBusy: () => appsApi().modelBusy(), appOpen: () => !!(APPS && APPS.state && APPS.state.open), readOnly: () => !!(Q && Q.readOnly),
    jobOpen: (id) => { const j = Q && id ? Q.get(id) : null; return !!j && !['done', 'failed', 'cancelled'].includes(j.status); },
    toast: (t, o) => toast(t, o), sheet: (id, title) => mvSheet(id, title), el: (tag, cls, text) => mvEl(tag, cls, text), btn: (label, cls) => mvBtn(label, cls),
    confirm: (t, x, ok, fn) => openSheet(t, x, ok, fn), share, saveFile, diag: (step, data) => diag(step, data), openChat: () => go('assistant') };
}
/** 3.9: what Music may use from the app (ui/music.js): the Library's songs and their files, toasts and sheets */
function musicApi() {
  return { lib: () => S.lib, getBlob: (id) => store.getBlob(id), toast, sheet: mvSheet, confirm: (title, text, ok, fn) => openSheet(title, text, ok, fn), diag };
}
/** v4: what Make HDR (ui/hdr.js) may use: the queue, the Library (its files, a new item beside the original), sheets, toasts, the agreement */
function hdrApi() {
  return { Q: () => Q, getBlob: (id) => store.getBlob(id), lib: () => S.lib, toast, sheet: mvSheet, el: mvEl, btn: mvBtn, consented, openLesson: () => openLesson(),
    settle: () => settle(), busy: () => appsApi().modelBusy(), saveToLibrary, loadLib, openViewer: (id) => openViewer(id, false), diag };
}
/** 3.9 (Settings › Benchmark › Full's feature checks, ui/bench_features.js): what the checks read: Juli, her chat, About me + Routines,
 *  Music, the screen shown, the page's graphics memory (read only: the diagnostics' peak stays), the helper process's heartbeat (iOS 27),
 *  and how this page opened (the app's own planned fresh page, or the page before ended: where), for a run the page's reload cut */
function bench39() {
  return { AG: () => AG, CH: () => CH, MEM: () => (typeof MEM === 'undefined' ? null : MEM), MUSIC: () => (typeof MUSIC === 'undefined' ? null : MUSIC), tab: () => S.tab, settle,
    splitHere: () => !!SPLIT_HERE,
    mem: () => { const pm = performance && performance.memory; return { gpuMB: GPUM.on ? Math.round(GPUM.live / 1e6) : null, jsMB: pm ? Math.round(pm.usedJSHeapSize / 1e6) : null }; },
    splitBeat: (k) => { const e = E[k], p = e && e.pipe; return p ? { split: !!p.split, lastHb: (p._wk && p._wk.lastHb) || 0, now: performance.now() } : null; },
    pageOpen: () => { const d = ls.get(INFLIGHT, null); return { planned: !!PLANNED_IN, stage: (PLANNED_IN && PLANNED_IN.stage) || null, diedAtFresh: PLANNED_DIED ? String(PLANNED_DIED.stage || 'a fresh page') : null,
      died: d && d.kind ? `${d.kind}: ${String(d.step || '').slice(0, 60)}${d.engineMB != null ? ` (engine ${d.engineMB} MB)` : ''}` : null }; } };
}
/** 3.9: what "Make an icon" may use (ui/appicon.js): the queue, sheets and toasts, whether Juli and the picture model are on this phone,
 *  the agreement, a made app's skeleton (its name and description are the words Juli reads) and the shell's pin */
function iconApi() {
  return { Q: () => Q, toast: (t, o) => toast(t, o), sheet: (id, title) => mvSheet(id, title), el: (tag, cls, text) => mvEl(tag, cls, text), btn: (label, cls) => mvBtn(label, cls),
    consented: () => consented(), installed: (k) => done(k), diag: (step, data) => diag(step, data), shell: () => SHELL,
    skelOf: (app) => { const sk = APPS && APPS.state && APPS.state.skels && APPS.state.skels.get(app.skel); return sk ? { name: sk.manifest.name, about: sk.manifest.description } : {}; },
    pin: (app, open) => { const ok = SHELL.pin({ id: 'app:' + app.id, title: app.name, ref: app.id, open }); toast(ok ? `${app.name} is on the Home Screen` : 'The Home Screen is full: remove a pinned app first'); return ok; } };
}
function benchApi() {
  return { ...bench39(), ls, toast, sheet: mvSheet, Q: () => Q, done, MODELS, consented, ltxOk, wake, learn, version: APP_VERSION, apps: () => APPS,
    videoEnv: () => ({ video: done('video'), reader: !!E.reader && done('reader'), ltx: ltxOk(), loraHere: !!E.lora, lora: !!E.lora && done('lora'),   // v4: Settings › Benchmark › Video
      image: done('image'), vencHere: !!E.venc, venc: !!E.venc && done('venc'), styleHere: !!E.lora2, style: !!E.lora2 && done('lora2') }),   // v4 Phase 3: + style video to video
    e4bHere: () => (typeof E4B_HERE === 'function' ? !!E4B_HERE() && !(typeof E4B_BLOCKED === 'function' && E4B_BLOCKED()) : false), e4bWhy: () => (typeof E4B_WHY === 'function' ? E4B_WHY() : null),   // 3.8 v040: the Bigger brain
    planned: (id) => !!(PLANNED_IN && (PLANNED_IN.ids || []).includes(id)),
    device: () => { const ua = navigator.userAgent; return `${/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'Desktop'} · ${[...new Set((($('s-gpu') && $('s-gpu').textContent) || 'GPU').split(/\s+/))].join(' ')}${navigator.deviceMemory ? ` · ${navigator.deviceMemory} GB` : ''}`; } };
}
/** a 'turn' job woken after its render, when no model call is left: a song or music video (never reviewed), review off, or the job stopped */
function replyOnly(j) {
  const st = j && j.state, pd = st && st.pending;
  if (!st || st.stage !== 'wait' || !pd || ((j.params && j.params.purpose) || 'turn') !== 'turn') return false;
  const c = Q.get(pd.child);
  if (!c || c.status !== 'done') return true;
  return !(['picture', 'edit', 'clip', 'animate', 'between'].includes(c.kind) && AG && AG.hooks.review);
}
/** p0pc0rn Cast: a picture or clip request that names a Cast member with photos -> their face crop is Klein's reference (an 'edit' from it;
 *  a clip: that still first, then image-to-video). The name becomes "the person in the reference photo" (it means nothing to the model).
 *  post-launch (security review I1): only the person's OWN words pick the Cast member, never the model-written prompt (page text the
 *  assistant read could otherwise put a Cast photo into a picture). */
async function castJob(job, tool, args, text) {
  if (!job || (job.kind !== 'picture' && job.kind !== 'clip')) return null;
  const hits = (await CAST.find(String(text || ''))).filter((h) => h.person.photos.length);
  if (!hits.length) return null;
  const { person, as } = hits[0], blob = await CAST.getBlob(person.photos[0].key); if (!blob) return null;
  const names = [person.name, person.name.split(/\s+/)[0], ...(as === 'me' ? ['myself', 'me'] : [as])].filter((v, i, a) => v && a.indexOf(v) === i);
  const P = job.params, inputKey = await Q.putBlob(await refForShape(blob, P.width, P.height), { role: 'cast-ref' }), prompt = refPrompt(args.prompt, names);
  diag('cast: reference', { tool, kind: job.kind, photos: person.photos.length });
  const still = { kind: 'edit', model: MODELS.image.id, minutes: job.minutes, params: { prompt, inputKey, attested: true, reference: 'full', width: P.width, height: P.height, steps: P.steps || 4, cast: { id: person.id, name: person.name } } };
  if (job.kind === 'picture') return still;
  return Object.assign(still, { minutes: (job.minutes || 6) + 3, then: { kind: 'animate', params: { prompt, attested: true, width: P.width, height: P.height, seconds: (P.frames - 1) / 16, frames: P.frames } } });
}
/** after boot: the jobs a page kill interrupted go first (same seed and pictures: the engine resumes from its checkpoint) */
/** v024.1: the card after a page death: Try again / Discard / Diagnostics (the queue stays paused until a choice) */
function safeOpen(back, died) {
  const roots = [...new Set(back.map((j) => j.root || j.id))].map((id) => Q.get(id)).filter(Boolean);
  const what = roots.length ? roots.map((r) => (r.kind === 'chat' ? 'Juli' : `the ${NOUN[r.kind] || 'job'}`)).join(' and ') : 'a job';
  const where = died && died.step ? ` at “${died.step}”` : '';
  const { sheet, close } = mvSheet('safe-open', 'The last job stopped the page');
  sheet.append(mvEl('p', 'callout', `p0pc0rn closed while ${what} was working${where}. That usually means the phone ran out of memory. Nothing runs again until you choose.`));
  const retry = mvBtn('Try again', 'btn cta'); retry.id = 'safe-retry';
  const drop = mvBtn('Discard it', 'btn'); drop.id = 'safe-discard';
  const dg = mvBtn('Diagnostics', 'btn ghost'); dg.id = 'safe-diag';
  retry.onclick = () => {
    if (back.some((j) => j.kind === 'chat')) { S.resumeLean = true; const t = back.find((j) => j.kind === 'chat'); if (AG && t.session) AG.say(t.session, { kind: 'status', text: 'Trying once more, with Juli loading lighter.', history: false }).catch(() => {}); }
    diag('safe open: try again', { jobs: back.map((j) => j.kind) }); ls.set(INFLIGHT, null); close(); Q.resume();
  };
  drop.onclick = async () => {
    diag('safe open: discarded', { jobs: back.map((j) => j.kind) }); ls.set(INFLIGHT, null);
    for (const r of roots) { try { await Q.cancel(r.id); } catch (x) { /* already gone */ } }
    close(); Q.resume(); toast('Discarded');
  };
  dg.onclick = () => { close(); go('settings'); setTimeout(() => { const d = $('s-diag'); if (d) { revealSetting(d); d.open = true; d.scrollIntoView({ block: 'start' }); } }, 300); toast('The queue is paused: resume it from the queue when you are ready', { ms: 5000 }); };
  sheet.append(retry, drop, dg);
}
function startQueue() {
  if (!Q) return;
  const rec = (Q.recovered || []).map((id) => Q.get(id)).filter(Boolean);
  for (const j of rec) if (j.status === 'failed' && j.parent) Q.wakeParent(j).catch(() => {});      // gave up (3 kills): its chat turn still answers
  for (const j of rec) if (j.status === 'failed' && isCreateJob(j) && j.kind !== 'restylelong') Q.remove(j.id).catch(() => {});  // Create shows the engine's own banner for it (v4: a whole-video restyle is kept: it carries on)
  const back = rec.filter((j) => j.status === 'queued' && !(PLANNED_IN && (PLANNED_IN.ids || []).includes(j.id)));
  let died = ls.get(INFLIGHT, null);   // kept until the person decides (Try again / Discard), so a reopen asks again
  // v024.2: a planned fresh page is not a death: its jobs are already back in the queue (no kill); nothing to ask
  if (PLANNED_IN && died && (PLANNED_IN.ids || []).includes(died.id)) { ls.set(INFLIGHT, null); died = null; }
  // 3.8 (iOS 27): the page ended while Juli answered WITH faster replies loaded: they stay off on this phone (the drafter's 54 MB is the
  // margin a long prompt needs there); a toast says so and can turn them back on
  if (died && ls.get('pf.app.brainDrafter', false) && /assistant/.test(String(died.step || '')) && FASTER_REPLIES) {   // brainDrafter: they were on
    ls.set('pf.app.fasterOff', { t: Date.now(), step: String(died.step).slice(0, 80), split: !!ls.get('pf.app.brainSplit', false) });   // 3.8: with or without the split
    if (E.brain && E.brain.opts) E.brain.opts.drafter = false;   // this page too (its engine was made before this check)
    diag('faster replies off: the page ended during an answer', { step: died.step });
    setTimeout(() => toast('Faster replies are off on this phone: it ran out of memory with them on. Juli answers a little slower.', { action: 'Turn on', ms: 12000, onAction: () => { ls.set('pf.app.fasterOff', null); location.reload(); } }), 1500);
  }
  ls.set('pf.app.brainDrafter', false);
  // 3.8 (v040): the page ended while the Bigger brain was loaded: it stays off on this device (Juli's own model does its work) until
  // Settings › Juli turns it back on
  if (died && ls.get('pf.app.brain4Loaded', false) && !E4B_BLOCKED()) {
    const lc = ls.get('pf.app.brain4Loaded', false);
    ls.set('pf.app.brain4Off', { t: Date.now(), step: String(died.step || '').slice(0, 80), cfg: typeof lc === 'string' ? lc : 'd-c128' });
    diag('bigger brain off: the page ended while it was loaded', { step: died.step });
    setTimeout(() => toast('The Bigger brain ran out of memory on this phone, so Juli is using her own model. Settings › Juli can turn it back on.', { ms: 12000 }), 1800);
  }
  ls.set('pf.app.brain4Loaded', false);
  if (PLANNED_IN) {   // v026.2: how this page was opened (the next phone log says whether the cover was up and how long the reload took)
    let nav = null; try { const e = performance.getEntriesByType('navigation')[0]; nav = e ? e.type : null; } catch (x) { nav = null; }
    diag('fresh page: continuing', { stage: PLANNED_IN.stage, nav, coverAtStart: COVER_AT_START, reloadMs: Date.now() - PLANNED_IN.t, tab: (PLANNED_IN.ui || {}).tab || null, resumed: rec.map((j) => `${j.kind}:${j.status}:${j.fresh || 0}`) });
  }   // v026.1: no toast: the cover says it
  const deadJob = died && Q.get(died.id), pending = back.length ? back : deadJob && !TERMINAL.has(deadJob.status) ? [deadJob] : [];
  if (died && !pending.length) ls.set(INFLIGHT, null);   // that job is gone: nothing to ask
  diag('page open', { version: APP_VERSION, safe: SAFE, died: died ? `${died.kind}: ${died.step}${died.engineMB != null ? ` (engine ${died.engineMB} MB)` : ''}` : null, resumed: rec.map((j) => `${j.kind}:${j.status}:${j.kills || 0}`),
    diedAtFreshPage: PLANNED_DIED ? PLANNED_DIED.stage : null });   // v026.7: the page died between a planned fresh page's marker and its reload
  // v024.1 SAFE OPEN: after the page died in a job, nothing runs on its own (Josh's phone: the resumed song died again, and again).
  // The queue stays paused and a card asks: Try again / Discard. ?safe=1 opens paused with nothing resumed.
  if (pending.length || SAFE) Q.pause();
  if (pending.length) setTimeout(() => safeOpen(pending, died), 300);
  else if (SAFE) toast('Safe mode: nothing runs until you resume the queue, and apps don’t check on their own', { ms: 6000 });   // v4: + apps (makeapp/host.js)
  for (const j of rec) if (j.status === 'failed' && j.kind === 'chat') Q.emit('failed', j);   // its turn says why, in plain words
  const requeued = rec.filter((j) => j.status === 'queued');   // v024.2: incl. the planned fresh page's (no 'Try again' banner for them either)
  if (requeued.length) {
    const ks = new Set(requeued.map((j) => KEY_OF[Q.modelOf(j)]).filter(Boolean));
    if (S.killed && ks.has(S.killed.media)) S.killed = null;   // no "Try again" banner: the queue already tries again
    if (S.vkilled && ks.has('video')) S.vkilled = null;
  }
  const old = Date.now() - 3 * 864e5;   // finished families older than 3 days: the Library and the chat keep what matters
  const mvOld = Date.now() - 30 * 864e5;   // v023: a music video keeps its frames and takes 30 days (its storyboard can still reroll a shot)
  const keptLong = (j) => j.kind === 'restylelong' && j.status === 'failed' && (j.endedAt || 0) > old;   // v4: a whole-video restyle that stopped: 3 days to carry on
  for (const j of Q.list()) if (j.root === j.id && TERMINAL.has(j.status) && !keptLong(j) && (isCreateJob(j) || (j.endedAt || 0) < (j.kind === 'mvflf' ? mvOld : old)) && !Q.descendants(j.id).some((d) => !TERMINAL.has(d.status))) Q.remove(j.id).catch(() => {});
  for (const j of Q.list()) if (j.kind === 'restylelong' && j.status === 'waiting' && Q.children(j.id).length && Q.children(j.id).every((c) => TERMINAL.has(c.status))) Q.maybeWake(j).catch(() => {});   // its part ended while the page was away
  { const k = longKept(); if (k && !pending.length) setTimeout(() => { if (S.phase === 'ready' && !S.job) longFailed(k, null, false); }, 400); }   // v4: Create says it stopped, with Carry on
  if (S.brainNote) { toast(S.brainNote, { ms: 6000 }); S.brainNote = null; }
  Q.pump(); render(); if (CH) CH.render();
}

// ---- engines for the queue: EngineHost loads ONE model for a job and unloads it before the next model (and when the queue is idle)
// 3.9 (agent E): Juli's engine went on in ONE process in this page (her second process failed or did not start: ~1.67 GB here, not ~1.27)
// while the split is still on here: her next load takes a planned fresh page, where a fresh second process is tried (once in 10 minutes)
const juliSplitAgain = () => { if (!(E.brain && E.brain.opts && E.brain.opts.split === false && splitOn())) return false; const t = +ls.get('pf.app.splitAgainAt', 0) || 0; if (Date.now() - t < 6e5) return false; ls.set('pf.app.splitAgainAt', Date.now()); return true; };
async function hostCreate(id) {
  const k = KEY_OF[id];
  if (!k) throw Object.assign(new Error('no engine for ' + id), { code: 'UNSUPPORTED' });
  if (VOICEIN && (k !== 'brain' || !voiceBeside())) await VOICEIN.release('load ' + k);   // v4: the recogniser stays only beside Juli (WebKit: her voice layout)
  // v024.2: a fresh page before a model loads, if this page destroyed a lot (WebKit). Not between two assistant turns (the assistant
  // unloads whenever the queue is idle; a reload per turn would flash every reply): only after another model, e.g. a song
  const ncOwn = k === 'nowcast' && (!LAST_UNLOADED || KEY_OF[LAST_UNLOADED] === 'nowcast');   // v4: the nowcast after itself: never a fresh page for that
  if (!ncOwn && (k !== 'brain' || (LAST_UNLOADED && LAST_UNLOADED !== MODELS.brain.id) || juliSplitAgain())) await freshPage('load ' + k, activeJobId());   // 3.9: + Juli's split again
  else { const w = await settle(); if (w) diag('waited before loading Juli', { ms: w }); }   // 3.8 (iOS 27): Juli again right after she left
  if (k === 'k9b') {   // v026.6: FLUX.2 [klein] 9B, its own module (engine/k9b), staged: text -> encode -> denoise -> decode
    if (!E.k9b) throw Object.assign(new Error("the Klein 9B engine couldn't start"), { code: 'UNSUPPORTED' });
    const e = E.k9b.lazy ? await E.k9b.ensure() : E.k9b;   // v026.7: loaded only now
    if (E.k9b.lazy) { await refreshStatus('k9b'); render(); }
    return k9bAdapter(e);
  }
  if (k === 'nowcast') {   // v4: the Nowcast's engine (nowcast/engine.js), loaded only now; unload() gives every GPU buffer back
    if (!E.nowcast) throw Object.assign(new Error("the nowcast engine couldn't start"), { code: 'UNSUPPORTED' });
    const e = E.nowcast.lazy ? await E.nowcast.ensure() : E.nowcast;
    await e.load({ precision: id === 'dgmr-nowcast-int8' ? 'int8' : undefined }); return e;
  }
  if (k === 'voice' || k === 'lipsync') {   // p0pc0rn Cast: their own modules (not PF), loaded only now (v026.7)
    if (!E[k]) throw Object.assign(new Error(`the ${MODELS[k].name} engine couldn't start`), { code: 'UNSUPPORTED' });
    const e = E[k].lazy ? await E[k].ensure() : E[k];
    if (E[k].lazy) { await refreshStatus(k); render(); }
    return k === 'voice' ? voiceAdapter(e) : lipsyncAdapter(e);
  }
  if (!E[k]) { const e = await PF.createEngine(k === 'music' ? { model: id, decodeBudgetMB: 450 } : { model: id, ...(k === 'image' || k === 'video' ? PIC_ACC : {}), ...(k === 'brain' ? brainOpts() : k === 'brain4' ? brain4Opts() : {}) }); wire(e, k); E[k] = e; if (k === 'music') E.planner = plannerEngine(e); if (k === 'brain') { E.drafter = drafterEngine(e); refreshStatus('drafter'); } if (k === 'brain4') { E.drafter4 = drafterEngine(e); if (S.dl.drafter4) refreshStatus('drafter4'); } }   // v024.1: the phone's decode budget here too
  const e = E[k];
  if (k === 'brain') { await loadBrain(e); return brainAdapter(e); }
  if (k === 'brain4') { await loadBrain4(e); return brainAdapter(e, 'brain4'); }   // 3.8: the Bigger brain
  if (k === 'music') return musicAdapter(e);
  if (k === 'video') { try { e.tune({ decodeBudgetMB: decodeMB() }); } catch (x) { /* applies from the next job */ } return videoAdapter(e); }
  // pictures: the runners call textToImage / imageToImage (v026.2: each in a fresh page on WebKit when another render ran in this page);
  // the host destroys the idle device afterwards (engine 0.3.x has no unload)
  return new Proxy(e, { get(t, k) { const v = t[k]; if (k === 'textToImage' || k === 'imageToImage') return async (o) => { await beforeRender('picture'); return v.call(t, o); }; return typeof v === 'function' ? v.bind(t) : v; } });
}
/** v026.6: the 9B for the picture / edit runners: each picture in a fresh page (like the 4B), and one before each later stage (WebKit) */
const k9bAdapter = (e) => {
  const st = (o) => Object.assign({}, o, { beforeStage: (s) => freshPage('k9b ' + s, activeJobId()) });
  return { id: MODELS.k9b.id, textToImage: async (o) => { await beforeRender('picture'); return e.textToImage(st(o)); },
    imageToImage: async (o) => { await beforeRender('picture'); return e.imageToImage(st(o)); }, cancel: () => e.cancel(), unload: () => { e.unload(); } };
};
/** p0pc0rn Cast: the voice engine for the 'say' runner (castsay.js): its three stages, with a planned fresh page before 'speak' and 'decode' */
const voiceAdapter = (e) => ({ id: MODELS.voice.id, learnVoice: (o) => e.learnVoice(o), talk: (o) => e.talk(o), decodeLine: (o) => e.decodeLine(o), toM4AFull: (x, r) => e.toM4AFull(x, r),
  hasVoice: (key) => e.hasVoice(key), beforeStage: (st) => freshPage('say ' + st, activeJobId()), cancel: () => e.cancel(), unload: () => { e.unload(); } });
/** the lip-sync engine (EXPERIMENTAL) for the 'lipsync' runner (talk.js): a planned fresh page between its stages when the page freed a lot */
const lipsyncAdapter = (e) => ({ id: MODELS.lipsync.id, lipSync: (o) => e.lipSync(Object.assign({}, o, { beforeStage: (st) => freshPage('lipsync ' + st, activeJobId()) })),
  cancel: () => e.cancel(), unload: () => { try { e.unload(); } catch (x) { /* busy: the queue unloads it after the job */ } } });
/** an engine without unload(): destroy its idle GPU device; it makes a new one on its next job (the same path as its GPU-reset recovery) */
async function destroyDevice(e) {
  const g = e && e.gpu;
  if (!g || g.lost || !g.device || e.job) return;
  try { g.device.destroy(); await Promise.race([g.device.lost, new Promise((r) => setTimeout(r, 1500))]); } catch (x) { /* recreated on its next job */ }
}
/** the runners' picture-clip call ({seconds, size}) -> the engine's (ENGINE_API.md section 8: {width, height, frames, attested}); the runner checked the attestation */
const picOpts = (o, x) => Object.assign({ prompt: o.prompt, width: (o.size && o.size.width) || o.width, height: (o.size && o.size.height) || o.height,
  frames: o.frames || TFRAMES[o.seconds] || (Math.round((o.seconds || 5) * 16) + 1), seed: o.seed, attested: true, onProgress: o.onProgress, signal: o.signal, _keepFrames: !!o._keepFrames, _noDecode: !!o._noDecode }, x);   // v026.3: + the frames kept for the handoff; v4: + steps only (the Video benchmark)
const videoAdapter = (e) => ({ id: MODELS.video.id,
  textToVideo: async (o) => { await beforeRender('clip'); return e.textToVideo(o); },   // v026.2: each clip in a fresh page on WebKit
  // v4: picture clips run with the video LoRA when it is on this phone and switched on; a caller that says `lora` (the Video benchmark) decides
  imageToVideo: async (o) => { await beforeRender('clip'); return e.imageToVideo(picOpts(o, { image: o.image, lora: 'lora' in o ? o.lora : loraUse() })); },
  framesToVideo: async (o) => { await beforeRender('clip'); return e.framesToVideo(picOpts(o, { first: o.first, last: o.last, lora: 'lora' in o ? o.lora : loraUse() })); },
  // v4 Phase 3: style video to video ({source: {frames, read(i)}, first (the styled frame 0), prompt, ...}): the looks LoRA unless the caller says
  videoToVideo: async (o) => { await beforeRender('clip'); return e.videoToVideo(picOpts(o, { source: o.source, first: o.first, follow: o.follow || null, startStep: o.startStep == null ? null : o.startStep, lowswap: o.lowswap || null, lora: 'lora' in o ? o.lora : styleLoraUse() })); },
  resumeVideo: async (o) => { await beforeRender('clip'); return e.resumeVideo(o); },
  cancel: () => e.cancel(), unload: () => destroyDevice(e) });
/** ACE-Step's time signature as the official code writes it (4/4 -> '4', 3/4 -> '3', 6/8 -> '6') */
const tsig = (t) => (!t ? undefined : /^6\/8$/.test(t) ? '6' : String(t).split('/')[0]);
/** v024.1: Safari (every iPhone browser is WebKit) saves songs as WAV until this phone passed the AAC test on the song probe
 *  (probe-music.html sets 'p0pc0rn:aacOk'): Josh's iPhone made an .m4a its own player refused. WAV is plain JS and plays everywhere. */
/** v026.9: Android (Chrome): experimental; the same memory protection as the iPhone (planned fresh pages) */
const ANDROID = /Android/i.test(navigator.userAgent || '');
const WEBKIT = (() => { const u = navigator.userAgent || ''; return /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) || (/Safari\//.test(u) && !/Chrome\/|Chromium|Edg\/|Android/.test(u)); })();
// 3.8 (v038): faster replies (the drafter: q8 layers + a 4-bit head, 54 MB more on the graphics chip) everywhere but Android for now.
// On iOS 27 the 81 MB 8-bit-head drafter left no room for a long prompt's read-in; the 4-bit head is as fast on an iPhone. On WebKit
// the read-in goes in 128-token chunks (17 MB less kept on the graphics chip, measured on an iPhone; a little slower to read in).
// 3.8 (v040, Josh: "I want both models"): on iOS 27 Safari part of Juli runs in a second process (engine/llm/split.js: a shared worker
// that the app's own service worker, sw.js, serves with COEP require-corp gets a process and a memory budget of its own): her first 13
// layers there (~0.4 GB), so faster replies and a long prompt fit beside the rest here. The Bigger brain (NVIDIA Bolt E4B) needs it there.
const SAFARI_MAJOR = (() => { const m = /Version\/(\d+)/.exec(navigator.userAgent || ''); return m ? +m[1] : 0; })();
const SPLIT_HERE = WEBKIT && SAFARI_MAJOR >= 27 && 'serviceWorker' in navigator && typeof SharedWorker === 'function';
const splitOn = () => { const off = ls.get('pf.app.splitOff', null); return SPLIT_HERE && !(off && Date.now() - (+off.t || 0) < 3 * 864e5); };   // a phone that gave it up tries again after 3 days (or from Settings › Juli)
/** where the Bigger brain can run: iOS 27 Safari (split) or a desktop browser; not Android yet */
const E4B_HERE = () => (SPLIT_HERE && splitOn()) || (!WEBKIT && !ANDROID);
/** why the Bigger brain can't run here ('' = it can): for its Settings row and the benchmark card */
const E4B_WHY = () => (E4B_HERE() ? (E4B_DOWN ? `didn't load just now (${E4B_DOWN.code})` : E4B_BLOCKED() ? 'off on this phone after it ran out of memory (Settings › Juli turns it back on)' : '') : ANDROID ? 'not on Android yet' : WEBKIT && SAFARI_MAJOR > 0 && SAFARI_MAJOR < 27 ? `needs iOS 27 (this phone has iOS ${SAFARI_MAJOR})`
  : SPLIT_HERE ? "the second process didn't work on this phone" : WEBKIT ? 'needs Safari on iOS 27' : 'not available in this browser');
/** the Bigger brain is off on this device after the page ended while it was loaded, until Settings › Juli turns it back on */
let E4B_DOWN = null;   // 3.8: it could not load in this page (no second process / no memory): Juli does its work until a reload
const E4B_BLOCKED = () => { const off = ls.get('pf.app.brain4Off', null); return !!E4B_DOWN || !!(off && (off.cfg || 'd-c128') === E4B_CFG()); };
// faster replies: everywhere but Android; on iOS 27 only with the split (one process there has no room for a long prompt beside them)
const FASTER_REPLIES = !ANDROID && (!WEBKIT || SPLIT_HERE || (SAFARI_MAJOR > 0 && SAFARI_MAJOR < 27));
const BRAIN_OPTS = WEBKIT && !splitOn() ? { chunk: 128 } : null;   // WebKit in one process: 128-token read-in chunks (17 MB less); split: 256 (fewer hops)
// 3.8: a phone whose page ended while Juli answered with faster replies loaded keeps them off (pf.app.fasterOff: set in startQueue; the
// toast there or Settings > Juli turns them back on)
/** 3.8: faster replies: on iOS 27 only with the split; a stop recorded in one process (pf.app.fasterOff without split) does not count with it */
const fasterOn = () => {
  if (!FASTER_REPLIES || (SPLIT_HERE && !splitOn())) return false;
  const off = ls.get('pf.app.fasterOff', null);
  return !off || (SPLIT_HERE && splitOn() && !off.split);
};
/** 3.8: the engine options of Juli (E2B) and of the Bigger brain (E4B: split on WebKit or not at all; its drafter; 128-token read-in) */
const brainOpts = () => ({ drafter: fasterOn(), modelOpts: BRAIN_OPTS, split: splitOn(), splitFallback: true, oneProcessOpts: WEBKIT ? { chunk: 128 } : null, reloadSettleMs: WEBKIT ? SETTLE_MS : 0,
  ...(voiceLayout() ? { splitAt: VOICE_SPLIT, splitMirror: fasterOn() ? [13, 14] : null } : {}) });
// v4 (voice input): with voice input on this phone and switched on, Juli takes Troll-E's layout on iOS 27: all 35 of her layers in the second
// process (the page keeps her embedding, head and drafter, the KV of 13 and 14 mirrored back for it; the same words), which leaves room in
// the page for the recogniser (about 0.65 GB). A desktop or Android browser has the room; WebKit without the split has not (voiceHere: no
// voice input there yet). The layout applies from Juli's next load (setVoiceLayout: the queue unloads her when it is idle).
const voiceHere = () => !WEBKIT || splitOn();
const voiceLayout = () => SPLIT_HERE && splitOn() && !!MODELS.stt && done('stt') && voiceSettings().on && !VOICE_PAUSED;
// Josh's phone (Nov 2, the Voice in bench): every layout kept all three alive; Juli 0-28 in the helper unless the bench says otherwise
// (0-34 left the helper too full and iOS ended it). Load order made no difference. v4: the Voice in bench's last finished run on this
// phone picks the layout (voicebench_plan.js pickLayout: never one where the page ended, which stops the app; then the fewest helper ends,
// each now a fresh engine; then the quickest first word)
const VOICE_SPLIT = benchSplit() || 29;
function benchSplit() { try { const st = JSON.parse(localStorage.getItem(BENCH_KEY) || 'null'); if (!st || !st.done) return 0; const p = pickLayout(st); return p && [21, 25, 29].includes(p.at) ? p.at : 0; } catch (e) { return 0; } }
const voiceBeside = () => !WEBKIT || voiceLayout();   // where the recogniser may stay loaded while Juli loads (a desktop browser has the room)
function setVoiceLayout() { if (E.brain && E.brain.opts) Object.assign(E.brain.opts, voiceLayout() ? { splitAt: VOICE_SPLIT, splitMirror: fasterOn() ? [13, 14] : null } : { splitAt: undefined, splitMirror: null }); }
/** v4: Juli's second process failed while voice mode was on (WebKit). The first time: a FRESH engine for the queue's retry, with the same
 *  0-28 layout (a reload of the same engine hit NOT_LOADED and file-handle conflicts in Troll-E); the second: voice paused for this page
 *  (the recogniser and her voice let go, a short note), and Juli goes on as she does without voice input */
function juliSplitFailed(e, d) {
  if (!WEBKIT || !voiceLayout()) return;
  VOICE_FAILS++; diag('voice mode: second process failed', { code: d && d.code, n: VOICE_FAILS });
  if (VOICE_FAILS >= 2) { pauseVoice('her second process ended twice'); return; }
  freshJuli(e);
}
/** the next job makes a new engine for Juli (this one unloaded itself when its second process failed) */
function freshJuli(e) {
  if (E.brain === e) { E.brain = null; E.drafter = null; }
  if (Q && Q.host && Q.host.currentId === MODELS.brain.id) Q.host.current = null;
}
function pauseVoice(why) {
  if (VOICE_PAUSED) return;
  VOICE_PAUSED = { why, t: Date.now() }; diag('voice mode paused', { why });
  if (VOICEIN) { VOICEIN.release('voice paused'); VOICEIN.render(); }
  if (E.brain && E.brain.opts) setVoiceLayout(); freshJuli(E.brain);   // her next load: the chat's own layout, a fresh engine
  const sid = CH && CH.sid;
  if (AG && sid) AG.say(sid, { kind: 'status', text: 'Voice paused: the phone needs the memory, so I’ll answer in text for now. Reopen p0pc0rn to talk again.', history: false }).catch(() => {});
}
/** Juli is in the page in the chat layout (loaded before voice input was on, or one process): voice input waits for her */
const juliWide = () => WEBKIT && !!Q && !!Q.host && Q.host.currentId === MODELS.brain.id && !(S.brainLoad && S.brainLoad.split && S.brainLoad.split.at >= VOICE_SPLIT);
/** what voice input waits for ('' = nothing): another model's job, or Juli's answer in the chat layout */
const voiceBusy = () => {
  if (tuning()) return 'the speed tune';   // v4: the kernel tune and Make HDR use the graphics chip with no model: no recogniser beside them
  if (!Q || !Q.active) return '';
  const m = Q.modelOf(Q.active.job);
  if (!m) return `the ${NOUN[Q.active.job.kind] || 'job'}`;
  if (KEY_OF[m] !== 'brain') return `${theNoun(KEY_OF[m] || 'image')}’s job`;
  return juliWide() ? 'Juli’s answer' : '';
};
/** before the recogniser loads: Juli held in the chat layout leaves first (the queue lets her go), then WebKit gets the memory back (settle) */
// v4 (Josh's phone, Nov 2: the first spoken turn read in 1,137 tokens, 6.1 s to her first word; a first lookup's planner 351): in a gap
// (a chat turn just ended, Juli loaded in voice mode's layout and idle, the mic not listening), the voice prompt's and the lookup
// planner's fixed starts are read in and kept (engine keepPrefix + prefixOnly; agent.js voiceWarmMessages), so the next spoken turn and
// its lookup are hits. Not while the person talks: on the desk a warm-up beside the listening recogniser took its real-time factor from
// 0.33 to 1.31. The mic opening stops it (a turn then reads in what it needs); a turn that comes while it runs waits for it
let WARM = null, WARMED = null, WARM_AC = null;
function warmVoice() {
  try {
    const e = E.brain, L = S.brainLoad;
    if (!AG || !AG.voiceWarmMessages || !e || !e._loaded || e.job || WARM || (Q && Q.active) || VOICE_PAUSED || !VOICEIN || !voiceLayout() || !L) return;
    if (VOICEIN.listening && VOICEIN.listening()) return;
    if (WEBKIT && !(L.split && L.split.at === VOICE_SPLIT)) return;   // her voice layout only (another is loaded again for a spoken turn)
    if (WARMED === L) return;
    const ac = new AbortController(), t0 = performance.now(), got = []; WARM_AC = ac;
    WARM = (async () => {
      for (const m of AG.voiceWarmMessages()) { const r = await e.chat(m, { keepPrefix: true, prefixOnly: true, maxTokens: 1, signal: ac.signal }); got.push(r.snapshot ? (r.snapshot.hit ? 'hit' : r.snapshot.readIn) : null); }
      WARMED = L; diag('voice warm-up', { readIn: got, ms: Math.round(performance.now() - t0) });
    })().catch((x) => { if (!(x && x.name === 'AbortError')) diag('voice warm-up failed', { message: msg(x).slice(0, 160) }); }).finally(() => { WARM = null; WARM_AC = null; });
  } catch (x) { /* never in the way */ }
}
function abortWarm() { try { if (WARM_AC) WARM_AC.abort(); } catch (x) { /* */ } }
async function voiceRoom() {
  if (!juliWide() || (Q && Q.active)) return;
  Q.endHold(); for (let i = 0; i < 100 && Q.host && Q.host.currentId; i++) await new Promise((r) => setTimeout(r, 100));
  const w = await settle(); if (w) diag('voice input waited for memory', { ms: w });
}
// the Bigger brain on WebKit: split at 24 (3.9; 3.8: 23): layers 0-23 in the second process, the KV of 22 and 23 mirrored back, so its drafter fits beside the head;
// 64-token read-in chunks (Josh's iPhone, 10-24: split at 22 + drafter ended the page at 1,709 MB)
const brain4Opts = () => ({ drafter: true, modelOpts: { chunk: WEBKIT ? 64 : 128 }, split: WEBKIT ? 'required' : false, reloadSettleMs: WEBKIT ? SETTLE_MS : 0 });
const E4B_CFG = () => { const o = brain4Opts(); return `${o.drafter ? 'd' : 'nd'}-c${o.modelOpts.chunk}-m39`; };   // a stop counts only for the set-up it happened with (3.9: + the memory set-up, m39)
const songFormat = () => { let ok = false; try { ok = localStorage.getItem('p0pc0rn:aacOk') === '1'; } catch (x) { ok = false; } return WEBKIT && !ok ? 'wav' : 'm4a'; };
const musicAdapter = (e) => ({ id: MODELS.music.id,
  async textToMusic(o) {
    const format = songFormat();
    diag('song render', { seconds: o.seconds, format });
    let lm = false;   // the lyrics planner: on when it is on the phone (35 of 40 lines heard vs 21 without it)
    if (o.lm !== false) { try { lm = !!(await e.lmStatus()).complete; } catch (x) { lm = false; } }
    const r = await e.textToMusic({ tags: o.tags, lyrics: o.lyrics, seconds: o.seconds, seed: o.seed, bpm: o.bpm, keyscale: o.key || undefined, timesignature: tsig(o.timeSignature), lm, format, onProgress: o.onProgress, signal: o.signal,
      beforeStage: (stage) => freshPage('song ' + stage, activeJobId()) });   // v024.2: before the denoise and before the decode
    try { if (r.url) URL.revokeObjectURL(r.url); } catch (x) { /* */ }
    SONG_INFO.set(o.seed, { lm, wall: r.seconds, codec: r.codec, timings: r.timings, peakMB: r.peakMB, resumedFromStep: r.resumedFromStep || 0, plan: r.plan ? { prefill: r.plan.prefill, decode: r.plan.decode } : null });
    return Object.assign({}, r, { audio: r.blob, seconds: r.durationSec || o.seconds, url: null });   // seconds = the song's length (the runner's field), not the wall time
  },
  cancel: () => e.cancel(), unload: () => destroyDevice(e) });
/** the assistant loads resident (about 1.5 GB, fastest); after a memory failure or a page kill while loading, its next load is lighter
 *  (<= 1.2 GB, part-streamed: several times slower to answer). 3.8: lighter for good only after two failures in a row loading in full;
 *  a full load that works clears the count, and the person's own choice in Settings › Juli always wins. */
const FULL_FAILS = 'pf.app.brainFullFails';
function setBrainMode(m, quiet) { AS.brainMode = m === 'lean' ? 'lean' : 'resident'; ls.set('pf.app.brainMode', AS.brainMode); if (!quiet && S.tab === 'settings') renderSettings(); }
function brainFullFailed() { const n = (+ls.get(FULL_FAILS, 0) || 0) + 1; ls.set(FULL_FAILS, n); if (n >= 2) setBrainMode('lean', true); return n; }
async function loadBrain(e) {
  const t0 = performance.now();
  let mode = S.resumeLean ? 'lean' : AS.brainMode;   // v024: the page died in a turn: its one retry loads the assistant lighter
  if (S.resumeLean) { S.resumeLean = false; diag('assistant loads lighter after a page kill'); }
  let splitWhy = null;   // 3.8: why this load is one process (for the benchmark card)
  const go1 = async (m) => {
    ls.set('pf.app.brainLoading', { mode: m, t: Date.now() });
    let r;
    try { r = await e.load({ mode: m }); }
    catch (x) {
      if (!(x && x.code === 'SPLIT_FAILED')) throw x;
      // 3.8 (iOS 27): no second process this time: Juli in one process without faster replies (the drafter needs the split's room)
      splitWhy = msg(x).slice(0, 160); diag('split not used', { why: splitWhy });
      e.opts.split = false; e.opts.drafter = false;
      const n = (+ls.get('pf.app.splitFails', 0) || 0) + 1; ls.set('pf.app.splitFails', n);
      if (n >= 3 && !ls.get('pf.app.splitWorked', false)) ls.set('pf.app.splitOff', { t: Date.now(), why: msg(x).slice(0, 120) });   // three loads in a row: stop trying on this phone (3.8 port: only where it never worked)
      r = await e.load({ mode: m });
    }
    if (r && r.split) { ls.set('pf.app.splitFails', 0); ls.set('pf.app.splitWorked', true); }   // 3.8 port: + it works on this phone
    ls.set('pf.app.brainLoading', null); return r;
  };
  let r;
  try { r = await go1(mode); if (mode !== 'lean') ls.set(FULL_FAILS, 0); }
  catch (x) {
    ls.set('pf.app.brainLoading', null);
    if (mode === 'lean' || !(x && (x.code === 'OUT_OF_MEMORY' || /memory|allocat/i.test(msg(x))))) throw x;
    try { e.unload(); } catch (y) { /* */ }
    if (e.opts.split) { e.opts.split = false; e.opts.drafter = false; }   // 3.8: the lighter load is one process, without faster replies
    const n = brainFullFailed(); mode = 'lean';
    toast(n >= 2 ? 'Juli now loads lighter to fit in memory (slower). Settings › Juli can switch it back.' : 'Juli is loading lighter this time to fit in memory.');
    r = await go1('lean');
  }
  S.brainLoad = { mode, seconds: +((performance.now() - t0) / 1000).toFixed(2), residentMB: r && r.residentMB, drafter: !!(r && r.drafter), split: (r && r.split) || null, splitError: splitWhy };   // 3.8: + faster replies on/off, the split
  if (r && r.split) diag('Juli split', r.split);
  ls.set('pf.app.brainDrafter', !!(r && r.drafter));   // 3.8: for the faster-replies safety net (startQueue)
  ls.set('pf.app.brainSplit', !!(r && r.split));   // 3.8 (v040): ... and whether it happened with the split
  if (r && r.drafterError) diag('faster replies not used', { error: r.drafterError });
}
/** 3.8 (v040): the Bigger brain (NVIDIA Bolt E4B): resident, split on iOS 27 (one process on a desktop browser), its drafter on; a
 *  failure goes up to the job (the router runs that step on Juli instead) */
/** 3.8: Juli's engine went on in one process (no second process this time): three loads in a row (online) = stop trying on this phone */
function onSplitOff(d) {
  const why = String((d && d.why) || '').slice(0, 160); diag('split not used', { why });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;   // offline: not this phone's fault
  const n = (+ls.get('pf.app.splitFails', 0) || 0) + 1; ls.set('pf.app.splitFails', n);
  if (n >= 3 && !ls.get('pf.app.splitWorked', false)) ls.set('pf.app.splitOff', { t: Date.now(), why: why.slice(0, 120) });   // 3.8 port: only where it never worked
}
async function loadBrain4(e) {
  const t0 = performance.now();
  ls.set('pf.app.brain4Loaded', E4B_CFG());   // the safety net (startQueue): the page ended while it was loaded (with this set-up)
  let r;
  try { r = await e.load({ mode: 'resident' }); }
  catch (x) {
    ls.set('pf.app.brain4Loaded', false); try { e.unload(); } catch (y) { /* */ } diag('bigger brain did not load', { code: (x && x.code) || null, error: msg(x).slice(0, 160) });
    if (x && /SPLIT_UNAVAILABLE|OUT_OF_MEMORY|NOT_DOWNLOADED/.test(x.code || '')) E4B_DOWN = { code: x.code, t: Date.now() };   // no retry per turn in this page
    UNLOADED_AT = Date.now(); LAST_UNLOADED = MODELS.brain4.id;   // what it loaded is given back late: the next load waits / gets a fresh page
    throw x;
  }
  S.brain4Load = { seconds: +((performance.now() - t0) / 1000).toFixed(2), residentMB: r && r.residentMB, drafter: !!(r && r.drafter), split: (r && r.split) || null };
  diag('bigger brain loaded', S.brain4Load);
}
const brainAdapter = (e, key = 'brain') => ({ id: MODELS[key].id, chat: (m, o) => brainChat(e, m, o, key), cancel: () => e.cancel(),
  countTokens: (m, o) => e.countTokens(m, o),   // 3.8: the router's fit check (no GPU)
  unload: async () => { ls.set(key === 'brain4' ? 'pf.app.brain4Loaded' : 'pf.app.brainDrafter', false); e.unload(); } });   // 3.8 port: the device STAYS (bench v048: destroying it after every unload ended with 'The GPU was reset' at load 12, kept 40/40; its buffers are freed by unload, its pipelines make the next load faster)   // v024.1: its device goes too (WebKit reclaims destroyed buffers lazily); 3.8: and the split's worker part
/** agent.js's chat call -> the engine's (ENGINE_API.md section 9): pictures move from the message parts into `images`; greedy decoding
 *  (what the phone measured: 17.8 tok/s); the person's turn streams its words into the chat. */
async function brainChat(e, messages, o = {}, key = 'brain') {   // 3.8: key = which model (its own load on the card)
  const images = [];
  let msgs = messages.map((m) => (Array.isArray(m.content) ? Object.assign({}, m, { content: m.content.map((p) => (p && p.type === 'image' ? (images.push(p.image), { type: 'image' }) : p)) }) : m));
  const opts = { tools: o.tools, maxTokens: o.maxTokens || 256, signal: o.signal };
  const purpose = o.prefix ? String(o.prefix).replace(/^<\|tool_call>call:/, '').replace(/[{\[].*$/s, '').slice(0, 24) : (Array.isArray(o.tools) && o.tools.length ? `plan (${o.tools.length} tools)` : String((messages[0] && messages[0].content) || '').slice(0, 24));
  diag('assistant call', { purpose });
  try { const aj = Q && Q.active && Q.active.job; if (aj) crumb(aj, `assistant: ${purpose}`); } catch (x) { /* */ }   // v024.1: the breadcrumb
  if (o.prefix) opts.prefix = o.prefix;
  if (images.length) opts.images = images;
  const j = Q && Q.active && Q.active.job, plan = o.stream != null ? !!o.stream : !o.prefix && Array.isArray(o.tools) && o.tools.some((t) => t && t.function && t.function.name === 'make_picture');   // 3.8: o.stream says so
  let acc = '';
  const vturn = !!(plan && key === 'brain' && j && j.kind === 'chat' && j.params && j.params.voice);   // a spoken turn: its answer starts with a mood tag (agent.js VOICE_NOTE), always stripped
  const voiced = vturn && !!VOICEIN && VOICEIN.speaks() && (!WEBKIT || !!(S.brainLoad && S.brainLoad.split));   // ... and spoken (never with Juli in one process on WebKit)   // v4: a spoken message gets a spoken answer
  if (o.keepPrefix) opts.keepPrefix = o.keepPrefix;   // v4: the prompt's fixed start is kept for the next answer (llm.js, the prefix snapshot; agent.js asks for it on spoken turns)
  if (j && j.kind === 'chat' && key === 'brain') {   // the voice turn this answer belongs to (a typed turn ends it)
    if (!(j.params && j.params.voice)) { if (VOICE_TURN && VOICE_TURN.sid === j.session) VOICE_TURN = null; }
    else if (!VOICE_TURN || VOICE_TURN.job !== j.id) VOICE_TURN = { sid: j.session, job: j.id, spoke: false, begun: false };
  }
  if (voiced) { if (!VOICE_TURN.begun) { VOICE_TURN.begun = true; VOICEIN.replyBegin(); } else VOICEIN.replyNext(); }
  const spoken = (t) => sayZip(String(t || '').split('<|tool_call>')[0].replace(/<\|[^>]*>/g, ''));   // v4: + a ZIP code digit by digit
  const dn = o.dropNoLive ? (t, final) => { const x = dropNoLive(t, { final }); return x.hold ? '' : x.text || (final ? t : ''); } : (t) => t;   // v4: the forecast was in her note (agent.js)
  if (plan && j && j.session && CH) opts.onToken = (piece) => {
    acc += piece; if (!vturn) return CH.stream(j, dn(acc));
    let w = wordsSoFar(acc); if (w != null) w = fixCaps(dn(w));   // the mood tag is never shown; v4: + capitals (Josh's phone, Nov 2: replies in lower case)
    CH.stream(j, w == null ? '' : w);
    if (voiced && w != null) { const s = spoken(w); if (s.trim()) VOICE_TURN.spoke = true; VOICEIN.replyFeed(s); }
  };
  if (key === 'brain' && WARM) { try { await WARM; } catch (x) { /* */ } }   // v4: a voice warm-up still reading in: this answer goes after it
  let r;
  try {
    try { r = await e.chat(msgs, opts); }
    catch (x) { if (!(x && x.code === 'TOO_LONG' && opts.maxTokens > 400)) throw x; opts.maxTokens = 400; acc = ''; r = await e.chat(msgs, opts); }   // a long conversation: a shorter answer fits
  } catch (x) { diag('assistant failed', { purpose, code: (x && x.code) || null, message: String((x && x.message) || x).slice(0, 300) }); throw x; }
  diag('assistant done', Object.assign({ purpose, s: r.timings ? +((r.timings.prefill || 0) + (r.timings.decode || 0)).toFixed(1) : null, promptTokens: r.promptTokens, tokens: r.tokens, enginePeakMB: r.peakMB }, r.snapshot ? { snapshot: r.snapshot } : {}));
  if (!vturn && o.dropNoLive) r.text = dn(r.text || '', true);
  if (vturn) { const t = splitMood(r.text || ''); t.text = fixCaps(dn(t.text, true)); r.text = fixCaps(dn((r.text || '').replace(/^\s*\[[^\]]{1,40}\]\s*:?\s*/, ''), true)); if (voiced) { if (spoken(t.text).trim()) VOICE_TURN.spoke = true; VOICEIN.replyEnd(spoken(t.text)); } if (t.moods.length) diag('voice mode reply', { moods: t.moods.join(' and '), spoken: voiced }); }
  if (plan && j && CH) CH.stream(j, vturn || o.dropNoLive ? (r.text || '') : acc, true);
  S[key === 'brain4' ? 'brain4Last' : 'brainLast'] = { tokPerS: r.tokPerS, prefillTokPerS: r.prefillTokPerS, ttft: r.timings && r.timings.firstToken, tokens: r.tokens, promptTokens: r.promptTokens, peakMB: r.peakMB, snapshot: r.snapshot || null };
  const L = key === 'brain4' ? S.brain4Load : S.brainLoad;
  return { raw: r.text || '', text: r.text || '', usage: { promptTokens: r.promptTokens, completionTokens: r.tokens }, stopReason: r.stopped, timings: r.timings, tokPerS: r.tokPerS,
    tokens: r.tokens, promptTokens: r.promptTokens, peakMB: r.peakMB,
    load: L ? { mode: L.mode || 'resident', drafter: L.drafter, seconds: L.seconds, residentMB: L.residentMB, split: L.split || null, splitError: L.splitError || null } : null };   // 3.8: for Settings › Benchmark
}

// ---- queue events -> the stage (popcorn), the pill, the chat and the queue sheet
function wireQueue() {
  Q.on('added', (j) => { if (S.job && !S.job.id && j.tag && j.tag === S.job.token) S.job.id = j.id; qChanged(j); diag('job added', { kind: j.kind }); });
  Q.on('done', (j) => diag('job done', { kind: j.kind }));
  Q.on('failed', (j) => diag('job failed', { kind: j.kind, code: (j.error && j.error.code) || null, message: String((j.error && j.error.message) || '').slice(0, 400), kills: j.kills || 0 }));

  Q.on('change', (j) => {
    syncStage(j); qChanged(j);
    if ((j.kind === 'chat' || (j.kind === 'nowcast' && j.params && j.params.sid)) && j.status === 'running' && j.session) {   // v4: the voice turn starts with its job (+ the Nowcast's answer) (a reply made in code, such as "Save 10001 as your home ZIP?", is spoken too)
      if (j.params && j.params.voice) { if (!VOICE_TURN || VOICE_TURN.job !== j.id) VOICE_TURN = { sid: j.session, job: j.id, spoke: false, begun: false }; }
      else if (VOICE_TURN && VOICE_TURN.sid === j.session) VOICE_TURN = null;
    }
    if (j.kind === 'chat' && /^(?:done|failed|cancelled)$/.test(j.status)) setTimeout(warmVoice, 400);   // v4: a gap: the voice warm-up
    // v024.1: the breadcrumb: set while a job runs, cleared when it stops (a clean end)
    if (j.status === 'running' && j.kind !== 'mvflf') crumb(j, stepOf(j, j.progress));
    else if (j.status !== 'queued') { const c = ls.get(INFLIGHT, null); if (c && c.id === j.id) ls.set(INFLIGHT, null); }   // queued = put back after a death: kept
  });
  Q.on('progress', (j, p) => {
    if (j.status === 'running') crumb(j, stepOf(j, p));   // v024.1: every new sub-step, with the engine's bytes
    { const L = longParent(j); if (L) { if (S.job && S.job.id === L.id) onProgress(longProgress(S.job, j, p)); else if (S.run && S.run.id === L.id) { const r = S.run, q = longProgress(r, j, p); r.waiting = false; r.p = q; r.frac = Math.max(r.frac, q.frac || 0); renderPill(); } return; } }   // v4: a part of the whole video
    if (S.run && S.run.id === j.id && S.run !== S.job) { const r = S.run; r.waiting = false; r.p = p; r.frac = Math.max(r.frac, p.frac || 0); renderPill(); }
    if (S.job && S.job.id === j.id) onProgress(p);
    if (CH) CH.progress(j, p);
  });
  Q.on('done', onQDone);
  Q.on('failed', onQFailed);
  Q.on('cancelled', onQCancelled);
  Q.on('needs-consent', (j) => onQBlocked(j, 'NO_CONSENT'));
  Q.on('needs-download', (j, model) => onQBlocked(j, 'NOT_DOWNLOADED', model));
  Q.on('blocked', (j) => onQBlocked(j, (j.error && j.error.code) || 'BLOCKED'));
  for (const n of ['idle', 'removed', 'reordered', 'paused', 'resumed-queue']) Q.on(n, () => qChanged());
}
function qChanged(j) { renderPill(); renderQBtn(); syncWake(); if (CH) CH.queueChanged(j); }
/** the queue links (Create under the stage, the Assistant tab, Settings): how many jobs wait or run (chat included); they open the queue sheet */
function renderQBtn() {
  if (!Q) return;
  const n = Q.list({ includeTerminal: false }).filter((j) => j.root === j.id).length, t = n ? `Queue · ${n} ${Q.paused ? 'paused' : n === 1 ? 'job' : 'jobs'}` : 'Queue';
  for (const id of ['c-queue', 'as-queue']) { const b = $(id); b.hidden = !n; b.querySelector('span').textContent = t; b.setAttribute('aria-label', `${t}. Show the queue.`); }
  if (S.tab === 'settings') $('s-qstate').textContent = Q.readOnly ? 'Open in another tab' : `${Q.paused ? 'Paused' : Q.active ? 'Working' : 'Ready'}${n ? ` · ${n}` : ''}`;
}
/** a queue job as the stage / pill record (the same shape v018's S.job had) */
function jobView(j) {
  const rec = CJ.get(j.id), media = mediaOfKind(j.kind), P = j.params || {};
  const params = (rec && rec.params) || P.ui || { media, kind: j.kind, prompt: P.prompt || P.title || P.idea || P.tags || '', width: P.width || 0, height: P.height || 0, frames: P.frames, steps: P.steps, seconds: P.seconds, seed: P.seed };
  const p = j.progress || { phase: 'load', step: 0, steps: media === 'audio' ? 8 : media === 'video' ? 4 : (P.steps || 4), etaSeconds: null };
  return { id: j.id, origin: isCreateJob(j) ? 'create' : 'assistant', kind: j.kind, mk: j.kind === 'restylelong' ? 'video' : KEY_OF[Q.modelOf(j)] || null, media, params, input: rec ? rec.input : null, srcs: rec ? rec.srcs : null,   // v4: the whole video's model is its parts'
    sub: 'running', armed: false, waiting: j.status !== 'running', p, frac: (j.progress && j.progress.frac) || 0, t0: j.startedAt || Date.now(), at: Date.now() };
}
/** a render started: the stage shows it (popcorn) unless the person is looking at a finished result or an error, then only the pill does */
function syncStage(j) {
  if (!j || j.status !== 'running' || !isStageKind(j.kind)) return;
  { const L = longParent(j); if (L) return syncLong(L, j); }   // v4: a part of a whole-video restyle
  if (S.run && S.run.id === j.id) return;
  if (S.job && S.job.id === j.id) { S.run = S.job; if (S.job.waiting) { S.job.waiting = false; renderWork(true); renderProgress(); } return; }
  const v = jobView(j); S.run = v;
  const create = v.origin === 'create';
  if (!create && (S.phase === 'result' || S.phase === 'error')) { renderPill(); return; }
  if (S.phase === 'result' || S.phase === 'error') dropResult();
  Object.assign(S, { error: null, hot: false, gpuReset: false, popped: 0, job: v });
  if (create && !v.input) refillInput(v, j);
  set({ phase: 'working' }); tick(); syncWake();
}
/** v4: a part of a whole-video restyle started: the stage follows the whole job (the coordinator's view, which part it is on) */
function syncLong(L, part) {
  const P = part.params.part || null;
  if (S.job && S.job.id === L.id) { S.run = S.job; S.job.part = P; if (S.job.waiting) { S.job.waiting = false; renderWork(true); renderProgress(); } return; }
  if (S.run && S.run.id === L.id) { S.run.part = P; return; }
  const v = jobView(L); v.part = P; v.waiting = false; S.run = v;
  if (!isCreateJob(L)) return renderPill();
  if (S.phase === 'result' || S.phase === 'error') dropResult();
  Object.assign(S, { error: null, hot: false, gpuReset: false, popped: 0, job: v });
  if (!v.input) refillInput(v, L);
  set({ phase: 'working' }); tick(); syncWake();
}
/** v4: a part's progress -> the whole job's: the bar over all the parts, the time left for this part and the ones after it */
function longProgress(v, part, p) {
  const P = part.params.part || { i: 0, n: 1 }, L = Q.get(v.id), lp = (L && L.params) || {}, parts = lp.parts || [];
  const rest = parts.slice(P.i + 1).reduce((a, x) => a + estimate({ media: 'video', kind: 'v2v', width: lp.width, height: lp.height, frames: x.frames }), 0) + JOIN_SECONDS;
  v.part = P;
  return Object.assign({}, p, { frac: (P.i + (p.frac || 0)) / P.n, etaSeconds: p.etaSeconds != null ? p.etaSeconds + rest : null, part: P });
}
/** a Create job that resumed after a reload: its pictures come back from the queue's store (for Again / Edit this) */
async function refillInput(v, j) {
  const P = j.params || {};
  try {
    if (j.kind === 'edit') v.input = await Q.getBlob(P.inputKey);
    else if (j.kind === 'animate') v.input = [await Q.getBlob(P.imageKey)];
    else if (j.kind === 'between') v.input = [await Q.getBlob(P.firstKey), await Q.getBlob(P.lastKey)];
    else if (j.kind === 'restyle') { v.input = [await Q.getBlob(P.sourceKey), await Q.getBlob(P.firstKey)]; if (P.soundKey) v.input.push(await Q.getBlob(P.soundKey)); v.srcs = (P.ui && P.ui.sources) || null; }   // v4 (+ its sound)
    else if (j.kind === 'restylelong') { v.input = []; for (const k of P.packKeys || []) v.input.push(await Q.getBlob(k)); v.input.push(await Q.getBlob(P.firstKey)); if (P.soundKey) v.input.push(await Q.getBlob(P.soundKey)); v.srcs = (P.ui && P.ui.sources) || null; }   // v4: the whole video
    if (j.kind === 'animate' || j.kind === 'between' || (j.kind === 'resume' && !(P.ui && P.ui.kind === 'v2v'))) {
      const items = await store.getVideoInputs().catch(() => null);
      if (items) { v.srcs = items.map(({ from, libId, thumb }) => ({ from, libId, thumb })); if (j.kind === 'resume') v.input = items.map((x) => x.blob); }
    }
  } catch (e) { /* Again asks for the pictures */ }
}
async function onQDone(j) {
  if (longParent(j)) return qChanged(j);   // v4: a part of the whole video: the whole job goes on (the next part, or the join)
  if (S.run && S.run.id === j.id) S.run = null;
  if (!isStageKind(j.kind)) return qChanged(j);   // chat and the music-video coordinator: the agent posts its own message
  if (isCreateJob(j)) return createDone(j);
  // an assistant render: the chat shows it, and the Library gets it from the agent's 'result' message (after its review)
  S.popped = Date.now(); clearTimeout(poppedT); poppedT = setTimeout(renderPill, POPPED_MS + 50);
  if (S.job && S.job.id === j.id) { if (pop) pop.finish(); S.job = null; set({ phase: 'ready' }); }
  syncWake(); renderPill();
}
/** a Create job finished: v018's result on the stage + the Library, then the queue forgets it */
async function createDone(j) {
  const rec = CJ.get(j.id) || {}, r = j.result || {}, mine = S.job && S.job.id === j.id;
  const params = rec.params || (j.params && j.params.ui) || {};
  let input = rec.input || (mine ? S.job.input : null);
  const key = (r.image || r.video || {}).blobKey, blob = key ? await Q.getBlob(key).catch(() => null) : null;
  CJ.delete(j.id);
  if (params.sty && params.media !== 'video' && !mine) { if (blob) styFrameDone(Object.assign({ blob }, r), params, false); Q.remove(j.id).catch(() => {}); return; }   // v4: a restyle's first frame
  if (j.kind === 'resume' && mine && params.kind !== 'v2v') {
    const items = await store.getVideoInputs().catch(() => null);
    if (items) { S.job.srcs = items.map(({ from, libId, thumb }) => ({ from, libId, thumb })); S.job.input = input = items.map((x) => x.blob); }
  }
  const out = blob ? { blob, width: r.width, height: r.height, seed: r.seed, seconds: r.seconds, frames: r.frames, fps: r.fps, steps: r.steps, resumedFromStep: r.resumedFromStep, partTimes: r.partTimes, sound: r.sound, soundWhy: r.soundWhy } : {};   // v4: + the parts' times, the sound
  if (blob && r.madeOn) out.madeOn = r.madeOn;   // Connection (off in public builds)
  if (mine) jobDone(out, params, input);
  else if (blob) {   // not on the stage (it should always be): straight to the Library
    const res = Object.assign({ id: `${Date.now().toString(36)}-${r.seed}`, media: params.media === 'video' ? 'video' : 'image', prompt: params.prompt, kind: params.kind, createdAt: Date.now(), params }, out);
    if (res.media === 'video') Object.assign(res, { frames: r.frames || params.frames, fps: r.fps || 16, vmode: params.kind || 't2v', sources: null });
    if (res.media === 'video' && params.kind === 'v2v') { Object.assign(res, { sources: params.sources || null, look: params.look || null, follow: params.follow || null, followBy: params.followBy || null, description: params.description || null, parts: params.long ? params.parts.length : null }); styClipDone(); soundNote(params, r); }   // v4
    if (params.quality === '9b') res.model = MODELS.k9b.id;   // v026.6
    if (params.hq && res.media === 'video') { res.hq = params.hq.mode; S.hq = null; saveHq(); }
    saveToLibrary(res);
    if (params.hq && res.media === 'image') hqFrameDone(params, res);
  }
  Q.remove(j.id).catch(() => {});
}
function onQFailed(j) {
  if (longParent(j)) return qChanged(j);   // v4: a part of the whole video: the whole job wakes and says which part stopped
  if (S.run && S.run.id === j.id) S.run = null;
  if (!isStageKind(j.kind)) return qChanged(j);
  if (mvRoot(Q, j)) { if (S.job && S.job.id === j.id) { S.job = null; set({ phase: 'ready' }); } syncWake(); renderPill(); return; }   // v023: a music video's frame / shot: it retries once, then its storyboard asks for a reroll
  const e = Object.assign(new Error((j.error && j.error.message) || 'failed'), { code: j.error && j.error.code });
  if (isCreateJob(j)) {
    const rec = CJ.get(j.id) || {}; CJ.delete(j.id);
    if (j.kind === 'restylelong') return longFailed(j, rec, true);   // v4: kept: it carries on from the part that stopped
    if (S.job && S.job.id === j.id) jobFailed(e, rec.params || (j.params && j.params.ui) || {}, rec.input || S.job.input);
    Q.remove(j.id).catch(() => {});
    return;
  }
  // an assistant job: the agent says what happened in the chat; the pill says Burnt and taps through to the chat
  if (S.job && S.job.id === j.id) {
    S.job = null;
    set({ phase: 'error', error: { title: `The ${NOUN[j.kind] || 'job'} didn't finish.`, note: 'Juli says what happened in the chat.', actions: [['Open the chat', () => go('assistant')]], detail: `${e.code || ''} ${e.message}`.trim(), origin: 'assistant' } });
  }
  syncWake(); renderPill();
}
/** v4: a whole-video restyle stopped (a part failed, the page ended three times in it): kept in the queue, its finished parts with it.
 *  Create says which part and why; Carry on runs that part again (the parts before are kept, never made again); Stop forgets it. */
/** what a stopped whole-video restyle says: {title, note, go (the button), code, detail} */
function longWords(j) {
  const st = j.state || {}, f = st.failed || null, n = (j.params.parts || []).length, i = f ? f.part : Math.min(n, st.next || 0);
  const code = f ? f.code : (j.error && j.error.code) || '';
  const why = /OUT_OF_MEMORY|KILLED/.test(code) ? 'The phone ran out of memory or got hot. ' : code === 'GPU_LOST' ? 'The phone reset its graphics chip. ' : code === 'CANCELLED' ? 'It was stopped. ' : '';
  const kept = i >= n ? 'Every part is made and kept. ' : i === 1 ? 'Part 1 is made and kept. ' : i > 1 ? `Parts 1–${i} are made and kept. ` : '';
  return { title: i >= n ? 'The parts are made, but joining them didn’t finish.' : `Part ${i + 1} of ${n} didn’t finish.`,
    note: `${why}${kept}${i >= n ? 'Join them again to finish the video.' : `Carry on starts again at part ${i + 1}.`}`, go: i >= n ? 'Join them again' : `Carry on from part ${i + 1}`,
    detail: `${code} ${(f && f.message) || (j.error && j.error.message) || ''}`.trim() };
}
function longFailed(j, rec, mine) {
  const P = (rec && rec.params) || (j.params && j.params.ui) || {};
  if (S.run && S.run.id === j.id) S.run = null;
  if (S.job && S.job.id === j.id) S.job = null;
  if (P.sty) styJobEnded(P);
  refreshCk();
  const t = longWords(j);
  set({ phase: 'error', error: { title: t.title, note: t.note, actions: [[t.go, () => longCarryOn(j.id)], ['Stop', () => longDrop(j.id)]], detail: t.detail } });
  syncWake(); if (mine !== false) toStage(); else render();
}
function longCarryOn(id) {
  const j = Q && Q.get(id);
  if (!j || j.status !== 'failed') { set({ phase: 'ready', error: null }); return toast('That restyle is gone.'); }
  if (!consented()) return openLesson();
  if (!ltxOk()) return void openLtx(() => longCarryOn(id));
  if (Q.readOnly) return toast('p0pc0rn is open in another tab. Carry on there, or close that tab first.');
  const P = (j.params && j.params.ui) || {};
  wake.on(); CJ.set(id, { params: P, input: null, srcs: P.sources || null });
  const v = jobView(j); v.waiting = true; v.token = j.tag;
  Object.assign(S, { error: null, hot: false, gpuReset: false, killed: null, vkilled: null, popped: 0, job: v });
  if (S.sty && P.sty) { S.sty.stage = 'clip'; saveSty(); }
  set({ phase: 'working' }); tick(); toStage(); refillInput(v, j);
  Q.retry(id);
}
function longDrop(id) { set({ phase: 'ready', error: null }); (Q ? Q.remove(id).catch(() => {}) : Promise.resolve()).then(() => { refreshCk(); render(); }); }
function onQCancelled(j) {
  if (longParent(j)) return qChanged(j);   // v4: a part of the whole video (the whole job decides)
  if (S.run && S.run.id === j.id) S.run = null;
  { const P = ((CJ.get(j.id) || {}).params) || (j.params && j.params.ui) || {}; if (isCreateJob(j) && P.sty) styJobEnded(P); }   // v4: a restyle's step stopped
  if (isCreateJob(j)) { CJ.delete(j.id); Q.remove(j.id).catch(() => {}); }
  if (S.job && S.job.id === j.id) {   // cancel is silent; the prompt stays
    const create = S.job.origin === 'create', clip = S.job.media === 'video';
    S.job = null; if (clip) refreshCk();
    if (create) ls.set(clip ? 'pf.app.lastVideo' : 'pf.app.lastJob', null);
    set({ phase: 'ready' });
  }
  qChanged(j);
}
function onQBlocked(j, code, model) {
  if (longParent(j)) { Q.cancel(j.id).catch(() => {}); return; }   // v4: a part that cannot run (the agreement, a download): it stops, and the whole job keeps its parts for Carry on
  if (S.run && S.run.id === j.id) S.run = null;
  if (isCreateJob(j)) {   // Make checks the agreement and the download first: a blocked Create job becomes v018's error card and leaves the queue
    const rec = CJ.get(j.id) || {}; CJ.delete(j.id);
    const mine = S.job && S.job.id === j.id;
    Q.cancel(j.id).then(() => Q.remove(j.id)).catch(() => {});
    if (mine) jobFailed(Object.assign(new Error((j.error && j.error.message) || code), { code }), rec.params || (j.params && j.params.ui) || {}, rec.input);
    return;
  }
  if (S.job && S.job.id === j.id) { S.job = null; set({ phase: 'ready' }); }
  if (code === 'NO_CONSENT') { openLesson(); toast('Agree to the lesson, then the queue goes on.'); }
  else if (code === 'NOT_DOWNLOADED') {
    const k = KEY_OF[model];
    if ((j.kind === 'animate' || j.kind === 'between') && done('video') && E.reader && !done('reader')) { toast(`Getting the picture reader first (${fmtSize(S.dl.reader.total)}, one time). The clip starts right after.`); startDownload('reader'); }
    else if (k) toast(`Download ${theNoun(k)} to go on (Settings › Models).`);
  }
  qChanged(j);
}
/** the agent's messages: the chat shows them; a finished result (after its review) also goes to the Library */
function onAgentMessage(sid, m) {
  if (CH) CH.onMessage(sid, m);
  // v4: a voice turn's answer that did not stream (a lookup's answer, a result's line): spoken whole, once
  if (VOICE_TURN && VOICEIN && VOICE_TURN.sid === sid && !VOICE_TURN.spoke && m && m.role === 'assistant' && m.text && m.kind !== 'status' && m.history !== false && !VOICE_PAUSED && (!WEBKIT || !(E.brain && E.brain._loaded) || !!(S.brainLoad && S.brainLoad.split))) { VOICE_TURN.spoke = true; VOICEIN.replySpeak(sayZip(splitMood(m.text).text)); }
  if (m && m.kind === 'result' && m.jobId) saveAssistantResult(m.jobId).catch((e) => { S.saveError = msg(e); toast("Couldn't add it to the Library"); });
}
/** a picture, clip, song or music video the assistant made -> the Library (id 'a-<job>', so a replayed message never saves it twice) */
async function saveAssistantResult(jobId) {
  const j = Q && Q.get(jobId); if (!j || j.status !== 'done') return;
  const id = 'a-' + j.id; if (S.lib.some((m) => m.id === id)) return;
  const r = j.result || {}, P = j.params || {}, wall = j.endedAt && j.startedAt ? (j.endedAt - j.startedAt) / 1000 : (r.seconds || 0);
  const base = { id, createdAt: Date.now(), by: 'assistant' };
  if (j.kind === 'picture' || j.kind === 'edit') {
    const blob = await Q.getBlob(r.image && r.image.blobKey); if (!blob) return;
    return saveToLibrary(Object.assign(base, { media: 'image', blob, width: r.width, height: r.height, seed: r.seed, prompt: P.prompt, seconds: r.seconds, kind: j.kind === 'edit' ? 'i2i' : 't2i', steps: r.steps || P.steps, reference: j.kind === 'edit' ? P.reference : null }));
  }
  if (j.kind === 'clip' || j.kind === 'animate' || j.kind === 'between') {
    const blob = await Q.getBlob(r.video && r.video.blobKey); if (!blob) return;
    return saveToLibrary(Object.assign(base, { media: 'video', blob, width: r.width, height: r.height, seed: r.seed, prompt: P.prompt, seconds: r.seconds, kind: j.kind, frames: r.frames || P.frames, fps: r.fps || 16, vmode: { clip: 't2v', animate: 'i2v', between: 'flf' }[j.kind], sources: null }));
  }
  if (j.kind === 'song') {
    const blob = await Q.getBlob(r.audio && r.audio.blobKey); if (!blob) return;
    const info = SONG_INFO.get(P.seed) || {};
    return saveToLibrary(Object.assign(base, { media: 'audio', kind: 'song', blob, width: 1, height: 1, seed: P.seed, title: P.title || '', prompt: P.title || 'Untitled song', tags: r.tags || P.tags || '', lyrics: r.lyrics || P.lyrics || '',
      bpm: r.bpm || P.bpm || null, key: P.key || null, timeSignature: P.timeSignature || null, duration: r.seconds || P.seconds, seconds: info.wall || wall, lm: info.lm != null ? info.lm : null, codec: info.codec || null,
      research: Array.isArray(P.research) ? P.research : null }));   // v026.2: the Library card shows what was looked up
  }
  if (j.kind === 'say') {   // p0pc0rn Cast: a Cast member's line
    const blob = await Q.getBlob(r.audio && r.audio.blobKey); if (!blob) return;
    return saveToLibrary(Object.assign(base, { media: 'audio', kind: 'say', blob, width: 1, height: 1, seed: P.seed || 0, title: `${P.name}: “${P.line}”`, prompt: P.line, tags: `voice · ${P.name}`, lyrics: P.line,
      duration: r.seconds, seconds: wall, codec: r.codec || null }));
  }
  if (j.kind === 'lipsync') {   // Make them talk (EXPERIMENTAL): a clip WITH its sound
    const blob = await Q.getBlob(r.video && r.video.blobKey); if (!blob) return;
    return saveToLibrary(Object.assign(base, { media: 'video', vmode: 'lipsync', kind: 'lipsync', blob, width: r.width, height: r.height, seed: 0, title: `${P.name || 'Lip-sync'} talks (experimental)`,
      prompt: P.line ? `${P.name}: “${P.line}” (lip-sync, experimental)` : 'Lip-sync (experimental)', seconds: wall, duration: (r.frames || 0) / (r.fps || 16), frames: r.frames, fps: r.fps || 16, sources: null }));
  }
  if (j.kind === 'assemble' && mvRoot(Q, j)) {   // v023: every cut of a song's music video is its own Library item (earlier ones stay)
    const mv = mvRoot(Q, j), M = mv.params, blob = await Q.getBlob(r.video && r.video.blobKey); if (!blob) return;
    const ver = S.lib.filter((m) => m.mvSong && m.mvSong === (M.songId || M.songKey)).length + 1;
    return saveToLibrary(Object.assign(base, { media: 'video', vmode: 'mv', kind: 'musicvideo', blob, width: M.width, height: M.height, seed: 0, title: ver > 1 ? `${M.title || 'Music video'} · version ${ver}` : M.title || 'Music video',
      prompt: M.title || 'Music video', seconds: (j.endedAt - mv.createdAt) / 1000, duration: r.seconds, frames: Math.round((r.seconds || 0) * 16) + 1, fps: 16, sources: null, mvId: mv.id, mvVersion: ver, mvSong: M.songId || M.songKey }));
  }
  if (j.kind === 'musicvideo') {
    const blob = await Q.getBlob(r.videoKey); if (!blob) return;
    const [w, h] = CLIP_SIZE[P.shape === 'wide' ? 'wide' : 'tall'];
    return saveToLibrary(Object.assign(base, { media: 'video', vmode: 'mv', kind: 'musicvideo', blob, width: w, height: h, seed: 0, title: P.title || '', prompt: P.title || P.idea || 'Music video', seconds: wall,
      duration: r.seconds, frames: Math.round((r.seconds || 0) * 16) + 1, fps: 16, sources: null }));
  }
}
/** what the chat UI needs from the app */
function chatApi() {
  return { get Q() { return Q; }, get AG() { return AG; }, get RS() { return RS; }, S, E, MODELS, AS, done, dlTap, dlLine, dlLabel, dlPct, fmtSize, toast, go, openLesson, consented, musicDl, musicTap,
    openLibraryItem, mediaFile, share, saveFile, shrinkPhoto, rights, popcorn, caption, heating, isStageKind, mediaOfKind, NOUN, clock, about, exportOf, shareItem, popTo, phaseText,
    animateSong, openBoard, mvStatus: (j) => mvStatusOf(j),   // v023: Animate on a landed song's bubble, the music video's storyboard and progress
    talkFromSay: (jobId, sid) => { const j = Q && Q.get(jobId); if (j && TALKUI) TALKUI.fromSay(j, sid); },   // p0pc0rn Cast: Lip-sync (experimental) on a say bubble
    readOnly: () => !!(Q && Q.readOnly), agentError: () => S.agentError || null,
    takeVoice: () => !!(VOICEIN && VOICEIN.takeVoice()),   // v4: this message came from the mic (voice mode: she answers out loud)
    routineCard: (m) => (MEM ? MEM.card(m) : null),   // 3.9: a routine (Settings › Juli) as a card
    appCommand: (t) => (APPS && APPS.command ? APPS.command(t) : null),   // v4 (Token Watch): "watch closely", answered in code (makeapp/host.js command)
    openSettings: (id) => { go('settings'); const el = id && $(id); revealSetting(el); if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }), 60); },
    // onboarding: the assistant + starter knowledge as one download, what the first message says about the phone, the Cast's say asks
    // (answered in code, with or without the assistant) and a request handed to Create when the assistant is not on the phone yet
    assistDl, assistTap, isSayAsk: (t) => !!sayIntent(t), toCreate,
    phone: () => ({ android: ANDROID, homeApp: standalone(), free: S.free }),
    act: (id, what) => chatAct(id, what), picOK: () => picOK(), confirm: (title, text, ok, fn) => openSheet(title, text, ok, fn),
    nowcastCard: (m) => ncCard('nowcastCard', m), forecastCard: (m) => (PACKS[MODELS.nowcast.id] ? ncCard('forecastCard', m) : null) };   // v4: the Nowcast's cards under Juli's answers   // 3.9: the chat's action bubbles (ui/chatactions.js), its Delete sheet
}
/** 3.9: an action bubble under a result in Juli's chat: the Library viewer's own path for that Library item (id 'a-<job>'):
 *  Edit this, Animate (a picture into a clip), Clip to another picture */
async function chatAct(id, what) {
  if (S.phase === 'working') { go('create'); return toast('Wait — something is being made'); }
  if (!S.lib.some((m) => m.id === id)) await loadLib();
  const m = S.lib.find((x) => x.id === id), b = m ? await store.getBlob(id).catch(() => null) : null;
  if (!m || !b) return toast("It isn't in the Library yet");
  if (what === 'edit') { S.form.prompt = ''; backToCompose(false); setMode('image'); setPhoto(b, m.width, m.height, false); S.form.size = sizeFor(m.width, m.height) || S.form.size; saveDraft(); syncPrompt(); render(); return; }
  if (!picOK()) return toast('Pictures become clips once the video model and its picture reader are on this phone (Settings › Models).');
  if (what === 'animate') return animateFrom(m, b);
  if (what === 'clip2') return clipToAnother(m, b);
}
/** onboarding: without the assistant, the chat hands a picture or clip request to Create as its prompt (Create needs no assistant) */
function toCreate(prompt, mode) {
  if (S.phase === 'working') { go('create'); return toast('Wait — something is being made'); }
  backToCompose(false); if (mode === 'video') S.vform.src = 'words';
  setMode(mode); F(mode).prompt = String(prompt || '').slice(0, 2000); saveDraft(); syncPrompt(); renderCta();
  toast('Prompt is ready — tap Make');
}
/** open a Library item by id in the viewer (the chat's results are saved there as 'a-<job id>') */
async function openLibraryItem(id) {
  if (!S.lib.some((m) => m.id === id)) await loadLib();
  if (!S.lib.some((m) => m.id === id)) { toast("It isn't in the Library yet"); return false; }
  openViewer(id, false); return true;
}

function onWarning(w, k) {
  if (!w) return;
  if (w.code === 'HOT') { if (S.job && S.job.mk === k) set({ hot: true }); }
  else if (w.code === 'GPU_LOST') set({ gpuReset: true });
  else if (w.code === 'LOW_STORAGE') { S.dl[k].low = true; render(); }
  else if (w.code === 'KILLED_LAST_RUN' && (k === 'music' || k === 'brain')) { S.killedModels = (S.killedModels || []).concat(k); }   // the queue resumes the song (its checkpoint is kept)
  else if (w.code === 'KILLED_LAST_RUN') {
    S.killedModels = (S.killedModels || []).concat(k);
    if (k === 'video') {
      const run = w.lastRun || {}, fam = run.picture || isPic(run.mode) || run.mode === 'v2v' ? 'pic' : 't2v';   // v4: a restyle shares the picture slot
      S.mode = 'video'; S.vkilled = fam; refreshCk();
      if (fam === 'pic' && picOK()) S.vform.src = srcOf(run.mode) === 'words' ? 'pic' : srcOf(run.mode); else if (fam === 't2v') S.vform.src = 'words';
      if (!S.ck[fam]) {   // killed before the first step was saved: offer the same clip again
        const last = ls.get('pf.app.lastVideo'); if (last && last.prompt) restoreVForm(last);
        S.killed = { media: 'video', fam, message: 'The last clip was interrupted (the phone ran out of memory or got hot). Try again, or pick a smaller size.' };
      }
      return render();
    }
    const last = ls.get('pf.app.lastJob'), run = w.lastRun || {};
    S.mode = 'image';
    restoreForm(last && last.prompt ? last : { width: run.w, height: run.h, steps: run.steps });   // the interrupted prompt and size come back
    set({ killed: { media: 'image', message: w.message || 'The last picture was interrupted.', run } });
  }
}
/** the unfinished clips the video engine checkpointed, one per kind ({t2v, pic}: prompt, size, frames, seed, step, mode), unless the
 *  model was deleted since. The two slots never overwrite each other. */
function refreshCk() {
  const v = E.video, gone = ls.get('pf.app.ckGoneAt', 0), ok = (c) => (c && c.prompt && !(gone && !(c.t > gone)) ? c : null);
  let t = null, p = null;
  try { if (v && v.videoCheckpoint) { t = v.videoCheckpoint(picOK() ? 't2v' : undefined); if (picOK()) p = v.videoCheckpoint('picture'); } } catch (e) { /* none */ }
  S.ck = { t2v: ok(t), pic: ok(p) };
}
/** the unfinished clip that belongs to the source now chosen (words -> the text-to-video slot; a picture / two -> the picture slot) */
const ckNow = () => (vsrc() === 'words' ? S.ck.t2v : S.ck.pic);
function dropResult() {
  if (!S.result) return;
  URL.revokeObjectURL(S.result.url); S.result = null; $('st-img').removeAttribute('src');
  const v = $('st-vid'); v.pause(); if (v.hasAttribute('src')) { v.removeAttribute('src'); v.load(); }
}
/** Time estimate: this phone's own history for the size, else the measured times scaled by pixel (x frame) count. */
const tkey = (p) => (p.media === 'video' ? `${p.kind || 't2v'}:${p.width}x${p.height}x${p.frames}` : `${p.kind || 't2i'}:${p.width}x${p.height}x${p.steps}${p.quality === '9b' ? ':9b' : ''}`);
function estimate(p) {
  if (p.media === 'audio') return 90 * (p.seconds || 30) / 30;   // a song: about 1.5 min per 30 s on the phone (estimate; the engine's own ETA takes over)
  if (p.kind === 'assemble' || p.kind === 'musicvideo') return 30;
  const hist = ls.get('pf.app.times', {}), k = tkey(p);
  if (hist[k]) return hist[k];
  if (p.media === 'video' && p.kind === 'v2v' && p.long && Array.isArray(p.parts)) return wholeSeconds(p.parts, (fr) => estimate({ media: 'video', kind: 'v2v', width: p.width, height: p.height, frames: fr }));   // v4: the whole video: every part's own estimate
  if (p.media === 'video' && p.kind === 'v2v') return styleSeconds(p.width, p.height, p.frames);   // v4: a restyle (ui/style_v2v.js) until this phone has its own time
  if (p.media === 'video') return VBASE * (0.15 + 0.85 * (p.width * p.height * p.frames) / (832 * 480 * 81)) * (isPic(p.kind) ? 1.04 : 1) + (isPic(p.kind) ? 3 : 0);   // + reading the picture(s) + ~3 % per step
  if (p.quality === '9b') return k9bSeconds(p.width, p.height, p.kind === 'i2i');   // v026.6
  return (BASE_SECONDS[p.steps] || 45 * p.steps) * (0.25 + 0.75 * (p.width * p.height) / 921600) * (p.kind === 'i2i' ? 1.15 : 1);
}
function learn(p, secs) {
  if (!(secs > 0) || (p && p.remote)) return;   // Connection (off in public builds)
  const k = tkey(p), hist = ls.get('pf.app.times', {});
  hist[k] = Math.round(hist[k] ? 0.5 * hist[k] + 0.5 * secs : secs); ls.set('pf.app.times', hist);
}
function tick() {   // at most 1 Hz, and only while the page is visible
  clearTimeout(tickT);
  if (S.phase !== 'working' || document.hidden) return;
  renderTime(); tickT = setTimeout(tick, 1000);
}
function setDecode(v) { ls.set('pf.app.decodeMB', v); try { if (E.video) E.video.tune({ decodeBudgetMB: v }); } catch (e) { /* next job */ } }

// ------------------------------------------------------------------------------------------------ form + photo + mode
function setMode(k) {
  if (k === S.mode || S.phase === 'working') return;
  if (S.phase === 'result' || S.phase === 'error') { dropResult(); Object.assign(S, { phase: 'ready', error: null }); }
  S.mode = k; ls.set('pf.app.mode', k);
  syncPrompt(); render(); placeAll();
}
function restoreForm(p) {
  if (!p) return;
  if (p.prompt != null) S.form.prompt = p.prompt;
  const id = sizeFor(p.width, p.height); if (id) S.form.size = id;
  if (p.steps === 3 || p.steps === 4) S.form.steps = p.steps;
  saveDraft(); syncPrompt();
}
function restoreVForm(p) {
  if (!p) return;
  if (p.prompt != null) S.vform.prompt = p.prompt;
  const id = vsizeFor(p.width, p.height); if (id) S.vform.size = id;
  if (p.frames) S.vform.len = lenOf(p.frames);
  saveDraft(); syncPrompt();
}
function saveDraft() { clearTimeout(draftT); draftT = setTimeout(() => { ls.set('pf.app.draft', S.form); ls.set('pf.app.vdraft', S.vform); }, 300); }
function syncPrompt() {
  const t = $('prompt'), v = F().prompt; if (t.value !== v) t.value = v;
  t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 144) + 'px';
}
function setPhoto(blob, w, h, pickShape) {
  clearPhoto();
  S.attest = false; $('attest').checked = false; $('attest-more').open = false;   // a new upload is never pre-attested
  S.photo = { blob, w, h, url: URL.createObjectURL(blob) };
  $('st-photo').src = S.photo.url; $('photo-thumb').src = S.photo.url;
  if (pickShape) { const r = w / h; S.form.size = r > 1.1 ? 'wide' : r < 0.9 ? 'tall' : 'square'; saveDraft(); }
  if (S.phase === 'result' || S.phase === 'error') { dropResult(); S.phase = 'ready'; }
  render(); toStage();
}
function clearPhoto() {
  if (S.photo) URL.revokeObjectURL(S.photo.url);
  S.photo = null; S.attest = false; $('attest').checked = false; $('st-photo').removeAttribute('src'); $('photo-thumb').removeAttribute('src');
}
// ---- the clip's pictures (From a picture / Between two pictures)
let vpick = 0;   // the slot a phone photo goes into
/** puts a picture into slot i (0 = the picture / first, 1 = last). A phone photo starts unticked (its own attestation box). */
async function fillSlot(i, blob, w, h, from, libId, o = {}) {
  if (!w || !h) { try { const bm = await createImageBitmap(blob); w = bm.width; h = bm.height; if (bm.close) bm.close(); } catch (e) { return toast("That picture couldn't be opened"); } }
  const thumb = await makeThumb(blob, 160).catch(() => null);
  const old = S.vslots[i]; if (old) URL.revokeObjectURL(old.url);
  S.vslots[i] = { blob, w, h, from, libId: libId || null, url: URL.createObjectURL(blob), thumb, attest: from === 'phone' ? !!o.attest : false };
  if (i === 0 && !o.keepShape) { const r = w / h, z = vsize(S.vform.size), wide = z.w >= z.h; if (r > 1.1 && !wide) S.vform.size = 'wide'; else if (r < 0.9 && wide) S.vform.size = 'tall'; saveDraft(); }
  if (S.phase === 'result' || S.phase === 'error') { dropResult(); S.phase = 'ready'; }
  render(); toStage();
}
function clearSlot(i) {
  const x = S.vslots[i]; if (!x) return;
  if ($('st-photo').getAttribute('src') === x.url) $('st-photo').removeAttribute('src');
  URL.revokeObjectURL(x.url); S.vslots[i] = null; render();
}
function swapSlots() { S.vslots = [S.vslots[1], S.vslots[0]]; render(); toStage(); }
async function pickFromLibrary(i, id) {
  const m = S.lib.find((x) => x.id === id), b = m && await store.getBlob(id).catch(() => null);
  if (!b) return toast("Couldn't open that picture");
  await fillSlot(i, b, m.width, m.height, 'library', id);
}
/** Create > Video with the given source chosen (from the Library viewer or the Library selection) */
function toVideoSrc(src) {
  backToCompose(false); S.vform.src = src; saveDraft();
  if (S.mode !== 'video') setMode('video'); else { syncPrompt(); render(); placeAll(); }
}
async function animateFrom(m, blob) { toVideoSrc('pic'); await fillSlot(0, blob, m.width, m.height, 'library', m.id); toast('Describe what moves, then tap Make'); }
async function clipToAnother(m, blob) { toVideoSrc('two'); await fillSlot(0, blob, m.width, m.height, 'library', m.id); openPicker(1, m.id); }
async function clipBetween(a, b) {
  const ma = S.lib.find((x) => x.id === a), mb = S.lib.find((x) => x.id === b);
  const [ba, bb] = await Promise.all([a, b].map((id) => store.getBlob(id).catch(() => null)));
  if (!ma || !mb || !ba || !bb) return toast("Couldn't open those pictures");
  S.sel = null; toVideoSrc('two');
  await fillSlot(0, ba, ma.width, ma.height, 'library', a); await fillSlot(1, bb, mb.width, mb.height, 'library', b);
  toast('Describe the change, then tap Make');
}
/** a picture clip's sources back into the slots (Library pictures that still exist); returns how many are missing */
async function refillFrom(sources) {
  let miss = 0;
  for (let i = 0; i < sources.length; i++) {
    const x = sources[i], m = x && x.libId && S.lib.find((y) => y.id === x.libId), b = m && await store.getBlob(m.id).catch(() => null);
    if (b) await fillSlot(i, b, m.width, m.height, 'library', m.id, { keepShape: true }); else { clearSlot(i); miss++; }
  }
  return miss;
}
// ---- the Library picker (a picture for a slot)
const PK = { slot: 0, urls: [], clip: false };   // v4: clip = picking a clip for Restyle a clip
const PK_EMPTY = 'No pictures in the Library yet. Make one under Picture, or use a photo from your phone.';
function openPicker(i, exclude) {
  PK.slot = i; PK.clip = false; $('pk-empty').textContent = PK_EMPTY; for (const u of PK.urls) URL.revokeObjectURL(u); PK.urls = [];
  const pics = S.lib.filter((m) => isPicture(m) && m.id !== exclude), two = slotsNeeded() === 2;
  $('pk-title').textContent = two ? (i ? 'Pick the last picture' : 'Pick the first picture') : 'Pick a picture';
  $('pk-note').textContent = pics.length ? 'From your Library. The clip uses the middle of the picture at the size you chose.' : '';
  $('pk-grid').replaceChildren(...pics.map((m) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pk-tile'; b.dataset.id = m.id; b.setAttribute('aria-label', m.prompt || 'Picture');
    const u = URL.createObjectURL(m.thumb); PK.urls.push(u); const img = document.createElement('img'); img.alt = ''; img.src = u; img.loading = 'lazy'; b.append(img); return b;
  }));
  $('pk-empty').hidden = pics.length > 0;
  const w = $('picker'); w.classList.remove('out'); w.hidden = false;
}
function closeWrap(id, after) {
  const w = $(id); if (w.hidden || w.classList.contains('out')) return;
  // v030: reopened while it slid out (openWrap took 'out' away): it stays open (a queued clip's licence sheet reopens within 240 ms)
  w.classList.add('out'); setTimeout(() => { if (!w.classList.contains('out')) return; w.hidden = true; w.classList.remove('out'); if (after) after(); }, reducedMotion() ? 120 : 240);
}
const closePicker = () => closeWrap('picker', () => { for (const u of PK.urls) URL.revokeObjectURL(u); PK.urls = []; $('pk-grid').textContent = ''; });
// ---- a small action menu (a picture's More)
let menuFns = [];
function openMenu(title, items) {
  $('mn-title').textContent = title; menuFns = items.map((x) => x[2]);
  $('mn-list').replaceChildren(...items.map(([label, icon], i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.dataset.i = i;
    b.innerHTML = `<svg class="ic"><use href="${icon}"/></svg>`; b.append(Object.assign(document.createElement('span'), { textContent: label })); return b;
  }));
  const w = $('menu'); w.classList.remove('out'); w.hidden = false; $('mn-list').firstElementChild.focus();
}
function backToCompose(focus) {
  dropResult(); Object.assign(S, { phase: 'ready', error: null });   // phase first: go() renders
  go('create'); render(); syncPrompt();
  if (focus) $('prompt').focus();
}

// ------------------------------------------------------------------------------------------------ library + viewer
const thumbs = new Map();   // id -> object URL, alive only while the Library tab is open
async function loadLib() { try { S.lib = await store.list(); } catch (e) { S.lib = []; } if (S.tab === 'library') renderLibrary(); if (MUSIC) MUSIC.libChanged(); }
async function saveToLibrary(res) {
  try {
    const clip = isClip(res), song = isSong(res);
    const meta = { id: res.id, createdAt: res.createdAt, media: res.media, kind: res.kind, prompt: res.prompt, seed: res.seed, width: res.width, height: res.height,
      seconds: res.seconds, thumb: res.thumb instanceof Blob ? res.thumb : song ? await songCover(res) : clip ? await clipPoster(res) : await makeThumb(res.blob) };   // 3.9: a clip's poster frame (ui/clipthumbs.js; posterOf timed out on the iPhone)   // v4: an HDR copy brings its original's
    if (clip) Object.assign(meta, { frames: res.frames, fps: res.fps, vmode: res.vmode || 't2v', sources: res.sources || null });
    else if (song) Object.assign(meta, { title: res.title || '', tags: res.tags || '', lyrics: res.lyrics || '', bpm: res.bpm || null, key: res.key || null, timeSignature: res.timeSignature || null, lm: res.lm, codec: res.codec || null });
    else Object.assign(meta, { steps: res.steps, reference: res.reference });
    if (clip && res.poster) meta.poster = res.poster;   // 3.9: the thumbnail is a real frame of the clip (made once, reused)
    for (const k of ['by', 'duration', 'title', 'mvId', 'mvVersion', 'mvSong', 'research', 'model', 'hq', 'look', 'follow', 'followBy', 'description', 'hdr', 'parts']) if (res[k] != null && meta[k] == null) meta[k] = res[k];   // v4: + parts (the whole video, restyled in parts)   // v4: + hdr (an HDR copy: its look, its original), a restyle's look and its words   // v026.6: + model, hq   // v026.2: + research   // v023: a music video's job, version and song   // v019: who made it (the assistant), a song / music video's length
    if (res.madeOn && !meta.madeOn) meta.madeOn = { name: String(res.madeOn.name || '').slice(0, 40), gpu: String(res.madeOn.gpu || '').slice(0, 120) };   // Connection (off in public builds)
    await store.add(meta, res.blob);
    S.lib = [meta, ...S.lib.filter((m) => m.id !== meta.id)]; if (S.tab === 'library') renderLibrary();
    if (MUSIC) MUSIC.libChanged();   // 3.9: a new song joins Music (its list and badge)
    SHELL.note('create');   // 3.9: Create's red badge counts the results not seen yet
    toast(store.available ? (song ? (res.kind === 'say' ? 'Saved to Library' : 'Song saved to Library') : isMV(res) ? 'Music video saved to Library' : res.vmode === 'lipsync' ? 'Lip-sync saved to Library (experimental)' : 'Saved to Library') : 'Saved for this visit only');
  } catch (e) {
    toast(e && e.name === 'QuotaExceededError' ? 'Storage full — save to Photos and delete some' : "Couldn't add it to the Library");
  }
}
/** a song's cover for the Library (432 x 432 JPEG): a gradient from the title, the song's real waveform (bars), the title and the length */
async function songCover(res) {
  const W = 432, c = document.createElement('canvas'); c.width = c.height = W; const x = c.getContext('2d');
  let h = 0; for (const ch of String(res.title || res.tags || 'song')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360, g = x.createLinearGradient(0, 0, W, W);
  g.addColorStop(0, `hsl(${hue},62%,30%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},70%,12%)`); x.fillStyle = g; x.fillRect(0, 0, W, W);
  let bars = null;
  try {   // the waveform: peak per bar from the decoded song (works offline; any failure = a calm pattern from the seed)
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
    const buf = await ac.decodeAudioData(await res.blob.arrayBuffer()), d = buf.getChannelData(0), n = 48, step = Math.floor(d.length / n);
    bars = []; for (let i = 0; i < n; i++) { let m = 0; for (let k = i * step; k < (i + 1) * step; k += 64) m = Math.max(m, Math.abs(d[k])); bars.push(m); }
  } catch (e) { bars = Array.from({ length: 48 }, (_, i) => 0.35 + 0.3 * Math.abs(Math.sin((i + 1) * ((res.seed || 7) % 13 + 3) * 0.37))); }
  const top = Math.max(1e-3, ...bars); x.fillStyle = 'rgba(255,255,255,.82)';
  bars.forEach((b, i) => { const bh = Math.max(4, (b / top) * 120); x.fillRect(24 + i * 8, 250 - bh / 2, 5, bh); });
  x.fillStyle = '#fff'; x.font = '600 34px -apple-system, system-ui, sans-serif';
  const words = String(res.title || 'Untitled song').split(/\s+/), lines = []; let ln = '';
  for (const w of words) { const t = ln ? ln + ' ' + w : w; if (x.measureText(t).width > W - 48 && ln) { lines.push(ln); ln = w; } else ln = t; }
  if (ln) lines.push(ln); lines.slice(0, 2).forEach((t, i) => x.fillText(t, 24, 66 + i * 40));
  x.fillStyle = 'rgba(255,255,255,.7)'; x.font = '500 22px -apple-system, system-ui, sans-serif';
  x.fillText(`♪ ${clock(res.duration || 30)}${res.bpm ? ` · ${res.bpm} BPM` : ''}`, 24, W - 28);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
}
function freeThumbs() {
  for (const u of thumbs.values()) URL.revokeObjectURL(u);
  thumbs.clear(); for (const c of $('grid').children) c.textContent = '';
}
const V = { id: null, url: null, blob: null, meta: null, reset: null, tok: 0, srcUrls: [], coverUrl: null };
/** the viewer's action row: a picture gets Save · Animate · Edit this · Delete · More (when clips from pictures exist), a clip Save · Reuse · Delete */
function layoutViewerActions(meta) {
  // v023: a song gets Animate (a music video); a music video made from a song's storyboard gets Edit video (its storyboard)
  const clip = isClip(meta), show = isSong(meta) ? ['v-save', 'v-anim', 'v-del'] : isMV(meta) ? (meta.mvId ? ['v-save', 'v-edit', 'v-del'] : ['v-save', 'v-del']) : clip ? (meta.vmode === 'lipsync' ? ['v-save', 'v-del'] : styleOK() ? ['v-save', 'v-restyle', 'v-reuse', 'v-more', 'v-del'] : ['v-save', 'v-reuse', 'v-more', 'v-del']) : picOK() ? ['v-save', 'v-anim', 'v-edit', 'v-del', 'v-more'] : ['v-save', 'v-reuse', 'v-edit', 'v-del'];
  if (hdrOk(meta)) show.splice(show.indexOf('v-del'), 0, 'v-hdr');   // v4: Make HDR before Delete (a picture or clip that isn't an HDR copy itself)
  $('v-edit').querySelector('span').textContent = isMV(meta) ? 'Edit video' : 'Edit this';
  for (const id of ['v-save', 'v-anim', 'v-reuse', 'v-edit', 'v-del', 'v-more', 'v-talk', 'v-restyle', 'v-hdr']) $(id).hidden = !show.includes(id);   // v4: + Restyle (a clip), Make HDR
  $('v-actions').style.gridTemplateColumns = `repeat(${show.length}, 1fr)`;
}
/** a picture clip's source thumbnails; a Library picture opens on tap */
function renderSources(meta) {
  for (const u of V.srcUrls) URL.revokeObjectURL(u); V.srcUrls = [];
  const list = $('v-src-list'), srcs = isClip(meta) && (isPic(meta.vmode) || meta.vmode === 'v2v') && Array.isArray(meta.sources) ? meta.sources : [];   // v4: + the clip a restyle came from
  $('v-src').hidden = !srcs.length; list.textContent = '';
  if (!srcs.length) return;
  $('v-src-label').textContent = meta.vmode === 'flf' ? 'Between' : meta.vmode === 'v2v' ? `Restyled (${(lookOf(meta.look) || { name: 'a look' }).name}) from` : 'Made from';
  srcs.forEach((x, i) => {
    if (i) list.insertAdjacentHTML('beforeend', '<svg class="ic v-src-arrow" aria-hidden="true"><use href="#i-chevron"/></svg>');
    const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i;
    const inLib = !!(x.libId && S.lib.some((m) => m.id === x.libId)), v2v = meta.vmode === 'v2v', which = v2v ? 'The clip' : meta.vmode === 'flf' ? (i ? 'The last picture' : 'The first picture') : 'The picture';
    b.setAttribute('aria-label', `${which}${inLib ? ': open it' : x.from === 'phone' ? (v2v ? ': a video from your phone' : ': a photo from your phone') : ': no longer in the Library'}`);
    if (x.thumb) { const u = URL.createObjectURL(x.thumb); V.srcUrls.push(u); const img = document.createElement('img'); img.alt = ''; img.src = u; b.append(img); }
    list.append(b);
  });
}
const vMedia = () => (isClip(V.meta) ? $('v-vid') : $('v-img'));   // a song shows its cover in v-img
async function openViewer(id, hint, tile) {
  const show = async () => {
    if (!(await viewerLoad(id))) return;   // superseded by a newer open, or closed meanwhile
    $('viewer').hidden = false; saveHint(hint); document.documentElement.toggleAttribute('data-viewer', true);
  };
  const meta = S.lib.find((m) => m.id === id) || (S.result && S.result.id === id ? S.result : null);
  const ti = tile && tile.querySelector('img'), target = isClip(meta) ? $('v-vid') : $('v-img');
  if (ti && document.startViewTransition && !reducedMotion()) {   // the tile grows into the viewer
    ti.style.viewTransitionName = 'pic';
    const vt = document.startViewTransition(async () => { ti.style.viewTransitionName = ''; target.style.viewTransitionName = 'pic'; await show(); });
    vt.ready.catch(() => {});   // skipped when another open starts; the newer one wins
    vt.finished.finally(() => { target.style.viewTransitionName = ''; });
  } else await show();
}
const loaded = (v) => new Promise((res) => { if (v.readyState >= 2) return res(); const t = setTimeout(res, 3000); v.addEventListener('loadeddata', () => { clearTimeout(t); res(); }, { once: true }); v.addEventListener('error', () => { clearTimeout(t); res(); }, { once: true }); });
async function viewerLoad(id, dir) {
  const tok = ++V.tok, fromResult = S.result && S.result.id === id;
  const meta = S.lib.find((m) => m.id === id) || (fromResult ? S.result : null);
  const blob = fromResult ? S.result.blob : meta && await store.getBlob(id).catch(() => null);
  if (tok !== V.tok) return false;   // a newer open/swipe won: never let a slow load replace it (Delete acts on V.id)
  if (!meta || !blob) { toast(isClip(meta) ? "Couldn't open that clip" : "Couldn't open that picture"); return false; }
  // v026.4: a picture is shown labelled (so a long press saves the labelled file); a clip or song plays its own file and is labelled
  // for Save / Share / Download in the background
  const pic = !isClip(meta) && !isSong(meta), shown = pic ? await tagMedia(blob) : blob;
  if (tok !== V.tok) return false;
  if (V.url) URL.revokeObjectURL(V.url);
  if (V.expUrl) { URL.revokeObjectURL(V.expUrl); V.expUrl = null; }
  if (V.coverUrl) { URL.revokeObjectURL(V.coverUrl); V.coverUrl = null; }
  Object.assign(V, { id, meta, blob, url: URL.createObjectURL(shown), x: { blob, seed: meta.hdr ? `${meta.seed}-hdr` : meta.seed, createdAt: meta.createdAt } });   // the only full-size URL; revoked on close (v4: an HDR copy's file ends -hdr)
  if (shown !== blob) V.x.expFile = mediaFile(shown, meta.seed, meta.createdAt); else exportOf(V.x);
  const clip = isClip(meta), song = isSong(meta), mv = isMV(meta) || (clip && meta.vmode === 'lipsync'), img = $('v-img'), vid = $('v-vid'), aud = $('v-aud');   // Cast: a lip-sync clip has sound
  img.hidden = clip; vid.hidden = !clip; aud.hidden = !song; $('v-lyrics').hidden = !song; $('v-stage').classList.toggle('song', song);
  $('viewer').setAttribute('aria-label', song ? 'Song' : mv ? 'Music video' : clip ? 'Clip' : 'Picture');
  if (!song && aud.hasAttribute('src')) { aud.pause(); aud.removeAttribute('src'); aud.load(); }
  if (song) {   // v019: the song's cover + a player; title, style and lyrics below
    if (vid.hasAttribute('src')) { vid.pause(); vid.removeAttribute('src'); vid.load(); }
    V.coverUrl = meta.thumb ? URL.createObjectURL(meta.thumb) : null; if (V.coverUrl) img.src = V.coverUrl; else img.removeAttribute('src'); img.alt = '';
    aud.src = V.url; aud.setAttribute('aria-label', `Play ${meta.title || 'the song'}`);
    $('v-lyr-tags').textContent = [meta.tags, meta.bpm ? `${meta.bpm} BPM` : '', meta.key || '', meta.timeSignature || ''].filter(Boolean).join(' · ');
    // v026.2: the lyric lines that sing a looked-up fact are marked, and the research list follows (like the chat bubble)
    $('v-lyr-text').replaceChildren(...lyricsEl(meta.lyrics || 'Instrumental', meta.research || [], 'x').childNodes);
    { const old = $('v-research'); if (old) old.remove(); const rl = Array.isArray(meta.research) && meta.research.length ? researchList(meta.research) : null; if (rl) { rl.id = 'v-research'; $('v-lyrics').append(rl); } }
  } else if (clip) {
    img.removeAttribute('src'); vid.src = V.url; vid.setAttribute('aria-label', meta.prompt);
    vid.muted = !mv; vid.loop = !mv;   // a music video plays with its song, once, with controls
    await loaded(vid);
    if (tok !== V.tok) return false;
    vid.controls = mv; vid.play().catch(() => { vid.controls = true; });   // muted loop (SANA clips are silent); Low Power Mode blocks autoplay: native play button
  } else {
    if (vid.hasAttribute('src')) { vid.pause(); vid.removeAttribute('src'); vid.load(); }
    img.src = V.url; img.alt = meta.prompt;
    try { await img.decode(); } catch (e) { /* shows when ready */ }
    if (tok !== V.tok) return false;
  }
  if (!$('v-hint').hidden) saveHint(true);   // a swipe keeps the download link on what is shown
  V.reset && V.reset();
  if (dir && !reducedMotion()) vMedia().animate([{ transform: `translateX(${dir * 48}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
  $('v-prompt').textContent = song || mv ? (meta.title || meta.prompt) : meta.prompt;
  $('v-info').textContent = `${metaLine(meta)}${hdrInfo(meta)} · ${new Date(meta.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;   // v4: " · HDR · Vivid"
  const i = S.lib.findIndex((m) => m.id === id); $('v-count').textContent = i >= 0 ? `${i + 1} of ${S.lib.length}` : '';
  layoutViewerActions(meta); renderSources(meta);
  renderViewerActions();
  return true;
}
/** The Save fallback when there is no share sheet: press-and-hold a picture (a Safari tab also gets a plain download link, never the
 *  Home Screen app, where a download would open a preview with no way back into the app); a clip gets the download link. */
function saveHint(on) {
  const clip = isClip(V.meta) || isSong(V.meta), song = isSong(V.meta);
  $('v-hint').hidden = !on; $('v-hint-pic').hidden = clip; $('v-hint-clip').hidden = !clip;
  $('v-hint-clip').textContent = song ? "This browser can't open the share sheet for songs." : "This browser can't open the share sheet for clips.";
  const a = $('v-dl');
  a.hidden = !on || !V.url || (!clip && standalone());
  if (!a.hidden) {
    // v026.4: the download is the labelled copy (set when it is ready; a picture's V.url already is)
    const x = V.x, f = x && x.expFile, put = () => { if (V.x === x && x.expFile) { V.expUrl = V.expUrl || URL.createObjectURL(x.expFile); a.href = V.expUrl; aiReminder(); } };
    a.href = f && (clip || song) ? (V.expUrl = V.expUrl || URL.createObjectURL(f)) : V.url;
    if (x && !f) exportOf(x).then(put);
    a.download = mediaFile(V.blob, V.meta.seed, V.meta.createdAt).name; a.textContent = song ? 'Download the song' : clip ? 'Download the clip' : 'Or download the file';
  }
}
function closeViewer() {
  $('viewer').hidden = true; document.documentElement.removeAttribute('data-viewer'); if (V.url) URL.revokeObjectURL(V.url);
  if (V.expUrl) { URL.revokeObjectURL(V.expUrl); V.expUrl = null; }
  V.tok++; Object.assign(V, { id: null, url: null, blob: null, meta: null, x: null }); $('v-img').removeAttribute('src');
  if (V.coverUrl) { URL.revokeObjectURL(V.coverUrl); V.coverUrl = null; }
  const au = $('v-aud'); au.pause(); if (au.hasAttribute('src')) { au.removeAttribute('src'); au.load(); }
  for (const u of V.srcUrls) URL.revokeObjectURL(u); V.srcUrls = []; $('v-src-list').textContent = '';
  const v = $('v-vid'); v.pause(); if (v.hasAttribute('src')) { v.removeAttribute('src'); v.load(); }
}
function swipe(dir) {
  const i = S.lib.findIndex((m) => m.id === V.id), next = i >= 0 && S.lib[i + dir];
  if (next) viewerLoad(next.id, dir);
}
async function deleteItem(id) {
  const meta = S.lib.find((m) => m.id === id); if (!meta) return;
  const what = isSong(meta) ? 'song' : isMV(meta) ? 'music video' : isClip(meta) ? 'clip' : 'picture';
  const blob = V.id === id ? V.blob : await store.getBlob(id).catch(() => null);
  try { await store.remove(id); } catch (e) { return toast(`Couldn't delete that ${what}`); }
  const i = S.lib.indexOf(meta), next = S.lib[i + 1] || S.lib[i - 1];
  S.lib = S.lib.filter((m) => m.id !== id);   // everything is keyed by id, never by list position
  if (MUSIC) MUSIC.libChanged();   // 3.9: a deleted song leaves Music's queue and playlists
  const u = thumbs.get(id); if (u) { URL.revokeObjectURL(u); thumbs.delete(id); }
  if (!$('viewer').hidden) { if (next) viewerLoad(next.id); else closeViewer(); }
  if (S.tab === 'library') renderLibrary();
  if (!blob) return toast(`${cap(what)} deleted`);   // nothing to bring back: no Undo offered
  toast(`${cap(what)} deleted`, { action: 'Undo', ms: 5000, onAction: async () => {
    try { await store.add(meta, blob); S.lib = [meta, ...S.lib].sort((a, b) => b.createdAt - a.createdAt); if (S.tab === 'library') renderLibrary(); }
    catch (e) { toast("Couldn't bring it back"); }
  } });
}
const metaLine = (m) => metaLine0(m) + (m && m.madeOn && m.madeOn.name ? ` · made on ${m.madeOn.name}${m.madeOn.gpu ? ` (${m.madeOn.gpu})` : ''}` : '');   // Connection (off in public builds)
const metaLine0 = (m) => (isSong(m) ? `Song · ${clock(m.duration || 0)}${m.bpm ? ` · ${m.bpm} BPM` : ''}${m.key ? ` · ${m.key}` : ''} · seed ${m.seed} · made in ${clock(m.seconds)}`
  : isMV(m) ? `Music video · ${m.width}×${m.height} · ${clock(m.duration || 0)} · made in ${clock(m.seconds)}`
  : isClip(m) ? `${isPic(m.vmode) ? `${SRC[srcOf(m.vmode)].name} · ` : m.vmode === 'v2v' ? `Restyled · ${(lookOf(m.look) || { name: 'a look' }).name} · ${m.parts > 1 ? `${m.parts} parts, Experimental · ` : ''}` : ''}${m.width}×${m.height} · ${lenText(m.frames)} s${m.hq ? ' · 9B frames' : ''} · seed ${m.seed} · ${clock(m.seconds)}` : `${m.width}×${m.height}${m.model === 'flux2-klein-9b' ? ' · Klein 9B' : ''} · seed ${m.seed} · ${clock(m.seconds)}`);

// ------------------------------------------------------------------------------------------------ settings: models + storage
/** the model a running or loaded queue job holds (its files must stay while it works) */
const inUse = (k) => { const m = Q && (Q.active ? Q.modelOf(Q.active.job) : Q.holding && Q.host ? Q.host.currentId : null); return !!m && (KEY_OF[m] === k || (!!ADDON[k] && KEY_OF[m] === ADDON[k])); };   // 3.8: a model held for a follow-up job is in use too
function askDeleteModel(k) {
  if (S.phase === 'working' || ['downloading', 'pausing'].includes(S.dl[k].sub)) return;
  if (inUse(k)) return toast('Wait until the queue is done with it.');
  const m = MODELS[k], st = S.st[k] || {}, bytes = (st.complete ? st.totalBytes : S.dl[k].have) || m.total, rd = k === 'reader', pl = k === 'planner', dr = k === 'drafter', lr = k === 'lora' || k === 'lora2' || k === 'venc', add = rd || pl || dr || lr;
  // an add-on is no use without its model, so it goes with it (said in the sheet): the picture reader with the video model, the planner
  // with music, faster replies (3.8) with the assistant
  const sub = k === 'video' ? 'reader' : k === 'music' ? 'planner' : k === 'brain' ? 'drafter' : k === 'brain4' ? 'drafter4' : null;
  const withSub = !!sub && !!E[sub] && S.dl[sub].have > 0 && !['downloading', 'pausing'].includes(S.dl[sub].sub);
  const withLoras = k !== 'video' ? [] : ['lora', 'lora2', 'venc'].filter((x) => !!E[x] && S.dl[x].have > 0 && !['downloading', 'pausing'].includes(S.dl[x].sub));   // v4: the video LoRAs and the clip reader go with the video model too
  const withLora = withLoras.length > 0;
  const use = { image: 'make pictures', video: 'make clips', brain: 'use Juli', brain4: 'let Juli think and write with it', music: 'make songs', starter: 'look things up offline', voice: 'make your Cast speak (their recordings stay)', lipsync: 'make lip-sync clips', jvoice: 'hear her own voice (voice mode gets it again by itself the next time she speaks)' }[k];
  const text = rd ? `Frees ${fmtSize(bytes)}. It downloads again by itself the next time you make a clip from a picture. Your Library stays.`
    : pl ? `Frees ${fmtSize(bytes)}. Songs still work without it, but the singer follows the words less closely. Your Library stays.`
    : dr ? `Frees ${fmtSize(bytes)}. Juli still works without it, with the same answers, just more slowly. Your chats and Library stay.`
    : lr ? (k === 'venc' ? `Frees ${fmtSize(bytes)}. Style video to video needs it; it downloads again when you ask for it. Your Library stays.` : `Frees ${fmtSize(bytes)}. Clips are made without it until you download it again. Your Library stays.`)
    : `Frees ${fmtSize(bytes + (withSub ? S.dl[sub].have : 0) + withLoras.reduce((a, x) => a + S.dl[x].have, 0))}. You'll need to download it again to ${use}.${withSub ? (sub === 'drafter' ? ' Faster replies go with it.' : sub === 'drafter4' ? ' Its faster replies go with it.' : ` The ${MODELS[sub].noun} goes with it.`) : ''}${withLora ? ` The ${withLoras.map((x) => MODELS[x].noun).join(' and the ')} go${withLoras.length > 1 ? '' : 'es'} with it.` : ''} ${k === 'brain' || k === 'brain4' ? 'Your chats and Library stay.' : 'Your Library stays.'}`;
  const title = rd ? 'Delete the picture reader?' : lr ? `Delete the ${m.noun}?` : pl ? 'Delete the lyrics planner?' : dr ? 'Delete faster replies?' : k === 'brain' ? 'Delete Juli’s model?' : k === 'brain4' ? 'Delete the bigger brain?' : k === 'starter' ? 'Delete the starter knowledge?' : k === 'jvoice' ? 'Delete Juli’s own voice?' : `Delete the ${m.noun} model?`;
  openSheet(title, text, rd ? 'Delete picture reader' : lr ? `Delete ${m.noun}` : pl ? 'Delete lyrics planner' : dr ? 'Delete faster replies' : 'Delete model', async () => {
    if (S.phase === 'working' || inUse(k)) return;
    if (k === 'starter' && RS) RS.starter = null;   // v022: no more starter hits once it is gone
    try { await E[k].deleteModel(); S.st[k] = await E[k].status(); } catch (e) { return toast(rd ? "Couldn't delete the picture reader" : lr ? `Couldn't delete the ${m.noun}` : pl ? "Couldn't delete the lyrics planner" : dr ? "Couldn't delete faster replies" : "Couldn't delete the model"); }
    Object.assign(S.dl[k], dlState(S.dl[k].total), { have: S.st[k].haveBytes || 0, total: S.st[k].totalBytes || S.dl[k].total });
    if (withSub && sub === 'reader') { try { await E.reader.deleteModel(); } catch (e) { /* its own row still shows it */ } }   // the music engine's delete takes the planner's folder with it
    for (const x of withLoras) { try { await E[x].deleteModel(); } catch (e) { /* its own row still shows it */ } await refreshStatus(x); Object.assign(S.dl[x], dlState(S.dl[x].total), { have: (S.st[x] && S.st[x].haveBytes) || 0 }); }   // v4
    if (withSub && (sub === 'drafter' || sub === 'drafter4')) { try { await E[sub].deleteModel(); } catch (e) { /* its own row still shows it */ } }   // 3.8: its own folder (v040: the bigger brain's too)
    if (sub && E[sub]) { await refreshStatus(sub); Object.assign(S.dl[sub], dlState(S.dl[sub].total), { have: (S.st[sub] && S.st[sub].haveBytes) || 0 }); }
    if (k === 'video') { ls.set('pf.app.ckGoneAt', Date.now()); refreshCk(); store.clearVideoInputs().catch(() => {}); }   // both checkpoints went with the folder
    toast(rd ? 'Picture reader deleted' : lr ? `${cap(m.noun)} deleted` : pl ? 'Lyrics planner deleted' : dr ? 'Faster replies deleted' : k === 'brain' ? 'Juli’s model deleted' : k === 'brain4' ? 'Bigger brain deleted' : k === 'jvoice' ? 'Juli’s own voice deleted' : `${cap(m.noun)} model deleted`);
    if (CH) CH.render();
    render(); renderSettings();   // onboarding: no setup screen after the last model goes; Create and the chat offer the downloads
  });
}
/** leftovers inside the video model's folder that nothing needs while no job runs */
const leftovers = () => (S.phase === 'working' ? [] : [{ path: `${VRUN}/frames.rgba`, why: 'frames of an unfinished clip' }, ...(S.ck.t2v ? [] : [{ path: `${VRUN}/latent.bin`, why: 'data of an old unfinished clip' }]),
  { path: `${IRUN}/frames.rgba`, why: 'frames of an unfinished picture clip' },
  ...(S.ck.pic ? [] : ['latent.bin', 'pin0.bin', 'pin1.bin'].map((f) => ({ path: `${IRUN}/${f}`, why: 'data of an old unfinished picture clip' })))]);
const useName = (k) => (k === 'lora' ? 'Video LoRA · SANA-Video 2.0' : k === 'lora2' ? 'Looks LoRA · SANA-Video 2.0' : k === 'venc' ? 'Clip reader · LTX-2.3 encoder' : k === 'brain4' ? 'Bigger brain · NVIDIA Nemotron 3.5 Bolt E4B' : k === 'drafter4' ? 'Bigger brain’s faster replies · Gemma 4 E4B drafter' : k === 'reader' ? 'Picture reader · LTX-2.3 encoder' : k === 'planner' ? 'Lyrics planner · ACE-Step 5 Hz LM' : k === 'drafter' ? 'Faster replies · Gemma 4 drafter' : k === 'brain' ? 'Juli · Gemma 4 E2B' : k === 'music' ? 'Music model · ACE-Step 1.5 turbo' : `${cap(MODELS[k].noun)} model · ${MODELS[k].name}`);
const viaEngine = async (p) => { const st = E.video && E.video.store && E.video.store.st; if (!st) throw new Error('no engine storage'); await st.start(); await st.call('remove', { name: p }); };
async function renderStorage() {
  const tok = ++storTok, list = $('files'), btn = $('s-clean'), why = $('s-clean-why');
  const row = (name, label, val) => { const d = document.createElement('div'); d.className = 'li file'; const a = document.createElement('span'), b = document.createElement('span');
    a.className = 'f-txt'; const n = document.createElement('span'); n.className = 'f-name mono'; n.textContent = name; const l = document.createElement('span'); l.className = 'footnote dim'; l.textContent = label;
    a.append(n, l); b.className = 'dim num'; b.textContent = val; d.append(a, b); return d; };
  try { const e = await navigator.storage.estimate(); $('s-used').textContent = fmtSize(e.usage || 0); $('s-free').textContent = fmtSize(Math.max(0, (e.quota || 0) - (e.usage || 0))); }
  catch (e) { /* estimate unavailable */ }
  if (S.phase === 'working') { list.replaceChildren(Object.assign(document.createElement('p'), { className: 'li footnote dim', textContent: 'The file list appears when nothing is being made.' })); btn.disabled = true; S.files = null; return; }
  let r = null, lib = null;
  try { [r, lib] = await Promise.all([opfs.scan(KEEP, leftovers()), store.usage().catch(() => null)]); } catch (e) { r = null; }
  if (tok !== storTok) return;
  if (S.phase === 'working') return renderStorage();   // a job started during the scan: show the busy note instead
  S.files = r;
  if (!r) { list.replaceChildren(Object.assign(document.createElement('p'), { className: 'li footnote dim', textContent: "This browser can't list its files." })); btn.disabled = true; why.textContent = ''; return; }
  const rows = r.top.map((t) => row(`${t.name}${t.dir ? '/' : ''}`, t.uses.length ? t.uses.map(useName).join(' + ') : 'Not used by p0pc0rn', fmtSize(t.bytes) + (t.unknown ? '+' : '')));
  if (lib) rows.push(row('Library', `${lib.pictures} ${lib.pictures === 1 ? 'picture' : 'pictures'}, ${lib.clips} ${lib.clips === 1 ? 'clip' : 'clips'}${lib.songs ? `, ${lib.songs} ${lib.songs === 1 ? 'song' : 'songs'}` : ''} · browser database`, fmtSize(lib.bytes)));
  if (Q) { let qb = 0; try { for (const b of await Q.db.all('blobs')) qb += b.size || 0; } catch (e) { /* */ } if (tok !== storTok) return; rows.push(row('Juli', 'chats, research and the queue (p0pc0rn-assistant, p0pc0rn-chats, p0pc0rn-research, p0pc0rn-queue) · browser database', fmtSize(qb))); }
  if (!rows.length) rows.push(Object.assign(document.createElement('p'), { className: 'li footnote dim', textContent: 'Nothing stored yet.' }));
  list.replaceChildren(...rows);
  const n = r.remove.length, total = r.remove.reduce((s, i) => s + i.bytes, 0);
  btn.disabled = !n;
  why.textContent = n ? `${n === 1 ? '1 item' : `${n} items`} · ${fmtSize(total)} that no model, the picture reader or the Library uses. You'll see the list first.` : 'Nothing to clean up: every file belongs to a model, the picture reader or the Library.';
}
function askClean() {
  const items = (S.files && S.files.remove) || []; if (!items.length || S.phase === 'working') return;
  const total = items.reduce((s, i) => s + i.bytes, 0);
  openSheet('Clean up other files?', `Only these will be removed (${fmtSize(total)}). The models and the Library stay.`, `Remove ${items.length === 1 ? '1 item' : `${items.length} items`}`, async () => {
    if (S.phase === 'working') return;
    const r = await opfs.removeItems(items, KEEP, viaEngine);
    toast(r.failed.length ? `Freed ${fmtSize(r.freed)} · ${r.failed.length} couldn't be removed` : `Freed ${fmtSize(r.freed)}`);
    renderStorage();
  }, items.map((i) => `${i.path} · ${fmtSize(i.bytes)} · ${i.why}`));
}

// ------------------------------------------------------------------------------------------------ the lesson + the agreement
const N = rights.CARDS.length;   // 6 cards (v015: Josh removed 'Consequences'), then the agreement card
const nb = (t) => t.replace(/(§§?|U\.S\.C\.) /g, '$1\u00a0');   // "§ 106" and "U.S.C. §" never break across lines
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = nb(String(text)); return e; };
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
/** v026.4: a row of links to the full texts (they open in a new tab) */
function linksEl(list) {
  const p = mk('p', 'footnote ls-links');
  list.forEach(([t, h], i) => { const a = mk('a', null, t); a.href = h; a.target = '_blank'; a.rel = 'noopener noreferrer'; if (i) p.append(' · '); p.append(a); });
  return p;
}
function buildLesson() {
  const track = $('ls-track');
  rights.CARDS.forEach((c, i) => {
    const sec = mk('section', 'ls-card'), ul = mk('ul', 'ls-points');
    sec.setAttribute('aria-label', `${i + 1} of ${N}: ${c.title}`);
    for (const p of c.points) ul.append(mk('li', 'callout', p));
    sec.append(mk('p', 'label', `${i + 1} of ${N} · ${c.tag}`), mk('h2', 'title', c.title), ul, ...(c.links ? [linksEl(c.links)] : []), mk('p', 'footnote dim asof', rights.AS_OF));
    track.append(sec);
  });
  const a = mk('section', 'ls-card ls-agree'); a.setAttribute('aria-label', 'Your agreement');
  a.append(mk('p', 'label', 'Your agreement'), mk('h2', 'title', 'I agree'), mk('p', 'body', rights.AGREE), linksEl([['The full use policy', 'USE-POLICY.md'], ['Gemma Prohibited Use Policy', 'licenses/GEMMA_PROHIBITED_USE_POLICY.txt'], ['LTX-2 Attachment A', 'licenses/LICENSE-LTX-2.txt']]), Object.assign(mk('p', 'callout ls-status'), { id: 'ls-status' }),
    mk('p', 'footnote dim', `Saved only on this phone, with the date and the terms version (${rights.TERMS_VERSION}). It is never sent anywhere. New terms mean this lesson again.`),
    mk('p', 'footnote dim asof', rights.AS_OF));
  track.append(a);
  for (let i = 0; i <= N; i++) $('ls-dots').append(mk('i'));
  // a card counts as read once a swipe (or Next) rests on it; a fling across cards does not count them
  track.addEventListener('scroll', () => { clearTimeout(L.settleT); L.settleT = setTimeout(lessonSettle, 90); }, { passive: true });
}
function lessonSettle() {
  const t = $('ls-track'), i = Math.max(0, Math.min(N, Math.round(t.scrollLeft / Math.max(1, t.clientWidth))));
  L.i = i; if (i < N) L.seen.add(i); renderLesson();
}
function openLesson(k) {
  if (!L.open) { L.i = 0; L.seen = new Set([0]); }
  L.open = true; L.dlKey = typeof k === 'string' ? k : KEYS.find((m) => ['downloading', 'pausing'].includes(S.dl[m].sub)) || null;
  $('lesson').hidden = false; document.documentElement.toggleAttribute('data-lesson', true);
  $('ls-track').scrollTo({ left: L.i * $('ls-track').clientWidth });
  renderLesson(); renderLessonDl();
  $('ls-head').setAttribute('tabindex', '-1'); $('ls-head').focus();
}
function closeLesson() {
  L.open = false; $('lesson').hidden = true; document.documentElement.removeAttribute('data-lesson'); render();
}
function lessonGo(i) {
  const t = $('ls-track'); i = Math.max(0, Math.min(N, i));
  t.scrollTo({ left: i * t.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
}
function renderLesson() {
  if (!L.open) return;
  const ag = rights.consent(), last = L.i === N, all = L.seen.size >= N, nx = $('ls-next');
  $('ls-count').textContent = last ? 'Agreement' : `${L.i + 1} of ${N}`;
  [...$('ls-dots').children].forEach((d, i) => { d.classList.toggle('on', i === L.i); d.classList.toggle('seen', L.seen.has(i)); });
  $('ls-back').style.visibility = L.i ? 'visible' : 'hidden';
  nx.textContent = !last ? 'Next' : ag ? 'Done' : 'I agree';
  nx.disabled = last && !ag && !all;
  $('ls-status').textContent = ag ? `You agreed on ${day(ag.agreedAt)} (terms ${ag.terms}).` : all ? 'Tap I agree to start making.' : `Read every card first: ${L.seen.size} of ${N} read.`;
}
function renderLessonDl() {
  if (!L.open) return;
  const k = KEYS.find((m) => ['downloading', 'pausing', 'paused', 'dropped', 'failed'].includes(S.dl[m].sub)) || L.dlKey;
  $('ls-dl').hidden = !k; if (!k) return;
  L.dlKey = k;
  const u = S.dl[k], ready = done(k) && !['downloading', 'pausing'].includes(u.sub), name = dlNoun(k);   // onboarding: "the assistant" too
  $('ls-dl-text').textContent = ready ? `${cap(theNoun(k))} is ready. Finish the lesson to start making.`
    : u.sub === 'downloading' ? `Downloading ${theNoun(k)} · ${dlLine(u, true)}` : u.sub === 'failed' ? `Download stopped · ${dlLine(u, true)}` : `Download paused · ${dlLine(u, true)}`;
  $('ls-dl-fill').style.transform = `scaleX(${(ready ? 1 : dlPct(u)).toFixed(4)})`;
  const b = $('ls-dl-btn'); b.hidden = ready; b.disabled = u.sub === 'pausing'; b.textContent = u.sub === 'downloading' ? 'Pause' : u.sub === 'pausing' ? 'Pausing…' : 'Resume';
}
function lessonNext() {
  if (L.i < N) return lessonGo(L.i + 1);
  if (rights.consent()) return closeLesson();
  if (L.seen.size < N) return renderLesson();   // the button is disabled; a forced tap still does nothing
  if (!rights.agree()) return toast("This browser couldn't save your agreement. Private browsing blocks it.");
  closeLesson(); toast('Thank you. You can make pictures, clips and songs now.');
  if (S.tab === 'settings') renderSettings();
  if (Q) Q.recheck(); if (CH) CH.render();   // jobs that waited for the agreement go on
}
/** Settings > Rights & Copyright: the lesson as a reference, the artist steps, the provider channels and the cases (static, built once) */
function buildRights() {
  const cards = $('r-cards');
  for (const c of rights.CARDS) { const ul = mk('ul', 'ref-list'); for (const p of c.points) ul.append(mk('li', null, p)); cards.append(mk('p', 'ref-h', c.title), ul, ...(c.links ? [linksEl(c.links)] : [])); }
  const ol = mk('ol', 'ref-list');
  rights.STEPS.forEach(([lead, rest], i) => {
    const li = mk('li'); li.append(mk('b', null, lead), ' ' + nb(rest));
    if (i === 2) { const ul = mk('ul', 'ref-sub'); for (const d of rights.DMCA) ul.append(mk('li', null, d)); li.append(ul); }
    ol.append(li);
  });
  $('r-steps').append(mk('p', 'ref-note', 'Artists usually escalate in this order: document, register, notify, then use a tribunal or court. An attorney can say which fits a specific situation.'), ol, mk('p', 'ref-note', rights.COUNTER));
  for (const [sit, ch, note] of rights.CHANNELS) $('r-channels').append(mk('p', 'ref-h', sit), mk('p', null, ch), mk('p', 'dim', note));
  $('r-channels').append(mk('p', 'ref-note', 'Keep a log of every notice sent and every reply, give firm deadlines, and escalate in writing. Artist groups, guilds and collecting societies can coordinate notices and licensing demands with more weight than one person alone.'));
  $('r-cases').append(mk('p', 'ref-note', 'As of October 2026. Case statuses change fast; check each docket.'));
  for (const [name, court, latest, means] of rights.CASES) $('r-cases').append(mk('p', 'ref-h', `${name} · ${court}`), mk('p', null, latest), mk('p', 'dim', means));
  for (const e of document.querySelectorAll('.asof')) e.textContent = rights.AS_OF;
  $('attest-text').textContent = rights.ATTEST;
  for (const [b, t] of rights.MEANS) { const li = mk('li'); li.append(mk('b', null, b), ' ' + nb(t)); $('attest-means').append(li); }
}

// ------------------------------------------------------------------------------------------------ toast + sheet + tabs
let toastT = 0, toastAct = null;
// v4 (weather in chat, assistant/weather.js): the home ZIP (Settings › Juli, or "my ZIP is 10001" in the chat, asked first), only on this
// phone; a weather question without a place uses it first: a ZIP is coarser than the phone's location
const HOME_ZIP = {
  get: () => { const z = String(ls.get('pf.app.homeZip', '') || ''); return /^\d{5}$/.test(z) ? z : null; },
  set: (z) => { const v = /^\d{5}$/.test(String(z || '')) ? String(z) : null; ls.set('pf.app.homeZip', v); const i = $('s-homezip'); if (i) i.value = v || ''; },
};
/** the phone's location (rounded to 0.01 degree, about 1 km) only when this site may already read it (an app made in p0pc0rn asked for
 *  it once): never a permission prompt from the chat (Juli asks where in words instead) */
async function positionIfAllowed() {
  try { if (!navigator.permissions || !navigator.geolocation) return null; if ((await navigator.permissions.query({ name: 'geolocation' })).state !== 'granted') return null; } catch (e) { return null; }
  return new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
    () => res(null), { maximumAge: 10 * 60e3, timeout: 8000, enableHighAccuracy: false }));
}
// v4: the Nowcast (Experimental; nowcast/): its screen, its queue job and Juli's answer load the module only when one of them is needed
let NC = null, NC_P = null, NC_OPEN = null;
const NC_LIC = 'p0pc0rn:nowcast:licence';
function ncGlue() {
  return NC_P || (NC_P = import('./nowcast/nowcast_app.js').then((m) => (NC = m.initNowcast({ Q: () => Q, AG: () => AG, section: $('v-nowcast'),
    ready: () => done('nowcast'), int8Ready: ncInt8, dl: () => { const u = S.dl.nowcast; return u ? { running: u.sub === 'downloading', pct: dlPct(u) } : null; },
    sizeOf: () => (S.st.nowcast && S.st.nowcast.totalBytes) || MODELS.nowcast.total, precision: () => (S.st.nowcast && S.st.nowcast.precision) || 'float',
    download: () => { ls.set(NC_LIC, Date.now()); startDownload('nowcast'); }, research: () => !!AS.research, geo: () => loadGeo(), homeZip: () => HOME_ZIP.get(), position: positionIfAllowed,
    toast, diag, home: () => SHELL.home(), openScreen: (o) => openNowcast(o) })), (e) => { NC_P = null; throw e; }));
}
/** the 8-bit model is on the phone (the float one's fallback) */
const ncInt8 = () => !!(S.st.nowcast && S.st.nowcast.other && S.st.nowcast.other.complete);
/** open the Nowcast screen (o: { lat, lon, label, run, sheet }) */
function openNowcast(o = {}) { NC_OPEN = o; if (S.tab === 'nowcast') { NC_OPEN = null; ncGlue().then((g) => g.open(o)); } else SHELL.open('nowcast'); }
/** a card in Juli's chat that the module draws once it has loaded */
function ncCard(kind, m) { const d = document.createElement('div'); ncGlue().then((g) => { const el = g[kind](m); if (el) d.replaceWith(el); else d.remove(); }, () => d.remove()); return d; }
/** the model's licence and what it is, once, before its download (CC BY 4.0: the credit, the licence link, that it was changed) */
function openNcLicence(then) {
  openSheet('The nowcast model', `DeepMind's DGMR works out the next 90 minutes of rain on this phone: ${fmtSize(S.st.nowcast && S.st.nowcast.totalBytes || MODELS.nowcast.total)}, downloaded once.`, 'Download',
    () => { ls.set(NC_LIC, Date.now()); then(); },
    ['Trained on UK radar: on US radar it is an experiment. It can be wrong, and it never replaces National Weather Service warnings.',
      'Copyright 2021 DeepMind Technologies Limited. Licensed under CC BY 4.0 (creativecommons.org/licenses/by/4.0). Modified by p0pc0rn: weights converted to 16-bit floats or 8-bit integers, run as WebGPU kernels.',
      'Each nowcast also downloads about 7 MB of NOAA radar.'], 'cta');
}
function toast(text, o = {}) {
  $('toast-text').textContent = text; const b = $('toast-btn');
  b.hidden = !o.action; if (o.action) b.textContent = o.action; toastAct = o.onAction || null;
  $('toast').classList.add('on'); clearTimeout(toastT);
  toastT = setTimeout(() => { $('toast').classList.remove('on'); toastAct = null; }, o.ms || 2400);
}
let sheetOk = null;
function openSheet(title, text, ok, onOk, items, tone = 'danger') {   // v4: tone 'cta' for a start (the whole video), 'danger' for a delete
  $('sh-title').textContent = title; $('sh-text').textContent = text; $('sh-ok').textContent = ok; sheetOk = onOk; $('sh-ok').className = `btn ${tone === 'cta' ? 'cta' : 'danger'}`;
  const ul = $('sh-list'); ul.hidden = !items; ul.replaceChildren(...(items || []).map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  const w = $('sheet'); w.classList.remove('out'); w.hidden = false; $('sh-ok').focus();
}
function closeSheet() {
  const w = $('sheet'); if (w.hidden || w.classList.contains('out')) return;
  w.classList.add('out'); setTimeout(() => { w.hidden = true; w.classList.remove('out'); }, reducedMotion() ? 120 : 240);
}
function openWrap(id) { const w = $(id); w.classList.remove('out'); w.hidden = false; }

// ---- v026.4: AI disclosure (Josh: "follow their guidance"; LTX-2 Attachment A item 5, ACE-Step's advice). Every file that leaves the
// app carries ONLY the label AI_TAG in its standard metadata (export.js); the share sheet pre-fills SHARE_TEXT; the first time
// something is shared or downloaded, one line reminds the person to say it is AI-generated. No visible watermark.
const AI_REMIND = 'p0pc0rn:aiReminded';
/** o = {blob, seed, createdAt} (a result, a viewer item, a chat card): its labelled File, made once */
function exportOf(o) {
  if (!o || !o.blob) return Promise.resolve(null);
  return (o.exp = o.exp || tagMedia(o.blob).then((b) => (o.expFile = mediaFile(b, o.seed, o.createdAt))));
}
function aiReminder() {
  if (ls.get(AI_REMIND)) return;
  ls.set(AI_REMIND, new Date().toISOString());
  setTimeout(() => toast('When you post it, say it is AI-generated. The file is labelled “' + AI_TAG + '”.', { ms: 6000 }), 400);
}
/** Save / Share: the labelled copy; the share sheet must open inside the tap, so a copy that is not ready yet is finished first */
function shareItem(o, fallback) {
  const go = (f) => { share(f, () => fallback(f), SHARE_TEXT); aiReminder(); };
  if (o.expFile) return go(o.expFile);
  exportOf(o).then((f) => go(f || mediaFile(o.blob, o.seed, o.createdAt)));
}

// ---- v026.4: the LTX-2 Community License, shown in full with a short summary and accepted on this phone before the video model or the
// picture reader (both carry Lightricks' LTX-2.3 autoencoder) downloads. Stored with the licence's date; a new licence date asks again.
// The Gemma tick (Josh approved, post-launch): the video model reads prompts with Gemma 2, so the same sheet has a separate, unticked box
// for Google's Gemma Prohibited Use Policy. "I accept" needs the full LTX text loaded and the box ticked, each only while it is missing (an
// install that accepted the LTX licence before the tick is asked for the tick alone). The tick is kept in the same record (gemma = the
// policy's date). Asked before every download of the two packs and before every video job (ltxGate), so an older install sees it once.
const LTX_KEYS = new Set(['video', 'reader', 'venc']), LTX_KEY = 'p0pc0rn:ltx-license', LTX_DATE = '2026-01-05';
const GEMMA_PUP_DATE = '2024-02-21';   // the policy's "Last modified" (licenses/GEMMA_PROHIBITED_USE_POLICY.txt)
const ltxRec = () => ls.get(LTX_KEY) || null;
const ltxAccepted = () => { const a = ltxRec(); return !!(a && a.date === LTX_DATE && a.acceptedAt); };
const gemmaAccepted = () => { const a = ltxRec(); return !!(a && a.gemma === GEMMA_PUP_DATE && a.gemmaAcceptedAt); };
const ltxOk = () => ltxAccepted() && gemmaAccepted();
const LTXQ = [];   // who waits for the sheet's answer, [{yes, no}]: a download, a Create video job, a queued video job
function buildLtx() {
  const ul = $('ltx-points'); ul.replaceChildren();
  for (const t of ['Free to use for any purpose, under the use restrictions in Attachment A. They become part of your p0pc0rn terms.',
    'Among them: do not break the law, harm minors, harass or defame anyone, spread harmful false information, or impersonate people without their consent (deepfakes).',
    'Say that content is machine generated when you share or publish it. p0pc0rn labels the files it saves.',
    'Companies with annual revenues of USD 10 million or more need a paid licence from Lightricks.',
    'p0pc0rn’s copy is converted for phones (a “Derivative”); it is given to you only under this licence.']) ul.append(mk('li', null, t));
}
async function openLtx(yes, no) {
  LTXQ.push({ yes: typeof yes === 'function' ? yes : null, no: typeof no === 'function' ? no : null });
  const w = $('ltx'); if (!w.hidden && !w.classList.contains('out')) return;   // already open: this one waits for the same answer
  const a = ltxRec(), hadL = ltxAccepted(), hadG = gemmaAccepted(), box = $('ltx-gemma');
  box.checked = hadG; box.disabled = hadG;   // a new ask always starts unticked
  $('ltx-have').hidden = !hadL; $('ltx-have').textContent = hadL ? `You accepted the LTX-2 licence on ${day(a.acceptedAt)}. Only the Gemma box below is new.` : '';
  $('ltx-gemma-when').hidden = !hadG; $('ltx-gemma-when').textContent = hadG ? `Agreed on ${day(a.gemmaAcceptedAt)}.` : '';
  openWrap('ltx');
  const pre = $('ltx-text'), ok = $('ltx-ok');
  if (!/ATTACHMENT A/.test(pre.textContent)) {
    ok.disabled = true; pre.textContent = 'Loading the licence…';
    try { const r = await fetch('licenses/LICENSE-LTX-2.txt', { cache: 'no-cache' }); pre.textContent = r.ok ? await r.text() : ''; } catch (e) { pre.textContent = ''; }
    if (!/ATTACHMENT A/.test(pre.textContent)) pre.textContent = 'The licence text could not be loaded (licenses/LICENSE-LTX-2.txt). Check Wi-Fi, then open this again.';
  }
  ltxSync(); ok.focus();
}
/** "I accept": the full LTX text is there (unless that licence is already accepted) AND the Gemma box is ticked (unless already agreed) */
function ltxSync() { $('ltx-ok').disabled = !((ltxAccepted() || /ATTACHMENT A/.test($('ltx-text').textContent)) && (gemmaAccepted() || $('ltx-gemma').checked)); }
function closeLtx() { const q = LTXQ.splice(0); closeWrap('ltx'); for (const x of q) if (x.no) x.no(); }   // Not now: nothing downloads, nothing runs
function acceptLtx() {
  ltxSync(); if ($('ltx-ok').disabled) return;
  const a = ltxRec() || {}, now = new Date().toISOString();
  ls.set(LTX_KEY, Object.assign({}, a, { license: 'LTX-2 Community License Agreement', date: LTX_DATE, acceptedAt: ltxAccepted() ? a.acceptedAt : now, gemmaNotice: true,
    gemma: GEMMA_PUP_DATE, gemmaPolicy: 'Gemma Prohibited Use Policy', gemmaAcceptedAt: gemmaAccepted() ? a.gemmaAcceptedAt : now }));
  if (!ltxOk()) return toast("This browser couldn't save your acceptance. Private browsing blocks it.");
  const q = LTXQ.splice(0); closeWrap('ltx'); toast('Licence accepted'); for (const x of q) if (x.yes) x.yes();
}
/** a queued video job (the chat's clips, a music video's shots, Cast's clip from a photo, a resumed clip) waits for the sheet while
 *  something is missing: I accept -> it runs; Not now (or its Cancel) -> it stops, nothing made */
function ltxGate(signal) {
  if (ltxOk()) return Promise.resolve();
  return new Promise((res, rej) => {
    const stop = () => rej(Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORTED' }));
    if (signal) { if (signal.aborted) return stop(); signal.addEventListener('abort', stop, { once: true }); }
    openLtx(res, () => { toast('Nothing was made: the video model needs its licence first.'); stop(); });
  });
}

// ---- v026.6: the FLUX Non-Commercial License for Klein 9B, shown ONCE at its download (Josh: "Upon download. Never again after that"):
// the approved statement, the full licence and I accept; stored with the licence version, shown again only if that version changes
const FLUX_KEY = 'p0pc0rn:flux-license', FLUX_VERSION = '2.1';
const FLUX_LABEL = "FLUX.2 klein 9B is under Black Forest Labs' FLUX Non-Commercial License. BFL says you may use outputs \"for any purpose (including for commercial purposes)\" (§2(d)), and limits use of the model itself to non-commercial purposes (§1(c), §4(a)). Read the licence before using it for business. The 4B model is Apache-2.0.";
const fluxAccepted = () => { const a = ls.get(FLUX_KEY); return !!(a && a.version === FLUX_VERSION && a.acceptedAt); };
let fluxThen = null;
async function openFlux(then) {
  fluxThen = typeof then === 'function' ? then : null;
  $('flux-label').textContent = FLUX_LABEL;
  $('flux-size').textContent = `Download: ${fmtSize(S.dl.k9b.total || MODELS.k9b.total)}, about 30 min on Wi-Fi. Keep p0pc0rn open, the phone plugged in and the screen on; Pause and closing the page both resume.`;
  openWrap('flux');
  const pre = $('flux-text'), ok = $('flux-ok');
  if (!/FLUX Non-Commercial License/.test(pre.textContent) || pre.textContent.length < 5000) {
    ok.disabled = true; pre.textContent = 'Loading the licence…';
    try { const r = await fetch('licenses/LICENSE-FLUX-Non-Commercial-v2.1.md', { cache: 'no-cache' }); pre.textContent = r.ok ? await r.text() : ''; } catch (e) { pre.textContent = ''; }
    if (!/FLUX Non-Commercial License/.test(pre.textContent)) pre.textContent = 'The licence text could not be loaded (licenses/LICENSE-FLUX-Non-Commercial-v2.1.md). Check Wi-Fi, then open this again.';
  }
  ok.disabled = !/FLUX Non-Commercial License/.test(pre.textContent); ok.focus();
}
function closeFlux() { fluxThen = null; closeWrap('flux'); }
function acceptFlux() {
  ls.set(FLUX_KEY, { license: 'FLUX Non-Commercial License', version: FLUX_VERSION, acceptedAt: new Date().toISOString() });
  if (!fluxAccepted()) return toast("This browser couldn't save your acceptance. Private browsing blocks it.");
  const then = fluxThen; closeFlux(); toast('Licence accepted'); if (then) then();
}
// ---- 3.8 (v040): NVIDIA's OpenMDW License Agreement 1.1 for the Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B), shown ONCE before its
// download, as Klein 9B's licence: the statement, the full licence and I accept; stored with the licence version, shown again only if
// that version changes. Its faster replies (Google's Gemma 4 E4B drafter) are Apache-2.0 and come with it. No licence text, no download.
const MDW_KEY = 'p0pc0rn:openmdw-license', MDW_VERSION = '1.1', MDW_FILE = 'licenses/LICENSE-OpenMDW-1.1.txt', MDW_MARK = /OpenMDW/;
const MDW_LABEL = "The Bigger brain is NVIDIA Nemotron 3.5 Bolt E4B, under NVIDIA's OpenMDW License Agreement, version 1.1 (OpenMDW-1.1). NVIDIA post-trained it from Google's Gemma 4 E4B (Apache-2.0); its faster replies are Google's Gemma 4 E4B drafter (Apache-2.0). Read the licence before you use it.";
// v4: voice input (NVIDIA Nemotron 3.5 ASR Streaming) is under the same agreement: its own sheet, accepted once for it (MDW_KEYS)
const MDW_KEYS = { brain4: MDW_KEY, stt: MDW_KEY + ':stt' };
const MDW_STT = "Voice input is NVIDIA Nemotron 3.5 ASR Streaming 0.6B, under NVIDIA's OpenMDW License Agreement, version 1.1 (OpenMDW-1.1). It turns your speech into text on this phone; your voice never leaves the phone and is never kept. p0pc0rn's pack is converted and quantized from NVIDIA's weights and carries the agreement and NVIDIA's notices (Settings › About › Licences and notices). Read the licence before you use it.";
const mdwAccepted = (k = 'brain4') => { const a = ls.get(MDW_KEYS[k] || MDW_KEY); return !!(a && a.version === MDW_VERSION && a.acceptedAt); };
let mdwThen = null, mdwFor = 'brain4';
async function openMdw(then, k = 'brain4') {
  mdwThen = typeof then === 'function' ? then : null; mdwFor = MDW_KEYS[k] ? k : 'brain4';
  $('mdw-title').textContent = mdwFor === 'stt' ? 'Voice input’s licence' : "The Bigger brain's licence";
  $('mdw-label').textContent = mdwFor === 'stt' ? MDW_STT : MDW_LABEL;
  $('mdw-size').textContent = mdwFor === 'stt' ? `Download: ${fmtSize(partTotal('stt'))}. Keep p0pc0rn open, the phone plugged in and the screen on; Pause and closing the page both resume.`
    : `Download: ${fmtSize(partTotal('brain4') + (E.drafter4 ? partTotal('drafter4') : 0))} with its faster replies. Keep p0pc0rn open, the phone plugged in and the screen on; Pause and closing the page both resume.`;
  openWrap('mdw');
  const pre = $('mdw-text'), ok = $('mdw-ok'), full = () => MDW_MARK.test(pre.textContent) && pre.textContent.length >= 1000;
  if (!full()) {
    ok.disabled = true; pre.textContent = 'Loading the licence…';
    try { const r = await fetch(MDW_FILE, { cache: 'no-cache' }); pre.textContent = r.ok ? await r.text() : ''; } catch (e) { pre.textContent = ''; }
    if (!full()) pre.textContent = `The licence text could not be loaded (${MDW_FILE}). Check Wi-Fi, then open this again.`;
  }
  ok.disabled = !full(); ok.focus();
}
function closeMdw() { mdwThen = null; closeWrap('mdw'); }
function acceptMdw() {
  if ($('mdw-ok').disabled) return;
  ls.set(MDW_KEYS[mdwFor], { license: 'OpenMDW License Agreement', version: MDW_VERSION, acceptedAt: new Date().toISOString() });
  if (!mdwAccepted(mdwFor)) return toast("This browser couldn't save your acceptance. Private browsing blocks it.");
  const then = mdwThen; closeMdw(); toast('Licence accepted'); if (then) then();
}
// ---- v026.4: Settings › About › Licences and notices: every licence text in full, the required notices, the copyright lines
const LIC = [
  ['p0pc0rn', [['p0pc0rn License 1.2 · Joshua Hughes', 'LICENSE.md'], ['Use policy (part of your terms)', 'USE-POLICY.md'], ['Trademarks', 'TRADEMARKS.md'], ['Notices', 'NOTICE.md'], ['Model licences', 'MODELS.md']]],
  ['Apache License 2.0', [['The licence text', 'licenses/LICENSE-Apache-2.0.txt'],
    ['FLUX.2 [klein] 4B and the FLUX.2 autoencoder · Black Forest Labs; Qwen3-4B · Alibaba Cloud', 'licenses/LICENSE-Apache-2.0.txt'],
    ['SANA-Video 2.0 5B · Copyright 2024 Nvidia', 'licenses/LICENSE-SANA-Video.txt'],
    ['Video LoRA · LoRA by Josh Hughes, trained on SANA-Video 2.0 (NVIDIA, Apache-2.0)', 'licenses/LICENSE-Apache-2.0.txt'],   // v4
    ['Looks LoRA · LoRA by Josh Hughes, trained on SANA-Video 2.0 (NVIDIA, Apache-2.0)', 'licenses/LICENSE-Apache-2.0.txt'],   // v4 Phase 3
    ['Gemma 4 E2B-it (Juli) · Google', 'licenses/LICENSE-Gemma-4-Apache-2.0.txt'], ['Gemma 4 notice', 'licenses/NOTICE-Gemma-4.md'],
    ['Gemma 4 E2B-it MTP drafter (faster replies) · Google', 'licenses/LICENSE-Gemma-4-Apache-2.0.txt'],
    ['Gemma 4 E4B-it MTP drafter (the Bigger brain’s faster replies) and Gemma 4 E4B (the Bigger brain’s base model) · Google', 'licenses/LICENSE-Gemma-4-Apache-2.0.txt'],
    ['Qwen3-Embedding-0.6B · Alibaba Cloud', 'licenses/LICENSE-Qwen3-Embedding-Apache-2.0.txt'],
    ['Qwen3-TTS (voice) · Copyright 2026 Alibaba Cloud', 'licenses/LICENSE-Qwen3-TTS-Apache-2.0.txt'],
    ['MediaPipe face models (lip-sync, experimental) · Google', 'licenses/LICENSE-MediaPipe-Apache-2.0.txt'],
    ['Qwen3-8B (Klein 9B\u2019s text encoder) · Alibaba Cloud', 'licenses/LICENSE-Apache-2.0.txt'],
    ['Tokenizers in the engine', 'engine/LICENSE-tokenizers.txt'],
    ['Rapier 0.21 (Troll-E’s physics) · Copyright 2020 Dimforge EURL', 'licenses/LICENSE-Rapier-Apache-2.0.txt']]],   // v4
  ['FLUX Non-Commercial License v2.1', [['FLUX.2 [klein] 9B (Better pictures) · Black Forest Labs', 'licenses/LICENSE-FLUX-Non-Commercial-v2.1.md']]],
  ['OpenMDW License Agreement 1.1', [['NVIDIA Nemotron 3.5 Bolt E4B (the Bigger brain) · NVIDIA', 'licenses/LICENSE-OpenMDW-1.1.txt'], ['Bigger brain notice (NVIDIA’s terms, the Gemma 4 base model, what p0pc0rn changed)', 'licenses/NOTICE-Nemotron-Bolt-E4B.md'],
    ['NVIDIA Nemotron 3.5 ASR Streaming 0.6B (voice input) · NVIDIA', 'licenses/LICENSE-OpenMDW-1.1.txt'], ['Voice input notice (NVIDIA’s terms, what p0pc0rn changed)', 'licenses/NOTICE-Nemotron-ASR.md']]],
  ['MIT', [['ACE-Step 1.5 and its lyrics planner · Copyright (c) 2026 ACEStep (their Qwen3 parts: Apache-2.0)', 'licenses/LICENSE-ACE-Step-1.5.txt'],
    ['Music model notices', 'licenses/NOTICE-music.md'],
    ['MuseTalk 1.5 (lip-sync, experimental) · Copyright (c) 2024 Tencent Music Entertainment Group', 'licenses/LICENSE-MuseTalk-MIT.txt'],
    ['Lip-sync use restrictions: CreativeML Open RAIL-M, Attachment A (a precaution, part of your terms)', 'licenses/LICENSE-CreativeML-OpenRAIL-M.txt'],
    ['Whisper tiny (lip-sync) · Copyright (c) 2022 OpenAI', 'licenses/LICENSE-Whisper-MIT.txt'],
    ['sd-vae-ft-mse (lip-sync) · Stability AI', 'licenses/LICENSE-sd-vae-ft-mse-MIT.txt'],
    ['TOON · Copyright (c) 2025-PRESENT Johann Schopplich', 'licenses/LICENSE-TOON-MIT.txt'],
    ['three.js r186 (Troll-E’s 3D drawing) · Copyright © 2010-2026 three.js authors', 'licenses/LICENSE-three.js-MIT.txt'],   // v4
    ['Emscripten (Troll-E’s voice, compiled to WebAssembly) · Emscripten authors', 'licenses/LICENSE-emscripten.txt'],   // 4.0
    ['musl (the C library inside Troll-E’s voice) · Copyright © 2005-2020 Rich Felker, et al.', 'licenses/LICENSE-musl-MIT.txt']]],   // 4.0
  ['BSD-style', [['CMU Flite 2.2 (Troll-E’s voice, and Juli’s fallback voice in voice mode) · Language Technologies Institute, Carnegie Mellon University', 'licenses/LICENSE-flite.txt'],
    ['Its cmu_us_slt voice (the CMU ARCTIC slt voice) · Copyright (c) 2003 Carnegie Mellon University, free for any use', 'licenses/LICENSE-cmu_us_slt.txt'],   // 4.0
    ['CMU Pronouncing Dictionary (Juli’s voice: her pronunciations) · Carnegie Mellon University, BSD 2-Clause', 'licenses/LICENSE-cmudict-BSD-2-Clause.txt']]],   // 4.0
  ['CC BY 4.0', [['Troll-E’s trolley: equipment_trash_trolley_a01 · NVIDIA SimReady (what p0pc0rn changed)', 'licenses/NOTICE-trolley-model.md'], ['Troll-E’s props and open world: the grab arm, trash, supplies, shelters, the leech, the 24 crafted machines · NVIDIA SimReady (what p0pc0rn changed)', 'licenses/NOTICE-trolley-props.md'], ['Nowcast model: DeepMind DGMR · Copyright 2021 DeepMind Technologies Limited (what p0pc0rn changed)', 'licenses/NOTICE-nowcast.md'], ['The licence', 'licenses/LICENSE-CC-BY-4.0.txt']]],   // v4 (4.0: + the Nowcast, the licence text)
  ['LGPL-2.1', [['p5.js 1.11.13 (the Apps tab’s app runtime) · the Processing Foundation and contributors', 'licenses/LICENSE-p5js-LGPL-2.1.txt'], ['p5.js notice', 'licenses/NOTICE-p5js.md']]],
  ['Gemma 2 (the video model reads your words with it)', [['Gemma Terms of Use', 'licenses/GEMMA_TERMS_OF_USE.txt'], ['Gemma Prohibited Use Policy', 'licenses/GEMMA_PROHIBITED_USE_POLICY.txt'], ['Gemma notice', 'licenses/NOTICE-Gemma.txt']]],
  ['LTX-2.3 by Lightricks (the video decoder, the picture reader and the clip reader)', [['LTX-2 Community License Agreement, with Attachment A', 'licenses/LICENSE-LTX-2.txt'], ['Video model notices', 'licenses/NOTICE-video.md']]],
  ['Knowledge', [['Starter pack: CC BY-SA 4.0 (Wikipedia text)', 'https://creativecommons.org/licenses/by-sa/4.0/legalcode'], ['Starter pack notice', 'starter:NOTICE.md']]],
  ['Other', [['Engine notices', 'engine/NOTICE.md'], ['Progress animation notice', 'licenses/NOTICE-progress-animation.md']]],
];
function buildLic() {
  const box = $('lic-list'); box.replaceChildren();
  box.append(Object.assign(mk('p', 'callout'), { id: 'lic-ltx' }), mk('p', 'footnote dim', 'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms'),
    mk('p', 'footnote dim', `Every model file p0pc0rn downloads was converted and quantized from the original weights by the p0pc0rn project. Saved and shared files carry the label “${AI_TAG}”.`));
  for (const [g, rows] of LIC) {
    const l = mk('div', 'list');
    for (const [t, h0] of rows) { const h = h0.startsWith('starter:') ? (PACKS['starter-kb'] || '') + h0.slice(8) : h0, a = mk('a', 'li link'); a.href = h; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.append(mk('span', null, t)); a.insertAdjacentHTML('beforeend', '<svg class="ic"><use href="#i-chevron"/></svg>'); l.append(a); }
    box.append(mk('p', 'label', g), l);
  }
}
function openLic() {
  const a = ls.get(LTX_KEY);
  $('lic-ltx').textContent = (a && a.acceptedAt ? `You accepted the LTX-2 licence (${a.date}) on ${day(a.acceptedAt)}.` : 'The LTX-2 licence is shown for you to accept before the video model, the picture reader or the clip reader downloads.')
    + (a && a.gemma && a.gemmaAcceptedAt ? ` You agreed to the Gemma Prohibited Use Policy (${a.gemma}) on ${day(a.gemmaAcceptedAt)}.` : ' The Gemma Prohibited Use Policy is asked for on the same sheet.');
  openWrap('lic');
}
/** Settings › About › Starter pack credits: the pack's CREDITS.md, checked against its manifest, kept on the phone */
async function openCredits() {
  $('docv-title').textContent = 'Starter pack credits'; $('docv-text').textContent = 'Loading…'; openWrap('docv');
  try {
    const b = E.starter && E.starter.credits ? await E.starter.credits() : null;
    if (!b) throw new Error('no credits');
    $('docv-text').textContent = await b.text();
  } catch (e) { $('docv-text').textContent = `The credits could not be loaded (${(e && e.message) || e}). Check Wi-Fi, then try again.`; }
}
function go(tab) {
  if (tab === S.tab) return;
  const from = S.tab;   // 3.9 shell
  if (S.tab === 'library') { freeThumbs(); S.sel = null; }
  if (S.tab === 'assistant' && CH) CH.hide();
  S.tab = tab;
  for (const v of document.querySelectorAll('#main > .view')) v.hidden = v.id !== 'v-' + tab;   // 3.9: every screen's view (the home screen has none)
  const el = $('v-' + tab); if (el) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
  $('main').scrollTop = 0;
  if (tab === 'library') renderLibrary();
  if (tab === 'settings') renderSettings();
  if (tab === 'apps' && APPS) APPS.render();
  render(); if (tab === 'create') placeAll();
  if (tab === 'create' && S.phase === 'working' && S.job && pop) { pop.start(); popTo(pop, S.job); }   // v019: a job that started on another tab: size the popcorn now that the stage shows
  if (tab === 'assistant' && CH) S.chatShown = CH.show();   // v026.1: the restore waits for the chat
  SHELL.went(from, tab);   // 3.9: the screen layer (it grows from its icon), the dock, badges
}

// ------------------------------------------------------------------------------------------------ rendering
function render() {
  const inApp = ['ready', 'working', 'result', 'error'].includes(S.phase);
  const root = document.documentElement;
  $('gate').hidden = inApp; $('shell').hidden = !inApp;
  root.toggleAttribute('data-busy', S.phase === 'working');
  if (inApp) root.dataset.tab = S.tab; else delete root.dataset.tab;
  if (!inApp) return renderGate();
  $('title').textContent = SHELL.titleOf(S.tab);   // 3.9: every screen's own title (ui/shell.js)
  for (const t of document.querySelectorAll('.tab')) { if (t.dataset.tab === S.tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
  $('cta-bar').hidden = S.tab !== 'create'; $('chat-bar').hidden = S.tab !== 'assistant';
  renderCreate(); renderPill(); renderQBtn(); renderViewerActions();
  if (S.tab === 'settings') renderModels();
  if (S.tab === 'assistant' && CH) CH.render();
}
function renderGate() {
  const show = (id) => { for (const g of ['g-boot', 'g-stop', 'g-home']) $(g).hidden = g !== id; };
  if (S.phase === 'boot') return show('g-boot');
  if (S.phase === 'stop') {
    show('g-stop'); $('g-stop-title').textContent = S.stop.title; $('g-stop-text').textContent = S.stop.text;
    $('g-stop-detail').textContent = S.stop.detail || ''; $('g-stop-detail').parentElement.hidden = !S.stop.detail; return;
  }
  show('g-home');   // setup: iPhone, "Add to Home Screen first"; the models download from the app (the chat's first message, Create, Settings)
}
/** v4: Restyle's "Follow the motion": the person's own pick, else the look's (LOOK_FOLLOW; the help line says when the look chose) */
function renderFollow() {
  const lk = styLookNow(), fo = followFor(lk, S.vform.followPick), own = !S.vform.followPick && !!LOOK_FOLLOW[lk];
  radio($('follow'), fo); const t = STYLE_FOLLOW[fo].help + (own ? ` ${lookOf(lk).name} starts here: its look holds better this way.` : '');
  if ($('follow-help').textContent !== t) $('follow-help').textContent = t;
}
function renderCreate() {
  const ph = S.phase, j = S.job, vid = S.mode === 'video', f = F(), z = vid ? (vsrc() === 'style' ? styZ() : vsize(f.size)) : size(f.size), stage = $('stage');   // v4: a restyle's size is its clip's
  const need = !done(S.mode) && ph !== 'working';
  radio($('kind'), S.mode); $('kind').inert = ph === 'working';
  const src = vsrc(), sty = vid && src === 'style', first = sty ? styFirst() : vid && src !== 'words' ? S.vslots[0] : null;
  { const so = styleOK(); $('vsrc-style').hidden = !so; $('vsrc').classList.toggle('three', !so); $('vsrc').classList.toggle('four', so); }   // v4: + Restyle a clip
  $('vsrc').hidden = !vid || !picOK(); $('vsrc').inert = ph === 'working'; if (vid) radio($('vsrc'), src);
  $('b-killed').hidden = !S.killed || ph === 'working' || S.killed.media !== S.mode;
  if (S.killed) { $('b-killed-text').textContent = S.killed.message; $('k-small').textContent = S.killed.media === 'video' && !VSMALLER[S.vform.size] ? 'Shorter clip' : 'Smaller size'; }
  const ck = vid && !need && ph !== 'working' && !S.ckHidden && !queueHasClip() && ckNow();
  $('b-clip').hidden = !ck; if (ck) renderCk(ck);
  $('need').hidden = !need; if (need) renderNeed();
  $('agree-card').hidden = need || ph === 'working' || consented();
  // stage: empty dot grid | photo with the centre-crop frame | popcorn while working | the result (picture or looping clip)
  let mode = 'empty', ar = z.w / z.h;
  if (ph === 'working') { mode = 'working'; ar = j.params.width > 0 && j.params.height > 0 ? j.params.width / j.params.height : 16 / 9; }
  else if (ph === 'result' && S.result) { mode = 'result'; ar = S.result.width / S.result.height; }
  else if (S.photo && !vid) { mode = 'photo'; ar = S.photo.w / S.photo.h; }
  else if (first) { mode = 'photo'; ar = first.w / first.h; }   // a clip's (first) picture, with the crop the engine will use
  stage.style.setProperty('--ar', ar.toFixed(4));
  if (stage.dataset.mode !== mode) stageMode(stage.dataset.mode, mode);
  $('st-dim').textContent = ph === 'working' && j.media === 'audio' ? `Song · ${j.params.seconds || 30} s` : vid ? `${z.w} × ${z.h} · ${lenLabel(f.len, SRC[src].kind)} s` : `${z.w} × ${z.h}`;
  if (mode === 'photo') {
    const p = vid ? first : S.photo, a = z.w / z.h, sw = Math.min(p.w, p.h * a), sh = sw / a;   // the crop the engine will use
    if ($('st-photo').getAttribute('src') !== p.url) $('st-photo').src = p.url;
    Object.assign($('st-crop').style, { left: `${(p.w - sw) / 2 / p.w * 100}%`, top: `${(p.h - sh) / 2 / p.h * 100}%`, width: `${sw / p.w * 100}%`, height: `${sh / p.h * 100}%` });
  }
  $('work').hidden = ph !== 'working'; $('err').hidden = ph !== 'error' || !S.error; $('res').hidden = mode !== 'result';
  if (ph === 'working') { renderWork(false); renderProgress(); }
  if (ph === 'error' && S.error) renderError();
  if (mode === 'result') { $('res-meta').textContent = metaLine(S.result); $('r-edit').hidden = isClip(S.result); }
  // compose
  $('compose').inert = ph === 'working';
  $('prompt').placeholder = vid ? (src === 'pic' ? 'Describe what moves…' : src === 'two' ? 'Describe the change…' : src === 'style' ? 'What is in the clip and what happens…' : 'Describe a short clip…') : S.photo ? 'What should change?' : 'Describe a picture…';
  $('v-phint').hidden = !vid || src === 'words'; if (vid && src !== 'words') $('v-phint').textContent = HINT[src];
  renderSlots(); renderStyle();
  $('prompt-row').hidden = vid;
  $('add-photo').hidden = !!S.photo; $('photo-chip').hidden = !S.photo;
  $('attest-box').hidden = vid || !S.photo; $('attest').checked = S.attest;
  $('g-shape').hidden = vid; $('g-q').hidden = vid; $('g-detail').hidden = vid || !S.photo;
  $('g-vshape').hidden = !vid || sty; $('g-vlen').hidden = !vid || (sty && styWhole());   // v4: a restyle takes its clip's shape (the whole video: its length too)
  { // v026.6: Klein 9B, once it is on the phone: Create › Picture's model; Create › Video's quality modes (from words)
    const has9 = done('k9b'), zz = vid ? vsize(S.vform.size) : size(S.form.size), edit = !!S.photo;
    $('g-pmodel').hidden = vid || !has9; radio($('pmodel'), S.form.model === '9b' ? '9b' : '4b');
    if (!vid && has9) { $('t-4b').textContent = about(estimate({ kind: edit ? 'i2i' : 't2i', width: zz.w, height: zz.h, steps: S.form.steps })); $('t-9b').textContent = about(k9bSeconds(zz.w, zz.h, edit)); }
    const showQ = vid && has9 && src === 'words';
    $('g-vmode').hidden = !showQ; radio($('vmode'), vq());
    $('v-end-row').hidden = !(showQ && vq() === 'highest'); if ($('v-end').value !== (S.vform.end || '')) $('v-end').value = S.vform.end || '';
    if (showQ) {
      const fr = FRAMES[S.vform.len] || 81, t2v = estimate({ media: 'video', kind: 't2v', width: zz.w, height: zz.h, frames: fr });
      $('t-std').textContent = about(t2v);
      $('t-high').textContent = about(k9bSeconds(zz.w, zz.h) + estimate({ media: 'video', kind: 'i2v', width: zz.w, height: zz.h, frames: fr }));
      $('t-highest').textContent = about(k9bSeconds(zz.w, zz.h) + k9bSeconds(zz.w, zz.h, true) + estimate({ media: 'video', kind: 'flf', width: zz.w, height: zz.h, frames: fr }));
    }
  }
  renderHq(); renderStyReview();
  radio($('sizes'), S.form.size); radio($('steps'), S.form.steps); radio($('detail'), S.form.ref);
  radio($('vsizes'), S.vform.size); radio($('vlen'), S.vform.len); radio($('seedmode'), f.seedMode);
  renderFollow();   // v4: Restyle's "Follow the motion"
  for (const b of $('vlen').querySelectorAll('button[data-v]')) { const t = `${lenLabel(Number(b.dataset.v), SRC[src].kind)} s`, el = b.querySelector('b'); if (el && el.textContent !== t) el.textContent = t; }   // v026.3: 0.5 .. 4.5 s between two pictures
  { const ml = sty && S.sty && S.sty.clip ? S.sty.clip.maxLen : 0; for (const b of $('vlen').querySelectorAll('button[data-v]')) { const off = sty && !!ml && Number(b.dataset.v) > ml; b.disabled = off; b.setAttribute('aria-disabled', String(off)); } }   // v4: a restyle: at most what the clip has
  $('seed').hidden = f.seedMode !== 'fixed'; if ($('seed').value !== f.seed) $('seed').value = f.seed;
  $('v-slow').hidden = !vid || !z.slow;
  if (vid && sty && styWhole()) { const ps = styParts(); $('v-est').textContent = `First frame ${about(estimate({ kind: 'i2i', width: z.w, height: z.h, steps: 4 }))}, then the whole video ${aboutLong(wholeSeconds(ps, (fr) => styEst(S.sty.clip, fr)))} (${ps.length} parts, one after another); the phone slows down when hot.`; }   // v4: the whole video
  else if (vid && sty) $('v-est').textContent = `First frame ${about(estimate({ kind: 'i2i', width: z.w, height: z.h, steps: 4 }))}, then the clip ${aboutLong(estimate({ media: 'video', kind: 'v2v', width: z.w, height: z.h, frames: FRAMES[f.len] }))}; the phone slows down when hot.`;   // v4
  else if (vid) $('v-est').textContent = `${cap(aboutLong(estimate({ media: 'video', kind: SRC[src].kind, width: z.w, height: z.h, frames: FRAMES[f.len] })))}; the phone slows down when hot.`;
  else {
    const kind = S.photo ? 'i2i' : 't2i';
    $('t-best').textContent = `4 steps · ${about(estimate({ kind, width: z.w, height: z.h, steps: 4 }))}`;
    $('t-fast').textContent = `3 steps · ${about(estimate({ kind, width: z.w, height: z.h, steps: 3 }))}`;
  }
  $('tip').hidden = vid || !!ls.get('pf.app.tipSeen');
  renderCta();
}
function renderCk(c) {
  // v4: a restyle runs 3 of its schedule's stages (its checkpoint's step counts the schedule's: 5 from stage 2, or 4 from stage 1)
  const v2v = c.mode === 'v2v', k0 = v2v ? (c.startStep == null ? 1 : c.startStep) : 0, n = (v2v && Array.isArray(c.sigmas) ? c.sigmas.length : 4) - k0, steps = Math.max(0, Math.min(n, (c.step || 0) - k0));
  const p = c.prompt.length > 64 ? c.prompt.slice(0, 62) + '…' : c.prompt, fam = isPic(c.mode) || v2v ? 'pic' : 't2v';
  const where = steps >= n ? `All ${n} steps are done; only developing the frames is left.` : `${steps} of ${n} steps saved.`;
  $('b-clip-text').textContent = `${S.vkilled === fam ? 'It was interrupted. ' : ''}${fam === 'pic' ? `${SRC[srcOf(c.mode)].name} · ` : ''}“${p}” · ${c.width}×${c.height} · ${lenLabel(lenOf(c.frames), c.mode)} s. ${where}${fam === 'pic' ? (v2v ? ' The clip and its first frame are saved with it.' : ' The pictures are saved with it.') : ''}`;
  $('c-go').textContent = steps >= n ? 'Decode the last clip' : `Resume from step ${steps + 1}`;
}
function renderNeed() {
  const k = S.mode, m = MODELS[k], u = S.dl[k], live = u.sub !== 'idle' || u.have > 0;
  if (done(k)) return;
  $('need-title').textContent = { downloading: `Downloading the ${m.noun} model`, pausing: 'Pausing…', paused: 'Download paused', dropped: 'Paused — connection dropped', failed: 'Download stopped' }[u.sub] || `Get the ${m.noun} model`;
  $('need-text').textContent = u.sub === 'failed' ? "Couldn't reach the model server. Check Wi-Fi (and that you are signed in to it), then Resume."
    : S.st[k] && S.st[k].error && !u.have ? "Couldn't reach the model server. Connect to Wi-Fi, then try Download."
    : `${k === 'video' ? 'Makes 1–5 second clips' : 'Makes pictures'} on this phone. One-time download · ${gb(u.total)} · Wi-Fi and a charger recommended; keep this screen open.`;
  $('need-bar').hidden = !live; $('need-fill').style.transform = `scaleX(${dlPct(u).toFixed(4)})`;
  $('need-line').hidden = !live; $('need-line').textContent = dlLine(u, true);
  const b = $('need-go'), dl = u.sub === 'downloading';
  b.disabled = u.sub === 'pausing';
  b.querySelector('use').setAttribute('href', dl ? '#i-pause' : u.have > 0 ? '#i-play' : '#i-download');
  b.querySelector('span').textContent = dlLabel(u);
}
/** the picture slots of a clip from a picture (1) or between two pictures (2), rebuilt only when what they hold changes */
function renderSlots() {
  const vid = S.mode === 'video', n = slotsNeeded(), box = $('vpics');
  box.hidden = !vid || !n;
  if (box.hidden) { $('vattests').hidden = true; return; }
  for (const el of box.querySelectorAll('.vslot')) {
    const i = Number(el.dataset.i), x = S.vslots[i]; el.hidden = i >= n; if (el.hidden) continue;
    const name = n === 2 ? (i ? 'Last picture' : 'First picture') : 'Picture', key = `${n}|${x ? x.url : ''}`;
    if (el.dataset.key === key) continue;
    el.dataset.key = key; el.textContent = ''; el.classList.toggle('filled', !!x);
    const th = document.createElement('div'); th.className = 'vs-thumb' + (x ? '' : ' none');
    if (x) { const img = document.createElement('img'); img.alt = ''; img.src = x.url; th.append(img); } else th.innerHTML = '<svg class="ic"><use href="#i-photo-plus"/></svg>';
    const tx = document.createElement('div'); tx.className = 'vs-txt';
    tx.append(mk('p', 'vs-name', name), mk('p', 'footnote dim', x ? (x.from === 'library' ? 'From your Library' : 'A photo from your phone')
      : n === 2 ? (i ? 'The clip ends on it.' : 'The clip starts on it.') : 'The clip starts on it.'));
    if (!x) {
      const bt = mk('div', 'vs-btns');
      bt.innerHTML = '<button class="btn sm" type="button" data-act="lib"><svg class="ic"><use href="#i-grid"/></svg><span>Library</span></button>'
        + '<button class="btn sm" type="button" data-act="phone"><svg class="ic"><use href="#i-photo-plus"/></svg><span>Photo</span></button>';
      bt.children[0].setAttribute('aria-label', `${name} from the Library`); bt.children[1].setAttribute('aria-label', `${name} from your phone's photos`);
      tx.append(bt);
    }
    el.append(th, tx);
    if (x) { const xb = document.createElement('button'); xb.type = 'button'; xb.className = 'icon-btn vs-x'; xb.dataset.act = 'x'; xb.setAttribute('aria-label', `Remove the ${name.toLowerCase()}`); xb.innerHTML = '<svg class="ic"><use href="#i-x"/></svg>'; el.append(xb); }
  }
  $('vs-swap').hidden = n !== 2 || !(S.vslots[0] && S.vslots[1]);
  renderAttests(); renderReader();
}
/** one attestation box per phone photo in the slots (rights.ATTEST verbatim, unticked for every new photo) */
function renderAttests() {
  const box = $('vattests'), n = slotsNeeded(), list = S.mode === 'video' ? activeSlots().map((x, i) => [x, i]).filter(([x]) => x && x.from === 'phone') : [];
  box.hidden = !list.length;
  const key = `${n}|` + list.map(([x, i]) => `${i}:${x.url}`).join('|');
  if (box.dataset.key !== key) {
    box.dataset.key = key; box.textContent = '';
    for (const [, i] of list) {
      const d = mk('div', 'attest'); d.id = `vattest-box-${i}`;
      if (n === 2) d.append(mk('p', 'label', i ? 'Last picture · your photo' : 'First picture · your photo'));
      const lab = document.createElement('label'); lab.className = 'attest-row'; lab.htmlFor = `vattest-${i}`;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = `vattest-${i}`; cb.dataset.i = String(i);
      lab.append(cb, mk('span', null, rights.ATTEST));
      const det = document.createElement('details'); det.className = 'attest-more'; det.innerHTML = '<summary><span>What this means</span><svg class="ic chev"><use href="#i-chevron"/></svg></summary>';
      const ul = mk('ul', 'means'); for (const [b, t] of rights.MEANS) { const li = mk('li'); li.append(mk('b', null, b), ' ' + nb(t)); ul.append(li); }
      det.append(ul, mk('p', 'footnote dim asof', rights.AS_OF)); d.append(lab, det); box.append(d);
    }
  }
  for (const [x, i] of list) { const cb = $(`vattest-${i}`); if (cb) cb.checked = !!x.attest; }
}
/** the picture reader note on a picture clip while the reader is not on the phone: it downloads by itself on Make */
function renderReader() {
  const el = $('v-reader'), show = S.mode === 'video' && vsrc() !== 'words' && vsrc() !== 'style' && picOK() && !done('reader');   // v4: a restyle lists what it needs itself (renderStyle)
  el.hidden = !show; if (!show) return;
  const u = S.dl.reader, live = ['downloading', 'pausing', 'paused', 'dropped', 'failed'].includes(u.sub), size = fmtSize(u.total);
  $('v-reader-text').textContent = u.sub === 'downloading' ? `Getting the picture reader · ${dlLine(u, true)}${S.pending ? '. Your clip starts when it’s ready.' : ''}`
    : u.sub === 'pausing' ? 'Pausing the picture reader…'
    : u.sub === 'failed' ? `The picture reader's download stopped · ${dlLine(u, true)}. Check Wi-Fi, then Resume.`
    : u.sub === 'dropped' ? `Picture reader paused — connection dropped · ${dlLine(u, true)}. It picks up where it left off.`
    : u.sub === 'paused' ? `Picture reader paused · ${dlLine(u, true)}.`
    : u.have > 0 ? `The picture reader is partly downloaded (${dlLine(u, true)}). It finishes by itself when you tap Make.`
    : `Clips from pictures use the picture reader (${size}, one time). It downloads by itself when you tap Make, and your clip starts right after.`;
  $('v-reader-bar').hidden = !live && !(u.have > 0); $('v-reader-fill').style.transform = `scaleX(${dlPct(u).toFixed(4)})`;
  const b = $('v-reader-go'); b.hidden = !live; b.disabled = u.sub === 'pausing'; b.textContent = u.sub === 'downloading' ? 'Pause' : u.sub === 'pausing' ? 'Pausing…' : 'Resume';
}
function stageMode(from, to) {
  const stage = $('stage');
  stage.dataset.mode = to;
  if (to === 'working') {
    stage.classList.remove('leaving', 'held'); clearTimeout(stage._t);
    if (pop) { pop.start(); popTo(pop, S.job); }
    for (const el of [$('st-fill'), $('st-lead'), $('tab-fill')]) { el.style.transition = 'none'; el.style.transform = el.id === 'st-lead' ? 'translateX(0)' : 'scaleX(0)'; void el.offsetWidth; el.style.transition = ''; }
  }
  if (from === 'working') {   // the popcorn fades away: after a short hold under the reveal on success, at once on cancel / error
    if (pop) pop.stop();
    const held = to === 'result' && !reducedMotion();
    stage.classList.toggle('held', held); stage.classList.add('leaving');
    clearTimeout(stage._t); stage._t = setTimeout(() => stage.classList.remove('leaving', 'held'), held ? 1300 : 700);
  }
  if (to === 'result') {
    const r = S.result, clip = isClip(r), img = $('st-img'), v = $('st-vid');
    img.hidden = clip; v.hidden = !clip;
    stage.classList.remove('still');
    if (clip) { img.removeAttribute('src'); v.src = r.url; v.setAttribute('aria-label', r.prompt); v.play().catch(() => stage.classList.add('still')); }   // muted loop; blocked autoplay -> play badge
    else { img.src = r.url; img.alt = r.prompt; }
    $('st-result').setAttribute('aria-label', clip ? 'Open the clip full screen' : 'Open the picture full screen');
    const acts = $('r-actions');   // develop the result, then stagger in the meta line and actions
    for (const el of [$('st-result'), $('res'), acts]) { el.classList.remove('reveal', 'stagger'); void el.offsetWidth; }
    $('st-result').classList.add('reveal'); $('res').classList.add('stagger'); acts.classList.add('stagger');
  }
}
const nth = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
/** a job that waits for the GPU: chat goes first, then the queue in order (assistant/queue.js runOrder) */
function waitText(j) {
  const a = Q && Q.active && Q.active.job, pos = Q && j.id ? Q.positionOf(j.id) : null;
  if (a && a.id !== j.id && a.kind === 'chat') return 'Waiting for Juli to finish';
  if (a && a.id !== j.id) return pos && pos > 1 ? `Waiting its turn · ${nth(pos)} in line` : 'Waiting its turn · next';
  return 'Getting ready';
}
function caption(j) {
  const p = j.p;
  if (j.sub === 'cancelling') return 'Stopping…';
  if (j.waiting) return waitText(j);
  if (S.gpuReset) return 'Recovering…';
  if (CAST_KINDS.has(j.kind)) return (p && p.message) || 'Getting ready';   // p0pc0rn Cast: the voice and the lip-sync say what they do
  if (j.media === 'audio') {
    if (p.phase === 'denoise') return `Recording · step ${Math.max(1, p.step)} of ${p.steps || 8}`;
    if (p.phase === 'decode') { const t = /part (\d+) of (\d+)/i.exec(p.message || ''); return t ? `Mixing · part ${t[1]} of ${t[2]}` : 'Mixing'; }
    if (p.phase === 'plan') { const t = /(\d+) of (\d+)/.exec(p.message || ''); return t ? `Planning the song · ${t[1]} of ${t[2]}` : 'Planning the song'; }
    return SONG_CAPTION[p.phase] || 'Getting ready';
  }
  if (j.kind === 'assemble') return 'Cutting the music video';
  if (j.media === 'video') {
    if (p.phase === 'denoise') return `Filming · step ${Math.max(1, p.step)} of ${p.steps || 4}`;
    if (p.phase === 'decode') { const t = tileOf(p.message); return t ? `Developing · tile ${t[0]} of ${t[1]}` : 'Developing'; }
    if (p.phase === 'encode') return 'Saving the clip';
    if (p.phase === 'text') return 'Reading your words';
    if (p.phase === 'image') return /pictures/i.test(p.message || '') ? 'Reading your pictures' : 'Reading your picture';
    return /resum/i.test(p.message || '') ? 'Picking up the last clip' : 'Getting ready';
  }
  return p.phase === 'denoise' ? `Painting · step ${Math.max(1, p.step)} of ${p.steps || j.params.steps}` : CAPTION[p.phase] || 'Working';
}
function renderWork(changed) {
  const j = S.job; if (!j) return;
  $('w-phase').textContent = j.waiting || j.sub === 'cancelling' || S.gpuReset ? caption(j) : phaseText(j);   // v026.9: the stage, the whole job's time below
  $('w-hot').hidden = !S.hot;
  const mv = j.id && Q ? mvRoot(Q, Q.get(j.id)) : null;   // v023: a music video's frame, shot or cut says which
  const lg = j.kind === 'restylelong' ? `The whole video, Experimental${j.part ? `: part ${j.part.i + 1} of ${j.part.n}` : ''}. Each part is its own job; the app may reload between them. ` : '';   // v4
  $('w-keep').textContent = (mv ? `Music video: ${mvStatusOf(mv).text}. ` : j.origin === 'assistant' ? `Juli's ${NOUN[j.kind] || 'job'}. ` : lg) + (wake.supported ? 'Keep p0pc0rn open — the screen stays on.' : 'Keep the screen on until it finishes.');
  renderTime();
}
function renderProgress() {
  const j = S.job; if (!j) return;
  $('st-fill').style.transform = $('tab-fill').style.transform = `scaleX(${j.frac.toFixed(4)})`;   // the bar: the whole job
  $('st-lead').style.transform = `translateX(${(j.frac * 100).toFixed(2)}%)`;
  popTo(pop, j);   // v026.9: the popcorn: the current stage, 0 -> 100%
  if (!j.waiting && j.sub !== 'cancelling' && !S.gpuReset) $('w-phase').textContent = phaseText(j);
  renderPill();
}
/** v026.9: a popcorn canvas follows a job: its current stage (0 -> 100% within it); a job still waiting its turn heats */
function popTo(pc, j) { if (!pc || !j) return; if (j.waiting) pc.set(0, true); else pc.stage(stageOf(j, CAST_KINDS.has(j.kind) ? {} : {})); }
/** "Stage 2 of 4 · Painting · step 3/4" (Cast jobs and the cut: their own words) */
function phaseText(j) { return CAST_KINDS.has(j.kind) || j.kind === 'assemble' ? caption(j) : (j.part && j.part.n > 1 ? `Part ${j.part.i + 1} of ${j.part.n} · ` : '') + stageText(stageOf(j)); }   // v4: + the whole video's part
function renderTime() {
  const j = S.job; if (!j) return;
  const now = Date.now(), el = (now - j.t0) / 1000, p = j.p;
  const trusted = p.etaSeconds != null && ((p.phase === 'denoise' && p.step >= 2) || p.phase === 'decode' || p.phase === 'encode');
  const left = trusted ? p.etaSeconds - (now - j.at) / 1000 : Math.max(20, estimate(j.params) - el);
  const txt = j.sub === 'cancelling' ? 'Stopping' : left < 10 ? 'Almost done' : `${about(left)} left`;
  $('w-time').textContent = `${txt} · ${clock(el)} elapsed`;
}
function renderError() {
  const e = S.error;
  $('err-title').textContent = e.title; $('err-note').textContent = e.note || '';
  $('err-detail').textContent = e.detail || ''; $('err-more').hidden = !e.detail;
  const box = $('err-actions'); box.textContent = '';
  for (const [label, fn] of e.actions) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = label; b.onclick = fn; box.append(b); }
  box.hidden = !e.actions.length;
}
function renderCta() {
  const b = $('cta'), j = S.job, working = S.phase === 'working';
  const label = !working ? 'Make' : j.sub === 'cancelling' ? 'Stopping…' : j.armed ? 'Tap again to stop' : 'Cancel';
  b.classList.toggle('stop', working); b.disabled = working && j.sub === 'cancelling';
  const sty = S.mode === 'video' && vsrc() === 'style', pic = S.mode === 'video' && vsrc() !== 'words' && !sty;
  b.setAttribute('aria-disabled', String(!working && (!F().prompt.trim() || !done(S.mode) || !consented() || (S.mode === 'image' && !!S.photo && !S.attest) || (pic && (!slotsReady() || !attestOK())) || (sty && !!styleMissing(styState())))));
  b.querySelector('span').textContent = label; b.querySelector('use').setAttribute('href', working ? '#i-x' : '#i-sparkle');
}
function renderPill() {
  // popcorn words for a job: Heating up (loading, reading, waiting its turn) -> Popping 37% -> Popped! (POPPED_MS) -> Ready. A failed job: Burnt
  // (tap = Create, where the error card says what happened; an assistant job's card points to the chat). Downloads keep their plain wording.
  // v019: the pill follows the queue's running render (S.run) even when the stage keeps a result; the assistant thinking = 'Thinking'.
  const pill = $('pill'), j = S.run || (S.phase === 'working' ? S.job : null), working = !!j, dl = DL.find((k) => S.dl[k].sub === 'downloading');
  const chat = !working && Q && Q.active && (Q.active.job.kind === 'chat' || Q.active.job.kind === 'mvplan');   // v023: the storyboard is the assistant thinking
  const popped = !working && !chat && S.popped && Date.now() - S.popped < POPPED_MS;
  const burnt = !working && S.phase === 'error' && S.error && !S.error.busy;
  const st = working && !j.waiting ? stageOf(j) : null, pct = st ? Math.round(st.frac * 100) : 0, what = working ? (j.media === 'video' ? 'clip' : j.media === 'audio' ? 'song' : 'picture') : '';   // v026.9: N% = the stage
  pill.dataset.tone = burnt ? 'danger' : S.hot ? 'warn' : working || dl || chat ? 'accent' : 'ok';
  pill.querySelector('span').textContent = working ? (j.sub === 'cancelling' ? 'Stopping…' : j.waiting ? 'Heating up' : heating(j) ? `Heating up · ${st.name}` : `Popping ${pct}% · ${st.name}${S.hot ? ' · warm' : ''}`)
    : chat ? 'Thinking' : popped ? 'Popped!' : burnt ? 'Burnt · details' : S.hot ? 'Warm' : dl ? `Downloading · ${Math.floor(dlPct(S.dl[dl]) * 100)}%` : 'Ready';
  pill.setAttribute('aria-label', working ? `A ${what} is being made${j.waiting || heating(j) ? ', getting ready' : `: ${st.name}, ${pct}% of this stage`}. Show it.`
    : chat ? 'Juli is thinking. Show the chat.' : popped ? 'Finished. Show it.' : burnt ? 'The last one did not finish. Show what happened.' : pill.textContent);
}
function renderViewerActions() {
  const busy = S.phase === 'working';
  const mvOk = !!V.meta && (isSong(V.meta) || isMV(V.meta));   // v023: a music video goes through the queue: never blocked by a running job
  for (const id of ['v-reuse', 'v-edit', 'v-anim', 'v-more']) $(id).setAttribute('aria-disabled', String(busy && !mvOk));
}
/** post-launch: a Library tile's shape [w, h]: a song's square cover, else the item's stored size when it is a real size; null = none
 *  stored (an old item): the tile then takes its thumbnail's own shape */
function tileShape(m) {
  if (isSong(m)) return [1, 1];
  const w = Number(m.width), h = Number(m.height);
  return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? [w, h] : null;
}
function renderLibrary() {
  const [a, b] = $('grid').children; a.textContent = b.textContent = ''; let ha = 0, hb = 0;
  for (const m of S.lib) {   // two columns, each item goes to the shorter one (reads newest-first, left to right)
    let u = thumbs.get(m.id); if (!u && m.thumb instanceof Blob) { u = URL.createObjectURL(m.thumb); thumbs.set(m.id, u); }   // 3.9: an item without a thumbnail no longer stops the grid (ui/clipthumbs.js makes one)
    const t = document.createElement('button'); t.type = 'button'; t.className = 'tile'; t.dataset.id = m.id;
    const song = isSong(m), mv = isMV(m), shape = tileShape(m);
    if (shape) t.style.aspectRatio = `${shape[0]} / ${shape[1]}`;   // post-launch: the picture inside takes the same shape (app.css .tile img)
    t.setAttribute('aria-label', song ? `Song, ${Math.round(m.duration || 0)} seconds: ${m.title || m.prompt}` : mv ? `Music video, ${Math.round(m.duration || 0)} seconds: ${m.title || m.prompt}`
      : isClip(m) ? `${m.vmode === 'flf' ? 'Clip between two pictures' : m.vmode === 'i2v' ? 'Clip from a picture' : m.vmode === 'v2v' ? 'Restyled clip' : 'Clip'}, ${lenText(m.frames)} seconds: ${m.prompt}` : m.prompt);
    if (isClip(m)) t.classList.add('clip'); if (song) t.classList.add('song');
    const sn = document.createElement('span'); sn.className = 'selnum num'; sn.setAttribute('aria-hidden', 'true'); t.append(sn);
    const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.alt = ''; if (u) img.src = u; t.append(img);
    if (isClip(m) || song) {   // poster frame (a song: its cover) + a play / note badge with the length
      const badge = document.createElement('span'); badge.className = 'badge num'; badge.setAttribute('aria-hidden', 'true');
      badge.innerHTML = song ? '<svg><use href="#i-note"/></svg>' : '<svg><use href="#i-play"/></svg>'; badge.append(song || mv ? clock(m.duration || 0) : `${lenText(m.frames)} s`); t.append(badge);
    }
    if (m.model === 'flux2-klein-9b' || m.hq) { const q = document.createElement('span'); q.className = 'badge9 num'; q.setAttribute('aria-hidden', 'true'); q.textContent = m.hq ? '9B frames' : '9B'; t.append(q); }   // v026.6
    { const hm = hdrMark(m); if (hm) { t.append(hm); t.setAttribute('aria-label', `${t.getAttribute('aria-label')} (HDR copy)`); } }   // v4: Make HDR's copy
    const r = shape ? shape[1] / shape[0] : 1;   // post-launch: an item without a stored size counts as square (was NaN: every later tile went right)
    if (ha <= hb) { a.append(t); ha += r; } else { b.append(t); hb += r; }
  }
  $('lib-empty').hidden = S.lib.length > 0; $('lib-mem').hidden = store.available;
  try { clipLibrary($('grid'), S.lib, thumbs); } catch (e) { /* the tiles stay as they are */ }   // 3.9: play buttons, and the posters still to make (one at a time, when quiet)
  renderLibSel();
  if (!store.available) $('lib-mem').textContent = store.blocked ? 'Another p0pc0rn tab is open with an older version. Close it, then reopen this one to see your Library.' : "This browser can't keep pictures between visits. Save the ones you like to Photos.";
}
/** Library selection: two pictures, first then last, make a clip between them */
function renderLibSel() {
  const sel = S.sel, grid = $('grid'), pics = S.lib.filter(isPicture).length;
  grid.classList.toggle('selecting', !!sel);
  for (const t of grid.querySelectorAll('.tile')) {
    const i = sel ? sel.indexOf(t.dataset.id) : -1, n = t.querySelector('.selnum');
    t.classList.toggle('sel', i >= 0); if (n) n.textContent = i >= 0 ? String(i + 1) : '';
    if (sel) t.setAttribute('aria-pressed', String(i >= 0)); else t.removeAttribute('aria-pressed');
  }
  $('lib-top').hidden = !picOK() || (!sel && pics < 2);
  $('lib-select').textContent = sel ? 'Cancel' : 'Select';
  $('lib-clip').hidden = !sel; $('lib-clip').disabled = !sel || sel.length !== 2;
  $('lib-sel-text').textContent = !sel ? 'Two pictures make a clip between them.' : sel.length === 2 ? 'First, then last. Make a clip between them.'
    : sel.length === 1 ? 'Now tap the last picture.' : 'Tap the first picture, then the last.';
}
function selTap(id) {
  const m = S.lib.find((x) => x.id === id); if (!m) return;
  if (isSong(m)) return toast('Pick pictures: a song can’t be a first or last frame');
  if (isClip(m)) return toast('Pick pictures: a clip can’t be a first or last frame');
  const i = S.sel.indexOf(id);
  if (i >= 0) S.sel.splice(i, 1); else { if (S.sel.length >= 2) S.sel.shift(); S.sel.push(id); }
  renderLibSel();
}
function renderModels() {
  const busy = S.phase === 'working';
  for (const row of $('models').children) {
    const k = row.dataset.m, m = MODELS[k], u = S.dl[k], st = S.st[k] || {}, inst = done(k), q = (s) => row.querySelector(s);
    row.hidden = !E[k] || (k === 'brain4' && !e4bHere()) || ((k === 'stt' || k === 'jvoice') && !voiceHere()); if (row.hidden) continue;   // v4: voice input where it fits beside Juli   // the picture reader row needs the picture modes; the planner row the music engine; 3.8: the Bigger brain where it can run
    const auto = k === 'reader' ? ' · downloads by itself when a clip from a picture needs it' : k === 'lora' || k === 'lora2' ? ' · optional' : k === 'venc' ? ' · for style video to video' : k === 'planner' ? ' · comes with Download music' : k === 'drafter' ? ' · comes with Juli’s download' : k === 'k9b' && !inst ? ' · about 30 min on Wi-Fi' : k === 'jvoice' ? ' · downloads by itself the first time Juli speaks in voice mode' : '';
    if (k === 'music' && !inst) {   // v021: the pair (music + lyrics planner): one button, one bar, both parts listed
      const md = musicDl(), go = q('.m-go');
      q('.m-sub').textContent = `${m.what} + lyrics planner · ${fmtSize(md.total)} · ${md.have > 0 ? `${md.running ? '' : md.failed ? 'stopped · ' : 'paused · '}${Math.floor(md.pct * 100)}% · ${md.parts}` : st.error ? "can't reach the model server" : 'not downloaded'}`;
      go.hidden = false; go.disabled = md.pausing;
      go.querySelector('use').setAttribute('href', md.running ? '#i-pause' : md.have > 0 ? '#i-play' : '#i-download');
      go.querySelector('span').textContent = md.short;
      const del = q('.m-del'); del.hidden = !(u.have > 0); del.disabled = busy || !!md.running || md.pausing || inUse(k);
      const bar = q('.m-bar'); bar.hidden = !(md.have > 0); bar.firstElementChild.style.transform = `scaleX(${md.pct.toFixed(4)})`;
      continue;
    }
    if (k === 'brain4' && !(inst && (!E.drafter4 || done('drafter4')))) {   // 3.8 (v040): the pair (the bigger brain + its faster replies): one button, one bar, both parts
      const bd = e4bDl(), go = q('.m-go');
      q('.m-sub').textContent = bd.addDrafter ? `${m.what} · installed · faster replies not downloaded (${fmtSize(partTotal('drafter4'))})`
        : `${m.what} + faster replies · ${fmtSize(bd.total)} · ${bd.have > 0 ? `${bd.running ? '' : bd.failed ? 'stopped · ' : 'paused · '}${Math.floor(bd.pct * 100)}% · ${bd.parts}` : st.error ? "can't reach the model server" : 'not downloaded'}`;
      go.hidden = false; go.disabled = bd.pausing;
      go.querySelector('use').setAttribute('href', bd.running ? '#i-pause' : bd.have > 0 && !bd.addDrafter ? '#i-play' : '#i-download');
      go.querySelector('span').textContent = bd.short;
      const del = q('.m-del'); del.hidden = !(u.have > 0 || inst || S.dl.drafter4.have > 0); del.disabled = busy || !!bd.running || bd.pausing || inUse(k);
      const bar = q('.m-bar'); bar.hidden = !(bd.have > 0) || bd.addDrafter; bar.firstElementChild.style.transform = `scaleX(${bd.pct.toFixed(4)})`;
      continue;
    }
    q('.m-sub').textContent = inst ? `${m.what} · ${fmtSize(st.totalBytes || u.total)} · installed${st.packVersion ? ` · pack ${st.packVersion}` : ''}`
      : u.sub === 'failed' ? `${m.what} · download stopped · ${dlLine(u, true)}`
      : u.have > 0 ? `${m.what} · ${u.sub === 'downloading' ? '' : 'paused · '}${dlLine(u, true)}`
      : st.error ? `${m.what} · ${fmtSize(u.total)} · can't reach the model server` : `${m.what} · ${fmtSize(u.total)} · not downloaded${auto}`;
    const go = q('.m-go'), dl = u.sub === 'downloading';
    go.hidden = inst; go.disabled = u.sub === 'pausing';
    go.querySelector('use').setAttribute('href', dl ? '#i-pause' : u.have > 0 ? '#i-play' : '#i-download');
    go.querySelector('span').textContent = k === 'starter' && !(u.have > 0) && u.sub !== 'downloading' ? `Download starter knowledge · ${fmtSize(u.total)}` : dlLabel(u, true);
    const del = q('.m-del'); del.hidden = !inst && !(u.have > 0); del.disabled = busy || dl || u.sub === 'pausing' || inUse(k);
    const bar = q('.m-bar'); bar.hidden = inst || !(u.have > 0); bar.firstElementChild.style.transform = `scaleX(${dlPct(u).toFixed(4)})`;
  }
  $('s-models-why').hidden = !busy;
  $('s-clean').disabled = busy || !(S.files && S.files.remove.length);
  renderLora();   // v4
}
/** v4: Settings › Models: each video LoRA's switch, once it is on this phone */
function renderLora() {
  const box = $('s-lora-list'), sw = $('s-lora'), r1 = $('s-lora-row'), r2 = $('s-lora2-row'), sw2 = $('s-lora2'); if (!box || !sw) return;
  const a = !!(E.lora && done('lora')), b = !!(E.lora2 && done('lora2'));
  box.hidden = !(a || b); if (r1) r1.hidden = !a; if (r2) r2.hidden = !b; sw.checked = loraOn(); if (sw2) sw2.checked = lora2On();
}
/** 3.8 (v040): Settings › Juli: the Bigger brain row (shown once it is on the phone and can run here) */
const BRAIN4_NOTE = 'When you ask Juli to write something, or to make a picture, clip, song or app, she looks things up and checks pictures with her own model, and NVIDIA’s Bigger brain plans and writes. Chat stays on Juli’s own model, so replies stay fast. One model fits in memory at a time, so these jobs take a few seconds longer to start.';
function renderBrain4() {
  const row = $('s-brain4-row'), box = $('s-brain4'), note = $('s-brain4-note'); if (!row || !box || !note) return;
  row.hidden = !brain4Here();
  const blocked = brain4Blocked();
  box.checked = brain4On() && !blocked; box.hidden = blocked; box.disabled = blocked;
  note.textContent = blocked ? 'The Bigger brain ran out of memory last time, so Juli is using her own model. ' : BRAIN4_NOTE;
  if (blocked) {
    const on = document.createElement('button'); on.type = 'button'; on.className = 'btn sm'; on.textContent = 'Turn the Bigger brain back on';
    on.onclick = (e) => { e.preventDefault(); e.stopPropagation(); ls.set('pf.app.brain4Off', null); renderAssistantSettings(); };
    note.append(on);
  }
}
function renderAssistantSettings() {
  $('s-research').checked = AS.research; $('s-review').checked = AS.review; $('s-homezip').value = HOME_ZIP.get() || '';   // v4: + the home ZIP
  if (MEM) MEM.render();   // 3.9: About me, Routines and the heartbeat line
  radio($('brainmode'), AS.brainMode);
  const b = S.brainLoad, l = S.brainLast;
  $('s-brain-info').textContent = b ? `Last load: ${b.mode === 'lean' ? 'lighter' : 'full'}, ${b.seconds} s${b.residentMB ? `, ${b.residentMB} MB on the graphics chip` : ''}${b.split ? ` (${b.split.workerMB} MB more in a second process)` : ''}${b.drafter ? ', faster replies on' : ''}${l && l.tokPerS ? ` · ${l.tokPerS} tokens a second` : ''}.` : 'Loads for each chat and unloads before a picture, clip or song (one model on the graphics chip at a time).';
  if (FASTER_REPLIES && ls.get('pf.app.fasterOff', null) && !fasterOn() && !(SPLIT_HERE && !splitOn())) {   // 3.8: the safety net turned faster replies off on this phone
    const on = document.createElement('button'); on.type = 'button'; on.className = 'btn sm'; on.textContent = 'Turn faster replies back on';
    on.onclick = () => { ls.set('pf.app.fasterOff', null); location.reload(); };
    $('s-brain-info').append(' Faster replies are off on this phone: it ran out of memory with them on. ', on);
  }
  if (SPLIT_HERE && !splitOn()) {   // 3.8: the second process was given up on this phone (three loads in a row)
    const tr = document.createElement('button'); tr.type = 'button'; tr.className = 'btn sm'; tr.textContent = 'Try the second process again';
    tr.onclick = () => { ls.set('pf.app.splitOff', null); ls.set('pf.app.splitFails', 0); location.reload(); };
    $('s-brain-info').append(" Juli's second process didn't work on this phone, so she runs in one (without faster replies). ", tr);
  }
  renderBrain4();   // 3.8 (v040)
  const fin = Q ? Q.list().filter((j) => j.root === j.id && TERMINAL.has(j.status) && !Q.descendants(j.id).some((d) => !TERMINAL.has(d.status))).length : 0;
  $('s-qclear').disabled = !fin; $('s-qclear-why').textContent = fin ? `${fin} finished ${fin === 1 ? 'job' : 'jobs'} kept for the chat. The Library keeps everything that was made.` : 'Nothing finished is kept.';
  renderQBtn(); renderKB();
}
/** v022: the starter knowledge pack, once it is on the phone, becomes research's second local source (after the phone's own KB) */
function plugStarter() {
  if (!E.starter || !RS) return;
  E.starter.source().then((src) => { if (RS) RS.starter = src; }, (e) => { console.warn('starter knowledge:', msg(e)); });
}
/** Settings > Assistant: "Things the assistant has looked up · N" */
function renderKB() {
  const n = $('s-kbn'); if (!n) return;
  (RS ? RS.kbCount() : Promise.resolve(0)).then((c) => { n.textContent = String(c); $('s-kbclear').disabled = !c; }).catch(() => { n.textContent = '–'; });
}
async function renderSettings() {
  const c = S.caps || {};
  renderModels(); radio($('budget'), decodeMB()); renderAssistantSettings(); if (CASTUI) CASTUI.render(); if (VOICEIN) VOICEIN.renderSettings();
  $('s-persist').textContent = S.persisted ? 'Yes' : 'No'; $('s-allow').hidden = S.persisted;
  $('s-where').textContent = ANDROID ? (standalone() ? 'in the installed app' : 'in Chrome') : standalone() ? 'in the Home Screen app' : 'in Safari';
  $('s-gpu').textContent = c.gpu || '–'; $('s-ver').textContent = APP_VERSION;
  const clamp = (navigator.gpu && navigator.gpu.__clamp) || '';   // v027.3: the desktop test mode (gpuclamp.js, localhost only), shown with a way out
  $('s-clamp').hidden = !clamp; $('s-clamp-mode').textContent = clamp ? `clamp "${clamp}": Android-like limits` : '–';
  $('s-clamp-off').onclick = () => { try { localStorage.removeItem('p0pc0rn:clamp'); } catch (e) { /* */ } location.replace(location.pathname); };
  $('s-diagtext').textContent = diagText();   // v024
  $('s-diagcopy').onclick = async () => { try { await navigator.clipboard.writeText(diagText()); toast('Diagnostics copied'); } catch (e) { const r = document.createRange(); r.selectNodeContents($('s-diagtext')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('The text is selected: copy it'); } };
  const ag = rights.consent();
  $('r-agreed').textContent = ag ? `${new Date(ag.agreedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · terms ${ag.terms}` : `Not yet · terms ${rights.TERMS_VERSION}`;
  renderStorage();
}
/** radio groups: aria-checked + one indicator that glides to the chosen option */
function radio(group, value) {
  for (const b of group.querySelectorAll('[role="radio"]')) b.setAttribute('aria-checked', String(b.dataset.v === String(value)));
  placeInd(group);
}
function placeInd(group, instant) {
  const ind = group.querySelector('.ind'), on = group.querySelector('[aria-checked="true"]');
  if (!ind || !on || !on.offsetWidth) return;
  ind.classList.toggle('instant', !!instant || !group.dataset.placed); group.dataset.placed = '1';
  Object.assign(ind.style, { width: `${on.offsetWidth}px`, height: `${on.offsetHeight}px`, transform: `translate(${on.offsetLeft}px, ${on.offsetTop}px)` });
}
function placeAll() { for (const g of ['kind', 'vsrc', 'sizes', 'steps', 'detail', 'vsizes', 'vlen', 'seedmode', 'budget', 'follow']) placeInd($(g), true); }

// ------------------------------------------------------------------------------------------------ v023: music video from a landed song
// Josh (Oct 13): "the landed song has the option to animate in the bubble options" (also the song's Library viewer); "bare bones, user
// rerolls no QA from model"; "Sana will always need end capped first frame last frame". assistant/mvflf.js runs the phases through the
// queue; this block is the UI: the Animate sheet, the storyboard (a strip of shots, each between its first and last frame, with the
// popcorn and the time left for the WHOLE video), and the reroll sheet (the Edit-video inputs: a Nudge of up to 300 characters
// and "Repaint the stills"). The UI is built here; its styles are in app.css (post-launch: they were a <style> added once, which the
// Content-Security-Policy now refuses: style-src 'self', no inline styles).
const MB = { id: null, urls: new Map(), pop: null, t: 0, armed: 0, playing: null, kb: null };
let mvRenderT = 0;
const mvAbout = (s) => (s >= 5400 ? `about ${String(Math.round(s / 1800) / 2).replace(/\.5$/, '½')} h` : about(s));
const mvEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const mvBtn = (label, cls = 'btn sm') => { const b = mvEl('button', cls, label); b.type = 'button'; return b; };
/** v026.5: a Cast member as the music video's lead: their first photo, shaped to the video, as Klein's reference for the opening frame */
async function mvLead(p, shape) {
  const blob = p.photos && p.photos[0] ? await CAST.getBlob(p.photos[0].key) : null; if (!blob) return null;
  const [w, h] = shape === 'wide' ? [832, 480] : [480, 832];
  const names = [p.name, String(p.name).split(/\s+/)[0], ...(p.self ? ['me', 'myself'] : [])].filter((v, i, a) => v && a.indexOf(v) === i);
  diag('cast: music-video lead', { photos: p.photos.length });
  return { id: p.id, name: p.name, names, key: await Q.putBlob(await refForShape(blob, w, h), { role: 'cast-ref' }) };
}
/** v026.5: Cast names (lower case, full and first) never count as protected: the person's own consented photos and voice */
async function castNameSet() { try { return new Set(CAST ? await CAST.names() : []); } catch (e) { return new Set(); } }
/** the likeness gate's protected things: what this phone's KB has looked up (the song may have been grounded on a person or a character) */
async function mvRecords(text = '') {
  let out = [];
  try { if (!MB.kb) MB.kb = await createKB(); out = await MB.kb.all(); } catch (e) { out = []; }
  const cn = await castNameSet(); out = out.filter((r) => !cn.has(String((r && r.title) || '').toLowerCase().trim()));   // v026.5
  return text ? out.concat(await mvRealPeople([text]).catch(() => [])) : out;
}
/** v023: real people a storyboard or a nudge names, found by name: research.isRealPerson (the chat's deterministic check: Wikipedia
 *  opensearch + the page's person signs, cached; no model) -> person records for the gate ("a person", never the likeness).
 *  Lookups switched off -> none: the KB and the static lists still apply. */
async function mvRealPeople(texts, signal) {
  if (!AS.research || !RS) return [];
  const cn = await castNameSet();   // v026.5: a Cast member is never looked up as a real person
  const names = [...new Set([].concat(texts || []).flatMap((t) => properNames(t)))].filter((n) => !cn.has(n.toLowerCase().trim())).slice(0, 8), out = [];
  for (const n of names) {
    try { const p = await RS.isRealPerson(n, { signal }); if (p) out.push({ title: p.title || n, isPerson: true, categories: p.living ? ['Living people'] : [], facts: [] }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; }
  }
  return out;
}
/** a sheet built on the fly (the app's sheet styles): returns {wrap, sheet, close} */
function mvSheet(id, title) {
  let w = document.getElementById(id); if (w) w.remove();
  w = mvEl('div', 'sheet-wrap'); w.id = id;
  const scrim = mvEl('div', 'scrim'); scrim.dataset.close = '';
  const sh = mvEl('div', 'sheet mv-sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
  sh.append(mvEl('p', 'title', title));
  w.append(scrim, sh); document.body.append(w);
  const close = () => closeWrap(id, () => w.remove());
  w.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  return { wrap: w, sheet: sh, close };
}
/** the song behind a chat bubble (its queue job id) or a Library item -> {blob, title, tags, lyrics, bpm, seconds, songId} */
async function mvSong({ jobId = null, meta = null, blob = null } = {}) {
  const id = meta ? meta.id : 'a-' + jobId;
  const m = meta || S.lib.find((x) => x.id === id) || null, j = jobId && Q ? Q.get(jobId) : null, P = (j && j.params) || {}, r = (j && j.result) || {};
  let b = blob || (m ? await store.getBlob(m.id).catch(() => null) : null);
  if (!b && r.audio && r.audio.blobKey) b = await Q.getBlob(r.audio.blobKey).catch(() => null);
  if (!b) return null;
  return { blob: b, songId: m ? m.id : id, title: (m && m.title) || P.title || 'Untitled song', tags: (m && m.tags) || r.tags || P.tags || '', lyrics: (m && m.lyrics) || r.lyrics || P.lyrics || '',
    bpm: (m && m.bpm) || r.bpm || P.bpm || null, seconds: Number((m && m.duration) || r.seconds || P.seconds) || 30 };
}
/** the chat's Animate (a landed song's bubble) */
async function animateSong(jobId) { const s = await mvSong({ jobId }); if (!s) return toast("That song isn't on this phone any more"); openAnimate(s); }
/** the Animate sheet: shape, an optional direction, whether to stop at the storyboard, and the honest time */
function openAnimate(song) {
  if (!Q) return toast('The queue is not ready yet');
  if (Q.readOnly) return toast('p0pc0rn is open in another tab.');
  if (done('video') && !ltxOk()) return void openLtx(() => openAnimate(song));   // the Gemma tick: a music video ends in video jobs
  const brain = installed(MODELS.brain.id);
  const { sheet, close } = mvSheet('mv-sheet', 'Music video');
  let shape = 'tall';
  const est = () => mvEstimate(song.seconds, { shape, brain });
  const intro = mvEl('p', 'callout dim');
  const paint = () => { const e = est(); intro.textContent = `“${song.title}” · ${clock(song.seconds)} → ${e.shots} shot${e.shots === 1 ? '' : 's'} of 4.5 s (a beat can chain two: 9 s). ${brain ? 'The assistant plans each shot. ' : ''}Pictures paints every shot's first and last frame, the video model moves between them, then the song goes under the cut. ${cap(mvAbout(e.seconds))} on this phone: plugged in, screen on. It picks up where it stopped if the page closes.`; };
  const seg = mvEl('div', 'mv-seg'); seg.id = 'mv-shape';
  for (const [v, label] of [['tall', 'Tall · 9:16'], ['wide', 'Wide · 16:9']]) {
    const b = mvBtn(label, 'btn sm'); b.dataset.v = v; b.setAttribute('aria-pressed', String(v === shape));
    b.onclick = () => { shape = v; for (const x of seg.children) x.setAttribute('aria-pressed', String(x.dataset.v === shape)); paint(); }; seg.append(b);
  }
  const dl = mvEl('label', 'label', 'Direction (optional)'); dl.htmlFor = 'mv-dir';
  const dir = mvEl('textarea'); dir.id = 'mv-dir'; dir.maxLength = NUDGE_MAX; dir.placeholder = 'e.g. a night drive through a rainy neon city, warm amber and teal, ends at the sea';
  // v026.5: a Cast member can lead the video (picked here, or named in the direction): their photo is the opening frame's reference
  const ll = mvEl('label', 'label', 'Lead (optional)'); ll.htmlFor = 'mv-lead';
  const lead = mvEl('select', 'mv-lead'); lead.id = 'mv-lead'; lead.append(Object.assign(mvEl('option', null, 'No one from Cast'), { value: '' }));
  ll.hidden = lead.hidden = true;
  let leadPicked = false;
  if (CAST) CAST.list().then((ps) => { for (const p of ps.filter((x) => x.photos && x.photos.length)) lead.append(Object.assign(mvEl('option', null, `Lead: ${p.name}`), { value: p.id })); ll.hidden = lead.hidden = lead.options.length < 2; }).catch(() => {});
  lead.onchange = () => { leadPicked = true; };
  dir.addEventListener('input', () => { if (leadPicked || !CAST) return; CAST.find(dir.value).then((hits) => { const h = hits.find((x) => x.person.photos.length); lead.value = h ? h.person.id : ''; }).catch(() => {}); });
  // v026.6: "Better frames (9B), slower": every keyframe painted / edited by Klein 9B (the 4B otherwise)
  const bl9 = mvEl('label', 'mv-check'), b9 = mvEl('input'); b9.type = 'checkbox'; b9.id = 'mv-9b'; b9.checked = false;
  bl9.append(b9, mvEl('span', 'callout', 'Better frames (9B), slower')); bl9.hidden = !done('k9b');
  const n9 = mvEl('p', 'footnote dim'); n9.id = 'mv-9b-note'; n9.hidden = true;
  b9.onchange = () => { const [w, h] = shape === 'wide' ? [832, 480] : [480, 832]; n9.hidden = !b9.checked; n9.textContent = `Each frame about ${about(k9bSeconds(w, h, true))} instead of ${about(estimate({ kind: 'i2i', width: w, height: h, steps: 4 }))}.`; };
  const hl = mvEl('label', 'mv-check'), hold = mvEl('input'); hold.type = 'checkbox'; hold.id = 'mv-hold'; hold.checked = true;
  hl.append(hold, mvEl('span', 'callout', 'Stop at the storyboard so I can check the frames (reroll any of them, then Animate)'));
  const need = mvEl('p', 'footnote dim'); need.id = 'mv-need';
  const miss = ['image', 'video'].filter((k) => !done(k));
  need.textContent = miss.length ? `Needs the ${miss.map((k) => MODELS[k].noun).join(' and the ')} model${miss.length > 1 ? 's' : ''} (Settings › Models).` : 'The picture reader downloads by itself before the first shot if it is not on the phone yet.';
  const go = mvBtn('Make the music video', 'btn cta'); go.id = 'mv-go'; go.disabled = miss.length > 0;
  const cancel = mvBtn('Cancel', 'btn ghost'); cancel.dataset.close = '';
  go.onclick = async () => {
    if (!consented()) { close(); return openLesson(); }
    go.disabled = true;
    try {
      const sid = CH ? CH.sid : null;
      const lp = lead.value && CAST ? await CAST.get(lead.value) : null;
      const j = await startMusicVideo(Q, song, { shape, direction: dir.value, hold: hold.checked, session: sid, brain, lead: lp ? await mvLead(lp, shape) : null, frames9b: b9.checked && done('k9b') });
      close();
      const e = est();
      if (AG && sid) AG.say(sid, { kind: 'status', text: `Making a music video of “${song.title}”: ${e.shots} shots, each from a first to a last frame. ${cap(mvAbout(e.seconds))} on this phone.${hold.checked ? ' It stops at the storyboard so you can check the frames.' : ''}`, jobId: j.id, history: false }).catch(() => {});
      toast('Music video started'); openBoard(j.id); syncWake();
    } catch (e) { go.disabled = false; toast(msg(e) || "Couldn't start the music video"); }
  };
  sheet.append(intro, mvEl('p', 'label', 'Shape'), seg, dl, dir, ll, lead, bl9, n9, hl, need, go, cancel);
  paint();
}

// ---- the storyboard board (full screen, like the lesson): the whole video's progress + the strip of shots
function mvBoardEl() {
  let w = document.getElementById('mvb'); if (w) return w;
  w = mvEl('div', 'mvb'); w.id = 'mvb'; w.hidden = true; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-label', 'Music video storyboard');
  const top = mvEl('div', 'mvb-top'), x = mvBtn('', 'icon-btn'); x.id = 'mvb-close'; x.setAttribute('aria-label', 'Close the storyboard');
  x.innerHTML = '<svg><use href="#i-x"/></svg>'; x.onclick = closeBoard;
  const h = mvEl('p', 'headline'); h.id = 'mvb-title'; top.append(x, h);
  const body = mvEl('div', 'mvb-body');
  const prog = mvEl('div', 'mvb-prog'), cv = mvEl('canvas', 'mvb-pop'); cv.setAttribute('aria-hidden', 'true');
  const pt = mvEl('div'); const st = mvEl('p', 'callout mvb-st'); st.id = 'mvb-status'; st.setAttribute('aria-live', 'polite');
  const bar = mvEl('div', 'bar'); bar.append(mvEl('i')); bar.id = 'mvb-bar'; pt.append(st, bar); prog.append(cv, pt);
  const acts = mvEl('div', 'mvb-acts'); acts.id = 'mvb-acts';
  const player = mvEl('video', 'mvb-player'); player.id = 'mvb-player'; player.playsInline = true; player.muted = true; player.loop = true; player.controls = true; player.hidden = true;
  const help = mvEl('p', 'footnote dim'); help.id = 'mvb-help';
  const strip = mvEl('div', 'mvb-strip'); strip.id = 'mvb-strip';
  body.append(prog, acts, player, help, strip); w.append(top, body); document.body.append(w);
  MB.pop = popcorn(cv);
  return w;
}
function openBoard(mvId) {
  if (!Q) return;
  let j = Q.get(mvId); if (!j) return toast('That music video is no longer in the queue');
  const live = [...Q.jobs.values()].filter((x) => x.kind === 'mvflf' && x.params.editOf === j.id && !TERMINAL.has(x.status)).pop();
  if (live) j = live;   // a newer version is being made: show that one
  const w = mvBoardEl();
  if (MB.id !== j.id) { mvFreeUrls(); MB.playing = null; }
  MB.id = j.id; w.hidden = false; document.documentElement.toggleAttribute('data-viewer', true);
  renderBoard(true);
}
function closeBoard() {
  const w = document.getElementById('mvb'); if (!w || w.hidden) return;
  w.hidden = true; document.documentElement.removeAttribute('data-viewer');
  const p = document.getElementById('mvb-player'); p.pause(); p.removeAttribute('src'); p.load(); p.hidden = true;
  if (MB.pop) MB.pop.stop(); MB.id = null; MB.playing = null; mvFreeUrls();
}
function mvFreeUrls() { for (const u of MB.urls.values()) URL.revokeObjectURL(u); MB.urls.clear(); }
async function mvUrl(key) {
  if (!key) return null;
  if (MB.urls.has(key)) return MB.urls.get(key);
  const b = await Q.getBlob(key).catch(() => null); if (!b) return null;
  if (MB.urls.has(key)) return MB.urls.get(key);
  const u = URL.createObjectURL(b); MB.urls.set(key, u); return u;
}
const mvStatusOf = (j) => { const p = progressOf(j, Q.children(j.id)); return Object.assign(p, { etaText: p.etaSeconds != null ? mvAbout(p.etaSeconds) : '' }); };
/** the header (cheap: every progress event) */
function renderBoardHead() {
  const j = MB.id && Q.get(MB.id); if (!j) return;
  const p = mvStatusOf(j), run = Q.children(j.id).find((c) => c.status === 'running');
  $('mvb-title').textContent = `Music video · “${j.params.title || 'your song'}”${j.params.editOf ? ' (new version)' : ''}`;
  $('mvb-status').textContent = p.etaSeconds ? `${p.text} · ${p.etaText} left` : p.text;
  $('mvb-bar').firstElementChild.style.transform = `scaleX(${p.frac.toFixed(4)})`;
  if (MB.pop) {
    if (run && isStageKind(run.kind)) { if (MB.popJob !== run.id) { MB.popJob = run.id; MB.pop.start(); } popTo(MB.pop, jobView(run)); }   // v026.9: the active shot's stage (the storyboard keeps its whole-video bar)
    else if (MB.popJob) { MB.pop.stop(); MB.popJob = null; }
  }
}
function scheduleBoard() { if (mvRenderT) return; mvRenderT = setTimeout(() => { mvRenderT = 0; renderBoard(); }, 250); }
/** the whole board: the actions and the strip (on any change of the video's jobs) */
function renderBoard() {
  const w = document.getElementById('mvb'); if (!w || w.hidden || !MB.id) return;
  const j = Q.get(MB.id); if (!j) return closeBoard();
  const kids = Q.children(j.id), b = boardOf(j, kids);
  renderBoardHead();
  w.style.setProperty('--mv-ar', `${j.params.width || 480} / ${j.params.height || 832}`);
  const acts = $('mvb-acts'); acts.textContent = '';
  if (b.canAnimate && !b.go && j.params.hold) { const a = mvBtn(`Animate ${b.shots.length} shot${b.shots.length === 1 ? '' : 's'}`, 'btn sm'); a.id = 'mvb-animate'; a.onclick = () => mvGo(j.id, a); acts.append(a); }
  const cut = b.cuts.filter((c) => c.status === 'done').pop();
  if (cut) { const v = mvBtn('Watch the video', 'btn sm'); v.id = 'mvb-watch'; v.onclick = () => { closeBoard(); openLibraryItem('a-' + cut.id); }; acts.append(v); }
  if (!TERMINAL.has(j.status)) { const x = mvBtn('Cancel the video', 'btn sm ghost'); x.id = 'mvb-cancel'; x.onclick = () => mvCancel(j.id, x); acts.append(x); }
  $('mvb-help').textContent = !b.sb ? 'The storyboard appears here as soon as it is written.' : b.canRerollFrames ? 'Every shot runs from its first frame to its last. Each last frame is painted FROM its first frame (the same person and place), and every new scene from the opening frame. Reroll any frame (with a nudge if you like) before the shots are animated: rerolling a first frame repaints its last frame too. A shot that continues starts on the last kept moment of the shot before (each clip keeps its first 4.5 s), so it is painted and filmed after it; rerolling a shot films the one that continues it again.'
    : TERMINAL.has(j.status) ? 'Reroll a shot to make a new version of the video; this one stays in the Library. A shot that continues it is filmed again from its new last moment.' : 'Reroll a shot once it is animated: it films again after the jobs still to come (and the shot that continues it, from its new last moment), and the video is cut again.';
  const strip = $('mvb-strip'), keep = strip.scrollLeft; strip.textContent = '';
  if (!b.sb) return;
  for (const s of b.shots) strip.append(mvShotCard(j, b, s));
  strip.scrollLeft = keep;
}
function mvFrameEl(j, b, k, label, sharedFrom) {
  const f = b.frames[k], box = mvEl('div', 'mvb-frame'); box.dataset.k = k;
  if (sharedFrom) box.classList.add('shared');
  if (f.pending) box.classList.add('busy');
  const img = mvEl('img', 'mvb-img'); img.alt = `${label}: ${f.prompt}`; img.loading = 'lazy'; box.append(img);
  if (f.cur) mvUrl(f.cur.key).then((u) => { if (u) img.src = u; });
  // v026.3: a chained shot's last keyframe is painted from the previous clip's last kept frame, once that clip is filmed
  const chainedWait = f.chained && !f.cur && !f.pending;
  box.append(mvEl('span', 'mvb-cap', sharedFrom ? `${label} · from shot ${sharedFrom}` : chainedWait ? `${label} · painted from the previous clip` : f.pending ? `${label} · ${f.pending.status === 'running' ? 'painting…' : 'waiting'}` : f.failed ? `${label} · didn't paint` : `${label}${f.versions > 1 ? ` · v${f.cur ? f.cur.v : f.versions}` : ''}`));
  if (b.canRerollFrames && !sharedFrom && (f.cur || f.failed)) { const r = mvBtn('Reroll', 'mini mvb-fr'); r.setAttribute('aria-label', `Reroll frame ${k + 1}`); r.onclick = () => openReroll(j.id, 'frame', k); box.append(r); }
  return box;
}
/** v026.3: a chained shot's first frame: the previous clip's last KEPT frame (pixel for pixel), shown once that clip is filmed */
function mvHandoffEl(s) {
  const box = mvEl('div', 'mvb-frame shared handoff'); box.dataset.k = s.first;
  const img = mvEl('img', 'mvb-img'); img.alt = `First: the last moment of shot ${s.n - 1}`; img.loading = 'lazy'; box.append(img);
  if (s.handoff) mvUrl(s.handoff).then((u) => { if (u) img.src = u; });
  box.append(mvEl('span', 'mvb-cap', s.handoff ? `First · from the previous clip` : `First · from the previous clip (once it is filmed)`));
  return box;
}
function mvShotCard(j, b, s) {
  const c = mvEl('div', 'mvb-shot'); c.dataset.n = s.n; if (s.stale) c.classList.add('stale');
  c.append(mvEl('p', 'callout', `Shot ${s.n} · ${clock(s.start)}–${clock(s.start + s.dur)}`), mvEl('p', 'footnote dim', `${s.section} · ${s.join === 'continues' ? `continues shot ${s.n - 1}` : 'cut'}`));
  const pair = mvEl('div', 'mvb-pair');
  pair.append(s.join === 'continues' && s.n > 1 ? mvHandoffEl(s) : mvFrameEl(j, b, s.first, 'First', 0), mvEl('span', 'mvb-arrow', '→'), mvFrameEl(j, b, s.last, 'Last', 0));
  c.append(pair, mvEl('p', 'mvb-motion', s.motion));
  const st = s.pending ? (s.pending.status === 'running' ? 'Filming…' : s.cur ? 'Reroll waiting its turn' : 'Waiting its turn') : s.cur ? (s.stale ? 'Its frame changed since: reroll to use the new one' : `Take ${s.cur.t}`) : s.failed ? "Didn't film" : b.stage === 'board' || b.stage === 'frames' ? 'Not animated yet' : '';
  if (st) c.append(mvEl('p', 'footnote dim', st));
  const row = mvEl('div', 'mvb-row');
  if (s.cur) { const p = mvBtn(MB.playing === s.n ? 'Playing' : 'Play', 'mini mvb-play'); p.onclick = () => mvPlay(s); row.append(p); }
  if ((s.cur || s.failed) && j.status !== 'cancelled' && j.status !== 'failed') { const r = mvBtn('Reroll shot', 'mini mvb-sr'); r.onclick = () => openReroll(j.id, 'shot', s.n); row.append(r); }
  if (row.childElementCount) c.append(row);
  return c;
}
async function mvPlay(s) {   // one video at a time: the board's own player
  const p = $('mvb-player'), u = await mvUrl(s.cur && s.cur.key); if (!u) return;
  MB.playing = s.n; p.src = u; p.hidden = false; p.play().catch(() => {}); p.scrollIntoView({ block: 'nearest' }); scheduleBoard();
  // v026.3: only the kept part plays (the video drops a take's last frames, where SANA morphs toward the end keyframe)
  p.ontimeupdate = () => { if (MB.playing === s.n && s.dur && p.currentTime >= s.dur) p.currentTime = 0; };
}
async function mvGo(id, btnEl) {
  if (!ltxOk()) return void openLtx(() => mvGo(id, btnEl));   // the Gemma tick: Animate starts the video jobs
  btnEl.disabled = true;
  try { await requestGo(Q, id); toast('Animating: the shots start after the jobs still to come'); } catch (e) { btnEl.disabled = false; toast(msg(e)); }
}
function mvCancel(id, x) {
  if (!MB.armed) { x.textContent = 'Tap again to stop it'; MB.armed = setTimeout(() => { MB.armed = 0; x.textContent = 'Cancel the video'; }, 3000); return; }
  clearTimeout(MB.armed); MB.armed = 0; Q.cancel(id); toast('Music video stopped');
}
/** the reroll sheet (the Edit-video inputs): an optional nudge (300 characters) and, for a shot, "Repaint the stills" */
function openReroll(mvId, what, idx) {
  const j = Q.get(mvId); if (!j) return;
  const b = boardOf(j, Q.children(mvId)), shot = what === 'shot' ? b.shots.find((s) => s.n === idx) : null, f = what === 'frame' ? b.frames[idx] : null;
  const { sheet, close } = mvSheet('mvr', what === 'shot' ? `Reroll shot ${idx}` : `Reroll frame ${idx + 1}`);
  sheet.querySelector('.title').id = 'mvr-title';
  const nl = mvEl('label', 'label', 'Nudge (optional)'); nl.htmlFor = 'mvr-nudge';
  const nudge = mvEl('textarea'); nudge.id = 'mvr-nudge'; nudge.maxLength = NUDGE_MAX;
  nudge.placeholder = what === 'shot' ? 'e.g. slower, she keeps looking out of the window' : 'e.g. make it night, rain on the glass';
  const count = mvEl('p', 'footnote dim num', `0 / ${NUDGE_MAX}`); nudge.addEventListener('input', () => { count.textContent = `${nudge.value.length} / ${NUDGE_MAX}`; });
  const notes = mvEl('div'); notes.id = 'mvr-note';
  const note = (t) => notes.append(mvEl('p', 'footnote dim', t));
  let paint = null;
  if (what === 'frame') {
    const sh = shotsOfFrame(b.sb, idx);
    note(sh.length > 1 ? `Shots ${sh.join(' and ')} share this frame: both use the new one.` : `Shot ${sh[0]}'s ${f.end} frame.`);
    note('A new picture with the same words (and your nudge). It paints after the jobs still to come.');
  } else {
    const pl = mvEl('label', 'mv-check'); paint = mvEl('input'); paint.type = 'checkbox'; paint.id = 'mvr-paint';
    pl.append(paint, mvEl('span', 'callout', shot.join === 'continues' ? 'Repaint the last frame' : 'Repaint the stills'));
    notes.append(pl);
    note('Off: the same frames, a new motion take (a nudge changes the motion). On: new frames first (a nudge can change what is in them).');
    if (shot.join === 'continues') note(`This shot continues shot ${idx - 1} (it starts on that shot's last frame), so only its last frame is repainted.`);
    const next = b.shots.find((s) => s.n === idx + 1);
    if (next && next.join === 'continues') note(`Shot ${idx + 1} starts on this shot's last frame: reroll the next shot too if the join jumps.`);
    note(TERMINAL.has(j.status) ? 'This makes a new version of the video; this one stays in the Library.' : 'It renders after the jobs still to come; the video is cut again when it lands. Earlier cuts stay in the Library.');
  }
  const go = mvBtn(what === 'shot' ? 'Reroll the shot' : 'Reroll the frame', 'btn cta'); go.id = 'mvr-go';
  const cancel = mvBtn('Cancel', 'btn ghost'); cancel.dataset.close = '';
  go.onclick = async () => {
    go.disabled = true;
    try {
      const records = await mvRecords(nudge.value);
      if (what === 'frame') { await requestFrameReroll(Q, mvId, idx, { nudge: nudge.value, records }); toast(`Frame ${idx + 1} paints again after the jobs still to come`); }
      else {
        const r = await requestShotReroll(Q, mvId, idx, { nudge: nudge.value, repaint: !!(paint && paint.checked), records });
        if (r.edit) { toast('Making a new version of the video'); MB.id = r.job.id; }
        else toast(`Shot ${idx} films again after the jobs still to come`);
        if (r.shares.length) toast(`Shot ${r.shares.join(' and ')} shares a repainted frame: reroll it too if the join jumps`, { ms: 5000 });
      }
      close(); renderBoard();
    } catch (e) { go.disabled = false; toast(msg(e)); }
  };
  sheet.append(nl, nudge, count, notes, go, cancel);
}
/** a cut landed: the chat says so (the bubble plays it, with Edit video) and the Library keeps it - every cut, earlier ones stay */
async function mvCutLanded(cut, mv) {
  const sid = mv.session || (CH && CH.sid), r = cut.result || {}, v = r.video;
  if (!v) return;
  const n = (mv.state && mv.state.sb && mv.state.sb.shots.length) || 0;
  if (AG && sid && await AG.session(sid).catch(() => null)) {
    await AG.say(sid, { kind: 'result', text: `Your music video is ready: “${mv.params.title || 'your song'}”, ${n} shots, ${clock(r.seconds || 0)}. Every cut is kept in the Library; reroll any shot from the storyboard.`,
      media: { kind: 'musicvideo', blobKey: v.blobKey }, jobId: cut.id, mvId: mv.id, history: false }).catch(() => saveAssistantResult(cut.id));
  } else await saveAssistantResult(cut.id);
}
function wireMv() {
  Q.on('change', (j) => { if (MB.id && j && (j.id === MB.id || j.parent === MB.id)) scheduleBoard(); });
  Q.on('progress', (j) => { if (MB.id && j && j.parent === MB.id) renderBoardHead(); });
  Q.on('done', (j) => { if (j.kind === 'assemble') { const mv = mvRoot(Q, j); if (mv) mvCutLanded(j, mv).catch(() => {}); } });
  Q.on('failed', (j) => {
    if (j.kind !== 'mvflf') return;
    const sid = j.session || (CH && CH.sid);
    if (AG && sid) AG.say(sid, { kind: 'error', text: `The music video stopped: ${(j.error && j.error.message) || 'it did not finish'}. Earlier cuts stay in the Library.`, history: false }).catch(() => {});
  });
}

// ------------------------------------------------------------------------------------------------ wiring
function init() {
  pop = popcorn($('st-pop'));
  initBack({ enabled: ANDROID || ls.get('p0pc0rn:backsheets', null) === 1 || ls.get('p0pc0rn:backsheets', null) === '1' });   // v026.9: the back button closes the open sheet
  if (ANDROID) { $('s-android').hidden = false; $('s-persist-label').textContent = 'Protected from cleanup'; }   // v026.9: Android (Chrome): experimental
  const chips = (box, list) => { for (const z of list) {   // shape chips: aspect glyph + name + pixels
    const b = document.createElement('button'), gw = z.w >= z.h ? z.g : Math.round(z.g * z.w / z.h), gh = z.h >= z.w ? z.g : Math.round(z.g * z.h / z.w);
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = z.id;
    b.innerHTML = `<b>${z.name}</b><span><i class="glyph"></i>${z.w}×${z.h}</span>`;
    Object.assign(b.querySelector('.glyph').style, { width: `${gw}px`, height: `${gh}px` });   // post-launch: CSSOM, not a style attribute (the CSP allows none)
    box.append(b);
  } };
  chips($('sizes'), SIZES); chips($('vsizes'), VSIZES);
  buildLesson(); buildRights();
  $('ls-next').onclick = lessonNext; $('ls-back').onclick = () => lessonGo(L.i - 1); $('ls-close').onclick = closeLesson;
  $('ls-dl-btn').onclick = tapGuard(() => { if (L.dlKey) dlTap(L.dlKey); });
  $('agree-go').onclick = () => openLesson(); $('r-lesson').onclick = () => openLesson();
  $('attest').addEventListener('change', (e) => { S.attest = e.target.checked && !!S.photo; if (S.attest) { rights.logUpload(S.photo.blob); $('attest-box').classList.remove('need'); } renderCta(); });
  addEventListener('p0pc0rn:voicepack', () => refreshStatus('jvoice').then(() => { if (S.tab === 'settings') renderSettings(); }));   // v4: voice mode downloaded (or first saw) her voice
  addEventListener('storage', (e) => { if (e.key === rights.CONSENT_KEY || e.key === null) { render(); renderLesson(); if (Q && consented()) Q.recheck(); } });   // an agreement made (or cleared) in another tab
  addEventListener('resize', () => { if (L.open) $('ls-track').scrollTo({ left: L.i * $('ls-track').clientWidth }); });
  for (const k of DL) {   // Settings › Models rows (the picture reader's row shows only when the engine has the picture modes)
    if (k === 'drafter4') continue;   // 3.8 (v040): the bigger brain's faster replies ride in its row
    const m = MODELS[k], row = document.createElement('div'); row.className = 'model'; row.dataset.m = k;
    row.innerHTML = `<div class="m-top"><div class="m-txt"><span class="m-name"></span><span class="footnote dim m-sub num"></span></div><span class="li-end">`
      + '<button class="btn sm m-go" type="button"><svg class="ic"><use href="#i-download"/></svg><span>Download</span></button>'
      + '<button class="icon-btn m-del" type="button"><svg class="ic"><use href="#i-trash"/></svg></button></span></div><div class="bar m-bar"><i></i></div>';
    row.querySelector('.m-name').textContent = m.name; row.querySelector('.m-del').setAttribute('aria-label', `Delete ${theNoun(k)}`);
    row.querySelector('.m-go').onclick = tapGuard(() => dlTap(k)); row.querySelector('.m-del').onclick = () => askDeleteModel(k);
    $('models').append(row);
  }
  // p0pc0rn Cast: Settings › Cast and the "Make them talk" (experimental) sheets
  CASTUI = initCast({ root: $('cast-root'), cast: CAST, app: { Q: () => Q, voice: () => E.voice, voiceReady: () => done('voice'), consented, openLesson, toast,
    saveResult: (id) => saveAssistantResult(id).catch(() => {}), openLibraryItem, mediaFile, share, saveFile, exportOf, shareItem, dlVoice: () => dlTap('voice'), diag,   // v026.5: + the AI-labelled Save
    talk: (p, line) => { if (TALKUI) TALKUI.fromSay({ id: null, params: { personId: p.id, name: p.name, line } }, null); } } });
  TALKUI = initTalk({ Q: () => Q, cast: CAST, lib: () => S.lib, getLibBlob: (id) => store.getBlob(id), ready: (k) => done(k), dl: (k) => dlTap(k),
    sizeOf: (k) => fmtSize(S.dl[k].total || MODELS[k].total), nameOf: (k) => MODELS[k].name, consented, openLesson, toast, diag });
  $('v-talk').onclick = () => { if (V.id) TALKUI.fromClip(V.id); };
  const pick = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) { fn(b.dataset.v); saveDraft(); render(); } });
  pick('sizes', (v) => { S.form.size = v; });
  pick('steps', (v) => { S.form.steps = Number(v); });
  pick('pmodel', (v) => { S.form.model = v === '9b' ? '9b' : '4b'; });   // v026.6 (remembered with the draft)
  pick('vmode', (v) => { S.vform.q = ['high', 'highest'].includes(v) ? v : 'standard'; });
  $('v-end').addEventListener('input', (e) => { S.vform.end = e.target.value.slice(0, 300); saveDraft(); });
  $('hq-go').onclick = () => hqAnimate(); $('hq-re1').onclick = () => hqReroll('first'); $('hq-re2').onclick = () => hqReroll('last');
  $('hq-x').onclick = () => { S.hq = null; saveHq(); render(); renderHq(); };
  $('flux').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeFlux(); });
  $('flux-ok').onclick = acceptFlux;
  $('mdw').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeMdw(); });   // 3.8 (v040): the Bigger brain's licence
  $('mdw-ok').onclick = acceptMdw;
  pick('detail', (v) => { S.form.ref = v; });
  pick('vsizes', (v) => { S.vform.size = v; });
  pick('vlen', (v) => { S.vform.len = Number(v); });
  pick('follow', (v) => { S.vform.followPick = followOf(v); });   // v4: Restyle's "Follow the motion" (Closely / Loosely; the same time either way): the person's pick wins over the look's
  pick('vsrc', (v) => { if (S.phase === 'result' || S.phase === 'error') { dropResult(); Object.assign(S, { phase: 'ready', error: null }); } S.vform.src = v; });
  // the clip's pictures: Library / phone photo / remove / swap; one attestation per phone photo; the reader's Pause / Resume
  $('vpics').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || S.phase === 'working' || b.id === 'v-reader-go') return;
    if (b.id === 'vs-swap') return swapSlots();
    const el = b.closest('.vslot'); if (!el) return; const i = Number(el.dataset.i);
    if (b.dataset.act === 'lib') openPicker(i);
    else if (b.dataset.act === 'phone') { vpick = i; $('vfile').click(); }
    else if (b.dataset.act === 'x') clearSlot(i);
  });
  $('v-reader-go').onclick = tapGuard(() => dlTap('reader'));
  $('vfile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const p = await shrinkPhoto(f); await fillSlot(vpick, p.blob, p.w, p.h, 'phone'); } catch (err) { toast("That photo couldn't be opened. Try another, or a screenshot of it."); }
  });
  // v4 Phase 4: Restyle a clip: the clip (Library / a video from the phone / remove), its tick, the look; the first frame's check
  $('vstyle').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || S.phase === 'working') return;
    if (b.dataset.act === 'clib') return openClipPicker();
    if (b.dataset.act === 'cphone') return $('cfile').click();
    if (b.dataset.act === 'cx') return styClear();
    const t = b.closest('.look'); if (t) { S.vform.look = t.dataset.v; saveDraft(); renderStyle(); renderStyReview(); renderCta(); renderFollow(); }   // v4 (Nov 3): + Follow the motion follows the look
  });
  $('cfile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) pickClip(f, { from: 'phone' }); });
  $('sattest').addEventListener('change', (e) => {
    if (!S.sty || !S.sty.clip) return;
    S.sty.attest = e.target.checked; saveSty();
    if (S.sty.attest) { const b = S.styOrig || (S.styB && S.styB.pack); if (b) rights.logUpload(b); $('sattest-box').classList.remove('need'); }
    renderCta();
  });
  $('sty-whole').addEventListener('change', (e) => {   // v4: the whole video, in parts (Experimental): its other parts are read now
    if (!S.sty || !S.sty.clip || S.phase === 'working') { e.target.checked = !!(S.sty && S.sty.whole); return; }
    S.sty.whole = e.target.checked; saveSty(); if (S.sty.whole) styReadParts(); render();
  });
  $('sty-kept-go').onclick = tapGuard(() => { const id = $('sty-kept').dataset.job; if (id && S.phase !== 'working') longCarryOn(id); });   // v4: a stopped whole-video restyle
  $('sty-kept-x').onclick = () => { const id = $('sty-kept').dataset.job; if (id && S.phase !== 'working') longDrop(id); };
  $('sty-go').onclick = tapGuard(() => styUse());
  $('sty-re').onclick = tapGuard(() => { if (S.phase !== 'working') styleMake(); });
  $('sty-x').onclick = () => { if (S.sty) { S.sty.stage = null; styForget(false); saveSty(); styKeep(); } render(); };
  $('vattests').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]'); if (!cb) return;
    const i = Number(cb.dataset.i), x = S.vslots[i]; if (!x) return;
    x.attest = cb.checked; if (x.attest) { rights.logUpload(x.blob); $(`vattest-box-${i}`).classList.remove('need'); }
    renderCta();
  });
  $('picker').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closePicker();
    const t = e.target.closest('.pk-tile'); if (!t) return;
    const id = t.dataset.id, i = PK.slot; closePicker(); if (PK.clip) return void clipFromLibrary(id); pickFromLibrary(i, id);
  });
  $('menu').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeWrap('menu');
    const b = e.target.closest('.mn-list .btn'); if (!b) return;
    const f = menuFns[Number(b.dataset.i)]; closeWrap('menu'); if (f) f();
  });
  $('lib-select').onclick = () => { S.sel = S.sel ? null : []; renderLibSel(); };
  $('lib-clip').onclick = () => { if (S.phase === 'working') return toast('Wait — something is being made'); if (S.sel && S.sel.length === 2) clipBetween(S.sel[0], S.sel[1]); };
  pick('seedmode', (v) => { F().seedMode = v; if (v === 'fixed') setTimeout(() => $('seed').focus(), 0); });
  $('kind').addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) setMode(b.dataset.v); });
  $('budget').addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) { setDecode(Number(b.dataset.v)); radio($('budget'), decodeMB()); } });
  $('more').addEventListener('toggle', () => placeInd($('seedmode'), true));
  $('prompt').addEventListener('input', (e) => { F().prompt = e.target.value; syncPrompt(); saveDraft(); renderCta(); });
  $('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } });   // Return = done
  $('seed').addEventListener('input', (e) => { F().seed = e.target.value.replace(/\D/g, '').slice(0, 10); e.target.value = F().seed; saveDraft(); });
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const p = await shrinkPhoto(f); setPhoto(p.blob, p.w, p.h, true); } catch (err) { toast("That photo couldn't be opened. Try another, or a screenshot of it."); }
  });
  $('photo-x').onclick = () => { clearPhoto(); render(); };
  { const g = tapGuard(() => (S.phase === 'working' ? cancelTap() : make()));   // a double/triple tap on Make never arms Cancel ...
    $('cta').onclick = () => (S.phase === 'working' && S.job && S.job.armed ? cancelTap() : g()); }   // ... but an ARMED Cancel's deliberate 2nd tap always lands
  $('pill').onclick = () => {
    const chat = !S.run && Q && Q.active && Q.active.job.kind === 'chat';
    if (chat || (S.phase === 'error' && S.error && S.error.origin === 'assistant' && !S.run)) return go('assistant');
    go('create'); if (S.phase === 'error' && !$('err').hidden) $('err').scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => go(t.dataset.tab);
  SHELL.init({ go, tab: () => S.tab, toast, sheet: mvSheet, apps: () => APPS, chat: () => CH, diag,   // 3.9: the phone-OS shell (home screen, dock, badges, wallpaper)
    gameBusy: () => phoneBusy(Q, () => S.phase === 'working') });   // v4: a game on its own page leaves this one: never while a job is queued or running (its page would look like it died)
  if (PACKS[MODELS.nowcast.id] && $('v-nowcast')) SHELL.register({ id: 'nowcast', title: 'Nowcast', icon: 'icons/ui/nowcast.svg', view: 'v-nowcast', home: true, order: 1,   // v4: the Nowcast (Experimental) on the home screen
    onOpen: () => { const o = NC_OPEN; NC_OPEN = null; ncGlue().then((g) => g.open(o || {}), (e) => { diag('nowcast: could not start', { message: msg(e) }); toast('The Nowcast could not start.'); }); },
    onClose: () => { if (NC) NC.close(); if (Q && Q.holding && KEY_OF[Q.host && Q.host.currentId] === 'nowcast') Q.endHold(); } });
  $('need-go').onclick = tapGuard(() => dlTap(S.mode));
  // killed-last-run banner
  $('k-retry').onclick = () => {
    const kl = S.killed; S.killed = null;
    if (kl && kl.media === 'video') {
      const last = ls.get('pf.app.lastVideo'); if (!last || !last.prompt) { render(); return $('prompt').focus(); }
      if (!isPic(last.kind)) return startJob(last);
      // a picture clip killed before its first step: its pictures were saved first (the engine resumes by itself if the same job had a checkpoint)
      return store.getVideoInputs().then(async (items) => {
        const need = last.kind === 'flf' ? 2 : 1, p = Object.assign({}, last); delete p.resume;
        S.vform.src = srcOf(last.kind);
        if (!items || items.length < need || !items.slice(0, need).every((x) => x && x.blob)) { toast('Pick the pictures again'); return render(); }
        for (let i = 0; i < need; i++) await fillSlot(i, items[i].blob, 0, 0, items[i].from, items[i].libId, { attest: !!last.attested, keepShape: true });
        startJob(p, items.slice(0, need).map((x) => x.blob), items.slice(0, need).map(({ from, libId, thumb }) => ({ from, libId, thumb })));
      }, () => render());
    }
    const last = ls.get('pf.app.lastJob');
    if (!last || !last.prompt) { render(); return $('prompt').focus(); }
    if (last.kind !== 'i2i') return startJob(Object.assign({ media: 'image' }, last));
    if (!last.attested) { toast('Add the photo again and tick the box'); return render(); }   // unchanged params: the engine resumes from its checkpoint
    store.getBlob('last', 'inputs').then((b) => { if (b) startJob(Object.assign({ media: 'image' }, last), b); else { toast('Pick the photo again'); render(); } }, () => render());
  };
  $('k-small').onclick = () => {
    const kl = S.killed; S.killed = null;
    if (kl && kl.media === 'video') {
      const sm = VSMALLER[S.vform.size];
      if (sm) { S.vform.size = sm; toast(`Size set to ${vsize(sm).w}×${vsize(sm).h}`); } else { S.vform.len = Math.max(1, S.vform.len - 2); toast(`Length set to ${lenLabel(S.vform.len, SRC[vsrc()].kind)} s`); }
      ls.set('pf.app.lastVideo', null);
    } else { const sm = SMALLER[S.form.size]; if (sm) S.form.size = sm; ls.set('pf.app.lastJob', null); toast(`Shape set to ${size(S.form.size).name}`); }
    saveDraft(); render();
  };
  $('k-dismiss').onclick = () => { const kl = S.killed; S.killed = null; ls.set(kl && kl.media === 'video' ? 'pf.app.lastVideo' : 'pf.app.lastJob', null); render(); };
  // unfinished clip: resume (or decode only) with the checkpoint's own prompt / size / frames / seed
  $('c-go').onclick = tapGuard(() => {
    const c = ckNow(); if (!c || S.phase === 'working') return;
    restoreVForm({ prompt: c.prompt, width: c.width, height: c.height, frames: c.frames });
    if (isPic(c.mode) || c.mode === 'v2v') {   // the picture slot: the pinned pictures + latent are checkpointed, so no pictures are needed (v4: a restyle's clip too)
      S.vform.src = srcOf(c.mode); saveDraft();
      return startJob({ media: 'video', kind: c.mode, resume: true, prompt: c.prompt, width: c.width, height: c.height, frames: c.frames, seed: c.seed, attested: true });
    }
    startJob({ media: 'video', kind: 't2v', prompt: c.prompt, width: c.width, height: c.height, frames: c.frames, seed: c.seed });
  });
  $('c-x').onclick = () => { S.ckHidden = true; render(); };
  // result actions
  $('r-save').onclick = () => {
    const r = S.result; if (!r) return;
    shareItem(r, (f) => (isClip(r) ? saveFile(f) : openViewer(r.id, true)));   // v026.4: the copy that carries the AI label
  };
  $('r-again').onclick = () => {   // same prompt string: cache hit
    const r = S.result; if (!r) return;
    const p = Object.assign({}, r.params, { seed: newSeed() }); delete p.resume;
    if (isClip(r) && isPic(r.vmode)) { if (!r.input) { toast('Pick the pictures again'); return backToCompose(false); } return startJob(p, r.input, r.sources); }
    if (isClip(r) && r.vmode === 'v2v') { if (!r.input) { toast('Pick the clip again'); return backToCompose(false); } return startJob(p, r.input, r.sources); }   // v4: the same clip and first frame, a new seed
    startJob(p, r.input);
  };
  $('r-change').onclick = () => backToCompose(true);
  $('r-edit').onclick = () => { const r = S.result; if (!r || isClip(r)) return; const { blob, width, height } = r; S.form.prompt = ''; backToCompose(false); setPhoto(blob, width, height, false); S.form.size = sizeFor(width, height) || S.form.size; saveDraft(); syncPrompt(); render(); $('prompt').focus(); };
  $('r-seed').onclick = () => { const r = S.result; if (!r) return; Object.assign(F(r.media), { seedMode: 'fixed', seed: String(r.seed) }); $('more').open = true; saveDraft(); render(); toast(`Seed ${r.seed} will be used next`); };
  $('st-result').onclick = () => S.result && openViewer(S.result.id, false);
  // library + viewer
  $('grid').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (!t) return; if (S.sel) return selTap(t.dataset.id); openViewer(t.dataset.id, false, t); });
  $('v-close').onclick = closeViewer;
  V.reset = gestures($('v-stage'), vMedia, swipe);
  $('v-save').onclick = () => { if (V.blob && V.x) shareItem(V.x, () => saveHint(true)); };   // v026.4: labelled
  const notBusy = () => { if (S.phase === 'working') { toast('Wait — something is being made'); return false; } return true; };
  $('v-restyle').onclick = () => { if (!notBusy() || !V.meta || !isClip(V.meta) || !styleOK()) return; const m = V.meta, b = V.blob; closeViewer(); restyleFrom(m, b); };   // v4
  $('v-reuse').onclick = async () => {
    if (!notBusy() || !V.meta) return;
    if (isClip(V.meta) && V.meta.vmode === 'v2v' && styleOK()) { const m = V.meta; closeViewer(); return reuseStyle(m); }   // v4: the same look and words, its clip again
    const m = V.meta, clip = isClip(m), pic = clip && isPic(m.vmode) && picOK(); closeViewer();
    if (clip) { restoreVForm(m); S.vform.src = pic ? srcOf(m.vmode) : 'words'; saveDraft(); } else { clearPhoto(); restoreForm(m); }
    backToCompose(false); setMode(clip ? 'video' : 'image'); syncPrompt(); render(); placeAll();
    if (!pic) return toast('Prompt is ready — tap Make');
    const miss = await refillFrom((m.sources || []).slice(0, m.vmode === 'flf' ? 2 : 1));   // its Library pictures back in the slots
    toast(!miss ? 'Prompt and pictures are ready — tap Make' : miss === 1 ? 'Prompt is ready — add the missing picture' : 'Prompt is ready — add the pictures');
  };
  $('v-anim').onclick = () => { if (V.meta && isSong(V.meta)) { const m = V.meta, b = V.blob; closeViewer(); return void mvSong({ meta: m, blob: b }).then((x) => (x ? openAnimate(x) : toast("Couldn't open that song"))); }   // v023
    if (!notBusy() || !V.meta || isClip(V.meta) || !picOK()) return; const m = V.meta, b = V.blob; closeViewer(); animateFrom(m, b); };
  $('v-more').onclick = () => {
    if (V.meta && isClip(V.meta)) return openMenu('This clip', [   // v4 (Josh, Nov-02: "Move lipsync to more"): the clip row has room for Restyle and Make HDR
      ['Lip-sync · experimental', '#i-chat', () => { if (V.id && TALKUI) TALKUI.fromClip(V.id); }],
    ]);
    if (!V.meta) return; const m = V.meta, b = V.blob;
    openMenu('This picture', [
      ['Clip to another picture', '#i-frames', () => { if (!notBusy()) return; closeViewer(); clipToAnother(m, b); }],
      ['Reuse prompt', '#i-copy', () => $('v-reuse').click()],
    ]);
  };
  $('v-src-list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !V.meta) return;
    const x = (V.meta.sources || [])[Number(b.dataset.i)]; if (!x) return;
    if (x.libId && S.lib.some((m) => m.id === x.libId)) return viewerLoad(x.libId);
    if (V.meta.vmode === 'v2v') return toast(x.from === 'phone' ? 'That was a video from your phone; it isn’t in the Library.' : 'That clip was deleted from the Library.');   // v4
    toast(x.from === 'phone' ? 'That was a photo from your phone; it isn’t in the Library.' : 'That picture was deleted from the Library.');
  });
  $('v-edit').onclick = () => { if (V.meta && isMV(V.meta) && V.meta.mvId) { const id = V.meta.mvId; closeViewer(); return openBoard(id); }   // v023: Edit video = the storyboard
    if (!notBusy() || !V.meta || isClip(V.meta)) return; const m = V.meta, b = V.blob; closeViewer(); S.form.prompt = ''; backToCompose(false); setMode('image'); setPhoto(b, m.width, m.height, false); S.form.size = sizeFor(m.width, m.height) || S.form.size; saveDraft(); syncPrompt(); render(); };
  $('v-hdr').onclick = () => { if (V.meta && HDR) HDR.open(V.meta, { media: isClip(V.meta) ? $('v-vid') : null }); };   // v4: Make HDR (ui/hdr.js)
  $('v-del').onclick = () => { const id = V.id, m = V.meta; if (id) openSheet(isSong(m) ? 'Delete this song?' : isMV(m) ? 'Delete this music video?' : isClip(m) ? 'Delete this clip?' : 'Delete this picture?', 'It will be removed from this phone.', 'Delete', () => deleteItem(id)); };
  // settings
  $('s-allow').onclick = () => E.image.requestPersistentStorage().then((p) => { S.persisted = p; renderSettings(); if (!p) toast(ANDROID ? "Chrome didn't allow it yet. Installing p0pc0rn (menu › Add to Home screen) helps." : "iOS didn't allow it yet. Adding to Home Screen helps."); });
  // v019: the queue button in the header, Settings > Assistant
  for (const id of ['c-queue', 'as-queue', 's-queue']) $(id).onclick = () => { if (CH) CH.openQueue(); };
  if ($('s-lora')) $('s-lora').addEventListener('change', (e) => { ls.set('pf.app.loraOn', e.target.checked ? null : false); toast(e.target.checked ? 'Clips from pictures use the video LoRA' : 'Clips are made without the video LoRA'); });   // v4: on = the default
  if ($('s-lora2')) $('s-lora2').addEventListener('change', (e) => { ls.set('pf.app.lora2On', e.target.checked ? null : false); toast(e.target.checked ? 'Style video to video uses the looks LoRA' : 'Style video to video runs without the looks LoRA'); });   // v4 Phase 3
  $('s-homezip').addEventListener('change', (e) => {   // v4 (weather): 5 digits or empty (cleared)
    const v = String(e.target.value || '').replace(/\D/g, '');
    if (v && v.length !== 5) { e.target.value = HOME_ZIP.get() || ''; toast('A ZIP code has 5 digits.'); return; }
    HOME_ZIP.set(v || null); toast(v ? `Home ZIP ${v} saved, only on this phone.` : 'Home ZIP cleared.');
  });
  $('s-research').addEventListener('change', (e) => { AS.research = e.target.checked; ls.set('pf.app.research', AS.research); if (AG) AG.research = AS.research ? RS : null; });
  if ($('s-brain4')) $('s-brain4').addEventListener('change', (e) => { ls.set('pf.app.brain4Use', e.target.checked ? null : false); renderAssistantSettings(); });   // 3.8 (v040): on = the default
  $('s-review').addEventListener('change', (e) => { AS.review = e.target.checked; ls.set('pf.app.review', AS.review); if (AG) AG.hooks.review = AS.review; });
  $('brainmode').addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) { setBrainMode(b.dataset.v); ls.set('pf.app.brainModeBy', 'user'); ls.set(FULL_FAILS, 0); radio($('brainmode'), AS.brainMode); toast(AS.brainMode === 'lean' ? 'Juli loads lighter from its next chat' : 'Juli loads in full from its next chat'); } });
  // v021: the phone's own KB (every lookup kept for good): its count, and Clear (the KB, the 14-day cache, the misses)
  $('s-kbclear').onclick = () => openSheet('Clear what Juli has looked up?', 'The facts it looked up on Wikipedia and Fandom are kept on this phone, so asking again is instant. Clearing them means the next question looks things up again.', 'Clear', async () => {
    try { if (RS) await RS.clearAll(); toast('Cleared what Juli looked up'); } catch (e) { toast("Couldn't clear it"); }
    renderKB();
  });
  $('s-qclear').onclick = async () => {
    if (!Q) return; let n = 0;
    for (const j of Q.list()) if (j.root === j.id && TERMINAL.has(j.status) && !Q.descendants(j.id).some((d) => !TERMINAL.has(d.status))) { await Q.remove(j.id).catch(() => {}); n++; }
    toast(n ? `Cleared ${n} finished ${n === 1 ? 'job' : 'jobs'}` : 'Nothing to clear'); renderSettings();
  };
  $('s-clean').onclick = askClean;
  // sheet, toast, gate
  $('sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  // v026.4: the LTX-2 licence (accepted before the video model / picture reader download), Licences and notices, the credits
  $('ltx').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeLtx(); });
  $('ltx-ok').onclick = acceptLtx; $('ltx-gemma').addEventListener('change', ltxSync);   // the Gemma tick
  buildLtx(); buildLic();
  $('lic').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeWrap('lic'); });
  $('docv').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeWrap('docv'); });
  $('s-lic').onclick = openLic;
  $('s-credits').onclick = openCredits;
  initSettings({ placeInd, cast: CAST, castUi: () => CASTUI, diag, apps: () => APPS });   // 3.9 polish: Settings' groups (every 3.8 id and handler kept), the Cast screen
  initTune({ appVersion: APP_VERSION, busy: () => !!phoneBusy(Q, () => S.phase === 'working'), consented, e4bHere: () => E4B_HERE(), e4bWhy: () => E4B_WHY(),
    before: () => (VOICEIN ? VOICEIN.release('speed tune') : null),   // v4: voice input lets go of its memory first
    wake: (on) => (on ? wake.on() : wake.off()), diag });   // v4: the kernel tune: asks on a first run / after an update, and from Settings
  scheduleAsk(4000);
  $('sh-ok').onclick = () => { const f = sheetOk; sheetOk = null; closeSheet(); if (f) f(); };
  $('toast-btn').onclick = () => { const f = toastAct; toastAct = null; $('toast').classList.remove('on'); if (f) f(); };
  $('g-retry').onclick = () => (S.stop && S.stop.retry === 'boot' ? boot() : location.reload());
  $('g-in-safari').onclick = () => { if (S.phase !== 'setup') return; S.phase = 'boot'; enterApp(); };   // onboarding: the app (a new install: the chat, whose first message offers the downloads); a 2nd tap is a no-op
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    autoResume();
    if (S.phase === 'working') { tick(); toast('Keep p0pc0rn open while it works'); }
  });
  addEventListener('online', autoResume);
  addEventListener('resize', () => placeAll());
  syncPrompt();
  store.open().then(loadLib);
  boot();
}
// v030: the first update that changes the page's elements, and GitHub Pages lets a phone keep a file for 10 minutes. index.html asks
// for app.js?v=030, so a new page never meets an old app.js; a phone that kept the OLD index.html but fetched this app.js can't start
// on it (no Gemma tick), so it loads the page once more, past its cache (once: the 'fresh' mark stops a loop)
if (!document.getElementById('home-grid') && !new URL(location.href).searchParams.has('fresh')) {   // 3.9 (review): only 3.9's page has it (3.8's had ltx-gemma too)
  const u = new URL(location.href); u.searchParams.set('fresh', Date.now().toString(36)); location.replace(u.href);
} else init();
