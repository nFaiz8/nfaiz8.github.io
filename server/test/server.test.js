// server/test/server.test.js: runs the Worker locally (wrangler dev) and talks to it like browsers would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import fs from 'node:fs';
import { parseLevel, levelHash, levelKind } from '../../src/level.js';
import { newBody, stepBody, DOUBLE_V, AIR_JUMPS } from '../../src/arena.js';
import { muzzleOf, FIGHT_VERSION } from '../../src/fight.js';

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

test('chat reaches everyone else; a swear is starred; a slur mutes the sender; one message every 2 s', async () => {
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
  b.send2({ t: 'c', text: 'oh shit' });
  assert.deepEqual(await a.next('c'), { t: 'c', id: wb.id, text: 'oh sh*t' });
  await new Promise((s) => setTimeout(s, 2100));
  b.send2({ t: 'c', text: 'f a g' });
  assert.equal((await b.next('chat-muted')).s, 600);
  await new Promise((s) => setTimeout(s, 2100));
  b.send2({ t: 'c', text: 'sorry' });
  await b.next('chat-muted');
  await new Promise((s) => setTimeout(s, 300));
  assert.equal(a.inbox.filter((m) => m.t === 'c').length, 2, 'the early, the slur and the muted one never arrived');
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
const fire = (ws, x, y = FLOOR, a = 0) => { const m = muzzleOf(x, y, 1, 0, 'deagle'); ws.send2({ t: 'f', x: +m.x.toFixed(2), y: +m.y.toFixed(2), a, ts: Date.now() - ws.t0 }); };

// The door: the level's D marker, on the floor line at the east end. A body standing in it is centred here.
const DOOR = { x: LV.door.x, y: LV.door.y };
const FLOOR = DOOR.y; // the car floors' line
// Legal steps from the door to (x, y): along the floor, then up or down.
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

test('the door is the level\'s D on the floor line at the east end, not the bottom-right corner', () => {
  assert.deepEqual(DOOR, { x: 203.5, y: 24.5 });
  assert.notEqual(DOOR.y, LV.rows - 1.5);
});

test('welcome carries the level hash', async () => {
  const ws = client({ room: room() });
  await ws.opened;
  ws.send2({ t: 'hi', name: '' });
  const w = await ws.next('welcome');
  assert.equal(w.fight, `${levelHash(LEVEL_TEXT)}.${FIGHT_VERSION}`);
  assert.equal(w.map, 'train');
  ws.close();
});

// The arena's map (gorge addendum): the site's, switched by an admin with the password, told to everyone.
test('an admin switches the map for every instance; a wrong password does nothing; /map tells a page', async () => {
  const r = room();
  const http = `http://127.0.0.1:${PORT}/map`;
  const getMap = async () => (await (await fetch(http, { headers: { Origin: 'https://faiz.pics' } })).json()).map;
  assert.equal((await fetch(http, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal(await getMap(), 'train');
  const admin = client({ room: r, n: 1 }), other = client({ room: r, n: 2 });
  await admin.opened; await other.opened;
  admin.send2({ t: 'hi', name: 'Ad' }); await admin.next('welcome');
  other.send2({ t: 'hi', name: 'Ot' }); await other.next('welcome');
  admin.send2({ t: 'am', map: 'gorge', pw: 'kazakh' });
  await admin.next('am-no');
  assert.equal(await getMap(), 'train');
  admin.send2({ t: 'am', map: 'moon', pw: 'uzbek' }); // no such map: dropped
  await sleepMs(300);
  assert.ok(!admin.inbox.some((m) => m.t === 'am-ok'));
  admin.send2({ t: 'am', map: 'gorge', pw: 'uzbek' });
  assert.equal((await admin.next('am-ok')).map, 'gorge');
  const gorgeHash = `${levelHash(fs.readFileSync(new URL('../../src/gorge.txt', import.meta.url), 'utf8'))}.${FIGHT_VERSION}`;
  assert.deepEqual(await admin.next('map'), { t: 'map', map: 'gorge', fight: gorgeHash });
  assert.deepEqual(await other.next('map'), { t: 'map', map: 'gorge', fight: gorgeHash }, 'another instance hears it');
  assert.equal(await getMap(), 'gorge');
  const late = client({ room: r, n: 3 }); await late.opened;
  late.send2({ t: 'hi', name: '' });
  const w = await late.next('welcome');
  assert.equal(w.map, 'gorge');
  assert.equal(w.fight, gorgeHash);
  // the fight is the gorge's: its door
  late.send2({ t: 'ae' });
  assert.equal((await late.next('aw')).lv, gorgeHash);
  await sleepMs(10500); // the am bucket: 3, then one every 10 s
  admin.send2({ t: 'am', map: 'train', pw: 'uzbek' });
  await admin.next('am-ok');
  assert.equal(await getMap(), 'train');
  admin.close(); other.close(); late.close();
});

test('two fighters entering get aw and aj; someone outside gets none of it', async () => {
  const r = room();
  const out = client({ room: r });
  await out.opened; out.send2({ t: 'hi', name: '' }); await out.next('welcome');
  const a = await fighter(r, 'Ann');
  assert.deepEqual(a.aw.fighters, []);
  assert.equal(a.aw.lv, `${levelHash(LEVEL_TEXT)}.${FIGHT_VERSION}`);
  const b = await fighter(r, 'Bo');
  assert.equal(b.aw.fighters.length, 1);
  assert.equal((await a.next('aj')).id, b.id);
  await sleepMs(300);
  assert.ok(!out.inbox.some((m) => ['aw', 'aj', 'a', 's', 'h'].includes(m.t)), JSON.stringify(out.inbox));
  [a, b, out].forEach((w) => w.close());
});

test('a deagle shot hits a standing, unprotected target for 25; the roof (▓) in the way stops it; a protected target is not hit', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  at(a, 20.5, FLOOR); at(b, 30.5, FLOOR);
  await sleepMs(250);
  fire(a, 20.5);
  await assert.rejects(b.next('h', 600), 'B is protected for 1.5 s after entering');
  await sleepMs(1300);
  fire(a, 20.5);
  const h = await b.next('h', 2000);
  assert.deepEqual([h.id, h.by, h.d, h.hp], [b.id, a.id, 25, 75]);
  // B up on car A's roof, right above: a shot at B from the floor meets the roof first.
  at(b, 30.5, 6.5);
  await sleepMs(500);
  const m = muzzleOf(20.5, FLOOR, 1, 0, 'deagle');
  fire(a, 20.5, FLOOR, Math.atan2((6.5 - m.y) * 2, 30.5 - m.x));
  await assert.rejects(b.next('h', 600), 'the roof is in the way');
  a.close(); b.close();
});

test('a headshot reaches the wire: a shot from a row higher hits the head row for 50, with hs: 1', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  await sleepMs(1600);
  at(a, 20.5, FLOOR - 1, { g: 0 }); at(b, 30.5, FLOOR);
  await sleepMs(150);
  fire(a, 20.5, FLOOR - 1); // the bullet flies 1.3 rows above B's centre
  const h = await b.next('h', 2000);
  assert.deepEqual([h.id, h.by, h.d, h.hp, h.hs], [b.id, a.id, 50, 50, 1]);
  a.close(); b.close();
});

test('five shots within 100 ms give at most two bullets', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  at(a, 60.5, FLOOR);
  await sleepMs(100);
  for (let k = 0; k < 5; k++) fire(a, 60.5);
  await sleepMs(400);
  assert.ok(a.inbox.filter((m) => m.t === 's').length <= 2);
  a.close();
});

test('four deagle hits pop: k with kills 1; rs at 1 s is ignored, at 2 s gives sp at a marked spawn', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  await sleepMs(1600);
  at(a, 20.5, FLOOR); at(b, 30.5, FLOOR);
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
  await walkIn([[a, 20.5, FLOOR]], [b]);
  at(a, 20.5, FLOOR);
  await sleepMs(100);
  at(a, 150.5, FLOOR);
  const seen = await (async () => { for (;;) { const m = await b.next('a', 2000); if (m.x > 20.5) return m; } })();
  assert.ok(seen.x < 40, `seen at ${seen.x}`);
  a.close(); b.close();
});

test('leaving within 3 s of a hit gives the hitter the kill, fled', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  await sleepMs(1600);
  at(a, 20.5, FLOOR); at(b, 30.5, FLOOR);
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
  o.send2({ t: 'a', x: 30.5, y: FLOOR, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0 });
  o.send2({ t: 'f', x: 33, y: 27.2, a: 0, ts: 0 });
  o.send2({ t: 'm', k: 'p', ts: 0 });
  await sleepMs(300);
  assert.ok(!a.inbox.some((m) => m.t === 'a' || m.t === 's' || m.t === 'mm'));
  a.close(); o.close();
});

test('a ground kick outside a combo comes back as a punch', async () => {
  const r = room();
  const a = await fighter(r, 'A');
  at(a, 60.5, FLOOR);
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
  // Down into the roof it stands on, so no more than the rifle's 7 are ever in flight.
  for (let k = 0; k < 41; k++) { const m = muzzleOf(p.x, p.y, 1, 0, 'rifle'); a.send2({ t: 'f', x: +m.x.toFixed(2), y: +m.y.toFixed(2), a: 1.2, ts: Date.now() - a.t0 }); await sleepMs(120); }
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
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  await sleepMs(1600);
  at(a, 20.5, FLOOR); at(b, 30.5, FLOOR);
  await sleepMs(150);
  at(b, 30.5, FLOOR, { i: 32 });
  await sleepMs(60);
  fire(a, 20.5);
  await assert.rejects(b.next('h', 500));
  a.close(); b.close();
});

test('a roll started 0.4 s after the last one began opens no dodge window: the shot inside it hits', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  await sleepMs(1600);
  at(a, 20.5, FLOOR); at(b, 30.5, FLOOR);
  await sleepMs(150);
  at(b, 30.5, FLOOR, { i: 32 });
  await sleepMs(60);
  fire(a, 20.5); // inside the first roll's dodge window: no hit
  await sleepMs(240);
  at(b, 30.5, FLOOR);
  await sleepMs(100);
  at(b, 30.5, FLOOR, { i: 32 }); // 0.4 s after the first: too soon
  await sleepMs(60);
  fire(a, 20.5);
  await sleepMs(600);
  const hs = b.inbox.filter((m) => m.t === 'h' && m.id === b.id);
  assert.equal(hs.length, 1, JSON.stringify(b.inbox.filter((m) => m.t === 'h' || m.t === 's')));
  a.close(); b.close();
});

test('a roll cut short by a jump, then another 0.5 s after it ended, still dodges', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  await sleepMs(1600);
  at(a, 20.5, FLOOR); at(b, 30.5, FLOOR);
  await sleepMs(150);
  at(b, 30.5, FLOOR, { i: 32 });
  await sleepMs(100);
  at(b, 30.5, FLOOR, { g: 0 }); // the jump out of the roll ends it
  await sleepMs(500);
  at(b, 30.5, FLOOR, { i: 32 }); // landed and rolling again, 0.5 s after the first roll ended
  await sleepMs(60);
  fire(a, 20.5);
  await assert.rejects(b.next('h', 500));
  a.close(); b.close();
});

// Fix round 1: entry, pauses, backdated stamps and the dead.
test('a backdated state does not open the speed clamp', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR]], [b]);
  await sleepMs(1000);
  at(a, 20.5, FLOOR);
  await sleepMs(50);
  at(a, 20.5, FLOOR, { ts: 0 });
  await sleepMs(100);
  at(a, 150.5, FLOOR);
  const seen = await nextA(b, a.id, (m) => m.x > 20.5);
  assert.ok(seen.x < 33, `seen at ${seen.x}`);
  a.close(); b.close();
});

test('a pause banks no speed: an a 2.5 s on and 100 cells away is clamped', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR]], [b]);
  await sleepMs(2500);
  at(a, 120.5, FLOOR);
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
  assert.ok(seen.x > p.x + 5 && Math.abs(seen.y - DOOR.y) < 1, `seen at ${seen.x}, ${seen.y}`);
  a.send2({ t: 'pk', n: p.n });
  await assert.rejects(a.next('w', 500));
  a.close(); b.close();
});

test('back from away, the first state may start where I left', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walk(a, 50.5, FLOOR);
  await sleepMs(100);
  a.send2({ t: 'al' }); a.send2({ t: 'ae' });
  await a.next('aw'); a.t0 = Date.now();
  await b.next('aj');
  b.inbox.length = 0;
  at(a, 50.5, FLOOR);
  assert.equal((await nextA(b, a.id)).x, 50.5);
  a.close(); b.close();
});

test('the door is open, the wall above it is not', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await sleepMs(300);
  at(a, LV.cols + 0.5, DOOR.y);
  assert.ok((await nextA(b, a.id)).x >= LV.cols);
  await sleepMs(300);
  at(a, LV.cols + 0.5, DOOR.y - 4);
  await assert.rejects(nextA(b, a.id, () => true, 500));
  a.close(); b.close();
});

test('a popped fighter coming back in respawns at once', async () => {
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
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
  await walkIn([[a, 20.5, FLOOR], [b, 30.5, FLOOR]]);
  await sleepMs(1600);
  for (let k = 0; k < 4; k++) { fire(a, 20.5); await sleepMs(450); }
  await b.next('k', 2000);
  for (let k = 0; k < 120; k++) at(b, 30.5, FLOOR);
  assert.equal(await Promise.race([b.closed, sleepMs(3000).then(() => 'still open')]), 1008);
  a.close(); b.close();
});

// The double jump (headshots and double jump addendum §2): the movement clamp still lets it through.
test('an honest full jump plus a double jump is passed on exactly as sent, never clamped', async () => {
  assert.equal(DOUBLE_V, 34);
  const r = room();
  const a = await fighter(r, 'A'), b = await fighter(r, 'B');
  await walkIn([[a, 60.5, FLOOR]], [b]);
  await sleepMs(300);
  // A full jump, then the air jump at its top, held: states every 4 steps of 1/60 s, as the page's ticker.
  const kinds = levelKind(LV), body = newBody(60.5, FLOOR), states = [];
  for (let i = 0; i < 12; i++) stepBody(body, 1 / 60, {}, kinds);
  for (let k = 0; k <= 84; k++) {
    const ms = (k * 1000) / 60;
    const jump = ms < 300 || (ms >= 320 && ms < 700);
    stepBody(body, 1 / 60, { jump }, kinds);
    if (k % 4 === 0) states.push({ ms, x: +body.x.toFixed(2), y: +body.y.toFixed(2), vx: 0, vy: +body.vy.toFixed(1), f: 1, g: body.onGround ? 1 : 0, i: jump ? 4 : 0, a: 0, air: body.airJumps });
  }
  assert.ok(states.some((s) => s.air < AIR_JUMPS) && Math.min(...states.map((s) => s.vy)) <= -30, 'the air jump was taken');
  const top = Math.min(...states.map((s) => s.y));
  assert.ok(FLOOR - top > 9, `it rose ${FLOOR - top} rows`);
  const start = Date.now(), base = start - a.t0;
  for (const s of states) {
    const wait = start + s.ms - Date.now();
    if (wait > 0) await sleepMs(wait);
    const { ms, air, ...m } = s;
    a.send2({ t: 'a', ...m, ts: Math.round(base + ms) });
  }
  await sleepMs(300);
  const seen = b.inbox.filter((m) => m.t === 'a' && m.id === a.id);
  assert.equal(seen.length, states.length, `${seen.length} of ${states.length} passed on`);
  for (const s of states) {
    const m = seen.find((q) => q.ts === Math.round(base + s.ms));
    assert.ok(m && m.x === s.x && m.y === s.y && m.vy === s.vy, `at ${s.ms.toFixed(0)} ms: sent ${s.y}, seen ${m && m.y}`);
  }
  a.close(); b.close();
});

// Areas (station spec, Multiplayer): one connection, in the gallery or the station; each hears only its own.
const sleepFor = (ms) => new Promise((s) => setTimeout(s, ms));
async function joined(r, name, hi = {}) {
  const c = client({ room: r }); await c.opened;
  c.send2({ t: 'hi', name, ...hi });
  c.w = await c.next('welcome');
  c.id = c.w.id;
  return c;
}

test('an old page that never sends z is in the gallery, and welcome says so, with the server clock and the station count', async () => {
  const r = room();
  const a = await joined(r, 'Ann');
  assert.equal(a.w.area, 'gallery');
  assert.equal(a.w.station, 0);
  assert.ok(Math.abs(a.w.now - Date.now()) < 5000, 'now is the server clock');
  const b = await joined(r, 'Bo');
  assert.deepEqual(b.w.peers.map((p) => p.name), ['Ann']);
  b.send2({ t: 'p', x: 3, y: 4 });
  assert.deepEqual(await a.next('p'), { t: 'p', id: b.id, x: 3, y: 4 });
  a.close(); b.close();
});

test('station: a rider\'s position aboard is relayed with its train', async () => {
  const r = room();
  const s1 = await joined(r, 'Sta', { area: 'station', x: 10, z: 9.5 });
  const s2 = await joined(r, 'Tia', { area: 'station' });
  s1.send2({ t: 'q', tr: 7, x: 30.004, z: -0.25, a: 0.5, s: 1 });
  assert.deepEqual(await s2.next('q'), { t: 'q', id: s1.id, tr: 7, x: 30, z: -0.25, a: 0.5, s: 1 });
});

test('messages are filtered by area: the gallery and the station hear only their own', async () => {
  const r = room();
  const g = await joined(r, 'Gal');
  const s1 = await joined(r, 'Sta', { area: 'station', x: 10.123, z: 9.5, y: -3, a: 1.5 });
  const s2 = await joined(r, 'Tia', { area: 'station' });
  assert.equal(s1.w.area, 'station');
  assert.deepEqual(s1.w.peers, [], 'nobody in the station yet');
  assert.deepEqual(s2.w.peers, [{ id: s1.id, name: 'Sta', x: 10.12, z: 9.5, y: -3, a: 1.5 }]);
  assert.equal((await s1.next('join')).name, 'Tia');
  s1.send2({ t: 'q', x: 11.004, z: 9.25, y: -3, a: -0.5 });
  assert.deepEqual(await s2.next('q'), { t: 'q', id: s1.id, x: 11, z: 9.25, y: -3, a: -0.5 });
  s1.send2({ t: 'c', text: 'down here' });
  assert.deepEqual(await s2.next('c'), { t: 'c', id: s1.id, text: 'down here' });
  s1.send2({ t: 'e', e: 'wave' });
  assert.deepEqual(await s2.next('e'), { t: 'e', id: s1.id, e: 'wave' });
  s1.send2({ t: 'n', name: 'Stan' });
  assert.deepEqual(await s2.next('n'), { t: 'n', id: s1.id, name: 'Stan' });
  g.send2({ t: 'c', text: 'up here' });
  g.send2({ t: 'p', x: 5, y: 5 });
  await sleepFor(400);
  const kinds = (c) => c.inbox.filter((m) => m.t !== 'zc').map((m) => m.t);
  assert.deepEqual(kinds(g), [], 'the gallery hears nothing from the station');
  assert.deepEqual(kinds(s1), [], 'the station hears nothing from the gallery');
  assert.deepEqual(kinds(s2), []);
  // A position for the area you're not in goes nowhere.
  s1.send2({ t: 'p', x: 1, y: 1 });
  g.send2({ t: 'q', x: 1, z: 1 });
  await sleepFor(300);
  assert.deepEqual([kinds(g), kinds(s2)], [[], []]);
  g.close(); s1.close(); s2.close();
});

test('moving area tells the old area you left and the new one you joined, where you are; you get who is there', async () => {
  const r = room();
  const g = await joined(r, 'Gal', { x: 20, y: 20 });
  const s = await joined(r, 'Sta', { area: 'station', x: 5, z: 9 });
  const m = await joined(r, 'Mo', { x: 30, y: 12 });
  await g.next('join');
  g.inbox.length = 0; s.inbox.length = 0;
  m.send2({ t: 'z', area: 'station', x: 2.5, z: 9.5, y: 0, a: 3.14 });
  const zw = await m.next('zw');
  assert.equal(zw.area, 'station');
  assert.deepEqual(zw.peers, [{ id: s.id, name: 'Sta', x: 5, z: 9 }]);
  assert.deepEqual(await g.next('leave'), { t: 'leave', id: m.id });
  assert.deepEqual(await s.next('join'), { t: 'join', id: m.id, name: 'Mo', x: 2.5, z: 9.5, y: 0, a: 3.14 });
  await sleepFor(200);
  assert.equal(s.inbox.filter((x) => x.t === 'leave').length, 0, 'the station hears no leave');
  assert.equal(g.inbox.filter((x) => x.t === 'join').length, 0, 'the gallery hears no join');
  // And back up: the station hears the leave, the gallery the join at the stairs.
  await sleepFor(1000);
  m.send2({ t: 'z', area: 'gallery', x: 12.5, y: 30.5 });
  const up = await m.next('zw');
  assert.deepEqual(up.peers, [{ id: g.id, name: 'Gal', x: 20, y: 20 }]);
  assert.deepEqual(await s.next('leave'), { t: 'leave', id: m.id });
  assert.deepEqual(await g.next('join'), { t: 'join', id: m.id, name: 'Mo', x: 12.5, y: 30.5 });
  // Closing from the station is a leave there only.
  await sleepFor(100);
  m.inbox.length = 0;
  s.close();
  assert.deepEqual(await m.next('zc'), { t: 'zc', station: 0 });
  await sleepFor(200);
  assert.equal(m.inbox.filter((x) => x.t === 'leave').length, 0, 'the gallery hears no leave from the station');
  g.close(); m.close();
});

test('z is validated: only known areas; and rate-limited by its own bucket', async () => {
  const r = room();
  const a = await joined(r, 'Ann');
  for (const bad of [{ t: 'z' }, { t: 'z', area: 'roof' }, { t: 'z', area: 'arena' }, { t: 'z', area: 'station', x: 'a', z: 1 }, { t: 'z', area: 'gallery', x: -5, y: 1 }]) a.send2(bad);
  await sleepFor(300);
  assert.equal(a.inbox.filter((m) => m.t === 'zw').length, 0, 'none of them moved');
  for (let i = 0; i < 6; i++) a.send2({ t: 'z', area: i % 2 ? 'gallery' : 'station' });
  await sleepFor(400);
  assert.equal(a.inbox.filter((m) => m.t === 'zw').length, 3, 'three in hand');
  await sleepFor(1100);
  a.send2({ t: 'z', area: 'station' });
  assert.equal((await a.next('zw')).area, 'station', 'one more a second later');
  // Positions in the station's bucket, not the move's.
  a.close();
});

test('station positions off the line, NaN or with a bad yaw are dropped', async () => {
  const r = room();
  const s1 = await joined(r, 'One', { area: 'station' });
  const s2 = await joined(r, 'Two', { area: 'station' });
  await s1.next('join');
  const bad = ['{"t":"q","x":NaN,"z":1}', { t: 'q', x: 1 }, { t: 'q', x: -700, z: 5 }, { t: 'q', x: 1500, z: 5 }, { t: 'q', x: 5, z: 20 }, { t: 'q', tr: 3, x: 80, z: 0 }, { t: 'q', tr: 3, x: 5, z: 2 },
    { t: 'q', x: 5, z: 5, y: -9 }, { t: 'q', x: 5, z: 5, y: 'up' }, { t: 'q', x: 5, z: 5, a: 7 }, { t: 'q', x: '5', z: 5 }];
  for (const m of bad) s2.send2(m);
  await sleepFor(300);
  assert.equal(s1.inbox.filter((m) => m.t === 'q').length, 0);
  s2.send2({ t: 'q', x: 840, z: 19, y: -4.2 }); // CANAL ST is on the line
  assert.deepEqual(await s1.next('q'), { t: 'q', id: s2.id, x: 840, z: 19, y: -4.2 });
  // A hi into the station from outside it doesn't get in.
  const c = client({ room: r }); await c.opened;
  c.send2({ t: 'hi', name: 'X', area: 'station', x: 2000, z: 1 });
  await sleepFor(300);
  assert.equal(c.inbox.filter((m) => m.t === 'welcome').length, 0);
  s1.close(); s2.close(); c.close();
});

test('the station count: in welcome, and zc to everyone when it changes', async () => {
  const r = room();
  const g = await joined(r, 'Gal');
  const s = await joined(r, 'Sta', { area: 'station' });
  assert.equal(s.w.station, 1);
  assert.deepEqual(await g.next('zc'), { t: 'zc', station: 1 });
  const m = await joined(r, 'Mo');
  assert.equal(m.w.station, 1);
  m.send2({ t: 'z', area: 'station' });
  assert.deepEqual(await g.next('zc'), { t: 'zc', station: 2 });
  assert.deepEqual(await s.next('zc'), { t: 'zc', station: 1 }, 'its own arrival');
  assert.deepEqual(await s.next('zc'), { t: 'zc', station: 2 });
  m.close();
  assert.deepEqual(await g.next('zc'), { t: 'zc', station: 1 });
  s.send2({ t: 'z', area: 'gallery' });
  assert.deepEqual(await g.next('zc'), { t: 'zc', station: 0 });
  // The same area again: its list again, no leave, join or count.
  g.inbox.length = 0;
  s.send2({ t: 'z', area: 'gallery' });
  assert.deepEqual((await s.next('zw')).peers.map((p) => p.name), ['Gal']);
  await sleepFor(300);
  assert.deepEqual(g.inbox, []);
  g.close(); s.close();
});

test('arena messages from the station are dropped', async () => {
  const r = room();
  const g = await joined(r, 'Gal');
  const s = await joined(r, 'Sta', { area: 'station' });
  g.send2({ t: 'ae' });
  await g.next('aw');
  s.send2({ t: 'ae' });
  await sleepFor(400);
  assert.equal(s.inbox.filter((m) => m.t === 'aw').length, 0);
  assert.equal(g.inbox.filter((m) => m.t === 'aj').length, 0);
  g.close(); s.close();
});
