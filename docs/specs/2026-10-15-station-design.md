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
- **Multiplayer.** The station has its own multiplayer (see "Multiplayer" below). Going down doesn't
  disconnect: the gallery sees you leave and the station sees you arrive. The HUD's gallery buttons are
  hidden in the station; its own chat-and-emotes bar shows instead.

## 2. Code

All of it lives in `src/rpg/`. Each file has one job, and the files with no three.js code are unit
tested.

| File | Job | three.js |
|---|---|---|
| `station.txt` | The map (§3). | none |
| `map.js` | `parseStation(text)` returns `{ name, cols, rows, cells, at(c, r), spawn, exits, levelAt(x, z), solidAt(x, z), tubes, tracks, signs }`. | none |
| `check.js` | `checkStation(text)` returns a list of `{ row, col, msg }` errors (§3). It takes the text so it can see ragged rows. | none |
| `move.js` | `stepWalker(w, dt, input, map)`: tight free movement, collision and stairs (§4). | none |
| `train.js` | `trainAt(t, map)` gives where the passing train is, or null (§5). | none |
| `camera.js` | The follow spring, the clamp and the field of view (§4). | none |
| `gates.js` | The turnstiles: shut or open for you, the ticket, the wallet (§5b). | none |
| `life.js` | Pigeons, rats and commuters as small seeded state machines, and pushing you out of people (§5b). | none |
| `ticket.js` | The ticket machine pop-up (DOM) (§5b). | none |
| `sound.js` | The sound's arithmetic: footfalls, surfaces, the train's loudness and pan, the PA's schedule, the music by the stairs (§8). | none |
| `audio.js` | The station's Web Audio: the mixer, the synthesized and recorded sounds, the speaker button (§8). | none |
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
; a line starting with ; is a comment (# is a wall)
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
| `E` | exit stairs up to the museum: stepping on one leaves; drawn as steps rising into the wall | as the floor around it | yes |

- **Fluorescent tubes** aren't in the map. They are placed automatically: along the platform's middle
  every 5 tiles, and on a 4-tile grid over the hall.
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

**The layout** for this slice is 48 × 19 tiles:
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
  - When you stand near a wall on the camera's side, that wall fades to 20% so you stay visible (20% since the look pass).

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
  the top of the screen (more) and the bottom (less). It's a cheap 9-tap blur at full resolution; the bloom runs at half resolution.
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
- **Device-pixel-ratio cap:** 2 on desktop, 1.5 on phones. Bloom runs at half resolution; the
  tilt-shift runs at full.
- **Frame rate:** the target is 60 fps on a laptop and 30 or more on a recent phone.
- **When hidden:** the loop pauses while the tab is hidden.

## 5b. Life and props (round 2)

Added on 2026-10-15 after the user said "make it more lively, the things on the wall make no sense" and
"make the turnstiles actually work with a pop up for payment". People are now in scope: **commuters only**
(no dialogue, no story).

- **Wall things that read as what they are** (`sprites.js` PROPS, placed in `scene.js`):
  - the hall's north wall: the kiosk with a `CLOSED` sign on its shutter and a buzzing lamp over it, the
    **line map** (`MUSEUM ● ━ ● ARCADE ━ ● DARKROOM ━ ● GORGE`, `▲ YOU ARE HERE` under MUSEUM), and the
    **drinks machine** (`DRINKS`, shelves of coloured cans, `$1.50`, a lit coin slot) beside the turnstiles;
  - on the stair wall over the turnstiles: a **wall clock** (real local time, `HH:MM` LED, the colon ticking;
    steady with reduced motion) and the **departures board** over the stair head: amber LED text on black that
    blooms, redrawn only when its text changes (looked at four times a second). It shows `NEXT TRAIN` and `THEN`
    counting down in whole minutes, then `<1 MIN`, from `train.js`'s schedule (`departures(t, map)`); from 5 s
    before a train until it has gone it shows `NOT IN SERVICE` / `STAND BACK` (blinking; steady with reduced
    motion);
  - on the far wall across the north track, facing the platform: a `faiz.pics — NOW SHOWING` poster with a
    small ASCII photo frame, a yellow `MIND THE GAP` notice, and a torn `LIVE AT THE GORGE` poster whose loose
    corner flaps in a north-track train's wind;
  - the bins read `TRASH`; the `▲ MUSEUM` way-out sign stays.
  - **Lights and signs in front of you fade, never vanish**: a tube bar, sign, poster, board, bin or other
    prop between the camera and you (the walls' rule) eases to the walls' 20% opacity with its colour dimmed
    (so bloom can't blow a faded tube back to white), writes no depth and draws after you, like the faded walls.
    The hall's tubes hang over rows 7 and 11, so none sits in front of the north wall's signs.
  - The tilt-shift's sharp band is wider and its top blur lighter (band 0.18, top 2.0) so the signs a few
    tiles north of you are readable.
- **Life** (`life.js`, pure and seeded; drawn by `scene.js`):
  - **pigeons** (4) on the platform peck (the head bobs), hop a little, and flutter off (up and away, fading)
    when you come within 1.5 or a train's tunnel starts to glow; they glide back to their spot 8–14 s later;
  - **rats** (2) nose about on the track beds and run into the nearer tunnel when a train is about 3 s off,
    coming out a little after it has gone;
  - an **LED ticker** hung between two pillars scrolls "THE NEXT TRAIN DOES NOT STOP AT THIS STATION · PLEASE
    STAND BEHIND THE YELLOW LINE · …" a whole character at a time (one texture, scrolled by its offset); it
    hides when it hangs between the camera and you;
  - a **steam vent** in the hall floor puffs soft steam; the **kiosk lamp** buzzes and dips.
  - Reduced motion: no wing strobe, no kiosk flicker, a slower ticker, fewer and slower puffs.
- **Turnstiles**, New York style and generic (no real transit names or logos) (`gates.js`, pure; `turnstiles.js`,
  the drawing; `ticket.js`, the DOM). Added after the user said "ny style turnstile lets do that".
  - **Behaviour:** the `:` gates are shut coming from the hall side (moving east) until you hold a ticket; coming
    from the platform side is free. The walker collides with `gatedMap(map, gates, walker)`, the map with the shut
    gates solid. A single ride is used up when you come out of the gate on the platform side; an unlimited ride
    lasts the visit, shown by a small `▣ UNLIMITED` chip (`▣ SINGLE RIDE` while you hold a single).
  - **Look:** the station's own, not shiny 3D: matte boxes with one faint glyph per face like the benches and the
    kiosk (a first glossy version with chrome rods and ball ends was "ugly"). No screens: after "we dont need sreens
    on the turnstile" the LED readers (`TAP HERE`, `GO`, `INSUFFICIENT FARE`, the swipe-again joke) went.
  - **A sealed line:** after "theres like empty space where u can slip through ... in real life", nothing a person
    could squeeze through. Each `t` post is a waist-high (0.95 + a lighter top slab) steel cabinet filling its tile
    and reaching 0.08 (`LANE_IN`) into each gate tile beside it, so a lane between two posts is 0.84 wide, cabinet
    to cabinet. There are no cabinets at the walls (the ones that ran 0.3 into the wall at each end of the line
    clipped into it, and the one by the emergency gate carried no arm): a lane beside a wall has the wall as its
    side, so every cabinet carries a rotor. Sides a faint `═`, top `─`, a dark kick plate. A cool
    light hangs over the line. (A fifth lane was tried for "too much empty space" and taken out again: "extra one
    didnt help".)
  - **Rotor:** each turnstile lane has a three-armed rotor on its north cabinet: three square steel bars 120° apart
    on a dark hub, its axis tilted 60° down into the lane, so one arm is always level across the lane at waist
    height, reaching to a hand's width (0.08) of the next cabinet, and the other two point down along the cabinet.
    It turns a third of a turn as you push through, driven by where you are, not a timer (`pushFrom`: nothing until
    your front reaches the level arm, `ARM_X` into the gate, then over 0.7 of walking, clicking over by itself for
    the last 15%); from the camera, south of the line looking north, a rotor only shows on the cabinet north of its
    lane, which is why the paid lanes are the ones with a post north of them. When you leave the gate a full push becomes its new rest and a part push springs back. Locked,
    you stop at the tile's edge against the level arm and it doesn't move. Going back to the hall you push it the
    other way.
  - **Tap target:** on top of the same cabinet a flat round puck, `◎` in geometry (a dark disc, a lit ring and dot),
    no text: dim white idle; green at the gate you're walking up to while you hold a ticket; red for 1.2 s
    (`REFUSED_FOR`) when you walk into it locked (`ringState`).
  - **Emergency exit gate** (`gateKinds`: the northernmost gate of each column of two or more is kind
    `'emergency'`; on the shipped map row 6, beside the north wall and the drinks machine; it was the southernmost,
    row 12, until that left post 11's cabinet with no arm). Replaces the first try, a decorative gate in a
    recess north of the line that "is blocked" (it led into a wall). A barred steel swing gate, 1.2 high, hinged on
    a post against the north wall and, shut, reaching south across its lane to just short of post 7's cabinet; a push bar on the platform side. The
    hinge post carries on up as a lighter steel sign post: the red `EMERGENCY EXIT / ALARM WILL SOUND` sign, facing
    the camera, is clamped to it, and the alarm light in a dark housing sits on its top (hung on the see-through south
    wall, where the gate first was, they looked as if they floated). Exit only, free: from the hall it's locked, ticket or not, and walking into it doesn't
    open the fare card machine (`blocked`, not `bumped`), just a 0.5 s steady red of the light. From the platform
    your front pushes it and it swings toward the hall following you (`swingFrom`: the angle at which the panel
    touches you, held right open once your middle passes the hinge line, so it's clear of you), and once you're out
    on the hall side the alarm sounds for 3 s (`ALARM_FOR`, `alarmOn`): the light flashes 3 times a second with a
    red glow (steady red with reduced motion). Clear of its sweep it swings shut by itself (`swingGates`). A single
    isn't used up going out this way.
  - **Fare card machine:** walking into a shut turnstile stops you and opens an ASCII pop-up styled on a fare card
    vending machine, a dark blue screen in a brushed-steel bezel (`FARE CARD`: `▸ single ride $2.90`,
    `unlimited ride $7.00`, `[ BUY + TAP ]`, `balance $20.00`, `esc ×`). It sits high on the screen so the gate stays
    in view. ↑/↓ choose, Enter buys, Esc closes; a tap picks or presses, a tap outside closes. While it's open you
    don't move and keys go to it alone (a capture listener). Buying takes the price from an in-game balance
    (starting at $20.00, per visit), shows `✓ beep`, closes, and the gate's tap target turns green. What the readers
    used to say is said here: `ride used · buy another` once you've used a single, and short of money
    `insufficient funds` and a `[ top up +$20 ]` button. No real payment fields of any kind. It doesn't reopen until
    you stop pushing the gate. It's created and removed with the station.
  - Test hooks: `__station.gates()` also gives each gate's `kind`, `ring` state (`null` for the emergency gate),
    `rotor` turns and emergency `swing`, and whether the `alarm` is sounding.
- **Commuters** (4; `life.js` behaviour, `rig.js` + `figure.js` drawing): the same stick figure in muted
  colours (cool greys, a teal coat, a dusty red) with no lantern; one holds a phone (`rig.js`'s `phone` pose,
  a small lit screen and a faint light). They breathe, shift their weight (`shift`), turn to look down the
  track now and then, and when a train passes they turn to watch it, the ones by its track stepping back 1.0
  from the edge (a couple of real backward steps at walking pace, still facing the track), then settle. After
  "the people just glide they dont have walking animations", their rigs walk as yours does (`stepGait` in
  `rig.js`): the cycle advances by the ground they cover at your stride, so the feet don't skate, and runs
  backward when they move against their facing; the gait is their smoothed speed over walking speed, blending
  back to idle at rest; walking somewhere they turn toward it with `turnToward`. One paces slowly between two spots and waits rather than walk into you. They're
  solid (a 0.25 circle you're pushed out of) and never leave the platform. Their figures are disposed with
  the station.

## 5c. Multiplayer

Approved in conversation on 2026-10-16. Other people in the station are drawn as people, the train is the
same for everyone, and the lobby shows how many are below.

- **One connection, with areas.** Each connection carries an `area`: `'gallery'` (the default) or
  `'station'`.
  - `{t:'z', area}` moves you, optionally with where you are in the new area. The server checks the area
    is a known one and gives `z` its own bucket: 3 in hand, then 1 a second. The page sends at most one a
    second, and if you change your mind within that second only the latest is sent.
  - The server sends `p`, `q`, `e`, `r`, `c`, `n`, `join` and `leave` only to people in the same area.
    Arena messages work only in the gallery.
  - On a move, your old area gets `leave` and your new one gets `join`, with your name and position. You
    get `{t:'zw', area, peers, now}`: who's already there. Until `zw` arrives the page drops anything from
    the area it has left. A `z` to the area you're already in just gets the list again.
  - `hi` may carry `area` (for a direct `#/station` load, and a reconnect while you're below).
  - Hiding the tab still pauses the connection after 30 s. When the tab comes back, `hi` rejoins the area
    you're in.
  - A page that never sends `z` (an old one) is in the gallery. A new page on an old server (its `welcome`
    has no `area`) falls back to the old behaviour: off the net while it's below.
- **Positions.** `{t:'q', x, z, y?, a?}`: world x and z, the floor under your feet (`y`, on stairs) and
  your yaw (`a`), each to 0.01. They go through the same throttle as the gallery's `p` (at most 5 a second),
  and only when they change by 0.01, or the yaw by 0.05. The server drops any that aren't finite or fall
  outside the map (`STATION` in `server/rules.js`, 48 × 19, y in −5…1; a unit test checks it against
  `station.txt`), and any yaw outside ±π. The gallery's `p` is unchanged.
- **Seeing each other** (`src/rpg/peers3d.js` pure, `src/rpg/others.js` draws):
  - Each person is the stick figure in their `peerColor(id)`, bright as you are and with no lantern. Their
    name is in that colour over their head.
  - Positions are drawn 300 ms behind, between the two received around that moment. A jump of more than 3
    tiles (a teleport) is a jump.
  - The walk comes from the drawn motion, as the commuters' does. Each figure faces where it goes (or the
    yaw it sent while standing), turns with `turnToward`, and `stepGait` runs the stride by the ground it
    covers.
  - Other people aren't solid, so a laggy one can't trap you. Their figures go when they leave, and all of
    them go with the station.
- **Chat and emotes.** While you're below, **T** or **Enter** opens the gallery's chat line. A bar at the
  bottom right holds `[T] chat` and the five emotes; keys **1–5** emote too. What anyone says floats over
  their head for 5 s (wrapped, at most three lines), with an emote over it for 2.5 s. These labels draw over
  pillars, so they stay readable. Your own words show over your head at once. The server filters chat as
  in the gallery.
- **The same train.** The train's clock is shared: `sharedTime(epoch ms)` in seconds, modulo `PERIOD`
  (2400 runs, about 23 h), where the epoch is the server's clock. `welcome` carries the server's `now`, and
  the page counts half the round trip. Without a server it's this machine's clock. Trains, the departures
  board, the tunnel glow and the commuters' reaction all follow it. The station's own time (lights,
  pigeons, turnstiles) stays local. `__station.setTime(s)` pins the train to the station's own clock, as
  before, for tests, and `__station.clock()` reads the train's time.
- **Kept local:** tickets, wallet, gates and the turnstile you're pushing; pigeons, rats and commuters.
- **The lobby.** `welcome` carries `station`, the number of people below. Everyone gets `{t:'zc', station}`
  whenever it changes (a move, or someone below leaving). The lobby's sign then reads `▼ SUBWAY · 2`. The
  count is drawn as glyphs after the sign's label, in the sign's colour, whenever it's at least one.
- **Tests:** server (`server/test/server.test.js`): filtering by area, leave and join on a move, `z`
  validated and rate-limited, an old page in the gallery, bad station positions dropped, and the counts.
  Unit tests (`test/station-peers.test.js`, `live`, `net`, `rules`): smoothing and the walk, the shared
  clock, and the wire's messages. End to end (`e2e/station-mp.mjs`, three browsers against `wrangler dev`):
  two go down and see each other walk and talk under the same train; the third, in the gallery, sees the
  count and who comes back up.

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

Dialogue, people other than the commuters and other players, quests, items, saving, fighting, boarding the
train, and other areas. (Sound and multiplayer were here; they're now in: §8 and Multiplayer.) The station's code is kept in `src/rpg/` so the next areas reuse `map.js`,
`move.js`, `sprites.js`, `post.js` and the camera.

## 8. Sound

Added on 2026-10-16 ("start on sound"; then "smooth jazz in the museum and u can hear by the entrance of subway").

- **Web Audio**, in `audio.js`, made with the station and closed with it (its `stop()` closes the AudioContext and
  removes its button and listeners). A small mixer: master (through a gentle compressor) fed by ambience, effects and
  train buses, and a shared generated reverb for the tiled space. Each sound is placed by its distance from you and a
  stereo pan by how far east or west of you it is (`spatial` in `sound.js`; the camera looks north from behind you).
- **What plays.**
  - The train: a rumble building in its tunnel for 7 s (the last 3 with the glow), a roar (a looped recording under
    filtered noise), the wheels' screech and the rails' clatter (each axle knocking over a joint every 12 units) as
    it passes, loud and panned by where it is; wind behind it; the rumble fading into the other tunnel over 4.5 s. In
    the hall it's quieter and muffled, through the walls.
  - Ambience: the fluorescent hum by the nearest tube, the faulty tube's buzz and crackle in time with its flicker
    (`tubeFault`, shared with `scene.js`), drips as each drop lands (`DRIP`, shared), the steam vent's hiss, a low
    far-off city, and every minute or so (never over a train) a PA chime and a muffled, wordless voice.
  - You: footsteps as each foot comes down (the walk cycle's phase), by the tile you're on: hard tile in the hall,
    gritty concrete on the platform, hollow on the stairs (`surfaceAt`; MAPS.md). The fare machine bleeps and
    chimes; a turnstile double-beeps green as you come up to it with a ticket and buzzes low when you walk into it
    locked; its rotor clunks as it takes you, ratchets and clunks over; the emergency gate's push bar clanks and its
    alarm sounds while the light flashes.
  - Life: pigeons coo and their wings flap as they fly off and land, rats squeak, commuters' footsteps are faint,
    and the torn poster flaps in a north train's wind.
- **Unlock:** nothing plays until a key press or tap after you arrive; that gesture resumes the context. Hidden tab:
  suspended, resumed on return.
- **Mute:** a speaker button top right in the ticket chip's style (`◀))` / `◀ ×`) and `M` (or `V`). Remembered in
  localStorage (`faiz.sound`, `on`/`off`, every access wrapped; `sound-pref.js`) and shared with the museum's music.
- **Reduced motion:** everything plays, but the alarm sounds once briefly instead of for its 3 s, and the train is
  softer.
- **The museum's music** (`src/music.js`): quiet lobby jazz in the gallery (Kevin MacLeod's "Lobby Time": vibraphone,
  piano, bass and drums; CC BY 4.0, credited under the map and in the sound button's tooltip; it replaced a 46 s CC0
  smooth-jazz loop on 2026-10-16, "this jazz sucks"), its intro once and then 64 bars looped, from the visitor's
  first key press or tap. That gesture is when `music.js` is imported and the track loads, so the gallery's first
  load carries only `sound-pref.js` and a few lines in `main.js`. A `[♪] sound` HUD button and `V` (M is the map) mute it, the same
  remembered setting. Paused while the tab is hidden. There's one context and one looping source for the visit: going
  down, the station doesn't start its own copy, it places this one (`stairsMusic`): heard drifting down the exit
  stairs, muffled (low-passed), loud at their foot and gone 7 tiles into the hall; coming back up it eases back to full,
  where it had got to.
- **Assets** (`src/rpg/assets/sound/`, `CREDITS.md`): synthesized where that sounds good; small re-encoded clips of
  CC0 recordings (Kenney, Freesound) and of Adobe Audition's free sound effects (royalty-free in a project, not as
  standalone files) for the footsteps, the rotor and gate, the pigeons, rats, drips, screech, the train's roar and the
  city. About 160 KB for the station, loaded after it starts (a clip that fails is skipped); the music is 1.8 MB
  (96 kbps, 2:27).
- **Tests:** `sound.js` and `sound-pref.js` are unit tested; the e2e checks that nothing is made before a gesture,
  that the context runs after a key press, that M and V mute and persist across a reload, that leaving closes the
  station's context, and that fifteen trips leave only the music's context and one music source.
