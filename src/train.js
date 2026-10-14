// The train level's decor (train level addendum §1): two cutaway subway cars rolling through a tunnel,
// drawn by hand, a port of option B (.superpowers/arena-looks/train-ascii.html). Pure and import-free:
// what you see, never what you collide with (that is src/arena.txt), so the Worker never needs it.
//
// Rows:  0-1 tunnel ceiling (collision)   8-10 roof slab (collision)   11-25 the cars' insides:
//        2-7 tunnel wall, cables, lamps   26-27 floor slab (collision)  11 tubes, 12 grab rail, 13 ads,
//        28-29 underframe, bogies         30-31 wheels, 32 rails         14-20 windows, 21-22 bench

export const CARS = [[2, 98], [104, 200]]; // [first col, one past the last] of car A and car B
export const GANGWAY = [98, 103];
export const SPEED = 0.045; // cells per ms the tunnel slides past
export const ACCENT = [255, 128, 40]; // the line's orange: the livery stripe, the seats, the ads, the station band
export const COLLISION = [255, 236, 210]; // warm white: what you stand on and bump into
const STATIONS = ['34 ST', '14 ST', 'CANAL', 'ARENA'];
const ADS = ['MIND GAP', 'STAND CLR', 'NO FOOD', 'FAIZ.PICS', 'LOST? ASK', 'NEXT 14', 'HOLD ON', 'NO BIKES', 'RIDE WELL', 'WIN APT', 'BE NICE', 'EXIT LEFT'];
const SPOKES = ['│', '╱', '─', '╲'];
const STATION_EVERY = 1000, STATION_LEN = 280;
const STILL_OFF = 300; // Reduce Motion's one frame: no station anywhere in the room
// The dying tube: it changes state only on these steps, so at most 3 times in any second (WCAG 2.3.1).
const FLICKER_STEP = 340; // ms
export const FLICKER_HZ = 1000 / FLICKER_STEP;

const mod = (n, m) => ((n % m) + m) % m;
const center = (s, n) => { const l = Math.floor((n - s.length) / 2); return ' '.repeat(l) + s + ' '.repeat(n - s.length - l); };
function hash(a, b) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The fluorescent strips, from the car constants: [x of the strip's middle], and which one is dying.
const TUBES = [];
for (const [a, b] of CARS) for (let x = a + 10; x < b - 8; x += 18) TUBES.push({ x, flick: TUBES.length === 6 });
// Window panes (x ranges), from the same constants: light through them falls on the seats and floor below.
const PANES = [];
for (const [a, b] of CARS) for (let m = a + 2; m + 14 <= b - 2; m += 14) PANES.push([m + 4, m + 12]);
const inShaft = (x, y) => y >= 21 && y <= 26 && PANES.some(([p, q]) => x >= p && x <= q);

// ---- the static scene: a line-style glyph and a role per cell; a null glyph is a hole (you see the tunnel) ----
export function buildTrain(level) {
  const W = level.cols, H = level.rows, N = W * H;
  const ch = new Array(N).fill(null), role = new Array(N).fill(null);
  const inside = new Uint8Array(N), shaft = new Uint8Array(N), solid = new Uint8Array(N);
  const put = (x, y, c, r) => { if (x >= 0 && y >= 0 && x < W && y < H) { ch[y * W + x] = c; role[y * W + x] = r; } };
  const text = (x, y, str, r) => [...str].forEach((c, k) => put(x + k, y, c, r));
  let adN = 0;
  CARS.forEach(([a, b], ci) => {
    // The room: the back wall, lit by the tubes.
    for (let y = 11; y <= 25; y++) for (let x = a; x < b; x++) { put(x, y, ' ', 'wall'); inside[y * W + x] = 1; }
    // The roof slab (rows 8–10) and the floor slab (26–27).
    for (let x = a; x < b; x++) {
      put(x, 8, '═', 'solid'); put(x, 9, ' ', 'body'); put(x, 10, '▀', 'stripe');
      put(x, 26, '═', 'solid'); put(x, 27, '▀', 'body');
    }
    text(a + 8, 9, `ARENA LINE · ${ci ? 1202 : 1201}`, 'livery');
    text(b - 22, 9, `ARENA LINE · ${ci ? 1202 : 1201}`, 'livery');
    // End walls: a lintel you bump into over an open doorway, and a post behind it.
    for (const x of [a, a + 1, b - 2, b - 1]) for (let y = 11; y <= 13; y++) put(x, y, '█', 'lintel');
    for (let y = 14; y <= 25; y++) { put(a + 1, y, '┃', 'post'); put(b - 2, y, '┃', 'post'); }
    for (let x = a + 3; x < b - 3; x++) put(x, 12, '─', 'grab');
    // Windows (real holes) with an ad card above each.
    for (let m = a + 2; m + 14 <= b - 2; m += 14) {
      const x0 = m + 3, x1 = m + 13;
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1;
        put(x, 14, x === x0 ? '╭' : x === x1 ? '╮' : '─', 'wframe');
        put(x, 20, x === x0 ? '╰' : x === x1 ? '╯' : '─', 'wframe');
        for (let y = 15; y <= 19; y++) {
          if (edge) put(x, y, '│', 'wframe');
          else { ch[y * W + x] = null; role[y * W + x] = 'glass'; }
        }
        if (!edge) for (let y = 21; y <= 26; y++) shaft[y * W + x] = 1;
      }
      text(x0, 13, '[' + center(ADS[adN++ % ADS.length], 9) + ']', 'ad');
    }
    for (let x = a + 10; x < b - 8; x += 18) for (let d = -5; d <= 4; d++) put(x + d, 11, '━', 'tube');
    // The bench along the back wall.
    for (let x = a + 6; x < b - 6; x++) {
      put(x, 21, '▄', 'seat'); put(x, 22, '▀', 'seatd');
      if ((x - a) % 16 === 8) for (let y = 23; y <= 25; y++) put(x, y, '│', 'leg');
    }
    // Steel poles on the mullions, so they never cut an ad or a window.
    for (let x = a + 17; x < b - 8; x += 28) { put(x, 12, '┬', 'pole'); for (let y = 13; y <= 25; y++) put(x, y, '│', 'pole'); }
    // The underframe, bogies and wheels.
    for (let x = a + 1; x < b - 1; x++) put(x, 28, '▀', 'frame');
    for (const [p, q] of [[a + 5, a + 27], [b - 27, b - 5]]) for (let x = p; x <= q; x++) put(x, 29, '▄', 'frame');
    for (const cx of [a + 10, a + 22, b - 22, b - 10]) {
      text(cx - 2, 30, '╭─', 'wheel'); put(cx, 30, '│', 'spoke'); text(cx + 1, 30, '─╮', 'wheel');
      text(cx - 2, 31, '╰─', 'wheel'); put(cx, 31, '│', 'spoke'); text(cx + 1, 31, '─╯', 'wheel');
    }
  });
  // The gangway: bellows behind, a coupler under the plate.
  for (let x = GANGWAY[0]; x <= GANGWAY[1]; x++) {
    for (let y = 11; y <= 25; y++) { put(x, y, x % 2 ? '╎' : '│', 'gang'); inside[y * W + x] = 1; }
    put(x, 27, '━', 'coupler');
  }
  // Collision comes from the level, so art and physics can't drift apart: what you stand on (a top) is ═
  // warm white, and the floor slab runs wall to wall (the gangway plate and the room's two ends).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, k = level.cells[i];
    if (!k) continue;
    solid[i] = 1;
    const top = y > 0 && !level.cells[i - W];
    if (k === 1 || (top && role[i] !== 'lintel')) put(x, y, '═', 'solid');
    else if (ch[i] === null && y >= 26) put(x, y, '▀', 'body'); // under the floor's top at the room's ends
  }
  return { W, H, ch, role, inside, shaft, solid, tubes: TUBES.map((t) => ({ ...t })) };
}

// ---- the tunnel, scrolling: u is the tunnel coordinate under world column x (u = x + the frame's offset) ----
const isStation = (u) => mod(u, STATION_EVERY) < STATION_LEN;
export function tunnel(y, u) {
  if (y === 0) return ['█', 'rock'];
  if (y === 1) return [hash(u, 1) < 0.55 ? '▀' : ' ', 'rock'];
  if (y === 32) return [mod(u, 4) === 0 ? '┷' : '━', 'rail'];
  if (y === 31) return [hash(u, 31) < 0.5 ? '░' : '▄', 'ballast'];
  if (isStation(u)) {
    const k = mod(u, 60);
    if (y >= 15 && y <= 17 && k >= 22 && k <= 34) {
      const rel = k - 22, end = rel === 0 || rel === 12;
      if (y === 15) return [rel === 0 ? '┌' : rel === 12 ? '┐' : '─', 'tab'];
      if (y === 17) return [rel === 0 ? '└' : rel === 12 ? '┘' : '─', 'tab'];
      return end ? ['│', 'tab'] : [center(STATIONS[mod(Math.floor(u / STATION_EVERY), STATIONS.length)], 11)[rel - 1], 'tabtx'];
    }
    if (y === 12) return ['█', 'sband'];
    return [y % 3 === 0 ? (mod(u, 3) === 0 ? '┼' : '─') : (mod(u, 3) === 0 ? '│' : ' '), 'stile'];
  }
  if (mod(u, 16) === 0) return [y === 4 ? '┼' : '│', 'rib'];
  if (y === 4) return ['─', 'cable'];
  if (y === 6) return ['╌', 'cable'];
  if (y === 7 && mod(u, 140) === 70) return ['•', mod(Math.floor(u / 140), 2) ? 'sigR' : 'sigG'];
  const h = hash(u, y);
  return [h < 0.03 ? '·' : h < 0.045 ? ',' : h < 0.055 ? '░' : ' ', 'tun'];
}

// ---- the scene's state at time t (ms): the scroll, the lamps, each tube's level, the spokes ----
// Lamps: high on the tunnel wall (they light the roofs), at window height (the insides, through the
// windows), low by the track (the wheels). Reduce Motion holds one frame with the dying tube dim.
export function frameAt(t, { reducedMotion = false } = {}) {
  const off = reducedMotion ? STILL_OFF : Math.floor(t * SPEED);
  const lamps = [];
  for (const [set, y, base] of [['hi', 3, 0], ['win', 17, 20], ['lo', 30, 35]])
    for (let k = 0; k < 4; k++) lamps.push({ set, y, x: mod(k * 70 + base - off, 280) - 30 });
  const tubes = TUBES.map((T) => (T.flick ? (reducedMotion ? 0.12 : dying(t)) : 1));
  return { off, lamps, tubes, spoke: SPOKES[mod(Math.floor(off / 2), 4)], flashes: [] };
}
function dying(t) {
  const step = Math.floor(t / FLICKER_STEP);
  if (mod(step, 12) < 2) return 0.05; // a dark spell
  return hash(step, 7) < 0.3 ? 0.12 : 1;
}

// The lamp glyph at world cell (x, y) in frame F, if a lamp is there.
function lampAt(F, x, y) {
  for (const L of F.lamps) {
    if (L.y !== y) continue;
    const d = x - L.x + 1;
    if (d >= 0 && d <= 2) return (L.set === 'win' ? '▐█▌' : '▄█▄')[d];
  }
  return null;
}

// ---- light: a cheap per-cell model (no rays) ----
const AMB_OUT = [0.07, 0.06, 0.055], AMB_IN = [0.16, 0.19, 0.19];
const FLUO = [0.75, 1.0, 0.88], SOD = [1.0, 0.62, 0.25], STN = [0.75, 0.8, 0.72], FLASH = [1, 0.85, 0.6];
// zone: 'in' (a car or the gangway), 'top' (the roof strip), 'under' (the undercarriage), 'out' (seen through a hole).
export function lightAt(x, y, zone, F) {
  let [r, g, b] = zone === 'in' ? AMB_IN : AMB_OUT;
  const add = (c, f) => { r += c[0] * f; g += c[1] * f; b += c[2] * f; };
  if (zone === 'in') for (let n = 0; n < TUBES.length; n++) {
    const dx = x - TUBES[n].x;
    if (dx > 28 || dx < -28) continue;
    const d = Math.hypot(dx, (y - 11) * 2) / 28;
    if (d < 1) add(FLUO, (1 - d) * (1 - d) * 1.2 * F.tubes[n]);
  }
  const shaft = zone === 'in' && inShaft(x, y);
  for (const L of F.lamps) {
    const dx = x - L.x;
    if (dx > 34 || dx < -34) continue;
    let d = 9;
    if (L.set === 'hi' && (zone === 'top' || (zone === 'out' && y < 15))) d = Math.hypot(dx, (y - L.y) * 2) / 34;
    else if (L.set === 'win' && zone === 'out') d = Math.hypot(dx, (y - L.y) * 2) / 28;
    else if (L.set === 'win' && shaft) d = Math.abs(dx) / 20;
    else if (L.set === 'lo' && (zone === 'under' || (zone === 'out' && y > 22))) d = Math.hypot(dx, (y - L.y) * 2) / 22;
    if (d < 1) add(SOD, (1 - d) * (1 - d) * 1.5);
  }
  if (isStation(x + F.off)) add(STN, zone === 'out' ? 0.6 : zone === 'in' ? (shaft ? 0.4 : 0.1) : 0.25);
  for (const f of F.flashes || []) {
    const d = Math.hypot(x - f.x, (y - f.y) * 2) / 16;
    if (d < 1) add(FLASH, (1 - d) * f.k);
  }
  return [r, g, b];
}
export const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

// ---- palette: base colours (lit), background tints (the line look only) ----
const BASE = {
  rock: [58, 52, 46], tun: [120, 110, 96], rib: [96, 90, 80], cable: [84, 80, 76], sigR: [255, 70, 50], sigG: [80, 255, 140],
  stile: [215, 215, 200], sband: ACCENT, tab: [200, 200, 190], tabtx: [250, 248, 236], rail: [190, 190, 196], ballast: [80, 72, 62],
  lamp: [255, 196, 120], solid: COLLISION, lintel: COLLISION, body: [150, 160, 170], livery: [205, 212, 220], stripe: ACCENT,
  wall: [96, 128, 124], tube: [225, 255, 240], ad: [240, 216, 190], wframe: [150, 165, 170], grab: [140, 152, 158], pole: [205, 215, 222],
  seat: [235, 125, 55], seatd: [150, 76, 36], leg: [90, 96, 100], post: [110, 120, 128], gang: [90, 92, 100], coupler: [110, 110, 116],
  frame: [96, 98, 104], wheel: [140, 140, 146], spoke: [176, 176, 182],
};
const BG = { wall: [24, 38, 36], body: [40, 44, 50], livery: [40, 44, 50], ad: [70, 34, 12], gang: [14, 14, 16], stile: [34, 34, 30], tab: [16, 22, 44], tabtx: [16, 22, 44] };
const SOLID_BG = [64, 50, 38];
const EMISSIVE = new Set(['sigR', 'sigG', 'lamp', 'tube']);
const COLLISION_ROLES = new Set(['solid', 'lintel']);
// Decor stays below this share of collision's brightness at the same light.
const DECOR_CAP = 0.8;

const solidShade = (l) => Math.min(1.15, 0.62 + 0.45 * l);
const clamp255 = (c) => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2])];
// A cell's foreground colour. L: the light; solid: a collision cell (never dimmer than 62%); k: an emissive
// cell's level (a tube's flicker); glass: seen through a window. Brightness follows importance: what you
// stand on and bump into is the brightest thing at any light, so decor is capped below it.
export function cellColor(role, L, { solid = false, k = 1, glass = false } = {}) {
  const base = BASE[role] || BASE.tun;
  let fg;
  if (EMISSIVE.has(role)) fg = base.map((v) => v * (0.25 + 0.75 * k));
  else if (solid) { const s = solidShade(lum(L)); fg = base.map((v) => v * s); }
  else fg = [base[0] * L[0], base[1] * L[1], base[2] * L[2]];
  if (glass) fg = [fg[0] * 0.6, fg[1] * 0.75, fg[2] * 0.8];
  fg = clamp255(fg);
  if (!COLLISION_ROLES.has(role)) {
    const cap = DECOR_CAP * lum(clamp255(COLLISION.map((v) => v * solidShade(lum(L))))), l = lum(fg);
    if (l > cap) fg = fg.map((v) => (v * cap) / l);
  }
  return fg;
}

// ---- looks: the same scene, two glyph vocabularies ('line' box-drawing, 'ascii' 7-bit) ----
const ASCII = {
  '─': '-', '━': '-', '│': '|', '┃': '|', '║': '|', '╎': ':', '╌': '-', '╭': '.', '╮': '.', '╰': "'", '╯': "'",
  '┌': '+', '┐': '+', '└': '+', '┘': '+', '┼': '+', '┬': '+', '┷': '+', '├': '+', '┤': '+', '╤': '+',
  '═': '=', '▀': '"', '▄': '_', '█': '#', '▓': '#', '▒': ':', '░': '.', '·': '.', '•': 'o', '▐': '[', '▌': ']',
  '╼': '-', '╾': '-', '╱': '/', '╲': '\\',
};
export function lookChar(look, c, role, l) {
  if (look === 'line') return c;
  switch (role) {
    case 'wall': return l < 0.45 ? ' ' : l < 0.9 ? '.' : ':';
    case 'tun': return c === ' ' ? (l < 0.3 ? ' ' : l < 0.6 ? '.' : ':') : (ASCII[c] ?? c);
    case 'body': return ' ';
    case 'stripe': return '-';
    case 'tube': return '~';
    case 'lintel': return '#';
    case 'rock': return c === '█' ? '#' : c === ' ' ? ' ' : "'";
    case 'seatd': return '"';
    case 'frame': return '_';
    case 'ballast': return c === '▄' ? '.' : ',';
  }
  return ASCII[c] ?? (c.charCodeAt(0) < 127 ? c : '.');
}

// Every character the decor can draw, in either look: renderers put these in their glyph atlases.
// The signs, the ads and the ascii look are all printable ASCII (the livery's · aside).
export const TRAIN_GLYPHS = '═▀▄█┃─│╭╮╰╯━┬╎╱╲┷░┌┐└┘┼╌•·▐▌' + String.fromCharCode(...Array.from({ length: 95 }, (_, k) => 32 + k));

// One cell of the scene at world cell (x, y), into out: { ch, fg, bg, glow, role, glass }. bg is null
// where nothing tints the background; glow is the cell's halation (emissive cells), or null.
export function paint(T, F, look, x, y, out) {
  const inRoom = x >= 0 && y >= 0 && x < T.W && y < T.H;
  const i = y * T.W + x;
  let c = inRoom ? T.ch[i] : null, r = inRoom ? T.role[i] : null, zone;
  const glass = r === 'glass', solid = inRoom && T.solid[i] === 1;
  if (c === null) {
    // Past the room's ceiling and rails (its walls, a tall view), the tunnel is rock.
    [c, r] = y < 0 || y >= T.H ? ['█', 'rock'] : tunnel(y, x + F.off);
    const lamp = lampAt(F, x, y);
    if (lamp && !solid) { c = lamp; r = 'lamp'; }
    zone = 'out';
  } else zone = T.inside[i] || (y >= 11 && y <= 26) ? 'in' : y <= 10 ? 'top' : 'under';
  if (r === 'spoke') c = F.spoke;
  const L = lightAt(x, y, zone, F), l = lum(L);
  let k = 1;
  if (r === 'tube') for (let n = 0; n < TUBES.length; n++) if (Math.abs(TUBES[n].x - x) <= 5) { k = F.tubes[n]; break; }
  out.fg = cellColor(r, L, { solid, k, glass });
  out.ch = lookChar(look, c, r, l);
  // The line look tints backgrounds; under what you stand on, a warm band as steady as the ═ over it.
  if (look !== 'line') out.bg = null;
  else if (r === 'solid') { const s = solidShade(l); out.bg = SOLID_BG.map((v) => v * s); }
  else out.bg = BG[r] ? BG[r].map((v, n) => v * Math.min(1.6, L[n] + 0.2)) : null;
  out.glow = EMISSIVE.has(r) && k > 0.5 ? BASE[r].map((v) => v * (glass ? 0.6 : 1)) : null;
  out.role = r;
  out.glass = glass;
  return out;
}

// A window of the scene for a renderer: w×h cells from world cell (x0, y0), each as its glyph, its colour
// and an always-opaque background (the line look's tint, or the page's), and the glow sources for halation.
// out (from the last call) is reused when the size is the same, so a frame makes no garbage.
const PAGE = [7, 8, 11];
export function paintWindow(T, F, look, x0, y0, w, h, out = null) {
  const n = w * h;
  if (!out || out.w !== w || out.h !== h) {
    out = { w, h, ch: new Array(n), fg: new Uint8ClampedArray(n * 4), bg: new Uint8ClampedArray(n * 4), glow: new Float32Array(n * 3) };
  }
  out.x0 = x0; out.y0 = y0;
  const cell = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    paint(T, F, look, x0 + x, y0 + y, cell);
    out.ch[k] = cell.ch;
    const bg = cell.bg || PAGE;
    for (let c = 0; c < 3; c++) {
      out.fg[k * 4 + c] = Math.round(Math.min(255, cell.fg[c]));
      out.bg[k * 4 + c] = Math.round(Math.min(255, bg[c]));
      out.glow[k * 3 + c] = cell.glow ? cell.glow[c] : 0;
    }
    out.fg[k * 4 + 3] = 255;
    out.bg[k * 4 + 3] = 255;
  }
  return out;
}

// Halation: the glow sources (emissive cells, and extras: { x, y, c } in window cells for tracers and
// muzzle flashes) blurred a couple of cells sideways and a cell up and down (a cell is twice as tall as
// wide), as RGBA bytes one pixel per cell for an additive pass. Visible, but never a smear over the scene.
// Muzzle flashes (pvp.flashes: arena-local, k fading from 1.8) as halation sources, like tracers: the
// flash's warm colour, brighter while fresh.
export const flashGlows = (list) => list.map((f) => ({ x: f.x, y: f.y, c: FLASH.map((v) => v * 255 * f.k) }));

export const HALATION_GAIN = 1.1;
const HX = [1, 2, 3, 2, 1], HY = [1, 2, 1];
// scratch: { a, b, out }, kept by the caller and reused while the window's size holds (the result is scratch.out).
export function halation(src, w, h, extra = [], gain = HALATION_GAIN, scratch = null) {
  const n = w * h;
  const a = scratch && scratch.a.length === n * 3 ? scratch.a : new Float32Array(n * 3);
  const b = scratch && scratch.b.length === n * 3 ? scratch.b : new Float32Array(n * 3);
  a.set(src.subarray(0, n * 3));
  for (const e of extra) {
    const x = Math.floor(e.x), y = Math.floor(e.y);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    for (let c = 0; c < 3; c++) a[(y * w + x) * 3 + c] += e.c[c];
  }
  b.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 3;
    if (!a[k] && !a[k + 1] && !a[k + 2]) continue;
    for (let d = -2; d <= 2; d++) {
      const xx = x + d;
      if (xx < 0 || xx >= w) continue;
      const f = HX[d + 2] / 9, j = (y * w + xx) * 3;
      b[j] += a[k] * f; b[j + 1] += a[k + 1] * f; b[j + 2] += a[k + 2] * f;
    }
  }
  // Every byte is written below, so a reused output needs no clearing.
  const out = scratch && scratch.out && scratch.out.length === n * 4 ? scratch.out : new Uint8ClampedArray(n * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let d = -1; d <= 1; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) v += b[(yy * w + x) * 3 + c] * HY[d + 1];
      }
      out[o + c] = Math.round((v / 4) * gain);
    }
    out[o + 3] = 255;
  }
  if (scratch) { scratch.a = a; scratch.b = b; scratch.out = out; }
  return out;
}
