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
