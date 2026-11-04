// hdr.js - p0pc0rn v4 "Make HDR": a Library clip or picture -> a NEW HDR copy (the original is never touched).
//  Clip:    WebCodecs decode (H.264 from the video engine) -> the look on the GPU (hdr_gpu.js) -> still blue-noise dither -> 8-bit I420 HLG
//           VideoFrames -> HEVC through WebCodecs (Apple's OS encoder on an iPhone; p0pc0rn ships no encoder; VP9 / AV1 where a browser has
//           no HEVC encoder) -> the HLG colour written into the SPS's VUI (hevc_vui.js; checked by decoding the first frames back, else the
//           stream stays as the encoder wrote it) -> our MP4 (mp4hdr.js, colr nclx 9 / 18 / 9) with the clip's own sound copied over.
//  Picture: the picture as an SDR JPEG + a gain map (gainmap.js; Ultra HDR XMP + ISO 21496-1 by default).
// Josh's iPhone (HDR probe v002, Oct 30): 0.12 s for an 81-frame clip, 31-51 ms for a picture.

import { lookOf, blueNoise, HLG_CICP, HLG_COLOR_SPACE, hdrBitrate, hevcLevel } from './hdr_core.js';
import { hdrDevice, FramePass } from './hdr_gpu.js';
import { demux, mux, isAnnexB, splitAnnexB, lengthPrefixed, findAv1SeqHeader, buildAv1C, buildVpcC } from './mp4hdr.js';
import { parseSps, rewriteHvcC, rewriteSample, parseHvcC, spsColour, nalType } from './hevc_vui.js';
import { computeGainMap, encodeGrayJpeg, buildGainMapJpeg, inspectGainMapJpeg, DEFAULT_ROUTE } from './gainmap.js';

export const HDR_VERSION = 'hdr-1.0';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortErr = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
const fail = (code, m) => Object.assign(new Error(m), { code });
const r3 = (x) => Math.round(x * 1000) / 1000;

/** the encoders to try for a size, in order: HEVC Main (8-bit frames go in), HEVC Main 10 (an iPhone writes 8-bit Main for it), then
 *  VP9 profile 0 and AV1 main 8-bit for browsers without an HEVC encoder */
export function candidates(w, h) {
  const L = hevcLevel(w, h), vp = w * h <= 983040 ? 31 : w * h <= 2228224 ? 40 : 50, av = w * h <= 1065024 ? '05' : w * h <= 2359296 ? '08' : '12';
  return [{ codec: `hvc1.1.6.L${L}.B0`, kind: 'hevc' }, { codec: `hvc1.2.4.L${L}.B0`, kind: 'hevc' }, { codec: `vp09.00.${vp}.08`, kind: 'vp9' }, { codec: `av01.0.${av}M.08`, kind: 'av1' }];
}
function encoderConfig(c, w, h, fps, bitrate) {
  const cfg = { codec: c.codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality' };
  if (c.kind === 'hevc') cfg.hevc = { format: 'hevc' };
  return cfg;
}
/** the first encoder this browser says yes to -> {codec, kind, config} | null (only='hevc' | 'vp9' | 'av1' narrows it, for tests) */
export async function pickEncoder(w, h, fps, { only = null, bitrate = null } = {}) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const c of candidates(w, h)) {
    if (only && c.kind !== only) continue;
    const config = encoderConfig(c, w, h, fps, bitrate || hdrBitrate(w, h, fps));
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return Object.assign({}, c, { config }); } catch (e) { /* the next one */ }
  }
  return null;
}
/** can this phone make HDR copies here: WebGPU, a video encoder, the screen */
export async function hdrCaps(w = 832, h = 480) {
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const enc = await pickEncoder(w, h, 16).catch(() => null);
  return { webgpu: typeof navigator !== 'undefined' && !!navigator.gpu, encoder: enc ? enc.codec : null, screenHdr: mq('(dynamic-range: high)'), videoHdr: mq('(video-dynamic-range: high)') };
}

// ------------------------------------------------------------------ HEVC helpers
function hevcCodecString(h) {   // ISO/IEC 14496-15 annex E from an hvcC's head
  const d = h.head, space = ['', 'A', 'B', 'C'][d[1] >> 6], tier = (d[1] >> 5) & 1, idc = d[1] & 31;
  let c = ((d[2] << 24) | (d[3] << 16) | (d[4] << 8) | d[5]) >>> 0, rev = 0; for (let i = 0; i < 32; i++) { rev = ((rev << 1) | (c & 1)) >>> 0; c >>>= 1; }
  const cons = Array.from(d.subarray(6, 12)); while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return `hvc1.${space}${idc}.${rev.toString(16).toUpperCase()}.${tier ? 'H' : 'L'}${d[12]}` + (cons.length ? '.' + cons.map((b) => b.toString(16).toUpperCase()).join('.') : '');
}
/** VPS / SPS / PPS (no start codes) -> hvcC (for an encoder that only gives Annex B) */
function buildHvcC(vps, sps, pps) {
  const s = parseSps(sps[0]), ptl = s.rbsp.slice(1, 13);
  const u16 = (v) => [(v >> 8) & 255, v & 255];
  const head = [1, ...ptl, 0xf0, 0x00, 0xfc, 0xfc | (s.chromaFormat & 3), 0xf8 | ((s.bitDepthLuma - 8) & 7), 0xf8 | ((s.bitDepthChroma - 8) & 7), 0, 0, ((s.maxSubLayers & 7) << 3) | (1 << 2) | 3];
  const arr = (type, list) => [0x80 | type, ...u16(list.length), ...list.flatMap((n) => [...u16(n.length), ...n])];
  const arrays = [[32, vps], [33, sps], [34, pps]].filter(([, l]) => l.length);
  return new Uint8Array([...head, arrays.length, ...arrays.flatMap(([t, l]) => arr(t, l))]);
}
/** decode the first `n` chunks with this setup: true = they came out as frames, false = the decoder refused or failed, null = no decoder */
async function decodesBack(codec, description, chunks, n = 2, ms = 4000) {
  if (typeof VideoDecoder === 'undefined') return null;
  const cfg = { codec, description };
  try { if (!(await VideoDecoder.isConfigSupported(cfg)).supported) return null; } catch (e) { return null; }
  let got = 0, bad = false;
  const dec = new VideoDecoder({ output: (f) => { got++; f.close(); }, error: () => { bad = true; } });
  try {
    dec.configure(cfg);
    for (const c of chunks.slice(0, n)) dec.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: c.ts, data: c.data }));
    await Promise.race([dec.flush(), sleep(ms).then(() => { throw new Error('timeout'); })]);
  } catch (e) { bad = true; }
  try { dec.close(); } catch (e) { /* closed */ }
  return !bad && got >= Math.min(n, chunks.length);
}

// ------------------------------------------------------------------ decoding the source clip
/** feed the clip's frames, in presentation order, to onFrame(frame, i) (awaited; the frame is closed after). WebCodecs, else <video>. */
async function eachFrame(v, onFrame, signal) {
  const n = v.samples.length, us = (t) => Math.round((t * 1e6) / v.timescale);
  const cfg = { codec: v.codec, codedWidth: v.width, codedHeight: v.height };
  if (v.description && v.configBox !== 'vpcC') cfg.description = v.description;
  let ok = false;
  if (typeof VideoDecoder !== 'undefined') { try { ok = !!(await VideoDecoder.isConfigSupported(cfg)).supported; } catch (e) { ok = false; } }
  if (!ok) return eachFrameByTag(v, onFrame, signal);
  const order = v.samples.map((s, i) => ({ pts: s.pts, i })).sort((a, b) => a.pts - b.pts), rank = new Map(order.map((o, k) => [us(o.pts), k]));
  const queue = []; let err = null, wake = null, done = 0;
  const dec = new VideoDecoder({ output: (f) => { queue.push(f); if (wake) { wake(); wake = null; } }, error: (e) => { err = err || e; if (wake) { wake(); wake = null; } } });
  dec.configure(cfg);
  let fed = 0;
  const feed = () => {   // at most a few frames ahead: decoded frames hold the decoder's memory until they are closed
    while (fed < n && dec.decodeQueueSize < 3 && queue.length < 3) {
      const s = v.samples[fed++];
      dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: us(s.pts), duration: us(s.dur), data: s.data }));
    }
    if (fed === n && !feed.flushed) { feed.flushed = true; dec.flush().then(() => { feed.all = true; if (wake) { wake(); wake = null; } }, (e) => { err = err || e; if (wake) { wake(); wake = null; } }); }
  };
  try {
    while (done < n) {
      if (signal && signal.aborted) throw abortErr();
      if (err) throw fail('DECODE', 'the clip could not be read: ' + (err.message || err));
      feed();
      if (!queue.length) { if (feed.all) break; await new Promise((r) => { wake = r; setTimeout(r, 50); }); continue; }
      const f = queue.shift();
      try { await onFrame(f, rank.has(f.timestamp) ? rank.get(f.timestamp) : done); } finally { f.close(); }
      done++;
    }
  } finally { for (const f of queue) { try { f.close(); } catch (e) { /* */ } } try { dec.close(); } catch (e) { /* closed */ } }
  if (done < n) throw fail('DECODE', `only ${done} of ${n} frames could be read`);
  return { path: 'VideoDecoder', frames: done };
}
async function eachFrameByTag(v, onFrame, signal) {
  if (typeof document === 'undefined') throw fail('UNSUPPORTED', 'this browser cannot read the clip');
  const el = document.createElement('video'), url = URL.createObjectURL(v.blob);
  el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
  const wait = (ev, ms) => new Promise((res, rej) => { const t = setTimeout(() => { off(); rej(fail('DECODE', ev + ' timed out')); }, ms); const ok = () => { off(); res(); }, bad = () => { off(); rej(fail('DECODE', 'the clip could not be read')); }; const off = () => { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }; el.addEventListener(ev, ok); el.addEventListener('error', bad); });
  try {
    if (el.readyState < 2) await wait('loadeddata', 15000);
    const order = v.samples.map((s) => s.pts).sort((a, b) => a - b);
    for (let k = 0; k < order.length; k++) {
      if (signal && signal.aborted) throw abortErr();
      el.currentTime = (order[k] + (v.samples[0].dur || 1) / 2) / v.timescale; await wait('seeked', 5000);
      await onFrame(el, k);
    }
    return { path: 'video element', frames: order.length };
  } finally { el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); }
}

// ------------------------------------------------------------------ a clip
/**
 * blob (a Library clip, MP4) -> { blob (video/mp4, HLG), width, height, frames, fps, codec, kind, vui: {asked, written, read, why}, sound,
 *   timings: {total, decodeAndConvert, encode, mux}, bytes }
 * opts: look ('vivid' | 'bright'), onProgress({phase: 'hdr', frac, message}), signal, vui (true: write the HLG colour into the SPS),
 *       only (an encoder kind, tests), dither (true)
 */
export async function makeHdrVideo(blob, { look = 'vivid', onProgress = null, signal = null, vui = true, only = null, dither = true } = {}) {
  const T0 = now(), L = lookOf(look), say = (frac, message) => { if (onProgress) onProgress({ phase: 'hdr', frac, message }); };
  say(0, 'Reading the clip');
  const src = demux(new Uint8Array(await blob.arrayBuffer())), v = src.video; v.blob = blob;
  const W = v.width & ~1, H = v.height & ~1, n = v.samples.length;
  if (W < 16 || H < 16) throw fail('BAD_SIZE', 'the clip is too small');
  const durs = v.samples.map((s) => s.dur), fps = v.timescale / (durs.slice().sort((a, b) => a - b)[Math.floor(n / 2)] || v.timescale / 16);
  const enc = await pickEncoder(W, H, Math.round(fps), { only });
  if (!enc) throw fail('UNSUPPORTED', 'this browser cannot write an HDR video');
  const device = await hdrDevice();
  const pass = await new FramePass(device, { w: W, h: H, bn: blueNoise() }).init();
  pass.setLook(L, { dither });
  const chunks = []; let meta = null, encErr = null;
  const encoder = new VideoEncoder({
    output: (chunk, md) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push({ data, key: chunk.type === 'key', ts: chunk.timestamp });
      if (md && md.decoderConfig && !meta) {
        const dc = md.decoderConfig; let desc = null;
        if (dc.description) desc = dc.description instanceof ArrayBuffer ? new Uint8Array(dc.description.slice(0)) : new Uint8Array(dc.description.buffer.slice(dc.description.byteOffset, dc.description.byteOffset + dc.description.byteLength));
        meta = { codec: dc.codec, description: desc };
      }
    },
    error: (e) => { encErr = encErr || e; } });
  encoder.configure(enc.config);
  const t1 = now(), ptsSorted = v.samples.map((s) => s.pts).sort((a, b) => a - b); let path = null;
  try {
    const r = await eachFrame(v, async (frame, i) => {
      if (encErr) throw encErr;
      await pass.upload(frame);
      const planes = await pass.run();
      const ts = typeof frame.close === 'function' && frame.timestamp != null ? frame.timestamp : Math.round((ptsSorted[i] * 1e6) / v.timescale);
      const vf = new VideoFrame(planes, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: ts, duration: Math.round((durs[Math.min(i, n - 1)] * 1e6) / v.timescale), colorSpace: HLG_COLOR_SPACE });
      while (encoder.encodeQueueSize > 4 && !encErr) await sleep(1);
      encoder.encode(vf, { keyFrame: i % 48 === 0 }); vf.close();
      if (i % 8 === 0) say(0.05 + 0.85 * (i / n), `Frame ${i + 1} of ${n}`);
    }, signal);
    path = r.path;
    if (!encErr) await encoder.flush();
  } catch (e) { if (!encErr) encErr = e; }
  finally { try { encoder.close(); } catch (e) { /* closed */ } pass.destroy(); }
  if (encErr) throw encErr && encErr.name === 'AbortError' ? encErr : (encErr.code ? encErr : fail('ENCODE', 'the HDR video could not be written: ' + (encErr.message || encErr)));
  if (chunks.length !== n) throw fail('ENCODE', `the encoder gave ${chunks.length} of ${n} frames`);
  const t2 = now(); say(0.92, 'Saving the HDR copy');
  // the codec setup record: the encoder's own, or built from the parameter sets an Annex-B stream carries in band
  let description = meta && meta.description, codec = (meta && meta.codec) || enc.codec;
  const V = { asked: !!vui && enc.kind === 'hevc', written: false, read: null, why: null };
  if (enc.kind === 'hevc') {
    if (isAnnexB(chunks[0].data)) {
      const ps = { 32: [], 33: [], 34: [] };
      for (const c of chunks) { const keep = []; for (const nal of splitAnnexB(c.data)) { const t = nalType(nal); if (ps[t]) { if (!ps[t].length) ps[t].push(nal); } else keep.push(nal); } c.data = lengthPrefixed(keep); }
      description = buildHvcC(ps[32], ps[33], ps[34]);
    }
    if (!description) throw fail('ENCODE', 'the encoder gave no HEVC setup');
    codec = hevcCodecString(parseHvcC(description));
    if (V.asked) {
      try {
        const ls = parseHvcC(description).lengthSize, d2 = rewriteHvcC(description, HLG_CICP), c2 = chunks.map((c) => ({ data: rewriteSample(c.data, HLG_CICP, ls), key: c.key, ts: c.ts }));
        const sps = parseHvcC(d2).arrays.find((a) => a.type === 33);
        V.read = sps ? spsColour(sps.nals[0]) : null;
        const back = await decodesBack(codec, d2, c2);   // never ship a stream the phone's own decoder refuses
        if (back === false) V.why = 'the decoder refused the rewritten stream: kept the encoder\'s';
        else { description = d2; for (let i = 0; i < n; i++) chunks[i].data = c2[i].data; V.written = true; V.decodeCheck = back == null ? 'no decoder here' : 'decoded'; }
      } catch (e) { V.why = (e && e.message) || String(e); }
    }
  } else if (enc.kind === 'vp9') description = buildVpcC(enc.codec, HLG_CICP);
  else if (enc.kind === 'av1') { if (!description || description[0] !== 0x81) description = buildAv1C(enc.codec, findAv1SeqHeader(chunks.find((c) => c.key).data)); }
  const bytes = mux({ kind: enc.kind, width: W, height: H, timescale: v.timescale, durations: durs, description, chunks, color: HLG_CICP, audio: src.audio, movieTimescale: src.movieTimescale });
  const t3 = now();
  say(1, 'Done');
  return { blob: new Blob([bytes], { type: 'video/mp4' }), width: W, height: H, frames: n, fps: r3(fps), codec, kind: enc.kind, vui: V, sound: !!src.audio, decodePath: path,
    uploadPath: pass.uploadPath, look: L.id, curve: L.curve, bytes: bytes.length, version: HDR_VERSION,
    timings: { total: r3((t3 - T0) / 1000), decodeAndConvert: r3((t2 - t1) / 1000), mux: r3((t3 - t2) / 1000) } };
}

// ------------------------------------------------------------------ a picture
const toBlob = (c, type, q) => (c.convertToBlob ? c.convertToBlob({ type, quality: q }) : new Promise((res, rej) => { try { c.toBlob((b) => (b ? res(b) : rej(fail('ENCODE', 'the canvas gave no file'))), type, q); } catch (e) { rej(e); } }));
/**
 * blob (a Library picture) -> { blob (image/jpeg with a gain map), width, height, route, gainMap: {size, minLog2, maxLog2, meanLog2,
 *   capacityLog2}, check (inspectGainMapJpeg), decodes, timings }
 * opts: look, route ('both' | 'xmp' | 'iso'), quality (the base JPEG, 0..1), signal
 */
export async function makeHdrPicture(blob, { look = 'vivid', route = DEFAULT_ROUTE, quality = 0.95, signal = null } = {}) {
  const T0 = now(), L = lookOf(look);
  const bmp = await createImageBitmap(blob), W = bmp.width, H = bmp.height;
  try {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    if (signal && signal.aborted) throw abortErr();
    const baseBlob = await toBlob(cv, 'image/jpeg', quality);
    if (!baseBlob || baseBlob.type !== 'image/jpeg') throw fail('UNSUPPORTED', 'this browser cannot write a JPEG');
    const base = new Uint8Array(await baseBlob.arrayBuffer());
    const gm = computeGainMap(ctx.getImageData(0, 0, W, H).data, W, H, { scale: 2, look: L });
    const gj = encodeGrayJpeg(gm.map, gm.gw, gm.gh, 95), built = buildGainMapJpeg(base, gj, gm, route);
    const check = inspectGainMapJpeg(built.bytes);
    if (!(check.mpf && check.mpf.entries[1] && check.mpf.entries[1].startsWithSOI)) throw fail('ENCODE', 'the HDR picture did not come out right');
    const out = new Blob([built.bytes], { type: 'image/jpeg' });
    let decodes = null; try { const b2 = await createImageBitmap(out); decodes = `${b2.width}x${b2.height}`; b2.close(); } catch (e) { decodes = 'no: ' + ((e && e.message) || e); }
    return { blob: out, width: W, height: H, route, look: L.id, curve: L.curve, version: HDR_VERSION, check, decodes, bytes: built.bytes.length,
      gainMap: { size: `${gm.gw}x${gm.gh}`, minLog2: r3(gm.min), maxLog2: r3(gm.max), meanLog2: r3(gm.meanLog2), capacityLog2: r3(gm.capacityMax) },
      timings: { total: r3((now() - T0) / 1000), gainMap: r3(gm.ms / 1000) } };
  } finally { bmp.close(); }
}
