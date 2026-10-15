# The gorge's grappling hook; Ctrl crouches on platforms; pickups while running (addendum)

**Status:** the user asked on 2026-10-15: "add a grappling hook for the gorge map and map it to g instead of
open all images. also sometimes i cant pick up weapon and croutch with ctrl should work on platforms". This
addendum amends the gorge addendum (`2026-10-15-arena-gorge.md`), the crouch addendum
(`2026-10-14-arena-crouch.md`) and the pickups addendum (`2026-10-14-arena-pickups-weapons-exit.md`).

## 1. The hook

- **Only in the gorge**: `MAPS.gorge.hook` is true (`src/level.js`), and `parseMap` carries it. On the train,
  G does nothing.
- **Casting** (`grapple`, `hookCast` in `src/arena.js`; `hook` in `src/pvp.js`):
  - G (or HOOK on the phone pad, shown only in the gorge) casts from the shoulder along the aim: the mouse's
    when it aims, otherwise up and forward (−45° on screen, or −1.25 rad with ↑ / JUMP held).
  - It catches the first ▓ or ═ within `HOOK_RANGE` = 48 cells on screen (`rayLength` with a `stop` for
    both kinds). A miss shows its rope for 160 ms.
  - Not while stunned or rolling; one cast per `HOOK_COOL` = 0.35 s. G on the rope lets go.
- **The pull** (`stepBody`):
  - Straight at the anchor at `HOOK_PULL` = 80 cells/s on screen, no gravity, no steering. The across part
    stays under `HOOK_ACROSS` = 55 cells/s, under the wire's 60.
  - It lets go when within 1.2 cells of the anchor, after `HOOK_TIME` = 1.5 s, or after being held up by
    rock (or a floor) for 0.1 s.
  - A pull going up lets go with a hop of `HOOK_HOP` = 32 rows/s (~3.85 rows), so a hook into a ═'s underside
    carries you up through it and onto it.
  - A fresh jump lets go with that hop, and the air jump is still there. ↓ lets go. A hit knocks it loose.
  - On the rope you don't climb ladders, roll or crouch.
- **The wire**: a state on the rope carries `hx`, `hy`: where the hook caught, arena-local, to 0.1. The
  server takes them as a pair inside the arena (`parseMessage`) and passes them on. Others pull the body
  the same way (`fighters.js`) and draw the rope. `FIGHT_VERSION` is 4.
- **Drawn** (`ropeGlyphs`, `src/fx.js`): a line of `─ │ ╱ ╲` from the shoulder, by its slant, and `+`
  where it caught, in the fighter's colour.

## 2. G no longer opens all photos

G was the grid's key. It is the hook now, and outside the arena it does nothing. The grid still opens from
the lobby kiosk (walk up, E or a tap) and `#/all`.

## 3. Ctrl crouches on a ═

- Ctrl (`input.crouch`) is its own input to `stepBody`. It crouches (and with ←/→ crawls) on any footing:
  a floor, a ═ or a head. It never drops through a ═ or takes a ladder down. ↓ is unchanged: it crouches
  on a floor and drops through a ═.
- On the wire Ctrl is not bit 8 (↓), which would make others drop you through the ═. The low bits (64, 128)
  carry it, and `fighters.js` reads them as Ctrl held.

## 4. Picking up while running (the bug)

Online, the server checks a pickup's reach (1 cell across) from my last state. The ticker sends one every
67 ms, so at a run that state is up to 2 cells behind, and a run through a gun was refused. The next try
came 500 ms later, by when I was past it. Now the page sends where I am (`ticker.force`) right before
each `pk`.

## Tests

- `test/hook.test.js`:
  - the hook lands you on a ═ ledge;
  - a miss reaches the full range;
  - jump, ↓ and a hit let go;
  - rock holds the pull up;
  - no cast stunned or rolling;
  - Ctrl on a ═;
  - in the fight: G in the gorge (`hx`, `hy`, the rope), nothing on the train;
  - a remote body on the rope;
  - a remote crouched on a ═;
  - the rope's glyphs;
  - the server's `hx`, `hy`.
- `test/pvp.test.js`: Ctrl isn't bit 8; the state before a `pk` is in reach, from any spot between two
  ticks.
- `e2e/run.mjs`:
  - G no longer opens the grid;
  - in the gorge, G with ↑ lands you on the ledge over the ladder, and Ctrl crouches on the ═;
  - on a phone, HOOK is on the pad and casts.
