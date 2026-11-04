// nowcast/clouds.js - the Clouds layer: NOAA GOES-East / GOES-West satellite imagery through NASA GIBS (US government, public domain;
// tiles answer with Access-Control-Allow-Origin: *). Band 13 "clean infrared" works day and night: its tiles come coloured (a rainbow
// of cloud-top temperature), so each tile is turned back into temperatures with NASA's own colour table and drawn as plain white
// clouds, colder (higher) = more solid, never in the rain's colours. In daylight GeoColor (true colour) is used instead when it is
// there. Images are every 10 minutes and reach GIBS 25-60 minutes late: a radar frame gets the newest image at or before its time,
// and the screen says which ("clouds 9:50 PM").
const GIBS = 'https://gibs.earthdata.nasa.gov/';
const COLORMAP = GIBS + 'colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml';
export const SATS = {
  west: { name: 'GOES-West', ir: 'GOES-West_ABI_Band13_Clean_Infrared', geo: 'GOES-West_ABI_GeoColor' },
  east: { name: 'GOES-East', ir: 'GOES-East_ABI_Band13_Clean_Infrared', geo: 'GOES-East_ABI_GeoColor' },
};
const LEVEL = { ir: 6, geo: 7 };
export const CLOUD_CREDIT = 'Clouds: NOAA GOES via NASA GIBS';
const MIN10 = 600e3;
/** the satellite that sees a longitude best (GOES-West over the West, GOES-East over the rest of the lower 48) */
export const satFor = (lon) => (lon < -105 ? 'west' : 'east');
/** the sun's height over the horizon in degrees (a short form of NOAA's solar position formulas; a degree or so is enough here) */
export function sunElevation(lat, lon, t) {
  const d = new Date(t), D2R = Math.PI / 180;
  const day = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const hr = d.getUTCHours() + d.getUTCMinutes() / 60, g = (2 * Math.PI / 365) * (day - 1 + (hr - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const ha = ((hr * 60 + eqt + 4 * lon) / 4 - 180) * D2R;
  const cz = Math.sin(lat * D2R) * Math.sin(decl) + Math.cos(lat * D2R) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / D2R;
}
/** NASA's colour table (XML) -> Map(0xRRGGBB -> degrees C at the bin's middle) */
export function parseColormap(xml) {
  const m = new Map(), re = /<ColorMapEntry rgb="(\d+),(\d+),(\d+)"[^>]*?value="\(([-+\d.INF]+),([-+\d.INF]+)\]"/g; let x;
  while ((x = re.exec(String(xml || '')))) {
    const lo = parseFloat(x[4]), hi = parseFloat(x[5]), v = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo : hi;
    m.set((+x[1] << 16) | (+x[2] << 8) | +x[3], v);
  }
  return m;
}
/** cloud-top temperature (C) -> white cloud's opacity 0..1: nothing down to -5 C (the ground and the lowest clouds look alike in
 *  infrared), then smoothly more solid the colder (higher) the top, 0.88 from -55 C */
export const cloudAlpha = (c) => (!(c < -5) ? 0 : Math.min(0.88, 0.88 * (-5 - c) / 50));
/** the colour table's temperature for any colour: an exact entry, else the nearest entry (the tiles are resampled, so their colours
 *  fall between the table's: about two thirds of a tile's pixels); a colour far from every entry (> 40 in RGB) is not a temperature */
export function temperatureOf(cm, rgb, cache) {
  const c = cache.get(rgb); if (c !== undefined) return c;
  let t = cm.get(rgb);
  if (t === undefined) {
    const r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255; let best = 1e9;
    for (const [k, v] of cm) { const d = (r - (k >> 16)) ** 2 + (g - ((k >> 8) & 255)) ** 2 + (b - (k & 255)) ** 2; if (d < best) { best = d; t = v; } }
    if (best > 1600) t = null;
  }
  cache.set(rgb, t); return t;
}

export function createClouds({ fetchFn = (...a) => fetch(...a), onTile = () => {} } = {}) {
  let cmap = null, cmapP = null; const near = new Map();
  const latest = new Map(), tiles = new Map(), stats = { tiles: 0, bytes: 0 };
  const colormap = () => cmapP || (cmapP = fetchFn(COLORMAP).then((r) => r.text()).then((t) => { cmap = parseColormap(t); return cmap; }, (e) => { cmapP = null; throw e; }));
  /** the newest image time of a layer (GIBS answers a 'default' tile with its time in Layer-Time-Actual), kept 5 minutes */
  async function newest(layer, level) {
    const c = latest.get(layer); if (c && Date.now() - c.at < 5 * 60e3) return c.t;
    const r = await fetchFn(`${GIBS}wmts/epsg3857/best/${layer}/default/default/GoogleMapsCompatible_Level${level}/0/0/0.png`);
    const h = r.headers.get('layer-time-actual'); try { await r.arrayBuffer(); } catch (e) { /* */ }
    const t = h ? Date.parse(h) : NaN; if (!Number.isFinite(t)) throw new Error('no time for ' + layer);
    latest.set(layer, { t, at: Date.now() }); return t;
  }
  async function makeTile(kind, layer, iso, z, x, y) {
    const r = await fetchFn(`${GIBS}wmts/epsg3857/best/${layer}/default/${iso}/GoogleMapsCompatible_Level${LEVEL[kind]}/${z}/${y}/${x}.png`);
    if (!r.ok) return null;
    const blob = await r.blob(); stats.tiles++; stats.bytes += blob.size;
    const bmp = await createImageBitmap(blob);
    if (kind === 'geo') return bmp;
    const cm = cmap || (await colormap());
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const t = d[i + 3] ? temperatureOf(cm, (d[i] << 16) | (d[i + 1] << 8) | d[i + 2], near) : null, a = t == null ? 0 : cloudAlpha(t);
      const w = 235 + Math.round(20 * Math.min(1, a / 0.6));   // a touch grey where thin
      d[i] = w; d[i + 1] = w; d[i + 2] = Math.min(255, w + 4); d[i + 3] = Math.round(a * 255);
    }
    g.putImageData(im, 0, 0);
    return createImageBitmap(c);
  }
  return {
    stats,
    /** get ready for the place (colour table, newest image times) -> true when the layer can draw */
    async prepare(lat, lon) { const s = SATS[satFor(lon)]; await Promise.all([colormap(), newest(s.ir, LEVEL.ir), newest(s.geo, LEVEL.geo).catch(() => null)]); return true; },
    /** the picture for a radar frame at time t over (lat, lon) -> { get(z, x, y), maxZ, alpha, t (the image's time), kind, sat } | null */
    at(t, lat, lon) {
      const sat = SATS[satFor(lon)], day = sunElevation(lat, lon, t) > 8;
      const lg = latest.get(sat.geo), li = latest.get(sat.ir);
      const kind = day && lg && lg.t >= t - 60 * 60e3 ? 'geo' : 'ir', L = latest.get(sat[kind]);
      if (!L || (kind === 'ir' && !cmap)) return null;
      const time = Math.floor(Math.min(t, L.t) / MIN10) * MIN10, iso = new Date(time).toISOString().replace('.000Z', 'Z'), layer = sat[kind];
      return { kind, sat: sat.name, t: time, maxZ: LEVEL[kind], alpha: kind === 'geo' ? 0.92 : 1,
        get(z, x, y) {
          const k = `${layer}/${iso}/${z}/${x}/${y}`, c = tiles.get(k);
          if (c) { c.at = performance.now(); return c.img; }
          const rec = { img: null, at: performance.now() }; tiles.set(k, rec);
          makeTile(kind, layer, iso, z, x, y).then((img) => { rec.img = img; if (img) onTile(); }, () => { /* offline: no clouds there */ });
          if (tiles.size > 160) { const old = [...tiles.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 40); for (const [kk, v] of old) { if (v.img && v.img.close) v.img.close(); tiles.delete(kk); } }
          return null;
        } };
    },
    drop() { for (const v of tiles.values()) if (v.img && v.img.close) v.img.close(); tiles.clear(); },
  };
}
