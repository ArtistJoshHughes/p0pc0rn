// ui/voicetalk.js - v4: Juli speaks her replies (voice mode). Her words arrive as they are written; each sentence is spoken as soon as it
// is complete (the first one while the rest is still being written), in order, through ui/voiceout.js (her own voice; Flite as the fallback). Stop ends it at
// once. The audio plays through one AudioContext made inside a tap (iOS); an analyser on it feeds the "Juli is speaking" wave.
//   const t = createTalker({ voice: createVoiceOut(), onState }); t.unlock() (in a tap); t.begin(); t.feed(textSoFar); t.end(finalText); t.stop();

/** the sentences of `text` from character `from` that are complete (a . ! ? or … followed by a space or the end when `final`) ->
 *  { parts: [sentence], next: the index after the last one } */
export function nextSentences(text, from = 0, final = false) {
  const t = String(text || ''), parts = []; let i = from;
  for (;;) {
    const rest = t.slice(i), m = /^\s*([\s\S]*?[.!?…]+["'”’)]*)(?=\s)/.exec(rest);
    if (m && m[1].trim()) { parts.push(m[1].trim()); i += m[0].length; continue; }
    if (final && rest.trim()) { parts.push(rest.trim()); i = t.length; }
    break;
  }
  return { parts, next: i };
}

export function createTalker({ voice, onState = () => {}, diag = () => {} } = {}) {
  let ctx = null, an = null, chain = Promise.resolve(), turn = 0, at = 0, playEnd = 0, live = new Set(), speaking = false, firstAt = null;
  const state = (s) => { if (s !== speaking) { speaking = s; try { onState(s ? 'speaking' : 'idle'); } catch (e) { /* */ } } };
  const T = {
    /** inside a tap: the AudioContext (iOS lets a page start sound only from a gesture) */
    unlock() {
      try {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return;
        if (!ctx) { ctx = new AC({ latencyHint: 'interactive' }); an = ctx.createAnalyser(); an.fftSize = 512; an.connect(ctx.destination); }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch (e) { diag('voice: no audio', { message: String((e && e.message) || e).slice(0, 80) }); }
    },
    get analyser() { return an; },
    get speaking() { return speaking; },
    /** a new reply: whatever was still playing stops */
    begin() { T.stop(); at = 0; firstAt = null; },
    /** another model call in the same turn (after a lookup): its words start from 0, what is playing goes on */
    next() { at = 0; },
    /** the reply so far (no mood tag, no tool call): its complete sentences are spoken */
    feed(text) { const r = nextSentences(text, at, false); at = r.next; for (const p of r.parts) say(p); },
    /** the whole reply: the rest is spoken */
    end(text) { const r = nextSentences(text, at, true); at = r.next; for (const p of r.parts) say(p); },
    /** one whole reply at once (a reply that did not stream) */
    speak(text) { T.begin(); T.end(text); },
    stop() {
      turn++; chain = Promise.resolve(); playEnd = 0;
      for (const s of live) { try { s.onended = null; s.stop(); } catch (e) { /* */ } } live.clear(); state(false);
    },
    get firstSoundAt() { return firstAt; },
  };
  function say(sentence) {
    const t = turn;
    chain = chain.then(async () => {
      if (t !== turn || !ctx) return;
      let r; try { r = await voice.speak(sentence); } catch (e) { diag('voice: a sentence was not spoken', { message: String((e && e.message) || e).slice(0, 80) }); return; }
      if (t !== turn || !r.pcm || !r.pcm.length) return;
      const buf = ctx.createBuffer(1, r.pcm.length, r.sampleRate); buf.copyToChannel(r.pcm, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(an);
      const when = Math.max(ctx.currentTime + 0.02, playEnd); playEnd = when + buf.duration;
      live.add(src); src.onended = () => { live.delete(src); if (!live.size && t === turn) state(false); };
      src.start(when); if (firstAt == null) firstAt = performance.now() + (when - ctx.currentTime) * 1000;
      state(true);
    });
  }
  return T;
}
