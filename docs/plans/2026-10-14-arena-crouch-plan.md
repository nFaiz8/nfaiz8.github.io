# Arena crouch and crawl, and F for fullscreen: implementation plan

**Goal:** Holding ↓ on solid floor crouches (2 rows tall). Holding ↓ with ←/→ crawls prone (1 row, 10
cells/s). While low:
- level shots from standing fighters pass over you;
- you take half the knock and stun;
- your shots fly 1.5× as far;
- with the sniper, the view pulls back to 45 rows.

F toggles fullscreen.

**Spec:** `docs/specs/2026-10-14-arena-crouch.md`.

**Order:** the rules come first, then the wire, then the drawing (TDD: a failing test before each change).
Run `npm test` after each task, and `npm run build` at the end.

- [x] **1. `src/arena.js`**
  - In `stepBody`: set `b.low` (0/1/2), and steer at `CRAWL` = 10 while low.
  - In `newBody`: `low: 0`.
  - Add `SIDE_ROWS.scope = 45`.
  - Tests: ↓ on the floor and on ▓; ↓ on ═ and on a head; crawl speed; Shift; jump, roll and stun.
- [x] **2. `src/stick.js` constants**
  - Add `SHOULDERS[low]`.
- [x] **3. `src/fight.js`**
  - Add `HURTS`, `hurtOf(low)` and `lowOf(i, g)`.
  - `shoulderOf` and `muzzleOf` take `low`.
  - `isHeadshot(rel, low, f)` and `boxHits(box, x, y, low)`.
  - Add `LOW_RANGE`, `LOW_KNOCK` and `bulletRange(gun, long)`.
  - Tests: every new helper.
- [x] **4. `src/referee.js`**
  - `fire`: the stance's muzzle and shoulder, the range, and `l: 1`.
  - `tick`: the sweep with the stance's box, and headshots by stance.
  - `strike`: the stance's box.
  - `hurt`: the half knock and `lo: 1`.
  - Tests: the duck, crouch against crouch, the knock, the range, the prone head.
- [x] **5. `server/rules.js`**
  - `i` from 0 to 255, and the test.
- [x] **6. `src/pvp.js`**
  - `snap` bits 64/128.
  - The level key aim while low, the mouse aim from the stance's shoulder, and the muzzle by stance.
  - `fx.shot` long for my own and remote `l`.
  - The halved stun on `lo` (me, the dummy).
  - `low` in `bodies()`, and `long` in the sniper aims and flashes.
- [x] **7. `src/fighters.js`**
  - `low` in `list()`.
  - The halved stun on `lo`.
- [x] **8. `src/fx.js`**
  - `shot({ long })`.
  - `step` sweeps against each body's stance box.
  - The aim line is as long as the shot.
- [x] **9. `src/stick.js` rig**
  - The CROUCH and PRONE poses and the crawl cycle.
  - The motion memory's `crouchK`/`proneK`.
  - Tests: the fit, the shoulder, the cycle, continuity.
- [x] **10. `src/main.js`**
  - The scope zoom: the gun key `scope` when the sniper is in hand and `low`.
  - `low` in `myBody` outside the fight.
  - F for fullscreen in `onKey`.
- [x] **11. `index.html`**
  - The ▼ label: "Crouch, or drop through a platform".
- [x] **12. Check it in the browser**
  - Crouch, crawl, jump and roll out of it.
  - The dummy: a standing shot over a crouch, a crouched shot into it.
  - The scope.
  - F for fullscreen.
