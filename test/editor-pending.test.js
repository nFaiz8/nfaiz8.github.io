import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uniqueName, addEdit, addUpload, addDelete, undo, applyOps, summary, count, commitMessage, describeOp,
} from '../src/editor/pending.js';

test('uniqueName leaves free names alone and never reuses an id', () => {
  const taken = ['photos/DSCF1.JPG', 'photos/scan 2.jpg', 'photos/DSCF1-2.jpg'];
  assert.equal(uniqueName('DSCF9.JPG', taken), 'DSCF9.JPG');
  assert.equal(uniqueName('dscf1.jpg', taken), 'dscf1-3.jpg'); // dscf1 and dscf1-2 are taken
  assert.equal(uniqueName('scan_2.jpg', taken), 'scan_2-2.jpg'); // same id as "scan 2.jpg"
  assert.equal(uniqueName('noext', []), 'noext');
});

test('addEdit keeps one op per field and drops ones that match what is saved', () => {
  const saved = { a: { film: true, stock: 'Gold 200' } };
  let ops = addEdit([], saved, 'b', 'hidden', true);
  assert.deepEqual(addEdit(ops, saved, 'b', 'hidden', false), []);
  ops = addEdit([], saved, 'a', 'stock', 'Portra 400');
  ops = addEdit(ops, saved, 'a', 'stock', 'Portra 160');
  assert.deepEqual(ops, [{ type: 'edit', id: 'a', field: 'stock', value: 'Portra 160' }]);
  assert.deepEqual(addEdit(ops, saved, 'a', 'stock', 'Gold 200'), []);
  assert.deepEqual(addEdit([], saved, 'a', 'film', false), [{ type: 'edit', id: 'a', field: 'film', value: null }]);
  assert.deepEqual(addEdit([], saved, 'b', 'place', ''), []);
});

test('applyOps replays edits onto saved edits and drops deleted photos', () => {
  const ops = [
    { type: 'edit', id: 'a', field: 'film', value: null }, // film off: its stock goes too
    { type: 'edit', id: 'b', field: 'place', value: 'Lisbon' },
    { type: 'edit', id: 'c', field: 'hidden', value: true },
    { type: 'delete', id: 'c', path: 'photos/c.jpg' },
  ];
  assert.deepEqual(
    applyOps({ a: { film: true, stock: 'Gold 200' }, z: { lens: '50mm' } }, ops),
    { b: { place: 'Lisbon' }, z: { lens: '50mm' } },
  );
});

test('deleting a pending upload forgets it; undoing an upload forgets its edits', () => {
  let ops = addUpload([], { id: 'new', path: 'photos/new.jpg', name: 'new.jpg', key: 'k1', size: 10 });
  ops = addEdit(ops, {}, 'new', 'film', true);
  assert.deepEqual(addDelete(ops, 'new', 'photos/new.jpg'), []);
  assert.deepEqual(undo(ops, 0), []);
  assert.equal(undo(ops, 1).length, 1);
  const del = addDelete(addDelete([], 'old', 'photos/old.jpg'), 'old', 'photos/old.jpg');
  assert.deepEqual(del, [{ type: 'delete', id: 'old', path: 'photos/old.jpg' }]);
});

test('summary and commit message count photos, not fields', () => {
  const ops = [
    { type: 'upload', id: 'n1', path: 'photos/n1.jpg', name: 'n1.jpg', key: 'k', size: 1 },
    { type: 'edit', id: 'n1', field: 'film', value: true },
    { type: 'upload', id: 'n2', path: 'photos/n2.jpg', name: 'n2.jpg', key: 'k2', size: 1 },
    { type: 'delete', id: 'old', path: 'photos/old.jpg' },
    { type: 'edit', id: 'a', field: 'film', value: true },
    { type: 'edit', id: 'a', field: 'stock', value: 'Portra 400' },
  ];
  assert.deepEqual(summary(ops), { added: 2, deleted: 1, edited: 1 });
  assert.equal(count(ops), 4);
  assert.equal(commitMessage(ops), 'Edit photos: 2 added, 1 deleted, 1 edited');
  assert.equal(commitMessage([{ type: 'edit', id: 'a', field: 'hidden', value: true }]), 'Edit photos: 1 edited');
});

test('describeOp reads like a change list', () => {
  assert.equal(describeOp({ type: 'upload', name: 'n1.jpg' }), 'add n1.jpg');
  assert.equal(describeOp({ type: 'delete', id: 'old' }), 'delete old');
  assert.equal(describeOp({ type: 'edit', id: 'a', field: 'film', value: true }), 'a: film on');
  assert.equal(describeOp({ type: 'edit', id: 'a', field: 'hidden', value: null }), 'a: hidden off');
  assert.equal(describeOp({ type: 'edit', id: 'a', field: 'stock', value: 'Portra 400' }), 'a: stock → Portra 400');
  assert.equal(describeOp({ type: 'edit', id: 'a', field: 'date', value: null }), "a: date → photo's own");
});
