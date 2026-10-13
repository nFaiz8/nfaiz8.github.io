import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idOf, normalizeEdits, parseEdits, serializeEdits, applyEdits } from '../src/edits.js';

test('idOf matches the pipeline ids', () => {
  assert.equal(idOf('DSCF7438.JPG'), 'dscf7438');
  assert.equal(idOf('Holiday 2024/DSCF7438.JPG'), 'holiday-2024-dscf7438');
  assert.equal(idOf('_DSF7064.JPG'), 'dsf7064');
  assert.equal(idOf('000017980006.jpg'), '000017980006');
  assert.equal(idOf('notes.txt'), 'notes-txt');
});

test('normalizeEdits keeps known, meaningful fields in a fixed order', () => {
  const out = normalizeEdits({
    b: { place: ' Lisbon ', film: true, stock: 'Portra 400', junk: 1 },
    a: { hidden: true },
    c: { film: false, stock: 'Gold 200', camera: '' }, // not film: no stock
    d: { date: '2025-8-2' }, // not YYYY-MM-DD
    e: { stock: 'HP5' }, // for a photo the build detects as film
  });
  assert.deepEqual(out, { a: { hidden: true }, b: { film: true, stock: 'Portra 400', place: 'Lisbon' }, c: { film: false }, e: { stock: 'HP5' } });
  assert.deepEqual(Object.keys(out), ['a', 'b', 'c', 'e']);
  assert.deepEqual(Object.keys(out.b), ['film', 'stock', 'place']);
});

test('serializeEdits is stable and ends with a newline', () => {
  assert.equal(
    serializeEdits({ z: { hidden: true }, a: { lens: 'XF 23mm' } }),
    '{\n  "a": {\n    "lens": "XF 23mm"\n  },\n  "z": {\n    "hidden": true\n  }\n}\n',
  );
  assert.equal(serializeEdits({}), '{}\n');
});

test('parseEdits: empty means none, malformed throws', () => {
  assert.deepEqual(parseEdits(''), {});
  assert.deepEqual(parseEdits(null), {});
  assert.deepEqual(parseEdits('{}'), {});
  assert.throws(() => parseEdits('{ nope'), SyntaxError);
  assert.throws(() => parseEdits('[]'), /object keyed by photo id/);
});

test('applyEdits overrides only what was edited', () => {
  const raw = [
    { id: 'scan1', category: 'digital', camera: null, lens: null, date: null, year: null, location: null, hidden: false },
    { id: 'dscf1', category: 'digital', camera: 'X-T5', lens: 'XF 23mm', date: '2024-05-01', year: 2024, location: null, hidden: false },
  ];
  const { photos, unmatched } = applyEdits(raw, {
    scan1: { film: true, stock: 'Portra 400', date: '2025-08-02', camera: 'Nikon FM2', lens: '50mm f/1.4', place: 'Lisbon' },
    dscf1: { hidden: true },
    gone: { hidden: true },
  });
  assert.deepEqual(photos[0], {
    id: 'scan1', category: 'film', filmStock: 'Portra 400', camera: 'Nikon FM2', lens: '50mm f/1.4',
    date: '2025-08-02', year: 2025, location: 'Lisbon', hidden: false,
  });
  assert.deepEqual(photos[1], { ...raw[1], hidden: true });
  assert.deepEqual(unmatched, ['gone']);
  assert.equal(raw[0].category, 'digital', 'input is not modified');
});

test('film without a stock still counts as film', () => {
  const [p] = applyEdits([{ id: 'a', category: 'digital' }], { a: { film: true } }).photos;
  assert.equal(p.category, 'film');
  assert.equal(p.filmStock, undefined);
});

test("film edits override the build's own film detection both ways", () => {
  const raw = [
    { id: 'scan', category: 'film', camera: null, scanner: 'Noritsu' },
    { id: 'scan2', category: 'film', camera: null, scanner: 'Noritsu' },
    { id: 'dig', category: 'digital', camera: 'X-T5' },
  ];
  const { photos } = applyEdits(raw, { scan: { film: false }, scan2: { stock: 'Portra 400' }, dig: { stock: 'HP5' } });
  assert.equal(photos[0].category, 'digital');
  assert.equal(photos[1].category, 'film');
  assert.equal(photos[1].filmStock, 'Portra 400');
  assert.equal(photos[2].filmStock, undefined, 'a stock alone does not make a digital photo film');
});
