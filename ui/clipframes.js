// clipframes.js - v4: a clip's frames in order, for style video to video (engine videoToVideo's `source`). The MP4's own samples through ONE
// WebCodecs VideoDecoder (the posters' way: engine/audio/mp4av.js reads the track, clipposter_core.js codecOf its decoder config), frame i
// handed out as an ImageBitmap; the engine scales it to the clip size like a picture. The engine reads the frames in order, once for each
// tile it encodes: asking for an earlier frame starts the decode again from the first sample. Nothing is kept but the frame asked for.
import { codecOf } from './clipposter_core.js';

const bad = (m) => Object.assign(new Error(m), { code: 'BAD_VIDEO' });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** blob (MP4, H.264 / VP9) -> {frames, width, height, read(i) -> ImageBitmap, close()} */
export async function clipFrames(blob) {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') throw bad('This browser cannot read clips (no WebCodecs).');
  const { readVideoTrack } = await import('../engine/audio/mp4av.js');
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let track; try { track = readVideoTrack(u8); } catch (e) { throw bad('That clip is not an MP4 p0pc0rn can read.'); }
  const cfg = codecOf(track), S = track.samples, c0 = track.ctsStart || 0;
  if (!cfg || !S.length) throw bad('That clip is not an MP4 p0pc0rn can read.');
  const conf = Object.assign({ codec: cfg.codec, codedWidth: track.width, codedHeight: track.height }, cfg.description ? { description: cfg.description } : {});
  const sup = await VideoDecoder.isConfigSupported(conf).catch(() => null);
  if (!sup || !sup.supported) throw bad('This phone cannot decode that clip.');
  let dec = null, fed = 0, out = [], base = 0, err = null, last = null;
  const start = () => {
    if (dec) { try { dec.close(); } catch (e) { /* closed */ } }
    for (const f of out) f.close();
    out = []; base = 0; fed = 0; err = null;
    dec = new VideoDecoder({ output: (f) => out.push(f), error: (e) => { err = e; } });
    dec.configure(conf);
  };
  async function read(i) {
    if (last) { try { last.close(); } catch (e) { /* */ } last = null; }
    if (!dec || i < base) start();
    for (;;) {
      while (out.length && base < i) { out.shift().close(); base++; }
      if (out.length && base === i) break;
      if (err) throw bad('The clip could not be decoded: ' + String(err.message || err).slice(0, 80));
      if (fed < S.length) {
        const s = S[fed++];
        dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round((s.cts - c0) * 1e6 / track.timescale), data: u8.subarray(s.off, s.off + s.size) }));
        await tick();
      } else {
        await dec.flush();
        if (!(out.length && base + out.length > i)) throw bad(`The clip has ${base + out.length} frames, not ${i + 1}.`);
      }
    }
    last = await createImageBitmap(out[0]);
    return last;
  }
  return { frames: S.length, width: track.width, height: track.height, read,
    close() { if (last) { try { last.close(); } catch (e) { /* */ } } for (const f of out) f.close(); out = []; if (dec) { try { dec.close(); } catch (e) { /* */ } } dec = null; } };
}
