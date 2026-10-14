// server/test/server.test.js: runs the Worker locally (wrangler dev) and talks to it like browsers would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import fs from 'node:fs';
import { parseLevel, levelHash } from '../../src/level.js';
import { muzzleOf } from '../../src/fight.js';

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

test('where someone said hi from is where others first see them', async () => {
  const r = room();
  const a = client({ room: r }); await a.opened;
  a.send2({ t: 'hi', name: 'Ann', x: 40.5, y: 12.5 }); await a.next('welcome');
  const b = client({ room: r }); await b.opened;
  b.send2({ t: 'hi', name: 'Bo', x: 7, y: 8 });
  const wb = await b.next('welcome');
  assert.deepEqual(wb.peers.map((p) => [p.x, p.y]), [[40.5, 12.5]]);
  const j = await a.next('join');
  assert.deepEqual([j.x, j.y], [7, 8]);
  a.close(); b.close();
});

test('chat reaches everyone else; blocked words are refused; one message every 2 s', async () => {
  const r = room();
  const a = client({ room: r }); await a.opened;
  a.send2({ t: 'hi', name: 'Ann' }); await a.next('welcome');
  const b = client({ room: r }); await b.opened;
  b.send2({ t: 'hi', name: 'Bo' });
  const wb = await b.next('welcome');
  await a.next('join');
  b.send2({ t: 'c', text: '  nice photo ' });
  assert.deepEqual(await a.next('c'), { t: 'c', id: wb.id, text: 'nice photo' });
  assert.equal(b.inbox.filter((m) => m.t === 'c').length, 0, 'nobody hears their own chat');
  b.send2({ t: 'c', text: 'too soon' });
  await new Promise((s) => setTimeout(s, 2100));
  b.send2({ t: 'c', text: 'f u c k' });
  await b.next('chat-rejected');
  await new Promise((s) => setTimeout(s, 300));
  assert.equal(a.inbox.filter((m) => m.t === 'c').length, 0, 'neither the early nor the blocked message arrived');
  a.close(); b.close();
});

// Arena PvP: fighters enter, fire, strike, pick up guns and respawn.
const LEVEL_TEXT = fs.readFileSync(new URL('../../src/arena.txt', import.meta.url), 'utf8');
const LV = parseLevel(LEVEL_TEXT);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function fighter(r, name, ip) {
  const ws = client({ room: r, ip });
  await ws.opened;
  ws.send2({ t: 'hi', name });
  const w = await ws.next('welcome');
  ws.id = w.id;
  ws.send2({ t: 'ae' });
  ws.aw = await ws.next('aw');
  ws.t0 = Date.now();
  return ws;
}
const at = (ws, x, y, o = {}) => ws.send2({ t: 'a', x, y, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: Date.now() - ws.t0, ...o });
const fire = (ws, x, y = 27.5, a = 0) => { const m = muzzleOf(x, y, 1, 0, 'deagle'); ws.send2({ t: 'f', x: +m.x.toFixed(2), y: +m.y.toFixed(2), a, ts: Date.now() - ws.t0 }); };

// The door: the bottom 3 rows of the east wall (src/layout.js). A body standing in it is centred here.
const DOOR = { x: LV.cols - 0.5, y: LV.rows - 1.5 };
// Legal steps from the door to (x, y): along the track bed under the floor, then up or down.
function steps(x, y) {
  const out = [];
  let cx = DOOR.x, cy = DOOR.y;
  while (cx !== x) { cx = Math.abs(x - cx) <= 20 ? x : cx + 20 * Math.sign(x - cx); out.push([cx, cy]); }
  while (cy !== y) { cy = Math.abs(y - cy) <= 20 ? y : cy + 20 * Math.sign(y - cy); out.push([cx, cy]); }
  return out;
}
async function walk(ws, x, y) {
  at(ws, DOOR.x, DOOR.y);
  for (const [px, py] of steps(x, y)) { await sleepMs(300); at(ws, px, py); }
}
// Walk fighters in to their spots, then out and back in (al, ae): back from away, the first state may
// start where they were, so they stand there fresh and protected. Everyone's inbox is cleared after.
async function walkIn(spots, also = []) {
  await Promise.all(spots.map(([ws, x, y]) => walk(ws, x, y)));
  await sleepMs(50);
  for (const [ws] of spots) { ws.send2({ t: 'al' }); ws.send2({ t: 'ae' }); }
  for (const [ws, x, y] of spots) { ws.aw = await ws.next('aw'); ws.t0 = Date.now(); at(ws, x, y); }
  await sleepMs(150);
  for (const ws of [...spots.map(([w]) => w), ...also]) ws.inbox.length = 0;
}
// The next state from id that passes ok.
async function nextA(ws, id, ok = () => true, ms = 2000) {
  for (;;) { const m = await ws.next('a', ms); if (m.id === id && ok(m)) return m; }
}

test('welcome carries the level hash', async () => {
  const ws = client({ room: room() });
  await ws.opened;
  ws.send2({ t: 'hi', name: '' });
  assert.equal((await ws.next('welcome')).fight, levelHash(LEVEL_TEXT));
  ws.close();
});

test('two fighters entering get aw and aj; someone outside gets none of it', async () => {
  const r = room();
  const out = client({ room: r });
  await out.opened; out.send2({ t: 'hi', name: '' }); await out.next('welcome');
  const a = await fighter(r, 'Ann');
  assert.deepEqual(a.aw.fighters, []);
  assert.equal(a.aw.lv, levelHash(LEVEL_TEXT));
  const b = await fighter(r, 'Bo');
  assert.equal(b.aw.fighters.length, 1);
  assert.equal((await a.next('aj')).id, b.id);
  await sleepMs(300);
  assert.ok(!out.inbox.some((m) => ['aw', 'aj', 'a', 's', 'h'].includes(m.t)), JSON.stringify(out.inbox));
  [a, b, out].forEach((w) => w.close());
});

test('a deagle shot hits a standing, unprotected target for 25; a ▓ in the way stops it; a protected target is not hit', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5], [b, 30.5, 27.5]]);
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(250);
  fire(a, 20.5);
  await assert.rejects(b.next('h', 600), 'B is protected for 1.5 s after entering');
  await sleepMs(1300);
  fire(a, 20.5);
  const h = await b.next('h', 2000);
  assert.deepEqual([h.id, h.by, h.d, h.hp], [b.id, a.id, 25, 75]);
  at(a, 30.5, 27.5); at(b, 45.5, 27.5);
  await sleepMs(500);
  fire(a, 30.5);
  await assert.rejects(b.next('h', 600), 'the pillar is in the way');
  a.close(); b.close();
});

test('a headshot reaches the wire: a shot from a row higher hits the head row for 50, with hs: 1', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5], [b, 30.5, 27.5]]);
  await sleepMs(1600);
  at(a, 20.5, 26.5, { g: 0 }); at(b, 30.5, 27.5);
  await sleepMs(150);
  fire(a, 20.5, 26.5); // the bullet flies at 26.2: 1.3 rows above B's centre
  const h = await b.next('h', 2000);
  assert.deepEqual([h.id, h.by, h.d, h.hp, h.hs], [b.id, a.id, 50, 50, 1]);
  a.close(); b.close();
});

test('five shots within 100 ms give at most two bullets', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  at(a, 60.5, 27.5);
  await sleepMs(100);
  for (let k = 0; k < 5; k++) fire(a, 60.5);
  await sleepMs(400);
  assert.ok(a.inbox.filter((m) => m.t === 's').length <= 2);
  a.close();
});

test('four deagle hits pop: k with kills 1; rs at 1 s is ignored, at 2 s gives sp at a marked spawn', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5], [b, 30.5, 27.5]]);
  await sleepMs(1600);
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(150);
  for (let k = 0; k < 4; k++) { fire(a, 20.5); await sleepMs(450); }
  const k = await a.next('k', 2000);
  assert.deepEqual([k.id, k.by, k.kills], [b.id, a.id, 1]);
  await sleepMs(1000);
  b.send2({ t: 'rs' });
  await assert.rejects(b.next('sp', 400));
  await sleepMs(800);
  b.send2({ t: 'rs' });
  const sp = await b.next('sp', 2000);
  assert.ok(LV.spawns.some((s) => s.x === sp.x && s.y === sp.y));
  a.close(); b.close();
});

test('a teleporting state is clamped', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5]], [b]);
  at(a, 20.5, 27.5);
  await sleepMs(100);
  at(a, 150.5, 27.5);
  const seen = await (async () => { for (;;) { const m = await b.next('a', 2000); if (m.x > 20.5) return m; } })();
  assert.ok(seen.x < 40, `seen at ${seen.x}`);
  a.close(); b.close();
});

test('leaving within 3 s of a hit gives the hitter the kill, fled', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5], [b, 30.5, 27.5]]);
  await sleepMs(1600);
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(150);
  fire(a, 20.5);
  await b.next('h', 2000);
  b.send2({ t: 'al' });
  const k = await a.next('k', 2000);
  assert.deepEqual([k.id, k.by, k.kills, k.fled], [b.id, a.id, 1, 1]);
  assert.equal((await a.next('ax')).id, b.id);
  a.close(); b.close();
});

test('a, f and m from someone not in the arena are dropped', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  const o = client({ room: r });
  await o.opened; o.send2({ t: 'hi', name: '' }); await o.next('welcome');
  o.send2({ t: 'a', x: 30.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0 });
  o.send2({ t: 'f', x: 33, y: 27.2, a: 0, ts: 0 });
  o.send2({ t: 'm', k: 'p', ts: 0 });
  await sleepMs(300);
  assert.ok(!a.inbox.some((m) => m.t === 'a' || m.t === 's' || m.t === 'mm'));
  a.close(); o.close();
});

test('a ground kick outside a combo comes back as a punch', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  at(a, 60.5, 27.5);
  await sleepMs(100);
  a.send2({ t: 'm', k: 'k', ts: Date.now() - a.t0 });
  assert.equal((await a.next('mm')).k, 'p');
  a.close();
});

test('pickups: within reach gives pk and w (rifle, 40); a second claim is refused; back after 10 s', async () => {
  const r = room();
  const p = LV.pickups.find((q) => q.gun === 'rifle');
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, p.x, p.y], [b, p.x + 0.5, p.y]]);
  at(a, p.x, p.y); at(b, p.x + 0.5, p.y);
  await sleepMs(150);
  a.send2({ t: 'pk', n: p.n });
  assert.deepEqual(await a.next('w'), { t: 'w', id: a.id, w: 'r', ammo: 40 });
  assert.equal((await b.next('w')).id, a.id, 'everyone in the arena hears the pickup');
  b.send2({ t: 'pk', n: p.n });
  await assert.rejects(b.next('w', 500));
  await sleepMs(9600);
  b.send2({ t: 'pk', n: p.n });
  assert.equal((await b.next('w', 2000)).id, b.id);
  a.close(); b.close();
});

test('40 rifle shots, then the next s carries w d, after a w message', async () => {
  const r = room();
  const p = LV.pickups.find((q) => q.gun === 'rifle');
  const a = await fighter(r, 'A');
  await walkIn([[a, p.x, p.y]]);
  at(a, p.x, p.y);
  await sleepMs(150);
  a.send2({ t: 'pk', n: p.n });
  await a.next('w');
  for (let k = 0; k < 41; k++) { const m = muzzleOf(p.x, p.y, 1, 0, 'rifle'); a.send2({ t: 'f', x: +m.x.toFixed(2), y: +m.y.toFixed(2), a: 0, ts: Date.now() - a.t0 }); await sleepMs(120); }
  await sleepMs(300);
  const ss = a.inbox.filter((m) => m.t === 's');
  assert.equal(ss.filter((m) => m.w === 'r').length, 40);
  assert.equal(ss.at(-1).w, 'd');
  assert.ok(a.inbox.some((m) => m.t === 'w' && m.w === 'd'));
  a.close();
});

test('a shot reaching a target inside its roll\'s dodge window does not hit', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5], [b, 30.5, 27.5]]);
  await sleepMs(1600);
  at(a, 20.5, 27.5); at(b, 30.5, 27.5);
  await sleepMs(150);
  at(b, 30.5, 27.5, { i: 32 });
  await sleepMs(60);
  fire(a, 20.5);
  await assert.rejects(b.next('h', 500));
  a.close(); b.close();
});

// Fix round 1: entry, pauses, backdated stamps and the dead.
test('a backdated state does not open the speed clamp', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 32.5]], [b]);
  await sleepMs(1000);
  at(a, 20.5, 32.5);
  await sleepMs(50);
  at(a, 20.5, 32.5, { ts: 0 });
  await sleepMs(100);
  at(a, 150.5, 32.5);
  const seen = await nextA(b, a.id, (m) => m.x > 20.5);
  assert.ok(seen.x < 33, `seen at ${seen.x}`);
  a.close(); b.close();
});

test('a pause banks no speed: an a 2.5 s on and 100 cells away is clamped', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 32.5]], [b]);
  await sleepMs(2500);
  at(a, 120.5, 32.5);
  const seen = await nextA(b, a.id, (m) => m.x > 20.5);
  assert.ok(seen.x < 45, `seen at ${seen.x}`);
  a.close(); b.close();
});

test('entering, the first state is clamped from the door: no jumping onto the sniper', async () => {
  const r = room();
  const p = LV.pickups.find((q) => q.gun === 'sniper');
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  at(a, p.x, p.y);
  const seen = await nextA(b, a.id);
  assert.ok(seen.x > 150 && seen.y > 25, `seen at ${seen.x}, ${seen.y}`);
  a.send2({ t: 'pk', n: p.n });
  await assert.rejects(a.next('w', 500));
  a.close(); b.close();
});

test('back from away, the first state may start where I left', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walk(a, 50.5, 32.5);
  await sleepMs(100);
  a.send2({ t: 'al' }); a.send2({ t: 'ae' });
  await a.next('aw'); a.t0 = Date.now();
  await b.next('aj');
  b.inbox.length = 0;
  at(a, 50.5, 32.5);
  assert.equal((await nextA(b, a.id)).x, 50.5);
  a.close(); b.close();
});

test('the door is open, the wall above it is not', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await sleepMs(300);
  at(a, 160.5, 32.5);
  assert.ok((await nextA(b, a.id)).x >= 160);
  await sleepMs(300);
  at(a, 160.5, 28.5);
  await assert.rejects(nextA(b, a.id, () => true, 500));
  a.close(); b.close();
});

test('a popped fighter coming back in respawns at once', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5], [b, 30.5, 27.5]]);
  await sleepMs(1600);
  for (let k = 0; k < 4; k++) { fire(a, 20.5); await sleepMs(450); }
  await b.next('k', 2000);
  b.send2({ t: 'al' }); b.send2({ t: 'ae' });
  await b.next('aw');
  const sp = await b.next('sp', 1000);
  assert.equal(sp.id, b.id);
  assert.ok(LV.spawns.some((s) => s.x === sp.x && s.y === sp.y));
  assert.equal((await a.next('sp')).id, b.id);
  a.close(); b.close();
});

test('a flood of states from a popped fighter closes the socket', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, 27.5], [b, 30.5, 27.5]]);
  await sleepMs(1600);
  for (let k = 0; k < 4; k++) { fire(a, 20.5); await sleepMs(450); }
  await b.next('k', 2000);
  for (let k = 0; k < 120; k++) at(b, 30.5, 27.5);
  assert.equal(await Promise.race([b.closed, sleepMs(3000).then(() => 'still open')]), 1008);
  a.close(); b.close();
});
