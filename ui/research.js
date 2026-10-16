// research.js (ui) - p0pc0rn v026.2: the research list (Josh, Oct 14: he wants to see what the research was and the grounding
// on the finished song bubble).
//   One row per topic: a status icon (queued / searching / found / found on this phone / not found / skipped), the topic, LOCAL or WEB,
//   the source (Wikipedia / Fandom article) as a link, the reason for a miss or a skip; under a found topic the quotes the lyrics used
//   ('According to Wikipedia: "..."'), else the quotes it kept.
//   researchList(rows, {live}) -> an element: live = the plain list (while the turn runs); else a collapsed "🔎 grounded on N sources" /
//   "research found nothing · N missed" / "no research: <why>" that opens to the same list. lyricMarks(lyrics, rows) -> per line, the
//   looked-up fact it uses (or ''). Pure DOM; rows are data the agent wrote (rendered as text, links only http(s)).
'use strict';

const ICON = { queued: ['·', 'queued'], searching: ['⏳', 'searching'], found: ['✓', 'found'], miss: ['✗', 'not found'], skipped: ['–', 'skipped'] };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (text, term) => { const t = String(term || '').trim(); return t.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(t)}`, 'iu').test(String(text || '')); };

/** the quotes of a found row that carry a fact the lyrics used (all its quotes when the writer reported none) */
export function usedQuotes(row) {
  const qs = (row && row.quotes) || [], used = (row && row.used) || [];
  if (!used.length) return { quotes: qs.slice(0, 3), used: false };
  const hit = qs.filter((q) => used.some((u) => hasTerm(q, u)));
  return { quotes: (hit.length ? hit : qs).slice(0, 5), used: hit.length > 0 };
}
/** lyrics -> per line, the first looked-up fact (from the rows' `used`) it sings, or '' */
export function lyricMarks(lyrics, rows) {
  const used = [];
  for (const r of rows || []) if (r && r.status === 'found') for (const u of r.used || []) used.push(u);
  return String(lyrics || '').split('\n').map((ln) => (/^\s*\[/.test(ln) ? '' : used.find((u) => hasTerm(ln, u)) || ''));
}
function rowEl(r) {
  const li = el('li', `rl rl-${r.status || 'queued'}`);
  const [ic, label] = r.status === 'found' && (r.local || r.cached) ? ['↺', r.local ? 'found on this phone' : 'found in the cache'] : ICON[r.status] || ['·', r.status || ''];
  const icon = el('span', 'rl-ic', ic); icon.title = label; icon.setAttribute('aria-label', label);
  const top = el('span', 'rl-top', r.topic);
  li.append(icon, top);
  if (r.status === 'found') {
    li.append(el('span', `rl-ori ${r.origin === 'local' ? 'loc' : 'web'}`, r.origin === 'local' ? 'LOCAL' : 'WEB'));
    const where = [r.site, r.title].filter(Boolean).join(' · ') + (r.asOf ? ` · ${r.asOf}` : '');
    if (r.url && /^https?:\/\//i.test(r.url)) { const a = el('a', 'rl-src', where); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); }
    else li.append(el('span', 'rl-src', where));
    const uq = usedQuotes(r);
    if (uq.quotes.length) {
      const ul = el('ul', 'rl-quotes');
      if (uq.used) ul.append(el('li', 'rl-qhead', `The lyrics use: ${(r.used || []).join(', ')}`));
      for (const q of uq.quotes) {   // v026.4: every quote keeps its article link (CC BY-SA attribution)
        const li = el('li', 'rl-q', `According to ${r.site || 'the source'}: “${String(q).slice(0, 240)}” `);
        if (r.url && /^https?:\/\//i.test(r.url)) { const a = el('a', 'rl-qsrc', r.title || 'the article'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); }
        ul.append(li);
      }
      li.append(ul);
    }
  } else if (r.reason && (r.status === 'miss' || r.status === 'skipped')) li.append(el('span', 'rl-why', r.reason));
  return li;
}
/** rows -> the list (live) or the collapsed summary that opens to it; null when there is nothing to show */
export function researchList(rows, { live = false } = {}) {
  const rs = (rows || []).filter((r) => r && r.topic);
  if (!rs.length) return null;
  const list = el('ul', 'rlist');
  const ord = live ? rs.filter((r) => r.status === 'searching').concat(rs.filter((r) => r.status !== 'searching')) : rs;
  for (const r of ord) list.append(rowEl(r));
  if (live) { const box = el('div', 'rl-box'); box.append(list); return box; }
  const nf = rs.filter((r) => r.status === 'found').length, nm = rs.filter((r) => r.status === 'miss').length;
  const nl = rs.filter((r) => r.status === 'found' && r.origin === 'local').length, sk = rs.filter((r) => r.status === 'skipped');
  const sum = nf ? `grounded on ${nf} source${nf === 1 ? '' : 's'}${nl ? ` (${nl === nf ? 'all' : nl} on this phone)` : ''}`
    : sk.length && !nm ? `no research: ${sk[0].reason || 'skipped'}` : 'research found nothing';
  const d = el('details', 'rl-sum');
  const s = el('summary', null, `🔎 ${sum}${nm ? ` · ${nm} missed` : ''}`);
  d.append(s, list);
  return d;
}
/** lyrics as lines, the ones that sing a looked-up fact marked (title = the fact) */
export function lyricsEl(lyrics, rows, cls = 'msg-text footnote') {
  const p = el('p', `${cls} lyr-lines`), marks = lyricMarks(lyrics, rows), lines = String(lyrics || '').split('\n');
  lines.forEach((ln, i) => {
    const span = el('span', marks[i] ? 'lyr-line lyr-fact' : 'lyr-line', ln);
    if (marks[i]) span.title = `Sings a looked-up fact: ${marks[i]}`;
    p.append(span); if (i < lines.length - 1) p.append(document.createElement('br'));
  });
  return p;
}
