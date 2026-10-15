import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLID, PLATFORM, AIR } from '../src/level.js';
import * as F from '../src/fight.js';

const close = (a, b, e = 1e-9, msg) => assert.ok(Math.abs(a - b) <= e, msg || `${a} ≠ ${b}`);

test('the numbers: guns, strikes, health', () => {
  assert.equal(F.MAX_HP, 100);
  assert.equal(F.FIGURE_ROWS, 3);
  assert.deepEqual([F.GUNS.deagle.damage, F.GUNS.rifle.damage, F.GUNS.sniper.damage], [25, 6, 70]);
  assert.deepEqual([F.GUNS.deagle.cooldown, F.GUNS.rifle.cooldown, F.GUNS.sniper.cooldown], [0.4, 0.1, 1.2]);
  assert.deepEqual([F.GUNS.deagle.max, F.GUNS.rifle.max, F.GUNS.sniper.max], [2, 7, 1]);
  assert.deepEqual([F.GUNS.deagle.ammo, F.GUNS.rifle.ammo, F.GUNS.sniper.ammo], [-1, 40, 5]);
  close(F.bulletRange('deagle'), 64);
  assert.ok(F.bulletRange('sniper') >= 160);
  assert.deepEqual([F.STRIKES.punch.damage, F.STRIKES.kick.damage], [14, 22]);
  assert.deepEqual(['d', 'r', 'n', 'p', 'k'].map(F.stunOf), [0.1, 0.05, 0.3, 0.2, 0.4]);
});

test('aim: 0 and ±π/4 from keys; the mouse aims at any angle, clamped, flipping facing toward the cursor', () => {
  assert.equal(F.keyAim(false, false), 0);
  close(F.keyAim(true, false), -Math.PI / 4);
  close(F.keyAim(false, true), Math.PI / 4);
  assert.equal(F.keyAim(true, true), 0);
  const ahead = F.pointAim(10, 10, 20, 10, 1);
  assert.deepEqual(ahead, { facing: 1, aim: 0 });
  const behindUp = F.pointAim(10, 10, 5, 7.5, 1); // 5 cells left, 2.5 rows up = 5 screen units up
  assert.equal(behindUp.facing, -1);
  close(behindUp.aim, -Math.PI / 4);
  const above = F.pointAim(10, 10, 10, 0, -1);
  assert.equal(above.facing, -1);
  close(above.aim, -Math.PI / 2);
  close(F.absAngle(1, 0.3), 0.3);
  close(F.absAngle(-1, 0), Math.PI);
  close(F.absAngle(-1, -Math.PI / 4), -3 * Math.PI / 4);
  close(F.absAngle(-1, Math.PI / 4), 3 * Math.PI / 4);
});

test('the muzzle is MUZZLE_R along the aim from the shoulder', () => {
  const m = F.muzzleOf(10, 20, 1, 0, 'deagle');
  close(m.x, 10 + 0.15 + 2.8);
  close(m.y, 20 - 0.3);
  const up = F.muzzleOf(10, 20, -1, -Math.PI / 2, 'sniper');
  close(up.x, 10 - 0.15, 1e-9);
  close(up.y, 20 - 0.3 - 6.8 / 2);
});

// A room the size of the arena: a ▓ column at x 50 (rows 10–20), a ═ row at 25, solid outside.
const kindAt = (c, r) => (c < 0 || r < 0 || c >= 160 || r >= 34 ? SOLID : c === 50 && r >= 10 && r <= 20 ? SOLID : r === 25 ? PLATFORM : AIR);

test('the ray cast stops at ▓, walls, floor and ceiling, passes through ═, and ends at max', () => {
  close(F.rayLength(kindAt, 10.5, 15.5, 0, 1000), 39.5);
  close(F.rayLength(kindAt, 10.5, 20.5, Math.PI / 2, 1000), (34 - 20.5) * 2, 1e-9, 'through ═ to the floor');
  close(F.rayLength(kindAt, 10.5, 20.5, -Math.PI / 2, 1000), 20.5 * 2, 1e-9, 'ceiling');
  close(F.rayLength(kindAt, 100.5, 5.5, 0, 1000), 59.5, 1e-9, 'the east wall and its door');
  close(F.rayLength(kindAt, 60.5, 5.5, 0, 64), 64, 1e-9, 'range');
  const diag = F.rayLength(kindAt, 30.5, 15.5, Math.atan2(2 * 0, 1), 1000);
  close(diag, 19.5);
});

test('the relative sweep never misses a target the bullet crosses, at any angle, against a target sprinting or falling at full speed, with 33 ms ticks', () => {
  const tick = 0.033;
  for (const gun of ['deagle', 'rifle', 'sniper']) {
    const speed = F.GUNS[gun].speed;
    for (let k = 0; k < 32; k++) {
      const angle = -Math.PI + (k + 0.5) * (2 * Math.PI / 32);
      for (const tv of [[0, 0], [45, 0], [-45, 0], [0, 60], [0, -40], [45, 60]]) {
        const meet = 0.2; // the bullet passes through the target's centre at 0.2 s
        const c = (t) => ({ x: 80 + tv[0] * t, y: 17 + tv[1] * t });
        const d = F.along(angle, speed * meet);
        const b = { x: c(meet).x - d.dx, y: c(meet).y - d.dy, angle, gun, t0: 0 };
        let hit = -1;
        for (let t = 0; t < meet + tick && hit < 0; t += tick) {
          const s = F.sweep(F.bulletAt(b, t), F.bulletAt(b, t + tick), c(t), c(t + tick));
          if (s >= 0) hit = t + s * tick;
        }
        assert.ok(hit >= 0 && hit <= meet + 1e-9, `${gun} at ${(angle * 180 / Math.PI).toFixed(0)}° vs ${tv}: ${hit}`);
      }
    }
  }
});

test('sweep: a miss is −1; starting inside is 0', () => {
  assert.equal(F.sweep({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }), -1);
  assert.equal(F.sweep({ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }), 0);
  close(F.sweep({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }), 0.45);
});

test('headshots: ×2; the head is the top row of the box (dy < −0.5), clamped into the box first', () => {
  assert.equal(F.HEADSHOT, 2);
  assert.equal(F.isHeadshot({ dx: 0, dy: -1.5 }), true, 'the top edge');
  assert.equal(F.isHeadshot({ dx: 0.3, dy: -0.6 }), true);
  assert.equal(F.isHeadshot({ dx: 0, dy: -0.5 }), false, 'the line itself is the torso');
  assert.equal(F.isHeadshot({ dx: 0, dy: -0.3 }), false, 'a level shot from the shoulder');
  assert.equal(F.isHeadshot({ dx: 0, dy: 1.4 }), false);
  assert.equal(F.isHeadshot({ dx: 0, dy: -2.1 }), true, 'above the box clamps to its top edge');
  assert.equal(F.isHeadshot({ dx: 0, dy: 2.1 }), false, 'below the box clamps to its bottom edge');
});

test('regeneration starts 4 s after damage, at 20 hp/s, and stops at 100', () => {
  assert.equal(F.regenHp(40, 10, 13.9), 40);
  close(F.regenHp(40, 10, 15), 60);
  assert.equal(F.regenHp(40, 10, 20), 100);
});

test('the flee rule credits a hit 2.9 s earlier, not one 3.1 s earlier', () => {
  assert.equal(F.fleeKiller({ hitBy: 'ann', hurtAt: 10 }, 12.9), 'ann');
  assert.equal(F.fleeKiller({ hitBy: 'ann', hurtAt: 10 }, 13.1), null);
  assert.equal(F.fleeKiller({ hitBy: null, hurtAt: 10 }, 10.5), null);
});

test('combo: punch, punch, kick within 0.5 s; a kick in the air; a pause resets it; a kick ends it', () => {
  const f = { combo: 0, strikeAt: -Infinity };
  const hit = (now, air = false) => { const s = F.nextStrike(f, now, air); f.combo = s.kind === 'kick' ? 3 : s.combo; f.strikeAt = now; return s.kind; };
  assert.deepEqual([hit(1), hit(1.4), hit(1.8), hit(2.2)], ['punch', 'punch', 'kick', 'punch']);
  assert.equal(hit(3), 'punch');
  assert.equal(hit(4), 'punch', 'a pause resets');
  assert.equal(hit(4.3, true), 'kick', 'in the air');
  assert.equal(hit(4.6), 'punch', 'the kick ended the combo');
});

test('strike reach and bands', () => {
  const p = F.strikeBox(10, 20, 1, 'punch');
  assert.equal(F.boxHits(p, 12.6, 20), true, 'front edge 0.4 + reach 1.8 + half hurtbox 0.5');
  assert.equal(F.boxHits(p, 12.8, 20), false);
  assert.equal(F.boxHits(p, 7.4, 20), false, 'behind');
  assert.equal(F.boxHits(p, 11, 22.6), false, 'below the middle 70%');
  const k = F.strikeBox(10, 20, -1, 'kick');
  assert.equal(F.boxHits(k, 7, 20), true);
  assert.equal(F.boxHits(k, 7, 23.9), true, 'a row below the feet');
  assert.deepEqual(F.strikeKnock('kick', -1), { kx: -45, ky: -22 });
  const b = F.bulletKnock('sniper', Math.PI);
  close(b.kx, -30);
  close(b.ky, 0, 1e-9);
});

test('the dodge window is 0.04–0.26 s into a roll', () => {
  assert.equal(F.inDodge(10, 10.03), false);
  assert.equal(F.inDodge(10, 10.04), true);
  assert.equal(F.inDodge(10, 10.26), true);
  assert.equal(F.inDodge(10, 10.27), false);
  assert.equal(F.inDodge(null, 10), false);
});

test('spawn choice picks the spawn farthest from everyone alive', () => {
  const spawns = [{ x: 10, y: 27.5 }, { x: 100, y: 27.5 }, { x: 50, y: 2.5 }];
  assert.equal(F.pickSpawn(spawns, [{ x: 12, y: 27.5 }], () => 0), 1);
  assert.equal(F.pickSpawn(spawns, [{ x: 100, y: 27.5 }, { x: 10, y: 27.5 }], () => 0), 2);
  assert.equal(F.pickSpawn(spawns, [], () => 0.7), 2);
});

test('bullet glyphs follow the direction', () => {
  assert.equal(F.dirGlyph(0), '-');
  assert.equal(F.dirGlyph(Math.PI), '-');
  assert.equal(F.dirGlyph(Math.PI / 9), '-', '20° is within 22.5° of horizontal');
  assert.equal(F.dirGlyph(Math.PI / 6), '\\', '30° is a diagonal (the brief said \'-\'; the spec says 22.5°)');
  assert.equal(F.dirGlyph(Math.PI / 4), '\\');
  assert.equal(F.dirGlyph(-Math.PI / 4), '/');
  assert.equal(F.dirGlyph(3 * Math.PI / 4), '/');
  assert.equal(F.dirGlyph(-3 * Math.PI / 4), '\\');
  assert.equal(F.dirGlyph(Math.PI / 2), '|');
  assert.deepEqual(F.bulletGlyphs('deagle', 0).map((g) => g.ch), ['•', '-']);
  assert.equal(F.bulletGlyphs('rifle', 0).length, 1);
  assert.deepEqual(F.bulletGlyphs('sniper', Math.PI / 2).map((g) => [g.du, g.ch, g.a]), [[0, '|', 1], [1, '|', 0.75], [2, '|', 0.5], [3, '|', 0.25]]);
});

test('pickup reach is 1 cell across and 2 rows', () => {
  assert.equal(F.nearPickup(10.9, 12, { x: 10, y: 10 }), true);
  assert.equal(F.nearPickup(11.1, 10, { x: 10, y: 10 }), false);
  assert.equal(F.nearPickup(10, 12.1, { x: 10, y: 10 }), false);
});

test('fight.js uses no randomness or browser APIs of its own', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/fight.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random|window|document|performance/);
});

// Crouch and crawl (docs/specs/2026-10-14-arena-crouch.md §2, §3).
test('stances: the hurtboxes keep the feet at +1.5; a standing level shot (-0.3) passes over crouched and prone', () => {
  assert.deepEqual(F.hurtOf(0), { dy: 0, hw: 0.5, hh: 1.5 });
  for (const low of [0, 1, 2]) close(F.hurtOf(low).dy + F.hurtOf(low).hh, 1.5, 1e-9, `feet, low ${low}`);
  close(F.hurtOf(1).dy - F.hurtOf(1).hh, -0.2);
  close(F.hurtOf(2).dy - F.hurtOf(2).hh, 0.5);
  assert.equal(F.hurtOf(2).hw, 1.75);
  const stand = F.muzzleOf(0, 0, 1, 0, 'deagle').y;
  assert.ok(stand < F.hurtOf(1).dy - F.hurtOf(1).hh, 'over a crouch');
  const crouch = F.muzzleOf(0, 0, 1, 0, 'deagle', 1).y, prone = F.muzzleOf(0, 0, 1, 0, 'deagle', 2).y;
  for (const low of [0, 1, 2]) {
    const H = F.hurtOf(low);
    assert.ok(crouch > H.dy - H.hh && crouch < H.dy + H.hh, `a crouched shot reaches low ${low}`);
    assert.ok(prone > H.dy - H.hh && prone < H.dy + H.hh, `a prone shot reaches low ${low}`);
  }
  assert.equal(F.hurtOf(7), F.hurtOf(0));
});

test('lowOf: 64 crouched, 128 prone, only with g 1 and the roll bit off', () => {
  assert.equal(F.lowOf(64, 1), 1);
  assert.equal(F.lowOf(128 | 2, 1), 2);
  assert.equal(F.lowOf(0, 1), 0);
  assert.equal(F.lowOf(64, 0), 0);
  assert.equal(F.lowOf(64 | 32, 1), 0);
});

test('shoulderOf and muzzleOf by stance, mirrored by facing', () => {
  const s1 = F.shoulderOf(10, 20, 1, 1), s2 = F.shoulderOf(10, 20, -1, 2);
  close(s1.x, 10.6); close(s1.y, 20.6);
  close(s2.x, 9.45); close(s2.y, 21.1);
  const m = F.muzzleOf(10, 20, -1, 0, 'rifle', 2);
  close(m.x, 9.45 - 3.8); close(m.y, 21.1);
  assert.deepEqual(F.shoulderOf(10, 20, 1), F.shoulderOf(10, 20, 1, 0));
});

test('headshots by stance: crouched above 0.3, prone the front of the box', () => {
  assert.equal(F.isHeadshot({ dx: 0, dy: 0.1 }, 1), true);
  assert.equal(F.isHeadshot({ dx: 0, dy: 0.6 }, 1), false, 'a crouched shot into a croucher: the body');
  assert.equal(F.isHeadshot({ dx: 0, dy: -1 }, 1), true, 'above the box clamps to its top');
  assert.equal(F.isHeadshot({ dx: 1.2, dy: 1 }, 2, 1), true, 'prone facing right: the right end');
  assert.equal(F.isHeadshot({ dx: 1.2, dy: 1 }, 2, -1), false, 'prone facing left: the feet');
  assert.equal(F.isHeadshot({ dx: -3, dy: 1 }, 2, -1), true, 'clamped into the box');
  assert.equal(F.isHeadshot({ dx: 0, dy: 1 }, 2, 1), false);
});

test('boxHits by stance; the range and knock while low', () => {
  const punch = F.strikeBox(10, 20, 1, 'punch');
  assert.equal(F.boxHits(punch, 12, 20, 1), true, 'a punch reaches a croucher');
  assert.equal(F.boxHits(punch, 12, 20, 2), true, 'and someone prone');
  assert.equal(F.boxHits({ x0: 11, x1: 13, y0: 18, y1: 20.1 }, 12, 20, 2), false, 'over someone prone');
  assert.equal(F.boxHits({ x0: 11, x1: 13, y0: 18, y1: 20.1 }, 12, 20, 0), true);
  assert.equal(F.boxHits({ x0: 13.3, x1: 14, y0: 20, y1: 21 }, 12, 20, 2), true, 'the long prone box');
  assert.equal(F.LOW_RANGE, 1.5);
  assert.equal(F.LOW_KNOCK, 0.5);
  close(F.bulletRange('deagle', true), 96);
  close(F.bulletRange('deagle'), 64);
});

test('the smg: 6 a hit, and a spray by stance (standing 0.15, crouched 0.04); the other guns none', async () => {
  const { GUNS, sprayOf } = await import('../src/fight.js');
  assert.equal(GUNS.rifle.damage, 6);
  assert.deepEqual([0, 1].map((low) => sprayOf('rifle', low)), [0.15, 0.04]);
  for (const gun of ['deagle', 'sniper']) assert.deepEqual([0, 1].map((low) => sprayOf(gun, low)), [0, 0], gun);
});
