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

test('the departures board counts down to the next two trains, then warns', async () => {
  const { departures, minutes, SERVICE } = await import('../src/rpg/train.js');
  assert.equal(minutes(10), '<1 MIN');
  assert.equal(minutes(45), '1 MIN');
  assert.equal(minutes(130), '2 MIN');
  const s0 = startOf(0), s1 = startOf(1);
  const d = departures(s0 - SERVICE - 1, MAP);
  assert.equal(d.warn, false);
  assert.match(d.lines[0], /^NEXT TRAIN +<1 MIN$/);
  assert.match(d.lines[1], new RegExp(`^THEN +${minutes(s1 - (s0 - SERVICE - 1))}$`));
  assert.equal(d.lines[0].length, d.lines[1].length, 'right-aligned');
  // From SERVICE seconds before it until it has gone: not in service, stand back (blinking, or steady).
  const w = departures(s0 - 1, MAP, false);
  assert.equal(w.warn, true);
  assert.match(w.lines.join('|'), /NOT IN SERVICE.*\|.*STAND BACK/);
  assert.equal(departures(s0 + travel / 2, MAP).warn, true);
  const after = departures(s0 + travel + 0.1, MAP);
  assert.equal(after.warn, false);
  assert.match(after.lines[0], /NEXT TRAIN/);
  // The text only changes now and then, so the board seldom redraws.
  let changes = 0, last = '';
  for (let t = 0; t < 120; t += 0.25) { const k = departures(t, MAP).lines.join('|'); if (k !== last) changes++; last = k; }
  assert.ok(changes < 120 * 2.5, `${changes} redraws in two minutes`);
});
