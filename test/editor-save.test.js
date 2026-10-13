import { test } from 'node:test';
import assert from 'node:assert/strict';
import { save } from '../src/editor/save.js';

// An in-memory stand-in for the GitHub calls save() uses.
function memoryGitHub(files, editsText) {
  let n = 0;
  const g = { blobs: new Map(), trees: new Map(), commits: new Map(), head: 'c0', calls: [], raceOnce: null, failRef: null };
  const put = (text) => { const sha = `b${++n}`; g.blobs.set(sha, text); return sha; };
  const t0 = files.map((path) => ({ path, type: 'blob', mode: '100644', sha: put('img') }));
  if (editsText != null) t0.push({ path: 'photos/edits.json', type: 'blob', mode: '100644', sha: put(editsText) });
  g.trees.set('t0', t0);
  g.commits.set('c0', { sha: 'c0', tree: { sha: 't0' } });
  const mkTree = (base, entries) => {
    const map = new Map(g.trees.get(base).map((e) => [e.path, e]));
    for (const e of entries) {
      if (e.sha === null) map.delete(e.path);
      else map.set(e.path, { path: e.path, type: 'blob', mode: e.mode, sha: e.content != null ? put(e.content) : e.sha });
    }
    const sha = `t${++n}`;
    g.trees.set(sha, [...map.values()]);
    return sha;
  };
  g.push = (entries) => {
    const sha = `c${++n}`;
    g.commits.set(sha, { sha, tree: { sha: mkTree(g.commits.get(g.head).tree.sha, entries) }, parent: g.head });
    g.head = sha;
  };
  g.file = (path) => {
    const e = g.trees.get(g.commits.get(g.head).tree.sha).find((x) => x.path === path);
    return e && g.blobs.get(e.sha);
  };
  Object.assign(g, {
    headSha: async () => g.head,
    commit: async (sha) => g.commits.get(sha),
    tree: async (sha) => g.trees.get(sha),
    blobText: async (sha) => g.blobs.get(sha),
    createBlob: async (b64) => {
      g.calls.push('blob');
      const text = `base64:${b64}`;
      return [...g.blobs].find(([, t]) => t === text)?.[0] || put(text);
    },
    createTree: async (base, entries) => mkTree(base, entries),
    createCommit: async (message, tree, parent) => {
      const c = { sha: `c${++n}`, message, tree: { sha: tree }, parent, committer: { date: '2026-10-13T12:00:00Z' } };
      g.commits.set(c.sha, c);
      return c;
    },
    updateRef: async (sha) => {
      g.calls.push('ref');
      if (g.raceOnce) { const race = g.raceOnce; g.raceOnce = null; race(g); }
      if (g.failRef) throw g.failRef;
      if (g.commits.get(sha).parent !== g.head) throw Object.assign(new Error('Update is not a fast forward'), { status: 422 });
      g.head = sha;
    },
  });
  return g;
}

const readBase64 = async (key) => `data-of-${key}`;
const ops = [
  { type: 'upload', id: 'new', path: 'photos/new.jpg', name: 'new.jpg', key: 'k1', size: 1 },
  { type: 'edit', id: 'new', field: 'film', value: true },
  { type: 'edit', id: 'a', field: 'hidden', value: true },
  { type: 'delete', id: 'b', path: 'photos/b.jpg' },
];

test('save makes one commit with uploads, deletions and edits.json', async () => {
  const g = memoryGitHub(['photos/a.jpg', 'photos/b.jpg'], '{\n  "b": {\n    "lens": "50mm"\n  }\n}\n');
  const progress = [];
  const res = await save({ gh: g, ops, readBase64, onProgress: (t) => progress.push(t) });
  assert.equal(g.head, res.sha);
  assert.equal(res.date, '2026-10-13T12:00:00Z');
  assert.equal(g.commits.get(g.head).message, 'Edit photos: 1 added, 1 deleted, 1 edited');
  assert.equal(g.file('photos/new.jpg'), 'base64:data-of-k1');
  assert.equal(g.file('photos/b.jpg'), undefined);
  assert.equal(g.file('photos/edits.json'), '{\n  "a": {\n    "hidden": true\n  },\n  "new": {\n    "film": true\n  }\n}\n');
  assert.deepEqual(progress, ['Uploading 1 of 1…', 'Committing…']);
});

test('when main moves during save it rebuilds on the new head once, keeping the other edit', async () => {
  const g = memoryGitHub(['photos/a.jpg', 'photos/b.jpg', 'photos/c.jpg'], null);
  g.raceOnce = (gg) => gg.push([{ path: 'photos/edits.json', mode: '100644', type: 'blob', content: '{"c":{"place":"Elsewhere"}}' }]);
  await save({ gh: g, ops, readBase64 });
  assert.deepEqual(JSON.parse(g.file('photos/edits.json')), { a: { hidden: true }, c: { place: 'Elsewhere' }, new: { film: true } });
  assert.deepEqual(g.calls, ['blob', 'ref', 'ref'], 'photos are uploaded once');
});

test('a second race in a row gives up with the 422', async () => {
  const g = memoryGitHub(['photos/a.jpg', 'photos/b.jpg'], null);
  let races = 2;
  const race = (gg) => {
    gg.push([{ path: 'other.txt', mode: '100644', type: 'blob', content: String(races) }]);
    if (--races) gg.raceOnce = race;
  };
  g.raceOnce = race;
  await assert.rejects(save({ gh: g, ops, readBase64 }), (e) => e.status === 422);
});

test('a file deleted elsewhere is not deleted again; a name taken elsewhere stops the save', async () => {
  const g = memoryGitHub(['photos/a.jpg'], null); // b.jpg is already gone
  await save({ gh: g, ops, readBase64 });
  assert.equal(g.file('photos/new.jpg'), 'base64:data-of-k1');
  const h = memoryGitHub(['photos/a.jpg', 'photos/b.jpg', 'photos/new.jpg'], null);
  await assert.rejects(save({ gh: h, ops, readBase64 }), (e) => e.status === 409 && /photos\/new\.jpg was added/.test(e.message));
});

test('other errors (e.g. an expired token) pass straight through', async () => {
  const g = memoryGitHub(['photos/a.jpg', 'photos/b.jpg'], null);
  g.failRef = Object.assign(new Error('Bad credentials'), { status: 401 });
  await assert.rejects(save({ gh: g, ops, readBase64 }), (e) => e.status === 401);
  assert.equal(g.head, 'c0', 'nothing landed on main');
});

test('if main moved but the reply was lost, a retry does not refuse its own uploads', async () => {
  const g = memoryGitHub(['photos/a.jpg', 'photos/b.jpg'], null);
  const realRef = g.updateRef;
  g.updateRef = async (sha) => {
    await realRef(sha);
    g.updateRef = realRef;
    throw Object.assign(new Error('Network error: Failed to fetch'), { status: 0 });
  };
  await assert.rejects(save({ gh: g, ops, readBase64 }), (e) => e.status === 0);
  await save({ gh: g, ops, readBase64 });
  assert.equal(g.file('photos/new.jpg'), 'base64:data-of-k1');
  assert.deepEqual(JSON.parse(g.file('photos/edits.json')), { a: { hidden: true }, new: { film: true } });
});

test('edits for a photo that is gone by save time are dropped, not orphaned', async () => {
  const g = memoryGitHub(['photos/a.jpg'], '{"keep":{"lens":"50mm"}}');
  const edits = [
    { type: 'edit', id: 'a', field: 'hidden', value: true },
    { type: 'edit', id: 'gone', field: 'film', value: true },
  ];
  await save({ gh: g, ops: edits, readBase64 });
  assert.deepEqual(JSON.parse(g.file('photos/edits.json')), { a: { hidden: true }, keep: { lens: '50mm' } });
});
