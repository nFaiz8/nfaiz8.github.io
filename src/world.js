// Player, camera and focus. Renderer-agnostic; all positions are in cells (floats).
import { isWalkable } from './layout.js';
import { findPath } from './path.js';
import { CELL_ASPECT } from './layout.js';
import { newBody, stepBody, sideCamera, kindsFor, insideFor, SOLID } from './arena.js';

const SPEED = 30; // walking, cells per second horizontally; vertical is divided by CELL_ASPECT
const SPRINT = 1.5; // holding Shift
const PATH_SPEED = SPEED; // tap/click-to-walk goes at walking pace
const HALF = 0.3; // player half-size in cells
const FOCUS_DIST = 7; // in horizontal-cell units
const ACCEL = 0.07; // seconds to reach about 63% of the target speed
const NUDGE = 0.55; // how far (cells) you're eased around a corner you clip
const CAM_TIME = 0.22; // camera spring smoothing time
const LOOK_AHEAD = 0.28; // seconds of travel the camera leads by

export function createWorld(map, { reducedMotion = false } = {}) {
  return {
    map,
    reducedMotion,
    t: 0,
    player: { x: map.spawn.x, y: map.spawn.y, vx: 0, vy: 0, facing: 1, moving: false },
    cam: { x: map.spawn.x, y: map.spawn.y, vx: 0, vy: 0 },
    path: null,
    pathGoal: null,
    focus: null,
    onArrive: null,
    camTarget: null, // when set (a photo being opened), the camera centres here instead of on you
    visitors: createVisitors(map),
    mode: 'top', // 'side' inside the arena
    want: null, // 'side' | 'top' when you've crossed the arena door; main.js tilts, then switches
    frozen: false, // input ignored (during the tilt)
    view: { cols: 150, rows: 50 }, // cells on screen; main.js keeps it current
    kindAt: map.arena ? kindsFor(map) : null,
    inside: map.arena ? insideFor(map) : null,
    aimFacing: 0, // -1 or 1: in the side view you face this way (the mouse's side), not the way you run
    shake: null, // { until, amp } in world seconds (pvp.js: kicked or popped)
    shakeOff: { x: 0, y: 0 }, // the offset the shake added to the camera last frame
  };
}

const solidAt = (map, x, y) => !isWalkable(map, Math.floor(x), Math.floor(y));

function blocked(map, x, y) {
  return solidAt(map, x - HALF, y - HALF) || solidAt(map, x + HALF, y - HALF) ||
    solidAt(map, x - HALF, y + HALF) || solidAt(map, x + HALF, y + HALF);
}

// Move by (dx, dy) cells, one axis at a time so the player slides along walls. When a move is
// blocked only by a corner you're barely clipping, ease sideways around it, so doorways don't snag.
export function moveBy(world, dx, dy) {
  const p = world.player, map = world.map;
  let hitX = false, hitY = false;
  if (dx) {
    if (!blocked(map, p.x + dx, p.y)) p.x += dx;
    else {
      hitX = true;
      const side = cornerSide(map, p.x + dx, p.y, 0, 1);
      if (side) p.y += side * Math.min(Math.abs(dx) / CELL_ASPECT, NUDGE);
    }
  }
  if (dy) {
    if (!blocked(map, p.x, p.y + dy)) p.y += dy;
    else {
      hitY = true;
      const side = cornerSide(map, p.x, p.y + dy, 1, 0);
      if (side) p.x += side * Math.min(Math.abs(dy) * CELL_ASPECT, NUDGE);
    }
  }
  return { hitX, hitY };
}

// If shifting (x, y) by up to NUDGE along (ax, ay) frees it, which way (-1, 1), else 0.
function cornerSide(map, x, y, ax, ay) {
  for (let s = 0.1; s <= NUDGE + 1e-6; s += 0.1) {
    if (!blocked(map, x + ax * s, y + ay * s)) return 1;
    if (!blocked(map, x - ax * s, y - ay * s)) return -1;
  }
  return 0;
}

// Can the player's box travel in a straight line between two points?
function walkable(map, x0, y0, x1, y1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, (y1 - y0) * CELL_ASPECT) / 0.25);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (blocked(map, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

// Turn a cell-by-cell path into a few straight legs (string pulling), so walking looks natural.
export function smoothPath(map, from, cells) {
  const pts = cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
  const out = [];
  let cur = from, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !walkable(map, cur.x, cur.y, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return out;
}

export function walkTo(world, cx, cy, onArrive = null, { quick = false } = {}) {
  if (world.mode === 'side') {
    if (inArena(world.map, cx + 0.5, cy + 0.5)) return false; // in the arena you run and jump instead
    exitSide(world);
  }
  const { map, player } = world;
  const path = findPath(map.W, map.H, (x, y) => isWalkable(map, x, y), Math.floor(player.x), Math.floor(player.y), cx, cy);
  world.path = path && smoothPath(map, player, path);
  world.pathGoal = path ? { x: cx, y: cy } : null;
  world.onArrive = path ? onArrive : null;
  world.pathQuick = !!path && quick; // trips picked on the map go at a jog
  if (path && path.length === 0) arrive(world);
  return !!path;
}

function arrive(world) {
  world.path = null;
  world.pathGoal = null;
  const cb = world.onArrive;
  world.onArrive = null;
  if (cb) cb();
}

// A teleport can arrive with the old one-row centre: lift out of the floor and let gravity settle.
function settleOnFloor(world) {
  const p = world.player;
  if (!world.kindAt) return;
  const solid = () => {
    for (let r = Math.floor(p.y - 1.5 + 1e-6); r <= Math.floor(p.y + 1.5 - 1e-6); r++)
      for (let c = Math.floor(p.x - 0.4 + 1e-6); c <= Math.floor(p.x + 0.4 - 1e-6); c++) if (world.kindAt(c, r) === SOLID) return true;
    return false;
  };
  for (let i = 0; i < 8 && solid(); i++) p.y -= 0.5;
}

export function teleport(world, x, y) {
  world.player.x = x;
  world.player.y = y;
  world.player.vx = world.player.vy = 0;
  world.cam.x = x;
  world.cam.y = y;
  world.cam.vx = world.cam.vy = 0;
  world.shakeOff = { x: 0, y: 0 };
  world.path = null;
  world.onArrive = null;
  // Landing somewhere else (a link, ← → in the viewer) switches view at once, without the tilt.
  if (world.map.arena) {
    const side = inArena(world.map, x, y);
    if (side && world.mode !== 'side') enterSide(world, { place: false });
    else if (side) { settleOnFloor(world); world.cam.y = world.player.y; }
    else if (!side && world.mode === 'side') exitSide(world, { place: false });
  }
}

// Critically damped spring toward a target (Unity's SmoothDamp). Mutates o.{x|y} and o.v{x|y}.
function spring(o, axis, target, time, dt) {
  const v = 'v' + axis;
  const w = 2 / time, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = o[axis] - target;
  const temp = (o[v] + w * change) * dt;
  o[v] = (o[v] - w * temp) * e;
  o[axis] = target + (change + temp) * e;
}

// input: { x: -1..1, y: -1..1, run: bool }
export function step(world, dt, input) {
  world.t += dt;
  if (world.mode === 'side') return stepSide(world, dt, input);
  const p = world.player;
  const speed = SPEED * (input.run ? SPRINT : 1);

  // Where we want to be going, in horizontal-cell units per second.
  let tx = 0, ty = 0;
  if (world.frozen) {
    p.vx = p.vy = 0;
  } else if (input.x || input.y) {
    world.path = null;
    world.onArrive = null;
    const len = Math.hypot(input.x, input.y) || 1;
    tx = (input.x / len) * speed;
    ty = (input.y / len) * speed;
  } else if (world.path && !world.frozen) {
    let wp = world.path[0];
    let dx = wp.x - p.x, dy = (wp.y - p.y) * CELL_ASPECT, d = Math.hypot(dx, dy);
    const pace = PATH_SPEED * (world.pathQuick ? 2.5 : 1);
    if (d < Math.max(0.3, pace * dt * 1.5) && world.path.length > 1) {
      world.path.shift();
      wp = world.path[0];
      dx = wp.x - p.x; dy = (wp.y - p.y) * CELL_ASPECT; d = Math.hypot(dx, dy);
    }
    const last = world.path.length === 1;
    if (last && d < 0.08) {
      p.x = wp.x; p.y = wp.y; p.vx = p.vy = 0;
      arrive(world);
    } else {
      // Ease into the final stop instead of braking at full speed.
      const s = last ? Math.min(pace, d * 7) : pace;
      tx = (dx / d) * s;
      ty = (dy / d) * s;
    }
  }

  // Accelerate toward the target velocity: quick, but never an instant start or stop.
  const k = world.reducedMotion ? 1 : 1 - Math.exp(-dt / ACCEL);
  p.vx += (tx - p.vx) * k;
  p.vy += (ty - p.vy) * k;
  if (!tx && !ty && Math.hypot(p.vx, p.vy) < 0.05) p.vx = p.vy = 0;
  // Move in steps of under half a cell, so a fast sprint on a slow frame can't jump over a wall.
  const mx = p.vx * dt, my = (p.vy / CELL_ASPECT) * dt;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 0.4));
  const hit = { hitX: false, hitY: false };
  for (let i = 0; i < n; i++) {
    const h = moveBy(world, hit.hitX ? 0 : mx / n, hit.hitY ? 0 : my / n);
    hit.hitX ||= h.hitX;
    hit.hitY ||= h.hitY;
  }
  if (hit.hitX) p.vx *= 0.5;
  if (hit.hitY) p.vy *= 0.5;
  p.moving = Math.hypot(p.vx, p.vy) > 0.5;
  if (Math.abs(p.vx) > 0.5) p.facing = Math.sign(p.vx);
  // Through the arena door: main.js plays the tilt, then calls enterSide.
  if (!world.frozen && !world.want && inArena(world.map, p.x, p.y)) { world.want = 'side'; world.path = null; world.onArrive = null; }

  stepVisitors(world, dt);
  moveCamera(world, dt);

  world.focus = nearestFrame(world);
  world.atKiosk = !world.focus && atKiosk(world);
}

// Camera: a spring that leads slightly in the direction you're walking. A shake is an offset added on
// top: last frame's comes off before the spring, so the spring never feels it.
function moveCamera(world, dt) {
  const g = cameraGoal(world), t = world.camTarget, cam = world.cam, off = world.shakeOff;
  cam.x -= off.x; cam.y -= off.y;
  off.x = off.y = 0;
  if (world.reducedMotion || (t && t.snap)) { cam.x = g.x; cam.y = g.y; cam.vx = cam.vy = 0; }
  else { const ct = t ? 0.12 : CAM_TIME; spring(cam, 'x', g.x, ct, dt); spring(cam, 'y', g.y, ct, dt); }
  shakeCamera(world);
}

// A wobble with no randomness, fading linearly to nothing at `until`. None with Reduce Motion.
function shakeCamera(world) {
  const s = world.shake;
  if (!s) return;
  if (world.reducedMotion || !(world.t < s.until)) { world.shake = null; return; }
  if (s.from == null) s.from = world.t;
  const k = s.until > s.from ? (s.until - world.t) / (s.until - s.from) : 0;
  const amp = (s.amp || 0) * Math.max(0, Math.min(1, k)), t = world.t;
  world.shakeOff = { x: amp * Math.sin(97 * t), y: amp * Math.cos(89 * t) / 2 };
  world.cam.x += world.shakeOff.x;
  world.cam.y += world.shakeOff.y;
}

// Inside the arena: arena.js moves you (gravity, platforms); everything else carries on as usual.
function stepSide(world, dt, input) {
  const p = world.player;
  if (!world.frozen) {
    stepBody(p, dt, input, world.kindAt, { reducedMotion: world.reducedMotion, inside: world.inside });
    p.moving = Math.abs(p.vx) > 0.5 || !p.onGround;
    if (world.aimFacing) p.facing = world.aimFacing < 0 ? -1 : 1;
    else if (Math.abs(p.vx) > 0.5) p.facing = Math.sign(p.vx);
    if (!world.want && !inArena(world.map, p.x, p.y)) world.want = 'top';
  }
  stepVisitors(world, dt);
  moveCamera(world, dt);
  world.focus = world.map.arena.backdrop;
  world.atKiosk = false;
}

// In front of the lobby kiosk (the one that opens every photo as a grid).
function atKiosk({ map, player }) {
  const k = map.kiosk;
  if (!k) return false;
  const along = Math.max(0, Math.abs(player.x - (k.x + k.w / 2)) - k.w / 2);
  const dy = (player.y - (k.stand.y + 0.5)) * CELL_ASPECT;
  return Math.hypot(along, dy) < FOCUS_DIST;
}

export function roomAt(map, x, y) {
  const i = Math.floor(y) * map.W + Math.floor(x);
  return i >= 0 && i < map.roomOf.length ? map.roomOf[i] : -1;
}

export const inArena = (map, x, y) => !!map.arena && roomAt(map, x, y) === map.arena.index;

function cameraGoal(world) {
  const p = world.player;
  if (world.camTarget) return world.camTarget;
  if (world.mode === 'side') return sideCamera(world.map.arena, world.view, p, p.vx * LOOK_AHEAD);
  return { x: p.x + p.vx * LOOK_AHEAD, y: p.y + (p.vy / CELL_ASPECT) * LOOK_AHEAD };
}

function snapCamera(world) {
  const g = cameraGoal(world);
  world.cam.x = g.x; world.cam.y = g.y; world.cam.vx = world.cam.vy = 0;
  world.shakeOff = { x: 0, y: 0 };
}

// Into the side view: on the floor just inside the door, facing west (or where you already are).
export function enterSide(world, { place = true } = {}) {
  const { player: p, map } = world, a = map.arena;
  if (place) { p.x = a.entry.x + 0.5; p.y = a.floorY - 1.5; p.facing = -1; }
  // prevJump: a key still held from walking in through the door (W, ↑, Space) must not fire a jump on
  // arrival. A teleport (a link, the viewer) has no such key, so the first press there jumps.
  if (!place) settleOnFloor(world);
  Object.assign(p, newBody(p.x, p.y), { prevJump: place });
  world.mode = 'side';
  world.want = null;
  world.path = null;
  world.onArrive = null;
  snapCamera(world);
}

// Back to top-down: in the corridor just outside the door, facing east (or where you already are).
export function exitSide(world, { place = true } = {}) {
  const { player: p, map } = world, a = map.arena;
  if (place) { p.x = a.door.x + 2.5; p.y = a.door.y + 1.5; p.facing = 1; }
  p.vx = p.vy = 0;
  world.mode = 'top';
  world.want = null;
  snapCamera(world);
}

function nearestFrame(world) {
  const { map, player } = world;
  const room = roomAt(map, player.x, player.y);
  if (room < 0) return null;
  let best = null, bestD = FOCUS_DIST;
  for (const f of map.rooms[room].frames || []) {
    const dx = player.x - (f.stand.x + 0.5);
    const dy = (player.y - (f.stand.y + 0.5)) * CELL_ASPECT;
    // Prefer frames you're standing in front of, not just near.
    const along = Math.max(0, Math.abs(dx) - f.w / 2);
    const d = Math.hypot(along, dy);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

export function frameAtCell(map, cx, cy) {
  return map.frames.find((f) => cx >= f.x && cx < f.x + f.w && cy >= f.y && cy < f.y + f.h) || null;
}

// ---------- visitors ----------
// A few people wander the rooms: walk to a print, look at it for a few seconds, move on.

const VISITOR_SPEED = 4;
const VISITOR_GLYPHS = ['☺', '☻', '&'];
const VISITOR_COLORS = [[168, 156, 132], [128, 146, 166], [166, 132, 142], [136, 158, 128], [150, 140, 172], [176, 152, 118]];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function createVisitors(map, n = 6) {
  const r = rng(97);
  const rooms = map.rooms.filter((room) => room.frames && room.frames.length && !room.arena);
  if (!rooms.length) return [];
  return Array.from({ length: n }, (_, i) => {
    const room = rooms[i % rooms.length];
    const f = room.frames[Math.floor(r() * room.frames.length)];
    let x = f.stand.x + 0.5 + Math.round((r() - 0.5) * 4);
    if (blocked(map, x, f.stand.y + 0.5)) x = f.stand.x + 0.5;
    return {
      x, y: f.stand.y + 0.5, glyph: VISITOR_GLYPHS[i % 3], color: VISITOR_COLORS[i % 6],
      room: map.rooms.indexOf(room), path: null, wait: 1 + r() * 4, looking: true, stuck: 0, r,
    };
  });
}

const near = (a, b, d) => Math.hypot(a.x - b.x, (a.y - b.y) * CELL_ASPECT) < d;

function planVisitor(world, v) {
  const { map } = world;
  const rooms = map.rooms.filter((room) => room.frames && room.frames.length && !room.arena);
  let room = map.rooms[v.room];
  if (v.r() < 0.3 && rooms.length > 1) {
    room = rooms[(rooms.indexOf(room) + 1) % rooms.length];
    v.room = map.rooms.indexOf(room);
  }
  const f = room.frames[Math.floor(v.r() * room.frames.length)];
  const gx = Math.max(0, Math.min(map.W - 1, f.stand.x + Math.round((v.r() - 0.5) * Math.min(6, f.w - 2))));
  const gy = f.stand.y;
  const others = [world.player, ...world.visitors.filter((o) => o !== v)];
  const occupied = (x, y) => others.some((o) => Math.floor(o.x) === x && Math.floor(o.y) === y);
  const cells = findPath(map.W, map.H, (x, y) => isWalkable(map, x, y) && !occupied(x, y) && !inArena(map, x + 0.5, y + 0.5), Math.floor(v.x), Math.floor(v.y), gx, gy, 60000);
  if (!cells) { v.wait = 1; return; }
  v.path = smoothPath(map, v, cells);
  v.looking = false;
}

function stepVisitors(world, dt) {
  const { map, player } = world;
  for (const v of world.visitors) {
    // Step aside when you walk into someone.
    const bump = [player, ...(world.others || [])].find((o) => near(v, o, 0.9));
    if (bump) {
      const dx = v.x - bump.x, dy = (v.y - bump.y) * CELL_ASPECT, d = Math.hypot(dx, dy) || 1;
      const mx = (dx / d) * 3 * dt, my = (dy / d) * 3 * dt / CELL_ASPECT;
      if (!blocked(map, v.x + mx, v.y)) v.x += mx;
      if (!blocked(map, v.x, v.y + my)) v.y += my;
    }
    if (v.wait > 0) { v.wait -= dt; continue; }
    if (!v.path || !v.path.length) {
      if (v.path) { v.path = null; v.looking = true; v.wait = 3 + v.r() * 3; continue; }
      planVisitor(world, v);
      continue;
    }
    const wp = v.path[0];
    const dx = wp.x - v.x, dy = (wp.y - v.y) * CELL_ASPECT, d = Math.hypot(dx, dy);
    const s = VISITOR_SPEED * dt;
    if (d <= s) { v.x = wp.x; v.y = wp.y; v.path.shift(); continue; }
    const nx = v.x + (dx / d) * s, ny = v.y + (dy / d) * s / CELL_ASPECT;
    const ahead = { x: nx + (dx / d) * 0.4, y: ny + (dy / d) * 0.4 / CELL_ASPECT };
    const blocker = [player, ...(world.others || []), ...world.visitors.filter((o) => o !== v)].some((o) => near(ahead, o, 0.8));
    if (blocker) {
      v.stuck += dt;
      if (v.stuck > 1) { v.stuck = 0; v.path = null; v.wait = 0.2 + v.r() * 0.5; }
      continue;
    }
    v.stuck = 0;
    v.x = nx;
    v.y = ny;
  }
}
