import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCity, SHORES, inPolygon, lonLat, toWorld, gridOf, parkCorners, PARK, CORRIDOR, SCALE, GRID_YAW } from '../src/rpg/city.js';
import { PIECES } from '../src/rpg/line.js';

const city = buildCity();
const B = PIECES.find((p) => p.kind === 'bridge');
const named = (n) => city.landmarks.find((l) => l.name === n);
// World back to metres east and north (the inverse of toWorld), for the tests.
function fromWorld({ x, z }) {
  const o = toWorld(0, 0), u = (x - o.x) * SCALE, w = (z - o.z) * SCALE, a = (100 * Math.PI) / 180;
  return { e: u * Math.sin(a) + w * Math.cos(a), n: u * Math.cos(a) - w * Math.sin(a) };
}
const streetOf = (l) => { const m = fromWorld(l); return gridOf(m.e, m.n).street; };

test('the same city every time', () => {
  assert.deepEqual(buildCity().lots.slice(0, 50), city.lots.slice(0, 50));
  assert.equal(buildCity().lots.length, city.lots.length);
});

test('the bridge is the Williamsburg Bridge: its ends land on Manhattan and on Williamsburg, the river between', () => {
  const west = lonLat([-73.9790, 40.7150]), east = lonLat([-73.9640, 40.7120]); // just inland of each shore
  assert.ok(inPolygon(west, SHORES.manhattan), `Delancey St on Manhattan ${JSON.stringify(west)}`);
  assert.ok(inPolygon(east, SHORES.east), 'Williamsburg across the river');
  const mid = toWorld(0, 0);
  assert.ok(Math.abs(mid.x - (B.x0 + B.x1) / 2) < 1 && !inPolygon(mid, SHORES.manhattan) && !inPolygon(mid, SHORES.east), 'the bridge middle over water');
  assert.ok(inPolygon({ x: B.x0, z: 9.5 }, SHORES.manhattan), 'the bridge piece starts over Manhattan');
  assert.ok(inPolygon({ x: B.x1 + 15, z: 9.5 }, SHORES.east), 'and ends over Williamsburg');
});

test('looking up the river: Midtown ahead and to the left, Queens to the right, at their real places', () => {
  const empire = named('empire'), lic = named('skyline tower'), mid = toWorld(0, 0);
  assert.ok(empire.z < mid.z - 700 && empire.x < mid.x, `Empire State ahead-left ${empire.x}, ${empire.z}`);
  assert.ok(lic.x > mid.x && lic.z < mid.z - 500, 'Long Island City ahead-right');
  assert.ok(Math.abs(empire.h * SCALE - 443) < 1, 'the Empire State to its mast');
  const d = Math.hypot(empire.x - mid.x, empire.z - mid.z) * SCALE; // about 4 km
  assert.ok(d > 3700 && d < 4300, `${d} m`);
});

test('every building stands on its own land, off the streets, and nothing over the line', () => {
  for (const l of city.lots) {
    const coast = l.borough === 'manhattan' ? SHORES.manhattan : SHORES.east;
    assert.ok(inPolygon(l, coast), `${l.borough} at ${l.x}, ${l.z}`);
    assert.ok(!(l.z > CORRIDOR[0] && l.z < CORRIDOR[1]), 'over the line');
    assert.equal(l.yaw, GRID_YAW);
  }
  for (const l of city.lots.filter((x) => x.borough === 'manhattan')) {
    const f = streetOf(l) - Math.floor(streetOf(l));
    assert.ok(f > 0.12 && f < 0.88, `in a street at ${streetOf(l)}`);
  }
});

test('Central Park is open: no buildings in it', () => {
  const park = parkCorners();
  assert.equal(park.length, 4);
  for (const l of city.lots) assert.ok(!inPolygon(l, park), `a building in the park at ${l.x}, ${l.z}`);
  assert.ok(PARK.streets[1] - PARK.streets[0] > 50);
});

test('the skyline reads as New York: Midtown far above the East Village, the supertalls on top', () => {
  const avg = (f) => { const ls = city.lots.filter(f); return ls.reduce((a, l) => a + l.h, 0) / ls.length; };
  const m = (l) => l.borough === 'manhattan';
  const midtown = avg((l) => m(l) && streetOf(l) > 34 && streetOf(l) < 59);
  const village = avg((l) => m(l) && streetOf(l) < 14);
  assert.ok(midtown > 3 * village, `midtown ${midtown} vs the East Village ${village}`);
  assert.ok(city.lots.length > 2000 && city.lots.length < 20000, `${city.lots.length} buildings`);
  assert.ok(named('central park tower').h > Math.max(...city.lots.map((l) => l.h)), 'Central Park Tower tops the lots');
  assert.ok(['chrysler', 'one vanderbilt', '432 park', 'un'].every((n) => named(n)));
});
