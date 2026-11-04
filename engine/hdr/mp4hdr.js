// mp4hdr.js - p0pc0rn v4 "Make HDR": read a Library clip (its video track, and its sound track when it has one: music videos, lip-sync)
// and write the HDR copy: ftyp | moov | mdat with the new video track (HEVC, or VP9 / AV1 where a browser has no HEVC encoder) carrying
// colr 'nclx' (HLG: 9 / 18 / 9, limited range) and the sound track copied sample for sample (its own boxes kept; only where its samples
// sit changes). moov comes first, so the file starts playing before it has all arrived. Pure JS, no DOM.

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
function flat(parts, out = []) {
  if (parts == null) return out;
  if (typeof parts === 'number') { out.push(parts); return out; }
  if (parts instanceof Uint8Array) { for (let i = 0; i < parts.length; i++) out.push(parts[i]); return out; }
  for (const p of parts) flat(p, out);
  return out;
}
const box = (type, ...parts) => { const body = flat(parts); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
const err = (code, m) => Object.assign(new Error(m), { code });
const hex2 = (v) => v.toString(16).padStart(2, '0');

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
const find = (dv, b, type) => (b ? kids(dv, b.body, b.end).find((c) => c.type === type) : null);

/** one track's sample table -> {timescale, samples: [{off, size, dur, cto, key}]} (decode order) */
function sampleTable(dv, u8, trak) {
  const mdia = find(dv, trak, 'mdia'), mdhd = find(dv, mdia, 'mdhd'), v = dv.getUint8(mdhd.body);
  const timescale = dv.getUint32(mdhd.body + (v === 1 ? 20 : 12));
  const stbl = find(dv, find(dv, mdia, 'minf'), 'stbl'), S = {};
  for (const c of kids(dv, stbl.body, stbl.end)) S[c.type] = c;
  if (!S.stsd || !S.stsz || !(S.stco || S.co64) || !S.stsc || !S.stts) throw err('BAD_MP4', 'a track without its sample table');
  const n = dv.getUint32(S.stsz.body + 8), fixed = dv.getUint32(S.stsz.body + 4), sizes = new Array(n);
  for (let i = 0; i < n; i++) sizes[i] = fixed || dv.getUint32(S.stsz.body + 12 + 4 * i);
  const co = S.stco || S.co64, nco = dv.getUint32(co.body + 4), offs = [];
  for (let i = 0; i < nco; i++) offs.push(S.co64 ? Number(dv.getBigUint64(co.body + 8 + 8 * i)) : dv.getUint32(co.body + 8 + 4 * i));
  const nsc = dv.getUint32(S.stsc.body + 4), sc = [];
  for (let i = 0; i < nsc; i++) sc.push([dv.getUint32(S.stsc.body + 8 + 12 * i), dv.getUint32(S.stsc.body + 12 + 12 * i)]);
  const samples = []; let si = 0;
  for (let ci = 0; ci < nco; ci++) {
    let per = 0; for (const [first, cnt] of sc) if (ci + 1 >= first) per = cnt;
    let o = offs[ci]; for (let k = 0; k < per && si < n; k++, si++) { if (o + sizes[si] > u8.length) throw err('BAD_MP4', 'a sample past the end of the file'); samples.push({ off: o, size: sizes[si], dur: 0, cto: 0, key: true }); o += sizes[si]; }
  }
  if (samples.length !== n) throw err('BAD_MP4', 'the sample table does not add up');
  let k = 0; const ns = dv.getUint32(S.stts.body + 4);
  for (let i = 0; i < ns; i++) { const cnt = dv.getUint32(S.stts.body + 8 + 8 * i), d = dv.getUint32(S.stts.body + 12 + 8 * i); for (let j = 0; j < cnt && k < n; j++, k++) samples[k].dur = d; }
  if (S.ctts) { const ver = dv.getUint8(S.ctts.body), nc = dv.getUint32(S.ctts.body + 4); k = 0;
    for (let i = 0; i < nc; i++) { const cnt = dv.getUint32(S.ctts.body + 8 + 8 * i), raw = dv.getUint32(S.ctts.body + 12 + 8 * i); for (let j = 0; j < cnt && k < n; j++, k++) samples[k].cto = ver === 1 ? (raw | 0) : raw; } }
  if (S.stss) { const nk = dv.getUint32(S.stss.body + 4), keys = new Set(); for (let i = 0; i < nk; i++) keys.add(dv.getUint32(S.stss.body + 8 + 4 * i) - 1); samples.forEach((s, i) => { s.key = keys.has(i); }); }
  return { timescale, samples, S };
}

/**
 * MP4 bytes -> { movieTimescale, video: {timescale, width, height, codec ('avc1.PPCCLL' | 'hvc1....' | the entry type), description,
 *   samples: [{data, dur, cto, key, pts (ticks, from 0)}], seconds}, audio: null | {trak (raw box bytes), timescale, samples: [{data}] } }
 */
export function demux(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const top = kids(dv, 0, u8.byteLength), moov = top.find((b) => b.type === 'moov');
  if (!moov) throw err('BAD_MP4', 'not an MP4 (no moov box)');
  if (top.some((b) => b.type === 'moof')) throw err('BAD_MP4', 'a fragmented MP4 is not supported');
  const mvhd = find(dv, moov, 'mvhd'), mv = dv.getUint8(mvhd.body), movieTimescale = dv.getUint32(mvhd.body + (mv === 1 ? 20 : 12));
  let video = null, audio = null;
  for (const trak of kids(dv, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = find(dv, trak, 'mdia'), hdlr = mdia && find(dv, mdia, 'hdlr');
    const kind = hdlr ? String.fromCharCode(...u8.subarray(hdlr.body + 8, hdlr.body + 12)) : '';
    if (kind === 'vide' && !video) {
      const t = sampleTable(dv, u8, trak), entry = kids(dv, t.S.stsd.body + 8, t.S.stsd.end)[0];
      const width = dv.getUint16(entry.body + 24), height = dv.getUint16(entry.body + 26);
      const cfg = kids(dv, entry.body + 78, entry.end).find((x) => ['avcC', 'hvcC', 'av1C', 'vpcC'].includes(x.type));
      const description = cfg ? u8.slice(cfg.type === 'vpcC' ? cfg.body + 4 : cfg.body, cfg.end) : null;
      let codec = entry.type;
      if (cfg && cfg.type === 'avcC') codec = `${entry.type}.${hex2(description[1])}${hex2(description[2])}${hex2(description[3])}`;
      const samples = t.samples.map((s) => ({ data: u8.subarray(s.off, s.off + s.size), dur: s.dur, cto: s.cto, key: s.key, dts: 0, pts: 0 }));
      let dts = 0; for (const s of samples) { s.dts = dts; s.pts = dts + s.cto; dts += s.dur; }
      const p0 = samples.length ? Math.min(...samples.map((s) => s.pts)) : 0; for (const s of samples) s.pts -= p0;
      video = { timescale: t.timescale, width, height, codec, configBox: cfg ? cfg.type : null, description, samples, seconds: dts / t.timescale };
    } else if (kind === 'soun' && !audio) {
      const t = sampleTable(dv, u8, trak);
      audio = { trak: u8.slice(trak.start, trak.end), timescale: t.timescale, samples: t.samples.map((s) => ({ data: u8.subarray(s.off, s.off + s.size) })) };
    }
  }
  if (!video) throw err('BAD_MP4', 'no video track');
  if (!video.samples.length) throw err('BAD_MP4', 'an empty video track');
  return { movieTimescale, video, audio };
}

/** a copied 'trak' with its sample data moved: every chunk becomes one chunk at `offset` (stsc -> one run, stco -> one entry) */
function moveTrak(trak, offset, n) {
  const dv = new DataView(trak.buffer, trak.byteOffset, trak.byteLength);
  const rebuild = (b) => {   // a container box rebuilt with its children (recursively for the track containers)
    const children = kids(dv, b.body, b.end), parts = [];
    for (const c of children) {
      if (['mdia', 'minf', 'stbl'].includes(c.type)) parts.push(rebuild(c));
      else if (c.type === 'stsc') parts.push(fullbox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)));
      else if (c.type === 'stco' || c.type === 'co64') parts.push(fullbox('stco', 0, 0, u32(1), u32(offset)));
      else if (c.type === 'tkhd') {   // the sound is track 2 (the video is track 1)
        const t = Array.from(trak.subarray(c.start, c.end)), at = 8 + 4 + (trak[c.body] === 1 ? 16 : 8);
        t.splice(at, 4, ...u32(2)); parts.push(t);
      } else parts.push(Array.from(trak.subarray(c.start, c.end)));
    }
    return box(b.type, ...parts);
  };
  return rebuild({ type: 'trak', body: 8, end: trak.length });
}

/**
 * Write the HDR copy.
 *  kind: 'hevc' | 'vp9' | 'av1'; description: hvcC / av1C body, or the vpcC payload (after its version + flags);
 *  chunks: [{data (length-prefixed for HEVC), key, ts (us, presentation time)}] in DECODE order; durations: ticks of each frame (in
 *  presentation order) on `timescale` (the source track's); color: {primaries, transfer, matrix, fullRange}; audio: demux().audio or null.
 * -> Uint8Array
 */
export function mux({ kind, width, height, timescale, durations, description, chunks, color, audio = null, movieTimescale = 1000 }) {
  const n = chunks.length;
  if (!n) throw err('EMPTY', 'no frames');
  const pts = chunks.map((c) => Math.round((c.ts * timescale) / 1e6));
  const sorted = pts.slice().sort((a, b) => a - b);
  // decode times: the presentation times in order, moved back by the encoder's reorder delay so that no frame decodes after it shows
  let delay = 0; for (let i = 0; i < n; i++) delay = Math.max(delay, sorted[i] - pts[i]);
  const dts = sorted.map((t) => t - sorted[0]);   // starts at 0
  const cto = pts.map((t, i) => t - sorted[0] + delay - dts[i]);   // >= 0
  const lastDur = durations && durations.length ? durations[durations.length - 1] : (n > 1 ? sorted[n - 1] - sorted[n - 2] : timescale / 16);
  const dur = []; for (let i = 0; i < n; i++) dur.push(i + 1 < n ? dts[i + 1] - dts[i] : Math.max(1, Math.round(lastDur)));
  const mediaDur = dur.reduce((a, b) => a + b, 0);
  const movieDur = Math.round((mediaDur * movieTimescale) / timescale);
  const runs = (vals) => { const r = []; for (const v of vals) { const l = r[r.length - 1]; if (l && l[1] === v) l[0]++; else r.push([1, v]); } return r; };
  const needCtts = cto.some((o) => o !== 0);
  const brands = ['isom', 'iso2', 'mp41']; if (kind === 'av1') brands.push('av01');
  const ftyp = box('ftyp', str('isom'), u32(512), brands.map(str));
  const nextTrack = audio ? 3 : 2;
  const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(movieTimescale), u32(movieDur), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(nextTrack));
  const tkhd = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16));
  const edts = delay > 0 ? box('edts', fullbox('elst', 0, 0, u32(1), u32(movieDur), u32(delay), u16(1), u16(0))) : [];
  const mdhd = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDur), u16(0x55c4), u16(0));
  const hdlr = fullbox('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler'), [0]);
  const vmhd = fullbox('vmhd', 0, 1, zeros(8));
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  const colr = box('colr', str('nclx'), u16(color.primaries), u16(color.transfer), u16(color.matrix), [color.fullRange ? 0x80 : 0]);
  const pasp = box('pasp', u32(1), u32(1));
  let cfgBox, fourcc;
  if (kind === 'hevc') { fourcc = 'hvc1'; cfgBox = box('hvcC', description); }
  else if (kind === 'av1') { fourcc = 'av01'; cfgBox = box('av1C', description); }
  else if (kind === 'vp9') { fourcc = 'vp09'; cfgBox = fullbox('vpcC', 1, 0, description); }
  else throw err('BAD_KIND', 'unknown video kind ' + kind);
  const entry = box(fourcc, zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff), cfgBox, colr, pasp);
  const keys = []; chunks.forEach((c, i) => { if (c.key) keys.push(i + 1); });
  const vBytes = chunks.reduce((s, c) => s + c.data.length, 0), aBytes = audio ? audio.samples.reduce((s, x) => s + x.data.length, 0) : 0;
  const build = (firstV) => {
    const sttsR = runs(dur), stbl = box('stbl', fullbox('stsd', 0, 0, u32(1), entry), fullbox('stts', 0, 0, u32(sttsR.length), sttsR.map(([c, d]) => [...u32(c), ...u32(d)])),
      needCtts ? (() => { const r = runs(cto); return fullbox('ctts', 0, 0, u32(r.length), r.map(([c, o]) => [...u32(c), ...u32(o)])); })() : [],
      keys.length === n ? [] : fullbox('stss', 0, 0, u32(keys.length), keys.map(u32)), fullbox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
      fullbox('stsz', 0, 0, u32(0), u32(n), chunks.map((c) => u32(c.data.length))), fullbox('stco', 0, 0, u32(1), u32(firstV)));
    const trakV = box('trak', tkhd, edts, box('mdia', mdhd, hdlr, box('minf', vmhd, dinf, stbl)));
    const trakA = audio ? moveTrak(audio.trak, firstV + vBytes, audio.samples.length) : [];
    return box('moov', mvhd, trakV, trakA);
  };
  const moovLen = build(0).length, firstV = ftyp.length + moovLen + 8, moov = build(firstV);
  if (moov.length !== moovLen) throw err('MUX', 'the moov changed size');
  if (firstV + vBytes + aBytes > 0xffffffff) throw err('TOO_BIG', 'the clip is too long for one file');
  const out = new Uint8Array(firstV + vBytes + aBytes);
  out.set(ftyp, 0); out.set(moov, ftyp.length);
  out.set(u32(8 + vBytes + aBytes), ftyp.length + moovLen); out.set(str('mdat'), ftyp.length + moovLen + 4);
  let o = firstV;
  for (const c of chunks) { out.set(c.data, o); o += c.data.length; }
  if (audio) for (const s of audio.samples) { out.set(s.data, o); o += s.data.length; }
  return out;
}

/** the video sample entry's colr box of an MP4 (the report's read-back): {kind, primaries, transfer, matrix, fullRange} | null */
export function readColr(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const moov = kids(dv, 0, u8.byteLength).find((b) => b.type === 'moov'); if (!moov) return null;
  for (const trak of kids(dv, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = find(dv, trak, 'mdia'), hdlr = mdia && find(dv, mdia, 'hdlr');
    if (!hdlr || String.fromCharCode(...u8.subarray(hdlr.body + 8, hdlr.body + 12)) !== 'vide') continue;
    const stsd = find(dv, find(dv, find(dv, mdia, 'minf'), 'stbl'), 'stsd'), entry = kids(dv, stsd.body + 8, stsd.end)[0];
    const c = kids(dv, entry.body + 78, entry.end).find((x) => x.type === 'colr'); if (!c) return null;
    const kind = String.fromCharCode(...u8.subarray(c.body, c.body + 4));
    return { kind, primaries: dv.getUint16(c.body + 4), transfer: dv.getUint16(c.body + 6), matrix: dv.getUint16(c.body + 8), fullRange: kind === 'nclx' ? !!(dv.getUint8(c.body + 10) & 0x80) : null };
  }
  return null;
}

// ------------------------------------------------------------------ codec setup records for encoders that give none (or Annex B)
/** Annex-B byte stream -> NAL units without start codes */
export function splitAnnexB(u8) {
  const nals = []; let i = 0, start = -1;
  while (i + 2 < u8.length) {
    if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1) { if (start >= 0) { let e = i; while (e > start && u8[e - 1] === 0) e--; nals.push(u8.subarray(start, e)); } i += 3; start = i; }
    else i++;
  }
  if (start >= 0 && start < u8.length) nals.push(u8.subarray(start));
  return nals.filter((x) => x.length);
}
export const isAnnexB = (u8) => u8.length > 4 && u8[0] === 0 && u8[1] === 0 && (u8[2] === 1 || (u8[2] === 0 && u8[3] === 1));
export function lengthPrefixed(nals) {
  const total = nals.reduce((s, x) => s + 4 + x.length, 0), out = new Uint8Array(total); let o = 0;
  for (const x of nals) { out.set(u32(x.length), o); out.set(x, o + 4); o += 4 + x.length; }
  return out;
}
/** the sequence header OBU (type 1), header included, from an AV1 key chunk */
export function findAv1SeqHeader(u8) {
  const leb = (o) => { let v = 0, n = 0; for (let i = 0; i < 8; i++) { const b = u8[o + i]; v += (b & 0x7f) * 2 ** (7 * i); n++; if (!(b & 0x80)) break; } return [v, n]; };
  let o = 0;
  while (o < u8.length) {
    const h = u8[o], type = (h >> 3) & 15, ext = (h >> 2) & 1, hasSize = (h >> 1) & 1;
    let p = o + 1 + ext, size;
    if (hasSize) { const [v, k] = leb(p); size = v; p += k; } else size = u8.length - p;
    if (type === 1) return u8.slice(o, p + size);
    o = p + size;
  }
  return null;
}
/** av01.P.LLT.DD + its sequence header -> av1C */
export function buildAv1C(codec, seqHdr) {
  const m = /^av01\.(\d)\.(\d\d)([MH])\.(\d\d)/.exec(codec); if (!m) throw err('BAD_CODEC', 'bad av1 codec string ' + codec);
  const prof = +m[1], lvl = +m[2], tier = m[3] === 'H' ? 1 : 0, bd = +m[4];
  const b2 = (tier << 7) | ((bd > 8 ? 1 : 0) << 6) | ((bd === 12 ? 1 : 0) << 5) | ((prof === 1 ? 0 : 1) << 3) | ((prof === 0 ? 1 : 0) << 2);
  return new Uint8Array([0x81, (prof << 5) | lvl, b2, 0, ...(seqHdr || [])]);
}
/** vp09.PP.LL.DD -> the vpcC payload (after the full-box header): profile, level, bit depth | chroma 4:2:0 colocated | range, colour, no init data */
export function buildVpcC(codec, color) {
  const m = /^vp09\.(\d\d)\.(\d\d)\.(\d\d)/.exec(codec); if (!m) throw err('BAD_CODEC', 'bad vp9 codec string ' + codec);
  return new Uint8Array([+m[1], +m[2], (+m[3] << 4) | (1 << 1) | (color.fullRange ? 1 : 0), color.primaries, color.transfer, color.matrix, 0, 0]);
}
