// nowcast/juli.js - the Nowcast in Juli's chat: which questions it answers ("will it rain in the next hour", "when does the rain start /
// stop here", "is rain coming soon"), and the nowcast source behind weather.js's interface (forecast(lat, lon) -> facts | { outside }).
// The answer is made in code from the ensemble (summary.js), never by a model: Juli's own words stay for the NWS forecast. Pure.
import { zipOf, placeOf } from '../assistant/weather.js';
import { inConus } from './regrid.js';

const SOON = /\b(?:next|coming|following)\s+(?:hour|half[- ]hour|(?:\d{1,2}|ten|fifteen|twenty|thirty|forty[- ]five|sixty|ninety)\s*(?:min(?:ute)?s?|mins))\b|\bwithin\s+(?:the\s+)?(?:hour|(?:an?|one)\s+hour|\d{1,2}\s*min(?:ute)?s?)\b|\bin\s+(?:the\s+)?next\s+\d{1,2}\s*min|\b(?:soon|shortly|any minute|right away|in a bit|in a few minutes|in an hour|this hour)\b/i;
const RAIN = /\b(?:rain\w*|shower\w*|storm\w*|drizzl\w*|thunder\w*|downpour|precip\w*|wet)\b/i;
const STARTSTOP = /\bwhen\b[^.?!]{0,40}\b(?:rain|showers?|storms?|drizzle)\b[^.?!]{0,30}\b(?:start|begin|stop|end|let up|ease|clear|quit|finish|arrive|come|get here|be over|pass)\w*|\b(?:rain|showers?|storms?)\b[^.?!]{0,20}\b(?:stop|end|let up|ease off|clear up|be over)\b/i;
const NOT = /\b(?:song|poem|story|picture|photo|clip|video|lyrics|painting|tomorrow|tonight|weekend|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
/** a question about rain in the next 90 minutes -> { zip, place } (where it names, or nothing) | null */
export function nowcastAsk(text) {
  const t = String(text || '');
  if (NOT.test(t)) return null;
  if (!(STARTSTOP.test(t) || (RAIN.test(t) && SOON.test(t)) || /\bis (?:it|rain) (?:going to|gonna) (?:start )?rain(?:ing)? soon\b/i.test(t) || /\bnowcast\b/i.test(t))) return null;
  const zip = zipOf(t);
  return { zip, place: zip ? null : placeOf(t), when: 'now' };
}
/** a forecast week question that the 7-day sheet answers too ("this week's forecast") */
export const weekAsk = (text) => /\b(?:this|next|the)\s+week(?:'s)?\b|\b7[- ]day\b|\bseven[- ]day\b|\bweek(?:'s)? forecast\b/i.test(String(text || ''));

/** the Nowcast as a weather source (weather.js createWeather's interface): `latest(lat, lon)` gives a current run that covers the point
 *  (made in the view or by Juli's earlier question), and the facts are its summary; anything else is { outside } so the NWS answers */
export function nowcastSource({ latest }) {
  return { id: 'nowcast', name: 'Nowcast (experimental)', credit: 'Nowcast: DeepMind DGMR (CC BY 4.0), modified · Radar: NOAA MRMS',
    async forecast(lat, lon, o = {}) {
      if (!o.nowcast || !inConus(lat, lon)) return { outside: true, ms: 0 };
      const r = await latest(lat, lon); if (!r || !r.summary) return { outside: true, ms: 0 };
      return { source: 'nowcast', name: 'Nowcast (experimental)', credit: this.credit, summary: r.summary.text, t0: r.t0, runId: r.id, ms: 0 };
    } };
}
