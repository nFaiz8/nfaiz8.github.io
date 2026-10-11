// Loads the photo manifest written by ../site's pipeline and shapes it for the world.

import { groupByColor } from './colors.js';

// Rooms are made from the colours in the photos, not from the pipeline's camera/film rooms.
export function indexData(json, exclude = []) {
  if (!json || !Array.isArray(json.photos)) {
    throw new Error('photos.json is malformed (expected photos[])');
  }
  const byId = new Map(json.photos.map((p) => [p.id, p]));
  const skip = new Set(exclude);
  // Alternate edits only appear through the viewer's Alt toggle, never on the walls.
  const rooms = groupByColor(json.photos.filter((p) => !p.hidden && !p.variantOf && !skip.has(p.id)));
  return { byId, rooms };
}

export async function loadData(url = 'photos/photos.json', exclude = []) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photos.json: HTTP ${res.status}`);
  return indexData(await res.json(), exclude);
}

// Photos have no titles on this site. This is only for screen readers and alt text.
export function describe(p) {
  const kit = p.category === 'film' ? (p.filmStock || 'film') : p.camera;
  return ['Photograph', kit, p.year].filter(Boolean).join(', ');
}

// "Camera · Year" for plaques.
export function plaqueText(p) {
  const kit = p.category === 'film' ? (p.filmStock || '35mm film') : (p.camera || '');
  return [kit, p.year].filter(Boolean).join(' · ');
}

// Full caption for the focus bar. Null fields are left out.
export function captionText(p) {
  const kit = p.category === 'film' ? (p.filmStock || '35mm film · Noritsu scan') : p.camera;
  const f = p.aperture ? `f/${String(p.aperture).replace(/^f\//, '')}` : null;
  const place = [p.location, p.year].filter(Boolean).join(', ');
  return [kit, p.lens, p.focalLength, f, p.shutter, p.iso ? `ISO ${p.iso}` : null, place]
    .filter(Boolean)
    .join(' · ');
}
