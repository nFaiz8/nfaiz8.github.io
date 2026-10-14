# Arena PvP: headshots and the double jump (addendum)

**Status:** the user asked for both, 2026-10-14: "headshots should do more damage and add a double jump
that makes it feel fluid". This addendum amends `docs/specs/2026-10-14-arena-pvp-design.md` (the PvP spec)
and `docs/specs/2026-10-14-arena-stickman-rig.md` (the rig), and wins where they disagree.

## 1. Headshots

- **The head is the top row of the body box.** A bullet's hit point is relative to the target's estimated
  centre at the moment of the hit, and the box spans ±1.5 rows. If that point's `dy < −0.5` rows, the hit
  is a headshot. On screen this is the `O` row.
  - The point is the bullet's position at the swept hit time, clamped into the box. A hit that enters
    through the top edge counts as a headshot.
- **Damage ×2** for all three guns (`HEADSHOT = 2`): the deagle does 50, the rifle 18, the sniper 140.
  A sniper headshot kills from full health, while a sniper body shot (70) does not.
  - Knockback and stun are unchanged.
  - Melee has no headshots.
- **The referee decides**, on the server, through the same `src/referee.js` everyone runs (offline
  included).
  - The `h` message gains `hs: 1` for a headshot. It is omitted otherwise.
  - A `k` caused by a headshot also carries `hs: 1`.
  - Old clients ignore the field.
- **What people see:**
  - The damage number for a headshot is drawn in `flash` white with a `!` (`-50!`) and lasts 1.3× as long.
  - Your own screen gives a tiny camera shake when you land a headshot (none with Reduce Motion).
  - The kill feed line for a headshot kill ends with ` ◎ headshot`. The feed is DOM text, and the polite
    caption gets the same line.
  - The damage number uses only ASCII, so the renderers need no new glyphs.

## 2. The double jump

- **One air jump per airtime.**
  - `AIR_JUMPS = 1`. The count refills whenever the body touches the ground.
  - A fresh jump press while airborne uses it when the ground jump isn't available, that is once coyote
    time has passed or the ground jump was already used.
  - It also works after running off a ledge, and after a jump out of a roll.
  - It doesn't work while stunned or while rolling.
- **Velocity.**
  - `vy = −DOUBLE_V` with `DOUBLE_V = 34` rows/s, about 4.3 rows more height. It replaces any vy, so it
    can arrest a fall.
  - `cut` is reset, so letting go early still shortens it.
  - Horizontal: if a direction is held, `vx = sign(input.x) × max(|vx|, RUN × (run ? SPRINT : 1))`. This
    reverses or keeps your momentum at once, which is what makes it feel fluid. With no direction held, vx
    is kept, so a roll's long jump keeps its speed.
- **The body records it.** `b.airJumps` holds the jumps left. `b.airJumpT` holds the body time `b.t` of
  the last air jump, or −Infinity.
- **Remote fighters** (`src/fighters.js`) predict it with the same `stepBody`. A jump-bit rising edge in
  the air triggers it, the same way the ground jump is taken from the bit edge. The ticker already sends an
  urgent state on an input-bit change.
- **Server.** The movement clamp (`clampMove`) must still accept an honest double jump: check its vertical
  allowance against `JUMP_V` and `DOUBLE_V` and add a test. No new message is needed.
- **Animation (the rig).**
  - The stick state gains `flipT`: seconds since the last air jump (Infinity if none). `pvp.js` fills it
    for me and `fighters.js` for remote fighters.
  - The pose layer adds a whole-body **flip**, active while `flipT < 0.36`:
    - the figure tucks (knees to the chest, hands to the shins);
    - the whole rig rotates one full turn about the body centre, in the facing direction (forward), eased
      `1 − (1 − k)²`;
    - it untucks over the last 0.08 s into the air pose.
  - Shooting during the flip draws the gun arm aimed as usual over the spinning body. The flip yields to
    `hurt`, `dead` and `kick`.
  - **Reduce Motion:** a tuck for 0.2 s, no rotation.
  - **Puff:** two `~` glyphs (tone `fx`) spread sideways from the feet at the jump point, fading over
    0.15 s.
- The double jump changes no level geometry. The level's reachability tests may need their expectations
  updated (more is reachable). That is fine as long as the clearance rules hold.

## 3. Tests

**Headshots** (`test/referee.test.js` and `test/fight.test.js`):
- A level bullet at the head row does 2× damage with `hs: 1`.
- A bullet at the torso does 1× with no `hs`.
- A sniper headshot kills from 100, and the `k` carries `hs`.
- A downward bullet entering through the top of the box counts as a headshot.
- A roll still dodges.
- The server test covers `hs` on the wire.

**Double jump** (`test/arena.test.js`):
- One air jump after a ground jump, and none more until landing.
- Running off a ledge gives one air jump.
- The air jump sets vy = −34, and letting go cuts it.
- Holding the opposite direction reverses vx at once; holding no direction keeps vx.
- No air jump while stunned.
- `airJumpT` is set.

**Remote fighters:** a remote fighter's double jump is predicted from the bit edges.

**Server:** the server accepts a full jump plus a double jump.

**Pose (`test/stick.test.js`):**
- During the flip the rig rotates monotonically through 2π.
- With Reduce Motion there is no rotation.
- The skeleton stays connected.

**e2e:** a double jump reaches higher than a single jump, and the flip is visible in a pose-sheet entry.
