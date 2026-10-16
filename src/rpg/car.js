// The train's inside (subway ride spec §4): one walkable floor plan for the whole train, in the train's own frame, and
// boarding one standing at a station. Pure: no three.js.
//
// The frame: x along the train from its west end (0 … LENGTH), z across it from the track's middle (−1.5 … 1.5, south
// positive). It's world-aligned (x east, z south) whichever way the train runs, and every car is the same both ways
// round, so the walker steps in it exactly as on a station's map.
import { TRAIN, LENGTH } from './schedule.js';
import { LEVEL } from './map.js';
import { blocked, RADIUS } from './move.js';

export const CAR = {
  half: 1.5, // the car's outside, from the middle
  wall: 1.35, // the inside of its side walls
  bench: 0.95, // the benches' front edge
  doors: [2.5, 7.5, 12.5], // door middles along each car
  door: 0.65, // half a door's width
  end: 0.15, // an end wall's thickness
  pass: 0.45, // half the end doors' and gangways' width
  pole: 0.06,
  seat: 0.55, // between two seats on a bench
};
export const PITCH = TRAIN.car + TRAIN.gap; // a car and the gangway behind it
export const GRAIN = 0.25;

// Which car x is in, and how far along it (0 … car; more than car is the gangway east of it).
export const carAt = (x) => { const c = Math.min(TRAIN.cars - 1, Math.max(0, Math.floor(x / PITCH))); return { c, u: x - c * PITCH }; };
const nearDoor = (u, pad = 0) => CAR.doors.some((d) => Math.abs(u - d) < CAR.door + pad);

// Is (x, z) solid in the train? open: which side's doors are open (+1 south, −1 north, 0 none).
export function trainSolid(x, z, open = 0) {
  if (x <= 0 || x >= LENGTH || Math.abs(z) >= CAR.half) return true;
  const { c, u } = carAt(x);
  if (u > TRAIN.car) return Math.abs(z) >= CAR.pass; // the gangway
  if (u < CAR.end) return c === 0 || Math.abs(z) >= CAR.pass; // the west end: a cab, or an end door
  if (u > TRAIN.car - CAR.end) return c === TRAIN.cars - 1 || Math.abs(z) >= CAR.pass;
  if (Math.abs(z) > CAR.wall) return !(open && Math.sign(z) === open && nearDoor(u));
  if (Math.abs(z) > CAR.bench) return !nearDoor(u, 0.2) && u > 0.5 && u < TRAIN.car - 0.5; // benches between the doors
  return false;
}

// The train as a map the walker can step on.
export function trainMap(open = 0) {
  return { grain: GRAIN, cols: LENGTH, rows: 2 * CAR.half, solidAt: (x, z) => trainSolid(x, z, open), levelAt: () => LEVEL.platform };
}

// The poles: one in the middle of each doorway. They're too thin for the grid, so they push you aside instead.
export const POLES = Array.from({ length: TRAIN.cars }, (_, c) => CAR.doors.map((d) => ({ x: c * PITCH + d, z: 0 }))).flat();
export function offPoles(w, map) {
  for (const p of POLES) {
    let dx = w.x - p.x, dz = w.z - p.z;
    const d = Math.hypot(dx, dz), min = RADIUS + CAR.pole;
    if (d >= min) continue;
    if (d < 1e-6) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    const nx = p.x + dx * min, nz = p.z + dz * min;
    if (!blocked(map, nx, nz)) { w.x = nx; w.z = nz; }
  }
  return w;
}

// Seats: along both benches, between the doors, facing across the car. side −1 is the north bench (facing south,
// yaw 0), +1 the south one (facing north, yaw π).
export const SEATS = [];
for (let c = 0; c < TRAIN.cars; c++) {
  const [d0, d1, d2] = CAR.doors, gap = CAR.door + 0.2;
  for (const [a, b] of [[0.5, d0 - gap], [d0 + gap, d1 - gap], [d1 + gap, d2 - gap], [d2 + gap, TRAIN.car - 0.5]]) {
    const n = Math.floor((b - a) / CAR.seat), pad = (b - a - n * CAR.seat) / 2;
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      SEATS.push({ i: SEATS.length, car: c, x: c * PITCH + a + pad + CAR.seat * (i + 0.5), z: (side * (CAR.wall + CAR.bench)) / 2, side, yaw: side < 0 ? 0 : Math.PI });
    }
  }
}
export const SIT_REACH = 0.9;
// The free seat nearest (x, z) within reach, or null. taken: a Set of seat numbers.
export function seatNear(x, z, taken = new Set()) {
  let best = null, bd = SIT_REACH;
  for (const s of SEATS) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd && !taken.has(s.i)) { best = s; bd = d; } }
  return best;
}
// Standing up from a seat: just in front of it.
export const standFrom = (s) => ({ x: s.x, z: s.side * (CAR.bench - RADIUS - 0.05) });

// Leaning with the train (§4): speeding up pushes you toward its back, braking toward its front. accel is the train's
// along world x (east positive). It moves you rather than your speed, which the walker's own easing would cancel.
export const LURCH = 0.12;
export function lurch(w, accel, dt, map) {
  const dx = -accel * LURCH * dt;
  if (dx && !blocked(map, w.x + dx, w.z)) w.x += dx;
  return w;
}

// The train's west end and its middle line, in world x and z.
export const trainOrigin = (tr) => ({ x: Math.min(tr.head, tr.tail), z: tr.track.z });
// The side a train opens at a platform: both platforms are between the tracks, so the north track opens its south
// doors and the south track its north ones.
export const platformSide = (track) => (track.i === 0 ? 1 : -1);

// Is (x, z), in the station-map coordinates of a stop at stopX on the line, inside the train tr? Then where in its frame.
export function inTrain(tr, stopX, x, z) {
  const o = trainOrigin(tr), lx = x + stopX - o.x, lz = z - o.z;
  return lx > 0 && lx < LENGTH && Math.abs(lz) < CAR.half ? { x: lx, z: lz } : null;
}

// A station's map with the trains standing at it (§4): inside a standing local's band, the train's floor plan, its
// platform side's doors open once they're fully open. trains: the locals standing at this stop.
export function stationWithTrains(map, stopX, trains) {
  const standing = trains.filter((tr) => tr.kind === 'local');
  return {
    ...map, grain: standing.length ? GRAIN : map.grain || 1,
    solidAt(x, z) {
      for (const tr of standing) { const p = inTrain(tr, stopX, x, z); if (p) return trainSolid(p.x, p.z, tr.doors >= 1 ? platformSide(tr.track) : 0); }
      return map.solidAt(x, z);
    },
    levelAt(x, z) {
      for (const tr of standing) if (inTrain(tr, stopX, x, z)) return LEVEL.platform;
      return map.levelAt(x, z);
    },
  };
}

// Closing doors push you in (§4): from the doorway to just inside the wall.
export function pushIn(p) {
  const lim = CAR.wall - RADIUS - 0.02;
  if (Math.abs(p.z) > lim) p.z = Math.sign(p.z) * lim;
  return p;
}
