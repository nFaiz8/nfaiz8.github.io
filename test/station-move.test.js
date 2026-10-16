import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStation } from '../src/rpg/map.js';
import { createWalker, stepWalker, blocked, SPEED, SPRINT, RADIUS } from '../src/rpg/move.js';

const ROOM = parseStation(['##########', '#S.......#', '#........#', '#........#', '##########'].join('\n'));
const run = (w, map, input, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) stepWalker(w, dt, input, map); return w; };

test('reaches walking speed almost at once', () => {
  const w = createWalker(ROOM);
  run(w, ROOM, { x: 1, y: 0 }, 0.1);
  assert.ok(w.vx > 0.9 * SPEED, `after 0.1 s: ${w.vx}`);
  run(w, ROOM, { x: 1, y: 0 }, 0.2);
  assert.ok(Math.abs(w.vx - SPEED) < 0.01, `after 0.3 s: ${w.vx}`);
});

test('stops dead when you let go', () => {
  const w = run(createWalker(ROOM), ROOM, { x: 1, y: 0 }, 0.3);
  const x = w.x;
  run(w, ROOM, { x: 0, y: 0 }, 0.25);
  assert.equal(w.vx, 0);
  assert.ok(w.x - x < 0.2, `coasted ${w.x - x}`);
});

test('Shift sprints, and diagonals are no faster', () => {
  const s = run(createWalker(ROOM), ROOM, { x: 1, y: 0, run: true }, 0.3);
  assert.ok(Math.abs(s.vx - SPEED * SPRINT) < 0.02);
  const d = run(createWalker(ROOM), ROOM, { x: 1, y: 1 }, 0.25);
  assert.ok(Math.abs(Math.hypot(d.vx, d.vz) - SPEED) < 0.02, `diagonal ${Math.hypot(d.vx, d.vz)}`);
});

test('slides along a wall instead of sticking', () => {
  const w = run(createWalker(ROOM), ROOM, { x: -1, y: -1 }, 0.5); // into the corner
  assert.ok(w.x >= 1 + RADIUS - 1e-6 && w.z >= 1 + RADIUS - 1e-6);
  const x = w.x;
  run(w, ROOM, { x: 1, y: -1 }, 0.4); // along the north wall
  assert.ok(w.x > x + 1, 'moved east along it');
  assert.ok(Math.abs(w.z - (1 + RADIUS)) < 0.01, 'stayed against it');
});

test('never ends a step inside a wall or off the map, whatever the input', () => {
  const w = createWalker(ROOM);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) {
    const input = { x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1), run: rnd() < 0.3 };
    stepWalker(w, rnd() < 0.05 ? 0.25 : 1 / 60, input, ROOM);
    assert.ok(!blocked(ROOM, w.x, w.z), `inside a wall at ${w.x},${w.z} (step ${i})`);
  }
});

test('a long frame never carries you through a wall', () => {
  const thin = parseStation(['#####', '#S#.#', '#####'].join('\n'));
  const w = createWalker(thin);
  stepWalker(w, 0.05, { x: 1, y: 0 }, thin);
  stepWalker(w, 1, { x: 1, y: 0 }, thin);
  assert.ok(w.x <= 2 - RADIUS + 1e-6, `x ${w.x}`);
});

test('a corner clipped by less than 0.2 eases you round it; more blocks you', () => {
  const door = parseStation(['###.####', '#......#', '#S.....#', '########'].join('\n'));
  const w = createWalker(door, { x: 3.9, z: 1.6 });
  run(w, door, { x: 0, y: -1 }, 0.6);
  assert.ok(w.z < 0.9, `went through the doorway (z ${w.z})`);
  const v = createWalker(door, { x: 4.4, z: 1.6 });
  run(v, door, { x: 0, y: -1 }, 0.6);
  assert.ok(v.z >= 1 + RADIUS - 1e-6, 'held by the wall');
});

test('your height follows the stairs', () => {
  const tiny = parseStation(['########', '#S.>>__#', '#..>>__#', '#####!!#', '========', '########'].join('\n'));
  const w = createWalker(tiny);
  assert.equal(w.y, 0);
  let last = w.y;
  for (let i = 0; i < 90; i++) {
    stepWalker(w, 1 / 60, { x: 1, y: 0 }, tiny);
    assert.ok(w.y <= last + 1e-9, 'only goes down, walking east');
    last = w.y;
  }
  assert.equal(w.y, -3, 'on the platform');
});

test('remembers which way you face, and how far you walked', () => {
  const w = run(createWalker(ROOM), ROOM, { x: -1, y: 0 }, 0.1);
  assert.equal(w.facing, -1);
  const before = w.walked;
  run(w, ROOM, { x: 0, y: 1 }, 0.2);
  assert.equal(w.facing, -1, 'walking south keeps the facing');
  assert.ok(w.walked > before + 0.5);
});

test('a finer map: grain 0.25 cells collide at their own size', () => {
  // A single solid quarter-cell at (1.0…1.25, 0…0.25) in an open field.
  const map = { grain: 0.25, solidAt: (x, z) => x > 1 && x < 1.25 && z > 0 && z < 0.25, levelAt: () => 0 };
  assert.equal(blocked(map, 0.8, 0.1), true, 'a 0.25 radius reaches it from 0.8');
  assert.equal(blocked(map, 0.7, 0.1), false);
  assert.equal(blocked(map, 1.1, 0.6), false, 'well clear below it');
});

test('unstick: a walker caught inside something solid is moved to the nearest free spot', async () => {
  const { unstick } = await import('../src/rpg/move.js');
  const map = { grain: 1, solidAt: (x, z) => z < 4, levelAt: () => 0 };
  const w = { x: 5, z: 3.9 };
  assert.equal(blocked(map, w.x, w.z), true);
  unstick(w, map);
  assert.equal(blocked(map, w.x, w.z), false);
  assert.ok(w.z >= 4.25 && w.z < 4.6, `nearby: ${w.z}`);
  const free = { x: 5, z: 6 };
  unstick(free, map);
  assert.deepEqual(free, { x: 5, z: 6 });
});
