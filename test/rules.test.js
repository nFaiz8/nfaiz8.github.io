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
