# Arena: design

Date: 2026-10-13
Status: approved design, not built yet. This is the first of three arena sub-projects: (1) **this**, the
room and its side-scroll mode; (2) PvP: health, respawn, guns; (3) anything chat still needs there.

## 1. Intent

A new room west of the lobby. One large photo, changed whenever the user likes, is the backdrop of a
side-scrolling platform level. Walking in through its door turns the gallery's top-down view into a side
view with gravity, jumping and platforms. Other real visitors (multiplayer) run and jump there too. PvP
comes later and builds on this room.

### What the user chose

- **Photo as the backdrop**: the photo fills the whole back wall as the real photograph, not ASCII art,
  so you can tell what it is. (Changed 2026-10-14 after trying it: the ASCII version didn't read.)
- **Animated transition** at the door: the view tilts from top-down to side-on.
- **A hand-drawn ASCII level file** for the platforms.
- **About one computer screen wide**: 160 × 34 cells. (Changed 2026-10-14 from 240 × 50: smaller.)
- **Phone buttons**: `◀ ▶` and `JUMP`.
- **Glowing platforms with film halation**, not a dimmed photo.
- **The arena photo can be viewed**: it stays in the all-photos grid, and its viewer has an `arena →`
  button.
- **Landscape on phones**. The landscape cell-size fix that this relies on shipped on 2026-10-13.

### Success criteria

- Walking west from the lobby leads to the arena door. Walking through it plays the tilt and puts you on
  the arena floor in side view. Walking back out reverses it.
- Running, jumping (short hop and full jump), standing on platforms, jumping up through `═` and dropping
  down through it all feel responsive on a keyboard and on a phone in landscape.
- The backdrop photo reads clearly. The platforms glow and stand out against any photo.
- Changing one id in `src/config.js` and pushing changes the backdrop. The old photo goes back on its
  colour room's wall.
- Other real visitors in the arena are seen running and jumping, with names, emotes and chat.
- Everything outside the arena works exactly as it does today.

## 2. Layout

- **Corridor**: a 5-row corridor runs west from the middle of the lobby's west wall, the same length as
  the darkroom corridor (10). A `← ARENA` sign is inside the lobby by the door.
- **Room**:
  - The interior is **160 × 34** cells, plus walls.
  - The arena's door is on its **east wall**, using the **bottom 3 interior rows**, which line up with
    the corridor's middle 3 rows. You walk in along the floor.
- **Room record**: `id: 'arena'`, `name: 'Arena'`.
  - It appears on the map (M) and can be picked to walk there.
  - `#/room/arena` links work like other room links.
  - Its `entry` is the first floor cell just inside the door.
- **No overlap with the north wing**: the arena rises about 20 rows above the lobby, into the space the
  north wing's west-side rooms use today. Those rooms start beyond the arena's top, the same way the
  east-side rooms already start beyond the darkroom.
- **Seen from outside** (top-down), the arena is a closed dark room behind its door. The backdrop,
  platforms and the people inside are drawn only in side view.
- **Fake visitors** never enter the arena: their path planning treats arena cells as blocked.

## 3. The photo

- `src/config.js` gains `export const ARENA = { enabled: true, photo: 'img-4927' };`.
  - `photo` is a photo id from `photos.json`. Changing it and pushing swaps the backdrop.
  - `enabled: false` removes the arena, its corridor and its sign entirely.
- **Off the walls, still findable**:
  - While a photo is the backdrop, it is left out of the colour rooms (through `indexData`'s existing
    `exclude` list), so it isn't shown twice.
  - It stays in the all-photos grid (G).
  - When the open photo in the viewer is the arena photo, the viewer shows an **`arena →`** button. It
    closes the viewer and walks you to the arena door, the same quick walk a map pick uses.
- **Drawing**:
  - The backdrop is one large frame covering the room's interior, drawn as the photograph itself (pixels,
    not characters), under the glowing platforms and the arena's light.
  - The photo is **cover-fitted**: scaled to fill 160 × 34 cells, keeping its aspect ratio, and cropped
    in the middle. It uses the high-resolution image, loaded only once you are near the arena.
  - IMG_4927 (5066 × 2075, about 2.4:1) needs almost no crop.
- **Caption in the arena**:
  - It shows the photo's caption line with `[E] open` and the ♥.
  - E opens the photo in the viewer. Closing the viewer returns you to the same spot in the arena.
  - H or ♥ sends a heart. Hearts at the arena photo rise from the sender's `@`, not from the frame's top
    edge, which is the ceiling.
- **Missing photo** (typo or deleted id): the arena works with a plain dark backdrop and a
  `console.warn`. A failed image load falls back the way prints do.

## 4. Side view

### Level file

- `src/arena.txt` holds **34 lines of 160 characters**, one character per interior cell, top row first.
  - space: air
  - `═`: a platform. You can stand on it from above, jump up through it, and drop down through it.
  - `▓`: a solid block, solid from every side.
- The room's walls, floor and ceiling are always solid and are not in the file.
- The bottom 3 rows of the 4 columns next to the door must be air.
- I draw the first layout. The user can edit the file any time.

### Controls

- **Keyboard**:
  - A/D or ←/→ run.
  - W, ↑ or Space jumps. Holding it gives a full jump; releasing early gives a short hop.
  - Shift sprints.
  - S or ↓ while standing on `═` drops through it.
  - The other keys (1–5, H, N, T, M, G, E, R) work as everywhere else.
- **Phones (touch screens)**:
  - Large `◀ ▶` buttons are bottom-left, with `JUMP` bottom-right and a smaller `▼` (drop through)
    just above `JUMP`.
  - They are shown only in the arena. Each touch target is at least 56 px.
  - Tap-to-walk is off in the arena.
- **Follow** (tapping someone's `@`) is off in the arena. Following stops if either person enters the
  arena.

### Physics (`src/arena.js`, pure)

Rows are the vertical cell unit and positive y is down. A cell is twice as tall as it is wide.

| | value |
|---|---|
| run / sprint speed | 30 / 45 cells/s (the gallery's walk speeds) |
| full jump | rises about **6 rows**, about **0.6 s** in the air on flat ground (take-off 40 rows/s, gravity 133 rows/s²) |
| short hop | releasing jump while rising halves the upward speed |
| max fall speed | 60 rows/s |
| air control | 60% of ground acceleration |
| coyote time | a jump still works up to **0.1 s** after running off a ledge |
| jump buffer | a jump pressed up to **0.1 s** before landing happens on landing |
| drop-through | `═` under you is ignored for 0.25 s |

- The player's box is 0.6 cells wide and 1 row tall.
- Movement is **sub-stepped** in steps of under 0.4 of a cell, as walking is today. A slow frame
  therefore can't pass through `▓`, a wall, or a `═` while falling.
- You land on `═` only while falling, and only if your feet were above its top before the step.
- `world.js` hands movement to `arena.js` while you are inside the arena. Everything else (visitors,
  focus, the camera spring) stays in `world.js`.

### Camera

- **Horizontal**: it follows you with a small lead in the direction you're running.
- **Vertical**:
  - If the view has at least 36 rows (the room with its walls), the whole room height is shown, centred,
    and everything outside the room is dark.
  - Otherwise it follows you. It keeps the floor in view while you're within about a screen of it, and
    follows you up beyond that.
- It is clamped to the room, so side view never shows anything outside the arena.

### Phones in portrait

- Landscape is the intended way to play. Since the landscape fix, a landscape phone sees about 140 × 32
  cells.
- In portrait, entering the arena shows a hint: "turn your phone sideways for the arena ↻". It fades
  after 4 s or on a tap. The arena is still playable.
- Rotating re-fits the view.

## 5. The transition

- It is triggered when the player's cell moves from the corridor into the arena, or back out.
- **Entering** (about 0.6 s):
  1. The current view tilts away: a CSS `perspective` + `rotateX` on the stage, up to about 55°, over
     0.3 s.
  2. The mode switches. You stand on the floor just inside the door, facing west, and the camera snaps
     to its arena position.
  3. The side view tilts in from about −55° to flat over 0.3 s.
- **Leaving**: the same in reverse. You end up in the corridor facing east.
- Movement input is ignored during the transition.
- **Reduce Motion**: an instant cut, with no tilt.
- The tilt is a CSS transform on the gallery canvas, so it costs almost nothing.

## 6. Light: halation

- **Arena lights**:
  - Every `═` and `▓` cell is a small static light: a warm-white core and a soft red-orange halo with a
    radius of about 3–4 cells. Like film halation, it bleeds onto the photo around it.
  - These lights are cast once when the arena is set up, using `light.js`'s existing static-light buffer
    and the renderers' additive glow layer, so they cost nothing per frame.
- **Platform glyphs** are drawn in a bright warm white.
- **Ambient light**:
  - The arena has its own ambient light, a neutral **0.75** in place of the gallery's moonlight 0.2. The
    photo reads clearly but is darker than the glowing platforms.
  - The lantern you carry is off in the arena.
- **Reduce Motion**: the same picture. Nothing in the halation animates.

## 7. Multiplayer

- **Protocol**: unchanged. Positions are still map cells, so people in the arena show up in side view
  with names, emotes and chat lines, using the same smoothing (250 ms behind).
- **Who is drawn**:
  - People inside the arena are not drawn in other people's top-down view, and the side-view camera
    never shows the outside.
  - Join and leave announcements already work per room, and the arena is a room.
- **Known limitation**:
  - At 5 position updates a second, other people's jumps are seen as a few straight segments rather than
    a smooth arc.
  - This is acceptable for this sub-project. PvP (sub-project 2) revisits how movement is sent, since
    aiming and hits need more than this.

## 8. Failures

| Situation | Behaviour |
|---|---|
| `ARENA.enabled: false` | No arena, corridor or sign; the gallery is exactly as today |
| Photo id not in `photos.json` | Dark backdrop and `console.warn`; the arena still works |
| Image fails to load | Same fallback as prints |
| `arena.txt` malformed | Caught by the unit test before it can ship; at runtime, bad characters are treated as air |
| Multiplayer off or down | The arena works alone |
| Window resized or phone rotated in the arena | The view re-fits; the camera re-clamps |

## 9. Testing

- **Unit** (`npm test`):
  - `test/arena.test.js`, the level file:
    - 34 × 160;
    - only known characters;
    - the door cells are clear;
    - every `═` and every top of `▓` can be reached from the floor. A standing spot reaches another if
      it is at most 5 rows up and within 12 columns.
  - `test/arena.test.js`, physics:
    - falling lands on the floor;
    - a full jump rises 6 ± 0.5 rows;
    - a short hop rises less than 4;
    - you stand on `═`, jump up through it and drop down through it;
    - `▓` blocks from every side;
    - nothing tunnels at 20 fps;
    - coyote time and the jump buffer each allow a jump that would otherwise miss.
  - `test/layout.test.js`:
    - the arena is west of the lobby;
    - its interior is 160 × 34;
    - its door lines up with the corridor;
    - it is reachable from spawn;
    - no room overlaps it;
    - `ARENA.enabled: false` removes it.
  - `test/data.test.js`: the arena photo is excluded from the rooms but present in `byId`.
  - `test/world.test.js`: fake visitors never plan a path into the arena.
- **e2e** (`e2e/run.mjs`, `e2e/multiplayer.mjs`):
  - walking west through the door switches to side view (with Reduce Motion, at once) and back;
  - a jump lands you on a platform;
  - the backdrop is drawn;
  - at 852 × 393 with touch, `◀ ▶ JUMP ▼` are shown and work;
  - in portrait, the hint shows;
  - the viewer's `arena →` button takes you to the door;
  - two browsers see each other in the arena;
  - no page errors.

## 10. Out of scope

- PvP: health, guns, hits, respawning, spawn points, scores. That is sub-project 2.
- Smoother remote jumps (higher send rate or prediction). Revisited with PvP.
- Moving platforms, hazards, pits, ladders, more than one arena.
- Automatic photo rotation (changing it stays a one-line edit).
- An in-browser level editor.
