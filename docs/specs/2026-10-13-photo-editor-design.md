# Photo editor: design

Date: 2026-10-13
Status: approved design, not built yet.

## 1. Intent

A private editing page on the live site, `faiz.pics/edit/`, where Faiz can manage the gallery
from any device (phone or computer) without touching git:

- mark photos as film or digital, and name the film stock;
- hide and unhide photos;
- delete photos;
- correct details the EXIF gets wrong or lacks (common on film scans): date, camera, lens, place;
- upload new photos.

### What the user chose

- The editor runs on the live site, not as a local tool. Phone use matters, but so does
  convenience everywhere.
- Approach A: a static page that talks to the GitHub API with a personal token, batching all
  changes into **one commit per Save**. Not commit-per-change, and no hosted CMS.
- All four per-photo controls: film + stock, hide/unhide, delete, fix details.

### Background (state before this work)

- Photos live in `photos/`. On push, the GitHub Action runs `scripts/prepare-photos.mjs`, which
  resizes them into `public/photos/{low,hi,xl}/<id>.webp` and writes `public/photos/photos.json`,
  then builds and deploys to Pages.
- The pipeline currently sets `category: 'digital'` on every photo, so nothing is ever film,
  although the gallery already renders `category: 'film'` and `filmStock`
  (`src/data.js`, `src/viewer.js`).
- Hiding is done with `EXCLUDE` in `src/config.js` (currently empty).
- Photo id = file path in lower case with non-alphanumerics turned into `-`
  (`idOf` in `prepare-photos.mjs`).

### Success criteria

- From a phone, Faiz can open `/edit/`, mark a roll of scans as film with a stock, save, and see
  the gallery show the stock a few minutes later.
- From a phone, Faiz can upload photos from the camera roll and they appear in the gallery after
  the build.
- Hidden photos disappear from the walls; deleted photos are gone from the repo and site.
- Edited dates/places/cameras/lenses show in the viewer and plaques instead of the EXIF values.
- One Save produces exactly one commit and one deploy.
- Without a valid token the page can change nothing.

## 2. Data: `photos/edits.json`

The only store for edits. Committed to the repo, keyed by photo id:

```json
{
  "000017980006": { "film": true, "stock": "Portra 400", "date": "2025-08-02", "place": "Lisbon" },
  "dscf7326": { "hidden": true }
}
```

Allowed fields, all optional:

| Field    | Type    | Effect on the photo entry                      |
|----------|---------|------------------------------------------------|
| `film`   | boolean | `category: 'film'` when true, `'digital'` when false |
| `stock`  | string  | `filmStock`                                    |
| `hidden` | boolean | `hidden`                                       |
| `date`   | string `YYYY-MM-DD` | `date`, and `year` derived from it  |
| `camera` | string  | `camera`                                       |
| `lens`   | string  | `lens`                                         |
| `place`  | string  | `location`                                     |

A missing field means "use the EXIF/pipeline value". The editor removes a field rather than
writing an empty string, and removes an id whose object becomes empty. Unknown fields are
ignored. The file is written with stable key order (ids sorted, fields in the table order) and
2-space indentation so diffs stay readable.

`edits.json` is not an image, so the pipeline's `IMAGE` filter already skips it.

## 3. Pipeline changes

- New module `src/edits.js` (pure, no Node APIs, shared with the editor):
  - `idOf(relPath)`: moved here from `prepare-photos.mjs`, unchanged behaviour.
  - `applyEdits(photos, edits)`: returns new photo objects with the table above applied, plus a
    list of edit ids that matched no photo.
  - `normalizeEdits(edits)`: drops unknown fields, empty strings and empty objects; sorts keys.
- `prepare-photos.mjs` reads `photos/edits.json` (missing or empty file = no edits; malformed
  JSON = build fails with a clear message), calls `applyEdits` on the final photo list, and
  warns for each unmatched id. Edits are applied every run, including to photos reused from the
  previous build, so changing details never re-resizes images. The cached `previous` entries
  must be the un-edited pipeline output, so the pipeline keeps a separate raw manifest
  (`public/photos/raw.json`) as its cache and writes the edited list to `photos.json`.
- The Action's cache key adds `src/edits.js`. `edits.json` lives under `photos/**` so it is
  already in the key; that only affects cache hits, not correctness.
- `EXCLUDE` is removed from `src/config.js` and from `loadData`/`indexData` callers. Hiding is
  `"hidden": true`, which `indexData` already honours.

## 4. The `/edit/` page

### Build and serving

- `edit/index.html` + `src/editor/*.js` + `src/editor/editor.css`, added as a second input in
  `vite.config.js` (multi-page build). Served at `faiz.pics/edit/`.
- Not linked from the gallery. `<meta name="robots" content="noindex">`.
- Content-Security-Policy meta: `default-src 'self'; connect-src 'self' https://api.github.com;
  img-src 'self' blob: data:; style-src 'self'; script-src 'self'`. No third-party scripts.
- Visual style follows the site: monospace, dark, same palette tokens.

### Token

- First visit shows a token screen with short steps for creating a fine-grained personal access
  token: repository access = only `nFaiz8/nfaiz8.github.io`, permission = Contents: read and write.
- The token is verified with `GET /repos/nFaiz8/nfaiz8.github.io`; on success it is stored in
  `localStorage` for that browser. A **Sign out** control clears it.
- Owner, repo and branch (`main`) are constants in `src/editor/config.js`.

### Loading

- Live `photos/raw.json` (same origin, the un-edited manifest from section 3) gives thumbnails
  (`low/`), dimensions and the files' own details for built photos, so placeholders show EXIF, not
  earlier edits. `photos/photos.json` is only polled for its `generated` time after a save.
- From the API: the tree of `photos/` on `main` (file list + blob shas) and `photos/edits.json`
  contents. These are the source of truth for what exists and what is edited, so the page is
  correct even before a rebuild.
- Files in the repo tree with no `photos.json` entry show as "building…" tiles (no thumbnail).
- Entries in `photos.json` whose file is no longer in the tree are not shown.

### Grid

- Thumbnail grid; filter chips **All · Film · Digital · Hidden · Pending**.
- Tile badges: film, hidden, edited (has an `edits.json` entry), pending (has unsaved changes),
  marked for deletion.

### Photo panel

Opens on tap; bottom sheet on narrow screens, side panel on wide ones. Contains:

- larger preview (`hi/` if available, else the local blob for a new upload);
- **Film** and **Hidden** switches;
- **Stock** text field with suggestions from stocks already used in `edits.json`; enabled only
  when Film is on (turning Film off removes `stock`);
- **Date** (date input), **Camera**, **Lens**, **Place** text fields; the EXIF value shows as
  placeholder, typed value overrides, a reset control removes the override;
- **Delete**, two-step confirm; marks the photo for deletion (undoable until Save).

### Select mode

Select several tiles, then apply one of: Film (with optional stock), Digital, Hide, Unhide.

### Adding photos

- **Add photos** opens `<input type="file" multiple accept="image/jpeg,image/png,image/webp">`.
  Not offering HEIC makes iOS convert camera-roll photos to JPEG; the build's `sharp` cannot be
  relied on to read HEIC.
- New files get a local preview tile immediately and can be edited (film, stock, details) before
  saving; their edits are keyed by the id their file name will produce (`idOf`).
- Target path is `photos/<file name>`. If that path, or another path producing the same id,
  already exists in the tree or in pending uploads, the name gets `-2` (then `-3`, …) before the
  extension.
- Files over 25 MB get a warning; files over 100 MB are rejected (GitHub's blob limit).

### Pending changes

- Nothing reaches GitHub until **Save**. Pending state is a list of operations:
  `upload {path, file}`, `delete {path, id}`, `edit {id, field, value | null}`.
- Persisted so a reload keeps it: edit/delete ops in `localStorage`, upload files in IndexedDB.
  If storage is unavailable, the page still works; it just loses pending changes on reload.
- Bottom bar: "N changes · Review · Save". Review lists each change with its own undo;
  **Discard** clears all.

## 5. Saving

One commit through the Git Data API:

1. `GET /git/ref/heads/main` → head commit sha; `GET` that commit → base tree sha.
2. For each upload, `POST /git/blobs` (base64), sequentially, showing "Uploading k of n".
3. Read the current `photos/edits.json` at head, apply the pending edit ops, drop entries for
   deleted ids, `normalizeEdits`, serialise.
4. `POST /git/trees` with `base_tree` and entries: each upload (`mode 100644`, blob sha), each
   deletion (`sha: null`), and `photos/edits.json` (inline content).
5. `POST /git/commits` with message
   `Edit photos: A added, D deleted, E edited` (zero counts omitted), parent = head.
6. `PATCH /git/refs/heads/main` with the new sha, `force: false`.

On success pending state is cleared and the bar shows **Building…**. The page polls the live
`photos/photos.json` (cache-busted, every 20 s, up to 15 min) and shows **Live ✓** once its
`generated` time is later than the commit time; after 15 min it shows "Still building, check the
Actions tab" with a link.

### Failures

| Situation | Behaviour |
|-----------|-----------|
| Ref update rejected because `main` moved (422) | Redo steps 1 and 3–6 on the new head, reusing uploaded blobs; retry once, then show an error and keep pending. |
| 401 | Back to the token screen; pending kept. |
| 403 / 404 on the repo | Message naming the missing permission (Contents: read and write on this repo); pending kept. |
| Network error or 5xx at any step | Nothing committed; pending kept; **Retry**. Orphan blobs are harmless. |
| Malformed `edits.json` in the repo | Show the parse error; disable Save until fixed. |

## 6. Testing

- Unit (`npm test`, `node --test`), new `test/edits.test.js` and `test/editor.test.js`:
  - `idOf` unchanged behaviour (moved, same cases);
  - `applyEdits` for every field, unmatched ids, film off clears category, date → year;
  - `normalizeEdits` drops empties/unknowns and sorts;
  - name-clash renaming against tree + pending uploads;
  - pending ops → tree entries + edits.json content + commit message;
  - the 422 retry merges pending ops onto a newer `edits.json`.
- Pipeline: run `npm run photos` with a fixture `edits.json` and check `photos.json`.
- e2e (`npm run e2e`): puppeteer drives `/edit/` with request interception standing in for
  `api.github.com`: enter token, mark a photo film with a stock, hide one, upload a small JPEG,
  save, and assert the exact blob/tree/commit/ref requests. Also: 401 returns to the token screen;
  422 retries once. No test touches the real repository.

## 7. Out of scope

- Reordering photos (rooms are sorted by colour).
- Titles or captions (the site has none by design).
- Editing aperture, shutter, ISO, focal length.
- Cropping or any image editing.
- Multi-user access or OAuth.
