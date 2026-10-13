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
