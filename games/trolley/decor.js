// decor.js - Level 1's grit, all drawn in code at load (no image files, seeded: the room is the same every time):
//  - canvas textures: rusted corrugated wall panels, stained and cracked concrete, worn diamond tread plate, teal paint flaking off
//    rust, raw rust, a grimy concrete barrier, scuffed bollard paint, worn hazard stripes; each colour map has a packed data map
//    (R = height for bumpMap, G = roughness, B = metalness), so one extra texture gives relief, wet oil and bare steel;
//  - neon signs: tube lettering drawn on canvases (a white-hot core, a coloured glow, a soft halo), added on top of the wall
//    (additive, no bloom), each with its own seeded flicker; four PointLights (distance + decay 2, no shadows) carry the
//    signs' light onto the walls and floor and follow their flicker. Generic words only: no names, no logos, no brands.
import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

// ------------------------------------------------------------------------------------------------ small helpers
export function rng(seed) {   // mulberry32
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** tileable value-noise fbm on a w x h grid (wraps at the edges), 0..1 */
export function fbm(w, h, { seed = 1, cells = 4, oct = 5, gain = 0.5, sx = 1, sy = 1 } = {}) {
  const out = new Float32Array(w * h), r = rng(seed); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const cx = Math.max(1, Math.round(cells * sx * 2 ** o)), cy = Math.max(1, Math.round(cells * sy * 2 ** o));
    const grid = new Float32Array(cx * cy); for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cy, y0 = Math.floor(fy), ty = fy - y0, y1 = (y0 + 1) % cy, ey = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cx, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % cx, ex = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * cx + x0], b = grid[y0 * cx + x1], c = grid[y1 * cx + x0], d = grid[y1 * cx + x1];
        const top = a + (b - a) * ex; out[y * w + x] += amp * (top + (c + (d - c) * ex - top) * ey);
      }
    }
    tot += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
/** stretch an fbm's contrast round its middle (an average of octaves bunches up near 0.5) */
const contrast = (f, k = 2.2) => { for (let i = 0; i < f.length; i++) f[i] = clamp01(0.5 + (f[i] - 0.5) * k); return f; };
/** bilinear, wrapping sampler over a field: (u, v) in 0..1 */
const sampler = (f, w, h) => (u, v) => {
  const x = (((u % 1) + 1) % 1) * w - 0.5, y = (((v % 1) + 1) % 1) * h - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const X0 = (x0 + w) % w, X1 = (x0 + 1 + w) % w, Y0 = (y0 + h) % h, Y1 = (y0 + 1 + h) % h;
  const a = f[Y0 * w + X0], b = f[Y0 * w + X1], c = f[Y1 * w + X0], d = f[Y1 * w + X1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
};

/** run fn over every pixel of a colour canvas and its data canvas (R height, G roughness, B metalness), 0..255 each */
function pixels(w, h, fn) {
  const cc = canvas(w, h), dc = canvas(w, h), gc = cc.getContext('2d'), gd = dc.getContext('2d');
  const ic = gc.createImageData(w, h), id = gd.createImageData(w, h), C = ic.data, D = id.data, rgb = [0, 0, 0], dat = [128, 200, 0];
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    fn(x, y, i, rgb, dat); const p = i * 4;
    C[p] = rgb[0]; C[p + 1] = rgb[1]; C[p + 2] = rgb[2]; C[p + 3] = 255; D[p] = dat[0]; D[p + 1] = dat[1]; D[p + 2] = dat[2]; D[p + 3] = 255;
  }
  gc.putImageData(ic, 0, 0); gd.putImageData(id, 0, 0);
  return { cc, dc, gc, gd };
}
function tex(c, { srgb = true, rep = [1, 1], aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = aniso;
  return t;
}
/** a material from a colour + data pair: map, bumpMap (R), roughnessMap (G), metalnessMap (B) */
function pbr(p, rep, { bump = 1, rough = 1, metal = 1, color = '#ffffff', aniso = 4, ...rest } = {}) {
  const map = tex(p.cc, { rep, aniso }), data = tex(p.dc, { srgb: false, rep, aniso });
  return new THREE.MeshStandardMaterial({ map, bumpMap: data, bumpScale: bump, roughnessMap: data, roughness: rough, metalnessMap: data, metalness: metal, color, ...rest });
}

/** UVs in metres for a box-like geometry, picked by each vertex normal's main axis (seen from outside, never mirrored); `off` is
 *  added to the positions so neighbouring boxes line up. Textures then set repeat = 1 / their tile size in metres. */
export function boxUV(geo, off = [0, 0, 0]) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + off[0], y = p.getY(i) + off[1], z = p.getZ(i) + off[2], nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) uv.setXY(i, x, ny >= 0 ? -z : z);
    else if (ax >= az) uv.setXY(i, nx >= 0 ? -z : z, y);
    else uv.setXY(i, nz >= 0 ? x : -x, y);
  }
  uv.needsUpdate = true;
  return geo;
}

// ------------------------------------------------------------------------------------------------ palettes
// dark, desaturated, low contrast: the neon carries the colour
const P = {
  rustDeep: hex('#2c160d'), rust: hex('#552915'), rustHot: hex('#7e4120'), rustPale: hex('#9a6436'),
  steel: hex('#3b3d40'), steelLit: hex('#808286'), grime: hex('#16120f'),
  concreteLo: hex('#4c4741'), concreteHi: hex('#6a645b'), oil: hex('#15110e'),
  teal: hex('#3f4f4a'), tealLit: hex('#4d5d55'), tealChalk: hex('#6c776d'),
  wallPaint: hex('#4d5654'), wallPaintLit: hex('#5d6662'), wallLow: hex('#352621'), stripe: hex('#7d6a32'),
  yellow: hex('#c99c24'), barrier: hex('#6e6861'),
};
const grain = (x, y, k = 0.06) => 1 - k + 2 * k * hash(x * 3 + 11, y * 5 + 7);

// ------------------------------------------------------------------------------------------------ the textures
/** corrugated steel wall panels, 4 m wide x 2.6 m tall a tile: grey-green paint above a dark oxide dado, a dirty yellow line, lap
 *  seams with rivets, rust streaks hanging from the seams and the top edge, freckles of rust bloom, rising damp and soot at the foot */
export function wallMaterial() {
  const W = 1024, H = 672, big = fbm(256, 168, { seed: 11, cells: 2, oct: 4 }), sBig = sampler(big, 256, 168);
  const mid = contrast(fbm(512, 336, { seed: 13, cells: 10, oct: 3 }), 2.4), sMid = sampler(mid, 512, 336);
  const streaks = contrast(fbm(512, 32, { seed: 12, cells: 18, oct: 3, sy: 0.08 }), 2.6), sS = sampler(streaks, 512, 32);
  const wyOf = (y) => ((H - y) / H) * 2.6, seams = [1.3, 2.6], rnd = rng(14), col = [0, 0, 0], rc = [0, 0, 0];
  const p = pixels(W, H, (x, y, i, rgb, dat) => {
    const u = x / W, v = y / H, wy = wyOf(y), rib = Math.sin((x / 32) * Math.PI * 2), b = sBig(u, v), m = sMid(u, v), st = sS(u, v * 0.3);
    const low = wy < 0.95, line = wy >= 0.95 && wy < 0.99;
    lerp3(col, P.wallPaint, P.wallPaintLit, b);
    if (low) lerp3(col, P.wallLow, hex('#40302a'), b); else if (line) lerp3(col, P.stripe, hex('#5f5233'), m * 0.6);
    // rust: streaks hanging under each seam, freckled bloom, rising damp
    let hang = 0; for (const s of seams) if (wy <= s) hang = Math.max(hang, Math.exp(-(s - wy) / (0.25 + 0.6 * st)) * st);
    const damp = sstep(0.5, 0.0, wy) * (0.5 + 0.5 * m);
    const bloom = sstep(0.74, 1.0, m * 0.7 + b * 0.35 + (hash(x * 5, y * 3) - 0.5) * 0.3) * 0.5;
    const r = clamp01(sstep(0.35, 0.75, hang) * 0.85 + bloom + damp * 0.8);
    lerp3(rc, P.rustDeep, P.rustHot, clamp01(m * 0.9 + (hash(x, y) - 0.5) * 0.3));
    lerp3(col, col, rc, r);
    const soot = sstep(0.4, 0.0, wy) * 0.45 + sstep(0.6, 0.95, st) * sstep(1.6, 2.6, wy) * 0.2;
    const shade = (1 + 0.06 * rib) * (1 - soot) * grain(x, y, 0.05);
    rgb[0] = col[0] * shade; rgb[1] = col[1] * shade; rgb[2] = col[2] * shade;
    dat[0] = 128 + 50 * rib - r * 20 * hash(x + 1, y); dat[1] = 135 + r * 100 + soot * 20; dat[2] = 0;
  });
  // the panel seams (every 2 m) and the lap seam at 1.3 m, with rivets and their rust tears
  const { gc, gd } = p, pxY = (wy) => H - (wy / 2.6) * H;
  const line = (g, x0, y0, x1, y1, c, w) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  for (const x of [1, W / 2]) { line(gc, x, 0, x, H, 'rgba(14,11,9,0.85)', 3); line(gc, x + 3, 0, x + 3, H, 'rgba(150,150,140,0.12)', 1); line(gd, x, 0, x, H, 'rgb(40,200,0)', 3); }
  line(gc, 0, pxY(1.3), W, pxY(1.3), 'rgba(14,11,9,0.8)', 3); line(gc, 0, pxY(1.3) - 3, W, pxY(1.3) - 3, 'rgba(150,150,140,0.16)', 1); line(gd, 0, pxY(1.3), W, pxY(1.3), 'rgb(45,200,0)', 3);
  const rivet = (x, y) => {
    gc.fillStyle = 'rgba(16,12,10,0.85)'; gc.beginPath(); gc.arc(x + 0.8, y + 0.8, 3.4, 0, Math.PI * 2); gc.fill();
    gc.fillStyle = 'rgb(92,80,70)'; gc.beginPath(); gc.arc(x, y, 2.8, 0, Math.PI * 2); gc.fill();
    gc.fillStyle = 'rgba(200,190,170,0.3)'; gc.beginPath(); gc.arc(x - 1, y - 1, 1.1, 0, Math.PI * 2); gc.fill();
    gd.fillStyle = 'rgb(220,170,40)'; gd.beginPath(); gd.arc(x, y, 3, 0, Math.PI * 2); gd.fill();
    if (rnd() < 0.5) {   // a rust tear under the rivet
      const len = 25 + rnd() * 120, w = 1.5 + rnd() * 3.5, gr = gc.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(105,48,20,0.7)'); gr.addColorStop(1, 'rgba(105,48,20,0)'); gc.fillStyle = gr; gc.fillRect(x - w / 2, y + 3, w, len);
    }
  };
  for (const x0 of [8, W / 2 + 8]) for (let y = 20; y < H; y += 64) rivet(x0, y);
  for (let x = 40; x < W; x += 64) rivet(x, pxY(1.3) - 9);
  // bare-steel scrapes low down (a forklift's, long ago)
  for (let k = 0; k < 12; k++) {
    const x = rnd() * W, y = pxY(0.2 + rnd() * 0.75), len = 20 + rnd() * 80, a = (rnd() - 0.5) * 0.25;
    line(gc, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 'rgba(140,138,132,0.45)', 1.1); line(gd, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 'rgb(128,90,210)', 1.1);
  }
  return pbr(p, [1 / 4, 1 / 2.6], { bump: 1.6, metal: 1, rough: 1 });
}

/** stained, cracked concrete: 4 x 4 m a tile (1024 px), expansion joints every 2 m and saw cuts every metre; a few irregular oil
 *  stains (dark, a little glossy), faint rust smears, aggregate, cracks */
export function floorMaterial({ size = 1024 } = {}) {
  const W = size, H = size, F = 512, n = contrast(fbm(F, F, { seed: 21, cells: 4, oct: 5 }), 1.8), m = fbm(F, F, { seed: 22, cells: 14, oct: 3 });
  const sn = sampler(n, F, F), sm = sampler(m, F, F), rnd = rng(23), col = [0, 0, 0];
  const oils = [], rusts = [];
  for (let k = 0; k < 4; k++) oils.push([rnd() * W, rnd() * H, (0.25 + rnd() * 0.35) * (W / 4)]);
  for (let k = 0; k < 3; k++) rusts.push([rnd() * W, rnd() * H, (0.2 + rnd() * 0.25) * (W / 4)]);
  const wrapD = (a, b, L) => { const d = Math.abs(a - b); return Math.min(d, L - d); };
  const field = (list, x, y) => { let v = 0; for (const [cx, cy, r] of list) { const d = Math.hypot(wrapD(x, cx, W), wrapD(y, cy, H)) / r; if (d < 1) v = Math.max(v, 1 - d); } return v; };
  const half = W / 2, quarter = W / 4;
  const p = pixels(W, H, (x, y, i, rgb, dat) => {
    const u = x / W, v = y / H, a = sn(u, v), b = sm(u, v), spk = hash(x * 7 + 3, y * 13 + 1);
    lerp3(col, P.concreteLo, P.concreteHi, a * 0.7 + b * 0.3);
    let k = 0.93 + spk * 0.14; if (spk > 0.988) k += 0.25;   // aggregate
    const jx = Math.min(x % half, half - (x % half)), jy = Math.min(y % half, half - (y % half));
    const chip = (b - 0.5) * 5, joint = sstep(4.0 + chip, 0.8, Math.min(jx, jy));
    const sx = Math.min(x % quarter, quarter - (x % quarter)), sy = Math.min(y % quarter, quarter - (y % quarter)), saw = sstep(1.5, 0.3, Math.min(sx, sy)) * 0.45;
    const oil = sstep(0.25, 0.75, field(oils, x, y) * 0.9 + (b - 0.5) * 0.9 + (a - 0.5) * 0.4) * 0.75;
    const rust = sstep(0.1, 0.8, field(rusts, x, y) + (a - 0.5) * 0.6) * 0.4;
    k *= (1 - 0.7 * joint) * (1 - 0.3 * saw) * (1 - 0.1 * sstep(0.55, 0.85, b));
    rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    if (rust > 0) lerp3(rgb, rgb, P.rust, rust);
    if (oil > 0) lerp3(rgb, rgb, P.oil, oil);
    dat[0] = 150 + (a - 0.5) * 40 - joint * 110 - saw * 50 + spk * 12; dat[1] = 225 - oil * 55 - (1 - a) * 15; dat[2] = 0;
  });
  // cracks: random walks
  const { gc, gd } = p;
  for (let c = 0; c < 9; c++) {
    let x = rnd() * W, y = rnd() * H, ang = rnd() * Math.PI * 2; const steps = 20 + (rnd() * 50) | 0;
    gc.strokeStyle = 'rgba(16,13,11,0.6)'; gd.strokeStyle = 'rgb(50,240,0)'; gc.lineWidth = gd.lineWidth = 1.2;
    gc.beginPath(); gd.beginPath(); gc.moveTo(x, y); gd.moveTo(x, y);
    for (let s = 0; s < steps; s++) { ang += (rnd() - 0.5) * 0.9; x += Math.cos(ang) * 6; y += Math.sin(ang) * 6; gc.lineTo(x, y); gd.lineTo(x, y); if (rnd() < 0.06) { gc.moveTo(x, y); gd.moveTo(x, y); ang += (rnd() - 0.5) * 2; } }
    gc.stroke(); gd.stroke();
  }
  return pbr(p, [4, 3], { bump: 1.2, metal: 0, rough: 1, aniso: 8 });
}

/** worn diamond tread plate, 0.5 m a tile: dark steel, the lozenges worn bright on top, rust and dirt packed in the grooves */
export function treadMaterial() {
  const W = 512, n = fbm(W, W, { seed: 31, cells: 4, oct: 5 }), f = fbm(W, W, { seed: 32, cells: 20, oct: 2 }), col = [0, 0, 0], rc = [0, 0, 0];
  const p = pixels(W, W, (x, y, i, rgb, dat) => {
    const cx = Math.floor(x / 32), cy = Math.floor(y / 32), lx = (x % 32) - 15.5, ly = (y % 32) - 15.5, a = (cx + cy) % 2 ? 0.78 : -0.78;
    const rx = lx * Math.cos(a) + ly * Math.sin(a), ry = -lx * Math.sin(a) + ly * Math.cos(a), h = clamp01(1 - (Math.abs(rx) / 11 + Math.abs(ry) / 3.2));
    const ridge = sstep(0.0, 0.3, h), top = sstep(0.3, 0.7, h);
    const r = sstep(0.52, 0.7, n[i] + (f[i] - 0.5) * 0.3) * (1 - ridge * 0.7) * 0.8;   // rust: in the grooves, rarely on the worn tops
    lerp3(col, P.steel, P.steelLit, top * (0.6 + 0.4 * f[i]));
    lerp3(rc, P.rustDeep, P.rust, f[i]);
    lerp3(col, col, rc, r * 0.85);
    const dirt = (1 - ridge) * 0.3; const k = (1 - dirt) * grain(x, y, 0.05);
    rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 70 + ridge * 160; dat[1] = 165 - top * 75 + r * 80 + dirt * 40; dat[2] = (1 - r) * (140 + top * 100);
  });
  return pbr(p, [2, 2], { bump: 1.3, metal: 1, rough: 1, aniso: 8 });
}

/** old grey-green machine paint, chipped to rust at a fine scale and streaked, 1 m a tile (the landing block, risers, stringer, rails) */
export function paintMaterial() {
  const W = 512, n = fbm(W, W, { seed: 41, cells: 9, oct: 4 }), f = fbm(W, W, { seed: 42, cells: 32, oct: 2 }), g = fbm(W, W, { seed: 43, cells: 2, oct: 3 }), col = [0, 0, 0], rc = [0, 0, 0];
  const st = contrast(fbm(W, 32, { seed: 44, cells: 14, oct: 3, sy: 0.08 }), 2.4), sS = sampler(st, W, 32);
  const p = pixels(W, W, (x, y, i, rgb, dat) => {
    const t = n[i] + (f[i] - 0.5) * 0.3 - g[i] * 0.1, chip = sstep(0.31, 0.28, t), rim = sstep(0.28, 0.31, t) * sstep(0.35, 0.31, t);
    lerp3(col, P.teal, P.tealLit, g[i]);
    lerp3(col, col, P.tealChalk, rim * 0.6);
    const streak = sstep(0.55, 0.95, sS(x / W, y / W * 0.3)) * 0.45;
    lerp3(rc, P.rustDeep, P.rustHot, f[i]);
    lerp3(col, col, rc, Math.max(chip, streak));
    const k = grain(x, y, 0.06) * (0.92 + 0.12 * f[i]); rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 150 - chip * 60 + rim * 20; dat[1] = 150 + chip * 85 + streak * 40; dat[2] = 0;
  });
  return pbr(p, [1, 1], { bump: 1.2, metal: 0, rough: 1 });
}

/** raw rust with dark scale, 1 m a tile (rails, ramp sides, pipes, sign backs, skirting) */
export function rustMaterial({ tint = '#ffffff' } = {}) {
  const W = 512, n = fbm(W, W, { seed: 51, cells: 6, oct: 5 }), f = fbm(W, W, { seed: 52, cells: 28, oct: 2 }), col = [0, 0, 0];
  const p = pixels(W, W, (x, y, i, rgb, dat) => {
    lerp3(col, P.rustDeep, P.rust, clamp01(n[i] * 1.3 - 0.15));
    lerp3(col, col, P.rustHot, sstep(0.55, 0.85, f[i] * 0.5 + n[i] * 0.6) * 0.6);
    const scale = sstep(0.36, 0.28, n[i]); lerp3(col, col, P.grime, scale * 0.55);
    const k = grain(x, y, 0.08) * (0.9 + 0.2 * f[i]); rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 128 + (f[i] - 0.5) * 80 - scale * 30 + (hash(x, y) - 0.5) * 30; dat[1] = 215 + f[i] * 35; dat[2] = 25;
  });
  return pbr(p, [1, 1], { bump: 1.3, metal: 1, rough: 1, color: tint });
}

/** a grimy concrete barrier, 2 m x 1 m a tile: soot streaks from the top, chipped edges, a stencilled zone number */
export function barrierMaterial() {
  const W = 512, H = 256, n = contrast(fbm(W, H, { seed: 61, cells: 4, oct: 5, sy: 0.5 }), 1.8), st = contrast(fbm(W, 32, { seed: 62, cells: 8, oct: 3, sy: 0.25 }), 2), sS = sampler(st, W, 32), col = [0, 0, 0];
  const p = pixels(W, H, (x, y, i, rgb, dat) => {
    const v = y / H, a = n[i], streak = sS(x / W, v * 0.2) * (1 - v) * 0.9;
    lerp3(col, P.concreteLo, P.barrier, a);
    const k = (0.88 + hash(x, y) * 0.14) * (1 - 0.45 * sstep(0.5, 0.9, streak + 0.2 * (1 - v))) * (1 - 0.35 * sstep(0.85, 1, v));
    rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 140 + (a - 0.5) * 60; dat[1] = 225; dat[2] = 0;
  });
  // a stencilled zone number, sprayed and half worn off (drawn on its own canvas, worn there, then laid on)
  const sc = canvas(W, H), sg = sc.getContext('2d'), rnd = rng(63);
  sg.fillStyle = 'rgba(22,18,15,0.62)'; sg.font = '800 64px -apple-system, system-ui, sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText('ZONE 4', W / 2, H * 0.42);
  sg.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 900; k++) { sg.globalAlpha = 0.6; sg.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 4, 1 + rnd() * 3); }
  p.gc.drawImage(sc, 0, 0);
  return pbr(p, [1 / 2, 1], { bump: 1, metal: 0, rough: 1 });
}

/** a bollard's scuffed yellow paint: rubber smudges where bumpers hit it, steel showing through, rust at the foot */
export function postMaterial() {
  const W = 256, H = 256, n = contrast(fbm(W, H, { seed: 71, cells: 4, oct: 4 }), 2.2), f = fbm(W, H, { seed: 72, cells: 18, oct: 2 }), col = [0, 0, 0];
  const p = pixels(W, H, (x, y, i, rgb, dat) => {
    const v = 1 - y / H, rust = sstep(0.62, 0.78, n[i] * 0.7 + sstep(0.22, 0.0, v) * 0.6), scuff = sstep(0.7, 0.85, f[i]) * sstep(0.05, 0.0, Math.abs(v - 0.3) - 0.08);
    lerp3(col, P.yellow, hex('#b88a1c'), f[i]);
    lerp3(col, col, P.rust, rust); lerp3(col, col, P.grime, scuff * 0.8);
    const k = 0.9 + 0.15 * f[i] - sstep(0.15, 0, v) * 0.35; rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 140 - rust * 40; dat[1] = 130 + rust * 100; dat[2] = 0;
  });
  return pbr(p, [1, 1], { bump: 1, metal: 0, rough: 1 });
}

/** grime and wear for a painted canvas (the hazard stripes, the floor markings): knock bits of paint out, lay soot over it */
export function wearCanvas(g, w, h, { seed = 81, chips = 400, soot = 0.35, scale = 1 } = {}) {
  const rnd = rng(seed);
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < chips; k++) { g.globalAlpha = 0.25 + rnd() * 0.6; const s = (1 + rnd() * 4) * scale; g.fillRect(rnd() * w, rnd() * h, s * (1 + rnd() * 3), s); }
  g.restore();
  g.save(); g.globalCompositeOperation = 'source-atop';
  for (let k = 0; k < 40; k++) { const x = rnd() * w, y = rnd() * h, r = (10 + rnd() * 40) * scale, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(24,18,14,${soot * rnd()})`); gr.addColorStop(1, 'rgba(24,18,14,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.restore();
}

/** the room's own dirt, laid over the floor markings canvas (one transparent overlay for the whole room, so it never repeats):
 *  soot along the walls, oil puddles, old skid marks, debris specks. X, Z: metres -> px. */
export function roomGrime(g, W, H, PX, X, Z, room) {
  const rnd = rng(91);
  wearCanvas(g, W, H, { seed: 92, chips: 2600, soot: 0, scale: 0.9 });
  g.save();
  // soot gathered along the walls
  const band = 0.9 * PX;
  for (const [x0, y0, x1, y1] of [[0, 0, 0, band], [0, H, 0, H - band], [0, 0, band, 0], [W, 0, W - band, 0]]) {
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(18,14,11,0.55)'); gr.addColorStop(1, 'rgba(18,14,11,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  // big soft grime patches
  for (let k = 0; k < 26; k++) { const x = rnd() * W, y = rnd() * H, r = (0.6 + rnd() * 1.8) * PX, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(22,17,13,${0.18 + rnd() * 0.22})`); gr.addColorStop(1, 'rgba(22,17,13,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  // oil puddles, irregular (overlapping lobes)
  for (let k = 0; k < 4; k++) {
    const cx = rnd() * W, cy = rnd() * H, s = (0.25 + rnd() * 0.45) * PX;
    for (let l = 0; l < 6; l++) { const x = cx + (rnd() - 0.5) * s * 1.6, y = cy + (rnd() - 0.5) * s, r = s * (0.4 + rnd() * 0.6), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(12,9,8,0.3)'); gr.addColorStop(0.75, 'rgba(12,9,8,0.2)'); gr.addColorStop(1, 'rgba(10,8,7,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  }
  // old skid marks: pairs of dark arcs
  g.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const x = rnd() * W, y = rnd() * H, r = (1.2 + rnd() * 3) * PX, a0 = rnd() * Math.PI * 2, a1 = a0 + (0.4 + rnd() * 0.9) * (rnd() < 0.5 ? -1 : 1);
    for (const o of [0, 0.62 * PX]) { g.strokeStyle = `rgba(14,11,9,${0.12 + rnd() * 0.14})`; g.lineWidth = 0.08 * PX; g.beginPath(); g.arc(x, y, r + o, Math.min(a0, a1), Math.max(a0, a1)); g.stroke(); }
  }
  // rust drips by the walls and debris specks
  for (let k = 0; k < 450; k++) { const v = 28 + rnd() * 30 | 0; g.fillStyle = `rgba(${v + 12},${v + 4},${v},${0.25 + rnd() * 0.35})`; const s = 0.8 + rnd() * 1.4; g.fillRect(rnd() * W, rnd() * H, s, s); }
  g.restore();
  void X; void Z; void room;
}

// ------------------------------------------------------------------------------------------------ neon
/** a lightning bolt path, centred on (x, y), s tall */
function bolt(g, x, y, s) {
  const p = [[0.12, -0.5], [-0.22, 0.04], [0.02, 0.04], [-0.12, 0.5], [0.24, -0.08], [0.0, -0.08], [0.12, -0.5]];
  g.beginPath(); p.forEach(([a, b], i) => (i ? g.lineTo(x + a * s, y + b * s) : g.moveTo(x + a * s, y + b * s))); g.closePath();
}
/** an arrow up and to the right */
function arrow(g, x, y, s) {
  g.beginPath(); g.moveTo(x - 0.35 * s, y + 0.35 * s); g.lineTo(x + 0.3 * s, y - 0.3 * s); g.moveTo(x - 0.05 * s, y - 0.32 * s); g.lineTo(x + 0.32 * s, y - 0.32 * s); g.lineTo(x + 0.32 * s, y + 0.05 * s);
}
const tint = (c, k) => { const [r, g, b] = hex(c); return `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`; };
/** stroke a path or a piece of text as a neon tube: a wide soft glow, a tighter glow, a hot pale core */
function tube(g, color, size, draw) {
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = color; g.strokeStyle = color;
  g.globalAlpha = 0.45; g.shadowBlur = size * 0.55; g.lineWidth = size * 0.11; draw(); g.stroke();
  g.globalAlpha = 0.85; g.shadowBlur = size * 0.2; g.lineWidth = size * 0.075; draw(); g.stroke();
  g.globalAlpha = 1; g.shadowBlur = size * 0.06; g.strokeStyle = tint(color, 0.72); g.lineWidth = size * 0.034; draw(); g.stroke();
  g.restore();
}
const FONT = (s) => `700 ${s}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`;
/** text as tube outlines, letter by letter (so one letter can live on its own canvas); returns each letter's x */
function tubeText(g, text, x, y, size, color, { only = null, skip = null } = {}) {
  g.font = FONT(size); g.textBaseline = 'middle'; g.textAlign = 'left';
  const total = g.measureText(text).width; let x0 = x - total / 2;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], xi = x0 + g.measureText(text.slice(0, i)).width;
    if (ch === ' ' || (only !== null && i !== only) || i === skip) continue;
    tube(g, color, size, () => { g.beginPath(); g.font = FONT(size); g.textBaseline = 'middle'; g.textAlign = 'left'; g.strokeText(ch, xi, y); });
  }
  return total;
}
/** the halo: a soft ellipse of the sign's colour behind the tubes (the cheap stand-in for bloom) */
function halo(g, w, h, color, a = 0.22) {
  const [r, gg, b] = hex(color);
  g.save(); g.scale(1, h / w);
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, `rgba(${r},${gg},${b},${a})`); gr.addColorStop(0.5, `rgba(${r},${gg},${b},${a * 0.35})`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, w, w); g.restore();
}

/** a deterministic flicker: steady with a faint shimmer, and now and then a burst of stutter (seeded: the same every run) */
function flicker(seed, kind) {
  const r = rng(seed), bad = kind === 'bad', period = 89 + (seed % 37), bursts = [];
  for (let t = 1.5 + r() * (bad ? 2 : 9); t < period; ) {
    const dur = bad ? 0.2 + r() * 1.2 : 0.1 + r() * 0.5; bursts.push([t, dur, r() < (bad ? 0.4 : 0.12)]);
    t += dur + (bad ? 1.5 + r() * 5 : 7 + r() * 20);
  }
  return (time) => {
    const tl = ((time % period) + period) % period;
    for (const [s, d, dead] of bursts) if (tl >= s && tl < s + d) { const k = hash(seed + 7, Math.floor(time * 26)); return dead && tl > s + d * 0.4 ? 0.03 : k > 0.42 ? 1 : 0.05 + 0.25 * k; }
    return 0.93 + 0.07 * hash(seed, Math.floor(time * 11));
  };
}
/** a broken letter's buzz: on most of the time with fast drop-outs, dead for a second or two every few seconds */
function buzz(seed) {
  return (time) => {
    const c = time % 7.3; if (c < 1.6) return c < 0.15 || (c > 0.8 && c < 0.9) ? 0.6 : 0.03;
    const k = hash(seed, Math.floor(time * 34)); return k > 0.22 ? 0.72 + 0.28 * hash(seed + 1, Math.floor(time * 60)) : 0.06;
  };
}

/** the signs: [name, at (sign centre, on the wall), facing ('S' = +z from the north wall, 'N', 'E', 'W'), height m, canvas w x h,
 *  draw(g, w, h), colour, flicker kind, light {colour, intensity, dist} or null, broken letter (index) or null] */
const SIGNS = [
  { name: 'dock', at: [5.6, 2.1, -6.0], face: 'S', h: 0.44, cw: 1024, ch: 256, color: '#38f3ff', kind: 'calm', seed: 101,
    draw: (g, w, h) => { halo(g, w, h, '#38f3ff'); tubeText(g, 'DOCK 01', w / 2, h / 2, 132, '#38f3ff'); } },
  { name: 'charge', at: [5.6, 1.66, -6.0], face: 'S', h: 0.34, cw: 1024, ch: 256, color: '#7dff6a', kind: 'calm', seed: 202,
    draw: (g, w, h) => { halo(g, w, h, '#7dff6a', 0.18); const tw = tubeText(g, 'CHARGE', w / 2 + 70, h / 2, 128, '#7dff6a'); tube(g, '#7dff6a', 128, () => bolt(g, w / 2 + 70 - tw / 2 - 90, h / 2, 150)); } },
  { name: 'spills', at: [2.9, 1.9, -6.0], face: 'S', h: 0.42, cw: 1024, ch: 256, color: '#ffb02e', kind: 'bad', seed: 303, broken: 5,
    draw: (g, w, h, opt) => { if (!opt.only) halo(g, w, h, '#ffb02e', 0.2); tubeText(g, 'NO SPILLS', w / 2, h / 2, 122, '#ffb02e', opt); } },
  { name: 'reclaim', at: [8.0, 1.9, 3.25], face: 'W', h: 0.46, cw: 1024, ch: 256, color: '#ff3ea5', kind: 'calm', seed: 404,   // over the crab bay (the east door is at z 0.2-1.8)
    draw: (g, w, h) => { halo(g, w, h, '#ff3ea5'); tubeText(g, 'RECLAIM', w / 2, h / 2, 136, '#ff3ea5'); } },
  { name: 'landing', at: [-8.0, 1.95, -2.4], face: 'E', h: 0.5, cw: 1024, ch: 256, color: '#7dff6a', kind: 'calm', seed: 505,
    draw: (g, w, h) => { halo(g, w, h, '#7dff6a', 0.18); tubeText(g, 'LANDING', w / 2 - 70, h / 2, 118, '#7dff6a'); tube(g, '#7dff6a', 118, () => arrow(g, w / 2 + 300, h / 2, 130)); } },
  { name: 'sort', at: [0.0, 1.95, 6.0], face: 'N', h: 0.36, cw: 1024, ch: 128, color: '#ff3ea5', kind: 'calm', seed: 606,
    draw: (g, w, h) => { halo(g, w, h, '#ff3ea5', 0.16); tubeText(g, 'SORT · CRUSH · REPEAT', w / 2, h / 2, 68, '#ff3ea5'); } },
];
// four lights carry the signs' glow into the room (the sort sign by the start lives on the cove light)
const LIGHTS = [
  { name: 'dock', signs: ['dock', 'charge'], color: '#6ff5d8', at: [5.6, 1.85, -5.5], intensity: 3.2, dist: 5.5 },
  { name: 'spills', signs: ['spills'], color: '#ffa83a', at: [2.9, 1.75, -5.55], intensity: 2.6, dist: 5 },
  { name: 'reclaim', signs: ['reclaim'], color: '#ff4aa8', at: [7.55, 1.75, 3.25], intensity: 3.0, dist: 5.5 },
  { name: 'landing', signs: ['landing'], color: '#8cff78', at: [-7.55, 1.8, -2.4], intensity: 2.6, dist: 5 },
];
const FACE = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };
const NORMAL = { S: [0, 0, 1], N: [0, 0, -1], E: [1, 0, 0], W: [-1, 0, 0] };

/** build the signs into the scene: -> { signs: [{ name, mat, light, level }], tick(t), setQuality(level), backing } */
export function buildNeon(scene, backingMat) {
  const signs = [], backs = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const plane = (c, w, h, at, face, off) => {
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat), n = NORMAL[face];
    mesh.position.set(at[0] + n[0] * off, at[1], at[2] + n[2] * off); mesh.rotation.y = FACE[face]; mesh.renderOrder = 3;
    scene.add(mesh); return { mesh, mat };
  };
  for (const s of SIGNS) {
    const w = (s.h * s.cw) / s.ch, n = NORMAL[s.face];
    const draw = (opt) => { const c = canvas(s.cw, s.ch); s.draw(c.getContext('2d'), s.cw, s.ch, opt); return c; };
    const main = plane(draw(s.broken != null ? { skip: s.broken } : {}), w, s.h, s.at, s.face, 0.045);
    const sign = { name: s.name, mat: main.mat, mesh: main.mesh, light: null, level: 1, gain: 1, fn: flicker(s.seed, s.kind) };
    if (s.broken != null) {
      const b = plane(draw({ only: s.broken }), w, s.h, s.at, s.face, 0.046);
      sign.broken = { mat: b.mat, fn: buzz(s.seed + 50) };
    }
    signs.push(sign);
    // the sign's backing: a rusted steel tray, 3 cm deep, a little narrower than the glow
    const bw = w * 0.74, bh = s.h * 0.66, g = new THREE.BoxGeometry(bw, bh, 0.03); boxUV(g);
    e.set(0, FACE[s.face], 0); q.setFromEuler(e); m4.compose(new THREE.Vector3(s.at[0] + n[0] * 0.016, s.at[1], s.at[2] + n[2] * 0.016), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m4); backs.push(g);
    // two small stand-off brackets top and bottom are part of the tray: the tubes float 3 cm in front of it
  }
  const backing = new THREE.Mesh(mergeGeometries(backs), backingMat); backing.castShadow = false; backing.receiveShadow = true; scene.add(backing);
  const lights = [];
  for (const L of LIGHTS) {
    const light = new THREE.PointLight(L.color, L.intensity, L.dist, 2); light.position.set(...L.at); light.castShadow = false; scene.add(light);
    const own = signs.filter((s) => L.signs.includes(s.name)); for (const s of own) s.light = light;
    lights.push({ light, base: L.intensity, signs: own });
  }
  let quality = 'high';
  function tick(t) {
    for (const s of signs) {
      s.level = s.fn(t); s.mat.color.setScalar(s.gain * s.level);
      if (s.broken) { const b = s.broken.fn(t) * s.level; s.broken.mat.color.setScalar(s.gain * b); s.brokenLevel = b; }
    }
    for (const L of lights) {
      let lv = 0; for (const s of L.signs) lv += s.broken ? s.level * 0.88 + (s.brokenLevel || 0) * 0.12 : s.level;
      L.light.intensity = quality === 'high' ? L.base * (lv / L.signs.length) : 0;
    }
  }
  /** 'high': the four sign lights on; 'low': off (the signs still glow) - for the frame-time ladder */
  function setQuality(level) { quality = level; for (const L of lights) L.light.visible = level === 'high'; }
  tick(0);
  return { signs: signs.map((s) => ({ name: s.name, get mat() { return s.mat; }, light: s.light, get level() { return s.level; } })), tick, setQuality, backing, lights };
}

// ------------------------------------------------------------------------------------------------ pipes
/** a rusted pipe run high on the walls (2.25-2.45 m: nothing on the floor that the trolley could drive through), with brackets every
 *  2 m and a few short drops into junction boxes; one merged mesh, one draw call. Kept off the north wall's east end (the dock gantry). */
export function buildPipes(scene, mat) {
  const parts = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pipe = (a, b, r) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B), g = new THREE.CylinderGeometry(r, r, L, 10, 1, true);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r * 3, uv.getY(i) * L);
    q.setFromUnitVectors(up, B.clone().sub(A).normalize()); m4.compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(m4); parts.push(g);
  };
  const box = (c, s) => { const g = new THREE.BoxGeometry(...s); boxUV(g, c); g.translate(...c); parts.push(g); };
  const runs = [
    [[-7.86, 2.42, 5.9], [-7.86, 2.42, -5.9], 0.07], [[-7.9, 2.42, -5.86], [4.25, 2.42, -5.86], 0.07],
    [[-7.9, 2.25, 5.86], [7.9, 2.25, 5.86], 0.055], [[7.86, 2.42, 5.9], [7.86, 2.42, -4.2], 0.07],
  ];
  for (const [a, b, r] of runs) {
    pipe(a, b, r);
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.floor(L / 2);
    for (let k = 0; k <= n; k++) {
      const t = k / Math.max(1, n), x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
      box([x, a[1], z], alongX ? [0.05, r * 2 + 0.04, r * 2 + 0.05] : [r * 2 + 0.05, r * 2 + 0.04, 0.05]);   // a clamp band
      pipe([x, a[1] + r + 0.02, z], [x, a[1] + r + 0.12, z], 0.012);   // its hanger rod
    }
  }
  // short drops into junction boxes (all above 1.4 m)
  for (const [x, z, y0, side] of [[-7.86, 1.2, 2.42, 'x'], [-1.5, 5.86, 2.25, 'z'], [4.4, 5.86, 2.25, 'z'], [7.86, -1.6, 2.42, 'x']]) {   // none over a door
    pipe([x, y0, z], [x, 1.62, z], 0.03);
    box([x + (side === 'x' ? Math.sign(-x) * 0.02 : 0), 1.5, z + (side === 'z' ? Math.sign(-z) * 0.02 : 0)], side === 'x' ? [0.1, 0.26, 0.22] : [0.22, 0.26, 0.1]);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g)), mat);
  mesh.castShadow = false; mesh.receiveShadow = true; scene.add(mesh);
  return mesh;
}

// the world round the hall (world_decor.js) draws with the same helpers
export { pixels, pbr, tex, contrast, sampler, hash, sstep, clamp01, lerp3, hex, grain, tube, halo, tubeText, canvas as makeCanvas, P as PALETTE };
