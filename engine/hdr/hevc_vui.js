// hevc_vui.js - p0pc0rn v4 "Make HDR": write the HLG colour description into an HEVC stream's SPS (its VUI), bit-exact.
// WebCodecs' HEVC encoder (Apple's, through Safari) writes no colour in the bitstream, only what our MP4 writer puts in the container
// (colr nclx). Some players and upload services read only the bitstream, so the SPS gets video_signal_type_present_flag = 1,
// video_format kept (5, unspecified, when there was none), video_full_range_flag 0 and colour_description_present_flag = 1 with primaries 9, transfer 18 (HLG) and
// matrix 9. Everything else in the SPS is copied bit for bit:
//  - the SPS is parsed (ITU-T H.265 7.3.2.2) only as far as vui_parameters_present_flag; with a VUI, as far as its signal-type block
//    (E.2.1: aspect ratio and overscan come first);
//  - the new SPS = the old bits up to there, the new signal-type block (or, with no VUI, a VUI that holds only it), then every old bit
//    after it up to the rbsp_stop_one_bit, a new stop bit and the alignment zeros, and emulation prevention again.
// The same rewrite is what FFmpeg's hevc_metadata bitstream filter produces with colour_primaries=9:transfer_characteristics=18:
// matrix_coefficients=9 (its desk check compares the bytes). Pure JS, no DOM.

/** NAL payload (EBSP) -> RBSP: drop each emulation-prevention 0x03 that follows 00 00 */
export function unescapeRbsp(u8) {
  const out = new Uint8Array(u8.length); let n = 0, z = 0;
  for (let i = 0; i < u8.length; i++) { const b = u8[i]; if (z >= 2 && b === 3) { z = 0; continue; } out[n++] = b; z = b === 0 ? z + 1 : 0; }
  return out.subarray(0, n);
}
/** RBSP -> NAL payload: a 0x03 before any 00..03 byte that follows 00 00 */
export function escapeRbsp(u8) {
  const out = []; let z = 0;
  for (let i = 0; i < u8.length; i++) { const b = u8[i]; if (z >= 2 && b <= 3) { out.push(3); z = 0; } out.push(b); z = b === 0 ? z + 1 : 0; }
  return Uint8Array.from(out);
}

class BitReader {
  constructor(u8) { this.u8 = u8; this.p = 0; this.n = u8.length * 8; }
  u(k) { let v = 0; for (let i = 0; i < k; i++) { if (this.p >= this.n) throw err('the SPS ran out of bits'); v = v * 2 + ((this.u8[this.p >> 3] >> (7 - (this.p & 7))) & 1); this.p++; } return v; }
  ue() { let z = 0; while (this.u(1) === 0) { if (++z > 31) throw err('a bad exp-Golomb code'); } return z ? 2 ** z - 1 + this.u(z) : 0; }
  se() { const k = this.ue(); return k & 1 ? (k + 1) / 2 : -k / 2; }
  skip(k) { if (this.p + k > this.n) throw err('the SPS ran out of bits'); this.p += k; }
}
class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.nb = 0; }
  bit(b) { this.cur = (this.cur << 1) | (b & 1); if (++this.nb === 8) { this.bytes.push(this.cur); this.cur = 0; this.nb = 0; } }
  u(v, k) { for (let i = k - 1; i >= 0; i--) this.bit(Math.floor(v / 2 ** i) & 1); }
  copy(u8, from, to) { for (let p = from; p < to; p++) this.bit((u8[p >> 3] >> (7 - (p & 7))) & 1); }
  trailing() { this.bit(1); while (this.nb) this.bit(0); return Uint8Array.from(this.bytes); }
}
const err = (m) => Object.assign(new Error(m), { code: 'BAD_SPS' });
const bitAt = (u8, p) => (u8[p >> 3] >> (7 - (p & 7))) & 1;
/** the position of the rbsp_stop_one_bit: the last 1 bit of the RBSP */
function stopBit(rb) {
  for (let i = rb.length - 1; i >= 0; i--) if (rb[i]) { for (let b = 0; b < 8; b++) if ((rb[i] >> b) & 1) return i * 8 + 7 - b; }
  throw err('no rbsp_stop_one_bit');
}

function profileTierLevel(r, maxSub, out) {
  out.profileSpace = r.u(2); out.tier = r.u(1); out.profileIdc = r.u(5); r.skip(32 + 4 + 43 + 1); out.levelIdc = r.u(8);
  const sp = [], sl = [];
  for (let i = 0; i < maxSub; i++) { sp.push(r.u(1)); sl.push(r.u(1)); }
  if (maxSub > 0) for (let i = maxSub; i < 8; i++) r.u(2);
  for (let i = 0; i < maxSub; i++) { if (sp[i]) r.skip(88); if (sl[i]) r.skip(8); }
}
function scalingListData(r) {
  for (let sizeId = 0; sizeId < 4; sizeId++) for (let m = 0; m < 6; m += sizeId === 3 ? 3 : 1) {
    if (!r.u(1)) r.ue();
    else { const coefNum = Math.min(64, 1 << (4 + (sizeId << 1))); if (sizeId > 1) r.se(); for (let i = 0; i < coefNum; i++) r.se(); }
  }
}
function stRefPicSet(r, idx, num, numDelta) {
  const inter = idx !== 0 ? r.u(1) : 0;
  if (inter) {
    const deltaIdx = idx === num ? r.ue() + 1 : 1;
    r.u(1); r.ue();   // delta_rps_sign, abs_delta_rps_minus1
    const ref = idx - deltaIdx; let cnt = 0;
    if (ref < 0 || numDelta[ref] == null) throw err('a bad short-term reference picture set');
    for (let j = 0; j <= numDelta[ref]; j++) { const used = r.u(1); const useDelta = used ? 1 : r.u(1); if (useDelta) cnt++; }
    numDelta[idx] = cnt;
  } else {
    const neg = r.ue(), pos = r.ue();
    if (neg > 16 || pos > 16) throw err('a bad short-term reference picture set');
    for (let i = 0; i < neg + pos; i++) { r.ue(); r.u(1); }
    numDelta[idx] = neg + pos;
  }
}

/**
 * Parse an HEVC SPS NAL (with its 2-byte NAL header). -> {
 *   width, height, chromaFormat, bitDepthLuma, bitDepthChroma, profileIdc, levelIdc, maxSubLayers,
 *   vuiFlagAt (bit position of vui_parameters_present_flag in the RBSP), vuiPresent,
 *   vui: null | {sigAt (position of video_signal_type_present_flag), sigEnd (after its block), videoSignalTypePresent, videoFormat,
 *                fullRange, colourDescriptionPresent, primaries, transfer, matrix},
 *   stopAt (position of the rbsp_stop_one_bit), rbsp }
 */
export function parseSps(nal) {
  if (!nal || nal.length < 4 || ((nal[0] >> 1) & 0x3f) !== 33) throw err('not an SPS NAL unit');
  const rb = unescapeRbsp(nal.subarray(2)), r = new BitReader(rb), o = { rbsp: rb };
  r.u(4); const maxSub = r.u(3); r.u(1); o.maxSubLayers = maxSub + 1;
  profileTierLevel(r, maxSub, o);
  r.ue(); o.chromaFormat = r.ue(); if (o.chromaFormat === 3) r.u(1);
  o.width = r.ue(); o.height = r.ue();
  if (r.u(1)) o.conformance = [r.ue(), r.ue(), r.ue(), r.ue()];
  o.bitDepthLuma = r.ue() + 8; o.bitDepthChroma = r.ue() + 8;
  const log2PocLsb = r.ue() + 4;
  const ordering = r.u(1); for (let i = ordering ? 0 : maxSub; i <= maxSub; i++) { r.ue(); r.ue(); r.ue(); }
  for (let i = 0; i < 6; i++) r.ue();   // coding / transform block sizes, transform hierarchy depths
  if (r.u(1) && r.u(1)) scalingListData(r);   // scaling_list_enabled_flag, sps_scaling_list_data_present_flag
  r.u(1); r.u(1);   // amp, sample adaptive offset
  if (r.u(1)) { r.u(4); r.u(4); r.ue(); r.ue(); r.u(1); }   // pcm
  const nst = r.ue(), numDelta = [];
  if (nst > 64) throw err('too many short-term reference picture sets');
  for (let i = 0; i < nst; i++) stRefPicSet(r, i, nst, numDelta);
  if (r.u(1)) { const nlt = r.ue(); if (nlt > 32) throw err('too many long-term reference pictures'); for (let i = 0; i < nlt; i++) { r.u(log2PocLsb); r.u(1); } }
  r.u(1); r.u(1);   // sps_temporal_mvp_enabled_flag, strong_intra_smoothing_enabled_flag
  o.vuiFlagAt = r.p; o.vuiPresent = !!r.u(1); o.vui = null;
  if (o.vuiPresent) {
    const v = {};
    if (r.u(1)) { const idc = r.u(8); if (idc === 255) { r.u(16); r.u(16); } }   // aspect ratio
    if (r.u(1)) r.u(1);   // overscan
    v.sigAt = r.p; v.videoSignalTypePresent = !!r.u(1);
    v.videoFormat = 5; v.fullRange = false; v.colourDescriptionPresent = false; v.primaries = 2; v.transfer = 2; v.matrix = 2;
    if (v.videoSignalTypePresent) {
      v.videoFormat = r.u(3); v.fullRange = !!r.u(1); v.colourDescriptionPresent = !!r.u(1);
      if (v.colourDescriptionPresent) { v.primaries = r.u(8); v.transfer = r.u(8); v.matrix = r.u(8); }
    }
    v.sigEnd = r.p;
    o.vui = v;
  }
  o.stopAt = stopBit(rb);
  if (o.stopAt < r.p) throw err('the SPS ends inside its VUI');
  return o;
}

/** the new signal-type block: present, video_format, video_full_range_flag, colour description (primaries, transfer, matrix) */
function writeSignal(w, c) { w.bit(1); w.u(c.videoFormat == null ? 5 : c.videoFormat, 3); w.bit(c.fullRange ? 1 : 0); w.bit(1); w.u(c.primaries, 8); w.u(c.transfer, 8); w.u(c.matrix, 8); }

/**
 * SPS NAL -> the same SPS with the colour description c = {primaries, transfer, matrix, fullRange, videoFormat?} in its VUI.
 * An SPS that already says exactly that is returned unchanged (the same object). Throws code BAD_SPS on anything it cannot parse.
 */
export function rewriteSpsColour(nal, c) {
  const s = parseSps(nal), rb = s.rbsp, w = new BitWriter();
  const v = s.vui, vf = c.videoFormat != null ? c.videoFormat : v && v.videoSignalTypePresent ? v.videoFormat : 5;   // video_format kept (as hevc_metadata does)
  if (v && v.videoSignalTypePresent && v.colourDescriptionPresent && v.primaries === c.primaries && v.transfer === c.transfer && v.matrix === c.matrix && v.fullRange === !!c.fullRange && v.videoFormat === vf) return nal;
  const cc = Object.assign({}, c, { videoFormat: vf });
  if (v) {   // keep the VUI; replace only its signal-type block
    w.copy(rb, 0, v.sigAt); writeSignal(w, cc); w.copy(rb, v.sigEnd, s.stopAt);
  } else {   // a VUI with only the signal-type block: no aspect ratio, overscan, chroma location, field, window, timing or restrictions
    w.copy(rb, 0, s.vuiFlagAt); w.bit(1);
    w.bit(0); w.bit(0); writeSignal(w, cc);
    w.bit(0); w.bit(0); w.bit(0); w.bit(0); w.bit(0); w.bit(0); w.bit(0);   // chroma_loc, neutral_chroma, field_seq, frame_field_info, default_display_window, timing, bitstream_restriction
    w.copy(rb, s.vuiFlagAt + 1, s.stopAt);
  }
  const body = escapeRbsp(w.trailing()), out = new Uint8Array(2 + body.length);
  out[0] = nal[0]; out[1] = nal[1]; out.set(body, 2);
  return out;
}

// ------------------------------------------------------------------ where SPS NAL units live: hvcC, and in-band in samples
/** hvcC record -> {arrays: [{type, complete, nals}], head (the 22 bytes before numOfArrays), lengthSize} */
export function parseHvcC(d) {
  if (!d || d.length < 23 || d[0] !== 1) throw Object.assign(new Error('not an hvcC record'), { code: 'BAD_HVCC' });
  const out = { head: d.subarray(0, 22), lengthSize: (d[21] & 3) + 1, arrays: [] };
  let o = 23;
  for (let a = 0; a < d[22]; a++) {
    if (o + 3 > d.length) throw Object.assign(new Error('a short hvcC'), { code: 'BAD_HVCC' });
    const type = d[o] & 63, flags = d[o] & 0xc0, cnt = (d[o + 1] << 8) | d[o + 2]; o += 3; const nals = [];
    for (let k = 0; k < cnt; k++) { const len = (d[o] << 8) | d[o + 1]; o += 2; if (o + len > d.length) throw Object.assign(new Error('a short hvcC'), { code: 'BAD_HVCC' }); nals.push(d.subarray(o, o + len)); o += len; }
    out.arrays.push({ type, flags, nals });
  }
  return out;
}
export function writeHvcC(h) {
  const parts = [h.head, Uint8Array.of(h.arrays.length)];
  for (const a of h.arrays) {
    parts.push(Uint8Array.of(a.flags | a.type, a.nals.length >> 8, a.nals.length & 255));
    for (const n of a.nals) parts.push(Uint8Array.of(n.length >> 8, n.length & 255), n);
  }
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}
/** hvcC -> hvcC with every SPS rewritten (c as rewriteSpsColour) */
export function rewriteHvcC(d, c) {
  const h = parseHvcC(d);
  for (const a of h.arrays) if (a.type === 33) a.nals = a.nals.map((n) => rewriteSpsColour(n, c));
  return writeHvcC(h);
}
export const nalType = (nal) => (nal[0] >> 1) & 0x3f;
/** a length-prefixed sample (lengthSize bytes per NAL length) -> the same sample with any in-band SPS rewritten; the same object when none */
export function rewriteSample(u8, c, lengthSize = 4) {
  const nals = []; let o = 0, any = false;
  while (o + lengthSize <= u8.length) {
    let n = 0; for (let i = 0; i < lengthSize; i++) n = n * 256 + u8[o + i];
    o += lengthSize; if (o + n > u8.length) throw Object.assign(new Error('a short NAL unit in a sample'), { code: 'BAD_SAMPLE' });
    let nal = u8.subarray(o, o + n); o += n;
    if (nalType(nal) === 33) { const r = rewriteSpsColour(nal, c); if (r !== nal) { nal = r; any = true; } }
    nals.push(nal);
  }
  if (!any) return u8;
  let len = 0; for (const x of nals) len += lengthSize + x.length;
  const out = new Uint8Array(len); let k = 0;
  for (const x of nals) { let n = x.length; for (let i = lengthSize - 1; i >= 0; i--) { out[k + i] = n & 255; n = Math.floor(n / 256); } out.set(x, k + lengthSize); k += lengthSize + x.length; }
  return out;
}
/** VUI colour of an SPS (null = no VUI or no colour description) - the report's read-back */
export function spsColour(nal) {
  const s = parseSps(nal), v = s.vui;
  return v && v.colourDescriptionPresent ? { primaries: v.primaries, transfer: v.transfer, matrix: v.matrix, fullRange: v.fullRange, videoFormat: v.videoFormat } : null;
}
export { bitAt };
