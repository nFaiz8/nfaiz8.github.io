// The passing train (station spec §5). Deterministic in time, so it can be tested and screenshotted: run n
// leaves its tunnel at startOf(n), every 30–40 s, and the tunnel glows for TRAIN.warn seconds before.
export const TRAIN = { speed: 25, cars: 4, car: 6, gap: 0.6, warn: 3, every: 35, jitter: 5, first: 8 };
export const LENGTH = TRAIN.cars * TRAIN.car + (TRAIN.cars - 1) * TRAIN.gap;

function hash(n) {
  let h = Math.imul(n + 1, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export const startOf = (n) => TRAIN.first + TRAIN.every * n + TRAIN.jitter * (hash(n) - 0.5);

export function trainAt(t, map) {
  if (!map.tracks.length) return null;
  const travel = (map.cols + LENGTH + 4) / TRAIN.speed;
  const m = Math.floor((t - TRAIN.first) / TRAIN.every);
  for (let n = Math.max(0, m - 1); n <= m + 1; n++) {
    const start = startOf(n);
    const track = map.tracks[n % map.tracks.length], dir = n % 2 ? -1 : 1;
    if (t >= start - TRAIN.warn && t < start) return { n, phase: 'warn', warn: 1 - (start - t) / TRAIN.warn, track, dir, head: null, tail: null };
    if (t >= start && t < start + travel) {
      const d = (t - start) * TRAIN.speed;
      const head = dir > 0 ? -2 + d : map.cols + 2 - d;
      return { n, phase: 'pass', warn: 0, track, dir, head, tail: head - dir * LENGTH };
    }
  }
  return null;
}

// The departures board over the stairs: the next two trains, counting down in whole minutes, then `<1 MIN`. From
// SERVICE seconds before a train until it has gone, it warns instead (none of them stop here). Pure, so the board
// only redraws when this text changes.
export const SERVICE = 5;
export const minutes = (s) => (s < 30 ? '<1 MIN' : `${Math.max(1, Math.round(s / 60))} MIN`);
const row = (label, right, w = 20) => label + ' '.repeat(Math.max(1, w - label.length - right.length)) + right;
export function departures(t, map, blink = true) {
  const travel = (map.cols + LENGTH + 4) / TRAIN.speed;
  let n = Math.max(0, Math.floor((t - TRAIN.first) / TRAIN.every) - 1);
  while (startOf(n) + travel <= t) n++;
  const start = startOf(n);
  if (t >= start - SERVICE) {
    const on = !blink || Math.floor(t * 2) % 2 === 0;
    return { warn: true, lines: [row(' NOT IN SERVICE', ''), on ? row('   STAND BACK', '') : row('', '')] };
  }
  return { warn: false, lines: [row('NEXT TRAIN', minutes(start - t)), row('THEN', minutes(startOf(n + 1) - t))] };
}

// The shared clock (station spec, Multiplayer): every player's station time is the same moment of one schedule,
// the server's clock in ms (or this machine's) in seconds, modulo PERIOD: 2400 runs, about 23 hours. So everyone
// sees the same train at the same time; at the wrap the schedule starts again from run 0.
export const PERIOD = TRAIN.every * 2400;
export const sharedTime = (epochMs) => { const s = epochMs / 1000; return s - PERIOD * Math.floor(s / PERIOD); };
// The server's clock less mine, from a message stamped `now` by the server that came back rtt ms after I asked:
// it was sent about half the round trip ago.
export const clockOffset = (serverNow, rtt, localNow) => serverNow + (rtt || 0) / 2 - localNow;
