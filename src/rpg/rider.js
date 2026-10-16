// Where you are (subway ride spec §4): a frame, a station's map or a local's floor plan, and the moves between them.
// The walker's x and z are always in its frame; frameOrigin gives that frame's place on the line. Pure.
//
// The moves happen at door times, not at the doorway, so the floor never shifts under you while you walk: while a train
// stands you walk in the station's frame (its map includes the train, car.js), and you join the train's frame as its
// doors start to close with you inside; you leave it while its doors are open at a station.
import { STOPS } from './line.js';
import { local, localsAt, arrivalAtStop, turnaroundDue, turnaround, LOCAL, DOORS, PERIOD } from './schedule.js';
import { inTrain, trainOrigin, pushIn, seatNear, standFrom } from './car.js';

export const FADE = { out: 0.5, in: 0.5 }; // the turnaround's fade, seconds each way

export const createRider = (stop = 0) => ({ frame: { kind: 'station', stop }, seat: null, fade: 0 });

export function frameOrigin(frame, t) {
  if (frame.kind === 'station') return { x: STOPS[frame.stop].x, z: 0 };
  return trainOrigin(local(frame.k, t));
}
export function toWorld(rider, w, t) {
  const o = frameOrigin(rider.frame, t);
  return { x: o.x + w.x, z: o.z + w.z };
}
// Move the walker (and a seat) from one frame to another without moving it in the world.
function reframe(rider, w, frame, t) {
  const a = frameOrigin(rider.frame, t), b = frameOrigin(frame, t);
  w.x += a.x - b.x; w.z += a.z - b.z;
  rider.frame = frame;
}

// Seconds since local k stopped at stop (negative before; it's standing while 0 … dwell).
const sinceStop = (k, stop, t) => t - arrivalAtStop(k, stop);
const closing = (s) => s >= DOORS.close[0] && s < LOCAL.dwell + 1; // from the chime until just after it leaves

// The shared clock wraps every PERIOD seconds, a whole number of locals: across the wrap the same train has a number
// PERIOD / every lower (or higher, going back), so a rider keeps their train.
const WRAP = PERIOD / LOCAL.every;
function unwrap(rider, t) {
  const jump = rider.t == null ? 0 : t - rider.t, shift = jump < -PERIOD / 2 ? -WRAP : jump > PERIOD / 2 ? WRAP : 0;
  rider.t = t;
  if (!shift) return;
  if (rider.frame.kind === 'train') rider.frame = { kind: 'train', k: rider.frame.k + shift };
  if (rider.seat) rider.seat = { ...rider.seat, k: rider.seat.k + shift };
}

export function stepRider(rider, w, t) {
  unwrap(rider, t);
  const f = rider.frame;
  if (f.kind === 'station') {
    for (const tr of localsAt(t)) {
      if (!closing(sinceStop(tr.k, f.stop, t))) continue;
      const p = inTrain(local(tr.k, arrivalAtStop(tr.k, f.stop)), STOPS[f.stop].x, w.x, w.z); // where it stood
      if (!p) continue;
      reframe(rider, w, { kind: 'train', k: tr.k }, t);
      const q = pushIn({ x: w.x, z: w.z });
      w.x = q.x; w.z = q.z;
      return 'board';
    }
    return null;
  }
  const k = f.k;
  if (turnaroundDue(k, t)) {
    rider.frame = { kind: 'train', k: turnaround(k, t) }; // the same spot in the train coming back
    rider.fade = FADE.out + FADE.in;
    return 'turn';
  }
  for (const stop of [0, 1]) {
    const s = sinceStop(k, stop, t);
    // Any time its doors are open, not only as they start to: a slow frame then mustn't carry you past your stop. (You
    // walk a standing train in the station's frame anyway; its doors closing round you put you back in its own.)
    if (s >= DOORS.open[0] && s < DOORS.close[0]) { reframe(rider, w, { kind: 'station', stop }, t); return 'alight'; }
  }
  return null;
}

// Sitting (§4): the nearest free seat within reach, in the train's frame. A seat is kept in the train's frame (so it
// stays put if you alight while seated); the walker is put on it.
export function sit(rider, w, taken = new Set(), t = 0) {
  const o = frameOrigin(rider.frame, t), k = rider.frame.kind === 'train' ? rider.frame.k : standingK(rider, w, t);
  if (k == null) return null;
  const to = trainOrigin(local(k, t)), lx = w.x + o.x - to.x, lz = w.z + o.z - to.z;
  const s = seatNear(lx, lz, taken);
  if (!s) return null;
  rider.seat = { ...s, k };
  w.x = to.x + s.x - o.x; w.z = to.z + s.z - o.z; w.vx = w.vz = 0;
  return s;
}
function standingK(rider, w, t) {
  const stop = rider.frame.stop;
  for (const tr of localsAt(t)) if (tr.at === stop && inTrain(tr, STOPS[stop].x, w.x, w.z)) return tr.k;
  return null;
}
export function stand(rider, w, t = 0) {
  if (!rider.seat) return;
  const s = rider.seat, o = frameOrigin(rider.frame, t), to = trainOrigin(local(s.k, t)), p = standFrom(s);
  w.x = to.x + p.x - o.x; w.z = to.z + p.z - o.z;
  rider.seat = null;
}
