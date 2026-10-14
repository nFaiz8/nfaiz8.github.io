# Arena stickman: the rig (addendum)

**Status:** approved direction from the user, 2026-10-14. It amends
`docs/specs/2026-10-14-arena-stickman-design.md` (the "stickman spec") and wins where they disagree.

> "gun looks like a penis … its cuz its at crotch and not hands — dont be afraid to give the ascii
> character a different rendering so its not actually ascii but things can be rotated and moved easier so
> its more fluid"

## 1. Intent

The figure stays a stick figure made of the same characters, `O` for the head, `|` for bones and `╦═` for
the gun, drawn in the person's colour with the dark outline. **Each character is now a sprite that can be
placed, rotated and stretched freely.** Three changes follow from that:

1. **Joints.** Arms and legs have two bones each: upper arm and forearm, thigh and shin. Elbows and knees
   bend, so a hand can hold a gun at the chest, and a run can lift a knee.
2. **Continuous poses.** Every pose is a smooth function of the state: run phase, `vy`, `actT`, `landT`.
   There are no stepped frames and no glyph swapping by angle, so the motion reads like the Alan Becker
   animations the user asked for.
3. **The gun is in the hand.** It is always drawn from the front hand, along the gun's own angle. Carried,
   it is held at the chest pointing a little down. It is never level at the hip.

**Unchanged:**
- the size: 3 rows tall, the box from Task 1, the clearance rules;
- `SHOULDER`, `HAND_R`, `MUZZLE_R`, and so `muzzleOf` and the referee;
- what each act means and how long it lasts (stickman spec §4 "Animation timing" table);
- `safe` shimmer, `flash` and `fx` tones, Reduce Motion rules, the motion memory and the respawn fly-in
  timing, names/chat/emotes/hearts, the outline look, performance budgets.

## 2. Space and the skeleton

Work in **screen units `u`**: 1 u = one cell width, and one row = 2 u (the stickman spec's "a row counts as
two cell widths"). Output converts back: `dx = X`, `dy = Y / 2`. Below, `(X, Y)` is in u with y down, the
origin is the body centre `(x, y)`, and everything is facing right.

| joint / bone | value |
|---|---|
| hip H | (0, +1.0) |
| neck N | (0, −1.0) |
| head centre | N + 1.0 along the torso direction upwards → (0, −2.0) standing: row −1, as before |
| shoulder S | `SHOULDER` = (0.15, −0.6) (cells 0.15, rows −0.3): unchanged |
| upper arm, forearm | 0.95 u each |
| thigh, shin | 1.0 u each (standing, the feet reach Y ≈ +2.9, the bottom of row +1) |
| torso | the bone H → N, so the lean is a rotation about the hip |

**Two-bone IK.** Each limb is placed by its end target (hand or foot). The middle joint is solved
analytically from the two bone lengths. If the target is out of reach it is pulled in to 0.999 of full
reach. Elbows bend **down and back**; knees bend **forward**, in the facing direction.

## 3. Output

`stickPose(state, t, opts, out)` keeps its signature. Each entry gains three fields:

```
{ dx, dy, ch, part, tone, a, rot, len, flip }
```

- **`rot`**: the sprite's rotation in radians, clockwise on screen, about its centre. 0 means upright.
- **`len`**: a vertical stretch factor for bones. The `|` glyph is drawn `len` times its normal height, and
  its width doesn't change. It defaults to 1.
- **`flip`**: mirror the sprite horizontally before rotating. It is used for the gun facing left, so the
  grip stays under the barrel.
- **Bones** (`torso`, `armB`, `armF`, `legB`, `legF`) are emitted as **two entries each for limbs, upper
  then lower, one for the torso**:
  - `ch` is `|`, placed at the bone's midpoint, with `rot` = the bone angle from vertical;
  - `len` = bone length / 2 u, the glyph's height;
  - `part` stays the limb name, so tests and the PvP layer still find `armF` and the rest.
- **Head**: `O` at the head centre, `rot` 0.
- **Gun**: `GUN_ART[gun].glyphs`, one entry per glyph, laid along the gun's axis from the hand.
  - The hand glyph sits at the hand; each next glyph is 1 u further along the axis (a stock glyph 1 u
    behind it).
  - Every glyph has `rot` = the gun angle and `flip` = facing left.
  - There is no more `/` `\` `|` substitution beyond 35°: a sniper aimed up is the sniper art, rotated.
- **Mirroring** facing left: X is negated, every `rot` becomes `−rot`, and `flip` is set on the gun. The
  `MIRROR` character table is no longer needed for the figure. Keep the export if anything else imports it.
- **Fx** entries (muzzle `*`, whoosh `)`, sparks, puff `~`) keep their meaning and positions, with `rot` 0.
- `out` is still appended to without allocating per frame beyond the entries. Reuse objects if `out` holds
  spares, as now.

## 4. The poses as targets

Each pose gives: the torso lean (radians from vertical, + = forward), the hand and foot targets, and an
optional whole-body offset. The IK does the rest. The values below are starting points: tune them by
eye on the pose sheet, and record the final numbers in the code's tables.

- **Idle.**
  - Feet at (∓0.55, +2.9).
  - Back hand hangs at (−0.55, +0.5).
  - The front hand holds the gun (see §5).
  - The breath moves N, S and the hands up by the existing breathing curve.
- **Run.** A continuous cycle, `phase = frac(x × facing / 12)` as now (it still needs no memory).
  - Each foot follows an ellipse: forward stride ±1.1 u, lift 0.7 u, the two feet half a cycle apart.
  - Back arm swings opposite the front leg, ±0.6 u.
  - Torso leans 0.18 rad (0.26 sprinting).
  - The bob is the existing bob curve, applied to the hip.
  - Running backwards: no lean, and the cycle runs in reverse by itself.
- **Air.** One continuous blend driven by `vy`, not three steps.
  - Rise (vy ≤ −8): one knee tucked to (0.5, +1.6), arms up.
  - Apex (vy ≈ 0): arms out.
  - Fall (vy ≥ 8): legs spread to brace, arms up and out.
  - Interpolate the targets with a smoothstep over vy ∈ [−14, 14].
- **Land.** For `landT < 0.12`: the hip drops by `0.5 × (1 − landT/0.12)` u, which bends the knees. Feet
  stay planted and spread to ±0.7.
- **Shoot / aimed.**
  - The front arm reaches from S to `S + HAND_R` along the aim (the elbow barely bends).
  - The gun runs along the aim from there; the muzzle stays at `MUZZLE_R`.
  - Recoil is as now: the hand and gun slide back 0.3 along the aim, and the torso leans back 0.06 rad.
- **Punch.** Same phases and times. The front hand travels to 1.75 u forward at shoulder height. The torso
  twists forward 0.25 rad. The back hand pulls back to the chest.
- **Kick.** Same phases and times.
  - Wind-up: the front knee is chambered, foot at (0.4, +1.2).
  - Strike: the front foot goes out to (1.9, +1.1) and the torso leans back 0.35 rad.
  - Flying kick in the air: the back knee is tucked.
- **Hurt.** The torso snaps back 0.35 rad and the head moves back 0.5 u. Arms flail: front hand to
  (0.6, −0.9), back hand to (−1.1, +0.2). Ease back into locomotion over 0.20–0.35 s, as now.
- **Roll (0.30 s).** A real tumble.
  - The figure tucks: hands to the knees, feet under the hips, head down.
  - The whole tucked rig rotates one full turn forward about a point 1 row above the feet.
  - No gun is drawn. The puff `~` stays.
- **Death.** The pop is as now. The scatter flies the **ten bones and the head** as separate pieces.
  - Each piece flies with the stickman spec's scatter physics, using its limb's table speed.
  - Pieces spin at a steady `rot` rate while airborne (±10 rad/s, the sign by piece).
  - At rest they lie flat (`rot` ±π/2) on the feet line. The head stays `O`.
  - The fade is unchanged.
- **Respawn.** As now: each sprite flies in from 3 cells out along its own direction.

**Transitions.** Wherever the stickman spec says "slides back to its locomotion place", interpolate the
targets and angles (not glyph positions), with the same times. The "characters switch at …" moments go
away, since nothing switches characters any more.

## 5. Carrying the gun

When not aimed (the stickman spec §4 "Carried"):
- The front hand is at **(0.65, −0.1)**: in front of the chest, just under the shoulder line.
- The gun points **20° below level**, forward.
- The upper arm hangs down from S and the forearm comes forward, which the IK gives.
- Running, jumping and landing move it with the torso, through the joints.

The gun is drawn **only from the hand**. A test pins this: in every pose that draws a gun, the gun's hand
glyph is within 0.05 u of the front forearm's end.

## 6. Drawing

- **Canvas.** Each entry is drawn from the cached upright sprite (fill plus outline, as now) with
  `setTransform` for the translation, `rot`, `len` (scale Y) and `flip` (scale X −1).
  - Position is snapped to device pixels only when `rot` is 0 and `len` is 1, so upright glyphs stay
    crisp.
  - The outline is part of the sprite, so it rotates with it.
- **WebGL.** The figure instance data gains `rot`, `len` and `flip`. The vertex shader rotates the quad in
  **pixel space** (not cell space, which would shear with the 1 × 2 cell aspect), scales Y by `len`, and
  mirrors X by `flip`. The atlas is unchanged. Keep the two-pass outline, then fill.
- **Stretched bones.** A `|` sprite stretched by `len` keeps its outline width horizontally. It may thin a
  little vertically at the ends, which is fine.
- **Parity.** Canvas and GL must produce the same figure. The pose-sheet screenshots of both are compared
  by eye, and the e2e pose checks run in both.
- **Budgets.** `figureGlyphs` for 30 bodies stays < 1 ms best-of-5 (the entry count roughly doubles, so
  keep it allocation-free). The site holds 120 fps with `?bots=30`.

## 7. Testing

`test/stick.test.js` is rewritten for the rig. The glyph-table tests go; these take their place:

- **Pure.** Same input, same output, `state` not mutated, `out` reused.
- **Connected skeleton.** In every act and locomotion pose, sampled across its time range:
  - each limb's two bones meet at a joint;
  - the upper bones start at S or H;
  - the bones keep their lengths, within 1e-6.
- **Hand holds the gun** (§5), in every pose that draws a gun.
- **Carried gun.** It sits above the hip (its glyphs' `dy` are all < +0.1 rows) and points 20° below level.
- **Aimed gun.** The muzzle is at `muzzleOf`'s point for aims in [−π/2, π/2]; there is no glyph
  substitution at steep angles.
- **Continuity.**
  - Sampling run, air and every act in 1 ms steps, no sprite jumps more than 0.35 u between samples,
    except at the act's start, which may snap.
  - The air blend is continuous in `vy`.
- **Mirroring.** Facing left gives negated X, negated `rot`, and `flip` on the gun.
- **Knees and elbows.** Knees bend forward and elbows bend back or down.
- **Death and respawn.** The death pieces settle on the feet line by 1.2 s, and the closed form holds for
  someone arriving mid-death. The respawn fly-in is unchanged.
- **Kept.** The other existing behaviour tests: defaults, Reduce Motion, the `safe` shimmer, the motion
  memory.
- **Figures and e2e.** `test/figures.test.js` passes `rot`, `len` and `flip` through. The e2e pose checks
  keep asserting amber and outline pixels in the figure's box for every pose, in both renderers.
