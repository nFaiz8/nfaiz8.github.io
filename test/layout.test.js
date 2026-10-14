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
  for (const l of map.labels.filter((l) => l.role === 'about' || l.role === 'name' || l.role === 'tagline'))
    assert.ok(l.y < k.y || l.y >= k.y + k.h || l.x + l.text.length <= k.x || l.x >= k.x + k.w, `doesn't cover "${l.text}"`);
});
