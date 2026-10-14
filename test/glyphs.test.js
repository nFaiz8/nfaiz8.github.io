import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellMetrics } from '../src/render/glyphs.js';

const view = (w, h) => { const m = cellMetrics(w, h); return { cols: Math.floor(w / m.cw), rows: Math.floor(h / m.ch) }; };

test('a landscape phone sees about as much of the gallery as a computer, not a 12-row close-up', () => {
  const v = view(852, 393);
  assert.ok(v.cols >= 120 && v.rows >= 28, `${v.cols}×${v.rows}`);
});

test('portrait phones and desktops are unchanged', () => {
  assert.deepEqual(cellMetrics(393, 852), cellMetrics(393));
  assert.deepEqual(cellMetrics(1440, 900), cellMetrics(1440));
  assert.ok(view(1440, 900).cols >= 150);
});
