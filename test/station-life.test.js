import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation, LEVEL } from '../src/rpg/map.js';
import { trainAt, startOf, TRAIN } from '../src/rpg/train.js';
import { STATION_LIFE, PIGEON, createPigeon, stepPigeon, createRat, stepRat, createCommuter, stepCommuter, pushOut, COMMUTER } from '../src/rpg/life.js';
import { RADIUS, blocked } from '../src/rpg/move.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const DT = 1 / 30;
const FAR = { x: 5, z: 9 }; // you, up in the hall

test('everyone starts on the platform, clear of benches and pillars', () => {
  for (const p of [...STATION_LIFE.pigeons, ...STATION_LIFE.commuters]) {
    const cell = MAP.at(Math.floor(p.x), Math.floor(p.z));
    assert.ok(cell.walk && cell.level === LEVEL.platform, `${p.x},${p.z} is ${cell.ch}`);
  }
});

test('a pigeon pecks and stays near home while nothing disturbs it', () => {
  const p = createPigeon({ x: 25, z: 8 }, 3);
  let pecks = 0, last = p.peck;
  for (let t = 0; t < 4; t += DT) { // before the first train's warning
    stepPigeon(p, DT, { walker: FAR, train: trainAt(t, MAP) });
    if (p.peck && !last) pecks++;
    last = p.peck;
    assert.ok(p.state === 'peck' || p.state === 'hop');
    assert.ok(Math.hypot(p.x - 25, p.z - 8) <= PIGEON.roam + 1e-6);
  }
  assert.ok(pecks >= 2, `pecked ${pecks} times`);
});

test('a pigeon flutters off when you come close, and comes back later', () => {
  const p = createPigeon({ x: 25, z: 8 }, 1);
  stepPigeon(p, DT, { walker: { x: 24, z: 8 }, train: null });
  assert.equal(p.state, 'fly');
  assert.equal(p.dir, 1, 'away from you');
  for (let t = 0; t < PIGEON.fly + 0.1; t += DT) stepPigeon(p, DT, { walker: { x: 24, z: 8 }, train: null });
  assert.equal(p.state, 'away');
  assert.equal(p.alpha, 0);
  let back = null;
  for (let t = 0; t < 40 && back == null; t += DT) { stepPigeon(p, DT, { walker: FAR, train: null }); if (p.state === 'peck') back = t; }
  assert.ok(back != null && back > PIGEON.away[0] - 1, `back after ${back}`);
  assert.equal(p.x, 25);
  assert.equal(p.alpha, 1);
});

test('pigeons take off when a train comes', () => {
  const p = createPigeon({ x: 25, z: 8 }, 2);
  stepPigeon(p, DT, { walker: FAR, train: trainAt(startOf(0) - 1, MAP) });
  assert.equal(p.state, 'fly');
});

test('a rat runs into the nearest tunnel about 3 s before a train, and comes out after it has gone', () => {
  const rat = createRat({ x: 87, track: 1 }, MAP, 0);
  let t = 0, hidden = null, out = null;
  for (; t < startOf(1) + 20; t += DT) {
    const train = trainAt(t, MAP);
    stepRat(rat, DT, { train }, MAP);
    if (t < startOf(0) - TRAIN.warn - 0.05) assert.notEqual(rat.state, 'flee');
    if (rat.state === 'hidden' && hidden == null) hidden = t;
    if (hidden != null && out == null && rat.state === 'return') out = t;
    if (train?.phase === 'pass' && train.head > 0 && train.head < MAP.cols) assert.equal(rat.visible, false, `out on the track at ${t}`);
  }
  assert.ok(hidden != null && hidden < startOf(0), `hid at ${hidden}`);
  assert.ok(rat.tunnel > MAP.cols, 'the east tunnel was nearer');
  assert.ok(out != null && out > startOf(0), `came out at ${out}`);
});

test('commuters stand still with small moves, step back from the edge and watch a passing train, then settle', () => {
  const spec = STATION_LIFE.commuters[0]; // by the north track
  const c = createCommuter(spec, 0);
  const track = MAP.tracks[0];
  let maxBack = 0, watched = false;
  for (let t = 0; t < startOf(0) + 12; t += DT) {
    const train = trainAt(t, MAP);
    stepCommuter(c, DT, { train, walker: FAR }, MAP);
    const cell = MAP.at(Math.floor(c.x), Math.floor(c.z));
    assert.ok(cell.walk && cell.level === LEVEL.platform, `never on the tracks: ${c.x},${c.z}`);
    if (train?.phase === 'pass' && train.track === track) {
      maxBack = Math.max(maxBack, c.z - spec.z);
      if (c.watching) watched = true;
    }
    if (t < startOf(0) - TRAIN.warn) assert.ok(Math.hypot(c.x - spec.x, c.z - spec.z) < 1e-6, 'still before the train');
  }
  assert.ok(Math.abs(maxBack - COMMUTER.back) < 0.05, `stepped back ${maxBack}`);
  assert.ok(watched);
  assert.ok(Math.hypot(c.x - spec.x, c.z - spec.z) < 0.02, 'settled back at their spot');
  assert.equal(c.watching, false);
});

test('the pacing commuter walks between two spots and waits at each', () => {
  const spec = STATION_LIFE.commuters.find((s) => s.walkTo);
  const c = createCommuter(spec, 3);
  const seen = new Set();
  for (let t = 0; t < 30; t += DT) {
    stepCommuter(c, DT, { train: null, walker: FAR }, MAP);
    if (Math.abs(c.x - spec.walkTo.x) < 0.01) seen.add('there');
    if (seen.has('there') && Math.abs(c.x - spec.x) < 0.01) seen.add('back');
    assert.ok(c.speed <= COMMUTER.walk + 1e-6);
  }
  assert.deepEqual([...seen], ['there', 'back']);
});

test("you can't walk through a commuter", () => {
  const c = { x: 30, z: 9.5 };
  const w = { x: 30.1, z: 9.6 };
  pushOut(w, [c], MAP);
  assert.ok(Math.hypot(w.x - c.x, w.z - c.z) >= RADIUS + COMMUTER.radius - 1e-9);
  // Never pushed into a wall: a commuter against the platform's east wall.
  const e = { x: 46.5, z: 9.5 }, w2 = { x: 46.7, z: 9.5 };
  pushOut(w2, [e], MAP);
  assert.equal(blocked(MAP, w2.x, w2.z), false);
});

test("a pacing commuter waits rather than walking into you", () => {
  const spec = STATION_LIFE.commuters.find((s) => s.walkTo);
  const c = createCommuter(spec, 3);
  const you = { x: spec.x + 0.6, z: spec.z };
  for (let t = 0; t < 2; t += DT) stepCommuter(c, DT, { train: null, walker: you }, MAP);
  assert.ok(c.x < you.x - 0.4, `stopped short: ${c.x}`);
});

test('riders aboard a local: two or three a car, seeded by its number, seated on real seats or holding a pole', async () => {
  const { ridersFor } = await import('../src/rpg/life.js');
  const { SEATS, POLES, trainSolid } = await import('../src/rpg/car.js');
  const a = ridersFor(12), b = ridersFor(12), c = ridersFor(13);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.length >= 10 && a.length <= 15);
  const seats = a.filter((r) => r.seat != null).map((r) => r.seat);
  assert.equal(new Set(seats).size, seats.length, 'no two on one seat');
  for (const r of a) {
    if (r.seat != null) { assert.equal(r.sit, 1); assert.deepEqual([r.x, r.z], [SEATS[r.seat].x, SEATS[r.seat].z]); }
    else { assert.equal(r.hold, 1); assert.ok(!trainSolid(r.x, r.z), 'standing in the aisle'); assert.ok(POLES.some((p) => Math.hypot(p.x - r.x, p.z - r.z) < 0.5)); }
  }
});
