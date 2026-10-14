# Arena stickman: design

Date: 2026-10-14
Status: approved design, not built yet. It changes how people look and move in the arena's side view. PvP
(health, guns, melee, respawning) is a separate spec written alongside this one; this spec covers only how
each body **looks and animates**, the body's size, and what that size means for the level.

## 1. Intent

In the arena's side view, every person is an ASCII stick figure in the Alan Becker style (Animator vs
Animation): one bold colour per figure, a round head, thin straight limbs, big readable poses. The poses are
a few hand-made frames built from glyphs, but the figure itself **moves smoothly**: its position is never
snapped to the cell grid, only to device pixels.

### Choices made for you

Each can be changed; the alternative is given.

1. **The top-down gallery keeps `@`.** Top-down, a person is one cell seen from above, in 5-row corridors
   and next to 1-cell props. A 3-row figure there would look like someone lying down. The swap happens
   at the door, hidden by the tilt. *Alternative:* a 1-cell stick glyph top-down as well.
2. **The body grows to 0.8 cells wide and 3 rows tall** (from 0.6 × 1), so what you see is what collides.
   The jump stays at 6 rows, which is two body heights. *Alternative:* keep the 0.6 × 1 physics body and
   draw a taller figure around it. Heads would then poke through `▓`, and PvP would hit a box a third the
   size of the figure.
3. **The figure is 3 rows tall** (head, torso and arms, legs). *Alternative:* 4 rows, with a hip row for
   better kicks. That needs a 4-row arena door and 4 rows of headroom everywhere.
4. **The run cycle is driven by distance, not time**: 4 frames per 12 cells run, so feet never skate and a
   slowing runner slows their stride. *Alternative:* a fixed 10 frames a second.
5. **Bold glyphs with a dark outline, and no box behind them.** *Alternative:* the dark cell box that `@`
   has today, which reads well but turns the figure into a stack of tiles.
6. **You are always amber, and nobody else can be.** Other people's colours skip the amber band.
   *Alternative:* a small marker over your own head.
7. **Death scatters the figure's glyphs**, which tumble, settle on the ground, then fade just before the
   2 s respawn.
   *Alternative:* an instant pop into sparks that leaves nothing behind.
8. **Names go above the head in the side view** (they stay below the `@` top-down). *Alternative:* below
   the feet, where they would collide with the platform being stood on.
9. **The aiming arm shows only while `act` is `'shoot'`.** *Alternative:* always point the arm at the aim,
   which shows everyone where you are aiming all the time.
10. **A hit flashes the figure white for 0.1 s.** *Alternative:* a red flash.
11. **Facing flips instantly** (the figure is mirrored), with no turn frame. *Alternative:* a one-frame turn
    pose.
12. **Reduce Motion keeps the run cycle and the action poses**, since you cause those and they carry
    meaning. It drops breathing, bob, squash, scatter, flashes and the respawn fly-in. *Alternative:* a
    static standing figure for everything except actions.

### Success criteria

- In the side view, you and everyone else are stick figures. Running, jumping, falling and landing are
  readable at a glance, and the figure glides rather than steps from cell to cell.
- Every PvP action (`shoot` at any angle, `punch`, `kick`, `hurt`, `dead`, respawn) has a pose you can
  recognise without reading anything.
- Figures, names and chat read clearly over the brightest and the busiest parts of the photo, on a laptop
  and on a phone in landscape.
- Thirty people in the arena cost under 2 ms a frame to draw, in both renderers.
- The top-down gallery looks exactly as it does today.

## 2. The body

### Size

| | today | new |
|---|---|---|
| physics box | 0.6 cells × 1 row | **0.8 cells × 3 rows** (`HW 0.4`, `HH 1.5` in `arena.js`, exported as `BODY = { w: 0.8, h: 3 }`) |
| on screen (cell is 1 × 2) | 1 glyph | about 2.1 cells × 3 rows: a figure three times as tall as it is wide |
| full jump (feet) | 6 rows | **6 rows, unchanged** (take-off 40 rows/s, gravity 133 rows/s²) |
| head at the top of a full jump | 7 rows above take-off | **9 rows** above the take-off surface |

- `x, y` stay the **centre of the box**, as in `arena.js` today. The feet are at `y + 1.5` and the top of
  the head at `y − 1.5`. Standing on the floor puts `y` at `floorY − 1.5`.
- `enterSide` places you at `a.floorY − 1.5`, not `− 0.5`. `exitSide` is unchanged.
- **The door fits exactly.** The arena door is the bottom 3 interior rows, and the body is 3 rows tall. The
  sub-stepping and `EPS` in `moveX` already let a box exactly as tall as a gap pass through it, and a unit
  test walks through the door both ways.
- Run speed, sprint, air control, coyote time, the jump buffer and drop-through are unchanged. With a body
  three times taller, a jump of two body heights still feels big and cartoonish, which suits the style.
- The PvP spec owns hit detection. The box it should test against is this one.

### What the size means for the level

The level is traced by hand on the backdrop photo (see §9). These are the clearances the drawing must meet,
and they become unit-test rules:

| rule | value | why |
|---|---|---|
| headroom over any standing spot (a `═` top, a `▓` top, the floor) | the **3 cells directly above** are air: no `▓` **and no `═`** | a `═` there doesn't block you, but the head would be drawn through a glowing platform |
| stacked platforms that overlap in columns | at least **4 rows apart** (a platform at row r, the next one up at r − 4 or higher) | follows from the headroom rule |
| highest standing spot | row **3** or lower (rows 0–2 can't hold a standing spot) | the ceiling is above row 0 |
| gap under a `▓` | **0 or at least 3 rows** of air between the bottom of a `▓` and the surface under it | a 1–2 row slot is a trap you can't stand up in |
| reach (existing rule, unchanged) | another standing spot counts as reachable if it is **≤ 5 rows up and within 12 columns** | feet still rise 6 rows |
| jump clearance for a reach to count | **9 rows clear of `▓`** above the take-off span | 6 rows of rise plus the 3-row body. `═` doesn't count, since you pass up through it |
| door (existing rule, unchanged) | bottom 3 rows × 4 columns next to the east door are air | the 3-row body fits the 3-row door exactly |

## 3. The shared state and the pose function

### Input

Each body (you and every remote person) has the state that the PvP layer produces and syncs:

```
{ x, y, vx, vy, facing: -1|1, ground: bool, aim: radians, act: 'idle'|'shoot'|'punch'|'kick'|'hurt'|'dead',
  actT: seconds since act began, hp: 0..max }
```

plus two fields that each client fills in for itself and **never syncs** (see Interface changes):

- `landT`: seconds since this body last touched down (`Infinity` while in the air, or before it has ever
  landed).
- `spawnT`: seconds since this body (re)appeared, either first seen or `dead` turning into anything else.

It also takes the two fields the PvP spec adds:

- **`safe`**: protection after spawning or entering. While it is on, the figure shimmers: the body
  glyphs' `a` follows `0.575 + 0.225 cos(2π × 3 × t)`, between 0.35 and 0.8, 3 times a second (a soft
  pulse, not a hard blink). With Reduce Motion it is a steady 0.5. Labels are not dimmed.
- **`combo`**: ignored. The two arms look alike, so a punch from the other fist would draw the same.

`hp` is not used by the figure. Health display belongs to the PvP spec.

### The function

`src/stick.js` (new, pure, no DOM):

```
stickPose(state, t, opts, out = []) → out: [{ dx, dy, ch, part, tone, a }]
```

- **`dx, dy`**: the glyph's centre relative to the body's `(x, y)`, in cells and rows. They can be any
  fraction. A glyph fills a 1 × 1 cell box centred there.
- **`ch`**: one character.
- **`part`**:
  - `head`, `torso`, `armB` (back arm), `armF` (front arm), `legB`, `legF`: the figure;
  - `gun`;
  - `fx`: flashes, whooshes, sparks.

  Tests and the PvP layer use it. The renderers ignore it.
- **`tone`**: `body` (the person's colour), `flash` (white, `[255, 255, 255]`) or `fx` (warm,
  `[255, 214, 140]`).
- **`a`**: opacity, 0–1, default 1.
- **`t`**: the world clock (for breathing).
- **`opts`**:
  - `{ reducedMotion, phase }`. `phase` (0–1) offsets the breathing so two people standing together don't
    breathe in step. It is a hash of the person's id; your own is 0.
  - `out` is appended to and returned, so 30 bodies a frame allocate nothing new.
- **Pure**: same input, same output; it never mutates `state` and never uses `Math.random`.
- **Defaults** for anything missing (an older client, or before PvP ships):
  - `facing` is `sign(vx)` or 1, `ground` true, `aim` 0, `act` `'idle'`, `actT` 0;
  - `landT` and `spawnT` are `Infinity`;
  - an unknown `act` is `'idle'`;
  - a negative or non-finite `actT` is 0;
  - `aim` is clamped to [−π/2, π/2].

### Composition

A pose is built in three layers, so actions work while running or in the air:

1. **Locomotion** gives every part:
   - on the ground: idle, run or land;
   - in the air: rise, apex or fall.
2. **The upper-body action overlay** (`shoot`, `punch`) replaces `armF` and may lean the torso and head.
   The legs keep running or flying.
3. **Whole-body actions** (`kick`, `hurt`, `dead`) and the respawn replace the pose entirely, except that
   `kick` keeps the head where locomotion put it.

All art is drawn **facing right**. Facing left mirrors it: every `dx` is negated, and characters swap
through a mirror table (`/`↔`\`, `<`↔`>`, `(`↔`)`). Everything else maps to itself.

### Choosing the locomotion pose

| condition | pose |
|---|---|
| `ground` and `landT < 0.12` | land |
| `ground` and `|vx| ≥ 1.5` | run |
| `ground` | idle |
| air, `vy < −8` | rise |
| air, `−8 ≤ vy ≤ 8` | apex |
| air, `vy > 8` | fall |

## 4. The poses

Art is drawn facing right, on a grid where columns are about 0.7 cells apart. The table under each drawing
is the source of truth: `glyph (dx, dy)`, with rows −1 = head, 0 = torso and arms, +1 = legs. The art is a
guide to what it looks like.

### Idle, with a breath

```
 O
/|\
/ \
```

| head | armB | torso | armF | legB | legF |
|---|---|---|---|---|---|
| `O` (0, −1) | `/` (−0.7, 0) | `\|` (0, 0) | `\` (0.7, 0) | `/` (−0.4, 1) | `\` (0.4, 1) |

- **Breathing**: head, arms and torso rise by `0.06 × (1 − cos 2π(t/2.4 + phase)) / 2` rows. The legs
  don't move. It is a sub-cell glide of at most 1.5 px on a laptop: felt more than seen.

### Run (4 frames)

```
  R1 contact   R2 pass    R3 contact   R4 pass
     O           O           O           O
    -/\         //          //-          /\
    / \          |>         / \          |>
```

- **The frame comes from distance**: `phase = frac(x × facing / 12)`, and the frame is `floor(phase × 4)`.
  Each frame lasts 3 cells of travel: 10 frames a second at the run speed (30), 15 at sprint (45). Because
  the phase is a function of `x`, it needs no memory and works the same for remote people.
- **Lean**: the torso row shifts forward 0.2 (0.3 when `|vx| > 36`) and the head 0.35 (0.45). The torso
  glyph is `/`.
- **Running backwards** (mouse aim lets `facing` disagree with `vx`): there is no lean and the torso is `|`.
  The frames play in reverse by themselves, since the phase comes from `x × facing`.
- **Bob**: every glyph moves up by `0.12 × sin(π × frac(phase × 2))` rows. It is lowest at contact and
  highest mid-pass, and continuous, so the figure bobs smoothly even though its frames step.

| frame | armB | armF | legB | legF |
|---|---|---|---|---|
| R1 | `-` (−0.55, −0.1) | `\` (0.85, 0.05) | `/` (−0.55, 1) | `\` (0.6, 1) |
| R2 | `/` (−0.45, 0.05) | none | `\|` (0.05, 1) | `>` (0.6, 0.9) |
| R3 | `/` (−0.5, 0.05) | `-` (0.95, −0.1) | `/` (−0.55, 1) | `\` (0.6, 1) |
| R4 | none | `\` (0.75, 0.05) | `\|` (0.05, 1) | `>` (0.6, 0.9) |

The head is `O` and the torso `/` in every frame, at the lean offsets.

### Jump: rise, apex, fall

```
  rise      apex      fall
  \O/        O         O
   |        -|-       \|/
   />        />       / \
```

| pose | head | armB | torso | armF | legB | legF |
|---|---|---|---|---|---|---|
| rise | `O` (0.1, −1) | `\` (−0.7, −1.1) | `\|` (0, 0) | `/` (0.8, −1.1) | `/` (−0.3, 0.95) | `>` (0.45, 0.85) |
| apex | `O` (0, −1) | `-` (−0.75, −0.1) | `\|` (0, 0) | `-` (0.75, −0.1) | `/` (−0.3, 0.9) | `>` (0.45, 0.85) |
| fall | `O` (0, −1) | `\` (−0.75, −0.25) | `\|` (0, 0) | `/` (0.75, −0.25) | `/` (−0.55, 1) | `\` (0.55, 1) |

- Rise has the arms thrown up by the head and one knee tucked. Apex has the arms out for balance. Fall has
  the arms up and the legs spread to brace.

### Land (squash)

```
  O        ← head, arms and torso 0.25 row lower at touch-down
 /|\
/   \
```

- While `landT < 0.12`, the upper rows sit `0.25 × (1 − landT / 0.12)` rows lower and the legs spread to
  ±0.6. Then the figure eases back into idle or run. Every landing squashes, short hops included.

### Shoot (any angle)

The front arm and the gun follow `aim` exactly. Only the arm's glyph is chosen from 8 directions.

- **Angle space**: `aim` is measured on screen, where a row counts as two cell widths. A distance `r`
  along the aim is `(r cos aim × facing, r sin aim / 2)` in cells and rows (see Interface changes).
- **Shoulder** `S = (0.15, −0.3)`: 1.8 rows above the feet, the PvP spec's "60% of the figure's height".
  - Arm glyph at `S + 0.7` along the aim.
  - Gun at `S + 1.5` along the aim.
  - Muzzle flash `*` (tone `fx`) at `S + 2.3` along the aim, while `actT < 0.06`.
- **Arm glyph by angle**: `-` within 22.5° of level; `/` from 22.5° to 67.5° upward and `\` from 22.5° to
  67.5° downward; `|` beyond 67.5°.
- **Gun glyph**: `=` within 35° of level; otherwise the same glyph as the arm. It is drawn in the body
  colour.
- **Recoil**:
  - arm, gun and flash move back 0.3 along the aim: fully at `actT < 0.04`, easing to 0 by 0.15;
  - the head moves back 0.1 at the same time.
- The back arm, torso and legs come from locomotion, so you can shoot while running or jumping.
- The arm is aimed as long as `act` is `'shoot'`. Each new shot restarts `actT`, so the recoil and flash
  replay (see Interface changes).

```
  level (0°)      45° up (−π/4)     45° down (+π/4)    straight up (−π/2)
                         *                                    *
                        /                                     |
                       /                                      |
   O                O /             O                       O |
  /|-= *           /|              /|\                     /|
  / \              / \             / \ \                   / \
                                        \
                                         *
```

(Approximate: on screen the arm, gun and flash sit on one straight ray from the shoulder at exactly the aim
angle.)

### Punch (0.25 s)

```
  wind-up        strike         recover
     O              O             O
    /\>           -/--)          /|-
    / \            / \           / \
```

| phase | actT | what changes |
|---|---|---|
| wind-up | 0–0.06 | torso `\` (−0.1, 0), head (−0.2, −1), armF `>` (0.45, −0.15) |
| strike | 0.06–0.16 | torso `/` (0.2, 0), head (0.4, −1), armB `-` (−0.6, −0.1), armF `-` (0.85, −0.2) and fist `-` (1.55, −0.2); whoosh `)` (2.1, −0.2), tone `fx`, from 0.06 to 0.11 |
| recover | 0.16–0.25 | every part slides back to its locomotion place; at 0.21 the characters switch back |

- The legs come from locomotion, so a punch works while running or in the air.
- After 0.25 s, a `punch` that is still set is drawn as idle.
- The strike is fully out by `actT` 0.06, as the PvP spec needs, since the server applies the hit as soon
  as it receives it.

### Kick (0.40 s)

```
  wind-up        strike         recover
     O            O               O
    -|-           /\-            /|\
     |>           / --)          / \
```

| phase | actT | what changes |
|---|---|---|
| wind-up | 0–0.06 | arms `-` (±0.75, −0.1), legB `\|` (−0.1, 1), legF `>` (0.45, 0.75): the knee is chambered |
| strike | 0.06–0.26 | head (−0.35, −1), torso `\` (−0.15, 0), armB `/` (−0.8, 0.1), armF `-` (0.6, −0.15), legB `/` (−0.35, 1), legF `-` (0.75, 0.55) and foot `-` (1.45, 0.55); whoosh `)` (2.0, 0.55), tone `fx`, from 0.06 to 0.11 |
| recover | 0.26–0.40 | every part slides back to its locomotion place |

- **In the air** it is a flying kick: legB tucks to `/` at (−0.35, 0.85).

### Hurt (as long as the stun: 0.08, 0.2 or 0.4 s)

```
 O
 /\-
 / \
```

| actT | what happens |
|---|---|
| 0–0.08 | the whole figure is tone `flash` (white) |
| 0–0.20 | recoil pose: head `O` (−0.5, −0.9), torso `\` (−0.2, 0), armB `/` (−0.85, 0.15), armF `-` (0.55, −0.25), legs `/ \` (±0.4, 1) |
| 0.20–0.35 | every part slides back to its locomotion place (so a kicked, airborne body eases into rise or fall); at 0.28 the characters switch |

- When the stun ends earlier (a bullet's 0.08 s), `act` changes and the figure is simply back in its
  locomotion pose. A short flinch is the right read for a bullet.

- **Direction**: the flinch is always backwards relative to `facing`. Knockback, if any, is the PvP layer's
  `vx`.

### Death: pop and scatter

| actT | what happens |
|---|---|
| 0–0.08 | **pop**: the hurt pose in `flash`, plus 4 `*` sparks (tone `fx`) flying out diagonally from 0.5 to 1.5 cells, fading out by 0.25 s |
| 0.08 on | **scatter**: the six parts fly from their hurt-pose places, tumble, bounce once and settle |
| until 1.4 | the pieces lie where they fell |
| 1.4–2.0 | the pieces fade (`a` from 1 to 0), so they are gone by the 2 s respawn |
| after 2.0 | nothing is drawn |

- **Scatter physics** (closed form, so someone who arrives mid-death sees the right moment):
  - gravity is 50 rows/s², gentler than the body's, so the scatter can be read;
  - the ground is `dy = +1` (the bottom row: the feet line);
  - at the first contact the vertical speed reverses at ×0.3 and the horizontal speed halves;
  - at the second contact the piece stops.
- **Tumbling**: a limb's glyph cycles `|` `/` `-` `\` at 12 per second while airborne. It rests as `_`, which
  sits on the feet line. The head stays `O` and rests as `O`.

| piece | vx (cells/s) | vy (rows/s) |
|---|---|---|
| head | −7 | −14 |
| torso | −3 | −9 |
| armB | −10 | −11 |
| armF | +4 | −12 |
| legB | −5 | −6 |
| legF | +3 | −7 |

- These are facing right: the figure is thrown backwards. Everything settles within about 1.1 s and spreads
  over about 6 cells. The head rises about 2 rows.
- **The body keeps falling**: while `dead`, the body is still stepped by physics with no input (see
  Interface changes). Someone shot mid-air lands, and the pieces, which are relative to the body, settle on
  whatever it lands on.

```
  t = 0.3 s                 t = 1.5 s
     O
  \       -
     |  /                 _  O _ _  _ _
```

### Respawn (0.45 s)

| spawnT | what happens |
|---|---|
| 0–0.35 | the idle figure's parts fly in from 3 cells out (each along its own direction from the centre), easing out (`1 − (1 − k)³`); `a` goes from 0 to 1 |
| 0.35–0.45 | tone `flash` |
| after 0.45 | normal |

- It plays when you first appear in the arena (walking in through the door included) and after every
  respawn.

### Animation timing (all values)

| what | value |
|---|---|
| breathing period / height | 2.4 s / 0.06 row |
| run stride (4 frames) | 12 cells (3 cells per frame) |
| run lean, torso / head | 0.2 / 0.35 cells (sprint 0.3 / 0.45) |
| run bob | 0.12 row |
| idle → run threshold | `|vx| ≥ 1.5` cells/s |
| rise / apex / fall | `vy < −8` / between / `vy > 8` rows/s |
| landing squash | 0.12 s, 0.25 row |
| shoot recoil / muzzle flash | 0.15 s (full for 0.04) / 0.06 s |
| punch | wind-up 0.06, strike to 0.16, done at 0.25 s |
| kick | wind-up 0.06, strike to 0.26, done at 0.40 s |
| hurt | flash 0.08, recoil to 0.20, eased back by 0.35 s (cut short when the stun ends) |
| death | pop 0.08, settled by about 1.1, fade 1.4–2.0 s |
| protection (`safe`) | `a` pulses 0.35–0.8, 3 times a second |
| respawn | fly-in 0.35, flash to 0.45 s |
| whoosh `)` | 0.05 s |

## 5. Drawing

### Smooth motion on a grid

- **Positions**:
  - every figure glyph is drawn at `(x + dx, y + dy)`, rounded to **device pixels**, never to cells;
  - both renderers can already do this: canvas translates by fractional cells, and GL instances take
    float cell positions;
  - at 30 cells/s and 60 fps the figure moves half a cell a frame, as a glide.
- **What steps**: only the pose frames step, at the rates in the timing table. Lean, bob, breathing,
  squash, recoil, eases and the scatter are all continuous.
- **Remote people**: they glide too. Their positions are interpolated 250 ms behind, as today, and their
  run frames come from their interpolated `x`, so their stride matches their speed. How smooth remote jumps
  look depends on what PvP syncs, which is that spec's to decide.

### Look

- **Font**: figure glyphs are drawn **bold** in the gallery's monospace font, for the thick-lined Alan
  Becker look and so the limbs read at phone size.
- **Outline**: every figure glyph and every label glyph in the side view gets a dark ring:
  - colour `[7, 8, 11]` at 0.9 opacity;
  - radius `max(2, round(0.14 × cw × dpr))` device pixels: 3 on a laptop at 2×, 3 on a phone at 3×;
  - this is what makes figures read over white siding and sky as well as over dark leaves;
  - there is **no cell box** behind the figure.
- **Colours**:
  - **You** are `C.player` amber `[255, 206, 110]`.
  - **Others** keep `peerColor(id)`, which changes so that its hue skips 20°–60° (amber's band):
    `hue = (60 + h % 320) % 360`. It is the same colour everywhere they appear, top-down included.
  - `flash` is white and `fx` is warm `[255, 214, 140]`.
  - People fading out (leaving) multiply `a` by their `alpha`.
- **Light**: figures are drawn **after** the light pass, at full brightness, like the platforms. They
  don't fall into shadow and don't cast light.
- **Draw order** (side view): backdrop → light → platforms → other figures → your figure → labels (names,
  chat, emotes, hearts). Labels go above all figures, so a crowd never hides a name.

### Names, chat, emotes

- **Side view only**; top-down is unchanged. The label stack sits above the head, centred on the body's
  fractional `x` so it glides with the figure:

| label | row centre |
|---|---|
| name | `y − 2.2` |
| chat line | `y − 3.3` |
| emote | `y − 4.4` with a chat line, else `y − 3.3`; its lift animation is as today |
| hearts at the arena photo | rise from `y − 2.2` (today from `y − 1`) |

- **Your own figure** shows no name, as today. Your chat and emotes use the same stack.
- **Readability**:
  - names and emotes have the outline;
  - the chat line also has a dark strip behind it (`[7, 8, 11]` at 0.6 opacity), one cell wider than the
    text on each side, since a sentence over busy foliage needs more than an outline.
- **Near the ceiling**: if the top of the stack would rise above the room's top interior row, the whole
  stack flips below the feet (name at `y + 2.2`, chat at `y + 3.3`, and so on).
- **When dead**: the name stays at the body's place and fades with the pieces.

### The HUD

- In the side view, the top HUD bar (`.hud`) gets a dark scrim, `linear-gradient(#07080bcc, transparent)`,
  because its muted text disappears over the sky.
- The caption already has its dark box. The phone pad buttons get a 35% dark fill instead of a solid one,
  so a figure under them at the room's edge stays visible.

### Both renderers

- **Shared code**: `src/render/figures.js` (new) turns `world.bodies` into one flat list of glyph
  instances: `{ x, y, ch, color, a, bold, strip }`. It calls `stickPose` for each body and adds the labels.
  - `main.js` builds `world.bodies` in the side view: one entry per person inside, as
    `{ id, state, color, name, say, emote, emoteAge, alpha, me }`.
  - `world.entities` keeps its top-down role. In the side view, people are no longer pushed into it.
- **Canvas**:
  - A **sprite cache** holds one small canvas per glyph, colour and weight, with the outline baked in
    (drawn with `strokeText`, then `fillText`).
  - Each frame is one `drawImage` per glyph, at a pixel-snapped position, with `globalAlpha` for `a`.
  - The cache is cleared on resize. About 30 colours × 25 glyphs is a few hundred sprites, under 1 MB.
- **GL**:
  - A **figure atlas** (new, small) holds the bold figure glyphs and the regular label glyphs (printable
    ASCII plus `♥★`). Each glyph is stored twice: as itself, and as its outline (the same glyph dilated by
    the outline radius).
  - Figures are drawn in two instanced passes with the existing glyph program, pointed at this atlas: the
    outline pass in the dark colour, then the fill pass.
  - The atlas uses `LINEAR` filtering, so glyphs at sub-pixel positions don't shimmer. The main atlas stays
    `NEAREST`.
  - Chat strips are instances with a background and a blank glyph.
  - The atlas is rebuilt on resize and on context restore.

### Performance (30 people)

| | per frame |
|---|---|
| `stickPose` | at most 12 glyphs a body, no allocation (appends into one reused array); under 5 µs a body |
| glyphs | at most about 12 figure + 45 label glyphs a body, so at most about 1,700 for 30 people |
| GL | one buffer upload, two instanced draws (about 3,400 instances) |
| canvas | about 1,700 `drawImage` calls from the sprite cache |
| budget | **under 2 ms** for the whole figure layer with 30 people on a 2019 laptop, either renderer |

- Bodies more than 3 cells outside the view are skipped before `stickPose` is called.

### Reduce Motion

| | with Reduce Motion |
|---|---|
| run frames, action poses, aim | **kept** (you cause them, and they carry meaning) |
| breathing, run bob and lean easing, landing squash | off (static offsets: lean still applies, without bob) |
| hurt and respawn white flashes | off; hurt shows the recoil pose only |
| muzzle flash | kept (one glyph, it shows a shot happened) |
| recoil | kept, without the ease (on for 0.08 s, then off) |
| death | the pop sparks and scatter are off; the parts appear lying flat (`_` and `O` on the feet line), then fade 1.4–2.0 s |
| protection (`safe`) | steady `a` 0.5, no pulse |
| respawn | a 0.3 s fade-in in place |

### Phones

- **Size on screen**: at 852 × 393 the cell is 6 × 12 px. The figure is about 13 × 36 px with a 9 px bold
  font, and the outline is 3 device pixels at 3×. The figure is readable, so it doesn't need scaling up.
- **Labels**: they use the same 9 px font. Names longer than 12 characters are cut to 11 plus `…` in the
  side view on phones, so a crowd's names don't merge.
- **Camera**: the view is about 32 rows, under the room's 36, so the camera follows vertically as today. A
  3-row figure leaves plenty of room.

## 6. How the state is filled in

- **You**:
  - `main.js` builds your state each frame from `world.player` (which `stepBody` moves) and the PvP layer.
  - `ground` is `onGround`; `facing` is `world.player.facing`.
- **Others**:
  - their synced state comes from the PvP layer, with `x, y` interpolated as today;
  - **until PvP ships**, or for anyone whose messages lack the fields, `live.js` derives the state from
    positions alone:
    - `vx, vy` from two interpolated samples 50 ms apart;
    - `facing` from the sign of the last non-zero `vx`;
    - `ground` when `y` hasn't changed for 120 ms;
    - `act` is `'idle'`;
    - so everyone is a running, jumping stickman from day one.
- **`landT` and `spawnT`**:
  - a small per-id tracker in `src/stick.js` (`createMotionMemory()`) watches each body's `ground` and
    `act` from frame to frame and fills these two fields in;
  - `stickPose` itself stays pure;
  - the tracker forgets an id 5 s after it was last seen.

## 7. Failures

| Situation | Behaviour |
|---|---|
| A field is missing (older client, PvP not shipped yet) | Defaults from §3; positions alone give a running, jumping figure |
| Unknown `act`, or bad `actT` | Drawn as idle; `actT` treated as 0 |
| `aim` outside ±π/2 | Clamped |
| `x` or `y` not finite | That body is skipped this frame |
| Someone arrives while another person is mid-death | The scatter is closed-form, so they see the right moment; after 2.0 s, nothing |
| An act outlasts its animation (`punch` still set at 0.5 s) | Drawn as idle until the act changes |
| `dead` lasts longer than 2 s (a slow respawn) | Nothing is drawn until the respawn |
| The figure glyph font is missing a character | The figure only uses printable ASCII, which every monospace font has |
| WebGL context lost | The canvas renderer takes over; its sprite cache builds on first use |
| Resize or rotation | The sprite cache and figure atlas are rebuilt at the new cell size |
| 30 or more people | All drawn; off-screen ones skipped; the budget in §5 holds up to 30 |
| A label stack would leave the room at the top | It flips below the feet |
| A level file breaks a clearance rule | The unit test fails before it ships; at runtime the level still loads |

## 8. Testing

- **Unit, `test/stick.test.js`** (new):
  - **Shape**:
    - every non-dead pose has a head and a torso;
    - every glyph stays within `|dx| ≤ 2.5` and `−1.6 ≤ dy ≤ 1.2` (labels aren't part of the pose);
    - only printable ASCII is used.
  - **Purity**:
    - the same input gives deep-equal output;
    - `state` is not mutated;
    - no `Math.random` (the module is checked for it).
  - **Mirroring**: `facing: −1` equals the `facing: 1` pose with `dx` negated and characters swapped.
  - **Idle**: breathing moves the head by at most 0.06 row; with `reducedMotion` it is constant over time.
  - **Run**:
    - the frame depends only on `x`: the same `x` gives the same frame, +3 cells gives the next, +12
      returns to the start;
    - `|vx| < 1.5` on the ground is idle.
  - **Air**: `vy` of −20, 0 and +20 give rise, apex and fall.
  - **Land**: at `landT` 0.05 the head is lower than idle; at 0.2 it is idle.
  - **Shoot**:
    - for 16 aims across ±π/2, the gun glyph lies on the ray from the shoulder at that angle, measured on
      screen (`atan2(2·dy, dx·facing)` within 1e-6, apart from recoil);
    - the arm glyph follows the 8-direction table;
    - the flash is present only for `actT < 0.06`;
    - recoil moves the gun back at `actT` 0.02 and not at 0.2.
  - **Punch**: the fist reaches `dx ≥ 1.5` at `actT` 0.06 and 0.1, but not at 0 or 0.3.
  - **Kick**: the foot reaches `dx ≥ 1.4` at `dy ≈ 0.55` at `actT` 0.06 and 0.15, and it does so in the
    air too.
  - **Hurt**: everything is tone `flash` for `actT < 0.08` and nothing is after; at 0.35 it is the
    locomotion pose.
  - **Protection**: with `safe`, the body glyphs' `a` stays within 0.35–0.8 and changes over time; with
    `reducedMotion` it is 0.5.
  - **Running backwards**: with `facing` 1 and `vx` −30, there is no lean and the frame order reverses.
  - **Dead**:
    - no piece goes below `dy = 1`;
    - every piece is still between `actT` 1.15 and 1.4;
    - `a` is 1 at 1.35 and falls to 0 by 2.0;
    - the output is empty after 2.0;
    - with `reducedMotion` the pieces lie flat at once.
  - **Respawn**: `a` is 0 at `spawnT` 0; at 0.45 or later the pose equals idle.
  - **Defaults**: `{ x, y }` alone gives idle facing right; an unknown act gives idle.
  - **Motion memory**: `ground` false → true sets `landT` to 0; `dead` → `idle` sets `spawnT` to 0; an id
    is forgotten after 5 s.
- **Unit, `test/arena.test.js`** (changed):
  - **Physics, for the 3-row body**:
    - falling lands at floor − 1.5;
    - a full jump still rises 6 ± 0.5 rows;
    - the head stops under a `▓` ceiling 3 rows sooner;
    - the body walks through a 3-row door both ways (side view);
    - the other existing physics tests pass with the new box.
  - **Level rules**, for `src/arena.txt`:
    - the existing rules;
    - headroom: the 3 cells above every standing spot are air;
    - no standing spot in rows 0–2;
    - the gap under any `▓` is 0 or at least 3 rows;
    - a reach counts only with 9 rows clear of `▓` above the take-off span.
- **Unit, `test/live.test.js`**: `peerColor` never returns a hue between 20° and 60°.
- **e2e** (`e2e/run.mjs`; a localhost-only `__ascii.pose(state)` hook pins your own body's state):
  - **Screenshots** of your figure, with each renderer (`?r=canvas`, `?r=gl`) and at 852 × 393:
    - idle, mid-run, rise, fall;
    - shoot at 0°, −45°, +45° and −90°;
    - punch at its strike;
    - kick at its strike;
    - hurt;
    - dead at 0.3 s and 1.5 s;
    - respawn at 0.2 s.
  - **Assertions on those screenshots**:
    - amber pixels exist inside the body's 2.1 × 3-cell area;
    - with the figure placed over the poster (the brightest part of the photo), there are dark
      outline pixels (luminance under 40) in a ring around the amber;
    - top-down, you are still `@`.
  - **Smoothness**:
    - run for 1 s and record the centre of the amber pixels each frame;
    - it only moves one way;
    - at least half of its steps are not a whole number of cells.
  - **Multiplayer** (`e2e/multiplayer.mjs`):
    - B sees A as a stickman in A's colour, with A's name above the head, not as `@`;
    - A's chat shows above A's name;
    - from outside, nobody inside is drawn (unchanged).
  - **Load**: a localhost-only `?bots=30` hook adds 30 local bodies cycling through every act. A screenshot
    shows them, and the frame time is logged (not asserted).
  - **Errors**: no page errors.

## 9. Level

- The level is **traced by hand on the backdrop photo**, so its platforms sit on real things in the
  picture. The drawing itself isn't part of this spec.
- **One level file**: `src/arena.txt`, traced on whichever photo is the backdrop (today DSCF9139, Penn
  Station: one platform along the yellow line, the two pillars as walls, floating platforms on the
  scene). Changing `ARENA.photo` keeps the old level, which still works but no longer matches; the level
  is retraced by hand. (Reconciled 2026-10-14 with the PvP spec, whose server bundles this one file and
  checks its hash.)
- The level must meet the clearances in §2, and the unit test checks them.

## 10. Out of scope

- **PvP** rules: damage, hit detection, guns, ammo, respawn timing, scores, health display. That is the
  PvP spec's.
- How often positions and states are sent, and smoother remote jumps (the PvP spec's).
- Skins, hats, choosing your colour.
- Faces or eyes, and lip-sync with chat.
- Death pieces that collide with the level (they rest on the body's feet line).
- Figures casting light or shadow, or being lit by the arena's lights.
- Turn, crouch, wall-slide, ledge-grab or climbing animations.
- Sound.
- The stickman anywhere outside the arena's side view.

## Interface changes

The PvP spec (`2026-10-14-arena-pvp-design.md`) was written alongside this one. This spec takes on its
state, `{ x, y, vx, vy, facing, ground, aim, act, actT, hp, safe, combo }`, its act timings (`shoot` 0.2 s,
with each new shot restarting `actT`; `punch` 0.25 s; `kick` 0.4 s; `hurt` for the stun; `dead` until the
2 s respawn), and its `MAX_HP`. On top of that:

1. **The body box is 0.8 × 3 rows** (`arena.js`: `HW 0.4`, `HH 1.5`, exported as `BODY`).
   - `x, y` stay the box's centre, so the feet are at `y + 1.5`.
   - Reconciled 2026-10-14: the PvP spec takes this box too. Its hurtbox is 1.0 wide and 3 rows tall on
     the same centre. (With a 1-row box, the head of a 3-row figure would pass through `▓` ceilings and
     the level's headroom rules (§2) wouldn't be enforced by the physics.)
2. **`FIGURE_ROWS = 3`**. The PvP spec asks this spec to own the value. It equals `BODY.h`.
3. **`aim` is measured on screen**, where a row counts as two cell widths. Both specs agree on this.
   - A distance `r` along the aim is `(r cos aim × facing, r sin aim / 2)` in cells and rows.
   - The range is [−π/2, π/2]; aiming behind you flips `facing` (the PvP layer does this).
4. **Two new local fields, not synced**: `landT` and `spawnT`. Each client derives them from changes in
   `ground` and `act` with `createMotionMemory()` in `src/stick.js`. Nothing changes on the wire.
5. **`safe`** is drawn as a soft 3-a-second pulse of the body's opacity, and as a steady 0.5 with Reduce
   Motion. **`combo`** is ignored.
6. **`stickPose` output** has more than `{dx, dy, ch}`: it also has `part`, `tone` and `a`. `opts` carries
   `reducedMotion` and `phase` (a hash of the person's id).
7. **What the drawing promises the PvP layer**:
   - A punch and a kick are **fully extended at `actT` 0.06**. A punch is out until 0.16; a kick until
     0.26.
   - The gun hand is on the aim ray from `SHOULDER = { dx: 0.15, dy: −0.3 }` (1.8 rows above the feet).
     The muzzle flash is at `MUZZLE_R = 2.3` screen units along that ray; both are exported from
     `src/stick.js`.
     - Bullets start at the muzzle, so a shot leaves from the drawn gun (reconciled 2026-10-14; the PvP
       spec says the same).
   - A `dead` body should still be stepped by `stepBody` with no input, so someone popped mid-air lands
     and their pieces settle on whatever they land on. The pieces are gone by 2.0 s.
   - The figure doesn't use `hp`, and draws no health.
