// survival_rules.js - the open world's numbers: the day and the night, the sun, the solar panels on the bin, the energy leeches, the
// bin's capacity, the arm's GRAB stats and the shelter's charger. Pure data and maths (the physics, the drawing and the tests read it).
//
// THE DAY. One day is DAY.length seconds of play: light from dawn (phase 0) to dusk (phase DAY.dusk), then night until the next dawn. The
// HUD's clock maps the light to 06:00-20:00 and the night to 20:00-06:00. The open world starts on day 1 at about 08:00.
// THE SUN. sun(phase) = sin(pi * phase / dusk) by day, 0 all night (the rule: solar panels charge only by day). Its bearing runs from
// east at dawn through south at noon to west at dusk.
// THE PANELS. Each found panel rolls an age tier (new, aged, ruined: its efficiency range) and a batch quality (0.6-1.0, shown only by the
// Charge Oracle). Mounted on the bin's 8 slots (4 sides x 2, one Heliostat Rail each), a panel gives
//   rated W x efficiency x quality x (1 - 0.5 x dust) x sun x facing,
// facing = 1.0 on the side towards the sun, 0.6 on the two beside it, 0.25 on the side away. Each dawn a mounted panel may age a tier
// (3 % new -> aged, 5 % aged -> ruined; doubled after a night outside a shelter with the Iron Breath) and gathers 0.05 dust.
// THE LEECHES. They come out only at night, from the cadmium puddles (the forest's first), a few more each night; they crawl at 0.3-0.6
// m/s towards a01 and latch on; each latched one drains 1.5 % of the pack a second until a01 is back inside its sealed shelter (or UV
// light, or a crafted counter, gets it off). The battery drained to nothing by leeches is a01's death.
export const DAY = { length: 600, dusk: 0.7, start: 0.08 };   // 10 min a day: 7 min of light, 3 min of night; play starts at 08:00 on day 1
const TAU = Math.PI * 2;
/** the clock at survival time t (s since day 1's dawn): { day, phase, night, sun, hours, minutes, label, toDusk, toDawn } */
export function clockAt(t) {
  const L = DAY.length, day = 1 + Math.floor(Math.max(0, t) / L), phase = (Math.max(0, t) % L) / L, night = phase >= DAY.dusk;
  const sun = night ? 0 : Math.sin(Math.PI * phase / DAY.dusk);
  const h = night ? 20 + 10 * (phase - DAY.dusk) / (1 - DAY.dusk) : 6 + 14 * phase / DAY.dusk, hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return { day, phase, night, sun: Math.max(0, sun), hours: hh, minutes: mm, label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    toDusk: night ? 0 : (DAY.dusk - phase) * L, toDawn: night ? (1 - phase) * L : 0 };
}
/** the sun's bearing (rad, the game's yaw convention: 0 = east, + = towards north): east at dawn, south at noon, west at dusk */
export const sunYaw = (phase) => -Math.PI * Math.min(1, phase / DAY.dusk);
/** how bright the world is (0 night .. 1 noon), with a short twilight either side of the dark */
export function daylight(phase) {
  if (phase < DAY.dusk) return Math.min(1, 0.25 + Math.sin(Math.PI * phase / DAY.dusk) * 1.1);
  const n = (phase - DAY.dusk) / (1 - DAY.dusk), edge = Math.min(n, 1 - n);   // 0 at dusk and dawn, 0.5 at midnight
  return Math.max(0, 0.25 - edge * 2.5);
}

export const SOLAR = {
  ratedW: 60, slots: 8,
  tiers: { new: [0.85, 1.0], aged: [0.45, 0.7], ruined: [0.1, 0.3] }, quality: [0.6, 1.0],
  facing: { toward: 1.0, beside: 0.6, away: 0.25 },
  age: { new: 0.03, aged: 0.05 }, corrosion: 2, dustPerDay: 0.05,
  found: { new: 0.25, aged: 0.45, ruined: 0.3 },   // what a found panel is
};
export const TIER_ORDER = ['ruined', 'aged', 'new'];
/** a found panel: { tier, eff, q, dust } (rnd: 0..1) */
export function rollPanel(rnd, tier = null) {
  const r = rnd(), F = SOLAR.found;
  const t = tier || (r < F.new ? 'new' : r < F.new + F.aged ? 'aged' : 'ruined'), [a, b] = SOLAR.tiers[t];
  return { tier: t, eff: +(a + (b - a) * rnd()).toFixed(3), q: +(SOLAR.quality[0] + (SOLAR.quality[1] - SOLAR.quality[0]) * rnd()).toFixed(3), dust: 0 };
}
/** a panel's own factor: efficiency x quality x dust */
export const panelFactor = (p) => (p ? p.eff * p.q * (1 - 0.5 * Math.min(1, p.dust || 0)) : 0);
/** how well each of the bin's four sides faces the sun (0 front, 1 right, 2 back, 3 left), a01 heading `yaw` */
export function facing(yaw, sYaw) {
  const sides = [yaw, yaw - Math.PI / 2, yaw + Math.PI, yaw + Math.PI / 2];
  const off = sides.map((a) => { let d = a - sYaw; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return Math.abs(d); });
  const best = off.indexOf(Math.min(...off)), F = SOLAR.facing;
  return off.map((_, i) => (i === best ? F.toward : i === (best + 2) % 4 ? F.away : F.beside));
}
/** the bin's panels' output (W): slots = [panel|null x 8] (slot i on side floor(i / 2)); 0 at night */
export function solarWatts(slots, phase, yaw) {
  const c = clockAt(phase * DAY.length); if (c.night || c.sun <= 0) return 0;
  const f = facing(yaw, sunYaw(phase)); let w = 0;
  slots.forEach((p, i) => { if (p) w += SOLAR.ratedW * panelFactor(p) * c.sun * f[Math.floor(i / 2) % 4]; });
  return w;
}
/** one dawn for a mounted panel: dust, and maybe an age tier (corroded: a night outside a shelter with the Iron Breath) */
export function ageDay(p, rnd, corroded = false) {
  if (!p) return p;
  const k = corroded ? SOLAR.corrosion : 1;
  p.dust = Math.min(1, +(((p.dust || 0) + SOLAR.dustPerDay * k)).toFixed(3));
  if (p.tier === 'new' && rnd() < SOLAR.age.new * k) { p.tier = 'aged'; p.eff = +(p.eff * 0.62).toFixed(3); }
  else if (p.tier === 'aged' && rnd() < SOLAR.age.aged * k) { p.tier = 'ruined'; p.eff = +(p.eff * 0.35).toFixed(3); }
  return p;
}
/** one tier back up (the Photon Altar, coolant): ruined -> aged -> new, its efficiency into the new tier's range */
export function restoreTier(p) {
  if (!p || p.tier === 'new') return false;
  p.tier = p.tier === 'ruined' ? 'aged' : 'new'; const [a, b] = SOLAR.tiers[p.tier]; p.eff = +Math.max(a, Math.min(b, (a + b) / 2)).toFixed(3); return true;
}

export const LEECH = {
  speed: [0.3, 0.6], drain: 0.015, latch: 0.78, aggro: 18, radius: 0.075, half: 0.42, y: 0.1,
  perNight: (day) => Math.min(8, 1 + day), spawnWindow: 45,       // night 1: 2, night 2: 3 ... up to 8
  // from day 10 they no longer wait for the dark: a few by day too (they come out over the first 2 minutes of the morning and stay
  // out until dusk, when they count towards the night's). Day 10-11: 1, 12-13: 2, 14-15: 3, day 16 on: 4 (the night's cap is 8)
  dayFrom: 10, dayCap: 4, perDay: (day) => (day < 10 ? 0 : Math.min(4, 1 + Math.floor((day - 10) / 2))), daySpawnWindow: 120,
  uvSmall: 4, uvLumen: 8, somnus: 6, lance: 2, nightColdW: 12, salamander: 0.7,
  rim: { color: '#7f93d9', night: 1.6, day: 0.25 },   // the drawing's faint cold rim on their bodies (survival_view.js): at night, by day
};
// the bin's capacity (its 0.75 x 0.73 x 0.70 m inside, 383 litres: about 300 usable) and what it may weigh
export const BIN = { kg: 120, litres: 300 };
// a01's battery in the open world: limp mode under 10 % (however it got there: the motors, the arm, the cold, a puddle, the leeches),
// full power again at 12 %; death at 0 %, from any cause. The HUD's last warning at 3 %. (The tutorial keeps its own rule: limp at
// 0 % on a protected reserve, never death.) Measured: the limp crawl (DRIVE at 0.4 m/s) draws 76 W by day, 88 W at night (the cold);
// standing, 21 W / 33 W. A Mk I pack's 10 % is 45 kJ: about 8.5 minutes, some 170 m of crawl at night, to the dock or the shelter's
// pad; the farthest spot in the world is 29 m from the dock as the crow flies. No tuning needed (Mk II 250 m, Mk III 370 m)
export const BATTERY = { limpBelow: 0.10, limpExit: 0.12, critical: 0.03 };
// the arm's GRAB: the stock ring claw, and the Tetrabrachion's four hands (R01, display-only for now: its mesh, these numbers)
export const ARM = { stock: { grip: 0.11, payload: 3, reach: 1, perPress: 1, rate: 1 }, tetra: { grip: 0.24, payload: 15, reach: 1.25, perPress: 4 }, dioscuriRate: 2 };
// the shelter's own charger (a salvaged robot charging bay): a trickle on its own cells, the dock's full rate with the Ley Junction (R16)
export const SHELTER_CHARGE = { trickleW: 1800, leyW: 15000, padR: 0.55, padYawDeg: 30 };
// when the shelter autosaves: on its pad (at most every 20 s) and at every dawn a01 spends inside
export const AUTOSAVE = { every: 20 };
