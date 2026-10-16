// test/station-peers.test.js: other players in the station (station spec, Multiplayer): their smoothing,
// their walk, the wire's positions and the shared clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeers3d, sampleTrack, stepRemote, wirePos, REMOTE } from '../src/rpg/peers3d.js';
import { sharedTime, clockOffset, PERIOD, trainAt, startOf } from '../src/rpg/train.js';
import { parseStation } from '../src/rpg/map.js';
import { STATION } from '../server/rules.js';
import { LINE } from '../src/rpg/line.js';
import { LENGTH } from '../src/rpg/schedule.js';
import fs from 'node:fs';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('positions are drawn a little behind, between the two around that moment', () => {
  const ps = createPeers3d({ delay: 300 });
  ps.reset([{ id: 'a', name: 'Ann', x: 1, z: 1, y: 0, a: 0 }], 0);
  ps.apply({ t: 'q', id: 'a', x: 2, z: 1, y: 0, a: 1 }, 200);
  ps.apply({ t: 'q', id: 'a', x: 3, z: 1, y: -1 }, 400);
  const at = (now) => ps.list(now)[0];
  assert.equal(at(200).x, 1, 'before the track starts: its first point');
  assert.ok(near(at(400).x, 1.5));
  assert.ok(near(at(600).x, 2.5));
  assert.ok(near(at(600).y, -0.5));
  assert.equal(at(5000).x, 3, 'after it ends: its last point');
  assert.equal(at(600).a, 1, 'the yaw is the latest known, not blended');
});

test('a jump longer than a few tiles is a jump: the track starts again there', () => {
  const ps = createPeers3d({ delay: 300 });
  ps.reset([{ id: 'a', x: 1, z: 1 }], 0);
  ps.apply({ t: 'q', id: 'a', x: 30, z: 9 }, 200);
  assert.equal(ps.list(300)[0].x, 30);
});

test('join, leave, names, chat and emotes; someone without a position is not drawn yet', () => {
  const ps = createPeers3d();
  ps.reset([], 0);
  ps.apply({ t: 'join', id: 'b', name: 'Bo' }, 0);
  assert.deepEqual(ps.list(10), []);
  ps.apply({ t: 'q', id: 'b', x: 5, z: 5 }, 10);
  ps.apply({ t: 'n', id: 'b', name: 'Bob' }, 10);
  ps.apply({ t: 'c', id: 'b', text: 'hello' }, 10);
  ps.apply({ t: 'e', id: 'b', e: 'heart' }, 10);
  const [p] = ps.list(100);
  assert.deepEqual([p.name, p.say, p.emote], ['Bob', 'hello', '♥']);
  assert.ok(p.emoteAge > 0 && p.emoteAge < 0.1);
  assert.equal(ps.list(10 + REMOTE.say).at(0).say, null, 'speech goes after a few seconds');
  ps.apply({ t: 'leave', id: 'b' }, 200);
  assert.equal(ps.count(), 0);
});

test('a remote figure walks: it faces where it goes, its stride follows the ground, and it stands still facing its yaw', () => {
  const r = {};
  stepRemote(r, { x: 5, z: 5, a: 0.5 }, 1 / 60);
  assert.equal(r.yaw, 0.5, 'a new one stands where it is, facing its yaw');
  assert.equal(r.gait, 0);
  let phase0 = r.phase;
  for (let i = 1; i <= 60; i++) stepRemote(r, { x: 5 + (4.2 * i) / 60, z: 5, a: 0.5 }, 1 / 60); // walking east for a second
  assert.ok(near(r.yaw, Math.PI / 2, 0.05), `faces east: ${r.yaw}`);
  assert.ok(r.gait > 0.9 && r.gait < 1.1, `walking gait ${r.gait}`);
  assert.notEqual(r.phase, phase0, 'the stride moved');
  for (let i = 0; i < 60; i++) stepRemote(r, { x: 9.2, z: 5, a: -1 }, 1 / 60);
  assert.ok(r.gait < 0.05, 'stopped');
  assert.ok(near(r.yaw, -1, 0.05), 'turned to the yaw it sent');
  stepRemote(r, { x: 30, z: 9 }, 1 / 60);
  assert.deepEqual([r.x, r.z, r.gait], [30, 9, 0], 'a jump: no stride across it');
});

test('wirePos: to 0.01, the yaw wrapped into ±π', () => {
  assert.deepEqual(wirePos({ x: 1.23456, z: 2.005, y: -2.999, a: 2 * Math.PI + 0.5 }), { x: 1.23, z: 2.01, y: -3, a: 0.5 });
  assert.deepEqual(wirePos({ x: 1, z: 2 }), { x: 1, z: 2 });
  assert.ok(Math.abs(wirePos({ x: 0, z: 0, a: Math.PI }).a) <= 3.14);
});

test('the shared clock: the same epoch gives everyone the same train; it wraps every PERIOD seconds', () => {
  const map = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
  const epoch = 1_790_000_000_000;
  const t = sharedTime(epoch);
  assert.ok(t >= 0 && t < PERIOD);
  assert.equal(sharedTime(epoch + PERIOD * 1000), t);
  assert.ok(near(sharedTime(epoch + 1500) - t, 1.5, 1e-6));
  // Two players whose clocks agree see the same run at the same place.
  const s = startOf(Math.floor(t / 35) + 2) + 1;
  const ms = epoch + (s - t) * 1000;
  const a = trainAt(sharedTime(ms), map), b = trainAt(sharedTime(ms + 20), map);
  assert.equal(a.n, b.n);
  assert.ok(Math.abs(a.head - b.head) < 1, 'within a frame or so');
});

test('clockOffset: the server clock less mine, counting half the round trip', () => {
  assert.equal(clockOffset(10_000, 100, 9_000), 1_050);
  assert.equal(clockOffset(10_000, null, 10_000), 0);
});

test('the server\'s station bounds are the station map\'s', () => {
  const map = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
  assert.deepEqual([STATION.x0, STATION.x1, STATION.rows, STATION.length], [LINE.x0, LINE.x1, map.rows, LENGTH]);
  const ys = map.cells.map((c) => c.level).filter((l) => l != null);
  assert.ok(Math.min(...ys) >= STATION.yMin && Math.max(...ys) <= STATION.yMax);
});

test('speech over a head wraps at spaces into at most three lines', async () => {
  const { wrapSpeech } = await import('../src/rpg/others.js');
  assert.deepEqual(wrapSpeech('mind the gap'), ['mind the gap']);
  assert.deepEqual(wrapSpeech('the next train is not in service please stand back', 20), ['the next train is', 'not in service', 'please stand back']);
  assert.deepEqual(wrapSpeech('x'.repeat(30), 12), ['x'.repeat(12), 'x'.repeat(12), 'x'.repeat(6)]);
  const long = wrapSpeech('a '.repeat(60).trim(), 10, 3);
  assert.equal(long.length, 3);
  assert.ok(long[2].endsWith('…'));
});

test('aboard: a track keeps the train number; changing frame starts a new track; the wire carries tr and s', () => {
  const p = createPeers3d({ delay: 0 });
  p.reset([{ id: 'a', name: 'A', x: 28.5, z: 6 }], 0);
  p.apply({ t: 'q', id: 'a', tr: 4, x: 7.5, z: 0.5, a: 1, s: 0 }, 100);
  const l = p.list(100)[0];
  assert.equal(l.tr, 4);
  assert.equal(p.get('a').track.length, 1, 'a new frame is a new track');
  p.apply({ t: 'q', id: 'a', tr: 4, x: 8.5, z: 0.5, a: 1, s: 1 }, 200);
  assert.equal(p.list(150)[0].x, 8, 'smoothed within the frame');
  assert.equal(p.list(200)[0].s, 1);
  assert.deepEqual(wirePos({ tr: 4, x: 7.512, z: 0.5, a: 1, s: 1 }), { tr: 4, x: 7.51, z: 0.5, a: 1, s: 1 });
});
