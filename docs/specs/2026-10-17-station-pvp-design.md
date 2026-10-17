# Station PvP: ASCII guns in the 3D station

Faiz's ask: "lets add ascii guns" → "Full PvP in the station". Decided in brainstorming (2026-10-17):

- **Opt-in.** You draw your gun to fight; only drawn players shoot or can be hit. Everyone else is safe.
- **Visible ASCII bullets**, flying at speed (not hitscan), simulated by the server.
- **Everywhere, across frames.** From a platform into a passing train and back, inside cars, on the bridge.
- **The arena's guns** (deagle, smg and sniper pickups, medkit), 100 hp with regen, respawn where you fell.
  Kills feed the arena's all-time streak board.
- **Approach A:** one pure referee, run by the Worker (the authority) and by the page (prediction), like the arena's.

## 1. What you see and do

**Drawing.** Q draws or holsters your gun. Holstering takes `HOLSTER = 1` s (you're still hittable until it's done).
Sitting (E), opening chat (T or Enter) or the fare machine holster you at once (no 1 s wait: you can't fire meanwhile
anyway). Either way, holstering within 3 s of being hit is a flee (§2).

**Aiming and firing.**
- First person (C): you aim where you look. The first click locks the pointer (firstperson.js); while it's locked,
  left click or J fires.
- Third person: the mouse aims at the point under the cursor at chest height (1.2 over your floor), and the body turns
  to face it while drawn. Left click or J fires.
- Held fire repeats at the gun's rate (the smg streams).
- Walking, Shift, the camera and the touch walk are unchanged. On a phone there's no PvP in v1: Q does nothing there,
  and the hint doesn't mention it.

**The ASCII guns.**
- In first person the gun is a glowing glyph model in the lower right: GUN_ART's glyphs from stick.js, the same art as
  the arena, as sprites parented to the camera.
- Each shot kicks it back 0.08 and up 3° for 0.12 s, and a `*` flashes at the muzzle for 60 ms.
- In third person, and for everyone else, the glyphs sit in the figure's right hand along the aim.
- A drawn player's name tag (others.js) gains a red ` ⌐╦`.

**Bullets and hits.**
- Bullets are glowing glyph sprites with a short fading trail: deagle `•`, smg `·`, sniper a long `—` streak.
- A hit throws 6 to 10 glyph sparks (`*+·'`) and floats the damage number up from the spot. A headshot shows `-50!`, as
  fx.js does.
- A bullet stopped by a solid makes a small spark there.
- When you're popped, your figure falls (the rig's pose with the body laid flat), and the arena's impact frame plays if
  impact frames are on.

**HUD.**
- While drawn, the arena's fight HUD shows over the station: fighthud.js with its hp line, a board of the drawn players
  (top 5 by station kills), the kill feed and the all-time streak line.
- When holstered it hides. The station's hint at the bottom left gains `[Q] draw`, or `[Q] holster`.

**Pickups.** The smg, sniper and medkit stand on the floor as slowly turning glyph sprites at their spots (§2). Walking
within 0.6 of one takes it.

## 2. The rules

**Scale.** The arena's body is 3 cells tall; the station's figure is 1.6. A station tile is 1, so one arena cell is
`K = 1.6 / 3 ≈ 0.53` tiles. The station's guns:

| gun    | damage | cooldown | speed (tiles/s) | range | ammo | spray (rad) |
|--------|-------:|---------:|----------------:|------:|-----:|------------:|
| deagle |     25 |     0.4  |              45 |    60 |   ∞  |           0 |
| smg    |      8 |     0.1  |              50 |    40 |   40 |        0.06 |
| sniper |     70 |     1.8  |             120 |   120 |    5 |           0 |

There's no knockback in 3D (the walker isn't physics), and no strikes or rolls in v1.

**Health.** MAX_HP 100. Regeneration is REGEN_RATE 20/s after REGEN_AFTER 4 s unhurt (fight.js's regenHp).

**Hurtbox.**
- A vertical cylinder of radius 0.3 from the feet to 1.25, and a head sphere of radius 0.2 centred at 1.42.
- Seated: the cylinder runs to 0.95 and the head is at 1.12.
- A bullet touching the head does HEADSHOT (×2, as fight.js).

**Protection.** SAFE 2 s after drawing or respawning; firing ends it. While protected you can't be hit (bullets pass).

**Popped.**
- hp ≤ 0: you drop. 3 s later you're back up with full hp, the deagle and protection.
- On the ground, you come back where you fell (unstuck by move.js if needed).
- On a train, you come back on the same train at the same spot in it, wherever the train is by then (if it has turned
  round, rider.js's re-keying applies).

**Fleeing.** Holstering (or leaving the station, closing the page, or anything else that ends your drawn state) within
FLEE_TIME 3 s of being hit counts as a kill by whoever hit you last, as fleeKiller does in the arena.

**Kills.**
- Each kill raises the killer's station `kills` and `streak`. Being popped resets your streak.
- A kill message carries the streak, so gallery.js's tell() hook records streaks ≥ 2 on CONFIG's all-time board and
  broadcasts `ks`. The station's messages get the same hook.
- Station kills are their own count (the station board); the streak board is shared with the arena.

**What stops a bullet.**
- **Station** (each station's map, at its x on the line): a solid tile (`#`, `n`, `x`, the kiosk, the turnstiles'
  cabinets) at any height; the floor under the bullet (levelAt; a track tile's floor is LEVEL.track); the ceiling
  (map.js's ceilings).
- **A car** of any train, local or express, as placed by the schedule at that moment. It's a box from x 0 to 15 along
  the car, z ±1.5 (CAR.half), y from F − 1.05 to F + 2.45, where F = LEVEL.platform.
  - Inside the box nothing stops a bullet: benches and poles don't.
  - Crossing its side walls (|z| = 1.5) passes only through a window (u within WINDOWS, y from F + 0.8 to F + 1.7) or an
    open door (doors open on that side, u within a door, y from F to F + 1.9). Elsewhere it stops.
  - Crossing an end wall stops, except at the gangway passage (|z| < CAR.pass, y from F to F + 1.9).
  - The roof and the floor stop.
- **The tunnel** (pieceAt(x).kind === 'tunnel'): its outer walls at z 0.5 and 18.5, the floor (LEVEL.track) and a roof
  at LEVEL.platform + 4.
- **The bridge**: only the trains themselves. The truss is open.
- The sweep steps each bullet at most 0.25 tiles at a time against solids, and tests the swept segment against
  hurtboxes, so a fast sniper round never skips a wall or a body.

**Where players are.**
- On the ground, the q position (x, z, y) is already in world coordinates (line x).
- Aboard: `tr`, x and z in the train's frame. The referee places them at trainOrigin(local(tr, t)) plus (x, z), with y
  LEVEL.platform, at the time t of the check.
- A player's last position is held up to EST_MAX (0.1 s) ahead along its velocity, then held, as the arena does.

**Pickups.**
- Each station gets one smg, one sniper and one medkit, placed at random among its walkable hall and platform tiles
  (not stairs, not the turnstiles' row), at least 8 tiles from each other and from where each was last.
- PICKUP_BACK 10 s for guns, MEDKIT.back 15 to 30 s, MEDKIT.heal 50.
- Guns go back to the deagle when their ammo runs out.

## 3. How it's built

**`src/rpg/fight3d.js`** (pure): the table above, the hurtbox, and the geometry:
- `solidAt(x, y, z, t)` for stations, cars and the tunnel;
- `bodyAt(rec, t)`, a player's world feet and pose;
- `sweepBullet(b, t0, t1, bodies)`, the first solid or body crossed.

It imports map.js, line.js, schedule.js, car.js and trainmesh.js's WINDOWS. WINDOWS moves to car.js so the server
doesn't import three.js. It never imports three.js itself.

**`src/rpg/referee3d.js`** (pure), built like src/referee.js. Its API: `draw(F, on, t)`, `fire(F, shot, t, all)`,
`tick(t, all)`, `pickup(F, n, t)`, `leave(F, t, all)`, `respawn`, `view(F, t)`, `pickups(t)`. It returns messages,
takes `rand`, and keeps no clocks of its own. Records are plain objects, so they survive Durable Object attachments.

**Wire** (station area only):
- **In:**
  - `zd {on}`;
  - `zf {x, y, z, yaw, pitch, ts}`: the muzzle in world coordinates, or in the train frame with `tr`;
  - `zk {n}`.
- **Out:**
  - `zw {you, pk, fighters}` on drawing;
  - `zs {id, n, x, y, z, yaw, pitch, w}`: a shot, for others to draw;
  - `zh {id, by, n, d, hp, hs}`;
  - `zx {id, by, kills, streak, fled?}`;
  - `zr {id, x, z, y?, tr?}`;
  - `zp {n, at, x, z}`;
  - `zd {id, on}`.
- The station's peer views gain `g: 1` while drawn.
- rules.js checks:
  - every number finite and within the station's bounds;
  - yaw within ±π, pitch within ±1.4;
  - `zf` rate per gun (takeShot);
  - a muzzle more than 1.5 tiles from the server's estimate is replaced by the estimate.
- STATION_FIGHT = 1 goes into the welcome. A mismatch disables Q, with a note.

**Server** (`server/gallery.js`):
- A second referee per instance for the station, made lazily like `referee()`.
- Its own 33 ms tick while bullets fly, sharing startTick's pattern.
- tell()'s streak hook also fires for `zx`.
- The server's clock for trains is `sharedTime(Date.now())`, the same as the page's mp.now().

**Page:**
- `src/rpg/fightmp.js` (pure-ish, like pvp.js): local prediction (my bullets drawn at once, my hits shown at once, the
  server's `zh`/`zx` win), the messages, and the HUD's data.
- `src/rpg/guns3d.js` (three.js): the first-person gun, the guns in hands, bullets, sparks, damage numbers, pickups.
- `index.js` wires in Q, clicks, J, the aim, the HUD (fighthud.js, given a root in the station's stage) and the name tag.
- Offline (no mp): you can draw and fire, bullets hit walls, there are no pickups or targets, and nothing is sent.

## 4. Testing

- `test/station-fight3d.test.js`:
  - solids: a wall tile, a floor, a car's metal versus a window, an open versus a shut door, a gangway, the tunnel wall,
    the bridge's open air;
  - the hurtbox: standing, seated, a headshot;
  - the sweep never tunnels at sniper speed.
- `test/station-referee3d.test.js`:
  - draw and protection;
  - firing with cooldown and ammo;
  - a hit and a pop; a respawn on the ground, and on a train that has moved on;
  - fleeing by holstering;
  - a shot from the platform into a standing train's open door, and into a passing train's window;
  - pickups.
- `test/rules.test.js`: zd, zf and zk parsing and bounds.
- `server/test/server.test.js`: two people in the station draw, one shoots the other to a pop, the streak board hears
  it. This suite is slow in Claude's container.
- e2e:
  - `e2e/station.mjs`: Q draws (gun model shown in first person, with a screenshot), a click fires, a bullet is drawn
    and stopped by a wall;
  - `e2e/station-mp.mjs`: one page shoots the other to a pop.

## Not in v1

Phones; strikes, rolls and parries; knockback; reloading; separate station streak boards; ammo counts on others' tags.
