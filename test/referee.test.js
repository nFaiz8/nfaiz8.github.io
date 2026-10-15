import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind, pickupSpots } from '../src/level.js';
import { createReferee, newFighter } from '../src/referee.js';
import { muzzleOf, bulletKnock, GUNS, STRIKES, PARRY_TIME, PARRY_PAD } from '../src/fight.js';
import { newBody, stepBody, knock } from '../src/arena.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const ref = () => createReferee({ level: L, rand: () => 0.5 });
// Standing on car A's floor (row 26, the train level): y 24.5.
const F = (id, x, y = 24.5, f = 1) => Object.assign(newFighter(id, 0), { arena: true, x, y, f, at: 0, safeUntil: 0 });
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

// The train's solid walls at body height are the lintels over the doorways (cols 96–97 and 104–105, rows
// 11–13): fighters at y 12.5 are level with them.
test('a ▓ lintel in the way stops the bullet', () => {
  const R = ref(), A = F('a', 86.5, 12.5), B = F('b', 101.5, 12.5);
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

test('bullets in flight: at most 6 deagle, 7 rifle, 1 sniper', () => {
  for (const [gun, max] of [['deagle', 6], ['rifle', 7], ['sniper', 1]]) {
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

test('pickups: taken, refused while gone, back after 10 s at a new spot, the same gun refills, too far is refused', () => {
  const R = ref(), p = R.pickups(0).find((q) => q.g === 'r');
  const A = F('a', p.x, p.y), B = F('b', p.x + 0.5, p.y);
  const r1 = R.pickup(A, p.n, 1).out;
  const q = R.pickups(1).find((x) => x.n === p.n);
  assert.deepEqual(r1, [{ t: 'pk', id: 'a', n: p.n, at: 10000, x: q.x, y: q.y }, { t: 'w', id: 'a', w: 'r', ammo: 40 }]);
  assert.ok(Math.hypot(q.x - p.x, 2 * (q.y - p.y)) >= 20, 'it comes back at least 20 cells away');
  assert.equal(R.pickup(B, p.n, 2).ok, false, 'gone');
  Object.assign(A, { x: q.x, y: q.y, ammo: 3 });
  assert.equal(R.pickup(A, p.n, 11).ok, true);
  assert.equal(A.ammo, 40, 'refilled');
  const q2 = R.pickups(11).find((x) => x.n === p.n), C = F('c', q2.x + 3, q2.y);
  assert.equal(R.pickup(C, p.n, 30).ok, false, 'too far');
  assert.deepEqual(R.pickups(12).find((x) => x.n === p.n), { n: p.n, at: 9000, x: q2.x, y: q2.y, g: 'r' });
});

test('pickups start at random standing spots, 20 apart and clear of the spawns; the medkit is the last', () => {
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const P = createReferee({ level: L, rand: () => r }).pickups(0), spots = pickupSpots(L);
    assert.deepEqual(P.map((q) => q.g), ['r', 'n', 'm']);
    for (const q of P) {
      assert.ok(spots.some((s) => s.x === q.x && s.y === q.y), `${q.g} on a standing spot`);
      assert.ok(L.spawns.every((s) => Math.hypot(s.x - q.x, 2 * (s.y - q.y)) >= 6), `${q.g} clear of the spawns`);
      for (const o of P) if (o !== q) assert.ok(Math.hypot(o.x - q.x, 2 * (o.y - q.y)) >= 20, `${q.g}–${o.g} apart`);
    }
  }
  // Every rand gives the same spot; a varying one spreads them.
  let k = 0;
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(createReferee({ level: L, rand: () => (k = (k * 7 + 3) % 11) / 11 }).pickups(0)[0].x);
  assert.ok(seen.size > 3, `the rifle turns up in ${seen.size} places`);
});

test('the medkit: refused at full health; heals 50 (capped at 100) with hl; gone 15 to 30 s; regen carries on', () => {
  const R = ref(), m = R.pickups(0).find((q) => q.g === 'm');
  const A = F('a', m.x, m.y);
  assert.equal(R.pickup(A, m.n, 1).ok, false, 'full health');
  Object.assign(A, { hp: 20, hurtAt: 0.5 });
  const { ok, out } = R.pickup(A, m.n, 1);
  assert.equal(ok, true);
  assert.deepEqual(out[1], { t: 'hl', id: 'a', hp: 70, d: 50 });
  assert.ok(out[0].at >= 15000 && out[0].at <= 30000, `back in ${out[0].at} ms`);
  assert.equal(A.hp, 70);
  // Hurt 10 s ago (regen running), at 50: regen gives 50 by now... it is already full: refused.
  const B = Object.assign(F('b', 0, 0), { hp: 10, hurtAt: 0 });
  const back = R.pickups(1).find((q) => q.n === m.n);
  Object.assign(B, { x: back.x, y: back.y });
  assert.equal(R.pickup(B, m.n, 40).ok, false, 'regen has filled it up');
  // Hurt 5 s ago: regen has given 20 (from 10 to 30); the medkit takes it to 80, and regen goes on from there.
  Object.assign(B, { hp: 10, hurtAt: 35 });
  assert.equal(R.pickup(B, m.n, 40).out[1].hp, 80);
  assert.equal(R.view(B, 40).hp, 80);
  assert.equal(R.view(B, 40.5).hp, 90, 'regen carries on at once');
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
    const b = newBody(60.5, 24.5);
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
  const far = L.spawns.reduce((best, s) => (Math.hypot(s.x - 20.5, 2 * (s.y - 24.5)) > Math.hypot(best.x - 20.5, 2 * (best.y - 24.5)) ? s : best));
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
  assert.deepEqual([A.arena, A.hp, A.alive, A.safeUntil, A.gun, A.ammo, A.hitBy], [true, 100, true, 13, 'deagle', -1, null]);
  Object.assign(A, { hp: 40, hurtAt: 20 });
  assert.deepEqual(R.view(A, 25), { id: 'a', hp: 60, kills: 3, alive: 1, safe: 0, w: 'd', ammo: -1, x: 0, y: 0, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 });
  assert.equal(R.view(A, 11).safe, 1);
});

test('a claimed origin far from the muzzle estimate is replaced by the muzzle; bullet numbers wrap at 65536', () => {
  const R = ref(), A = F('a', 60.5);
  const m = muzzleOf(60.5, 24.5, 1, 0, 'deagle');
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
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5, 24.5, -1);
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

test('fix 1: no shot starts past a lintel: a sniper flush against each face claims an origin 2.99 cells past its muzzle', () => {
  for (const [x, f] of [[95.6, 1], [98.4, -1], [103.6, 1], [106.4, -1]]) {
    const R = ref(), A = F('a', x, 12.5, f), B = F('b', x + 12 * f, 12.5);
    A.gun = 'sniper'; A.ammo = 5;
    const m = muzzleOf(A.x, A.y, f, 0, 'sniper');
    const { ok } = R.fire(A, { x: m.x + 2.99 * f, y: m.y, a: f > 0 ? 0 : Math.PI }, 1, [A, B]);
    assert.equal(ok, true);
    assert.equal(run(R, 1, 1.5, [A, B]).filter((h) => h.t === 'h').length, 0, `x ${x}`);
    assert.equal(R.live(), 0);
  }
});

test('fix 1: a deagle whose last state has a big vx cannot fire from where the estimate carries it past a lintel', () => {
  const R = ref(), A = F('a', 103.6, 12.5), B = F('b', 118.5, 12.5);
  A.vx = 60; // estimated 6 cells on, past car B's lintel, by now
  const m = muzzleOf(109.6, 12.5, 1, 0, 'deagle');
  R.fire(A, { x: m.x, y: m.y, a: 0 }, 1, [A, B]);
  assert.equal(run(R, 1, 1.5, [A, B]).filter((h) => h.t === 'h').length, 0);
});

test('fix 2: leaving twice (al, then the socket closing) gives one flee kill', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { hitBy: 'a', hurtAt: 10 });
  assert.equal(R.leave(B, 11, [A, B]).length, 2);
  assert.deepEqual(R.leave(B, 11.1, [A, B]), []);
  assert.equal(A.kills, 1);
  assert.equal(B.hitBy, null);
});

test('fix 3: a fighter popped mid-roll respawns, or re-enters, able to fire, and its next roll opens a dodge window', () => {
  for (const back of ['respawn', 'enter']) {
    const R = ref(), A = F('a', 60.5);
    Object.assign(A, { i: 32, rollAt: 0.5, alive: false, deadAt: 1, hp: 0 });
    if (back === 'respawn') R.respawn(A, 3, [A], { x: 60.5, y: 24.5 });
    else { R.leave(A, 3, [A]); R.enter(A, 3); A.safeUntil = 0; }
    assert.equal(A.i, 0, back);
    assert.equal(shoot(R, A, 4, [A]).ok, true, back);
    R.state(A, { x: 60.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 32, a: 0 }, 5);
    assert.equal(A.rollAt, 5, back);
  }
});

test('fix 3: a roll bit already on with no roll open opens one', () => {
  const R = ref(), A = F('a', 60.5);
  A.i = 32;
  R.state(A, { x: 60.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 32, a: 0 }, 2, 1.95);
  assert.equal(A.rollAt, 1.95);
});

test('fix 4: a living fighter never shows 0 hp, in h or view', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { hp: 25.3, hurtAt: 0.9 });
  shoot(R, A, 1, [A, B]);
  const h = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'h');
  assert.equal(B.alive, true);
  assert.equal(h.hp, 1);
  assert.equal(R.view(B, 1.3).hp, 1);
  Object.assign(B, { alive: false, hp: 0 });
  assert.equal(R.view(B, 9).hp, 0);
});

test('fix 5: a bullet adds its knock to a mid-air target\'s vy; a strike replaces it', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { vy: -20, g: 0, at: 1.3 }); // at in the future: the estimate holds B still
  shoot(R, A, 1, [A, B], 0.1);
  const h = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'h');
  const { ky } = bulletKnock('deagle', 0.1);
  assert.ok(ky > 0.4);
  assert.equal(B.vy, -20 + ky);
  assert.equal(h.ky, Math.round(ky * 10) / 10);
  const S = F('s', 60.5), T = F('t', 62.6);
  T.vy = -20;
  R.strike(S, { k: 'p' }, 2, [S, T]);
  assert.equal(T.vy, -STRIKES.punch.ky);
});

// ---- headshots (addendum §1): the hit point at the swept hit time, relative to the target's estimate ----

test('headshot: a level deagle bullet at the head row does 50 with hs: 1; knockback unchanged', () => {
  const R = ref(), A = F('a', 20.5, 23.5), B = F('b', 30.5); // the bullet flies at 23.2: 1.3 rows above B's centre
  shoot(R, A, 1, [A, B]);
  const h = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'h');
  assert.deepEqual({ ...h, n: undefined }, { t: 'h', id: 'b', by: 'a', w: 'd', n: undefined, d: 50, hp: 50, kx: 10, ky: 0, hs: 1 });
});

test('headshot: ×2 for the rifle (the smg) too (16)', () => {
  const R = ref(), A = F('a', 20.5, 23.5), B = F('b', 30.5);
  A.gun = 'rifle'; A.ammo = 40;
  shoot(R, A, 1, [A, B]);
  const h = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'h');
  assert.deepEqual([h.d, h.hp, h.hs], [16, 84, 1]);
});

test('a level bullet at the torso does 1× with no hs; melee never has hs', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5); // the bullet flies at 27.2: 0.3 rows above B's centre
  shoot(R, A, 1, [A, B]);
  const h = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'h');
  assert.equal(h.d, 25);
  assert.equal('hs' in h, false);
  const S = F('s', 60.5, 24.5), T = F('t', 62, 25.5); // T a row lower: S's punch reaches its head row
  const p = R.strike(S, { k: 'p' }, 2, [S, T]).out.find((m) => m.t === 'h');
  assert.equal(p.d, STRIKES.punch.damage);
  assert.equal('hs' in p, false);
});

test('a sniper headshot kills from 100 and its k carries hs: 1; a sniper body shot does not kill', () => {
  const R = ref(), A = F('a', 20.5, 23.5), B = F('b', 30.5);
  A.gun = 'sniper'; A.ammo = 5;
  shoot(R, A, 1, [A, B]);
  const out = run(R, 1, 1.3, [A, B]);
  const h = out.find((m) => m.t === 'h');
  assert.deepEqual([h.d, h.hp, h.hs], [140, 0, 1]);
  assert.deepEqual(out.find((m) => m.t === 'k'), { t: 'k', id: 'b', by: 'a', kills: 1, hs: 1 });
  const R2 = ref(), A2 = F('a', 20.5), B2 = F('b', 30.5);
  A2.gun = 'sniper'; A2.ammo = 5;
  shoot(R2, A2, 1, [A2, B2]);
  const out2 = run(R2, 1, 1.3, [A2, B2]);
  assert.deepEqual([out2.find((m) => m.t === 'h').d, B2.hp], [70, 30]);
  assert.equal(out2.some((m) => m.t === 'k'), false);
});

test('a body-shot k carries no hs', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { hp: 20, hurtAt: 0.9 });
  shoot(R, A, 1, [A, B]);
  const k = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'k');
  assert.equal('hs' in k, false);
});

test('a bullet coming straight down through the top of the box is a headshot (the point at the hit time, not the tick end)', () => {
  // A 9 rows above B, shoulder over B's centre, aiming straight down. One long tick carries the bullet to
  // the floor, past B's feet: only the point at the swept hit time is on B's head.
  const R = ref(), A = F('a', 30.35, 18.5), B = F('b', 30.5);
  const m = muzzleOf(A.x, A.y, 1, Math.PI / 2, 'deagle');
  assert.equal(R.fire(A, { x: m.x, y: m.y, a: Math.PI / 2 }, 1, [A, B]).ok, true);
  const h = R.tick(1.5, [A, B]).find((q) => q.t === 'h');
  assert.deepEqual([h.d, h.hs], [50, 1]);
});

test('a steep downward bullet entering through the top edge, off the centre line, is a headshot', () => {
  const R = ref(), A = F('a', 24.3, 15.5), B = F('b', 30.5), a = 1.2; // 9 rows above B
  const m = muzzleOf(A.x, A.y, 1, a, 'deagle');
  assert.equal(R.fire(A, { x: m.x, y: m.y, a }, 1, [A, B]).ok, true);
  const h = R.tick(1.5, [A, B]).find((q) => q.t === 'h'); // one long tick, as above
  assert.deepEqual([h.d, h.hs], [50, 1]);
});

test('a roll still dodges a bullet at the head row', () => {
  const at = (rollOffset) => {
    const R = ref(), A = F('a', 20.5, 23.5), B = F('b', 30.5);
    shoot(R, A, 1, [A, B]);
    B.rollAt = 1.082 - rollOffset;
    return run(R, 1, 1.3, [A, B]).some((m) => m.t === 'h');
  };
  assert.equal(at(0.1), false);
  assert.equal(at(0.3), true);
});

// Final review, Important 2: the roll rate. A roll opens a dodge window only once the cooldown (less a
// little jitter) has passed since the last open roll ended: its bit going off, or its length, if sooner.
const rollState = (i) => ({ x: 60.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i, a: 0 });
const dodgeShare = (pattern, seconds = 10, dt = 1 / 60, back = 0) => {
  const R = ref(), A = F('a', 60.5);
  let inside = 0, n = 0;
  for (let t = 1; t < 1 + seconds; t += dt, n++) {
    const on = pattern(t - 1);
    R.state(A, rollState(on ? 32 : 0), t, on ? t : t - back); // back: the bit going off claimed as sent earlier
    if (A.rollAt != null && t - A.rollAt >= 0.04 && t - A.rollAt <= 0.26) inside++;
  }
  return inside / n;
};

test('a roll started too soon after the last one opens no dodge window', () => {
  const R = ref(), A = F('a', 60.5);
  R.state(A, rollState(32), 1, 1);
  assert.equal(A.rollAt, 1);
  R.state(A, rollState(0), 1.3, 1.3);
  R.state(A, rollState(32), 1.4, 1.4); // 0.1 s after the last roll ended
  assert.equal(A.rollAt, null, 'too soon: no roll opened');
  R.state(A, rollState(32), 1.5, 1.5);
  assert.equal(A.rollAt, null, 'the same early roll, still held: still none');
  // A shot reaching A inside where that roll's dodge window would be hits.
  const S = F('s', 50.5);
  shoot(R, S, 1.45, [S, A]);
  assert.ok(run(R, 1.45, 1.7, [S, A]).some((m) => m.t === 'h' && m.id === 'a'));
  R.state(A, rollState(0), 1.7, 1.7);
  R.state(A, rollState(32), 1.75, 1.75); // 0.45 s after the last roll that dodged ended (1.3)
  assert.equal(A.rollAt, 1.75);
});

test('toggling the roll bit (0.25 s on, a frame off) dodges no more of the time than honest rolling', () => {
  const toggle = (t) => t % (0.25 + 1 / 60) < 0.25;
  const cheat = dodgeShare(toggle), backdated = dodgeShare(toggle, 10, 1 / 60, 0.15);
  const honest = dodgeShare((t) => t % 0.8 < 0.3); // rolls back to back at the real cooldown
  assert.ok(honest > 0.25, `honest ${honest}`);
  assert.ok(cheat <= 0.3 / 0.7, `cheat ${cheat}`);
  assert.ok(backdated <= 0.3 / 0.7, `backdated ${backdated}`);
});

test('rolling back to back at the real cooldown opens every roll\'s dodge window, at 60 and 30 fps and with jittery arrival', () => {
  const kinds = levelKind(L);
  for (const [dt, jitter] of [[1 / 60, 0], [1 / 30, 0], [1 / 60, 0.14]]) {
    const R = ref(), A = F('a', 60.5), b = newBody(60.5, 24.5);
    for (let i = 0; i < 30; i++) stepBody(b, dt, {}, kinds); // settle onto the floor
    let dir = 1, rolls = 0, opened = 0, k = 0;
    for (let t = 1; t < 9; t += dt, k++) {
      const was = b.rollT >= 0;
      stepBody(b, dt, { roll: dir }, kinds);
      const on = b.rollT >= 0;
      if (on && !was) { rolls++; dir = -dir; }
      const before = A.rollAt;
      // Arrives 0 to jitter s after it was sent, stamped with its sent time.
      R.state(A, { ...rollState(on ? 32 : 0), x: b.x, y: b.y }, t + jitter * ((k * 7) % 10) / 10, t);
      if (A.rollAt != null && A.rollAt !== before) opened++;
    }
    assert.ok(rolls >= 9, `rolls ${rolls}`);
    assert.equal(opened, rolls, `dt ${dt}, jitter ${jitter}`);
  }
});

test('a roll ended by a jump after 0.1 s, then a new roll 0.5 s after that end, gets its dodge window', () => {
  const R = ref(), A = F('a', 60.5);
  R.state(A, rollState(32), 1, 1);
  assert.equal(A.rollAt, 1);
  R.state(A, { ...rollState(0), g: 0, vy: -40 }, 1.1, 1.1); // the jump out of the roll ends it
  for (let t = 1.2; t < 1.55; t += 0.1) R.state(A, { ...rollState(0), g: 0 }, t, t); // in the air
  R.state(A, rollState(0), 1.55, 1.55); // landed
  R.state(A, rollState(32), 1.6, 1.6);
  assert.equal(A.rollAt, 1.6, 'opened at its start');
  const S = F('s', 50.5);
  shoot(R, S, 1.6, [S, A]); // reaches A about 0.08 s into the roll: dodged
  assert.ok(!run(R, 1.6, 1.85, [S, A]).some((m) => m.t === 'h'));
});

test('a roll held past its length ends there: the next may open 0.4 s after that, not after the bit goes off', () => {
  const R = ref(), A = F('a', 60.5);
  R.state(A, rollState(32), 1, 1);
  R.state(A, rollState(32), 1.5, 1.5); // held on long after the 0.3 s roll
  R.state(A, rollState(0), 1.6, 1.6);
  R.state(A, rollState(32), 1.7, 1.7); // 0.4 s after 1.3, its end
  assert.equal(A.rollAt, 1.7);
});

// Crouch and crawl (docs/specs/2026-10-14-arena-crouch.md §2–§4): the stance comes from the state's bits.
const lowShoot = (R, A, now, all, low) => { const m = muzzleOf(A.x, A.y, A.f, 0, A.gun, low); return R.fire(A, { x: m.x, y: m.y, a: 0 }, now, all); };

test('crouch: a standing level shot passes over a croucher and over someone prone; a crouched one hits', () => {
  for (const i of [64, 128]) {
    const R = ref(), A = F('a', 20.5), B = Object.assign(F('b', 30.5), { i });
    shoot(R, A, 1, [A, B]);
    assert.equal(run(R, 1, 2, [A, B]).filter((m) => m.t === 'h').length, 0, `over i ${i}`);
    const C = Object.assign(F('c', 20.5), { i: 64 });
    lowShoot(R, C, 3, [C, B], 1);
    const h = run(R, 3, 4, [C, B]).find((m) => m.t === 'h');
    assert.ok(h, `a crouched shot hits i ${i}`);
    assert.equal(h.hs, undefined, 'in the body');
  }
});

test('crouch: half the knock and lo: 1 for a body hit low, by a bullet or a strike; none standing', () => {
  const R = ref(), A = Object.assign(F('a', 20.5), { i: 64 }), B = Object.assign(F('b', 30.5), { i: 64 });
  lowShoot(R, A, 1, [A, B], 1);
  const h = run(R, 1, 2, [A, B]).find((m) => m.t === 'h');
  assert.deepEqual([h.kx, h.ky, h.lo], [5, 0, 1]);
  const P = F('p', 20.5), T = Object.assign(F('t', 22), { i: 128 });
  const s = R.strike(P, { k: 'p' }, 5, [P, T]).out.find((m) => m.t === 'h');
  assert.deepEqual([s.kx, s.ky, s.lo], [STRIKES.punch.kx / 2, -STRIKES.punch.ky / 2, 1]);
  const U = F('u', 22);
  const s2 = R.strike(P, { k: 'p' }, 6, [P, U]).out.find((m) => m.t === 'h');
  assert.equal(s2.lo, undefined);
  assert.equal(s2.kx, STRIKES.punch.kx);
});

test('crouch: a shot fired low flies 1.5× as far and s carries l: 1; a standing one has no l', () => {
  // Car A's open floor: a target ~80 cells away, past the rifle's 63 but within 94.5 (the deagle's is unlimited).
  const far = (i, low) => {
    const R = ref(), A = Object.assign(F('a', 20.5), { i, gun: 'rifle', ammo: 40 }), B = Object.assign(F('b', 20.5 + 80), { i: 64 });
    const r = lowShoot(R, A, 1, [A, B], low);
    return { s: r.out[0], len: R.bullets[0].len };
  };
  const lo = far(64, 1), up = far(0, 0);
  assert.equal(lo.s.l, 1);
  assert.equal(up.s.l, undefined);
  assert.ok(up.len <= 63 + 1e-9);
  assert.ok(lo.len > 63, `the low shot runs ${lo.len}`);
});

test('crouch: the bits count only on the ground and not rolling; a prone body\'s head is its front', () => {
  const R = ref(), A = Object.assign(F('a', 20.5), { i: 64, g: 0 }), B = F('b', 30.5);
  const m = muzzleOf(A.x, A.y, A.f, 0, A.gun, 1); // claimed from a crouch, but in the air: from too low?
  const r = R.fire(A, { x: m.x, y: m.y, a: 0 }, 1, [A, B]);
  assert.equal(r.out[0].l, undefined, 'in the air: standing range');
  // A prone target facing the shooter: its front is toward the shot, so a hit from a prone shooter is to the head.
  const R2 = ref(), S = Object.assign(F('s', 20.5), { i: 128 }), T = Object.assign(F('t', 30.5, 24.5, -1), { i: 128 });
  lowShoot(R2, S, 1, [S, T], 2);
  const h = run(R2, 1, 2, [S, T]).find((q) => q.t === 'h');
  assert.equal(h.hs, 1, 'facing it: the head');
  const R3 = ref(), S3 = Object.assign(F('s', 20.5), { i: 128 }), T3 = Object.assign(F('t', 30.5, 24.5, 1), { i: 128 });
  lowShoot(R3, S3, 1, [S3, T3], 2);
  assert.equal(run(R3, 1, 2, [S3, T3]).find((q) => q.t === 'h').hs, undefined, 'facing away: the feet');
});

// Parry (parry addendum §1). A sniper at 20.5 fires level at B at 60.5, who faces it: the round meets B's
// punch box (x 57.9–59.7 for a punch facing -1) about 0.16 s after it was fired.
const sniperAt = (id, x, f = 1) => Object.assign(F(id, x, 24.5, f), { gun: 'sniper', ammo: 5 });
function parryRun({ strikeAt = 1.05, f = -1, gun = 'sniper', kind = 'p', to = 1.8 } = {}) {
  const R = ref(), A = sniperAt('a', 20.5), B = F('b', 60.5, 24.5, f);
  if (gun !== 'sniper') { A.gun = gun; A.ammo = GUNS[gun].ammo; }
  const all = [A, B];
  const s = shoot(R, A, 1, all).out[0];
  const out = [...run(R, 1, strikeAt - 0.001, all)];
  if (kind) out.push(...R.strike(B, { k: kind }, strikeAt, all).out);
  out.push(...run(R, strikeAt, to, all));
  return { R, A, B, s, out };
}

test('parry: a punch facing a sniper round within 0.28 s sends it back; it hits the shooter, by the parrier, with pr: 1', () => {
  const { A, B, s, out } = parryRun();
  const pr = out.find((m) => m.t === 'pr');
  assert.ok(pr, 'pr sent');
  assert.equal(pr.id, 'b');
  assert.equal(pr.n, s.n);
  assert.notEqual(pr.n2, s.n);
  assert.equal(pr.w, 'n');
  assert.ok(Math.abs(Math.abs(pr.a) - Math.PI) < 0.01, `straight back: ${pr.a}`);
  assert.ok(pr.x > 57.5 && pr.x < 60, `met the box: ${pr.x}`);
  const hs = out.filter((m) => m.t === 'h');
  assert.equal(hs.filter((h) => h.id === 'b').length, 0, 'the parrier is not hit');
  const back = hs.find((h) => h.id === 'a');
  assert.ok(back, 'the shooter is hit by their own round');
  assert.equal(back.by, 'b');
  assert.equal(back.n, pr.n2);
  assert.equal(back.w, 'n');
  assert.equal(back.pr, 1);
  assert.equal(back.d, 70);
  assert.ok(back.kx < 0, 'knocked back the way the round flies');
  assert.equal(B.hp, 100);
  assert.equal(A.hp, 30);
});

test('parry: a strike thrown too early, or facing away, is no parry; the round hits', () => {
  for (const o of [{ strikeAt: 0.8 }, { strikeAt: 1.05, f: 1 }]) {
    const { out } = parryRun(o);
    assert.equal(out.filter((m) => m.t === 'pr').length, 0, JSON.stringify(o));
    const h = out.find((m) => m.t === 'h' && m.id === 'b');
    assert.ok(h, JSON.stringify(o));
    assert.equal(h.pr, undefined);
  }
});

test('parry: a little easier: a strike 0.25 s before the round arrives still parries, and the box is grown by 0.6', () => {
  assert.equal(PARRY_TIME, 0.28);
  assert.equal(PARRY_PAD, 0.6);
  assert.ok(PARRY_TIME < STRIKES.punch.cooldown, 'mashing can\'t hold a parry up');
  assert.equal(parryRun({ strikeAt: 0.88 }).out.filter((m) => m.t === 'pr').length, 1, 'too early before');
  // The bare punch box's near edge is 58.3; the grown one's 57.7, met first.
  const pr = parryRun({ strikeAt: 1.0 }).out.find((m) => m.t === 'pr');
  assert.ok(pr.x > 57.5 && pr.x < 58, `met the grown box: ${pr.x}`);
});

test('parry: a kick parries too; no strike, no parry', () => {
  assert.equal(parryRun({ kind: 'k' }).out.filter((m) => m.t === 'pr').length, 1);
  assert.equal(parryRun({ kind: null }).out.filter((m) => m.t === 'pr').length, 0);
});

test('parry: deagle and rifle rounds are never parried', () => {
  for (const gun of ['deagle', 'rifle']) {
    const { out } = parryRun({ gun, strikeAt: 1.2 });
    assert.equal(out.filter((m) => m.t === 'pr').length, 0, gun);
    assert.ok(out.some((m) => m.t === 'h' && m.id === 'b'), gun);
  }
});

test('parry: a kill by a parried round is the parrier\'s, and its k carries pr: 1', () => {
  const R = ref(), A = sniperAt('a', 20.5), B = F('b', 60.5, 24.5, -1);
  A.hp = 50; A.hurtAt = 0.9;
  const all = [A, B];
  shoot(R, A, 1, all);
  const out = [...run(R, 1, 1.04, all), ...R.strike(B, { k: 'p' }, 1.05, all).out, ...run(R, 1.05, 1.8, all)];
  assert.deepEqual(out.find((m) => m.t === 'k'), { t: 'k', id: 'a', by: 'b', kills: 1, pr: 1 });
  assert.equal(B.kills, 1);
});

test('parry: the round sent back does not count against the parrier\'s in-flight cap', () => {
  const R = ref(), A = sniperAt('a', 20.5), B = sniperAt('b', 60.5, -1);
  const all = [A, B];
  shoot(R, A, 1, all);
  run(R, 1, 1.04, all);
  R.strike(B, { k: 'p' }, 1.05, all);
  const out = run(R, 1.05, 1.2, all);
  assert.ok(out.some((m) => m.t === 'pr'));
  assert.equal(R.bullets.filter((b) => b.owner === 'b').length, 1, 'the parried round is b\'s now');
  assert.equal(shoot(R, B, 1.21, all).ok, true, 'b can still fire its own sniper');
});

test('parry: the shooter can parry it back, and then it is theirs again', () => {
  const R = ref(), A = sniperAt('a', 20.5), B = F('b', 60.5, 24.5, -1);
  const all = [A, B];
  shoot(R, A, 1, all);
  const out = [...run(R, 1, 1.04, all), ...R.strike(B, { k: 'p' }, 1.05, all).out, ...run(R, 1.05, 1.24, all)];
  out.push(...R.strike(A, { k: 'p' }, 1.25, all).out, ...run(R, 1.25, 2, all));
  const prs = out.filter((m) => m.t === 'pr');
  assert.deepEqual(prs.map((m) => m.id), ['b', 'a']);
  assert.ok(Math.abs(prs[1].a) < 0.01, 'back toward b');
  const h = out.find((m) => m.t === 'h');
  assert.equal(h.id, 'b');
  assert.equal(h.by, 'a');
});
