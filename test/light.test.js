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

import { parseLevel } from '../src/arena.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const ad = indexData(fx, ['IMG_1003']);
const amap = buildLayout(ad, SITE, { arena: { photo: ad.byId.get('IMG_1003'), level: parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8')) } });
const AR = amap.arena;

test('from outside, the arena is a dark room: no lamps in it and its photo is not lit as a print', () => {
  const L = createLighting(amap);
  const deep = (AR.y + 10) * amap.W + AR.x + 20;
  assert.ok(L.buf[deep * 3] < 0.25, `inside is at moonlight (${L.buf[deep * 3]})`);
  assert.equal(L.print[deep], 0);
});
