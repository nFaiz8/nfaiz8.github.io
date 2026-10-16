# Handoff (2026-10-16)

Where the work stands, for a Claude session picking it up in the cloud. Rules and commands are in
`/CLAUDE.md`.

## What exists

- **Gallery** (`src/main.js`, `src/layout.js`, `src/world.js`, renderers): the top-down ASCII museum. Photos
  come from `photos/` (tracked) via `scripts/prepare-photos.mjs` into `public/photos/` (git-ignored, rebuilt by
  `npm run dev` or `npm run build`). The editor is at `/edit/`.
- **Arena** (`src/arena*.js`, `src/fight.js`, `src/referee.js`, `src/arena.txt`, `src/gorge.txt`): a side-view
  stick-figure fighter, west of the lobby. Specs `docs/specs/2026-10-13-arena-design.md` and the 10-14/10-15
  arena specs.
  - Latest change: the arena's hallway now runs past the wings' west-side rooms, so the tall gorge no longer
    pushes those rooms far away on the map (`buildLayout` in `src/layout.js`).
- **Station** (`src/rpg/`, three.js, spec `docs/specs/2026-10-15-station-design.md`, plan
  `docs/plans/2026-10-15-station-plan.md`). You go down the `▼ SUBWAY` stairs in the lobby.
  - Octopath-style tilted camera, an ASCII-shaded world (`post.js`), and a rigged stick figure (`figure.js`,
    `rig.js`).
  - Passing trains on a shared clock (`train.js`).
  - New York turnstiles (`turnstiles.js`, `gates.js`): three paid lanes plus an emergency gate on the north lane.
    Each paid lane has a ticket pop-up (`ticket.js`).
  - Life (`life.js`): pigeons, rats, commuters that walk, steam, and drips every 2–3 minutes.
  - Map and authoring notes: `src/rpg/station.txt` and `src/rpg/MAPS.md`.
  - Test hooks: `window.__station.{map, walker, frames, time, train, setTime, teleport, gates, setWallet, life}`.
- **Sound** (`src/rpg/audio.js`, `src/rpg/sound.js`, `src/music.js`, `src/sound-pref.js`).
  - Mute with M in the station, V in the gallery, or the `[♪] sound` button.
  - Gallery music is Faiz's own track `src/rpg/assets/music/tuffjazz.mp3`. It streams, and you hear it from the
    station's exit stairs.
  - Credits for the clips: `src/rpg/assets/sound/CREDITS.md` (Kenney/Freesound CC0, plus trimmed Adobe Audition
    SFX that may only ship inside the site).
- **Multiplayer** (`server/`, `src/live.js`, `src/net.js`, `src/rpg/peers3d.js`). Everyone shares one
  WebSocket, split into areas (`gallery` and `station`).
  - In the station: figures with name tags, chat (T/Enter), emotes 1–5, and the same train for everyone.
  - The lobby sign shows `▼ SUBWAY · N`.
  - Worker URL: `wss://faiz-live.faiz-live.workers.dev` (`src/config.js`). It auto-deploys from `server.yml`
    when the `CLOUDFLARE_API_TOKEN` secret is set; otherwise deploy by hand.

## Branches

- `main`: everything above, pushed.
- `ascii-textures`: a try at tighter, denser ASCII textures in the station (`src/rpg/surface.js`, DENSITY 6×4).
  Faiz preferred the old look. **Keep it; don't merge it.**
- `station`, `multiplayer`, `sound`: already merged into main. They can be deleted when Faiz agrees.

## Known failures (they fail on main too; not regressions)

- **Server:** ~10 tests in `server/test/server.test.js` (arena and chat).
- **Gallery e2e** (`e2e/run.mjs`):
  - the 0×0 Hook check;
  - the phone outline over the train;
  - fps capped at 30 in headless;
  - bots;
  - a flaky floor-brightness check;
  - "museum: … from outside the train shows, lit", which sits right on its threshold (12.1 on e07c84b, 12.0 now; it
    needs > 12);
  - the gorge hook check, which is occasionally flaky.
- **Station e2e:** "trip 7 music hands off" failed once (probably flaky).
- **Unit:** `test/figures.test.js` "thirty bodies cost well under 2 ms" can fail when the machine is busy.

## Open items and ideas

- The station's portrait-layout hall shows black at the bottom.
- Walking into a locked gate stops you at the tile edge, which leaves a gap before the arm at mid-cabinet.
- VFX were put on hold for sound. The half-built work isn't in the repo.
- Roadmap Faiz described: a top-down story RPG first, then maybe a roguelite. The station is the first place.
  Next would be more places and story beats in the same three.js + ASCII look.
- The museum cutaway (a side-view museum) was archived on Faiz's Mac in `~/Documents/nfaiz8-archive/`. It isn't
  in the repo or the cloud.
