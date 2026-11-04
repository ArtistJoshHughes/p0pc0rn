// voice_pick.js - which module is Juli's voice (voice.js reads this). null = the stand-in (voice_standin.js, built in). v4: her voice is
// CMU Flite with its cmu_us_slt voice (voice/flite_voice.js over voice/juli_tts.mjs + .wasm and voice/cmu_us_slt.flitevox).
// A module named here that is missing or fails to load falls back to the stand-in. Naming none keeps the page from asking for a file
// that is not there: Chrome logs "Failed to load resource: 404" for a missing import() or fetch() even when it is caught (measured,
// desk_trolley_voice.mjs), and the desk tests count console errors.
export const VOICE_MODULE = './voice/flite_voice.js';
// run the named module in a module Worker (voice_worker.js), so a line's synthesis never blocks a frame; false = on the main thread,
// in its own task, sentence by sentence (the stand-in always runs there unless createVoice({ worker: true }) asks otherwise)
export const VOICE_IN_WORKER = true;
