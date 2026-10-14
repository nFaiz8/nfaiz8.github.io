// The rules engine of the arena fight: fighter records, shots and the bullet sweep, strikes, pickups,
// respawns and the flee rule. Shared by the Worker (the authority) and the browser (the dummy, offline).
// Pure: no DOM, no clocks, no randomness of its own (rand is given). Times are in seconds.
import { levelKind } from './level.js';
import {
  MAX_HP, SAFE_TIME, PICKUP_BACK, GUNS, GUN_BY_CODE, STRIKES, stunOf,
  shoulderOf, muzzleOf, rayLength, bulletRange, bulletAt, sweep,
  regenHp, fleeKiller, nextStrike, strikeBox, boxHits, strikeKnock, bulletKnock, inDodge, pickSpawn, nearPickup,
} from './fight.js';

const EST_MAX = 0.1; // how far ahead a fighter's last state is moved on by its velocity, then held
const RESPAWN_MIN = 1.9; // the 2 s respawn delay, less jitter
const AIR_GRACE = 0.15; // a claimed kick counts if the striker was in the air this recently
const ROLL_BACK = 0.15; // a roll's start is never put more than this before its state arrived
const ORIGIN = { x: 3, y: 2 }; // how far a shot's claimed origin may be from the muzzle estimate
const TOUCH = 1e-6; // cells: a body flush against the wall a bullet stops at is still touched (round-off)

const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r1 = (v) => Math.round(v * 10) / 10 + 0; // + 0 turns -0 into 0
const shownHp = (hp) => (hp > 0 ? Math.max(1, Math.round(hp)) : 0); // alive never shows 0

// A plain record: it survives structuredClone and JSON (Durable Object attachments).
export function newFighter(id, now) {
  return {
    id, arena: false, x: 0, y: 0, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, at: now,
    hp: MAX_HP, hurtAt: -1e9, alive: true, deadAt: -1e9, safeUntil: 0,
    kills: 0, combo: 0, strikeAt: -1e9, lastStrike: null, airAt: -1e9, hitBy: null,
    gun: 'deagle', ammo: -1, rollAt: null,
  };
}

const toDeagle = (F) => { F.gun = 'deagle'; F.ammo = -1; };

export function createReferee({ level, rand }) {
  const kindAt = levelKind(level);
  const bullets = [];
  const pickups = level.pickups.map((p) => ({ ...p, takenAt: -1e9 }));
  let seq = 0;

  // The last state moved on by its velocity for the time since it arrived, at most EST_MAX.
  const estimate = (F, t) => {
    const k = Math.max(0, Math.min(EST_MAX, t - F.at));
    return { x: F.x + F.vx * k, y: F.y + F.vy * k };
  };
  const ready = (F) => F.arena && F.alive && !(F.i & 32);
  const target = (T, t) => T.arena && T.alive && t >= T.safeUntil && !inDodge(T.rollAt, t);

  function hurt(T, by, w, n, d, kx, ky, stun, now, all) {
    T.hp = regenHp(T.hp, T.hurtAt, now) - d;
    T.hurtAt = now;
    T.hitBy = by;
    const e = estimate(T, now);
    T.x = e.x; T.y = e.y; T.at = now;
    T.vx = kx;
    // A bullet doesn't cancel a jump: its knock adds to vy. A strike's replaces it.
    if (GUN_BY_CODE[w]) T.vy += ky; else if (ky) T.vy = ky;
    const out = [{ t: 'h', id: T.id, by, w, n: n ?? -1, d, hp: shownHp(T.hp), kx: r1(kx), ky: r1(ky) }];
    if (T.hp <= 0) {
      T.alive = false; T.deadAt = now; T.hp = 0;
      toDeagle(T);
      const K = all.find((o) => o.id === by);
      if (K) K.kills++;
      out.push({ t: 'k', id: T.id, by, kills: K ? K.kills : 0 });
    }
    return out;
  }

  function enter(F, now) {
    Object.assign(F, { arena: true, hp: MAX_HP, hurtAt: -1e9, alive: true, safeUntil: now + SAFE_TIME, hitBy: null, i: 0, rollAt: null });
    toDeagle(F);
    return [{ t: 'aj', id: F.id, hp: MAX_HP, kills: F.kills }];
  }

  function state(F, s, now, sentAt = now) {
    const was = F.i & 32;
    F.x = s.x; F.y = s.y; F.vx = s.vx; F.vy = s.vy; F.f = s.f; F.g = s.g; F.i = s.i; F.a = s.a;
    F.at = now;
    if (s.g === 0) F.airAt = now;
    if (s.i & 32) { if (!was || F.rollAt == null) F.rollAt = Math.max(sentAt, now - ROLL_BACK); } else F.rollAt = null;
  }

  function fire(F, m, now, all) {
    const G = GUNS[F.gun];
    if (!ready(F) || bullets.filter((b) => b.owner === F.id).length >= G.max) return { ok: false, out: [] };
    const e = estimate(F, now);
    const mz = muzzleOf(e.x, e.y, F.f, F.a, F.gun);
    const near = Math.abs(m.x - mz.x) <= ORIGIN.x && Math.abs(m.y - mz.y) <= ORIGIN.y; // false for NaN
    const x = r2(near ? m.x : mz.x), y = r2(near ? m.y : mz.y);
    const range = bulletRange(F.gun);
    // No shot starts past a wall: the way from the shoulder of the last accepted state (not the
    // estimate, which ignores walls) to the origin must be clear, or the bullet dies at once.
    const sh = shoulderOf(F.x, F.y, F.f);
    const ox = x - sh.x, oy = (y - sh.y) * 2, dist = Math.hypot(ox, oy);
    const blocked = dist > 0 && rayLength(kindAt, sh.x, sh.y, Math.atan2(oy, ox), dist) < dist;
    const n = seq;
    seq = (seq + 1) % 65536;
    // The wall it will hit is found once, now.
    bullets.push({ n, owner: F.id, gun: F.gun, x, y, angle: m.a, t0: now, last: now, len: blocked ? 0 : Math.min(rayLength(kindAt, x, y, m.a, range), range) });
    const out = [{ t: 's', id: F.id, n, x, y, a: m.a, w: G.code }];
    if (F.ammo > 0 && --F.ammo === 0) {
      toDeagle(F);
      out.push({ t: 'w', id: F.id, w: 'd', ammo: -1 });
    }
    F.safeUntil = 0;
    return { ok: true, out };
  }

  function strike(F, m, now, all) {
    if (!ready(F)) return { ok: false, out: [] };
    const inAir = m.k === 'k' && now - F.airAt <= AIR_GRACE;
    const { kind, combo } = nextStrike(F, now, inAir);
    F.combo = kind === 'kick' ? 3 : combo; // a kick ends the combo
    F.strikeAt = now;
    F.lastStrike = kind;
    F.safeUntil = 0;
    const S = STRIKES[kind];
    const out = [{ t: 'mm', id: F.id, k: S.code }];
    const e = estimate(F, now);
    const box = strikeBox(e.x, e.y, F.f, kind);
    const { kx, ky } = strikeKnock(kind, F.f);
    for (const T of all) {
      if (T === F || !target(T, now)) continue;
      const t = estimate(T, now);
      if (boxHits(box, t.x, t.y)) out.push(...hurt(T, F.id, S.code, null, S.damage, kx, ky, S.stun, now, all));
    }
    return { ok: true, out };
  }

  // Each bullet moves from last to min(now, its end). The earliest body its motion touches,
  // relative to that body's own motion over the same span, takes the hit.
  function tick(now, all) {
    const out = [];
    for (let j = 0; j < bullets.length; j++) {
      const b = bullets[j];
      const G = GUNS[b.gun];
      const end = b.t0 + (b.len + TOUCH) / G.speed;
      const t1 = Math.min(now, end);
      if (t1 > b.last) {
        const p0 = bulletAt(b, b.last), p1 = bulletAt(b, t1);
        let hit = null, hitT = Infinity;
        for (const T of all) {
          if (T.id === b.owner || !T.arena || !T.alive) continue;
          const s = sweep(p0, p1, estimate(T, b.last), estimate(T, t1));
          if (s < 0) continue;
          const t = b.last + s * (t1 - b.last);
          if (t < hitT && target(T, t)) { hit = T; hitT = t; }
        }
        if (hit) {
          const { kx, ky } = bulletKnock(b.gun, b.angle);
          out.push(...hurt(hit, b.owner, G.code, b.n, G.damage, kx, ky, stunOf(G.code), hitT, all));
          bullets.splice(j--, 1);
          continue;
        }
        b.last = t1;
      }
      if (t1 >= end) bullets.splice(j--, 1);
    }
    return out;
  }

  function pickup(F, n, now) {
    const p = pickups[n];
    if (!F.arena || !F.alive || !p || now - p.takenAt < PICKUP_BACK) return { ok: false, out: [] };
    const e = estimate(F, now);
    if (!nearPickup(e.x, e.y, p)) return { ok: false, out: [] };
    p.takenAt = now;
    F.gun = p.gun;
    F.ammo = GUNS[p.gun].ammo;
    return { ok: true, out: [{ t: 'pk', id: F.id, n: p.n, at: PICKUP_BACK * 1000 }, { t: 'w', id: F.id, w: GUNS[p.gun].code, ammo: F.ammo }] };
  }

  function respawn(F, now, all, spot) {
    if (F.alive || now - F.deadAt < RESPAWN_MIN) return { ok: false, out: [] };
    const others = all.filter((o) => o !== F && o.arena && o.alive).map((o) => estimate(o, now));
    const s = spot ?? level.spawns[pickSpawn(level.spawns, others, rand)];
    Object.assign(F, { x: s.x, y: s.y, vx: 0, vy: 0, at: now, hp: MAX_HP, hurtAt: -1e9, alive: true, safeUntil: now + SAFE_TIME, hitBy: null, i: 0, rollAt: null });
    toDeagle(F);
    return { ok: true, out: [{ t: 'sp', id: F.id, x: s.x, y: s.y }] };
  }

  function leave(F, now, all) {
    if (!F.arena) return []; // al, then the socket closing: one leave
    const out = [];
    const by = F.alive ? fleeKiller(F, now) : null;
    const K = by && all.find((o) => o.id === by);
    if (K) {
      K.kills++;
      out.push({ t: 'k', id: F.id, by: K.id, kills: K.kills, fled: 1 });
      F.hitBy = null;
    }
    out.push({ t: 'ax', id: F.id });
    F.arena = false;
    F.rollAt = null;
    return out;
  }

  const view = (F, now) => ({
    id: F.id, hp: F.alive ? shownHp(regenHp(F.hp, F.hurtAt, now)) : 0, kills: F.kills,
    alive: F.alive ? 1 : 0, safe: now < F.safeUntil ? 1 : 0, w: GUNS[F.gun].code, ammo: F.ammo,
    x: F.x, y: F.y, vx: F.vx, vy: F.vy, f: F.f, g: F.g, i: F.i, a: F.a,
  });

  return {
    enter, state, fire, strike, tick, pickup, respawn, leave, view, estimate,
    pickups: (now) => pickups.map((p) => ({ n: p.n, at: Math.max(0, Math.round((p.takenAt + PICKUP_BACK - now) * 1000)) })),
    live: () => bullets.length,
    bullets,
  };
}
