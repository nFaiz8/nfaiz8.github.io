# Arena: crouch and crawl, and F for fullscreen (addendum)

**Status:** the user asked for both on 2026-10-14 and approved the design in chat ("yes build it after u right
thr spec"). Their answers:
- What crouch is for: "Dodge + steadier aim".
- What steadier means: "Less knockback taken, Longer range, Sniper scope".
- Controls: "Hold ↓ on solid floor".
- Movement: "Slow crawl".
- Height: "make the figure like 1 high when crawling if its 2 when crouching".

This addendum amends the PvP spec (`2026-10-14-arena-pvp-design.md`), the rig
(`2026-10-14-arena-stickman-rig.md`) and the headshots addendum. Where they disagree, this addendum wins.
The implementation plan is `docs/plans/2026-10-14-arena-crouch-plan.md`.

## 1. Stances

A body has `low`: 0 standing, 1 crouched, 2 prone (crawling). `stepBody` (`src/arena.js`) sets it every
step.

- **Crouch:** hold ↓ / S, or the pad's ▼, while standing on solid floor. Solid floor is the floor, or the
  top of a ▓.
  - It does not work on a ═ platform: there ↓ still drops through, as before.
  - It does not work on someone's head: there ↓ still drops off it.
  - It does not work while stunned or rolling, or in the air.
  - Crouched and still, you are 2 rows tall.
- **Crawl (prone):** crouched, with ← or → held. You lie down: 1 row tall and about 3.5 cells long.
  - You crawl at 10 cells/s (`CRAWL`). Shift does nothing.
  - Letting go of ←/→ brings you back to a crouch.
- **Getting up:**
  - Letting go of ↓ stands you up.
  - A jump, a roll or a knock (being hit) stands you up too. Jump and roll work from a crouch or a crawl
    exactly as they do standing.
- **Collision is unchanged.** The body's collision box stays 3 rows. You can't crawl under anything, so
  no level geometry changes.
- **The pose blends** 0.15 s each way (the motion memory, §5). The rules switch at once.

## 2. Hurtboxes, muzzles and headshots

All rows below are relative to the body's centre `y`. The feet are at `y + 1.5` and never move.

| stance | hurtbox (rows) | hw (cells) | shoulder (dx, dy) | the head |
| --- | --- | --- | --- | --- |
| standing | −1.5 … +1.5 | 0.5 | 0.15, −0.3 | `dy < −0.5` (as before) |
| crouched | −0.2 … +1.5 | 0.5 | `SHOULDERS[1]` | `dy < 0.3` |
| prone | +0.5 … +1.5 | 1.75 | `SHOULDERS[2]` | the front: `dx·f > 0.75` |

`SHOULDERS[1]` and `SHOULDERS[2]` are where the rig draws the shoulder: (0.6, 0.6) and (0.55, 1.1). They
live in `src/stick.js`. A test keeps the rules' values and the rig's within
0.1.

- **The muzzle follows the stance.** A shot leaves from that stance's shoulder, so `shoulderOf` and
  `muzzleOf` take `low`.
- **This is the dodge.** A standing shooter's level shot flies at −0.3, which passes over a crouched or
  prone body. A crouched shooter's level shot (+0.6) hits a crouched or prone body. A prone
  shooter's level shot (+1.1) hits everyone. To hit someone low, crouch too, jump and shoot down, or
  aim with the mouse.
- **Headshots.** The hit point is clamped into the stance's box first, as before.
  - Crouched: the top half-row of the box is the head.
  - Prone: the front of the box, more than 0.75 cells ahead in the facing direction, is the head.
- **Melee.** Punches and kicks test the stance's box (`boxHits` takes it). A standing punch's box reaches
  down to +1.05, so it still hits someone crouched or prone.

## 3. Steadier aim

- **Less knockback.** A body that is crouched or prone when hit takes half the knock (`kx`, `ky` ×0.5)
  and half the stun. This applies to bullets and strikes.
  - The referee halves `kx`/`ky` in the `h` it sends, and adds `lo: 1`.
  - Clients halve the stun from `stunOf(w)` when `lo` is set. Old clients ignore `lo` and use the full
    stun with the halved knock.
- **Longer range.** A bullet fired while crouched or prone flies 1.5× as far (`LOW_RANGE`): the deagle about
  64 → 96 cells, the rifle 63 → 94, the sniper 165 → 247. This is fixed when the bullet is fired.
  - The `s` message carries `l: 1` for these shots, so every screen draws the bullet to its real end.
  - The sniper's aim line is as long as the shot would be.
- **Keyboard aim stays level while low.** ↓ crouches and does not tilt the shot. ↑ still jumps, which
  stands you up. The mouse aims anywhere from any stance.
- **Crawling shots go wild.** The user asked on 2026-10-14, "cuz shooting while crawling with sniper is op".
  A shot fired prone (prone is only ever crawling) leaves up to `CRAWL_SPREAD` = 0.5 rad off the aim,
  either way at random. It still gets the long range. Crouch and stay still to shoot straight.
  - The spread is rolled on the client and sent as the shot's angle. The server takes the angle as given,
    as it already does.
- **The sniper scope.** Crouched or prone with the sniper in hand, the side view pulls back from 33 to 45
  rows (`SIDE_ROWS.scope`). It uses the same eased zoom (0.35 s) as changing guns. Standing up pushes back
  in to 33.

## 4. The wire and the server

- **New input bits:** 64 = crouched, 128 = prone. They are set from my body's `low`, so they describe what
  the body does, not which keys are held.
- `server/rules.js` accepts `i` from 0 to 255 (it was 0–63).
- **The referee** (`src/referee.js`) reads the stance from the last state: `lowOf(i, g)` is 0 unless
  `g = 1` and the roll bit is off. It uses the stance for:
  - the bullet sweep's box, with the box's centre moved down;
  - headshots, the strike box test, the knock (§3), the range (§3) and the muzzle check.
- **Remote fighters** (`src/fighters.js`) are rebuilt from the bits and run through `stepBody` already.
  Since ↓ (bit 8) and ←/→ are in the bits, their prediction crouches and crawls the same way, at the same
  speed.
- **Deploy.** The server and the site deploy together on a push. An old server that is still running
  rejects `a` with `i > 63`, so for those few seconds a crouching player's states are dropped. That is
  accepted.

## 5. The rig

The stick state gains `low` (0/1/2). The motion memory (`createMotionMemory().fill`) adds `crouchK` and
`proneK`, each easing toward its target at 1/0.15 per second. The pose layer blends the following into
locomotion before the aim and the acts:

- **CROUCH:** the hip low (0.3 u above the feet line), knees bent forward, the torso leaning forward
  0.4 rad, the gun carried level.
- **PRONE:** the torso nearly horizontal (lean about 1.35 rad), the hip a little above the feet line, the
  head at the front.
  - The knees are near the feet line with the shins raised behind, and the gun points forward along the
    floor.
  - A **crawl cycle** runs from `x` (a 4-cell stride): the back elbow and the knees reach forward in turn.
- The blend goes into the crouch first and from there into prone. The feet move in straight lines (not on
  their arcs about the hip), so no foot swings through the floor.
- An aimed gun arm works as usual from the stance's shoulder.
- Upper-body acts (the punch) keep the prone lean.
- The kick's whole-body pose is weighted down by `proneK`, so a prone kick doesn't stand the figure up.
- The dummy never crouches.

## 6. F for fullscreen

F toggles fullscreen anywhere on the site, unless a photo or the grid is open: they have their own keys.
- It uses `document.documentElement.requestFullscreen()` and `document.exitFullscreen()`.
- Where the browser has no fullscreen API (iPhone Safari), F does nothing.
- F was free.

## 7. Choices made for you

| question | choice |
| --- | --- |
| Does a standing level shot hit a croucher? | No. It passes over: that is the dodge. |
| Where do a low body's shots come from? | Its drawn shoulder, so crouchers trade level shots. |
| Can you strike while low? | Yes, from the stance's box. Only the drawing of the prone kick is muted. |
| Crawl under gaps? | No. The collision box stays 3 rows. |
| Server checks on the low bits? | Only `g = 1` and no roll. A modified client could claim a low stance while standing, for the smaller box and half the knock. That is accepted for now, like the claimed shot origin's slack. |
| The pad | ▼ crouches on solid floor and drops through a ═. Its label says both. |

## 8. Tests

- `test/arena.test.js`:
  - ↓ on the floor gives `low` 1 and no movement.
  - ↓ with → gives `low` 2 at 10 cells/s, and Shift doesn't change it.
  - ↓ on ═ still drops through.
  - Jump and roll from a crouch work and give `low` 0.
  - Stunned gives `low` 0.
- `test/fight.test.js`:
  - the stance boxes;
  - headshots by stance;
  - `muzzleOf` by stance;
  - `boxHits` by stance.
- `test/referee.test.js`:
  - a standing level shot misses a croucher;
  - a crouched shot hits one;
  - the half knock and `lo`;
  - the 1.5× range and `l`;
  - a prone headshot in the front cell.
- `test/rules.test.js`: `i` up to 255; 256 is rejected.
- `test/pvp.test.js`: the bits 64/128; level keyboard aim while crouched; a halved stun on `lo`.
- `test/stick.test.js`:
  - crouch fits in its 2 rows and prone in its 1 row (body sprites, head included);
  - the drawn shoulder matches `SHOULDERS`;
  - the crawl cycle moves with `x`;
  - the blend is continuous.
- `test/fx.test.js`: a long shot's end, and my bullet passing over a croucher.
- `test/arena.test.js`: the scope zoom.
