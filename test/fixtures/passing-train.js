// The station's first train, kept for tests (subway ride plan, Task 15): one passing train in a station's own
// coordinates, the shape life.js's pigeons, rats and commuters react to. The game now gives them that shape from the
// schedule (schedule.js passFor); this keeps their tests independent of it.
// The passing train (station spec §5), as it was. Deterministic in time, so it can be tested and screenshotted: run n
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
