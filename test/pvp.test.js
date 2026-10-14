import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData } from '../src/data.js';
import { buildLayout } from '../src/layout.js';
import { parseLevel } from '../src/level.js';
import { createWorld, step, teleport } from '../src/world.js';
import { createPvp } from '../src/pvp.js';
import { createReferee, newFighter } from '../src/referee.js';
import { muzzleOf } from '../src/fight.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const level = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const data = indexData(fixture, ['IMG_1003']);
const map = buildLayout(data, { name: 'X' }, { arena: { photo: data.byId.get('IMG_1003'), level } });
const A = map.arena, off = { x: A.x + 1, y: A.y + 1 };
const IN = { x: 0, y: 0, run: false, jump: false, down: false, fire: false, strikes: 0, roll: 0, aimUp: false, aimDown: false, mouse: null };

function setup({ online = false, at = { x: 70.5, y: 27.5 } } = {}) {
  const world = createWorld(map);
  teleport(world, off.x + at.x, off.y + at.y);
  const sent = [], notes = [], feed = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, onNote: (t) => notes.push(t), onFeed: (t) => feed.push(t), rand: () => 0.5, myId: () => 'me' });
  let now = 0;
  pvp.enter(now, online);
  const frames = (n, inp = {}) => { for (let k = 0; k < n; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control({ ...IN, ...inp }, now)); pvp.frame(1 / 60, now); } };
  return { world, pvp, sent, notes, feed, frames, get now() { return now; } };
}

test('offline: the dummy stands at column 80 on the yellow line, facing the door', () => {
  const { pvp } = setup();
  const d = pvp.bodies(0).find((b) => b.dummy);
  assert.equal(d.state.x, off.x + 80.5);
  assert.equal(d.state.y, off.y + 27.5);
  assert.equal(d.state.facing, 1);
});

test('offline: shooting the dummy (J held) costs it 25 a hit, knocks it back, pops it, and it comes back 2 s later', () => {
  const s = setup();
  s.frames(15);
  s.frames(1, { fire: true });
  s.frames(30);
  const d1 = s.pvp.bodies(s.now).find((b) => b.dummy);
  assert.equal(d1.state.hp, 75);
  assert.ok(d1.state.x > off.x + 80.5, 'knocked back');
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

test('offline: walking into the sniper pickup gives the sniper; its aim line shows', () => {
  const p = level.pickups.find((q) => q.gun === 'sniper');
  const s = setup({ at: { x: p.x - 3, y: p.y } });
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
  assert.ok(a && a.x > 60 && a.x < 90 && a.y > 20 && a.y < 30, JSON.stringify(a));
  s.frames(1, { fire: true });
  assert.equal(s.sent.filter((m) => m.t === 'f').length, 1);
  s.frames(1, { strikes: 1 });
  assert.deepEqual(s.sent.find((m) => m.t === 'm').k, 'p');
});

test('online: h for me lowers hp and knocks me back; k pops me with a note; rs after 2 s; sp puts me at the spawn', () => {
  const s = setup({ online: true });
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 }] }, s.now);
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
  s.pvp.onMessage({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0 }, s.now);
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
  teleport(world, off.x + 70.5, off.y + 27.5);
  const sent = [], notes = [], feed = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, onNote: (t) => notes.push(t), onFeed: (t) => feed.push(t), rand: () => 0.5, myId: () => 'me', nameOf: (id) => named[id] || '', reducedMotion });
  let now = 0;
  pvp.enter(now, online);
  const frames = (n, inp = {}) => { for (let k = 0; k < n; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control({ ...IN, ...inp }, now)); pvp.frame(1 / 60, now); } };
  return { world, pvp, sent, notes, feed, frames, get now() { return now; } };
}
const fighter = (id, x, kills = 0) => ({ id, hp: 100, kills, alive: 1, safe: 0, w: 'd', ammo: -1, x, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 });

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
  assert.ok(next.ts - rifle.at(-1).ts > 400 && next.ts > T + 450, `${next.ts - T} ms after the switch`);
});

test('offline, the ammo of a pickup gun runs down and runs dry back to the deagle', () => {
  const s = setupNamed({ online: false });
  s.pvp.me.gun = 'sniper';
  s.pvp.me.ammo = 2;
  s.frames(5);
  s.frames(1, { fire: true });
  assert.equal(s.pvp.me.ammo, 1);
  s.frames(80);
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
  const p = level.pickups.find((q) => q.gun === 'sniper');
  const world = createWorld(map);
  teleport(world, off.x + p.x, off.y + p.y);
  const sent = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, rand: () => 0.5, myId: () => 'me' });
  let now = 0;
  pvp.enter(now, true);
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
  s.pvp.onMessage({ t: 'sp', id: 'b', x: 10.5, y: 27.5 }, s.now);
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
    const s = setup({ online: true, at: { x: 48.5, y: 27.5 } }); // 82 clear cells east, through the dummy
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
  const s = setup({ online: false, at: { x: 50.5, y: 27.5 } });
  s.frames(5);
  s.pvp.setOnline(true, s.now);
  assert.equal(s.world.player.x, A.entry.x + 0.5);
  assert.equal(s.world.player.y, A.floorY - 1.5);
  assert.equal(s.world.player.x - off.x, 159.5);
  assert.equal(s.world.player.y - off.y, 32.5);
  const n = s.sent.findIndex((m) => m.t === 'ae');
  assert.ok(n >= 0);
  s.frames(5);
  const a = s.sent.slice(n).find((m) => m.t === 'a');
  assert.ok(a && a.x === 159.5 && a.y === 32.5, JSON.stringify(a));
});

test('online, the dummy waits for the arena welcome: no grey flash in a busy arena', () => {
  const s = setup({ online: true });
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
  s.frames(5);
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
  s.pvp.onMessage({ ...emptyAw(), fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 20.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 }] }, s.now);
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
  const y = s.world.player.y - off.y; // the shot leaves 0.3 rows above this: the head row is 26..27
  assert.ok(y > 26.3 && y < 27.3, `high enough for the head row, low enough to hit: ${y}`);
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
