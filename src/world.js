// Player, camera and focus. Renderer-agnostic; all positions are in cells (floats).
import { isWalkable } from './layout.js';
import { findPath } from './path.js';
import { CELL_ASPECT } from './layout.js';

const SPEED = 12; // walking, cells per second horizontally; vertical is divided by CELL_ASPECT
const SPRINT = 2.5; // holding Shift
const PATH_SPEED = 24; // tap/click-to-walk keeps its brisk pace
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

export function teleport(world, x, y) {
  world.player.x = x;
  world.player.y = y;
  world.player.vx = world.player.vy = 0;
  world.cam.x = x;
  world.cam.y = y;
  world.cam.vx = world.cam.vy = 0;
  world.path = null;
  world.onArrive = null;
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
  const p = world.player;
  const speed = SPEED * (input.run ? SPRINT : 1);

  // Where we want to be going, in horizontal-cell units per second.
  let tx = 0, ty = 0;
  if (input.x || input.y) {
    world.path = null;
    world.onArrive = null;
    const len = Math.hypot(input.x, input.y) || 1;
    tx = (input.x / len) * speed;
    ty = (input.y / len) * speed;
  } else if (world.path) {
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
  const hit = moveBy(world, p.vx * dt, (p.vy / CELL_ASPECT) * dt);
  if (hit.hitX) p.vx *= 0.5;
  if (hit.hitY) p.vy *= 0.5;
  p.moving = Math.hypot(p.vx, p.vy) > 0.5;
  if (Math.abs(p.vx) > 0.5) p.facing = Math.sign(p.vx);

  stepVisitors(world, dt);

  // Camera: a spring that leads slightly in the direction you're walking.
  const t = world.camTarget;
  const ax = t ? t.x : p.x + p.vx * LOOK_AHEAD, ay = t ? t.y : p.y + (p.vy / CELL_ASPECT) * LOOK_AHEAD;
  if (world.reducedMotion || (t && t.snap)) { world.cam.x = ax; world.cam.y = ay; world.cam.vx = world.cam.vy = 0; }
  else { const ct = t ? 0.12 : CAM_TIME; spring(world.cam, 'x', ax, ct, dt); spring(world.cam, 'y', ay, ct, dt); }

  world.focus = nearestFrame(world);
}

export function roomAt(map, x, y) {
  const i = Math.floor(y) * map.W + Math.floor(x);
  return i >= 0 && i < map.roomOf.length ? map.roomOf[i] : -1;
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
  const rooms = map.rooms.filter((room) => room.frames && room.frames.length);
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
  const rooms = map.rooms.filter((room) => room.frames && room.frames.length);
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
  const cells = findPath(map.W, map.H, (x, y) => isWalkable(map, x, y) && !occupied(x, y), Math.floor(v.x), Math.floor(v.y), gx, gy, 60000);
  if (!cells) { v.wait = 1; return; }
  v.path = smoothPath(map, v, cells);
  v.looking = false;
}

function stepVisitors(world, dt) {
  const { map, player } = world;
  for (const v of world.visitors) {
    // Step aside when you walk into someone.
    if (near(v, player, 0.9)) {
      const dx = v.x - player.x, dy = (v.y - player.y) * CELL_ASPECT, d = Math.hypot(dx, dy) || 1;
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
    const blocker = [player, ...world.visitors.filter((o) => o !== v)].some((o) => near(ahead, o, 0.8));
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
