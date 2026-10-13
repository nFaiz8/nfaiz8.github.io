// Unsaved changes, as a list of operations. Plain data, so they can be stored, tested and replayed
// onto a newer edits.json if main moves while saving.
//   { type: 'upload', id, path, name, key, size }   key = IndexedDB key of the File
//   { type: 'delete', id, path }
//   { type: 'edit', id, field, value }              value null removes the override
import { idOf, normalizeEdits } from '../edits.js';

// "IMG_1000.jpg" when photos/IMG_1000.jpg exists → "IMG_1000-2.jpg". Compares ids, so
// "scan_2.jpg" also clashes with "scan 2.jpg".
export function uniqueName(name, takenPaths) {
  const taken = new Set([...takenPaths].map((p) => idOf(p.replace(/^photos\//, ''))));
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let n = 2; taken.has(idOf(candidate)); n++) candidate = `${stem}-${n}${ext}`;
  return candidate;
}

// Setting a field back to what is already saved removes the pending change instead of adding one.
export function addEdit(ops, saved, id, field, value) {
  const v = value === '' || value === false || value == null ? null : value;
  const rest = ops.filter((o) => !(o.type === 'edit' && o.id === id && o.field === field));
  return v === (saved[id]?.[field] ?? null) ? rest : [...rest, { type: 'edit', id, field, value: v }];
}

export const addUpload = (ops, op) => [...ops, { type: 'upload', ...op }];

export function addDelete(ops, id, path) {
  if (ops.some((o) => o.type === 'upload' && o.id === id)) return ops.filter((o) => o.id !== id);
  if (ops.some((o) => o.type === 'delete' && o.id === id)) return ops;
  return [...ops, { type: 'delete', id, path }];
}

export function undo(ops, i) {
  const op = ops[i];
  if (op?.type === 'upload') return ops.filter((o) => o.id !== op.id);
  return ops.filter((_, j) => j !== i);
}

export function applyOps(saved, ops) {
  const out = structuredClone(saved);
  for (const o of ops) {
    if (o.type !== 'edit') continue;
    const e = (out[o.id] ||= {});
    if (o.value == null) delete e[o.field];
    else e[o.field] = o.value;
  }
  for (const o of ops) if (o.type === 'delete') delete out[o.id];
  return normalizeEdits(out);
}

export function summary(ops) {
  const added = new Set(), deleted = new Set(), edited = new Set();
  for (const o of ops) (o.type === 'upload' ? added : o.type === 'delete' ? deleted : edited).add(o.id);
  for (const id of [...added, ...deleted]) edited.delete(id);
  return { added: added.size, deleted: deleted.size, edited: edited.size };
}

export const count = (ops) => Object.values(summary(ops)).reduce((a, b) => a + b, 0);

export function commitMessage(ops) {
  const s = summary(ops);
  const parts = [[s.added, 'added'], [s.deleted, 'deleted'], [s.edited, 'edited']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`);
  return `Edit photos: ${parts.join(', ')}`;
}

export function describeOp(o) {
  if (o.type === 'upload') return `add ${o.name}`;
  if (o.type === 'delete') return `delete ${o.id}`;
  if (o.field === 'film' || o.field === 'hidden') return `${o.id}: ${o.field} ${o.value ? 'on' : 'off'}`;
  return `${o.id}: ${o.field} → ${o.value == null ? "photo's own" : o.value}`;
}
