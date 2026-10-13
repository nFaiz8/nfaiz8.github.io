# Photo Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private page at `faiz.pics/edit/` where Faiz marks photos as film (with stock), hides, deletes, fixes details and uploads photos from any browser, saving everything as one commit to GitHub.

**Architecture:** Edits live in a committed `photos/edits.json`. The build (`scripts/prepare-photos.mjs`) applies it over the EXIF data on every run, using a raw manifest as its cache. The `/edit/` page is a second Vite entry: plain ES modules, no framework. It talks to the GitHub REST API with a fine-grained token stored in `localStorage`, queues changes as a list of operations (persisted in `localStorage` and IndexedDB), and on Save writes blobs, a tree, a commit and a ref update. If `main` moved meanwhile, it retries once.

**Tech Stack:** Vanilla JS (ES2022 modules), Vite 5 multi-page build, `node --test`, puppeteer (already a dev dependency) for browser checks, GitHub REST API (Git Data endpoints).

**Spec:** `docs/specs/2026-10-13-photo-editor-design.md`

## Global Constraints

- No new npm dependencies. Node 22 in CI (`.github/workflows/deploy.yml`); local is Node 24.
- The edit page loads no third-party scripts. Its built HTML carries the CSP `default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' blob: data:; style-src 'self'; script-src 'self'`. So never set `style` attributes or inline `<style>`/`<script>`; use classes or `el.style.x =` from JS.
- Repo constants: owner `nFaiz8`, repo `nfaiz8.github.io`, branch `main`, edits file `photos/edits.json`.
- The token is kept only in that browser's `localStorage`. It is never logged or sent anywhere but the GitHub API.
- One Save = exactly one commit on `main`.
- Uploads: JPEG, PNG, WebP only. Warn over 25 MB, reject over 100 MB.
- No GPS anywhere. The pipeline already strips metadata, so don't change that.
- Photo id = `idOf(path relative to photos/)`. It must match what the pipeline produces.
- `edits.json` fields: `film`, `stock`, `hidden`, `date` (`YYYY-MM-DD`), `camera`, `lens`, `place`. They are written in that order, ids sorted, 2-space indent, trailing newline.
- Code style: match the repo. Short header comment per module, sparse comments, 2-space indent, single quotes, semicolons.

## Review Focus

1. **Uploading a file whose name (or id) is already in the gallery**, e.g. `IMG_1000.jpg` when `photos/IMG_1000.jpg` exists, or `scan_2.jpg` vs `scan 2.jpg`. It must be renamed (`-2`, `-3`, …) and never overwrite. Tests: Task 4 `uniqueName`, Task 7 e2e "adds photos, renaming a clash".
2. **Closing or reloading the page before saving.** Pending edits *and* the uploaded files must survive. Test: Task 7 e2e "pending changes survive a reload".
3. **Token expires or is revoked between loading and saving.** The page goes back to the token screen and keeps the changes. Tests: Task 6 "other errors pass straight through", Task 7 e2e "an expired token…".
4. **Saving after another device pushed.** Both sets of edits must end up in `edits.json`, photos are uploaded only once, and it gives up after a second race. Tests: Task 6 race tests, Task 7 e2e save check.
5. **Turning Film off, or deleting a photo that has edits.** This must leave no stray `stock` and no orphan entry in `edits.json`. Tests: Task 1 `normalizeEdits`, Task 4 `applyOps`.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/edits.js` (new) | `IMAGE`, `idOf`, `FIELDS`, `normalizeEdits`, `parseEdits`, `serializeEdits`, `applyEdits`. Pure; used by the pipeline and the editor. |
| `scripts/prepare-photos.mjs` | Use `src/edits.js`; cache in `raw.json`; write the edited `photos.json`. |
| `src/config.js`, `src/main.js` | Remove `EXCLUDE`. |
| `.github/workflows/deploy.yml` | Add `src/edits.js` to the cache key. |
| `src/editor/config.js` (new) | Repo constants, limits, manifest paths, API base. |
| `src/editor/github.js` (new) | Minimal GitHub REST client, `GitHubError`, `decodeBase64Text`. |
| `src/editor/pending.js` (new) | Pending-operation model: add/undo/replay/summary/messages, `uniqueName`. |
| `src/editor/model.js` (new) | `loadRemote`, `buildItems`, `matches`, `stockSuggestions`, `isLive`. |
| `src/editor/save.js` (new) | One-commit save with one retry. |
| `src/editor/store.js` (new) | Token, ops (`localStorage`) and files (IndexedDB) persistence. |
| `src/editor/dom.js` (new) | `h()` element helper. |
| `src/editor/token.js`, `grid.js`, `panel.js`, `bar.js` (new) | UI pieces. |
| `src/editor/main.js` (new) | State, actions, sign-in, save flow, live polling. |
| `src/editor/editor.css` (new) | Editor styles. |
| `edit/index.html` (new) | Editor page. |
| `vite.config.js` | Multi-page input + build-only CSP for the editor. |
| `e2e/editor.mjs` (new), `package.json` | Browser checks against a fake GitHub. |
| `README.md` | How to use the editor. |

---

### Task 1: Shared edits module

**Files:**
- Create: `src/edits.js`
- Test: `test/edits.test.js`

**Interfaces:**
- Produces:
  - `IMAGE: RegExp` (image file extensions).
  - `idOf(rel: string): string`.
  - `FIELDS: string[]`.
  - `normalizeEdits(edits: object): object`.
  - `parseEdits(text: string|null): object`. Throws `SyntaxError` on bad JSON and `Error('… object keyed by photo id')` on a non-object.
  - `serializeEdits(edits: object): string`.
  - `applyEdits(photos: object[], edits: object): { photos: object[], unmatched: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `test/edits.test.js`:

```js
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
    c: { film: false, stock: 'Gold 200', camera: '' }, // stock without film is dropped
    d: { date: '2025-8-2' }, // not YYYY-MM-DD
  });
  assert.deepEqual(out, { a: { hidden: true }, b: { film: true, stock: 'Portra 400', place: 'Lisbon' } });
  assert.deepEqual(Object.keys(out), ['a', 'b']);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/edits.test.js`
Expected: FAIL with `Cannot find module '…/src/edits.js'`.

- [ ] **Step 3: Implement `src/edits.js`**

```js
// Per-photo edits from photos/edits.json, applied over what the pipeline reads from the files.
// Shared by scripts/prepare-photos.mjs (Node) and the /edit/ page (browser): no Node APIs here.

export const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif|avif)$/i;

// "Holiday 2024/DSCF7438.JPG" → "holiday-2024-dscf7438"; ids stay unique and URL-safe.
export const idOf = (rel) => rel.replace(IMAGE, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The order fields are written in. A missing field means "use what the photo file says".
export const FIELDS = ['film', 'stock', 'hidden', 'date', 'camera', 'lens', 'place'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function cleanOne(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const out = {};
  if (e.film === true) out.film = true;
  if (out.film && text(e.stock)) out.stock = text(e.stock);
  if (e.hidden === true) out.hidden = true;
  if (typeof e.date === 'string' && DATE.test(e.date)) out.date = e.date;
  for (const f of ['camera', 'lens', 'place']) if (text(e[f])) out[f] = text(e[f]);
  return Object.keys(out).length ? out : null;
}

export function normalizeEdits(edits) {
  const out = {};
  if (!edits || typeof edits !== 'object') return out;
  for (const id of Object.keys(edits).sort()) {
    const e = cleanOne(edits[id]);
    if (e) out[id] = e;
  }
  return out;
}

export const serializeEdits = (edits) => `${JSON.stringify(normalizeEdits(edits), null, 2)}\n`;

// An empty or missing file means no edits; anything unreadable throws.
export function parseEdits(textIn) {
  if (textIn == null || !textIn.trim()) return {};
  const j = JSON.parse(textIn);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('edits.json must be an object keyed by photo id');
  return normalizeEdits(j);
}

export function applyEdits(photos, edits) {
  const clean = normalizeEdits(edits);
  const ids = new Set(photos.map((p) => p.id));
  const unmatched = Object.keys(clean).filter((id) => !ids.has(id));
  const out = photos.map((p) => {
    const e = clean[p.id];
    if (!e) return p;
    const q = { ...p };
    if (e.film) {
      q.category = 'film';
      if (e.stock) q.filmStock = e.stock;
    }
    if (e.hidden) q.hidden = true;
    if (e.date) {
      q.date = e.date;
      q.year = Number(e.date.slice(0, 4));
    }
    if (e.camera) q.camera = e.camera;
    if (e.lens) q.lens = e.lens;
    if (e.place) q.location = e.place;
    return q;
  });
  return { photos: out, unmatched };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/edits.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/edits.js test/edits.test.js
git commit -m "Add shared photo edits module"
```

---

### Task 2: Pipeline applies `photos/edits.json`

**Files:**
- Modify: `scripts/prepare-photos.mjs` (imports, lines 21 and 26–30; output block lines 125–129)
- Modify: `src/config.js:8-9`, `src/main.js:1,195`
- Modify: `.github/workflows/deploy.yml` (cache key line)
- Modify: `README.md` ("Adding photos" bullet about hiding)

**Interfaces:**
- Consumes: `IMAGE`, `idOf`, `parseEdits`, `applyEdits` from `src/edits.js`.
- Produces:
  - `public/photos/raw.json`: `{ generated, photos }`, un-edited. The editor reads it for EXIF placeholders.
  - `public/photos/photos.json`: edited, sorted by date. The gallery reads it, and the editor polls its `generated`.

- [ ] **Step 1: Use the shared module in the pipeline**

In `scripts/prepare-photos.mjs`, replace the import of `analyzePixels` line with:

```js
import { analyzePixels } from '../src/analyze.js';
import { IMAGE, idOf, parseEdits, applyEdits } from '../src/edits.js';
```

Delete the local `const IMAGE = …` line (line 21) and the local `idOf` (the comment plus `const idOf = …`, lines 29–30).

Replace the `previous` loading (lines 26–27) with:

```js
// The cache is the un-edited manifest, so removing an edit really removes it.
// (Builds from before raw.json existed fall back to photos.json, which had no edits then.)
let previous = {};
for (const name of ['raw.json', 'photos.json']) {
  try {
    for (const p of JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8')).photos) previous[p.id] = p;
    break;
  } catch {}
}
```

- [ ] **Step 2: Apply edits when writing the manifests**

Replace these two lines:

```js
photos.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, 'photos.json'), JSON.stringify({ generated: new Date().toISOString(), photos }, null, 1));
```

with:

```js
// photos/edits.json (written by the /edit/ page) overrides film, stock, hidden, date, camera, lens and place.
let edits = {};
const editsFile = path.join(SRC, 'edits.json');
if (fs.existsSync(editsFile)) {
  try {
    edits = parseEdits(fs.readFileSync(editsFile, 'utf8'));
  } catch (e) {
    console.error(`photos: photos/edits.json is not valid (${e.message})`);
    process.exit(1);
  }
}
const generated = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify({ generated, photos }, null, 1));
const { photos: edited, unmatched } = applyEdits(photos, edits);
for (const id of unmatched) console.warn(`photos: edits.json has an entry for "${id}" but no such photo`);
edited.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, 'photos.json'), JSON.stringify({ generated, photos: edited }, null, 1));
```

Then change the two lines after it to count from `edited`:

```js
const bw = edited.filter((p) => p.analysis && p.analysis.score < 0.12).length;
console.log(`\rphotos: ${edited.length} ready (${made} new or changed, ${kept} unchanged${failed ? `, ${failed} skipped` : ''}); ${bw} black & white`);
if (!edited.length) console.log('photos: photos/ is empty; add images there and run again');
```

- [ ] **Step 3: Remove `EXCLUDE`**

In `src/config.js` delete the last two lines (the `EXCLUDE` comment and export). In `src/main.js` line 1 change `import { SITE, EXCLUDE } from './config.js';` to `import { SITE } from './config.js';`, and on line 195 change `data = await loadData(undefined, EXCLUDE);` to `data = await loadData();`. Leave `indexData`'s `exclude` parameter as it is; `test/data.test.js` still covers it.

- [ ] **Step 4: Cache key**

In `.github/workflows/deploy.yml` change the cache key line to:

```yaml
          key: photos-${{ hashFiles('photos/**', 'scripts/prepare-photos.mjs', 'src/analyze.js', 'src/edits.js') }}
```

- [ ] **Step 5: Run the pipeline against a temporary edits file and check the result**

```bash
cat > photos/edits.json <<'EOF'
{ "000017980006": { "film": true, "stock": "Portra 400", "place": "Test" }, "nope": { "hidden": true } }
EOF
npm run photos
node -e 'const j=require("./public/photos/photos.json");const r=require("./public/photos/raw.json");const p=j.photos.find(x=>x.id==="000017980006");const q=r.photos.find(x=>x.id==="000017980006");console.log(p.category,p.filmStock,p.location,"| raw:",q.category,q.filmStock,q.location)'
rm photos/edits.json
npm run photos
node -e 'const p=require("./public/photos/photos.json").photos.find(x=>x.id==="000017980006");console.log(p.category,p.filmStock)'
```

Expected:
- The first run prints a warning: `edits.json has an entry for "nope" but no such photo`.
- The first check prints `film Portra 400 Test | raw: digital undefined null`.
- The second run reports every photo as unchanged, with no resizing.
- The second check prints `digital undefined`, which shows that removing the edit really removes it.

Also check that bad JSON fails the build:

```bash
echo '{ nope' > photos/edits.json; npm run photos; echo "exit $?"; rm photos/edits.json
```

Expected: `photos: photos/edits.json is not valid (…)` and `exit 1`.

- [ ] **Step 6: Update the README**

In `README.md` replace the bullet starting `- To remove a photo, delete it from \`photos/\`. To hide one…` with:

```markdown
- To remove a photo, delete it from `photos/`. To hide one without deleting it, mark it hidden on the
  edit page (see below), which records it in `photos/edits.json`.
```

- [ ] **Step 7: Run all unit tests**

Run: `npm test`
Expected: all pass, including `test/edits.test.js`.

- [ ] **Step 8: Commit**

```bash
git add scripts/prepare-photos.mjs src/config.js src/main.js .github/workflows/deploy.yml README.md
git commit -m "Apply photos/edits.json in the photo pipeline; drop EXCLUDE"
```

---

### Task 3: GitHub client

**Files:**
- Create: `src/editor/config.js`, `src/editor/github.js`
- Test: `test/editor-github.test.js`

**Interfaces:**
- Produces:
  - `config.js` exports `OWNER`, `REPO`, `BRANCH`, `API`, `PHOTOS_DIR = 'photos/'`, `EDITS_PATH = 'photos/edits.json'`, `UPLOADABLE`, `WARN_BYTES`, `MAX_BYTES`, `MANIFEST = '../photos/raw.json'`, `LIVE_MANIFEST = '../photos/photos.json'`.
  - `github.js` exports:
    - `class GitHubError extends Error { status: number }`; status 0 = network failure.
    - `createGitHub(token, fetchFn?)`, returning:
      - `repo(): Promise<object>`
      - `headSha(): Promise<string>`
      - `commit(sha): Promise<{ sha, tree: { sha } }>`
      - `tree(sha): Promise<Array<{ path, type, sha, mode }>>` (recursive)
      - `blobText(sha): Promise<string>`
      - `createBlob(base64): Promise<string /*sha*/>`
      - `createTree(baseTree, entries): Promise<string /*sha*/>`
      - `createCommit(message, treeSha, parentSha): Promise<{ sha, committer: { date } }>`
      - `updateRef(sha): Promise<object>`
    - `decodeBase64Text(b64): string`

- [ ] **Step 1: Write the failing test**

Create `test/editor-github.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, GitHubError, decodeBase64Text } from '../src/editor/github.js';

function fakeFetch(route) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const r = route(url, init);
    if (r instanceof Error) throw r;
    const [status, json] = r;
    return new Response(status === 204 ? null : JSON.stringify(json), { status });
  };
  fn.calls = calls;
  return fn;
}

test('sends the token and reads the head of main', async () => {
  const f = fakeFetch(() => [200, { object: { sha: 'abc' } }]);
  assert.equal(await createGitHub('tok', f).headSha(), 'abc');
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/nFaiz8/nfaiz8.github.io/git/ref/heads/main');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer tok');
});

test('write calls send the right bodies', async () => {
  const f = fakeFetch(() => [201, { sha: 'x', committer: { date: 'd' } }]);
  const gh = createGitHub('tok', f);
  await gh.createBlob('AAAA');
  await gh.createTree('t0', [{ path: 'p', mode: '100644', type: 'blob', sha: null }]);
  await gh.createCommit('msg', 't1', 'c0');
  await gh.updateRef('c1');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace(/^.*\.io/, ''), c.body]), [
    ['POST', '/git/blobs', { content: 'AAAA', encoding: 'base64' }],
    ['POST', '/git/trees', { base_tree: 't0', tree: [{ path: 'p', mode: '100644', type: 'blob', sha: null }] }],
    ['POST', '/git/commits', { message: 'msg', tree: 't1', parents: ['c0'] }],
    ['PATCH', '/git/refs/heads/main', { sha: 'c1', force: false }],
  ]);
});

test('errors carry the status; network failures are status 0', async () => {
  await assert.rejects(
    createGitHub('t', fakeFetch(() => [401, { message: 'Bad credentials' }])).repo(),
    (e) => e instanceof GitHubError && e.status === 401 && /Bad credentials/.test(e.message),
  );
  await assert.rejects(createGitHub('t', fakeFetch(() => new TypeError('Failed to fetch'))).repo(), (e) => e.status === 0);
});

test('decodeBase64Text handles UTF-8 and the line breaks GitHub adds', () => {
  const s = '{"a":{"place":"São Paulo"}}';
  const b64 = Buffer.from(s).toString('base64');
  assert.equal(decodeBase64Text(`${b64.slice(0, 10)}\n${b64.slice(10)}`), s);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/editor-github.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/editor/config.js`**

```js
// Where the editor reads and writes. The API base can be pointed elsewhere only in the dev server
// (for the browser checks); in the built site it is always GitHub.
export const OWNER = 'nFaiz8';
export const REPO = 'nfaiz8.github.io';
export const BRANCH = 'main';
function devApi() {
  try { return import.meta.env.DEV ? new URLSearchParams(location.search).get('api') : null; } catch { return null; } // Node: no import.meta.env
}
export const API = devApi() || 'https://api.github.com';

export const PHOTOS_DIR = 'photos/';
export const EDITS_PATH = 'photos/edits.json';

// HEIC is left out on purpose: iOS then hands the page a JPEG, which the build can always read.
export const UPLOADABLE = /\.(jpe?g|png|webp)$/i;
export const WARN_BYTES = 25 * 1024 * 1024;
export const MAX_BYTES = 100 * 1024 * 1024;

// Relative to /edit/. raw.json has the files' own details (for placeholders); photos.json shows when a build is live.
export const MANIFEST = '../photos/raw.json';
export const LIVE_MANIFEST = '../photos/photos.json';
```

- [ ] **Step 4: Implement `src/editor/github.js`**

```js
// The few GitHub REST calls the editor needs. `fetchFn` is injectable so tests can stand in for GitHub.
import { API, OWNER, REPO, BRANCH } from './config.js';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // 0 = never reached GitHub
  }
}

export function decodeBase64Text(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function createGitHub(token, fetchFn = (...a) => fetch(...a)) {
  const base = `${API}/repos/${OWNER}/${REPO}`;
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchFn(`${base}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(0, `Network error: ${e.message}`);
    }
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`;
      try { message = (await res.json()).message || message; } catch {}
      throw new GitHubError(res.status, message);
    }
    return res.status === 204 ? null : res.json();
  }
  return {
    repo: () => call('GET', ''),
    headSha: async () => (await call('GET', `/git/ref/heads/${BRANCH}`)).object.sha,
    commit: (sha) => call('GET', `/git/commits/${sha}`),
    tree: async (sha) => (await call('GET', `/git/trees/${sha}?recursive=1`)).tree,
    blobText: async (sha) => decodeBase64Text((await call('GET', `/git/blobs/${sha}`)).content),
    createBlob: async (base64) => (await call('POST', '/git/blobs', { content: base64, encoding: 'base64' })).sha,
    createTree: async (baseTree, entries) => (await call('POST', '/git/trees', { base_tree: baseTree, tree: entries })).sha,
    createCommit: (message, tree, parent) => call('POST', '/git/commits', { message, tree, parents: [parent] }),
    updateRef: (sha) => call('PATCH', `/git/refs/heads/${BRANCH}`, { sha, force: false }),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/editor-github.test.js`
Expected: PASS, 4 tests. (`import.meta.env` is undefined under Node, so `devApi()` returns null and `API` is GitHub's.)

- [ ] **Step 6: Commit**

```bash
git add src/editor/config.js src/editor/github.js test/editor-github.test.js
git commit -m "Add GitHub client for the photo editor"
```

---

### Task 4: Pending changes model

**Files:**
- Create: `src/editor/pending.js`
- Test: `test/editor-pending.test.js`

**Interfaces:**
- Consumes: `idOf`, `normalizeEdits` from `src/edits.js`.
- Produces: pure functions over an ops array. Op shapes:
  - `{ type: 'upload', id, path, name, key, size }` (`key` = IndexedDB key of the File)
  - `{ type: 'delete', id, path }`
  - `{ type: 'edit', id, field, value }` (`value: null` removes the override)

  Functions:
  - `uniqueName(name, takenPaths: Iterable<string>): string`
  - `addEdit(ops, saved, id, field, value): ops`
  - `addUpload(ops, op): ops`
  - `addDelete(ops, id, path): ops`
  - `undo(ops, index): ops`
  - `applyOps(saved, ops): edits` (normalized)
  - `summary(ops): { added, deleted, edited }`
  - `count(ops): number`
  - `commitMessage(ops): string`
  - `describeOp(op): string`

- [ ] **Step 1: Write the failing test**

Create `test/editor-pending.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/editor-pending.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/editor/pending.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/editor-pending.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/editor/pending.js test/editor-pending.test.js
git commit -m "Add pending-changes model for the photo editor"
```

---

### Task 5: Editor view model

**Files:**
- Create: `src/editor/model.js`
- Test: `test/editor-model.test.js`

**Interfaces:**
- Consumes:
  - `IMAGE`, `idOf`, `parseEdits` (Task 1)
  - `applyOps` (Task 4)
  - `PHOTOS_DIR`, `EDITS_PATH` (Task 3)
  - a `gh` object with `headSha`, `commit`, `tree` and `blobText` (Task 3)
- Produces:
  - `pathId(path): string`
  - `loadRemote(gh): Promise<{ head, files: string[], edits, editsError: string|null }>`
  - `buildItems({ manifest, files, saved, ops }): Item[]`, where `Item = { id, path, key?, photo|null, isNew, edits, saved, building, deleting, pending }`
  - `matches(item, filter): boolean`, with filter one of `'all'|'film'|'digital'|'hidden'|'pending'`
  - `stockSuggestions(saved, ops): string[]`
  - `isLive(manifest, sinceIso): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/editor-model.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/editor-model.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/editor/model.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/editor-model.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/editor/model.js test/editor-model.test.js
git commit -m "Add editor view model"
```

---

### Task 6: Save as one commit

**Files:**
- Create: `src/editor/save.js`
- Test: `test/editor-save.test.js`

**Interfaces:**
- Consumes:
  - the `gh` methods from Task 3
  - `applyOps`, `commitMessage` (Task 4)
  - `parseEdits`, `serializeEdits` (Task 1)
  - `EDITS_PATH` (Task 3)
- Produces: `save({ gh, ops, readBase64: (key) => Promise<string>, onProgress?: (text) => void }): Promise<{ sha, date }>`. It throws errors with `.status`: 422 after a second race, 409 when an upload path was taken meanwhile, and anything `gh` throws, unchanged.

- [ ] **Step 1: Write the failing test**

Create `test/editor-save.test.js`:

```js
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
    createBlob: async (b64) => { g.calls.push('blob'); return put(`base64:${b64}`); },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/editor-save.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/editor/save.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/editor-save.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/editor/save.js test/editor-save.test.js
git commit -m "Save editor changes as one commit, retrying once if main moved"
```

---

### Task 7: The `/edit/` page

The browser checks are written first and fail. Then the page is built until they pass.

**Files:**
- Create: `e2e/editor.mjs`
- Modify: `package.json` (scripts)
- Create: `edit/index.html`, `src/editor/dom.js`, `src/editor/store.js`, `src/editor/token.js`, `src/editor/grid.js`, `src/editor/panel.js`, `src/editor/bar.js`, `src/editor/main.js`, `src/editor/editor.css`
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  - DOM hooks used by the checks:
    - token screen: `#token`, `.token .error`
    - grid: `.tile[data-id]`, `.chip[data-filter]`
    - add photos: `#add-input`
    - panel: `#f-film`, `#f-stock`, `#f-hidden`, `#f-date`, `#f-camera`, `#f-lens`, `#f-place`, `#close-panel`, `#delete-btn`
    - bar: `#pending-count`, `#save-btn`, `#review-btn`, `#discard-btn`
    - other: `.banner`, `.panel`
  - The dev server accepts `?api=<base>` to point the GitHub client at a stand-in (dev only, see Task 3 config).

- [ ] **Step 1: Write the browser checks**

Create `e2e/editor.mjs`:

```js
// Live checks for /edit/ in headless Chrome. GitHub is faked inside this process (same origin,
// via ?api=), so no check ever touches the real repository. Usage: npm run e2e:edit
import { withBrowser, SHOTS } from './lib.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { idOf } from '../src/edits.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../test/fixtures/photos.json', import.meta.url)));
const files = fixture.photos.map((p) => `photos/${p.id}.jpg`); // IMG_1000 → photos/IMG_1000.jpg → id img-1000
const manifest = { generated: '2026-01-01T00:00:00.000Z', photos: fixture.photos.map((p) => ({ ...p, id: idOf(`${p.id}.jpg`) })) };
const PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#888888' } }).png().toBuffer();
fs.mkdirSync(SHOTS, { recursive: true });
const tiny = path.join(SHOTS, 'Tiny.jpg');
const clash = path.join(SHOTS, 'IMG_1000.jpg'); // same name as a photo already in the repo
for (const f of [tiny, clash]) await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c03020' } }).jpeg().toFile(f);

function fakeGitHub() {
  let n = 0;
  const g = { token: 'good', blobs: new Map(), trees: new Map(), commits: new Map(), head: 'c0', race: false, refs: 0 };
  const put = (data) => { const sha = `b${++n}`; g.blobs.set(sha, Buffer.from(data)); return sha; };
  g.trees.set('t0', files.map((p) => ({ path: p, type: 'blob', mode: '100644', sha: put('img') })));
  g.commits.set('c0', { sha: 'c0', tree: { sha: 't0' }, parents: [] });
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
  const commit = (tree, parents, message) => {
    const c = { sha: `c${++n}`, tree: { sha: tree }, parents, message, committer: { date: new Date().toISOString() } };
    g.commits.set(c.sha, c);
    return c;
  };
  g.file = (p) => {
    const e = g.trees.get(g.commits.get(g.head).tree.sha).find((x) => x.path === p);
    return e && g.blobs.get(e.sha).toString();
  };
  g.handle = (method, p, body, auth) => {
    if (auth !== `Bearer ${g.token}`) return [401, { message: 'Bad credentials' }];
    let m;
    if (method === 'GET' && p === '') return [200, { full_name: 'nFaiz8/nfaiz8.github.io' }];
    if (method === 'GET' && p === '/git/ref/heads/main') return [200, { object: { sha: g.head } }];
    if (method === 'GET' && (m = p.match(/^\/git\/commits\/(.+)$/))) return [200, g.commits.get(m[1])];
    if (method === 'GET' && (m = p.match(/^\/git\/trees\/(.+)$/))) return [200, { tree: g.trees.get(m[1]) }];
    if (method === 'GET' && (m = p.match(/^\/git\/blobs\/(.+)$/))) return [200, { content: g.blobs.get(m[1]).toString('base64'), encoding: 'base64' }];
    if (method === 'POST' && p === '/git/blobs') return [201, { sha: put(Buffer.from(body.content, 'base64')) }];
    if (method === 'POST' && p === '/git/trees') return [201, { sha: mkTree(body.base_tree, body.tree) }];
    if (method === 'POST' && p === '/git/commits') return [201, commit(body.tree, body.parents, body.message)];
    if (method === 'PATCH' && p === '/git/refs/heads/main') {
      g.refs++;
      if (g.race) { // another device saves first: an edit to a different photo
        g.race = false;
        const t = mkTree(g.commits.get(g.head).tree.sha, [{ path: 'photos/edits.json', mode: '100644', content: '{\n  "img-1005": {\n    "place": "Elsewhere"\n  }\n}\n' }]);
        g.head = commit(t, [g.head], 'other device').sha;
      }
      if (g.commits.get(body.sha).parents[0] !== g.head) return [422, { message: 'Update is not a fast forward' }];
      g.head = body.sha;
      return [200, { object: { sha: body.sha } }];
    }
    return [404, { message: `fake GitHub has no ${method} ${p}` }];
  };
  return g;
}

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
};
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const waitText = (page, sel, re, timeout = 10000) =>
  page.waitForFunction((s, src) => new RegExp(src).test(document.querySelector(s)?.textContent || ''), { timeout }, sel, re.source);

await withBrowser(async ({ page, url, errors }) => {
  const gh = fakeGitHub();
  const apiBase = `${url}__gh`;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(apiBase)) {
      const p = u.slice(apiBase.length).replace('/repos/nFaiz8/nfaiz8.github.io', '').replace(/\?.*$/, '');
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      const [status, json] = gh.handle(req.method(), p, body, req.headers().authorization);
      return req.respond({ status, contentType: 'application/json', body: JSON.stringify(json) });
    }
    if (/\/photos\/(raw|photos)\.json/.test(u)) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
    if (/\/photos\/(low|hi|xl)\//.test(u)) return req.respond({ status: 200, contentType: 'image/png', body: PNG });
    return req.continue();
  });
  const edit = `${url}edit/?api=${encodeURIComponent(apiBase)}`;
  const signIn = async (token) => {
    await page.waitForSelector('#token');
    await page.$eval('#token', (e) => { e.value = ''; });
    await page.type('#token', token);
    await page.keyboard.press('Enter');
  };

  await check('asks for a token first', async () => {
    await page.goto(edit);
    await page.waitForSelector('#token', { timeout: 10000 });
  });
  await check('a refused token is explained', async () => {
    await signIn('nope');
    await waitText(page, '.token .error', /refused/);
  });
  await check('a good token shows every photo in the repo', async () => {
    await signIn('good');
    await page.waitForSelector('.tile');
    assert.equal((await page.$$('.tile')).length, files.length);
  });
  await check('marks a photo as film with a stock', async () => {
    await page.click('.tile[data-id="img-1000"]');
    await page.click('#f-film');
    await page.waitForSelector('#f-stock:not([disabled])');
    await page.type('#f-stock', 'Portra 400');
    await page.keyboard.press('Tab');
    await waitText(page, '#pending-count', /^1 change$/);
    assert.equal(await page.$eval('#f-stock', (e) => e.value), 'Portra 400');
  });
  await check('hides another photo', async () => {
    await page.click('#close-panel');
    await page.click('.tile[data-id="img-1001"]');
    await page.click('#f-hidden');
    await waitText(page, '#pending-count', /^2 changes$/);
    await page.click('#close-panel');
  });
  await check('the Pending filter shows only changed photos', async () => {
    await page.click('.chip[data-filter="pending"]');
    assert.deepEqual(await page.$$eval('.tile', (ts) => ts.map((t) => t.dataset.id).sort()), ['img-1000', 'img-1001']);
    await page.click('.chip[data-filter="all"]');
  });
  await check('adds photos, renaming a clash', async () => {
    const input = await page.$('#add-input');
    await input.uploadFile(tiny, clash);
    await waitText(page, '#pending-count', /^4 changes$/);
    await page.waitForSelector('.tile[data-id="tiny"] img');
    await page.waitForSelector('.tile[data-id="img-1000-2"] img');
    assert.match(await text(page, '.banner'), /IMG_1000-2\.jpg/);
  });
  await check('pending changes survive a reload', async () => {
    await page.reload();
    await page.waitForSelector('.tile[data-id="tiny"] img');
    await waitText(page, '#pending-count', /^4 changes$/);
  });
  await check('the panel is a bottom sheet on a phone', async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.click('.tile[data-id="tiny"]');
    const r = await page.$eval('.panel', (e) => e.getBoundingClientRect().toJSON());
    assert.equal(Math.round(r.width), 390);
    assert.ok(r.top > 100, `panel top ${r.top}`);
    await page.click('#close-panel');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  });
  await check('save makes one commit, retrying once when main moved', async () => {
    gh.race = true;
    await page.click('#save-btn');
    await waitText(page, '#pending-count', /building/, 20000);
    const c = gh.commits.get(gh.head);
    assert.equal(c.message, 'Edit photos: 2 added, 2 edited');
    assert.equal(gh.refs, 2);
    assert.ok(gh.file('photos/Tiny.jpg') && gh.file('photos/IMG_1000-2.jpg'), 'both uploads committed');
    assert.ok(gh.file('photos/IMG_1000.jpg'), 'the existing photo was not overwritten');
    assert.deepEqual(JSON.parse(gh.file('photos/edits.json')), {
      'img-1000': { film: true, stock: 'Portra 400' },
      'img-1001': { hidden: true },
      'img-1005': { place: 'Elsewhere' },
    });
  });
  await check('an expired token returns to the token screen and keeps the changes', async () => {
    await page.click('.tile[data-id="img-1002"]');
    await page.click('#f-film');
    await waitText(page, '#pending-count', /^1 change$/);
    gh.token = 'rotated';
    await page.click('#save-btn');
    await waitText(page, '.token .error', /expired/);
    await signIn('rotated');
    await waitText(page, '#pending-count', /^1 change$/);
  });
  await check('no page errors', async () => {
    // A 401 on purpose shows up as a "Failed to load resource" console line; that one is expected.
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  });
}, { port: 5198 });

for (const [s, name, msg] of results) console.log(`${s.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}`);
process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
```

In `package.json` scripts, change `"e2e"` and add `"e2e:edit"`:

```json
    "e2e": "node e2e/run.mjs && node e2e/editor.mjs",
    "e2e:edit": "node e2e/editor.mjs",
```

- [ ] **Step 2: Run the checks to verify they fail**

Run: `npm run e2e:edit`
Expected: `FAIL asks for a token first` (no `/edit/` page yet), and the later checks fail.

- [ ] **Step 3: Page shell and multi-page build**

Create `edit/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <meta name="robots" content="noindex" />
    <title>Faiz · edit</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="../src/editor/editor.css" />
  </head>
  <body>
    <main id="app"><p class="loading">loading…</p></main>
    <script type="module" src="../src/editor/main.js"></script>
  </body>
</html>
```

Replace `vite.config.js` with:

```js
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (p) => fileURLToPath(new URL(p, import.meta.url));

// The editor holds a GitHub token, so its built page may only talk to this site and GitHub.
// Build only: Vite's dev server needs inline styles and a websocket.
const CSP = "default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' blob: data:; style-src 'self'; script-src 'self'";
const editorCsp = {
  name: 'editor-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html, ctx) => (ctx.path.endsWith('edit/index.html')
      ? html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
      : html),
  },
};

// Photos are prepared into public/photos by scripts/prepare-photos.mjs; Vite serves and copies them.
export default defineConfig({
  base: './',
  plugins: [editorCsp],
  build: { target: 'es2022', rollupOptions: { input: { main: page('./index.html'), edit: page('./edit/index.html') } } },
});
```

- [ ] **Step 4: DOM helper and storage**

Create `src/editor/dom.js`:

```js
// h('button', { class: 'btn', onclick }, 'save'): build an element. Props that are DOM properties
// (value, checked, disabled…) are set as properties; the rest as attributes. null/false are skipped.
export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return e;
}
```

Create `src/editor/store.js`:

```js
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
```

- [ ] **Step 5: UI pieces**

Create `src/editor/token.js`:

```js
// The sign-in screen: how to make a token, and a field to paste it.
import { h } from './dom.js';
import { REPO } from './config.js';

export function tokenScreen({ message, onSubmit }) {
  const input = h('input', { type: 'password', id: 'token', autocomplete: 'off', spellcheck: false, placeholder: 'github_pat_…', required: true });
  const button = h('button', { type: 'submit', class: 'btn primary' }, 'sign in');
  return h('section', { class: 'token' },
    h('h1', {}, 'edit faiz.pics'),
    message && h('p', { class: 'error', role: 'alert' }, message),
    h('ol', {},
      h('li', {}, 'On GitHub, create a ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'fine-grained token'), '.'),
      h('li', {}, `Repository access: Only select repositories → ${REPO}.`),
      h('li', {}, 'Repository permissions: Contents → Read and write.'),
      h('li', {}, 'Generate it, copy it and paste it below. It is kept in this browser only.')),
    h('form', {
      class: 'token-form',
      onsubmit: (ev) => {
        ev.preventDefault();
        button.disabled = true;
        button.textContent = 'checking…';
        onSubmit(input.value.trim());
      },
    }, input, button));
}
```

Create `src/editor/grid.js`:

```js
// Toolbar (filters, add, select), the select-mode bar and the thumbnail grid.
import { h } from './dom.js';

const FILTERS = [['all', 'all'], ['film', 'film'], ['digital', 'digital'], ['hidden', 'hidden'], ['pending', 'pending']];

// Thumbnail URL for an item: the local file for a new upload, else the site's own resized copy.
export function thumb(item, S, size = 'low') {
  if (item.isNew) return S.previews.get(item.key) || null;
  const src = item.photo?.src?.[size] || item.photo?.src?.low;
  return src ? `../${src}` : null;
}

export function toolbar({ S, total, actions }) {
  const input = h('input', {
    type: 'file', id: 'add-input', class: 'sr-only', multiple: true, accept: 'image/jpeg,image/png,image/webp',
    onchange: (ev) => { const files = [...ev.target.files]; ev.target.value = ''; actions.addFiles(files); },
  });
  return h('header', { class: 'toolbar' },
    h('span', { class: 'name' }, `edit · ${total} photos`),
    h('nav', { class: 'chips', 'aria-label': 'Filter' }, FILTERS.map(([f, label]) =>
      h('button', { type: 'button', class: `chip${S.filter === f ? ' on' : ''}`, 'data-filter': f, onclick: () => actions.filter(f) }, label))),
    h('span', { class: 'tools' },
      h('label', { class: 'btn', for: 'add-input' }, '+ add photos', input),
      h('button', { type: 'button', class: 'btn', id: 'select-btn', onclick: actions.toggleSelecting }, S.selecting ? 'cancel' : 'select'),
      h('button', { type: 'button', class: 'btn quiet', onclick: actions.signOut }, 'sign out')));
}

export function selectBar({ S, actions }) {
  const stock = h('input', { type: 'text', id: 'bulk-stock', placeholder: 'stock (optional)', list: 'stocks' });
  const n = S.selected.size;
  const btn = (kind, label) => h('button', { type: 'button', class: 'btn', 'data-bulk': kind, disabled: !n, onclick: () => actions.bulk(kind, stock.value.trim()) }, label);
  return h('div', { class: 'selectbar' },
    h('span', {}, `${n} selected`), btn('film', 'film'), stock, btn('digital', 'digital'), btn('hide', 'hide'), btn('unhide', 'unhide'));
}

export function grid({ items, S, actions }) {
  if (!items.length) return h('p', { class: 'empty' }, 'nothing here');
  return h('ul', { class: 'grid' }, items.map((it) => {
    const src = thumb(it, S);
    const badges = [
      it.edits.film && 'film', it.edits.hidden && 'hidden', Object.keys(it.saved).length > 0 && 'edited',
      it.isNew && 'new', it.deleting && 'delete',
    ].filter(Boolean);
    const cls = ['tile', S.selected.has(it.id) && 'selected', it.pending && 'pending', it.deleting && 'deleting'].filter(Boolean).join(' ');
    return h('li', {}, h('button', { type: 'button', class: cls, 'data-id': it.id, 'aria-label': it.id, onclick: () => actions.open(it.id) },
      src ? h('img', { src, alt: '', loading: 'lazy' }) : h('span', { class: 'nothumb' }, it.building ? 'building…' : it.id),
      h('span', { class: 'badges' }, badges.map((b) => h('span', { class: `badge ${b}` }, b)))));
  }));
}
```

Create `src/editor/panel.js`:

```js
// The photo panel: film, stock, hidden, date/camera/lens/place overrides and delete.
// Text fields commit on change (blur or Enter), so re-rendering never fights the keyboard.
import { h } from './dom.js';
import { thumb } from './grid.js';

const TEXT_FIELDS = [['camera', 'camera', 'camera'], ['lens', 'lens', 'lens'], ['place', 'place', 'location']];

export function panel({ item, S, actions }) {
  const e = item.edits, p = item.photo || {};
  const edit = (field) => (ev) => actions.edit(item.id, field, ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value.trim());
  const reset = (field) => e[field] != null && h('button', { type: 'button', class: 'reset', 'aria-label': `reset ${field}`, onclick: () => actions.edit(item.id, field, null) }, '×');
  const src = thumb(item, S, 'hi');
  const confirming = S.confirm === `delete:${item.id}`;
  return h('aside', { class: 'panel', 'aria-label': `Edit ${item.id}` },
    h('header', {},
      h('span', { class: 'pid' }, item.path.replace(/^photos\//, '')),
      h('button', { type: 'button', class: 'btn quiet', id: 'close-panel', onclick: actions.close }, 'close')),
    src ? h('img', { class: 'preview', src, alt: '' }) : h('div', { class: 'preview nothumb' }, 'no preview until the site rebuilds'),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'f-film', checked: !!e.film, onchange: edit('film') }), 'film'),
    h('label', { class: 'field' }, 'stock',
      h('input', { type: 'text', id: 'f-stock', value: e.stock || '', list: 'stocks', disabled: !e.film, placeholder: e.film ? 'e.g. Portra 400' : 'turn on film first', onchange: edit('stock') }),
      reset('stock')),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'f-hidden', checked: !!e.hidden, onchange: edit('hidden') }), 'hidden'),
    h('label', { class: 'field' }, p.date ? `date (photo says ${p.date})` : 'date',
      h('input', { type: 'date', id: 'f-date', value: e.date || '', onchange: edit('date') }),
      reset('date')),
    TEXT_FIELDS.map(([field, label, key]) => h('label', { class: 'field' }, label,
      h('input', { type: 'text', id: `f-${field}`, value: e[field] || '', placeholder: p[key] || '—', onchange: edit(field) }),
      reset(field))),
    h('button', {
      type: 'button', id: 'delete-btn', class: `btn danger${confirming ? ' armed' : ''}`, disabled: item.deleting,
      onclick: () => actions.remove(item.id, item.path),
    }, item.deleting ? 'marked for deletion (undo in review)' : confirming ? 'tap again to delete' : 'delete photo'));
}
```

Create `src/editor/bar.js`:

```js
// The bottom bar: pending count, review list, discard, save, and build status after saving.
import { h } from './dom.js';
import { count, describeOp } from './pending.js';
import { OWNER, REPO } from './config.js';

export function bar({ S, actions }) {
  const n = count(S.ops);
  const status = S.live === 'building' ? 'saved · building the site…'
    : S.live === 'live' ? 'saved · live ✓'
    : S.live === 'slow' ? h('span', {}, 'still building · ', h('a', { href: `https://github.com/${OWNER}/${REPO}/actions`, target: '_blank', rel: 'noopener' }, 'check Actions'))
    : null;
  return h('footer', { class: 'bar' },
    S.error && h('p', { class: 'error', role: 'alert' }, S.error),
    S.reviewing && n > 0 && h('ol', { class: 'review' }, S.ops.map((o, i) => h('li', {},
      h('span', {}, describeOp(o)),
      h('button', { type: 'button', class: 'btn quiet', 'data-undo': i, onclick: () => actions.undo(i) }, 'undo')))),
    h('div', { class: 'row' },
      h('span', { class: 'count', id: 'pending-count', role: 'status' }, n ? `${n} change${n === 1 ? '' : 's'}` : status || 'no changes'),
      n > 0 && !S.saving && h('button', { type: 'button', class: 'btn quiet', id: 'review-btn', onclick: actions.review }, S.reviewing ? 'hide list' : 'review'),
      n > 0 && !S.saving && h('button', { type: 'button', class: 'btn quiet', id: 'discard-btn', onclick: actions.discard }, S.confirm === 'discard' ? 'tap again to discard' : 'discard'),
      n > 0 && h('button', { type: 'button', class: 'btn primary', id: 'save-btn', disabled: S.saving || !!S.remote.editsError, onclick: actions.save }, S.saving ? S.progress : 'save')));
}
```

- [ ] **Step 6: State, actions and flows**

Create `src/editor/main.js`:

```js
// faiz.pics/edit/: manage the gallery from any browser. Changes queue up here and go to GitHub as
// one commit on Save; the Action then rebuilds the site. Design: docs/specs/2026-10-13-photo-editor-design.md
import { h } from './dom.js';
import { createGitHub } from './github.js';
import { loadRemote, buildItems, matches, stockSuggestions, isLive } from './model.js';
import { addEdit, addDelete, addUpload, undo, uniqueName } from './pending.js';
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
  filter: 'all', selecting: false, selected: new Set(), open: null, confirm: null,
  previews: new Map(), notice: null, error: null,
  saving: false, progress: null, reviewing: false, live: null,
};
let liveTimer = null;

function render() {
  if (!S.remote) return;
  const items = buildItems({ manifest: S.manifest, files: S.remote.files, saved: S.remote.edits, ops: S.ops });
  const openItem = S.open && items.find((it) => it.id === S.open);
  app.replaceChildren(...[
    toolbar({ S, total: items.length, actions }),
    S.remote.editsError && h('p', { class: 'banner error' }, `photos/edits.json in the repo is not valid (${S.remote.editsError}). Fix it on GitHub; saving is off until then.`),
    S.notice && h('p', { class: 'banner', onclick: () => { S.notice = null; render(); } }, S.notice),
    S.selecting && selectBar({ S, actions }),
    grid({ items: items.filter((it) => matches(it, S.filter)), S, actions }),
    openItem && panel({ item: openItem, S, actions }),
    h('datalist', { id: 'stocks' }, stockSuggestions(S.remote.edits, S.ops).map((s) => h('option', { value: s }))),
    bar({ S, actions }),
  ].filter(Boolean));
}

function setOps(ops) {
  S.ops = ops;
  saveOps(ops);
  const keys = new Set(ops.filter((o) => o.type === 'upload').map((o) => o.key));
  for (const [k, url] of S.previews) if (!keys.has(k)) { URL.revokeObjectURL(url); S.previews.delete(k); }
  pruneFiles(keys);
  render();
}

const saved = () => S.remote.edits;

const actions = {
  filter(f) { S.filter = f; render(); },
  open(id) {
    if (S.selecting) { if (!S.selected.delete(id)) S.selected.add(id); }
    else { S.open = id; S.confirm = null; }
    render();
  },
  close() { S.open = null; S.confirm = null; render(); },
  edit(id, field, value) {
    let ops = addEdit(S.ops, saved(), id, field, value);
    if (field === 'film' && !value) ops = addEdit(ops, saved(), id, 'stock', null);
    setOps(ops);
  },
  remove(id, path) {
    if (S.confirm !== `delete:${id}`) { S.confirm = `delete:${id}`; render(); return; }
    S.confirm = null;
    S.open = null;
    setOps(addDelete(S.ops, id, path));
  },
  toggleSelecting() { S.selecting = !S.selecting; S.selected.clear(); S.open = null; render(); },
  bulk(kind, stock) {
    let ops = S.ops;
    for (const id of S.selected) {
      if (kind === 'film') { ops = addEdit(ops, saved(), id, 'film', true); if (stock) ops = addEdit(ops, saved(), id, 'stock', stock); }
      if (kind === 'digital') { ops = addEdit(ops, saved(), id, 'film', null); ops = addEdit(ops, saved(), id, 'stock', null); }
      if (kind === 'hide') ops = addEdit(ops, saved(), id, 'hidden', true);
      if (kind === 'unhide') ops = addEdit(ops, saved(), id, 'hidden', null);
    }
    S.selecting = false;
    S.selected.clear();
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
  let ops = S.ops;
  for (const file of files) {
    if (!UPLOADABLE.test(file.name)) { notes.push(`${file.name}: only JPEG, PNG or WebP can be uploaded here.`); continue; }
    if (file.size > MAX_BYTES) { notes.push(`${file.name}: over 100 MB, which GitHub won't accept.`); continue; }
    if (file.size > WARN_BYTES) notes.push(`${file.name}: over 25 MB. It will upload, but a smaller export is quicker.`);
    const name = uniqueName(file.name, taken);
    if (name !== file.name) notes.push(`${file.name} is already in the gallery, so this one will be added as ${name}.`);
    const path = PHOTOS_DIR + name;
    taken.add(path);
    const key = crypto.randomUUID();
    await putFile(key, file);
    S.previews.set(key, URL.createObjectURL(file));
    ops = addUpload(ops, { id: idOf(name), path, name, key, size: file.size });
  }
  S.notice = notes.join('\n') || null;
  setOps(ops);
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
    const res = await save({ gh: S.gh, ops: S.ops, readBase64, onProgress: (t) => { S.progress = t; render(); } });
    S.saving = false;
    setOps([]);
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

const token = loadToken();
if (token) {
  S.gh = createGitHub(token);
  refresh();
} else {
  showToken();
}
```

- [ ] **Step 7: Styles**

Create `src/editor/editor.css`:

```css
:root {
  --bg: #07080b;
  --panel: #0d0f14;
  --ink: #e9e4d8;
  --mute: #8a877f;
  --line: #2a2d36;
  --accent: #d9a441;
  --danger: #d0574a;
  --mono: Menlo, "SF Mono", Consolas, "DejaVu Sans Mono", monospace;
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--ink); }
body { margin: 0; font: 14px/1.45 var(--mono); padding-bottom: 120px; }
a { color: var(--ink); }
button, input { font: inherit; color: inherit; }
h1 { font-size: 16px; font-weight: normal; letter-spacing: 0.12em; color: var(--mute); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.btn, .chip { background: none; border: 1px solid var(--line); color: var(--mute); padding: 6px 10px; min-height: 36px; cursor: pointer; }
.btn:hover, .chip:hover, .btn:focus-visible, .chip:focus-visible { color: var(--ink); border-color: var(--mute); outline: none; }
.chip.on { color: var(--bg); background: var(--ink); border-color: var(--ink); }
.btn.primary { color: var(--bg); background: var(--accent); border-color: var(--accent); }
.btn.danger { color: var(--danger); border-color: var(--danger); }
.btn.danger.armed { color: var(--bg); background: var(--danger); }
.btn.quiet { border-color: transparent; }
.btn:disabled { opacity: 0.4; cursor: default; }
label.btn { display: inline-flex; align-items: center; }

input[type="text"], input[type="password"], input[type="date"] {
  width: 100%; min-height: 36px; padding: 6px 8px; background: var(--panel); border: 1px solid var(--line); color-scheme: dark;
}
input:disabled { opacity: 0.5; }

.toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  justify-content: space-between; padding: 12px 16px; background: var(--bg); border-bottom: 1px solid var(--line); }
.name { color: var(--mute); letter-spacing: 0.1em; }
.chips, .tools { display: flex; flex-wrap: wrap; gap: 6px; }
.banner { margin: 12px 16px; padding: 8px 12px; border: 1px solid var(--line); color: var(--mute); white-space: pre-line; cursor: pointer; }
.error { color: var(--danger); white-space: pre-line; }
.selectbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--line); }
.selectbar input { width: 12em; }

.grid { list-style: none; margin: 0; padding: 12px 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.tile { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; border: 1px solid var(--line);
  background: var(--panel); cursor: pointer; overflow: hidden; }
.tile img { display: block; width: 100%; height: 100%; object-fit: cover; }
.tile.pending { border-color: var(--accent); }
.tile.selected { outline: 2px solid var(--accent); outline-offset: 2px; }
.tile.deleting img { opacity: 0.3; }
.nothumb { display: grid; place-items: center; height: 100%; padding: 4px; color: var(--mute); font-size: 12px; word-break: break-all; }
.badges { position: absolute; left: 4px; bottom: 4px; display: flex; flex-wrap: wrap; gap: 3px; }
.badge { padding: 1px 4px; font-size: 10px; background: #07080bd9; color: var(--ink); }
.badge.delete { color: var(--danger); }

.panel { position: fixed; z-index: 10; top: 0; right: 0; bottom: 0; width: min(420px, 100%); display: flex; flex-direction: column;
  gap: 12px; padding: 16px 16px 120px; overflow-y: auto; background: var(--bg); border-left: 1px solid var(--line); }
.panel header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.pid { color: var(--mute); word-break: break-all; }
.preview { width: 100%; max-height: 40vh; object-fit: contain; background: var(--panel); }
div.preview { min-height: 120px; }
.field { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; color: var(--mute); }
.field > :not(.reset) { grid-column: 1; }
.field .reset { grid-column: 2; grid-row: 2; }
.reset { width: 36px; background: none; border: 1px solid var(--line); color: var(--mute); cursor: pointer; }
.switch { display: flex; gap: 8px; align-items: center; min-height: 36px; }
.switch input { width: 20px; height: 20px; accent-color: var(--accent); }
@media (max-width: 700px) {
  .panel { top: auto; left: 0; width: 100%; max-height: 85vh; border-left: 0; border-top: 1px solid var(--line); }
}

.bar { position: fixed; z-index: 20; left: 0; right: 0; bottom: 0; padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: var(--bg); border-top: 1px solid var(--line); }
.bar .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bar .count { margin-right: auto; color: var(--mute); }
.review { margin: 0 0 8px; padding-left: 20px; max-height: 40vh; overflow-y: auto; }
.review li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }

.token { max-width: 560px; margin: 10vh auto; padding: 0 16px; }
.token-form { display: flex; gap: 8px; }
.loading, .empty { padding: 24px 16px; color: var(--mute); }
```

- [ ] **Step 8: Run the browser checks until they pass**

Run: `npm run e2e:edit`
Expected: every line `ok`, ending with `ok   no page errors`. If a check fails, fix the page, not the check, unless the check contradicts the spec.

- [ ] **Step 9: Run the unit tests and the gallery's browser checks (nothing regressed)**

Run: `npm test && node e2e/run.mjs`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add edit/index.html vite.config.js src/editor e2e/editor.mjs package.json
git commit -m "Add the /edit/ page for managing photos from any browser"
```

---

### Task 8: Build check, docs, and a manual pass

**Files:**
- Modify: `README.md` (new "Editing from any browser" section)

**Interfaces:**
- Consumes: the built `dist/` from `npm run build`.

- [ ] **Step 1: Check the build output**

```bash
npm run build
grep -c 'Content-Security-Policy' dist/edit/index.html
grep -c 'Content-Security-Policy' dist/index.html || true
grep -c 'noindex' dist/edit/index.html
grep -l 'URLSearchParams' dist/assets/edit-*.js || echo 'no dev override in the editor bundle'
ls dist/photos/raw.json dist/photos/photos.json
```

Expected:
- `dist/edit/index.html` contains the CSP once and `noindex` once.
- `dist/index.html` contains no CSP (`0`).
- The last command prints `no dev override in the editor bundle`, which shows the dev-only `?api=` override was removed from the build.
- Both manifests exist.

- [ ] **Step 2: Manual pass on the built page with no CSP errors**

Run `npx vite preview --port 4173`, open `http://localhost:4173/edit/`, and open the browser console. Expected: the token screen, and no CSP violation messages. Stop the preview server.

- [ ] **Step 3: Document the editor**

In `README.md`, after the "Adding photos" section, add:

```markdown
## Editing from any browser

Open **faiz.pics/edit/** (it is not linked from the gallery). The first time on a device, it asks for
a GitHub token:

1. GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).
2. Repository access: **Only select repositories** → `nfaiz8.github.io`.
3. Repository permissions: **Contents → Read and write**. Nothing else.
4. Paste it into the page. It stays in that browser; **sign out** removes it.

Then tap a photo to mark it film (and name the stock), hide it, delete it, or correct its date,
camera, lens or place. **Select** applies film/digital/hide/unhide to several photos at once, which is
handy for a whole roll. **+ add photos** uploads from your camera roll or computer. Nothing is sent
until **save**, which makes one commit; the site rebuilds a few minutes later and the page shows
**live ✓** when it has.

Edits are stored in `photos/edits.json`, keyed by photo id (the file name in lower case). You can
also edit that file by hand; the build applies it every time.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document the photo editor"
```

- [ ] **Step 5: Final full run**

Run: `npm test && npm run e2e && npm run build`
Expected: all pass. Report the result. Do **not** push; Faiz decides when it goes live.
