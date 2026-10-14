import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind, levelHash, AIR, PLATFORM, SOLID } from '../src/level.js';

const text = fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8');
const L = parseLevel(text);
const at = (c, r) => L.cells[r * L.cols + c];

test('S, R and N are air, returned in reading order with the body centre standing there', () => {
  const T = parseLevel(' S\nR N\n═══\n', 3, 3);
  assert.deepEqual([...T.cells], [AIR, AIR, AIR, AIR, AIR, AIR, PLATFORM, PLATFORM, PLATFORM]);
  assert.deepEqual(T.spawns, [{ c: 1, r: 0, x: 1.5, y: -0.5 }]);
  assert.deepEqual(T.pickups, [{ n: 0, gun: 'rifle', c: 0, r: 1, x: 0.5, y: 0.5 }, { n: 1, gun: 'sniper', c: 2, r: 1, x: 2.5, y: 0.5 }]);
});

test('levelKind: inside is the level, outside is solid (walls, floor, ceiling and the door)', () => {
  const k = levelKind(L);
  assert.equal(k(-1, 5), SOLID);
  assert.equal(k(160, 32), SOLID);
  assert.equal(k(5, 34), SOLID);
  assert.equal(k(5, -1), SOLID);
  assert.equal(k(0, 29), PLATFORM);
});

test('levelHash: 8 hex, stable, ignores \\r, and changes with one character', () => {
  assert.match(levelHash(text), /^[0-9a-f]{8}$/);
  assert.equal(levelHash(text), levelHash(text.replace(/\n/g, '\r\n')));
  assert.notEqual(levelHash(text), levelHash(text.replace('S', ' ')));
  assert.equal(levelHash(''), '811c9dc5');
});

test('the Penn Station level has 6 spawns: two on the yellow line, two mid, two high, one of each pair per half', () => {
  assert.equal(L.spawns.length, 6);
  const rows = L.spawns.map((s) => s.r);
  assert.equal(rows.filter((r) => r === 28).length, 2);
  const line = L.spawns.filter((s) => s.r === 28).map((s) => s.c).sort((a, b) => a - b);
  assert.ok(line[0] < 35 && line[1] > 42 && line[1] < 133, 'one west of the left pillar, one between the pillars');
  const pairs = [L.spawns.filter((s) => s.r === 28), L.spawns.filter((s) => s.r >= 10 && s.r < 28), L.spawns.filter((s) => s.r < 10)];
  for (const p of pairs) {
    assert.equal(p.length, 2);
    assert.equal(p.filter((s) => s.c < 80).length, 1, 'one in each half');
  }
});

test('every spawn and pickup: air with 2 more rows of air above, something to stand on, none within 10 columns of the door, none in the track bed', () => {
  for (const m of [...L.spawns, ...L.pickups]) {
    for (let r = m.r - 2; r <= m.r; r++) assert.equal(at(m.c, r), AIR, `${m.c},${r}`);
    assert.notEqual(at(m.c, m.r + 1), AIR, `nothing under ${m.c},${m.r}`);
    assert.ok(m.r + 1 <= 29, 'not in the track bed');
  }
  for (const s of L.spawns) assert.ok(s.c < L.cols - 10, `spawn ${s.c} too near the door`);
});

test('pickups: the sniper high in the middle, a rifle on each side', () => {
  assert.deepEqual(L.pickups.map(({ n, gun, c, r }) => ({ n, gun, c, r })), [
    { n: 0, gun: 'sniper', c: 118, r: 3 },
    { n: 1, gun: 'rifle', c: 150, r: 15 },
    { n: 2, gun: 'rifle', c: 26, r: 18 },
  ]);
});
