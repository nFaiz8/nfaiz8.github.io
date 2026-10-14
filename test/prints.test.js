import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORE, parsePrints, applyPrints } from '../src/prints.js';

test('parsePrints keeps photo ids with a whole product number', () => {
  const out = parsePrints('{ "dscf8048": 1884902, "000013730028": "1930659", "bad": "x", "neg": -3, "frac": 1.5 }');
  assert.deepEqual(out, { dscf8048: 1884902, '000013730028': 1930659 });
});

test('parsePrints rejects text that is not a JSON object', () => {
  assert.throws(() => parsePrints('[1, 2]'));
  assert.throws(() => parsePrints('not json'));
});

test('applyPrints gives each listed photo its store link and reports ids with no photo', () => {
  const photos = [{ id: 'dscf8048', camera: 'X' }, { id: 'img-4927' }];
  const { photos: out, unmatched } = applyPrints(photos, { dscf8048: 1884902, gone: 5 });
  assert.equal(out[0].print, `${STORE}/products/1884902`);
  assert.equal(out[0].camera, 'X');
  assert.equal(out[1].print, undefined);
  assert.deepEqual(unmatched, ['gone']);
  assert.equal(photos[0].print, undefined, 'the input is not mutated');
});

test('the store is faiz.darkroom.com', () => {
  assert.equal(STORE, 'https://faiz.darkroom.com');
});
