// The arena: a side-scrolling room. Pure: the level, platform physics, the side-view camera and its
// zoom by gun. world.js hands the player to stepBody while you're inside.

import { isWalkable } from './layout.js';

import { AIR, PLATFORM, SOLID } from './level.js';
import { ROLL } from './fight.js';
export { ROLL }; // the referee needs it too, and imports only fight.js and level.js
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
export const STUN_DECAY = 0.35; // seconds: a knocked-back body's speed falls by 1/e in this long
export const PUSH = 12; // cells/s: how fast two overlapping fighters are pushed apart, each
const NONE = {};
const EPS = 1e-6;

// Where fighters don't collide: the door's 3 rows in the interior's last 2 columns (body collision
// addendum), from the level's D marker, in kindAt's cells (off: where the level's cell 0,0 is).
export function doorZone(level, off = { x: 0, y: 0 }) {
  const d = level.door;
  return { x0: off.x + level.cols - 2, x1: off.x + level.cols, y0: off.y + d.r - 2, y1: off.y + d.r + 1 };
}

export function newBody(x, y) {
  return { x, y, vx: 0, vy: 0, onGround: false, onPlatform: false, sinceGround: Infinity, sinceJump: Infinity, prevJump: false, cut: false, dropUntil: 0, t: 0, stun: 0, rollT: -1, rollDir: 0, rollCool: 0, airJumps: AIR_JUMPS, airJumpT: -Infinity,
    onBody: false, rideId: null, rideX: 0, headDropUntil: 0 }; // on someone's head: whose (by box id), and where they were
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

// Other fighters (body collision addendum): others are their boxes, { x, y, vx, vy, solid, tie }, with
// solid false for anyone who passes through (rolling, protected, dead) and tie the way to go if our
// centres coincide; solid false here means this body passes through everyone; door is doorZone's.
export function stepBody(b, dt, input, kindAt, { reducedMotion = false, inside = null, others = null, solid = true, door = null } = {}) {
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
    // ↓ on a ═ drops through it; ↓ on a head drops off that head only, onto any ═ just under it.
    if (input.down && b.onGround && b.onPlatform) { if (b.onBody) b.headDropUntil = b.t + DROP; else b.dropUntil = b.t + DROP; b.onGround = false; }
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
  // A roll passes through everyone. Otherwise: pushed out of anyone already overlapping, and carried by
  // the one underfoot.
  const block = solid && !rolled && others && others.length ? sortOthers(b, others, door) : null;
  if (block) mx += push(b, dt) + rideDx(b, block);
  move(b, mx, my, kinds, block);
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

// Fighters' boxes: those already overlapping this one (OVER) are pushed apart and don't block until they
// have separated; the rest (BLOCK) are solid. Within LIP rows of a head counts as standing on it, and
// within TOUCH cells of contact as touching: two rounded wire positions never push each other.
const LIP = 0.25, TOUCH = 0.05;
const BLOCK = [], OVER = [];
const inZone = (z, x, y) => !!z && x + HW > z.x0 && x - HW < z.x1 && y + HH > z.y0 && y - HH < z.y1;
function sortOthers(b, others, door) {
  BLOCK.length = OVER.length = 0;
  if (inZone(door, b.x, b.y)) return BLOCK;
  for (const o of others) {
    if (!o || !o.solid || inZone(door, o.x, o.y)) continue;
    if (Math.abs(b.x - o.x) < BODY.w - TOUCH && Math.abs(b.y - o.y) < BODY.h - LIP) OVER.push(o);
    else BLOCK.push(o);
  }
  return BLOCK;
}

// Out of an overlap at up to PUSH cells/s, away from the other's centre (walls win: it moves like walking).
// Only between two bodies at rest on their feet: one jumping or dropping through another just passes.
function push(b, dt) {
  if (!b.onGround) return 0;
  let px = 0;
  for (const o of OVER) {
    if (o.vy) continue;
    const dir = Math.sign(b.x - o.x) || o.tie || -1;
    px += dir * Math.min(PUSH * dt, BODY.w - Math.abs(b.x - o.x));
  }
  return Math.max(-PUSH * dt, Math.min(PUSH * dt, px));
}

// How far the one this body stands on has moved since it last stood there: it keeps its spot on the head,
// whatever the frame rate, and even against a box from the last frame (it lands against the same box).
function rideDx(b, block) {
  if (!b.onGround || b.rideId == null) return 0;
  for (const o of block) {
    if (o.id === b.rideId && Math.abs(b.y - (o.y - BODY.h)) <= LIP) return o.x - b.rideX;
  }
  return 0;
}

// A body drawn at b + corr (a remote fighter's correction gliding out) is kept from being drawn past contact
// with anyone solid it is beside, or sunk into a head it stands on, whatever is left of the correction.
export function keepDrawnOut(b, corr, others, door = null) {
  if (inZone(door, b.x, b.y)) return;
  for (const o of others) {
    if (!o || !o.solid || inZone(door, o.x, o.y)) continue;
    const dx = b.x - o.x, dy = b.y - o.y;
    if (Math.abs(dy) < BODY.h - LIP) {
      if (Math.abs(dx) < BODY.w - TOUCH) continue; // overlapping already: being pushed apart
      if (dx < 0) corr.x = Math.min(corr.x, o.x - BODY.w - b.x);
      else corr.x = Math.max(corr.x, o.x + BODY.w - b.x);
    } else if (dy < 0 && Math.abs(dx) < BODY.w - TOUCH) corr.y = Math.min(corr.y, o.y - BODY.h - b.y);
  }
}

function move(b, mx, my, kindAt, block) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 0.4));
  const dropping = b.t < b.dropUntil, offHead = dropping || b.t < b.headDropUntil;
  b.onGround = b.onPlatform = b.onBody = false;
  b.rideId = null;
  let hitY = false;
  for (let i = 0; i < n; i++) {
    moveX(b, mx / n, kindAt, block);
    if (!hitY) hitY = moveY(b, my / n, kindAt, dropping, offHead ? null : block);
  }
}

function moveX(b, dx, kindAt, block) {
  if (!dx) return;
  let nx = b.x + dx, hit = false;
  const col = dx > 0 ? Math.floor(nx + HW - EPS) : Math.floor(nx - HW);
  const r0 = Math.floor(b.y - HH + EPS), r1 = Math.floor(b.y + HH - EPS);
  for (let r = r0; r <= r1; r++) {
    if (kindAt(col, r) === SOLID) { nx = dx > 0 ? col - HW : col + 1 + HW; hit = true; break; }
  }
  // A fighter level with this one stops it at contact, from whichever side it comes.
  if (block) for (const o of block) {
    if (Math.abs(b.y - o.y) >= BODY.h - LIP) continue;
    if (dx > 0 && b.x <= o.x - BODY.w + TOUCH && nx > o.x - BODY.w) { nx = o.x - BODY.w; hit = true; }
    else if (dx < 0 && b.x >= o.x + BODY.w - TOUCH && nx < o.x + BODY.w) { nx = o.x + BODY.w; hit = true; }
  }
  b.x = nx;
  if (hit) b.vx = 0;
}

// Returns true when the move was stopped (landed or bumped a ceiling). heads: the ones it can land on.
function moveY(b, dy, kindAt, dropping, heads) {
  if (!dy) return false;
  const ny = b.y + dy;
  const c0 = Math.floor(b.x - HW + EPS), c1 = Math.floor(b.x + HW - EPS);
  if (dy > 0) {
    const row = Math.floor(ny + HH - EPS);
    let land = Infinity, on = null;
    if (row > Math.floor(b.y + HH - EPS)) { // the feet cross into a new row: land on ▓ always, on ═ unless dropping
      let solid = false, platform = false;
      for (let c = c0; c <= c1; c++) { const k = kindAt(c, row); solid ||= k === SOLID; platform ||= k === PLATFORM; }
      if (solid || (platform && !dropping)) { land = row - HH; b.onPlatform = !solid; }
    }
    // A head is one-way, like ═: landed on from above (↓ drops through), passed through from below.
    if (heads) for (const o of heads) {
      const top = o.y - BODY.h; // where this body's centre is, standing on it
      if (Math.abs(b.x - o.x) < BODY.w - TOUCH && b.y <= top + LIP && ny > top && top <= land) { land = top; on = o; }
    }
    if (land < Infinity) {
      b.y = land; b.vy = 0; b.onGround = true;
      if (on) { b.onPlatform = b.onBody = true; b.rideId = on.id ?? null; b.rideX = on.x; }
      return true;
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

// Where the side-view camera centres. a = the room with its walls, view = {cols, rows} on screen. lead is
// the look-ahead for a 150-cell view; a narrower (zoomed-in) view leads less. inset (touch, in cells): side
// keeps the body that far from the screen's sides (past the room's edges if it must); bottom keeps the feet
// that far above the screen's bottom, but only while the figure is over a pad cluster (left: the bottom-left
// one's width, right: the bottom-right one's; without them, anywhere). A view as tall as the room (the
// sniper's) shows all of it, its spare rows above: the inset never pushes its first or last row off screen.
export const LEAD_COLS = 150;
export const FLOOR_BELOW = 5;
export function sideCamera(a, view, p, lead = 0, inset = null) {
  const fit = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  let x = fit(p.x + (lead * view.cols) / LEAD_COLS, a.x + view.cols / 2, a.x + a.w - view.cols / 2);
  // The rows that must show for "the whole room": the level's (inside the walls) when it has them.
  const y0 = a.rows != null ? a.y + 1 : a.y, h = a.rows != null ? a.rows : a.h;
  const whole = view.rows >= h;
  let y;
  // The whole room: its last row at the bottom, the spare rows above it (under the top HUD).
  if (whole) y = y0 + h - view.rows / 2;
  else {
    // Near the floor, keep it on screen; higher up, keep you a little above the middle. A room with a floor
    // line (the train) shows FLOOR_BELOW rows under it (the slab and the bogies), not all its undercarriage.
    let floorAtBottom = a.y + a.h - view.rows / 2;
    if (a.floorY != null) floorAtBottom = Math.min(floorAtBottom, a.floorY + FLOOR_BELOW - view.rows / 2);
    y = fit(Math.min(floorAtBottom, p.y + view.rows * 0.15), a.y + view.rows / 2, floorAtBottom);
  }
  if (inset) {
    const side = Math.min(inset.side || 0, view.cols / 2), bottom = Math.min(inset.bottom || 0, view.rows / 2);
    x = Math.max(p.x + side - view.cols / 2, Math.min(p.x - side + view.cols / 2, x));
    const sx = p.x - (x - view.cols / 2); // the figure's column on screen
    const overPad = inset.left == null && inset.right == null ? true : sx < (inset.left || 0) || sx > view.cols - (inset.right || 0);
    if (overPad) y = Math.max(y, p.y + 1.5 + bottom - view.rows / 2); // the feet are 1.5 rows under the centre
    if (whole) y = Math.min(y, y0 + view.rows / 2); // row 0 stays on screen
  }
  return { x, y };
}

// How many rows the side view shows, by the gun in your hand (train level addendum §2): pick up the sniper
// and it pulls back to the whole room; back to the deagle, it pushes in.
export const SIDE_ROWS = { deagle: 20, rifle: 25, sniper: 33, none: 24 };
export const ZOOM_TIME = 0.35; // s

// The zoom, eased: z is the last result (null at first), gun the gun in hand, null when not fighting and
// undefined while dead (keep the last value); t in seconds. Returns { from, to, at, rows, settled }.
export function sideZoom(z, gun, t, { reducedMotion = false } = {}) {
  const to = gun === undefined && z ? z.to : SIDE_ROWS[gun || 'none'] || SIDE_ROWS.none;
  if (!z || reducedMotion) return { from: to, to, at: t, rows: to, settled: true };
  let { from, at } = z;
  if (to !== z.to) { from = z.rows; at = t; }
  const k = Math.max(0, Math.min(1, (t - at) / ZOOM_TIME));
  const settled = k >= 1;
  return { from, to, at, rows: settled ? to : from + (to - from) * (1 - (1 - k) ** 3), settled };
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
