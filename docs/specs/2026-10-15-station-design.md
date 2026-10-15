# The station: the first place outside the museum

**Status:** design approved in conversation on 2026-10-15. The user wants a top-down story RPG that you
reach by leaving the gallery. It is in the Octopath Traveler (HD-2D) look, and the first area is a subway
station. This first slice is **just the place**: no people, no story, no fighting. The point is to get the
look, the movement and the way in and out running. The user picked the look from mockups ("Octopath,
ASCII world", `.superpowers/brainstorm/…/visual-style-d2.html`, the second card) and asked for the passing
train.

## 1. In and out

- **The stairwell.** The lobby gets a stairwell going down, drawn in the museum's own ASCII look, with a
  `▼ SUBWAY` sign over it. It goes against a wall, off the line you walk from the spawn and clear of the
  site name, the arena corridor (west) and the darkroom corridor (east). Its cells are a new tile kind
  in `src/layout.js`, walkable like floor.
- **Going down.** Standing on the stairwell, or tapping it and arriving, does the following:
  1. The gallery fades to black (300 ms) and freezes: no input, no world step, no rendering.
  2. `import('./rpg/index.js')` loads the station code and three.js. The museum's bundle doesn't include
     them, so the gallery's first load is unchanged. While the import runs, the fade shows
     `▼ going down…`.
  3. `startStation(stage, { onExit })` builds the station into its own canvas over the stage, and fades
     in with you at the spawn, at the foot of the stairs.
- **Coming back up.** Walking onto the station's exit stairs fades out and calls `onExit`. Then:
  - The station is disposed: its loop is stopped, its listeners removed, its canvas removed, and every
    three.js geometry, material, texture and render target is disposed.
  - The gallery resumes, with you standing in front of the stairwell and facing away from it, so you
    don't go straight back down.
- **The address.** The station's hash route is `#/station` (`src/router.js` gets `kind: 'station'`).
  - Going down pushes it, and coming up replaces it with the lobby.
  - The browser's back button while in the station takes you up.
  - Loading the page with `#/station` builds the gallery as usual, then goes straight down without the
    fade.
- **Multiplayer.** There is none in the station for now. While you're down there, the gallery treats you
  as gone: the same message as leaving the page. When you come up you rejoin with your name. Chat,
  emotes and the HUD's gallery buttons are hidden in the station.

## 2. Code

All of it lives in `src/rpg/`. Each file has one job, and the files with no three.js code are unit
tested.

| File | Job | three.js |
|---|---|---|
| `station.txt` | The map (§3). | none |
| `map.js` | `parseStation(text)` returns `{ name, cols, rows, cells, spawn, exits, levelAt(x, z), solidAt(x, z), tubes, tracks }`. | none |
| `check.js` | `checkStation(map)` returns a list of `{ row, col, msg }` errors (§3). | none |
| `move.js` | `stepWalker(w, dt, input, map)`: tight free movement, collision and stairs (§4). | none |
| `train.js` | `trainAt(t, map)` gives where the passing train is, or null (§5). | none |
| `scene.js` | Builds the station's meshes, lights and glyph textures from the map. | yes |
| `sprites.js` | ASCII art turned into upright billboard sprites: canvas textures on planes. | yes |
| `post.js` | Bloom and tilt-shift depth of field. | yes |
| `index.js` | `startStation(stage, { onExit, reducedMotion })` returns `{ stop() }`: the loop, the camera, input and lifecycle. | yes |

`three` is added as a dependency, at an exact version. The station uses the three.js renderer, the
`EffectComposer` and the bloom pass from `three/examples/jsm` (`three/addons`). It does not use
the museum's renderers.

## 3. The map format

`src/rpg/station.txt` is a text grid. One character is one tile, and a tile is 1 × 1 world units. The
player is about 0.5 units wide and 1.6 tall. It begins with header lines:

```
name: MUSEUM          the station's name, shown on the wall signs
# anything after a # at the start of a line is a comment
```

The grid follows the header. Every row is the same width.

| Char | Tile | Floor level | Walk |
|---|---|---|---|
| `#` | wall, tiled, up to the ceiling height (4) | n/a | no |
| `.` | ticket-hall floor | 0 | yes |
| `_` | platform floor | −3 | yes |
| `!` | platform edge: the yellow line, walkable, the last row before the tracks | −3 | yes |
| `=` | track bed; trains run here | −4.2 | no |
| `v` `^` `<` `>` | stairs: the floor goes **down** in the arrow's direction, from the level behind the run to the level in front of it | sloped | yes |
| `|` | pillar, floor to ceiling | n/a | no |
| `b` | bench, 0.5 high | as the floor around it | no |
| `t` | turnstile post | 0 | no |
| `:` | turnstile gate, walkable between posts | 0 | yes |
| `k` | kiosk, closed, its shutter down, 2.2 high | 0 | no |
| `n` | a wall with the station-name sign on its face | n/a | no |
| `~` | a puddle: floor, with drips falling into it | as the floor around it | yes |
| `S` | spawn: floor, where you appear coming down | as the floor around it | yes |
| `E` | exit stairs up to the museum: stepping on one leaves | sloped | yes |

- **Fluorescent tubes** aren't in the map. They are placed automatically: along the platform's middle
  every 5 tiles, and on a 6-tile grid over the hall.
- **Tunnels.** A track row that reaches the map's edge goes into a tunnel there, a dark arch in the end
  wall.

**`checkStation` reports:**
- rows of different widths, and unknown characters;
- not exactly one `S`, or no `E`;
- any walkable tile that can't be reached from `S`, and any `E` that can't be reached;
- a stair run whose two ends don't land on the two levels its arrow implies;
- a track row that doesn't run edge to edge;
- a track with no `!` row next to it;
- a `!` that isn't next to `=`.

A unit test fails if the shipped `station.txt` has any errors. The format is written up for authors,
human or model, in `src/rpg/MAPS.md`: this table, the checker's rules, and the command to check a map
(`node src/rpg/check.js <file>`).

**The layout** for this slice is about 48 × 32 tiles:
- the exit stairs come up from the hall's back wall;
- the ticket hall has a row of turnstiles and the kiosk;
- a wide stair run goes down to an island platform between two tracks;
- each track has a tunnel at both ends;
- the platform has pillars down the middle, benches between them, name signs on the walls across the
  tracks, and a puddle or two under a leak.

## 4. Movement and camera

- **Movement** (`move.js`) is free and tight, not floaty:
  - **Speed:** walking speed is 4.2 units/s, and Shift sprints at 1.6× that.
  - **Acceleration:** it takes 0.04 s to reach about 63% of the target speed, and you stop just as fast
    when you let go.
  - **Diagonals:** they are normalised, so moving diagonally is no faster.
- **Collision:** you are a circle of radius 0.25 against the solid tiles and the map's edge, and you
  slide along walls. Corners you clip by less than 0.2 nudge you round, as the museum does.
- **Height:** on stairs your height follows the slope, and elsewhere it is the floor's level.
- **Input:**
  - **Keyboard:** WASD or the arrows, as in the museum, using `createInput`'s movement vector.
  - **Touch:** hold a finger on the screen to walk toward it. It's direction only, at walking speed, and
    lifting the finger stops you. There is no pad. (This replaces "the same pad as the Arena": that pad is
    only left and right.)
- **Camera:**
  - It is pitched 35° below horizontal, about 10 units from you, and shows about 12 tiles across on a
    desktop and 8 on a phone in portrait.
  - It follows a point 1 unit above you with a 0.15 s spring, and is clamped so it never shows past the
    map's outer walls.
  - It never rotates.
  - When you stand near a wall on the camera's side, that wall fades to 25% so you stay visible.

## 5. The look and the life

The look is the chosen mockup ("Octopath, ASCII world"), rebuilt in three.js:

- **Surfaces.** Walls, floors, stairs, pillars and the kiosk are lit 3D shapes with faint ASCII painted
  on: canvas textures at about 35% opacity.
  - **Walls:** tile grids `┼`.
  - **Floors:** a loose `·` lattice.
  - **Platform edge:** a yellow `▀` stripe.
  - **Track bed:** ties `═`.
  - **Stairs:** treads `─`.

  The surfaces stay calm: no random specks, no per-tile colour noise.
- **Sprites.** Sprites are upright ASCII planes, sized by world height.
  - **You:** the 4-line figure with a lantern `¤`, with a 2-frame walk cycle driven by distance walked.
    It flips to face the way you walk, has a blob shadow, and is always the crispest, brightest thing on
    screen.
  - **Props:** a bin, a map board, a vending machine and posters on the walls are sprites too.
- **Light.**
  - **Ambient:** cool and dim.
  - **The tubes:** each is cool white, and one of them flickers on its own timer.
  - **Your lantern:** a warm point light that moves with you, with a slight flicker.
  - **Bloom:** on the tubes, the lantern and the train's lights, but gentle. The mockup's door was blown
    out, so bright areas are capped, not just blurred up.
- **Depth of field.** A tilt-shift blur in `post.js`: sharp in a band around your row, blurring toward
  the top of the screen (more) and the bottom (less). It's drawn at half resolution.
- **The passing train** (`train.js`, drawn by `scene.js`):
  - **When:** every 30–40 s on a deterministic schedule, alternating tracks, a train comes out of one
    tunnel, rushes along the platform at about 25 units/s without stopping, and goes into the other.
  - **Its build:** 4 cars of lit boxes with ASCII panels and lit windows. The headlights bloom, and a
    light sweeps the platform edge ahead of it.
  - **Warnings:** 3 s before it arrives, the tunnel mouth glows and the dust stirs. As it passes, the
    dust is blown along, the tubes nearest it flicker, and the camera shakes very slightly (none with
    reduced motion).
  - **No contact:** it can't touch you, because the tracks aren't walkable.
- **Other life:** dust motes drift in the tube light, water drips into the puddles with a ripple, and a
  sheet of newspaper skitters in the train's wind.
- **Reduced motion** (`prefers-reduced-motion`): no camera shake, no flicker strobe, and slower motes.
  The train still passes.

**Performance:**
- **Device-pixel-ratio cap:** 2 on desktop, 1.5 on phones. The post-processing runs at half
  resolution.
- **Frame rate:** the target is 60 fps on a laptop and 30 or more on a recent phone.
- **When hidden:** the loop pauses while the tab is hidden.

## 6. Testing

- **Unit** (`node --test`, as for the rest of the site):
  - `parseStation`: levels, solids, spawn and exits, and the stairs' slope.
  - `checkStation`: each rule, with a small bad map for each, and the shipped map passes.
  - `stepWalker`: speed, acceleration and stopping; diagonals normalised; sliding along walls; the
    corner nudge; walking up and down stairs; never entering a solid tile or leaving the map.
  - `trainAt`: the schedule, the alternating tracks and its position over time.
  - `router`: the `#/station` route.
- **End to end** (`e2e/station.mjs`, puppeteer, joining `npm run e2e`):
  - load the site, walk onto the lobby stairwell, and wait for the station (`window.__station`);
  - check the canvas has drawn (not blank) and there are no console errors;
  - walk a few steps and check you moved, then wait for a train to pass;
  - walk onto the exit and check you're back in the lobby in front of the stairwell;
  - load `#/station` directly, and use the back button.

  It takes screenshots at a few moments for a look.
- The gallery's existing unit and e2e checks must still pass. The memory note "test only what's
  relevant" applies to pushes, and this change touches the lobby and `main.js`, so the gallery's e2e is
  relevant.

## 7. Not in this slice

People, dialogue, quests, items, saving, fighting, boarding the train, other areas, multiplayer in the
station, and sound. The station's code is kept in `src/rpg/` so the next areas reuse `map.js`,
`move.js`, `sprites.js`, `post.js` and the camera.
