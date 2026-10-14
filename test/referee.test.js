import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { createReferee, newFighter } from '../src/referee.js';
import { muzzleOf, GUNS, STRIKES } from '../src/fight.js';
import { newBody, stepBody, knock } from '../src/arena.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const ref = () => createReferee({ level: L, rand: () => 0.5 });
const F = (id, x, y = 27.5, f = 1) => Object.assign(newFighter(id, 0), { arena: true, x, y, f, at: 0, safeUntil: 0 });
const shoot = (R, A, now, all, a = 0) => { const m = muzzleOf(A.x, A.y, A.f, 0, A.gun); return R.fire(A, { x: m.x, y: m.y, a }, now, all); };
const run = (R, from, to, all) => { const out = []; for (let t = from; t <= to + 1e-9; t += 0.033) out.push(...R.tick(t, all)); return out; };

test('a deagle shot at a standing target: s, then h with 25 damage and knockback away', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  const { ok, out } = shoot(R, A, 1, [A, B]);
  assert.equal(ok, true);
  assert.equal(out[0].t, 's');
  assert.equal(out[0].w, 'd');
  const h = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'h');
  assert.deepEqual({ ...h, n: undefined }, { t: 'h', id: 'b', by: 'a', w: 'd', n: undefined, d: 25, hp: 75, kx: 10, ky: 0 });
  assert.equal(R.live(), 0);
});

test('a ▓ pillar in the way stops the bullet', () => {
  const R = ref(), A = F('a', 30.5), B = F('b', 45.5);
  shoot(R, A, 1, [A, B]);
  assert.equal(run(R, 1, 2, [A, B]).filter((m) => m.t === 'h').length, 0);
  assert.equal(R.live(), 0);
});

test('protected and popped targets are skipped, and your own bullet never hits you', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5), C = F('c', 40.5 - 5);
  B.safeUntil = 5;
  shoot(R, A, 1, [A, B, C]);
  const hs = run(R, 1, 2, [A, B, C]).filter((m) => m.t === 'h');
  assert.deepEqual(hs.map((h) => h.id), ['c']);
  const S = F('s', 20.5);
  shoot(R, S, 3, [S]);
  assert.equal(run(R, 3, 4, [S]).length, 0);
});

test('a target inside its roll\'s dodge window is skipped; just before and after it is hit', () => {
  const at = (rollOffset) => {
    const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
    shoot(R, A, 1, [A, B]);
    B.rollAt = 1.082 - rollOffset; // the bullet arrives about 0.082 s after firing
    return run(R, 1, 1.3, [A, B]).some((m) => m.t === 'h');
  };
  assert.equal(at(0.1), false);
  assert.equal(at(0.02), true);
  assert.equal(at(0.3), true);
});

test('four deagle hits pop: k with kills 1; the dead target holds the deagle', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  B.gun = 'rifle'; B.ammo = 12;
  const out = [];
  for (let k = 0; k < 4; k++) { shoot(R, A, 1 + k * 0.5, [A, B]); out.push(...run(R, 1 + k * 0.5, 1.4 + k * 0.5, [A, B])); }
  assert.deepEqual(out.filter((m) => m.t === 'h').map((h) => h.hp), [75, 50, 25, 0]);
  assert.deepEqual(out.find((m) => m.t === 'k'), { t: 'k', id: 'b', by: 'a', kills: 1 });
  assert.equal(B.alive, false);
  assert.equal(B.gun, 'deagle');
});

test('bullets in flight: at most 2 deagle, 7 rifle, 1 sniper', () => {
  for (const [gun, max] of [['deagle', 2], ['rifle', 7], ['sniper', 1]]) {
    const R = ref(), A = F('a', 60.5);
    A.gun = gun; A.ammo = GUNS[gun].ammo;
    let ok = 0;
    for (let k = 0; k < 10; k++) if (shoot(R, A, 1 + k * 0.001, [A]).ok) ok++;
    assert.equal(ok, max, gun);
  }
});

test('running dry: 40 rifle shots, then w back to the deagle, and the next s is a deagle shot', () => {
  const R = ref(), A = F('a', 60.5);
  A.gun = 'rifle'; A.ammo = 40;
  let out = [];
  for (let k = 0; k < 40; k++) { out = shoot(R, A, 1 + k, [A]).out; R.tick(1.9 + k, [A]); }
  assert.deepEqual(out.at(-1), { t: 'w', id: 'a', w: 'd', ammo: -1 });
  assert.equal(shoot(R, A, 50, [A]).out[0].w, 'd');
});

test('pickups: taken, refused while gone, back after 10 s, the same gun refills, too far is refused', () => {
  const R = ref(), p = L.pickups.find((q) => q.gun === 'rifle');
  const A = F('a', p.x, p.y), B = F('b', p.x + 0.5, p.y), C = F('c', p.x + 3, p.y);
  assert.deepEqual(R.pickup(A, p.n, 1).out, [{ t: 'pk', id: 'a', n: p.n, at: 10000 }, { t: 'w', id: 'a', w: 'r', ammo: 40 }]);
  assert.equal(R.pickup(B, p.n, 2).ok, false);
  A.ammo = 3;
  assert.equal(R.pickup(A, p.n, 11).ok, true);
  assert.equal(A.ammo, 40, 'refilled');
  assert.equal(R.pickup(C, p.n, 30).ok, false, 'too far');
  assert.deepEqual(R.pickups(12).find((q) => q.n === p.n), { n: p.n, at: 9000 });
});

test('strikes: mm always; a punch within reach; a ground kick outside a combo is a punch; punch punch kick', () => {
  const R = ref(), A = F('a', 60.5), B = F('b', 62.6);
  const s1 = R.strike(A, { k: 'k' }, 1, [A, B]);
  assert.deepEqual(s1.out[0], { t: 'mm', id: 'a', k: 'p' });
  assert.equal(s1.out[1].w, 'p');
  assert.equal(s1.out[1].d, 14);
  B.x = 62.6; B.at = 1.3;
  assert.equal(R.strike(A, { k: 'p' }, 1.3, [A, B]).out[0].k, 'p');
  B.x = 62.6; B.at = 1.6;
  const s3 = R.strike(A, { k: 'p' }, 1.6, [A, B]);
  assert.equal(s3.out[0].k, 'k', 'third of a combo');
  assert.equal(s3.out[1].d, 22);
  const air = F('c', 60.5); air.airAt = 9.95;
  assert.equal(R.strike(air, { k: 'k' }, 10, [air]).out[0].k, 'k', 'in the air');
  const far = F('d', 60.5), farB = F('e', 63.2);
  assert.equal(R.strike(far, { k: 'p' }, 20, [far, farB]).out.length, 1, 'out of reach: only mm');
});

test('a kick carries a target 11 ± 2 cells, a punch 5 ± 1.5 (the shared physics)', () => {
  const kinds = levelKind(L);
  const carry = (kind) => {
    const b = newBody(60.5, 27.5);
    for (let i = 0; i < 12; i++) stepBody(b, 1 / 60, {}, kinds);
    const { kx, ky, stun } = STRIKES[kind];
    knock(b, kx, -ky, stun);
    const x0 = b.x;
    for (let i = 0; i < 180; i++) stepBody(b, 1 / 60, {}, kinds);
    return b.x - x0;
  };
  assert.ok(Math.abs(carry('kick') - 11) <= 2, `kick ${carry('kick')}`);
  assert.ok(Math.abs(carry('punch') - 5) <= 1.5, `punch ${carry('punch')}`);
});

test('respawn: refused before 1.9 s; then sp at the spawn farthest from everyone alive, full hp, protected, deagle', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { alive: false, deadAt: 10, hp: 0 });
  assert.equal(R.respawn(B, 11, [A, B]).ok, false);
  const { ok, out } = R.respawn(B, 12, [A, B]);
  assert.equal(ok, true);
  const far = L.spawns.reduce((best, s) => (Math.hypot(s.x - 20.5, 2 * (s.y - 27.5)) > Math.hypot(best.x - 20.5, 2 * (best.y - 27.5)) ? s : best));
  assert.deepEqual(out, [{ t: 'sp', id: 'b', x: far.x, y: far.y }]);
  assert.equal(B.hp, 100);
  assert.ok(B.safeUntil > 13);
});

test('leaving within 3 s of a hit gives the hitter the kill (fled); after 3.1 s it does not', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { hitBy: 'a', hurtAt: 10 });
  assert.deepEqual(R.leave(B, 12.9, [A, B]), [{ t: 'k', id: 'b', by: 'a', kills: 1, fled: 1 }, { t: 'ax', id: 'b' }]);
  const C = F('c', 40);
  Object.assign(C, { hitBy: 'a', hurtAt: 10 });
  assert.deepEqual(R.leave(C, 13.1, [A, C]), [{ t: 'ax', id: 'c' }]);
});

test('firing or striking ends protection; firing while rolling is refused', () => {
  const R = ref(), A = F('a', 60.5);
  A.safeUntil = 5;
  shoot(R, A, 1, [A]);
  assert.equal(A.safeUntil, 0);
  const B = F('b', 70.5); B.safeUntil = 5;
  R.strike(B, { k: 'p' }, 1, [B]);
  assert.equal(B.safeUntil, 0);
  const C = F('c', 80.5); C.i = 32;
  assert.equal(shoot(R, C, 1, [C]).ok, false);
  assert.equal(R.strike(C, { k: 'p' }, 1, [C]).ok, false);
});

test('a shooter that pops keeps its bullets flying, and they can still kill', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  B.hp = 20; B.hurtAt = 0.9;
  shoot(R, A, 1, [A, B]);
  Object.assign(A, { alive: false, deadAt: 1.01 });
  const out = run(R, 1, 1.3, [A, B]);
  assert.deepEqual(out.find((m) => m.t === 'k'), { t: 'k', id: 'b', by: 'a', kills: 1 });
});

test('records survive a JSON round trip (Durable Object attachments)', () => {
  const A = newFighter('a', 3);
  assert.deepEqual(JSON.parse(JSON.stringify(A)), A);
});

test('referee.js uses no randomness or browser APIs of its own', () => {
  assert.doesNotMatch(fs.readFileSync(new URL('../src/referee.js', import.meta.url), 'utf8'), /Math\.random|window|document|performance|Date\.now/);
});

test('state: stores the state, marks air time, and opens a roll at its sent time but at most 150 ms back', () => {
  const R = ref(), A = F('a', 60.5);
  const s = { x: 61, y: 27, vx: 2, vy: -3, f: -1, g: 0, i: 32, a: 0.5 };
  R.state(A, s, 10, 9.95);
  assert.deepEqual([A.x, A.y, A.vx, A.vy, A.f, A.g, A.i, A.a, A.at, A.airAt, A.rollAt], [61, 27, 2, -3, -1, 0, 32, 0.5, 10, 10, 9.95]);
  R.state(A, { ...s, g: 1 }, 10.1, 10.1);
  assert.equal(A.rollAt, 9.95, 'still the same roll');
  assert.equal(A.airAt, 10);
  R.state(A, { ...s, i: 0 }, 10.2);
  assert.equal(A.rollAt, null);
  R.state(A, s, 11, 10);
  assert.equal(A.rollAt, 11 - 0.15, 'never more than 150 ms back');
});

test('enter keeps kills and resets the rest; view reports regen, safety and the gun', () => {
  const R = ref(), A = newFighter('a', 0);
  Object.assign(A, { kills: 3, hp: 10, hurtAt: 5, alive: false, gun: 'rifle', ammo: 4, hitBy: 'b' });
  assert.deepEqual(R.enter(A, 10), [{ t: 'aj', id: 'a', hp: 100, kills: 3 }]);
  assert.deepEqual([A.arena, A.hp, A.alive, A.safeUntil, A.gun, A.ammo, A.hitBy], [true, 100, true, 11.5, 'deagle', -1, null]);
  Object.assign(A, { hp: 40, hurtAt: 20 });
  assert.deepEqual(R.view(A, 25), { id: 'a', hp: 60, kills: 3, alive: 1, safe: 0, w: 'd', ammo: -1, x: 0, y: 0, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 });
  assert.equal(R.view(A, 11).safe, 1);
});

test('a claimed origin far from the muzzle estimate is replaced by the muzzle; bullet numbers wrap at 65536', () => {
  const R = ref(), A = F('a', 60.5);
  const m = muzzleOf(60.5, 27.5, 1, 0, 'deagle');
  assert.deepEqual(R.fire(A, { x: m.x + 2.9, y: m.y - 1.9, a: 0 }, 1, [A]).out[0], { t: 's', id: 'a', n: 0, x: Math.round((m.x + 2.9) * 100) / 100, y: Math.round((m.y - 1.9) * 100) / 100, a: 0, w: 'd' });
  const far = R.fire(A, { x: m.x + 3.5, y: m.y, a: 0 }, 1, [A]).out[0];
  assert.deepEqual([far.x, far.y, far.n], [Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100, 1]);
  const S = ref(), B = F('b', 60.5);
  let n;
  for (let k = 0; k < 65537; k++) { n = shoot(S, B, k, [B]).out[0].n; S.tick(k + 0.9, [B]); }
  assert.equal(n, 0);
});

test('a sprinting target cannot skip past a bullet in one tick: the sweep uses both motions', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 33);
  B.vx = -60; B.at = 1; // estimated from 33 to 27 while the bullet goes from 23.45 to 31.45
  shoot(R, A, 1, [A, B]);
  assert.ok(R.tick(1.1, [A, B]).some((m) => m.t === 'h'));
});

test('two fighters can pop each other at once: both kills count', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5, 27.5, -1);
  Object.assign(A, { hp: 10, hurtAt: 0.9 });
  Object.assign(B, { hp: 10, hurtAt: 0.9 });
  shoot(R, A, 1, [A, B]);
  shoot(R, B, 1, [A, B], Math.PI);
  const ks = run(R, 1, 1.3, [A, B]).filter((m) => m.t === 'k');
  assert.deepEqual(ks.map((k) => k.id).sort(), ['a', 'b']);
  assert.deepEqual([A.kills, B.kills], [1, 1]);
});

test('a strike skips the protected, the popped and a dodging target, and hits from the estimate', () => {
  const R = ref(), A = F('a', 60.5), P = F('p', 62), D = F('d', 62), X = F('x', 62), M = F('m', 60);
  P.safeUntil = 5; X.alive = false; D.rollAt = 0.9;
  M.vx = 40; M.at = 0.95; // estimated 2 cells on by now: in front of A
  const hs = R.strike(A, { k: 'p' }, 1, [A, P, D, X, M]).out.filter((m) => m.t === 'h');
  assert.deepEqual(hs.map((h) => [h.id, h.kx, h.ky]), [['m', 25, -10]]);
});
