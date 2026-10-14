// The numbers and geometry of the arena fight, shared by the rules engine, the Worker and the browser.
// Pure: no DOM, no randomness of its own, no clocks. Times are in seconds; angles are on screen.
import { SOLID } from './level.js';
import { SHOULDER, MUZZLE_R } from './stick.js';

export const MAX_HP = 100;
export const FIGURE_ROWS = 3;
export const HURT = { hw: 0.5, hh: 1.5 };
export const REGEN_RATE = 20;
export const REGEN_AFTER = 4;
export const SAFE_TIME = 1.5;
export const RESPAWN_TIME = 2;
export const FLEE_TIME = 3;
export const PICKUP_BACK = 10;
export const PICKUP_REACH = { x: 1, y: 2 };
export const COMBO_GAP = 0.5;
export const DODGE = [0.04, 0.26];
export const ACT_TIME = { shoot: 0.2, punch: 0.25, kick: 0.4, roll: 0.3 };

// Ammo -1 means endless, everywhere: records and wire.
export const GUNS = {
  deagle: { code: 'd', damage: 25, cooldown: 0.4, speed: 80, flight: 0.8, max: 2, ammo: -1, kb: 10, stun: 0.1 },
  rifle: { code: 'r', damage: 9, cooldown: 0.1, speed: 90, flight: 0.7, max: 7, ammo: 40, kb: 3, stun: 0.05 },
  sniper: { code: 'n', damage: 70, cooldown: 1.2, speed: 220, flight: 0.75, max: 1, ammo: 5, kb: 30, stun: 0.3 },
};
export const GUN_BY_CODE = { d: 'deagle', r: 'rifle', n: 'sniper' };
export const STRIKES = {
  punch: { code: 'p', damage: 14, reach: 1.8, kx: 25, ky: 10, stun: 0.2, cooldown: 0.3 },
  kick: { code: 'k', damage: 22, reach: 2.2, kx: 45, ky: 22, stun: 0.4, cooldown: 0.55 },
};

const STUN = { d: 0.1, r: 0.05, n: 0.3, p: 0.2, k: 0.4 };
export const stunOf = (w) => STUN[w];

// Aim. Facing is -1 or 1; aim is relative to facing, in [-pi/2, pi/2].
export const keyAim = (up, down) => (up && !down ? -Math.PI / 4 : down && !up ? Math.PI / 4 : 0);

export function pointAim(sx, sy, px, py, facing) {
  const dx = px - sx;
  const dy = (py - sy) * 2;
  const f = dx < 0 ? -1 : dx > 0 ? 1 : facing;
  const aim = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.atan2(dy, Math.abs(dx))));
  return { facing: f, aim };
}

export const absAngle = (facing, aim) => (facing > 0 ? aim : aim >= 0 ? Math.PI - aim : -Math.PI - aim);
export const along = (angle, r) => ({ dx: r * Math.cos(angle), dy: r * Math.sin(angle) / 2 });
export const shoulderOf = (x, y, facing) => ({ x: x + SHOULDER.dx * facing, y: y + SHOULDER.dy });

export function muzzleOf(x, y, facing, aim, gun) {
  const s = shoulderOf(x, y, facing);
  const d = along(absAngle(facing, aim), MUZZLE_R[gun]);
  return { x: s.x + d.dx, y: s.y + d.dy };
}

// Bullets. Distance from (x, y) along angle to the first SOLID cell, or max (Amanatides-Woo grid walk).
export function rayLength(kindAt, x, y, angle, max) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle) / 2;
  let cx = Math.floor(x);
  let cy = Math.floor(y);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  let tx = dx > 0 ? (cx + 1 - x) / dx : dx < 0 ? (x - cx) / -dx : Infinity;
  let ty = dy > 0 ? (cy + 1 - y) / dy : dy < 0 ? (y - cy) / -dy : Infinity;
  const ddx = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const ddy = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let t = 0;
  while (t <= max) {
    if (kindAt(cx, cy) === SOLID) return t;
    if (tx < ty) { t = tx; tx += ddx; cx += sx; } else { t = ty; ty += ddy; cy += sy; }
  }
  return max;
}

export const bulletRange = (gun) => GUNS[gun].speed * GUNS[gun].flight;

export function bulletAt(b, t) {
  const d = along(b.angle, GUNS[b.gun].speed * (t - b.t0));
  return { x: b.x + d.dx, y: b.y + d.dy };
}

// First s in [0, 1] where the segment p0->p1 meets the box centred on c0->c1 (relative motion), or -1.
export function sweep(p0, p1, c0, c1, hw = 0.5, hh = 1.5) {
  let enter = -Infinity;
  let exit = Infinity;
  const axes = [
    [p0.x - c0.x, p1.x - c1.x, hw],
    [p0.y - c0.y, p1.y - c1.y, hh],
  ];
  for (const [r0, r1, h] of axes) {
    const d = r1 - r0;
    if (d === 0) {
      if (Math.abs(r0) > h) return -1;
      continue;
    }
    const a = (-h - r0) / d;
    const b = (h - r0) / d;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit && exit >= 0 && enter <= 1 ? Math.max(0, enter) : -1;
}

// Headshots: a bullet's hit point (dx cells, dy rows from the target's centre), clamped into the hurtbox,
// is on the head when it is in the top row of the box. Damage is HEADSHOT times; melee has none.
export const HEADSHOT = 2;
const HEAD_LINE = -0.5;
export const isHeadshot = (rel) => Math.max(-HURT.hh, Math.min(HURT.hh, rel.dy)) < HEAD_LINE;

// Health.
export const regenHp = (hp, hurtAt, now) => Math.min(MAX_HP, hp + Math.max(0, now - hurtAt - REGEN_AFTER) * REGEN_RATE);
export const fleeKiller = (f, now) => (f.hitBy && now - f.hurtAt <= FLEE_TIME ? f.hitBy : null);

// Strikes. The caller stores f.combo = kind === 'kick' ? 3 : combo, since a kick ends the combo.
export function nextStrike(f, now, inAir) {
  const combo = f.combo > 0 && f.combo < 3 && now - f.strikeAt <= COMBO_GAP ? f.combo + 1 : 1;
  return { kind: inAir || combo === 3 ? 'kick' : 'punch', combo };
}

export const strikeReady = (f, now) => f.strikeAt == null || now - f.strikeAt >= STRIKES[f.lastStrike || 'punch'].cooldown;

export function strikeBox(x, y, facing, kind) {
  const a = x + 0.4 * facing;
  const b = x + (0.4 + STRIKES[kind].reach) * facing;
  return kind === 'kick'
    ? { x0: Math.min(a, b), x1: Math.max(a, b), y0: y - 1.5, y1: y + 2.5 }
    : { x0: Math.min(a, b), x1: Math.max(a, b), y0: y - 1.05, y1: y + 1.05 };
}

export const boxHits = (box, x, y) => box.x0 < x + HURT.hw && box.x1 > x - HURT.hw && box.y0 < y + HURT.hh && box.y1 > y - HURT.hh;
export const strikeKnock = (kind, facing) => ({ kx: facing * STRIKES[kind].kx, ky: -STRIKES[kind].ky });

export const bulletKnock = (gun, angle) => ({ kx: GUNS[gun].kb * Math.cos(angle), ky: GUNS[gun].kb * Math.sin(angle) / 2 });
export const inDodge = (rollAt, now) => rollAt != null && now - rollAt >= DODGE[0] - 1e-9 && now - rollAt <= DODGE[1] + 1e-9; // epsilon: 10.04 - 10 is 0.03999...

// Spawns: the one farthest (on screen) from everyone else; ties go to rand().
export function pickSpawn(spawns, others, rand) {
  if (!others.length) return Math.floor(rand() * spawns.length);
  const score = spawns.map((s) => Math.min(...others.map((o) => Math.hypot(s.x - o.x, 2 * (s.y - o.y)))));
  const best = Math.max(...score);
  const tied = [];
  score.forEach((v, i) => { if (best - v <= 1e-6) tied.push(i); });
  return tied.length === 1 ? tied[0] : tied[Math.floor(rand() * tied.length)];
}

export const nearPickup = (x, y, p) => Math.abs(x - p.x) <= PICKUP_REACH.x && Math.abs(y - p.y) <= PICKUP_REACH.y;

// Glyphs.
export function dirGlyph(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const deg = Math.atan2(Math.abs(s), Math.abs(c)) * 180 / Math.PI; // 0..90 from horizontal
  if (deg <= 22.5) return '-';
  if (deg > 67.5) return '|';
  return (c > 0) === (s > 0) ? '\\' : '/';
}

export function bulletGlyphs(gun, angle, out = []) {
  out.length = 0;
  const g = dirGlyph(angle);
  if (gun === 'deagle') out.push({ du: 0, ch: '•', a: 1 }, { du: 1, ch: g, a: 0.5 });
  else if (gun === 'rifle') out.push({ du: 0, ch: g, a: 1 });
  else for (let i = 0; i < 4; i++) out.push({ du: i, ch: g, a: 1 - i * 0.25 });
  return out;
}
