// H.264 encode for the lip-sync output: the SANA pipeline's encodeMp4 (pipelines/sana_video.js) copied here so this module does not pull
// the whole SANA / Klein import chain; same codec ladder, same muxer (vendor/mp4mux.js, unchanged).
'use strict';
import { muxMp4 } from '../vendor/mp4mux.js';

/** readFrame(f) -> Uint8Array RGBA (W*H*4) for f = 0..F-1  ->  {mp4 (H.264 via WebCodecs), codec} */
export async function encodeMp4(readFrame, F, H, W, fps, onFrame) {
  if (typeof VideoEncoder === 'undefined') throw Object.assign(new Error('this browser has no WebCodecs VideoEncoder'), { code: 'UNSUPPORTED' });
  const base = { width: W, height: H, bitrate: Math.round(W * H * fps * 0.6), framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
  let config = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
    try { const s = await VideoEncoder.isConfigSupported(Object.assign({ codec }, base)); if (s.supported) { config = s.config; break; } } catch (e) { /* next */ }
  }
  if (!config) {   // p0pc0rn v026.9: no H.264 encoder (some Android builds): VP9 in the same MP4
    const vb = Object.assign({}, base); delete vb.avc;
    for (const codec of ['vp09.00.31.08', 'vp09.00.40.08']) {
      try { const s = await VideoEncoder.isConfigSupported(Object.assign({ codec }, vb)); if (s.supported) { config = s.config; break; } } catch (e) { /* next */ }
    }
  }
  if (!config) throw Object.assign(new Error('neither H.264 nor VP9 encoding is supported here'), { code: 'UNSUPPORTED' });
  const samples = []; let avcC = null, err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => {
    if (meta && meta.decoderConfig && meta.decoderConfig.description) avcC = new Uint8Array(meta.decoderConfig.description.buffer || meta.decoderConfig.description);
    const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); samples.push({ data: d, key: chunk.type === 'key' }); }, error: (e) => { err = e; } });
  enc.configure(config);
  for (let f = 0; f < F; f++) {
    const vf = new VideoFrame(await readFrame(f), { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: f % Math.max(1, Math.round(2 * fps)) === 0 }); vf.close();
    while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    if (err) throw err;
    if (onFrame) onFrame(f);
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  const vp9 = /^vp09/.test(config.codec);
  if (!avcC && !vp9) throw new Error('encoder gave no avcC configuration');
  return { mp4: muxMp4({ width: W, height: H, fps, avcC, samples, codec: config.codec }), codec: config.codec };
}
