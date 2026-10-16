# faiz.pics — notes for Claude

An ASCII photo gallery you walk through (Vite + plain JS, `src/`), with a side-view stick-figure arena
(`src/arena*`, `src/fight.js`), a three.js subway station below the lobby (`src/rpg/`), and a Cloudflare Worker
for multiplayer (`server/`). Read `docs/HANDOFF.md` for where things stand.

## Rules

- **Commit trailers.** Every commit message ends with exactly these two lines (after a blank line), and no
  other co-author line:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PhKvzpgRpNG2ndR6ZfJ1jw
  ```
  (In a new session, use that session's own `Claude-Session` link if the harness gives one.)
  PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Ask before pushing or merging** unless Faiz has just said "push". A push to `main` deploys the site
  (GitHub Pages, `.github/workflows/deploy.yml`) and, if `server/**` changed, the Worker (`server.yml`).
- **Test only what's relevant** before committing or pushing: the `test/<module>.test.js` files for what changed,
  plus an e2e check only if the change is visual or networked. Full suites only for broad changes or when asked.
  Faiz: "u dont need to run every test before pushing just relevant ones".
- **Stage per file** (`git add <paths>`), never `git add -A`: other agents may share the checkout.
- **Specs** go in `docs/specs/YYYY-MM-DD-<topic>.md`, **plans** in `docs/plans/`.
- **Museum movement means `src/world.js`.** For museum or gallery pages, "our movement engine" is the
  top-down walk in `src/world.js` (acceleration, wall sliding, Shift, click-to-walk, spring camera). It does not
  mean the arena's jump and roll physics.
- Write like the surrounding code: comments explain why, in plain sentences; match the naming and density.
- Faiz's pronouns aren't recorded; use their name or they/them.

## Commands

| What | Command |
| --- | --- |
| Dev server | `npm run dev` (Vite on 5173; also makes `public/photos/` from `photos/`) |
| Dev + local multiplayer server | `npm run dev:live` |
| Unit tests | `npm test` (or `node --test test/<file>.test.js`) |
| Server tests | `cd server && npm test` |
| Build | `npm run build` |
| Gallery e2e | `node e2e/run.mjs` (`ONLY=<regex>` to filter) |
| Station e2e | `node e2e/station.mjs` (`ONLY=<regex>`) |
| Multiplayer e2e | `node e2e/multiplayer.mjs`, `node e2e/station-mp.mjs` (they start `wrangler dev`) |
| Deploy Worker by hand | `cd server && npx wrangler deploy` (needs Cloudflare login or `CLOUDFLARE_API_TOKEN`) |

e2e uses puppeteer's own Chrome on its own Vite port: `E2E_PORT` (default 5199), and `LIVE_PORT` for the
worker. `E2E_ANGLE=swiftshader` (plus `PUPPETEER_EXECUTABLE_PATH` if needed) runs it without Metal, e.g. on
Linux. Screenshots land in `e2e/shots/` (git-ignored); look at them.

## Skills

Work here used the superpowers workflow skills (MIT, obra/superpowers): brainstorming → writing-plans →
subagent-driven-development / executing-plans → requesting-code-review → finishing-a-development-branch, plus
systematic-debugging and test-driven-development. Install the superpowers plugin from the official marketplace
(or unzip Faiz's `claude-skills.zip` into `~/.claude/skills/`). Bigger features went through that flow: brainstorm,
a spec in `docs/specs`, a plan in `docs/plans`, then subagents per task with reviews.
