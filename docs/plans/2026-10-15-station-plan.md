# The Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A subway station in the HD-2D ("Octopath, ASCII world") look, reached by stairs in the museum's lobby and left by its exit stairs, with tight free movement and a train that passes every 30–40 s.

**Architecture:** The pure logic lives in `src/rpg/` with no three.js, so it's unit tested with `node --test`: the map format and its checker, the movement, the train's schedule and the camera's maths. The three.js parts (scene, sprites, post-processing, loop) are loaded with `import()` only when you take the stairs. `main.js` freezes the gallery, starts the station into its own canvas over the stage, and puts the gallery back when you come up.

**Tech Stack:** Vanilla JS (ES modules), Vite 5, three.js 0.186.1 (with `three/addons` EffectComposer, UnrealBloomPass, ShaderPass and OutputPass), `node --test` and Puppeteer.

**Spec:** `docs/specs/2026-10-15-station-design.md`

## Global Constraints

- The whole station lives in `src/rpg/`. Only `index.js`, `scene.js`, `sprites.js` and `post.js` import `three`. `map.js`, `check.js`, `move.js`, `train.js` and `camera.js` must stay importable by node.
- `three` is pinned to an exact version, `"three": "0.186.1"` (published 2026-09-24, over two weeks old). It is a `dependency`, not a devDependency.
- The gallery's bundle must not include three.js. The only way into `src/rpg/index.js` is `import('./rpg/index.js')` in `main.js`.
- World units: one map tile is 1 × 1, x is the column (east), z is the row (south) and y is up. The levels are hall 0, platform −3 and track −4.2.
- Movement: speed 4.2 units/s, sprint ×1.6, 0.04 s to 63% of the target, radius 0.25 and corner nudge 0.2.
- Camera: pitch 35°, 10 units from you, 1 unit of lift, a 0.15 s spring, 12 tiles across on wide screens and 8 on portrait. It never rotates.
- Train: every 30–40 s, alternating tracks, 25 units/s, 4 cars, the tunnel glowing for 3 s first.
- Reduced motion: no camera shake, no flicker strobe, slower motes, and fades cut instantly. The train still passes.
- The device-pixel-ratio cap is 2 on desktop and 1.5 on phones.
- Code style follows the repo: 2-space indent, single quotes, semicolons, short comments that say why, and comments that cite the spec ("station spec §N").
- Commit messages follow the repo's style ("Station: …", a sentence saying what changed) and end with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **A slow frame or a hidden tab.** When you come back to the tab, a large `dt` must never carry you through a wall or off the map. `stepWalker` sub-steps at most 0.1 units per check (Task 4 tests a `dt` of 1 s against a 1-tile wall).
2. **The station fails to load.** If you're offline, the import 404s or WebGL is unavailable, you must stay in the gallery, unfrozen, with a note "the station couldn't load", and with no half-built canvas left behind. (Task 9 handles it. Task 10's e2e blocks `/src/rpg/index.js` and checks it.)
3. **Going straight back down.** Coming up must not drop you back onto the stairs. You stand two rows in front of the stairwell, and walking onto it again is a deliberate act (Task 10's e2e waits 0.8 s and checks you're still in the gallery).
4. **Going down twice, or leaving while still loading.** Taps or keys during the fade or the import, a second trigger on the stairs, or the back button while the import is still loading must not start two stations or leave the page frozen. `stationState` gates every transition (Task 9). Task 10's e2e presses back during the walk down.
5. **Resizing or rotating the phone in the station.** The canvas, camera aspect, field of view and post-processing targets all follow the window (Task 8's `resize`; Task 10's e2e resizes and checks the canvas fills the window).

---

### Task 1: The `#/station` route

**Files:**
- Modify: `src/router.js`
- Test: `test/router.test.js`

**Interfaces:**
- Produces: `parseRoute('#/station')` returns `{ kind: 'station' }`, and `STATION_HASH === '#/station'`.

- [ ] **Step 1: Write the failing test.** Append to `test/router.test.js`:

```js
import { STATION_HASH } from '../src/router.js';

test('the station has its own route', () => {
  assert.deepEqual(parseRoute('#/station'), { kind: 'station' });
  assert.equal(STATION_HASH, '#/station');
  assert.deepEqual(parseRoute(STATION_HASH), { kind: 'station' });
  assert.equal(parseRoute('#/station/x').kind, 'unknown');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/router.test.js`
Expected: FAIL, because `STATION_HASH` is undefined and `parseRoute('#/station')` returns `{ kind: 'unknown', … }`.

- [ ] **Step 3: Implement it.** In `src/router.js`, change the header comment and `parseRoute`, then add the constant:

```js
// Hash routes: #/photo/<id>, #/room/<id>, #/all (every photo as a grid) and #/station (the subway, station
// spec §1). Pure parsing plus small helpers around history.

export function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h || h === '/') return null;
  if (h === '/all') return { kind: 'all' };
  if (h === '/station') return { kind: 'station' };
  const m = h.match(/^\/(photo|room)\/(.+)$/);
  if (!m) return { kind: 'unknown', id: h };
  let id;
  try { id = decodeURIComponent(m[2]); } catch { return { kind: 'unknown', id: m[2] }; }
  return { kind: m[1], id };
}
```

Next to `ALL_HASH`, add:

```js
export const STATION_HASH = '#/station';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/router.test.js`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/router.js test/router.test.js
git commit -m "Station: a #/station route

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The station's map and its reader

**Files:**
- Create: `src/rpg/station.txt`
- Create: `src/rpg/map.js`
- Test: `test/station-map.test.js`

**Interfaces:**
- Produces, from `src/rpg/map.js`:
  - `LEVEL = { hall: 0, platform: -3, track: -4.2 }`
  - `STAIRS = { v: [0, 1], '^': [0, -1], '>': [1, 0], '<': [-1, 0] }`
  - `KNOWN` (a Set of every map character)
  - `N4` (the 4 neighbour offsets `[dc, dr]`)
  - `readLines(text) → { name, grid: string[] }`
  - `parseStation(text) → map`, where `map` is:
    - `name: string`, `cols: number`, `rows: number`
    - `cells: Array<{ c, r, ch, walk: boolean, level: number|null, stair: { dx, dz, start, len, from, to }|null }>`
    - `at(c, r) → cell|null`
    - `levelAt(x, z) → number|null`
    - `solidAt(x, z) → boolean` (true off the map)
    - `spawn: { x, z }|null`, `exits: { x, z }[]`, `signs: { x, z }[]`
    - `tubes: { x, y, z }[]`
    - `tracks: { z0, z1, z, y }[]`

- [ ] **Step 1: Write the map.** Create `src/rpg/station.txt` exactly as follows. Every grid row is 48 characters.

```
name: MUSEUM
; The station (station spec §3). One character is one 1 × 1 tile; see src/rpg/MAPS.md.
; Check it with: node src/rpg/check.js src/rpg/station.txt
########n###########n###########n###########n###
================================================
================================================
================================================
####################!!!!!!!!!!!!!!!!!!!!!!!!!!!#
##.kkk......########___________________________#
##.kkk......:.>>>>>>___________________________#
##..........t.>>>>>>______b_____b_____b_____b__#
#E..........:.>>>>>>___________________________#
#ES.........t.>>>>>>___|_____|_____|_____|_____#
#E..........:.>>>>>>___________________________#
##..........t.>>>>>>______b_____b_____b_____b__#
##......~...:.>>>>>>__________________~________#
##..........########___________________________#
####################!!!!!!!!!!!!!!!!!!!!!!!!!!!#
================================================
================================================
================================================
################################################
```

- [ ] **Step 2: Write the failing tests.** Create `test/station-map.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation, LEVEL } from '../src/rpg/map.js';

// A hall, two stair tiles down to the platform, its edge and a track.
const TINY = [
  'name: TINY',
  '; a comment',
  '########',
  '#S.>>__#',
  '#..>>__#',
  '#####!!#',
  '========',
  '########',
].join('\n');

test('reads the header, the size and the spawn', () => {
  const m = parseStation(TINY);
  assert.equal(m.name, 'TINY');
  assert.equal(m.cols, 8);
  assert.equal(m.rows, 6);
  assert.deepEqual(m.spawn, { x: 1.5, z: 1.5 });
  assert.deepEqual(m.exits, []);
});

test('floors have their levels; neutral tiles take the floor around them', () => {
  const m = parseStation(TINY);
  assert.equal(m.levelAt(2.5, 1.5), LEVEL.hall);
  assert.equal(m.levelAt(1.5, 1.5), LEVEL.hall, 'S takes the hall');
  assert.equal(m.levelAt(5.5, 1.5), LEVEL.platform);
  assert.equal(m.levelAt(5.5, 3.5), LEVEL.platform, 'the edge');
  assert.equal(m.levelAt(3.5, 4.5), LEVEL.track);
  assert.equal(m.levelAt(-1, 1), null, 'off the map');
});

test('stairs slope from the level behind the run to the level in front', () => {
  const m = parseStation(TINY);
  assert.equal(m.levelAt(3.0, 1.5), 0);
  assert.equal(m.levelAt(4.0, 1.5), -1.5);
  assert.ok(Math.abs(m.levelAt(4.5, 1.5) + 2.25) < 1e-9);
  const down = parseStation(['###', '#S#', '#v#', '#v#', '#_#', '###'].join('\n'));
  assert.equal(down.levelAt(1.5, 2.0), 0);
  assert.equal(down.levelAt(1.5, 3.0), -1.5);
  assert.equal(down.levelAt(1.5, 4.0), -3);
  const left = parseStation(['#####', '#_<<.', '#####'].join('\n'));
  assert.equal(left.levelAt(4.0, 1.5), 0, 'the run starts at its right edge');
  assert.equal(left.levelAt(2.0, 1.5), -3);
});

test('solid tiles and the edge of the map block', () => {
  const m = parseStation(TINY);
  assert.equal(m.solidAt(0.5, 0.5), true, 'wall');
  assert.equal(m.solidAt(1.5, 1.5), false, 'spawn');
  assert.equal(m.solidAt(3.5, 1.5), false, 'stairs');
  assert.equal(m.solidAt(3.5, 4.5), true, 'track');
  assert.equal(m.solidAt(-0.5, 1.5), true, 'off the map');
  assert.equal(m.solidAt(1.5, 99), true, 'off the map');
});

test('a short row is padded with wall', () => {
  const m = parseStation(['####', '#S.', '####'].join('\n'));
  assert.equal(m.cols, 4);
  assert.equal(m.at(3, 1).ch, '#');
});

test('tracks are bands of = rows', () => {
  assert.deepEqual(parseStation(TINY).tracks, [{ z0: 4, z1: 5, z: 4.5, y: LEVEL.track }]);
});

test('the shipped station', () => {
  const m = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
  assert.equal(m.name, 'MUSEUM');
  assert.equal(m.cols, 48);
  assert.equal(m.rows, 19);
  assert.deepEqual(m.spawn, { x: 2.5, z: 9.5 });
  assert.equal(m.exits.length, 3);
  assert.equal(m.signs.length, 4);
  assert.deepEqual(m.tracks.map((t) => [t.z0, t.z1]), [[1, 4], [15, 18]]);
  assert.equal(m.tubes.length, 13, 'five over the platform, eight over the hall');
  assert.equal(m.levelAt(14.0, 9.5), 0, 'top of the stairs');
  assert.equal(m.levelAt(20.0, 9.5), -3, 'foot of the stairs');
  for (const t of m.tubes) assert.ok(!m.solidAt(t.x, t.z) || m.at(Math.floor(t.x), Math.floor(t.z)).ch === '|', 'tubes hang over floor');
});
```

In the `left` map of the third test, cols 2–3 are the stairs, col 4 is the hall and col 1 is the platform.

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test test/station-map.test.js`
Expected: FAIL with "Cannot find module '…/src/rpg/map.js'".

- [ ] **Step 4: Implement `src/rpg/map.js`**

```js
// The station's map (station spec §3): a text grid in which one character is one 1 × 1 tile. x is the
// column (east), z the row (south) and y is up. Pure (no three.js), so the checker and the tests use it too.
export const LEVEL = { hall: 0, platform: -3, track: -4.2 };
const FIXED = { '.': LEVEL.hall, t: LEVEL.hall, ':': LEVEL.hall, k: LEVEL.hall, _: LEVEL.platform, '!': LEVEL.platform, '=': LEVEL.track };
const NEUTRAL = new Set(['b', '~', 'S', 'E', '|']); // they take the level of the floor around them
export const STAIRS = { v: [0, 1], '^': [0, -1], '>': [1, 0], '<': [-1, 0] }; // the way the floor goes down
const WALK = new Set(['.', '_', '!', ':', '~', 'S', 'E', ...Object.keys(STAIRS)]);
export const KNOWN = new Set(['#', 'n', '=', '|', 'b', 't', 'k', ...WALK]);
export const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TUBE = 3.4; // fluorescent tubes hang this far over the floor

// The header (name:, and ; comments) and the grid's lines as written.
export function readLines(text) {
  let name = 'STATION';
  const grid = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith(';')) continue;
    const m = /^name:\s*(.+)$/.exec(line);
    if (m && !grid.length) { name = m[1].trim(); continue; }
    grid.push(line);
  }
  return { name, grid };
}

export function parseStation(text) {
  const { name, grid } = readLines(text);
  const rows = grid.length, cols = grid.reduce((m, l) => Math.max(m, l.length), 0);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = grid[r][c] ?? '#'; // a short row is padded with wall (the checker reports it)
    cells.push({ c, r, ch, walk: WALK.has(ch), level: ch in FIXED ? FIXED[ch] : null, stair: null });
  }
  const at = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? cells[r * cols + c] : null);

  // Neutral tiles take a neighbour's level, spreading until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    for (const cell of cells) {
      if (!NEUTRAL.has(cell.ch) || cell.level != null) continue;
      for (const [dc, dr] of N4) {
        const n = at(cell.c + dc, cell.r + dr);
        if (n && n.level != null && !(n.ch in STAIRS)) { cell.level = n.level; changed = true; break; }
      }
    }
  }

  // Stairs: a run of one arrow along its direction. The floor goes from the level behind the run to the one
  // in front of it.
  for (const cell of cells) {
    if (!(cell.ch in STAIRS) || cell.stair) continue;
    const [dx, dz] = STAIRS[cell.ch];
    let sc = cell.c, sr = cell.r;
    while (at(sc - dx, sr - dz)?.ch === cell.ch) { sc -= dx; sr -= dz; }
    let len = 0;
    while (at(sc + dx * len, sr + dz * len)?.ch === cell.ch) len++;
    const behind = at(sc - dx, sr - dz), front = at(sc + dx * len, sr + dz * len);
    const start = dx > 0 ? sc : dx < 0 ? sc + 1 : dz > 0 ? sr : sr + 1; // the run's back edge, in world units
    const stair = { dx, dz, start, len, from: behind?.level ?? null, to: front?.level ?? null };
    for (let k = 0; k < len; k++) { const s = at(sc + dx * k, sr + dz * k); s.stair = stair; s.level = stair.from ?? stair.to; }
  }

  const levelAt = (x, z) => {
    const cell = at(Math.floor(x), Math.floor(z));
    if (!cell) return null;
    const s = cell.stair;
    if (s && s.from != null && s.to != null) {
      const along = s.dx ? (x - s.start) * s.dx : (z - s.start) * s.dz; // 0 at the back edge, len at the front
      return s.from + (s.to - s.from) * Math.min(1, Math.max(0, along / s.len));
    }
    return cell.level;
  };
  const solidAt = (x, z) => { const cell = at(Math.floor(x), Math.floor(z)); return !cell || !cell.walk; };
  const centre = (cell) => ({ x: cell.c + 0.5, z: cell.r + 0.5 });

  // Tubes: along the middle row of each platform band every 5 columns, and on a 4-tile grid over the hall.
  const tubes = [];
  for (const band of bands((r) => grid[r].includes('_'), rows)) {
    const mid = Math.round((band[0] + band.at(-1)) / 2);
    for (let c = 2; c < cols; c += 5) {
      const cell = at(c, mid);
      if (cell && cell.level != null && (cell.ch === '_' || cell.ch === '|')) tubes.push({ x: c + 0.5, y: cell.level + TUBE, z: mid + 0.5 });
    }
  }
  for (const cell of cells) if (cell.ch === '.' && cell.c % 4 === 2 && cell.r % 4 === 1) tubes.push({ x: cell.c + 0.5, y: cell.level + TUBE, z: cell.r + 0.5 });

  const tracks = bands((r) => grid[r].includes('='), rows).map((b) => ({ z0: b[0], z1: b.at(-1) + 1, z: (b[0] + b.at(-1) + 1) / 2, y: LEVEL.track }));
  const spawn = cells.find((cell) => cell.ch === 'S');
  return {
    name, cols, rows, cells, at, levelAt, solidAt, tubes, tracks,
    spawn: spawn ? centre(spawn) : null,
    exits: cells.filter((cell) => cell.ch === 'E').map(centre),
    signs: cells.filter((cell) => cell.ch === 'n').map(centre),
  };
}

// Runs of consecutive rows that pass `test`, as arrays of row numbers.
function bands(test, rows) {
  const out = [];
  let cur = null;
  for (let r = 0; r < rows; r++) {
    if (test(r)) (cur ||= []).push(r);
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/station-map.test.js`
Expected: every test passes. If the tube count differs, recount against the map before changing the rule. Over the platform there are five tubes on row 9 at cols 22, 27, 32, 37 and 42. Over the hall there are eight more: `.` cells with `c % 4 === 2` and `r % 4 === 1`, at (2,5), (6,5), (10,5), (6,9), (10,9), (2,13), (6,13) and (10,13). (2,9) is the `S`, so it has none.

- [ ] **Step 6: Commit**

```bash
git add src/rpg/station.txt src/rpg/map.js test/station-map.test.js
git commit -m "Station: the map, a 48 × 19 hall, stairs and island platform between two tracks, and its reader

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The map checker, and the format written up for authors

**Files:**
- Create: `src/rpg/check.js`
- Create: `src/rpg/MAPS.md`
- Test: `test/station-check.test.js`

**Interfaces:**
- Consumes: `parseStation`, `readLines`, `KNOWN`, `STAIRS` and `N4` from `src/rpg/map.js`.
- Produces: `checkStation(text) → Array<{ row, col, msg }>`, sorted by row then column. It is empty for a good map. Rows and columns are 0-based grid positions, not counting header lines. It also works as a CLI: `node src/rpg/check.js [file]` exits with 1 on errors.

- [ ] **Step 1: Write the failing tests.** Create `test/station-check.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkStation } from '../src/rpg/check.js';

const GOOD = [
  '########',
  '#ES>>__#',
  '#..>>__#',
  '#####!!#',
  '========',
  '########',
];
const msgs = (rows) => checkStation(rows.join('\n')).map((e) => e.msg).join(' | ');
const swap = (rows, r, c, ch) => rows.map((l, i) => (i === r ? l.slice(0, c) + ch + l.slice(c + 1) : l));

test('a good map has no errors, and neither does the shipped station', () => {
  assert.deepEqual(checkStation(GOOD.join('\n')), []);
  assert.deepEqual(checkStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8')), []);
});

test('ragged rows and unknown characters', () => {
  assert.match(msgs([...GOOD.slice(0, 2), '#..>>_#', ...GOOD.slice(3)]), /row is 7 wide/);
  assert.match(msgs(swap(GOOD, 2, 1, 'Q')), /unknown tile 'Q'/);
});

test('exactly one S and at least one E', () => {
  assert.match(msgs(swap(GOOD, 2, 1, 'S')), /exactly one S/);
  assert.match(msgs(swap(GOOD, 1, 1, '.')), /no E/);
});

test('every walkable tile can be reached from S', () => {
  const walled = swap(swap(GOOD, 1, 5, '#'), 2, 5, '#'); // the platform cut off from the stairs
  assert.match(msgs(walled), /cannot be reached from S/);
});

test('stairs go down in their arrow\'s direction, with floor at both ends', () => {
  assert.match(msgs(swap(swap(GOOD, 1, 3, '<'), 1, 4, '<')), /must go down/);
  const noEnd = ['######', '#ES>>#', '#..>>#', '######'];
  assert.match(msgs(noEnd), /floor at both ends/);
});

test('no floor beside a stair run, and no drop between floors', () => {
  const beside = ['#######', '#ES>>_#', '#..._.#', '####!!#', '=======', '#######'];
  assert.match(msgs(beside), /floor beside a stair run/);
  const cliff = ['#######', '#ES._!#', '#....!#', '######=', '======='];
  assert.match(msgs(cliff), /a drop between two floors/);
});

test('tracks run edge to edge, with a platform edge beside them', () => {
  assert.match(msgs(swap(GOOD, 4, 7, '#')), /edge to edge/);
  assert.match(msgs(swap(swap(GOOD, 3, 5, '_'), 3, 6, '_')), /no platform edge/);
  assert.match(msgs(swap(GOOD, 2, 6, '!')), /'!' must be next to the track/);
});

test('the command line checks a file', () => {
  const out = execFileSync('node', ['src/rpg/check.js', 'src/rpg/station.txt'], { encoding: 'utf8' });
  assert.match(out, /^ok/m);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/station-check.test.js`
Expected: FAIL, because `src/rpg/check.js` doesn't exist.

- [ ] **Step 3: Implement `src/rpg/check.js`**

```js
// Checks a station map (station spec §3) and says what's wrong, by row and column, so whoever drew it
// (a person or a model) can fix it. `node src/rpg/check.js [file]` checks a file from the command line.
import { parseStation, readLines, KNOWN, STAIRS, N4 } from './map.js';

export function checkStation(text) {
  const errors = [];
  const err = (row, col, msg) => errors.push({ row, col, msg });
  const { grid } = readLines(text);
  const map = parseStation(text);
  const key = (cell) => cell.r * map.cols + cell.c;

  grid.forEach((line, r) => {
    if (line.length !== map.cols) err(r, line.length, `row is ${line.length} wide; the widest is ${map.cols}`);
    [...line].forEach((ch, c) => { if (!KNOWN.has(ch)) err(r, c, `unknown tile '${ch}'`); });
  });

  const spawns = map.cells.filter((cell) => cell.ch === 'S');
  if (spawns.length !== 1) err(spawns[1]?.r ?? 0, spawns[1]?.c ?? 0, `there must be exactly one S (found ${spawns.length})`);
  if (!map.exits.length) err(0, 0, 'there is no E: no way back up to the museum');

  if (spawns.length) {
    const seen = new Set([key(spawns[0])]);
    const queue = [spawns[0]];
    while (queue.length) {
      const cell = queue.pop();
      for (const [dc, dr] of N4) {
        const n = map.at(cell.c + dc, cell.r + dr);
        if (n && n.walk && !seen.has(key(n))) { seen.add(key(n)); queue.push(n); }
      }
    }
    for (const cell of map.cells) if (cell.walk && !seen.has(key(cell))) err(cell.r, cell.c, `'${cell.ch}' cannot be reached from S`);
  }

  const runs = new Set();
  for (const cell of map.cells) {
    const s = cell.stair;
    if (!s || runs.has(s)) continue;
    runs.add(s);
    if (s.from == null || s.to == null) err(cell.r, cell.c, 'these stairs need floor at both ends of the run');
    else if (!(s.from > s.to)) err(cell.r, cell.c, `these stairs must go down in the arrow's direction (they go from ${s.from} to ${s.to})`);
  }
  for (const cell of map.cells) {
    if (!cell.stair) continue;
    const [dx, dz] = STAIRS[cell.ch];
    for (const side of [1, -1]) {
      const n = map.at(cell.c + dz * side, cell.r + dx * side);
      if (n && n.walk && n.ch !== cell.ch) err(n.r, n.c, 'floor beside a stair run: wall it off or make it part of the stairs');
    }
  }
  for (const cell of map.cells) {
    if (!cell.walk || cell.stair || cell.level == null) continue;
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const n = map.at(cell.c + dc, cell.r + dr);
      if (n && n.walk && !n.stair && n.level != null && Math.abs(n.level - cell.level) > 0.01) err(n.r, n.c, 'a drop between two floors: put stairs or a wall here');
    }
  }

  grid.forEach((line, r) => {
    if (!line.includes('=')) return;
    const bad = [...line.padEnd(map.cols, '#')].findIndex((ch) => ch !== '=');
    if (bad >= 0) err(r, bad, 'a track row must be = from edge to edge');
  });
  for (const t of map.tracks) {
    const edged = [t.z0 - 1, t.z1].some((r) => grid[r] && grid[r].includes('!'));
    if (!edged) err(t.z0, 0, 'this track has no platform edge (!) beside it');
  }
  for (const cell of map.cells) {
    if (cell.ch !== '!') continue;
    if (!N4.some(([dc, dr]) => map.at(cell.c + dc, cell.r + dr)?.ch === '=')) err(cell.r, cell.c, "'!' must be next to the track (=)");
  }

  return errors.sort((a, b) => a.row - b.row || a.col - b.col);
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('check.js')) {
  const { readFileSync } = await import('node:fs');
  const file = process.argv[2] || new URL('./station.txt', import.meta.url);
  const errors = checkStation(readFileSync(file, 'utf8'));
  for (const e of errors) console.log(`row ${e.row}, col ${e.col}: ${e.msg}`);
  console.log(errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'}` : 'ok');
  process.exitCode = errors.length ? 1 : 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/station-check.test.js`
Expected: every test passes.
- **The cliff test:** its map has `.` next to `_`, so the cliff rule fires. If the map trips another rule first, that's fine, because the test only matches the cliff message.
- **If a bad-map test doesn't produce the message it expects:** print `checkStation(...)` for that map and fix the map in the test, not the rule.

- [ ] **Step 5: Write `src/rpg/MAPS.md`**

````markdown
# Station maps

How to draw a map for the station (`src/rpg/station.txt`) or a later area. This is the format the game
reads; the spec is `docs/specs/2026-10-15-station-design.md` §3.

## The file

```
name: MUSEUM
; a line starting with ; is a comment (# is a wall)
<the grid>
```

One character is one tile of 1 × 1 world units. Rows go south, columns go east. Every row is the same width.
The player is about 0.5 wide and 1.6 tall.

| Char | Tile | Floor level | Walk |
|---|---|---|---|
| `#` | wall, tiled, 4 above the highest floor beside it | – | no |
| `.` | ticket-hall floor | 0 | yes |
| `_` | platform floor | −3 | yes |
| `!` | platform edge (the yellow line); the last row before a track | −3 | yes |
| `=` | track bed; trains run along these rows | −4.2 | no |
| `v` `^` `<` `>` | stairs; the floor goes **down** in the arrow's direction, from the level behind the run to the level in front | sloped | yes |
| `|` | pillar | – | no |
| `b` | bench | as the floor around it | no |
| `t` | turnstile post | 0 | no |
| `:` | turnstile gate | 0 | yes |
| `k` | kiosk (closed) | 0 | no |
| `n` | wall with the station's name sign on its face | – | no |
| `~` | puddle, with drips | as the floor around it | yes |
| `S` | spawn: where you arrive (exactly one) | as the floor around it | yes |
| `E` | exit up to the museum (at least one) | as the floor around it | yes |

Fluorescent tubes are placed for you: along the middle row of each platform band every 5 columns, and on a
4-tile grid over the hall. A track row that reaches the map's edge goes into a tunnel there.

## What the checker wants

Run `node src/rpg/check.js <file>` (no file: the shipped station). It prints `row R, col C: problem`
(0-based, header lines not counted) and `ok` when there are none. It reports:

- rows of different widths, and characters not in the table;
- not exactly one `S`, or no `E`;
- a walkable tile, or an `E`, that can't be reached from `S`;
- stairs without floor at both ends of the run, or that go up in their arrow's direction;
- floor beside a stair run (wall the sides off);
- two different floor levels side by side (a drop: put stairs or a wall between);
- a track row that isn't `=` from edge to edge, a track with no `!` row beside it, or a `!` not next to `=`.

## Tips

- Draw the silhouette first: walls, the floors at their levels, the stairs between them. Then the
  furniture.
- Leave at least 2 tiles of open floor in front of every stair run and around every exit.
- Keep the camera in mind: it looks north from the south at 35°. Tall walls on a room's south side hide
  what's behind them (they fade when you're near), so put the interesting things on north walls.
````

- [ ] **Step 6: Commit**

```bash
git add src/rpg/check.js src/rpg/MAPS.md test/station-check.test.js
git commit -m "Station: a checker for station maps, with a command line, and the format written up for authors

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Movement

**Files:**
- Create: `src/rpg/move.js`
- Test: `test/station-move.test.js`

**Interfaces:**
- Consumes: `parseStation` (in tests). It uses `map.solidAt`, `map.levelAt` and `map.spawn`.
- Produces:
  - `SPEED`, `SPRINT`, `ACCEL`, `RADIUS`, `NUDGE`
  - `createWalker(map, at = map.spawn) → { x, z, y, vx, vz, facing, walked }`
  - `stepWalker(w, dt, input, map) → w`, which mutates `w`. `input` is `{ x, y, run }`: x is east and y is south, each from −1 to 1 (the shape of `createInput().state()`).
  - `blocked(map, x, z, r = RADIUS) → boolean`

- [ ] **Step 1: Write the failing tests.** Create `test/station-move.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStation } from '../src/rpg/map.js';
import { createWalker, stepWalker, blocked, SPEED, SPRINT, RADIUS } from '../src/rpg/move.js';

const ROOM = parseStation(['##########', '#S.......#', '#........#', '#........#', '##########'].join('\n'));
const run = (w, map, input, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) stepWalker(w, dt, input, map); return w; };

test('reaches walking speed almost at once', () => {
  const w = createWalker(ROOM);
  run(w, ROOM, { x: 1, y: 0 }, 0.1);
  assert.ok(w.vx > 0.9 * SPEED, `after 0.1 s: ${w.vx}`);
  run(w, ROOM, { x: 1, y: 0 }, 0.2);
  assert.ok(Math.abs(w.vx - SPEED) < 0.01, `after 0.3 s: ${w.vx}`);
});

test('stops dead when you let go', () => {
  const w = run(createWalker(ROOM), ROOM, { x: 1, y: 0 }, 0.3);
  const x = w.x;
  run(w, ROOM, { x: 0, y: 0 }, 0.25);
  assert.equal(w.vx, 0);
  assert.ok(w.x - x < 0.2, `coasted ${w.x - x}`);
});

test('Shift sprints, and diagonals are no faster', () => {
  const s = run(createWalker(ROOM), ROOM, { x: 1, y: 0, run: true }, 0.3);
  assert.ok(Math.abs(s.vx - SPEED * SPRINT) < 0.02);
  const d = run(createWalker(ROOM), ROOM, { x: 1, y: 1 }, 0.25);
  assert.ok(Math.abs(Math.hypot(d.vx, d.vz) - SPEED) < 0.02, `diagonal ${Math.hypot(d.vx, d.vz)}`);
});

test('slides along a wall instead of sticking', () => {
  const w = run(createWalker(ROOM), ROOM, { x: -1, y: -1 }, 0.5); // into the corner
  assert.ok(w.x >= 1 + RADIUS - 1e-6 && w.z >= 1 + RADIUS - 1e-6);
  const x = w.x;
  run(w, ROOM, { x: 1, y: -1 }, 0.4); // along the north wall
  assert.ok(w.x > x + 1, 'moved east along it');
  assert.ok(Math.abs(w.z - (1 + RADIUS)) < 0.01, 'stayed against it');
});

test('never ends a step inside a wall or off the map, whatever the input', () => {
  const w = createWalker(ROOM);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) {
    const input = { x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1), run: rnd() < 0.3 };
    stepWalker(w, rnd() < 0.05 ? 0.25 : 1 / 60, input, ROOM);
    assert.ok(!blocked(ROOM, w.x, w.z), `inside a wall at ${w.x},${w.z} (step ${i})`);
  }
});

test('a long frame never carries you through a wall', () => {
  const thin = parseStation(['#####', '#S#.#', '#####'].join('\n'));
  const w = createWalker(thin);
  stepWalker(w, 0.05, { x: 1, y: 0 }, thin);
  stepWalker(w, 1, { x: 1, y: 0 }, thin);
  assert.ok(w.x <= 2 - RADIUS + 1e-6, `x ${w.x}`);
});

test('a corner clipped by less than 0.2 eases you round it; more blocks you', () => {
  const door = parseStation(['###.####', '#......#', '#S.....#', '########'].join('\n'));
  const w = createWalker(door, { x: 3.9, z: 1.6 });
  run(w, door, { x: 0, y: -1 }, 0.6);
  assert.ok(w.z < 0.9, `went through the doorway (z ${w.z})`);
  const v = createWalker(door, { x: 4.4, z: 1.6 });
  run(v, door, { x: 0, y: -1 }, 0.6);
  assert.ok(v.z >= 1 + RADIUS - 1e-6, 'held by the wall');
});

test('your height follows the stairs', () => {
  const tiny = parseStation(['########', '#S.>>__#', '#..>>__#', '#####!!#', '========', '########'].join('\n'));
  const w = createWalker(tiny);
  assert.equal(w.y, 0);
  let last = w.y;
  for (let i = 0; i < 90; i++) {
    stepWalker(w, 1 / 60, { x: 1, y: 0 }, tiny);
    assert.ok(w.y <= last + 1e-9, 'only goes down, walking east');
    last = w.y;
  }
  assert.equal(w.y, -3, 'on the platform');
});

test('remembers which way you face, and how far you walked', () => {
  const w = run(createWalker(ROOM), ROOM, { x: -1, y: 0 }, 0.1);
  assert.equal(w.facing, -1);
  const before = w.walked;
  run(w, ROOM, { x: 0, y: 1 }, 0.2);
  assert.equal(w.facing, -1, 'walking south keeps the facing');
  assert.ok(w.walked > before + 0.5);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/station-move.test.js`
Expected: FAIL, because `src/rpg/move.js` doesn't exist.

- [ ] **Step 3: Implement `src/rpg/move.js`**

```js
// Walking in the station (station spec §4): free movement that's tight, not floaty. Pure: no three.js.
// w = { x, z, y, vx, vz, facing, walked }; input = { x, y, run }, x east and y south, each −1…1 (the museum's keys).
export const SPEED = 4.2, SPRINT = 1.6, ACCEL = 0.04, RADIUS = 0.25, NUDGE = 0.2;
const STEP = 0.1; // the longest move checked at once, so a slow frame never passes through a wall

export function createWalker(map, at = map.spawn) {
  return { x: at.x, z: at.z, y: map.levelAt(at.x, at.z) ?? 0, vx: 0, vz: 0, facing: 1, walked: 0 };
}

export function stepWalker(w, dt, input, map) {
  let ix = input.x || 0, iz = input.y || 0;
  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }
  const top = SPEED * (input.run ? SPRINT : 1);
  const k = 1 - Math.exp(-dt / ACCEL);
  w.vx += (ix * top - w.vx) * k;
  w.vz += (iz * top - w.vz) * k;
  if (!ix && Math.abs(w.vx) < 0.05) w.vx = 0;
  if (!iz && Math.abs(w.vz) < 0.05) w.vz = 0;
  const x0 = w.x, z0 = w.z;
  const n = Math.max(1, Math.ceil(Math.hypot(w.vx, w.vz) * dt / STEP));
  for (let i = 0; i < n; i++) {
    slide(w, (w.vx * dt) / n, 'x', map);
    slide(w, (w.vz * dt) / n, 'z', map);
  }
  if (ix) w.facing = Math.sign(ix);
  w.walked += Math.hypot(w.x - x0, w.z - z0);
  w.y = map.levelAt(w.x, w.z) ?? w.y;
  return w;
}

// Does a circle at (x, z) overlap a solid tile or leave the map?
export function blocked(map, x, z, r = RADIUS) {
  for (let row = Math.floor(z - r); row <= Math.floor(z + r); row++) {
    for (let col = Math.floor(x - r); col <= Math.floor(x + r); col++) {
      if (!map.solidAt(col + 0.5, row + 0.5)) continue;
      const nx = Math.max(col, Math.min(x, col + 1)), nz = Math.max(row, Math.min(z, row + 1));
      if ((x - nx) ** 2 + (z - nz) ** 2 < r * r - 1e-9) return true;
    }
  }
  return false;
}

// Move along one axis. Against a wall that axis stops, and you slide along it on the other. A corner clipped
// by less than NUDGE eases you sideways round it instead (as the museum does).
function slide(w, d, axis, map) {
  if (!d) return;
  const nx = axis === 'x' ? w.x + d : w.x, nz = axis === 'z' ? w.z + d : w.z;
  if (!blocked(map, nx, nz)) { w.x = nx; w.z = nz; return; }
  for (let o = 0.05; o <= NUDGE + 1e-9; o += 0.05) {
    for (const s of [1, -1]) {
      const ox = axis === 'z' ? s * o : 0, oz = axis === 'x' ? s * o : 0;
      if (blocked(map, nx + ox, nz + oz)) continue;
      const m = Math.min(Math.abs(d), o); // ease sideways by no more than the move
      const tx = w.x + Math.sign(ox) * m, tz = w.z + Math.sign(oz) * m;
      if (!blocked(map, tx, tz)) { w.x = tx; w.z = tz; }
      return;
    }
  }
  if (axis === 'x') w.vx = 0; else w.vz = 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/station-move.test.js`
Expected: every test passes.
- **The corner test:** the walker at x 3.9 clips the doorway's east post (x 4–5) by 0.15. Each sub-step eases it west by up to 0.05 until it fits.
- **If "stops dead" fails on coasting distance:** don't loosen the test. Lower the 0.05 stop threshold in `stepWalker`, because the spec says you stop dead.

- [ ] **Step 5: Commit**

```bash
git add src/rpg/move.js test/station-move.test.js
git commit -m "Station: tight free movement, sliding along walls, a corner nudge, stairs, and no tunnelling on a slow frame

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The train's schedule

**Files:**
- Create: `src/rpg/train.js`
- Test: `test/station-train.test.js`

**Interfaces:**
- Consumes: `map.tracks` and `map.cols`.
- Produces:
  - `TRAIN = { speed: 25, cars: 4, car: 6, gap: 0.6, warn: 3, every: 35, jitter: 5, first: 8 }` and `LENGTH`.
  - `startOf(n) → seconds`, when run n's head leaves its tunnel.
  - `trainAt(t, map)` returns `null`, or `{ n, phase: 'warn'|'pass', warn: 0…1, track, dir: 1|-1, head: number|null, tail: number|null }`. `head` and `tail` are x positions. `dir` 1 runs east and comes out of the west tunnel.

- [ ] **Step 1: Write the failing tests.** Create `test/station-train.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { trainAt, startOf, TRAIN, LENGTH } from '../src/rpg/train.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const travel = (MAP.cols + LENGTH + 4) / TRAIN.speed;

test('trains come every 30 to 40 seconds', () => {
  for (let n = 0; n < 60; n++) {
    const gap = startOf(n + 1) - startOf(n);
    assert.ok(gap >= 30 && gap <= 40, `gap ${n}: ${gap}`);
  }
  assert.ok(startOf(0) >= TRAIN.warn, 'the first warning starts after you arrive');
});

test('nothing at first, then the tunnel glows, then the train passes', () => {
  assert.equal(trainAt(0, MAP), null);
  const s = startOf(0);
  const w = trainAt(s - 1.5, MAP);
  assert.equal(w.phase, 'warn');
  assert.ok(Math.abs(w.warn - 0.5) < 1e-9);
  assert.equal(w.head, null);
  const p = trainAt(s + 0.5, MAP);
  assert.equal(p.phase, 'pass');
  assert.ok(Math.abs(p.head - (-2 + 12.5)) < 1e-9, `head ${p.head}`);
  assert.ok(Math.abs(p.tail - (p.head - LENGTH)) < 1e-9);
  assert.equal(trainAt(s + travel + 0.01, MAP), null, 'gone into the far tunnel');
});

test('trains alternate tracks and directions', () => {
  const a = trainAt(startOf(0) + 0.1, MAP), b = trainAt(startOf(1) + 0.1, MAP), c = trainAt(startOf(2) + 0.1, MAP);
  assert.notEqual(a.track, b.track);
  assert.equal(a.track, c.track);
  assert.equal(a.dir, 1);
  assert.equal(b.dir, -1);
  assert.ok(Math.abs(b.head - (MAP.cols + 2 - 2.5)) < 1e-9, 'westbound comes from the east tunnel');
});

test('one train at a time, and the same every time', () => {
  for (let t = 0; t < 400; t += 0.37) {
    const x = trainAt(t, MAP), y = trainAt(t, MAP);
    assert.deepEqual(x, y);
    if (x && x.phase === 'pass') assert.ok(x.head > -3 - LENGTH && x.head < MAP.cols + 3 + LENGTH);
  }
});

test('a map with no tracks has no train', () => {
  assert.equal(trainAt(20, parseStation('###\n#S#\n###')), null);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/station-train.test.js`
Expected: FAIL, because `src/rpg/train.js` doesn't exist.

- [ ] **Step 3: Implement `src/rpg/train.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/station-train.test.js`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/rpg/train.js test/station-train.test.js
git commit -m "Station: the passing train's schedule, every 30–40 s on alternating tracks, with a 3 s warning

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The camera's maths

**Files:**
- Create: `src/rpg/camera.js`
- Test: `test/station-camera.test.js`

**Interfaces:**
- Consumes: `map.cols` and `map.rows`.
- Produces:
  - `CAM = { pitch, dist: 10, lift: 1, spring: 0.15 }`, with `pitch` in radians.
  - `tilesAcross(aspect)` gives 12 for an aspect of 1 or wider and 8 for narrower.
  - `fovFor(aspect)` gives the vertical field of view in degrees.
  - `createCamera(target) → { x, y, z }`, the focus point.
  - `followCamera(cam, target, dt, map, aspect) → cam`.
  - `eyeFor(cam) → { x, y, z }`, where the eye sits.

- [ ] **Step 1: Write the failing tests.** Create `test/station-camera.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAM, tilesAcross, fovFor, createCamera, followCamera, eyeFor } from '../src/rpg/camera.js';

const MAP = { cols: 48, rows: 19 };

test('35 degrees down, 10 back, never rotating', () => {
  assert.ok(Math.abs(CAM.pitch - (35 * Math.PI) / 180) < 1e-12);
  const cam = createCamera({ x: 20, y: -3, z: 9 });
  assert.deepEqual(cam, { x: 20, y: -2, z: 9 });
  const eye = eyeFor(cam);
  assert.ok(Math.abs(eye.x - cam.x) < 1e-12, 'straight behind: no yaw');
  assert.ok(Math.abs(Math.hypot(eye.y - cam.y, eye.z - cam.z) - CAM.dist) < 1e-9);
  assert.ok(Math.abs(Math.atan2(eye.y - cam.y, eye.z - cam.z) - CAM.pitch) < 1e-9);
});

test('12 tiles across on a wide screen, 8 on a phone held upright', () => {
  assert.equal(tilesAcross(16 / 9), 12);
  assert.equal(tilesAcross(9 / 16), 8);
  for (const aspect of [16 / 9, 9 / 16]) {
    const halfW = Math.tan(((fovFor(aspect) / 2) * Math.PI) / 180) * CAM.dist * aspect;
    assert.ok(Math.abs(halfW * 2 - tilesAcross(aspect)) < 1e-9, `aspect ${aspect}`);
  }
});

test('follows on a 0.15 s spring', () => {
  const cam = createCamera({ x: 20, y: 0, z: 9 });
  followCamera(cam, { x: 21, y: 0, z: 9 }, CAM.spring, MAP, 16 / 9);
  assert.ok(Math.abs(cam.x - (20 + (1 - Math.exp(-1)))) < 1e-9);
  followCamera(cam, { x: 21, y: 0, z: 9 }, 0, MAP, 16 / 9);
  assert.ok(Math.abs(cam.x - (20 + (1 - Math.exp(-1)))) < 1e-9, 'dt 0 holds still');
});

test('kept inside the map', () => {
  const cam = createCamera({ x: 1, y: 0, z: 1 });
  followCamera(cam, { x: 1, y: 0, z: 1 }, 1, MAP, 16 / 9);
  assert.ok(cam.x >= 6 && cam.z >= 1, `(${cam.x}, ${cam.z})`);
  const far = createCamera({ x: 47, y: 0, z: 18 });
  followCamera(far, { x: 47, y: 0, z: 18 }, 1, MAP, 16 / 9);
  assert.ok(far.x <= 42 && far.z <= 18);
  const narrow = createCamera({ x: 0, y: 0, z: 0 });
  followCamera(narrow, { x: 0, y: 0, z: 0 }, 1, { cols: 6, rows: 4 }, 16 / 9);
  assert.equal(narrow.x, 3, 'a map narrower than the view is centred');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/station-camera.test.js`
Expected: FAIL, because `src/rpg/camera.js` doesn't exist.

- [ ] **Step 3: Implement `src/rpg/camera.js`**

```js
// The station's camera (station spec §4): pitched 35° down, 10 back, following a point 1 above you on a
// 0.15 s spring, kept inside the map, never rotating. Pure: index.js copies it onto the three.js camera.
export const CAM = { pitch: (35 * Math.PI) / 180, dist: 10, lift: 1, spring: 0.15 };

export const tilesAcross = (aspect) => (aspect >= 1 ? 12 : 8);

// The vertical field of view, in degrees, that shows tilesAcross(aspect) tiles across at the focus.
export function fovFor(aspect) {
  const halfH = tilesAcross(aspect) / 2 / aspect;
  return (2 * Math.atan(halfH / CAM.dist) * 180) / Math.PI;
}

export const createCamera = (t) => ({ x: t.x, y: t.y + CAM.lift, z: t.z });

export function followCamera(cam, t, dt, map, aspect) {
  const k = dt > 0 ? 1 - Math.exp(-dt / CAM.spring) : 0;
  cam.x += (t.x - cam.x) * k;
  cam.y += (t.y + CAM.lift - cam.y) * k;
  cam.z += (t.z - cam.z) * k;
  const hw = tilesAcross(aspect) / 2, hd = Math.min(4, hw / aspect);
  cam.x = clamp(cam.x, hw, map.cols - hw);
  cam.z = clamp(cam.z, hd * 0.25, map.rows - hd * 0.5);
  return cam;
}

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

export const eyeFor = (cam) => ({ x: cam.x, y: cam.y + Math.sin(CAM.pitch) * CAM.dist, z: cam.z + Math.cos(CAM.pitch) * CAM.dist });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/station-camera.test.js`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/rpg/camera.js test/station-camera.test.js
git commit -m "Station: the camera's maths, 35° down and 10 back on a 0.15 s spring, 12 tiles across, kept inside the map

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The stairwell in the lobby

**Files:**
- Modify: `src/layout.js`, after the information desk block (just before `// You start just below the desk`), and in the returned object.
- Modify: `src/render/canvas.js:245-247`, so floor tiles with a glyph show it.
- Test: `test/layout.test.js`

**Interfaces:**
- Produces: `map.stairs` from `buildLayout`, as `{ x, y, w, h, inside: { x, y, w, h }, front: { x, y } }` in map cells.
  - `inside` holds the walkable treads. Standing in it means going down.
  - `front` is where you stand when you come back up: a cell centre two rows north of the opening.

- [ ] **Step 1: Write the failing test.** Append to `test/layout.test.js`:

```js
test('the lobby has a stairwell down to the subway, which you can walk into', () => {
  const map = buildLayout(real, SITE);
  const s = map.stairs, lobby = map.rooms[0];
  assert.ok(s, 'stairs exist');
  assert.ok(s.x > lobby.x && s.x + s.w < lobby.x + lobby.w && s.y > lobby.y && s.y + s.h < lobby.y + lobby.h, 'inside the lobby');
  for (let y = s.inside.y; y < s.inside.y + s.inside.h; y++)
    for (let x = s.inside.x; x < s.inside.x + s.inside.w; x++) assert.ok(isWalkable(map, x, y), `treads walkable at ${x},${y}`);
  for (let y = s.y; y < s.y + s.h; y++) {
    assert.equal(map.tiles[y * map.W + s.x], T.PROP, 'west side walled');
    assert.equal(map.tiles[y * map.W + s.x + s.w - 1], T.PROP, 'east side walled');
  }
  for (let x = s.x; x < s.x + s.w; x++) assert.equal(map.tiles[(s.y + s.h - 1) * map.W + x], T.PROP, 'bottom walled');
  assert.ok(map.glyphs.has(s.inside.y * map.W + s.inside.x), 'the treads are drawn');
  const sx = Math.floor(map.spawn.x), sy = Math.floor(map.spawn.y);
  assert.ok(findPath(map.W, map.H, (x, y) => isWalkable(map, x, y), sx, sy, s.inside.x + 2, s.inside.y), 'reachable from the spawn');
  assert.ok(isWalkable(map, Math.floor(s.front.x), Math.floor(s.front.y)), 'you can stand in front');
  assert.ok(Math.floor(s.front.y) < s.inside.y - 1, 'in front means off the treads');
  assert.ok(map.labels.some((l) => l.text === '▼ SUBWAY' && l.y === s.y - 1), 'signed');
  for (const l of map.labels) {
    if (l.text === '▼ SUBWAY') continue;
    const clear = l.y < s.y - 2 || l.y >= s.y + s.h || l.x + l.text.length <= s.x || l.x >= s.x + s.w;
    assert.ok(clear, `label "${l.text}" clear of the stairwell`);
  }
  assert.ok(Math.abs(map.spawn.x - (s.x + s.w / 2)) > s.w, 'off the line you walk from the spawn');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/layout.test.js`
Expected: FAIL with "stairs exist".

- [ ] **Step 3: Implement it.** In `src/layout.js`, after the line `labels.push({ x: kiosk.x + Math.round((kw - sign.length) / 2), y: top, text: sign, role: 'sign' });` and before `// You start just below the desk, facing it.`, add:

```js
  // The subway stairwell (station spec §1): stairs going down in the lobby's south-west corner, against the
  // south wall. Open to the north, where you walk in; walled on the other three sides, so no path passes
  // through it on the way somewhere else. Standing on a tread takes you down.
  const stairArt = ['│▀▀▀▀▀▀▀│', '│═══════│', '│───────│', '│▄▄▄▄▄▄▄│', '└───────┘'];
  const stairs = { x: lobby.x + 3, y: lobby.y + lobby.h - 1 - stairArt.length, w: stairArt[0].length, h: stairArt.length };
  stairs.inside = { x: stairs.x + 1, y: stairs.y, w: stairs.w - 2, h: stairs.h - 1 };
  stairs.front = { x: stairs.x + Math.floor(stairs.w / 2) + 0.5, y: stairs.y - 2.5 };
  stairArt.forEach((line, dy) => [...line].forEach((ch, dx) => {
    const i = at(stairs.x + dx, stairs.y + dy);
    const tread = dx > 0 && dx < stairs.w - 1 && dy < stairs.h - 1;
    tiles[i] = tread ? T.FLOOR : T.PROP;
    glyphs.set(i, { ch, role: 'prop' });
  }));
  labels.push({ x: stairs.x, y: stairs.y - 1, text: '▼ SUBWAY', role: 'sign' });
```

Change the return line to include `stairs`:

```js
  return { W, H, tiles, roomOf, glyphs, rooms, frames, labels, lines, spawn, kiosk, stairs, arena: arenaInfo, faces, view: VIEW };
```

In `src/render/canvas.js`, the floor branch around line 245 ignores glyphs. Draw a floor tile's glyph when it has one:

```js
        else if (t === T.FLOOR || t === T.DOOR) {
          const g = map.glyphs.get(i);
          if (g) put(c, g.ch, x, y, C.prop);
          else if ((wx * 7 + wy * 13) % 17 === 0) put(c, '·', x, y, dark || inDark(wx, wy) ? C.dFloorDot : (tints[map.roomOf[i]] || C).dot || C.floorDot);
        } else if (t === T.PROP) {
```

`museum.js` (line 127) and `gl.js` (line 310) already draw every glyph in `map.glyphs`, so they need no change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/layout.test.js test/canvas.test.js`
Expected: every test passes, including the existing kiosk test ("spawn still free", "reachable").
- **If a label overlaps:** this is most likely an "about" line on a narrow lobby. Move the stairwell one column east (`lobby.x + 4`); don't drop the check.

- [ ] **Step 5: Commit**

```bash
git add src/layout.js src/render/canvas.js test/layout.test.js
git commit -m "Lobby: a stairwell down to the subway in the south-west corner, signed ▼ SUBWAY (station spec §1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The station in three.js: the place, you, the light and the blur

**Files:**
- Modify: `package.json` and `package-lock.json`, adding `three`.
- Create: `src/rpg/sprites.js`
- Create: `src/rpg/scene.js`
- Create: `src/rpg/post.js`
- Create: `src/rpg/index.js`
- Verify with: a throwaway Puppeteer script in the scratchpad. Don't commit it.

**Interfaces:**
- Consumes: Tasks 2 and 4–6 (`parseStation`, `LEVEL`, `createWalker`, `stepWalker`, `trainAt`, `CAM`, `createCamera`, `followCamera`, `eyeFor`, `fovFor`).
- Produces:
  - `startStation(stage, { onExit, keys, reducedMotion = false, phone = false }) → { stop() }`.
    - It appends one `<canvas class="station">` to `stage` and calls `onExit()` once, when you step onto an `E`.
    - `keys()` returns `{ x, y, run }`.
    - If setting up throws (no WebGL), it removes its canvas and rethrows.
  - `window.__station` while running: `{ map, walker, frames(), time(), train(), setTime(s), teleport(x, z) }`. It is deleted by `stop()`.
  - `buildScene(scene, map, { reducedMotion }) → { update(time, dt, walker, train), dispose() }` (Task 11 extends `update`).
  - `makeSprite(lines, colors, height, { glow }) → { mesh, draw(lines), dispose() }`, plus `PLAYER` (2 frames), `PLAYER_COLORS` and `PROPS`.
  - `createPost(renderer, scene, camera) → { setSize(w, h, dpr), setFocus(y01), render(), dispose() }`.

- [ ] **Step 1: Add three.js**

Run: `npm install --save-exact three@0.186.1`
Expected: `package.json` gains `"dependencies": { "three": "0.186.1" }`. Check that `node -e "import('three').then(t => console.log(t.REVISION))"` prints `186`.

- [ ] **Step 2: Write `src/rpg/sprites.js`**

```js
// ASCII art standing up in the 3D station (station spec §5): each sprite is a canvas texture on an upright
// plane, its origin at the feet, sized in world units so it scales with distance like everything else.
import * as THREE from 'three';

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const PX = 64; // the font's pixel size on a sprite's canvas

export function makeSprite(lines, colors, height, { glow = false } = {}) {
  const canvas = document.createElement('canvas');
  const cols = Math.max(...lines.map((l) => [...l].length));
  const cw = Math.ceil(PX * 0.62), lh = Math.ceil(PX * 1.08);
  canvas.width = cols * cw + 16;
  canvas.height = lines.length * lh + 16;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Glowing sprites (you) skip tone mapping, so they stay the brightest, crispest thing on screen.
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false, side: THREE.DoubleSide, toneMapped: !glow });
  const geo = new THREE.PlaneGeometry((height * canvas.width) / canvas.height, height);
  geo.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  const draw = (ls) => {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.font = `700 ${PX}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    ls.forEach((line, i) => {
      const y = 8 + lh * (i + 0.5);
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 10;
      c.strokeText(line, canvas.width / 2, y);
      c.fillStyle = Array.isArray(colors) ? colors[i] ?? colors[0] : colors;
      c.fillText(line, canvas.width / 2, y);
    });
    tex.needsUpdate = true;
  };
  draw(lines);
  return { mesh, draw, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}

// You: 4 lines with a lantern, two walking frames (the legs swap).
export const PLAYER = [
  [' o ', '/|\\¤', ' | ', '/ \\'],
  [' o ', '/|\\¤', ' | ', ' |\\'],
];
export const PLAYER_COLORS = ['#ffe6bd', '#ffce6e', '#e9a23b', '#c98a3a'];

export const PROPS = {
  bin: { lines: [' ___ ', '|###|', '|___|'], colors: ['#a7afc2', '#6f7890', '#6f7890'], h: 0.9 },
  board: { lines: ['┌──────┐', '│ ═╪═╪ │', '│ ═╪══ │', '└──┬┬──┘', '   ││   '], colors: ['#c9d2e6', '#7fc4ff', '#ff9a7a', '#c9d2e6', '#8a93a8'], h: 1.9 },
  vending: { lines: ['┌────┐', '│▒▒▒▒│', '│▒▒▒▒│', '│ ══ │', '└────┘'], colors: ['#d9dee9', '#ff7a7a', '#7affc4', '#d9dee9', '#d9dee9'], h: 2.0 },
  news: { lines: ['▤'], colors: ['#d8d2c4'], h: 0.35 },
};
```

- [ ] **Step 3: Write `src/rpg/post.js`**

```js
// Bloom and tilt-shift (station spec §5). The bloom is gentle and capped: a high threshold and a low
// strength, so lit things glow instead of blowing out. The tilt-shift keeps a band around your row sharp and
// blurs toward the top of the screen (more) and the bottom (less), drawn as two 9-tap passes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShift = {
  uniforms: {
    tDiffuse: { value: null },
    focus: { value: 0.45 }, // the sharp band's centre, 0 = bottom of the screen, 1 = top
    band: { value: 0.1 }, // half its height
    top: { value: 3.2 }, // blur toward the top, in texels per tap
    bottom: { value: 1.4 },
    dir: { value: new THREE.Vector2(1, 0) },
    texel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float focus, band, top, bottom; uniform vec2 dir, texel; varying vec2 vUv;
    void main() {
      float d = vUv.y - focus;
      float a = d > 0.0 ? smoothstep(band, band + 0.35, d) * top : smoothstep(band, band + 0.35, -d) * bottom;
      if (a < 0.01) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 s = vec4(0.0); float w = 0.0;
      for (int i = -4; i <= 4; i++) { float f = float(i); float k = exp(-f * f / 8.0); s += texture2D(tDiffuse, vUv + dir * texel * f * a) * k; w += k; }
      gl_FragColor = s / w;
    }`,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.85); // strength, radius, threshold
  composer.addPass(bloom);
  const across = new ShaderPass(TiltShift), down = new ShaderPass(TiltShift);
  down.uniforms.dir.value.set(0, 1);
  composer.addPass(across);
  composer.addPass(down);
  composer.addPass(new OutputPass());
  return {
    setSize(w, h, dpr) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      for (const p of [across, down]) p.uniforms.texel.value.set(1 / (w * dpr), 1 / (h * dpr));
    },
    setFocus(y01) { across.uniforms.focus.value = down.uniforms.focus.value = Math.min(0.9, Math.max(0.1, y01)); },
    render() { composer.render(); },
    dispose() { bloom.dispose(); across.dispose?.(); down.dispose?.(); composer.dispose(); },
  };
}
```

- [ ] **Step 4: Write `src/rpg/scene.js` (the place, without the train or life; Task 11 adds those)**

```js
// The station in 3D (station spec §5): lit shapes with faint ASCII painted on them, built from the map.
// Walls, floors, stairs, pillars, benches, turnstiles and the kiosk are instanced unit boxes, one per tile (walls
// stacked a box per unit of height), so the texture repeats once per world unit.
import * as THREE from 'three';
import { LEVEL } from './map.js';
import { makeSprite, PROPS } from './sprites.js';

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const WALL_HEIGHT = 4; // over the highest floor beside a wall
const FADE_REACH = 7; // walls this close on the camera's side fade (spec §4)

// A tile texture: a base colour with one faint glyph over it.
function glyphTexture([base, ink, glyph], alpha = 0.35, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  g.globalAlpha = alpha; g.fillStyle = ink;
  g.font = `${size * 0.8}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(glyph, size / 2, size / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const SURF = {
  wall: ['#3a3f4f', '#8d96ad', '┼'], hall: ['#4a4640', '#a49b8a', '·'], platform: ['#3f4148', '#9aa0ad', '·'],
  edge: ['#c9a227', '#3a2f10', '▀'], track: ['#26231f', '#7a6a55', '═'], stair: ['#4b4a50', '#b0b0bc', '─'],
  kiosk: ['#5a2e2a', '#d9a090', '▤'], pillar: ['#55596a', '#a9afc2', '│'], bench: ['#5b4632', '#c49a6c', '═'],
};

export function buildScene(scene, map, { reducedMotion = false } = {}) {
  const owned = []; // everything to dispose
  const own = (x) => { owned.push(x); return x; };
  scene.background = new THREE.Color('#05060a');
  scene.fog = new THREE.Fog('#05060a', 16, 34);
  scene.add(new THREE.HemisphereLight('#8090b8', '#1a1612', 0.6));

  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const mats = {};
  for (const [k, s] of Object.entries(SURF)) mats[k] = own(new THREE.MeshStandardMaterial({ map: own(glyphTexture(s)), roughness: 0.92, metalness: 0 }));
  const boxes = Object.fromEntries(Object.keys(SURF).map((k) => [k, []]));
  const box = (kind, x, y, z, sx = 1, sy = 1, sz = 1) => boxes[kind].push([x, y, z, sx, sy, sz]);

  const levels = (c, r) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const n = map.at(c + dc, r + dr); if (n && n.level != null) out.push(n.level); }
    return out;
  };

  const walls = []; // wall cubes, kept apart so the ones near the camera can fade
  for (const cell of map.cells) {
    const { c, r, ch } = cell, x = c + 0.5, z = r + 0.5;
    if (ch === '#' || ch === 'n') {
      const ls = levels(c, r);
      if (!ls.length) continue; // buried in other walls
      const lo = Math.min(...ls) - 0.4, top = Math.max(...ls) + WALL_HEIGHT;
      for (let y = lo; y < top - 1e-6; y += 1) walls.push({ c, r, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.5, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)) });
      continue;
    }
    if (ch === '=') { box('track', x, LEVEL.track - 0.1, z, 1, 0.2, 1); continue; }
    if (cell.stair) {
      const s = cell.stair;
      const lo = Math.min(s.from ?? 0, s.to ?? 0) - 0.2;
      for (let k = 0; k < 2; k++) { // two treads per tile
        const ax = s.dx ? x + s.dx * (k * 0.5 - 0.25) : x, az = s.dz ? z + s.dz * (k * 0.5 - 0.25) : z;
        const back = s.dx ? ax - s.dx * 0.25 : ax, backZ = s.dz ? az - s.dz * 0.25 : az;
        const top = map.levelAt(back + (s.dx > 0 ? 0.001 : s.dx < 0 ? -0.001 : 0), backZ + (s.dz > 0 ? 0.001 : s.dz < 0 ? -0.001 : 0));
        box('stair', ax, (lo + top) / 2, az, s.dx ? 0.5 : 1, top - lo, s.dz ? 0.5 : 1);
      }
      continue;
    }
    if (cell.level == null) continue;
    const y = cell.level;
    box(ch === '!' ? 'edge' : y === LEVEL.hall ? 'hall' : 'platform', x, y - 0.1, z, 1, 0.2, 1);
    if (ch === '|') for (let k = 0; k < WALL_HEIGHT; k++) box('pillar', x, y + k + 0.5, z, 0.6, 1, 0.6);
    if (ch === 'b') box('bench', x, y + 0.25, z, 0.9, 0.5, 0.5);
    if (ch === 't') box('pillar', x, y + 0.5, z, 0.25, 1, 0.6);
    if (ch === 'k') box('kiosk', x, y + 1.1, z, 1, 2.2, 1);
    if (ch === 'E') { // steps rising toward the wall beside the exit, toward the museum
      const wall = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dc, dr]) => map.solidAt(c + dc + 0.5, r + dr + 0.5) && !map.solidAt(c - dc + 0.5, r - dr + 0.5)) || [-1, 0];
      for (let k = 0; k < 3; k++) box('stair', x + wall[0] * (k * 0.3 - 0.3), y + 0.15 * (k + 1), z + wall[1] * (k * 0.3 - 0.3), wall[0] ? 0.3 : 1, 0.3 * (k + 1), wall[1] ? 0.3 : 1);
    }
  }

  const tmp = new THREE.Matrix4();
  for (const [kind, list] of Object.entries(boxes)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(unit, mats[kind], list.length);
    list.forEach(([x, y, z, sx, sy, sz], i) => mesh.setMatrixAt(i, tmp.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz))));
    scene.add(mesh);
  }
  const solidWalls = new THREE.InstancedMesh(unit, mats.wall, walls.length);
  const fadeMat = own(mats.wall.clone());
  fadeMat.transparent = true; fadeMat.opacity = 0.25; fadeMat.depthWrite = false;
  const fadedWalls = new THREE.InstancedMesh(unit, fadeMat, walls.length);
  scene.add(solidWalls, fadedWalls);
  let fadedFor = '';
  const placeWalls = (w) => {
    const key = `${Math.floor(w.x)},${Math.floor(w.z)}`;
    if (key === fadedFor) return;
    fadedFor = key;
    let a = 0, b = 0;
    for (const wl of walls) {
      const near = wl.r + 0.5 > w.z + 0.5 && wl.r + 0.5 < w.z + FADE_REACH && Math.abs(wl.c + 0.5 - w.x) < FADE_REACH;
      if (near) fadedWalls.setMatrixAt(b++, wl.m); else solidWalls.setMatrixAt(a++, wl.m);
    }
    solidWalls.count = a; fadedWalls.count = b;
    solidWalls.instanceMatrix.needsUpdate = fadedWalls.instanceMatrix.needsUpdate = true;
  };

  // Rails along each track.
  const railMat = own(new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.4 }));
  for (const t of map.tracks) for (const dz of [-0.72, 0.72]) {
    const rail = new THREE.Mesh(unit, railMat);
    rail.position.set(map.cols / 2, t.y + 0.06, t.z + dz);
    rail.scale.set(map.cols + 8, 0.12, 0.1);
    scene.add(rail);
  }

  // The station's name, on the far wall's face over the tracks.
  const signTex = own(nameTexture(map.name));
  const signMat = own(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
  const signGeo = own(new THREE.PlaneGeometry(3, 0.75));
  for (const s of map.signs) {
    const m = new THREE.Mesh(signGeo, signMat);
    m.position.set(s.x, LEVEL.track + 2.4, s.z + 0.51);
    scene.add(m);
  }

  // Tubes: a bright bar each (it blooms) and a cool point light under it.
  const tubeGeo = own(new THREE.BoxGeometry(1.4, 0.06, 0.16));
  const tubeMat = own(new THREE.MeshBasicMaterial({ color: '#e8f4ff', toneMapped: false }));
  const tubes = map.tubes.map((t) => {
    const bar = new THREE.Mesh(tubeGeo, tubeMat);
    bar.position.set(t.x, t.y, t.z);
    const light = new THREE.PointLight('#cfe3ff', 7, 8, 1.6);
    light.position.set(t.x, t.y - 0.25, t.z);
    scene.add(bar, light);
    return { ...t, bar, light, base: 7 };
  });

  // The way back up: warm light over the exit, and a sign.
  if (map.exits.length) {
    const mid = map.exits[Math.floor(map.exits.length / 2)];
    const y = map.levelAt(mid.x, mid.z) ?? 0;
    const warm = new THREE.PointLight('#ffb35c', 10, 6, 1.8);
    warm.position.set(mid.x, y + 2.4, mid.z);
    const up = makeSprite(['▲ MUSEUM'], '#ffce6e', 0.5, { glow: true });
    up.mesh.position.set(mid.x + 0.6, y + 2.3, mid.z);
    owned.push(up);
    scene.add(warm, up.mesh);
  }

  // Props, as sprites against walls and pillars.
  const prop = (name, x, z) => {
    const p = PROPS[name], s = makeSprite(p.lines, p.colors, p.h);
    s.mesh.position.set(x, map.levelAt(x, z) ?? 0, z);
    scene.add(s.mesh);
    owned.push(s);
    return s;
  };
  prop('board', 8.5, 5.15);
  prop('bin', 10.6, 5.15);
  prop('vending', 6.5, 12.8);
  for (const c of [23, 35]) prop('bin', c + 0.5, 10.1);

  return {
    tubes, owned,
    update(time, dt, walker) {
      placeWalls(walker);
      for (const t of tubes) t.light.intensity = t.base;
    },
    dispose() {
      scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      for (const o of owned) o.dispose();
    },
  };
}

function nameTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1b2a4a'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#d8e2f5'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#eef3ff'; g.font = `700 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
```

- [ ] **Step 5: Write `src/rpg/index.js`**

```js
// The station (station spec): built into its own canvas over the stage, running until you take the exit,
// then torn down completely. keys() is main.js's input state ({ x, y, run }); on a touch screen a held
// finger walks you toward it.
import * as THREE from 'three';
import stationText from './station.txt?raw';
import { parseStation } from './map.js';
import { createWalker, stepWalker } from './move.js';
import { trainAt } from './train.js';
import { createCamera, followCamera, eyeFor, fovFor } from './camera.js';
import { buildScene } from './scene.js';
import { makeSprite, PLAYER, PLAYER_COLORS } from './sprites.js';
import { createPost } from './post.js';

export function startStation(stage, { onExit, keys, reducedMotion = false, phone = false }) {
  const map = parseStation(stationText);
  const canvas = document.createElement('canvas');
  canvas.className = 'station';
  canvas.style.touchAction = 'none';
  stage.append(canvas);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    canvas.remove();
    throw err;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  const world = buildScene(scene, map, { reducedMotion });
  const walker = createWalker(map);

  const me = makeSprite(PLAYER[0], PLAYER_COLORS, 1.6, { glow: true });
  const lantern = new THREE.PointLight('#ffb35c', 9, 6.5, 1.8);
  const blobGeo = new THREE.CircleGeometry(0.32, 24).rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  scene.add(me.mesh, lantern, blob);
  let shownFrame = 0;

  const post = createPost(renderer, scene, camera);
  const cam = createCamera(walker);

  // Touch: hold a finger down to walk toward it (spec §4).
  let finger = null;
  const onDown = (e) => { finger = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (finger) { finger.x = e.clientX; finger.y = e.clientY; } };
  const onUp = () => { finger = null; };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const v = new THREE.Vector3();
  const fingerInput = () => {
    v.set(walker.x, walker.y + 0.8, walker.z).project(camera);
    const dx = finger.x - ((v.x + 1) / 2) * W, dy = finger.y - ((1 - v.y) / 2) * H, d = Math.hypot(dx, dy);
    return d < 14 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d, run: false };
  };

  let W = 0, H = 0;
  const resize = () => {
    W = stage.clientWidth || innerWidth;
    H = stage.clientHeight || innerHeight;
    const dpr = Math.min(phone ? 1.5 : 2, devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    post.setSize(W, H, dpr);
  };
  resize();
  addEventListener('resize', resize);

  let raf = 0, last = performance.now(), t0 = last, leaving = false, frames = 0;
  const time = () => (performance.now() - t0) / 1000;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; } // paused while hidden (spec §5)
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const t = (now - t0) / 1000;
    stepWalker(walker, dt, finger ? fingerInput() : keys(), map);
    if (!leaving && map.at(Math.floor(walker.x), Math.floor(walker.z))?.ch === 'E') { leaving = true; onExit(); }

    const moving = Math.hypot(walker.vx, walker.vz) > 0.3;
    const f = moving ? Math.floor(walker.walked / 0.45) % 2 : 0;
    if (f !== shownFrame) { me.draw(PLAYER[f]); shownFrame = f; }
    me.mesh.position.set(walker.x, walker.y, walker.z);
    me.mesh.scale.x = walker.facing;
    blob.position.set(walker.x, walker.y + 0.02, walker.z);
    lantern.position.set(walker.x + 0.35 * walker.facing, walker.y + 1.1, walker.z + 0.15);
    lantern.intensity = 9 * (reducedMotion ? 1 : 0.94 + 0.06 * Math.sin(t * 13) * Math.sin(t * 5.1));

    const train = trainAt(t, map);
    world.update(t, dt, walker, train);

    followCamera(cam, walker, dt, map, camera.aspect);
    const eye = eyeFor(cam), shake = world.shake ? world.shake(t, walker, train) : { x: 0, y: 0 };
    camera.position.set(eye.x + shake.x, eye.y + shake.y, eye.z);
    camera.lookAt(cam.x + shake.x, cam.y + shake.y, cam.z);
    v.set(walker.x, walker.y + 0.8, walker.z).project(camera);
    post.setFocus((v.y + 1) / 2);
    post.render();
    frames++;
  }
  raf = requestAnimationFrame(frame);

  const hook = {
    map, walker,
    frames: () => frames,
    time,
    train: () => trainAt(time(), map),
    setTime(s) { t0 = performance.now() - s * 1000; },
    teleport(x, z) { walker.x = x; walker.z = z; walker.vx = walker.vz = 0; walker.y = map.levelAt(x, z) ?? walker.y; },
  };
  window.__station = hook;

  return {
    stop() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      world.dispose();
      me.dispose();
      blobGeo.dispose();
      blobMat.dispose();
      post.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      if (window.__station === hook) delete window.__station;
    },
  };
}
```

- [ ] **Step 6: Check that it builds, and that the gallery's bundle doesn't include three.js**

Run: `npm run build 2>&1 | tail -20`
Expected: the build succeeds and shows a separate chunk for `rpg/index` (with three.js in it).
- Run `grep -l "WebGLRenderer" dist/assets/*.js`. It should list only the station's chunk(s), not `main-*.js`.
- If `main-*.js` contains it, something imports `src/rpg/index.js` statically. Find it and remove it.

- [ ] **Step 7: Look at it.** Write a throwaway script in the scratchpad (not the repo), for example `$SCRATCH/station-look.mjs`. It should import `withBrowser` and `ready` from `<repo>/e2e/lib.mjs`, then:
  - load the site;
  - call `await page.evaluate(async () => { const { startStation } = await import('/src/rpg/index.js'); window.__s = startStation(document.getElementById('stage'), { onExit() {}, keys: () => ({ x: 0, y: 0 }) }); })`;
  - wait for `window.__station.frames() > 30`;
  - take screenshots at the spawn, after `__station.teleport(30.5, 9.5)`, and after `teleport(16, 9.5)` (on the stairs);
  - print the page errors.

Run it with `node $SCRATCH/station-look.mjs` and open the screenshots.
Expected:
- **The hall:** warm light at the exit, the kiosk, turnstiles, tubes glowing, and `·` floors and `┼` walls faintly visible.
- **The platform:** pillars, benches, yellow edges with tracks beyond, and MUSEUM signs on the far wall.
- **You:** the 4-line figure, crisp, in the sharp band, with the top of the screen blurred.
- **No page errors.**

If it's too dark, raise the `HemisphereLight` intensity or the tube intensity in `scene.js`. If it's blown out, raise the bloom threshold in `post.js`. Keep any change small and note it in the commit message.

- [ ] **Step 8: Run all the unit tests**

Run: `npm test`
Expected: every test passes. The station's three.js files aren't imported by any test.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/rpg/sprites.js src/rpg/scene.js src/rpg/post.js src/rpg/index.js
git commit -m "Station: the place in three.js, lit boxes with faint ASCII, you as a 4-line sprite with a lantern, tubes, gentle bloom and a tilt-shift blur, loaded only when you go down

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: In and out: the gallery hands over to the station and back

**Files:**
- Modify: `index.html`, adding a fade overlay.
- Modify: `src/style.css`, adding fade and in-station rules.
- Modify: `src/main.js`, changing the router import, `applyRoute`, `onTap`, `onKey`, `loop`, the hashchange listener and the test hook, and adding `goDown`/`goUp`.

**Interfaces:**
- Consumes:
  - `STATION_HASH` (Task 1);
  - `map.stairs` (Task 7);
  - `startStation` (Task 8), via `import('./rpg/index.js')`;
  - from main.js: `live.net.pause()`/`resume()`, `teleport`, `replaceHash`, `note`, `input.state()`, `touch` and `reducedMotion`.
- Produces: `window.__ascii.station()`, which returns `stationState`: `'off' | 'down' | 'in' | 'up'`.

- [ ] **Step 1: Add the fade overlay.** In `index.html`, add this just before the closing `</body>` (after the other overlays):

```html
    <div class="fade" id="fade" hidden aria-hidden="true"><span></span></div>
```

In `src/style.css`, append:

```css
/* Going down to the station and back up (station spec §1). */
.fade { position: fixed; inset: 0; z-index: 60; background: #000; display: grid; place-items: center; color: rgb(233 162 59); opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }
.fade.on { opacity: 1; pointer-events: auto; }
body.in-station .hud-tools, body.in-station .chat-log, body.in-station .chat-form, body.in-station .emote-bar, body.in-station .pad { display: none !important; }
@media (prefers-reduced-motion: reduce) { .fade { transition: none; } }
```

- [ ] **Step 2: Wire it into `src/main.js`.**

Change the router import (line 26):

```js
import { parseRoute, photoHash, roomHash, replaceHash, ALL_HASH, STATION_HASH } from './router.js';
```

Add near the other module-level `let`s (just after `let following = null, followAt = 0;`):

```js
// The station (station spec §1): 'off' (the gallery runs), 'down' (fading out, loading), 'in', 'up' (leaving).
let stationState = 'off', station = null;
const fadeEl = document.getElementById('fade');
function fade(on, text = '') {
  fadeEl.firstElementChild.textContent = text;
  fadeEl.hidden = false;
  if (reducedMotion) { fadeEl.classList.toggle('on', on); fadeEl.hidden = !on; return Promise.resolve(); }
  void fadeEl.offsetWidth; // start the transition from where it is
  fadeEl.classList.toggle('on', on);
  return new Promise((done) => setTimeout(() => { if (!on) fadeEl.hidden = true; done(); }, 320));
}
const onStairs = () => {
  const s = map.stairs && map.stairs.inside;
  if (!s) return false;
  const x = Math.floor(world.player.x), y = Math.floor(world.player.y);
  return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
};
const standAtStairs = () => teleport(world, map.stairs.front.x, map.stairs.front.y);
async function goDown({ instant = false } = {}) {
  if (stationState !== 'off' || !map.stairs) return;
  stationState = 'down';
  world.frozen = true;
  world.path = null;
  world.onArrive = null;
  stopFollowing();
  if (instant) { fadeEl.hidden = false; fadeEl.firstElementChild.textContent = '▼ going down…'; fadeEl.classList.add('on'); }
  else await fade(true, '▼ going down…');
  try {
    const { startStation } = await import('./rpg/index.js');
    if (stationState !== 'down') return; // the back button won while it loaded
    station = startStation(stage, { onExit: () => goUp(), keys: () => input.state(), reducedMotion, phone: touch });
  } catch (err) {
    console.warn(err);
    stationState = 'off';
    standAtStairs();
    world.frozen = false;
    if (location.hash === STATION_HASH) replaceHash('');
    await fade(false);
    note("the station couldn't load", 3000);
    return;
  }
  if (live) live.net.pause(); // to the gallery, you've left (spec §1)
  document.body.classList.add('in-station');
  if (location.hash !== STATION_HASH) history.pushState(null, '', STATION_HASH);
  stationState = 'in';
  await fade(false);
}
async function goUp({ fromHistory = false } = {}) {
  if (stationState === 'down') { stationState = 'off'; standAtStairs(); world.frozen = false; await fade(false); return; }
  if (stationState !== 'in') return;
  stationState = 'up';
  await fade(true);
  station.stop();
  station = null;
  document.body.classList.remove('in-station');
  if (live) live.net.resume();
  standAtStairs();
  if (!fromHistory && location.hash === STATION_HASH) replaceHash('');
  world.frozen = false;
  stationState = 'off';
  await fade(false);
  stage.focus({ preventScroll: true });
}
```

`touch` and `reducedMotion` already exist in `main.js`. Check with `grep -n "const touch\|reducedMotion =" src/main.js`. If `touch` has a different name (for example `isTouch`), use that name.

In `applyRoute`, before the final `else`, add the station branch:

```js
  } else if (route.kind === 'station') {
    if (stationState === 'off') goDown({ instant: true });
  } else {
```

Replace the hashchange listener near the end of `boot()`:

```js
  addEventListener('hashchange', () => {
    const route = parseRoute(location.hash);
    if (stationState !== 'off' && (!route || route.kind !== 'station')) { goUp({ fromHistory: true }); return; }
    applyRoute(route);
  });
```

At the very top of `onTap(px, py)`:

```js
  if (stationState !== 'off') return;
```

At the very top of `onKey(e)`:

```js
  if (stationState !== 'off') return false;
```

At the top of `loop(now)`, right after `last = now;`:

```js
  if (stationState !== 'off') { requestAnimationFrame(loop); return; } // the station draws; the gallery waits
```

In `loop`, right after the `step(world, dt, away ? idle() : controls(t));` line:

```js
  if (!away && world.mode === 'top' && !world.frozen && onStairs()) goDown();
```

In the `window.__ascii = { … }` test hook, add:

```js
station: () => stationState,
```

- [ ] **Step 3: Check it by hand in the dev server.**

Run: `npm run dev`, then open http://localhost:5173 in a browser.
1. Walk to the `▼ SUBWAY` stairwell in the lobby's south-west corner and onto it. Expected: the screen fades and shows `▼ going down…`, and you arrive in the station with the address `#/station`.
2. Walk around with WASD, and walk west onto the exit. Expected: you fade back to the lobby, standing two rows in front of the stairwell, and the address has no hash.
3. Go down again and press the browser's back button. Expected: you come up.
4. Load http://localhost:5173/#/station. Expected: you start in the station.

Stop the dev server when done.

- [ ] **Step 4: Run all the unit tests**

Run: `npm test`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add index.html src/style.css src/main.js
git commit -m "Station: the lobby's stairs take you down, fading out while it loads; the exit or the back button bring you up in front of them; #/station goes straight down; you leave the gallery's multiplayer while you're below

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: End-to-end checks for the way in and out

**Files:**
- Create: `e2e/station.mjs`
- Modify: `package.json`, the `e2e` script.

**Interfaces:**
- Consumes: `window.__ascii` (`map.stairs`, `walkTo`, `world`, `station()`), `window.__station` (Task 8's hook) and `withBrowser`/`ready`/`sleep`/`SHOTS` from `e2e/lib.mjs`.

- [ ] **Step 1: Write `e2e/station.mjs`**

```js
// The station (station spec §6): down the lobby's stairs, walking, back up, the back button, a direct link,
// a resize, and staying in the gallery when the station can't load. Usage: node e2e/station.mjs
import { withBrowser, ready, sleep, SHOTS } from './lib.mjs';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const results = [];
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const check = async (name, fn) => {
  if (only && !only.test(name)) return;
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
};
const inStation = (page) => page.waitForFunction(() => window.__station && window.__station.frames() > 20, { timeout: 30000 });
const backInGallery = (page) => page.waitForFunction(() => !window.__station && window.__ascii.station() === 'off' && !window.__ascii.world.frozen, { timeout: 15000 });
const takeStairs = (page) => page.evaluate(() => { const s = window.__ascii.map.stairs.inside; window.__ascii.walkTo(s.x + 2, s.y); });

await withBrowser(async ({ page, url, errors }) => {
  await page.goto(url);
  await ready(page);

  await check('walking onto the lobby stairs goes down to the station', async () => {
    await takeStairs(page);
    await inStation(page);
    assert.equal(await page.evaluate(() => location.hash), '#/station');
    assert.equal(await page.evaluate(() => document.body.classList.contains('in-station')), true);
  });

  await check('the station draws something', async () => {
    await sleep(500);
    const shot = await page.screenshot({ path: `${SHOTS}/station-hall.png` });
    const { channels } = await sharp(shot).stats();
    assert.ok(channels.some((c) => c.stdev > 8), 'not a blank screen');
  });

  await check('you walk', async () => {
    const a = await page.evaluate(() => ({ ...window.__station.walker }));
    await page.keyboard.down('KeyD');
    await sleep(600);
    await page.keyboard.up('KeyD');
    const b = await page.evaluate(() => ({ ...window.__station.walker }));
    assert.ok(b.x > a.x + 1, `moved east ${a.x.toFixed(2)} → ${b.x.toFixed(2)}`);
  });

  await check('resizing keeps the station filling the window', async () => {
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
    await sleep(300);
    const size = await page.evaluate(() => { const c = document.querySelector('canvas.station'); return { w: c.clientWidth, h: c.clientHeight }; });
    assert.deepEqual(size, { w: 800, h: 600 });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  });

  await check('the exit brings you up in front of the stairs, and not straight back down', async () => {
    await page.evaluate(() => window.__station.teleport(2.5, 9.5));
    await page.keyboard.down('KeyA');
    await page.waitForFunction(() => !window.__station, { timeout: 5000 });
    await page.keyboard.up('KeyA');
    await backInGallery(page);
    const { p, s } = await page.evaluate(() => ({ p: { ...window.__ascii.world.player }, s: window.__ascii.map.stairs }));
    assert.ok(Math.abs(p.x - s.front.x) < 1.5 && Math.abs(p.y - s.front.y) < 1.5, `in front: ${p.x},${p.y}`);
    assert.notEqual(await page.evaluate(() => location.hash), '#/station');
    await sleep(800);
    assert.equal(await page.evaluate(() => window.__ascii.station()), 'off', 'still in the gallery');
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 0, 'the station canvas is gone');
  });

  await check('the back button brings you up', async () => {
    await takeStairs(page);
    await inStation(page);
    await page.goBack();
    await backInGallery(page);
  });

  await check('back during the walk down leaves you in the gallery, unfrozen', async () => {
    await takeStairs(page);
    await page.waitForFunction(() => window.__ascii.station() !== 'off', { timeout: 15000 });
    await page.evaluate(() => history.pushState(null, '', '#/elsewhere'));
    await page.evaluate(() => { location.hash = ''; });
    await backInGallery(page);
    await sleep(500);
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 0);
  });

  await check('a link to #/station goes straight down', async () => {
    await page.goto('about:blank');
    await page.goto(`${url}#/station`);
    await inStation(page);
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));

  await check('if the station cannot load, you stay in the gallery', async () => {
    await page.goto('about:blank');
    await page.setRequestInterception(true);
    const block = (req) => (req.url().includes('/src/rpg/index.js') ? req.abort() : req.continue());
    page.on('request', block);
    try {
      await page.goto(url);
      await ready(page);
      await takeStairs(page);
      await page.waitForFunction(() => window.__ascii.station() === 'off' && !window.__ascii.world.frozen && /couldn.t load/.test(document.body.innerText), { timeout: 30000 });
      assert.equal(await page.evaluate(() => !!window.__station), false);
      assert.notEqual(await page.evaluate(() => location.hash), '#/station');
    } finally {
      page.off('request', block);
      await page.setRequestInterception(false);
    }
  });
});

for (const [s, name, msg] of results) console.log(`${s.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}`);
process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
```

In "back during the walk down", the hash is set to empty while the state is `'down'`. That fires hashchange, and `goUp` treats `'down'` as "cancel": the import finishes, sees `stationState !== 'down'`, and doesn't start. The load-failure check runs after "no page errors" on purpose, because the blocked request logs a console error by design.

- [ ] **Step 2: Run it**

Run: `node e2e/station.mjs`
Expected: every line is `ok`.
- **If "walking onto the lobby stairs" times out:** check that `walkTo` reaches the tread. `map.stairs.inside.y` is the open top row.
- **If "back during the walk down" fails because the import finished too fast** (the state was already `'in'`): it still has to end in the gallery, because the hashchange handler calls `goUp` for `'in'` too. Look at which assertion failed before changing anything.

- [ ] **Step 3: Add it to `npm run e2e`.** In `package.json`, change the `e2e` script to:

```json
"e2e": "node e2e/run.mjs && node e2e/editor.mjs && node e2e/multiplayer.mjs && node e2e/station.mjs",
```

- [ ] **Step 4: Run the gallery's own e2e, because the lobby and `main.js` changed**

Run: `node e2e/run.mjs`
Expected: every line is `ok`. In particular, "walks through every room" must never get pulled down the stairs: the stairwell is a dead-end pocket, so no path between rooms crosses it. If it does, the check will show it in the station. Then move the stairwell further into the corner (Task 7). Don't add an exception to the walk.

- [ ] **Step 5: Commit**

```bash
git add e2e/station.mjs package.json
git commit -m "Station: end-to-end checks for the stairs down, walking, the exit, the back button, a direct link, a resize and a failed load

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The station's life: the passing train, tunnels, flicker, dust, drips and a newspaper

**Files:**
- Modify: `src/rpg/scene.js`, adding the train, tunnel lights, dust, drips, the newspaper, flicker and `shake`.
- Modify: `e2e/station.mjs`, adding a train check.

**Interfaces:**
- Consumes: `trainAt` results (Task 5: `{ phase, warn, track, dir, head, tail }`), `TRAIN` and `LENGTH`.
- Produces: `buildScene(...).update(time, dt, walker, train)` now animates everything, and `buildScene(...).shake(time, walker, train) → { x, y }`, which `index.js` already calls.

- [ ] **Step 1: Add the train to `scene.js`.** Add `import { TRAIN } from './train.js';` at the top. Inside `buildScene`, before `return {`, add:

```js
  // The passing train (spec §5): 4 cars with ASCII panels and lit windows, headlights that bloom, and a light
  // that sweeps the platform edge ahead of it.
  const carTex = own(trainTexture(false)), carGlow = own(trainTexture(true));
  const carMat = own(new THREE.MeshStandardMaterial({ map: carTex, emissiveMap: carGlow, emissive: '#ffffff', emissiveIntensity: 1.2, roughness: 0.6, metalness: 0.3 }));
  const carGeo = own(new THREE.BoxGeometry(TRAIN.car, 2.6, 2.3));
  const train = new THREE.Group();
  const cars = [];
  for (let i = 0; i < TRAIN.cars; i++) { const m = new THREE.Mesh(carGeo, carMat); cars.push(m); train.add(m); }
  const lampGeo = own(new THREE.SphereGeometry(0.12, 12, 8));
  const lampMat = own(new THREE.MeshBasicMaterial({ color: '#fff3d0', toneMapped: false }));
  const lamps = [new THREE.Mesh(lampGeo, lampMat), new THREE.Mesh(lampGeo, lampMat)];
  const headlight = new THREE.PointLight('#fff1cc', 40, 16, 1.4);
  train.add(...lamps, headlight);
  train.visible = false;
  scene.add(train);
  // Each tunnel mouth glows as a train comes (3 s of warning).
  const mouths = map.tracks.flatMap((t) => [-1, 1].map((side) => {
    const l = new THREE.PointLight('#ffd9a0', 0, 9, 1.5);
    l.position.set(side < 0 ? 0.3 : map.cols - 0.3, t.y + 1.6, t.z);
    scene.add(l);
    return { track: t, side, light: l };
  }));

  // Dust in the light, blown along when a train passes.
  const DUST = reducedMotion ? 80 : 160;
  const dustPos = new Float32Array(DUST * 3), dustVel = new Float32Array(DUST);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < DUST; i++) { dustPos[i * 3] = rnd() * 14 - 7; dustPos[i * 3 + 1] = rnd() * 3.2; dustPos[i * 3 + 2] = rnd() * 10 - 5; dustVel[i] = 0.05 + rnd() * 0.1; }
  const dustGeo = own(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = own(new THREE.PointsMaterial({ color: '#cdd6ea', size: 0.05, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // Drips into each puddle, with a ripple.
  const dripGeo = own(new THREE.SphereGeometry(0.03, 6, 4));
  const ringGeo = own(new THREE.RingGeometry(0.05, 0.08, 24).rotateX(-Math.PI / 2));
  const waterMat = own(new THREE.MeshBasicMaterial({ color: '#9fc7ff', transparent: true, opacity: 0.8, depthWrite: false }));
  const puddles = map.cells.filter((c) => c.ch === '~').map((c, i) => {
    const drop = new THREE.Mesh(dripGeo, waterMat), ring = new THREE.Mesh(ringGeo, waterMat.clone());
    owned.push(ring.material);
    scene.add(drop, ring);
    return { x: c.c + 0.5, z: c.r + 0.5, y: c.level, drop, ring, period: 1.3 + i * 0.37 };
  });

  // A sheet of newspaper on the platform, which the train's wind skitters along.
  const news = makeSprite(PROPS.news.lines, PROPS.news.colors, PROPS.news.h);
  owned.push(news);
  news.mesh.position.set(30.5, -3, 12.4);
  scene.add(news.mesh);
  const flicker = tubes.length > 3 ? 3 : 0; // the one tube with a fault
```

At the bottom of `scene.js` (next to `nameTexture`), add:

```js
function trainTexture(glow) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = glow ? '#000' : '#7d8592'; g.fillRect(0, 0, 512, 256);
  if (!glow) { g.fillStyle = '#b8323a'; g.fillRect(0, 176, 512, 18); }
  for (let i = 0; i < 6; i++) { // windows
    g.fillStyle = glow ? '#ffd890' : '#2a2620';
    g.fillRect(24 + i * 82, 56, 64, 72);
    if (!glow) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = `40px ${FONT}`; g.fillText('▤', 40 + i * 82, 110); }
  }
  if (!glow) { g.fillStyle = '#e8ecf2'; g.font = `700 22px ${FONT}`; g.fillText('MUSEUM LINE', 190, 230); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
```

- [ ] **Step 2: Animate it.** Replace the returned `update` (and add `shake`) in `buildScene`:

```js
    update(time, dt, walker, pass) {
      placeWalls(walker);
      // Tubes: steady, but one has a fault, and the ones near a passing train shudder.
      tubes.forEach((t, i) => {
        let k = 1;
        if (i === flicker && !reducedMotion) k = Math.sin(time * 31) + Math.sin(time * 7.3) > 1.3 ? 0.15 : 1;
        if (pass && pass.phase === 'pass' && !reducedMotion && Math.abs(t.x - pass.head) < 4) k *= 0.55 + 0.45 * Math.abs(Math.sin(time * 53 + i));
        t.light.intensity = t.base * k;
        t.bar.visible = k > 0.3;
      });
      // The train and its tunnels.
      for (const m of mouths) {
        const coming = pass && pass.track === m.track && (pass.dir > 0 ? m.side < 0 : m.side > 0);
        m.light.intensity = coming ? (pass.phase === 'warn' ? 25 * pass.warn : 25) : 0;
      }
      train.visible = !!pass && pass.phase === 'pass';
      if (train.visible) {
        const t = pass.track, y = t.y + 1.45;
        cars.forEach((car, i) => car.position.set(pass.head - pass.dir * (TRAIN.car / 2 + i * (TRAIN.car + TRAIN.gap)), y, t.z));
        lamps[0].position.set(pass.head + pass.dir * 0.02, y - 0.6, t.z - 0.7);
        lamps[1].position.set(pass.head + pass.dir * 0.02, y - 0.6, t.z + 0.7);
        headlight.position.set(pass.head + pass.dir * 3, y - 0.4, t.z);
      }
      // Dust follows the view, drifting; a passing train blows it along.
      const wind = pass && pass.phase === 'pass' ? pass.dir * 6 * Math.max(0, 1 - Math.abs(pass.head - walker.x) / 25) : pass && pass.phase === 'warn' ? 0.6 * pass.dir : 0;
      const slow = reducedMotion ? 0.4 : 1;
      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3] += (wind + Math.sin(time * 0.3 + i) * 0.05) * dt * slow;
        dustPos[i * 3 + 1] += dustVel[i] * Math.sin(time * 0.5 + i * 1.7) * dt * slow;
        if (dustPos[i * 3] > 7) dustPos[i * 3] -= 14; else if (dustPos[i * 3] < -7) dustPos[i * 3] += 14;
      }
      dust.position.set(walker.x, walker.y, walker.z - 1);
      dustGeo.attributes.position.needsUpdate = true;
      // Drips: 0.6 s falling from the ceiling, then a ripple for 0.8 s.
      for (const p of puddles) {
        const ph = (time % p.period) / p.period, fallEnd = 0.6 / p.period;
        p.drop.visible = ph < fallEnd;
        p.drop.position.set(p.x, p.y + 3.4 * (1 - ph / fallEnd), p.z);
        const rt = (ph - fallEnd) * p.period;
        p.ring.visible = rt > 0 && rt < 0.8;
        p.ring.position.set(p.x, p.y + 0.02, p.z);
        p.ring.scale.setScalar(1 + rt * 7);
        p.ring.material.opacity = 0.8 * (1 - rt / 0.8);
      }
      // The newspaper skitters in the wind, staying on the platform.
      if (wind) {
        const x = news.mesh.position.x + wind * 0.5 * dt;
        news.mesh.position.x = x > 45 ? 21 : x < 21 ? 45 : x;
        news.mesh.rotation.z = Math.sin(time * 9) * 0.3;
      }
    },
    shake(time, walker, pass) {
      if (reducedMotion || !pass || pass.phase !== 'pass') return { x: 0, y: 0 };
      const a = 0.05 * Math.max(0, 1 - Math.abs(pass.head - walker.x) / 20);
      return { x: a * Math.sin(time * 61), y: a * Math.sin(time * 47) };
    },
```

- [ ] **Step 3: Add the train check to `e2e/station.mjs`.** Put it after "you walk":

```js
  await check('a train comes out of the tunnel and passes', async () => {
    await page.evaluate(() => { window.__station.teleport(30.5, 9.5); window.__station.setTime(4); });
    await page.waitForFunction(() => window.__station.train()?.phase === 'warn', { timeout: 10000 });
    await page.waitForFunction(() => window.__station.train()?.phase === 'pass', { timeout: 10000 });
    await page.waitForFunction(() => { const t = window.__station.train(); return t && Math.abs(t.head - 30) < 6; }, { timeout: 5000 });
    await page.screenshot({ path: `${SHOTS}/station-train.png` });
    await page.waitForFunction(() => !window.__station.train(), { timeout: 10000 });
  });
```

- [ ] **Step 4: Run it and look**

Run: `node e2e/station.mjs`
Expected: every line is `ok`. Open `e2e/shots/station-train.png`.
- **You should see:** the train mid-platform, with lit windows and bright headlights; the tubes near it dimmed; you still crisp.

Also take one screenshot of the platform with no train, using the throwaway script from Task 8. Check that the drips and the dust are visible but faint, that one tube flickers, and that the newspaper is on the platform.

- [ ] **Step 5: Commit**

```bash
git add src/rpg/scene.js e2e/station.mjs
git commit -m "Station: the passing train with lit windows and headlights, tunnel mouths that glow before it, a faulty tube, dust it blows along, drips with ripples and a newspaper in its wind

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: A look pass, and everything green

**Files:**
- Modify (tuning only): `src/rpg/scene.js`, `src/rpg/post.js`, `src/rpg/index.js` and `src/rpg/sprites.js`, if the screenshots call for it.

- [ ] **Step 1: Shoot the station at several moments.** Use the throwaway scratchpad script and take 1440×900 and 390×844 (phone portrait) screenshots:
  - in the hall at the spawn;
  - on the stairs;
  - on the platform by a pillar;
  - on the platform during a train (`setTime(startOf(0) + 1)`);
  - next to a bench on the platform's south side, which should make the south wall fade.

Compare them with the chosen mockup, card 2 of `.superpowers/brainstorm/16440-1792095090/content/visual-style-d2.html`. Check each item in this list:
  - you're the brightest, crispest thing, in the sharp band;
  - the top of the screen is blurred more than the bottom;
  - nothing blows out to white; if something does, raise the bloom threshold or lower the tube intensity;
  - the surfaces' ASCII is faint and calm: no specks, no noise;
  - the walls on the camera's side fade when you're near them;
  - on the phone, about 8 tiles across, and you're not hidden by the HUD (it's hidden in the station);
  - the frame rate: open the page with `?debug` and watch the browser's FPS meter (DevTools → Rendering → Frame rendering stats). Expect 60 on a laptop.

Change only constants: light intensities, bloom strength and threshold, blur strengths, fog distances, sprite heights. Keep each change small. List what you changed and why in the commit message.

- [ ] **Step 2: Run everything relevant**

Run: `npm test && node e2e/run.mjs && node e2e/station.mjs && npm run build`
Expected: all unit tests pass, both e2e runs are all `ok`, and the build succeeds. `grep -l WebGLRenderer dist/assets/main-*.js` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add src/rpg
git commit -m "Station: a look pass, <what changed, e.g. tubes 7 → 6, bloom threshold 0.85 → 0.88, blur top 3.2 → 2.6>

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

If nothing needed changing, skip the commit and say so.
