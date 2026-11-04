// p0v_lexicon.js - the compact browser lexicon (CMUdict, BSD-2, first pronunciation wins, + game_lexicon.txt overrides) and its builder.
// A Map-like object (has / get / set / size) that frontend.mjs's Frontend uses as its `lex`, without unpacking 135k entries.
//
// p0voice_lexicon.bin (little-endian):
//   "P0LX" | u32 version 1 | u32 words | u32 blocks | u32 block size (words) | u32 phone-table bytes | phone table (ASCII, phones
//   separated by spaces; phone i is byte 0x80 + i) | u32 block offsets [blocks] (from the start of the data) | data.
//   Words are sorted (code-unit order). A record: one byte < 0x20 = characters shared with the previous word (0 at a block start),
//   the remaining characters (0x20..0x7e), then its phones (bytes >= 0x80). The next record starts at the next byte < 0x20.
'use strict';

const MAGIC = 0x584c3050;   // "P0LX"

export class CompactLex {
  constructor(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a p0voice lexicon (P0LX)');
    this.n = dv.getUint32(8, true); this.nb = dv.getUint32(12, true); this.bs = dv.getUint32(16, true);
    const pl = dv.getUint32(20, true);
    this.phones = new TextDecoder().decode(u8.subarray(24, 24 + pl)).split(' ');
    const bo = 24 + pl;
    this.blocks = new Uint32Array(this.nb);
    for (let i = 0; i < this.nb; i++) this.blocks[i] = dv.getUint32(bo + 4 * i, true);
    this.data = u8.subarray(bo + 4 * this.nb);
    this.extra = new Map();   // set() / addLexicon(): overrides and additions
    this.bytes = u8.byteLength;
  }
  get size() { return this.n + this.extra.size; }
  has(w) { return this.extra.has(w) || this._find(w) !== null; }
  get(w) { const e = this.extra.get(w); return e !== undefined ? e : this._find(w) || undefined; }
  set(w, ph) { this.extra.set(w, ph); return this; }
  _word(p, prev) {   // decode the word at p (prev = the previous word of the block) -> [word, p after the characters]
    const keep = this.data[p++]; let s = prev.slice(0, keep);
    while (p < this.data.length && this.data[p] >= 0x20 && this.data[p] < 0x80) s += String.fromCharCode(this.data[p++]);
    return [s, p];
  }
  _find(w) {
    if (!this.nb || typeof w !== 'string') return null;
    let lo = 0, hi = this.nb - 1;
    while (lo < hi) {   // the last block whose first word <= w
      const mid = (lo + hi + 1) >> 1, [fw] = this._word(this.blocks[mid], '');
      if (fw <= w) lo = mid; else hi = mid - 1;
    }
    let p = this.blocks[lo], prev = '';
    const end = lo + 1 < this.nb ? this.blocks[lo + 1] : this.data.length;
    while (p < end) {
      const [s, q] = this._word(p, prev);
      let r = q; while (r < end && this.data[r] >= 0x80) r++;
      if (s === w) { const ph = []; for (let i = q; i < r; i++) ph.push(this.phones[this.data[i] - 0x80]); return ph; }
      if (s > w) return null;
      prev = s; p = r;
    }
    return null;
  }
}

/** entries: Map word -> phones[] -> Uint8Array (p0voice_lexicon.bin) */
export function buildLexicon(entries, blockSize = 32) {
  const words = [...entries.keys()].filter((w) => /^[\x20-\x7e]+$/.test(w) && w.length < 256).sort();
  const phoneSet = new Set(); for (const w of words) for (const p of entries.get(w)) phoneSet.add(p);
  const phones = [...phoneSet].sort();
  if (phones.length > 127) throw new Error('too many phone symbols');
  const pid = new Map(phones.map((p, i) => [p, i]));
  const data = [], blocks = [];
  let prev = '';
  words.forEach((w, i) => {
    if (i % blockSize === 0) { blocks.push(data.length); prev = ''; }
    let keep = 0; while (keep < 31 && keep < w.length && keep < prev.length && w[keep] === prev[keep]) keep++;
    data.push(keep); for (let k = keep; k < w.length; k++) data.push(w.charCodeAt(k));
    for (const p of entries.get(w)) data.push(0x80 + pid.get(p));
    prev = w;
  });
  const pt = new TextEncoder().encode(phones.join(' '));
  const out = new Uint8Array(24 + pt.length + 4 * blocks.length + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, 1, true); dv.setUint32(8, words.length, true); dv.setUint32(12, blocks.length, true);
  dv.setUint32(16, blockSize, true); dv.setUint32(20, pt.length, true);
  out.set(pt, 24);
  blocks.forEach((b, i) => dv.setUint32(24 + pt.length + 4 * i, b, true));
  out.set(data, 24 + pt.length + 4 * blocks.length);
  return out;
}
