import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData } from '../src/data.js';
import { buildLayout, isWalkable } from '../src/layout.js';
import { createWorld, step, walkTo, teleport, smoothPath, enterSide, exitSide, inArena } from '../src/world.js';
import { findPath } from '../src/path.js';

const SITE = { name: 'Faiz Nazeer', tagline: 'photographs', about: 'About.' };
const map = buildLayout(indexData(JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)))), SITE);
const run = (world, seconds, input) => { for (let t = 0; t < seconds; t += 1 / 60) step(world, 1 / 60, input); };

test('walking into a wall stops at the wall instead of passing through', () => {
  const w = createWorld(map);
  run(w, 10, { x: 0, y: 1 }); // lobby south wall has a corridor door in the middle, so walk off-centre
  const w2 = createWorld(map);
  // a row clear of the stairwell, which fills the lobby's south-west corner
  teleport(w2, map.rooms[0].x + 3.5, map.stairs.y - 3.5);
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
  assert.ok(firstStep > 0 && firstStep < 30 / 60 * 0.5, 'the first frame is slower than full speed');
  run(w, 0.4, { x: 1, y: 0 });
  assert.ok(w.player.vx > 27, 'reaches full speed quickly');
  const xRelease = w.player.x;
  run(w, 0.5, { x: 0, y: 0 });
  assert.ok(w.player.x > xRelease + 0.2, 'carries on a little after letting go');
  assert.equal(w.player.vx, 0, 'and comes to rest');
});

test('walking into the edge of a doorway slides you through it', () => {
  // the lobby's south door, or its north one when there is no south wing (a wing with no rooms has no door)
  const lobby = map.rooms[0];
  const doorIn = (y) => { for (let x = lobby.x; x < lobby.x + lobby.w; x++) if (isWalkable(map, x, y)) return x; return -1; };
  const south = doorIn(lobby.y + lobby.h - 1) > 0, dir = south ? 1 : -1, y = south ? lobby.y + lobby.h - 1 : lobby.y;
  const left = doorIn(y);
  assert.ok(left > 0, 'the lobby has a door to a wing');
  const w = createWorld(map);
  teleport(w, left - 0.05, y - dir * 3.5 + (south ? 0 : 1)); // the player's box overlaps the door frame by a third of a cell
  run(w, 2, { x: 0, y: dir });
  assert.ok(south ? w.player.y > y + 1 : w.player.y < y - 1, 'went through the door instead of snagging on its edge');
});

test('click paths are pulled straight: few legs, each one walkable', () => {
  const w = createWorld(map);
  const f = map.frames[0];
  const cells = findPath(map.W, map.H, (x, y) => isWalkable(map, x, y), Math.floor(w.player.x), Math.floor(w.player.y), f.stand.x, f.stand.y);
  const legs = smoothPath(map, w.player, cells);
  assert.ok(legs.length < cells.length / 4, `${legs.length} legs for ${cells.length} cells`);
  assert.deepEqual(legs.at(-1), { x: f.stand.x + 0.5, y: f.stand.y + 0.5 });
});

test('walking is 30 cells a second; holding Shift sprints at 45', () => {
  const normal = createWorld(map), fast = createWorld(map);
  run(normal, 0.5, { x: 1, y: 0 });
  run(fast, 0.5, { x: 1, y: 0, run: true });
  assert.ok(Math.abs(normal.player.vx - 30) < 1, `walk ${normal.player.vx}`);
  assert.ok(Math.abs(fast.player.vx - 45) < 1, `sprint ${fast.player.vx}`);
});

test('tap-to-walk goes at walking pace', () => {
  const w = createWorld(map);
  const f = map.frames[0];
  assert.ok(walkTo(w, f.stand.x, f.stand.y));
  let peak = 0;
  for (let t = 0; t < 1; t += 1 / 60) { step(w, 1 / 60, { x: 0, y: 0 }); peak = Math.max(peak, Math.hypot(w.player.vx, w.player.vy)); }
  assert.ok(peak > 25, `path pace ${peak}`);
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

import { parseLevel } from '../src/arena.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const lvl = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const adata = indexData(fixture, ['IMG_1003']);
const amap = buildLayout(adata, SITE, { arena: { photo: adata.byId.get('IMG_1003'), level: lvl } });
const A = amap.arena;
const SIDE_IDLE = { x: 0, y: 0, run: false, jump: false, down: false };

test('walking west through the door asks for the side view; entering puts you on the floor facing west', () => {
  const w = createWorld(amap);
  teleport(w, A.door.x + 3.5, A.door.y + 1.5);
  for (let i = 0; i < 180 && !w.want; i++) step(w, 1 / 60, { x: -1, y: 0 });
  assert.equal(w.want, 'side');
  assert.equal(w.mode, 'top', 'main.js switches, after the tilt');
  assert.equal(w.path, null);
  enterSide(w);
  assert.equal(w.mode, 'side');
  assert.equal(w.want, null);
  assert.equal(w.player.x, A.entry.x + 0.5);
  assert.equal(w.player.y, A.floorY - 1.5);
  assert.equal(w.player.facing, -1);
  step(w, 1 / 60, SIDE_IDLE);
  assert.equal(w.player.y, A.floorY - 1.5, 'standing, not falling');
  assert.equal(w.focus, A.backdrop, 'the backdrop is what you look at');
});

test('in side view you run and jump; running east out of the door twice asks to go back; exiting faces east in the corridor', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x + 0.5, A.floorY - 1.5);
  assert.equal(w.mode, 'side', 'a teleport into the arena switches at once');
  let top = w.player.y;
  for (let i = 0; i < 30; i++) { step(w, 1 / 60, { ...SIDE_IDLE, jump: true }); top = Math.min(top, w.player.y); }
  assert.ok(A.floorY - 1.5 - top > 3, 'jumped');
  for (let i = 0; i < 120; i++) step(w, 1 / 60, SIDE_IDLE);
  // The jump may land on a platform over the door's floor: ↓ drops back through it first.
  for (let i = 0; i < 60; i++) step(w, 1 / 60, { ...SIDE_IDLE, down: true });
  for (let i = 0; i < 120 && !w.want; i++) step(w, 1 / 60, { ...SIDE_IDLE, x: 1 });
  assert.equal(w.want, null, 'the first hit on the exit holds');
  step(w, 1 / 60, SIDE_IDLE);
  for (let i = 0; i < 60 && !w.want; i++) step(w, 1 / 60, { ...SIDE_IDLE, x: 1 });
  assert.equal(w.want, 'top', 'the second lets me out');
  exitSide(w);
  assert.equal(w.mode, 'top');
  assert.equal(w.player.x, A.door.x + 2.5);
  assert.equal(w.player.y, A.door.y + 1.5);
  assert.equal(w.player.facing, 1);
});

test('a teleport out of the arena (e.g. → in the viewer) switches back to top-down at once', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x + 0.5, A.floorY - 1.5);
  const f = amap.frames[0];
  teleport(w, f.stand.x + 0.5, f.stand.y + 0.5);
  assert.equal(w.mode, 'top');
  assert.equal(w.player.x, f.stand.x + 0.5, 'no extra placement');
  step(w, 1 / 60, { x: 0, y: 0 });
  assert.equal(w.focus && w.focus.id, f.id);
});

test('while frozen (tilting) input is ignored; a held jump at the door does not fire on arrival', () => {
  const w = createWorld(amap);
  teleport(w, A.door.x + 3.5, A.door.y + 1.5);
  w.frozen = true;
  const x0 = w.player.x;
  for (let i = 0; i < 30; i++) step(w, 1 / 60, { x: -1, y: 0 });
  assert.equal(w.player.x, x0);
  w.frozen = false;
  enterSide(w);
  for (let i = 0; i < 30; i++) step(w, 1 / 60, { ...SIDE_IDLE, jump: true });
  assert.equal(w.player.y, A.floorY - 1.5, 'jump still held from before: no jump');
});

test('the side camera stays inside the room and shows the floor', () => {
  const w = createWorld(amap, { reducedMotion: true });
  w.view = { cols: 142, rows: 32 };
  teleport(w, A.entry.x + 0.5, A.floorY - 1.5);
  for (let i = 0; i < 600; i++) {
    step(w, 1 / 60, { ...SIDE_IDLE, x: -1, run: true, jump: i % 50 < 20 });
    assert.ok(w.cam.x - w.view.cols / 2 >= A.x - 1e-9 && w.cam.x + w.view.cols / 2 <= A.x + A.w + 1e-9, 'x inside');
    assert.ok(w.cam.y - w.view.rows / 2 >= A.y - 1e-9 && w.cam.y + w.view.rows / 2 <= A.y + A.h + 1e-9, 'y inside');
  }
});

test('walkTo from the arena leaves it first; a target inside the arena is refused', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x + 0.5, A.floorY - 1.5);
  assert.equal(walkTo(w, A.entry.x - 5, A.entry.y), false);
  assert.equal(w.mode, 'side');
  assert.equal(walkTo(w, Math.floor(amap.spawn.x), Math.floor(amap.spawn.y)), true);
  assert.equal(w.mode, 'top');
  assert.ok(w.path && w.path.length);
});

test('fake visitors never go into the arena', () => {
  const w = createWorld(amap);
  for (let i = 0; i < 120 * 30; i++) {
    step(w, 1 / 30, { x: 0, y: 0 });
    for (const v of w.visitors) assert.ok(!inArena(amap, v.x, v.y), `visitor in the arena at ${v.x},${v.y}`);
  }
});

test('stunned in the side view, the arena door is a wall', async () => {
  const { knock } = await import('../src/arena.js');
  const w = createWorld(amap);
  teleport(w, A.entry.x - 3.5, A.floorY - 1.5);
  for (let i = 0; i < 12; i++) step(w, 1 / 60, SIDE_IDLE);
  knock(w.player, 45, 0, 0.4);
  for (let i = 0; i < 30; i++) step(w, 1 / 60, SIDE_IDLE);
  assert.equal(w.want, null, 'not carried out of the door');
  assert.equal(w.mode, 'side');
});

test('teleporting into the arena at the old one-row centre settles onto the floor and can walk', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x + 0.5, A.entry.y + 0.5);
  for (let i = 0; i < 30; i++) step(w, 1 / 60, SIDE_IDLE);
  assert.equal(w.mode, 'side');
  assert.equal(w.player.y, A.floorY - 1.5, 'feet on the floor');
  const x0 = w.player.x;
  for (let i = 0; i < 60; i++) step(w, 1 / 60, { ...SIDE_IDLE, x: -1 });
  assert.ok(x0 - w.player.x > 3, `walked ${x0 - w.player.x}`);
});

test('teleporting from the side view into the side view also settles onto the floor', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x + 0.5, A.floorY - 1.5);
  for (let i = 0; i < 12; i++) step(w, 1 / 60, SIDE_IDLE);
  assert.equal(w.mode, 'side');
  teleport(w, A.entry.x + 0.5, A.entry.y + 0.5);
  for (let i = 0; i < 30; i++) step(w, 1 / 60, SIDE_IDLE);
  assert.equal(w.player.y, A.floorY - 1.5);
  const x0 = w.player.x;
  for (let i = 0; i < 60; i++) step(w, 1 / 60, { ...SIDE_IDLE, x: -1 });
  assert.ok(x0 - w.player.x > 3, `walked ${x0 - w.player.x}`);
});

test('aimFacing overrides facing in the side view; a shake moves the camera and then settles back', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x - 20.5, A.floorY - 1.5);
  w.aimFacing = 1;
  for (let i = 0; i < 20; i++) step(w, 1 / 60, { ...SIDE_IDLE, x: -1 });
  assert.equal(w.player.facing, 1);
  for (let i = 0; i < 60; i++) step(w, 1 / 60, SIDE_IDLE);
  const cx = w.cam.x;
  w.shake = { until: w.t + 0.15, amp: 0.4 };
  step(w, 1 / 60, SIDE_IDLE);
  assert.notEqual(w.cam.x, cx);
  for (let i = 0; i < 60; i++) step(w, 1 / 60, SIDE_IDLE);
  assert.ok(Math.abs(w.cam.x - cx) < 1e-6);
});

test('aimFacing 0 leaves facing to the running direction; Reduce Motion never shakes', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x - 20.5, A.floorY - 1.5);
  w.aimFacing = 0;
  for (let i = 0; i < 20; i++) step(w, 1 / 60, { ...SIDE_IDLE, x: -1 });
  assert.equal(w.player.facing, -1);
  const r = createWorld(amap, { reducedMotion: true });
  teleport(r, A.entry.x - 20.5, A.floorY - 1.5);
  for (let i = 0; i < 30; i++) step(r, 1 / 60, SIDE_IDLE);
  const cx = r.cam.x, cy = r.cam.y;
  r.shake = { until: r.t + 0.15, amp: 0.4 };
  for (let i = 0; i < 5; i++) { step(r, 1 / 60, SIDE_IDLE); assert.equal(r.cam.x, cx); assert.equal(r.cam.y, cy); }
});

// The exit (exit addendum): two hits to leave the arena.
test('the arena exit: the first hit holds me in (and asks); holding on is still one hit; the second within 3 s lets me out', async () => {
  const { createWorld, step, enterSide } = await import('../src/world.js');
  const fs = await import('node:fs');
  const { indexData } = await import('../src/data.js');
  const { buildLayout } = await import('../src/layout.js');
  const { parseLevel } = await import('../src/level.js');
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
  const data = indexData(fixture, ['IMG_1003']);
  const map = buildLayout(data, { name: 'X' }, { arena: { photo: data.byId.get('IMG_1003'), level: parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8')) } });
  const world = createWorld(map);
  world.player.x = map.arena.entry.x + 0.5; world.player.y = map.arena.entry.y + 0.5;
  enterSide(world);
  const RIGHT = { x: 1, y: 0, run: false, jump: false, down: false }, NONE = { x: 0, y: 0, run: false, jump: false, down: false };
  const run = (n, inp) => { for (let k = 0; k < n; k++) step(world, 1 / 60, inp); };
  run(90, RIGHT); // 1.5 s held against it
  assert.equal(world.mode, 'side');
  assert.equal(world.want, null, 'held in');
  assert.equal(world.exit.asks, 1, 'asked once, though held');
  run(10, NONE);
  run(60, RIGHT);
  assert.equal(world.want, 'top', 'the second hit lets me out');
  // A second hit too late (over 3 s after the first) is a first hit again.
  enterSide(world);
  run(30, RIGHT);
  run(240, NONE);
  run(30, RIGHT);
  assert.equal(world.want, null, 'too late: held again');
  assert.equal(world.exit.asks, 3);
});
