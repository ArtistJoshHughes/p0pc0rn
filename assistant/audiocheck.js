// audiocheck.js - p0pc0rn v024.1: a song is never DONE with a file this phone cannot play (Josh's iPhone, Oct 14: "Soft Touch" landed
// with an inline player that said "Error"). Two checks before a song job may finish:
//   1. checkM4a(bytes): the MP4 / M4A box structure Safari needs: ftyp; moov and mdat; mdhd timescale + duration; one sound trak whose
//      stsd entry (mp4a / Opus) matches it; for AAC an esds whose AudioSpecificConfig is present (AAC-LC or HE), whose sampling-frequency
//      index is the track's rate and whose channel configuration is the entry's channel count; stsz samples inside mdat; the duration
//      near the length asked for.
//   2. playable(blob): the browser's own media element loads it (loadedmetadata, a duration), the same stack as the chat's player.
// Pure + DOM-light (the media check needs a document); no engine imports.
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const rd32 = (u, o) => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];
const rd16 = (u, o) => (u[o] << 8) | u[o + 1];
const typ = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
/** boxes in [a, b): [{type, at (box start), body (payload start), end}] */
function boxes(u, a, b) {
  const out = [];
  for (let o = a; o + 8 <= b;) {
    let size = rd32(u, o), body = o + 8;
    const t = typ(u, o + 4);
    if (size === 1) { if (o + 16 > b) break; size = rd32(u, o + 8) * 4294967296 + rd32(u, o + 12); body = o + 16; }
    else if (size === 0) size = b - o;
    if (size < 8 || o + size > b) { out.push({ type: t, at: o, body, end: b, bad: true }); break; }
    out.push({ type: t, at: o, body, end: o + size });
    o += size;
  }
  return out;
}
const find = (list, t) => list.find((x) => x.type === t);
/** an MPEG-4 descriptor's payload: tag, then a length of 1-4 bytes of 7 bits */
function descr(u, o, end) {
  const tag = u[o]; let n = 0, i = o + 1;
  for (let k = 0; k < 4 && i < end; k++, i++) { n = (n << 7) | (u[i] & 0x7f); if (!(u[i] & 0x80)) { i++; break; } }
  return { tag, body: i, end: Math.min(end, i + n) };
}
/** the AudioSpecificConfig inside an esds payload (ES_Descriptor 0x03 -> DecoderConfig 0x04 -> DecoderSpecificInfo 0x05) */
function ascOf(u, o, end) {
  const es = descr(u, o, end); if (es.tag !== 0x03) return null;
  let p = es.body + 2; const flags = u[p++];
  if (flags & 0x80) p += 2; if (flags & 0x40) p += 1 + u[p]; if (flags & 0x20) p += 2;
  const dc = descr(u, p, es.end); if (dc.tag !== 0x04) return null;
  const oti = u[dc.body], stream = u[dc.body + 1], bufSize = (u[dc.body + 2] << 16) | (u[dc.body + 3] << 8) | u[dc.body + 4], maxBr = rd32(u, dc.body + 5), avgBr = rd32(u, dc.body + 9);
  const ds = descr(u, dc.body + 13, dc.end); if (ds.tag !== 0x05) return { bytes: new Uint8Array(0), oti, stream, bufSize, maxBr, avgBr };
  return { bytes: u.subarray(ds.body, ds.end), oti, stream, bufSize, maxBr, avgBr };
}
/** bytes (Uint8Array) of an .m4a / .mp4 with one sound track -> {ok, problems, codec, rate, channels, samples, seconds, asc} */
export function checkM4a(u, { seconds = null } = {}) {
  const P = [], top = boxes(u, 0, u.length), r = { ok: false, problems: P };
  if (!top.length || top[0].type !== 'ftyp') P.push('the file does not start with ftyp');
  const moov = find(top, 'moov'), mdat = find(top, 'mdat');
  if (!moov) P.push('no moov'); if (!mdat) P.push('no mdat');
  if (top.some((b) => b.bad)) P.push('a box runs past the end of the file (truncated?)');
  if (!moov || !mdat) return r;
  const trak = boxes(u, moov.body, moov.end).filter((b) => b.type === 'trak');
  let found = false;
  for (const t of trak) {
    const mdia = find(boxes(u, t.body, t.end), 'mdia'); if (!mdia) continue;
    const mk = boxes(u, mdia.body, mdia.end), hdlr = find(mk, 'hdlr'), mdhd = find(mk, 'mdhd'), minf = find(mk, 'minf');
    if (!hdlr || typ(u, hdlr.body + 8) !== 'soun') continue;
    found = true;
    if (!mdhd) { P.push('no mdhd'); continue; }
    const v1 = u[mdhd.body] === 1, ts = rd32(u, mdhd.body + (v1 ? 20 : 12)), dur = v1 ? rd32(u, mdhd.body + 24) * 4294967296 + rd32(u, mdhd.body + 28) : rd32(u, mdhd.body + 16);
    if (!(ts > 0)) P.push('mdhd timescale is 0');
    r.seconds = ts > 0 ? dur / ts : 0;
    const stbl = minf && find(boxes(u, minf.body, minf.end), 'stbl');
    if (!stbl) { P.push('no stbl'); continue; }
    const sb = boxes(u, stbl.body, stbl.end), stsd = find(sb, 'stsd'), stsz = find(sb, 'stsz'), stco = find(sb, 'stco') || find(sb, 'co64');
    if (!stsd || rd32(u, stsd.body + 4) < 1) { P.push('no sample description'); continue; }
    const entry = boxes(u, stsd.body + 8, stsd.end)[0];
    r.codec = entry.type === 'mp4a' ? 'aac' : entry.type === 'Opus' ? 'opus' : entry.type;
    const ch = rd16(u, entry.body + 16), rate = rd32(u, entry.body + 24) >>> 16;
    r.channels = ch; r.rate = rate;
    if (!(ch >= 1 && ch <= 2)) P.push(`channel count ${ch}`);
    if (r.codec === 'aac') {
      if (rate !== ts) P.push(`the entry's rate ${rate} is not the track's timescale ${ts}`);
      const esds = find(boxes(u, entry.body + 28, entry.end), 'esds');
      const a = esds && ascOf(u, esds.body + 4, esds.end);
      if (!a) P.push('no esds / decoder config');
      else if (a.bytes.length < 2) P.push('the AudioSpecificConfig is missing (Safari cannot decode without it)');
      else if (a.bytes[0] === 0x03 && a.bytes.length > 8) { r.asc = { hex: Array.from(a.bytes.subarray(0, 40), (x) => x.toString(16).padStart(2, '0')).join(' ') }; P.push('the AudioSpecificConfig holds a whole ES descriptor (the encoder\u2019s own cookie), not an ASC'); }
      else {
        const aot = a.bytes[0] >> 3, sfi = ((a.bytes[0] & 7) << 1) | (a.bytes[1] >> 7), cc = (a.bytes[1] >> 3) & 15;
        r.asc = { aot, sfi, ch: cc, hex: Array.from(a.bytes, (x) => x.toString(16).padStart(2, '0')).join(' ') };
        if (![2, 5, 29].includes(aot)) P.push(`audio object type ${aot} is not AAC-LC / HE`);
        if (AAC_RATES[sfi] !== rate && !(aot !== 2 && AAC_RATES[sfi] * 2 === rate)) P.push(`the ASC rate (${AAC_RATES[sfi]}) is not the track's ${rate}`);
        if (cc !== ch) P.push(`the ASC channels (${cc}) are not the entry's ${ch}`);
      }
      if (a) {   // v026.1: the DecoderConfig itself: MPEG-4 audio (0x40), an audio stream (0x15), and what it declares
        r.dcd = { oti: a.oti, stream: a.stream, bufferSizeDB: a.bufSize, maxBitrate: a.maxBr, avgBitrate: a.avgBr };
        if (a.oti !== 0x40) P.push(`the decoder config's object type is 0x${(a.oti || 0).toString(16)}, not MPEG-4 audio (0x40)`);
        if ((a.stream >> 2) !== 5) P.push(`the decoder config's stream type is 0x${(a.stream || 0).toString(16)}, not audio (0x15)`);
      }
    } else if (r.codec !== 'opus') P.push(`unexpected sample entry ${entry.type}`);
    if (!stsz) P.push('no stsz');
    else {
      const fixed = rd32(u, stsz.body + 4), n = rd32(u, stsz.body + 8); r.samples = n;
      let total = fixed ? fixed * n : 0; if (!fixed) for (let i = 0; i < n; i++) total += rd32(u, stsz.body + 12 + 4 * i);
      if (!(n > 0)) P.push('no samples');
      const off = stco ? rd32(u, stco.body + 8) : -1;
      if (stco && (off < mdat.body || off + total > mdat.end)) P.push('the samples are not inside mdat');
    }
  }
  if (!found) P.push('no sound track');
  if (seconds && r.seconds && Math.abs(r.seconds - seconds) > Math.max(1.5, seconds * 0.05)) P.push(`it lasts ${r.seconds.toFixed(1)} s, not ${seconds} s`);
  r.ok = !P.length;
  return r;
}
/** the browser's own media element loads the file (the chat's player uses the same stack) -> {ok, duration, error} */
export function playable(blob, timeoutMs = 8000) {
  if (typeof document === 'undefined' || typeof Audio === 'undefined') return Promise.resolve({ ok: true, skipped: true });
  return new Promise((res) => {
    const a = new Audio(), url = URL.createObjectURL(blob);
    let t = null;
    const end = (r) => { clearTimeout(t); a.removeAttribute('src'); try { a.load(); } catch (e) { /* */ } URL.revokeObjectURL(url); res(r); };
    a.preload = 'metadata'; a.muted = true;
    a.onloadedmetadata = () => end({ ok: isFinite(a.duration) && a.duration > 0, duration: a.duration });
    a.onerror = () => end({ ok: false, error: (a.error && (a.error.message || 'media error ' + a.error.code)) || 'media error' });
    t = setTimeout(() => end({ ok: false, timeout: true, error: 'the player did not load it in time' }), timeoutMs);
    a.src = url; try { a.load(); } catch (e) { /* */ }
  });
}
/** a song's audio before its job may finish -> {ok, why, info}. Only the structure check or an explicit media ERROR fails it: a player
 *  that never loads metadata (iOS may hold media loading until a tap) is not proof of a bad file, so a timeout passes, noted in info. */
const refused = (p) => !p.ok && !p.timeout;
export async function checkSong(blob, seconds) {
  if (!blob || !blob.size) return { ok: false, why: 'the song file is empty' };
  const type = String(blob.type || '');
  if (/mp4|m4a|aac/.test(type)) {
    const c = checkM4a(new Uint8Array(await blob.arrayBuffer()), { seconds });
    if (!c.ok) return { ok: false, why: c.problems.join('; '), info: c };
    const p = await playable(blob);
    return !refused(p) ? { ok: true, info: Object.assign({ player: p }, c) } : { ok: false, why: `the player refused it (${p.error || 'no duration'})`, info: c };
  }
  if (/wav/.test(type)) {
    const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (String.fromCharCode(...h.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...h.subarray(8, 12)) !== 'WAVE') return { ok: false, why: 'not a WAV file' };
    const p = await playable(blob);
    return !refused(p) ? { ok: true, info: { player: p } } : { ok: false, why: `the player refused it (${p.error || 'no duration'})` };
  }
  const p = await playable(blob);
  return !refused(p) ? { ok: true, info: { player: p } } : { ok: false, why: `the player refused it (${p.error || 'no duration'})` };
}
