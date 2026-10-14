import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureGlyphs } from '../src/render/figures.js';
import { createMotionMemory } from '../src/stick.js';
import { createSpriteCache, SPRITE_CAP } from '../src/render/canvas.js';
import { FIG_EXTRA } from '../src/render/gl.js';
import fs from 'node:fs';

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

test('rot, len and flip pass through from the pose; labels and strips are upright, unstretched and unflipped', () => {
  const g = run([body({ say: 'hi', state: { ...body().state, facing: -1, gun: 'rifle' } })]);
  const fig = g.filter((x) => x.bold), labels = g.filter((x) => !x.bold);
  assert.ok(fig.some((x) => x.rot !== 0) && fig.some((x) => x.len !== 1) && fig.some((x) => x.flip === true));
  assert.ok(fig.every((x) => Number.isFinite(x.rot) && x.len > 0 && typeof x.flip === 'boolean'));
  assert.ok(labels.length > 0 && labels.every((x) => x.rot === 0 && x.len === 1 && x.flip === false));
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
  // The best of 5 batches, so another process busy on the machine doesn't fail it.
  let best = Infinity;
  for (let b = 0; b < 5; b++) {
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 20; k++) figureGlyphs(bodies, { t: (b * 20 + k) / 60, view, ceiling: 1, memory });
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6 / 20);
  }
  assert.ok(best < 1, `${best.toFixed(3)} ms a frame`);
});

test('the canvas sprite cache keeps what it made, and starts over once it reaches its cap', () => {
  assert.equal(SPRITE_CAP, 2000);
  const cache = createSpriteCache(3);
  const a = cache.set('a', { n: 1 });
  assert.equal(cache.get('a'), a);
  cache.set('b', {});
  cache.set('c', {});
  assert.equal(cache.size, 3);
  cache.set('d', {});
  assert.ok(cache.size <= 3, `${cache.size} sprites`);
  assert.ok(cache.get('d'));
  for (let i = 0; i < 10000; i++) cache.set(`k${i}`, {});
  assert.ok(cache.size <= 3);
});

test('the GL figure atlas has every glyph the figure layer can be given (else WebGL draws it as ?)', () => {
  // Every non-ASCII character in a string literal of the modules that feed world.figures.
  for (const f of ['../src/stick.js', '../src/fx.js', '../src/fight.js', '../src/render/figures.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const [, lit] of src.matchAll(/'([^'\n]*)'/g)) for (const ch of lit) {
      if (ch.charCodeAt(0) < 127) continue;
      assert.ok(FIG_EXTRA.includes(ch), `${f}: '${ch}' is not in the GL figure atlas`);
    }
  }
  for (const ch of '♥★') assert.ok(FIG_EXTRA.includes(ch), `main.js's ${ch}`);
});
