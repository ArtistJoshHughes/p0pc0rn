// mp4.js - the music video's cut, in the browser, no re-encode of the picture: the clips' H.264 samples are copied into ONE video
// track (all clips come from the same engine and size, so their sample descriptions match byte for byte), each clip trimmed to its
// shot length, and the song (plus optional sound effects, mixed under it) is encoded once with WebCodecs' AudioEncoder (AAC, else
// Opus) into a second track. Box layout follows the p0pc0rn audio probe's mp4av.js (ftyp | mdat | moov, one chunk per track).
// Clips whose codec setup differs cannot be joined without re-encoding: assemble() then throws code MIXED_CODEC and the caller keeps
// the separate clips + an edit list.
const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
const desc = (tag, ...payload) => { const p = payload.flat(Infinity), n = p.length; return [tag, 0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f, ...p]; };
const err = (code, m) => Object.assign(new Error(m), { code });

function kids(dv, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    let size = dv.getUint32(p), hdr = 8;
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p, size, body: p + hdr, end: p + size }); p += size;
  }
  return out;
}
const find = (dv, b, type) => kids(dv, b.body, b.end).find((c) => c.type === type);

/** the video track of an MP4 -> {timescale, width, height, stsd (raw box bytes), samples: [{data, dur, cto, key}], seconds} */
export function readVideoTrack(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const moov = kids(dv, 0, u8.byteLength).find((b) => b.type === 'moov');
  if (!moov) throw err('BAD_MP4', 'not an MP4 (no moov box)');
  for (const trak of kids(dv, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = find(dv, trak, 'mdia'), hdlr = mdia && find(dv, mdia, 'hdlr');
    if (!hdlr || String.fromCharCode(...u8.subarray(hdlr.body + 8, hdlr.body + 12)) !== 'vide') continue;
    const mdhd = find(dv, mdia, 'mdhd'), v = dv.getUint8(mdhd.body), timescale = dv.getUint32(mdhd.body + (v === 1 ? 20 : 12));
    const stbl = find(dv, find(dv, mdia, 'minf'), 'stbl'), S = {};
    for (const c of kids(dv, stbl.body, stbl.end)) S[c.type] = c;
    const entry = kids(dv, S.stsd.body + 8, S.stsd.end)[0];
    const n = dv.getUint32(S.stsz.body + 8), fixed = dv.getUint32(S.stsz.body + 4), sizes = [];
    for (let i = 0; i < n; i++) sizes.push(fixed || dv.getUint32(S.stsz.body + 12 + 4 * i));
    const co = S.stco || S.co64, nco = dv.getUint32(co.body + 4), offs = [];
    for (let i = 0; i < nco; i++) offs.push(S.co64 ? Number(dv.getBigUint64(co.body + 8 + 8 * i)) : dv.getUint32(co.body + 8 + 4 * i));
    const nsc = dv.getUint32(S.stsc.body + 4), sc = [];
    for (let i = 0; i < nsc; i++) sc.push([dv.getUint32(S.stsc.body + 8 + 12 * i), dv.getUint32(S.stsc.body + 12 + 12 * i)]);
    const samples = []; let si = 0;
    for (let ci = 0; ci < nco; ci++) {
      let per = 0; for (const [first, cnt] of sc) if (ci + 1 >= first) per = cnt;
      let o = offs[ci]; for (let k = 0; k < per && si < n; k++, si++) { samples.push({ data: u8.subarray(o, o + sizes[si]), dur: 0, cto: 0, key: true }); o += sizes[si]; }
    }
    let k = 0; const ns = dv.getUint32(S.stts.body + 4);
    for (let i = 0; i < ns; i++) { const cnt = dv.getUint32(S.stts.body + 8 + 8 * i), d = dv.getUint32(S.stts.body + 12 + 8 * i); for (let j = 0; j < cnt && k < n; j++, k++) samples[k].dur = d; }
    if (S.ctts) { const ver = dv.getUint8(S.ctts.body), nc = dv.getUint32(S.ctts.body + 4); k = 0;
      for (let i = 0; i < nc; i++) { const cnt = dv.getUint32(S.ctts.body + 8 + 8 * i), raw = dv.getUint32(S.ctts.body + 12 + 8 * i); for (let j = 0; j < cnt && k < n; j++, k++) samples[k].cto = ver === 1 ? (raw | 0) : raw; } }
    if (S.stss) { const nk = dv.getUint32(S.stss.body + 4), keys = new Set(); for (let i = 0; i < nk; i++) keys.add(dv.getUint32(S.stss.body + 8 + 4 * i) - 1); samples.forEach((s, i) => { s.key = keys.has(i); }); }
    return { timescale, width: dv.getUint16(entry.body + 24), height: dv.getUint16(entry.body + 26), codec: entry.type,
      stsd: u8.slice(S.stsd.start, S.stsd.end), samples, seconds: samples.reduce((a, s) => a + s.dur, 0) / timescale };
  }
  throw err('BAD_MP4', 'no video track');
}

/** join tracks; durations[i] (seconds) trims clip i from its END in decode order (always decodable: a dropped frame can only be
 *  referenced by frames after it in decode order, which are dropped too). Same codec setup required. */
export function concatVideo(tracks, durations = []) {
  if (!tracks.length) throw err('EMPTY', 'no clips');
  const a = tracks[0];
  const same = (x, y) => x.length === y.length && x.every((b, i) => b === y[i]);
  for (const t of tracks) if (t.timescale !== a.timescale || !same(t.stsd, a.stsd)) throw err('MIXED_CODEC', 'the clips were encoded differently and cannot be joined without re-encoding');
  const samples = [], cuts = [];
  tracks.forEach((t, i) => {
    let keep = t.samples;
    const want = durations[i];
    if (want) {
      const maxTicks = Math.round(want * t.timescale); let acc = 0, n = 0;
      for (const s of t.samples) { if (acc + s.dur > maxTicks + 1 && n > 0) break; acc += s.dur; n++; }
      keep = t.samples.slice(0, n);
    }
    if (!keep[0].key) throw err('BAD_MP4', `clip ${i + 1} does not start on a key frame`);
    cuts.push({ clip: i, frames: keep.length, seconds: keep.reduce((s, x) => s + x.dur, 0) / t.timescale });
    samples.push(...keep);
  });
  return { timescale: a.timescale, width: a.width, height: a.height, stsd: a.stsd, samples, seconds: samples.reduce((s, x) => s + x.dur, 0) / a.timescale, cuts };
}

// ------------------------------------------------------------------ audio
/** any audio Blob the browser can decode -> {channels: [Float32Array x2], sampleRate} resampled to `rate` */
export async function decodeAudio(blob, rate = 48000) {
  const ab = await blob.arrayBuffer();
  const tmp = new OfflineAudioContext(2, rate, rate);
  const buf = await tmp.decodeAudioData(ab);
  const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(buf.duration * rate)), rate);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return { channels: [out.getChannelData(0).slice(), out.getChannelData(1).slice()], sampleRate: rate };
}
/** base (stereo) + overlays [{channels, at (s), gain}] -> new stereo of `seconds`, soft-limited */
export function mixAudio(base, overlays = [], seconds = null) {
  const rate = base.sampleRate, n = Math.round((seconds || base.channels[0].length / rate) * rate);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) out[c].set(base.channels[c].subarray(0, n));
  for (const o of overlays) {
    const at = Math.round(o.at * rate), g = o.gain == null ? 0.3 : o.gain;
    for (let c = 0; c < 2; c++) { const src = o.channels[c] || o.channels[0]; for (let i = 0; i < src.length && at + i < n; i++) out[c][at + i] += g * src[i]; }
  }
  for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) { const x = out[c][i]; if (x > 0.95 || x < -0.95) out[c][i] = Math.tanh(x); }
  return { channels: out, sampleRate: rate };
}
export async function audioCaps() {
  const r = { aac: false, opus: false };
  if (typeof AudioEncoder === 'undefined') return r;
  try { r.aac = !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })).supported; } catch (e) { /* */ }
  try { r.opus = !!(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported; } catch (e) { /* */ }
  return r;
}
/** stereo PCM -> {codec, sampleRate, channels, samples: [{data, frames}], asc | preSkip} */
export async function encodeAudio(pcm, caps = null) {
  caps = caps || await audioCaps();
  const codec = caps.aac ? 'aac' : caps.opus ? 'opus' : null;
  if (!codec) throw err('NO_AUDIO_ENCODER', 'this browser cannot encode audio (WebCodecs AudioEncoder)');
  const rate = pcm.sampleRate, nch = 2, chunks = []; let description = null, failure = null;
  const enc = new AudioEncoder({
    output: (c, meta) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); chunks.push({ data: d, ts: c.timestamp, dur: c.duration });
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !description) description = new Uint8Array(meta.decoderConfig.description.buffer ? meta.decoderConfig.description.buffer : meta.decoderConfig.description); },
    error: (e) => { failure = e; },
  });
  enc.configure({ codec: codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: rate, numberOfChannels: nch, bitrate: codec === 'aac' ? 160000 : 128000 });
  const N = pcm.channels[0].length, step = 4096;
  for (let i = 0; i < N; i += step) {
    const m = Math.min(step, N - i), data = new Float32Array(m * nch);
    data.set(pcm.channels[0].subarray(i, i + m), 0); data.set(pcm.channels[1].subarray(i, i + m), m);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: m, numberOfChannels: nch, timestamp: Math.round((i / rate) * 1e6), data });
    enc.encode(ad); ad.close();
  }
  await enc.flush(); enc.close();
  if (failure) throw failure;
  const per = codec === 'aac' ? 1024 : 960;
  const samples = chunks.map((c) => ({ data: c.data, frames: c.dur ? Math.round((c.dur / 1e6) * (codec === 'opus' ? 48000 : rate)) || per : per }));
  return codec === 'aac' ? { codec, sampleRate: rate, channels: nch, samples, asc: description || ascFor(rate, nch) }
    : { codec, sampleRate: rate, channels: nch, samples, preSkip: 312 };
}
function ascFor(rate, ch) {   // AAC-LC AudioSpecificConfig when the encoder gave none
  const idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(rate);
  return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (ch << 3)]);
}

// ------------------------------------------------------------------ writing
/** {video: concatVideo(...) result, audio: encodeAudio(...) result | null} -> Uint8Array MP4 */
export function writeMp4({ video, audio = null }) {
  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
  const vBytes = video.samples.reduce((s, x) => s + x.data.length, 0), aBytes = audio ? audio.samples.reduce((s, x) => s + x.data.length, 0) : 0;
  const firstV = ftyp.length + 8, firstA = firstV + vBytes;
  const vTicks = video.samples.reduce((s, x) => s + x.dur, 0), vMs = Math.round((vTicks * 1000) / video.timescale);
  const isOpus = audio && audio.codec === 'opus', aTs = audio ? (isOpus ? 48000 : audio.sampleRate) : 0, preSkip = audio && audio.preSkip != null ? audio.preSkip : 0;
  const aFrames = audio ? audio.samples.reduce((s, x) => s + x.frames, 0) : 0, aMs = audio ? Math.round(((aFrames - preSkip) * 1000) / aTs) : 0;
  const movieMs = Math.max(vMs, aMs);
  const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(audio ? 3 : 2));
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  const runs = (vals) => { const r = []; for (const v of vals) { const l = r[r.length - 1]; if (l && l[1] === v) l[0]++; else r.push([1, v]); } return r; };
  // video
  const S = video.samples, sttsR = runs(S.map((s) => s.dur)), anyCto = S.some((s) => s.cto), negCto = S.some((s) => s.cto < 0);
  const stts = fullbox('stts', 0, 0, u32(sttsR.length), sttsR.map(([c, d]) => [...u32(c), ...u32(d)]));
  const ctts = anyCto ? (() => { const r = runs(S.map((s) => s.cto)); return fullbox('ctts', negCto ? 1 : 0, 0, u32(r.length), r.map(([c, o]) => [...u32(c), ...u32(o >>> 0)])); })() : [];
  const keyIdx = S.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const stss = keyIdx.length === S.length ? [] : fullbox('stss', 0, 0, u32(keyIdx.length), keyIdx.map(u32));
  const stsz = fullbox('stsz', 0, 0, u32(0), u32(S.length), S.map((s) => u32(s.data.length)));
  const stblV = box('stbl', Array.from(video.stsd), stts, ctts, stss, stsz, fullbox('stsc', 0, 0, u32(1), u32(1), u32(S.length), u32(1)), fullbox('stco', 0, 0, u32(1), u32(firstV)));
  const tkhdV = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(vMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(video.width << 16), u32(video.height << 16));
  const mdhdV = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(video.timescale), u32(vTicks), u16(0x55c4), u16(0));
  const hdlrV = fullbox('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler'), [0]);
  // with B-frames the first picture is presented at its composition offset: an edit list starts the movie there
  const edtsV = S[0].cto > 0 ? box('edts', fullbox('elst', 0, 0, u32(1), u32(vMs), u32(S[0].cto), u16(1), u16(0))) : [];
  const trakV = box('trak', tkhdV, edtsV, box('mdia', mdhdV, hdlrV, box('minf', fullbox('vmhd', 0, 1, zeros(8)), dinf, stblV)));
  // audio
  let trakA = [];
  if (audio) {
    const A = audio.samples, ar = runs(A.map((s) => s.frames));
    const entry = isOpus
      ? box('Opus', zeros(6), u16(1), zeros(8), u16(audio.channels), u16(16), u16(0), u16(0), u32(48000 << 16), box('dOps', [0], [audio.channels & 255], u16(preSkip), u32(audio.sampleRate), u16(0), [0]))
      : box('mp4a', zeros(6), u16(1), zeros(8), u16(audio.channels), u16(16), u16(0), u16(0), u32(audio.sampleRate << 16),
        fullbox('esds', 0, 0, desc(0x03, u16(0), [0], desc(0x04, [0x40, 0x15, 0, 0, 0], u32(0), u32(0), desc(0x05, Array.from(audio.asc))), desc(0x06, [0x02]))));
    const stblA = box('stbl', fullbox('stsd', 0, 0, u32(1), entry), fullbox('stts', 0, 0, u32(ar.length), ar.map(([c, d]) => [...u32(c), ...u32(d)])),
      fullbox('stsc', 0, 0, u32(1), u32(1), u32(A.length), u32(1)), fullbox('stsz', 0, 0, u32(0), u32(A.length), A.map((s) => u32(s.data.length))), fullbox('stco', 0, 0, u32(1), u32(firstA)));
    const tkhdA = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(aMs), zeros(8), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0));
    const mdhdA = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(aTs), u32(aFrames), u16(0x55c4), u16(0));
    const hdlrA = fullbox('hdlr', 0, 0, u32(0), str('soun'), zeros(12), str('SoundHandler'), [0]);
    const elst = box('edts', fullbox('elst', 0, 0, u32(1), u32(aMs), u32(preSkip), u16(1), u16(0)));
    trakA = box('trak', tkhdA, elst, box('mdia', mdhdA, hdlrA, box('minf', fullbox('smhd', 0, 0, u16(0), u16(0)), dinf, stblA)));
  }
  const moov = box('moov', mvhd, trakV, trakA);
  const out = new Uint8Array(ftyp.length + 8 + vBytes + aBytes + moov.length);
  out.set(ftyp, 0); out.set(u32(8 + vBytes + aBytes), ftyp.length); out.set(str('mdat'), ftyp.length + 4);
  let o = firstV; for (const s of video.samples) { out.set(s.data, o); o += s.data.length; }
  if (audio) for (const s of audio.samples) { out.set(s.data, o); o += s.data.length; }
  out.set(moov, o);
  return out;
}

/**
 * The cut: clips (Blobs, in shot order) trimmed to `durations` (s), the song as the soundtrack, optional foley [{blob, at}] under it.
 * -> {blob (video/mp4), seconds, audioCodec, edl: [{shot, start, seconds, frames}]}
 */
export async function assemble({ clips, durations = [], song = null, foley = [], foleyGain = 0.3, onProgress = null, signal = null }) {
  const tracks = [];
  for (let i = 0; i < clips.length; i++) { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); tracks.push(readVideoTrack(new Uint8Array(await clips[i].arrayBuffer()))); if (onProgress) onProgress({ phase: 'read', frac: 0.3 * (i + 1) / clips.length }); }
  const video = concatVideo(tracks, durations);
  let audio = null, audioCodec = null;
  if (song) {
    let pcm = await decodeAudio(song);
    const fol = [];
    for (const f of foley || []) if (f && f.blob) fol.push(Object.assign(await decodeAudio(f.blob), { at: f.at || 0, gain: foleyGain }));
    pcm = mixAudio(pcm, fol, video.seconds);
    if (onProgress) onProgress({ phase: 'audio', frac: 0.6 });
    audio = await encodeAudio(pcm); audioCodec = audio.codec;
  }
  if (onProgress) onProgress({ phase: 'write', frac: 0.9 });
  const bytes = writeMp4({ video, audio });
  let t = 0; const edl = video.cuts.map((c) => { const r = { shot: c.clip + 1, start: +t.toFixed(3), seconds: +c.seconds.toFixed(3), frames: c.frames }; t += c.seconds; return r; });
  return { blob: new Blob([bytes], { type: 'video/mp4' }), seconds: video.seconds, audioCodec, edl };
}
