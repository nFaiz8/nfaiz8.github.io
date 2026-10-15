import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { trainAt, startOf, TRAIN, LENGTH } from '../src/rpg/train.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const travel = (MAP.cols + LENGTH + 4) / TRAIN.speed;

test('trains come every 30 to 40 seconds', () => {
  for (let n = 0; n < 60; n++) {
    const gap = startOf(n + 1) - startOf(n);
    assert.ok(gap >= 30 && gap <= 40, `gap ${n}: ${gap}`);
  }
  assert.ok(startOf(0) >= TRAIN.warn, 'the first warning starts after you arrive');
});

test('nothing at first, then the tunnel glows, then the train passes', () => {
  assert.equal(trainAt(0, MAP), null);
  const s = startOf(0);
  const w = trainAt(s - 1.5, MAP);
  assert.equal(w.phase, 'warn');
  assert.ok(Math.abs(w.warn - 0.5) < 1e-9);
  assert.equal(w.head, null);
  const p = trainAt(s + 0.5, MAP);
  assert.equal(p.phase, 'pass');
  assert.ok(Math.abs(p.head - (-2 + 12.5)) < 1e-9, `head ${p.head}`);
  assert.ok(Math.abs(p.tail - (p.head - LENGTH)) < 1e-9);
  assert.equal(trainAt(s + travel + 0.01, MAP), null, 'gone into the far tunnel');
});

test('trains alternate tracks and directions', () => {
  const a = trainAt(startOf(0) + 0.1, MAP), b = trainAt(startOf(1) + 0.1, MAP), c = trainAt(startOf(2) + 0.1, MAP);
  assert.notEqual(a.track, b.track);
  assert.equal(a.track, c.track);
  assert.equal(a.dir, 1);
  assert.equal(b.dir, -1);
  assert.ok(Math.abs(b.head - (MAP.cols + 2 - 2.5)) < 1e-9, 'westbound comes from the east tunnel');
});

test('one train at a time, and the same every time', () => {
  for (let t = 0; t < 400; t += 0.37) {
    const x = trainAt(t, MAP), y = trainAt(t, MAP);
    assert.deepEqual(x, y);
    if (x && x.phase === 'pass') assert.ok(x.head > -3 - LENGTH && x.head < MAP.cols + 3 + LENGTH);
  }
});

test('a map with no tracks has no train', () => {
  assert.equal(trainAt(20, parseStation('###\n#S#\n###')), null);
});
