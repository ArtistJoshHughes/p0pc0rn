// weather.js - v4 (weather in chat; Josh, Nov 2: "National weather service, because the model we are going to use is US CONUS"): a
// weather question -> where (a ZIP code, a US city and state, the home ZIP, or the phone's location when it is already allowed) -> a
// forecast from a weather source -> facts for Juli's note (agent.js, as quickmath.js does). Outside the US, or a place not in the list:
// she says the forecasts cover the US for now, and never makes weather up. Two places of the same name: she asks which one.
// Sources share one interface, forecast(lat, lon, o) -> facts | { outside } (createWeather): the US National Weather Service today
// (api.weather.gov, public domain); a nowcast source for the next 90 minutes (the Nowcast's DGMR, CONUS) can sit beside it. Only the
// coordinates, rounded to 0.01 degree (about 1 km), go to a source: never the place's name or the ZIP.
import { STATES, normName, stateOf } from './places.js';
import { neutralise } from './gemma4.js';   // 4.0 (review): NWS text never carries the chat template's control tokens

// ---------------------------------------------------------------------------------------------------------------- the question
const WX = /\b(?:weather|forecast)\b/i;
const WX_IT = /\b(?:will|is|does|did|gonna|going to)\s+it\b[^.?!]{0,25}?\b(?:rain|snow|storm|thunder|hail|sleet|freez|frost|sunny|cloudy|windy|be (?:hot|cold|warm|nice))\w*/i;
const WX_CHANCE = /\bchance of (?:rain|snow|storms?|showers)\b/i;
const WX_HOW = /\bhow (?:hot|cold|warm|chilly|windy|wet) (?:is it|will it be|is it going to be|it is|it will be|it'?s)\b/i;
const WX_TEMP = /\b(?:temperature|temp)\b[^.?!]{0,30}\b(?:outside|out there|today|tonight|tomorrow|this (?:morning|afternoon|evening|week|weekend)|in [A-Za-z]|in \d)/i;
const WX_KIT = /\b(?:do|should) i (?:need|take|bring|wear) (?:an? )?(?:umbrella|raincoat|rain jacket|jacket|coat)\b/i;
/** a weather question -> { when, zip, place: { city, st, country } | null } or null (not about the weather) */
export function weatherAsk(text) {
  const t = String(text || '');
  if (!(WX.test(t) || WX_IT.test(t) || WX_CHANCE.test(t) || WX_HOW.test(t) || WX_TEMP.test(t) || WX_KIT.test(t))) return null;
  if (/\b(?:song|poem|story|picture|photo|clip|video|lyrics|painting)\b/i.test(t)) return null;   // something to make about the weather
  const zip = zipOf(t);
  return { when: whenOf(t), zip, place: zip ? null : placeOf(t) };
}
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function whenOf(t) {
  const s = String(t).toLowerCase();
  if (/\b(?:right now|now|currently|at the moment|this hour|outside right)\b/.test(s)) return 'now';
  if (/\btonight\b|\bthis evening\b/.test(s)) return 'tonight';
  if (/\btomorrow\b/.test(s)) return 'tomorrow';
  if (/\bweekend\b/.test(s)) return 'weekend';
  const d = DAYS.find((x) => new RegExp('\\b' + x + '\\b').test(s)); if (d) return 'day:' + d;
  if (/\btoday\b|\bthis (?:morning|afternoon)\b/.test(s)) return 'today';
  if (/\b(?:this|next) week\b/.test(s)) return 'week';
  return null;
}
const DIGIT = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
/** a 5-digit ZIP code, typed ("10001", "10001-1234") or spelled out by the recogniser ("one zero zero zero one", "1 0 0 0 1") */
export function zipOf(t) {
  const s = String(t || '');
  const m = /(?:^|[^\d.,$])(\d{5})(?:-\d{4})?(?![\d.,])/.exec(s); if (m) return m[1];
  const w = s.toLowerCase().replace(/[,.;:!?()-]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i + 5 <= w.length; i++) {
    let k = i; const d = [];
    while (k < w.length && (w[k] in DIGIT || /^\d$/.test(w[k])) && d.length < 9) { d.push(w[k] in DIGIT ? DIGIT[w[k]] : +w[k]); k++; }
    if ((d.length === 5 || d.length === 9) && !(w[i] === 'o' && d.length === 5 && !/zip/.test(s.toLowerCase()))) return d.slice(0, 5).join('');
    if (d.length) i = k - 1;
  }
  return null;
}
// a place outside the US: countries and the world's best-known cities whose name a small US town shares (Paris, Texas): without a US
// state they mean the city abroad (and Juli says a US one needs its state)
const COUNTRIES = new Set(['canada', 'mexico', 'france', 'spain', 'portugal', 'italy', 'germany', 'austria', 'switzerland', 'netherlands', 'holland', 'belgium',
  'ireland', 'scotland', 'england', 'wales', 'uk', 'united kingdom', 'britain', 'great britain', 'denmark', 'norway', 'sweden', 'finland', 'iceland', 'poland',
  'czechia', 'czech republic', 'greece', 'turkey', 'russia', 'ukraine', 'israel', 'egypt', 'morocco', 'south africa', 'kenya', 'nigeria', 'india', 'pakistan',
  'china', 'japan', 'korea', 'south korea', 'taiwan', 'vietnam', 'thailand', 'philippines', 'indonesia', 'singapore', 'malaysia', 'australia', 'new zealand',
  'brazil', 'argentina', 'chile', 'peru', 'colombia', 'cuba', 'jamaica', 'bahamas', 'dominican republic', 'costa rica', 'europe', 'asia', 'africa', 'uae', 'dubai',
  'saudi arabia', 'qatar', 'iran', 'iraq', 'hungary', 'romania', 'croatia', 'serbia', 'bulgaria']);
const WORLD = new Set(['paris', 'london', 'rome', 'berlin', 'madrid', 'barcelona', 'lisbon', 'dublin', 'amsterdam', 'brussels', 'vienna', 'prague', 'warsaw', 'budapest',
  'athens', 'moscow', 'oslo', 'stockholm', 'copenhagen', 'helsinki', 'edinburgh', 'glasgow', 'venice', 'florence', 'milan', 'naples', 'munich', 'zurich', 'geneva',
  'istanbul', 'cairo', 'jerusalem', 'tokyo', 'kyoto', 'osaka', 'beijing', 'shanghai', 'hong kong', 'seoul', 'bangkok', 'delhi', 'new delhi', 'mumbai', 'sydney',
  'melbourne', 'auckland', 'toronto', 'montreal', 'vancouver', 'quebec', 'ottawa', 'calgary', 'mexico city', 'cancun', 'havana', 'rio', 'rio de janeiro',
  'buenos aires', 'lima', 'bogota', 'cape town', 'nairobi', 'dubai', 'singapore', 'manila', 'jakarta', 'bali', 'marrakech', 'reykjavik', 'manchester', 'liverpool']);
// names people say for a big US city
const ALIAS = { 'nyc': ['New York', 'NY'], 'new york city': ['New York', 'NY'], 'manhattan': ['New York', 'NY'], 'brooklyn': ['New York', 'NY'], 'la': ['Los Angeles', 'CA'],
  'sf': ['San Francisco', 'CA'], 'san fran': ['San Francisco', 'CA'], 'philly': ['Philadelphia', 'PA'], 'vegas': ['Las Vegas', 'NV'], 'dc': ['Washington', 'DC'],
  'washington dc': ['Washington', 'DC'], 'nola': ['New Orleans', 'LA'], 'the bay area': ['San Francisco', 'CA'], 'the twin cities': ['Minneapolis', 'MN'] };
const STOP = new Set(['this', 'that', 'today', 'tonight', 'tomorrow', 'now', 'right', 'on', 'over', 'next', 'later', 'for', 'during', 'please', 'like', 'going', 'be',
  'will', 'is', 'are', 'and', 'or', 'but', 'so', 'then', 'at', 'in', 'around', 'near', 'by', 'when', 'if', 'the weekend', 'weekend', 'week', 'morning', 'afternoon',
  'evening', 'tonite', 'currently', 'yet', 'too', 'also', 'look', 'looking', 'gonna', 'supposed', 'expected', 'gets', 'get', 'with', 'from', 'to', 'all', 'day',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'until', 'before', 'after', 'about', 'any', 'zip']);
const NOT_PLACE = /^(?:the [a-z]|my |our |your |here\b|home\b|this |that |an? [a-z]|\d)/;   // "at the game", "in my area", "in an hour" ("in The Woodlands" is a place)
/** where the question names: "in Portland, Oregon", "for Austin TX", "Seattle weather" -> { city, st, country } or null */
export function placeOf(t) {
  const s = String(t || '').replace(/[“”"]/g, '');
  let cand = null;
  const toks = s.split(/\s+/);
  for (let i = 0; i < toks.length; i++) {   // after each in / for / at / near: the words up to a time word (the last one that is a place wins)
    if (!/^(?:in|for|at|near|around|over)$/i.test(toks[i])) continue;
    const keep = [];
    for (let k = i + 1; k < toks.length && keep.length < 5; k++) {
      const w = toks[k], b = w.replace(/[,.?!]+$/, '').toLowerCase();
      if (!/^[A-Za-z]/.test(w) || STOP.has(b) || DAYS.includes(b)) break;
      keep.push(w); if (/[?!]$/.test(w) || (/[.]$/.test(w) && !/^(?:st|ft|mt|[a-z])[.]$/i.test(w))) break;   // "St. Louis" goes on
    }
    const c = keep.join(' ').replace(/[.?!,]+$/, '').trim();
    if (c && (ALIAS[normName(c)] || !(NOT_PLACE.test(c.replace(/^(?:The|My|Our|Your|This|That|An?|Here|Home)\b/, (x) => x.toLowerCase())) || /^(?:the|an?|my|our|your|this|that|here|home)$/i.test(c)))) cand = c;
  }
  if (!cand) { const m = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:['’]s)?\s+(?:weather|forecast)\b/.exec(s); if (m && !/^(?:What|How|Hey|Hi|Is|The|Will|Tell|Whats|Today|Tomorrow|Tonight|Juli)$/.test(m[1].split(' ')[0])) cand = m[1]; }
  if (!cand) return null;
  return splitPlace(cand);
}
/** "Portland, Oregon" / "Portland OR" / "Paris France" / "Oregon" -> { city, st, country } */
export function splitPlace(cand) {
  const raw = String(cand).trim(), n = normName(raw);
  if (ALIAS[n]) return { city: ALIAS[n][0], st: ALIAS[n][1], country: null };
  if (COUNTRIES.has(n)) return { city: null, st: null, country: raw };
  const st0 = stateOf(raw);
  if (st0 && raw.length > 2) return { city: null, st: st0, country: null };   // a state alone ("Oregon")
  const parts = raw.split(/\s*,\s*/);
  if (parts.length > 1) {   // "City, State" / "City, Country"
    const tail = parts[parts.length - 1], city = parts.slice(0, -1).join(' '), tn = normName(tail);
    if (COUNTRIES.has(tn)) return { city, st: null, country: tail };
    const st = stateOf(tail); if (st) return { city, st, country: null };
  }
  const w = raw.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  for (let k = Math.min(3, w.length - 1); k >= 1; k--) {   // "City State" (the state's name, or its code in capitals: "Austin TX")
    const tail = w.slice(-k).join(' '), city = w.slice(0, -k).join(' '), tn = normName(tail);
    if (COUNTRIES.has(tn)) return { city, st: null, country: tail };
    const st = stateOf(tail);
    if (st && (tail.length > 2 || /^[A-Z]{2}$/.test(tail))) return { city, st, country: null };
  }
  return { city: raw.replace(/,/g, ''), st: null, country: null };
}

// ---------------------------------------------------------------------------------------------------------------- where
const label = (e) => `${e.name}, ${STATES[e.st] || e.st}`;
const okOf = (e, picked = false) => ({ kind: 'ok', lat: e.lat, lon: e.lon, label: label(e), short: e.name, via: 'place', picked });
/** ask + geo (places.js loadGeo) -> { kind: 'ok', lat, lon, label, short, via, picked } | { kind: 'ambiguous', name, options } |
 *  { kind: 'outside', name, us } | { kind: 'notfound', name } | { kind: 'nozip', zip } | { kind: 'state', st } | { kind: 'none' } */
export function resolvePlace(ask, geo) {
  if (!ask) return { kind: 'none' };
  if (ask.zip) { const z = geo.zcta.find(ask.zip); return z ? { kind: 'ok', lat: z.lat, lon: z.lon, label: `ZIP ${z.zip}`, short: `ZIP ${z.zip}`, via: 'zip' } : { kind: 'nozip', zip: ask.zip }; }
  const p = ask.place; if (!p) return { kind: 'none' };
  if (p.country) return { kind: 'outside', name: [p.city, p.country].filter(Boolean).join(', '), us: [] };
  const all = p.city ? geo.places.get(normName(p.city)) || [] : [];
  if (!p.city) {   // a state alone: its big city of the same name ("New York"), else which city in it
    const same = (geo.places.get(normName(STATES[p.st] || '')) || []).filter((e) => e.st === p.st && e.w >= 100);
    return same.length ? okOf(same[0]) : { kind: 'state', st: p.st };
  }
  if (p.st) {
    const l = all.filter((e) => e.st === p.st).sort((a, b) => b.w - a.w);
    return l.length ? okOf(l[0]) : { kind: 'notfound', name: `${p.city}, ${STATES[p.st]}` };
  }
  const s = all.slice().sort((a, b) => b.w - a.w);
  if (WORLD.has(normName(p.city))) return { kind: 'outside', name: p.city, us: s.slice(0, 2).map(label) };
  if (!s.length) return { kind: 'notfound', name: p.city };
  if (s.length === 1) return okOf(s[0]);
  if (s[0].w >= 50 && s[0].w >= 6 * Math.max(1, s[1].w)) return okOf(s[0], true);   // one far bigger than the rest (Austin: Texas), said with its state
  return { kind: 'ambiguous', name: p.city, options: s.slice(0, 4).map(label) };
}

// ---------------------------------------------------------------------------------------------------------------- the sources
const r2 = (v) => Math.round(+v * 100) / 100;
const str = (v, n) => (v == null ? '' : neutralise(String(v))).slice(0, n);   // 4.0 (review): untrusted text from the network
const NWS = 'https://api.weather.gov/';
export const NWS_CREDIT = 'Forecast: US National Weather Service (weather.gov)';
async function defaultFetchJSON(url, { signal } = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/geo+json' }, signal });
  if (r.status === 404) return { status: 404 };
  if (!r.ok) throw Object.assign(new Error('the weather service answered ' + r.status), { code: 'WEATHER_HTTP' });
  return r.json();
}
/** the US National Weather Service: /points/{lat},{lon}, then its forecast (and its hourly forecast when asked) and the active alerts
 *  for the point -> { source, name, credit, place, periods (14: a week of day and night), hourly (3), alerts (3), updated, ms } or { outside: true } (no NWS
 *  forecast there: outside the US) */
export function nwsSource({ fetchJSON = defaultFetchJSON, now = () => Date.now() } = {}) {
  return { id: 'nws', name: 'US National Weather Service', credit: NWS_CREDIT,
    async forecast(lat, lon, { hourly = false, signal } = {}) {
      const t0 = now(), la = r2(lat), lo = r2(lon);
      const pt = await fetchJSON(`${NWS}points/${la},${lo}`, { signal }), P = pt && pt.properties;
      const fu = P && P.forecast, hu = P && P.forecastHourly, ok = (u) => typeof u === 'string' && u.startsWith(NWS);
      if (!ok(fu)) return { outside: true, ms: now() - t0 };
      const [fc, al, hr] = await Promise.all([fetchJSON(fu, { signal }), fetchJSON(`${NWS}alerts/active?point=${la},${lo}`, { signal }).catch(() => null),
        hourly && ok(hu) ? fetchJSON(hu, { signal }).catch(() => null) : null]);
      const per = ((fc && fc.properties && fc.properties.periods) || []).slice(0, 14).map((x) => ({ name: str(x.name, 30), start: str(x.startTime, 30), day: !!x.isDaytime,
        temp: +x.temperature, unit: str(x.temperatureUnit, 2), short: str(x.shortForecast, 80), wind: [str(x.windDirection, 4), str(x.windSpeed, 20)].filter(Boolean).join(' '),
        pop: x.probabilityOfPrecipitation && x.probabilityOfPrecipitation.value != null ? +x.probabilityOfPrecipitation.value : null }));
      if (!per.length) throw Object.assign(new Error('the weather service sent no forecast'), { code: 'WEATHER_EMPTY' });
      const loc = (P.relativeLocation && P.relativeLocation.properties) || {};
      return { source: 'nws', name: 'US National Weather Service', credit: NWS_CREDIT, place: str([loc.city, loc.state].filter(Boolean).join(', '), 60), periods: per,
        hourly: ((hr && hr.properties && hr.properties.periods) || []).slice(0, 3).map((x) => ({ start: str(x.startTime, 30), temp: +x.temperature, unit: str(x.temperatureUnit, 2), short: str(x.shortForecast, 60) })),
        alerts: ((al && al.features) || []).slice(0, 3).map((f) => { const x = f.properties || {}; return { event: str(x.event, 60), severity: str(x.severity, 20), headline: str(x.headline, 200), ends: str(x.ends || x.expires, 30) }; }),
        updated: str(fc.properties.updateTime || fc.properties.updated, 30), ms: Math.round(now() - t0) };
    } };
}
/** the weather sources behind one forecast(lat, lon, o): the first source that covers the point answers; each point's answer is kept
 *  ttlMs (30 min) -> { forecast(lat, lon, o) -> facts (+ cached) | { outside } , drop() } */
export function createWeather({ sources = null, ttlMs = 30 * 60e3, now = () => Date.now(), fetchJSON } = {}) {
  const src = sources || [nwsSource(fetchJSON ? { fetchJSON, now } : { now })], cache = new Map();
  return {
    sources: src,
    async forecast(lat, lon, o = {}) {
      const key = `${r2(lat)},${r2(lon)}`, c = cache.get(key), t = now();
      if (c && t - c.at < ttlMs && (!o.hourly || (c.v.hourly && c.v.hourly.length) || c.v.outside)) return Object.assign({}, c.v, { cached: true, ms: 0 });
      let v = { outside: true, ms: 0 };
      for (const s of src) { v = await s.forecast(lat, lon, o); if (!v.outside) break; }
      cache.set(key, { at: t, v }); for (const [k, x] of cache) if (t - x.at >= ttlMs) cache.delete(k);
      return Object.assign({}, v, { cached: false });
    },
    drop() { cache.clear(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------- Juli's note
const day = (iso) => String(iso || '').slice(0, 10);
const wday = (iso) => new Date(day(iso) + 'T12:00:00Z').getUTCDay();   // the period's own local date (its start carries its offset)
const plusDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** the 2-4 periods the question is about (tonight, tomorrow, the weekend, a day of the week; else the next two) */
export function pickPeriods(periods, when) {
  const P = periods || []; if (!P.length) return [];
  const by = (f, n) => { const l = P.filter(f).slice(0, n); return l.length ? l : P.slice(0, 2); };
  if (when === 'tonight') { const i = Math.max(0, P.findIndex((p) => !p.day || /tonight|overnight/i.test(p.name))); return P.slice(i, i + 2); }
  if (when === 'tomorrow') { const d1 = plusDays(day(P[0].start), 1); return by((p) => day(p.start) === d1, 2); }
  if (when === 'weekend') return by((p) => wday(p.start) === 6 || wday(p.start) === 0, 4);
  if (when && when.startsWith('day:')) { const d = DAYS.indexOf(when.slice(4)); return by((p) => wday(p.start) === d, 2); }
  if (when === 'week') return P.slice(0, 4);
  return P.slice(0, 2);
}
const deg = (p) => `${p.temp}°${p.unit || 'F'}`;
/** "Tuesday (tomorrow): 61°F, Partly Sunny, wind NNE 3 mph" (the model does not know today's date: tomorrow is said) */
const line = (p, d0) => `${p.name}${day(p.start) === plusDays(d0, 1) && !/tomorrow/i.test(p.name) ? ' (tomorrow)' : ''}: ${deg(p)}, ${p.short}${p.wind ? `, wind ${p.wind}` : ''}${p.pop != null && p.pop >= 20 ? `, ${p.pop}% chance of ${p.temp >= 38 || p.unit === 'C' && p.temp >= 3 ? 'rain' : 'snow or rain'}` : ''}`;
/** the short spoken form: "Tonight in Portland, 41 and light rain." */
export const spokenLine = (p, short) => `${p.name} in ${short}, ${p.temp} and ${String(p.short || '').toLowerCase()}.`;
const hhmm = (iso) => { const m = /T(\d\d):(\d\d)/.exec(String(iso || '')); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
const NO_GUESS = 'Do not guess or describe the weather yourself.';
const US_ONLY = '"My forecasts cover the US for now."';
/** the note Juli reads before she answers (on a spoken turn: with the short spoken form to say) */
export function weatherNote(ask, res, { voice = false } = {}) {
  const fc = res && res.fc;
  switch (res && res.kind) {
    case 'ok': {
      if (!fc || fc.outside) return `WEATHER: the US National Weather Service has no forecast for ${res.label}. Say ${US_ONLY} ${NO_GUESS}`;
      const ps = pickPeriods(fc.periods, ask && ask.when), now = ask && ask.when === 'now' && fc.hourly && fc.hourly[0], d0 = day(fc.periods[0].start);
      const L = [`WEATHER: the forecast below is live from the US National Weather Service, for ${res.label}, and it is what they asked about. Give it directly, as plain fact, from these lines only: never say you do not have live, real-time or future weather, and add nothing of your own.`];
      if (now) L.push(`- Now (${hhmm(now.start)}): ${now.temp}°${now.unit || 'F'}, ${now.short}`);
      for (const p of ps) L.push('- ' + line(p, d0));
      for (const a of fc.alerts || []) L.push(`- ALERT: ${a.event}${a.severity ? ` (${a.severity.toLowerCase()})` : ''}${a.headline ? ': ' + a.headline : ''}`);
      if (res.picked) L.push(`Start with the place's full name, "${res.label}", so they know which one: another US place called ${res.short} needs its state or a ZIP code.`);
      if ((fc.alerts || []).length) L.push('Mention the alert.');
      if (voice && ps[0]) L.push(`Say it short, the way a forecast is spoken, for example: "${spokenLine(now ? Object.assign({}, ps[0], { name: 'Right now', temp: now.temp, short: now.short }) : ps[0], res.via === 'place' || res.via === 'zip' ? res.short : 'your area')}"`);
      return L.join('\n');
    }
    case 'error': return `WEATHER: the US National Weather Service could not be reached just now. Say so, and that they can ask again in a moment. ${NO_GUESS}`;
    case 'outside': return `WEATHER: ${res.name} is outside the US. Say ${US_ONLY} ${NO_GUESS}${res.us && res.us.length ? ` If they meant ${res.us.join(' or ')}, they can say the state.` : ''}`;
    case 'notfound': return `WEATHER: no US city or town called "${res.name}" is in the place list. Say ${US_ONLY} and ask for the city and its state, or a ZIP code. ${NO_GUESS}`;
    case 'nozip': return `WEATHER: ${res.zip} is not a US ZIP code in the list. Ask them to check it, or for the city and its state. ${NO_GUESS}`;
    case 'ambiguous': return `WEATHER: several US places are called ${res.name}: ${res.options.join('; ')}. Ask which one they mean, or for a ZIP code, and give no weather yet. ${NO_GUESS}`;
    case 'state': return `WEATHER: they named ${STATES[res.st] || res.st} but no city. Ask which city or town there, or a ZIP code, and give no weather yet. ${NO_GUESS}`;
    case 'off': return `WEATHER: looking things up is off (Settings › Juli), so you cannot check the forecast. Say so. ${NO_GUESS}`;
    default: return `WEATHER: they did not say where. Ask which US city and state, or which ZIP code, and give no weather yet. They can also tell you their ZIP once ("my ZIP is 10001") and you will keep it on this phone. ${NO_GUESS}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------- the home ZIP
/** "my ZIP is 10001" / "my zip code is one zero zero zero one" / "set my home zip to 10001" -> the ZIP, or null */
export function zipSetAsk(text) {
  const t = String(text || '');
  if (!/\b(?:my|home|set)\b[^.?!]{0,30}\bzip\b/i.test(t) || /\?\s*$/.test(t.trim()) || weatherAsk(t)) return null;
  return zipOf(t.replace(/^[^]*?\bzip(?:\s*code)?\b/i, ' '));
}
// a yes or a no to "Save 10001 as your home ZIP?", typed or spoken ("Yes.", "Yeah, save it please", "Hey Juli, yes", "No thanks"): a yes
// word first, then nothing but more of the same; anything else is another message (the question lapses)
const ANSWER_WORDS = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'please', 'do', 'it', 'save', 'go', 'ahead', 'correct', 'right', 'thats', "that's", 'thanks',
  'thank', 'you', 'juli', 'hey', 'great', 'perfect', 'absolutely', 'definitely', 'of', 'course', 'sounds', 'good']);
const NO_WORDS = new Set(['no', 'nope', 'nah', 'dont', "don't", 'do', 'not', 'cancel', 'never', 'mind', 'nevermind', 'thanks', 'thank', 'you', 'juli', 'hey', 'please', 'save', 'it', 'that', 'skip']);
const answerWords = (t) => String(t || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
const lead = (w) => { let i = 0; while (i < w.length && (w[i] === 'hey' || w[i] === 'juli' || w[i] === 'ok' && w[i + 1] === 'juli')) i++; return w.slice(i); };
export const YES = { test(t) { const w = lead(answerWords(t)); return w.length > 0 && w.length <= 8 && ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'please', 'save', 'go', 'correct', 'absolutely', 'definitely', 'perfect', 'great'].includes(w[0]) && w.every((x) => ANSWER_WORDS.has(x)); } };
export const NO = { test(t) { const w = lead(answerWords(t)); return w.length > 0 && w.length <= 8 && ['no', 'nope', 'nah', 'dont', "don't", 'do', 'cancel', 'never', 'nevermind', 'skip'].includes(w[0]) && (w[0] !== 'do' || w[1] === 'not') && w.every((x) => NO_WORDS.has(x)); } };
/** v4 (Nov 2, the desk: "I do not have live weather information. The forecast for tomorrow is 60 degrees..."): her answer without a
 *  leading "I don't have live (real-time, future) weather" sentence or clause, when the forecast's facts were in her note -> { text, hold }
 *  (hold: the start is not a whole sentence yet and could still be one: show and speak nothing more until it is) */
const NOLIVE = /^(?:sorry,?\s+)?i\s+(?:do not|don't|cannot|can't|can not|am not able to|am unable to|have no)\b[^.!?]*\b(?:live|real-time|realtime|current|up-to-date|future|access|have (?:any )?(?:information|data|details))\b[^.!?]*\b(?:weather|forecasts?|information|data|conditions)\b/i;
export function dropNoLive(text, { final = false } = {}) {
  const t = String(text || ''), sp = /^\s*/.exec(t)[0], s = t.slice(sp.length);
  if (!/^(?:sorry\b|i\b)/i.test(s)) return { text: t, hold: !final && /^(?:s|so|sor|sorr|i)?$/i.test(s) };
  const m = /^(.*?)(?:[.!?]+(?=\s|$)|,\s*(?:but|however|though|yet)\b,?)\s*/s.exec(s);
  if (!m) return { text: final ? (NOLIVE.test(s) ? '' : t) : t, hold: !final && s.length < 200 };
  if (!NOLIVE.test(m[1])) return { text: t, hold: false };
  const rest = s.slice(m[0].length);
  return { text: sp + rest.charAt(0).toUpperCase() + rest.slice(1), hold: false, dropped: m[1] };
}
