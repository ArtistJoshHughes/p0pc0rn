// lookupwords.js - 3.9 polish (juliqa, round 4: the farm board, Oct-27): word helpers for the research lane, in code (no model).
//   - nearWord: a typo of a longer word ("avocardo" / "avocado") is the same word when a topic is matched against a candidate's TITLE
//     (Wikipedia offered the candidate; its own search corrects most spellings: srinfo=suggestion, and its redirects)
//   - flatMath: a formula in a plain-text extract is a column of MathML fallback lines and "{\displaystyle ...}" that cuts its sentence in
//     two ("denoted c (in ISO and IEC standards / c / 0 / {\displaystyle c_{0}} / ), exactly equal to 299792458 m/s"): the column becomes
//     the formula's plain text inside the sentence, so the sentence can be quoted whole
//   - PERSONA: a character's article ("Spider-Man is a superhero ...", "Homer Simpson is a character ...") calls its subject he / she as a
//     person's does ("Created by writer-editor Stan Lee and artist Steve Ditko, he first appeared ..."): the quote reader's own pronoun
//     rule (the sentence before names the article) then applies with he / she
//   - searchHits: Wikipedia's full-text search answer -> [{title, seen}], seen = the redirect it matched and its snippet as plain text (the
//     words Wikipedia found in the article for this topic)

/** two words that differ by one edit (an adjacent swap is one edit), both of 7+ letters with the same first letter; two edits from 10 */
export function nearWord(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (!a || !b || a[0] !== b[0] || short < 7 || Math.abs(a.length - b.length) > 2 || /\d/.test(a + b)) return false;
  const max = short >= 10 ? 2 : 1;
  let p2 = null, p1 = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur.push(v); if (v < best) best = v;
    }
    if (best > max) return false;
    p2 = p1; p1 = cur;
  }
  return p1[b.length] <= max;
}

// the column: from the line break after the sentence's words, lines of at most three short tokens, then the TeX line, then the blank lines
const MATH_COL = /[ \t]*\n(?:[ \t]*(?:\S{1,12}[ \t]*){0,3}\n){0,80}?[ \t]*\{\\displaystyle ?((?:[^{}\n]|\{(?:[^{}\n]|\{[^{}\n]*\})*\})*)\}\s*/g;
const plainTex = (tex) => String(tex).replace(/\\(?:mathrm|text|mathbf|mathit|operatorname|displaystyle)\b\s*/g, '').replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}_^\\]/g, '').replace(/\s+/g, ' ').trim();
/** a plain-text extract with each formula column put back into its sentence (text without a formula comes back as it was) */
export function flatMath(s) {
  const t = String(s == null ? '' : s);
  if (!t.includes('{\\displaystyle')) return t;
  return t.replace(MATH_COL, (m, tex, off, all) => {
    const next = all.charAt(off + m.length), f = plainTex(tex);
    if (!next || /[\p{Lu}"“]/u.test(next)) return (f ? ' ' + f : '') + '\n';   // the formula ended the sentence: a new paragraph goes on
    return (f ? ' ' + f : '') + (/[\p{L}\p{N}(]/u.test(next) ? ' ' : '');
  });
}

/** class nouns of an article whose subject is a character or a person-like being (he / she, not it) */
export const PERSONA = new Set(['superhero', 'superheroine', 'supervillain', 'villain', 'character', 'protagonist', 'antagonist', 'hero', 'heroine', 'mascot',
  'wizard', 'witch', 'detective', 'vigilante', 'mutant', 'princess', 'prince', 'king', 'queen', 'emperor', 'empress', 'general', 'pharaoh', 'god', 'goddess',
  'deity', 'demigod', 'knight', 'pirate', 'spy', 'warrior', 'samurai', 'ninja', 'saint', 'prophet', 'president', 'monarch', 'ruler', 'statesman', 'politician']);

const decode = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** a list=search answer (srprop=snippet|redirecttitle) -> [{title, seen}], in Wikipedia's order */
export function searchHits(sr) {
  return ((sr && sr.query && sr.query.search) || []).filter((h) => h && typeof h.title === 'string' && h.title)
    .map((h) => ({ title: h.title, seen: [h.redirecttitle, decode(h.snippet)].filter(Boolean).join('. ').slice(0, 400) }));
}
/** the spelling Wikipedia's search suggests for a query (srinfo=suggestion), when it is another one */
export function searchSuggestion(sr, q) {
  const s = sr && sr.query && sr.query.searchinfo && sr.query.searchinfo.suggestion;
  return typeof s === 'string' && s.trim() && s.trim().toLowerCase() !== String(q || '').trim().toLowerCase() ? s.trim().slice(0, 80) : '';
}
