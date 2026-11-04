// world_decor.js - the textures of the world round the hall, drawn in code at load from fixed seeds like the hall's (decor.js): wet
// rusty mud, dead grass, old asphalt, worn pavers, ruined facades (concrete and brick, windows dark, broken, boarded, a few still lit),
// tar roofs, chain-link, iron railings, a broken brick wall, dead bark, cadmium-yellow toxic water, rusty tyre tracks, a corrugated
// container, painted road marks, the ruined skyline, the top view's labels. Every map is 512 px or less (the skyline 1024 x 256).
// Generic words only: no names, no logos, no brands.
import * as THREE from './vendor/three.module.js';
import { rng, fbm, pixels, pbr, tex, contrast, sampler, hash, sstep, clamp01, lerp3, hex, grain, tube, halo, tubeText, makeCanvas, PALETTE as P } from './decor.js';

const canvasTex = (c, { srgb = true, rep = [1, 1], aniso = 4, wrap = true } = {}) => {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t;
};
const W_ = (m) => { m.userData.worldUV = true; return m; };   // textures in metres (boxUV / the ground's own UVs)

/** wet forest mud, 3 m a tile: dark brown with rusty iron-oxide streaks and blooms, glossy wet hollows, churned clods */
export function mudMaterial() {
  const W = 512, a = contrast(fbm(W, W, { seed: 701, cells: 5, oct: 5 }), 1.9), b = fbm(W, W, { seed: 702, cells: 18, oct: 3 }), c = contrast(fbm(W, W, { seed: 703, cells: 3, oct: 3 }), 2.2);
  const col = [0, 0, 0], dark = hex('#1d140e'), brown = hex('#3b2a1c'), rust = hex('#6a3516'), ochre = hex('#7c5121'), wet = hex('#120c09');
  const p = pixels(W, W, (x, y, i, rgb, dat) => {
    const h = a[i] * 0.7 + b[i] * 0.3, hollow = sstep(0.42, 0.25, h), streak = sstep(0.62, 0.82, c[i] * 0.6 + b[i] * 0.5);
    lerp3(col, dark, brown, clamp01(h * 1.3 - 0.1));
    lerp3(col, col, rust, streak * 0.75); lerp3(col, col, ochre, sstep(0.86, 0.97, b[i] + c[i] * 0.2) * 0.4);
    lerp3(col, col, wet, hollow * 0.7);
    const k = grain(x, y, 0.07); rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 90 + h * 150; dat[1] = 228 - hollow * 95 + b[i] * 20; dat[2] = 0;   // the hollows hold water: wet, a little shiny
  });
  // clods and ruts: short dark strokes
  const r = rng(704), { gc, gd } = p;
  for (let k = 0; k < 90; k++) { const x = r() * W, y = r() * W, s = 2 + r() * 4; gc.fillStyle = `rgba(30,18,10,${0.2 + r() * 0.25})`; gc.beginPath(); gc.ellipse(x, y, s * 1.6, s, r() * 3, 0, Math.PI * 2); gc.fill(); gd.fillStyle = 'rgb(200,215,0)'; gd.beginPath(); gd.ellipse(x - 1, y - 1, s, s * 0.6, 0, 0, Math.PI * 2); gd.fill(); }
  return W_(pbr(p, [1 / 3, 1 / 3], { bump: 1.6, metal: 0, rough: 1 }));
}

/** dead grass, 2.5 m a tile: straw and grey blades over bald dry soil, a few dark weeds */
export function grassMaterial() {
  const W = 512, a = contrast(fbm(W, W, { seed: 711, cells: 4, oct: 5 }), 1.8), b = fbm(W, W, { seed: 712, cells: 22, oct: 2 });
  const col = [0, 0, 0], soil = hex('#3c3125'), straw = hex('#7a6a44'), grey = hex('#5f5a4a'), pale = hex('#958459');
  const p = pixels(W, W, (x, y, i, rgb, dat) => {
    const bald = sstep(0.36, 0.22, a[i]);
    lerp3(col, grey, straw, b[i]); lerp3(col, col, pale, sstep(0.75, 0.95, b[i]) * 0.5); lerp3(col, col, soil, bald);
    const k = grain(x, y, 0.12); rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 120 + (1 - bald) * 60 * b[i]; dat[1] = 235; dat[2] = 0;
  });
  const r = rng(713), { gc, gd } = p; gc.lineCap = 'round';
  for (let k = 0; k < 2600; k++) {   // blades
    const x = r() * W, y = r() * W, L = 4 + r() * 9, a0 = -Math.PI / 2 + (r() - 0.5) * 1.6, v = 90 + r() * 70 | 0;
    gc.strokeStyle = `rgba(${v + 20},${v + 8},${v - 30},${0.35 + r() * 0.4})`; gc.lineWidth = 0.8 + r() * 0.8;
    gc.beginPath(); gc.moveTo(x, y); gc.lineTo(x + Math.cos(a0) * L, y + Math.sin(a0) * L); gc.stroke();
    gd.strokeStyle = 'rgb(210,235,0)'; gd.lineWidth = 0.8; gd.beginPath(); gd.moveTo(x, y); gd.lineTo(x + Math.cos(a0) * L, y + Math.sin(a0) * L); gd.stroke();
  }
  return W_(pbr(p, [1 / 2.5, 1 / 2.5], { bump: 1.2, metal: 0, rough: 1 }));
}

/** old asphalt, 4 m a tile: dark aggregate, crazed cracks, patched squares, oil */
export function asphaltMaterial() {
  const W = 512, a = contrast(fbm(W, W, { seed: 721, cells: 4, oct: 5 }), 1.5), b = fbm(W, W, { seed: 722, cells: 40, oct: 2 });
  const col = [0, 0, 0], lo = hex('#232325'), hi = hex('#3a3937'), oil = hex('#0e0d0d');
  const p = pixels(W, W, (x, y, i, rgb, dat) => {
    lerp3(col, lo, hi, a[i] * 0.6 + b[i] * 0.4);
    const spk = hash(x * 5 + 1, y * 3 + 9), o = sstep(0.78, 0.92, b[i] * 0.3 + (1 - a[i]) * 0.75) * 0.5;
    let k = 0.92 + spk * 0.16; if (spk > 0.985) k += 0.35;
    rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k; if (o > 0) lerp3(rgb, rgb, oil, o);
    dat[0] = 140 + (spk - 0.5) * 70; dat[1] = 215 - o * 90; dat[2] = 0;
  });
  const r = rng(723), { gc, gd } = p;
  for (let k = 0; k < 4; k++) { const x = r() * W * 0.8, y = r() * W * 0.8, w = 50 + r() * 90, h = 40 + r() * 70; gc.fillStyle = `rgba(${60 + r() * 20 | 0},${60 + r() * 18 | 0},${58 + r() * 15 | 0},0.55)`; gc.fillRect(x, y, w, h); gc.strokeStyle = 'rgba(10,10,10,0.6)'; gc.lineWidth = 1.5; gc.strokeRect(x, y, w, h); gd.strokeStyle = 'rgb(60,230,0)'; gd.strokeRect(x, y, w, h); }
  for (let c = 0; c < 26; c++) {   // cracks
    let x = r() * W, y = r() * W, ang = r() * Math.PI * 2; const steps = 15 + (r() * 45) | 0;
    gc.strokeStyle = 'rgba(8,8,8,0.75)'; gd.strokeStyle = 'rgb(40,240,0)'; gc.lineWidth = gd.lineWidth = 1 + r();
    gc.beginPath(); gd.beginPath(); gc.moveTo(x, y); gd.moveTo(x, y);
    for (let s = 0; s < steps; s++) { ang += (r() - 0.5) * 1.1; x += Math.cos(ang) * 5; y += Math.sin(ang) * 5; gc.lineTo(x, y); gd.lineTo(x, y); }
    gc.stroke(); gd.stroke();
  }
  return W_(pbr(p, [1 / 4, 1 / 4], { bump: 1.1, metal: 0, rough: 1 }));
}

/** worn concrete pavers, 2 m a tile: 0.5 m slabs, dark joints with dead weeds, a few cracked or missing */
export function paversMaterial() {
  const W = 512, S = W / 4, a = fbm(W, W, { seed: 731, cells: 6, oct: 4 }), col = [0, 0, 0], lo = hex('#4a4640'), hi = hex('#6b665c');
  const tone = []; const r = rng(732); for (let k = 0; k < 16; k++) tone.push(0.75 + r() * 0.35);
  const p = pixels(W, W, (x, y, i, rgb, dat) => {
    const cx = Math.floor(x / S), cy = Math.floor(y / S), jx = Math.min(x % S, S - (x % S)), jy = Math.min(y % S, S - (y % S)), joint = sstep(4, 1, Math.min(jx, jy));
    lerp3(col, lo, hi, a[i]); const t = tone[(cx + cy * 4) % 16], k = t * grain(x, y, 0.06) * (1 - 0.75 * joint);
    rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k;
    dat[0] = 150 - joint * 120; dat[1] = 220; dat[2] = 0;
  });
  const { gc, gd } = p;
  for (let k = 0; k < 2; k++) { const cx = (r() * 4 | 0) * S, cy = (r() * 4 | 0) * S; gc.fillStyle = 'rgba(30,24,18,0.9)'; gc.fillRect(cx + 3, cy + 3, S - 6, S - 6); gd.fillStyle = 'rgb(20,240,0)'; gd.fillRect(cx + 3, cy + 3, S - 6, S - 6); }   // missing slabs: soil
  for (let k = 0; k < 9; k++) { let x = r() * W, y = r() * W, ang = r() * 6.3; gc.strokeStyle = 'rgba(12,10,8,0.6)'; gc.lineWidth = 1.2; gc.beginPath(); gc.moveTo(x, y); for (let s = 0; s < 14; s++) { ang += (r() - 0.5); x += Math.cos(ang) * 4; y += Math.sin(ang) * 4; gc.lineTo(x, y); } gc.stroke(); }
  for (let k = 0; k < 160; k++) { const along = r() < 0.5, x = along ? r() * W : (r() * 4 | 0) * S, y = along ? (r() * 4 | 0) * S : r() * W; gc.fillStyle = `rgba(${70 + r() * 30 | 0},${60 + r() * 20 | 0},35,0.7)`; gc.fillRect(x - 1, y - 2, 2 + r() * 3, 3 + r() * 4); }   // dead weeds in the joints
  return W_(pbr(p, [1 / 2, 1 / 2], { bump: 1.2, metal: 0, rough: 1 }));
}

/** a ruined facade, 6 m wide x 6 m tall a tile (two storeys of 3 m, a window every 2 m): concrete (style 0) or brick (style 1). Windows
 *  dark, broken (jagged holes), boarded; soot over the openings, rust tears; a few still lit (the emissive map) */
export function facadeMaterial(style = 0) {
  const W = 512, H = 512, PX = W / 6, n = contrast(fbm(256, 256, { seed: 741 + style, cells: 5, oct: 4 }), 1.6), sn = sampler(n, 256, 256);
  const c = makeCanvas(W, H), g = c.getContext('2d'), e = makeCanvas(256, 256), ge = e.getContext('2d'), r = rng(745 + style);
  const id = g.createImageData(W, H), D = id.data, base = style ? hex('#5a2f22') : hex('#57534c'), base2 = style ? hex('#3d2019') : hex('#3e3b36');
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const v = sn(x / W, y / H), k = grain(x, y, 0.08), q = i * 4; let cr = base[0] + (base2[0] - base[0]) * v, cg = base[1] + (base2[1] - base[1]) * v, cb = base[2] + (base2[2] - base[2]) * v;
    if (style) { const row = Math.floor(y / 6), off = (row % 2) * 9, mort = (y % 6 < 1) || ((x + off) % 18 < 1); if (mort) { cr = cr * 0.55 + 40; cg = cg * 0.55 + 36; cb = cb * 0.55 + 32; } }
    D[q] = cr * k; D[q + 1] = cg * k; D[q + 2] = cb * k; D[q + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  const lit = new Set([3, 8]);
  for (let f = 0; f < 2; f++) for (let w = 0; w < 3; w++) {
    const x = (w * 2 + 0.45) * PX, y = (f * 3 + 0.75) * PX, ww = 1.1 * PX, wh = 1.45 * PX, kind = r(), idx = f * 3 + w;
    // soot above, rust tears below
    const sg = g.createLinearGradient(0, y - wh * 0.9, 0, y); sg.addColorStop(0, 'rgba(10,8,7,0)'); sg.addColorStop(1, 'rgba(10,8,7,0.55)'); g.fillStyle = sg; g.fillRect(x - 6, y - wh * 0.9, ww + 12, wh * 0.9);
    const rg = g.createLinearGradient(0, y + wh, 0, y + wh + 60 + r() * 50); rg.addColorStop(0, 'rgba(110,50,20,0.55)'); rg.addColorStop(1, 'rgba(110,50,20,0)'); g.fillStyle = rg; g.fillRect(x + ww * 0.2, y + wh, ww * 0.25, 110);
    g.fillStyle = '#2c2a27'; g.fillRect(x - 4, y - 4, ww + 8, wh + 8);   // the frame
    if (lit.has(idx + style)) {   // still lit: a dim warm room behind a half-drawn blind
      g.fillStyle = '#4a3420'; g.fillRect(x, y, ww, wh); g.fillStyle = '#2a2018'; g.fillRect(x, y, ww, wh * 0.42);
      const ex = x * 256 / W, ey = y * 256 / H, ew = ww * 256 / W, eh = wh * 256 / H, eg = ge.createRadialGradient(ex + ew * 0.5, ey + eh * 0.75, 1, ex + ew * 0.5, ey + eh * 0.75, eh * 0.7);
      eg.addColorStop(0, '#ffb35a'); eg.addColorStop(1, '#3a1e08'); ge.fillStyle = eg; ge.fillRect(ex, ey + eh * 0.42, ew, eh * 0.58); ge.fillStyle = '#1a0e05'; ge.fillRect(ex, ey, ew, eh * 0.42);
    }
    else if (kind < 0.3) {   // boarded up: a few weathered planks at odd angles over the dark hole, nail heads
      g.fillStyle = '#0d0f12'; g.fillRect(x, y, ww, wh);
      for (let b = 0; b < 3; b++) { const t = 0.5 + r() * 0.35 | 0, v = 48 + r() * 30 | 0; g.save(); g.translate(x + ww / 2 + (r() - 0.5) * 6, y + (0.22 + b * 0.3 + (r() - 0.5) * 0.08) * wh); g.rotate((r() - 0.5) * 0.5); g.fillStyle = `rgb(${v + 22},${v + 10},${v})`; g.fillRect(-ww * 0.58, -9, ww * 1.16, 18); g.fillStyle = 'rgba(20,14,10,0.5)'; g.fillRect(-ww * 0.58, 6, ww * 1.16, 3); g.fillStyle = '#2a2622'; g.fillRect(-ww * 0.5, -2, 3, 3); g.fillRect(ww * 0.47, -2, 3, 3); g.restore(); void t; }
    }
    else {
      g.fillStyle = '#0d0f12'; g.fillRect(x, y, ww, wh); g.fillStyle = 'rgba(80,95,105,0.35)';   // dark glass, shards left in the corners
      if (kind < 0.75) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + ww * (0.3 + r() * 0.4), y); g.lineTo(x + ww * 0.15, y + wh * (0.2 + r() * 0.3)); g.lineTo(x, y + wh * 0.5); g.fill(); g.beginPath(); g.moveTo(x + ww, y + wh); g.lineTo(x + ww * 0.6, y + wh); g.lineTo(x + ww, y + wh * 0.55); g.fill(); }
      else { g.fillRect(x + 2, y + 2, ww - 4, wh - 4); g.strokeStyle = 'rgba(200,210,215,0.25)'; g.beginPath(); g.moveTo(x + ww * 0.5, y + wh * 0.4); for (let s = 0; s < 6; s++) { g.moveTo(x + ww * 0.5, y + wh * 0.4); g.lineTo(x + r() * ww, y + r() * wh); } g.stroke(); }
    }
    g.fillStyle = 'rgba(20,18,16,0.8)'; g.fillRect(x - 8, y + wh + 2, ww + 16, 7);   // the sill
  }
  // a floor band between the storeys, and soot at the foot
  g.fillStyle = style ? 'rgba(40,22,16,0.6)' : 'rgba(30,28,25,0.55)'; g.fillRect(0, 2.92 * PX, W, 10);
  const fg = g.createLinearGradient(0, H - 70, 0, H); fg.addColorStop(0, 'rgba(12,9,7,0)'); fg.addColorStop(1, 'rgba(12,9,7,0.7)'); g.fillStyle = fg; g.fillRect(0, H - 70, W, 70);
  const map = canvasTex(c, { rep: [1 / 6, 1 / 6] }), em = canvasTex(e, { rep: [1 / 6, 1 / 6] });
  return W_(new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: '#ffffff', emissiveIntensity: 0.5, roughness: 0.92, metalness: 0.05 }));
}

/** a tar-and-gravel roof, 4 m a tile, with soot and puddle stains */
export function roofMaterial() {
  const W = 256, a = contrast(fbm(W, W, { seed: 751, cells: 4, oct: 4 }), 1.7), col = [0, 0, 0], lo = hex('#1f1e1d'), hi = hex('#3b3935');
  const p = pixels(W, W, (x, y, i, rgb, dat) => { lerp3(col, lo, hi, a[i]); const k = grain(x, y, 0.18); rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k; dat[0] = 128 + (hash(x, y) - 0.5) * 90; dat[1] = 230 - sstep(0.3, 0.1, a[i]) * 120; dat[2] = 0; });
  return W_(pbr(p, [1 / 4, 1 / 4], { bump: 1.2, metal: 0, rough: 1 }));
}

/** rusty chain-link, 1 m a tile (alpha), for both sides */
export function chainLinkMaterial() {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d'); g.clearRect(0, 0, S, S);
  const r = rng(761); g.lineWidth = 3.2; g.lineCap = 'round';
  for (let k = -S; k < 2 * S; k += 24) for (const d of [1, -1]) { g.strokeStyle = `rgb(${110 + r() * 40 | 0},${90 + r() * 25 | 0},${70 + r() * 15 | 0})`; g.beginPath(); g.moveTo(k, 0); g.lineTo(k + d * S, S); g.stroke(); }
  g.globalCompositeOperation = 'source-atop';
  for (let k = 0; k < 60; k++) { const x = r() * S, y = r() * S, rad = 6 + r() * 26, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(120,52,18,0.9)'); gr.addColorStop(1, 'rgba(120,52,18,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  const map = canvasTex(c, { rep: [1, 1] });
  return new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.6 });
}

/** iron railings (alpha): bars with spear heads between two rails, 0.6 m a tile along, 1.15 m tall */
export function railingMaterial() {
  const Wd = 128, H = 256, c = makeCanvas(Wd, H), g = c.getContext('2d'); g.clearRect(0, 0, Wd, H);
  const bar = (x) => { g.fillStyle = '#3a2c25'; g.fillRect(x - 3, 18, 6, H - 18); g.beginPath(); g.moveTo(x - 7, 22); g.lineTo(x, 2); g.lineTo(x + 7, 22); g.fill(); };
  for (const x of [16, 48, 80, 112]) bar(x);
  g.fillStyle = '#31241e'; g.fillRect(0, 34, Wd, 7); g.fillRect(0, H - 22, Wd, 8);
  const r = rng(771); g.globalCompositeOperation = 'source-atop'; for (let k = 0; k < 120; k++) { g.fillStyle = `rgba(${110 + r() * 50 | 0},${50 + r() * 20 | 0},20,${0.3 + r() * 0.5})`; g.fillRect(r() * Wd, r() * H, 2 + r() * 5, 2 + r() * 8); }
  const map = canvasTex(c, { rep: [1 / 0.6, 1 / 1.15] });
  return new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.7 });
}

/** a broken brick wall, 2 m x 1 m a tile: sooty bricks, crumbling mortar, chipped faces */
export function brickMaterial() {
  const W = 512, H = 256, n = contrast(fbm(W, H, { seed: 781, cells: 4, oct: 4, sy: 0.5 }), 1.8), col = [0, 0, 0], tones = [], r = rng(782);
  for (let k = 0; k < 64; k++) tones.push(0.7 + r() * 0.45);
  const brick = hex('#5c2e20'), dark = hex('#311813');
  const p = pixels(W, H, (x, y, i, rgb, dat) => {
    const row = Math.floor(y / 16), off = (row % 2) * 16, bx = Math.floor((x + off) / 32), mort = (y % 16 < 2) || ((x + off) % 32 < 2);
    lerp3(col, brick, dark, n[i]); const t = tones[(row * 7 + bx) % 64], k = t * grain(x, y, 0.08);
    if (mort) { rgb[0] = 58; rgb[1] = 52; rgb[2] = 46; } else { rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k; }
    const soot = sstep(0.55, 0.85, n[i]) * 0.6; rgb[0] *= 1 - soot; rgb[1] *= 1 - soot; rgb[2] *= 1 - soot;
    dat[0] = mort ? 40 : 160 + (hash(x, y) - 0.5) * 40; dat[1] = 225; dat[2] = 0;
  });
  return W_(pbr(p, [1 / 2, 1], { bump: 1.4, metal: 0, rough: 1 }));
}

/** dead bark: grey-brown, split along the grain, 0.5 m round x 1.5 m along a tile */
export function barkMaterial() {
  const Wd = 128, H = 256, n = fbm(Wd, H, { seed: 791, cells: 6, oct: 4, sy: 0.15 }), col = [0, 0, 0], lo = hex('#231d18'), hi = hex('#5c544b');
  const p = pixels(Wd, H, (x, y, i, rgb, dat) => { const v = n[i], split = sstep(0.3, 0.18, v); lerp3(col, lo, hi, clamp01(v * 1.4 - 0.2)); const k = (1 - split * 0.75) * grain(x, y, 0.1); rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k; dat[0] = 80 + v * 170 - split * 70; dat[1] = 235; dat[2] = 0; });
  return pbr(p, [2, 1], { bump: 2.0, metal: 0, rough: 1 });
}

/** cadmium-yellow toxic water: an uneven pool, scummy swirls, a bright sheen (alpha in the map; the emissive map glows) */
export function puddleMaterial() {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(801), m = S / 2;
  g.clearRect(0, 0, S, S);
  for (let k = 0; k < 18; k++) { const a = r() * 6.28, d = r() * m * 0.42, x = m + Math.cos(a) * d, y = m + Math.sin(a) * d, rad = m * (0.3 + r() * 0.26); const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(227,181,5,0.97)'); gr.addColorStop(0.78, 'rgba(200,148,0,0.94)'); gr.addColorStop(0.9, 'rgba(92,46,16,0.85)'); gr.addColorStop(1, 'rgba(70,34,12,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 6.29); g.fill(); }   // #E3B505, a rust-brown rim
  g.globalCompositeOperation = 'source-atop';
  for (let k = 0; k < 40; k++) { const x = r() * S, y = r() * S, rad = 6 + r() * 30; g.strokeStyle = `rgba(${90 + r() * 60 | 0},${70 + r() * 40 | 0},10,${0.25 + r() * 0.35})`; g.lineWidth = 1 + r() * 3; g.beginPath(); g.arc(x, y, rad, r() * 6, r() * 6 + 2.5); g.stroke(); }   // scum
  for (let k = 0; k < 14; k++) { const x = r() * S, y = r() * S, rad = 4 + r() * 12; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,250,170,0.9)'); gr.addColorStop(1, 'rgba(255,240,120,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }   // glints
  const map = canvasTex(c, { wrap: false });
  return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#c89400', emissiveIntensity: 0.6, transparent: true, roughness: 0.14, metalness: 0.0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });   // glow #C89400 (world_view.js tames its reflection)
}

/** a rusty tyre print in the mud: a 6.5 cm band with chevron treads, wet dark edges (alpha), drawn along x */
export function trackMaterial() {
  const c = makeCanvas(128, 32), g = c.getContext('2d'); g.clearRect(0, 0, 128, 32);
  // pressed-in wet mud (dark), raised rims in the rust tile's tint (0.35, 0.21, 0.12), the tread's chevrons squeezed up bright rust: it has to
  // read against the forest's own rusty mud
  g.fillStyle = 'rgba(14,9,6,0.78)'; g.fillRect(0, 5, 128, 22); g.fillStyle = 'rgba(89,54,31,0.75)'; g.fillRect(0, 2, 128, 3); g.fillRect(0, 27, 128, 3);
  g.strokeStyle = 'rgba(184,98,42,0.9)'; g.lineWidth = 3; for (let x = -8; x < 136; x += 12) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x + 6, 16); g.lineTo(x, 24); g.stroke(); }
  const map = canvasTex(c, { rep: [1, 1] }); map.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.85, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** old ruts in the mud along the forest's track (alpha): two dark wet grooves, 1 m a tile along */
export function rutMaterial() {
  const c = makeCanvas(64, 128), g = c.getContext('2d'), r = rng(811); g.clearRect(0, 0, 64, 128);
  for (const x0 of [6, 46]) { for (let y = 0; y < 128; y += 2) { const w = 9 + r() * 4, x = x0 + (r() - 0.5) * 2; g.fillStyle = `rgba(16,10,7,${0.45 + r() * 0.2})`; g.fillRect(x, y, w, 2); } g.fillStyle = 'rgba(96,48,18,0.35)'; g.fillRect(x0 + 2, 0, 3, 128); }
  const map = canvasTex(c, { rep: [1, 1] });
  return new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });   // wet but dull
}

/** a corrugated container's steel (2.4 m a tile), rusting through */
export function containerMaterial() {
  const W = 256, n = fbm(W, W, { seed: 821, cells: 5, oct: 4 }), col = [0, 0, 0], paint = hex('#b9b3a8'), rust = hex('#5a2a12');
  const p = pixels(W, W, (x, y, i, rgb, dat) => { const rib = Math.sin((x / W) * Math.PI * 2 * 14), r0 = sstep(0.6, 0.78, n[i] + (y / W) * 0.25); lerp3(col, paint, rust, r0); const k = (0.86 + 0.14 * rib) * grain(x, y, 0.06); rgb[0] = col[0] * k; rgb[1] = col[1] * k; rgb[2] = col[2] * k; dat[0] = 128 + rib * 90; dat[1] = 150 + r0 * 90; dat[2] = (1 - r0) * 120; });
  return W_(pbr(p, [1 / 2.4, 1 / 2.4], { bump: 1.6, metal: 1, rough: 1 }));   // tinted per container by its instance colour
}

/** worn road paint (white, tinted yellow by vertex colour), chipped (alpha), 1 m a tile */
export function paintMarkMaterial() {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(831); g.fillStyle = '#e8e4da'; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 420; k++) { g.globalAlpha = 0.3 + r() * 0.7; const s = 1 + r() * 7; g.fillRect(r() * S, r() * S, s * (1 + r() * 2), s); }
  const map = canvasTex(c, { rep: [1, 1] });
  return new THREE.MeshStandardMaterial({ map, vertexColors: true, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** a dark oil stain (alpha), for the yard's concrete */
export function stainMaterial() {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(841), m = S / 2; g.clearRect(0, 0, S, S);
  for (let k = 0; k < 10; k++) { const x = m + (r() - 0.5) * m * 0.7, y = m + (r() - 0.5) * m * 0.7, rad = m * (0.25 + r() * 0.35), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(8,6,5,0.75)'); gr.addColorStop(0.7, 'rgba(10,8,6,0.45)'); gr.addColorStop(1, 'rgba(10,8,6,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  return new THREE.MeshStandardMaterial({ map: canvasTex(c, { wrap: false }), transparent: true, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** the ruined skyline round the world (alpha, 1024 x 256 for 1/4 of the ring): broken towers, a crane, a few lit windows */
export function skylineTexture() {
  const W = 1024, H = 256, c = makeCanvas(W, H), g = c.getContext('2d'), r = rng(851); g.clearRect(0, 0, W, H);
  const lit = [];
  for (let x = -20; x < W + 20;) {
    const w = 30 + r() * 80, h = 40 + r() * 170, top = H - h; g.fillStyle = `rgb(${16 + r() * 8 | 0},${14 + r() * 6 | 0},${15 + r() * 6 | 0})`;
    g.beginPath(); g.moveTo(x, H); g.lineTo(x, top + (r() < 0.4 ? r() * 30 : 0));
    if (r() < 0.45) { const n = 3 + (r() * 4 | 0); for (let k = 1; k <= n; k++) g.lineTo(x + (w * k) / n, top + r() * 40); }   // broken top
    else g.lineTo(x + w, top);
    g.lineTo(x + w, H); g.fill();
    if (r() < 0.25) { g.fillRect(x + w * 0.4, top - 30 - r() * 30, 2, 60); }   // an antenna
    for (let k = 0; k < 4; k++) if (r() < 0.5) lit.push([x + 4 + r() * (w - 8), top + 10 + r() * (h - 20)]);
    x += w + (r() < 0.2 ? 10 + r() * 30 : -4);
  }
  g.strokeStyle = 'rgb(18,16,17)'; g.lineWidth = 3; g.beginPath(); g.moveTo(700, H - 10); g.lineTo(712, 30); g.lineTo(718, H - 10); g.moveTo(712, 34); g.lineTo(860, 40); g.lineTo(712, 60); g.moveTo(860, 40); g.lineTo(856, 90); g.stroke();   // a crane
  for (const [x, y] of lit) { g.fillStyle = r() < 0.3 ? 'rgba(255,62,165,0.8)' : 'rgba(255,170,90,0.75)'; g.fillRect(x, y, 2, 3); }
  const t = canvasTex(c, { rep: [4, 1] }); t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

/** a big painted map label for the top view (white text, a dark edge; tinted by the material colour) */
export function labelTexture(text, size = 96) {
  const c = makeCanvas(1024, 160), g = c.getContext('2d'); g.clearRect(0, 0, 1024, 160);
  g.font = `900 ${size}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(text, 512, 84); g.fillStyle = '#ffffff'; g.fillText(text, 512, 84);
  const t = canvasTex(c, { wrap: false }); t.anisotropy = 8; return { tex: t, aspect: Math.min(1024, g.measureText(text).width + 60) / 160, w: g.measureText(text).width };
}

/** a neon sign (tubes, a halo) on a canvas: the hall's own tube lettering (decor.js) */
export function neonTexture(text, color, { w = 1024, h = 256, size = 132, dead = null } = {}) {
  const c = makeCanvas(w, h), g = c.getContext('2d'); halo(g, w, h, color, 0.2); tubeText(g, text, w / 2, h / 2, size, color, dead == null ? {} : { skip: dead });
  return canvasTex(c, { wrap: false });
}

/** the signpost's arrow boards: one 512 x 128 canvas per label (the board is cut as an arrow) */
export function boardTexture(text, color) {
  const c = makeCanvas(512, 128), g = c.getContext('2d'), r = rng(text.length * 31 + 7);
  g.fillStyle = '#d9d2c3'; g.fillRect(0, 0, 512, 128); g.fillStyle = color; g.fillRect(0, 0, 512, 14); g.fillRect(0, 114, 512, 14);
  g.fillStyle = '#1b1a18'; g.font = '900 64px -apple-system, system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText(text, 26, 66);   // the board's own shape is the arrow
  for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(${90 + r() * 50 | 0},${40 + r() * 25 | 0},15,${r() * 0.5})`; g.fillRect(r() * 512, r() * 128, 1 + r() * 4, 1 + r() * 3); }   // rust and grime
  return canvasTex(c, { wrap: false });
}

/** the plaza's worn painted compass rose (alpha), 512 px for its 4.8 m */
export function roseTexture(quads) {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d'), m = S / 2, r = rng(861); g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(225,215,190,0.75)'; g.lineWidth = 7; g.beginPath(); g.arc(m, m, m * 0.62, 0, 6.29); g.stroke(); g.lineWidth = 3; g.beginPath(); g.arc(m, m, m * 0.5, 0, 6.29); g.stroke();
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, L = k % 2 ? 0.42 : 0.6; g.fillStyle = k % 2 ? 'rgba(200,190,170,0.6)' : 'rgba(230,220,195,0.8)'; g.beginPath(); g.moveTo(m + Math.cos(a) * m * L, m + Math.sin(a) * m * L); g.lineTo(m + Math.cos(a + 0.18) * m * 0.12, m + Math.sin(a + 0.18) * m * 0.12); g.lineTo(m + Math.cos(a - 0.18) * m * 0.12, m + Math.sin(a - 0.18) * m * 0.12); g.fill(); }
  g.font = '900 34px -apple-system, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const q of quads) { g.save(); g.translate(m + Math.cos(q.a) * m * 0.8, m + Math.sin(q.a) * m * 0.8); g.rotate(q.a + Math.PI / 2); g.fillStyle = q.color; g.fillText(q.text, 0, 0); g.restore(); }
  g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 900; k++) { g.globalAlpha = 0.3 + r() * 0.7; g.fillRect(r() * S, r() * S, 2 + r() * 6, 1 + r() * 4); }
  return canvasTex(c, { wrap: false });
}
