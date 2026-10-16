// avcheck.js (lip-sync probe v002) - no lip-sync is "done" with a file this phone cannot play. checkMp4(bytes): the H.264 track (avc1 + avcC,
// sample count, samples inside mdat, duration) + the sound track through p0pc0rn v028's checkM4a (esds / ASC / DecoderConfig 0x40 / 0x15 /
// rate / channels); playableVideo(blob): the browser's own <video> loads it (metadata, a duration, a picture size).
import { checkM4a } from '../assistant/audiocheck.js';

const rd32 = (u, o) => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];
const rd16 = (u, o) => (u[o] << 8) | u[o + 1];
const typ = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
function boxes(u, a, b) {
  const out = [];
  for (let o = a; o + 8 <= b;) {
    let size = rd32(u, o), body = o + 8; const t = typ(u, o + 4);
    if (size === 1) { size = rd32(u, o + 8) * 4294967296 + rd32(u, o + 12); body = o + 16; } else if (size === 0) size = b - o;
    if (size < 8 || o + size > b) { out.push({ type: t, at: o, body, end: b, bad: true }); break; }
    out.push({ type: t, at: o, body, end: o + size }); o += size;
  }
  return out;
}
const find = (l, t) => l.find((x) => x.type === t);

/** bytes of the lip-sync MP4 -> {ok, problems, video: {codec, width, height, samples, seconds, keys}, audio: checkM4a(...) | null} */
export function checkMp4(u, { frames = null, seconds = null, audio = true } = {}) {
  const P = [], top = boxes(u, 0, u.length), r = { ok: false, problems: P, video: null, audio: null };
  if (!top.length || top[0].type !== 'ftyp') P.push('the file does not start with ftyp');
  if (top.some((b) => b.bad)) P.push('a box runs past the end of the file (truncated?)');
  const moov = find(top, 'moov'), mdat = find(top, 'mdat');
  if (!moov || !mdat) { P.push(!moov ? 'no moov' : 'no mdat'); return r; }
  for (const t of boxes(u, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = find(boxes(u, t.body, t.end), 'mdia'); if (!mdia) continue;
    const mk = boxes(u, mdia.body, mdia.end), hdlr = find(mk, 'hdlr'), mdhd = find(mk, 'mdhd'), minf = find(mk, 'minf');
    if (!hdlr || typ(u, hdlr.body + 8) !== 'vide') continue;
    const v = r.video = {};
    const v1 = u[mdhd.body] === 1, ts = rd32(u, mdhd.body + (v1 ? 20 : 12)), dur = v1 ? rd32(u, mdhd.body + 28) : rd32(u, mdhd.body + 16);
    v.seconds = ts > 0 ? dur / ts : 0;
    const stbl = minf && find(boxes(u, minf.body, minf.end), 'stbl');
    if (!stbl) { P.push('video: no stbl'); continue; }
    const sb = boxes(u, stbl.body, stbl.end), stsd = find(sb, 'stsd'), stsz = find(sb, 'stsz'), stco = find(sb, 'stco') || find(sb, 'co64'), stss = find(sb, 'stss');
    const entry = stsd && boxes(u, stsd.body + 8, stsd.end)[0];
    v.codec = entry ? entry.type : null;
    if (!entry || !/^(avc1|avc3)$/.test(entry.type)) P.push(`video: sample entry ${v.codec} is not H.264`);
    else {
      v.width = rd16(u, entry.body + 24); v.height = rd16(u, entry.body + 26);
      const avcC = find(boxes(u, entry.body + 78, entry.end), 'avcC');
      if (!avcC || avcC.end - avcC.body < 7) P.push('video: no avcC (decoder configuration)'); else v.profile = u[avcC.body + 1];
    }
    if (!stsz) P.push('video: no stsz');
    else {
      const fixed = rd32(u, stsz.body + 4), n = rd32(u, stsz.body + 8); v.samples = n;
      let total = fixed ? fixed * n : 0; if (!fixed) for (let i = 0; i < n; i++) total += rd32(u, stsz.body + 12 + 4 * i);
      const off = stco ? rd32(u, stco.body + 8) : -1;
      if (stco && (off < mdat.body || off + total > mdat.end)) P.push('video: the samples are not inside mdat');
      if (frames != null && n !== frames) P.push(`video: ${n} frames, not ${frames}`);
    }
    v.keys = stss ? rd32(u, stss.body + 4) : null;
    if (seconds && Math.abs(v.seconds - seconds) > Math.max(0.3, seconds * 0.05)) P.push(`video: lasts ${v.seconds.toFixed(2)} s, not ${seconds.toFixed(2)} s`);
  }
  if (!r.video) P.push('no video track');
  if (audio) {
    r.audio = checkM4a(u, { seconds });
    for (const q of r.audio.problems) P.push('sound: ' + q);
  }
  r.ok = !P.length;
  return r;
}

/** the browser's own <video> loads the file -> {ok, duration, width, height, error, timeout} (a timeout is noted, not a failure: iOS may
 *  hold media loading until a tap) */
export function playableVideo(blob, timeoutMs = 10000) {
  if (typeof document === 'undefined') return Promise.resolve({ ok: true, skipped: true });
  return new Promise((res) => {
    const v = document.createElement('video'), url = URL.createObjectURL(blob); let t = null;
    const end = (r) => { clearTimeout(t); v.removeAttribute('src'); try { v.load(); } catch (e) { /* */ } URL.revokeObjectURL(url); res(r); };
    v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.onloadedmetadata = () => end({ ok: isFinite(v.duration) && v.duration > 0 && v.videoWidth > 0, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => end({ ok: false, error: (v.error && (v.error.message || 'media error ' + v.error.code)) || 'media error' });
    t = setTimeout(() => end({ ok: false, timeout: true, error: 'the player did not load it in time' }), timeoutMs);
    v.src = url; try { v.load(); } catch (e) { /* */ }
  });
}
