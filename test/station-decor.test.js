import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { DECOR } from '../src/rpg/decor.js';
import { STOPS } from '../src/rpg/line.js';

const maps = ['station.txt', 'canalst.txt'].map((f) => parseStation(fs.readFileSync(new URL(`../src/rpg/${f}`, import.meta.url), 'utf8')));

test('each station has its decor, keyed by its name, with its stop number', () => {
  for (const [i, map] of maps.entries()) {
    const d = DECOR[map.name];
    assert.ok(d, map.name);
    assert.equal(d.stop, i);
    assert.equal(STOPS[i].name, map.name);
  }
});

test('creatures and commuters start on walkable floor of their own station; props stand inside it', () => {
  for (const map of maps) {
    const d = DECOR[map.name];
    for (const p of [...d.life.pigeons, ...d.life.commuters]) assert.ok(!map.solidAt(p.x, p.z), `${map.name}: ${p.x},${p.z}`);
    for (const r of d.life.rats) assert.ok(r.x > 0 && r.x < map.cols && map.tracks[r.track]);
    for (const [, x, z] of d.props) assert.ok(x > 0 && x < map.cols && z > 0 && z < map.rows, `${map.name} prop at ${x},${z}`);
  }
});

test('MUSEUM keeps its exit sign; CANAL ST has none, and its tape is on the x tile', () => {
  assert.equal(DECOR.MUSEUM.exitSign, '▲ MUSEUM');
  assert.equal(DECOR['CANAL ST'].exitSign, null);
  const tape = DECOR['CANAL ST'].tape, cell = maps[1].at(Math.floor(tape.x), Math.floor(tape.z));
  assert.equal(cell.ch, 'x');
});
