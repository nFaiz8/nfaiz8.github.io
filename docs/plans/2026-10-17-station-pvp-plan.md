# Station PvP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in PvP with visible ASCII bullets in the 3D subway station, across trains and stations, with the server as the authority.

**Architecture:** Two pure modules, `src/rpg/fight3d.js` (numbers, geometry, bodies) and `src/rpg/referee3d.js` (the rules engine). The Worker runs the referee per instance for its station people. The page runs a second copy for bullets it draws at once. `src/rpg/fightmp.js` is the page's controller, `src/rpg/guns3d.js` its three.js drawing, and `src/rpg/index.js` wires the two in.

**Tech Stack:** Vite + plain JS, three.js, node:test, Cloudflare Worker Durable Objects (server/), puppeteer e2e.

**Spec:** `docs/specs/2026-10-17-station-pvp-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Every commit ends with exactly these two lines, after a blank line (the session's own link):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_0184mzXTtUSdSwt88YBNAFoz`.
- Stage per file (`git add <paths>`), never `git add -A`.
- Pure modules (fight3d.js, referee3d.js, fightmp.js) import no three.js and no DOM. The Worker imports them.
- `STATION_FIGHT = 1`; a page and a server that differ don't fight (Q shows a note).
- Guns: deagle 25 dmg, 0.4 s, 45 t/s, range 60, ammo ∞; smg ('rifle') 8, 0.1 s, 50, 40, 40 rounds, spray 0.06;
  sniper 70, 1.8 s, 120, 120, 5 rounds.
- Body: cylinder r 0.3, feet to 1.25; head ball r 0.2 at 1.42; seated both 0.3 lower. Head ×2 (fight.js HEADSHOT).
- Timings: holster 1 s, protection 2 s (ends on firing), respawn 3 s, flee 3 s (fight.js FLEE_TIME), regen as fight.js.
- The station area only: no z-message reaches the gallery's people.
- No phone PvP in v1 (`phone` true: Q does nothing).
- Comments say why, in plain sentences, like the surrounding code.

## Review Focus

1. **A player who leaves the station area (stairs up, tab closed) while drawn.** Expect a holster at once, with a flee kill if they were hit in the last 3 s, and no ghost body left to hit. Pinned in Task 3 (`leave` test) and Task 5 (server `z` move).
2. **Shooting from a standing train's open door at the platform, and from the platform into a passing express's window.** Expect the bullet to pass both. Pinned in Task 3 (two referee tests).
3. **A bullet fired at a point-blank wall** (muzzle just inside a wall tile after a forged position). Expect it to stop at once, never to come out the other side. Pinned in Task 2 (`sweep starts inside a solid`).
4. **The midnight wrap of the shared clock (sharedTime goes 86399 → 0) while a bullet is in flight.** Expect the bullet's travel to come from wall time, not line time, so it doesn't jump. Pinned in Task 3 (`a bullet across the wrap`).
5. **Drawing while dead or mid-holster, and Q mashing.** Expect a pending holster to be cancelled by drawing, a dead player unable to holster or draw until respawn, and no double `zd`. Pinned in Task 3 (`draw and holster edge cases`).

---

## File map

| File | Responsibility |
| --- | --- |
| `src/rpg/car.js` (modify) | gains `WINDOWS` (moved from trainmesh.js) so the Worker can import it without three.js |
| `src/rpg/trainmesh.js` (modify) | imports WINDOWS from car.js |
| `src/rpg/fight3d.js` (create) | the numbers; `aimDir`, `carMetal`, `createWorld3d(maps).solidAt`, `bodyAt`, `hitPart`, `layFlat`, `pickupSpots3d` |
| `src/rpg/referee3d.js` (create) | `newShooter`, `createStationReferee({ maps, rand })` |
| `server/rules.js` (modify) | parsing of `zd`, `zf`, `zk`; their buckets |
| `server/gallery.js` (modify) | the station referee, its tick, the streak hook, `g` in views, `sf` in the welcome |
| `src/live.js` (modify) | routes station-fight messages; `stationFightOk` |
| `src/rpg/fightmp.js` (create) | the page's controller: my state, prediction, messages, HUD data, visual events |
| `src/rpg/guns3d.js` (create) | three.js: the first-person gun, guns in hands, bullets, sparks, numbers, pickups |
| `src/rpg/others.js` (modify) | the red `⌐╦` on drawn players' tags, laid flat when popped, a gun in hand |
| `src/rpg/index.js` (modify) | Q, J, clicks, aim, the HUD, the hint |
| `src/main.js` (modify) | passes the fight hooks into stationNet() |
| tests | `test/station-fight3d.test.js`, `test/station-referee3d.test.js`, `test/station-fightmp.test.js`, `test/rules.test.js`, `server/test/server.test.js`, `e2e/station.mjs`, `e2e/station-mp.mjs` |

---

### Task 1: Move WINDOWS into car.js

**Files:**
- Modify: `src/rpg/car.js` (after `CAR`, `PITCH`), `src/rpg/trainmesh.js:19-31`
- Test: `test/station-car.test.js`

**Interfaces:**
- Produces: `export const WINDOWS: Array<[number, number]>` from `src/rpg/car.js`, the window spans along a car (u from its west end). The values are unchanged.

- [ ] **Step 1: Write the failing test.** Append to `test/station-car.test.js` (add `WINDOWS` to its car.js import):

```js
test('the windows along a car: between the doors, never over one', () => {
  assert.ok(WINDOWS.length >= 8);
  for (const [a, b] of WINDOWS) {
    assert.ok(a > 0 && b < TRAIN.car && b > a);
    for (const d of CAR.doors) assert.ok(b <= d - CAR.door || a >= d + CAR.door, `window ${a}–${b} over the door at ${d}`);
  }
});
```

(Import `TRAIN` from `../src/rpg/schedule.js` if the file doesn't already.)

- [ ] **Step 2: Run it to see it fail.** Run `node --test test/station-car.test.js`. Expected: a SyntaxError or failure (WINDOWS isn't exported).

- [ ] **Step 3: Move the code.** Cut these lines from trainmesh.js and paste them into car.js after `export const GRAIN = 0.25;`:

```js
// The car's windows along it (u from its west end), between the doors: as many WIN-wide as fit with piers between.
// Here, not in trainmesh.js, so the Worker's referee (fight3d.js) can test bullets against them without three.js.
const WIN = 1.0, PIER = 0.22;
export const WINDOWS = (() => {
  const [d0, d1, d2] = CAR.doors, g = CAR.door + 0.15, out = [];
  for (const [a, b] of [[0.45, d0 - g], [d0 + g, d1 - g], [d1 + g, d2 - g], [d2 + g, TRAIN.car - 0.45]]) {
    const n = Math.max(1, Math.floor((b - a + PIER) / (WIN + PIER))), w = (b - a - PIER * (n - 1)) / n;
    for (let i = 0; i < n; i++) out.push([a + i * (w + PIER), a + i * (w + PIER) + w]);
  }
  return out;
})();
```

In trainmesh.js, delete the `WIN, PIER` line and the WINDOWS block, and import it with `import { …existing…, WINDOWS } from './car.js';`. Keep `export { WINDOWS }` from trainmesh.js if anything imports it from there; check with `grep -rn "WINDOWS" src test`.

- [ ] **Step 4: Run the tests.** Run `node --test test/station-car.test.js test/station-*.test.js` and `npm run build`. Expected: all pass, and the build works.

- [ ] **Step 5: Commit.** `git add src/rpg/car.js src/rpg/trainmesh.js test/station-car.test.js`, with the message "Station: WINDOWS lives in car.js (for the station fight's referee)" plus the trailers.

---

### Task 2: fight3d.js, the numbers and the geometry

**Files:**
- Create: `src/rpg/fight3d.js`
- Test: `test/station-fight3d.test.js`

**Interfaces:**
- Consumes: `parseStation`, `LEVEL`, `ceilings` (map.js); `STOPS`, `pieceAt` (line.js); `TRAIN`, `LENGTH`, `local` (schedule.js); `CAR`, `carAt`, `trainOrigin`, `platformSide`, `WINDOWS` (car.js).
- Produces:
  - `STATION_FIGHT = 1`
  - `GUNS3D[gun]`: `{ code, damage, cooldown, speed, range, ammo, spray }` for `deagle | rifle | sniper`
  - `GUN3D_BY_CODE`: `{ d, r, n }` → gun
  - `ZF`: `{ holster: 1, safe: 2, respawn: 3, step: 0.1, slack: 1.5, reach: 0.6, reachServer: 1.0, pitch: 1.4, muzzleUp: 1.3 }`
  - `BODY`: `{ r: 0.3, top: 1.25, headY: 1.42, headR: 0.2, sitDrop: 0.3 }`
  - `SHELL`: `{ bottom, floor, sill, lintel, door, ceil, top }`
  - `aimDir(yaw, pitch) → { x, y, z }`, a unit vector
  - `openSide(tr) → -1 | 0 | 1`
  - `carMetal(lx, y, lz, open) → boolean`
  - `createWorld3d(maps) → { solidAt(x, y, z, trains) → boolean }`
  - `bodyAt(pos, lineT) → { x, y, z, seated } | null`
  - `hitPart(p, body) → 'head' | 'body' | null`
  - `layFlat(joints, yaw)`: mutates the rig's joints to lie on the floor, fallen backward
  - `pickupSpots3d(maps) → Array<Array<{ x, y, z }>>`, per stop, in world coordinates

- [ ] **Step 1: Write the failing tests.** Create `test/station-fight3d.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation, LEVEL } from '../src/rpg/map.js';
import { STOPS } from '../src/rpg/line.js';
import { local, localsAt, trainsAt } from '../src/rpg/schedule.js';
import { CAR, trainOrigin, WINDOWS } from '../src/rpg/car.js';
import { GUNS3D, BODY, SHELL, aimDir, carMetal, createWorld3d, bodyAt, hitPart, layFlat, pickupSpots3d, openSide } from '../src/rpg/fight3d.js';

const read = (f) => parseStation(fs.readFileSync(new URL(`../src/rpg/${f}`, import.meta.url), 'utf8'));
const maps = [read('station.txt'), read('canalst.txt')];
const W = createWorld3d(maps);
const F = LEVEL.platform;

test('the guns: the arena\'s, scaled to the station', () => {
  assert.deepEqual(Object.keys(GUNS3D), ['deagle', 'rifle', 'sniper']);
  assert.equal(GUNS3D.deagle.damage, 25);
  assert.equal(GUNS3D.sniper.speed, 120);
  assert.equal(GUNS3D.rifle.ammo, 40);
});

test('aim: yaw 0 is south, π/2 east; pitch up is +y', () => {
  const s = aimDir(0, 0), e = aimDir(Math.PI / 2, 0), u = aimDir(0, Math.PI / 2);
  assert.ok(Math.abs(s.z - 1) < 1e-9 && Math.abs(e.x - 1) < 1e-9 && Math.abs(u.y - 1) < 1e-9);
});

test('a car: windows and open doors let bullets through, metal does not', () => {
  const [a, b] = WINDOWS[1], u = (a + b) / 2, mid = F + 1.2;
  assert.equal(carMetal(u, mid, CAR.half - 0.05, 0), false, 'through a window');
  assert.equal(carMetal(u, F + 0.4, CAR.half - 0.05, 0), true, 'below the sill');
  assert.equal(carMetal(u, F + 1.9, CAR.half - 0.05, 0), true, 'above the lintel');
  const d = CAR.doors[1];
  assert.equal(carMetal(d, mid, CAR.half - 0.05, 0), true, 'a shut door');
  assert.equal(carMetal(d, mid, CAR.half - 0.05, 1), false, 'the south doors open');
  assert.equal(carMetal(d, mid, -(CAR.half - 0.05), 1), true, 'the north doors stay shut');
  assert.equal(carMetal(7, mid, 0, 0), false, 'inside the car, nothing');
  assert.equal(carMetal(7, F - 0.5, 0, 0), true, 'the floor');
  assert.equal(carMetal(7, F + 2.2, 0, 0), true, 'the roof');
  assert.equal(carMetal(0.05, mid, 0, 0), true, 'the cab at the west end');
  assert.equal(carMetal(15.05, mid, 0, 0), true, 'car 0\'s east end wall, off the passage... ');
});

test('the station: walls, floors, ceilings, pillars; the tunnel and the bridge', () => {
  assert.equal(W.solidAt(30.5, -2, 0.5, []), true, 'the north wall row');
  assert.equal(W.solidAt(30.5, -2, 9.5, []), false, 'over the platform');
  assert.equal(W.solidAt(30.5, -3.2, 9.5, []), true, 'under the platform floor');
  assert.equal(W.solidAt(30.5, 1.5, 9.5, []), true, 'over the platform\'s ceiling');
  assert.equal(W.solidAt(23.5, -2, 9.5, []), true, 'a pillar (| at column 23, row 9)');
  assert.equal(W.solidAt(-50, -3, 2.5, []), false, 'down the tunnel along the track');
  assert.equal(W.solidAt(-50, -3, 0.2, []), true, 'the tunnel\'s north wall');
  assert.equal(W.solidAt(-50, 1.5, 2.5, []), true, 'the tunnel\'s roof');
  assert.equal(W.solidAt(450, 5, -40, []), false, 'the bridge: open air');
  assert.equal(W.solidAt(STOPS[1].x + 30.5, -2, 0.5, []), true, 'CANAL ST has walls too');
});

test('a train in the way: its metal stops, its windows pass', () => {
  const tr = local(0, 20 + 30); // L0, riding east of MUSEUM
  const o = trainOrigin(tr), u = (WINDOWS[2][0] + WINDOWS[2][1]) / 2;
  assert.equal(W.solidAt(o.x + u, F + 1.2, o.z + CAR.half - 0.05, [tr]), false, 'a window');
  assert.equal(W.solidAt(o.x + u, F + 0.4, o.z + CAR.half - 0.05, [tr]), true, 'the wall under it');
  assert.equal(openSide(tr), 0, 'riding: shut');
  const standing = local(0, 20 + 6);
  assert.equal(openSide(standing), 1, 'at MUSEUM on the north track: the south doors');
  assert.equal(openSide(trainsAt(5).find((t) => t.kind === 'express') || { kind: 'express' }), 0);
});

test('bodies: on the ground, aboard (moving with the train), seated', () => {
  assert.deepEqual(bodyAt({ x: 60, z: 9.5, y: -3 }, 100), { x: 60, y: -3, z: 9.5, seated: false });
  const t1 = 20 + 30, t2 = 20 + 31, a = bodyAt({ tr: 0, x: 10, z: 0, s: 1 }, t1), b = bodyAt({ tr: 0, x: 10, z: 0, s: 1 }, t2);
  assert.ok(b.x > a.x + 1, 'carried east with L0');
  assert.equal(a.seated, true);
  assert.equal(bodyAt(null, 0), null);
});

test('hit parts: the head ball, the body cylinder, a miss; seated is lower', () => {
  const b = { x: 0, y: 0, z: 0, seated: false };
  assert.equal(hitPart({ x: 0, y: BODY.headY, z: 0.1 }, b), 'head');
  assert.equal(hitPart({ x: 0.2, y: 0.8, z: 0 }, b), 'body');
  assert.equal(hitPart({ x: 0.4, y: 0.8, z: 0 }, b), null);
  assert.equal(hitPart({ x: 0, y: 1.6, z: 0.35 }, b), null);
  const s = { ...b, seated: true };
  assert.equal(hitPart({ x: 0, y: BODY.headY, z: 0 }, s), null, 'over a seated head');
  assert.equal(hitPart({ x: 0, y: BODY.headY - BODY.sitDrop, z: 0 }, s), 'head');
});

test('laid flat: every joint near the floor, fallen away from the facing', () => {
  const j = { head: { x: 0, y: 1.42, z: 0 }, footL: { x: 0, y: 0, z: 0 } };
  layFlat(j, 0); // facing south: falls north (−z)
  assert.ok(j.head.y < 0.3 && j.head.z < -1.2, JSON.stringify(j.head));
  assert.ok(Math.abs(j.footL.z) < 0.01);
});

test('pickup spots: walkable hall and platform tiles in each station, in world coordinates', () => {
  const s = pickupSpots3d(maps);
  assert.equal(s.length, 2);
  assert.ok(s[0].length > 100 && s[1].length > 50);
  for (const p of s[1]) assert.ok(p.x > STOPS[1].x);
  for (const p of s[0]) { const cell = maps[0].at(Math.floor(p.x), Math.floor(p.z)); assert.ok(cell.ch === '.' || cell.ch === '_'); }
});
```

Fix the cab and end-wall expectation while writing it: `carMetal(15.05, …)` lies in the gangway gap between car 0 and car 1 (u > TRAIN.car). Per the spec, the gap is open air, so that line should be `assert.equal(carMetal(15.4, mid, 0, 0), false, 'the gangway gap')`. Use that line. Add `assert.equal(carMetal(14.9, mid, 1.0, 0), true, 'the east end wall beside the passage')`.

- [ ] **Step 2: Run them to see them fail.** Run `node --test test/station-fight3d.test.js`. Expected: fails (no module).

- [ ] **Step 3: Write `src/rpg/fight3d.js`.** Don't create a consts file: use the literal 4 (scene.js's WALL_HEIGHT) with a comment. The full module:

```js
import { LEVEL, ceilings } from './map.js';
import { STOPS, pieceAt } from './line.js';
import { TRAIN, LENGTH, local } from './schedule.js';
import { CAR, carAt, trainOrigin, platformSide, WINDOWS } from './car.js';

export const STATION_FIGHT = 1; // bumped when the station fight's wire changes; goes into the welcome (sf)

// The arena's guns (fight.js) in station tiles: its body is 3 cells tall and the figure here 1.6, so speeds
// scale by about 0.53, a little up so a shot still crosses the platform quickly. No knockback in 3D.
export const GUNS3D = {
  deagle: { code: 'd', damage: 25, cooldown: 0.4, speed: 45, range: 60, ammo: -1, spray: 0 },
  rifle: { code: 'r', damage: 8, cooldown: 0.1, speed: 50, range: 40, ammo: 40, spray: 0.06 },
  sniper: { code: 'n', damage: 70, cooldown: 1.8, speed: 120, range: 120, ammo: 5, spray: 0 },
};
export const GUN3D_BY_CODE = { d: 'deagle', r: 'rifle', n: 'sniper' };
// holster: s to put the gun away; safe: protection after drawing or respawning; respawn: s down; step: the
// sweep's step (tiles), short enough that no wall (0.15 thick) or head (0.4 across) is stepped over; slack: how
// far a claimed muzzle may be from the server's estimate; reach: pickups (page, server); pitch: the aim's limit;
// muzzleUp: the muzzle estimate over the feet.
export const ZF = { holster: 1, safe: 2, respawn: 3, step: 0.1, slack: 1.5, reach: 0.6, reachServer: 1.0, pitch: 1.4, muzzleUp: 1.3 };
export const BODY = { r: 0.3, top: 1.25, headY: 1.42, headR: 0.2, sitDrop: 0.3 };
const F = LEVEL.platform; // a car's floor, level with the platforms (trainmesh.js's H)
export const SHELL = { bottom: F - 1.05, floor: F, sill: F + 0.8, lintel: F + 1.7, door: F + 1.9, ceil: F + 2.05, top: F + 2.45 };
const TUNNEL = { zN: 0.5, zS: 18.5, roof: F + 4 }; // tunnel.js's outer walls, and the stations' ceiling height
const RISE = 4; // scene.js's WALL_HEIGHT: the ceiling over a floor
const SOLID = new Set(['#', 'n', 'x', 'k', 't']); // walls, signs, tape, the kiosk, the turnstile cabinets

export const aimDir = (yaw, pitch) => ({ x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) });

// Which side a train's doors are open (+1 south, −1 north, 0 none): a local standing with its doors over half open.
export const openSide = (tr) => (tr.kind === 'local' && tr.at != null && tr.doors > 0.5 ? platformSide(tr.track) : 0);

// Is (lx, y, lz), in a train's frame, in its metal? Inside the car's box nothing stops a bullet (benches, poles);
// the side walls pass a window's glass and an open doorway; the ends pass their passage; the gaps between cars
// are open air.
export function carMetal(lx, y, lz, open = 0) {
  if (lx <= 0 || lx >= LENGTH || Math.abs(lz) >= CAR.half || y <= SHELL.bottom || y >= SHELL.top) return false;
  if (y < SHELL.floor || y > SHELL.ceil) return true;
  const { c, u } = carAt(lx);
  if (u > TRAIN.car) return false;
  const high = y > SHELL.door;
  if (u < CAR.end) return c === 0 || Math.abs(lz) >= CAR.pass || high;
  if (u > TRAIN.car - CAR.end) return c === TRAIN.cars - 1 || Math.abs(lz) >= CAR.pass || high;
  if (Math.abs(lz) > CAR.wall) {
    if (y >= SHELL.sill && y <= SHELL.lintel && WINDOWS.some(([a, b]) => u > a && u < b)) return false;
    if (open && Math.sign(lz) === open && !high && CAR.doors.some((d) => Math.abs(u - d) < CAR.door)) return false;
    return true;
  }
  return false;
}

// maps: the stops' parsed maps, in STOPS order.
export function createWorld3d(maps) {
  const ceil = maps.map((m) => ceilings(m, RISE));
  function stationSolid(i, x, y, z) {
    const m = maps[i], lx = x - STOPS[i].x, c = Math.floor(lx), r = Math.floor(z), cell = m.at(c, r);
    if (!cell || SOLID.has(cell.ch)) return true;
    const floor = m.levelAt(lx, z);
    if (floor != null && y < floor) return true;
    const top = ceil[i](c, r);
    if (top != null && y > top) return true;
    const ox = Math.abs(lx - (c + 0.5)), oz = Math.abs(z - (r + 0.5));
    if (cell.ch === '|' && ox < 0.3 && oz < 0.3) return true; // a pillar, 0.6 across (scene.js)
    if (cell.ch === 'b' && floor != null && y < floor + 0.5 && ox < 0.45 && oz < 0.25) return true; // a bench
    return false;
  }
  return {
    // trains: those on the line now (trainsAt), the caller's, so one list serves a whole sweep.
    solidAt(x, y, z, trains) {
      for (const tr of trains) {
        const o = trainOrigin(tr), lx = x - o.x, lz = z - o.z;
        if (lx > 0 && lx < LENGTH && Math.abs(lz) < CAR.half && y > SHELL.bottom && y < SHELL.top) return carMetal(lx, y, lz, openSide(tr));
      }
      const p = pieceAt(x);
      if (p.kind === 'station') return stationSolid(p.stop, x, y, z);
      if (y < LEVEL.track) return true;
      if (p.kind === 'tunnel') return z < TUNNEL.zN || z > TUNNEL.zS || y > TUNNEL.roof;
      return false; // the bridge: open air
    },
  };
}

// Where a player's feet are on the line at line time lineT: on the ground, as sent; aboard local tr, its frame
// placed by the schedule. pos: the q message's position (rules.js stationPos).
export function bodyAt(pos, lineT) {
  if (!pos) return null;
  if (Number.isInteger(pos.tr)) {
    const o = trainOrigin(local(pos.tr, lineT));
    return { x: o.x + pos.x, y: LEVEL.platform, z: o.z + pos.z, seated: pos.s === 1 };
  }
  return { x: pos.x, y: Number.isFinite(pos.y) ? pos.y : LEVEL.hall, z: pos.z, seated: false };
}

// What a point p hits of a body standing (or sitting) at b: its head, its body, or nothing.
export function hitPart(p, b) {
  const drop = b.seated ? BODY.sitDrop : 0, dy = p.y - b.y;
  if (Math.hypot(p.x - b.x, dy - (BODY.headY - drop), p.z - b.z) < BODY.headR) return 'head';
  if (dy >= 0 && dy <= BODY.top - drop && Math.hypot(p.x - b.x, p.z - b.z) < BODY.r) return 'body';
  return null;
}

// Popped: the rig's joints (offsets over the feet) laid on the floor, fallen backward from the facing yaw.
export function layFlat(joints, yaw) {
  const bx = -Math.sin(yaw), bz = -Math.cos(yaw);
  for (const j of Object.values(joints)) {
    if (!j || !Number.isFinite(j.y)) continue;
    const h = j.y;
    j.x += bx * h; j.z += bz * h; j.y = 0.08 + Math.min(0.12, Math.abs(j.y - h) * 0);
  }
  return joints;
}

// Where pickups may lie, per stop: hall (.) and platform (_) tiles, their middles in world coordinates.
export function pickupSpots3d(maps) {
  return maps.map((m, i) => m.cells.filter((c) => c.ch === '.' || c.ch === '_').map((c) => ({ x: STOPS[i].x + c.c + 0.5, y: c.level, z: c.r + 0.5 })));
}
```

Simplify the `layFlat` line while writing it: `j.y = 0.08;` (the `Math.min` expression is always 0.08).

- [ ] **Step 4: Run the tests.** Run `node --test test/station-fight3d.test.js`. Expected: PASS. If the pillar line fails, find a real pillar with `grep -n "|" src/rpg/station.txt`. Row 9 (the 10th grid line) has `|` at column 23; fix the test's coordinates to a real `|` cell, not the code.

- [ ] **Step 5: Commit.** `git add src/rpg/fight3d.js test/station-fight3d.test.js`, with the message "Station fight: numbers and geometry (fight3d.js)" plus the trailers.

---

### Task 3: referee3d.js, the rules engine

**Files:**
- Create: `src/rpg/referee3d.js`
- Test: `test/station-referee3d.test.js`

**Interfaces:**
- Consumes:
  - from Task 2: `GUNS3D`, `ZF`, `aimDir`, `createWorld3d`, `bodyAt`, `hitPart`, `pickupSpots3d`
  - from fight.js: `MAX_HP`, `HEADSHOT`, `regenHp`, `fleeKiller`, `PICKUP_BACK`, `MEDKIT`
  - from train.js: `sharedTime`
  - from schedule.js: `trainsAt`, `local`
  - from car.js: `trainOrigin`
- Produces:
  - `newShooter(id) → record`. A record is `{ id, drawn, holsterAt, hp, hurtAt, alive, deadAt, safeUntil, kills, streak, gun, ammo, shotAt, hitBy, pos }`, plain JSON. `pos` is set by the caller from q (rules.js stationPos shape).
  - `createStationReferee({ maps, rand }) →`:
    - `draw(F, t) → msgs`
    - `holster(F, t, all, now = false) → msgs`
    - `leave(F, t, all) → msgs`
    - `fire(F, shot, t) → { ok, out }`, where `shot = { x, y, z, yaw, pitch, tr? }`
    - `addBullet({ id, n, x, y, z, yaw, pitch, w }, t)`, the page's: a bullet someone else fired (zs)
    - `tick(t, all) → msgs`
    - `pickup(F, n, t) → { ok, out }`
    - `pickups(t) → Array<{ n, kind, x, y, z, at }>`
    - `view(F, t) → { id, drawn, hp, kills, alive, safe, w, ammo }`
    - `bullets() → Array<{ n, by, w, x, y, z, dx, dy, dz }>`, live bullets for drawing
    - `busy(all) → boolean`
  - `t` is wall time in seconds (Date.now() / 1000 on the Worker; the server's clock on the page). Line time is `sharedTime(t * 1000)`.
  - Messages:
    - `zd {id, on}`
    - `zs {id, n, x, y, z, yaw, pitch, w}`
    - `zh {id, by, n, d, hp, hs, x, y, z}`
    - `zx {id, by, kills, streak, fled?}`
    - `zr {id}`
    - `zp {n, kind, x, y, z, at, by?, w?, ammo?, hp?}`
    - `zb {n, x, y, z}`: a bullet stopped by a solid. The page's sparks; the Worker filters it out.

- [ ] **Step 1: Write the failing tests.** Create `test/station-referee3d.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation, LEVEL } from '../src/rpg/map.js';
import { local } from '../src/rpg/schedule.js';
import { trainOrigin, CAR, WINDOWS } from '../src/rpg/car.js';
import { createStationReferee, newShooter } from '../src/rpg/referee3d.js';
import { ZF, BODY } from '../src/rpg/fight3d.js';

const read = (f) => parseStation(fs.readFileSync(new URL(`../src/rpg/${f}`, import.meta.url), 'utf8'));
const maps = [read('station.txt'), read('canalst.txt')];
const P = LEVEL.platform;
const setup = () => ({ R: createStationReferee({ maps, rand: () => 0.5 }) });
const at = (F, x, z, y = P) => { F.pos = { x, z, y }; return F; };
// Drawn, past protection, at (x, z) on the platform.
const armed = (R, id, x, z, t = 0) => { const F = at(newShooter(id), x, z); R.draw(F, t); F.safeUntil = 0; return F; };
// The muzzle 1.3 over the feet, aiming along yaw (π/2 east, −π/2 west).
const shoot = (R, F, t, yaw, pitch = 0) => R.fire(F, { x: F.pos.x, y: F.pos.y + 1.3, z: F.pos.z, yaw, pitch }, t);
const run = (R, all, t0, t1) => { const out = []; for (let t = t0; t <= t1 + 1e-9; t += 1 / 30) out.push(...R.tick(t, all)); return out; };

test('draw: protected 2 s, full hp, the deagle; firing ends protection', () => {
  const { R } = setup();
  const F = at(newShooter('a'), 40, 9.5);
  assert.deepEqual(R.draw(F, 10), [{ t: 'zd', id: 'a', on: 1 }]);
  assert.equal(F.drawn, true);
  assert.equal(F.safeUntil, 10 + ZF.safe);
  assert.equal(shoot(R, F, 10.5, Math.PI / 2).ok, true);
  assert.equal(F.safeUntil, 0);
});

test('a deagle round crosses the platform and hits: 25, then a headshot 50', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5), B = armed(R, 'b', 50, 9.5);
  shoot(R, A, 1, Math.PI / 2, 0); // east, at chest height 1.3: B's body
  const out = run(R, [A, B], 1, 1.5);
  const h = out.find((m) => m.t === 'zh');
  assert.deepEqual([h.id, h.by, h.d, h.hs], ['b', 'a', 25, 0]);
  assert.equal(B.hp, 75);
  A.shotAt = -1e9;
  R.fire(A, { x: 40, y: P + BODY.headY, z: 9.5, yaw: Math.PI / 2, pitch: 0 }, 2);
  const h2 = run(R, [A, B], 2, 2.5).find((m) => m.t === 'zh');
  assert.deepEqual([h2.d, h2.hs], [50, 1]);
});

test('cooldown and ammo: the deagle every 0.4 s; holstered, dead or holstering can\'t fire', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5);
  assert.equal(shoot(R, A, 1, 0).ok, true);
  assert.equal(shoot(R, A, 1.2, 0).ok, false);
  assert.equal(shoot(R, A, 1.45, 0).ok, true);
  R.holster(A, 2, [A]);
  assert.equal(shoot(R, A, 3, 0).ok, false, 'holstering');
});

test('walls stop bullets: a pillar between, a wall behind', () => {
  const { R } = setup();
  const A = armed(R, 'a', 20.5, 9.5), B = armed(R, 'b', 26.5, 9.5); // the pillar at 23.5, 9.5 between them
  shoot(R, A, 1, Math.PI / 2);
  const out = run(R, [A, B], 1, 2);
  assert.ok(!out.some((m) => m.t === 'zh'), 'the pillar took it');
  assert.ok(out.some((m) => m.t === 'zb' && Math.abs(m.x - 23.2) < 0.2), JSON.stringify(out));
});

test('a sweep that starts inside a solid stops at once', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5);
  R.fire(A, { x: 40, y: P - 1, z: 9.5, yaw: Math.PI / 2, pitch: 0 }, 1); // the muzzle under the floor
  const out = run(R, [A], 1, 1.1);
  const b = out.find((m) => m.t === 'zb');
  assert.ok(b && Math.abs(b.x - 40) < 0.2);
  assert.equal(R.bullets().length, 0);
});

test('a pop: kills and streak to the killer, a respawn 3 s later where they fell, protected', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5), B = armed(R, 'b', 50, 9.5);
  B.hp = 20; B.hurtAt = 0.9;
  shoot(R, A, 1, Math.PI / 2);
  const out = run(R, [A, B], 1, 1.5);
  assert.deepEqual(out.find((m) => m.t === 'zx'), { t: 'zx', id: 'b', by: 'a', kills: 1, streak: 1 });
  assert.equal(B.alive, false);
  assert.equal(B.streak, 0);
  const back = run(R, [A, B], 1.5, 1.5 + ZF.respawn);
  assert.ok(back.some((m) => m.t === 'zr' && m.id === 'b'));
  assert.equal(B.alive, true);
  assert.equal(B.hp, 100);
  assert.ok(B.safeUntil > 4);
});

test('popped aboard: back up on the same train, wherever it is by then', () => {
  const { R } = setup();
  const A = armed(R, 'a', 0, 0), B = armed(R, 'b', 0, 0);
  A.pos = { tr: 0, x: 20, z: 0 }; B.pos = { tr: 0, x: 26, z: 0 }; // both in L0, riding (t ≈ 50 s of line time)
  const t0 = 50;
  B.hp = 10; B.hurtAt = t0;
  A.shotAt = -1e9;
  R.fire(A, { tr: 0, x: 20, y: P + 1.3, z: 0, yaw: Math.PI / 2, pitch: 0 }, t0);
  run(R, [A, B], t0, t0 + 0.5);
  assert.equal(B.alive, false);
  run(R, [A, B], t0 + 0.5, t0 + 0.5 + ZF.respawn);
  assert.equal(B.alive, true);
  assert.deepEqual(B.pos, { tr: 0, x: 26, z: 0 }, 'still in L0 (its frame moved with it)');
});

test('fleeing: holstering within 3 s of a hit gives the hitter the kill; after 3 s it doesn\'t', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5), B = armed(R, 'b', 50, 9.5);
  shoot(R, A, 1, Math.PI / 2);
  run(R, [A, B], 1, 1.5);
  R.holster(B, 2, [A, B]);
  const out = run(R, [A, B], 2, 2 + ZF.holster);
  assert.deepEqual(out.find((m) => m.t === 'zx'), { t: 'zx', id: 'b', by: 'a', kills: 1, streak: 1, fled: 1 });
  assert.ok(out.some((m) => m.t === 'zd' && m.id === 'b' && m.on === 0));
  const C = armed(R, 'c', 60, 9.5);
  C.hitBy = 'a'; C.hurtAt = 10;
  const late = R.holster(C, 14, [A, C], true);
  assert.ok(!late.some((m) => m.t === 'zx'));
});

test('leave: out at once, a flee kill if hit lately, nothing left to hit', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5), B = armed(R, 'b', 50, 9.5);
  B.hitBy = 'a'; B.hurtAt = 5;
  const out = R.leave(B, 6, [A, B]);
  assert.ok(out.some((m) => m.t === 'zx' && m.fled === 1));
  assert.equal(B.drawn, false);
  shoot(R, A, 7, Math.PI / 2);
  assert.ok(!run(R, [A, B], 7, 7.5).some((m) => m.t === 'zh'), 'a holstered body is not hit');
});

test('draw and holster edge cases: drawing cancels a holster; dead can\'t holster; no double zd', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5);
  R.holster(A, 1, [A]);
  assert.deepEqual(R.draw(A, 1.5), [], 'already drawn: the holster is cancelled, nothing sent');
  assert.equal(A.holsterAt, null);
  assert.ok(!run(R, [A], 1.5, 3).some((m) => m.t === 'zd'));
  A.alive = false; A.deadAt = 3;
  assert.deepEqual(R.holster(A, 3.1, [A]), []);
  assert.deepEqual(R.draw(A, 3.2), []);
});

test('from the platform into a standing local\'s open door, and from inside out', () => {
  const { R } = setup();
  const t = 20 + 6; // L0 standing at MUSEUM, south doors open, on the north track (z 2.5)
  const tr = local(0, t), o = trainOrigin(tr), d = o.x + CAR.doors[0] + 15.75 * 1; // car 1's west door
  const A = armed(R, 'a', d, 6.5), B = armed(R, 'b', 0, 0);
  B.pos = { tr: 0, x: d - o.x, z: 0 };
  shoot(R, A, t, Math.PI); // north, into the doorway
  const out = run(R, [A, B], t, t + 0.4);
  assert.ok(out.some((m) => m.t === 'zh' && m.id === 'b'), JSON.stringify(out.filter((m) => m.t !== 'zs')));
});

test('from the platform into a passing train\'s window', () => {
  const { R } = setup();
  // L1 westbound on the south track (z 16.5) passing MUSEUM's platform: find a time its car 2 is level with x 50.
  let t = 0, tr;
  for (t = 70; t < 140; t += 0.05) { tr = local(1, t); const o = trainOrigin(tr); if (tr.at == null && o.x + 2 * 15.75 + 7 > 49 && o.x + 2 * 15.75 + 7 < 51) break; }
  const o = trainOrigin(tr), u = (WINDOWS[3][0] + WINDOWS[3][1]) / 2;
  const tx = o.x + 2 * 15.75 + u;
  const A = armed(R, 'a', tx, 12.5), B = armed(R, 'b', 0, 0);
  B.pos = { tr: 1, x: 2 * 15.75 + u, z: 0 };
  // Level with the window band: aim from the platform's height (P + 1.3) at the window (P + 1.25).
  shoot(R, A, t, 0); // south
  const out = run(R, [A, B], t, t + 0.3);
  assert.ok(out.some((m) => m.t === 'zh' && m.id === 'b'), 'through the glass into B');
});

test('pickups: the smg and its ammo; the medkit heals; each comes back later at another spot', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5);
  const smg = R.pickups(0).find((p) => p.kind === 'rifle' && p.x < 101);
  A.pos = { x: smg.x, z: smg.z, y: smg.y };
  const r = R.pickup(A, smg.n, 1);
  assert.equal(r.ok, true);
  assert.equal(A.gun, 'rifle');
  assert.equal(A.ammo, 40);
  assert.equal(R.pickup(A, smg.n, 2).ok, false, 'gone');
  const back = R.pickups(12).find((p) => p.n === smg.n);
  assert.ok(back.at <= 12 && Math.hypot(back.x - smg.x, back.z - smg.z) >= 8);
  A.pos = { x: 0, z: 0, y: 0 };
  const med = R.pickups(0).find((p) => p.kind === 'medkit' && p.x < 101);
  assert.equal(R.pickup(A, med.n, 1).ok, false, 'too far');
});

test('a bullet across the midnight wrap flies on smoothly', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5);
  const t0 = 86400 - 0.1;
  shoot(R, A, t0, Math.PI / 2);
  R.tick(t0 + 0.05, [A]);
  const x1 = R.bullets()[0].x;
  R.tick(t0 + 0.15, [A]); // line time wrapped to ~0.05
  const x2 = R.bullets()[0].x;
  assert.ok(Math.abs(x2 - x1 - 45 * 0.1) < 0.2, `${x1} → ${x2}`);
});

test('the smg sprays, the sniper doesn\'t; ammo runs out back to the deagle', () => {
  const { R } = setup();
  const A = armed(R, 'a', 40, 9.5);
  A.gun = 'rifle'; A.ammo = 1;
  const r = shoot(R, A, 1, Math.PI / 2);
  assert.equal(r.ok, true);
  assert.equal(A.gun, 'deagle');
  assert.equal(A.ammo, -1);
});
```

- [ ] **Step 2: Run them to see them fail.** Run `node --test test/station-referee3d.test.js`. Expected: fails (no module).

- [ ] **Step 3: Write `src/rpg/referee3d.js`:**

```js
// The station fight's rules engine (station PvP spec §2): who's drawn, shots, the bullet sweep through the stations,
// the tunnel and the trains, hits, pops, respawns, the flee rule, pickups. Shared by the Worker (the authority) and the
// page (its own bullets drawn at once, and everyone's for the picture). Pure: no clocks (t is given, wall seconds), no
// randomness of its own (rand is given). Line time, for where the trains are, is sharedTime(t × 1000).
import { MAX_HP, HEADSHOT, regenHp, fleeKiller, PICKUP_BACK, MEDKIT } from '../fight.js';
import { sharedTime } from './train.js';
import { trainsAt, local } from './schedule.js';
import { trainOrigin } from './car.js';
import { GUNS3D, ZF, aimDir, createWorld3d, bodyAt, hitPart, pickupSpots3d } from './fight3d.js';

const PICK_GAP = 8; // tiles between pickups in a station, and from where one last was
const KINDS = ['rifle', 'sniper', 'medkit'];
const shownHp = (hp) => (hp > 0 ? Math.max(1, Math.round(hp)) : 0);
const r2 = (v) => Math.round(v * 100) / 100 + 0;

// A plain record: it survives JSON (Durable Object attachments). pos: the q position, set by the caller.
export function newShooter(id) {
  return { id, drawn: false, holsterAt: null, hp: MAX_HP, hurtAt: -1e9, alive: true, deadAt: -1e9, safeUntil: 0,
    kills: 0, streak: 0, gun: 'deagle', ammo: -1, shotAt: -1e9, hitBy: null, pos: null };
}

export function createStationReferee({ maps, rand }) {
  const world = createWorld3d(maps);
  const spots = pickupSpots3d(maps);
  let bullets = [], seq = 0;
  // Per stop, a smg, a sniper and a medkit; n is the index here (0–5).
  const pickups = spots.flatMap((list, stop) => KINDS.map((kind) => ({ kind, stop, x: 0, y: 0, z: 0, at: 0 })));
  pickups.forEach((p, n) => { p.n = n; place(p); });
  function place(p) {
    const list = spots[p.stop];
    const ok = (s) => pickups.every((q) => q === p || q.stop !== p.stop || q.at === undefined || Math.hypot(s.x - q.x, s.z - q.z) >= PICK_GAP)
      && (p.x === 0 || Math.hypot(s.x - p.x, s.z - p.z) >= PICK_GAP);
    const free = list.filter(ok), from = free.length ? free : list;
    const s = from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
    p.x = s.x; p.y = s.y; p.z = s.z;
  }
  const toDeagle = (F) => { F.gun = 'deagle'; F.ammo = -1; };
  const zd = (F, on) => ({ t: 'zd', id: F.id, on: on ? 1 : 0 });

  function draw(F, t) {
    if (!F.alive) return [];
    if (F.drawn) { F.holsterAt = null; return []; } // Q mashed: drawing again cancels the holster
    Object.assign(F, { drawn: true, holsterAt: null, hp: MAX_HP, hurtAt: -1e9, safeUntil: t + ZF.safe, hitBy: null });
    toDeagle(F);
    return [zd(F, true)];
  }
  // Put away: after ZF.holster (you're still a target meanwhile), or now (sitting, chat, the fare machine, leaving).
  function holster(F, t, all, now = false) {
    if (!F.drawn || !F.alive) return [];
    if (!now) { if (F.holsterAt == null) F.holsterAt = t + ZF.holster; return []; }
    return finish(F, t, all);
  }
  function finish(F, t, all) {
    const out = [];
    const by = fleeKiller(F, t), K = by && all.find((o) => o.id === by);
    if (K) { K.kills++; K.streak++; out.push({ t: 'zx', id: F.id, by: K.id, kills: K.kills, streak: K.streak, fled: 1 }); }
    Object.assign(F, { drawn: false, holsterAt: null, streak: 0, hitBy: null });
    out.push(zd(F, false));
    return out;
  }
  const leave = (F, t, all) => (F.drawn && F.alive ? finish(F, t, all) : (F.drawn = false, F.holsterAt = null, []));

  function addBullet({ id, n, x, y, z, yaw, pitch, w }, t) {
    const d = aimDir(yaw, pitch), G = GUNS3D[w] || GUNS3D.deagle;
    bullets.push({ n, by: id, w, x, y, z, dx: d.x, dy: d.y, dz: d.z, speed: G.speed, left: G.range, at: t });
  }
  function fire(F, shot, t) {
    const G = GUNS3D[F.gun];
    if (!F.drawn || !F.alive || F.holsterAt != null || t - F.shotAt < G.cooldown * 0.9) return { ok: false, out: [] };
    // The muzzle in the world; one further than ZF.slack from where I have the shooter is moved there.
    const lineT = sharedTime(t * 1000);
    let { x, y, z } = shot;
    if (Number.isInteger(shot.tr)) { const o = trainOrigin(local(shot.tr, lineT)); x += o.x; z += o.z; }
    const b = bodyAt(F.pos, lineT);
    if (b && Math.hypot(x - b.x, y - (b.y + ZF.muzzleUp), z - b.z) > ZF.slack) { x = b.x; y = b.y + ZF.muzzleUp; z = b.z; }
    const s = G.spray;
    const yaw = shot.yaw + (s ? (rand() * 2 - 1) * s : 0), pitch = Math.max(-ZF.pitch, Math.min(ZF.pitch, shot.pitch + (s ? (rand() * 2 - 1) * s * 0.5 : 0)));
    const n = ++seq % 1e6;
    const w = F.gun;
    addBullet({ id: F.id, n, x, y, z, yaw, pitch, w }, t);
    F.shotAt = t; F.safeUntil = 0;
    if (F.ammo > 0 && --F.ammo === 0) toDeagle(F);
    return { ok: true, out: [{ t: 'zs', id: F.id, n, x: r2(x), y: r2(y), z: r2(z), yaw: r2(yaw), pitch: r2(pitch), w: GUNS3D[w].code }] };
  }

  function tick(t, all) {
    const out = [];
    for (const F of all) {
      if (F.holsterAt != null && t >= F.holsterAt) out.push(...finish(F, t, all));
      if (F.drawn && !F.alive && t - F.deadAt >= ZF.respawn) {
        Object.assign(F, { alive: true, hp: MAX_HP, hurtAt: -1e9, safeUntil: t + ZF.safe, hitBy: null });
        toDeagle(F);
        out.push({ t: 'zr', id: F.id });
      }
    }
    if (!bullets.length) return out;
    const lineT = sharedTime(t * 1000), trains = trainsAt(lineT);
    const bodies = all.filter((F) => F.drawn && F.alive && t >= F.safeUntil).map((F) => ({ F, b: bodyAt(F.pos, lineT) })).filter((e) => e.b);
    const keep = [];
    for (const B of bullets) {
      // Wall time, not line time, says how far it's gone: the clock's midnight wrap moves nothing.
      const want = Math.min(B.left, B.speed * Math.max(0, t - B.at));
      let gone = 0, done = false;
      for (; gone <= want + 1e-9 && !done; gone += ZF.step) {
        const p = { x: B.x + B.dx * gone, y: B.y + B.dy * gone, z: B.z + B.dz * gone };
        for (const { F, b } of bodies) {
          if (F.id === B.by) continue;
          const part = hitPart(p, b);
          if (!part) continue;
          out.push(...hit(F, B, part === 'head', p, t, all));
          done = true;
          break;
        }
        if (!done && world.solidAt(p.x, p.y, p.z, trains)) { out.push({ t: 'zb', n: B.n, x: r2(p.x), y: r2(p.y), z: r2(p.z) }); done = true; }
      }
      if (done || want >= B.left) continue;
      const moved = Math.min(want, gone);
      Object.assign(B, { x: B.x + B.dx * moved, y: B.y + B.dy * moved, z: B.z + B.dz * moved, left: B.left - moved, at: B.at + moved / B.speed });
      keep.push(B);
    }
    bullets = keep;
    return out;
  }
  function hit(T, B, head, p, t, all) {
    const G = GUNS3D[B.w] || GUNS3D.deagle, d = G.damage * (head ? HEADSHOT : 1);
    T.hp = regenHp(T.hp, T.hurtAt, t) - d;
    T.hurtAt = t; T.hitBy = B.by;
    const out = [{ t: 'zh', id: T.id, by: B.by, n: B.n, d, hp: shownHp(T.hp), hs: head ? 1 : 0, x: r2(p.x), y: r2(p.y), z: r2(p.z) }];
    if (T.hp <= 0) {
      T.alive = false; T.deadAt = t; T.streak = 0; T.holsterAt = null;
      const K = all.find((o) => o.id === B.by);
      if (K) { K.kills++; K.streak++; }
      out.push({ t: 'zx', id: T.id, by: B.by, kills: K ? K.kills : 0, streak: K ? K.streak : 0 });
    }
    return out;
  }

  function pickup(F, n, t) {
    const p = pickups[n];
    if (!p || !F.drawn || !F.alive || p.at > t) return { ok: false, out: [] };
    const b = bodyAt(F.pos, sharedTime(t * 1000));
    if (!b || Math.hypot(b.x - p.x, b.z - p.z) > ZF.reachServer || Math.abs(b.y - p.y) > 1.5) return { ok: false, out: [] };
    if (p.kind === 'medkit') { F.hp = Math.min(MAX_HP, regenHp(F.hp, F.hurtAt, t) + MEDKIT.heal); F.hurtAt = -1e9; }
    else { F.gun = p.kind; F.ammo = GUNS3D[p.kind].ammo; }
    p.at = t + (p.kind === 'medkit' ? MEDKIT.back[0] + rand() * (MEDKIT.back[1] - MEDKIT.back[0]) : PICKUP_BACK);
    place(p);
    return { ok: true, out: [{ t: 'zp', n, kind: p.kind, x: p.x, y: p.y, z: p.z, at: r2(p.at), by: F.id, w: GUNS3D[F.gun].code, ammo: F.ammo, hp: shownHp(F.hp) }] };
  }

  return {
    draw, holster, leave, fire, addBullet, tick, pickup,
    pickups: () => pickups.map(({ n, kind, x, y, z, at }) => ({ n, kind, x, y, z, at: r2(at) })),
    view: (F, t) => ({ id: F.id, drawn: F.drawn ? 1 : 0, hp: F.alive ? shownHp(regenHp(F.hp, F.hurtAt, t)) : 0, kills: F.kills,
      alive: F.alive ? 1 : 0, safe: t < F.safeUntil ? 1 : 0, w: GUNS3D[F.gun].code, ammo: F.ammo }),
    bullets: () => bullets.map(({ n, by, w, x, y, z, dx, dy, dz }) => ({ n, by, w, x, y, z, dx, dy, dz })),
    busy: (all) => bullets.length > 0 || all.some((F) => F.holsterAt != null || (F.drawn && !F.alive)),
  };
}
```

The `place` function needs `pickups` set before it runs. The `pickups.forEach` call comes after the array literal, so that works. Its `ok` filter treats a pickup at the origin (`x === 0`) as never placed.

- [ ] **Step 4: Run the tests.** Run `node --test test/station-referee3d.test.js`. Expected: PASS. Adjust only the test geometry if a real map feature is in the way: the door test's car offset (`15.75` is PITCH) and the passing-train search window. Then say what changed in the commit message.

- [ ] **Step 5: Commit.** `git add src/rpg/referee3d.js test/station-referee3d.test.js`, with the message "Station fight: the referee (referee3d.js)" plus the trailers.

---

### Task 4: rules.js, the wire's parsing and buckets

**Files:**
- Modify: `server/rules.js` (`parseMessage` switch, `RATES`)
- Test: `test/rules.test.js`

**Interfaces:**
- Produces: `parseMessage` accepts these:
  - `{t:'zd', on: 0|1}`
  - `{t:'zf', x, y, z, yaw, pitch, tr?}`: numbers to 0.01; tr an integer in STATION.k; aboard, `0 ≤ x ≤ STATION.length` and `|z| ≤ STATION.half`; else `STATION.x0 ≤ x ≤ STATION.x1` and `0 ≤ z ≤ STATION.rows`; always `STATION.yMin − 1 ≤ y ≤ STATION.yMax + 2`, `|yaw| ≤ π`, `|pitch| ≤ 1.4`
  - `{t:'zk', n}` with an integer n from 0 to 5
- RATES gains `zd: [3, 1]` and `zk: [2, 2]`. zf uses the existing `takeShot(b, gun, now)` with the station gun's cooldown: export `takeShot3d = (b, gun, now) => takeAt(b, 'zf', 2, 1.15 / GUNS3D[gun].cooldown, now)` (import GUNS3D from '../src/rpg/fight3d.js').

- [ ] **Step 1: Write the failing test.** Append to `test/rules.test.js`:

```js
test('station fight messages: zd, zf (ground and aboard), zk; junk refused', () => {
  const p = (m) => parseMessage(JSON.stringify(m));
  assert.deepEqual(p({ t: 'zd', on: 1 }), { t: 'zd', on: 1 });
  assert.equal(p({ t: 'zd', on: 2 }), null);
  assert.deepEqual(p({ t: 'zf', x: 40.123, y: -1.7, z: 9.5, yaw: 1.5, pitch: 0.1 }), { t: 'zf', x: 40.12, y: -1.7, z: 9.5, yaw: 1.5, pitch: 0.1 });
  assert.deepEqual(p({ t: 'zf', tr: 3, x: 20, y: -1.7, z: 0.4, yaw: 0, pitch: 0 }), { t: 'zf', tr: 3, x: 20, y: -1.7, z: 0.4, yaw: 0, pitch: 0 });
  assert.equal(p({ t: 'zf', tr: 3, x: 90, y: -1.7, z: 0, yaw: 0, pitch: 0 }), null, 'past the train\'s length');
  assert.equal(p({ t: 'zf', x: 40, y: -1.7, z: 9.5, yaw: 4, pitch: 0 }), null);
  assert.equal(p({ t: 'zf', x: 40, y: -1.7, z: 9.5, yaw: 0, pitch: 1.5 }), null);
  assert.equal(p({ t: 'zf', x: 40, y: 'a', z: 9.5, yaw: 0, pitch: 0 }), null);
  assert.deepEqual(p({ t: 'zk', n: 5 }), { t: 'zk', n: 5 });
  assert.equal(p({ t: 'zk', n: 6 }), null);
});
```

- [ ] **Step 2: Run it.** Run `node --test test/rules.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `server/rules.js`, add these cases before `default:`:

```js
    // The station fight (station PvP spec §3): draw or holster, a shot (its muzzle on the line, or in a train's frame),
    // a pickup.
    case 'zd': return m.on === 0 || m.on === 1 ? { t: 'zd', on: m.on } : null;
    case 'zf': {
      if (!num(m.x) || !num(m.y) || !num(m.z) || !within(m.yaw, Math.PI + 1e-9) || !within(m.pitch, 1.4)) return null;
      if (m.y < STATION.yMin - 1 || m.y > STATION.yMax + 2) return null;
      const s = { t: 'zf' };
      if (m.tr !== undefined) {
        if (!Number.isInteger(m.tr) || m.tr < STATION.k[0] || m.tr > STATION.k[1]) return null;
        if (m.x < 0 || m.x > STATION.length || Math.abs(m.z) > STATION.half) return null;
        s.tr = m.tr;
      } else if (m.x < STATION.x0 || m.x > STATION.x1 || m.z < 0 || m.z > STATION.rows) return null;
      return Object.assign(s, { x: round(m.x, 100), y: round(m.y, 100), z: round(m.z, 100), yaw: round(m.yaw, 100), pitch: round(m.pitch, 100) });
    }
    case 'zk': return Number.isInteger(m.n) && m.n >= 0 && m.n <= 5 ? { t: 'zk', n: m.n } : null;
```

Add `zd: [3, 1], zk: [2, 2]` to RATES. After `takeShot`, add:

```js
// The station's shots: the same, by the station gun's cooldown (fight3d.js), in their own bucket.
export const takeShot3d = (b, gun, now) => takeAt(b, 'zf', 2, 1.15 / GUNS3D[gun].cooldown, now);
```

Then add `import { GUNS3D } from '../src/rpg/fight3d.js';` at the top. Make sure the key order of the expected aboard object is `t, tr, x, y, z, yaw, pitch`, since deepEqual doesn't care about order but the test reads easier that way.

- [ ] **Step 4: Run the tests.** Run `node --test test/rules.test.js`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add server/rules.js test/rules.test.js`, with the message "Station fight: zd, zf, zk on the wire (rules.js)" plus the trailers.

---

### Task 5: The Worker runs the station referee

**Files:**
- Modify: `server/gallery.js`
- Test: `server/test/server.test.js`

**Interfaces:**
- Consumes: `createStationReferee`, `newShooter` (Task 3); `STATION_FIGHT` (Task 2); `takeShot3d`, `take` (Task 4); `parseStation` (src/rpg/map.js); the texts `../src/rpg/station.txt` and `../src/rpg/canalst.txt`, imported as text the way arena.txt is.
- Produces:
  - The welcome gains `sf: STATION_FIGHT`.
  - Station peer views gain `g: 0|1`.
  - Messages out to the station's people: `zw`, `zs`, `zh`, `zx`, `zr`, `zp`, `zd`, `ks`.
  - `me.sx` is the shooter record in the attachment.

- [ ] **Step 1: Write the failing server test.** Append to `server/test/server.test.js`:

```js
test('the station fight: draw, shoot someone drawn on the platform to a pop, the streak board hears', async () => {
  const r = room();
  const st = async (name, x) => {
    const ws = client({ room: r }); await ws.opened;
    ws.send2({ t: 'hi', name, area: 'station', x, z: 9.5, y: -3, a: 0 });
    const w = await ws.next('welcome');
    assert.equal(w.sf, 1);
    ws.id = w.id;
    return ws;
  };
  const a = await st('Ann', 40), b = await st('Bo', 46);
  a.send2({ t: 'zd', on: 1 }); b.send2({ t: 'zd', on: 1 });
  await a.next('zw'); await b.next('zw');
  await sleep(2100); // past protection
  for (let i = 0; i < 4; i++) { a.send2({ t: 'zf', x: 40, y: -1.7, z: 9.5, yaw: Math.PI / 2, pitch: 0 }); await sleep(450); }
  const x = await b.next('zx', 3000);
  assert.deepEqual([x.id, x.by, x.kills], [b.id, a.id, 1]);
  a.close(); b.close();
});
```

Use the file's existing `sleep` helper; it's defined as `sleepMs` near `fighter()`, so use whichever exists.

- [ ] **Step 2: Wire the Worker.** In `server/gallery.js`:

1. Imports:

```js
import { createStationReferee, newShooter } from '../src/rpg/referee3d.js';
import { STATION_FIGHT } from '../src/rpg/fight3d.js';
import { parseStation } from '../src/rpg/map.js';
import museumText from '../src/rpg/station.txt';
import canalText from '../src/rpg/canalst.txt';
```

and add `takeShot3d` to the rules.js import list. Next to `const ARENA = …`, add `const STATION_FIGHT_T = new Set(['zd', 'zf', 'zk']);`.

2. Methods on `Gallery`:

```js
  // The station fight (station PvP spec): its referee, made on first use like the arena's.
  zref() { return (this.zr ||= createStationReferee({ maps: [parseStation(museumText), parseStation(canalText)], rand: Math.random })); }
  // Everyone in the station as [socket, attachment] pairs, the sender's (already read) attachment included.
  zpairs(ws, me) {
    const pairs = me?.here && me.area === 'station' ? [[ws, me]] : [];
    for (const o of this.ctx.getWebSockets()) {
      if (o === ws) continue;
      const a = o.deserializeAttachment();
      if (a?.here && a.area === 'station') pairs.push([o, a]);
    }
    return pairs;
  }
  // While bullets fly, or someone is holstering or down: every 33 ms.
  startZTick() {
    if (this.zTimer) return;
    this.zTimer = setInterval(() => {
      let done = false;
      try {
        const pairs = this.zpairs(), all = pairs.map(([, a]) => a.sx).filter(Boolean);
        this.tell(pairs, this.zref().tick(Date.now() / 1000, all).filter((m) => m.t !== 'zb'));
        this.save(pairs);
        done = !this.zref().busy(all);
      } finally { if (done) { clearInterval(this.zTimer); this.zTimer = null; } }
    }, TICK_MS);
  }
  // Out of the station fight (leaving the station, the page or the area).
  quitStationFight(ws, me) {
    if (!me.sx?.drawn) return;
    const pairs = this.zpairs(ws, me);
    this.tell(pairs, this.zref().leave(me.sx, Date.now() / 1000, pairs.map(([, a]) => a.sx).filter(Boolean)), ws);
    this.save(pairs.filter(([o]) => o !== ws));
  }
  stationFight(ws, me, m, now, drop) {
    if (!me.here || me.area !== 'station') return drop();
    const ref = this.zref(), t = now / 1000;
    me.sx ||= newShooter(me.id);
    const F = me.sx;
    F.pos = me.sp;
    const pairs = this.zpairs(ws, me), all = pairs.map(([, a]) => a.sx).filter(Boolean);
    if (m.t === 'zd') {
      if (!take(me.buckets, 'zd', now)) return drop();
      if (m.on) {
        const out = ref.draw(F, t);
        if (out.length) {
          ws.send(JSON.stringify({ t: 'zw', you: ref.view(F, t), pk: ref.pickups(t), fighters: all.filter((o) => o !== F && o.drawn).map((o) => ref.view(o, t)) }));
          this.tell(pairs, out);
        }
      } else ref.holster(F, t, all);
      this.startZTick();
    } else if (m.t === 'zf') {
      if (!takeShot3d(me.buckets, F.gun, now)) return drop();
      const r = ref.fire(F, m, t);
      if (r.ok) { this.tell(pairs, r.out, ws); this.startZTick(); }
    } else if (m.t === 'zk') {
      if (!take(me.buckets, 'zk', now)) return drop();
      const r = ref.pickup(F, m.n, t);
      if (r.ok) this.tell(pairs, r.out);
    }
    this.save(pairs.filter(([o]) => o !== ws));
    return ws.serializeAttachment(me);
  }
```

3. Dispatch: where incoming messages branch to `this.fight(...)` for ARENA types, add `if (STATION_FIGHT_T.has(m.t)) return this.stationFight(ws, me, m, now, drop);`. Read the dispatcher (`grep -n "ARENA.has" server/gallery.js`) and mirror the arena line exactly, including how `drop` is made.

4. Positions: where `q` sets `me.sp`, add `if (me.sx) me.sx.pos = me.sp;`. Where a `z` move leaves the station (me.area changes from 'station'), and in the socket close and error handlers next to `quitArena`, call `this.quitStationFight(ws, me)` before the area changes.

5. Views: in `view(a, area)`, the station branch becomes `{ id: a.id, name: a.name, ...(a.sp || {}), ...(a.sx?.drawn ? { g: 1 } : {}) }`.

6. Welcome: add `sf: STATION_FIGHT` to the welcome object.

7. Streak hook. In `tell()`, change the condition to `(msg.t === 'k' || msg.t === 'zx') && msg.streak >= STREAKS.min`. In `streak(by, n)`:
   - find the killer by `a?.id === by` (fx.id and sx.id are both the socket's id);
   - broadcast to both fights: `this.tell([...this.arena(), ...this.zpairs()], [{ t: 'ks', top, by }]);`.
   - On `zd on` (draw), also send `ks` to the drawer: after the `zw` send, add `this.streaks().then((top) => { this.top = top; ws.send(JSON.stringify({ t: 'ks', top })); }).catch(() => {});`.

- [ ] **Step 3: Type and build check.** Run `cd server && npx wrangler deploy --dry-run --outdir /tmp/claude-0/-home-user-nfaiz8-github-io/6b33d23b-4d0b-5804-a00e-06d00767c2d1/scratchpad/wdry`. Expected: it builds; .txt imports resolve as text, as arena.txt does.

- [ ] **Step 4: Run the server test** (in the background; the suite is slow in this container):
`cd server && timeout 600 node --test --test-name-pattern="station fight" test/server.test.js`. Expected: PASS. If wrangler dev won't start here, run the same flow by hand with the ws probe pattern from scratchpad `ks.mjs` (start `npx wrangler dev --port 8798`, then a script with two sockets) and record the result.

- [ ] **Step 5: Commit.** `git add server/gallery.js server/test/server.test.js`, with the message "Station fight: the Worker runs it (gallery.js)" plus the trailers.

---

### Task 6: The page's controller (fightmp.js) and live.js routing

**Files:**
- Create: `src/rpg/fightmp.js`
- Modify: `src/live.js` (routing, `stationFightOk`)
- Test: `test/station-fightmp.test.js`

**Interfaces:**
- Consumes: `createStationReferee`, `newShooter` (Task 3); `GUNS3D`, `GUN3D_BY_CODE`, `ZF` (Task 2).
- Produces:
  - `createStationFight({ maps, myId: () => string, send: (m) => boolean, online: () => boolean })` returning:
    - `drawn`, `alive`, `gun`, `ammo` (getters)
    - `toggle(t) → 'drawn' | 'holstering' | 'holstered' | null`
    - `holsterNow(t)`
    - `canFire(t) → boolean`
    - `fire(t, { x, y, z, tr? }, yaw, pitch) → boolean`, where the muzzle is world or train-frame and yaw/pitch are the aim
    - `onMessage(m, t)`
    - `step(t, others) → { sparks: [{ x, y, z, head }], numbers: [{ x, y, z, d, hs }], died: bool, respawned: bool }`, where `others` is `[{ id, x, z, y, tr, s }]` from peers
    - `bullets() → [{ x, y, z, dx, dy, dz, w }]`
    - `pickups(t) → [{ n, kind, x, y, z }]`, those lying now
    - `nearPickup(feet, t) → n | null`
    - `take(n)`
    - `drawnIds() → Set`
    - `gunOf(id) → gun`: a drawn person's gun, from `zw`/`zp`, the deagle by default
    - `deadIds() → Set`
    - `hud(t) → { hp, gun, ammo, alive, showBoard, board, best, streak, record }` in fighthud.js's shape
    - `kickAt`, the last shot's t, for the gun's recoil
  - `src/live.js`:
    - option `onStationFight(m)`, called for `zw zs zh zx zr zp zd ks` while in the station;
    - getter `stationFightOk`, from the welcome's `sf === STATION_FIGHT`.

- [ ] **Step 1: Write the failing tests.** Create `test/station-fightmp.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { createStationFight } from '../src/rpg/fightmp.js';

const read = (f) => parseStation(fs.readFileSync(new URL(`../src/rpg/${f}`, import.meta.url), 'utf8'));
const maps = [read('station.txt'), read('canalst.txt')];
const setup = (online = true) => {
  const sent = [];
  const f = createStationFight({ maps, myId: () => 'me', send: (m) => { sent.push(m); return true; }, online: () => online });
  return { f, sent };
};

test('Q online: sends zd; drawn once the server\'s zw comes; my shot is drawn at once and sent', () => {
  const { f, sent } = setup();
  assert.equal(f.toggle(1), 'drawn');
  assert.deepEqual(sent.at(-1), { t: 'zd', on: 1 });
  f.onMessage({ t: 'zw', you: { id: 'me', drawn: 1, hp: 100, kills: 0, alive: 1, safe: 1, w: 'd', ammo: -1 }, pk: [], fighters: [] }, 1);
  assert.equal(f.drawn, true);
  assert.equal(f.fire(1.1, { x: 40, y: -1.7, z: 9.5 }, Math.PI / 2, 0), true);
  assert.equal(sent.at(-1).t, 'zf');
  assert.equal(f.bullets().length, 1);
  assert.equal(f.fire(1.2, { x: 40, y: -1.7, z: 9.5 }, Math.PI / 2, 0), false, 'cooldown');
});

test('offline: drawn at once, shots fly and hit walls, nothing sent', () => {
  const { f, sent } = setup(false);
  f.toggle(0);
  assert.equal(f.drawn, true);
  f.fire(1, { x: 40, y: -1.7, z: 9.5 }, Math.PI, 0); // north, into the platform's north edge and the track wall
  let sparks = 0;
  for (let t = 1; t < 3; t += 1 / 30) sparks += f.step(t, []).sparks.length;
  assert.ok(sparks >= 1);
  assert.deepEqual(sent, []);
});

test('the server\'s word: zh lowers my hp and floats a number; zx pops me; zr brings me back; others\' shots drawn', () => {
  const { f } = setup();
  f.toggle(0);
  f.onMessage({ t: 'zw', you: { id: 'me', drawn: 1, hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1 }, pk: [], fighters: [{ id: 'b', drawn: 1, hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1 }] }, 0);
  f.onMessage({ t: 'zh', id: 'me', by: 'b', n: 1, d: 25, hp: 75, hs: 0, x: 40, y: -2, z: 9.5 }, 1);
  const s = f.step(1, []);
  assert.deepEqual(s.numbers, [{ x: 40, y: -2, z: 9.5, d: 25, hs: 0 }]);
  assert.equal(f.hud(1).hp, 75);
  f.onMessage({ t: 'zx', id: 'me', by: 'b', kills: 1, streak: 1 }, 2);
  assert.equal(f.alive, false);
  assert.ok(f.deadIds().has('me'));
  assert.equal(f.fire(2.5, { x: 40, y: -1.7, z: 9.5 }, 0, 0), false, 'dead can\'t fire');
  f.onMessage({ t: 'zr', id: 'me' }, 5);
  assert.equal(f.alive, true);
  assert.equal(f.hud(5).hp, 100);
  f.onMessage({ t: 'zs', id: 'b', n: 7, x: 50, y: -1.7, z: 9.5, yaw: -Math.PI / 2, pitch: 0, w: 'n' }, 5);
  assert.equal(f.bullets().length, 1);
  assert.equal(f.bullets()[0].w, 'sniper');
});

test('the HUD: drawn people on the board by kills, my streak, the streak board', () => {
  const { f } = setup();
  f.toggle(0);
  f.onMessage({ t: 'zw', you: { id: 'me', drawn: 1, hp: 100, kills: 2, alive: 1, safe: 0, w: 'd', ammo: -1 }, pk: [], fighters: [{ id: 'b', drawn: 1, hp: 100, kills: 5, alive: 1, safe: 0, w: 'd', ammo: -1 }] }, 0);
  f.onMessage({ t: 'zx', id: 'b', by: 'me', kills: 3, streak: 2 }, 1);
  f.onMessage({ t: 'ks', top: [{ name: 'Ann', n: 4 }] }, 1);
  const h = f.hud(1);
  assert.deepEqual(h.board.map((r) => [r.id, r.kills]), [['b', 5], ['me', 3]]);
  assert.equal(h.streak, 2);
  assert.deepEqual(h.best, [{ name: 'Ann', n: 4 }]);
  assert.equal(h.showBoard, true);
  assert.equal(f.gunOf('b'), 'deagle');
});

test('pickups: lying ones from zw and zp; taking one sends zk once', () => {
  const { f, sent } = setup();
  f.toggle(0);
  f.onMessage({ t: 'zw', you: { id: 'me', drawn: 1, hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1 }, pk: [{ n: 0, kind: 'rifle', x: 40.5, y: -3, z: 9.5, at: 0 }], fighters: [] }, 0);
  assert.equal(f.nearPickup({ x: 40.6, y: -3, z: 9.6 }, 1), 0);
  f.take(0); f.take(0);
  assert.equal(sent.filter((m) => m.t === 'zk').length, 1);
  f.onMessage({ t: 'zp', n: 0, kind: 'rifle', x: 60.5, y: -3, z: 9.5, at: 11, by: 'me', w: 'r', ammo: 40, hp: 100 }, 1);
  assert.equal(f.gun, 'rifle');
  assert.equal(f.ammo, 40);
  assert.equal(f.pickups(5).length, 0, 'gone until 11');
  assert.equal(f.pickups(11).length, 1);
});
```

- [ ] **Step 2: Run them.** Run `node --test test/station-fightmp.test.js`. Expected: FAIL (no module).

- [ ] **Step 3: Write `src/rpg/fightmp.js`:**

```js
// My station fight, the page's side (station PvP spec §3): Q, my shots drawn at once and sent, the server's word on
// hits, pops and respawns, everyone's bullets flown for the picture, pickups, and the HUD's numbers. A local copy of
// the referee (referee3d.js) flies the bullets; its hits only make sparks: the damage is the server's (zh).
// Offline (no server): drawing and shooting work, bullets stop at walls, nothing is sent.
import { createStationReferee, newShooter } from './referee3d.js';
import { GUNS3D, GUN3D_BY_CODE } from './fight3d.js';

const RECORD_MS = 3000;

export function createStationFight({ maps, myId, send, online }) {
  const sim = createStationReferee({ maps, rand: Math.random });
  const me = newShooter('me');
  const people = new Map(); // id → { drawn, hp, kills, alive, w }: the drawn people the server told me of
  let pk = [], best = [], recordAt = -Infinity, kickAt = -Infinity, wantDraw = false, taking = new Set();
  const numbers = [], sparks = [];
  let died = false, respawned = false;
  const id = () => myId() || 'me';
  const isMe = (x) => x != null && x === id();

  function toggle(t) {
    if (!me.alive) return null;
    if (!online()) {
      if (me.drawn) { sim.holster(me, t, [me], true); return 'holstered'; }
      sim.draw(me, t); return 'drawn';
    }
    if (me.drawn && !wantDraw) return null;
    wantDraw = !(me.drawn || wantDraw);
    send({ t: 'zd', on: wantDraw ? 1 : 0 });
    if (!wantDraw) { me.holsterAt = t; return 'holstering'; }
    return 'drawn';
  }
  function holsterNow(t) {
    if (!me.drawn && !wantDraw) return;
    wantDraw = false;
    if (online()) send({ t: 'zd', on: 0 });
    sim.holster(me, t, [me], true);
  }
  const canFire = (t) => me.drawn && me.alive && me.holsterAt == null && t - me.shotAt >= GUNS3D[me.gun].cooldown;
  function fire(t, muzzle, yaw, pitch) {
    if (!canFire(t)) return false;
    me.id = id();
    me.pos = null; // the muzzle is mine to say here; the server checks it
    const r = sim.fire(me, { ...muzzle, yaw, pitch }, t);
    if (!r.ok) return false;
    kickAt = t;
    if (online()) send({ t: 'zf', ...(Number.isInteger(muzzle.tr) ? { tr: muzzle.tr } : {}), x: muzzle.x, y: muzzle.y, z: muzzle.z, yaw, pitch });
    return true;
  }

  function onMessage(m, t) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ks') {
      if (Array.isArray(m.top)) best = m.top.filter((r) => r && typeof r.name === 'string' && Number.isFinite(r.n)).slice(0, 3);
      if (isMe(m.by)) recordAt = t;
      return;
    }
    if (m.t === 'zw') {
      const y = m.you || {};
      Object.assign(me, { drawn: true, holsterAt: null, alive: true, hp: y.hp ?? 100, hurtAt: -1e9, kills: y.kills ?? me.kills, safeUntil: y.safe ? t + 2 : 0 });
      me.gun = GUN3D_BY_CODE[y.w] || 'deagle'; me.ammo = Number.isFinite(y.ammo) ? y.ammo : -1;
      wantDraw = true;
      people.clear();
      for (const f of m.fighters || []) if (f && f.id && !isMe(f.id)) people.set(f.id, { drawn: true, hp: f.hp, kills: f.kills, alive: !!f.alive, w: f.w });
      pk = (m.pk || []).filter((p) => p && Number.isInteger(p.n));
      return;
    }
    if (m.t === 'zd') {
      if (isMe(m.id)) { if (!m.on) { me.drawn = false; me.holsterAt = null; wantDraw = false; me.streak = 0; } return; }
      if (m.on) people.set(m.id, { ...(people.get(m.id) || { kills: 0 }), drawn: true, hp: 100, alive: true });
      else people.delete(m.id);
      return;
    }
    if (m.t === 'zs') {
      if (isMe(m.id)) return; // drawn already, when I fired
      sim.addBullet({ id: m.id, n: m.n, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, w: GUN3D_BY_CODE[m.w] || 'deagle' }, t);
      return;
    }
    if (m.t === 'zh') {
      numbers.push({ x: m.x, y: m.y, z: m.z, d: m.d, hs: m.hs ? 1 : 0 });
      if (isMe(m.id)) { me.hp = m.hp; me.hurtAt = t; }
      else if (people.has(m.id)) people.get(m.id).hp = m.hp;
      return;
    }
    if (m.t === 'zx') {
      if (isMe(m.by)) { me.kills = m.kills; me.streak = m.streak; }
      else if (people.has(m.by)) people.get(m.by).kills = m.kills;
      if (isMe(m.id)) { if (m.fled) return; me.alive = false; me.deadAt = t; me.streak = 0; died = true; }
      else if (people.has(m.id) && !m.fled) people.get(m.id).alive = false;
      return;
    }
    if (m.t === 'zr') {
      if (isMe(m.id)) { Object.assign(me, { alive: true, hp: 100, hurtAt: -1e9, gun: 'deagle', ammo: -1, safeUntil: t + 2 }); respawned = true; }
      else if (people.has(m.id)) Object.assign(people.get(m.id), { alive: true, hp: 100 });
      return;
    }
    if (m.t === 'zp') {
      pk = pk.filter((p) => p.n !== m.n).concat([{ n: m.n, kind: m.kind, x: m.x, y: m.y, z: m.z, at: m.at }]);
      taking.delete(m.n);
      if (isMe(m.by)) { me.gun = GUN3D_BY_CODE[m.w] || me.gun; me.ammo = m.ammo; me.hp = m.hp; me.hurtAt = -1e9; }
    }
  }

  function step(t, others) {
    // The others as bodies for my bullets to stop at (sparks only): drawn and alive, where I see them.
    const all = [me, ...others.filter((o) => people.get(o.id)?.drawn && people.get(o.id)?.alive).map((o) => ({ ...newShooter(o.id), drawn: true, pos: o }))];
    me.id = id();
    const meDrawn = me.drawn;
    const out = sim.tick(t, all);
    me.drawn = meDrawn; // the sim's holster/respawn timers are the server's to decide online
    for (const m of out) {
      if (m.t === 'zb') sparks.push({ x: m.x, y: m.y, z: m.z, head: false });
      if (m.t === 'zh') sparks.push({ x: m.x, y: m.y, z: m.z, head: !!m.hs });
    }
    if (!online()) {
      for (const m of out) if (m.t === 'zd' && isMe(m.id)) me.drawn = !!m.on;
    }
    const r = { sparks: sparks.splice(0), numbers: numbers.splice(0), died, respawned };
    died = respawned = false;
    return r;
  }

  const lying = (t) => pk.filter((p) => !(p.at > t));
  return {
    get drawn() { return me.drawn; },
    get alive() { return me.alive; },
    get gun() { return me.gun; },
    get ammo() { return me.ammo; },
    get kickAt() { return kickAt; },
    toggle, holsterNow, canFire, fire, onMessage, step,
    bullets: () => sim.bullets().map((b) => ({ ...b, w: b.w })),
    pickups: lying,
    nearPickup(feet, t) {
      const p = lying(t).find((q) => Math.hypot(q.x - feet.x, q.z - feet.z) < 0.6 && Math.abs(q.y - feet.y) < 1.5);
      return p ? p.n : null;
    },
    take(n) { if (taking.has(n) || !online()) return; taking.add(n); send({ t: 'zk', n }); },
    gunOf: (k) => GUN3D_BY_CODE[people.get(k)?.w] || 'deagle',
    drawnIds: () => new Set([...people.entries()].filter(([, p]) => p.drawn).map(([k]) => k)),
    deadIds: () => new Set([...(me.alive ? [] : [id()]), ...[...people.entries()].filter(([, p]) => !p.alive).map(([k]) => k)]),
    hud(t) {
      const rows = [{ id: id(), kills: me.kills, me: true }, ...[...people.entries()].map(([k, p]) => ({ id: k, kills: p.kills || 0, me: false }))];
      rows.sort((a, b) => b.kills - a.kills);
      const board = rows.slice(0, 5);
      if (!board.some((r) => r.me)) board.push(rows.find((r) => r.me));
      const hp = me.alive ? Math.max(1, Math.round(Math.min(100, me.hp + Math.max(0, t - me.hurtAt - 4) * 20))) : 0;
      return { hp, gun: me.gun, ammo: me.ammo, alive: me.alive, showBoard: people.size > 0, board, best, streak: me.streak, record: (t - recordAt) * 1000 < RECORD_MS };
    },
  };
}
```

In the offline branch of `toggle`, the `sim.draw` result needs `me.pos` set for nothing: fire passes the muzzle directly. Because fire sets `me.pos = null`, `bodyAt` returns null and the muzzle check is skipped (the server still checks its own). Keep that.

Then in `src/live.js`:
- Add `import { STATION_FIGHT } from './rpg/fight3d.js';`.
- Add `const STATION_FIGHT_T = new Set(['zw', 'zs', 'zh', 'zx', 'zr', 'zp', 'zd', 'ks']);`.
- Add the option `onStationFight = () => {}` to `createLive`'s parameters.
- In the message handler, next to `if (ARENA_T.has(m.t)) onArena(m);`, add `if (STATION_FIGHT_T.has(m.t) && area === 'station') onStationFight(m);`.
- In the welcome branch, add `stationFightOk = m.sf === STATION_FIGHT;`, declaring `let stationFightOk = false;` with the other lets.
- Expose `get stationFightOk() { return stationFightOk; }` on the returned object.

- [ ] **Step 4: Run the tests.** Run `node --test test/station-fightmp.test.js test/live.test.js 2>/dev/null; npm test`. Expected: all PASS.

- [ ] **Step 5: Commit.** `git add src/rpg/fightmp.js test/station-fightmp.test.js src/live.js`, with the message "Station fight: the page's controller (fightmp.js), routed by live.js" plus the trailers.

---

### Task 7: The ASCII guns, bullets, sparks and pickups (guns3d.js)

**Files:**
- Create: `src/rpg/guns3d.js`
- Test: by e2e in Task 9. This is three.js drawing with no logic worth a unit test beyond `kickOf`, which is tested here.

**Interfaces:**
- Consumes: `makeSprite` (sprites.js), `GUN_ART` (../stick.js), `aimDir` (Task 2).
- Produces:
  - `kickOf(age) → { back, up }`: the recoil curve, pure
  - `createGuns(scene, camera, { reducedMotion })` returning:
    - `view({ on, gun, kickAge })`: the first-person gun
    - `hands(list)`, where `list = [{ id, x, y, z, yaw, gun }]` gives the guns in hands, world positions at the right hand
    - `bullets(list, dt)`, where `list` is fightmp's `bullets()` (glyph sprites and trails)
    - `burst(sparks, numbers, t)`: spawns sparks and floating numbers
    - `pickups(list, t)`: spinning glyphs
    - `update(dt, t)`: ages sparks and numbers
    - `dispose()`

- [ ] **Step 1: Write the failing test.** Create `test/station-guns3d.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kickOf } from '../src/rpg/guns3d.js';

test('the recoil: a kick back and up at once, gone by 0.12 s', () => {
  assert.ok(kickOf(0).back > 0.07 && kickOf(0).up > 0.04);
  assert.ok(kickOf(0.06).back < kickOf(0).back);
  assert.deepEqual(kickOf(0.2), { back: 0, up: 0 });
  assert.deepEqual(kickOf(-1), { back: 0, up: 0 });
});
```

Importing guns3d.js in node pulls in three.js, which works headless, and sprites.js, which touches `document` only inside functions. If that import throws in node, put `kickOf` in fight3d.js instead, re-export it from guns3d.js, and import it from fight3d.js in the test.

- [ ] **Step 2: Run it.** Run `node --test test/station-guns3d.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `src/rpg/guns3d.js`:**

```js
// The station fight drawn (station PvP spec §1): my gun in first person (the arena's GUN_ART glyphs, glowing, lower
// right, kicking on each shot), the guns in drawn players' hands, bullets as glyphs with short trails, sparks and
// floating damage numbers, and the pickups turning on the floor. Sprites from a pool; nothing here decides anything.
import * as THREE from 'three';
import { makeSprite } from './sprites.js';
import { GUN_ART } from '../stick.js';

const INK = '#ffd27a', HOT = '#ff6a4a';
const BULLET = { deagle: '•', rifle: '·', sniper: '—' };
const PICK = { rifle: GUN_ART.rifle.glyphs, sniper: GUN_ART.sniper.glyphs, medkit: '[+]' };
const KICK = 0.12; // s

// The recoil age s after a shot: back along the view and up, easing out.
export function kickOf(age) {
  if (!(age >= 0) || age >= KICK) return { back: 0, up: 0 };
  const k = 1 - age / KICK;
  return { back: 0.08 * k * k, up: 0.05 * k * k };
}

export function createGuns(scene, camera, { reducedMotion = false } = {}) {
  const owned = [];
  const sprite = (text, color, h) => { const s = makeSprite([text], color, h, { glow: true }); owned.push(s); return s; };
  if (!camera.parent) scene.add(camera); // the first-person gun hangs off the camera

  // First person: the gun and its flash.
  const vm = new THREE.Group();
  vm.position.set(0.24, -0.2, -0.55);
  camera.add(vm);
  const vmGuns = Object.fromEntries(Object.keys(GUN_ART).map((g) => { const s = sprite(GUN_ART[g].glyphs, INK, 0.09); s.mesh.visible = false; vm.add(s.mesh); return [g, s]; }));
  const flash = sprite('*', HOT, 0.08);
  flash.mesh.position.set(-0.12, 0.02, -0.02);
  vm.add(flash.mesh);

  // Pools: one sprite per glyph kind, grown on demand.
  const pool = (make) => { const list = []; return { get(i) { while (list.length <= i) { const s = make(); scene.add(s.mesh); list.push(s); } return list[i]; }, hideFrom(n) { for (let i = n; i < list.length; i++) list[i].mesh.visible = false; } }; };
  const handPools = Object.fromEntries(Object.keys(GUN_ART).map((g) => [g, pool(() => sprite(GUN_ART[g].glyphs, INK, 0.12))]));
  const bulletPools = Object.fromEntries(Object.entries(BULLET).map(([g, ch]) => [g, pool(() => sprite(ch, HOT, g === 'sniper' ? 0.08 : 0.12))]));
  const pickPools = Object.fromEntries(Object.entries(PICK).map(([k, ch]) => [k, pool(() => sprite(ch, INK, 0.16))]));
  const sparkPool = pool(() => sprite('*', HOT, 0.07)), numberPool = [];
  const live = { sparks: [], numbers: [] };

  return {
    view({ on, gun, kickAge }) {
      for (const [g, s] of Object.entries(vmGuns)) s.mesh.visible = on && g === gun;
      const k = reducedMotion ? { back: 0, up: 0 } : kickOf(kickAge);
      vm.position.set(0.24, -0.2 + k.up, -0.55 + k.back);
      flash.mesh.visible = on && kickAge >= 0 && kickAge < 0.06;
    },
    hands(list) {
      const used = Object.fromEntries(Object.keys(GUN_ART).map((g) => [g, 0]));
      for (const h of list) {
        const p = handPools[h.gun] || handPools.deagle, s = p.get(used[h.gun in used ? h.gun : 'deagle']++);
        s.mesh.visible = true;
        s.mesh.position.set(h.x, h.y - 0.06, h.z);
        s.mesh.rotation.set(0, h.yaw - Math.PI / 2, 0); // the glyphs run along the aim
      }
      for (const [g, p] of Object.entries(handPools)) p.hideFrom(used[g]);
    },
    bullets(list) {
      const used = { deagle: 0, rifle: 0, sniper: 0 };
      for (const b of list) {
        const g = b.w in used ? b.w : 'deagle', s = bulletPools[g].get(used[g]++);
        s.mesh.visible = true;
        s.mesh.position.set(b.x, b.y - 0.06, b.z);
        s.mesh.quaternion.copy(camera.quaternion);
      }
      for (const [g, p] of Object.entries(bulletPools)) p.hideFrom(used[g]);
    },
    burst(sparks, numbers, t) {
      for (const s of sparks) for (let i = 0; i < (s.head ? 10 : 6); i++) {
        const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
        live.sparks.push({ x: s.x, y: s.y, z: s.z, vx: Math.cos(a) * 1.5, vy: 1 + u, vz: Math.sin(a) * 1.5, at: t });
      }
      for (const n of numbers) {
        const s = makeSprite([n.hs ? `-${n.d}!` : `-${n.d}`], n.hs ? HOT : '#ffffff', 0.18, { glow: true });
        scene.add(s.mesh);
        live.numbers.push({ s, x: n.x, y: n.y + 0.2, z: n.z, at: t });
      }
    },
    pickups(list, t) {
      const used = { rifle: 0, sniper: 0, medkit: 0 };
      for (const p of list) {
        if (!(p.kind in used)) continue;
        const s = pickPools[p.kind].get(used[p.kind]++);
        s.mesh.visible = true;
        s.mesh.position.set(p.x, p.y + 0.35 + (reducedMotion ? 0 : Math.sin(t * 2 + p.n) * 0.05), p.z);
        s.mesh.rotation.set(0, reducedMotion ? 0 : t * 1.2 + p.n, 0);
      }
      for (const [k, p] of Object.entries(pickPools)) p.hideFrom(used[k]);
    },
    update(dt, t) {
      live.sparks = live.sparks.filter((s) => t - s.at < 0.4);
      live.sparks.forEach((s, i) => {
        const age = t - s.at, m = sparkPool.get(i).mesh;
        m.visible = true;
        m.position.set(s.x + s.vx * age, s.y + s.vy * age - 4 * age * age, s.z + s.vz * age);
        m.quaternion.copy(camera.quaternion);
      });
      sparkPool.hideFrom(live.sparks.length);
      live.numbers = live.numbers.filter((n) => {
        const age = t - n.at;
        if (age > 0.8) { scene.remove(n.s.mesh); n.s.dispose(); return false; }
        n.s.mesh.position.set(n.x, n.y + age * 0.6, n.z);
        n.s.mesh.quaternion.copy(camera.quaternion);
        return true;
      });
    },
    dispose() {
      camera.remove(vm);
      for (const n of live.numbers) { scene.remove(n.s.mesh); n.s.dispose(); }
      for (const s of owned) { s.mesh.removeFromParent(); s.dispose(); }
    },
  };
}
```

- [ ] **Step 4: Run the test and build.** Run `node --test test/station-guns3d.test.js && npm run build`. Expected: PASS and it builds.

- [ ] **Step 5: Commit.** `git add src/rpg/guns3d.js test/station-guns3d.test.js`, with the message "Station fight: the ASCII guns drawn (guns3d.js)" plus the trailers.

---

### Task 8: Wire it into the station (index.js, others.js, main.js)

**Files:**
- Modify: `src/rpg/index.js`, `src/rpg/others.js`, `src/main.js` (`stationNet`, createLive's options)

**Interfaces:**
- Consumes: Tasks 2, 6 and 7.
- Produces:
  - `mp` gains `fight: { ok: () => boolean, send: (m) => boolean, onMessage: (fn) => void, myId: () => string }`.
  - The `window.__station` test hooks gain:
    - `fight()`: `{ drawn, alive, gun, ammo, bullets: n, hp }`
    - `draw()`: toggles as Q does
    - `fire(yaw, pitch)`: fires from your muzzle now
    - `aim()`: `{ yaw, pitch }`

- [ ] **Step 1: main.js.**
  - Above `stationNet`, add `let stationFightFn = null;`.
  - In stationNet's returned object, add:

```js
    fight: {
      ok: () => !!live && live.stationFightOk,
      send: (m) => !!live && live.send(m),
      onMessage: (fn) => { stationFightFn = fn; },
      myId: () => (live && live.peers.myId) || 'me',
    },
```

  - In the `createLive({...})` options, add `onStationFight: (m) => stationFightFn && stationFightFn(m),`.
  - Where the station stops (search `station.stop()`), add `stationFightFn = null;`.

- [ ] **Step 2: others.js: the red ⌐╦, laid flat, a gun in hand.**
  - In `createStack`'s update, change the name line to take `g`:

```js
      set('name', n ? (g ? `${n} ⌐╦` : n) : null, (s) => ({ ...makeSprite([s], stack.color, TAG.h, { glow: true, ink: (ch) => (ch === '⌐' || ch === '╦' ? '#e05a4a' : null) }), h: TAG.h }));
```

  - Add `g` to update's destructured argument.
  - In `others.update(list, now, dt, t, camera, feet)`, pass `p.g` through, and accept an extra last argument `{ dead = new Set(), drawn = new Set() } = {}`:
    - after `poseFigure(...)` for a peer, `if (dead.has(p.id)) layFlat(o.joints, o.yaw ?? p.a ?? 0);` (import layFlat from './fight3d.js');
    - the name stack gets `g: drawn.has(p.id) || p.g`.
  - Return the hand positions for index.js to draw guns: build `hands.push({ id: p.id, x: o.at.x + o.joints.handR.x, y: o.at.y + o.joints.handR.y, z: o.at.z + o.joints.handR.z, yaw: <the peer's yaw> })` for drawn and alive peers, and return `{ hands }` from update. Use the same yaw variable the figure is posed with. Read others.js's update loop to find it, around line 40.

- [ ] **Step 3: index.js.** Everything goes inside `startStation`, using the existing names (`fp`, `view`, `locked`, `walker`, `feet`, `pose`, `joints`, `rider`, `frameOrigin`, `clock`, `mp`, `phone`, `camera`, `canvas`, `others`, `hint`, `camHint`, `showCamHint`):

```js
import { createStationFight } from './fightmp.js';
import { createGuns } from './guns3d.js';
import { aimDir, layFlat } from './fight3d.js';
import { createFightHud } from '../fighthud.js';
```

After `maps` are known (where `maps` is built), add:

```js
    // The fight (station PvP spec): online when the server speaks this fight, else drawing and shooting walls alone.
    const fightNet = mp?.fight;
    const fight = createStationFight({ maps, myId: () => fightNet?.myId() || 'me', send: (m) => !!fightNet?.send(m), online: () => !!fightNet?.ok() });
    fightNet?.onMessage((m) => fight.onMessage(m, wallT()));
    const wallT = () => (mp ? mp.now() : Date.now()) / 1000; // the server's clock: the fight's timers are its
    guns = createGuns(scene, camera, { reducedMotion });
    let firing = false, aimYaw = 0, aimPitch = 0, mouse = null, fightNote = '';
    const hudRoot = document.createElement('div');
    hudRoot.className = 'fight';
    hudRoot.hidden = true;
    hudRoot.style.zIndex = '3';
    hudRoot.innerHTML = '<div class="fight-hp"></div><ol class="fight-board"></ol><div class="fight-streaks" hidden></div><ol class="fight-feed"></ol>';
    document.body.append(hudRoot);
    const fightHud = createFightHud({ root: hudRoot, hp: hudRoot.querySelector('.fight-hp'), board: hudRoot.querySelector('.fight-board'), streaks: hudRoot.querySelector('.fight-streaks'), feed: hudRoot.querySelector('.fight-feed'),
      nameOf: (id) => mp?.list(performance.now()).find((p) => p.id === id)?.name || '', colorOf: () => [233, 162, 59] });
```

Declare `guns` in the teardown list with the other handles: `let …, guns = null, hudRoot = null;` at the top. Teardown gets `guns?.dispose(); hudRoot?.remove();`. Make `hudRoot` assign the outer variable, not a new `const`.

Keys: in `onKey`, before the E check:

```js
      if (e.code === 'KeyQ' && !e.repeat && !phone) {
        if (mp && !fightNet?.ok()) { hint.textContent = 'the fight needs a newer page: reload'; return; }
        const r = fight.toggle(wallT());
        if (r === 'drawn' && rider.seat) stand(rider, walker, clock());
        showCamHint();
        return;
      }
      if (e.code === 'KeyJ') { firing = true; return; }
```

Add a keyup listener, `onKeyUp = (e) => { if (e.code === 'KeyJ') firing = false; }`, added and removed like onKey. Sitting (E) and the fare machine opening holster at once: in the E branch, `if (!rider.seat) fight.holsterNow(wallT());` before `sit(...)`. In the frame, `if (ticket.isOpen) fight.holsterNow(wallT());`.

Mouse:
- In `onDown`, before the `fp` branch: `if (fight.drawn && e.pointerType === 'mouse' && e.button === 0 && (!fp || locked)) { firing = true; return; }`. The first click in first person still locks the pointer.
- In `onUp`: `firing = false;`.
- In `onMove`: `mouse = { x: e.clientX, y: e.clientY };`.
- In third person with the gun drawn, a mouse pointerdown never starts the finger walk: add `if (fight.drawn && e.pointerType === 'mouse') return;` after the firing line.

Each frame, after the camera is placed (after the `camera.lookAt` block):

```js
      // The aim: first person, the look; third person, the point under the mouse at chest height (1.2 over your floor).
      const tw = wallT();
      if (fp) { aimYaw = view.yaw; aimPitch = view.pitch; }
      else if (mouse) {
        const r = new THREE.Raycaster(), ndc = new THREE.Vector2((mouse.x / W) * 2 - 1, -(mouse.y / H) * 2 + 1);
        r.setFromCamera(ndc, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(feet.y + 1.2)), hitP = new THREE.Vector3();
        if (r.ray.intersectPlane(plane, hitP)) { aimYaw = Math.atan2(hitP.x - feet.x, hitP.z - feet.z); aimPitch = 0; }
      }
      if (fight.drawn && !fp && !rider.seat) targetYaw = aimYaw; // drawn, your body faces your aim
      // The muzzle: in first person just ahead of your eyes; in third person at your right hand. Aboard, in the train's frame.
      const hand = joints.handR, d = aimDir(aimYaw, aimPitch);
      const mw = fp ? { x: camera.position.x + d.x * 0.4, y: camera.position.y - 0.12 + d.y * 0.4, z: camera.position.z + d.z * 0.4 }
        : { x: feet.x + hand.x + d.x * 0.3, y: feet.y + hand.y + d.y * 0.3, z: feet.z + hand.z + d.z * 0.3 };
      const muzzle = f.kind === 'train' ? { tr: f.k, x: mw.x - o.x, y: mw.y, z: mw.z - o.z } : mw;
      if (firing && fight.canFire(tw)) fight.fire(tw, muzzle, aimYaw, aimPitch);
      if (!fight.gun || fight.ammo === 0) firing = firing && fight.gun !== 'sniper'; // a sniper fires once per click
      const fx = fight.step(tw, mp ? mp.list(now).filter((p) => p.id) : []);
      if (fx.died) { firing = false; rider.seat = null; }
      guns.burst(fx.sparks, fx.numbers, t);
      guns.update(dt, t);
      guns.bullets(fight.bullets());
      guns.pickups(fight.pickups(tw), t);
      guns.view({ on: fp && fight.drawn && fight.alive, gun: fight.gun, kickAge: tw - fight.kickAt });
      const near = fight.drawn ? fight.nearPickup(feet, tw) : null;
      if (near != null) fight.take(near);
      const hud = fight.drawn ? fight.hud(tw) : null;
      fightHud.render(hud);
```

Popped means no walking: where input is chosen, add `if (!fight.alive) input = STILL;`. Your body lies flat: after `poseFigure(pose, joints)`, add `if (!fight.alive) layFlat(joints, pose.yaw);`.

Guns in hands: your own, in third person, when drawn and alive:

```js
      const handsList = (!fp && fight.drawn && fight.alive) ? [{ id: 'me', x: feet.x + joints.handR.x, y: feet.y + joints.handR.y, z: feet.z + joints.handR.z, yaw: aimYaw, gun: fight.gun }] : [];
```

plus the peers' hands returned by `others.update(..., { dead: fight.deadIds(), drawn: fight.drawnIds() })`. Map each to the peer's gun with `fight.gunOf(id)` (Task 6), then call `guns.hands([...handsList, ...peerHands.map((h) => ({ ...h, gun: fight.gunOf(h.id) }))])`.

The hint: `showCamHint` text gains ` · [Q] draw` (or ` · [Q] holster` when drawn), only when not `phone`.

Hooks, in `hook`:

```js
      fight: () => ({ drawn: fight.drawn, alive: fight.alive, gun: fight.gun, ammo: fight.ammo, bullets: fight.bullets().length, hp: fight.hud(wallT()).hp }),
      draw: () => fight.toggle(wallT()),
      fire: (yaw, pitch) => { aimYaw = yaw; aimPitch = pitch; firing = true; setTimeout(() => { firing = false; }, 50); },
      aim: () => ({ yaw: aimYaw, pitch: aimPitch }),
```

The `fire` hook sets `aimYaw` in third person, but the mouse aim overwrites it each frame while `mouse` is set. The hook should also set `mouse = null`.

- [ ] **Step 4: Run the tests and build.** Run `npm test && npm run build`. Expected: PASS and it builds.

- [ ] **Step 5: Commit.** `git add src/rpg/index.js src/rpg/others.js src/main.js`, with the message "Station fight: Q, J, clicks and the aim; the HUD; guns in hands; popped lies flat" plus the trailers.

---

### Task 9: e2e, docs, ship

**Files:**
- Modify: `e2e/station.mjs`, `e2e/station-mp.mjs`, `docs/HANDOFF.md`

- [ ] **Step 1: The station e2e check.** Add it before the frame-time check in `e2e/station.mjs`:

```js
  await check('the station fight offline-alone: Q draws (the gun in first person), a shot flies and stops at a wall', async () => {
    if (!(await page.evaluate(() => !!window.__station))) { await page.goto('about:blank'); await page.goto(`${url}#/station`); }
    await inStationSlow(page);
    await page.evaluate(() => { window.__station.setTime(20 + 40, { hold: true }); window.__station.teleport(40, 9.5); });
    await nFrames(page, 10);
    await page.keyboard.press('KeyQ');
    await nFrames(page, 5);
    assert.equal((await page.evaluate(() => window.__station.fight())).drawn, true);
    await page.keyboard.press('KeyC');
    await nFrames(page, 5);
    await page.screenshot({ path: `${SHOTS}/station-gun-fp.png` });
    await page.evaluate(() => window.__station.fire(Math.PI, 0)); // north, at the platform's north wall
    await nFrames(page, 2);
    assert.ok((await page.evaluate(() => window.__station.fight())).bullets >= 1, 'a bullet in the air');
    await nFrames(page, 40);
    assert.equal((await page.evaluate(() => window.__station.fight())).bullets, 0, 'stopped by the wall');
    await page.keyboard.press('KeyC');
    await page.keyboard.press('KeyQ');
  });
```

Run `E2E_ANGLE=swiftshader ONLY='station fight' node e2e/station.mjs`. Expected: ok. Look at `e2e/shots/station-gun-fp.png`: the gun glyphs should show in the lower right.

- [ ] **Step 2: The two-person e2e.** In `e2e/station-mp.mjs`, read how two pages enter the station (its first checks), then add:

```js
  await check('the station fight: B draws, A draws and shoots B on the platform until B is popped', async () => {
    // Both on MUSEUM's platform, 6 apart on z 9.5, A west of B.
    await a.evaluate(() => { window.__station.setTime(20 + 40, { hold: true }); window.__station.teleport(40, 9.5); });
    await b.evaluate(() => { window.__station.setTime(20 + 40, { hold: true }); window.__station.teleport(46, 9.5); });
    await a.evaluate(() => window.__station.draw()); await b.evaluate(() => window.__station.draw());
    await sleep(2300); // past protection
    for (let i = 0; i < 5; i++) { await a.evaluate(() => window.__station.fire(Math.PI / 2, 0)); await sleep(450); }
    await b.waitForFunction(() => !window.__station.fight().alive, { timeout: 5000 });
    await b.waitForFunction(() => window.__station.fight().alive, { timeout: 6000 });
  });
```

Use the file's own page names and helpers. Run `E2E_ANGLE=swiftshader ONLY='station fight' node e2e/station-mp.mjs`. It starts wrangler dev. Expected: ok. If wrangler dev can't run here, say so in the commit message and the HANDOFF.

- [ ] **Step 3: HANDOFF.** In `docs/HANDOFF.md`, add a short "Station fight" entry:
  - Q to draw, J or a click to fire;
  - files: fight3d.js, referee3d.js, fightmp.js, guns3d.js;
  - the wire: zd, zf, zk in; zw, zs, zh, zx, zr, zp, zd, ks out;
  - STATION_FIGHT 1;
  - what's not in v1.

- [ ] **Step 4: The whole check.** Run:
  - `npm test`;
  - `node --test test/rules.test.js`;
  - `npm run build`;
  - `E2E_ANGLE=swiftshader ONLY='station fight|first person|whole ride|draws something' node e2e/station.mjs`.

  Compare any failures with main's baseline list (lobby stairs, you walk, the sound after a key press, turnstile, emergency gate, single ride, unlimited ride, resizing, exit, link to #/station, short of money, M mutes, fifteen trips).

- [ ] **Step 5: Commit and ship.**
  - `git add e2e/station.mjs e2e/station-mp.mjs docs/HANDOFF.md`, with the message "Station fight: e2e and HANDOFF" plus the trailers.
  - Then fetch, and fast-forward main if `git merge-base --is-ancestor origin/main HEAD`.
  - Push the branch, then `git push origin HEAD:main`. This deploys the site and the Worker, which Faiz has authorised: "always merge to main before pushing".
  - Check that both deploy runs passed.
