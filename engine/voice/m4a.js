// Pocket Voice audio I/O helpers: decode + resample any reference recording to 24 kHz mono, and the WAV writer.
'use strict';

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
const desc = (tag, ...payload) => { const p = payload.flat(Infinity), n = p.length; return [tag, 0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f, ...p]; };

/** any Blob / ArrayBuffer / AudioBuffer / {samples, sampleRate} -> {samples Float32Array (mono, 24 kHz), seconds, srcRate} */
export async function toMono24k(input) {
  let ab = null, buf = null;
  if (input && input.samples && input.sampleRate) { if (input.sampleRate === 24000) return { samples: Float32Array.from(input.samples), seconds: input.samples.length / 24000, srcRate: 24000 }; buf = { sampleRate: input.sampleRate, numberOfChannels: 1, length: input.samples.length, getChannelData: () => input.samples }; }
  else if (typeof AudioBuffer !== 'undefined' && input instanceof AudioBuffer) buf = input;
  else if (input instanceof ArrayBuffer) ab = input;
  else if (input && typeof input.arrayBuffer === 'function') ab = await input.arrayBuffer();
  else throw Object.assign(new Error('Could not read that audio.'), { code: 'BAD_AUDIO' });
  if (!buf) {   // decode straight to 24 kHz (an OfflineAudioContext at 24 kHz resamples once, inside the browser's decoder)
    let srcRate = 0;
    try { const oc = new OfflineAudioContext(1, 1, 24000); buf = await new Promise((res, rej) => { const p = oc.decodeAudioData(ab.slice(0), res, rej); if (p && p.then) p.then(res, rej); }); }
    catch (e) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext, ctx = new Ctx();
      try { buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab.slice(0), res, rej); if (p && p.then) p.then(res, rej); }); }
      catch (e2) { throw Object.assign(new Error('This browser cannot decode that audio file.'), { code: 'BAD_AUDIO' }); }
      finally { try { await ctx.close(); } catch (e3) { /* */ } }
    }
    void srcRate;
  }
  const n = buf.length, ch = buf.numberOfChannels, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  if (buf.sampleRate === 24000) return { samples: mono, seconds: n / 24000, srcRate: 24000 };
  const m = Math.round(n * 24000 / buf.sampleRate), oc = new OfflineAudioContext(1, m, 24000), b = oc.createBuffer(1, n, buf.sampleRate);
  b.copyToChannel(mono, 0); const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
  const out = (await oc.startRendering()).getChannelData(0);
  return { samples: Float32Array.from(out), seconds: m / 24000, srcRate: buf.sampleRate };
}

/** mono float32 -> 16-bit PCM WAV bytes */
export function wav16(x, sampleRate) {
  const n = x.length, buf = new Uint8Array(44 + n * 2), dv = new DataView(buf.buffer);
  buf.set(str('RIFF'), 0); dv.setUint32(4, 36 + n * 2, true); buf.set(str('WAVE'), 8); buf.set(str('fmt '), 12); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  buf.set(str('data'), 36); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, x[i])); dv.setInt16(44 + i * 2, Math.round(s * 32767), true); }
  return buf;
}

// v002: the AAC .m4a muxer moved to engine/media/m4a.js (the ASC built from the rate + channels; v001's took the encoder's description,
// which Safari fills with a whole ES descriptor).
