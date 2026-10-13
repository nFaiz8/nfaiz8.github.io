// One Save = one commit on main. Photos go up as blobs first (once); then the tree and edits.json
// are built on the current head. If main moved meanwhile (another device, or a push from a
// computer) the ref update fails with 422 and the commit is rebuilt on the new head, once.
import { EDITS_PATH, PHOTOS_DIR } from './config.js';
import { IMAGE, parseEdits, serializeEdits } from '../edits.js';
import { pathId } from './model.js';
import { applyOps, commitMessage } from './pending.js';

export async function save({ gh, ops, readBase64, onProgress = () => {} }) {
  const uploads = ops.filter((o) => o.type === 'upload');
  const blobs = new Map();
  for (const [i, o] of uploads.entries()) {
    onProgress(`Uploading ${i + 1} of ${uploads.length}…`);
    blobs.set(o.path, await gh.createBlob(await readBase64(o.key)));
  }
  onProgress('Committing…');
  for (let attempt = 0; ; attempt++) {
    const head = await gh.headSha();
    const baseTree = (await gh.commit(head)).tree.sha;
    const tree = new Map((await gh.tree(baseTree)).map((t) => [t.path, t]));
    const saved = tree.has(EDITS_PATH) ? parseEdits(await gh.blobText(tree.get(EDITS_PATH).sha)) : {};
    const entries = [];
    for (const o of uploads) {
      // Same content already there: an earlier attempt landed but its reply was lost.
      if (tree.get(o.path)?.sha === blobs.get(o.path)) continue;
      if (tree.has(o.path)) {
        throw Object.assign(new Error(`${o.path} was added from somewhere else while you were editing. Undo that upload, add it again (it will get a new name) and save.`), { status: 409 });
      }
      entries.push({ path: o.path, mode: '100644', type: 'blob', sha: blobs.get(o.path) });
    }
    for (const o of ops) if (o.type === 'delete' && tree.has(o.path)) entries.push({ path: o.path, mode: '100644', type: 'blob', sha: null });
    // Edits made here for a photo that is gone by now (deleted elsewhere) are dropped, not orphaned.
    const exists = new Set([...tree.keys()].filter((p) => p.startsWith(PHOTOS_DIR) && IMAGE.test(p)).map(pathId));
    for (const o of uploads) exists.add(o.id);
    const next = applyOps(saved, ops);
    for (const o of ops) if (o.type === 'edit' && !exists.has(o.id)) delete next[o.id];
    entries.push({ path: EDITS_PATH, mode: '100644', type: 'blob', content: serializeEdits(next) });
    const commit = await gh.createCommit(commitMessage(ops), await gh.createTree(baseTree, entries), head);
    try {
      await gh.updateRef(commit.sha);
      return { sha: commit.sha, date: commit.committer.date };
    } catch (e) {
      if (e.status !== 422 || attempt > 0) throw e;
    }
  }
}
