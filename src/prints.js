// Prints for sale on Darkroom. photos/prints.json maps a photo id to its Darkroom product number; the build
// turns that into a `print` link on the photo, and the viewer shows a "buy print" button for it.

export const STORE = 'https://faiz.darkroom.com';

export function parsePrints(textIn) {
  if (textIn == null || !textIn.trim()) return {};
  const j = JSON.parse(textIn);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('prints.json must be an object keyed by photo id');
  const out = {};
  for (const [id, v] of Object.entries(j)) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out[id] = n;
  }
  return out;
}

export function applyPrints(photos, prints) {
  const ids = new Set(photos.map((p) => p.id));
  const unmatched = Object.keys(prints).filter((id) => !ids.has(id));
  const out = photos.map((p) => (prints[p.id] ? { ...p, print: `${STORE}/products/${prints[p.id]}` } : p));
  return { photos: out, unmatched };
}
