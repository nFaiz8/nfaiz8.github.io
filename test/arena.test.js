import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, AIR, PLATFORM, SOLID } from '../src/arena.js';

const text = fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8');

test('the level file is 50 lines of 240 characters, using only space, ═ and ▓', () => {
  const lines = text.replace(/\n$/, '').split('\n');
  assert.equal(lines.length, 50);
  lines.forEach((l, i) => {
    assert.equal([...l].length, 240, `line ${i + 1}`);
    assert.match(l, /^[ ═▓]*$/, `line ${i + 1}`);
  });
});

test('the 4 columns by the door are clear in the bottom 3 rows', () => {
  const L = parseLevel(text);
  for (let r = L.rows - 3; r < L.rows; r++) for (let c = L.cols - 4; c < L.cols; c++) assert.equal(L.cells[r * L.cols + c], AIR, `${c},${r}`);
});

test('every platform and every block top can be reached from the floor', () => {
  // A standing spot reaches another if it is at most 5 rows up and within 12 columns (a jump is ~6 rows).
  const L = parseLevel(text);
  const at = (c, r) => (r < 0 ? AIR : L.cells[r * L.cols + c]);
  const surfaces = [{ row: L.rows, x0: 0, x1: L.cols - 1 }]; // the floor
  for (let r = 0; r < L.rows; r++) {
    let s = -1;
    for (let c = 0; c <= L.cols; c++) {
      const top = c < L.cols && at(c, r) !== AIR && at(c, r - 1) === AIR;
      if (top && s < 0) s = c;
      if (!top && s >= 0) { surfaces.push({ row: r, x0: s, x1: c - 1 }); s = -1; }
    }
  }
  const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const i = queue.shift();
    surfaces.forEach((s, j) => {
      if (!seen.has(j) && surfaces[i].row - s.row <= 5 && gap(surfaces[i], s) <= 12) { seen.add(j); queue.push(j); }
    });
  }
  const lost = surfaces.filter((_, j) => !seen.has(j)).map((s) => `row ${s.row} cols ${s.x0}-${s.x1}`);
  assert.deepEqual(lost, []);
});

test('parseLevel: ═ is a platform, ▓ is solid, anything else is air, and short input is padded', () => {
  const L = parseLevel('═▓x\n');
  assert.equal(L.cols, 240);
  assert.equal(L.rows, 50);
  assert.deepEqual([...L.cells.slice(0, 4)], [PLATFORM, SOLID, AIR, AIR]);
  assert.equal(L.cells[49 * 240 + 239], AIR);
});
