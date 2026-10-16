import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation, LEVEL } from '../src/rpg/map.js';

// A hall, two stair tiles down to the platform, its edge and a track.
const TINY = [
  'name: TINY',
  '; a comment',
  '########',
  '#S.>>__#',
  '#..>>__#',
  '#####!!#',
  '========',
  '########',
].join('\n');

test('reads the header, the size and the spawn', () => {
  const m = parseStation(TINY);
  assert.equal(m.name, 'TINY');
  assert.equal(m.cols, 8);
  assert.equal(m.rows, 6);
  assert.deepEqual(m.spawn, { x: 1.5, z: 1.5 });
  assert.deepEqual(m.exits, []);
});

test('floors have their levels; neutral tiles take the floor around them', () => {
  const m = parseStation(TINY);
  assert.equal(m.levelAt(2.5, 1.5), LEVEL.hall);
  assert.equal(m.levelAt(1.5, 1.5), LEVEL.hall, 'S takes the hall');
  assert.equal(m.levelAt(5.5, 1.5), LEVEL.platform);
  assert.equal(m.levelAt(5.5, 3.5), LEVEL.platform, 'the edge');
  assert.equal(m.levelAt(3.5, 4.5), LEVEL.track);
  assert.equal(m.levelAt(-1, 1), null, 'off the map');
});

test('stairs slope from the level behind the run to the level in front', () => {
  const m = parseStation(TINY);
  assert.equal(m.levelAt(3.0, 1.5), 0);
  assert.equal(m.levelAt(4.0, 1.5), -1.5);
  assert.ok(Math.abs(m.levelAt(4.5, 1.5) + 2.25) < 1e-9);
  const down = parseStation(['###', '#S#', '#.#', '#v#', '#v#', '#_#', '###'].join('\n'));
  assert.equal(down.levelAt(1.5, 3.0), 0);
  assert.equal(down.levelAt(1.5, 4.0), -1.5);
  assert.equal(down.levelAt(1.5, 5.0), -3);
  const left = parseStation(['#####', '#_<<.', '#####'].join('\n'));
  assert.equal(left.levelAt(4.0, 1.5), 0, 'the run starts at its right edge');
  assert.equal(left.levelAt(2.0, 1.5), -3);
});

test('solid tiles and the edge of the map block', () => {
  const m = parseStation(TINY);
  assert.equal(m.solidAt(0.5, 0.5), true, 'wall');
  assert.equal(m.solidAt(1.5, 1.5), false, 'spawn');
  assert.equal(m.solidAt(3.5, 1.5), false, 'stairs');
  assert.equal(m.solidAt(3.5, 4.5), true, 'track');
  assert.equal(m.solidAt(-0.5, 1.5), true, 'off the map');
  assert.equal(m.solidAt(1.5, 99), true, 'off the map');
});

test('a short row is padded with wall', () => {
  const m = parseStation(['####', '#S.', '####'].join('\n'));
  assert.equal(m.cols, 4);
  assert.equal(m.at(3, 1).ch, '#');
});

test('tracks are bands of = rows', () => {
  assert.deepEqual(parseStation(TINY).tracks, [{ z0: 4, z1: 5, z: 4.5, y: LEVEL.track }]);
});

test('the shipped station', () => {
  const m = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
  assert.equal(m.name, 'MUSEUM');
  assert.equal(m.cols, 48);
  assert.equal(m.rows, 19);
  assert.deepEqual(m.spawn, { x: 2.5, z: 9.5 });
  assert.equal(m.exits.length, 3);
  assert.equal(m.signs.length, 4);
  assert.deepEqual(m.tracks.map((t) => [t.z0, t.z1]), [[1, 4], [15, 18]]);
  assert.equal(m.tubes.length, 11, 'five over the platform, six over the hall');
  assert.equal(m.levelAt(14.0, 9.5), 0, 'top of the stairs');
  assert.equal(m.levelAt(20.0, 9.5), -3, 'foot of the stairs');
  for (const t of m.tubes) assert.ok(!m.solidAt(t.x, t.z) || m.at(Math.floor(t.x), Math.floor(t.z)).ch === '|', 'tubes hang over floor');
});
