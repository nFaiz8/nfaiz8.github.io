import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOPS, PIECES } from '../src/rpg/line.js';
import {
  trainsAt, localsAt, local, localMotion, doorsAt, arrivalAt, arrivalAtStop, lastStopOf, RIDE, DIST, LENGTH, LOCAL, DOORS,
  departures, minutes, turnaround, turnaroundDue, passFor, SERVICE, PERIOD, EXPRESS,
} from '../src/rpg/schedule.js';

const span = (x) => {
  let lo = Math.min(x.head, x.tail), hi = Math.max(x.head, x.tail);
  if (x.clip) { lo = Math.max(lo, x.clip[0]); hi = Math.min(hi, x.clip[1]); }
  return [lo, hi];
};

test('a local arrives at MUSEUM every 60 s, eastbound and westbound in turn, and stands 18 s', () => {
  for (let k = 0; k < 6; k++) {
    const tr = local(k, arrivalAt(k) + 1);
    assert.equal(tr.at, 0, `L${k} stands at MUSEUM`);
    assert.equal(tr.speed, 0);
    assert.equal(tr.dir, k % 2 === 0 ? 1 : -1);
    assert.equal(tr.track.i, k % 2 === 0 ? 0 : 1, 'eastbound on the north track');
    assert.ok(Math.abs((tr.head + tr.tail) / 2 - STOPS[0].centre) < 1e-9, 'its middle at the platform middle');
    assert.equal(local(k, arrivalAt(k) + LOCAL.dwell + 0.5).at, null, 'gone after 18 s');
  }
  assert.equal(arrivalAt(1) - arrivalAt(0), 60);
});

test('the ride: 57 s and 780 tiles from leaving one station to standing at the next', () => {
  assert.equal(RIDE, 57);
  assert.equal(DIST, 780);
  assert.equal(STOPS[1].centre - STOPS[0].centre, DIST, 'the stations are a ride apart');
  const tr = local(0, arrivalAtStop(0, 1) + 1);
  assert.equal(tr.at, 1, 'L0 stands at CANAL ST');
  assert.ok(Math.abs((tr.head + tr.tail) / 2 - STOPS[1].centre) < 1e-6);
  assert.equal(lastStopOf(0), 1);
  assert.equal(lastStopOf(1), 0);
});

test('motion is continuous: no jump in position or speed anywhere in a trip', () => {
  let prev = localMotion(-60);
  for (let tau = -59.99; tau < 160; tau += 0.01) {
    const m = localMotion(tau);
    assert.ok(Math.abs(m.s - prev.s) < 0.25, `position jumps at ${tau}`);
    assert.ok(Math.abs(m.v - prev.v) < 0.1, `speed jumps at ${tau}`);
    prev = m;
  }
});

test('the middle car spends over 20 s on the bridge, both ways', () => {
  const b = PIECES.find((p) => p.kind === 'bridge');
  for (const k of [10, 11]) {
    let on = 0;
    for (let t = arrivalAt(k) - 200; t < arrivalAt(k) + 200; t += 0.1) {
      const tr = local(k, t), mid = (tr.head + tr.tail) / 2;
      if (mid > b.x0 && mid < b.x1) on += 0.1;
    }
    assert.ok(on > 20, `L${k}: ${on.toFixed(1)} s on the bridge`);
  }
});

test('doors: shut, then opening at 1 s, open from 2 s, closing from 15 s, shut at 17 s; only while standing', () => {
  assert.equal(doorsAt(0.5), 0);
  assert.equal(doorsAt(1.5), 0.5);
  assert.equal(doorsAt(DOORS.open[1]), 1);
  assert.equal(doorsAt(14.9), 1);
  assert.equal(doorsAt(16), 0.5);
  assert.equal(doorsAt(17), 0);
  for (let t = 0; t < 600; t += 0.37) for (const tr of localsAt(t)) if (tr.doors > 0) assert.notEqual(tr.at, null);
});

test('never two trains overlapping on one track', () => {
  for (let t = 0; t < 2400; t += 0.25) {
    const all = trainsAt(t);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (all[i].track !== all[j].track) continue;
      const [a0, a1] = span(all[i]), [b0, b1] = span(all[j]);
      assert.ok(!(a0 < b1 && b0 < a1), `${all[i].id} and ${all[j].id} overlap at ${t}`);
    }
  }
});

test('expresses: one through MUSEUM about every 30 s, at 25 tiles/s, never stopping', () => {
  const seen = new Set();
  for (let t = 300; t < 900; t += 0.25) for (const x of trainsAt(t)) {
    if (x.kind !== 'express') continue;
    assert.equal(x.speed, 25);
    assert.equal(x.at, null);
    const [lo, hi] = span(x);
    if (lo < STOPS[0].centre && hi > STOPS[0].centre) seen.add(x.id);
  }
  assert.ok(seen.size >= 18 && seen.size <= 21, `${seen.size} expresses in 600 s`);
  assert.equal(EXPRESS.every, 30);
});

test('the same moment gives the same trains, and PERIOD is whole cycles of both services', () => {
  assert.deepEqual(trainsAt(1234.5), trainsAt(1234.5));
  assert.equal(PERIOD % (2 * LOCAL.every), 0);
  assert.equal(PERIOD % EXPRESS.every, 0);
});

test('the departures board: the next two locals, NOW while one stands, LAST STOP for one ending here', () => {
  assert.equal(minutes(10), '<1 MIN');
  assert.equal(minutes(130), '2 MIN');
  const t = arrivalAt(4) + 3; // L4 (eastbound) stands at MUSEUM
  const d = departures(t, 0, false);
  if (!d.warn) {
    assert.match(d.lines[0], /^TO CANAL ST +NOW$/);
    assert.match(d.lines[1], /^LAST STOP +1 MIN$/, 'L5 ends at MUSEUM');
    assert.equal(d.lines[0].length, d.lines[1].length, 'right-aligned');
  }
  const c = departures(arrivalAtStop(4, 1) + 3, 1, false);
  if (!c.warn) assert.match(c.lines[0], /^LAST STOP +NOW$/);
  // An express coming: the warning, then the board again.
  let warned = false;
  for (let s = 0; s < 120; s += 0.25) if (departures(s, 0, false).warn) { warned = true; assert.match(departures(s, 0, false).lines.join('|'), /EXPRESS.*\|.*STAND BACK/); }
  assert.ok(warned);
  let changes = 0, last = '';
  for (let s = 0; s < 120; s += 0.25) { const k = departures(s, 0).lines.join('|'); if (k !== last) changes++; last = k; }
  assert.ok(changes < 120 * 2.5, `${changes} redraws in two minutes`);
  assert.equal(SERVICE, 5);
});

test('the turnaround: still aboard 8 s after the last stop, you ride back on the next local the other way', () => {
  const k = 0, end = arrivalAtStop(k, 1);
  assert.equal(turnaroundDue(k, end + LOCAL.dwell + 7), false);
  assert.equal(turnaroundDue(k, end + LOCAL.dwell + 8), true);
  const t = end + LOCAL.dwell + 8, j = turnaround(k, t);
  assert.equal(j % 2, 1, 'westbound');
  assert.ok(arrivalAtStop(j, 1) >= t, 'not yet arrived at CANAL ST');
  const k2 = 1, t2 = arrivalAtStop(k2, 0) + LOCAL.dwell + 8, j2 = turnaround(k2, t2);
  assert.equal(j2 % 2, 0, 'eastbound');
  assert.ok(arrivalAtStop(j2, 0) >= t2);
  assert.ok(local(j2, t2).head > -600, 'still on the line, in the west tunnel');
});

test('passFor: the station\'s view of the nearest train, in its own coordinates and on its own track object', () => {
  const map = { tracks: [{ z: 2.5, name: 'north' }, { z: 16.5, name: 'south' }] };
  const t = arrivalAt(0) + 5, p = passFor(trainsAt(t), 0, map);
  assert.equal(p.phase, 'pass');
  assert.equal(p.track, map.tracks[0]);
  assert.equal(p.speed, 0);
  // Some time in the 3 s before a train comes out of a tunnel there's a warning.
  let warned = false;
  for (let s = 0; s < 120; s += 0.1) { const q = passFor(trainsAt(s), 0, map); if (q && q.phase === 'warn') { warned = true; assert.ok(q.warn > 0 && q.warn <= 1); } }
  assert.ok(warned);
});
