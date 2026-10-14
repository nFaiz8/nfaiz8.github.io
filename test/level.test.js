import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind, levelHash, AIR, PLATFORM, SOLID, LEVEL_COLS, LEVEL_ROWS } from '../src/level.js';

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
  assert.equal(k(204, 25), SOLID);
  assert.equal(k(5, 33), SOLID);
  assert.equal(k(5, -1), SOLID);
  assert.equal(k(0, 21), PLATFORM);
});

test('levelHash: 8 hex, stable, ignores \\r, and changes with one character', () => {
  assert.match(levelHash(text), /^[0-9a-f]{8}$/);
  assert.equal(levelHash(text), levelHash(text.replace(/\n/g, '\r\n')));
  assert.notEqual(levelHash(text), levelHash(text.replace('S', ' ')));
  assert.equal(levelHash(''), '811c9dc5');
});

// The train level (train level addendum §1): two cutaway subway cars in a tunnel.
const row = (r, c0, c1) => [...Array(c1 - c0 + 1)].map((_, k) => at(c0 + k, r));
const all = (r, c0, c1, kind) => row(r, c0, c1).every((k) => k === kind);

test('the train level is 204 × 33 and parses at its own size by default', () => {
  assert.equal(LEVEL_COLS, 204);
  assert.equal(LEVEL_ROWS, 33);
  assert.equal(L.cols, 204);
  assert.equal(L.rows, 33);
  assert.equal(L.cells.length, 204 * 33);
});

test('the collision table: ceiling, roofs, lintels, the full-width floor and the climbing ledges', () => {
  for (const r of [0, 1]) assert.ok(all(r, 0, 203, SOLID), `ceiling row ${r}`);
  for (const [a, b] of [[2, 97], [104, 199]]) {
    for (const r of [8, 9, 10]) assert.ok(all(r, a, b, SOLID), `roof row ${r}, cols ${a}–${b}`);
    for (const c of [a, a + 1, b - 1, b]) {
      for (const r of [11, 12, 13]) assert.equal(at(c, r), SOLID, `lintel ${c},${r}`);
      for (let r = 14; r <= 25; r++) assert.equal(at(c, r), AIR, `doorway ${c},${r}`);
    }
    for (let r = 11; r <= 25; r++) assert.ok(all(r, a + 2, b - 2, AIR), `the car's inside, row ${r}`);
  }
  for (const r of [26, 27]) assert.ok(all(r, 0, 203, SOLID), `floor row ${r}`);
  for (let r = 28; r <= 32; r++) assert.ok(all(r, 0, 203, AIR), `undercarriage row ${r} is air`);
  for (const [c0, c1] of [[0, 1], [98, 103], [200, 203]]) {
    for (const r of [21, 16, 11]) assert.ok(all(r, c0, c1, PLATFORM), `ledge row ${r}, cols ${c0}–${c1}`);
    for (let r = 2; r <= 25; r++) if (![21, 16, 11].includes(r)) assert.ok(all(r, c0, c1, AIR), `gap ${c0}–${c1}, row ${r}`);
  }
  for (let r = 2; r <= 7; r++) assert.ok(all(r, 0, 203, AIR), `the roof strip, row ${r}`);
  // Nothing else: every non-air cell is one of the above.
  const count = L.cells.reduce((n, k) => n + (k !== AIR), 0);
  assert.equal(count, 204 * 2 + 2 * 96 * 3 + 2 * 4 * 3 + 204 * 2 + 3 * (2 + 6 + 4));
});

test('the door: a D marker on the floor line at the right end, air, with the body standing in it', () => {
  assert.deepEqual(L.door, { c: 203, r: 25, x: 203.5, y: 24.5 });
  assert.equal(at(203, 25), AIR);
  assert.equal(at(203, 26), SOLID, 'the floor under it');
  const T = parseLevel(' D\n══\n', 2, 2);
  assert.deepEqual(T.door, { c: 1, r: 0, x: 1.5, y: -0.5 });
  assert.equal(parseLevel('   \n', 3, 1).door, null, 'no D, no door');
});

test('spawns: at least 6, on both car floors and both roofs', () => {
  assert.ok(L.spawns.length >= 6, `${L.spawns.length} spawns`);
  const where = (s) => (s.r === 25 ? 'floor' : s.r === 7 ? 'roof' : 'other') + (s.c < 100 ? 'A' : 'B');
  const seen = new Set(L.spawns.map(where));
  for (const w of ['floorA', 'floorB', 'roofA', 'roofB']) assert.ok(seen.has(w), `a spawn on ${w}`);
  assert.ok(!seen.has('otherA') && !seen.has('otherB'), 'only on the floors and roofs');
});

test('every spawn and pickup: air with 2 more rows of air above, something to stand on, none within 10 columns of the door', () => {
  for (const m of [...L.spawns, ...L.pickups]) {
    for (let r = m.r - 2; r <= m.r; r++) assert.equal(at(m.c, r), AIR, `${m.c},${r}`);
    assert.notEqual(at(m.c, m.r + 1), AIR, `nothing under ${m.c},${m.r}`);
  }
  for (const s of L.spawns) assert.ok(s.c < L.cols - 10, `spawn ${s.c} too near the door`);
});

test('pickups: a rifle on car A\'s roof near col 82, the sniper on car B\'s floor near col 178', () => {
  assert.deepEqual(L.pickups.map(({ n, gun, r }) => ({ n, gun, r })), [{ n: 0, gun: 'rifle', r: 7 }, { n: 1, gun: 'sniper', r: 25 }]);
  assert.ok(Math.abs(L.pickups[0].c - 82) <= 3 && L.pickups[0].c >= 2 && L.pickups[0].c <= 97, `rifle at ${L.pickups[0].c}`);
  assert.ok(Math.abs(L.pickups[1].c - 178) <= 3 && L.pickups[1].c >= 106 && L.pickups[1].c <= 197, `sniper at ${L.pickups[1].c}`);
});
