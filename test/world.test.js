import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData } from '../src/data.js';
import { buildLayout, isWalkable } from '../src/layout.js';
import { createWorld, step, walkTo, teleport, smoothPath } from '../src/world.js';
import { findPath } from '../src/path.js';

const SITE = { name: 'Faiz Nazeer', tagline: 'photographs', about: 'About.' };
const map = buildLayout(indexData(JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)))), SITE);
const run = (world, seconds, input) => { for (let t = 0; t < seconds; t += 1 / 60) step(world, 1 / 60, input); };

test('walking into a wall stops at the wall instead of passing through', () => {
  const w = createWorld(map);
  run(w, 10, { x: 0, y: 1 }); // lobby south wall has a corridor door in the middle, so walk off-centre
  const w2 = createWorld(map);
  teleport(w2, map.rooms[0].x + 3.5, map.spawn.y);
  run(w2, 10, { x: -1, y: 0 });
  assert.ok(w2.player.x > map.rooms[0].x + 1, 'stayed inside the lobby');
  assert.ok(w2.player.x < map.rooms[0].x + 1.5, 'reached the wall');
});

test('walkTo follows a path to a frame and calls back on arrival', () => {
  const w = createWorld(map);
  const f = map.frames[0];
  let arrived = false;
  assert.ok(walkTo(w, f.stand.x, f.stand.y, () => { arrived = true; }));
  run(w, 60, { x: 0, y: 0 });
  assert.ok(arrived);
  assert.equal(Math.floor(w.player.x), f.stand.x);
  assert.equal(Math.floor(w.player.y), f.stand.y);
  assert.equal(w.focus && w.focus.id, f.id, 'the frame you walked to is in focus');
});

test('keyboard input cancels a path', () => {
  const w = createWorld(map);
  walkTo(w, map.frames[0].stand.x, map.frames[0].stand.y);
  step(w, 1 / 60, { x: 1, y: 0 });
  assert.equal(w.path, null);
});

test('camera eases toward the player, or snaps with reduced motion', () => {
  const w = createWorld(map);
  teleport(w, map.spawn.x, map.spawn.y);
  w.player.x += 5;
  step(w, 1 / 60, { x: 0, y: 0 });
  assert.ok(w.cam.x > map.spawn.x && w.cam.x < map.spawn.x + 5);
  const r = createWorld(map, { reducedMotion: true });
  r.player.x += 5;
  step(r, 1 / 60, { x: 0, y: 0 });
  assert.equal(r.cam.x, r.player.x);
});

test('movement accelerates and glides to a stop instead of starting and stopping instantly', () => {
  const w = createWorld(map);
  const x0 = w.player.x;
  step(w, 1 / 60, { x: 1, y: 0 });
  const firstStep = w.player.x - x0;
  assert.ok(firstStep > 0 && firstStep < 48 / 60 * 0.5, 'the first frame is slower than full speed');
  run(w, 0.4, { x: 1, y: 0 });
  assert.ok(w.player.vx > 44, 'reaches full speed quickly');
  const xRelease = w.player.x;
  run(w, 0.5, { x: 0, y: 0 });
  assert.ok(w.player.x > xRelease + 0.2, 'carries on a little after letting go');
  assert.equal(w.player.vx, 0, 'and comes to rest');
});

test('walking into the edge of a doorway slides you through it', () => {
  const lobby = map.rooms[0];
  const y = lobby.y + lobby.h - 1;
  let left = -1;
  for (let x = lobby.x; x < lobby.x + lobby.w; x++) if (isWalkable(map, x, y)) { left = x; break; }
  assert.ok(left > 0, 'the lobby has a south door');
  const w = createWorld(map);
  teleport(w, left - 0.05, y - 3.5); // the player's box overlaps the door frame by a third of a cell
  run(w, 2, { x: 0, y: 1 });
  assert.ok(w.player.y > y + 1, 'went through the door instead of snagging on its edge');
});

test('click paths are pulled straight: few legs, each one walkable', () => {
  const w = createWorld(map);
  const f = map.frames[0];
  const cells = findPath(map.W, map.H, (x, y) => isWalkable(map, x, y), Math.floor(w.player.x), Math.floor(w.player.y), f.stand.x, f.stand.y);
  const legs = smoothPath(map, w.player, cells);
  assert.ok(legs.length < cells.length / 4, `${legs.length} legs for ${cells.length} cells`);
  assert.deepEqual(legs.at(-1), { x: f.stand.x + 0.5, y: f.stand.y + 0.5 });
});

test('walking is the old sprint pace; holding Shift sprints faster still', () => {
  const normal = createWorld(map), fast = createWorld(map);
  run(normal, 0.5, { x: 1, y: 0 });
  run(fast, 0.5, { x: 1, y: 0, run: true });
  assert.ok(Math.abs(normal.player.vx - 48) < 1, `walk ${normal.player.vx}`);
  assert.ok(fast.player.vx > 68, `sprint ${fast.player.vx}`);
});

test('tap-to-walk goes at walking pace', () => {
  const w = createWorld(map);
  const f = map.frames[0];
  assert.ok(walkTo(w, f.stand.x, f.stand.y));
  let peak = 0;
  for (let t = 0; t < 1; t += 1 / 60) { step(w, 1 / 60, { x: 0, y: 0 }); peak = Math.max(peak, Math.hypot(w.player.vx, w.player.vy)); }
  assert.ok(peak > 40, `path pace ${peak}`);
});

test('running into a wall on a slow frame rate stops at the wall instead of passing through', () => {
  for (const dir of [-1, 1]) {
    const w = createWorld(map);
    const room = map.rooms[0];
    teleport(w, room.x + (dir < 0 ? 3.5 : room.w - 3.5), map.spawn.y);
    for (let t = 0; t < 3; t += 0.05) step(w, 0.05, { x: dir, y: 0, run: true }); // 20 fps, the dt cap
    assert.ok(w.player.x > room.x + 1 && w.player.x < room.x + room.w - 1, `left the lobby: x=${w.player.x} (dir ${dir})`);
  }
});

test('running on a slow frame rate never skips over a wall anywhere on the map', () => {
  const crossed = [];
  for (const room of map.rooms) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const w = createWorld(map);
      teleport(w, room.x + room.w / 2 + 0.5, room.y + room.h / 2 + 0.5);
      for (let t = 0; t < 2; t += 0.05) {
        const a = { x: w.player.x, y: w.player.y };
        step(w, 0.05, { x: dx, y: dy, run: true });
        const b = w.player, n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1);
        for (let i = 1; i < n; i++) {
          const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
          if (!isWalkable(map, Math.floor(x), Math.floor(y))) { crossed.push(`${room.id} ${dx},${dy} at ${x.toFixed(1)},${y.toFixed(1)}`); break; }
        }
      }
    }
  }
  assert.deepEqual(crossed, []);
});

test('standing at the lobby kiosk is noticed; walking away is too', () => {
  const w = createWorld(map);
  teleport(w, map.kiosk.stand.x + 0.5, map.kiosk.stand.y + 0.5);
  step(w, 1 / 60, { x: 0, y: 0 });
  assert.equal(w.atKiosk, true);
  const away = map.rooms.find((r) => r.entry).entry;
  teleport(w, away.x + 0.5, away.y + 0.5);
  step(w, 1 / 60, { x: 0, y: 0 });
  assert.equal(w.atKiosk, false);
});

test('fake visitors step aside for real people too', () => {
  const w = createWorld(map);
  const v = w.visitors[0];
  w.others = [{ x: v.x + 0.3, y: v.y }];
  const before = v.x;
  for (let i = 0; i < 30; i++) step(w, 1 / 60, { x: 0, y: 0 });
  assert.ok(Math.abs(v.x - before) > 0.2, `moved ${v.x - before}`);
});
