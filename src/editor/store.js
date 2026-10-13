// Keeps the token and unsaved changes in this browser: the token and the operation list in
// localStorage, files waiting to upload in IndexedDB. Every call tolerates storage being
// unavailable (private windows); the editor then still works but forgets on reload.
const TOKEN_KEY = 'faiz-editor-token';
const OPS_KEY = 'faiz-editor-ops';

export function loadToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function saveToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
export function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

export function loadOps() {
  try { const ops = JSON.parse(localStorage.getItem(OPS_KEY)); return Array.isArray(ops) ? ops : []; } catch { return []; }
}
export function saveOps(ops) { try { localStorage.setItem(OPS_KEY, JSON.stringify(ops)); } catch {} }

const memory = new Map(); // this session's files, in case IndexedDB is unavailable
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('faiz-editor', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function putFile(key, file) {
  memory.set(key, file);
  try { await tx('readwrite', (s) => s.put(file, key)); } catch {}
}
export async function getFile(key) {
  if (memory.has(key)) return memory.get(key);
  try { return (await tx('readonly', (s) => s.get(key))) || null; } catch { return null; }
}
// Forget files no pending upload refers to any more.
export async function pruneFiles(keep) {
  for (const k of [...memory.keys()]) if (!keep.has(k)) memory.delete(k);
  try {
    const keys = await tx('readonly', (s) => s.getAllKeys());
    await tx('readwrite', (s) => { for (const k of keys) if (!keep.has(k)) s.delete(k); });
  } catch {}
}
export async function readBase64(key) {
  const f = await getFile(key);
  if (!f) throw new Error('A photo waiting to upload is no longer stored in this browser. Undo it in Review, add it again and save.');
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  return url.slice(url.indexOf(',') + 1);
}
