# Arena: a bigger room and a gun-dependent zoom (addendum)

**Status:** the user asked on 2026-10-14: "make the arena bigger and zoom in more on character", then "gun
type changes view size". This addendum amends the arena spec, the PvP spec and the stickman/rig specs, and
wins where they disagree.

## 1. A bigger room: 240 × 51

- **Size.** The level grows from 160 × 34 to **240 × 51** interior cells (×1.5 each way). It stays traced
  on the same photo (`dscf9139`), so platforms still follow the photo's lines:
  - one long platform at the yellow line at the bottom;
  - walls at the pillars;
  - assorted floating platforms.
  Make it by scaling the current trace ×1.5, then clean it up by hand.
  - Platforms stay 1 row thick.
  - Solid blocks (walls and pillars) scale with the room.
  - Spawns `S` and pickups `R`/`N` move to the scaled spots and stand on a surface.
  - Add 1–3 extra floating platforms where the scaled gaps leave a dead zone. Keep it readable.
- **Unchanged:**
  - the body size (3 rows) and the clearance rules from the level tests;
  - the door, which is still the bottom 3 rows of the east wall, just under the yellow line;
  - jump physics (Task 18's double jump comes after this task).
- **Reachability.** Every platform must be reachable with a single jump plus at most one double jump.
  Today's single jump is about 6 rows; the double jump adds about 4.3. Keep every floating platform within
  9 rows of the one below it, or within a sideways jump. The level test's reachability check uses that
  rule.
- **What follows from the size:**
  - `LEVEL_COLS`/`LEVEL_ROWS`.
  - The server's `DOOR`, which is derived from the level, so check it.
  - `levelHash`. A mismatched client simply can't fight until it reloads, as the PvP spec already
    describes.
  - The layout's arena box.
  - Every test and e2e check that hard-codes the old size or old positions, such as the sniper spot at
    r3 c118, the door at 159.5/32.5 and the dummy line. Update them from the level, not by retyping
    numbers.
- **The backdrop photo** keeps covering the room (`coverCrop`). The room is 240 × 51 cells × 2 aspect
  ≈ 2.35:1, close to the old 2.35:1, so the crop barely changes.

## 2. The side view zooms in, by gun

- **The side view gets its own cell size.** It is a zoom on top of the gallery's. The top-down gallery is
  unchanged.
- **Zoom is set as the number of rows visible**, so it means the same on every screen:

  | holding | rows visible |
  |---|---|
  | deagle | 22 |
  | rifle | 28 |
  | sniper | 38 |
  | no fight (`pvp: false`), or dead | 26, or keep the last value while dead |

  - The width follows the screen's aspect.
  - Put the values in one table (`SIDE_ROWS`) so they are easy to tune.
  - On a phone (852 × 393 landscape), the same rows apply.
- **Changing guns eases the zoom** over 0.35 s (`1 − (1 − k)³`), with the camera kept on the player.
  Picking up a sniper pulls back; running dry and returning to the deagle pushes in.
  - Reduce Motion: switch instantly.
- **The camera** (`sideCamera`) already follows x and y with the floor kept on screen near the bottom. It
  keeps doing so with the smaller view. The look-ahead (`lead`) scales with the view width.
- **Crisp text.** At rest the glyphs must be as crisp as now.
  - Rebuild the glyph atlas or sprite caches for the new cell size once the zoom settles, or build them at
    the largest zoom and draw them down.
  - During the 0.35 s ease, scaled drawing is fine.
  - The figure layer's outline width scales with the zoom.
- **What depends on cell size:**
  - `renderer.cellAt` and `renderer.pointAt` (mouse aim, taps);
  - `world.view`;
  - the HUD's placement;
  - the touch pad, whose buttons stay the same size in CSS pixels.
- **Performance.** Larger cells mean fewer cells, so no new cost, apart from the atlas rebuild, once per
  settle. The site still holds 120 fps with `?bots=30`.

## 3. Tests

- **Level** (`test/level.test.js` and `test/arena.test.js`):
  - the 240 × 51 parse;
  - the clearance rules;
  - the reachability rule above;
  - the door rows;
  - spawn and pickup placement on surfaces.
- **Server:** the door point and the entry clamp follow the new size, and `levelHash` matches between the
  client and the Worker.
- **Zoom** (a pure helper, e.g. `sideZoom(gun, from, t)` in `src/arena.js`):
  - the rows per gun;
  - the eased transition;
  - Reduce Motion is instant.
- **e2e:**
  - in the side view, the visible rows match the deagle value, then the sniper value after
    `pvp().me.gun = 'sniper'` or a pickup;
  - `pointAt` still lands under the mouse at both zooms;
  - screenshots on desktop and the 852 × 393 phone, in both renderers.
