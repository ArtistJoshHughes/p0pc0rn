// frontend.mjs - p0voice text front end (ours, no third-party code): normaliser -> words -> lexicon / G2P -> phoneme ids.
// One file, used both by the training data pipeline (node) and by the browser runtime, so both see identical phonemes.
//
//   import { Frontend } from './frontend.mjs';
//   const fe = new Frontend(lexiconText, { g2p });      // lexiconText = "word PH ON EM ES\n..." (CMUdict format, first entry wins)
//   fe.normalize("Morning, a01.")   -> "morning , \u0001a zero one ."   (letter names are marked with \u0001)
//   fe.toIds("Morning, a01.")       -> { ids: Int32Array, phones: [...], oov: [...] }

export const PUNCT = [',', '.', '!', '?', ';', ':', '-', '…'];
export const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
export const CONS = ['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH'];
export const SYMBOLS = (() => {
  const s = ['<pad>', ' ', ...PUNCT];
  for (const v of VOWELS) for (const k of ['0', '1', '2']) s.push(v + k);
  s.push(...CONS);
  while (s.length < 96) s.push(`<spare${s.length}>`);
  return s;
})();
export const SYM_ID = Object.fromEntries(SYMBOLS.map((s, i) => [s, i]));
export const N_SYMBOLS = SYMBOLS.length;   // 96

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD_IRREG = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

export function cardinal(n) {
  n = Math.floor(n);
  if (n < 0) return 'minus ' + cardinal(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + cardinal(n % 100) : '');
  for (const [v, name] of SCALES) {
    if (n >= v) {
      const hi = Math.floor(n / v), lo = n % v;
      return cardinal(hi) + ' ' + name + (lo ? ' ' + cardinal(lo) : '');
    }
  }
  return String(n);
}

export function ordinal(n) {
  const w = cardinal(n).split(' ');
  const last = w.pop();
  let o;
  if (ORD_IRREG[last]) o = ORD_IRREG[last];
  else if (last.endsWith('y')) o = last.slice(0, -1) + 'ieth';
  else o = last + 'th';
  w.push(o);
  return w.join(' ');
}

function digits(s) { return [...s].map((c) => ONES[+c]).join(' '); }

function year(n) {
  if (n >= 2000 && n <= 2009) return 'two thousand' + (n % 10 ? ' ' + ONES[n % 10] : '');
  const hi = Math.floor(n / 100), lo = n % 100;
  if (lo === 0) return cardinal(hi) + ' hundred';
  if (lo < 10) return cardinal(hi) + ' oh ' + ONES[lo];
  return cardinal(hi) + ' ' + cardinal(lo);
}

function decimal(intPart, frac) {
  return cardinal(+intPart) + ' point ' + digits(frac);
}

const LETTER = '\u0001';                       // marks a letter name ("a01" -> "\u0001a zero one")
const ABBREV = {
  'mr': 'mister', 'mrs': 'missus', 'ms': 'miz', 'dr': 'doctor', 'st': 'saint', 'jr': 'junior', 'sr': 'senior', 'vs': 'versus',
  'etc': 'et cetera', 'approx': 'approximately', 'dept': 'department', 'min': 'minutes', 'sec': 'seconds', 'hr': 'hours',
  'km': 'kilometers', 'kg': 'kilograms', 'mph': 'miles per hour', 'ft': 'feet', 'lbs': 'pounds',
};
const CAPS_WORDS = new Set(['no', 'go', 'up', 'it', 'is', 'me', 'we', 'so', 'oh', 'hi', 'my', 'an', 'at', 'be', 'by', 'do', 'he', 'if', 'in',
  'of', 'on', 'or', 'to', 'us', 'am', 'as', 'ah', 'uh', 'yo', 'ha']);
const SYMBOL_WORDS = { '&': ' and ', '+': ' plus ', '=': ' equals ', '@': ' at ', '*': ' star ', '°': ' degrees ', '#': ' number ',
  '/': ' slash ', '<': ' less than ', '>': ' greater than ', '~': ' about ', '^': ' ', '_': ' ', '|': ' ', '\\': ' ' };

export class Frontend {
  constructor(lexiconText, opts = {}) {
    this.lex = new Map();
    this.g2p = opts.g2p || null;                // function(word) -> ['HH', 'AH0', ...] or null
    if (lexiconText) this.addLexicon(lexiconText);
  }

  addLexicon(text, override = false) {
    for (const line of text.split('\n')) {
      const t = line.split('#')[0].trim();
      if (!t) continue;
      const sp = t.indexOf(' ');
      if (sp < 0) continue;
      let w = t.slice(0, sp).toLowerCase();
      if (/\(\d+\)$/.test(w)) continue;         // alternate pronunciation: first entry wins
      const ph = t.slice(sp + 1).trim().split(/\s+/);
      if (override || !this.lex.has(w)) this.lex.set(w, ph);
    }
  }

  // text -> normalised string: lowercase words separated by spaces, punctuation as separate tokens, letter names marked.
  normalize(text) {
    let s = String(text);
    s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[‘’‛′`]/g, "'").replace(/[“”„″]/g, '"');
    s = s.replace(/…/g, '...').replace(/[–—―]/g, ' - ').replace(/ /g, ' ');
    s = s.replace(/\.{3,}/g, ' … ');
    // numbers with thousands separators are never years: read them now (1,250 -> one thousand two hundred fifty)
    s = s.replace(/(^|[^\d.,$£])(\d{1,3}(?:,\d{3})+)(?![\d.,]*\d)/g, (m, pre, d) => `${pre} ${cardinal(+d.replace(/,/g, ''))} `);
    s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
    // money
    s = s.replace(/\$(\d+)\.(\d\d)\b/g, (m, d, c) => ` ${cardinal(+d)} ${+d === 1 ? 'dollar' : 'dollars'}${+c ? ' ' + cardinal(+c) : ''} `);
    s = s.replace(/\$(\d+)\b/g, (m, d) => ` ${cardinal(+d)} ${+d === 1 ? 'dollar' : 'dollars'} `);
    s = s.replace(/£(\d+)\b/g, (m, d) => ` ${cardinal(+d)} ${+d === 1 ? 'pound' : 'pounds'} `);
    // percent
    s = s.replace(/(\d+)\.(\d+)\s*%/g, (m, a, b) => ` ${decimal(a, b)} percent `);
    s = s.replace(/(\d+)\s*%/g, (m, a) => ` ${cardinal(+a)} percent `);
    // times 3:45, 3:05, 3:00
    s = s.replace(/\b(\d{1,2}):(\d\d)\b/g, (m, h, mi) => {
      const H = cardinal(+h), M = +mi;
      return ' ' + (M === 0 ? H + " o'clock" : M < 10 ? H + ' oh ' + ONES[M] : H + ' ' + cardinal(M)) + ' ';
    });
    // unit names: a01, B7, x12 -> letter name + digits one by one
    s = s.replace(/\b([A-Za-z])-?(\d+)\b/g, (m, l, d) => ` ${LETTER}${l.toLowerCase()} ${digits(d)} `);
    // the same written out ("A oh one", "B seven"): a lone capital letter before zero/oh (any letter) or a number word (not A or I)
    s = s.replace(/(^|[^A-Za-z'])([A-Z])\s+(?=(?:zero|oh)\b)/g, (m, pre, l) => `${pre}${LETTER}${l.toLowerCase()} `);
    s = s.replace(/(^|[^A-Za-z'])([B-HJ-Z])\s+(?=(?:one|two|three|four|five|six|seven|eight|nine)\b)/g, (m, pre, l) => `${pre}${LETTER}${l.toLowerCase()} `);
    // digits followed by a letter (3D, 4K, 2x)
    s = s.replace(/\b(\d+)([A-Za-z])\b/g, (m, d, l) => ` ${cardinal(+d)} ${l.toLowerCase() === 'x' ? 'times' : LETTER + l.toLowerCase()} `);
    // ordinals
    s = s.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (m, d) => ` ${ordinal(+d)} `);
    // decimals, negatives
    s = s.replace(/(^|[^\w.])-(\d+(?:\.\d+)?)\b/g, (m, pre, d) => `${pre} minus ${d} `);
    s = s.replace(/\b(\d+)\.(\d+)\b/g, (m, a, b) => ` ${decimal(a, b)} `);
    // years and plain numbers
    s = s.replace(/\b\d+\b/g, (m, off, all) => {
      const n = +m;
      if (m.length > 1 && m[0] === '0') return ' ' + digits(m) + ' ';
      // a year: 1100-2099 after in / since / by / from / until / of / year / circa / back / before / after, or with nothing after it
      const prev = (all.slice(Math.max(0, off - 12), off).match(/([A-Za-z]+)\W*$/) || [])[1] || '';
      const next = all.slice(off + m.length).match(/^\s*([A-Za-z]+)/);
      const yearish = /^(in|since|by|from|until|till|of|year|circa|back|before|after|around|summer|winter|spring|autumn|fall)$/i.test(prev) || !next;
      if (m.length === 4 && n >= 1100 && n <= 2099 && yearish) return ' ' + year(n) + ' ';
      if (m.length > 15) return ' ' + digits(m) + ' ';
      return ' ' + cardinal(n) + ' ';
    });
    // # before a word, symbols
    s = s.replace(/[&+=@*°#/<>~^_|\\]/g, (c) => SYMBOL_WORDS[c] || ' ');
    // abbreviations with a period
    s = s.replace(/\b(e\.g|i\.e)\./gi, (m) => (m[0].toLowerCase() === 'e' ? ' for example, ' : ' that is, '));
    s = s.replace(/\b([A-Za-z]+)\./g, (m, w) => (ABBREV[w.toLowerCase()] && w.length <= 6 && w.toLowerCase() !== 'min' ? ` ${ABBREV[w.toLowerCase()]} ` : m));
    // ALL-CAPS acronyms -> letters (AI, TV, NPC); caps words that are real words stay words
    s = s.replace(/\b[A-Z]{2,5}s?\b/g, (m) => {
      const plural = m.length > 2 && m.endsWith('s');
      const core = plural ? m.slice(0, -1) : m, low = core.toLowerCase();
      if (low === 'ok') return ' okay ';
      if ((low.length >= 3 && this.lex.has(low) && !/^[^aeiouy]+$/.test(low)) || CAPS_WORDS.has(low)) return m;
      return ' ' + [...low].map((c) => LETTER + c).join(' ') + (plural ? 's' : '') + ' ';
    });
    s = s.replace(/\bok\b/gi, 'okay');
    // punctuation -> tokens
    s = s.replace(/[!?.]+/g, (m) => ` ${m.includes('?') ? '?' : m.includes('!') ? '!' : '.'} `);
    s = s.replace(/[,;:]/g, (c) => ` ${c} `);
    s = s.replace(/(^|\s)-+(\s|$)/g, ' - ');
    s = s.replace(/[()\[\]{}"]/g, ' , ');
    s = s.replace(/[^A-Za-z0-9'\- ,.!?;:…\u0001]/g, ' ');
    s = s.toLowerCase().replace(/\s+/g, ' ').trim();
    // clean up runs of punctuation and leading punctuation
    let toks = s.split(' ').filter(Boolean);
    const out = [];
    for (const t of toks) {
      const isP = PUNCT.includes(t);
      if (isP && (out.length === 0 || PUNCT.includes(out[out.length - 1]))) {
        if (out.length && ['.', '!', '?', '…'].includes(t)) out[out.length - 1] = t;   // ", ." -> "."
        continue;
      }
      out.push(t);
    }
    return out.join(' ');
  }

  letterPron(c) {
    const L = { a: 'EY1', b: 'B IY1', c: 'S IY1', d: 'D IY1', e: 'IY1', f: 'EH1 F', g: 'JH IY1', h: 'EY1 CH', i: 'AY1', j: 'JH EY1',
      k: 'K EY1', l: 'EH1 L', m: 'EH1 M', n: 'EH1 N', o: 'OW1', p: 'P IY1', q: 'K Y UW1', r: 'AA1 R', s: 'EH1 S', t: 'T IY1', u: 'Y UW1',
      v: 'V IY1', w: 'D AH1 B AH0 L Y UW0', x: 'EH1 K S', y: 'W AY1', z: 'Z IY1' };
    return L[c] ? L[c].split(' ') : null;
  }

  // one normalised word -> phones (array) or null
  wordPron(w, oov) {
    if (w.startsWith(LETTER)) {
      const c = w.slice(1);
      if (c.length === 1) return this.letterPron(c);
      if (c.length === 2 && c[1] === 's') return [...this.letterPron(c[0]), 'Z'];
    }
    if (this.lex.has(w)) return this.lex.get(w);
    const bare = w.replace(/^'+|'+$/g, '');
    if (bare !== w && this.lex.has(bare)) return this.lex.get(bare);
    if (!bare) return [];
    // possessive / contraction of a known word
    const m = bare.match(/^(.+)'(s|d|ll|re|ve|m)$/);
    if (m && this.lex.has(m[1])) {
      const base = this.lex.get(m[1]), last = base[base.length - 1].replace(/\d/, '');
      const tail = { d: ['D'], ll: ['L'], re: ['ER0'], ve: ['V'], m: ['M'] }[m[2]];
      if (tail) return [...base, ...tail];
      if (['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(last)) return [...base, 'IH0', 'Z'];
      if (['P', 'T', 'K', 'F', 'TH'].includes(last)) return [...base, 'S'];
      return [...base, 'Z'];
    }
    // hyphenated compound: every part known
    if (bare.includes('-')) {
      const parts = bare.split('-').filter(Boolean), ph = [];
      for (const p of parts) {
        const q = this.wordPron(p, null);
        if (!q) { ph.length = 0; break; }
        ph.push(...q);
      }
      if (ph.length) return ph;
    }
    if (oov) oov.push(bare);
    if (this.g2p) {
      const g = this.g2p(bare.replace(/[^a-z']/g, ''));
      if (g && g.length) return g;
    }
    return null;
  }

  // text -> {ids, phones, words, oov}.  Sequence: " " w1 " " w2 punct " " ... final-punct " "
  toIds(text) {
    const norm = this.normalize(text);
    const toks = norm ? norm.split(' ') : [];
    const phones = [' '], oov = [], words = [];
    for (const t of toks) {
      if (PUNCT.includes(t)) {
        if (phones[phones.length - 1] === ' ') phones.pop();
        phones.push(t, ' ');
        continue;
      }
      const ph = this.wordPron(t, oov);
      if (!ph) continue;                        // unknown word, no G2P: skipped (the caller sees it in oov)
      words.push(t);
      phones.push(...ph, ' ');
    }
    // make sure the line ends with sentence punctuation
    let k = phones.length - 1;
    while (k >= 0 && phones[k] === ' ') k--;
    if (k < 0 || !['.', '!', '?', '…'].includes(phones[k])) {
      if (k >= 0 && PUNCT.includes(phones[k])) phones[k] = '.';
      else { phones.length = k + 1; phones.push('.', ' '); }
    }
    const ids = new Int32Array(phones.length);
    phones.forEach((p, i) => { ids[i] = SYM_ID[p] ?? SYM_ID[' ']; });
    return { ids, phones, words, oov, norm };
  }
}
