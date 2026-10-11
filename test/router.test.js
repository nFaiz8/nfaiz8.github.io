import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, photoHash, roomHash } from '../src/router.js';

test('parses photo and room routes', () => {
  assert.deepEqual(parseRoute('#/photo/DSCF7438'), { kind: 'photo', id: 'DSCF7438' });
  assert.deepEqual(parseRoute('#/room/darkroom'), { kind: 'room', id: 'darkroom' });
  assert.deepEqual(parseRoute('#/photo/a%20b'), { kind: 'photo', id: 'a b' });
});

test('empty hashes are no route; anything else is unknown', () => {
  assert.equal(parseRoute(''), null);
  assert.equal(parseRoute('#'), null);
  assert.equal(parseRoute('#/'), null);
  assert.equal(parseRoute('#/about').kind, 'unknown');
  assert.equal(parseRoute('#/photo/%E0%A4%A').kind, 'unknown', 'bad escapes do not throw');
});

test('hash builders round-trip', () => {
  assert.deepEqual(parseRoute(photoHash('IMG 1/2')), { kind: 'photo', id: 'IMG 1/2' });
  assert.deepEqual(parseRoute(roomHash('x-series-3')), { kind: 'room', id: 'x-series-3' });
});
