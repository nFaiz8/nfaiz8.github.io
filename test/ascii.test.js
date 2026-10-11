import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCells, stretchRange, developCell, RAMP } from '../src/ascii.js';

const img = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y);
    data.set([r, g, b, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
};

test('a horizontal gradient gives a non-decreasing glyph ramp from space to @', () => {
  const cells = toCells(img(100, 10, (x) => [x * 2.55, x * 2.55, x * 2.55]), 10, 1);
  const g = [...cells.glyph];
  for (let i = 1; i < g.length; i++) assert.ok(g[i] >= g[i - 1]);
  assert.equal(RAMP[g[0]], ' ');
  assert.equal(RAMP[g[9]], '@');
});

test('a dark image is stretched to use the whole ramp', () => {
  const cells = toCells(img(100, 10, (x) => [x * 0.4, x * 0.4, x * 0.4]), 10, 1);
  assert.equal(cells.glyph[0], 0);
  assert.equal(cells.glyph[9], RAMP.length - 1);
});

test('uniform images do not divide by zero', () => {
  const r = stretchRange(img(4, 4, () => [128, 128, 128]).data);
  assert.ok(r.hi > r.lo);
  const cells = toCells(img(4, 4, () => [128, 128, 128]), 2, 2);
  assert.ok([...cells.glyph].every((g) => Number.isFinite(g)));
});

test('mono mode only uses red-dominant colours', () => {
  const cells = toCells(img(20, 20, (x, y) => [x * 12, y * 12, 200]), 4, 4, { mono: true });
  for (let k = 0; k < 16; k++) assert.ok(cells.fg[k * 3] > cells.fg[k * 3 + 1] && cells.fg[k * 3] > cells.fg[k * 3 + 2]);
});

test('develop reveals shadows first and blends red to colour', () => {
  assert.equal(developCell(0.9, [0, 200, 0], 0.5, 0).blank, true); // highlight, low exposure → still paper
  assert.equal(developCell(0.2, [0, 200, 0], 0.9, 0).blank, false); // shadow shows
  const full = developCell(0.2, [0, 200, 0], 1, 1);
  assert.deepEqual(full.fg, [0, 200, 0]);
});
