// m4a.js (probes v002) - p0pc0rn v028 engine/music/m4a.js, generalised to 1 or 2 channels: WebCodecs AAC-LC (or Opus) -> audio-only
// MP4 (.m4a, faststart), or 16-bit PCM WAV. The lessons it carries (Josh's iPhone, Oct 13-14):
//   - the AAC AudioSpecificConfig is built from the rate + channels, ALWAYS: Safari's AudioEncoder gives a whole ES descriptor ("cookie",
//     03 .. 04 .. 05 ..) as decoderConfig.description, and nesting that as the ASC makes the file unplayable on the iPhone;
//   - raw AAC is asked for; ADTS headers (some encoders) are stripped;
//   - esds: ES_ID 1, DecoderConfig 0x40 / streamType 0x15, bufferSizeDB = the largest frame, maxBitrate = the most bits in any 1 s window,
//     avgBitrate = the average;
//   - moov before mdat.
'use strict';

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u24 = (v) => [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
const desc = (tag, ...payload) => { const p = payload.flat(Infinity), n = p.length; return [tag, 0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f, ...p]; };

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
/** the AAC-LC AudioSpecificConfig (object type 2, the sampling-frequency index, the channel configuration): 48 kHz mono = 11 88 */
export function aacLcAsc(rate, ch) { const i = Math.max(0, AAC_RATES.indexOf(rate)); return new Uint8Array([(2 << 3) | (i >> 1), ((i & 1) << 7) | ((ch & 15) << 3)]); }
function deADTS(samples) {
  const h = samples[0] && samples[0].data;
  if (!h || h.length < 7 || h[0] !== 0xff || (h[1] & 0xf0) !== 0xf0) return false;
  for (const s of samples) { const d = s.data; if (d.length >= 7 && d[0] === 0xff && (d[1] & 0xf0) === 0xf0) s.data = d.subarray((d[1] & 1) ? 7 : 9); }
  return true;
}

/** what this browser can encode at 48 kHz with `ch` channels */
export async function audioCaps(ch = 2) {
  const r = { AudioEncoder: typeof AudioEncoder !== 'undefined', aac: false, opus: false };
  if (r.AudioEncoder) {
    try { r.aac = !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: ch, bitrate: ch > 1 ? 192000 : 128000 })).supported; } catch (e) { r.aacErr = String(e.message || e); }
    try { r.opus = !!(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: ch, bitrate: ch > 1 ? 160000 : 96000 })).supported; } catch (e) { r.opusErr = String(e.message || e); }
  }
  return r;
}

/** planar channels [Float32Array, ...] (1 or 2) at `sampleRate` (48 kHz) -> {codec, sampleRate, channels, samples:[{data, frames}], asc, priming,
 *  preSkip, totalIn, bitrate, diag} */
export async function encodePcm(chans, caps, sampleRate = 48000) {
  const codec = caps.aac ? 'aac' : caps.opus ? 'opus' : null;
  if (!codec) return null;
  const C = chans.length, bitrate = codec === 'aac' ? (C > 1 ? 192000 : 128000) : (C > 1 ? 160000 : 96000);
  const out = []; let err = null, encDesc = null;
  const own = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)));
  const enc = new AudioEncoder({ output: (c, m) => { if (m && m.decoderConfig && m.decoderConfig.description) encDesc = own(m.decoderConfig.description);
    const d = new Uint8Array(c.byteLength); c.copyTo(d); out.push({ data: d, ts: c.timestamp, dur: c.duration }); }, error: (e) => { err = e; } });
  enc.configure(Object.assign({ codec: codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate, numberOfChannels: C, bitrate }, codec === 'aac' ? { aac: { format: 'aac' } } : {}));
  const CH = 4800, n = chans[0].length;
  for (let i = 0; i < n; i += CH) {
    const k = Math.min(CH, n - i), buf = new Float32Array(C * k);
    for (let c = 0; c < C; c++) buf.set(chans[c].subarray(i, i + k), c * k);
    const d = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: k, numberOfChannels: C, timestamp: Math.round(i * 1e6 / sampleRate), data: buf });
    enc.encode(d); d.close();
    if (enc.encodeQueueSize > 32) await new Promise((r) => setTimeout(r, 0));
    if (err) throw err;
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  const frames = (o) => Math.max(1, Math.round((o.dur || (codec === 'aac' ? 1024 * 1e6 / sampleRate : 20000)) * sampleRate / 1e6));
  const priming = out.length && out[0].ts < 0 ? Math.round(-out[0].ts * sampleRate / 1e6) : (codec === 'aac' ? 0 : 312);
  const samples = out.map((o) => ({ data: o.data, frames: frames(o) }));
  let adts = false, asc;
  if (codec === 'aac') { adts = deADTS(samples); asc = aacLcAsc(sampleRate, C); } else asc = encDesc;
  const hex = (u, k) => (u ? Array.from(u.subarray(0, k), (x) => x.toString(16).padStart(2, '0')).join(' ') + (u.length > k ? ' ..' : '') : 'none');
  return { codec, sampleRate, channels: C, samples, asc, priming, preSkip: 312, totalIn: n, bitrate,
    diag: { codec, encDesc: hex(encDesc, 48), encDescLen: encDesc ? encDesc.length : 0, adts, ascUsed: hex(asc, 8), frames: samples.length, priming } };
}

/** bufferSizeDB (the largest frame), maxBitrate (the most bits in any 1 s window, >= avg), avgBitrate of encoded audio */
export function aacRates(a) {
  const ts = a.codec === 'opus' ? 48000 : a.sampleRate, bytes = a.samples.reduce((s, x) => s + x.data.length, 0), totalFrames = a.samples.reduce((s, x) => s + x.frames, 0);
  const maxA = a.samples.reduce((m, s) => Math.max(m, s.data.length), 0), secs = Math.max(1e-3, totalFrames / ts), avg = Math.round(bytes * 8 / secs);
  let mx = 0, win = 0, wf = 0, j = 0;
  for (let i = 0; i < a.samples.length; i++) { win += a.samples[i].data.length; wf += a.samples[i].frames; while (wf > ts && j < i) { win -= a.samples[j].data.length; wf -= a.samples[j].frames; j++; } mx = Math.max(mx, win * 8); }
  return { bufferSizeDB: maxA, maxBitrate: Math.max(mx, avg), avgBitrate: avg };
}
/** the mp4a / Opus sample entry of encoded audio (shared with the A/V muxer) */
export function audioEntry(a) {
  const C = a.channels || 1;
  if (a.codec === 'opus') return box('Opus', zeros(6), u16(1), zeros(8), u16(C), u16(16), u16(0), u16(0), u32(48000 << 16), box('dOps', [0], [C & 255], u16(a.preSkip != null ? a.preSkip : 312), u32(a.sampleRate), u16(0), [0]));
  const r = aacRates(a);
  return box('mp4a', zeros(6), u16(1), zeros(8), u16(C), u16(16), u16(0), u16(0), u32(a.sampleRate << 16),
    fullbox('esds', 0, 0, desc(0x03, u16(1), [0], desc(0x04, [0x40, 0x15], u24(r.bufferSizeDB), u32(r.maxBitrate), u32(r.avgBitrate), desc(0x05, Array.from(a.asc || []))), desc(0x06, [0x02]))));
}

/** encoded audio -> audio-only MP4 (M4A brand) bytes, moov first */
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
  const entry = audioEntry(a);
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  const edts = box('edts', fullbox('elst', 0, 0, u32(1), u32(durMs), u32(skip), u16(1), u16(0)));
  const moovAt = (first) => box('moov', mvhd, box('trak', tkhd, edts, box('mdia', mdhd, hdlr, box('minf', fullbox('smhd', 0, 0, u16(0), u16(0)), dinf,
    box('stbl', fullbox('stsd', 0, 0, u32(1), entry), stts, stsc, stsz, fullbox('stco', 0, 0, u32(1), u32(first)))))));
  const first = ftyp.length + moovAt(0).length + 8, moov = moovAt(first);
  const outB = new Uint8Array(ftyp.length + moov.length + 8 + aBytes);
  outB.set(ftyp, 0); outB.set(moov, ftyp.length); outB.set(u32(8 + aBytes), ftyp.length + moov.length); outB.set(str('mdat'), ftyp.length + moov.length + 4);
  let o = first; for (const s of a.samples) { outB.set(s.data, o); o += s.data.length; }
  return outB;
}
