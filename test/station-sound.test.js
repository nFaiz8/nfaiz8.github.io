import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation, LEVEL } from '../src/rpg/map.js';
import { footfall, surfaceAt, spatial, trainNoise, rideNoise, doorEvents, knocks, AXLES, JOINT, announcementAt, announcementsBetween, ANNOUNCE, stairsMusic, STAIRS_MUSIC, rotorClicks, tubeFault, dripLanded, DRIP } from '../src/rpg/sound.js';
import { trainsAt, local, arrivalAt, arrivalAtStop, DOORS, LENGTH, TRAIN } from '../src/rpg/schedule.js';
import { parseMuted, formatMuted, readMuted, writeMuted, MUTE_KEY } from '../src/sound-pref.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const on = (x, z) => ({ x, z, y: MAP.levelAt(x, z) });

test('a foot comes down twice a stride, at π/2 and 3π/2, either way round', () => {
  const H = Math.PI / 2;
  assert.equal(footfall(H - 0.1, H + 0.1), true);
  assert.equal(footfall(3 * H - 0.1, 3 * H + 0.1), true);
  assert.equal(footfall(H + 0.1, H - 0.1), true, 'stepping back');
  assert.equal(footfall(0.1, 0.5), false);
  assert.equal(footfall(2 * Math.PI - 0.05, 0.05), false, 'the wrap at 2π is mid-stride');
  assert.equal(footfall(NaN, 1), false);
  // Walking 10 strides' worth of phase in small steps: 20 footfalls.
  let n = 0, p = 0;
  for (let i = 0; i < 2000; i++) { const q = (p + (20 * Math.PI) / 2000) % (2 * Math.PI); if (footfall(p, q)) n++; p = q; }
  assert.equal(n, 20);
});

test('what your feet are on comes from the map tile', () => {
  assert.equal(surfaceAt(MAP, 5.5, 9.5), 'tile', 'the hall');
  assert.equal(surfaceAt(MAP, 30.5, 9.5), 'concrete', 'the platform');
  assert.equal(surfaceAt(MAP, 16.5, 9.5), 'stairs', 'the stairs down');
  assert.equal(surfaceAt(MAP, 12.5, 8.5), 'tile', 'a turnstile lane');
  assert.equal(surfaceAt(MAP, 0.5, 0.5), null, 'a wall');
  assert.equal(surfaceAt(MAP, -3, 4), null, 'off the map');
});

test('a sound is loudest at its source, half as loud at ref, and panned by east and west', () => {
  const me = { x: 10, y: 0, z: 10 };
  assert.equal(spatial(10, 0, 10, me).gain, 1);
  assert.ok(Math.abs(spatial(13, 0, 10, me, 3).gain - 0.5) < 1e-9);
  assert.ok(spatial(20, 0, 10, me).pan > 0.5, 'east is right');
  assert.ok(spatial(0, 0, 10, me).pan < -0.5, 'west is left');
  assert.ok(Math.abs(spatial(10, 0, 0, me).pan) < 1e-9, 'straight north is centred');
});

test('the museum music: loud and least muffled by the exit stairs, gone a few tiles into the hall', () => {
  const at = (x, z) => stairsMusic({ x, z }, MAP.exits);
  const foot = at(2.5, 9.5), mid = at(5.5, 9.5), far = at(10.5, 9.5);
  assert.ok(Math.abs(foot.gain - STAIRS_MUSIC.gain) < 0.02, `at the foot ${foot.gain}`);
  assert.ok(mid.gain < foot.gain && mid.gain > 0);
  assert.equal(far.gain, 0);
  assert.ok(foot.cutoff > mid.cutoff, 'less muffled close to');
  assert.ok(foot.pan <= 0, 'the stairs are on your left (west)');
  assert.equal(stairsMusic({ x: 0, z: 0 }, []).gain, 0);
});

test('the rotor: a clunk as it takes you, ratchet clicks, a clunk as it clicks over', () => {
  assert.deepEqual(rotorClicks(0, 0.1), ['take']);
  assert.deepEqual(rotorClicks(0.1, 0.5), ['tick']);
  assert.deepEqual(rotorClicks(0.5, 1), ['tick', 'over']);
  assert.deepEqual(rotorClicks(-0.25, -0.35), ['tick'], 'going back west');
  assert.deepEqual(rotorClicks(0.5, 0.2), [], 'springing back is quiet');
  let all = [];
  for (let p = 0; p < 1; p += 0.05) all = all.concat(rotorClicks(p, Math.min(1, p + 0.05)));
  assert.deepEqual(all, ['take', 'tick', 'tick', 'over']);
});

test('the faulty tube and the drips keep scene.js timing', () => {
  // A stutter of on and off every 4.1 s.
  const flips = (a, b) => { let n = 0, k = tubeFault(a); for (let t = a; t < b; t += 0.005) { const v = tubeFault(t); if (v !== k) n++; k = v; } return n; };
  assert.ok(flips(2.8, 3.7) >= 4, 'stutters');
  for (const v of [0, 1, 2.9, 3.1, 10.2]) assert.ok([0.1, 1].includes(tubeFault(v)));
  // Each drip lands once per period, DRIP.fall after it starts falling.
  let n = 0;
  for (let t = 0; t < 600; t += 0.01) if (dripLanded(0, t, t + 0.01)) n++;
  assert.equal(n, Math.floor((600 - DRIP.fall) / DRIP.period(0)) + 1);
  for (let i = 0; i < 6; i++) assert.ok(DRIP.period(i) >= 120 && DRIP.period(i) <= 180, 'every 2–3 minutes');
  assert.equal(dripLanded(1, DRIP.fall - 0.01, DRIP.fall + 0.01), true);
  assert.equal(dripLanded(1, 5, 5), false);
});

test('mute is remembered as on/off, and anything else means sound on', () => {
  assert.equal(parseMuted('off'), true);
  assert.equal(parseMuted('on'), false);
  assert.equal(parseMuted(null), false);
  assert.equal(parseMuted('garbage'), false);
  assert.equal(parseMuted(formatMuted(true)), true);
  const mem = new Map(), store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(readMuted(store), false);
  writeMuted(true, store);
  assert.equal(mem.get(MUTE_KEY), 'off');
  assert.equal(readMuted(store), true);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readMuted(broken), false);
  assert.doesNotThrow(() => writeMuted(true, broken));
  assert.equal(readMuted(null), false);
});

test('levels are fixed numbers in range', () => {
  for (let t = 0; t < 400; t += 0.37) {
    const s = trainNoise(trainsAt(t), on(30, 9.5));
    for (const k of ['rumble', 'roar', 'screech', 'wind']) assert.ok(s[k] >= 0 && s[k] <= 1, `${k} ${s[k]} at ${t}`);
    assert.ok(s.pan >= -1 && s.pan <= 1);
  }
  assert.equal(LEVEL.hall, 0);
});

test('trainNoise: nothing far away; a passing express roars close on your side; a standing local only hums', () => {
  const quiet = trainNoise([], { x: 60, y: -3, z: 9 });
  assert.equal(quiet.roar, 0);
  const x = { id: 'X', kind: 'express', track: { i: 0, z: 2.5 }, dir: 1, head: 70, tail: 70 - LENGTH, speed: 25, accel: 0, clip: [-150, 215] };
  const near = trainNoise([x], { x: 60, y: -3, z: 6 }), far = trainNoise([x], { x: 60, y: -3, z: 13 });
  assert.ok(near.roar > 0.5 && near.roar > far.roar);
  const standing = local(0, arrivalAt(0) + 5);
  assert.equal(trainNoise([standing], { x: 60, y: -3, z: 6 }).roar, 0);
  assert.ok(trainNoise([standing], { x: 60, y: -3, z: 6 }).rumble > 0);
  const braking = local(0, arrivalAt(0) - 3);
  assert.ok(trainNoise([braking], { x: 60, y: -3, z: 6 }).screech > 0, 'brakes squeal coming in');
  assert.ok(trainNoise([x], { x: 10, y: 0, z: 9 }, { inHall: true }).roar < near.roar, 'muffled in the hall');
});

test('rideNoise: the motor follows speed; the bridge rings; braking hisses', () => {
  const still = rideNoise(local(0, arrivalAt(0) + 5), 60), cruising = rideNoise(local(0, arrivalAt(0) + 18 + 12), 300);
  assert.equal(still.motor, 0);
  assert.ok(cruising.motor > 0.8 && cruising.pitch > still.pitch);
  const onBridge = local(0, arrivalAt(0) + 18 + 28);
  assert.ok(rideNoise(onBridge, (onBridge.head + onBridge.tail) / 2).bridge > 0.9);
  assert.ok(rideNoise(local(0, arrivalAtStop(0, 1) - 2), 840).brake > 0);
});

test('the clatter: 4 axles a car on the new train, knocking over joints every JOINT tiles', () => {
  assert.equal(AXLES.length, TRAIN.cars * 4);
  assert.ok(Math.max(...AXLES) < LENGTH);
  assert.equal(knocks(0, JOINT, 1).length, AXLES.length, 'every axle crosses one joint in a joint\'s run');
});

test('door events at a stop: the doors open, then the chime as they close', () => {
  const a = arrivalAt(2);
  assert.deepEqual(doorEvents(a + DOORS.open[0] - 0.1, a + DOORS.open[0] + 0.1, 0), [{ k: 2, kind: 'open' }]);
  assert.deepEqual(doorEvents(a + DOORS.close[0] - 0.1, a + DOORS.close[0] + 0.1, 0), [{ k: 2, kind: 'chime' }]);
  assert.deepEqual(doorEvents(a + 5, a + 6, 0), []);
});

test('announcements wait until the station is quiet', () => {
  const busy = (t) => t > 10 && t < 40;
  const k = [...Array(40).keys()].find((i) => { const at = ANNOUNCE.first + ANNOUNCE.every * i; return at > 5 && at < 40; }) ?? 0;
  const at = announcementAt(k, busy);
  assert.ok(!busy(at) && !busy(at + ANNOUNCE.dur));
  assert.deepEqual(announcementsBetween(at - 0.1, at + 0.1, busy), [k]);
});
