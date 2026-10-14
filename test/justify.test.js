import { test } from 'node:test';
import assert from 'node:assert/strict';
import { justify } from '../src/justify.js';

const W = 390, H = 120, GAP = 4;
const rowWidth = (row) => row.items.reduce((s, t) => s + t.w, 0) + GAP * (row.items.length - 1);

test('every tile keeps its photo\'s shape, so nothing is cropped', () => {
  const aspects = [1.5, 0.667, 1, 3.8, 1.78, 0.8, 1.5, 1.5, 2.4, 0.75, 1.33, 5.2, 1];
  const rows = justify(aspects, W, H, GAP);
  const tiles = rows.flatMap((r) => r.items);
  assert.equal(tiles.length, aspects.length);
  tiles.forEach((t, i) => {
    assert.equal(t.i, i);
    assert.ok(Math.abs(t.w / t.h - aspects[i]) < 0.01, `tile ${i}: ${t.w / t.h} vs ${aspects[i]}`);
  });
});

test('full rows exactly fill the width; the last row is not stretched', () => {
  const rows = justify([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], W, H, GAP);
  for (const r of rows.slice(0, -1)) assert.ok(Math.abs(rowWidth(r) - W) < 0.5, `row ${rowWidth(r)}`);
  const last = rows[rows.length - 1];
  assert.ok(rowWidth(last) <= W);
  assert.equal(last.h, H);
});

test('a panorama wider than the screen gets a row to itself, scaled down', () => {
  const rows = justify([1.5, 6, 1.5], W, H, GAP);
  const pano = rows.find((r) => r.items.some((t) => t.i === 1));
  assert.equal(pano.items.length, 1);
  assert.ok(Math.abs(pano.items[0].w - W) < 0.5);
  assert.ok(Math.abs(pano.items[0].h - W / 6) < 0.5);
});

test('rows stay close to the target height', () => {
  const rows = justify([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.7, 2, 1.5, 1.3, 0.8, 1.5], 1200, 200, 6);
  for (const r of rows) assert.ok(r.h > 200 * 0.6 && r.h < 200 * 1.6, `row height ${r.h}`);
});

test('no photos makes no rows', () => {
  assert.deepEqual(justify([], W, H, GAP), []);
});
