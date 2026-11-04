// quickmath.js - v4 (voice mode, Josh's phone Nov 2: "How many minutes are in three and a half hours" -> "That is one hundred eighty
// minutes"): simple number and unit questions worked out in code before Juli answers, so a spoken number is never a guess. Pure (no DOM,
// no engine; node-tested). quickMath(text) -> { expr, value, note } when the whole question is one it knows, else null:
//   unit conversions  "how many minutes are in three and a half hours", "what is 5 km in miles", "convert 2 pounds to kilograms",
//                     "an hour and a half in minutes", "half an hour in seconds", "100 degrees fahrenheit in celsius"
//   arithmetic        "what is 12 times 7", "144 divided by 12", "15 percent of 80", "half of 30", "9 squared"
// Units: time (second .. week), length (millimetre .. mile), weight (gram .. pound, stone), volume (millilitre, litre, US cup, US gallon),
// temperature (C, F, K). Anything else (months, money, dates, a word it does not know as a number) -> null: Juli answers as before.

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, a: 1, an: 1 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1e3, million: 1e6 };
const FRAC = { half: 0.5, quarter: 0.25, third: 1 / 3 };
const U = {};   // name -> { dim, f (to the base unit) }
const unit = (dim, f, ...names) => { for (const n of names) U[n] = { dim, f, name: names[0] }; };
unit('time', 1, 'second', 'seconds', 'sec', 'secs', 's'); unit('time', 60, 'minute', 'minutes', 'min', 'mins'); unit('time', 3600, 'hour', 'hours', 'hr', 'hrs', 'h');
unit('time', 86400, 'day', 'days'); unit('time', 604800, 'week', 'weeks');
unit('length', 0.001, 'millimetre', 'millimetres', 'millimeter', 'millimeters', 'mm'); unit('length', 0.01, 'centimetre', 'centimetres', 'centimeter', 'centimeters', 'cm');
unit('length', 1, 'metre', 'metres', 'meter', 'meters', 'm'); unit('length', 1000, 'kilometre', 'kilometres', 'kilometer', 'kilometers', 'km');
unit('length', 0.0254, 'inch', 'inches', 'in'); unit('length', 0.3048, 'foot', 'feet', 'ft'); unit('length', 0.9144, 'yard', 'yards', 'yd'); unit('length', 1609.344, 'mile', 'miles', 'mi');
unit('weight', 0.001, 'gram', 'grams', 'g'); unit('weight', 1, 'kilogram', 'kilograms', 'kilo', 'kilos', 'kg'); unit('weight', 0.028349523125, 'ounce', 'ounces', 'oz');
unit('weight', 0.45359237, 'pound', 'pounds', 'lb', 'lbs'); unit('weight', 6.35029318, 'stone', 'stones');
unit('volume', 0.001, 'millilitre', 'millilitres', 'milliliter', 'milliliters', 'ml'); unit('volume', 1, 'litre', 'litres', 'liter', 'liters', 'l');
unit('volume', 0.2365882365, 'cup', 'cups'); unit('volume', 3.785411784, 'gallon', 'gallons');
const TEMP = { celsius: 'C', centigrade: 'C', c: 'C', fahrenheit: 'F', f: 'F', kelvin: 'K', k: 'K' };
const AMBIG = new Set(['s', 'h', 'm', 'in', 'l', 'g', 'c', 'f', 'k', 'mi']);   // short names only after a number, never as "how many <unit>"

/** "three and a half" / "1,250" / "2.5" / "twenty-one" / "a quarter" at words[i] -> { v, n (words used) } or null */
export function readNumber(words, i) {
  const w0 = words[i];
  if (w0 == null) return null;
  if (/^\d[\d,]*(?:\.\d+)?$/.test(w0) && !/,\d{0,2}$|,\d{4,}/.test(w0)) {
    let v = parseFloat(w0.replace(/,/g, '')), n = 1;
    const f = fracAfter(words, i + 1); if (f) { v += f.v; n += f.n; }
    return { v, n };
  }
  if (FRAC[w0] && (words[i - 1] === 'a' || words[i - 1] === 'an')) return null;   // read with its "a"
  if ((w0 === 'a' || w0 === 'an' || w0 === 'one') && FRAC[words[i + 1]] && words[i + 2] !== 'of') return { v: FRAC[words[i + 1]], n: 2 };   // "a half", "a quarter"
  if (w0 === 'half' && words[i + 1] !== 'of') return { v: 0.5, n: 1 };
  let total = 0, cur = 0, n = 0, any = false;
  for (let j = i; j < words.length; j++) {
    const w = words[j];
    if (w in ONES && !(any && (w === 'a' || w === 'an'))) {
      if ((w === 'a' || w === 'an') && !(words[j + 1] in SCALE)) { if (!any) { cur = 1; any = true; n = j - i + 1; } break; }
      cur += ONES[w]; any = true; n = j - i + 1;
    } else if (w in TENS) { cur += TENS[w]; any = true; n = j - i + 1; }
    else if (w in SCALE && any) { if (SCALE[w] === 100) cur *= 100; else { total += cur * SCALE[w]; cur = 0; } n = j - i + 1; }
    else if (w === 'and' && any && (words[j + 1] in ONES || words[j + 1] in TENS) && !(words[j + 1] === 'a' || words[j + 1] === 'an')) continue;
    else break;
  }
  if (!any) return null;
  let v = total + cur;
  const f = fracAfter(words, i + n); if (f) { v += f.v; n += f.n; }
  return { v, n };
}
/** "and a half" / "and a quarter" / "and three quarters" after a number -> { v, n } */
function fracAfter(words, i) {
  if (words[i] !== 'and') return null;
  if ((words[i + 1] === 'a' || words[i + 1] === 'an') && FRAC[words[i + 2]]) return { v: FRAC[words[i + 2]], n: 3 };
  if (words[i + 1] === 'three' && (words[i + 2] === 'quarters' || words[i + 2] === 'quarter')) return { v: 0.75, n: 3 };
  return null;
}
const fmt = (v) => {
  if (!Number.isFinite(v)) return null;
  const r = Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
  return r.toLocaleString('en-US', { maximumFractionDigits: 4 });
};
const words = (t) => String(t || '').toLowerCase().replace(/[’']/g, "'").replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d)\s*(km|cm|mm|kg|lbs?|oz|ml|ft|mi|hrs?|mins?|secs?)\b/g, '$1 $2')
  .replace(/[?!.,;:]+(?=\s|$)/g, ' ').replace(/-/g, ' ').replace(/\bwhat's\b/g, 'what is').split(/\s+/).filter(Boolean);
/** a quantity "<number> <unit> [and a half]" or "half an <unit>" / "an hour and a half" at words[i] -> { v, u, n } */
function quantity(ws, i) {
  if (ws[i] === 'half' && (ws[i + 1] === 'an' || ws[i + 1] === 'a') && U[ws[i + 2]] && !AMBIG.has(ws[i + 2])) return { v: 0.5, u: U[ws[i + 2]], n: 3 };
  const num = readNumber(ws, i); if (!num) return null;
  const uw = ws[i + num.n], u = U[uw]; if (!u) return null;
  let v = num.v, n = num.n + 1;
  const f = fracAfter(ws, i + n); if (f) { v += f.v; n += f.n; }   // "an hour and a half"
  return { v, u, n };
}
function temp(ws, i) {   // "<number> degrees fahrenheit" / "<number> f"
  const num = readNumber(ws, i); if (!num) return null;
  let j = i + num.n; if (ws[j] === 'degrees' || ws[j] === 'degree') j++;
  const t = TEMP[ws[j]]; return t ? { v: num.v, t, n: j + 1 - i } : null;
}
const toC = (v, t) => (t === 'C' ? v : t === 'F' ? (v - 32) * 5 / 9 : v - 273.15), fromC = (c, t) => (t === 'C' ? c : t === 'F' ? c * 9 / 5 + 32 : c + 273.15);
const TNAME = { C: 'degrees Celsius', F: 'degrees Fahrenheit', K: 'kelvin' };
const LEAD = new Set(['what', 'is', 'are', 'how', 'much', 'many', 'please', 'juli', 'hey', 'hi', 'ok', 'okay', 'so', 'can', 'you', 'tell', 'me', 'calculate', 'work', 'out', 'convert', 'whats', 'do', 'i', 'get', 'if', 'the', 'answer', 'to', 'quick', 'question']);
const note = (expr) => `Worked out exactly in code (use this result; say the numbers in words): ${expr}.`;
const done = (expr, value) => ({ expr, value, note: note(expr) });

export function quickMath(text) {
  const ws = words(text); if (!ws.length || ws.length > 24) return null;
  let i = 0; while (i < ws.length && LEAD.has(ws[i]) && !(ws[i] === 'a' || ws[i] === 'an')) i++;
  const all = ws.join(' ');
  // "how many <unit> (are|is) (there) in <quantity>"
  const hm = all.indexOf('how many ');
  if (hm >= 0) {
    const k = all.slice(0, hm).split(' ').filter(Boolean).length + 2, u1 = U[ws[k]];
    if (u1 && !AMBIG.has(ws[k])) {
      let j = k + 1; while (['are', 'is', 'there', 'in', 'make', 'makes', 'does', 'it', 'take', 'to'].includes(ws[j])) { if (ws[j] === 'in' || ws[j] === 'make' || ws[j] === 'makes') { j++; break; } j++; }
      const q = quantity(ws, j);
      if (q && q.u.dim === u1.dim && j + q.n >= ws.length - 1) return done(`${fmt(q.v)} ${q.u.name}${q.v === 1 ? '' : 's'} = ${fmt(q.v * q.u.f / u1.f)} ${u1.name}${q.v * q.u.f / u1.f === 1 ? '' : 's'}`, q.v * q.u.f / u1.f);
    }
    return null;
  }
  // "<quantity> in|to|into <unit>" (what is / convert ...)
  const q = quantity(ws, i);
  if (q && ['in', 'to', 'into', 'as'].includes(ws[i + q.n])) {
    const uw = ws[i + q.n + 1] === 'how' ? null : ws[i + q.n + 1], u2 = U[uw];
    if (u2 && u2.dim === q.u.dim && i + q.n + 2 >= ws.length) { const v = q.v * q.u.f / u2.f; return done(`${fmt(q.v)} ${q.u.name}${q.v === 1 ? '' : 's'} = ${fmt(v)} ${u2.name}${v === 1 ? '' : 's'}`, v); }
    return null;
  }
  const tq = temp(ws, i);
  if (tq && ['in', 'to', 'into', 'as'].includes(ws[i + tq.n])) {
    let j = i + tq.n + 1; if (ws[j] === 'degrees') j++;
    const t2 = TEMP[ws[j]];
    if (t2 && t2 !== tq.t && j + 1 >= ws.length) { const v = fromC(toC(tq.v, tq.t), t2); return done(`${fmt(tq.v)} ${TNAME[tq.t]} = ${fmt(v)} ${TNAME[t2]}`, v); }
    return null;
  }
  // arithmetic: "<n> plus|minus|times|divided by <n>", "<n> percent of <n>", "half of <n>", "<n> squared"
  const a = readNumber(ws, i);
  if (a) {
    let j = i + a.n; const op = ws[j], b = (k) => readNumber(ws, k), end = (k, n) => k + n >= ws.length;
    if (op === 'squared' && end(j, 1)) return done(`${fmt(a.v)} squared = ${fmt(a.v * a.v)}`, a.v * a.v);
    if (op === 'cubed' && end(j, 1)) return done(`${fmt(a.v)} cubed = ${fmt(a.v ** 3)}`, a.v ** 3);
    if ((op === 'percent' || op === '%') && ws[j + 1] === 'of') { const c = b(j + 2); if (c && end(j + 2, c.n)) return done(`${fmt(a.v)} percent of ${fmt(c.v)} = ${fmt(a.v * c.v / 100)}`, a.v * c.v / 100); }
    const OPS = { plus: '+', add: '+', minus: '-', less: '-', times: '×', x: '×', '*': '×', '+': '+', '-': '-', '/': '÷', over: '÷' };
    let o = OPS[op], k = j + 1;
    if (!o && op === 'multiplied' && ws[j + 1] === 'by') { o = '×'; k = j + 2; }
    if (!o && op === 'divided' && ws[j + 1] === 'by') { o = '÷'; k = j + 2; }
    if (o) {
      const c = b(k);
      if (c && end(k, c.n) && !(o === '÷' && c.v === 0)) { const v = o === '+' ? a.v + c.v : o === '-' ? a.v - c.v : o === '×' ? a.v * c.v : a.v / c.v; return done(`${fmt(a.v)} ${o} ${fmt(c.v)} = ${fmt(v)}`, v); }
    }
  }
  const FR = { half: 0.5, quarter: 0.25, third: 1 / 3, double: 2, twice: 2, triple: 3 };
  if (FR[ws[i]] || ((ws[i] === 'a' || ws[i] === 'one') && FR[ws[i + 1]])) {
    const k0 = FR[ws[i]] ? i : i + 1, f = FR[ws[k0]], k = ws[k0 + 1] === 'of' ? k0 + 2 : k0 + 1, c = readNumber(ws, k);
    if (c && k + c.n >= ws.length && (f >= 2 || ws[k0 + 1] === 'of')) return done(`${ws[k0]}${ws[k0 + 1] === 'of' ? ' of' : ''} ${fmt(c.v)} = ${fmt(f * c.v)}`, f * c.v);
  }
  return null;
}
