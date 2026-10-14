# Arena PvP: design

Date: 2026-10-14
Status: approved design, not built yet. It ships in the same release as the arena itself
(`2026-10-13-arena-design.md`, built and committed locally, not pushed). It replaces that spec's
sub-project 2 and supersedes its §7 ("Protocol: unchanged" and the "straight segments" limitation).
Drawing and animating the fighters as ASCII stickmen is a separate spec, written in parallel; the two
meet at the body state in §4.

## 1. Intent

Walk into the arena and you are in a fight. Everyone inside fights everyone: a gun that fires visible,
dodgeable ASCII bullets, and a quick punch or kick up close that sends people flying. Get hit enough and
you pop, then come back a couple of seconds later. The fun is in the movement, so other people must move
as fluidly on your screen as you do on theirs, and the server, not the browsers, decides who hit whom.

### What the user chose

- **Drop-in free-for-all**: no lobby, no rounds. Walking in is joining. A small kill scoreboard shows
  while you are in the arena.
- **Gun + melee**: one gun with visible bullets and a short cooldown, plus a punch/kick with knockback.
- **Aiming**: you shoot the way you face; holding ↑ or ↓ while shooting angles the shot 45°. J shoots,
  K punches or kicks. Phones get FIRE and HIT buttons near JUMP. On a desktop the mouse aims too: click
  anywhere to shoot toward the cursor, at any angle.
- **Fluid movement**: the animation may be a bit choppy, the movement must not be. Remote fighters must
  not look like straight segments.
- **Server-decided hits**: no client ever says "I hit him".
- **Stickmen** in the arena (the other spec). Fake visitors never enter the arena. Nothing outside the
  arena changes.

### Choices made for you

Each of these is a judgment call. The alternative is what I would do if you want it changed.

| Choice | Alternative |
|---|---|
| **A practice dummy** stands in the arena when you are alone or offline (§9) | Nothing: alone, the arena is just a platformer |
| **Remote fighters are predicted to the present** with the shared physics, not shown behind real time (§7) | Show them 100 ms behind with smooth curves between updates: safer on bad networks, but you aim at the past |
| **15 updates a second** in the arena, plus an instant one when someone's input changes (§5) | A flat 20 a second: simpler, about 35% more requests |
| **No lag compensation**: the server tests hits where it believes people are now (§6) | Rewind targets by the attacker's half round trip (up to 150 ms): kinder to attackers, harsher to dodgers |
| **Health regenerates** 20 hp/s after 4 s without damage (§2.1) | No regeneration: health refills only on respawn or re-entry |
| **Fleeing counts**: leaving within 3 s of taking damage gives the last hitter the kill (§2.5) | Leaving is always free |
| **Kills last for your visit** (your connection), across walking out and back in (§2.6) | Reset whenever you leave the arena |
| **With the mouse, you face the cursor**, so you can run one way and shoot the other (§3) | Facing follows your running; a shot behind you turns you only for the shot |
| **↑ aims up and still jumps** (W, ↑ and Space stay jump keys); ↓ on a `═` still drops through (§3) | ↑ only aims; W and Space jump |
| **Right-click punches or kicks** on a desktop, alongside K (§3) | K only |
| **Holding FIRE (J, mouse, button) keeps firing** at the cooldown rate (§3) | One shot per press |
| **Bullets pass through `═` platforms**, and stop at `▓`, walls, floor and ceiling (§2.2) | Platforms stop bullets too |
| **Opening a photo, the map or the grid, or hiding the tab, takes you out of the fight** (§8) | You stay in and can be hit while away |
| **Spawn points are marked in `arena.txt`** with `S` (§2.5) | A fixed list in code |

### Success criteria

- Two people in the arena can shoot, punch and kick each other. A hit is felt at once (spark, knockback,
  damage number) and the health shown is the same on both screens.
- Someone jumping, landing on a platform and turning around on the other screen moves in smooth arcs,
  never in straight segments, and never pops more than a fraction of a cell between frames.
- Bullets can be dodged at medium range by jumping or dropping through a platform.
- Popping, respawning, the scoreboard and the kill feed work with 2 to 30 people.
- Mouse aiming works at any angle on a desktop; FIRE and HIT work on a phone in landscape.
- Alone, offline, or with the server down, the arena still works and the dummy can be fought.
- Normal use stays inside Cloudflare's free tier.
- Outside the arena, the gallery and its multiplayer behave exactly as today.

## 2. Rules

All rules and numbers live in a new pure module, **`src/fight.js`**, imported by the browser and by the
Worker, so the server, the dummy and the tests use the same code. Distances are in cells (horizontal,
the unit of `RUN`) and rows (vertical, the unit of `GRAVITY`); a row is twice as tall as a cell is wide
(`CELL_ASPECT`). Angles are true on-screen angles.

### 2.1 Health and protection

| | value | why |
|---|---|---|
| health (`MAX_HP`) | **100** | round numbers for damage |
| regeneration | **20 hp/s**, starting **4 s** after the last damage taken | keeps a drop-in fight flowing without a medkit system; 4 s is long enough that it never saves you mid-exchange |
| protection after spawning or entering | **1.5 s**, ended early by shooting or striking | long enough to see where you are; can't be used to attack safely |

- Regeneration is computed lazily from the time of the last damage, on the server and in the browser
  alike, so it needs no timer.
- While protected you can't be damaged: bullets pass through you and strikes miss. You are drawn
  dimmed (the stickman spec decides how, from `safe`).
- You can never damage yourself. Your bullets never hit you, and there are no hazards, pits or fall
  damage.

### 2.2 Gun

| | value | why |
|---|---|---|
| bullet speed | **80 cells/s** on screen (so 40 rows/s straight up or down) | about 2.7× running speed: fast enough to matter, slow enough to see |
| damage | **12** | 9 hits to pop from full |
| cooldown | **0.3 s** (3.3 shots/s) | a sustained gun-only kill takes at least 2.4 s, leaving time to react |
| range | **0.8 s** of flight: 64 cells across, 32 rows up | no cross-map sniping in a 160-wide room; it pushes fights close, where melee lives |
| bullets in flight per person | at most **3** | follows from range and cooldown; enforced anyway |
| knockback | **8 cells/s** away, **0.08 s** stun | a nudge you feel, not a launch |

- **Dodging**: at 28 cells away a bullet takes 0.35 s to arrive, about a reaction plus a round trip.
  Jumping clears a 1-row bullet in about 0.03 s. So bullets are dodgeable from about a fifth of the
  room, not point-blank.
- A bullet starts at the muzzle of the drawn gun: `MUZZLE_R` along the aim ray from the shoulder
  (`SHOULDER`, 1.8 rows above the feet; both exported from the stickman's `src/stick.js`). The server
  uses the same two constants.
- It flies in a straight line, with no gravity. It stops at `▓`, at anything outside the 160 × 34
  interior (walls, floor, ceiling, the door), and at the first unprotected, living body it touches. It
  passes through `═`.
- The **hurtbox** is 1.0 cell wide and `FIGURE_ROWS` (3) rows tall, centred on `(x, y)`: the body's
  0.8 × 3-row physics box (the stickman spec's), a little wider. The feet are at `y + 1.5`.
  `FIGURE_ROWS` is exported from `fight.js` (see Interface changes).

### 2.3 Melee

One key, K (or HIT, or right-click). Whether it is a punch or a kick follows from the situation.

| | punch | kick |
|---|---|---|
| when | on the ground, 1st and 2nd hit of a combo | in the air, or the 3rd hit of a combo |
| damage | **14** | **22** |
| reach in front | **1.8 cells** | **2.2 cells** |
| vertical band | the middle 70% of your figure | your whole figure plus 1 row below your feet |
| knockback | **25 cells/s** away, **10 rows/s** up | **45 cells/s** away, **22 rows/s** up |
| stun | **0.2 s** | **0.4 s** |
| cooldown after it | **0.3 s** | **0.55 s** |

- **Combo**: three strikes, each within **0.5 s** of the previous, go punch, punch, kick. The kick ends
  the combo. Punch, punch, kick does 50 damage and launches the target, so two combos pop someone.
- A strike hits every unprotected, living body whose hurtbox overlaps the strike box at the moment the
  server receives it. There is no wind-up delay in the rules; the animation shows the strike extended
  within 0.06 s, so the hit reads on time.
- A kick at 45 cells/s with a 0.4 s stun carries the target about **11 cells** and lifts them about
  2 rows. A punch carries them about 5 cells. Knockback is what makes it a stick fight.

### 2.4 Knockback and stun (`src/arena.js`)

`stepBody` gains a stun state, and a `knock(body, kx, ky, stun)` that sets the velocity, leaves the
ground if `ky` is upward, and starts the stun.

- **While stunned**: your input is ignored; horizontal speed decays with a time constant of **0.35 s**
  (instead of steering toward your input in 0.07 s), on the ground and in the air; gravity and
  collisions are as usual. Without this, normal ground friction would stop a kick in under 4 cells.
- **The door is a wall while stunned**: a knockback can't carry you out of the arena. Walking out
  yourself still works.
- Knockback is gameplay, so it is the same with Reduce Motion on. The Reduce Motion shortcut (instant
  acceleration) does not apply to the stun decay.
- Being hit in mid-air by a bullet doesn't cancel your jump. A strike does (its knockback replaces your
  velocity).

### 2.5 Kills, popping and respawning

- **A kill** is the hit that takes someone to 0 hp. Its owner gets +1.
  - Bullets already in flight when their shooter pops can still hit, and can still kill.
  - Two people can pop each other at once; both kills count.
  - There are no environmental kills: no pits, hazards or fall damage, and knockback can't throw you
    out the door. There are no self-kills: your own bullets never hit you.
  - **Fleeing**: if you leave the fight (walk out, close the tab, open a photo; §8) within **3 s** of
    taking damage from someone, that person gets the kill. The feed says "Bo fled from Ann".
  - No assists, no deaths column.
- **Popping**: your body pops (the stickman spec's `dead` act) where it stands. Your controls stop. A
  note says "popped by Ann" (or "by someone").
- **Respawn delay**: **2.0 s**. Then the browser asks the server to respawn, and the server picks the
  spot.
- **Spawn points**: `src/arena.txt` gains spawn markers, the letter `S`, in the feet row: the row
  directly above what the body stands on, with the 3 cells above the surface air (the marker's own
  cell and the two above it). `parseLevel` treats `S` as air and returns their positions.
  - There must be 4 to 8, each with something to stand on directly below, and none within 10 columns of
    the door.
  - The first set is six, on the Penn Station level (DSCF9139): two on the yellow line (one west of the
    left pillar, one between the pillars), two on mid-height platforms and two on high platforms, one
    of each pair in each half of the room. None in the track bed under the yellow line.
  - The server picks the spawn whose nearest living, in-arena opponent is farthest away, breaking ties
    at random.
- After respawning you have full health and 1.5 s of protection.

### 2.6 Scoreboard and kill feed

- **What**: everyone currently in the arena, with their kills, highest first. Up to 5 rows, plus you
  if you are not in the top 5. Each name has a `●` in that person's colour; unnamed people are
  "someone", and you are "you". Above it, your own health: `hp ██████████ 100`.
- **Kill feed**: under the scoreboard, the last 3 kills, each for 4 s: "Ann popped Bo", "Bo fled from
  Ann". The same text goes to the existing polite screen-reader caption.
- **Where**: a small DOM box at the top right, just under the HUD (top 48 px, right 16 px), in the HUD's
  font and colours, `pointer-events: none`. On a landscape phone it shows hp and the top 3.
- **When**: only in side view, and only when at least one other fighter is in the arena. Alone or
  practising, only the hp line shows.
- **Resets**: kills belong to your connection. They survive walking out and back in, and reset when you
  reconnect (a reload, or the tab hidden for 30 s). Nothing is stored.

## 3. Controls and aiming

### Keyboard

- Movement, jumping, sprinting and dropping are unchanged.
- **J**: shoot. Held, it keeps firing every 0.3 s.
- **K**: punch or kick (§2.3). Each press is one strike; holding does nothing more.
- **Aim**: straight ahead in the direction you face. Holding **W/↑** tilts the shot 45° up; holding
  **S/↓** tilts it 45° down. ↑ also jumps and ↓ also drops through a `═` you stand on, as in the arena
  today; a jumping up-shot is a natural move, so this stays.
- J and K are unused elsewhere. They are ignored while a text field has focus, like the other keys.

### Mouse (desktop)

- **Mouse aim** turns on when the mouse moves over the stage in the arena, and off when you press J
  (until the mouse moves again).
- While it is on, you **face the cursor's side** and the gun follows the cursor at any angle, so you
  can run one way and shoot the other. Your stickman's facing then disagrees with its running direction
  (it runs backwards).
- **Left button**: shoot toward the cursor; held, it keeps firing. **Right button**: punch or kick; the
  browser's context menu is suppressed on the stage while in the arena.
- The cursor's position is turned into a world point by a new `pointAt(world, px, py)` in **both**
  renderers, which returns fractional cells (today's `cellAt` floors them).
- Clicks in the arena already do nothing else (tap-to-walk and following are off there).

### Phones (touch screens)

- The pad gains **FIRE** and **HIT**. The right-hand cluster becomes a 2 × 2 block: `HIT ▼` on top,
  `FIRE JUMP` below, with FIRE beside JUMP so a thumb can roll between them. Every target is at least
  56 px; FIRE and JUMP are 64 px.
- Holding FIRE keeps firing. HIT strikes once per tap.
- **Aim**: FIRE shoots the way you face. FIRE while holding JUMP angles it 45° up; FIRE while holding ▼
  angles it 45° down. The same rule as the keyboard.
- The buttons use the pad's existing pointer capture, so several fingers work at once.

### What `aim` is

- `aim` is relative to facing: 0 is straight ahead, positive is down, in on-screen radians, always
  within **[−π/2, π/2]**. With the mouse, a cursor behind you flips your facing, so aim never points
  backward.
- Keyboard and phone: 0, or ±π/4 while up/down is held (even when not shooting, so the gun arm shows
  where the next shot goes).
- Mouse: the angle from your chest to the cursor.

## 4. The body state

This is the interface the stickman spec consumes. The PvP layer produces it for you, for each remote
fighter and for the dummy, every frame.

```
{ x, y, vx, vy, facing: -1|1, ground: bool, aim, act, actT, hp, safe, combo }
```

- `x, y`: map cells, the centre of the body's 0.8 × 3-row box (feet at `y + 1.5`), where the renderers
  draw. The wire uses
  arena-local cells (§5); the conversion happens at the edge.
- `vx, vy`: cells/s and rows/s, as in `arena.js`. `facing` may disagree with the sign of `vx` (mouse
  aim, §3).
- `aim`: §3. `hp`: 0..`MAX_HP`, regeneration included. `safe` and `combo`: see Interface changes.
- `act` and how long it lasts:

| act | starts when | lasts |
|---|---|---|
| `idle` | otherwise (running and jumping are read from `vx`, `vy`, `ground`) | — |
| `shoot` | a shot is fired; a new shot restarts `actT` | 0.2 s |
| `punch` | a punch | 0.25 s |
| `kick` | a kick | 0.4 s |
| `hurt` | damage taken | the stun (0.08 / 0.2 / 0.4 s) |
| `dead` | popped | until respawn (2 s) |

- **Where acts come from**: your own `shoot`, `punch` and `kick` start the moment you press (the
  browser predicts which strike it is by the same rule as the server). `hurt` and `dead` come only
  from the server. For remote fighters, every act comes from server messages.
- When two acts overlap, the later one wins, except that `dead` is never replaced until respawn.
- Names, chat lines, emotes and each person's colour stay outside the body state and are drawn as
  today by `live.js`, at the fighter's displayed position.

## 5. Protocol

JSON text frames, as today. Every client message stays under the **200-byte** limit (the worst case
below is 95 bytes). Server messages have no limit but stay small.

### Coordinates, versions and who receives what

- **Arena-local cells**: `x` is 0..160 across the interior, `y` 0..34 down, the body's centre. They
  don't depend on the gallery layout, so the server only needs the level file. Allowed range:
  `-1 ≤ x ≤ 163` (the door), `-1 ≤ y ≤ 35`.
- **Version check**: the server's `welcome` gains `fight: "<8 hex>"`, a hash of the level file it
  loaded. The browser fights only when `fight` matches the hash of its own `arena.txt`. A missing or
  different value (an old server, or a level edit not yet deployed) means: no fighting, the dummy, and a
  `console.warn`.
- **Arena traffic goes only to people in the arena.** Outside it, people get nothing new. While you
  are in the arena your browser sends no `p` messages; outsiders' maps show you at your last `p`, at the
  arena door. On leaving, a `p` goes out at once.

### Client → server

| Message | Bytes (max) | Meaning |
|---|---|---|
| `{t:'ae'}` | 10 | I entered the arena (or came back from being away, §8) |
| `{t:'al'}` | 10 | I left the arena or went away |
| `{t:'a', x, y, vx, vy, f, g, i, a, ts}` | 95 | my state: position (2 decimals), velocity (1 decimal), facing ±1, on the ground 0/1, input bits, aim (2 decimals), my clock |
| `{t:'f', x, y, a, ts}` | 54 | I fired from (x, y) at on-screen angle `a` (absolute: 0 = east, + = down, −π..π) |
| `{t:'m', k, ts}` | 31 | I struck; `k` is `'p'` or `'k'`, what my browser predicted |
| `{t:'rs'}` | 10 | respawn me (sent 2 s after popping) |

- **Input bits** `i`: 1 left, 2 right, 4 jump held, 8 down held, 16 sprint. Other browsers need these
  to predict you (§7).
- **`ts`**: milliseconds since I entered the arena, an integer. It restarts at each `ae`.

### Server → client (to people in the arena)

| Message | Bytes (typical) | Meaning |
|---|---|---|
| `{t:'aw', lv, you:{hp, kills}, fighters:[{id, hp, kills, alive, safe, x, y, vx, vy, f, g, i, a}]}` | ~130 per fighter | arena welcome: everyone already inside (about 3.8 kB with 30) |
| `{t:'aj', id, hp, kills}` / `{t:'ax', id}` | 48 / 26 | someone entered / left the fight |
| `{t:'a', id, …}` | 111 | someone's state, as they sent it (or clamped, §6) |
| `{t:'s', id, n, x, y, a}` | 66 | someone fired bullet number `n` |
| `{t:'mm', id, k}` | 34 | someone struck (sent for misses too, so everyone sees the swing) |
| `{t:'h', id, by, w, n, d, hp, kx, ky}` | 93 | `id` took `d` damage from `by` with weapon `w` (`b`/`p`/`k`), bullet `n` if any; new hp; knockback velocity |
| `{t:'k', id, by, kills, fled}` | 63 | `id` popped (or fled); `by` now has `kills` |
| `{t:'sp', id, x, y}` | 45 | `id` respawned here, protected |

- Bullet numbers `n` count up per instance and wrap at 65536.
- Senders also receive their own `s`, `mm`, `h`, `k` and `sp`. They need them to learn about
  rejected or downgraded actions and their own hits.

### Send rates (browser)

- **Outside the arena**: unchanged (`p`, at most 5 a second).
- **Inside**: `a` at most **15 a second** (every 67 ms) while anything changes: position, velocity,
  facing, ground, input bits, or aim by more than 0.05 rad.
- **Urgent sends**: a change in input bits, a take-off, a landing, a facing flip or a knockback sends
  at once, as long as 30 ms have passed since the last `a`. Otherwise it goes out at the 30 ms mark.
  These are the moments where prediction would otherwise go wrong.
- **Cap**: never more than **20** `a` per rolling second. Beyond that, urgent sends wait for the next
  regular slot.
- **Standing still sends nothing**, as today.

## 6. Server

`server/gallery.js` stays a relay with hibernation, with one exception: a short tick while bullets are
in flight. Its new rules sit in `server/rules.js` and `src/fight.js`. The level comes from
`src/arena.txt`, imported as text (Wrangler bundles `.txt` files as text by default). `parseLevel` moves
to a new import-free `src/level.js`, so the Worker doesn't pull in the gallery layout; `arena.js`
re-exports it.

### What it keeps per person

In the socket attachment, so it survives hibernation (well under the 2 kB limit):

| Field | Meaning |
|---|---|
| `arena` | in the fight |
| `st` | the last accepted state (`x, y, vx, vy, f, g, i, a`) and when it arrived |
| `hp`, `hurtAt` | health at the last damage, and when (regeneration is computed from these) |
| `alive`, `deadAt` | popped, and when |
| `safeUntil` | protection end |
| `kills` | kills this connection |
| `combo`, `strikeAt`, `airAt` | combo count, last strike time, last time seen in the air |
| `hitBy` | who last damaged me, for the flee rule |
| buckets | new token buckets for `a`, `f`, `m`, `ae`/`al` and `rs` |

In memory only: the bullets in flight and the tick timer. These live for under a second, so losing
them to an eviction costs nothing.

### Checks

- **Membership**: `a`, `f`, `m` and `rs` from someone not in the arena are dropped (and counted
  toward the flood limit, like any malformed message).
- **Rates** (token buckets, capacity and refill per second):

| kind | capacity | refill | note |
|---|---|---|---|
| `a` | 24 | 20/s | the browser's cap plus jitter |
| `f` | 2 | 3.4/s | the 0.3 s cooldown, with room for two shots bunched up by the network |
| `m` | 2 | 3.4/s | the punch cooldown; after a kick, the next strike also needs 0.5 s (the 0.55 s cooldown less jitter) |
| `ae`/`al` | 4 | 1/s | |
| `rs` | 2 | 1/s | also needs 1.9 s since popping |

- Messages over the limit are dropped silently and count toward the existing flood limit (50 drops in
  10 s closes the connection).
- **State sanity** (`a`):
  - Numbers must be finite and in range; `|vx|, |vy| ≤ 60`; `f` ±1; `g` 0/1; `i` 0..31;
    `|a| ≤ π/2`.
  - The body's centre must not be inside `▓`. If it is, the state is dropped.
  - **Speed**: the move from the previous state may be at most `60 × gap × 1.25 + 0.5` cells across
    and rows down, where `gap` is the `ts` difference. A sender's `ts` may not run more than 300 ms
    ahead of the server's clock over the last 5 s. A move beyond this is **clamped** to the limit along
    the same line, and the clamped state is what the server stores, tests hits against, and forwards.
    A speed-hacker is therefore seen, and hit, where they could legally be.
  - States from a popped fighter are dropped without counting as flood (some are always in flight).
- **Shots** (`f`): the shooter must be alive and in the arena, and have fewer than 3 bullets in flight.
  The origin must be within 3 cells across and 2 rows down of the server's estimate of their hand;
  otherwise the estimate is used instead. Firing ends protection.
- **Strikes** (`m`): a claimed kick is accepted if the striker was in the air within the last 150 ms,
  or it is the 3rd strike of a combo. Otherwise it becomes a punch. Striking ends protection.

### Hit resolution

- **Where people are**: the server's estimate of someone is their last state moved on by its velocity
  for the time since it arrived, at most **100 ms** (then held). At 15 updates a second this is rarely
  more than 67 ms of guessing, and gravity's error over that is about 0.3 rows.
- **Bullets** are simulated on the server from the moment it receives the shot, in ticks of **33 ms**.
  - A tick tests each bullet's motion relative to each target over the tick against the target's
    hurtbox (a segment against a box), so neither can skip past the other between ticks, even a
    sprinting target against a bullet.
  - The wall a bullet will hit is found once, when it is fired, by walking the grid along its line.
  - The first body touched takes the hit: damage, knockback away from the bullet's direction, `h` to
    everyone in the arena, and a `k` if it pops them.
- **The tick** is a `setInterval` that starts with the first bullet and stops when none are left. It
  keeps the object awake for at most 0.8 s after the last shot. Nothing else uses a timer: respawns are
  requested by the browser, and regeneration is lazy.
- **Strikes** are resolved when they arrive, against everyone's estimate at that moment. Every body hit
  gets `h`; the striker's `mm` goes out either way.
- **No lag compensation.** The server never rewinds anyone. This is the right trade for this site:
  - remote fighters are drawn predicted to the present (§7), so what you aim at is close to what the
    server tests;
  - bullets are slow and visible, so the server should favour the person dodging what they see;
  - the server needs no position history and no per-person latency;
  - the melee reaches (1.8 and 2.2 cells, plus the 1-cell-wide hurtbox) absorb about 100 ms of
    movement.
  The cost: on a slow connection, a running target you strike at the edge of your reach can get away.
- **Popping and respawning**: at 0 hp the server sets `alive: false`, credits the killer, and sends
  `k`. A later `rs` (at least 1.9 s on) gets a spawn point (§2.5), full health and 1.5 s of protection,
  and `sp` goes to everyone in the arena.
- **Leaving** (`al`, or the socket closing): `ax` goes to the arena. If `hitBy` damaged them within
  3 s, that person gets the kill and `k` with `fled: 1` goes out.

## 7. Remote fighters: fluid movement

A new pure module, **`src/fighters.js`**, keeps the remote fighters (the arena's counterpart of
`peers.js`). Remote fighters are simulated, not interpolated.

- **Each remote fighter is a body** that `arena.js`'s `stepBody` moves every frame, with that person's
  last known input bits, against the same level. Between updates they therefore run, jump in a proper
  arc, land on platforms and drop through them exactly as they do on their own screen. They never move
  in straight segments.
- **When a state arrives**:
  1. Its age is estimated from the sender's `ts`, corrected for jitter (the smallest
     `arrival − ts` over the last 2 s is the baseline), plus half the round trip I measured at connect.
     The total is capped at 150 ms.
  2. A fresh body is built from the state and run forward by that age with the sender's input. That is
     where they are now.
  3. The difference between where they were drawn and this new position is kept as a **correction**
     that fades out with a time constant of **80 ms**. They glide onto the right path instead of
     jumping to it. A difference over **4 cells** (a respawn, a clamp) snaps instead.
- **Displayed** = simulated body + fading correction. Facing and `ground` come from the latest state;
  aim is smoothed over 60 ms so the arm doesn't jitter.
- **Mispredictions** happen only when someone's input changes. The sender sends those changes at once
  (§5), so a remote fighter is off course for about one-way latency (typically 30–80 ms) and then
  glides back in about 80 ms.
- **Hits are applied at once**: when an `h` arrives for a remote fighter, its body is knocked back
  immediately, with the same `knock()`, rather than waiting for its owner's next state.
- **Silence**: if no state arrives for 300 ms, their input is treated as released (they slow to a
  stop, the jump ends). This way a lagging person doesn't run into a wall forever.
- **Reduce Motion users** move with instant acceleration on their own screens. Prediction uses normal
  acceleration; the difference is corrected by the next state.
- Remote bullets (`s`) are drawn from their origin, moved on by half my round trip, along the same
  line the server uses, and end at the wall the shared ray cast finds, or at the matching `h`.
- **Your own bullets** start the moment you shoot. When one overlaps a fighter as drawn on your screen,
  it stops there and vanishes, but the spark, damage number and knockback wait for the server's `h`
  (about one round trip). If no `h` comes, nothing more happens: it reads as a near miss.

Why prediction rather than drawing people behind real time: the arena spec's 250 ms delay is why jumps
looked like segments, and any delay means aiming at where someone was. Running the real physics forward
gives arcs and landings that are exact by construction, and puts people near where the server believes
they are, which is what hits are tested against.

## 8. Joining, leaving and being away

- **Entering** (through the door, by a `#/room/arena` link, or arriving by teleport): the browser sends
  `ae`. The server answers `aw` with everyone inside and their health, kills and states, and sends `aj`
  to the others. You start with full health and 1.5 s of protection wherever you are (normally the
  door, so camping it is pointless). Bullets already in flight are not sent; they last under a second.
- **First entry per visit**: a note shows "J shoot · K hit · mouse aims" on a keyboard device, for 4 s.
  Phones have labelled buttons and get no note.
- **Leaving through the door**: `al` goes when the tilt starts. Your health is forgotten: you come back
  in at full health. Your kills are kept (§2.6). Within 3 s of taking damage, the flee rule applies.
- **Away**: opening a photo (E), the map (M) or the grid (G), or the tab becoming hidden, sends `al` at
  once. You vanish from the fight; your body freezes on your own screen. Closing it again sends `ae`,
  with fresh health and protection. This stops a frozen, unattended fighter from being farmed. It
  can't be used to escape a losing fight, because of the flee rule.
- **While popped**: leaving is allowed and costs nothing more (the kill was already counted).
- **Disconnects**: the server treats a closed socket like `al`. Your browser clears the remote
  fighters (they fade out, as today), drops bullets in flight, resets your health, and shows the dummy
  after 2 s. On reconnecting it sends `ae` again; your kills restart at 0 (it is a new connection).

## 9. Alone or offline: the practice dummy

- **When**: in side view, when no other fighter is in the arena. That covers being alone, multiplayer
  off or down, all instances full, the free tier exhausted, and a `fight` version mismatch.
- **What**: a stickman labelled `dummy`, drawn grey, standing on the floor at column 80 (or the
  nearest clear floor), facing the door.
  - It never moves on its own and never attacks.
  - It takes hits by the same `fight.js` rules, run locally: damage numbers, knockback (it can be
    juggled), and popping.
  - It comes back at the same spot 2 s after popping. It regenerates like anyone.
- **Kills on the dummy don't count** and the scoreboard stays hidden; only your hp line shows.
- **When a real fighter enters**, the dummy pops quietly (no feed line) and stays away until you are
  alone again.
- **Local only**: nobody else ever sees your dummy, and nothing about it is sent.

## 10. Drawing

Everything the PvP layer adds is either an entity in `world.entities` (`{x, y, glyph, color}`), which
**both renderers** already draw over the light, or DOM. Neither renderer needs changes apart from
`pointAt` (§3). The stickmen themselves are the other spec's.

| What | How |
|---|---|
| bullet | 2 glyphs: a bright head and one dimmer tail glyph behind it. The glyph follows the direction: `-` within 22.5° of horizontal, `\` or `/` for diagonals, `\|` for vertical. Colour: the shooter's colour mixed 50% toward white (yours: the player colour) |
| muzzle flash | `*` at the gun hand for 0.06 s |
| hit spark | 3 glyphs (`*`, `+`, `·`) flying out from the hit point for 0.25 s, in warm white |
| damage number | `-12` rising 1 row over 0.6 s and fading, above the body hit |
| hp bar | 5 cells above the head, `█` per 20 hp and `░` for the rest, in red-orange; shown for anyone below full health, hidden at full |
| dummy label | `dummy` on the row beneath it, like a name |
| scoreboard, own hp, kill feed | DOM (§2.6) |
| camera shake | when you are kicked or popped: 0.15 s, up to 0.4 cells, applied to the camera in `world.js` |

### Reduce Motion

- No camera shake.
- Hit sparks appear in place for 0.2 s instead of flying out.
- Damage numbers appear in place for 0.6 s instead of rising.
- Protection is shown steadily (the stickman spec dims rather than blinks).
- Bullets, knockback and remote movement are gameplay and are unchanged.

## 11. Free tier

Durable Objects bill incoming WebSocket messages at 20 per request, and the free plan allows **100,000
requests a day** and **13,000 GB-s of duration a day** (about 29 hours of one awake object). Outgoing
messages are not billed.

| | messages per fighter-hour | requests per fighter-hour |
|---|---|---|
| state, typical (15/s while moving, about 70% of the time, plus urgent sends) | ~43,000 | ~2,150 |
| shots and strikes, typical (~2/s) | ~7,000 | ~350 |
| **typical total** | ~50,000 | **~2,500** |
| worst case (20 states + 3.3 shots + 3.3 strikes every second) | ~96,000 | ~4,800 |
| for comparison: walking the gallery non-stop today | 18,000 | 900 |

- The daily allowance covers about **40 fighter-hours** of typical play (20 at the worst case), less
  whatever gallery walking uses. For a hobby site this is far more than expected; two people fighting
  for half an hour use about 2.5% of a day.
- **Duration** barely changes. An instance is already awake whenever anyone in it is moving, and the
  bullet tick only runs during fights, for at most 0.8 s after a shot. Duration grows with the hours
  instances are busy, not with the number of people in them.
- **CPU** per message is a parse, a few checks and up to 29 sends. A tick is at most 90 bullets × 29
  targets of box tests. Both are trivial.
- **At the limit**, connections fail, and the arena falls back to the dummy (§9), as the rest of the
  gallery falls back to working alone.
- **Deploying**: `.github/workflows/server.yml` also runs on changes to `src/fight.js`, `src/level.js`,
  `src/stick.js` (for its `SHOULDER` and `MUZZLE_R`, so it must stay pure, with no browser APIs) and
  `src/arena.txt`, since the Worker bundles them. The `fight` hash (§5) covers the gap while one
  side is deployed and the other is not.

## 12. Where the code goes

| File | Change |
|---|---|
| `src/fight.js` (new, pure) | numbers, aim, bullets (spawn, ray cast, relative sweep), strikes, combo, damage, regeneration, protection, spawn choice, flee rule, the dummy |
| `src/level.js` (new, pure, no imports) | `parseLevel` (now with `S` spawn markers) and the cell kinds; the level hash |
| `src/arena.js` | stun and `knock()`; door-as-wall while stunned; re-exports `level.js` |
| `src/fighters.js` (new, pure) | remote fighters: prediction, correction, acts, bullets on screen |
| `src/live.js`, `src/net.js` | the `a` ticker and its rates, the new messages, `fight` check |
| `src/world.js` | the player's body state, facing from the mouse, camera shake |
| `src/input.js`, `src/main.js`, `index.html`, `src/style.css` | J, K, mouse, FIRE and HIT, the scoreboard, kill feed, notes, entities |
| `src/render/canvas.js`, `src/render/gl.js` | `pointAt` |
| `src/config.js` | `ARENA.pvp: true`; `false` turns fighting off and leaves the arena as its own spec describes |
| `server/rules.js`, `server/gallery.js` | new messages, checks, buckets, the bullet tick, arena-only broadcast |
| `.github/workflows/server.yml` | the extra paths (§11) |

## 13. Failures

| Situation | Behaviour |
|---|---|
| Alone in the arena | The dummy; hp line only |
| Multiplayer off, unreachable, full or over the free tier | The dummy; the arena works alone |
| Old server, or `fight` hash differs from my level | No fighting, the dummy, `console.warn`; others in the arena are drawn as before but can't be hit |
| An old cached page in the arena (sends `p`, not `a`) | Drawn as a plain figure from its `p` messages; it can't hit or be hit |
| `ARENA.pvp: false` | No guns, no dummy, no scoreboard; the arena as in its own spec |
| Connection drops mid-fight | Remote fighters fade out, bullets cleared, my health reset, the dummy after 2 s; on reconnect, a fresh `ae` and kills from 0 |
| Someone's updates stop (lag spike) | After 300 ms their input counts as released; they slow to a stop; the next state glides them back, or snaps if more than 4 cells off |
| Speed or teleport hack | Clamped by the server; seen and hit where they could legally be |
| Fire-rate or strike-rate hack | Extra shots and strikes are dropped and count toward the flood limit |
| A claimed kick from the ground, outside a combo | Downgraded to a punch |
| A fake "I hit him" | Impossible: no message claims a hit |
| Shooter pops with bullets in flight | The bullets fly on and can still kill |
| Both pop each other | Both kills count |
| Knocked toward the door | The door is a wall while stunned |
| Opening a photo, the map or the grid, or hiding the tab | Out of the fight (`al`); back in with fresh health; the flee rule applies |
| Fewer than 4 `S` markers in `arena.txt` | The unit test fails before it ships; at runtime the floor centre and the door are the spawns |
| Window resized, phone rotated, renderer switched or WebGL lost mid-fight | The view re-fits; the fight goes on; everything is drawn the same by either renderer |
| Durable Object evicted mid-fight | Bullets in flight vanish; health and kills survive in the attachments |

## 14. Testing

- **Unit** (`npm test`):
  - `test/fight.test.js`:
    - the damage, cooldown, stun and knockback numbers;
    - punch, punch, kick within 0.5 s; a kick in the air; the combo resets after a pause;
    - a kick carries a target 11 ± 2 cells, and a punch 5 ± 1.5;
    - aim: 0 and ±π/4 from keys; from the mouse, clamped to ±π/2 with facing flipped toward the cursor;
    - the ray cast stops at `▓`, walls, floor, ceiling and the door, passes through `═`, and ends at
      0.8 s of flight;
    - the relative sweep never misses a body that a bullet crosses, for every combination of bullet
      angle and a target sprinting or falling at full speed, with 33 ms ticks;
    - your own bullet never hits you; protected and popped bodies are skipped;
    - regeneration starts 4 s after damage, at 20 hp/s, and stops at 100;
    - the flee rule credits a hit 2.9 s earlier, but not one 3.1 s earlier;
    - spawn choice picks the spawn farthest from everyone alive;
    - bullet glyphs by angle.
  - `test/arena.test.js`:
    - 4 to 8 `S` markers, each air with something to stand on below, none within 10 columns of the door;
    - `S` is air for physics;
    - while stunned, input is ignored and speed decays with a 0.35 s time constant;
    - the door blocks a stunned body but not a walking one.
  - `test/fighters.test.js`:
    - a scripted run with a jump, a platform landing, a drop-through and a turn, recorded at 60 fps, is
      sent at 15 Hz with 50 ms latency and 0–40 ms jitter;
    - played back at 60 fps, it never moves more than its speed × frame time + 0.3 cells in one frame;
    - it is within 0.2 cells of the truth between input changes, and within 1.0 cell right after one;
    - the jump's peak is within 0.3 rows of the real one;
    - silence for 300 ms stops the body;
    - an error over 4 cells snaps;
    - an `h` knocks the body back at once.
  - `test/rules.test.js`:
    - the new messages parse, and malformed ones don't;
    - the worst-case `a` and `f` are under 200 bytes;
    - bounds, input bits and aim are checked;
    - the new buckets;
    - speed clamping, including a sender clock running ahead.
  - `test/live.test.js`: the `a` ticker sends at most 15 a second while moving, sends urgent changes
    after 30 ms, never exceeds 20 a second, and sends nothing while still.
- **Server** (`server/test/server.test.js`, against `wrangler dev`):
  - `welcome` carries `fight`;
  - two fighters entering get `aw` and `aj`; someone outside the arena receives none of the arena
    messages;
  - a shot at a standing target gives `h` with hp 88; a shot with a `▓` block in the way does not;
  - a protected target is not hit;
  - five shots sent within 100 ms give at most two bullets;
  - 9 hits give `k` with `kills: 1`;
  - `rs` 1 s after popping is ignored, and at 2 s gives `sp` at a marked spawn;
  - a teleporting state is clamped;
  - `al` within 3 s of a hit gives `k` with `fled: 1`;
  - `a`, `f` and `m` from someone not in the arena are dropped;
  - a ground kick outside a combo comes back as a punch;
  - the old `p`, emotes and chat still work as before.
- **e2e** (`e2e/multiplayer.mjs`, two browsers against `wrangler dev`):
  - both walk into the arena and see each other as fighters;
  - A, facing B, holds J: B's hp falls on both screens;
  - A pops B: A's scoreboard shows `you 1`, B's shows A with 1; B respawns after about 2 s at a
    marked spawn, protected;
  - A presses K next to B: B is knocked away by more than 2 cells on both screens;
  - B jumps: A's view of B, sampled every frame, never moves more than 1.2 cells between frames, and
    its peak is within 0.5 rows of B's own;
  - a mouse click above and to the left of A fires a bullet at that angle;
  - B opens a photo: B leaves the fight on A's screen and comes back on closing it;
  - the shot-and-hit check runs once with `?r=canvas` and once with `?r=gl`;
  - stopping the server mid-fight: both get the dummy and no page errors.
- **e2e** (`e2e/run.mjs`, one browser, no server):
  - the dummy is there, can be shot, knocked back and popped, and comes back;
  - at 852 × 393 with touch, FIRE and HIT are shown and work, including FIRE with JUMP held (up 45°);
  - with Reduce Motion, nothing shakes and there are no page errors.

## 15. Out of scope

- More weapons, pickups, ammo, reloading, grenades.
- Blocking, parrying, dodge rolls, wall bounces or wall splats.
- Headshots or damage that depends on where you are hit.
- Teams, rounds, lobbies, spectating, a persistent or all-time leaderboard.
- Lag compensation (rewinding targets).
- Bots that move or fight back (the dummy stands still).
- Hazards, pits, moving platforms, more than one arena (as in the arena spec).
- Gamepads.
- Sounds.
- Any change outside the arena.

## Interface changes

The body state in §4 is the agreed one, plus these. The stickman spec should take them on.

1. **`safe: bool`** (new field, needed): protection after spawning or entering is on. The stickman spec
   draws it: blinking normally, steadily dimmed with Reduce Motion. Without it, nobody can tell a
   protected fighter from a hittable one.
2. **`combo: 1|2|3`** (new field, optional): which strike of a combo the current `punch`/`kick` is, so
   the stickman can alternate fists on 1 and 2. It may be ignored.
3. **`FIGURE_ROWS`** (a shared constant in `src/fight.js`, not a field): the stickman's drawn height in
   rows, from the feet up. The hurtbox, the gun's height and the strike bands are all derived from it,
   so the stickman spec owns its value: 3. (Reconciled 2026-10-14: the physics box itself grows to
   0.8 × 3 rows, as the stickman spec says, so heads can't pass through `▓` and hits land on what you
   see.)
4. **Coordinates and units, made explicit**: `x, y` are map cells and the body's centre, with feet at
   `y + 1.5`. `aim` is an on-screen angle relative to facing, within [−π/2, π/2].
5. **`facing` can disagree with `vx`** (with mouse aim, someone can run backwards). This is not a new
   field, but it is a new case for the run animation.
6. **Act timings**: `shoot` 0.2 s (a new shot restarts `actT`), `punch` 0.25 s, `kick` 0.4 s, `hurt` =
   the stun (0.08 / 0.2 / 0.4 s), `dead` until respawn (2 s). A strike should look fully extended by
   `actT` = 0.06 s, because it hits as soon as the server receives it. The pop on `dead` is the stickman
   spec's to draw; the PvP layer adds sparks and numbers only.
7. **Not in the body state**: name, colour and the hp bar. Names and colours stay with `live.js`, and
   the hp bar is drawn by the PvP layer (§10), so the stickman doesn't draw health.
8. **`MAX_HP = 100`**, exported from `src/fight.js`.
