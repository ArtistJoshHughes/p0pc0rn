// Pocket STT front end: 16 kHz samples -> the model's log-mel frames, streaming, frame for frame what the reference computes over a
// whole recording (Hugging Face NemotronAsrStreamingFeatureExtractor, center=True): pre-emphasis 0.97 (the first sample kept),
// frames every 160 samples centred on the sample (zero before the start), a symmetric 400-point Hann window inside a 512-point
// FFT, the power spectrum, the 128-band Slaney mel bank from the pack, log(m + 2^-24).  Float64 inside (like engine/voice/spk.js).
// Frame f covers samples [160 f - 200, 160 f + 200): it is ready once sample 160 f + 199 has arrived.
'use strict';

const N = 512, HOP = 160, WIN = 400, NB = 257, MELS = 128, GUARD = Math.pow(2, -24);

export class MelStream {
  /** fb: Float32Array [128][257] (the pack's stt.front/mel_fb) */
  constructor(fb) {
    this.fb = fb;
    this.win = new Float64Array(N);
    for (let i = 0; i < WIN; i++) this.win[(N - WIN) / 2 + i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1));
    this.rev = new Uint32Array(N);
    for (let i = 0, j = 0; i < N; i++) { this.rev[i] = j; let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; }
    this.cs = new Float64Array(N / 2); this.sn = new Float64Array(N / 2);
    for (let k = 0; k < N / 2; k++) { this.cs[k] = Math.cos(-2 * Math.PI * k / N); this.sn[k] = Math.sin(-2 * Math.PI * k / N); }
    this.re = new Float64Array(N); this.im = new Float64Array(N); this.pw = new Float64Array(NB);
    // fb rows trimmed to their non-zero bins (the bank is sparse: two bins wide at the bottom, ~40 at the top)
    this.lo = new Int32Array(MELS); this.hi = new Int32Array(MELS);
    for (let m = 0; m < MELS; m++) {
      let a = 0, b = NB - 1; while (a < NB && fb[m * NB + a] === 0) a++; while (b > a && fb[m * NB + b] === 0) b--;
      this.lo[m] = a; this.hi[m] = b;
    }
    this.reset();
  }
  reset() {
    this.buf = new Float64Array(16000); this.b0 = 0; this.n = 0;   // pre-emphasised samples [b0, n) live in buf[0 .. n - b0)
    this.prev = null; this.next = 0;                                // next frame to compute
  }
  /** samples Float32Array (16 kHz) -> Float32Array of the new frames [k][128] (k may be 0) */
  push(x) {
    const need = this.n + x.length - this.b0;
    if (need > this.buf.length) { const nb = new Float64Array(Math.max(need, this.buf.length * 2)); nb.set(this.buf.subarray(0, this.n - this.b0)); this.buf = nb; }
    let o = this.n - this.b0, p = this.prev;
    for (let i = 0; i < x.length; i++) { const v = x[i]; this.buf[o++] = p === null ? v : v - 0.97 * p; p = v; }
    this.prev = p; this.n += x.length;
    let k = 0; while ((this.next + k) * HOP + 200 <= this.n) k++;
    const out = new Float32Array(k * MELS);
    for (let j = 0; j < k; j++) this._frame(this.next + j, out, j * MELS);
    this.next += k;
    // keep only what the next frame reads (from 160 next - 200)
    const keep = Math.max(0, this.next * HOP - 256);
    if (keep - this.b0 > 8192) { const d = keep - this.b0; this.buf.copyWithin(0, d, this.n - this.b0); this.b0 = keep; }
    return out;
  }
  _frame(f, out, o) {
    const re = this.re, im = this.im, w = this.win, rev = this.rev, s0 = f * HOP - N / 2;
    for (let i = 0; i < N; i++) {
      const s = s0 + i, v = w[i] === 0 || s < 0 || s >= this.n ? 0 : this.buf[s - this.b0] * w[i];
      re[rev[i]] = v; im[rev[i]] = 0;
    }
    for (let len = 2; len <= N; len <<= 1) {
      const step = N / len, h = len >> 1;
      for (let i = 0; i < N; i += len) for (let j = 0; j < h; j++) {
        const wr = this.cs[j * step], wi = this.sn[j * step], a = i + j, b = a + h;
        const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
      }
    }
    const pw = this.pw; for (let k = 0; k < NB; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    const fb = this.fb;
    for (let m = 0; m < MELS; m++) {
      let s = 0; const r = m * NB; for (let k = this.lo[m]; k <= this.hi[m]; k++) s += fb[r + k] * pw[k];
      out[o + m] = Math.log(s + GUARD);
    }
  }
}

/** a whole recording at once (tests): Float32Array 16 kHz -> Float32Array [floor(len / 160)][128] */
export function logMel(x, fb) {
  const m = new MelStream(fb), a = m.push(x), nf = Math.floor(x.length / HOP);
  if (a.length >= nf * MELS) return a.subarray(0, nf * MELS);
  const out = new Float32Array(nf * MELS); out.set(a);
  for (let f = m.next; f < nf; f++) m._frame(f, out, f * MELS);   // the last frames read zeros past the end (center padding)
  return out;
}
