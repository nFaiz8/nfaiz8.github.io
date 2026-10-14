import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { createFx } from '../src/fx.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const fx = (o = {}) => createFx({ kindAt: levelKind(L), ...o });
// On car A's floor (row 26): bodies at y 24.5. The wall in the way: car A's end lintel, cols 96–97, rows 11–13.

test('my bullet stops at a fighter drawn on my screen, with no spark until the server says so', () => {
  const f = fx();
  f.shot({ id: 'me', n: null, x: 23.45, y: 24.2, angle: 0, gun: 'deagle', color: [255, 206, 110], mine: true, at: 0 });
  const bodies = [{ id: 'b', state: { x: 30.5, y: 24.5 } }];
  for (let ms = 16; ms <= 200; ms += 16) f.step(0.016, ms, bodies);
  assert.equal(f.glyphs(200, { bodies: [] }).filter((g) => g.ch === '•').length, 0);
});

test('my bullet is still flying when no body is in its way', () => {
  const f = fx();
  f.shot({ id: 'me', n: null, x: 23.45, y: 24.2, angle: 0, gun: 'deagle', color: [255, 206, 110], mine: true, at: 0 });
  for (let ms = 16; ms <= 64; ms += 16) f.step(0.016, ms, []);
  assert.equal(f.glyphs(64, {}).filter((g) => g.ch === '•').length, 1);
});

test('a remote bullet flies to the ▓ the ray cast finds', () => {
  const f = fx();
  f.shot({ id: 'b', n: 4, x: 91.5, y: 12.2, angle: 0, gun: 'deagle', color: [120, 200, 255], mine: false, at: 0 });
  for (let ms = 16; ms <= 48; ms += 16) f.step(0.016, ms, []);
  const heads = f.glyphs(48, {}).filter((g) => g.ch === '•');
  assert.equal(heads.length, 1);
  assert.ok(heads[0].x <= 96, 'still short of the lintel at col 96');
  for (let ms = 64; ms <= 100; ms += 16) f.step(0.016, ms, []);
  assert.equal(f.glyphs(100, {}).filter((g) => g.ch === '•').length, 0, 'gone at the lintel');
  for (let ms = 116; ms <= 400; ms += 16) f.step(0.016, ms, []);
  assert.equal(f.glyphs(400, {}).filter((g) => g.ch === '•').length, 0, 'gone at the lintel');
});

test('assign gives the oldest unnumbered bullet of mine its number, so a hit can remove it', () => {
  const f = fx();
  const mk = (x) => f.shot({ id: 'me', n: null, x, y: 24.2, angle: 0, gun: 'deagle', color: [1, 2, 3], mine: true, at: 0 });
  mk(23); mk(24);
  f.assign(7);
  f.hit({ n: 7, x: 90, y: 24.5, d: 25, at: 10 });
  assert.equal(f.glyphs(10, {}).filter((g) => g.ch === '•').length, 1);
});

test('a hit removes its bullet and shows a spark and a rising damage number', () => {
  const f = fx();
  f.shot({ id: 'b', n: 9, x: 60, y: 24.2, angle: 0, gun: 'deagle', color: [1, 2, 3], mine: false, at: 0 });
  f.hit({ n: 9, x: 70, y: 24.5, d: 25, at: 10 });
  const g0 = f.glyphs(10, {}), g1 = f.glyphs(500, {});
  assert.equal(g0.filter((g) => g.ch === '•').length, 0);
  assert.ok(g0.some((g) => g.ch === '*'));
  const n0 = g0.filter((g) => '-25'.includes(g.ch) && g.y < 27), n1 = g1.filter((g) => '-25'.includes(g.ch) && g.y < 27);
  assert.ok(n1[0].y < n0[0].y - 0.5, 'rises');
  assert.equal(f.glyphs(700, {}).filter((g) => g.ch === '2').length, 0, 'gone after 0.6 s');
  const still = fx({ reducedMotion: true });
  still.hit({ n: -1, x: 70, y: 24.5, d: 25, at: 0 });
  assert.equal(still.glyphs(0, {}).find((g) => g.ch === '2').y, still.glyphs(400, {}).find((g) => g.ch === '2').y);
});

test('hp bars show below full health only', () => {
  const f = fx();
  const bar = (hp, act = 'idle') => f.glyphs(0, { bodies: [{ id: 'b', state: { x: 50, y: 20, hp, act } }] }).filter((g) => g.ch === '█' || g.ch === '░').map((g) => g.ch).join('');
  assert.equal(bar(100), '');
  assert.equal(bar(60), '███░░');
  assert.equal(bar(0), '░░░░░');
  assert.equal(bar(50, 'dead'), '');
});

test('pickups float and bob; a taken one is a dim dotted outline', () => {
  const f = fx();
  const there = f.glyphs(0, { pickups: [{ x: 26.5, y: 17.5, gun: 'rifle', there: true }] });
  assert.equal(there.map((g) => g.ch).join(''), '═╦╤══');
  assert.notEqual(f.glyphs(375, { pickups: [{ x: 26.5, y: 17.5, gun: 'rifle', there: true }] })[0].y, there[0].y);
  const gone = f.glyphs(0, { pickups: [{ x: 26.5, y: 17.5, gun: 'rifle', there: false }] });
  assert.ok(gone.every((g) => g.ch === '·' && g.a < 0.5));
});

test('the sniper aim line: faint dots to the first ▓, brighter when the next shot is ready', () => {
  const f = fx();
  const line = (ready) => f.glyphs(0, { aims: [{ id: 'b', x: 81.5, y: 12.5, facing: 1, aim: 0, color: [9, 9, 9], ready }] }).filter((g) => g.ch === '·');
  const l = line(false);
  assert.ok(l.length >= 3);
  assert.ok(l.every((g) => g.x < 96 && Math.abs(g.a - 0.25) < 1e-9));
  assert.ok(line(true).every((g) => Math.abs(g.a - 0.5) < 1e-9));
});

test('clear drops bullets, sparks and numbers', () => {
  const f = fx();
  f.shot({ id: 'b', n: 1, x: 30.5, y: 24.2, angle: 0, gun: 'deagle', color: [1, 2, 3], mine: false, at: 0 });
  f.hit({ n: -1, x: 70, y: 24.5, d: 25, at: 0 });
  f.clear();
  assert.equal(f.glyphs(10, {}).length, 0);
});

test('my bullet flies through a dead body and a spawn-protected one', () => {
  for (const state of [{ x: 91.5, y: 12.5, act: 'dead' }, { x: 91.5, y: 12.5, safe: true }]) {
    const f = fx();
    f.shot({ id: 'me', n: null, x: 84.45, y: 12.2, angle: 0, gun: 'deagle', color: [1, 2, 3], mine: true, at: 0 });
    for (let ms = 16; ms <= 96; ms += 16) f.step(0.016, ms, [{ id: 'b', state }]);
    const heads = f.glyphs(96, {}).filter((g) => g.ch === '•');
    assert.equal(heads.length, 1, 'still flying');
    assert.ok(heads[0].x > 92 && heads[0].x < 96, 'past the body, short of the lintel');
  }
});

test('with an offset, a remote bullet still ends at the lintel', () => {
  const f = fx({ offset: { x: 10, y: 5 } });
  f.shot({ id: 'b', n: 4, x: 101.5, y: 17.2, angle: 0, gun: 'deagle', color: [1, 2, 3], mine: false, at: 0 });
  for (let ms = 16; ms <= 48; ms += 16) f.step(0.016, ms, []);
  const heads = f.glyphs(48, {}).filter((g) => g.ch === '•');
  assert.equal(heads.length, 1);
  assert.ok(heads[0].x <= 106);
  for (let ms = 64; ms <= 100; ms += 16) f.step(0.016, ms, []);
  assert.equal(f.glyphs(100, {}).filter((g) => g.ch === '•').length, 0);
});

test('a headshot number is -50! in flash white and lasts 1.3× as long; a body number stays as it was', () => {
  const f = fx();
  f.hit({ n: -1, x: 70, y: 24.5, d: 50, at: 0, hs: 1 });
  const text = (ms) => f.glyphs(ms, {}).filter((g) => g.y < 23.5 && '-50!'.includes(g.ch));
  const n0 = text(0);
  assert.equal(n0.map((g) => g.ch).join(''), '-50!');
  assert.ok(n0.every((g) => g.color.join() === '255,255,255'), 'flash white');
  assert.equal(text(700).length, 4, 'still there at 0.7 s');
  assert.equal(text(790).length, 0, 'gone after 0.78 s');
  const b = fx();
  b.hit({ n: -1, x: 70, y: 24.5, d: 25, at: 0 });
  const body = b.glyphs(0, {}).filter((g) => g.y < 23.5 && '-25!'.includes(g.ch));
  assert.equal(body.map((g) => g.ch).join(''), '-25');
  assert.ok(body.every((g) => g.color.join() !== '255,255,255'));
  assert.equal(b.glyphs(700, {}).filter((g) => g.ch === '2').length, 0, 'gone after 0.6 s');
});

test('bullets and sparks are marked to glow (the train\'s halation); numbers, bars, pickups and aim lines are not', () => {
  const f = fx();
  f.shot({ id: 'b', n: 1, x: 30.5, y: 24.2, angle: 0, gun: 'deagle', color: [1, 2, 3], mine: false, at: 0 });
  f.hit({ n: -1, x: 70, y: 24.5, d: 25, at: 0 });
  const g = f.glyphs(30, { bodies: [{ id: 'b', state: { x: 50, y: 20, hp: 40, act: 'idle' } }], pickups: [{ x: 26.5, y: 17.5, gun: 'rifle', there: true }],
    aims: [{ id: 'b', x: 20.5, y: 24.5, facing: 1, aim: 0, color: [9, 9, 9], ready: true }] });
  const glowing = g.filter((q) => q.glow).map((q) => q.ch).join('');
  assert.ok(glowing.includes('•'), 'the bullet');
  assert.ok(glowing.includes('*'), 'the spark');
  assert.ok(g.filter((q) => (q.x > 60 && q.y < 23.5) || '█░'.includes(q.ch)).every((q) => !q.glow), 'not the number or the bar');
  assert.ok(g.filter((q) => q.y < 18).every((q) => !q.glow), 'not the pickup');
  assert.ok(g.filter((q) => q.color.join() === '9,9,9').every((q) => !q.glow), 'not the aim line');
});
