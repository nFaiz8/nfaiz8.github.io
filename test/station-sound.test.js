import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation, LEVEL } from '../src/rpg/map.js';
import { startOf, TRAIN, LENGTH } from '../src/rpg/train.js';
import { footfall, surfaceAt, spatial, trainSound, TRAIN_SOUND, knocks, AXLES, JOINT, announcementAt, announcementsBetween, ANNOUNCE, stairsMusic, STAIRS_MUSIC, rotorClicks, tubeFault, dripLanded, DRIP } from '../src/rpg/sound.js';
import { parseMuted, formatMuted, readMuted, writeMuted, MUTE_KEY } from '../src/sound-pref.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const travel = (MAP.cols + LENGTH + 4) / TRAIN.speed;
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

test('the train rumbles in its tunnel before it comes out, building with the glow', () => {
  const start = startOf(0), me = on(30, 9.5); // train 0: the north track, eastbound, from the west tunnel
  const quiet = trainSound(start - TRAIN_SOUND.build - 1, MAP, me);
  assert.equal(quiet.rumble, 0);
  const early = trainSound(start - TRAIN_SOUND.build + 1, MAP, me), late = trainSound(start - 0.5, MAP, me);
  assert.ok(early.rumble > 0 && late.rumble > early.rumble * 3, `builds ${early.rumble} → ${late.rumble}`);
  assert.equal(late.roar, 0, 'no roar while it is still in the tunnel');
  assert.ok(late.pan < 0, 'from the west tunnel, on your left');
});

test('passing, the train is loud near you and panned to where it is', () => {
  const start = startOf(0);
  const atX = (x) => start + (x + 2) / TRAIN.speed; // the nose at x
  const me = on(30, 5.5); // on the platform by the north track
  const before = trainSound(atX(20), MAP, me), level = trainSound(atX(36), MAP, me);
  assert.ok(level.roar > 0.5, `roar beside you: ${level.roar}`);
  assert.ok(level.screech > 0.3);
  assert.ok(before.pan < level.pan || before.pan < 0, 'coming from the west');
  assert.ok(level.roar > before.roar, 'louder alongside than approaching');
  // From the hall, behind the walls: quieter and muffled.
  const hall = trainSound(atX(36), MAP, on(5.5, 9.5));
  assert.ok(hall.roar < level.roar * 0.2, `hall roar ${hall.roar}`);
  assert.ok(hall.muffle < 1);
  // The far (south) track is quieter than the near one.
  const far = trainSound(atX(36), MAP, on(30, 12.5));
  assert.ok(far.roar < level.roar);
});

test('the wind follows the train, and its rumble fades into the other tunnel', () => {
  const start = startOf(0), end = start + travel, me = on(10 + 20, 5.5);
  // Just after the tail has gone by you: wind.
  const tailPast = start + (me.x + 2 + LENGTH + 3) / TRAIN.speed;
  assert.ok(trainSound(tailPast, MAP, me).wind > 0.4);
  const a = trainSound(end + 0.5, MAP, me), b = trainSound(end + TRAIN_SOUND.fade - 0.5, MAP, me);
  assert.equal(a.phase, 'going');
  assert.ok(a.rumble > b.rumble && b.rumble > 0, `fades ${a.rumble} → ${b.rumble}`);
  assert.ok(a.pan > 0, 'into the east tunnel, on your right');
  assert.equal(trainSound(end + TRAIN_SOUND.fade + 0.5, MAP, me).rumble, 0);
});

test('the clatter: each axle knocks once per rail joint it crosses', () => {
  assert.equal(AXLES.length, TRAIN.cars * 4);
  const all = knocks(-2, 50, 1); // the nose going east across the whole station
  // Every axle crosses each joint it reaches once.
  const expected = AXLES.reduce((n, o) => n + Math.max(0, Math.floor((50 - o) / JOINT) - Math.floor((-2 - o) / JOINT)), 0);
  assert.equal(all.length, expected);
  assert.ok(all.every((x) => x % JOINT === 0));
  assert.deepEqual(knocks(5, 5, 1), []);
  // Split into frames, the same knocks.
  let split = 0;
  for (let h = -2; h < 50; h += 0.4) split += knocks(h, Math.min(50, h + 0.4), 1).length;
  assert.equal(split, all.length);
});

test('the PA speaks now and then, never over a train', () => {
  const times = Array.from({ length: 30 }, (_, k) => announcementAt(k, MAP));
  for (let k = 1; k < times.length; k++) assert.ok(times[k] > times[k - 1] + 10, `announcement ${k} after ${k - 1}`);
  assert.ok(times[0] >= 5, 'not the moment you arrive');
  for (const at of times) {
    for (let n = 0; n < 60; n++) {
      const from = startOf(n) - TRAIN_SOUND.build, to = startOf(n) + travel;
      assert.ok(at >= to || at + ANNOUNCE.dur <= from, `announcement at ${at.toFixed(1)} overlaps train ${n}`);
    }
  }
  // Stepping a clock frame by frame finds each one exactly once.
  const seen = [];
  for (let t = 0; t < 600; t += 1 / 60) seen.push(...announcementsBetween(t, t + 1 / 60, MAP));
  assert.deepEqual(seen, times.filter((t) => t <= 600 + 1 / 60).map((_, k) => k));
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
    const s = trainSound(t, MAP, on(30, 9.5));
    for (const k of ['rumble', 'roar', 'screech', 'wind']) assert.ok(s[k] >= 0 && s[k] <= 1, `${k} ${s[k]} at ${t}`);
    assert.ok(s.pan >= -1 && s.pan <= 1);
  }
  assert.equal(LEVEL.hall, 0);
});
