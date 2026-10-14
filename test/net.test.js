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

test('hi carries my position, and send reports whether it went out', () => {
  const h = harness();
  const { net } = make(h, { getPos: () => ({ x: 40.5, y: 12.5 }) });
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].sent, [{ t: 'hi', name: 'Sam', x: 40.5, y: 12.5 }]);
  assert.equal(net.send({ t: 'e', e: 'heart' }), false, 'not welcomed yet');
  h.sockets[0].recv({ t: 'welcome', id: 'a', peers: [] });
  assert.equal(net.send({ t: 'e', e: 'heart' }), true);
});
