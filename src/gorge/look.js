// The gorge's decor (gorge addendum): what you see, never what you collide with (that is src/gorge.txt).
// A port of the standalone page's look (.superpowers/gorge/gorge.src.js) with train.js's interface:
// frameAt(t) is the scene's state at a time, paintWindow draws a window of it for a renderer. Lights that
// disagree (the misty daylight falling into the gorge, the post house's warm lamps), a backdrop with mist
// drifting over it, and the lives in it: the waterfall, swallows, bats, the ferry, ribbons, lanterns.
// Pure and DOM-free. Its people are left out: the fighters are the gorge's people here.
import * as S from './scene.js';
import { lum } from '../train.js';

const { W, H, FLOOR, DECK, CH, ROLE, KIND, ZONE, AIR, Z_OUT, Z_ROCK, Z_CAVE, hash, mod, clamp, smooth, noise, archX, archTop } = S;

export const COLLISION = [255, 236, 210];
const STILL_T = 12000; // Reduce Motion's one moment: no sunbeam, no drizzle, the bats home

// The gorge for a level: the scene is built once (scene.js); the level must be its size.
export function buildGorge(level) {
  if (level && (level.cols !== W || level.rows !== H)) throw new Error(`the gorge is ${W} × ${H}, the level ${level.cols} × ${level.rows}`);
  return { W, H, gorge: true };
}

// ============================ LIGHT ============================
const SKY = [0.84, 0.92, 0.95], WARM = [1.0, 0.66, 0.32], RED = [1.0, 0.36, 0.22], FLASH = [1, 0.85, 0.6];
const amb = (y) => 0.34 + 0.66 * (1 - smooth(y / FLOOR)) ** 1.2;
const LIGHTS = [];
LIGHTS.push({ x: S.HALL.cx + 1, y: 97, r: 30, col: WARM, I: 1.15, zone: Z_OUT });
LIGHTS.push({ x: S.HALL.cx, y: S.HALL.upperY, r: 18, col: WARM, I: 0.6, zone: Z_OUT });
if (S.WINGS) LIGHTS.push({ x: S.WINGS.right.cx, y: 101, r: 13, col: WARM, I: 0.8, zone: Z_OUT });
for (const U of S.UMBRELLAS) LIGHTS.push({ x: U.x, y: U.y + 2, r: 11, col: WARM, I: 1.0, zone: Z_OUT });
for (const s of S.STONE_LANTERNS) LIGHTS.push({ x: s.x, y: s.y + 1, r: s.yard ? 9 : 12, col: WARM, I: s.yard ? 0.8 : 1.1, zone: s.yard ? Z_OUT : Z_CAVE });
for (const L of S.LANTERNS) LIGHTS.push({ x: L.x, y: L.y + 2, r: 8, col: RED, I: 0.9, zone: Z_OUT, lantern: L });
S.CAVE_LAMPS.forEach((L, k) => LIGHTS.push({ x: L.x, y: L.y + 2, r: 13, col: WARM, I: 1.15, zone: Z_CAVE, flick: k === 2 }));
LIGHTS.push({ x: S.SHRINE.x + 1, y: S.SHRINE.y - 1, r: 7, col: [1, 0.75, 0.4], I: 0.9, zone: Z_CAVE });
LIGHTS.push({ x: S.STALL.keeper, y: 13, r: 12, col: WARM, I: 0.8, zone: Z_OUT });

// The light at (x, y) in a zone (Z_OUT, Z_ROCK, Z_CAVE): the daylight, the lamps, the sunbeam, and muzzle
// flashes (F.flashes, arena-local, as the train's).
export function lightAt(x, y, zone, F) {
  let r, g, b;
  if (zone === Z_CAVE) { r = 0.07; g = 0.06; b = 0.06; }
  else {
    const a = amb(clamp(y, 0, FLOOR)) * (zone === Z_ROCK ? 0.86 : 1) * F.day;
    r = SKY[0] * a; g = SKY[1] * a; b = SKY[2] * a;
    // under the arch the light comes through from beyond it
    if (y > 40 && y < FLOOR && x >= archX(y) - 4) { const k = 0.18 * smooth((x - archX(y) + 4) / 10); r += 0.8 * k; g += 0.95 * k; b += 0.85 * k; }
  }
  for (const L of F.lights) {
    if (L.zone !== zone && !(L.zone === Z_OUT && zone === Z_ROCK)) continue;
    const dx = x - L.x, dy = (y - L.y) * 2;
    if (dx > L.r || dx < -L.r || dy > L.r || dy < -L.r) continue;
    const d = Math.hypot(dx, dy) / L.r;
    if (d < 1) { const f = (1 - d) * (1 - d) * L.I; r += L.col[0] * f; g += L.col[1] * f; b += L.col[2] * f; }
  }
  if (F.beam && zone !== Z_CAVE) {
    const u = x + y * 0.9 - F.beam.u;
    if (u > 0 && u < 26) { const f = Math.sin((u / 26) * Math.PI) * F.beam.k * 0.42; r += 1.0 * f; g += 0.95 * f; b += 0.78 * f; }
  }
  for (const f of F.flashes || []) {
    const d = Math.hypot(x - f.x, (y - f.y) * 2) / 16;
    if (d < 1) { const k = (1 - d) * f.k; r += FLASH[0] * k; g += FLASH[1] * k; b += FLASH[2] * k; }
  }
  return [r, g, b];
}

// ============================ PALETTE ============================
const BASE = {
  rock: [170, 170, 160], strata: [150, 154, 146], rim: [196, 194, 182], moss: [96, 146, 72], fern: [118, 176, 86], earth: [110, 96, 76],
  plank: COLLISION, top: COLLISION, roof: [206, 198, 186], canopy: [246, 238, 222], tabletop: [214, 168, 116], cratetop: [222, 184, 130], crate: [150, 110, 70], post: [150, 112, 74], rail: [146, 112, 76], gallery: [150, 104, 66], bamboo: [110, 150, 84], leaf: [96, 156, 80], ladder: [236, 204, 150], trunk: [126, 92, 64], needles: [70, 128, 74],
  ridge: [92, 90, 94], tile: [104, 102, 106], eave: [110, 106, 108], pillar: [196, 64, 46], beam: [130, 92, 62], lattice: [236, 170, 96], shelf: [92, 50, 24], goods: [130, 70, 36],
  plaster: [200, 194, 182], door: [255, 196, 120], plinth: [150, 146, 138], step: [170, 166, 156], string: [120, 100, 80], board: [236, 196, 96],
  umbrella: [240, 232, 214], pole: [120, 110, 100], table: [130, 96, 66], bronze: [168, 128, 70], stone: [152, 150, 142], stonelamp: [255, 206, 140],
  sign: [222, 206, 172], statue: [210, 170, 90], altar: [120, 70, 50], candle: [255, 220, 150], cave: [60, 50, 44],
  water: [150, 220, 196], straw: [206, 176, 104], counter: [150, 112, 74], counterF: [104, 74, 48], stele: [160, 158, 150],
};
const BG = {
  rock: [86, 88, 84], strata: [86, 88, 84], moss: [52, 68, 46], fern: [62, 72, 56], rim: [86, 88, 84], earth: [34, 30, 24],
  shelf: [150, 86, 36], goods: [150, 86, 36], needles: [36, 60, 40],
  tile: [30, 30, 34], ridge: [30, 30, 34], plaster: [120, 112, 100], door: [150, 86, 36], lattice: [70, 38, 18], board: [110, 28, 20],
  cave: [24, 19, 17], water: [20, 74, 64], crate: [70, 50, 30], stele: [150, 146, 136], counterF: [40, 28, 18], straw: [70, 56, 30], plinth: [52, 50, 46], umbrella: [90, 84, 74],
};
const EMISSIVE = new Set(['lattice', 'door', 'stonelamp', 'candle']);
// What you stand on and climb: never lost in the dark, and the brightest thing at any light.
const PLAY = new Set(['plank', 'top', 'ladder', 'roof', 'canopy', 'tabletop', 'cratetop']);
const DECOR_CAP = 0.8;
const solidShade = (l) => Math.min(1.15, 0.62 + 0.45 * l);
const SOLID_BG = { plank: [74, 50, 30], top: [62, 58, 52], roof: [40, 40, 44], canopy: [96, 90, 80], tabletop: [74, 50, 30], cratetop: [84, 60, 36] };
const cap255 = (c) => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2])];
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function colorOf(role, L) {
  const base = BASE[role] || BASE.rock;
  if (EMISSIVE.has(role)) return base;
  if (PLAY.has(role)) { const s = solidShade(lum(L)); return cap255(base.map((v) => v * s)); }
  let fg = cap255([base[0] * L[0], base[1] * L[1], base[2] * L[2]]);
  const cap = DECOR_CAP * lum(cap255(COLLISION.map((v) => v * solidShade(lum(L))))), l = lum(fg);
  if (l > cap) fg = fg.map((v) => (v * cap) / l);
  return fg;
}

// ============================ THE BACKDROP ============================
// Behind everything: a pale misty sky, a far range, the gorge's far wall (washed out up high, dark and
// green at the floor) and, through the arch, the brighter gorge beyond. Quiet texture; mist moves over it.
const rim = (x) => 20 + Math.round(4 * Math.sin(x / 9) + 3 * Math.sin(x / 4.3 + 1) + 2 * hash(x, 3));
const range = (x) => 10 + Math.round(3 * Math.sin(x / 11 + 2) + 2 * Math.sin(x / 5));
const MIST = [182, 192, 194];
const BANDS = [{ y: 22, h: 5, v: 0.5 }, { y: 40, h: 5, v: -0.35 }, { y: 62, h: 7, v: 0.42 }, { y: 84, h: 6, v: -0.28 }, { y: 98, h: 4, v: 0.2 }];
function mistAt(x, y, t) {
  let m = 0;
  for (let k = 0; k < BANDS.length; k++) {
    const B = BANDS[k], dy = (y - B.y - 3 * Math.sin(x / 17 + k + t / 9000)) / B.h;
    if (dy > 1.6 || dy < -1.6) continue;
    const u = Math.floor(x - t * 0.001 * B.v * 4);
    m += Math.exp(-dy * dy * 1.6) * noise(u / 14, k * 3.1 + y / 9, 5 + k);
  }
  return clamp(m, 0, 1);
}
const LEAVES = [',', '\'', '"', ';', '*', ','];
const leafAt = (x, y) => LEAVES[Math.floor(hash(x, y * 3 + 1) * LEAVES.length)];
function backdrop(x, y, F, out) {
  let c = ' ', fg = [0, 0, 0], bg;
  if (y >= FLOOR) {
    // under the floor (the room's edges in a tall view): the earth
    bg = BG.earth;
  } else if (y > 40 && x >= archX(y)) {
    // the gorge beyond the arch: bright haze, far cliffs, trees at the bottom
    const k = (y - 40) / (FLOOR - 40);
    bg = mixc([150, 162, 160], [84, 108, 92], smooth(k));
    const edge = FLOOR - 28 + 4 * Math.sin(x / 4) + 3 * noise(x / 3, 1, 8);
    const tree = smooth((y - edge) / 4);
    if (tree > 0) {
      bg = mixc(bg, [40, 66, 46], tree * 0.75);
      if (noise(x / 2.5, y / 1.5, 9) > 0.45) { c = leafAt(x, y); fg = mixc([90, 130, 96], [60, 100, 66], tree); }
    } else if (hash(x, 31) < 0.12 && noise(x * 0.4, y / 6, 4) > 0.5) { c = '│'; fg = mixc(bg, [210, 220, 216], 0.3); }
  } else if (y < rim(x)) {
    // the sky and a far range, both soft
    const ridge = range(x) + 2 * noise(x / 3, 0, 2);
    bg = y < ridge ? mixc([156, 166, 170], [138, 148, 152], clamp(y, 0, 12) / 12) : mixc([116, 126, 130], [108, 118, 122], (y - ridge) / 10);
  } else {
    // the gorge's far wall: washed out high up, dark and green down at the floor
    const d = y - rim(x), k = smooth((y - 18) / 88);
    bg = mixc([92, 102, 104], [26, 38, 31], k);
    const green = noise(x / 6, y / 3, 6) + (y > 75 ? 0.25 * smooth((y - 75) / 20) : 0) + (d < 3 ? 0.4 : 0);
    if (green > 0.55) {
      const g = smooth((green - 0.55) / 0.3);
      bg = mixc(bg, mixc([78, 100, 84], [30, 56, 36], k), g * 0.7);
      if (hash(x, y) < 0.08 + 0.5 * g * g) { c = leafAt(x, y); fg = mixc([112, 136, 116], [54, 92, 60], k); }
    } else if (hash(x, 41) < 0.1 && noise(x * 0.3, y / 7, 7) > 0.55) { c = '│'; fg = mixc([128, 138, 138], [50, 60, 54], k); }
  }
  // warm lamps tint the backdrop near them; the sunbeam and muzzle flashes too
  const L = lightAt(x, y, Z_OUT, F), a = amb(clamp(y, 0, FLOOR)) * F.day;
  const add = [Math.max(0, L[0] - SKY[0] * a), Math.max(0, L[1] - SKY[1] * a), Math.max(0, L[2] - SKY[2] * a)];
  bg = [bg[0] * F.day + add[0] * 70, bg[1] * F.day + add[1] * 70, bg[2] * F.day + add[2] * 70];
  fg = [fg[0] * F.day + add[0] * 90, fg[1] * F.day + add[1] * 90, fg[2] * F.day + add[2] * 90];
  // mist: only the background, so it drifts as soft cloud
  const m = y < FLOOR ? mistAt(x, y, F.t) : 0;
  if (m > 0.04) { bg = mixc(bg, MIST.map((v) => v * F.day), m * 0.6); fg = mixc(fg, bg, m * 0.5); }
  out.ch = c; out.fg = fg; out.bg = bg; out.L = L;
}

// ============================ THE LIVES IN IT ============================
// The ferry poles across the pool and back; the macaque hops from perch to perch up the climb; the bats
// leave the shrine cave for a while every 40 s; a flock bursts out of the cedars.
const BOAT = { x0: 134 + S.OX, x1: 153 + S.OX, period: 46000 };
function boatX(t) { const k = mod(t, BOAT.period) / BOAT.period; return BOAT.x0 + (BOAT.x1 - BOAT.x0) * smooth(k < 0.5 ? k * 2 : 2 - k * 2); }
const PERCHES = [{ x: S.LOOKOUT.x0 + 2, y: S.LOOKOUT.r }, { x: S.BALCONY.x1 - 1, y: S.BALCONY.r }, { x: S.CAVE2_EXIT.x - 6, y: S.CAVE2_EXIT.r }, { x: S.PINES[0].x0 + 1, y: S.PINES[0].r }, { x: 112 + S.OX, y: DECK }];
const PERCH_T = 9000, HOP_T = 1600;
function monkeyPos(t) {
  const n = Math.floor(t / PERCH_T), u = mod(t, PERCH_T), p = PERCHES[mod(n, PERCHES.length)];
  if (u >= HOP_T) return { x: p.x, y: p.y, still: true };
  const q = PERCHES[mod(n - 1, PERCHES.length)], k = u / HOP_T, e = smooth(k);
  return { x: q.x + (p.x - q.x) * e, y: q.y + (p.y - q.y) * e - Math.sin(k * Math.PI) * 6, still: false, dir: Math.sign(p.x - q.x) || 1 };
}
const BATS = [21, 23, 26, 28, 30].map((d, k) => ({ x: S.CAVE1.x0 + d, y: S.CAVE1.r - 5, k }));
const HUES = [[220, 60, 60], [230, 120, 180], [140, 90, 210], [70, 140, 220], [240, 180, 60], [210, 60, 120]];
const WFX = 144 + S.OX, WF_TOP = archTop(WFX);

// ---- the scene's state at time t (ms): the lights of the moment and every moving glyph (dyn, by cell) ----
export function frameAt(t, { reducedMotion = false } = {}) {
  if (reducedMotion) t = STILL_T;
  const F = { t, day: 1, lights: [], dyn: new Map(), beam: null, flashes: [] };
  for (const L of LIGHTS) {
    let I = L.I;
    if (L.flick) I *= hash(Math.floor(t / 130), 3) < 0.3 ? 0.25 : mod(t, 7300) < 600 ? 0.08 : 1; // the failing cave lamp
    if (L.lantern) I *= 0.85 + 0.15 * Math.sin(t / 700 + L.x);
    F.lights.push({ ...L, I });
  }
  const bt = mod(t, 31000);
  if (bt > 20000 && bt < 28000) F.beam = { u: 20 + ((bt - 20000) / 8000) * 250, k: smooth((bt - 20000) / 1500) * smooth((28000 - bt) / 1500) };
  // a drizzle now and then dims the day a little
  const rt = mod(t, 53000), rain = rt > 38000 && rt < 50000 ? smooth((rt - 38000) / 2000) * smooth((50000 - rt) / 2000) : 0;
  F.day = 1 - 0.12 * rain;

  const dput = (x, y, c, col, o = {}) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (o.air && (KIND[i] !== AIR || (CH[i] !== null && !o.over))) return;
    F.dyn.set(i, { c, col, glow: o.glow, lit: o.lit, bg: o.bg });
  };
  const word = (x, y, s, col, o) => [...s].forEach((c, k) => c !== ' ' && dput(x + k, y, c, col, o));

  // the sky: a hawk circling high over the gorge
  {
    const a = t / 9000, hx = 34 + 26 * Math.cos(a), hy = 5 + 2 * Math.sin(a * 2);
    word(hx - 1, hy, mod(t, 5000) < 600 && mod(t, 200) < 100 ? '╲v╱' : '─v─', [60, 58, 60], { air: true, lit: true });
  }
  // the far waterfall on the far wall, a thin ribbon falling into the mist
  for (let y = rim(15) + 3; y < 88; y++) {
    const p = Math.floor(y - t * 0.012), h = hash(15, p);
    const g = h < 0.55 ? '│' : h < 0.8 ? '╎' : ' ';
    if (g !== ' ') dput(15 + (y > 76 && hash(p, 2) < 0.3 ? 1 : 0), y, g, [150, 166, 168].map((v) => v * (0.7 + 0.3 * (1 - y / 88))), { air: true });
  }
  // the waterfall through the arch: out of a crack in the ceiling, down to the pool, spray at the foot
  for (let y = WF_TOP; y < FLOOR; y++) {
    const spread = y > FLOOR - 12 ? 1 : 0;
    for (let x = WFX - spread; x <= WFX + 1 + spread; x++) {
      const p = Math.floor(y - t * 0.03 + x * 3), h = hash(x, p);
      const g = h < 0.5 ? '│' : h < 0.75 ? '╎' : h < 0.85 ? '║' : ' ';
      if (g !== ' ') dput(x, y, g, [206, 230, 232], { air: true, over: true, glow: h < 0.2 });
    }
  }
  for (let k = 0; k < 9; k++) {
    const age = mod(t / 700 + hash(k, 5) * 7, 1), sx = WFX + 0.5 + (hash(k, 6) - 0.5) * 9 * age, sy = FLOOR - 1 - Math.sin(age * Math.PI) * 3;
    dput(sx, sy, age < 0.5 ? '·' : '°', [220, 236, 236], { air: true, over: true });
  }
  // drips off the arch's ceiling
  for (let k = 0; k < 6; k++) {
    const x = 124 + S.OX + Math.floor(hash(k, Math.floor((t + k * 900) / 5200)) * 34), top = archTop(x), u = mod(t + k * 900, 5200) / 5200;
    if (top >= FLOOR) continue;
    const y = top + 1 + Math.floor(u * u * (FLOOR - top));
    if (y < FLOOR) dput(x, y, '╷', [170, 210, 210], { air: true });
    else dput(x, FLOOR, 'o', [190, 230, 220], { over: true });
  }
  // swallows wheeling under the arch, their nests under the ceiling
  for (let k = 0; k < 6; k++) {
    const w = 0.9 + hash(k, 1) * 0.5, a = t / (1500 * w) + k * 1.7;
    const x = 141 + S.OX + 13 * Math.sin(a) + 3 * Math.sin(a * 2.3 + k), y = 76 + 16 * Math.sin(a * 0.61 + k * 2) + 3 * Math.cos(a * 1.7);
    dput(x, y, mod(t + k * 77, 340) < 170 ? 'v' : '-', [40, 44, 60], { air: true, over: true });
  }
  for (const x of [130, 131, 140, 150].map((x) => x + S.OX)) dput(x, archTop(x), '▄', [96, 80, 60], { lit: true });
  // swaying vines
  for (const v of S.VINES) {
    const sway = Math.round(Math.sin(t / 1300 + v.x * 0.7 + v.y) * 0.8);
    for (let k = 0; k < v.len; k++) {
      const off = k > v.len / 2 ? sway : 0;
      dput(v.x + off, v.y + 1 + k, k === v.len - 1 ? (sway < 0 ? '╱' : sway > 0 ? '╲' : '│') : '│', [80, 140, 72], { air: true, lit: true });
    }
  }
  // falling leaves
  for (let k = 0; k < 10; k++) {
    const dur = 26000 + hash(k, 2) * 14000, u = mod(t + hash(k, 3) * dur, dur) / dur;
    const x0 = 6 + hash(k, Math.floor((t + hash(k, 3) * dur) / dur)) * (W - 12), y = 2 + u * (FLOOR - 4);
    dput(x0 + Math.sin(u * 20 + k) * 2.5, y, mod(t + k * 300, 900) < 450 ? ',' : '\'', k % 3 ? [130, 170, 70] : [200, 170, 70], { air: true, lit: true });
  }
  // drizzle
  if (rain > 0.05) for (let x = 0; x < W; x++) {
    if (hash(x, 77) > 0.22 * rain) continue;
    const y = mod(Math.floor(t / 35) + Math.floor(hash(x, 5) * 200), 130) - 10;
    if (y >= 0 && y < H) dput(x, y, '╎', [150, 170, 180], { air: true });
  }
  // the sunbeam's dust
  if (F.beam) for (let k = 0; k < 30; k++) {
    const y = 6 + hash(k, 1) * 95, x = F.beam.u + 13 - y * 0.9 + (hash(k, 2) - 0.5) * 18;
    if (mod(t / 400 + hash(k, 3) * 5, 2) < 1) dput(x, y + Math.sin(t / 900 + k) * 1.5, '·', [255, 240, 200].map((v) => v * F.beam.k), { air: true, glow: true });
  }
  // the post house: lanterns swing, incense rises
  for (const L of S.LANTERNS) {
    const sw = Math.sin(t / 900 + L.x * 1.3), dx = sw > 0.75 ? 1 : sw < -0.75 ? -1 : 0;
    dput(L.x, L.y, dx > 0 ? '╲' : dx < 0 ? '╱' : '│', [120, 100, 80], { lit: true });
    dput(L.x + dx, L.y + 1, '█', [255, 92, 56], { glow: true });
    dput(L.x + dx, L.y + 2, '▀', [190, 60, 40]);
  }
  for (let k = 0; k < 7; k++) {
    const age = mod(t / 3200 + k / 7, 1), y = S.BURNER.y - 1 - age * 12, x = S.BURNER.x + Math.sin(age * 8 + t / 2000) * (1 + age * 2);
    dput(x, y, age < 0.4 ? '·' : '~', [200, 196, 190].map((v) => v * (1 - age * 0.8)), { air: true, over: true });
  }
  dput(S.BURNER.x, S.BURNER.y - 1, '|', [255, 160, 90], { glow: true, over: true, air: true });
  // the signs, in letters the grid can hold
  word(S.HALL.sign.x - 1, S.HALL.sign.y, 'TIANFU', [240, 200, 100], { lit: true });
  // the shrine: candles flicker; the bats
  for (const x of [S.SHRINE.x - 3, S.SHRINE.x + 3]) dput(x, S.SHRINE.y - 2, mod(t + x * 37, 600) < 300 ? '·' : '\'', [255, 210, 120], { glow: true, over: true });
  for (const b of BATS) {
    const u = (mod(t, 40000) - 18000 - b.k * 120) / 1000; // out for 22 s of every 40
    if (u < 0) { dput(b.x, b.y, 'v', [70, 56, 50]); continue; }
    const x = u < 2.2 ? b.x + u * 9 : 141 + S.OX + 10 * Math.sin(u * 1.3 + b.k), y = u < 2.2 ? b.y + 1 + Math.sin(u * 9) : 66 + 12 * Math.sin(u * 0.9 + b.k * 1.4);
    dput(x, y, mod(t + b.k * 50, 200) < 100 ? 'v' : '^', [60, 46, 42], { over: true });
  }
  // the pool: ripples, the ferry
  for (let x = S.POOL_X; x < W; x++) {
    const h = hash(x, Math.floor(t / 600 + hash(x, 2) * 9));
    dput(x, FLOOR, h < 0.5 ? '~' : h < 0.8 ? '-' : ' ', [170, 226, 206], { over: true });
  }
  const bx = Math.round(boatX(t)), pole = Math.floor(t / 1600) % 2;
  word(bx - 4, FLOOR, '╲▄▄▄▄▄▄▄╱', [118, 82, 50], { over: true, lit: true });
  word(bx - 2, FLOOR - 1, '▄', [190, 180, 150], { lit: true });
  for (let k = 0; k < 5; k++) dput(bx + 2 + (pole ? k : 0), FLOOR - 3 + k, pole ? '╲' : '│', [150, 120, 80], { lit: true, air: true, over: true });
  // the top: ribbons fluttering on the strings between the cedars, the stall's steam, the canopy
  for (const L of S.RIBBON_LINES) for (let x = L.x0 + 1; x < L.x1; x++) {
    if (S.CEDARS.includes(x) || hash(x, L.y) < 0.35) continue;
    const len = 1 + Math.floor(hash(x, L.y + 1) * 3), col = HUES[Math.floor(hash(x, L.y + 2) * HUES.length)];
    for (let k = 0; k < len; k++) {
      const w = Math.sin(t / 500 + x * 0.9 + k) * (k + 1) * 0.35;
      dput(x + (k === len - 1 ? Math.round(w) : 0), L.y + 1 + k, k === len - 1 ? (w > 0.4 ? '╲' : w < -0.4 ? '╱' : '│') : '│', col, { lit: true, air: true });
    }
  }
  for (let k = 0; k < 4; k++) { const age = mod(t / 2600 + k / 4, 1); dput(S.STALL.keeper + 2 + Math.sin(age * 7 + k) * 1.2, 13 - age * 6, age < 0.5 ? '~' : '·', [220, 220, 216].map((v) => v * (1 - age)), { air: true }); }
  for (const cx of S.CEDARS) {
    const top = 3 + Math.floor(hash(cx, 4) * 4);
    for (let y = top - 3; y <= top + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      const d = Math.hypot(x - cx, (y - top) * 2) / 4;
      if (d < 1 && hash(x, y) < 0.95 - d * 0.4) dput(x + (y < top && Math.sin(t / 1800 + cx) > 0.8 ? 1 : 0), y, leafAt(x, y), [96, 150, 90], { lit: true, air: true, over: true, bg: [58, 88, 60].map((v) => v * (1 - d * 0.25)) });
    }
  }
  const ft = mod(t, 40000);
  if (ft < 6000) for (let k = 0; k < 9; k++) {
    const u = ft / 1000, x = 104 + S.OX + hash(k, 3) * 44 - u * (6 + hash(k, 4) * 6), y = 6 - u * (2 + hash(k, 5) * 3) + Math.sin(u * 3 + k);
    dput(x, y, mod(ft + k * 60, 240) < 120 ? 'v' : '-', [40, 40, 46], { air: true, over: true });
  }
  word(S.STALL.x0 + 2, 13, 'o ▄ o  i o ▄', [220, 120, 70], { over: true, lit: true });
  // the macaque
  {
    const m = monkeyPos(t), col = [170, 120, 84];
    if (m.still) {
      dput(m.x, m.y - 2, mod(t, 4000) < 150 ? '-' : 'o', col, { lit: true, over: true });
      dput(m.x, m.y - 1, '█', col.map((v) => v * 0.8), { lit: true, over: true });
      dput(m.x + 1, m.y - 1, mod(t, 2400) < 1200 ? '╯' : '~', col, { lit: true, over: true });
    } else {
      dput(m.x, m.y - 1, 'o', col, { over: true });
      dput(m.x - m.dir, m.y - 1, '~', col, { over: true });
    }
  }
  return F;
}

// ============================ ONE CELL ============================
// Glyph, colour, background, glow, and whether the background is crisp (structure) or soft (light, mist,
// foliage: drawn smoothed by the renderer, so pools of light fade instead of stepping).
const HARD = new Set(['plank', 'top', 'rim', 'tile', 'ridge', 'eave', 'pillar', 'plaster', 'door', 'lattice', 'board', 'plinth', 'step',
  'umbrella', 'table', 'roof', 'canopy', 'tabletop', 'crate', 'cratetop', 'bronze', 'stone', 'stonelamp', 'statue', 'altar', 'straw', 'counter', 'counterF', 'stele', 'water', 'cave', 'shelf', 'beam']);
const back = {};
// x, y: the cell (arena-local; outside the gorge its edge carries on). out: { ch, fg, bg, glow, hard }.
export function paint(F, x, y, out) {
  const cx = clamp(x, 0, W - 1), cy = clamp(y, 0, H - 1), i = cy * W + cx, zone = ZONE[i];
  let c = CH[i], role = ROLE[i], fg, bg = null, glow = null, L, hard = false;
  // Past the gorge's sides the rock and earth carry on; the air shows the backdrop where it really is.
  if ((cx !== x || cy !== y) && c !== null && !(role === 'rock' || role === 'earth' || role === 'strata' || role === 'moss' || role === 'fern')) { c = null; role = null; }
  const own = role && (SOLID_BG[role] || BG[role]);
  if (c === null || (zone === Z_OUT && !own)) backdrop(x, y, F, back);
  if (c === null) { c = back.ch; fg = back.fg; bg = back.bg; L = back.L; }
  else {
    L = lightAt(x, y, zone, F);
    fg = colorOf(role, L);
    if (EMISSIVE.has(role)) glow = BASE[role].map((v) => v * (role === 'lattice' ? 0.22 : 0.5));
    if (own) { const s = PLAY.has(role) ? solidShade(lum(L)) : null; bg = s ? own.map((v) => v * s) : own.map((v, k) => v * Math.min(1.6, L[k] + 0.2)); }
    else if (zone === Z_CAVE) bg = BG.cave.map((v, k) => v * Math.min(1.8, L[k] * 1.4 + 0.3));
    else if (zone === Z_OUT) bg = back.bg;
    if (role === 'plaster' && zone === Z_OUT) bg = BG.plaster.map((v, k) => v * Math.min(1.4, L[k] * 0.9));
    hard = HARD.has(role) || zone === Z_CAVE;
    if (zone !== Z_CAVE && !PLAY.has(role) && role !== 'water' && own) {
      const m = mistAt(x, y, F.t) * (zone === Z_ROCK ? 0.3 : 0.5);
      if (m > 0.04) { bg = mixc(bg, MIST.map((v) => v * F.day), m * 0.5); fg = mixc(fg, MIST, m * 0.3); }
    }
  }
  const d = cx === x && cy === y ? F.dyn.get(i) : null;
  if (d) {
    c = d.c;
    fg = d.lit ? d.col.map((v, k) => Math.min(255, v * Math.min(1.3, 0.35 + L[k] * 0.8))) : d.col;
    if (d.glow) glow = d.col.map((v) => v * 0.6);
    if (d.bg) bg = d.bg;
  }
  out.ch = c; out.fg = fg; out.bg = bg; out.glow = glow; out.hard = hard;
  return out;
}

// ---- looks: 'line' (box drawing) and 'ascii' (7-bit) ----
const ASCII = {
  '─': '-', '━': '-', '│': '|', '┃': '|', '║': '|', '╎': ':', '╌': '-', '├': '+', '┤': '+', '┬': '+', '┼': '+', '╋': '+', '╷': '|', '╯': '\'',
  '═': '=', '▀': '"', '▄': '_', '█': '#', '▓': '#', '▒': ':', '░': '.', '·': '.', '°': 'o', '▐': '[', '▌': ']', '╱': '/', '╲': '\\',
};
const lookChar = (look, c) => (look === 'line' ? c : ASCII[c] ?? (c.charCodeAt(0) < 127 ? c : '.'));

// Every character the gorge can draw, in either look (renderers put these in their glyph atlases; a test
// checks the scene against it).
export const GORGE_GLYPHS = '═▀▄█▐▌│┃║╎╷─┬┼├┤╱╲╯·°▓' + String.fromCharCode(...Array.from({ length: 95 }, (_, k) => 32 + k));

// A window of the gorge for a renderer, as train.js's paintWindow: w×h cells from arena-local cell
// (x0, y0), each as its glyph, colour, opaque background and glow; hard's alpha says which backgrounds are
// crisp (255) and which soft (0). out (from the last call) is reused while the size holds. T is buildGorge's.
const PAGE = [7, 8, 11];
const cell = {};
export function paintWindow(T, F, look, x0, y0, w, h, out = null) {
  const n = w * h;
  if (!out || out.w !== w || out.h !== h || !out.hard) {
    out = { w, h, ch: new Array(n), fg: new Uint8ClampedArray(n * 4), bg: new Uint8ClampedArray(n * 4), hard: new Uint8ClampedArray(n * 4), glow: new Float32Array(n * 3) };
  }
  out.x0 = x0; out.y0 = y0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    paint(F, x0 + x, y0 + y, cell);
    out.ch[k] = lookChar(look, cell.ch);
    const bg = cell.bg || PAGE;
    for (let c = 0; c < 3; c++) {
      out.fg[k * 4 + c] = Math.round(Math.min(255, cell.fg[c]));
      out.bg[k * 4 + c] = out.hard[k * 4 + c] = Math.round(Math.min(255, bg[c]));
      out.glow[k * 3 + c] = cell.glow ? cell.glow[c] : 0;
    }
    out.fg[k * 4 + 3] = out.bg[k * 4 + 3] = 255;
    out.hard[k * 4 + 3] = cell.hard ? 255 : 0;
  }
  return out;
}
