// Hash routes: #/photo/<id>, #/room/<id>, #/all (every photo as a grid) and #/station (the subway, station
// spec §1). Pure parsing plus small helpers around history.

export function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h || h === '/') return null;
  if (h === '/all') return { kind: 'all' };
  if (h === '/station') return { kind: 'station' };
  const m = h.match(/^\/(photo|room)\/(.+)$/);
  if (!m) return { kind: 'unknown', id: h };
  let id;
  try { id = decodeURIComponent(m[2]); } catch { return { kind: 'unknown', id: m[2] }; }
  return { kind: m[1], id };
}

export const photoHash = (id) => `#/photo/${encodeURIComponent(id)}`;
export const roomHash = (id) => `#/room/${encodeURIComponent(id)}`;
export const ALL_HASH = '#/all';
export const STATION_HASH = '#/station';

// Change the hash without adding a history entry or firing hashchange.
export function replaceHash(hash) {
  try { history.replaceState(null, '', hash || location.pathname + location.search); } catch {}
}

export const photoLink = (id) => location.origin + location.pathname + photoHash(id);
