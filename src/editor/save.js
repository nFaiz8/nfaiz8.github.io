// One Save = one commit on main. Photos go up as blobs first (once); then the tree and edits.json
// are built on the current head. If main moved meanwhile (another device, or a push from a
// computer) the ref update fails with 422 and the commit is rebuilt on the new head, once.
import { EDITS_PATH } from './config.js';
import { parseEdits, serializeEdits } from '../edits.js';
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
      if (tree.has(o.path)) {
        throw Object.assign(new Error(`${o.path} was added from somewhere else while you were editing. Undo that upload, add it again (it will get a new name) and save.`), { status: 409 });
      }
      entries.push({ path: o.path, mode: '100644', type: 'blob', sha: blobs.get(o.path) });
    }
    for (const o of ops) if (o.type === 'delete' && tree.has(o.path)) entries.push({ path: o.path, mode: '100644', type: 'blob', sha: null });
    entries.push({ path: EDITS_PATH, mode: '100644', type: 'blob', content: serializeEdits(applyOps(saved, ops)) });
    const commit = await gh.createCommit(commitMessage(ops), await gh.createTree(baseTree, entries), head);
    try {
      await gh.updateRef(commit.sha);
      return { sha: commit.sha, date: commit.committer.date };
    } catch (e) {
      if (e.status !== 422 || attempt > 0) throw e;
    }
  }
}
