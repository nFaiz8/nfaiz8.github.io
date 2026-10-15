import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, parseMap, levelKind, mapName, MAPS, SOLID } from '../src/level.js';
import { newBody, stepBody } from '../src/arena.js';
import { gorgeLevelText, W, H, FLOOR } from '../src/gorge/scene.js';
import { buildGorge, frameAt, paintWindow, GORGE_GLYPHS } from '../src/gorge/look.js';
import { indexData } from '../src/data.js';
import { buildLayout } from '../src/layout.js';
import { createWorld, teleport } from '../src/world.js';
import { createPvp } from '../src/pvp.js';

const text = fs.readFileSync(new URL('../src/gorge.txt', import.meta.url), 'utf8');
const L = parseMap('gorge', text);
const kind = levelKind(L);

test('src/gorge.txt is what the scene generates (regenerate it after changing src/gorge/scene.js)', () => {
  assert.equal(text, gorgeLevelText());
});

test('the gorge map: 212 × 112, ten spawns, three pickups, a door, three ladders, stairs, no dummy', () => {
  assert.deepEqual([L.cols, L.rows, W, H], [212, 112, 212, 112]);
  assert.equal(L.name, 'gorge');
  assert.equal(L.spawns.length, 10);
  assert.deepEqual(L.pickups.map((p) => p.gun), ['sniper', 'rifle', 'rifle']);
  assert.ok(L.door);
  assert.deepEqual(L.ladders, [{ x: 132.5, top: 17, bot: 25 }, { x: 132.5, top: 35, bot: 47 }, { x: 175.5, top: 64, bot: 76 }]);
  assert.equal(L.steps, true);
  assert.equal(L.dummy, false);
  for (const s of L.spawns) assert.notEqual(kind(s.c, s.r + 1), 0, `spawn ${s.c},${s.r} stands on something`);
});

test('mapName: an unknown map is the train; parseMap carries the map\'s rules', () => {
  assert.equal(mapName('gorge'), 'gorge');
  assert.equal(mapName('nope'), 'train');
  assert.equal(mapName('__proto__'), 'train');
  const T = parseMap('train', fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
  assert.deepEqual([T.cols, T.rows, T.steps, T.dummy, T.ladders.length], [MAPS.train.cols, MAPS.train.rows, false, true, 0]);
});

test('H markers: a column of H is one ladder, from the tread over its top to the row under its foot; H is air', () => {
  const T = parseLevel(' H \n H═\n H \n═══\n', 3, 4);
  assert.deepEqual(T.ladders, [{ x: 1.5, top: -1, bot: 3 }]);
  assert.equal(T.cells[1], 0);
  const two = parseLevel('H H\nH  \n   \nH  \n', 3, 4);
  assert.deepEqual(two.ladders, [{ x: 0.5, top: -1, bot: 2 }, { x: 0.5, top: 2, bot: 4 }, { x: 2.5, top: -1, bot: 1 }]);
});

// The way up, from the courtyard to the bridge: stairs, the cave, three ladders and two pine jumps.
const ROUTE = [
  [{ x: 1 }, 6, (b) => b.feet <= 98.01],
  [{ x: -1 }, 6, (b) => b.feet <= 86.01 && b.x < 120],
  [{ x: 1 }, 8, (b) => b.feet <= 76.01 && b.x > 150],
  [{ x: 1 }, 8, (b) => b.x > 175],
  [{ x: 1 }, 2, (b) => Math.abs(b.x - 175.5) < 1.2],
  [{ up: true }, 3, (b) => b.feet <= 64.01 && !b.climb],
  [{ x: -1 }, 12, (b) => b.feet <= 47.01 && b.x < 140],
  [{ x: -1 }, 3, (b) => Math.abs(b.x - 132.5) < 1.2],
  [{ up: true }, 3, (b) => b.feet <= 35.01 && !b.climb],
  [{ x: -1 }, 1, (b) => b.x < 125.5],
  [{ x: -1, jump: true }, 0.6, (b) => b.x < 119.5],
  [{ jump: true }, 1, (b) => b.onGround],
  [{}, 0.2, (b) => b.feet <= 30.01],
  [{ x: 1 }, 0.5, (b) => b.x > 120.5],
  [{ x: 1, jump: true }, 0.6, (b) => b.x > 126],
  [{ jump: true }, 1, (b) => b.onGround],
  [{}, 0.2, (b) => b.feet <= 25.01],
  [{ x: 1 }, 2, (b) => Math.abs(b.x - 132.5) < 1.2],
  [{ up: true }, 3, (b) => b.feet <= 17.01 && !b.climb],
];
for (const fps of [20, 60, 144]) {
  test(`the climb from the courtyard to the top of the gorge works at ${fps} fps`, () => {
    const b = newBody(111.5, FLOOR - 1.5);
    b.onGround = true;
    const opts = { ladders: L.ladders, steps: true };
    const view = () => ({ x: b.x, feet: b.y + 1.5, climb: b.climb, onGround: b.onGround });
    ROUTE.forEach(([input, secs, done], k) => {
      for (let f = 0; f < secs * fps && !done(view()); f++) stepBody(b, 1 / fps, input, kind, opts);
      assert.ok(done(view()), `leg ${k}: stuck at x ${b.x.toFixed(2)}, feet ${(b.y + 1.5).toFixed(2)}`);
    });
  });
}

test('without steps a one-row block blocks you, and without ladders up does nothing (the train as it was)', () => {
  const T = parseLevel('     \n     \n     \n   ▓▓\n▓▓▓▓▓\n', 5, 5);
  const k = levelKind(T);
  const b = newBody(1.5, 2.5);
  b.onGround = true;
  for (let f = 0; f < 60; f++) stepBody(b, 1 / 60, { x: 1, up: true }, k);
  assert.ok(b.x < 3, `walked into the tread at ${b.x}`);
  assert.equal(b.climb, null);
  const c = newBody(1.5, 2.5);
  c.onGround = true;
  for (let f = 0; f < 60; f++) stepBody(c, 1 / 60, { x: 1 }, k, { steps: true });
  assert.ok(c.x > 3 && c.y < 2.5, `stepped up onto the tread: ${c.x}, ${c.y}`);
});

test('the gorge\'s look: deterministic, every glyph is in the atlas, and crisp backgrounds are marked', () => {
  const T = buildGorge(L);
  assert.throws(() => buildGorge({ cols: 204, rows: 33 }));
  for (const t of [0, 5000, 24000, 45000]) {
    for (const look of ['line', 'ascii']) {
      const a = paintWindow(T, frameAt(t), look, 0, 0, W, H);
      const b = paintWindow(T, frameAt(t), look, 0, 0, W, H);
      assert.deepEqual(a.ch, b.ch);
      assert.deepEqual(a.fg, b.fg);
      const missing = new Set(a.ch.filter((c) => !GORGE_GLYPHS.includes(c)));
      assert.deepEqual([...missing], [], `t ${t}, ${look}`);
    }
  }
  const out = paintWindow(T, frameAt(0), 'line', 0, 0, W, H);
  assert.ok(out.hard.some((v, i) => i % 4 === 3 && v === 255));
  assert.ok(out.hard.some((v, i) => i % 4 === 3 && v === 0));
  assert.deepEqual(paintWindow(T, frameAt(1, { reducedMotion: true }), 'line', 0, 0, W, H).ch, paintWindow(T, frameAt(99999, { reducedMotion: true }), 'line', 0, 0, W, H).ch);
});

test('the gorge has no practice dummy, even alone and offline', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
  const data = indexData(fixture, ['IMG_1003']);
  const map = buildLayout(data, { name: 'X' }, { arena: { photo: data.byId.get('IMG_1003'), level: L } });
  const A = map.arena, world = createWorld(map);
  teleport(world, A.x + 1 + L.spawns[0].x, A.y + 1 + L.spawns[0].y);
  const pvp = createPvp({ world, map, level: L, send: () => true, onNote() {}, onFeed() {}, onImpact() {}, rand: () => 0.5, myId: () => 'me' });
  pvp.enter(0, false);
  for (let k = 1; k < 200; k++) pvp.frame(1 / 60, k * 16);
  assert.equal(pvp.bodies(4000).filter((b) => b.dummy).length, 0);
  assert.equal(kind(-1, 50), SOLID);
});
