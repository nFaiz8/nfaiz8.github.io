import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmInfo } from '../src/film.js';
import { groupByColor } from '../src/colors.js';

test('film is recognised from the scanner, the lab file name or a film/ folder', () => {
  assert.deepEqual(filmInfo('000091570014.jpg', 'NORITSU KOKI', 'EZ Controller'), { film: true, scanner: 'Noritsu' });
  assert.deepEqual(filmInfo('IMG_4927.JPG', 'NORITSU KOKI', 'QSS-32_33'), { film: true, scanner: 'Noritsu' });
  assert.equal(filmInfo('000017980006.jpg', undefined, undefined).film, true, 'lab number, no metadata');
  assert.equal(filmInfo('66240003.jpg', undefined, undefined).film, true);
  assert.equal(filmInfo('film/holiday.jpg', undefined, undefined).film, true);
});

test('digital photos are not film, even with their metadata stripped', () => {
  assert.equal(filmInfo('DSCF0188.jpg', 'FUJIFILM', 'GFX 50R').film, false, 'Fujifilm is a camera, not a Frontier');
  assert.equal(filmInfo('DSCF7409.png', undefined, undefined).film, false);
  assert.equal(filmInfo('IMG_1234.jpg', undefined, undefined).film, false);
});

test('all film hangs in the darkroom, colour or not; black & white digital goes to silver', () => {
  const p = (id, category, score) => ({ id, category, analysis: { hue: 20, sat: score, score, lum: 0.4 }, aspect: 1.5, width: 3, height: 2 });
  const rooms = groupByColor([p('f1', 'film', 0.9), p('f2', 'film', 0), p('d1', 'digital', 0.8), p('d2', 'digital', 0)]);
  const where = (id) => rooms.find((r) => r.photos.some((x) => x.id === id)).id;
  assert.equal(where('f1'), 'darkroom');
  assert.equal(where('f2'), 'darkroom');
  assert.equal(where('d2'), 'silver');
  assert.notEqual(where('d1'), 'darkroom');
});
