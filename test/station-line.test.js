import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, LINE, STOPS, TRACKS, STRETCHES, pieceAt, trussShade, sunAt, lampAt, TRUSS } from '../src/rpg/line.js';

test('the pieces join end to end, from the west tunnel to the east one, and the stations are the stops', () => {
  for (let i = 1; i < PIECES.length; i++) assert.equal(PIECES[i].x0, PIECES[i - 1].x1, `piece ${i} starts where ${i - 1} ends`);
  assert.deepEqual([LINE.x0, LINE.x1], [PIECES[0].x0, PIECES.at(-1).x1]);
  assert.deepEqual(PIECES.map((p) => p.kind), ['tunnel', 'station', 'tunnel', 'bridge', 'tunnel', 'station', 'tunnel']);
  for (const p of PIECES.filter((p) => p.kind === 'station')) {
    const s = STOPS[p.stop];
    assert.deepEqual([p.x0, p.x1], [s.x, s.x + s.cols]);
    assert.ok(s.centre > s.x && s.centre < s.x + s.cols);
  }
  assert.equal(STOPS[0].x, 0, "MUSEUM's map coordinates are line coordinates");
  assert.deepEqual(STOPS.map((s) => s.name), ['MUSEUM', 'CANAL ST']);
  assert.deepEqual(TRACKS.map((t) => [t.z, t.dir]), [[2.5, 1], [16.5, -1]]);
  assert.equal(STRETCHES[0][0], LINE.x0);
  assert.equal(STRETCHES.at(-1)[1], LINE.x1);
  for (let i = 1; i < STRETCHES.length; i++) assert.equal(STRETCHES[i][0], STRETCHES[i - 1][1]);
});

test('pieceAt finds the piece, and the line ends clamp', () => {
  assert.equal(pieceAt(50).kind, 'station');
  assert.equal(pieceAt(400).kind, 'bridge');
  assert.equal(pieceAt(-5000), PIECES[0]);
  assert.equal(pieceAt(99999), PIECES.at(-1));
});

test('the truss strobes the sun: dark behind each post, dimmer where the braces cross, bright between', () => {
  assert.equal(trussShade(0.1), 0);
  assert.equal(trussShade(TRUSS.bay + 0.1), 0, 'every bay');
  assert.ok(trussShade(TRUSS.bay / 2) < 0.5);
  assert.equal(trussShade(2), 1);
  assert.equal(trussShade(-TRUSS.bay + 2), 1, 'west of 0 too');
});

test('the sun only reaches the bridge, easing in at its ends; tunnel lamps every 12 tiles', () => {
  const b = PIECES.find((p) => p.kind === 'bridge');
  assert.equal(sunAt(b.x0 - 1), 0);
  assert.equal(sunAt((b.x0 + b.x1) / 2), 1);
  assert.ok(sunAt(b.x0 + 5) > 0 && sunAt(b.x0 + 5) < 1);
  assert.equal(sunAt(b.x1 + 1), 0);
  assert.equal(lampAt(12 * 20), 1);
  assert.equal(lampAt(12 * 20 + 6), 0);
});
