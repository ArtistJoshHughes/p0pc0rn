// pocketflux.js - the p0pc0rn ENGINE BRIDGE (keep it small: every engine is reached through it).
// A classic script that exposes ONE global, PF. The app calls `const eng = await PF.createEngine({ model })` once per model and then
// uses the engine API in ENGINE_API.md (status, download, textToImage, imageToImage, textToVideo, videoCheckpoint, cancel, on/off, ...).
// Each model has its own pack (its address comes from config.js) and its own OPFS folder inside the engine (engine MODELS registry).
// v018: the video engine also gets the picture reader's pack (LTX-2.3 still encoder, 213 MB, its own OPFS folder engine/ltx23-still-enc),
// which turns on imageToVideo / framesToVideo / resumeVideo / encoderStatus / downloadEncoder / deleteEncoder (ENGINE_API.md section 8).
// v019: two more engines, each its own ES module tree under engine/ (ENGINE_API.md sections 9 and 10):
//   'gemma4-e2b'      the assistant (Gemma 4 E2B-it, engine/llm/llm_engine.js): status / download / load / unload / chat
//   'acestep15-turbo' songs (ACE-Step 1.5 turbo + the optional lyrics planner, engine/music/music.js): textToMusic / lmStatus / downloadLM
(function () {
  // v026.6: every pack address comes from config.js (P0_CONFIG, loaded first); the assistant pack keeps its own OPFS folder there too
  var CFG = window.P0_CONFIG || { packs: {} };
  var PACKS = Object.assign({}, CFG.packs);
  var ASSISTANT_PACK = Object.assign({ url: PACKS['gemma4-e2b'] }, CFG.assistantPack || {});   // v020: GPTQ 4-bit MLPs + 8-bit attention/gates
  var PACK_URL = PACKS['flux2-klein-4b'];
  var ENGINE_MODULE = './engine/pocketflux-engine.js';   // the real on-device engine 0.3.4 + i2v 0.2.0 (tests swap this line for a mock)
  var LLM_MODULE = './engine/llm/llm_engine.js';         // the assistant engine (tests swap this line for a mock)
  var MUSIC_MODULE = './engine/music/music.js';          // the music engine (tests swap this line for a mock)
  var base = (document.currentScript && document.currentScript.src) || location.href;
  var load = function () { return import(new URL(ENGINE_MODULE, base).href); };
  var modFor = function (model) {
    if (model === 'gemma4-e2b') return import(new URL(LLM_MODULE, base).href);
    if (model === 'acestep15-turbo') return import(new URL(MUSIC_MODULE, base).href);
    return load();
  };
  window.PF = {
    packUrl: PACK_URL,
    packs: PACKS,
    starterPack: PACKS['starter-kb'],
    assistantPack: ASSISTANT_PACK,
    createEngine: function (opts) {
      var o = Object.assign({ model: 'flux2-klein-4b' }, opts || {});
      return modFor(o.model).then(function (m) {
        if (!o.packUrl) o.packUrl = PACKS[o.model] || PACK_URL;
        if (o.model === 'sanavideo2-5b' && !o.encoderPackUrl) o.encoderPackUrl = PACKS['ltx23-still-enc'];
        if (o.model === 'gemma4-e2b' && !o.dir) o.dir = ASSISTANT_PACK.dir;
        return m.createEngine(o);
      });
    },
    /** the engine's model registry ({id: {kind, dir, wipe, ...}}): which OPFS folders belong to which model */
    registry: function () { return load().then(function (m) { return m.MODELS || null; }); },
    /** the picture reader's registry entry ({id, dir, wipe, ...}) or null when the engine has no picture modes */
    encoder: function () { return load().then(function (m) { return m.ENCODER || null; }); }
  };
})();
