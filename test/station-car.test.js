import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { stepWalker } from '../src/rpg/move.js';
import { local, arrivalAt, LENGTH, LOCAL, DOORS } from '../src/rpg/schedule.js';
import {
  CAR, PITCH, trainSolid, trainMap, SEATS, POLES, offPoles, seatNear, standFrom, lurch, inTrain, stationWithTrains, pushIn, platformSide, trainOrigin,
} from '../src/rpg/car.js';

const museum = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const walker = (x, z) => ({ x, z, y: -3, vx: 0, vz: 0, facing: 1, walked: 0 });
const walk = (w, input, map, secs = 3) => { for (let i = 0; i < secs * 60; i++) stepWalker(w, 1 / 60, input, map); return w; };

test('you can walk the whole train down its middle, through every end door and gangway, and no further', () => {
  const w = walk(walker(2, 0), { x: 1, y: 0 }, trainMap(0), 30);
  assert.ok(w.x > LENGTH - 1 && w.x < LENGTH, `stopped at the far cab, ${w.x}`);
  const back = walk(walker(LENGTH - 2, 0), { x: -1, y: 0 }, trainMap(0), 30);
  assert.ok(back.x < 1 && back.x > 0, `stopped at the near cab, ${back.x}`);
});

test('benches and walls: across the car you stop at the bench between doors, at the wall in a shut doorway', () => {
  const atBench = walk(walker(5, 0), { x: 0, y: 1 }, trainMap(1));
  assert.ok(atBench.z < CAR.bench, `bench: ${atBench.z}`);
  const shut = walk(walker(7.5, 0), { x: 0, y: 1 }, trainMap(0));
  assert.ok(shut.z > CAR.bench && shut.z < CAR.wall, `shut door: ${shut.z}`);
  const open = walk(walker(7.5, 0), { x: 0, y: 1 }, trainMap(1));
  assert.ok(open.z > shut.z + 0.15, `open door: ${open.z}`); // out to the car's edge (the platform's map takes over there)
  const otherSide = walk(walker(7.5, 0), { x: 0, y: -1 }, trainMap(1));
  assert.ok(otherSide.z > -CAR.wall, 'only the open side is open');
});

test('gangways are walkable only down the middle', () => {
  const gap = PITCH - 0.375; // between car 0 and car 1
  assert.equal(trainSolid(gap, 0), false);
  assert.equal(trainSolid(gap, 0.8), true);
});

test('seats: on both benches of every car, facing across; the nearest free one; standing up in front of it', () => {
  assert.ok(SEATS.length >= 100);
  for (const s of SEATS) {
    assert.ok(Math.abs(s.z) > CAR.bench && Math.abs(s.z) < CAR.wall);
    assert.ok(trainSolid(s.x, s.z), 'a seat is on the bench');
    assert.equal(s.yaw, s.side < 0 ? 0 : Math.PI);
  }
  const s = seatNear(5, 0.7);
  assert.ok(s && s.side === 1);
  assert.equal(seatNear(5, 0.7, new Set([s.i]))?.i === s.i, false, 'a taken seat is skipped');
  assert.equal(seatNear(40, 0), null, 'nothing in reach in a doorway');
  const up = standFrom(s);
  assert.equal(trainSolid(up.x, up.z), false);
});

test('poles push you aside', () => {
  const p = POLES[0], w = walker(p.x + 0.05, p.z);
  offPoles(w, trainMap(0));
  assert.ok(Math.hypot(w.x - p.x, w.z - p.z) >= 0.3);
});

test('lurch: speeding up east pushes you west, braking pushes you east, a wall stops it', () => {
  const m = trainMap(0), w = walker(40, 0);
  lurch(w, 3, 1, m);
  assert.ok(w.x < 40);
  const b = walker(40, 0);
  lurch(b, -3, 1, m);
  assert.ok(b.x > 40);
  const cab = walker(0.3, 0);
  lurch(cab, 30, 1, m);
  assert.ok(cab.x >= 0.25, 'not through the cab wall');
});

test('boarding a standing train: through an open door from the platform, but not between doors', () => {
  const tr = local(0, arrivalAt(0) + 5); // eastbound, standing at MUSEUM, doors open
  assert.equal(platformSide(tr.track), 1, 'the north track opens its south doors');
  const map = stationWithTrains(museum, 0, [tr]);
  const o = trainOrigin(tr), door = o.x + 7.5;
  const w = walk(walker(door, 6.5), { x: 0, y: -1 }, map);
  const p = inTrain(tr, 0, w.x, w.z);
  assert.ok(p && p.z < 0, `inside: ${JSON.stringify(p)}`);
  const between = walk(walker(o.x + 5, 6.5), { x: 0, y: -1 }, map);
  assert.equal(inTrain(tr, 0, between.x, between.z), null);
  // Doors not fully open yet: shut.
  const opening = local(0, arrivalAt(0) + 1.5);
  const early = walk(walker(door, 6.5), { x: 0, y: -1 }, stationWithTrains(museum, 0, [opening]));
  assert.equal(inTrain(opening, 0, early.x, early.z), null);
});

test('closing doors push you in from the doorway', () => {
  assert.equal(pushIn({ x: 7.5, z: 1.45 }).z < CAR.wall, true);
  assert.equal(pushIn({ x: 7.5, z: -1.45 }).z > -CAR.wall, true);
  assert.deepEqual(pushIn({ x: 3, z: 0.2 }), { x: 3, z: 0.2 });
});
