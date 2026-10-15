# The gorge: a second arena map, and an admin switch (addendum)

**Status:** the user asked on 2026-10-15 for a vertical scene after photo `000091570034` (Tianshenqiao, the
three natural bridges): a temple courtyard at the bottom, a gorge you climb, the bridge on top, in the
train level's look. Then: "put it on the site to fight in, the admin panel is to switch maps between train
and waterfall on site", "password uzbek", "no bots in this and lets do real ladders". This addendum amends
the arena specs (`2026-10-13-arena-design.md`, `2026-10-14-arena-train-level.md`,
`2026-10-14-arena-pvp-design.md`).

## 1. Maps

- `src/level.js` `MAPS`: `train` (204 × 33, `src/arena.txt`) and `gorge` (212 × 112, `src/gorge.txt`). One is
  up at a time, for everyone; the train is the default and what an unknown name means (`mapName`).
- `parseMap(name, text)` parses a level at its map's size and adds its rules:
  - `steps`: a tread one row up is walked onto (the gorge's stairs and terrace). The train has none, so
    its physics are unchanged.
  - `dummy`: the column whose floor the practice dummy stands on when you're alone: 50 on the train (car
    A), 160 in the gorge (the cave mouth under the rock, between its lanterns, by the way in). The user
    first asked for none in the gorge, then on 2026-10-15: "add a dummy to gorge".
- **The gorge's level is generated.** `src/gorge/scene.js` builds the scene (cells, roles, collision) and
  `gorgeLevelText()` writes `src/gorge.txt` from it, with the spawns, pickups, door and ladders. After
  changing the scene, regenerate it:
  `node -e "import('./src/gorge/scene.js').then(S=>require('fs').writeFileSync('src/gorge.txt', S.gorgeLevelText()))"`.
  A test fails if they differ.
- **Its look** is `src/gorge/look.js` (`frameAt`, `paint`, `paintWindow`, `GORGE_GLYPHS`): daylight from
  the top, lamps in the courtyard and the caves, a waterfall, the pool, birds, bats and a macaque on
  timers, and muzzle flashes lighting the rock. No people. `paintWindow` also gives `hard`: the cells whose
  background is drawn crisp over the smoothed light (stairs, rails, rock edges).
- The arena's photo follows the map (`ARENA.photos` in `src/config.js`): `dscf9139` for the train,
  `000091570034` for the gorge. Both are left out of the gallery's rooms.

## 2. Ladders

- `H` in a level is a ladder cell (air). A column of `H` is one ladder:
  `{ x: column + 0.5, top: the row you stand on up there, bot: the row under its foot }`.
- **Climbing** (`stepBody` with `ladders`, `src/arena.js`):
  - ↑ (W, ↑, or JUMP on the touch pad) at a ladder, below its top, grabs it; ↓ on its top grabs it going
    down.
  - ↑ / ↓ climb at `CLIMB_V` = 11 rows/s. At the top or the foot you step off.
  - Jump with ← or → held lets go sideways.
  - A hit knocks you off.
- On the wire, the state's bit 512 says "on a ladder", and bit 256 is ↑ held, so others draw you climbing
  (`climbLook`). `FIGHT_VERSION` is 3.

## 3. Switching the map: the admin panel

- **Opening it:** \` (Backquote) opens and closes it, and `/admin` sent in the chat opens it on a phone.
  It shows the map that's up, a password field, and a button per map.
- **Online**, the page sends `{ t: 'am', map, pw }`:
  - The server checks the password (`adminOk`: SHA-256 of `faiz-admin:` + the password against
    `ADMIN_HASH`, `server/rules.js`). It allows three tries, then one every 10 s.
  - Wrong: `am-no`, and the panel says "wrong password".
  - Right: the map is stored in the `config` Durable Object, so it lasts. The room's referee and fight
    start over, and every page in every room instance gets `{ t: 'map', map, fight }`. Each page then
    reloads into the new map, and a page that was in the arena comes back into it.
- **Which map a page builds:**
  - on localhost, `?map=` wins;
  - otherwise the server's (`GET <server>/map`, waited on for at most 1.5 s);
  - otherwise the last one this browser saw (`localStorage` `arena-map`).
  - The welcome also carries the map, so a late answer still lands on the right one.
- **With no server** (local dev without `?live=`), the page checks the password itself and switches only
  this browser.

## 4. Choices made for you

| question | choice |
| --- | --- |
| How much of the gorge is the arena? | All of it, 212 × 112: the courtyard, the stairs, the caves, the ladders, the bridge on top. |
| Bots? | None in the gorge. Its practice dummy (added later) stands in the cave mouth by the way in. |
| How does a switch reach people already on the page? | Their page reloads into the new map (and back into the arena if they were in it). |
| Where is the map kept? | In the Worker's `config` Durable Object, so a deploy or a quiet night doesn't reset it. |

## 5. Tests

- `test/gorge.test.js`:
  - `src/gorge.txt` matches the generator;
  - the map's size, spawns, pickups, door and ladders;
  - `H` parsing;
  - the full climb from the courtyard to the bridge at 20, 60 and 144 fps;
  - the train's rules unchanged (no steps, no ladders);
  - the look is deterministic and every glyph is in the atlas;
  - the dummy at column 160, on the floor, clear of the spawns.
- `test/rules.test.js`: the bits up to 1023, the biggest map's bounds, and `am`.
- `server/test/server.test.js`: the welcome carries the map; a wrong password gets `am-no`; the right one
  switches it.
- `e2e/run.mjs`, in each renderer: in the gorge, its dummy, up the stairs and a ladder with real keys, Ctrl
  crouching, no missing glyphs; on a phone, JUMP held climbs a ladder.
- `e2e/multiplayer.mjs`: a wrong password is refused; "uzbek" switches both pages to the gorge and back,
  each staying in the arena.
