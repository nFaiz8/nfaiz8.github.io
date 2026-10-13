// faiz.pics/edit/: manage the gallery from any browser. Changes queue up here and go to GitHub as
// one commit on Save; the Action then rebuilds the site. Design: docs/specs/2026-10-13-photo-editor-design.md
import { h } from './dom.js';
import { createGitHub } from './github.js';
import { loadRemote, buildItems, matches, stockSuggestions, isLive } from './model.js';
import { addEdit, addDelete, addUpload, setFilm, undo, uniqueName } from './pending.js';
import { save } from './save.js';
import { loadToken, saveToken, clearToken, loadOps, saveOps, putFile, getFile, pruneFiles, readBase64 } from './store.js';
import { idOf } from '../edits.js';
import { MANIFEST, LIVE_MANIFEST, PHOTOS_DIR, UPLOADABLE, WARN_BYTES, MAX_BYTES, OWNER, REPO } from './config.js';
import { tokenScreen } from './token.js';
import { toolbar, grid, selectBar } from './grid.js';
import { panel } from './panel.js';
import { bar } from './bar.js';

const app = document.getElementById('app');
const S = {
  gh: null, remote: null, manifest: null, ops: loadOps(),
  filter: 'all', selecting: false, selected: new Set(), bulkStock: '', open: null, confirm: null,
  adding: new Set(), // keys of files still being stored by addFiles
  previews: new Map(), notice: null, error: null,
  saving: false, progress: null, reviewing: false, live: null,
};
let liveTimer = null;

function render() {
  if (!S.remote) return;
  const items = buildItems({ manifest: S.manifest, files: S.remote.files, saved: S.remote.edits, ops: S.ops });
  const shown = items.filter((it) => matches(it, S.filter));
  S.order = shown.map((it) => it.id); // what the arrow keys step through
  const openItem = S.open && items.find((it) => it.id === S.open);
  // The panel has its own slot so it can be left in place: typing in one field and tapping the
  // next must not rebuild (or even move) the panel under the finger, which drops focus and
  // closes the phone keyboard. It is rebuilt on the next change made outside a text field.
  let view = app.querySelector(':scope > .view'), slot = app.querySelector(':scope > .panel-slot');
  if (!view || !slot) app.replaceChildren(view = h('div', { class: 'view' }), slot = h('div', { class: 'panel-slot' }));
  const old = slot.firstElementChild;
  const typing = document.activeElement?.matches?.('.panel input[type="text"], .panel input[type="date"]');
  if (!(old && typing && openItem && old.dataset.id === openItem.id)) {
    // Same photo, new panel (e.g. delete asking for a second tap): stay where the user was.
    // Read before the swap: a detached element reports scrollTop 0.
    const scroll = openItem && old?.dataset.id === openItem.id ? old.scrollTop : 0;
    const next = openItem && panel({ item: openItem, S, actions });
    slot.replaceChildren(...(next ? [next] : []));
    if (next) next.scrollTop = scroll;
  }
  view.replaceChildren(...[
    toolbar({ S, total: items.length, actions }),
    S.remote.editsError && h('p', { class: 'banner error' }, `photos/edits.json in the repo is not valid (${S.remote.editsError}). Fix it on GitHub; saving is off until then.`),
    S.notice && h('p', { class: 'banner', onclick: () => { S.notice = null; render(); } }, S.notice),
    S.selecting && selectBar({ S, actions }),
    grid({ items: shown, S, actions }),
    h('datalist', { id: 'stocks' }, stockSuggestions(S.remote.edits, S.ops).map((s) => h('option', { value: s }))),
    bar({ S, actions }),
  ].filter(Boolean));
}

// later: render on the next tick instead. A field edit commits on blur, before a tap on the next
// field has moved focus there; waiting lets render() see the user is still typing in the panel.
function setOps(ops, later = false) {
  S.ops = ops;
  saveOps(ops);
  const keys = new Set([...ops.filter((o) => o.type === 'upload').map((o) => o.key), ...S.adding]);
  for (const [k, url] of S.previews) if (!keys.has(k)) { URL.revokeObjectURL(url); S.previews.delete(k); }
  pruneFiles(keys);
  if (later) setTimeout(render);
  else render();
}

const saved = () => S.remote.edits;
// What the build detects (raw.json), so a film choice that matches it is stored as no override.
const autoFilm = (id) => S.manifest?.photos?.some((p) => p.id === id && p.category === 'film') || false;

const actions = {
  filter(f) { S.filter = f; render(); },
  open(id) {
    if (S.selecting) { if (!S.selected.delete(id)) S.selected.add(id); }
    else { S.open = id; S.confirm = null; }
    render();
  },
  close() { S.open = null; S.confirm = null; render(); },
  step(by) {
    const next = S.order?.[S.order.indexOf(S.open) + by];
    if (!next) return;
    S.open = next;
    S.confirm = null;
    render();
    document.querySelector(`.tile[data-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
  },
  edit(id, field, value) {
    setOps(field === 'film' ? setFilm(S.ops, saved(), id, value, '', autoFilm(id)) : addEdit(S.ops, saved(), id, field, value), true);
  },
  remove(id, path) {
    if (S.confirm !== `delete:${id}`) { S.confirm = `delete:${id}`; render(); return; }
    S.confirm = null;
    S.open = null;
    setOps(addDelete(S.ops, id, path));
  },
  toggleSelecting() { S.selecting = !S.selecting; S.selected.clear(); S.bulkStock = ''; S.open = null; render(); },
  bulk(kind, stock) {
    let ops = S.ops;
    for (const id of S.selected) {
      if (kind === 'film' || kind === 'digital') ops = setFilm(ops, saved(), id, kind === 'film', stock, autoFilm(id));
      if (kind === 'hide') ops = addEdit(ops, saved(), id, 'hidden', true);
      if (kind === 'unhide') ops = addEdit(ops, saved(), id, 'hidden', null);
    }
    S.selecting = false;
    S.selected.clear();
    S.bulkStock = '';
    setOps(ops);
  },
  addFiles,
  review() { S.reviewing = !S.reviewing; render(); },
  undo(i) { setOps(undo(S.ops, i)); },
  discard() {
    if (S.confirm !== 'discard') { S.confirm = 'discard'; render(); return; }
    S.confirm = null;
    S.reviewing = false;
    setOps([]);
  },
  save: doSave,
  signOut() { clearToken(); location.reload(); },
};

async function addFiles(files) {
  const taken = new Set([...S.remote.files, ...S.ops.filter((o) => o.type === 'upload').map((o) => o.path)]);
  const notes = [];
  const added = [];
  for (const [i, file] of files.entries()) {
    if (!UPLOADABLE.test(file.name)) { notes.push(`${file.name}: only JPEG, PNG or WebP can be uploaded here.`); continue; }
    if (file.size > MAX_BYTES) { notes.push(`${file.name}: over 100 MB, which GitHub won't accept.`); continue; }
    if (file.size > WARN_BYTES) notes.push(`${file.name}: over 25 MB. It will upload, but a smaller export is quicker.`);
    const name = uniqueName(file.name, taken);
    if (name !== file.name) notes.push(`${file.name} is already in the gallery, so this one will be added as ${name}.`);
    const path = PHOTOS_DIR + name;
    taken.add(path);
    const key = crypto.randomUUID();
    S.adding.add(key);
    S.notice = `adding ${i + 1} of ${files.length}…`;
    render();
    await putFile(key, file);
    S.previews.set(key, URL.createObjectURL(file));
    added.push({ id: idOf(name), path, name, key, size: file.size });
  }
  // Append to whatever S.ops is now: the user may have edited while the files were being stored.
  for (const k of added) S.adding.delete(k.key);
  S.notice = notes.join('\n') || null;
  setOps(added.reduce(addUpload, S.ops));
}

function explain(e) {
  if (e.status === 403 || e.status === 404) return `This token can't reach ${OWNER}/${REPO}. It needs Repository access: only ${REPO}, and Permissions: Contents → Read and write.`;
  if (e.status === 0) return `Couldn't reach GitHub (${e.message.replace(/^Network error: /, '')}). Check the connection and try again.`;
  return e.message;
}

function showToken(message) {
  S.remote = null;
  app.replaceChildren(tokenScreen({ message, onSubmit: signIn }));
}

async function signIn(token) {
  const gh = createGitHub(token);
  try {
    await gh.repo();
  } catch (e) {
    showToken(e.status === 401 ? 'GitHub refused that token. Check it was copied in full and has not expired.' : explain(e));
    return;
  }
  saveToken(token);
  S.gh = gh;
  await refresh();
}

function fail(e) {
  if (e.status === 401) {
    clearToken();
    showToken('GitHub refused the saved token (it may have expired or been revoked). Paste a new one; your unsaved changes are kept.');
    return;
  }
  S.error = explain(e);
  if (S.remote) render();
  else app.replaceChildren(h('section', { class: 'token' }, h('p', { class: 'error', role: 'alert' }, S.error), h('button', { type: 'button', class: 'btn', onclick: refresh }, 'retry')));
}

async function fetchJson(url) {
  try {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function refresh() {
  try {
    const [remote, manifest] = await Promise.all([loadRemote(S.gh), fetchJson(MANIFEST)]);
    S.remote = remote;
    S.manifest = manifest || { photos: [] };
    S.error = null;
  } catch (e) {
    fail(e);
    return;
  }
  for (const o of S.ops) {
    if (o.type !== 'upload' || S.previews.has(o.key)) continue;
    const f = await getFile(o.key);
    if (f) S.previews.set(o.key, URL.createObjectURL(f));
  }
  render();
}

async function doSave() {
  if (S.saving || !S.ops.length || S.remote.editsError) return;
  S.saving = true;
  S.error = null;
  S.reviewing = false;
  S.progress = 'starting…';
  render();
  try {
    const sent = S.ops;
    const res = await save({ gh: S.gh, ops: sent, readBase64, onProgress: (t) => { S.progress = t; render(); } });
    S.saving = false;
    setOps(S.ops.filter((o) => !sent.includes(o))); // changes made while saving wait for the next save
    watchLive(res.date);
    await refresh();
  } catch (e) {
    S.saving = false;
    fail(e);
    if (e.status === 409) await refresh();
  }
}

// After a save, poll the live manifest until a build newer than the commit is published.
function watchLive(since) {
  clearInterval(liveTimer);
  S.live = 'building';
  const started = Date.now();
  liveTimer = setInterval(async () => {
    if (isLive(await fetchJson(LIVE_MANIFEST), since)) {
      S.live = 'live';
      clearInterval(liveTimer);
      await refresh();
      return;
    }
    if (Date.now() - started > 15 * 60e3) { S.live = 'slow'; clearInterval(liveTimer); }
    render();
  }, 20e3);
}

// ← / → step through the photos in grid order while one is open (not while typing in a field).
document.addEventListener('keydown', (ev) => {
  if (!S.open || S.selecting || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (ev.target.closest?.('input, textarea, select')) return;
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
    ev.preventDefault();
    actions.step(ev.key === 'ArrowRight' ? 1 : -1);
  } else if (ev.key === 'Escape') {
    actions.close();
  }
});

const token = loadToken();
if (token) {
  S.gh = createGitHub(token);
  refresh();
} else {
  showToken();
}
