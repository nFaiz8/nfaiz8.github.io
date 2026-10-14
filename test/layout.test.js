import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData } from '../src/data.js';
import { buildLayout, isWalkable, T } from '../src/layout.js';
import { findPath } from '../src/path.js';

const SITE = { name: 'Faiz Nazeer', tagline: 'photographs', about: 'A few words about the work.' };
const real = indexData(JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url))));

test('layout is deterministic', () => {
  const a = buildLayout(real, SITE), b = buildLayout(real, SITE);
  assert.equal(a.W, b.W);
  assert.deepEqual([...a.tiles], [...b.tiles]);
  assert.deepEqual(a.frames.map((f) => [f.id, f.x, f.y]), b.frames.map((f) => [f.id, f.x, f.y]));
});

test('every visible photo has exactly one frame', () => {
  const map = buildLayout(real, SITE);
  const want = real.rooms.flatMap((r) => r.photos.map((p) => p.id)).sort();
  assert.deepEqual(map.frames.map((f) => f.id).sort(), want);
});

test('room interiors never overlap', () => {
  const { rooms } = buildLayout(real, SITE);
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    const overlap = a.x + 1 < b.x + b.w - 1 && b.x + 1 < a.x + a.w - 1 && a.y + 1 < b.y + b.h - 1 && b.y + 1 < a.y + a.h - 1;
    assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
  }
});

test('frames sit inside their room and do not overlap each other', () => {
  const map = buildLayout(real, SITE);
  for (const f of map.frames) {
    const r = map.rooms[f.roomIndex];
    assert.ok(f.x > r.x && f.y > r.y && f.x + f.w < r.x + r.w && f.y + f.h < r.y + r.h, `${f.id} outside ${r.id}`);
  }
  for (let i = 0; i < map.frames.length; i++) for (let j = i + 1; j < map.frames.length; j++) {
    const a = map.frames[i], b = map.frames[j];
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} overlaps ${b.id}`);
  }
});

test('every frame can be reached from the spawn point', () => {
  const map = buildLayout(real, SITE);
  const pass = (x, y) => isWalkable(map, x, y);
  const sx = Math.floor(map.spawn.x), sy = Math.floor(map.spawn.y);
  assert.ok(pass(sx, sy), 'spawn is on the floor');
  for (const f of map.frames) {
    assert.ok(pass(f.stand.x, f.stand.y), `${f.id} stand cell is walkable`);
    assert.ok(findPath(map.W, map.H, pass, sx, sy, f.stand.x, f.stand.y), `${f.id} unreachable`);
  }
  for (const r of map.rooms.filter((r) => r.entry)) assert.ok(pass(r.entry.x, r.entry.y), `${r.id} entry walkable`);
});

test('doors connect corridors to rooms', () => {
  const map = buildLayout(real, SITE);
  const doors = [...map.tiles].filter((t) => t === T.DOOR).length;
  assert.ok(doors >= (map.rooms.length - 1) * 3);
});

test('the lobby has an "all photos" kiosk you can walk up to', () => {
  const map = buildLayout(real, SITE);
  const k = map.kiosk;
  assert.ok(k, 'kiosk exists');
  const lobby = map.rooms[0];
  assert.ok(k.x > lobby.x && k.x + k.w < lobby.x + lobby.w && k.y > lobby.y && k.y + k.h < lobby.y + lobby.h, 'inside the lobby');
  for (let y = k.y; y < k.y + k.h; y++) for (let x = k.x; x < k.x + k.w; x++) assert.equal(map.tiles[y * map.W + x], T.PROP);
  assert.ok(map.labels.some((l) => /view all photos/.test(l.text) && l.y >= k.y && l.y < k.y + k.h), 'labelled');
  // Nothing else in the lobby is covered, and you can walk to where you stand to use it.
  const sx = Math.floor(map.spawn.x), sy = Math.floor(map.spawn.y);
  assert.ok(isWalkable(map, sx, sy), 'spawn still free');
  assert.ok(findPath(map.W, map.H, (x, y) => isWalkable(map, x, y), sx, sy, k.stand.x, k.stand.y), 'reachable');
  // An information desk centred under the name, with an attendant behind it, above where you start.
  const name = map.labels.filter((l) => l.role === 'name');
  const nameBottom = Math.max(...name.map((l) => l.y));
  assert.ok(k.y > nameBottom, 'below the name');
  assert.ok(Math.abs(k.x + k.w / 2 - (lobby.x + lobby.w / 2)) <= 1, 'centred');
  assert.ok(k.stand.y < Math.floor(map.spawn.y), 'you start below the desk');
  assert.equal(k.attendant.y, k.y - 1, 'attendant stands behind the desk');
  assert.equal(map.tiles[k.attendant.y * map.W + k.attendant.x], T.PROP, 'nobody walks through the attendant');
  assert.ok(map.labels.some((l) => /information/.test(l.text) && l.y < k.y + k.h && l.y >= k.attendant.y - 1), 'a sign says information');
  for (const l of map.labels.filter((l) => l.role === 'about' || l.role === 'name' || l.role === 'tagline'))
    assert.ok(l.y < k.y || l.y >= k.y + k.h || l.x + l.text.length <= k.x || l.x >= k.x + k.w, `doesn't cover "${l.text}"`);
});

import { parseLevel } from '../src/arena.js';

const json = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const level = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const withArena = (photoId = 'IMG_1003') => {
  const d = indexData(json, [photoId]);
  return buildLayout(d, SITE, { arena: { photo: d.byId.get(photoId) || null, level } });
};

test('the arena is west of the lobby: 240 × 50 inside, its door in line with a 10-cell corridor', () => {
  const map = withArena();
  const a = map.arena, lobby = map.rooms[0], room = map.rooms.at(-1);
  assert.equal(room.id, 'arena');
  assert.equal(a.index, map.rooms.length - 1);
  assert.equal(a.w - 2, 240);
  assert.equal(a.h - 2, 50);
  assert.equal(lobby.x - a.door.x, 10, 'corridor length');
  assert.ok(a.x + a.w <= lobby.x, 'west of the lobby');
  // Door: the bottom 3 interior rows of the east wall, and the matching cells of the lobby's west wall.
  for (let k = 0; k < 3; k++) {
    assert.equal(map.tiles[(a.door.y + k) * map.W + a.door.x], T.DOOR);
    assert.equal(map.tiles[(a.door.y + k) * map.W + lobby.x], T.DOOR);
  }
  assert.equal(a.door.y + 2, a.y + a.h - 2, 'door ends on the bottom interior row');
  assert.equal(a.floorY, a.y + a.h - 1);
  assert.deepEqual(a.entry, { x: a.door.x - 1, y: a.floorY - 1 });
  for (let x = a.door.x + 1; x < lobby.x; x++) assert.ok(isWalkable(map, x, a.door.y + 1), `corridor ${x}`);
  assert.ok(map.labels.some((l) => l.text === '← ARENA' && l.x > lobby.x && l.x < lobby.x + 12), 'sign inside the lobby by the door');
});

test('the arena is reachable from spawn, its inside is plain floor, and no room overlaps it', () => {
  const map = withArena();
  const a = map.arena;
  const pass = (x, y) => isWalkable(map, x, y);
  assert.ok(findPath(map.W, map.H, pass, Math.floor(map.spawn.x), Math.floor(map.spawn.y), a.entry.x, a.entry.y), 'reachable');
  for (let y = a.y + 1; y < a.y + a.h - 1; y++) for (let x = a.x + 1; x < a.x + a.w - 1; x++) {
    assert.equal(map.tiles[y * map.W + x], T.FLOOR);
    assert.equal(map.roomOf[y * map.W + x], a.index);
  }
  const { rooms } = map;
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const p = rooms[i], q = rooms[j];
    const overlap = p.x + 1 < q.x + q.w - 1 && q.x + 1 < p.x + p.w - 1 && p.y + 1 < q.y + q.h - 1 && q.y + 1 < p.y + p.h - 1;
    assert.ok(!overlap, `${p.id} overlaps ${q.id}`);
  }
});

test('the arena photo is one backdrop frame over the whole room, last in the frame order', () => {
  const map = withArena();
  const a = map.arena, f = map.frames.at(-1);
  assert.equal(f, a.backdrop);
  assert.equal(f.id, 'IMG_1003');
  assert.equal(f.backdrop, true);
  assert.deepEqual([f.x, f.y, f.w, f.h, f.cols, f.rows], [a.x, a.y, a.w, a.h, 240, 50]);
  assert.equal(map.frames.filter((x) => x.id === 'IMG_1003').length, 1, 'not also on a colour-room wall');
  assert.deepEqual(map.rooms[a.index].frames, [f]);
});

test('a missing arena photo leaves the room with no backdrop; no arena option is exactly today', () => {
  const missing = withArena('not-a-photo');
  assert.ok(missing.arena);
  assert.equal(missing.arena.backdrop, null);
  assert.deepEqual(missing.rooms[missing.arena.index].frames, []);
  const plain = buildLayout(indexData(json), SITE);
  const old = buildLayout(real, SITE);
  assert.equal(plain.arena, null);
  assert.ok(!plain.rooms.some((r) => r.id === 'arena'));
  assert.ok(!plain.labels.some((l) => l.text === '← ARENA'));
  assert.deepEqual([...plain.tiles], [...old.tiles]);
});
