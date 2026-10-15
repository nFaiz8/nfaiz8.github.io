// The gorge under Tianlong bridge (Wulong), side on (gorge addendum): the Tianfu post house's courtyard
// filling the bottom left, the bridge's pillar and span on the right with the arch and its waterfall under
// it, a plank road up the pillar's face, two caves through it, a via ferrata, cliff pines, and the ribbon
// forest on top. A port of .superpowers/gorge/scene.js at its default layout. Pure and DOM-free: what you
// collide with is generated from it into src/gorge.txt (gorgeLevelText), and look.js draws it.
//
// Cols:  0-129 the courtyard (gate, side hall, main hall on its terrace, shop hall); the plank road from 130
// Rows:  0-16   sky; the ribbon forest and the stall stand on the span's top (row 17)
//        17-61  the span, wall to the right edge; 40-62 the arch's ceiling curves down to the pillar
//        62-105 the pillar (left face ~86-95, arch side ~120-124); the arch opening and the pool to its right
//        72-105 the post house: the main hall at the back, a side hall either side, the courtyard between
//        106+   the gorge floor; the jade pool from col 128
import { AIR, PLATFORM, SOLID } from '../level.js';

// The post house's layout: the standalone page's admin panel could change it; the arena's is fixed.
export const LAYOUT = { courtyard: 52, hall: 1, storeys: 2, wings: true, gate: true, umbrellas: 2, crates: true };
export const OX = LAYOUT.courtyard; // the courtyard's extra width: everything from the pillar on sits this far right
export const W = 160 + OX, H = 112, N = W * H;
export const FLOOR = 106, DECK = 17;
export const POOL_X = 128 + OX;
export const STAIRS_X = 78 + OX; // the plank road starts here, right of the courtyard

export function hash(a, b) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const mod = (n, m) => ((n % m) + m) % m;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
// Smooth value noise on a hash grid, 0..1.
export function noise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash(a + seed * 7919, b - seed * 104729);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---- the pillar's outline ----
const FACE = [[17, 88], [18, 86], [19, 85], [21, 84], [30, 83], [50, 83], [70, 86], [90, 90], [106, 95]].map(([r, x]) => [r, x + OX]);
const ARCH_IN = [[62, 121], [85, 120], [106, 124]].map(([r, x]) => [r, x + OX]);
const ARCH = { cx: W, cy: 62, a: 39, b: 22 }; // the ceiling: a quarter ellipse from the right edge down to the pillar
function along(P, r) {
  if (r <= P[0][0]) return P[0][1];
  for (let k = 1; k < P.length; k++) if (r <= P[k][0]) { const [r0, x0] = P[k - 1], [r1, x1] = P[k]; return x0 + ((x1 - x0) * (r - r0)) / (r1 - r0); }
  return P[P.length - 1][1];
}
// The first rock column of a row (the left face), a little rough; the first open column past the pillar.
export const faceX = (r) => Math.round(along(FACE, r) + (r > 22 && hash(r, 11) < 0.22 ? 1 : 0));
export function archX(r) {
  if (r < ARCH.cy - ARCH.b) return W;
  if (r <= ARCH.cy) return Math.round(ARCH.cx - ARCH.a * Math.sqrt(Math.max(0, 1 - ((ARCH.cy - r) / ARCH.b) ** 2)));
  return Math.round(along(ARCH_IN, r) + (hash(r, 12) < 0.2 ? 1 : 0));
}
// The arch's ceiling over column x: the lowest rock row above the opening.
export function archTop(x) {
  for (let r = ARCH.cy - ARCH.b; r < FLOOR; r++) if (x >= archX(r)) return r;
  return FLOOR;
}

// ---- the grid: a glyph and a role per cell (null: the backdrop shows), what it is for the physics, and
// which light reaches it ----
export const CH = new Array(N).fill(null), ROLE = new Array(N).fill(null);
export const KIND = new Uint8Array(N);
export const ZONE = new Uint8Array(N); // Z_OUT, Z_ROCK, Z_CAVE
export const FRONT = new Uint8Array(N); // drawn over the people (the pool)
export const Z_OUT = 0, Z_ROCK = 1, Z_CAVE = 2;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
export function put(x, y, c, role, kind) {
  if (!inside(x, y)) return;
  const i = y * W + x;
  CH[i] = c; ROLE[i] = role;
  if (kind !== undefined) KIND[i] = kind;
}
// Decor goes only into open air, never over rock or anything you stand on.
export function deco(x, y, c, role) {
  if (!inside(x, y)) return;
  const i = y * W + x;
  if (KIND[i] !== AIR || ZONE[i] === Z_ROCK) return;
  CH[i] = c; ROLE[i] = role;
}
const text = (x, y, s, role) => [...s].forEach((c, k) => deco(x + k, y, c, role));
export const kindAt = (c, r) => (c < 0 || c >= W || r >= H ? SOLID : r < 0 ? AIR : KIND[r * W + c]);

// ---- rock and ground ----
for (let r = DECK; r < FLOOR; r++) {
  const a = faceX(r), b = archX(r);
  for (let x = a; x < b; x++) { put(x, r, ' ', 'rock', SOLID); ZONE[r * W + x] = Z_ROCK; }
}
for (let r = FLOOR; r < H; r++) for (let x = 0; x < W; x++) { put(x, r, ' ', 'earth', SOLID); ZONE[r * W + x] = Z_ROCK; }
// The jade pool under the arch: knee deep from POOL_X + 2, a shelf at POOL_X.
export const poolBed = (x) => (x < POOL_X ? FLOOR : x < POOL_X + 2 ? FLOOR + 1 : FLOOR + 2);
for (let x = POOL_X; x < W; x++) for (let r = FLOOR; r < poolBed(x); r++) {
  const i = r * W + x;
  put(x, r, r === FLOOR ? '~' : ' ', 'water', AIR);
  ZONE[i] = Z_OUT; FRONT[i] = 1;
}

// ---- caves: carved out of the pillar, lit by their own lanterns ----
function carve(x0, x1, r0, r1) {
  for (let r = r0; r <= r1; r++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const i = r * W + x;
    if (!inside(x, r) || (ROLE[i] !== 'rock' && ROLE[i] !== 'cave')) continue;
    put(x, r, ' ', 'cave', AIR);
    ZONE[i] = Z_CAVE;
  }
}

// ---- walkways ----
export const LADDERS = []; // { x: the climbing column's centre, top: the row you stand on up there, bot: down there }
function plank(x0, x1, r) {
  for (let x = x0; x <= x1; x++) put(x, r, '═', 'plank', PLATFORM);
}
// Stairs rising one row every two columns: dir +1 climbs to the right. Returns the last tread.
function stairs(x, r, dir, n) {
  let c = x;
  for (let k = 0; k < n; k++) {
    c = dir > 0 ? x + 2 * k : x - 2 * k - 1;
    plank(c, c + 1, r - k);
  }
  return { x: c, r: r - n + 1 };
}
function ladder(x, top, bot) {
  LADDERS.push({ x: x + 0.5, top, bot });
}

// 0. The passage through the pillar's foot, so the path runs on from the courtyard to the arch.
carve(faceX(105) - 1, archX(105) + 1, 100, 105);
// 1. From the courtyard up to the face, back out over the side hall's roof, and back to the face.
const s1 = stairs(STAIRS_X, FLOOR - 1, 1, 7);                  // to row 99
plank(s1.x, faceX(s1.r) - 1, s1.r);
const s2 = stairs(s1.x + 1, s1.r - 1, -1, 13);           // to row 86 at cols 64-65
plank(s2.x - 9, s2.x + 1, s2.r);                         // the lookout over the courtyard
export const LOOKOUT = { x0: s2.x - 9, x1: s2.x + 1, r: s2.r };
const s3 = stairs(s2.x + 2, s2.r - 1, 1, 10);            // to row 76
plank(s3.x, faceX(s3.r) - 1, s3.r);
export const CAVE1 = { r: s3.r, x0: faceX(s3.r), x1: archX(s3.r) };
// 2. The shrine cave east through the pillar, out under the arch onto a balcony.
carve(CAVE1.x0 - 1, CAVE1.x1, CAVE1.r - 5, CAVE1.r - 1);
carve(CAVE1.x0 + 13, CAVE1.x0 + 19, CAVE1.r - 7, CAVE1.r - 6); // the shrine's niche
for (let x = CAVE1.x0; x < CAVE1.x1; x++) put(x, CAVE1.r, '═', 'top', SOLID);
export const BALCONY = { x0: CAVE1.x1, x1: CAVE1.x1 + 15, r: CAVE1.r };
plank(BALCONY.x0, BALCONY.x1, BALCONY.r);
// 3. Up the arch's inner face, and the long stair west back through the pillar.
const C2R = 64;
ladder(archX(70) + 1, C2R, CAVE1.r);
plank(archX(C2R) - 1, archX(C2R) + 4, C2R);
carve(archX(C2R) + 2, archX(C2R) - 7, C2R - 5, C2R - 1);
export var CAVE2_EXIT;
{
  let x = archX(C2R) - 8, r = C2R - 1;
  while (x > faceX(r) - 3) {
    carve(x - 1, x, r - 5, r - 1);
    put(x - 1, r, '═', 'plank', PLATFORM); put(x, r, '═', 'plank', PLATFORM);
    x -= 2; r -= 1;
  }
  CAVE2_EXIT = { x: x + 2, r: r + 1 };
}
plank(CAVE2_EXIT.x - 10, CAVE2_EXIT.x, CAVE2_EXIT.r);
// 4. The via ferrata up the face, two cliff pines to jump, the last ladder to the top.
export const FERRATA = { x: faceX(CAVE2_EXIT.r - 6) - 3, top: CAVE2_EXIT.r - 12 };
ladder(FERRATA.x, FERRATA.top, CAVE2_EXIT.r);
plank(FERRATA.x - 8, FERRATA.x + 1, FERRATA.top);
export const PINES = [{ x0: FERRATA.x - 16, x1: FERRATA.x - 11, r: FERRATA.top - 5 }, { x0: FERRATA.x - 8, x1: FERRATA.x + 1, r: FERRATA.top - 10 }];
for (const p of PINES) plank(p.x0, p.x1, p.r);
ladder(FERRATA.x, DECK, PINES[1].r);
plank(FERRATA.x - 2, faceX(DECK) - 1, DECK);

// ---- the rock's face: collision tops, rims, strata, moss and ferns (fixed: the life is elsewhere) ----
const rockish = (i) => ROLE[i] === 'rock';
for (let r = DECK; r < H; r++) for (let x = 0; x < W; x++) {
  const i = r * W + x;
  if (!rockish(i) && ROLE[i] !== 'earth') continue;
  const up = r > 0 ? KIND[i - W] : AIR, down = r < H - 1 ? KIND[i + W] : SOLID;
  const left = x > 0 ? KIND[i - 1] : SOLID, right = x < W - 1 ? KIND[i + 1] : SOLID;
  if (up !== SOLID && !(r > 0 && ROLE[i - W] === 'water')) {
    // a ledge you'd notice is a top (═); a notch in the face a cell or two wide is just rim
    let run = 1;
    for (let d = 1; d < 3; d++) { if (KIND[i - d] === SOLID && KIND[i - d - W] !== SOLID) run++; if (KIND[i + d] === SOLID && KIND[i + d - W] !== SOLID) run++; }
    const top = run >= 3 || r === DECK || r >= FLOOR;
    put(x, r, top ? '═' : left === AIR ? '▐' : right === AIR ? '▌' : '▀', top ? 'top' : 'rim');
    continue;
  }
  if (ROLE[i] === 'earth') {
    const h = hash(x, r);
    put(x, r, h < 0.05 ? '·' : h < 0.07 ? ',' : ' ', 'earth');
    continue;
  }
  if (down === AIR) { put(x, r, '▀', 'rim'); continue; }
  if (left === AIR) { put(x, r, '▐', 'rim'); continue; }
  if (right === AIR) { put(x, r, '▌', 'rim'); continue; }
  // limestone: long vertical strata, a bedding line now and then, moss where water runs
  const strata = hash(x, 1) < 0.17 && noise(x * 0.3, r / 5, 1) > 0.42;
  const bed = noise(x / 9, r * 0.9, 2) > 0.86;
  const nearFace = x - faceX(r) < 7 || archX(r) - x < 5;
  const moss = noise(x / 6, r / 3.5, 3) + (nearFace ? 0.12 : 0) + (r > 80 ? 0.08 : 0) + (r < 28 ? 0.1 : 0);
  if (moss > 0.74) put(x, r, hash(x, r + 7) < 0.55 + (moss - 0.74) * 3 ? [',', '\'', '"', ';'][Math.floor(hash(x, r + 9) * 4)] : ' ', 'moss');
  else if (moss > 0.68 && hash(x, r) < 0.5) put(x, r, hash(x, r + 1) < 0.5 ? ',' : '\'', 'fern');
  else if (strata) put(x, r, hash(x, r) < 0.2 ? '╎' : '│', 'strata');
  else if (bed) put(x, r, '─', 'strata');
  else put(x, r, ' ', 'rock');
}
for (let x = 0; x < POOL_X; x++) put(x, FLOOR, '═', 'top');

// ---- supports under the walkways: a post down to whatever is below, or a strut back to the rock ----
function strut(x, r, dir) {
  // from under the plank down and back to the face, a column a row (a cell's diagonal)
  let n = 1;
  while (n < 9 && inside(x + dir * n, r + n) && KIND[(r + n) * W + x + dir * n] !== SOLID) n++;
  if (n >= 9) return; // too far from the rock to brace
  for (let k = 1; k < n; k++) if (CH[(r + k) * W + x + dir * k] === null) deco(x + dir * k, r + k, dir > 0 ? '╲' : '╱', 'post');
}
function supports() {
  const cells = [];
  for (let r = 0; r < FLOOR; r++) for (let x = 0; x < W; x++) {
    const i = r * W + x;
    if (ROLE[i] === 'plank' && ZONE[i] !== Z_CAVE && x % 5 === 0 && KIND[i + W] === AIR && ZONE[i + W] !== Z_CAVE) cells.push([x, r]);
  }
  for (const [x, r] of cells) {
    let y = r + 1;
    while (y < FLOOR && KIND[y * W + x] === AIR && y < r + 26) y++;
    if (y < r + 26 && ROLE[y * W + x] !== 'cave') { for (let k = r + 1; k < y; k++) if (CH[k * W + x] === null) deco(x, k, '│', 'post'); }
    else strut(x, r, x < archX(r) ? 1 : -1);
  }
}
supports();
// The pines: a trunk out of the rock, rising three columns a row to the branch you stand on, needles under it.
for (const p of PINES) {
  for (let k = 1; k < 12; k++) {
    const y = p.r + k, xa = p.x1 + 1 + 3 * (k - 1);
    if (kindAt(xa, y) === SOLID) break;
    deco(xa, y, '▀', 'trunk'); deco(xa + 1, y, '▀', 'trunk'); deco(xa + 2, y, '▄', 'trunk');
  }
  for (let x = p.x0 - 2; x <= p.x1 + 1; x++) for (const dy of [1, 2]) {
    if (hash(x, p.r + dy) < (dy === 1 ? 0.85 : 0.5)) deco(x, p.r + dy, hash(x, dy) < 0.5 ? '*' : '"', 'needles');
  }
  for (let x = p.x0 - 1; x <= p.x0 + 2; x++) if (hash(x, p.r) < 0.7) deco(x, p.r - 4, '*', 'needles');
}

// ---- railings along the planks (decor, behind the people) ----
function rail(x0, x1, r) {
  for (let x = x0; x <= x1; x++) {
    deco(x, r - 2, (x - x0) % 4 === 0 ? '┬' : '─', 'rail');
    if ((x - x0) % 4 === 0) deco(x, r - 1, '│', 'rail');
  }
}
rail(LOOKOUT.x0, LOOKOUT.x1 - 4, LOOKOUT.r);
rail(BALCONY.x0 + 2, BALCONY.x1, BALCONY.r);
rail(CAVE2_EXIT.x - 10, CAVE2_EXIT.x - 3, CAVE2_EXIT.r);
rail(FERRATA.x - 8, FERRATA.x - 2, FERRATA.top);

// ---- the post house (after the Tianfu post house under Tianlong bridge), its courtyard seen across: a
// gate on the left, a side hall, the two-tier main hall on its stone terrace at the back, a shop hall by the
// stairs; lit umbrellas and the incense burner on the terrace, lanterns under every eave. The roofs, the
// terrace, the gallery, the tables and the umbrellas are all things you can stand on and climb. ----
export const LANTERNS = []; // { x, y (the string's row) }
// a platform cell: stood on from above, jumped through from below, never written over rock
function stand(x, y, c, role) { if (inside(x, y) && KIND[y * W + x] !== SOLID) put(x, y, c, role, PLATFORM); }
// A tiled roof: rows widening down to the eave, each a column or more wider a side than the one above, so
// you walk up it a row at a time. Only the tread of each row (what nothing of the roof is over) holds you;
// inside it is open, so you can jump up through it.
function roof(cx, top, hw0, hw1, rows) {
  const hws = [];
  for (let k = 0; k < rows; k++) { const f = k / (rows - 1); hws.push(Math.max(k ? hws[k - 1] + 1 : hw0, Math.round(hw0 + (hw1 - hw0) * f * f))); }
  for (let k = 0; k < rows; k++) {
    const y = top + k, hw = hws[k], over = k ? hws[k - 1] : -1, edge = k === 0 || k === rows - 1;
    for (let x = cx - hw; x <= cx + hw; x++) {
      const g = edge ? '▄' : x === cx - hw ? '╱' : x === cx + hw ? '╲' : '│';
      if (Math.abs(x - cx) > over) stand(x, y, g, 'roof'); else deco(x, y, g, 'tile');
    }
  }
  const eave = top + rows - 1, hw = hws[rows - 1];
  for (const d of [-1, 1]) {
    deco(cx + d * (hw0 + 1), top - 1, d < 0 ? '╲' : '╱', 'ridge');
    deco(cx + d * (hw + 1), eave - 1, d < 0 ? '╲' : '╱', 'eave');
  }
  return eave;
}
function hallWall(x0, x1, y0, y1, bays, door, latticeRows = 3) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = (x - x0) % bays;
    if (k === 0) deco(x, y, '┃', 'pillar');
    else if (door && x > door[0] && x < door[1] && y > y0) deco(x, y, ' ', 'door');
    else if (y === y0) deco(x, y, '─', 'beam');
    else if (y <= y0 + latticeRows) deco(x, y, (y - y0) % 2 ? (x % 2 ? '┼' : '─') : (x % 2 ? '│' : ' '), 'lattice');
    else deco(x, y, ' ', 'plaster');
  }
}
function shelves(x0, x1, rows, skip) {
  for (let x = x0; x <= x1; x++) {
    if (skip(x)) continue;
    for (const y of rows) { deco(x, y, '─', 'shelf'); if (hash(x, y) < 0.7) deco(x, y - 1, ['o', '▄', 'i', '▄'][Math.floor(hash(x, y + 1) * 4)], 'goods'); }
  }
}
// bamboo behind it all, along the gorge wall
for (let x = 0; x < STAIRS_X; x++) if (hash(x, 51) < 0.2) {
  const top = 64 + Math.floor(hash(x, 52) * 12);
  for (let y = top; y < FLOOR; y++) deco(x, y, (y - top) % 4 === 3 ? '┼' : '│', 'bamboo');
  // a leaf off each node, and a tuft at the top
  for (let y = top + 3; y < FLOOR; y += 4) { const d = hash(x, y) < 0.5 ? -1 : 1; deco(x + d, y, d < 0 ? '╲' : '╱', 'leaf'); }
  for (let k = 0; k < 7; k++) deco(x - 2 + Math.floor(hash(x, k + 60) * 5), top - 1 + Math.floor(hash(x, k + 70) * 3), [',', '\'', '"', ';'][k % 4], 'leaf');
}
// the main hall, at the back, on its terrace: as wide as LAYOUT.hall says, one to three storeys
export var HALL, TERRACE, WINGS = null, GATE = null;
{
  const left = LAYOUT.wings ? 42 : LAYOUT.gate ? 17 : 2, right = LAYOUT.wings ? STAIRS_X - 24 : STAIRS_X - 3;
  // as big as asked, but no bigger than the room between the side halls (its terrace may tuck under their eaves)
  const s = Math.min(LAYOUT.hall, ((right - left) / 2 + 6) / 30), r = (v) => Math.round(v * s);
  const cx = Math.round((left + right) / 2);
  const el = roof(cx, 85, r(15), r(28), 6);                   // the lower roof, eave at 90
  hallWall(cx - r(24), cx + r(24), el + 1, 102, 6, [cx - r(11), cx + r(11)], 2);
  shelves(cx - r(10), cx + r(10), [el + 5, el + 8], (x) => (x - (cx - r(24))) % 6 === 0);
  for (const d of [-21, -15, -9, 9, 15, 21]) LANTERNS.push({ x: cx + r(d), y: el + 1 });
  // the storeys over it: a wall with a gallery round it, a roof; each narrower than the one below
  let base = 85, k = 1, sign = null, upper = null;
  for (let t = 1; t < LAYOUT.storeys; t++, k *= 0.8) {
    const q = (v) => Math.round(v * s * k), top = base - 16;
    const eu = roof(cx, top, q(7), q(20), 7);
    hallWall(cx - q(14), cx + q(14), eu + 1, base - 1, 4, null, 2);
    const gy = eu + 5;
    for (let x = cx - q(17); x <= cx + q(17); x++) { stand(x, gy, '═', 'plank'); deco(x, gy - 1, (x - cx) % 3 ? '─' : '┬', 'gallery'); }
    for (let x = cx - q(17); x <= cx + q(17); x += 6) for (let y = gy + 1; y < base; y++) deco(x, y, '│', 'gallery');
    for (const d of [-10, 10]) LANTERNS.push({ x: cx + q(d), y: eu + 1 });
    if (!sign) { sign = { x: cx - 4, y: eu + 2 }; upper = eu + 4; }
    base = top;
  }
  // with one storey the sign hangs on the lower beam
  if (!sign) sign = { x: cx - 4, y: el + 1 };
  for (let x = sign.x - 2; x <= sign.x + 7; x++) deco(x, sign.y, ' ', 'board');
  // the stone terrace, a step up a row at a time at each end
  TERRACE = { x0: cx - r(30), x1: cx + r(30), r: FLOOR - 3 };
  for (let y = TERRACE.r; y < FLOOR; y++) {
    const inset = 2 * (FLOOR - 1 - y);
    for (let x = TERRACE.x0 + inset; x <= TERRACE.x1 - inset; x++) { put(x, y, ' ', 'plinth', SOLID); ZONE[y * W + x] = Z_OUT; }
  }
  for (let y = TERRACE.r; y < FLOOR; y++) for (let x = TERRACE.x0; x <= TERRACE.x1; x++) {
    const i = y * W + x;
    if (ROLE[i] !== 'plinth') continue;
    if (KIND[i - W] !== SOLID) put(x, y, '═', 'top');
    else if (Math.abs(x - cx) < 7) put(x, y, (y + x) % 2 ? '▀' : '▄', 'step');
    else put(x, y, (x - TERRACE.x0) % 6 === 0 ? '│' : ' ', 'plinth');
  }
  HALL = { cx, scale: s, door: [cx - r(11), cx + r(11)], sign, lowerEave: el, upperY: upper ?? el - 4, top: base };
}
// the side hall on the left and the shop by the stairs, nearer to us; a gate at the far left
if (LAYOUT.wings) {
  const L = { cx: 29, top: 87 }, R = { cx: STAIRS_X - 13, top: 89 };
  const el = roof(L.cx, L.top, 4, 12, 5);
  hallWall(L.cx - 10, L.cx + 10, el + 1, 105, 5, null, 3);
  const er = roof(R.cx, R.top, 3, 10, 5);
  hallWall(R.cx - 8, R.cx + 8, er + 1, 105, 4, [R.cx - 6, R.cx + 6], 1);
  shelves(R.cx - 5, R.cx + 5, [er + 5, er + 8], (x) => (x - (R.cx - 8)) % 4 === 0);
  for (const x of [L.cx - 10, L.cx, L.cx + 10]) LANTERNS.push({ x, y: el + 1 });
  for (const x of [R.cx - 8, R.cx + 8]) LANTERNS.push({ x, y: er + 1 });
  WINGS = { left: { ...L, eave: el }, right: { ...R, eave: er, x0: R.cx - 8, x1: R.cx + 8, door: [R.cx - 6, R.cx + 6] } };
}
if (LAYOUT.gate) {
  // two red posts, beams, a board, a little roof you can stand on
  GATE = { cx: 8 };
  const eg = roof(GATE.cx, 90, 2, 7, 4);
  for (let x = GATE.cx - 6; x <= GATE.cx + 6; x++) { deco(x, eg + 1, '▀', 'beam'); deco(x, eg + 3, '─', 'beam'); }
  for (const x of [GATE.cx - 5, GATE.cx + 5]) for (let y = eg + 1; y < FLOOR; y++) deco(x, y, '┃', 'pillar');
  for (let x = GATE.cx - 2; x <= GATE.cx + 1; x++) deco(x, eg + 2, ' ', 'board');
  GATE.sign = { x: GATE.cx - 2, y: eg + 2 };
  LANTERNS.push({ x: GATE.cx - 3, y: eg + 4 }, { x: GATE.cx + 3, y: eg + 4 });
}
for (const L of LANTERNS) deco(L.x, L.y, '│', 'string');
// on the terrace: lit umbrellas over tea tables, the incense burner before the door
export const UMBRELLAS = [-19, 19, -26, 26].slice(0, LAYOUT.umbrellas).map((d) => ({ x: HALL.cx + Math.round(d * HALL.scale), y: 95 }));
for (const U of UMBRELLAS) {
  for (let x = U.x - 4; x <= U.x + 4; x++) deco(x, U.y, x === U.x - 4 || x === U.x + 4 ? '▄' : '█', 'umbrella');
  for (let x = U.x - 3; x <= U.x + 3; x++) stand(x, U.y - 1, '▄', 'canopy');
  for (let y = U.y + 1; y < FLOOR; y++) if (KIND[y * W + U.x] !== SOLID) deco(U.x, y, '│', 'pole');
  const ground = kindAt(U.x, TERRACE.r) === SOLID ? TERRACE.r : FLOOR;
  for (let x = U.x - 2; x <= U.x + 2; x++) stand(x, ground - 3, '▄', 'tabletop');
  for (const d of [-2, 2]) { deco(U.x + d, ground - 2, '│', 'table'); deco(U.x + d, ground - 1, '│', 'table'); }
}
export const BURNER = { x: HALL.cx, y: TERRACE.r - 5 };
{
  const b = BURNER;
  text(b.x - 2, b.y, '▄▄█▄▄', 'bronze'); text(b.x - 2, b.y + 1, '▐███▌', 'bronze'); text(b.x - 1, b.y + 2, '▀█▀', 'bronze');
  text(b.x - 2, b.y + 3, '╱ │ ╲', 'bronze'); text(b.x - 3, b.y + 4, '╱  │  ╲', 'bronze');
}
export const STONE_LANTERNS = [{ x: faceX(102) + 6, y: 101 }, { x: archX(102) - 6, y: 101 }, { x: TERRACE.x0 - 3, y: 101, yard: true }, { x: TERRACE.x1 + 3, y: 101, yard: true }]
  .filter((L) => !L.yard || !(L.x < HALL.cx && LAYOUT.wings && LAYOUT.crates)); // the crates stand there
for (const s of STONE_LANTERNS) {
  text(s.x - 1, s.y, '▄█▄', 'stone'); deco(s.x - 1, s.y + 1, '▐', 'stone'); deco(s.x, s.y + 1, '█', 'stonelamp'); deco(s.x + 1, s.y + 1, '▌', 'stone');
  text(s.x - 1, s.y + 2, '▀█▀', 'stone'); for (let y = s.y + 3; y < FLOOR; y++) deco(s.x, y, '█', 'stone');
}
// crates stacked against the side hall: the way up onto its roof, and from there the gate's
export const CRATES = LAYOUT.crates && WINGS ? [{ x0: 36, x1: 43, top: 102 }, { x0: 36, x1: 39, top: 98 }] : [];
for (const C of CRATES) {
  for (let y = C.top + 1; y < FLOOR; y++) for (let x = C.x0; x <= C.x1; x++) {
    if (CH[y * W + x] && ROLE[y * W + x] === 'crate') continue;
    deco(x, y, x === C.x0 || x === C.x1 ? '│' : (y - C.top) % 4 === 0 ? '─' : ' ', 'crate');
  }
  for (let x = C.x0; x <= C.x1; x++) stand(x, C.top, '▄', 'cratetop');
}
text(STAIRS_X - 1, 98, '[^]', 'sign');
for (let y = 99; y <= 105; y++) deco(STAIRS_X, y, '│', 'post');

// ---- the shrine cave: lanterns, the niche's figure and its candles ----
export const SHRINE = { x: CAVE1.x0 + 16, y: CAVE1.r - 1 };
export const CAVE_LAMPS = [{ x: CAVE1.x0 + 6, y: CAVE1.r - 5 }, { x: CAVE1.x0 + 26, y: CAVE1.r - 5 }, { x: CAVE1.x1 - 4, y: CAVE1.r - 5 }, { x: archX(C2R) - 4, y: C2R - 5 }];
for (const k of [0, 1]) { const a = CAVE2_EXIT.x + 6 + k * 12; CAVE_LAMPS.push({ x: a, y: CAVE2_EXIT.r - 5 + Math.floor((a - CAVE2_EXIT.x) / 2) }); }
{
  const s = SHRINE;
  text(s.x - 1, s.y - 2, ' ▄ ', 'statue'); text(s.x - 1, s.y - 1, '▐█▌', 'statue'); text(s.x - 2, s.y, '▄███▄', 'altar');
  deco(s.x - 3, s.y - 1, 'i', 'candle'); deco(s.x + 3, s.y - 1, 'i', 'candle');
}
for (const L of CAVE_LAMPS) deco(L.x, L.y, '│', 'string');

// ---- ladders: rails and rungs, warm like everything you can use; the rails stand two rows over the top ----
for (const L of LADDERS) {
  const x = Math.floor(L.x);
  for (let y = L.top - 2; y < L.bot; y++) {
    const rung = y % 2 === 0;
    deco(x - 1, y, rung ? '├' : '│', 'ladder'); deco(x + 1, y, rung ? '┤' : '│', 'ladder');
    if (rung) deco(x, y, '─', 'ladder');
  }
}

// ---- the top: cedars hung with prayer ribbons, a thatched stall, the bridge's stele ----
export const CEDARS = [94, 101, 108, 114, 133, 140, 147, 154].map((x) => x + OX);
export const cedarTop = (x) => 2 + Math.floor(hash(x, 4) * 3);
for (const x of CEDARS) for (let y = cedarTop(x); y < DECK; y++) deco(x, y, '┃', 'trunk');
export const RIBBON_LINES = [{ x0: 94, x1: 114, y: 7 }, { x0: 133, x1: 154, y: 6 }, { x0: 101, x1: 114, y: 10 }, { x0: 133, x1: 147, y: 10 }].map((L) => ({ ...L, x0: L.x0 + OX, x1: L.x1 + OX }));
for (const L of RIBBON_LINES) for (let x = L.x0 + 1; x < L.x1; x++) if (!CEDARS.includes(x)) deco(x, L.y, '─', 'string');
export const STALL = { x0: 117 + OX, x1: 129 + OX, keeper: 124 + OX };
for (let x = STALL.x0 - 1; x <= STALL.x1 + 1; x++) { deco(x, 10, x === STALL.x0 - 1 || x === STALL.x1 + 1 ? '▄' : '▓', 'straw'); deco(x, 11, '▀', 'straw'); }
for (let y = 12; y < DECK; y++) { deco(STALL.x0, y, '│', 'post'); deco(STALL.x1, y, '│', 'post'); }
for (let x = STALL.x0 + 1; x < STALL.x1; x++) { deco(x, 14, '▄', 'counter'); deco(x, 15, '█', 'counterF'); }
deco(STALL.x0 + 1, 16, '│', 'counterF'); deco(STALL.x1 - 1, 16, '│', 'counterF');
export const STELE = { x: faceX(DECK) + 1, y: 8 };
for (let y = STELE.y; y < DECK; y++) for (let x = STELE.x; x <= STELE.x + 4; x++) deco(x, y, y === STELE.y ? '▄' : ' ', 'stele');

// ---- what hangs and sways: vines off the rock's rims, ferns under the arch ----
export const VINES = [];
for (let x = archX(ARCH.cy) + 1; x < W; x++) if (hash(x, 21) < 0.32) VINES.push({ x, y: archTop(x), len: 2 + Math.floor(hash(x, 22) * 7) });
for (let r = 30; r < 96; r += 3) if (hash(r, 23) < 0.45 && Math.abs(faceX(r) - 1 - FERRATA.x) > 2) VINES.push({ x: faceX(r) - 1, y: r, len: 2 + Math.floor(hash(r, 24) * 5) });
for (let x = faceX(DECK) - 2; x < faceX(DECK) + 3; x++) VINES.push({ x: x - 2, y: DECK + 1 + (x % 2), len: 3 + (x % 3) * 2 });

export { AIR, PLATFORM, SOLID };

// ---- the level (src/gorge.txt): what you collide with, and where things are ----
// Spawns spread over the gorge, two rifles and a sniper (the referee picks where they appear), the door at
// the east edge level with the courtyard's floor (the side view keeps that floor near the screen's bottom;
// walking in, you step down into the pool), and each ladder's column as H.
export const SPAWNS = [
  [14, FLOOR - 1], [HALL.cx - 10, TERRACE.r - 1], [STAIRS_X - 4, FLOOR - 1], [LOOKOUT.x0 + 2, LOOKOUT.r - 1],
  [CAVE1.x0 + 8, CAVE1.r - 1], [BALCONY.x1 - 3, BALCONY.r - 1], [CAVE2_EXIT.x - 6, CAVE2_EXIT.r - 1],
  [STALL.x1 + 8, DECK - 1], [CEDARS[1] + 3, DECK - 1], [POOL_X - 8, FLOOR - 1],
];
export const PICKUPS = [['R', HALL.cx + 10, TERRACE.r - 1], ['R', CAVE1.x0 + 24, CAVE1.r - 1], ['N', CEDARS[5] + 3, DECK - 1]];
export const DOOR = [W - 1, FLOOR - 1];
export function gorgeLevelText() {
  const g = [];
  for (let r = 0; r < H; r++) g.push([...Array(W)].map((_, c) => (KIND[r * W + c] === SOLID ? '▓' : KIND[r * W + c] === PLATFORM ? '═' : ' ')));
  const mark = (c, r, ch) => {
    if (KIND[r * W + c] !== AIR) throw new Error(`gorge level: ${ch} at ${c},${r} isn't air`);
    g[r][c] = ch;
  };
  // a body stands with its feet on the row under the marker (as in arena.txt)
  const spot = (c, r, ch, ground = true) => {
    for (const d of [0, 1, 2]) if (kindAt(c, r - d) !== AIR) throw new Error(`gorge level: no room to stand at ${c},${r}`);
    if (ground && kindAt(c, r + 1) === AIR) throw new Error(`gorge level: nothing to stand on at ${c},${r}`);
    mark(c, r, ch);
  };
  for (const [c, r] of SPAWNS) spot(c, r, 'S');
  for (const [ch, c, r] of PICKUPS) spot(c, r, ch);
  spot(DOOR[0], DOOR[1], 'D', false); // over the pool
  for (const L of LADDERS) for (let r = L.top + 1; r < L.bot; r++) mark(Math.floor(L.x), r, 'H');
  return g.map((row) => row.join('').replace(/ +$/, '')).join('\n') + '\n';
}
