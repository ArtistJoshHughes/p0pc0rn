// nowcast/colors.js - p0pc0rn's own colours for the rain map: a rain ramp (light -> moderate -> heavy), a snow ramp, the chance-of-rain
// ramp and the warning outlines. Rates are kept as one byte a pixel: 0 = none, 1..127 = a log scale from 0.1 mm/h (11 steps an
// octave, 0.1 -> 300+ mm/h), + 128 = snow (MRMS PrecipFlag). Pure.

export const MIN_RATE = 0.1;
/** mm/h -> level 0..127 */
export const levelOf = (v) => (!(v >= MIN_RATE) ? 0 : Math.min(127, 1 + Math.floor(11 * Math.log2(v / MIN_RATE))));
/** level -> the lowest mm/h it stands for */
export const rateOf = (lv) => (lv <= 0 ? 0 : MIN_RATE * 2 ** ((lv - 1) / 11));

// [mm/h, r, g, b, alpha] stops; colours between stops are blended
export const RAIN = [[0.1, 120, 205, 235, 0.32], [0.5, 80, 180, 230, 0.55], [1, 46, 140, 214, 0.72], [2.5, 32, 178, 120, 0.82], [4, 236, 206, 52, 0.88],
  [8, 242, 140, 40, 0.92], [16, 226, 62, 54, 0.95], [32, 196, 24, 96, 0.97], [64, 150, 70, 255, 1]];
export const SNOW = [[0.1, 236, 242, 255, 0.4], [0.5, 214, 226, 255, 0.6], [1, 182, 202, 255, 0.75], [2.5, 150, 170, 248, 0.85], [4, 128, 138, 236, 0.92], [8, 108, 96, 220, 1]];
// chance of rain over the chosen rate: 10% faint -> 100% strong, in the app's iris
export const CHANCE = [[0.1, 160, 150, 255, 0.22], [0.3, 139, 124, 255, 0.45], [0.5, 120, 98, 250, 0.62], [0.7, 98, 72, 236, 0.78], [0.9, 78, 48, 214, 0.9]];
/** the legend's labelled stops */
export const LEGEND = { rain: [['Light', 0.5], ['', 1], ['Moderate', 4], ['', 8], ['Heavy', 16], ['', 64]], snow: [['Light', 0.5], ['', 1], ['Heavy', 4]] };
/** rain categories (mm/h), the words the summary uses */
export const CAT = { light: 1, moderate: 4, heavy: 8 };

function ramp(stops, x) {
  if (x < stops[0][0]) return null;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (x >= stops[i][0]) {
      const a = stops[i], b = stops[i + 1]; if (!b) return a.slice(1);
      const f = Math.log(x / a[0]) / Math.log(b[0] / a[0]);
      return [0, 1, 2, 3].map((k) => a[k + 1] + (b[k + 1] - a[k + 1]) * f * 0.35);   // mostly the stop's own colour: steps stay readable
    }
  }
  return null;
}
/** 256 RGBA colours for the one-byte codes (premultiplied: false) -> Uint8ClampedArray(1024) */
export function codeLut() {
  const lut = new Uint8ClampedArray(1024);
  for (let c = 1; c < 256; c++) {
    const lv = c & 127; if (!lv) continue;
    const x = ramp(c & 128 ? SNOW : RAIN, rateOf(lv) * 1.0001); if (!x) continue;
    lut[4 * c] = x[0]; lut[4 * c + 1] = x[1]; lut[4 * c + 2] = x[2]; lut[4 * c + 3] = Math.round(x[3] * 255);
  }
  return lut;
}
/** 256 colours for a chance 0..255 (= 0..100%) */
export function chanceLut() {
  const lut = new Uint8ClampedArray(1024);
  for (let c = 1; c < 256; c++) { const x = ramp(CHANCE, c / 255); if (!x) continue; lut[4 * c] = x[0]; lut[4 * c + 1] = x[1]; lut[4 * c + 2] = x[2]; lut[4 * c + 3] = Math.round(x[3] * 255); }
  return lut;
}
export const cssOf = (stops, v) => { const x = ramp(stops, v * 1.0001); return x ? `rgba(${x[0] | 0},${x[1] | 0},${x[2] | 0},${Math.min(1, x[3] + 0.15).toFixed(2)})` : 'transparent'; };

// NWS warnings drawn on the map (their outlines from the alerts' own polygons): the most serious first
export const WARN = [
  { re: /^tornado warning/i, key: 'tornado', label: 'Tornado warning', color: '#FF3B30' },
  { re: /^severe thunderstorm warning/i, key: 'severe', label: 'Severe thunderstorm warning', color: '#FF9F0A' },
  { re: /^flash flood warning/i, key: 'flash', label: 'Flash flood warning', color: '#30B0C7' },
  { re: /warning/i, key: 'other', label: 'Other warning', color: '#AF52DE' },
  { re: /watch/i, key: 'watch', label: 'Watch', color: '#8E8E93' },
];
export const warnOf = (event) => WARN.find((w) => w.re.test(String(event || ''))) || null;
