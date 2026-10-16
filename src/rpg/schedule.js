// The trains (subway ride spec §2). Everything here is a pure function of the shared clock, so every player sees the
// same trains in the same places, and tests can ask about any moment.
import { STOPS, LINE, TRACKS, STRETCHES } from './line.js';

export const TRAIN = { cars: 5, car: 15, gap: 0.75, width: 3, cruise: 20, bridge: 10, express: 25 };
export const LENGTH = TRAIN.cars * TRAIN.car + (TRAIN.cars - 1) * TRAIN.gap; // 78
// A local arrives at MUSEUM every LOCAL.every seconds, eastbound and westbound in turn.
export const LOCAL = { first: 20, every: 60, dwell: 18, brake: 6 };
export const EXPRESS = { first: 5, every: 30 };
// Doors, in seconds after the train stops: opening, then closing (the chime as they start to close).
export const DOORS = { open: [1, 2], close: [15, 17] };
// The shared clock wraps every PERIOD seconds (a day): whole cycles of the locals (two directions) and expresses, so
// the wrap is seamless.
export const PERIOD = 86400;

// The ride between the stations: [seconds, from speed, to speed]. Speed up, cruise, slow for the bridge, cross it,
// speed up, cruise, brake. 57 s and 780 tiles.
const LEGS = [[6, 0, 20], [9, 20, 20], [3, 20, 10], [21, 10, 10], [3, 10, 20], [9, 20, 20], [6, 20, 0]];
export const RIDE = LEGS.reduce((a, l) => a + l[0], 0);
export const DIST = LEGS.reduce((a, [T, v0, v1]) => a + (T * (v0 + v1)) / 2, 0);
export const LEG_TIME = LOCAL.dwell + RIDE; // 75: from arriving at one station to arriving at the other

// A change of speed from v0 to v1 over T seconds, eased (smoothstep), tau seconds in: distance, speed, acceleration.
const ease = (u) => u * u * (3 - 2 * u);
function change(T, v0, v1, tau) {
  const u = Math.min(1, Math.max(0, tau / T));
  return { s: T * (v0 * u + (v1 - v0) * (u ** 3 - u ** 4 / 2)), v: v0 + (v1 - v0) * ease(u), a: ((v1 - v0) / T) * 6 * u * (1 - u) };
}
function rideAt(tau) {
  let s = 0;
  for (const [T, v0, v1] of LEGS) {
    if (tau <= T) { const r = change(T, v0, v1, tau); return { s: s + r.s, v: r.v, a: r.a }; }
    s += (T * (v0 + v1)) / 2;
    tau -= T;
  }
  return { s, v: 0, a: 0 };
}
// Where a local is, tau seconds after it arrives at its first stop: s along its way from there (negative before it),
// its speed and its acceleration along its way.
export function localMotion(tau) {
  const V = TRAIN.cruise, B = LOCAL.brake, D = LOCAL.dwell;
  const before = -(V * B) / 2; // where braking starts
  if (tau < -B) return { s: before + V * (tau + B), v: V, a: 0 };
  if (tau < 0) { const r = change(B, V, 0, tau + B); return { s: before + r.s, v: r.v, a: r.a }; }
  if (tau < D) return { s: 0, v: 0, a: 0 };
  if (tau < LEG_TIME) return rideAt(tau - D);
  const t2 = tau - LEG_TIME;
  if (t2 < D) return { s: DIST, v: 0, a: 0 };
  if (t2 < D + B) { const r = change(B, 0, V, t2 - D); return { s: DIST + r.s, v: r.v, a: r.a }; }
  return { s: DIST + (V * B) / 2 + V * (t2 - D - B), v: V, a: 0 };
}
// Doors 0 (shut) … 1 (open), tau seconds after stopping.
export function doorsAt(tau) {
  const [o0, o1] = DOORS.open, [c0, c1] = DOORS.close;
  if (tau < o0 || tau >= c1) return 0;
  if (tau < o1) return (tau - o0) / (o1 - o0);
  if (tau < c0) return 1;
  return 1 - (tau - c0) / (c1 - c0);
}

// Where a standing train's front is: its middle at the platform's middle.
const stopHead = (stop, dir) => STOPS[stop].centre + (dir * LENGTH) / 2;

// Local k arrives at MUSEUM at LOCAL.first + k × every: eastbound for even k (MUSEUM is its first stop), westbound for
// odd k (it left CANAL ST a LEG_TIME before).
export const arrivalAt = (k) => LOCAL.first + LOCAL.every * k;
export function arrivalAtStop(k, stop) {
  const east = k % 2 === 0;
  return arrivalAt(k) + (stop === 0 ? 0 : east ? LEG_TIME : -LEG_TIME);
}
export const lastStopOf = (k) => (k % 2 === 0 ? 1 : 0);

export function local(k, t) {
  const dir = k % 2 === 0 ? 1 : -1, track = dir > 0 ? TRACKS[0] : TRACKS[1];
  const first = dir > 0 ? 0 : 1;
  const t0 = arrivalAtStop(k, first), tau = t - t0, m = localMotion(tau);
  const head = stopHead(first, dir) + dir * m.s;
  let at = null, doors = 0;
  if (tau >= 0 && tau < LOCAL.dwell) { at = first; doors = doorsAt(tau); }
  else if (tau >= LEG_TIME && tau < LEG_TIME + LOCAL.dwell) { at = 1 - first; doors = doorsAt(tau - LEG_TIME); }
  return {
    id: `L${k}`, k, kind: 'local', track, dir, head, tail: head - dir * LENGTH, speed: m.v, accel: dir * m.a, at, doors, tau,
    to: STOPS[1 - first].name, last: tau >= LEG_TIME - LOCAL.brake,
  };
}
const onLine = (tr) => Math.max(tr.head, tr.tail) > LINE.x0 && Math.min(tr.head, tr.tail) < LINE.x1;

// The locals on the line at time t (a local lives about 170 s on it, so six numbers cover every one).
export function localsAt(t) {
  const out = [], kc = Math.floor((t - LOCAL.first) / LOCAL.every);
  for (let k = kc - 3; k <= kc + 2; k++) { const tr = local(k, t); if (onLine(tr)) out.push(tr); }
  return out;
}

// Express slot m passes MUSEUM's platform middle at EXPRESS.first + m × every, at TRAIN.express, never stopping. In each
// stretch it takes its own track (north for even m, south for odd) if no local is in that stretch on that track while it
// would be, else the other one, else it doesn't run there. clip is the stretch it's drawn in.
const MARGIN = 2; // seconds of clear track before and after
const choice = new Map(); // `${m}.${s}` → the track's index, or −1 (pure: the same answer every time, only cached)
function expressTrack(m, s) {
  const key = `${m}.${s}`;
  if (choice.has(key)) return choice.get(key);
  const [a, b] = STRETCHES[s], c = EXPRESS.first + EXPRESS.every * m;
  const pick = [TRACKS[m % 2 === 0 ? 0 : 1], TRACKS[m % 2 === 0 ? 1 : 0]].find((track) => {
    // The times its body is in [a, b).
    const base = STOPS[0].centre + track.dir * (LENGTH / 2);
    const enter = track.dir > 0 ? (a - base) / TRAIN.express : (base - b) / TRAIN.express;
    const leave = enter + (b - a + LENGTH) / TRAIN.express;
    for (let t = c + enter - MARGIN; t <= c + leave + MARGIN; t += 0.5) {
      for (const l of localsAt(t)) if (l.track === track && Math.max(l.head, l.tail) > a && Math.min(l.head, l.tail) < b) return false;
    }
    return true;
  });
  const i = pick ? pick.i : -1;
  if (choice.size > 4000) choice.clear();
  choice.set(key, i);
  return i;
}
const xHead = (m, track, t) => STOPS[0].centre + track.dir * (LENGTH / 2 + TRAIN.express * (t - (EXPRESS.first + EXPRESS.every * m)));
export function expressesAt(t) {
  const out = [], mc = Math.floor((t - EXPRESS.first) / EXPRESS.every);
  for (let m = mc - 4; m <= mc + 4; m++) {
    for (let s = 0; s < STRETCHES.length; s++) {
      const i = expressTrack(m, s);
      if (i < 0) continue;
      const track = TRACKS[i], head = xHead(m, track, t), tail = head - track.dir * LENGTH, [a, b] = STRETCHES[s];
      if (Math.max(head, tail) <= a || Math.min(head, tail) >= b) continue;
      out.push({ id: `X${m}.${s}`, m, kind: 'express', track, dir: track.dir, head, tail, speed: TRAIN.express, accel: 0, at: null, doors: 0, clip: [a, b] });
    }
  }
  return out;
}
export const trainsAt = (t) => [...localsAt(t), ...expressesAt(t)];

// The departures board (§2): the next two locals at stop by arrival, counting down; one standing says NOW, one ending
// its trip here LAST STOP. From SERVICE seconds before an express reaches the station until it's gone, the express
// warning instead. Pure, so the board only redraws when its text changes.
export const SERVICE = 5;
export const minutes = (s) => (s < 30 ? '<1 MIN' : `${Math.max(1, Math.round(s / 60))} MIN`);
const row = (label, right, w = 20) => label + ' '.repeat(Math.max(1, w - label.length - right.length)) + right;
export function departures(t, stop, blink = true) {
  const s = STOPS[stop], reach = SERVICE * TRAIN.express;
  const express = expressesAt(t).some((x) => Math.max(x.head, x.tail) > Math.max(s.x - reach, x.clip[0]) && Math.min(x.head, x.tail) < Math.min(s.x + s.cols + reach, x.clip[1]));
  if (express) {
    const on = !blink || Math.floor(t * 2) % 2 === 0;
    return { warn: true, lines: [row(' EXPRESS TRAIN', ''), on ? row('   STAND BACK', '') : row('', '')] };
  }
  const kc = Math.floor((t - LOCAL.first) / LOCAL.every), next = [];
  for (let k = kc - 3; k <= kc + 6; k++) { const at = arrivalAtStop(k, stop); if (at + LOCAL.dwell > t) next.push({ k, at }); }
  next.sort((a, b) => a.at - b.at);
  return { warn: false, lines: next.slice(0, 2).map(({ k, at }) => row(lastStopOf(k) === stop ? 'LAST STOP' : `TO ${STOPS[1 - stop].name}`, at <= t ? 'NOW' : minutes(at - t))) };
}

// Past the last stop (§4): a rider still aboard TURN.after seconds after it left comes back aboard the next local the
// other way into that same station, wherever it is on its way in.
export const TURN = { after: 8 };
export const turnaroundDue = (k, t) => t - arrivalAtStop(k, lastStopOf(k)) >= LOCAL.dwell + TURN.after;
export function turnaround(k, t) {
  const stop = lastStopOf(k);
  let j = k + 1;
  while (j % 2 === k % 2 || arrivalAtStop(j, stop) < t) j++;
  return j;
}

// The trains as the station's life and look knew them (one train, in the station's own coordinates): the first one in
// the station at stop, else the one about to come out of a tunnel (phase 'warn', for the WARN seconds before). track is
// the station map's own track object, so life.js and scene.js can compare it with theirs.
export const WARN = 3;
export function passFor(trains, stop, map) {
  const s = STOPS[stop];
  let best = null;
  for (const tr of trains) {
    if (tr.clip && (Math.max(tr.head, tr.tail) <= tr.clip[0] || Math.min(tr.head, tr.tail) >= tr.clip[1])) continue;
    const lo = Math.min(tr.head, tr.tail) - s.x, hi = Math.max(tr.head, tr.tail) - s.x;
    const track = map.tracks[tr.track.i];
    if (hi > -2 && lo < s.cols + 2) return { phase: 'pass', warn: 0, head: tr.head - s.x, tail: tr.tail - s.x, track, dir: tr.dir, n: tr.id, speed: tr.speed };
    const gap = tr.dir > 0 ? -hi : lo - s.cols; // the nose's distance from the mouth it's heading for
    if (gap > 0 && tr.speed > 0 && gap / tr.speed < WARN) {
      const w = 1 - gap / tr.speed / WARN;
      if (!best || w > best.warn) best = { phase: 'warn', warn: w, head: null, tail: null, track, dir: tr.dir, n: tr.id, speed: tr.speed };
    }
  }
  return best;
}
