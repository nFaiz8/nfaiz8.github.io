import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItems, matches, stockSuggestions, isLive, loadRemote } from '../src/editor/model.js';

const manifest = { photos: [
  { id: 'a', date: '2024-01-01', src: { low: 'photos/low/a.webp' } },
  { id: 'b', date: '2025-01-01', src: { low: 'photos/low/b.webp' } },
  { id: 'gone', date: '2025-06-01' }, // built earlier, file since deleted
] };
const files = ['photos/A.jpg', 'photos/B.JPG', 'photos/C.jpg'];

test('buildItems: repo files are the truth, pending uploads first, then newest', () => {
  const ops = [
    { type: 'upload', id: 'new', path: 'photos/new.jpg', name: 'new.jpg', key: 'k', size: 1 },
    { type: 'edit', id: 'a', field: 'date', value: '2026-01-01' },
    { type: 'delete', id: 'b', path: 'photos/B.JPG' },
  ];
  const items = buildItems({ manifest, files, saved: { b: { film: true } }, ops });
  assert.deepEqual(items.map((i) => i.id), ['new', 'a', 'b', 'c']);
  const [n, a, b, c] = items;
  assert.ok(n.isNew && n.pending && !n.building && n.key === 'k');
  assert.equal(a.edits.date, '2026-01-01');
  assert.ok(a.pending && !a.deleting);
  assert.ok(b.deleting && b.edits.film);
  assert.deepEqual(b.saved, { film: true });
  assert.ok(c.building && c.photo === null);
});

test('filters', () => {
  const it = (edits, extra = {}) => ({ edits, pending: false, ...extra });
  assert.ok(matches(it({ film: true }), 'film'));
  assert.ok(!matches(it({ film: true }), 'digital'));
  assert.ok(matches(it({}), 'digital'));
  assert.ok(matches(it({ hidden: true }), 'hidden'));
  assert.ok(matches(it({}, { pending: true }), 'pending'));
  assert.ok(!matches(it({}), 'pending'));
  assert.ok(matches(it({}), 'all'));
});

test('stockSuggestions lists stocks in use, pending ones included', () => {
  const saved = { a: { film: true, stock: 'Portra 400' }, b: { film: true, stock: 'Gold 200' }, c: { film: true, stock: 'Portra 400' } };
  const ops = [{ type: 'edit', id: 'd', field: 'film', value: true }, { type: 'edit', id: 'd', field: 'stock', value: 'HP5' }];
  assert.deepEqual(stockSuggestions(saved, ops), ['Gold 200', 'HP5', 'Portra 400']);
});

test('isLive once the site was built after the commit', () => {
  assert.ok(isLive({ generated: '2026-10-13T12:05:00.000Z' }, '2026-10-13T12:00:00Z'));
  assert.ok(!isLive({ generated: '2026-10-13T11:59:00.000Z' }, '2026-10-13T12:00:00Z'));
  assert.ok(!isLive(null, '2026-10-13T12:00:00Z'));
});

test('loadRemote lists photo files and reads edits.json', async () => {
  const gh = {
    headSha: async () => 'c1',
    commit: async () => ({ tree: { sha: 't1' } }),
    tree: async () => [
      { path: 'photos', type: 'tree' },
      { path: 'photos/A.jpg', type: 'blob', sha: '1' },
      { path: 'photos/edits.json', type: 'blob', sha: 'e' },
      { path: 'photos/.DS_Store', type: 'blob', sha: '2' },
      { path: 'photos/.hidden/x.jpg', type: 'blob', sha: '3' },
      { path: 'src/main.js', type: 'blob', sha: '4' },
    ],
    blobText: async () => '{"a":{"hidden":true}}',
  };
  const r = await loadRemote(gh);
  assert.deepEqual(r, { head: 'c1', files: ['photos/A.jpg'], edits: { a: { hidden: true } }, editsError: null });
  gh.blobText = async () => '{ broken';
  assert.match((await loadRemote(gh)).editsError, /JSON/);
});
