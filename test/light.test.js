import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData } from '../src/data.js';
import { buildLayout, T } from '../src/layout.js';
import { castLight, createLighting, lightWindow } from '../src/light.js';

const SITE = { name: 'Faiz Nazeer', tagline: 'photographs', about: 'About.' };
const map = buildLayout(indexData(JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)))), SITE);
const lobby = map.rooms[0];

test('walls block light; the near side of a wall is lit', () => {
  const buf = new Float32Array(map.W * map.H * 3);
  const y = Math.floor(map.spawn.y);
  const x = lobby.x + 4; // four cells inside the west wall
  castLight(map, buf, 0, 0, map.W, map.H, { x: x + 0.5, y: y + 0.5, radius: 12, color: [1, 1, 1], intensity: 1 });
  const at = (cx) => buf[(y * map.W + cx) * 3];
  assert.equal(map.tiles[y * map.W + lobby.x], T.WALL);
  assert.ok(at(lobby.x + 1) > 0, 'floor next to the wall is lit');
  assert.ok(at(lobby.x) > 0, 'the wall itself is lit');
  assert.equal(at(lobby.x - 2), 0, 'nothing behind the wall');
});

test('fractional radii and positions still light the room', () => {
  const buf = new Float32Array(map.W * map.H * 3);
  castLight(map, buf, 0, 0, map.W, map.H, { x: map.spawn.x + 0.37, y: map.spawn.y, radius: 9.75, color: [1, 1, 1], intensity: 1 });
  assert.ok(buf[(Math.floor(map.spawn.y) * map.W + Math.floor(map.spawn.x) + 3) * 3] > 0.3);
});

test('prints are lit from within and the darkroom is red', () => {
  const L = createLighting(map);
  const f = map.frames.find((fr) => !fr.darkroom);
  const i = ((f.y + 2) * map.W + f.x + 2) * 3;
  assert.ok(L.buf[i] >= 1 && L.buf[i + 1] >= 1 && L.buf[i + 2] >= 1);
  const dark = map.rooms.find((r) => r.plan && r.plan.darkroom);
  if (dark) {
    let red = 0, n = 0;
    for (let y = dark.y + 1; y < dark.y + dark.h - 1; y++) for (let x = dark.x + 1; x < dark.x + dark.w - 1; x++) {
      if (L.print[y * map.W + x]) continue;
      const k = (y * map.W + x) * 3;
      red += L.buf[k] - L.buf[k + 1];
      n++;
    }
    assert.ok(red / n > 0.2, 'the safelight tints the darkroom floor red');
  }
});

test('the lantern brightens the window around the player', () => {
  const L = createLighting(map);
  const wx = Math.floor(map.spawn.x) - 20, wy = Math.floor(map.spawn.y) - 10;
  const without = lightWindow(L, wx, wy, 41, 21, { x: -1000, y: -1000 }, 0, false).rgba;
  const withLantern = lightWindow(L, wx, wy, 41, 21, map.spawn, 0, false).rgba;
  const centre = (10 * 41 + 20) * 4;
  assert.ok(withLantern[centre] > without[centre] + 60);
});

import { createArenaLighting } from '../src/light.js';
import { parseLevel } from '../src/arena.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const ad = indexData(fx, ['IMG_1003']);
const amap = buildLayout(ad, SITE, { arena: { photo: ad.byId.get('IMG_1003'), level: parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8')) } });
const AR = amap.arena;
// An open-air cell far from every platform, and the cell just above a platform.
const cellOf = (i) => ({ x: AR.x + 1 + (i % AR.cols), y: AR.y + 1 + Math.floor(i / AR.cols) });
const firstPlat = cellOf(AR.level.cells.indexOf(1));

test('from outside, the arena is a dark room: no lamps in it and its photo is not lit as a print', () => {
  const L = createLighting(amap);
  const deep = (AR.y + 10) * amap.W + AR.x + 20;
  assert.ok(L.buf[deep * 3] < 0.25, `inside is at moonlight (${L.buf[deep * 3]})`);
  assert.equal(L.print[deep], 0);
});

test('in the side view the arena is evenly lit at 0.75 with no lantern, and platforms glow', () => {
  const L = createArenaLighting(amap);
  const W = AR.cols, H = AR.rows, wx = AR.x + 1, wy = AR.y + 1;
  const { rgba, glow } = lightWindow(L, wx, wy, W, H, { x: wx + 15, y: wy + 10 }, 0, false);
  let open = null;
  for (let y = 0; y < H && !open; y++) for (let x = 0; x < W && !open; x++) {
    const near = [-4, -3, -2, -1, 0, 1, 2, 3, 4].some((dy) => [-8, -4, 0, 4, 8].some((dx) => AR.level.cells[(y + dy) * AR.cols + x + dx]));
    if (!near && y > 4 && y < H - 4 && x > 8 && x < W - 8) open = { x, y };
  }
  assert.ok(open, 'found an open cell');
  const o = (open.y * W + open.x) * 4;
  assert.ok(Math.abs(rgba[o] - 0.75 * 255) <= 2, `ambient ${rgba[o]} (no lantern brightening it)`);
  const g = lightWindow(L, firstPlat.x - 5, firstPlat.y - 5, 11, 11, { x: 0, y: 0 }, 0, false).glow;
  const above = ((5 - 1) * 11 + 5) * 4;
  assert.ok(g[above] > 5, `red halo above a platform (${g[above]})`);
  assert.ok(g[above] > g[above + 2] * 1.5, 'more red than blue');
  assert.ok(glow[o] < 3, 'no glow in open air');
});

test('in the side view the photo under a platform keeps the room light: only the halo glows there', () => {
  const L = createArenaLighting(amap);
  const i = (firstPlat.y * amap.W + firstPlat.x) * 3;
  assert.ok(Math.abs(L.buf[i] - 0.75) < 0.01, `light at a platform cell ${L.buf[i]}`);
  assert.ok(L.halo[i] > 0, 'the halo is there');
});

test('in the side view everything outside the arena is dark (a tall view shows past its ceiling and floor)', () => {
  const L = createArenaLighting(amap);
  const W = 20, H = 8, wx = AR.x + 30, wy = AR.y - 4; // 4 rows above the ceiling wall to 3 rows into the room
  const { rgba, glow } = lightWindow(L, wx, wy, W, H, { x: 0, y: 0 }, 0, false);
  for (let x = 0; x < W; x++) {
    const above = ((AR.y - 2 - wy) * W + x) * 4, inside = ((AR.y + 2 - wy) * W + x) * 4;
    assert.ok(rgba[above] < 3 && glow[above] < 3, `above the ceiling: ${rgba[above]}`);
    assert.ok(Math.abs(rgba[inside] - 0.75 * 255) <= 2, `inside: ${rgba[inside]}`);
  }
  const off = lightWindow(L, -10, AR.y + 5, 4, 1, { x: 0, y: 0 }, 0, false).rgba;
  assert.ok(off[0] < 3, `off the map: ${off[0]}`);
});

test('a ▓ block glows along its top, like a platform, not from every cell (its middle shows the photo)', () => {
  const L = createArenaLighting(amap), lv = AR.level;
  const k = lv.cells.indexOf(2);
  assert.ok(k >= 0, 'the level has a block');
  let w = 0, h = 0;
  const c = k % lv.cols, r = Math.floor(k / lv.cols);
  while (lv.cells[r * lv.cols + c + w] === 2) w++;
  while (lv.cells[(r + h) * lv.cols + c] === 2) h++;
  const mid = { x: AR.x + 1 + c + Math.floor(w / 2), y: AR.y + 1 + r + Math.floor(h / 2) };
  const glowAt = (x, y) => lightWindow(L, x, y, 1, 1, { x: 0, y: 0 }, 0, false).glow[0];
  // The same level with only the block's top row: the block's body adds no glow of its own.
  const cells = Uint8Array.from(lv.cells);
  for (let y = r + 1; y < r + h; y++) for (let x = c; x < c + w; x++) cells[y * lv.cols + x] = 0;
  const topOnly = createArenaLighting({ ...amap, arena: { ...AR, level: { ...lv, cells } } });
  const ref = lightWindow(topOnly, mid.x, mid.y, 1, 1, { x: 0, y: 0 }, 0, false).glow[0];
  assert.ok(glowAt(mid.x, mid.y) <= ref + 2, `block middle ${glowAt(mid.x, mid.y)} vs top row only ${ref}`);
});
