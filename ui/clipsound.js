// clipsound.js - v4: a clip's own sound for Create › Video › Restyle a clip (the notes, Nov 2: "When a user uses their own video recorded with
// sound that sound needs to be mux over the clip"). The sound is read ONCE, when the clip is picked, from its sound track only: the moov
// box and the sound's own samples (engine/audio/mp4av.js readAudioTrack), never the picture, so a long 4K camera video is never read
// whole. Its first seconds are decoded (WebCodecs AudioDecoder; else a small audio-only file through decodeAudioData), placed on the
// clip's own timeline (the track's edit list: a later start, the encoder's priming), made 48 kHz stereo and kept as a small WAV beside
// the clip's frames. When the restyle is done the WAV is cut to EXACTLY the new clip's length (81 frames at 16 fps = 5.0625 s), its last
// few ms faded so the cut does not click, encoded (AAC, else Opus: engine/media/m4a.js) and muxed under the restyled picture, whose
// samples are copied untouched (remuxWithAudio, exact: the sound ends with the last frame). A whole video restyled in parts is joined
// first (assistant/mp4.js concatVideo: the frame two parts share is kept once, no re-encode), then gets its sound the same way.
import { boxHead, MOOV_MAX } from './clipposter_core.js';
import { STYLE_FPS } from './style_v2v.js';

export const SOUND_RATE = 48000;
export const FADE_MS = 6;                // the fade at the cut: 288 samples at 48 kHz, no click and nothing heard
export const WHOLE_MAX = 48 << 20;       // a file that is not an MP4 / MOV is decoded whole only up to this size (never a long camera video)
export const WAV_TYPE = 'audio/wav';
const bad = (code, m) => Object.assign(new Error(m), { code });

// ------------------------------------------------------------------------------------------------ pure
/** the samples of sound a clip of `frames` frames carries: exactly its picture's length (81 frames at 16 fps = 5.0625 s = 243,000) */
export const soundLen = (frames, fps = STYLE_FPS, rate = SOUND_RATE) => Math.round((frames / fps) * rate);
/** pcm {channels, sampleRate} -> exactly n samples (silence after its end when it is shorter), the last fadeMs faded out */
export function cutSound(pcm, n, fadeMs = FADE_MS) {
  const rate = pcm.sampleRate, f = Math.min(n, Math.max(1, Math.round((fadeMs / 1000) * rate)));
  const channels = pcm.channels.map((c) => { const o = new Float32Array(n); o.set(c.subarray(0, Math.min(n, c.length))); return o; });
  for (const o of channels) for (let i = 0; i < f; i++) o[n - 1 - i] *= i / f;   // the very last sample is 0
  return { channels, sampleRate: rate };
}
/** pcm (1 or 2 channels) -> 16-bit stereo WAV bytes */
export function wavBytes(pcm) {
  const L = pcm.channels[0], R = pcm.channels[1] || L, n = L.length, rate = pcm.sampleRate;
  const out = new Uint8Array(44 + n * 4), dv = new DataView(out.buffer), w4 = (p, s) => { for (let i = 0; i < 4; i++) out[p + i] = s.charCodeAt(i); };
  w4(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w4(8, 'WAVE'); w4(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w4(36, 'data'); dv.setUint32(40, n * 4, true);
  const q = (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  for (let i = 0; i < n; i++) { dv.setInt16(44 + 4 * i, q(L[i]), true); dv.setInt16(46 + 4 * i, q(R[i]), true); }
  return out;
}
/** 16-bit PCM WAV bytes (1 or 2 channels) -> pcm {channels (2), sampleRate} or null */
export function readWav(ab) {
  const u8 = ab instanceof Uint8Array ? ab : new Uint8Array(ab), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), s4 = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  if (u8.length < 44 || s4(0) !== 'RIFF' || s4(8) !== 'WAVE') return null;
  let fmt = null;
  for (let p = 12; p + 8 <= u8.length;) {
    const id = s4(p), size = dv.getUint32(p + 4, true), body = p + 8;
    if (id === 'fmt ') fmt = { tag: dv.getUint16(body, true), ch: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    else if (id === 'data' && fmt) {
      if (fmt.tag !== 1 || fmt.bits !== 16 || !(fmt.ch >= 1)) return null;
      const n = Math.floor(Math.min(size, u8.length - body) / (2 * fmt.ch)), L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = body + 2 * fmt.ch * i; L[i] = dv.getInt16(a, true) / 32768; R[i] = fmt.ch > 1 ? dv.getInt16(a + 2, true) / 32768 : L[i]; }
      return { channels: [L, R], sampleRate: fmt.rate };
    }
    p = body + size + (size & 1);
  }
  return null;
}
/** the decode-order samples of a sound track that cover the clip's first `seconds` (its edit list counted, one more for the overlap) */
export function soundSpan(track, seconds) {
  const ts = track.timescale, until = (track.mediaStart || 0) / ts + Math.max(0, seconds - (track.delay || 0));
  let n = 0; while (n < track.samples.length && track.samples[n].dts / ts < until) n++;
  return Math.min(track.samples.length, n + 1);
}
/** samples [{off, size}] -> runs of samples that sit one after another in the file [{off, size, from, to}] (one read each) */
export function runsOf(samples) {
  const out = [];
  samples.forEach((s, i) => { const r = out[out.length - 1]; if (r && r.off + r.size === s.off) { r.size += s.size; r.to = i + 1; } else out.push({ off: s.off, size: s.size, from: i, to: i + 1 }); });
  return out;
}
/** decoded blocks [{ts (media time, s), data: [Float32Array per channel]}] -> the clip's first `seconds` as stereo at `rate`: media time m
 *  is heard at m - mediaStart + delay (the track's edit list); before the sound starts and after it ends: silence */
export function placeSound(blocks, { rate, seconds, delay = 0, mediaStart = 0 }) {
  const n = Math.max(1, Math.round(seconds * rate)), L = new Float32Array(n), R = new Float32Array(n);
  for (const b of blocks) {
    const at = Math.round((b.ts - mediaStart + delay) * rate), l = b.data[0], r = b.data[1] || l;
    for (let i = Math.max(0, -at), m = Math.min(l.length, n - at); i < m; i++) { L[at + i] = l[i]; R[at + i] = r[i]; }
  }
  return { channels: [L, R], sampleRate: rate };
}

// ------------------------------------------------------------------------------------------------ reading the sound (browser)
const aborted = (signal) => { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
/** the moov box's bytes of an MP4 / MOV (the top-level boxes walked from 16-byte reads) or null */
async function moovOf(blob) {
  for (let at = 0, i = 0; i < 64 && at + 8 <= blob.size; i++) {
    const h = boxHead(new Uint8Array(await blob.slice(at, Math.min(blob.size, at + 16)).arrayBuffer()), blob.size, at);
    if (!h) return null;
    if (h.type === 'moov') return h.size > MOOV_MAX ? null : new Uint8Array(await blob.slice(at, at + h.size).arrayBuffer());
    at += h.size;
  }
  return null;
}
/** the sound samples the clip's first seconds need, read run by run -> [Uint8Array] (one per sample) */
async function samplesOf(blob, track, k, signal) {
  const S = track.samples.slice(0, k), out = new Array(S.length);
  for (const r of runsOf(S)) {
    aborted(signal);
    const u8 = new Uint8Array(await blob.slice(r.off, r.off + r.size).arrayBuffer());
    for (let i = r.from, o = 0; i < r.to; o += S[i].size, i++) out[i] = u8.subarray(o, o + S[i].size);
  }
  return out;
}
/** WebCodecs AudioDecoder: each sample at its own time -> blocks, or null when this browser cannot */
async function viaDecoder(track, data) {
  if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') return null;
  const cfg = track.codec === 'aac' ? Object.assign({ codec: `mp4a.40.${track.aot || 2}`, sampleRate: track.sampleRate, numberOfChannels: track.channels }, track.asc ? { description: track.asc } : {})
    : track.codec === 'opus' ? { codec: 'opus', sampleRate: 48000, numberOfChannels: track.channels } : null;
  if (!cfg) return null;
  try { const s = await AudioDecoder.isConfigSupported(cfg); if (!s || !s.supported) return null; } catch (e) { return null; }
  const blocks = []; let err = null, rate = 0;
  const dec = new AudioDecoder({ output: (ad) => {
    try { const d = []; for (let c = 0; c < Math.min(2, ad.numberOfChannels); c++) { const a = new Float32Array(ad.numberOfFrames); ad.copyTo(a, { planeIndex: c, format: 'f32-planar' }); d.push(a); } rate = ad.sampleRate; blocks.push({ ts: ad.timestamp / 1e6, data: d }); }
    catch (e) { err = e; } finally { ad.close(); }
  }, error: (e) => { err = e; } });
  try {
    dec.configure(cfg);
    const ts = track.timescale;
    for (let i = 0; i < data.length; i++) {
      const s = track.samples[i];
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((s.dts * 1e6) / ts), duration: Math.round((s.dur * 1e6) / ts), data: data[i] }));
      if (dec.decodeQueueSize > 64) await new Promise((r) => setTimeout(r, 0));
      if (err) throw err;
    }
    await dec.flush();
  } finally { try { dec.close(); } catch (e) { /* closed */ } }
  if (err) throw err;
  return blocks.length ? { blocks, rate: rate || track.sampleRate } : null;
}
/** the same samples as a small audio-only MP4 through decodeAudioData (an older browser): the decoder may or may not skip the priming
 *  itself; its length says which */
async function viaM4a(track, data) {
  if (track.codec !== 'aac' || !track.asc || typeof OfflineAudioContext === 'undefined') return null;
  const { muxM4a } = await import('../engine/media/m4a.js');
  const rate = track.sampleRate, k = rate / track.timescale, frames = track.samples.slice(0, data.length).map((s) => Math.max(1, Math.round(s.dur * k)));
  const priming = Math.round((track.mediaStart || 0) * k), total = frames.reduce((a, b) => a + b, 0);
  const bytes = muxM4a({ codec: 'aac', sampleRate: rate, channels: track.channels, asc: track.asc, priming, samples: data.map((d, i) => ({ data: d, frames: frames[i] })) });
  const ctx = new OfflineAudioContext(2, rate, rate), buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const skipped = Math.abs(buf.length - (total - priming)) < Math.abs(buf.length - total);   // it honoured the edit list
  const d = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
  return { blocks: [{ ts: (skipped ? priming : 0) / rate, data: d }], rate: buf.sampleRate };
}
/** pcm at any rate -> 48 kHz stereo (the browser's own resampler) */
async function to48k(pcm) {
  if (pcm.sampleRate === SOUND_RATE || typeof OfflineAudioContext === 'undefined') return pcm;
  const n = pcm.channels[0].length, m = Math.max(1, Math.round((n * SOUND_RATE) / pcm.sampleRate));
  const ctx = new OfflineAudioContext(2, m, SOUND_RATE), b = ctx.createBuffer(2, n, pcm.sampleRate);
  b.copyToChannel(pcm.channels[0], 0); b.copyToChannel(pcm.channels[1] || pcm.channels[0], 1);
  const src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start();
  const out = await ctx.startRendering();
  return { channels: [out.getChannelData(0).slice(), out.getChannelData(1).slice()], sampleRate: SOUND_RATE };
}
/** a picked clip -> its first `seconds` of sound as 48 kHz stereo {pcm, via, codec, rate, channels}; {none: 'none'} (it has no sound track) or
 *  {none: 'unreadable', why} (this phone cannot decode it). Only the sound track is read (an MP4 / MOV); any other file only when small. */
export async function readSound(blob, { seconds, signal } = {}) {
  let moov = null; try { moov = await moovOf(blob); } catch (e) { moov = null; }
  if (moov) {
    const { readAudioTrack } = await import('../engine/audio/mp4av.js');
    let track = null; try { track = readAudioTrack(moov); } catch (e) { return { none: 'unreadable', why: 'its sound track could not be read' }; }
    if (!track || !track.samples.length) return { none: 'none' };
    const k = soundSpan(track, seconds), data = await samplesOf(blob, track, k, signal);
    let got = null, via = 'webcodecs';
    try { got = await viaDecoder(track, data); } catch (e) { got = null; }
    if (!got) { via = 'decode'; try { got = await viaM4a(track, data); } catch (e) { got = null; } }
    if (!got) return { none: 'unreadable', why: `this phone cannot decode its sound (${track.codec})` };
    const pcm = placeSound(got.blocks, { rate: got.rate, seconds, delay: track.delay, mediaStart: (track.mediaStart || 0) / track.timescale });
    return { pcm: await to48k(pcm), via, codec: track.codec, rate: got.rate, channels: track.channels };
  }
  if (blob.size > WHOLE_MAX || typeof OfflineAudioContext === 'undefined') return { none: 'unreadable', why: 'its sound is in a file p0pc0rn reads only when it is small' };
  try {   // not an MP4 / MOV (a WebM), and small: the browser decodes it whole
    const ctx = new OfflineAudioContext(2, SOUND_RATE, SOUND_RATE), buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const d = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
    return { pcm: placeSound([{ ts: 0, data: d }], { rate: buf.sampleRate, seconds }), via: 'whole', codec: null, rate: buf.sampleRate, channels: buf.numberOfChannels };
  } catch (e) { return { none: 'none' }; }   // decodeAudioData refuses a file with no sound
}
/** pcm -> the WAV Blob kept beside the clip's frames */
export const soundBlob = (pcm) => new Blob([wavBytes(pcm)], { type: WAV_TYPE });

// ------------------------------------------------------------------------------------------------ the sound under the restyled clip (browser)
/** a restyled clip (MP4, no sound) + the kept WAV -> {blob (MP4 with the sound, exactly the picture's length), codec, samples} or
 *  {blob: null, why} (no encoder for sound on this phone, an unreadable WAV) */
export async function muxSound(mp4, wav, frames, fps = STYLE_FPS) {
  const pcm = wav ? readWav(await wav.arrayBuffer()) : null;
  if (!pcm) return { blob: null, why: 'the kept sound could not be read' };
  const cut = cutSound(pcm, soundLen(frames, fps, pcm.sampleRate));
  const { audioCaps, encodePcm } = await import('../engine/media/m4a.js');
  const caps = await audioCaps(2);
  if (!caps.aac && !caps.opus) return { blob: null, why: 'this browser cannot encode sound' };
  const enc = await encodePcm(cut.channels, caps, cut.sampleRate);
  const { readVideoTrack, remuxWithAudio } = await import('../engine/audio/mp4av.js');
  const bytes = remuxWithAudio(readVideoTrack(new Uint8Array(await mp4.arrayBuffer())), enc, { exact: true });
  return { blob: new Blob([bytes], { type: 'video/mp4' }), codec: enc.codec, samples: cut.channels[0].length };
}
/** which frames of each part go into the joined clip: all of the last part's, all but the last of every other part's (that frame is the
 *  next part's first frame, pinned from it: kept once) -> [count per part] */
export const keptOf = (counts) => counts.map((n, i) => (i < counts.length - 1 ? n - 1 : n));
/** the parts of a whole video (MP4s, in order, the same encoder and size) -> one MP4 (no re-encode, no sound) {blob, frames, seconds, cuts} */
export async function joinParts(blobs) {
  const M = await import('../assistant/mp4.js');
  const tracks = [];
  for (const b of blobs) tracks.push(M.readVideoTrack(new Uint8Array(await b.arrayBuffer())));
  const keep = keptOf(tracks.map((t) => t.samples.length));
  // concatVideo trims each clip from its end by time: the exact ticks of its first keep[i] samples (all of them = no trim)
  const durations = tracks.map((t, i) => (keep[i] < t.samples.length ? t.samples.slice(0, keep[i]).reduce((s, x) => s + x.dur, 0) / t.timescale : 0));
  if (tracks.some((t) => t.samples.some((s) => s.cto))) throw bad('BAD_MP4', 'a part has reordered frames: it cannot be joined without re-encoding');
  const v = M.concatVideo(tracks, durations);
  if (v.cuts.some((c, i) => c.frames !== keep[i])) throw bad('BAD_MP4', 'a part could not be trimmed to its frames');
  return { blob: new Blob([M.writeMp4({ video: v })], { type: 'video/mp4' }), frames: v.samples.length, seconds: v.seconds, cuts: v.cuts };
}
