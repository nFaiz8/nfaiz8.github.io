# Multiplayer: design

Date: 2026-10-13
Status: approved design, not built yet.

## 1. Intent

Visitors to faiz.pics see the other real people who are walking through the gallery at the same
time, and can interact with them lightly. There are no accounts and no chat.

### What the user chose

- **Presence with light interaction**: not just figures walking around, and not chat either.
- All four interactions: **emotes**, **short names**, **photo reactions**, **follow someone**.
- **Cloudflare Workers** (a Durable Object) as the server. Wrangler is already logged in to the
  user's Cloudflare account.
- **Keep all six fake visitors** as they are; real people are added on top.
- The server lives at a `*.workers.dev` address, because faiz.pics DNS is at Porkbun, not
  Cloudflare. Visitors never see the address.

### Success criteria

- Two people on faiz.pics (phone or computer) see each other walk around within a fraction of a
  second, and their movement looks smooth.
- Names, emotes, hearts and following all work on a phone and with a keyboard.
- If the server is down, blocked or full, the gallery works exactly as it does today.
- The server stores nothing, and its normal use stays inside Cloudflare's free tier.
- Multiplayer can be turned off with one line in `src/config.js` and a deploy.

## 2. Architecture

```
browser (faiz.pics, GitHub Pages)          Cloudflare
  src/net.js  ── WebSocket ──►  Worker faiz-live ──► Durable Object "Gallery" (one per instance)
```

- **`server/`** (new, in this repo): a Worker named `faiz-live` with one Durable Object class,
  `Gallery`, deployed with `wrangler`. It uses a SQLite-backed class (`new_sqlite_classes`
  migration), which is what the free plan allows, and the hibernating WebSocket API
  (`ctx.acceptWebSocket`, `webSocketMessage`, `serializeAttachment`). Idle connections therefore
  cost nothing. It keeps no timers, so it sleeps between messages.
- **Nothing is stored**: no storage writes, no logs of names or IPs. Each connection's state
  (id, name, last position) lives in its WebSocket attachment and disappears when it closes.
- **Instances**: the client connects to `wss://<worker>/room/<version>`, where `<version>` is the
  `generated` time from `photos.json`. People on an old layout never meet people on a new one.
  The Worker maps `<version>` to Durable Object `<version>#1`. An instance holds at most
  **30** people. When it is full, it answers `{t:'full'}` and the client tries `#2`, then `#3`,
  and so on, up to `#10`. If all ten are full, it gives up quietly.
- **Relay, not tick**: the server forwards each message to everyone else in the instance as it
  arrives, rather than batching on a timer, which would keep the object awake.
- **Address**: `src/config.js` gains `multiplayer: { enabled: true, url: 'wss://faiz-live.<subdomain>.workers.dev' }`.
  The exact subdomain is filled in from the first deploy's output. `enabled: false` turns
  everything off: no connection, no UI.
- **Content-Security-Policy**: the gallery page has none today (only `/edit/` does), so nothing
  changes there. The editor's CSP is unchanged.

## 3. Protocol

JSON text frames, each at most **200 bytes** (the server drops the connection on a larger one).
Positions are in map cells, with one decimal place.

Client → server:

| Message | Meaning |
|---|---|
| `{t:'hi', name}` | first message; `name` may be empty |
| `{t:'p', x, y}` | my position; sent at most **5×/s**, and only while moving, plus one final send when I stop |
| `{t:'e', e}` | emote, `e` ∈ `heart` `bang` `ask` `star` `wave` |
| `{t:'r', f}` | heart at frame id `f` (a photo id string, ≤ 64 chars) |
| `{t:'n', name}` | change my name |

Server → client:

| Message | Meaning |
|---|---|
| `{t:'welcome', id, peers:[{id,name,x,y}]}` | my id, plus everyone already here |
| `{t:'join', id, name, x, y}` / `{t:'leave', id}` | someone came or went |
| `{t:'p', id, x, y}` | someone moved |
| `{t:'e', id, e}` / `{t:'r', id, f}` | someone emoted or hearted a photo |
| `{t:'n', id, name}` | someone renamed |
| `{t:'name-rejected'}` | your name failed the filter; you stay unnamed |
| `{t:'full'}` | this instance is full; the socket closes |

Ids are random 8-character strings, new for every connection.

**Areas** (station spec §5c, added 2026-10-16). Each connection is in the `gallery` (the default) or the
`station`, and hears `join`, `leave`, `p`, `q`, `e`, `r`, `c` and `n` only from its own area. The arena is
the gallery's.

| Message | Meaning |
|---|---|
| `{t:'hi', name, area?, …}` | `area: 'station'` comes with a station position (`x, z, y?, a?`) instead of cells |
| `{t:'z', area, …position?}` | move to an area (bucket: 3, then 1/s); the old area gets `leave`, the new `join` |
| `{t:'q', x, z, y?, a?}` | my station position, to 0.01, inside the station map (`STATION` in rules.js) |
| `{t:'zw', area, peers, now}` | (server) who's in the area I moved to |
| `{t:'zc', station}` | (server, to everyone) how many are in the station, whenever it changes |
| `welcome` | now also `area`, `now` (the server clock, ms) and `station` (the count) |

### Server checks (`server/rules.js`, pure and unit-tested)

- **Origin**: only `https://faiz.pics` and `http://localhost:*`; anything else gets a 403 on upgrade.
- **Connections per IP**: at most **4** at once per instance. The IP (`CF-Connecting-IP`) is held
  in memory only for this count and never written anywhere.
- **Names**: trimmed; at most **12** characters; no control or zero-width characters; no match
  against a small blocklist (case-insensitive, ignoring separators like `.`, `_`, `-`). A failure
  sends `name-rejected`.
- **Positions**: finite numbers in `0 ≤ x, y ≤ 2000`.
- **Rate limits** (token buckets per connection): positions 8/s, emotes 1/s, hearts 1 per 2 s,
  renames 1 per 5 s. Messages over the limit are dropped silently. More than 50 dropped messages
  in 10 s closes the connection.
- **Malformed** JSON, an unknown `t`, or a missing field: the message is dropped and counts
  toward the limit above.

### Free tier budget

Durable Object billing counts incoming WebSocket messages at 20 per request; the free plan has
100,000 requests a day. One person walking non-stop sends 5 positions/s, which is about 900
requests per hour, so the budget covers roughly 100 person-hours of continuous walking a day.
Standing still sends nothing. If the limit is ever hit, connections fail and the gallery falls
back to working alone (section 6).

## 4. Client

- **`src/net.js`**: the connection. It handles connecting and moving to the next instance when
  one is full, reconnecting with growing delays (2 s, 4 s, … up to 60 s), and closing while the
  tab is hidden and reconnecting when it is shown again. It exposes the peers and an event
  stream to `main.js`. It never throws into the game loop.
- **`src/peers.js`** (pure, unit-tested): remote player state.
  - **Smoothing**: each peer is drawn about **150 ms** behind its latest update, interpolating
    between updates.
  - **Leaving**: someone who left fades out over **3 s** rather than vanishing mid-step.
  - **Follow targeting**: picks a cell about 2 cells behind the person being followed.
- **Drawing** (in the existing render path, next to the fake visitors at `src/main.js:167`):
  - Real people are drawn as `@` in a colour derived from their id, with their name on the row
    beneath.
  - Emotes show above the `@` for **2.5 s**:
    - heart: `♥`
    - bang: `!`
    - ask: `?`
    - star: `★`
    - wave: `~o/`
  - Hearts at a photo rise about 3 rows out of the top edge of that frame over 2 s and fade.
  - With Reduce Motion on (`world.reducedMotion`), emotes and hearts appear and disappear
    without moving.
- **The map** (`M`) shows real people as `@` dots.

### Interactions

- **Name**:
  - A `[N] name` button in the HUD, next to `[M] map`, opens a small inline field. The `N` key
    does the same.
  - The name is saved in `localStorage` (`faiz-live-name`, wrapped in try/catch) and sent in
    `hi`.
  - If it is rejected, the field shows "try another name".
- **Emotes**:
  - Keys `1`–`5` send heart, bang, ask, star, wave.
  - On touch screens and in the HUD, a `[☺]` button opens a row of the five.
  - A local emote shows immediately, without waiting for the server.
- **Photo heart**:
  - While a photo's caption is showing (you are standing at a print), `H` or a `♥` in the
    caption sends `{t:'r', f}` for that frame.
  - Nothing is counted or stored.
- **Follow**:
  - Click or tap on a real `@` (within one cell) to start following. The existing tap-to-walk
    (`walkTo`) re-targets the follow cell twice a second.
  - It stops when you move yourself, tap elsewhere, press Esc, or they leave.
  - The caption shows "following <name or someone> · esc to stop".
  - Fake visitors can't be followed.
- **Who's here**: the HUD shows `N here` when others are connected (N excludes you). It is hidden
  when you are alone or offline.
- **Screen readers**: the existing polite caption announces "<name> joined" and "<name> left",
  only for people in the same gallery room.
- **`?debug`**: adds `net: connected #1 · 3 peers · 42 ms`.
- **Keys**: `1`–`5`, `H` and `N` must not fire while the name field (or any editable field) has
  focus. `input.js` already skips editable targets.

## 5. Fake visitors

Unchanged. The six wander as now and also step aside for real people. Real people are added to
the list `stepVisitors` treats as obstacles, alongside the player. Fake visitors do not reach
other browsers; every browser simulates its own.

## 6. Failures

| Situation | Behaviour |
|---|---|
| Server unreachable or blocked (e.g. a network filter) | No peers, no `here` count; name and emote buttons stay usable (local only); retry with delays |
| All instances full | Give up for this visit; gallery works alone |
| Connection drops | Peers fade out; reconnect with delays; on reconnect, `welcome` rebuilds the peer list |
| Tab hidden | Socket closed after 30 s hidden; reopened on show |
| `photos.json` changes while connected | Stay in the old instance until reload (the layout on screen is the old one too) |
| `multiplayer.enabled: false` | No socket, no multiplayer UI |
| Free tier exhausted | Same as unreachable |

## 7. Testing

- **Unit** (`npm test`, node --test):
  - `test/rules.test.js`: name filter cases, emote whitelist, the 200-byte cap, rate-limit
    buckets, position bounds, origin check.
  - `test/peers.test.js`: smoothing between updates, fade-out on leave, follow-target cell.
  - `test/world.test.js`: fake visitors step aside for a real person.
- **Server** (`server/`, vitest with `@cloudflare/vitest-pool-workers`): two sockets in one
  instance see each other's join, positions, emotes and leave; the 31st connection gets `full`;
  the 5th connection from one IP is refused; a bad origin gets a 403; oversized and flooding
  clients are dropped.
- **e2e** (`npm run e2e`, new `e2e/multiplayer.mjs`): runs `wrangler dev` locally and opens two
  puppeteer pages pointed at it, then checks:
  - each page sees the other `@` and its name;
  - pressing `1` shows `♥` on the other page;
  - `H` at a print floats a heart from that frame;
  - clicking the other `@` makes page A follow page B;
  - stopping the server leaves both galleries walkable, with no page errors.
- **Live check after deploy**: two browsers on faiz.pics, one of them the iPhone WebKit probe.

## 8. Deploy

- **First deploy**: `npx wrangler deploy` from `server/`, using the logged-in account. The
  printed `workers.dev` address goes into `src/config.js`.
- **After that**: a separate GitHub Actions workflow, `.github/workflows/server.yml`, runs
  `wrangler deploy` on pushes that touch `server/**`. It needs a `CLOUDFLARE_API_TOKEN` repo
  secret (Workers Scripts: Edit), which the user creates. Until the secret exists, the server is
  deployed by hand.
- The site's own deploy workflow is unchanged.

## 9. Out of scope

- Text chat or speech bubbles.
- Accounts, persistent names, friends, private rooms.
- Showing which photo someone is looking at in the viewer (the full-screen photo view).
- Sharing the fake visitors between browsers.
- Moderation tools beyond the server checks above (no kick or ban).
- Moving faiz.pics DNS to Cloudflare.
