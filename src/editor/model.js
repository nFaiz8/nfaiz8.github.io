// What the editor shows: one item per photo file in the repo plus pending uploads, with saved and
// pending edits combined. The repo, not the live site, decides what exists.
import { IMAGE, idOf, parseEdits } from '../edits.js';
import { applyOps } from './pending.js';
import { PHOTOS_DIR, EDITS_PATH } from './config.js';

export const pathId = (p) => idOf(p.slice(PHOTOS_DIR.length));

export async function loadRemote(gh) {
  const head = await gh.headSha();
  const tree = await gh.tree((await gh.commit(head)).tree.sha);
  const files = tree
    .filter((t) => t.type === 'blob' && t.path.startsWith(PHOTOS_DIR) && IMAGE.test(t.path))
    .filter((t) => !t.path.split('/').some((s) => s.startsWith('.'))) // the pipeline skips dot files too
    .map((t) => t.path);
  const entry = tree.find((t) => t.path === EDITS_PATH);
  let edits = {}, editsError = null;
  if (entry) {
    try { edits = parseEdits(await gh.blobText(entry.sha)); } catch (e) { editsError = e.message; }
  }
  return { head, files, edits, editsError };
}

export function buildItems({ manifest, files, saved, ops }) {
  const built = new Map((manifest?.photos || []).map((p) => [p.id, p]));
  const edits = applyOps(saved, ops.filter((o) => o.type === 'edit'));
  const deleting = new Set(ops.filter((o) => o.type === 'delete').map((o) => o.id));
  const pending = new Set(ops.map((o) => o.id));
  const base = [
    ...ops.filter((o) => o.type === 'upload').map((o) => ({ id: o.id, path: o.path, key: o.key, photo: null, isNew: true })),
    ...files.map((path) => ({ id: pathId(path), path, photo: built.get(pathId(path)) || null, isNew: false })),
  ];
  const dateOf = (it) => edits[it.id]?.date || it.photo?.date || '';
  return base
    .map((it) => ({
      ...it,
      edits: edits[it.id] || {},
      saved: saved[it.id] || {},
      building: !it.isNew && !it.photo,
      deleting: deleting.has(it.id),
      pending: pending.has(it.id),
    }))
    .sort((a, b) => b.isNew - a.isNew || dateOf(b).localeCompare(dateOf(a)) || a.id.localeCompare(b.id));
}

export function matches(item, filter) {
  switch (filter) {
    case 'film': return !!item.edits.film;
    case 'digital': return !item.edits.film;
    case 'hidden': return !!item.edits.hidden;
    case 'pending': return item.pending;
    default: return true;
  }
}

export function stockSuggestions(saved, ops) {
  const all = applyOps(saved, ops.filter((o) => o.type === 'edit'));
  return [...new Set(Object.values(all).map((e) => e.stock).filter(Boolean))].sort();
}

export const isLive = (manifest, since) => !!manifest?.generated && Date.parse(manifest.generated) > Date.parse(since);
