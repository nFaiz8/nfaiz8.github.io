# Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real visitors on faiz.pics see each other walk through the gallery as `@` figures with names, and can send emotes, heart a photo, and follow each other.

**Architecture:**
- **Server:** a Cloudflare Worker (`server/`) relays small JSON WebSocket messages between people in one
  Durable Object "instance", which holds at most 30 people. It uses the hibernation API and stores nothing.
- **Client:** `src/net.js` owns the socket (reconnects, moves to the next instance when one is full,
  pauses while the tab is hidden). `src/peers.js` turns messages into smoothed positions. `src/main.js`
  draws peers as entities through the renderers that already exist.
- **Shared checks:** `server/rules.js` is pure and is unit-tested by the root `npm test`.

**Tech Stack:**
- the existing gallery: vanilla JS, Vite, node --test, puppeteer e2e
- Cloudflare Workers + Durable Objects (SQLite-backed class, the hibernating WebSocket API), wrangler 4
- `ws` (only in `server/` tests)

**Spec:** `docs/specs/2026-10-13-multiplayer-design.md`

## Global Constraints

- Messages: JSON text frames, each at most **200 bytes**; a larger one drops the connection.
- At most **30** people per instance; instances `#1` to `#10`; the instance key is `<photos.json generated>#<n>`.
- Positions are sent at most **5×/s**, only while moving, plus one final send on stopping.
- Server rate limits: positions 8/s, emotes 1/s, hearts 1 per 2 s, renames 1 per 5 s. Over-limit messages are dropped silently; more than 50 dropped in 10 s closes the connection.
- At most **4** connections per IP per instance. The IP is never written down; only a hash of it is used as a socket tag.
- Allowed origins: `https://faiz.pics` and `http://localhost:*` (any port). Anything else gets a 403.
- Names: at most **12** characters, plus the blocklist. Ruling: names are limited to `A–Z a–z 0–9 space . _ -`. This is narrower than the spec's "no control/zero-width characters" and lets the GL renderer's fixed glyph atlas draw every name.
- Emotes: `heart bang ask star wave` → `♥ ! ? ★ ~o/`, shown for **2.5 s**.
- Photo hearts rise about 3 rows over 2 s.
- Smoothing: peers are drawn **150 ms** behind; leavers fade out over **3 s**.
- Reconnect delays: 2 s, 4 s, 8 s … up to 60 s. Close the socket after the tab has been hidden for 30 s.
- Follow: walk to a cell about 2 behind the person being followed, re-targeting twice a second.
- Nothing is stored server-side: no storage API calls, no `console.log` of names or IPs.
- `src/config.js` gets `MULTIPLAYER = { enabled: true, url: '' }`. An empty url means off until the first deploy fills it.
- Reduce Motion: emotes and hearts appear and disappear without moving.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Pull with `git pull --rebase` before pushing, because the live editor commits to main.

## Review Focus

1. **A peer who sends `p` before `hi`, or a second `hi`.** The server must ignore both and must not broadcast a nameless or duplicate join. Tested in Task 2.
2. **Hibernation wakeups.** After the object sleeps, per-socket state (id, name, position, buckets) must come back from the attachment, not from instance fields. Tested in Task 2 by restarting the connection set and checking that `welcome` lists the earlier peer.
3. **Instance overflow loops.** If every instance up to #10 is full, the client must stop and must not reconnect forever. Tested in Task 3.
4. **Keys typed into the name field** (`1`–`5`, `H`, `G`, `M`, `E`) must not send emotes or open things. Tested in Task 7's e2e.
5. **Viewer, grid or map open while peers move.** Remote figures must not take input or break the overlays, and following must stop when you open a photo. Tested in Task 8.

---

## File structure

| File | Responsibility |
|---|---|
| `server/rules.js` (new) | Pure checks: origin, version, names, message parsing, rate buckets, flood counter. Imported by the Worker and by root unit tests. |
| `server/worker.js` (new) | Worker `fetch`: origin check, routes `/room/<version>/<n>` to the Durable Object, and exports the `Gallery` class. |
| `server/gallery.js` (new) | `Gallery` Durable Object: accept, relay, full, per-IP limit, using the hibernation API. |
| `server/wrangler.toml`, `server/package.json` (new) | Worker config and the server's own dev dependencies (wrangler, ws). |
| `server/test/server.test.js` (new) | Runs `wrangler dev` and drives it with `ws` clients. |
| `src/net.js` (new) | Client socket: connect, instance overflow, backoff, hidden-tab pause, sending with a throttle. |
| `src/peers.js` (new) | Peer state from messages: interpolation, fade, emotes, hearts, follow target. Pure, so it is unit-tested. |
| `src/live.js` (new) | Glue between net/peers and the game: HUD count, name field, emote bar, caption announcements, entities to draw. |
| `src/config.js` | `MULTIPLAYER` settings. |
| `src/main.js` | Creates `live`, adds its entities to the draw list, handles keys 1–5/H/N, follow taps, the debug line. |
| `src/world.js` | Fake visitors also step aside for `world.others`. |
| `src/map.js` | `sync()` also places peer dots. |
| `src/render/gl.js` | Adds printable ASCII and `♥★` to the glyph atlas. |
| `index.html`, `src/style.css` | HUD: `N here`, `[N] name`, `[☺]`, the emote bar and the name field. |
| `e2e/multiplayer.mjs` (new), `package.json` | Two-page e2e test against `wrangler dev`. |
| `.github/workflows/server.yml` (new) | Deploys `server/` on pushes that touch it. |

---

### Task 1: Server rules (pure)

**Files:**
- Create: `server/rules.js`
- Test: `test/rules.test.js`

**Interfaces:**
- Produces:
  - `LIMITS` = `{ people: 30, instances: 10, perIp: 4, bytes: 200, name: 12, floodDrops: 50, floodWindowMs: 10000 }`
  - `EMOTES` = `['heart','bang','ask','star','wave']`
  - `allowedOrigin(origin: string|null): boolean`
  - `validVersion(v: string): boolean`
  - `cleanName(raw: unknown): string|null`. Returns `''` for empty or whitespace, `null` when rejected, otherwise the trimmed name.
  - `parseMessage(text: string): object|null`. Returns `{t:'hi',name}`, `{t:'p',x,y}`, `{t:'e',e}`, `{t:'r',f}` or `{t:'n',name}`. Returns `null` for a malformed message, an unknown `t`, a bad field, or more than 200 bytes. `name` is the raw string; the caller runs `cleanName`.
  - `newBuckets(now: number): object` (plain and JSON-serialisable)
  - `take(buckets, kind: 'p'|'e'|'r'|'n', now: number): boolean`
  - `newFlood(now): {start, drops}`
  - `dropped(flood, now): boolean` (true = close the connection)

- [ ] **Step 1: Write the failing tests**

```js
// test/rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, validVersion, cleanName, parseMessage, newBuckets, take, newFlood, dropped, EMOTES } from '../server/rules.js';

test('only faiz.pics and localhost may connect', () => {
  assert.equal(allowedOrigin('https://faiz.pics'), true);
  assert.equal(allowedOrigin('http://localhost:5199'), true);
  assert.equal(allowedOrigin('http://localhost'), true);
  for (const o of [null, '', 'https://faiz.pics.evil.com', 'http://faiz.pics', 'https://evil.com', 'http://localhost.evil.com:80'])
    assert.equal(allowedOrigin(o), false, String(o));
});

test('instance versions look like a photos.json generated time', () => {
  assert.equal(validVersion('2026-10-13T18:22:01.123Z'), true);
  for (const v of ['', 'a/b', '../x', 'x'.repeat(41), '2026 10']) assert.equal(validVersion(v), false, v);
});

test('names: trimmed, short, plain characters, no slurs', () => {
  assert.equal(cleanName('  Sam '), 'Sam');
  assert.equal(cleanName(''), '');
  assert.equal(cleanName('   '), '');
  assert.equal(cleanName('faiz_n-8.x'), 'faiz_n-8.x');
  assert.equal(cleanName('abcdefghijklm'), null, '13 characters');
  assert.equal(cleanName('sam​'), null, 'zero-width');
  assert.equal(cleanName('sam\n'), 'sam', 'trailing newline trims away');
  assert.equal(cleanName('s\nam'), null, 'control character inside');
  assert.equal(cleanName('ñandú'), null, 'outside the drawable set');
  assert.equal(cleanName('F.u_c-k'), null, 'separators do not hide a blocked word');
  assert.equal(cleanName('sh1t'), null, 'digits standing in for letters');
  assert.equal(cleanName(42), null);
});

test('messages: known shapes pass, everything else is null', () => {
  assert.deepEqual(parseMessage('{"t":"hi","name":"Sam"}'), { t: 'hi', name: 'Sam' });
  assert.deepEqual(parseMessage('{"t":"hi"}'), { t: 'hi', name: '' });
  assert.deepEqual(parseMessage('{"t":"p","x":12.34,"y":5}'), { t: 'p', x: 12.3, y: 5 });
  for (const e of EMOTES) assert.deepEqual(parseMessage(JSON.stringify({ t: 'e', e })), { t: 'e', e });
  assert.deepEqual(parseMessage('{"t":"r","f":"dscf7326"}'), { t: 'r', f: 'dscf7326' });
  assert.deepEqual(parseMessage('{"t":"n","name":"Al"}'), { t: 'n', name: 'Al' });
  for (const bad of ['', 'nope', '[]', 'null', '{"t":"x"}', '{"t":"p","x":"1","y":2}', '{"t":"p","x":1}',
    '{"t":"p","x":-1,"y":2}', '{"t":"p","x":2001,"y":2}', '{"t":"p","x":1e400,"y":2}', '{"t":"e","e":"poop"}',
    '{"t":"r","f":""}', `{"t":"r","f":"${'a'.repeat(65)}"}`, '{"t":"hi","name":5}', `{"t":"hi","name":"${'a'.repeat(190)}"}`])
    assert.equal(parseMessage(bad), null, bad);
});

test('rate limits refill over time and are plain data', () => {
  let now = 1000;
  const b = newBuckets(now);
  assert.equal(take(b, 'e', now), true);
  assert.equal(take(b, 'e', now), false, 'one emote per second');
  now += 1000;
  assert.equal(take(b, 'e', now), true);
  assert.equal(take(b, 'r', now), true);
  now += 1000;
  assert.equal(take(b, 'r', now), false, 'hearts: one per 2 s');
  now += 1000;
  assert.equal(take(b, 'r', now), true);
  let ok = 0;
  for (let i = 0; i < 20; i++) if (take(b, 'p', now)) ok++;
  assert.equal(ok, 8, 'positions: burst of 8');
  assert.deepEqual(JSON.parse(JSON.stringify(b)), b, 'survives serializeAttachment');
});

test('more than 50 dropped messages in 10 s closes the connection', () => {
  const f = newFlood(0);
  for (let i = 0; i < 50; i++) assert.equal(dropped(f, i * 10), false);
  assert.equal(dropped(f, 600), true);
  const g = newFlood(0);
  for (let i = 0; i < 50; i++) dropped(g, 0);
  assert.equal(dropped(g, 10001), false, 'a new window starts after 10 s');
});
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npm test 2>&1 | grep -E "rules|ERR_MODULE"`
Expected: FAIL with `ERR_MODULE_NOT_FOUND ... server/rules.js`

- [ ] **Step 3: Implement `server/rules.js`**

```js
// Checks shared by the multiplayer Worker and its tests. Pure: no Workers or Node APIs.
export const LIMITS = { people: 30, instances: 10, perIp: 4, bytes: 200, name: 12, floodDrops: 50, floodWindowMs: 10000 };
export const EMOTES = ['heart', 'bang', 'ask', 'star', 'wave'];

export function allowedOrigin(origin) {
  return origin === 'https://faiz.pics' || /^http:\/\/localhost(:\d{1,5})?$/.test(origin || '');
}

export const validVersion = (v) => typeof v === 'string' && /^[0-9A-Za-z:.\-]{1,40}$/.test(v);

// Words that may not appear in a name, checked after lower-casing, dropping separators and undoing digit swaps.
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink',
  'retard', 'whore', 'slut', 'cock', 'dick', 'pussy', 'porn', 'cum', 'tits'];
const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name) return '';
  if (name.length > LIMITS.name || !/^[A-Za-z0-9 ._-]+$/.test(name)) return null;
  const flat = name.toLowerCase().replace(/[ ._-]/g, '').replace(/[0-9]/g, (d) => SWAPS[d] || d);
  return BLOCKED.some((w) => flat.includes(w)) ? null : name;
}

const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2000;

export function parseMessage(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.bytes) return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'hi': return m.name === undefined || typeof m.name === 'string' ? { t: 'hi', name: m.name || '' } : null;
    case 'n': return typeof m.name === 'string' ? { t: 'n', name: m.name } : null;
    case 'p': return pos(m.x) && pos(m.y) ? { t: 'p', x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 } : null;
    case 'e': return EMOTES.includes(m.e) ? { t: 'e', e: m.e } : null;
    case 'r': return typeof m.f === 'string' && m.f.length >= 1 && m.f.length <= 64 ? { t: 'r', f: m.f } : null;
    default: return null;
  }
}

// Token buckets: capacity and refill per second.
const RATES = { p: [8, 8], e: [1, 1], r: [1, 0.5], n: [1, 0.2] };
export function newBuckets(now) {
  return Object.fromEntries(Object.entries(RATES).map(([k, [cap]]) => [k, { tokens: cap, at: now }]));
}
export function take(b, kind, now) {
  const [cap, rate] = RATES[kind];
  const s = b[kind];
  s.tokens = Math.min(cap, s.tokens + ((now - s.at) / 1000) * rate);
  s.at = now;
  if (s.tokens < 1) return false;
  s.tokens -= 1;
  return true;
}

export const newFlood = (now) => ({ start: now, drops: 0 });
export function dropped(f, now) {
  if (now - f.start > LIMITS.floodWindowMs) { f.start = now; f.drops = 0; }
  f.drops++;
  return f.drops > LIMITS.floodDrops;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/rules.js test/rules.test.js
git commit -m "Multiplayer: server rules for names, messages and rate limits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Worker and Durable Object

**Files:**
- Create: `server/package.json`, `server/wrangler.toml`, `server/worker.js`, `server/gallery.js`, `server/test/server.test.js`
- Modify: `.gitignore` (add `server/node_modules`, `server/.wrangler`)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `GET wss://<host>/room/<version>/<n>`, with `n` in 1..10.
    - 403 for a bad origin.
    - 400 for a bad version or `n`.
    - 426 if the request is not a WebSocket upgrade.
    - Otherwise a 101 handed to Durable Object `<version>#<n>`.
  - The protocol in spec section 3. `welcome.peers` lists only people who have said `hi`.

- [ ] **Step 1: Scaffold the server package**

`server/package.json`:
```json
{
  "name": "faiz-live",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --port 8787 --ip 127.0.0.1",
    "deploy": "wrangler deploy",
    "test": "node --test test/"
  },
  "devDependencies": { "wrangler": "^4.150.0", "ws": "^8.18.0" }
}
```

`server/wrangler.toml`:
```toml
name = "faiz-live"
main = "worker.js"
compatibility_date = "2026-09-01"

[[durable_objects.bindings]]
name = "GALLERY"
class_name = "Gallery"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Gallery"]
```

Run: `cd server && npm install && cd ..` then `printf 'server/node_modules\nserver/.wrangler\n' >> .gitignore`
Expected: install succeeds; `git status` shows no `server/node_modules`.

- [ ] **Step 2: Write the failing server tests**

```js
// server/test/server.test.js: runs the Worker locally (wrangler dev) and talks to it like browsers would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const PORT = 8797;
const BASE = `ws://127.0.0.1:${PORT}/room/2026-10-13T00:00:00.000Z`;
let dev;

before(async () => {
  dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('wrangler dev did not start')), 60000);
    const on = (d) => { if (String(d).includes('Ready on')) { clearTimeout(t); resolve(); } };
    dev.stdout.on('data', on);
    dev.stderr.on('data', on);
  });
});
after(() => dev.kill());

let ipSeq = 1;
// A client with its own fake IP unless one is given; resolves once open, collects messages.
function client({ n = 1, origin = 'https://faiz.pics', ip = `10.0.0.${ipSeq++}`, room = BASE } = {}) {
  const ws = new WebSocket(`${room}/${n}`, { origin, headers: { 'CF-Connecting-IP': ip } });
  ws.inbox = [];
  ws.on('message', (d) => ws.inbox.push(JSON.parse(String(d))));
  ws.next = (t, ms = 3000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const look = () => {
      const i = ws.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return resolve(ws.inbox.splice(i, 1)[0]);
      if (Date.now() - started > ms) return reject(new Error(`no ${t}; inbox ${JSON.stringify(ws.inbox)}`));
      setTimeout(look, 20);
    };
    look();
  });
  ws.send2 = (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  ws.opened = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('unexpected-response', (_, res) => reject(new Error(`HTTP ${res.statusCode}`))); });
  ws.closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  return ws;
}
const room = () => `ws://127.0.0.1:${PORT}/room/t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

test('two people see each other join, move, emote, heart, rename and leave', async () => {
  const r = room();
  const a = client({ room: r }); await a.opened;
  a.send2({ t: 'hi', name: 'Ann' });
  const wa = await a.next('welcome');
  assert.deepEqual(wa.peers, []);
  const b = client({ room: r }); await b.opened;
  b.send2({ t: 'hi', name: 'Bo' });
  const wb = await b.next('welcome');
  assert.deepEqual(wb.peers.map((p) => p.name), ['Ann']);
  const j = await a.next('join');
  assert.equal(j.name, 'Bo');
  b.send2({ t: 'p', x: 10.04, y: 20 });
  assert.deepEqual(await a.next('p'), { t: 'p', id: wb.id, x: 10, y: 20 });
  b.send2({ t: 'e', e: 'heart' });
  assert.deepEqual(await a.next('e'), { t: 'e', id: wb.id, e: 'heart' });
  b.send2({ t: 'r', f: 'dscf1' });
  assert.deepEqual(await a.next('r'), { t: 'r', id: wb.id, f: 'dscf1' });
  b.send2({ t: 'n', name: 'Bob' });
  assert.deepEqual(await a.next('n'), { t: 'n', id: wb.id, name: 'Bob' });
  assert.equal(b.inbox.filter((m) => m.t === 'p' || m.t === 'e').length, 0, 'nobody hears their own messages');
  b.close();
  assert.deepEqual(await a.next('leave'), { t: 'leave', id: wb.id });
  a.close();
});

test('messages before hi, and a second hi, are ignored', async () => {
  const r = room();
  const a = client({ room: r }); await a.opened;
  a.send2({ t: 'hi', name: 'Ann' }); await a.next('welcome');
  const b = client({ room: r }); await b.opened;
  b.send2({ t: 'p', x: 1, y: 1 });
  b.send2({ t: 'e', e: 'star' });
  await new Promise((s) => setTimeout(s, 300));
  assert.equal(a.inbox.length, 0, 'nothing from someone who has not said hi');
  b.send2({ t: 'hi', name: 'Bo' }); await b.next('welcome'); await a.next('join');
  b.send2({ t: 'hi', name: 'Again' });
  await new Promise((s) => setTimeout(s, 300));
  assert.equal(a.inbox.filter((m) => m.t === 'join').length, 0, 'no second join');
  a.close(); b.close();
});

test('a rejected name is told so and joins unnamed', async () => {
  const r = room();
  const a = client({ room: r }); await a.opened;
  a.send2({ t: 'hi', name: 'sh1t' });
  await a.next('name-rejected');
  const w = await a.next('welcome');
  const b = client({ room: r }); await b.opened;
  b.send2({ t: 'hi' });
  const wb = await b.next('welcome');
  assert.deepEqual(wb.peers.map((p) => [p.id, p.name]), [[w.id, '']]);
  a.close(); b.close();
});

test('the 31st person is told the instance is full; the next instance has room', async () => {
  const r = room();
  const people = [];
  for (let i = 0; i < 30; i++) { const c = client({ room: r }); await c.opened; c.send2({ t: 'hi' }); people.push(c); }
  const extra = client({ room: r }); await extra.opened;
  assert.equal((await extra.next('full')).t, 'full');
  await extra.closed;
  const second = client({ room: r, n: 2 }); await second.opened;
  second.send2({ t: 'hi' });
  assert.deepEqual((await second.next('welcome')).peers, []);
  for (const c of [...people, second]) c.close();
});

test('a fifth connection from one IP is refused', async () => {
  const r = room();
  const mine = [];
  for (let i = 0; i < 4; i++) { const c = client({ room: r, ip: '9.9.9.9' }); await c.opened; mine.push(c); }
  const fifth = client({ room: r, ip: '9.9.9.9' });
  await assert.rejects(fifth.opened, /HTTP 429/);
  mine.forEach((c) => c.close());
});

test('bad origins, versions and instance numbers are refused', async () => {
  await assert.rejects(client({ origin: 'https://evil.com' }).opened, /HTTP 403/);
  await assert.rejects(client({ n: 11 }).opened, /HTTP 400/);
  await assert.rejects(client({ room: `ws://127.0.0.1:${PORT}/room/..%2Fx` }).opened, /HTTP 400/);
});

test('oversized messages close the connection; floods are cut off', async () => {
  const a = client({ room: room() }); await a.opened;
  a.send2({ t: 'hi' }); await a.next('welcome');
  a.send2(JSON.stringify({ t: 'r', f: 'x'.repeat(300) }));
  assert.equal(await a.closed, 1009);
  const b = client({ room: room() }); await b.opened;
  b.send2({ t: 'hi' }); await b.next('welcome');
  for (let i = 0; i < 80; i++) b.send2({ t: 'e', e: 'heart' });
  assert.equal(await b.closed, 1008);
});
```

Run: `cd server && npm test; cd ..`
Expected: FAIL. wrangler dev cannot start because `worker.js` is missing.

- [ ] **Step 3: Implement the Worker**

`server/worker.js`:
```js
// faiz.pics multiplayer: routes /room/<version>/<n> to one Gallery Durable Object per instance.
import { allowedOrigin, validVersion, LIMITS } from './rules.js';
export { Gallery } from './gallery.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([^/]+)\/(\d{1,2})$/);
    if (!allowedOrigin(req.headers.get('Origin'))) return new Response('forbidden', { status: 403 });
    if (!m) return new Response('not found', { status: 404 });
    let version;
    try { version = decodeURIComponent(m[1]); } catch { return new Response('bad version', { status: 400 }); }
    const n = Number(m[2]);
    if (!validVersion(version) || n < 1 || n > LIMITS.instances) return new Response('bad room', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const stub = env.GALLERY.get(env.GALLERY.idFromName(`${version}#${n}`));
    return stub.fetch(req);
  },
};
```

`server/gallery.js`:
```js
// One gallery instance: up to 30 people. Relays each message to everyone else as it arrives. Uses the
// hibernation API, so all per-person state lives in the socket's attachment, never in fields or storage.
import { DurableObject } from 'cloudflare:workers';
import { LIMITS, cleanName, parseMessage, newBuckets, take, newFlood, dropped } from './rules.js';

const KIND = { p: 'p', e: 'e', r: 'r', n: 'n' };

async function ipTag(ip) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`faiz-live:${ip}`));
  return 'ip:' + [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);

export class Gallery extends DurableObject {
  async fetch(req) {
    const tag = await ipTag(req.headers.get('CF-Connecting-IP') || 'unknown');
    if (this.ctx.getWebSockets(tag).length >= LIMITS.perIp) return new Response('too many connections', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [tag]);
    const now = Date.now();
    server.serializeAttachment({ id: randomId(), name: '', x: 0, y: 0, here: false, buckets: newBuckets(now), flood: newFlood(now) });
    if (this.ctx.getWebSockets().length > LIMITS.people) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4000, 'full');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  others(ws) {
    return this.ctx.getWebSockets().filter((o) => o !== ws && o.deserializeAttachment()?.here);
  }
  broadcast(ws, msg) {
    const text = JSON.stringify(msg);
    for (const o of this.others(ws)) { try { o.send(text); } catch {} }
  }

  async webSocketMessage(ws, data) {
    const me = ws.deserializeAttachment();
    if (typeof data !== 'string') return ws.close(1003, 'text only');
    if (new TextEncoder().encode(data).length > LIMITS.bytes) return ws.close(1009, 'too big');
    const now = Date.now();
    const m = parseMessage(data);
    const drop = () => {
      const flood = dropped(me.flood, now);
      ws.serializeAttachment(me);
      if (flood) ws.close(1008, 'flood');
    };
    if (!m) return drop();

    if (m.t === 'hi') {
      if (me.here) return drop();
      const name = cleanName(m.name);
      if (name === null) ws.send(JSON.stringify({ t: 'name-rejected' }));
      me.name = name || '';
      me.here = true;
      ws.serializeAttachment(me);
      const peers = this.others(ws).map((o) => { const a = o.deserializeAttachment(); return { id: a.id, name: a.name, x: a.x, y: a.y }; });
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, peers }));
      this.broadcast(ws, { t: 'join', id: me.id, name: me.name, x: me.x, y: me.y });
      return;
    }
    if (!me.here || !take(me.buckets, KIND[m.t], now)) return drop();
    if (m.t === 'p') { me.x = m.x; me.y = m.y; this.broadcast(ws, { t: 'p', id: me.id, x: m.x, y: m.y }); }
    else if (m.t === 'e') this.broadcast(ws, { t: 'e', id: me.id, e: m.e });
    else if (m.t === 'r') this.broadcast(ws, { t: 'r', id: me.id, f: m.f });
    else if (m.t === 'n') {
      const name = cleanName(m.name);
      if (name === null) ws.send(JSON.stringify({ t: 'name-rejected' }));
      else { me.name = name; this.broadcast(ws, { t: 'n', id: me.id, name }); }
    }
    ws.serializeAttachment(me);
  }

  async webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
  }
  async webSocketError(ws) { this.leave(ws); }
  leave(ws) {
    const me = ws.deserializeAttachment();
    if (me?.here) { me.here = false; ws.serializeAttachment(me); this.broadcast(ws, { t: 'leave', id: me.id }); }
  }
}
```

- [ ] **Step 4: Run the server tests**

Run: `cd server && npm test; cd ..`
Expected: all 7 pass. If `ws` reports close code 1006 rather than 1009 or 1008 for the server-closed cases, check `wrangler dev`'s output for an exception. If the code is right but the local runtime rewrites close codes, record a Ruling and assert only that the socket closes.

- [ ] **Step 5: Commit**

```bash
git add .gitignore server/package.json server/package-lock.json server/wrangler.toml server/worker.js server/gallery.js server/test/server.test.js
git commit -m "Multiplayer: Worker and Durable Object that relay people in one gallery instance

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Client connection (`src/net.js`)

**Files:**
- Create: `src/net.js`
- Test: `test/net.test.js`

**Interfaces:**
- Consumes: the protocol from Task 2.
- Produces: `createNet({ url, version, name, onMessage, onState, WebSocketImpl = globalThis.WebSocket, timers = { setTimeout, clearTimeout }, now = () => performance.now() })`, which returns:
  - `send(msg)`: sent only while connected and after `welcome`. `{t:'p'}` is throttled to one per 200 ms, keeping the latest; the trailing position is sent when the window ends.
  - `setName(name)`: remembered for reconnects; sends `{t:'n'}` when connected.
  - `pause()` / `resume()`: for the hidden tab.
  - `close()`
  - getters `state` (`'idle'|'connecting'|'live'|'waiting'|'gave-up'`), `instance` and `ping` (ms or null).
  - `onMessage(msg)` receives every server message except `full`. `onState(state)` is called on every change.
- URL used: `${url}/room/${encodeURIComponent(version)}/${instance}`.

- [ ] **Step 1: Write the failing tests**

```js
// test/net.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../src/net.js';

// A fake WebSocket and clock, so reconnects and throttling run instantly.
function harness() {
  const sockets = [];
  let t = 0;
  const timers = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this); }
    send(d) { this.sent.push(JSON.parse(d)); }
    close() { this.readyState = 3; this.onclose && this.onclose({ code: 1000 }); }
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    recv(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
    drop() { this.readyState = 3; this.onclose && this.onclose({ code: 1006 }); }
  }
  const clock = {
    setTimeout: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; },
    clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  };
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > end) break;
      const h = timers.shift(); t = h.at; h.fn();
    }
    t = end;
  };
  return { sockets, FakeWS, clock, advance, now: () => t };
}

const make = (h, extra = {}) => {
  const got = [], states = [];
  const net = createNet({ url: 'wss://x.dev', version: 'v1', name: 'Sam', onMessage: (m) => got.push(m), onState: (s) => states.push(s),
    WebSocketImpl: h.FakeWS, timers: h.clock, now: h.now, ...extra });
  return { net, got, states };
};

test('connects to instance 1, says hi with the name, goes live on welcome', () => {
  const h = harness();
  const { net, got } = make(h);
  assert.equal(h.sockets[0].url, 'wss://x.dev/room/v1/1');
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].sent, [{ t: 'hi', name: 'Sam' }]);
  h.sockets[0].recv({ t: 'welcome', id: 'a', peers: [] });
  assert.equal(net.state, 'live');
  assert.equal(got[0].t, 'welcome');
});

test('a full instance moves on to the next; after #10 it gives up for good', () => {
  const h = harness();
  const { net } = make(h);
  for (let n = 1; n <= 10; n++) {
    const s = h.sockets.at(-1);
    assert.equal(s.url, `wss://x.dev/room/v1/${n}`);
    s.open(); s.recv({ t: 'full' }); s.close();
  }
  assert.equal(net.state, 'gave-up');
  h.advance(10 * 60 * 1000);
  assert.equal(h.sockets.length, 10, 'no more attempts');
});

test('drops reconnect after 2 s, 4 s, 8 s … capped at 60 s; a welcome resets the delay', () => {
  const h = harness();
  make(h);
  const gaps = [];
  for (let i = 0; i < 7; i++) {
    const before = h.sockets.length;
    h.sockets.at(-1).drop();
    let waited = 0;
    while (h.sockets.length === before) { h.advance(1000); waited += 1000; }
    gaps.push(waited);
  }
  assert.deepEqual(gaps, [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  const s = h.sockets.at(-1); s.open(); s.recv({ t: 'welcome', id: 'z', peers: [] });
  const before = h.sockets.length;
  s.drop(); h.advance(2000);
  assert.equal(h.sockets.length, before + 1, 'back to 2 s');
});

test('positions are throttled to 5 a second, keeping the latest', () => {
  const h = harness();
  const { net } = make(h);
  const s = h.sockets[0]; s.open(); s.recv({ t: 'welcome', id: 'a', peers: [] });
  for (let i = 0; i < 10; i++) { net.send({ t: 'p', x: i, y: 0 }); h.advance(20); }
  h.advance(400);
  const ps = s.sent.filter((m) => m.t === 'p');
  assert.ok(ps.length <= 3, `${ps.length} sends in 0.6 s`);
  assert.deepEqual(ps.at(-1), { t: 'p', x: 9, y: 0 }, 'the final position always goes out');
});

test('nothing is sent before welcome; pause closes, resume reconnects', () => {
  const h = harness();
  const { net } = make(h);
  const s = h.sockets[0]; s.open();
  net.send({ t: 'e', e: 'heart' });
  assert.deepEqual(s.sent, [{ t: 'hi', name: 'Sam' }]);
  net.pause();
  assert.equal(net.state, 'idle');
  h.advance(120000);
  assert.equal(h.sockets.length, 1, 'no reconnect while paused');
  net.resume();
  assert.equal(h.sockets.length, 2);
});

test('a constructor that throws (blocked by the browser) counts as a drop, not a crash', () => {
  const h = harness();
  let calls = 0;
  class Boom { constructor() { calls++; throw new Error('blocked'); } }
  const { net } = make(h, { WebSocketImpl: Boom });
  assert.equal(net.state, 'waiting');
  h.advance(2000);
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run them to watch them fail**

Run: `node --test test/net.test.js 2>&1 | grep -E "ERR_MODULE|^ℹ fail"`
Expected: `ERR_MODULE_NOT_FOUND ... src/net.js`

- [ ] **Step 3: Implement `src/net.js`**

```js
// The multiplayer connection: one WebSocket to the current gallery instance. Never throws into the game.
const MAX_INSTANCE = 10, MAX_DELAY = 60000, POS_EVERY = 200;

export function createNet({ url, version, name, onMessage, onState, WebSocketImpl = globalThis.WebSocket,
  timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) }, now = () => performance.now() }) {
  let ws = null, state = 'idle', instance = 1, delay = 2000, retry = null, paused = false, welcomed = false;
  let myName = name || '';
  let posTimer = null, pendingPos = null, lastPos = -Infinity, pingAt = 0, ping = null;

  const set = (s) => { if (s !== state) { state = s; try { onState(s); } catch {} } };

  function connect() {
    retry = null;
    if (paused || state === 'gave-up') return;
    welcomed = false;
    set('connecting');
    let sock;
    try { sock = new WebSocketImpl(`${url}/room/${encodeURIComponent(version)}/${instance}`); } catch { return later(); }
    ws = sock;
    let full = false;
    sock.onopen = () => { pingAt = now(); raw({ t: 'hi', name: myName }); };
    sock.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'full') { full = true; return; }
      if (m.t === 'welcome') { welcomed = true; delay = 2000; ping = Math.round(now() - pingAt); set('live'); }
      try { onMessage(m); } catch (err) { console.warn(err); }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      welcomed = false;
      if (full) {
        if (instance >= MAX_INSTANCE) return set('gave-up');
        instance++;
        return connect();
      }
      if (!paused) later();
    };
    sock.onerror = () => {};
  }
  function later() {
    set('waiting');
    retry = timers.setTimeout(connect, delay);
    delay = Math.min(MAX_DELAY, delay * 2);
  }
  function raw(m) { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(m)); } catch {} }

  function flushPos() {
    posTimer = null;
    if (!pendingPos) return;
    raw(pendingPos);
    pendingPos = null;
    lastPos = now();
  }

  connect();

  return {
    send(m) {
      if (!welcomed) return;
      if (m.t !== 'p') return raw(m);
      pendingPos = m;
      const wait = POS_EVERY - (now() - lastPos);
      if (wait <= 0 && !posTimer) flushPos();
      else if (!posTimer) posTimer = timers.setTimeout(flushPos, Math.max(0, wait));
    },
    setName(n) { myName = n; if (welcomed) raw({ t: 'n', name: n }); },
    pause() {
      paused = true;
      if (retry) { timers.clearTimeout(retry); retry = null; }
      const s = ws; ws = null; welcomed = false;
      if (s) try { s.close(); } catch {}
      set('idle');
    },
    resume() { if (!paused) return; paused = false; delay = 2000; if (state !== 'gave-up') connect(); },
    close() { this.pause(); },
    get state() { return state; },
    get instance() { return instance; },
    get ping() { return ping; },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/net.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `pass 6`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/net.js test/net.test.js
git commit -m "Multiplayer: client connection with instance overflow, backoff and throttled positions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Peer state (`src/peers.js`)

**Files:**
- Create: `src/peers.js`
- Test: `test/peers.test.js`

**Interfaces:**
- Consumes: server messages (Task 2 shapes).
- Produces: `createPeers({ delay = 150, fade = 3000, emoteFor = 2500, heartFor = 2000 } = {})`, which returns:
  - `apply(msg, now)`: handles `welcome`, `join`, `leave`, `p`, `e`, `r` and `n`.
  - `list(now)` → `[{ id, name, x, y, alpha, emote: string|null, emoteAge: number }]`. `x` and `y` are smoothed. `alpha` is 1, falling to 0 over `fade` after leaving. `emote` is the glyph string.
  - `hearts(now)` → `[{ f: frameId, age: 0..1 }]`.
  - `get(id)`
  - `count()`: people present, not counting those fading out.
  - `myId` (set by `welcome`)
  - `clear()`
- `EMOTE_GLYPH = { heart: '♥', bang: '!', ask: '?', star: '★', wave: '~o/' }` (exported).
- `followCell(map, target, isWalkable)` → `{x,y}|null`. A walkable cell about 2 cells behind the target, opposite their last direction of travel, falling back to any walkable neighbour within 2.

- [ ] **Step 1: Write the failing tests**

```js
// test/peers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeers, followCell, EMOTE_GLYPH } from '../src/peers.js';

test('welcome and join add people; leave fades them out over 3 s', () => {
  const ps = createPeers();
  ps.apply({ t: 'welcome', id: 'me', peers: [{ id: 'a', name: 'Ann', x: 5, y: 5 }] }, 0);
  ps.apply({ t: 'join', id: 'b', name: '', x: 1, y: 1 }, 0);
  assert.equal(ps.myId, 'me');
  assert.equal(ps.count(), 2);
  ps.apply({ t: 'leave', id: 'a' }, 1000);
  assert.equal(ps.count(), 1, 'leavers no longer count');
  const ann = (t) => ps.list(t).find((p) => p.id === 'a');
  assert.ok(Math.abs(ann(2500).alpha - 0.5) < 0.01);
  assert.equal(ann(4100), undefined, 'gone after the fade');
});

test('movement is drawn 150 ms behind, interpolating between updates', () => {
  const ps = createPeers();
  ps.apply({ t: 'join', id: 'a', name: '', x: 0, y: 0 }, 0);
  ps.apply({ t: 'p', id: 'a', x: 10, y: 0 }, 200);
  ps.apply({ t: 'p', id: 'a', x: 20, y: 0 }, 400);
  const at = (t) => ps.list(t)[0].x;
  assert.equal(at(350), 10, '350 - 150 = 200: exactly the second update');
  assert.equal(at(450), 15, 'halfway between 200 and 400');
  assert.equal(at(5000), 20, 'holds the last position');
});

test('emotes show for 2.5 s; hearts last 2 s; renames apply; unknown ids are ignored', () => {
  const ps = createPeers();
  ps.apply({ t: 'join', id: 'a', name: 'Ann', x: 0, y: 0 }, 0);
  ps.apply({ t: 'e', id: 'a', e: 'wave' }, 100);
  assert.equal(ps.list(1000)[0].emote, EMOTE_GLYPH.wave);
  assert.equal(ps.list(2700)[0].emote, null);
  ps.apply({ t: 'r', id: 'a', f: 'p1' }, 0);
  assert.deepEqual(ps.hearts(1000), [{ f: 'p1', age: 0.5 }]);
  assert.deepEqual(ps.hearts(2100), []);
  ps.apply({ t: 'n', id: 'a', name: 'Annie' }, 0);
  assert.equal(ps.get('a').name, 'Annie');
  ps.apply({ t: 'p', id: 'ghost', x: 1, y: 1 }, 0);
  ps.apply({ t: 'e', id: 'ghost', e: 'star' }, 0);
  assert.equal(ps.list(0).length, 1);
});

test('a second welcome (after reconnecting) replaces everyone', () => {
  const ps = createPeers();
  ps.apply({ t: 'welcome', id: 'me', peers: [{ id: 'a', name: '', x: 0, y: 0 }] }, 0);
  ps.apply({ t: 'welcome', id: 'me2', peers: [{ id: 'b', name: '', x: 0, y: 0 }] }, 10);
  assert.deepEqual(ps.list(10).map((p) => p.id), ['b']);
});

test('follow aims about 2 cells behind, on a walkable cell', () => {
  const open = () => true;
  assert.deepEqual(followCell(null, { x: 10.5, y: 5.5, dx: 1, dy: 0 }, open), { x: 8, y: 5 });
  assert.deepEqual(followCell(null, { x: 10.5, y: 5.5, dx: 0, dy: -1 }, open), { x: 10, y: 7 });
  const wallBehind = (x, y) => !(x === 8 && y === 5);
  const c = followCell(null, { x: 10.5, y: 5.5, dx: 1, dy: 0 }, wallBehind);
  assert.ok(c && wallBehind(c.x, c.y) && Math.hypot(c.x - 10, c.y - 5) <= 2.5);
  assert.equal(followCell(null, { x: 10.5, y: 5.5, dx: 1, dy: 0 }, () => false), null);
});
```

- [ ] **Step 2: Run them to watch them fail**

Run: `node --test test/peers.test.js 2>&1 | grep -E "ERR_MODULE|^ℹ fail"`
Expected: `ERR_MODULE_NOT_FOUND ... src/peers.js`

- [ ] **Step 3: Implement `src/peers.js`**

```js
// Other real visitors: positions smoothed a little behind real time, emotes, hearts at photos, and who
// is still here. Pure data; main.js draws it.
export const EMOTE_GLYPH = { heart: '♥', bang: '!', ask: '?', star: '★', wave: '~o/' };

export function createPeers({ delay = 150, fade = 3000, emoteFor = 2500, heartFor = 2000 } = {}) {
  const peers = new Map(); // id → { id, name, track: [{t,x,y}], left: number|null, emote, emoteAt, dx, dy }
  let hearts = []; // { f, at }
  const api = {
    myId: null,
    apply(m, now) {
      if (m.t === 'welcome') {
        api.myId = m.id;
        peers.clear();
        for (const p of m.peers) add(p, now);
        return;
      }
      if (m.t === 'join') return add(m, now);
      const p = peers.get(m.id);
      if (!p) return;
      if (m.t === 'leave') { if (p.left == null) p.left = now; }
      else if (m.t === 'p') {
        const last = p.track.at(-1);
        const ddx = m.x - last.x, ddy = m.y - last.y;
        if (ddx || ddy) { const d = Math.hypot(ddx, ddy); p.dx = ddx / d; p.dy = ddy / d; }
        p.track.push({ t: now, x: m.x, y: m.y });
        if (p.track.length > 8) p.track.shift();
      } else if (m.t === 'e') { p.emote = EMOTE_GLYPH[m.e] || null; p.emoteAt = now; }
      else if (m.t === 'n') p.name = m.name;
      else if (m.t === 'r') hearts.push({ f: m.f, at: now });
    },
    list(now) {
      const out = [];
      for (const p of [...peers.values()]) {
        if (p.left != null && now - p.left >= fade) { peers.delete(p.id); continue; }
        const { x, y } = sample(p.track, now - delay);
        const showing = p.emote && now - p.emoteAt < emoteFor;
        out.push({ id: p.id, name: p.name, x, y, dx: p.dx, dy: p.dy, alpha: p.left == null ? 1 : 1 - (now - p.left) / fade,
          emote: showing ? p.emote : null, emoteAge: showing ? (now - p.emoteAt) / emoteFor : 0 });
      }
      return out;
    },
    hearts(now) {
      hearts = hearts.filter((h) => now - h.at < heartFor);
      return hearts.map((h) => ({ f: h.f, age: (now - h.at) / heartFor }));
    },
    get: (id) => peers.get(id) || null,
    count: () => [...peers.values()].filter((p) => p.left == null).length,
    clear() { peers.clear(); hearts = []; },
  };
  function add(p, now) {
    peers.set(p.id, { id: p.id, name: p.name || '', track: [{ t: now, x: p.x, y: p.y }], left: null, emote: null, emoteAt: 0, dx: 0, dy: 1 });
  }
  return api;
}

function sample(track, t) {
  if (t <= track[0].t) return track[0];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if (t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return track.at(-1);
}

// A cell about two behind someone (opposite the way they last moved), for following them.
export function followCell(map, target, walkable) {
  const cx = Math.floor(target.x), cy = Math.floor(target.y);
  const bx = Math.round(cx - (target.dx || 0) * 2), by = Math.round(cy - (target.dy || 0) * 2);
  if ((bx !== cx || by !== cy) && walkable(bx, by)) return { x: bx, y: by };
  for (let r = 1; r <= 2; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/peers.test.js 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `pass 5`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/peers.js test/peers.test.js
git commit -m "Multiplayer: peer state with smoothing, fade-out, emotes, hearts and follow targets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Presence in the gallery (seeing each other)

**Files:**
- Create: `src/live.js`
- Modify:
  - `src/config.js`
  - `src/main.js` (loop at the `world.people` / `world.entities` block, boot, debug line)
  - `src/world.js` (`stepVisitors` obstacles)
  - `src/map.js` (`sync`)
  - `src/render/gl.js` (`buildAtlas`)
  - `index.html` (HUD)
  - `src/style.css`
- Test: `test/world.test.js` (fake visitors step aside), `test/live.test.js` (entities to draw)

**Interfaces:**
- Consumes:
  - `createNet` (Task 3)
  - `createPeers`, `EMOTE_GLYPH` (Task 4)
- Produces:
  - `src/config.js`: `export const MULTIPLAYER = { enabled: true, url: '' }`
  - `src/live.js` exports:
    - `peerColor(id) → [r,g,b]`
    - `peerEntities(list, { reducedMotion }) → [{x,y,glyph,color}]`: a `@`, the name centred on the row below, and the emote on the row above. Each glyph is one entity; colours are faded by `alpha` toward the background.
    - `heartEntities(hearts, frames, { reducedMotion }) → [...]`
    - `createLive({ version, getName, onAnnounce, onCount, onRejected }) → { net, peers, tick(now, player, moving), emote(kind), heart(frameId), setName(name), state }`. When `MULTIPLAYER.enabled` is false or there is no url, `createLive` returns `null`.
  - `world.others` (array of `{x,y}`), which `stepVisitors` treats as obstacles.
  - `mapView.sync(player, roomIndex, others = [])`

- [ ] **Step 1: Write the failing tests**

Append to `test/world.test.js`:
```js
test('fake visitors step aside for real people too', () => {
  const w = createWorld(map, { visitors: true });
  const v = w.visitors[0];
  w.others = [{ x: v.x + 0.3, y: v.y }];
  const before = v.x;
  for (let i = 0; i < 30; i++) step(w, 1 / 60, { x: 0, y: 0 });
  assert.ok(Math.abs(v.x - before) > 0.2, `moved ${v.x - before}`);
});
```

Check how `createWorld` makes visitors first (`grep -n "createVisitors" src/world.js`). If visitors are created unconditionally, drop the `{ visitors: true }` option from the test.

Create `test/live.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerEntities, heartEntities, peerColor } from '../src/live.js';

test('a peer is an @ with its name centred below and its emote above', () => {
  const es = peerEntities([{ id: 'abc', name: 'Sam', x: 10.5, y: 5.5, alpha: 1, emote: '~o/', emoteAge: 0.1 }], { reducedMotion: true });
  const at = (y) => es.filter((e) => e.y === y).sort((a, b) => a.x - b.x).map((e) => e.glyph).join('');
  assert.equal(at(5.5), '@');
  assert.equal(at(6.5), 'Sam');
  assert.equal(at(4.5), '~o/');
  assert.deepEqual(es.find((e) => e.glyph === '@').color, peerColor('abc'));
});

test('fading peers dim toward the background; no name means no label', () => {
  const [full] = peerEntities([{ id: 'a', name: '', x: 1, y: 1, alpha: 1, emote: null }], {});
  const [dim] = peerEntities([{ id: 'a', name: '', x: 1, y: 1, alpha: 0.25, emote: null }], {});
  assert.equal(peerEntities([{ id: 'a', name: '', x: 1, y: 1, alpha: 1, emote: null }], {}).length, 1);
  assert.ok(dim.color[0] < full.color[0]);
});

test('hearts rise from the top of their frame unless motion is reduced', () => {
  const frames = [{ id: 'p1', x: 20, y: 10, w: 8, h: 6 }];
  const [early] = heartEntities([{ f: 'p1', age: 0 }], frames, {});
  const [late] = heartEntities([{ f: 'p1', age: 0.9 }], frames, {});
  assert.equal(early.glyph, '♥');
  assert.ok(late.y < early.y - 2, 'rose about 3 rows');
  const [still] = heartEntities([{ f: 'p1', age: 0.9 }], frames, { reducedMotion: true });
  assert.equal(still.y, early.y);
  assert.deepEqual(heartEntities([{ f: 'nope', age: 0 }], frames, {}), []);
});
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npm test 2>&1 | grep -E "^✖|ERR_MODULE" | head`
Expected: `ERR_MODULE_NOT_FOUND ... src/live.js`, and the world test fails (`moved 0`).

- [ ] **Step 3: Implement**

`src/config.js`, appended:
```js
// Real visitors seeing each other (server/ is the Cloudflare Worker). An empty url turns it off.
export const MULTIPLAYER = { enabled: true, url: '' };
```

`src/world.js`, in `stepVisitors`: replace both obstacle lists with one that includes real people. Change
```js
    if (near(v, player, 0.9)) {
      const dx = v.x - player.x, dy = (v.y - player.y) * CELL_ASPECT, d = Math.hypot(dx, dy) || 1;
```
to
```js
    const bump = [player, ...(world.others || [])].find((o) => near(v, o, 0.9));
    if (bump) {
      const dx = v.x - bump.x, dy = (v.y - bump.y) * CELL_ASPECT, d = Math.hypot(dx, dy) || 1;
```
and
```js
    const blocker = [player, ...world.visitors.filter((o) => o !== v)].some((o) => near(ahead, o, 0.8));
```
to
```js
    const blocker = [player, ...(world.others || []), ...world.visitors.filter((o) => o !== v)].some((o) => near(ahead, o, 0.8));
```

`src/live.js`:
```js
// Multiplayer glue: connects (src/net.js), keeps peer state (src/peers.js) and turns it into things to draw.
import { MULTIPLAYER } from './config.js';
import { createNet } from './net.js';
import { createPeers } from './peers.js';

const BG = [7, 8, 11];
const mix = (c, a) => c.map((v, i) => Math.round(BG[i] + (v - BG[i]) * a));

// A stable, light colour per connection.
export function peerColor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360, s = 0.55, l = 0.7;
  const k = (n) => (n + hue / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

const row = (text, cx, y, color) => [...text].map((glyph, i) => ({ x: Math.floor(cx) - Math.floor(text.length / 2) + i + 0.5, y, glyph, color }));

export function peerEntities(list, { reducedMotion } = {}) {
  const out = [];
  for (const p of list) {
    const color = mix(peerColor(p.id), p.alpha);
    out.push({ x: p.x, y: p.y, glyph: '@', color });
    if (p.name) out.push(...row(p.name, p.x, p.y + 1, mix([150, 147, 140], p.alpha)));
    if (p.emote) {
      const lift = reducedMotion ? 0 : -Math.min(1, p.emoteAge * 3) * 0.5;
      out.push(...row(p.emote, p.x, p.y - 1 + lift, color));
    }
  }
  return out;
}

export function heartEntities(hearts, frames, { reducedMotion } = {}) {
  const out = [];
  for (const h of hearts) {
    const f = frames.find((fr) => fr.id === h.f);
    if (!f) continue;
    const y = f.y - 0.5 - (reducedMotion ? 0 : h.age * 3);
    out.push({ x: f.x + f.w / 2, y, glyph: '♥', color: mix([235, 96, 120], 1 - h.age * 0.8) });
  }
  return out;
}

export function createLive({ version, url = MULTIPLAYER.url, getName, onAnnounce, onCount, onRejected, onState = () => {} }) {
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('live');
  const target = local || url;
  if (!MULTIPLAYER.enabled || !target) return null;
  const peers = createPeers();
  let count = 0;
  const net = createNet({
    url: target, version, name: getName(), onState,
    onMessage: (m) => {
      const now = performance.now();
      if (m.t === 'name-rejected') return onRejected();
      if (m.t === 'join') onAnnounce('join', m);
      if (m.t === 'leave') { const p = peers.get(m.id); if (p) onAnnounce('leave', { ...m, name: p.name, x: p.track.at(-1).x, y: p.track.at(-1).y }); }
      peers.apply(m, now);
      if (m.t === 'welcome' || m.t === 'join' || m.t === 'leave') { count = peers.count(); onCount(count); }
    },
  });
  addEventListener('visibilitychange', () => {
    clearTimeout(createLive.hideTimer);
    if (document.hidden) createLive.hideTimer = setTimeout(() => { net.pause(); peers.clear(); onCount(0); }, 30000);
    else net.resume();
  });
  let sent = null;
  return {
    net, peers,
    // Called every frame: sends my position while moving, plus once more when I stop.
    tick(player, moving) {
      const x = Math.round(player.x * 10) / 10, y = Math.round(player.y * 10) / 10;
      if (sent && sent.x === x && sent.y === y) return;
      if (!moving && sent && sent.stopped) return;
      net.send({ t: 'p', x, y });
      sent = { x, y, stopped: !moving };
    },
    emote: (e) => net.send({ t: 'e', e }),
    heart: (f) => net.send({ t: 'r', f }),
    setName: (n) => net.setName(n),
    get state() { return net.state; },
  };
}
```

`src/render/gl.js` in `buildAtlas`, after `add('@☺☻&·?…─│┌┐└┘╥═║░▒▓█');`:
```js
    // Names and emotes of real visitors: any printable ASCII, plus the emote symbols.
    for (let c = 32; c < 127; c++) chars.add(String.fromCharCode(c));
    add('♥★');
```

`src/map.js`:
- In `sync`, change the signature to `sync(player, roomIndex, others = [])`.
- In the `open` branch, add:
```js
      while (dots.length < others.length) { const d = document.createElement('span'); d.className = 'map-peer'; d.textContent = '@'; d.setAttribute('aria-hidden', 'true'); plan.append(d); dots.push(d); }
      dots.forEach((d, i) => {
        const o = others[i];
        d.hidden = !o;
        if (o) { d.style.left = `${(o.x / map.W) * 100}%`; d.style.top = `${(o.y / map.H) * 100}%`; }
      });
```
- Declare `const dots = [];` next to `let current = 0;`.

`src/style.css`, append:
```css
/* Multiplayer */
.map-peer { position: absolute; transform: translate(-50%, -50%); color: rgb(150 190 230); pointer-events: none; }
.hud-here { color: var(--mute); padding: 4px 6px; }
.hud-here[hidden] { display: none; }
```

`index.html`, inside `.hud-tools`, before the map button:
```html
        <span class="hud-here" id="hud-here" hidden></span>
```

`src/main.js`:
- imports:
```js
import { MULTIPLAYER } from './config.js';
import { createLive, peerEntities, heartEntities } from './live.js';
```
  Merge the first into the existing `./config.js` import line: `import { SITE, MULTIPLAYER } from './config.js';`.
- module state: `let live = null;`
- in `boot()`, after `mapView = createMap(...)`, with `data.generated` from the manifest. `loadData` must return it. Change `indexData` to return `{ byId, rooms, generated: json.generated || 'dev' }` and add `assert.equal(indexData({ photos: [], generated: 'g' }).generated, 'g')` to `test/data.test.js`.
```js
  const hereEl = document.getElementById('hud-here');
  live = createLive({
    version: data.generated,
    getName: () => { try { return localStorage.getItem('faiz-live-name') || ''; } catch { return ''; } },
    onCount: (n) => { hereEl.hidden = !n; hereEl.textContent = `${n} here`; },
    onAnnounce: (kind, m) => {
      // Only people in your room are announced, to keep screen readers quiet.
      if (roomAt(map, m.x, m.y) !== roomAt(map, world.player.x, world.player.y)) return;
      captionEl.setAttribute('aria-live', 'polite');
      note(`${m.name || 'someone'} ${kind === 'join' ? 'joined' : 'left'}`, 2000);
    },
    onRejected: () => note('try another name'),
  });
```
- in `loop`, replace
```js
  world.entities = [{ x: world.player.x, y: world.player.y, glyph: '@', color: C.player }];
```
  with
```js
  world.entities = [];
  world.others = [];
  if (live) {
    const now = performance.now();
    live.tick(world.player, world.player.moving);
    const list = live.peers.list(now);
    world.others = list.filter((p) => p.alpha === 1);
    world.entities.push(...peerEntities(list, { reducedMotion }), ...heartEntities(live.peers.hearts(now), map.frames, { reducedMotion }));
  }
  world.entities.push({ x: world.player.x, y: world.player.y, glyph: '@', color: C.player });
```
  Also change `mapView.sync(world.player, roomAt(...))` to `mapView.sync(world.player, roomAt(map, world.player.x, world.player.y), world.others);`.
- debug line: append `` `\nnet: ${live ? `${live.state} #${live.net.instance} · ${live.peers.count()} peers · ${live.net.ping ?? '–'} ms` : 'off'}` ``.
- test hook: add `live: () => live,` to `window.__ascii`.

- [ ] **Step 4: Run all tests and the build**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run build 2>&1 | tail -1`
Expected: `fail 0`; build ok. With `url: ''` the gallery is unchanged. Confirm with `npm run e2e 2>&1 | grep -E "^FAIL"`, where only the known 30 fps battery checks may fail.

- [ ] **Step 5: Commit**

```bash
git add src/live.js src/config.js src/main.js src/world.js src/map.js src/render/gl.js src/data.js index.html src/style.css test/world.test.js test/live.test.js test/data.test.js
git commit -m "Multiplayer: show other real visitors as @ with names, on the map and in the HUD

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Emotes and photo hearts

**Files:**
- Modify: `src/main.js` (`onKey`, `updateCaption`), `index.html`, `src/style.css`, `src/live.js`
- Test: `test/live.test.js`

**Interfaces:**
- Consumes: `live.emote`, `live.heart`, `peerEntities`, `heartEntities` (Task 5).
- Produces:
  - Keys `1`–`5` → `EMOTES[i]`. The `[☺]` HUD button toggles `#emote-bar`, which holds 5 buttons.
  - `H` (or a `♥` button in the caption) hearts `world.focus`.
  - Local echo: the player's own emote shows above their `@` immediately, and their heart floats at once.
  - `live.js` adds `localEcho()`, which returns `{ emote(kind, now), heart(f, now), entities(player, frames, now, opts) }`, built on a second `createPeers()` holding only the player with id `'me'`.
  - Client-side throttles mirror the server: one emote per second and one heart per 2 s. Extra presses do nothing, so the screen never shows what the server drops.

- [ ] **Step 1: Write the failing test** (append to `test/live.test.js`)

```js
import { localEcho } from '../src/live.js';

test('my own emote and heart show at once, at most one emote a second and one heart every 2 s', () => {
  const echo = localEcho();
  assert.equal(echo.emote('star', 0), true);
  assert.equal(echo.emote('heart', 500), false, 'too soon');
  const es = echo.entities({ x: 3.5, y: 3.5 }, [{ id: 'p1', x: 1, y: 10, w: 4, h: 3 }], 600, { reducedMotion: true });
  assert.ok(es.some((e) => e.glyph === '★' && e.y === 2.5));
  assert.equal(echo.heart('p1', 600), true);
  assert.equal(echo.heart('p1', 1500), false);
  assert.ok(echo.entities({ x: 3.5, y: 3.5 }, [{ id: 'p1', x: 1, y: 10, w: 4, h: 3 }], 700, { reducedMotion: true }).some((e) => e.glyph === '♥'));
  assert.equal(echo.emote('wave', 1100), true);
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `node --test test/live.test.js 2>&1 | grep -E "SyntaxError|^ℹ fail"`
Expected: `does not provide an export named 'localEcho'`

- [ ] **Step 3: Implement**

`src/live.js`, appended:
```js
// What I do shows on my own screen straight away, with the same limits the server enforces.
export function localEcho() {
  const me = createPeers({ delay: 0 });
  me.apply({ t: 'welcome', id: 'me', peers: [{ id: 'me', name: '', x: 0, y: 0 }] }, 0);
  let lastEmote = -Infinity, lastHeart = -Infinity;
  return {
    emote(kind, now) {
      if (now - lastEmote < 1000) return false;
      lastEmote = now;
      me.apply({ t: 'e', id: 'me', e: kind }, now);
      return true;
    },
    heart(f, now) {
      if (now - lastHeart < 2000) return false;
      lastHeart = now;
      me.apply({ t: 'r', id: 'me', f }, now);
      return true;
    },
    entities(player, frames, now, opts) {
      const [p] = me.list(now);
      const out = [];
      if (p && p.emote) out.push(...peerEntities([{ ...p, id: 'me', name: '', x: player.x, y: player.y }], opts).filter((e) => e.glyph !== '@'));
      out.push(...heartEntities(me.hearts(now), frames, opts));
      return out;
    },
  };
}
```

`src/peers.js`: add `export const EMOTES_ORDER = ['heart', 'bang', 'ask', 'star', 'wave'];` next to `EMOTE_GLYPH`.

`index.html`, in `.hud-tools` after `#hud-here`:
```html
        <button class="hud-btn" id="emote-btn" type="button" title="Emotes (1–5)" aria-expanded="false" hidden>[☺]</button>
```
and after the `</header>`:
```html
    <div class="emote-bar" id="emote-bar" hidden></div>
```

`src/style.css`, appended:
```css
.emote-bar { position: fixed; top: 48px; right: 16px; display: flex; gap: 6px; z-index: 3; }
.emote-bar[hidden] { display: none; }
.emote-bar button { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); padding: 6px 10px; cursor: pointer; }
.caption .heart { pointer-events: auto; cursor: pointer; color: rgb(235 96 120); margin-left: 1ch; background: none; border: 0; font: inherit; padding: 0; }
.caption.on { pointer-events: auto; }
```

`src/main.js`:
- `import { localEcho } from './live.js';` and `import { EMOTES_ORDER, EMOTE_GLYPH } from './peers.js';`
- module state: `const echo = localEcho();`
- helpers:
```js
function sendEmote(kind) {
  if (!echo.emote(kind, performance.now())) return;
  if (live) live.emote(kind);
}
function sendHeart(f) {
  if (!f || !echo.heart(f.id, performance.now())) return;
  if (live) live.heart(f.id);
}
```
- in `onKey`, before `return false;`:
```js
  const digit = /^Digit([1-5])$/.exec(e.code);
  if (digit) { sendEmote(EMOTES_ORDER[digit[1] - 1]); return true; }
  if (e.code === 'KeyH') { sendHeart(world.focus); return true; }
```
- in `updateCaption`, after the `[E] open` key span, when `f !== 'kiosk'`:
```js
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'heart';
    h.textContent = '♥';
    h.title = 'Send a heart (H)';
    h.setAttribute('aria-label', 'Send a heart to this photo');
    h.addEventListener('click', () => sendHeart(world.focus));
    captionEl.append(h);
```
- in `boot()`, wire the bar:
```js
  const emoteBtn = document.getElementById('emote-btn'), emoteBar = document.getElementById('emote-bar');
  emoteBtn.hidden = false;
  EMOTES_ORDER.forEach((kind, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = EMOTE_GLYPH[kind];
    b.title = `${kind} (${i + 1})`;
    b.setAttribute('aria-label', kind);
    b.addEventListener('click', () => { sendEmote(kind); emoteBar.hidden = true; emoteBtn.setAttribute('aria-expanded', 'false'); });
    emoteBar.append(b);
  });
  emoteBtn.addEventListener('click', () => { emoteBar.hidden = !emoteBar.hidden; emoteBtn.setAttribute('aria-expanded', String(!emoteBar.hidden)); });
```
- in `loop`, before pushing the player's `@`: `world.entities.push(...echo.entities(world.player, map.frames, performance.now(), { reducedMotion }));`

- [ ] **Step 4: Run tests and build**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run build 2>&1 | tail -1`
Expected: `fail 0`; build ok.

- [ ] **Step 5: Commit**

```bash
git add src/live.js src/peers.js src/main.js index.html src/style.css test/live.test.js
git commit -m "Multiplayer: emotes (1–5 or [☺]) and hearts at photos (H or ♥)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Names

**Files:**
- Modify: `index.html`, `src/style.css`, `src/main.js`
- Test: e2e in Task 9 (keys typed into the field must not act as game keys)

**Interfaces:**
- Consumes: `live.setName` (Task 5), `cleanName` (Task 1).
- Produces:
  - A `[N] name` HUD button (`#name-btn`) and `N`, both opening `#name-form`, an inline `<form>` holding `<input maxlength="12">` and a save button.
  - Submit:
    - checks `cleanName` client-side (imported from `../server/rules.js`, a pure module Vite can bundle);
    - shows "try another name" on rejection;
    - saves `faiz-live-name` and calls `live?.setName`;
    - closes the form and focuses the stage.
  - Esc closes it.

- [ ] **Step 1: Implement** (the behaviour test is the e2e test in Task 9; `cleanName` is already unit-tested)

`index.html`, in `.hud-tools` before `#map-btn`:
```html
        <button class="hud-btn" id="name-btn" type="button" title="Your name (N)">[N] name</button>
```
after `</header>`:
```html
    <form class="name-form" id="name-form" hidden>
      <label for="name-input">your name</label>
      <input id="name-input" maxlength="12" autocomplete="nickname" spellcheck="false" />
      <button class="vbtn" type="submit">save</button>
      <span class="name-msg" id="name-msg" role="status"></span>
    </form>
```

`src/style.css`, appended:
```css
.name-form { position: fixed; top: 48px; right: 16px; z-index: 3; display: flex; gap: 8px; align-items: center; padding: 8px 10px;
  background: var(--bg); border: 1px solid var(--line); color: var(--mute); }
.name-form[hidden] { display: none; }
.name-form input { font: inherit; color: var(--ink); background: #0d0f14; border: 1px solid var(--line); padding: 4px 6px; width: 14ch; }
.name-msg { color: rgb(235 120 110); }
```

`src/main.js`:
- `import { cleanName } from '../server/rules.js';`
- in `boot()`:
```js
  const nameForm = document.getElementById('name-form'), nameInput = document.getElementById('name-input'), nameMsg = document.getElementById('name-msg');
  const openName = () => {
    try { nameInput.value = localStorage.getItem('faiz-live-name') || ''; } catch {}
    nameMsg.textContent = '';
    nameForm.hidden = false;
    nameInput.focus();
  };
  const closeName = () => { nameForm.hidden = true; stage.focus({ preventScroll: true }); };
  document.getElementById('name-btn').addEventListener('click', openName);
  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = cleanName(nameInput.value);
    if (n === null) { nameMsg.textContent = 'try another name'; return; }
    try { localStorage.setItem('faiz-live-name', n); } catch {}
    if (live) live.setName(n);
    closeName();
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeName(); } });
```
- in `onKey`: `if (e.code === 'KeyN') { document.getElementById('name-btn').click(); return true; }`

- [ ] **Step 2: Manual check of key isolation**

Run: `npm run dev`. Open http://localhost:5173. Press N, type `1h5gem`, then press Enter.
Expected: no emote shows, the grid and map do not open, and the form rejects nothing (`1h5gem` is allowed) and closes. `input.js` already ignores keys from editable targets; this step confirms nothing else listens.

- [ ] **Step 3: Run tests and build**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run build 2>&1 | tail -1`
Expected: `fail 0`; build ok.

- [ ] **Step 4: Commit**

```bash
git add index.html src/style.css src/main.js
git commit -m "Multiplayer: set a short name with N or the [N] name button

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Follow someone

**Files:**
- Modify: `src/main.js` (`onTap`, `onKey`, loop, `openFrame`)
- Test: `test/peers.test.js` already covers `followCell`. The behaviour is tested in Task 9's e2e.

**Interfaces:**
- Consumes: `followCell` (Task 4), `walkTo` (world.js), `isWalkable` (layout.js), `live.peers` (Task 5).
- Produces: `following` state in main (`{ id } | null`), with the caption "following <name> · esc to stop". It stops on:
  - movement keys or a tap elsewhere;
  - Esc;
  - the person leaving;
  - opening a photo, the grid or the map.

- [ ] **Step 1: Implement**

`src/main.js`:
- `import { followCell } from './peers.js';` and add `isWalkable` to the `./layout.js` import.
- module state: `let following = null, followAt = 0;`
- helper:
```js
function stopFollowing() { if (following) { following = null; lastFocus = undefined; } }
function peerAtCell(cx, cy) {
  if (!live) return null;
  return live.peers.list(performance.now()).find((p) => p.alpha === 1 && Math.abs(p.x - (cx + 0.5)) <= 1 && Math.abs(p.y - (cy + 0.5)) <= 1) || null;
}
```
- in `onTap`, after the `cell` is computed and before the kiosk check:
```js
  const peer = peerAtCell(cell.x, cell.y);
  if (peer) { following = { id: peer.id }; followAt = 0; return; }
  stopFollowing();
```
- in `onKey`, at the top after the open-overlay guard: `if (e.code === 'Escape' && following) { stopFollowing(); return true; }`
- in `openFrame` and `openGrid`, first line: `stopFollowing();`. In the map's `onOpen`: `() => { input.clear(); stopFollowing(); }`.
- in `loop`, after `live.tick(...)`:
```js
    if (following) {
      const input0 = input.state();
      const target = list.find((p) => p.id === following.id && p.alpha === 1);
      if (!target || input0.x || input0.y) stopFollowing();
      else if (now - followAt > 500) {
        followAt = now;
        const c = followCell(map, target, (x, y) => isWalkable(map, x, y));
        if (c) walkTo(world, c.x, c.y);
      }
    }
```
  (`list` and `now` are the variables from the Task 5 block; move `following` handling inside that `if (live)` block.)
- in `updateCaption`, at the start:
```js
  const fol = following && live && live.peers.get(following.id);
  if (fol) {
    const key = `follow:${fol.name}`;
    if (lastFocus === key) return;
    lastFocus = key;
    captionEl.replaceChildren(`following ${fol.name || 'someone'} · esc to stop`);
    captionEl.classList.add('on');
    return;
  }
```

- [ ] **Step 2: Run tests and build**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run build 2>&1 | tail -1`
Expected: `fail 0`; build ok.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "Multiplayer: tap another visitor to follow them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Two-browser e2e

**Files:**
- Create: `e2e/multiplayer.mjs`
- Modify: `package.json` (`e2e` script), `e2e/lib.mjs` (an option for a second page)

**Interfaces:**
- Consumes: everything above. Pages are pointed at the local server with `?live=ws://127.0.0.1:8796` (only honoured on localhost, Task 5).

- [ ] **Step 1: Write the e2e test**

`e2e/lib.mjs`: in `withBrowser`, also pass `browser` to `fn`. Change `return await fn({ page, url: ..., errors });` to `return await fn({ page, browser, url: ..., errors });`.

`e2e/multiplayer.mjs`:
```js
// Two visitors in one gallery, against the Worker running locally (wrangler dev). Usage: npm run e2e:live
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { withBrowser, ready, sleep } from './lib.mjs';

const PORT = 8796;
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: fileURLToPath(new URL('../server', import.meta.url)) });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('wrangler dev did not start')), 60000);
  const on = (d) => { if (String(d).includes('Ready on')) { clearTimeout(t); resolve(); } };
  dev.stdout.on('data', on); dev.stderr.on('data', on);
});

const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

try {
  await withBrowser(async ({ page: a, browser, url, errors }) => {
    const live = `${url}?live=ws://127.0.0.1:${PORT}`;
    const b = await browser.newPage();
    b.on('pageerror', (e) => errors.push(e.message));
    await b.setViewport({ width: 1000, height: 700 });
    await a.evaluateOnNewDocument(() => localStorage.setItem('faiz-live-name', 'Ann'));
    await b.evaluateOnNewDocument(() => localStorage.setItem('faiz-live-name', 'Bo'));
    await a.goto(live); await ready(a);
    await b.goto(live); await ready(b);
    const peersOf = (p) => p.evaluate(() => window.__ascii.live().peers.list(performance.now()).map((x) => ({ id: x.id, name: x.name, x: x.x, y: x.y, emote: x.emote })));

    await check('each sees the other, with names, and the HUD counts them', async () => {
      await a.waitForFunction(() => window.__ascii.live().peers.count() === 1, { timeout: 10000 });
      await b.waitForFunction(() => window.__ascii.live().peers.count() === 1, { timeout: 10000 });
      assert.equal((await peersOf(a))[0].name, 'Bo');
      assert.equal(await a.$eval('#hud-here', (e) => e.textContent), '1 here');
    });
    await check('walking on one page moves the @ on the other', async () => {
      await b.evaluate(() => { const r = window.__ascii.map.rooms[1]; window.__ascii.walkTo(r.entry.x, r.entry.y); });
      await sleep(2500);
      const bAt = await b.evaluate(() => ({ x: window.__ascii.world.player.x, y: window.__ascii.world.player.y }));
      const seen = (await peersOf(a))[0];
      assert.ok(Math.hypot(seen.x - bAt.x, seen.y - bAt.y) < 1.5, `seen at ${seen.x},${seen.y}, really ${bAt.x},${bAt.y}`);
    });
    await check('pressing 1 shows a heart over that person on the other page', async () => {
      await b.focus('#stage');
      await b.keyboard.press('Digit1');
      await a.waitForFunction(() => window.__ascii.live().peers.list(performance.now())[0]?.emote === '♥', { timeout: 3000 });
    });
    await check('H at a print floats a heart from that frame on the other page', async () => {
      const fid = await b.evaluate(() => { const f = window.__ascii.map.frames[0]; window.__ascii.teleport(f.stand.x + 0.5, f.stand.y + 0.5); return f.id; });
      await b.waitForFunction((id) => window.__ascii.world.focus?.id === id, {}, fid);
      await sleep(2100); // past the local heart limit from earlier checks
      await b.keyboard.press('KeyH');
      await a.waitForFunction((id) => window.__ascii.live().peers.hearts(performance.now()).some((h) => h.f === id), { timeout: 3000 }, fid);
    });
    await check('typing in the name field sends no emotes and opens nothing', async () => {
      await a.focus('#stage');
      await a.keyboard.press('KeyN');
      await a.waitForSelector('#name-form:not([hidden])');
      await a.keyboard.type('5gmh');
      await sleep(400);
      assert.equal(await b.evaluate(() => window.__ascii.live().peers.list(performance.now())[0]?.emote ?? null), null);
      assert.equal(await a.evaluate(() => window.__ascii.grid.isOpen), false);
      await a.keyboard.press('Enter');
      await b.waitForFunction(() => window.__ascii.live().peers.list(performance.now())[0]?.name === '5gmh', { timeout: 3000 });
    });
    await check('tapping the other @ follows them', async () => {
      const target = await b.evaluate(() => ({ x: Math.floor(window.__ascii.world.player.x), y: Math.floor(window.__ascii.world.player.y) }));
      await a.evaluate((t) => window.__ascii.teleport(t.x - 6 + 0.5, t.y + 0.5), target);
      await sleep(600);
      await a.evaluate((t) => window.__ascii.tapCell(t.x, t.y), target);
      await sleep(4000);
      const aAt = await a.evaluate(() => ({ x: window.__ascii.world.player.x, y: window.__ascii.world.player.y }));
      assert.ok(Math.hypot(aAt.x - (target.x + 0.5), aAt.y - (target.y + 0.5)) < 3.5, `follower at ${aAt.x},${aAt.y}`);
    });
    await check('stopping the server leaves both galleries walkable', async () => {
      dev.kill();
      await sleep(1500);
      await a.focus('#stage');
      const before = await a.evaluate(() => window.__ascii.world.player.x);
      await a.keyboard.down('ArrowRight'); await sleep(500); await a.keyboard.up('ArrowRight');
      assert.notEqual(await a.evaluate(() => window.__ascii.world.player.x), before);
    });
    await check('no page errors', async () => assert.deepEqual(errors.filter((e) => !/WebSocket/.test(e)), []));
  });
} finally {
  dev.kill();
}
for (const [s, n, m] of results) console.log(`${s.padEnd(4)} ${n}${m ? ` — ${m}` : ''}`);
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
```

`package.json` scripts:
```json
    "e2e": "node e2e/run.mjs && node e2e/editor.mjs && node e2e/multiplayer.mjs",
    "e2e:live": "node e2e/multiplayer.mjs",
```

- [ ] **Step 2: Run it**

Run: `npm run e2e:live`
Expected: every line `ok`. A failure is a bug in Tasks 5–8, so fix it there using superpowers:systematic-debugging. Do not loosen the check.

- [ ] **Step 3: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; (cd server && npm test 2>&1 | grep -E "^ℹ (pass|fail)"); npm run e2e 2>&1 | grep -E "^FAIL"`
Expected: unit and server tests `fail 0`. In e2e, only the 30 fps frame-rate checks may fail, and only on battery.

- [ ] **Step 4: Commit**

```bash
git add e2e/multiplayer.mjs e2e/lib.mjs package.json
git commit -m "Multiplayer: two-browser e2e against the local Worker

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Deploy and live check

**Files:**
- Modify: `src/config.js` (`MULTIPLAYER.url`), `README.md`
- Create: `.github/workflows/server.yml`

This task is the outward-facing step. Pushing to main publishes it, as every gallery change so far has been.

- [ ] **Step 1: Deploy the Worker**

Run: `cd server && npx wrangler deploy 2>&1 | tail -5; cd ..`
Expected: `Deployed faiz-live` with a URL `https://faiz-live.<subdomain>.workers.dev`.

- [ ] **Step 2: Point the site at it**

In `src/config.js`, set `url: 'wss://faiz-live.<subdomain>.workers.dev'`, using the exact host from Step 1.

- [ ] **Step 3: Check origin enforcement on the real Worker**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.com" -H "Upgrade: websocket" https://faiz-live.<subdomain>.workers.dev/room/x/1`
Expected: `403`

- [ ] **Step 4: Add the deploy workflow**

`.github/workflows/server.yml`:
```yaml
# Deploys the multiplayer Worker (server/) when it changes. Needs the CLOUDFLARE_API_TOKEN repo secret
# (a Cloudflare API token with "Workers Scripts: Edit"); without it this job fails and server/ is deployed by hand.
name: Deploy multiplayer server

on:
  push:
    branches: [main]
    paths: ['server/**']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: 6fca9368b60e27ba01cc3a2cd4d0b620
```

`README.md`: add a "Multiplayer" section covering:
- the keys (1–5 emotes, H heart, N name, tap a person to follow);
- that `server/` is a Cloudflare Worker;
- that `MULTIPLAYER.enabled = false` turns it off;
- the `CLOUDFLARE_API_TOKEN` secret.

- [ ] **Step 5: Commit, pull, push**

```bash
git add src/config.js README.md .github/workflows/server.yml
git commit -m "Multiplayer: point the gallery at the deployed Worker; deploy server/ from Actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git pull --rebase && git push
```

- [ ] **Step 6: Live check**

After the Pages deploy finishes (`gh run watch`), open faiz.pics in puppeteer's Chrome and, at the same time, in the iPhone WebKit probe (`scratchpad/wk`).
Expected:
- each shows `1 here`;
- moving one moves the `@` on the other;
- `?debug` shows `net: live #1 · 1 peers · <n> ms`.

---

## Self-review notes

- **Spec coverage:**
  - §2 architecture: Tasks 2, 5 and 10
  - §3 protocol and checks: Tasks 1 and 2
  - §3 budget: the 5/s throttle in Task 3
  - §4 client, drawing, map, HUD and screen readers: Task 5
  - §4 emotes and hearts: Task 6
  - §4 names: Task 7
  - §4 follow: Task 8
  - §4 debug line: Task 5
  - §5 fake visitors: Task 5
  - §6 failures: Task 3 (backoff, giving up, a blocked constructor), Task 5 (hidden tab, empty url) and Task 9 (server stopped)
  - §7 testing: Tasks 1–4, 6 and 9
  - §8 deploy: Task 10
- **Rulings already taken** (the executor ledgers them):
  - Names use plain ASCII only (Global Constraints).
  - The per-IP limit uses a hashed-IP socket tag (not stored).
  - Server tests use `wrangler dev` with `ws` instead of vitest-pool-workers. A spike on 2026-10-13 showed wrangler dev 4 passes `CF-Connecting-IP` and `Origin` through, and it avoids pinning a vitest version.
  - `?live=` overrides the server only on localhost.
