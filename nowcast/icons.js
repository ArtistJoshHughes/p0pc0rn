// nowcast/icons.js - p0pc0rn's own small weather icons (line drawings, currentColor) for the forecast periods, picked from the NWS
// short forecast's words; and the view's button glyphs. No image files, nothing fetched.
const NS = 'http://www.w3.org/2000/svg';
const P = {
  sun: ['M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z', 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'],
  moon: ['M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z'],
  cloud: ['M7 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 18.5Z'],
  partsun: ['M8.5 3v1.5M3 8.5h1.5M4.6 4.6l1 1M12.4 4.6l-1 1', 'M6 10.6a3 3 0 0 1 5.4-2.4', 'M8 20h9.5a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.3 1A3 3 0 0 0 8 20Z'],
  partmoon: ['M11.5 7.2A4 4 0 0 1 6.2 3.5a4 4 0 1 0 5.3 3.7Z', 'M8 20h9.5a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.3 1A3 3 0 0 0 8 20Z'],
  rain: ['M7 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.1A3.2 3.2 0 0 0 7 14.5Z', 'M8.5 17l-1 2.5M12.5 17l-1 2.5M16.5 17l-1 2.5'],
  showers: ['M7 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.1A3.2 3.2 0 0 0 7 14.5Z', 'M9 17.5l-.6 1.6M13 17.5l-.6 1.6'],
  storm: ['M7 13.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.1A3.2 3.2 0 0 0 7 13.5Z', 'M12.5 13.5l-2 4h3l-2 4'],
  snow: ['M7 14h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.1A3.2 3.2 0 0 0 7 14Z', 'M8.5 17.5h.01M12 19h.01M15.5 17.5h.01M10.2 21h.01M13.8 21h.01'],
  mix: ['M7 14h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.1A3.2 3.2 0 0 0 7 14Z', 'M8.5 17l-.8 2M12.5 18.5h.01M15.5 17l-.8 2'],
  fog: ['M7 11.5h10a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.3 1A3 3 0 0 0 7 11.5Z', 'M4.5 15h15M6.5 18h11M8.5 21h7'],
  wind: ['M3 9h11a2.5 2.5 0 1 0-2.5-2.5', 'M3 13h15a2.5 2.5 0 1 1-2.5 2.5', 'M3 17h7'],
  // buttons
  layers: ['M12 3.5 3 8.5l9 5 9-5-9-5Z', 'M3 12.5l9 5 9-5', 'M3 16.5l9 5 9-5'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M15.5 15.5 20 20'],
  locate: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3'],
  play: ['M8 5.5v13l10-6.5-10-6.5Z'],
  pause: ['M8 5.5v13M16 5.5v13'],
  close: ['M6 6l12 12M18 6 6 18'],
  back: ['M15 5l-7 7 7 7'],
  alert: ['M12 3.5 2.5 20h19L12 3.5Z', 'M12 10v4.5M12 17.5h.01'],
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M12 11v5.5M12 7.8h.01'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4h-4'],
};
/** an <svg> of icon `name` (stroke currentColor) */
export function icon(name, cls = 'nc-ic', size = 24) {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls); s.setAttribute('fill', name === 'play' ? 'currentColor' : 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  for (const d of P[name] || P.cloud) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
/** a forecast period's icon from its words (NWS shortForecast) and day / night */
export function weatherIcon(short, day = true) {
  const s = String(short || '').toLowerCase();
  if (/thunder|t-storm|tstorm/.test(s)) return 'storm';
  if (/sleet|freezing|wintry mix|rain and snow|snow and rain/.test(s)) return 'mix';
  if (/snow|flurr|blizzard/.test(s)) return 'snow';
  if (/shower|drizzle/.test(s)) return 'showers';
  if (/rain/.test(s)) return 'rain';
  if (/fog|haze|smoke|dust|mist/.test(s)) return 'fog';
  if (/wind|breezy|blustery/.test(s) && !/cloud|sun|clear/.test(s)) return 'wind';
  if (/partly|mostly sunny|mostly clear|few clouds|partly cloudy/.test(s)) return day ? 'partsun' : 'partmoon';
  if (/cloud|overcast/.test(s)) return 'cloud';
  if (/sun|clear|fair/.test(s)) return day ? 'sun' : 'moon';
  return day ? 'partsun' : 'partmoon';
}
