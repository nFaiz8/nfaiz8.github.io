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

test('movement is drawn 250 ms behind, interpolating between updates', () => {
  const ps = createPeers();
  ps.apply({ t: 'join', id: 'a', name: '', x: 0, y: 0 }, 0);
  ps.apply({ t: 'p', id: 'a', x: 10, y: 0 }, 200);
  ps.apply({ t: 'p', id: 'a', x: 20, y: 0 }, 400);
  const at = (t) => ps.list(t)[0].x;
  assert.equal(at(450), 10, '450 - 250 = 200: exactly the second update');
  assert.equal(at(550), 15, 'halfway between 200 and 400');
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

test('losing the connection fades everyone out', () => {
  const ps = createPeers();
  ps.apply({ t: 'welcome', id: 'me', peers: [{ id: 'a', name: '', x: 0, y: 0 }, { id: 'b', name: '', x: 1, y: 1 }] }, 0);
  ps.dropAll(1000);
  assert.equal(ps.count(), 0);
  assert.ok(ps.list(2500).every((p) => Math.abs(p.alpha - 0.5) < 0.01));
  assert.deepEqual(ps.list(4100), []);
});

test('with positions arriving every 200 ms, a walking peer never stands still between updates', () => {
  const ps = createPeers();
  ps.apply({ t: 'join', id: 'a', name: '', x: 0, y: 0 }, 0);
  let next = 200, prev = -1;
  for (let now = 0; now <= 2000; now += 16) {
    while (next <= now) { ps.apply({ t: 'p', id: 'a', x: next / 100, y: 0 }, next); next += 200; }
    if (now < 600) continue;
    const x = ps.list(now)[0].x;
    assert.ok(x > prev, `held at ${x} at ${now} ms`);
    prev = x;
  }
});

test('what someone says shows for 5 s', () => {
  const ps = createPeers();
  ps.apply({ t: 'join', id: 'a', name: 'Ann', x: 0, y: 0 }, 0);
  ps.apply({ t: 'c', id: 'a', text: 'hello' }, 100);
  assert.equal(ps.list(5000)[0].say, 'hello');
  assert.equal(ps.list(5200)[0].say, null);
  ps.apply({ t: 'c', id: 'ghost', text: 'boo' }, 0);
  assert.equal(ps.list(0).length, 1);
});
