import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerEntities, heartEntities, peerColor } from '../src/live.js';

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
