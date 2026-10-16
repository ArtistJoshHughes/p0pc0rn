// m4a.js - stereo song output: WebCodecs AAC-LC (or Opus) -> audio-only MP4 (.m4a), or a 16-bit PCM WAV fallback.
// The audio trak layout is the one of audio/mp4av.js (run-length stts, one chunk, esds / dOps, edit list for the encoder priming).
'use strict';

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
const u24 = (v) => [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const desc = (tag, ...payload) => { const p = payload.flat(Infinity), n = p.length; return [tag, 0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f, ...p]; };

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
/** p0pc0rn v024.1: the AAC-LC AudioSpecificConfig (object type 2, the sampling-frequency index, the channel configuration) */
export function aacLcAsc(rate, ch) { const i = Math.max(0, AAC_RATES.indexOf(rate)); return new Uint8Array([(2 << 3) | (i >> 1), ((i & 1) << 7) | ((ch & 15) << 3)]); }
/** ADTS-framed AAC (some encoders): strip the 7 / 9-byte headers in place; -> the ASC of the first header, or null if not ADTS */
function deADTS(samples) {
  const h = samples[0] && samples[0].data;
  if (!h || h.length < 7 || h[0] !== 0xff || (h[1] & 0xf0) !== 0xf0) return null;
  const profile = (h[2] >> 6) & 3, sfi = (h[2] >> 2) & 15, ch = ((h[2] & 1) << 2) | ((h[3] >> 6) & 3);
  for (const s of samples) { const d = s.data; if (d.length >= 7 && d[0] === 0xff && (d[1] & 0xf0) === 0xf0) s.data = d.subarray((d[1] & 1) ? 7 : 9); }
  return new Uint8Array([((profile + 1) << 3) | (sfi >> 1), ((sfi & 1) << 7) | (ch << 3)]);
}

/** what this browser can encode (stereo 48 kHz) */
export async function audioCaps() {
  const r = { AudioEncoder: typeof AudioEncoder !== 'undefined', aac: false, opus: false };
  if (r.AudioEncoder) {
    try { r.aac = !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported; } catch (e) { r.aacErr = String(e.message || e); }
    try { r.opus = !!(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })).supported; } catch (e) { r.opusErr = String(e.message || e); }
  }
  return r;
}

/** planar stereo [L, R] Float32Arrays at 48 kHz -> {codec, sampleRate, channels, samples:[{data, frames}], asc, priming, preSkip} */
export async function encodeStereo(L, R, caps, sampleRate = 48000) {
  const codec = caps.aac ? 'aac' : caps.opus ? 'opus' : null;
  if (!codec) return null;
  const out = []; let asc = null, err = null, encDesc = null;
  // v026.1: the encoder's description, copied exactly (a view's own bytes, not its whole buffer); only reported for AAC (see below)
  const own = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)));
  const enc = new AudioEncoder({ output: (c, m) => { if (m && m.decoderConfig && m.decoderConfig.description) encDesc = own(m.decoderConfig.description);
    const d = new Uint8Array(c.byteLength); c.copyTo(d); out.push({ data: d, ts: c.timestamp, dur: c.duration }); }, error: (e) => { err = e; } });
  enc.configure(Object.assign({ codec: codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate, numberOfChannels: 2, bitrate: codec === 'aac' ? 192000 : 160000 }, codec === 'aac' ? { aac: { format: 'aac' } } : {}));   // v024.1: raw AAC + its ASC
  const CH = 4800, n = L.length;
  for (let i = 0; i < n; i += CH) {
    const k = Math.min(CH, n - i), buf = new Float32Array(2 * k); buf.set(L.subarray(i, i + k), 0); buf.set(R.subarray(i, i + k), k);
    const d = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / sampleRate), data: buf });
    enc.encode(d); d.close();
    if (enc.encodeQueueSize > 32) await new Promise((r) => setTimeout(r, 0));
    if (err) throw err;
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  const frames = (o) => Math.max(1, Math.round((o.dur || (codec === 'aac' ? 1024 * 1e6 / sampleRate : 20000)) * sampleRate / 1e6));
  const priming = out.length && out[0].ts < 0 ? Math.round(-out[0].ts * sampleRate / 1e6) : (codec === 'aac' ? 0 : 312);
  const samples = out.map((o) => ({ data: o.data, frames: frames(o) }));
  // v026.1: the song is AAC-LC by construction (mp4a.40.2), so its AudioSpecificConfig is built from the rate and the channels, ALWAYS.
  // Safari's description is a whole ES descriptor (03 .. 04 .. 05 11 90 ..), which v024.1 nested as the ASC: 'media error 4' on the
  // iPhone. The foley probe that plays there does the same. ADTS-framed output (some encoders) is stripped.
  let adts = false;
  if (codec === 'aac') { adts = !!deADTS(samples); asc = aacLcAsc(sampleRate, 2); } else asc = encDesc;
  const hex = (u, n) => (u ? Array.from(u.subarray(0, n), (x) => x.toString(16).padStart(2, '0')).join(' ') + (u.length > n ? ' ..' : '') : 'none');
  return { codec, sampleRate, channels: 2, samples, asc, priming, preSkip: 312, totalIn: n, bitrate: codec === 'aac' ? 192000 : 160000,
    diag: { encDesc: hex(encDesc, 48), encDescLen: encDesc ? encDesc.length : 0, adts, ascUsed: hex(asc, 8), frames: samples.length, priming } };
}

/** encoded audio -> audio-only MP4 (M4A brand) bytes */
export function muxM4a(a) {
  const isOpus = a.codec === 'opus', ts = isOpus ? 48000 : a.sampleRate, preSkip = isOpus ? a.preSkip : 0;
  const ftyp = box('ftyp', str('M4A '), u32(512), str('M4A '), str('isom'), str('iso2'), str('mp41'));
  const aBytes = a.samples.reduce((s, x) => s + x.data.length, 0);
  const totalFrames = a.samples.reduce((s, x) => s + x.frames, 0), skip = isOpus ? preSkip : (a.priming || 0);
  const play = a.totalIn != null ? a.totalIn : totalFrames - skip, durMs = Math.round(play * 1000 / ts);
  const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(2));
  const tkhd = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), zeros(8), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0));
  const mdhd = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(totalFrames), u16(0x55c4), u16(0));
  const hdlr = fullbox('hdlr', 0, 0, u32(0), str('soun'), zeros(12), str('SoundHandler'), [0]);
  const runs = []; for (const s of a.samples) { const r = runs[runs.length - 1]; if (r && r[1] === s.frames) r[0]++; else runs.push([1, s.frames]); }
  const stts = fullbox('stts', 0, 0, u32(runs.length), runs.map(([c, d]) => [...u32(c), ...u32(d)]));
  const stsz = fullbox('stsz', 0, 0, u32(0), u32(a.samples.length), a.samples.map((s) => u32(s.data.length)));
  const stsc = fullbox('stsc', 0, 0, u32(1), u32(1), u32(a.samples.length), u32(1));
  let entry;
  if (isOpus) entry = box('Opus', zeros(6), u16(1), zeros(8), u16(2), u16(16), u16(0), u16(0), u32(48000 << 16), box('dOps', [0], [2], u16(preSkip), u32(a.sampleRate), u16(0), [0]));
  else {
    // v026.1: a real bufferSizeDB (the largest frame) and real bitrates: the most bits in any 1 s window, and the song's average
    const maxA = a.samples.reduce((m, s) => Math.max(m, s.data.length), 0), secs = Math.max(1e-3, totalFrames / ts), avg = Math.round(aBytes * 8 / secs);
    let mx = 0, win = 0, wf = 0, j = 0;
    for (let i = 0; i < a.samples.length; i++) { win += a.samples[i].data.length; wf += a.samples[i].frames; while (wf > ts && j < i) { win -= a.samples[j].data.length; wf -= a.samples[j].frames; j++; } mx = Math.max(mx, win * 8); }
    entry = box('mp4a', zeros(6), u16(1), zeros(8), u16(2), u16(16), u16(0), u16(0), u32(a.sampleRate << 16),
      fullbox('esds', 0, 0, desc(0x03, u16(1), [0], desc(0x04, [0x40, 0x15], u24(maxA), u32(Math.max(mx, avg)), u32(avg), desc(0x05, Array.from(a.asc || []))), desc(0x06, [0x02]))));
  }
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  const edts = box('edts', fullbox('elst', 0, 0, u32(1), u32(durMs), u32(skip), u16(1), u16(0)));
  // v024.1: moov BEFORE mdat (faststart): its size does not depend on the chunk offset, so build it twice
  const moovAt = (first) => box('moov', mvhd, box('trak', tkhd, edts, box('mdia', mdhd, hdlr, box('minf', fullbox('smhd', 0, 0, u16(0), u16(0)), dinf,
    box('stbl', fullbox('stsd', 0, 0, u32(1), entry), stts, stsc, stsz, fullbox('stco', 0, 0, u32(1), u32(first)))))));
  const first = ftyp.length + moovAt(0).length + 8, moov = moovAt(first);
  const outB = new Uint8Array(ftyp.length + moov.length + 8 + aBytes);
  outB.set(ftyp, 0); outB.set(moov, ftyp.length); outB.set(u32(8 + aBytes), ftyp.length + moov.length); outB.set(str('mdat'), ftyp.length + moov.length + 4);
  let o = first; for (const s of a.samples) { outB.set(s.data, o); o += s.data.length; }
  return outB;
}

/** planar stereo -> 16-bit PCM WAV bytes */
export function wavStereo16(L, R, sampleRate = 48000) {
  const n = L.length, buf = new Uint8Array(44 + n * 4), dv = new DataView(buf.buffer);
  buf.set(str('RIFF'), 0); dv.setUint32(4, 36 + n * 4, true); buf.set(str('WAVE'), 8); buf.set(str('fmt '), 12); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  buf.set(str('data'), 36); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), true);
    dv.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), true);
  }
  return buf;
}
