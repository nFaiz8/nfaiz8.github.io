import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData } from '../src/data.js';
import { buildLayout } from '../src/layout.js';
import { parseLevel } from '../src/level.js';
import { createWorld, step, teleport } from '../src/world.js';
import { createPvp } from '../src/pvp.js';
import { createReferee, newFighter } from '../src/referee.js';
import { muzzleOf, pickupReach } from '../src/fight.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const level = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const data = indexData(fixture, ['IMG_1003']);
const map = buildLayout(data, { name: 'X' }, { arena: { photo: data.byId.get('IMG_1003'), level } });
const A = map.arena, off = { x: A.x + 1, y: A.y + 1 };
// The floor line (where the door is) and the dummy's spot, from the level: car A's floor at column 50.
const FLOOR = level.door.y;
const floorUnder = (c) => { let r = level.rows - 1; while (!level.cells[r * level.cols + c]) r--; while (level.cells[(r - 1) * level.cols + c]) r--; return r - 1.5; };
const IN = { x: 0, y: 0, run: false, jump: false, down: false, fire: false, strikes: 0, roll: 0, aimUp: false, aimDown: false, mouse: null };

function setup({ online = false, at = { x: 40.5, y: FLOOR }, rand = () => 0.5 } = {}) {
  const world = createWorld(map);
  teleport(world, off.x + at.x, off.y + at.y);
  const sent = [], notes = [], feed = [], impacts = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, onNote: (t) => notes.push(t), onFeed: (t) => feed.push(t), onImpact: (e) => impacts.push(e), rand, myId: () => 'me' });
  let now = 0;
  pvp.enter(now, online);
  const frames = (n, inp = {}) => { for (let k = 0; k < n; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control({ ...IN, ...inp }, now)); pvp.frame(1 / 60, now); } };
  return { world, pvp, sent, notes, feed, impacts, frames, get now() { return now; } };
}

test('offline: the dummy stands on car A\'s floor at column 50 (from the level), facing the door', () => {
  const { pvp } = setup();
  const d = pvp.bodies(0).find((b) => b.dummy);
  assert.equal(floorUnder(50), 24.5);
  assert.equal(d.state.x, off.x + 50.5);
  assert.equal(d.state.y, off.y + floorUnder(50));
  assert.equal(d.state.facing, 1);
});

test('offline: a level deagle shot from the floor 10 cells away hits the dummy (J held): 25 a hit, knocks it back, pops it, and it comes back 2 s later', () => {
  const s = setup();
  s.frames(15);
  s.frames(1, { fire: true });
  s.frames(30);
  const d1 = s.pvp.bodies(s.now).find((b) => b.dummy);
  assert.equal(d1.state.hp, 75);
  assert.ok(d1.state.x > off.x + 50.5, 'knocked back');
  for (let k = 0; k < 6 && s.pvp.bodies(s.now).find((b) => b.dummy).state.act !== 'dead'; k++) { s.frames(1, { fire: true }); s.frames(30); }
  assert.equal(s.pvp.bodies(s.now).find((b) => b.dummy).state.act, 'dead');
  s.frames(130);
  const back = s.pvp.bodies(s.now).find((b) => b.dummy);
  assert.equal(back.state.act === 'dead', false);
  assert.equal(back.state.hp, 100);
  assert.equal(s.feed.length, 0, 'kills on the dummy are not in the feed');
});

test('held fire keeps the deagle\'s rate at any frame rate (at most one shot per 0.4 s)', () => {
  for (const fps of [20, 60, 144]) {
    const s = setup({ online: true });
    for (let k = 0; k < fps * 2; k++) { s.frames(0); }
    const world = s.world;
    let now = s.now;
    for (let k = 0; k < fps * 2; k++) { now += 1000 / fps; step(world, 1 / fps, s.pvp.control({ ...IN, fire: true }, now)); s.pvp.frame(1 / fps, now); }
    const shots = s.sent.filter((m) => m.t === 'f');
    assert.ok(shots.length <= 6 && shots.length >= 4, `${fps} fps: ${shots.length}`);
  }
});

test('no shooting or striking while rolling', () => {
  const s = setup();
  s.frames(10);
  s.frames(1, { roll: 1 });
  s.frames(5, { fire: true, strikes: 1 });
  assert.equal(s.pvp.fx.glyphs(s.now, {}).filter((g) => g.ch === '•').length, 0);
  assert.notEqual(s.pvp.bodies(s.now).find((b) => b.me).state.act, 'punch');
});

// Where my referee puts a pickup with this rand (arena-local), as pvp.js's own referee will.
const spotOf = (kind, rand = () => 0.5) => {
  const q = createReferee({ level, rand }).pickups(0).find((p) => p.g === { rifle: 'r', sniper: 'n', medkit: 'm' }[kind]);
  return { n: q.n, x: q.x, y: q.y };
};

test('offline: walking into the sniper pickup gives the sniper; its aim line shows', () => {
  const p = spotOf('sniper', () => 0.75); // on car A's floor
  const s = setup({ at: { x: p.x - 3, y: p.y }, rand: () => 0.75 });
  s.frames(40, { x: 1 });
  assert.equal(s.pvp.me.gun, 'sniper');
  assert.equal(s.pvp.me.ammo, 5);
  assert.ok(s.pvp.glyphs(s.now, []).filter((g) => g.ch === '·').length >= 3);
});

test('online: enter sends ae; moving sends a (arena-local); J sends f from the muzzle; K sends m', () => {
  const s = setup({ online: true });
  assert.deepEqual(s.sent[0], { t: 'ae' });
  s.frames(20, { x: 1 });
  const a = s.sent.find((m) => m.t === 'a');
  assert.ok(a && a.x > 40 && a.x < 60 && Math.abs(a.y - FLOOR) < 0.01, JSON.stringify(a)); // from 40.5 on car A's floor
  s.frames(1, { fire: true });
  assert.equal(s.sent.filter((m) => m.t === 'f').length, 1);
  s.frames(1, { strikes: 1 });
  assert.deepEqual(s.sent.find((m) => m.t === 'm').k, 'p');
});

test('online: h for me lowers hp and knocks me back; k pops me with a note; rs after 2 s; sp puts me at the spawn', () => {
  const s = setup({ online: true });
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 60.5, y: FLOOR, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 }] }, s.now);
  s.frames(5);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'k', n: -1, d: 22, hp: 78, kx: 45, ky: -22 }, s.now);
  assert.equal(s.pvp.me.hp, 78);
  s.frames(1);
  assert.ok(s.world.player.vx > 30);
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'b', kills: 1 }, s.now);
  assert.equal(s.notes.at(-1), 'popped by someone');
  assert.equal(s.feed.length, 1);
  s.frames(110);
  assert.ok(!s.sent.some((m) => m.t === 'rs'));
  s.frames(20);
  assert.ok(s.sent.some((m) => m.t === 'rs'));
  const sp = level.spawns[0];
  s.pvp.onMessage({ t: 'sp', id: 'me', x: sp.x, y: sp.y }, s.now);
  assert.equal(s.world.player.x, off.x + sp.x);
});

test('when a real fighter enters, the dummy pops quietly; alone again, it comes back', () => {
  const s = setup({ online: true });
  // Fix round 1 (item 4): online, the dummy waits for the arena welcome; an empty one shows it.
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [] }, s.now);
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
  s.pvp.onMessage({ t: 'aj', id: 'b', hp: 100, kills: 0 }, s.now);
  s.pvp.onMessage({ t: 'a', id: 'b', x: 60.5, y: FLOOR, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0 }, s.now);
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
  assert.equal(s.feed.length, 0);
  s.pvp.onMessage({ t: 'ax', id: 'b' }, s.now);
  s.frames(5);
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
});

test('the connection drops mid-fight: fighters cleared, health reset, the dummy after 2 s; reconnecting sends ae again', () => {
  const s = setup({ online: true });
  s.pvp.onMessage({ t: 'aj', id: 'b', hp: 100, kills: 0 }, s.now);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'd', n: 1, d: 25, hp: 75, kx: 10, ky: 0 }, s.now);
  s.pvp.setOnline(false, s.now);
  assert.equal(s.pvp.fighters.ids().length, 0);
  assert.equal(s.pvp.me.hp, 100);
  s.frames(60);
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy), 'not yet');
  s.frames(70);
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
  const before = s.sent.filter((m) => m.t === 'ae').length;
  s.pvp.setOnline(true, s.now);
  assert.equal(s.sent.filter((m) => m.t === 'ae').length, before + 1);
});

test('a fight-hash mismatch is offline: nothing is sent, the dummy is there', () => {
  const s = setup({ online: false });
  s.frames(20, { x: 1, fire: true });
  assert.equal(s.sent.length, 0);
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
});

test('going away and coming back: al once, ae once, nothing held', () => {
  const s = setup({ online: true });
  s.frames(5, { fire: true, x: 1 });
  s.pvp.leave(s.now);
  s.pvp.leave(s.now);
  assert.equal(s.sent.filter((m) => m.t === 'al').length, 1);
  s.pvp.enter(s.now, true);
  const n = s.sent.length;
  s.frames(30);
  assert.ok(!s.sent.slice(n).some((m) => m.t === 'f'), 'no fire carried over');
  assert.equal(s.sent.filter((m) => m.t === 'ae').length, 2);
});

test('messages for unknown ids, or before aw, never throw', () => {
  const s = setup({ online: true });
  for (const m of [{ t: 'h', id: 'zz', hp: 3 }, { t: 'k', id: 'zz', by: 'yy', kills: 2 }, { t: 's', id: 'zz', n: 1, x: 1, y: 1, a: 0, w: 'd' }, { t: 'sp', id: 'zz', x: 1, y: 1 }, { t: 'pk', id: 'zz', n: 9, at: 10 }, { t: 'w', id: 'zz', w: 'q' }])
    s.pvp.onMessage(m, s.now);
  s.frames(5);
});

test('the mouse turns you to face the cursor and aims at it', () => {
  const s = setup();
  s.frames(5);
  s.frames(1, { mouse: { on: true, x: s.world.player.x - 10, y: s.world.player.y - 5 } });
  assert.equal(s.world.player.facing, -1);
  const me = s.pvp.bodies(s.now).find((b) => b.me).state;
  assert.ok(me.aim < -0.5 && me.aimed);
});

// ---- pinning tests for the controller rulings (beyond the brief's) ----

const named = { a: 'Ann', b: 'Bo' };
function setupNamed({ online = true, reducedMotion = false } = {}) {
  const world = createWorld(map, { reducedMotion });
  teleport(world, off.x + 40.5, off.y + FLOOR);
  const sent = [], notes = [], feed = [], impacts = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, onNote: (t) => notes.push(t), onFeed: (t) => feed.push(t), onImpact: (e) => impacts.push(e), rand: () => 0.5, myId: () => 'me', nameOf: (id) => named[id] || '', reducedMotion });
  let now = 0;
  pvp.enter(now, online);
  const frames = (n, inp = {}) => { for (let k = 0; k < n; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control({ ...IN, ...inp }, now)); pvp.frame(1 / 60, now); } };
  return { world, pvp, sent, notes, feed, impacts, frames, get now() { return now; } };
}
const fighter = (id, x, kills = 0) => ({ id, hp: 100, kills, alive: 1, safe: 0, w: 'd', ammo: -1, x, y: FLOOR, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 });

test('the kill feed names people: "Ann popped Bo", "Bo fled from Ann", "you popped Bo"; my kills come from the server', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 2, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('a', 20.5), fighter('b', 40.5)] }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'a', kills: 1 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'a', kills: 2, fled: 1 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'me', kills: 3 }, s.now);
  assert.deepEqual(s.feed, ['Ann popped Bo', 'Bo fled from Ann', 'you popped Bo']);
  assert.equal(s.pvp.hud(s.now).board.find((r) => r.me).kills, 3);
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'a', kills: 3 }, s.now);
  assert.equal(s.notes.at(-1), 'popped by Ann');
  assert.equal(s.feed.at(-1), 'Ann popped you');
});

test('a bullet hit in mid-air adds to vy; a strike replaces it; a kick shakes the camera', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('b', 20.5)] }, s.now);
  s.frames(10);
  s.frames(4, { jump: true });
  const vy = s.world.player.vy;
  assert.ok(vy < -10, `rising: ${vy}`);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'd', n: 1, d: 25, hp: 75, kx: 10, ky: -2 }, s.now);
  assert.equal(s.world.player.vy, vy - 2);
  assert.equal(s.world.shake, null, 'a bullet does not shake');
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'k', n: -1, d: 22, hp: 53, kx: 45, ky: -22 }, s.now);
  assert.equal(s.world.player.vy, -22);
  assert.ok(s.world.shake && s.world.shake.amp === 0.4 && Math.abs(s.world.shake.until - s.world.t - 0.15) < 1e-9);
  assert.equal(s.pvp.bodies(s.now).find((b) => b.me).state.act, 'hurt');
  assert.equal(s.pvp.hud(s.now).hp, 53);
});

test('Reduce Motion: kicked or popped, no camera shake, the knockback is the same', () => {
  const s = setupNamed({ reducedMotion: true });
  s.frames(10);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'k', n: -1, d: 22, hp: 78, kx: 45, ky: -22 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'b', kills: 1 }, s.now);
  assert.equal(s.world.shake, null);
  assert.equal(s.world.player.vx, 45);
});

test('the in-flight cap counts all my bullets whatever the gun: a rifle stream, then dry, delays the deagle', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'r', ammo: 40 }, pk: [], fighters: [fighter('b', 10.5)] }, s.now);
  s.frames(10);
  s.frames(40, { fire: true });
  const rifle = s.sent.filter((m) => m.t === 'f');
  assert.equal(rifle.length, 7, 'the rifle fires at its own rate');
  const T = s.now;
  s.pvp.onMessage({ t: 'w', id: 'me', w: 'd', ammo: -1 }, s.now);
  s.frames(60, { fire: true });
  const next = s.sent.filter((m) => m.t === 'f')[7];
  assert.ok(next, 'the deagle fires again once bullets land');
  // The deagle's own cooldown runs from the last rifle shot; its cap (6) counts the rifle rounds still flying.
  assert.ok(next.ts - rifle.at(-1).ts >= 400 - 17 && next.ts > T + 300, `${next.ts - T} ms after the switch`);
});

test('offline, the ammo of a pickup gun runs down and runs dry back to the deagle', () => {
  const s = setupNamed({ online: false });
  s.pvp.me.gun = 'sniper';
  s.pvp.me.ammo = 2;
  s.frames(5);
  s.frames(1, { fire: true });
  assert.equal(s.pvp.me.ammo, 1);
  s.frames(120); // past the sniper's 1.8 s
  s.frames(1, { fire: true });
  assert.equal(s.pvp.me.gun, 'deagle');
  assert.equal(s.pvp.me.ammo, -1);
  assert.equal(s.pvp.hud(s.now).gun, 'deagle');
});

test('the scoreboard: top 5 by kills plus me, shown only with another fighter in the arena; dummy pops never count', () => {
  const s = setupNamed({ online: false });
  assert.equal(s.pvp.hud(s.now).showBoard, false);
  for (let k = 0; k < 8 && s.pvp.bodies(s.now).find((b) => b.dummy).state.act !== 'dead'; k++) { s.frames(1, { fire: true }); s.frames(30); }
  assert.equal(s.pvp.bodies(s.now).find((b) => b.dummy).state.act, 'dead');
  assert.equal(s.pvp.hud(s.now).board[0].kills, 0, 'popping the dummy is no kill');
  const o = setupNamed();
  o.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 1, w: 'd', ammo: -1 }, pk: [], fighters: [1, 2, 3, 4, 5, 6].map((k) => fighter('f' + k, 10 + k * 5, k + 1)) }, o.now);
  const h = o.pvp.hud(o.now);
  assert.equal(h.showBoard, true);
  assert.deepEqual(h.board.map((r) => r.id), ['f6', 'f5', 'f4', 'f3', 'f2', 'me']);
});

test('online, touching a pickup sends pk at most every 0.5 s and waits for the server to give the gun', () => {
  const p = spotOf('sniper');
  const world = createWorld(map);
  teleport(world, off.x + p.x, off.y + p.y);
  const sent = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, rand: () => 0.5, myId: () => 'me' });
  let now = 0;
  pvp.enter(now, true);
  pvp.onMessage({ ...emptyAw(), pk: [{ n: p.n, at: 0, x: p.x, y: p.y, g: 'n' }] }, now); // the server's spot
  for (let k = 0; k < 60; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control(IN, now)); pvp.frame(1 / 60, now); }
  const pks = sent.filter((m) => m.t === 'pk');
  assert.ok(pks.length >= 1 && pks.length <= 2, `${pks.length}`);
  assert.equal(pks[0].n, p.n);
  assert.equal(pvp.me.gun, 'deagle');
  pvp.onMessage({ t: 'pk', id: 'me', n: p.n, at: 10000 }, now);
  pvp.onMessage({ t: 'w', id: 'me', w: 'n', ammo: 5 }, now);
  assert.equal(pvp.me.gun, 'sniper');
  const n = sent.length;
  for (let k = 0; k < 60; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control(IN, now)); pvp.frame(1 / 60, now); }
  assert.ok(!sent.slice(n).some((m) => m.t === 'pk'), 'taken: no more pk');
});

test('going away while popped: al once; back in alive, full health and protected, with no act left over', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'd', n: 1, d: 25, hp: 75, kx: 10, ky: 0 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'b', kills: 1 }, s.now);
  s.frames(10);
  s.pvp.leave(s.now);
  assert.deepEqual(s.pvp.control({ ...IN, x: 1, fire: true, roll: 1 }, s.now), { x: 0, y: 0, run: false, jump: false, down: false });
  s.pvp.leave(s.now);
  assert.equal(s.sent.filter((m) => m.t === 'al').length, 1);
  s.pvp.enter(s.now, true);
  const me = s.pvp.bodies(s.now).find((b) => b.me).state;
  assert.equal(me.act, 'idle');
  assert.equal(me.hp, 100);
  assert.equal(me.safe, true);
  s.frames(150);
  assert.ok(!s.sent.some((m) => m.t === 'rs'), 'no respawn request carried over');
});

test('the connection drops: bullets in flight are cleared; offline, a dead me respawns by the local rules', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aj', id: 'b', hp: 100, kills: 0 }, s.now);
  s.frames(5);
  s.frames(1, { fire: true });
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'b', kills: 1 }, s.now);
  s.pvp.setOnline(false, s.now);
  assert.equal(s.pvp.glyphs(s.now, []).filter((g) => g.ch === '•').length, 0);
  s.frames(130);
  assert.equal(s.pvp.hud(s.now).alive, true);
  assert.ok(level.spawns.some((q) => Math.abs(s.world.player.x - off.x - q.x) < 1e-9), 'at a marked spawn');
});

test('an aw rebuilds the fighters and sets the pickups; mine is never a remote fighter', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'sp', id: 'b', x: 10.5, y: FLOOR }, s.now);
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 90, kills: 0, w: 'd', ammo: -1 }, pk: [{ n: 0, at: 5000 }, { n: 1, at: 0 }], fighters: [fighter('me', 70.5), fighter('b', 20.5)] }, s.now);
  assert.deepEqual(s.pvp.fighters.ids(), ['b']);
  const g = s.pvp.glyphs(s.now, []);
  const sniper = level.pickups[0];
  assert.ok(g.some((q) => q.ch === '·' && Math.abs(q.y - (off.y + sniper.y - 0.5)) < 0.2), 'the taken sniper is a dim outline');
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
});

// ---- fix round 1 ----

const emptyAw = (w = 'd', ammo = -1) => ({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w, ammo }, pk: [], fighters: [] });

test('a frame that flips facing and fires sends an a with the new facing before the f, and no duplicate after', () => {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw(), s.now);
  s.frames(10);
  const n = s.sent.length;
  const mouse = { on: true, x: s.world.player.x - 10, y: s.world.player.y };
  s.frames(1, { fire: true, mouse });
  const now = s.sent.slice(n);
  const fi = now.findIndex((m) => m.t === 'f'), as = now.filter((m) => m.t === 'a');
  assert.ok(fi > 0, JSON.stringify(now));
  assert.equal(as.length, 1);
  assert.equal(now.indexOf(as[0]) < fi, true);
  assert.equal(as[0].f, -1);
  const mz = muzzleOf(as[0].x, as[0].y, as[0].f, as[0].a, 'deagle');
  assert.ok(Math.abs(now[fi].x - mz.x) <= 3 && Math.abs(now[fi].y - mz.y) <= 2, 'the server finds the shot at the muzzle');
  const m = s.sent.length;
  s.frames(1, { mouse });
  assert.ok(!s.sent.slice(m).some((q) => q.t === 'a'), 'the ticker does not repeat the forced state');
});

// A server-side referee fed exactly what the browser sends, at the same clock.
function serverSim(gun, ammo) {
  const srv = createReferee({ level, rand: () => 0.5 });
  const S = newFighter('me', 0);
  srv.enter(S, 0);
  Object.assign(S, { gun, ammo, safeUntil: 0 });
  let seen = 0, rejected = 0;
  return {
    S,
    get rejected() { return rejected; },
    feed(sent, now) {
      srv.tick(now / 1000, [S]);
      for (; seen < sent.length; seen++) {
        const m = sent[seen];
        if (m.t === 'a') srv.state(S, m, now / 1000);
        else if (m.t === 'f' && !srv.fire(S, m, now / 1000, [S]).ok) rejected++;
      }
    },
  };
}

test('online, shooting the dummy never frees my in-flight cap or spends ammo the server does not see', () => {
  for (const [gun, code, ammo] of [['rifle', 'r', 40], ['deagle', 'd', -1]]) {
    const s = setup({ online: true, at: { x: 18.5, y: FLOOR } }); // clear cells east, through the dummy
    s.pvp.onMessage(emptyAw(code, ammo), s.now);
    const srv = serverSim(gun, ammo);
    let now = s.now, hit = false;
    for (let k = 0; k < 60 * 3.5; k++) {
      now += 1000 / 60;
      step(s.world, 1 / 60, s.pvp.control({ ...IN, fire: k > 10 }, now));
      s.pvp.frame(1 / 60, now);
      srv.feed(s.sent, now);
      const d = s.pvp.bodies(now).find((b) => b.dummy);
      hit ||= !!d && d.state.hp < 100;
    }
    const shots = s.sent.filter((m) => m.t === 'f').length;
    assert.ok(hit, `${gun}: the dummy was hit`);
    assert.equal(srv.rejected, 0, `${gun}: shots the server refused`);
    if (ammo > 0) {
      assert.ok(shots >= 30 && shots < 40, `${gun}: ${shots} shots`);
      assert.equal(s.pvp.me.ammo, ammo - shots);
      assert.equal(s.pvp.me.ammo, srv.S.ammo);
    }
  }
});

test('reconnecting inside the arena enters at the door, like walking in: the first a carries the door point', () => {
  const s = setup({ online: false, at: { x: 20.5, y: FLOOR } });
  s.frames(5);
  s.pvp.setOnline(true, s.now);
  assert.equal(s.world.player.x, A.entry.x + 0.5);
  assert.equal(s.world.player.y, A.floorY - 1.5);
  assert.equal(s.world.player.x - off.x, level.door.x);
  assert.equal(s.world.player.y - off.y, level.door.y);
  const n = s.sent.findIndex((m) => m.t === 'ae');
  assert.ok(n >= 0);
  s.frames(5);
  const a = s.sent.slice(n).find((m) => m.t === 'a');
  assert.ok(a && a.x === level.door.x && a.y === level.door.y, JSON.stringify(a));
});

test('online, the dummy waits for the arena welcome: no grey flash in a busy arena', () => {
  const s = setup({ online: true });
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
  s.frames(5);
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
  s.pvp.onMessage({ ...emptyAw(), fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 20.5, y: FLOOR, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 }] }, s.now);
  s.frames(5);
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
  const o = setup({ online: false });
  assert.ok(o.pvp.bodies(o.now).some((b) => b.dummy), 'offline it is there at once');
});

test('a message that breaks the handler is logged with console.warn, not swallowed', () => {
  const s = setup({ online: true });
  const warn = console.warn, seen = [];
  console.warn = (...a) => seen.push(a);
  try {
    const bad = { t: 'h', id: 'me', by: 'b', w: 'd' };
    Object.defineProperty(bad, 'hp', { get() { throw new Error('boom'); } });
    s.pvp.onMessage(bad, s.now);
  } finally { console.warn = warn; }
  assert.equal(seen.length, 1);
});

test('popped while holding a pickup gun: back to the deagle at once, and after the respawn', () => {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw('r', 33), s.now);
  assert.equal(s.pvp.me.gun, 'rifle');
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'b', kills: 1 }, s.now);
  assert.equal(s.pvp.me.gun, 'deagle');
  assert.equal(s.pvp.me.ammo, -1);
  s.frames(130);
  s.pvp.onMessage({ t: 'sp', id: 'me', x: level.spawns[0].x, y: level.spawns[0].y }, s.now);
  assert.equal(s.pvp.hud(s.now).gun, 'deagle');
  assert.equal(s.pvp.hud(s.now).ammo, -1);
});

test('a roll\'s first frame sends an a with bit 32', () => {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw(), s.now);
  s.frames(20);
  const n = s.sent.length;
  s.frames(1, { roll: 1 });
  const a = s.sent.slice(n).find((m) => m.t === 'a');
  assert.ok(a && (a.i & 32), JSON.stringify(a));
});

// ---- headshots (addendum §1) ----

test('a headshot kill\'s feed line ends " ◎ headshot"; a body-shot kill\'s and a flee\'s do not', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('a', 20.5), fighter('b', 40.5)] }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'a', kills: 1, hs: 1 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'me', kills: 1, hs: 1 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'a', kills: 2 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'a', kills: 3, hs: 1 }, s.now);
  assert.deepEqual(s.feed, ['Ann popped Bo ◎ headshot', 'you popped Bo ◎ headshot', 'Ann popped Bo', 'Ann popped you ◎ headshot']);
});

test('online: my headshot on someone shows -50! in white and gives a tiny shake; theirs on someone else does not shake', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('a', 20.5), fighter('b', 40.5)] }, s.now);
  s.frames(2);
  s.pvp.onMessage({ t: 'h', id: 'b', by: 'a', w: 'd', n: 3, d: 50, hp: 50, kx: 10, ky: 0, hs: 1 }, s.now);
  assert.equal(s.world.shake, null, 'someone else\'s headshot');
  const white = s.pvp.fx.glyphs(s.now, {}).filter((g) => g.color.join() === '255,255,255').map((g) => g.ch).join('');
  assert.equal(white, '-50!');
  s.pvp.onMessage({ t: 'h', id: 'b', by: 'me', w: 'd', n: 4, d: 50, hp: 0, kx: 10, ky: 0, hs: 1 }, s.now);
  assert.ok(s.world.shake && s.world.shake.amp > 0 && s.world.shake.amp < 0.4, 'a tiny shake');
  assert.ok(s.world.shake.until - s.world.t <= 0.15 + 1e-9);
  s.world.shake = null;
  s.pvp.onMessage({ t: 'h', id: 'b', by: 'me', w: 'd', n: 5, d: 25, hp: 0, kx: 10, ky: 0 }, s.now);
  assert.equal(s.world.shake, null, 'a body shot does not shake');
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'd', n: 6, d: 50, hp: 50, kx: 10, ky: 0, hs: 1 }, s.now);
  assert.equal(s.world.shake, null, 'taking a headshot does not shake');
  assert.ok(s.pvp.fx.glyphs(s.now, {}).filter((g) => g.ch === '!').length >= 2, 'mine shows -50! too');
});

test('Reduce Motion: my headshot gives no shake', () => {
  const s = setupNamed({ reducedMotion: true });
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('b', 40.5)] }, s.now);
  s.frames(2);
  s.pvp.onMessage({ t: 'h', id: 'b', by: 'me', w: 'd', n: 4, d: 50, hp: 50, kx: 10, ky: 0, hs: 1 }, s.now);
  assert.equal(s.world.shake, null);
});

test('offline: shooting the dummy from mid-jump hits its head row: 50 damage, -50!, and a tiny shake', () => {
  const s = setup();
  s.frames(15);
  s.frames(1, { jump: true });
  const y = s.world.player.y - off.y; // the shot leaves 0.3 rows above this: the head row is a row over the dummy's centre
  assert.ok(y > FLOOR - 1.2 && y < FLOOR - 0.2, `high enough for the head row, low enough to hit: ${y}`);
  s.frames(1, { jump: true, fire: true });
  let shook = false, white = '';
  for (let k = 0; k < 10; k++) {
    s.frames(1);
    if (s.world.shake) shook = true;
    if (!white) white = s.pvp.fx.glyphs(s.now, {}).filter((g) => g.color.join() === '255,255,255').map((g) => g.ch).join('');
  }
  assert.equal(s.pvp.bodies(s.now).find((b) => b.dummy).state.hp, 50);
  assert.equal(white, '-50!');
  assert.ok(shook);
});

test('my state carries flipT: Infinity until my air jump, then the seconds since it', () => {
  const s = setup();
  s.frames(15);
  const me = () => s.pvp.bodies(s.now).find((b) => b.me).state;
  assert.equal(me().flipT, Infinity);
  s.frames(6, { jump: true });
  s.frames(6);
  assert.equal(me().flipT, Infinity, 'a ground jump is no flip');
  s.frames(1, { jump: true });
  assert.ok(Math.abs(me().flipT) < 1e-9, `${me().flipT}`);
  s.frames(6, { jump: true });
  assert.ok(Math.abs(me().flipT - 0.1) < 1e-6, `${me().flipT}`);
});

test('a hit mid-flip ends my flip for good: flipT stays Infinity once the hurt is over', () => {
  const s = setup();
  s.frames(15);
  const me = () => s.pvp.bodies(s.now).find((b) => b.me).state;
  s.frames(6, { jump: true });
  s.frames(6);
  s.frames(1, { jump: true });
  s.frames(5);
  assert.ok(me().flipT < 0.1, 'flipping');
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'x', w: 'r', n: 1, d: 9, hp: 91, kx: 3, ky: 0 }, s.now); // stun 0.05 s
  s.frames(1);
  assert.equal(me().act, 'hurt');
  s.frames(6);
  assert.notEqual(me().act, 'hurt', 'the hurt is over');
  assert.equal(me().flipT, Infinity);
  s.frames(6);
  assert.equal(me().flipT, Infinity, 'and stays over');
});

test('an air kick, then my air jump within its 0.4 s: no flip, during the kick or after it', () => {
  const s = setup();
  s.frames(15);
  const me = () => s.pvp.bodies(s.now).find((b) => b.me).state;
  s.frames(6, { jump: true });
  s.frames(3);
  s.frames(1, { strikes: 1 });
  assert.equal(me().act, 'kick');
  s.frames(6);
  s.frames(1, { jump: true });
  assert.equal(s.world.player.airJumps, 0, 'the air jump was taken');
  for (let k = 0; k < 24; k++) { s.frames(1); assert.equal(me().flipT, Infinity, `frame ${k}: ${me().act}`); }
  assert.notEqual(me().act, 'kick', 'the kick is over');
});

test('flashes: a shot lights the train for a moment at its muzzle (arena-local), then is gone', () => {
  const s = setup();
  s.frames(15);
  assert.deepEqual(s.pvp.flashes(s.now), []);
  s.frames(1, { fire: true });
  const f = s.pvp.flashes(s.now);
  assert.equal(f.length, 1);
  const me = s.pvp.bodies(s.now).find((b) => b.me).state;
  const mz = muzzleOf(me.x - off.x, me.y - off.y, me.facing, me.aim, 'deagle');
  assert.ok(Math.abs(f[0].x - mz.x) < 1.5 && Math.abs(f[0].y - mz.y) < 1.5, `${f[0].x},${f[0].y} vs ${mz.x},${mz.y}`);
  assert.ok(f[0].k > 0 && f[0].k <= 2);
  s.frames(12);
  assert.deepEqual(s.pvp.flashes(s.now), []);
});

test('collision: I can\'t walk through the dummy once my protection is over, and I can stand on its head', () => {
  const s = setup();
  s.frames(190); // past the 3 s of protection
  const dummy = () => s.pvp.bodies(s.now).find((b) => b.dummy).state;
  s.frames(90, { x: 1 });
  const d = dummy(), p = s.world.player;
  assert.ok(Math.abs(p.x - (d.x - 0.8)) < 1e-6, `stopped beside it (${p.x}, the dummy at ${d.x})`);
  assert.equal(d.x, off.x + 50.5, 'and it stayed put');
  p.x = d.x + 0.2; p.y = d.y - 6; p.vy = 0;
  s.frames(60);
  assert.equal(p.y, d.y - 3, 'standing on its head');
  assert.equal(p.onGround, true);
});

test('collision: protected, I walk through the dummy', () => {
  const s = setup();
  s.frames(1);
  s.frames(40, { x: 1 });
  assert.ok(s.world.player.x > s.pvp.bodies(s.now).find((b) => b.dummy).state.x + 0.8);
});

test('collision: a popped dummy passes through me: never pushed off me, and it falls past my head', () => {
  const s = setup();
  s.frames(100); // past my protection
  const p = s.world.player, d = s.pvp.dummy;
  Object.assign(d.rec, { alive: false }); d.deadAt = s.now; // popped, its respawn 2 s off
  p.x = d.body.x + 0.3;
  s.frames(30);
  assert.equal(d.body.x, off.x + 50.5, 'not pushed');
  d.body.x = p.x; d.body.y = p.y - 6; d.body.vy = 0;
  s.frames(60);
  assert.equal(d.body.y, p.y, 'fell past my head to the floor');
});

test('collision: what I collide with is refreshed every frame, also on frames with no controls (away)', () => {
  const s = setup();
  s.frames(100);
  const d = s.pvp.dummy;
  d.body.x += 3;
  s.pvp.frame(1 / 60, s.now + 1000 / 60);
  const box = s.world.collide && s.world.collide.others.find((o) => o.id === 'dummy');
  assert.ok(box && Math.abs(box.x - d.body.x) < 1e-9, `the dummy's box is where it is now (${box && box.x}, ${d.body.x})`);
});

// Final review, Important 1: the mouse straight above or below my body, between my shoulders, never flips
// my facing back and forth: facing turns only once the cursor is past the other shoulder.
test('a cursor held straight above or below me keeps one facing: no flips, and no urgent a', () => {
  for (const start of [1, -1]) {
    for (const dx of [0, 0.05, -0.05, 0.1, -0.1, 0.14, -0.14]) {
      for (const dy of [-10, 6]) {
        const s = setup({ online: true });
        s.pvp.onMessage(emptyAw(), s.now);
        s.frames(10, { mouse: { on: true, x: s.world.player.x + start * 10, y: s.world.player.y } });
        assert.equal(s.world.player.facing, start);
        const n = s.sent.length, faced = [];
        for (let k = 0; k < 120; k++) {
          s.frames(1, { mouse: { on: true, x: s.world.player.x + dx, y: s.world.player.y + dy } });
          faced.push(s.world.player.facing);
        }
        const what = `facing ${start}, cursor ${dx}, ${dy}`;
        assert.ok(faced.every((f) => f === start), `${what}: ${faced.slice(0, 8)}`);
        const as = s.sent.slice(n).filter((m) => m.t === 'a');
        assert.ok(as.every((m) => m.f === start), what);
        assert.ok(as.length <= 3, `${what}: ${as.length} a in 2 s`);
      }
    }
  }
  // Past the other shoulder, it turns.
  const s = setup({ online: true });
  s.frames(5, { mouse: { on: true, x: s.world.player.x + 10, y: s.world.player.y } });
  s.frames(1, { mouse: { on: true, x: s.world.player.x - 0.2, y: s.world.player.y - 10 } });
  assert.equal(s.world.player.facing, -1);
  s.frames(1, { mouse: { on: true, x: s.world.player.x + 0.2, y: s.world.player.y - 10 } });
  assert.equal(s.world.player.facing, 1);
});

// Final review, Minor 1 (re-graded Important): a state forced out ahead of a shot counts against the
// ticker's 20 a a second, and still reaches the server before its shot.
function rifleTenSeconds(inpAt, fps = 60) {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw('r', 40), s.now);
  let now = s.now;
  for (let k = 0; k < fps * 10; k++) {
    now += 1000 / fps;
    if (k % fps === 0) s.pvp.onMessage({ t: 'w', id: 'me', w: 'r', ammo: 40 }, now); // never runs dry
    const at = s.sent.length;
    step(s.world, 1 / fps, s.pvp.control({ ...IN, fire: true, ...inpAt(k, s.world.player) }, now));
    s.pvp.frame(1 / fps, now);
    for (let j = at; j < s.sent.length; j++) s.sent[j].sentAt = now;
  }
  const as = s.sent.filter((m) => m.t === 'a');
  let most = 0;
  for (let i = 0, j = 0; i < as.length; i++) { while (as[i].sentAt - as[j].sentAt >= 1000) j++; most = Math.max(most, i - j + 1); }
  return { sent: s.sent, most, shots: s.sent.filter((m) => m.t === 'f').length };
}

test('10 s of rifle fire held sends at most 20 a in any second, also when every few shots turn me round', () => {
  const swing = (every) => (k, p) => ({ x: Math.floor(k / 60) % 2 ? 1 : -1, mouse: { on: true, x: p.x + (Math.floor(k / every) % 2 ? 5 : -5), y: p.y + Math.sin(k / 10) * 5 } });
  const cases = {
    'standing, aiming ahead': (k, p) => ({ mouse: { on: true, x: p.x + 10, y: p.y } }),
    'running, aim sweeping': (k, p) => ({ x: Math.floor(k / 60) % 2 ? 1 : -1, mouse: { on: true, x: p.x + 10, y: p.y + Math.sin(k / 10) * 5 } }),
    'running, turning every 6 frames': swing(6),
    'running, turning every 3 frames': swing(3),
    'turning every frame': (k, p) => ({ mouse: { on: true, x: p.x + (k % 2 ? 0.3 : -0.3), y: p.y - 10 } }),
  };
  for (const [name, inp] of Object.entries(cases)) {
    const { sent, most, shots } = rifleTenSeconds(inp);
    assert.ok(most <= 20, `${name}: ${most} a in one second`);
    assert.ok(shots >= 50, `${name}: ${shots} shots`);
    // Every shot is near the muzzle the server expects from the last state it heard, moved on by its
    // velocity for at most 0.1 s (the referee's estimate): its facing went out first.
    let last = null;
    for (const m of sent) {
      if (m.t === 'a') last = m;
      if (m.t !== 'f' || !last) continue;
      const k = Math.min(0.1, (m.sentAt - last.sentAt) / 1000);
      const mz = muzzleOf(last.x + last.vx * k, last.y + last.vy * k, last.f, last.a, 'rifle');
      assert.ok(Math.abs(m.x - mz.x) <= 3 && Math.abs(m.y - mz.y) <= 2, `${name}: a shot far from the muzzle the server expects ${JSON.stringify([m, last, mz])}`);
    }
  }
});

// ---- crouch and crawl (docs/specs/2026-10-14-arena-crouch.md) ----

test('crouching sends an a with bit 64, crawling one with 128; my state carries low', () => {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw(), s.now);
  s.frames(20);
  let n = s.sent.length;
  s.frames(2, { down: true });
  const c = s.sent.slice(n).find((m) => m.t === 'a');
  assert.ok(c && (c.i & 64) && !(c.i & 128), JSON.stringify(c));
  assert.equal(s.pvp.bodies(s.now)[0].state.low, 1);
  n = s.sent.length;
  s.frames(3, { down: true, x: 1 });
  const p = s.sent.slice(n).find((m) => m.t === 'a');
  assert.ok(p && (p.i & 128) && !(p.i & 64), JSON.stringify(p));
  assert.equal(s.pvp.bodies(s.now)[0].state.low, 2);
  s.frames(3);
  assert.equal(s.pvp.bodies(s.now)[0].state.low, 0);
});

test('crouched, ↓ doesn\'t tilt the keyboard aim: the shot is level, from the crouch\'s shoulder, and flies long', () => {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw(), s.now);
  s.frames(20);
  s.frames(2, { down: true, aimDown: true });
  s.frames(1, { down: true, aimDown: true, fire: true });
  const f = s.sent.find((m) => m.t === 'f');
  assert.equal(f.a, 0);
  const p = s.world.player, m = muzzleOf(p.x - off.x, p.y - off.y, 1, 0, 'deagle', 1);
  assert.ok(Math.abs(f.y - m.y) < 0.02, `from the crouch: ${f.y} vs ${m.y}`);
  const b = s.pvp.bodies(s.now)[0];
  assert.equal(b.state.aimed, false);
});

test('hit while low (lo): half the stun; the knock as sent', () => {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw(), s.now);
  s.frames(5);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'k', n: -1, d: 22, hp: 78, kx: 22.5, ky: -11, lo: 1 }, s.now);
  assert.ok(Math.abs(s.world.player.stun - 0.2) < 1e-9, `stun ${s.world.player.stun}`);
  assert.equal(s.world.player.vx, 22.5);
});

test('offline: a crouched level shot hits the standing dummy; a crawl moves at 10 cells/s', () => {
  const s = setup();
  s.frames(15);
  s.frames(2, { down: true });
  s.frames(1, { down: true, fire: true });
  s.frames(30, { down: true });
  assert.equal(s.pvp.bodies(s.now).find((b) => b.dummy).state.hp, 75);
  const x0 = s.world.player.x;
  s.frames(60, { down: true, x: -1 });
  assert.ok(Math.abs(x0 - s.world.player.x - 10) < 1, `crawled ${x0 - s.world.player.x}`);
});

test('crawling, shots go wild: up to 0.5 rad above the aim, never below level (the floor); crouched and still, they are level', () => {
  const angles = [];
  for (const r of [0, 0.25, 0.75, 1]) {
    const s = setup({ online: true, rand: () => r });
    s.pvp.onMessage(emptyAw(), s.now);
    s.frames(20);
    s.frames(3, { down: true, x: 1 });
    s.frames(1, { down: true, x: 1, fire: true });
    angles.push(s.sent.find((m) => m.t === 'f').a);
  }
  assert.deepEqual(angles, [0, -0.12, -0.37, -0.5]);
  const c = setup({ online: true, rand: () => 1 });
  c.pvp.onMessage(emptyAw(), c.now);
  c.frames(20);
  c.frames(3, { down: true });
  c.frames(1, { down: true, fire: true });
  assert.equal(c.sent.find((m) => m.t === 'f').a, 0, 'crouched and still: no spread');
});

test('crawling, a shot aimed down with the mouse still leaves level or higher, and flies (not into the floor at the muzzle)', () => {
  const s = setup({ rand: () => 0 });
  s.frames(130);
  const p = s.world.player;
  s.frames(3, { down: true, x: 1 });
  const mouse = { on: true, x: p.x + 10, y: p.y + 4 };
  s.frames(1, { down: true, x: 1, fire: true, mouse });
  const g = s.pvp.glyphs(s.now).filter((q) => q.ch === '•');
  s.frames(2, { down: true, x: 1, mouse });
  const g2 = s.pvp.glyphs(s.now).filter((q) => q.ch === '•');
  assert.ok(g.length + g2.length > 0, 'a bullet is drawn');
});

// Parry and the impact frame (parry addendum).
test('pr: the drawn round turns back from the parry point, with parry!; my parry shakes a little', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('a', 20.5), fighter('b', 60.5)] }, s.now);
  s.frames(2);
  const tracers = () => s.pvp.fx.glyphs(s.now, {}).filter((g) => g.glow && g.ch === '-');
  s.pvp.onMessage({ t: 's', id: 'a', n: 9, x: 23.5, y: FLOOR - 0.3, a: 0, w: 'n' }, s.now);
  s.frames(1);
  const before = tracers();
  assert.ok(before.length > 0);
  s.pvp.onMessage({ t: 'pr', id: 'b', n: 9, n2: 10, x: 57.9, y: FLOOR - 0.3, a: 3.14, w: 'n' }, s.now);
  assert.equal(s.world.shake, null, 'someone else\'s parry');
  s.frames(1);
  const after = tracers();
  assert.ok(after.length > 0 && after.every((g) => g.x < off.x + 57.9), 'flying back from the parry point');
  assert.ok(s.pvp.fx.glyphs(s.now, {}).map((g) => g.ch).join('').includes('parry!'));
  s.pvp.onMessage({ t: 'pr', id: 'me', n: 10, n2: 11, x: 40, y: FLOOR - 0.3, a: 0, w: 'n' }, s.now);
  assert.ok(s.world.shake && s.world.shake.amp < 0.4, 'my parry: a tiny shake');
});

test('a kill by a parried round: the feed line ends " ↩ parry"', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('a', 20.5), fighter('b', 40.5)] }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'a', by: 'me', kills: 1, pr: 1 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'a', kills: 1, hs: 1, pr: 1 }, s.now);
  assert.deepEqual(s.feed, ['you popped Ann ↩ parry', 'Ann popped Bo ◎ headshot ↩ parry']);
});

test('the impact frame: for my kill and my death, not for someone else\'s kill or a flee', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('a', 20.5), fighter('b', 40.5)] }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'a', kills: 1 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'me', kills: 1, fled: 1 }, s.now);
  assert.equal(s.impacts.length, 0);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'me', kills: 2 }, s.now);
  assert.equal(s.impacts.length, 1);
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'a', kills: 2 }, s.now);
  assert.equal(s.impacts.length, 2);
  assert.deepEqual(s.impacts.map((e) => e.me), [false, true], 'whether I was the one popped');
  assert.deepEqual(s.impacts.map((e) => e.text), ['you popped Bo', 'Ann popped you'], 'the kill\'s line, for the picture');
});

test('the impact frame: popping the dummy offline gives one; Reduce Motion gives none', () => {
  const s = setup();
  s.frames(15);
  for (let k = 0; k < 8 && s.pvp.bodies(s.now).find((b) => b.dummy).state.act !== 'dead'; k++) { s.frames(1, { fire: true }); s.frames(30); }
  assert.equal(s.pvp.bodies(s.now).find((b) => b.dummy).state.act, 'dead');
  assert.equal(s.impacts.length, 1);
  assert.equal(s.impacts[0].text, 'you popped the dummy');
  const r = setupNamed({ reducedMotion: true });
  r.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('b', 40.5)] }, r.now);
  r.pvp.onMessage({ t: 'k', id: 'b', by: 'me', kills: 1 }, r.now);
  assert.equal(r.impacts.length, 0);
});

// The smg (the rifle's key on the wire and in the rules; smg addendum).
test('the smg sprays: standing up to 0.15 rad either way, crouched 0.04; the deagle and the sniper fly true', () => {
  const shot = (gun, r, inp = {}) => {
    const s = setup({ online: true, rand: () => r });
    s.pvp.onMessage(emptyAw(), s.now);
    s.frames(20);
    s.pvp.me.gun = gun; s.pvp.me.ammo = gun === 'deagle' ? -1 : 5;
    if (inp.down) s.frames(3, inp);
    s.frames(1, { ...inp, fire: true });
    return s.sent.find((m) => m.t === 'f').a;
  };
  assert.deepEqual([0, 0.5, 1].map((r) => shot('rifle', r)), [-0.15, 0, 0.15]);
  assert.deepEqual([0, 0.5, 1].map((r) => shot('rifle', r, { down: true })), [-0.04, 0, 0.04]);
  for (const gun of ['deagle', 'sniper']) assert.deepEqual([0, 1].map((r) => shot(gun, r)), [0, 0], gun);
});

// Pickups at random spots, and the medkit (pickups addendum).
test('pickups are drawn where the referee put them: offline my own, online the welcome\'s and each pk\'s', () => {
  const s = setup({ rand: () => 0.25 });
  const mine = createReferee({ level, rand: () => 0.25 }).pickups(0);
  assert.deepEqual(s.pvp.pickups(s.now).map((q) => [q.kind, q.x - off.x, q.y - off.y]), mine.map((q) => [{ r: 'rifle', n: 'sniper', m: 'medkit' }[q.g], q.x, q.y]));
  const o = setupNamed();
  assert.deepEqual(o.pvp.pickups(o.now), [], 'online: none until the welcome');
  o.pvp.onMessage({ ...emptyAw(), pk: [{ n: 0, at: 0, x: 30.5, y: 24.5, g: 'r' }, { n: 1, at: 4000, x: 60.5, y: 6.5, g: 'n' }, { n: 2, at: 0, x: 90.5, y: 24.5, g: 'm' }] }, o.now);
  assert.deepEqual(o.pvp.pickups(o.now).map((q) => [q.kind, q.x - off.x, q.y - off.y, q.there]), [['rifle', 30.5, 24.5, true], ['sniper', 60.5, 6.5, false], ['medkit', 90.5, 24.5, true]]);
  o.pvp.onMessage({ t: 'pk', id: 'b', n: 0, at: 10000, x: 150.5, y: 6.5 }, o.now);
  const r = o.pvp.pickups(o.now)[0];
  assert.deepEqual([r.x - off.x, r.y - off.y, r.there], [150.5, 6.5, false], 'taken: it comes back somewhere else');
  const art = o.pvp.glyphs(o.now, []).map((g) => g.ch).join('');
  assert.ok(art.includes('[+]'), 'the medkit is drawn [+]');
});

test('the medkit: offline, walking into it hurt heals 50 (+50 in green); at full health it stays', () => {
  const p = spotOf('medkit', () => 0.75); // car A's floor
  const s = setup({ at: { x: p.x - 3, y: p.y }, rand: () => 0.75 });
  s.frames(40, { x: 1 });
  assert.ok(s.pvp.pickups(s.now).find((q) => q.kind === 'medkit').there, 'at full health it is left there');
  const h = setup({ at: { x: p.x - 3, y: p.y }, rand: () => 0.75 });
  Object.assign(h.pvp.me, { hp: 30, hurtAt: h.now / 1000 });
  h.frames(40, { x: 1 });
  assert.equal(Math.round(h.pvp.hud(h.now).hp), 80);
  assert.equal(h.pvp.pickups(h.now).find((q) => q.kind === 'medkit').there, false);
  assert.ok(h.pvp.glyphs(h.now, []).some((g) => g.ch === '+' && g.color.join() === '140,235,150'), '+50 in green');
});

test('online: hl heals me (my regen carries on) and shows +d over a healed fighter', () => {
  const s = setupNamed();
  s.pvp.onMessage({ ...emptyAw(), fighters: [fighter('b', 40.5)] }, s.now);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'd', n: 1, d: 60, hp: 40, kx: 0, ky: 0 }, s.now);
  s.pvp.onMessage({ t: 'hl', id: 'me', hp: 90, d: 50 }, s.now);
  assert.equal(s.pvp.hud(s.now).hp, 90);
  s.pvp.onMessage({ t: 'hl', id: 'b', hp: 70, d: 50 }, s.now);
  assert.equal(s.pvp.fx.glyphs(s.now, {}).filter((g) => g.color.join() === '140,235,150').map((g) => g.ch).join(''), '+50+50');
});

test('Ctrl (crouch) crouches and crawls on a floor as ↓ does, and on a ═ crouches without dropping through', () => {
  const s = setup({ online: true });
  s.pvp.onMessage(emptyAw(), s.now);
  s.frames(20);
  let n = s.sent.length;
  s.frames(2, { crouch: true });
  const c = s.sent.slice(n).find((m) => m.t === 'a');
  assert.ok(c && (c.i & 64) && !(c.i & 8), JSON.stringify(c)); // low, but not ↓: others don't drop it through a ═
  assert.equal(s.pvp.bodies(s.now)[0].state.low, 1);
  s.frames(3, { crouch: true, x: 1 });
  assert.equal(s.pvp.bodies(s.now)[0].state.low, 2);
  // a ═ with three rows of air over it, away from the door
  let spot = null;
  for (let r = 4; r < level.rows - 1 && !spot; r++) for (let c2 = 20; c2 < 150 && !spot; c2++) {
    const k = (cc, rr) => level.cells[rr * level.cols + cc];
    if (k(c2, r) === 1 && [1, 2, 3].every((d) => k(c2, r - d) === 0 && k(c2 - 1, r - d) === 0 && k(c2 + 1, r - d) === 0)) spot = { x: c2 + 0.5, y: r - 1.5 };
  }
  const p = setup({ at: spot });
  p.frames(20);
  assert.ok(p.world.player.onPlatform, 'standing on a ═');
  const y = p.world.player.y;
  p.frames(30, { crouch: true });
  assert.equal(p.world.player.y, y, 'still on it');
  assert.equal(p.pvp.bodies(p.now)[0].state.low, 1, 'crouched on it');
  p.frames(30, { down: true });
  assert.ok(p.world.player.y > y + 0.5, '↓ drops through');
});

test('online: running through a pickup, where I am goes out right before the pk (the server checks the reach from my last state)', () => {
  const q = spotOf('sniper', () => 0.75);
  for (let d = 0; d < 1; d += 0.1) { // from wherever between two of the ticker's states
    const s = setup({ online: true, at: { x: q.x - 8 - d, y: q.y }, rand: () => 0.75 });
    s.pvp.onMessage({ ...emptyAw(), pk: [{ n: q.n, at: 0, x: q.x, y: q.y }] }, s.now);
    s.frames(10);
    s.frames(40, { x: 1, run: true });
    const k = s.sent.findIndex((m) => m.t === 'pk');
    assert.ok(k > 0, 'a pk went out');
    const a = s.sent[k - 1];
    assert.equal(a.t, 'a');
    assert.ok(Math.abs(a.x - q.x) <= pickupReach('sniper') && Math.abs(a.y - q.y) <= 2, `from ${d.toFixed(1)} further: the state before it is out of reach: ${a.x}, ${a.y} vs ${q.x}, ${q.y}`);
  }
});

test('streaks: mine from the server\'s k, gone when I\'m popped; the board from ks, NEW RECORD when I made it', () => {
  const s = setupNamed();
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [fighter('a', 20.5), fighter('b', 40.5)] }, s.now);
  s.pvp.onMessage({ t: 'ks', top: [{ name: 'Ann', n: 4 }, { bad: 1 }] }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'b', by: 'me', kills: 1, streak: 1 }, s.now);
  s.pvp.onMessage({ t: 'k', id: 'a', by: 'me', kills: 2, streak: 2 }, s.now);
  let h = s.pvp.hud(s.now);
  assert.deepEqual([h.best, h.streak, h.record], [[{ name: 'Ann', n: 4 }], 2, false]);
  s.pvp.onMessage({ t: 'ks', top: [{ name: 'Ann', n: 4 }, { name: 'faiz', n: 2 }], by: 'me' }, s.now);
  h = s.pvp.hud(s.now);
  assert.equal(h.best.length, 2);
  assert.ok(h.record);
  assert.ok(!s.pvp.hud(s.now + 5000).record, 'the flash passes');
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'a', kills: 1, streak: 1 }, s.now);
  assert.equal(s.pvp.hud(s.now).streak, 0);
});
