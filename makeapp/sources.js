// sources.js - the online sources an app made in p0pc0rn may read (3.8). The HOST fetches them, never the app: an app asks with
// p0.fetch(source, params), the host checks the app's permission, builds the URL from this table (only these hosts; they are the
// page's CSP connect-src too), caches, rate-limits and hands back trimmed JSON. No keys, no cookies, no personal data in a request:
// only the place (rounded to about 1 km) or the words the app passes. Each source is named on the permission sheet and the privacy page.

const r2 = (v) => Math.round(+v * 100) / 100;                 // ~1 km: enough for weather and fires, never a street address
const ll = (p) => {
  const lat = +p.lat, lon = +p.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw bad('lat and lon must be numbers');
  return { lat: r2(lat), lon: r2(lon) };
};
const bad = (m) => Object.assign(new Error(m), { code: 'BAD_PARAMS' });
const str = (v, n) => (v == null ? '' : String(v)).slice(0, n);
const n = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';

export const SOURCES = {
  'alerts.nws': {
    label: 'US National Weather Service alerts', host: 'api.weather.gov', attribution: 'NWS', ttl: 5 * 60e3, perMin: 6,
    async get(p, get) {
      const { lat, lon } = ll(p), d = await get(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
      return { alerts: (d.features || []).slice(0, 25).map((f) => { const x = f.properties || {}; return { id: str(x.id, 200), event: str(x.event, 80), severity: str(x.severity, 20),
        urgency: str(x.urgency, 20), certainty: str(x.certainty, 20), headline: str(x.headline, 300), area: str(x.areaDesc, 300), effective: str(x.effective, 40),
        ends: str(x.ends || x.expires, 40), sender: str(x.senderName, 80), description: str(x.description, 1200), instruction: str(x.instruction, 600) }; }) };
    } },
  'weather.nws': {
    label: 'US National Weather Service forecast', host: 'api.weather.gov', attribution: 'NWS', ttl: 30 * 60e3, perMin: 4,
    async get(p, get) {
      const { lat, lon } = ll(p), pt = await get(`https://api.weather.gov/points/${lat},${lon}`), u = pt && pt.properties && pt.properties.forecast;
      if (!u || !/^https:\/\/api\.weather\.gov\//.test(u)) throw Object.assign(new Error('no NWS forecast for this place (NWS covers the US only)'), { code: 'NO_DATA' });
      const d = await get(u), loc = (pt.properties.relativeLocation || {}).properties || {};
      return { place: str([loc.city, loc.state].filter(Boolean).join(', '), 80), periods: ((d.properties || {}).periods || []).slice(0, 14).map((x) => ({ name: str(x.name, 40),
        start: str(x.startTime, 40), day: !!x.isDaytime, temp: +x.temperature, unit: str(x.temperatureUnit, 2), wind: str(x.windSpeed, 30), short: str(x.shortForecast, 80),
        pop: n((x.probabilityOfPrecipitation || {}).value), detail: str(x.detailedForecast, 300) })) };   // pop: chance of rain or snow (%), null when NWS gives none
    } },
  'geocode.openmeteo': {
    label: 'Open-Meteo place search', host: 'geocoding-api.open-meteo.com', attribution: 'Open-Meteo', ttl: 24 * 3600e3, perMin: 10,
    async get(p, get) {
      const name = str(p.name, 80).trim(); if (name.length < 2) throw bad('name is too short');
      const d = await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`);
      return { results: (d.results || []).slice(0, 5).map((x) => ({ name: str(x.name, 80), region: str(x.admin1, 80), country: str(x.country, 60), cc: str(x.country_code, 2),
        lat: r2(x.latitude), lon: r2(x.longitude) })) };
    } },
  'fires.wfigs': {
    label: 'US wildfire incidents (NIFC / WFIGS)', host: 'services3.arcgis.com', attribution: 'NIFC WFIGS', ttl: 15 * 60e3, perMin: 4,
    async get(p, get) {
      const { lat, lon } = ll(p), mi = Math.max(5, Math.min(200, +p.radiusMi || 50)), dLat = mi / 69, dLon = mi / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
      const q = new URLSearchParams({ where: "IncidentTypeCategory='WF'", geometry: [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(3)).join(','), geometryType: 'esriGeometryEnvelope',
        inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,POOState',
        returnGeometry: 'true', outSR: '4326', resultRecordCount: '100', f: 'json' });
      const d = await get(`${WFIGS}?${q}`);
      if (d && d.error) throw Object.assign(new Error('the wildfire service answered with an error'), { code: 'NO_DATA' });
      return { fires: (d.features || []).map((f) => { const a = f.attributes || {}, g = f.geometry || {}; return { id: str(a.UniqueFireIdentifier, 30), name: str(a.IncidentName, 60),
        acres: a.IncidentSize == null ? null : +a.IncidentSize, contained: a.PercentContained == null ? null : +a.PercentContained, discovered: a.FireDiscoveryDateTime || null,
        state: str(a.POOState, 8), lat: r2(g.y), lon: r2(g.x) }; }).filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon)) };
    } },
  'prices.coingecko': {
    label: 'CoinGecko crypto prices', host: 'api.coingecko.com', attribution: 'CoinGecko', ttl: 60e3, perMin: 4,
    async get(p, get) {
      const ids = (Array.isArray(p.ids) ? p.ids : String(p.ids || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9-]{2,60}$/.test(x)).slice(0, 20);
      if (!ids.length) throw bad('ids: a list of CoinGecko coin ids');
      const d = await get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&price_change_percentage=24h,7d,30d,1y&sparkline=true`);
      // only what CoinGecko sends: a missing number stays null (never 0); spark = its last 7 days of prices, about one an hour, oldest first
      return { coins: (Array.isArray(d) ? d : []).map((x) => ({ id: str(x.id, 60), symbol: str(x.symbol, 10).toUpperCase(), name: str(x.name, 40), price: n(x.current_price),
        cap: n(x.market_cap), rank: n(x.market_cap_rank), volume: n(x.total_volume), supply: n(x.circulating_supply), high: n(x.high_24h), low: n(x.low_24h), ath: n(x.ath),
        updated: str(x.last_updated, 40), spark: ((x.sparkline_in_7d || {}).price || []).slice(-200).map(n).filter((v) => v != null),
        chg: { D: n(x.price_change_percentage_24h_in_currency), W: n(x.price_change_percentage_7d_in_currency), M: n(x.price_change_percentage_30d_in_currency), Y: n(x.price_change_percentage_1y_in_currency) } })) };
    } },
};
export const SOURCE_IDS = Object.keys(SOURCES);

/** the host side of p0.fetch: a cache + per-source rate limit around SOURCES[id].get. fetchJSON(url) does the network call
 *  (credentials omitted, no referrer, 15 s timeout); now() is injectable for tests. scope = the asking app's id: each app has its own
 *  cache, so no app can tell from a fast answer what another app looked up (the rate limit per source stays shared). */
export function createFetcher({ fetchJSON = defaultFetchJSON, now = () => Date.now() } = {}) {
  const cache = new Map(), calls = new Map();
  return async function fetchSource(id, params = {}, scope = '') {
    const S = SOURCES[id]; if (!S) throw Object.assign(new Error('unknown source ' + id), { code: 'UNKNOWN_SOURCE' });
    const key = String(scope) + '\n' + id + ' ' + JSON.stringify(params || {}), hit = cache.get(key), t = now();
    if (hit && t - hit.t < S.ttl) return hit.v;
    const recent = (calls.get(id) || []).filter((x) => t - x < 60e3);
    if (recent.length >= S.perMin) { if (hit) return hit.v; throw Object.assign(new Error(`${S.label}: too many requests, try again in a minute`), { code: 'RATE_LIMIT' }); }
    recent.push(t); calls.set(id, recent);
    const v = await S.get(params || {}, (url) => { if (new URL(url).hostname !== S.host) throw new Error('host not allowed'); return fetchJSON(url); });
    v.source = S.attribution; v.fetchedAt = t;
    cache.set(key, { t, v }); if (cache.size > 200) cache.delete(cache.keys().next().value);
    return v;
  };
}
async function defaultFetchJSON(url) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ac.signal, headers: { Accept: 'application/json, application/geo+json' } });
    if (!r.ok) throw Object.assign(new Error(`the source answered ${r.status}`), { code: 'HTTP_' + r.status });
    const t = await r.text(); if (t.length > 3e6) throw new Error('the answer is too big');
    return JSON.parse(t);
  } catch (e) { if (e && e.name === 'AbortError') throw Object.assign(new Error('the source did not answer in time'), { code: 'TIMEOUT' }); throw e; }
  finally { clearTimeout(to); }
}
