// Gemma 4 tokenizer, pure JS, from the compact tokenizer.bin (tools/pack_tokenizer.py).  Reproduces HF `tokenizers` for this
// tokenizer.json: added tokens split first (leftmost-longest), then normalizer ' ' -> U+2581, then BPE over each segment with
// byte fallback (<0xXX>), merges by rank (lowest rank, then leftmost; the tokenizers crate's merge_all queue).  Decode: U+2581 -> ' ',
// byte-fallback runs -> UTF-8 (invalid -> U+FFFD per byte).  Heap use ~25 MB (typed arrays) instead of ~250 MB of parsed JSON.
'use strict';

const SPACE = '▁';

export class GemmaTokenizer {
  /** buf: ArrayBuffer of tokenizer.bin; meta: parsed tokenizer_meta.json */
  constructor(buf, meta) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x4b544650) throw new Error('not a PFTK tokenizer');   // 'PFTK'
    const n = dv.getUint32(8, true), nm = dv.getUint32(12, true);
    this.n = n; this.nm = nm;
    this.offs = new Uint32Array(buf, 16, n + 1);
    const blob0 = 16 + 4 * (n + 1);
    this.blob = new Uint8Array(buf, blob0, this.offs[n]);
    const m0 = Math.ceil((blob0 + this.offs[n]) / 4) * 4;
    this.merges = new Uint32Array(buf, m0, nm * 3);
    this.td = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });   // ignoreBOM: the vocab has entries that start with U+FEFF
    this.meta = meta;
    this.unk = meta.unk; this.byte0 = meta.byte0;
    // single-code-point vocab entries (initial BPE symbols)
    this.chars = new Map();
    for (let i = 0; i < n; i++) {
      const a = this.offs[i], b = this.offs[i + 1], len = b - a;
      if (len > 4 || len === 0) continue;
      const s = this.td.decode(this.blob.subarray(a, b));
      if ([...s].length === 1 && !this.chars.has(s)) this.chars.set(s, i);
    }
    // vocab ids of the 256 byte tokens <0x00>..<0xFF> (contiguous in this vocab; checked)
    for (let k = 0; k < 256; k++) if (this.str(this.byte0 + k) !== '<0x' + k.toString(16).toUpperCase().padStart(2, '0') + '>') throw new Error('byte tokens not contiguous');
    // merge hash: (a, b) -> merge index (later duplicates win, like the tokenizers crate HashMap)
    let cap = 1; while (cap < nm * 2) cap <<= 1;
    this.mask = cap - 1; this.slots = new Int32Array(cap).fill(-1);
    for (let i = 0; i < nm; i++) {
      const a = this.merges[3 * i], b = this.merges[3 * i + 1];
      let h = this._h(a, b);
      for (;;) { const s = this.slots[h]; if (s < 0) { this.slots[h] = i; break; } if (this.merges[3 * s] === a && this.merges[3 * s + 1] === b) { this.slots[h] = i; break; } h = (h + 1) & this.mask; }
    }
    // added tokens (all special in Gemma 4): matched in the raw text, leftmost-longest
    this.added = meta.added.map(([c, id]) => [c, id]).sort((x, y) => y[0].length - x[0].length);
    this.addedFirst = new Set(this.added.map(([c]) => c[0]));
    this.cache = new Map();
  }
  _h(a, b) { return (Math.imul(a, 0x9E3779B1) ^ Math.imul(b + 0x7f4a7c15, 0x85EBCA77)) >>> 0 & this.mask; }
  _merge(a, b) {
    let h = this._h(a, b);
    for (;;) { const s = this.slots[h]; if (s < 0) return -1; if (this.merges[3 * s] === a && this.merges[3 * s + 1] === b) return s; h = (h + 1) & this.mask; }
  }
  str(id) { return this.td.decode(this.blob.subarray(this.offs[id], this.offs[id + 1])); }
  tokenToId(s) { for (const [c, id] of this.added) if (c === s) return id; return this.chars.get(s); }

  /** BPE over one normalised segment -> ids */
  _bpe(seg) {
    const c = this.cache.get(seg); if (c) return c;
    const sym = [], enc = new TextEncoder();
    for (const ch of seg) {
      const id = this.chars.get(ch);
      if (id !== undefined) sym.push(id);
      else { const bytes = enc.encode(ch); for (const b of bytes) sym.push(this.byte0 + b); }
    }
    const n = sym.length, prev = new Int32Array(n), next = new Int32Array(n), alive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) { prev[i] = i - 1; next[i] = i + 1 < n ? i + 1 : -1; }
    // binary min-heap of (rank, pos, newId)
    const hr = [], hp = [], hn = [];
    const less = (i, j) => hr[i] < hr[j] || (hr[i] === hr[j] && hp[i] < hp[j]);
    const swap = (i, j) => { let t = hr[i]; hr[i] = hr[j]; hr[j] = t; t = hp[i]; hp[i] = hp[j]; hp[j] = t; t = hn[i]; hn[i] = hn[j]; hn[j] = t; };
    const push = (r, p, nid) => { hr.push(r); hp.push(p); hn.push(nid); let i = hr.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (less(i, q)) { swap(i, q); i = q; } else break; } };
    const pop = () => {
      const r = hr[0], p = hp[0], nid = hn[0], last = hr.length - 1;
      hr[0] = hr[last]; hp[0] = hp[last]; hn[0] = hn[last]; hr.pop(); hp.pop(); hn.pop();
      let i = 0; const L = hr.length;
      for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < L && less(l, m)) m = l; if (rr < L && less(rr, m)) m = rr; if (m === i) break; swap(i, m); i = m; }
      return [r, p, nid];
    };
    for (let i = 0; i + 1 < n; i++) { const k = this._merge(sym[i], sym[i + 1]); if (k >= 0) push(k, i, this.merges[3 * k + 2]); }
    while (hr.length) {
      const [, pos, nid] = pop();
      if (!alive[pos] || next[pos] < 0) continue;
      const np = next[pos], k = this._merge(sym[pos], sym[np]);
      if (k < 0 || this.merges[3 * k + 2] !== nid) continue;
      sym[pos] = nid; alive[np] = 0; next[pos] = next[np]; if (next[np] >= 0) prev[next[np]] = pos;
      if (prev[pos] >= 0) { const q = prev[pos], k2 = this._merge(sym[q], sym[pos]); if (k2 >= 0) push(k2, q, this.merges[3 * k2 + 2]); }
      if (next[pos] >= 0) { const k3 = this._merge(sym[pos], sym[next[pos]]); if (k3 >= 0) push(k3, pos, this.merges[3 * k3 + 2]); }
    }
    const out = []; for (let i = 0; i < n; i++) if (alive[i]) out.push(sym[i]);
    if (seg.length < 64) { if (this.cache.size > 4096) this.cache.clear(); this.cache.set(seg, out); }
    return out;
  }

  /** text -> ids (no BOS added: the chat template writes <bos> itself, as HF does) */
  encode(text) {
    const ids = [];
    let i = 0, start = 0;
    const flush = (end) => { if (end > start) { const seg = text.slice(start, end).replace(/ /g, SPACE); for (const id of this._bpe(seg)) ids.push(id); } };
    while (i < text.length) {
      if (this.addedFirst.has(text[i])) {
        let hit = null;
        for (const a of this.added) if (text.startsWith(a[0], i)) { hit = a; break; }   // sorted longest first
        if (hit) { flush(i); ids.push(hit[1]); i += hit[0].length; start = i; continue; }
      }
      i++;
    }
    flush(text.length);
    return ids;
  }

  /** ids -> text (special tokens kept as their text unless skipSpecial) */
  decode(ids, { skipSpecial = false } = {}) {
    let out = '', bytes = [];
    const special = this._special || (this._special = new Set(this.meta.added.map(([, id]) => id)));
    const flushBytes = () => {
      if (!bytes.length) return;
      const u8 = new Uint8Array(bytes);
      try { out += new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(u8); } catch (e) { out += String.fromCharCode(0xFFFD).repeat(bytes.length); }
      bytes = [];
    };
    for (const id of ids) {
      if (id >= this.byte0 && id < this.byte0 + 256) { bytes.push(id - this.byte0); continue; }
      flushBytes();
      if (skipSpecial && special.has(id)) continue;
      out += this.str(id).replace(/▁/g, ' ');
    }
    flushBytes();
    return out;
  }
}

export async function loadTokenizer(readFile) {
  const [bin, meta] = await Promise.all([readFile('tokenizer.bin'), readFile('tokenizer_meta.json')]);
  return new GemmaTokenizer(bin, JSON.parse(new TextDecoder().decode(meta)));
}
