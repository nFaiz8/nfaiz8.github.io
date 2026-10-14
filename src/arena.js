// The arena: a side-scrolling room. Pure: the level, platform physics, the side-view camera and the
// backdrop crop. world.js hands the player to stepBody while you're inside.

import { CELL_ASPECT, isWalkable } from './layout.js';

import { AIR, PLATFORM, SOLID } from './level.js';
export { AIR, PLATFORM, SOLID, LEVEL_COLS, LEVEL_ROWS, parseLevel } from './level.js';

export const RUN = 30; // cells/s, the gallery's walking speed
export const SPRINT = 1.5;
export const JUMP_V = 40; // rows/s at take-off: with GRAVITY that is ~6 rows up, ~0.6 s in the air
export const GRAVITY = 133;
export const MAX_FALL = 60;
export const AIR_JUMPS = 1; // jumps in the air per airtime, refilled on touching the ground
export const DOUBLE_V = 34; // rows/s: the air jump's take-off, ~4.3 rows more height
const ACCEL = 0.07; // seconds to reach about 63% of the target speed (as walking)
const AIR_CONTROL = 0.6;
export const COYOTE = 0.1; // seconds after leaving the ground that a jump is still the ground jump
const BUFFER = 0.1, DROP = 0.25;
export const BODY = { w: 0.8, h: 3 }; // cells across, rows down
const HW = 0.4, HH = 1.5; // half width (cells), half height (rows); the feet are at y + 1.5
export const ROLL = { speed: 48, time: 0.3, cooldown: 0.5 }; // cells/s, seconds
export const STUN_DECAY = 0.35; // seconds: a knocked-back body's speed falls by 1/e in this long
const NONE = {};
const EPS = 1e-6;

export function newBody(x, y) {
  return { x, y, vx: 0, vy: 0, onGround: false, onPlatform: false, sinceGround: Infinity, sinceJump: Infinity, prevJump: false, cut: false, dropUntil: 0, t: 0, stun: 0, rollT: -1, rollDir: 0, rollCool: 0, airJumps: AIR_JUMPS, airJumpT: -Infinity };
}

export const rolling = (b) => b.rollT >= 0;

// A hit: set the horizontal velocity and stun for a while. A strike (default) replaces vy when ky is
// non-zero, and a let-go of jump must not halve it. A bullet (add) adds to vy, so it never cancels a jump
// and leaves the jump-cut alone. Either way an upward result takes a grounded body off the ground.
export function knock(b, kx, ky, stun, add = false) {
  b.vx = kx;
  if (add) {
    if (ky) { b.vy += ky; if (b.onGround && b.vy < 0) b.onGround = b.onPlatform = false; }
  } else {
    if (ky) { b.vy = ky; if (ky < 0) b.onGround = b.onPlatform = false; }
    b.cut = true;
  }
  b.stun = Math.max(b.stun, stun);
  b.rollT = -1;
}

// Start a roll: on the ground, not stunned, not already rolling, and cooled down.
export function startRoll(b, dir) {
  if (!dir || !b.onGround || b.stun > 0 || b.rollT >= 0 || b.rollCool > 0) return false;
  b.rollT = 0;
  b.rollDir = Math.sign(dir);
  b.vx = b.rollDir * ROLL.speed;
  return true;
}

// The arena's interior in map cells (the door and corridor are outside it).
export function insideFor(map) {
  const a = map.arena;
  return (cx, cy) => cx > a.x && cx < a.x + a.w - 1 && cy > a.y && cy < a.y + a.h - 1;
}

const endRoll = (b) => { b.rollT = -1; b.rollCool = ROLL.cooldown; };

export function stepBody(b, dt, input, kindAt, { reducedMotion = false, inside = null } = {}) {
  b.t += dt;
  const stunned = b.stun > 0;
  const heldJump = !!input.jump;
  if (stunned) { b.stun = Math.max(0, b.stun - dt); input = NONE; } // knocked back: no control until it ends
  b.rollCool = Math.max(0, b.rollCool - dt);
  if (input.roll) startRoll(b, Math.sign(input.roll));
  const rolled = b.rollT >= 0; // rolling this step, even if a jump ends the roll below
  const left = Math.max(0, ROLL.time - b.rollT); // roll time left, so the last step doesn't overshoot
  if (stunned) {
    // Jump is ignored, but a held key isn't a new press when the stun ends.
    b.sinceJump += dt;
    b.prevJump = heldJump;
    b.sinceGround = b.onGround ? 0 : b.sinceGround + dt;
  } else {
    const jump = !!input.jump, press = jump && !b.prevJump;
    if (press) b.sinceJump = 0; else b.sinceJump += dt;
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
      if (b.rollT >= 0) endRoll(b); // a jump out of a roll keeps its speed
    } else if (press && !b.onGround && b.rollT < 0 && b.airJumps > 0) {
      // The air jump: no ground jump to be had, so a fresh press takes it. It replaces vy (it can stop a
      // fall), can be cut short again, and a held direction turns the speed that way at once.
      b.airJumps--;
      b.airJumpT = b.t;
      b.vy = -DOUBLE_V;
      b.cut = false;
      b.sinceJump = Infinity; // the press is spent: no jump from it on landing
      const dir = Math.sign(input.x || 0);
      if (dir) b.vx = dir * Math.max(Math.abs(b.vx), RUN * (input.run ? SPRINT : 1));
    }
  }

  // While stunned the door is a wall: the cells outside the arena are solid.
  const kinds = stunned && inside ? (c, r) => (inside(c, r) ? kindAt(c, r) : SOLID) : kindAt;
  let mx;
  if (rolled) {
    b.vx = b.rollDir * ROLL.speed; // a roll ignores steering, also on the step a jump ends it
    mx = b.vx * Math.min(dt, left);
    if (b.rollT >= 0) b.rollT += dt;
  } else {
    if (stunned) b.vx *= Math.exp(-dt / STUN_DECAY);
    else steer(b, dt, input, reducedMotion);
    mx = b.vx * dt;
  }
  const vy0 = b.vy;
  b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * dt);
  const my = ((vy0 + b.vy) / 2) * dt; // exact for constant gravity
  move(b, mx, my, kinds);
  if (b.onGround) b.airJumps = AIR_JUMPS; // the floor, a platform or a ▓ top
  // The roll ends after its time, or when it runs off a ledge (keeping its speed).
  if (b.rollT >= 0 && (b.rollT >= ROLL.time - 1e-9 || !b.onGround)) endRoll(b);
}

function steer(b, dt, input, reducedMotion) {
  const target = (input.x || 0) * RUN * (input.run ? SPRINT : 1);
  const k = reducedMotion ? 1 : 1 - Math.exp((-dt * (b.onGround ? 1 : AIR_CONTROL)) / ACCEL);
  b.vx += (target - b.vx) * k;
  if (!target && Math.abs(b.vx) < 0.05) b.vx = 0;
}

function move(b, mx, my, kindAt) {
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

// In the arena, its corridor, or the lobby's west end by its sign: close enough to start loading the
// backdrop's large image. Spawn and the rest of the gallery are not, so most visitors never fetch it.
export const NEAR = 25;
export function nearArena(map, p) {
  const a = map.arena;
  return !!a && p.x < a.x + a.w + NEAR && p.y >= a.y && p.y <= a.floorY + 6;
}

// A ▓ block is drawn as its outline, its inside left clear so the photo behind it shows.
export function blockGlyph(L, c, r) {
  const solid = (x, y) => x >= 0 && y >= 0 && x < L.cols && y < L.rows && L.cells[y * L.cols + x] === SOLID;
  if (!solid(c, r)) return null;
  const up = !solid(c, r - 1), down = !solid(c, r + 1), left = !solid(c - 1, r), right = !solid(c + 1, r);
  if (up && left) return '┌';
  if (up && right) return '┐';
  if (down && left) return '└';
  if (down && right) return '┘';
  if (up || down) return '─';
  if (left || right) return '│';
  return null;
}
