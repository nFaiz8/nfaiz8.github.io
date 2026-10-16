import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCity, manhattanWest, MANHATTAN, BROOKLYN, GRID } from '../src/rpg/city.js';

const city = buildCity();

test('the same city every time', () => {
  assert.deepEqual(buildCity().lots.slice(0, 50), city.lots.slice(0, 50));
  assert.equal(buildCity().lots.length, city.lots.length);
});

test('Manhattan is an island: narrow at its southern tip by the bridge, widening north, its lots inside it', () => {
  assert.ok(manhattanWest(MANHATTAN.tip) >= MANHATTAN.east - 1, 'no width at the tip');
  assert.ok(MANHATTAN.east - manhattanWest(-200) > 250);
  assert.ok(MANHATTAN.east - manhattanWest(-900) > MANHATTAN.east - manhattanWest(-200), 'wider uptown');
  for (const l of city.lots.filter((l) => l.borough === 'manhattan')) {
    assert.ok(l.x + l.w / 2 <= MANHATTAN.east + 1e-9, 'east of the East River shore');
    assert.ok(l.x - l.w / 2 >= manhattanWest(l.z) - 1e-9, `west of the Hudson shore at z ${l.z}`);
    assert.ok(l.z - l.d / 2 >= MANHATTAN.north && l.z + l.d / 2 <= MANHATTAN.tip);
  }
});

test('buildings sit on a grid: nothing stands in an avenue or a street', () => {
  for (const l of city.lots) {
    const g = GRID[l.borough], x0 = l.x - l.w / 2, x1 = l.x + l.w / 2, z0 = l.z - l.d / 2, z1 = l.z + l.d / 2;
    const bx = Math.floor((x0 - g.ox) / g.ax), bz = Math.floor((z0 - g.oz) / g.sz);
    assert.equal(Math.floor((x1 - 1e-6 - g.ox) / g.ax), bx, `one block wide (${l.x},${l.z})`);
    assert.equal(Math.floor((z1 - 1e-6 - g.oz) / g.sz), bz, `one block deep (${l.x},${l.z})`);
    assert.ok(x0 - (g.ox + bx * g.ax) >= g.avenue / 2 - 1e-6 && g.ox + (bx + 1) * g.ax - x1 >= g.avenue / 2 - 1e-6, 'off the avenues');
    assert.ok(z0 - (g.oz + bz * g.sz) >= g.street / 2 - 1e-6 && g.oz + (bz + 1) * g.sz - z1 >= g.street / 2 - 1e-6, 'off the streets');
  }
});

test('the skyline reads as Manhattan: Midtown and the tip tall, the Lower East Side low, Brooklyn lower still', () => {
  const avg = (f) => { const ls = city.lots.filter(f); return ls.reduce((a, l) => a + l.h, 0) / ls.length; };
  const midtown = avg((l) => l.borough === 'manhattan' && l.z < -700 && l.z > -1100);
  const les = avg((l) => l.borough === 'manhattan' && l.z < -50 && l.z > -400);
  const tip = avg((l) => l.borough === 'manhattan' && l.z > 60);
  const brooklyn = avg((l) => l.borough === 'brooklyn');
  assert.ok(midtown > 2 * les, `midtown ${midtown} vs LES ${les}`);
  assert.ok(tip > 1.5 * les, `the tip ${tip} vs LES ${les}`);
  assert.ok(brooklyn < les, `brooklyn ${brooklyn}`);
  assert.ok(city.lots.length > 1500 && city.lots.length < 9000, `${city.lots.length} buildings`);
  assert.ok(city.landmarks.some((l) => l.name === 'empire') && city.landmarks.some((l) => l.name === 'chrysler'));
  assert.ok(Math.max(...city.lots.map((l) => l.h)) < Math.max(...city.landmarks.map((l) => l.h)), 'the landmarks top the skyline');
});

test('Brooklyn is across the river, east of its shore', () => {
  for (const l of city.lots.filter((l) => l.borough === 'brooklyn')) assert.ok(l.x - l.w / 2 >= BROOKLYN.west - 1e-9);
});
