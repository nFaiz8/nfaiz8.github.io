import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, AIR, SOLID, PLATFORM } from '../src/level.js';
import {
  buildTrain, tunnel, lightAt, frameAt, lookChar, cellColor, paint, paintWindow, halation, SPEED, CARS, TRAIN_GLYPHS, COLLISION, ACCENT, FLICKER_HZ,
} from '../src/train.js';

const level = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const T = buildTrain(level);
const at = (x, y) => y * T.W + x;
const kind = (x, y) => level.cells[at(x, y)];

test('buildTrain: the level\'s size, and deterministic (two builds are the same)', () => {
  assert.deepEqual([T.W, T.H], [204, 33]);
  const U = buildTrain(level);
  assert.deepEqual(U.ch, T.ch);
  assert.deepEqual(U.role, T.role);
  assert.deepEqual([...U.inside], [...T.inside]);
  assert.deepEqual([...U.shaft], [...T.shaft]);
  assert.deepEqual([...U.solid], [...T.solid]);
  assert.deepEqual(CARS, [[2, 98], [104, 200]]);
});

test('art and physics can\'t drift apart: collision roles are solid or platform, and every solid or platform cell is drawn as collision', () => {
  const COLL = new Set(['solid', 'lintel']);
  for (let y = 0; y < T.H; y++) for (let x = 0; x < T.W; x++) {
    const i = at(x, y), k = kind(x, y), r = T.role[i];
    if (COLL.has(r)) assert.notEqual(k, AIR, `${r} at ${x},${y} is air in the level`);
    assert.equal(T.solid[i], k === AIR ? 0 : 1, `collision mask at ${x},${y}`);
    // What you stand on (a top) and what you bump into from the side (a lintel) is drawn warm white.
    const top = k !== AIR && y > 0 && kind(x, y - 1) === AIR;
    if (top || (k === SOLID && y >= 11 && y <= 13)) assert.ok(COLL.has(r), `${x},${y} (${k === PLATFORM ? '═' : '▓'}) is drawn as ${r}`);
    if (k === PLATFORM) assert.equal(T.ch[i], '═');
  }
});

test('windows are holes you see the tunnel through, ad cards above them, and the shaft mask sits under them', () => {
  let holes = 0;
  for (const [a, b] of CARS) for (let x = a; x < b; x++) {
    const glass = T.role[at(x, 17)] === 'glass';
    for (let y = 15; y <= 19; y++) assert.equal(T.role[at(x, y)] === 'glass', glass, `a window is 5 rows tall (${x},${y})`);
    if (glass) {
      holes++;
      for (let y = 15; y <= 19; y++) assert.equal(T.ch[at(x, y)], null, `${x},${y} is a hole`);
      assert.equal(T.role[at(x, 14)], 'wframe');
      assert.equal(T.role[at(x, 13)], 'ad');
    }
    for (let y = 21; y <= 26; y++) assert.equal(!!T.shaft[at(x, y)], glass, `shaft at ${x},${y}`);
  }
  assert.equal(holes, 2 * 6 * 9, '6 windows of 9 panes a car');
  for (let y = 0; y < T.H; y++) for (let x = 0; x < T.W; x++) if (y < 21 || y > 26) assert.equal(T.shaft[at(x, y)], 0);
});

test('the car: poles on the mullions (never through a window or an ad), a bench, tubes, bogies and spoked wheels', () => {
  for (const [a] of CARS) {
    for (const x of [a + 17, a + 45, a + 73]) {
      for (let y = 13; y <= 25; y++) assert.equal(T.role[at(x, y)], 'pole', `pole ${x},${y}`);
      assert.notEqual(T.role[at(x, 17)], 'glass');
    }
    assert.equal(T.role[at(a + 20, 21)], 'seat');
    assert.equal(T.role[at(a + 10, 11)], 'tube');
    assert.equal(T.role[at(a + 10, 30)], 'spoke');
    assert.equal(T.role[at(a + 10, 29)], 'frame');
  }
  assert.equal(T.tubes.length, 10);
  assert.equal(T.tubes.filter((t) => t.flick).length, 1, 'one dying tube');
  assert.ok(T.tubes.find((t) => t.flick).x > 104, 'in car B');
  assert.equal(T.role[at(100, 18)], 'gang');
  assert.equal(T.role[at(100, 27)], 'coupler');
});

test('tunnel: whole cells only; the world scrolls left at SPEED; ribs every 16 cells, rails, a ceiling', () => {
  assert.equal(SPEED, 0.045);
  for (const t of [0, 17, 1000, 12345.6]) {
    const F = frameAt(t);
    assert.ok(Number.isInteger(F.off), `offset ${F.off}`);
    assert.equal(F.off, Math.floor(t * SPEED));
    for (const L of F.lamps) assert.ok(Number.isInteger(L.x), 'lamps move whole cells');
  }
  // The same u always looks the same: moving the world by a cell moves its glyphs by a cell.
  for (let y = 0; y < 33; y++) for (let u = 0; u < 400; u++) assert.deepEqual(tunnel(y, u), tunnel(y, u));
  assert.equal(tunnel(4, 300)[1], 'cable');
  assert.equal(tunnel(10, 304)[1], 'rib');
  assert.deepEqual(tunnel(0, 300), ['█', 'rock']);
  assert.equal(tunnel(32, 300)[1], 'rail');
  for (let y = 0; y < 33; y++) for (let u = 0; u < 3000; u++) assert.ok(!['═', '▓'].includes(tunnel(y, u)[0]), 'no collision glyphs in the tunnel');
});

test('a station passes every 1000 cells, 280 long, with its name on a tablet', () => {
  const band = (u) => tunnel(12, u)[1] === 'sband';
  for (let u = 0; u < 4000; u++) assert.equal(band(u), ((u % 1000) + 1000) % 1000 < 280, `u ${u}`);
  const name = (u0) => { let s = ''; for (let u = u0; u < u0 + 60; u++) if (tunnel(16, u)[1] === 'tabtx') s += tunnel(16, u)[0]; return s.trim(); };
  assert.equal(name(0), '34 ST');
  assert.equal(name(1000), '14 ST');
  assert.equal(name(3000), 'ARENA');
});

test('the dying tube changes state at most 3 times in any 1 s (WCAG 2.3.1); the others hold steady', () => {
  assert.ok(FLICKER_HZ <= 3);
  const k = T.tubes.findIndex((t) => t.flick);
  const changes = [];
  let last = frameAt(0).tubes[k];
  for (let t = 1; t <= 60000; t++) {
    const F = frameAt(t);
    if (F.tubes[k] !== last) { changes.push(t); last = F.tubes[k]; }
    if (t % 997 === 0) assert.ok(F.tubes.every((v, j) => j === k || v === 1), 'only one tube flickers');
  }
  assert.ok(changes.length > 20, `it does flicker (${changes.length} changes in a minute)`);
  for (let i = 3; i < changes.length; i++) assert.ok(changes[i] - changes[i - 3] > 1000, `4 changes within 1 s at ${changes[i - 3]} ms`);
});

test('Reduce Motion: one still frame, the dying tube dim and steady, no station in the room', () => {
  const a = frameAt(0, { reducedMotion: true }), b = frameAt(98765, { reducedMotion: true });
  assert.deepEqual(a, b);
  const k = T.tubes.findIndex((t) => t.flick);
  assert.ok(a.tubes[k] > 0 && a.tubes[k] < 0.5, `dim (${a.tubes[k]})`);
  for (let x = -2; x < T.W + 2; x++) assert.notEqual(tunnel(12, x + a.off)[1], 'sband', `a station at ${x}`);
});

test('lightAt: fluorescent inside, sodium outside, the window shaft lands under the window, a muzzle flash adds light', () => {
  const F = frameAt(0, { reducedMotion: true });
  const tube = T.tubes[0];
  const near = lightAt(tube.x, 13, 'in', F), far = lightAt(tube.x + 9, 24, 'in', F);
  assert.ok(near[1] > near[0] && near[1] > far[1], `cool fluorescent near a tube (${near.map((v) => v.toFixed(2))})`);
  const lamp = F.lamps.find((L) => L.set === 'win' && L.x > 20 && L.x < 180);
  const out = lightAt(lamp.x, lamp.y, 'out', F);
  assert.ok(out[0] > out[2] * 2, `amber outside by a lamp (${out.map((v) => v.toFixed(2))})`);
  const sx = [...Array(T.W).keys()].find((x) => T.shaft[at(x, 24)] && Math.abs(x - lamp.x) < 4);
  if (sx != null) assert.ok(lightAt(sx, 24, 'in', F)[0] > lightAt(sx, 24, 'in', { ...F, lamps: [] })[0] + 0.05, 'the shaft is lit by the passing lamp');
  const flash = { ...F, flashes: [{ x: 50, y: 20, k: 1.8 }] };
  assert.ok(lightAt(50, 20, 'in', flash)[0] > lightAt(50, 20, 'in', F)[0] + 1, 'a muzzle flash');
});

// Every glyph the decor can draw, in both looks.
function everyGlyph() {
  const seen = new Set();
  const lights = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.5];
  for (let i = 0; i < T.ch.length; i++) if (T.ch[i] !== null) for (const l of lights) for (const look of ['line', 'ascii']) seen.add(lookChar(look, T.ch[i], T.role[i], l));
  for (let y = 0; y < 33; y++) for (let u = 0; u < 4000; u++) {
    const [c, r] = tunnel(y, u);
    for (const l of lights) for (const look of ['line', 'ascii']) seen.add(lookChar(look, c, r, l));
  }
  for (const F of [frameAt(0), frameAt(500), frameAt(1000), frameAt(1500)]) {
    seen.add(F.spoke);
    for (const look of ['line', 'ascii']) seen.add(lookChar(look, F.spoke, 'spoke', 0.5));
  }
  for (const c of '▐█▌▄') for (const look of ['line', 'ascii']) seen.add(lookChar(look, c, 'lamp', 0.5));
  return seen;
}

test('the \'ascii\' look is 7-bit printable only; \'line\' draws the glyph as it is', () => {
  for (const c of everyGlyph()) assert.ok(c.length === 1, `one character (${c})`);
  const lights = [0, 0.3, 0.6, 1, 2];
  const check = (c, r) => { for (const l of lights) { const a = lookChar('ascii', c, r, l); assert.match(a, /^[\x20-\x7e]$/, `'${c}' as ${r} at ${l}: '${a}'`); } };
  for (let i = 0; i < T.ch.length; i++) if (T.ch[i] !== null) check(T.ch[i], T.role[i]);
  for (let y = 0; y < 33; y++) for (let u = 0; u < 4000; u += 3) check(...tunnel(y, u));
  for (const c of '│╱─╲▐█▌▄') check(c, 'lamp');
  assert.equal(lookChar('line', '╭', 'wframe', 0.5), '╭');
});

test('every glyph the decor can draw is in TRAIN_GLYPHS, and so in the WebGL atlas (none draws as ?)', async () => {
  const { atlasChars } = await import('../src/render/gl.js');
  const atlas = new Set(atlasChars({ labels: [], frames: [], glyphs: new Map() }));
  for (const c of everyGlyph()) {
    assert.ok(TRAIN_GLYPHS.includes(c), `'${c}' (U+${c.codePointAt(0).toString(16)}) is not in TRAIN_GLYPHS`);
    assert.ok(atlas.has(c), `'${c}' is not in the atlas`);
  }
});

const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

test('brightness follows importance: collision is warm white, at least 62%, and never dimmer than any decor cell at the same light', () => {
  const ROLES = ['wall', 'wframe', 'glass', 'ad', 'grab', 'pole', 'seat', 'seatd', 'leg', 'post', 'tube', 'livery', 'stripe', 'body',
    'gang', 'coupler', 'frame', 'wheel', 'spoke', 'rock', 'tun', 'rib', 'cable', 'sigR', 'sigG', 'stile', 'sband', 'tab', 'tabtx', 'rail', 'ballast', 'lamp'];
  for (const v of [0, 0.05, 0.1, 0.2, 0.4, 0.7, 1, 1.4, 2, 3]) for (const tint of [[1, 1, 1], [0.75, 1, 0.88], [1, 0.62, 0.25], [0.5, 0.5, 0.6]]) {
    const L = tint.map((c) => c * v);
    const solid = cellColor('solid', L, { solid: true }), lintel = cellColor('lintel', L, { solid: true });
    assert.ok(solid[0] >= 0.62 * COLLISION[0] - 1e-9, `at least 62% (${solid[0]})`);
    assert.ok(Math.abs(solid[1] / solid[0] - COLLISION[1] / COLLISION[0]) < 0.02 || solid[0] >= 254, 'warm white');
    const floor = Math.min(lum(solid), lum(lintel));
    for (const r of ROLES) for (const k of [0.05, 0.12, 1]) for (const glass of [false, true]) {
      const c = cellColor(r, L, { k, glass });
      assert.ok(lum(c) < floor, `${r} (${c.map(Math.round)}) brighter than collision (${floor.toFixed(0)}) at light ${L.map((x) => x.toFixed(2))}`);
    }
  }
  assert.deepEqual(COLLISION, [255, 236, 210]);
  assert.deepEqual(ACCENT, [255, 128, 40]);
});

test('paint: a hole shows the tunnel, emissive cells glow, the line look tints backgrounds, the ascii look does not', () => {
  const F = frameAt(0, { reducedMotion: true }), o = {};
  paint(T, F, 'line', 50, 17, o); // a window pane in car A
  assert.equal(T.role[at(50, 17)], 'glass');
  assert.ok(o.glass && o.role !== 'glass', `a pane shows the tunnel (${o.role})`);
  const tube = T.tubes.find((t) => !t.flick);
  paint(T, F, 'line', tube.x, 11, o);
  assert.equal(o.ch, '━');
  assert.ok(o.glow && o.glow[1] > 0, 'a tube glows');
  assert.equal(T.role[at(33, 18)], 'wall');
  paint(T, F, 'line', 33, 18, o);
  assert.ok(o.bg, 'the back wall has a tint in the line look');
  paint(T, F, 'ascii', 33, 18, o);
  assert.equal(o.bg, null, 'and none in ascii');
  paint(T, F, 'line', 30, 8, o);
  assert.equal(o.ch, '═');
  assert.equal(o.glow, null);
  // What you stand on reads as a warm band in the line look, at any light: a warm tint under the bright ═.
  for (const [x, y] of [[30, 8], [60, 26], [100, 26], [200, 21]]) {
    paint(T, F, 'line', x, y, o);
    assert.equal(o.ch, '═', `${x},${y}`);
    assert.ok(o.bg && o.bg[0] >= 30 && o.bg[0] > o.bg[2] && lum(o.bg) < lum(o.fg) / 3, `${x},${y}: bg ${o.bg}`);
  }
});

test('paintWindow: a window of cells, the same as paint cell by cell (bytes, an always-opaque background), the tunnel past the room', () => {
  const F = frameAt(5000);
  for (const look of ['line', 'ascii']) {
    const x0 = -3, y0 = -2, w = 12, h = 40; // past the left end and above and below the room
    const win = paintWindow(T, F, look, x0, y0, w, h);
    assert.deepEqual([win.w, win.h, win.ch.length, win.fg.length, win.bg.length], [w, h, w * h, w * h * 4, w * h * 4]);
    const out = {};
    for (const [x, y] of [[0, 0], [5, 10], [10, 18], [3, 26], [8, 30]]) {
      paint(T, F, look, x0 + x, y0 + y, out);
      const k = y * w + x;
      assert.equal(win.ch[k], out.ch, `${look} ${x0 + x},${y0 + y}`);
      assert.deepEqual([...win.fg.subarray(k * 4, k * 4 + 3)], out.fg.map((v) => Math.round(Math.min(255, v))));
      assert.equal(win.bg[k * 4 + 3], 255, 'opaque');
      if (!out.bg) assert.deepEqual([...win.bg.subarray(k * 4, k * 4 + 3)], [7, 8, 11], 'the page background');
    }
  }
  // Reused when the size is the same (no garbage per frame).
  const a = paintWindow(T, F, 'line', 0, 0, 10, 10), b = paintWindow(T, F, 'line', 5, 5, 10, 10, a);
  assert.equal(a, b);
});

test('halation: glow spreads a couple of cells sideways and a cell up and down, and nowhere without a source', () => {
  const w = 21, h = 9, src = new Float32Array(w * h * 3);
  const none = halation(src, w, h);
  assert.equal(none.length, w * h * 4);
  assert.ok([...none].every((v, i) => (i % 4 === 3 ? v === 255 : v === 0)), 'no glow from nothing');
  const c = (4 * w + 10) * 3;
  src[c] = 255; src[c + 1] = 200; src[c + 2] = 120;
  const g = halation(src, w, h);
  const r = (x, y) => g[(y * w + x) * 4];
  assert.ok(r(10, 4) > 0 && r(12, 4) > 0 && r(10, 5) > 0, 'around the source');
  assert.ok(r(10, 4) >= r(12, 4) && r(12, 4) >= r(15, 4), 'falls off sideways');
  assert.equal(r(10, 8), 0, 'not four rows away');
  assert.equal(r(0, 4), 0, 'not ten cells away');
  assert.ok(r(10, 4) < 160, `visible, not a blown-out blob (${r(10, 4)})`);
  assert.ok(g[(4 * w + 10) * 4 + 2] < r(10, 4), 'keeps the source\'s colour');
  // Extra sources (a tracer, a muzzle flash) in window cells.
  const e = halation(new Float32Array(w * h * 3), w, h, [{ x: 3, y: 2, c: [255, 220, 160] }]);
  assert.ok(e[(2 * w + 3) * 4] > 0);
});
