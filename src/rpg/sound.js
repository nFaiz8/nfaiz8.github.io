// The station's sound, the parts that are only arithmetic (station spec §8): when a foot comes down, what it lands
// on, how loud the train is and where, when the PA speaks, how loud the museum's music is down the exit stairs, and
// the timing shared with scene.js so a sound and what you see happen together (the faulty tube, the drips). Pure:
// no Web Audio, no three.js, so the tests drive it. audio.js plays it.
import { LEVEL } from './map.js';
import { TRAIN, LENGTH, startOf } from './train.js';

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
// drips every DRIP.period(i) seconds.
export const DRIP = { fall: 0.6, ring: 0.8, period: (i) => 1.3 + i * 0.37 };
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

// ── The train ──────────────────────────────────────────────────────────────────────────────────────────────────
// Its layers: a rumble that builds in its tunnel for BUILD seconds before it comes out (the last TRAIN.warn of them
// while the tunnel glows), the roar, the wheels' screech and the rails' clatter as it passes, the wind behind it,
// and the rumble fading into the other tunnel over FADE seconds. Each 0…1, before the mixer's levels; pan −1…1;
// muffle 0…1, how much of it reaches you through the walls (the hall is behind the platform's walls).
export const TRAIN_SOUND = { build: 7, fade: 4.5, ref: 5 };
export function trainSound(t, map, me) {
  const out = { rumble: 0, roar: 0, screech: 0, wind: 0, pan: 0, muffle: 1, n: -1, phase: null };
  if (!map.tracks.length) return out;
  const travel = (map.cols + LENGTH + 4) / TRAIN.speed;
  const m = Math.floor((t - TRAIN.first) / TRAIN.every);
  const inHall = me.y > (LEVEL.hall + LEVEL.platform) / 2;
  out.muffle = inHall ? 0.35 : 1;
  for (let n = Math.max(0, m - 1); n <= m + 2; n++) {
    const start = startOf(n), end = start + travel;
    const track = map.tracks[n % map.tracks.length], dir = n % 2 ? -1 : 1;
    const from = dir > 0 ? -2 : map.cols + 2, to = dir > 0 ? map.cols + 2 : -2;
    const across = 1 / (1 + ((track.z - me.z) / 7) ** 2); // the far track is quieter
    const atX = (x) => ({ g: 1 / (1 + ((x - me.x) / 18) ** 2) * across, pan: clamp((x - me.x) / 12, -1, 1) * 0.9 });
    if (t >= start - TRAIN_SOUND.build && t < start) { // building in the tunnel
      const k = 1 - (start - t) / TRAIN_SOUND.build, s = atX(from);
      const r = k * k * (0.35 + 0.65 * s.g);
      if (r > out.rumble) Object.assign(out, { rumble: r, pan: s.pan, n, phase: 'coming' });
    } else if (t >= start && t < end) { // passing
      const head = dir > 0 ? -2 + (t - start) * TRAIN.speed : map.cols + 2 - (t - start) * TRAIN.speed;
      const tail = head - dir * LENGTH;
      const lo = Math.min(head, tail), hi = Math.max(head, tail);
      const nx = clamp(me.x, lo, hi), lit = clamp(nx, -2, map.cols + 2); // the nearest bit of it (in the station)
      const d = Math.hypot(lit - me.x, track.z - me.z, track.y + 1.5 - me.y);
      const near = 1 / (1 + (d / TRAIN_SOUND.ref) ** 2);
      const inside = clamp01(Math.min(hi + 2, map.cols + 2 - lo) / 6); // 0 while it's all still in a tunnel
      const behind = dir * (tail - me.x); // how far its tail has gone past you (negative: not yet)
      out.n = n; out.phase = 'pass';
      out.rumble = Math.max(out.rumble, 0.4 + 0.6 * near);
      out.roar = near * inside * (inHall ? 0.45 : 1); // through the walls
      out.screech = near ** 1.5 * inside * (inHall ? 0.3 : 1);
      out.wind = across * Math.max(0.35 * near * inside, behind > 0 ? Math.exp(-behind / 9) : 0);
      out.pan = clamp(((nx + head) / 2 - me.x) / 10, -1, 1) * 0.9;
    } else if (t >= end && t < end + TRAIN_SOUND.fade && out.phase !== 'pass') { // gone into the other tunnel
      const k = 1 - (t - end) / TRAIN_SOUND.fade, s = atX(to);
      const r = 0.6 * k * k * (0.4 + 0.6 * s.g);
      if (r > out.rumble) Object.assign(out, { rumble: r, pan: s.pan, n, phase: 'going', wind: Math.max(out.wind, 0.5 * k * k * across) });
    }
  }
  if (inHall) { out.rumble *= 0.55; out.wind *= 0.4; } // through the walls
  return out;
}

// The clatter: the cars' axles (two bogies of two axles a car) knocking over rail joints every JOINT units. The axles'
// distances back from the nose:
export const JOINT = 12;
export const AXLES = Array.from({ length: TRAIN.cars }, (_, i) => [0.7, 1.5, TRAIN.car - 1.5, TRAIN.car - 0.7].map((o) => o + i * (TRAIN.car + TRAIN.gap))).flat();
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
// Now and then a chime and a muffled announcement. Deterministic in time, as the trains are, and never over a train:
// one that would overlap a train (from its rumble to a little after it's gone) waits until after it.
export const ANNOUNCE = { first: 16, every: 52, jitter: 22, dur: 5.5 };
function hash(n) {
  let h = Math.imul(n + 7919, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function announcementAt(k, map) {
  let at = ANNOUNCE.first + ANNOUNCE.every * k + ANNOUNCE.jitter * (hash(k) - 0.5);
  if (!map?.tracks?.length) return at;
  const travel = (map.cols + LENGTH + 4) / TRAIN.speed;
  for (let guard = 0; guard < 4; guard++) {
    const m = Math.floor((at - TRAIN.first) / TRAIN.every);
    let moved = false;
    for (let n = Math.max(0, m - 1); n <= m + 1; n++) {
      const busyFrom = startOf(n) - TRAIN_SOUND.build, busyTo = startOf(n) + travel + 2;
      if (at < busyTo && at + ANNOUNCE.dur > busyFrom) { at = busyTo; moved = true; }
    }
    if (!moved) break;
  }
  return at;
}
// The announcements that start in (t0, t1]: their numbers.
export function announcementsBetween(t0, t1, map) {
  const out = [];
  if (!(t1 > t0)) return out;
  const k0 = Math.max(0, Math.floor((t0 - ANNOUNCE.first) / ANNOUNCE.every) - 2);
  for (let k = k0; k < k0 + 6; k++) {
    const at = announcementAt(k, map);
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
