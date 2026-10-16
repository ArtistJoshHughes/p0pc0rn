// media.js - small browser helpers for the assistant: frames from a clip (for the vision review), and a picture shrunk for the
// model (the review never needs more than ~768 px; Gemma 4 re-tiles to its visual token budget anyway).
export async function clipFrames(blob, at = [0.05, 0.5, 0.95], maxSide = 640) {
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('this clip cannot be decoded here')); setTimeout(() => rej(new Error('clip load timeout')), 15000); });
    const d = v.duration || 1, out = [];
    const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    const x = c.getContext('2d');
    for (const f of at) {
      const t = Math.min(Math.max(0, d * f), Math.max(0, d - 0.04));
      await new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 3000); });
      x.drawImage(v, 0, 0, c.width, c.height);
      out.push(await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85)));
    }
    return out;
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}
export async function shrinkForModel(blob, maxSide = 768) {
  try {
    const bmp = await createImageBitmap(blob), s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (s === 1) return blob;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
  } catch (e) { return blob; }
}
