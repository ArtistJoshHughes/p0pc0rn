// mp4av.js - read the video track of an MP4 / MOV (frame times + samples) and REMUX it, untouched, with a new audio track.
// The video trak's sample tables (stsd incl. avcC/hvcC, stts, ctts, stss, stsz) are copied byte for byte; only the chunk tables are
// rebuilt (one chunk), so H.264 and HEVC sources with B-frames keep their exact timing.  Audio: AAC (esds) or Opus (dOps).
// The audio-track builder started as a local-Qwen draft (assist lane) and was corrected by Claude: run-length stts, dOps
// channel count u8, esds descriptors nested correctly, tkhd volume / alternate group for sound.
'use strict';
import { audioEntry } from '../media/m4a.js';   // probes v002: ES_ID 1, 0x40 / 0x15, bufferSizeDB = the largest frame, real max / avg bitrates

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u24 = (v) => [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
const desc = (tag, ...payload) => { const p = payload.flat(Infinity), n = p.length; return [tag, 0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f, ...p]; };

// ------------------------------------------------------------------ reading
function children(dv, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    let size = dv.getUint32(p), hdr = 8; const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p, size, body: p + hdr, end: p + size }); p += size;
  }
  return out;
}
const find = (dv, b, type) => children(dv, b.body, b.end).find((c) => c.type === type);

/** -> {timescale, durationSec, codec, width, height, samples:[{off, size, dts, cts, key}], times:[presentation s, sorted], raw:{...}} */
export function readVideoTrack(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const top = children(dv, 0, u8.byteLength), moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('not an MP4/MOV (no moov box)');
  for (const trak of children(dv, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = find(dv, trak, 'mdia'), hdlr = mdia && find(dv, mdia, 'hdlr');
    if (!hdlr || String.fromCharCode(...u8.subarray(hdlr.body + 8, hdlr.body + 12)) !== 'vide') continue;
    const mdhd = find(dv, mdia, 'mdhd'), v = dv.getUint8(mdhd.body);
    const timescale = dv.getUint32(mdhd.body + (v === 1 ? 20 : 12));
    const minf = find(dv, mdia, 'minf'), stbl = find(dv, minf, 'stbl');
    const S = {}; for (const c of children(dv, stbl.body, stbl.end)) S[c.type] = c;
    const stsd = S.stsd, entry = children(dv, stsd.body + 8, stsd.end)[0];
    const width = dv.getUint16(entry.body + 24), height = dv.getUint16(entry.body + 26);
    const n = dv.getUint32(S.stsz.body + 8), fixed = dv.getUint32(S.stsz.body + 4), sizes = new Uint32Array(n);
    for (let i = 0; i < n; i++) sizes[i] = fixed || dv.getUint32(S.stsz.body + 12 + 4 * i);
    const co = S.stco || S.co64, nco = dv.getUint32(co.body + 4), offs = [];
    for (let i = 0; i < nco; i++) offs.push(S.co64 ? Number(dv.getBigUint64(co.body + 8 + 8 * i)) : dv.getUint32(co.body + 8 + 4 * i));
    const nsc = dv.getUint32(S.stsc.body + 4), sc = [];
    for (let i = 0; i < nsc; i++) sc.push([dv.getUint32(S.stsc.body + 8 + 12 * i), dv.getUint32(S.stsc.body + 12 + 12 * i)]);
    const samples = []; let si = 0;
    for (let ci = 0; ci < nco; ci++) {
      let per = 0; for (const [first, cnt] of sc) if (ci + 1 >= first) per = cnt;
      let o = offs[ci]; for (let k = 0; k < per && si < n; k++, si++) { samples.push({ off: o, size: sizes[si] }); o += sizes[si]; }
    }
    let t = 0, k = 0; const ns = dv.getUint32(S.stts.body + 4);
    for (let i = 0; i < ns; i++) { const cnt = dv.getUint32(S.stts.body + 8 + 8 * i), d = dv.getUint32(S.stts.body + 12 + 8 * i); for (let j = 0; j < cnt && k < n; j++, k++) { samples[k].dts = t; t += d; } }
    for (const s of samples) s.cts = s.dts;
    if (S.ctts) { const ver = dv.getUint8(S.ctts.body), nc = dv.getUint32(S.ctts.body + 4); k = 0;
      for (let i = 0; i < nc; i++) { const cnt = dv.getUint32(S.ctts.body + 8 + 8 * i), raw = dv.getUint32(S.ctts.body + 12 + 8 * i), off = ver === 1 ? (raw | 0) : raw;
        for (let j = 0; j < cnt && k < n; j++, k++) samples[k].cts = samples[k].dts + off; } }
    const keys = new Set(); if (S.stss) { const nk = dv.getUint32(S.stss.body + 4); for (let i = 0; i < nk; i++) keys.add(dv.getUint32(S.stss.body + 8 + 4 * i) - 1); }
    samples.forEach((s, i) => { s.key = S.stss ? keys.has(i) : true; });
    const c0 = Math.min(...samples.map((s) => s.cts));
    const times = samples.map((s) => (s.cts - c0) / timescale).sort((a, b) => a - b);
    const durationSec = t / timescale;
    const raw = (b) => (b ? u8.slice(b.start, b.end) : null);
    return { timescale, durationSec, codec: entry.type, width, height, samples, times, u8, ctsStart: c0,
      raw: { tkhd: raw(find(dv, trak, 'tkhd')), edts: raw(find(dv, trak, 'edts')), mdhd: raw(mdhd), hdlr: raw(hdlr), vmhd: raw(find(dv, minf, 'vmhd')),
        stsd: raw(S.stsd), stts: raw(S.stts), ctts: raw(S.ctts), stss: raw(S.stss), stsz: raw(S.stsz) } };
  }
  throw new Error('no video track');
}

// ------------------------------------------------------------------ reading the sound (v4: Restyle a clip keeps the clip's own sound)
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const four = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
/** an AAC AudioSpecificConfig -> {aot (2 = AAC-LC), rate, channels} or null */
export function ascInfo(asc) {
  if (!asc || asc.length < 2) return null;
  let bit = 0; const rd = (n) => { let v = 0; for (let i = 0; i < n; i++, bit++) v = (v * 2) + ((asc[bit >> 3] >> (7 - (bit & 7))) & 1); return v; };
  let aot = rd(5); if (aot === 31) aot = 32 + rd(6);
  const fi = rd(4), rate = fi === 15 ? rd(24) : AAC_RATES[fi] || 0;
  return { aot, rate, channels: rd(4) };
}
/** the descriptors of an esds box (from its body after version / flags) -> {oti (0x40 = AAC), asc} */
function esdsOf(u8, at, end) {
  let oti = null, asc = null;
  const walk = (p, stop) => {
    while (p + 2 <= stop) {
      const tag = u8[p]; let n = 0, k = 0;
      while (k < 4 && p + 1 + k < stop) { const b = u8[p + 1 + k]; k++; n = n * 128 + (b & 0x7f); if (!(b & 0x80)) break; }
      const body = p + 1 + k, e = Math.min(stop, body + n);
      if (tag === 0x03) { const f = u8[body + 2]; let q = body + 3; if (f & 0x80) q += 2; if (f & 0x40) q += 1 + u8[q]; if (f & 0x20) q += 2; walk(q, e); }
      else if (tag === 0x04) { oti = u8[body]; walk(body + 13, e); }
      else if (tag === 0x05 && !asc) asc = u8.slice(body, e);
      p = e;
    }
  };
  walk(at, end);
  return { oti, asc };
}
/** the SOUND track of an MP4 / MOV: the moov box's bytes are enough (an iPhone .mov too: QuickTime sound descriptions v0 / v1 / v2, the esds
 *  inside 'wave'), the samples are where the file has them. -> null (no sound track) or {codec ('aac' | 'opus' | the sample entry's type),
 *  fourcc, timescale, sampleRate, channels, asc, aot, samples: [{off, size, dts, dur}] (decode order, dts / dur in the track's timescale),
 *  durationSec, delay (s of silence its edit list puts before it), mediaStart (the media time its edit list starts at: the encoder's
 *  priming; timescale units)} */
export function readAudioTrack(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const moov = children(dv, 0, u8.byteLength).find((b) => b.type === 'moov');
  if (!moov) throw new Error('not an MP4/MOV (no moov box)');
  const top = children(dv, moov.body, moov.end), mvhd = top.find((b) => b.type === 'mvhd');
  const movieTs = mvhd ? dv.getUint32(mvhd.body + (dv.getUint8(mvhd.body) === 1 ? 20 : 12)) || 1000 : 1000;
  for (const trak of top.filter((b) => b.type === 'trak')) {
    const mdia = find(dv, trak, 'mdia'), hdlr = mdia && find(dv, mdia, 'hdlr');
    if (!hdlr || four(u8, hdlr.body + 8) !== 'soun') continue;
    const mdhd = find(dv, mdia, 'mdhd'), minf = find(dv, mdia, 'minf'), stbl = minf && find(dv, minf, 'stbl');
    if (!mdhd || !stbl) continue;
    const timescale = dv.getUint32(mdhd.body + (dv.getUint8(mdhd.body) === 1 ? 20 : 12));
    const S = {}; for (const c of children(dv, stbl.body, stbl.end)) S[c.type] = c;
    if (!S.stsd || !S.stsz || !S.stsc || !S.stts || !(S.stco || S.co64)) continue;
    const entry = children(dv, S.stsd.body + 8, S.stsd.end)[0]; if (!entry) continue;
    const e = entry.body, ver = dv.getUint16(e + 8);
    let channels = dv.getUint16(e + 16), sampleRate = dv.getUint32(e + 24) >>> 16, kids = e + 28;
    if (ver === 1) kids += 16;
    else if (ver === 2) { sampleRate = Math.round(dv.getFloat64(e + 32)); channels = dv.getUint32(e + 40); kids = e + 64; }
    const deep = (s, end, t) => { for (const c of children(dv, s, end)) { if (c.type === t) return c; if (c.type === 'wave') { const r = deep(c.body, c.end, t); if (r) return r; } } return null; };
    let codec = entry.type, asc = null, aot = null;
    if (entry.type === 'mp4a') {
      const es = deep(kids, entry.end, 'esds'), d = es ? esdsOf(u8, es.body + 4, es.end) : { oti: null, asc: null };
      if (d.oti === 0x40 || d.oti === 0x66 || d.oti === 0x67 || d.oti === 0x68) {
        codec = 'aac'; asc = d.asc; const a = ascInfo(asc);
        if (a) { aot = a.aot; if (a.rate) sampleRate = a.rate; if (a.channels) channels = a.channels; }
      }
    } else if (entry.type === 'Opus') { codec = 'opus'; const op = deep(kids, entry.end, 'dOps'); if (op) channels = dv.getUint8(op.body + 1) || channels; sampleRate = 48000; }
    // the samples: chunk offsets x samples per chunk x sizes; their decode times
    const n = dv.getUint32(S.stsz.body + 8), fixed = dv.getUint32(S.stsz.body + 4);
    const co = S.stco || S.co64, nco = dv.getUint32(co.body + 4), nsc = dv.getUint32(S.stsc.body + 4), sc = [];
    for (let i = 0; i < nsc; i++) sc.push([dv.getUint32(S.stsc.body + 8 + 12 * i), dv.getUint32(S.stsc.body + 12 + 12 * i)]);
    if (!sc.length) continue;
    const samples = []; let si = 0, j = 0;
    for (let ci = 0; ci < nco && si < n; ci++) {
      while (j + 1 < sc.length && ci + 1 >= sc[j + 1][0]) j++;
      let o = S.co64 ? Number(dv.getBigUint64(co.body + 8 + 8 * ci)) : dv.getUint32(co.body + 8 + 4 * ci);
      for (let k = 0; k < sc[j][1] && si < n; k++, si++) { const size = fixed || dv.getUint32(S.stsz.body + 12 + 4 * si); samples.push({ off: o, size, dts: 0, dur: 0 }); o += size; }
    }
    let t = 0, k = 0; const ns = dv.getUint32(S.stts.body + 4);
    for (let i = 0; i < ns; i++) { const cnt = dv.getUint32(S.stts.body + 8 + 8 * i), d = dv.getUint32(S.stts.body + 12 + 8 * i); for (let m = 0; m < cnt && k < samples.length; m++, k++) { samples[k].dts = t; samples[k].dur = d; t += d; } }
    // the edit list: an empty edit first = the sound starts later; the first media edit = where the media starts (the encoder's priming)
    let delay = 0, mediaStart = 0;
    const edts = find(dv, trak, 'edts'), elst = edts && find(dv, edts, 'elst');
    if (elst) {
      const ev = dv.getUint8(elst.body), ne = dv.getUint32(elst.body + 4);
      for (let i = 0, p = elst.body + 8; i < ne; i++, p += ev === 1 ? 20 : 12) {
        const dur = ev === 1 ? Number(dv.getBigUint64(p)) : dv.getUint32(p), mt = ev === 1 ? Number(dv.getBigInt64(p + 8)) : dv.getInt32(p + 4);
        if (mt === -1) delay += dur / movieTs; else { mediaStart = mt; break; }
      }
    }
    return { codec, fourcc: entry.type, timescale, sampleRate, channels, asc, aot, samples, durationSec: t / timescale, delay, mediaStart };
  }
  return null;
}

// ------------------------------------------------------------------ writing
/** vt = readVideoTrack(src); audio = {codec:'aac'|'opus', sampleRate, channels, samples:[{data, frames}], asc (aac), preSkip (opus)} -> Uint8Array.
 *  opts.exact (v4): the sound plays exactly audio.totalIn samples (the PCM that went in: no priming, no padding), so it ends with the picture */
export function remuxWithAudio(vt, audio, opts = {}) {
  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('mp41'));
  const vBytes = vt.samples.reduce((s, x) => s + x.size, 0), aBytes = audio.samples.reduce((s, x) => s + x.data.length, 0);
  const firstV = ftyp.length + 8, firstA = firstV + vBytes;
  const isOpus = audio.codec === 'opus', aTs = isOpus ? 48000 : audio.sampleRate, preSkip = audio.preSkip != null ? audio.preSkip : 312;
  // v004: real buffer size + bitrates in the AAC DecoderConfigDescriptor (zeros there are legal but some Apple paths dislike them)
  const maxA = audio.samples.reduce((m, s) => Math.max(m, s.data.length), 0), bitA = audio.bitrate || 128000;
  const totalFrames = audio.samples.reduce((s, x) => s + x.frames, 0);
  const play = opts.exact && audio.totalIn != null ? audio.totalIn : totalFrames - (isOpus ? preSkip : 0);
  const vDurMs = Math.round(vt.durationSec * 1000), aDurMs = Math.round((play * 1000) / aTs), movieDur = Math.max(vDurMs, aDurMs);
  const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(3));
  const R = vt.raw, arr = (b) => (b ? Array.from(b) : []);
  // video trak: source boxes verbatim + one-chunk stsc / stco; tkhd duration patched to the movie timescale
  const tkhd = Array.from(R.tkhd); { const v = tkhd[8]; const at = v === 1 ? 36 : 28; if (v !== 1) tkhd.splice(at, 4, ...u32(vDurMs)); }
  const stblV = box('stbl', arr(R.stsd), arr(R.stts), arr(R.ctts), arr(R.stss), arr(R.stsz),
    fullbox('stsc', 0, 0, u32(1), u32(1), u32(vt.samples.length), u32(1)), fullbox('stco', 0, 0, u32(1), u32(firstV)));
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  // the source edit list is in the SOURCE movie timescale: rebuild it (start at the first presentation time) instead of copying
  const edtsV = vt.ctsStart > 0 ? box('edts', fullbox('elst', 0, 0, u32(1), u32(vDurMs), u32(vt.ctsStart), u16(1), u16(0))) : [];
  const trakV = box('trak', tkhd, edtsV, box('mdia', arr(R.mdhd), arr(R.hdlr), box('minf', R.vmhd ? arr(R.vmhd) : fullbox('vmhd', 0, 1, zeros(8)), dinf, stblV)));
  // audio trak
  const tkhdA = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(movieDur), zeros(8), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0));
  const mdhdA = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(aTs), u32(totalFrames), u16(0x55c4), u16(0));
  const hdlrA = fullbox('hdlr', 0, 0, u32(0), str('soun'), zeros(12), str('SoundHandler'), [0]);
  const smhd = fullbox('smhd', 0, 0, u16(0), u16(0));
  const runs = []; for (const s of audio.samples) { const r = runs[runs.length - 1]; if (r && r[1] === s.frames) r[0]++; else runs.push([1, s.frames]); }
  const sttsA = fullbox('stts', 0, 0, u32(runs.length), runs.map(([c, d]) => [...u32(c), ...u32(d)]));
  const stszA = fullbox('stsz', 0, 0, u32(0), u32(audio.samples.length), audio.samples.map((s) => u32(s.data.length)));
  const stscA = fullbox('stsc', 0, 0, u32(1), u32(1), u32(audio.samples.length), u32(1));
  const stcoA = fullbox('stco', 0, 0, u32(1), u32(firstA));
  const entry = audioEntry(audio);
  const stblA = box('stbl', fullbox('stsd', 0, 0, u32(1), entry), sttsA, stscA, stszA, stcoA);
  const elst = box('edts', fullbox('elst', 0, 0, u32(1), u32(aDurMs), u32(isOpus ? preSkip : (audio.priming || 0)), u16(1), u16(0)));
  const trakA = box('trak', tkhdA, elst, box('mdia', mdhdA, hdlrA, box('minf', smhd, dinf, stblA)));
  const moov = box('moov', mvhd, trakV, trakA);
  const out = new Uint8Array(ftyp.length + 8 + vBytes + aBytes + moov.length);
  out.set(ftyp, 0); out.set(u32(8 + vBytes + aBytes), ftyp.length); out.set(str('mdat'), ftyp.length + 4);
  let o = firstV; for (const s of vt.samples) { out.set(vt.u8.subarray(s.off, s.off + s.size), o); o += s.size; }
  for (const s of audio.samples) { out.set(s.data, o); o += s.data.length; }
  out.set(moov, o);
  return out;
}

/** mono float32 -> 16-bit PCM WAV */
export function wavPcm16(x, sampleRate) {
  const n = x.length, buf = new Uint8Array(44 + n * 2), dv = new DataView(buf.buffer);
  buf.set(str('RIFF'), 0); dv.setUint32(4, 36 + n * 2, true); buf.set(str('WAVE'), 8); buf.set(str('fmt '), 12); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  buf.set(str('data'), 36); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, x[i])); dv.setInt16(44 + i * 2, Math.round(s * 32767), true); }
  return buf;
}
