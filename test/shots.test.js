import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { impactPixels, shotName, IMPACT_FILTER } from '../src/shots.js';

test('impactPixels: the CSS impact look (invert, grey, contrast 4): dark goes white, light goes black, mid-grey stays', () => {
  const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 200, 255, 0, 0, 255]);
  impactPixels(d);
  assert.deepEqual([...d.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...d.slice(4, 8)], [0, 0, 0, 255]);
  assert.deepEqual([...d.slice(8, 12)], [126, 126, 126, 200], 'alpha kept');
  // Pure red is dark to the eye (0.2126): inverted, it is light, and contrast 4 pushes it to white.
  assert.deepEqual([...d.slice(12, 16)], [255, 255, 255, 255]);
});

test('the baked filter is the same as the stage\'s CSS one', () => {
  const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`#stage\\.impact canvas \\{ filter: ${IMPACT_FILTER.replace(/[()]/g, '\\$&')}; \\}`));
});

test('shotName: impact-YYYY-MM-DD-HH-MM-SS.png in local time', () => {
  assert.equal(shotName(new Date(2026, 9, 14, 21, 5, 9).getTime()), 'impact-2026-10-14-21-05-09.png');
});
