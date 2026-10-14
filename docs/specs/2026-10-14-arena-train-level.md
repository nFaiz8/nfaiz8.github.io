# Arena: the train level (addendum)

**Status:** the user picked a look on 2026-10-14. They left the photo backdrop and the traced platforms ("lets remove the
platforms just build a train scene"), then compared a ray-traced train (option A) with a hand-drawn ASCII train
(option B), and said "b is def the move. line+color or plain ascii dont know which one yet". Option B's page is
the visual reference, kept git-ignored at `.superpowers/arena-looks/train-ascii.html` and published as tab B of
https://claude.ai/artifact/7eiNSEj4akcfX4JisXgebS.

This addendum **replaces §1 ("A bigger room: 240 × 51") of `2026-10-14-arena-bigger-zoom.md`** and the photo
backdrop of the arena spec. **§2 of that addendum (the side view zooms in by gun) still holds**, with the row
values below. Where this addendum disagrees with any earlier spec, it wins.

## 1. The room: two subway cars in a tunnel, 204 × 33

The arena is two subway cars, seen in cutaway, rolling through a tunnel. You fight in three places:

- on the car floors;
- through the gangway between the cars;
- up on the roofs, in a tight strip under the tunnel ceiling.

The interior is **204 columns × 33 rows**: `LEVEL_COLS = 204`, `LEVEL_ROWS = 33`.

### Collision: `src/arena.txt`, the source of truth

Use the same characters as before: `▓` solid, `═` platform (one-way, ↓ drops), `S` spawn, `R` rifle,
`N` sniper. The new marker `D` is the door. All markers are air.

| Part | Cells |
|---|---|
| Tunnel ceiling | rows 0–1, solid, full width |
| Car A | cols 2–97 |
| Car B | cols 104–199 |
| Roofs | rows 8–10, solid, each car's columns. The roof top is row 8, so feet stand on row 7. |
| End lintels | the two outermost columns at each end of each car (`a`, `a+1`, `b−2`, `b−1`), rows 11–13, solid. The doorway under them (rows 14–25) is open. |
| Floor | rows 26–27, solid, **full width 0–203** (car floors, the gangway plate and the two room ends). The floor top is row 26, so feet stand on row 25. Rows 28–32 are air you can't reach (the undercarriage art). |
| Climbing ledges | `═` platforms spanning each gap: cols 0–1, the gangway 98–103 and 200–203, at **rows 21, 16 and 11**. Each step is 5 rows. From the row-11 ledge, a jump and a sideways move put you on a roof. |
| Door `D` | the right end on the floor line, col 203 row 25. The server's `DOOR` reads it from the level instead of assuming the bottom-right corner. |
| Spawns `S` | at least 6 across both car floors and both roofs, each standing on a surface |
| Rifle `R` | on car A's roof, near col 82 |
| Sniper `N` | on car B's floor, near col 178 |

- The body is still 3 rows tall, and the level tests' clearance rules still apply. The interior height (rows
  11–25 under the lintels, 14–25 in the doorways) clears a standing body. So does the roof strip (rows 2–7).
- **Reachability:** every ledge and both roofs must be reachable from the floor with single jumps plus at most
  one double jump each step. The double jump comes from Task 18: `AIR_JUMPS`, `DOUBLE_V`. The level test
  checks this using those exported constants, not retyped numbers.
- **What follows from the change:**
  - `LEVEL_COLS`/`LEVEL_ROWS`;
  - `levelHash` (a mismatched client can't fight until it reloads, as before);
  - the server's `DOOR` and its entry clamp;
  - the layout's arena box;
  - every test and e2e check that hard-codes old positions (the door at 159.5/32.5, the sniper spot at r3
    c118, the dummy line). Derive them from the level, don't retype them.
- **The practice dummy** (a carry-over from the Task 15 review) stands on car A's floor, near col 50.
  `DUMMY_SPOT` comes from the level. A level deagle shot from the floor 10 cells away must hit it.

### Decor: `src/train.js`, pure and import-free

`src/train.js` builds what you see, so the Worker never needs it. It exports:

- `buildTrain(level)`: a static per-cell glyph and role grid (204 × 33), made from the same car constants as
  the collision. A role is one of these:

  | Group | Roles |
  |---|---|
  | Car | `wall`, `wframe`, `glass`, `ad`, `grab`, `pole`, `seat`, `seatd`, `leg`, `post`, `tube`, `livery`, `stripe`, `body` |
  | Gangway | `gang`, `coupler` |
  | Undercarriage | `frame`, `wheel`, `spoke` |
  | Collision | `solid`, `lintel` |

  Car and gangway cells also carry an `inside` mask and a window `shaft` mask. Port these from option B's
  page, `S_ch`/`S_role` and the `CARS` loop. The art follows option B: windows are real holes, ad cards sit
  above the windows, poles stand on the mullions, there's a bench along the back wall, and there are bogies
  and spoked wheels.
- `tunnel(y, u)`: the glyph and role seen through a hole at tunnel coordinate `u`. That means rock, ribs,
  cables, signals and specks, and a tiled **station** with a name tablet every 1000 cells (280 cells long).
  It's ported from option B.
- `lightAt(x, y, zone, frame)`: option B's cheap per-cell light. That is:
  - ambient inside and outside;
  - fluorescent tubes inside;
  - sodium lamps at three heights: high ones light the roofs, window-height ones light the outside, and their
    shaft light lands on the seats and floor below;
  - low ones light the wheels;
  - the station's flood of light;
  - a muzzle flash.
- `frameAt(t)`: everything about the scene's state at time `t`. That is the scroll offset
  (`SPEED = 0.045` cells/ms, whole cells only), the lamp positions, each tube's level and the spoke glyph.
- `lookChar(look, ch, role, light)`, with `look` either `'line'` or `'ascii'`. It's option B's mapping. The
  `'ascii'` look returns only 7-bit printable characters.

### Drawing it

- **Brightness follows importance.** Collision cells are always warm white (`[255, 236, 210]`) and never
  dimmer than 62%: the roof and floor tops, the lintels, the gangway plate and the ledges. Everything else is
  lit by `lightAt` and stays below the collision brightness. A test checks this. Never draw `═`, `▓` or a
  full-brightness `┌─┐` in decor.
- **Two lights and one accent.**
  - Inside: cool fluorescent `[0.75, 1.0, 0.88]`.
  - Outside: amber sodium `[1.0, 0.62, 0.25]`.
  - The one accent: the line's orange `[255, 128, 40]`, used only on the livery stripe, the seats, the ad
    cards and the station band.
- **The world moves, not the train.** The tunnel, lamps, signals and stations scroll left a whole cell at a
  time; never draw a fraction of a cell. The wheel spokes turn.
- **One dying tube** in car B flickers. **It changes state at most 3 times a second** (WCAG 2.3.1), so
  it's not a strobe.
- **Glow:** emissive roles (tubes, lamps, signals) and the fight's tracers and flashes get the existing
  halation glow. Tune the glow on this scene: visible, but never smearing glyphs.
- **Both renderers draw the same thing:**
  - per-cell foreground colour, plus the `'line'` look's background tints (`BG` in option B);
  - the figures, HUD and fight effects on top, unchanged.
  - The WebGL atlas gains every glyph that `buildTrain`, `tunnel` and `lookChar` can produce. A test lists
    them and checks they're all in the atlas, so none draws as `?`.
- **The look** (decided 2026-10-14: the user chose `'line'` for good; the L key, the HUD button and the
  saved choice were removed. `lookChar` keeps its `'ascii'` mapping, unused). Originally specified as a toggle:
  - `'line'` is the default, and `'ascii'` is the alternative.
  - Toggle with the **L** key, or a small "look" button in the arena HUD (it must work on touch too).
  - Remember the choice in `localStorage`, wrapped in try/catch.
- **No photo backdrop.** The arena no longer draws `dscf9139`, and no `coverCrop` happens for the arena.
  **E still opens the photo** as the "inspiration": `ARENA.photo` stays and loads on demand.
- **The same scene in the top-down gallery view.** In the gallery, the arena room shows the train at the
  gallery's cell size.
- **Reduce Motion:**
  - the scroll, lamps and spokes hold still on one frame;
  - the dying tube stays dim and steady;
  - no station passes.
- **Performance:** the decor costs a light computation per visible cell per frame. Keep `?bots=30` at
  120 fps in both renderers. Cache the static grid and only recompute light for visible cells.

## 2. The zoom by gun, with this room's rows

`SIDE_ROWS` (the bigger-zoom addendum §2 still holds, with these values):

| Holding | Rows visible |
|---|---|
| deagle | 20 |
| rifle | 25 |
| sniper | 33 (the whole height) |
| no fight, or dead | 24 (keep the last value while dead) |

- Changing guns eases the zoom over 0.35 s (`1 − (1 − k)³`). Under Reduce Motion it switches instantly.
- The camera follows the player. On touch it keeps a bottom and side inset, so the figure stays clear of the
  pad at the door and at the room's ends (a carry-over from Task 15).

## 3. Tests

- **Level:**
  - the 204 × 33 parse;
  - every row in the collision table above;
  - the clearance rules;
  - reachability, using Task 18's constants;
  - the door marker, and the server reading it;
  - spawns and pickups standing on surfaces;
  - the dummy shot: a level deagle shot from 10 cells away hits it.
- **`train.js`:**
  - `buildTrain` is deterministic;
  - every cell whose role is `solid` or `lintel` is solid or platform in the level, and every solid or
    platform cell inside the room is drawn with a collision role (art and physics can't drift apart);
  - windows are holes, and the shaft mask sits under them;
  - `tunnel` scrolls by whole cells;
  - the station appears every 1000 cells;
  - the dying tube changes state at most 3 times in any 1 s;
  - the `'ascii'` look returns only 7-bit characters;
  - collision is never dimmer than any decor cell at the same light.
- **Server:** the door point and the entry clamp follow the new level, and `levelHash` matches between
  client and Worker.
- **Zoom:** `sideZoom` gives the rows above, eases, and is instant under Reduce Motion.
- **e2e:**
  - the side view's visible rows match the deagle value, then the sniper value;
  - `pointAt` lands under the mouse at both zooms;
  - L toggles the look and it persists across a reload;
  - no `?` glyphs in WebGL;
  - screenshots on desktop and an 852 × 393 phone with touch, in both renderers and both looks;
  - `?bots=30` at 120 fps (exactly 30 fps means battery or Low Power Mode, not a regression).
