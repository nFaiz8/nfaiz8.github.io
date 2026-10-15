// The numbers and geometry of the arena fight, shared by the rules engine, the Worker and the browser.
// Pure: no DOM, no randomness of its own, no clocks. Times are in seconds; angles are on screen.
import { SOLID } from './level.js';
import { SHOULDERS, MUZZLE_R } from './stick.js';

export const MAX_HP = 100;
export const FIGURE_ROWS = 3;
export const HURT = { hw: 0.5, hh: 1.5 };
// The hurtbox by stance (crouch addendum §2), low 0 standing, 1 crouched, 2 prone: dy is its centre's offset
// below the body's (the feet stay at +1.5). A standing shot's line (-0.3) passes over the low two.
export const HURTS = [{ dy: 0, hw: 0.5, hh: 1.5 }, { dy: 0.65, hw: 0.5, hh: 0.85 }, { dy: 1, hw: 1.75, hh: 0.5 }];
export const hurtOf = (low) => HURTS[low] || HURTS[0];
// The stance in a state's input bits: 64 crouched, 128 prone, honoured only on the ground and not rolling.
export const lowOf = (i, g) => (g === 1 && !(i & 32) ? (i & 128 ? 2 : i & 64 ? 1 : 0) : 0);
export const LOW_RANGE = 1.5; // a shot fired low flies this much further
export const LOW_KNOCK = 0.5; // a body hit while low takes this much of the knock and the stun
export const CRAWL_SPREAD = 0.5; // radians: a shot fired crawling goes up off its aim by up to this
export const REGEN_RATE = 20;
export const REGEN_AFTER = 4;
export const SAFE_TIME = 3; // protection after spawning or entering; shooting or striking ends it
export const RESPAWN_TIME = 2;
export const FLEE_TIME = 3;
export const PICKUP_BACK = 10;
export const PICKUP_REACH = { x: 1, y: 2 };
// Pickups appear at random spots (pickups addendum): this far apart (on screen, cells) from each other and
// from where they last were, and this far from a spawn. A medkit heals this much, and is gone this long
// (seconds, at random) once taken.
export const PICKUP_GAP = 20, SPAWN_GAP = 6;
export const MEDKIT = { heal: 50, back: [15, 30] };
export const PICKUP_CODE = { rifle: 'r', sniper: 'n', medkit: 'm' };
export const PICKUP_BY_CODE = { r: 'rifle', n: 'sniper', m: 'medkit' };
// Bumped when the fight's wire changes, so a page and a server of different versions don't fight together
// (each falls back to the dummy): it goes into the fight hash. 2: pickups at random spots, and medkits.
// 3: two maps, the train and the gorge, and ladders (input bits 256 ↑ held, 512 on a ladder).
export const FIGHT_VERSION = 3;
export const COMBO_GAP = 0.5;
export const DODGE = [0.04, 0.26];
export const ROLL = { speed: 48, time: 0.3, cooldown: 0.5 }; // cells/s, seconds
export const ACT_TIME = { shoot: 0.2, punch: 0.25, kick: 0.4, roll: 0.3 };

// Ammo -1 means endless, everywhere: records and wire. The deagle's range is unlimited (weapons addendum),
// so up to 6 of its rounds may be in flight (one crossing the level takes 2.5 s; it fires every 0.4 s). spray: radians a shot may go off its aim either way,
// standing (or in the air) and crouched; the rifle is drawn and shown as an smg (smg addendum).
export const GUNS = {
  deagle: { code: 'd', damage: 25, cooldown: 0.4, speed: 80, flight: 0.8, max: 6, ammo: -1, kb: 10, stun: 0.1, range: Infinity },
  rifle: { code: 'r', damage: 8, cooldown: 0.1, speed: 90, flight: 0.7, max: 7, ammo: 40, kb: 3, stun: 0.05, spray: [0.15, 0.04] },
  sniper: { code: 'n', damage: 70, cooldown: 1.8, speed: 220, flight: 0.75, max: 1, ammo: 5, kb: 30, stun: 0.3, parry: true },
};
export const GUN_BY_CODE = { d: 'deagle', r: 'rifle', n: 'sniper' };
export const GUN_NAME = { deagle: 'deagle', rifle: 'smg', sniper: 'sniper' }; // what the HUD calls them
// A gun's spray in a stance (0 standing, 1 crouched); crawling has its own (CRAWL_SPREAD).
export const sprayOf = (gun, low = 0) => (GUNS[gun].spray ? GUNS[gun].spray[low ? 1 : 0] : 0);
export const STRIKES = {
  punch: { code: 'p', damage: 14, reach: 1.8, kx: 25, ky: 10, stun: 0.2, cooldown: 0.3 },
  kick: { code: 'k', damage: 22, reach: 2.2, kx: 45, ky: 22, stun: 0.4, cooldown: 0.55 },
};

// A strike's box, grown by PARRY_PAD cells each way, parries a round of a gun with parry (the sniper) that
// flies into it this long after the strike: the round turns straight back, the striker's now (parry
// addendum §1). PARRY_TIME stays under the punch's cooldown, so mashing can't hold a parry up.
export const PARRY_TIME = 0.28, PARRY_PAD = 0.6;

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
export const shoulderOf = (x, y, facing, low = 0) => {
  const S = SHOULDERS[low] || SHOULDERS[0];
  return { x: x + S.dx * facing, y: y + S.dy };
};

export function muzzleOf(x, y, facing, aim, gun, low = 0) {
  const s = shoulderOf(x, y, facing, low);
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

// range: Infinity flies until a wall (the deagle: the level's walls are all around, so it always ends).
export const bulletRange = (gun, long = false) => GUNS[gun].range ?? GUNS[gun].speed * GUNS[gun].flight * (long ? LOW_RANGE : 1);

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

// Headshots: a bullet's hit point (dx cells, dy rows from the target's centre), clamped into the stance's
// hurtbox, is on the head when it is in the top row of the box; crouched, above HEAD_LINE_LOW; prone, the
// front of the box in the facing direction f. Damage is HEADSHOT times; melee has none.
export const HEADSHOT = 2;
const HEAD_LINE = -0.5, HEAD_LINE_LOW = 0.3, HEAD_FRONT = 0.75;
export function isHeadshot(rel, low = 0, f = 1) {
  const H = hurtOf(low);
  if (low === 2) return Math.max(-H.hw, Math.min(H.hw, rel.dx)) * (f < 0 ? -1 : 1) > HEAD_FRONT;
  const dy = Math.max(H.dy - H.hh, Math.min(H.dy + H.hh, rel.dy));
  return dy < (low === 1 ? HEAD_LINE_LOW : HEAD_LINE);
}

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

export function boxHits(box, x, y, low = 0) {
  const H = hurtOf(low), cy = y + H.dy;
  return box.x0 < x + H.hw && box.x1 > x - H.hw && box.y0 < cy + H.hh && box.y1 > cy - H.hh;
}
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
