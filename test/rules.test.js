// test/rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, validVersion, cleanName, cleanText, parseMessage, newBuckets, take, newFlood, dropped, EMOTES } from '../server/rules.js';
import { takeShot, clampMove, senderClock, sentAt } from '../server/rules.js';

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
  assert.equal(cleanName('sam\u200b'), null, 'zero-width');
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

test('hi may carry where I am standing, so I appear in the right place before I move', () => {
  assert.deepEqual(parseMessage('{"t":"hi","name":"Sam","x":12.34,"y":5}'), { t: 'hi', name: 'Sam', x: 12.3, y: 5 });
  assert.equal(parseMessage('{"t":"hi","name":"Sam","x":-1,"y":5}'), null);
  assert.equal(parseMessage('{"t":"hi","name":"Sam","x":3}'), null, 'both or neither');
});

test('chat text: plain, at most 80 characters, and no blocked words, without tripping on innocent ones', () => {
  assert.equal(cleanText('  nice photo! '), 'nice photo!');
  assert.equal(cleanText(''), null);
  assert.equal(cleanText('a'.repeat(80)), 'a'.repeat(80));
  assert.equal(cleanText('a'.repeat(81)), null);
  assert.equal(cleanText('hi 😀'), null, 'outside the drawable set');
  assert.equal(cleanText('hi\nthere'), null);
  for (const ok of ['the cockpit view', 'spicy colours', 'rapeseed field', 'cumulus clouds', 'Dickens fan', 'document this', 'Scunthorpe'])
    assert.equal(cleanText(ok), ok, ok);
  for (const bad of ['fuck off', 'f.u.c.k off', 'f u c k', 'what a dick', 'sh1t', 'you cum', 'nazis'])
    assert.equal(cleanText(bad), null, bad);
  assert.equal(cleanText(7), null);
});

test('chat messages parse, and are limited to one every 2 s', () => {
  assert.deepEqual(parseMessage('{"t":"c","text":"hello"}'), { t: 'c', text: 'hello' });
  for (const bad of ['{"t":"c"}', '{"t":"c","text":5}', '{"t":"c","text":""}', `{"t":"c","text":"${'a'.repeat(81)}"}`]) assert.equal(parseMessage(bad), null, bad);
  const b = newBuckets(0);
  assert.equal(take(b, 'c', 0), true);
  assert.equal(take(b, 'c', 1500), false);
  assert.equal(take(b, 'c', 2000), true);
});

test('buckets saved before chat existed still work', () => {
  const old = newBuckets(0);
  delete old.c;
  assert.equal(take(old, 'c', 0), true);
});

test('arena messages parse; malformed ones do not', () => {
  assert.deepEqual(parseMessage('{"t":"ae"}'), { t: 'ae' });
  assert.deepEqual(parseMessage('{"t":"al","x":1}'), { t: 'al' });
  assert.deepEqual(parseMessage('{"t":"rs"}'), { t: 'rs' });
  assert.deepEqual(parseMessage(JSON.stringify({ t: 'a', x: 10.123, y: 27.5, vx: 30.04, vy: 0, f: 1, g: 1, i: 34, a: 0.789, ts: 1200 })),
    { t: 'a', x: 10.12, y: 27.5, vx: 30, vy: 0, f: 1, g: 1, i: 34, a: 0.79, ts: 1200 });
  for (const bad of [{ x: 170 }, { y: -2 }, { vx: 61 }, { f: 0 }, { g: 2 }, { i: 64 }, { i: 1.5 }, { a: 1.6 }, { ts: -1 }, { x: 'NaN' }])
    assert.equal(parseMessage(JSON.stringify({ t: 'a', x: 10, y: 20, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0, ...bad })), null, JSON.stringify(bad));
  assert.deepEqual(parseMessage('{"t":"f","x":12,"y":27.2,"a":3.1,"ts":5}'), { t: 'f', x: 12, y: 27.2, a: 3.1, ts: 5 });
  assert.equal(parseMessage('{"t":"f","x":12,"y":27.2,"a":3.2,"ts":5}'), null);
  assert.deepEqual(parseMessage('{"t":"m","k":"k","ts":5}'), { t: 'm', k: 'k', ts: 5 });
  assert.equal(parseMessage('{"t":"m","k":"x","ts":5}'), null);
  assert.deepEqual(parseMessage('{"t":"pk","n":2}'), { t: 'pk', n: 2 });
  assert.equal(parseMessage('{"t":"pk","n":16}'), null);
});

test('the worst-case a and f are under 200 bytes', () => {
  const a = { t: 'a', x: -0.99, y: -0.99, vx: -59.9, vy: -59.9, f: -1, g: 0, i: 63, a: -1.57, ts: 999999999 };
  const f = { t: 'f', x: -0.99, y: -0.99, a: -3.14, ts: 999999999 };
  assert.ok(JSON.stringify(a).length < 200 && JSON.stringify(f).length < 200);
  assert.ok(parseMessage(JSON.stringify(a)));
});

test('arena buckets: a 24 then 20/s; shots by the gun\'s cooldown; pk, m, ae/al, rs', () => {
  const b = newBuckets(0);
  let n = 0;
  while (take(b, 'a', 0)) n++;
  assert.equal(n, 24);
  assert.equal(take(b, 'a', 50), true);
  let s = 0;
  for (let k = 0; k < 5; k++) if (takeShot(b, 'deagle', 10 * k)) s++;
  assert.equal(s, 2, 'five shots in 40 ms: two get through');
  assert.equal(takeShot(b, 'deagle', 400), true, 'refilled after one cooldown (1.15 / 0.4 = 2.9/s)');
  const r = newBuckets(0);
  let rs = 0;
  for (let t = 0; t < 1000; t += 10) if (takeShot(r, 'rifle', t)) rs++;
  assert.ok(rs >= 12 && rs <= 14, `rifle ${rs}/s`);
  for (const [k, cap] of [['pk', 2], ['m', 2], ['ae', 4], ['rs', 2]]) {
    const q = newBuckets(0);
    let c = 0;
    while (take(q, k, 0)) c++;
    assert.equal(c, cap, k);
  }
});

test('a move faster than 60 cells/s (with slack) is clamped along its line', () => {
  assert.deepEqual(clampMove({ x: 10, y: 10 }, { x: 12, y: 11 }, 67), { x: 12, y: 11 });
  const c = clampMove({ x: 10, y: 10 }, { x: 60, y: 10 }, 100);
  assert.ok(Math.abs(c.x - (10 + 60 * 0.1 * 1.25 + 0.5)) < 1e-9);
  const d = clampMove({ x: 10, y: 10 }, { x: 40, y: 25 }, 100); // along the same line
  assert.ok(Math.abs((d.y - 10) / (d.x - 10) - 0.5) < 1e-9);
});

test('a sender clock running ahead is held to 300 ms', () => {
  const clk = senderClock();
  assert.equal(sentAt(clk, 0, 1000), 1000);
  assert.equal(sentAt(clk, 67, 1067), 1067);
  assert.equal(sentAt(clk, 5000, 1134), 1434, 'claims 5 s, gets 300 ms');
  for (let t = 1200; t < 8000; t += 67) sentAt(clk, t - 1000 + 20, t); // the network gets 20 ms faster
  assert.ok(Math.abs(sentAt(clk, 7000, 8020) - 8000) <= 21);
});

test('a sender clock that jumps ahead and stays there is followed again', () => {
  const clk = senderClock();
  for (let t = 1000; t < 1500; t += 67) sentAt(clk, t - 1000, t);
  let last;
  for (let t = 1500; t <= 31500; t += 67) last = sentAt(clk, t, t) - t; // offset is now 1000 ms ahead
  assert.ok(Math.abs(last) <= 1, `settled at ${last}`);
});

test('a client clock running 8% fast does not stick at +300', () => {
  const clk = senderClock();
  let last;
  for (let t = 1000; t <= 41000; t += 67) last = sentAt(clk, Math.round((t - 1000) * 1.08), t) - t;
  assert.ok(last <= 300 && last >= -1000, `got ${last}`);
  assert.notEqual(clk.base, Infinity);
});

test('a quiet window does not break the sender clock', () => {
  const clk = senderClock();
  sentAt(clk, 0, 1000);
  assert.equal(sentAt(clk, 20000, 21000), 21000, 'first sample after a long quiet gap');
  for (let t = 21067; t < 30000; t += 67) sentAt(clk, t - 1000, t);
  assert.ok(Math.abs(sentAt(clk, 30000, 31000) - 31000) <= 1);
});
