# The Subway Ride Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Locals that stop at MUSEUM, a walkable five-car NYC train that rides about a minute through a tunnel
and over a golden-hour bridge to a second station (CANAL ST), with everyone on the server seeing the same
trains and the people on them.

**Architecture:** Everything below ground becomes one line along world x (`line.js`): west tunnel, MUSEUM,
tunnel, bridge, tunnel, CANAL ST, east tunnel. Every train's place, speed and doors are a pure function of the
shared clock (`schedule.js`). You walk in a *frame*: a station's map, or the train's own floor plan
(`car.js`), and `rider.js` moves you between them when doors close and open. The scene is built in pieces
(stations, a tunnel that follows the camera, the bridge, a pool of train models), each drawn only when near.

**Tech Stack:** plain JS (ES modules), three.js (already a dependency), Vite, `node:test`, puppeteer e2e,
Cloudflare Worker (`server/`).

**Spec:** `docs/specs/2026-10-16-subway-ride-design.md` (read it first; this plan argues from it). The
station spec it builds on is `docs/specs/2026-10-15-station-design.md`; the map format is `src/rpg/MAPS.md`.

## Global Constraints

- Every commit ends with exactly these two trailer lines (after a blank line), and no other co-author line:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0184mzXTtUSdSwt88YBNAFoz
  ```
  (A different session uses its own `Claude-Session` link.)
- Stage per file (`git add <paths>`), never `git add -A`.
- Work on the branch you were given; never push to `main` without Faiz saying "push". A push to `main`
  deploys the site, and this feature changes `server/`, so it deploys the Worker too.
- Run only the tests for what changed: `node --test test/<file>.test.js`; e2e only for visual or networked
  changes (`E2E_ANGLE=swiftshader` on Linux). Known failures on `main` are listed in `docs/HANDOFF.md`;
  they are not regressions.
- Write like the surrounding code: comments explain why, in plain sentences; British spelling as the code
  uses it (colour, centre); no new dependencies.
- Station 2's name is the constant `'CANAL ST'` (in `line.js` and `canalst.txt` only).
- Pure modules (`line.js`, `schedule.js`, `car.js`, `rider.js`, `decor.js`, `map.js`, `check.js`,
  `move.js`, `camera.js`, `rig.js`, `life.js`, `sound.js`, `peers3d.js`) import no three.js and touch no DOM.
- Performance budget (spec §9): 60 fps on an ordinary laptop; the e2e measures frame time.

## Review Focus

1. **A rider when the tab is hidden and comes back.** The loop pauses while hidden; on return the clock has
   jumped, and the rider's train may have stopped, left, or turned round. Expected: you're still aboard the
   right train in the right place (or, past the last stop, on the turnaround train); never inside a wall or
   on the track. Pinned in Task 4 (`rider: a long gap…`).
2. **Standing in the doorway when the doors close, or arriving with your seat taken.** Expected: pushed
   inside, never left on the track or stuck in the wall; sitting at a seat a commuter sits in is refused.
   Pinned in Tasks 3 and 4.
3. **The clock wrapping (`sharedTime` modulo `PERIOD`) mid-ride.** Expected: the train you're in doesn't
   vanish. `PERIOD` is a whole number of local cycles (Task 1) and the rider re-finds its train by number
   near the wrap. Pinned in Task 1 (`PERIOD is whole cycles`) and Task 4.
4. **An old page (sending MUSEUM positions with no `tr`) and a new page in the same area.** Expected: both
   see each other; the server accepts both forms. Pinned in Task 13.
5. **Walking off the east end of the lengthened platform, or into a closed door while the train moves.**
   Expected: walls and shut doors stop you exactly as tiles do now. Pinned in Tasks 2 and 3.

---

## File map

| File | New? | Job |
|---|---|---|
| `src/rpg/line.js` | new | The line's pieces, stops, tracks, express stretches, the truss's shade and the sun. |
| `src/rpg/schedule.js` | new | Locals, expresses, doors, the departures board, the turnaround, `passFor`. |
| `src/rpg/car.js` | new | The train's floor plan, seats, poles, lurch, boarding a standing train. |
| `src/rpg/rider.js` | new | Which frame you're in and the moves between frames; sitting; the turnaround. |
| `src/rpg/decor.js` | new | Each station's props, board, ticker and life homes (what `scene.js` hard-codes today). |
| `src/rpg/canalst.txt` | new | CANAL ST's map. |
| `src/rpg/trainmesh.js` | new | The NYC train model and its pool. |
| `src/rpg/tunnel.js` | new | The tunnels, as a stretch that follows the camera. |
| `src/rpg/bridge.js` | new | The bridge, the skyline, the river, the sky, the sun. |
| `src/rpg/station.txt` | change | MUSEUM's platform runs east to 80 tiles. |
| `src/rpg/map.js`, `check.js`, `MAPS.md` | change | The `x` tile, stations with no `S`/`E`, `--line`. |
| `src/rpg/move.js` | change | Collision on a finer grid (`map.grain`). |
| `src/rpg/camera.js` | change | A camera in any frame (`x0`), a distance that eases (bridge). |
| `src/rpg/rig.js` | change | Sitting and holding a pole. |
| `src/rpg/life.js` | change | Riders aboard each local, seeded by its number. |
| `src/rpg/scene.js` | change | A station built into a group from its decor; tube lights pooled; no train. |
| `src/rpg/sound.js`, `audio.js` | change | Train sound from the schedule; the ride; chimes; brakes. |
| `src/rpg/index.js` | change | The line, frames, pieces, trains, riders, environment. |
| `src/rpg/peers3d.js`, `others.js`, `src/live.js` | change | Positions aboard a train. |
| `src/main.js` | change | Passes photo URLs for the ad cards. |
| `server/rules.js` | change | The line's bounds; the aboard position. |
| `src/rpg/train.js` | change | Keeps only the shared clock (`sharedTime`, `clockOffset`, `PERIOD`). |

Units: one tile is one world unit; the player is 0.5 wide and 1.6 tall. y: hall 0, platform −3, track bed −4.2.

---

### Task 1: The line and the schedule

**Files:**
- Create: `src/rpg/line.js`, `src/rpg/schedule.js`
- Test: `test/station-line.test.js`, `test/station-schedule.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (`line.js`): `STOPS` (`[{ name, x, cols, centre }]`), `PIECES` (`[{ kind: 'tunnel'|'station'|'bridge', x0, x1, stop? }]`),
  `LINE` (`{ x0, x1 }`), `TRACKS` (`[{ i: 0, z: 2.5, dir: 1 }, { i: 1, z: 16.5, dir: -1 }]`), `STRETCHES`,
  `pieceAt(x)`, `TRUSS`, `trussShade(x)` (0…1), `sunAt(x)` (0…1), `lampAt(x)` (0…1).
- Produces (`schedule.js`): `TRAIN` (`{ cars: 5, car: 15, gap: 0.75, width: 3, cruise: 20, bridge: 10, express: 25 }`),
  `LENGTH` (78), `LOCAL`, `EXPRESS`, `DOORS`, `RIDE` (57), `DIST` (780), `LEG_TIME` (75), `PERIOD`,
  `localMotion(tau)`, `doorsAt(tau)`, `arrivalAt(k)`, `arrivalAtStop(k, stop)`, `lastStopOf(k)`,
  `local(k, t)` → train, `localsAt(t)`, `expressesAt(t)`, `trainsAt(t)`, `SERVICE`, `minutes(s)`,
  `departures(t, stop, blink)` → `{ warn, lines }`, `TURN`, `turnaroundDue(k, t)`, `turnaround(k, t)` → k,
  `WARN`, `passFor(trains, stop, map)`.
- A **train** is `{ id, k?, m?, kind: 'local'|'express', track, dir, head, tail, speed, accel, at, doors, tau?, to?, last?, clip? }`:
  `head` is its front's world x, `tail = head − dir·LENGTH`, `at` the stop index it stands at (or null),
  `doors` 0…1, `accel` along world x, `clip` (expresses) the stretch it's drawn in.

- [ ] **Step 1: Write the failing tests**

`test/station-line.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, LINE, STOPS, TRACKS, STRETCHES, pieceAt, trussShade, sunAt, lampAt, TRUSS } from '../src/rpg/line.js';

test('the pieces join end to end, from the west tunnel to the east one, and the stations are the stops', () => {
  for (let i = 1; i < PIECES.length; i++) assert.equal(PIECES[i].x0, PIECES[i - 1].x1, `piece ${i} starts where ${i - 1} ends`);
  assert.deepEqual([LINE.x0, LINE.x1], [PIECES[0].x0, PIECES.at(-1).x1]);
  assert.deepEqual(PIECES.map((p) => p.kind), ['tunnel', 'station', 'tunnel', 'bridge', 'tunnel', 'station', 'tunnel']);
  for (const p of PIECES.filter((p) => p.kind === 'station')) {
    const s = STOPS[p.stop];
    assert.deepEqual([p.x0, p.x1], [s.x, s.x + s.cols]);
    assert.ok(s.centre > s.x && s.centre < s.x + s.cols);
  }
  assert.equal(STOPS[0].x, 0, "MUSEUM's map coordinates are line coordinates");
  assert.deepEqual(STOPS.map((s) => s.name), ['MUSEUM', 'CANAL ST']);
  assert.deepEqual(TRACKS.map((t) => [t.z, t.dir]), [[2.5, 1], [16.5, -1]]);
  assert.equal(STRETCHES[0][0], LINE.x0);
  assert.equal(STRETCHES.at(-1)[1], LINE.x1);
  for (let i = 1; i < STRETCHES.length; i++) assert.equal(STRETCHES[i][0], STRETCHES[i - 1][1]);
});

test('pieceAt finds the piece, and the line ends clamp', () => {
  assert.equal(pieceAt(50).kind, 'station');
  assert.equal(pieceAt(400).kind, 'bridge');
  assert.equal(pieceAt(-5000), PIECES[0]);
  assert.equal(pieceAt(99999), PIECES.at(-1));
});

test('the truss strobes the sun: dark behind each post, dimmer where the braces cross, bright between', () => {
  assert.equal(trussShade(0.1), 0);
  assert.equal(trussShade(TRUSS.bay + 0.1), 0, 'every bay');
  assert.ok(trussShade(TRUSS.bay / 2) < 0.5);
  assert.equal(trussShade(2), 1);
  assert.equal(trussShade(-TRUSS.bay + 2), 1, 'west of 0 too');
});

test('the sun only reaches the bridge, easing in at its ends; tunnel lamps every 12 tiles', () => {
  const b = PIECES.find((p) => p.kind === 'bridge');
  assert.equal(sunAt(b.x0 - 1), 0);
  assert.equal(sunAt((b.x0 + b.x1) / 2), 1);
  assert.ok(sunAt(b.x0 + 5) > 0 && sunAt(b.x0 + 5) < 1);
  assert.equal(sunAt(b.x1 + 1), 0);
  assert.equal(lampAt(12 * 20), 1);
  assert.equal(lampAt(12 * 20 + 6), 0);
});
```

`test/station-schedule.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOPS, PIECES } from '../src/rpg/line.js';
import {
  trainsAt, localsAt, local, localMotion, doorsAt, arrivalAt, arrivalAtStop, lastStopOf, RIDE, DIST, LENGTH, LOCAL, DOORS,
  departures, minutes, turnaround, turnaroundDue, passFor, SERVICE, PERIOD, EXPRESS,
} from '../src/rpg/schedule.js';

const span = (x) => {
  let lo = Math.min(x.head, x.tail), hi = Math.max(x.head, x.tail);
  if (x.clip) { lo = Math.max(lo, x.clip[0]); hi = Math.min(hi, x.clip[1]); }
  return [lo, hi];
};

test('a local arrives at MUSEUM every 60 s, eastbound and westbound in turn, and stands 18 s', () => {
  for (let k = 0; k < 6; k++) {
    const tr = local(k, arrivalAt(k) + 1);
    assert.equal(tr.at, 0, `L${k} stands at MUSEUM`);
    assert.equal(tr.speed, 0);
    assert.equal(tr.dir, k % 2 === 0 ? 1 : -1);
    assert.equal(tr.track.i, k % 2 === 0 ? 0 : 1, 'eastbound on the north track');
    assert.ok(Math.abs((tr.head + tr.tail) / 2 - STOPS[0].centre) < 1e-9, 'its middle at the platform middle');
    assert.equal(local(k, arrivalAt(k) + LOCAL.dwell + 0.5).at, null, 'gone after 18 s');
  }
  assert.equal(arrivalAt(1) - arrivalAt(0), 60);
});

test('the ride: 57 s and 780 tiles from leaving one station to standing at the next', () => {
  assert.equal(RIDE, 57);
  assert.equal(DIST, 780);
  assert.equal(STOPS[1].centre - STOPS[0].centre, DIST, 'the stations are a ride apart');
  const tr = local(0, arrivalAtStop(0, 1) + 1);
  assert.equal(tr.at, 1, 'L0 stands at CANAL ST');
  assert.ok(Math.abs((tr.head + tr.tail) / 2 - STOPS[1].centre) < 1e-6);
  assert.equal(lastStopOf(0), 1);
  assert.equal(lastStopOf(1), 0);
});

test('motion is continuous: no jump in position or speed anywhere in a trip', () => {
  let prev = localMotion(-60);
  for (let tau = -59.99; tau < 160; tau += 0.01) {
    const m = localMotion(tau);
    assert.ok(Math.abs(m.s - prev.s) < 0.25, `position jumps at ${tau}`);
    assert.ok(Math.abs(m.v - prev.v) < 0.1, `speed jumps at ${tau}`);
    prev = m;
  }
});

test('the middle car spends over 20 s on the bridge, both ways', () => {
  const b = PIECES.find((p) => p.kind === 'bridge');
  for (const k of [10, 11]) {
    let on = 0;
    for (let t = arrivalAt(k) - 200; t < arrivalAt(k) + 200; t += 0.1) {
      const tr = local(k, t), mid = (tr.head + tr.tail) / 2;
      if (mid > b.x0 && mid < b.x1) on += 0.1;
    }
    assert.ok(on > 20, `L${k}: ${on.toFixed(1)} s on the bridge`);
  }
});

test('doors: shut, then opening at 1 s, open from 2 s, closing from 15 s, shut at 17 s; only while standing', () => {
  assert.equal(doorsAt(0.5), 0);
  assert.equal(doorsAt(1.5), 0.5);
  assert.equal(doorsAt(DOORS.open[1]), 1);
  assert.equal(doorsAt(14.9), 1);
  assert.equal(doorsAt(16), 0.5);
  assert.equal(doorsAt(17), 0);
  for (let t = 0; t < 600; t += 0.37) for (const tr of localsAt(t)) if (tr.doors > 0) assert.notEqual(tr.at, null);
});

test('never two trains overlapping on one track', () => {
  for (let t = 0; t < 2400; t += 0.25) {
    const all = trainsAt(t);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (all[i].track !== all[j].track) continue;
      const [a0, a1] = span(all[i]), [b0, b1] = span(all[j]);
      assert.ok(!(a0 < b1 && b0 < a1), `${all[i].id} and ${all[j].id} overlap at ${t}`);
    }
  }
});

test('expresses: one through MUSEUM about every 30 s, at 25 tiles/s, never stopping', () => {
  const seen = new Set();
  for (let t = 300; t < 900; t += 0.25) for (const x of trainsAt(t)) {
    if (x.kind !== 'express') continue;
    assert.equal(x.speed, 25);
    assert.equal(x.at, null);
    const [lo, hi] = span(x);
    if (lo < STOPS[0].centre && hi > STOPS[0].centre) seen.add(x.id);
  }
  assert.ok(seen.size >= 18 && seen.size <= 21, `${seen.size} expresses in 600 s`);
  assert.equal(EXPRESS.every, 30);
});

test('the same moment gives the same trains, and PERIOD is whole cycles of both services', () => {
  assert.deepEqual(trainsAt(1234.5), trainsAt(1234.5));
  assert.equal(PERIOD % (2 * LOCAL.every), 0);
  assert.equal(PERIOD % EXPRESS.every, 0);
});

test('the departures board: the next two locals, NOW while one stands, LAST STOP for one ending here', () => {
  assert.equal(minutes(10), '<1 MIN');
  assert.equal(minutes(130), '2 MIN');
  const t = arrivalAt(4) + 3; // L4 (eastbound) stands at MUSEUM
  const d = departures(t, 0, false);
  if (!d.warn) {
    assert.match(d.lines[0], /^TO CANAL ST +NOW$/);
    assert.match(d.lines[1], /^LAST STOP +1 MIN$/, 'L5 ends at MUSEUM');
    assert.equal(d.lines[0].length, d.lines[1].length, 'right-aligned');
  }
  const c = departures(arrivalAtStop(4, 1) + 3, 1, false);
  if (!c.warn) assert.match(c.lines[0], /^LAST STOP +NOW$/);
  // An express coming: the warning, then the board again.
  let warned = false;
  for (let s = 0; s < 120; s += 0.25) if (departures(s, 0, false).warn) { warned = true; assert.match(departures(s, 0, false).lines.join('|'), /EXPRESS.*\|.*STAND BACK/); }
  assert.ok(warned);
  let changes = 0, last = '';
  for (let s = 0; s < 120; s += 0.25) { const k = departures(s, 0).lines.join('|'); if (k !== last) changes++; last = k; }
  assert.ok(changes < 120 * 2.5, `${changes} redraws in two minutes`);
  assert.equal(SERVICE, 5);
});

test('the turnaround: still aboard 8 s after the last stop, you ride back on the next local the other way', () => {
  const k = 0, end = arrivalAtStop(k, 1);
  assert.equal(turnaroundDue(k, end + LOCAL.dwell + 7), false);
  assert.equal(turnaroundDue(k, end + LOCAL.dwell + 8), true);
  const t = end + LOCAL.dwell + 8, j = turnaround(k, t);
  assert.equal(j % 2, 1, 'westbound');
  assert.ok(arrivalAtStop(j, 1) >= t, 'not yet arrived at CANAL ST');
  const k2 = 1, t2 = arrivalAtStop(k2, 0) + LOCAL.dwell + 8, j2 = turnaround(k2, t2);
  assert.equal(j2 % 2, 0, 'eastbound');
  assert.ok(arrivalAtStop(j2, 0) >= t2);
  assert.ok(local(j2, t2).head > -600, 'still on the line, in the west tunnel');
});

test('passFor: the station\'s view of the nearest train, in its own coordinates and on its own track object', () => {
  const map = { tracks: [{ z: 2.5, name: 'north' }, { z: 16.5, name: 'south' }] };
  const t = arrivalAt(0) + 5, p = passFor(trainsAt(t), 0, map);
  assert.equal(p.phase, 'pass');
  assert.equal(p.track, map.tracks[0]);
  assert.equal(p.speed, 0);
  // Some time in the 3 s before a train comes out of a tunnel there's a warning.
  let warned = false;
  for (let s = 0; s < 120; s += 0.1) { const q = passFor(trainsAt(s), 0, map); if (q && q.phase === 'warn') { warned = true; assert.ok(q.warn > 0 && q.warn <= 1); } }
  assert.ok(warned);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/station-line.test.js test/station-schedule.test.js`
Expected: FAIL, `Cannot find module '…/src/rpg/line.js'`.

- [ ] **Step 3: Write `src/rpg/line.js`**

```js
// The line (subway ride spec §1): everything below ground as one world along x, made of pieces end to end. Pure.
// MUSEUM's map starts at x = 0, so its map coordinates are line coordinates; every other piece is east of it.
export const STOPS = [
  { name: 'MUSEUM', x: 0, cols: 101, centre: 60 },
  { name: 'CANAL ST', x: 794, cols: 92, centre: 840 },
];
export const PIECES = [
  { kind: 'tunnel', x0: -600, x1: 0 },
  { kind: 'station', stop: 0, x0: 0, x1: 101 },
  { kind: 'tunnel', x0: 101, x1: 330 },
  { kind: 'bridge', x0: 330, x1: 570 },
  { kind: 'tunnel', x0: 570, x1: 794 },
  { kind: 'station', stop: 1, x0: 794, x1: 886 },
  { kind: 'tunnel', x0: 886, x1: 1486 },
];
export const LINE = { x0: PIECES[0].x0, x1: PIECES.at(-1).x1 };
// The tracks' middles (both stations' maps put their track rows here); eastbound on the north track, westbound on
// the south one.
export const TRACKS = [{ i: 0, z: 2.5, dir: 1 }, { i: 1, z: 16.5, dir: -1 }];
// Where expresses are placed (§2): each stretch decides on its own which track an express takes there, or that it
// doesn't run there, so a local standing at one station doesn't stop expresses everywhere. The joins are mid-tunnel,
// over 100 tiles from any platform, where you can't see one appear.
export const STRETCHES = [[-600, -150], [-150, 215], [215, 682], [682, 1000], [1000, 1486]];

export const pieceAt = (x) => PIECES.find((p) => x >= p.x0 && x < p.x1) || (x < LINE.x0 ? PIECES[0] : PIECES.at(-1));

// The bridge's truss (§5): a post every bay, X braces between. Sunlight through a window is cut by the post in front
// of it and dimmed where the braces cross, so a moving train's light strobes.
export const TRUSS = { bay: 8, post: 0.6, brace: 0.5 };
export function trussShade(x) {
  const u = ((x % TRUSS.bay) + TRUSS.bay) % TRUSS.bay;
  if (u < TRUSS.post) return 0;
  return Math.abs(u - TRUSS.bay / 2) < TRUSS.brace ? 0.35 : 1;
}
// How much sun reaches a window at x: all of it on the bridge, easing in over its first and last EASE tiles.
const EASE = 20;
export function sunAt(x) {
  const b = PIECES.find((p) => p.kind === 'bridge');
  const k = Math.min(x - b.x0, b.x1 - x) / EASE;
  return k <= 0 ? 0 : Math.min(1, k);
}
// Tunnel lamps every LAMP tiles: 1 at a lamp, 0 more than a tile and a half from one (the band of light that sweeps
// through a car underground).
export const LAMP = 12;
export function lampAt(x) {
  const d = Math.abs(x - LAMP * Math.round(x / LAMP));
  return d >= 1.5 ? 0 : 1 - d / 1.5;
}
```

- [ ] **Step 4: Write `src/rpg/schedule.js`**

```js
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
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/station-line.test.js test/station-schedule.test.js`
Expected: PASS (all). If "expresses: … about every 30 s" fails on the count, print `seen.size`; the
prototype gave 20 in 600 s.

- [ ] **Step 6: Commit**

```bash
git add src/rpg/line.js src/rpg/schedule.js test/station-line.test.js test/station-schedule.test.js
git commit -m "Subway ride: the line and the schedule (locals that stop, expresses, doors, the board, the turnaround)"
```
(with the trailer lines.)

---

### Task 2: The maps: MUSEUM lengthened, CANAL ST, and the checker

**Files:**
- Modify: `src/rpg/station.txt` (whole file), `src/rpg/map.js` (`KNOWN`), `src/rpg/check.js`, `src/rpg/MAPS.md`,
  `server/rules.js` (`STATION`), `test/station-check.test.js`, `test/station-map.test.js`
- Create: `src/rpg/canalst.txt`

**Interfaces:**
- Consumes: `STOPS`, `TRACKS` from Task 1.
- Produces: `parseStation(canalText)` works (no `S`, no `E`; `spawn` null, `exits` []); a new solid tile `x`
  (the closed exit's tape); `checkStation(text)` allows a station with no `S` (it then checks reachability from
  its first `!`), and with no `E` when it has no `S`; `checkLine([museumText, canalText])` → errors
  `{ stop, row, col, msg }`; `node src/rpg/check.js --line`.

- [ ] **Step 1: Write the failing tests**

Add to `test/station-check.test.js` (keep its existing tests; its imports gain `checkLine`):

```js
import { checkLine } from '../src/rpg/check.js';
const canal = fs.readFileSync(new URL('../src/rpg/canalst.txt', import.meta.url), 'utf8');
const museum = fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8');

test('CANAL ST checks clean: no S and no E is fine for a station you only reach by train', () => {
  assert.deepEqual(checkStation(canal), []);
});

test('a station with an S still needs an E, and two S are an error', () => {
  assert.match(checkStation('#####\n#S..#\n#####').map((e) => e.msg).join('|'), /no E/);
  assert.match(checkStation('######\n#S.SE#\n######').map((e) => e.msg).join('|'), /at most one S/);
});

test('without an S, everything walkable must be reachable from the platform', () => {
  // Wall the island across at column 30, edges and all: its east half can't be reached from the first '!'.
  const lines = canal.split('\n'); // three header lines, then the grid
  for (let r = 4; r <= 14; r++) lines[r + 3] = lines[r + 3].slice(0, 30) + '#' + lines[r + 3].slice(31);
  assert.ok(checkStation(lines.join('\n')).some((e) => /cannot be reached from the platform/.test(e.msg)));
});

test('the line: both stations as long as STOPS says, their tracks where TRACKS says', () => {
  assert.deepEqual(checkLine([museum, canal]), []);
  const short = museum.split('\n').map((l) => (/^[#=!._|b~n]/.test(l) && !l.startsWith(';') ? l.slice(0, -1) : l)).join('\n');
  assert.ok(checkLine([short, canal]).some((e) => e.stop === 0 && /101/.test(e.msg)));
});
```

Add to `test/station-map.test.js`:

```js
test('the lengthened platform: 80 tiles from col 20 to 99, its middle at the line\'s MUSEUM centre', async () => {
  const { STOPS } = await import('../src/rpg/line.js');
  const map = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
  assert.equal(map.cols, STOPS[0].cols);
  const row = [...Array(map.cols)].map((_, c) => map.at(c, 6).ch).join('');
  assert.equal(row.indexOf('_'), 20);
  assert.equal(row.lastIndexOf('_'), 99);
  assert.equal((20 + 100) / 2, STOPS[0].centre);
});

test('CANAL ST parses: no spawn, no exits, two tracks at MUSEUM\'s z, the tape solid', () => {
  const map = parseStation(fs.readFileSync(new URL('../src/rpg/canalst.txt', import.meta.url), 'utf8'));
  assert.equal(map.name, 'CANAL ST');
  assert.equal(map.spawn, null);
  assert.deepEqual(map.exits, []);
  assert.deepEqual(map.tracks.map((t) => t.z), [2.5, 16.5]);
  const tape = map.cells.find((c) => c.ch === 'x');
  assert.ok(map.solidAt(tape.c + 0.5, tape.r + 0.5));
});
```

(If these files don't already import `fs` and `parseStation`/`checkStation`, add the imports at the top.)

Two existing tests change with the rules and the longer map:
- `test/station-check.test.js`, "exactly one S and at least one E": rename it "at most one S, and an E wherever
  there's an S" and change its first assertion's pattern from `/exactly one S/` to `/at most one S/` (the
  second, `/no E/`, still matches "there is an S but no E").
- `test/station-map.test.js`, "the shipped station": `m.cols` is now `101`, `m.signs.length` `8`, and
  `m.tubes.length` `22` ('sixteen over the platform, six over the hall'); the rest is unchanged.
- `test/station-life.test.js`, "a rat runs into the nearest tunnel…": its rat starts at `x: 34`, which was 14 tiles
  from the east tunnel on the 48-wide map and is now 34 from the west one, too far to make it in 3 s. Start it at
  `x: 87` (14 from the east tunnel again); its assertions stay.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/station-check.test.js test/station-map.test.js`
Expected: FAIL (`canalst.txt` missing; `checkLine` not exported).

- [ ] **Step 3: Replace `src/rpg/station.txt`** with exactly:

```
name: MUSEUM
; The station (station spec §3). One character is one 1 × 1 tile; see src/rpg/MAPS.md.
; Check it with: node src/rpg/check.js src/rpg/station.txt
########n###########n###########n###########n###########n###########n###########n###########n########
=====================================================================================================
=====================================================================================================
=====================================================================================================
####################!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#
##.kkk......########________________________________________________________________________________#
##.kkk......:.>>>>>>________________________________________________________________________________#
##..........t.>>>>>>______b_____b_____b_____b_____b_____b_____b_____b_____b_____b_____b_____b_____b_#
#E..........:.>>>>>>________________________________________________________________________________#
#ES.........t.>>>>>>___|_____|_____|_____|_____|_____|_____|_____|_____|_____|_____|_____|_____|____#
#E..........:.>>>>>>________________________________________________________________________________#
##..........t.>>>>>>______b_____b_____b_____b_____b_____b_____b_____b_____b_____b_____b_____b_____b_#
##......~...:.>>>>>>__________________~______________________________________~______________________#
##..........########________________________________________________________________________________#
####################!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#
=====================================================================================================
=====================================================================================================
=====================================================================================================
#####################################################################################################
```

- [ ] **Step 4: Create `src/rpg/canalst.txt`** with exactly:

```
name: CANAL ST
; Station 2 (subway ride spec §5): an island platform, its way up taped off. See src/rpg/MAPS.md.
; Check it with: node src/rpg/check.js src/rpg/canalst.txt
##############n###################n#######################n###################n#############
============================================================================================
============================================================================================
============================================================================================
######!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!######
######________________________________________________________________________________######
######_______b_______b_______b_______b_______________________b_______b_______b_______b######
######______________________________________#########_________________________________######
######______________________________________<<<<<<..x_________________________________######
######____|_______|_______|_______|_________<<<<<<..x_____|_______|_______|_______|___######
######______________________________________<<<<<<..x_________________________________######
######______________________________________#########_________________________________######
######_______b_______b_______b_______b_______________________b_~_____b_______b_______b######
######________________________________________________________________________________######
######!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!######
============================================================================================
============================================================================================
============================================================================================
############################################################################################
```

(The platform runs cols 6–85, middle 46, which is the line's 794 + 46 = 840. The stairs `<<<<<<` go up eastward
to a landing `..` at the hall's level and the tape `x`.)

- [ ] **Step 5: `src/rpg/map.js`: the tape tile.** Change

```js
export const KNOWN = new Set(['#', 'n', '=', '|', 'b', 't', 'k', ...WALK]);
```
to
```js
export const KNOWN = new Set(['#', 'n', '=', '|', 'b', 't', 'k', 'x', ...WALK]); // x: tape across a closed exit (solid)
```

- [ ] **Step 6: `src/rpg/check.js`: stations with no `S`, and the line.** Replace

```js
  if (spawns.length !== 1) err(spawns[1]?.r ?? 0, spawns[1]?.c ?? 0, `there must be exactly one S (found ${spawns.length})`);
  if (!map.exits.length) err(0, 0, 'there is no E: no way back up to the museum');

  if (spawns.length) {
    const seen = new Set([key(spawns[0])]);
    const queue = [spawns[0]];
```
with
```js
  if (spawns.length > 1) err(spawns[1].r, spawns[1].c, `there can be at most one S (found ${spawns.length})`);
  if (spawns.length && !map.exits.length) err(0, 0, 'there is an S but no E: no way back up to the museum');

  // Everything walkable must be reachable from S, or (a station you only reach by train) from its platform.
  const root = spawns[0] || map.cells.find((cell) => cell.ch === '!');
  if (root) {
    const seen = new Set([key(root)]);
    const queue = [root];
```
and in that block change the message `` `'${cell.ch}' cannot be reached from S` `` to
`` `'${cell.ch}' cannot be reached from ${spawns.length ? 'S' : 'the platform'}` ``.

Then add, after `checkStation`:

```js
// The line (subway ride spec §6): each station checks clean, is as wide as line.js says, and has its track bands where
// the trains run (TRACKS), so a train leaving one station's tunnel lines up with the next. texts: in STOPS order.
export function checkLine(texts) {
  const errors = [];
  texts.forEach((text, stop) => {
    for (const e of checkStation(text)) errors.push({ stop, ...e });
    const map = parseStation(text), want = STOPS[stop];
    if (map.cols !== want.cols) errors.push({ stop, row: 0, col: map.cols, msg: `${map.name} is ${map.cols} wide; line.js says ${want.cols}` });
    const zs = map.tracks.map((t) => t.z).join(', '), wz = TRACKS.map((t) => t.z).join(', ');
    if (zs !== wz) errors.push({ stop, row: 0, col: 0, msg: `${map.name}'s tracks are at z ${zs}; trains run at ${wz}` });
  });
  return errors;
}
```
with `import { STOPS, TRACKS } from './line.js';` at the top, and replace the command-line block with:

```js
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('check.js')) {
  const { readFileSync } = await import('node:fs');
  const files = ['./station.txt', './canalst.txt'].map((f) => new URL(f, import.meta.url));
  const errors = process.argv[2] === '--line'
    ? checkLine(files.map((f) => readFileSync(f, 'utf8')))
    : checkStation(readFileSync(process.argv[2] || files[0], 'utf8'));
  for (const e of errors) console.log(`${e.stop !== undefined ? `${STOPS[e.stop].name}: ` : ''}row ${e.row}, col ${e.col}: ${e.msg}`);
  console.log(errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'}` : 'ok');
  process.exitCode = errors.length ? 1 : 0;
}
```

- [ ] **Step 7: `server/rules.js`: the longer map.** `test/station-peers.test.js` checks `STATION` against the map.
Change `export const STATION = { cols: 48, rows: 19, yMin: -5, yMax: 1 };` to
`export const STATION = { cols: 101, rows: 19, yMin: -5, yMax: 1 };` (Task 13 widens it to the whole line.)

- [ ] **Step 8: `src/rpg/MAPS.md`.** Add a row to the tile table:
`` | `x` | tape across a closed exit | – | no | ``; change "`S` … (exactly one)" to "(at most one; only the station
you come down to has one)" and "`E` … (at least one)" to "(at least one where there's an `S`)"; under "What the
checker wants" change "not exactly one `S`, or no `E`" to "more than one `S`, or an `S` with no `E`" and "can't be
reached from `S`" to "can't be reached from `S` (or, with no `S`, from the platform)"; and add a section:

```md
## The line

The stations are pieces of one line (`src/rpg/line.js`): west tunnel, MUSEUM (`station.txt`), tunnel, bridge,
tunnel, CANAL ST (`canalst.txt`), east tunnel. Each station's map is as wide as `STOPS` says, starts at its `x` on
the line, and has its two track bands on rows 1–3 and 15–17 (the trains' z, `TRACKS`), from edge to edge. Trains
stop with their middle at the platform's middle (`STOPS[].centre`), so a platform is 80 tiles long for the
78-tile train. Both platforms are islands: the north track opens its south doors, the south track its north ones.
Check the whole line with `node src/rpg/check.js --line`.
```

- [ ] **Step 9: Run the tests and the checker**

Run: `node --test test/station-check.test.js test/station-map.test.js test/station-peers.test.js test/station-life.test.js test/station-train.test.js test/station-sound.test.js test/station-gates.test.js && node src/rpg/check.js --line`
Expected: PASS, and `ok`. (`station-train.test.js` still tests the old passing train, which reads `map.cols`; it
keeps passing until Task 15 removes it.)

- [ ] **Step 10: Commit**

```bash
git add src/rpg/station.txt src/rpg/canalst.txt src/rpg/map.js src/rpg/check.js src/rpg/MAPS.md server/rules.js test/station-check.test.js test/station-map.test.js test/station-life.test.js
git commit -m "Subway ride: MUSEUM's platform runs to 80 tiles; CANAL ST's map; the checker knows the line"
```

---

### Task 3: Walking in the train

**Files:**
- Modify: `src/rpg/move.js` (`blocked`)
- Create: `src/rpg/car.js`
- Test: `test/station-move.test.js` (add), `test/station-car.test.js` (new)

**Interfaces:**
- Consumes: `TRAIN`, `LENGTH` (Task 1), `LEVEL` (`map.js`), `blocked`, `RADIUS` (`move.js`).
- Produces: `blocked(map, x, z, r)` honours `map.grain` (default 1); `CAR`, `PITCH` (15.75), `GRAIN` (0.25),
  `carAt(x)` → `{ c, u }`, `trainSolid(x, z, open)`, `trainMap(open)` (a map for `stepWalker`), `POLES`,
  `offPoles(w, map)`, `SEATS` (`[{ i, car, x, z, side, yaw }]`), `SIT_REACH`, `seatNear(x, z, taken)`,
  `standFrom(seat)` → `{ x, z }`, `LURCH`, `lurch(w, accel, dt, map)`, `trainOrigin(tr)` → `{ x, z }`,
  `platformSide(track)` (+1 south / −1 north), `inTrain(tr, stopX, x, z)` → `{ x, z }` or null,
  `stationWithTrains(map, stopX, trains)` (a map), `pushIn(p)`.
- The train frame: x from the train's west end (0…78), z from the track's middle (−1.5…1.5), world-aligned.

- [ ] **Step 1: Write the failing tests**

Add to `test/station-move.test.js`:

```js
test('a finer map: grain 0.25 cells collide at their own size', () => {
  // A single solid quarter-cell at (1.0…1.25, 0…0.25) in an open field.
  const map = { grain: 0.25, solidAt: (x, z) => x > 1 && x < 1.25 && z > 0 && z < 0.25, levelAt: () => 0 };
  assert.equal(blocked(map, 0.8, 0.1), true, 'a 0.25 radius reaches it from 0.8');
  assert.equal(blocked(map, 0.7, 0.1), false);
  assert.equal(blocked(map, 1.1, 0.6), false, 'well clear below it');
});
```
(import `blocked` from `../src/rpg/move.js` if the file doesn't already.)

`test/station-car.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { stepWalker } from '../src/rpg/move.js';
import { local, arrivalAt, LENGTH, LOCAL, DOORS } from '../src/rpg/schedule.js';
import {
  CAR, PITCH, trainSolid, trainMap, SEATS, POLES, offPoles, seatNear, standFrom, lurch, inTrain, stationWithTrains, pushIn, platformSide, trainOrigin,
} from '../src/rpg/car.js';

const museum = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const walker = (x, z) => ({ x, z, y: -3, vx: 0, vz: 0, facing: 1, walked: 0 });
const walk = (w, input, map, secs = 3) => { for (let i = 0; i < secs * 60; i++) stepWalker(w, 1 / 60, input, map); return w; };

test('you can walk the whole train down its middle, through every end door and gangway, and no further', () => {
  const w = walk(walker(2, 0), { x: 1, y: 0 }, trainMap(0), 30);
  assert.ok(w.x > LENGTH - 1 && w.x < LENGTH, `stopped at the far cab, ${w.x}`);
  const back = walk(walker(LENGTH - 2, 0), { x: -1, y: 0 }, trainMap(0), 30);
  assert.ok(back.x < 1 && back.x > 0, `stopped at the near cab, ${back.x}`);
});

test('benches and walls: across the car you stop at the bench between doors, at the wall in a shut doorway', () => {
  const atBench = walk(walker(5, 0), { x: 0, y: 1 }, trainMap(1));
  assert.ok(atBench.z < CAR.bench, `bench: ${atBench.z}`);
  const shut = walk(walker(7.5, 0), { x: 0, y: 1 }, trainMap(0));
  assert.ok(shut.z > CAR.bench && shut.z < CAR.wall, `shut door: ${shut.z}`);
  const open = walk(walker(7.5, 0), { x: 0, y: 1 }, trainMap(1));
  assert.ok(open.z > shut.z + 0.15, `open door: ${open.z}`); // out to the car's edge (the platform's map takes over there)
  const otherSide = walk(walker(7.5, 0), { x: 0, y: -1 }, trainMap(1));
  assert.ok(otherSide.z > -CAR.wall, 'only the open side is open');
});

test('gangways are walkable only down the middle', () => {
  const gap = PITCH - 0.375; // between car 0 and car 1
  assert.equal(trainSolid(gap, 0), false);
  assert.equal(trainSolid(gap, 0.8), true);
});

test('seats: on both benches of every car, facing across; the nearest free one; standing up in front of it', () => {
  assert.ok(SEATS.length >= 100);
  for (const s of SEATS) {
    assert.ok(Math.abs(s.z) > CAR.bench && Math.abs(s.z) < CAR.wall);
    assert.ok(trainSolid(s.x, s.z), 'a seat is on the bench');
    assert.equal(s.yaw, s.side < 0 ? 0 : Math.PI);
  }
  const s = seatNear(5, 0.7);
  assert.ok(s && s.side === 1);
  assert.equal(seatNear(5, 0.7, new Set([s.i]))?.i === s.i, false, 'a taken seat is skipped');
  assert.equal(seatNear(40, 0), null, 'nothing in reach in a doorway');
  const up = standFrom(s);
  assert.equal(trainSolid(up.x, up.z), false);
});

test('poles push you aside', () => {
  const p = POLES[0], w = walker(p.x + 0.05, p.z);
  offPoles(w, trainMap(0));
  assert.ok(Math.hypot(w.x - p.x, w.z - p.z) >= 0.3);
});

test('lurch: speeding up east pushes you west, braking pushes you east, a wall stops it', () => {
  const m = trainMap(0), w = walker(40, 0);
  lurch(w, 3, 1, m);
  assert.ok(w.x < 40);
  const b = walker(40, 0);
  lurch(b, -3, 1, m);
  assert.ok(b.x > 40);
  const cab = walker(0.3, 0);
  lurch(cab, 30, 1, m);
  assert.ok(cab.x >= 0.25, 'not through the cab wall');
});

test('boarding a standing train: through an open door from the platform, but not between doors', () => {
  const tr = local(0, arrivalAt(0) + 5); // eastbound, standing at MUSEUM, doors open
  assert.equal(platformSide(tr.track), 1, 'the north track opens its south doors');
  const map = stationWithTrains(museum, 0, [tr]);
  const o = trainOrigin(tr), door = o.x + 7.5;
  const w = walk(walker(door, 6.5), { x: 0, y: -1 }, map);
  const p = inTrain(tr, 0, w.x, w.z);
  assert.ok(p && p.z < 0, `inside: ${JSON.stringify(p)}`);
  const between = walk(walker(o.x + 5, 6.5), { x: 0, y: -1 }, map);
  assert.equal(inTrain(tr, 0, between.x, between.z), null);
  // Doors not fully open yet: shut.
  const opening = local(0, arrivalAt(0) + 1.5);
  const early = walk(walker(door, 6.5), { x: 0, y: -1 }, stationWithTrains(museum, 0, [opening]));
  assert.equal(inTrain(opening, 0, early.x, early.z), null);
});

test('closing doors push you in from the doorway', () => {
  assert.equal(pushIn({ x: 7.5, z: 1.45 }).z < CAR.wall, true);
  assert.equal(pushIn({ x: 7.5, z: -1.45 }).z > -CAR.wall, true);
  assert.deepEqual(pushIn({ x: 3, z: 0.2 }), { x: 3, z: 0.2 });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/station-move.test.js test/station-car.test.js`
Expected: FAIL (`car.js` missing; the grain test fails because `blocked` uses 1-tile cells).

- [ ] **Step 3: `src/rpg/move.js`: `blocked` on `map.grain`.** Replace the whole `blocked` function and its comment with:

```js
// Does a circle at (x, z) overlap a solid cell or leave the map? Cells are 1 × 1 tiles, or map.grain on a side (a
// train's floor plan is finer than a station's tiles).
export function blocked(map, x, z, r = RADIUS) {
  const g = map.grain || 1;
  for (let row = Math.floor((z - r) / g); row <= Math.floor((z + r) / g); row++) {
    for (let col = Math.floor((x - r) / g); col <= Math.floor((x + r) / g); col++) {
      if (!map.solidAt((col + 0.5) * g, (row + 0.5) * g)) continue;
      const nx = Math.max(col * g, Math.min(x, (col + 1) * g)), nz = Math.max(row * g, Math.min(z, (row + 1) * g));
      if ((x - nx) ** 2 + (z - nz) ** 2 < r * r - 1e-9) return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Create `src/rpg/car.js`**

```js
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
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/station-move.test.js test/station-car.test.js test/station-gates.test.js test/station-life.test.js`
Expected: PASS (gates and life use `blocked` on the station map, grain 1, unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/rpg/move.js src/rpg/car.js test/station-move.test.js test/station-car.test.js
git commit -m "Subway ride: the train's floor plan, seats, poles, lurch, and boarding a standing train"
```

---

### Task 4: Frames: boarding, alighting, sitting, the turnaround

**Files:**
- Create: `src/rpg/rider.js`
- Test: `test/station-rider.test.js`

**Interfaces:**
- Consumes: Task 1 (`local`, `localsAt`, `arrivalAtStop`, `turnaroundDue`, `turnaround`, `LOCAL`, `DOORS`, `LEG_TIME`), Task 3 (`inTrain`,
  `trainOrigin`, `pushIn`, `seatNear`, `standFrom`, `SEATS`), `STOPS` (Task 1).
- Produces:
  - `createRider(stop = 0)` → `{ frame: { kind: 'station', stop } | { kind: 'train', k }, seat: null | seat, fade: 0 }`.
    `stepRider` also keeps `rider.t` (the last time it saw) to renumber your train across the clock's wrap.
  - `frameOrigin(frame, t)` → `{ x, z }`: add it to the walker's position for world coordinates.
  - `toWorld(rider, w, t)` → `{ x, z }`.
  - `stepRider(rider, w, t)` → `null | 'board' | 'alight' | 'turn'`: changes the frame (and converts `w.x`, `w.z`) when
    a standing local's doors start closing around you, when your train's doors start opening at a station, and when the
    turnaround is due.
  - `sit(rider, w, taken)` → seat or null (snaps you to it); `stand(rider, w)`.
  - `FADE` = `{ out: 0.5, in: 0.5 }`.

- [ ] **Step 1: Write the failing tests**

`test/station-rider.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOPS } from '../src/rpg/line.js';
import { local, arrivalAt, arrivalAtStop, LOCAL, DOORS, LEG_TIME, turnaround, PERIOD } from '../src/rpg/schedule.js';
import { trainOrigin, CAR, SEATS, standFrom } from '../src/rpg/car.js';
import { createRider, stepRider, frameOrigin, toWorld, sit, stand } from '../src/rpg/rider.js';

const w = (x, z) => ({ x, z, y: -3, vx: 0, vz: 0, facing: 1, walked: 0 });

test('standing inside a local when its doors start closing, you board it: same place in the world, now its frame', () => {
  const r = createRider(0), t = arrivalAt(0) + DOORS.close[0] + 0.1, tr = local(0, t), o = trainOrigin(tr);
  const me = w(o.x + 7.5, o.z + 0.5); // inside car 0, in station 0's (= the line's) coordinates
  const before = toWorld(r, me, t);
  assert.equal(stepRider(r, me, t), 'board');
  assert.deepEqual(r.frame, { kind: 'train', k: 0 });
  const after = toWorld(r, me, t);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.z - before.z) < 1e-9);
  assert.equal(stepRider(r, me, t + 0.1), null, 'once');
});

test('in the doorway as they close you are pushed in; on the platform you stay', () => {
  const t = arrivalAt(0) + DOORS.close[0] + 0.2, tr = local(0, t), o = trainOrigin(tr);
  const r = createRider(0), door = w(o.x + 7.5, o.z + 1.45);
  stepRider(r, door, t);
  assert.equal(r.frame.kind, 'train');
  assert.ok(door.z < CAR.wall);
  const r2 = createRider(0), plat = w(o.x + 7.5, 6.5);
  assert.equal(stepRider(r2, plat, t), null);
  assert.equal(r2.frame.kind, 'station');
});

test('riding into the other station: when the doors start opening you are in that station\'s frame', () => {
  const r = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 }, me = w(30, -0.5);
  const t = arrivalAtStop(0, 1) + DOORS.open[0] + 0.05;
  const before = toWorld(r, me, t);
  assert.equal(stepRider(r, me, t), 'alight');
  assert.deepEqual(r.frame, { kind: 'station', stop: 1 });
  const after = toWorld(r, me, t);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.z - before.z) < 1e-9);
  assert.ok(me.x > 0 && me.x < STOPS[1].cols, 'in CANAL ST\'s own map coordinates');
});

test('a long gap (a hidden tab): aboard past the last stop, you turn round, never left in a dead train', () => {
  const r = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 }, me = w(30, -0.5);
  const t = arrivalAtStop(0, 1) + LOCAL.dwell + 60; // a minute past leaving CANAL ST
  assert.equal(stepRider(r, me, t), 'turn');
  assert.deepEqual(r.frame, { kind: 'train', k: turnaround(0, t) });
  assert.deepEqual([me.x, me.z], [30, -0.5], 'the same spot');
  // Hidden through your stop: its doors opened and shut while you weren't looking. You're still aboard, and ride on
  // into the tunnel (then turn round).
  const r2 = { frame: { kind: 'train', k: 2 }, seat: null, fade: 0 };
  assert.equal(stepRider(r2, w(30, 0), arrivalAtStop(2, 1) + 17.5), null);
  assert.equal(r2.frame.kind, 'train');
});

test('sitting: snaps you to the nearest free seat, keeps you there through a frame change; standing puts you in front', () => {
  const t0 = arrivalAtStop(0, 0) + 40; // riding
  const r = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 }, s0 = SEATS[9], me = w(s0.x, s0.z - 0.4 * s0.side);
  const s = sit(r, me, new Set(), t0);
  assert.equal(s.i, s0.i);
  assert.ok(Math.abs(me.x - s0.x) < 1e-9 && Math.abs(me.z - s0.z) < 1e-9, 'on the seat');
  const other = { frame: { kind: 'train', k: 0 }, seat: null, fade: 0 };
  assert.notEqual(sit(other, w(s0.x, s0.z - 0.4 * s0.side), new Set([s0.i]), t0)?.i, s0.i, 'a taken seat is refused');
  const t = arrivalAtStop(0, 1) + DOORS.open[0] + 0.05;
  assert.equal(stepRider(r, me, t), 'alight');
  assert.equal(r.seat.i, s0.i, 'still seated after alighting');
  stand(r, me, t);
  assert.equal(r.seat, null);
  const o = frameOrigin({ kind: 'train', k: 0 }, t), sx = frameOrigin(r.frame, t);
  assert.ok(Math.abs(me.x + sx.x - (o.x + s0.x)) < 1e-9, 'in front of the seat');
  assert.ok(Math.abs(me.z + sx.z - (o.z + standFrom(s0).z)) < 1e-9);
});

test('the clock wrapping mid-ride: you keep your train, now numbered a day of locals lower', () => {
  const r = { frame: { kind: 'train', k: 1439 }, seat: null, fade: 0 }, me = w(30, 0);
  const t0 = arrivalAt(1439) - 30; // riding toward MUSEUM, just before the wrap
  stepRider(r, me, t0);
  const before = toWorld(r, me, t0);
  const t1 = t0 + 0.5 - PERIOD; // half a second later, after the wrap
  stepRider(r, me, t1);
  assert.equal(r.frame.k, 1439 - PERIOD / 60);
  const after = toWorld(r, me, t1);
  assert.ok(Math.abs(after.x - before.x) < 20, `moved ${after.x - before.x}`);
});

test('frameOrigin: a station is its x on the line; a train its west end and track middle', () => {
  assert.deepEqual(frameOrigin({ kind: 'station', stop: 1 }, 0), { x: STOPS[1].x, z: 0 });
  const tr = local(3, 500);
  assert.deepEqual(frameOrigin({ kind: 'train', k: 3 }, 500), trainOrigin(tr));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/station-rider.test.js`
Expected: FAIL (`rider.js` missing).

- [ ] **Step 3: Create `src/rpg/rider.js`**

```js
// Where you are (subway ride spec §4): a frame, a station's map or a local's floor plan, and the moves between them.
// The walker's x and z are always in its frame; frameOrigin gives that frame's place on the line. Pure.
//
// The moves happen at door times, not at the doorway, so the floor never shifts under you while you walk: while a train
// stands you walk in the station's frame (its map includes the train, car.js), and you join the train's frame as its
// doors start to close with you inside; you leave it as its doors start to open at a station.
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
    if (s >= DOORS.open[0] && s < DOORS.open[0] + 0.5) { reframe(rider, w, { kind: 'station', stop }, t); return 'alight'; }
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
```

Everything that converts between frames takes the time `t`: a train's frame moves.

- [ ] **Step 4: Run the tests**

Run: `node --test test/station-rider.test.js`
Expected: PASS. If "a long gap" fails on its second half, check that `stepRider` only alights within the first
0.5 s of the doors opening (a rider who was hidden through a whole stop stays aboard and rides on).

- [ ] **Step 5: Commit**

```bash
git add src/rpg/rider.js test/station-rider.test.js
git commit -m "Subway ride: frames: board as the doors close, alight as they open, sit, turn round past the last stop"
```

---

### Task 5: A camera in any frame, and sitting in the rig

**Files:**
- Modify: `src/rpg/camera.js`, `src/rpg/rig.js`
- Test: `test/station-camera.test.js`, `test/station-rig.test.js` (add)

**Interfaces:**
- Produces: `followCamera(cam, t, dt, map, aspect)` clamps to `map.x0 ?? 0 … +map.cols` (a map with `cols: Infinity`
  doesn't clamp x, one with `rows: Infinity` doesn't clamp z); `cam.dist` (default `CAM.dist`) eases toward `cam.want ?? CAM.dist` on a 0.8 s spring;
  `eyeFor(cam)` uses `cam.dist`; `CAM.bridge` (16). `poseFigure(state)` honours `state.sit` (0…1, hips on a seat
  `SEAT_H` = 0.34 over the feet point, a shin's height: the figure's legs are short, so the benches are low) and `state.hold` (the right hand up on a pole).

- [ ] **Step 1: Write the failing tests**

Add to `test/station-camera.test.js`:

```js
test('a camera in a train frame: no clamp along x; the distance eases toward cam.want', () => {
  const free = { cols: Infinity, rows: Infinity }; // a train's frame: no clamp either way
  const cam = createCamera({ x: 500, y: -3, z: 0 });
  followCamera(cam, { x: 500, y: -3, z: 0 }, 1, free, 16 / 9);
  assert.ok(Math.abs(cam.x - 500) < 1e-6);
  cam.want = CAM.bridge;
  for (let i = 0; i < 300; i++) followCamera(cam, { x: 500, y: -3, z: 0 }, 1 / 60, free, 16 / 9);
  assert.ok(Math.abs(cam.dist - CAM.bridge) < 0.1);
  const e = eyeFor(cam);
  assert.ok(e.z - cam.z > Math.cos(CAM.pitch) * CAM.dist, 'further back');
});

test('a station frame with x0: the clamp is shifted', () => {
  const cam = createCamera({ x: 0, y: 0, z: 9 });
  followCamera(cam, { x: 0, y: 0, z: 9 }, 1, { cols: 92, rows: 19, x0: 0 }, 16 / 9);
  assert.equal(cam.x, tilesAcross(16 / 9) / 2);
});
```
(import `CAM`, `createCamera`, `followCamera`, `eyeFor`, `tilesAcross` if the file doesn't.)

Add to `test/station-rig.test.js`:

```js
test('sitting lowers the hips to the seat and puts the feet forward; holding raises the right hand', () => {
  const stood = poseFigure({ yaw: 0 }), sat = poseFigure({ yaw: 0, sit: 1 });
  assert.ok(Math.abs(sat.hip.y - 0.34) < 0.02, `hip ${sat.hip.y}`);
  assert.ok(sat.footL.z > stood.footL.z + 0.2, 'feet forward (yaw 0 faces +z)');
  assert.ok(sat.kneeL.z > sat.hip.z + 0.2 && sat.kneeL.y > 0.25, 'thighs forward, knees up');
  const held = poseFigure({ yaw: 0, hold: 1 });
  assert.ok(held.handR.y > stood.handR.y + 0.5);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/station-camera.test.js test/station-rig.test.js`
Expected: FAIL (`CAM.bridge` undefined; the sit pose isn't there).

- [ ] **Step 3: `src/rpg/camera.js`.** Change `CAM` to
`export const CAM = { pitch: (35 * Math.PI) / 180, dist: 10, lift: 1, spring: 0.15, bridge: 16, zoom: 0.8 };`
In `followCamera`, after the three spring lines, add:

```js
  // The distance eases toward cam.want (further out on the bridge, spec §4), on its own slower spring.
  cam.dist ??= CAM.dist;
  cam.dist += ((cam.want ?? CAM.dist) - cam.dist) * (dt > 0 ? 1 - Math.exp(-dt / CAM.zoom) : 0);
```
and replace the two clamp lines (`cam.x = clamp(…)` and `cam.z = clamp(…)`) with:
```js
  const x0 = map.x0 ?? 0;
  if (Number.isFinite(map.cols)) cam.x = clamp(cam.x, x0 + hw, x0 + map.cols - hw);
  if (Number.isFinite(map.rows)) cam.z = clamp(cam.z, hd * 0.25, map.rows - hd * 0.5);
```
In `eyeFor`, use `cam.dist ?? CAM.dist` in place of `CAM.dist` (both places).

- [ ] **Step 4: `src/rpg/rig.js`.** In `poseFigure`, right after `const hip = set(S.hip, …);` add the sit:

```js
  // Sitting (subway ride spec §4): the hips down onto a seat SEAT_H over the feet point (the bench), the feet forward.
  const sit = clamp(fin(state.sit, 0), 0, 1);
  if (sit) { hip.y = lerp(hip.y, SEAT_H, sit); hip.z = lerp(hip.z, -0.04, sit); }
```
After the two `set(S.fL …)`/`set(S.fR …)` lines and before the `twoBone` calls for the legs, add:

```js
  if (sit) { S.fL.z = lerp(S.fL.z, SEAT_FEET, sit); S.fR.z = lerp(S.fR.z, SEAT_FEET, sit); S.fL.y *= 1 - sit; S.fR.y *= 1 - sit; }
```
And replace the right hand's `set(S.tR, …)` choice with:

```js
  if (state.phone) set(S.tR, sh.x - PHONE[0] * U, sh.y - PHONE[1] * U, sh.z + PHONE[2] * U);
  else if (state.hold) set(S.tR, sh.x - 0.12 * U, sh.y + HOLD * U, sh.z + 0.35 * U); // up on a pole
  else set(S.tR, sh.x - hr(0), sh.y - hr(1), sh.z + hr(2) + sw * HAND_R.swing * U * s);
```
with the constants near `PHONE`:
```js
const SEAT_H = 0.34, SEAT_FEET = 0.3; // sitting: the hips a shin over the feet point, the feet a thigh forward of it
const HOLD = 1.1; // holding a pole: the hand this far over the shoulder, in u
```
(`lerp` already exists in rig.js; if not, add `const lerp = (a, b, k) => a + (b - a) * k;`.) The knee pole is
forward (+z), so with the hips back and the feet forward the knees bend up. If the knee test fails, check that
`twoBone` gets the moved `S.fL`/`S.fR`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/station-camera.test.js test/station-rig.test.js test/figures.test.js`
Expected: PASS (`figures.test.js`'s 2 ms check can fail on a busy machine; HANDOFF lists it).

- [ ] **Step 6: Commit**

```bash
git add src/rpg/camera.js src/rpg/rig.js test/station-camera.test.js test/station-rig.test.js
git commit -m "Subway ride: the camera follows in any frame and pulls back on the bridge; sitting and holding a pole"
```

---

### Task 6: A station built from its decor, lit by a pool of lights, with no train of its own

`scene.js` hard-codes MUSEUM's props, board, ticker, kiosk, vent and newspaper, sets the scene's background and
fog, owns the old passing train, and gives every tube its own point light. This task moves the station-specific
numbers into `decor.js`, builds a station into a `THREE.Group` (so CANAL ST can sit at x = 794), drops the old
train (Task 7 draws the new one), and lights the tubes from a pool of 12 point lights: the lengthened platform
doubles the tubes, and every point light costs every lit pixel.

**Files:**
- Create: `src/rpg/decor.js`
- Modify: `src/rpg/scene.js`, `src/rpg/sprites.js` (a `tape` prop), `src/rpg/index.js` (use the schedule), `src/rpg/life.js` (homes from decor)
- Test: `test/station-decor.test.js` (new)

**Interfaces:**
- Consumes: `departures`, `passFor`, `trainsAt` (Task 1), `STOPS` (Task 1), `parseStation`.
- Produces: `DECOR` (`{ 'MUSEUM': {...}, 'CANAL ST': {...} }`, each `{ stop, exitSign, props, torn, clock, board, ticker, kiosk, vent, news, tape, life }`);
  `buildScene(group, map, { reducedMotion, decor })` → `{ tubes, owned, pigeons, rats, sources, update(time, dt, walker, pass, gates, trainT), shake(time, walker, pass), dispose() }`
  where `walker` is in the station's own coordinates and `pass` is `passFor(…)`'s shape (with `speed`). The scene's
  background, fog and hemisphere light are now the caller's (Task 8 sets them in `index.js`).

- [ ] **Step 1: Write the failing test** `test/station-decor.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { DECOR } from '../src/rpg/decor.js';
import { STOPS } from '../src/rpg/line.js';

const maps = ['station.txt', 'canalst.txt'].map((f) => parseStation(fs.readFileSync(new URL(`../src/rpg/${f}`, import.meta.url), 'utf8')));

test('each station has its decor, keyed by its name, with its stop number', () => {
  for (const [i, map] of maps.entries()) {
    const d = DECOR[map.name];
    assert.ok(d, map.name);
    assert.equal(d.stop, i);
    assert.equal(STOPS[i].name, map.name);
  }
});

test('creatures and commuters start on walkable floor of their own station; props stand inside it', () => {
  for (const map of maps) {
    const d = DECOR[map.name];
    for (const p of [...d.life.pigeons, ...d.life.commuters]) assert.ok(!map.solidAt(p.x, p.z), `${map.name}: ${p.x},${p.z}`);
    for (const r of d.life.rats) assert.ok(r.x > 0 && r.x < map.cols && map.tracks[r.track]);
    for (const [, x, z] of d.props) assert.ok(x > 0 && x < map.cols && z > 0 && z < map.rows, `${map.name} prop at ${x},${z}`);
  }
});

test('MUSEUM keeps its exit sign; CANAL ST has none, and its tape is on the x tile', () => {
  assert.equal(DECOR.MUSEUM.exitSign, '▲ MUSEUM');
  assert.equal(DECOR['CANAL ST'].exitSign, null);
  const tape = DECOR['CANAL ST'].tape, cell = maps[1].at(Math.floor(tape.x), Math.floor(tape.z));
  assert.equal(cell.ch, 'x');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/station-decor.test.js` → FAIL (`decor.js` missing).

- [ ] **Step 3: Create `src/rpg/decor.js`**

```js
// What makes each station itself (subway ride spec §5): its props, clock, departures board, ticker, kiosk, vent,
// newspaper, the tape across a closed exit, and where its creatures and commuters start. scene.js builds any station
// from its map and this. Pure. Coordinates are the station's own map's.
import { STATION_LIFE } from './life.js';

const FAR = 1.03; // the wall face across the north track, facing the platform
export const DECOR = {
  MUSEUM: {
    stop: 0,
    exitSign: '▲ MUSEUM',
    // [prop, x, z, lift]
    props: [
      ['bin', 11.35, 13.72], ['closed', 4.5, 7.03, 1.25], ['map', 8.1, 5.06, 1.15], ['vending', 11.05, 5.15],
      ['bin', 23.5, 10.1], ['bin', 35.5, 10.1], ['bin', 59.5, 10.1], ['bin', 83.5, 10.1],
      ['nowShowing', 24.6, FAR, 1.15], ['gap', 38.5, FAR, 1.75], ['nowShowing', 62.6, FAR, 1.15], ['gap', 76.5, FAR, 1.75], ['nowShowing', 92.6, FAR, 1.15],
    ],
    torn: { x: 28.4, z: FAR, lift: 1.45 },
    clock: { x: 12.5, y: 2.5, z: 6.02 },
    board: { x: 15.7, y: 2.0, z: 6.02 },
    ticker: { x: 26.5, z: 9.5, w: 4.6, text: '   PLEASE STAND BEHIND THE YELLOW LINE  ·  STAND CLEAR OF THE CLOSING DOORS  ·  EXPRESS TRAINS DO NOT STOP AT THIS STATION  ·  MIND THE GAP  ·  faiz.pics: NOW SHOWING UPSTAIRS  ·  KEEP YOUR BELONGINGS WITH YOU  ·' },
    kiosk: { x: 4.5 },
    vent: { x: 6.5, z: 12.2 },
    news: { x: 30.5, z: 12.4, range: [21, 99] },
    tape: null,
    life: STATION_LIFE,
  },
  'CANAL ST': {
    stop: 1,
    exitSign: null,
    props: [
      ['bin', 15.5, 10.1], ['bin', 63.5, 10.1], ['bin', 79.5, 10.1],
      ['nowShowing', 20.6, FAR, 1.15], ['gap', 58.5, FAR, 1.75], ['nowShowing', 74.6, FAR, 1.15],
    ],
    torn: null,
    clock: null,
    board: { x: 48.5, y: -0.7, z: 12.02 }, // on the closed stairs' south wall, over the platform
    ticker: { x: 22, z: 9.5, w: 4.6, text: '   THIS IS CANAL ST  ·  STREET EXIT CLOSED: OPENING SOON  ·  STAND CLEAR OF THE CLOSING DOORS  ·  MIND THE GAP  ·' },
    kiosk: null,
    vent: null,
    news: null,
    tape: { x: 52.5, z: 9.5 },
    life: {
      pigeons: [{ x: 20.2, z: 6.2 }, { x: 66.5, z: 12.8 }, { x: 72.1, z: 7.4 }],
      rats: [{ x: 30, track: 0 }, { x: 70, track: 1 }],
      commuters: [],
    },
  },
};
```

- [ ] **Step 4: Run the test**: `node --test test/station-decor.test.js` → PASS. (If a pigeon or prop lands on a
  pillar or bench, move it half a tile.)

- [ ] **Step 5: `src/rpg/sprites.js`: the tape.** Add to `PROPS`:

```js
  // Across CANAL ST's closed stairs (subway ride spec §5).
  tape: { lines: ['╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱', ' STREET EXIT CLOSED ', '   OPENING  SOON    ', '╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱'], colors: ['#1a1a1a', '#1a1a1a', '#1a1a1a', '#1a1a1a'], h: 0.9, opts: { bg: '#f2c230' } },
```

- [ ] **Step 6: `src/rpg/scene.js`.** Make these changes, in order:

1. Imports: replace `import { TRAIN, departures } from './train.js';` with
   `import { departures } from './schedule.js';` and add `import { DECOR } from './decor.js';`; drop `STATION_LIFE`
   from the `life.js` import.
2. Signature and setup: `export function buildScene(scene, map, { reducedMotion = false, decor = DECOR[map.name] } = {}) {`.
   `scene` is now a `THREE.Group` (the caller places it at the station's x on the line). Delete the three lines
   setting `scene.background`, `scene.fog`, and adding the `HemisphereLight`.
3. Add a surface for the tape to `SURF`: `tape: ['#2a2410', '#f2c230', '╱'],` and in the tile loop, before
   `if (cell.level == null) continue;`:
   ```js
    if (ch === 'x') { // tape across a closed exit, at the floor beside it
      const y = map.levelAt(x - 1, z) ?? 0;
      box('hall', x, y - 0.1, z, 1, 0.2, 1);
      box('tape', x, y + 0.55, z, 0.12, 1.1, 1);
      continue;
    }
   ```
4. Tubes: give the bars no lights of their own, and light them from a pool. Replace the `const tubes = map.tubes.map(…)`
   block with:
   ```js
  // Tubes: a bright bar each (it blooms). Their light comes from a pool of TUBE_LIGHTS point lights, moved each frame to
  // the tubes nearest you: every point light costs every lit pixel, and the lengthened platform has twice the tubes.
  const TUBE_LIGHTS = 12;
  const tubes = map.tubes.map((t) => {
    const bar = new THREE.Mesh(tubeGeo, own(tubeMat.clone()));
    bar.position.set(t.x, t.y, t.z);
    scene.add(bar);
    return { ...t, bar, base: 7, k: 1 };
  });
  const tubeLights = Array.from({ length: Math.min(TUBE_LIGHTS, tubes.length) }, () => {
    const light = new THREE.PointLight('#cfe3ff', 0, 8, 1.6);
    scene.add(light);
    return light;
  });
   ```
   and in `update`, where the tube loop sets `t.light.intensity = t.base * k;`, set `t.k = k;` instead, then after the
   loop assign the pool:
   ```js
      // The pool's lights go to the nearest tubes, each at its tube's flicker.
      const near = tubes.map((t, i) => [Math.abs(t.x - walker.x) + Math.abs(t.z - walker.z), i]).sort((a, b) => a[0] - b[0]);
      for (let j = 0; j < tubeLights.length; j++) {
        const t = tubes[near[j][1]];
        tubeLights[j].position.set(t.x, t.y - 0.25, t.z);
        tubeLights[j].intensity = t.base * t.k;
      }
   ```
   (Return `tubes` as before; nothing else reads `tube.light`. Check with `grep -n "\.light\b" src/rpg/*.js`; if
   `audio.js` or the hooks read it, read `t.k` instead.)
5. The exit's warm light and sign: wrap in `if (map.exits.length && decor.exitSign)` and use `decor.exitSign` for the
   sprite's text.
6. Props: replace the hard-coded `prop(...)` calls (the bin, closed, map, vending, the two bins at 23 and 35,
   nowShowing, torn, gap) with
   ```js
  for (const [name, x, z, lift = 0] of decor.props) prop(name, x, z, lift);
  if (decor.torn) prop('torn', decor.torn.x, decor.torn.z, decor.torn.lift);
   ```
   and build the flap only `if (decor.torn)`, at `decor.torn.x + 0.45, LEVEL.track + decor.torn.lift + 0.62, decor.torn.z + 0.01`.
   Where the update and `sources` read `flap`, guard with `flap &&` (the poster source is `null` without one).
7. Clock and board: build the clock only `if (decor.clock)`, at `decor.clock`. Build the board at `decor.board`, from
   `departures(0, decor.stop)`; in `updateLife` replace `departures(trainT, map, !reducedMotion)` with
   `departures(trainT, decor.stop, !reducedMotion)`. Guard the clock's per-second redraw with `if (clock)`.
8. Ticker: `const TICKER = decor.ticker.text;` and `const ticker = { x: decor.ticker.x, z: decor.ticker.z, y: LEVEL.platform + 2.55, w: decor.ticker.w };`.
9. Kiosk lamp and vent: build only `if (decor.kiosk)` (at `decor.kiosk.x`) and `if (decor.vent)` (at `decor.vent`);
   `sources.vent` is `null` without one, and the steam update is skipped.
10. Newspaper: only `if (decor.news)`, at `decor.news`; its clamp `Math.min(45, Math.max(21, …))` becomes
    `Math.min(decor.news.range[1], Math.max(decor.news.range[0], …))`.
11. Life: `pigeons` and `rats` from `decor.life.pigeons` and `decor.life.rats`.
12. The tape sign: `if (decor.tape) prop('tape', decor.tape.x - 0.4, decor.tape.z, 0.15);` (it stands on the
    landing's floor, facing the camera).
13. The old train: delete `carTex` … `lamps` (the car textures, roof, geometry, the `train` group and its lamps), the
    `headlight`, the mouth planes (`mouthGeo`, `mouths`, `MOUTH_DARK`, `MOUTH_LIT`), and the `trainTexture` function.
    Keep `mouthLight`. In `update`, replace the block from `// The tunnel the train comes out of glows…` through the
    `if (passing) { … headlight … }` block with:
    ```js
      // The tunnel a train is about to come out of glows for the warning (passFor's 'warn'), and stays lit as it comes.
      const warm = pass && (pass.phase === 'warn' ? pass.warn : pass.phase === 'pass' && pass.speed > 0 && (pass.head < 4 || pass.head > map.cols - 4) ? 1 : 0);
      mouthLight.intensity = 25 * (warm || 0);
      if (warm) mouthLight.position.set(pass.dir > 0 ? 0.3 : map.cols - 0.3, pass.track.y + 1.6, pass.track.z);
    ```
14. Motion effects scale with speed: `const passing = !!pass && pass.phase === 'pass' && pass.speed > 0.5;` and, where
    the tube shudder, wind, newspaper and `shake` use a passing train, multiply their strength by
    `Math.min(1, pass.speed / 20)` (a train braking in shudders less; a standing one not at all).
15. `const rail = …` scales rails to `map.cols + 8`; keep it (the tunnel draws its own rails beyond).

- [ ] **Step 7: `src/rpg/index.js`: drive the station from the schedule.** Until Task 8 rewrites the loop, keep it
  working:
  - imports: replace `import { trainAt, sharedTime } from './train.js';` with
    `import { sharedTime } from './train.js';` and `import { trainsAt, passFor } from './schedule.js';`;
  - after `const scene = new THREE.Scene();` add:
    ```js
    scene.background = new THREE.Color('#05060a');
    scene.fog = new THREE.Fog('#05060a', 16, 34);
    scene.add(new THREE.HemisphereLight('#8090b8', '#1a1612', 0.6));
    const museum = new THREE.Group();
    scene.add(museum);
    ```
    and build with `world = buildScene(museum, map, { reducedMotion });`;
  - in the frame: `const tt = clock(), trains = trainsAt(tt), train = passFor(trains, 0, map);` in place of
    `const tt = clock(), train = trainAt(tt, map);`;
  - the hook: `train: () => passFor(trainsAt(clock()), 0, map), trains: () => trainsAt(clock()),`.
  - `src/rpg/train.js`: the shared clock now wraps on the schedule's whole day of cycles. Replace
    `export const PERIOD = TRAIN.every * 2400;` with `export { PERIOD } from './schedule.js';` and import it for
    `sharedTime` (`import { PERIOD } from './schedule.js';`). `test/station-peers.test.js`'s clock test reads
    `PERIOD` from `train.js`, so it follows.
  - `src/rpg/sound.js`'s `trainSound`/`announcementAt` still take the old schedule until Task 12; they don't draw
    anything, so the station runs.

- [ ] **Step 8: `src/rpg/life.js`.** Commuters watch "a train that never stops": `stepCommuter` treats `phase: 'pass'`
  as passing. With `passFor`, a standing local is also `'pass'` with `speed: 0`. Make the commuter react only to a
  moving one: in `stepCommuter`, change
  `const passing = !!train && train.phase === 'pass' && …` to
  `const passing = !!train && train.phase === 'pass' && (train.speed ?? 1) > 0.5 && …`,
  and in `stepPigeon`'s `trainNear` the same `(train.speed ?? 1) > 0.5` for the `'pass'` case. Update the comment at
  the top of `life.js` ("waiting for a train that never stops") to "waiting on the platform".

- [ ] **Step 9: Run the unit tests and the station e2e**

Run: `node --test test/station-decor.test.js test/station-life.test.js test/station-map.test.js`
Then: `E2E_ANGLE=swiftshader ONLY='draws|walk|turnstile|commuters|resiz|portrait|fifteen|no page errors' node e2e/station.mjs`
Expected: PASS, except "a train comes out of the tunnel and passes" (not run here; Task 14 rewrites it). Look at
`e2e/shots/` for the station: same look as before, platform longer, no train.

- [ ] **Step 10: Commit**

```bash
git add src/rpg/decor.js src/rpg/scene.js src/rpg/sprites.js src/rpg/index.js src/rpg/life.js test/station-decor.test.js
git commit -m "Subway ride: a station built from its decor into a group; tube lights pooled; the old train goes"
```

---

### Task 7: The NYC train

**Files:**
- Create: `src/rpg/trainmesh.js`
- Modify: `src/rpg/index.js` (draw the trains), `src/main.js` (photo URLs for the ad cards)

**Interfaces:**
- Consumes: `TRAIN`, `LENGTH` (Task 1); `CAR`, `PITCH`, `POLES`, `trainOrigin` (Task 3); `trussShade`, `sunAt`, `lampAt`,
  `STOPS` (Task 1); `LEVEL`.
- Produces: `createTrains(scene, { reducedMotion, ads = [] })` → `{ update(trains, ctx), shown(), dispose() }` where
  `ctx = { me: { x, z } (world), mine: trainId | null, time, sun }`; `shown()` → `[{ id, x, z, roof: [opacity…] }]`
  for tests. `startStation(stage, { …, ads })` passes `ads` through.

- [ ] **Step 1: Create `src/rpg/trainmesh.js`**

```js
// The trains (subway ride spec §3): five New York cars, stainless and ribbed, three double doors a side, a cab at each
// end with a route bullet, a destination sign and lamps, warm inside with benches, poles, ad cards and a strip map
// over each door. A small pool of models is placed on the trains nearest the camera each frame.
//
// A model is built in its train's frame (x from its west end, z from the track's middle; car.js) and placed at the
// train's west end, so it's the same whichever way the train runs; only the lamps and signs know its direction.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAIN, LENGTH } from './schedule.js';
import { CAR, PITCH, POLES, trainOrigin } from './car.js';
import { trussShade, sunAt, lampAt, STOPS } from './line.js';
import { LEVEL } from './map.js';

const F = LEVEL.platform; // the car's floor, level with the platforms
const H = { bottom: F - 1.05, sill: F + 0.8, lintel: F + 1.7, ceil: F + 2.05, top: F + 2.45, bench: F + 0.32 };
export const POOL = 4; // models: enough for a local standing, one passing, and two in view from a train
const REACH = 120; // trains further from the camera than this aren't drawn
const WIN = 1.0, PIER = 0.22;

// The car's windows along it (u from its west end), between the doors: as many WIN-wide as fit with piers between.
export const WINDOWS = (() => {
  const [d0, d1, d2] = CAR.doors, g = CAR.door + 0.15, out = [];
  for (const [a, b] of [[0.45, d0 - g], [d0 + g, d1 - g], [d1 + g, d2 - g], [d2 + g, TRAIN.car - 0.45]]) {
    const n = Math.max(1, Math.floor((b - a + PIER) / (WIN + PIER))), w = (b - a - PIER * (n - 1)) / n;
    for (let i = 0; i < n; i++) out.push([a + i * (w + PIER), a + i * (w + PIER) + w]);
  }
  return out;
})();
const DOOR_GAPS = CAR.doors.map((d) => [d - CAR.door, d + CAR.door]);

// A box from (x0, y0, z0) to (x1, y1, z1), as geometry to merge.
const slab = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
// The pieces of [a, b] not covered by the gaps.
function between(a, b, gaps) {
  const out = [];
  let x = a;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > x) out.push([x, Math.min(g0, b)]); x = Math.max(x, g1); }
  if (x < b) out.push([x, b]);
  return out.filter(([p, q]) => q - p > 1e-3);
}

// One side's outer wall (s = −1 north, +1 south): below the floor whole, from the floor to the sill and up the window
// band broken by the doors (and the windows), and whole above the lintel.
function sideGeo(s) {
  const z0 = s * (CAR.half - 0.08), z1 = s * CAR.half, [za, zb] = [Math.min(z0, z1), Math.max(z0, z1)], parts = [];
  parts.push(slab(0, TRAIN.car, H.bottom, F, za, zb));
  for (const [a, b] of between(0, TRAIN.car, DOOR_GAPS)) parts.push(slab(a, b, F, H.sill, za, zb));
  for (const [a, b] of between(0, TRAIN.car, [...DOOR_GAPS, ...WINDOWS])) parts.push(slab(a, b, H.sill, H.lintel, za, zb));
  parts.push(slab(0, TRAIN.car, H.lintel, H.top, za, zb));
  return mergeGeometries(parts);
}
// The end walls with their end doors, and the gangway's bellows behind the car (not behind the last).
function endsGeo(last) {
  const p = [], t = CAR.end, hz = CAR.half - 0.08;
  for (const [u0, u1] of [[0, t], [TRAIN.car - t, TRAIN.car]]) {
    p.push(slab(u0, u1, H.bottom, H.top, -hz, -CAR.pass), slab(u0, u1, H.bottom, H.top, CAR.pass, hz));
    p.push(slab(u0, u1, H.lintel, H.top, -CAR.pass, CAR.pass), slab(u0, u1, H.bottom, F, -CAR.pass, CAR.pass));
  }
  if (!last) for (const s of [-1, 1]) p.push(slab(TRAIN.car, PITCH, F, H.lintel + 0.1, s * 0.62 - 0.04, s * 0.62 + 0.04));
  if (!last) p.push(slab(TRAIN.car, PITCH, H.lintel + 0.1, H.lintel + 0.18, -0.66, 0.66));
  return mergeGeometries(p);
}
function benchGeo() {
  const p = [], [d0, d1, d2] = CAR.doors, g = CAR.door + 0.2;
  for (const s of [-1, 1]) for (const [a, b] of [[0.5, d0 - g], [d0 + g, d1 - g], [d1 + g, d2 - g], [d2 + g, TRAIN.car - 0.5]]) {
    const z0 = s * CAR.bench, z1 = s * CAR.wall;
    p.push(slab(a, b, F, H.bench, Math.min(z0, z1), Math.max(z0, z1)));
    p.push(slab(a, b, H.bench, H.bench + 0.38, s > 0 ? CAR.wall - 0.06 : -CAR.wall, s > 0 ? CAR.wall : -CAR.wall + 0.06)); // the backrest
  }
  return mergeGeometries(p);
}
function chromeGeo() {
  const p = [];
  for (const d of CAR.doors) p.push(new THREE.CylinderGeometry(CAR.pole, CAR.pole, H.ceil - F, 8).translate(d, (F + H.ceil) / 2, 0));
  for (const s of [-1, 1]) p.push(slab(0.3, TRAIN.car - 0.3, H.ceil - 0.18, H.ceil - 0.14, s * 0.72 - 0.02, s * 0.72 + 0.02));
  return mergeGeometries(p);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// Stainless steel with its ribs, as glyphs: │ in a lighter grey on the steel, one rib every 1/8 of a unit.
const fluted = () => {
  const t = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#9ea4ae'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d6dbe3'; g.font = '16px monospace'; g.textAlign = 'center';
    for (let x = 4; x < w; x += 8) for (let y = 14; y < h + 14; y += 16) g.fillText('│', x, y);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(TRAIN.car / 2, 2);
  return t;
};
const floorTex = () => {
  const t = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#3c3a38'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6c6862'; g.font = '14px monospace';
    for (let i = 0; i < 18; i++) g.fillText('·', (i * 37) % w, ((i * 23) % h) + 8);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(TRAIN.car, 3);
  return t;
};
// The cab's face: two windows, the route bullet, and the destination sign (redrawn when the text changes).
function cabTexture(dest, lit) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#a9afb8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16181c'; g.fillRect(18, 40, 90, 90); g.fillRect(148, 40, 90, 90);
    g.fillStyle = lit ? '#ff9a1f' : '#3a2a14'; g.beginPath(); g.arc(128, 22, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 20px monospace'; g.textAlign = 'center'; g.fillText('F', 128, 29);
    g.fillStyle = '#0a0a0a'; g.fillRect(28, 140, 200, 30);
    g.fillStyle = lit ? '#ffb340' : '#2a1d0a'; g.font = 'bold 22px monospace'; g.fillText(dest, 128, 163);
    g.fillStyle = '#8b9099'; for (let x = 8; x < w; x += 10) g.fillRect(x, 190, 2, 60);
  });
}
// The strip map over a door: the stations as dots on a line, the next one lit.
function stripTexture(next) {
  return canvasTexture(256, 32, (g, w, h) => {
    g.fillStyle = '#f2efe8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff9a1f'; g.lineWidth = 4; g.beginPath(); g.moveTo(30, 16); g.lineTo(w - 30, 16); g.stroke();
    STOPS.forEach((s, i) => {
      const x = i === 0 ? 30 : w - 30;
      g.fillStyle = i === next ? '#e2483d' : '#2b2a28'; g.beginPath(); g.arc(x, 16, i === next ? 8 : 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2b2a28'; g.font = '10px monospace'; g.textAlign = i === 0 ? 'left' : 'right'; g.fillText(s.name, i === 0 ? 44 : w - 44, 12);
    });
  });
}
// The LED text inside, drawn once and scrolled a character at a time (as the station's ticker is).
function ledTexture(text) {
  const t = canvasTexture(Math.max(64, text.length * 12), 24, (g, w, h) => {
    g.fillStyle = '#0a0705'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff6a2a'; g.font = 'bold 18px monospace'; g.fillText(text, 0, 18);
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(Math.min(1, 24 / Math.max(1, text.length)), 1);
  return t;
}
// An ad card: one of the gallery's photos, or a text card while it loads (or with none).
function adTexture(i, url, loader, own) {
  const t = canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = ['#e8dfc8', '#1d2a3a', '#f2c230'][i % 3]; g.fillRect(0, 0, w, h);
    g.fillStyle = ['#2b2a28', '#e8dfc8', '#1a1a1a'][i % 3]; g.font = 'bold 14px monospace'; g.textAlign = 'center';
    g.fillText(['faiz.pics', 'NOW SHOWING', 'UPSTAIRS'][i % 3], w / 2, h / 2 + 5);
  });
  if (url) loader.load(url, (img) => { own(img); img.colorSpace = THREE.SRGBColorSpace; t.image = img.image; t.needsUpdate = true; });
  return t;
}

export function createTrains(scene, { reducedMotion = false, ads = [] } = {}) {
  const owned = [];
  const own = (x) => { owned.push(x); return x; };
  const loader = new THREE.TextureLoader();
  const geo = {
    north: own(sideGeo(-1)), south: own(sideGeo(1)), ends: own(endsGeo(false)), lastEnds: own(endsGeo(true)),
    roof: own(slab(0, TRAIN.car, H.top, H.top + 0.1, -CAR.half, CAR.half)),
    floor: own(slab(0.1, TRAIN.car - 0.1, F - 0.06, F, -CAR.wall, CAR.wall)),
    bench: own(benchGeo()), chrome: own(chromeGeo()),
    strip: own(new THREE.BoxGeometry(TRAIN.car - 0.6, 0.03, 0.12)),
    bogie: own(slab(1.2, 3.6, H.bottom - 0.45, H.bottom, -1.0, 1.0)),
    cab: own(new THREE.PlaneGeometry(2.9, 3.3)),
    ad: own(new THREE.PlaneGeometry(1.0, 0.3)),
    stripMap: own(new THREE.PlaneGeometry(1.2, 0.15)),
    leaf: own(new THREE.BoxGeometry(CAR.door, H.lintel - F, 0.05)),
    lamp: own(new THREE.SphereGeometry(0.1, 10, 8)),
    patch: own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
  };
  const steelTex = own(fluted());
  const mat = {
    steel: own(new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.55, roughness: 0.38 })),
    floor: own(new THREE.MeshStandardMaterial({ map: own(floorTex()), roughness: 0.9 })),
    orange: own(new THREE.MeshStandardMaterial({ color: '#e8772e', emissive: '#3a1606', roughness: 0.6 })),
    chrome: own(new THREE.MeshStandardMaterial({ color: '#d8dde6', metalness: 0.9, roughness: 0.2 })),
    bogie: own(new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.8 })),
    leaf: own(new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.5, roughness: 0.4, color: '#c8ccd4' })),
    shaft: own(new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
  };
  const adTex = Array.from({ length: 6 }, (_, i) => own(adTexture(i, ads[i % Math.max(1, ads.length)] || null, loader, own)));
  const adMats = adTex.map((t) => own(new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: '#b8b0a0' })));

  function build() {
    const group = new THREE.Group(), cars = [];
    const glow = own(new THREE.MeshBasicMaterial({ color: '#fff4dc', toneMapped: false }));
    const stripMats = [own(new THREE.MeshBasicMaterial({ map: own(stripTexture(0)), toneMapped: false })), own(new THREE.MeshBasicMaterial({ map: own(stripTexture(1)), toneMapped: false }))];
    for (let c = 0; c < TRAIN.cars; c++) {
      const g = new THREE.Group();
      g.position.x = c * PITCH;
      const south = own(mat.steel.clone()), roofMat = own(mat.steel.clone());
      south.transparent = roofMat.transparent = true;
      const parts = {
        north: new THREE.Mesh(geo.north, mat.steel), south: new THREE.Mesh(geo.south, south),
        ends: new THREE.Mesh(c === TRAIN.cars - 1 ? geo.lastEnds : geo.ends, mat.steel), roof: new THREE.Mesh(geo.roof, roofMat),
        floor: new THREE.Mesh(geo.floor, mat.floor), bench: new THREE.Mesh(geo.bench, mat.orange), chrome: new THREE.Mesh(geo.chrome, mat.chrome),
      };
      for (const m of Object.values(parts)) g.add(m);
      for (const s of [-0.62, 0.62]) { const l = new THREE.Mesh(geo.strip, glow); l.position.set(TRAIN.car / 2, H.ceil, s); g.add(l); }
      for (const u of [2.4, TRAIN.car - 2.4]) { const b = new THREE.Mesh(geo.bogie, mat.bogie); b.position.x = u - 2.4; g.add(b); }
      // Ad cards over the windows, on the inside of both walls; strip maps over the doors.
      WINDOWS.forEach(([a, b], i) => {
        for (const s of [-1, 1]) {
          const ad = new THREE.Mesh(geo.ad, adMats[(c * 7 + i * 2 + (s > 0 ? 1 : 0)) % adMats.length]);
          ad.position.set((a + b) / 2, H.lintel + 0.18, s * (CAR.wall - 0.01));
          ad.rotation.y = s > 0 ? Math.PI : 0;
          g.add(ad);
        }
      });
      const strips = [];
      for (const d of CAR.doors) for (const s of [-1, 1]) {
        const m = new THREE.Mesh(geo.stripMap, stripMats[0]);
        m.position.set(d, H.lintel + 0.05, s * (CAR.wall - 0.01));
        m.rotation.y = s > 0 ? Math.PI : 0;
        g.add(m); strips.push(m);
      }
      group.add(g);
      cars.push({ g, parts, south, roofMat, strips, fade: 1 });
    }
    // Door leaves: two a doorway, both sides, every car.
    const leaves = new THREE.InstancedMesh(geo.leaf, mat.leaf, TRAIN.cars * CAR.doors.length * 4);
    group.add(leaves);
    // The cabs' faces, west and east, and their lamps (white at the front, red at the back).
    const cabs = [0, 1].map((e) => {
      const m = new THREE.Mesh(geo.cab, own(new THREE.MeshStandardMaterial({ map: own(cabTexture('', false)), metalness: 0.4, roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.05 })));
      m.position.set(e ? LENGTH + 0.01 : -0.01, (H.bottom + H.top) / 2, 0);
      m.rotation.y = e ? Math.PI / 2 : -Math.PI / 2;
      group.add(m);
      const lamps = [-0.9, 0.9].map((z) => { const l = new THREE.Mesh(geo.lamp, own(new THREE.MeshBasicMaterial({ color: '#fff3d0', toneMapped: false }))); l.position.set(e ? LENGTH + 0.03 : -0.03, H.bottom + 0.5, z); group.add(l); return l; });
      return { m, lamps, key: '' };
    });
    // Light shafts (bridge sun) and lamp bands (tunnel): a floor patch per south window, scaled by how much light it lets in.
    const patches = new THREE.InstancedMesh(geo.patch, mat.shaft, TRAIN.cars * WINDOWS.length);
    patches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(patches);
    const light = new THREE.PointLight('#ffe2b0', 0, 9, 1.6); // inside, at the car nearest the camera
    const headlight = new THREE.PointLight('#fff1cc', 0, 14, 1.4);
    group.add(light, headlight);
    // The LED over each car's end doors, inside, facing into the car.
    const ledMat = own(new THREE.MeshBasicMaterial({ toneMapped: false }));
    const ledGeo = own(new THREE.PlaneGeometry(1.6, 0.16));
    for (let c = 0; c < TRAIN.cars; c++) for (const u of [CAR.end + 0.01, TRAIN.car - CAR.end - 0.01]) {
      const l = new THREE.Mesh(ledGeo, ledMat);
      l.position.set(c * PITCH + u, H.lintel + 0.12, 0);
      l.rotation.y = u < 1 ? Math.PI / 2 : -Math.PI / 2;
      group.add(l);
    }
    scene.add(group);
    return { group, cars, leaves, cabs, patches, light, headlight, glow, stripMats, ledMat, ledKey: null, id: null };
  }

  const pool = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const FLAT = new THREE.Quaternion();
  const shown = [];

  function place(model, tr, ctx) {
    const o = trainOrigin(tr), mine = tr.id === ctx.mine;
    model.group.visible = true;
    model.group.position.set(o.x, 0, o.z);
    const local = tr.kind === 'local';
    model.glow.color.set(local ? '#fff4dc' : '#5a5650');
    // Cars outside an express's stretch aren't drawn (it doesn't run there).
    for (let c = 0; c < TRAIN.cars; c++) {
      const car = model.cars[c], x0 = o.x + c * PITCH, x1 = x0 + TRAIN.car;
      car.g.visible = !tr.clip || (x1 > tr.clip[0] && x0 < tr.clip[1]);
      // The roof and south wall fade when the car is between you and the camera, or you're in it (spec §3).
      const cx = (x0 + x1) / 2, near = o.z > ctx.me.z - 1.6 && o.z < ctx.me.z + 10 && Math.abs(cx - ctx.me.x) < TRAIN.car / 2 + 6;
      const inIt = mine && Math.abs(cx - ctx.me.x) < TRAIN.car / 2 + 0.4;
      const target = inIt ? 0 : near ? 0.18 : 1;
      car.fade += (target - car.fade) * (1 - Math.exp(-ctx.dt / 0.15));
      car.roofMat.opacity = car.fade; car.south.opacity = Math.max(car.fade, inIt ? 0.12 : 0);
      car.parts.roof.visible = car.fade > 0.02;
      car.roofMat.depthWrite = car.south.depthWrite = car.fade > 0.95;
    }
    // The strip maps light the next stop.
    const next = tr.kind === 'local' ? (tr.dir > 0 ? (tr.tau < 0 ? 0 : 1) : (tr.tau < 0 ? 1 : 0)) : 0;
    for (const car of model.cars) for (const s of car.strips) s.material = model.stripMats[next];
    // Doors: the platform side's leaves slide apart as tr.doors goes 0 → 1.
    let i = 0;
    for (let c = 0; c < TRAIN.cars; c++) for (const d of CAR.doors) for (const s of [-1, 1]) for (const side of [-1, 1]) {
      const open = tr.at != null && Math.sign(s) === (tr.track.i === 0 ? 1 : -1) ? tr.doors : 0;
      v.set(c * PITCH + d + side * (CAR.door / 2 + open * CAR.door * 0.95), (F + H.lintel) / 2, s * (CAR.half - 0.1));
      m4.compose(v, q.identity(), sc.set(1, 1, 1));
      model.leaves.setMatrixAt(i++, m4);
    }
    model.leaves.instanceMatrix.needsUpdate = true;
    // The cabs: the front's lamps white, the back's red; the destination on both.
    const dest = local ? (tr.dir > 0 ? STOPS[1].name : STOPS[0].name) : '';
    model.cabs.forEach((cab, e) => {
      const front = (e === 1) === (tr.dir > 0);
      for (const l of cab.lamps) l.material.color.set(front ? '#fff3d0' : '#ff2a1a');
      const key = `${dest}|${local}`;
      if (cab.key !== key) { cab.key = key; cab.m.material.map.dispose(); cab.m.material.map = own(cabTexture(dest, local)); cab.m.material.needsUpdate = true; }
    });
    // The car rocks gently as it runs (spec §4); the camera follows the frame, not the rock, so the world stays still.
    model.group.rotation.x = reducedMotion ? 0 : 0.007 * Math.min(1, tr.speed / 20) * Math.sin(ctx.time * 1.7 + (tr.k ?? tr.m ?? 0));
    // The LED inside over the end doors: where it's going and the next stop, or LAST STOP.
    const led = !local ? '' : tr.last ? `   THIS IS THE LAST STOP ON THIS TRAIN · EVERYONE PLEASE LEAVE THE TRAIN ·` : `   THIS IS A ${dest} BOUND TRAIN · THE NEXT STOP IS ${STOPS[next].name} ·`;
    if (model.ledKey !== led) { model.ledKey = led; model.ledMat.map?.dispose(); model.ledMat.map = own(ledTexture(led)); model.ledMat.needsUpdate = true; }
    if (model.ledMat.map) model.ledMat.map.offset.x = reducedMotion ? 0 : Math.floor(ctx.time * 6) / 60;
    model.headlight.position.set(tr.dir > 0 ? LENGTH + 3 : -3, H.bottom + 0.6, 0);
    model.headlight.intensity = tr.speed > 0.5 ? 10 : 0;
    // Inside: a warm light at the car nearest the camera (locals only).
    const cNear = Math.min(TRAIN.cars - 1, Math.max(0, Math.floor((ctx.me.x - o.x) / PITCH)));
    model.light.position.set(cNear * PITCH + TRAIN.car / 2, H.ceil - 0.3, 0);
    model.light.intensity = local ? 6 : 0.6;
    // Shafts and lamp bands through the south windows.
    let p = 0;
    for (let c = 0; c < TRAIN.cars; c++) for (const [a, b] of WINDOWS) {
      const wx = o.x + c * PITCH + (a + b) / 2;
      const k = Math.min(1, (ctx.sun ?? 1) * sunAt(wx) * trussShade(wx) + 0.5 * lampAt(wx) * (sunAt(wx) ? 0 : 1));
      v.set(c * PITCH + (a + b) / 2 + 0.35, F + 0.01, 0.25);
      m4.compose(v, FLAT, sc.set(k > 0.01 ? (b - a) * 0.95 : 0, 1, k > 0.01 ? 1.9 * k + 0.2 : 0));
      model.patches.setMatrixAt(p++, m4);
    }
    model.patches.instanceMatrix.needsUpdate = true;
    shown.push({ id: tr.id, x: o.x, z: o.z, roof: model.cars.map((c) => +c.fade.toFixed(2)) });
  }

  return {
    // trains: everything on the line now; ctx: { me (world x, z), mine (your train's id), time, dt, sun }.
    update(trains, ctx) {
      shown.length = 0;
      const near = trains
        .map((tr) => ({ tr, d: Math.max(0, Math.min(Math.abs(tr.head - ctx.me.x), Math.abs(tr.tail - ctx.me.x), (tr.head - ctx.me.x) * (tr.tail - ctx.me.x) < 0 ? 0 : Infinity)) }))
        .filter((e) => e.d < REACH || e.tr.id === ctx.mine)
        .sort((a, b) => (a.tr.id === ctx.mine ? -1 : b.tr.id === ctx.mine ? 1 : a.d - b.d))
        .slice(0, POOL);
      // Keep each train on the model it had, so fades and signs don't jump between models.
      const used = new Set();
      for (const { tr } of near) {
        let m = pool.find((p) => p.id === tr.id && !used.has(p));
        if (!m) m = pool.find((p) => !used.has(p) && !near.some((e) => e.tr.id === p.id));
        if (!m && pool.length < POOL) { m = build(); pool.push(m); }
        if (!m) continue;
        if (m.id !== tr.id) { m.id = tr.id; for (const car of m.cars) car.fade = 1; }
        used.add(m);
        place(m, tr, ctx);
      }
      for (const m of pool) if (!used.has(m)) { m.group.visible = false; m.id = null; m.light.intensity = m.headlight.intensity = 0; }
    },
    shown: () => shown.slice(),
    dispose() {
      for (const m of pool) { m.leaves.dispose(); m.patches.dispose(); m.group.removeFromParent(); }
      for (const o of owned) o.dispose?.();
    },
  };
}
```

Notes for the implementer:
- `mergeGeometries` needs every part to have the same attributes; `BoxGeometry` and `CylinderGeometry` both have
  position, normal and uv, so they merge. If a merge returns `null`, a part is missing an attribute.
- Point lights: a pooled model's two lights stay in the scene (intensity 0 when unused), so the light count, and
  so the shaders, don't change as trains come and go. Four models make 8 lights.
- The ASCII look comes from glyphs painted into textures (as `scene.js` does); keep new surfaces textured, not flat.

- [ ] **Step 2: `src/rpg/index.js`: draw the trains.** Import `createTrains`; take `ads = []` in `startStation`'s
  options; after building the station: `trainView = createTrains(scene, { reducedMotion, ads });` (declare
  `trainView` with the other teardown variables and call `trainView?.dispose()` in `teardown`). In the frame, after
  `world.update(…)`: `trainView.update(trains, { me: { x: walker.x, z: walker.z }, mine: null, time: t, dt, sun: 1 });`
  Add `shownTrains: () => trainView.shown()` to the hook.

- [ ] **Step 3: `src/main.js`: the ad cards.** In the `startStation(…)` call (near line 637) add
  `ads: data ? [...data.byId.values()].filter((p) => !p.hidden && !p.variantOf && p.src?.low).slice(0, 6).map((p) => p.src.low) : []`
  (check the name of the photos data variable there: it's the one `loadData` fills, near line 869).

- [ ] **Step 4: Look at it.** Add a check to `e2e/station.mjs` after "the platform has its commuters…":

```js
  await check('a local stands at the platform with its doors open: five NYC cars', async () => {
    await page.evaluate(() => { window.__station.setTime(20 + 6); window.__station.teleport(60, 6.5); }); // L0 standing
    await nFrames(page, 40);
    const shown = await page.evaluate(() => window.__station.shownTrains());
    assert.ok(shown.some((s) => s.id === 'L0'), JSON.stringify(shown));
    await page.screenshot({ path: 'e2e/shots/station-local-standing.png' });
  });
```
(`setTime(s)` pins the station's clock at s: the schedule's L0 arrives at MUSEUM at 20.)

Run: `E2E_ANGLE=swiftshader ONLY='local stands' node e2e/station.mjs` and look at
`e2e/shots/station-local-standing.png`: a long silver train along the north track, ribbed, windows lit warm,
doors open, the roof over the car in front of you faded so you see benches and poles inside. Adjust colours and
heights by eye until it reads as a New York train; keep the numbers in `H` consistent with `car.js` (floor at −3,
benches at 0.32 over it).

- [ ] **Step 5: Commit**

```bash
git add src/rpg/trainmesh.js src/rpg/index.js src/main.js e2e/station.mjs
git commit -m "Subway ride: the NYC train: ribbed steel, doors, cabs with bullets and signs, benches, poles, ads, strip maps"
```

---

### Task 8: Riding: frames, both stations, the camera, sitting, the turnaround

**Files:**
- Modify: `src/rpg/index.js`
- Test: e2e in Task 14; the pure parts are tested in Tasks 3–5.

**Interfaces:**
- Consumes: everything above.
- Produces (hook on `window.__station`): `frame()` → the rider's frame; `aboard()` → `{ k, x, z, seat }` or null;
  `board(k, x, z)` (put yourself in train k's frame at x, z); `world()` → your world `{ x, y, z }`;
  `sit()` / `stand()`; `teleport(x, z, stop = 0)` puts you in a station's frame; `env()` → `{ bridge }` (Task 10).

- [ ] **Step 1: Setup in `startStation`.** Add imports:

```js
import canalText from './canalst.txt?raw';
import { STOPS, pieceAt } from './line.js';
import { local, localsAt } from './schedule.js';
import { createRider, stepRider, frameOrigin, sit, stand, FADE } from './rider.js';
import { stationWithTrains, trainMap, offPoles, lurch, seatNear, trainOrigin } from './car.js';
import { CAM } from './camera.js';
import { LEVEL } from './map.js';
```
and after the MUSEUM group is built:

```js
    // The line's two stations (subway ride spec §5): MUSEUM built now, CANAL ST the first time the camera comes near it.
    // A station is hidden while the camera is away from it.
    const maps = [map, parseStation(canalText)];
    const groups = [museum, null], stations = [world, null];
    const stationNear = (i, x) => x > STOPS[i].x - 140 && x < STOPS[i].x + STOPS[i].cols + 140;
    const rider = createRider(0);
```

- [ ] **Step 2: The walker's map, by frame.** Add:

```js
    // The map you walk on: your station's (MUSEUM's with its gates), with the locals standing there joined to it
    // (car.js), or your train's floor plan, its doors shut while it moves.
    const frameMap = (tt) => {
      const f = rider.frame;
      if (f.kind === 'train') return TRAIN_MAP;
      const standing = localsAt(tt).filter((l) => l.at === f.stop);
      return stationWithTrains(f.stop === 0 ? gated : maps[f.stop], STOPS[f.stop].x, standing);
    };
    const TRAIN_MAP = trainMap(0), FREE = { cols: Infinity, rows: Infinity };
```

- [ ] **Step 3: Sitting on E, and the hint.** Add after the touch handlers:

```js
    // Sitting (§4): E sits at the nearest free seat, or stands you up. Not while typing.
    const taken = () => new Set(); // Task 11: the commuters' seats on your train
    const onKey = (e) => {
      if (e.key !== 'e' && e.key !== 'E') return;
      if (e.target?.closest?.('input, textarea')) return;
      if (rider.seat) stand(rider, walker, clock()); else sit(rider, walker, taken(), clock());
    };
    addEventListener('keydown', onKey);
    const hint = document.createElement('div');
    hint.className = 'station-hint';
    hint.textContent = '[E] sit';
    Object.assign(hint.style, { position: 'absolute', left: '50%', bottom: '18%', transform: 'translateX(-50%)', font: '14px monospace', color: '#ffd27a', background: 'rgba(5,6,10,0.7)', padding: '2px 8px', display: 'none', pointerEvents: 'none' });
    stage.append(hint);
    const fader = document.createElement('div');
    Object.assign(fader.style, { position: 'absolute', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none' });
    stage.append(fader);
```
In `stop()`/`teardown`, `removeEventListener('keydown', onKey)` and remove `hint` and `fader`.

- [ ] **Step 4: The frame loop.** Replace the movement part of `frame(now)` (from `const input = …` through the exit check)
  with the block below. It defines `tt` and `trains` itself, so delete Task 6's
  `const tt = clock(), trains = trainsAt(tt), train = passFor(trains, 0, map);` further down the frame (Step 5
  replaces what used `train`).

```js
      const tt = clock(), trains = trainsAt(tt);
      // Frames (rider.js): board as a standing local's doors close round you, alight as yours open, turn round past the
      // last stop. The camera's spring is kept in your frame, so it moves with you.
      const was = frameOrigin(rider.frame, tt);
      const ev = stepRider(rider, walker, tt);
      if (ev) {
        const now2 = frameOrigin(rider.frame, tt);
        cam.x += was.x - now2.x; cam.z += was.z - now2.z;
        if (ev === 'turn') fader.style.opacity = '1';
      }
      if (rider.fade > 0) { rider.fade = Math.max(0, rider.fade - dt); fader.style.opacity = String(Math.min(1, rider.fade / FADE.in)); }
      const f = rider.frame, m = frameMap(tt);
      const mine = f.kind === 'train' ? local(f.k, tt) : null;
      if (ticket.isOpen) finger = null;
      let input = ticket.isOpen ? STILL : finger ? fingerInput() : keys();
      if (rider.seat && (input.x || input.y)) stand(rider, walker, tt);
      if (rider.seat) input = STILL;
      if (!rider.seat) {
        stepWalker(walker, dt, input, m);
        if (mine) { lurch(walker, mine.accel, dt, m); offPoles(walker, m); }
      }
      walker.y = f.kind === 'train' ? LEVEL.platform : m.levelAt(walker.x, walker.z) ?? walker.y;
      const atMuseum = f.kind === 'station' && f.stop === 0;
      if (atMuseum) {
        pushOut(walker, crowd, m);
        trackGates(gates, walker, t);
        turnRotors(gates, walker);
        swingGates(gates, walker, dt);
        if (!ticket.isOpen) {
          const bump = bumped(gates, walker, input);
          if (bump && armed) { armed = false; walker.vx = walker.vz = 0; refused(gates, bump, t); ticket.open(); } else if (!bump) armed = true;
          const exit = blocked(gates, walker, input);
          if (exit && exitArmed) { exitArmed = false; refused(gates, exit, t); } else if (!exit) exitArmed = true;
        }
        easeArms(gates, walker, dt);
        if (gates.pass !== lastPass) { lastPass = gates.pass; ticket.update(); }
        if (!leaving && map.at(Math.floor(walker.x), Math.floor(walker.z))?.ch === 'E') { leaving = true; onExit(); }
      }
      // Where you are on the line, and the hint.
      const o = frameOrigin(f, tt), wx = o.x + walker.x, wz = o.z + walker.z;
      const canSit = !rider.seat && (mine ? seatNear(walker.x, walker.z) : localsAt(tt).some((l) => l.at === f.stop && (() => { const to = trainOrigin(l); return seatNear(wx - to.x, wz - to.z); })()));
      hint.style.display = canSit ? 'block' : 'none';
```

Then the pose: when seated, face the seat and sit:

```js
      const speed = rider.seat ? 0 : Math.hypot(walker.vx, walker.vz);
      if (rider.seat) targetYaw = rider.seat.yaw; else if (speed > 0.3) targetYaw = Math.atan2(walker.vx, walker.vz);
      pose.sit = rider.seat ? 1 : 0;
```
(keep the existing yaw/gait/phase lines after it), and feet in world coordinates:

```js
      feet.x = wx; feet.z = wz;
      feet.y = f.kind === 'station' ? footY(maps[f.stop], walker) : LEVEL.platform;
```

- [ ] **Step 5: The stations and trains, by where the camera is.** Replace the single `world.update(…)` call and the
  commuters' `{ train, walker }` with:

```js
      const camX = o.x + cam.x;
      for (let i = 0; i < 2; i++) {
        const near = stationNear(i, camX);
        if (near && !stations[i]) { groups[i] = new THREE.Group(); groups[i].position.x = STOPS[i].x; scene.add(groups[i]); stations[i] = buildScene(groups[i], maps[i], { reducedMotion }); }
        if (!stations[i]) continue;
        groups[i].visible = near;
        if (!near) continue;
        const here = { x: wx - STOPS[i].x, y: feet.y, z: wz }, pass = passFor(trains, i, maps[i]);
        stations[i].update(t, dt, here, pass, i === 0 ? gates : null, tt);
        if (i === 0) museumPass = pass;
      }
      trainView.update(trains, { me: { x: wx, z: wz }, mine: mine ? mine.id : null, time: t, dt, sun: 1 });
```
with `let museumPass = null;` declared before the loop; the commuters step with
`{ train: museumPass, walker: atMuseum ? walker : { x: -1e4, z: -1e4 } }`. `teardown` disposes `stations[1]` and
removes `groups[1]` if built.

- [ ] **Step 6: The camera in your frame.** Replace the camera block with:

```js
      // The camera follows you in your frame; on the bridge, riding, it pulls back to show the city (§4).
      cam.want = mine && pieceAt(wx).kind === 'bridge' ? CAM.bridge : CAM.dist;
      followCamera(cam, walker, dt, f.kind === 'station' ? maps[f.stop] : FREE, camera.aspect);
      const eye = eyeFor(cam), shake = f.kind === 'station' && stations[f.stop]?.shake ? stations[f.stop].shake(t, { x: walker.x, z: walker.z }, f.stop === 0 ? museumPass : null) : { x: 0, y: 0 };
      camera.position.set(o.x + eye.x + shake.x, eye.y + shake.y, o.z + eye.z);
      camera.lookAt(o.x + cam.x + shake.x, cam.y + shake.y, o.z + cam.z);
```
and `v.set(feet.x, feet.y + 0.8, feet.z).project(camera)` for the focus and the finger (they used `walker`).

- [ ] **Step 7: The hook.** Replace `teleport` and add:

```js
      teleport(x, z, stop = 0) { rider.frame = { kind: 'station', stop }; rider.seat = null; walker.x = x; walker.z = z; walker.vx = walker.vz = 0; walker.y = maps[stop].levelAt(x, z) ?? walker.y; },
      board(k, x, z) { rider.frame = { kind: 'train', k }; rider.seat = null; walker.x = x; walker.z = z; walker.vx = walker.vz = 0; },
      frame: () => ({ ...rider.frame }),
      aboard: () => (rider.frame.kind === 'train' ? { k: rider.frame.k, x: walker.x, z: walker.z, seat: rider.seat?.i ?? null } : null),
      world: () => ({ x: feet.x, y: feet.y, z: feet.z }),
      sit: () => sit(rider, walker, taken(), clock()),
      stand: () => stand(rider, walker, clock()),
```
`pos()` (multiplayer) stays `{ x, z, y, a }` in world coordinates for now; Task 13 adds the train form.

- [ ] **Step 8: Try it.** `npm run dev`, go down, wait for a local (the board counts down), walk through an open door,
  wait for the doors to close, and ride. Expected: the train leaves with you, the station slides away, you can walk
  the train and through the gangways, the train lurches you as it speeds up, E sits you down. Tunnels and the bridge
  are empty dark space until Tasks 9 and 10.

- [ ] **Step 9: Commit**

```bash
git add src/rpg/index.js
git commit -m "Subway ride: ride the train: frames, both stations, the camera in your frame, sitting, the turnaround fade"
```

---

### Task 9: The tunnels

**Files:**
- Create: `src/rpg/tunnel.js`
- Modify: `src/rpg/index.js`

**Interfaces:**
- Consumes: `pieceAt`, `LAMP`, `TRACKS` (Task 1); `LEVEL`.
- Produces: `createTunnel(scene, { reducedMotion })` → `{ update(camX, time), dispose() }`. The tunnel is drawn as
  SEGS segments of LAMP tiles centred on the camera, each shown only where the line is a tunnel there.

- [ ] **Step 1: Create `src/rpg/tunnel.js`**

```js
// The tunnels (subway ride spec §5): dark brick and concrete, two tracks with a row of steel columns between them, a
// lamp every LAMP tiles on the outer walls, red and green signals, cables. No ceiling, as the station has none, so the
// tilted camera sees in. Drawn as a run of segments that follows the camera; a segment shows only where the line is a
// tunnel, so the stations and the bridge are left to themselves.
import * as THREE from 'three';
import { pieceAt, LAMP, TRACKS } from './line.js';
import { LEVEL } from './map.js';

const SEGS = 40; // 480 tiles: well past the fog either way
const WALL_H = 5.2;
const LIGHTS = 4; // point lights at the lamps nearest the camera

function glyphs(base, ink, glyph, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 64);
  g.fillStyle = ink; g.font = '28px monospace'; g.textAlign = 'center'; g.globalAlpha = 0.35; g.fillText(glyph, 32, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  return t;
}

export function createTunnel(scene, { reducedMotion = false } = {}) {
  const owned = [];
  const own = (x) => { owned.push(x); return x; };
  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const mats = {
    wall: own(new THREE.MeshStandardMaterial({ map: own(glyphs('#2a2622', '#7a6a58', '▦', [LAMP, WALL_H])), roughness: 0.95 })),
    bed: own(new THREE.MeshStandardMaterial({ map: own(glyphs('#1f1c18', '#6a5a48', '═', [LAMP, 3])), roughness: 1 })),
    middle: own(new THREE.MeshStandardMaterial({ map: own(glyphs('#24221f', '#5a5048', '·', [LAMP, 9])), roughness: 1 })),
    column: own(new THREE.MeshStandardMaterial({ color: '#3a3f4f', metalness: 0.4, roughness: 0.6 })),
    rail: own(new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.4 })),
    cable: own(new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.8 })),
    lamp: own(new THREE.MeshBasicMaterial({ color: '#ffe9c0', toneMapped: false })),
    red: own(new THREE.MeshBasicMaterial({ color: '#ff3020', toneMapped: false })),
    green: own(new THREE.MeshBasicMaterial({ color: '#30ff70', toneMapped: false })),
  };
  // Per segment: [material, x offset in the segment, y, z, sx, sy, sz] boxes.
  const zN = 0.5, zS = 18.5, y0 = LEVEL.track;
  const parts = [
    ['wall', LAMP / 2, y0 + WALL_H / 2 - 0.2, zN - 0.15, LAMP, WALL_H, 0.3],
    ['wall', LAMP / 2, y0 + WALL_H / 2 - 0.2, zS + 0.15, LAMP, WALL_H, 0.3],
    ['middle', LAMP / 2, y0 + 0.5, 9.5, LAMP, 1.0, 9.4],
    ...TRACKS.map((t) => ['bed', LAMP / 2, y0 - 0.1, t.z, LAMP, 0.2, 3.6]),
    ...TRACKS.flatMap((t) => [-0.72, 0.72].map((dz) => ['rail', LAMP / 2, y0 + 0.06, t.z + dz, LAMP, 0.12, 0.1])),
    ...[0, 4, 8].flatMap((u) => [4.6, 14.4].map((z) => ['column', u + 0.2, y0 + 2.3, z, 0.3, 4.6, 0.3])),
    ['cable', LAMP / 2, y0 + 3.2, zN + 0.05, LAMP, 0.06, 0.06], ['cable', LAMP / 2, y0 + 3.0, zN + 0.05, LAMP, 0.06, 0.06],
    ['cable', LAMP / 2, y0 + 3.2, zS - 0.05, LAMP, 0.06, 0.06],
    ['lamp', 0, y0 + 3.6, zN + 0.12, 0.5, 0.12, 0.1], ['lamp', 0, y0 + 3.6, zS - 0.12, 0.5, 0.12, 0.1],
  ];
  const byMat = {};
  for (const p of parts) (byMat[p[0]] ||= []).push(p);
  const meshes = Object.entries(byMat).map(([k, list]) => {
    const m = new THREE.InstancedMesh(unit, mats[k], list.length * SEGS);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
    return { m, list };
  });
  // Signals every 5th segment on the column line, red or green from a hash of the segment.
  const signals = ['red', 'green'].map((k) => { const m = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.09, 8, 6)), mats[k], SEGS); m.frustumCulled = false; scene.add(m); return m; });
  const lights = Array.from({ length: LIGHTS }, () => { const l = new THREE.PointLight('#ffd9a8', 0, 9, 1.6); scene.add(l); return l; });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), ZERO = new THREE.Vector3(0, 0, 0);
  let lastFirst = null;
  return {
    update(camX, time) {
      const first = Math.floor(camX / LAMP) - SEGS / 2;
      const lampsNear = [];
      if (first !== lastFirst) {
        lastFirst = first;
        for (const { m, list } of meshes) {
          let i = 0;
          for (let n = 0; n < SEGS; n++) {
            const x0 = (first + n) * LAMP, on = pieceAt(x0 + LAMP / 2).kind === 'tunnel';
            for (const [, ox, y, z, sx, sy, sz] of list) {
              m4.compose(v.set(x0 + ox, y, z), q, on ? s.set(sx, sy, sz) : ZERO);
              m.setMatrixAt(i++, m4);
            }
          }
          m.instanceMatrix.needsUpdate = true;
        }
        signals.forEach((m, k) => {
          for (let n = 0; n < SEGS; n++) {
            const seg = first + n, x0 = seg * LAMP, on = pieceAt(x0).kind === 'tunnel' && seg % 5 === 0 && ((seg * 2654435761) >>> 0) % 2 === k;
            m4.compose(v.set(x0 + 0.2, LEVEL.track + 3.0, 4.3), q, on ? s.set(1, 1, 1) : ZERO);
            m.setMatrixAt(n, m4);
          }
          m.instanceMatrix.needsUpdate = true;
        });
      }
      // The lights go to the lamps nearest the camera, north and south walls in turn.
      const c = Math.round(camX / LAMP);
      for (let j = 0; j < LIGHTS; j++) {
        const x = (c + Math.floor(j / 2) * (j % 4 < 2 ? 1 : -1)) * LAMP, z = j % 2 ? zS - 0.6 : zN + 0.6;
        const on = pieceAt(x).kind === 'tunnel';
        lights[j].position.set(x, LEVEL.track + 3.3, z);
        lights[j].intensity = on ? 5 * (reducedMotion ? 1 : 0.96 + 0.04 * Math.sin(time * 9 + j)) : 0;
      }
      return lampsNear;
    },
    dispose() {
      for (const { m } of meshes) { m.removeFromParent(); m.dispose(); }
      for (const m of signals) { m.removeFromParent(); m.dispose(); }
      for (const l of lights) l.removeFromParent();
      for (const o of owned) o.dispose();
    },
  };
}
```

- [ ] **Step 2: `src/rpg/index.js`.** Import `createTunnel`; after the trains: `tunnel = createTunnel(scene, { reducedMotion });`
  (dispose in `teardown`); in the frame after the stations: `tunnel.update(camX, t);`.

- [ ] **Step 3: Look at it.** Add to `e2e/station.mjs`:

```js
  await check('riding through the tunnel: lamps stream past, the car lit warm inside', async () => {
    await page.evaluate(() => { window.__station.setTime(20 + 18 + 8); window.__station.board(0, 30, 0); }); // L0, 8 s out of MUSEUM
    await nFrames(page, 30);
    const a = await page.evaluate(() => window.__station.aboard());
    assert.equal(a.k, 0);
    await page.screenshot({ path: 'e2e/shots/station-tunnel.png' });
  });
```
Run: `E2E_ANGLE=swiftshader ONLY='tunnel' node e2e/station.mjs`. Look: dark tunnel walls with lamps, columns
between the tracks, your car's roof gone, warm benches, bands of lamp light on the floor.

- [ ] **Step 4: Commit**

```bash
git add src/rpg/tunnel.js src/rpg/index.js e2e/station.mjs
git commit -m "Subway ride: the tunnels: brick, columns between the tracks, lamps and signals, following the camera"
```

---

### Task 10: The bridge, the skyline and the sun

**Files:**
- Create: `src/rpg/bridge.js`
- Modify: `src/rpg/index.js`

**Interfaces:**
- Consumes: `PIECES`, `TRUSS`, `TRACKS` (Task 1); `rng` (`life.js`); `LEVEL`.
- Produces: `createBridge(scene, { reducedMotion })` → `{ update(camX, camZ, time) → k (0…1, how much the camera is
  out on the bridge), dispose() }`. It owns the sky colour, fog and sun: at k = 0 it leaves the scene as the
  station set it (`#05060a`, fog 16…34); at k = 1 a warm sky, fog 80…900, the sun on.

- [ ] **Step 1: Create `src/rpg/bridge.js`**

```js
// The bridge (subway ride spec §5): the train on the lower deck of a steel truss over a river at golden hour, a city
// on both banks receding north, towers with lit windows, haze, a low sun from the south-west raking through the
// truss. The sun's shafts in the cars are trainmesh.js's (line.js says where the truss shades them).
import * as THREE from 'three';
import { PIECES, TRUSS, TRACKS } from './line.js';
import { rng } from './life.js';
import { LEVEL } from './map.js';

const B = PIECES.find((p) => p.kind === 'bridge');
const RIVER = [B.x0 + 40, B.x1 - 40]; // the water's banks along x
const GROUND = -24, WATER = -32;
const TOWERS = 320;
const DARK = new THREE.Color('#05060a'), SKY = new THREE.Color('#d7935e'), HAZE = new THREE.Color('#c98a5e');

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

export function createBridge(scene, { reducedMotion = false } = {}) {
  const owned = [], own = (x) => { owned.push(x); return x; };
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const steel = own(new THREE.MeshStandardMaterial({ color: '#5d6a7a', metalness: 0.5, roughness: 0.5 }));
  const nearSteel = own(steel.clone()); nearSteel.transparent = true; // the south truss, between camera and train
  const deckMat = own(new THREE.MeshStandardMaterial({ map: own(canvasTex(64, 64, (g) => { g.fillStyle = '#26231f'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#7a6a55'; g.font = '28px monospace'; g.fillText('═', 16, 42); }, [B.x1 - B.x0, 19])), roughness: 1 }));
  const box = (mat, x, y, z, sx, sy, sz, parent = group) => { const m = new THREE.Mesh(unit, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };

  // The deck, the beds and rails.
  box(deckMat, (B.x0 + B.x1) / 2, LEVEL.track - 0.35, 9.5, B.x1 - B.x0, 0.5, 19.5);
  for (const t of TRACKS) for (const dz of [-0.72, 0.72]) box(own(new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.4 })), (B.x0 + B.x1) / 2, LEVEL.track + 0.06, t.z + dz, B.x1 - B.x0, 0.12, 0.1);
  // The truss, both sides: posts every bay, top and bottom chords, an X of braces in each bay.
  const TOP = LEVEL.track + 9, bays = Math.floor((B.x1 - B.x0) / TRUSS.bay);
  const post = own(new THREE.InstancedMesh(unit, steel, (bays + 1) * 2)), brace = own(new THREE.InstancedMesh(unit, steel, bays * 2 * 2));
  const postS = own(new THREE.InstancedMesh(unit, nearSteel, bays + 1)), braceS = own(new THREE.InstancedMesh(unit, nearSteel, bays * 2));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
  let pi = 0, bi = 0, ps = 0, bs = 0;
  const diag = Math.hypot(TRUSS.bay, TOP - LEVEL.track), ang = Math.atan2(TOP - LEVEL.track, TRUSS.bay);
  for (const [z, south] of [[-0.2, false], [19.2, true]]) {
    for (let i = 0; i <= bays; i++) {
      m4.compose(v.set(B.x0 + i * TRUSS.bay + TRUSS.post / 2, (LEVEL.track + TOP) / 2, z), q.identity(), s.set(TRUSS.post, TOP - LEVEL.track, TRUSS.post));
      (south ? postS : post).setMatrixAt(south ? ps++ : pi++, m4);
    }
    for (let i = 0; i < bays; i++) for (const sign of [1, -1]) {
      m4.compose(v.set(B.x0 + (i + 0.5) * TRUSS.bay, (LEVEL.track + TOP) / 2, z), q.setFromEuler(e.set(0, 0, sign * ang)), s.set(diag, 0.3, 0.3));
      (south ? braceS : brace).setMatrixAt(south ? bs++ : bi++, m4);
    }
    box(south ? nearSteel : steel, (B.x0 + B.x1) / 2, TOP, z, B.x1 - B.x0, 0.6, 0.6);
    box(south ? nearSteel : steel, (B.x0 + B.x1) / 2, LEVEL.track - 0.3, z, B.x1 - B.x0, 0.6, 0.6);
  }
  group.add(post, brace, postS, braceS);
  // The suspension towers and the main cables, and stone anchorages where the tunnels come out.
  const stone = own(new THREE.MeshStandardMaterial({ color: '#6e6258', roughness: 0.9 }));
  for (const x of [RIVER[0] + 8, RIVER[1] - 8]) for (const z of [-2.5, 21.5]) box(z < 0 ? steel : nearSteel, x, (WATER + 48) / 2, z, 3, 48 - WATER, 3);
  for (const x of [B.x0 - 6, B.x1 + 6]) box(stone, x, (GROUND + 6) / 2, 9.5, 14, 6 - GROUND, 30);
  for (const z of [-2.5, 21.5]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const x = B.x0 + ((B.x1 - B.x0) * i) / 40, k = (x - (RIVER[0] + RIVER[1]) / 2) / ((RIVER[1] - RIVER[0]) / 2); pts.push(new THREE.Vector3(x, 8 + 38 * Math.min(1, k * k), z)); }
    group.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(pts)), own(new THREE.LineBasicMaterial({ color: '#2a2f38' }))));
  }
  // The river and the banks.
  const water = own(new THREE.MeshStandardMaterial({ map: own(canvasTex(64, 64, (g) => { g.fillStyle = '#1b2a3a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#e0a060'; g.globalAlpha = 0.4; g.font = '24px monospace'; g.fillText('~', 8, 30); g.fillText('~', 36, 58); }, [80, 200])), roughness: 0.3, metalness: 0.2 }));
  const plane = (mat, x0, x1, z0, z1, y) => { const m = new THREE.Mesh(own(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2)), mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); group.add(m); };
  plane(water, RIVER[0] - 50, RIVER[1] + 50, -900, 300, WATER);
  const bank = own(new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 1 }));
  plane(bank, B.x0 - 900, RIVER[0], -900, 300, GROUND);
  plane(bank, RIVER[1], B.x1 + 900, -900, 300, GROUND);
  // The skyline: towers on both banks, mostly north (where the camera looks), taller and denser further off, with lit
  // windows painted into one texture (instance colours vary the stone). One draw.
  const windowsTex = own(canvasTex(64, 128, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) for (let x = 3; x < w; x += 7) { g.fillStyle = r() < 0.38 ? (r() < 0.7 ? '#ffcf7a' : '#fff0d0') : '#0a0a0a'; g.fillRect(x, y, 4, 5); }
  }, [3, 6]));
  const facade = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveMap: windowsTex, emissiveIntensity: 0.9, roughness: 0.8, metalness: 0.1 }));
  const towers = own(new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), facade, TOWERS));
  const r = rng(42), col = new THREE.Color();
  for (let i = 0; i < TOWERS; i++) {
    const west = r() < 0.5, north = r() < 0.85;
    const x = west ? RIVER[0] - 10 - r() * 700 : RIVER[1] + 10 + r() * 700;
    const z = north ? -30 - r() * 650 : 40 + r() * 250;
    const far = Math.min(1, -z / 650), hgt = 12 + r() * (40 + 110 * far) * (r() < 0.06 ? 2.2 : 1);
    const wd = 8 + r() * 16;
    m4.compose(v.set(x, GROUND, z), q.identity(), s.set(wd, hgt, 8 + r() * 16));
    towers.setMatrixAt(i, m4);
    towers.setColorAt(i, col.setHSL(0.07 + r() * 0.05, 0.15 + r() * 0.2, 0.25 + r() * 0.3));
  }
  group.add(towers);
  // The sky: a gradient on a far plane that follows the camera along x.
  const skyTex = own(canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#1f2a48'); grd.addColorStop(0.55, '#b0607a'); grd.addColorStop(0.82, '#ffb36b'); grd.addColorStop(1, '#ffd9a0');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }));
  const sky = new THREE.Mesh(own(new THREE.PlaneGeometry(3000, 700)), own(new THREE.MeshBasicMaterial({ map: skyTex, fog: false, toneMapped: false })));
  sky.position.set(0, 300 + GROUND, -950);
  group.add(sky);
  const sun = new THREE.DirectionalLight('#ffc27a', 0);
  scene.add(sun, sun.target);

  return {
    update(camX, camZ, time) {
      // k: how far the camera is out on the bridge, easing over 30 tiles from each anchorage.
      const k = Math.max(0, Math.min(1, Math.min(camX - (B.x0 - 10), B.x1 + 10 - camX) / 30));
      group.visible = camX > B.x0 - 160 && camX < B.x1 + 160;
      scene.background.lerpColors(DARK, SKY, k);
      scene.fog.color.lerpColors(DARK, HAZE, k);
      scene.fog.near = 16 + (80 - 16) * k;
      scene.fog.far = 34 + (900 - 34) * k;
      sun.intensity = 2.6 * k;
      sun.position.set(camX - 220, 70, 420);
      sun.target.position.set(camX, LEVEL.track, 9.5);
      sky.position.x = camX;
      nearSteel.opacity = camZ > 19.2 ? 0.25 : 1; // the south truss fades when it's between the camera and you
      nearSteel.depthWrite = nearSteel.opacity > 0.95;
      if (!reducedMotion) water.map.offset.y = (time * 0.01) % 1;
      return k;
    },
    dispose() {
      group.removeFromParent(); sun.removeFromParent(); sun.target.removeFromParent();
      for (const o of owned) o.dispose?.();
    },
  };
}
```

- [ ] **Step 2: `src/rpg/index.js`.** Import `createBridge`; `bridge = createBridge(scene, { reducedMotion });` (dispose
  in `teardown`). In the frame, before the stations:
  `const sunK = bridge.update(camX, o.z + eyeFor(cam).z, t);` and pass `sun: sunK > 0 ? 1 : 0` in the
  `trainView.update` context (the shafts use `sunAt` per window; this only turns them off when the camera is
  nowhere near). The station-built fog must be the same `THREE.Fog` object the bridge lerps: Task 6 made it in
  `index.js`, so `scene.fog` is it. Hook: `env: () => ({ bridge: sunK })`.

- [ ] **Step 3: Look at it.** Add to `e2e/station.mjs`:

```js
  await check('on the bridge: the skyline, the sky, sun shafts through the windows; the camera pulled back', async () => {
    await page.evaluate(() => { window.__station.setTime(20 + 18 + 28); window.__station.board(0, 30, 0); }); // mid-bridge
    await nFrames(page, 90); // the camera's zoom spring settles
    const env = await page.evaluate(() => window.__station.env());
    assert.ok(env.bridge > 0.9, JSON.stringify(env));
    await page.screenshot({ path: 'e2e/shots/station-bridge.png' });
  });
```
Run: `E2E_ANGLE=swiftshader ONLY='bridge' node e2e/station.mjs`. Look at `e2e/shots/station-bridge.png`: the car
open from above, a warm sky and a city of towers to the north behind the truss, bright bands of sun across the
floor and benches, cut by the truss. If the shafts are too weak or too strong, tune `mat.shaft`'s opacity in
`trainmesh.js`; if the skyline is lost in haze, lower `HAZE`'s share or raise `fog.far`.

- [ ] **Step 4: Commit**

```bash
git add src/rpg/bridge.js src/rpg/index.js e2e/station.mjs
git commit -m "Subway ride: the bridge at golden hour: truss, towers, river, skyline, sky and sun"
```

---

### Task 11: Riders aboard

**Files:**
- Modify: `src/rpg/life.js`, `src/rpg/index.js`
- Test: `test/station-life.test.js` (add)

**Interfaces:**
- Consumes: `SEATS`, `POLES`, `CAR` (Task 3); `TRAIN` (Task 1); `rng` (life.js).
- Produces: `ridersFor(k)` → `[{ seat (index or null), x, z, yaw, sit (0|1), hold (0|1), phone, color }]` in the
  train's frame, the same for the same k; `RIDERS = { perCar: [2, 3], colors }`.

- [ ] **Step 1: Write the failing test** (add to `test/station-life.test.js`):

```js
test('riders aboard a local: two or three a car, seeded by its number, seated on real seats or holding a pole', async () => {
  const { ridersFor } = await import('../src/rpg/life.js');
  const { SEATS, POLES, trainSolid } = await import('../src/rpg/car.js');
  const a = ridersFor(12), b = ridersFor(12), c = ridersFor(13);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.length >= 10 && a.length <= 15);
  const seats = a.filter((r) => r.seat != null).map((r) => r.seat);
  assert.equal(new Set(seats).size, seats.length, 'no two on one seat');
  for (const r of a) {
    if (r.seat != null) { assert.equal(r.sit, 1); assert.deepEqual([r.x, r.z], [SEATS[r.seat].x, SEATS[r.seat].z]); }
    else { assert.equal(r.hold, 1); assert.ok(!trainSolid(r.x, r.z), 'standing in the aisle'); assert.ok(POLES.some((p) => Math.hypot(p.x - r.x, p.z - r.z) < 0.5)); }
  }
});
```

- [ ] **Step 2: Run it to see it fail**: `node --test test/station-life.test.js` → FAIL (`ridersFor` missing).

- [ ] **Step 3: `src/rpg/life.js`.** Add `import { SEATS, POLES } from './car.js';` and `import { TRAIN } from './schedule.js';`, then:

```js
// Riders aboard a local (subway ride spec §4): two or three a car, most seated, one holding a pole, some on their
// phones. Seeded by the local's number, so every player sees the same people on the same train. In the train's frame.
export const RIDERS = { perCar: [2, 3], colors: ['#7d8595', '#949aa6', '#5f9e9a', '#a5605a', '#8a7f6a', '#6a6f9e'] };
export function ridersFor(k) {
  const r = rng(1000 + k), out = [], used = new Set();
  for (let c = 0; c < TRAIN.cars; c++) {
    const seats = SEATS.filter((s) => s.car === c), n = RIDERS.perCar[0] + Math.floor(r() * (RIDERS.perCar[1] - RIDERS.perCar[0] + 1));
    for (let i = 0; i < n; i++) {
      const color = RIDERS.colors[Math.floor(r() * RIDERS.colors.length)], phone = r() < 0.3;
      if (i < n - 1) {
        let s = seats[Math.floor(r() * seats.length)];
        for (let g = 0; used.has(s.i) && g < seats.length; g++) s = seats[(seats.indexOf(s) + 1) % seats.length];
        if (used.has(s.i)) continue;
        used.add(s.i);
        out.push({ seat: s.i, x: s.x, z: s.z, yaw: s.yaw, sit: 1, hold: 0, phone, color });
      } else {
        const p = POLES[c * 3 + Math.floor(r() * 3)], side = r() < 0.5 ? -1 : 1;
        out.push({ seat: null, x: p.x + 0.3 * side, z: p.z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, sit: 0, hold: 1, phone: false, color });
      }
    }
  }
  return out;
}
```
(Check there's no import cycle: `car.js` imports `schedule.js`, `map.js`, `move.js`; none of them import `life.js`.)

- [ ] **Step 4: Run it**: `node --test test/station-life.test.js` → PASS.

- [ ] **Step 5: `src/rpg/index.js`: draw them.** A pool of figures for the riders on the locals nearest the camera:

```js
    // Riders aboard (life.js): figures from a pool, on the locals nearest the camera (yours first).
    const RIDER_FIGS = 18, riderFigs = [];
    const ridersCache = new Map();
    const riders = (k) => { if (!ridersCache.has(k)) { if (ridersCache.size > 8) ridersCache.clear(); ridersCache.set(k, ridersFor(k)); } return ridersCache.get(k); };
```
In the frame, after `trainView.update(…)`:

```js
      let fi = 0;
      const locals = trains.filter((l) => l.kind === 'local' && Math.min(Math.abs(l.head - wx), Math.abs(l.tail - wx)) < 60).sort((a, b) => (mine && a.k === mine.k ? -1 : mine && b.k === mine.k ? 1 : 0));
      for (const l of locals) {
        const to = trainOrigin(l);
        for (const rd of riders(l.k)) {
          if (fi >= RIDER_FIGS) break;
          if (!riderFigs[fi]) riderFigs[fi] = { figure: createFigure(scene, { glow: false, color: rd.color, lantern: false, phone: rd.phone }), joints: {}, at: { x: 0, y: 0, z: 0 } };
          const p = riderFigs[fi++];
          p.figure.setVisible?.(true);
          poseFigure({ yaw: rd.yaw, sit: rd.sit, hold: rd.hold, phone: rd.phone, t: t + rd.x, reducedMotion, gait: 0, phase: 0, shift: 0 }, p.joints);
          p.at.x = to.x + rd.x; p.at.y = LEVEL.platform; p.at.z = to.z + rd.z;
          p.figure.update(p.joints, camera, p.at);
        }
      }
      for (let j = fi; j < riderFigs.length; j++) riderFigs[j].figure.setVisible?.(false);
```
`figure.js` has no `setVisible`: its quads are added to the scene one by one and kept in `meshes`. Add to the
object `createFigure` returns: `setVisible(on) { for (const o of meshes) o.visible = on; },` (and drop the `?.` in
the two calls above). Dispose the pool in
`teardown`. Replace `const taken = () => new Set();` with
`const taken = () => { const k = rider.frame.kind === 'train' ? rider.frame.k : localsAt(clock()).find((l) => l.at === rider.frame.stop)?.k; return new Set(k == null ? [] : riders(k).filter((r) => r.seat != null).map((r) => r.seat)); };`
Import `ridersFor` from `life.js`, `poseFigure` from `rig.js`, `createFigure` is already imported.

- [ ] **Step 6: Look.** Re-run the tunnel and bridge e2e checks; the screenshots now show people seated along the
  benches and one holding a pole in each car.

- [ ] **Step 7: Commit**

```bash
git add src/rpg/life.js src/rpg/index.js src/rpg/figure.js test/station-life.test.js
git commit -m "Subway ride: riders aboard each local, seated or holding a pole, the same for everyone"
```

---

### Task 12: Sound

**Files:**
- Modify: `src/rpg/sound.js`, `src/rpg/audio.js`, `src/rpg/index.js`
- Test: `test/station-sound.test.js`

**Interfaces:**
- Consumes: `trainsAt`, `local`, `DOORS`, `LOCAL`, `arrivalAtStop`, `TRAIN` (Task 1); `PITCH` (Task 3); `sunAt` (Task 1).
- Produces (`sound.js`): `trainNoise(trains, me, { inHall })` → `{ rumble, roar, screech, wind, pan, muffle, id }`
  (the loudest train, as `trainSound` was); `rideNoise(tr, x)` → `{ motor, pitch, bridge, brake }`; `AXLES` (the new
  train's axles back from its nose); `knocks(h0, h1, dir)` (unchanged signature); `doorEvents(t0, t1, stop)` →
  `[{ k, kind: 'open'|'chime' }]`; `announcementAt(k, busy)`, `announcementsBetween(t0, t1, busy)` with
  `busy(t) → bool`. `trainSound` goes. `audio.update({ …, trains, me, ride, stop })`.

- [ ] **Step 1: Write the failing tests.** In `test/station-sound.test.js`, delete the import from `train.js`
  (`startOf, TRAIN, LENGTH`) and the `travel` constant, and replace the tests of `trainSound`, `AXLES`/`knocks` and
  `announcementAt`/`announcementsBetween` (they test the old passing train) with:

```js
import { trainNoise, rideNoise, AXLES, knocks, JOINT, doorEvents, announcementAt, announcementsBetween, ANNOUNCE } from '../src/rpg/sound.js';
import { trainsAt, local, arrivalAt, arrivalAtStop, DOORS, LENGTH, TRAIN } from '../src/rpg/schedule.js';

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
```
Keep the file's other tests (footfalls, surfaces, drips, tubes, stairs music, rotor clicks).

- [ ] **Step 2: Run them to see them fail**: `node --test test/station-sound.test.js` → FAIL (new exports missing).

- [ ] **Step 3: `src/rpg/sound.js`.** Replace the import of `train.js` with
  `import { TRAIN, LENGTH, LOCAL, DOORS, localsAt, arrivalAtStop } from './schedule.js';` and `import { sunAt } from './line.js';`,
  add `import { PITCH } from './car.js';`. Replace the whole "── The train ──" section (from `TRAIN_SOUND` through
  `knocks`) and the announcements' schedule with:

```js
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
```
(keep the existing `knocks(h0, h1, dir)` body; it reads `AXLES` and `JOINT`). Then the door events and the
announcements:

```js
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
```
and in `announcementAt(k, map)` → `announcementAt(k, busy)`: replace the loop over `startOf(n)` with

```js
  for (let guard = 0; guard < 40 && busy && (busy(at) || busy(at + ANNOUNCE.dur)); guard++) at += 2;
  return at;
```
and `announcementsBetween(t0, t1, busy)` passes `busy` through.

- [ ] **Step 4: `src/rpg/audio.js`.** The train layers take `trainNoise`; riding adds a motor and the bridge's ring;
  doors chime. Changes:
  1. Imports: `trainSound` → `trainNoise, rideNoise, doorEvents`.
  2. `update({ t, dt, walker, pose, gates, train, … })` → `update({ t, dt, walker, pose, gates, trains, me, ride, stop, … })`
     where `me` is your world `{ x, y, z }`, `ride` your local (or null), `stop` the station you're in (or null).
     Replace `const ts = trainSound(t, map, me);` with
     `const ts = trainNoise(trains, me, { inHall: stop === 0 && me.y > (LEVEL.hall + LEVEL.platform) / 2 });`
     and the clatter's `train.phase === 'pass'`/`train.n` with the loudest train (`ts.id`, its head from `trains`).
     While riding, the clatter is your own train's axles: `knocks(lastHead, ride.head, ride.dir)` played at you
     (no `x, y, z`, so not spatial).
  3. The motor: a voice on the train bus: a sawtooth through a low-pass, its frequency `ride ? rn.pitch : 70`, its
     gain `ride ? 0.22 * rn.motor : 0` (`const rn = ride && rideNoise(ride, me.x)`), set with `setTargetAtTime`
     like the rumble's. The bridge's ring: band-passed noise at 1200 Hz, gain `0.12 * (rn?.bridge || 0)`. The brake
     hiss: high-passed noise (3 kHz), gain `0.18 * (rn?.brake || 0)`. Build these three with the existing `voice(…)`
     and `loopSrc(noise, …)` helpers, next to `rumble`/`roar`/`wind`.
  4. Doors: `for (const ev of doorEvents(lastT, t2, stopForDoors))` where `t2` is the train clock (pass it in
     as `trainT`) and `stopForDoors` is your station, or your train's stop when it stands: on `'chime'` play
     the two-tone (`tone(698, { dur: 0.32, gain: 0.07, decay: true }); tone(554, { at: 0.34, dur: 0.5, gain: 0.07, decay: true });`),
     on `'open'` a door slide (noise burst through a band-pass at 900 Hz, 0.6 s, gain 0.05).
  5. Announcements: `announcementsBetween(lastT, t, busy)` with
     `busy = (s) => trainsAt(s).some((tr) => Math.abs((tr.head + tr.tail) / 2 - STOPS[0].centre) < 70)` (import
     `trainsAt` and `STOPS`). On a train, the announcement text is the cab's LED (trainmesh shows it); play only
     the chime tones.
  6. `audio.state()` keeps its fields; add `motor` and `bridge` gains for tests.

- [ ] **Step 5: `src/rpg/index.js`.** Pass the new fields:
  `audio.update({ t, dt, walker, pose, gates, trains, trainT: tt, me: feet, ride: mine, stop: f.kind === 'station' ? f.stop : mine?.at ?? null, pigeons: stations[0]?.pigeons ?? [], rats: stations[0]?.rats ?? [], people });`

- [ ] **Step 6: Run the tests**: `node --test test/station-sound.test.js` → PASS. Then
  `E2E_ANGLE=swiftshader ONLY='sound|silent' node e2e/station.mjs` → PASS (the station still sounds only after a key).

- [ ] **Step 7: Commit**

```bash
git add src/rpg/sound.js src/rpg/audio.js src/rpg/index.js test/station-sound.test.js
git commit -m "Subway ride: sound from the schedule: brakes, the door chime, the motor, the clatter, the bridge's ring"
```

---

### Task 13: Multiplayer: positions aboard a train

**Files:**
- Modify: `server/rules.js`, `server/gallery.js`, `src/rpg/peers3d.js`, `src/live.js`, `src/rpg/others.js`, `src/rpg/index.js`
- Test: `test/station-peers.test.js`, `test/rules.test.js`, `server/test/server.test.js`

**Interfaces:**
- Consumes: `LINE`, `STOPS` (Task 1); `LENGTH` (Task 1); `CAR` (Task 3); `local`, `trainOrigin`.
- Produces: the wire form of a station position: on the ground `{ x, z, y?, a? }` in line coordinates (x from −600 to
  1486, z 0…19); aboard `{ tr, x, z, a?, s? }`: `tr` a local's number (an integer −10…3000), `x` 0…78 and `z` −1.5…1.5
  in its frame, `s` 1 when seated. `server/rules.js` `STATION = { x0: -600, x1: 1486, rows: 19, yMin: -5, yMax: 1, length: 78, half: 1.5, k: [-10, 3000] }`.
  `peers3d.list()` entries carry `tr` and `s` when aboard. `others.update(list, …)` draws an entry at
  `(p.x + (p.ox || 0), p.z + (p.oz || 0))`, seated when `p.s`.

- [ ] **Step 1: Write the failing tests.** `test/rules.test.js`: in the existing test "areas: … inside the map", the
  bad position `'{"t":"q","x":-1,"z":1}'` is now on the line (the west tunnel); change it to
  `'{"t":"q","x":-700,"z":1}'`. Then add:

```js
test('station positions: anywhere on the line, or aboard a local in its frame', () => {
  assert.deepEqual(parseMessage('{"t":"q","x":850.5,"z":9.5}'), { t: 'q', x: 850.5, z: 9.5 }, 'CANAL ST is on the line');
  assert.equal(parseMessage('{"t":"q","x":2000,"z":9.5}'), null);
  assert.deepEqual(parseMessage('{"t":"q","tr":14,"x":30.123,"z":-0.5,"a":1,"s":1}'), { t: 'q', tr: 14, x: 30.12, z: -0.5, a: 1, s: 1 });
  assert.equal(parseMessage('{"t":"q","tr":14,"x":90,"z":0}'), null, 'off the end of the train');
  assert.equal(parseMessage('{"t":"q","tr":14,"x":30,"z":2}'), null, 'outside its width');
  assert.equal(parseMessage('{"t":"q","tr":1.5,"x":30,"z":0}'), null, 'a local is a whole number');
  assert.equal(parseMessage('{"t":"q","tr":14,"x":30,"z":0,"s":2}'), null);
  assert.deepEqual(parseMessage('{"t":"q","x":10.5,"z":9.5,"y":0,"a":1}'), { t: 'q', x: 10.5, z: 9.5, y: 0, a: 1 }, 'an old page is fine');
});
```
`test/station-peers.test.js`: replace the `[STATION.cols, STATION.rows]` assertion (line ~96) with
`assert.deepEqual([STATION.x0, STATION.x1, STATION.rows, STATION.length], [LINE.x0, LINE.x1, map.rows, LENGTH]);`
(import `LINE` from `line.js` and `LENGTH` from `schedule.js`), and add:

```js
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
```
In `server/test/server.test.js`, near the station tests (around line 661), add:

```js
test('station: a rider\'s position aboard is relayed with its train', async () => {
  const r = room();
  const s1 = await joined(r, 'Sta', { area: 'station', x: 10, z: 9.5 });
  const s2 = await joined(r, 'Tia', { area: 'station' });
  s1.send2({ t: 'q', tr: 7, x: 30.004, z: -0.25, a: 0.5, s: 1 });
  assert.deepEqual(await s2.next('q'), { t: 'q', id: s1.id, tr: 7, x: 30, z: -0.25, a: 0.5, s: 1 });
});
```
(`room()` and `joined(r, name, opts)` are the file's own helpers, as the station test above it uses them.)

- [ ] **Step 2: Run them to see them fail**:
  `node --test test/rules.test.js test/station-peers.test.js && (cd server && npm test)` → the new tests FAIL.
  (About 10 server tests fail on `main` already; HANDOFF lists them. Only the new one matters here.)

- [ ] **Step 3: `server/rules.js`.** Replace `STATION` and `stationPos`:

```js
// The line below the museum (subway ride spec §7; src/rpg/line.js): x from the west tunnel to the east one, z across the
// stations' maps, how far floors go up and down; and a local's floor plan, for someone aboard one (src/rpg/car.js). A
// position outside them is dropped. test/station-peers.test.js checks these against the line.
export const STATION = { x0: -600, x1: 1486, rows: 19, yMin: -5, yMax: 1, length: 78, half: 1.5, k: [-10, 3000] };
// A station position, each number to 0.01: on the ground, x and z on the line, y (the floor under you) and yaw a, y
// and a optional; or aboard local tr, x and z in its frame, a, and s (1 seated). null if anything is off.
function stationPos(m) {
  const p = {};
  if (m.tr !== undefined) {
    if (!Number.isInteger(m.tr) || m.tr < STATION.k[0] || m.tr > STATION.k[1]) return null;
    if (!num(m.x) || !num(m.z) || m.x < 0 || m.x > STATION.length || Math.abs(m.z) > STATION.half) return null;
    p.tr = m.tr;
    if (m.s !== undefined) { if (m.s !== 0 && m.s !== 1) return null; }
  } else if (!num(m.x) || !num(m.z) || m.x < STATION.x0 || m.x > STATION.x1 || m.z < 0 || m.z > STATION.rows) return null;
  p.x = round(m.x, 100); p.z = round(m.z, 100);
  if (m.y !== undefined && m.tr === undefined) { if (!num(m.y) || m.y < STATION.yMin || m.y > STATION.yMax) return null; p.y = round(m.y, 100); }
  if (m.a !== undefined) { if (!within(m.a, Math.PI + 1e-9)) return null; p.a = round(m.a, 100); }
  if (m.tr !== undefined && m.s !== undefined) p.s = m.s;
  return p;
}
```
The key order matters for `deepEqual` in the tests above: `tr, x, z, a, s` aboard; `x, z, y, a` on the ground. If
the test's expected object has a different order, `deepStrictEqual` still passes (key order doesn't matter to it).

- [ ] **Step 4: `server/gallery.js`.** Where it stores a station position (`me.sp = { x: m.x, z: m.z, … }`, at the
  `hi`/`z` handling and the `q` handling, around lines 139 and 170), store the parsed message's fields whole:
  `me.sp = { x: m.x, z: m.z, ...(m.y !== undefined && { y: m.y }), ...(m.a !== undefined && { a: m.a }), ...(m.tr !== undefined && { tr: m.tr }), ...(m.s !== undefined && { s: m.s }) };`
  and check the relay of `q` to others sends `tr` and `s` (it spreads the parsed message, or lists fields: if it
  lists them, add `tr` and `s`).

- [ ] **Step 5: `src/rpg/peers3d.js`.** In `push`, carry `tr` and `s`, and start a new track when the frame changes:

```js
function push(p, m, now) {
  const pt = { t: now, x: m.x, z: m.z, y: Number.isFinite(m.y) ? m.y : null, a: Number.isFinite(m.a) ? m.a : null, tr: Number.isInteger(m.tr) ? m.tr : null, s: m.s ? 1 : 0 };
  const last = p.track.at(-1);
  if (!last || last.tr !== pt.tr || Math.hypot(pt.x - last.x, pt.z - last.z) > REMOTE.jump) { p.track = [pt]; return; }
  p.track.push(pt);
  if (p.track.length > REMOTE.keep) p.track.shift();
}
```
`sampleTrack` returns `tr` and `s` from the later point (add `tr: b.tr, s: b.s` to its blended result; the
copies of the first/last point carry them already). `list()` adds `tr: s.tr, s: s.s` to each entry. `wirePos`:

```js
export function wirePos({ x, z, y, a, tr, s }) {
  const o = Number.isInteger(tr) ? { tr, x: q(x), z: q(z) } : { x: q(x), z: q(z) };
  if (Number.isFinite(y) && !Number.isInteger(tr)) o.y = q(y);
  if (Number.isFinite(a)) { const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)); o.a = Math.max(-3.14, Math.min(3.14, q(w))); }
  if (Number.isInteger(tr) && s !== undefined) o.s = s ? 1 : 0;
  return o;
}
```

- [ ] **Step 6: `src/live.js`.** In `stationTicker`, send when the frame or seat changes too: the unchanged test becomes
  `if (sent && sent.tr === w.tr && sent.s === w.s && sent.x === w.x && …) return;`.

- [ ] **Step 7: `src/rpg/others.js`.** In `update`, after `stepRemote(o.r, p, dt);` (which walks the figure in its
  frame, so a rider's stride follows their steps, not the train's speed):

```js
        poseFigure({ yaw: o.r.yaw, phase: o.r.phase, gait: p.s ? 0 : o.r.gait, sit: p.s ? 1 : 0, t: t + (p.id.charCodeAt(0) % 7), reducedMotion }, o.joints);
        o.at.x = o.r.x + (p.ox || 0); o.at.z = o.r.z + (p.oz || 0); o.at.y = p.y ?? map.levelAt(o.at.x, o.at.z) ?? 0;
```
(replacing its existing `poseFigure` and `o.at` lines).

- [ ] **Step 8: `src/rpg/index.js`.** What you send: `pos()` (and `mp.tick`) become

```js
      pos: () => (rider.frame.kind === 'train'
        ? { tr: rider.frame.k, x: walker.x, z: walker.z, a: pose.yaw, s: rider.seat ? 1 : 0 }
        : { x: feet.x, z: feet.z, y: feet.y, a: pose.yaw }),
```
and the tick in the frame: `mp.tick(rider.frame.kind === 'train' ? { tr: rider.frame.k, x: walker.x, z: walker.z, a: pose.yaw, s: rider.seat ? 1 : 0 } : { x: feet.x, z: feet.z, y: feet.y, a: pose.yaw });`.
What you draw: before `others.update(mp.list(now), …)`, place riders in their trains:

```js
        const list = mp.list(now).map((p) => {
          if (p.tr == null) return p;
          const o2 = trainOrigin(local(p.tr, tt));
          return { ...p, ox: o2.x, oz: o2.z, y: LEVEL.platform };
        });
        others.update(list, now, dt, t, camera, feet);
```
`others.js`'s `levelAt` for ground peers reads `map` (MUSEUM's): a peer at CANAL ST (x > 794) gets `y` from their own
message, which every ground position carries, so it's right; leave it.

- [ ] **Step 9: Run the tests**: `node --test test/rules.test.js test/station-peers.test.js test/live.test.js && (cd server && npm test)`
  → the new tests PASS; server failures only those HANDOFF lists.

- [ ] **Step 10: Commit** (this changes `server/`: pushing it to `main` deploys the Worker; ask Faiz first)

```bash
git add server/rules.js server/gallery.js server/test/server.test.js src/rpg/peers3d.js src/live.js src/rpg/others.js src/rpg/index.js test/rules.test.js test/station-peers.test.js
git commit -m "Subway ride: multiplayer: positions anywhere on the line, or aboard a local in its frame"
```

---

### Task 14: End to end: ride it, watch someone leave, measure it

**Files:**
- Modify: `e2e/station.mjs`, `e2e/station-mp.mjs`, `src/rpg/index.js` (a frame-time hook)

- [ ] **Step 1: A frame-time hook.** In `index.js`'s `frame`, time the JavaScript of each frame:
  `const f0 = performance.now();` at the top (after the hidden check) and, at the end,
  `cpu[frames % 60] = performance.now() - f0;` with `const cpu = new Float32Array(60);`. Hook:
  `perf: () => ({ cpu: cpu.reduce((a, b) => a + b, 0) / 60 })`. (Headless Chrome caps at 30 fps and SwiftShader
  draws on the CPU, so e2e can only budget the script; the 60 fps check on a real GPU is by hand, Step 5.)

- [ ] **Step 2: `e2e/station.mjs`.** Replace "a train comes out of the tunnel and passes" with:

```js
  await check('an express comes out of the tunnel and passes MUSEUM', async () => {
    const T = await page.evaluate(() => {
      for (let s = 0; s < 120; s += 0.25) { window.__station.setTime(s); if (window.__station.trains().some((x) => x.kind === 'express' && Math.min(x.head, x.tail) < 60 && Math.max(x.head, x.tail) > 60)) return s; }
      return null;
    });
    assert.notEqual(T, null);
    await nFrames(page, 10);
    await page.screenshot({ path: 'e2e/shots/station-express.png' });
  });
```
and add the ride (after the bridge check from Task 10):

```js
  await check('the whole ride: walk on at MUSEUM, the doors close, ride, sit, get off at CANAL ST', async () => {
    const st = (f) => page.evaluate(f);
    await st(() => { window.__station.setTime(20 + 3); window.__station.teleport(28.5, 6.5); }); // L0 standing; car 0's middle door
    await page.keyboard.down('ArrowUp'); await nFrames(page, 50); await page.keyboard.up('ArrowUp');
    const inside = await st(() => window.__station.world());
    assert.ok(inside.z < 4, `walked into the car: ${JSON.stringify(inside)}`);
    await st(() => window.__station.setTime(20 + 15.2)); // the chime: the doors start closing
    await nFrames(page, 5);
    assert.equal((await st(() => window.__station.aboard()))?.k, 0, 'aboard L0');
    await st(() => window.__station.setTime(20 + 18 + 12)); // riding
    await nFrames(page, 5);
    await page.keyboard.press('e');
    await nFrames(page, 5);
    assert.notEqual((await st(() => window.__station.aboard())).seat, null, 'E sat down');
    await page.keyboard.down('ArrowLeft'); await nFrames(page, 10); await page.keyboard.up('ArrowLeft');
    assert.equal((await st(() => window.__station.aboard())).seat, null, 'a move key stood up');
    await st(() => window.__station.setTime(20 + 75 + 1.1)); // pulling in at CANAL ST: the doors start opening
    await nFrames(page, 5);
    assert.deepEqual(await st(() => window.__station.frame()), { kind: 'station', stop: 1 });
    await nFrames(page, 40);
    await page.screenshot({ path: 'e2e/shots/station-canal.png' });
  });

  await check('staying on past the last stop brings you back on the next train the other way', async () => {
    await page.evaluate(() => { window.__station.setTime(20 + 75 + 18 + 7); window.__station.board(0, 30, 0); });
    await nFrames(page, 5);
    await page.evaluate(() => window.__station.setTime(20 + 75 + 18 + 8.5));
    await nFrames(page, 5);
    const a = await page.evaluate(() => window.__station.aboard());
    assert.equal(a.k % 2, 1, `westbound now: ${JSON.stringify(a)}`);
  });

  await check('frame time: the script stays well inside a 60 fps frame on the platform, in the tunnel and on the bridge', async () => {
    const at = async (setup) => { await page.evaluate(setup); await nFrames(page, 70); return page.evaluate(() => window.__station.perf().cpu); };
    const platform = await at(() => { window.__station.setTime(20 + 5); window.__station.teleport(60, 6.5); });
    const tunnel = await at(() => { window.__station.setTime(20 + 18 + 8); window.__station.board(0, 30, 0); });
    const bridge = await at(() => { window.__station.setTime(20 + 18 + 28); window.__station.board(0, 30, 0); });
    console.log(`  cpu ms/frame: platform ${platform.toFixed(2)}, tunnel ${tunnel.toFixed(2)}, bridge ${bridge.toFixed(2)}`);
    for (const ms of [platform, tunnel, bridge]) assert.ok(ms < 6, `${ms} ms of script a frame`);
  });
```
Before these, `teleport` the player back to MUSEUM's hall at the end (`teleport(6, 9.5)`) so the checks after
(resizing, exit, back button) find you where they expect.

- [ ] **Step 3: `e2e/station-mp.mjs`.** Add, after "the same train for both…" and before "one goes up…" (pages `a`
  and `b` are both in the station then; `others()` reports where each figure is drawn, in world coordinates):

```js
  await check('someone riding away is seen inside the departing train from the platform', async () => {
    // Wait for a local standing at MUSEUM (one every minute on the shared clock).
    await a.waitForFunction(() => window.__station.trains().some((l) => l.kind === 'local' && l.at === 0 && l.doors === 1), { timeout: 70000, polling: 250 });
    const k = await a.evaluate(() => window.__station.trains().find((l) => l.kind === 'local' && l.at === 0).k);
    await a.evaluate((k) => window.__station.board(k, 30, 0), k);
    await b.evaluate(() => window.__station.teleport(60, 6.5));
    await b.waitForFunction((k) => {
      const tr = window.__station.trains().find((l) => l.k === k), me = window.__station.others()[0];
      return tr && me && me.x > Math.min(tr.head, tr.tail) && me.x < Math.max(tr.head, tr.tail);
    }, { timeout: 15000, polling: 100 }, k);
  });
```
Then put `a` back on the platform for the checks after it: `await a.evaluate(() => window.__station.teleport(30.5, 9.5));`.

- [ ] **Step 4: Run them**

Run: `E2E_ANGLE=swiftshader node e2e/station.mjs` and `E2E_ANGLE=swiftshader node e2e/station-mp.mjs`.
Expected: all new checks PASS; the known failures in HANDOFF may still fail. Look at every screenshot in
`e2e/shots/`: `station-local-standing.png`, `station-tunnel.png`, `station-bridge.png`, `station-canal.png`,
`station-express.png`.

- [ ] **Step 5: By hand on a laptop (Faiz's Mac or any machine with a GPU).** `npm run dev`, go down, ride to
  CANAL ST and back, and watch the frame rate (Chrome's DevTools → Rendering → Frame Rendering Stats). Budget: a
  steady 60 fps on the platform, in the tunnel and on the bridge. If the bridge drops frames, halve `TOWERS` in
  `bridge.js` first, then the tube light pool in `scene.js`.

- [ ] **Step 6: Commit**

```bash
git add e2e/station.mjs e2e/station-mp.mjs src/rpg/index.js
git commit -m "Subway ride: e2e: ride MUSEUM to CANAL ST, sit, the turnaround, someone seen leaving, frame time"
```

---

### Task 15: Clean up and hand off

**Files:**
- Modify: `src/rpg/train.js`, `test/station-train.test.js`, `test/station-peers.test.js`, `docs/HANDOFF.md`, `docs/specs/2026-10-16-subway-ride-design.md`

- [ ] **Step 1: `src/rpg/train.js` keeps only the shared clock.** Delete `TRAIN`, `LENGTH`, `hash`, `startOf`, `trainAt`,
  `SERVICE`, `minutes`, `row`, `departures`; keep `PERIOD` (re-exported from `schedule.js`), `sharedTime` and
  `clockOffset`, with the comment above them. `grep -rn "from './train.js'\|rpg/train.js" src test e2e` must find only
  `sharedTime`/`clockOffset`/`PERIOD` imports.
- [ ] **Step 2: Tests.** Delete `test/station-train.test.js` (its schedule is gone; `station-schedule.test.js`
  covers the new one). `test/station-life.test.js` drives pigeons, rats and commuters with the old passing train
  (`trainAt`, `startOf`, `TRAIN`): life.js only needs a train of that shape, so move those three, with `hash` and
  `LENGTH`, verbatim from the old `train.js` into `test/fixtures/passing-train.js` and import them from there
  (`passFor` gives life.js the same shape in the game). `e2e/station.mjs` imported `startOf` for the check Task 14
  replaced: delete that import. In `test/station-peers.test.js`, the clock test's "the same epoch gives everyone the same
  train" uses `trainAt`/`startOf`: use `trainsAt` from `schedule.js` instead (the same `sharedTime` gives
  deep-equal `trainsAt` results).
- [ ] **Step 3: Run the changed tests and the whole unit suite once** (this task touches shared code):
  `npm test` → everything passes except the timing check HANDOFF lists.
- [ ] **Step 4: Docs.** In `docs/HANDOFF.md`: under "What exists", a **Subway ride** entry (the line, `line.js`,
  `schedule.js`, `car.js`, `rider.js`, `trainmesh.js`, `tunnel.js`, `bridge.js`, CANAL ST, the hooks `trains`,
  `aboard`, `board`, `frame`, `world`, `env`, `perf`); under "Open items", that CANAL ST's street is the next feature,
  and anything the e2e or the laptop check left open. In the spec, set **Status** to "built" with the date.
- [ ] **Step 5: Commit**

```bash
git add src/rpg/train.js test/station-peers.test.js test/station-life.test.js test/fixtures/passing-train.js e2e/station.mjs docs/HANDOFF.md docs/specs/2026-10-16-subway-ride-design.md
git rm test/station-train.test.js
git commit -m "Subway ride: train.js keeps only the shared clock; handoff notes"
```

- [ ] **Step 6: Review, then ask Faiz before any push to `main`** (it deploys the site and, with `server/` changed,
  the Worker). Use superpowers:requesting-code-review on the whole branch first.
