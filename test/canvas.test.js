import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCanvasRenderer } from '../src/render/canvas.js';
import { parseLevel } from '../src/level.js';
import { buildTrain, frameAt } from '../src/train.js';

// A 2D context that accepts every call and every property (enough to run the renderer without a browser).
function stubContext() {
  const fns = new Map();
  return new Proxy({}, {
    get(o, k) {
      if (k in o) return o[k];
      if (!fns.has(k)) fns.set(k, k === 'measureText' ? () => ({ width: 1 }) : () => {});
      return fns.get(k);
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
class StubCanvas {
  constructor(w = 0, h = 0) { this.width = w; this.height = h; }
  getContext() { return stubContext(); }
}

test('canvas: a resize while the zoom eases keeps drawing (the figure atlas is never left unset)', () => {
  const had = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = StubCanvas;
  try {
    const r = createCanvasRenderer();
    r.init(new StubCanvas(), { rooms: [], frames: [], arena: { x: 0, y: 0, cols: 204, rows: 33 } });
    const world = { mode: 'side', cam: { x: 50, y: 20 }, figures: [{ x: 50, y: 20, ch: 'O', color: [255, 206, 110], a: 1 }] };
    r.resize(852, 393, 2);
    r.setView({ rows: 20, settled: true });
    r.draw(world);
    r.setView({ rows: 25, settled: false }); // a gun pickup: the zoom eases
    r.resize(852, 393, 2); // the phone turns, or its URL bar collapses
    r.setView({ rows: 26, settled: false });
    assert.doesNotThrow(() => r.draw(world));
  } finally {
    globalThis.OffscreenCanvas = had;
  }
});

test('canvas: the train\'s fields (backgrounds, colours, glow) reuse their ImageData frame to frame', () => {
  const had = [globalThis.OffscreenCanvas, globalThis.ImageData];
  let made = 0;
  globalThis.OffscreenCanvas = StubCanvas;
  globalThis.ImageData = class { constructor(data, w, h) { made++; this.data = data; this.width = w; this.height = h; } };
  try {
    const level = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
    const T = buildTrain(level);
    const r = createCanvasRenderer();
    r.init(new StubCanvas(), { rooms: [], frames: [], arena: { x: 0, y: 0, w: 206, h: 35, cols: 204, rows: 33 } });
    r.resize(852, 393, 2);
    r.setView({ rows: 20, settled: true });
    const world = (t) => ({ mode: 'side', cam: { x: 60, y: 20 }, figures: [],
      train: { T, F: frameAt(t), look: 'line', glows: [{ x: 50, y: 18, c: [255, 220, 160] }] } });
    r.draw(world(0));
    const first = made;
    assert.ok(first > 0 && first <= 3, `the first frame makes its fields (${first})`);
    for (let k = 1; k <= 5; k++) r.draw(world(k * 16));
    assert.equal(made, first, 'later frames of the same size make none');
  } finally {
    [globalThis.OffscreenCanvas, globalThis.ImageData] = had;
  }
});
