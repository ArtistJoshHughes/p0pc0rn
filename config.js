// config.js - where p0pc0rn's models come from: the ONE place for every pack address. No other file may hard-code one.
// Release candidate: every pack is a public Hugging Face repository by JoshHughes, read at a PINNED revision: resolve/<commit sha>/
// (CORS and HTTP Range work there; the download follows Hugging Face's redirect to its CDN). Next to each address is the sha256 of the
// pack's manifest.json: the phone checks every manifest it downloads against it before it uses or keeps it (engine/core/pin.js), and
// the manifest lists the sha256 of every 16 MiB chunk, which the phone checks before it keeps the chunk. A manifest that does not match
// is refused (a phone that has the pack keeps its own copy). Licences and notices: MODELS.md, NOTICE.md.
// A classic script loaded BEFORE pocketflux.js: it defines one global, P0_CONFIG.
(function () {
  var HF = 'https://huggingface.co/';
  // each repository's upload commit (40 hex): the packs are read at exactly that revision. Klein 9B reads 'main' until its commit
  // pin lands in the next update; its manifest sha256 below still pins every byte of it.
  var REV = {
    'flux2-klein-4b': '37790478492991e235008d292fa14d686b0625bb', 'flux2-klein-9b': 'main', 'sanavideo2-5b': '4415a9a340a3770ce3d779acd616c4269dfb5f6c', 'ltx23-still-enc': 'f6abf6baf632af19a6a2d5f9e05428207ca35fa3', 'gemma4-e2b': '141f0e8665691d74f824c4469725cf19a2ded9e8',
    'acestep15-turbo': 'd9cbd6ddb0bcd8ca2edc950d523e0c738136efe5', 'qwen3-tts-0.6b': '26a6f7acbd6f80f206756c2a72ab6f99c1df930f', 'musetalk-1.5': '526a7ece698aa7512fe285a252ff6137f22b8c04', 'starter-kb': '8c86bfa537ce8f96fabb849b276c968d00ca490c'
  };
  var hf = function (key, repo) { return HF + repo + '/resolve/' + REV[key] + '/'; };
  var PACKS = {
    //                   address                                                                manifest.json sha256
    'flux2-klein-4b':  [hf('flux2-klein-4b', 'JoshHughes/p0pc0rn-klein-4b-q4'),                '501bd72ce5633486db7756107fe973b0c516a4d6b31f8c727dfecee840a94868'],   // FLUX.2 [klein] 4B, pictures, 4.6 GB
    'flux2-klein-9b':  [hf('flux2-klein-9b', 'JoshHughes/p0pc0rn-klein-9b-q4'),                'c58df346c543692ebeda0c7ac2cbc34cf364cbf71c17ec4aea5bd79677a4025d'],   // FLUX.2 [klein] 9B, better pictures, 9.6 GB
    'sanavideo2-5b':   [hf('sanavideo2-5b', 'JoshHughes/p0pc0rn-video-sana-5b-q4'),            '91f1a1c52bc241917f7c42140f0f3643b3e44bed2e093a0474083770428df0ce'],   // SANA-Video 2.0 5B, videos, 5.7 GB
    'ltx23-still-enc': [hf('ltx23-still-enc', 'JoshHughes/p0pc0rn-picture-reader-f16'),        '852a046ce368042493a0eb705ee9c74cc0236b781f34607413d8ec466dfa4f20'],   // the picture reader (LTX-2.3 VAE encoder), 213 MB
    'gemma4-e2b':      [hf('gemma4-e2b', 'JoshHughes/p0pc0rn-assistant-gemma4-e2b-q4'),        'e34bc23f7aa8c17244b53068e402a55fbc0ec68fb989b42e2615c7439d792178'],   // the assistant (Gemma 4 E2B-it, balanced), 3.3 GB
    'acestep15-turbo': [hf('acestep15-turbo', 'JoshHughes/p0pc0rn-songs-ace-step-15-turbo'),   '8c21def5c0b255b6bdca1f37d679fc7d2ae67293ade5a52aa4c07859276679e0',    // songs (ACE-Step 1.5 turbo), 2.8 GB
                        { 'lm/':                                                               '298e9b63aa5f73fc7ded2f69a92438b8155e744c9387f8737a78ed0f92ba1818' }], //   its lyrics planner (<songs pack>lm/)
    'qwen3-tts-0.6b':  [hf('qwen3-tts-0.6b', 'JoshHughes/p0pc0rn-voice-qwen3-tts-06b'),        '3269e07668e9672584b2d3a1e31d38a16097d2d572bb189a69d3c90ad7ce7548'],   // Cast voices (Qwen3-TTS 0.6B), 1.4 GB
    'musetalk-1.5':    [hf('musetalk-1.5', 'JoshHughes/p0pc0rn-lipsync-musetalk-15'),          '14f8df9ad2ab1f003590b577f55aac3d3f1aa6a8a0e821364e37a50f53108374'],   // lip-sync, experimental (MuseTalk 1.5), 1.0 GB
    'starter-kb':      [hf('starter-kb', 'datasets/JoshHughes/p0pc0rn-starter-kb'),            'b654e4ad03d69a87c685851d29d02a449c19b285d390f1a52e419f44dc0a6c3b']    // the starter knowledge pack (3,214 Wikipedia articles), 2.6 MB
  };
  var packs = {}, pins = {};
  for (var k in PACKS) {
    packs[k] = PACKS[k][0]; pins[k] = PACKS[k][1];
    var sub = PACKS[k][2] || {}; for (var s in sub) pins[k + '/' + s] = sub[s];   // a sub-pack: 'pack/sub/' = <pack address>sub/manifest.json
  }
  window.P0_CONFIG = {
    packs: packs,
    manifestSha256: pins,
    // the assistant pack's own OPFS folder (a phone that installed it keeps it: same folder + same manifest = installed)
    assistantPack: { dir: 'pocketllm/pack_bal', name: 'balanced', bytes: 3262871724 }
  };
})();
