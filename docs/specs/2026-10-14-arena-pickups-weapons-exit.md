# Arena: random pickups, a medkit, weapon tuning, the whole room for every gun, E only, a two-hit exit, spawn protection and an easier parry (addendum)

**Status:** the user asked for these on 2026-10-14, one after another:
- "add like a medkit that randomly spawns and randomize weapon spawn locations";
- "slower reload on sniper and higher smg damage";
- "pistol bullet unlimited range and add that u have to hit the exit twice to leave";
- "everyone should get sniper vision and sniper gets extra when crouch, and only open picture on e not
  enter";
- "spawn protection for few seconds or when u first shoot";
- "make parry lil easier".

The rest are choices made without them (§9). This addendum amends the PvP spec (§2.1, protection), the
train level addendum (§2, the zoom), the crouch addendum (§3), the smg addendum and the parry addendum
(§1).

## 1. Pickups at random spots

- **The spots.** The level's `R` and `N` now only say which guns there are. Each pickup appears at a random
  spot from `pickupSpots(level)` (`src/level.js`), which is any spot a body can stand on:
  - floor or platform under it, and three clear rows over it;
  - clear of the level's sides (4 columns) and of the doorway (10 columns on its row).
  That means the car roofs, both car floors and the platforms in the gap between the cars.
- **The referee picks.** It picks at the start, and again each time a pickup is taken (`place`). A spot
  must be:
  - `PICKUP_GAP` = 20 cells (on screen) from the other pickups;
  - 20 cells from where that pickup just was, so it really moves;
  - `SPAWN_GAP` = 6 cells from every spawn.
  If no spot fits, any spot will do.
- **The wire.** `pk` carries the next spot: `{ t: 'pk', id, n, at, x, y }`. The welcome's `pk` list
  carries each one's spot and kind: `{ n, at, x, y, g }`, where `g` is `r`, `n` or `m`.
  - Clients draw a taken pickup's dim outline at its next spot, so you can see where it will come back.
  - Online, no pickups are drawn until the welcome.
  - Offline, my own referee picks the spots.
- **The fight's version.** The fight hash is now `levelHash(level).FIGHT_VERSION`, with `FIGHT_VERSION` = 2,
  on the server and on the page. A cached old page and the new server (or the reverse, for the seconds a
  deploy takes) don't match. Each then fights the dummy instead of drawing pickups in the wrong place.

## 2. The medkit

- One medkit is the last pickup (`n` = the number of guns). It is drawn `[+]` in red.
- **Taking it** heals `MEDKIT.heal` = 50 hp, up to 100. It is refused at full health, counting the regen so
  far. The page doesn't even ask for it then.
- **The regen.** The regen so far goes into the hp, and regen carries on from there: `hurtAt` becomes at
  most `REGEN_AFTER` before now.
- **The wire.** The referee sends `{ t: 'hl', id, hp, d }`, where `d` is how much it healed. Everyone shows
  `+d` in green over the healed fighter.
- **It comes back** at a new random spot, a random 15 to 30 s later (`MEDKIT.back`). It is there from the
  start.

## 3. Weapon tuning

- **The sniper** reloads slower: 1.8 s between shots (was 1.2). Its aim line still brightens 0.3 s before
  it is ready.
- **The smg** does 8 a hit (was 6), so 16 on the head.
- **The deagle's** rounds fly until they hit a wall (`GUNS.deagle.range` = Infinity). The level is walled
  all round, so a round always ends, within about 2.5 s at 80 cells/s across the whole level.
  - Up to 6 of its rounds may be in flight (was 2), so its 0.4 s rate holds even when every shot flies the
    whole length.
  - Fired low, it is still unlimited. `LOW_RANGE` matters only for the smg and the sniper now.

## 4. The whole room for every gun

`SIDE_ROWS` is now `{ deagle: 33, rifle: 33, sniper: 33, scope: 45, none: 24 }`. Every gun sees the whole
room, as the sniper did. The sniper crouched or prone still pulls back to 45 rows (the scope). Out of the
fight it stays 24.

## 5. E only

Only E opens the photo in front of you, or the grid at the kiosk. Enter and Space no longer do: Space only
jumps.

## 6. The exit takes two hits

- **The exit** is the arena interior's east edge, where the door is (`holdAtExit`, `src/world.js`).
- **The first hit holds you in.** It stops you there and shows the note "hit the exit again to leave".
- **The second hit lets you out,** if it comes within `EXIT_AGAIN` = 3 s of the first. The exit is then
  open for `EXIT_OPEN` = 1 s and you walk out as before.
- **What counts as a hit.** A hit is starting to push into the exit. Holding on counts as one hit, so a
  knock, a roll or a held key can't carry you out. Let go and push again for the second; you don't need to
  step back first.
- A hit more than 3 s after the last one is a first hit again.
- Teleports (a link, the map, → in the viewer) leave at once, as before.

## 7. Spawn protection

Protection after spawning, respawning or entering (the PvP spec §2.1) already ended at your first shot or
strike, but it lasted only 1.5 s, too short to notice. It is now `SAFE_TIME` = 3 s. While it lasts you
can't be hurt, bodies pass through you, and you shimmer, as before.

## 8. An easier parry

- The parry window is `PARRY_TIME` = 0.28 s after the strike (was 0.2). That is still under the punch's 0.3 s
  cooldown, so mashing can't hold a parry up.
- The parry box is the strike's box grown by `PARRY_PAD` = 0.6 cells on every side, so the round is met a
  little sooner and a little higher or lower.
- In the test's setup a punch now parries from 0.27 s before the round would reach the bare box (was
  0.2 s).

## 9. Choices made for you

| question | choice |
| --- | --- |
| How much does a medkit heal? | 50, up to 100; refused at full health. |
| How often does it come back? | A random 15 to 30 s after it's taken, at a new spot. Present from the start. |
| Where may pickups appear? | Anywhere a body stands: roofs, floors, the gap's platforms. Not the level's sides or the doorway; 20 apart, 6 from a spawn. |
| Do you see where a taken one comes back? | Yes: its dim outline sits at the next spot. |
| The sniper's reload | 1.8 s (was 1.2). |
| The smg's damage | 8 (was 6). |
| The deagle's in-flight cap with unlimited range | 6 (was 2). |
| The scope | Kept: the sniper crouched sees 45 rows, everyone else 33. |
| Space | No longer opens photos, as Enter doesn't. |
| What counts as hitting the exit twice | Two separate pushes within 3 s; holding is one. |
| How long is spawn protection? | 3 s, still ended by your first shot or strike. |
| How much easier is the parry? | A 0.28 s window (was 0.2) and a box 0.6 bigger each way. |

## 10. Tests

- `test/referee.test.js`:
  - the spots: on standing spots, 20 apart, clear of spawns, the medkit last, spread across rands;
  - taking a gun: `pk` with the next spot, 20 away;
  - the medkit: full health refused, +50 with `hl`, back in 15 to 30 s, the regen counted and carried on;
  - the deagle's cap of 6;
  - the smg's 16 headshot;
  - the easier parry (a strike 0.25 s early parries; the grown box is met first);
  - 3 s of protection on entering.
- `test/pvp.test.js`:
  - pickups drawn where the referee or the server put them;
  - a taken one moving;
  - `[+]`;
  - the medkit offline (hurt and full);
  - `hl` online.
- `test/fx.test.js`: the deagle reaches the far wall.
- `test/fighters.test.js`: a remote's `sp` protects for 3 s.
- `test/fight.test.js`: the numbers.
- `test/arena.test.js`: `SIDE_ROWS` and the eased scope.
- `test/world.test.js`: the exit's two hits; holding is one; too late starts again.
- e2e:
  - `run.mjs`: the two-hit walk out, pickups read from the game, the 33/45-row zoom, the smg's damage from
    `GUNS`;
  - `multiplayer.mjs`: pickups at the server's spots.
