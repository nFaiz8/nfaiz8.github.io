import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerEntities, heartEntities, peerColor, arenaTicker, createLive } from '../src/live.js';

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

import { positionTicker } from '../src/live.js';

test('my position goes out when it changes, including a teleport while standing still, and is retried if not sent', () => {
  const out = [];
  let accept = false;
  const tick = positionTicker((m) => { if (accept) out.push(m); return accept; });
  tick({ x: 10.5, y: 4.5 }, false);
  accept = true;
  tick({ x: 10.5, y: 4.5 }, false);
  assert.deepEqual(out, [{ t: 'p', x: 10.5, y: 4.5 }], 'a send that did not go out is retried');
  tick({ x: 10.5, y: 4.5 }, false);
  assert.equal(out.length, 1, 'standing still sends nothing');
  tick({ x: 80.5, y: 30.5 }, false);
  assert.deepEqual(out.at(-1), { t: 'p', x: 80.5, y: 30.5 }, 'a teleport after stopping is sent');
});

test('a line of chat shows above the @, pushing an emote up a row; muted people say nothing', () => {
  const p = { id: 'a', name: '', x: 10.5, y: 5.5, alpha: 1, emote: '!', emoteAge: 0, say: 'hi all' };
  const at = (es, y) => es.filter((e) => e.y === y).sort((m, n) => m.x - n.x).map((e) => e.glyph).join('');
  const es = peerEntities([p], { reducedMotion: true });
  assert.equal(at(es, 4.5), 'hi all');
  assert.equal(at(es, 3.5), '!');
  const muted = peerEntities([p], { reducedMotion: true, muted: new Set(['a']) });
  assert.equal(at(muted, 4.5), '!');
});

test('my own chat shows at once, at most one line every 2 s', () => {
  const echo = localEcho();
  assert.equal(echo.say('hello', 0), true);
  assert.equal(echo.say('again', 1000), false);
  const es = echo.entities({ x: 3.5, y: 3.5 }, [], 1500, { reducedMotion: true });
  assert.equal(es.filter((e) => e.y === 2.5).map((e) => e.glyph).join(''), 'hello');
  assert.equal(echo.entities({ x: 3.5, y: 3.5 }, [], 5200, { reducedMotion: true }).length, 0);
  assert.equal(echo.say('later', 2000), true);
});

test('a heart at the arena photo rises from whoever sent it, not from the ceiling', () => {
  const frames = [{ id: 'bg', x: 0, y: 0, w: 242, h: 52, backdrop: true }];
  const posOf = (id) => (id === 'p9' ? { x: 40.5, y: 30.5 } : null);
  const [h] = heartEntities([{ f: 'bg', id: 'p9', age: 0 }], frames, { posOf });
  assert.deepEqual([h.x, h.y, h.glyph], [40.5, 30.5 - 2.2, '♥']);
  const [later] = heartEntities([{ f: 'bg', id: 'p9', age: 0.5 }], frames, { posOf });
  assert.ok(later.y < h.y, 'rises');
  assert.deepEqual(heartEntities([{ f: 'bg', id: 'gone', age: 0 }], frames, { posOf }), [], 'sender gone: nothing');
});

const snap = (o = {}) => ({ x: 10, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0, ...o });

test('peerColor never returns a hue in the amber band (20°–60°)', () => {
  const hue = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (let i = 0; i < 2000; i++) { const h = hue(peerColor(`id${i}x${i * 7}`)); assert.ok(h < 20 - 1 || h > 60 + 1, `hue ${h}`); }
});

test('the arena ticker: at most 15 a second while moving, nothing while still', () => {
  const out = [];
  const tick = arenaTicker((m) => { out.push(m); return true; });
  for (let t = 0; t <= 1000; t += 1000 / 60) tick(snap({ x: 10 + t / 100, vx: 10, ts: Math.round(t) }), t);
  assert.ok(out.length >= 14 && out.length <= 16, `${out.length}`);
  out.length = 0;
  for (let t = 1000; t <= 2000; t += 1000 / 60) tick(snap({ x: 20, ts: Math.round(t) }), t);
  assert.ok(out.length <= 1, 'one last send when stopping at most');
  out.length = 0;
  for (let t = 2000; t <= 3000; t += 1000 / 60) tick(snap({ x: 20, ts: Math.round(t) }), t);
  assert.equal(out.length, 0);
});

test('urgent changes (input bits, ground, facing, knockback) go out after 30 ms, not after 67', () => {
  const out = [];
  const tick = arenaTicker((m) => { out.push(m); return true; });
  tick(snap({ x: 10, vx: 10 }), 0);
  tick(snap({ x: 10.2, vx: 10, i: 2 }), 16);
  assert.equal(out.length, 1, 'too soon: waits for the 30 ms mark');
  tick(snap({ x: 10.3, vx: 10, i: 2 }), 33);
  assert.equal(out.length, 2);
  assert.equal(out[1].i, 2);
  tick(snap({ x: 10.9, vx: 10, i: 2 }), 70, true);
  assert.equal(out.length, 3, 'a knockback is urgent');
});

test('never more than 20 a second, even with urgent changes every frame, at any frame rate', () => {
  for (const fps of [20, 60, 144]) {
    const out = [];
    const tick = arenaTicker((m) => { out.push(m); return true; });
    let i = 0;
    for (let t = 0; t <= 3000; t += 1000 / fps) tick(snap({ x: t / 100, i: (i++ % 2) * 2, ts: Math.round(t) }), t);
    const times = out.map((m) => m.ts);
    for (const t0 of times) assert.ok(times.filter((t) => t >= t0 && t < t0 + 1000).length <= 20, `${fps} fps`);
  }
});

test('a send that did not go out is retried', () => {
  let ok = false;
  const out = [];
  const tick = arenaTicker((m) => { if (ok) out.push(m); return ok; });
  tick(snap({ x: 11 }), 0);
  ok = true;
  tick(snap({ x: 11 }), 100);
  assert.equal(out.length, 1);
});

test('positionTicker.reset sends the same position again at once (leaving the arena)', () => {
  const out = [];
  const tick = positionTicker((m) => { out.push(m); return true; });
  tick({ x: 5, y: 5 });
  tick({ x: 5, y: 5 });
  tick.reset();
  tick({ x: 5, y: 5 });
  assert.equal(out.length, 2);
});

test('a heart at the arena photo rises from above the stickman\'s head', () => {
  const [h] = heartEntities([{ f: 'bd', id: 'a', age: 0 }], [{ id: 'bd', backdrop: true }], { posOf: () => ({ x: 5, y: 20 }) });
  assert.equal(h.y, 20 - 2.2);
});

// createLive against a stubbed WebSocket, location and addEventListener, restored afterwards.
function withLive(opts, fn) {
  const saved = {};
  const socks = [];
  const warns = [];
  const listeners = {};
  class FakeWS {
    constructor() { this.readyState = 1; this.sent = []; socks.push(this); }
    send(d) { this.sent.push(JSON.parse(d)); }
    close() {}
  }
  const stubs = { WebSocket: FakeWS, location: { hostname: 'localhost', search: '?live=ws://x' }, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, document: { hidden: false } };
  for (const k of Object.keys(stubs)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: stubs[k], configurable: true, writable: true }); }
  const warn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const live = createLive({ version: 'v', getName: () => '', getPos: () => null, onAnnounce() {}, onCount() {}, onRejected() {}, ...opts });
    const sock = socks[0];
    const say = (m) => sock.onmessage({ data: JSON.stringify(m) });
    const sentP = () => sock.sent.filter((m) => m.t === 'p');
    fn({ live, say, sock, warns, sentP, socks, fire: (t) => listeners[t].forEach((f) => f()) });
  } finally {
    console.warn = warn;
    for (const k of Object.keys(stubs)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
}

test('a welcome whose fight hash matches turns fighting on', () => {
  withLive({ fightHash: 'abc' }, ({ live, say, warns }) => {
    assert.equal(live.fightOk, false);
    say({ t: 'welcome', id: 'me', peers: [], fight: 'abc' });
    assert.equal(live.fightOk, true);
    assert.equal(warns.length, 0);
  });
});

test('an old server (no fight field) or a different hash means no fighting, with one warning', () => {
  withLive({ fightHash: 'abc' }, ({ live, say, warns }) => {
    say({ t: 'welcome', id: 'me', peers: [] });
    assert.equal(live.fightOk, false);
    assert.deepEqual(warns, ['arena: server level differs; no fighting']);
  });
  withLive({ fightHash: 'abc' }, ({ live, say, warns }) => {
    say({ t: 'welcome', id: 'me', peers: [], fight: 'zzz' });
    assert.equal(live.fightOk, false);
    assert.equal(warns.length, 1);
  });
});

test('with fighting off (no fight hash) a welcome warns of nothing; a hash that differs still warns', () => {
  for (const fightHash of ['', undefined]) {
    withLive({ fightHash }, ({ live, say, warns }) => {
      say({ t: 'welcome', id: 'me', peers: [], fight: 'abc' });
      say({ t: 'welcome', id: 'me', peers: [] });
      assert.equal(live.fightOk, false);
      assert.deepEqual(warns, []);
    });
  }
  withLive({ fightHash: 'abc' }, ({ say, warns }) => {
    say({ t: 'welcome', id: 'me', peers: [], fight: 'zzz' });
    assert.deepEqual(warns, ['arena: server level differs; no fighting']);
  });
});

test('chat-muted reaches onChatMuted with the seconds left; chat-rejected onChatRejected', () => {
  const got = [];
  withLive({ onChatMuted: (s) => got.push(['muted', s]), onChatRejected: () => got.push(['rejected']) }, ({ say }) => {
    say({ t: 'welcome', id: 'me', peers: [] });
    say({ t: 'chat-muted', s: 600 });
    say({ t: 'chat-rejected' });
  });
  assert.deepEqual(got, [['muted', 600], ['rejected']]);
});

test('arena message types reach onArena; positions and chat do not', () => {
  const got = [];
  withLive({ fightHash: 'abc', onArena: (m) => got.push(m.t) }, ({ say }) => {
    say({ t: 'welcome', id: 'me', peers: [], fight: 'abc' });
    for (const t of ['aw', 'aj', 'ax', 'a', 's', 'pk', 'w', 'mm', 'h', 'k', 'sp']) say({ t, id: 'x' });
    say({ t: 'p', id: 'x', x: 1, y: 1 });
    say({ t: 'e', id: 'x', e: 'heart' });
  });
  assert.deepEqual(got, ['aw', 'aj', 'ax', 'a', 's', 'pk', 'w', 'mm', 'h', 'k', 'sp']);
});

test('inside the arena no position goes out; after leftArena the next tick sends one at once', () => {
  let inside = true;
  withLive({ inArena: () => inside }, ({ live, say }) => {
    say({ t: 'welcome', id: 'me', peers: [] });
    const ps = [];
    const orig = live.net.send.bind(live.net);
    live.net.send = (m) => { if (m.t === 'p') ps.push(m); return orig(m); };
    live.tick({ x: 5, y: 5 });
    live.tick({ x: 6, y: 5 });
    assert.equal(ps.length, 0);
    inside = false;
    live.tick({ x: 6, y: 5 });
    assert.equal(ps.length, 1);
    live.tick({ x: 6, y: 5 });
    assert.equal(ps.length, 1, 'unchanged: nothing more');
    live.leftArena();
    live.tick({ x: 6, y: 5 });
    assert.equal(ps.length, 2, 'same position again at once');
  });
});

test('away: the tab coming back does not rejoin the net; back from away it does', () => {
  withLive({}, ({ live, socks, fire }) => {
    assert.equal(socks.length, 1);
    live.away(true);
    assert.equal(live.net.state, 'idle');
    fire('visibilitychange'); // the tab is visible again
    assert.equal(socks.length, 1, 'no new connection while away');
    assert.equal(live.net.state, 'idle');
    live.away(false);
    assert.equal(socks.length, 2, 'rejoins on the way back up');
  });
});
