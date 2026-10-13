import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePixels } from '../src/analyze.js';
import { groupByColor, NEUTRAL } from '../src/colors.js';

// A w×h image filled by fn(x, y) → [r, g, b].
function image(fn, w = 40, h = 30) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([...fn(x, y), 255], (y * w + x) * 4);
  return d;
}

test('a greyscale photo has no colour, even with a full tonal range', () => {
  const a = analyzePixels(image((x) => { const v = x * 6; return [v, v, v]; }));
  assert.ok(a.score < NEUTRAL, `score ${a.score}`);
});

test('a dark, moody colour photo still counts as colour', () => {
  // Mostly near-black with deep red and teal tones: the kind of photo a palette ranks as colourless.
  const a = analyzePixels(image((x, y) => (y < 20 ? [14, 12, 12] : x < 20 ? [70, 22, 18] : [16, 52, 58])));
  assert.ok(a.score >= NEUTRAL, `score ${a.score}`);
});

test('dominant hue follows the most colourful area', () => {
  const sky = analyzePixels(image((x, y) => (y < 22 ? [70, 130, 200] : [60, 60, 60])));
  assert.ok(sky.hue > 200 && sky.hue < 225, `sky hue ${sky.hue}`);
  const sunset = analyzePixels(image((x, y) => (y < 10 ? [240, 120, 40] : [30, 25, 30])));
  assert.ok(sunset.hue > 15 && sunset.hue < 35, `sunset hue ${sunset.hue}`);
});

test('measured colour decides the room, not the palette', () => {
  const p = (id, analysis) => ({ id, palette: ['#050505', '#101010'], analysis, aspect: 1.5, width: 3, height: 2 });
  const moody = Array.from({ length: 6 }, (_, i) => p(`m${i}`, { hue: 5 + i, sat: 0.5, score: 0.6, lum: 0.1 }));
  const bw = Array.from({ length: 3 }, (_, i) => p(`g${i}`, { hue: 0, sat: 0, score: 0, lum: 0.2 + i * 0.1 }));
  const rooms = groupByColor([...moody, ...bw]);
  const dark = rooms.find((r) => r.id === 'silver');
  assert.deepEqual(dark.photos.map((x) => x.id).sort(), ['g0', 'g1', 'g2']);
  assert.ok(rooms.some((r) => r.hue != null && r.id !== 'silver' && r.photos.some((x) => x.id === 'm0')));
});
