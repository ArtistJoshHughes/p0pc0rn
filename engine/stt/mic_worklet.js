// mic_worklet.js - Pocket STT: the AudioWorklet that turns the microphone (the context's own rate, 44.1 or 48 kHz) into 16 kHz mono for
// the recogniser. A windowed-sinc low-pass resampler (Kaiser beta 8, 16 zero crossings at 0.94 of the 8 kHz Nyquist), its kernel
// tabulated once; 20 ms blocks (320 samples) are posted to the page, transferred, never kept. Nothing is stored here.
class Mic16k extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const inRate = (o && o.processorOptions && o.processorOptions.inRate) || sampleRate;
    this.step = inRate / 16000;                                   // input samples per output sample
    const cut = Math.min(1, 16000 / inRate) * 0.94, Z = 16, beta = 8;
    this.cut = cut; this.half = Math.ceil(Z / cut); this.R = 256;
    const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-12 * s) break; } return s; }, ib = i0(beta);
    this.tab = new Float32Array((this.half + 1) * this.R + 2);
    for (let i = 0; i < this.tab.length; i++) {
      const t = i / this.R, d = t * cut, r = t / (this.half + 1);
      this.tab[i] = r >= 1 ? 0 : (d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)) * (i0(beta * Math.sqrt(1 - r * r)) / ib) * cut;
    }
    this.buf = new Float32Array(8192); this.n = 0;                 // input history (absolute index of buf[0] = this.b0)
    this.b0 = 0; this.t = this.half;                               // next output's centre, in absolute input samples
    this.out = new Float32Array(320); this.on = 0; this.live = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.live = false; };
  }
  k(x) { const a = Math.abs(x) * this.R, i = a | 0, f = a - i; return i + 1 < this.tab.length ? this.tab[i] + (this.tab[i + 1] - this.tab[i]) * f : 0; }
  process(inputs) {
    if (!this.live) return false;
    const ch = inputs[0];
    if (!ch || !ch.length || !ch[0]) return true;
    const x = ch[0], nc = ch.length;
    if (this.n + x.length > this.buf.length) {                    // drop what no future output reads
      const keep = Math.max(0, Math.floor(this.t) - this.half - 1 - this.b0);
      this.buf.copyWithin(0, keep, this.n); this.n -= keep; this.b0 += keep;
      if (this.n + x.length > this.buf.length) { const nb = new Float32Array((this.n + x.length) * 2); nb.set(this.buf.subarray(0, this.n)); this.buf = nb; }
    }
    for (let i = 0; i < x.length; i++) { let v = x[i]; for (let c = 1; c < nc; c++) v += ch[c][i]; this.buf[this.n++] = nc > 1 ? v / nc : v; }
    const end = this.b0 + this.n;
    while (this.t + this.half < end) {
      const c = Math.floor(this.t); let s = 0;
      for (let j = c - this.half + 1; j <= c + this.half; j++) { const w = this.k(this.t - j); if (w) s += this.buf[j - this.b0] * w; }
      this.out[this.on++] = s;
      if (this.on === 320) { const b = this.out; this.port.postMessage(b, [b.buffer]); this.out = new Float32Array(320); this.on = 0; }
      this.t += this.step;
    }
    return true;
  }
}
registerProcessor('p0-mic16k', Mic16k);
