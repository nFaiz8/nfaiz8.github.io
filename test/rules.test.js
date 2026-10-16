// test/rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, validVersion, cleanName, cleanText, hasSlur, LIMITS, parseMessage, newBuckets, take, newFlood, dropped, EMOTES } from '../server/rules.js';
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

test('chat text: plain, at most 80 characters; swears get one letter starred, innocent words none', () => {
  assert.equal(cleanText('  nice photo! '), 'nice photo!');
  assert.equal(cleanText(''), null);
  assert.equal(cleanText('a'.repeat(80)), 'a'.repeat(80));
  assert.equal(cleanText('a'.repeat(81)), null);
  assert.equal(cleanText('hi 😀'), null, 'outside the drawable set');
  assert.equal(cleanText('hi\nthere'), null);
  for (const ok of ['the cockpit view', 'spicy colours', 'rapeseed field', 'cumulus clouds', 'Dickens fan', 'document this', 'Scunthorpe'])
    assert.equal(cleanText(ok), ok, ok);
  const starred = {
    'fuck off': 'f*ck off', 'f.u.c.k off': 'f.*.c.k off', 'f u c k': 'f * c k', 'what a dick': 'what a d*ck',
    'sh1t': 'sh*t', 'you cum': 'you c*m', 'nazis': 'n*zis', 'motherfucker': 'motherf*cker', 'fucking shit': 'f*cking sh*t',
    'BITCH please': 'B*TCH please', 'tits': 't*ts', '  Shit happens ': 'Sh*t happens',
  };
  for (const [bad, shown] of Object.entries(starred)) assert.equal(cleanText(bad), shown, bad);
  assert.equal(cleanText(7), null);
});

test('slurs are found (the sender is muted), through spacing and digit swaps; innocent look-alikes are not', () => {
  for (const bad of ['n1gger', 'you fag', 'faggot', 'r e t a r d', 'retarded', 'spics', 'chinks', 'coon', 'tranny', 'kikes'])
    assert.equal(hasSlur(bad), true, bad);
  for (const ok of ['raccoon', 'retardant', 'snigger', 'fagioli', 'spicy', 'fuck off', 'hello', '', 7])
    assert.equal(hasSlur(ok), false, String(ok));
  assert.equal(LIMITS.muteS, 600);
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
  for (const bad of [{ x: 216 }, { y: -2 }, { y: 114 }, { vx: 61 }, { f: 0 }, { g: 2 }, { i: 1024 }, { i: -1 }, { i: 1.5 }, { a: 1.6 }, { ts: -1 }, { x: 'NaN' }])
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

test('a and f are accepted anywhere in the biggest map (the gorge, 212 × 112) and a step through its door, refused past that', async () => {
  const { MAPS } = await import('../src/level.js');
  const { cols, rows } = MAPS.gorge;
  const a = (x, y) => parseMessage(JSON.stringify({ t: 'a', x, y, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0 }));
  const f = (x, y) => parseMessage(JSON.stringify({ t: 'f', x, y, a: 0, ts: 0 }));
  for (const [x, y] of [[203.5, 24.5], [cols + 0.5, 106.5], [cols + 2.9, 106.5], [100, rows - 0.5], [-0.9, -0.9]]) {
    assert.ok(a(x, y), `a at ${x}, ${y}`);
    assert.ok(f(x, y), `f at ${x}, ${y}`);
  }
  for (const [x, y] of [[cols + 3.5, 24.5], [100, rows + 1.5], [-1.5, 5]]) {
    assert.equal(a(x, y), null, `a at ${x}, ${y}`);
    assert.equal(f(x, y), null, `f at ${x}, ${y}`);
  }
});

test('a: the input bits go up to 1023 (64 crouched, 128 prone: the crouch addendum; 256 up, 512 on a ladder: the gorge addendum)', () => {
  for (const i of [64, 128, 128 | 8 | 2, 255, 256 | 4, 512 | 256, 1023]) {
    assert.equal(parseMessage(JSON.stringify({ t: 'a', x: 10, y: 20, vx: 0, vy: 0, f: 1, g: 1, i, a: 0, ts: 0 })).i, i);
  }
});

test('areas: hi may say the area; z moves between known areas; q is a station position to 0.01, inside the map', () => {
  assert.deepEqual(parseMessage('{"t":"hi","name":"A","area":"station","x":2.5,"z":9.5,"y":0,"a":1}'), { t: 'hi', name: 'A', area: 'station', x: 2.5, z: 9.5, y: 0, a: 1 });
  assert.deepEqual(parseMessage('{"t":"hi","area":"gallery","x":3,"y":4}'), { t: 'hi', name: '', x: 3, y: 4 });
  assert.equal(parseMessage('{"t":"hi","area":"roof"}'), null);
  assert.deepEqual(parseMessage('{"t":"z","area":"station"}'), { t: 'z', area: 'station' });
  assert.deepEqual(parseMessage('{"t":"z","area":"gallery","x":3.04,"y":4}'), { t: 'z', area: 'gallery', x: 3, y: 4 });
  assert.equal(parseMessage('{"t":"z","area":"arena"}'), null);
  assert.equal(parseMessage('{"t":"z"}'), null);
  assert.deepEqual(parseMessage('{"t":"q","x":1.234,"z":2,"y":-3,"a":-1.5}'), { t: 'q', x: 1.23, z: 2, y: -3, a: -1.5 });
  for (const bad of ['{"t":"q","x":1}', '{"t":"q","x":-700,"z":1}', '{"t":"q","x":1,"z":99}', '{"t":"q","x":1,"z":1,"y":-8}', '{"t":"q","x":1,"z":1,"a":4}', '{"t":"q","x":null,"z":1}', '{"t":"q","x":"1","z":1}', '{"t":"q","x":1e999,"z":1}'])
    assert.equal(parseMessage(bad), null, bad);
  const b = newBuckets(0);
  assert.deepEqual([take(b, 'z', 0), take(b, 'z', 0), take(b, 'z', 0), take(b, 'z', 0)], [true, true, true, false]);
  assert.equal(take(b, 'z', 1000), true, 'one more a second later');
});

test('station positions: anywhere on the line, or aboard a local in its frame', () => {
  assert.deepEqual(parseMessage('{"t":"q","x":850.5,"z":9.5}'), { t: 'q', x: 850.5, z: 9.5 }, 'CANAL ST is on the line');
  assert.equal(parseMessage('{"t":"q","x":2000,"z":9.5}'), null);
  assert.deepEqual(parseMessage('{"t":"q","tr":14,"x":30.123,"z":-0.5,"a":1,"s":1}'), { t: 'q', tr: 14, x: 30.12, z: -0.5, a: 1, s: 1 });
  assert.equal(parseMessage('{"t":"q","tr":14,"x":90,"z":0}'), null, 'off the end of the train');
  assert.equal(parseMessage('{"t":"q","tr":14,"x":30,"z":2}'), null, 'outside its width');
  assert.equal(parseMessage('{"t":"q","tr":1.5,"x":30,"z":0}'), null, 'a local is a whole number');
  assert.equal(parseMessage('{"t":"q","tr":14,"x":30,"z":0,"s":2}'), null);
  assert.deepEqual(parseMessage('{"t":"q","x":10.5,"z":9.5,"y":0,"a":1}'), { t: 'q', x: 10.5, z: 9.5, y: 0, a: 1 }, 'an old page is fine');
});
