// mp4mux.js - minimal MP4 (ISO BMFF) muxer for ONE H.264 track (WebCodecs EncodedVideoChunks + the avcC record).
// Layout: ftyp | mdat (all samples) | moov.  One chunk, constant frame duration, sync samples listed in stss.
// Drafted by the local Qwen assist lane, corrected by Claude (missing mvhd pre_defined, tkhd volume, hdlr reserved fields; stco
// offset computed up front; mdat written without spreading).  Part of the Pocket Flux engine (same licence as the engine).
'use strict';

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

/** {width, height, fps, avcC: Uint8Array, samples: [{data: Uint8Array, key: boolean}], codec ('avc1…' | 'vp09…')} -> Uint8Array (.mp4) */
export function muxMp4({ width, height, fps, avcC, samples, codec = 'avc1' }) {
  const n = samples.length, ts = Math.round(fps * 1000), movieDur = Math.round(n * 1000 / fps), mediaDur = n * 1000, vp9 = /^vp09/.test(codec);
  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str(vp9 ? 'vp09' : 'avc1'), str('mp41'));
  const dataLen = samples.reduce((s, x) => s + x.data.length, 0), firstSample = ftyp.length + 8;
  const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(2));
  const tkhd = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16));
  const mdhd = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(mediaDur), u16(0x55c4), u16(0));
  const hdlr = fullbox('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler'), [0]);
  const vmhd = fullbox('vmhd', 0, 1, zeros(8));
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  // p0pc0rn v026.9: VP9 (no H.264 encoder): 'vp09' + vpcC v1 (profile, level and bit depth from the codec string; 4:2:0, BT.709, limited range)
  const vpp = vp9 ? codec.split('.') : null;
  const avc1 = vp9 ? box('vp09', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff),
      fullbox('vpcC', 1, 0, [Number(vpp[1]) || 0], [Number(vpp[2]) || 31], [((Number(vpp[3]) || 8) << 4) | (1 << 1) | 0], [1], [1], [1], u16(0)))
    : box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff),
      box('avcC', Array.from(avcC)));
  const keys = []; samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  const stbl = box('stbl', fullbox('stsd', 0, 0, u32(1), avc1), fullbox('stts', 0, 0, u32(1), u32(n), u32(1000)),
    fullbox('stss', 0, 0, u32(keys.length), keys.map(u32)), fullbox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    fullbox('stsz', 0, 0, u32(0), u32(n), samples.map((s) => u32(s.data.length))), fullbox('stco', 0, 0, u32(1), u32(firstSample)));
  const moov = box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', vmhd, dinf, stbl))));
  const out = new Uint8Array(ftyp.length + 8 + dataLen + moov.length);
  out.set(ftyp, 0); out.set(u32(8 + dataLen), ftyp.length); out.set(str('mdat'), ftyp.length + 4);
  let o = firstSample; for (const s of samples) { out.set(s.data, o); o += s.data.length; }
  out.set(moov, o);
  return out;
}
