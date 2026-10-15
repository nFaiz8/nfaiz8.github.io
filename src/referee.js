// The rules engine of the arena fight: fighter records, shots and the bullet sweep, strikes, pickups,
// respawns and the flee rule. Shared by the Worker (the authority) and the browser (the dummy, offline).
// Pure: no DOM, no clocks, no randomness of its own (rand is given). Times are in seconds.
import { levelKind, pickupSpots } from './level.js';
import {
  MAX_HP, SAFE_TIME, PICKUP_BACK, GUNS, GUN_BY_CODE, STRIKES, stunOf,
  shoulderOf, muzzleOf, rayLength, bulletRange, bulletAt, sweep,
  regenHp, fleeKiller, nextStrike, strikeBox, boxHits, strikeKnock, bulletKnock, inDodge, pickSpawn, nearPickup,
  HEADSHOT, isHeadshot, ROLL, hurtOf, lowOf, LOW_KNOCK, PARRY_TIME, PARRY_PAD,
  PICKUP_GAP, SPAWN_GAP, MEDKIT, PICKUP_CODE, REGEN_AFTER,
} from './fight.js';

const EST_MAX = 0.1; // how far ahead a fighter's last state is moved on by its velocity, then held
const RESPAWN_MIN = 1.9; // the 2 s respawn delay, less jitter
const AIR_GRACE = 0.15; // a claimed kick counts if the striker was in the air this recently
const ROLL_BACK = 0.15; // a roll's start is never put more than this before its state arrived
// The soonest a roll may dodge after the last roll that did ended: the cooldown, less 0.1 s for stamps that
// are a little off (a start late by more than ROLL_BACK is put ROLL_BACK back; an end is when it arrived).
const ROLL_GAP = ROLL.cooldown - 0.1;
const ORIGIN = { x: 3, y: 2 }; // how far a shot's claimed origin may be from the muzzle estimate
const TOUCH = 1e-6; // cells: a body flush against the wall a bullet stops at is still touched (round-off)

const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r1 = (v) => Math.round(v * 10) / 10 + 0; // + 0 turns -0 into 0
// A strike's box, grown by PARRY_PAD, as a centre offset from the body and half sizes, for the parry's
// sweep (parry addendum §1).
function parryBox(T) {
  const b = strikeBox(0, 0, T.f, T.lastStrike);
  return { dx: (b.x0 + b.x1) / 2, dy: (b.y0 + b.y1) / 2, hw: (b.x1 - b.x0) / 2 + PARRY_PAD, hh: (b.y1 - b.y0) / 2 + PARRY_PAD };
}
const shownHp = (hp) => (hp > 0 ? Math.max(1, Math.round(hp)) : 0); // alive never shows 0

// A plain record: it survives structuredClone and JSON (Durable Object attachments).
export function newFighter(id, now) {
  return {
    id, arena: false, x: 0, y: 0, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, at: now,
    hp: MAX_HP, hurtAt: -1e9, alive: true, deadAt: -1e9, safeUntil: 0,
    kills: 0, combo: 0, strikeAt: -1e9, lastStrike: null, airAt: -1e9, hitBy: null,
    gun: 'deagle', ammo: -1, rollAt: null, rollEnd: -1e9,
  };
}

const toDeagle = (F) => { F.gun = 'deagle'; F.ammo = -1; };

export function createReferee({ level, rand }) {
  const kindAt = levelKind(level);
  const bullets = [];
  // The level's guns, then one medkit (pickups addendum), each at a random spot; backAt: when it's there.
  const spots = pickupSpots(level);
  const pickups = [...level.pickups.map((p) => p.gun), 'medkit'].map((kind, n) => ({ n, kind, x: null, y: null, backAt: -1e9 }));
  const apart = (a, b, d) => Math.hypot(a.x - b.x, 2 * (a.y - b.y)) >= d;
  // A spot for p: PICKUP_GAP from the others and from where p was, SPAWN_GAP from the spawns; any spot if
  // none is.
  function place(p) {
    const ok = (s) => (p.x == null || apart(s, p, PICKUP_GAP)) && level.spawns.every((q) => apart(s, q, SPAWN_GAP))
      && pickups.every((q) => q === p || q.x == null || apart(s, q, PICKUP_GAP));
    const free = spots.filter(ok), from = free.length ? free : spots;
    const s = from[Math.min(from.length - 1, Math.floor(rand() * from.length))]; // a rand() of 1 is the last
    p.x = s.x; p.y = s.y;
  }
  for (const p of pickups) place(p);
  let seq = 0;

  // The last state moved on by its velocity for the time since it arrived, at most EST_MAX.
  const estimate = (F, t) => {
    const k = Math.max(0, Math.min(EST_MAX, t - F.at));
    return { x: F.x + F.vx * k, y: F.y + F.vy * k };
  };
  const ready = (F) => F.arena && F.alive && !(F.i & 32);
  const low = (F) => lowOf(F.i, F.g); // crouched or prone, as of the last state (crouch addendum §4)
  const target = (T, t) => T.arena && T.alive && t >= T.safeUntil && !inDodge(T.rollAt, t);

  // hs: a headshot; h and the k it causes carry hs: 1, and leave it out otherwise; pr: 1 the same way for a
  // round that was parried. A body hit while low takes half the knock, and lo: 1 tells everyone to halve
  // its stun too.
  function hurt(T, by, w, n, d, kx, ky, stun, now, all, hs = false, pr = false) {
    const lo = low(T) > 0;
    if (lo) { kx *= LOW_KNOCK; ky *= LOW_KNOCK; }
    T.hp = regenHp(T.hp, T.hurtAt, now) - d;
    T.hurtAt = now;
    T.hitBy = by;
    const e = estimate(T, now);
    T.x = e.x; T.y = e.y; T.at = now;
    T.vx = kx;
    // A bullet doesn't cancel a jump: its knock adds to vy. A strike's replaces it.
    if (GUN_BY_CODE[w]) T.vy += ky; else if (ky) T.vy = ky;
    const out = [{ t: 'h', id: T.id, by, w, n: n ?? -1, d, hp: shownHp(T.hp), kx: r1(kx), ky: r1(ky) }];
    if (hs) out[0].hs = 1;
    if (lo) out[0].lo = 1;
    if (pr) out[0].pr = 1;
    if (T.hp <= 0) {
      T.alive = false; T.deadAt = now; T.hp = 0;
      toDeagle(T);
      const K = all.find((o) => o.id === by);
      if (K) K.kills++;
      const k = { t: 'k', id: T.id, by, kills: K ? K.kills : 0 };
      if (hs) k.hs = 1;
      if (pr) k.pr = 1;
      out.push(k);
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
    if (!(s.i & 32)) {
      // A roll that dodges ends when its bit goes off (on arrival: an end can't be backdated), or at
      // its length if that's sooner.
      if (F.rollAt != null) F.rollEnd = Math.max(F.rollAt, Math.min(now, F.rollAt + ROLL.time));
      F.rollAt = null;
    } else if (!was || F.rollAt == null) {
      // A roll too soon after the last one ended opens no dodge (and is tried again while it's held).
      const at = Math.max(sentAt, now - ROLL_BACK);
      if (at - (F.rollEnd ?? -1e9) >= ROLL_GAP - 1e-9) F.rollAt = at;
    }
  }

  function fire(F, m, now, all) {
    const G = GUNS[F.gun];
    // A round F parried is F's, but not against F's cap.
    if (!ready(F) || bullets.filter((b) => b.owner === F.id && !b.pr).length >= G.max) return { ok: false, out: [] };
    const e = estimate(F, now), l = low(F);
    const mz = muzzleOf(e.x, e.y, F.f, F.a, F.gun, l);
    const near = Math.abs(m.x - mz.x) <= ORIGIN.x && Math.abs(m.y - mz.y) <= ORIGIN.y; // false for NaN
    const x = r2(near ? m.x : mz.x), y = r2(near ? m.y : mz.y);
    const range = bulletRange(F.gun, l > 0); // fired low: LOW_RANGE times as far
    // No shot starts past a wall: the way from the shoulder of the last accepted state (not the
    // estimate, which ignores walls) to the origin must be clear, or the bullet dies at once.
    const sh = shoulderOf(F.x, F.y, F.f, l);
    const ox = x - sh.x, oy = (y - sh.y) * 2, dist = Math.hypot(ox, oy);
    const blocked = dist > 0 && rayLength(kindAt, sh.x, sh.y, Math.atan2(oy, ox), dist) < dist;
    const n = seq;
    seq = (seq + 1) % 65536;
    // The wall it will hit is found once, now.
    bullets.push({ n, owner: F.id, gun: F.gun, x, y, angle: m.a, t0: now, last: now, len: blocked ? 0 : Math.min(rayLength(kindAt, x, y, m.a, range), range) });
    const out = [{ t: 's', id: F.id, n, x, y, a: m.a, w: G.code }];
    if (l) out[0].l = 1;
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
      if (boxHits(box, t.x, t.y, low(T))) out.push(...hurt(T, F.id, S.code, null, S.damage, kx, ky, S.stun, now, all));
    }
    return { ok: true, out };
  }

  // When in [from, to] a round of b flies into T's strike box while it still parries, or Infinity. A round
  // already inside the box when its parry starts is not parried: it has to fly in.
  function parryAt(b, T, from, to) {
    if (T.id === b.owner || !T.arena || !T.alive || !T.lastStrike) return Infinity;
    const ta = Math.max(from, T.strikeAt), tb = Math.min(to, T.strikeAt + PARRY_TIME);
    if (!(tb > ta)) return Infinity;
    const P = parryBox(T), q0 = bulletAt(b, ta), q1 = bulletAt(b, tb), c0 = estimate(T, ta), c1 = estimate(T, tb);
    c0.x += P.dx; c0.y += P.dy; c1.x += P.dx; c1.y += P.dy;
    if (Math.abs(q0.x - c0.x) < P.hw && Math.abs(q0.y - c0.y) < P.hh) return Infinity;
    const s = sweep(q0, q1, c0, c1, P.hw, P.hh);
    return s < 0 ? Infinity : ta + s * (tb - ta);
  }

  // Each bullet moves from last to min(now, its end). The earliest body its motion touches,
  // relative to that body's own motion over the same span, takes the hit. A sniper round that meets a
  // strike box first is parried instead (parry addendum §1).
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
          // The stance's box: its centre H.dy below the body's.
          const H = hurtOf(low(T)), c0 = estimate(T, b.last), c1 = estimate(T, t1);
          c0.y += H.dy; c1.y += H.dy;
          const s = sweep(p0, p1, c0, c1, H.hw, H.hh);
          if (s < 0) continue;
          const t = b.last + s * (t1 - b.last);
          if (t < hitT && target(T, t)) { hit = T; hitT = t; }
        }
        let parrier = null, parryT = Infinity;
        if (G.parry) {
          for (const T of all) {
            const t = parryAt(b, T, b.last, t1);
            if (t < parryT) { parrier = T; parryT = t; }
          }
        }
        if (parrier && parryT <= hitT) {
          // Straight back from where it met the box, the parrier's now, with a fresh range; it flies on from
          // there in this same tick.
          const p = bulletAt(b, parryT), x = r2(p.x), y = r2(p.y);
          const angle = b.angle > 0 ? b.angle - Math.PI : b.angle + Math.PI;
          const n = seq, range = bulletRange(b.gun);
          seq = (seq + 1) % 65536;
          out.push({ t: 'pr', id: parrier.id, n: b.n, n2: n, x, y, a: r2(angle), w: G.code });
          Object.assign(b, { n, owner: parrier.id, x, y, angle, t0: parryT, last: parryT, pr: true, len: Math.min(rayLength(kindAt, x, y, angle, range), range) });
          j--;
          continue;
        }
        if (hit) {
          // Where it struck: the bullet at the hit time against the target's estimate then (clamped into
          // the stance's box by isHeadshot). The head takes HEADSHOT times the damage; knock and stun stay.
          const p = bulletAt(b, hitT), c = estimate(hit, hitT);
          const hs = isHeadshot({ dx: p.x - c.x, dy: p.y - c.y }, low(hit), hit.f);
          const { kx, ky } = bulletKnock(b.gun, b.angle);
          out.push(...hurt(hit, b.owner, G.code, b.n, hs ? G.damage * HEADSHOT : G.damage, kx, ky, stunOf(G.code), hitT, all, hs, !!b.pr));
          bullets.splice(j--, 1);
          continue;
        }
        b.last = t1;
      }
      if (t1 >= end) bullets.splice(j--, 1);
    }
    return out;
  }

  // A gun gives itself (the same gun refills); a medkit heals MEDKIT.heal, and is refused at full health.
  // Taken, it comes back at a new spot: a gun PICKUP_BACK later, a medkit at a random time in MEDKIT.back.
  // pk says where (x, y), so everyone draws it there; hl gives the healed hp (d: how much it healed).
  function pickup(F, n, now) {
    const p = pickups[n];
    if (!F.arena || !F.alive || !p || now < p.backAt) return { ok: false, out: [] };
    const e = estimate(F, now);
    if (!nearPickup(e.x, e.y, p)) return { ok: false, out: [] };
    let back, got;
    if (p.kind === 'medkit') {
      const hp = regenHp(F.hp, F.hurtAt, now);
      if (hp >= MAX_HP) return { ok: false, out: [] };
      F.hp = Math.min(MAX_HP, hp + MEDKIT.heal);
      F.hurtAt = Math.max(F.hurtAt, now - REGEN_AFTER); // the regen so far is in hp now: it goes on from here
      back = MEDKIT.back[0] + rand() * (MEDKIT.back[1] - MEDKIT.back[0]);
      got = { t: 'hl', id: F.id, hp: shownHp(F.hp), d: Math.round(F.hp - hp) };
    } else {
      F.gun = p.kind;
      F.ammo = GUNS[p.kind].ammo;
      back = PICKUP_BACK;
      got = { t: 'w', id: F.id, w: GUNS[p.kind].code, ammo: F.ammo };
    }
    p.backAt = now + back;
    place(p);
    return { ok: true, out: [{ t: 'pk', id: F.id, n: p.n, at: Math.round(back * 1000), x: p.x, y: p.y }, got] };
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
    pickups: (now) => pickups.map((p) => ({ n: p.n, at: Math.max(0, Math.round((p.backAt - now) * 1000)), x: p.x, y: p.y, g: PICKUP_CODE[p.kind] })),
    live: () => bullets.length,
    bullets,
  };
}
