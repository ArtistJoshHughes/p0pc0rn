// gainmap.js - p0pc0rn v4 "Make HDR" for pictures: a JPEG with a gain map, built in JS (pure: no DOM; node-tested).
//  - The SDR base is the picture itself (a JPEG the browser encodes from it); SDR screens and old apps show only that.
//  - The gain map is one channel: log2((HDR + o) / (SDR + o)) on luminance, averaged over 2x2 blocks, written as a grayscale baseline JPEG
//    by the small encoder below. HDR = the look's curve (hdr_core.js, the same maths as the video shader) relative to SDR white = 203 nits
//    (HLG reference white), so SDR white reaches 1000 nits at full headroom (log2(1000 / 203) = 2.30 stops).
//  - The container: MPF (CIPA DC-007) points at the second image; the gain-map metadata goes in Adobe / Ultra HDR XMP (hdrgm) and / or
//    ISO 21496-1 (APP2 "urn:iso:std:iso:ts:21496:-1"), laid out the way libultrahdr does. ROUTES: 'both' (the default, the most
//    compatible), 'xmp', 'iso'. Which of them iPhone Photos badges is still to be seen on the phone, so the route stays switchable.
//  - The file carries p0pc0rn's AI label like every exported JPEG (export.js: a COM segment + the XMP dc:description) and NOTHING else,
//    so export.js sends it out unchanged (re-writing its segments would break the MPF offsets).

import { lookOf, lookNits, SDR_WHITE_NITS, PEAK_NITS } from './hdr_core.js';

export const OFFSET = 1 / 64;
export const ROUTES = ['both', 'xmp', 'iso'];
export const DEFAULT_ROUTE = 'both';
export const AI_TAG = 'AI-generated with p0pc0rn';   // = export.js AI_TAG (export.js imports nothing; the tests check they match)

/** px: RGBA bytes (sRGB) -> { map: Uint8Array gw*gh, gw, gh, min, max (log2), capacityMax, meanLog2, ms } */
export function computeGainMap(px, W, H, { scale = 2, look = 'vivid' } = {}) {
  const q = typeof look === 'string' ? lookOf(look) : look;
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const srgb = new Float32Array(256), l24 = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; srgb[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); l24[i] = Math.pow(c, 2.4); }
  // the curve depends only on the BT.1886 luminance: tabulated finely (luminance is continuous, so interpolated)
  const LUT = 4096, hdrOf = new Float32Array(LUT + 1);
  for (let i = 0; i <= LUT; i++) hdrOf[i] = lookNits(i / LUT, q) / SDR_WHITE_NITS;
  const gw = Math.ceil(W / scale), gh = Math.ceil(H / scale), acc = new Float32Array(gw * gh), cnt = new Uint16Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const gy = ((y / scale) | 0) * gw;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
      const Ys = 0.2126 * srgb[r] + 0.7152 * srgb[g] + 0.0722 * srgb[b];
      const Yv = 0.2126 * l24[r] + 0.7152 * l24[g] + 0.0722 * l24[b];   // = BT.2020 luminance of the BT.2020-converted colour
      let hdr;
      if (Yv < 1e-3) hdr = lookNits(Yv, q) / SDR_WHITE_NITS;            // exact in the deep shadows (the curve is steep there)
      else { const f = Yv * LUT, i = Math.min(LUT - 1, f | 0), a = f - i; hdr = hdrOf[i] * (1 - a) + hdrOf[i + 1] * a; }
      const gi = gy + ((x / scale) | 0);
      acc[gi] += Math.log2((hdr + OFFSET) / (Ys + OFFSET)); cnt[gi]++;
    }
  }
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < acc.length; i++) { acc[i] /= cnt[i]; if (acc[i] < min) min = acc[i]; if (acc[i] > max) max = acc[i]; sum += acc[i]; }
  if (max - min < 1e-3) max = min + 1e-3;
  const map = new Uint8Array(gw * gh);
  for (let i = 0; i < acc.length; i++) map[i] = Math.max(0, Math.min(255, Math.round(((acc[i] - min) / (max - min)) * 255)));   // gamma 1
  return { map, gw, gh, min, max, capacityMax: Math.log2(PEAK_NITS / SDR_WHITE_NITS), meanLog2: sum / acc.length,
    ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0 };
}

// ------------------------------------------------------------------ a small baseline JPEG encoder (grayscale, ITU T.81 Annex K tables)
const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34,
  0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99,
  0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7,
  0xf8, 0xf9, 0xfa];
function huffTable(bits, vals) {   // T.81 Annex C: value -> [code, length]
  const t = {}; let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) { for (let i = 0; i < bits[len - 1]; i++) t[vals[k++]] = [code++, len]; code <<= 1; }
  return t;
}
const HDC = huffTable(DC_BITS, DC_VALS), HAC = huffTable(AC_BITS, AC_VALS);
const COS = (() => { const c = new Float64Array(64); for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) c[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16); return c; })();

/** gray: Uint8Array w*h -> a baseline grayscale JPEG (no JFIF / metadata; the caller adds its own APPn segments) */
export function encodeGrayJpeg(gray, w, h, quality = 95) {
  const qs = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  const q = QL.map((v) => Math.max(1, Math.min(255, Math.floor((v * qs + 50) / 100))));
  const out = []; const push = (...b) => { for (const x of b) out.push(x & 255); };
  const seg = (marker, body) => { push(0xff, marker, (body.length + 2) >> 8, body.length + 2); for (const x of body) out.push(x); };
  push(0xff, 0xd8);
  seg(0xdb, [0x00, ...ZZ.map((i) => q[i])]);
  seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
  seg(0xc4, [0x00, ...DC_BITS, ...DC_VALS]);
  seg(0xc4, [0x10, ...AC_BITS, ...AC_VALS]);
  seg(0xda, [1, 1, 0x00, 0, 63, 0]);
  let acc = 0, nb = 0;
  const bits = (code, len) => {
    for (let i = len - 1; i >= 0; i--) { acc = (acc << 1) | ((code >> i) & 1); nb++;
      if (nb === 8) { out.push(acc); if (acc === 0xff) out.push(0); acc = 0; nb = 0; } }
  };
  const cat = (v) => { let a = Math.abs(v), s = 0; while (a) { s++; a >>= 1; } return s; };
  const vbits = (v, s) => (v < 0 ? v + (1 << s) - 1 : v);
  const blk = new Float64Array(64), tmp = new Float64Array(64), coef = new Int32Array(64);
  let prevDC = 0;
  for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = gray[Math.min(h - 1, by + y) * w + Math.min(w - 1, bx + x)] - 128;
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += blk[y * 8 + x] * COS[x * 8 + u]; tmp[y * 8 + u] = s; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
      let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y * 8 + v];
      const cu = u ? 1 : Math.SQRT1_2, cv = v ? 1 : Math.SQRT1_2;
      coef[v * 8 + u] = Math.round((0.25 * cu * cv * s) / q[v * 8 + u]);
    }
    const dc = coef[0], d = dc - prevDC; prevDC = dc;
    const s0 = cat(d); bits(...HDC[s0]); if (s0) bits(vbits(d, s0), s0);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = coef[ZZ[k]];
      if (!v) { run++; continue; }
      while (run > 15) { bits(...HAC[0xf0]); run -= 16; }
      const s = cat(v); bits(...HAC[(run << 4) | s]); bits(vbits(v, s), s); run = 0;
    }
    if (run) bits(...HAC[0x00]);
  }
  if (nb) { const pad = 8 - nb; bits((1 << pad) - 1, pad); }
  push(0xff, 0xd9);
  return Uint8Array.from(out);
}

// ------------------------------------------------------------------ JPEG segments + the gain-map container
/** -> [{marker, start, end (exclusive), payloadStart}] up to and including SOS (the rest is entropy data + EOI) */
export function jpegSegments(u8) {
  if (u8[0] !== 0xff || u8[1] !== 0xd8) throw Object.assign(new Error('not a JPEG (no SOI)'), { code: 'BAD_JPEG' });
  const segs = []; let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) throw Object.assign(new Error('bad marker at ' + p), { code: 'BAD_JPEG' });
    const m = u8[p + 1];
    if (m === 0xff) { p++; continue; }
    const len = (u8[p + 2] << 8) | u8[p + 3];
    segs.push({ marker: m, start: p, end: p + 2 + len, payloadStart: p + 4 });
    p += 2 + len;
    if (m === 0xda) break;
  }
  return segs;
}
const enc = new TextEncoder();
export const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
export const ISO_NS = 'urn:iso:std:iso:ts:21496:-1\0';
function app(marker, payload) {
  const n = payload.length + 2; if (n > 65535) throw new Error('segment too big');
  const s = new Uint8Array(n + 2); s[0] = 0xff; s[1] = marker; s[2] = n >> 8; s[3] = n & 255; s.set(payload, 4); return s;
}
const cat = (parts) => { const n = parts.reduce((a, b) => a + b.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const f6 = (x) => (Math.round(x * 1e6) / 1e6).toString();

/** the primary image's XMP: p0pc0rn's AI label (dc:description) and, for the XMP routes, hdrgm:Version + the GContainer directory
 *  (the ISO-only route carries the label alone, so it stays an ISO 21496-1-only file) */
export function xmpPrimary(gainLen, { hdrgm = true } = {}) {
  const label = `   <dc:description>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${AI_TAG}</rdf:li>\n    </rdf:Alt>\n   </dc:description>\n`;
  if (!hdrgm) return '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n' + label + '  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>';
  return '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '  <rdf:Description rdf:about="" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0">\n' + label +
    '   <Container:Directory>\n    <rdf:Seq>\n' +
    '     <rdf:li rdf:parseType="Resource">\n      <Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/>\n     </rdf:li>\n' +
    `     <rdf:li rdf:parseType="Resource">\n      <Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="${gainLen}"/>\n     </rdf:li>\n` +
    '    </rdf:Seq>\n   </Container:Directory>\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>';
}
export function xmpGainMap(m) {
  return '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '  <rdf:Description rdf:about="" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"' +
    ` hdrgm:GainMapMin="${f6(m.min)}" hdrgm:GainMapMax="${f6(m.max)}" hdrgm:Gamma="1" hdrgm:OffsetSDR="${f6(OFFSET)}" hdrgm:OffsetHDR="${f6(OFFSET)}"` +
    ` hdrgm:HDRCapacityMin="0" hdrgm:HDRCapacityMax="${f6(m.capacityMax)}" hdrgm:BaseRenditionIsHDR="False"/>\n </rdf:RDF>\n</x:xmpmeta>`;
}
/** ISO 21496-1 binary metadata (big-endian), one channel, an explicit numerator / denominator per value (as libultrahdr writes it) */
export function isoGainMapMeta(m) {
  const D = 1000000, b = [];
  const u16 = (v) => b.push((v >> 8) & 255, v & 255);
  const u32 = (v) => { v >>>= 0; b.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); };
  const frac = (x) => { u32(Math.round(x * D) | 0); u32(D); };   // a signed numerator is written as its two's complement
  u16(0); u16(0);                       // minimum_version, writer_version
  b.push(0x40);                         // flags: one channel, use_base_colour_space = 1, no backward direction, no common denominator
  frac(0); frac(m.capacityMax);         // base / alternate HDR headroom (log2)
  frac(m.min); frac(m.max); frac(1); frac(OFFSET); frac(OFFSET);   // gain map min, max (log2), gamma, base offset, alternate offset
  return Uint8Array.from(b);
}
export const isoVersionOnly = () => Uint8Array.from([0, 0, 0, 0]);

function mpfPayload(primarySize, secOffset, secSize) {
  const b = [0x4d, 0x50, 0x46, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8];   // "MPF\0", big-endian TIFF header, first IFD at 8
  const u16 = (v) => b.push((v >> 8) & 255, v & 255), u32 = (v) => { v >>>= 0; b.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); };
  u16(3);
  u16(0xb000); u16(7); u32(4); b.push(0x30, 0x31, 0x30, 0x30);   // MPFVersion "0100"
  u16(0xb001); u16(4); u32(1); u32(2);                           // NumberOfImages 2
  u16(0xb002); u16(7); u32(32); u32(8 + 2 + 3 * 12 + 4);          // MPEntry: 2 x 16 bytes, right after this IFD
  u32(0);                                                        // no next IFD
  u32(0x00030000); u32(primarySize); u32(0); u16(0); u16(0);     // primary: baseline JPEG, type "primary"
  u32(0x00000000); u32(secSize); u32(secOffset); u16(0); u16(0); // the gain map
  return Uint8Array.from(b);
}

/** base: the SDR JPEG, gain: the gray gain-map JPEG, m: computeGainMap() result; route: 'both' (XMP + ISO) | 'xmp' | 'iso'
 *  -> { bytes, layout }. The base keeps only its JFIF (APP0), ICC (APP2) and image segments; everything else of it is dropped. */
export function buildGainMapJpeg(base, gain, m, route = DEFAULT_ROUTE) {
  if (!ROUTES.includes(route)) throw Object.assign(new Error('unknown route ' + route), { code: 'BAD_ROUTE' });
  const useX = route !== 'iso', useI = route !== 'xmp';
  // the gain-map image: SOI, XMP (hdrgm values), ISO 21496-1 (full), then the encoded image after its SOI
  const gParts = [Uint8Array.from([0xff, 0xd8])];
  if (useX) gParts.push(app(0xe1, cat([enc.encode(XMP_NS), enc.encode(xmpGainMap(m))])));
  if (useI) gParts.push(app(0xe2, cat([enc.encode(ISO_NS), isoGainMapMeta(m)])));
  gParts.push(gain.subarray(2));
  const g = cat(gParts);
  // the primary: SOI, XMP (container directory + the label), ISO (version only), MPF, the label (COM), then the base after its SOI
  const segs = jpegSegments(base), keep = [], dropped = [];
  for (const s of segs) {
    const isIcc = s.marker === 0xe2 && String.fromCharCode(...base.subarray(s.payloadStart, s.payloadStart + 11)) === 'ICC_PROFILE';
    const isApp0 = s.marker === 0xe0;
    if ((s.marker >= 0xe1 && s.marker <= 0xef && !isIcc) || s.marker === 0xfe) { dropped.push(s.marker.toString(16)); continue; }
    if (isApp0 && keep.some((x) => x[1] === 0xe0)) { dropped.push('e0'); continue; }
    keep.push(base.subarray(s.start, s.end));
  }
  const last = segs[segs.length - 1]; keep.push(base.subarray(last.end));
  const head = [Uint8Array.from([0xff, 0xd8])];
  head.push(app(0xe1, cat([enc.encode(XMP_NS), enc.encode(xmpPrimary(g.length, { hdrgm: useX }))])));   // the ISO route: the label only
  if (useI) head.push(app(0xe2, cat([enc.encode(ISO_NS), isoVersionOnly()])));
  const com = app(0xfe, enc.encode(AI_TAG));
  const headLen = head.reduce((a, b) => a + b.length, 0), mpfLen = 4 + mpfPayload(0, 0, 0).length;
  const restLen = com.length + keep.reduce((a, b) => a + b.length, 0);
  const primarySize = headLen + mpfLen + restLen, secOffset = primarySize - (headLen + 8);
  const mpf = app(0xe2, mpfPayload(primarySize, secOffset, g.length));
  const bytes = cat([...head, mpf, com, ...keep, g]);
  return { bytes, layout: { route, primarySize, gainMapSize: g.length, mpfAt: headLen, secOffset, droppedFromBase: dropped } };
}

/** read back what a reader would: MPF entries, where image 2 starts, the hdrgm values, the ISO block, the label */
export function inspectGainMapJpeg(u8) {
  const out = { bytes: u8.length };
  const segs = jpegSegments(u8), dec = new TextDecoder();
  for (const s of segs) {
    const pl = u8.subarray(s.payloadStart, s.end);
    if (s.marker === 0xe2 && pl[0] === 0x4d && pl[1] === 0x50 && pl[2] === 0x46) {
      const dv = new DataView(pl.buffer, pl.byteOffset + 4), le = dv.getUint16(0) === 0x4949, ifd = dv.getUint32(4, le), n = dv.getUint16(ifd, le);
      let entOff = 0, count = 0;
      for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12, tag = dv.getUint16(e, le); if (tag === 0xb001) count = dv.getUint32(e + 8, le); if (tag === 0xb002) entOff = dv.getUint32(e + 8, le); }
      const base = s.payloadStart + 4;
      out.mpf = { images: count, entries: [] };
      for (let i = 0; i < count; i++) { const e = entOff + i * 16; const size = dv.getUint32(e + 4, le), off = dv.getUint32(e + 8, le);
        const at = i === 0 ? 0 : base + off; out.mpf.entries.push({ attr: '0x' + dv.getUint32(e, le).toString(16), size, offset: off, startsWithSOI: u8[at] === 0xff && u8[at + 1] === 0xd8, at }); }
    }
    if (s.marker === 0xe1 && dec.decode(pl.subarray(0, XMP_NS.length)) === XMP_NS) { const x = dec.decode(pl); out.xmpPrimary = { hdrgm: /hdrgm:Version/.test(x), container: /Container:Directory/.test(x), label: x.includes(AI_TAG) }; }
    if (s.marker === 0xe2 && dec.decode(pl.subarray(0, ISO_NS.length)) === ISO_NS) out.isoPrimary = pl.length - ISO_NS.length + ' bytes';
    if (s.marker === 0xfe) out.comment = dec.decode(pl);
    if (s.marker === 0xc0) out.size = `${(pl[3] << 8) | pl[4]}x${(pl[1] << 8) | pl[2]}`;
  }
  const g = out.mpf && out.mpf.entries[1];
  if (g && g.startsWithSOI) {
    const gm = u8.subarray(g.at, g.at + g.size), gs = jpegSegments(gm);
    out.gainMapEndsWithEOI = gm[gm.length - 2] === 0xff && gm[gm.length - 1] === 0xd9 && g.at + g.size === u8.length;
    for (const s of gs) {
      const pl = gm.subarray(s.payloadStart, s.end);
      if (s.marker === 0xe1 && dec.decode(pl.subarray(0, XMP_NS.length)) === XMP_NS) { const x = dec.decode(pl.subarray(XMP_NS.length)); const v = {}; for (const mm of x.matchAll(/hdrgm:(\w+)="([^"]*)"/g)) v[mm[1]] = mm[2]; out.xmpGainMap = v; }
      if (s.marker === 0xe2 && dec.decode(pl.subarray(0, ISO_NS.length)) === ISO_NS) { const d = new DataView(pl.buffer, pl.byteOffset + ISO_NS.length); const r = (o) => d.getInt32(o) / d.getUint32(o + 4);
        out.isoGainMap = { flags: '0x' + d.getUint8(4).toString(16), baseHeadroom: r(5), altHeadroom: r(13), min: r(21), max: r(29), gamma: r(37), baseOffset: r(45), altOffset: r(53) }; }
      if (s.marker === 0xc0) out.gainMapSize = `${(pl[3] << 8) | pl[4]}x${(pl[1] << 8) | pl[2]}, ${pl[5]} component(s)`;
    }
  }
  return out;
}
