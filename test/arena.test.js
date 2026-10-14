import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, AIR, PLATFORM, SOLID } from '../src/arena.js';

const text = fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8');

test('the level file is 34 lines of 160 characters, using only space, ═, ▓ and the S, R, N markers', () => {
  const lines = text.replace(/\n$/, '').split('\n');
  assert.equal(lines.length, 34);
  lines.forEach((l, i) => {
    assert.equal([...l].length, 160, `line ${i + 1}`);
    assert.match(l, /^[ ═▓SRN]*$/, `line ${i + 1}`);
  });
});

test('the 4 columns by the door are clear in the bottom 3 rows', () => {
  const L = parseLevel(text);
  for (let r = L.rows - 3; r < L.rows; r++) for (let c = L.cols - 4; c < L.cols; c++) assert.equal(L.cells[r * L.cols + c], AIR, `${c},${r}`);
});

test('every platform and every block top can be reached from the floor', () => {
  // A standing spot reaches another if it is at most 5 rows up and within 12 columns (a jump is ~6 rows).
  const L = parseLevel(text);
  const at = (c, r) => (r < 0 ? AIR : L.cells[r * L.cols + c]);
  const surfaces = [{ row: L.rows, x0: 0, x1: L.cols - 1 }]; // the floor
  for (let r = 0; r < L.rows; r++) {
    let s = -1;
    for (let c = 0; c <= L.cols; c++) {
      const top = c < L.cols && at(c, r) !== AIR && at(c, r - 1) === AIR;
      if (top && s < 0) s = c;
      if (!top && s >= 0) { surfaces.push({ row: r, x0: s, x1: c - 1 }); s = -1; }
    }
  }
  const clear = (a, b) => {
    for (let c = Math.max(a.x0, b.x0 - 12); c <= Math.min(a.x1, b.x1 + 12); c++) {
      let ok = true;
      for (let k = 1; k <= 9 && ok; k++) ok = a.row - k < 0 || at(c, a.row - k) !== SOLID;
      if (ok) return true;
    }
    return false;
  };
  const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const i = queue.shift();
    surfaces.forEach((s, j) => {
      if (!seen.has(j) && surfaces[i].row - s.row <= 5 && gap(surfaces[i], s) <= 12 && clear(surfaces[i], s)) { seen.add(j); queue.push(j); }
    });
  }
  const lost = surfaces.filter((_, j) => !seen.has(j)).map((s) => `row ${s.row} cols ${s.x0}-${s.x1}`);
  assert.deepEqual(lost, []);
});

test('headroom: the 3 cells above every standing spot are air (no ▓ and no ═); no standing spot in rows 0–2', () => {
  const L = parseLevel(text);
  const at = (c, r) => L.cells[r * L.cols + c];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    if (at(c, r) === AIR || (r > 0 && at(c, r - 1) !== AIR)) continue; // only tops of surfaces
    assert.ok(r >= 3, `standing spot at row ${r - 1}, col ${c}`);
    for (let k = 1; k <= 3; k++) assert.equal(at(c, r - k), AIR, `headroom at ${c},${r - k}`);
  }
});

test('the gap under any ▓ is 0 or at least 3 rows', () => {
  const L = parseLevel(text);
  const at = (c, r) => (r >= L.rows ? SOLID : L.cells[r * L.cols + c]);
  for (let c = 0; c < L.cols; c++) for (let r = 0; r < L.rows; r++) {
    if (at(c, r) !== SOLID || at(c, r + 1) === SOLID) continue;
    let gap = 0;
    while (r + 1 + gap < L.rows && at(c, r + 1 + gap) === AIR) gap++;
    if (r + 1 + gap >= L.rows) continue; // over the room's floor: the track bed is 4+ rows
    assert.ok(gap === 0 || gap >= 3, `a ${gap}-row slot under ▓ at ${c},${r}`);
  }
});

test('parseLevel: ═ is a platform, ▓ is solid, anything else is air, and short input is padded', () => {
  const L = parseLevel('═▓x\n');
  assert.equal(L.cols, 160);
  assert.equal(L.rows, 34);
  assert.deepEqual([...L.cells.slice(0, 4)], [PLATFORM, SOLID, AIR, AIR]);
  assert.equal(L.cells[33 * 160 + 159], AIR);
});

import { newBody, stepBody, sideCamera, coverCrop } from '../src/arena.js';

// A small test room, 40 × 20: floor below row 19, walls left and right, a platform at row 15 (cols 10–19, 5 rows up),
// a solid block at rows 16–19 (cols 30–33) and a low ▓ ceiling at row 15 (cols 0–5).
const kindAt = (c, r) => {
  if (c < 0 || c >= 40 || r >= 20) return SOLID;
  if (r < 0) return AIR;
  if (r === 15 && c >= 10 && c <= 19) return PLATFORM;
  if (r >= 16 && c >= 30 && c <= 33) return SOLID;
  if (r === 15 && c <= 5) return SOLID;
  return AIR;
};
const IDLE = { x: 0, run: false, jump: false, down: false };
const sim = (b, seconds, input = IDLE, dt = 1 / 60, each = () => {}) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) { stepBody(b, dt, typeof input === 'function' ? input(t) : input, kindAt); each(b, t); }
};

test('falling lands on the floor', () => {
  const b = newBody(7.5, 3.5);
  sim(b, 2);
  assert.equal(b.y, 19.5);
  assert.equal(b.onGround, true);
});

test('a full jump rises about 6 rows and is about 0.6 s in the air', () => {
  const b = newBody(7.5, 19.5);
  sim(b, 0.2);
  let top = b.y, air = 0;
  sim(b, 1.2, { ...IDLE, jump: true }, 1 / 60, (s) => { top = Math.min(top, s.y); if (!s.onGround) air += 1 / 60; });
  assert.ok(Math.abs(19.5 - top - 6) <= 0.5, `rose ${19.5 - top}`);
  assert.ok(Math.abs(air - 0.6) <= 0.06, `air ${air}`);
});

test('letting go of jump early makes a short hop', () => {
  const b = newBody(7.5, 19.5);
  sim(b, 0.2);
  let top = b.y;
  sim(b, 1, (t) => ({ ...IDLE, jump: t < 0.03 }), 1 / 60, (s) => { top = Math.min(top, s.y); });
  assert.ok(19.5 - top < 4, `rose ${19.5 - top}`);
});

test('you jump up through ═, stand on it, and ↓ drops you back through', () => {
  const b = newBody(14.5, 19.5);
  sim(b, 0.2);
  sim(b, 1.5, (t) => ({ ...IDLE, jump: t < 0.5 }));
  assert.equal(b.y, 14.5, 'standing on the platform');
  assert.equal(b.onPlatform, true);
  sim(b, 0.05, { ...IDLE, down: true });
  sim(b, 1);
  assert.equal(b.y, 19.5, 'back on the floor');
});

test('▓ blocks from the side, from above and from below; ↓ on ▓ does nothing', () => {
  const b = newBody(25.5, 19.5);
  sim(b, 2, { ...IDLE, x: 1, run: true });
  assert.ok(b.x <= 30 - 0.3 + 1e-9 && b.x > 29, `stopped at the block (${b.x})`);
  const top = newBody(31.5, 5.5);
  sim(top, 2);
  assert.equal(top.y, 15.5, 'lands on top');
  sim(top, 0.5, { ...IDLE, down: true });
  assert.equal(top.y, 15.5, 'no dropping through ▓');
  const under = newBody(3.5, 19.5);
  sim(under, 0.2);
  let high = under.y;
  sim(under, 1, { ...IDLE, jump: true }, 1 / 60, (s) => { high = Math.min(high, s.y); });
  assert.equal(high, 16.5, 'head stops under the ceiling');
});

test('nothing tunnels at 20 fps', () => {
  const b = newBody(14.5, 0.5);
  sim(b, 3, IDLE, 1 / 20);
  assert.equal(b.y, 14.5, 'a long fall still lands on a one-row platform');
  const r = newBody(20.5, 19.5);
  sim(r, 3, { ...IDLE, x: 1, run: true }, 1 / 20);
  assert.ok(r.x < 30, 'sprinting at 20 fps still stops at the block');
});

test('coyote time: a jump just after running off a ledge still works, a late one does not', () => {
  const offEdge = (lateFrames) => {
    const b = newBody(17.5, 14.5);
    sim(b, 0.1);
    let left = -1, frame = 0, jumped = false, landed = false;
    sim(b, 1, () => ({ ...IDLE, x: 1, jump: left >= 0 && frame - left >= lateFrames }), 1 / 60, (s) => {
      frame++;
      if (left < 0 && !s.onGround) left = frame;
      if (left >= 0 && s.onGround) landed = true; // a press held into the landing is the jump buffer's, not coyote time's
      if (!landed && s.vy < -20) jumped = true;
    });
    return jumped;
  };
  assert.equal(offEdge(3), true, '0.05 s late');
  assert.equal(offEdge(10), false, '0.17 s late');
});

test('jump buffer: pressing just before landing jumps on landing; too early does nothing', () => {
  const land = () => { const b = newBody(7.5, 9.5); let f = 0; while (!b.onGround) { stepBody(b, 1 / 60, IDLE, kindAt); f++; } return f; };
  const L = land();
  const pressAt = (early) => {
    const b = newBody(7.5, 9.5);
    let f = 0, top = 99;
    sim(b, 1.5, () => ({ ...IDLE, jump: f >= L - early && f < L + 1 }), 1 / 60, (s) => { f++; if (f > L) top = Math.min(top, s.y); });
    return 19.5 - top;
  };
  assert.ok(pressAt(4) > 1, 'buffered jump fired');
  assert.ok(pressAt(12) < 0.01, 'a press 0.2 s early is forgotten');
});

test('a held jump never fires again by itself, and entering with jump held does not jump', () => {
  const b = newBody(7.5, 19.5);
  b.prevJump = true; // as on arrival through the door with W held
  let top = 19.5;
  sim(b, 1, { ...IDLE, jump: true }, 1 / 60, (s) => { top = Math.min(top, s.y); });
  assert.equal(top, 19.5);
});

test('the side camera leads, clamps to the room, and keeps the floor in view', () => {
  const a = { x: 100, y: 10, w: 242, h: 52 };
  const view = { cols: 150, rows: 32 };
  const floor = { x: 200, y: a.y + a.h - 1.5 };
  const c = sideCamera(a, view, floor, 8);
  assert.equal(c.x, 208);
  assert.equal(c.y + view.rows / 2, a.y + a.h, 'floor wall is the bottom row');
  const left = sideCamera(a, view, { x: a.x + 2, y: floor.y });
  assert.equal(left.x - view.cols / 2, a.x, 'clamped at the west wall');
  const high = sideCamera(a, view, { x: 200, y: a.y + 3 });
  assert.equal(high.y - view.rows / 2, a.y, 'clamped at the ceiling');
  const tall = sideCamera(a, { cols: 150, rows: 60 }, floor);
  assert.equal(tall.y, a.y + a.h / 2, 'a tall view shows the whole room, centred');
});

test('coverCrop keeps the middle of the image at the room shape (cells are twice as tall as wide)', () => {
  assert.deepEqual(coverCrop(2400, 500, 240, 50), { sx: 600, sy: 0, sw: 1200, sh: 500 });
  const wide = coverCrop(5066, 2075, 240, 50);
  assert.ok(Math.abs(wide.sw / wide.sh - 2.4) < 1e-9 && wide.sy === 0 && Math.abs(wide.sx - (5066 - wide.sw) / 2) < 1e-9);
  const tall = coverCrop(1000, 1000, 240, 50);
  assert.ok(Math.abs(tall.sw / tall.sh - 2.4) < 1e-9 && tall.sx === 0 && tall.sy > 0);
});

import { indexData } from '../src/data.js';
import { buildLayout } from '../src/layout.js';
import { kindsFor } from '../src/arena.js';

test('kindsFor: level cells inside, walls solid, the door open', () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
  const d = indexData(json, ['IMG_1003']);
  const map = buildLayout(d, { name: 'Faiz' }, { arena: { photo: d.byId.get('IMG_1003'), level: parseLevel(text) } });
  const a = map.arena, k = kindsFor(map), L = a.level;
  const i = L.cells.indexOf(PLATFORM);
  assert.equal(k(a.x + 1 + (i % L.cols), a.y + 1 + Math.floor(i / L.cols)), PLATFORM);
  assert.equal(k(a.x, a.y + 5), SOLID, 'west wall');
  assert.equal(k(a.x + 5, a.floorY), SOLID, 'floor');
  assert.equal(k(a.door.x, a.door.y + 1), AIR, 'door');
  assert.equal(k(a.door.x + 1, a.door.y + 1), AIR, 'corridor');
});

import { nearArena } from '../src/arena.js';

test('nearArena: the corridor and the room are near; spawn and the rest of the gallery are not', () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
  const d = indexData(json, ['IMG_1003']);
  const map = buildLayout(d, { name: 'Faiz' }, { arena: { photo: d.byId.get('IMG_1003'), level: parseLevel(text) } });
  const a = map.arena;
  assert.ok(nearArena(map, { x: a.door.x + 5, y: a.door.y + 1.5 }), 'in the corridor');
  assert.ok(nearArena(map, { x: a.x + 40, y: a.floorY - 1 }), 'inside');
  assert.ok(!nearArena(map, map.spawn), `spawn (${map.spawn.x - a.door.x} cells east of the door)`);
  assert.ok(!nearArena(map, { x: a.door.x + 5, y: a.y - 20 }), 'north of it');
  assert.ok(!nearArena(map, { x: a.door.x + 5, y: a.floorY + 20 }), 'south of it');
  assert.ok(!nearArena({ ...map, arena: null }, map.spawn), 'no arena');
});

import { blockGlyph } from '../src/arena.js';

test('blockGlyph: a ▓ block is drawn as its outline, its inside left clear so the photo shows', () => {
  const L = parseLevel([' '.repeat(6), ' ▓▓▓▓ ', ' ▓▓▓▓ ', ' ▓▓▓▓ ', ' '.repeat(6)].join('\n'), 6, 5);
  const row = (r) => [...Array(6)].map((_, c) => blockGlyph(L, c, r) || ' ').join('');
  assert.deepEqual([1, 2, 3].map(row), [' ┌──┐ ', ' │  │ ', ' └──┘ ']);
  assert.equal(blockGlyph(L, 0, 0), null, 'air');
});
