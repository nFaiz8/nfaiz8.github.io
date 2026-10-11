// Hash routes: #/photo/<id> and #/room/<id>. Pure parsing plus small helpers around history.

export function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h || h === '/') return null;
  const m = h.match(/^\/(photo|room)\/(.+)$/);
  if (!m) return { kind: 'unknown', id: h };
  let id;
  try { id = decodeURIComponent(m[2]); } catch { return { kind: 'unknown', id: m[2] }; }
  return { kind: m[1], id };
}

export const photoHash = (id) => `#/photo/${encodeURIComponent(id)}`;
export const roomHash = (id) => `#/room/${encodeURIComponent(id)}`;

// Change the hash without adding a history entry or firing hashchange.
export function replaceHash(hash) {
  try { history.replaceState(null, '', hash || location.pathname + location.search); } catch {}
}

export const photoLink = (id) => location.origin + location.pathname + photoHash(id);
