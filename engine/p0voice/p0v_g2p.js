// p0v_g2p.js - the learned G2P (train/train_g2p.py G2P, export_g2p.py) in plain JS: words not in the lexicon -> ARPAbet phones.
//   h[t*UP + u] = emb[char t] + slot[u] (UP = 3 slots per character); 5 pre-LN blocks: h += MHA(LN1 h) (RoPE per head, pairs
//   (2i, 2i+1), theta 1e4, all slots valid), h += W2 gelu(W1 LN2 h); logits = out(LN h); per-slot argmax; CTC collapse (drop repeats,
//   then blank 0) -> config.phones. A few words per line, so no GPU and no WASM: ~1 ms a word on a desktop.
//   const g2p = await loadG2P(bytesOrUrl);  createP0Voice({ g2p })  (g2p(word) -> ['T', 'AY1', ...] | null)
'use strict';
import { parsePack, tensorF32 } from './p0v_pack.js';

function erf(x) {   // Abramowitz & Stegun 7.1.26
  const s = x < 0 ? -1 : 1, z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z));
}
function lin(x, T, K, W, b, N) {   // x [T][K] -> [T][N], W [N][K]
  const y = new Float32Array(T * N);
  for (let t = 0; t < T; t++) {
    const xr = x.subarray(t * K, t * K + K);
    for (let n = 0; n < N; n++) {
      const wo = n * K; let a0 = 0, a1 = 0, a2 = 0, a3 = 0, k = 0;
      for (; k + 4 <= K; k += 4) { a0 += xr[k] * W[wo + k]; a1 += xr[k + 1] * W[wo + k + 1]; a2 += xr[k + 2] * W[wo + k + 2]; a3 += xr[k + 3] * W[wo + k + 3]; }
      for (; k < K; k++) a0 += xr[k] * W[wo + k];
      y[t * N + n] = (b ? b[n] : 0) + ((a0 + a1) + (a2 + a3));
    }
  }
  return y;
}
function ln(x, T, C, w, b) {
  const y = new Float32Array(T * C);
  for (let t = 0; t < T; t++) {
    let m = 0; for (let c = 0; c < C; c++) m += x[t * C + c]; m /= C;
    let v = 0; for (let c = 0; c < C; c++) { const d = x[t * C + c] - m; v += d * d; }
    const r = 1 / Math.sqrt(v / C + 1e-5);
    for (let c = 0; c < C; c++) y[t * C + c] = (x[t * C + c] - m) * r * w[c] + b[c];
  }
  return y;
}

export class G2P {
  constructor(bytes) {
    const pk = parsePack(bytes), C = pk.config;
    if (C.kind !== 'g2p') throw new Error('not a G2P pack');
    this.cfg = C; this.chars = new Map(C.chars.map((c, i) => [c, i])); this.phones = C.phones;
    this.d = C.d; this.H = C.heads; this.UP = C.up; this.dff = C.d_ff;
    const g = (n) => tensorF32(pk, 'g2p.' + n);
    this.emb = g('emb.weight'); this.slot = g('slot');
    this.blocks = [];
    for (let l = 0; l < C.layers; l++) {
      const p = `blocks.${l}.`;
      this.blocks.push({ l1w: g(p + '0.weight'), l1b: g(p + '0.bias'), qkv: g(p + '1.qkv.weight'), qkvb: g(p + '1.qkv.bias'), o: g(p + '1.o.weight'), ob: g(p + '1.o.bias'),
        l2w: g(p + '2.weight'), l2b: g(p + '2.bias'), f1: g(p + '3.weight'), f1b: g(p + '3.bias'), f2: g(p + '4.weight'), f2b: g(p + '4.bias') });
    }
    this.lnw = g('ln.weight'); this.lnb = g('ln.bias'); this.out = g('out.weight'); this.outb = g('out.bias');
    this.cache = new Map();
  }
  /** word -> logits [T*UP][n_phones] */
  logits(word) {
    const ids = [...word].map((c) => this.chars.get(c)).filter((i) => i != null && i > 0);
    const UP = this.UP, d = this.d, H = this.H, dh = d / H, T = ids.length * UP;
    if (!T) return null;
    let h = new Float32Array(T * d);
    ids.forEach((id, t) => { for (let u = 0; u < UP; u++) for (let c = 0; c < d; c++) h[(t * UP + u) * d + c] = this.emb[id * d + c] + this.slot[u * d + c]; });
    const half = dh / 2, inv = new Float32Array(half);
    for (let i = 0; i < half; i++) inv[i] = Math.fround(1 / Math.fround(Math.pow(10000, Math.fround((2 * i) / dh))));
    for (const B of this.blocks) {
      const a = ln(h, T, d, B.l1w, B.l1b), qkv = lin(a, T, d, B.qkv, B.qkvb, 3 * d);
      for (let t = 0; t < T; t++) for (let part = 0; part < 2; part++) for (let hh = 0; hh < H; hh++) {
        const o = t * 3 * d + part * d + hh * dh;
        for (let i = 0; i < half; i++) { const ang = Math.fround(t * inv[i]), c = Math.cos(ang), s = Math.sin(ang), x1 = qkv[o + 2 * i], x2 = qkv[o + 2 * i + 1]; qkv[o + 2 * i] = x1 * c - x2 * s; qkv[o + 2 * i + 1] = x1 * s + x2 * c; }
      }
      const att = new Float32Array(T * d), sc = new Float64Array(T), is = 1 / Math.sqrt(dh);
      for (let hh = 0; hh < H; hh++) for (let i = 0; i < T; i++) {
        let mx = -Infinity;
        for (let j = 0; j < T; j++) { let s = 0; for (let k = 0; k < dh; k++) s += qkv[i * 3 * d + hh * dh + k] * qkv[j * 3 * d + d + hh * dh + k]; sc[j] = s * is; if (sc[j] > mx) mx = sc[j]; }
        let sum = 0; for (let j = 0; j < T; j++) { sc[j] = Math.exp(sc[j] - mx); sum += sc[j]; }
        for (let k = 0; k < dh; k++) { let v = 0; for (let j = 0; j < T; j++) v += sc[j] * qkv[j * 3 * d + 2 * d + hh * dh + k]; att[i * d + hh * dh + k] = v / sum; }
      }
      const o = lin(att, T, d, B.o, B.ob, d);
      for (let i = 0; i < h.length; i++) h[i] += o[i];
      const f = lin(ln(h, T, d, B.l2w, B.l2b), T, d, B.f1, B.f1b, this.dff);
      for (let i = 0; i < f.length; i++) f[i] = 0.5 * f[i] * (1 + erf(f[i] * Math.SQRT1_2));
      const f2 = lin(f, T, this.dff, B.f2, B.f2b, d);
      for (let i = 0; i < h.length; i++) h[i] += f2[i];
    }
    return { T, n: this.phones.length, logits: lin(ln(h, T, d, this.lnw, this.lnb), T, d, this.out, this.outb, this.phones.length) };
  }
  /** word -> phones (CTC collapse of the per-slot argmax) | null */
  phonesOf(word) {
    const w = String(word || '').toLowerCase();
    if (this.cache.has(w)) return this.cache.get(w);
    const r = this.logits(w);
    let seq = null;
    if (r) {
      seq = []; let prev = 0;
      for (let t = 0; t < r.T; t++) {
        let best = 0, bv = -Infinity; for (let k = 0; k < r.n; k++) if (r.logits[t * r.n + k] > bv) { bv = r.logits[t * r.n + k]; best = k; }
        if (best !== prev && best !== 0) seq.push(this.phones[best]);
        prev = best;
      }
      if (!seq.length) seq = null;
    }
    if (this.cache.size > 4096) this.cache.clear();
    this.cache.set(w, seq);
    return seq;
  }
}

/** bytes | URL | path -> a g2p(word) function for createP0Voice({ g2p }) (the G2P object is on .model) */
export async function loadG2P(src, base = import.meta.url) {
  let bytes = src;
  if (typeof src === 'string') {
    if (typeof process !== 'undefined' && process.versions && process.versions.node && !/^https?:/i.test(src)) {
      const fs = await import('node:fs/promises'), { fileURLToPath } = await import('node:url');
      bytes = new Uint8Array(await fs.readFile(/^file:/i.test(src) ? fileURLToPath(src) : src));
    } else { const r = await fetch(new URL(src, base).href); if (!r.ok) throw new Error('g2p pack: HTTP ' + r.status); bytes = new Uint8Array(await r.arrayBuffer()); }
  }
  const m = new G2P(bytes), f = (w) => m.phonesOf(w);
  f.model = m;
  return f;
}
