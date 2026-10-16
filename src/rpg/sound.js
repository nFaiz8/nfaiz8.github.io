// The station's sound, the parts that are only arithmetic (station spec §8): when a foot comes down, what it lands
// on, how loud the train is and where, when the PA speaks, how loud the museum's music is down the exit stairs, and
// the timing shared with scene.js so a sound and what you see happen together (the faulty tube, the drips). Pure:
// no Web Audio, no three.js, so the tests drive it. audio.js plays it.
import { LEVEL } from './map.js';
import { TRAIN, LOCAL, DOORS, localsAt, arrivalAtStop } from './schedule.js';
import { sunAt } from './line.js';
import { PITCH } from './car.js';

const TAU = 2 * Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);

// ── Timing shared with scene.js ────────────────────────────────────────────────────────────────────────────────
// The faulty tube: a 0.9 s stutter (on-off about 4 a second) every 4.1 s, and a flick now and then between. 1 lit,
// 0.1 out. scene.js dims the tube by it and audio.js crackles when it changes.
export function tubeFault(time) {
  const ph = (time + 1.3) % 4.1;
  if (ph < 0.9) return Math.sin(time * 26) > -0.2 ? 0.1 : 1;
  return Math.sin(time * 31) + Math.sin(time * 7.3) > 1.75 ? 0.1 : 1;
}
// Is the tube in its stutter (so it buzzes louder)?
export const tubeStutter = (time) => (time + 1.3) % 4.1 < 0.9;

// Drips: each puddle's drop falls for DRIP.fall seconds from the ceiling, lands, and ripples for DRIP.ring; puddle i
// drips every DRIP.period(i) seconds: now and then, every 2–3 minutes, each puddle on its own beat.
export const DRIP = { fall: 0.6, ring: 0.8, period: (i) => 120 + ((i * 37) % 61) };
// Did puddle i's drop land between t0 (exclusive) and t1 (inclusive)?
export function dripLanded(i, t0, t1) {
  if (!(t1 > t0)) return false;
  const p = DRIP.period(i);
  const k = Math.floor((t1 - DRIP.fall) / p); // the last landing at or before t1
  return k >= 0 && DRIP.fall + k * p > t0;
}

// ── Footsteps ──────────────────────────────────────────────────────────────────────────────────────────────────
// rig.js lifts the left foot while cos(phase) > 0 and the right while cos(phase + π) > 0, so a foot comes down as the
// phase passes π/2 and 3π/2. Did one come down as the phase went from prev to next (either way round, as stepping
// back runs the cycle backward)? The phase moves well under π a frame.
export function footfall(prev, next) {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return false;
  const seg = (p) => Math.floor((((p - Math.PI / 2) % TAU) + TAU) % TAU / Math.PI);
  return seg(prev) !== seg(next);
}

// What your feet are on, from the map's tile: the stairs sound hollow, the hall's floor is hard tile, the platform
// gritty concrete. null off the map or on a tile you can't stand on.
export function surfaceAt(map, x, z) {
  const cell = map.at(Math.floor(x), Math.floor(z));
  if (!cell || !cell.walk) return null;
  if (cell.stair) return 'stairs';
  if (cell.level === LEVEL.platform) return 'concrete';
  return 'tile';
}

// ── Where a sound is ───────────────────────────────────────────────────────────────────────────────────────────
// Loudness by distance (1 at the source, ½ at `ref`) and a stereo pan by how far east or west of you it is: the
// camera looks north from behind you, so east is right.
export function spatial(sx, sy, sz, me, ref = 3, width = 7) {
  const d = Math.hypot(sx - me.x, (sy ?? me.y) - me.y, sz - me.z);
  return { gain: 1 / (1 + (d / ref) ** 2), pan: clamp((sx - me.x) / width, -1, 1) * 0.85, d };
}

// ── The trains ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The loudest train you can hear, from the schedule (subway ride spec §8): a rumble from any train near, its roar and
// the wind by speed, a squeal while a local brakes in, all falling off with distance and the far track quieter. muffle:
// how much reaches you through the hall's walls. Each 0…1 before the mixer; pan −1…1.
export const TRAIN_SOUND = { ref: 5, reach: 60 };
export function trainNoise(trains, me, { inHall = false } = {}) {
  const out = { rumble: 0, roar: 0, screech: 0, wind: 0, pan: 0, muffle: inHall ? 0.35 : 1, id: null };
  for (const tr of trains) {
    let lo = Math.min(tr.head, tr.tail), hi = Math.max(tr.head, tr.tail);
    if (tr.clip) { lo = Math.max(lo, tr.clip[0]); hi = Math.min(hi, tr.clip[1]); if (hi <= lo) continue; }
    const nx = clamp(me.x, lo, hi), d = Math.hypot(nx - me.x, tr.track.z - me.z, LEVEL.track + 1.5 - me.y);
    if (d > TRAIN_SOUND.reach) continue;
    const near = 1 / (1 + (d / TRAIN_SOUND.ref) ** 2), across = 1 / (1 + ((tr.track.z - me.z) / 7) ** 2), v = clamp01(tr.speed / 25);
    const rumble = (0.35 + 0.65 * near) * (0.3 + 0.7 * v) * Math.max(0.2, 1 - d / TRAIN_SOUND.reach);
    if (rumble <= out.rumble) continue;
    const braking = tr.kind === 'local' && tr.accel * tr.dir < -0.3 && tr.speed > 1;
    Object.assign(out, {
      id: tr.id, rumble,
      roar: near * v * (inHall ? 0.45 : 1),
      screech: braking ? near ** 1.2 * clamp01(tr.speed / 12) * (inHall ? 0.3 : 1) : near ** 1.5 * v * 0.4,
      wind: across * near * v,
      pan: clamp((nx - me.x) / 12, -1, 1) * 0.9,
    });
  }
  if (inHall) { out.rumble *= 0.55; out.wind *= 0.4; }
  return out;
}

// Riding (§8): the motor's whine follows the speed, the bridge's steel rings hollow, a hiss as the brakes bring it in.
export function rideNoise(tr, x) {
  const v = clamp01(tr.speed / TRAIN.cruise), braking = tr.accel * tr.dir < -0.3;
  return { motor: v, pitch: 70 + 160 * v, bridge: sunAt(x), brake: braking && tr.speed < 6 ? clamp01(1 - tr.speed / 6) : 0 };
}

// The clatter: each car's 4 axles (2 bogies) knocking over rail joints every JOINT tiles. Axles back from the nose:
export const JOINT = 12;
export const AXLES = Array.from({ length: TRAIN.cars }, (_, c) => [1.4, 3.4, TRAIN.car - 3.4, TRAIN.car - 1.4].map((o) => o + c * PITCH)).flat();
// The joints any axle crossed while the nose went from h0 to h1 (going dir): their x, one entry per knock.
export function knocks(h0, h1, dir) {
  const out = [];
  if (!(Number.isFinite(h0) && Number.isFinite(h1)) || h0 === h1) return out;
  for (const o of AXLES) {
    const a = h0 - dir * o, b = h1 - dir * o, lo = Math.min(a, b), hi = Math.max(a, b);
    for (let j = Math.floor(lo / JOINT) + 1; j * JOINT <= hi; j++) if (j * JOINT > lo) out.push(j * JOINT);
  }
  return out;
}

// ── The PA ─────────────────────────────────────────────────────────────────────────────────────────────────────
// A stop's door events between t0 and t1 at stop: the doors opening, and the chime as they start to close.
export function doorEvents(t0, t1, stop) {
  const out = [];
  if (!(t1 > t0)) return out;
  for (const l of localsAt(t1)) {
    const a = arrivalAtStop(l.k, stop);
    if (a + DOORS.open[0] > t0 && a + DOORS.open[0] <= t1) out.push({ k: l.k, kind: 'open' });
    if (a + DOORS.close[0] > t0 && a + DOORS.close[0] <= t1) out.push({ k: l.k, kind: 'chime' });
  }
  return out;
}

// Now and then a chime and a muffled announcement. Deterministic in time, as the trains are, and never over a train:
// one that would overlap a busy moment waits until after it.
export const ANNOUNCE = { first: 16, every: 52, jitter: 22, dur: 5.5 };
function hash(n) {
  let h = Math.imul(n + 7919, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// busy(t): whether the station's too loud with a train then (the caller says, from the schedule).
export function announcementAt(k, busy) {
  let at = ANNOUNCE.first + ANNOUNCE.every * k + ANNOUNCE.jitter * (hash(k) - 0.5);
  for (let guard = 0; guard < 40 && busy && (busy(at) || busy(at + ANNOUNCE.dur)); guard++) at += 2;
  return at;
}
// The announcements that start in (t0, t1]: their numbers.
export function announcementsBetween(t0, t1, busy) {
  const out = [];
  if (!(t1 > t0)) return out;
  const k0 = Math.max(0, Math.floor((t0 - ANNOUNCE.first) / ANNOUNCE.every) - 2);
  for (let k = k0; k < k0 + 6; k++) {
    const at = announcementAt(k, busy);
    if (at > t0 && at <= t1) out.push(k);
  }
  return out;
}

// ── The museum's music, down the exit stairs ───────────────────────────────────────────────────────────────────
// The jazz plays upstairs; at the foot of the exit stairs you hear it drifting down, muffled, and it fades out a few
// tiles into the hall. gain is music.js's (the gallery plays it at MUSIC_GALLERY), cutoff its low-pass in Hz.
export const STAIRS_MUSIC = { gain: 0.11, reach: 6, near: 1, cutoff: [350, 1400] };
export function stairsMusic(me, exits) {
  let best = null;
  for (const e of exits) { const d = Math.hypot(e.x - me.x, e.z - me.z); if (!best || d < best.d) best = { d, x: e.x }; }
  if (!best) return { gain: 0, cutoff: STAIRS_MUSIC.cutoff[0], pan: 0 };
  const k = clamp01(1 - (best.d - STAIRS_MUSIC.near) / STAIRS_MUSIC.reach);
  return { gain: STAIRS_MUSIC.gain * k * k, cutoff: STAIRS_MUSIC.cutoff[0] + (STAIRS_MUSIC.cutoff[1] - STAIRS_MUSIC.cutoff[0]) * k, pan: clamp((best.x - me.x) / 5, -1, 1) * 0.6 };
}

// ── The turnstile's rotor ──────────────────────────────────────────────────────────────────────────────────────
// What it says as you push it (|push| 0…1): a clunk as it takes your weight, a ratchet click at each third of the
// way, and a clunk as it clicks over.
export function rotorClicks(prev, next) {
  const a = Math.abs(prev || 0), b = Math.abs(next || 0), out = [];
  if (b <= a) return out;
  if (a < 0.02 && b >= 0.02) out.push('take');
  for (const s of [0.3, 0.6]) if (a < s && b >= s) out.push('tick');
  if (a < 1 && b >= 1) out.push('over');
  return out;
}
