import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { createFx } from '../src/fx.js';
import { figureGlyphs } from '../src/render/figures.js';

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

test('my bullet flies on through a fighter rolling inside the dodge window, as the rules let it', () => {
  const heads = (actT) => {
    const f = fx();
    f.shot({ id: 'me', n: null, x: 23.45, y: 24.2, angle: 0, gun: 'deagle', color: [255, 206, 110], mine: true, at: 0 });
    const bodies = [{ id: 'b', state: { x: 30.5, y: 24.5, act: 'roll', actT } }];
    for (let ms = 16; ms <= 200; ms += 16) f.step(0.016, ms, bodies);
    return f.glyphs(200, { bodies: [] }).filter((g) => g.ch === '•').length;
  };
  assert.equal(heads(0.15), 1, 'inside the window: it flies on');
  assert.equal(heads(0.02), 0, 'before the window: it stops');
  assert.equal(heads(0.28), 0, 'after the window: it stops');
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

test('a damage number never shares a row with the name label or the hp bar, from its first frame to its last', () => {
  // A named body as figures.js draws it: where its name sits.
  const body = { id: 'b', label: 'dummy', color: [150, 150, 150], state: { x: 50.5, y: 24.5, vx: 0, vy: 0, facing: 1, ground: true, aim: 0, act: 'idle', actT: 0, hp: 75 } };
  const nameY = figureGlyphs([body], { t: 0 }).find((g) => !g.bold && g.ch === 'd').y;
  for (const reducedMotion of [false, true]) {
    for (const hs of [false, true]) {
      const f = fx({ reducedMotion });
      f.hit({ n: -1, x: body.state.x, y: body.state.y, d: hs ? 50 : 25, at: 0, hs });
      const barY = f.glyphs(0, { bodies: [body] }).find((g) => g.ch === '█').y;
      for (let ms = 0; ms < 800; ms += 20) {
        const digits = f.glyphs(ms, {}).filter((g) => /[-0-9!]/.test(g.ch));
        for (const g of digits) {
          assert.ok(Math.abs(g.y - nameY) >= 1, `${ms} ms: the number at ${g.y}, the name at ${nameY} (rm ${reducedMotion}, hs ${hs})`);
          assert.ok(Math.abs(g.y - barY) >= 1, `${ms} ms: the number at ${g.y}, the hp bar at ${barY}`);
          assert.ok(g.y < nameY, 'above the name');
        }
      }
    }
  }
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
  assert.equal(there.map((g) => g.ch).join(''), '╦╤═');
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

// Crouch and crawl (docs/specs/2026-10-14-arena-crouch.md §2, §3).
test('my standing level bullet flies over a fighter crouched or prone on my screen, and stops at one crouched when fired low', () => {
  const left = (low, y0) => {
    const f = fx();
    f.shot({ id: 'me', n: null, x: 23.45, y: y0, angle: 0, gun: 'deagle', color: [255, 206, 110], mine: true, at: 0 });
    const bodies = [{ id: 'b', state: { x: 30.5, y: 24.5, low } }];
    for (let ms = 16; ms <= 200; ms += 16) f.step(0.016, ms, bodies);
    return f.glyphs(200, { bodies: [] }).filter((g) => g.ch === '•').length;
  };
  assert.equal(left(1, 24.2), 1, 'over a crouch');
  assert.equal(left(2, 24.2), 1, 'over someone prone');
  assert.equal(left(1, 25.1), 0, 'fired from a crouch: it stops');
  assert.equal(left(2, 25.1), 0, 'and at someone prone');
});

test('a long shot (fired low) flies 1.5× as far on every screen; the sniper aim line of someone low reaches as far', () => {
  const run = (long) => {
    const f = fx();
    f.shot({ id: 'b', n: 1, x: 20.5, y: 25.1, angle: 0, gun: 'deagle', color: [1, 1, 1], mine: false, at: 0, long });
    let last = 0;
    for (let ms = 16; ms <= 2000; ms += 16) { f.step(0.016, ms, []); const h = f.glyphs(ms, {}).find((g) => g.ch === '•'); if (h) last = h.x; }
    return last - 20.5;
  };
  const short = run(false), long = run(true);
  assert.ok(short > 60 && short <= 64, `standing: ${short}`);
  assert.ok(long > 90 && long <= 96, `low: ${long}`);
  const f = fx();
  const dots = (low) => f.glyphs(0, { aims: [{ id: 'b', x: 20.5, y: 24.5, facing: 1, aim: 0, color: [9, 9, 9], ready: true, low }] }).filter((g) => g.ch === '·');
  const far = (low) => Math.max(...dots(low).map((g) => g.x));
  assert.ok(far(1) > far(0), `the line reaches further low (${far(1)} vs ${far(0)})`);
});

test('parry: the old round stops, a new one flies back the other way from the parry point, with parry! in white', () => {
  const f = fx();
  f.shot({ id: 'a', n: 7, x: 23.45, y: 24.2, angle: 0, gun: 'sniper', color: [200, 100, 100], mine: false, at: 0 });
  f.parry({ id: 'b', n: 7, n2: 8, x: 57.9, y: 24.2, angle: Math.PI, gun: 'sniper', color: [100, 200, 100], mine: false, at: 160 });
  const g = f.glyphs(200, {});
  const tracers = g.filter((q) => q.glow && q.ch === '-');
  assert.ok(tracers.length > 0, 'the new round is drawn');
  assert.ok(tracers.every((q) => q.x < 57.9), 'flying back, left of the parry point');
  assert.ok(tracers.every((q) => q.color[1] > q.color[0]), 'in the parrier\'s colour');
  const word = g.filter((q) => q.y < 24.2 - 3).map((q) => q.ch).join('');
  assert.equal(word, 'parry!');
  assert.ok(g.some((q) => q.ch === '*'), 'a spark');
  // The h for the new round (n2) stops it.
  f.hit({ n: 8, x: 23, y: 24.5, d: 70, at: 300 });
  assert.equal(f.glyphs(310, {}).filter((q) => q.glow && q.ch === '-').length, 0);
});
