import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOPS } from '../src/rpg/line.js';
import { local, arrivalAt, arrivalAtStop, LOCAL, DOORS, LEG_TIME, turnaround, PERIOD } from '../src/rpg/schedule.js';
import { trainOrigin, CAR, SEATS, standFrom } from '../src/rpg/car.js';
import { createRider, stepRider, frameOrigin, toWorld, sit, stand } from '../src/rpg/rider.js';

const w = (x, z) => ({ x, z, y: -3, vx: 0, vz: 0, facing: 1, walked: 0 });

test('standing inside a local when its doors start closing, you board it: same place in the world, now its frame', () => {
  const r = createRider(0), t = arrivalAt(0) + DOORS.close[0] + 0.1, tr = local(0, t), o = trainOrigin(tr);
  const me = w(o.x + 7.5, o.z + 0.5); // inside car 0, in station 0's (= the line's) coordinates
  const before = toWorld(r, me, t);
  assert.equal(stepRider(r, me, t), 'board');
  assert.deepEqual(r.frame, { kind: 'train', k: 0 });
  const after = toWorld(r, me, t);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.z - before.z) < 1e-9);
  assert.equal(stepRider(r, me, t + 0.1), null, 'once');
});

test('in the doorway as they close you are pushed in; on the platform you stay', () => {
  const t = arrivalAt(0) + DOORS.close[0] + 0.2, tr = local(0, t), o = trainOrigin(tr);
  const r = createRider(0), door = w(o.x + 7.5, o.z + 1.45);
  stepRider(r, door, t);
  assert.equal(r.frame.kind, 'train');
  assert.ok(door.z < CAR.wall);
  const r2 = createRider(0), plat = w(o.x + 7.5, 6.5);
  assert.equal(stepRider(r2, plat, t), null);
  assert.equal(r2.frame.kind, 'station');
});

test('riding into the other station: when the doors start opening you are in that station\'s frame', () => {
  const r = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 }, me = w(30, -0.5);
  const t = arrivalAtStop(0, 1) + DOORS.open[0] + 0.05;
  const before = toWorld(r, me, t);
  assert.equal(stepRider(r, me, t), 'alight');
  assert.deepEqual(r.frame, { kind: 'station', stop: 1 });
  const after = toWorld(r, me, t);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.z - before.z) < 1e-9);
  assert.ok(me.x > 0 && me.x < STOPS[1].cols, 'in CANAL ST\'s own map coordinates');
});

test('a long gap (a hidden tab): aboard past the last stop, you turn round, never left in a dead train', () => {
  const r = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 }, me = w(30, -0.5);
  const t = arrivalAtStop(0, 1) + LOCAL.dwell + 60; // a minute past leaving CANAL ST
  assert.equal(stepRider(r, me, t), 'turn');
  assert.deepEqual(r.frame, { kind: 'train', k: turnaround(0, t) });
  assert.deepEqual([me.x, me.z], [30, -0.5], 'the same spot');
  // Hidden through your stop: its doors opened and shut while you weren't looking. You're still aboard, and ride on
  // into the tunnel (then turn round).
  const r2 = { frame: { kind: 'train', k: 2 }, seat: null, fade: 0 };
  assert.equal(stepRider(r2, w(30, 0), arrivalAtStop(2, 1) + 17.5), null);
  assert.equal(r2.frame.kind, 'train');
});

test('sitting: snaps you to the nearest free seat, keeps you there through a frame change; standing puts you in front', () => {
  const t0 = arrivalAtStop(0, 0) + 40; // riding
  const r = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 }, s0 = SEATS[9], me = w(s0.x, s0.z - 0.4 * s0.side);
  const s = sit(r, me, new Set(), t0);
  assert.equal(s.i, s0.i);
  assert.ok(Math.abs(me.x - s0.x) < 1e-9 && Math.abs(me.z - s0.z) < 1e-9, 'on the seat');
  const other = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 };
  assert.notEqual(sit(other, w(s0.x, s0.z - 0.4 * s0.side), new Set([s0.i]), t0)?.i, s0.i, 'a taken seat is refused');
  const t = arrivalAtStop(0, 1) + DOORS.open[0] + 0.05;
  assert.equal(stepRider(r, me, t), 'alight');
  assert.equal(r.seat.i, s0.i, 'still seated after alighting');
  stand(r, me, t);
  assert.equal(r.seat, null);
  const o = frameOrigin({ kind: 'train', k: 0 }, t), sx = frameOrigin(r.frame, t);
  assert.ok(Math.abs(me.x + sx.x - (o.x + s0.x)) < 1e-9, 'in front of the seat');
  assert.ok(Math.abs(me.z + sx.z - (o.z + standFrom(s0).z)) < 1e-9);
});

test('the clock wrapping mid-ride: you keep your train, now numbered a day of locals lower', () => {
  const r = { frame: { kind: 'train', k: 1439 }, seat: null, fade: 0 }, me = w(30, 0);
  const t0 = arrivalAt(1439) - 30; // riding toward MUSEUM, just before the wrap
  stepRider(r, me, t0);
  const before = toWorld(r, me, t0);
  const t1 = t0 + 0.5 - PERIOD; // half a second later, after the wrap
  stepRider(r, me, t1);
  assert.equal(r.frame.k, 1439 - PERIOD / 60);
  const after = toWorld(r, me, t1);
  assert.ok(Math.abs(after.x - before.x) < 20, `moved ${after.x - before.x}`);
});

test('frameOrigin: a station is its x on the line; a train its west end and track middle', () => {
  assert.deepEqual(frameOrigin({ kind: 'station', stop: 1 }, 0), { x: STOPS[1].x, z: 0 });
  const tr = local(3, 500);
  assert.deepEqual(frameOrigin({ kind: 'train', k: 3 }, 500), trainOrigin(tr));
});

test('a slow frame as the doors open (building the next station, say) still lets you off', () => {
  const r = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 }, me = w(30, -0.5);
  assert.equal(stepRider(r, me, arrivalAtStop(0, 1) + DOORS.open[0] + 3), 'alight');
  assert.deepEqual(r.frame, { kind: 'station', stop: 1 });
});
