// export.js - p0pc0rn v026.4: what a saved or shared file carries (Josh: AI disclosure, "follow their guidance": LTX-2 Attachment A item 5
// asks content to be "expressly and intelligibly" disclaimed as machine generated; ACE-Step asks users to "clearly disclose AI involvement").
// Every picture, clip and song that leaves the app through Save / Share / Download gets ONE machine-readable label, the string AI_TAG, in
// the format's standard text fields, and NOTHING else: no location, device, user, prompt, seed or app data. Whatever other metadata the
// file had is dropped on the way out (Josh's clean-export rule). No visible watermark. The Library keeps its untouched copies.
//   PNG : tEXt "Comment" + iTXt "XML:com.adobe.xmp" (dc:description); every other text / EXIF / time chunk dropped
//   JPEG: a COM segment + APP1 XMP; EXIF / XMP / other APPn and COM dropped (JFIF, ICC and Adobe colour segments kept)
//   MP4 / M4A: moov/udta "©cmt" (QuickTime text) + moov/udta/meta/ilst "©cmt" (iTunes) + a top-level XMP uuid box at the end; any old
//               udta / meta dropped; chunk offsets (stco / co64) moved by the moov's size change
//   WAV : a LIST/INFO "ICMT" chunk (old LIST chunks dropped)
// Anything else (or a file that does not parse) is returned as it was.

export const AI_TAG = 'AI-generated with p0pc0rn';
export const SHARE_TEXT = 'Made with AI using p0pc0rn';
const enc = new TextEncoder();
const XMP = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${AI_TAG}</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="r"?>`;
const XMP_UUID = [0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC];

const cat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const u32 = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u16 = (v) => new Uint8Array([(v >>> 8) & 255, v & 255]);
const str = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 255));   // latin-1 box / chunk names (© = 0xA9)
const rd32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const name4 = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

// ---------------------------------------------------------------- PNG
let CRC = null;
function crc32(parts) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const pngChunk = (type, data) => { const t = str(type); return cat([u32(data.length), t, data, u32(crc32([t, data]))]); };
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'cICP', 'mDCv', 'cLLi', 'pHYs', 'bKGD', 'acTL', 'fcTL', 'fdAT']);
function tagPng(b) {
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4E || b[3] !== 0x47) return null;
  const out = [b.subarray(0, 8)];
  let i = 8, done = false;
  while (i + 12 <= b.length) {
    const len = rd32(b, i), type = name4(b, i + 4), end = i + 12 + len;
    if (end > b.length) return null;
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    if (type === 'IHDR' && !done) {
      done = true;
      out.push(pngChunk('tEXt', cat([str('Comment'), new Uint8Array([0]), str(AI_TAG)])));
      out.push(pngChunk('iTXt', cat([str('XML:com.adobe.xmp'), new Uint8Array([0, 0, 0, 0, 0]), enc.encode(XMP)])));
    }
    i = end;
    if (type === 'IEND') break;
  }
  return done ? cat(out) : null;
}

// ---------------------------------------------------------------- JPEG
function tagJpeg(b) {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  const keep = [], tag = [];
  const com = enc.encode(AI_TAG), xmp = cat([str('http://ns.adobe.com/xap/1.0/'), new Uint8Array([0]), enc.encode(XMP)]);
  tag.push(cat([new Uint8Array([0xFF, 0xFE]), u16(com.length + 2), com]), cat([new Uint8Array([0xFF, 0xE1]), u16(xmp.length + 2), xmp]));
  let i = 2, app0 = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) return null;
    const m = b[i + 1];
    if (m === 0xDA) { keep.push(b.subarray(i)); i = b.length; break; }   // start of scan: the rest is image data, copied as is
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { keep.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3], seg = b.subarray(i, i + 2 + len);
    if (i + 2 + len > b.length) return null;
    if (m === 0xE0 && app0 == null) app0 = seg;
    else if (m === 0xE2 || m === 0xEE || (m < 0xE0 && m !== 0xFE) || m > 0xEF && m !== 0xFE) keep.push(seg);   // ICC, Adobe, tables, frames
    // dropped: APP1 (EXIF / XMP), APP3..APP13, APP15, COM
    i += 2 + len;
  }
  return cat([b.subarray(0, 2), ...(app0 ? [app0] : []), ...tag, ...keep]);
}

// ---------------------------------------------------------------- ISO BMFF (MP4 / M4A)
function boxes(b, s, e) {
  const out = [];
  let i = s;
  while (i + 8 <= e) {
    let size = rd32(b, i), hdr = 8;
    const type = name4(b, i + 4);
    if (size === 1) { if (i + 16 > e) return null; size = rd32(b, i + 8) * 4294967296 + rd32(b, i + 12); hdr = 16; }
    else if (size === 0) size = e - i;
    if (size < hdr || i + size > e) return null;
    out.push({ type, start: i, end: i + size, body: i + hdr });
    i += size;
  }
  return i === e ? out : null;
}
const box = (type, ...parts) => { const body = cat(parts); return cat([u32(body.length + 8), str(type), body]); };
const CONTAINERS = new Set(['trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);
/** a box rebuilt without udta / meta children (recursively through the track containers) */
function clean(b, bx) {
  if (bx.type !== 'trak' && !CONTAINERS.has(bx.type)) return b.subarray(bx.start, bx.end);
  const kids = boxes(b, bx.body, bx.end);
  if (!kids) return b.subarray(bx.start, bx.end);
  const parts = kids.filter((k) => k.type !== 'udta' && k.type !== 'meta').map((k) => clean(b, k));
  return cat([u32(8 + parts.reduce((a, p) => a + p.length, 0)), str(bx.type), ...parts]);
}
function shiftOffsets(m, delta) {   // m = the new moov bytes: every stco / co64 entry + delta
  const walk = (s, e) => {
    const ks = boxes(m, s, e); if (!ks) return;
    for (const k of ks) {
      if (k.type === 'trak' || CONTAINERS.has(k.type)) walk(k.body, k.end);
      else if (k.type === 'stco') { const n = rd32(m, k.body + 4); for (let j = 0; j < n; j++) { const p = k.body + 8 + 4 * j; m.set(u32(rd32(m, p) + delta), p); } }
      else if (k.type === 'co64') { const n = rd32(m, k.body + 4); for (let j = 0; j < n; j++) { const p = k.body + 8 + 8 * j, v = rd32(m, p) * 4294967296 + rd32(m, p + 4) + delta; m.set(u32(Math.floor(v / 4294967296)), p); m.set(u32(v >>> 0), p + 4); } }
    }
  };
  walk(8, m.length);
}
function tagMp4(b) {
  if (b.length < 16 || name4(b, 4) !== 'ftyp') return null;
  const top = boxes(b, 0, b.length); if (!top) return null;
  const moov = top.find((x) => x.type === 'moov'); if (!moov) return null;
  const txt = enc.encode(AI_TAG);
  const qt = box('©cmt', u16(txt.length), u16(0x55C4), txt);   // QuickTime user-data text: length, language 'und', text
  const hdlr = box('hdlr', u32(0), u32(0), str('mdir'), str('appl'), u32(0), u32(0), new Uint8Array([0]));
  const ilst = box('ilst', box('©cmt', box('data', u32(1), u32(0), txt)));
  const udta = box('udta', qt, box('meta', u32(0), hdlr, ilst));
  const fragmented = top.some((x) => x.type === 'moof');
  let newMoov = null;
  if (!fragmented) {
    const kids = boxes(b, moov.body, moov.end); if (!kids) return null;
    const parts = kids.filter((k) => k.type !== 'udta' && k.type !== 'meta').map((k) => clean(b, k));
    parts.push(udta);
    newMoov = cat([u32(8 + parts.reduce((a, p) => a + p.length, 0)), str('moov'), ...parts]);
    const delta = newMoov.length - (moov.end - moov.start);
    if (top.some((x) => x.type === 'mdat' && x.start > moov.start) && delta) shiftOffsets(newMoov, delta);
  }
  const xmp = box('uuid', new Uint8Array(XMP_UUID), enc.encode(XMP));
  const out = [];
  for (const x of top) {
    if (x.type === 'uuid' && XMP_UUID.every((v, j) => b[x.body + j] === v)) continue;   // an old XMP box
    if (x.type === 'meta') continue;                                                    // a file-level meta box
    out.push(x === moov && newMoov ? newMoov : b.subarray(x.start, x.end));
  }
  if (!top.some((x) => rd32(b, x.start) === 0)) out.push(xmp);   // a last box sized "to the end of the file" would swallow it
  return cat(out);
}

// ---------------------------------------------------------------- WAV
function tagWav(b) {
  if (b.length < 12 || name4(b, 0) !== 'RIFF' || name4(b, 8) !== 'WAVE') return null;
  const le32 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const rdle = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const out = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const id = name4(b, i), len = rdle(i + 4), end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) return null;
    if (id !== 'LIST' && id !== 'id3 ' && id !== 'ID3 ' && id !== 'bext' && id !== 'iXML') out.push(b.subarray(i, Math.min(end, b.length)));
    i = end;
  }
  const t = cat([enc.encode(AI_TAG), new Uint8Array([0])]), pad = t.length & 1 ? new Uint8Array([0]) : new Uint8Array(0);
  const icmt = cat([str('ICMT'), le32(t.length), t, pad]), list = cat([str('LIST'), le32(4 + icmt.length), str('INFO'), icmt]);
  out.push(list);
  const body = cat(out);
  return cat([str('RIFF'), le32(4 + body.length), str('WAVE'), body]);
}

/** blob -> a Blob carrying only the AI label (same type); the original when the format is not one of these or does not parse */
export async function tagMedia(blob) {
  if (!blob) return blob;
  try {
    const b = new Uint8Array(await blob.arrayBuffer());
    const t = tagPng(b) || tagJpeg(b) || tagMp4(b) || tagWav(b);
    return t ? new Blob([t], { type: blob.type }) : blob;
  } catch (e) { return blob; }
}
/** the label a file carries, read back (tests and Diagnostics): the AI_TAG strings found in it */
export async function readTag(blob) {
  const t = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
  return (t.match(new RegExp(AI_TAG, 'g')) || []).length;
}
