// The arena: a side-scrolling room. Pure: the level, platform physics, the side-view camera and the
// backdrop crop. world.js hands the player to stepBody while you're inside.

import { CELL_ASPECT, isWalkable } from './layout.js';

export const AIR = 0, PLATFORM = 1, SOLID = 2;
export const LEVEL_COLS = 240, LEVEL_ROWS = 50;

// src/arena.txt → one kind per interior cell, top row first. Anything unexpected is air, so a typo can't
// wall you in.
export function parseLevel(text, cols = LEVEL_COLS, rows = LEVEL_ROWS) {
  const cells = new Uint8Array(cols * rows);
  const lines = String(text).split('\n');
  for (let r = 0; r < rows; r++) {
    const chars = [...(lines[r] || '')];
    for (let c = 0; c < cols; c++) cells[r * cols + c] = chars[c] === '═' ? PLATFORM : chars[c] === '▓' ? SOLID : AIR;
  }
  return { cols, rows, cells };
}

export const RUN = 30; // cells/s, the gallery's walking speed
export const SPRINT = 1.5;
export const JUMP_V = 40; // rows/s at take-off: with GRAVITY that is ~6 rows up, ~0.6 s in the air
export const GRAVITY = 133;
export const MAX_FALL = 60;
const ACCEL = 0.07; // seconds to reach about 63% of the target speed (as walking)
const AIR_CONTROL = 0.6;
const COYOTE = 0.1, BUFFER = 0.1, DROP = 0.25;
const HW = 0.3, HH = 0.5; // half width (cells), half height (rows)
const EPS = 1e-6;

export function newBody(x, y) {
  return { x, y, vx: 0, vy: 0, onGround: false, onPlatform: false, sinceGround: Infinity, sinceJump: Infinity, prevJump: false, cut: false, dropUntil: 0, t: 0 };
}

export function stepBody(b, dt, input, kindAt, { reducedMotion = false } = {}) {
  b.t += dt;
  const jump = !!input.jump;
  if (jump && !b.prevJump) b.sinceJump = 0; else b.sinceJump += dt;
  // Letting go while rising cuts the jump short.
  if (!jump && b.prevJump && b.vy < 0 && !b.cut) { b.vy *= 0.5; b.cut = true; }
  b.prevJump = jump;
  b.sinceGround = b.onGround ? 0 : b.sinceGround + dt;
  if (input.down && b.onGround && b.onPlatform) { b.dropUntil = b.t + DROP; b.onGround = false; }
  // A jump pressed a moment before landing, or a moment after running off a ledge, still counts.
  if (b.sinceJump <= BUFFER && b.sinceGround <= COYOTE) {
    b.vy = -JUMP_V;
    b.cut = false;
    if (!jump) { b.vy *= 0.5; b.cut = true; } // a buffered tap that was already let go: a short hop
    b.sinceJump = b.sinceGround = Infinity;
    b.onGround = false;
  }

  const target = (input.x || 0) * RUN * (input.run ? SPRINT : 1);
  const k = reducedMotion ? 1 : 1 - Math.exp((-dt * (b.onGround ? 1 : AIR_CONTROL)) / ACCEL);
  b.vx += (target - b.vx) * k;
  if (!target && Math.abs(b.vx) < 0.05) b.vx = 0;
  const vy0 = b.vy;
  b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * dt);
  const mx = b.vx * dt, my = ((vy0 + b.vy) / 2) * dt; // exact for constant gravity

  const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 0.4));
  const dropping = b.t < b.dropUntil;
  b.onGround = b.onPlatform = false;
  let hitY = false;
  for (let i = 0; i < n; i++) {
    moveX(b, mx / n, kindAt);
    if (!hitY) hitY = moveY(b, my / n, kindAt, dropping);
  }
}

function moveX(b, dx, kindAt) {
  if (!dx) return;
  const nx = b.x + dx;
  const col = dx > 0 ? Math.floor(nx + HW - EPS) : Math.floor(nx - HW);
  const r0 = Math.floor(b.y - HH + EPS), r1 = Math.floor(b.y + HH - EPS);
  for (let r = r0; r <= r1; r++) {
    if (kindAt(col, r) === SOLID) { b.x = dx > 0 ? col - HW : col + 1 + HW; b.vx = 0; return; }
  }
  b.x = nx;
}

// Returns true when the move was stopped (landed or bumped a ceiling).
function moveY(b, dy, kindAt, dropping) {
  if (!dy) return false;
  const ny = b.y + dy;
  const c0 = Math.floor(b.x - HW + EPS), c1 = Math.floor(b.x + HW - EPS);
  if (dy > 0) {
    const row = Math.floor(ny + HH - EPS);
    if (row > Math.floor(b.y + HH - EPS)) { // the feet cross into a new row: land on ▓ always, on ═ unless dropping
      let solid = false, platform = false;
      for (let c = c0; c <= c1; c++) { const k = kindAt(c, row); solid ||= k === SOLID; platform ||= k === PLATFORM; }
      if (solid || (platform && !dropping)) {
        b.y = row - HH; b.vy = 0; b.onGround = true; b.onPlatform = !solid;
        return true;
      }
    }
  } else {
    const row = Math.floor(ny - HH);
    if (row < Math.floor(b.y - HH)) {
      for (let c = c0; c <= c1; c++) {
        if (kindAt(c, row) === SOLID) { b.y = row + 1 + HH; b.vy = 0; return true; }
      }
    }
  }
  b.y = ny;
  return false;
}

// Where the side-view camera centres. a = the room with its walls, view = {cols, rows} on screen.
export function sideCamera(a, view, p, lead = 0) {
  const fit = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  const x = fit(p.x + lead, a.x + view.cols / 2, a.x + a.w - view.cols / 2);
  if (view.rows >= a.h) return { x, y: a.y + a.h / 2 };
  // Near the floor, keep it on screen; higher up, keep you a little above the middle.
  const floorAtBottom = a.y + a.h - view.rows / 2;
  return { x, y: fit(Math.min(floorAtBottom, p.y + view.rows * 0.15), a.y + view.rows / 2, floorAtBottom) };
}

// The middle part of a w×h image with the shape of cols×rows cells.
export function coverCrop(w, h, cols, rows) {
  const want = cols / (rows * CELL_ASPECT);
  if (w / h > want) { const sw = h * want; return { sx: (w - sw) / 2, sy: 0, sw, sh: h }; }
  const sh = w / want;
  return { sx: 0, sy: (h - sh) / 2, sw: w, sh };
}

// What fills a map cell in the side view: the level inside the arena, the building's walls outside it.
export function kindsFor(map) {
  const a = map.arena;
  return (cx, cy) => {
    const ix = cx - a.x - 1, iy = cy - a.y - 1;
    if (ix >= 0 && iy >= 0 && ix < a.cols && iy < a.rows) return a.level.cells[iy * a.cols + ix];
    return isWalkable(map, cx, cy) ? AIR : SOLID;
  };
}
