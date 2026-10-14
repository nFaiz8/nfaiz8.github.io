import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureGlyphs } from '../src/render/figures.js';
import { createMotionMemory } from '../src/stick.js';

const view = { left: 0, top: 0, cols: 150, rows: 40 };
const body = (o = {}) => ({ id: 'b', state: { x: 50, y: 20, vx: 0, vy: 0, facing: 1, ground: true, act: 'idle', actT: 0, gun: 'deagle' }, color: [120, 200, 255], name: 'Ann', ...o });
const run = (bodies, o = {}) => figureGlyphs(bodies, { t: 0, view, ceiling: 1, memory: createMotionMemory(), ...o });

test('a body becomes bold glyphs in its colour with its name centred above the head', () => {
  const g = run([body()]);
  const fig = g.filter((x) => x.bold);
  assert.ok(fig.length >= 6 && fig.every((x) => x.color[2] === 255 || x.a === 0));
  const name = g.filter((x) => !x.bold && Math.abs(x.y - (20 - 2.2)) < 1e-9).map((x) => x.ch).join('');
  assert.equal(name, 'Ann');
});

test('labels come after every figure; my own figure has no name', () => {
  const g = run([body({ id: 'me', me: true, name: '' }), body({ id: 'b', state: { ...body().state, x: 60 } })]);
  const lastFig = g.map((x) => x.bold).lastIndexOf(true), firstLabel = g.findIndex((x) => !x.bold);
  assert.ok(firstLabel > lastFig);
});

test('chat sits above the name with a dark strip one cell wider each side; near the ceiling the stack flips below the feet', () => {
  const g = run([body({ say: 'hi' })]);
  const strips = g.filter((x) => x.strip);
  assert.equal(strips.length, 4);
  assert.ok(strips.every((x) => Math.abs(x.y - (20 - 3.3)) < 1e-9 && x.a === 0.6));
  const high = run([body({ say: 'hi', state: { ...body().state, y: 4 } })], { ceiling: 1 });
  assert.ok(high.filter((x) => !x.bold && !x.strip).every((x) => x.y > 4));
});

test('phones cut long names to 11 characters and …', () => {
  const g = run([body({ name: 'abcdefghijklmno' })], { phone: true });
  assert.equal(g.filter((x) => !x.bold && !x.strip).map((x) => x.ch).join(''), 'abcdefghijk…');
});

test('bodies off screen or with bad coordinates are skipped', () => {
  assert.equal(run([body({ state: { ...body().state, x: 400 } })]).length, 0);
  assert.equal(run([body({ state: { ...body().state, y: NaN } })]).length, 0);
});

test('thirty bodies cost well under 2 ms', () => {
  const bodies = Array.from({ length: 30 }, (_, i) => body({ id: `b${i}`, say: 'hello there', state: { ...body().state, x: 5 + i * 4, vx: 30 } }));
  const memory = createMotionMemory();
  for (let k = 0; k < 50; k++) figureGlyphs(bodies, { t: k / 60, view, ceiling: 1, memory });
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 100; k++) figureGlyphs(bodies, { t: k / 60, view, ceiling: 1, memory });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
  assert.ok(ms < 1, `${ms.toFixed(3)} ms a frame`);
});
