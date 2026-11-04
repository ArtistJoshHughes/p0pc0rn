// mic.js - Pocket STT: the microphone at 16 kHz, opened only inside a tap (the browser asks for permission the first time).
//   const mic = await openMic16k({ onAudio(Float32Array 320 samples), onLevel(rms) }); ... await mic.close();
// The audio goes from the AudioWorklet (mic_worklet.js: resampled there) straight to onAudio; nothing is recorded or kept here.
// Echo cancellation stays on (Juli's voice from the speaker must not be heard as yours); the browser's noise suppression and level too.
'use strict';

export async function openMic16k({ onAudio, onLevel } = {}) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('This browser has no microphone access.'), { code: 'NO_MIC' });
  const ctx = new AC({ latencyHint: 'interactive' });
  try { await ctx.resume(); } catch (e) { /* resumed by the tap */ }
  if (!ctx.audioWorklet) { try { await ctx.close(); } catch (e) { /* */ } throw Object.assign(new Error('This browser has no audio worklets.'), { code: 'NO_MIC' }); }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { try { await ctx.close(); } catch (e2) { /* */ } throw Object.assign(new Error('The microphone is not allowed: ' + (e.message || e.name)), { code: 'NO_MIC', name2: e && e.name }); }
  let node, src, mute;
  try {
    await ctx.audioWorklet.addModule(new URL('./mic_worklet.js', import.meta.url).href);
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'p0-mic16k', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { inRate: ctx.sampleRate } });
    mute = ctx.createGain(); mute.gain.value = 0;
    node.port.onmessage = (e) => {
      const b = e.data; if (!(b instanceof Float32Array)) return;
      if (onLevel) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; try { onLevel(Math.sqrt(s / b.length)); } catch (x) { /* */ } }
      if (onAudio) try { onAudio(b); } catch (x) { console.error(x); }
    };
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop()); try { await ctx.close(); } catch (e2) { /* */ }
    throw Object.assign(new Error('The microphone could not start: ' + (e.message || e)), { code: 'NO_MIC' });
  }
  let closed = false;
  return {
    rate: ctx.sampleRate,
    async close() {
      if (closed) return; closed = true;
      try { node.port.postMessage('stop'); node.port.onmessage = null; src.disconnect(); node.disconnect(); mute.disconnect(); } catch (e) { /* */ }
      stream.getTracks().forEach((t) => t.stop());   // the phone's microphone light goes off
      try { await ctx.close(); } catch (e) { /* */ }
    },
  };
}
