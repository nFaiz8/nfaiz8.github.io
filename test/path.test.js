import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../src/path.js';

const grid = (rows) => (x, y) => rows[y][x] !== '#';

test('finds the shortest path around a wall', () => {
  const rows = ['.....', '.###.', '.....'];
  const p = findPath(5, 3, grid(rows), 0, 1, 4, 1);
  assert.equal(p.length, 6);
  assert.deepEqual(p.at(-1), { x: 4, y: 1 });
});

test('returns null when blocked and [] when already there', () => {
  const rows = ['..#..', '..#..'];
  assert.equal(findPath(5, 2, grid(rows), 0, 0, 4, 0), null);
  assert.deepEqual(findPath(5, 2, grid(rows), 1, 1, 1, 1), []);
});
