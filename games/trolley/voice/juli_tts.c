/* juli_tts.c - p0pc0rn: a tiny C entry point over CMU Flite 2.2 for the browser build (WebAssembly).
   Modifications by Josh Hughes for p0pc0rn (Nov 2026): this file is new; Flite's own sources are compiled unchanged.
   Flite is Copyright (c) 1999-2017 Language Technologies Institute, Carnegie Mellon University (see LICENSE-flite.txt).

   juli_init(path)            load a .flitevox voice already written to the in-memory file system -> 1 ok, 0 failed
   juli_speak(text, &n, &hz)  synthesise text -> pointer to n 16-bit samples at hz (valid until the next call)  */
#include "flite.h"

void usenglish_init(cst_voice *v);
cst_lexicon *cmulex_init(void);

static cst_voice *voice = 0;
static cst_wave *wave = 0;

int juli_init(const char *path)
{
    flite_init();
    flite_add_lang("eng", usenglish_init, cmulex_init);
    flite_add_lang("usenglish", usenglish_init, cmulex_init);
    voice = flite_voice_load(path);
    return voice ? 1 : 0;
}

short *juli_speak(const char *text, int *n, int *hz)
{
    if (wave) { delete_wave(wave); wave = 0; }
    if (!voice || !text) { *n = 0; *hz = 0; return 0; }
    wave = flite_text_to_wave(text, voice);
    if (!wave) { *n = 0; *hz = 0; return 0; }
    *n = wave->num_samples;
    *hz = wave->sample_rate;
    return wave->samples;
}
