# Arena PvP and stickmen: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everyone in the arena's side view is an ASCII stickman, and they fight: three guns (deagle, rifle, sniper), punch/kick with knockback, rolls, pickups, popping and respawning. The server decides every hit, and remote fighters move as smoothly as your own body.

**Architecture:** The game rules live in pure modules that both the browser and the Cloudflare Worker import:
- `src/level.js`: the level file;
- `src/fight.js`: numbers and geometry;
- `src/referee.js`: the rules engine, which takes fighter records and returns the messages to broadcast;
- `src/stick.js`: pose art and the gun constants.

`server/gallery.js` is a thin wrapper that runs the referee over socket attachments, and `server/rules.js` validates the wire. In the browser, `src/pvp.js` (DOM-free) runs your fight. It also runs a local referee for the practice dummy and for offline play. `src/fighters.js` predicts remote fighters with the shared physics, `src/fx.js` turns bullets, sparks and pickups into glyphs, and `src/render/figures.js` turns bodies into outlined glyph instances, which both renderers draw.

**Tech Stack:**
- Vanilla ES modules, Vite 5.
- `node --test` for unit tests.
- Puppeteer for e2e.
- A Cloudflare Worker with a Durable Object (hibernation API), run locally with `wrangler dev`.

**Spec:** Two specs, both approved as written at commit 4d7d134. Where they disagree, the later-dated interface sections win.
- `docs/specs/2026-10-14-arena-pvp-design.md` (PvP)
- `docs/specs/2026-10-14-arena-stickman-design.md` (stickman)

The user's four decisions are in: limited pickup ammo, the sniper aim line visible to everyone, roll protection by timing, and no shooting while rolling.

## Global Constraints

Every task's requirements include this section.

**Running things**
- Run every node/npm/npx command with `< /dev/null`. macOS has no `timeout` command.
- Unit tests: `npm test < /dev/null` (runs `node --test "test/*.test.js"`).
- Server tests: `cd server && npm test < /dev/null`. They start `wrangler dev` on port 8797.
- e2e: run `node e2e/run.mjs`, `node e2e/editor.mjs` and `node e2e/multiplayer.mjs` **separately**, each `< /dev/null`.
  - run.mjs takes about 3.5 min; use a Bash timeout of 560000 ms.
  - Never edit source while an e2e run is going (Vite hot-reloads).
  - A frame-rate check failing at exactly 30 fps means the Mac is on battery (Low Power Mode). Report it as that, not as a regression.

**Git**
- Work directly on `main`. **Never push. Never deploy** (no `wrangler deploy`).
- One commit per task, message `Arena PvP: <what>`, ending with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Other tasks may be running in parallel in the same working tree. Commit only your own files: `git add <your files> && git commit -m "…" -- <your files>`. If `index.lock` exists, wait 2 s and retry.
- Don't edit or revert files outside your task's **Files** list. If a test file owned by a parallel task fails while that task is still in progress, say so in your report; don't fix it.

**Purity**
- `src/level.js` has **no imports**.
- `src/fight.js`, `src/referee.js` and `src/stick.js` import only each other and `src/level.js`.
- None of these use DOM, `window`, `performance`, `Math.random` (take `rand` as a parameter) or any Node API. The Worker bundles them.
- `src/fighters.js`, `src/fx.js`, `src/pvp.js` and `src/render/figures.js` are DOM-free too, so `node --test` can import them.

**Units**
- Cells across, rows down. A row is twice as tall as a cell is wide (`CELL_ASPECT = 2`).
- **On-screen angles**: a distance `r` along angle `θ` is `(r cos θ, r sin θ / 2)` in cells and rows. `+` is down.
- **Absolute angle**: 0 is east, range −π..π.
- **`aim`**: relative to facing, in [−π/2, π/2].

**Coordinates**
- The wire uses **arena-local** cells: `x` 0..160 across the interior, `y` 0..34 down, the body's centre.
- The browser uses **map** cells. `local = map − (a.x + 1, a.y + 1)`, where `a = map.arena`. Convert only at the edge (`pvp.js`, `fighters.js`).

**Time**
- `fight.js` and `referee.js` take time in **seconds**: server `Date.now() / 1000`, browser `performance.now() / 1000`.
- Wire fields `ts` and `at` are integer **milliseconds**.

**Body**
- The physics box is 0.8 × 3 (`HW 0.4`, `HH 1.5`), with `x, y` its centre and the feet at `y + 1.5`.
- The hurtbox is 1.0 × 3 on the same centre.

**Code style**
- Match the surrounding code: 2-space indent, single quotes, semicolons, short plain-English comments, no TypeScript, no new dependencies.
- Tests use `node:test` + `node:assert/strict`.

**Reduce Motion** never changes gameplay (knockback, rolls, stun decay, bullets, remote movement). It only changes looks.

**Phones**
- 852 × 393 landscape with touch: cell 6 × 12 px.
- Pad targets ≥ 56 px; FIRE and JUMP 64 px.

**Glyphs** in figures: printable ASCII plus `═ ╦ ╤ °`. Both renderers draw everything the same way.

## Review Focus

These five behaviours are implied by the specs but no task's main tests exercise them. Each has a pinning test in the task that owns the code.
1. **The connection drops mid-fight, then comes back.** Remote fighters fade, bullets clear, my health resets, the dummy is back after 2 s, and a fresh `ae` goes out on reconnect, with kills from 0. Never a stale fighter or a page error. Test in Task 13.
2. **An old server, or a `fight` hash mismatch.** No fighting, the dummy, a `console.warn`, and others drawn as plain stickmen from their `p` positions. They can't hit or be hit. Tests in Tasks 5 and 13.
3. **Going away mid-action** (opening a photo, the map or the grid while dead, mid-roll or holding J). `al` goes out once. Coming back sends `ae` once, with nothing still held: not fire, not a roll, not a direction. Tests in Tasks 6 and 13.
4. **Frame-rate extremes** (20 fps, 144 fps, a 50 ms dt clamp after a background tab):
   - a roll still covers 14 ± 1 cells;
   - the fire cooldown holds (at most one deagle shot per 0.4 s);
   - the `a` ticker never exceeds 20/s.
   Tests in Tasks 2, 5 and 13.
5. **Arena messages that arrive out of order or before `aw`** (an `a`, `h` or `s` for an unknown id, a `k` for someone already gone, `sp` before `aw`). Each is ignored without throwing, and the next `aw` rebuilds the state. Tests in Tasks 10 and 13.

## File structure

| File | Owner task | Responsibility |
|---|---|---|
| `src/level.js` (new) | 1 | cell kinds, `parseLevel` (with `S`, `R`, `N` markers), `levelKind`, `levelHash` |
| `src/arena.txt` | 1 | the level, with six `S`, two `R`, one `N` |
| `src/stick.js` (new) | 1, 4, 7 | `SHOULDER`, `HAND_R`, `MUZZLE_R`, `GUN_ART` (Task 1); `stickPose` (Tasks 4, 7); `createMotionMemory` (Task 7) |
| `src/arena.js` | 1, 2 | re-exports level.js (1); 3-row body, `knock`, stun, roll, door wall while stunned (2) |
| `src/world.js` | 2, 13 | `enterSide` at `floorY − 1.5` (2); `aimFacing`, camera shake (13) |
| `src/fight.js` (new) | 3 | numbers, guns, strikes, aim, ray cast, sweep, regen, flee, spawn choice, dodge, bullet glyphs |
| `src/live.js`, `src/net.js`, `src/peers.js` | 5 | `arenaTicker`, arena messages, `fight` check, no `p` inside, `peerColor` skips amber, derived motion for `p`-only people |
| `src/input.js` | 6 | J, K, mouse aim and buttons, double-tap rolls, pad FIRE/HIT |
| `src/referee.js` (new) | 8 | rules engine: fighters, bullets, tick, strikes, pickups, respawn, flee |
| `server/rules.js` | 9 | new messages, buckets, speed clamp, sender clock |
| `src/fighters.js` (new) | 10 | remote fighters: prediction, correction, acts, silence |
| `src/fx.js` (new) | 11 | bullets on screen, sparks, damage numbers, hp bars, pickups, sniper aim lines → glyphs |
| `server/gallery.js`, `server/test/server.test.js`, `.github/workflows/server.yml` | 12 | Worker: arena membership, referee, bullet tick, `welcome.fight` |
| `src/pvp.js` (new) | 13 | my fight: controls, acts, offline referee and dummy, messages, HUD data |
| `src/render/figures.js` (new), `src/render/canvas.js`, `src/render/gl.js`, `src/render/shaders.js` | 14 | outlined figure layer in both renderers, `pointAt` |
| `src/main.js` | 14, 15 | side-view bodies, `__ascii.pose`, `?bots=30` (14); PvP wiring, HUD, notes, away (15) |
| `index.html`, `src/style.css`, `src/config.js` | 15 | pad 2×2, fight HUD, scrim, `ARENA.pvp` |
| `e2e/run.mjs` | 14, 16 | stickman shots (14); offline PvP (16) |
| `e2e/multiplayer.mjs` | 16 | two-browser PvP |

## Waves (what may run in parallel)

| Wave | Tasks (parallel within a wave) | Needs |
|---|---|---|
| A | 1 | — |
| B | 2, 3, 4, 5, 6 | 1 |
| C | 7, 8, 9, 10, 11 | 7←4; 8←2,3; 9←3; 10←2; 11←3 |
| D | 12, 13, 14 | 12←8,9; 13←5,6,8,10,11; 14←5,7 |
| E | 15 | all of the above |
| F | 16 | 15 |

---

### Task 1: Level markers, `src/level.js`, and the shared gun constants

**Files:**
- Create: `src/level.js`, `test/level.test.js`
- Create: `src/stick.js` (constants only; later tasks add to it)
- Modify:
  - `src/arena.js`: the `parseLevel` block, lines 6–19, becomes a re-export;
  - `src/arena.txt`: add the markers;
  - `test/arena.test.js`: the first test's character set, plus the new level-rule tests.

**Interfaces:**
- Produces (`src/level.js`, no imports):
  - `AIR = 0, PLATFORM = 1, SOLID = 2`
  - `LEVEL_COLS = 160, LEVEL_ROWS = 34`
  - `PICKUP_GUN = { R: 'rifle', N: 'sniper' }`
  - `parseLevel(text, cols = 160, rows = 34)` → `{ cols, rows, cells: Uint8Array, spawns: [{ c, r, x, y }], pickups: [{ n, gun, c, r, x, y }] }`
    - `S`, `R` and `N` are AIR.
    - Markers come in reading order (top row first, left to right). A pickup's `n` is its index.
    - `x = c + 0.5`, `y = r − 0.5`: the body's centre when its feet are on the top of row `r + 1`.
  - `levelKind(L)` → `(c, r) => kind`; anything outside `0..cols−1 × 0..rows−1` is SOLID.
  - `levelHash(text)` → 8 lowercase hex characters: FNV-1a 32-bit over the code points of `text` with `\r` removed.
- Produces (`src/stick.js`, pure):
  - `SHOULDER = { dx: 0.15, dy: -0.3 }`
  - `HAND_R = 1.3`
  - `MUZZLE_R = { deagle: 2.8, rifle: 4.8, sniper: 6.8 }`
  - `GUN_ART = { deagle: { glyphs: '╦═', hand: 0 }, rifle: { glyphs: '═╦╤══', hand: 1 }, sniper: { glyphs: '═╦═°═══', hand: 1 } }`. `hand` is the index of the glyph at the hand.
- `src/arena.js` keeps exporting `AIR, PLATFORM, SOLID, LEVEL_COLS, LEVEL_ROWS, parseLevel` (re-exported from level.js), so its existing importers are unchanged.

**Markers to place** (`row`, `col`, 0-based, in the feet row: the row directly above the surface):

| marker | row, col | stands on |
|---|---|---|
| `N` sniper | 3, 118 | the `═` at row 4, cols 105–132 |
| `R` rifle | 15, 150 | row 16, cols 141–159 |
| `R` rifle | 18, 26 | row 19, cols 20–32 |
| `S` high, west | 3, 52 | row 4, cols 44–59 |
| `S` high, east | 7, 92 | row 8, cols 66–95 |
| `S` mid, west | 13, 10 | row 14, cols 4–15 |
| `S` mid, east | 15, 120 | row 16, cols 96–130 |
| `S` yellow line, west of the left pillar | 28, 14 | row 29 |
| `S` yellow line, between the pillars | 28, 100 | row 29 |

Each marker replaces one space. Keep each line exactly 160 characters.

- [ ] **Step 1: Write the failing tests** in `test/level.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind, levelHash, AIR, PLATFORM, SOLID } from '../src/level.js';

const text = fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8');
const L = parseLevel(text);
const at = (c, r) => L.cells[r * L.cols + c];

test('S, R and N are air, returned in reading order with the body centre standing there', () => {
  const T = parseLevel(' S\nR N\n═══\n', 3, 3);
  assert.deepEqual([...T.cells], [AIR, AIR, AIR, AIR, AIR, AIR, PLATFORM, PLATFORM, PLATFORM]);
  assert.deepEqual(T.spawns, [{ c: 1, r: 0, x: 1.5, y: -0.5 }]);
  assert.deepEqual(T.pickups, [{ n: 0, gun: 'rifle', c: 0, r: 1, x: 0.5, y: 0.5 }, { n: 1, gun: 'sniper', c: 2, r: 1, x: 2.5, y: 0.5 }]);
});

test('levelKind: inside is the level, outside is solid (walls, floor, ceiling and the door)', () => {
  const k = levelKind(L);
  assert.equal(k(-1, 5), SOLID);
  assert.equal(k(160, 32), SOLID);
  assert.equal(k(5, 34), SOLID);
  assert.equal(k(5, -1), SOLID);
  assert.equal(k(0, 29), PLATFORM);
});

test('levelHash: 8 hex, stable, ignores \\r, and changes with one character', () => {
  assert.match(levelHash(text), /^[0-9a-f]{8}$/);
  assert.equal(levelHash(text), levelHash(text.replace(/\n/g, '\r\n')));
  assert.notEqual(levelHash(text), levelHash(text.replace('S', ' ')));
  assert.equal(levelHash(''), '811c9dc5');
});

test('the Penn Station level has 6 spawns: two on the yellow line, two mid, two high, one of each pair per half', () => {
  assert.equal(L.spawns.length, 6);
  const rows = L.spawns.map((s) => s.r);
  assert.equal(rows.filter((r) => r === 28).length, 2);
  const line = L.spawns.filter((s) => s.r === 28).map((s) => s.c).sort((a, b) => a - b);
  assert.ok(line[0] < 35 && line[1] > 42 && line[1] < 133, 'one west of the left pillar, one between the pillars');
  const pairs = [L.spawns.filter((s) => s.r === 28), L.spawns.filter((s) => s.r >= 10 && s.r < 28), L.spawns.filter((s) => s.r < 10)];
  for (const p of pairs) {
    assert.equal(p.length, 2);
    assert.equal(p.filter((s) => s.c < 80).length, 1, 'one in each half');
  }
});

test('every spawn and pickup: air with 2 more rows of air above, something to stand on, none within 10 columns of the door, none in the track bed', () => {
  for (const m of [...L.spawns, ...L.pickups]) {
    for (let r = m.r - 2; r <= m.r; r++) assert.equal(at(m.c, r), AIR, `${m.c},${r}`);
    assert.notEqual(at(m.c, m.r + 1), AIR, `nothing under ${m.c},${m.r}`);
    assert.ok(m.r + 1 <= 29, 'not in the track bed');
  }
  for (const s of L.spawns) assert.ok(s.c < L.cols - 10, `spawn ${s.c} too near the door`);
});

test('pickups: the sniper high in the middle, a rifle on each side', () => {
  assert.deepEqual(L.pickups.map(({ n, gun, c, r }) => ({ n, gun, c, r })), [
    { n: 0, gun: 'sniper', c: 118, r: 3 },
    { n: 1, gun: 'rifle', c: 150, r: 15 },
    { n: 2, gun: 'rifle', c: 26, r: 18 },
  ]);
});
```

In `test/arena.test.js`:
- change the first test's regex to `/^[ ═▓SRN]*$/` and its title to `'… using only space, ═, ▓ and the S, R, N markers'`;
- import `parseLevel` from `../src/arena.js` as today, which proves the re-export;
- add the stickman level rules (stickman spec §2):

```js
test('headroom: the 3 cells above every standing spot are air (no ▓ and no ═); no standing spot in rows 0–2', () => {
  const L = parseLevel(text);
  const at = (c, r) => L.cells[r * L.cols + c];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    if (at(c, r) === AIR || (r > 0 && at(c, r - 1) !== AIR)) continue; // only tops of surfaces
    assert.ok(r >= 3, `standing spot at row ${r - 1}, col ${c}`);
    for (let k = 1; k <= 3; k++) assert.equal(at(c, r - k), AIR, `headroom at ${c},${r - k}`);
  }
});

test('the gap under any ▓ is 0 or at least 3 rows', () => {
  const L = parseLevel(text);
  const at = (c, r) => (r >= L.rows ? SOLID : L.cells[r * L.cols + c]);
  for (let c = 0; c < L.cols; c++) for (let r = 0; r < L.rows; r++) {
    if (at(c, r) !== SOLID || at(c, r + 1) === SOLID) continue;
    let gap = 0;
    while (r + 1 + gap < L.rows && at(c, r + 1 + gap) === AIR) gap++;
    if (r + 1 + gap >= L.rows) continue; // over the room's floor: the track bed is 4+ rows
    assert.ok(gap === 0 || gap >= 3, `a ${gap}-row slot under ▓ at ${c},${r}`);
  }
});
```

- Change the existing reachability test so a reach counts only when, among the take-off span's columns within 12 of the target span, at least one column has 9 rows clear of `▓` above the take-off surface. Add this to its `if`:

```js
const clear = (a, b) => {
  for (let c = Math.max(a.x0, b.x0 - 12); c <= Math.min(a.x1, b.x1 + 12); c++) {
    let ok = true;
    for (let k = 1; k <= 9 && ok; k++) ok = a.row - k < 0 || at(c, a.row - k) !== SOLID;
    if (ok) return true;
  }
  return false;
};
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/level.test.js test/arena.test.js < /dev/null`. Expected: FAIL, with "Cannot find module '../src/level.js'", then marker counts 0.

- [ ] **Step 3: Implement.** In `src/level.js`, move `parseLevel` out of arena.js and extend it:

```js
// The arena's level file: one kind per interior cell, top row first, plus spawn (S) and pickup (R rifle,
// N sniper) markers, which are air. Pure and import-free, so the Worker can bundle it.
export const AIR = 0, PLATFORM = 1, SOLID = 2;
export const LEVEL_COLS = 160, LEVEL_ROWS = 34;
export const PICKUP_GUN = { R: 'rifle', N: 'sniper' };

// Anything unexpected is air, so a typo can't wall you in.
export function parseLevel(text, cols = LEVEL_COLS, rows = LEVEL_ROWS) {
  const cells = new Uint8Array(cols * rows);
  const spawns = [], pickups = [];
  const lines = String(text).replace(/\r/g, '').split('\n');
  for (let r = 0; r < rows; r++) {
    const chars = [...(lines[r] || '')];
    for (let c = 0; c < cols; c++) {
      const ch = chars[c];
      cells[r * cols + c] = ch === '═' ? PLATFORM : ch === '▓' ? SOLID : AIR;
      const spot = { c, r, x: c + 0.5, y: r - 0.5 };
      if (ch === 'S') spawns.push(spot);
      else if (PICKUP_GUN[ch]) pickups.push({ n: pickups.length, gun: PICKUP_GUN[ch], ...spot });
    }
  }
  return { cols, rows, cells, spawns, pickups };
}

export const levelKind = (L) => (c, r) => (c < 0 || r < 0 || c >= L.cols || r >= L.rows ? SOLID : L.cells[r * L.cols + c]);

// Server and browser compare this, so neither fights on a level the other doesn't have.
export function levelHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text).replace(/\r/g, '')) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
```

  - In `src/arena.js`, replace lines 6–19 with `export { AIR, PLATFORM, SOLID, LEVEL_COLS, LEVEL_ROWS, parseLevel } from './level.js';` plus `import { AIR, PLATFORM, SOLID } from './level.js';` for its own use.
  - Write `src/stick.js` with a header comment ("The arena's stick figures: pose art and the gun constants the rules share. Pure: no DOM, no randomness.") and the constants above.
  - Place the markers in `src/arena.txt`, e.g. with a short Python one-off; don't commit the script.

- [ ] **Step 4: Run the tests and see them pass.**
  - Run: `node --test test/level.test.js test/arena.test.js < /dev/null`. Expected: PASS.
  - If a level rule fails on the current drawing (headroom, slot, 9-row clearance), fix the drawing in `arena.txt` by the smallest change: move a platform end by 1–2 columns or one row. Record each change as a ruling in your report.
  - Then run `npm test < /dev/null`. Expected: all pass, since light.test and world.test are unaffected by markers.

- [ ] **Step 5: Commit**: `Arena PvP: level markers (spawns, pickups), level.js with its hash, and the shared gun constants`.

---

### Task 2: Arena physics: the 3-row body, knockback and stun, the door while stunned, and rolls

**Files:**
- Modify: `src/arena.js` (`HW`/`HH`, `newBody`, `stepBody`; new `knock`, `startRoll`, `insideFor`, `BODY`, `ROLL`)
- Modify: `src/world.js` (`enterSide` puts you at `floorY − 1.5`; `stepSide` passes `inside`)
- Test: `test/arena.test.js`, `test/world.test.js`

**Interfaces:**
- Consumes: `src/level.js` kinds (Task 1).
- Produces (`src/arena.js`):
  - `BODY = { w: 0.8, h: 3 }` (with `HW = 0.4`, `HH = 1.5`).
  - `ROLL = { speed: 48, time: 0.3, cooldown: 0.5 }`.
  - `STUN_DECAY = 0.35`.
  - `newBody(x, y)` gains `stun: 0, rollT: -1, rollDir: 0, rollCool: 0`.
  - `knock(b, kx, ky, stun)`:
    - `b.vx = kx`;
    - if `ky`, then `b.vy = ky`, and if `ky < 0` then `b.onGround = false` (and `onPlatform = false`);
    - `b.stun = Math.max(b.stun, stun)`;
    - a knock ends a roll (`rollT = -1`).
  - `startRoll(b, dir)` → boolean. Only on the ground, not stunned, not rolling, and `rollCool <= 0`. It sets `rollT = 0`, `rollDir = dir`, `vx = dir × 48`.
  - `stepBody(b, dt, input, kindAt, { reducedMotion, inside })`:
    - `input.roll` (−1, 0 or 1) asks for a roll this step;
    - `inside(c, r)` → boolean. While `b.stun > 0`, a cell where `inside` returns false counts as SOLID: the door is a wall.
  - `insideFor(map)` → `(cx, cy) => boolean`, the arena's interior in map cells.
  - `rolling(b)` → `b.rollT >= 0`.
- Rules (PvP spec §2.4, §2.8; stickman spec §2):
  - **Stunned**:
    - input is ignored (as if `{}`);
    - `vx *= exp(−dt / 0.35)`, on the ground and in the air, the same with Reduce Motion;
    - gravity and collisions as usual;
    - `b.stun -= dt`.
  - **Rolling**:
    - `vx = rollDir × 48` every step; steering is ignored;
    - `rollT += dt`;
    - at `rollT ≥ 0.3` the roll ends (`rollT = -1`, `rollCool = 0.5`);
    - a jump (buffer/coyote as today) ends it the same way and keeps `vx`;
    - if after the move the body is not on the ground and didn't jump, the roll ends too (off a ledge), keeping `vx`.
  - `rollCool -= dt` each step, down to 0.
  - **Movement**: the sub-step move uses `HW 0.4`, `HH 1.5` everywhere.

- [ ] **Step 1: Update the existing physics tests for the 3-row body** in `test/arena.test.js`. The test room is unchanged; only the expected numbers change, because the feet are at `y + 1.5`:
  - 'falling lands on the floor': `assert.equal(b.y, 18.5)`.
  - 'a full jump…': start at `newBody(7.5, 18.5)` and assert `Math.abs(18.5 - top - 6) <= 0.5`.
  - 'letting go…': start at 18.5 and assert `18.5 - top < 4`.
  - '═ …': start `newBody(14.5, 18.5)`. Assert `b.y === 13.5` standing on the platform and `18.5` after dropping.
  - '▓ blocks…':
    - side stop: `b.x <= 30 - 0.4 + 1e-9 && b.x > 29`;
    - landing on top: `top` from `newBody(31.5, 5.5)` lands at `14.5`;
    - `under` from `newBody(3.5, 18.5)`: `assert.equal(high, 17.5, 'head stops under the ceiling')`. The head at `y − 1.5 = 16` meets the ▓ at row 15.
  - 'nothing tunnels': platform landing at `13.5`; start the sprint at 18.5.
  - 'coyote': start `newBody(17.5, 13.5)`.
  - 'jump buffer':
    - start `newBody(7.5, 8.5)`;
    - measure the rise against `18.5`.
  - 'a held jump…': start at 18.5 and expect `top === 18.5`.

- [ ] **Step 2: Add the new tests**:

```js
import { knock, startRoll, BODY, ROLL } from '../src/arena.js';

test('the body is 0.8 cells by 3 rows', () => assert.deepEqual(BODY, { w: 0.8, h: 3 }));

// The test room with a 3-row door in its east wall (col 40, rows 17–19) into a corridor to col 50.
const doorKind = (c, r) => {
  if (r >= 20 || c < 0 || c > 50 || r < 0) return SOLID;
  if (c >= 40) return r >= 17 ? AIR : SOLID;
  return AIR;
};
const inside = (c) => c < 40;
const simIn = (b, seconds, input, kinds = doorKind, opts = { inside }, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepBody(b, dt, typeof input === 'function' ? input(t) : input, kinds, opts);
};

test('the 3-row body walks through a 3-row door both ways', () => {
  const b = newBody(35.5, 18.5);
  simIn(b, 0.2, IDLE);
  simIn(b, 1, { ...IDLE, x: 1 });
  assert.ok(b.x > 45, `east through the door (${b.x})`);
  simIn(b, 1, { ...IDLE, x: -1 });
  assert.ok(b.x < 38, `back west (${b.x})`);
});

test('knock: sets the velocity, leaves the ground when ky is upward, and stuns; input is ignored and speed decays with a 0.35 s time constant', () => {
  const b = newBody(10.5, 18.5);
  sim(b, 0.2);
  knock(b, 20, -22, 0.4);
  assert.equal(b.onGround, false);
  stepBody(b, 1 / 60, { ...IDLE, x: -1, jump: true }, kindAt);
  assert.ok(Math.abs(b.vx - 20 * Math.exp(-1 / 60 / 0.35)) < 1e-9, `vx ${b.vx}`);
  for (let i = 1; i < 21; i++) stepBody(b, 1 / 60, { ...IDLE, x: -1 }, kindAt);
  assert.ok(Math.abs(b.vx - 20 * Math.exp(-21 / 60 / 0.35)) < 1e-6, 'still decaying after 0.35 s');
  const r = newBody(10.5, 18.5);
  sim(r, 0.2);
  knock(r, 20, 0, 0.2);
  stepBody(r, 1 / 60, IDLE, kindAt, { reducedMotion: true });
  assert.ok(Math.abs(r.vx - 20 * Math.exp(-1 / 60 / 0.35)) < 1e-9, 'Reduce Motion does not change the decay');
});

test('a bullet-style knock (ky 0) keeps a jump going', () => {
  const b = newBody(10.5, 18.5);
  sim(b, 0.2);
  sim(b, 0.1, { ...IDLE, jump: true });
  const vy = b.vy;
  knock(b, 10, 0, 0.1);
  assert.equal(b.vy, vy);
});

test('the door blocks a stunned body but not a walking one', () => {
  const b = newBody(35.5, 18.5);
  simIn(b, 0.2, IDLE);
  knock(b, 45, 0, 0.4);
  simIn(b, 0.4, IDLE);
  assert.ok(b.x <= 40 - 0.4 + 1e-9, `stopped at the door (${b.x})`);
});

test('a roll covers 14 ± 1 cells in 0.30 s the way it was asked, ignoring steering, then ends', () => {
  for (const dt of [1 / 20, 1 / 60, 1 / 144]) {
    const b = newBody(5.5, 18.5);
    sim(b, 0.2, IDLE, dt);
    const x0 = b.x;
    stepBody(b, dt, { ...IDLE, roll: 1 }, kindAt);
    sim(b, 0.3 - dt, { ...IDLE, x: -1 }, dt);
    assert.ok(Math.abs(b.x - x0 - 14.4) <= 1, `moved ${b.x - x0} at ${Math.round(1 / dt)} fps`);
    sim(b, 2 * dt, { ...IDLE, x: -1 }, dt);
    assert.equal(b.rollT, -1);
  }
});

test('no roll in the air, while stunned, or within 0.5 s of the last', () => {
  const air = newBody(5.5, 10.5);
  assert.equal(startRoll(air, 1), false);
  const st = newBody(5.5, 18.5);
  sim(st, 0.2);
  knock(st, 0, 0, 0.2);
  assert.equal(startRoll(st, 1), false);
  const b = newBody(5.5, 18.5);
  sim(b, 0.2);
  assert.equal(startRoll(b, 1), true);
  sim(b, 0.35);
  assert.equal(startRoll(b, -1), false, 'cooling down');
  sim(b, 0.5);
  assert.equal(startRoll(b, -1), true);
});

test('a jump during a roll ends it and keeps its speed (a long jump)', () => {
  const b = newBody(5.5, 18.5);
  sim(b, 0.2);
  stepBody(b, 1 / 60, { ...IDLE, roll: 1 }, kindAt);
  sim(b, 0.1);
  stepBody(b, 1 / 60, { ...IDLE, jump: true }, kindAt);
  assert.equal(b.rollT, -1);
  assert.equal(b.onGround, false);
  assert.ok(b.vx > 40, `kept its speed (${b.vx})`);
});

test('a roll off a ledge ends and falls, keeping its speed', () => {
  const b = newBody(17.5, 13.5); // on the platform at row 15, cols 10–19
  sim(b, 0.2);
  stepBody(b, 1 / 60, { ...IDLE, roll: 1 }, kindAt);
  sim(b, 0.1);
  assert.equal(b.rollT, -1);
  assert.equal(b.onGround, false);
  assert.ok(b.vx > 40);
});

test('a knock ends a roll', () => {
  const b = newBody(5.5, 18.5);
  sim(b, 0.2);
  startRoll(b, 1);
  knock(b, -10, 0, 0.1);
  assert.equal(b.rollT, -1);
});
```

In `test/world.test.js`:
- every `A.floorY - 0.5` becomes `A.floorY - 1.5` (entering, standing, the frozen test, teleports into the arena);
- add a test:

```js
test('stunned in the side view, the arena door is a wall', async () => {
  const { knock } = await import('../src/arena.js');
  const w = createWorld(amap);
  teleport(w, A.entry.x - 3.5, A.floorY - 1.5);
  for (let i = 0; i < 12; i++) step(w, 1 / 60, SIDE_IDLE);
  knock(w.player, 45, 0, 0.4);
  for (let i = 0; i < 30; i++) step(w, 1 / 60, SIDE_IDLE);
  assert.equal(w.want, null, 'not carried out of the door');
  assert.equal(w.mode, 'side');
});
```

- [ ] **Step 3: Run the tests and watch them fail.** Run: `node --test test/arena.test.js test/world.test.js < /dev/null`. Expected: FAIL. Bodies land at 19.5 rather than 18.5, and `knock`/`startRoll` are not exported.

- [ ] **Step 4: Implement in `src/arena.js`.**
  - `HW = 0.4, HH = 1.5`; export `BODY`, `ROLL`, `STUN_DECAY`.
  - Add the new fields in `newBody`.
  - In `stepBody`, before the jump logic:

```js
  const stunned = b.stun > 0;
  if (stunned) { b.stun = Math.max(0, b.stun - dt); input = NONE; } // knocked back: no control until it ends
  b.rollCool = Math.max(0, b.rollCool - dt);
  if (input.roll) startRoll(b, Math.sign(input.roll));
```

  (`const NONE = {}` at module level.)
  - After a jump fires: `if (b.rollT >= 0) { b.rollT = -1; b.rollCool = ROLL.cooldown; }` (vx untouched).
  - Horizontal:
    - if rolling, `b.vx = b.rollDir * ROLL.speed; b.rollT += dt;`;
    - else if stunned, `b.vx *= Math.exp(-dt / STUN_DECAY)`;
    - else the existing steering.
  - Pass a `solidAt` to `moveX`/`moveY` that wraps `kindAt`: `const kinds = stunned && inside ? (c, r) => (inside(c, r) ? kindAt(c, r) : SOLID) : kindAt;`.
  - After the sub-steps: `if (b.rollT >= 0 && (b.rollT >= ROLL.time || !b.onGround)) { b.rollT = -1; b.rollCool = ROLL.cooldown; }`.
  - `knock` and `startRoll` as described in Interfaces; `insideFor(map)` uses `map.arena`'s interior: `cx > a.x && cx < a.x + a.w - 1 && cy > a.y && cy < a.y + a.h - 1`.
  - In `src/world.js`:
    - `enterSide`: `p.y = a.floorY - 1.5`;
    - `createWorld`: add `inside: map.arena ? insideFor(map) : null`;
    - `stepSide`: pass `{ reducedMotion: world.reducedMotion, inside: world.inside }`.

- [ ] **Step 5: Run the tests and see them pass.** Run: `node --test test/arena.test.js test/world.test.js < /dev/null`, then `npm test < /dev/null`. Expected: all PASS. `light.test.js` doesn't use the body, so it is unaffected.

- [ ] **Step 6: Commit**: `Arena PvP: 3-row body, knockback and stun, the door as a wall while stunned, and rolls`.

---

### Task 3: `src/fight.js`: the numbers and geometry of the fight

**Files:**
- Create: `src/fight.js`, `test/fight.test.js`

**Interfaces:**
- Consumes:
  - from `src/level.js`: `SOLID`, `levelKind`, `parseLevel`, used in tests;
  - from `src/stick.js`: `SHOULDER`, `MUZZLE_R`.
- Produces (`src/fight.js`, pure; times in seconds; angles on screen):
  - **Constants**:
    - `MAX_HP = 100`, `FIGURE_ROWS = 3`, `HURT = { hw: 0.5, hh: 1.5 }`;
    - `REGEN_RATE = 20`, `REGEN_AFTER = 4`;
    - `SAFE_TIME = 1.5`, `RESPAWN_TIME = 2`, `FLEE_TIME = 3`;
    - `PICKUP_BACK = 10`, `PICKUP_REACH = { x: 1, y: 2 }`;
    - `COMBO_GAP = 0.5`, `DODGE = [0.04, 0.26]`;
    - `ACT_TIME = { shoot: 0.2, punch: 0.25, kick: 0.4, roll: 0.3 }`.
  - **`GUNS`**. Ammo `-1` means endless, everywhere: records and wire.

    ```js
    export const GUNS = {
      deagle: { code: 'd', damage: 25, cooldown: 0.4, speed: 80, flight: 0.8, max: 2, ammo: -1, kb: 10, stun: 0.1 },
      rifle: { code: 'r', damage: 9, cooldown: 0.1, speed: 90, flight: 0.7, max: 7, ammo: 40, kb: 3, stun: 0.05 },
      sniper: { code: 'n', damage: 70, cooldown: 1.2, speed: 220, flight: 0.75, max: 1, ammo: 5, kb: 30, stun: 0.3 },
    };
    export const GUN_BY_CODE = { d: 'deagle', r: 'rifle', n: 'sniper' };
    export const STRIKES = {
      punch: { code: 'p', damage: 14, reach: 1.8, kx: 25, ky: 10, stun: 0.2, cooldown: 0.3 },
      kick: { code: 'k', damage: 22, reach: 2.2, kx: 45, ky: 22, stun: 0.4, cooldown: 0.55 },
    };
    ```

  - `stunOf(w)` → seconds, for a weapon code `d r n p k`.
  - **Aim**:
    - `keyAim(up, down)` → `-π/4` with only up, `π/4` with only down, otherwise `0`.
    - `pointAim(sx, sy, px, py, facing)` → `{ facing, aim }`, from shoulder `(sx, sy)` to point `(px, py)`:
      - `dx = px − sx`, `dy = (py − sy) × 2`;
      - `facing = dx < 0 ? -1 : dx > 0 ? 1 : facing`;
      - `aim = atan2(dy, |dx|)`, clamped to ±π/2.
    - `absAngle(facing, aim)` → `facing > 0 ? aim : (aim >= 0 ? π − aim : −π − aim)`.
    - `along(angle, r)` → `{ dx: r cos angle, dy: r sin angle / 2 }`.
    - `shoulderOf(x, y, facing)` → `{ x: x + SHOULDER.dx × facing, y: y + SHOULDER.dy }`.
    - `muzzleOf(x, y, facing, aim, gun)` → `shoulderOf + along(absAngle(facing, aim), MUZZLE_R[gun])`.
  - **Bullets**:
    - `rayLength(kindAt, x, y, angle, max)` → the screen-unit distance from `(x, y)` along `angle` to the first cell where `kindAt` is SOLID, or `max`. PLATFORM is passed through. Grid walk (Amanatides–Woo) over cells, in cell/row space, with direction `(cos, sin / 2)`.
    - `bulletRange(gun)` → `GUNS[gun].speed × GUNS[gun].flight`.
    - `bulletAt(b, t)` → `{ x, y }` for a bullet `{ x, y, angle, gun, t0 }` at time `t`.
    - `sweep(p0, p1, c0, c1, hw = 0.5, hh = 1.5)` → the first `s` in [0, 1] where the bullet segment `p0→p1` meets the box centred on `c0→c1` (relative motion, slab method), or `-1`. If it starts inside, 0.
  - **Health**:
    - `regenHp(hp, hurtAt, now)` → `min(MAX_HP, hp + max(0, now − hurtAt − REGEN_AFTER) × REGEN_RATE)`.
    - `fleeKiller(f, now)` → `f.hitBy` if `f.hitBy && now − f.hurtAt <= FLEE_TIME`, else `null`.
  - **Strikes**:
    - `nextStrike(f, now, inAir)` → `{ kind, combo }`:
      - `combo = f.combo > 0 && f.combo < 3 && now − f.strikeAt <= COMBO_GAP ? f.combo + 1 : 1`;
      - `kind = inAir || combo === 3 ? 'kick' : 'punch'`;
      - the caller stores `f.combo = kind === 'kick' ? 3 : combo`, since a kick ends the combo.
    - `strikeReady(f, now)` → `now − f.strikeAt >= STRIKES[f.lastStrike || 'punch'].cooldown`, or true if there is no previous strike.
    - `strikeBox(x, y, facing, kind)` → `{ x0, x1, y0, y1 }`:
      - across: from the front edge `x + 0.4 × facing` to `x + (0.4 + reach) × facing`, ordered so that `x0 < x1`;
      - punch: `y − 1.05 .. y + 1.05` (the middle 70%);
      - kick: `y − 1.5 .. y + 2.5`.
    - `boxHits(box, x, y)` → whether it overlaps the hurtbox centred on `(x, y)`.
    - `strikeKnock(kind, facing)` → `{ kx: facing × kx, ky: −ky }`.
  - **Bullet knockback and dodging**:
    - `bulletKnock(gun, angle)` → `{ kx: kb cos angle, ky: kb sin angle / 2 }`.
    - `inDodge(rollAt, now)` → whether `rollAt != null` and `now − rollAt` is within `[0.04, 0.26]`.
  - **Spawns and pickups**:
    - `pickSpawn(spawns, others, rand)` → an index:
      - each spawn's score is its smallest distance to an `other` `{ x, y }`, measured on screen as `hypot(dx, 2dy)`;
      - the highest score wins; ties within 1e-6 are broken by `rand()`;
      - with no others, `floor(rand() × n)`.
    - `nearPickup(x, y, p)` → `|x − p.x| <= 1 && |y − p.y| <= 2`.
  - **Glyphs**:
    - `dirGlyph(angle)`:
      - `'-'` within 22.5° of horizontal, either way;
      - `'|'` beyond 67.5° from horizontal;
      - otherwise the diagonal: down-right or up-left is `'\\'`, up-right or down-left is `'/'`.
    - `bulletGlyphs(gun, angle, out = [])` → glyphs `{ du, ch, a }`, where `du` is the distance in screen units behind the head (0 = head):
      - deagle `[{du: 0, ch: '•', a: 1}, {du: 1, ch: dirGlyph, a: 0.5}]`;
      - rifle `[{du: 0, ch: dirGlyph, a: 1}]`;
      - sniper: 4 × dirGlyph at `du` 0..3, `a` 1, 0.75, 0.5, 0.25.

- [ ] **Step 1: Write the failing tests**:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLID, PLATFORM, AIR } from '../src/level.js';
import * as F from '../src/fight.js';

const close = (a, b, e = 1e-9, msg) => assert.ok(Math.abs(a - b) <= e, msg || `${a} ≠ ${b}`);

test('the numbers: guns, strikes, health', () => {
  assert.equal(F.MAX_HP, 100);
  assert.equal(F.FIGURE_ROWS, 3);
  assert.deepEqual([F.GUNS.deagle.damage, F.GUNS.rifle.damage, F.GUNS.sniper.damage], [25, 9, 70]);
  assert.deepEqual([F.GUNS.deagle.cooldown, F.GUNS.rifle.cooldown, F.GUNS.sniper.cooldown], [0.4, 0.1, 1.2]);
  assert.deepEqual([F.GUNS.deagle.max, F.GUNS.rifle.max, F.GUNS.sniper.max], [2, 7, 1]);
  assert.deepEqual([F.GUNS.deagle.ammo, F.GUNS.rifle.ammo, F.GUNS.sniper.ammo], [-1, 40, 5]);
  close(F.bulletRange('deagle'), 64);
  assert.ok(F.bulletRange('sniper') >= 160);
  assert.deepEqual([F.STRIKES.punch.damage, F.STRIKES.kick.damage], [14, 22]);
  assert.deepEqual(['d', 'r', 'n', 'p', 'k'].map(F.stunOf), [0.1, 0.05, 0.3, 0.2, 0.4]);
});

test('aim: 0 and ±π/4 from keys; the mouse aims at any angle, clamped, flipping facing toward the cursor', () => {
  assert.equal(F.keyAim(false, false), 0);
  close(F.keyAim(true, false), -Math.PI / 4);
  close(F.keyAim(false, true), Math.PI / 4);
  assert.equal(F.keyAim(true, true), 0);
  const ahead = F.pointAim(10, 10, 20, 10, 1);
  assert.deepEqual(ahead, { facing: 1, aim: 0 });
  const behindUp = F.pointAim(10, 10, 5, 7.5, 1); // 5 cells left, 2.5 rows up = 5 screen units up
  assert.equal(behindUp.facing, -1);
  close(behindUp.aim, -Math.PI / 4);
  const above = F.pointAim(10, 10, 10, 0, -1);
  assert.equal(above.facing, -1);
  close(above.aim, -Math.PI / 2);
  close(F.absAngle(1, 0.3), 0.3);
  close(F.absAngle(-1, 0), Math.PI);
  close(F.absAngle(-1, -Math.PI / 4), -3 * Math.PI / 4);
  close(F.absAngle(-1, Math.PI / 4), 3 * Math.PI / 4);
});

test('the muzzle is MUZZLE_R along the aim from the shoulder', () => {
  const m = F.muzzleOf(10, 20, 1, 0, 'deagle');
  close(m.x, 10 + 0.15 + 2.8);
  close(m.y, 20 - 0.3);
  const up = F.muzzleOf(10, 20, -1, -Math.PI / 2, 'sniper');
  close(up.x, 10 - 0.15, 1e-9);
  close(up.y, 20 - 0.3 - 6.8 / 2);
});

// A room the size of the arena: a ▓ column at x 50 (rows 10–20), a ═ row at 25, solid outside.
const kindAt = (c, r) => (c < 0 || r < 0 || c >= 160 || r >= 34 ? SOLID : c === 50 && r >= 10 && r <= 20 ? SOLID : r === 25 ? PLATFORM : AIR);

test('the ray cast stops at ▓, walls, floor and ceiling, passes through ═, and ends at max', () => {
  close(F.rayLength(kindAt, 10.5, 15.5, 0, 1000), 39.5);
  close(F.rayLength(kindAt, 10.5, 20.5, Math.PI / 2, 1000), (34 - 20.5) * 2, 1e-9, 'through ═ to the floor');
  close(F.rayLength(kindAt, 10.5, 20.5, -Math.PI / 2, 1000), 20.5 * 2, 1e-9, 'ceiling');
  close(F.rayLength(kindAt, 100.5, 5.5, 0, 1000), 59.5, 1e-9, 'the east wall and its door');
  close(F.rayLength(kindAt, 60.5, 5.5, 0, 64), 64, 1e-9, 'range');
  const diag = F.rayLength(kindAt, 30.5, 15.5, Math.atan2(2 * 0, 1), 1000);
  close(diag, 19.5);
});

test('the relative sweep never misses a target the bullet crosses, at any angle, against a target sprinting or falling at full speed, with 33 ms ticks', () => {
  const tick = 0.033;
  for (const gun of ['deagle', 'rifle', 'sniper']) {
    const speed = F.GUNS[gun].speed;
    for (let k = 0; k < 32; k++) {
      const angle = -Math.PI + (k + 0.5) * (2 * Math.PI / 32);
      for (const tv of [[0, 0], [45, 0], [-45, 0], [0, 60], [0, -40], [45, 60]]) {
        const meet = 0.2; // the bullet passes through the target's centre at 0.2 s
        const c = (t) => ({ x: 80 + tv[0] * t, y: 17 + tv[1] * t });
        const d = F.along(angle, speed * meet);
        const b = { x: c(meet).x - d.dx, y: c(meet).y - d.dy, angle, gun, t0: 0 };
        let hit = -1;
        for (let t = 0; t < meet + tick && hit < 0; t += tick) {
          const s = F.sweep(F.bulletAt(b, t), F.bulletAt(b, t + tick), c(t), c(t + tick));
          if (s >= 0) hit = t + s * tick;
        }
        assert.ok(hit >= 0 && hit <= meet + 1e-9, `${gun} at ${(angle * 180 / Math.PI).toFixed(0)}° vs ${tv}: ${hit}`);
      }
    }
  }
});

test('sweep: a miss is −1; starting inside is 0', () => {
  assert.equal(F.sweep({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }), -1);
  assert.equal(F.sweep({ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }), 0);
  close(F.sweep({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }), 0.45);
});

test('regeneration starts 4 s after damage, at 20 hp/s, and stops at 100', () => {
  assert.equal(F.regenHp(40, 10, 13.9), 40);
  close(F.regenHp(40, 10, 15), 60);
  assert.equal(F.regenHp(40, 10, 20), 100);
});

test('the flee rule credits a hit 2.9 s earlier, not one 3.1 s earlier', () => {
  assert.equal(F.fleeKiller({ hitBy: 'ann', hurtAt: 10 }, 12.9), 'ann');
  assert.equal(F.fleeKiller({ hitBy: 'ann', hurtAt: 10 }, 13.1), null);
  assert.equal(F.fleeKiller({ hitBy: null, hurtAt: 10 }, 10.5), null);
});

test('combo: punch, punch, kick within 0.5 s; a kick in the air; a pause resets it; a kick ends it', () => {
  const f = { combo: 0, strikeAt: -Infinity };
  const hit = (now, air = false) => { const s = F.nextStrike(f, now, air); f.combo = s.kind === 'kick' ? 3 : s.combo; f.strikeAt = now; return s.kind; };
  assert.deepEqual([hit(1), hit(1.4), hit(1.8), hit(2.2)], ['punch', 'punch', 'kick', 'punch']);
  assert.equal(hit(3), 'punch');
  assert.equal(hit(4), 'punch', 'a pause resets');
  assert.equal(hit(4.3, true), 'kick', 'in the air');
  assert.equal(hit(4.6), 'punch', 'the kick ended the combo');
});

test('strike reach and bands', () => {
  const p = F.strikeBox(10, 20, 1, 'punch');
  assert.equal(F.boxHits(p, 12.6, 20), true, 'front edge 0.4 + reach 1.8 + half hurtbox 0.5');
  assert.equal(F.boxHits(p, 12.8, 20), false);
  assert.equal(F.boxHits(p, 7.4, 20), false, 'behind');
  assert.equal(F.boxHits(p, 11, 22.6), false, 'below the middle 70%');
  const k = F.strikeBox(10, 20, -1, 'kick');
  assert.equal(F.boxHits(k, 7, 20), true);
  assert.equal(F.boxHits(k, 7, 23.9), true, 'a row below the feet');
  assert.deepEqual(F.strikeKnock('kick', -1), { kx: -45, ky: -22 });
  const b = F.bulletKnock('sniper', Math.PI);
  close(b.kx, -30);
  close(b.ky, 0, 1e-9);
});

test('the dodge window is 0.04–0.26 s into a roll', () => {
  assert.equal(F.inDodge(10, 10.03), false);
  assert.equal(F.inDodge(10, 10.04), true);
  assert.equal(F.inDodge(10, 10.26), true);
  assert.equal(F.inDodge(10, 10.27), false);
  assert.equal(F.inDodge(null, 10), false);
});

test('spawn choice picks the spawn farthest from everyone alive', () => {
  const spawns = [{ x: 10, y: 27.5 }, { x: 100, y: 27.5 }, { x: 50, y: 2.5 }];
  assert.equal(F.pickSpawn(spawns, [{ x: 12, y: 27.5 }], () => 0), 1);
  assert.equal(F.pickSpawn(spawns, [{ x: 100, y: 27.5 }, { x: 10, y: 27.5 }], () => 0), 2);
  assert.equal(F.pickSpawn(spawns, [], () => 0.7), 2);
});

test('bullet glyphs follow the direction', () => {
  assert.equal(F.dirGlyph(0), '-');
  assert.equal(F.dirGlyph(Math.PI), '-');
  assert.equal(F.dirGlyph(Math.PI / 6), '-');
  assert.equal(F.dirGlyph(Math.PI / 4), '\\');
  assert.equal(F.dirGlyph(-Math.PI / 4), '/');
  assert.equal(F.dirGlyph(3 * Math.PI / 4), '/');
  assert.equal(F.dirGlyph(-3 * Math.PI / 4), '\\');
  assert.equal(F.dirGlyph(Math.PI / 2), '|');
  assert.deepEqual(F.bulletGlyphs('deagle', 0).map((g) => g.ch), ['•', '-']);
  assert.equal(F.bulletGlyphs('rifle', 0).length, 1);
  assert.deepEqual(F.bulletGlyphs('sniper', Math.PI / 2).map((g) => [g.du, g.ch, g.a]), [[0, '|', 1], [1, '|', 0.75], [2, '|', 0.5], [3, '|', 0.25]]);
});

test('pickup reach is 1 cell across and 2 rows', () => {
  assert.equal(F.nearPickup(10.9, 12, { x: 10, y: 10 }), true);
  assert.equal(F.nearPickup(11.1, 10, { x: 10, y: 10 }), false);
  assert.equal(F.nearPickup(10, 12.1, { x: 10, y: 10 }), false);
});

test('fight.js uses no randomness or browser APIs of its own', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/fight.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random|window|document|performance/);
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/fight.test.js < /dev/null`. Expected: FAIL, "Cannot find module '../src/fight.js'".

- [ ] **Step 3: Implement `src/fight.js`.**
  - The trickier pieces:
    - **Grid walk**: start at `cx = floor(x), cy = floor(y)`, with `dx = cos a`, `dy = sin a / 2`; `tMaxX = dx > 0 ? (cx + 1 − x) / dx : dx < 0 ? (x − cx) / −dx : Infinity`, and the same for y; `tDelta = 1 / |d|`. Loop: if `kindAt(cx, cy) === SOLID`, return the current entry `t` (0 if the start cell is solid). Otherwise step the smaller `tMax`. Stop when `t > max`. `t` is in screen units, because `(dx, dy)` is unit length on screen.
    - **`sweep`**:
      - `r0 = p0 − c0`, `r1 = p1 − c1`, `d = r1 − r0`;
      - for each axis with half-size `h`: if `d === 0` and `|r0| > h`, it misses; otherwise `t1 = (−h − r0) / d`, `t2 = (h − r0) / d`, `enter = max(enter, min(t1, t2))`, `exit = min(exit, max(t1, t2))`;
      - it hits when `enter <= exit && exit >= 0 && enter <= 1`, returning `max(0, enter)`.
  - Every other function is a few lines, as given in Interfaces.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/fight.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: fight.js, the shared numbers and geometry (guns, strikes, aim, ray cast, sweep)`.

---

### Task 4: `src/stick.js`: the stickman's locomotion, shooting and guns

**Files:**
- Modify: `src/stick.js` (Task 1 created it with the constants)
- Create: `test/stick.test.js`

**Interfaces:**
- Consumes: `SHOULDER`, `HAND_R`, `MUZZLE_R` and `GUN_ART`, from this same file.
- Produces:
  - `stickPose(state, t, opts = {}, out = [])` → `out`, with glyphs `{ dx, dy, ch, part, tone, a }` appended. Read the stickman spec §3–§4 for what each field means.
  - `MIRROR = { '/': '\\', '\\': '/', '<': '>', '>': '<', '(': ')', ')': '(' }`.
- `state` fields: `{ x, y, vx, vy, facing, ground, aim, act, actT, gun, aimed, safe, landT, spawnT }`.
  - **New field, `aimed`** (a ruling, since the specs don't name it):
    - it is true when mouse aim is on, or ↑/↓ is held;
    - the gun is **carried** at the hip when `act !== 'shoot' && !aimed && aim === 0`, and aimed otherwise.
- `opts`: `{ reducedMotion, phase }`.
- **This task covers**:
  - defaults;
  - choosing the locomotion pose: idle with breath, run (4 frames by distance, lean, bob, running backwards), rise/apex/fall, land squash;
  - the shoot overlay at any angle with recoil and flash;
  - the three guns along the aim ray, with the >35° rule;
  - the carried gun;
  - mirroring.
- **Task 7 adds**:
  - punch, kick, hurt, dead, respawn, roll, `safe`;
  - Reduce Motion for those;
  - `createMotionMemory`.
- Until Task 7, an act this task doesn't know is drawn as idle.

**Rules:**
- Transcribe stickman spec §3 "Composition", "Choosing the locomotion pose", and §4 "Idle", "Run", "Jump", "Land", "Shoot (any angle)", "Guns" exactly. The tables there are the source of truth for every `(dx, dy, ch)`.
  - Locomotion parts: `head`, `torso`, `armB`, `armF`, `legB`, `legF`.
  - The gun glyphs have part `gun`; the muzzle flash has part `fx` and tone `fx`. All other glyphs have tone `body` and `a: 1`.
- **Shoot geometry** (on screen):
  - the arm glyph sits at `S + 0.7` along the aim;
  - the gun hand at `S + HAND_R`;
  - gun glyph `i` at `S + HAND_R + (i − hand)` along the aim;
  - the flash `*` at `S + MUZZLE_R[gun]`, while `actT < 0.06`;
  - "along the aim" means `dx = r cos(aim) × facing`, `dy = r sin(aim) / 2`, relative to the shoulder `(SHOULDER.dx × facing, SHOULDER.dy)`.
- **Recoil**: arm, gun and flash move 0.3 back along the aim. Fully at `actT < 0.04`, easing linearly to 0 by 0.15. With Reduce Motion: fully for `actT < 0.08`, then 0. The head moves back 0.1 at the same time.
- **Carried**:
  - the hand at `(0.45, 0.3)` from the centre, mirrored by facing;
  - the gun glyphs level from it, at `+1` per glyph in the facing direction, with the `hand` glyph at the hand;
  - the arm glyph `-` halfway between the shoulder and the hand.
- **Mirroring**: a body facing left is the facing-right pose with every `dx` negated and characters swapped through `MIRROR`.
- **Allocation**: `out` is appended to. Don't allocate per glyph beyond the objects pushed into `out`.

- [ ] **Step 1: Write the failing tests** (`test/stick.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stickPose, MIRROR, SHOULDER, MUZZLE_R, GUN_ART, HAND_R } from '../src/stick.js';

const base = { x: 10, y: 20, vx: 0, vy: 0, facing: 1, ground: true, aim: 0, act: 'idle', actT: 0, gun: 'deagle', landT: Infinity, spawnT: Infinity };
const pose = (s, t = 0, opts = {}) => stickPose({ ...base, ...s }, t, opts);
const part = (g, p) => g.filter((x) => x.part === p);
const head = (g) => part(g, 'head')[0];
const ASCII = /^[\x20-\x7e═╦╤°]$/;

test('shape: every pose has a head and a torso, stays in its box, and uses printable ASCII plus ═ ╦ ╤ °', () => {
  const states = [{}, { vx: 30, x: 13 }, { vx: 30, x: 16 }, { ground: false, vy: -20 }, { ground: false, vy: 0 }, { ground: false, vy: 20 }, { landT: 0.05 },
    { act: 'shoot', aim: -Math.PI / 2 }, { act: 'shoot', aim: Math.PI / 2, gun: 'sniper' }, { gun: 'rifle' }, { aimed: true, aim: -0.6, gun: 'sniper' }];
  for (const s of states) {
    const g = pose(s);
    assert.ok(head(g) && part(g, 'torso').length, JSON.stringify(s));
    for (const x of g.filter((x) => x.part !== 'gun' && x.part !== 'fx')) {
      assert.ok(Math.abs(x.dx) <= 2.5 && x.dy >= -1.6 && x.dy <= 1.2, `${x.part} ${x.ch} at ${x.dx},${x.dy} in ${JSON.stringify(s)}`);
    }
    for (const x of g) assert.match(x.ch, ASCII);
  }
});

test('purity: same input, same output; state untouched; no Math.random', () => {
  const s = { ...base, vx: 30, x: 14.2, act: 'shoot', actT: 0.02, aim: 0.4 };
  const copy = structuredClone(s);
  assert.deepEqual(stickPose(s, 1.23, { phase: 0.3 }), stickPose(s, 1.23, { phase: 0.3 }));
  assert.deepEqual(s, copy);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/stick.js', import.meta.url), 'utf8'), /Math\.random/);
});

test('mirroring: facing left is facing right with dx negated and characters swapped', () => {
  for (const s of [{}, { vx: 30, x: 14 }, { act: 'shoot', aim: -0.5, gun: 'rifle' }, { ground: false, vy: -20 }]) {
    const r = pose({ ...s, facing: 1 }, 0.7), l = pose({ ...s, facing: -1, vx: -(s.vx || 0), x: s.x ? 2 * 10 - s.x : 10 }, 0.7);
    assert.deepEqual(l.map((g) => [g.part, +(-g.dx).toFixed(9), +g.dy.toFixed(9), MIRROR[g.ch] || g.ch]), r.map((g) => [g.part, +g.dx.toFixed(9), +g.dy.toFixed(9), g.ch]));
  }
});

test('idle breathes by at most 0.06 row; with Reduce Motion it is still', () => {
  const ys = [0, 0.6, 1.2, 1.8].map((t) => head(pose({}, t)).dy);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 0.06 + 1e-9 && Math.max(...ys) - Math.min(...ys) > 0.03);
  assert.deepEqual([0, 0.6, 1.2].map((t) => head(pose({}, t, { reducedMotion: true })).dy), [-1, -1, -1]);
});

test('run: the frame depends only on x (+3 cells the next frame, +12 back to the start); slow is idle', () => {
  const frame = (x) => part(pose({ vx: 30, x }), 'legF')[0].ch + (part(pose({ vx: 30, x }), 'armF')[0]?.ch || '');
  assert.equal(frame(13), frame(13));
  assert.notEqual(frame(13), frame(16));
  assert.equal(frame(13), frame(25));
  assert.deepEqual(pose({ vx: 1, x: 13 }).map((g) => g.ch), pose({}).map((g) => g.ch));
});

test('running backwards: no lean, and the frames play in reverse', () => {
  const fwd = pose({ vx: 30, x: 13 }), back = pose({ vx: -30, x: 13 });
  assert.ok(part(fwd, 'torso')[0].dx > 0.1);
  assert.equal(part(back, 'torso')[0].dx, 0);
  assert.equal(part(back, 'torso')[0].ch, '|');
});

test('air: rise, apex and fall poses', () => {
  const armB = (vy) => part(pose({ ground: false, vy }), 'armB')[0].ch;
  assert.deepEqual([armB(-20), armB(0), armB(20)], ['\\', '-', '\\']);
  assert.equal(part(pose({ ground: false, vy: -20 }), 'legF')[0].ch, '>');
  assert.equal(part(pose({ ground: false, vy: 20 }), 'legF')[0].ch, '\\');
});

test('land: the head is lower at landT 0.05; at 0.2 it is idle', () => {
  assert.ok(head(pose({ landT: 0.05 })).dy > head(pose({})).dy);
  assert.deepEqual(pose({ landT: 0.2 }), pose({}));
});

const ray = (s, g) => Math.atan2(2 * (g.dy - SHOULDER.dy), (g.dx - SHOULDER.dx * s.facing) * s.facing);

test('shoot: the gun lies on the ray from the shoulder at the aim, for 16 aims, apart from recoil', () => {
  for (let k = 0; k < 16; k++) {
    const aim = -Math.PI / 2 + (k + 0.5) * (Math.PI / 16);
    for (const facing of [1, -1]) {
      const s = { act: 'shoot', actT: 0.2, aim, facing };
      for (const g of part(pose(s), 'gun')) assert.ok(Math.abs(ray({ facing }, g) - aim) < 1e-6, `aim ${aim} glyph ${g.ch}`);
    }
  }
});

test('shoot: the arm glyph by angle', () => {
  const arm = (aim) => part(pose({ act: 'shoot', actT: 0.2, aim }), 'armF')[0].ch;
  assert.equal(arm(0), '-');
  assert.equal(arm(-Math.PI / 4), '/');
  assert.equal(arm(Math.PI / 4), '\\');
  assert.equal(arm(-Math.PI / 2), '|');
});

test('shoot: the flash only for actT < 0.06, at the gun muzzle; recoil at 0.02 and not at 0.2', () => {
  for (const gun of ['deagle', 'rifle', 'sniper']) {
    const flash = part(pose({ act: 'shoot', actT: 0.05, gun }), 'fx')[0];
    assert.equal(flash.ch, '*');
    assert.equal(flash.tone, 'fx');
    assert.ok(Math.abs(flash.dx - (SHOULDER.dx + MUZZLE_R[gun] - 0.3 * Math.max(0, 1 - (0.05 - 0.04) / 0.11))) < 1e-6);
    assert.equal(part(pose({ act: 'shoot', actT: 0.07, gun }), 'fx').length, 0);
  }
  const g0 = part(pose({ act: 'shoot', actT: 0.02 }), 'gun')[0].dx, g1 = part(pose({ act: 'shoot', actT: 0.2 }), 'gun')[0].dx;
  assert.ok(g0 < g1 - 0.25, 'recoil');
});

test('guns: each has its GUN_ART length along the ray; beyond 35° the glyphs become the arm glyph, but the sniper keeps °', () => {
  for (const gun of ['deagle', 'rifle', 'sniper']) {
    const g = part(pose({ act: 'shoot', actT: 0.2, gun }), 'gun');
    assert.equal(g.map((x) => x.ch).join(''), GUN_ART[gun].glyphs);
    const up = part(pose({ act: 'shoot', actT: 0.2, gun, aim: -Math.PI / 3 }), 'gun').map((x) => x.ch).join('');
    assert.equal(up, gun === 'sniper' ? '///°///' : '/'.repeat(GUN_ART[gun].glyphs.length));
  }
});

test('carried: idle, aim 0 and not aimed puts the gun level at the hip, pointing forward', () => {
  const g = part(pose({ gun: 'rifle' }), 'gun');
  assert.equal(g.map((x) => x.ch).join(''), '═╦╤══');
  assert.ok(g.every((x) => Math.abs(x.dy - 0.3) < 0.13), 'at the hip (breathing aside)');
  const hand = g[GUN_ART.rifle.hand];
  assert.ok(Math.abs(hand.dx - 0.45) < 1e-9);
  assert.ok(part(pose({ gun: 'rifle', aimed: true }), 'gun')[0].dy < 0, 'aimed: on the ray from the shoulder');
});

test('defaults: {x, y} alone is idle facing right; an unknown act is idle; bad numbers are clamped or zeroed', () => {
  const idle = pose({});
  assert.deepEqual(stickPose({ x: 10, y: 20 }, 0).map((g) => g.ch), idle.map((g) => g.ch));
  assert.deepEqual(pose({ act: 'dance' }), idle);
  assert.deepEqual(pose({ act: 'shoot', actT: -3, aim: 9 }), pose({ act: 'shoot', actT: 0, aim: Math.PI / 2 }));
});
```

  The sniper aimed up is `═╦═°═══` with every glyph except `°` turned into `/`: `'///°///'`.

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/stick.test.js < /dev/null`. Expected: FAIL, "stickPose is not a function".

- [ ] **Step 3: Implement.**
  - Keep the art as data tables at the top of the file: one object per pose, `{ head: [ch, dx, dy], … }`, copied from the spec's tables. The run frames R1–R4 and rise/apex/fall come from the spec verbatim.
  - Build the pose in the right-facing frame, then mirror while pushing into `out` (`dx × facing`, `MIRROR[ch] || ch`).
  - Breathing:
    - offset is `0.06 × (1 − cos 2π(t/2.4 + phase)) / 2`;
    - it applies upward (negative `dy`) to head, arms, torso and gun;
    - off with Reduce Motion.
  - Run bob is `0.12 × sin(π × frac(phase × 2))`, upward on every glyph; off with Reduce Motion.
  - Gun glyph rule: beyond 35°, every glyph except `°` becomes the arm glyph for the angle (`/`, `\` or `|`, before mirroring).

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/stick.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: stickman poses: idle, run, jump, land, shoot at any angle, and the three guns`.

---

### Task 5: The client connection: the arena ticker, arena messages, the `fight` check, no `p` inside, and colours that skip amber

**Files:**
- Modify: `src/live.js`, `src/peers.js` (and `src/net.js` only if needed)
- Test: `test/live.test.js`, `test/peers.test.js`

**Interfaces:**
- Consumes: `levelHash` (Task 1). The caller passes the hash in; live.js doesn't import the level.
- Produces (`src/live.js`):
  - `peerColor(id)`: hue `= (60 + h % 320) % 360`, so it never falls in 20°–60°.
  - `heartEntities`: at the backdrop, the heart rises from `p.y − 2.2` (stickman spec §5).
  - `arenaTicker(send, { every = 67, gap = 30, cap = 20 } = {})` → `tick(snap, nowMs, urgent = false)`:
    - `snap = { x, y, vx, vy, f, g, i, a, ts }` in arena-local cells; `x, y, a` are rounded to 2 decimals, `vx, vy` to 1;
    - **regular send** (`{ t: 'a', ...snap }`): at most every `every` ms, when anything changed since the last send. An `a` change counts only above 0.05 rad.
    - **urgent send**: when `urgent` is true, or `i`, `g` or `f` changed. It goes out if ≥ `gap` ms have passed since the last send; otherwise it waits for the first call at or after the `gap` mark.
    - **cap**: never more than `cap` sends in any rolling 1000 ms. Beyond the cap, even urgent sends wait.
    - a send that returns false is retried on the next call;
    - standing still sends nothing.
  - `createLive` gains these options:
    - `fightHash` (string);
    - `onArena(m)`: called for the server's arena messages, whose types are `aw aj ax a s pk w mm h k sp`;
    - `inArena()` → boolean: while it's true, no `p` goes out.
  - The object returned by `createLive` gains:
    - `fightOk`: `true` when the last welcome's `fight` equals `fightHash`; otherwise false, with a single `console.warn('arena: server level differs; no fighting')`;
    - `send(m)`: a raw `net.send`;
    - `leftArena()`: forgets the last sent position, so the next `tick` sends `p` at once;
    - `rtt`: `net.ping`.
  - `positionTicker` gains a `reset()` method (the returned function has a `.reset` property).
- Produces (`src/peers.js`): every `list(now)` entry gains `vx, vy, ground, facing`, derived from the track (stickman spec §6):
  - `vx, vy` from the samples at `now − delay` and `now − delay − 50` (per second);
  - `ground` when `y` is the same in the samples at `now − delay` and `now − delay − 120`;
  - `facing` is the sign of the last non-zero `vx` (stored per peer, starting at 1).

- [ ] **Step 1: Write the failing tests** (add to `test/live.test.js`):

```js
import { arenaTicker } from '../src/live.js';

const snap = (o = {}) => ({ x: 10, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0, ...o });

test('peerColor never returns a hue in the amber band (20°–60°)', () => {
  const hue = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (let i = 0; i < 2000; i++) { const h = hue(peerColor(`id${i}x${i * 7}`)); assert.ok(h < 20 - 1 || h > 60 + 1, `hue ${h}`); }
});

test('the arena ticker: at most 15 a second while moving, nothing while still', () => {
  const out = [];
  const tick = arenaTicker((m) => { out.push(m); return true; });
  for (let t = 0; t <= 1000; t += 1000 / 60) tick(snap({ x: 10 + t / 100, vx: 10, ts: Math.round(t) }), t);
  assert.ok(out.length >= 14 && out.length <= 16, `${out.length}`);
  out.length = 0;
  for (let t = 1000; t <= 2000; t += 1000 / 60) tick(snap({ x: 20, ts: Math.round(t) }), t);
  assert.ok(out.length <= 1, 'one last send when stopping at most');
  out.length = 0;
  for (let t = 2000; t <= 3000; t += 1000 / 60) tick(snap({ x: 20, ts: Math.round(t) }), t);
  assert.equal(out.length, 0);
});

test('urgent changes (input bits, ground, facing, knockback) go out after 30 ms, not after 67', () => {
  const out = [];
  const tick = arenaTicker((m) => { out.push(m); return true; });
  tick(snap({ x: 10, vx: 10 }), 0);
  tick(snap({ x: 10.2, vx: 10, i: 2 }), 16);
  assert.equal(out.length, 1, 'too soon: waits for the 30 ms mark');
  tick(snap({ x: 10.3, vx: 10, i: 2 }), 33);
  assert.equal(out.length, 2);
  assert.equal(out[1].i, 2);
  tick(snap({ x: 10.9, vx: 10, i: 2 }), 70, true);
  assert.equal(out.length, 3, 'a knockback is urgent');
});

test('never more than 20 a second, even with urgent changes every frame, at any frame rate', () => {
  for (const fps of [20, 60, 144]) {
    const out = [];
    const tick = arenaTicker((m) => { out.push(m); return true; });
    let i = 0;
    for (let t = 0; t <= 3000; t += 1000 / fps) tick(snap({ x: t / 100, i: (i++ % 2) * 2, ts: Math.round(t) }), t);
    const times = out.map((m) => m.ts);
    for (const t0 of times) assert.ok(times.filter((t) => t >= t0 && t < t0 + 1000).length <= 20, `${fps} fps`);
  }
});

test('a send that did not go out is retried', () => {
  let ok = false;
  const out = [];
  const tick = arenaTicker((m) => { if (ok) out.push(m); return ok; });
  tick(snap({ x: 11 }), 0);
  ok = true;
  tick(snap({ x: 11 }), 100);
  assert.equal(out.length, 1);
});

test('positionTicker.reset sends the same position again at once (leaving the arena)', () => {
  const out = [];
  const tick = positionTicker((m) => { out.push(m); return true; });
  tick({ x: 5, y: 5 });
  tick({ x: 5, y: 5 });
  tick.reset();
  tick({ x: 5, y: 5 });
  assert.equal(out.length, 2);
});

test('a heart at the arena photo rises from above the stickman\'s head', () => {
  const [h] = heartEntities([{ f: 'bd', id: 'a', age: 0 }], [{ id: 'bd', backdrop: true }], { posOf: () => ({ x: 5, y: 20 }) });
  assert.equal(h.y, 20 - 2.2);
});
```

In `test/peers.test.js`:

```js
test('positions alone give motion: velocity, facing, and ground when y holds still for 120 ms', () => {
  const p = createPeers({ delay: 0 });
  p.apply({ t: 'welcome', id: 'me', peers: [{ id: 'a', name: '', x: 10, y: 20 }] }, 0);
  for (let t = 50; t <= 400; t += 50) p.apply({ t: 'p', id: 'a', x: 10 - t / 100, y: 20 }, t);
  const [a] = p.list(400);
  assert.ok(Math.abs(a.vx + 10) < 0.5, `vx ${a.vx}`);
  assert.equal(a.facing, -1);
  assert.equal(a.ground, true);
  p.apply({ t: 'p', id: 'a', x: 6, y: 18 }, 450);
  assert.equal(p.list(450)[0].ground, false);
});
```

Also update the existing heart-at-arena test in live.test.js to expect `y − 2.2`.

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/live.test.js test/peers.test.js < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `arenaTicker`:
    - keeps `last` (the last sent snapshot), `lastAt`, `pend` (an urgent change is waiting), `sent` (send times in the last second);
    - `changed(a, b)` compares the rounded fields, with `|a.a − b.a| > 0.05`;
    - `urgentChange` is `urgent || a.i !== b.i || a.g !== b.g || a.f !== b.f`;
    - on each call: drop `sent` entries older than 1000 ms; if `sent.length >= cap`, return.
      - If `pend` or there's an urgent change: send when `now − lastAt >= gap`, else set `pend`.
      - Else if changed and `now − lastAt >= every`: send.
  - `createLive`:
    - in `onMessage`, after peers.apply: `if (ARENA_T.has(m.t)) onArena(m)`;
    - on `welcome`, set `fightOk`;
    - `tick: (player) => { if (!inArena()) tick(player); }`.
    - Keep the existing behaviour otherwise.
  - `peers.js`: track samples already have `t`. Compute motion inside `list()` with `sample()`, and keep `p.facing` updated.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/live.test.js test/peers.test.js test/net.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: the arena state ticker, arena messages, the fight check, and colours that skip amber`.

---

### Task 6: Input: J, K, mouse aim and buttons, double-tap rolls, and pad FIRE/HIT

**Files:**
- Modify: `src/input.js`
- Create: `test/input.test.js`

**Interfaces:**
- Produces (`src/input.js`):
  - `createDoubleTap(gap = 0.25)` → `{ press(dir, t) → dir | 0 }`:
    - a second press of the same direction within `gap` seconds of the first returns `dir`, and resets;
    - a press in the other direction starts over;
    - `t` is in seconds.
  - `createInput(target, { onTap, onKey, arena = () => false, now = () => performance.now() / 1000 })` returns, in addition to today's API:
    - `state()` → today's fields plus `fire` (J held, pad `Fire` held, or the left mouse button held over the stage while `arena()`);
    - `takeStrikes()` → the number of strike presses since the last call (K keydowns, not repeats; right-button presses over the stage while `arena()`; pad `Hit` presses), then resets to 0;
    - `takeRoll()` → −1, 0 or 1, from double-taps of ←/A or →/D keydowns (not repeats) and pad `ArrowLeft`/`ArrowRight` presses, then resets;
    - `mouse` → `{ on, px, py }` in client pixels:
      - `on` turns true on a `pointermove` of pointer type `mouse` over the stage while `arena()`;
      - it turns false on a `KeyJ` keydown, and stays false until the mouse moves again;
    - `clear()` also releases fire and the mouse buttons, and forgets pending strikes and rolls.
  - While `arena()`, `contextmenu` on the stage calls `preventDefault()`.
  - Touch pointers never fire or aim. On a phone, `pointerdown` on the stage stays a tap.

- [ ] **Step 1: Write the failing tests** (`test/input.test.js`). `createInput` needs a DOM, so test the pure part, plus a small fake `window`/target for the rest:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoubleTap } from '../src/input.js';

test('a double-tap within 0.25 s rolls that way; slower, or the other way, does not', () => {
  const d = createDoubleTap();
  assert.equal(d.press(1, 0), 0);
  assert.equal(d.press(1, 0.2), 1);
  assert.equal(d.press(1, 0.3), 0, 'a third tap starts over');
  assert.equal(d.press(1, 0.7), 0, 'too slow');
  assert.equal(d.press(-1, 0.8), 0);
  assert.equal(d.press(1, 0.85), 0, 'the other way starts over');
  assert.equal(d.press(-1, 1.0), 0);
  assert.equal(d.press(-1, 1.2), -1);
});

// A tiny event target standing in for window and the stage.
function fakeTarget() {
  const ls = {};
  return { addEventListener: (t, f) => { (ls[t] ||= []).push(f); }, fire: (t, e) => (ls[t] || []).forEach((f) => f(e)) };
}

test('J fires while held; K strikes once per press; double-tapping D rolls; leaving clears everything', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fake');
  let t = 0;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => true, now: () => t });
  const key = (type, code, extra = {}) => win.fire(type, { code, target: {}, preventDefault() {}, shiftKey: false, ...extra });
  key('keydown', 'KeyJ');
  assert.equal(input.state().fire, true);
  key('keyup', 'KeyJ');
  assert.equal(input.state().fire, false);
  key('keydown', 'KeyK'); key('keydown', 'KeyK', { repeat: true }); key('keyup', 'KeyK'); key('keydown', 'KeyK');
  assert.equal(input.takeStrikes(), 2);
  assert.equal(input.takeStrikes(), 0);
  key('keydown', 'KeyD'); key('keyup', 'KeyD'); t = 0.15; key('keydown', 'KeyD');
  assert.equal(input.takeRoll(), 1);
  assert.equal(input.takeRoll(), 0);
  key('keydown', 'KeyJ'); key('keydown', 'KeyK');
  input.clear();
  assert.equal(input.state().fire, false);
  assert.equal(input.takeStrikes(), 0);
  delete globalThis.window;
});

test('the mouse aims and fires in the arena only; J turns mouse aim off until it moves; right button strikes', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fake2');
  let inArena = false;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => inArena, now: () => 0 });
  stage.fire('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 50 });
  assert.equal(input.mouse.on, false, 'not in the arena');
  inArena = true;
  stage.fire('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 50 });
  assert.deepEqual(input.mouse, { on: true, px: 100, py: 50 });
  stage.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 100, clientY: 50 });
  assert.equal(input.state().fire, true);
  stage.fire('pointerup', { pointerType: 'mouse', button: 0, clientX: 100, clientY: 50 });
  stage.fire('pointerdown', { pointerType: 'mouse', button: 2, clientX: 100, clientY: 50 });
  assert.equal(input.takeStrikes(), 1);
  win.fire('keydown', { code: 'KeyJ', target: {}, preventDefault() {} });
  assert.equal(input.mouse.on, false);
  stage.fire('pointerdown', { pointerType: 'touch', button: 0, clientX: 1, clientY: 1 });
  win.fire('keyup', { code: 'KeyJ', target: {}, preventDefault() {} });
  assert.equal(input.state().fire, false, 'touch never fires');
  delete globalThis.window;
});

test('the pad: Fire held fires, Hit strikes per press, ◀ ◀ rolls left', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fake3');
  let t = 0;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => true, now: () => t });
  input.press('Fire', true);
  assert.equal(input.state().fire, true);
  input.press('Fire', false);
  input.press('Hit', true); input.press('Hit', false); input.press('Hit', true);
  assert.equal(input.takeStrikes(), 2);
  input.press('ArrowLeft', true); input.press('ArrowLeft', false); t = 0.2; input.press('ArrowLeft', true);
  assert.equal(input.takeRoll(), -1);
  delete globalThis.window;
});
```

  `createInput` uses `window.addEventListener` today. Change it to `const win = globalThis.window` at call time, so the fake target works. The `?fake` query gives each test a fresh module instance.

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/input.test.js < /dev/null`. Expected: FAIL, `createDoubleTap` is not exported.

- [ ] **Step 3: Implement**, per Interfaces.
  - On keydown, `e.repeat` is ignored for K and for the roll's double-tap. Direction keys still go into `held` as today.
  - KeyJ and KeyK are handled before `onKey`, and they return without calling it.
  - The existing tap-to-walk `pointerdown`/`pointerup` stays. Mouse fire must not stop a tap from reaching `onTap` (main.js ignores taps in the side view anyway).

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/input.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: J shoots, K strikes, the mouse aims, double-taps roll, and pad FIRE/HIT`.

---

### Task 7: `src/stick.js`: actions (punch, kick, hurt, death, respawn, roll, protection) and the motion memory

**Files:**
- Modify: `src/stick.js`, `test/stick.test.js`

**Interfaces:**
- Consumes: Task 4's `stickPose` and its layering.
- Produces:
  - `stickPose` handles these acts:
    - `act` values `punch`, `kick`, `hurt`, `dead`, `roll`;
    - `spawnT < 0.45` (respawn), and `safe`;
    - Reduce Motion for each (stickman spec §4 "Punch", "Kick", "Hurt", "Death: pop and scatter", "Respawn", "Roll", §3 `safe`, §5 "Reduce Motion").
  - `createMotionMemory()` → `{ fill(id, state, t) → state }`:
    - sets `landT` and `spawnT` on the state it is given, and returns it;
    - `ground` false → true sets `landT = 0` and counts up after that; while in the air, `landT = Infinity`;
    - first seen, or `dead` turning into anything else, sets `spawnT = 0`; it counts up;
    - an id not seen for 5 s is forgotten.
- **Act lengths**: punch 0.25, kick 0.4, roll 0.3. Hurt lasts while `act === 'hurt'`; the PvP layer ends it with the stun. Dead: empty output after 2.0.
- **Death scatter** is closed-form:
  - gravity is 50 rows/s²;
  - the ground is `dy = +1`;
  - at the first contact the vertical speed reverses at ×0.3 and the horizontal speed halves; at the second contact the piece stops;
  - limbs cycle `| / - \` at 12 per second while airborne, and rest as `_`; the head stays `O`;
  - pieces fade from 1.4 to 2.0.
- **Roll**:
  - 4 frames of 0.075 s from the spec table, on rows `dy = 0` and `dy = 1`. Glyph centres sit at `dx` −0.7, 0 and 0.7 for the three columns.
  - The head `o` has part `head`. Every other glyph has part `torso`.
  - No gun is drawn.
  - A puff `~` (tone `fx`) marks where the roll started. The pose function doesn't know that spot, so it draws the puff behind the body by the distance rolled: `dx = −actT × 48` (before mirroring), `dy = 1`. It is drawn only while `actT < 0.1`, and not with Reduce Motion.
- **Protection** (`safe`): body glyphs' `a = 0.575 + 0.225 cos(2π × 3 × t)`; 0.5 with Reduce Motion. Labels are not part of the pose.

- [ ] **Step 1: Write the failing tests** (append to `test/stick.test.js`):

```js
import { createMotionMemory } from '../src/stick.js';

test('punch: the fist reaches dx ≥ 1.5 at actT 0.06 and 0.1, not at 0 or 0.3', () => {
  const reach = (actT) => Math.max(...pose({ act: 'punch', actT }).filter((g) => g.part === 'armF').map((g) => g.dx));
  assert.ok(reach(0.06) >= 1.5 && reach(0.1) >= 1.5);
  assert.ok(reach(0) < 1.5 && reach(0.3) < 1.5);
});

test('kick: the foot reaches dx ≥ 1.4 at dy ≈ 0.55 at actT 0.06 and 0.15, in the air too', () => {
  for (const ground of [true, false]) for (const actT of [0.06, 0.15]) {
    const foot = pose({ act: 'kick', actT, ground, vy: ground ? 0 : 5 }).filter((g) => g.part === 'legF' && g.dx >= 1.4);
    assert.ok(foot.some((g) => Math.abs(g.dy - 0.55) < 0.1), `ground ${ground} t ${actT}`);
  }
});

test('hurt: all white for actT < 0.08, none after; at 0.35 the locomotion pose', () => {
  assert.ok(pose({ act: 'hurt', actT: 0.05 }).every((g) => g.tone === 'flash'));
  assert.ok(pose({ act: 'hurt', actT: 0.1 }).every((g) => g.tone !== 'flash'));
  assert.deepEqual(pose({ act: 'hurt', actT: 0.35 }), pose({}));
  assert.ok(pose({ act: 'hurt', actT: 0.05 }, 0, { reducedMotion: true }).every((g) => g.tone !== 'flash'));
});

test('protection: a 0.35–0.8 pulse that changes over time; steady 0.5 with Reduce Motion', () => {
  const as = [0, 0.05, 0.1, 0.15].map((t) => head(pose({ safe: true }, t)).a);
  assert.ok(as.every((a) => a >= 0.35 - 1e-9 && a <= 0.8 + 1e-9));
  assert.ok(new Set(as.map((a) => a.toFixed(3))).size > 1);
  assert.equal(head(pose({ safe: true }, 0.1, { reducedMotion: true })).a, 0.5);
});

test('dead: pieces never go below the feet line, are still from 1.15 to 1.4, fade 1.4→2.0, then nothing', () => {
  for (let t = 0; t <= 2; t += 0.05) for (const g of pose({ act: 'dead', actT: t })) assert.ok(g.dy <= 1 + 1e-9, `${g.part} at ${t}`);
  const at = (t) => pose({ act: 'dead', actT: t }).filter((g) => g.part !== 'fx').map((g) => [g.part, g.dx.toFixed(6), g.dy.toFixed(6)]);
  assert.deepEqual(at(1.15), at(1.4));
  assert.ok(pose({ act: 'dead', actT: 1.35 }).every((g) => g.a === 1 || g.part === 'fx'));
  assert.ok(pose({ act: 'dead', actT: 1.99 }).every((g) => g.a < 0.05));
  assert.deepEqual(pose({ act: 'dead', actT: 2.01 }), []);
  assert.ok(pose({ act: 'dead', actT: 0.1 }, 0, { reducedMotion: true }).every((g) => g.ch === '_' || g.ch === 'O'));
});

test('respawn: invisible at spawnT 0; idle from 0.45', () => {
  assert.ok(pose({ spawnT: 0 }).every((g) => g.a === 0));
  assert.deepEqual(pose({ spawnT: 0.45 }), pose({}));
});

test('roll: the head goes top, front, bottom, back; no gun; nothing on the top row; mirrored facing left', () => {
  const headAt = (actT, facing = 1) => pose({ act: 'roll', actT, facing, gun: 'rifle' }).find((g) => g.part === 'head');
  assert.deepEqual([0.03, 0.1, 0.17, 0.25].map((t) => [headAt(t).dx, headAt(t).dy]), [[0, 0], [0.7, 1], [0, 1], [-0.7, 0]]);
  for (const t of [0.03, 0.1, 0.17, 0.25]) {
    const g = pose({ act: 'roll', actT: t, gun: 'sniper' });
    assert.equal(g.filter((x) => x.part === 'gun').length, 0);
    assert.ok(g.filter((x) => x.part !== 'fx').every((x) => x.dy >= 0));
  }
  assert.equal(headAt(0.1, -1).dx, -0.7);
});

test('motion memory: landing sets landT 0; dead → idle sets spawnT 0; ids are forgotten after 5 s', () => {
  const m = createMotionMemory();
  const s1 = m.fill('a', { ground: false, act: 'idle' }, 0);
  assert.equal(s1.spawnT, 0, 'first seen');
  assert.equal(s1.landT, Infinity);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 0.1).landT, 0);
  assert.ok(Math.abs(m.fill('a', { ground: true, act: 'idle' }, 0.2).landT - 0.1) < 1e-9);
  m.fill('a', { ground: true, act: 'dead' }, 1);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 3).spawnT, 0);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 9).spawnT, 0, 'forgotten after 5 s: seen fresh');
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/stick.test.js < /dev/null`. Expected: FAIL in the new tests.

- [ ] **Step 3: Implement**, transcribing the spec tables.
  - **Whole-body poses** (kick, hurt, dead, roll, respawn) replace the locomotion pose. Kick keeps the head where locomotion put it.
  - **Recover phases** interpolate each part's `(dx, dy)` linearly from the action pose to the locomotion pose. Characters switch at the spec's times.
  - **The scatter**: for each piece, from its hurt-pose place, with the table's `(vx, vy)`:
    - first, solve the closed-form time to `dy = 1`;
    - then the bounce, with the vertical speed reversed at ×0.3 and the horizontal speed halved;
    - then the second contact, where it stops.
    - The pop sparks: 4 `*` (tone `fx`) moving diagonally out from 0.5 to 1.5 cells, fading by 0.25.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/stick.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: stickman actions: punch, kick, hurt, death scatter, respawn, roll and protection`.

---

### Task 8: `src/referee.js`: the rules engine shared by the server and the browser

**Files:**
- Create: `src/referee.js`, `test/referee.test.js`

**Interfaces:**
- Consumes:
  - `fight.js` (Task 3);
  - `level.js` (Task 1);
  - in tests only: `arena.js` `newBody`, `stepBody`, `knock`, `levelKind` (Task 2).
- Produces:
  - `newFighter(id, now)` → a plain record that survives `structuredClone` and JSON. Its fields:
    - identity and presence: `{ id, arena: false, x: 0, y: 0, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, at: now }`
    - health and life: `hp: 100, hurtAt: -1e9, alive: true, deadAt: -1e9, safeUntil: 0`
    - score and strikes: `kills: 0, combo: 0, strikeAt: -1e9, lastStrike: null, airAt: -1e9, hitBy: null`
    - gun and roll: `gun: 'deagle', ammo: -1, rollAt: null`
  - `createReferee({ level, rand })` → an object with:
    - `enter(F, now)` → `out`:
      - `arena = true`, `hp = 100`, `hurtAt = -1e9`, `alive = true`, `safeUntil = now + 1.5`, deagle, `hitBy = null`;
      - kills are kept;
      - `out = [{ t: 'aj', id, hp: 100, kills }]`.
    - `state(F, s, now, sentAt = now)`:
      - stores `s` (`x, y, vx, vy, f, g, i, a`) and `at = now`;
      - when `g === 0`, `airAt = now`;
      - when bit 32 turns on, `rollAt = Math.max(sentAt, now − 0.15)`; when it turns off, `rollAt = null`;
      - returns nothing. Clamping and parsing are the server's (Task 9).
    - `fire(F, m, now, all)` → `{ ok, out }`, where `m = { x, y, a }`:
      - refused when F is not in the arena, not alive or rolling (`i & 32`), or already has `GUNS[F.gun].max` bullets in flight;
      - the origin is `m`'s if it is within 3 cells across and 2 rows of `muzzleOf(estimate, F.f, F.a, F.gun)`, otherwise that muzzle;
      - the bullet is `{ n, owner, gun, x, y, angle: m.a, t0: now, last: now, len: min(rayLength, bulletRange) }`;
      - `n` counts up per referee and wraps at 65536;
      - out: `{ t: 's', id, n, x, y, a, w: code }`;
      - one round of a pickup gun is spent; at 0 the gun becomes the deagle with ammo −1, and `{ t: 'w', id, w: 'd', ammo: -1 }` is added;
      - `safeUntil = 0`.
    - `strike(F, m, now, all)` → `{ ok, out }`, where `m = { k }`:
      - refused when F is not in the arena, not alive or rolling;
      - `inAir = m.k === 'k' && now − F.airAt <= 0.15`; then `s = nextStrike(F, now, inAir)`;
      - a claimed kick on the ground outside a combo comes back as a punch, because `nextStrike` gives `punch` when `inAir` is false and the combo is under 3;
      - stores `combo`, `strikeAt = now`, `lastStrike`; `safeUntil = 0`;
      - out always starts with `{ t: 'mm', id, k: 'p' | 'k' }`, then an `h` for every other fighter that is:
        - in the arena, alive, not protected (`now >= safeUntil`), not inside the dodge window;
        - and whose estimate overlaps `strikeBox(estimate(F), F.f, kind)`.
    - `tick(now, all)` → `out`:
      - advances every bullet from `last` to `min(now, t0 + len / speed)`;
      - tests every target (not the owner; in the arena, alive, not protected at the hit time, not in its dodge window at the hit time) with `sweep(bulletAt(t0), bulletAt(t1), estimateAt(T, last), estimateAt(T, t1))`;
      - the earliest hit wins and removes the bullet; a bullet that reaches its `len` is removed.
    - `pickup(F, n, now)` → `{ ok, out }`:
      - the fighter must be in the arena and alive, the pickup must exist and have been taken 10 s ago or more, and `nearPickup(estimate(F), spot)` must hold;
      - then `takenAt = now`, `F.gun = p.gun`, `F.ammo = GUNS[gun].ammo`;
      - out: `[{ t: 'pk', id, n, at: 10000 }, { t: 'w', id, w: code, ammo }]`.
    - `respawn(F, now, all, spot)` → `{ ok, out }`:
      - needs `!F.alive && now − F.deadAt >= 1.9`;
      - the spot is `spot ?? level.spawns[pickSpawn(level.spawns, alive others' estimates, rand)]`;
      - sets `x, y`, `vx = vy = 0`, `hp = 100`, alive, `safeUntil = now + 1.5`, deagle, `hitBy = null`;
      - out: `{ t: 'sp', id, x, y }`.
    - `leave(F, now, all)` → `out`:
      - if F is alive and `fleeKiller(F, now)` names a fighter K in `all`: `K.kills++`, and `{ t: 'k', id: F.id, by: K.id, kills: K.kills, fled: 1 }`;
      - then `{ t: 'ax', id }`; `arena = false`; `rollAt = null`.
    - `view(F, now)` → `{ id, hp: round(regen), kills, alive: 0 | 1, safe: 0 | 1, w: code, ammo, x, y, vx, vy, f, g, i, a }`.
    - `pickups(now)` → `[{ n, at }]`, ms until each is back (0 if there).
    - `live()` → the number of bullets in flight.
    - `estimate(F, now)` → `{ x: F.x + F.vx × k, y: F.y + F.vy × k }`, with `k = clamp(now − F.at, 0, 0.1)`.
    - `bullets` (an array, read-only for callers).
- **Damage** (internal `hurt(T, by, w, n, d, kx, ky, stun, now, all)`):
  - `T.hp = regenHp(T.hp, T.hurtAt, now) − d`, `hurtAt = now`, `hitBy = by`;
  - the server's view moves: `T.x, T.y = estimate(T, now)`, `T.at = now`, `T.vx = kx`, and `T.vy = ky` if `ky`;
  - out `{ t: 'h', id: T.id, by, w, n: n ?? -1, d, hp: max(0, round(hp)), kx: round1(kx), ky: round1(ky) }`;
  - at hp ≤ 0: `alive = false`, `deadAt = now`, `hp = 0`, deagle;
    - if the attacker is in `all` (alive or not), its kills go up by one;
    - `{ t: 'k', id: T.id, by, kills }` (where `kills` is the attacker's new total, or 0 if it has left).
  - Both popping each other at once works by construction: each bullet is resolved on its own.

- [ ] **Step 1: Write the failing tests** (`test/referee.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { createReferee, newFighter } from '../src/referee.js';
import { muzzleOf, GUNS, STRIKES } from '../src/fight.js';
import { newBody, stepBody, knock } from '../src/arena.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const ref = () => createReferee({ level: L, rand: () => 0.5 });
const F = (id, x, y = 27.5, f = 1) => Object.assign(newFighter(id, 0), { arena: true, x, y, f, at: 0, safeUntil: 0 });
const shoot = (R, A, now, all, a = 0) => { const m = muzzleOf(A.x, A.y, A.f, 0, A.gun); return R.fire(A, { x: m.x, y: m.y, a }, now, all); };
const run = (R, from, to, all) => { const out = []; for (let t = from; t <= to + 1e-9; t += 0.033) out.push(...R.tick(t, all)); return out; };

test('a deagle shot at a standing target: s, then h with 25 damage and knockback away', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  const { ok, out } = shoot(R, A, 1, [A, B]);
  assert.equal(ok, true);
  assert.equal(out[0].t, 's');
  assert.equal(out[0].w, 'd');
  const h = run(R, 1, 1.3, [A, B]).find((m) => m.t === 'h');
  assert.deepEqual({ ...h, n: undefined }, { t: 'h', id: 'b', by: 'a', w: 'd', n: undefined, d: 25, hp: 75, kx: 10, ky: 0 });
  assert.equal(R.live(), 0);
});

test('a ▓ pillar in the way stops the bullet', () => {
  const R = ref(), A = F('a', 30.5), B = F('b', 45.5);
  shoot(R, A, 1, [A, B]);
  assert.equal(run(R, 1, 2, [A, B]).filter((m) => m.t === 'h').length, 0);
  assert.equal(R.live(), 0);
});

test('protected and popped targets are skipped, and your own bullet never hits you', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5), C = F('c', 40.5 - 5);
  B.safeUntil = 5;
  shoot(R, A, 1, [A, B, C]);
  const hs = run(R, 1, 2, [A, B, C]).filter((m) => m.t === 'h');
  assert.deepEqual(hs.map((h) => h.id), ['c']);
  const S = F('s', 20.5);
  shoot(R, S, 3, [S]);
  assert.equal(run(R, 3, 4, [S]).length, 0);
});

test('a target inside its roll\'s dodge window is skipped; just before and after it is hit', () => {
  const at = (rollOffset) => {
    const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
    shoot(R, A, 1, [A, B]);
    B.rollAt = 1.082 - rollOffset; // the bullet arrives about 0.082 s after firing
    return run(R, 1, 1.3, [A, B]).some((m) => m.t === 'h');
  };
  assert.equal(at(0.1), false);
  assert.equal(at(0.02), true);
  assert.equal(at(0.3), true);
});

test('four deagle hits pop: k with kills 1; the dead target holds the deagle', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  B.gun = 'rifle'; B.ammo = 12;
  const out = [];
  for (let k = 0; k < 4; k++) { shoot(R, A, 1 + k * 0.5, [A, B]); out.push(...run(R, 1 + k * 0.5, 1.4 + k * 0.5, [A, B])); }
  assert.deepEqual(out.filter((m) => m.t === 'h').map((h) => h.hp), [75, 50, 25, 0]);
  assert.deepEqual(out.find((m) => m.t === 'k'), { t: 'k', id: 'b', by: 'a', kills: 1 });
  assert.equal(B.alive, false);
  assert.equal(B.gun, 'deagle');
});

test('bullets in flight: at most 2 deagle, 7 rifle, 1 sniper', () => {
  for (const [gun, max] of [['deagle', 2], ['rifle', 7], ['sniper', 1]]) {
    const R = ref(), A = F('a', 60.5);
    A.gun = gun; A.ammo = GUNS[gun].ammo;
    let ok = 0;
    for (let k = 0; k < 10; k++) if (shoot(R, A, 1 + k * 0.001, [A]).ok) ok++;
    assert.equal(ok, max, gun);
  }
});

test('running dry: 40 rifle shots, then w back to the deagle, and the next s is a deagle shot', () => {
  const R = ref(), A = F('a', 60.5);
  A.gun = 'rifle'; A.ammo = 40;
  let out = [];
  for (let k = 0; k < 40; k++) { out = shoot(R, A, 1 + k, [A]).out; R.tick(1.9 + k, [A]); }
  assert.deepEqual(out.at(-1), { t: 'w', id: 'a', w: 'd', ammo: -1 });
  assert.equal(shoot(R, A, 50, [A]).out[0].w, 'd');
});

test('pickups: taken, refused while gone, back after 10 s, the same gun refills, too far is refused', () => {
  const R = ref(), p = L.pickups.find((q) => q.gun === 'rifle');
  const A = F('a', p.x, p.y), B = F('b', p.x + 0.5, p.y), C = F('c', p.x + 3, p.y);
  assert.deepEqual(R.pickup(A, p.n, 1).out, [{ t: 'pk', id: 'a', n: p.n, at: 10000 }, { t: 'w', id: 'a', w: 'r', ammo: 40 }]);
  assert.equal(R.pickup(B, p.n, 2).ok, false);
  A.ammo = 3;
  assert.equal(R.pickup(A, p.n, 11).ok, true);
  assert.equal(A.ammo, 40, 'refilled');
  assert.equal(R.pickup(C, p.n, 30).ok, false, 'too far');
  assert.deepEqual(R.pickups(12).find((q) => q.n === p.n), { n: p.n, at: 9000 });
});

test('strikes: mm always; a punch within reach; a ground kick outside a combo is a punch; punch punch kick', () => {
  const R = ref(), A = F('a', 60.5), B = F('b', 62.6);
  const s1 = R.strike(A, { k: 'k' }, 1, [A, B]);
  assert.deepEqual(s1.out[0], { t: 'mm', id: 'a', k: 'p' });
  assert.equal(s1.out[1].w, 'p');
  assert.equal(s1.out[1].d, 14);
  B.x = 62.6; B.at = 1.3;
  assert.equal(R.strike(A, { k: 'p' }, 1.3, [A, B]).out[0].k, 'p');
  B.x = 62.6; B.at = 1.6;
  const s3 = R.strike(A, { k: 'p' }, 1.6, [A, B]);
  assert.equal(s3.out[0].k, 'k', 'third of a combo');
  assert.equal(s3.out[1].d, 22);
  const air = F('c', 60.5); air.airAt = 9.95;
  assert.equal(R.strike(air, { k: 'k' }, 10, [air]).out[0].k, 'k', 'in the air');
  const far = F('d', 60.5), farB = F('e', 63.2);
  assert.equal(R.strike(far, { k: 'p' }, 20, [far, farB]).out.length, 1, 'out of reach: only mm');
});

test('a kick carries a target 11 ± 2 cells, a punch 5 ± 1.5 (the shared physics)', () => {
  const kinds = levelKind(L);
  const carry = (kind) => {
    const b = newBody(60.5, 27.5);
    for (let i = 0; i < 12; i++) stepBody(b, 1 / 60, {}, kinds);
    const { kx, ky, stun } = STRIKES[kind];
    knock(b, kx, -ky, stun);
    const x0 = b.x;
    for (let i = 0; i < 180; i++) stepBody(b, 1 / 60, {}, kinds);
    return b.x - x0;
  };
  assert.ok(Math.abs(carry('kick') - 11) <= 2, `kick ${carry('kick')}`);
  assert.ok(Math.abs(carry('punch') - 5) <= 1.5, `punch ${carry('punch')}`);
});

test('respawn: refused before 1.9 s; then sp at the spawn farthest from everyone alive, full hp, protected, deagle', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { alive: false, deadAt: 10, hp: 0 });
  assert.equal(R.respawn(B, 11, [A, B]).ok, false);
  const { ok, out } = R.respawn(B, 12, [A, B]);
  assert.equal(ok, true);
  const far = L.spawns.reduce((best, s) => (Math.hypot(s.x - 20.5, 2 * (s.y - 27.5)) > Math.hypot(best.x - 20.5, 2 * (best.y - 27.5)) ? s : best));
  assert.deepEqual(out, [{ t: 'sp', id: 'b', x: far.x, y: far.y }]);
  assert.equal(B.hp, 100);
  assert.ok(B.safeUntil > 13);
});

test('leaving within 3 s of a hit gives the hitter the kill (fled); after 3.1 s it does not', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  Object.assign(B, { hitBy: 'a', hurtAt: 10 });
  assert.deepEqual(R.leave(B, 12.9, [A, B]), [{ t: 'k', id: 'b', by: 'a', kills: 1, fled: 1 }, { t: 'ax', id: 'b' }]);
  const C = F('c', 40);
  Object.assign(C, { hitBy: 'a', hurtAt: 10 });
  assert.deepEqual(R.leave(C, 13.1, [A, C]), [{ t: 'ax', id: 'c' }]);
});

test('firing or striking ends protection; firing while rolling is refused', () => {
  const R = ref(), A = F('a', 60.5);
  A.safeUntil = 5;
  shoot(R, A, 1, [A]);
  assert.equal(A.safeUntil, 0);
  const B = F('b', 70.5); B.safeUntil = 5;
  R.strike(B, { k: 'p' }, 1, [B]);
  assert.equal(B.safeUntil, 0);
  const C = F('c', 80.5); C.i = 32;
  assert.equal(shoot(R, C, 1, [C]).ok, false);
  assert.equal(R.strike(C, { k: 'p' }, 1, [C]).ok, false);
});

test('a shooter that pops keeps its bullets flying, and they can still kill', () => {
  const R = ref(), A = F('a', 20.5), B = F('b', 30.5);
  B.hp = 20; B.hurtAt = 0.9;
  shoot(R, A, 1, [A, B]);
  Object.assign(A, { alive: false, deadAt: 1.01 });
  const out = run(R, 1, 1.3, [A, B]);
  assert.deepEqual(out.find((m) => m.t === 'k'), { t: 'k', id: 'b', by: 'a', kills: 1 });
});

test('records survive a JSON round trip (Durable Object attachments)', () => {
  const A = newFighter('a', 3);
  assert.deepEqual(JSON.parse(JSON.stringify(A)), A);
});

test('referee.js uses no randomness or browser APIs of its own', () => {
  assert.doesNotMatch(fs.readFileSync(new URL('../src/referee.js', import.meta.url), 'utf8'), /Math\.random|window|document|performance|Date\.now/);
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/referee.test.js < /dev/null`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/referee.js`**, as described in Interfaces.
  - Pickups: `level.pickups.map((p) => ({ ...p, takenAt: -1e9 }))`.
  - The ray cast uses `levelKind(level)`.
  - `estimateAt(T, t)`: the same formula as `estimate`, at time `t`.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/referee.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: the referee: shots, the bullet sweep, strikes, pickups, respawns and the flee rule`.

---

### Task 9: `server/rules.js`: the new messages, rate buckets, speed clamp and sender clock

**Files:**
- Modify: `server/rules.js`, `test/rules.test.js`

**Interfaces:**
- Consumes: `GUNS` from `../src/fight.js` (Task 3).
- Produces (`server/rules.js`):
  - `parseMessage` accepts:
    - `{t:'ae'}`, `{t:'al'}`, `{t:'rs'}`, with no other fields read;
    - `{t:'a', x, y, vx, vy, f, g, i, a, ts}`:
      - `−1 ≤ x ≤ 163`, `−1 ≤ y ≤ 35`, `|vx|, |vy| ≤ 60`;
      - `f` ∈ {−1, 1}, `g` ∈ {0, 1}, `i` an integer 0..63;
      - `|a| ≤ π/2 + 1e-9`;
      - `ts` an integer, 0..1e9;
      - all finite;
      - returns the fields rounded: `x, y, a` to 2 decimals, `vx, vy` to 1.
    - `{t:'f', x, y, a, ts}`, with the same `x, y` bounds and `|a| ≤ π + 1e-9`;
    - `{t:'m', k: 'p'|'k', ts}`;
    - `{t:'pk', n}`, where `n` is an integer 0..15.
  - Rates (capacity, refill per second):
    - `a` [24, 20];
    - `pk` [2, 2];
    - `m` [2, 3.4];
    - `ae` [4, 1], shared by `ae` and `al`;
    - `rs` [2, 1].
  - `takeShot(b, gun, now)`:
    - a bucket keyed `f`, capacity 2, refilling at `1.15 / GUNS[gun].cooldown` per second;
    - it uses the same `take` machinery, with the rate passed in;
    - `now` is in ms, like the existing buckets.
  - `clampMove(prev, next, gapMs)` → `next`, with `x, y` pulled back along the line from `prev` so that `|Δx| ≤ 60 × gap × 1.25 + 0.5` and `|Δy| ≤` the same (with `gap` in seconds). A move within the limit is returned unchanged.
  - `senderClock()` → `{ base: null, lo: Infinity, loAt: 0 }`, and `sentAt(clock, ts, nowMs)` → server ms:
    - the first call sets `base = nowMs − ts`;
    - each call tracks `lo = min(lo, nowMs − ts)` over a 5000 ms window; when the window rolls over, `base = lo` and `lo` resets;
    - returns `min(base + ts, nowMs + 300)`, so a clock running ahead can't claim more than 300 ms.
  - `LIMITS.bytes` stays 200.

- [ ] **Step 1: Write the failing tests** (append to `test/rules.test.js`):

```js
import { takeShot, clampMove, senderClock, sentAt } from '../server/rules.js';

test('arena messages parse; malformed ones do not', () => {
  assert.deepEqual(parseMessage('{"t":"ae"}'), { t: 'ae' });
  assert.deepEqual(parseMessage('{"t":"al","x":1}'), { t: 'al' });
  assert.deepEqual(parseMessage('{"t":"rs"}'), { t: 'rs' });
  assert.deepEqual(parseMessage(JSON.stringify({ t: 'a', x: 10.123, y: 27.5, vx: 30.04, vy: 0, f: 1, g: 1, i: 34, a: 0.789, ts: 1200 })),
    { t: 'a', x: 10.12, y: 27.5, vx: 30, vy: 0, f: 1, g: 1, i: 34, a: 0.79, ts: 1200 });
  for (const bad of [{ x: 170 }, { y: -2 }, { vx: 61 }, { f: 0 }, { g: 2 }, { i: 64 }, { i: 1.5 }, { a: 1.6 }, { ts: -1 }, { x: 'NaN' }])
    assert.equal(parseMessage(JSON.stringify({ t: 'a', x: 10, y: 20, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0, ...bad })), null, JSON.stringify(bad));
  assert.deepEqual(parseMessage('{"t":"f","x":12,"y":27.2,"a":3.1,"ts":5}'), { t: 'f', x: 12, y: 27.2, a: 3.1, ts: 5 });
  assert.equal(parseMessage('{"t":"f","x":12,"y":27.2,"a":3.2,"ts":5}'), null);
  assert.deepEqual(parseMessage('{"t":"m","k":"k","ts":5}'), { t: 'm', k: 'k', ts: 5 });
  assert.equal(parseMessage('{"t":"m","k":"x","ts":5}'), null);
  assert.deepEqual(parseMessage('{"t":"pk","n":2}'), { t: 'pk', n: 2 });
  assert.equal(parseMessage('{"t":"pk","n":16}'), null);
});

test('the worst-case a and f are under 200 bytes', () => {
  const a = { t: 'a', x: -0.99, y: -0.99, vx: -59.9, vy: -59.9, f: -1, g: 0, i: 63, a: -1.57, ts: 999999999 };
  const f = { t: 'f', x: -0.99, y: -0.99, a: -3.14, ts: 999999999 };
  assert.ok(JSON.stringify(a).length < 200 && JSON.stringify(f).length < 200);
  assert.ok(parseMessage(JSON.stringify(a)));
});

test('arena buckets: a 24 then 20/s; shots by the gun\'s cooldown; pk, m, ae/al, rs', () => {
  const b = newBuckets(0);
  let n = 0;
  while (take(b, 'a', 0)) n++;
  assert.equal(n, 24);
  assert.equal(take(b, 'a', 50), true);
  let s = 0;
  for (let k = 0; k < 5; k++) if (takeShot(b, 'deagle', 10 * k)) s++;
  assert.equal(s, 2, 'five shots in 40 ms: two get through');
  assert.equal(takeShot(b, 'deagle', 400), true, 'refilled after one cooldown (1.15 ÷ 0.4 = 2.9/s)');
  const r = newBuckets(0);
  let rs = 0;
  for (let t = 0; t < 1000; t += 10) if (takeShot(r, 'rifle', t)) rs++;
  assert.ok(rs >= 12 && rs <= 14, `rifle ${rs}/s`);
  for (const [k, cap] of [['pk', 2], ['m', 2], ['ae', 4], ['rs', 2]]) {
    const q = newBuckets(0);
    let c = 0;
    while (take(q, k, 0)) c++;
    assert.equal(c, cap, k);
  }
});

test('a move faster than 60 cells/s (with slack) is clamped along its line', () => {
  assert.deepEqual(clampMove({ x: 10, y: 10 }, { x: 12, y: 11 }, 67), { x: 12, y: 11 });
  const c = clampMove({ x: 10, y: 10 }, { x: 60, y: 10 }, 100);
  assert.ok(Math.abs(c.x - (10 + 60 * 0.1 * 1.25 + 0.5)) < 1e-9);
  const d = clampMove({ x: 10, y: 10 }, { x: 40, y: 25 }, 100); // along the same line
  assert.ok(Math.abs((d.y - 10) / (d.x - 10) - 0.5) < 1e-9);
});

test('a sender clock running ahead is held to 300 ms', () => {
  const clk = senderClock();
  assert.equal(sentAt(clk, 0, 1000), 1000);
  assert.equal(sentAt(clk, 67, 1067), 1067);
  assert.equal(sentAt(clk, 5000, 1134), 1434, 'claims 5 s, gets 300 ms');
  for (let t = 1200; t < 8000; t += 67) sentAt(clk, t - 1000 + 20, t); // the network gets 20 ms faster
  assert.ok(Math.abs(sentAt(clk, 7000, 8020) - 8000) <= 21);
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/rules.test.js < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement** in `server/rules.js`.
  - Add `import { GUNS } from '../src/fight.js';`. The browser already imports this file (main.js imports `cleanName`); the extra import is harmless in Vite.
  - Extend `RATES`.
  - Factor `take` to `takeAt(b, kind, cap, rate, now)` and use it from both `take` and `takeShot`.
  - Keep old buckets saved without the new kinds working: `take` already creates a missing bucket.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/rules.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: server rules: arena messages, buckets, the speed clamp and the sender clock`.

---

### Task 10: `src/fighters.js`: remote fighters, predicted with the shared physics

**Files:**
- Create: `src/fighters.js`, `test/fighters.test.js`

**Interfaces:**
- Consumes:
  - `newBody`, `stepBody`, `knock`, `startRoll`, `ROLL` from `src/arena.js` (Task 2);
  - `stunOf`, `regenHp`, `GUN_BY_CODE`, `ACT_TIME` from `src/fight.js` (Task 3).
- Produces: `createFighters({ kindAt, inside = null, offset = { x: 0, y: 0 }, rtt = () => 100 })`.
  - `offset` is added to wire coordinates to get map cells. `rtt()` is the round trip in ms. It returns:
  - `apply(m, nowMs)`, for server messages:
    - `aw`: rebuilds the list from `m.fighters`, apart from `m.you`, which is pvp.js's;
    - `aj`, `ax`: add or remove a fighter;
    - `a`: a state;
    - `s`: act `shoot`, gun from `w`, facing and aim from the absolute angle `a`;
    - `w`: gun;
    - `mm`: act `punch` or `kick`;
    - `h`:
      - `knock(body, kx, ky, stunOf(w))` at once;
      - act `hurt` for that stun;
      - `hp` and `hurtAt`;
    - `k`: dead;
    - `sp`: snap to `x, y`, alive, `safeUntil = now + 1500`.
    - Unknown ids and malformed messages are ignored. It never throws.
  - `step(dt, nowMs)`: moves every body with its input. After 300 ms of silence the input is released. The correction fades with a time constant of 80 ms.
  - `list(nowMs)` → `[{ id, kills, alive, state }]`, where `state = { x, y, vx, vy, facing, ground, aim, act, actT, hp, safe, gun, aimed: aim !== 0 }`, in map cells.
    - `act` falls back to `'idle'` when its `ACT_TIME` has passed.
    - `dead` stays until `sp`.
    - `hurt` lasts its stun.
    - `roll` comes from the body's `rollT`.
  - `get(id)`, `ids()`, `clear()`.
- **Prediction** (PvP spec §7):
  - On `a`:
    - `base` = the smallest `nowMs − m.ts` seen in the last 2 s, per fighter;
    - `age = min(150, max(0, (nowMs − m.ts) − base + rtt() / 2))`;
    - build a fresh body at the wire state plus `offset`: `newBody`, with `vx, vy`, `onGround = !!g`, `prevJump = !!(i & 4)`, and the roll carried over (below);
    - step it by `age` ms with input from the bits (`x = (i&2?1:0) − (i&1?1:0)`, `jump: i&4`, `down: i&8`, `run: i&16`), in steps of at most 1/60 s;
    - `corr = displayed − fresh`. If `hypot(corr.x, 2 × corr.y) > 4`, set `corr = 0` (a snap);
    - replace the body with the fresh one; facing from `f`, aim from `a`.
  - **Roll prediction**: when the state's bit 32 is on, start a roll on the fresh body (`rollT = (old body rolling ? old.rollT : 0)`, `rollDir = sign(vx) || f`) before stepping it.
  - Displayed position = body + `corr`. `corr *= exp(−dt / 0.08)` each step. Aim is smoothed over 60 ms.
  - A `dead` fighter is still stepped, with no input.

- [ ] **Step 1: Write the failing tests** (`test/fighters.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { newBody, stepBody } from '../src/arena.js';
import { createFighters } from '../src/fighters.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const kinds = levelKind(L);
const bits = (inp) => (inp.x < 0 ? 1 : 0) | (inp.x > 0 ? 2 : 0) | (inp.jump ? 4 : 0) | (inp.down ? 8 : 0) | (inp.run ? 16 : 0);

// The scripted run: right, jump onto the ═ at row 24 (cols 66–78), stand, drop through it, then turn and run left.
const script = (t) => (t < 0.2 ? { x: 1 } : t < 0.6 ? { x: 1, jump: true } : t < 0.75 ? { x: 1 } : t < 1.2 ? {} : t < 1.3 ? { down: true } : t < 1.6 ? {} : t < 2.4 ? { x: -1 } : {});
function truth() {
  const b = newBody(56.5, 27.5);
  for (let i = 0; i < 12; i++) stepBody(b, 1 / 60, {}, kinds);
  const out = [];
  for (let k = 0; k <= 180; k++) {
    const t = k / 60, inp = script(t);
    out.push({ t, x: b.x, y: b.y, vx: b.vx, vy: b.vy, g: b.onGround ? 1 : 0, onPlatform: b.onPlatform, i: bits(inp) });
    stepBody(b, 1 / 60, inp, kinds);
  }
  return out;
}
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function playback() {
  const T = truth();
  assert.ok(T.some((s) => s.onPlatform), 'the script lands on a platform');
  assert.ok(T.some((s, k) => k > 0 && T[k - 1].onPlatform && !s.g), 'and drops through it');
  // Sender: every 67 ms, plus at once on an input-bit or ground change (30 ms apart at least).
  const sends = [];
  let lastAt = -1e9, last = null;
  for (const s of T) {
    const ms = s.t * 1000;
    const urgent = last && (s.i !== last.i || s.g !== last.g);
    if ((urgent && ms - lastAt >= 30) || ms - lastAt >= 67) { sends.push({ ...s, ts: Math.round(ms), arrive: ms + 50 + rnd() * 40 }); lastAt = ms; last = s; }
  }
  sends.sort((a, b) => a.arrive - b.arrive);
  const F = createFighters({ kindAt: kinds, rtt: () => 100 });
  F.apply({ t: 'aw', fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, ...wire(sends[0]) }] }, sends[0].arrive);
  const shown = [];
  let q = 1;
  for (let ms = sends[0].arrive; ms <= 3000; ms += 1000 / 60) {
    while (q < sends.length && sends[q].arrive <= ms) F.apply({ t: 'a', id: 'b', ...wire(sends[q++]) }, ms);
    F.step(1 / 60, ms);
    const st = F.list(ms)[0].state;
    shown.push({ ms, x: st.x, y: st.y });
  }
  return { T, sends, shown };
}
const wire = (s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, f: s.vx < 0 ? -1 : 1, g: s.g, i: s.i, a: 0, ts: s.ts });

test('played back at 60 fps with 50 ms latency and jitter: smooth, close to the truth, and the jump peaks where it really did', () => {
  const { T, shown } = playback();
  const truthAt = (ms) => T[Math.min(T.length - 1, Math.max(0, Math.round(ms / (1000 / 60))))];
  for (let k = 1; k < shown.length; k++) {
    const d = Math.hypot(shown[k].x - shown[k - 1].x, shown[k].y - shown[k - 1].y);
    const v = Math.max(...[-2, -1, 0, 1, 2].map((o) => { const s = truthAt(shown[k].ms + o * 16.7); return Math.hypot(s.vx, s.vy); }));
    assert.ok(d <= v / 60 + 0.3, `frame ${k}: moved ${d.toFixed(3)} at speed ${v.toFixed(1)}`);
  }
  const changes = T.filter((s, k) => k > 0 && s.i !== T[k - 1].i).map((s) => s.t * 1000);
  for (const s of shown) {
    if (s.ms > 2900) break;
    const tr = truthAt(s.ms), since = Math.min(...changes.map((c) => (s.ms >= c ? s.ms - c : Infinity)));
    const err = Math.hypot(s.x - tr.x, s.y - tr.y);
    if (since > 400) assert.ok(err <= 0.2, `at ${s.ms.toFixed(0)} ms: ${err.toFixed(3)} off`);
    else assert.ok(err <= 1.0, `right after a change, at ${s.ms.toFixed(0)} ms: ${err.toFixed(3)} off`);
  }
  const peakTrue = Math.min(...T.filter((s) => s.t < 1).map((s) => s.y));
  const peakShown = Math.min(...shown.filter((s) => s.ms < 1150).map((s) => s.y));
  assert.ok(Math.abs(peakTrue - peakShown) <= 0.3, `peak ${peakShown} vs ${peakTrue}`);
});

const one = (F, now, o = {}) => F.apply({ t: 'aw', fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ...o }] }, now);

test('silence for 300 ms releases their input: they slow to a stop', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 30, vy: 0, f: 1, g: 1, i: 2, a: 0, ts: 0 }, 0);
  for (let ms = 0; ms < 1000; ms += 1000 / 60) F.step(1 / 60, ms);
  assert.ok(Math.abs(F.list(1000)[0].state.vx) < 0.1);
  assert.ok(F.list(1000)[0].state.x < 60.5 + 30 * 0.4, 'stopped soon after 300 ms');
});

test('an error over 4 cells snaps instead of gliding', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.step(1 / 60, 16);
  F.apply({ t: 'a', id: 'b', x: 100.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 16 }, 16);
  assert.ok(Math.abs(F.list(16)[0].state.x - 100.5) < 0.01);
});

test('an h knocks the body back at once and shows hurt for the stun', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'h', id: 'b', by: 'a', w: 'k', n: -1, d: 22, hp: 78, kx: 45, ky: -22 }, 10);
  const s = F.list(10)[0].state;
  assert.equal(s.act, 'hurt');
  assert.equal(s.hp, 78);
  F.step(1 / 60, 26);
  assert.ok(F.list(26)[0].state.x > 60.5 + 0.5);
});

test('a remote roll (bit 32) is predicted: it covers the roll\'s distance without a correction', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 48, vy: 0, f: 1, g: 1, i: 32 | 2, a: 0, ts: 0 }, 0);
  let x0 = F.list(0)[0].state.x;
  for (let ms = 0; ms <= 300; ms += 1000 / 60) F.step(1 / 60, ms);
  assert.ok(Math.abs(F.list(300)[0].state.x - x0 - 14.4) <= 1.2, `${F.list(300)[0].state.x - x0}`);
});

test('messages for unknown ids, or before aw, are ignored without throwing; the next aw rebuilds', () => {
  const F = createFighters({ kindAt: kinds });
  for (const m of [{ t: 'a', id: 'x', x: 1 }, { t: 'h', id: 'x' }, { t: 's', id: 'x' }, { t: 'k', id: 'x' }, { t: 'sp', id: 'x', x: 3, y: 4 }, { t: 'ax', id: 'x' }, { t: 'a' }, null])
    F.apply(m, 0);
  assert.deepEqual(F.list(0), []);
  one(F, 0);
  assert.equal(F.list(0).length, 1);
});

test('the offset turns wire cells into map cells', () => {
  const F = createFighters({ kindAt: (c, r) => kinds(c - 100, r - 50), offset: { x: 100, y: 50 } });
  one(F, 0);
  assert.equal(F.list(0)[0].state.x, 160.5);
  assert.equal(F.list(0)[0].state.y, 77.5);
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/fighters.test.js < /dev/null`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/fighters.js`** per Interfaces.
  - If the error test can't hold its 0.2-cell bound because of the jitter model, check the age estimate first: `base` must be the minimum over the last 2 s, so the jitter is measured above the fastest arrival.
  - Don't loosen the bounds without a ruling.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/fighters.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: remote fighters predicted with the shared physics, gliding onto corrections`.

---

### Task 11: `src/fx.js`: bullets, sparks, damage numbers, hp bars, pickups and sniper aim lines as glyphs

**Files:**
- Create: `src/fx.js`, `test/fx.test.js`

**Interfaces:**
- Consumes:
  - from `src/fight.js`: `GUNS`, `rayLength`, `bulletRange`, `bulletAt`, `bulletGlyphs`, `along`, `muzzleOf`, `absAngle`, `MAX_HP`;
  - from `src/stick.js`: `GUN_ART`.
- Produces: `createFx({ kindAt, offset = { x: 0, y: 0 }, reducedMotion = false })`.
  - `kindAt` is arena-local (`levelKind`). Positions in and out are map cells, and `offset` converts between them. It returns:
  - `shot({ id, n, x, y, angle, gun, color, mine, at })` adds a bullet:
    - `at` is in ms;
    - `n` may be null for my own bullet until the server's echo (`assign(n)`);
    - it ends at `min(rayLength, bulletRange)`, or earlier.
  - `assign(n)` gives the oldest of my bullets with a null `n` that number.
  - `hit({ n, x, y, d, at })`:
    - removes bullet `n` if any;
    - adds a spark (3 glyphs `*` `+` `·` flying out for 0.25 s in warm white `[255, 214, 140]`; in place for 0.2 s with Reduce Motion);
    - adds a damage number `-d`, rising 1 row over 0.6 s and fading (in place, with Reduce Motion), above `y − 2`.
  - `step(dt, nowMs, bodies)`: advances bullets. **My** bullets stop at the first body in `bodies` (other than me) whose hurtbox (1 × 3 around its displayed `x, y`) the bullet's motion this frame touches. They vanish there, with no spark (the server's `h` brings that). Other bullets fly to their end.
  - `glyphs(nowMs, { bodies, pickups, aims }, out = [])` → `out` with `{ x, y, ch, color, a }` in map cells, for:
    - **bullets**: `bulletGlyphs`, colour = the shooter's colour mixed 50% toward white;
    - **sparks and numbers**;
    - **hp bars**:
      - for each body with `hp < 100` that is not dead;
      - `█` per 20 hp, `░` for the rest, 5 cells, centred on the body's `x`, at `y − 3.2` (just above the name at `y − 2.2`; ruling: the spec's "above the head" is read as "above the name");
      - colour `[255, 110, 70]`;
    - **pickups** `[{ x, y, gun, there }]`:
      - the gun's `GUN_ART` glyphs, centred, at `y − 0.5` (the spot's `y` is a standing body's centre, so this is about waist height);
      - glowing warm white `[255, 236, 210]` at `a = 1`, bobbing `0.15 × sin(2π t / 1.5)` (none with Reduce Motion);
      - when taken (`there: false`), the same art as `·` dots at `a = 0.35`;
    - **sniper aim lines** `[{ id, x, y, facing, aim, color, ready }]`:
      - `·` every 2 screen units along the aim, from the sniper's muzzle to `rayLength`;
      - `a = 0.25`, or 0.5 when `ready` (the 0.3 s before the next shot);
      - colour = theirs.
  - `clear()` drops bullets, sparks and numbers.

- [ ] **Step 1: Write the failing tests** (`test/fx.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { createFx } from '../src/fx.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const fx = (o = {}) => createFx({ kindAt: levelKind(L), ...o });

test('my bullet stops at a fighter drawn on my screen, with no spark until the server says so', () => {
  const f = fx();
  f.shot({ id: 'me', n: null, x: 23.45, y: 27.2, angle: 0, gun: 'deagle', color: [255, 206, 110], mine: true, at: 0 });
  const bodies = [{ id: 'b', state: { x: 30.5, y: 27.5 } }];
  for (let ms = 16; ms <= 200; ms += 16) f.step(0.016, ms, bodies);
  assert.equal(f.glyphs(200, { bodies: [] }).filter((g) => g.ch === '•').length, 0);
});

test('a remote bullet flies to the ▓ the ray cast finds', () => {
  const f = fx();
  f.shot({ id: 'b', n: 4, x: 30.5, y: 27.2, angle: 0, gun: 'deagle', color: [120, 200, 255], mine: false, at: 0 });
  for (let ms = 16; ms <= 100; ms += 16) f.step(0.016, ms, []);
  const heads = f.glyphs(100, {}).filter((g) => g.ch === '•');
  assert.equal(heads.length, 1);
  assert.ok(heads[0].x <= 35, 'still short of the pillar at col 35');
  for (let ms = 116; ms <= 400; ms += 16) f.step(0.016, ms, []);
  assert.equal(f.glyphs(400, {}).filter((g) => g.ch === '•').length, 0, 'gone at the pillar');
});

test('a hit removes its bullet and shows a spark and a rising damage number', () => {
  const f = fx();
  f.shot({ id: 'b', n: 9, x: 60, y: 27.2, angle: 0, gun: 'deagle', color: [1, 2, 3], mine: false, at: 0 });
  f.hit({ n: 9, x: 70, y: 27.5, d: 25, at: 10 });
  const g0 = f.glyphs(10, {}), g1 = f.glyphs(500, {});
  assert.equal(g0.filter((g) => g.ch === '•').length, 0);
  assert.ok(g0.some((g) => g.ch === '*'));
  const n0 = g0.filter((g) => '-25'.includes(g.ch) && g.y < 27), n1 = g1.filter((g) => '-25'.includes(g.ch) && g.y < 27);
  assert.ok(n1[0].y < n0[0].y - 0.5, 'rises');
  assert.equal(f.glyphs(700, {}).filter((g) => g.ch === '2').length, 0, 'gone after 0.6 s');
  const still = fx({ reducedMotion: true });
  still.hit({ n: -1, x: 70, y: 27.5, d: 25, at: 0 });
  assert.equal(still.glyphs(0, {}).find((g) => g.ch === '2').y, still.glyphs(400, {}).find((g) => g.ch === '2').y);
});

test('hp bars show below full health only', () => {
  const f = fx();
  const bar = (hp) => f.glyphs(0, { bodies: [{ id: 'b', state: { x: 50, y: 20, hp, act: 'idle' } }] }).filter((g) => g.ch === '█' || g.ch === '░').map((g) => g.ch).join('');
  assert.equal(bar(100), '');
  assert.equal(bar(60), '███░░');
  assert.equal(bar(0), '░░░░░');
});

test('pickups float and bob; a taken one is a dim dotted outline', () => {
  const f = fx();
  const there = f.glyphs(0, { pickups: [{ x: 26.5, y: 17.5, gun: 'rifle', there: true }] });
  assert.equal(there.map((g) => g.ch).join(''), '═╦╤══');
  assert.notEqual(f.glyphs(375, { pickups: [{ x: 26.5, y: 17.5, gun: 'rifle', there: true }] })[0].y, there[0].y);
  const gone = f.glyphs(0, { pickups: [{ x: 26.5, y: 17.5, gun: 'rifle', there: false }] });
  assert.ok(gone.every((g) => g.ch === '·' && g.a < 0.5));
});

test('the sniper aim line: faint dots to the first ▓, brighter when the next shot is ready', () => {
  const f = fx();
  const line = (ready) => f.glyphs(0, { aims: [{ id: 'b', x: 20.5, y: 27.5, facing: 1, aim: 0, color: [9, 9, 9], ready }] }).filter((g) => g.ch === '·');
  const l = line(false);
  assert.ok(l.length >= 3);
  assert.ok(l.every((g) => g.x < 35 && Math.abs(g.a - 0.25) < 1e-9));
  assert.ok(line(true).every((g) => Math.abs(g.a - 0.5) < 1e-9));
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/fx.test.js < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement `src/fx.js`.**
  - Keep the state in arrays with plain objects; drop entries as they expire.
  - Damage-number digits are separate glyphs, one per character, centred.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/fx.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: bullets, sparks, damage numbers, hp bars, pickups and the sniper aim line as glyphs`.

---

### Task 12: The Worker: arena membership, the referee, the bullet tick and `welcome.fight`

**Files:**
- Modify: `server/gallery.js`, `server/test/server.test.js`, `.github/workflows/server.yml`

**Interfaces:**
- Consumes:
  - `createReferee`, `newFighter` (Task 8);
  - `parseLevel`, `levelHash` (Task 1);
  - from Task 9: `parseMessage`, `take`, `takeShot`, `clampMove`, `senderClock`, `sentAt`;
  - `import levelText from '../src/arena.txt';`. Wrangler bundles `.txt` as text by default; if not, add a `[[rules]] type = "Text" globs = ["**/*.txt"]` to `wrangler.toml`.
- Produces:
  - **Wire behaviour**: PvP spec §5–§6. `welcome` gains `fight: levelHash(levelText)`.
  - **Per socket**, the attachment gains `fx` (the fighter record, created at `hi`) and `clk` (`senderClock()`). The buckets gain the new kinds automatically.
  - **In memory**: `this.ref` (created lazily with `rand: Math.random`) and `this.tickTimer`.
  - **Arena broadcast**: to every socket whose attachment has `here && fx.arena`, the sender included. Senders receive their own `s`, `mm`, `h`, `k`, `sp`, `pk`, `w`. A forwarded `a` goes to the others only.
  - **Messages**:
    - `ae`:
      - if not `here`, or the `ae` bucket is empty: drop;
      - if already in the arena, `leave` first, quietly (drop the `ax`);
      - `ref.enter(fx, now)`;
      - send `aw` to the sender: `{ t: 'aw', lv: hash, you: { hp, kills, w, ammo }, pk: ref.pickups(now), fighters: [view(o) for every other arena fighter] }`;
      - broadcast `aj` to the other arena sockets.
    - `al`: `ref.leave` → broadcast the out. The `ax` goes to the others; send the `k` to everyone, the leaver included.
    - `a`:
      - drop (counting toward the flood limit) if not in the arena;
      - drop silently if dead;
      - bucket `a`;
      - `sent = sentAt(clk, ts, nowMs)`; `gap = sent − fx.sentPrev` (store `fx.sentPrev`);
      - `clampMove(fx, m, gap)`;
      - drop if the centre is inside `▓` (`levelKind(level)(floor(x), floor(y)) === SOLID`);
      - `ref.state(fx, clamped, nowS, sent / 1000)`;
      - forward `{ t: 'a', id, ...clamped }` to the other arena sockets. Only the sender's attachment needs serializing.
    - `f`:
      - drop if not in the arena, or `takeShot(buckets, fx.gun, nowMs)` fails;
      - `ref.fire` → broadcast the out;
      - start the tick if `ref.live() > 0`.
    - `m`:
      - drop if not in the arena, or the `m` bucket is empty;
      - if `fx.lastStrike === 'kick' && nowS − fx.strikeAt < 0.5`, drop (counts);
      - `ref.strike` → broadcast.
    - `pk`: bucket → `ref.pickup` → broadcast if ok.
    - `rs`: bucket → `ref.respawn` → broadcast if ok.
    - On close or error: if in the arena, `ref.leave` and broadcast (to the others).
  - **The tick**:
    - `setInterval(() => …, 33)` while `ref.live() > 0`;
    - each tick: `ref.tick(nowS, arena fighters)` → broadcast;
    - after the tick, serialize every arena attachment whose record changed (keep it simple: all arena attachments);
    - `clearInterval` when no bullets are left.
  - **Fighter records** are read from the attachments at the start of each handler and written back with `serializeAttachment` after it.
    - In-memory mutations by the referee during one handler run work on the deserialized objects. Collect `[ws, att]` pairs and serialize each one whose `fx` the referee touched. For `fire`, `strike`, `tick`, `leave` and `respawn`, serialize all the arena attachments.
- `.github/workflows/server.yml` `paths`: add `'src/fight.js'`, `'src/referee.js'`, `'src/level.js'`, `'src/stick.js'`, `'src/arena.txt'`.

- [ ] **Step 1: Write the failing server tests.** Append to `server/test/server.test.js`, reusing its `client()` and `room()` helpers. Add these helpers first:

```js
import fs from 'node:fs';
import { parseLevel, levelHash } from '../../src/level.js';
import { muzzleOf } from '../../src/fight.js';
const LEVEL_TEXT = fs.readFileSync(new URL('../../src/arena.txt', import.meta.url), 'utf8');
const LV = parseLevel(LEVEL_TEXT);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function fighter(r, name, ip) {
  const ws = client({ room: r, ip });
  await ws.opened;
  ws.send2({ t: 'hi', name });
  const w = await ws.next('welcome');
  ws.id = w.id;
  ws.send2({ t: 'ae' });
  ws.aw = await ws.next('aw');
  ws.t0 = Date.now();
  return ws;
}
const at = (ws, x, y, o = {}) => ws.send2({ t: 'a', x, y, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: Date.now() - ws.t0, ...o });
const fire = (ws, x, y = 27.5, a = 0) => { const m = muzzleOf(x, y, 1, 0, 'deagle'); ws.send2({ t: 'f', x: +m.x.toFixed(2), y: +m.y.toFixed(2), a, ts: Date.now() - ws.t0 }); };
```

Then the tests (each uses its own `room()`):

```js
test('welcome carries the level hash', async () => {
  const ws = client({ room: room() });
  await ws.opened;
  ws.send2({ t: 'hi', name: '' });
  assert.equal((await ws.next('welcome')).fight, levelHash(LEVEL_TEXT));
  ws.close();
});

test('two fighters entering get aw and aj; someone outside gets none of it', async () => {
  const r = room();
  const out = client({ room: r });
  await out.opened; out.send2({ t: 'hi', name: '' }); await out.next('welcome');
  const a = await fighter(r, 'Ann');
  assert.deepEqual(a.aw.fighters, []);
  assert.equal(a.aw.lv, levelHash(LEVEL_TEXT));
  const b = await fighter(r, 'Bo');
  assert.equal(b.aw.fighters.length, 1);
  assert.equal((await a.next('aj')).id, b.id);
  await sleepMs(300);
  assert.ok(!out.inbox.some((m) => ['aw', 'aj', 'a', 's', 'h'].includes(m.t)), JSON.stringify(out.inbox));
  [a, b, out].forEach((w) => w.close());
});

test('a deagle shot hits a standing, unprotected target for 25; a ▓ in the way stops it; a protected target is not hit', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(250);
  fire(a, 20.5);
  await assert.rejects(b.next('h', 600), 'B is protected for 1.5 s after entering');
  await sleepMs(1300);
  fire(a, 20.5);
  const h = await b.next('h', 2000);
  assert.deepEqual([h.id, h.by, h.d, h.hp], [b.id, a.id, 25, 75]);
  at(a, 30.5, 27.5); at(b, 45.5, 27.5);
  await sleepMs(500);
  fire(a, 30.5);
  await assert.rejects(b.next('h', 600), 'the pillar is in the way');
  a.close(); b.close();
});

test('five shots within 100 ms give at most two bullets', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  at(a, 60.5, 27.5);
  await sleepMs(100);
  for (let k = 0; k < 5; k++) fire(a, 60.5);
  await sleepMs(400);
  assert.ok(a.inbox.filter((m) => m.t === 's').length <= 2);
  a.close();
});

test('four deagle hits pop: k with kills 1; rs at 1 s is ignored, at 2 s gives sp at a marked spawn', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await sleepMs(1600);
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(150);
  for (let k = 0; k < 4; k++) { fire(a, 20.5); await sleepMs(450); }
  const k = await a.next('k', 2000);
  assert.deepEqual([k.id, k.by, k.kills], [b.id, a.id, 1]);
  await sleepMs(1000);
  b.send2({ t: 'rs' });
  await assert.rejects(b.next('sp', 400));
  await sleepMs(800);
  b.send2({ t: 'rs' });
  const sp = await b.next('sp', 2000);
  assert.ok(LV.spawns.some((s) => s.x === sp.x && s.y === sp.y));
  a.close(); b.close();
});

test('a teleporting state is clamped', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  at(a, 20.5, 27.5);
  await sleepMs(100);
  at(a, 150.5, 27.5);
  const seen = await (async () => { for (;;) { const m = await b.next('a', 2000); if (m.x > 20.5) return m; } })();
  assert.ok(seen.x < 40, `seen at ${seen.x}`);
  a.close(); b.close();
});

test('leaving within 3 s of a hit gives the hitter the kill, fled', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await sleepMs(1600);
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(150);
  fire(a, 20.5);
  await b.next('h', 2000);
  b.send2({ t: 'al' });
  const k = await a.next('k', 2000);
  assert.deepEqual([k.id, k.by, k.kills, k.fled], [b.id, a.id, 1, 1]);
  assert.equal((await a.next('ax')).id, b.id);
  a.close(); b.close();
});

test('a, f and m from someone not in the arena are dropped', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  const o = client({ room: r });
  await o.opened; o.send2({ t: 'hi', name: '' }); await o.next('welcome');
  o.send2({ t: 'a', x: 30.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0 });
  o.send2({ t: 'f', x: 33, y: 27.2, a: 0, ts: 0 });
  o.send2({ t: 'm', k: 'p', ts: 0 });
  await sleepMs(300);
  assert.ok(!a.inbox.some((m) => m.t === 'a' || m.t === 's' || m.t === 'mm'));
  a.close(); o.close();
});

test('a ground kick outside a combo comes back as a punch', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  at(a, 60.5, 27.5);
  await sleepMs(100);
  a.send2({ t: 'm', k: 'k', ts: Date.now() - a.t0 });
  assert.equal((await a.next('mm')).k, 'p');
  a.close();
});

test('pickups: within reach gives pk and w (rifle, 40); a second claim is refused; back after 10 s', async () => {
  const r = room();
  const p = LV.pickups.find((q) => q.gun === 'rifle');
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  at(a, p.x, p.y); at(b, p.x + 0.5, p.y);
  await sleepMs(150);
  a.send2({ t: 'pk', n: p.n });
  assert.deepEqual(await a.next('w'), { t: 'w', id: a.id, w: 'r', ammo: 40 });
  b.send2({ t: 'pk', n: p.n });
  await assert.rejects(b.next('w', 500));
  await sleepMs(9600);
  b.send2({ t: 'pk', n: p.n });
  assert.equal((await b.next('w', 2000)).id, b.id);
  a.close(); b.close();
});

test('40 rifle shots, then the next s carries w d, after a w message', async () => {
  const r = room();
  const p = LV.pickups.find((q) => q.gun === 'rifle');
  const a = await fighter(r, 'A');
  at(a, p.x, p.y);
  await sleepMs(150);
  a.send2({ t: 'pk', n: p.n });
  await a.next('w');
  for (let k = 0; k < 41; k++) { const m = muzzleOf(p.x, p.y, 1, 0, 'rifle'); a.send2({ t: 'f', x: +m.x.toFixed(2), y: +m.y.toFixed(2), a: 0, ts: Date.now() - a.t0 }); await sleepMs(120); }
  await sleepMs(300);
  const ss = a.inbox.filter((m) => m.t === 's');
  assert.equal(ss.filter((m) => m.w === 'r').length, 40);
  assert.equal(ss.at(-1).w, 'd');
  assert.ok(a.inbox.some((m) => m.t === 'w' && m.w === 'd'));
  a.close();
});

test('a shot reaching a target inside its roll\'s dodge window does not hit', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await sleepMs(1600);
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(150);
  at(b, 30.5, 27.5, { i: 32 });
  await sleepMs(60);
  fire(a, 20.5);
  await assert.rejects(b.next('h', 500));
  a.close(); b.close();
});
```

The existing tests (p, emotes, chat) must keep passing unchanged.

- [ ] **Step 2: Run the tests and watch them fail.** Run: `cd server && npm test < /dev/null`. Expected: the new tests FAIL (no `fight`, no `aw`); the old ones PASS.

- [ ] **Step 3: Implement `server/gallery.js`** per Interfaces, and update `server.yml`.
  - Keep `KIND` for the old messages, and handle the arena messages in their own branch.

- [ ] **Step 4: Run the tests and see them pass.** Run: `cd server && npm test < /dev/null`, then `npm test < /dev/null` from the root. Expected: PASS.
  - Also check the bundle is under the free plan's limits: `cd server && npx wrangler deploy --dry-run --outdir /tmp/wd < /dev/null`. This builds without deploying. Expected: it succeeds; report the bundle size.

- [ ] **Step 5: Commit**: `Arena PvP: the Worker runs the fight: arena membership, the referee, the bullet tick and the level hash`.

---

### Task 13: `src/pvp.js`: my fight, the dummy and offline play, and the world hooks (mouse facing, camera shake)

**Files:**
- Create: `src/pvp.js`, `test/pvp.test.js`
- Modify: `src/world.js` (`aimFacing`, `shake`)

**Interfaces:**
- Consumes:
  - from `arenaTicker` (Task 5): `fighters.js` (10), `fx.js` (11), `referee.js` (8), `fight.js` (3);
  - from `arena.js` (2): `knock`, `rolling`;
  - from `level.js` (1): `levelKind`.
- Produces (`src/world.js`):
  - `world.aimFacing` (−1, 1 or 0): when non-zero in the side view, `stepSide` sets `p.facing` from it instead of from `vx`.
  - `world.shake = { until, amp }` (seconds of world time):
    - `moveCamera` adds a shake offset (a random-free wobble: `amp × sin(97t)`, `amp × cos(89t) / 2`, scaled down linearly to `until`);
    - it removes last frame's offset before the spring, so the spring isn't disturbed;
    - none with Reduce Motion.
- Produces (`src/pvp.js`):

```js
createPvp({ world, map, level, send = () => false, rtt = () => 100, colorOf = (id) => [200, 200, 200], nameOf = (id) => '', onNote = () => {}, onFeed = () => {}, reducedMotion = false, rand = Math.random })
```

  It returns:
  - `enter(nowMs, online)`: called once the side view is active.
    - `online` means the connection is live and `fightOk`.
    - It resets my fight (full hp, protected 1.5 s, deagle), starts the ticker clock (`ts = nowMs − enteredAt`), and sends `ae` when online.
    - It shows the dummy unless other fighters are known.
  - `leave(nowMs)`:
    - sends `al` when online;
    - clears the fighters, fx and my acts;
    - no-op if not entered.
  - `setOnline(online, nowMs)`:
    - true → false (the connection dropped): clear the remote fighters and fx, reset my health, show the dummy after 2 s;
    - false → true while inside: send `ae`.
  - `onMessage(m, nowMs)`: the arena messages, for me and others. Fighters get them via `fighters.apply`. For me:
    - `aw.you`: hp, kills, gun, ammo;
    - `w`: gun and ammo;
    - `h`:
      - hp;
      - `knock(world.player, kx, ky, stun)`;
      - act `hurt`;
      - shake 0.15 s / 0.4 if `w === 'k'`;
    - `k` (me): dead, `onNote('popped by ' + (nameOf(by) || 'someone'))`, shake;
    - `sp` (me): teleport `world.player` to `sp + offset`, alive, protected.
    - For everyone:
      - `k` adds a feed line via `onFeed(text)`, built from `nameOf`: "Ann popped Bo" or "Bo fled from Ann";
      - `h` adds an `fx.hit` at the target;
      - `s` (not mine) adds an `fx.shot`; for mine, `fx.assign(n)`;
      - `pk` marks the pickup taken until `nowMs + at`;
      - `aw.pk` sets every pickup.
    - The dummy is hidden whenever `fighters.ids().length > 0`. It pops quietly, with no feed line.
  - `control(inp, nowMs)` → the body input for `world.step`.
    - `inp = { x, y, run, jump, down, fire, strikes, roll, aimUp, aimDown, mouse: { on, x, y } | null }`, with `mouse` in map cells.
    - Dead, away or not entered: returns `{ x: 0, y: 0, run: false, jump: false, down: false }`.
    - Otherwise:
      - **aim**: from `pointAim(shoulder, mouse, facing)` when `mouse.on`, which also sets `world.aimFacing`; else `keyAim(aimUp, aimDown)` and `world.aimFacing = 0`;
      - **fire**: when `fire`, not rolling, the cooldown has passed, and my bullets in flight are under the gun's max:
        - add the bullet to fx (`mine`);
        - act `shoot` (`actT` restarts);
        - online: send `{ t: 'f', x, y, a, ts }` in arena-local cells, at the muzzle;
        - offline: `localRef.fire(meRec, …)`, handling its out exactly like server messages;
        - when online and the dummy is shown, also run the local referee's fire against the dummy, applying only the dummy's `h`/`k` from it.
      - **strikes**: for each strike press, when not rolling and `strikeReady`:
        - predict the kind with `nextStrike` (`inAir = !world.player.onGround`);
        - act `punch` or `kick`;
        - send `m` (online), or run `localRef.strike` (offline, and against the dummy as above).
      - **roll**: passes through as `roll`, but not while dead. A roll stops fire for its length.
      - Returns `{ x, y, run, jump, down, roll }`.
  - `frame(dt, nowMs)`, after `world.step`:
    - `fighters.step`; the dummy body steps with no input; `fx.step`;
    - offline: `localRef.tick`;
    - online: the ticker sends `a` (urgent on knock or roll start);
    - pickups touched: `pk` at most every 0.5 s (online) or `localRef.pickup` (offline);
    - dead for 2 s: send `rs` (online, then again every 1 s until `sp`) or `localRef.respawn` (offline);
    - the dummy respawns at its own spot 2 s after popping.
  - `bodies(nowMs)` → `[{ id, state, me, dummy, kills }]`, for me, the remote fighters and the dummy, with `state` per the stickman spec (map cells).
    - My `state.aimed = mouse aim on || aimUp || aimDown`.
    - My `act` comes from my last act and its `ACT_TIME`; `roll` while the body is rolling.
  - `glyphs(nowMs, out)` → fx glyphs (bullets, sparks, numbers, hp bars for every body below 100, pickups, aim lines for everyone holding the sniper).
  - `hud(nowMs)` → `{ hp, gun, ammo, alive, showBoard, board: [{ id, kills, me }] }`:
    - `board` is the top 5 by kills, plus me if not in it;
    - `showBoard` when at least one other fighter is in the arena.
  - `me` (my record, for tests and hooks), `dummy` (its body and record), `fighters`, `fx`, `online`, `entered`.
- The dummy: at local `(80.5, 27.5)`, facing east (1), grey `[150, 150, 150]`, label `dummy`, holding a deagle it never fires.
- Arena-local ↔ map: `off = { x: map.arena.x + 1, y: map.arena.y + 1 }`.

- [ ] **Step 1: Write the failing tests** (`test/pvp.test.js`). Build an arena map the way `test/world.test.js` does (fixture plus `parseLevel(src/arena.txt)`), and drive it with `createWorld` + `step`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData } from '../src/data.js';
import { buildLayout } from '../src/layout.js';
import { parseLevel } from '../src/level.js';
import { createWorld, step, teleport } from '../src/world.js';
import { createPvp } from '../src/pvp.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const level = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const data = indexData(fixture, ['IMG_1003']);
const map = buildLayout(data, { name: 'X' }, { arena: { photo: data.byId.get('IMG_1003'), level } });
const A = map.arena, off = { x: A.x + 1, y: A.y + 1 };
const IN = { x: 0, y: 0, run: false, jump: false, down: false, fire: false, strikes: 0, roll: 0, aimUp: false, aimDown: false, mouse: null };

function setup({ online = false, at = { x: 70.5, y: 27.5 } } = {}) {
  const world = createWorld(map);
  teleport(world, off.x + at.x, off.y + at.y);
  const sent = [], notes = [], feed = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, onNote: (t) => notes.push(t), onFeed: (t) => feed.push(t), rand: () => 0.5 });
  let now = 0;
  pvp.enter(now, online);
  const frames = (n, inp = {}) => { for (let k = 0; k < n; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control({ ...IN, ...inp }, now)); pvp.frame(1 / 60, now); } };
  return { world, pvp, sent, notes, feed, frames, get now() { return now; } };
}

test('offline: the dummy stands at column 80 on the yellow line, facing the door', () => {
  const { pvp } = setup();
  const d = pvp.bodies(0).find((b) => b.dummy);
  assert.equal(d.state.x, off.x + 80.5);
  assert.equal(d.state.y, off.y + 27.5);
  assert.equal(d.state.facing, 1);
});

test('offline: shooting the dummy (J held) costs it 25 a hit, knocks it back, pops it, and it comes back 2 s later', () => {
  const s = setup();
  s.frames(15);
  s.frames(1, { fire: true });
  s.frames(30);
  const d1 = s.pvp.bodies(s.now).find((b) => b.dummy);
  assert.equal(d1.state.hp, 75);
  assert.ok(d1.state.x > off.x + 80.5, 'knocked back');
  for (let k = 0; k < 6 && s.pvp.bodies(s.now).find((b) => b.dummy).state.act !== 'dead'; k++) { s.frames(1, { fire: true }); s.frames(30); }
  assert.equal(s.pvp.bodies(s.now).find((b) => b.dummy).state.act, 'dead');
  s.frames(130);
  const back = s.pvp.bodies(s.now).find((b) => b.dummy);
  assert.equal(back.state.act === 'dead', false);
  assert.equal(back.state.hp, 100);
  assert.equal(s.feed.length, 0, 'kills on the dummy are not in the feed');
});

test('held fire keeps the deagle\'s rate at any frame rate (at most one shot per 0.4 s)', () => {
  for (const fps of [20, 60, 144]) {
    const s = setup({ online: true });
    for (let k = 0; k < fps * 2; k++) { s.frames(0); }
    const world = s.world;
    let now = s.now;
    for (let k = 0; k < fps * 2; k++) { now += 1000 / fps; step(world, 1 / fps, s.pvp.control({ ...IN, fire: true }, now)); s.pvp.frame(1 / fps, now); }
    const shots = s.sent.filter((m) => m.t === 'f');
    assert.ok(shots.length <= 6 && shots.length >= 4, `${fps} fps: ${shots.length}`);
  }
});

test('no shooting or striking while rolling', () => {
  const s = setup();
  s.frames(10);
  s.frames(1, { roll: 1 });
  s.frames(5, { fire: true, strikes: 1 });
  assert.equal(s.pvp.fx.glyphs(s.now, {}).filter((g) => g.ch === '•').length, 0);
  assert.notEqual(s.pvp.bodies(s.now).find((b) => b.me).state.act, 'punch');
});

test('offline: walking into the sniper pickup gives the sniper; its aim line shows', () => {
  const p = level.pickups.find((q) => q.gun === 'sniper');
  const s = setup({ at: { x: p.x - 3, y: p.y } });
  s.frames(40, { x: 1 });
  assert.equal(s.pvp.me.gun, 'sniper');
  assert.equal(s.pvp.me.ammo, 5);
  assert.ok(s.pvp.glyphs(s.now, []).filter((g) => g.ch === '·').length >= 3);
});

test('online: enter sends ae; moving sends a (arena-local); J sends f from the muzzle; K sends m', () => {
  const s = setup({ online: true });
  assert.deepEqual(s.sent[0], { t: 'ae' });
  s.frames(20, { x: 1 });
  const a = s.sent.find((m) => m.t === 'a');
  assert.ok(a && a.x > 60 && a.x < 90 && a.y > 20 && a.y < 30, JSON.stringify(a));
  s.frames(1, { fire: true });
  assert.equal(s.sent.filter((m) => m.t === 'f').length, 1);
  s.frames(1, { strikes: 1 });
  assert.deepEqual(s.sent.find((m) => m.t === 'm').k, 'p');
});

test('online: h for me lowers hp and knocks me back; k pops me with a note; rs after 2 s; sp puts me at the spawn', () => {
  const s = setup({ online: true });
  s.pvp.onMessage({ t: 'aw', lv: 'x', you: { hp: 100, kills: 0, w: 'd', ammo: -1 }, pk: [], fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 }] }, s.now);
  s.frames(5);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'k', n: -1, d: 22, hp: 78, kx: 45, ky: -22 }, s.now);
  assert.equal(s.pvp.me.hp, 78);
  s.frames(1);
  assert.ok(s.world.player.vx > 30);
  s.pvp.onMessage({ t: 'k', id: 'me', by: 'b', kills: 1 }, s.now);
  assert.equal(s.notes.at(-1), 'popped by someone');
  assert.equal(s.feed.length, 1);
  s.frames(110);
  assert.ok(!s.sent.some((m) => m.t === 'rs'));
  s.frames(20);
  assert.ok(s.sent.some((m) => m.t === 'rs'));
  const sp = level.spawns[0];
  s.pvp.onMessage({ t: 'sp', id: 'me', x: sp.x, y: sp.y }, s.now);
  assert.equal(s.world.player.x, off.x + sp.x);
});
```

  The test uses `id: 'me'`. The real id is the welcome's `id`, so pass `myId: () => 'me'` in `createPvp`'s options (add `myId` to the Interfaces list).

```js
test('when a real fighter enters, the dummy pops quietly; alone again, it comes back', () => {
  const s = setup({ online: true });
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
  s.pvp.onMessage({ t: 'aj', id: 'b', hp: 100, kills: 0 }, s.now);
  s.pvp.onMessage({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0 }, s.now);
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy));
  assert.equal(s.feed.length, 0);
  s.pvp.onMessage({ t: 'ax', id: 'b' }, s.now);
  s.frames(5);
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
});

test('the connection drops mid-fight: fighters cleared, health reset, the dummy after 2 s; reconnecting sends ae again', () => {
  const s = setup({ online: true });
  s.pvp.onMessage({ t: 'aj', id: 'b', hp: 100, kills: 0 }, s.now);
  s.pvp.onMessage({ t: 'h', id: 'me', by: 'b', w: 'd', n: 1, d: 25, hp: 75, kx: 10, ky: 0 }, s.now);
  s.pvp.setOnline(false, s.now);
  assert.equal(s.pvp.fighters.ids().length, 0);
  assert.equal(s.pvp.me.hp, 100);
  s.frames(60);
  assert.ok(!s.pvp.bodies(s.now).some((b) => b.dummy), 'not yet');
  s.frames(70);
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
  const before = s.sent.filter((m) => m.t === 'ae').length;
  s.pvp.setOnline(true, s.now);
  assert.equal(s.sent.filter((m) => m.t === 'ae').length, before + 1);
});

test('a fight-hash mismatch is offline: nothing is sent, the dummy is there', () => {
  const s = setup({ online: false });
  s.frames(20, { x: 1, fire: true });
  assert.equal(s.sent.length, 0);
  assert.ok(s.pvp.bodies(s.now).some((b) => b.dummy));
});

test('going away and coming back: al once, ae once, nothing held', () => {
  const s = setup({ online: true });
  s.frames(5, { fire: true, x: 1 });
  s.pvp.leave(s.now);
  s.pvp.leave(s.now);
  assert.equal(s.sent.filter((m) => m.t === 'al').length, 1);
  s.pvp.enter(s.now, true);
  const n = s.sent.length;
  s.frames(30);
  assert.ok(!s.sent.slice(n).some((m) => m.t === 'f'), 'no fire carried over');
  assert.equal(s.sent.filter((m) => m.t === 'ae').length, 2);
});

test('messages for unknown ids, or before aw, never throw', () => {
  const s = setup({ online: true });
  for (const m of [{ t: 'h', id: 'zz', hp: 3 }, { t: 'k', id: 'zz', by: 'yy', kills: 2 }, { t: 's', id: 'zz', n: 1, x: 1, y: 1, a: 0, w: 'd' }, { t: 'sp', id: 'zz', x: 1, y: 1 }, { t: 'pk', id: 'zz', n: 9, at: 10 }, { t: 'w', id: 'zz', w: 'q' }])
    s.pvp.onMessage(m, s.now);
  s.frames(5);
});

test('the mouse turns you to face the cursor and aims at it', () => {
  const s = setup();
  s.frames(5);
  s.frames(1, { mouse: { on: true, x: s.world.player.x - 10, y: s.world.player.y - 5 } });
  assert.equal(s.world.player.facing, -1);
  const me = s.pvp.bodies(s.now).find((b) => b.me).state;
  assert.ok(me.aim < -0.5 && me.aimed);
});
```

  In `test/world.test.js`, add:

```js
test('aimFacing overrides facing in the side view; a shake moves the camera and then settles back', () => {
  const w = createWorld(amap);
  teleport(w, A.entry.x - 20.5, A.floorY - 1.5);
  w.aimFacing = 1;
  for (let i = 0; i < 20; i++) step(w, 1 / 60, { ...SIDE_IDLE, x: -1 });
  assert.equal(w.player.facing, 1);
  for (let i = 0; i < 60; i++) step(w, 1 / 60, SIDE_IDLE);
  const cx = w.cam.x;
  w.shake = { until: w.t + 0.15, amp: 0.4 };
  step(w, 1 / 60, SIDE_IDLE);
  assert.notEqual(w.cam.x, cx);
  for (let i = 0; i < 60; i++) step(w, 1 / 60, SIDE_IDLE);
  assert.ok(Math.abs(w.cam.x - cx) < 1e-6);
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/pvp.test.js test/world.test.js < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Keep `pvp.js` focused. It's glue over the pure modules: every rule decision calls `fight.js` or the referee, never a copy of a number.
  - Expected size is around 350 lines. If it grows past 450, move the offline/dummy part into `src/practice.js` and record a ruling.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test test/pvp.test.js test/world.test.js < /dev/null`, then `npm test < /dev/null`. Expected: PASS.

- [ ] **Step 5: Commit**: `Arena PvP: pvp.js runs my fight: controls, acts, the dummy, offline rules and server messages`.

---

### Task 14: Drawing the stickmen in both renderers: `figures.js`, the outlined figure layer, `pointAt`, and side-view bodies

**Files:**
- Create: `src/render/figures.js`, `test/figures.test.js`
- Modify: `src/render/canvas.js`, `src/render/gl.js`, `src/render/shaders.js`, `src/main.js` (side-view bodies only; Task 15 does the PvP wiring), `e2e/run.mjs`

**Interfaces:**
- Consumes:
  - `stickPose`, `createMotionMemory` (Tasks 4, 7);
  - `peerColor`, and peers' derived motion (Task 5);
  - `C.player`.
- Produces:
  - **`src/render/figures.js`**: `figureGlyphs(bodies, opts, out = [])` → instances `{ x, y, ch, color, a, bold, strip }`. `(x, y)` is the glyph's centre in map cells.
    - **`bodies`**: `[{ id, state, color, name, say, emote, emoteAge, alpha = 1, me, label }]`.
    - **`opts`**: `{ t, reducedMotion, phone, view: { left, top, cols, rows }, ceiling, memory }`.
    - **Bodies are skipped** if:
      - `x` or `y` isn't finite;
      - or they are more than 3 cells outside the view.
    - **Draw order**: others first, then `me`, then all labels.
    - **Figure glyphs**:
      - `bold: true`;
      - colour by tone: `body` is the body's colour, `flash` is white, `fx` is `[255, 214, 140]`;
      - `a = glyph.a × alpha`.
    - **Labels** (`bold: false`), centred on the body's fractional `x`:
      - **rows**:
        - name at `y − 2.2`;
        - chat at `y − 3.3`;
        - emote at `y − 4.4` with chat, else `y − 3.3`, plus the lift as in `peerEntities`;
        - `label` (e.g. `dummy`) where the name goes;
      - **near the ceiling**: if the top of the stack is above `ceiling`, the stack flips below the feet (`y + 2.2`, `y + 3.3`, …);
      - **phone names**: names over 12 characters become 11 plus `…` when `phone`;
      - **chat strips**: chat cells get `strip: true` instances first, covering the text plus one cell each side, colour `[7, 8, 11]`, `a = 0.6`;
      - **your own figure** has no name;
      - **dead bodies**: the name fades with the pieces. Use the dead pose's alpha: 1 until 1.4, then down to 0 at 2.0.
  - **Renderers**: each has `drawFigures(list)` called inside `draw(world)` after the platforms (and after `world.entities`), drawing `world.figures || []` in list order.
    - **Canvas**:
      - a sprite cache keyed `ch|r,g,b|bold`; each sprite is a small canvas `(cw + 2o) × (ch + 2o)` device pixels, with the outline baked in (`strokeText`, `lineWidth = 2o`, `[7, 8, 11]` at 0.9, then `fillText`);
      - `o = max(2, round(0.14 × cw × dpr))`;
      - a strip is a `fillRect`;
      - `drawImage` at the pixel-snapped position with `globalAlpha = a`;
      - the cache is cleared on resize.
    - **GL**:
      - a figure atlas (`LINEAR`) holding the bold ASCII range plus `═╦╤°♥★…`, and the regular printable ASCII for labels, each stored as its fill and its outline (dilated by `o`);
      - a figure program whose instance has `x, y, glyph, r, g, b, a`;
      - two instanced passes: the outline glyphs in `[7, 8, 11]` at 0.9 × a, then the fills; strips as quads with a blank glyph;
      - rebuilt on resize and on context restore.
    - Both get `pointAt(world, px, py)` → `{ x, y }` fractional map cells: `cellAt` without the floors.
  - **The side-view HUD scrim** (the `.hud` background) and phone pad fills are Task 15's.
  - **`src/main.js`**, side view only:
    - stop pushing the `@` and `peerEntities` for people inside the arena;
    - build `world.bodies`: me (amber, `state` from `world.player`: `{ x, y, vx, vy, facing, ground: onGround, act: 'idle', gun: 'deagle' }` until Task 15) and each live peer inside the arena (state from derived motion, colour `peerColor`, name, chat, emote);
    - `world.figures = figureGlyphs(world.bodies, …)`;
    - in the top-down view, `world.figures = []`, and the `@` stays;
    - `__ascii.pose(state)` (localhost only) pins my state's fields until called with `null`;
    - `?bots=30` (localhost only) adds 30 local bodies cycling through every act.
- **Stickman spec §8 e2e**: add these to `e2e/run.mjs` as checks.
  - Screenshots with each renderer at desktop size and at 852 × 393 with touch, using `__ascii.pose` with `{ x, y }` kept where the player is:
    - idle, mid-run, rise, fall;
    - shoot at 0, −π/4, π/4, −π/2;
    - punch at 0.1, kick at 0.15, hurt at 0.05;
    - dead at 0.3 and 1.5;
    - respawn at 0.2.
  - Assertions on those screenshots:
    - amber pixels inside the body's 2.1 × 3-cell area;
    - placed over the brightest part of the photo, dark outline pixels (luminance < 40) in a ring around the amber;
    - top-down, the `@` is still drawn.
  - **Smoothness**: run for 1 s, recording the centre of the amber pixels each frame. It only moves one way, and at least half the steps are not a whole number of cells.
  - **`?bots=30`**: a screenshot, with the frame time logged.
  - No page errors.

- [ ] **Step 1: Write the failing unit tests** (`test/figures.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureGlyphs } from '../src/render/figures.js';
import { createMotionMemory } from '../src/stick.js';

const view = { left: 0, top: 0, cols: 150, rows: 40 };
const body = (o = {}) => ({ id: 'b', state: { x: 50, y: 20, vx: 0, vy: 0, facing: 1, ground: true, act: 'idle', actT: 0, gun: 'deagle' }, color: [120, 200, 255], name: 'Ann', ...o });
const run = (bodies, o = {}) => figureGlyphs(bodies, { t: 0, view, ceiling: 1, memory: createMotionMemory(), ...o });

test('a body becomes bold glyphs in its colour with its name centred above the head', () => {
  const g = run([body()]);
  const fig = g.filter((x) => x.bold);
  assert.ok(fig.length >= 6 && fig.every((x) => x.color[2] === 255 || x.a === 0));
  const name = g.filter((x) => !x.bold && Math.abs(x.y - (20 - 2.2)) < 1e-9).map((x) => x.ch).join('');
  assert.equal(name, 'Ann');
});

test('labels come after every figure; my own figure has no name', () => {
  const g = run([body({ id: 'me', me: true, name: '' }), body({ id: 'b', state: { ...body().state, x: 60 } })]);
  const lastFig = g.map((x) => x.bold).lastIndexOf(true), firstLabel = g.findIndex((x) => !x.bold);
  assert.ok(firstLabel > lastFig);
});

test('chat sits above the name with a dark strip one cell wider each side; near the ceiling the stack flips below the feet', () => {
  const g = run([body({ say: 'hi' })]);
  const strips = g.filter((x) => x.strip);
  assert.equal(strips.length, 4);
  assert.ok(strips.every((x) => Math.abs(x.y - (20 - 3.3)) < 1e-9 && x.a === 0.6));
  const high = run([body({ say: 'hi', state: { ...body().state, y: 4 } })], { ceiling: 1 });
  assert.ok(high.filter((x) => !x.bold && !x.strip).every((x) => x.y > 4));
});

test('phones cut long names to 11 characters and …', () => {
  const g = run([body({ name: 'abcdefghijklmno' })], { phone: true });
  assert.equal(g.filter((x) => !x.bold && !x.strip).map((x) => x.ch).join(''), 'abcdefghijk…');
});

test('bodies off screen or with bad coordinates are skipped', () => {
  assert.equal(run([body({ state: { ...body().state, x: 400 } })]).length, 0);
  assert.equal(run([body({ state: { ...body().state, y: NaN } })]).length, 0);
});

test('thirty bodies cost well under 2 ms', () => {
  const bodies = Array.from({ length: 30 }, (_, i) => body({ id: `b${i}`, say: 'hello there', state: { ...body().state, x: 5 + i * 4, vx: 30 } }));
  const memory = createMotionMemory();
  for (let k = 0; k < 50; k++) figureGlyphs(bodies, { t: k / 60, view, ceiling: 1, memory });
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 100; k++) figureGlyphs(bodies, { t: k / 60, view, ceiling: 1, memory });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
  assert.ok(ms < 1, `${ms.toFixed(3)} ms a frame`);
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `node --test test/figures.test.js < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement**:
  1. `figures.js`.
  2. The canvas figure layer and `pointAt`.
  3. The GL figure atlas, program and passes, and `pointAt`.
  4. `main.js` side-view bodies and the two hooks.
  5. The e2e checks.
  - Follow the existing renderer code's patterns: `pushGlyph`, `drawGlyphs`, `buildAtlas`.
  - Let the GL figure pass reuse `glyphVao` with its own instance buffer and attribute layout, in a second VAO.

- [ ] **Step 4: Run the tests and see them pass**, then look at the result.
  - `node --test test/figures.test.js < /dev/null`, then `npm test < /dev/null`: PASS.
  - `node e2e/run.mjs < /dev/null` (Bash timeout 560000): all checks PASS, old and new.
  - Open the new screenshots in `e2e/shots/` with the Read tool. Look at them, in both renderers, desktop and phone:
    - the figure reads as a stick figure;
    - the outline shows over the bright poster;
    - names sit above heads.
  - Fix what looks wrong before committing. Name the files you looked at in your report.
  - Also run `node e2e/editor.mjs < /dev/null` and `node e2e/multiplayer.mjs < /dev/null`.
  - `multiplayer.mjs` may assert `@` glyphs for people in the arena. If an existing check expects an `@` inside the arena, update it to the stickman (stickman spec §8): B sees A as a stickman in A's colour with A's name above the head; A's chat shows above A's name.

- [ ] **Step 5: Commit**: `Arena PvP: stickmen in both renderers: an outlined figure layer, labels over heads, pointAt`.

---

### Task 15: Wiring the fight into the page: `main.js`, the HUD, the pad, notes, going away, and `ARENA.pvp`

**Files:**
- Modify: `src/main.js`, `index.html`, `src/style.css`, `src/config.js`

**Interfaces:**
- Consumes:
  - `createPvp` (Task 13);
  - `createInput` with `fire`, `takeStrikes`, `takeRoll`, `mouse` (Task 6);
  - `createLive` with `fightHash`, `onArena`, `inArena`, `fightOk`, `leftArena` (Task 5);
  - `levelHash` (Task 1);
  - `figureGlyphs` and `pointAt` (Task 14).
- Produces (the page):
  - **`config.js`**: `ARENA = { enabled: true, photo: 'dscf9139', pvp: true }`. With `pvp: false`, none of the below happens and the arena is as in Task 14.
  - **Lifecycle**:
    - `pvp.enter(now, live && live.state === 'live' && live.fightOk)` once the side view is active, at the end of the tilt or on a teleport in;
    - `pvp.leave(now)` when the tilt out starts, and when a photo, the map or the grid opens, or the tab hides;
    - `pvp.enter` again when they close or the tab shows, if still in the side view;
    - `live.leftArena()` after leaving.
  - **Connection**: `live`'s `onState` and welcome feed `pvp.setOnline(…)`. `onArena(m)` → `pvp.onMessage(m, performance.now())`.
  - **Input**:
    - `createInput(stage, { …, arena: () => world.mode === 'side' })`;
    - each frame in the side view, compose `inp`:
      - `fire`, `strikes: input.takeStrikes()`, `roll: input.takeRoll()`;
      - `aimUp`: jump keys held, `aimDown`: drop held;
      - `mouse`: `input.mouse.on ? renderer.pointAt(world, px, py) : null`;
    - pass `pvp.control(inp, now)` to `step` instead of `input.state()`;
    - after `step`, call `pvp.frame(dt, now)`.
  - **Bodies**:
    - `world.bodies` = `pvp.bodies(now)` mapped with colour (me: `C.player`; the dummy: `[150, 150, 150]`, `label: 'dummy'`; others: `peerColor`) and names, chat and emotes from `live.peers`;
    - plus `p`-only people inside the arena who aren't fighters (old clients, or no fight), from Task 14's path;
    - then `world.figures = figureGlyphs(…)` followed by `pvp.glyphs(now)`.
  - **HUD** (DOM), `index.html`:

```html
<div class="fight" id="fight" hidden aria-hidden="true">
  <div class="fight-hp" id="fight-hp"></div>
  <ol class="fight-board" id="fight-board"></ol>
  <ol class="fight-feed" id="fight-feed"></ol>
</div>
```

    - `#fight-hp`: `hp ██████████ 100`. Each `█` is 10 hp, with `░` for the rest. When holding a pickup gun, ` · rifle 32` (or `sniper 4`) follows.
    - `#fight-board`: up to 5 rows, plus me if outside the top 5; 3 on a phone. Each row is `● name kills`, with the `●` in the person's colour; "you" for me, "someone" for no name.
    - `#fight-feed`: the last 3 lines from `onFeed`, each removed after 4 s. Each line also goes to the polite caption (`captionEl.setAttribute('aria-live', 'polite')` + `note`).
    - The box shows only in the side view. The board and feed show only when `hud.showBoard`.
    - CSS: `position: fixed; top: 48px; right: 16px; pointer-events: none;`, in the HUD font and colours.
  - **Notes**:
    - on the first entry per visit on a keyboard device (`!touch`): "J shoot · K hit · mouse aims", for 4 s;
    - `onNote` texts, for 3 s.
  - **Pad** (`index.html`): the right cluster becomes a 2 × 2 grid, `HIT ▼` on top and `FIRE JUMP` below.
    - `<button type="button" class="pad-hit" data-code="Hit" aria-label="Punch or kick">HIT</button>`
    - `<button type="button" class="pad-fire" data-code="Fire" aria-label="Shoot">FIRE</button>`
    - Every target is ≥ 56 px; FIRE and JUMP are 64 px.
    - The buttons get a 35% dark fill (`background: rgb(7 8 11 / 35%)`).
    - The existing pointer-capture wiring works for them unchanged, because it reads `data-code`.
  - **Side view only**:
    - `.hud` gets `background: linear-gradient(#07080bcc, transparent)` (`body.side` class toggled in `loop`);
    - the stage's context menu is suppressed (Task 6 does it via `arena()`).
  - **Hooks**: `__ascii.pvp = () => pvp`, plus `__ascii.input = () => input` for e2e.

- [ ] **Step 1: Write the failing checks.** This task is glue and DOM, so the checks are e2e. Add them to `e2e/run.mjs` now, as checks that fail (Task 16 adds the rest):

```js
await check('arena PvP: the fight HUD shows hp in the side view, and the pad has FIRE and HIT on a phone', async () => {
  await page.evaluate(() => { const a = window.__ascii.map.arena; window.__ascii.teleport(a.entry.x + 0.5 - 30, a.floorY - 1.5); });
  await page.waitForFunction(() => window.__ascii.mode() === 'side');
  await page.waitForFunction(() => !document.getElementById('fight').hidden);
  assert.match(await page.$eval('#fight-hp', (e) => e.textContent), /^hp █{10} 100/);
});
```

  Use the existing `check` helper. Add the phone half to the existing phone section, asserting `.pad-fire` and `.pad-hit` are visible and at least 56 px.

- [ ] **Step 2: Run e2e/run.mjs and watch the new checks fail.** Run: `node e2e/run.mjs < /dev/null` (Bash timeout 560000). Expected: the new checks FAIL; the existing ones PASS.

- [ ] **Step 3: Implement**, per Interfaces.
  - Keep `main.js` readable: put the fight HUD rendering in a small `renderFightHud(hud)` function in main.js, about 40 lines. If main.js passes ~650 lines, move it to `src/fighthud.js`.

- [ ] **Step 4: Run all suites and see them pass.**
  - `npm test < /dev/null`;
  - `node e2e/run.mjs < /dev/null`;
  - `node e2e/editor.mjs < /dev/null`;
  - `node e2e/multiplayer.mjs < /dev/null`.
  - Expected: PASS.
  - Look at a desktop and a phone screenshot of the arena, in each renderer, with the HUD showing. Check the HUD reads over the sky, and the pad doesn't hide a figure at the room's edge.

- [ ] **Step 5: Commit**: `Arena PvP: the fight in the page: controls, HUD, scoreboard, kill feed, the pad, and going away`.

---

### Task 16: End-to-end: offline PvP in `run.mjs`, two-browser PvP in `multiplayer.mjs`

**Files:**
- Modify: `e2e/run.mjs`, `e2e/multiplayer.mjs`

**Interfaces:**
- Consumes the hooks:
  - `__ascii.pvp()`: `.me`, `.bodies(now)`, `.hud(now)`, `.fx`;
  - `__ascii.input()`;
  - `__ascii.teleport`, `__ascii.pose`, `__ascii.world`, `__ascii.setRenderer`;
  - `__ascii.live()`.
- Produces the checks in PvP spec §14 e2e, plus the user's verification list.

**Checks in `e2e/run.mjs`** (one browser, no server, so the dummy):
1. The dummy is there. Holding J facing it shoots it: its hp falls, it is knocked back, it pops, and it comes back about 2 s later.
2. Walking into the sniper pickup:
   - gives the sniper (`me.gun === 'sniper'`, `me.ammo === 5`, `#fight-hp` says `sniper 5`);
   - the aim line glyphs (`·`) are drawn;
   - firing 5 shots returns it to the deagle;
   - the pickup is back after 10 s (`there` again).
3. Walking into a rifle gives 40 rounds:
   - hold J for 5 s: it fires at about 10/s and ends on the deagle;
   - the deagle's rate is ≤ 2.6 shots/s;
   - the dummy's hp drops 9 per rifle hit and 25 per deagle hit.
4. A sniper shot does 70 to the dummy.
5. A double-tap of D rolls about 14 cells. Bullets pass through a rolling target: script the dummy rolling with the local referee's `rollAt`, or use the dodge check in pvp. Verify at least through `__ascii.pvp()` that a bullet arriving mid-roll leaves its hp unchanged.
6. A jump out of a roll keeps its speed: the horizontal distance of the long jump is greater than a standing running jump's by at least 4 cells.
7. At 852 × 393 with touch:
   - FIRE and HIT are shown and work;
   - FIRE with JUMP held shoots 45° up (the bullet's `angle ≈ −π/4`);
   - ◀◀ on the pad rolls left.
8. With Reduce Motion (`page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])`):
   - the camera doesn't shake: feed a kick on me through the hook (`__ascii.pvp().onMessage({ t: 'h', id: <my id>, by: 'x', w: 'k', n: -1, d: 22, hp: 78, kx: 45, ky: -22 }, performance.now())`) and check `world.cam` follows the body with no wobble (camera minus player position changes smoothly, frame to frame);
   - no page errors.
9. A mouse click above and to the left of the player fires a bullet at that angle (the bullet's `angle` within 0.1 rad of the expected one).
10. Screenshots of the fight in both renderers, desktop and phone. Look at them.

**Checks in `e2e/multiplayer.mjs`** (two browsers against `wrangler dev`):
1. Both walk into the arena and see each other as fighters (`pvp.fighters.ids()` includes the other).
2. A faces B and holds J: B's hp falls on both screens (`pvp.me.hp` on B; the body state's `hp` on A).
3. A pops B:
   - A's scoreboard shows `you 1`, B's shows A with 1;
   - B respawns after about 2 s at a marked spawn, protected (`state.safe` on A's screen).
4. A presses K next to B: B is knocked away by more than 2 cells on both screens.
5. B jumps: A's view of B, sampled every frame, never moves more than 1.2 cells between frames, and its peak is within 0.5 rows of B's own.
6. B opens a photo: B leaves the fight on A's screen, and comes back on closing it.
7. A walks into the rifle: A holds a rifle on both screens, and B sees A's shots as rifle bullets (`fx` bullets with gun `rifle`).
8. A double-taps → and rolls about 14 cells on both screens.
9. The sniper aim line: when A holds the sniper, B's glyphs include A's dotted line.
10. The shot-and-hit check runs once with `?r=canvas` and once with `?r=gl`.
11. Stopping the server mid-fight: both get the dummy, and there are no page errors. Do this last; it kills `dev`.

- [ ] **Step 1: Write the checks** in both files, following each file's existing `check(name, fn)` pattern. Move bodies with `__ascii.teleport`, and use real key presses (`page.keyboard.down('KeyJ')`) for the controls under test.
- [ ] **Step 2: Run them.** Run `node e2e/run.mjs < /dev/null` (timeout 560000), then `node e2e/multiplayer.mjs < /dev/null` (timeout 560000).
  - Any check that fails because of a product bug: fix the bug in its owning file with a unit test that fails first (TDD), then re-run.
  - Record every such fix in your report.
- [ ] **Step 3: Run the full set** (`npm test`, `cd server && npm test`, the three e2e files) and confirm it all passes.
- [ ] **Step 4: Commit**: `Arena PvP: end-to-end checks for the fight, alone and with two browsers`.

---

## Amendment (2026-10-14, after user feedback on the gun)

### Task 14R: The rig — a jointed stickman of rotatable glyph sprites, the gun in the hand

**Why:** the user saw the stickman's carried deagle `╦═` jutting level from the hip and said it looks like a
penis, "because it's at the crotch and not the hands", and asked for a rendering that isn't strictly ASCII,
so that parts can rotate and move more fluidly.

**Spec:** `docs/specs/2026-10-14-arena-stickman-rig.md` (the rig addendum). It wins over
`docs/specs/2026-10-14-arena-stickman-design.md` wherever they disagree. Read the addendum in full, and the
stickman spec's §3, §4 and §5 for everything the addendum keeps.

**Files:**
- Modify:
  - `src/stick.js` (the pose function becomes the rig);
  - `src/render/figures.js` (pass `rot`, `len`, `flip` through);
  - `src/render/canvas.js` (draw rotated, stretched, flipped sprites);
  - `src/render/gl.js` and `src/render/shaders.js` (instance `rot`, `len`, `flip`; rotate in pixel space).
- Test:
  - `test/stick.test.js` (rewrite for the rig, per addendum §7);
  - `test/figures.test.js` (pass-through fields, perf budget kept);
  - `e2e/run.mjs` pose checks: only after Task 15's commit, see the dispatch.
- Don't touch:
  - `src/main.js`, `src/pvp.js`, `src/fight.js`, `src/fx.js`, `src/referee.js`, `server/`;
  - `index.html`, `src/style.css`, `src/config.js`.

**Interfaces:**
- Consumes (unchanged):
  - the exports `SHOULDER`, `HAND_R`, `MUZZLE_R` and `GUN_ART` (fight.js and fx.js import them; keep the
    names and values);
  - `createMotionMemory` and the motion-memory behaviour.
- Produces:
  - `stickPose(state, t, opts, out)` with the same signature. Each entry is
    `{ dx, dy, ch, part, tone, a, rot, len, flip }`; `rot` defaults to 0, `len` to 1, `flip` to false.
  - `figureGlyphs` entries gain `rot`, `len` and `flip`. Labels and strips have rot 0, len 1 and no flip.
  - Both renderers honour them.

- [ ] **Step 1: Write the failing tests.**
  - Rewrite `test/stick.test.js` per addendum §7: connected skeleton, bone lengths, IK bend directions,
    hand holds the gun, carried gun above the hip and 20° down, aimed muzzle at `muzzleOf`, no steep glyph
    substitution, continuity at 1 ms sampling, mirroring, death pieces settle, purity, `out` reuse.
  - Keep the existing behaviour tests the addendum keeps: defaults, Reduce Motion, safe shimmer, motion
    memory, respawn fly-in timing, and the act durations.
  - Add a `figures.test.js` case: `rot`, `len` and `flip` pass through.
- [ ] **Step 2: Run them and watch them fail.** `node --test test/stick.test.js test/figures.test.js < /dev/null`
- [ ] **Step 3: Implement the rig in `src/stick.js`:**
  - targets per pose, two-bone IK, continuous blends, bone sprites, gun along its axis from the hand,
    mirroring by rot/flip;
  - keep it pure and allocation-free;
  - tune the starting numbers in addendum §4–§5 by eye on the pose sheet, and leave the final numbers in
    named tables.
- [ ] **Step 4: Renderers.**
  - Canvas: `setTransform` per rotated or stretched sprite; snap only upright, unstretched ones.
  - GL: new per-instance attributes; rotate the quad in pixel space; scale Y by len; mirror X by flip.
  - Keep the two-pass outline/fill, the sprite cache and its cap, and the atlas.
- [ ] **Step 5: Run everything.**
  - `npm test < /dev/null`;
  - e2e/run.mjs, editor.mjs and multiplayer.mjs, each through the e2e lock (see the dispatch).
  - Look at the pose sheets `e2e/shots/stick-{canvas,gl}-{computer,phone}.png` and the `?bots=30` shots.
    Every pose must read clearly, with the gun in the hand at chest height when carried. Canvas and GL
    must match. It must hold 120 fps (30 fps exactly means the Mac is on battery).
- [ ] **Step 6: Commit** with the message `Arena PvP: the stickman becomes a rig: jointed limbs, rotating glyph sprites, the gun in the hand`.

---

## Amendment (2026-10-14, user request: headshots and the double jump)

Spec: docs/specs/2026-10-14-arena-headshots-double-jump.md. Task 17 runs alongside 14R (disjoint files). Task 18 runs after 14R, 15 and 17 land, since it shares stick.js, pvp.js and fighters.js with them.

### Task 17: Headshots: ×2 damage on the head row, decided by the referee, shown in fx and the feed

**Spec:** `docs/specs/2026-10-14-arena-headshots-double-jump.md` §1 (binding). Use the PvP spec for context.

**Files:**
- Modify:
  - `src/fight.js`: a `HEADSHOT = 2` constant and a pure helper `isHeadshot(rel)` or `headHit(p, c)`, which
    takes the hit point relative to the target centre in rows and returns true when `dy < −0.5`;
  - `src/referee.js`: the bullet tick computes the hit point at `hitT` and applies ×2 with `hs: 1` on `h`
    and on the `k` it causes;
  - `src/fx.js`: a headshot damage number `-50!` in flash white, lasting 1.3×;
  - `src/pvp.js`: pass `hs` to fx; a small shake when *my* bullet lands a headshot (none with Reduce
    Motion); the feed line gets ` ◎ headshot` for a headshot kill;
  - `src/fighters.js`: only if remote `h` handling needs `hs` passed through to fx.
- Test:
  - `test/fight.test.js`, `test/referee.test.js`, `test/fx.test.js`, `test/pvp.test.js`;
  - `server/test/server.test.js`: one test that `hs` reaches the wire. The Worker forwards referee
    output; check `server/gallery.js` needs no change.
- Don't touch:
  - `src/main.js`, `src/fighthud.js`, `index.html`, `src/style.css`;
  - `src/stick.js`, `src/render/*`, `src/arena.js`.

**Steps (TDD):**
1. Write the failing tests from the spec's §3 "Headshots" list. Also add:
   - an `fx` test: a headshot number has `!` and white tone;
   - a `pvp` test: a headshot `k` gives a feed line ending ` ◎ headshot`.
2. Run them and watch them fail: `node --test test/fight.test.js test/referee.test.js test/fx.test.js test/pvp.test.js < /dev/null`.
3. Implement.
4. Run `npm test < /dev/null` and `cd server && npm test < /dev/null`, which uses port 8797.
5. Commit with the message `Arena PvP: headshots: double damage on the head, called by the referee`.

### Task 18: The double jump: one air jump with a redirect, predicted for remote fighters, a flip in the rig

**Spec:** `docs/specs/2026-10-14-arena-headshots-double-jump.md` §2 (binding); the rig addendum for the pose layer.

**Files:**
- Modify:
  - `src/arena.js`:
    - `AIR_JUMPS`, `DOUBLE_V = 34`;
    - `b.airJumps` and `b.airJumpT` in `newBody`;
    - the air jump in `stepBody`, with refill on touching the ground.
  - `src/fighters.js`: prediction, so remote bodies double-jump on an airborne bit edge; `flipT` in each
    fighter's stick state.
  - `src/pvp.js`: `flipT` in my stick state.
  - `src/main.js`: only if the stick state is assembled there; pass `flipT` through.
  - `src/stick.js`: the whole-body flip and the puff, per spec §2 "Animation".
  - `server/rules.js`: only if `clampMove` rejects an honest double jump.
- Test:
  - `test/arena.test.js`, `test/fighters.test.js`, `test/stick.test.js`;
  - `server/test/server.test.js` (an honest double jump is accepted);
  - the level reachability tests, if they change: update the expectations and keep the clearance rules.
  - `e2e/run.mjs`:
    - a double jump peaks higher than a single jump;
    - add a flip entry to the pose sheet.

**Steps (TDD):**
1. Write the failing tests from the spec's §3 "Double jump" and pose lists.
2. Watch them fail.
3. Implement, in this order: physics, prediction, state, pose.
4. Run `npm test`, `cd server && npm test`, and `e2e/run.mjs` and `e2e/multiplayer.mjs` through the e2e lock.
5. Look at the pose sheet with the flip, in both renderers.
6. Commit with the message `Arena PvP: the double jump: one air jump with a redirect and a flip`.

---

## Amendment (2026-10-14, user request: a bigger arena, zoom by gun)

Spec: docs/specs/2026-10-14-arena-bigger-zoom.md. Order from here: 14R and 17 (running), the Task 15 fixes, then 19, then 18 (double jump, tuned on the bigger room), then 16 (e2e), then the final review.

### Task 19: A bigger room (240 × 51) and a side view that zooms in by gun

**Spec:** `docs/specs/2026-10-14-arena-bigger-zoom.md` (binding).

**Files:**
- Modify:
  - `src/arena.txt` (the new 240 × 51 trace), `src/level.js` (size), and `src/arena.js` (`SIDE_ROWS`, a
    pure `sideZoom` helper, camera lead);
  - `src/layout.js`, only if the arena box needs it;
  - `server/gallery.js`, only if `DOOR` or `levelHash` is not derived;
  - `src/render/canvas.js`, `src/render/gl.js`, `src/render/shaders.js`: the side-view cell size, crisp
    rebuild on settle, `cellAt`/`pointAt`;
  - `src/main.js`: `world.view` from the side cell size; drive the zoom from my gun;
  - `src/world.js`, if the camera needs the zoom.
- Test:
  - `test/level.test.js`, `test/arena.test.js`, `test/world.test.js`, `server/test/server.test.js`;
  - `e2e/run.mjs` and `e2e/multiplayer.mjs`: update every check that hard-codes the old level, and add
    the zoom checks.

**Steps (TDD):**
1. Write the failing tests from spec §3.
2. Watch them fail.
3. Build the level. Write a small scaling script in the scratchpad, not the repo, then hand-tune
   `src/arena.txt`. Render it as text and compare it against the photo's lines.
4. Add the zoom, then the renderers.
5. Run `npm test`, `cd server && npm test`, and all three e2e scripts through the e2e lock.
6. Look at desktop and phone screenshots in both renderers, at the deagle and sniper zooms.
7. Commit with the message `Arena: a bigger room traced on the photo, and a side view that zooms in by gun`.
